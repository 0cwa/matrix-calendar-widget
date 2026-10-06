import assert from 'node:assert/strict';
import test from 'node:test';
import { validateSidecarComposeModel } from './validate-sidecar-compose.mjs';

const baseServerEnvironment = {
  ACCESS_TOKEN: 'synthetic-bot-access-token',
  HOMESERVER_URL: 'https://matrix.example.org',
  RADICALE_URL: 'http://radicale:5232',
  MATRIX_CALENDAR_GATEWAY_RATE_LIMIT_REQUESTS: '120',
  MATRIX_CALENDAR_GATEWAY_RATE_LIMIT_WINDOW_MS: '60000',
  MATRIX_CALENDAR_GATEWAY_RATE_LIMIT_MAX_KEYS: '10000',
  PORT: '3000',
  STORAGE_FILE_DATA_PATH: '/app/storage',
  MEETINGWIDGET_URL:
    'https://widget.example.org/#/?matrix_user_id=$matrix_user_id',
  MEETINGWIDGET_COCKPIT_URL:
    'https://widget.example.org/cockpit/#/?matrix_user_id=$matrix_user_id',
  BREAKOUT_SESSION_WIDGET_URL:
    'https://widget.example.org/#/?matrix_user_id=$matrix_user_id',
};

const baseRadicaleEnvironment = {
  RADICALE_MATRIX_HOMESERVER_URL: 'https://matrix.example.org',
  RADICALE_MATRIX_SERVER_NAME: 'example.org',
};

function composeModel(serverEnvironment = {}, radicaleEnvironment = {}) {
  return {
    services: {
      server: {
        environment: { ...baseServerEnvironment, ...serverEnvironment },
      },
      radicale: {
        environment: { ...baseRadicaleEnvironment, ...radicaleEnvironment },
      },
    },
  };
}

const oneBinding = JSON.stringify([
  { roomId: '!pilot-room:example.org', calendarId: 'team-calendar' },
]);

function roomAccessEnvironment(overrides = {}) {
  return {
    ROOM_CALENDAR_BINDINGS: oneBinding,
    ROOM_CALENDAR_ACCESS_ENABLED: 'true',
    MATRIX_APPLICATION_SERVICE_USER_ID: '@_matrix_calendar_service:example.org',
    MATRIX_APPLICATION_SERVICE_TOKEN: 'synthetic-as-token',
    ...overrides,
  };
}

test('validator restores the caller deprecation setting after SDK user ID parsing', () => {
  const priorNoDeprecation = process.noDeprecation;
  process.noDeprecation = false;

  try {
    assert.throws(() =>
      validateSidecarComposeModel(
        composeModel(
          roomAccessEnvironment({
            MATRIX_APPLICATION_SERVICE_USER_ID: 'invalid',
          }),
        ),
      ),
    );
    assert.equal(process.noDeprecation, false);
  } finally {
    if (priorNoDeprecation === undefined) {
      delete process.noDeprecation;
    } else {
      process.noDeprecation = priorNoDeprecation;
    }
  }
});

test('personal-only defaults preserve omitted optional settings', () => {
  const model = composeModel();
  const result = validateSidecarComposeModel(model);

  assert.equal(result.roomAccessEnabled, false);
  assert.equal(result.roomWritesEnabled, false);
  assert.equal(result.reminderConfigurationEnabled, false);
  assert.equal(result.reminderDeliveryEnabled, false);
  assert.equal(result.actionMessagesEnabled, false);
  assert.equal(result.bindingCount, 0);
  assert.equal(result.reminderDatabaseConfigured, false);
  assert.equal(
    'ROOM_CALENDAR_BINDINGS' in model.services.server.environment,
    false,
  );
  assert.equal(
    'MATRIX_CALENDAR_REMINDER_DATABASE_URL' in
      model.services.server.environment,
    false,
  );
});

test('room reads and writes validate with one exact binding and separate gates', () => {
  const result = validateSidecarComposeModel(
    composeModel({
      ...roomAccessEnvironment(),
      ROOM_CALENDAR_EVENT_WRITES_ENABLED: 'true',
    }),
  );

  assert.equal(result.roomAccessEnabled, true);
  assert.equal(result.roomWritesEnabled, true);
  assert.equal(result.bindingCount, 1);
});

test('reminders require room access, credentials, a binding, and a database', () => {
  const result = validateSidecarComposeModel(
    composeModel({
      ...roomAccessEnvironment(),
      MATRIX_CALENDAR_REMINDER_DATABASE_URL:
        'postgresql://calendar:synthetic-secret@db.example.org:5432/calendar',
      MATRIX_CALENDAR_REMINDER_CONFIGURATION_ENABLED: 'true',
      ROOM_CALENDAR_REMINDER_DELIVERY_ENABLED: 'true',
    }),
  );

  assert.equal(result.reminderConfigurationEnabled, true);
  assert.equal(result.reminderDeliveryEnabled, true);
  assert.equal(result.reminderDatabaseConfigured, true);
  assert.equal(result.reminderDatabaseTlsMode, 'verify-full');
});

