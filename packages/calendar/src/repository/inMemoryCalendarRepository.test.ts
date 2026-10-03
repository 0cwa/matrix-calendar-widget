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

import { Settings } from 'luxon';
import {
  Calendar,
  CalendarEvent,
  CalendarEventInput,
  CalendarEventPatch,
  CalendarEventRecurrenceDate,
  CalendarEventRecurrenceOverride,
} from '../model';
import { CalendarRepositoryError, InMemoryCalendarRepository } from './index';

const calendars: Calendar[] = [
  {
    id: 'team',
    name: 'Team calendar',
    timezone: 'Europe/Stockholm',
  },
  {
    id: 'readonly',
    name: 'Read-only calendar',
    timezone: 'Europe/Stockholm',
    readOnly: true,
  },
];

const events: CalendarEvent[] = [
  {
    id: 'planning',
    calendarId: 'team',
    uid: 'planning@example.test',
    title: 'Planning',
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
  },
  {
    id: 'holiday',
    calendarId: 'team',
    uid: 'holiday@example.test',
    title: 'Holiday',
    timing: {
      type: 'all-day',
      startDate: '2026-10-05',
      endDate: '2026-10-06',
    },
  },
  {
    id: 'old-recurring',
    calendarId: 'team',
    uid: 'recurring@example.test',
    title: 'Weekly sync',
    timing: {
      type: 'timed',
      start: {
        type: 'zoned',
        local: '2026-01-05T09:00:00',
        timezone: 'Europe/Stockholm',
      },
      end: {
        type: 'zoned',
        local: '2026-01-05T09:30:00',
        timezone: 'Europe/Stockholm',
      },
    },
    recurrence: {
      rrule: 'FREQ=WEEKLY',
    },
  },
];

function createRepository(): InMemoryCalendarRepository {
  return new InMemoryCalendarRepository({
    calendars,
    events,
    calendarIdFactory: (sequence) => `calendar-${sequence}`,
    idFactory: (sequence) => `generated-${sequence}`,
  });
}

