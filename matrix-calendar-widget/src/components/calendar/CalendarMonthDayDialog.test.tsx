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

import { CalendarEvent } from '@matrix-calendar-widget/calendar';
import { Dialog, DialogTitle } from '@mui/material';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ComponentProps, useState } from 'react';
import { afterEach, beforeEach, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { formatCalendarEventTime } from './CalendarEventDetailsDialog';
import { CalendarEventsCalendar } from './CalendarEventsCalendar';
import { CalendarMonthDayDialog } from './CalendarMonthDayDialog';

function busyDay(date: string): CalendarEvent[] {
  return ['09', '10', '11', '12', '13'].map((hour) => ({
    id: `${date}-${hour}`,
    calendarId: 'team',
    uid: `${date}-${hour}@example.test`,
    title: `Busy ${date} at ${hour}`,
    timing: {
      type: 'timed',
      start: { type: 'floating', local: `${date}T${hour}:00:00` },
      end: { type: 'floating', local: `${date}T${hour}:30:00` },
    },
  }));
}

// October 2026 starts on a Thursday, so the grid also shows late September.
const events = [...busyDay('2026-09-29'), ...busyDay('2026-10-09')];

function Harness(
  props: Partial<ComponentProps<typeof CalendarEventsCalendar>>,
) {
  const [selected, setSelected] = useState<CalendarEvent>();

  return (
    <>
      <CalendarEventsCalendar
        events={events}
        filters={{
          startDate: '2026-10-01T00:00:00',
          endDate: '2026-10-31T23:59:59',
        }}
        onShowMore={vi.fn()}
        view="month"
        {...props}
        onSelectEvent={setSelected}
      />
      {/* Stands in for the event details, which the surface renders. */}
      <Dialog onClose={() => setSelected(undefined)} open={Boolean(selected)}>
        <DialogTitle>Details of {selected?.title}</DialogTitle>
      </Dialog>
    </>
  );
}

function moreLink(date: string): HTMLElement {
  // FullCalendar has no accessible relation between a date and its link.
  return document.querySelector(
    `[data-date="${date}"] .fc-daygrid-more-link`,
  ) as HTMLElement;
}

describe('<CalendarEventsCalendar /> dates with more events', () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(10);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      bottom: 1,
      height: 1,
      left: 1,
      right: 1,
      top: 1,
      width: 1,
      x: 1,
      y: 1,
      toJSON: vi.fn(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists every event of the date and returns focus through details', async () => {
    const onShowMore = vi.fn();
    render(<Harness onShowMore={onShowMore} />);

    await waitFor(() => expect(moreLink('2026-10-09')).toBeTruthy());
    const link = moreLink('2026-10-09');
    expect(link).toHaveAttribute('aria-haspopup', 'dialog');
    link.focus();
    await userEvent.keyboard('{Enter}');

    const list = await screen.findByRole('dialog', {
      name: 'Friday, October 9, 2026',
    });
    expect(within(list).getByText('5 events')).toBeInTheDocument();
    const rows = within(list).getAllByRole('button', { name: /^Busy / });
    expect(rows.map((row) => row.getAttribute('aria-label'))).toEqual(
      ['09', '10', '11', '12', '13'].map((hour) =>
        expect.stringMatching(
          new RegExp(`^Busy 2026-10-09 at ${hour} .+–.+ · October 9, 2026$`),
        ),
      ),
    );
    expect(rows[0]).toHaveFocus();
    expect(onShowMore).not.toHaveBeenCalled();

    await userEvent.tab();
    await userEvent.keyboard('{Enter}');
    const details = await screen.findByRole('dialog', {
      name: 'Details of Busy 2026-10-09 at 10',
    });

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(details).not.toBeInTheDocument());
    expect(list).toBeInTheDocument();
    await waitFor(() => expect(rows[1]).toHaveFocus());

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(list).not.toBeInTheDocument());
    expect(moreLink('2026-10-09')).toHaveFocus();
  });

  it('shows dates in overflow rows when the event spans days or its original date differs', () => {
    const sameDay = busyDay('2026-10-09')[0];
    const crossMidnight: CalendarEvent = {
      ...sameDay,
      id: 'overnight',
      uid: 'overnight@example.test',
      title: 'Overnight maintenance',
      timing: {
        type: 'timed',
        start: { type: 'floating', local: '2026-10-09T23:30:00' },
        end: { type: 'floating', local: '2026-10-10T00:30:00' },
      },
    };
    const shifted: CalendarEvent = {
      ...sameDay,
      id: 'shifted',
      uid: 'shifted@example.test',
      title: 'New York planning',
      timing: {
        type: 'timed',
        start: {
          type: 'zoned',
          local: '2026-10-08T21:00:00',
          timezone: 'America/New_York',
        },
        end: {
          type: 'zoned',
          local: '2026-10-08T22:00:00',
          timezone: 'America/New_York',
        },
      },
    };
    const viewerTimezone = 'Europe/Stockholm';
    const entries = [sameDay, crossMidnight, shifted].map((event) => {
      const time = formatCalendarEventTime(
        event,
        'en',
        'All day',
        viewerTimezone,
      );
      return { event, time };
    });
    render(
      <CalendarMonthDayDialog
        date={new Date(2026, 9, 9)}
        entries={entries}
        onClose={vi.fn()}
        onOpenDay={vi.fn()}
        onSelectEvent={vi.fn()}
        open
        viewerTimezone={viewerTimezone}
      />,
    );

    const dialog = screen.getByRole('dialog', {
      name: 'Friday, October 9, 2026',
    });
    const [sameDayRow, overnightRow, shiftedRow] =
      within(dialog).getAllByRole('button');
    expect(within(sameDayRow).getByText(/^9:00\sAM–9:30\sAM$/)).toBeVisible();
    expect(sameDayRow).toHaveAccessibleName(
      /9:00\sAM–9:30\sAM · October 9, 2026$/,
    );
    expect(within(overnightRow).getByText(entries[1].time)).toBeVisible();
    expect(within(shiftedRow).getByText(entries[2].time)).toBeVisible();
  });

  it('offers the day view for the date', async () => {
    const onShowMore = vi.fn();
    render(<Harness onShowMore={onShowMore} />);

    await waitFor(() => expect(moreLink('2026-10-09')).toBeTruthy());
    await userEvent.click(moreLink('2026-10-09'));
    const list = await screen.findByRole('dialog');
    await userEvent.click(
      within(list).getByRole('button', { name: 'Open day' }),
    );

    expect(onShowMore).toHaveBeenCalledWith(new Date(2026, 9, 9));
    await waitFor(() => expect(list).not.toBeInTheDocument());
  });

  it('keeps the month when the date belongs to the month before', async () => {
    render(<Harness />);

    await waitFor(() => expect(moreLink('2026-09-29')).toBeTruthy());
    await userEvent.click(moreLink('2026-09-29'));
    const list = await screen.findByRole('dialog', {
      name: 'Tuesday, September 29, 2026',
    });
    await userEvent.click(within(list).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(list).not.toBeInTheDocument());

    // A grid of September would start in August and end on October 3 or 4.
    expect(moreLink('2026-10-09')).toBeTruthy();
    expect(moreLink('2026-09-29')).toHaveFocus();
  });

  it('closes the list when the Month view goes away', async () => {
    const { rerender } = render(<Harness />);

    await waitFor(() => expect(moreLink('2026-10-09')).toBeTruthy());
    await userEvent.click(moreLink('2026-10-09'));
    const list = await screen.findByRole('dialog');

    rerender(<Harness view="day" />);
    await waitFor(() => expect(list).not.toBeInTheDocument());
    rerender(<Harness view="month" />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens the day directly for an overflowing all-day row in Week', async () => {
    const onShowMore = vi.fn();
    render(
      <Harness
        events={busyDay('2026-10-09').map((event) => ({
          ...event,
          timing: {
            type: 'all-day',
            startDate: '2026-10-09',
            endDate: '2026-10-10',
          },
        }))}
        filters={{
          startDate: '2026-10-05T00:00:00',
          endDate: '2026-10-11T23:59:59',
        }}
        onShowMore={onShowMore}
        view="week"
      />,
    );

    const link = await screen.findByRole('button', { name: /more/ });
    expect(link).not.toHaveAttribute('aria-haspopup');
    await userEvent.click(link);

    expect(onShowMore).toHaveBeenCalledWith(new Date(2026, 9, 9));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('has no accessibility violations in the list', async () => {
    render(<Harness />);

    await waitFor(() => expect(moreLink('2026-10-09')).toBeTruthy());
    await userEvent.click(moreLink('2026-10-09'));

    expect(await axe(await screen.findByRole('dialog'))).toHaveNoViolations();
  });
});
