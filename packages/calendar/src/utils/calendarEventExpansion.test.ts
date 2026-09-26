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

import { DateTime, Settings } from 'luxon';
import { CalendarEvent, CalendarEventDateTime } from '../model';
import {
  CalendarEventExpansionError,
  expandCalendarEvent,
} from './calendarEventExpansion';

describe('expandCalendarEvent', () => {
  it('bounds the recurrence set, deduplicates additions, and subtracts EXDATE', () => {
    const event = timedEvent('2026-01-01T09:00:00', 'UTC', {
      rrule: 'FREQ=DAILY;COUNT=5',
      rdates: [dateTime('2026-01-04T09:00:00', 'UTC')],
      exdates: [dateTime('2026-01-03T09:00:00', 'UTC')],
    });

    const occurrences = expandCalendarEvent(event, {
      start: '2026-01-02T09:00:00.000Z',
      end: '2026-01-05T09:00:00.000Z',
    });

    expect(occurrences.map((occurrence) => occurrence.recurrenceId)).toEqual([
      dateTime('2026-01-02T09:00:00', 'UTC'),
      dateTime('2026-01-04T09:00:00', 'UTC'),
    ]);
  });

  it('applies EXDATE when it is the only recurrence property', () => {
    const start = dateTime('2026-01-01T09:00:00', 'UTC');
    const event = timedEvent('2026-01-01T09:00:00', 'UTC', {
      exdates: [start],
    });

    expect(
      expandCalendarEvent(event, {
        start: '2026-01-01T00:00:00.000Z',
        end: '2026-01-02T00:00:00.000Z',
      }),
    ).toEqual([]);
  });

  it('keeps all-day values as DATE and uses their exclusive duration', () => {
    const event: CalendarEvent = {
      ...baseEvent,
      timing: {
        type: 'all-day',
        startDate: '2026-10-05',
        endDate: '2026-10-07',
      },
      recurrence: { rrule: 'FREQ=DAILY;COUNT=3' },
    };

    const occurrences = expandCalendarEvent(
      event,
      {
        start: '2026-10-06T00:00:00.000Z',
        end: '2026-10-08T00:00:00.000Z',
      },
      { rangeTimezone: 'UTC' },
    );

    expect(occurrences.map((occurrence) => occurrence.timing)).toEqual([
      { type: 'all-day', startDate: '2026-10-06', endDate: '2026-10-08' },
      { type: 'all-day', startDate: '2026-10-07', endDate: '2026-10-09' },
    ]);
    expect(occurrences[0].recurrenceId).toEqual({
      type: 'date',
      value: '2026-10-06',
    });
  });

  it('preserves floating wall time while using the supplied range timezone', () => {
    const event = timedEvent('2026-01-02T09:00:00', 'floating', {
      rrule: 'FREQ=DAILY;COUNT=2',
    });

    const occurrences = expandCalendarEvent(
      event,
      {
        start: '2026-01-02T08:00:00.000Z',
        end: '2026-01-04T00:00:00.000Z',
      },
      { rangeTimezone: 'Europe/Stockholm' },
    );

    expect(occurrences.map((occurrence) => occurrence.timing)).toEqual([
      {
        type: 'timed',
        start: {
          local: '2026-01-02T09:00:00',
          timezone: 'floating',
          mode: 'floating',
        },
        end: {
          local: '2026-01-02T10:00:00',
          timezone: 'floating',
          mode: 'floating',
        },
      },
      {
        type: 'timed',
        start: {
          local: '2026-01-03T09:00:00',
          timezone: 'floating',
          mode: 'floating',
        },
        end: {
          local: '2026-01-03T10:00:00',
          timezone: 'floating',
          mode: 'floating',
        },
      },
    ]);
  });

  it('keeps named-zone recurrence wall time across a DST change', () => {
    const event = timedEvent('2024-03-03T09:00:00', 'America/New_York', {
      rrule: 'FREQ=WEEKLY;COUNT=3',
    });

    const occurrences = expandCalendarEvent(event, {
      start: '2024-03-03T00:00:00.000Z',
      end: '2024-03-18T00:00:00.000Z',
    });

    expect(occurrences.map(timedStart)).toEqual([
      '2024-03-03T09:00:00',
      '2024-03-10T09:00:00',
      '2024-03-17T09:00:00',
    ]);
    expect(occurrences.map(startInstant)).toEqual([
      '2024-03-03T14:00:00.000Z',
      '2024-03-10T13:00:00.000Z',
      '2024-03-17T13:00:00.000Z',
    ]);
  });

  it('omits generated gap times without consuming COUNT', () => {
    const event = timedEvent('2024-03-09T02:30:00', 'America/New_York', {
      rrule: 'FREQ=DAILY;COUNT=3',
    });

    const occurrences = expandCalendarEvent(event, {
      start: '2024-03-09T00:00:00.000Z',
      end: '2024-03-14T00:00:00.000Z',
    });

    expect(occurrences.map(timedStart)).toEqual([
      '2024-03-09T02:30:00',
      '2024-03-11T02:30:00',
      '2024-03-12T02:30:00',
    ]);
  });

  it('uses the first occurrence of a repeated named-zone local time', () => {
    const event = timedEvent('2024-11-02T01:30:00', 'America/New_York', {
      rrule: 'FREQ=DAILY;COUNT=3',
    });

    const originalNow = Settings.now;
    try {
      const matchingIdentities = [
        '2024-01-15T12:00:00.000Z',
        '2024-07-15T12:00:00.000Z',
      ].map((now) => {
        Settings.now = () => Date.parse(now);
        return expandCalendarEvent(event, {
          start: '2024-11-03T05:00:00.000Z',
          end: '2024-11-03T06:00:00.000Z',
        }).map((occurrence) => occurrence.recurrenceId);
      });

      expect(matchingIdentities).toEqual([
        [dateTime('2024-11-03T01:30:00', 'America/New_York')],
        [dateTime('2024-11-03T01:30:00', 'America/New_York')],
      ]);
    } finally {
      Settings.now = originalNow;
    }
  });

  it('applies moved and cancelled exceptions by their original recurrence IDs', () => {
    const event: CalendarEvent = {
      ...timedEvent('2026-01-01T09:00:00', 'UTC', {
        rrule: 'FREQ=DAILY;COUNT=4',
      }),
      recurrence: {
        rrule: 'FREQ=DAILY;COUNT=4',
        overrides: [
          {
            recurrenceId: dateTime('2026-01-02T09:00:00', 'UTC'),
            title: 'Moved occurrence',
            timing: {
              type: 'timed',
              start: utc('2026-01-02T12:00:00'),
              end: utc('2026-01-02T13:00:00'),
            },
          },
          {
            recurrenceId: dateTime('2026-01-03T09:00:00', 'UTC'),
            status: 'cancelled',
          },
        ],
      },
    };

    const occurrences = expandCalendarEvent(event, {
      start: '2026-01-01T00:00:00.000Z',
      end: '2026-01-05T00:00:00.000Z',
    });

    expect(
      occurrences.map((occurrence) => [
        occurrence.recurrenceId,
        occurrence.title,
        timedStart(occurrence),
      ]),
    ).toEqual([
      [dateTime('2026-01-01T09:00:00', 'UTC'), 'Event', '2026-01-01T09:00:00'],
      [
        dateTime('2026-01-02T09:00:00', 'UTC'),
        'Moved occurrence',
        '2026-01-02T12:00:00',
      ],
      [dateTime('2026-01-04T09:00:00', 'UTC'), 'Event', '2026-01-04T09:00:00'],
    ]);
  });

  it('includes moved overrides entering the requested range by original identity', () => {
    const event: CalendarEvent = {
      ...timedEvent('2026-01-01T09:00:00', 'UTC', {
        rrule: 'FREQ=DAILY;COUNT=4',
      }),
      recurrence: {
        rrule: 'FREQ=DAILY;COUNT=4',
        overrides: [
          {
            recurrenceId: dateTime('2026-01-02T09:00:00', 'UTC'),
            timing: {
              type: 'timed',
              start: utc('2026-01-03T12:00:00'),
              end: utc('2026-01-03T13:00:00'),
            },
          },
        ],
      },
    };

    const occurrences = expandCalendarEvent(event, {
      start: '2026-01-03T00:00:00.000Z',
      end: '2026-01-04T00:00:00.000Z',
    });

    expect(occurrences.map((occurrence) => occurrence.recurrenceId)).toEqual([
      dateTime('2026-01-03T09:00:00', 'UTC'),
      dateTime('2026-01-02T09:00:00', 'UTC'),
    ]);
  });

  it('uses RDATE PERIOD duration for that occurrence', () => {
    const event = timedEvent('2026-01-01T09:00:00', 'UTC', {
      rdatePeriods: [
        {
          start: dateTime('2026-01-03T09:00:00', 'UTC') as Extract<
            CalendarEventDateTime,
            { type: 'date-time' }
          >,
          duration: 'PT2H',
        },
      ],
    });

    const occurrence = expandCalendarEvent(event, {
      start: '2026-01-03T00:00:00.000Z',
      end: '2026-01-04T00:00:00.000Z',
    })[0];

    expect(occurrence.timing).toEqual({
      type: 'timed',
      start: utc('2026-01-03T09:00:00'),
      end: utc('2026-01-03T11:00:00'),
    });
  });

  it('keeps an RDATE PERIOD duration when its start duplicates DTSTART', () => {
    const event = timedEvent('2026-01-01T09:00:00', 'UTC', {
      rdatePeriods: [
        {
          start: dateTime('2026-01-01T09:00:00', 'UTC') as Extract<
            CalendarEventDateTime,
            { type: 'date-time' }
          >,
          duration: 'PT2H',
        },
      ],
    });

    const occurrence = expandCalendarEvent(event, {
      start: '2026-01-01T00:00:00.000Z',
      end: '2026-01-02T00:00:00.000Z',
    })[0];

    expect(occurrence.timing).toMatchObject({
      end: { local: '2026-01-01T11:00:00' },
    });

    const duplicatedRdate = timedEvent('2026-01-01T09:00:00', 'UTC', {
      rdates: [dateTime('2026-01-03T09:00:00', 'UTC')],
      rdatePeriods: [
        {
          start: dateTime('2026-01-03T09:00:00', 'UTC') as Extract<
            CalendarEventDateTime,
            { type: 'date-time' }
          >,
          duration: 'PT2H',
        },
      ],
    });
    const rdateOccurrence = expandCalendarEvent(duplicatedRdate, {
      start: '2026-01-03T00:00:00.000Z',
      end: '2026-01-04T00:00:00.000Z',
    })[0];

    expect(rdateOccurrence.timing).toMatchObject({
      end: { local: '2026-01-03T11:00:00' },
    });
  });

  it('distinguishes calendar days from exact hours in timezone PERIOD durations', () => {
    const range = {
      start: '2024-03-09T00:00:00.000Z',
      end: '2024-03-11T00:00:00.000Z',
    };
    const eventWithPeriod = (duration: string) =>
      timedEvent('2024-03-01T12:00:00', 'America/New_York', {
        rdatePeriods: [
          {
            start: dateTime(
              '2024-03-09T12:00:00',
              'America/New_York',
            ) as Extract<CalendarEventDateTime, { type: 'date-time' }>,
            duration,
          },
        ],
      });

    const calendarDay = expandCalendarEvent(eventWithPeriod('P1D'), range).find(
      (occurrence) =>
        occurrence.recurrenceId.type === 'date-time' &&
        occurrence.recurrenceId.value.local === '2024-03-09T12:00:00',
    );
    const exactDay = expandCalendarEvent(eventWithPeriod('PT24H'), range).find(
      (occurrence) =>
        occurrence.recurrenceId.type === 'date-time' &&
        occurrence.recurrenceId.value.local === '2024-03-09T12:00:00',
    );

    expect(calendarDay?.timing).toMatchObject({
      end: { local: '2024-03-10T12:00:00' },
    });
    expect(exactDay?.timing).toMatchObject({
      end: { local: '2024-03-10T13:00:00' },
    });

    const calendarWeek = expandCalendarEvent(
      timedEvent('2024-03-01T12:00:00', 'America/New_York', {
        rdatePeriods: [
          {
            start: dateTime(
              '2024-03-03T12:00:00',
              'America/New_York',
            ) as Extract<CalendarEventDateTime, { type: 'date-time' }>,
            duration: 'P1W',
          },
        ],
      }),
      {
        start: '2024-03-03T00:00:00.000Z',
        end: '2024-03-11T00:00:00.000Z',
      },
    ).find(
      (occurrence) =>
        occurrence.recurrenceId.type === 'date-time' &&
        occurrence.recurrenceId.value.local === '2024-03-03T12:00:00',
    );
    expect(calendarWeek?.timing).toMatchObject({
      end: { local: '2024-03-10T12:00:00' },
    });
  });

  it('requires RRULE UNTIL to match UTC, floating, and TZID DTSTART modes', () => {
    const range = {
      start: '2026-01-01T00:00:00.000Z',
      end: '2026-01-05T00:00:00.000Z',
    };
    const invalidRules = [
      timedEvent('2026-01-01T09:00:00', 'UTC', {
        rrule: 'FREQ=DAILY;UNTIL=20260103T090000',
      }),
      timedEvent('2026-01-01T09:00:00', 'floating', {
        rrule: 'FREQ=DAILY;UNTIL=20260103T090000Z',
      }),
      timedEvent('2026-01-01T09:00:00', 'Europe/Stockholm', {
        rrule: 'FREQ=DAILY;UNTIL=20260103T090000',
      }),
    ];

    for (const event of invalidRules) {
      expect(() => expandCalendarEvent(event, range)).toThrow(
        'RRULE is malformed or uses unsupported DTSTART/UNTIL value types',
      );
    }

    expect(() =>
      expandCalendarEvent(
        timedEvent('2026-01-01T09:00:00', 'UTC', { rrule: 'COUNT=3' }),
        range,
      ),
    ).toThrow(
      'RRULE is malformed or uses unsupported DTSTART/UNTIL value types',
    );
  });

  it('rejects range endpoints without explicit UTC offsets', () => {
    expect(() =>
      expandCalendarEvent(timedEvent('2026-01-01T09:00:00', 'UTC'), {
        start: '2026-01-01T00:00:00',
        end: '2026-01-02T00:00:00Z',
      }),
    ).toThrow('Expansion range must contain valid increasing instants');
  });

  it('fails visibly when floating values have no range timezone or a rule exceeds its work bound', () => {
    const floating = timedEvent('2026-01-01T09:00:00', 'floating');
    expect(() =>
      expandCalendarEvent(floating, {
        start: '2026-01-01T00:00:00.000Z',
        end: '2026-01-02T00:00:00.000Z',
      }),
    ).toThrow(CalendarEventExpansionError);

    const daily = timedEvent('2026-01-01T09:00:00', 'UTC', {
      rrule: 'FREQ=DAILY',
    });
    expect(() =>
      expandCalendarEvent(
        daily,
        {
          start: '2026-01-01T00:00:00.000Z',
          end: '2026-01-10T00:00:00.000Z',
        },
        { maxRuleCandidates: 3 },
      ),
    ).toThrow('exceeded 3 candidates');
  });

  it('rejects RRULE parts the installed engine cannot safely model', () => {
    const event = timedEvent('2026-01-01T09:00:00', 'UTC', {
      rrule: 'FREQ=YEARLY;BYEASTER=1',
    });
    expect(() =>
      expandCalendarEvent(event, {
        start: '2026-01-01T00:00:00.000Z',
        end: '2027-01-01T00:00:00.000Z',
      }),
    ).toThrow('Unsupported RRULE part: BYEASTER');
  });
});

