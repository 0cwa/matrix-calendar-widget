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

import { spawn } from 'child_process';
import { createHash, randomUUID } from 'crypto';
import { createReadStream, createWriteStream, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import postgres from 'postgres';
import { pipeline } from 'stream/promises';
import { PRIVATE_CALENDAR_CLIENT_LIMITS } from '../model/IPrivateCalendarClientStore';
import { PostgresRoomReminderStore } from '../reminder/PostgresRoomReminderStore';
import {
  getReminderDatabaseTlsOptions,
  parseReminderDatabaseTlsMode,
} from '../reminder/ReminderDatabaseConnection';
import { createReminderDeliveryKey } from '../reminder/RoomReminderStore';
import { PostgresPrivateCalendarClientStore } from '../service/PostgresPrivateCalendarClientStore';
import { PostgresRoomCalendarBindingStore } from '../service/PostgresRoomCalendarBindingStore';
import { privateCalendarClientSecretVerifier } from '../service/private-client/PrivateCalendarClientCredentials';

const bindingDatabaseUrl = process.env.MATRIX_CALENDAR_BINDING_DATABASE_URL;
const reminderDatabaseUrl = process.env.MATRIX_CALENDAR_REMINDER_DATABASE_URL;
const privateClientDatabaseUrl =
  process.env.MATRIX_CALENDAR_PRIVATE_CLIENT_DATABASE_URL;
const bindingDatabaseTlsMode = parseReminderDatabaseTlsMode(
  process.env.MATRIX_CALENDAR_BINDING_DATABASE_TLS_MODE,
);
const reminderDatabaseTlsMode = parseReminderDatabaseTlsMode(
  process.env.MATRIX_CALENDAR_REMINDER_DATABASE_TLS_MODE,
);
const privateClientDatabaseTlsMode = parseReminderDatabaseTlsMode(
  process.env.MATRIX_CALENDAR_PRIVATE_CLIENT_DATABASE_TLS_MODE,
);
const verifyRestoredCombinedPersistence =
  process.env.MATRIX_CALENDAR_COMBINED_PERSISTENCE_VERIFY_RESTORED === 'true';
const keepCombinedPersistenceData =
  process.env.MATRIX_CALENDAR_COMBINED_PERSISTENCE_KEEP_DATA === 'true';
const describeWithDatabase =
  bindingDatabaseUrl &&
  reminderDatabaseUrl &&
  !verifyRestoredCombinedPersistence
    ? describe
    : describe.skip;
const describeWithAllStores =
  bindingDatabaseUrl && reminderDatabaseUrl && privateClientDatabaseUrl
    ? describe
    : describe.skip;
const databaseName = 'matrix_calendar_coexistence_test';

function parseExplicitDisposableDatabaseUrl(databaseUrl: string): URL {
  const parsed = new URL(databaseUrl);
  if (
    !['localhost', '127.0.0.1'].includes(parsed.hostname) ||
    parsed.pathname.slice(1) !== databaseName ||
    decodeURIComponent(parsed.username) !== 'matrix_calendar_app' ||
    parsed.search !== '' ||
    parsed.hash !== '' ||
    !/^\d{1,5}$/u.test(parsed.port) ||
    Number(parsed.port) < 1 ||
    Number(parsed.port) > 65535
  ) {
    throw new Error(
      `The coexistence contract requires a query-free loopback URL for ${databaseName} and matrix_calendar_app`,
    );
  }
  return parsed;
}

function withValidatedDatabaseUrls<T>(
  bindingUrl: string,
  reminderUrl: string,
  useUrls: (bindingUrl: string, reminderUrl: string) => T,
): T {
  const binding = parseExplicitDisposableDatabaseUrl(bindingUrl);
  const reminder = parseExplicitDisposableDatabaseUrl(reminderUrl);
  if (
    binding.hostname !== reminder.hostname ||
    binding.port !== reminder.port
  ) {
    throw new Error(
      'The coexistence contract requires both store URLs to use one PostgreSQL endpoint',
    );
  }
  return useUrls(bindingUrl, reminderUrl);
}

function withValidatedThreeDatabaseUrls<T>(
  bindingUrl: string,
  reminderUrl: string,
  privateClientUrl: string,
  useUrls: (
    bindingUrl: string,
    reminderUrl: string,
    privateClientUrl: string,
  ) => T,
): T {
  const binding = parseExplicitDisposableDatabaseUrl(bindingUrl);
  const reminder = parseExplicitDisposableDatabaseUrl(reminderUrl);
  const privateClient = parseExplicitDisposableDatabaseUrl(privateClientUrl);
  if (
    binding.hostname !== reminder.hostname ||
    binding.port !== reminder.port ||
    binding.hostname !== privateClient.hostname ||
    binding.port !== privateClient.port
  ) {
    throw new Error(
      'The three-store coexistence contract requires one PostgreSQL endpoint',
    );
  }
  return useUrls(bindingUrl, reminderUrl, privateClientUrl);
}

function createTestPostgresClient(
  databaseUrl: string,
  databaseTlsMode: ReturnType<typeof parseReminderDatabaseTlsMode>,
): ReturnType<typeof postgres> {
  const options = {
    ...getReminderDatabaseTlsOptions(databaseTlsMode, databaseUrl as string),
    max: 3,
    connect_timeout: 5,
    onnotice: () => undefined,
  } as unknown as Parameters<typeof postgres>[1];
  return postgres(databaseUrl as string, options);
}

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
      can_connect_postgres: boolean;
      can_connect_template1: boolean;
    }[]
  >`
    SELECT current_database() AS name,
           current_user AS role,
           pg_get_userbyid(d.datdba) AS owner,
           r.rolsuper AS is_superuser,
           r.rolcreatedb AS can_create_database,
           r.rolcreaterole AS can_create_role,
           has_database_privilege(current_user, 'postgres', 'CONNECT') AS can_connect_postgres,
           has_database_privilege(current_user, 'template1', 'CONNECT') AS can_connect_template1
    FROM pg_database AS d
    JOIN pg_roles AS r ON r.rolname = current_user
    WHERE d.datname = current_database()
  `;

  if (
    database?.name !== databaseName ||
    database.role !== 'matrix_calendar_app'
  ) {
    throw new Error(
      `The coexistence contract requires the isolated ${databaseName} database and matrix_calendar_app role`,
    );
  }
  if (
    database.owner !== database.role ||
    database.is_superuser ||
    database.can_create_database ||
    database.can_create_role ||
    database.can_connect_postgres ||
    database.can_connect_template1
  ) {
    throw new Error(
      'The coexistence contract requires its database-owning role without elevated PostgreSQL privileges',
    );
  }
}

