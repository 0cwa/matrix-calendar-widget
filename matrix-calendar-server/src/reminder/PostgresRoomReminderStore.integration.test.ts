/*
 * Copyright 2026 Matrix Calendar Widget contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { randomUUID } from 'crypto';
import postgres from 'postgres';
import { PostgresRoomReminderStore } from './PostgresRoomReminderStore';
import {
  getReminderDatabaseTlsOptions,
  parseReminderDatabaseTlsMode,
} from './ReminderDatabaseConnection';

const databaseUrl = process.env.MATRIX_CALENDAR_REMINDER_DATABASE_URL;
const databaseTlsMode = parseReminderDatabaseTlsMode(
  process.env.MATRIX_CALENDAR_REMINDER_DATABASE_TLS_MODE,
);
const describeWithDatabase = databaseUrl ? describe : describe.skip;

async function requireIsolatedTestDatabase(
  sql: ReturnType<typeof postgres>,
): Promise<void> {
  const [database] = await sql<
    {
      name: string;
      role: string;
      owner: string;
      is_superuser: boolean;
      can_create_database: boolean;
      can_create_role: boolean;
      can_connect_current_database: boolean;
      can_connect_postgres: boolean;
      can_connect_template1: boolean;
    }[]
  >`
    SELECT current_database() AS name,
           current_user AS role,
           pg_get_userbyid(database.datdba) AS owner,
           current_role_row.rolsuper AS is_superuser,
           current_role_row.rolcreatedb AS can_create_database,
           current_role_row.rolcreaterole AS can_create_role,
           has_database_privilege(current_user, current_database(), 'CONNECT') AS can_connect_current_database,
           has_database_privilege(current_user, 'postgres', 'CONNECT') AS can_connect_postgres,
           has_database_privilege(current_user, 'template1', 'CONNECT') AS can_connect_template1
    FROM pg_database AS database
    JOIN pg_roles AS current_role_row
      ON current_role_row.rolname = current_user
    WHERE database.datname = current_database()
  `;
  if (database.name !== 'matrix_calendar_test') {
    throw new Error(
      'The PostgreSQL reminder contract requires the isolated matrix_calendar_test database',
    );
  }
  if (
    database.owner !== database.role ||
    database.is_superuser ||
    database.can_create_database ||
    database.can_create_role ||
    !database.can_connect_current_database ||
    database.can_connect_postgres ||
    database.can_connect_template1
  ) {
    throw new Error(
      'The PostgreSQL reminder contract requires a database-owning role without elevated PostgreSQL privileges',
    );
  }
}

function createTestPostgresClient(): ReturnType<typeof postgres> {
  // Match the runtime-supported host/port arrays used for IP URL targets;
  // Postgres.js 3.4.5's public Options type does not declare those arrays.
  const postgresOptions = {
    ...getReminderDatabaseTlsOptions(databaseTlsMode, databaseUrl as string),
    max: 3,
    connect_timeout: 5,
  } as unknown as Parameters<typeof postgres>[1];
  return postgres(databaseUrl as string, postgresOptions);
}

async function waitForQueryActivity(
  sql: ReturnType<typeof postgres>,
  marker: string,
  active: boolean,
): Promise<boolean> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const [row] = await sql<{ active: boolean }[]>`
      SELECT EXISTS (
        SELECT 1
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND pid <> pg_backend_pid()
          AND usename = current_user
          AND state = 'active'
          AND query LIKE ${`%${marker}%`}
      ) AS active
    `;
    if (row.active === active) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return false;
}

describeWithDatabase('PostgresRoomReminderStore integration', () => {
  const roomId = `!reminder-store-${randomUUID()}:example.test`;
  const calendarId = 'room-calendar';
  let sql: ReturnType<typeof postgres>;
  let store: PostgresRoomReminderStore;
  let initialized = false;

  beforeAll(async () => {
    sql = createTestPostgresClient();
    await requireIsolatedTestDatabase(sql);
    store = new PostgresRoomReminderStore(sql);
    await store.migrate();
    initialized = true;
  });

  afterAll(async () => {
    if (sql) {
      try {
        if (initialized) {
          await sql`
            DELETE FROM matrix_calendar.reminder_deliveries
            WHERE room_id = ${roomId}
          `;
          await sql`
            DELETE FROM matrix_calendar.room_reminder_configurations
            WHERE room_id = ${roomId}
          `;
        }
      } finally {
        await sql.end({ timeout: 5 });
      }
    }
  });

  it('applies repeatable migrations and upserts/removes room configurations', async () => {
    await store.migrate();
    const config = {
      roomId,
      calendarId,
      eventUid: 'weekly-planning',
      recurrenceId: null,
      alarmUid: 'alarm-uid',
    };

    await store.upsertConfiguration(config);
    await store.upsertConfiguration(config);
    expect(await store.listConfigurations(roomId, calendarId)).toEqual([
      config,
    ]);

    await store.deleteConfiguration(config);
    expect(await store.listConfigurations(roomId, calendarId)).toEqual([]);
  });

  it('returns bounded exclusive configuration pages and checks exact existence', async () => {
    const configurations = [
      {
        roomId,
        calendarId,
        eventUid: 'paging-a',
        recurrenceId: null,
        alarmUid: 'alarm-a',
      },
      {
        roomId,
        calendarId,
        eventUid: 'paging-a',
        recurrenceId: '20261001T090000Z',
        alarmUid: 'alarm-a',
      },
      {
        roomId,
        calendarId,
        eventUid: 'paging-b',
        recurrenceId: null,
        alarmUid: 'alarm-a',
      },
    ];
    for (const configuration of configurations) {
      await store.upsertConfiguration(configuration);
    }

    const firstPage = await store.listConfigurationPage(
      roomId,
      calendarId,
      undefined,
      2,
    );
    const secondPage = await store.listConfigurationPage(
      roomId,
      calendarId,
      {
        eventUid: firstPage[1].eventUid,
        recurrenceId: firstPage[1].recurrenceId,
        alarmUid: firstPage[1].alarmUid,
      },
      2,
    );

    expect(firstPage).toEqual(configurations.slice(0, 2));
    expect(secondPage).toEqual(configurations.slice(2));
    expect(await store.hasConfiguration(configurations[0])).toBe(true);
    expect(
      await store.hasConfiguration({
        ...configurations[0],
        alarmUid: 'missing-alarm',
      }),
    ).toBe(false);
    await expect(
      store.listConfigurationPage(roomId, calendarId, undefined, 101),
    ).rejects.toThrow(
      'Reminder configuration page size must be between 1 and 100',
    );

    await sql`
      DELETE FROM matrix_calendar.room_reminder_configurations
      WHERE room_id = ${roomId} AND event_uid LIKE 'paging-%'
    `;
  });

  it('cancels an in-flight PostgreSQL query and leaves store reads healthy', async () => {
    const marker = 'reminder_cancel_contract';
    const query = sql.unsafe(
      `SELECT pg_sleep(10) /* ${marker} */`,
    ) as Promise<unknown> & { cancel(): void };
    const cancellableStore = new PostgresRoomReminderStore(
      (() => query) as unknown as ReturnType<typeof postgres>,
    );
    const controller = new AbortController();
    const pendingPage = cancellableStore.listConfigurationPage(
      roomId,
      calendarId,
      undefined,
      1,
      controller.signal,
    );
    let queryStopped = false;

    try {
      expect(await waitForQueryActivity(sql, marker, true)).toBe(true);
      controller.abort();
      await expect(pendingPage).rejects.toThrow(
        'Reminder store operation aborted',
      );
      queryStopped = await waitForQueryActivity(sql, marker, false);
      expect(queryStopped).toBe(true);
      expect(
        await store.listConfigurationPage(roomId, calendarId, undefined, 1),
      ).toEqual(expect.any(Array));
    } finally {
      controller.abort();
      if (!queryStopped) query.cancel();
      await pendingPage.catch(() => undefined);
    }
  });

  it('refuses a schema version newer than this server supports', async () => {
    await requireIsolatedTestDatabase(sql);

    const [latestApplied] = await sql<{ version: number }[]>`
      SELECT COALESCE(MAX(version), 0)::integer AS version
      FROM matrix_calendar.schema_migrations
    `;
    const futureVersion = latestApplied.version + 1;
    const [insertedVersion] = await sql<{ version: number }[]>`
      INSERT INTO matrix_calendar.schema_migrations (version)
      VALUES (${futureVersion})
      ON CONFLICT (version) DO NOTHING
      RETURNING version
    `;

    if (!insertedVersion) {
      throw new Error('Could not insert the synthetic future schema version');
    }

    try {
      expect(insertedVersion.version).toBe(futureVersion);
      await expect(store.migrate()).rejects.toThrow(
        `Reminder store schema version ${futureVersion} is newer than the supported version`,
      );
    } finally {
      await sql`
        DELETE FROM matrix_calendar.schema_migrations
        WHERE version = ${futureVersion}
      `;
    }
  });

  it('atomically grants one concurrent claim and prevents a second send after completion', async () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const identity = {
        roomId,
        calendarId,
        eventUid: `concurrent-planning-${attempt}`,
        recurrenceId: '20261001T090000Z',
        alarmUid: 'alarm-uid',
        triggerOrdinal: 0,
      };
      const claims = await Promise.all([
        store.claimDelivery(identity, 60_000),
        store.claimDelivery(identity, 60_000),
      ]);
      const claim = claims.find((candidate) => candidate !== undefined);

      expect(claims.filter(Boolean)).toHaveLength(1);
      expect(claim?.attemptCount).toBe(1);
      expect(await store.claimDelivery(identity, 60_000)).toBeUndefined();
      expect(
        await store.markDeliverySent(claim!.deliveryKey, claim!.claimToken),
      ).toBe(true);
      expect(await store.claimDelivery(identity, 60_000)).toBeUndefined();
    }
  });

  it('allows a stale lease to be reclaimed and rejects updates from the prior worker', async () => {
    const identity = {
      roomId,
      calendarId,
      eventUid: 'retry-planning',
      recurrenceId: null,
      alarmUid: 'alarm-uid',
      triggerOrdinal: 0,
    };
    const oldClaim = await store.claimDelivery(identity, 50);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const newClaim = await store.claimDelivery(identity, 60_000);

    expect(oldClaim).toBeDefined();
    expect(newClaim?.attemptCount).toBe(2);
    expect(newClaim?.claimToken).not.toBe(oldClaim?.claimToken);
    expect(
      await store.markDeliverySent(oldClaim!.deliveryKey, oldClaim!.claimToken),
    ).toBe(false);
    expect(
      await store.releaseDeliveryClaim(
        newClaim!.deliveryKey,
        newClaim!.claimToken,
      ),
    ).toBe(true);

    const retryClaim = await store.claimDelivery(identity, 60_000);
    expect(retryClaim?.attemptCount).toBe(3);
    expect(
      await store.markDeliverySent(
        retryClaim!.deliveryKey,
        retryClaim!.claimToken,
      ),
    ).toBe(true);
  });

  it('persists reminder configuration and delivery state across repository restart', async () => {
    const config = {
      roomId,
      calendarId,
      eventUid: 'restart-planning',
      recurrenceId: null,
      alarmUid: 'alarm-uid',
    };
    const identity = {
      ...config,
      triggerOrdinal: 0,
    };

    await store.upsertConfiguration(config);
    const claim = await store.claimDelivery(identity, 60_000);
    expect(claim).toBeDefined();
    expect(
      await store.markDeliverySent(claim!.deliveryKey, claim!.claimToken),
    ).toBe(true);

    await store.onApplicationShutdown();
    sql = createTestPostgresClient();
    store = new PostgresRoomReminderStore(sql);
    await store.migrate();

    expect(await store.listConfigurations(roomId, calendarId)).toContainEqual(
      config,
    );
    expect(await store.claimDelivery(identity, 60_000)).toBeUndefined();
  });
});
