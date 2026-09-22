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
  CalendarEventRecurrence,
  isAllDayCalendarEvent,
  isTimedCalendarEvent,
} from './calendar';

describe('calendar domain', () => {
  it('represents a timed event with named timezone and common VEVENT fields', () => {
    const event: CalendarEvent = {
      id: '/team/simple-timed.ics',
      calendarId: '/team/',
      uid: 'simple-timed@example.test',
      title: 'Team planning',
      description: 'Planning session for the team.',
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
      status: 'confirmed',
      transparency: 'opaque',
      location: 'Room 3',
      url: 'https://example.test/events/simple-timed',
      categories: ['TEAM', 'PLANNING'],
      priority: 5,
    };

    expect(isTimedCalendarEvent(event)).toBe(true);
    expect(isAllDayCalendarEvent(event)).toBe(false);

    if (isTimedCalendarEvent(event)) {
      expect(event.timing.start.timezone).toBe('Europe/Stockholm');
      expect(event.timing.end.local).toBe('2026-09-23T10:00:00');
    }
  });

  it('represents all-day events with an exclusive end date', () => {
    const event: CalendarEvent = {
      id: '/company/holiday.ics',
      calendarId: '/company/',
      uid: 'all-day@example.test',
      title: 'Company holiday',
      timing: {
        type: 'all-day',
        startDate: '2026-10-05',
        endDate: '2026-10-06',
      },
      transparency: 'transparent',
    };

    expect(isAllDayCalendarEvent(event)).toBe(true);
    expect(isTimedCalendarEvent(event)).toBe(false);

    if (isAllDayCalendarEvent(event)) {
      expect(event.timing.startDate).toBe('2026-10-05');
      expect(event.timing.endDate).toBe('2026-10-06');
    }
  });

  it('keeps recurrence source metadata without depending on a rendering model', () => {
    const recurrence: CalendarEventRecurrence = {
      rrule: 'FREQ=WEEKLY;BYDAY=MO,WE;COUNT=8',
      exdates: [
        {
          type: 'date-time',
          value: {
            local: '2026-10-12T09:00:00',
            timezone: 'Europe/Stockholm',
          },
        },
      ],
      rdates: [
        {
          type: 'date-time',
          value: {
            local: '2026-10-16T09:00:00',
            timezone: 'Europe/Stockholm',
          },
        },
      ],
      recurrenceId: {
        type: 'date-time',
        value: {
          local: '2026-10-19T09:00:00',
          timezone: 'Europe/Stockholm',
        },
      },
    };

    expect(recurrence.rrule).toContain('FREQ=WEEKLY');
    expect(recurrence.exdates).toHaveLength(1);
    expect(recurrence.rdates).toHaveLength(1);
    expect(recurrence.recurrenceId?.type).toBe('date-time');
  });

  it('represents calendar collection metadata without DAV-specific types', () => {
    const calendar: Calendar = {
      id: '/team/',
      name: 'Team calendar',
      description: 'Shared team events',
      color: '#3c82f6',
      timezone: 'Europe/Stockholm',
      readOnly: true,
    };

    expect(calendar).toEqual({
      id: '/team/',
      name: 'Team calendar',
      description: 'Shared team events',
      color: '#3c82f6',
      timezone: 'Europe/Stockholm',
      readOnly: true,
    });
  });
});
