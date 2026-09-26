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
