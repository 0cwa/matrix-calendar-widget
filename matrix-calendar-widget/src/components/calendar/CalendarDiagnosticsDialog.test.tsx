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

import { render, screen, within } from '@testing-library/react';
import { expect, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { CalendarDiagnosticsDialog } from './CalendarDiagnosticsDialog';

describe('<CalendarDiagnosticsDialog/>', () => {
  it('renders collection URLs as copyable text without navigation links', async () => {
    const url = 'https://radicale.example.test/alice/team/';
    const repository = {
      getCalendarDiagnostics: vi.fn().mockResolvedValue([
        {
          name: 'Team events',
          url,
        },
      ]),
    };

    render(
      <CalendarDiagnosticsDialog
        onClose={vi.fn()}
        open
        repository={repository}
      />,
    );

    const dialog = await screen.findByRole('dialog', {
      name: /advanced caldav diagnostics/i,
    });
    expect(await screen.findByText(url)).toBeInTheDocument();
    expect(within(dialog).queryByRole('link')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: /copy team events caldav url to clipboard/i,
      }),
    ).toBeInTheDocument();
    expect(repository.getCalendarDiagnostics).toHaveBeenCalledOnce();
    expect(await axe(dialog)).toHaveNoViolations();
  });

  it('does not show gateway error details when diagnostics access fails', async () => {
    const repository = {
      getCalendarDiagnostics: vi
        .fn()
        .mockRejectedValue(new Error('https://secret.example/token=abc')),
    };

    render(
      <CalendarDiagnosticsDialog
        onClose={vi.fn()}
        open
        repository={repository}
      />,
    );

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/manager permission may be required/i);
    expect(alert).not.toHaveTextContent('secret.example');
  });
});
