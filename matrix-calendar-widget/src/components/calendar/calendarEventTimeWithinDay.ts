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
  CalendarEvent,
  calendarEventTimedDateTimeToDateTime,
  isAllDayCalendarEvent,
  isTimedCalendarEvent,
} from '@matrix-calendar-widget/calendar';
import { DateTime } from 'luxon';

/**
 * The event time without its date, or undefined if the date carries information
 * beyond the day heading: the event spans several days, or its date in its own
 * time zone differs from the viewer's date.
 */
export function formatTimeWithinDay(
  day: string,
  event: CalendarEvent,
  locale: string,
  allDayLabel: string,
  viewerTimezone: string,
): string | undefined {
  if (isAllDayCalendarEvent(event)) {
    // The end date of an all-day event is exclusive.
    const nextDay = DateTime.fromISO(day).plus({ days: 1 }).toISODate();
    return event.timing.endDate === nextDay ? allDayLabel : undefined;
  }

  if (!isTimedCalendarEvent(event)) {
    return undefined;
  }

  const [start, end] = [event.timing.start, event.timing.end].map((value) =>
    calendarEventTimedDateTimeToDateTime(value, viewerTimezone).setLocale(
      locale,
    ),
  );
  const dates = [
    start.toISODate(),
    end.toISODate(),
    event.timing.start.local.slice(0, 10),
    event.timing.end.local.slice(0, 10),
  ];

  if (dates.some((date) => date !== day)) {
    return undefined;
  }

  return `${start.toLocaleString(DateTime.TIME_SIMPLE)}–${end.toLocaleString(
    DateTime.TIME_SIMPLE,
  )}`;
}
