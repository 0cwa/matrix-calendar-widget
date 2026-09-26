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
    unsupportedComponents: ['VTODO', 'VJOURNAL'],
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
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Personal calendar also supports VTODO, VJOURNAL. Items of those types are not shown or modified here.',
    );

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

  it('shows a visible recurring occurrence without exposing resource-wide actions', async () => {
    const recurring: CalendarEvent = {
      id: 'daily-planning',
      calendarId: 'team',
      uid: 'daily-planning@example.test',
      title: 'Daily planning',
      timing: {
        type: 'timed',
        start: {
          local: '2026-09-23T09:00:00',
          timezone: 'Europe/Stockholm',
          mode: 'tzid',
        },
        end: {
          local: '2026-09-23T10:00:00',
          timezone: 'Europe/Stockholm',
          mode: 'tzid',
        },
      },
      recurrence: { rrule: 'FREQ=DAILY;COUNT=5' },
    };
    const repository = new InMemoryCalendarRepository({
      calendars: [calendars[0]],
      events: [recurring],
    });
    const deleteSpy = vi.spyOn(repository, 'deleteEvent');
    const updateSpy = vi.spyOn(repository, 'updateEvent');

    render(
      <CalendarEventsSurface
        filters={{
          startDate: '2026-09-25T00:00:00+02:00',
          endDate: '2026-09-25T23:59:59+02:00',
        }}
        onShowMore={() => undefined}
        view="list"
      />,
      { wrapper: createWrapper(repository) },
    );

    await userEvent.click(
      await screen.findByRole('button', { name: /Daily planning/i }),
    );

    expect(
      await screen.findByText(
        'Editing or deleting an individual recurring occurrence is not available yet.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('warns when a recurring resource cannot be expanded', async () => {
    const invalidRecurrence: CalendarEvent = {
      ...events[0],
      recurrence: { rrule: 'FREQ=UNSUPPORTED' },
    };
    const repository = new InMemoryCalendarRepository({
      calendars: [calendars[0]],
      events: [invalidRecurrence],
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

    expect(
      await screen.findByText(
        '1 recurring event(s) could not be displayed because their recurrence data is unsupported or invalid.',
      ),
    ).toBeInTheDocument();
  });

  it('warns and omits series with opaque unsupported recurrence metadata', async () => {
    const rangedRecurrence: CalendarEvent = {
      ...events[0],
      recurrence: { rrule: 'FREQ=DAILY;COUNT=3' },
      unsupportedRecurrence: 'ranged-override',
    };
    const repository = new InMemoryCalendarRepository({
      calendars: [calendars[0]],
      events: [rangedRecurrence],
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

    expect(
      await screen.findByText(
        '1 recurring event(s) could not be displayed because their recurrence data is unsupported or invalid.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Team planning')).toBeNull();
  });
});
