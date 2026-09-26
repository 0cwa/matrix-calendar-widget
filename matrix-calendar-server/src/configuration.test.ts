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

import configuration, { ValidationSchema } from './configuration';

describe('room calendar binding configuration', () => {
  const originalValue = process.env.ROOM_CALENDAR_BINDINGS;
  const originalReminderDatabaseUrl =
    process.env.MATRIX_CALENDAR_REMINDER_DATABASE_URL;

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env.ROOM_CALENDAR_BINDINGS;
    } else {
      process.env.ROOM_CALENDAR_BINDINGS = originalValue;
    }
    if (originalReminderDatabaseUrl === undefined) {
      delete process.env.MATRIX_CALENDAR_REMINDER_DATABASE_URL;
    } else {
      process.env.MATRIX_CALENDAR_REMINDER_DATABASE_URL =
        originalReminderDatabaseUrl;
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

  it('loads the optional app-owned reminder database URL', () => {
    process.env.MATRIX_CALENDAR_REMINDER_DATABASE_URL =
      'postgresql://reminder:secret@localhost:5432/matrix_calendar_reminders';

    expect(configuration().config.reminder_database_url).toBe(
      'postgresql://reminder:secret@localhost:5432/matrix_calendar_reminders',
    );
  });

  it('leaves reminder persistence disabled when no database URL is configured', () => {
    delete process.env.MATRIX_CALENDAR_REMINDER_DATABASE_URL;

    expect(configuration().config.reminder_database_url).toBeUndefined();
  });

  it('validates only PostgreSQL connection URL schemes', () => {
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
});
