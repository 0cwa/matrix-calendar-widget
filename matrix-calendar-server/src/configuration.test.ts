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

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import postgres from 'postgres';
import configuration, {
  parseRoomCalendarSetupAllowedActorServerNames,
  ValidationSchema,
} from './configuration';
import {
  getPostgresDatabaseTlsOptions,
  getReminderDatabaseTlsOptions,
  parseReminderDatabaseTlsMode,
} from './reminder/ReminderDatabaseConnection';

describe('reminder database configuration', () => {
  const originalDatabaseUrl = process.env.MATRIX_CALENDAR_REMINDER_DATABASE_URL;
  const originalTlsMode =
    process.env.MATRIX_CALENDAR_REMINDER_DATABASE_TLS_MODE;
  const originalRateLimitRequests =
    process.env.MATRIX_CALENDAR_GATEWAY_RATE_LIMIT_REQUESTS;
  const originalRateLimitWindow =
    process.env.MATRIX_CALENDAR_GATEWAY_RATE_LIMIT_WINDOW_MS;
  const originalRateLimitMaxKeys =
    process.env.MATRIX_CALENDAR_GATEWAY_RATE_LIMIT_MAX_KEYS;
  const originalPgPort = process.env.PGPORT;
  const originalEnableWelcomeWorkflow = process.env.ENABLE_WELCOME_WORKFLOW;
  const originalEnablePrivateRoomErrorSending =
    process.env.ENABLE_PRIVATE_ROOM_ERROR_SENDING;
  const originalPublicFeedOrigin =
    process.env.MATRIX_CALENDAR_PUBLIC_FEED_ORIGIN;
  const originalPublicFeedKey =
    process.env.MATRIX_CALENDAR_PUBLIC_FEED_SIGNING_KEY;
  const originalPublicFeedKeyFile =
    process.env.MATRIX_CALENDAR_PUBLIC_FEED_SIGNING_KEY_FILE;

  afterEach(() => {
    if (originalDatabaseUrl === undefined) {
      delete process.env.MATRIX_CALENDAR_REMINDER_DATABASE_URL;
    } else {
      process.env.MATRIX_CALENDAR_REMINDER_DATABASE_URL = originalDatabaseUrl;
    }
    if (originalTlsMode === undefined) {
      delete process.env.MATRIX_CALENDAR_REMINDER_DATABASE_TLS_MODE;
    } else {
      process.env.MATRIX_CALENDAR_REMINDER_DATABASE_TLS_MODE = originalTlsMode;
    }
    if (originalRateLimitRequests === undefined) {
      delete process.env.MATRIX_CALENDAR_GATEWAY_RATE_LIMIT_REQUESTS;
    } else {
      process.env.MATRIX_CALENDAR_GATEWAY_RATE_LIMIT_REQUESTS =
        originalRateLimitRequests;
    }
    if (originalRateLimitWindow === undefined) {
      delete process.env.MATRIX_CALENDAR_GATEWAY_RATE_LIMIT_WINDOW_MS;
    } else {
      process.env.MATRIX_CALENDAR_GATEWAY_RATE_LIMIT_WINDOW_MS =
        originalRateLimitWindow;
    }
    if (originalRateLimitMaxKeys === undefined) {
      delete process.env.MATRIX_CALENDAR_GATEWAY_RATE_LIMIT_MAX_KEYS;
    } else {
      process.env.MATRIX_CALENDAR_GATEWAY_RATE_LIMIT_MAX_KEYS =
        originalRateLimitMaxKeys;
    }
    if (originalPgPort === undefined) {
      delete process.env.PGPORT;
    } else {
      process.env.PGPORT = originalPgPort;
    }
    if (originalEnableWelcomeWorkflow === undefined) {
      delete process.env.ENABLE_WELCOME_WORKFLOW;
    } else {
      process.env.ENABLE_WELCOME_WORKFLOW = originalEnableWelcomeWorkflow;
    }
    if (originalEnablePrivateRoomErrorSending === undefined) {
      delete process.env.ENABLE_PRIVATE_ROOM_ERROR_SENDING;
    } else {
      process.env.ENABLE_PRIVATE_ROOM_ERROR_SENDING =
        originalEnablePrivateRoomErrorSending;
    }
    restoreEnvironmentValue(
      'MATRIX_CALENDAR_PUBLIC_FEED_ORIGIN',
      originalPublicFeedOrigin,
    );
    restoreEnvironmentValue(
      'MATRIX_CALENDAR_PUBLIC_FEED_SIGNING_KEY',
      originalPublicFeedKey,
    );
    restoreEnvironmentValue(
      'MATRIX_CALENDAR_PUBLIC_FEED_SIGNING_KEY_FILE',
      originalPublicFeedKeyFile,
    );
  });

  it('keeps legacy private-room workflows opt-in by default', () => {
    delete process.env.ENABLE_WELCOME_WORKFLOW;
    delete process.env.ENABLE_PRIVATE_ROOM_ERROR_SENDING;

    expect(configuration().config).toMatchObject({
      enable_welcome_workflow: false,
      enable_private_room_error_sending: false,
    });

    process.env.ENABLE_WELCOME_WORKFLOW = 'true';
    process.env.ENABLE_PRIVATE_ROOM_ERROR_SENDING = 'true';
    expect(configuration().config).toMatchObject({
      enable_welcome_workflow: true,
      enable_private_room_error_sending: true,
    });
  });

  it('uses bounded gateway rate-limit defaults and loads overrides', () => {
    delete process.env.MATRIX_CALENDAR_GATEWAY_RATE_LIMIT_REQUESTS;
    delete process.env.MATRIX_CALENDAR_GATEWAY_RATE_LIMIT_WINDOW_MS;
    delete process.env.MATRIX_CALENDAR_GATEWAY_RATE_LIMIT_MAX_KEYS;

    expect(configuration().config).toMatchObject({
      calendar_gateway_rate_limit_requests: 120,
      calendar_gateway_rate_limit_window_ms: 60_000,
      calendar_gateway_rate_limit_max_keys: 10_000,
    });

    process.env.MATRIX_CALENDAR_GATEWAY_RATE_LIMIT_REQUESTS = '240';
    process.env.MATRIX_CALENDAR_GATEWAY_RATE_LIMIT_WINDOW_MS = '30000';
    process.env.MATRIX_CALENDAR_GATEWAY_RATE_LIMIT_MAX_KEYS = '500';

    expect(configuration().config).toMatchObject({
      calendar_gateway_rate_limit_requests: 240,
      calendar_gateway_rate_limit_window_ms: 30_000,
      calendar_gateway_rate_limit_max_keys: 500,
    });
  });

  it('requires positive finite integer gateway rate-limit settings', () => {
    const requestLimitSchema = ValidationSchema.extract(
      'MATRIX_CALENDAR_GATEWAY_RATE_LIMIT_REQUESTS',
    );
    const windowSchema = ValidationSchema.extract(
      'MATRIX_CALENDAR_GATEWAY_RATE_LIMIT_WINDOW_MS',
    );
    const maxKeysSchema = ValidationSchema.extract(
      'MATRIX_CALENDAR_GATEWAY_RATE_LIMIT_MAX_KEYS',
    );

    expect(requestLimitSchema.validate('120').error).toBeUndefined();
    expect(windowSchema.validate('60000').error).toBeUndefined();
    expect(maxKeysSchema.validate('10000').error).toBeUndefined();
    expect(requestLimitSchema.validate('0').error).toBeDefined();
    expect(requestLimitSchema.validate('1.5').error).toBeDefined();
    expect(requestLimitSchema.validate('Infinity').error).toBeDefined();
    expect(requestLimitSchema.validate('100001').error).toBeDefined();
    expect(windowSchema.validate('86400001').error).toBeDefined();
    expect(maxKeysSchema.validate('10001').error).toBeDefined();
  });

  it('loads the optional database URL and TLS mode', () => {
    process.env.MATRIX_CALENDAR_REMINDER_DATABASE_URL =
      'postgresql://reminder:secret@localhost:5432/matrix_calendar';
    process.env.MATRIX_CALENDAR_REMINDER_DATABASE_TLS_MODE =
      'trusted-private-network';

    expect(configuration().config.reminder_database_url).toBe(
      'postgresql://reminder:secret@localhost:5432/matrix_calendar',
    );
    expect(configuration().config.reminder_database_tls_mode).toBe(
      'trusted-private-network',
    );
  });

  it('keeps reminder persistence disabled when no database URL is configured', () => {
    delete process.env.MATRIX_CALENDAR_REMINDER_DATABASE_URL;

    expect(configuration().config.reminder_database_url).toBeUndefined();
  });

  it('accepts only PostgreSQL database URL schemes', () => {
    const databaseUrlSchema = ValidationSchema.extract(
      'MATRIX_CALENDAR_REMINDER_DATABASE_URL',
    );

    expect(
      databaseUrlSchema.validate(
        'postgresql://reminder:secret@localhost:5432/matrix_calendar',
      ).error,
    ).toBeUndefined();
    expect(
      databaseUrlSchema.validate('https://example.org/database').error,
    ).toBeDefined();
  });

  it('keeps public calendar feeds private until origin and signing key are configured', () => {
    delete process.env.MATRIX_CALENDAR_PUBLIC_FEED_ORIGIN;
    delete process.env.MATRIX_CALENDAR_PUBLIC_FEED_SIGNING_KEY;
    delete process.env.MATRIX_CALENDAR_PUBLIC_FEED_SIGNING_KEY_FILE;

    expect(configuration().config).toMatchObject({
      public_calendar_feed_enabled: false,
      public_calendar_feed_origin: undefined,
      public_calendar_feed_signing_key: undefined,
    });
  });

  it('loads one canonical external origin and an exact 32-byte signing key', () => {
    const signingKey = Buffer.alloc(32, 0x41).toString('base64url');
    process.env.MATRIX_CALENDAR_PUBLIC_FEED_ORIGIN =
      'https://calendar.example.test/';
    process.env.MATRIX_CALENDAR_PUBLIC_FEED_SIGNING_KEY = signingKey;
    delete process.env.MATRIX_CALENDAR_PUBLIC_FEED_SIGNING_KEY_FILE;

    const result = ValidationSchema.validate({
      ACCESS_TOKEN: 'synthetic-token',
      HOMESERVER_URL: 'https://matrix.example.test',
      MEETINGWIDGET_URL: 'https://widget.example.test',
      BREAKOUT_SESSION_WIDGET_URL: 'https://breakout.example.test',
      MEETINGWIDGET_COCKPIT_URL: 'https://details.example.test',
      MATRIX_CALENDAR_PUBLIC_FEED_ORIGIN:
        process.env.MATRIX_CALENDAR_PUBLIC_FEED_ORIGIN,
      MATRIX_CALENDAR_PUBLIC_FEED_SIGNING_KEY: signingKey,
    });
    expect(result.error).toBeUndefined();
    expect(configuration().config).toMatchObject({
      public_calendar_feed_enabled: true,
      public_calendar_feed_origin: 'https://calendar.example.test/',
      public_calendar_feed_signing_key: Buffer.from(signingKey, 'base64url'),
    });
  });

  it('rejects partial, duplicate, and unsafe public-feed configuration', () => {
    const base = {
      ACCESS_TOKEN: 'synthetic-token',
      HOMESERVER_URL: 'https://matrix.example.test',
      MEETINGWIDGET_URL: 'https://widget.example.test',
      BREAKOUT_SESSION_WIDGET_URL: 'https://breakout.example.test',
      MEETINGWIDGET_COCKPIT_URL: 'https://details.example.test',
    };
    const signingKey = Buffer.alloc(32, 0x41).toString('base64url');

    expect(
      ValidationSchema.validate({
        ...base,
        MATRIX_CALENDAR_PUBLIC_FEED_ORIGIN: 'https://calendar.example.test',
      }).error,
    ).toBeDefined();
    expect(
      ValidationSchema.validate({
        ...base,
        MATRIX_CALENDAR_PUBLIC_FEED_SIGNING_KEY: signingKey,
      }).error,
    ).toBeDefined();
    expect(
      ValidationSchema.validate({
        ...base,
        MATRIX_CALENDAR_PUBLIC_FEED_ORIGIN:
          'https://calendar.example.test/path',
        MATRIX_CALENDAR_PUBLIC_FEED_SIGNING_KEY: signingKey,
      }).error,
    ).toBeDefined();
    expect(
      ValidationSchema.validate({
        ...base,
        MATRIX_CALENDAR_PUBLIC_FEED_ORIGIN: 'https://calendar.example.test',
        MATRIX_CALENDAR_PUBLIC_FEED_SIGNING_KEY: signingKey,
        MATRIX_CALENDAR_PUBLIC_FEED_SIGNING_KEY_FILE: '/tmp/key',
      }).error,
    ).toBeDefined();
  });

  it('requires distinct decoded private-client keys and keeps key values out of errors', () => {
    const base = {
      ACCESS_TOKEN: 'synthetic-token',
      HOMESERVER_URL: 'https://matrix.example.test',
      MEETINGWIDGET_URL: 'https://widget.example.test',
      BREAKOUT_SESSION_WIDGET_URL: 'https://breakout.example.test',
      MEETINGWIDGET_COCKPIT_URL: 'https://details.example.test',
      RADICALE_URL: 'https://calendar.example.test',
      MATRIX_CALENDAR_PRIVATE_CLIENTS_ENABLED: true,
      MATRIX_CALENDAR_PRIVATE_CLIENT_ORIGIN: 'https://api.example.test',
      MATRIX_CALENDAR_PRIVATE_CLIENT_DATABASE_URL:
        'postgresql://private:secret@localhost:5432/calendar',
    };
    const epochKey = Buffer.alloc(32, 0x31).toString('base64url');
    const callbackKey = Buffer.alloc(32, 0x32).toString('base64url');
    const otherKey = Buffer.alloc(32, 0x33).toString('base64url');

    const equalPrivateKeys = ValidationSchema.validate({
      ...base,
      MATRIX_CALENDAR_PRIVATE_CLIENT_EPOCH_KEY: epochKey,
      MATRIX_CALENDAR_PRIVATE_CLIENT_CALLBACK_KEY: epochKey,
    });
    expect(equalPrivateKeys.error).toBeDefined();
    expect(equalPrivateKeys.error?.message).not.toContain(epochKey);

    const equalPublicEpochKey = ValidationSchema.validate({
      ...base,
      MATRIX_CALENDAR_PRIVATE_CLIENT_EPOCH_KEY: epochKey,
      MATRIX_CALENDAR_PRIVATE_CLIENT_CALLBACK_KEY: callbackKey,
      MATRIX_CALENDAR_PUBLIC_FEED_ORIGIN: 'https://calendar.example.test',
      MATRIX_CALENDAR_PUBLIC_FEED_SIGNING_KEY: epochKey,
    });
    expect(equalPublicEpochKey.error).toBeDefined();
    expect(equalPublicEpochKey.error?.message).not.toContain(epochKey);

    const equalPublicCallbackKey = ValidationSchema.validate({
      ...base,
      MATRIX_CALENDAR_PRIVATE_CLIENT_EPOCH_KEY: epochKey,
      MATRIX_CALENDAR_PRIVATE_CLIENT_CALLBACK_KEY: callbackKey,
      MATRIX_CALENDAR_PUBLIC_FEED_ORIGIN: 'https://calendar.example.test',
      MATRIX_CALENDAR_PUBLIC_FEED_SIGNING_KEY: callbackKey,
    });
    expect(equalPublicCallbackKey.error).toBeDefined();
    expect(equalPublicCallbackKey.error?.message).not.toContain(callbackKey);

    const distinctKeysWithoutPublicFeed = ValidationSchema.validate({
      ...base,
      MATRIX_CALENDAR_PRIVATE_CLIENT_EPOCH_KEY: epochKey,
      MATRIX_CALENDAR_PRIVATE_CLIENT_CALLBACK_KEY: callbackKey,
    });
    expect(distinctKeysWithoutPublicFeed.error).toBeUndefined();

    const allDistinct = ValidationSchema.validate({
      ...base,
      MATRIX_CALENDAR_PRIVATE_CLIENT_EPOCH_KEY: epochKey,
      MATRIX_CALENDAR_PRIVATE_CLIENT_CALLBACK_KEY: callbackKey,
      MATRIX_CALENDAR_PUBLIC_FEED_ORIGIN: 'https://calendar.example.test',
      MATRIX_CALENDAR_PUBLIC_FEED_SIGNING_KEY: otherKey,
    });
    expect(allDistinct.error).toBeUndefined();
  });

  it('compares a file-loaded public feed key with decoded private-client keys', () => {
    const directory = mkdtempSync(join(tmpdir(), 'mcw-private-key-test-'));
    try {
      const publicKey = Buffer.alloc(32, 0x41).toString('base64url');
      const callbackKey = Buffer.alloc(32, 0x41).toString('base64url');
      const epochKey = Buffer.alloc(32, 0x42).toString('base64url');
      const keyPath = join(directory, 'public-feed-key');
      writeFileSync(keyPath, `${publicKey}\n`, { mode: 0o600 });
      const result = ValidationSchema.validate({
        ACCESS_TOKEN: 'synthetic-token',
        HOMESERVER_URL: 'https://matrix.example.test',
        MEETINGWIDGET_URL: 'https://widget.example.test',
        BREAKOUT_SESSION_WIDGET_URL: 'https://breakout.example.test',
        MEETINGWIDGET_COCKPIT_URL: 'https://details.example.test',
        RADICALE_URL: 'https://calendar.example.test',
        MATRIX_CALENDAR_PRIVATE_CLIENTS_ENABLED: true,
        MATRIX_CALENDAR_PRIVATE_CLIENT_ORIGIN: 'https://api.example.test',
        MATRIX_CALENDAR_PRIVATE_CLIENT_DATABASE_URL:
          'postgresql://private:secret@localhost:5432/calendar',
        MATRIX_CALENDAR_PRIVATE_CLIENT_EPOCH_KEY: epochKey,
        MATRIX_CALENDAR_PRIVATE_CLIENT_CALLBACK_KEY: callbackKey,
        MATRIX_CALENDAR_PUBLIC_FEED_ORIGIN: 'https://calendar.example.test',
        MATRIX_CALENDAR_PUBLIC_FEED_SIGNING_KEY_FILE: keyPath,
      });

      expect(result.error).toBeDefined();
      expect(result.error?.message).not.toContain(publicKey);
      expect(result.error?.message).not.toContain(callbackKey);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('accepts only the explicit TLS modes', () => {
    const tlsModeSchema = ValidationSchema.extract(
      'MATRIX_CALENDAR_REMINDER_DATABASE_TLS_MODE',
    );

    expect(tlsModeSchema.validate('verify-full').error).toBeUndefined();
    expect(
      tlsModeSchema.validate('trusted-private-network').error,
    ).toBeUndefined();
    expect(tlsModeSchema.validate('prefer').error).toBeDefined();
  });

  it('defaults to verified TLS and rejects unknown policy values', () => {
    expect(parseReminderDatabaseTlsMode(undefined)).toBe('verify-full');
    expect(parseReminderDatabaseTlsMode('verify-full')).toBe('verify-full');
    expect(parseReminderDatabaseTlsMode('trusted-private-network')).toBe(
      'trusted-private-network',
    );
    expect(() => parseReminderDatabaseTlsMode('prefer')).toThrow(
      'MATRIX_CALENDAR_REMINDER_DATABASE_TLS_MODE must be verify-full or trusted-private-network',
    );
  });

  it('requires verified TLS by default for DNS hosts', () => {
    expect(
      getReminderDatabaseTlsOptions(
        'verify-full',
        'postgresql://reminder:secret@db.example.test:5432/matrix_calendar',
      ),
    ).toEqual({ ssl: 'verify-full' });
  });

  it('allows plaintext only for the explicit private-network mode', () => {
    expect(
      getReminderDatabaseTlsOptions(
        'trusted-private-network',
        'postgresql://reminder:secret@db.example.test:5432/matrix_calendar',
      ),
    ).toEqual({ ssl: false });
  });

  it('checks IPv4 literal certificate identity without sending SNI', () => {
    expect(
      getReminderDatabaseTlsOptions(
        'verify-full',
        'postgresql://reminder:secret@192.0.2.15:5432/matrix_calendar',
      ),
    ).toEqual({
      host: ['192.0.2.15'],
      port: [5432],
      ssl: { host: '192.0.2.15', rejectUnauthorized: true },
    });
  });

  it('keeps the selected TLS mode authoritative over URL sslmode values', () => {
    expect(
      getReminderDatabaseTlsOptions(
        'verify-full',
        'postgresql://reminder:secret@db.example.test/matrix_calendar?sslmode=disable',
      ),
    ).toEqual({ ssl: 'verify-full' });
    expect(
      getReminderDatabaseTlsOptions(
        'trusted-private-network',
        'postgresql://reminder:secret@db.example.test/matrix_calendar?sslmode=verify-full',
      ),
    ).toEqual({ ssl: false });
  });

  it('preserves IPv6 URL targets in the pinned client without connecting', async () => {
    const databaseUrl =
      'postgresql://reminder:secret@[2001:db8::15]:6432/matrix_calendar';
    const options = getReminderDatabaseTlsOptions('verify-full', databaseUrl);
    expect(options).toEqual({
      host: ['2001:db8::15'],
      port: [6432],
      ssl: { host: '2001:db8::15', rejectUnauthorized: true },
    });

    // Construct the pinned client without issuing a query or opening a socket.
    // This checks the actual driver's URL parser and normalized connector target.
    const postgresOptions = {
      ...options,
      max: 1,
    } as unknown as Parameters<typeof postgres>[1];
    const sql = postgres(databaseUrl, postgresOptions);
    expect(sql.options.host).toEqual(['2001:db8::15']);
    expect(sql.options.port).toEqual([6432]);
    expect(sql.options.ssl).toEqual({
      host: '2001:db8::15',
      rejectUnauthorized: true,
    });
    await sql.end({ timeout: 0 });
  });

  it('preserves IPv6 URL targets in the pinned client with private-network TLS disabled', async () => {
    const databaseUrl =
      'postgresql://reminder:secret@[2001:db8::15]:6432/matrix_calendar';
    const options = getReminderDatabaseTlsOptions(
      'trusted-private-network',
      databaseUrl,
    );
    expect(options).toEqual({
      host: ['2001:db8::15'],
      port: [6432],
      ssl: false,
    });

    // Construct the pinned client without issuing a query or opening a socket.
    const postgresOptions = {
      ...options,
      max: 1,
    } as unknown as Parameters<typeof postgres>[1];
    const sql = postgres(databaseUrl, postgresOptions);
    expect(sql.options.host).toEqual(['2001:db8::15']);
    expect(sql.options.port).toEqual([6432]);
    expect(sql.options.ssl).toBe(false);
    await sql.end({ timeout: 0 });
  });

  it('uses PGPORT when an IP-literal URL omits its port', () => {
    process.env.PGPORT = '6543';

    expect(
      getReminderDatabaseTlsOptions(
        'verify-full',
        'postgresql://reminder:secret@[2001:db8::15]/matrix_calendar',
      ),
    ).toMatchObject({ port: [6543] });
  });

  it('fails closed for malformed IP-literal database ports', () => {
    expect(() =>
      getReminderDatabaseTlsOptions(
        'verify-full',
        'postgresql://reminder:secret@192.0.2.15:99999/matrix_calendar',
      ),
    ).toThrow('requires a valid database port');
  });

  it('rejects multi-host URLs when verified TLS includes an IP literal', () => {
    expect(() =>
      getReminderDatabaseTlsOptions(
        'verify-full',
        'postgresql://reminder:secret@db.example.test,192.0.2.15/matrix_calendar',
      ),
    ).toThrow('requires a single database host');
  });
});

function restoreEnvironmentValue(
  name: string,
  value: string | undefined,
): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

describe('room reminder configuration API gate', () => {
  const variable = 'MATRIX_CALENDAR_REMINDER_CONFIGURATION_ENABLED';
  const originalValue = process.env[variable];

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env[variable];
    } else {
      process.env[variable] = originalValue;
    }
  });

  it('defaults to disabled and loads only the explicit server-side setting', () => {
    delete process.env[variable];
    expect(configuration().config.room_reminder_configuration_enabled).toBe(
      false,
    );

    process.env[variable] = 'true';
    expect(configuration().config.room_reminder_configuration_enabled).toBe(
      true,
    );

    process.env[variable] = 'false';
    expect(configuration().config.room_reminder_configuration_enabled).toBe(
      false,
    );
  });

  it('rejects non-boolean gate values', () => {
    const schema = ValidationSchema.extract(variable);
    expect(schema.validate('true').error).toBeUndefined();
    expect(schema.validate('false').error).toBeUndefined();
    expect(schema.validate('enabled').error).toBeDefined();
  });
});

