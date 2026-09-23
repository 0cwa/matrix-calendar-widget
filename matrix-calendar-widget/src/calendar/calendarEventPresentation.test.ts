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
import {
  calendarEventToFullCalendarEvent,
  filterCalendarEvents,
  groupCalendarEventsByDay,
  repositoryRangeForView,
} from './calendarEventPresentation';

const timedEvent: CalendarEvent = {
  id: 'planning',
  calendarId: 'team',
  uid: 'planning@example.test',
  title: 'Team planning',
  description: 'Quarterly planning',
  location: 'Room 3',
  categories: ['TEAM'],
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

const allDayEvent: CalendarEvent = {
  id: 'holiday',
  calendarId: 'team',
  uid: 'holiday@example.test',
  title: 'Company holiday',
  timing: {
    type: 'all-day',
    startDate: '2026-09-24',
    endDate: '2026-09-25',
  },
};

describe('calendar event presentation', () => {
  it('maps timed events to explicit-offset FullCalendar input', () => {
    expect(
      calendarEventToFullCalendarEvent(timedEvent, 'label-planning'),
    ).toMatchObject({
      id: 'team:planning',
      title: 'Team planning',
      start: '2026-09-23T09:00:00.000+02:00',
      end: '2026-09-23T10:00:00.000+02:00',
      allDay: false,
      extendedProps: {
        calendarId: 'team',
        eventId: 'planning',
        buttonLabelId: 'label-planning',
      },
    });
  });

  it('preserves exclusive all-day end dates for FullCalendar', () => {
    expect(
      calendarEventToFullCalendarEvent(allDayEvent, 'label-holiday'),
    ).toMatchObject({
      start: '2026-09-24',
      end: '2026-09-25',
      allDay: true,
    });
  });

  it('filters by title, description, location, or category', () => {
    expect(filterCalendarEvents([timedEvent], 'quarterly')).toEqual([
      timedEvent,
    ]);
    expect(filterCalendarEvents([timedEvent], 'room 3')).toEqual([timedEvent]);
    expect(filterCalendarEvents([timedEvent], 'team')).toEqual([timedEvent]);
    expect(filterCalendarEvents([timedEvent], 'missing')).toEqual([]);
  });

  it('groups and sorts events by their calendar-local start day', () => {
    const groups = groupCalendarEventsByDay([allDayEvent, timedEvent]);

    expect(groups.map(({ day }) => day)).toEqual(['2026-09-23', '2026-09-24']);
    expect(groups[0].events).toEqual([timedEvent]);
  });

  it('widens month repository ranges for spillover days', () => {
    expect(
      repositoryRangeForView(
        {
          startDate: '2026-09-01T00:00:00+02:00',
          endDate: '2026-09-30T23:59:59.999+02:00',
        },
        'month',
      ),
    ).toEqual({
      start: '2026-08-24T22:00:00.000Z',
      end: '2026-10-07T22:00:00.000Z',
    });
  });
});
