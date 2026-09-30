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

import { DateTime } from 'luxon';
import type {
  CalendarEvent,
  CalendarEventDateTime,
  CalendarTimeRange,
} from '../model';
import {
  formatSupportedCalendarEventRecurrenceRule,
  isSupportedCalendarEventOccurrenceExclusion,
  parseSupportedCalendarEventRecurrenceRule,
  projectCalendarEventOccurrences,
} from './calendarEventOccurrenceProjection';
import {
  calendarLocalDateTimeToUnixMillis,
  calendarUnixMillisToLocalDateTime,
} from './calendarEventTimezone';

const stockholmRange: CalendarTimeRange = {
  start: '2026-10-23T00:00:00Z',
  end: '2026-11-07T00:00:00Z',
};

describe('supported series recurrence rules', () => {
  const zonedAnchor: CalendarEventDateTime = {
    type: 'date-time',
    value: { local: '2026-10-26T09:00:00', timezone: 'Europe/Stockholm' },
  };

  it.each(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] as const)(
    'parses the %s frequency and serializes a bounded rule',
    (frequency) => {
      const rule = {
        frequency,
        interval: 2,
        end: { type: 'count' as const, count: 5 },
      };

      expect(
        formatSupportedCalendarEventRecurrenceRule(rule, zonedAnchor),
      ).toBe(`FREQ=${frequency};INTERVAL=2;COUNT=5`);
      expect(
        parseSupportedCalendarEventRecurrenceRule(
          `FREQ=${frequency};INTERVAL=2;COUNT=5`,
          zonedAnchor,
        ),
      ).toEqual(rule);
    },
  );

  it('validates date, floating, and zoned UNTIL value kinds', () => {
    expect(
      parseSupportedCalendarEventRecurrenceRule(
        'FREQ=DAILY;UNTIL=20261231T225959Z',
        zonedAnchor,
      ),
    ).toMatchObject({ end: { type: 'until', value: '20261231T225959Z' } });
    expect(
      parseSupportedCalendarEventRecurrenceRule('FREQ=DAILY;UNTIL=20261231', {
        type: 'date',
        value: '2026-10-26',
      }),
    ).toMatchObject({ end: { type: 'until', value: '20261231' } });
    expect(
      parseSupportedCalendarEventRecurrenceRule(
        'FREQ=DAILY;UNTIL=20261231T235959',
        { type: 'floating-date-time', value: '2026-10-26T09:00:00' },
      ),
    ).toMatchObject({ end: { type: 'until', value: '20261231T235959' } });
  });

  it.each([
    'FREQ=WEEKLY;BYDAY=MO',
    'FREQ=HOURLY',
    'FREQ=DAILY;INTERVAL=0',
    'FREQ=DAILY;COUNT=2;UNTIL=20261231T225959Z',
    'FREQ=DAILY;UNTIL=20261231',
    'FREQ=DAILY;UNTIL=20261231T235959',
  ])('rejects unsupported or anchor-incompatible rule %s', (rule) => {
    expect(() =>
      parseSupportedCalendarEventRecurrenceRule(rule, zonedAnchor),
    ).toThrow('Unsupported recurrence rule');
  });
});

