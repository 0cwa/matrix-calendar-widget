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
import {
  ROOM_CALENDAR_BINDING_LIMITS,
  RoomCalendarBindingReservation,
} from '../model/IRoomCalendarBindingStore';
import type { PostgresDatabaseTlsMode } from '../reminder/ReminderDatabaseConnection';
import { getPostgresDatabaseTlsOptions } from '../reminder/ReminderDatabaseConnection';
import { PostgresRoomCalendarBindingStore } from './PostgresRoomCalendarBindingStore';

const databaseUrl = process.env.MATRIX_CALENDAR_BINDING_DATABASE_URL;
function parseBindingDatabaseTlsMode(
  value: string | undefined,
): PostgresDatabaseTlsMode {
  if (value === undefined || value === 'verify-full') return 'verify-full';
  if (value === 'trusted-private-network') return value;
  throw new Error(
    'MATRIX_CALENDAR_BINDING_DATABASE_TLS_MODE must be verify-full or trusted-private-network',
  );
}
const databaseTlsMode = parseBindingDatabaseTlsMode(
  process.env.MATRIX_CALENDAR_BINDING_DATABASE_TLS_MODE,
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
  if (database.name !== 'matrix_calendar_binding_test') {
    throw new Error(
      'The PostgreSQL binding contract requires the isolated matrix_calendar_binding_test database',
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
      'The PostgreSQL binding contract requires a database-owning role without elevated PostgreSQL privileges',
    );
  }
}

function createTestPostgresClient(): ReturnType<typeof postgres> {
  const postgresOptions = {
    ...getPostgresDatabaseTlsOptions(databaseTlsMode, databaseUrl as string),
    max: 3,
    connect_timeout: 5,
  } as unknown as Parameters<typeof postgres>[1];
  return postgres(databaseUrl as string, postgresOptions);
}

function newBinding(): { roomId: string; calendarId: string } {
  const id = randomUUID().replaceAll('-', '');
  return {
    roomId: `!binding-${id}:example.test`,
    calendarId: `calendar-${id}`,
  };
}

function newReservation(
  binding: { roomId: string; calendarId: string },
  staticBindings: readonly { roomId: string; calendarId: string }[] = [],
): RoomCalendarBindingReservation {
  return {
    binding,
    staticBindings,
    createdBy: '@moderator:example.test',
    createdAt: new Date(),
  };
}

