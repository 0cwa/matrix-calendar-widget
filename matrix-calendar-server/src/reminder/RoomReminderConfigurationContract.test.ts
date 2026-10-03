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

import {
  assertReminderConfigurationCursorScope,
  encodeReminderConfigurationCursor,
  parseReminderConfigurationCursor,
  parseReminderConfigurationDeleteInput,
  parseReminderConfigurationPageSize,
  parseReminderConfigurationUpsertInput,
} from './RoomReminderConfigurationContract';

const recurrenceId = JSON.stringify([
  'date-time',
  'tzid',
  'Europe/Stockholm',
  '2026-10-12T09:00:00',
]);

describe('room reminder configuration request contract', () => {
  it('accepts only the fields needed to configure a safe source selection', () => {
    expect(
      parseReminderConfigurationUpsertInput({
        eventId: 'https://dav.example.test/calendar/planning.ics',
        recurrenceId,
        alarmUid: 'reminder@example.test',
      }),
    ).toEqual({
      eventId: 'https://dav.example.test/calendar/planning.ics',
      recurrenceId,
      alarmUid: 'reminder@example.test',
    });

    expect(
      parseReminderConfigurationDeleteInput({
        eventUid: 'event@example.test',
        recurrenceId: null,
        alarmUid: 'reminder@example.test',
      }),
    ).toEqual({
      eventUid: 'event@example.test',
      recurrenceId: null,
      alarmUid: 'reminder@example.test',
    });
  });

  it.each([
    {
      eventId: 'https://dav.example.test/calendar/planning.ics',
      recurrenceId,
      alarmUid: 'a',
      roomId: '!r:s',
    },
    {
      eventId: 'https://dav.example.test/calendar/planning.ics',
      recurrenceId,
      alarmUid: 'a',
      eventUid: 'x',
    },
    {
      eventId: 'https://dav.example.test/calendar/planning.ics',
      recurrenceId,
      alarmUid: 'a',
      recipient: '@x:s',
    },
    {
      eventId: 'https://dav.example.test/calendar/planning.ics',
      recurrenceId,
      alarmUid: 'a',
      url: 'https://x',
    },
    {
      eventId: 'https://dav.example.test/calendar/planning.ics',
      recurrenceId,
      alarmUid: 'a',
      token: 'secret',
    },
  ])('rejects extra upsert field %#', (input) => {
    expect(() => parseReminderConfigurationUpsertInput(input)).toThrow();
  });

  it.each([
    ['', null, 'a'],
    ['../outside.ics', null, 'a'],
    ['has whitespace.ics', null, 'a'],
    ['ftp://dav.example.test/calendar/planning.ics', null, 'a'],
    ['https://user@dav.example.test/calendar/planning.ics', null, 'a'],
    ['https://dav.example.test/calendar/planning.ics?next=private', null, 'a'],
    ['https://dav.example.test/calendar/item%2Fchild.ics', null, 'a'],
    ['https://dav.example.test/calendar/planning.ics', 'not-json', 'a'],
    [
      'https://dav.example.test/calendar/planning.ics',
      JSON.stringify(['date', '2026-02-30']),
      'a',
    ],
    [
      'https://dav.example.test/calendar/planning.ics',
      JSON.stringify(['date-time', 'floating', 'TZID', '2026-10-12T09:00:00']),
      'a',
    ],
    ['https://dav.example.test/calendar/planning.ics', null, ' bad'],
  ])(
    'rejects invalid upsert fields %#',
    (eventId, invalidRecurrenceId, alarmUid) => {
      expect(() =>
        parseReminderConfigurationUpsertInput({
          eventId,
          recurrenceId: invalidRecurrenceId,
          alarmUid,
        }),
      ).toThrow();
    },
  );

  it('validates and scopes bounded opaque pagination cursors', () => {
    expect(parseReminderConfigurationPageSize(undefined)).toBe(50);
    expect(parseReminderConfigurationPageSize('100')).toBe(100);
    for (const value of ['0', '-1', '1.0', '101', '999', '', '1e2']) {
      expect(() => parseReminderConfigurationPageSize(value)).toThrow();
    }

    const cursor = {
      eventUid: 'event@example.test',
      recurrenceId,
      alarmUid: 'reminder@example.test',
    };
    const token = encodeReminderConfigurationCursor(
      '!team:example.test',
      'team-calendar',
      cursor,
    );
    const decoded = parseReminderConfigurationCursor(token);
    expect(decoded).toEqual({
      version: 1,
      roomId: '!team:example.test',
      calendarId: 'team-calendar',
      ...cursor,
    });
    expect(() =>
      assertReminderConfigurationCursorScope(
        decoded,
        '!another:example.test',
        'team-calendar',
      ),
    ).toThrow();
    expect(() => parseReminderConfigurationCursor(`${token}=`)).toThrow();
    expect(() =>
      parseReminderConfigurationCursor('eyJ2ZXJzaW9uIjoxfQ'),
    ).toThrow();
  });
});
