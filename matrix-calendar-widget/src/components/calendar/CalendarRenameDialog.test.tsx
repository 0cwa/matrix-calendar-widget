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
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PropsWithChildren } from 'react';
import { vi } from 'vitest';
import { CalendarRepositoryProvider } from '../../calendar';
import { CalendarRenameDialog } from './CalendarRenameDialog';

const writable: Calendar = {
  id: 'team',
  name: 'Team calendar',
  timezone: 'Europe/Stockholm',
};
const readOnly: Calendar = {
  id: 'readonly',
  name: 'Read only',
  readOnly: true,
};

function createWrapper(repository: InMemoryCalendarRepository) {
  return function Wrapper({ children }: PropsWithChildren<{}>) {
    return (
      <CalendarRepositoryProvider repository={repository}>
        {children}
      </CalendarRepositoryProvider>
    );
  };
}

describe('<CalendarRenameDialog />', () => {
  it('renames a writable calendar through CalendarRepository', async () => {
    const repository = new InMemoryCalendarRepository({
      calendars: [writable, readOnly],
    });
    const onClose = vi.fn();

    render(
      <CalendarRenameDialog
        calendars={[writable, readOnly]}
        onClose={onClose}
        open
      />,
      { wrapper: createWrapper(repository) },
    );

    expect(screen.queryByRole('option', { name: 'Read only' })).toBeNull();

    const name = screen.getByRole('textbox', { name: 'Calendar name' });
    await userEvent.clear(name);
    await userEvent.type(name, 'Product calendar');
    await userEvent.click(
      screen.getByRole('button', { name: 'Rename calendar' }),
    );

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    await expect(repository.listCalendars()).resolves.toEqual([
      {
        ...writable,
        name: 'Product calendar',
      },
      readOnly,
    ]);
  });

  it('shows a request error without closing the dialog', async () => {
    const repository = new InMemoryCalendarRepository({
      calendars: [writable],
    });
    vi.spyOn(repository, 'renameCalendar').mockRejectedValue(
      new Error('request failed'),
    );
    const onClose = vi.fn();

    render(
      <CalendarRenameDialog calendars={[writable]} onClose={onClose} open />,
      { wrapper: createWrapper(repository) },
    );

    const name = screen.getByRole('textbox', { name: 'Calendar name' });
    await userEvent.clear(name);
    await userEvent.type(name, 'Product calendar');
    await userEvent.click(
      screen.getByRole('button', { name: 'Rename calendar' }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The calendar could not be renamed.',
    );
    expect(onClose).not.toHaveBeenCalled();
  });
});