describe('CalDAV event response limit configuration', () => {
  const responseLimitVariable =
    'MATRIX_CALENDAR_CALDAV_MAX_EVENT_RESPONSE_BYTES';
  const originalResponseLimit = process.env[responseLimitVariable];

  afterEach(() => {
    if (originalResponseLimit === undefined) {
      delete process.env[responseLimitVariable];
    } else {
      process.env[responseLimitVariable] = originalResponseLimit;
    }
  });

  it('defaults to 16 MiB and accepts a bounded positive integer override', () => {
    delete process.env[responseLimitVariable];
    expect(configuration().config.caldav_max_event_response_bytes).toBe(
      16 * 1024 * 1024,
    );

    process.env[responseLimitVariable] = '1048576';
    expect(configuration().config.caldav_max_event_response_bytes).toBe(
      1024 * 1024,
    );
  });

  it('rejects non-integer, non-positive, and over-64-MiB values', () => {
    const schema = ValidationSchema.extract(responseLimitVariable);
    for (const value of ['0', '-1', '1.5', '67108865']) {
      expect(schema.validate(value).error).toBeDefined();
    }
    expect(schema.validate('67108864').error).toBeUndefined();
  });
});

describe('room reminder configuration API gate', () => {
  const variable = 'MATRIX_CALENDAR_REMINDER_CONFIGURATION_ENABLED';
  const originalValue = process.env[variable];

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env[variable];
    } else {
      process.env[variable] = originalValue;
    }
  });

  it('defaults to disabled and loads only the explicit server-side setting', () => {
    delete process.env[variable];
    expect(configuration().config.room_reminder_configuration_enabled).toBe(
      false,
    );

    process.env[variable] = 'true';
    expect(configuration().config.room_reminder_configuration_enabled).toBe(
      true,
    );

    process.env[variable] = 'false';
    expect(configuration().config.room_reminder_configuration_enabled).toBe(
      false,
    );
  });

  it('rejects non-boolean gate values', () => {
    const schema = ValidationSchema.extract(variable);
    expect(schema.validate('true').error).toBeUndefined();
    expect(schema.validate('false').error).toBeUndefined();
    expect(schema.validate('enabled').error).toBeDefined();
  });
});

