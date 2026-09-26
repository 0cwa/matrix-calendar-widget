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
import { CalendarMetadataDialog } from './CalendarMetadataDialog';

function createWrapper(repository: InMemoryCalendarRepository) {
  return function Wrapper({ children }: PropsWithChildren<{}>) {
    return (
      <CalendarRepositoryProvider repository={repository}>
        {children}
      </CalendarRepositoryProvider>
    );
  };
}

describe('<CalendarMetadataDialog />', () => {
  it('saves description and color through CalendarRepository', async () => {
    const repository = new InMemoryCalendarRepository({
      calendars: [{ id: 'team', name: 'Team calendar' }],
    });
    const onClose = vi.fn();

    render(
      <CalendarMetadataDialog
        calendars={[{ id: 'team', name: 'Team calendar' }]}
        onClose={onClose}
        open
      />,
      { wrapper: createWrapper(repository) },
    );

    await userEvent.type(
      screen.getByRole('textbox', { name: 'Description' }),
      'Planning & reviews',
    );
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Color' }),
      '#336699ff',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save details' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    await expect(repository.listCalendars()).resolves.toEqual([
      {
        id: 'team',
        name: 'Team calendar',
        description: 'Planning & reviews',
        color: '#336699ff',
      },
    ]);
  });

  it('shows a failed save and leaves the dialog open', async () => {
    const repository = new InMemoryCalendarRepository({
      calendars: [{ id: 'team', name: 'Team calendar' }],
    });
    vi.spyOn(repository, 'updateCalendarMetadata').mockRejectedValue(
      new Error('request failed'),
    );
    const onClose = vi.fn();

    render(
      <CalendarMetadataDialog
        calendars={[{ id: 'team', name: 'Team calendar' }]}
        onClose={onClose}
        open
      />,
      { wrapper: createWrapper(repository) },
    );

    await userEvent.type(
      screen.getByRole('textbox', { name: 'Description' }),
      'Planning',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save details' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Calendar details could not be saved.',
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it('clears description and color when their fields are left blank', async () => {
    const repository = new InMemoryCalendarRepository({
      calendars: [
        {
          id: 'team',
          name: 'Team calendar',
          description: 'Planning',
          color: '#336699',
        },
      ],
    });
    const onClose = vi.fn();

    render(
      <CalendarMetadataDialog
        calendars={[
          {
            id: 'team',
            name: 'Team calendar',
            description: 'Planning',
            color: '#336699',
          },
        ]}
        onClose={onClose}
        open
      />,
      { wrapper: createWrapper(repository) },
    );

    await userEvent.clear(screen.getByRole('textbox', { name: 'Description' }));
    await userEvent.clear(screen.getByRole('textbox', { name: 'Color' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save details' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    await expect(repository.listCalendars()).resolves.toEqual([
      { id: 'team', name: 'Team calendar' },
    ]);
  });

  it('allows a description-only save when the existing color is not hex', async () => {
    const repository = new InMemoryCalendarRepository({
      calendars: [{ id: 'team', name: 'Team calendar', color: 'red' }],
    });
    const onClose = vi.fn();

    render(
      <CalendarMetadataDialog
        calendars={[{ id: 'team', name: 'Team calendar', color: 'red' }]}
        onClose={onClose}
        open
      />,
      { wrapper: createWrapper(repository) },
    );

    await userEvent.type(
      screen.getByRole('textbox', { name: 'Description' }),
      'Planning',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save details' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    await expect(repository.listCalendars()).resolves.toEqual([
      {
        id: 'team',
        name: 'Team calendar',
        description: 'Planning',
        color: 'red',
      },
    ]);
  });

  it('preserves an unchanged eight-digit color on description save', async () => {
    const repository = new InMemoryCalendarRepository({
      calendars: [{ id: 'team', name: 'Team calendar', color: '#336699ff' }],
    });
    const onClose = vi.fn();

    render(
      <CalendarMetadataDialog
        calendars={[{ id: 'team', name: 'Team calendar', color: '#336699ff' }]}
        onClose={onClose}
        open
      />,
      { wrapper: createWrapper(repository) },
    );

    expect(screen.getByRole('textbox', { name: 'Color' })).toHaveValue(
      '#336699ff',
    );
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Description' }),
      'Planning',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save details' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    await expect(repository.listCalendars()).resolves.toEqual([
      {
        id: 'team',
        name: 'Team calendar',
        description: 'Planning',
        color: '#336699ff',
      },
    ]);
  });

  it('rejects a changed color that is not hex', async () => {
    const repository = new InMemoryCalendarRepository({
      calendars: [{ id: 'team', name: 'Team calendar' }],
    });
    const updateMetadata = vi.spyOn(repository, 'updateCalendarMetadata');

    render(
      <CalendarMetadataDialog
        calendars={[{ id: 'team', name: 'Team calendar' }]}
        onClose={vi.fn()}
        open
      />,
      { wrapper: createWrapper(repository) },
    );

    await userEvent.type(
      screen.getByRole('textbox', { name: 'Color' }),
      'blue',
    );

    expect(screen.getByRole('button', { name: 'Save details' })).toBeDisabled();
    expect(updateMetadata).not.toHaveBeenCalled();
  });
});