const baseEvent: CalendarEvent = {
  id: 'event.ics',
  calendarId: 'team',
  uid: 'event@example.test',
  title: 'Event',
  timing: {
    type: 'timed',
    start: utc('2026-01-01T09:00:00'),
    end: utc('2026-01-01T10:00:00'),
  },
};

function timedEvent(
  start: string,
  timezone: string,
  recurrence: CalendarEvent['recurrence'] = {},
): CalendarEvent {
  const mode =
    timezone === 'UTC' ? 'utc' : timezone === 'floating' ? 'floating' : 'tzid';
  const end = plusHour(start);
  return {
    ...baseEvent,
    timing: {
      type: 'timed',
      start: { local: start, timezone, mode },
      end: { local: end, timezone, mode },
    },
    recurrence: Object.keys(recurrence).length > 0 ? recurrence : undefined,
  };
}

function dateTime(local: string, timezone: string): CalendarEventDateTime {
  const mode =
    timezone === 'UTC' ? 'utc' : timezone === 'floating' ? 'floating' : 'tzid';
  return { type: 'date-time', value: { local, timezone, mode } };
}

function utc(local: string) {
  return { local, timezone: 'UTC', mode: 'utc' as const };
}

function plusHour(local: string): string {
  const [date, time] = local.split('T');
  const [hour, minute, second] = time.split(':').map(Number);
  return `${date}T${String(hour + 1).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;
}

function startInstant(occurrence: { timing: CalendarEvent['timing'] }): string {
  if (occurrence.timing.type !== 'timed') {
    throw new Error('Expected timed occurrence');
  }
  const { local, timezone, mode } = occurrence.timing.start;
  if (mode === 'utc') {
    return new Date(`${local}Z`).toISOString();
  }
  if (mode === 'floating') {
    return new Date(`${local}+01:00`).toISOString();
  }
  return DateTime.fromISO(local, { zone: timezone }).toUTC().toISO();
}

function timedStart(occurrence: { timing: CalendarEvent['timing'] }): string {
  if (occurrence.timing.type !== 'timed') {
    throw new Error('Expected timed occurrence');
  }
  return occurrence.timing.start.local;
}
