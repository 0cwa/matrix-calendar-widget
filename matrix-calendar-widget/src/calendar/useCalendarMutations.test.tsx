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
  useCreateCalendar,
  useCreateCalendarEvent,
  useDeleteCalendarEvent,
  useUpdateCalendarEvent,
} from './useCalendarMutations';
import { useCalendarEvents } from './useCalendarQueries';

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

const event: CalendarEvent = {
  ...input,
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
      createCalendar: vi.fn().mockRejectedValue(new Error('write failed')),
      listEvents,
      getEvent: vi.fn().mockResolvedValue(event),
      createEvent: vi.fn().mockRejectedValue(new Error('write failed')),
      updateEvent: vi.fn().mockResolvedValue(event),
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
