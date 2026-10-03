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

import type {
  CalendarEventDateTime,
  CalendarEventRecurrenceDate,
} from '@matrix-calendar-widget/calendar';
import { getVTimezoneBlock } from '@matrix-calendar-widget/ical-timezones';
import ICAL from 'ical.js';
import {
  ICalendarEventCodec,
  ICalendarEventCodecError,
} from './ICalendarEventCodec';

const stockholmPeriodLine =
  'RDATE;VALUE=PERIOD;TZID=Europe/Stockholm;X-KEEP=shared:20261027T090000/20261027T100000,20261028T090000/PT1H';

describe('ICalendarEventCodec PERIOD replacement', () => {
  it('replaces one explicit-end member in place and preserves typed siblings and resource data', () => {
    let clockCalls = 0;
    const codec = new ICalendarEventCodec(() => {
      clockCalls += 1;
      return new Date('2026-10-03T15:16:17Z');
    });
    const source = stockholmSource();
    const parsed = codec.parse('team', 'period-edit.ics', source);
    const original = parsed.event.recurrence?.rdates?.find(
      (value) =>
        value.type === 'period' &&
        value.timing.start.type === 'date-time' &&
        value.timing.start.value.local === '2026-10-27T09:00:00',
    );
    expect(original?.type).toBe('period');
    if (!original || original.type !== 'period') {
      throw new Error('Expected explicit-end PERIOD RDATE');
    }

    const replacement: Extract<
      CalendarEventRecurrenceDate,
      { type: 'period' }
    > = {
      type: 'period',
      timing: {
        type: 'end',
        start: zoned('2026-10-27T10:30:00'),
        end: zoned('2026-10-27T12:00:00'),
      },
    };
    const updated = parsed.applyPatch({
      recurrence: {
        rdate: { action: 'replace-period', value: original, replacement },
      },
    });

    expect(updated.event.recurrence?.rdates).toEqual([
      zoned('2026-10-26T11:00:00'),
      replacement,
      {
        type: 'period',
        timing: {
          type: 'duration',
          start: zoned('2026-10-28T09:00:00'),
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
      zoned('2026-10-29T11:00:00'),
    ]);

    const output = ICAL.Component.fromString(updated.icalendar);
    const master = output.getFirstSubcomponent('vevent')!;
    const shared = master
      .getAllProperties('rdate')
      .find((property) => property.getFirstParameter('x-keep') === 'shared');
    expect(shared).toBeDefined();
    expect(shared?.getFirstParameter('tzid')).toBe('Europe/Stockholm');
    expect(shared?.toICALString()).toContain('VALUE=PERIOD');
    expect(shared?.getValues()).toHaveLength(2);
    expect(shared?.getValues().map((value) => value.toString())).toEqual([
      '2026-10-27T10:30:00/2026-10-27T12:00:00',
      '2026-10-28T09:00:00/PT1H',
    ]);
    expect(
      output.getFirstSubcomponent('vtimezone')?.getFirstPropertyValue('tzid'),
    ).toBe('Europe/Stockholm');
    expect(master.getFirstPropertyValue('x-client-metadata')).toBe(
      'preserve-event-value',
    );
    expect(
      master.getFirstSubcomponent('valarm')?.getFirstPropertyValue('action'),
    ).toBe('DISPLAY');
    expect(updated.event.revision).toEqual({
      dtstamp: '2026-10-03T15:16:17Z',
      created: '2026-09-19T08:00:00Z',
      lastModified: '2026-10-03T15:16:17Z',
      sequence: 8,
    });
    expect(clockCalls).toBe(1);
  });

  it('edits a duration PERIOD start at a post-DST wall time without converting nominal P1D', () => {
    const source = stockholmSource({
      periodLine:
        'RDATE;VALUE=PERIOD;TZID=Europe/Stockholm;X-KEEP=shared:20260328T013000/P1D,20260329T013000/PT1H',
      pointLines: [],
      start: '20260322T013000',
      end: '20260322T023000',
    });
    const codec = new ICalendarEventCodec();
    const parsed = codec.parse('team', 'period-duration-edit.ics', source);
    const original = parsed.event.recurrence?.rdates?.[0];
    expect(original?.type).toBe('period');
    if (!original || original.type !== 'period') {
      throw new Error('Expected duration PERIOD RDATE');
    }
    const replacement: Extract<
      CalendarEventRecurrenceDate,
      { type: 'period' }
    > = {
      type: 'period',
      timing: {
        type: 'duration',
        start: zoned('2026-03-29T09:00:00'),
        duration: {
          weeks: 0,
          days: 1,
          hours: 0,
          minutes: 0,
          seconds: 0,
          isNegative: false,
        },
      },
    };

    const updated = parsed.applyPatch({
      recurrence: {
        rdate: { action: 'replace-period', value: original, replacement },
      },
    });

    expect(updated.icalendar).toContain('20260329T090000/P1D');
    expect(updated.icalendar).toContain('20260329T013000/PT1H');
    expect(updated.event.recurrence?.rdates?.[0]).toEqual(replacement);
    const reparsed = codec.parse(
      'team',
      'period-duration-edit.ics',
      updated.icalendar,
    );
    expect(reparsed.event.recurrence?.rdates?.[0]).toEqual(replacement);
  });

  it.each([
    {
      label: 'floating DATE-TIME',
      start: 'DTSTART:20261026T090000',
      end: 'DTEND:20261026T100000',
      rdate: 'RDATE;VALUE=PERIOD:20261027T090000/20261027T100000',
      source: {
        type: 'period',
        timing: {
          type: 'end',
          start: { type: 'floating-date-time', value: '2026-10-27T09:00:00' },
          end: { type: 'floating-date-time', value: '2026-10-27T10:00:00' },
        },
      },
      replacement: {
        type: 'period',
        timing: {
          type: 'end',
          start: { type: 'floating-date-time', value: '2026-10-27T11:00:00' },
          end: { type: 'floating-date-time', value: '2026-10-27T12:00:00' },
        },
      },
      expected: '20261027T110000/20261027T120000',
    },
    {
      label: 'UTC DATE-TIME',
      start: 'DTSTART:20261026T090000Z',
      end: 'DTEND:20261026T100000Z',
      rdate: 'RDATE;VALUE=PERIOD:20261027T090000Z/20261027T100000Z',
      source: {
        type: 'period',
        timing: {
          type: 'end',
          start: {
            type: 'date-time',
            value: { local: '2026-10-27T09:00:00', timezone: 'UTC' },
          },
          end: {
            type: 'date-time',
            value: { local: '2026-10-27T10:00:00', timezone: 'UTC' },
          },
        },
      },
      replacement: {
        type: 'period',
        timing: {
          type: 'end',
          start: {
            type: 'date-time',
            value: { local: '2026-10-27T11:00:00', timezone: 'UTC' },
          },
          end: {
            type: 'date-time',
            value: { local: '2026-10-27T12:00:00', timezone: 'UTC' },
          },
        },
      },
      expected: '20261027T110000Z/20261027T120000Z',
    },
  ])(
    'preserves $label PERIOD identity',
    ({ start, end, rdate, source, replacement, expected }) => {
      const codec = new ICalendarEventCodec();
      const parsed = codec.parse(
        'team',
        'typed-period-edit.ics',
        simpleRecurringSource(start, end, rdate),
      );
      const updated = parsed.applyPatch({
        recurrence: {
          rdate: {
            action: 'replace-period',
            value: source as Extract<
              CalendarEventRecurrenceDate,
              { type: 'period' }
            >,
            replacement: replacement as Extract<
              CalendarEventRecurrenceDate,
              { type: 'period' }
            >,
          },
        },
      });

      expect(updated.icalendar).toContain(expected);
      expect(
        codec.parse('team', 'typed-period-edit.ics', updated.icalendar).event
          .recurrence?.rdates?.[0],
      ).toEqual(replacement);
    },
  );

  it('preserves the exact source and revision when the replacement is semantically unchanged', () => {
    let clockCalls = 0;
    const codec = new ICalendarEventCodec(() => {
      clockCalls += 1;
      return new Date('2026-10-03T15:16:17Z');
    });
    const source = stockholmSource();
    const parsed = codec.parse('team', 'period-no-op.ics', source);
    const original = parsed.event.recurrence?.rdates?.find(
      (value) =>
        value.type === 'period' &&
        value.timing.start.type === 'date-time' &&
        value.timing.start.value.local === '2026-10-27T09:00:00',
    );
    expect(original?.type).toBe('period');
    if (!original || original.type !== 'period') {
      throw new Error('Expected explicit-end PERIOD RDATE');
    }

    const updated = parsed.applyPatch({
      recurrence: {
        rdate: {
          action: 'replace-period',
          value: original,
          replacement: original,
        },
      },
    });

    expect(updated.icalendar).toBe(source);
    expect(updated.event).toBe(parsed.event);
    expect(updated.event.revision).toEqual(parsed.event.revision);
    expect(clockCalls).toBe(0);
  });

  it('rejects stale, duplicate, colliding, and malformed PERIOD replacements before writing', () => {
    const codec = new ICalendarEventCodec();
    const source = stockholmSource();
    const parsed = codec.parse('team', 'period-conflicts.ics', source);
    const original = parsed.event.recurrence?.rdates?.find(
      (value) =>
        value.type === 'period' &&
        value.timing.start.type === 'date-time' &&
        value.timing.start.value.local === '2026-10-27T09:00:00',
    );
    expect(original?.type).toBe('period');
    if (!original || original.type !== 'period') {
      throw new Error('Expected explicit-end PERIOD RDATE');
    }
    const replacement = explicitEnd(
      '2026-10-27T12:00:00',
      '2026-10-27T13:00:00',
    );

    const stale = explicitEnd('2026-10-27T09:01:00', '2026-10-27T10:00:00');
    expect(() =>
      parsed.applyPatch({
        recurrence: {
          rdate: { action: 'replace-period', value: stale, replacement },
        },
      }),
    ).toThrow(ICalendarEventCodecError);

    const duplicateSource = codec.parse(
      'team',
      'period-duplicate.ics',
      stockholmSource({
        pointLines: [],
        extraPeriodLines: [
          'RDATE;VALUE=PERIOD;TZID=Europe/Stockholm:20261027T090000/20261027T100000',
        ],
      }),
    );
    expect(() =>
      duplicateSource.applyPatch({
        recurrence: {
          rdate: { action: 'replace-period', value: original, replacement },
        },
      }),
    ).toThrow(ICalendarEventCodecError);

    const collisionWithPoint = explicitEnd(
      '2026-10-26T11:00:00',
      '2026-10-26T12:00:00',
    );
    expect(() =>
      parsed.applyPatch({
        recurrence: {
          rdate: {
            action: 'replace-period',
            value: original,
            replacement: collisionWithPoint,
          },
        },
      }),
    ).toThrow(ICalendarEventCodecError);

    const collisionWithPeriod = explicitEnd(
      '2026-10-28T09:00:00',
      '2026-10-28T10:00:00',
    );
    expect(() =>
      parsed.applyPatch({
        recurrence: {
          rdate: {
            action: 'replace-period',
            value: original,
            replacement: collisionWithPeriod,
          },
        },
      }),
    ).toThrow(ICalendarEventCodecError);

    const malformed = codec.parse(
      'team',
      'period-malformed-sibling.ics',
      stockholmSource({
        pointLines: [],
        periodLine:
          'RDATE;VALUE=PERIOD;TZID=Europe/Stockholm;X-KEEP=shared:20261027T090000/20261027T100000,20261028T090000/PT0S',
      }),
    );
    const malformedTarget = malformed.event.recurrence?.rdates?.find(
      (value) => value.type === 'period',
    );
    expect(malformedTarget?.type).toBe('period');
    if (!malformedTarget || malformedTarget.type !== 'period') {
      throw new Error('Expected valid PERIOD sibling');
    }
    expect(() =>
      malformed.applyPatch({
        recurrence: {
          rdate: {
            action: 'replace-period',
            value: malformedTarget,
            replacement,
          },
        },
      }),
    ).toThrow(ICalendarEventCodecError);

    expect(parsed.applyPatch({ title: parsed.event.title }).event.title).toBe(
      parsed.event.title,
    );
    expect(
      codec.parse('team', 'period-conflicts.ics', source).event.recurrence,
    ).toEqual(parsed.event.recurrence);
  });
});

function stockholmSource(
  options: {
    periodLine?: string;
    pointLines?: string[];
    extraPeriodLines?: string[];
    start?: string;
    end?: string;
  } = {},
): string {
  const timezone = getVTimezoneBlock('Europe/Stockholm');
  if (!timezone) {
    throw new Error('Missing bundled Stockholm timezone definition');
  }
  const pointLines = options.pointLines ?? [
    'RDATE;TZID=Europe/Stockholm:20261026T110000',
    'RDATE;TZID=Europe/Stockholm:20261029T110000',
  ];
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Matrix Calendar Widget//Tests//EN',
    'X-CUSTOM-CALENDAR-PROPERTY:preserve-calendar-value',
    timezone,
    'BEGIN:VEVENT',
    'UID:period-replacement@example.test',
    'DTSTAMP:20260922T120000Z',
    'CREATED:20260919T080000Z',
    'LAST-MODIFIED:20260921T101500Z',
    'SEQUENCE:7',
    `DTSTART;TZID=Europe/Stockholm:${options.start ?? '20261026T090000'}`,
    `DTEND;TZID=Europe/Stockholm:${options.end ?? '20261026T100000'}`,
    'SUMMARY:PERIOD replacement test',
    'RRULE:FREQ=DAILY;COUNT=10',
    ...pointLines.slice(0, 1),
    options.periodLine ?? stockholmPeriodLine,
    ...(options.extraPeriodLines ?? []),
    ...pointLines.slice(1),
    'X-CLIENT-METADATA:preserve-event-value',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'DESCRIPTION:Keep this alarm',
    'TRIGGER:-PT10M',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

function simpleRecurringSource(
  start: string,
  end: string,
  rdate: string,
): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Matrix Calendar Widget//Tests//EN',
    'BEGIN:VEVENT',
    'UID:typed-period@example.test',
    'DTSTAMP:20260922T120000Z',
    start,
    end,
    'SUMMARY:Typed PERIOD test',
    'RRULE:FREQ=DAILY;COUNT=3',
    rdate,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

function zoned(local: string): CalendarEventDateTime {
  return {
    type: 'date-time',
    value: { local, timezone: 'Europe/Stockholm' },
  };
}

function explicitEnd(
  startLocal: string,
  endLocal: string,
): Extract<CalendarEventRecurrenceDate, { type: 'period' }> {
  return {
    type: 'period',
    timing: {
      type: 'end',
      start: zoned(startLocal),
      end: zoned(endLocal),
    },
  };
}
