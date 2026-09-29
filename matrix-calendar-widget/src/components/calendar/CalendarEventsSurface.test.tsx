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
import { render, screen, waitFor, within } from '@testing-library/react';
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

  it('shows gateway projection warnings without requiring event payloads', async () => {
    const repository = Object.assign(
      new InMemoryCalendarRepository({
        calendars,
        events,
      }),
      {
        listEventsWithDiagnostics: vi.fn().mockResolvedValue({
          events,
          diagnostics: [
            {
              calendarId: 'team',
              reason: 'unsupported-timezone',
              count: 1,
            },
          ],
        }),
      },
    );

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

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'One event has recurrence or timezone data that the current renderer cannot safely display.',
    );
    expect(screen.getByText('Team planning')).toBeInTheDocument();
    expect(screen.getByText('Dentist')).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('checkbox', { name: 'Team calendar' }),
    );

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('Team planning')).not.toBeInTheDocument();
    expect(screen.getByText('Dentist')).toBeInTheDocument();
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

  it.each(['list', 'month'] as const)(
    'clips query-padded-only recurrence from the %s view',
    async (view) => {
      const paddedEvent: CalendarEvent = {
        ...events[0],
        id: 'padded-source-resource',
        uid: 'padded-source-resource@example.test',
        title: 'Padded only event',
        timing: {
          type: 'all-day',
          startDate: view === 'list' ? '2026-08-30' : '2026-08-29',
          endDate: view === 'list' ? '2026-08-31' : '2026-08-30',
        },
        recurrence: { rrule: 'FREQ=DAILY;COUNT=1' },
      };
      const repository = new InMemoryCalendarRepository({
        calendars: [calendars[0]],
        events: [paddedEvent],
      });
      vi.spyOn(repository, 'listEvents').mockResolvedValue([paddedEvent]);

      render(
        <CalendarEventsSurface
          filters={{
            startDate: '2026-09-01T00:00:00Z',
            endDate: '2026-09-30T23:59:59.999Z',
          }}
          onShowMore={() => undefined}
          view={view}
        />,
        { wrapper: createWrapper(repository) },
      );

      await waitFor(() =>
        expect(screen.queryByText('Padded only event')).not.toBeInTheDocument(),
      );
    },
  );

  it('shows the selected recurrence time while editing and deleting its source series', async () => {
    const recurringEvent: CalendarEvent = {
      ...events[0],
      id: 'https://radicale.example.test/team/planning.ics',
      uid: 'planning-series@example.test',
      title: 'Planning series',
      recurrence: { rrule: 'FREQ=DAILY;COUNT=2' },
    };
    const repository = new InMemoryCalendarRepository({
      calendars: [{ ...calendars[0], readOnly: false }],
      events: [recurringEvent],
    });
    const updateEvent = vi.spyOn(repository, 'updateEvent');
    const deleteEvent = vi.spyOn(repository, 'deleteEvent');

    render(
      <CalendarEventsSurface
        filters={{
          startDate: '2026-09-25T00:00:00Z',
          endDate: '2026-09-26T23:59:59.999Z',
        }}
        onShowMore={() => undefined}
        view="list"
      />,
      { wrapper: createWrapper(repository) },
    );

    const occurrences = await screen.findAllByText('Planning series');
    expect(occurrences).toHaveLength(2);
    await userEvent.click(occurrences[1]);
    const details = screen.getByRole('dialog');
    expect(details).toHaveTextContent('September 26, 2026 · All day');
    expect(details).toHaveTextContent(
      'This is one occurrence of a recurring series. Editing or deleting applies to the whole series.',
    );

    await userEvent.click(
      within(details).getByRole('button', { name: 'Edit' }),
    );
    const editor = screen.getByRole('dialog', { name: 'Edit event' });
    const titleInput = within(editor).getByLabelText(/^Title/);
    await userEvent.clear(titleInput);
    await userEvent.type(titleInput, 'Updated planning series');
    await userEvent.click(within(editor).getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(updateEvent).toHaveBeenCalledWith(
        'team',
        'https://radicale.example.test/team/planning.ics',
        expect.objectContaining({ title: 'Updated planning series' }),
      ),
    );

    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Delete',
      }),
    );
    const confirmation = screen.getByRole('dialog', { name: 'Delete event' });
    expect(confirmation).toHaveTextContent(
      'This removes the entire recurring series, including every occurrence.',
    );
    await userEvent.click(
      within(confirmation).getByRole('button', { name: 'Delete' }),
    );

    await waitFor(() =>
      expect(deleteEvent).toHaveBeenCalledWith(
        'team',
        'https://radicale.example.test/team/planning.ics',
      ),
    );
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
          ? 'The current renderer cannot safely display series with THISANDFUTURE range overrides. Affected series: 1.'
          : 'The current renderer cannot safely display series with THISANDFUTURE range overrides. Affected series: 2.',
      );
      expect(
        screen.queryByText('Shifted planning series'),
      ).not.toBeInTheDocument();
      expect(updateEvent).not.toHaveBeenCalled();
      expect(deleteEvent).not.toHaveBeenCalled();
    },
  );
});
