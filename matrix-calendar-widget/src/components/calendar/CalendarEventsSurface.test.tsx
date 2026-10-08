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

  it('keeps available calendars visible with a generic partial-source warning', async () => {
    const repository = Object.assign(
      new InMemoryCalendarRepository({ calendars, events }),
      {
        getRoomCalendarCapabilities: vi.fn().mockResolvedValue(undefined),
        listCalendarsWithAvailability: vi.fn().mockResolvedValue({
          calendars,
          partialAvailability: true,
          canManageCalendarCollections: true,
        }),
        listEventsWithAvailability: vi.fn().mockResolvedValue({
          events,
          diagnostics: [],
          partialAvailability: false,
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

    expect(await screen.findByText('Team planning')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Some calendars or events could not be loaded. Available calendars are still shown.',
    );
    expect(screen.getByRole('alert')).not.toHaveTextContent('Room');
  });

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

    const calendarGroup = screen.getByRole('group', { name: 'Calendar' });
    expect(
      within(calendarGroup).getByRole('checkbox', {
        name: 'Team calendar',
      }),
    ).toBeChecked();

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

  it('shows the saved title in event details after a whole-event edit', async () => {
    const event = events[0];
    const repository = new InMemoryCalendarRepository({
      calendars: [{ ...calendars[0], readOnly: false }],
      events: [event],
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

    await userEvent.click(
      await screen.findByRole('button', { name: /Team planning/ }),
    );
    const details = screen.getByRole('dialog', { name: 'Team planning' });
    await userEvent.click(
      within(details).getByRole('button', { name: 'Edit' }),
    );

    const editor = screen.getByRole('dialog', { name: 'Edit event' });
    const titleInput = within(editor).getByLabelText(/^Title/);
    await userEvent.clear(titleInput);
    await userEvent.type(titleInput, 'Updated team planning');
    await userEvent.click(within(editor).getByRole('button', { name: 'Save' }));

    expect(
      await screen.findByRole('dialog', { name: 'Updated team planning' }),
    ).toBeInTheDocument();
    expect((await repository.getEvent('team', event.id)).title).toBe(
      'Updated team planning',
    );
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
    await userEvent.click(
      within(editor).getByRole('button', { name: 'Entire series' }),
    );
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

    const savedDetails = screen.getByRole('dialog');
    expect(
      within(savedDetails).getByRole('heading', {
        name: 'Updated planning series',
      }),
    ).toBeInTheDocument();
    expect(savedDetails).toHaveTextContent('September 26, 2026 · All day');
    expect(savedDetails).toHaveTextContent(
      'This is one occurrence of a recurring series.',
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

  it('skips and restores a moved occurrence using its original recurrence identity', async () => {
    const originalRecurrenceId = {
      type: 'date-time' as const,
      value: {
        local: '2026-10-02T09:00:00',
        timezone: 'Europe/Stockholm',
      },
    };
    const recurringEvent: CalendarEvent = {
      id: 'https://radicale.example.test/team/moved.ics',
      calendarId: 'team',
      uid: 'moved-series@example.test',
      title: 'Moved planning',
      timing: {
        type: 'timed',
        start: {
          type: 'zoned',
          local: '2026-10-01T09:00:00',
          timezone: 'Europe/Stockholm',
        },
        end: {
          type: 'zoned',
          local: '2026-10-01T10:00:00',
          timezone: 'Europe/Stockholm',
        },
      },
      recurrence: {
        rrule: 'FREQ=DAILY;COUNT=3',
        overrides: [
          {
            recurrenceId: originalRecurrenceId,
            timing: {
              type: 'end',
              start: {
                type: 'date-time',
                value: {
                  local: '2026-10-01T12:00:00',
                  timezone: 'Europe/Stockholm',
                },
              },
              end: {
                type: 'date-time',
                value: {
                  local: '2026-10-01T13:00:00',
                  timezone: 'Europe/Stockholm',
                },
              },
            },
          },
        ],
      },
    };
    const repository = new InMemoryCalendarRepository({
      calendars: [{ ...calendars[0], readOnly: false }],
      events: [recurringEvent],
    });
    const updateEvent = vi.spyOn(repository, 'updateEvent');

    render(
      <CalendarEventsSurface
        filters={{
          startDate: '2026-10-01T00:00:00Z',
          endDate: '2026-10-01T23:59:59.999Z',
        }}
        onShowMore={() => undefined}
        view="list"
      />,
      { wrapper: createWrapper(repository) },
    );

    const occurrences = await screen.findAllByRole('listitem', {
      name: 'Moved planning',
    });
    expect(occurrences).toHaveLength(2);
    await userEvent.click(within(occurrences[1]).getByRole('button'));

    const details = screen.getByRole('dialog');
    await userEvent.click(
      within(details).getByRole('button', { name: 'Skip this occurrence' }),
    );
    await waitFor(() =>
      expect(updateEvent).toHaveBeenCalledWith('team', recurringEvent.id, {
        recurrence: {
          exdate: {
            action: 'add',
            recurrenceId: originalRecurrenceId,
          },
        },
      }),
    );
    expect(
      (await repository.getEvent('team', recurringEvent.id)).recurrence
        ?.exdates,
    ).toEqual([originalRecurrenceId]);
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Close',
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(
        screen.getAllByRole('listitem', { name: 'Moved planning' }),
      ).toHaveLength(1),
    );
    await userEvent.click(
      within(
        (await screen.findAllByRole('listitem', { name: 'Moved planning' }))[0],
      ).getByRole('button'),
    );
    const remainingOccurrenceDetails = screen.getByRole('dialog');
    expect(
      within(remainingOccurrenceDetails).getByText('Skipped occurrences'),
    ).toBeInTheDocument();
    await userEvent.click(
      within(remainingOccurrenceDetails).getByRole('button', {
        name: 'Restore',
      }),
    );
    await waitFor(() => expect(updateEvent).toHaveBeenCalledTimes(2));
    expect(updateEvent).toHaveBeenLastCalledWith('team', recurringEvent.id, {
      recurrence: {
        exdate: {
          action: 'remove',
          recurrenceId: originalRecurrenceId,
        },
      },
    });
    expect(
      (await repository.getEvent('team', recurringEvent.id)).recurrence
        ?.exdates,
    ).toBeUndefined();
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }),
    );
    await waitFor(() =>
      expect(
        screen.getAllByRole('listitem', { name: 'Moved planning' }),
      ).toHaveLength(2),
    );
  });

  it('shows duplicate skipped dates once and restores only the selected recurrence identity', async () => {
    const skippedDate = {
      type: 'date-time' as const,
      value: {
        local: '2026-10-02T09:00:00',
        timezone: 'Europe/Stockholm',
      },
    };
    const otherSkippedDate = {
      type: 'date-time' as const,
      value: {
        local: '2026-10-03T09:00:00',
        timezone: 'Europe/Stockholm',
      },
    };
    const recurringEvent: CalendarEvent = {
      id: 'https://radicale.example.test/team/skipped.ics',
      calendarId: 'team',
      uid: 'skipped-series@example.test',
      title: 'Skipped dates',
      timing: {
        type: 'timed',
        start: {
          type: 'zoned',
          local: '2026-10-01T09:00:00',
          timezone: 'Europe/Stockholm',
        },
        end: {
          type: 'zoned',
          local: '2026-10-01T10:00:00',
          timezone: 'Europe/Stockholm',
        },
      },
      recurrence: {
        rrule: 'FREQ=DAILY;COUNT=4',
        exdates: [skippedDate, skippedDate, otherSkippedDate],
      },
    };
    const repository = new InMemoryCalendarRepository({
      calendars: [{ ...calendars[0], readOnly: false }],
      events: [recurringEvent],
    });
    const updateEvent = vi.spyOn(repository, 'updateEvent');

    render(
      <CalendarEventsSurface
        filters={{
          startDate: '2026-10-01T00:00:00Z',
          endDate: '2026-10-04T23:59:59.999Z',
        }}
        onShowMore={() => undefined}
        view="list"
      />,
      { wrapper: createWrapper(repository) },
    );

    const occurrences = await screen.findAllByText('Skipped dates');
    expect(occurrences).toHaveLength(2);
    await userEvent.click(occurrences[0]);

    const details = screen.getByRole('dialog');
    const restoreButtons = within(details).getAllByRole('button', {
      name: 'Restore',
    });
    expect(restoreButtons).toHaveLength(2);
    await userEvent.click(restoreButtons[0]);

    await waitFor(() => expect(updateEvent).toHaveBeenCalledTimes(1));
    expect(updateEvent).toHaveBeenCalledWith('team', recurringEvent.id, {
      recurrence: {
        exdate: { action: 'remove', recurrenceId: skippedDate },
      },
    });
    expect(
      (await repository.getEvent('team', recurringEvent.id)).recurrence
        ?.exdates,
    ).toEqual([otherSkippedDate]);
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }),
    );
    await waitFor(() =>
      expect(
        screen.getAllByRole('listitem', { name: 'Skipped dates' }),
      ).toHaveLength(3),
    );
    await userEvent.click(
      within(
        screen.getAllByRole('listitem', { name: 'Skipped dates' })[0],
      ).getByRole('button'),
    );
    expect(
      within(screen.getByRole('dialog')).getAllByRole('button', {
        name: 'Restore',
      }),
    ).toHaveLength(1);
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
