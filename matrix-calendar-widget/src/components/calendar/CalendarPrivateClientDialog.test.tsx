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
  InMemoryCalendarRepository,
} from '@matrix-calendar-widget/calendar';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { useState } from 'react';
import { CalendarRepositoryProvider } from '../../calendar';
import { CalendarPrivateClientDialog } from './CalendarPrivateClientDialog';

const calendars: Calendar[] = [
  { id: 'personal-one', name: 'Personal calendar', readOnly: false },
  { id: 'personal-two', name: 'Second calendar', readOnly: false },
];

function createWrapper(repository: CalendarRepository) {
  return function Wrapper({ children }: React.PropsWithChildren) {
    return (
      <CalendarRepositoryProvider repository={repository}>
        {children}
      </CalendarRepositoryProvider>
    );
  };
}

function ControlledDialog({
  calendars: dialogCalendars = calendars,
  onClose = vi.fn(),
  onStaleClientCleanupFailed = vi.fn(),
}: {
  calendars?: Calendar[];
  onClose?: () => void;
  onStaleClientCleanupFailed?: (details: {
    calendarName: string;
    createdAt: string;
  }) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <>
      {!open && (
        <button onClick={() => setOpen(true)} type="button">
          Open app access
        </button>
      )}
      <CalendarPrivateClientDialog
        calendars={dialogCalendars}
        onClose={() => {
          onClose();
          setOpen(false);
        }}
        onStaleClientCleanupFailed={onStaleClientCleanupFailed}
        open={open}
      />
    </>
  );
}

function contextualDialog(
  repository: CalendarRepository,
  dialogCalendars: Calendar[],
  open: boolean,
  onStaleClientCleanupFailed?: (details: {
    calendarName: string;
    createdAt: string;
  }) => void,
) {
  return (
    <CalendarRepositoryProvider repository={repository}>
      <CalendarPrivateClientDialog
        calendars={dialogCalendars}
        onClose={vi.fn()}
        onStaleClientCleanupFailed={onStaleClientCleanupFailed ?? vi.fn()}
        open={open}
      />
    </CalendarRepositoryProvider>
  );
}