async function resetOwnedSchemas(
  sql: ReturnType<typeof postgres>,
): Promise<void> {
  await sql`DROP SCHEMA IF EXISTS matrix_calendar CASCADE`;
  await sql`DROP SCHEMA IF EXISTS matrix_calendar_bindings CASCADE`;
  await sql`DROP SCHEMA IF EXISTS matrix_calendar_private_clients CASCADE`;
}

async function expectBothSchemasOwnedByRole(
  sql: ReturnType<typeof postgres>,
): Promise<void> {
  const schemas = await sql<{ name: string; owner: string }[]>`
    SELECT n.nspname AS name, pg_get_userbyid(n.nspowner) AS owner
    FROM pg_namespace AS n
    WHERE n.nspname IN ('matrix_calendar', 'matrix_calendar_bindings')
    ORDER BY n.nspname
  `;
  expect(schemas).toEqual([
    { name: 'matrix_calendar', owner: 'matrix_calendar_app' },
    { name: 'matrix_calendar_bindings', owner: 'matrix_calendar_app' },
  ]);

  const versions = await sql<
    { schema: string; version: number; version_count: number }[]
  >`
    SELECT 'matrix_calendar' AS schema,
           MAX(version) AS version,
           COUNT(*)::int AS version_count
    FROM matrix_calendar.schema_migrations
    UNION ALL
    SELECT 'matrix_calendar_bindings' AS schema,
           MAX(version) AS version,
           COUNT(*)::int AS version_count
    FROM matrix_calendar_bindings.schema_migrations
    ORDER BY schema
  `;
  expect(versions).toEqual([
    { schema: 'matrix_calendar', version: 4, version_count: 4 },
    { schema: 'matrix_calendar_bindings', version: 1, version_count: 1 },
  ]);
}

