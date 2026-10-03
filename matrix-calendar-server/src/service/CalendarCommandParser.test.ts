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
  calendarResourceHref,
  calendarResourceIdFromHref,
  DEFAULT_UPCOMING_EVENT_COUNT,
  InvalidCalendarCommandError,
  isWholeEventResourceDeletable,
  MAX_UPCOMING_EVENT_COUNT,
  parseCalendarCommand,
  UPCOMING_HORIZON_DAYS,
} from './CalendarCommandParser';

describe('parseCalendarCommand', () => {
  test('bounds upcoming queries and defaults to UTC and five events', () => {
    expect(parseCalendarCommand('upcoming')).toEqual({
      kind: 'upcoming',
      count: DEFAULT_UPCOMING_EVENT_COUNT,
      timeZone: 'UTC',
    });
    expect(
      parseCalendarCommand(`upcoming ${MAX_UPCOMING_EVENT_COUNT}`),
    ).toEqual({
      kind: 'upcoming',
      count: MAX_UPCOMING_EVENT_COUNT,
      timeZone: 'UTC',
    });
    expect(UPCOMING_HORIZON_DAYS).toBe(30);
  });

  test('accepts one IANA timezone after upcoming arguments', () => {
    expect(parseCalendarCommand('upcoming 3 --tz Europe/Stockholm')).toEqual({
      kind: 'upcoming',
      count: 3,
      timeZone: 'Europe/Stockholm',
    });
  });

  test('parses event and delete resource IDs as opaque single path segments', () => {
    expect(
      parseCalendarCommand('event event@example.test.ics --tz UTC'),
    ).toEqual({
      kind: 'event',
      resourceId: 'event@example.test.ics',
      timeZone: 'UTC',
    });
    expect(parseCalendarCommand('delete 28ef-uuid.ics')).toEqual({
      kind: 'delete',
      resourceId: '28ef-uuid.ics',
    });
    expect(parseCalendarCommand('cancel 28ef-uuid.ics')).toEqual({
      kind: 'delete',
      resourceId: '28ef-uuid.ics',
    });
  });

  test('converts only exact-collection event hrefs to safe opaque IDs', () => {
    const collection = 'https://radicale.example.test/alice/team/';
    expect(
      calendarResourceIdFromHref(
        'https://radicale.example.test/alice/team/event%40example.test.ics',
        collection,
      ),
    ).toBe('event@example.test.ics');
    expect(calendarResourceHref(collection, 'event@example.test.ics')).toBe(
      'https://radicale.example.test/alice/team/event%40example.test.ics',
    );
  });

  test.each([
    ['another origin', 'https://outside.example.test/alice/team/a.ics'],
    [
      'a sibling collection',
      'https://radicale.example.test/alice/team-two/a.ics',
    ],
    ['a nested resource', 'https://radicale.example.test/alice/team/sub/a.ics'],
    [
      'an encoded path separator',
      'https://radicale.example.test/alice/team/a%2Fb.ics',
    ],
    [
      'a query string',
      'https://radicale.example.test/alice/team/a.ics?token=private',
    ],
    ['a fragment', 'https://radicale.example.test/alice/team/a.ics#private'],
    [
      'a credentialed URL',
      'https://user:secret@radicale.example.test/alice/team/a.ics',
    ],
    ['a dot segment', 'https://radicale.example.test/alice/team/..ics'],
  ])('does not expose %s', (_case, eventHref) => {
    expect(
      calendarResourceIdFromHref(
        eventHref,
        'https://radicale.example.test/alice/team/',
      ),
    ).toBeUndefined();
  });

  test('parses a quoted title and description as plain text', () => {
    expect(
      parseCalendarCommand(
        'create 2026-10-04T13:00 2026-10-04T14:00 "Planning & <review>" --description "Bring the draft" --tz Europe/Stockholm',
      ),
    ).toEqual({
      kind: 'create',
      title: 'Planning & <review>',
      description: 'Bring the draft',
      timing: {
        type: 'timed',
        start: {
          type: 'zoned',
          local: '2026-10-04T13:00',
          timezone: 'Europe/Stockholm',
        },
        end: {
          type: 'zoned',
          local: '2026-10-04T14:00',
          timezone: 'Europe/Stockholm',
        },
      },
    });
  });

  test('keeps quoted text inert and does not perform shell expansion', () => {
    expect(
      parseCalendarCommand(
        'create 2026-10-04T13:00 2026-10-04T14:00 "literal $HOME `command` and \\"quote\\""',
      ),
    ).toMatchObject({
      kind: 'create',
      title: 'literal $HOME `command` and "quote"',
    });
  });

  test.each([
    ['count below range', 'upcoming 0'],
    ['fractional count', 'upcoming 1.5'],
    ['count above range', `upcoming ${MAX_UPCOMING_EVENT_COUNT + 1}`],
    ['duplicate timezone', 'upcoming --tz UTC --tz UTC'],
    ['timezone equals syntax', 'upcoming --tz=UTC'],
    ['unknown option', 'upcoming --limit 5'],
    ['numeric UTC offset', 'upcoming --tz +02:00'],
    ['invalid timezone', 'upcoming --tz Not/AZone'],
    ['event URL', 'event https://dav.example.test/a.ics'],
    ['resource path traversal', 'event ../secret.ics'],
    ['resource slash', 'event nested/event.ics'],
    ['resource backslash', 'event nested\\event.ics'],
    ['resource query', 'event event.ics?token=secret'],
    ['resource without calendar extension', 'event event'],
    [
      'create title without quotes',
      'create 2026-10-04T13:00 2026-10-04T14:00 meeting',
    ],
    [
      'create unknown option',
      'create 2026-10-04T13:00 2026-10-04T14:00 "title" --uid user',
    ],
    [
      'duplicate description',
      'create 2026-10-04T13:00 2026-10-04T14:00 "title" --description "a" --description "b"',
    ],
    [
      'timezone without a value',
      'create 2026-10-04T13:00 2026-10-04T14:00 "title" --tz',
    ],
    ['unclosed title quote', 'create 2026-10-04T13:00 2026-10-04T14:00 "title'],
    [
      'time with numeric offset',
      'create 2026-10-04T13:00+02:00 2026-10-04T14:00 "title"',
    ],
    [
      'invalid calendar date',
      'create 2026-02-30T13:00 2026-02-30T14:00 "title"',
    ],
    [
      'nonexistent DST wall time',
      'create 2026-03-08T02:30 2026-03-08T03:30 "title" --tz America/New_York',
    ],
    [
      'ambiguous DST wall time',
      'create 2026-11-01T01:30 2026-11-01T02:30 "title" --tz America/New_York',
    ],
    ['end before start', 'create 2026-10-04T14:00 2026-10-04T13:00 "title"'],
    [
      'control characters in title',
      'create 2026-10-04T13:00 2026-10-04T14:00 "bad\u0001title"',
    ],
  ])('rejects %s with a fixed error', (_case, commandText) => {
    expect(() => parseCalendarCommand(commandText)).toThrow(
      InvalidCalendarCommandError,
    );
    expect(() => parseCalendarCommand(commandText)).toThrow(
      'Use !calendar help for command syntax.',
    );
  });

  test('rejects oversized command text, IDs, titles, and descriptions', () => {
    expect(() => parseCalendarCommand(`upcoming ${'x'.repeat(2048)}`)).toThrow(
      InvalidCalendarCommandError,
    );
    expect(() => parseCalendarCommand(`event ${'x'.repeat(125)}.ics`)).toThrow(
      InvalidCalendarCommandError,
    );
    expect(() =>
      parseCalendarCommand(
        `create 2026-10-04T13:00 2026-10-04T14:00 "${'x'.repeat(121)}"`,
      ),
    ).toThrow(InvalidCalendarCommandError);
    expect(() =>
      parseCalendarCommand(
        `create 2026-10-04T13:00 2026-10-04T14:00 "title" --description "${'x'.repeat(1001)}"`,
      ),
    ).toThrow(InvalidCalendarCommandError);
  });
});

