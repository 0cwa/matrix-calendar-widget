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
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
}: {
  calendars?: Calendar[];
  onClose?: () => void;
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
        open={open}
      />
    </>
  );
}

describe('<CalendarPrivateClientDialog />', () => {
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
