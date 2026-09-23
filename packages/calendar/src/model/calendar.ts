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

/**
 * Opaque identifier for a calendar collection.
 *
 * Repository implementations decide how this maps to an underlying store.
 */
export type CalendarId = string;

/** Opaque identifier for one event resource within a calendar. */
export type CalendarEventId = string;

/** A date in ISO calendar-date form (YYYY-MM-DD). */
export type CalendarDate = string;

/**
 * Local wall-clock date/time in ISO form without a numeric UTC offset.
 *
 * The named IANA timezone on {@link ZonedCalendarDateTime} defines how the
 * value is interpreted.
 */
export type LocalCalendarDateTime = string;

export type ZonedCalendarDateTime = {
  local: LocalCalendarDateTime;
  timezone: string;
};

/**
 * Timed events retain their named timezone instead of normalizing the domain
 * model to UTC. Adapters may derive UTC instants for querying/rendering.
 */
export type TimedCalendarEventTiming = {
  type: 'timed';
  start: ZonedCalendarDateTime;
  end: ZonedCalendarDateTime;
};

/**
 * All-day event end dates are exclusive, matching iCalendar DTEND semantics.
 */
export type AllDayCalendarEventTiming = {
  type: 'all-day';
  startDate: CalendarDate;
  endDate: CalendarDate;
};

export type CalendarEventTiming =
  | TimedCalendarEventTiming
  | AllDayCalendarEventTiming;

export type CalendarEventDateTime =
  | { type: 'date-time'; value: ZonedCalendarDateTime }
  | { type: 'date'; value: CalendarDate };

export type CalendarEventStatus = 'confirmed' | 'tentative' | 'cancelled';

export type CalendarEventTransparency = 'opaque' | 'transparent';

/**
 * Recurrence source metadata.
 *
 * The RRULE string intentionally remains iCalendar-compatible so the existing
 * recurrence helpers can be reused while M5 grows richer recurrence editing.
 */
export type CalendarEventRecurrence = {
  rrule?: string;
  rdates?: CalendarEventDateTime[];
  exdates?: CalendarEventDateTime[];
  recurrenceId?: CalendarEventDateTime;
};

export type Calendar = {
  id: CalendarId;
  name: string;
  description?: string;
  color?: string;
  timezone?: string;
  readOnly?: boolean;
};

export type CalendarEvent = {
  id: CalendarEventId;
  calendarId: CalendarId;

  /** Stable iCalendar UID. */
  uid: string;

  title: string;
  description?: string;
  timing: CalendarEventTiming;

  status?: CalendarEventStatus;
  transparency?: CalendarEventTransparency;
  location?: string;
  url?: string;
  categories?: string[];
  priority?: number;

  recurrence?: CalendarEventRecurrence;
};

export type CalendarEventInput = Omit<CalendarEvent, 'id' | 'calendarId'>;

/**
 * Fields editable without changing resource identity, calendar ownership, or
 * the stable iCalendar UID.
 */
export type CalendarEventPatch = Partial<
  Omit<CalendarEvent, 'id' | 'calendarId' | 'uid'>
>;

export type CalendarTimeRange = {
  /** Inclusive ISO instant. */
  start: string;
  /** Exclusive ISO instant. */
  end: string;
};

export function isTimedCalendarEvent(
  event: CalendarEvent,
): event is CalendarEvent & { timing: TimedCalendarEventTiming } {
  return event.timing.type === 'timed';
}

export function isAllDayCalendarEvent(
  event: CalendarEvent,
): event is CalendarEvent & { timing: AllDayCalendarEventTiming } {
  return event.timing.type === 'all-day';
}
