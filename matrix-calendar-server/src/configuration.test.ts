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

import postgres from 'postgres';
import configuration, { ValidationSchema } from './configuration';
import {
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

describe('room calendar application-service configuration', () => {
  const variables = [
    'ROOM_CALENDAR_ACCESS_ENABLED',
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
  });

  it('loads the explicit gate and server-held application-service identity', () => {
    process.env.ROOM_CALENDAR_ACCESS_ENABLED = 'true';
    process.env.MATRIX_APPLICATION_SERVICE_TOKEN = 'synthetic-as-token';
    process.env.MATRIX_APPLICATION_SERVICE_USER_ID =
      '@_matrix_calendar_service:example.test';

    expect(configuration().config).toMatchObject({
      room_calendar_access_enabled: true,
      application_service_token: 'synthetic-as-token',
      application_service_user_id: '@_matrix_calendar_service:example.test',
    });
  });
});
