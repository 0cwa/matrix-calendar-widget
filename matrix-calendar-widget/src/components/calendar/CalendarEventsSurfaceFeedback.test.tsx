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
  CalendarRepositoryError,
  InMemoryCalendarRepository,
} from '@matrix-calendar-widget/calendar';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ComponentProps, PropsWithChildren } from 'react';
import { vi } from 'vitest';
import { axe } from 'vitest-axe';
import {
  CalendarFilters,
  CalendarRepositoryProvider,
  useInvalidateCalendarRepository,
} from '../../calendar';
import { CalendarEventsSurface } from './CalendarEventsSurface';

const calendar: Calendar = {
  id: 'team',
  name: 'Team calendar',
  timezone: 'UTC',
  readOnly: false,
};

const event: CalendarEvent = {
  id: 'planning',
  calendarId: calendar.id,
  uid: 'planning@example.test',
  title: 'Team planning',
  timing: {
    type: 'all-day',
    startDate: '2026-09-25',
    endDate: '2026-09-26',
  },
};

const filters: CalendarFilters = {
  startDate: '2026-09-25T00:00:00Z',
  endDate: '2026-09-25T23:59:59Z',
  filterText: '',
};

const nextDay: CalendarFilters = {
  startDate: '2026-09-26T00:00:00Z',
  endDate: '2026-09-26T23:59:59Z',
  filterText: '',
};

function renderSurface(
  repository: InMemoryCalendarRepository,
  {
    onClearSearch,
    onCreateEvent,
    initialFilters = filters,
    view = 'list',
  }: {
    onClearSearch?: () => void;
    onCreateEvent?: () => void;
    initialFilters?: CalendarFilters;
    view?: ComponentProps<typeof CalendarEventsSurface>['view'];
  } = {},
) {
  let invalidate: () => void = () => undefined;
  function Invalidation() {
    invalidate = useInvalidateCalendarRepository();
    return null;
  }
  function Wrapper({ children }: PropsWithChildren<{}>) {
    return (
      <CalendarRepositoryProvider repository={repository}>
        <Invalidation />
        {children}
      </CalendarRepositoryProvider>
    );
  }
  const surface = (currentFilters: CalendarFilters) => (
    <CalendarEventsSurface
      filters={currentFilters}
      onClearSearch={onClearSearch}
      onCreateEvent={onCreateEvent}
      onShowMore={() => undefined}
      view={view}
    />
  );
  const { rerender, container } = render(surface(initialFilters), {
    wrapper: Wrapper,
  });

  return {
    container,
    invalidate: () => act(() => invalidate()),
    setFilters: (currentFilters: CalendarFilters) =>
      rerender(surface(currentFilters)),
  };
}

