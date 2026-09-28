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

    const patchOverride = recurrenceOverride();
    const patchRdate = recurrencePeriod();
    const patch: CalendarEventPatch = {
      recurrence: {
        rdates: [patchRdate],
        overrides: [patchOverride],
      },
    };
    const updated = await repository.updateEvent(
      'team',
      'recurring-with-override',
      patch,
    );
    mutateRecurrenceOverride(patchOverride);
    mutateRecurrencePeriod(patchRdate);
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

function recurrencePeriod(): CalendarEventRecurrenceDate {
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
