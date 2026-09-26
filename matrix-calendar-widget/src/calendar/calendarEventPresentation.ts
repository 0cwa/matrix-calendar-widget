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
  Calendar,
  CalendarEvent,
  CalendarEventDateTime,
  CalendarEventOccurrence,
  CalendarTimeRange,
  ZonedCalendarDateTime,
  expandCalendarEvent,
  isAllDayCalendarEvent,
  isTimedCalendarEvent,
} from '@matrix-calendar-widget/calendar';
import { DateTime } from 'luxon';
import { CalendarViewType } from '../lib/utils';
import { CalendarFilters } from './types';

export type CalendarEventPresentation = {
  /** Stable UI identity. Recurring instances include the original recurrence ID. */
  key: string;
  /** Values rendered for this visible event. */
  event: CalendarEvent | CalendarEventOccurrence;
  /** CalDAV resource that owns the event and all of its recurrence data. */
  resourceEvent: CalendarEvent;
  /** Zone used to expand and present floating values for this resource. */
  rangeTimezone: string;
  /** Viewer-local zone used to render the resolved floating instant. */
  viewerTimezone: string;
  /** Original series identity, unchanged when an override moves an instance. */
  recurrenceId?: CalendarEventDateTime;
};

export type CalendarEventPresentationResult = {
  events: CalendarEventPresentation[];
  expansionErrors: number;
};

export function calendarEventKey(event: CalendarEvent): string {
  return `${event.calendarId}:${event.id}`;
}

export function presentCalendarEvents(
  events: CalendarEvent[],
  calendars: Calendar[],
  range: CalendarTimeRange,
  viewerTimezone = DateTime.local().zoneName || 'UTC',
): CalendarEventPresentationResult {
  const calendarsById = new Map(
    calendars.map((calendar) => [calendar.id, calendar]),
  );
  const result: CalendarEventPresentation[] = [];
  let expansionErrors = 0;

  for (const resourceEvent of events) {
    const rangeTimezone =
      calendarsById.get(resourceEvent.calendarId)?.timezone || viewerTimezone;

    if (resourceEvent.unsupportedRecurrence) {
      // The raw component is preserved by the server. Do not expand a partial
      // recurrence set when a ranged override cannot be represented safely.
      expansionErrors += 1;
      continue;
    }

    if (!hasRecurrence(resourceEvent)) {
      result.push({
        key: calendarEventKey(resourceEvent),
        event: resourceEvent,
        resourceEvent,
        rangeTimezone,
        viewerTimezone,
      });
      continue;
    }

    try {
      const occurrences = expandCalendarEvent(resourceEvent, range, {
        rangeTimezone,
      });
      result.push(
        ...occurrences.map((event) => ({
          key: calendarEventOccurrenceKey(resourceEvent, event.recurrenceId),
          event,
          resourceEvent,
          rangeTimezone,
          viewerTimezone,
          recurrenceId: event.recurrenceId,
        })),
      );
    } catch {
      // Unsupported or malformed recurrence data must be visible as a warning
      // in the surface instead of silently looking like an empty calendar.
      expansionErrors += 1;
    }
  }

  return { events: result, expansionErrors };
}

export function calendarEventOccurrenceKey(
  event: CalendarEvent,
  recurrenceId: CalendarEventDateTime,
): string {
  return `occurrence:${encodeURIComponent(
    JSON.stringify([
      event.calendarId,
      event.id,
      recurrenceIdentity(recurrenceId),
    ]),
  )}`;
}

export function calendarEventPresentationToFullCalendarEvent(
  presentation: CalendarEventPresentation,
  buttonLabelId: string,
): EventInput {
  const input = calendarEventToFullCalendarEvent(
    presentation.event,
    buttonLabelId,
    presentation.rangeTimezone,
  );
  return {
    ...input,
    id: presentation.key,
    extendedProps: {
      ...input.extendedProps,
      calendarId: presentation.resourceEvent.calendarId,
      eventId: presentation.resourceEvent.id,
      recurrenceId: presentation.recurrenceId,
    },
  };
}

export function calendarEventToFullCalendarEvent(
  event: CalendarEvent | CalendarEventOccurrence,
  buttonLabelId: string,
  rangeTimezone = DateTime.local().zoneName || 'UTC',
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

  if (!isTimedCalendarEvent(event)) {
    throw new Error('Unsupported calendar event timing');
  }

  return {
    id: calendarEventKey(event),
    title: event.title,
    start: zonedDateTimeToIso(event.timing.start, rangeTimezone),
    end: zonedDateTimeToIso(event.timing.end, rangeTimezone),
    allDay: false,
    extendedProps: {
      calendarId: event.calendarId,
      eventId: event.id,
      buttonLabelId,
      rangeTimezone,
    },
  };
}

