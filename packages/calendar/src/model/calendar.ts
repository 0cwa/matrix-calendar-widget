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
 * Local wall-clock date/time in ISO form without a numeric UTC offset. Master
 * and recurrence values may keep it floating or pair it with a named zone.
 */
export type LocalCalendarDateTime = string;

export type ZonedCalendarDateTime = {
  local: LocalCalendarDateTime;
  timezone: string;
};

/** A master-event time endpoint keeps its own floating or zoned value kind. */
export type CalendarEventTimedDateTime =
  | { type: 'floating'; local: LocalCalendarDateTime }
  | { type: 'zoned'; local: LocalCalendarDateTime; timezone: string };

/**
 * Timed events preserve each endpoint's iCalendar value kind. Floating values
 * keep only their local wall time; zoned values keep the local time and zone.
 */
export type TimedCalendarEventTiming = {
  type: 'timed';
  start: CalendarEventTimedDateTime;
  end: CalendarEventTimedDateTime;
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

/** RFC 5545 weekday tokens used by the bounded weekly recurrence editor. */
export type CalendarEventWeekday =
  | 'MO'
  | 'TU'
  | 'WE'
  | 'TH'
  | 'FR'
  | 'SA'
  | 'SU';

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

/**
 * Recurrence fields accepted by supported write operations. RRULE edits change
 * only the master rule; EXDATE operations target one original occurrence
 * identity. RDATE and detached instances remain read-only resource data.
 */
export type CalendarEventRecurrenceWrite =
  | {
      /** An empty object on a patch clears only the master RRULE. */
      rrule?: string;
    }
  | {
      /** Add or remove only the EXDATE matching this original recurrence ID. */
      exdate: {
        action: 'add' | 'remove';
        recurrenceId: CalendarEventDateTime;
      };
    };

/** Recurrence semantics retained by CalDAV but not safely projected by UI. */
export type CalendarEventUnsupportedRecurrence = 'range-this-and-future';

/** Read-only marker for timezone semantics that are unsafe to project. */
export type CalendarEventUnsupportedTimezone = true;

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
  /** Read-only warning marker derived from recurrence data in the resource. */
  unsupportedRecurrence?: CalendarEventUnsupportedRecurrence;
  /** Read-only marker for an unknown or conflicting embedded VTIMEZONE. */
  unsupportedTimezone?: CalendarEventUnsupportedTimezone;
};

export type CalendarEventInput = Omit<
  CalendarEvent,
  | 'id'
  | 'calendarId'
  | 'recurrence'
  | 'unsupportedRecurrence'
  | 'unsupportedTimezone'
> & { recurrence?: { rrule?: string } };

/**
 * Fields editable without changing resource identity, calendar ownership, or
 * the stable iCalendar UID.
 */
export type CalendarEventPatch = Partial<
  Omit<
    CalendarEvent,
    | 'id'
    | 'calendarId'
    | 'uid'
    | 'recurrence'
    | 'unsupportedRecurrence'
    | 'unsupportedTimezone'
  >
> & { recurrence?: CalendarEventRecurrenceWrite };

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
