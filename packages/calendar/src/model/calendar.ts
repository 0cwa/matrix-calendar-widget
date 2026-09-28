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
 * Local wall-clock date/time in ISO form without a numeric UTC offset. A
 * recurrence value may keep it floating or pair it with a named IANA zone.
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
  TimedCalendarEventTiming | AllDayCalendarEventTiming;

export type CalendarEventDateTime =
  | { type: 'date-time'; value: ZonedCalendarDateTime }
  | { type: 'floating-date-time'; value: LocalCalendarDateTime }
  | { type: 'date'; value: CalendarDate };

/** RFC 5545 DURATION components; week/day units stay distinct from time units. */
export type CalendarEventDuration = {
  weeks: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  isNegative: boolean;
};

/** Recurrence timing keeps an explicit end separate from an RFC duration. */
export type CalendarEventRecurrenceTiming =
  | {
      type: 'end';
      start: CalendarEventDateTime;
      end: CalendarEventDateTime;
    }
  | {
      type: 'duration';
      start: CalendarEventDateTime;
      duration: CalendarEventDuration;
    };

/** A PERIOD-valued RDATE with its explicit end or RFC duration. */
export type CalendarEventRecurrenceDate =
  | CalendarEventDateTime
  | { type: 'period'; timing: CalendarEventRecurrenceTiming };

export type CalendarEventStatus = 'confirmed' | 'tentative' | 'cancelled';

export type CalendarEventTransparency = 'opaque' | 'transparent';

/**
 * Supported timing and cancellation data from one detached VEVENT in a
 * recurring CalDAV resource.
 */
export type CalendarEventRecurrenceOverride = {
  /** Original occurrence identity, even when the instance has moved. */
  recurrenceId: CalendarEventDateTime;
  timing?: CalendarEventRecurrenceTiming;
  status?: CalendarEventStatus;
};

/**
 * Recurrence source metadata.
 *
 * The RRULE string intentionally remains iCalendar-compatible so the existing
 * recurrence helpers can be reused while M5 grows richer recurrence editing.
 */
export type CalendarEventRecurrence = {
  rrule?: string;
  rdates?: CalendarEventRecurrenceDate[];
  exdates?: CalendarEventDateTime[];
  recurrenceId?: CalendarEventDateTime;
  /** Same-UID detached VEVENTs stored in this CalDAV resource. */
  overrides?: CalendarEventRecurrenceOverride[];
};

export type Calendar = {
  id: CalendarId;
  name: string;
  description?: string;
  color?: string;
  timezone?: string;
  readOnly?: boolean;
  /** Component types advertised by CalDAV, when the server reports them. */
  supportedComponents?: string[];
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
