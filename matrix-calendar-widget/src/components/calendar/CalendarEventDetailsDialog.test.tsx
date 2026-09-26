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
  CalendarEventOccurrence,
  CalendarRepositoryError,
  InMemoryCalendarRepository,
} from '@matrix-calendar-widget/calendar';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PropsWithChildren } from 'react';
import { vi } from 'vitest';
import {
  CalendarEventPresentation,
  CalendarRepositoryProvider,
} from '../../calendar';
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

const eventPresentation: CalendarEventPresentation = {
  key: 'team:planning',
  event,
  resourceEvent: event,
  rangeTimezone: 'Europe/Stockholm',
  viewerTimezone: 'Europe/Stockholm',
};

const recurringResource: CalendarEvent = {
  ...event,
  recurrence: { rrule: 'FREQ=DAILY;COUNT=3' },
};
const recurrenceId = {
  type: 'date-time' as const,
  value: {
    local: '2026-09-24T09:00:00',
    timezone: 'Europe/Stockholm',
    mode: 'tzid' as const,
  },
};
const recurringOccurrence: CalendarEventOccurrence = {
  ...event,
  recurrenceId,
  timing: {
    type: 'timed',
    start: {
      local: '2026-09-24T09:00:00',
      timezone: 'Europe/Stockholm',
      mode: 'tzid',
    },
    end: {
      local: '2026-09-24T10:00:00',
      timezone: 'Europe/Stockholm',
      mode: 'tzid',
    },
  },
};
const occurrencePresentation: CalendarEventPresentation = {
  key: 'team:planning:occurrence:one',
  event: recurringOccurrence,
  resourceEvent: recurringResource,
  rangeTimezone: 'Europe/Stockholm',
  viewerTimezone: 'Europe/Stockholm',
  recurrenceId,
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
  it('formats floating detail times in the viewer-local timezone', async () => {
    const floatingEvent: CalendarEvent = {
      ...event,
      timing: {
        type: 'timed',
        start: {
          local: '2026-09-23T09:00:00',
          timezone: 'floating',
          mode: 'floating',
        },
        end: {
          local: '2026-09-23T10:00:00',
          timezone: 'floating',
          mode: 'floating',
        },
      },
    };
    const repository = new InMemoryCalendarRepository({
      calendars: [calendar],
      events: [floatingEvent],
    });

    render(
      <CalendarEventDetailsDialog
        event={{
          ...eventPresentation,
          event: floatingEvent,
          resourceEvent: floatingEvent,
          rangeTimezone: 'America/Los_Angeles',
          viewerTimezone: 'America/Los_Angeles',
        }}
        onClose={vi.fn()}
      />,
      { wrapper: createWrapper(repository) },
    );

    expect(await screen.findByText(/9:00 AM–10:00 AM/)).toBeInTheDocument();
    expect(screen.queryByText(/Invalid DateTime/)).toBeNull();
  });

  it('deletes an event after confirmation', async () => {
    const repository = new InMemoryCalendarRepository({
      calendars: [calendar],
      events: [event],
    });
    const onClose = vi.fn();

    render(
      <CalendarEventDetailsDialog
        event={eventPresentation}
        onClose={onClose}
      />,
      {
        wrapper: createWrapper(repository),
      },
    );

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

    render(
      <CalendarEventDetailsDialog
        event={eventPresentation}
        onClose={onClose}
      />,
      {
        wrapper: createWrapper(repository),
      },
    );

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

    render(
      <CalendarEventDetailsDialog
        event={eventPresentation}
        onClose={vi.fn()}
      />,
      { wrapper: createWrapper(repository) },
    );

    expect(
      await screen.findByText('This calendar is read-only.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
  });

  it('edits one occurrence using the original recurrence identity', async () => {
    const repository = new InMemoryCalendarRepository({
      calendars: [calendar],
      events: [recurringResource],
    });
    const deleteSpy = vi.spyOn(repository, 'deleteEvent');
    const updateSpy = vi.spyOn(repository, 'updateEvent');
    const updateOccurrenceSpy = vi.spyOn(repository, 'updateOccurrence');

    render(
      <CalendarEventDetailsDialog
        event={occurrencePresentation}
        onClose={vi.fn()}
      />,
      { wrapper: createWrapper(repository) },
    );

    await userEvent.click(
      await screen.findByRole('button', { name: 'Edit this event' }),
    );
    const editor = await screen.findByRole('dialog', { name: 'Edit event' });
    expect(within(editor).queryByText('Repeat')).toBeNull();
    expect(within(editor).getByLabelText('All day')).toBeDisabled();
    await userEvent.clear(within(editor).getByLabelText(/Title/));
    await userEvent.type(
      within(editor).getByLabelText(/Title/),
      'One moved event',
    );
    await userEvent.click(within(editor).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(updateOccurrenceSpy).toHaveBeenCalledWith(
        'team',
        'planning',
        recurrenceId,
        expect.objectContaining({ title: 'One moved event' }),
      );
    });
    expect(updateSpy).not.toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'Edit event' })).toBeNull();
  });

  it('cancels one occurrence without resource-wide mutation', async () => {
    const repository = new InMemoryCalendarRepository({
      calendars: [calendar],
      events: [recurringResource],
    });
    const cancelSpy = vi.spyOn(repository, 'cancelOccurrence');
    const updateSpy = vi.spyOn(repository, 'updateEvent');
    const deleteSpy = vi.spyOn(repository, 'deleteEvent');

    render(
      <CalendarEventDetailsDialog
        event={occurrencePresentation}
        onClose={vi.fn()}
      />,
      { wrapper: createWrapper(repository) },
    );

    await userEvent.click(
      await screen.findByRole('button', { name: 'Cancel this event' }),
    );
    const confirmation = await screen.findByRole('dialog', {
      name: 'Cancel recurring occurrence',
    });
    expect(
      within(confirmation).getByText(
        'Cancel only this occurrence of “Planning”? The series and other occurrences will remain.',
      ),
    ).toBeInTheDocument();
    await userEvent.click(
      within(confirmation).getByRole('button', {
        name: 'Cancel this event',
      }),
    );

    await waitFor(() => {
      expect(cancelSpy).toHaveBeenCalledWith('team', 'planning', recurrenceId);
    });
    expect(updateSpy).not.toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: 'Cancel recurring occurrence' }),
      ).toBeNull();
    });
  });

  it('locks stale occurrence edits after a resource conflict', async () => {
    const repository = new InMemoryCalendarRepository({
      calendars: [calendar],
      events: [recurringResource],
    });
    const updateOccurrenceSpy = vi
      .spyOn(repository, 'updateOccurrence')
      .mockRejectedValue(
        new CalendarRepositoryError(
          'event-conflict',
          'The event changed on the server',
        ),
      );
    const updateSpy = vi.spyOn(repository, 'updateEvent');
    const deleteSpy = vi.spyOn(repository, 'deleteEvent');

    render(
      <CalendarEventDetailsDialog
        event={occurrencePresentation}
        onClose={vi.fn()}
      />,
      { wrapper: createWrapper(repository) },
    );

    await userEvent.click(
      await screen.findByRole('button', { name: 'Edit this event' }),
    );
    const editor = await screen.findByRole('dialog', { name: 'Edit event' });
    await userEvent.clear(within(editor).getByLabelText(/Title/));
    await userEvent.type(within(editor).getByLabelText(/Title/), 'Stale edit');
    await userEvent.click(within(editor).getByRole('button', { name: 'Save' }));

    expect(
      await within(editor).findByText(
        'This series changed elsewhere. Close and reopen this occurrence to load the latest version before editing again.',
      ),
    ).toBeInTheDocument();
    expect(within(editor).getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(updateOccurrenceSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy).not.toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it('closes and blocks cancellation retry after a resource conflict', async () => {
    const repository = new InMemoryCalendarRepository({
      calendars: [calendar],
      events: [recurringResource],
    });
    const cancelSpy = vi
      .spyOn(repository, 'cancelOccurrence')
      .mockRejectedValue(
        new CalendarRepositoryError(
          'event-conflict',
          'The event changed on the server',
        ),
      );
    const updateSpy = vi.spyOn(repository, 'updateEvent');
    const deleteSpy = vi.spyOn(repository, 'deleteEvent');

    render(
      <CalendarEventDetailsDialog
        event={occurrencePresentation}
        onClose={vi.fn()}
      />,
      { wrapper: createWrapper(repository) },
    );

    await userEvent.click(
      await screen.findByRole('button', { name: 'Cancel this event' }),
    );
    const confirmation = await screen.findByRole('dialog', {
      name: 'Cancel recurring occurrence',
    });
    await userEvent.click(
      within(confirmation).getByRole('button', {
        name: 'Cancel this event',
      }),
    );

    expect(
      await screen.findByText(
        'This series changed elsewhere. Close and reopen this occurrence before trying again.',
      ),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: 'Cancel recurring occurrence' }),
      ).toBeNull();
    });
    const details = screen.getByRole('dialog', { name: 'Planning' });
    expect(
      within(details).getByRole('button', { name: 'Cancel this event' }),
    ).toBeDisabled();
    expect(cancelSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy).not.toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();
  });
});
