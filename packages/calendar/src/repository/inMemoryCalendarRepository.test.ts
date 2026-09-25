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