describe('room calendar action-message configuration gate', () => {
  const variable = 'ROOM_CALENDAR_ACTION_MESSAGES_ENABLED';
  const originalValue = process.env[variable];

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env[variable];
    } else {
      process.env[variable] = originalValue;
    }
  });

  it('defaults to disabled and accepts only explicit boolean values', () => {
    delete process.env[variable];
    expect(configuration().config.room_calendar_action_messages_enabled).toBe(
      false,
    );

    process.env[variable] = 'true';
    expect(configuration().config.room_calendar_action_messages_enabled).toBe(
      true,
    );

    process.env[variable] = 'false';
    expect(configuration().config.room_calendar_action_messages_enabled).toBe(
      false,
    );

    const schema = ValidationSchema.extract(variable);
    expect(schema.validate('true').error).toBeUndefined();
    expect(schema.validate('false').error).toBeUndefined();
    expect(schema.validate('enabled').error).toBeDefined();
  });
});

describe('room calendar binding configuration', () => {
  const originalValue = process.env.ROOM_CALENDAR_BINDINGS;

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env.ROOM_CALENDAR_BINDINGS;
    } else {
      process.env.ROOM_CALENDAR_BINDINGS = originalValue;
    }
  });

  it('loads a typed list from the server-only JSON setting', () => {
    process.env.ROOM_CALENDAR_BINDINGS = JSON.stringify([
      { roomId: '!room-id:example.org', calendarId: 'team-calendar' },
    ]);

    expect(configuration().config.room_calendar_bindings).toEqual([
      { roomId: '!room-id:example.org', calendarId: 'team-calendar' },
    ]);
  });

  it('defaults to no room bindings', () => {
    delete process.env.ROOM_CALENDAR_BINDINGS;

    expect(configuration().config.room_calendar_bindings).toEqual([]);
  });
});