describe('projectCalendarEventOccurrences', () => {
  it('keeps RRULE, RDATE, EXDATE, moved overrides, and cancellation identities distinct', () => {
    const event = timedEvent({
      recurrence: {
        rrule: 'FREQ=WEEKLY;COUNT=4',
        rdates: [zoned('2026-11-02T09:00:00')],
        exdates: [zoned('2026-11-06T09:00:00')],
        overrides: [
          {
            recurrenceId: zoned('2026-10-30T09:00:00'),
            status: 'tentative',
            timing: {
              type: 'end',
              start: zoned('2026-10-31T11:00:00'),
              end: zoned('2026-10-31T12:00:00'),
            },
          },
          {
            recurrenceId: zoned('2026-11-13T09:00:00'),
            status: 'cancelled',
          },
        ],
      },
    });
    const original = structuredClone(event);

    const result = projectCalendarEventOccurrences(
      [event],
      stockholmRange,
      'Europe/Stockholm',
    );

    expect(result.diagnostics).toEqual([]);
    expect(
      result.occurrences.map(({ event: occurrence }) =>
        occurrence.timing.type === 'timed'
          ? occurrence.timing.start.local
          : occurrence.timing.startDate,
      ),
    ).toEqual(
      expect.arrayContaining([
        '2026-10-23T09:00:00',
        '2026-10-31T11:00:00',
        '2026-11-02T09:00:00',
      ]),
    );
    expect(result.occurrences).toHaveLength(3);
    expect(
      new Set(result.occurrences.map(({ event: item }) => item.id)).size,
    ).toBe(3);
    expect(
      result.occurrences.every(({ sourceEvent }) => sourceEvent === event),
    ).toBe(true);
    const movedOccurrence = result.occurrences.find(({ recurrenceIdentity }) =>
      recurrenceIdentity?.includes('2026-10-30T09:00:00'),
    );
    expect(movedOccurrence).toBeDefined();
    expect(movedOccurrence?.event.id).not.toBe(event.id);
    expect(movedOccurrence?.event.status).toBe('tentative');
    expect(movedOccurrence?.recurrenceId).toEqual(zoned('2026-10-30T09:00:00'));
    expect(
      isSupportedCalendarEventOccurrenceExclusion(
        event,
        zoned('2026-10-30T09:00:00'),
      ),
    ).toBe(true);

    const skippedMovedInstance = projectCalendarEventOccurrences(
      [
        {
          ...event,
          recurrence: {
            ...event.recurrence,
            exdates: [
              ...(event.recurrence?.exdates ?? []),
              zoned('2026-10-30T09:00:00'),
            ],
          },
        },
      ],
      stockholmRange,
      'Europe/Stockholm',
    );
    expect(
      skippedMovedInstance.occurrences.some(
        ({ recurrenceId }) =>
          recurrenceId?.type === 'date-time' &&
          recurrenceId.value.local === '2026-10-30T09:00:00',
      ),
    ).toBe(false);
    expect(event).toEqual(original);
  });

  it('keeps an override moved into the range when its original recurrence identity is outside it', () => {
    const event = timedEvent({
      recurrence: {
        rrule: 'FREQ=DAILY;COUNT=3',
        overrides: [
          {
            recurrenceId: zoned('2026-10-01T09:00:00'),
            timing: {
              type: 'end',
              start: zoned('2026-10-30T12:00:00'),
              end: zoned('2026-10-30T13:00:00'),
            },
          },
        ],
      },
    });

    const result = projectCalendarEventOccurrences(
      [event],
      {
        start: '2026-10-30T00:00:00Z',
        end: '2026-10-31T00:00:00Z',
      },
      'Europe/Stockholm',
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.occurrences).toHaveLength(1);
    expect(result.occurrences[0].event.timing).toMatchObject({
      start: { local: '2026-10-30T12:00:00' },
    });
    expect(result.occurrences[0].recurrenceIdentity).toContain(
      '2026-10-01T09:00:00',
    );
  });

  it('uses exact half-open overlap for timed and all-day events', () => {
    const result = projectCalendarEventOccurrences(
      [
        timedEvent({
          id: 'ending-at-start',
          start: '2026-10-01T09:00:00',
          end: '2026-10-01T10:00:00',
        }),
        timedEvent({
          id: 'starting-at-end',
          start: '2026-10-01T12:00:00',
          end: '2026-10-01T13:00:00',
        }),
        timedEvent({
          id: 'overlapping',
          start: '2026-10-01T09:59:00',
          end: '2026-10-01T10:01:00',
        }),
        {
          id: 'all-day-boundary',
          calendarId: 'team',
          uid: 'all-day-boundary@example.test',
          title: 'All day boundary',
          timing: {
            type: 'all-day',
            startDate: '2026-10-01',
            endDate: '2026-10-02',
          },
        },
      ],
      {
        start: '2026-10-01T08:00:00Z',
        end: '2026-10-01T10:00:00Z',
      },
      'UTC',
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.occurrences.map(({ sourceEvent }) => sourceEvent.id)).toEqual(
      ['overlapping', 'all-day-boundary'],
    );
  });

  it('interprets floating occurrences in the viewer zone and clips at its exact end', () => {
    const event: CalendarEvent = {
      id: 'floating',
      calendarId: 'team',
      uid: 'floating@example.test',
      title: 'Floating event',
      timing: {
        type: 'timed',
        start: { type: 'floating', local: '2026-10-01T09:00:00' },
        end: { type: 'floating', local: '2026-10-01T10:00:00' },
      },
    };

    expect(
      projectCalendarEventOccurrences(
        [event],
        {
          start: '2026-10-01T16:00:00Z',
          end: '2026-10-01T17:00:00Z',
        },
        'America/Los_Angeles',
      ).occurrences,
    ).toHaveLength(1);
    expect(
      projectCalendarEventOccurrences(
        [event],
        {
          start: '2026-10-01T17:00:00Z',
          end: '2026-10-01T18:00:00Z',
        },
        'America/Los_Angeles',
      ).occurrences,
    ).toHaveLength(0);
  });

  it('keeps floating RRULE wall time in the viewer zone across a DST change', () => {
    const event: CalendarEvent = {
      id: 'floating-daily',
      calendarId: 'team',
      uid: 'floating-daily@example.test',
      title: 'Floating daily event',
      timing: {
        type: 'timed',
        start: { type: 'floating', local: '2026-03-28T09:00:00' },
        end: { type: 'floating', local: '2026-03-28T10:00:00' },
      },
      recurrence: { rrule: 'FREQ=DAILY;COUNT=3' },
    };

    const result = projectCalendarEventOccurrences(
      [event],
      {
        start: '2026-03-28T00:00:00Z',
        end: '2026-03-31T00:00:00Z',
      },
      'Europe/Stockholm',
    );

    expect(result.diagnostics).toEqual([]);
    expect(
      result.occurrences.map(({ event: occurrence }) => {
        if (occurrence.timing.type !== 'timed') {
          throw new Error('Expected a timed occurrence');
        }
        return [occurrence.timing.start.local, occurrence.timing.end.local];
      }),
    ).toEqual([
      ['2026-03-28T09:00:00', '2026-03-28T10:00:00'],
      ['2026-03-29T09:00:00', '2026-03-29T10:00:00'],
      ['2026-03-30T09:00:00', '2026-03-30T10:00:00'],
    ]);
  });

  it('accepts minute-precision local values and matches second-precision recurrence exceptions', () => {
    const event: CalendarEvent = {
      id: 'minute-precision',
      calendarId: 'team',
      uid: 'minute-precision@example.test',
      title: 'Minute precision',
      timing: {
        type: 'timed',
        start: {
          type: 'zoned',
          local: '2026-10-23T09:00',
          timezone: 'Europe/Stockholm',
        },
        end: {
          type: 'zoned',
          local: '2026-10-23T10:00',
          timezone: 'Europe/Stockholm',
        },
      },
      recurrence: {
        rrule: 'FREQ=DAILY;COUNT=2',
        exdates: [zoned('2026-10-24T09:00:00')],
      },
    };

    const result = projectCalendarEventOccurrences(
      [event],
      {
        start: '2026-10-23T00:00:00Z',
        end: '2026-10-26T00:00:00Z',
      },
      'Europe/Stockholm',
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.occurrences).toHaveLength(1);
    expect(result.occurrences[0].event.timing).toMatchObject({
      start: { local: '2026-10-23T09:00:00' },
    });
  });

  it('keeps explicit DTEND exact while RFC day and hour duration units follow DST rules', () => {
    const event = timedEvent({
      id: 'dst-series',
      start: '2026-03-27T01:30:00',
      end: '2026-03-27T03:30:00',
      recurrence: {
        rrule: 'FREQ=DAILY;COUNT=3',
        rdates: [
          {
            type: 'period',
            timing: {
              type: 'duration',
              start: zoned('2026-03-28T12:00:00'),
              duration: duration({ days: 1 }),
            },
          },
          {
            type: 'period',
            timing: {
              type: 'duration',
              start: zoned('2026-03-28T13:00:00'),
              duration: duration({ hours: 24 }),
            },
          },
        ],
      },
    });
    const result = projectCalendarEventOccurrences(
      [event],
      {
        start: '2026-03-28T00:00:00Z',
        end: '2026-03-30T00:00:00Z',
      },
      'Europe/Stockholm',
    );

    expect(result.diagnostics).toEqual([]);
    const eventsByStart = new Map(
      result.occurrences.map(({ event: occurrence }) => {
        if (occurrence.timing.type !== 'timed') {
          throw new Error('Expected timed occurrence');
        }
        return [occurrence.timing.start.local, occurrence.timing];
      }),
    );

    expect(eventsByStart.get('2026-03-29T01:30:00')?.end.local).toBe(
      '2026-03-29T04:30:00',
    );
    expect(eventsByStart.get('2026-03-28T12:00:00')?.end.local).toBe(
      '2026-03-29T12:00:00',
    );
    expect(eventsByStart.get('2026-03-28T13:00:00')?.end.local).toBe(
      '2026-03-29T14:00:00',
    );

    const nominalStart = DateTime.fromISO('2026-03-28T12:00:00', {
      zone: 'Europe/Stockholm',
    });
    const nominalEnd = DateTime.fromISO('2026-03-29T12:00:00', {
      zone: 'Europe/Stockholm',
    });
    const exactStart = DateTime.fromISO('2026-03-28T13:00:00', {
      zone: 'Europe/Stockholm',
    });
    const exactEnd = DateTime.fromISO('2026-03-29T14:00:00', {
      zone: 'Europe/Stockholm',
    });
    expect(nominalEnd.diff(nominalStart, 'hours').hours).toBe(23);
    expect(exactEnd.diff(exactStart, 'hours').hours).toBe(24);
  });

  it('uses pinned IANA rules for named-zone recurrence across an Inuvik transition', () => {
    const event: CalendarEvent = {
      id: 'inuvik',
      calendarId: 'team',
      uid: 'inuvik@example.test',
      title: 'Inuvik planning',
      timing: {
        type: 'timed',
        start: {
          type: 'zoned',
          local: '2026-03-06T09:00:00',
          timezone: 'America/Inuvik',
        },
        end: {
          type: 'zoned',
          local: '2026-03-06T10:00:00',
          timezone: 'America/Inuvik',
        },
      },
      recurrence: { rrule: 'FREQ=DAILY;COUNT=4' },
    };

    const result = projectCalendarEventOccurrences(
      [event],
      {
        start: '2026-03-06T00:00:00Z',
        end: '2026-03-10T00:00:00Z',
      },
      'America/Inuvik',
    );

    expect(result.diagnostics).toEqual([]);
    expect(
      result.occurrences.map(({ event: occurrence }) =>
        occurrence.timing.type === 'timed'
          ? occurrence.timing.start.local
          : undefined,
      ),
    ).toEqual([
      '2026-03-06T09:00:00',
      '2026-03-07T09:00:00',
      '2026-03-08T09:00:00',
      '2026-03-09T09:00:00',
    ]);
    expect(
      new Date(
        calendarLocalDateTimeToUnixMillis(
          '2026-03-08T09:00:00',
          'America/Inuvik',
        ),
      ).toISOString(),
    ).toBe('2026-03-08T15:00:00.000Z');
  });

  it('omits RRULE gap instances without consuming COUNT and resolves overlaps to the first instant', () => {
    const event = timedEvent({
      id: 'stockholm-gap',
      start: '2026-03-28T02:30:00',
      end: '2026-03-28T03:30:00',
      recurrence: { rrule: 'FREQ=DAILY;COUNT=4' },
    });
    const result = projectCalendarEventOccurrences(
      [event],
      {
        start: '2026-03-27T00:00:00Z',
        end: '2026-04-03T00:00:00Z',
      },
      'Europe/Stockholm',
    );

    expect(result.diagnostics).toEqual([]);
    expect(
      result.occurrences.map(({ event: occurrence }) =>
        occurrence.timing.type === 'timed'
          ? occurrence.timing.start.local
          : undefined,
      ),
    ).toEqual([
      '2026-03-28T02:30:00',
      '2026-03-30T02:30:00',
      '2026-03-31T02:30:00',
      '2026-04-01T02:30:00',
    ]);
    expect(
      new Date(
        calendarLocalDateTimeToUnixMillis(
          '2026-10-25T02:30:00',
          'Europe/Stockholm',
        ),
      ).toISOString(),
    ).toBe('2026-10-25T00:30:00.000Z');
    expect(
      calendarUnixMillisToLocalDateTime(
        Date.parse('2026-10-25T01:30:00Z'),
        'Europe/Stockholm',
      ),
    ).toBe('2026-10-25T02:30:00');
    expect(
      new Date(
        calendarLocalDateTimeToUnixMillis(
          '2026-03-29T02:30:00',
          'Europe/Stockholm',
        ),
      ).toISOString(),
    ).toBe('2026-03-29T01:30:00.000Z');
  });

  it('rejects malformed COUNT and calendar-invalid DATE UNTIL values', () => {
    const malformedCount = timedEvent({
      id: 'malformed-count',
      recurrence: { rrule: 'FREQ=DAILY;COUNT=0x10' },
    });
    const malformedUntil: CalendarEvent = {
      id: 'malformed-until',
      calendarId: 'team',
      uid: 'malformed-until@example.test',
      title: 'Malformed until',
      timing: {
        type: 'all-day',
        startDate: '2026-09-01',
        endDate: '2026-09-02',
      },
      recurrence: { rrule: 'FREQ=DAILY;UNTIL=20260932' },
    };

    const result = projectCalendarEventOccurrences(
      [malformedCount, malformedUntil],
      stockholmRange,
      'Europe/Stockholm',
    );

    expect(result.occurrences).toEqual([]);
    expect(result.diagnostics).toEqual([
      { sourceEvent: malformedCount, reason: 'invalid-recurrence' },
      { sourceEvent: malformedUntil, reason: 'invalid-recurrence' },
    ]);
  });

  it('rejects RRULE BY values outside the supported ranges with diagnostics', () => {
    const malformed = ['BYHOUR=99', 'BYMONTH=13', 'BYSECOND=61'].map((byPart) =>
      timedEvent({
        id: `malformed-${byPart.toLowerCase()}`,
        recurrence: { rrule: `FREQ=DAILY;${byPart}` },
      }),
    );

    const result = projectCalendarEventOccurrences(
      malformed,
      stockholmRange,
      'Europe/Stockholm',
    );

    expect(result.occurrences).toEqual([]);
    expect(result.diagnostics).toEqual(
      malformed.map((sourceEvent) => ({
        sourceEvent,
        reason: 'invalid-recurrence',
      })),
    );
  });

  it('enforces BY-part lexical grammar while accepting valid hours and signed month days', () => {
    const malformed = ['BYHOUR=+9', 'BYHOUR=0009'].map((byPart) =>
      timedEvent({
        id: `malformed-${byPart.toLowerCase()}`,
        recurrence: { rrule: `FREQ=DAILY;COUNT=2;${byPart}` },
      }),
    );
    const invalidResult = projectCalendarEventOccurrences(
      malformed,
      stockholmRange,
      'Europe/Stockholm',
    );

    expect(invalidResult.occurrences).toEqual([]);
    expect(invalidResult.diagnostics).toEqual(
      malformed.map((sourceEvent) => ({
        sourceEvent,
        reason: 'invalid-recurrence',
      })),
    );

    const valid = [
      timedEvent({
        id: 'hour-single-digit',
        recurrence: { rrule: 'FREQ=DAILY;COUNT=2;BYHOUR=9' },
      }),
      timedEvent({
        id: 'hour-zero-padded',
        recurrence: { rrule: 'FREQ=DAILY;COUNT=2;BYHOUR=09' },
      }),
      timedEvent({
        id: 'last-day-of-month',
        start: '2026-10-31T09:00:00',
        end: '2026-10-31T10:00:00',
        recurrence: { rrule: 'FREQ=MONTHLY;COUNT=2;BYMONTHDAY=-1' },
      }),
    ];
    const validResult = projectCalendarEventOccurrences(
      valid,
      {
        start: '2026-10-23T00:00:00Z',
        end: '2026-12-01T00:00:00Z',
      },
      'Europe/Stockholm',
    );

    expect(validResult.diagnostics).toEqual([]);
    expect(
      validResult.occurrences
        .filter(({ sourceEvent }) => sourceEvent.id === 'hour-single-digit')
        .map(({ event }) => {
          if (event.timing.type !== 'timed') {
            throw new Error('Expected a timed occurrence');
          }
          return event.timing.start.local;
        }),
    ).toEqual(['2026-10-23T09:00:00', '2026-10-24T09:00:00']);
    expect(
      validResult.occurrences
        .filter(({ sourceEvent }) => sourceEvent.id === 'hour-zero-padded')
        .map(({ event }) => {
          if (event.timing.type !== 'timed') {
            throw new Error('Expected a timed occurrence');
          }
          return event.timing.start.local;
        }),
    ).toEqual(['2026-10-23T09:00:00', '2026-10-24T09:00:00']);
    expect(
      validResult.occurrences
        .filter(({ sourceEvent }) => sourceEvent.id === 'last-day-of-month')
        .map(({ event }) => {
          if (event.timing.type !== 'timed') {
            throw new Error('Expected a timed occurrence');
          }
          return event.timing.start.local;
        }),
    ).toEqual(['2026-10-31T09:00:00', '2026-11-30T09:00:00']);
  });

  it('reports RFC-valid leap-second BYSECOND=60 as unsupported without changing the source', () => {
    const event = timedEvent({
      id: 'leap-second',
      recurrence: { rrule: 'FREQ=DAILY;BYSECOND=60' },
    });
    const original = structuredClone(event);

    const result = projectCalendarEventOccurrences(
      [event],
      stockholmRange,
      'Europe/Stockholm',
    );

    expect(result.occurrences).toEqual([]);
    expect(result.diagnostics).toEqual([
      { sourceEvent: event, reason: 'unsupported-recurrence' },
    ]);
    expect(event).toEqual(original);
  });

  it('diagnoses oversized recurrence arrays before traversing their members', () => {
    const blocked = <T>(items: T[]) =>
      new Proxy(items, {
        get(target, property, receiver) {
          if (property === Symbol.iterator || property === 'map') {
            throw new Error('oversized recurrence array was traversed');
          }
          return Reflect.get(target, property, receiver);
        },
      });
    const recurrence = {
      rdates: blocked(
        Array.from({ length: 2_000 }, () => zoned('2026-11-01T09:00:00')),
      ),
      exdates: blocked(
        Array.from({ length: 2_000 }, () => zoned('2026-11-02T09:00:00')),
      ),
      overrides: blocked(
        Array.from({ length: 97 }, () => ({
          recurrenceId: zoned('2026-11-03T09:00:00'),
          status: 'cancelled' as const,
        })),
      ),
    };
    const event = timedEvent({
      id: 'oversized-rdates',
      recurrence,
    });

    const result = projectCalendarEventOccurrences(
      [event],
      stockholmRange,
      'Europe/Stockholm',
    );

    expect(result.occurrences).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].sourceEvent).toBe(event);
    expect(result.diagnostics[0].reason).toBe('recurrence-input-limit');
  });

  it('keeps unsupported range overrides and malformed rules opaque with diagnostics', () => {
    const unsupported = timedEvent({
      id: 'this-and-future',
      recurrence: { rrule: 'FREQ=WEEKLY' },
      unsupportedRecurrence: 'range-this-and-future',
    });
    const malformed = timedEvent({
      id: 'malformed',
      recurrence: { rrule: 'FREQ=DAILY;RSCALE=GREGORIAN' },
    });
    const divergentTimezone = timedEvent({
      id: 'divergent-timezone',
      start: '2026-10-25T03:15:00',
      end: '2026-10-25T03:45:00',
      unsupportedTimezone: true,
    });
    const unsupportedTimezone: CalendarEvent = {
      id: 'unsupported-timezone',
      calendarId: 'team',
      uid: 'unsupported-timezone@example.test',
      title: 'Unsupported timezone',
      timing: {
        type: 'timed',
        start: {
          type: 'zoned',
          local: '2026-10-23T09:00:00',
          timezone: 'Custom/Unbundled',
        },
        end: {
          type: 'zoned',
          local: '2026-10-23T10:00:00',
          timezone: 'Custom/Unbundled',
        },
      },
    };

    const result = projectCalendarEventOccurrences(
      [unsupported, malformed, unsupportedTimezone, divergentTimezone],
      stockholmRange,
      'Europe/Stockholm',
    );

    expect(result.occurrences).toEqual([]);
    expect(result.diagnostics).toEqual([
      { sourceEvent: unsupported, reason: 'invalid-recurrence' },
      { sourceEvent: malformed, reason: 'invalid-recurrence' },
      { sourceEvent: unsupportedTimezone, reason: 'unsupported-timezone' },
      { sourceEvent: divergentTimezone, reason: 'unsupported-timezone' },
    ]);
    expect(
      isSupportedCalendarEventOccurrenceExclusion(
        unsupported,
        zoned('2026-10-30T09:00:00'),
      ),
    ).toBe(false);
    expect(
      isSupportedCalendarEventOccurrenceExclusion(
        malformed,
        zoned('2026-10-30T09:00:00'),
      ),
    ).toBe(false);
  });
});

