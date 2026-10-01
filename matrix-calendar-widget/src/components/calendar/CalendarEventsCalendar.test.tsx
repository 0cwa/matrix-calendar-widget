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
import { render, screen, within } from '@testing-library/react';
import { Settings } from 'luxon';
import { vi } from 'vitest';
import { CalendarEventsCalendar } from './CalendarEventsCalendar';

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

const zonedEvent: CalendarEvent = {
  id: 'zoned',
  calendarId: 'team',
  uid: 'zoned@example.test',
  title: 'Zoned planning',
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

const newYorkEvent: CalendarEvent = {
  id: 'new-york',
  calendarId: 'team',
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

describe('<CalendarEventsCalendar />', () => {
  it('uses viewer-local floating time for the cell, accessible name, and grid order', async () => {
    const originalZone = Settings.defaultZone;
    Settings.defaultZone = 'Europe/Stockholm';

    const offsetHeight = vi
      .spyOn(HTMLElement.prototype, 'offsetHeight', 'get')
      .mockImplementation(() => 10);
    const boundingClientRect = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue({
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

    try {
      render(
        <CalendarEventsCalendar
          events={[zonedEvent, floatingEvent, newYorkEvent]}
          filters={{
            startDate: '2026-09-23T00:00:00+02:00',
            endDate: '2026-09-24T00:00:00+02:00',
          }}
          onSelectEvent={vi.fn()}
          onShowMore={vi.fn()}
          view="month"
        />,
      );

      const floatingButton = await screen.findByRole('button', {
        name: /Floating planning: September 23, 2026 · 9:00\sAM–10:00\sAM/,
      });
      expect(within(floatingButton).getByText(/^9:00\sAM\s*$/)).toBeVisible();
      const zonedButton = await screen.findByRole('button', {
        name: /Zoned planning: September 23, 2026 · 9:00\sAM–10:00\sAM/,
      });
      const newYorkButton = await screen.findByRole('button', {
        name: /New York planning: September 23, 2026 · 3:00\sPM–4:00\sPM/,
      });
      expect(within(newYorkButton).getByText(/^3:00\sPM\s*$/)).toBeVisible();
      expect(
        floatingButton.compareDocumentPosition(zonedButton) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        zonedButton.compareDocumentPosition(newYorkButton) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    } finally {
      offsetHeight.mockRestore();
      boundingClientRect.mockRestore();
      Settings.defaultZone = originalZone;
    }
  });
});
