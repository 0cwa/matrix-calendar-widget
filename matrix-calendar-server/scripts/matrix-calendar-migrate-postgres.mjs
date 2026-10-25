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

import { statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const DEFAULT_RUNTIME_ROOT = '/app';
const TLS_MODES = new Set(['verify-full', 'trusted-private-network']);
const USAGE =
  'Usage: node matrix-calendar-migrate-postgres.mjs --store <reminders|bindings|private-clients|all> [--store <store>] [--runtime-root <absolute-path>]';

const STORE_DEFINITIONS = Object.freeze({
  reminders: Object.freeze({
    urlVariable: 'MATRIX_CALENDAR_REMINDER_DATABASE_URL',
    tlsVariable: 'MATRIX_CALENDAR_REMINDER_DATABASE_TLS_MODE',
    applicationName: 'matrix-calendar-reminders',
    maxConnections: 5,
    statementTimeout: undefined,
    storeModule: 'lib/src/reminder/PostgresRoomReminderStore.js',
    storeClass: 'PostgresRoomReminderStore',
  }),
  bindings: Object.freeze({
    urlVariable: 'MATRIX_CALENDAR_BINDING_DATABASE_URL',
    tlsVariable: 'MATRIX_CALENDAR_BINDING_DATABASE_TLS_MODE',
    applicationName: 'matrix-calendar-bindings',
    maxConnections: 3,
    statementTimeout: 5_000,
    storeModule: 'lib/src/service/PostgresRoomCalendarBindingStore.js',
    storeClass: 'PostgresRoomCalendarBindingStore',
  }),
  'private-clients': Object.freeze({
    urlVariable: 'MATRIX_CALENDAR_PRIVATE_CLIENT_DATABASE_URL',
    tlsVariable: 'MATRIX_CALENDAR_PRIVATE_CLIENT_DATABASE_TLS_MODE',
    applicationName: 'matrix-calendar-private-clients',
    maxConnections: 3,
    statementTimeout: 5_000,
    storeModule: 'lib/src/service/PostgresPrivateCalendarClientStore.js',
    storeClass: 'PostgresPrivateCalendarClientStore',
    enabledVariable: 'MATRIX_CALENDAR_PRIVATE_CLIENTS_ENABLED',
  }),
});

class MigrationCliFailure extends Error {
  constructor(stage, store) {
    super();
    this.stage = stage;
    this.store = store;
  }
}

function parseArguments(argv) {
  let runtimeRoot = DEFAULT_RUNTIME_ROOT;
  let runtimeRootSeen = false;
  let help = false;
  const requestedStores = [];

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help') {
      help = true;
      continue;
    }

    if (argument === '--runtime-root') {
      if (runtimeRootSeen || index + 1 >= argv.length) {
        throw new MigrationCliFailure('arguments');
      }
      runtimeRootSeen = true;
      runtimeRoot = argv[index + 1];
      index += 1;
      continue;
    }

    if (argument === '--store') {
      if (index + 1 >= argv.length || argv[index + 1].startsWith('--')) {
        throw new MigrationCliFailure('arguments');
      }
      requestedStores.push(argv[index + 1]);
      index += 1;
      continue;
    }

    throw new MigrationCliFailure('arguments');
  }

  if (help) {
    if (argv.length !== 1 || argv[0] !== '--help') {
      throw new MigrationCliFailure('arguments');
    }
    return { help: true };
  }

  if (
    typeof runtimeRoot !== 'string' ||
    runtimeRoot.length === 0 ||
    !path.isAbsolute(runtimeRoot) ||
    requestedStores.length === 0
  ) {
    throw new MigrationCliFailure('arguments');
  }

  if (requestedStores.includes('all')) {
    if (requestedStores.length !== 1) {
      throw new MigrationCliFailure('arguments');
    }
    return {
      help: false,
      runtimeRoot: path.resolve(runtimeRoot),
      stores: Object.keys(STORE_DEFINITIONS),
    };
  }

  const seenStores = new Set();
  for (const store of requestedStores) {
    if (!Object.hasOwn(STORE_DEFINITIONS, store) || seenStores.has(store)) {
      throw new MigrationCliFailure('arguments');
    }
    seenStores.add(store);
  }

  return {
    help: false,
    runtimeRoot: path.resolve(runtimeRoot),
    stores: requestedStores,
  };
}

