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
  InMemoryCalendarRepository,
} from '@matrix-calendar-widget/calendar';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PropsWithChildren } from 'react';
import { vi } from 'vitest';
import { CalendarRepositoryProvider } from '../../calendar';
import { CalendarDiagnosticsDialog } from './CalendarDiagnosticsDialog';

const calendars: Calendar[] = [
  { id: 'team', name: 'Team calendar', readOnly: false },
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

describe('<CalendarDiagnosticsDialog />', () => {
  it('renders collection URLs as text and never as navigation links', async () => {
    const repository = Object.assign(
      new InMemoryCalendarRepository({ calendars }),
      {
        getCalendarDiagnostics: vi.fn().mockResolvedValue({
          calendars: [
            {
              name: 'Team collection',
              url: 'https://radicale.example.test/alice/team/',
            },
          ],
        }),
      },
    );

    render(<CalendarDiagnosticsDialog onClose={vi.fn()} open />, {
      wrapper: createWrapper(repository),
    });

    expect(await screen.findByText('Team collection')).toBeInTheDocument();
    expect(
      screen.getByText('https://radicale.example.test/alice/team/'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Copy URL' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('shows a generic error without exposing gateway failure details', async () => {
    const repository = Object.assign(
      new InMemoryCalendarRepository({ calendars }),
      {
        getCalendarDiagnostics: vi
          .fn()
          .mockRejectedValue(
            new Error('https://radicale.example.test/alice?token=secret'),
          ),
      },
    );

    render(<CalendarDiagnosticsDialog onClose={vi.fn()} open />, {
      wrapper: createWrapper(repository),
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'CalDAV diagnostics are unavailable for this room.',
    );
    expect(screen.queryByText(/token=secret/)).toBeNull();
  });

  it('announces when the browser rejects a collection URL copy', async () => {
    const repository = Object.assign(
      new InMemoryCalendarRepository({ calendars }),
      {
        getCalendarDiagnostics: vi.fn().mockResolvedValue({
          calendars: [
            {
              name: 'Team collection',
              url: 'https://radicale.example.test/alice/team/',
            },
          ],
        }),
      },
    );
    const writeText = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockRejectedValueOnce(new Error('Clipboard unavailable'));

    render(<CalendarDiagnosticsDialog onClose={vi.fn()} open />, {
      wrapper: createWrapper(repository),
    });
    await userEvent.click(
      await screen.findByRole('button', { name: 'Copy URL' }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The collection URL could not be copied. Check clipboard permissions and try again.',
    );
    expect(screen.queryByText('Copied')).toBeNull();
    writeText.mockRestore();
  });

  it('fails closed when the repository does not support diagnostics', async () => {
    const repository = new InMemoryCalendarRepository({ calendars });

    render(<CalendarDiagnosticsDialog onClose={vi.fn()} open />, {
      wrapper: createWrapper(repository),
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'CalDAV diagnostics are unavailable for this room.',
    );
  });
});