export function calendarEventStartDate(
  event: CalendarEvent | CalendarEventOccurrence,
  rangeTimezone = DateTime.local().zoneName || 'UTC',
  viewerTimezone = DateTime.local().zoneName || 'UTC',
): string {
  if (isAllDayCalendarEvent(event)) {
    return event.timing.startDate;
  }

  if (!isTimedCalendarEvent(event)) {
    throw new Error('Unsupported calendar event timing');
  }

  return (
    calendarEventDateTimeForDisplay(
      event.timing.start,
      rangeTimezone,
      viewerTimezone,
    ).toISODate() ?? event.timing.start.local.slice(0, 10)
  );
}

export function filterCalendarEvents(
  events: CalendarEventPresentation[],
  filterText?: string,
): CalendarEventPresentation[] {
  const query = filterText?.trim().toLocaleLowerCase();
  if (!query) {
    return events;
  }

  return events.filter(({ event }) =>
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
  events: CalendarEventPresentation[],
): Array<{ day: string; events: CalendarEventPresentation[] }> {
  const groups = new Map<string, CalendarEventPresentation[]>();

  for (const presentation of [...events].sort(comparePresentations)) {
    const day = calendarEventStartDate(
      presentation.event,
      presentation.rangeTimezone,
      presentation.viewerTimezone,
    );
    const group = groups.get(day);
    if (group) {
      group.push(presentation);
    } else {
      groups.set(day, [presentation]);
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

function zonedDateTimeToIso(
  dateTime: ZonedCalendarDateTime,
  rangeTimezone: string,
): string {
  return (
    DateTime.fromISO(dateTime.local, {
      zone: calendarEventDateTimeTimezone(dateTime, rangeTimezone),
    }).toISO() ?? dateTime.local
  );
}

export function calendarEventDateTimeTimezone(
  dateTime: ZonedCalendarDateTime,
  rangeTimezone = DateTime.local().zoneName || 'UTC',
): string {
  return isFloatingDateTime(dateTime) ? rangeTimezone : dateTime.timezone;
}

export function calendarEventDateTimeForDisplay(
  dateTime: ZonedCalendarDateTime,
  rangeTimezone = DateTime.local().zoneName || 'UTC',
  viewerTimezone = DateTime.local().zoneName || 'UTC',
): DateTime {
  const value = DateTime.fromISO(dateTime.local, {
    zone: calendarEventDateTimeTimezone(dateTime, rangeTimezone),
  });
  return isFloatingDateTime(dateTime) ? value.setZone(viewerTimezone) : value;
}

function isFloatingDateTime(dateTime: ZonedCalendarDateTime): boolean {
  return dateTime.mode === 'floating' || dateTime.timezone === 'floating';
}

function comparePresentations(
  a: CalendarEventPresentation,
  b: CalendarEventPresentation,
): number {
  const startComparison =
    eventStartMillis(a.event, a.rangeTimezone) -
    eventStartMillis(b.event, b.rangeTimezone);
  if (startComparison !== 0) {
    return startComparison;
  }

  return a.event.title.localeCompare(b.event.title);
}

function eventStartMillis(
  event: CalendarEvent | CalendarEventOccurrence,
  rangeTimezone: string,
): number {
  if (isAllDayCalendarEvent(event)) {
    return DateTime.fromISO(event.timing.startDate, { zone: 'utc' }).toMillis();
  }

  if (!isTimedCalendarEvent(event)) {
    throw new Error('Unsupported calendar event timing');
  }

  return DateTime.fromISO(event.timing.start.local, {
    zone: calendarEventDateTimeTimezone(event.timing.start, rangeTimezone),
  }).toMillis();
}

function hasRecurrence(event: CalendarEvent): boolean {
  const recurrence = event.recurrence;
  return Boolean(
    recurrence?.rrule ||
    recurrence?.rdates?.length ||
    recurrence?.rdatePeriods?.length ||
    recurrence?.exdates?.length ||
    recurrence?.overrides?.length ||
    recurrence?.recurrenceId,
  );
}

function recurrenceIdentity(recurrenceId: CalendarEventDateTime): string {
  if (recurrenceId.type === 'date') {
    return JSON.stringify(['date', recurrenceId.value]);
  }

  const value = recurrenceId.value;
  const mode =
    value.mode ??
    (value.timezone === 'UTC'
      ? 'utc'
      : value.timezone === 'floating'
        ? 'floating'
        : 'tzid');
  return JSON.stringify([
    'date-time',
    mode,
    mode === 'tzid' ? value.timezone : '',
    value.local,
  ]);
}
