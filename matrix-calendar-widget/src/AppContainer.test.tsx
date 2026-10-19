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
import type { WidgetApi } from '@matrix-widget-toolkit/api';
import { WidgetApiMockProvider } from '@matrix-widget-toolkit/react';
import { MockedWidgetApi, mockWidgetApi } from '@matrix-widget-toolkit/testing';
import { render, screen } from '@testing-library/react';
import { DateTime } from 'luxon';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import AppContainer from './AppContainer';

const widgetApiContext = vi.hoisted(() => ({ value: undefined as unknown }));

vi.mock('@matrix-widget-toolkit/mui', () => ({
  getEnvironment: () => undefined,
  MuiThemeProvider: ({ children }: { children: ReactNode }) => children,
  MuiWidgetApiProvider: ({ children }: { children: ReactNode }) => (
    <WidgetApiMockProvider value={widgetApiContext.value as WidgetApi}>
      {children}
    </WidgetApiMockProvider>
  ),
}));

vi.mock('./store', () => {
  throw new Error('The calendar-only app must not load the meeting store.');
});

vi.mock('./reducer/meetingsApi', () => {
  throw new Error('The calendar-only app must not load meeting Redux state.');
});

vi.mock('./store/acceptMeetingInvitations', () => {
  throw new Error(
    'The calendar-only app must not load meeting invitation side effects.',
  );
});

vi.mock('@matrix-widget-toolkit/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@matrix-widget-toolkit/api')>()),
  extractRawWidgetParameters: () => ({}),
}));

const widgetApis: MockedWidgetApi[] = [];

function createWidgetApi(): MockedWidgetApi {
  const widgetApi = mockWidgetApi({ roomId: '!calendar-room:example.test' });
  widgetApis.push(widgetApi);
  widgetApiContext.value = widgetApi;
  return widgetApi;
}

afterEach(() => {
  widgetApis.splice(0).forEach((widgetApi) => widgetApi.stop());
  widgetApiContext.value = undefined;
  localStorage.clear();
});

describe('AppContainer', () => {
  it('shows an accessible configuration error instead of an in-memory calendar', () => {
    render(
      <AppContainer widgetApiPromise={Promise.resolve({} as WidgetApi)} />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Calendar configuration is incomplete.',
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'A Matrix room ID and calendar API URL are required.',
    );
  });

  it('mounts and remounts the bound-room calendar without meeting startup', async () => {
    const widgetApi = createWidgetApi();
    const personalCalendar: Calendar = {
      id: 'personal',
      name: 'Personal calendar',
      readOnly: false,
      timezone: 'UTC',
    };
    const roomCalendar: Calendar = {
      id: 'room-calendar',
      name: 'Room calendar',
      operatorManaged: true,
      readOnly: false,
      timezone: 'UTC',
    };
    const startDate = DateTime.local().toISODate()!;
    const teamEvent: CalendarEvent = {
      id: 'room-calendar-event',
      calendarId: 'room-calendar',
      uid: 'room-calendar-event@example.test',
      title: 'Authorized room planning',
      timing: {
        type: 'all-day',
        startDate,
        endDate: DateTime.fromISO(startDate).plus({ days: 1 }).toISODate()!,
      },
    };
    const repository = new InMemoryCalendarRepository({
      calendars: [personalCalendar, roomCalendar],
      events: [teamEvent],
    });
    const widgetApiPromise = Promise.resolve(widgetApi);

    const view = render(
      <MemoryRouter>
        <AppContainer
          calendarRepository={repository}
          widgetApiPromise={widgetApiPromise}
        />
      </MemoryRouter>,
    );

    expect(
      await screen.findByText('Authorized room planning'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', { name: 'Room calendar' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create event' })).toBeEnabled();

    view.unmount();

    render(
      <MemoryRouter>
        <AppContainer
          calendarRepository={repository}
          widgetApiPromise={widgetApiPromise}
        />
      </MemoryRouter>,
    );

    expect(
      await screen.findByText('Authorized room planning'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create event' })).toBeEnabled();
    expect(
      await screen.findByRole('navigation', { name: 'Calendar controls' }),
    ).toBeInTheDocument();
  });

  it('uses an explicitly injected repository when gateway config is missing', async () => {
    const widgetApi = createWidgetApi();
    render(
      <MemoryRouter>
        <AppContainer
          calendarRepository={new InMemoryCalendarRepository()}
          widgetApiPromise={Promise.resolve(widgetApi)}
        />
      </MemoryRouter>,
    );

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(
      await screen.findByRole('navigation', { name: 'Calendar controls' }),
    ).toBeInTheDocument();
  });
});
