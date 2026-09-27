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
import { CalendarDescriptionDialog } from './CalendarDescriptionDialog';

const writable: Calendar = {
  id: 'team',
  name: 'Team calendar',
  description: 'Old description',
  readOnly: false,
};
const readOnly: Calendar = {
  id: 'readonly',
  name: 'Read only',
  description: 'Preserved description',
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

describe('<CalendarDescriptionDialog />', () => {
  it('clears the selected writable calendar description when saved empty', async () => {
    const repository = new InMemoryCalendarRepository({
      calendars: [writable, readOnly],
    });
    const onClose = vi.fn();

    render(
      <CalendarDescriptionDialog
        calendars={[writable, readOnly]}
        onClose={onClose}
        open
      />,
      { wrapper: createWrapper(repository) },
    );

    expect(screen.queryByRole('option', { name: 'Read only' })).toBeNull();
    const description = screen.getByRole('textbox', { name: 'Description' });
    expect(description).toHaveValue('Old description');
    await userEvent.clear(description);
    await userEvent.click(
      screen.getByRole('button', { name: 'Save description' }),
    );

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    await expect(repository.listCalendars()).resolves.toEqual([
      { id: 'team', name: 'Team calendar', readOnly: false },
      readOnly,
    ]);
  });

  it('keeps the dialog open and shows an error when saving fails', async () => {
    const repository = new InMemoryCalendarRepository({
      calendars: [writable],
    });
    vi.spyOn(repository, 'updateCalendarDescription').mockRejectedValue(
      new Error('request failed'),
    );
    const onClose = vi.fn();

    render(
      <CalendarDescriptionDialog
        calendars={[writable]}
        onClose={onClose}
        open
      />,
      { wrapper: createWrapper(repository) },
    );

    await userEvent.click(
      screen.getByRole('button', { name: 'Save description' }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The calendar description could not be saved.',
    );
    expect(onClose).not.toHaveBeenCalled();
  });
});