describe('room calendar setup and binding database configuration', () => {
  const variables = [
    'MATRIX_CALENDAR_BINDING_DATABASE_URL',
    'MATRIX_CALENDAR_BINDING_DATABASE_TLS_MODE',
    'ROOM_CALENDAR_SETUP_ENABLED',
    'ROOM_CALENDAR_SETUP_ALLOWED_ACTOR_SERVER_NAMES',
  ] as const;
  const originalValues = new Map(
    variables.map((name) => [name, process.env[name]]),
  );

  afterEach(() => {
    for (const name of variables) {
      const value = originalValues.get(name);
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  });

  it('keeps setup disabled and dynamic binding storage absent by default', () => {
    for (const name of variables) delete process.env[name];

    expect(configuration().config).toMatchObject({
      room_calendar_binding_database_url: undefined,
      room_calendar_binding_database_tls_mode: 'verify-full',
      room_calendar_setup_enabled: false,
      room_calendar_setup_allowed_actor_server_names: [],
    });
  });

  it('loads an independent binding database URL and its TLS mode', () => {
    process.env.MATRIX_CALENDAR_BINDING_DATABASE_URL =
      'postgresql://bindings:secret@db.example.test:5432/matrix_calendar_bindings';
    process.env.MATRIX_CALENDAR_BINDING_DATABASE_TLS_MODE =
      'trusted-private-network';
    process.env.ROOM_CALENDAR_SETUP_ENABLED = 'true';

    expect(configuration().config).toMatchObject({
      room_calendar_binding_database_url:
        'postgresql://bindings:secret@db.example.test:5432/matrix_calendar_bindings',
      room_calendar_binding_database_tls_mode: 'trusted-private-network',
      room_calendar_setup_enabled: true,
    });
  });

  it('accepts only PostgreSQL URLs and the explicit binding TLS modes', () => {
    const urlSchema = ValidationSchema.extract(
      'MATRIX_CALENDAR_BINDING_DATABASE_URL',
    );
    const tlsSchema = ValidationSchema.extract(
      'MATRIX_CALENDAR_BINDING_DATABASE_TLS_MODE',
    );
    const setupSchema = ValidationSchema.extract('ROOM_CALENDAR_SETUP_ENABLED');

    expect(
      urlSchema.validate(
        'postgresql://bindings:secret@localhost:5432/matrix_calendar_bindings',
      ).error,
    ).toBeUndefined();
    expect(urlSchema.validate('').error).toBeUndefined();
    expect(urlSchema.validate('https://example.org/db').error).toBeDefined();
    expect(tlsSchema.validate('verify-full').error).toBeUndefined();
    expect(tlsSchema.validate('trusted-private-network').error).toBeUndefined();
    expect(tlsSchema.validate('prefer').error).toBeDefined();
    expect(tlsSchema.validate(undefined).value).toBe('verify-full');
    expect(setupSchema.validate('true').error).toBeUndefined();
    expect(setupSchema.validate('false').error).toBeUndefined();
    expect(setupSchema.validate('enabled').error).toBeDefined();
  });

  it('uses verified TLS for binding URLs and permits plaintext only by override', () => {
    const databaseUrl =
      'postgresql://bindings:secret@db.example.test:5432/matrix_calendar_bindings';
    expect(getPostgresDatabaseTlsOptions('verify-full', databaseUrl)).toEqual({
      ssl: 'verify-full',
    });
    expect(
      getPostgresDatabaseTlsOptions('trusted-private-network', databaseUrl),
    ).toEqual({ ssl: false });
  });

  it('parses exact Matrix server names, including ports and bracketed IPv6', () => {
    const value = 'example.org, example.net:8448,127.0.0.1,[2001:db8::1]:8448';
    process.env.ROOM_CALENDAR_SETUP_ALLOWED_ACTOR_SERVER_NAMES = value;

    expect(
      configuration().config.room_calendar_setup_allowed_actor_server_names,
    ).toEqual([
      'example.org',
      'example.net:8448',
      '127.0.0.1',
      '[2001:db8::1]:8448',
    ]);
    expect(parseRoomCalendarSetupAllowedActorServerNames('')).toEqual([]);
  });

  it('rejects wildcards, empty members, duplicate realms, and invalid ports', () => {
    const schema = ValidationSchema.extract(
      'ROOM_CALENDAR_SETUP_ALLOWED_ACTOR_SERVER_NAMES',
    );
    for (const value of [
      '*',
      'example.org,,example.net',
      'example.org, example.org',
      'example.org:65536',
      '[::1]:0',
      'example.org:abc',
      'https://example.org',
    ]) {
      expect(schema.validate(value).error).toBeDefined();
      expect(() =>
        parseRoomCalendarSetupAllowedActorServerNames(value),
      ).toThrow();
    }
  });
});

describe('room calendar application-service configuration', () => {
  const variables = [
    'ROOM_CALENDAR_ACCESS_ENABLED',
    'ROOM_CALENDAR_EVENT_WRITES_ENABLED',
    'ROOM_CALENDAR_REMINDER_DELIVERY_ENABLED',
    'ROOM_CALENDAR_PRINCIPAL_MODE',
    'MATRIX_APPLICATION_SERVICE_TOKEN',
    'MATRIX_APPLICATION_SERVICE_USER_ID',
  ] as const;
  const originalValues = new Map(
    variables.map((name) => [name, process.env[name]]),
  );

  afterEach(() => {
    for (const name of variables) {
      const value = originalValues.get(name);
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  });

  it('keeps room-principal access disabled by default', () => {
    for (const name of variables) delete process.env[name];

    expect(configuration().config.room_calendar_access_enabled).toBe(false);
    expect(configuration().config.room_calendar_event_writes_enabled).toBe(
      false,
    );
    expect(configuration().config.room_reminder_delivery_enabled).toBe(false);
  });

  it('normalizes empty optional AS settings to absent in bot-account mode', () => {
    process.env.ROOM_CALENDAR_PRINCIPAL_MODE = 'bot-account';
    process.env.MATRIX_APPLICATION_SERVICE_TOKEN = '';
    process.env.MATRIX_APPLICATION_SERVICE_USER_ID = '';

    expect(configuration().config).toMatchObject({
      room_calendar_principal_mode: 'bot-account',
      application_service_token: undefined,
      application_service_user_id: undefined,
    });

    const validation = ValidationSchema.validate({
      ACCESS_TOKEN: 'synthetic-bot-token',
      HOMESERVER_URL: 'https://matrix.example.test',
      MEETINGWIDGET_URL: 'https://widget.example.test/calendar',
      BREAKOUT_SESSION_WIDGET_URL: 'https://widget.example.test/breakout',
      MEETINGWIDGET_COCKPIT_URL: 'https://widget.example.test/cockpit',
      MATRIX_APPLICATION_SERVICE_TOKEN: '',
      MATRIX_APPLICATION_SERVICE_USER_ID: '',
    });

    expect(validation.error).toBeUndefined();
    expect(validation.value.MATRIX_APPLICATION_SERVICE_TOKEN).toBeUndefined();
    expect(validation.value.MATRIX_APPLICATION_SERVICE_USER_ID).toBeUndefined();
    expect(
      ValidationSchema.extract('ACCESS_TOKEN').validate('').error,
    ).toBeDefined();
  });

  it('loads the explicit gate and server-held application-service identity', () => {
    process.env.ROOM_CALENDAR_ACCESS_ENABLED = 'true';
    process.env.ROOM_CALENDAR_EVENT_WRITES_ENABLED = 'true';
    process.env.ROOM_CALENDAR_REMINDER_DELIVERY_ENABLED = 'true';
    process.env.MATRIX_APPLICATION_SERVICE_TOKEN = 'synthetic-as-token';
    process.env.MATRIX_APPLICATION_SERVICE_USER_ID =
      '@_matrix_calendar_service:example.test';

    expect(configuration().config).toMatchObject({
      room_calendar_access_enabled: true,
      room_calendar_event_writes_enabled: true,
      room_reminder_delivery_enabled: true,
      application_service_token: 'synthetic-as-token',
      application_service_user_id: '@_matrix_calendar_service:example.test',
    });
  });
});

describe('room calendar principal mode configuration', () => {
  const variable = 'ROOM_CALENDAR_PRINCIPAL_MODE';
  const originalValue = process.env[variable];

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env[variable];
    } else {
      process.env[variable] = originalValue;
    }
  });

  it('defaults to appservice and accepts only the two explicit values', () => {
    delete process.env[variable];
    expect(configuration().config.room_calendar_principal_mode).toBe(
      'appservice',
    );

    const schema = ValidationSchema.extract(variable);
    expect(schema.validate('appservice').error).toBeUndefined();
    expect(schema.validate('bot-account').error).toBeUndefined();
    expect(schema.validate('Bot-Account').error).toBeDefined();
    expect(schema.validate('normal-user').error).toBeDefined();

    process.env[variable] = 'bot-account';
    expect(configuration().config.room_calendar_principal_mode).toBe(
      'bot-account',
    );
  });
});