describeWithDatabase('PostgresRoomCalendarBindingStore integration', () => {
  let sql: ReturnType<typeof postgres>;
  let store: PostgresRoomCalendarBindingStore;
  let initialized = false;
  const createdRoomIds: string[] = [];

  beforeAll(async () => {
    sql = createTestPostgresClient();
    await requireIsolatedTestDatabase(sql);
    store = new PostgresRoomCalendarBindingStore(sql);
    await store.migrate();
    initialized = true;
  });

  afterEach(async () => {
    if (initialized && createdRoomIds.length > 0) {
      await sql`
        DELETE FROM matrix_calendar_bindings.room_calendar_bindings
        WHERE room_id = ANY(${createdRoomIds}::text[])
      `;
      createdRoomIds.length = 0;
    }
  });

  afterAll(async () => {
    if (sql) await sql.end({ timeout: 5 });
  });

  it('migrates repeatably and persists an exact pending reservation across a new client', async () => {
    await store.migrate();
    const binding = newBinding();
    createdRoomIds.push(binding.roomId);
    const result = await store.reserve(newReservation(binding));
    expect(result.kind).toBe('reserved');
    if (result.kind !== 'reserved') return;
    expect(result.record.status).toBe('pending');

    const restartedSql = createTestPostgresClient();
    try {
      await requireIsolatedTestDatabase(restartedSql);
      const restartedStore = new PostgresRoomCalendarBindingStore(restartedSql);
      await expect(restartedStore.listAll()).resolves.toContainEqual(
        result.record,
      );
    } finally {
      await restartedSql.end({ timeout: 5 });
    }
  });

  it('serializes same-room reservations and preserves the first collection ID', async () => {
    const first = newBinding();
    const second = { ...first, calendarId: `calendar-${randomUUID()}` };
    createdRoomIds.push(first.roomId);

    const results = await Promise.all([
      store.reserve(newReservation(first)),
      store.reserve(newReservation(second)),
    ]);
    expect(results.map(({ kind }) => kind).sort()).toEqual([
      'existing',
      'reserved',
    ]);
    const records = results.map((result) => {
      if (result.kind === 'reserved' || result.kind === 'existing') {
        return result.record;
      }
      throw new Error('Unexpected conflict during same-room retry');
    });
    expect(records[0]).toEqual(records[1]);
  });

  it('checks the total cap before returning an existing room reservation', async () => {
    const binding = newBinding();
    createdRoomIds.push(binding.roomId);
    const reserved = await store.reserve(newReservation(binding));
    expect(reserved.kind).toBe('reserved');
    if (reserved.kind !== 'reserved') return;

    const existingRows = await store.listAll();
    if (
      existingRows.length > ROOM_CALENDAR_BINDING_LIMITS.maxConfiguredBindings
    ) {
      throw new Error(
        'The isolated binding test database is already over capacity',
      );
    }
    const staticAtCapacity = Array.from(
      {
        length:
          ROOM_CALENDAR_BINDING_LIMITS.maxConfiguredBindings -
          existingRows.length,
      },
      () => newBinding(),
    );
    await expect(
      store.reserve(newReservation(binding, staticAtCapacity)),
    ).resolves.toEqual({ kind: 'existing', record: reserved.record });

    await expect(
      store.reserve(
        newReservation(binding, [...staticAtCapacity, newBinding()]),
      ),
    ).resolves.toEqual({ kind: 'capacity-reached' });
  });

  it('marks only the exact reservation ready and keeps an exact ready retry unchanged', async () => {
    const binding = newBinding();
    createdRoomIds.push(binding.roomId);
    const reserved = await store.reserve(newReservation(binding));
    expect(reserved.kind).toBe('reserved');

    const readyAt = new Date('2026-10-20T12:30:00.000Z');
    const ready = await store.markReady(binding, readyAt);
    expect(ready.status).toBe('ready');
    expect(ready.readyAt).toEqual(readyAt);
    await expect(
      store.markReady(binding, new Date('2026-10-20T12:40:00.000Z')),
    ).resolves.toEqual(ready);
  });

  it('rejects static collisions and dynamic collection reuse', async () => {
    const staticBinding = newBinding();
    const roomCollision = newBinding();
    roomCollision.roomId = staticBinding.roomId;
    const calendarCollision = newBinding();
    calendarCollision.calendarId = staticBinding.calendarId;

    await expect(
      store.reserve(newReservation(staticBinding, [staticBinding])),
    ).resolves.toEqual({ kind: 'static-conflict' });
    await expect(
      store.reserve(newReservation(roomCollision, [staticBinding])),
    ).resolves.toEqual({ kind: 'static-conflict' });
    await expect(
      store.reserve(newReservation(calendarCollision, [staticBinding])),
    ).resolves.toEqual({ kind: 'static-conflict' });

    const persisted = newBinding();
    const reusedCalendar = {
      ...newBinding(),
      calendarId: persisted.calendarId,
    };
    createdRoomIds.push(persisted.roomId);
    await expect(
      store.reserve(newReservation(persisted)),
    ).resolves.toMatchObject({ kind: 'reserved' });
    await expect(
      store.reserve(newReservation(reusedCalendar)),
    ).resolves.toEqual({ kind: 'collection-conflict' });
  });

  it('counts static bindings and pending rows against the shared total cap', async () => {
    const existingRows = await store.listAll();
    const staticCount =
      ROOM_CALENDAR_BINDING_LIMITS.maxConfiguredBindings -
      existingRows.length -
      1;
    if (staticCount < 0) {
      throw new Error(
        'The isolated binding test database is already at capacity',
      );
    }
    const staticBindings = Array.from({ length: staticCount }, () =>
      newBinding(),
    );
    const atCapacity = newBinding();
    const beyondCapacity = newBinding();
    createdRoomIds.push(atCapacity.roomId);

    await expect(
      store.reserve(newReservation(atCapacity, staticBindings)),
    ).resolves.toMatchObject({ kind: 'reserved' });
    await expect(
      store.reserve(newReservation(beyondCapacity, staticBindings)),
    ).resolves.toEqual({ kind: 'capacity-reached' });
  });
});