function hasPostgresHost(databaseUrl) {
  const match =
    /^(?:postgres|postgresql):\/\/([^/?#]+)(?:\/[^?#]*)?(?:\?[^#]*)?$/iu.exec(
      databaseUrl,
    );
  if (!match) return false;

  const authority = match[1];
  const hosts = authority.slice(authority.lastIndexOf('@') + 1).split(',');
  if (hosts.length === 0) return false;

  return hosts.every((hostPort) => {
    if (!hostPort) return false;

    const ipv6Match = /^\[([0-9a-f:.]+)\](?::(\d{1,5}))?$/iu.exec(hostPort);
    if (ipv6Match) {
      const port = ipv6Match[2];
      return port === undefined || isValidPort(port);
    }

    const hostMatch = /^([^:[\],\s/?#@]+)(?::(\d{1,5}))?$/u.exec(hostPort);
    return Boolean(
      hostMatch && (hostMatch[2] === undefined || isValidPort(hostMatch[2])),
    );
  });
}

function isValidPostgresDatabaseUrl(databaseUrl, databaseUrlSchema) {
  // Joi's URI rule accepts malformed percent escapes such as `%ZZ`.
  if (/%(?![0-9a-f]{2})/iu.test(databaseUrl)) return false;

  const { error } = databaseUrlSchema.validate(databaseUrl, {
    convert: false,
  });
  return !error && hasPostgresHost(databaseUrl);
}

function isValidPort(port) {
  const numericPort = Number(port);
  return numericPort >= 1 && numericPort <= 65_535;
}

function readStoreConfiguration(storeName, environment) {
  const definition = STORE_DEFINITIONS[storeName];
  const databaseUrl = environment[definition.urlVariable];
  const tlsMode = environment[definition.tlsVariable] ?? 'verify-full';

  if (
    typeof databaseUrl !== 'string' ||
    databaseUrl.trim().length === 0 ||
    !TLS_MODES.has(tlsMode) ||
    (definition.enabledVariable &&
      environment[definition.enabledVariable]?.toLowerCase() !== 'true')
  ) {
    throw new MigrationCliFailure('configuration', storeName);
  }

  return { name: storeName, definition, databaseUrl, tlsMode };
}

function loadRuntime(runtimeRoot, stores) {
  try {
    if (!statSync(runtimeRoot).isDirectory()) {
      throw new Error();
    }

    const runtimeRequire = createRequire(
      path.join(runtimeRoot, 'package.json'),
    );
    const postgresModule = runtimeRequire('postgres');
    const postgres = postgresModule.default ?? postgresModule;
    if (typeof postgres !== 'function') {
      throw new Error();
    }

    const validationSchema = runtimeRequire(
      path.join(runtimeRoot, 'lib/src/configuration.js'),
    ).ValidationSchema;
    if (typeof validationSchema?.extract !== 'function') {
      throw new Error();
    }
    const databaseUrlSchemas = new Map();
    for (const storeName of stores) {
      const definition = STORE_DEFINITIONS[storeName];
      const databaseUrlSchema = validationSchema.extract(
        definition.urlVariable,
      );
      if (typeof databaseUrlSchema?.validate !== 'function') {
        throw new Error();
      }
      databaseUrlSchemas.set(storeName, databaseUrlSchema);
    }

    const tlsModule = runtimeRequire(
      path.join(runtimeRoot, 'lib/src/reminder/ReminderDatabaseConnection.js'),
    );
    if (typeof tlsModule.getPostgresDatabaseTlsOptions !== 'function') {
      throw new Error();
    }

    const storeConstructors = new Map();
    for (const storeName of stores) {
      const definition = STORE_DEFINITIONS[storeName];
      const storeModule = runtimeRequire(
        path.join(runtimeRoot, definition.storeModule),
      );
      const Store = storeModule[definition.storeClass];
      if (
        typeof Store !== 'function' ||
        typeof Store.prototype.migrate !== 'function' ||
        typeof Store.prototype.onApplicationShutdown !== 'function'
      ) {
        throw new Error();
      }
      storeConstructors.set(storeName, Store);
    }

    return {
      postgres,
      databaseUrlSchemas,
      getPostgresDatabaseTlsOptions: tlsModule.getPostgresDatabaseTlsOptions,
      storeConstructors,
    };
  } catch {
    throw new MigrationCliFailure('runtime');
  }
}

function buildPostgresOptions(configuration, getPostgresDatabaseTlsOptions) {
  try {
    const tlsOptions = getPostgresDatabaseTlsOptions(
      configuration.tlsMode,
      configuration.databaseUrl,
    );
    const definition = configuration.definition;
    const connection = { application_name: definition.applicationName };
    if (definition.statementTimeout !== undefined) {
      connection.statement_timeout = definition.statementTimeout;
    }

    return {
      ...tlsOptions,
      max: definition.maxConnections,
      connect_timeout: 5,
      idle_timeout: 20,
      connection,
    };
  } catch {
    throw new MigrationCliFailure('configuration', configuration.name);
  }
}

function writeFailure(io, failure) {
  if (failure.store) {
    io.stderr.write(
      `PostgreSQL migration failed for ${failure.store} at ${failure.stage}.\n`,
    );
    return;
  }
  io.stderr.write(`PostgreSQL migration failed at ${failure.stage}.\n`);
}

export async function runMigrationCli(
  argv = process.argv.slice(2),
  environment = process.env,
  io = { stdout: process.stdout, stderr: process.stderr },
) {
  let arguments_;
  try {
    arguments_ = parseArguments(argv);
  } catch (error) {
    writeFailure(io, error);
    return 1;
  }

  if (arguments_.help) {
    io.stdout.write(`${USAGE}\n`);
    return 0;
  }

  let configurations;
  try {
    configurations = arguments_.stores.map((storeName) =>
      readStoreConfiguration(storeName, environment),
    );
  } catch (error) {
    writeFailure(io, error);
    return 1;
  }

  let runtime;
  try {
    runtime = loadRuntime(arguments_.runtimeRoot, arguments_.stores);
    configurations = configurations.map((configuration) => {
      if (
        !isValidPostgresDatabaseUrl(
          configuration.databaseUrl,
          runtime.databaseUrlSchemas.get(configuration.name),
        )
      ) {
        throw new MigrationCliFailure('configuration', configuration.name);
      }

      return {
        ...configuration,
        postgresOptions: buildPostgresOptions(
          configuration,
          runtime.getPostgresDatabaseTlsOptions,
        ),
      };
    });
  } catch (error) {
    writeFailure(
      io,
      error instanceof MigrationCliFailure
        ? error
        : new MigrationCliFailure('runtime'),
    );
    return 1;
  }

  for (const configuration of configurations) {
    const Store = runtime.storeConstructors.get(configuration.name);
    let sql;
    let store;
    let failure;

    try {
      sql = runtime.postgres(
        configuration.databaseUrl,
        configuration.postgresOptions,
      );
      store = new Store(sql);
    } catch {
      failure = new MigrationCliFailure('client setup', configuration.name);
    }

    if (!failure) {
      try {
        await store.migrate();
      } catch {
        failure = new MigrationCliFailure('migration', configuration.name);
      }
    }

    if (sql) {
      try {
        if (store) {
          await store.onApplicationShutdown();
        } else {
          await sql.end({ timeout: 5 });
        }
      } catch {
        failure = new MigrationCliFailure('shutdown', configuration.name);
      }
    }

    if (failure) {
      writeFailure(io, failure);
      return 1;
    }

    io.stdout.write(
      `PostgreSQL migration succeeded for ${configuration.name}.\n`,
    );
  }

  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  runMigrationCli()
    .then((exitCode) => {
      process.exitCode = exitCode;
      return exitCode;
    })
    .catch(() => {
      process.stderr.write('PostgreSQL migration failed at runtime.\n');
      process.exitCode = 1;
      return 1;
    });
}
