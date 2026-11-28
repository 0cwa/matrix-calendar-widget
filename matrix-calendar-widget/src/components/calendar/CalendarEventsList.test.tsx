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
  InMemoryCalendarRepository,
} from '@matrix-calendar-widget/calendar';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { Settings } from 'luxon';
import { PropsWithChildren, useState } from 'react';
import { vi } from 'vitest';
import { axe } from 'vitest-axe';
import { CalendarRepositoryProvider } from '../../calendar';
import { mockDateTimeFormatTimeZone } from '../../testing';
import { CalendarEventDetailsDialog } from './CalendarEventDetailsDialog';
import { CalendarEventsList } from './CalendarEventsList';

const calendar: Calendar = {
  id: 'team',
  name: 'Team calendar',
};

const event: CalendarEvent = {
  id: 'planning',
  calendarId: 'team',
  uid: 'planning@example.test',
  title: 'Team planning',
  location: 'Room 3',
  timing: {
    type: 'timed',
    start: {
      type: 'zoned',
      local: '2026-09-23T09:00:00',
      timezone: 'Europe/Stockholm',
    },
    end: {
      type: 'zoned',
      local: '2026-09-23T10:00:00',
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

function createWrapper(repository: InMemoryCalendarRepository) {
  return function Wrapper({ children }: PropsWithChildren<{}>) {
    return (
      <CalendarRepositoryProvider repository={repository}>
        {children}
      </CalendarRepositoryProvider>
    );
  };
}

function EventDetailsHarness() {
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent>();

  return (
    <>
      <CalendarEventsList
        events={[event]}
        onSelectEvent={(selected) => setSelectedEvent(selected)}
      />
      <CalendarEventDetailsDialog
        event={selectedEvent}
        onClose={() => setSelectedEvent(undefined)}
      />
    </>
  );
}

describe('<CalendarEventsList />', () => {
  it('shows floating times in the viewer local zone', () => {
    const originalZone = Settings.defaultZone;
    Settings.defaultZone = 'Europe/Stockholm';

    try {
      render(
        <CalendarEventsList events={[floatingEvent]} onSelectEvent={vi.fn()} />,
      );

      expect(
        screen.getByText('September 23, 2026 · 9:00 AM–10:00 AM'),
      ).toBeInTheDocument();
    } finally {
      Settings.defaultZone = originalZone;
    }
  });

  it('leaves the date to the day heading but keeps it in the accessible name', () => {
    const originalZone = Settings.defaultZone;
    Settings.defaultZone = 'Europe/Stockholm';

    try {
      render(<CalendarEventsList events={[event]} onSelectEvent={vi.fn()} />);

      expect(
        screen.getByRole('heading', { name: 'Wednesday, September 23, 2026' }),
      ).toBeInTheDocument();
      expect(screen.getByText(/^9:00\sAM–10:00\sAM$/)).toHaveAttribute(
        'aria-hidden',
        'true',
      );
      expect(
        screen.getByRole('button', {
          name: /Team planning.*September 23, 2026 · 9:00\sAM–10:00\sAM.*Room 3/,
        }),
      ).toBeInTheDocument();
    } finally {
      Settings.defaultZone = originalZone;
    }
  });

  it('shows only "All day" for a single all-day event', () => {
    render(
      <CalendarEventsList
        events={[
          {
            ...event,
            timing: {
              type: 'all-day',
              startDate: '2026-09-23',
              endDate: '2026-09-24',
            },
          },
        ]}
        onSelectEvent={vi.fn()}
      />,
    );

    expect(screen.getByText('All day')).toHaveAttribute('aria-hidden', 'true');
    expect(
      screen.getByText('September 23, 2026 · All day'),
    ).toBeInTheDocument();
  });

  it.each<[string, CalendarEvent['timing'], RegExp]>([
    [
      'an all-day event spans several days',
      { type: 'all-day', startDate: '2026-09-23', endDate: '2026-09-26' },
      /^September 23, 2026 – September 25, 2026 · All day$/,
    ],
    [
      'a timed event ends on another day',
      {
        type: 'timed',
        start: { type: 'floating', local: '2026-09-23T23:00:00' },
        end: { type: 'floating', local: '2026-09-24T01:00:00' },
      },
      /^Sep 23, 2026, 11:00\sPM – Sep 24, 2026, 1:00\sAM$/,
    ],
    [
      "the date differs in the event's own time zone",
      {
        type: 'timed',
        start: {
          type: 'zoned',
          local: '2026-09-22T20:00:00',
          timezone: 'America/New_York',
        },
        end: {
          type: 'zoned',
          local: '2026-09-22T21:00:00',
          timezone: 'America/New_York',
        },
      },
      /^September 23, 2026 · 2:00\sAM–3:00\sAM$/,
    ],
  ])('keeps the visible date if %s', (_, timing, text) => {
    const originalZone = Settings.defaultZone;
    Settings.defaultZone = 'Europe/Stockholm';

    try {
      render(
        <CalendarEventsList
          events={[{ ...event, timing }]}
          onSelectEvent={vi.fn()}
        />,
      );

      expect(screen.getByText(text)).not.toHaveAttribute('aria-hidden');
    } finally {
      Settings.defaultZone = originalZone;
    }
  });

  it('heads a day with its own date for viewers west of UTC', async () => {
    const originalZone = Settings.defaultZone;
    Settings.defaultZone = 'America/New_York';
    mockDateTimeFormatTimeZone('America/New_York');
    // i18next caches formatters per language, so use one that no other test in
    // this file has formatted with another default time zone.
    await i18next.changeLanguage('de');

    try {
      render(
        <CalendarEventsList events={[floatingEvent]} onSelectEvent={vi.fn()} />,
      );

      expect(
        screen.getByRole('heading', { name: 'Mittwoch, 23. September 2026' }),
      ).toBeInTheDocument();
    } finally {
      Settings.defaultZone = originalZone;
      await i18next.changeLanguage('en');
    }
  });

  it('names the calendar next to its configured color', () => {
    render(
      <CalendarEventsList
        calendars={[{ ...calendar, color: '#4177d5ff' }]}
        events={[event]}
        onSelectEvent={vi.fn()}
      />,
    );

    expect(
      screen.getByRole('button', { name: /Team planning.*Team calendar/ }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('calendar-color-dot')).toHaveStyle({
      backgroundColor: '#4177d5',
    });
  });

  it('names calendars without a color only when there are several', () => {
    const { rerender } = render(
      <CalendarEventsList
        calendars={[calendar]}
        events={[event]}
        onSelectEvent={vi.fn()}
      />,
    );

    expect(screen.queryByText('Team calendar')).not.toBeInTheDocument();

    rerender(
      <CalendarEventsList
        calendars={[calendar, { id: 'other', name: 'Other calendar' }]}
        events={[event]}
        onSelectEvent={vi.fn()}
      />,
    );

    expect(screen.getByText('Team calendar')).toBeInTheDocument();
    expect(screen.queryByTestId('calendar-color-dot')).not.toBeInTheDocument();
  });

  it('renders domain events and selects them without a Meeting adapter', async () => {
    const onSelectEvent = vi.fn();
    render(
      <CalendarEventsList events={[event]} onSelectEvent={onSelectEvent} />,
    );

    expect(screen.getByText('Team planning')).toBeInTheDocument();
    expect(screen.getByText('Room 3')).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('button', { name: /Team planning/i }),
    );

    expect(onSelectEvent).toHaveBeenCalledWith(event);
  });

  it('renders an empty state', () => {
    render(<CalendarEventsList events={[]} onSelectEvent={vi.fn()} />);

    expect(
      screen.getByText('No events scheduled that match the selected filters.'),
    ).toBeInTheDocument();
  });

  it('opens event details with Enter and restores focus after Escape', async () => {
    const repository = new InMemoryCalendarRepository({
      calendars: [calendar],
      events: [event],
    });

    render(<EventDetailsHarness />, {
      wrapper: createWrapper(repository),
    });

    const eventAction = screen.getByRole('button', { name: /Team planning/i });
    await userEvent.tab();
    expect(eventAction).toHaveFocus();

    await userEvent.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog', {
      name: 'Team planning',
    });
    await userEvent.tab();
    await userEvent.tab();
    expect(within(dialog).getByRole('button', { name: 'Edit' })).toHaveFocus();

    await userEvent.keyboard('{Escape}');
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Team planning' }),
      ).not.toBeInTheDocument(),
    );
    expect(eventAction).toHaveFocus();
  });

  it('has no accessibility violations', async () => {
    const { container } = render(
      <CalendarEventsList events={[event]} onSelectEvent={vi.fn()} />,
    );

    expect(await axe(container)).toHaveNoViolations();
  });
});
