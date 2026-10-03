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

import ICAL from 'ical.js';
import { ICalendarEventCodec } from './ICalendarEventCodec';

describe('ICalendarEventCodec weekly BYDAY recurrence edits', () => {
  it('replaces the RRULE and preserves unrelated calendar resource properties', () => {
    const source = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Matrix Calendar Widget//EN',
      'X-CALENDAR-MARKER;X-KEEP=calendar:calendar-value',
      'BEGIN:VEVENT',
      'UID:weekly-preserve@example.test',
      'DTSTAMP:20261001T120000Z',
      'DTSTART;TZID=Europe/Stockholm:20261026T090000',
      'DTEND;TZID=Europe/Stockholm:20261026T100000',
      'SUMMARY:Planning',
      'RRULE:FREQ=WEEKLY;COUNT=3',
      'X-EVENT-MARKER;X-KEEP=event:event-value',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'TRIGGER:-PT15M',
      'DESCRIPTION:Planning reminder',
      'X-ALARM-MARKER:alarm-value',
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const codec = new ICalendarEventCodec();
    const parsed = codec.parse('team', 'weekly-preserve.ics', source);
    const encoded = parsed.applyPatch({
      recurrence: {
        rrule: 'FREQ=WEEKLY;INTERVAL=3;BYDAY=MO,FR;COUNT=5',
      },
    });
    const calendar = ICAL.Component.fromString(encoded.icalendar);
    const vevent = calendar.getFirstSubcomponent('vevent');

    expect(vevent).not.toBeNull();
    expect(vevent?.getAllProperties('rrule')).toHaveLength(1);
    expect(encoded.event.recurrence).toEqual({
      rrule: 'FREQ=WEEKLY;COUNT=5;INTERVAL=3;BYDAY=MO,FR',
    });
    expect(encoded.icalendar).toContain(
      'X-CALENDAR-MARKER;X-KEEP=calendar:calendar-value',
    );
    expect(encoded.icalendar).toContain(
      'X-EVENT-MARKER;X-KEEP=event:event-value',
    );
    expect(encoded.icalendar).toContain('X-ALARM-MARKER:alarm-value');
    expect(vevent?.getFirstSubcomponent('valarm')).not.toBeNull();

    const reparsed = codec.parse(
      'team',
      'weekly-preserve.ics',
      encoded.icalendar,
    );
    expect(reparsed.event.recurrence).toEqual(encoded.event.recurrence);
  });
});
