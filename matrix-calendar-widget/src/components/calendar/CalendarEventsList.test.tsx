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
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { axe } from 'vitest-axe';
import { CalendarEventsList } from './CalendarEventsList';

const event: CalendarEvent = {
  id: 'planning',
  calendarId: 'team',
  uid: 'planning@example.test',
  title: 'Team planning',
  location: 'Room 3',
  timing: {
    type: 'timed',
    start: {
      local: '2026-09-23T09:00:00',
      timezone: 'Europe/Stockholm',
    },
    end: {
      local: '2026-09-23T10:00:00',
      timezone: 'Europe/Stockholm',
    },
  },
};

describe('<CalendarEventsList />', () => {
  it('renders domain events and selects them without a Meeting adapter', async () => {
    const onSelectEvent = vi.fn();
    const user = userEvent.setup();

    render(
      <CalendarEventsList events={[event]} onSelectEvent={onSelectEvent} />,
    );

    expect(screen.getByText('Team planning')).toBeInTheDocument();
    expect(screen.getByText('Room 3')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Team planning/i }));

    expect(onSelectEvent).toHaveBeenCalledWith(event);
  });

  it('renders an empty state', () => {
    render(<CalendarEventsList events={[]} onSelectEvent={vi.fn()} />);

    expect(
      screen.getByText(
        'No events scheduled that match the selected filters.',
      ),
    ).toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    const { container } = render(
      <CalendarEventsList events={[event]} onSelectEvent={vi.fn()} />,
    );

    expect(await axe(container)).toHaveNoViolations();
  });
});
