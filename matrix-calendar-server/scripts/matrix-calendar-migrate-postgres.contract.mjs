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

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

const serverRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const toolPath = path.join(
  serverRoot,
  'scripts/matrix-calendar-migrate-postgres.mjs',
);
const testDatabaseName = 'matrix_calendar_migration_tool_test';
const testRole = 'matrix_calendar_app';
const databaseUrl =
  process.env.MATRIX_CALENDAR_MIGRATION_TOOL_TEST_DATABASE_URL;
const tlsMode = 'trusted-private-network';
const stores = Object.freeze({
  reminders: {
    url: 'MATRIX_CALENDAR_REMINDER_DATABASE_URL',
    tls: 'MATRIX_CALENDAR_REMINDER_DATABASE_TLS_MODE',
    schema: 'matrix_calendar',
    version: 4,
  },
  bindings: {
    url: 'MATRIX_CALENDAR_BINDING_DATABASE_URL',
    tls: 'MATRIX_CALENDAR_BINDING_DATABASE_TLS_MODE',
    schema: 'matrix_calendar_bindings',
    version: 1,
  },
  'private-clients': {
    url: 'MATRIX_CALENDAR_PRIVATE_CLIENT_DATABASE_URL',
    tls: 'MATRIX_CALENDAR_PRIVATE_CLIENT_DATABASE_TLS_MODE',
    schema: 'matrix_calendar_private_clients',
    version: 2,
  },
});

function fail(reason) {
  process.stderr.write(
    `PostgreSQL migration CLI contract failed: ${reason}.\n`,
  );
  process.exitCode = 1;
}

function assertCliText(actual, expected) {
  if (actual.trim() !== expected) {
    throw new Error('Unexpected migration CLI output.');
  }
}

