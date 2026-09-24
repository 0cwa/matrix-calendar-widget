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
  CalendarEventId,
  CalendarEventPatch,
  CalendarId,
  CalendarRepository,
  CalendarRepositoryError,
  InMemoryCalendarRepository,
} from '@matrix-calendar-widget/calendar';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PropsWithChildren } from 'react';
import { vi } from 'vitest';
import { CalendarRepositoryProvider } from '../../calendar';
import { CalendarEventEditorDialog } from './CalendarEventEditorDialog';

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
  description: 'Original description',
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

function createWrapper(repository: CalendarRepository) {
  return function Wrapper({ children }: PropsWithChildren<{}>) {
    return (
      <CalendarRepositoryProvider repository={repository}>
        {children}
      </CalendarRepositoryProvider>
    );
  };
}

describe('<CalendarEventEditorDialog />', () => {
  it('creates an event through CalendarRepository', async () => {
    const repository = new InMemoryCalendarRepository({
      calendars: [calendar],
      idFactory: () => 'created',
    });
    const onClose = vi.fn();

    render(
      <CalendarEventEditorDialog
        calendars={[calendar]}
        onClose={onClose}
        open
        uidFactory={() => 'created@example.test'}
      />,
      { wrapper: createWrapper(repository) },
    );

    await userEvent.type(
      await screen.findByRole('textbox', { name: /Title/i }),
      'Created event',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Create event' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());

    await expect(repository.getEvent('team', 'created')).resolves.toMatchObject(
      {
        uid: 'created@example.test',
        title: 'Created event',
        calendarId: 'team',
      },
    );
  });

  it('edits an event through CalendarRepository', async () => {
    const repository = new InMemoryCalendarRepository({
      calendars: [calendar],
      events: [event],
    });
    const onSaved = vi.fn();

    render(
      <CalendarEventEditorDialog
        calendars={[calendar]}
        event={event}
        onClose={vi.fn()}
        onSaved={onSaved}
        open
      />,
      { wrapper: createWrapper(repository) },
    );

    const title = await screen.findByRole('textbox', { name: /Title/i });
    await userEvent.clear(title);
    await userEvent.type(title, 'Updated planning');
    await userEvent.clear(
      await screen.findByRole('textbox', { name: /Description/i }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());

    await expect(
      repository.getEvent('team', 'planning'),
    ).resolves.toMatchObject({
      title: 'Updated planning',
      description: undefined,
    });
  });

  it('disables saving for a read-only calendar', () => {
    const readOnlyCalendar: Calendar = {
      ...calendar,
      readOnly: true,
    };
    const repository = new InMemoryCalendarRepository({
      calendars: [readOnlyCalendar],
      events: [event],
    });

    render(
      <CalendarEventEditorDialog
        calendars={[readOnlyCalendar]}
        event={event}
        onClose={vi.fn()}
        open
      />,
      { wrapper: createWrapper(repository) },
    );

    expect(screen.getByText('This calendar is read-only.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });


  it('reloads the latest event after an ETag conflict and allows retry', async () => {
    class ConflictRepository extends InMemoryCalendarRepository {
      private conflict = true;

      override async updateEvent(
        calendarId: CalendarId,
        eventId: CalendarEventId,
        patch: CalendarEventPatch,
      ): Promise<CalendarEvent> {
        if (this.conflict) {
          this.conflict = false;
          throw new CalendarRepositoryError(
            'etag-conflict',
            'The event changed on the server',
          );
        }

        return super.updateEvent(calendarId, eventId, patch);
      }
    }

    const repository = new ConflictRepository({
      calendars: [calendar],
      events: [{ ...event, title: 'Remote planning' }],
    });
    const onSaved = vi.fn();

    render(
      <CalendarEventEditorDialog
        calendars={[calendar]}
        event={event}
        onClose={vi.fn()}
        onSaved={onSaved}
        open
      />,
      { wrapper: createWrapper(repository) },
    );

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(
      await screen.findByText(/This event changed elsewhere/i),
    ).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('button', { name: 'Reload latest' }),
    );

    const title = await screen.findByRole('textbox', { name: /Title/i });
    await waitFor(() => expect(title).toHaveValue('Remote planning'));

    await userEvent.clear(title);
    await userEvent.type(title, 'Retry planning');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(onSaved).toHaveBeenLastCalledWith(
        expect.objectContaining({ title: 'Retry planning' }),
      ),
    );
  });

  it('shows an error when an edited event no longer exists', async () => {
    const repository = new InMemoryCalendarRepository({
      calendars: [calendar],
    });

    render(
      <CalendarEventEditorDialog
        calendars={[calendar]}
        event={event}
        onClose={vi.fn()}
        open
      />,
      { wrapper: createWrapper(repository) },
    );

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(
      await screen.findByText('The event could not be saved.'),
    ).toBeInTheDocument();
  });
});
