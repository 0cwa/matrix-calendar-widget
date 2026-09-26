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

import {
  Calendar,
  CalendarEvent,
  CalendarEventInput,
  CalendarRepository,
  CalendarTimeRange,
  InMemoryCalendarRepository,
} from '@matrix-calendar-widget/calendar';
import { waitFor } from '@testing-library/react';
import { renderHook } from '@testing-library/react-hooks';
import { PropsWithChildren } from 'react';
import { vi } from 'vitest';
import { CalendarRepositoryProvider } from './CalendarRepositoryProvider';
import {
  useCancelCalendarOccurrence,
  useCreateCalendar,
  useCreateCalendarEvent,
  useDeleteCalendar,
  useDeleteCalendarEvent,
  useRenameCalendar,
  useUpdateCalendarEvent,
  useUpdateCalendarFollowingOccurrence,
  useUpdateCalendarMetadata,
  useUpdateCalendarOccurrence,
} from './useCalendarMutations';
import { useCalendarEvents, useCalendars } from './useCalendarQueries';

const calendar: Calendar = {
  id: 'team',
  name: 'Team calendar',
  timezone: 'Europe/Stockholm',
};

const range: CalendarTimeRange = {
  start: '2026-09-23T00:00:00Z',
  end: '2026-09-24T00:00:00Z',
};

const input: CalendarEventInput = {
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
};

const { displayAlarms: _displayAlarms, ...eventInput } = input;
const event: CalendarEvent = {
  ...eventInput,
  id: 'planning',
  calendarId: 'team',
};

function createWrapper(repository: CalendarRepository) {
  return function Wrapper({ children }: PropsWithChildren<{}>) {
    return (
      <CalendarRepositoryProvider repository={repository}>
        {children}
      </CalendarRepositoryProvider>
    );
  };
}

