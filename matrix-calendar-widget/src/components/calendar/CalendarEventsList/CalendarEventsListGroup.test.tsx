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
import { act, render, screen } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { CalendarEventsList } from '../CalendarEventsList';

const events: CalendarEvent[] = [5, 6, 7].map((day) => ({
  id: `day-${day}`,
  calendarId: 'team',
  uid: `day-${day}@example.test`,
  title: `Day ${day}`,
  timing: {
    type: 'all-day',
    startDate: `2026-10-0${day}`,
    endDate: `2026-10-0${day + 1}`,
  },
}));

const headings = () =>
  screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent);

describe('<CalendarEventsList /> relative days', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('names today and tomorrow beside the date and follows midnight', () => {
    vi.useFakeTimers({ now: new Date('2026-10-05T23:59:00Z') });

    render(
      <CalendarEventsList events={events} onSelectEvent={() => undefined} />,
    );

    expect(headings()).toEqual([
      'Today · Monday, October 5, 2026',
      'Tomorrow · Tuesday, October 6, 2026',
      'Wednesday, October 7, 2026',
    ]);

    act(() => {
      vi.advanceTimersByTime(61_000);
    });

    expect(headings()).toEqual([
      'Monday, October 5, 2026',
      'Today · Tuesday, October 6, 2026',
      'Tomorrow · Wednesday, October 7, 2026',
    ]);
  });
});
