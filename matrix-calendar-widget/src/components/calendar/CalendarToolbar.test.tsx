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
  CalendarRepository,
  CalendarRepositoryError,
  InMemoryCalendarRepository,
} from '@matrix-calendar-widget/calendar';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { PropsWithChildren, useState } from 'react';
import { CalendarRepositoryProvider } from '../../calendar';
import { CalendarToolbar } from './CalendarToolbar';

vi.mock('./CalendarNavigation', () => ({
  CalendarNavigation: () => null,
}));
vi.mock('./CalendarToolbar/CalendarToolbarButtons', () => ({
  CalendarToolbarButtons: () => null,
}));
vi.mock('./CalendarToolbar/CalendarToolbarDatePicker', () => ({
  CalendarToolbarDatePicker: () => null,
}));
vi.mock('./CalendarToolbar/CalendarToolbarSearch', () => ({
  CalendarToolbarSearch: () => null,
}));
vi.mock('./CalendarCreateDialog', () => ({ CalendarCreateDialog: () => null }));
vi.mock('./CalendarEventEditorDialog', () => ({
  CalendarEventEditorDialog: () => null,
}));
vi.mock('./CalendarRenameDialog', () => ({ CalendarRenameDialog: () => null }));

const calendars: Calendar[] = [
  { id: 'writable', name: 'Writable calendar', readOnly: false },
  { id: 'unknown', name: 'Unknown calendar' },
  { id: 'read-only', name: 'Read-only calendar', readOnly: true },
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

function ContextSwitchingToolbar({
  initialRepository,
  nextRepository,
}: {
  initialRepository: CalendarRepository;
  nextRepository: CalendarRepository;
}) {
  const [repository, setRepository] = useState(initialRepository);
  return (
    <>
      <button onClick={() => setRepository(nextRepository)} type="button">
        Switch repository context
      </button>
      <CalendarRepositoryProvider repository={repository}>
        <CalendarToolbar
          filters={{
            startDate: '2026-09-01T00:00:00Z',
            endDate: '2026-10-01T00:00:00Z',
          }}
          onRangeChange={vi.fn()}
          onSearchChange={vi.fn()}
          onViewChange={vi.fn()}
          view="month"
        />
      </CalendarRepositoryProvider>
    </>
  );
}

describe('<CalendarToolbar />', () => {
  it('loads private app access only after opening settings and explains when the server has it disabled', async () => {
    const listClients = vi
      .fn()
      .mockRejectedValue(
        new CalendarRepositoryError(
          'capability-unavailable',
          'private calendar clients disabled',
        ),
      );
    const repository = Object.assign(
      new InMemoryCalendarRepository({ calendars }),
      {
        listPrivateCalendarClients: listClients,
        createPrivateCalendarClient: vi.fn(),
        revokePrivateCalendarClient: vi.fn(),
      },
    );

    render(
      <CalendarToolbar
        filters={{
          startDate: '2026-09-01T00:00:00Z',
          endDate: '2026-10-01T00:00:00Z',
        }}
        onRangeChange={vi.fn()}
        onSearchChange={vi.fn()}
        onViewChange={vi.fn()}
        view="month"
      />,
      { wrapper: createWrapper(repository) },
    );

    expect(listClients).not.toHaveBeenCalled();
    const accessButton = screen.getByRole('button', {
      name: 'Calendar app access',
    });
    await waitFor(() => expect(accessButton).toBeEnabled());
    fireEvent.click(accessButton);
    expect(
      await screen.findByText(
        'Calendar app access is not available on this server.',
      ),
    ).toBeInTheDocument();
    expect(listClients).toHaveBeenCalledTimes(1);
    expect(listClients).toHaveBeenCalledWith('writable');
    expect(
      screen.queryByRole('button', { name: 'Create app access' }),
    ).toBeNull();
  });

  it('shows a nonsecret recovery warning when stale creation cleanup fails after a repository switch', async () => {
    const appId = `mcwpc~${'e'.repeat(48)}`;
    const secret = 'stale-secret-hidden-from-current-context';
    let resolveCreate!: (value: {
      client: {
        appId: string;
        target: { target: 'personal'; calendarId: string };
        state: 'active';
        mapState: 'present';
        createdAt: string;
        expiresAt: string;
      };
      secret: string;
      calendarUrl: string;
    }) => void;
    const createRequest = new Promise<{
      client: {
        appId: string;
        target: { target: 'personal'; calendarId: string };
        state: 'active';
        mapState: 'present';
        createdAt: string;
        expiresAt: string;
      };
      secret: string;
      calendarUrl: string;
    }>((resolve) => {
      resolveCreate = resolve;
    });
    const revokeOriginal = vi
      .fn()
      .mockRejectedValue(new Error('radicale.internal secret credential'));
    const listOriginal = vi.fn().mockResolvedValue([]);
    const originalRepository = Object.assign(
      new InMemoryCalendarRepository({ calendars }),
      {
        listPrivateCalendarClients: listOriginal,
        createPrivateCalendarClient: vi.fn().mockReturnValue(createRequest),
        revokePrivateCalendarClient: revokeOriginal,
      },
    );
    const revokeCurrent = vi.fn();
    const listCurrent = vi.fn().mockResolvedValue([]);
    const currentRepository = Object.assign(
      new InMemoryCalendarRepository({ calendars }),
      {
        listPrivateCalendarClients: listCurrent,
        createPrivateCalendarClient: vi.fn(),
        revokePrivateCalendarClient: revokeCurrent,
      },
    );

    render(
      <ContextSwitchingToolbar
        initialRepository={originalRepository}
        nextRepository={currentRepository}
      />,
    );

    fireEvent.click(
      await screen.findByRole('button', { name: 'Calendar app access' }),
    );
    expect(
      await screen.findByText(/No calendar app access has been created/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create app access' }));
    expect(listOriginal).toHaveBeenCalledWith('writable');

    fireEvent.click(
      screen.getByRole('button', {
        hidden: true,
        name: 'Switch repository context',
      }),
    );
    await waitFor(() => expect(listCurrent).toHaveBeenCalledWith('writable'));

    await act(async () => {
      resolveCreate({
        client: {
          appId,
          target: { target: 'personal', calendarId: 'writable' },
          state: 'active',
          mapState: 'present',
          createdAt: '2026-10-21T10:00:00.000Z',
          expiresAt: '2027-01-19T10:00:00.000Z',
        },
        secret,
        calendarUrl: `https://widget-api.example.test/${appId}/calendar/`,
      });
      await createRequest;
    });

    expect(
      await screen.findByText(/App access created for “Writable calendar”/),
    ).toHaveTextContent(/may still be active/);
    expect(revokeOriginal).toHaveBeenCalledWith(appId);
    expect(revokeCurrent).not.toHaveBeenCalled();
    expect(screen.queryByText(secret)).not.toBeInTheDocument();
    expect(screen.queryByText(appId)).not.toBeInTheDocument();
    expect(
      screen.queryByText('radicale.internal secret credential'),
    ).not.toBeInTheDocument();
  });

  it('requires public link consent before publishing and offers a standard subscribe URL', async () => {
    const publicUrl =
      'https://feeds.example.test/v1/public-calendar-feeds/signed-capability';
    const getPublication = vi
      .fn()
      .mockResolvedValue({ enabled: true, published: false });
    const publishPublication = vi.fn().mockResolvedValue({
      enabled: true,
      published: true,
      url: publicUrl,
    });
    const repository = Object.assign(
      new InMemoryCalendarRepository({ calendars }),
      {
        getPublicCalendarFeedPublication: getPublication,
        publishPublicCalendarFeed: publishPublication,
        unpublishPublicCalendarFeed: vi.fn(),
      },
    );

    render(
      <CalendarToolbar
        filters={{
          startDate: '2026-09-01T00:00:00Z',
          endDate: '2026-10-01T00:00:00Z',
        }}
        onRangeChange={vi.fn()}
        onSearchChange={vi.fn()}
        onViewChange={vi.fn()}
        view="month"
      />,
      { wrapper: createWrapper(repository) },
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Public feed' }));
    expect(
      await screen.findByText(/Anyone with the link can read every event/i),
    ).toBeInTheDocument();
    expect(getPublication).toHaveBeenCalledWith('writable');

    const publishButton = screen.getByRole('button', { name: 'Publish feed' });
    expect(publishButton).toBeDisabled();
    expect(publishPublication).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'I understand that anyone with the link can read this calendar.',
      }),
    );
    expect(publishButton).toBeEnabled();
    fireEvent.click(publishButton);

    const subscribeLink = await screen.findByRole('link', {
      name: 'Subscribe in a calendar app',
    });
    expect(subscribeLink).toHaveAttribute(
      'href',
      publicUrl.replace('https:', 'webcal:'),
    );
    expect(screen.getByDisplayValue(publicUrl)).toBeInTheDocument();
    expect(publishPublication).toHaveBeenCalledWith('writable', true);
  });

  it('requires consent again after selecting another calendar', async () => {
    const getPublication = vi
      .fn()
      .mockResolvedValue({ enabled: true, published: false });
    const publishPublication = vi.fn();
    const repository = Object.assign(
      new InMemoryCalendarRepository({ calendars }),
      {
        getPublicCalendarFeedPublication: getPublication,
        publishPublicCalendarFeed: publishPublication,
        unpublishPublicCalendarFeed: vi.fn(),
      },
    );

    render(
      <CalendarToolbar
        filters={{
          startDate: '2026-09-01T00:00:00Z',
          endDate: '2026-10-01T00:00:00Z',
        }}
        onRangeChange={vi.fn()}
        onSearchChange={vi.fn()}
        onViewChange={vi.fn()}
        view="month"
      />,
      { wrapper: createWrapper(repository) },
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Public feed' }));
    const confirmation = await screen.findByRole('checkbox', {
      name: 'I understand that anyone with the link can read this calendar.',
    });
    fireEvent.click(confirmation);
    expect(confirmation).toBeChecked();

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Calendar' }));
    fireEvent.click(
      await screen.findByRole('option', { name: 'Unknown calendar' }),
    );

    await waitFor(() => {
      expect(getPublication).toHaveBeenCalledWith('unknown');
    });
    expect(confirmation).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Publish feed' })).toBeDisabled();
    expect(publishPublication).not.toHaveBeenCalled();
  });

  it('can unpublish without a public URL and hides native error details', async () => {
    const unpublishPublication = vi
      .fn()
      .mockRejectedValueOnce(new Error('private native token path'))
      .mockResolvedValue({ enabled: false, published: false });
    const repository = Object.assign(
      new InMemoryCalendarRepository({ calendars }),
      {
        getPublicCalendarFeedPublication: vi
          .fn()
          .mockResolvedValue({ enabled: false, published: true }),
        publishPublicCalendarFeed: vi.fn(),
        unpublishPublicCalendarFeed: unpublishPublication,
      },
    );

    render(
      <CalendarToolbar
        filters={{
          startDate: '2026-09-01T00:00:00Z',
          endDate: '2026-10-01T00:00:00Z',
        }}
        onRangeChange={vi.fn()}
        onSearchChange={vi.fn()}
        onViewChange={vi.fn()}
        view="month"
      />,
      { wrapper: createWrapper(repository) },
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Public feed' }));
    expect(
      await screen.findByText(/server cannot provide its public URL/i),
    ).toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: 'Unpublish' }));
    expect(
      await screen.findByText(
        'Could not unpublish this calendar. Check your permissions and try again.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('private native token path'),
    ).not.toBeInTheDocument();
    expect(unpublishPublication).toHaveBeenCalledWith('writable');

    fireEvent.click(screen.getByRole('button', { name: 'Unpublish' }));
    await waitFor(() => {
      expect(unpublishPublication).toHaveBeenCalledTimes(2);
    });
    expect(
      screen.queryByText(/server cannot provide its public URL/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Unpublish' })).toBeNull();
  });

  it('allows retrying when publication settings fail to load', async () => {
    const getPublication = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ enabled: true, published: false });
    const repository = Object.assign(
      new InMemoryCalendarRepository({ calendars }),
      {
        getPublicCalendarFeedPublication: getPublication,
        publishPublicCalendarFeed: vi.fn(),
        unpublishPublicCalendarFeed: vi.fn(),
      },
    );

    render(
      <CalendarToolbar
        filters={{
          startDate: '2026-09-01T00:00:00Z',
          endDate: '2026-10-01T00:00:00Z',
        }}
        onRangeChange={vi.fn()}
        onSearchChange={vi.fn()}
        onViewChange={vi.fn()}
        view="month"
      />,
      { wrapper: createWrapper(repository) },
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Public feed' }));
    expect(
      await screen.findByText(
        'Could not load public feed settings. Check your connection and your permission to manage this calendar, then try again.',
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(
      await screen.findByRole('checkbox', {
        name: 'I understand that anyone with the link can read this calendar.',
      }),
    ).not.toBeChecked();
    expect(getPublication).toHaveBeenCalledTimes(2);
  });

  it('explains when a calendar has unsupported components and the server refuses publication', async () => {
    const mixedCalendar: Calendar = {
      id: 'mixed',
      name: 'Mixed calendar',
      readOnly: false,
      supportedComponents: ['VEVENT', 'VTODO', 'VJOURNAL'],
    };
    const repository = Object.assign(
      new InMemoryCalendarRepository({ calendars: [mixedCalendar] }),
      {
        getPublicCalendarFeedPublication: vi
          .fn()
          .mockResolvedValue({ enabled: true, published: false }),
        publishPublicCalendarFeed: vi
          .fn()
          .mockRejectedValue(
            new CalendarRepositoryError(
              'unsupported-calendar-components',
              'Public calendar feeds require a VEVENT-only calendar',
            ),
          ),
        unpublishPublicCalendarFeed: vi.fn(),
      },
    );

    render(
      <CalendarToolbar
        filters={{
          startDate: '2026-09-01T00:00:00Z',
          endDate: '2026-10-01T00:00:00Z',
        }}
        onRangeChange={vi.fn()}
        onSearchChange={vi.fn()}
        onViewChange={vi.fn()}
        view="month"
      />,
      { wrapper: createWrapper(repository) },
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Public feed' }));
    expect(
      await screen.findByText(/reports component types beyond VEVENT/i),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'I understand that anyone with the link can read this calendar.',
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Publish feed' }));

    expect(
      await screen.findByText(/server refused to publish it/i),
    ).toBeInTheDocument();
  });

  it('opens the calendar description editor', async () => {
    const repository = new InMemoryCalendarRepository({ calendars });

    render(
      <CalendarToolbar
        filters={{
          startDate: '2026-09-01T00:00:00Z',
          endDate: '2026-10-01T00:00:00Z',
        }}
        onRangeChange={vi.fn()}
        onSearchChange={vi.fn()}
        onViewChange={vi.fn()}
        view="month"
      />,
      { wrapper: createWrapper(repository) },
    );

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Edit calendar description' }),
      ).toBeEnabled();
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Edit calendar description' }),
    );

    expect(
      await screen.findByRole('heading', { name: 'Edit calendar description' }),
    ).toBeInTheDocument();
  });

  it('opens the calendar color editor', async () => {
    const repository = new InMemoryCalendarRepository({ calendars });

    render(
      <CalendarToolbar
        filters={{
          startDate: '2026-09-01T00:00:00Z',
          endDate: '2026-10-01T00:00:00Z',
        }}
        onRangeChange={vi.fn()}
        onSearchChange={vi.fn()}
        onViewChange={vi.fn()}
        view="month"
      />,
      { wrapper: createWrapper(repository) },
    );

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Edit calendar color' }),
      ).toBeEnabled();
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Edit calendar color' }),
    );

    expect(
      await screen.findByRole('heading', { name: 'Edit calendar color' }),
    ).toBeInTheDocument();
  });

  it('keeps calendar management available without exposing collection URLs', async () => {
    const internalCollectionUrl =
      'http://caldav-internal.invalid:5232/room/calendar/';
    const repository = Object.assign(
      new InMemoryCalendarRepository({ calendars }),
      {
        getCalendarDiagnostics: vi.fn().mockResolvedValue({
          calendars: [
            {
              name: 'Team calendar',
              url: internalCollectionUrl,
            },
          ],
        }),
      },
    );

    render(
      <CalendarToolbar
        filters={{
          startDate: '2026-09-01T00:00:00Z',
          endDate: '2026-10-01T00:00:00Z',
        }}
        onRangeChange={vi.fn()}
        onSearchChange={vi.fn()}
        onViewChange={vi.fn()}
        view="month"
      />,
      { wrapper: createWrapper(repository) },
    );

    expect(
      await screen.findByRole('button', { name: 'Create calendar' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'CalDAV collection URLs' }),
    ).toBeNull();
    expect(screen.queryByText(internalCollectionUrl)).toBeNull();
    expect(repository.getCalendarDiagnostics).not.toHaveBeenCalled();
  });

  it('offers only explicitly writable calendars for deletion', async () => {
    const repository = new InMemoryCalendarRepository({ calendars });

    render(
      <CalendarToolbar
        filters={{
          startDate: '2026-09-01T00:00:00Z',
          endDate: '2026-10-01T00:00:00Z',
        }}
        onRangeChange={vi.fn()}
        onSearchChange={vi.fn()}
        onViewChange={vi.fn()}
        view="month"
      />,
      { wrapper: createWrapper(repository) },
    );

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Delete calendar' }),
      ).toBeEnabled();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Delete calendar' }));

    const calendarSelect = screen.getByRole('combobox', { name: 'Calendar' });
    const options = within(calendarSelect).getAllByRole('option');
    expect(
      options.map((option) => (option as HTMLOptionElement).value),
    ).toEqual(['writable']);
  });

  it('allows room event creation but hides collection lifecycle controls', async () => {
    const roomCalendar: Calendar = {
      id: 'room-target',
      name: 'Room calendar',
      readOnly: false,
      operatorManaged: true,
      supportedComponents: ['VEVENT'],
    };
    const repository = Object.assign(
      new InMemoryCalendarRepository({ calendars: [roomCalendar] }),
      {
        getRoomCalendarCapabilities: vi.fn().mockResolvedValue({
          calendarId: 'room-target',
          canReadEvents: true,
          canWriteEvents: true,
          canManageReminders: false,
        }),
        listCalendarsWithAvailability: vi.fn().mockResolvedValue({
          calendars: [roomCalendar],
          partialAvailability: false,
          canManageCalendarCollections: false,
          roomCapabilities: {
            calendarId: 'room-target',
            canReadEvents: true,
            canWriteEvents: true,
            canManageReminders: false,
          },
        }),
        listEventsWithAvailability: vi.fn().mockResolvedValue({
          events: [],
          diagnostics: [],
          partialAvailability: false,
        }),
      },
    );

    render(
      <CalendarToolbar
        filters={{
          startDate: '2026-09-01T00:00:00Z',
          endDate: '2026-10-01T00:00:00Z',
        }}
        onRangeChange={vi.fn()}
        onSearchChange={vi.fn()}
        onViewChange={vi.fn()}
        view="month"
      />,
      { wrapper: createWrapper(repository) },
    );

    expect(
      await screen.findByRole('button', { name: 'Create event' }),
    ).toBeEnabled();
    expect(
      screen.queryByRole('button', { name: 'Create calendar' }),
    ).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Delete calendar' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Rename calendar' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Edit calendar description' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Edit calendar color' }),
    ).toBeDisabled();
  });
});