describe('<CalendarPrivateClientDialog />', () => {
  it('keeps the room-target calendar identity on its rendered picker option', async () => {
    const roomCalendar: Calendar = {
      id: 'matrix-calendar-target://room/element-acceptance',
      name: 'Room calendar',
      readOnly: false,
      operatorManaged: true,
    };
    const listClients = vi.fn().mockResolvedValue([]);
    const repository = Object.assign(
      new InMemoryCalendarRepository({ calendars: [roomCalendar] }),
      {
        listPrivateCalendarClients: listClients,
        createPrivateCalendarClient: vi.fn(),
        revokePrivateCalendarClient: vi.fn(),
      },
    );

    render(<ControlledDialog calendars={[roomCalendar]} />, {
      wrapper: createWrapper(repository),
    });
    expect(
      await screen.findByText(/No calendar app access has been created/),
    ).toBeInTheDocument();
    expect(listClients).toHaveBeenCalledWith(roomCalendar.id);

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Calendar' }));
    const roomCalendarOption = await screen.findByRole('option', {
      name: 'Room calendar',
      exact: true,
    });
    expect(roomCalendarOption).toHaveAttribute('data-value', roomCalendar.id);
  });

  it('closes an already-selected room calendar picker with Escape', async () => {
    const roomCalendar: Calendar = {
      id: 'matrix-calendar-target://room/element-acceptance',
      name: 'Room calendar',
      readOnly: false,
      operatorManaged: true,
    };
    const listClients = vi.fn().mockResolvedValue([]);
    const repository = Object.assign(
      new InMemoryCalendarRepository({ calendars: [roomCalendar] }),
      {
        listPrivateCalendarClients: listClients,
        createPrivateCalendarClient: vi.fn(),
        revokePrivateCalendarClient: vi.fn(),
      },
    );

    render(<ControlledDialog calendars={[roomCalendar]} />, {
      wrapper: createWrapper(repository),
    });
    expect(
      await screen.findByText(/No calendar app access has been created/),
    ).toBeInTheDocument();

    const calendarPicker = screen.getByRole('combobox', { name: 'Calendar' });
    fireEvent.mouseDown(calendarPicker);
    const targetOption = await screen.findByRole('option', {
      name: 'Room calendar',
      exact: true,
    });
    expect(targetOption).toHaveAttribute('aria-selected', 'true');

    targetOption.focus();
    expect(targetOption).toHaveFocus();
    fireEvent.keyDown(targetOption, { key: 'Escape', code: 'Escape' });

    await waitFor(() =>
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(calendarPicker).toHaveTextContent('Room calendar');
    expect(listClients).toHaveBeenCalledTimes(1);
  });

  it('shows one-time credentials only after creation and clears them on calendar switch and close', async () => {
    const firstSecret = 'first-one-time-secret-value';
    const secondSecret = 'second-one-time-secret-value';
    const firstAppId = `mcwpc~${'a'.repeat(48)}`;
    const secondAppId = `mcwpc~${'b'.repeat(48)}`;
    const listClients = vi.fn().mockResolvedValue([]);
    const createClient = vi
      .fn()
      .mockResolvedValueOnce({
        client: activeClient(firstAppId, 'personal-one'),
        secret: firstSecret,
        calendarUrl: `https://widget-api.example.test/${firstAppId}/calendar/`,
      })
      .mockResolvedValueOnce({
        client: activeClient(secondAppId, 'personal-two'),
        secret: secondSecret,
        calendarUrl: `https://widget-api.example.test/${secondAppId}/calendar/`,
      });
    const repository = Object.assign(
      new InMemoryCalendarRepository({ calendars }),
      {
        listPrivateCalendarClients: listClients,
        createPrivateCalendarClient: createClient,
        revokePrivateCalendarClient: vi.fn(),
      },
    );
    const clipboardWrite = vi.mocked(navigator.clipboard.writeText);
    clipboardWrite.mockClear();
    window.localStorage.clear();
    window.sessionStorage.clear();

    render(<ControlledDialog />, { wrapper: createWrapper(repository) });
    expect(
      await screen.findByText(/No calendar app access has been created/),
    ).toBeInTheDocument();
    expect(listClients).toHaveBeenCalledWith('personal-one');

    fireEvent.click(screen.getByRole('button', { name: 'Create app access' }));
    expect(await screen.findByDisplayValue(firstSecret)).toBeInTheDocument();
    expect(
      screen.getByDisplayValue(
        `https://widget-api.example.test/${firstAppId}/calendar/`,
      ),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue(firstAppId)).toBeInTheDocument();
    expect(clipboardWrite).not.toHaveBeenCalled();
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);

    fireEvent.click(screen.getByRole('button', { name: 'Copy password' }));
    await waitFor(() =>
      expect(clipboardWrite).toHaveBeenCalledWith(firstSecret),
    );

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Calendar' }));
    fireEvent.click(
      await screen.findByRole('option', { name: 'Second calendar' }),
    );
    await waitFor(() => {
      expect(listClients).toHaveBeenCalledWith('personal-two');
    });
    expect(screen.queryByDisplayValue(firstSecret)).not.toBeInTheDocument();

    fireEvent.click(
      await screen.findByRole('button', { name: 'Create app access' }),
    );
    expect(await screen.findByDisplayValue(secondSecret)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close', exact: true }));
    await waitFor(() =>
      expect(screen.queryByDisplayValue(secondSecret)).not.toBeInTheDocument(),
    );

    fireEvent.click(
      await screen.findByRole('button', { name: 'Open app access' }),
    );
    await waitFor(() => expect(listClients).toHaveBeenCalledTimes(3));
    expect(screen.queryByDisplayValue(secondSecret)).not.toBeInTheDocument();
  });

  it('lists own access by creation time and confirms revoke without exposing native errors', async () => {
    const appId = `mcwpc~${'c'.repeat(48)}`;
    const client = activeClient(appId, 'personal-one');
    const revokeClient = vi
      .fn()
      .mockRejectedValueOnce(new Error('native private path and credential'))
      .mockResolvedValue({ ...client, state: 'revoked', mapState: 'removed' });
    const repository = Object.assign(
      new InMemoryCalendarRepository({ calendars }),
      {
        listPrivateCalendarClients: vi.fn().mockResolvedValue([client]),
        createPrivateCalendarClient: vi.fn(),
        revokePrivateCalendarClient: revokeClient,
      },
    );

    render(<ControlledDialog />, { wrapper: createWrapper(repository) });
    expect(await screen.findByText(/^Access created /)).toBeInTheDocument();
    expect(screen.getByText(/^Expires /)).toBeInTheDocument();
    expect(screen.getByText('Status: Active')).toBeInTheDocument();
    expect(screen.queryByText(appId)).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: 'Revoke', exact: true }),
    );
    expect(
      screen.getByText(/Revoke access created .* for “Personal calendar”\?/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Revoke access' }));
    expect(
      await screen.findByText(
        'Could not revoke app access. Check your permissions and try again.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('native private path and credential'),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Revoke access' }));
    await waitFor(() => {
      expect(screen.getByText('Status: Revoked')).toBeInTheDocument();
    });
    expect(
      screen.queryByRole('button', { name: 'Revoke', exact: true }),
    ).toBeNull();
    expect(revokeClient).toHaveBeenCalledTimes(2);
  });

  it('revokes a late create through its original repository and reports nonsecret recovery if cleanup fails', async () => {
    const appId = `mcwpc~${'e'.repeat(48)}`;
    const secret = 'late-secret-that-must-not-be-shown';
    const createRequest = deferred<{
      client: ReturnType<typeof activeClient>;
      secret: string;
      calendarUrl: string;
    }>();
    const onStaleClientCleanupFailed = vi.fn();
    const listClients = vi.fn().mockResolvedValue([]);
    const createClient = vi.fn().mockReturnValue(createRequest.promise);
    const revokeClient = vi
      .fn()
      .mockRejectedValue(new Error('private URL and credential details'));
    const repository = Object.assign(
      new InMemoryCalendarRepository({ calendars }),
      {
        listPrivateCalendarClients: listClients,
        createPrivateCalendarClient: createClient,
        revokePrivateCalendarClient: revokeClient,
      },
    );

    const view = render(
      contextualDialog(
        repository,
        [calendars[0], calendars[1]],
        true,
        onStaleClientCleanupFailed,
      ),
    );
    expect(
      await screen.findByText(/No calendar app access has been created/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create app access' }));
    expect(createClient).toHaveBeenCalledWith('personal-one');

    view.rerender(
      contextualDialog(
        repository,
        [calendars[1]],
        true,
        onStaleClientCleanupFailed,
      ),
    );
    await waitFor(() => {
      expect(listClients).toHaveBeenCalledWith('personal-two');
    });

    await act(async () => {
      createRequest.resolve({
        client: activeClient(appId, 'personal-one'),
        secret,
        calendarUrl: `https://widget-api.example.test/${appId}/calendar/`,
      });
      await createRequest.promise;
    });

    await waitFor(() => expect(revokeClient).toHaveBeenCalledWith(appId));
    expect(onStaleClientCleanupFailed).toHaveBeenCalledWith(
      expect.objectContaining({ calendarName: 'Personal calendar' }),
    );
    expect(screen.queryByDisplayValue(secret)).not.toBeInTheDocument();
    expect(screen.queryByText(secret)).not.toBeInTheDocument();
    expect(screen.queryByText(appId)).not.toBeInTheDocument();
    expect(
      screen.queryByDisplayValue(
        `https://widget-api.example.test/${appId}/calendar/`,
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText('private URL and credential details'),
    ).not.toBeInTheDocument();
  });

  it('cleans up a create from the original repository after repository change and close/reopen', async () => {
    const appId = `mcwpc~${'f'.repeat(48)}`;
    const secret = 'late-reopened-secret';
    const createRequest = deferred<{
      client: ReturnType<typeof activeClient>;
      secret: string;
      calendarUrl: string;
    }>();
    const revokeOriginal = vi.fn().mockResolvedValue({
      ...activeClient(appId, 'personal-one'),
      state: 'revoked',
      mapState: 'removed',
    });
    const originalRepository = Object.assign(
      new InMemoryCalendarRepository({ calendars }),
      {
        listPrivateCalendarClients: vi.fn().mockResolvedValue([]),
        createPrivateCalendarClient: vi
          .fn()
          .mockReturnValue(createRequest.promise),
        revokePrivateCalendarClient: revokeOriginal,
      },
    );
    const revokeCurrent = vi.fn();
    const currentRepository = Object.assign(
      new InMemoryCalendarRepository({ calendars }),
      {
        listPrivateCalendarClients: vi.fn().mockResolvedValue([]),
        createPrivateCalendarClient: vi.fn(),
        revokePrivateCalendarClient: revokeCurrent,
      },
    );

    const view = render(
      contextualDialog(originalRepository, [calendars[0]], true),
    );
    expect(
      await screen.findByText(/No calendar app access has been created/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create app access' }));

    view.rerender(contextualDialog(currentRepository, [calendars[0]], false));
    view.rerender(contextualDialog(currentRepository, [calendars[0]], true));
    expect(
      await screen.findByText(/No calendar app access has been created/),
    ).toBeInTheDocument();

    await act(async () => {
      createRequest.resolve({
        client: activeClient(appId, 'personal-one'),
        secret,
        calendarUrl: `https://widget-api.example.test/${appId}/calendar/`,
      });
      await createRequest.promise;
    });

    await waitFor(() => expect(revokeOriginal).toHaveBeenCalledWith(appId));
    expect(revokeCurrent).not.toHaveBeenCalled();
    expect(screen.queryByDisplayValue(secret)).not.toBeInTheDocument();
    expect(screen.queryByText(secret)).not.toBeInTheDocument();
    expect(screen.queryByText(appId)).not.toBeInTheDocument();
  });

  it('ignores a create error returned after the dialog context changes', async () => {
    const createRequest = deferred<{
      client: ReturnType<typeof activeClient>;
      secret: string;
      calendarUrl: string;
    }>();
    const listClients = vi.fn().mockResolvedValue([]);
    const repository = Object.assign(
      new InMemoryCalendarRepository({ calendars }),
      {
        listPrivateCalendarClients: listClients,
        createPrivateCalendarClient: vi
          .fn()
          .mockReturnValue(createRequest.promise),
        revokePrivateCalendarClient: vi.fn(),
      },
    );

    const view = render(contextualDialog(repository, [calendars[0]], true));
    expect(
      await screen.findByText(/No calendar app access has been created/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create app access' }));

    view.rerender(contextualDialog(repository, [calendars[0]], false));
    view.rerender(contextualDialog(repository, [calendars[0]], true));
    expect(
      await screen.findByText(/No calendar app access has been created/),
    ).toBeInTheDocument();

    await act(async () => {
      createRequest.reject(new Error('stale private path and credential'));
      await createRequest.promise.catch(() => undefined);
    });

    expect(
      screen.queryByText(
        'Could not create app access. Check your permissions and try again.',
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText('stale private path and credential'),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/No calendar app access has been created/),
    ).toBeInTheDocument();
  });
});

function activeClient(appId: string, calendarId: string) {
  return {
    appId,
    target: { target: 'personal' as const, calendarId },
    state: 'active' as const,
    mapState: 'present' as const,
    createdAt: '2026-10-21T10:00:00.000Z',
    expiresAt: '2027-01-19T10:00:00.000Z',
  };
}

function deferred<T>() {
  let resolveDeferred!: (value: T) => void;
  let rejectDeferred!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolveDeferred = resolve;
    rejectDeferred = reject;
  });
  return { promise, resolve: resolveDeferred, reject: rejectDeferred };
}
