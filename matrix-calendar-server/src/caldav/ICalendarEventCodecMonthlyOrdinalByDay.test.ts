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
import {
  ICalendarEventCodec,
  ICalendarEventCodecError,
} from './ICalendarEventCodec';

describe('ICalendarEventCodec monthly ordinal BYDAY recurrence edits', () => {
  const codec = new ICalendarEventCodec();

  it('round-trips a supported ordinal rule and preserves unrelated properties', () => {
    const source = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Matrix Calendar Widget//EN',
      'X-CALENDAR-MARKER;X-KEEP=calendar:calendar-value',
      'BEGIN:VEVENT',
      'UID:monthly-ordinal@example.test',
      'DTSTAMP:20261001T120000Z',
      'DTSTART:20261030T090000',
      'DTEND:20261030T100000',
      'SUMMARY:Planning',
      'RRULE:FREQ=MONTHLY;BYDAY=-1FR;COUNT=4',
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
    const parsed = codec.parse('team', 'monthly-ordinal.ics', source);
    const preserved = parsed.applyPatch({ title: 'Renamed planning' });
    expect(() =>
      parsed.applyPatch({
        timing: {
          type: 'timed',
          start: { type: 'floating', local: '2026-10-23T09:00:00' },
          end: { type: 'floating', local: '2026-10-23T10:00:00' },
        },
      }),
    ).toThrow(
      new ICalendarEventCodecError(
        'unsupported-patch',
        'Only simple whole-series RRULE changes are supported',
      ),
    );
    expect(() =>
      parsed.applyPatch({
        timing: {
          type: 'timed',
          start: { type: 'floating', local: '2026-10-23T09:00:00' },
          end: { type: 'floating', local: '2026-10-23T10:00:00' },
        },
        recurrence: {
          exdate: {
            action: 'add',
            recurrenceId: {
              type: 'floating-date-time',
              value: '2026-10-30T09:00:00',
            },
          },
        },
      }),
    ).toThrow(
      new ICalendarEventCodecError(
        'unsupported-patch',
        'Only simple whole-series RRULE changes are supported',
      ),
    );
    const updated = parsed.applyPatch({
      recurrence: {
        rrule: 'FREQ=MONTHLY;INTERVAL=2;BYDAY=-1FR;UNTIL=20261225T235959',
      },
    });
    const calendar = ICAL.Component.fromString(updated.icalendar);
    const vevent = calendar.getFirstSubcomponent('vevent');
    const canonicalRule = ICAL.Recur.fromString(
      'FREQ=MONTHLY;INTERVAL=2;BYDAY=-1FR;UNTIL=20261225T235959',
    ).toString();
    const preservedEvent = ICAL.Component.fromString(
      preserved.icalendar,
    ).getFirstSubcomponent('vevent');

    expect(preservedEvent?.getFirstPropertyValue('rrule')?.toString()).toBe(
      ICAL.Recur.fromString('FREQ=MONTHLY;BYDAY=-1FR;COUNT=4').toString(),
    );
    expect(updated.event.recurrence?.rrule).toBe(canonicalRule);
    expect(vevent?.getFirstPropertyValue('rrule')?.toString()).toBe(
      canonicalRule,
    );
    expect(calendar.getFirstPropertyValue('x-calendar-marker')).toBe(
      'calendar-value',
    );
    expect(vevent?.getFirstPropertyValue('x-event-marker')).toBe('event-value');
    expect(vevent?.getFirstSubcomponent('valarm')).not.toBeNull();
    expect(
      vevent
        ?.getFirstSubcomponent('valarm')
        ?.getFirstPropertyValue('x-alarm-marker'),
    ).toBe('alarm-value');

    const reparsed = codec.parse(
      'team',
      'monthly-ordinal.ics',
      updated.icalendar,
    );
    expect(reparsed.event.recurrence).toEqual(updated.event.recurrence);
  });

  it('keeps unsupported ordinal combinations opaque and rejects authoring them', () => {
    const rrule = 'FREQ=MONTHLY;BYDAY=2MO,3WE';
    const source = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Matrix Calendar Widget//EN',
      'BEGIN:VEVENT',
      'UID:unsupported-monthly-ordinal@example.test',
      'DTSTAMP:20261001T120000Z',
      'DTSTART:20261012T090000',
      'DTEND:20261012T100000',
      'SUMMARY:Planning',
      `RRULE:${rrule}`,
      'X-EVENT-MARKER:keep-me',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const parsed = codec.parse('team', 'unsupported-monthly.ics', source);
    const canonicalRule = ICAL.Recur.fromString(rrule).toString();

    expect(() =>
      parsed.applyPatch({
        recurrence: { rrule: 'FREQ=MONTHLY;BYDAY=2MO,3WE' },
      }),
    ).toThrow(
      new ICalendarEventCodecError(
        'unsupported-patch',
        'Only simple whole-series RRULE changes are supported',
      ),
    );

    const renamed = parsed.applyPatch({ title: 'Renamed planning' });
    const vevent = ICAL.Component.fromString(
      renamed.icalendar,
    ).getFirstSubcomponent('vevent');
    expect(vevent?.getFirstPropertyValue('rrule')?.toString()).toBe(
      canonicalRule,
    );
    expect(vevent?.getFirstPropertyValue('x-event-marker')).toBe('keep-me');
  });
});