async function expectAllStoreSchemasOwnedByRole(
  sql: ReturnType<typeof postgres>,
): Promise<void> {
  const schemas = await sql<{ name: string; owner: string }[]>`
    SELECT n.nspname AS name, pg_get_userbyid(n.nspowner) AS owner
    FROM pg_namespace AS n
    WHERE n.nspname IN (
      'matrix_calendar',
      'matrix_calendar_bindings',
      'matrix_calendar_private_clients'
    )
    ORDER BY n.nspname
  `;
  expect(schemas).toEqual([
    { name: 'matrix_calendar', owner: 'matrix_calendar_app' },
    { name: 'matrix_calendar_bindings', owner: 'matrix_calendar_app' },
    {
      name: 'matrix_calendar_private_clients',
      owner: 'matrix_calendar_app',
    },
  ]);

  const versions = await sql<
    { schema: string; version: number; version_count: number }[]
  >`
    SELECT 'matrix_calendar' AS schema,
           MAX(version) AS version,
           COUNT(*)::int AS version_count
    FROM matrix_calendar.schema_migrations
    UNION ALL
    SELECT 'matrix_calendar_bindings' AS schema,
           MAX(version) AS version,
           COUNT(*)::int AS version_count
    FROM matrix_calendar_bindings.schema_migrations
    UNION ALL
    SELECT 'matrix_calendar_private_clients' AS schema,
           MAX(version) AS version,
           COUNT(*)::int AS version_count
    FROM matrix_calendar_private_clients.schema_migrations
    ORDER BY schema
  `;
  expect(versions).toEqual([
    { schema: 'matrix_calendar', version: 4, version_count: 4 },
    { schema: 'matrix_calendar_bindings', version: 1, version_count: 1 },
    {
      schema: 'matrix_calendar_private_clients',
      version: 2,
      version_count: 2,
    },
  ]);
}