describe('Matrix OpenID userinfo origin configuration', () => {
  const variable = 'MATRIX_OPENID_USERINFO_URL';
  const originalValue = process.env[variable];

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env[variable];
    } else {
      process.env[variable] = originalValue;
    }
  });

  it('is optional and loads the explicit operator origin', () => {
    delete process.env[variable];
    expect(
      configuration().config.matrix_openid_userinfo_origin,
    ).toBeUndefined();

    process.env[variable] = 'https://openid.example.org';
    expect(configuration().config.matrix_openid_userinfo_origin).toBe(
      'https://openid.example.org',
    );

    process.env[variable] = '';
    expect(
      configuration().config.matrix_openid_userinfo_origin,
    ).toBeUndefined();
  });

  it('accepts HTTPS origins and loopback HTTP origins for isolated tests', () => {
    const schema = ValidationSchema.extract(variable);
    for (const value of [
      'https://openid.example.org',
      'https://openid.example.org/',
      'http://localhost:8008',
      'http://127.0.0.1:8008',
      'http://[::1]:8008',
    ]) {
      expect(schema.validate(value).error).toBeUndefined();
    }
  });

  it('rejects insecure remote URLs and values that are not origins', () => {
    const schema = ValidationSchema.extract(variable);
    for (const value of [
      'http://openid.example.org',
      'ftp://openid.example.org',
      'file:///tmp/openid',
      'https://user:password@openid.example.org',
      'https://@openid.example.org',
      'https://openid.example.org/_matrix/federation/v1/openid/userinfo',
      'https://openid.example.org?access_token=proof',
      'https://openid.example.org#fragment',
    ]) {
      expect(schema.validate(value).error).toBeDefined();
    }
  });
});