describe('<CalendarEventsSurface /> feedback', () => {
  it('offers event creation for empty dates to a writer', async () => {
    const onCreateEvent = vi.fn();
    const { container } = renderSurface(
      new InMemoryCalendarRepository({ calendars: [calendar], events: [] }),
      { onCreateEvent },
    );

    expect(
      await screen.findByText('No events in these dates'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Clear search' }),
    ).not.toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();

    await userEvent.click(screen.getByRole('button', { name: 'Add an event' }));

    expect(onCreateEvent).toHaveBeenCalledOnce();
  });

  it.each(['day', 'week', 'workWeek', 'month'] as const)(
    'explains an empty %s grid and offers a writer the create shortcut',
    async (view) => {
      const onCreateEvent = vi.fn();
      renderSurface(
        new InMemoryCalendarRepository({ calendars: [calendar], events: [] }),
        { onCreateEvent, view },
      );

      expect(
        await screen.findByText('No events in these dates'),
      ).toBeInTheDocument();
      await userEvent.click(
        screen.getByRole('button', { name: 'Add an event' }),
      );
      expect(onCreateEvent).toHaveBeenCalledOnce();
    },
  );

  it('does not offer event creation to a viewer', async () => {
    renderSurface(
      new InMemoryCalendarRepository({
        calendars: [{ ...calendar, readOnly: true }],
        events: [],
      }),
      { onCreateEvent: vi.fn() },
    );

    expect(
      await screen.findByText('No events in these dates'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it.each(['list', 'day'] as const)(
    'offers to clear a search that hides every event in the %s view',
    async (view) => {
      const onClearSearch = vi.fn();
      renderSurface(
        new InMemoryCalendarRepository({
          calendars: [calendar],
          events: [event],
        }),
        {
          onClearSearch,
          onCreateEvent: vi.fn(),
          initialFilters: { ...filters, filterText: ' dentist ' },
          view,
        },
      );

      expect(
        await screen.findByText('No events match “dentist”'),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Add an event' }),
      ).not.toBeInTheDocument();

      await userEvent.click(
        screen.getByRole('button', { name: 'Clear search' }),
      );

      expect(onClearSearch).toHaveBeenCalledOnce();
    },
  );

  it('calls dates without events empty even while searching', async () => {
    renderSurface(
      new InMemoryCalendarRepository({ calendars: [calendar], events: [] }),
      { initialFilters: { ...filters, filterText: 'dentist' } },
    );

    expect(
      await screen.findByText('No events in these dates'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/No events match/)).not.toBeInTheDocument();
  });

  it('shows hidden calendars again and keeps focus on the surface', async () => {
    renderSurface(
      new InMemoryCalendarRepository({
        calendars: [calendar, { ...calendar, id: 'other', name: 'Other' }],
        events: [event],
      }),
    );

    await userEvent.click(
      await screen.findByRole('checkbox', { name: 'Team calendar' }),
    );
    expect(
      screen.getByText('No events in the selected calendars'),
    ).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('button', { name: 'Show all calendars' }),
    );

    expect(screen.getByText('Team planning')).toBeInTheDocument();
    // The surface itself takes focus when the action that was pressed leaves.
    // eslint-disable-next-line testing-library/no-node-access
    expect(document.activeElement).toContainElement(
      screen.getByText('Team planning'),
    );
  });

  it('only explains missing room setup when there is no calendar', async () => {
    renderSurface(
      new InMemoryCalendarRepository({ calendars: [], events: [] }),
      { onCreateEvent: vi.fn() },
    );

    expect(
      await screen.findByText(/A team calendar isn’t available in this room/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/No events/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('retries a failed load and keeps keyboard focus', async () => {
    const repository = new InMemoryCalendarRepository({
      calendars: [calendar],
      events: [event],
    });
    const listEvents = repository.listEvents.bind(repository);
    let offline = true;
    vi.spyOn(repository, 'listEvents').mockImplementation(
      async (calendarIds, range) => {
        if (offline && calendarIds.length > 0) {
          offline = false;
          throw new CalendarRepositoryError('request-failed', 'offline');
        }
        return listEvents(calendarIds, range);
      },
    );
    renderSurface(repository);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Calendar events could not be loaded.',
    );
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Retry' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');

    expect(await screen.findByText('Team planning')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    // The surface itself takes focus when the action that was pressed leaves.
    // eslint-disable-next-line testing-library/no-node-access
    expect(document.activeElement).toContainElement(
      screen.getByText('Team planning'),
    );
  });

  it('does not offer a retry that cannot change the answer', async () => {
    const repository = new InMemoryCalendarRepository({
      calendars: [calendar],
      events: [],
    });
    vi.spyOn(repository, 'listCalendars').mockRejectedValue(
      new CalendarRepositoryError('capability-unavailable', 'disabled'),
    );
    renderSurface(repository);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Retry' }),
    ).not.toBeInTheDocument();
  });

  it('keeps events during a refresh but not for other dates', async () => {
    const repository = new InMemoryCalendarRepository({
      calendars: [calendar],
      events: [event],
    });
    const { invalidate, setFilters } = renderSurface(repository);
    expect(await screen.findByText('Team planning')).toBeInTheDocument();

    const pending = new Promise<CalendarEvent[]>(() => undefined);
    vi.spyOn(repository, 'listEvents').mockReturnValue(pending);
    invalidate();

    expect(screen.getByText('Team planning')).toBeInTheDocument();
    expect(
      screen.getByRole('progressbar', { name: 'Refreshing calendar events' }),
    ).toBeInTheDocument();

    setFilters(nextDay);

    expect(screen.queryByText('Team planning')).not.toBeInTheDocument();
    expect(
      screen.getByRole('progressbar', { name: 'Loading calendar events' }),
    ).toBeInTheDocument();
  });

  it('keeps events while only the search changes', async () => {
    const repository = new InMemoryCalendarRepository({
      calendars: [calendar],
      events: [event],
    });
    const listEvents = vi.spyOn(repository, 'listEvents');
    const { setFilters } = renderSurface(repository);
    expect(await screen.findByText('Team planning')).toBeInTheDocument();
    const requests = listEvents.mock.calls.length;

    setFilters({ ...filters, filterText: 'planning' });

    expect(screen.getByText('Team planning')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(listEvents).toHaveBeenCalledTimes(requests);
  });
});