async function runPostgresTool(
  tool: 'pg_dump' | 'pg_restore',
  args: string[],
  dumpPath: string,
): Promise<void> {
  const database = new URL(bindingDatabaseUrl as string);
  const password = decodeURIComponent(database.password);
  const command =
    tool === 'pg_dump'
      ? process.env.MATRIX_CALENDAR_PG_DUMP_BINARY || 'pg_dump'
      : process.env.MATRIX_CALENDAR_PG_RESTORE_BINARY || 'pg_restore';
  const child = spawn(command, args, {
    env: {
      ...process.env,
      PGHOST: database.hostname,
      PGPORT: database.port,
      PGUSER: decodeURIComponent(database.username),
      PGDATABASE: database.pathname.slice(1),
      PGPASSWORD: password,
    },
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  const streamResult =
    tool === 'pg_dump'
      ? pipeline(child.stdout, createWriteStream(dumpPath))
      : pipeline(createReadStream(dumpPath), child.stdin);
  const processResult = new Promise<void>((resolve, reject) => {
    child.once('error', () =>
      reject(
        new Error(
          `${tool} failed in the isolated PostgreSQL coexistence contract`,
        ),
      ),
    );
    child.once('close', (status) => {
      if (status !== 0) {
        reject(
          new Error(
            `${tool} failed in the isolated PostgreSQL coexistence contract`,
          ),
        );
      } else {
        resolve();
      }
    });
  });
  try {
    await Promise.all([streamResult, processResult]);
  } catch {
    child.kill();
    throw new Error(
      `${tool} failed in the isolated PostgreSQL coexistence contract`,
    );
  }
}

type CombinedPostgresStores = {
  bindingSql: ReturnType<typeof postgres>;
  reminderSql: ReturnType<typeof postgres>;
  privateClientSql: ReturnType<typeof postgres>;
  binding: PostgresRoomCalendarBindingStore;
  reminder: PostgresRoomReminderStore;
  privateClients: PostgresPrivateCalendarClientStore;
};

function createCombinedPostgresStores(): CombinedPostgresStores {
  return withValidatedThreeDatabaseUrls(
    bindingDatabaseUrl as string,
    reminderDatabaseUrl as string,
    privateClientDatabaseUrl as string,
    (bindingUrl, reminderUrl, privateClientUrl) => {
      const bindingSql = createTestPostgresClient(
        bindingUrl,
        bindingDatabaseTlsMode,
      );
      const reminderSql = createTestPostgresClient(
        reminderUrl,
        reminderDatabaseTlsMode,
      );
      const privateClientSql = createTestPostgresClient(
        privateClientUrl,
        privateClientDatabaseTlsMode,
      );
      return {
        bindingSql,
        reminderSql,
        privateClientSql,
        binding: new PostgresRoomCalendarBindingStore(bindingSql),
        reminder: new PostgresRoomReminderStore(reminderSql),
        privateClients: new PostgresPrivateCalendarClientStore(
          privateClientSql,
        ),
      };
    },
  );
}

async function closeCombinedPostgresStores(
  stores: CombinedPostgresStores,
): Promise<void> {
  await Promise.all([
    stores.bindingSql.end({ timeout: 5 }),
    stores.reminderSql.end({ timeout: 5 }),
    stores.privateClientSql.end({ timeout: 5 }),
  ]);
}

describeWithDatabase('shared PostgreSQL binding and reminder database', () => {
  let bindingSql: ReturnType<typeof postgres>;
  let reminderSql: ReturnType<typeof postgres>;
  let initialized = false;

  beforeAll(async () => {
    const clients = withValidatedDatabaseUrls(
      bindingDatabaseUrl as string,
      reminderDatabaseUrl as string,
      (bindingUrl, reminderUrl) => ({
        binding: createTestPostgresClient(bindingUrl, bindingDatabaseTlsMode),
        reminder: createTestPostgresClient(
          reminderUrl,
          reminderDatabaseTlsMode,
        ),
      }),
    );
    bindingSql = clients.binding;
    reminderSql = clients.reminder;
    await requireIsolatedTestDatabase(bindingSql);
    await requireIsolatedTestDatabase(reminderSql);
    initialized = true;
  });

  afterAll(async () => {
    if (!bindingSql && !reminderSql) return;
    try {
      if (initialized) await resetOwnedSchemas(bindingSql);
    } finally {
      await Promise.all([
        bindingSql?.end({ timeout: 5 }),
        reminderSql?.end({ timeout: 5 }),
      ]);
    }
  });

  it('supports both migration orders and restores both adapters from one custom dump', async () => {
    const reminder = new PostgresRoomReminderStore(reminderSql);
    const binding = new PostgresRoomCalendarBindingStore(bindingSql);

    for (const order of [
      [reminder, binding],
      [binding, reminder],
    ]) {
      await resetOwnedSchemas(bindingSql);
      await order[0].migrate();
      await order[1].migrate();
      await expectBothSchemasOwnedByRole(bindingSql);
    }

    const id = randomUUID().replaceAll('-', '');
    const reminderState = {
      roomId: `!coexist-reminder-${id}:example.test`,
      calendarId: `calendar-${id}`,
      eventUid: `event-${id}`,
      recurrenceId: null,
      alarmUid: `alarm-${id}`,
      target: { kind: 'room' as const },
      allDaySchedule: {
        daysBefore: 3,
        localTime: '09:00',
        timezone: 'Europe/Stockholm',
      },
    };
    await reminder.upsertConfiguration(reminderState);
    const persistedReminderState =
      await reminder.getConfiguration(reminderState);
    expect(persistedReminderState?.scheduleEffectiveAt).toBeInstanceOf(Date);
    expect(
      await reminder.listConfigurations(
        reminderState.roomId,
        reminderState.calendarId,
      ),
    ).toEqual([persistedReminderState]);

    const bindingState = {
      roomId: `!coexist-binding-${id}:example.test`,
      calendarId: `bound-${id}`,
    };
    const reservation = await binding.reserve({
      binding: bindingState,
      staticBindings: [],
      createdBy: '@moderator:example.test',
      createdAt: new Date('2026-10-20T12:00:00.000Z'),
    });
    expect(reservation.kind).toBe('reserved');
    await binding.markReady(bindingState, new Date('2026-10-20T12:01:00.000Z'));
    expect(await binding.listAll()).toContainEqual(
      expect.objectContaining({ ...bindingState, status: 'ready' }),
    );

    const tempDirectory = mkdtempSync(join(tmpdir(), 'matrix-calendar-pg-'));
    const dumpPath = join(tempDirectory, 'coexistence.dump');
    try {
      await runPostgresTool(
        'pg_dump',
        [
          '--no-password',
          '--dbname=matrix_calendar_coexistence_test',
          '--format=custom',
          '--no-owner',
          '--no-acl',
        ],
        dumpPath,
      );
      await resetOwnedSchemas(bindingSql);
      await runPostgresTool(
        'pg_restore',
        [
          '--no-password',
          '--dbname=matrix_calendar_coexistence_test',
          '--no-owner',
          '--no-acl',
        ],
        dumpPath,
      );

      const restoredReminder = new PostgresRoomReminderStore(reminderSql);
      const restoredBinding = new PostgresRoomCalendarBindingStore(bindingSql);
      await expectBothSchemasOwnedByRole(bindingSql);
      await expect(
        restoredReminder.listConfigurations(
          reminderState.roomId,
          reminderState.calendarId,
        ),
      ).resolves.toEqual([persistedReminderState]);
      await expect(restoredBinding.listAll()).resolves.toContainEqual(
        expect.objectContaining({ ...bindingState, status: 'ready' }),
      );
    } finally {
      rmSync(tempDirectory, { recursive: true, force: true });
    }
  });
});

describeWithAllStores(
  'shared PostgreSQL binding, reminder, and private client database',
  () => {
    const now = new Date('2026-10-23T12:00:00.000Z');
    const bindingState = {
      roomId: '!combined-persistence:example.test',
      calendarId: 'combined-persistence-calendar',
    };
    const reminderIdentity = {
      roomId: bindingState.roomId,
      calendarId: bindingState.calendarId,
      eventUid: 'combined-all-day-event',
      recurrenceId: null,
      alarmUid: 'combined-all-day-alarm',
    };
    const allDaySchedule = {
      daysBefore: 2,
      localTime: '09:00',
      timezone: 'Europe/Stockholm',
    };
    const reminderTarget = {
      kind: 'users' as const,
      userIds: ['@alice:example.test', '@bob:example.test'],
    };
    const privateClientOwner = '@combined-persistence:example.test';
    const privateClientTarget = {
      target: 'personal' as const,
      calendarId: 'http://radicale.example.test/combined-persistence/personal/',
    };
    const privateClientPath = '/combined-persistence/personal/';
    const activeAppId = `mcwpc~${'a'.repeat(48)}`;
    const revokedAppId = `mcwpc~${'b'.repeat(48)}`;
    const clientSecret = Buffer.alloc(32, 0x73).toString('base64url');
    const epochHash = createHash('sha256')
      .update(Buffer.alloc(32, 0x61))
      .digest('hex');
    const deliveryIdentity = { ...reminderIdentity, triggerOrdinal: 1 };
    const deliveryKey = createReminderDeliveryKey(deliveryIdentity);
    const verifyOnly = verifyRestoredCombinedPersistence;

    let stores: CombinedPostgresStores | undefined;
    let initialized = false;

    beforeAll(async () => {
      stores = createCombinedPostgresStores();
      await Promise.all([
        requireIsolatedTestDatabase(stores.bindingSql),
        requireIsolatedTestDatabase(stores.reminderSql),
        requireIsolatedTestDatabase(stores.privateClientSql),
      ]);
      initialized = true;
    });

    afterAll(async () => {
      if (!stores) return;
      try {
        if (initialized && !keepCombinedPersistenceData) {
          await resetOwnedSchemas(stores.bindingSql);
        }
      } finally {
        await closeCombinedPostgresStores(stores);
      }
    });

    it('keeps all three stores independent across migration orders, reconnect, and restore', async () => {
      if (!stores)
        throw new Error('Combined PostgreSQL stores are unavailable');

      const migrationOrders = [
        [stores.privateClients, stores.binding, stores.reminder],
        [stores.reminder, stores.binding, stores.privateClients],
      ] as const;

      if (verifyOnly) {
        for (const store of migrationOrders[0]) await store.migrate();
        await expectAllStoreSchemasOwnedByRole(stores.bindingSql);
        await expectPersistedState(stores);
        return;
      }

      for (const order of migrationOrders) {
        await resetOwnedSchemas(stores.bindingSql);
        for (const store of order) await store.migrate();
        await expectAllStoreSchemasOwnedByRole(stores.bindingSql);
      }

      const bindingCreatedAt = new Date('2026-10-23T12:00:00.000Z');
      const bindingReadyAt = new Date('2026-10-23T12:01:00.000Z');
      const reservation = await stores.binding.reserve({
        binding: bindingState,
        staticBindings: [],
        createdBy: '@moderator:example.test',
        createdAt: bindingCreatedAt,
      });
      expect(reservation.kind).toBe('reserved');
      await stores.binding.markReady(bindingState, bindingReadyAt);

      const initialTarget = {
        kind: 'users' as const,
        userIds: ['@alice:example.test'],
      };
      await stores.reminder.upsertConfiguration({
        ...reminderIdentity,
        target: initialTarget,
        allDaySchedule,
      });
      const initialReminder =
        await stores.reminder.getConfiguration(reminderIdentity);
      expect(initialReminder?.scheduleEffectiveAt).toBeInstanceOf(Date);
      const activationBeforeTargetEdit = initialReminder?.scheduleEffectiveAt;
      if (!(activationBeforeTargetEdit instanceof Date)) {
        throw new Error('All-day reminder activation timestamp is missing');
      }

      await stores.reminder.upsertConfiguration({
        ...reminderIdentity,
        target: reminderTarget,
        allDaySchedule,
      });
      const editedReminder =
        await stores.reminder.getConfiguration(reminderIdentity);
      expect(editedReminder?.scheduleEffectiveAt).toEqual(
        activationBeforeTargetEdit,
      );
      expect(editedReminder?.revision).toBe(2);
      const claim = await stores.reminder.claimDelivery(
        deliveryIdentity,
        60_000,
      );
      expect(claim?.deliveryKey).toBe(deliveryKey);
      expect(
        await stores.reminder.markDeliverySent(
          claim!.deliveryKey,
          claim!.claimToken,
        ),
      ).toBe(true);

      const makePrivateClientRecord = (appId: string) => ({
        appId,
        createdBy: privateClientOwner,
        target: privateClientTarget,
        canonicalPath: privateClientPath,
        secretVerifier: privateCalendarClientSecretVerifier(
          appId,
          clientSecret,
        ),
        credentialEpochHash: epochHash,
        createdAt: now,
        expiresAt: new Date(
          now.getTime() + PRIVATE_CALENDAR_CLIENT_LIMITS.credentialLifetimeMs,
        ),
      });
      for (const appId of [activeAppId, revokedAppId]) {
        expect(
          await stores.privateClients.createPending(
            makePrivateClientRecord(appId),
          ),
        ).toEqual({ kind: 'created' });
        expect(
          await stores.privateClients.beginBootstrap(appId, now),
        ).toMatchObject({ state: 'pending', mapState: 'bootstrap' });
        expect(await stores.privateClients.activate(appId, now)).toMatchObject({
          state: 'active',
          mapState: 'present',
        });
      }
      expect(
        await stores.privateClients.revoke(revokedAppId, now),
      ).toMatchObject({
        state: 'revoked',
        mapState: 'cleanup-pending',
      });

      await expectPersistedState(stores, activationBeforeTargetEdit);
      await closeCombinedPostgresStores(stores);
      stores = createCombinedPostgresStores();
      await Promise.all([
        requireIsolatedTestDatabase(stores.bindingSql),
        requireIsolatedTestDatabase(stores.reminderSql),
        requireIsolatedTestDatabase(stores.privateClientSql),
      ]);
      for (const store of [
        stores.privateClients,
        stores.binding,
        stores.reminder,
      ]) {
        await store.migrate();
      }
      await expectAllStoreSchemasOwnedByRole(stores.bindingSql);
      await expectPersistedState(stores, activationBeforeTargetEdit);
    });

    async function expectPersistedState(
      current: CombinedPostgresStores,
      expectedActivation?: Date,
    ): Promise<void> {
      const bindings = await current.binding.listAll();
      expect(bindings).toContainEqual(
        expect.objectContaining({
          ...bindingState,
          status: 'ready',
          createdBy: '@moderator:example.test',
          createdAt: new Date('2026-10-23T12:00:00.000Z'),
          readyAt: new Date('2026-10-23T12:01:00.000Z'),
        }),
      );

      const reminder =
        await current.reminder.getConfiguration(reminderIdentity);
      expect(reminder).toMatchObject({
        ...reminderIdentity,
        target: reminderTarget,
        allDaySchedule,
        revision: 2,
      });
      expect(reminder?.scheduleEffectiveAt).toBeInstanceOf(Date);
      if (expectedActivation) {
        expect(reminder?.scheduleEffectiveAt).toEqual(expectedActivation);
      }

      const deliveryRows = await current.reminderSql<
        {
          delivery_key: string;
          room_id: string;
          calendar_id: string;
          event_uid: string;
          recurrence_id: string;
          alarm_uid: string;
          trigger_ordinal: number;
          state: string;
          attempt_count: number;
          sent_at: Date;
        }[]
      >`
        SELECT delivery_key, room_id, calendar_id, event_uid, recurrence_id,
               alarm_uid, trigger_ordinal, state, attempt_count, sent_at
        FROM matrix_calendar.reminder_deliveries
        WHERE delivery_key = ${deliveryKey}
      `;
      expect(deliveryRows).toEqual([
        {
          delivery_key: deliveryKey,
          room_id: bindingState.roomId,
          calendar_id: bindingState.calendarId,
          event_uid: reminderIdentity.eventUid,
          recurrence_id: '',
          alarm_uid: reminderIdentity.alarmUid,
          trigger_ordinal: deliveryIdentity.triggerOrdinal,
          state: 'sent',
          attempt_count: 1,
          sent_at: expect.any(Date),
        },
      ]);
      expect(
        await current.reminder.claimDelivery(deliveryIdentity, 60_000),
      ).toBeUndefined();

      const activeClient = await current.privateClients.getByAppId(
        activeAppId,
        now,
      );
      expect(activeClient).toMatchObject({
        appId: activeAppId,
        createdBy: privateClientOwner,
        target: privateClientTarget,
        canonicalPath: privateClientPath,
        secretVerifier: privateCalendarClientSecretVerifier(
          activeAppId,
          clientSecret,
        ),
        credentialEpochHash: epochHash,
        state: 'active',
        mapState: 'present',
        createdAt: now,
        expiresAt: new Date(
          now.getTime() + PRIVATE_CALENDAR_CLIENT_LIMITS.credentialLifetimeMs,
        ),
      });
      const revokedClient = await current.privateClients.getByAppId(
        revokedAppId,
        now,
      );
      expect(revokedClient).toMatchObject({
        appId: revokedAppId,
        createdBy: privateClientOwner,
        target: privateClientTarget,
        canonicalPath: privateClientPath,
        credentialEpochHash: epochHash,
        state: 'revoked',
        mapState: 'cleanup-pending',
        createdAt: now,
        revokedAt: now,
      });
      expect(revokedClient).not.toHaveProperty('secretVerifier');
    }
  },
);

describe('PostgreSQL coexistence URL guard', () => {
  it('rejects endpoint overrides before creating clients or resetting schemas', () => {
    const loopbackUrl =
      'postgresql://matrix_calendar_app:synthetic@127.0.0.1:5432/matrix_calendar_coexistence_test';
    const createClientsOrResetSchemas = jest.fn();

    expect(() =>
      withValidatedDatabaseUrls(
        `${loopbackUrl}?host=remote.example.test`,
        loopbackUrl,
        createClientsOrResetSchemas,
      ),
    ).toThrow('query-free loopback URL');
    expect(createClientsOrResetSchemas).not.toHaveBeenCalled();
  });

  it('rejects store URLs that use different loopback ports', () => {
    const bindingUrl =
      'postgresql://matrix_calendar_app:synthetic@127.0.0.1:5432/matrix_calendar_coexistence_test';
    const reminderUrl =
      'postgresql://matrix_calendar_app:synthetic@127.0.0.1:5433/matrix_calendar_coexistence_test';

    expect(() =>
      withValidatedDatabaseUrls(bindingUrl, reminderUrl, jest.fn()),
    ).toThrow('one PostgreSQL endpoint');
  });

  it('rejects a private-client store URL that points to another endpoint', () => {
    const bindingUrl =
      'postgresql://matrix_calendar_app:synthetic@127.0.0.1:5432/matrix_calendar_coexistence_test';
    const privateClientUrl =
      'postgresql://matrix_calendar_app:synthetic@127.0.0.1:5433/matrix_calendar_coexistence_test';
    const createClients = jest.fn();

    expect(() =>
      withValidatedThreeDatabaseUrls(
        bindingUrl,
        bindingUrl,
        privateClientUrl,
        createClients,
      ),
    ).toThrow('one PostgreSQL endpoint');
    expect(createClients).not.toHaveBeenCalled();
  });
});
