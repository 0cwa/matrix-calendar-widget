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
import { CalendarDeleteDialog } from './CalendarDeleteDialog';

const calendar: Calendar = {
  id: 'team',
  name: 'Team calendar',
  timezone: 'Europe/Stockholm',
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

describe('<CalendarDeleteDialog />', () => {
  it('names the calendar and deletes it after explicit confirmation', async () => {
    const repository = new InMemoryCalendarRepository({
      calendars: [calendar],
    });
    const onClose = vi.fn();

    render(
      <CalendarDeleteDialog calendars={[calendar]} onClose={onClose} open />,
      { wrapper: createWrapper(repository) },
    );

    expect(
      screen.getByText(/Delete “Team calendar” and all of its events/),
    ).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('button', { name: 'Delete calendar' }),
    );

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    await expect(repository.listCalendars()).resolves.toEqual([]);
  });

  it('shows a request error without closing the dialog', async () => {
    const repository = new InMemoryCalendarRepository({
      calendars: [calendar],
    });
    vi.spyOn(repository, 'deleteCalendar').mockRejectedValue(
      new Error('unsafe collection'),
    );
    const onClose = vi.fn();

    render(
      <CalendarDeleteDialog calendars={[calendar]} onClose={onClose} open />,
      { wrapper: createWrapper(repository) },
    );

    await userEvent.click(
      screen.getByRole('button', { name: 'Delete calendar' }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The calendar could not be deleted.',
    );
    expect(onClose).not.toHaveBeenCalled();
  });
});
