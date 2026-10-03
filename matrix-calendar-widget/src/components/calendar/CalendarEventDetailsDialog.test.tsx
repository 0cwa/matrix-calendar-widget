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
  CalendarEventExternalLink,
  CalendarRepositoryError,
  InMemoryCalendarRepository,
} from '@matrix-calendar-widget/calendar';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Settings } from 'luxon';
import { PropsWithChildren } from 'react';
import { vi } from 'vitest';
import { axe } from 'vitest-axe';
import {
  CalendarRepositoryProvider,
  type CalendarRoomCapabilities,
} from '../../calendar';
import {
  CalendarEventDetailsDialog,
  formatCalendarEventTime,
} from './CalendarEventDetailsDialog';

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
      type: 'zoned',
      local: '2026-09-23T09:00',
      timezone: 'Europe/Stockholm',
    },
    end: {
      type: 'zoned',
      local: '2026-09-23T10:00',
      timezone: 'Europe/Stockholm',
    },
  },
};

const floatingEvent: CalendarEvent = {
  id: 'floating',
  calendarId: 'team',
  uid: 'floating@example.test',
  title: 'Floating planning',
  timing: {
    type: 'timed',
    start: { type: 'floating', local: '2026-09-23T09:00:00' },
    end: { type: 'floating', local: '2026-09-23T10:00:00' },
  },
};

const newYorkEvent: CalendarEvent = {
  ...event,
  id: 'new-york',
  uid: 'new-york@example.test',
  title: 'New York planning',
  timing: {
    type: 'timed',
    start: {
      type: 'zoned',
      local: '2026-09-23T09:00:00',
      timezone: 'America/New_York',
    },
    end: {
      type: 'zoned',
      local: '2026-09-23T10:00:00',
      timezone: 'America/New_York',
    },
  },
};

