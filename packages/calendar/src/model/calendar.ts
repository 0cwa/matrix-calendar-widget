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
 * The explicit time mode and timezone on {@link ZonedCalendarDateTime} define
 * how the value is interpreted. Floating values retain wall-clock time without
 * a timezone; UTC values use UTC; TZID values use their named timezone.
 */
export type LocalCalendarDateTime = string;

/** How an iCalendar DATE-TIME is anchored in time. */
export type CalendarDateTimeMode = 'floating' | 'utc' | 'tzid';

export type ZonedCalendarDateTime = {
  local: LocalCalendarDateTime;
  timezone: string;
  /**
   * Explicit iCalendar value mode. Older callers may omit this; adapters
   * should set it when parsing so floating values are not mistaken for UTC.
   */
  mode?: CalendarDateTimeMode;
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

/** An RFC 5545 RDATE PERIOD value. */
export type CalendarEventRecurrencePeriod = {
  start: { type: 'date-time'; value: ZonedCalendarDateTime };
  end?: { type: 'date-time'; value: ZonedCalendarDateTime };
  /** Preserved iCalendar duration form, such as `PT90M` or `P1D`. */
  duration?: string;
};

export type CalendarEventStatus = 'confirmed' | 'tentative' | 'cancelled';

export type CalendarEventTransparency = 'opaque' | 'transparent';

export type CalendarEventRecurrenceRange = 'this-and-following';

/**
 * Supported fields from one RECURRENCE-ID VEVENT in a recurring resource.
 * The recurrenceId remains the original series start even if timing moves.
 */
export type CalendarEventRecurrenceOverride = {
  recurrenceId: CalendarEventDateTime;
  /** RFC 5545 RANGE=THISANDFUTURE timing override. */
  range?: CalendarEventRecurrenceRange;
  title?: string;
  description?: string;
  timing?: CalendarEventTiming;
  status?: CalendarEventStatus;
  transparency?: CalendarEventTransparency;
  location?: string;
  url?: string;
  categories?: string[];
  priority?: number;
};

/**
 * Recurrence source metadata.
 *
 * The RRULE string intentionally remains iCalendar-compatible so the existing
 * recurrence helpers can be reused while M5 grows richer recurrence editing.
 */
export type CalendarEventRecurrence = {
  rrule?: string;
  rdates?: CalendarEventDateTime[];
  rdatePeriods?: CalendarEventRecurrencePeriod[];
  exdates?: CalendarEventDateTime[];
  recurrenceId?: CalendarEventDateTime;
  /** Sibling exception VEVENTs carried by the same CalDAV resource. */
  overrides?: CalendarEventRecurrenceOverride[];
};

/** One expanded occurrence, retaining the stable original series identity. */
export type CalendarEventOccurrence = Omit<CalendarEvent, 'recurrence'> & {
  recurrenceId: CalendarEventDateTime;
};

export type Calendar = {
  id: CalendarId;
  name: string;
  description?: string;
  color?: string;
  timezone?: string;
  readOnly?: boolean;
  /** CalDAV component types this calendar also supports beyond VEVENT. */
  unsupportedComponents?: string[];
};

/**
 * Editable CalDAV collection properties. Omitted fields are unchanged; null
 * removes an optional property.
 */
export type CalendarMetadataPatch = {
  description?: string | null;
  color?: string | null;
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
  /** Opaque response-only marker; the source iCalendar component stays server-side. */
  unsupportedRecurrence?: string;
};

export type CalendarEventInput = Omit<
  CalendarEvent,
  'id' | 'calendarId' | 'unsupportedRecurrence'
>;

/**
 * Fields editable without changing resource identity, calendar ownership, or
 * the stable iCalendar UID.
 */
export type CalendarEventPatch = Partial<
  Omit<CalendarEvent, 'id' | 'calendarId' | 'uid' | 'unsupportedRecurrence'>
>;

/** Editable values for one detached recurrence override, excluding series data. */
export type CalendarEventOccurrencePatch = Omit<
  Partial<
    Pick<
      CalendarEvent,
      | 'title'
      | 'description'
      | 'timing'
      | 'transparency'
      | 'location'
      | 'url'
      | 'categories'
      | 'priority'
    >
  >,
  'description' | 'location' | 'url' | 'priority'
> & {
  /** Null removes an optional property from the detached VEVENT. */
  description?: string | null;
  location?: string | null;
  url?: string | null;
  priority?: number | null;
};

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
