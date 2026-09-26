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

import { Calendar, CalendarEvent, CalendarEventInput } from '../model';
import { CalendarRepositoryError, InMemoryCalendarRepository } from './index';

const calendars: Calendar[] = [
  {
    id: 'team',
    name: 'Team calendar',
    description: 'Shared planning',
    color: '#336699ff',
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
        local: '2026-09-23T09:00:00',
        timezone: 'Europe/Stockholm',
      },
      end: {
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
        local: '2026-01-05T09:00:00',
        timezone: 'Europe/Stockholm',
      },
      end: {
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

  it('returns defensive copies of recurrence override metadata', async () => {
    const repository = createRepository();
    const recurrence = {
      rrule: 'FREQ=WEEKLY',
      overrides: [
        {
          recurrenceId: {
            type: 'date-time' as const,
            value: {
              local: '2026-10-12T09:00:00',
              timezone: 'Europe/Stockholm',
            },
          },
          title: 'Moved sync',
          timing: {
            type: 'timed' as const,
            start: {
              local: '2026-10-12T11:00:00',
              timezone: 'Europe/Stockholm',
            },
            end: {
              local: '2026-10-12T11:30:00',
              timezone: 'Europe/Stockholm',
            },
          },
          categories: ['TEAM'],
        },
      ],
    };

    await repository.updateEvent('team', 'old-recurring', { recurrence });
    const event = await repository.getEvent('team', 'old-recurring');
    event.recurrence!.overrides![0].title = 'Caller mutation';
    const overrideTiming = event.recurrence!.overrides![0].timing;
    if (overrideTiming?.type === 'timed') {
      overrideTiming.start.local = '2026-10-12T12:00:00';
    }
    event.recurrence!.overrides![0].categories!.push('MUTATED');

    await expect(
      repository.getEvent('team', 'old-recurring'),
    ).resolves.toMatchObject({
      recurrence: {
        overrides: [
          {
            title: 'Moved sync',
            recurrenceId: {
              type: 'date-time',
              value: {
                local: '2026-10-12T09:00:00',
                timezone: 'Europe/Stockholm',
              },
            },
            timing: {
              start: {
                local: '2026-10-12T11:00:00',
              },
            },
            categories: ['TEAM'],
          },
        ],
      },
    });
  });

  it('creates and cancels one occurrence without changing the master resource', async () => {
    const repository = createRepository();
    const recurrenceId = {
      type: 'date-time' as const,
      value: {
        local: '2026-01-12T09:00:00',
        timezone: 'Europe/Stockholm',
        mode: 'tzid' as const,
      },
    };

    await repository.updateOccurrence('team', 'old-recurring', recurrenceId, {
      title: 'One moved sync',
      description: 'Remove me',
      timing: {
        type: 'timed',
        start: {
          local: '2026-01-12T11:00:00',
          timezone: 'Europe/Stockholm',
          mode: 'tzid',
        },
        end: {
          local: '2026-01-12T11:30:00',
          timezone: 'Europe/Stockholm',
          mode: 'tzid',
        },
      },
    });
    await repository.updateOccurrence('team', 'old-recurring', recurrenceId, {
      description: null,
    });

    const edited = await repository.getEvent('team', 'old-recurring');
    expect(edited.id).toBe('old-recurring');
    expect(edited.title).toBe('Weekly sync');
    expect(edited.recurrence?.overrides).toEqual([
      expect.objectContaining({
        recurrenceId,
        title: 'One moved sync',
        timing: expect.objectContaining({
          start: expect.objectContaining({ local: '2026-01-12T11:00:00' }),
        }),
      }),
    ]);
    expect(edited.recurrence?.overrides?.[0]).not.toHaveProperty('description');

    await repository.cancelOccurrence('team', 'old-recurring', recurrenceId);
    await expect(
      repository.getEvent('team', 'old-recurring'),
    ).resolves.toMatchObject({
      title: 'Weekly sync',
      recurrence: {
        rrule: 'FREQ=WEEKLY',
        overrides: [
          expect.objectContaining({
            recurrenceId,
            title: 'One moved sync',
            status: 'cancelled',
          }),
        ],
      },
    });
  });

  it('stores a following timing override on the same resource and keeps series data', async () => {
    const repository = createRepository();
    const recurrenceId = {
      type: 'date-time' as const,
      value: {
        local: '2026-01-12T09:00:00',
        timezone: 'Europe/Stockholm',
        mode: 'tzid' as const,
      },
    };

    const result = await repository.updateFollowingOccurrence(
      'team',
      'old-recurring',
      recurrenceId,
      {
        type: 'timed',
        start: {
          local: '2026-01-12T10:00:00',
          timezone: 'Europe/Stockholm',
          mode: 'tzid',
        },
        end: {
          local: '2026-01-12T11:00:00',
          timezone: 'Europe/Stockholm',
          mode: 'tzid',
        },
      },
    );

    expect(result.id).toBe('old-recurring');
    expect(result.recurrence).toMatchObject({
      rrule: 'FREQ=WEEKLY',
      overrides: [
        {
          recurrenceId,
          range: 'this-and-following',
          timing: {
            start: { local: '2026-01-12T10:00:00' },
            end: { local: '2026-01-12T11:00:00' },
          },
        },
      ],
    });
    expect((await repository.getEvent('team', 'old-recurring')).title).toBe(
      'Weekly sync',
    );
  });

  it('keeps DATE and DATE-TIME recurrence identities distinct', async () => {
    const repository = createRepository();
    await repository.updateEvent('team', 'old-recurring', {
      recurrence: {
        rdates: [{ type: 'date', value: '2026-01-19' }],
      },
    });

    await repository.cancelOccurrence('team', 'old-recurring', {
      type: 'date',
      value: '2026-01-19',
    });

    await expect(
      repository.getEvent('team', 'old-recurring'),
    ).resolves.toMatchObject({
      recurrence: {
        overrides: [
          {
            recurrenceId: { type: 'date', value: '2026-01-19' },
            status: 'cancelled',
          },
        ],
      },
    });
  });

  it('clones RDATE PERIOD values and keeps their source resource in range queries', async () => {
    const repository = createRepository();
    await repository.updateEvent('team', 'old-recurring', {
      recurrence: {
        rdatePeriods: [
          {
            start: {
              type: 'date-time',
              value: {
                local: '2026-10-12T09:00:00',
                timezone: 'Europe/Stockholm',
                mode: 'tzid',
              },
            },
            duration: 'P1D',
          },
        ],
      },
    });

    const returned = await repository.getEvent('team', 'old-recurring');
    returned.recurrence!.rdatePeriods![0].start.value.local =
      '2026-10-13T09:00:00';

    await expect(
      repository.listEvents(['team'], {
        start: '2026-10-12T00:00:00Z',
        end: '2026-10-13T00:00:00Z',
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: 'old-recurring',
        recurrence: {
          rdatePeriods: [
            expect.objectContaining({
              start: expect.objectContaining({
                value: expect.objectContaining({
                  local: '2026-10-12T09:00:00',
                }),
              }),
              duration: 'P1D',
            }),
          ],
        },
      }),
    ]);
  });

  it('uses the calendar timezone when filtering floating timed events', async () => {
    const repository = createRepository();
    await repository.updateEvent('team', 'planning', {
      timing: {
        type: 'timed',
        start: {
          local: '2026-09-23T09:00:00',
          timezone: 'floating',
          mode: 'floating',
        },
        end: {
          local: '2026-09-23T10:00:00',
          timezone: 'floating',
          mode: 'floating',
        },
      },
    });

    await expect(
      repository.listEvents(['team'], {
        start: '2026-09-23T06:30:00Z',
        end: '2026-09-23T08:30:00Z',
      }),
    ).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'planning' })]),
    );
  });

  it('keeps a future recurring resource when a moved exception enters the range', async () => {
    const repository = createRepository();
    await repository.updateEvent('team', 'old-recurring', {
      timing: {
        type: 'timed',
        start: {
          local: '2027-01-01T09:00:00',
          timezone: 'UTC',
          mode: 'utc',
        },
        end: {
          local: '2027-01-01T09:30:00',
          timezone: 'UTC',
          mode: 'utc',
        },
      },
      recurrence: {
        rrule: 'FREQ=DAILY;COUNT=2',
        overrides: [
          {
            recurrenceId: {
              type: 'date-time',
              value: {
                local: '2027-01-01T09:00:00',
                timezone: 'UTC',
                mode: 'utc',
              },
            },
            timing: {
              type: 'timed',
              start: {
                local: '2026-09-23T09:00:00',
                timezone: 'Europe/Stockholm',
                mode: 'tzid',
              },
              end: {
                local: '2026-09-23T09:30:00',
                timezone: 'Europe/Stockholm',
                mode: 'tzid',
              },
            },
          },
        ],
      },
    });

    await expect(
      repository.listEvents(['team'], {
        start: '2026-09-23T06:00:00Z',
        end: '2026-09-23T08:00:00Z',
      }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'old-recurring' }),
      ]),
    );
  });

  it('renames a writable calendar while preserving other fields', async () => {
    const repository = createRepository();

    await repository.renameCalendar('team', ' Product calendar ');

    await expect(repository.listCalendars()).resolves.toEqual(
      expect.arrayContaining([
        {
          id: 'team',
          name: 'Product calendar',
          description: 'Shared planning',
          color: '#336699ff',
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

  it('updates and clears only the requested calendar metadata', async () => {
    const repository = createRepository();

    await repository.updateCalendarMetadata('team', {
      description: 'Updated & shared',
      color: null,
    });

    await expect(repository.listCalendars()).resolves.toEqual(
      expect.arrayContaining([
        {
          id: 'team',
          name: 'Team calendar',
          description: 'Updated & shared',
          timezone: 'Europe/Stockholm',
        },
      ]),
    );
  });

  it('rejects metadata updates to a read-only calendar', async () => {
    const repository = createRepository();

    await expect(
      repository.updateCalendarMetadata('readonly', { color: '#123456' }),
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
          local: '2026-09-25T09:00:00',
          timezone: 'Europe/Stockholm',
        },
        end: {
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

  it('applies narrow DISPLAY alarm edits without returning request fields', async () => {
    const alarmEvent: CalendarEvent = {
      ...events[0],
      displayAlarms: [
        {
          index: 0,
          description: 'Reminder',
          triggerMinutes: -15,
          triggerRelatedTo: 'start',
          triggerEditable: true,
        },
      ],
    };
    const repository = new InMemoryCalendarRepository({
      calendars,
      events: [alarmEvent],
    });

    await expect(
      repository.updateEvent('team', 'planning', {
        displayAlarmEdits: [
          { index: 0, triggerMinutes: -30, description: 'Updated reminder' },
        ],
      }),
    ).resolves.toMatchObject({
      displayAlarms: [
        {
          index: 0,
          description: 'Updated reminder',
          triggerMinutes: -30,
          triggerEditable: true,
        },
      ],
    });
    await expect(
      repository.getEvent('team', 'planning'),
    ).resolves.not.toHaveProperty('displayAlarmEdits');
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
        const {
          id: _id,
          calendarId: _calendarId,
          displayAlarms: _displayAlarms,
          ...input
        } = events[0];
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