const eventWithExternalLinks = {
  ...event,
  url: 'javascript:alert(1)',
  externalLinks: [
    {
      kind: 'event',
      href: 'HTTPS://EVENTS.EXAMPLE.TEST:443/agenda',
    },
    {
      kind: 'conference',
      href: 'https://matrix.to/#/!room:example.org',
      label: '<img src=x onerror=alert(1)>',
    },
    { kind: 'attachment', href: 'javascript:alert(2)' },
    { kind: 'attachment', href: '//files.example.test/agenda.pdf' },
    { kind: 'conference', href: 'https://user:secret@meet.example.test/' },
  ],
} satisfies CalendarEvent & {
  externalLinks: readonly CalendarEventExternalLink[];
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

function createRoomCalendarRepository(
  roomCapabilities?: CalendarRoomCapabilities,
) {
  const roomCalendar: Calendar = {
    ...calendar,
    id: 'room-calendar',
    name: 'Room calendar',
    operatorManaged: true,
  };
  const roomEvent: CalendarEvent = {
    ...event,
    id: 'room-planning',
    calendarId: roomCalendar.id,
  };
  const repository = Object.assign(
    new InMemoryCalendarRepository({
      calendars: [roomCalendar],
      events: [roomEvent],
    }),
    {
      getRoomCalendarCapabilities: vi.fn().mockResolvedValue(roomCapabilities),
      listCalendarsWithAvailability: vi.fn().mockResolvedValue({
        calendars: [roomCalendar],
        partialAvailability: false,
        canManageCalendarCollections: false,
        roomCapabilities,
      }),
      listEventsWithAvailability: vi.fn().mockResolvedValue({
        events: [roomEvent],
        diagnostics: [],
        partialAvailability: false,
      }),
    },
  );
  return { repository, roomEvent };
}

describe('<CalendarEventDetailsDialog />', () => {
  it('renders only revalidated external links as explicit safe anchors', async () => {
    const repository = new InMemoryCalendarRepository({
      calendars: [calendar],
      events: [eventWithExternalLinks],
    });
    const fetch = vi.spyOn(globalThis, 'fetch');
    const { container } = render(
      <CalendarEventDetailsDialog
        event={eventWithExternalLinks}
        onClose={vi.fn()}
      />,
      { wrapper: createWrapper(repository) },
    );

    const eventWebsite = screen.getByRole('link', { name: 'Event website' });
    const conference = screen.getByRole('link', {
      name: '<img src=x onerror=alert(1)>',
    });
    expect(eventWebsite).toHaveAttribute(
      'href',
      'https://events.example.test/agenda',
    );
    expect(conference).toHaveAttribute(
      'href',
      'https://matrix.to/#/!room:example.org',
    );
    for (const link of [eventWebsite, conference]) {
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }
    expect(screen.getAllByRole('link')).toHaveLength(2);
    expect(screen.queryByRole('img')).toBeNull();
    expect(
      screen.queryByRole('link', { name: 'Open Matrix room' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /javascript/i })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(await axe(container)).toHaveNoViolations();
    fetch.mockRestore();
  });

  it('offers the authorized current Matrix room as an explicit safe link', async () => {
    const roomId = '!authorized-room:example.test';
    const { repository, roomEvent } = createRoomCalendarRepository({
      calendarId: 'room-calendar',
      roomId,
      canReadEvents: true,
      canWriteEvents: true,
      canManageReminders: false,
    });

    render(<CalendarEventDetailsDialog event={roomEvent} onClose={vi.fn()} />, {
      wrapper: createWrapper(repository),
    });

    const roomLink = await screen.findByRole('link', {
      name: 'Open Matrix room',
    });
    expect(roomLink).toHaveAttribute(
      'href',
      'https://matrix.to/#/%21authorized-room%3Aexample.test',
    );
    expect(roomLink).toHaveAttribute('target', '_blank');
    expect(roomLink).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('links canonical domainless room IDs used by newer Matrix rooms', async () => {
    const roomId = `!${'A'.repeat(43)}`;
    const { repository, roomEvent } = createRoomCalendarRepository({
      calendarId: 'room-calendar',
      roomId,
      canReadEvents: true,
      canWriteEvents: true,
      canManageReminders: false,
    });

    render(<CalendarEventDetailsDialog event={roomEvent} onClose={vi.fn()} />, {
      wrapper: createWrapper(repository),
    });

    const roomLink = await screen.findByRole('link', {
      name: 'Open Matrix room',
    });
    expect(roomLink).toHaveAttribute(
      'href',
      `https://matrix.to/#/%21${'A'.repeat(43)}`,
    );
  });

  it.each([
    ['unknown room context', undefined],
    [
      'denied room read capability',
      {
        calendarId: 'room-calendar',
        roomId: '!denied-room:example.test',
        canReadEvents: false,
        canWriteEvents: false,
        canManageReminders: false,
      },
    ],
    [
      'malformed room ID in a stale context',
      {
        calendarId: 'room-calendar',
        roomId: 'https://example.test/room',
        canReadEvents: true,
        canWriteEvents: false,
        canManageReminders: false,
      },
    ],
  ])('does not offer a room link with %s', async (_caseName, capabilities) => {
    const { repository, roomEvent } = createRoomCalendarRepository(
      capabilities as CalendarRoomCapabilities | undefined,
    );

    render(<CalendarEventDetailsDialog event={roomEvent} onClose={vi.fn()} />, {
      wrapper: createWrapper(repository),
    });

    await waitFor(() =>
      expect(
        screen.queryByRole('link', { name: 'Open Matrix room' }),
      ).not.toBeInTheDocument(),
    );
  });

  it('edits the selected occurrence timing and keeps the series resource separate', async () => {
    const originalZone = Settings.defaultZone;
    Settings.defaultZone = 'Europe/Stockholm';

    try {
      const sourceEvent: CalendarEvent = {
        ...event,
        id: 'series-resource',
        uid: 'series@example.test',
        title: 'Weekly planning',
        recurrence: { rrule: 'FREQ=WEEKLY;INTERVAL=2;COUNT=8' },
      };
      const recurrenceId = {
        type: 'date-time' as const,
        value: {
          local: '2026-10-07T09:00:00',
          timezone: 'Europe/Stockholm',
        },
      };
      const occurrence: CalendarEvent = {
        ...sourceEvent,
        id: 'series-resource::occurrence::2026-10-07',
        timing: {
          type: 'timed',
          start: {
            type: 'zoned',
            local: '2026-10-07T09:00:00',
            timezone: 'Europe/Stockholm',
          },
          end: {
            type: 'zoned',
            local: '2026-10-07T10:00:00',
            timezone: 'Europe/Stockholm',
          },
        },
      };
      const repository = new InMemoryCalendarRepository({
        calendars: [calendar],
        events: [sourceEvent],
      });
      const onSourceEventChange = vi.fn();

      render(
        <CalendarEventDetailsDialog
          event={occurrence}
          onClose={vi.fn()}
          onSourceEventChange={onSourceEventChange}
          recurrenceId={recurrenceId}
          sourceEvent={sourceEvent}
        />,
        { wrapper: createWrapper(repository) },
      );

      await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
      await userEvent.click(
        await screen.findByRole('button', { name: 'This occurrence only' }),
      );
      fireEvent.change(screen.getByLabelText(/^Start/), {
        target: { value: '2026-10-07T11:00' },
      });
      fireEvent.change(screen.getByLabelText(/^End/), {
        target: { value: '2026-10-07T12:00' },
      });
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(async () => {
        const savedSource = await repository.getEvent('team', sourceEvent.id);
        expect(savedSource.timing).toEqual(sourceEvent.timing);
        expect(savedSource.recurrence?.overrides).toHaveLength(1);
        expect(onSourceEventChange).toHaveBeenCalledWith(savedSource);
      });

      const updatedOccurrence: CalendarEvent = {
        ...occurrence,
        timing: {
          type: 'timed',
          start: {
            type: 'zoned',
            local: '2026-10-07T11:00:00',
            timezone: 'Europe/Stockholm',
          },
          end: {
            type: 'zoned',
            local: '2026-10-07T12:00:00',
            timezone: 'Europe/Stockholm',
          },
        },
      };
      expect(
        screen.getByText(
          formatCalendarEventTime(updatedOccurrence, 'en', 'All day'),
        ),
      ).toBeInTheDocument();
    } finally {
      Settings.defaultZone = originalZone;
    }
  });

  it('reprojects the selected occurrence after reloading a conflict', async () => {
    const originalZone = Settings.defaultZone;
    Settings.defaultZone = 'Europe/Stockholm';

    try {
      const sourceEvent: CalendarEvent = {
        ...event,
        id: 'reload-series',
        uid: 'reload-series@example.test',
        title: 'Reload planning',
        recurrence: { rrule: 'FREQ=DAILY;COUNT=4' },
      };
      const recurrenceId = {
        type: 'date-time' as const,
        value: {
          local: '2026-09-24T09:00:00',
          timezone: 'Europe/Stockholm',
        },
      };
      const occurrence: CalendarEvent = {
        ...sourceEvent,
        id: 'reload-series::occurrence::2026-09-24',
        timing: {
          type: 'timed',
          start: {
            type: 'zoned',
            local: '2026-09-24T09:00:00',
            timezone: 'Europe/Stockholm',
          },
          end: {
            type: 'zoned',
            local: '2026-09-24T10:00:00',
            timezone: 'Europe/Stockholm',
          },
        },
      };
      const latestSourceEvent: CalendarEvent = {
        ...sourceEvent,
        title: 'Reload planning changed',
        timing: {
          type: 'timed',
          start: {
            type: 'zoned',
            local: '2026-09-23T09:00:00',
            timezone: 'Europe/Stockholm',
          },
          end: {
            type: 'zoned',
            local: '2026-09-23T10:30:00',
            timezone: 'Europe/Stockholm',
          },
        },
      };
      const repository = new InMemoryCalendarRepository({
        calendars: [calendar],
        events: [sourceEvent],
      });
      vi.spyOn(repository, 'updateEvent').mockRejectedValueOnce(
        new CalendarRepositoryError('event-conflict', 'Conflict'),
      );
      vi.spyOn(repository, 'getEvent').mockResolvedValueOnce(latestSourceEvent);

      render(
        <CalendarEventDetailsDialog
          event={occurrence}
          onClose={vi.fn()}
          recurrenceId={recurrenceId}
          sourceEvent={sourceEvent}
        />,
        { wrapper: createWrapper(repository) },
      );

      await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
      await userEvent.click(
        await screen.findByRole('button', { name: 'This occurrence only' }),
      );
      fireEvent.change(screen.getByLabelText(/^End/), {
        target: { value: '2026-09-24T11:00' },
      });
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));
      await userEvent.click(
        await screen.findByRole('button', { name: 'Reload latest' }),
      );

      const chooseOccurrence = await screen.findByRole('button', {
        name: 'This occurrence only',
      });
      await userEvent.click(chooseOccurrence);
      expect(screen.getByLabelText(/^End/)).toHaveValue('2026-09-24T10:30');
    } finally {
      Settings.defaultZone = originalZone;
    }
  });

  it('blocks editing when the selected occurrence disappears during reload', async () => {
    const originalZone = Settings.defaultZone;
    Settings.defaultZone = 'Europe/Stockholm';

    try {
      const sourceEvent: CalendarEvent = {
        ...event,
        id: 'removed-series',
        uid: 'removed-series@example.test',
        title: 'Removed planning',
        recurrence: { rrule: 'FREQ=DAILY;COUNT=4' },
      };
      const recurrenceId = {
        type: 'date-time' as const,
        value: {
          local: '2026-09-24T09:00:00',
          timezone: 'Europe/Stockholm',
        },
      };
      const occurrence: CalendarEvent = {
        ...sourceEvent,
        id: 'removed-series::occurrence::2026-09-24',
        timing: {
          type: 'timed',
          start: {
            type: 'zoned',
            local: '2026-09-24T09:00:00',
            timezone: 'Europe/Stockholm',
          },
          end: {
            type: 'zoned',
            local: '2026-09-24T10:00:00',
            timezone: 'Europe/Stockholm',
          },
        },
      };
      const latestSourceEvent: CalendarEvent = {
        ...sourceEvent,
        title: 'Latest removed planning',
        timing: {
          type: 'timed',
          start: {
            type: 'zoned',
            local: '2026-09-23T09:00:00',
            timezone: 'Europe/Stockholm',
          },
          end: {
            type: 'zoned',
            local: '2026-09-23T10:30:00',
            timezone: 'Europe/Stockholm',
          },
        },
        recurrence: { rrule: 'FREQ=DAILY;COUNT=1' },
      };
      const repository = new InMemoryCalendarRepository({
        calendars: [calendar],
        events: [sourceEvent],
      });
      vi.spyOn(repository, 'updateEvent').mockRejectedValueOnce(
        new CalendarRepositoryError('event-conflict', 'Conflict'),
      );
      vi.spyOn(repository, 'getEvent').mockResolvedValueOnce(latestSourceEvent);

      render(
        <CalendarEventDetailsDialog
          event={occurrence}
          onClose={vi.fn()}
          recurrenceId={recurrenceId}
          sourceEvent={sourceEvent}
        />,
        { wrapper: createWrapper(repository) },
      );

      await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
      await userEvent.click(
        await screen.findByRole('button', { name: 'This occurrence only' }),
      );
      fireEvent.change(screen.getByLabelText(/^End/), {
        target: { value: '2026-09-24T11:00' },
      });
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));
      await userEvent.click(
        await screen.findByRole('button', { name: 'Reload latest' }),
      );

      const editor = await screen.findByRole('dialog', { name: 'Edit event' });
      expect(
        await within(editor).findByText(
          'The selected occurrence is no longer available or cannot be safely projected after reload. Close the editor and select a current occurrence before editing.',
        ),
      ).toBeVisible();
      expect(screen.getByLabelText(/^End/)).toHaveValue('2026-09-24T11:00');
      expect(
        within(editor).getByRole('button', { name: 'Save' }),
      ).toBeDisabled();

      await userEvent.click(
        within(editor).getByRole('button', { name: 'Close' }),
      );
      expect(
        await screen.findByText(
          'This occurrence no longer matches the latest series. Close and select a current occurrence before editing.',
        ),
      ).toBeVisible();
      expect(
        screen.getByRole('heading', { name: 'Latest removed planning' }),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Edit' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
      expect(
        screen.queryByRole('button', { name: 'Skip this occurrence' }),
      ).toBeNull();
    } finally {
      Settings.defaultZone = originalZone;
    }
  });

  it('names the dialog after the event and has no accessibility violations', async () => {
    const repository = new InMemoryCalendarRepository({
      calendars: [calendar],
      events: [event],
    });

    render(<CalendarEventDetailsDialog event={event} onClose={vi.fn()} />, {
      wrapper: createWrapper(repository),
    });

    expect(
      screen.getByRole('dialog', { name: 'Planning' }),
    ).toBeInTheDocument();
    expect(await axe(document.body)).toHaveNoViolations();
  });

  it('formats floating detail times in the viewer local zone', () => {
    const originalZone = Settings.defaultZone;
    Settings.defaultZone = 'Europe/Stockholm';

    try {
      expect(
        formatCalendarEventTime(
          floatingEvent,
          'en',
          'All day',
          'Europe/Stockholm',
        ).replace(/\u202f/g, ' '),
      ).toBe('September 23, 2026 · 9:00 AM–10:00 AM');
    } finally {
      Settings.defaultZone = originalZone;
    }
  });

  it('formats named-zone detail times in the viewer local zone', () => {
    expect(
      formatCalendarEventTime(
        newYorkEvent,
        'en',
        'All day',
        'Europe/Stockholm',
      ).replace(/\u202f/g, ' '),
    ).toBe('September 23, 2026 · 3:00 PM–4:00 PM');
  });

  it('passes the selected occurrence and viewer zone into timing scope edits', async () => {
    const recurringEvent: CalendarEvent = {
      ...event,
      id: 'series-resource',
      uid: 'series@example.test',
      recurrence: { rrule: 'FREQ=WEEKLY;COUNT=3' },
    };
    const occurrence: CalendarEvent = {
      ...recurringEvent,
      id: 'series-resource::occurrence::2026-10-07',
      timing: {
        type: 'timed',
        start: {
          type: 'zoned',
          local: '2026-10-07T09:00:00',
          timezone: 'Europe/Stockholm',
        },
        end: {
          type: 'zoned',
          local: '2026-10-07T10:00:00',
          timezone: 'Europe/Stockholm',
        },
      },
    };
    const recurrenceId = {
      type: 'date-time' as const,
      value: {
        local: '2026-10-07T09:00:00',
        timezone: 'Europe/Stockholm',
      },
    };
    const repository = new InMemoryCalendarRepository({
      calendars: [calendar],
      events: [recurringEvent],
    });
    const updateEvent = vi.spyOn(repository, 'updateEvent');
    const onSourceEventChange = vi.fn();

    render(
      <CalendarEventDetailsDialog
        event={occurrence}
        sourceEvent={recurringEvent}
        recurrenceId={recurrenceId}
        onSourceEventChange={onSourceEventChange}
        onClose={vi.fn()}
        viewerTimezone="America/Los_Angeles"
      />,
      { wrapper: createWrapper(repository) },
    );

    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await userEvent.click(
      await screen.findByRole('button', { name: 'This and following' }),
    );
    fireEvent.change(screen.getByLabelText(/^Start/), {
      target: { value: '2026-10-07T11:00' },
    });
    fireEvent.change(screen.getByLabelText(/^End/), {
      target: { value: '2026-10-07T12:00' },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(updateEvent).toHaveBeenCalled());
    expect(updateEvent).toHaveBeenCalledWith(
      'team',
      recurringEvent.id,
      expect.objectContaining({
        recurrence: {
          following: expect.objectContaining({
            recurrenceId,
            viewerTimezone: 'America/Los_Angeles',
          }),
        },
      }),
    );
    await waitFor(() => expect(onSourceEventChange).toHaveBeenCalled());
    expect(onSourceEventChange).toHaveBeenCalledWith(
      expect.objectContaining({
        recurrence: expect.objectContaining({ overrides: expect.any(Array) }),
      }),
    );
  });

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
