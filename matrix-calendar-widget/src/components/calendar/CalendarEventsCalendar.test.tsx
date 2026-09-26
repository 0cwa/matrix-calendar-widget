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
import { formatCalendarEventMonthTime } from './CalendarEventsCalendar';

describe('formatCalendarEventMonthTime', () => {
  it('formats floating times without treating floating as a Luxon zone', () => {
    const event: CalendarEvent = {
      id: 'planning',
      calendarId: 'team',
      uid: 'planning@example.test',
      title: 'Planning',
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

    expect(
      formatCalendarEventMonthTime(
        event,
        'Pacific/Auckland',
        'America/Los_Angeles',
      ),
    ).toBe('2:00 PM');
  });
});
