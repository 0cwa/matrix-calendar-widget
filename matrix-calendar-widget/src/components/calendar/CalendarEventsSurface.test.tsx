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
  InMemoryCalendarRepository,
} from '@matrix-calendar-widget/calendar';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PropsWithChildren } from 'react';
import { vi } from 'vitest';
import { CalendarRepositoryProvider } from '../../calendar';
import { CalendarEventsSurface } from './CalendarEventsSurface';

const calendars: Calendar[] = [
  {
    id: 'team',
    name: 'Team calendar',
    color: '#d32f2f',
    timezone: 'UTC',
  },
  {
    id: 'personal',
    name: 'Personal calendar',
    color: '#1976d2',
    timezone: 'UTC',
  },
];

const events: CalendarEvent[] = [
  {
    id: 'team-planning',
    calendarId: 'team',
    uid: 'team-planning@example.test',
    title: 'Team planning',
    timing: {
      type: 'all-day',
      startDate: '2026-09-25',
      endDate: '2026-09-26',
    },
  },
  {
    id: 'dentist',
    calendarId: 'personal',
    uid: 'dentist@example.test',
    title: 'Dentist',
    timing: {
      type: 'all-day',
      startDate: '2026-09-25',
      endDate: '2026-09-26',
    },
  },
];

function createWrapper(repository: InMemoryCalendarRepository) {
  return function Wrapper({ children }: PropsWithChildren<{}>) {
    return (
      <CalendarRepositoryProvider repository={repository}>
        {children}
      </CalendarRepositoryProvider>
    );
  };
}

describe('<CalendarEventsSurface />', () => {
  it('keeps a generic compatibility notice when a mixed calendar is hidden', async () => {
    const repository = new InMemoryCalendarRepository({
      calendars: [
        {
          id: 'team',
          name: 'Team calendar',
          supportedComponents: ['VEVENT', 'VTODO'],
        },
        {
          id: 'personal',
          name: 'Personal calendar',
          supportedComponents: ['VEVENT'],
        },
      ],
      events,
    });

    render(
      <CalendarEventsSurface
        filters={{
          startDate: '2026-09-25T00:00:00Z',
          endDate: '2026-09-25T23:59:59Z',
        }}
        onShowMore={() => undefined}
        view="list"
      />,
      { wrapper: createWrapper(repository) },
    );

    const notice = await screen.findByRole('alert');
    expect(notice).toHaveTextContent(
      'One or more calendars support additional item types. The widget displays and edits VEVENT entries only.',
    );
    expect(notice).not.toHaveTextContent('Team calendar');
    expect(screen.getByText('Team planning')).toBeInTheDocument();
    expect(screen.getByText('Dentist')).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('checkbox', { name: 'Team calendar' }),
    );

    await waitFor(() =>
      expect(screen.queryByText('Team planning')).not.toBeInTheDocument(),
    );
    expect(screen.getByText('Dentist')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'One or more calendars support additional item types.',
    );
  });

  it.each([
    {
      label: 'VEVENT-only',
      supportedComponents: ['VEVENT'],
    },
    {
      label: 'unknown component set',
      supportedComponents: undefined,
    },
  ])(
    'does not show a compatibility notice for $label calendars',
    async (calendar) => {
      const repository = new InMemoryCalendarRepository({
        calendars: [
          {
            id: 'team',
            name: 'Team calendar',
            supportedComponents: calendar.supportedComponents,
          },
        ],
        events: [events[0]],
      });

      render(
        <CalendarEventsSurface
          filters={{
            startDate: '2026-09-25T00:00:00Z',
            endDate: '2026-09-25T23:59:59Z',
          }}
          onShowMore={() => undefined}
          view="list"
        />,
        { wrapper: createWrapper(repository) },
      );

      expect(await screen.findByText('Team planning')).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    },
  );

  it('hides and shows events with lightweight calendar visibility controls', async () => {
    const repository = new InMemoryCalendarRepository({ calendars, events });

    render(
      <CalendarEventsSurface
        filters={{
          startDate: '2026-09-25T00:00:00Z',
          endDate: '2026-09-25T23:59:59Z',
        }}
        onShowMore={() => undefined}
        view="list"
      />,
      { wrapper: createWrapper(repository) },
    );

    expect(await screen.findByText('Team planning')).toBeInTheDocument();
    expect(screen.getByText('Dentist')).toBeInTheDocument();

    const personalCalendar = screen.getByRole('checkbox', {
      name: 'Personal calendar',
    });
    expect(personalCalendar).toBeChecked();

    await userEvent.click(personalCalendar);

    await waitFor(() =>
      expect(screen.queryByText('Dentist')).not.toBeInTheDocument(),
    );
    expect(screen.getByText('Team planning')).toBeInTheDocument();

    await userEvent.click(personalCalendar);

    expect(await screen.findByText('Dentist')).toBeInTheDocument();
  });

  it.each([
    { view: 'list' as const, count: 1 },
    { view: 'month' as const, count: 2 },
  ])(
    'warns and omits $count THISANDFUTURE series from the $view renderer without mutation',
    async ({ view, count }) => {
      const unsupportedSeries: CalendarEvent[] = Array.from(
        { length: count },
        (_, index) => ({
          ...events[0],
          id: `range-series-${index}`,
          uid: `range-series-${index}@example.test`,
          title: 'Shifted planning series',
          recurrence: { rrule: 'FREQ=WEEKLY' },
          unsupportedRecurrence: 'range-this-and-future',
        }),
      );
      const repository = new InMemoryCalendarRepository({
        calendars: [calendars[0]],
        events: [events[0], ...unsupportedSeries],
      });
      const updateEvent = vi.spyOn(repository, 'updateEvent');
      const deleteEvent = vi.spyOn(repository, 'deleteEvent');

      render(
        <CalendarEventsSurface
          filters={{
            startDate: '2026-09-25T00:00:00Z',
            endDate: '2026-09-25T23:59:59Z',
          }}
          onShowMore={() => undefined}
          view={view}
        />,
        { wrapper: createWrapper(repository) },
      );

      expect(await screen.findByRole('alert')).toHaveTextContent(
        count === 1
          ? '1 recurring series contains a THISANDFUTURE range override that the current renderer cannot safely display.'
          : '2 recurring series contain a THISANDFUTURE range override that the current renderer cannot safely display.',
      );
      expect(
        screen.queryByText('Shifted planning series'),
      ).not.toBeInTheDocument();
      expect(updateEvent).not.toHaveBeenCalled();
      expect(deleteEvent).not.toHaveBeenCalled();
    },
  );
});
