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

import { readFileSync } from 'fs';
import { join } from 'path';
import ICAL from 'ical.js';
import {
  ICalendarEventCodec,
  ICalendarEventCodecError,
} from './ICalendarEventCodec';

const codec = new ICalendarEventCodec();
const identity = {
  calendarId: 'team',
  eventId: 'resource.ics',
};

describe('ICalendarEventCodec', () => {
  it('decodes the supported timed VEVENT fields', () => {
    const decoded = codec.decode(fixture('simple-timed.ics'), identity);

    expect(decoded.event).toEqual({
      id: 'resource.ics',
      calendarId: 'team',
      uid: 'simple-timed@example.test',
      title: 'Team planning',
      description: 'Planning session for the team.',
      timing: {
        type: 'timed',
        start: {
          local: '2026-09-23T09:00:00',
          timezone: 'Europe/Stockholm',
        },
        end: {
          local: '2026-09-23T10:00:00',
          timezone: 'Europe/Stockholm',
        },
      },
      status: 'confirmed',
      transparency: 'opaque',
      location: 'Room 3',
      url: 'https://example.test/events/simple-timed',
      categories: ['TEAM', 'PLANNING'],
      priority: 5,
    });
    expect(decoded.source).toBe(fixture('simple-timed.ics'));
  });

  it('decodes all-day DATE values with exclusive DTEND semantics', () => {
    const decoded = codec.decode(fixture('all-day.ics'), identity);

    expect(decoded.event.timing).toEqual({
      type: 'all-day',
      startDate: '2026-10-05',
      endDate: '2026-10-06',
    });
    expect(decoded.event.transparency).toBe('transparent');
  });

  it('decodes folded and escaped text through ical.js', () => {
    const decoded = codec.decode(fixture('folded-escaped.ics'), identity);

    expect(decoded.event.title).toBe(
      'Escaped, semicolon; and backslash\\ text',
    );
    expect(decoded.event.description).toContain('First line\nSecond line');
    expect(decoded.event.description).toContain(
      'long folded value that continues',
    );
    expect(decoded.event.location).toBe('Building A, Floor 2');
  });

  it('patches supported fields without dropping unknown calendar or event properties', () => {
    const source = fixture('unknown-properties.ics');
    const decoded = codec.decode(source, identity);
    const encoded = codec.encode(source, {
      ...decoded.event,
      title: 'Edited title',
      description: 'Added by Matrix Calendar',
      categories: ['TEAM', 'EDITED'],
      priority: 7,
    });

    expect(encoded).toContain('SUMMARY:Edited title');
    expect(encoded).toContain('DESCRIPTION:Added by Matrix Calendar');
    expect(encoded).toContain('X-CUSTOM-CALENDAR-PROPERTY:preserve-calendar-value');
    expect(encoded).toContain('X-CUSTOM-FLAG:preserve-me');
    expect(encoded).toContain('X-PARAM=preserve-param');
    expect(encoded).toContain('ATTACH;FMTTYPE=application/pdf:');
    expect(reparse(encoded)).not.toThrow();
  });

  it('preserves alarms, attendees, and VTIMEZONE components while editing', () => {
    for (const fixtureName of [
      'alarm.ics',
      'attendees.ics',
      'vtimezone.ics',
    ]) {
      const source = fixture(fixtureName);
      const decoded = codec.decode(source, identity);
      const encoded = codec.encode(source, {
        ...decoded.event,
        title: `Edited ${decoded.event.title}`,
      });

      expect(encoded).toContain('SUMMARY:Edited ');
      if (fixtureName === 'alarm.ics') {
        expect(encoded).toContain('BEGIN:VALARM');
        expect(encoded).toContain('TRIGGER:-PT15M');
      }
      if (fixtureName === 'attendees.ics') {
        expect(encoded).toContain('ORGANIZER;CN=Alice Example:');
        expect(encoded).toContain('ATTENDEE;CN=Bob Example;');
        expect(encoded).toContain('SEQUENCE:2');
      }
      if (fixtureName === 'vtimezone.ics') {
        expect(encoded).toContain('BEGIN:VTIMEZONE');
        expect(encoded).toContain('TZID:Europe/Stockholm');
      }
      expect(reparse(encoded)).not.toThrow();
    }
  });

  it('round-trips named timezones and all-day timing changes', () => {
    const timedSource = fixture('simple-timed.ics');
    const timed = codec.decode(timedSource, identity);
    const timedEncoded = codec.encode(timedSource, {
      ...timed.event,
      timing: {
        type: 'timed',
        start: {
          local: '2026-09-23T11:30:00',
          timezone: 'Europe/Stockholm',
        },
        end: {
          local: '2026-09-23T12:45:00',
          timezone: 'Europe/Stockholm',
        },
      },
    });

    const timedAgain = codec.decode(timedEncoded, identity);
    expect(timedAgain.event.timing).toEqual({
      type: 'timed',
      start: {
        local: '2026-09-23T11:30:00',
        timezone: 'Europe/Stockholm',
      },
      end: {
        local: '2026-09-23T12:45:00',
        timezone: 'Europe/Stockholm',
      },
    });

    const allDaySource = fixture('all-day.ics');
    const allDay = codec.decode(allDaySource, identity);
    const allDayEncoded = codec.encode(allDaySource, {
      ...allDay.event,
      timing: {
        type: 'all-day',
        startDate: '2026-10-07',
        endDate: '2026-10-09',
      },
    });

    expect(codec.decode(allDayEncoded, identity).event.timing).toEqual({
      type: 'all-day',
      startDate: '2026-10-07',
      endDate: '2026-10-09',
    });
  });

  it('fails closed for floating times the product model cannot represent', () => {
    const source = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:floating@example.test
DTSTART:20261001T090000
DTEND:20261001T100000
SUMMARY:Floating
END:VEVENT
END:VCALENDAR
`;

    expect(() => codec.decode(source, identity)).toThrow(
      new ICalendarEventCodecError(
        'DTSTART uses a floating time; a named timezone or UTC is required',
      ),
    );
  });
});

function fixture(name: string): string {
  return readFileSync(join(process.cwd(), '..', 'fixtures', 'ical', name), 'utf8');
}

function reparse(value: string): () => void {
  return () => {
    ICAL.parse(value);
  };
}