describe('InMemoryCalendarRepository', () => {
  it('lists defensive calendar copies', async () => {
    const repository = createRepository();

    const result = await repository.listCalendars();
    result[0].name = 'Mutated by caller';

    expect((await repository.listCalendars())[0].name).toBe('Team calendar');
  });

  it('returns defensive copies of supported component metadata', async () => {
    const repository = new InMemoryCalendarRepository({
      calendars: [
        {
          id: 'mixed',
          name: 'Mixed calendar',
          supportedComponents: ['VEVENT', 'VTODO'],
        },
      ],
    });

    const listed = await repository.listCalendars();
    listed[0].supportedComponents?.push('VJOURNAL');

    expect((await repository.listCalendars())[0].supportedComponents).toEqual([
      'VEVENT',
      'VTODO',
    ]);
  });

  it('defensively clones read-only event revision metadata', async () => {
    const revision = {
      dtstamp: '2026-10-03T15:16:17Z',
      created: '2026-10-02T09:00:00Z',
      lastModified: '2026-10-03T15:16:17Z',
      sequence: 4,
    };
    const repository = new InMemoryCalendarRepository({
      calendars,
      events: [{ ...events[0], id: 'revised', revision }],
    });

    revision.sequence = 99;
    const returned = await repository.getEvent('team', 'revised');
    expect(returned.revision?.sequence).toBe(4);

    Object.assign(returned.revision!, { sequence: 100 });
    expect(
      (await repository.getEvent('team', 'revised')).revision?.sequence,
    ).toBe(4);
  });

  it('defensively clones projected external links', async () => {
    const sourceLink = {
      kind: 'event' as const,
      href: 'https://example.test/original',
    };
    const repository = new InMemoryCalendarRepository({
      calendars,
      events: [{ ...events[0], id: 'linked', externalLinks: [sourceLink] }],
    });

    sourceLink.href = 'https://example.test/source-mutated';
    const returned = await repository.getEvent('team', 'linked');
    expect(returned.externalLinks?.[0].href).toBe(
      'https://example.test/original',
    );

    Object.assign(returned.externalLinks![0], {
      href: 'https://example.test/returned-mutated',
    });
    const fetched = await repository.getEvent('team', 'linked');
    expect(fetched.externalLinks?.[0].href).toBe(
      'https://example.test/original',
    );
  });

  it('defensively clones recurrence override identity and timing', async () => {
    const inputOverride = recurrenceOverride();
    const inputRdate = recurrencePeriod();
    const inputEvent: CalendarEvent = {
      ...events[2],
      id: 'recurring-with-override',
      recurrence: {
        rrule: 'FREQ=WEEKLY',
        rdates: [inputRdate],
        overrides: [inputOverride],
      },
    };
    const repository = new InMemoryCalendarRepository({
      calendars,
      events: [inputEvent],
    });

    mutateRecurrenceOverride(inputOverride);
    mutateRecurrencePeriod(inputRdate);
    const afterConstruction = await repository.getEvent(
      'team',
      'recurring-with-override',
    );
    expect(afterConstruction.recurrence?.overrides?.[0]).toMatchObject(
      expectedRecurrenceOverride(),
    );
    expect(afterConstruction.recurrence?.rdates?.[0]).toMatchObject(
      expectedRecurrencePeriod(),
    );

    const updated = await repository.updateEvent(
      'team',
      'recurring-with-override',
      { title: 'Updated series title' },
    );
    mutateRecurrenceOverride(updated.recurrence!.overrides![0]);
    mutateRecurrencePeriod(updated.recurrence!.rdates![0]);

    const afterUpdate = await repository.getEvent(
      'team',
      'recurring-with-override',
    );
    expect(afterUpdate.recurrence?.overrides?.[0]).toMatchObject(
      expectedRecurrenceOverride(),
    );
    expect(afterUpdate.recurrence?.rdates?.[0]).toMatchObject(
      expectedRecurrencePeriod(),
    );
  });

  it('adds and defensively returns an explicit-end PERIOD recurrence date', async () => {
    const event: CalendarEvent = {
      ...events[2],
      id: 'period-add',
      recurrence: { rrule: 'FREQ=WEEKLY' },
    };
    const repository = new InMemoryCalendarRepository({
      calendars,
      events: [event],
    });
    const value = {
      type: 'period' as const,
      timing: {
        type: 'end' as const,
        start: {
          type: 'floating-date-time' as const,
          value: '2026-10-29T09:30:00',
        },
        end: {
          type: 'floating-date-time' as const,
          value: '2026-10-29T10:30:00',
        },
      },
    };

    const updated = await repository.updateEvent('team', 'period-add', {
      recurrence: { rdate: { action: 'add-period', value } },
    });
    expect(updated.recurrence?.rdates).toEqual([value]);
    const returned = updated.recurrence?.rdates?.[0];
    if (
      !returned ||
      returned.type !== 'period' ||
      returned.timing.type !== 'end' ||
      returned.timing.start.type !== 'floating-date-time'
    ) {
      throw new Error('Expected cloned explicit-end PERIOD RDATE');
    }
    returned.timing.start.value = '2099-01-01T00:00:00';
    const fetched = await repository.getEvent('team', 'period-add');
    expect(fetched.recurrence?.rdates).toEqual([value]);
  });

  it('stores occurrence timing overrides without changing the series timing', async () => {
    const event: CalendarEvent = {
      ...events[2],
      id: 'occurrence-timing',
      recurrence: { rrule: 'FREQ=WEEKLY;COUNT=4' },
    };
    const repository = new InMemoryCalendarRepository({
      calendars,
      events: [event],
    });
    const recurrenceId = {
      type: 'date-time' as const,
      value: {
        local: '2026-01-12T09:00:00',
        timezone: 'Europe/Stockholm',
      },
    };
    const timing = {
      type: 'end' as const,
      start: {
        type: 'date-time' as const,
        value: {
          local: '2026-01-12T11:00:00',
          timezone: 'Europe/Stockholm',
        },
      },
      end: {
        type: 'date-time' as const,
        value: {
          local: '2026-01-12T12:00:00',
          timezone: 'Europe/Stockholm',
        },
      },
    };

    const updated = await repository.updateEvent('team', event.id, {
      recurrence: {
        occurrence: {
          action: 'set-timing',
          recurrenceId,
          timing,
          viewerTimezone: 'Europe/Stockholm',
        },
      },
    });

    expect(updated.timing).toEqual(event.timing);
    expect(updated.recurrence?.overrides).toEqual([{ recurrenceId, timing }]);
    const fetched = await repository.getEvent('team', event.id);
    expect(fetched.recurrence?.overrides).toEqual([{ recurrenceId, timing }]);
  });

  it('rejects malformed occurrence operations and durations before mutation', async () => {
    const event: CalendarEvent = {
      ...events[2],
      id: 'invalid-occurrence-timing',
      recurrence: { rrule: 'FREQ=WEEKLY;COUNT=4' },
    };
    const repository = new InMemoryCalendarRepository({
      calendars,
      events: [event],
    });
    const recurrenceId = {
      type: 'date-time',
      value: {
        local: '2026-01-12T09:00:00',
        timezone: 'Europe/Stockholm',
      },
    };
    const start = {
      type: 'date-time',
      value: {
        local: '2026-01-12T11:00:00',
        timezone: 'Europe/Stockholm',
      },
    };
    const validDuration = {
      weeks: 0,
      days: 0,
      hours: 1,
      minutes: 0,
      seconds: 0,
      isNegative: false,
    };
    const operation = (overrides: Record<string, unknown> = {}) => ({
      action: 'set-timing',
      recurrenceId,
      timing: { type: 'duration', start, duration: validDuration },
      viewerTimezone: 'Europe/Stockholm',
      ...overrides,
    });
    const invalidOperations = [
      operation({ action: 'remove' }),
      operation({
        recurrenceId: {
          type: 'date-time',
          value: {
            local: '2026-01-32T09:00:00',
            timezone: 'Europe/Stockholm',
          },
        },
      }),
      operation({
        timing: {
          type: 'duration',
          start,
          duration: { ...validDuration, hours: -1 },
        },
      }),
      operation({
        timing: {
          type: 'duration',
          start,
          duration: { ...validDuration, minutes: 0.5 },
        },
      }),
      operation({
        timing: {
          type: 'duration',
          start,
          duration: {
            ...validDuration,
            seconds: Number.MAX_SAFE_INTEGER + 1,
          },
        },
      }),
      operation({
        timing: {
          type: 'duration',
          start,
          duration: { ...validDuration, weeks: 1 },
        },
      }),
      operation({ unexpected: true }),
    ];

    for (const invalidOperation of invalidOperations) {
      await expect(
        repository.updateEvent('team', event.id, {
          recurrence: { occurrence: invalidOperation },
        } as unknown as CalendarEventPatch),
      ).rejects.toMatchObject({ code: 'unsupported-patch' });
      expect(await repository.getEvent('team', event.id)).toEqual(event);
    }

    await expect(
      repository.updateEvent('team', event.id, {
        title: 'Should not apply beside occurrence timing',
        recurrence: { occurrence: operation() },
      } as unknown as CalendarEventPatch),
    ).rejects.toMatchObject({ code: 'unsupported-patch' });
    expect(await repository.getEvent('team', event.id)).toEqual(event);
  });

  it('rejects DATE duration overrides and leaves the all-day series unchanged', async () => {
    const event: CalendarEvent = {
      ...events[1],
      id: 'date-duration-occurrence',
      recurrence: { rrule: 'FREQ=DAILY;COUNT=3' },
    };
    const repository = new InMemoryCalendarRepository({
      calendars,
      events: [event],
    });

    await expect(
      repository.updateEvent('team', event.id, {
        recurrence: {
          occurrence: {
            action: 'set-timing',
            recurrenceId: { type: 'date', value: '2026-10-06' },
            timing: {
              type: 'duration',
              start: { type: 'date', value: '2026-10-06' },
              duration: {
                weeks: 0,
                days: 1,
                hours: 0,
                minutes: 0,
                seconds: 0,
                isNegative: false,
              },
            },
            viewerTimezone: 'Europe/Stockholm',
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'unsupported-patch' });
    expect(await repository.getEvent('team', event.id)).toEqual(event);
  });

  it('rejects occurrence timing edits for alarm-bearing instances', async () => {
    const recurring: CalendarEvent = {
      ...events[2],
      recurrence: {
        rrule: 'FREQ=WEEKLY;COUNT=4',
        exdates: [
          {
            type: 'date-time',
            value: {
              local: '2026-01-12T09:00:00',
              timezone: 'Europe/Stockholm',
            },
          },
        ],
      },
      alarm: {
        action: 'display',
        trigger: {
          weeks: 0,
          days: 0,
          hours: 0,
          minutes: 15,
          seconds: 0,
        },
      },
    };
    const repository = new InMemoryCalendarRepository({
      calendars,
      events: [{ ...recurring, id: 'alarm-occurrence' }],
    });
    const write: CalendarEventPatch = {
      recurrence: {
        occurrence: {
          action: 'set-timing',
          recurrenceId: {
            type: 'date-time',
            value: {
              local: '2026-01-12T09:00:00',
              timezone: 'Europe/Stockholm',
            },
          },
          timing: {
            type: 'end',
            start: {
              type: 'date-time',
              value: {
                local: '2026-01-12T11:00:00',
                timezone: 'Europe/Stockholm',
              },
            },
            end: {
              type: 'date-time',
              value: {
                local: '2026-01-12T12:00:00',
                timezone: 'Europe/Stockholm',
              },
            },
          },
          viewerTimezone: 'Europe/Stockholm',
        },
      },
    };

    await expect(
      repository.updateEvent('team', 'alarm-occurrence', write),
    ).rejects.toMatchObject({ code: 'unsupported-patch' });
  });

  it('adds duration-form PERIOD recurrence dates idempotently and defensively', async () => {
    const event: CalendarEvent = {
      ...events[2],
      id: 'period-duration-add',
      recurrence: { rrule: 'FREQ=WEEKLY' },
    };
    const repository = new InMemoryCalendarRepository({
      calendars,
      events: [event],
    });
    const value = {
      type: 'period' as const,
      timing: {
        type: 'duration' as const,
        start: {
          type: 'date-time' as const,
          value: {
            local: '2026-10-29T09:30:00',
            timezone: 'Europe/Stockholm',
          },
        },
        duration: {
          weeks: 0,
          days: 1,
          hours: 2,
          minutes: 0,
          seconds: 0,
          isNegative: false,
        },
      },
    };
    const patch: CalendarEventPatch = {
      recurrence: { rdate: { action: 'add-period', value } },
    };

    const updated = await repository.updateEvent(
      'team',
      'period-duration-add',
      patch,
    );
    const replayed = await repository.updateEvent(
      'team',
      'period-duration-add',
      patch,
    );
    expect(updated.recurrence?.rdates).toEqual([value]);
    expect(replayed.recurrence?.rdates).toEqual([value]);

    const returned = updated.recurrence?.rdates?.[0];
    if (
      !returned ||
      returned.type !== 'period' ||
      returned.timing.type !== 'duration' ||
      returned.timing.start.type !== 'date-time'
    ) {
      throw new Error('Expected cloned duration-form PERIOD RDATE');
    }
    returned.timing.start.value.local = '2099-01-01T00:00:00';
    returned.timing.duration.days = 99;

    const fetched = await repository.getEvent('team', 'period-duration-add');
    expect(fetched.recurrence?.rdates).toEqual([value]);
  });

  it('atomically replaces one exact PERIOD while preserving ordered siblings', async () => {
    const point: CalendarEventRecurrenceDate = {
      type: 'date-time',
      value: {
        local: '2026-10-14T11:00:00',
        timezone: 'Europe/Stockholm',
      },
    };
    const source: Extract<CalendarEventRecurrenceDate, { type: 'period' }> = {
      type: 'period',
      timing: {
        type: 'end',
        start: {
          type: 'floating-date-time',
          value: '2026-10-12T09:00:00',
        },
        end: {
          type: 'floating-date-time',
          value: '2026-10-12T10:00:00',
        },
      },
    };
    const sibling = recurrencePeriod();
    const replacement: Extract<
      CalendarEventRecurrenceDate,
      { type: 'period' }
    > = {
      type: 'period',
      timing: {
        type: 'end',
        start: {
          type: 'floating-date-time',
          value: '2026-10-12T09:30:00',
        },
        end: {
          type: 'floating-date-time',
          value: '2026-10-12T10:30:00',
        },
      },
    };
    const event: CalendarEvent = {
      ...events[2],
      id: 'period-replace',
      recurrence: {
        rrule: 'FREQ=WEEKLY',
        rdates: [point, source, sibling],
      },
    };
    const repository = new InMemoryCalendarRepository({
      calendars,
      events: [event],
    });

    const updated = await repository.updateEvent('team', event.id, {
      recurrence: {
        rdate: { action: 'replace-period', value: source, replacement },
      },
    });
    expect(updated.recurrence?.rdates).toEqual([point, replacement, sibling]);
    const returned = updated.recurrence?.rdates?.[1];
    if (
      returned?.type !== 'period' ||
      returned.timing.type !== 'end' ||
      returned.timing.start.type !== 'floating-date-time'
    ) {
      throw new Error('Expected cloned replacement PERIOD');
    }
    returned.timing.start.value = '2099-01-01T00:00:00';
    const fetched = await repository.getEvent('team', event.id);
    expect(fetched.recurrence?.rdates).toEqual([point, replacement, sibling]);
  });

  it.each(['missing', 'duplicate'] as const)(
    'fails closed when PERIOD replacement source is %s',
    async (sourceState) => {
      const source = recurrencePeriod();
      const replacement: Extract<
        CalendarEventRecurrenceDate,
        { type: 'period' }
      > = {
        type: 'period',
        timing: {
          type: 'duration',
          start: {
            type: 'date-time',
            value: {
              local: '2026-10-13T11:00:00',
              timezone: 'Europe/Stockholm',
            },
          },
          duration: {
            weeks: 0,
            days: 2,
            hours: 0,
            minutes: 0,
            seconds: 0,
            isNegative: false,
          },
        },
      };
      const absentSource = recurrencePeriod();
      if (
        absentSource.timing.type === 'duration' &&
        absentSource.timing.start.type === 'date-time'
      ) {
        absentSource.timing.start.value.local = '2026-10-13T11:00:00';
      }
      const event: CalendarEvent = {
        ...events[2],
        id: `period-replace-${sourceState}`,
        recurrence: {
          rrule: 'FREQ=WEEKLY',
          rdates: sourceState === 'missing' ? [absentSource] : [source, source],
        },
      };
      const repository = new InMemoryCalendarRepository({
        calendars,
        events: [event],
      });
      const before = await repository.getEvent('team', event.id);

      await expect(
        repository.updateEvent('team', event.id, {
          recurrence: {
            rdate: { action: 'replace-period', value: source, replacement },
          },
        }),
      ).rejects.toMatchObject({ code: 'unsupported-patch' });
      await expect(repository.getEvent('team', event.id)).resolves.toEqual(
        before,
      );
    },
  );

  it('rejects PERIOD replacements that change representation or typed endpoint identity', async () => {
    const durationSource = recurrencePeriod();
    const duration = durationSource.timing;
    if (duration.type !== 'duration' || duration.start.type !== 'date-time') {
      throw new Error('Expected a named-TZID duration PERIOD');
    }
    const durationUnits = duration.duration;
    const mismatches: Array<{
      id: string;
      source: Extract<CalendarEventRecurrenceDate, { type: 'period' }>;
      replacement: Extract<CalendarEventRecurrenceDate, { type: 'period' }>;
    }> = [
      {
        id: 'duration-to-explicit-end',
        source: durationSource,
        replacement: explicitZonedPeriod(
          '2026-10-13T11:00:00',
          '2026-10-13T12:00:00',
          'Europe/Stockholm',
        ),
      },
      {
        id: 'named-to-floating',
        source: durationSource,
        replacement: {
          type: 'period',
          timing: {
            type: 'duration',
            start: {
              type: 'floating-date-time',
              value: duration.start.value.local,
            },
            duration: durationUnits,
          },
        },
      },
      {
        id: 'named-to-utc',
        source: durationSource,
        replacement: {
          type: 'period',
          timing: {
            type: 'duration',
            start: {
              type: 'date-time',
              value: {
                local: duration.start.value.local,
                timezone: 'UTC',
              },
            },
            duration: durationUnits,
          },
        },
      },
      {
        id: 'explicit-end-timezone-change',
        source: explicitZonedPeriod(
          '2026-10-12T09:00:00',
          '2026-10-12T10:00:00',
          'Europe/Stockholm',
        ),
        replacement: explicitZonedPeriod(
          '2026-10-12T09:30:00',
          '2026-10-12T10:30:00',
          'UTC',
        ),
      },
    ];

    for (const { id, source, replacement } of mismatches) {
      const event: CalendarEvent = {
        ...events[2],
        id: `period-replace-${id}`,
        recurrence: { rrule: 'FREQ=WEEKLY', rdates: [source] },
      };
      const repository = new InMemoryCalendarRepository({
        calendars,
        events: [event],
      });
      const before = await repository.getEvent('team', event.id);

      await expect(
        repository.updateEvent('team', event.id, {
          recurrence: {
            rdate: { action: 'replace-period', value: source, replacement },
          },
        }),
      ).rejects.toMatchObject({ code: 'unsupported-patch' });
      await expect(repository.getEvent('team', event.id)).resolves.toEqual(
        before,
      );
    }
  });

  it('keeps an exact supported PERIOD replacement as a no-op', async () => {
    const source = recurrencePeriod();
    const event: CalendarEvent = {
      ...events[2],
      id: 'period-replace-no-op',
      recurrence: { rrule: 'FREQ=WEEKLY', rdates: [source] },
    };
    const repository = new InMemoryCalendarRepository({
      calendars,
      events: [event],
    });
    const before = await repository.getEvent('team', event.id);

    const updated = await repository.updateEvent('team', event.id, {
      recurrence: {
        rdate: { action: 'replace-period', value: source, replacement: source },
      },
    });

    expect(updated).toEqual(before);
    await expect(repository.getEvent('team', event.id)).resolves.toEqual(
      before,
    );
  });

  it('rejects a PERIOD no-op when a sibling has malformed duration data', async () => {
    const source = recurrencePeriod();
    const malformed: CalendarEventRecurrenceDate = {
      type: 'period',
      timing: {
        type: 'duration',
        start: {
          type: 'floating-date-time',
          value: '2026-10-19T09:00:00',
        },
        duration: {
          weeks: 1,
          days: 1,
          hours: 0,
          minutes: 0,
          seconds: 0,
          isNegative: false,
        },
      },
    };
    const event: CalendarEvent = {
      ...events[2],
      id: 'period-replace-no-op-malformed-sibling',
      recurrence: { rrule: 'FREQ=WEEKLY', rdates: [source, malformed] },
    };
    const repository = new InMemoryCalendarRepository({
      calendars,
      events: [event],
    });
    const before = await repository.getEvent('team', event.id);

    await expect(
      repository.updateEvent('team', event.id, {
        recurrence: {
          rdate: {
            action: 'replace-period',
            value: source,
            replacement: source,
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'unsupported-patch' });
    await expect(repository.getEvent('team', event.id)).resolves.toEqual(
      before,
    );
  });

  it.each([
    {
      label: 'an unsupported recurrence',
      marker: { unsupportedRecurrence: 'range-this-and-future' as const },
    },
    {
      label: 'an unsupported timezone',
      marker: { unsupportedTimezone: true as const },
    },
  ])('rejects a PERIOD no-op with $label', async ({ marker }) => {
    const source = recurrencePeriod();
    const event: CalendarEvent = {
      ...events[2],
      ...marker,
      id: `period-replace-no-op-${Object.keys(marker)[0]}`,
      recurrence: { rrule: 'FREQ=WEEKLY', rdates: [source] },
    };
    const repository = new InMemoryCalendarRepository({
      calendars,
      events: [event],
    });
    const before = await repository.getEvent('team', event.id);

    await expect(
      repository.updateEvent('team', event.id, {
        recurrence: {
          rdate: {
            action: 'replace-period',
            value: source,
            replacement: source,
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'unsupported-patch' });
    await expect(repository.getEvent('team', event.id)).resolves.toEqual(
      before,
    );
  });

  it('rejects a PERIOD replacement that collides with a sibling typed RDATE', async () => {
    const source: Extract<CalendarEventRecurrenceDate, { type: 'period' }> = {
      type: 'period',
      timing: {
        type: 'duration',
        start: {
          type: 'floating-date-time',
          value: '2026-10-12T11:00:00',
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
    };
    const collision: CalendarEventRecurrenceDate = {
      type: 'floating-date-time',
      value: '2026-10-13T11:00:00',
    };
    const replacement: Extract<
      CalendarEventRecurrenceDate,
      { type: 'period' }
    > = {
      type: 'period',
      timing: {
        type: 'duration',
        start: {
          type: 'floating-date-time',
          value: '2026-10-13T11:00:00',
        },
        duration: {
          weeks: 0,
          days: 2,
          hours: 0,
          minutes: 0,
          seconds: 0,
          isNegative: false,
        },
      },
    };
    const event: CalendarEvent = {
      ...events[2],
      id: 'period-replace-collision',
      recurrence: { rrule: 'FREQ=WEEKLY', rdates: [source, collision] },
    };
    const repository = new InMemoryCalendarRepository({
      calendars,
      events: [event],
    });
    const before = await repository.getEvent('team', event.id);

    await expect(
      repository.updateEvent('team', event.id, {
        recurrence: {
          rdate: { action: 'replace-period', value: source, replacement },
        },
      }),
    ).rejects.toMatchObject({ code: 'unsupported-patch' });
    await expect(repository.getEvent('team', event.id)).resolves.toEqual(
      before,
    );
  });

  it('fails closed when a sibling PERIOD has malformed duration data', async () => {
    const source = recurrencePeriod();
    const malformed: CalendarEventRecurrenceDate = {
      type: 'period',
      timing: {
        type: 'duration',
        start: {
          type: 'floating-date-time',
          value: '2026-10-19T09:00:00',
        },
        duration: {
          weeks: 1,
          days: 1,
          hours: 0,
          minutes: 0,
          seconds: 0,
          isNegative: false,
        },
      },
    };
    const replacement: Extract<
      CalendarEventRecurrenceDate,
      { type: 'period' }
    > = {
      type: 'period',
      timing: {
        type: 'duration',
        start: {
          type: 'date-time',
          value: {
            local: '2026-10-13T11:00:00',
            timezone: 'Europe/Stockholm',
          },
        },
        duration: {
          weeks: 0,
          days: 2,
          hours: 0,
          minutes: 0,
          seconds: 0,
          isNegative: false,
        },
      },
    };
    const event: CalendarEvent = {
      ...events[2],
      id: 'period-replace-malformed-sibling',
      recurrence: {
        rrule: 'FREQ=WEEKLY',
        rdates: [source, malformed],
      },
    };
    const repository = new InMemoryCalendarRepository({
      calendars,
      events: [event],
    });
    const before = await repository.getEvent('team', event.id);

    await expect(
      repository.updateEvent('team', event.id, {
        recurrence: {
          rdate: { action: 'replace-period', value: source, replacement },
        },
      }),
    ).rejects.toMatchObject({ code: 'unsupported-patch' });
    await expect(repository.getEvent('team', event.id)).resolves.toEqual(
      before,
    );
  });

  it('creates a named calendar with deterministic identity', async () => {
    const repository = createRepository();

    await expect(
      repository.createCalendar('  Project Alpha  '),
    ).resolves.toEqual({
      id: 'calendar-1',
      name: 'Project Alpha',
    });
    await expect(repository.listCalendars()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'calendar-1', name: 'Project Alpha' }),
      ]),
    );
  });

  it('rejects an empty calendar name', async () => {
    const repository = createRepository();

    await expect(repository.createCalendar('   ')).rejects.toMatchObject({
      code: 'invalid-calendar-name',
    });
  });

  it('renames a writable calendar while preserving other fields', async () => {
    const repository = createRepository();

    await repository.renameCalendar('team', ' Product calendar ');

    await expect(repository.listCalendars()).resolves.toEqual(
      expect.arrayContaining([
        {
          id: 'team',
          name: 'Product calendar',
          timezone: 'Europe/Stockholm',
        },
      ]),
    );
  });

  it('rejects an empty calendar rename', async () => {
    const repository = createRepository();

    await expect(
      repository.renameCalendar('team', '   '),
    ).rejects.toMatchObject({
      code: 'invalid-calendar-name',
    });
  });

  it('rejects renaming a read-only calendar', async () => {
    const repository = createRepository();

    await expect(
      repository.renameCalendar('readonly', 'Nope'),
    ).rejects.toMatchObject({
      code: 'calendar-read-only',
    });
  });

  it('updates a writable calendar description while preserving other properties', async () => {
    const repository = new InMemoryCalendarRepository({
      calendars: [{ ...calendars[0], description: 'Old description' }],
    });

    await repository.updateCalendarDescription('team', 'New description');

    await expect(repository.listCalendars()).resolves.toEqual([
      { ...calendars[0], description: 'New description' },
    ]);
  });

  it('clears a writable calendar description when the input is empty', async () => {
    const repository = new InMemoryCalendarRepository({
      calendars: [{ ...calendars[0], description: 'Old description' }],
    });

    await repository.updateCalendarDescription('team', '');

    await expect(repository.listCalendars()).resolves.toEqual([calendars[0]]);
  });

  it('rejects updating a read-only calendar description', async () => {
    const repository = createRepository();

    await expect(
      repository.updateCalendarDescription('readonly', 'Nope'),
    ).rejects.toMatchObject({ code: 'calendar-read-only' });
  });

  it('updates and clears color only for explicitly writable calendars', async () => {
    const writable: Calendar = {
      ...calendars[0],
      color: '#123456',
      readOnly: false,
    };
    const unknownPermission: Calendar = {
      id: 'unknown',
      name: 'Unknown permission',
    };
    const repository = new InMemoryCalendarRepository({
      calendars: [writable, unknownPermission, calendars[1]],
    });

    await repository.updateCalendarColor('team', '#ABCDEF');
    await expect(repository.listCalendars()).resolves.toEqual([
      { ...writable, color: '#ABCDEF' },
      unknownPermission,
      calendars[1],
    ]);

    await repository.updateCalendarColor('team', '');
    await expect(repository.listCalendars()).resolves.toEqual([
      { ...calendars[0], readOnly: false },
      unknownPermission,
      calendars[1],
    ]);
  });

  it('rejects invalid color values and unknown or read-only permissions', async () => {
    const repository = new InMemoryCalendarRepository({
      calendars: [{ ...calendars[0], readOnly: false }, ...calendars.slice(1)],
    });

    await expect(
      repository.updateCalendarColor('team', 'red'),
    ).rejects.toMatchObject({ code: 'invalid-calendar-color' });
    await expect(
      repository.updateCalendarColor('team', '#12345678'),
    ).rejects.toMatchObject({ code: 'invalid-calendar-color' });
    await expect(
      repository.updateCalendarColor('team', '#12345G'),
    ).rejects.toMatchObject({ code: 'invalid-calendar-color' });
    await expect(
      repository.updateCalendarColor('readonly', '#123456'),
    ).rejects.toMatchObject({ code: 'calendar-read-only' });
    const unknownPermissionRepository = createRepository();
    await expect(
      unknownPermissionRepository.updateCalendarColor('team', '#123456'),
    ).rejects.toMatchObject({ code: 'calendar-read-only' });
  });

  it('deletes a writable calendar and its events', async () => {
    const repository = createRepository();

    await repository.deleteCalendar('team');

    await expect(repository.listCalendars()).resolves.not.toContainEqual(
      expect.objectContaining({ id: 'team' }),
    );
    await expect(repository.getEvent('team', 'planning')).rejects.toMatchObject(
      { code: 'calendar-not-found' },
    );
  });

  it('rejects deleting a read-only calendar', async () => {
    const repository = createRepository();

    await expect(repository.deleteCalendar('readonly')).rejects.toMatchObject({
      code: 'calendar-read-only',
    });
  });

  it('lists overlapping events for selected calendars', async () => {
    const repository = createRepository();

    await expect(
      repository.listEvents(['team'], {
        start: '2026-09-23T06:00:00Z',
        end: '2026-09-23T12:00:00Z',
      }),
    ).resolves.toEqual([
      expect.objectContaining({ id: 'planning' }),
      expect.objectContaining({ id: 'old-recurring' }),
    ]);
  });

  it('uses the calendar timezone when filtering all-day events', async () => {
    const repository = createRepository();

    await expect(
      repository.listEvents(['team'], {
        start: '2026-10-04T22:00:00Z',
        end: '2026-10-05T22:00:00Z',
      }),
    ).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'holiday' })]),
    );
  });

  it('filters floating timed events using the viewer local timezone', async () => {
    const originalZone = Settings.defaultZone;
    Settings.defaultZone = 'Europe/Stockholm';
    const repository = new InMemoryCalendarRepository({
      calendars,
      events: [
        {
          id: 'floating-planning',
          calendarId: 'team',
          uid: 'floating-planning@example.test',
          title: 'Floating planning',
          timing: {
            type: 'timed',
            start: { type: 'floating', local: '2026-09-23T09:00:00' },
            end: { type: 'floating', local: '2026-09-23T10:00:00' },
          },
        },
      ],
    });

    try {
      await expect(
        repository.listEvents(['team'], {
          start: '2026-09-23T07:30:00Z',
          end: '2026-09-23T08:30:00Z',
        }),
      ).resolves.toEqual([
        expect.objectContaining({ id: 'floating-planning' }),
      ]);
    } finally {
      Settings.defaultZone = originalZone;
    }
  });

  it('rejects invalid time ranges', async () => {
    const repository = createRepository();

    await expect(
      repository.listEvents(['team'], {
        start: '2026-09-24T00:00:00Z',
        end: '2026-09-23T00:00:00Z',
      }),
    ).rejects.toMatchObject({ code: 'invalid-range' });
  });

  it('creates an event with deterministic resource identity', async () => {
    const repository = createRepository();
    const input: CalendarEventInput = {
      uid: 'new@example.test',
      title: 'New event',
      timing: {
        type: 'timed',
        start: {
          type: 'zoned',
          local: '2026-09-25T09:00:00',
          timezone: 'Europe/Stockholm',
        },
        end: {
          type: 'zoned',
          local: '2026-09-25T10:00:00',
          timezone: 'Europe/Stockholm',
        },
      },
    };

    await expect(repository.createEvent('team', input)).resolves.toEqual({
      ...input,
      id: 'generated-1',
      calendarId: 'team',
    });
  });

  it('updates mutable fields without changing id, calendar or UID', async () => {
    const repository = createRepository();

    const updated = await repository.updateEvent('team', 'planning', {
      title: 'Updated planning',
      categories: ['TEAM'],
    });

    expect(updated).toEqual(
      expect.objectContaining({
        id: 'planning',
        calendarId: 'team',
        uid: 'planning@example.test',
        title: 'Updated planning',
        categories: ['TEAM'],
      }),
    );
  });

  it('applies the serializable alarm removal operation to supported events', async () => {
    const eventWithAlarm: CalendarEvent = {
      ...events[0],
      alarm: {
        action: 'display',
        trigger: { weeks: 0, days: 0, hours: 0, minutes: 15, seconds: 0 },
      },
    };
    const repository = new InMemoryCalendarRepository({
      calendars: [calendars[0]],
      events: [eventWithAlarm],
    });
    const removal = JSON.parse(
      JSON.stringify({ alarm: { operation: 'remove' } }),
    ) as CalendarEventPatch;

    await expect(
      repository.updateEvent('team', eventWithAlarm.id, removal),
    ).resolves.toMatchObject({ title: eventWithAlarm.title });
    const updated = await repository.getEvent('team', eventWithAlarm.id);
    expect(updated.alarm).toBeUndefined();
  });

  it('rejects alarm writes for opaque alarms', async () => {
    const repository = new InMemoryCalendarRepository({
      calendars: [calendars[0]],
      events: [{ ...events[0], unsupportedAlarm: true }],
    });

    await expect(
      repository.updateEvent('team', events[0].id, {
        alarm: { operation: 'remove' },
      }),
    ).rejects.toMatchObject({ code: 'unsupported-patch' });
  });

  it('deletes an event', async () => {
    const repository = createRepository();

    await repository.deleteEvent('team', 'planning');

    await expect(repository.getEvent('team', 'planning')).rejects.toMatchObject(
      {
        code: 'event-not-found',
      },
    );
  });

  it.each(['create', 'update', 'delete'] as const)(
    'rejects %s mutations on read-only calendars',
    async (operation) => {
      const repository = new InMemoryCalendarRepository({
        calendars,
        events: [
          {
            ...events[0],
            id: 'readonly-event',
            calendarId: 'readonly',
          },
        ],
      });

      let promise: Promise<unknown>;

      if (operation === 'create') {
        const { id: _id, calendarId: _calendarId, ...input } = events[0];
        promise = repository.createEvent('readonly', input);
      } else if (operation === 'update') {
        promise = repository.updateEvent('readonly', 'readonly-event', {
          title: 'Nope',
        });
      } else {
        promise = repository.deleteEvent('readonly', 'readonly-event');
      }

      await expect(promise).rejects.toBeInstanceOf(CalendarRepositoryError);
      await expect(promise).rejects.toMatchObject({
        code: 'calendar-read-only',
      });
    },
  );

  it('throws when a calendar does not exist', async () => {
    const repository = createRepository();

    await expect(
      repository.listEvents(['missing'], {
        start: '2026-09-23T00:00:00Z',
        end: '2026-09-24T00:00:00Z',
      }),
    ).rejects.toMatchObject({ code: 'calendar-not-found' });
  });
});

function recurrenceOverride(): CalendarEventRecurrenceOverride {
  return {
    recurrenceId: {
      type: 'floating-date-time',
      value: '2026-10-12T09:00:00',
    },
    timing: {
      type: 'end',
      start: {
        type: 'date-time',
        value: {
          local: '2026-10-12T11:00:00',
          timezone: 'Europe/Stockholm',
        },
      },
      end: {
        type: 'date-time',
        value: {
          local: '2026-10-12T11:30:00',
          timezone: 'Europe/Stockholm',
        },
      },
    },
    status: 'cancelled',
  };
}

function recurrencePeriod(): Extract<
  CalendarEventRecurrenceDate,
  { type: 'period' }
> {
  return {
    type: 'period',
    timing: {
      type: 'duration',
      start: {
        type: 'date-time',
        value: {
          local: '2026-10-12T11:00:00',
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
  };
}

function explicitZonedPeriod(
  startLocal: string,
  endLocal: string,
  timezone: string,
): Extract<CalendarEventRecurrenceDate, { type: 'period' }> {
  return {
    type: 'period',
    timing: {
      type: 'end',
      start: { type: 'date-time', value: { local: startLocal, timezone } },
      end: { type: 'date-time', value: { local: endLocal, timezone } },
    },
  };
}

function mutateRecurrencePeriod(value: CalendarEventRecurrenceDate): void {
  if (value.type === 'period') {
    if (value.timing.start.type === 'date-time') {
      value.timing.start.value.local = '2099-01-01T00:00:00';
    }
    if (value.timing.type === 'duration') {
      value.timing.duration.days = 99;
    }
  }
}

function expectedRecurrencePeriod() {
  return {
    type: 'period',
    timing: {
      type: 'duration',
      start: {
        type: 'date-time',
        value: {
          local: '2026-10-12T11:00:00',
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
  };
}

function mutateRecurrenceOverride(
  override: CalendarEventRecurrenceOverride,
): void {
  if (override.recurrenceId.type === 'floating-date-time') {
    override.recurrenceId.value = '2099-01-01T00:00:00';
  } else if (override.recurrenceId.type === 'date-time') {
    override.recurrenceId.value.local = '2099-01-01T00:00:00';
  }
  if (override.timing?.type === 'end') {
    const start = override.timing.start;
    if (start.type === 'date-time') {
      start.value.local = '2099-01-01T01:00:00';
    }
  }
}

function expectedRecurrenceOverride() {
  return {
    recurrenceId: {
      type: 'floating-date-time',
      value: '2026-10-12T09:00:00',
    },
    timing: {
      type: 'end',
      start: {
        type: 'date-time',
        value: {
          local: '2026-10-12T11:00:00',
          timezone: 'Europe/Stockholm',
        },
      },
      end: {
        type: 'date-time',
        value: {
          local: '2026-10-12T11:30:00',
          timezone: 'Europe/Stockholm',
        },
      },
    },
    status: 'cancelled',
  };
}
