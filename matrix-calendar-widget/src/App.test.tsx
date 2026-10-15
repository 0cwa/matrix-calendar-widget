/*
 * Copyright 2022 Nordeck IT + Consulting GmbH
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
import { WidgetApiMockProvider } from '@matrix-widget-toolkit/react';
import { MockedWidgetApi, mockWidgetApi } from '@matrix-widget-toolkit/testing';
import { render, screen, waitFor } from '@testing-library/react';
import { DateTime } from 'luxon';
import { ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import App from './App';
import { CalendarRepositoryProvider } from './calendar';
import { LocalizationProvider } from './components/common/LocalizationProvider';
import { mockCreateMeetingRoom } from './lib/testUtils';
import { StoreProvider } from './store';

const roomId = '!calendar-room:example.test';
const personalCalendar: Calendar = {
  id: 'personal',
  name: 'Personal calendar',
  readOnly: false,
  timezone: 'UTC',
};
const teamCalendar: Calendar = {
  id: 'room-calendar',
  name: 'Room calendar',
  operatorManaged: true,
  readOnly: false,
  timezone: 'UTC',
};

let widgetApi: MockedWidgetApi | undefined;

function eventFor(calendar: Calendar, title: string): CalendarEvent {
  const startDate = DateTime.local().toISODate()!;
  return {
    id: `${calendar.id}-event`,
    calendarId: calendar.id,
    uid: `${calendar.id}@example.test`,
    title,
    timing: {
      type: 'all-day',
      startDate,
      endDate: DateTime.fromISO(startDate).plus({ days: 1 }).toISODate()!,
    },
  };
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="current-path">{location.pathname}</output>;
}

function renderApp({
  calendarMode = 'personal',
  initialPath = '/',
  meetingRoomState = false,
}: {
  calendarMode?: 'personal' | 'bound-room';
  initialPath?: string;
  meetingRoomState?: boolean;
} = {}) {
  const api = mockWidgetApi({ roomId });
  widgetApi = api;
  if (meetingRoomState) {
    mockCreateMeetingRoom(api, { room_id: roomId });
  }

  const calendars =
    calendarMode === 'bound-room'
      ? [personalCalendar, teamCalendar]
      : [personalCalendar];
  const events = [
    eventFor(personalCalendar, 'Personal planning'),
    ...(calendarMode === 'bound-room'
      ? [eventFor(teamCalendar, 'Team planning')]
      : []),
  ];
  const repository = new InMemoryCalendarRepository({ calendars, events });

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <LocalizationProvider>
        <WidgetApiMockProvider value={api}>
          <CalendarRepositoryProvider repository={repository}>
            <StoreProvider>
              <MemoryRouter initialEntries={[initialPath]}>
                <LocationProbe />
                {children}
              </MemoryRouter>
            </StoreProvider>
          </CalendarRepositoryProvider>
        </WidgetApiMockProvider>
      </LocalizationProvider>
    );
  }

  const utils = render(<App />, { wrapper: Wrapper });
  return utils;
}

afterEach(() => {
  widgetApi?.stop();
  widgetApi = undefined;
  localStorage.clear();
});

describe('<App />', () => {
  it('shows personal calendars in an ordinary room without inventing a room calendar', async () => {
    renderApp();

    expect(await screen.findByText('Personal planning')).toBeInTheDocument();
    expect(screen.queryByText('Room calendar')).toBeNull();
    expect(screen.queryByText('Team planning')).toBeNull();
    expect(screen.getByRole('button', { name: 'Create event' })).toBeEnabled();
  });

  it('shows repository-provided room calendars on the same calendar home', async () => {
    renderApp({ calendarMode: 'bound-room' });

    expect(await screen.findByText('Personal planning')).toBeInTheDocument();
    expect(await screen.findByText('Team planning')).toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', { name: 'Room calendar' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create event' })).toBeEnabled();
  });

  it('keeps the calendar home when the current Matrix room has legacy meeting state', async () => {
    renderApp({ meetingRoomState: true });

    expect(await screen.findByText('Personal planning')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create event' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Invitations' })).toBeNull();
    expect(
      screen.getByRole('navigation', { name: 'Calendar controls' }),
    ).toBeInTheDocument();
  });

  it.each(['/schedule-meeting', '/setup-breakout-sessions', '/cockpit'])(
    'redirects the legacy route %s to calendar home',
    async (path) => {
      renderApp({ initialPath: path });

      await waitFor(() =>
        expect(screen.getByTestId('current-path')).toHaveTextContent('/'),
      );
      expect(
        await screen.findByRole('button', { name: 'Create event' }),
      ).toBeInTheDocument();
    },
  );
});
