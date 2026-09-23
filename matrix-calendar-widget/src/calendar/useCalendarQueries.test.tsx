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
  CalendarRepository,
  CalendarTimeRange,
} from '@matrix-calendar-widget/calendar';
import { renderHook } from '@testing-library/react-hooks';
import { PropsWithChildren } from 'react';
import { vi } from 'vitest';
import {
  CalendarRepositoryProvider,
  useCalendarRepository,
} from './CalendarRepositoryProvider';
import {
  useCalendarEvent,
  useCalendarEvents,
  useCalendars,
} from './useCalendarQueries';

const calendar: Calendar = {
  id: 'team',
  name: 'Team calendar',
  timezone: 'Europe/Stockholm',
};

const event: CalendarEvent = {
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
};

function createRepository(
  overrides: Partial<CalendarRepository> = {},
): CalendarRepository {
  return {
    listCalendars: vi.fn().mockResolvedValue([]),
    listEvents: vi.fn().mockResolvedValue([]),
    getEvent: vi.fn().mockRejectedValue(new Error('not configured')),
    createEvent: vi.fn().mockRejectedValue(new Error('not configured')),
    updateEvent: vi.fn().mockRejectedValue(new Error('not configured')),
    deleteEvent: vi.fn().mockRejectedValue(new Error('not configured')),
    ...overrides,
  };
}

function createWrapper(repository: CalendarRepository) {
  return function Wrapper({ children }: PropsWithChildren<{}>) {
    return (
      <CalendarRepositoryProvider repository={repository}>
        {children}
      </CalendarRepositoryProvider>
    );
  };
}

describe('calendar repository hooks', () => {
  it('throws a clear error when the provider is missing', () => {
    expect(() => renderHook(() => useCalendarRepository())).toThrow(
      'useCalendarRepository must be used inside CalendarRepositoryProvider',
    );
  });

  it('loads calendars', async () => {
    const repository = createRepository({
      listCalendars: vi.fn().mockResolvedValue([calendar]),
    });
    const { result, waitForValueToChange } = renderHook(() => useCalendars(), {
      wrapper: createWrapper(repository),
    });

    expect(result.current).toEqual({
      data: [],
      loading: true,
      error: undefined,
    });

    await waitForValueToChange(() => result.current.loading);

    expect(result.current).toEqual({
      data: [calendar],
      loading: false,
      error: undefined,
    });
  });

  it('exposes repository errors', async () => {
    const repository = createRepository({
      listCalendars: vi.fn().mockRejectedValue(new Error('calendar failure')),
    });
    const { result, waitForValueToChange } = renderHook(() => useCalendars(), {
      wrapper: createWrapper(repository),
    });

    await waitForValueToChange(() => result.current.loading);

    expect(result.current).toEqual({
      data: [],
      loading: false,
      error: expect.objectContaining({ message: 'calendar failure' }),
    });
  });

  it('reloads event ranges and ignores stale responses', async () => {
    let resolveFirst: ((events: CalendarEvent[]) => void) | undefined;
    let resolveSecond: ((events: CalendarEvent[]) => void) | undefined;

    const first = new Promise<CalendarEvent[]>((resolve) => {
      resolveFirst = resolve;
    });
    const second = new Promise<CalendarEvent[]>((resolve) => {
      resolveSecond = resolve;
    });
    const listEvents = vi
      .fn()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);
    const repository = createRepository({ listEvents });

    const firstRange: CalendarTimeRange = {
      start: '2026-09-01T00:00:00Z',
      end: '2026-10-01T00:00:00Z',
    };
    const secondRange: CalendarTimeRange = {
      start: '2026-10-01T00:00:00Z',
      end: '2026-11-01T00:00:00Z',
    };

    let range = firstRange;
    const { result, rerender, waitForValueToChange } = renderHook(
      () => useCalendarEvents(['team'], range),
      { wrapper: createWrapper(repository) },
    );

    range = secondRange;
    rerender();

    resolveFirst?.([{ ...event, id: 'stale', title: 'Stale event' }]);
    await Promise.resolve();

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toEqual([]);

    resolveSecond?.([event]);
    await waitForValueToChange(() => result.current.loading);

    expect(result.current).toEqual({
      data: [event],
      loading: false,
      error: undefined,
    });
    expect(listEvents).toHaveBeenNthCalledWith(2, ['team'], secondRange);
  });

  it('loads an event by calendar and event id', async () => {
    const getEvent = vi.fn().mockResolvedValue(event);
    const repository = createRepository({ getEvent });
    const { result, waitForValueToChange } = renderHook(
      () => useCalendarEvent('team', 'planning'),
      { wrapper: createWrapper(repository) },
    );

    await waitForValueToChange(() => result.current.loading);

    expect(result.current).toEqual({
      data: event,
      loading: false,
      error: undefined,
    });
    expect(getEvent).toHaveBeenCalledWith('team', 'planning');
  });
});