test('action-message gate remains independent of room and reminder gates', () => {
  const result = validateSidecarComposeModel(
    composeModel({ ROOM_CALENDAR_ACTION_MESSAGES_ENABLED: 'true' }),
  );

  assert.equal(result.actionMessagesEnabled, true);
  assert.equal(result.roomAccessEnabled, false);
  assert.equal(result.bindingCount, 0);
});

test('writes cannot be enabled while room access remains disabled', () => {
  assert.throws(
    () =>
      validateSidecarComposeModel(
        composeModel({ ROOM_CALENDAR_EVENT_WRITES_ENABLED: 'true' }),
      ),
    { message: /resolved values are never displayed/ },
  );
});

test('room access requires one binding, service identity, and matching homeserver', () => {
  const invalid = [
    roomAccessEnvironment({ ROOM_CALENDAR_BINDINGS: undefined }),
    roomAccessEnvironment({ MATRIX_APPLICATION_SERVICE_TOKEN: undefined }),
    roomAccessEnvironment({ MATRIX_APPLICATION_SERVICE_USER_ID: undefined }),
    roomAccessEnvironment({
      ROOM_CALENDAR_BINDINGS: JSON.stringify([
        { roomId: '!one:example.org', calendarId: 'one' },
        { roomId: '!two:example.org', calendarId: 'two' },
      ]),
    }),
  ];

  for (const environment of invalid) {
    assert.throws(() => validateSidecarComposeModel(composeModel(environment)));
  }

  assert.throws(() =>
    validateSidecarComposeModel(
      composeModel(roomAccessEnvironment(), {
        RADICALE_MATRIX_SERVER_NAME: 'other.example.org',
      }),
    ),
  );
});

test('reminder gates reject a missing database', () => {
  assert.throws(() =>
    validateSidecarComposeModel(
      composeModel(
        roomAccessEnvironment({
          MATRIX_CALENDAR_REMINDER_CONFIGURATION_ENABLED: 'true',
        }),
      ),
    ),
  );
});

test('empty, malformed, and unsupported optional values fail without echoing secrets', () => {
  const sensitiveValue = 'sentinel-do-not-echo-9652';
  const invalidModels = [
    composeModel({ MATRIX_CALENDAR_REMINDER_DATABASE_URL: '' }),
    composeModel({ ROOM_CALENDAR_BINDINGS: '' }),
    composeModel({ MATRIX_CALENDAR_REMINDER_DATABASE_TLS_MODE: 'prefer' }),
    composeModel({
      ...roomAccessEnvironment(),
      MATRIX_CALENDAR_REMINDER_DATABASE_URL: `postgresql://calendar:${sensitiveValue}@db.example.org/calendar`,
      MATRIX_CALENDAR_REMINDER_DATABASE_TLS_MODE: 'prefer',
    }),
  ];

  for (const model of invalidModels) {
    assert.throws(
      () => validateSidecarComposeModel(model),
      (error) => {
        assert.equal(error.message.includes(sensitiveValue), false);
        assert.match(error.message, /resolved values are never displayed/);
        return true;
      },
    );
  }
});

test('TLS helper uses resolved service PGPORT, not an inherited host PGPORT', () => {
  const priorPgPort = process.env.PGPORT;
  process.env.PGPORT = '6543';

  try {
    const absentServerPort = validateSidecarComposeModel(
      composeModel({
        MATRIX_CALENDAR_REMINDER_DATABASE_URL:
          'postgresql://calendar:secret@192.0.2.15/calendar',
      }),
    );
    assert.equal(absentServerPort.reminderDatabaseTlsPort, 5432);

    const resolvedServerPort = validateSidecarComposeModel(
      composeModel({
        PGPORT: '5544',
        MATRIX_CALENDAR_REMINDER_DATABASE_URL:
          'postgresql://calendar:secret@192.0.2.15/calendar',
      }),
    );
    assert.equal(resolvedServerPort.reminderDatabaseTlsPort, 5544);

    const explicitUrlPort = validateSidecarComposeModel(
      composeModel({
        PGPORT: '5544',
        MATRIX_CALENDAR_REMINDER_DATABASE_URL:
          'postgresql://calendar:secret@192.0.2.15:5533/calendar',
      }),
    );
    assert.equal(explicitUrlPort.reminderDatabaseTlsPort, 5533);
  } finally {
    if (priorPgPort === undefined) {
      delete process.env.PGPORT;
    } else {
      process.env.PGPORT = priorPgPort;
    }
  }
});
