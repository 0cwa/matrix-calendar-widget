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

import { EventInput } from '@fullcalendar/core';
import {
  CalendarEvent,
  CalendarTimeRange,
  isAllDayCalendarEvent,
} from '@matrix-calendar-widget/calendar';
import { DateTime } from 'luxon';
import { CalendarViewType } from '../lib/utils';
import { CalendarFilters } from './types';

export function calendarEventKey(event: CalendarEvent): string {
  return `${event.calendarId}:${event.id}`;
}

export function calendarEventToFullCalendarEvent(
  event: CalendarEvent,
  buttonLabelId: string,
): EventInput {
  if (isAllDayCalendarEvent(event)) {
    return {
      id: calendarEventKey(event),
      title: event.title,
      start: event.timing.startDate,
      end: event.timing.endDate,
      allDay: true,
      extendedProps: {
        calendarId: event.calendarId,
        eventId: event.id,
        buttonLabelId,
      },
    };
  }

  return {
    id: calendarEventKey(event),
    title: event.title,
    start: zonedDateTimeToIso(
      event.timing.start.local,
      event.timing.start.timezone,
    ),
    end: zonedDateTimeToIso(
      event.timing.end.local,
      event.timing.end.timezone,
    ),
    allDay: false,
    extendedProps: {
      calendarId: event.calendarId,
      eventId: event.id,
      buttonLabelId,
    },
  };
}

export function calendarEventStartDate(event: CalendarEvent): string {
  if (isAllDayCalendarEvent(event)) {
    return event.timing.startDate;
  }

  return (
    DateTime.fromISO(event.timing.start.local, {
      zone: event.timing.start.timezone,
    }).toISODate() ?? event.timing.start.local.slice(0, 10)
  );
}

export function filterCalendarEvents(
  events: CalendarEvent[],
  filterText?: string,
): CalendarEvent[] {
  const query = filterText?.trim().toLocaleLowerCase();
  if (!query) {
    return events;
  }

  return events.filter((event) =>
    [
      event.title,
      event.description,
      event.location,
      ...(event.categories ?? []),
    ]
      .filter((value): value is string => Boolean(value))
      .some((value) => value.toLocaleLowerCase().includes(query)),
  );
}

export function groupCalendarEventsByDay(
  events: CalendarEvent[],
): Array<{ day: string; events: CalendarEvent[] }> {
  const groups = new Map<string, CalendarEvent[]>();

  for (const event of [...events].sort(compareCalendarEvents)) {
    const day = calendarEventStartDate(event);
    const group = groups.get(day);
    if (group) {
      group.push(event);
    } else {
      groups.set(day, [event]);
    }
  }

  return [...groups.entries()].map(([day, dayEvents]) => ({
    day,
    events: dayEvents,
  }));
}

export function repositoryRangeForView(
  filters: CalendarFilters,
  view: CalendarViewType | 'list',
): CalendarTimeRange {
  let start = DateTime.fromISO(filters.startDate);
  let end = DateTime.fromISO(filters.endDate).plus({ milliseconds: 1 });

  if (view === 'month') {
    start = start.minus({ weeks: 1 });
    end = end.plus({ weeks: 1 });
  }

  return {
    start: start.toUTC().toISO() ?? filters.startDate,
    end: end.toUTC().toISO() ?? filters.endDate,
  };
}

function zonedDateTimeToIso(local: string, timezone: string): string {
  return DateTime.fromISO(local, { zone: timezone }).toISO() ?? local;
}

function compareCalendarEvents(a: CalendarEvent, b: CalendarEvent): number {
  const startComparison = eventStartMillis(a) - eventStartMillis(b);
  if (startComparison !== 0) {
    return startComparison;
  }

  return a.title.localeCompare(b.title);
}

function eventStartMillis(event: CalendarEvent): number {
  if (isAllDayCalendarEvent(event)) {
    return DateTime.fromISO(event.timing.startDate, { zone: 'utc' }).toMillis();
  }

  return DateTime.fromISO(event.timing.start.local, {
    zone: event.timing.start.timezone,
  }).toMillis();
}
