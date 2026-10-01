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
import { CalendarColorDialog } from './CalendarColorDialog';

const writable: Calendar = {
  id: 'team',
  name: 'Team calendar',
  color: '#123456',
  readOnly: false,
};
const readOnly: Calendar = {
  id: 'readonly',
  name: 'Read only',
  color: '#abcdef',
  readOnly: true,
};
const unknownPermission: Calendar = {
  id: 'unknown-permission',
  name: 'Permission unknown',
  color: '#123456',
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

describe('<CalendarColorDialog />', () => {
  it('edits a strict color and excludes read-only or unknown calendars', async () => {
    const calendars = [writable, readOnly, unknownPermission];
    const repository = new InMemoryCalendarRepository({ calendars });
    const onClose = vi.fn();

    render(
      <CalendarColorDialog calendars={calendars} onClose={onClose} open />,
      { wrapper: createWrapper(repository) },
    );

    expect(screen.queryByRole('option', { name: 'Read only' })).toBeNull();
    expect(
      screen.queryByRole('option', { name: 'Permission unknown' }),
    ).toBeNull();

    const color = screen.getByRole('textbox', { name: 'Color' });
    expect(color).toHaveValue('#123456');
    await userEvent.clear(color);
    await userEvent.type(color, '#Ab12cD');
    await userEvent.click(screen.getByRole('button', { name: 'Save color' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    await expect(repository.listCalendars()).resolves.toEqual([
      { ...writable, color: '#Ab12cD' },
      readOnly,
      unknownPermission,
    ]);
  });

  it('does not normalize an unchanged legacy color and supports explicit clear', async () => {
    const legacy: Calendar = {
      id: 'legacy',
      name: 'Legacy color',
      color: '#12345678',
      readOnly: false,
    };
    const repository = new InMemoryCalendarRepository({ calendars: [legacy] });
    const onClose = vi.fn();

    render(
      <CalendarColorDialog calendars={[legacy]} onClose={onClose} open />,
      { wrapper: createWrapper(repository) },
    );

    const color = screen.getByRole('textbox', { name: 'Color' });
    expect(color).toHaveValue('#12345678');
    expect(screen.getByRole('button', { name: 'Save color' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Clear color' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save color' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    await expect(repository.listCalendars()).resolves.toEqual([
      { id: 'legacy', name: 'Legacy color', readOnly: false },
    ]);
  });

  it('blocks invalid new values and shows save failures', async () => {
    const repository = new InMemoryCalendarRepository({
      calendars: [writable],
    });
    vi.spyOn(repository, 'updateCalendarColor').mockRejectedValue(
      new Error('request failed'),
    );
    const onClose = vi.fn();

    render(
      <CalendarColorDialog calendars={[writable]} onClose={onClose} open />,
      { wrapper: createWrapper(repository) },
    );

    const color = screen.getByRole('textbox', { name: 'Color' });
    await userEvent.clear(color);
    await userEvent.type(color, 'red');
    expect(screen.getByRole('button', { name: 'Save color' })).toBeDisabled();
    expect(
      screen.getByText('Use a six-digit hex color in the form #RRGGBB.'),
    ).toBeInTheDocument();

    await userEvent.clear(color);
    await userEvent.type(color, '#abcdef');
    await userEvent.click(screen.getByRole('button', { name: 'Save color' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The calendar color could not be saved.',
    );
    expect(onClose).not.toHaveBeenCalled();
  });
});
