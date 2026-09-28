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

import fs from 'fs';
import ICAL from 'ical.js';
import path from 'path';
import {
  ICalendarEventCodec,
  ICalendarEventCodecError,
} from './ICalendarEventCodec';

const codec = new ICalendarEventCodec();

describe('ICalendarEventCodec', () => {
  it('decodes supported VEVENT fields into the calendar domain', () => {
    const parsed = codec.parse(
      'team',
      'simple-timed.ics',
      fixture('simple-timed.ics'),
    );

    expect(parsed.event).toMatchObject({
      id: 'simple-timed.ics',
      calendarId: 'team',
      uid: 'simple-timed@example.test',
      title: 'Team planning',
      description: 'Planning session for the team.',
      timing: {
        type: 'timed',
        start: {
          type: 'zoned',
          local: '2026-09-23T09:00:00',
          timezone: 'Europe/Stockholm',
        },
        end: {
          type: 'zoned',
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
  });

  it('round-trips all-day DATE timing while patching supported fields', () => {
    const parsed = codec.parse('team', 'all-day.ics', fixture('all-day.ics'));

    const encoded = parsed.applyPatch({
      title: 'Updated company holiday',
      description: 'Office closed',
    });

    expect(encoded.event.timing).toEqual({
      type: 'all-day',
      startDate: '2026-10-05',
      endDate: '2026-10-06',
    });

    const reparsed = codec.parse('team', 'all-day.ics', encoded.icalendar);
    expect(reparsed.event.title).toBe('Updated company holiday');
    expect(reparsed.event.description).toBe('Office closed');
    expect(reparsed.event.timing).toEqual(parsed.event.timing);
  });

  it('round-trips named TZID values and preserves VTIMEZONE', () => {
    const parsed = codec.parse(
      'team',
      'vtimezone.ics',
      fixture('vtimezone.ics'),
    );

    expect(parsed.event.timing).toEqual({
      type: 'timed',
      start: {
        type: 'zoned',
        local: '2026-10-26T09:00:00',
        timezone: 'Europe/Stockholm',
      },
      end: {
        type: 'zoned',
        local: '2026-10-26T10:00:00',
        timezone: 'Europe/Stockholm',
      },
    });

    const encoded = parsed.applyPatch({ title: 'Updated timezone event' });
    const calendar = ICAL.Component.fromString(encoded.icalendar);

    expect(calendar.getFirstSubcomponent('vtimezone')).not.toBeNull();
    expect(
      calendar.getFirstSubcomponent('vtimezone')?.getFirstPropertyValue('tzid'),
    ).toBe('Europe/Stockholm');

    const reparsed = codec.parse('team', 'vtimezone.ics', encoded.icalendar);
    expect(reparsed.event.timing).toEqual(parsed.event.timing);
  });

  it('reads and preserves master floating DATE-TIME values on a non-timing patch', () => {
    const parsed = codec.parse(
      'team',
      'floating-timed.ics',
      fixture('floating-timed.ics'),
    );

    expect(parsed.event.timing).toEqual({
      type: 'timed',
      start: { type: 'floating', local: '2026-09-23T09:00:00' },
      end: { type: 'floating', local: '2026-09-23T10:00:00' },
    });

    const encoded = parsed.applyPatch({ title: 'Updated floating planning' });
    const calendar = ICAL.Component.fromString(encoded.icalendar);
    const vevent = calendar.getFirstSubcomponent('vevent')!;
    const start = vevent.getFirstProperty('dtstart')!;
    const end = vevent.getFirstProperty('dtend')!;

    expect(start.getFirstParameter('tzid')).toBeUndefined();
    expect(end.getFirstParameter('tzid')).toBeUndefined();
    expect(start.getFirstValue()?.toString()).toBe('2026-09-23T09:00:00');
    expect(end.getFirstValue()?.toString()).toBe('2026-09-23T10:00:00');
    expect(vevent.getFirstPropertyValue('x-client-marker')).toBe(
      'preserve-floating',
    );
    expect(
      codec.parse('team', 'floating-timed.ics', encoded.icalendar).event.timing,
    ).toEqual(parsed.event.timing);
  });

  it('writes and reparses floating timing patches without TZID or UTC markers', () => {
    const parsed = codec.parse(
      'team',
      'simple-timed.ics',
      fixture('simple-timed.ics'),
    );

    const encoded = parsed.applyPatch({
      timing: {
        type: 'timed',
        start: { type: 'floating', local: '2026-09-24T11:30:00' },
        end: { type: 'floating', local: '2026-09-24T12:15:00' },
      },
    });
    const vevent = ICAL.Component.fromString(
      encoded.icalendar,
    ).getFirstSubcomponent('vevent')!;
    const start = vevent.getFirstProperty('dtstart')!;
    const end = vevent.getFirstProperty('dtend')!;

    expect(start.getFirstParameter('tzid')).toBeUndefined();
    expect(end.getFirstParameter('tzid')).toBeUndefined();
    expect(start.getFirstValue()?.toString()).toBe('2026-09-24T11:30:00');
    expect(end.getFirstValue()?.toString()).toBe('2026-09-24T12:15:00');
    expect(encoded.icalendar).not.toContain('TZID=');
    expect(encoded.icalendar).not.toMatch(/DTSTART[^\r\n]*Z/);
    expect(encoded.icalendar).not.toMatch(/DTEND[^\r\n]*Z/);
    expect(
      codec.parse('team', 'simple-timed.ics', encoded.icalendar).event.timing,
    ).toEqual(encoded.event.timing);
  });

  it('keeps UTC master DATE-TIME endpoints tagged as zoned UTC', () => {
    const icalendar = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Matrix Calendar Widget//Tests//EN',
      'BEGIN:VEVENT',
      'UID:utc-master@example.test',
      'DTSTAMP:20260922T120000Z',
      'DTSTART:20260923T090000Z',
      'DTEND:20260923T100000Z',
      'SUMMARY:UTC event',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const parsed = codec.parse('team', 'utc-master.ics', icalendar);

    expect(parsed.event.timing).toEqual({
      type: 'timed',
      start: {
        type: 'zoned',
        local: '2026-09-23T09:00:00',
        timezone: 'UTC',
      },
      end: {
        type: 'zoned',
        local: '2026-09-23T10:00:00',
        timezone: 'UTC',
      },
    });
  });

  it('preserves floating and zoned master endpoints independently', () => {
    const icalendar = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Matrix Calendar Widget//Tests//EN',
      'BEGIN:VEVENT',
      'UID:mixed-master@example.test',
      'DTSTAMP:20260922T120000Z',
      'DTSTART:20260923T090000',
      'DTEND;TZID=Europe/Stockholm:20260923T100000',
      'SUMMARY:Mixed endpoint event',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const parsed = codec.parse('team', 'mixed-master.ics', icalendar);

    expect(parsed.event.timing).toEqual({
      type: 'timed',
      start: { type: 'floating', local: '2026-09-23T09:00:00' },
      end: {
        type: 'zoned',
        local: '2026-09-23T10:00:00',
        timezone: 'Europe/Stockholm',
      },
    });

    const patched = codec.parse(
      'team',
      'mixed-master.ics',
      parsed.applyPatch({ title: 'Renamed mixed endpoint event' }).icalendar,
    );
    expect(patched.event.timing).toEqual(parsed.event.timing);

    const timingPatch = parsed.applyPatch({
      timing: {
        type: 'timed',
        start: { type: 'floating', local: '2026-09-23T11:00:00' },
        end: {
          type: 'zoned',
          local: '2026-09-23T12:00:00',
          timezone: 'Europe/Stockholm',
        },
      },
    });
    const vevent = ICAL.Component.fromString(
      timingPatch.icalendar,
    ).getFirstSubcomponent('vevent')!;
    expect(
      vevent.getFirstProperty('dtstart')?.getFirstParameter('tzid'),
    ).toBeUndefined();
    expect(vevent.getFirstProperty('dtend')?.getFirstParameter('tzid')).toBe(
      'Europe/Stockholm',
    );
    expect(
      codec.parse('team', 'mixed-master.ics', timingPatch.icalendar).event
        .timing,
    ).toEqual(timingPatch.event.timing);
  });

  it('preserves different endpoint TZIDs through title and timing patches', () => {
    const icalendar = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Matrix Calendar Widget//Tests//EN',
      'BEGIN:VEVENT',
      'UID:two-zones@example.test',
      'DTSTAMP:20260922T120000Z',
      'DTSTART;TZID=Europe/Stockholm:20260923T100000',
      'DTEND;TZID=America/New_York:20260923T053000',
      'SUMMARY:Two-zone event',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const parsed = codec.parse('team', 'two-zones.ics', icalendar);

    expect(parsed.event.timing).toEqual({
      type: 'timed',
      start: {
        type: 'zoned',
        local: '2026-09-23T10:00:00',
        timezone: 'Europe/Stockholm',
      },
      end: {
        type: 'zoned',
        local: '2026-09-23T05:30:00',
        timezone: 'America/New_York',
      },
    });

    const titlePatch = parsed.applyPatch({ title: 'Renamed two-zone event' });
    expect(titlePatch.icalendar).toContain(
      'DTSTART;TZID=Europe/Stockholm:20260923T100000',
    );
    expect(titlePatch.icalendar).toContain(
      'DTEND;TZID=America/New_York:20260923T053000',
    );

    const timingPatch = parsed.applyPatch({
      timing: {
        type: 'timed',
        start: {
          type: 'zoned',
          local: '2026-09-23T10:15:00',
          timezone: 'Europe/Stockholm',
        },
        end: {
          type: 'zoned',
          local: '2026-09-23T05:45:00',
          timezone: 'America/New_York',
        },
      },
    });
    expect(
      codec.parse('team', 'two-zones.ics', timingPatch.icalendar).event.timing,
    ).toEqual(timingPatch.event.timing);
  });

  it('rejects a master VEVENT with missing DTEND rather than inferring timing', () => {
    const withoutEnd = fixture('simple-timed.ics').replace(
      /DTEND;TZID=Europe\/Stockholm:20260923T100000\r?\n/,
      '',
    );

    let thrown: unknown;
    try {
      codec.parse('team', 'missing-end.ics', withoutEnd);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      code: 'missing-timing',
      message: 'VEVENT must contain DTSTART and DTEND',
    });
  });

  it('reads recurrence data and preserves a complete recurring resource on master patch', () => {
    const parsed = codec.parse(
      'team',
      'recurrence-override.ics',
      fixture('recurrence-override.ics'),
    );

    expect(parsed.event.recurrence).toEqual({
      rrule: 'FREQ=WEEKLY;COUNT=4',
      rdates: [
        {
          type: 'date-time',
          value: {
            local: '2026-10-26T14:00:00',
            timezone: 'Europe/Stockholm',
          },
        },
        {
          type: 'period',
          timing: {
            type: 'end',
            start: {
              type: 'date-time',
              value: {
                local: '2026-10-28T14:00:00',
                timezone: 'Europe/Stockholm',
              },
            },
            end: {
              type: 'date-time',
              value: {
                local: '2026-10-28T15:30:00',
                timezone: 'Europe/Stockholm',
              },
            },
          },
        },
        {
          type: 'period',
          timing: {
            type: 'duration',
            start: {
              type: 'date-time',
              value: {
                local: '2026-10-29T14:00:00',
                timezone: 'Europe/Stockholm',
              },
            },
            duration: {
              weeks: 0,
              days: 0,
              hours: 1,
              minutes: 30,
              seconds: 0,
              isNegative: false,
            },
          },
        },
      ],
      exdates: [
        {
          type: 'date-time',
          value: {
            local: '2026-11-02T14:00:00',
            timezone: 'Europe/Stockholm',
          },
        },
      ],
      overrides: [
        {
          recurrenceId: {
            type: 'date-time',
            value: {
              local: '2026-10-12T14:00:00',
              timezone: 'Europe/Stockholm',
            },
          },
          timing: {
            type: 'duration',
            start: {
              type: 'date-time',
              value: {
                local: '2026-10-12T16:00:00',
                timezone: 'Europe/Stockholm',
              },
            },
            duration: {
              weeks: 0,
              days: 0,
              hours: 1,
              minutes: 0,
              seconds: 0,
              isNegative: false,
            },
          },
        },
        {
          recurrenceId: {
            type: 'date-time',
            value: {
              local: '2026-10-19T14:00:00',
              timezone: 'Europe/Stockholm',
            },
          },
          timing: {
            type: 'end',
            start: {
              type: 'date-time',
              value: {
                local: '2026-10-19T14:00:00',
                timezone: 'Europe/Stockholm',
              },
            },
            end: {
              type: 'date-time',
              value: {
                local: '2026-10-19T15:00:00',
                timezone: 'Europe/Stockholm',
              },
            },
          },
          status: 'cancelled',
        },
      ],
    });

    const encoded = parsed.applyPatch({ title: 'Updated weekly review' });
    const calendar = ICAL.Component.fromString(encoded.icalendar);
    const events = calendar.getAllSubcomponents('vevent');
    const timezone = calendar.getFirstSubcomponent('vtimezone');

    expect(events).toHaveLength(3);
    expect(timezone).not.toBeNull();
    expect(timezone?.getFirstPropertyValue('tzid')).toBe('Europe/Stockholm');
    expect(calendar.getFirstPropertyValue('x-custom-calendar-property')).toBe(
      'preserve-resource-value',
    );
    expect(events[0].getFirstPropertyValue('summary')).toBe(
      'Updated weekly review',
    );
    expect(
      events[0].getFirstProperty('x-client-metadata')?.getFirstValue(),
    ).toBe('preserve-value');
    expect(events[1].getFirstPropertyValue('recurrence-id')?.toString()).toBe(
      '2026-10-12T14:00:00',
    );
    expect(events[1].getFirstPropertyValue('dtstart')?.toString()).toBe(
      '2026-10-12T16:00:00',
    );
    expect(events[1].getFirstPropertyValue('duration')?.toString()).toBe(
      'PT1H',
    );
    expect(events[1].getFirstProperty('dtend')).toBeNull();
    expect(events[1].getFirstPropertyValue('summary')).toBe(
      'Weekly review - moved',
    );
    expect(
      events[1].getFirstProperty('x-override-marker')?.getFirstValue(),
    ).toBe('preserve-exception');
    expect(events[2].getFirstPropertyValue('recurrence-id')?.toString()).toBe(
      '2026-10-19T14:00:00',
    );
    expect(events[2].getFirstPropertyValue('status')).toBe('CANCELLED');
    expect(
      events[2].getFirstProperty('x-override-marker')?.getFirstValue(),
    ).toBe('preserve-cancellation');

    const reparsed = codec.parse(
      'team',
      'recurrence-override.ics',
      encoded.icalendar,
    );
    expect(reparsed.event.recurrence).toEqual(parsed.event.recurrence);
  });

  it('preserves floating recurrence wall time and RFC duration units', () => {
    const parsed = codec.parse(
      'team',
      'recurrence-floating-duration.ics',
      fixture('recurrence-floating-duration.ics'),
    );

    expect(parsed.event.recurrence).toMatchObject({
      rdates: [
        {
          type: 'period',
          timing: {
            type: 'duration',
            start: {
              type: 'date-time',
              value: {
                local: '2026-03-29T01:30:00',
                timezone: 'Europe/Stockholm',
              },
            },
            duration: {
              weeks: 0,
              days: 0,
              hours: 1,
              minutes: 0,
              seconds: 0,
              isNegative: false,
            },
          },
        },
        {
          type: 'period',
          timing: {
            type: 'duration',
            start: {
              type: 'date-time',
              value: {
                local: '2026-03-28T01:30:00',
                timezone: 'Europe/Stockholm',
              },
            },
            duration: {
              weeks: 0,
              days: 1,
              hours: 0,
              minutes: 0,
              seconds: 0,
              isNegative: false,
            },
          },
        },
        {
          type: 'period',
          timing: {
            type: 'duration',
            start: {
              type: 'date-time',
              value: {
                local: '2026-03-22T01:30:00',
                timezone: 'Europe/Stockholm',
              },
            },
            duration: {
              weeks: 1,
              days: 0,
              hours: 0,
              minutes: 0,
              seconds: 0,
              isNegative: false,
            },
          },
        },
        {
          type: 'period',
          timing: {
            type: 'duration',
            start: {
              type: 'floating-date-time',
              value: '2026-03-29T01:30:00',
            },
            duration: {
              weeks: 0,
              days: 0,
              hours: 1,
              minutes: 0,
              seconds: 0,
              isNegative: false,
            },
          },
        },
      ],
      exdates: [
        {
          type: 'floating-date-time',
          value: '2026-03-29T01:30:00',
        },
      ],
      overrides: [
        {
          recurrenceId: {
            type: 'date-time',
            value: {
              local: '2026-03-29T01:30:00',
              timezone: 'Europe/Stockholm',
            },
          },
          timing: {
            type: 'duration',
            start: {
              type: 'date-time',
              value: {
                local: '2026-03-29T01:30:00',
                timezone: 'Europe/Stockholm',
              },
            },
            duration: {
              weeks: 0,
              days: 0,
              hours: 1,
              minutes: 0,
              seconds: 0,
              isNegative: false,
            },
          },
        },
      ],
    });

    const periodTimings = parsed.event.recurrence?.rdates?.flatMap((date) =>
      date.type === 'period' ? [date.timing] : [],
    );
    expect(periodTimings).toEqual([
      {
        type: 'duration',
        start: {
          type: 'date-time',
          value: {
            local: '2026-03-29T01:30:00',
            timezone: 'Europe/Stockholm',
          },
        },
        duration: {
          weeks: 0,
          days: 0,
          hours: 1,
          minutes: 0,
          seconds: 0,
          isNegative: false,
        },
      },
      {
        type: 'duration',
        start: {
          type: 'date-time',
          value: {
            local: '2026-03-28T01:30:00',
            timezone: 'Europe/Stockholm',
          },
        },
        duration: {
          weeks: 0,
          days: 1,
          hours: 0,
          minutes: 0,
          seconds: 0,
          isNegative: false,
        },
      },
      {
        type: 'duration',
        start: {
          type: 'date-time',
          value: {
            local: '2026-03-22T01:30:00',
            timezone: 'Europe/Stockholm',
          },
        },
        duration: {
          weeks: 1,
          days: 0,
          hours: 0,
          minutes: 0,
          seconds: 0,
          isNegative: false,
        },
      },
      {
        type: 'duration',
        start: {
          type: 'floating-date-time',
          value: '2026-03-29T01:30:00',
        },
        duration: {
          weeks: 0,
          days: 0,
          hours: 1,
          minutes: 0,
          seconds: 0,
          isNegative: false,
        },
      },
    ]);
  });

  it('preserves floating RECURRENCE-ID and detached duration wall time', () => {
    const parsed = codec.parse(
      'team',
      'recurrence-floating-override.ics',
      fixture('recurrence-floating-override.ics'),
    );

    expect(parsed.event.recurrence?.overrides).toEqual([
      {
        recurrenceId: {
          type: 'floating-date-time',
          value: '2026-10-12T14:00:00',
        },
        timing: {
          type: 'duration',
          start: {
            type: 'floating-date-time',
            value: '2026-10-12T16:00:00',
          },
          duration: {
            weeks: 0,
            days: 0,
            hours: 1,
            minutes: 0,
            seconds: 0,
            isNegative: false,
          },
        },
      },
    ]);
  });

  it('preserves UTC recurrence dates and detached identities', () => {
    const parsed = codec.parse(
      'team',
      'recurrence-utc.ics',
      fixture('recurrence-utc.ics'),
    );

    expect(parsed.event.recurrence).toEqual({
      rrule: 'FREQ=WEEKLY;COUNT=2',
      rdates: [
        {
          type: 'date-time',
          value: {
            local: '2026-11-01T14:00:00',
            timezone: 'UTC',
          },
        },
      ],
      overrides: [
        {
          recurrenceId: {
            type: 'date-time',
            value: {
              local: '2026-11-01T14:00:00',
              timezone: 'UTC',
            },
          },
          timing: {
            type: 'end',
            start: {
              type: 'date-time',
              value: {
                local: '2026-11-01T16:00:00',
                timezone: 'UTC',
              },
            },
            end: {
              type: 'date-time',
              value: {
                local: '2026-11-01T17:00:00',
                timezone: 'UTC',
              },
            },
          },
        },
      ],
    });
  });

  it('preserves unknown calendar and VEVENT properties on patch', () => {
    const parsed = codec.parse(
      'team',
      'unknown-properties.ics',
      fixture('unknown-properties.ics'),
    );

    const encoded = parsed.applyPatch({ title: 'Updated summary' });
    const calendar = ICAL.Component.fromString(encoded.icalendar);
    const event = calendar.getFirstSubcomponent('vevent');

    expect(calendar.getFirstPropertyValue('x-custom-calendar-property')).toBe(
      'preserve-calendar-value',
    );
    expect(event?.getFirstPropertyValue('x-custom-flag')).toBe('preserve-me');

    const metadata = event?.getFirstProperty('x-client-metadata');
    expect(metadata?.getFirstParameter('x-param')).toBe('preserve-param');
    expect(metadata?.getFirstValue()).toBe('preserve-value');

    const attachment = event?.getFirstProperty('attach');
    expect(attachment?.getFirstParameter('fmttype')).toBe('application/pdf');
    expect(attachment?.getFirstValue()).toBe(
      'https://example.test/files/agenda.pdf',
    );
  });

  it('preserves VALARM subcomponents on patch', () => {
    const parsed = codec.parse('team', 'alarm.ics', fixture('alarm.ics'));

    const encoded = parsed.applyPatch({ location: 'Release room' });
    const event = ICAL.Component.fromString(
      encoded.icalendar,
    ).getFirstSubcomponent('vevent');
    const alarm = event?.getFirstSubcomponent('valarm');

    expect(alarm?.getFirstPropertyValue('action')).toBe('DISPLAY');
    expect(alarm?.getFirstPropertyValue('trigger')?.toString()).toBe('-PT15M');
    expect(alarm?.getFirstPropertyValue('description')).toBe(
      'Release checkpoint starts in 15 minutes',
    );
  });

  it('preserves a sibling VTODO component when patching a VEVENT', () => {
    const parsed = codec.parse(
      'team',
      'mixed-components.ics',
      `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Matrix Calendar Widget//EN
BEGIN:VEVENT
UID:event@example.test
DTSTART:20260923T090000Z
DTEND:20260923T100000Z
SUMMARY:Team planning
END:VEVENT
BEGIN:VTODO
UID:task@example.test
DTSTAMP:20260920T120000Z
DUE:20260924T120000Z
SUMMARY:Prepare agenda
END:VTODO
END:VCALENDAR`,
    );

    const encoded = parsed.applyPatch({ title: 'Updated team planning' });
    const calendar = ICAL.Component.fromString(encoded.icalendar);
    const todo = calendar.getFirstSubcomponent('vtodo');

    expect(calendar.getAllSubcomponents('vevent')).toHaveLength(1);
    expect(todo?.getFirstPropertyValue('uid')).toBe('task@example.test');
    expect(todo?.getFirstPropertyValue('summary')).toBe('Prepare agenda');
  });

  it('preserves organizer and attendee data on patch', () => {
    const parsed = codec.parse(
      'team',
      'attendees.ics',
      fixture('attendees.ics'),
    );

    const encoded = parsed.applyPatch({ status: 'tentative' });
    const event = ICAL.Component.fromString(
      encoded.icalendar,
    ).getFirstSubcomponent('vevent');

    expect(event?.getFirstProperty('organizer')?.getFirstParameter('cn')).toBe(
      'Alice Example',
    );
    expect(event?.getAllProperties('attendee')).toHaveLength(2);
    expect(event?.getFirstPropertyValue('sequence')).toBe(2);
    expect(event?.getFirstPropertyValue('status')).toBe('TENTATIVE');
  });

  it('decodes folded and escaped text without destructive re-encoding', () => {
    const parsed = codec.parse(
      'team',
      'folded-escaped.ics',
      fixture('folded-escaped.ics'),
    );

    expect(parsed.event.title).toBe('Escaped, semicolon; and backslash\\ text');
    expect(parsed.event.description).toContain(
      'Second line with a comma, a semicolon;',
    );
    expect(parsed.event.location).toBe('Building A, Floor 2');

    const encoded = parsed.applyPatch({ title: 'Short title' });
    const reparsed = codec.parse(
      'team',
      'folded-escaped.ics',
      encoded.icalendar,
    );

    expect(reparsed.event.description).toBe(parsed.event.description);
    expect(reparsed.event.location).toBe(parsed.event.location);
  });

  it('serializes a new basic VEVENT from the calendar domain input', () => {
    const encoded = codec.create('team', 'new.ics', {
      uid: 'new@example.test',
      title: 'Planning',
      description: 'Quarterly planning',
      timing: {
        type: 'timed',
        start: {
          type: 'zoned',
          local: '2026-09-28T09:00:00',
          timezone: 'Europe/Stockholm',
        },
        end: {
          type: 'zoned',
          local: '2026-09-28T10:30:00',
          timezone: 'Europe/Stockholm',
        },
      },
      status: 'confirmed',
      transparency: 'opaque',
      location: 'Room 5',
      url: 'https://example.test/events/new',
      categories: ['TEAM', 'PLANNING'],
      priority: 4,
    });

    expect(encoded.event).toMatchObject({
      id: 'new.ics',
      calendarId: 'team',
      uid: 'new@example.test',
      title: 'Planning',
    });

    const reparsed = codec.parse('team', 'new.ics', encoded.icalendar);
    expect(reparsed.event).toEqual(encoded.event);
  });

  it('rejects recurrence creation until recurrence semantics land in M5', () => {
    expect(() =>
      codec.create('team', 'new.ics', {
        uid: 'new@example.test',
        title: 'Recurring',
        timing: {
          type: 'all-day',
          startDate: '2026-09-28',
          endDate: '2026-09-29',
        },
        recurrence: { rrule: 'FREQ=DAILY' },
      }),
    ).toThrow(
      new ICalendarEventCodecError(
        'unsupported-patch',
        'Recurrence creation is not part of the basic VEVENT codec',
      ),
    );
  });

  it('rejects recurrence edits until recurrence semantics land in M5', () => {
    const parsed = codec.parse(
      'team',
      'simple-timed.ics',
      fixture('simple-timed.ics'),
    );

    expect(() =>
      parsed.applyPatch({
        recurrence: {
          rrule: 'FREQ=WEEKLY',
        },
      }),
    ).toThrow(
      new ICalendarEventCodecError(
        'unsupported-patch',
        'Recurrence editing is not part of the basic VEVENT codec',
      ),
    );
  });
});

function fixture(name: string): string {
  return fs.readFileSync(
    path.resolve(__dirname, '../../../fixtures/ical', name),
    'utf8',
  );
}
