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
import { Settings } from 'luxon';
import { PropsWithChildren, useState } from 'react';
import { vi } from 'vitest';
import { axe } from 'vitest-axe';
import { CalendarRepositoryProvider } from '../../calendar';
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
