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

import { InMemoryCalendarRepository } from '@matrix-calendar-widget/calendar';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PropsWithChildren } from 'react';
import { vi } from 'vitest';
import { CalendarRepositoryProvider } from '../../calendar';
import { CalendarCreateDialog } from './CalendarCreateDialog';

function createWrapper(repository: InMemoryCalendarRepository) {
  return function Wrapper({ children }: PropsWithChildren<{}>) {
    return (
      <CalendarRepositoryProvider repository={repository}>
        {children}
      </CalendarRepositoryProvider>
    );
  };
}

describe('<CalendarCreateDialog />', () => {
  it('creates a calendar through CalendarRepository', async () => {
    const repository = new InMemoryCalendarRepository({
      calendarIdFactory: () => 'project-alpha',
    });
    const onClose = vi.fn();

    render(<CalendarCreateDialog onClose={onClose} open />, {
      wrapper: createWrapper(repository),
    });

    await userEvent.type(
      screen.getByRole('textbox', { name: 'Calendar name' }),
      'Project Alpha',
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Create calendar' }),
    );

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    await expect(repository.listCalendars()).resolves.toEqual([
      { id: 'project-alpha', name: 'Project Alpha' },
    ]);
  });

  it('shows a request error without closing the dialog', async () => {
    const repository = new InMemoryCalendarRepository();
    vi.spyOn(repository, 'createCalendar').mockRejectedValue(
      new Error('request failed'),
    );
    const onClose = vi.fn();

    render(<CalendarCreateDialog onClose={onClose} open />, {
      wrapper: createWrapper(repository),
    });

    await userEvent.type(
      screen.getByRole('textbox', { name: 'Calendar name' }),
      'Project Alpha',
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Create calendar' }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The calendar could not be created.',
    );
    expect(onClose).not.toHaveBeenCalled();
  });
});