function timedEvent({
  id = 'planning',
  start = '2026-10-23T09:00:00',
  end = '2026-10-23T10:00:00',
  recurrence,
  unsupportedRecurrence,
  unsupportedTimezone,
}: {
  id?: string;
  start?: string;
  end?: string;
  recurrence?: CalendarEvent['recurrence'];
  unsupportedRecurrence?: CalendarEvent['unsupportedRecurrence'];
  unsupportedTimezone?: CalendarEvent['unsupportedTimezone'];
} = {}): CalendarEvent {
  return {
    id,
    calendarId: 'team',
    uid: `${id}@example.test`,
    title: 'Team planning',
    timing: {
      type: 'timed',
      start: { type: 'zoned', local: start, timezone: 'Europe/Stockholm' },
      end: { type: 'zoned', local: end, timezone: 'Europe/Stockholm' },
    },
    recurrence,
    unsupportedRecurrence,
    unsupportedTimezone,
  };
}

function zoned(local: string): CalendarEventDateTime {
  return {
    type: 'date-time',
    value: { local, timezone: 'Europe/Stockholm' },
  };
}

function duration(
  values: Partial<{
    weeks: number;
    days: number;
    hours: number;
    minutes: number;
    seconds: number;
  }>,
) {
  return {
    weeks: 0,
    days: 0,
    hours: 0,
    minutes: 0,
    seconds: 0,
    isNegative: false,
    ...values,
  };
}
