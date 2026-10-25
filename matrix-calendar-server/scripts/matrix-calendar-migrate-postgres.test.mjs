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
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { after, test } from 'node:test';
import { runMigrationCli } from './matrix-calendar-migrate-postgres.mjs';

const temporaryDirectories = [];
const testDatabaseUrl =
  'postgresql://migration-user:synthetic-secret@db.example.test:5432/test';

function writeModule(root, relativePath, content) {
  const filePath = path.join(root, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
}

function createFakeRuntime() {
  const root = mkdtempSync(path.join(tmpdir(), 'mcw-migration-cli-'));
  temporaryDirectories.push(root);

  writeModule(
    root,
    'node_modules/postgres/index.js',
    `const fs = require('node:fs');
const log = (record) => fs.appendFileSync(process.env.MCW_MIGRATION_TEST_LOG, JSON.stringify(record) + '\\n');
module.exports = (databaseUrl, options) => {
  log({ event: 'pool-open', applicationName: options.connection.application_name, options });
  return { end: async () => log({ event: 'pool-end', applicationName: options.connection.application_name }) };
};
`,
  );

  writeModule(
    root,
    'lib/src/reminder/ReminderDatabaseConnection.js',
    `exports.getPostgresDatabaseTlsOptions = (mode) => {
  if (process.env.MCW_MIGRATION_TEST_TLS_FAILURE === 'true') {
    throw new Error(process.env.MCW_MIGRATION_TEST_DETAIL);
  }
  return { ssl: mode === 'verify-full' ? 'verify-full' : false };
};
`,
  );

  const modules = [
    [
      'lib/src/reminder/PostgresRoomReminderStore.js',
      'PostgresRoomReminderStore',
      'reminders',
    ],
    [
      'lib/src/service/PostgresRoomCalendarBindingStore.js',
      'PostgresRoomCalendarBindingStore',
      'bindings',
    ],
    [
      'lib/src/service/PostgresPrivateCalendarClientStore.js',
      'PostgresPrivateCalendarClientStore',
      'private-clients',
    ],
  ];

  for (const [modulePath, className, storeName] of modules) {
    writeModule(
      root,
      modulePath,
      `const fs = require('node:fs');
const log = (record) => fs.appendFileSync(process.env.MCW_MIGRATION_TEST_LOG, JSON.stringify(record) + '\\n');
class ${className} {
  constructor(sql) { this.sql = sql; }
  async migrate() {
    log({ event: 'migrate', store: '${storeName}' });
    if (process.env.MCW_MIGRATION_TEST_FAIL === '${storeName}') {
      throw new Error('synthetic driver detail ' + process.env.MCW_MIGRATION_TEST_DETAIL);
    }
  }
  async onApplicationShutdown() {
    log({ event: 'shutdown', store: '${storeName}' });
    await this.sql.end();
  }
}
exports.${className} = ${className};
`,
    );
  }

  return root;
}

function parseLog(logPath) {
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function runCli(runtimeRoot, logPath, args, environment = {}) {
  const oldLogPath = process.env.MCW_MIGRATION_TEST_LOG;
  const oldTlsFailure = process.env.MCW_MIGRATION_TEST_TLS_FAILURE;
  const oldMigrationFailure = process.env.MCW_MIGRATION_TEST_FAIL;
  const oldFailureDetail = process.env.MCW_MIGRATION_TEST_DETAIL;
  process.env.MCW_MIGRATION_TEST_LOG = logPath;

  if (environment.MCW_MIGRATION_TEST_TLS_FAILURE === undefined) {
    delete process.env.MCW_MIGRATION_TEST_TLS_FAILURE;
  } else {
    process.env.MCW_MIGRATION_TEST_TLS_FAILURE =
      environment.MCW_MIGRATION_TEST_TLS_FAILURE;
  }
  if (environment.MCW_MIGRATION_TEST_FAIL === undefined) {
    delete process.env.MCW_MIGRATION_TEST_FAIL;
  } else {
    process.env.MCW_MIGRATION_TEST_FAIL = environment.MCW_MIGRATION_TEST_FAIL;
  }
  if (environment.MCW_MIGRATION_TEST_DETAIL === undefined) {
    delete process.env.MCW_MIGRATION_TEST_DETAIL;
  } else {
    process.env.MCW_MIGRATION_TEST_DETAIL =
      environment.MCW_MIGRATION_TEST_DETAIL;
  }

  let stdout = '';
  let stderr = '';
  try {
    const status = await runMigrationCli(
      ['--runtime-root', runtimeRoot, ...args],
      environment,
      {
        stdout: { write: (chunk) => (stdout += chunk) },
        stderr: { write: (chunk) => (stderr += chunk) },
      },
    );
    return { status, stdout, stderr };
  } finally {
    if (oldLogPath === undefined) {
      delete process.env.MCW_MIGRATION_TEST_LOG;
    } else {
      process.env.MCW_MIGRATION_TEST_LOG = oldLogPath;
    }
    if (oldTlsFailure === undefined) {
      delete process.env.MCW_MIGRATION_TEST_TLS_FAILURE;
    } else {
      process.env.MCW_MIGRATION_TEST_TLS_FAILURE = oldTlsFailure;
    }
    if (oldMigrationFailure === undefined) {
      delete process.env.MCW_MIGRATION_TEST_FAIL;
    } else {
      process.env.MCW_MIGRATION_TEST_FAIL = oldMigrationFailure;
    }
    if (oldFailureDetail === undefined) {
      delete process.env.MCW_MIGRATION_TEST_DETAIL;
    } else {
      process.env.MCW_MIGRATION_TEST_DETAIL = oldFailureDetail;
    }
  }
}

function baseEnvironment() {
  return {
    MATRIX_CALENDAR_REMINDER_DATABASE_URL: testDatabaseUrl,
    MATRIX_CALENDAR_REMINDER_DATABASE_TLS_MODE: 'trusted-private-network',
  };
}

test('argument and selected-store preflight failures do not create a pool', async () => {
  const runtimeRoot = createFakeRuntime();
  const logPath = path.join(runtimeRoot, 'events.jsonl');
  const cases = [
    {
      args: [],
      environment: baseEnvironment(),
      message: 'PostgreSQL migration failed at arguments.',
    },
    {
      args: ['--dry-run'],
      environment: baseEnvironment(),
      message: 'PostgreSQL migration failed at arguments.',
    },
    {
      args: ['--store', 'reminders', '--store', 'unknown'],
      environment: baseEnvironment(),
      message: 'PostgreSQL migration failed at arguments.',
    },
    {
      args: ['--store', 'reminders', '--store', 'reminders'],
      environment: baseEnvironment(),
      message: 'PostgreSQL migration failed at arguments.',
    },
    {
      args: ['--store', 'all', '--store', 'reminders'],
      environment: baseEnvironment(),
      message: 'PostgreSQL migration failed at arguments.',
    },
    {
      args: ['--store', 'reminders'],
      environment: {},
      message: 'PostgreSQL migration failed for reminders at configuration.',
    },
    {
      args: ['--store', 'reminders'],
      environment: {
        ...baseEnvironment(),
        MATRIX_CALENDAR_REMINDER_DATABASE_URL: 'not-a-postgres-url',
      },
      message: 'PostgreSQL migration failed for reminders at configuration.',
    },
    {
      args: ['--store', 'reminders'],
      environment: {
        ...baseEnvironment(),
        MATRIX_CALENDAR_REMINDER_DATABASE_TLS_MODE: 'prefer',
      },
      message: 'PostgreSQL migration failed for reminders at configuration.',
    },
    {
      args: ['--store', 'private-clients'],
      environment: {
        MATRIX_CALENDAR_PRIVATE_CLIENT_DATABASE_URL: testDatabaseUrl,
        MATRIX_CALENDAR_PRIVATE_CLIENT_DATABASE_TLS_MODE:
          'trusted-private-network',
      },
      message:
        'PostgreSQL migration failed for private-clients at configuration.',
    },
  ];

  for (const { args, environment, message } of cases) {
    const result = await runCli(runtimeRoot, logPath, args, environment);
    assert.equal(result.status, 1);
    assert.equal(result.stderr.trim(), message);
    assert.deepEqual(parseLog(logPath), []);
  }
});

test('selected store migration ignores unrelated database configuration', async () => {
  const runtimeRoot = createFakeRuntime();
  const logPath = path.join(runtimeRoot, 'events.jsonl');
  rmSync(
    path.join(
      runtimeRoot,
      'lib/src/service/PostgresRoomCalendarBindingStore.js',
    ),
  );
  rmSync(
    path.join(
      runtimeRoot,
      'lib/src/service/PostgresPrivateCalendarClientStore.js',
    ),
  );
  const result = await runCli(runtimeRoot, logPath, ['--store', 'reminders'], {
    ...baseEnvironment(),
    MATRIX_CALENDAR_BINDING_DATABASE_URL: 'not-a-database-url',
    MATRIX_CALENDAR_BINDING_DATABASE_TLS_MODE: 'unsupported',
    MATRIX_CALENDAR_PRIVATE_CLIENT_DATABASE_URL: testDatabaseUrl,
    MATRIX_CALENDAR_PRIVATE_CLIENT_DATABASE_TLS_MODE: 'unsupported',
    MATRIX_CALENDAR_PRIVATE_CLIENTS_ENABLED: 'false',
  });

  assert.equal(result.status, 0);
  assert.equal(
    result.stdout.trim(),
    'PostgreSQL migration succeeded for reminders.',
  );
  assert.equal(result.stderr, '');
  assert.deepEqual(
    parseLog(logPath).map(({ event, store, applicationName }) =>
      event === 'pool-open' ? [event, applicationName] : [event, store],
    ),
    [
      ['pool-open', 'matrix-calendar-reminders'],
      ['migrate', 'reminders'],
      ['shutdown', 'reminders'],
      ['pool-end', undefined],
    ],
  );
  const poolOptions = parseLog(logPath)[0].options;
  assert.equal(poolOptions.max, 5);
  assert.equal(poolOptions.connect_timeout, 5);
  assert.equal(poolOptions.idle_timeout, 20);
  assert.deepEqual(poolOptions.connection, {
    application_name: 'matrix-calendar-reminders',
  });
  assert.equal(poolOptions.ssl, false);
});

test('all is explicit, requires private-client enablement, and runs stores sequentially', async () => {
  const runtimeRoot = createFakeRuntime();
  const logPath = path.join(runtimeRoot, 'events.jsonl');
  const environment = {
    ...baseEnvironment(),
    MATRIX_CALENDAR_BINDING_DATABASE_URL: testDatabaseUrl,
    MATRIX_CALENDAR_BINDING_DATABASE_TLS_MODE: 'verify-full',
    MATRIX_CALENDAR_PRIVATE_CLIENT_DATABASE_URL: testDatabaseUrl,
    MATRIX_CALENDAR_PRIVATE_CLIENT_DATABASE_TLS_MODE: 'verify-full',
  };

  const refused = await runCli(
    runtimeRoot,
    logPath,
    ['--store', 'all'],
    environment,
  );
  assert.equal(refused.status, 1);
  assert.equal(
    refused.stderr.trim(),
    'PostgreSQL migration failed for private-clients at configuration.',
  );
  assert.deepEqual(parseLog(logPath), []);

  const result = await runCli(runtimeRoot, logPath, ['--store', 'all'], {
    ...environment,
    MATRIX_CALENDAR_PRIVATE_CLIENTS_ENABLED: 'TRUE',
  });
  assert.equal(result.status, 0);
  assert.equal(
    result.stdout.trim(),
    [
      'PostgreSQL migration succeeded for reminders.',
      'PostgreSQL migration succeeded for bindings.',
      'PostgreSQL migration succeeded for private-clients.',
    ].join('\n'),
  );
  const log = parseLog(logPath);
  assert.deepEqual(
    log.filter(({ event }) => event === 'migrate').map(({ store }) => store),
    ['reminders', 'bindings', 'private-clients'],
  );
  assert.equal(log.filter(({ event }) => event === 'pool-open').length, 3);
  assert.equal(log.filter(({ event }) => event === 'pool-end').length, 3);
  assert.deepEqual(log[0].options.connection, {
    application_name: 'matrix-calendar-reminders',
  });
  assert.deepEqual(log[4].options.connection, {
    application_name: 'matrix-calendar-bindings',
    statement_timeout: 5_000,
  });
  assert.deepEqual(log[8].options.connection, {
    application_name: 'matrix-calendar-private-clients',
    statement_timeout: 5_000,
  });
});

test('migration failures close the selected pool and omit driver details', async () => {
  const runtimeRoot = createFakeRuntime();
  const logPath = path.join(runtimeRoot, 'events.jsonl');
  const result = await runCli(runtimeRoot, logPath, ['--store', 'reminders'], {
    ...baseEnvironment(),
    MCW_MIGRATION_TEST_FAIL: 'reminders',
    MCW_MIGRATION_TEST_DETAIL: testDatabaseUrl,
  });

  assert.equal(result.status, 1);
  assert.equal(
    result.stderr.trim(),
    'PostgreSQL migration failed for reminders at migration.',
  );
  assert.equal(result.stderr.includes('synthetic driver detail'), false);
  assert.equal(result.stderr.includes(testDatabaseUrl), false);
  assert.deepEqual(
    parseLog(logPath).map(({ event, store }) => [event, store]),
    [
      ['pool-open', undefined],
      ['migrate', 'reminders'],
      ['shutdown', 'reminders'],
      ['pool-end', undefined],
    ],
  );
});

test('TLS helper failures are sanitized before any pool is created', async () => {
  const runtimeRoot = createFakeRuntime();
  const logPath = path.join(runtimeRoot, 'events.jsonl');
  const result = await runCli(runtimeRoot, logPath, ['--store', 'reminders'], {
    ...baseEnvironment(),
    MCW_MIGRATION_TEST_TLS_FAILURE: 'true',
    MCW_MIGRATION_TEST_DETAIL: testDatabaseUrl,
  });

  assert.equal(result.status, 1);
  assert.equal(
    result.stderr.trim(),
    'PostgreSQL migration failed for reminders at configuration.',
  );
  assert.equal(result.stderr.includes(testDatabaseUrl), false);
  assert.deepEqual(parseLog(logPath), []);
});

after(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
});
