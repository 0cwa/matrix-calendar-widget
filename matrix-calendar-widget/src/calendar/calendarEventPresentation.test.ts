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

import { Calendar, CalendarEvent } from '@matrix-calendar-widget/calendar';
import { DateTime } from 'luxon';
import {
  calendarEventDateTimeForDisplay,
  calendarEventKey,
  calendarEventOccurrenceKey,
  calendarEventPresentationToFullCalendarEvent,
  calendarEventStartDate,
  calendarEventToFullCalendarEvent,
  filterCalendarEvents,
  groupCalendarEventsByDay,
  presentCalendarEvents,
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

const recurringEvent: CalendarEvent = {
  id: 'series',
  calendarId: 'team',
  uid: 'series@example.test',
  title: 'Daily planning',
  timing: {
    type: 'timed',
    start: {
      local: '2026-10-23T09:00:00',
      timezone: 'Europe/Stockholm',
      mode: 'tzid',
    },
    end: {
      local: '2026-10-23T10:00:00',
      timezone: 'Europe/Stockholm',
      mode: 'tzid',
    },
  },
  recurrence: {
    rrule: 'FREQ=DAILY;COUNT=5',
    rdates: [
      {
        type: 'date-time',
        value: {
          local: '2026-10-28T09:00:00',
          timezone: 'Europe/Stockholm',
          mode: 'tzid',
        },
      },
    ],
    overrides: [
      {
        recurrenceId: {
          type: 'date-time',
          value: {
            local: '2026-10-24T09:00:00',
            timezone: 'Europe/Stockholm',
            mode: 'tzid',
          },
        },
        title: 'Moved planning',
        timing: {
          type: 'timed',
          start: {
            local: '2026-10-25T14:00:00',
            timezone: 'Europe/Stockholm',
            mode: 'tzid',
          },
          end: {
            local: '2026-10-25T15:00:00',
            timezone: 'Europe/Stockholm',
            mode: 'tzid',
          },
        },
      },
      {
        recurrenceId: {
          type: 'date-time',
          value: {
            local: '2026-10-26T09:00:00',
            timezone: 'Europe/Stockholm',
            mode: 'tzid',
          },
        },
        status: 'cancelled',
      },
    ],
  },
};

function asPresentation(event: CalendarEvent) {
  return {
    key: calendarEventKey(event),
    event,
    resourceEvent: event,
    rangeTimezone: 'UTC',
    viewerTimezone: 'UTC',
  };
}

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

  it('anchors floating FullCalendar values in the viewer-local zone', () => {
    const floatingEvent: CalendarEvent = {
      ...timedEvent,
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

    const input = calendarEventToFullCalendarEvent(
      floatingEvent,
      'label-planning',
      'America/Los_Angeles',
    );
    expect(input).toMatchObject({
      start: '2026-09-23T09:00:00.000-07:00',
      end: '2026-09-23T10:00:00.000-07:00',
      extendedProps: { rangeTimezone: 'America/Los_Angeles' },
    });
    expect(
      DateTime.fromISO(String(input.start))
        .setZone('America/Los_Angeles')
        .toFormat('yyyy-MM-dd HH:mm'),
    ).toBe('2026-09-23 09:00');
    expect(
      calendarEventStartDate(
        floatingEvent,
        'America/Los_Angeles',
        'America/Los_Angeles',
      ),
    ).toBe('2026-09-23');
    expect(
      groupCalendarEventsByDay([
        {
          ...asPresentation(floatingEvent),
          rangeTimezone: 'America/Los_Angeles',
          viewerTimezone: 'America/Los_Angeles',
        },
      ]).map(({ day }) => day),
    ).toEqual(['2026-09-23']);
  });

  it('filters by title, description, location, or category', () => {
    const presentation = asPresentation(timedEvent);
    expect(filterCalendarEvents([presentation], 'quarterly')).toEqual([
      presentation,
    ]);
    expect(filterCalendarEvents([presentation], 'room 3')).toEqual([
      presentation,
    ]);
    expect(filterCalendarEvents([presentation], 'team')).toEqual([
      presentation,
    ]);
    expect(filterCalendarEvents([presentation], 'missing')).toEqual([]);
  });

  it('groups and sorts events by their viewer-local start day', () => {
    const groups = groupCalendarEventsByDay([
      asPresentation(allDayEvent),
      asPresentation(timedEvent),
    ]);

    expect(groups.map(({ day }) => day)).toEqual(['2026-09-23', '2026-09-24']);
    expect(groups[0].events[0].event).toEqual(timedEvent);
  });

  it('expands visible RRULE and RDATE occurrences with moved and cancelled overrides', () => {
    const result = presentCalendarEvents(
      [recurringEvent],
      [{ id: 'team', name: 'Team', timezone: 'Europe/Stockholm' }],
      {
        start: '2026-10-25T00:00:00Z',
        end: '2026-10-30T00:00:00Z',
      },
    );

    expect(result.expansionErrors).toBe(0);
    expect(result.events.map(({ recurrenceId }) => recurrenceId)).toEqual([
      {
        type: 'date-time',
        value: {
          local: '2026-10-25T09:00:00',
          timezone: 'Europe/Stockholm',
          mode: 'tzid',
        },
      },
      {
        type: 'date-time',
        value: {
          local: '2026-10-24T09:00:00',
          timezone: 'Europe/Stockholm',
          mode: 'tzid',
        },
      },
      {
        type: 'date-time',
        value: {
          local: '2026-10-27T09:00:00',
          timezone: 'Europe/Stockholm',
          mode: 'tzid',
        },
      },
      {
        type: 'date-time',
        value: {
          local: '2026-10-28T09:00:00',
          timezone: 'Europe/Stockholm',
          mode: 'tzid',
        },
      },
    ]);
    const moved = result.events.find(
      ({ event }) => event.title === 'Moved planning',
    )!;
    expect(moved.event.timing).toMatchObject({
      type: 'timed',
      start: { local: '2026-10-25T14:00:00' },
    });
    expect(moved.resourceEvent.id).toBe('series');
    expect(moved.recurrenceId).toMatchObject({
      type: 'date-time',
      value: { local: '2026-10-24T09:00:00' },
    });
    expect(
      result.events.some(
        ({ recurrenceId }) =>
          recurrenceId?.type === 'date-time' &&
          recurrenceId.value.local === '2026-10-26T09:00:00',
      ),
    ).toBe(false);
    expect(new Set(result.events.map(({ key }) => key)).size).toBe(4);
    expect(
      result.events.every(
        ({ resourceEvent }) => resourceEvent === recurringEvent,
      ),
    ).toBe(true);

    expect(moved.key).toBe(
      calendarEventOccurrenceKey(recurringEvent, moved.recurrenceId!),
    );
    const fullCalendarEvent = calendarEventPresentationToFullCalendarEvent(
      moved,
      'moved-label',
    );
    expect(fullCalendarEvent).toMatchObject({
      id: moved.key,
      start: '2026-10-25T14:00:00.000+01:00',
      extendedProps: {
        calendarId: 'team',
        eventId: 'series',
        recurrenceId: moved.recurrenceId,
      },
    });
    expect(
      calendarEventOccurrenceKey(
        { ...recurringEvent, id: 'another-series' },
        moved.recurrenceId!,
      ),
    ).not.toBe(moved.key);
  });

  it('uses viewer-local time for DATE and floating recurrence regardless of Calendar.timezone', () => {
    const allDaySeries: CalendarEvent = {
      ...allDayEvent,
      recurrence: { rrule: 'FREQ=DAILY;COUNT=4' },
    };
    const calendar: Calendar = {
      id: 'team',
      name: 'Team',
      timezone: 'Pacific/Honolulu',
    };

    const dateBoundaryResult = presentCalendarEvents(
      [allDaySeries],
      [calendar],
      {
        start: '2026-09-24T06:59:00Z',
        end: '2026-09-24T07:01:00Z',
      },
      'America/Los_Angeles',
    );
    expect(dateBoundaryResult.expansionErrors).toBe(0);
    expect(dateBoundaryResult.events).toHaveLength(1);
    expect(dateBoundaryResult.events[0].event.timing).toMatchObject({
      type: 'all-day',
      startDate: '2026-09-24',
    });

    const floatingSeries: CalendarEvent = {
      ...timedEvent,
      timing: {
        type: 'timed',
        start: {
          local: '2026-09-25T09:00:00',
          timezone: 'floating',
          mode: 'floating',
        },
        end: {
          local: '2026-09-25T10:00:00',
          timezone: 'floating',
          mode: 'floating',
        },
      },
      recurrence: { rrule: 'FREQ=DAILY;COUNT=2' },
    };
    const floatingBoundaryResult = presentCalendarEvents(
      [floatingSeries],
      [{ id: 'team', name: 'Team', timezone: 'Pacific/Auckland' }],
      {
        start: '2026-09-25T15:59:00Z',
        end: '2026-09-25T16:01:00Z',
      },
      'America/Los_Angeles',
    );

    expect(floatingBoundaryResult.expansionErrors).toBe(0);
    expect(floatingBoundaryResult.events).toHaveLength(1);
    const presentation = floatingBoundaryResult.events[0];
    expect(presentation.rangeTimezone).toBe('America/Los_Angeles');
    expect(presentation.viewerTimezone).toBe('America/Los_Angeles');
    const fullCalendarEvent = calendarEventPresentationToFullCalendarEvent(
      presentation,
      'label-planning',
    );
    expect(fullCalendarEvent.start).toBe('2026-09-25T09:00:00.000-07:00');
    expect(
      groupCalendarEventsByDay([presentation]).map(({ day }) => day),
    ).toEqual(['2026-09-25']);
    if (presentation.event.timing.type !== 'timed') {
      throw new Error('Expected timed occurrence');
    }
    expect(
      calendarEventDateTimeForDisplay(
        presentation.event.timing.start,
        presentation.rangeTimezone,
        presentation.viewerTimezone,
      ).toFormat('yyyy-MM-dd HH:mm'),
    ).toBe('2026-09-25 09:00');
  });

  it('does not display a partially modeled ranged recurrence', () => {
    const ranged: CalendarEvent = {
      ...recurringEvent,
      unsupportedRecurrence: 'ranged-override',
    };

    expect(
      presentCalendarEvents(
        [ranged],
        [{ id: 'team', name: 'Team', timezone: 'Europe/Stockholm' }],
        {
          start: '2026-10-25T00:00:00Z',
          end: '2026-10-30T00:00:00Z',
        },
      ),
    ).toMatchObject({ events: [], expansionErrors: 1 });
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
