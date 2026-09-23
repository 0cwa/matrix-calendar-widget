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
  CalendarEventInput,
  CalendarEventPatch,
  CalendarId,
  isAllDayCalendarEvent,
  isTimedCalendarEvent,
} from '@matrix-calendar-widget/calendar';
import { DateTime } from 'luxon';

export type CalendarEventFormValues = {
  calendarId: CalendarId;
  title: string;
  description: string;
  location: string;
  timingType: 'timed' | 'all-day';
  start: string;
  end: string;
  timezone: string;
};

export function createCalendarEventFormValues(
  calendar: Calendar,
  now: DateTime = DateTime.local(),
): CalendarEventFormValues {
  const timezone = calendar.timezone ?? now.zoneName;
  const start = now.setZone(timezone).startOf('hour');
  const end = start.plus({ hours: 1 });

  return {
    calendarId: calendar.id,
    title: '',
    description: '',
    location: '',
    timingType: 'timed',
    start: start.toFormat("yyyy-MM-dd'T'HH:mm"),
    end: end.toFormat("yyyy-MM-dd'T'HH:mm"),
    timezone,
  };
}

export function calendarEventToFormValues(
  event: CalendarEvent,
  calendar: Calendar,
): CalendarEventFormValues {
  if (isAllDayCalendarEvent(event)) {
    return {
      calendarId: event.calendarId,
      title: event.title,
      description: event.description ?? '',
      location: event.location ?? '',
      timingType: 'all-day',
      start: event.timing.startDate,
      end:
        DateTime.fromISO(event.timing.endDate).minus({ days: 1 }).toISODate() ??
        event.timing.startDate,
      timezone: calendar.timezone ?? DateTime.local().zoneName,
    };
  }

  if (!isTimedCalendarEvent(event)) {
    throw new Error('Unsupported calendar event timing');
  }

  return {
    calendarId: event.calendarId,
    title: event.title,
    description: event.description ?? '',
    location: event.location ?? '',
    timingType: 'timed',
    start: event.timing.start.local.slice(0, 16),
    end: event.timing.end.local.slice(0, 16),
    timezone: event.timing.start.timezone,
  };
}

export function calendarEventInputFromForm(
  values: CalendarEventFormValues,
  uid: string,
): CalendarEventInput {
  return {
    uid,
    ...calendarEventEditableFieldsFromForm(values),
  };
}

export function calendarEventPatchFromForm(
  values: CalendarEventFormValues,
): CalendarEventPatch {
  return {
    ...calendarEventEditableFieldsFromForm(values),
    description: normalizeOptional(values.description),
    location: normalizeOptional(values.location),
  };
}

function calendarEventEditableFieldsFromForm(
  values: CalendarEventFormValues,
): Omit<CalendarEventInput, 'uid'> {
  const description = normalizeOptional(values.description);
  const location = normalizeOptional(values.location);

  return {
    title: values.title.trim(),
    ...(description ? { description } : {}),
    ...(location ? { location } : {}),
    timing:
      values.timingType === 'all-day'
        ? {
            type: 'all-day',
            startDate: values.start,
            endDate:
              DateTime.fromISO(values.end).plus({ days: 1 }).toISODate() ??
              values.end,
          }
        : {
            type: 'timed',
            start: {
              local: values.start,
              timezone: values.timezone,
            },
            end: {
              local: values.end,
              timezone: values.timezone,
            },
          },
  };
}

function normalizeOptional(value: string): string | undefined {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}