describe('isWholeEventResourceDeletable', () => {
  const eventResource = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:event@example.test
DTSTAMP:20261003T120000Z
DTSTART:20261004T130000Z
DTEND:20261004T140000Z
SUMMARY:Planning
END:VEVENT
END:VCALENDAR`;

  test('allows a single VEVENT resource and its display alarm', () => {
    expect(
      isWholeEventResourceDeletable(
        eventResource.replace(
          'END:VEVENT',
          'BEGIN:VALARM\nACTION:DISPLAY\nTRIGGER:-PT15M\nEND:VALARM\nEND:VEVENT',
        ),
      ),
    ).toBe(true);
  });

  test('allows a single master plus same-UID recurrence overrides', () => {
    expect(
      isWholeEventResourceDeletable(
        eventResource.replace(
          'END:VCALENDAR',
          'BEGIN:VEVENT\nUID:event@example.test\nRECURRENCE-ID:20261011T130000Z\nDTSTAMP:20261003T120000Z\nDTSTART:20261011T150000Z\nDTEND:20261011T160000Z\nSUMMARY:Moved\nEND:VEVENT\nEND:VCALENDAR',
        ),
      ),
    ).toBe(true);
  });

  test.each(['VTODO', 'VJOURNAL', 'X-UNKNOWN'])(
    'rejects a %s sibling',
    (name) => {
      expect(
        isWholeEventResourceDeletable(
          eventResource.replace(
            'END:VCALENDAR',
            `BEGIN:${name}\nUID:other@example.test\nEND:${name}\nEND:VCALENDAR`,
          ),
        ),
      ).toBe(false);
    },
  );

  test('rejects multiple masters, unrelated VEVENT UIDs, and malformed resources', () => {
    expect(
      isWholeEventResourceDeletable(
        eventResource.replace(
          'END:VCALENDAR',
          `${eventResource.match(/BEGIN:VEVENT[\s\S]*END:VEVENT/)?.[0]}\nEND:VCALENDAR`,
        ),
      ),
    ).toBe(false);
    expect(
      isWholeEventResourceDeletable(
        eventResource.replace(
          'END:VCALENDAR',
          eventResource
            .match(/BEGIN:VEVENT[\s\S]*END:VEVENT/)?.[0]
            .replace('event@example.test', 'other@example.test') +
            '\nEND:VCALENDAR',
        ),
      ),
    ).toBe(false);
    expect(isWholeEventResourceDeletable('not an iCalendar resource')).toBe(
      false,
    );
  });
});
