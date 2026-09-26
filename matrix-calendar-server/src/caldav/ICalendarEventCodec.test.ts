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

import { CalendarEventOccurrence } from '@matrix-calendar-widget/calendar';
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
        local: '2026-10-26T09:00:00',
        timezone: 'Europe/Stockholm',
        mode: 'tzid',
      },
      end: {
        local: '2026-10-26T10:00:00',
        timezone: 'Europe/Stockholm',
        mode: 'tzid',
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

  it('maps all VEVENTs in a recurrence resource and preserves moved identity', () => {
    const parsed = codec.parse(
      'team',
      'recurrence-override.ics',
      fixture('recurrence-override.ics'),
    );

    expect(parsed.event.recurrence).toMatchObject({
      rrule: 'FREQ=WEEKLY;COUNT=4',
      rdates: [
        {
          type: 'date-time',
          value: {
            local: '2026-10-26T14:00:00',
            timezone: 'Europe/Stockholm',
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
          title: 'Weekly review - moved',
          timing: {
            type: 'timed',
            start: {
              local: '2026-10-12T16:00:00',
              timezone: 'Europe/Stockholm',
            },
            end: {
              local: '2026-10-12T17:00:00',
              timezone: 'Europe/Stockholm',
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
          status: 'cancelled',
          timing: undefined,
        },
      ],
    });

    const encoded = parsed.applyPatch({ title: 'Weekly review updated' });
    const calendar = ICAL.Component.fromString(encoded.icalendar);
    const vevents = calendar.getAllSubcomponents('vevent');
    const override = vevents[1];
    const cancelledOverride = vevents[2];

    expect(vevents).toHaveLength(3);
    expect(vevents[0].getFirstPropertyValue('summary')).toBe(
      'Weekly review updated',
    );
    expect(override.getFirstPropertyValue('recurrence-id')?.toString()).toBe(
      '2026-10-12T14:00:00',
    );
    expect(override.getFirstPropertyValue('dtstart')?.toString()).toBe(
      '2026-10-12T16:00:00',
    );
    expect(override.getFirstPropertyValue('x-override-marker')).toBe(
      'preserve-exception',
    );
    expect(
      override
        .getFirstProperty('x-override-marker')
        ?.getFirstParameter('x-origin'),
    ).toBe('external');
    expect(calendar.getFirstPropertyValue('x-custom-calendar-property')).toBe(
      'preserve-resource-value',
    );
    expect(
      calendar.getFirstSubcomponent('vtimezone')?.getFirstPropertyValue('tzid'),
    ).toBe('Europe/Stockholm');
    expect(
      vevents[0]
        .getFirstProperty('x-client-metadata')
        ?.getFirstParameter('x-param'),
    ).toBe('preserve-param');
    expect(
      cancelledOverride.getFirstPropertyValue('recurrence-id')?.toString(),
    ).toBe('2026-10-19T14:00:00');
    expect(cancelledOverride.getFirstPropertyValue('status')).toBe('CANCELLED');
  });

  it('preserves moved and cancelled overrides when a series edit retains their original identities', () => {
    const parsed = codec.parse(
      'team',
      'recurrence-override.ics',
      fixture('recurrence-override.ics'),
    );

    const encoded = parsed.applyPatch({
      recurrence: {
        ...parsed.event.recurrence!,
        rrule: 'FREQ=WEEKLY;COUNT=5',
      },
    });
    const calendar = ICAL.Component.fromString(encoded.icalendar);
    const vevents = calendar.getAllSubcomponents('vevent');

    expect(vevents).toHaveLength(3);
    expect(vevents[1].getFirstPropertyValue('recurrence-id')?.toString()).toBe(
      '2026-10-12T14:00:00',
    );
    expect(vevents[1].getFirstPropertyValue('dtstart')?.toString()).toBe(
      '2026-10-12T16:00:00',
    );
    expect(vevents[1].getFirstPropertyValue('x-override-marker')).toBe(
      'preserve-exception',
    );
    expect(vevents[2].getFirstPropertyValue('recurrence-id')?.toString()).toBe(
      '2026-10-19T14:00:00',
    );
    expect(vevents[2].getFirstPropertyValue('status')).toBe('CANCELLED');
    expect(calendar.getFirstSubcomponent('vtimezone')).not.toBeNull();
    expect(calendar.getFirstPropertyValue('x-custom-calendar-property')).toBe(
      'preserve-resource-value',
    );
  });

  it('rejects recurrence edits that remove an override identity without changing the parsed source', () => {
    const parsed = codec.parse(
      'team',
      'recurrence-override.ics',
      fixture('recurrence-override.ics'),
    );

    expect(() =>
      parsed.applyPatch({
        recurrence: {
          ...parsed.event.recurrence!,
          rrule: 'FREQ=WEEKLY;COUNT=2',
        },
      }),
    ).toThrow(
      expect.objectContaining({ code: 'recurrence-exception-orphaned' }),
    );

    const unrelatedPatch = parsed.applyPatch({ title: 'Still unchanged' });
    expect(unrelatedPatch.icalendar).toContain('RRULE:FREQ=WEEKLY;COUNT=4');
    expect(unrelatedPatch.icalendar).toContain(
      'RECURRENCE-ID;TZID=Europe/Stockholm:20261012T140000',
    );
    expect(unrelatedPatch.icalendar).toContain('SUMMARY:Weekly review - moved');
  });

  it('rejects DTSTART and EXDATE changes that orphan an existing override', () => {
    const parsed = codec.parse(
      'team',
      'recurrence-override.ics',
      fixture('recurrence-override.ics'),
    );

    expect(() =>
      parsed.applyPatch({
        timing: {
          type: 'timed',
          start: {
            local: '2026-10-06T14:00:00',
            timezone: 'Europe/Stockholm',
            mode: 'tzid',
          },
          end: {
            local: '2026-10-06T15:00:00',
            timezone: 'Europe/Stockholm',
            mode: 'tzid',
          },
        },
      }),
    ).toThrow(
      expect.objectContaining({ code: 'recurrence-exception-orphaned' }),
    );

    expect(() =>
      parsed.applyPatch({
        recurrence: {
          ...parsed.event.recurrence!,
          exdates: [
            ...(parsed.event.recurrence?.exdates ?? []),
            {
              type: 'date-time',
              value: {
                local: '2026-10-12T14:00:00',
                timezone: 'Europe/Stockholm',
                mode: 'tzid',
              },
            },
          ],
        },
      }),
    ).toThrow(
      expect.objectContaining({ code: 'recurrence-exception-orphaned' }),
    );
  });

  it('compares exception identities using their exact DATE-TIME mode', () => {
    const parsed = codec.parse(
      'team',
      'mode-mismatch.ics',
      `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:mode-mismatch@example.test
DTSTART:20260924T080000Z
DTEND:20260924T090000Z
RRULE:FREQ=DAILY;COUNT=2
SUMMARY:UTC series
END:VEVENT
BEGIN:VEVENT
UID:mode-mismatch@example.test
RECURRENCE-ID:20260925T080000
DTSTART:20260925T100000
DTEND:20260925T110000
SUMMARY:Floating exception
END:VEVENT
END:VCALENDAR`,
    );

    expect(() =>
      parsed.applyPatch({
        recurrence: {
          ...parsed.event.recurrence!,
          rrule: 'FREQ=DAILY;COUNT=3',
        },
      }),
    ).toThrow(
      expect.objectContaining({ code: 'recurrence-exception-orphaned' }),
    );
  });

  it('checks RDATE-only and RANGE override identities before accepting a series edit', () => {
    const rdateOnly = codec.parse(
      'team',
      'rdate-only.ics',
      `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:rdate-only@example.test
DTSTART:20260928T090000Z
DTEND:20260928T100000Z
RDATE:20261005T090000Z
SUMMARY:RDATE only
END:VEVENT
BEGIN:VEVENT
UID:rdate-only@example.test
RECURRENCE-ID:20261005T090000Z
DTSTART:20261005T110000Z
DTEND:20261005T120000Z
SUMMARY:Moved RDATE-only instance
END:VEVENT
END:VCALENDAR`,
    );

    expect(() =>
      rdateOnly.applyPatch({
        recurrence: { ...rdateOnly.event.recurrence!, rdates: [] },
      }),
    ).toThrow(
      expect.objectContaining({ code: 'recurrence-exception-orphaned' }),
    );

    const ranged = codec.parse(
      'team',
      'ranged.ics',
      `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:ranged@example.test
DTSTART:20260928T090000Z
DTEND:20260928T100000Z
RRULE:FREQ=WEEKLY;COUNT=4
SUMMARY:Ranged series
END:VEVENT
BEGIN:VEVENT
UID:ranged@example.test
RECURRENCE-ID;RANGE=THISANDFUTURE:20261012T090000Z
DTSTART:20261012T110000Z
DTEND:20261012T120000Z
SUMMARY:Opaque range override
END:VEVENT
END:VCALENDAR`,
    );

    expect(ranged.event.unsupportedRecurrence).toBe('ranged-override');
    expect(() =>
      ranged.applyPatch({
        recurrence: {
          ...ranged.event.recurrence!,
          rrule: 'FREQ=WEEKLY;COUNT=2',
        },
      }),
    ).toThrow(
      expect.objectContaining({ code: 'recurrence-exception-orphaned' }),
    );
  });

  it('uses PERIOD starts for membership and refuses membership it cannot prove', () => {
    const period = codec.parse(
      'team',
      'period.ics',
      `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:period@example.test
DTSTART:20260928T090000Z
DTEND:20260928T100000Z
RDATE;VALUE=PERIOD:20261005T090000Z/20261005T110000Z
SUMMARY:Period series
END:VEVENT
BEGIN:VEVENT
UID:period@example.test
RECURRENCE-ID:20261005T090000Z
DTSTART:20261005T120000Z
DTEND:20261005T130000Z
SUMMARY:Moved period instance
END:VEVENT
END:VCALENDAR`,
    );

    expect(() =>
      period.applyPatch({
        recurrence: {
          ...period.event.recurrence!,
          rdates: [
            {
              type: 'date-time',
              value: {
                local: '2026-10-06T09:00:00',
                timezone: 'UTC',
                mode: 'utc',
              },
            },
          ],
        },
      }),
    ).not.toThrow();

    const unsupported = codec.parse(
      'team',
      'unsupported-with-override.ics',
      `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:unsupported-override@example.test
DTSTART:20260928T090000Z
DTEND:20260928T100000Z
RRULE:COUNT=1
SUMMARY:Unsupported recurrence
END:VEVENT
BEGIN:VEVENT
UID:unsupported-override@example.test
RECURRENCE-ID:20260929T090000Z
DTSTART:20260929T110000Z
DTEND:20260929T120000Z
SUMMARY:Moved instance
END:VEVENT
END:VCALENDAR`,
    );

    expect(() =>
      unsupported.applyPatch({
        recurrence: {
          ...unsupported.event.recurrence!,
          rdates: [],
        },
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'recurrence-exception-unverifiable',
      }),
    );

    const overLimit = codec.parse(
      'team',
      'over-limit.ics',
      `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:over-limit@example.test
DTSTART:20000101T090000Z
DTEND:20000101T100000Z
RRULE:FREQ=DAILY
SUMMARY:Long recurrence
END:VEVENT
BEGIN:VEVENT
UID:over-limit@example.test
RECURRENCE-ID:24000101T090000Z
DTSTART:24000101T110000Z
DTEND:24000101T120000Z
SUMMARY:Moved distant instance
END:VEVENT
END:VCALENDAR`,
    );

    expect(() =>
      overLimit.applyPatch({
        recurrence: { ...overLimit.event.recurrence!, exdates: [] },
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'recurrence-exception-unverifiable',
      }),
    );
  });

  it('refuses recurrence edits when a detached VEVENT has no UID', () => {
    const parsed = codec.parse(
      'team',
      'missing-exception-uid.ics',
      `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:missing-exception-uid@example.test
DTSTART:20260924T080000Z
DTEND:20260924T090000Z
RRULE:FREQ=DAILY;COUNT=3
SUMMARY:Team planning
END:VEVENT
BEGIN:VEVENT
RECURRENCE-ID:20260926T080000Z
DTSTART:20260926T100000Z
DTEND:20260926T110000Z
SUMMARY:Unverifiable moved planning
END:VEVENT
END:VCALENDAR`,
    );

    expect(() =>
      parsed.applyPatch({
        recurrence: {
          ...parsed.event.recurrence!,
          rrule: 'FREQ=DAILY;COUNT=2',
        },
      }),
    ).toThrow(
      expect.objectContaining({ code: 'recurrence-exception-unverifiable' }),
    );
  });

  it('creates a same-resource override for a generated occurrence', () => {
    const parsed = codec.parse(
      'team',
      'recurrence-override.ics',
      fixture('recurrence-override.ics'),
    );

    const recurrenceId = {
      type: 'date-time' as const,
      value: {
        local: '2026-10-05T14:00:00',
        timezone: 'Europe/Stockholm',
        mode: 'tzid' as const,
      },
    };
    const encoded = parsed.applyOccurrencePatch(recurrenceId, {
      title: 'One review only',
      timing: {
        type: 'timed',
        start: {
          local: '2026-10-05T16:00:00',
          timezone: 'Europe/Stockholm',
          mode: 'tzid',
        },
        end: {
          local: '2026-10-05T17:00:00',
          timezone: 'Europe/Stockholm',
          mode: 'tzid',
        },
      },
    });
    const calendar = ICAL.Component.fromString(encoded.icalendar);
    const vevents = calendar.getAllSubcomponents('vevent');
    const created = vevents.find(
      (vevent) => vevent.getFirstPropertyValue('summary') === 'One review only',
    );

    expect(vevents).toHaveLength(4);
    expect(created?.getFirstPropertyValue('uid')).toBe('override@example.test');
    expect(created?.getFirstPropertyValue('recurrence-id')?.toString()).toBe(
      '2026-10-05T14:00:00',
    );
    expect(
      created?.getFirstProperty('recurrence-id')?.getFirstParameter('tzid'),
    ).toBe('Europe/Stockholm');
    expect(created?.getFirstPropertyValue('dtstart')?.toString()).toBe(
      '2026-10-05T16:00:00',
    );
    expect(vevents[0].getFirstPropertyValue('summary')).toBe('Weekly review');
    expect(vevents[0].getFirstPropertyValue('rrule')?.toString()).toContain(
      'COUNT=4',
    );
    expect(calendar.getFirstPropertyValue('x-custom-calendar-property')).toBe(
      'preserve-resource-value',
    );
    expect(calendar.getFirstSubcomponent('vtimezone')).toBeDefined();
    expect(vevents[1].getFirstPropertyValue('x-override-marker')).toBe(
      'preserve-exception',
    );
    expect(vevents[2].getFirstPropertyValue('status')).toBe('CANCELLED');
  });

  it('creates an override for an RDATE-only occurrence', () => {
    const parsed = codec.parse(
      'team',
      'rdate-only.ics',
      `BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:rdate-only@example.test\nDTSTART:20260101T090000Z\nDTEND:20260101T100000Z\nRRULE:FREQ=DAILY;COUNT=2\nRDATE:20260105T090000Z\nX-MASTER-ONLY;X-KEEP=yes:preserve\nEND:VEVENT\nEND:VCALENDAR`,
    );

    const encoded = parsed.applyOccurrencePatch(
      {
        type: 'date-time',
        value: {
          local: '2026-01-05T09:00:00',
          timezone: 'UTC',
          mode: 'utc',
        },
      },
      { title: 'RDATE only edit' },
    );
    const calendar = ICAL.Component.fromString(encoded.icalendar);
    const vevents = calendar.getAllSubcomponents('vevent');
    const override = vevents[1];

    expect(vevents).toHaveLength(2);
    expect(override.getFirstPropertyValue('uid')).toBe(
      'rdate-only@example.test',
    );
    expect(override.getFirstPropertyValue('recurrence-id')?.toString()).toBe(
      '2026-01-05T09:00:00Z',
    );
    expect(override.getFirstPropertyValue('summary')).toBe('RDATE only edit');
    expect(override.hasProperty('rrule')).toBe(false);
    expect(vevents[0].getFirstPropertyValue('x-master-only')).toBe('preserve');
    expect(
      vevents[0].getFirstProperty('x-master-only')?.getFirstParameter('x-keep'),
    ).toBe('yes');
  });

  it('updates the unique existing override by original identity and preserves its unknown data', () => {
    const source = fixture('recurrence-override.ics').replace(
      'SUMMARY:Weekly review - moved\n',
      'SUMMARY:Weekly review - moved\nDESCRIPTION:Remove this description\n',
    );
    const parsed = codec.parse('team', 'recurrence-override.ics', source);
    const encoded = parsed.applyOccurrencePatch(
      {
        type: 'date-time',
        value: {
          local: '2026-10-12T14:00:00',
          timezone: 'Europe/Stockholm',
          mode: 'tzid',
        },
      },
      { title: 'Moved review updated', description: null },
    );
    const calendar = ICAL.Component.fromString(encoded.icalendar);
    const vevents = calendar.getAllSubcomponents('vevent');
    const override = vevents.filter(
      (vevent) =>
        vevent.getFirstPropertyValue('recurrence-id')?.toString() ===
        '2026-10-12T14:00:00',
    );

    expect(vevents).toHaveLength(3);
    expect(override).toHaveLength(1);
    expect(override[0].getFirstPropertyValue('summary')).toBe(
      'Moved review updated',
    );
    expect(override[0].hasProperty('description')).toBe(false);
    expect(override[0].getFirstPropertyValue('dtstart')?.toString()).toBe(
      '2026-10-12T16:00:00',
    );
    expect(override[0].getFirstPropertyValue('recurrence-id')?.toString()).toBe(
      '2026-10-12T14:00:00',
    );
    expect(override[0].getFirstPropertyValue('x-override-marker')).toBe(
      'preserve-exception',
    );
    expect(
      override[0]
        .getFirstProperty('x-override-marker')
        ?.getFirstParameter('x-origin'),
    ).toBe('external');
    expect(calendar.getFirstSubcomponent('vtimezone')).toBeDefined();
    expect(vevents[0].getFirstPropertyValue('x-client-metadata')).toBe(
      'preserve-value',
    );
  });

  it('cancels one generated occurrence with a same-resource cancelled override', () => {
    const source = fixture('recurrence-override.ics');
    const parsed = codec.parse('team', 'recurrence-override.ics', source);
    const originalMasterExdate = ICAL.Component.fromString(source)
      .getFirstSubcomponent('vevent')
      ?.getFirstPropertyValue('exdate')
      ?.toString();
    const encoded = parsed.applyOccurrenceCancellation({
      type: 'date-time',
      value: {
        local: '2026-10-05T14:00:00',
        timezone: 'Europe/Stockholm',
        mode: 'tzid',
      },
    });
    const calendar = ICAL.Component.fromString(encoded.icalendar);
    const vevents = calendar.getAllSubcomponents('vevent');
    const cancellation = vevents.find(
      (vevent) =>
        vevent.getFirstPropertyValue('recurrence-id')?.toString() ===
        '2026-10-05T14:00:00',
    );

    expect(vevents).toHaveLength(4);
    expect(cancellation?.getFirstPropertyValue('uid')).toBe(
      'override@example.test',
    );
    expect(cancellation?.getFirstPropertyValue('status')).toBe('CANCELLED');
    expect(vevents[0].getFirstPropertyValue('exdate')?.toString()).toBe(
      originalMasterExdate,
    );
    expect(vevents[1].getFirstPropertyValue('x-override-marker')).toBe(
      'preserve-exception',
    );
    expect(vevents[2].getFirstPropertyValue('status')).toBe('CANCELLED');
  });

  it('rejects mismatched recurrence identity modes and duplicate detached targets', () => {
    const parsed = codec.parse(
      'team',
      'recurrence-override.ics',
      fixture('recurrence-override.ics'),
    );

    expect(() =>
      parsed.applyOccurrencePatch(
        {
          type: 'date-time',
          value: {
            local: '2026-10-05T14:00:00',
            timezone: 'Europe/Stockholm',
            mode: 'floating',
          },
        },
        { title: 'Unsafe mode' },
      ),
    ).toThrow(/same DATE-TIME mode and TZID/);

    const duplicateSource = fixture('recurrence-override.ics').replace(
      'END:VCALENDAR',
      `BEGIN:VEVENT\nUID:override@example.test\nRECURRENCE-ID;TZID=Europe/Stockholm:20261012T140000\nSUMMARY:Duplicate\nEND:VEVENT\nEND:VCALENDAR`,
    );
    const duplicate = codec.parse('team', 'duplicate.ics', duplicateSource);
    expect(() =>
      duplicate.applyOccurrencePatch(
        {
          type: 'date-time',
          value: {
            local: '2026-10-12T14:00:00',
            timezone: 'Europe/Stockholm',
            mode: 'tzid',
          },
        },
        { title: 'Ambiguous target' },
      ),
    ).toThrow(/duplicate overrides/);
  });

  it('rejects a typed identity that is missing from the recurrence set', () => {
    const parsed = codec.parse(
      'team',
      'recurrence-override.ics',
      fixture('recurrence-override.ics'),
    );

    expect(() =>
      parsed.applyOccurrencePatch(
        {
          type: 'date-time',
          value: {
            local: '2026-10-07T14:00:00',
            timezone: 'Europe/Stockholm',
            mode: 'tzid',
          },
        },
        { title: 'Not a series date' },
      ),
    ).toThrow(/not part of the resource recurrence set/);
  });

  it('preserves UTC and floating DATE-TIME modes and expands RDATE PERIOD durations', () => {
    const parsed = codec.parse(
      'team',
      'periods.ics',
      `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:periods@example.test
DTSTART:20260101T090000Z
DTEND:20260101T100000Z
RRULE:FREQ=DAILY;COUNT=2
RDATE;VALUE=PERIOD:20260103T090000Z/PT2H,20260104T100000Z/20260104T130000Z
END:VEVENT
END:VCALENDAR`,
    );

    expect(parsed.event.timing).toEqual({
      type: 'timed',
      start: { local: '2026-01-01T09:00:00', timezone: 'UTC', mode: 'utc' },
      end: { local: '2026-01-01T10:00:00', timezone: 'UTC', mode: 'utc' },
    });
    expect(parsed.event.recurrence?.rdatePeriods).toEqual([
      {
        start: {
          type: 'date-time',
          value: { local: '2026-01-03T09:00:00', timezone: 'UTC', mode: 'utc' },
        },
        duration: 'PT2H',
      },
      {
        start: {
          type: 'date-time',
          value: { local: '2026-01-04T10:00:00', timezone: 'UTC', mode: 'utc' },
        },
        end: {
          type: 'date-time',
          value: { local: '2026-01-04T13:00:00', timezone: 'UTC', mode: 'utc' },
        },
      },
    ]);

    const occurrences = parsed.expandOccurrences({
      start: '2026-01-03T00:00:00.000Z',
      end: '2026-01-05T00:00:00.000Z',
    });
    expect(occurrences.map((occurrence) => occurrence.timing)).toEqual([
      {
        type: 'timed',
        start: { local: '2026-01-03T09:00:00', timezone: 'UTC', mode: 'utc' },
        end: { local: '2026-01-03T11:00:00', timezone: 'UTC', mode: 'utc' },
      },
      {
        type: 'timed',
        start: { local: '2026-01-04T10:00:00', timezone: 'UTC', mode: 'utc' },
        end: { local: '2026-01-04T13:00:00', timezone: 'UTC', mode: 'utc' },
      },
    ]);

    const floating = codec.parse(
      'team',
      'floating.ics',
      `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:floating@example.test
DTSTART:20260101T090000
DTEND:20260101T100000
END:VEVENT
END:VCALENDAR`,
    );
    expect(floating.event.timing).toEqual({
      type: 'timed',
      start: {
        local: '2026-01-01T09:00:00',
        timezone: 'floating',
        mode: 'floating',
      },
      end: {
        local: '2026-01-01T10:00:00',
        timezone: 'floating',
        mode: 'floating',
      },
    });
  });

  it('uses custom VTIMEZONE observances for gap omission, COUNT, and first-fold resolution', () => {
    const timezone = `BEGIN:VTIMEZONE
TZID:Custom/New_York
BEGIN:DAYLIGHT
DTSTART:20240310T020000
TZOFFSETFROM:-0500
TZOFFSETTO:-0400
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU
END:DAYLIGHT
BEGIN:STANDARD
DTSTART:20241103T020000
TZOFFSETFROM:-0400
TZOFFSETTO:-0500
RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU
END:STANDARD
END:VTIMEZONE`;
    const spring = codec.parse(
      'team',
      'custom-gap.ics',
      `BEGIN:VCALENDAR
VERSION:2.0
${timezone}
BEGIN:VEVENT
UID:custom-gap@example.test
DTSTART;TZID=Custom/New_York:20240309T023000
DTEND;TZID=Custom/New_York:20240309T033000
RRULE:FREQ=DAILY;COUNT=3
END:VEVENT
END:VCALENDAR`,
    );
    const springOccurrences = spring.expandOccurrences({
      start: '2024-03-09T00:00:00.000Z',
      end: '2024-03-14T00:00:00.000Z',
    });
    expect(springOccurrences.map(timedStart)).toEqual([
      '2024-03-09T02:30:00',
      '2024-03-11T02:30:00',
      '2024-03-12T02:30:00',
    ]);

    const fall = codec.parse(
      'team',
      'custom-fold.ics',
      `BEGIN:VCALENDAR
VERSION:2.0
${timezone}
BEGIN:VEVENT
UID:custom-fold@example.test
DTSTART;TZID=Custom/New_York:20241102T013000
DTEND;TZID=Custom/New_York:20241102T023000
RRULE:FREQ=DAILY;COUNT=3
END:VEVENT
END:VCALENDAR`,
    );
    const fallOccurrences = fall.expandOccurrences({
      start: '2024-11-02T00:00:00.000Z',
      end: '2024-11-05T00:00:00.000Z',
    });
    expect(fallOccurrences.map(timedStart)).toEqual([
      '2024-11-02T01:30:00',
      '2024-11-03T01:30:00',
      '2024-11-04T01:30:00',
    ]);
    expect(
      fall
        .expandOccurrences({
          start: '2024-11-03T05:00:00.000Z',
          end: '2024-11-03T06:00:00.000Z',
        })
        .map((occurrence) => occurrence.recurrenceId),
    ).toEqual([
      {
        type: 'date-time',
        value: {
          local: '2024-11-03T01:30:00',
          timezone: 'Custom/New_York',
          mode: 'tzid',
        },
      },
    ]);
  });

  it('leaves RANGE=THISANDFUTURE opaque and fails visibly during expansion', () => {
    const parsed = codec.parse(
      'team',
      'range-opaque.ics',
      `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:range@example.test
DTSTART:20260101T090000Z
DTEND:20260101T100000Z
RRULE:FREQ=DAILY;COUNT=3
END:VEVENT
BEGIN:VEVENT
UID:range@example.test
RECURRENCE-ID;RANGE=THISANDFUTURE:20260102T090000Z
DTSTART:20260102T120000Z
DTEND:20260102T130000Z
SUMMARY:Not modeled yet
END:VEVENT
END:VCALENDAR`,
    );

    expect(parsed.event.recurrence?.overrides).toBeUndefined();
    expect(parsed.event.unsupportedRecurrence).toBe('ranged-override');
    expect(() =>
      parsed.expandOccurrences({
        start: '2026-01-01T00:00:00.000Z',
        end: '2026-01-05T00:00:00.000Z',
      }),
    ).toThrow(
      'RECURRENCE-ID RANGE=THISANDFUTURE is preserved but cannot be expanded safely yet',
    );
    const patched = parsed.applyPatch({ title: 'Preserved source' });
    const override = ICAL.Component.fromString(patched.icalendar)
      .getAllSubcomponents('vevent')[1]
      .getFirstProperty('recurrence-id');
    expect(override?.getFirstParameter('range')).toBe('THISANDFUTURE');
  });

  it('bounds custom VTIMEZONE observance expansion by the requested work limit', () => {
    const parsed = codec.parse(
      'team',
      'bounded-timezone.ics',
      `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VTIMEZONE
TZID:Custom/Bounded
BEGIN:DAYLIGHT
DTSTART:20240310T020000
TZOFFSETFROM:-0500
TZOFFSETTO:-0400
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU
END:DAYLIGHT
BEGIN:STANDARD
DTSTART:20241103T020000
TZOFFSETFROM:-0400
TZOFFSETTO:-0500
RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU
END:STANDARD
END:VTIMEZONE
BEGIN:VEVENT
UID:bounded@example.test
DTSTART;TZID=Custom/Bounded:20240310T090000
DTEND;TZID=Custom/Bounded:20240310T100000
RRULE:FREQ=DAILY;COUNT=2
END:VEVENT
END:VCALENDAR`,
    );

    expect(() =>
      parsed.expandOccurrences(
        {
          start: '2024-03-10T00:00:00.000Z',
          end: '2024-03-12T00:00:00.000Z',
        },
        { maxRuleCandidates: 1 },
      ),
    ).toThrow(
      'VTIMEZONE Custom/Bounded exceeds the 1-transition expansion limit',
    );
  });

  it('rejects duplicate RRULE properties in VEVENT and VTIMEZONE observances', () => {
    expect(() =>
      codec.parse(
        'team',
        'duplicate-event-rrule.ics',
        `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:duplicate@example.test
DTSTART:20260101T090000Z
DTEND:20260101T100000Z
RRULE:FREQ=DAILY;COUNT=2
RRULE:FREQ=WEEKLY;COUNT=2
END:VEVENT
END:VCALENDAR`,
      ),
    ).toThrow('A VEVENT cannot contain multiple RRULE properties');

    const parsed = codec.parse(
      'team',
      'duplicate-zone-rrule.ics',
      `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VTIMEZONE
TZID:Custom/Duplicate
BEGIN:STANDARD
DTSTART:20240101T020000
TZOFFSETFROM:+0000
TZOFFSETTO:+0100
RRULE:FREQ=YEARLY;BYMONTH=1;BYDAY=1MO
RRULE:FREQ=YEARLY;BYMONTH=2;BYDAY=1MO
END:STANDARD
END:VTIMEZONE
BEGIN:VEVENT
UID:duplicate-zone@example.test
DTSTART;TZID=Custom/Duplicate:20240101T090000
DTEND;TZID=Custom/Duplicate:20240101T100000
END:VEVENT
END:VCALENDAR`,
    );

    expect(() =>
      parsed.expandOccurrences({
        start: '2024-01-01T00:00:00.000Z',
        end: '2024-01-02T00:00:00.000Z',
      }),
    ).toThrow(
      'A VTIMEZONE observance cannot contain multiple RRULE properties',
    );
  });

  it('preflights the 371-date BYWEEKNO bound before calling ical.js expansion', () => {
    const weeks = Array.from({ length: 53 }, (_value, index) => index + 1).join(
      ',',
    );
    const parsed = codec.parse(
      'team',
      'week-number-zone.ics',
      `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VTIMEZONE
TZID:Custom/WeekNumbers
BEGIN:STANDARD
DTSTART:20240101T020000
TZOFFSETFROM:+0000
TZOFFSETTO:+0100
RRULE:FREQ=YEARLY;BYWEEKNO=${weeks};BYDAY=MO,TU,WE,TH,FR,SA,SU;UNTIL=20241231T235959
END:STANDARD
END:VTIMEZONE
BEGIN:VEVENT
UID:week-number@example.test
DTSTART;TZID=Custom/WeekNumbers:20240101T090000
DTEND;TZID=Custom/WeekNumbers:20240101T100000
END:VEVENT
END:VCALENDAR`,
    );
    const offsetSpy = jest.spyOn(ICAL.Timezone.prototype, 'utcOffset');

    try {
      expect(() =>
        parsed.expandOccurrences(
          {
            start: '2024-01-01T00:00:00.000Z',
            end: '2025-01-01T00:00:00.000Z',
          },
          { maxRuleCandidates: 368 },
        ),
      ).toThrow(
        'VTIMEZONE Custom/WeekNumbers exceeds the 368-transition expansion limit',
      );
      expect(offsetSpy).not.toHaveBeenCalled();
    } finally {
      offsetSpy.mockRestore();
    }
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
          local: '2026-09-28T09:00:00',
          timezone: 'Europe/Stockholm',
        },
        end: {
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

  it('creates, reloads, and edits supported recurrence sets', () => {
    const created = codec.create('team', 'new.ics', {
      uid: 'new@example.test',
      title: 'Recurring',
      timing: {
        type: 'timed',
        start: {
          local: '2026-09-28T09:00:00',
          timezone: 'Europe/Stockholm',
          mode: 'tzid',
        },
        end: {
          local: '2026-09-28T10:00:00',
          timezone: 'Europe/Stockholm',
          mode: 'tzid',
        },
      },
      recurrence: {
        rrule: 'FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4',
        rdates: [
          {
            type: 'date-time',
            value: {
              local: '2026-10-01T09:30:00',
              timezone: 'Europe/Stockholm',
              mode: 'tzid',
            },
          },
          {
            type: 'date-time',
            value: {
              local: '2026-10-02T09:30:00',
              timezone: 'Europe/Stockholm',
              mode: 'tzid',
            },
          },
        ],
        exdates: [
          {
            type: 'date-time',
            value: {
              local: '2026-10-05T09:00:00',
              timezone: 'Europe/Stockholm',
              mode: 'tzid',
            },
          },
        ],
      },
    });
    const parsed = codec.parse('team', 'new.ics', created.icalendar);
    expect(parsed.event.recurrence).toMatchObject({
      ...created.event.recurrence,
      rrule: 'FREQ=WEEKLY;COUNT=4;BYDAY=MO,WE',
    });
    const expanded = parsed.expandOccurrences({
      start: '2026-09-28T00:00:00.000Z',
      end: '2026-10-08T00:00:00.000Z',
    });
    expect(
      expanded.every(
        (occurrence) => occurrence.recurrenceId.type === 'date-time',
      ),
    ).toBe(true);
    expect(expanded.map((occurrence) => occurrence.timing.type)).toEqual(
      expanded.map(() => 'timed'),
    );
    expect(
      expanded.some(
        (occurrence) =>
          occurrence.recurrenceId.type === 'date-time' &&
          occurrence.recurrenceId.value.local === '2026-10-01T09:30:00',
      ),
    ).toBe(true);
    expect(
      expanded.some(
        (occurrence) =>
          occurrence.recurrenceId.type === 'date-time' &&
          occurrence.recurrenceId.value.local === '2026-10-05T09:00:00' &&
          occurrence.recurrenceId.value.timezone === 'Europe/Stockholm',
      ),
    ).toBe(false);

    const edited = parsed.applyPatch({
      recurrence: {
        ...parsed.event.recurrence,
        rdates: [
          ...(parsed.event.recurrence?.rdates ?? []),
          {
            type: 'date-time',
            value: {
              local: '2026-10-06T09:00:00',
              timezone: 'Europe/Stockholm',
              mode: 'tzid',
            },
          },
        ],
      },
    });
    expect(
      codec.parse('team', 'new.ics', edited.icalendar).event.recurrence,
    ).toMatchObject({
      rrule: 'FREQ=WEEKLY;COUNT=4;BYDAY=MO,WE',
      rdates: [
        expect.objectContaining({ type: 'date-time' }),
        expect.objectContaining({ type: 'date-time' }),
        expect.objectContaining({ type: 'date-time' }),
      ],
      exdates: [expect.objectContaining({ type: 'date-time' })],
    });
  });

  it('rejects DATE/DATE-TIME recurrence values that mismatch DTSTART but preserves them on unrelated patches', () => {
    const error = new ICalendarEventCodecError(
      'invalid-recurrence',
      'RDATE and EXDATE value types must match DTSTART',
    );

    expect(() =>
      codec.create('team', 'timed-mixed.ics', {
        uid: 'timed-mixed@example.test',
        title: 'Timed mixed recurrence',
        timing: {
          type: 'timed',
          start: { local: '2026-09-28T09:00:00', timezone: 'UTC' },
          end: { local: '2026-09-28T10:00:00', timezone: 'UTC' },
        },
        recurrence: {
          rrule: 'FREQ=DAILY',
          rdates: [{ type: 'date', value: '2026-09-29' }],
        },
      }),
    ).toThrow(error);

    expect(() =>
      codec.create('team', 'all-day-mixed.ics', {
        uid: 'all-day-mixed@example.test',
        title: 'All-day mixed recurrence',
        timing: {
          type: 'all-day',
          startDate: '2026-09-28',
          endDate: '2026-09-29',
        },
        recurrence: {
          rrule: 'FREQ=DAILY',
          exdates: [
            {
              type: 'date-time',
              value: {
                local: '2026-09-29T09:00:00',
                timezone: 'UTC',
                mode: 'utc',
              },
            },
          ],
        },
      }),
    ).toThrow(error);

    const parsed = codec.parse(
      'team',
      'loaded-mixed.ics',
      `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:loaded-mixed@example.test
DTSTART;TZID=Europe/Stockholm:20260928T090000
DTEND;TZID=Europe/Stockholm:20260928T100000
RRULE:FREQ=DAILY
RDATE;VALUE=DATE:20260929
EXDATE;VALUE=DATE:20260930
SUMMARY:Loaded mixed recurrence
END:VEVENT
END:VCALENDAR`,
    );

    const ordinaryPatch = parsed.applyPatch({ title: 'Updated title' });
    expect(ordinaryPatch.icalendar).toContain('RDATE;VALUE=DATE:20260929');
    expect(ordinaryPatch.icalendar).toContain('EXDATE;VALUE=DATE:20260930');
    expect(() =>
      parsed.applyPatch({
        recurrence: {
          ...parsed.event.recurrence,
          rrule: 'FREQ=WEEKLY',
        },
      }),
    ).toThrow(error);
  });

  it('preserves unsupported loaded rules on unrelated and RDATE edits', () => {
    const source = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//EN
BEGIN:VEVENT
UID:unsupported@example.test
DTSTART;TZID=Europe/Stockholm:20260928T090000
DTEND;TZID=Europe/Stockholm:20260928T100000
RRULE:FREQ=DAILY;BYHOUR=9,17
RDATE;TZID=Europe/Stockholm;X-KEEP=1:20260929T090000,20260930T090000
SUMMARY:Unsupported rule
X-PRESERVE:unknown property
END:VEVENT
END:VCALENDAR`;
    const parsed = codec.parse('team', 'unsupported.ics', source);

    expect(parsed.applyPatch({ title: 'Edited title' }).icalendar).toContain(
      'RRULE:FREQ=DAILY;BYHOUR=9,17',
    );
    const edited = parsed.applyPatch({
      recurrence: {
        ...parsed.event.recurrence,
        rdates: [
          ...(parsed.event.recurrence?.rdates ?? []).slice(0, 1),
          {
            type: 'date-time',
            value: {
              local: '2026-10-02T09:00:00',
              timezone: 'Europe/Stockholm',
              mode: 'tzid',
            },
          },
        ],
      },
    }).icalendar;

    expect(edited).toContain('RRULE:FREQ=DAILY;BYHOUR=9,17');
    expect(edited).toContain('X-PRESERVE:unknown property');
    expect(edited).toContain('X-KEEP=1');
    expect(edited).toContain(
      'RDATE;TZID=Europe/Stockholm;X-KEEP=1:20260929T090000',
    );
    expect(edited).toContain('RDATE;TZID=Europe/Stockholm:20261002T090000');
  });

  it('rejects a changed rule outside the editor supported subset', () => {
    expect(() =>
      codec.create('team', 'new.ics', {
        uid: 'new@example.test',
        title: 'Recurring',
        timing: {
          type: 'timed',
          start: {
            local: '2026-09-28T09:00:00',
            timezone: 'Europe/Stockholm',
          },
          end: {
            local: '2026-09-28T10:00:00',
            timezone: 'Europe/Stockholm',
          },
        },
        recurrence: { rrule: 'FREQ=DAILY;BYHOUR=9,17' },
      }),
    ).toThrow(
      new ICalendarEventCodecError(
        'unsupported-patch',
        'The recurrence rule uses options that the calendar form cannot edit',
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

function timedStart(occurrence: CalendarEventOccurrence): string {
  if (occurrence.timing.type !== 'timed') {
    throw new Error('Expected a timed recurrence occurrence');
  }
  return occurrence.timing.start.local;
}
