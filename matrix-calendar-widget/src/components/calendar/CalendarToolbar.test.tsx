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
} from '@matrix-calendar-widget/calendar';
import {
  render,
  screen,
  waitForElementToBeRemoved,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PropsWithChildren } from 'react';
import { vi } from 'vitest';
import {
  CalendarRepositoryProvider,
  GatewayCalendarRepository,
} from '../../calendar';
import { LocalizationProvider } from '../common/LocalizationProvider';
import { CalendarToolbar } from './CalendarToolbar';

describe('<CalendarToolbar/>', () => {
  it('keeps room event creation on the one server-returned calendar', async () => {
    const roomCalendar: Calendar = {
      id: 'configured-room-calendar',
      name: 'Planning room calendar',
    };
    const createdEvent: CalendarEvent = {
      id: 'planning.ics',
      calendarId: roomCalendar.id,
      uid: 'planning@example.test',
      title: 'Room planning',
      timing: {
        type: 'timed',
        start: { local: '2026-09-25T10:00', timezone: 'UTC' },
        end: { local: '2026-09-25T11:00', timezone: 'UTC' },
      },
    };
    const repository = {
      listCalendars: vi.fn().mockResolvedValue([roomCalendar]),
      createEvent: vi.fn().mockResolvedValue(createdEvent),
    } as unknown as CalendarRepository;

    function Wrapper({ children }: PropsWithChildren) {
      return (
        <LocalizationProvider>
          <CalendarRepositoryProvider repository={repository}>
            {children}
          </CalendarRepositoryProvider>
        </LocalizationProvider>
      );
    }

    render(
      <CalendarToolbar
        filters={{
          startDate: '2026-09-25T00:00:00Z',
          endDate: '2026-09-26T00:00:00Z',
        }}
        onRangeChange={vi.fn()}
        onSearchChange={vi.fn()}
        onViewChange={vi.fn()}
        roomContext
        view="list"
      />,
      { wrapper: Wrapper },
    );

    expect(
      await screen.findByRole('button', { name: 'Create event' }),
    ).toBeEnabled();
    expect(
      screen.queryByRole('button', { name: 'Create calendar' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Rename calendar' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Delete calendar' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Edit calendar details' }),
    ).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Create event' }));
    const dialog = await screen.findByRole('dialog', { name: 'Create event' });
    expect(within(dialog).queryByLabelText('Calendar')).not.toBeInTheDocument();

    await userEvent.type(
      within(dialog).getByRole('textbox', { name: 'Title' }),
      'Room planning',
    );
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Create event' }),
    );

    expect(repository.createEvent).toHaveBeenCalledWith(
      roomCalendar.id,
      expect.objectContaining({ title: 'Room planning' }),
    );
  });

  it('preserves personal calendar selection and collection controls', async () => {
    const calendars: Calendar[] = [
      { id: 'personal', name: 'Personal calendar' },
      { id: 'shared', name: 'Shared calendar' },
    ];
    const repository = {
      listCalendars: vi.fn().mockResolvedValue(calendars),
      createCalendar: vi.fn().mockResolvedValue({
        id: 'new-calendar',
        name: 'New calendar',
      }),
    } as unknown as CalendarRepository;

    function Wrapper({ children }: PropsWithChildren) {
      return (
        <LocalizationProvider>
          <CalendarRepositoryProvider repository={repository}>
            {children}
          </CalendarRepositoryProvider>
        </LocalizationProvider>
      );
    }

    render(
      <CalendarToolbar
        filters={{
          startDate: '2026-09-25T00:00:00Z',
          endDate: '2026-09-26T00:00:00Z',
        }}
        onRangeChange={vi.fn()}
        onSearchChange={vi.fn()}
        onViewChange={vi.fn()}
        view="list"
      />,
      { wrapper: Wrapper },
    );

    expect(
      await screen.findByRole('button', { name: 'Create calendar' }),
    ).toBeEnabled();
    expect(
      screen.getByRole('button', { name: 'Rename calendar' }),
    ).toBeEnabled();
    expect(
      screen.getByRole('button', { name: 'Delete calendar' }),
    ).toBeEnabled();
    expect(
      screen.getByRole('button', { name: 'Edit calendar details' }),
    ).toBeEnabled();

    await userEvent.click(
      screen.getByRole('button', { name: 'Create calendar' }),
    );
    const createDialog = await screen.findByRole('dialog', {
      name: 'Create calendar',
    });
    await userEvent.type(
      within(createDialog).getByRole('textbox', { name: 'Calendar name' }),
      'New calendar',
    );
    await userEvent.click(
      within(createDialog).getByRole('button', { name: 'Create calendar' }),
    );
    expect(repository.createCalendar).toHaveBeenCalledWith('New calendar');
    await waitForElementToBeRemoved(createDialog);

    await userEvent.click(screen.getByRole('button', { name: 'Create event' }));
    const dialog = await screen.findByRole('dialog', { name: 'Create event' });
    const calendarSelector = within(dialog).getByRole('combobox', {
      name: 'Calendar',
    });
    expect(within(calendarSelector).getAllByRole('option')).toHaveLength(2);
  });

  it('opens the Advanced diagnostics surface for collection URLs', async () => {
    const collectionUrl = 'https://radicale.example.test/alice/team/';
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse([
          {
            id: collectionUrl,
            name: 'Team events',
            readOnly: false,
          },
        ]),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          calendars: [{ name: 'Team events', url: collectionUrl }],
        }),
      );
    const repository = new GatewayCalendarRepository({
      baseUrl: 'https://widget-api.example.test',
      roomId: '!team:example.test',
      getAuthorizationHeader: async () => 'MX-Identity delegated',
      fetchImpl,
    });

    function Wrapper({ children }: PropsWithChildren) {
      return (
        <LocalizationProvider>
          <CalendarRepositoryProvider repository={repository}>
            {children}
          </CalendarRepositoryProvider>
        </LocalizationProvider>
      );
    }

    render(
      <CalendarToolbar
        filters={{
          startDate: '2026-09-25T00:00:00Z',
          endDate: '2026-09-26T00:00:00Z',
        }}
        onRangeChange={vi.fn()}
        onSearchChange={vi.fn()}
        onViewChange={vi.fn()}
        view="list"
      />,
      { wrapper: Wrapper },
    );

    await screen.findByRole('button', {
      name: /advanced caldav diagnostics/i,
    });
    expect(screen.queryByText(collectionUrl)).not.toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('button', { name: /advanced caldav diagnostics/i }),
    );

    const dialog = await screen.findByRole('dialog', {
      name: /advanced caldav diagnostics/i,
    });
    expect(await screen.findByText(collectionUrl)).toBeInTheDocument();
    expect(within(dialog).queryByRole('link')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: /copy team events caldav url to clipboard/i,
      }),
    ).toBeInTheDocument();
  });
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