function validateDisposableDatabaseUrl(value) {
  try {
    const parsed = new URL(value);
    if (
      !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
      !['localhost', '127.0.0.1', '::1'].includes(parsed.hostname) ||
      parsed.pathname.slice(1) !== testDatabaseName ||
      decodeURIComponent(parsed.username) !== testRole ||
      parsed.search !== '' ||
      parsed.hash !== '' ||
      !/^\d{1,5}$/u.test(parsed.port) ||
      Number(parsed.port) < 1 ||
      Number(parsed.port) > 65_535
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function makeChildEnvironment(
  storeNames,
  privateClientsEnabled = false,
  overrides = {},
) {
  const environment = { PATH: process.env.PATH };
  for (const storeName of storeNames) {
    const configuration = stores[storeName];
    environment[configuration.url] = databaseUrl;
    environment[configuration.tls] = tlsMode;
  }
  if (privateClientsEnabled) {
    environment.MATRIX_CALENDAR_PRIVATE_CLIENTS_ENABLED = 'true';
  }
  return { ...environment, ...overrides };
}

function runCli(
  storeSelector,
  storeNames,
  privateClientsEnabled = false,
  overrides = {},
) {
  const args = [
    toolPath,
    '--runtime-root',
    serverRoot,
    '--store',
    storeSelector,
  ];
  const result = spawnSync(process.execPath, args, {
    encoding: 'utf8',
    timeout: 15_000,
    env: makeChildEnvironment(storeNames, privateClientsEnabled, overrides),
    maxBuffer: 64 * 1024,
  });

  assert.equal(result.error, undefined, 'The migration process must exit');
  return result;
}

function createTestPostgresClient() {
  const serverRequire = createRequire(path.join(serverRoot, 'package.json'));
  const postgresModule = serverRequire('postgres');
  const postgres = postgresModule.default ?? postgresModule;
  const tlsModule = serverRequire(
    path.join(serverRoot, 'lib/src/reminder/ReminderDatabaseConnection.js'),
  );
  return postgres(databaseUrl, {
    ...tlsModule.getPostgresDatabaseTlsOptions(tlsMode, databaseUrl),
    max: 1,
    connect_timeout: 5,
    idle_timeout: 5,
    connection: { application_name: 'matrix-calendar-migration-contract' },
    onnotice: () => undefined,
  });
}

async function verifyIsolatedDatabase(sql) {
  const [database] = await sql`
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

  assert.equal(database?.name, testDatabaseName);
  assert.equal(database?.role, testRole);
  assert.equal(database?.owner, testRole);
  assert.equal(database?.is_superuser, false);
  assert.equal(database?.can_create_database, false);
  assert.equal(database?.can_create_role, false);
  assert.equal(database?.can_connect_postgres, false);
  assert.equal(database?.can_connect_template1, false);
}

async function resetSchemas(sql) {
  for (const schema of Object.values(stores).map(({ schema }) => schema)) {
    await sql`DROP SCHEMA IF EXISTS ${sql(schema)} CASCADE`;
  }
}

async function readSchemas(sql) {
  const rows = await sql`
    SELECT schema_name
    FROM information_schema.schemata
    WHERE schema_name IN (
      'matrix_calendar',
      'matrix_calendar_bindings',
      'matrix_calendar_private_clients'
    )
    ORDER BY schema_name
  `;
  return rows.map(({ schema_name }) => schema_name);
}

async function readMigrationState(sql, storeName) {
  const schema = stores[storeName].schema;
  const [row] = await sql`
    SELECT COUNT(*)::int AS count, MAX(version)::int AS version
    FROM ${sql(schema)}.schema_migrations
  `;
  return { count: row.count, version: row.version };
}

async function assertStoreMigration(sql, storeName) {
  const state = await readMigrationState(sql, storeName);
  assert.equal(state.version, stores[storeName].version);
  assert.equal(state.count, stores[storeName].version);
}

async function assertNoOpenMigrationConnections(sql) {
  const [activity] = await sql`
    SELECT COUNT(*)::int AS count
    FROM pg_stat_activity
    WHERE datname = current_database()
      AND pid <> pg_backend_pid()
      AND application_name IN (
        'matrix-calendar-reminders',
        'matrix-calendar-bindings',
        'matrix-calendar-private-clients'
      )
  `;
  assert.equal(activity.count, 0);
}

async function runContract() {
  if (!databaseUrl) {
    fail('an explicitly configured disposable database URL is required');
    return;
  }
  if (!validateDisposableDatabaseUrl(databaseUrl)) {
    fail('the database URL must select the local migration-tool test database');
    return;
  }

  const sql = createTestPostgresClient();
  try {
    await verifyIsolatedDatabase(sql);
    await resetSchemas(sql);

    const malformedAllStoreUrl = runCli('all', Object.keys(stores), true, {
      [stores.bindings.url]: 'postgresql://db.example.test/calendar name',
    });
    assert.equal(malformedAllStoreUrl.status, 1);
    assert.equal(malformedAllStoreUrl.signal, null);
    assertCliText(malformedAllStoreUrl.stdout, '');
    assertCliText(
      malformedAllStoreUrl.stderr,
      'PostgreSQL migration failed for bindings at configuration.',
    );
    assert.deepEqual(await readSchemas(sql), []);
    await assertNoOpenMigrationConnections(sql);

    const remindersFirst = runCli('reminders', ['reminders']);
    assert.equal(remindersFirst.status, 0);
    assert.equal(remindersFirst.signal, null);
    assertCliText(
      remindersFirst.stdout,
      'PostgreSQL migration succeeded for reminders.',
    );
    assertCliText(remindersFirst.stderr, '');
    assert.deepEqual(await readSchemas(sql), ['matrix_calendar']);
    await assertStoreMigration(sql, 'reminders');

    const remindersSecond = runCli('reminders', ['reminders']);
    assert.equal(remindersSecond.status, 0);
    assertCliText(
      remindersSecond.stdout,
      'PostgreSQL migration succeeded for reminders.',
    );
    assertCliText(remindersSecond.stderr, '');
    await assertStoreMigration(sql, 'reminders');
    assert.deepEqual(await readSchemas(sql), ['matrix_calendar']);

    const bindings = runCli('bindings', ['bindings']);
    assert.equal(bindings.status, 0);
    assertCliText(
      bindings.stdout,
      'PostgreSQL migration succeeded for bindings.',
    );
    assertCliText(bindings.stderr, '');
    assert.deepEqual(await readSchemas(sql), [
      'matrix_calendar',
      'matrix_calendar_bindings',
    ]);
    await assertStoreMigration(sql, 'bindings');

    const privateClients = runCli('private-clients', ['private-clients'], true);
    assert.equal(privateClients.status, 0);
    assertCliText(
      privateClients.stdout,
      'PostgreSQL migration succeeded for private-clients.',
    );
    assertCliText(privateClients.stderr, '');
    assert.deepEqual(await readSchemas(sql), [
      'matrix_calendar',
      'matrix_calendar_bindings',
      'matrix_calendar_private_clients',
    ]);
    await assertStoreMigration(sql, 'private-clients');

    const all = runCli(
      'all',
      ['reminders', 'bindings', 'private-clients'],
      true,
    );
    assert.equal(all.status, 0);
    assertCliText(
      all.stdout,
      [
        'PostgreSQL migration succeeded for reminders.',
        'PostgreSQL migration succeeded for bindings.',
        'PostgreSQL migration succeeded for private-clients.',
      ].join('\n'),
    );
    assertCliText(all.stderr, '');
    for (const storeName of Object.keys(stores)) {
      await assertStoreMigration(sql, storeName);
    }

    await sql`
      INSERT INTO matrix_calendar_bindings.schema_migrations (version)
      VALUES (999999)
    `;
    const futureSchema = runCli('bindings', ['bindings']);
    assert.equal(futureSchema.status, 1);
    assert.equal(futureSchema.signal, null);
    assertCliText(
      futureSchema.stderr,
      'PostgreSQL migration failed for bindings at migration.',
    );
    assert.equal(futureSchema.stderr.includes(databaseUrl), false);
    await assertNoOpenMigrationConnections(sql);
    const bindingState = await readMigrationState(sql, 'bindings');
    assert.equal(bindingState.version, 999999);
    assert.equal(bindingState.count, 2);
  } finally {
    await resetSchemas(sql);
    await sql.end({ timeout: 5 });
  }
}

runContract().catch(() => {
  fail('the isolated database contract did not complete');
});
