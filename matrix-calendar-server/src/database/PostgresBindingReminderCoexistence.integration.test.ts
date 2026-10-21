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
import { randomUUID } from 'crypto';
import { createReadStream, createWriteStream, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import postgres from 'postgres';
import { pipeline } from 'stream/promises';
import { PostgresRoomReminderStore } from '../reminder/PostgresRoomReminderStore';
import {
  getReminderDatabaseTlsOptions,
  parseReminderDatabaseTlsMode,
} from '../reminder/ReminderDatabaseConnection';
import { PostgresRoomCalendarBindingStore } from '../service/PostgresRoomCalendarBindingStore';

const bindingDatabaseUrl = process.env.MATRIX_CALENDAR_BINDING_DATABASE_URL;
const reminderDatabaseUrl = process.env.MATRIX_CALENDAR_REMINDER_DATABASE_URL;
const bindingDatabaseTlsMode = parseReminderDatabaseTlsMode(
  process.env.MATRIX_CALENDAR_BINDING_DATABASE_TLS_MODE,
);
const reminderDatabaseTlsMode = parseReminderDatabaseTlsMode(
  process.env.MATRIX_CALENDAR_REMINDER_DATABASE_TLS_MODE,
);
const describeWithDatabase =
  bindingDatabaseUrl && reminderDatabaseUrl ? describe : describe.skip;
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

  const versions = await sql<{ schema: string; version: number }[]>`
    SELECT 'matrix_calendar' AS schema, version
    FROM matrix_calendar.schema_migrations
    UNION ALL
    SELECT 'matrix_calendar_bindings' AS schema, version
    FROM matrix_calendar_bindings.schema_migrations
    ORDER BY schema
  `;
  expect(versions).toEqual([
    { schema: 'matrix_calendar', version: 4 },
    { schema: 'matrix_calendar_bindings', version: 1 },
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
});
