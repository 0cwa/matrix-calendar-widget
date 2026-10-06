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

import { CalendarEventInput } from '@matrix-calendar-widget/calendar';
import {
  ICalendarEventCodec,
  ICalendarEventCodecError,
} from './ICalendarEventCodec';

const foldedConference =
  'CONFERENCE;VALUE=URI;LABEL="Team";FEATURE=VIDEO;FEATURE=CHAT;' +
  'X-OPAQUE=one;X-OPAQUE=\r\n second:https://meet.example.test/room';

function calendarWithConference(...conference: string[]): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Test//EN',
    'BEGIN:VEVENT',
    'UID:meet@example.test',
    'DTSTAMP:20261001T120000Z',
    'CREATED:20261001T120000Z',
    'LAST-MODIFIED:20261001T120000Z',
    'SEQUENCE:3',
    'DTSTART:20261005T090000Z',
    'DTEND:20261005T100000Z',
    'SUMMARY:Original',
    ...conference,
    'ATTACH;VALUE=BINARY;ENCODING=BASE64:YQ==',
    'LOCATION:Room 1',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

function codec(): ICalendarEventCodec {
  return new ICalendarEventCodec(() => new Date('2026-10-06T12:00:00Z'));
}

describe('ICalendarEventCodec conference authoring', () => {
  it('creates one explicitly URI-typed conference link', () => {
    const input: CalendarEventInput = {
      uid: 'new@example.test',
      title: 'Planning',
      timing: {
        type: 'timed',
        start: { type: 'zoned', local: '2026-10-06T09:00:00', timezone: 'UTC' },
        end: { type: 'zoned', local: '2026-10-06T10:00:00', timezone: 'UTC' },
      },
      conference: {
        url: 'https://meet.example.test/room',
        label: 'Planning room',
      },
    };

    const created = codec().create('team', 'new.ics', input);

    expect(created.icalendar).toContain(
      'CONFERENCE;LABEL=Planning room;VALUE=URI:https://meet.example.test/room',
    );
    expect(created.event.externalLinks).toEqual([
      {
        kind: 'conference',
        href: 'https://meet.example.test/room',
        label: 'Planning room',
      },
    ]);
    expect(created.event).not.toHaveProperty('conference');
  });

  it('edits only URI and LABEL while retaining folded opaque parameters and siblings', () => {
    const source = calendarWithConference(foldedConference);
    const parsed = codec().parse('team', 'meet.ics', source);
    expect(parsed.event.unsupportedConference).toBeUndefined();

    const changed = parsed.applyPatch({
      conference: {
        action: 'set',
        url: 'https://meet.example.test/next',
        label: 'New; Room',
      },
    });

    expect(changed.icalendar.replace(/\r\n[ \t]/g, '')).toContain(
      'CONFERENCE;VALUE=URI;LABEL="New; Room";FEATURE=VIDEO;FEATURE=CHAT;' +
        'X-OPAQUE=one;X-OPAQUE=second:https://meet.example.test/next',
    );
    expect(changed.icalendar).toContain(
      'ATTACH;VALUE=BINARY;ENCODING=BASE64:YQ==',
    );
    expect(changed.event.externalLinks).toEqual([
      {
        kind: 'conference',
        href: 'https://meet.example.test/next',
        label: 'New; Room',
      },
    ]);
  });

  it('preserves unsupported raw conference lines on ordinary event edits', () => {
    const unsupportedLine =
      'CONFERENCE;VALUE=URI;VALUE=TEXT:https://meet.example.test/room';
    const source = calendarWithConference(unsupportedLine);
    const parsed = codec().parse('team', 'meet.ics', source);

    expect(parsed.event.unsupportedConference).toBe(true);
    expect(() =>
      parsed.applyPatch({
        conference: { action: 'set', url: 'https://meet.example.test/new' },
      }),
    ).toThrow(ICalendarEventCodecError);
    expect(() =>
      parsed.applyPatch({ conference: { action: 'remove' } }),
    ).toThrow(ICalendarEventCodecError);

    const edited = parsed.applyPatch({ title: 'Updated title' });
    expect(edited.icalendar).toContain(unsupportedLine);
    expect(edited.event.unsupportedConference).toBe(true);
  });

  it.each([
    ['missing VALUE', 'CONFERENCE:https://meet.example.test/room'],
    ['text VALUE', 'CONFERENCE;VALUE=TEXT:https://meet.example.test/room'],
    [
      'binary VALUE',
      'CONFERENCE;VALUE=BINARY;ENCODING=BASE64:aHR0cHM6Ly9tZWV0LmV4YW1wbGUudGVzdC8=',
    ],
    [
      'duplicate VALUE',
      'CONFERENCE;VALUE=URI;VALUE=URI:https://meet.example.test/room',
    ],
    [
      'duplicate LABEL',
      'CONFERENCE;VALUE=URI;LABEL=One;LABEL=Two:https://meet.example.test/room',
    ],
  ])('marks %s source properties as read-only', (_name, contentLine) => {
    const parsed = codec().parse(
      'team',
      'meet.ics',
      calendarWithConference(contentLine),
    );

    expect(parsed.event.unsupportedConference).toBe(true);
    const edited = parsed.applyPatch({ title: 'Preserve source' });
    expect(edited.icalendar).toContain(contentLine);
  });

  it('marks repeated CONFERENCE properties read-only and preserves both', () => {
    const first = 'CONFERENCE;VALUE=URI:https://meet.example.test/one';
    const second = 'CONFERENCE;VALUE=URI:https://meet.example.test/two';
    const parsed = codec().parse(
      'team',
      'meet.ics',
      calendarWithConference(first, second),
    );

    expect(parsed.event.unsupportedConference).toBe(true);
    expect(parsed.applyPatch({ title: 'Preserve source' }).icalendar).toContain(
      first,
    );
    expect(parsed.applyPatch({ title: 'Preserve source' }).icalendar).toContain(
      second,
    );
  });

  it('does not revise or normalize an identical conference set', () => {
    const source = calendarWithConference(
      'CONFERENCE;VALUE=URI;LABEL="Team":https://meet.example.test/room',
    );
    const parsed = codec().parse('team', 'meet.ics', source);

    const unchanged = parsed.applyPatch({
      title: 'Original',
      description: undefined,
      location: 'Room 1',
      timing: parsed.event.timing,
      conference: {
        action: 'set',
        url: 'https://meet.example.test/room',
        label: 'Team',
      },
    });

    expect(unchanged.icalendar).toBe(source);
    expect(unchanged.event.revision?.sequence).toBe(3);
  });

  it('keeps unrelated field edits when revision metadata cannot advance', () => {
    const source = calendarWithConference(
      'CONFERENCE;VALUE=URI;LABEL="Team":https://meet.example.test/room',
    ).replace('SEQUENCE:3', 'SEQUENCE:2147483647');
    const parsed = codec().parse('team', 'meet.ics', source);

    const changed = parsed.applyPatch({
      title: 'Updated title',
      conference: {
        action: 'set',
        url: 'https://meet.example.test/room',
        label: 'Team',
      },
    });

    expect(changed.icalendar).toContain('SUMMARY:Updated title');
    expect(changed.icalendar).toContain('SEQUENCE:2147483647');
    expect(changed.icalendar).toContain(
      'CONFERENCE;VALUE=URI;LABEL="Team":https://meet.example.test/room',
    );
  });

  it('removes only a supported conference property and its projection', () => {
    const parsed = codec().parse(
      'team',
      'meet.ics',
      calendarWithConference(
        'CONFERENCE;VALUE=URI;LABEL="Team":https://meet.example.test/room',
      ),
    );

    const removed = parsed.applyPatch({
      conference: { action: 'remove' },
    });

    expect(removed.icalendar).not.toContain('CONFERENCE');
    expect(removed.icalendar).toContain(
      'ATTACH;VALUE=BINARY;ENCODING=BASE64:YQ==',
    );
    expect(removed.event.externalLinks).toBeUndefined();
    expect(removed.event.unsupportedConference).toBeUndefined();
  });

  it('keeps raw conference lines on source and cloned occurrence components', () => {
    const rawConference =
      'CONFERENCE;VALUE=URI;VALUE=TEXT;X-OPAQUE=one;\r\n two:https://meet.example.test/room';
    const source = recurringCalendarWithConference(rawConference);
    const parsed = codec().parse('team', 'series.ics', source);

    const result = parsed.applyPatch({
      recurrence: {
        occurrence: {
          action: 'set-timing',
          recurrenceId: {
            type: 'date-time',
            value: { local: '2026-10-06T09:00:00', timezone: 'UTC' },
          },
          timing: {
            type: 'end',
            start: {
              type: 'date-time',
              value: { local: '2026-10-06T11:00:00', timezone: 'UTC' },
            },
            end: {
              type: 'date-time',
              value: { local: '2026-10-06T12:00:00', timezone: 'UTC' },
            },
          },
          viewerTimezone: 'Europe/Stockholm',
        },
      },
    });

    const blocks = rawVeventBlocks(result.icalendar);
    expect(blocks).toHaveLength(2);
    for (const block of blocks) {
      expect(block.join('\r\n')).toContain(rawConference);
    }
  });

  it('keeps raw conference lines on source and cloned following components', () => {
    const rawConference =
      'CONFERENCE;VALUE=URI;VALUE=TEXT;X-OPAQUE=one;\r\n two:https://meet.example.test/room';
    const source = recurringCalendarWithConference(rawConference);
    const parsed = codec().parse('team', 'series.ics', source);

    const result = parsed.applyPatch({
      recurrence: {
        following: {
          action: 'set-timing',
          recurrenceId: {
            type: 'date-time',
            value: { local: '2026-10-06T09:00:00', timezone: 'UTC' },
          },
          timing: {
            type: 'end',
            start: {
              type: 'date-time',
              value: { local: '2026-10-06T11:00:00', timezone: 'UTC' },
            },
            end: {
              type: 'date-time',
              value: { local: '2026-10-06T12:00:00', timezone: 'UTC' },
            },
          },
          viewerTimezone: 'Europe/Stockholm',
        },
      },
    });

    const blocks = rawVeventBlocks(result.icalendar);
    expect(blocks).toHaveLength(3);
    for (const block of blocks) {
      expect(block.join('\r\n')).toContain(rawConference);
    }
  });

  it('blocks conference writes when same-UID detached data is present', () => {
    const rawConference =
      'CONFERENCE;VALUE=URI;VALUE=TEXT:https://meet.example.test/room';
    const source = recurringCalendarWithConference(rawConference).replace(
      'END:VCALENDAR',
      [
        'BEGIN:VEVENT',
        'UID:meet@example.test',
        'RECURRENCE-ID:20261006T090000Z',
        'DTSTART:20261006T090000Z',
        'DTEND:20261006T100000Z',
        'CONFERENCE;VALUE=URI:https://meet.example.test/instance',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n'),
    );
    const parsed = codec().parse('team', 'series.ics', source);

    expect(parsed.event.unsupportedConference).toBe(true);
    expect(() =>
      parsed.applyPatch({
        conference: {
          action: 'set',
          url: 'https://meet.example.test/new',
        },
      }),
    ).toThrow(ICalendarEventCodecError);
    const titleEdit = parsed.applyPatch({ title: 'Preserve source' });
    const blocks = rawVeventBlocks(titleEdit.icalendar);
    expect(blocks[0].join('\r\n')).toContain(rawConference);
    expect(blocks[1].join('\r\n')).toContain(
      'CONFERENCE;VALUE=URI:https://meet.example.test/instance',
    );
    expect(titleEdit.icalendar).toContain(
      'CONFERENCE;VALUE=URI:https://meet.example.test/instance',
    );
  });

  it('blocks conference writes when duplicate same-UID masters exist', () => {
    const conference = 'CONFERENCE;VALUE=URI:https://meet.example.test/room';
    const eventBody = calendarWithConference(conference)
      .split('BEGIN:VEVENT\r\n')[1]
      .split('\r\nEND:VEVENT')[0];
    const source = calendarWithConference(conference).replace(
      'END:VCALENDAR',
      ['BEGIN:VEVENT', eventBody, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n'),
    );
    const parsed = codec().parse('team', 'duplicate-master.ics', source);

    expect(parsed.event.unsupportedConference).toBe(true);
    expect(() =>
      parsed.applyPatch({ conference: { action: 'remove' } }),
    ).toThrow(ICalendarEventCodecError);
    expect(parsed.applyPatch({ title: 'Ordinary edit' }).icalendar).toContain(
      conference,
    );
  });
});

function recurringCalendarWithConference(conference: string): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Test//EN',
    'BEGIN:VEVENT',
    'UID:meet@example.test',
    'DTSTAMP:20261001T120000Z',
    'CREATED:20261001T120000Z',
    'LAST-MODIFIED:20261001T120000Z',
    'SEQUENCE:3',
    'DTSTART:20261005T090000Z',
    'DTEND:20261005T100000Z',
    'SUMMARY:Original',
    'RRULE:FREQ=DAILY;COUNT=3',
    conference,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

function rawVeventBlocks(source: string): string[][] {
  const blocks: string[][] = [];
  let current: string[] | undefined;
  for (const line of source.split(/\r\n|\n|\r/)) {
    if (/^BEGIN:VEVENT$/i.test(line)) {
      current = [line];
    } else if (current) {
      current.push(line);
      if (/^END:VEVENT$/i.test(line)) {
        blocks.push(current);
        current = undefined;
      }
    }
  }
  return blocks;
}
