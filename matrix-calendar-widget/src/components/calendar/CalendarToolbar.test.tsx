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
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { PropsWithChildren } from 'react';
import { CalendarRepositoryProvider } from '../../calendar';
import { CalendarToolbar } from './CalendarToolbar';

vi.mock('../meetings/MeetingsNavigation', () => ({
  MeetingsNavigation: () => null,
}));
vi.mock('../meetings/MeetingsToolbar/MeetingsToolbarButtons', () => ({
  MeetingsToolbarButtons: () => null,
}));
vi.mock('../meetings/MeetingsToolbar/MeetingsToolbarDatePicker', () => ({
  MeetingsToolbarDatePicker: () => null,
}));
vi.mock('../meetings/MeetingsToolbar/MeetingsToolbarSearch', () => ({
  MeetingsToolbarSearch: () => null,
}));
vi.mock('./CalendarCreateDialog', () => ({ CalendarCreateDialog: () => null }));
vi.mock('./CalendarEventEditorDialog', () => ({
  CalendarEventEditorDialog: () => null,
}));
vi.mock('./CalendarRenameDialog', () => ({ CalendarRenameDialog: () => null }));

const calendars: Calendar[] = [
  { id: 'writable', name: 'Writable calendar', readOnly: false },
  { id: 'unknown', name: 'Unknown calendar' },
  { id: 'read-only', name: 'Read-only calendar', readOnly: true },
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

describe('<CalendarToolbar />', () => {
  it('opens the calendar description editor', async () => {
    const repository = new InMemoryCalendarRepository({ calendars });

    render(
      <CalendarToolbar
        filters={{
          startDate: '2026-09-01T00:00:00Z',
          endDate: '2026-10-01T00:00:00Z',
        }}
        onRangeChange={vi.fn()}
        onSearchChange={vi.fn()}
        onViewChange={vi.fn()}
        view="month"
      />,
      { wrapper: createWrapper(repository) },
    );

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Edit calendar description' }),
      ).toBeEnabled();
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Edit calendar description' }),
    );

    expect(
      await screen.findByRole('heading', { name: 'Edit calendar description' }),
    ).toBeInTheDocument();
  });

  it('offers only explicitly writable calendars for deletion', async () => {
    const repository = new InMemoryCalendarRepository({ calendars });

    render(
      <CalendarToolbar
        filters={{
          startDate: '2026-09-01T00:00:00Z',
          endDate: '2026-10-01T00:00:00Z',
        }}
        onRangeChange={vi.fn()}
        onSearchChange={vi.fn()}
        onViewChange={vi.fn()}
        view="month"
      />,
      { wrapper: createWrapper(repository) },
    );

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Delete calendar' }),
      ).toBeEnabled();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Delete calendar' }));

    const calendarSelect = screen.getByRole('combobox', { name: 'Calendar' });
    const options = within(calendarSelect).getAllByRole('option');
    expect(
      options.map((option) => (option as HTMLOptionElement).value),
    ).toEqual(['writable']);
  });
});