describe('calendar repository mutation hooks', () => {
  it('refreshes active calendar queries after create', async () => {
    const repository = new InMemoryCalendarRepository({
      calendars: [calendar],
      calendarIdFactory: () => 'project-alpha',
    });
    const { result, waitForValueToChange } = renderHook(
      () => ({
        calendars: useCalendars(),
        createCalendar: useCreateCalendar(),
      }),
      { wrapper: createWrapper(repository) },
    );

    await waitForValueToChange(() => result.current.calendars.loading);
    expect(result.current.calendars.data).toEqual([calendar]);

    await result.current.createCalendar('Project Alpha');

    await waitFor(() => {
      expect(result.current.calendars.data).toEqual([
        calendar,
        { id: 'project-alpha', name: 'Project Alpha' },
      ]);
    });
  });

  it('refreshes active calendar queries after rename', async () => {
    const repository = new InMemoryCalendarRepository({
      calendars: [calendar],
    });
    const { result, waitForValueToChange } = renderHook(
      () => ({
        calendars: useCalendars(),
        renameCalendar: useRenameCalendar(),
      }),
      { wrapper: createWrapper(repository) },
    );

    await waitForValueToChange(() => result.current.calendars.loading);

    await result.current.renameCalendar('team', 'Product calendar');

    await waitFor(() => {
      expect(result.current.calendars.data).toEqual([
        { ...calendar, name: 'Product calendar' },
      ]);
    });
  });

  it('refreshes active calendar queries after metadata update', async () => {
    const repository = new InMemoryCalendarRepository({
      calendars: [calendar],
    });
    const { result, waitForValueToChange } = renderHook(
      () => ({
        calendars: useCalendars(),
        updateMetadata: useUpdateCalendarMetadata(),
      }),
      { wrapper: createWrapper(repository) },
    );

    await waitForValueToChange(() => result.current.calendars.loading);
    await result.current.updateMetadata('team', {
      description: 'Planning',
      color: '#336699',
    });

    await waitFor(() => {
      expect(result.current.calendars.data).toEqual([
        { ...calendar, description: 'Planning', color: '#336699' },
      ]);
    });
  });

  it('refreshes active calendar queries after delete', async () => {
    const repository = new InMemoryCalendarRepository({
      calendars: [calendar],
      events: [event],
    });
    const { result, waitForValueToChange } = renderHook(
      () => ({
        calendars: useCalendars(),
        deleteCalendar: useDeleteCalendar(),
      }),
      { wrapper: createWrapper(repository) },
    );

    await waitForValueToChange(() => result.current.calendars.loading);
    expect(result.current.calendars.data).toEqual([calendar]);

    await result.current.deleteCalendar('team');

    await waitFor(() => {
      expect(result.current.calendars.data).toEqual([]);
    });
  });

  it('refreshes active event queries after create', async () => {
    const repository = new InMemoryCalendarRepository({
      calendars: [calendar],
      idFactory: () => 'planning',
    });
    const { result, waitForValueToChange } = renderHook(
      () => ({
        createEvent: useCreateCalendarEvent(),
        events: useCalendarEvents(['team'], range),
      }),
      { wrapper: createWrapper(repository) },
    );

    await waitForValueToChange(() => result.current.events.loading);
    expect(result.current.events.data).toEqual([]);

    await result.current.createEvent('team', input);

    await waitFor(() => {
      expect(result.current.events.data).toEqual([event]);
    });
  });

  it('refreshes active event queries after update', async () => {
    const repository = new InMemoryCalendarRepository({
      calendars: [calendar],
      events: [event],
    });
    const { result, waitForValueToChange } = renderHook(
      () => ({
        events: useCalendarEvents(['team'], range),
        updateEvent: useUpdateCalendarEvent(),
      }),
      { wrapper: createWrapper(repository) },
    );

    await waitForValueToChange(() => result.current.events.loading);

    await result.current.updateEvent('team', 'planning', {
      title: 'Updated planning',
    });

    await waitFor(() => {
      expect(result.current.events.data[0].title).toBe('Updated planning');
    });
  });

  it('refreshes active event queries after an occurrence update', async () => {
    const recurringEvent: CalendarEvent = {
      ...event,
      recurrence: { rrule: 'FREQ=DAILY;COUNT=3' },
    };
    const repository = new InMemoryCalendarRepository({
      calendars: [calendar],
      events: [recurringEvent],
    });
    const recurrenceId = {
      type: 'date-time' as const,
      value: {
        local: '2026-09-24T09:00:00',
        timezone: 'Europe/Stockholm',
        mode: 'tzid' as const,
      },
    };
    const { result, waitForValueToChange } = renderHook(
      () => ({
        events: useCalendarEvents(['team'], range),
        updateOccurrence: useUpdateCalendarOccurrence(),
      }),
      { wrapper: createWrapper(repository) },
    );

    await waitForValueToChange(() => result.current.events.loading);
    await result.current.updateOccurrence('team', 'planning', recurrenceId, {
      title: 'Updated instance',
    });

    await waitFor(() => {
      expect(
        result.current.events.data[0].recurrence?.overrides?.[0],
      ).toMatchObject({ recurrenceId, title: 'Updated instance' });
    });
  });

  it('refreshes active event queries after a following-scope update', async () => {
    const recurringEvent: CalendarEvent = {
      ...event,
      recurrence: { rrule: 'FREQ=DAILY;COUNT=3' },
    };
    const repository = new InMemoryCalendarRepository({
      calendars: [calendar],
      events: [recurringEvent],
    });
    const recurrenceId = {
      type: 'date-time' as const,
      value: {
        local: '2026-09-24T09:00:00',
        timezone: 'Europe/Stockholm',
        mode: 'tzid' as const,
      },
    };
    const timing = {
      type: 'timed' as const,
      start: {
        local: '2026-09-24T10:00:00',
        timezone: 'Europe/Stockholm',
        mode: 'tzid' as const,
      },
      end: {
        local: '2026-09-24T11:00:00',
        timezone: 'Europe/Stockholm',
        mode: 'tzid' as const,
      },
    };
    const { result, waitForValueToChange } = renderHook(
      () => ({
        events: useCalendarEvents(['team'], range),
        updateFollowingOccurrence: useUpdateCalendarFollowingOccurrence(),
      }),
      { wrapper: createWrapper(repository) },
    );

    await waitForValueToChange(() => result.current.events.loading);
    await result.current.updateFollowingOccurrence(
      'team',
      'planning',
      recurrenceId,
      timing,
    );

    await waitFor(() => {
      expect(
        result.current.events.data[0].recurrence?.overrides?.[0],
      ).toMatchObject({ recurrenceId, range: 'this-and-following', timing });
    });
  });

  it('refreshes active event queries after occurrence cancellation', async () => {
    const recurringEvent: CalendarEvent = {
      ...event,
      recurrence: { rrule: 'FREQ=DAILY;COUNT=3' },
    };
    const repository = new InMemoryCalendarRepository({
      calendars: [calendar],
      events: [recurringEvent],
    });
    const recurrenceId = { type: 'date' as const, value: '2026-09-24' };
    const { result, waitForValueToChange } = renderHook(
      () => ({
        events: useCalendarEvents(['team'], range),
        cancelOccurrence: useCancelCalendarOccurrence(),
      }),
      { wrapper: createWrapper(repository) },
    );

    await waitForValueToChange(() => result.current.events.loading);
    await result.current.cancelOccurrence('team', 'planning', recurrenceId);

    await waitFor(() => {
      expect(
        result.current.events.data[0].recurrence?.overrides?.[0],
      ).toMatchObject({ recurrenceId, status: 'cancelled' });
    });
  });

  it('refreshes active event queries after delete', async () => {
    const repository = new InMemoryCalendarRepository({
      calendars: [calendar],
      events: [event],
    });
    const { result, waitForValueToChange } = renderHook(
      () => ({
        deleteEvent: useDeleteCalendarEvent(),
        events: useCalendarEvents(['team'], range),
      }),
      { wrapper: createWrapper(repository) },
    );

    await waitForValueToChange(() => result.current.events.loading);

    await result.current.deleteEvent('team', 'planning');

    await waitFor(() => {
      expect(result.current.events.data).toEqual([]);
    });
  });

  it('does not invalidate queries when a write fails', async () => {
    const listEvents = vi.fn().mockResolvedValue([]);
    const repository: CalendarRepository = {
      listCalendars: vi.fn().mockResolvedValue([calendar]),
      createCalendar: vi.fn().mockResolvedValue(calendar),
      renameCalendar: vi.fn().mockResolvedValue(undefined),
      updateCalendarMetadata: vi.fn().mockResolvedValue(undefined),
      deleteCalendar: vi.fn().mockResolvedValue(undefined),
      listEvents,
      getEvent: vi.fn().mockResolvedValue(event),
      createEvent: vi.fn().mockRejectedValue(new Error('write failed')),
      updateEvent: vi.fn().mockResolvedValue(event),
      updateOccurrence: vi.fn().mockResolvedValue(event),
      updateFollowingOccurrence: vi.fn().mockResolvedValue(event),
      cancelOccurrence: vi.fn().mockResolvedValue(event),
      deleteEvent: vi.fn().mockResolvedValue(undefined),
    };
    const { result, waitForValueToChange } = renderHook(
      () => ({
        createEvent: useCreateCalendarEvent(),
        events: useCalendarEvents(['team'], range),
      }),
      { wrapper: createWrapper(repository) },
    );

    await waitForValueToChange(() => result.current.events.loading);

    await expect(
      result.current.createEvent('team', input),
    ).rejects.toMatchObject({ message: 'write failed' });

    await Promise.resolve();

    expect(listEvents).toHaveBeenCalledTimes(1);
    expect(result.current.events.data).toEqual([]);
  });
});
