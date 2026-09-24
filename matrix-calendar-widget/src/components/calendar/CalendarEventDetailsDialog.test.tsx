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
  CalendarEvent,
  CalendarRepositoryError,
  InMemoryCalendarRepository,
} from '@matrix-calendar-widget/calendar';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PropsWithChildren } from 'react';
import { vi } from 'vitest';
import { CalendarRepositoryProvider } from '../../calendar';
import { CalendarEventDetailsDialog } from './CalendarEventDetailsDialog';

const calendar: Calendar = {
  id: 'team',
  name: 'Team calendar',
  timezone: 'Europe/Stockholm',
};

const event: CalendarEvent = {
  id: 'planning',
  calendarId: 'team',
  uid: 'planning@example.test',
  title: 'Planning',
  timing: {
    type: 'timed',
    start: {
      local: '2026-09-23T09:00',
      timezone: 'Europe/Stockholm',
    },
    end: {
      local: '2026-09-23T10:00',
      timezone: 'Europe/Stockholm',
    },
  },
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

describe('<CalendarEventDetailsDialog />', () => {
  it('deletes an event after confirmation', async () => {
    const repository = new InMemoryCalendarRepository({
      calendars: [calendar],
      events: [event],
    });
    const onClose = vi.fn();

    render(<CalendarEventDetailsDialog event={event} onClose={onClose} />, {
      wrapper: createWrapper(repository),
    });

    const deleteButton = screen.getByRole('button', { name: 'Delete' });
    await waitFor(() => expect(deleteButton).toBeEnabled());
    await userEvent.click(deleteButton);

    const confirmDialog = screen.getByRole('dialog', {
      name: 'Delete event',
    });
    await userEvent.click(
      within(confirmDialog).getByRole('button', { name: 'Delete' }),
    );

    await waitFor(() => expect(onClose).toHaveBeenCalled());

    await expect(repository.getEvent('team', 'planning')).rejects.toMatchObject(
      {
        code: 'event-not-found',
      },
    );
  });

  it('reloads a stale event and allows delete retry after a conflict', async () => {
    const repository = new InMemoryCalendarRepository({
      calendars: [calendar],
      events: [event],
    });
    const latestEvent: CalendarEvent = {
      ...event,
      title: 'Planning changed elsewhere',
    };
    vi.spyOn(repository, 'deleteEvent').mockRejectedValueOnce(
      new CalendarRepositoryError(
        'event-conflict',
        'The event changed on the server',
      ),
    );
    vi.spyOn(repository, 'getEvent').mockResolvedValueOnce(latestEvent);
    const onClose = vi.fn();

    render(<CalendarEventDetailsDialog event={event} onClose={onClose} />, {
      wrapper: createWrapper(repository),
    });

    const deleteButton = screen.getByRole('button', { name: 'Delete' });
    await waitFor(() => expect(deleteButton).toBeEnabled());
    await userEvent.click(deleteButton);

    const confirmDialog = screen.getByRole('dialog', {
      name: 'Delete event',
    });
    const confirmDelete = within(confirmDialog).getByRole('button', {
      name: 'Delete',
    });
    await userEvent.click(confirmDelete);

    expect(
      await within(confirmDialog).findByText(
        'This event changed elsewhere. The latest version was reloaded; review it and retry if you still want to delete it.',
      ),
    ).toBeInTheDocument();

    await userEvent.click(confirmDelete);
    await waitFor(() => expect(onClose).toHaveBeenCalled());

    expect(repository.deleteEvent).toHaveBeenCalledTimes(2);
  });

  it('disables edit and delete for a read-only calendar', async () => {
    const readOnlyCalendar: Calendar = {
      ...calendar,
      readOnly: true,
    };
    const repository = new InMemoryCalendarRepository({
      calendars: [readOnlyCalendar],
      events: [event],
    });

    render(<CalendarEventDetailsDialog event={event} onClose={vi.fn()} />, {
      wrapper: createWrapper(repository),
    });

    expect(
      await screen.findByText('This calendar is read-only.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
  });
});
