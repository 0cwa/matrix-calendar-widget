#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const require = createRequire(import.meta.url);
const COMPOSE_FILE = 'deploy/etke-sidecar.compose.yaml';
const GENERIC_FAILURE =
  'Sidecar preflight failed. Review required values in deploy/.env.local and optional server settings in deploy/.env.server; resolved values are never displayed.';

class PreflightError extends Error {
  constructor() {
    super(GENERIC_FAILURE);
  }
}

function fail() {
  throw new PreflightError();
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isEnabled(value) {
  return value === true;
}

function hasNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isSafeBaseUrl(value) {
  if (typeof value !== 'string' || value.trim() !== value) return false;

  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.username === '' &&
      url.password === '' &&
      url.search === '' &&
      url.hash === ''
    );
  } catch {
    return false;
  }
}

function loadServerValidators() {
  try {
    const serverValidators = {
      ValidationSchema:
        require('../matrix-calendar-server/lib/src/configuration.js')
          .ValidationSchema,
      parseRoomCalendarBindings:
        require('../matrix-calendar-server/lib/src/service/RoomCalendarBindingResolver.js')
          .parseRoomCalendarBindings,
      parseReminderDatabaseTlsMode:
        require('../matrix-calendar-server/lib/src/reminder/ReminderDatabaseConnection.js')
          .parseReminderDatabaseTlsMode,
      getReminderDatabaseTlsOptions:
        require('../matrix-calendar-server/lib/src/reminder/ReminderDatabaseConnection.js')
          .getReminderDatabaseTlsOptions,
    };

    // Importing this server helper loads matrix-bot-sdk, whose transitive
    // htmlencode import emits DEP0060. Suppress warnings only during that
    // import so CLI output remains fixed.
    const previousNoDeprecation = process.noDeprecation;
    let isSafeRoomCalendarServiceUserLocalpart;
    try {
      process.noDeprecation = true;
      isSafeRoomCalendarServiceUserLocalpart =
        require('../matrix-calendar-server/lib/src/service/RoomCalendarCalDavAccess.js').isSafeRoomCalendarServiceUserLocalpart;
    } finally {
      if (previousNoDeprecation === undefined) {
        delete process.noDeprecation;
      } else {
        process.noDeprecation = previousNoDeprecation;
      }
    }

    return {
      ...serverValidators,
      isSafeRoomCalendarServiceUserLocalpart,
      UserID: require('matrix-bot-sdk').UserID,
    };
  } catch {
    fail();
  }
}

function validateServiceUserId(userId, matrixServerName, validators) {
  if (!hasNonEmptyString(userId) || !hasNonEmptyString(matrixServerName)) {
    return false;
  }

  try {
    const parsed = new validators.UserID(userId);
    const delimiter = userId.indexOf(':');
    return (
      userId.startsWith('@') &&
      delimiter > 1 &&
      delimiter < userId.length - 1 &&
      parsed.localpart.length > 0 &&
      parsed.domain.length > 0 &&
      userId.slice(1, delimiter) === parsed.localpart &&
      userId.slice(delimiter + 1) === parsed.domain &&
      parsed.domain === matrixServerName &&
      validators.isSafeRoomCalendarServiceUserLocalpart(parsed.localpart)
    );
  } catch {
    return false;
  }
}

function withResolvedPgPort(resolvedPgPort, callback) {
  const previousPgPort = process.env.PGPORT;
  if (resolvedPgPort === undefined) {
    delete process.env.PGPORT;
  } else {
    process.env.PGPORT = String(resolvedPgPort);
  }

  try {
    return callback();
  } finally {
    if (previousPgPort === undefined) {
      delete process.env.PGPORT;
    } else {
      process.env.PGPORT = previousPgPort;
    }
  }
}

/** Validate only resolved Compose values and return a secret-free summary. */
export function validateSidecarComposeModel(model) {
  const validators = loadServerValidators();
  if (!isRecord(model) || !isRecord(model.services)) fail();

  const serverEnvironment = model.services.server?.environment;
  const radicaleEnvironment = model.services.radicale?.environment;
  if (!isRecord(serverEnvironment) || !isRecord(radicaleEnvironment)) fail();

  const { error, value } = validators.ValidationSchema.validate(
    serverEnvironment,
    { abortEarly: false, allowUnknown: true },
  );
  if (error) fail();

  let bindings;
  let databaseTlsMode;
  let databaseTlsOptions;
  try {
    bindings = validators.parseRoomCalendarBindings(
      value.ROOM_CALENDAR_BINDINGS,
    );
    databaseTlsMode = validators.parseReminderDatabaseTlsMode(
      value.MATRIX_CALENDAR_REMINDER_DATABASE_TLS_MODE,
    );
    if (value.MATRIX_CALENDAR_REMINDER_DATABASE_URL !== undefined) {
      databaseTlsOptions = withResolvedPgPort(value.PGPORT, () =>
        validators.getReminderDatabaseTlsOptions(
          databaseTlsMode,
          value.MATRIX_CALENDAR_REMINDER_DATABASE_URL,
        ),
      );
    }
  } catch {
    fail();
  }

  const roomAccessEnabled = isEnabled(value.ROOM_CALENDAR_ACCESS_ENABLED);
  const roomWritesEnabled = isEnabled(value.ROOM_CALENDAR_EVENT_WRITES_ENABLED);
  const reminderConfigurationEnabled = isEnabled(
    value.MATRIX_CALENDAR_REMINDER_CONFIGURATION_ENABLED,
  );
  const reminderDeliveryEnabled = isEnabled(
    value.ROOM_CALENDAR_REMINDER_DELIVERY_ENABLED,
  );
  const remindersEnabled =
    reminderConfigurationEnabled || reminderDeliveryEnabled;

  if (roomWritesEnabled && !roomAccessEnabled) fail();

  if (roomAccessEnabled) {
    if (
      bindings.length !== 1 ||
      !hasNonEmptyString(value.MATRIX_APPLICATION_SERVICE_TOKEN) ||
      !validateServiceUserId(
        value.MATRIX_APPLICATION_SERVICE_USER_ID,
        radicaleEnvironment.RADICALE_MATRIX_SERVER_NAME,
        validators,
      ) ||
      !isSafeBaseUrl(value.HOMESERVER_URL) ||
      !isSafeBaseUrl(value.RADICALE_URL) ||
      !isSafeBaseUrl(radicaleEnvironment.RADICALE_MATRIX_HOMESERVER_URL) ||
      value.HOMESERVER_URL !==
        radicaleEnvironment.RADICALE_MATRIX_HOMESERVER_URL
    ) {
      fail();
    }
  }

  if (
    remindersEnabled &&
    (!roomAccessEnabled ||
      value.MATRIX_CALENDAR_REMINDER_DATABASE_URL === undefined)
  ) {
    fail();
  }

  return Object.freeze({
    roomAccessEnabled,
    roomWritesEnabled,
    reminderConfigurationEnabled,
    reminderDeliveryEnabled,
    actionMessagesEnabled: isEnabled(
      value.ROOM_CALENDAR_ACTION_MESSAGES_ENABLED,
    ),
    bindingCount: bindings.length,
    reminderDatabaseConfigured:
      value.MATRIX_CALENDAR_REMINDER_DATABASE_URL !== undefined,
    reminderDatabaseTlsMode: databaseTlsMode,
    reminderDatabaseTlsPort: databaseTlsOptions?.port?.[0],
  });
}

function parseCliArgs(args) {
  const { values, positionals } = parseArgs({
    args,
    options: {
      'env-file': { type: 'string' },
      'project-name': { type: 'string' },
    },
    strict: true,
    allowPositionals: false,
  });
  if (positionals.length > 0) fail();

  if (
    values['project-name'] !== undefined &&
    !/^[a-z0-9][a-z0-9_-]*$/i.test(values['project-name'])
  ) {
    fail();
  }

  return values;
}

function runCompose(args) {
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    maxBuffer: 5 * 1024 * 1024,
  });
  if (result.error || result.status !== 0 || result.signal) fail();
  return result.stdout;
}

function validateComposeVersion(versionOutput) {
  const match = /(?:^|\s)v?(\d+)\.(\d+)\.(\d+)(?:\s|$)/i.exec(versionOutput);
  if (!match) fail();
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (major < 2 || (major === 2 && minor < 24)) fail();
}

function composePrefix(options) {
  const args = ['compose'];
  if (options['project-name']) {
    args.push('--project-name', options['project-name']);
  }
  if (options['env-file']) {
    args.push('--env-file', options['env-file']);
  }
  args.push('-f', COMPOSE_FILE);
  return args;
}

export function runSidecarPreflight(args = process.argv.slice(2)) {
  const options = parseCliArgs(args);
  validateComposeVersion(runCompose(['compose', 'version', '--short']));

  const prefix = composePrefix(options);
  runCompose([...prefix, 'config', '--quiet']);

  // Resolved configuration can contain credentials. Keep stdout in memory,
  // parse it, and never print, write, or attach the raw text to an error.
  const resolvedJson = runCompose([...prefix, 'config', '--format', 'json']);
  let model;
  try {
    model = JSON.parse(resolvedJson);
  } catch {
    fail();
  }
  validateSidecarComposeModel(model);
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  try {
    runSidecarPreflight();
    process.stdout.write('Sidecar Compose preflight passed.\n');
  } catch {
    process.stderr.write(`${GENERIC_FAILURE}\n`);
    process.exitCode = 1;
  }
}
