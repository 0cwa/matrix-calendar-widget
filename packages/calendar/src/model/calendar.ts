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

import type { CalendarEventExternalLink } from './calendarEventExternalLink';

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

/**
 * A relative display alarm's positive lead time before DTSTART. The CalDAV
 * codec serializes this magnitude as a negative RFC 5545 TRIGGER duration.
 */
export type CalendarEventAlarmLeadTime = Omit<
  CalendarEventDuration,
  'isNegative'
>;

/** One editable RFC 5545 ACTION:DISPLAY alarm relative to DTSTART. */
export type CalendarEventDisplayAlarm = {
  action: 'display';
  /** RFC 9074 identity retained when present; legacy VALARMs may omit it. */
  uid?: string;
  trigger: CalendarEventAlarmLeadTime;
};

/** Alarm values accepted on writes; the server owns and generates the UID. */
export type CalendarEventDisplayAlarmInput = Omit<
  CalendarEventDisplayAlarm,
  'uid'
>;

/** Explicit serializable operation that removes an existing display alarm. */
export type CalendarEventAlarmRemoval = { operation: 'remove' };

/** Alarm value accepted by an event patch, including its remove operation. */
export type CalendarEventAlarmPatch =
  | CalendarEventDisplayAlarmInput
  | CalendarEventAlarmRemoval;

/** Alarm data retained by CalDAV but outside the editor's supported shape. */
export type CalendarEventUnsupportedAlarm = true;

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

/** Timing requested for a bounded "this and following" recurrence edit. */
export type CalendarEventFollowingTimingWrite = {
  action: 'set-timing';
  recurrenceId: CalendarEventDateTime;
  timing: CalendarEventRecurrenceTiming;
  /** Required projection context for DATE/floating interval validation. */
  viewerTimezone: string;
};

/** A PERIOD-valued RDATE with its explicit end or RFC duration. */
export type CalendarEventRecurrenceDate =
  | CalendarEventDateTime
  | { type: 'period'; timing: CalendarEventRecurrenceTiming };

export type CalendarEventStatus = 'confirmed' | 'tentative' | 'cancelled';

/**
 * Read-only RFC 5545 revision metadata projected from a VEVENT.
 * Timestamp values use whole-second ISO 8601 UTC form.
 */
export type CalendarEventRevision = Readonly<{
  dtstamp?: string;
  created?: string;
  lastModified?: string;
  /** Supported RFC 5545 SEQUENCE INTEGER range is 0 through 2147483647. */
  sequence?: number;
}>;

/** RFC 5545 weekday tokens used by the bounded weekly recurrence editor. */
export type CalendarEventWeekday =
  | 'MO'
  | 'TU'
  | 'WE'
  | 'TH'
  | 'FR'
  | 'SA'
  | 'SU';

/** One bounded MONTHLY BYDAY selector supported by the recurrence editor. */
export type CalendarEventWeekdayOrdinal = {
  ordinal: 1 | 2 | 3 | 4 | 5 | -1;
  weekday: CalendarEventWeekday;
};

export type CalendarEventTransparency = 'opaque' | 'transparent';

/**
 * Supported timing and cancellation data from one detached VEVENT in a
 * recurring CalDAV resource.
 */
export type CalendarEventOccurrenceTextField =
  | 'title'
  | 'description'
  | 'location';

export type CalendarEventOccurrenceTextOperation =
  | { action: 'set'; value: string }
  | { action: 'inherit' };

/** Sparse text/timing changes for exactly one original occurrence identity. */
export type CalendarEventOccurrenceWrite =
  | {
      /** Legacy timing-only operation retained for existing clients. */
      action: 'set-timing';
      recurrenceId: CalendarEventDateTime;
      timing: CalendarEventRecurrenceTiming;
      viewerTimezone: string;
    }
  | {
      /** Set selected instance text fields; timing is optional. */
      action: 'set-fields';
      recurrenceId: CalendarEventDateTime;
      timing?: CalendarEventRecurrenceTiming;
      viewerTimezone: string;
      title?: CalendarEventOccurrenceTextOperation;
      description?: CalendarEventOccurrenceTextOperation;
      location?: CalendarEventOccurrenceTextOperation;
    };

/**
 * Supported values from one detached VEVENT. Missing text fields inherit the
 * master property. Unsupported text property shapes are identified per field
 * and remain preserved without authoring them.
 */
export type CalendarEventRecurrenceOverride = {
  /** Original occurrence identity, even when the instance has moved. */
  recurrenceId: CalendarEventDateTime;
  timing?: CalendarEventRecurrenceTiming;
  status?: CalendarEventStatus;
  title?: string;
  description?: string;
  location?: string;
  unsupportedText?: Partial<
    Record<CalendarEventOccurrenceTextField, true>
  >;
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
 * identity; RDATE operations add/remove point values or remove one exact
 * PERIOD value, add one positive-duration or explicit-end PERIOD, or
 * atomically replace one exact existing PERIOD value. Occurrence writes
 * change one original recurrence identity without changing the master event;
 * they may set timing and sparse title/description/location values, including
 * explicit inheritance. Following timing writes materialize a bounded finite
 * suffix in the same resource.
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
    }
  | {
      /** Change timing for exactly one supported original recurrence identity. */
      occurrence: CalendarEventOccurrenceWrite;
    }
  | {
      /** Apply timing to one supported finite recurrence suffix. */
      following: CalendarEventFollowingTimingWrite;
    }
  | {
      /** Add or remove one exact DATE or DATE-TIME RDATE value. */
      rdate:
        | {
            action: 'add' | 'remove';
            value: CalendarEventDateTime;
          }
        | {
            /** Add one positive-duration or explicit-end PERIOD RDATE. */
            action: 'add-period';
            value: Extract<CalendarEventRecurrenceDate, { type: 'period' }>;
          }
        | {
            /** Remove one exact existing PERIOD value. */
            action: 'remove-period';
            value: Extract<CalendarEventRecurrenceDate, { type: 'period' }>;
          }
        | {
            /** Replace one exact existing PERIOD value without touching siblings. */
            action: 'replace-period';
            value: Extract<CalendarEventRecurrenceDate, { type: 'period' }>;
            replacement: Extract<
              CalendarEventRecurrenceDate,
              { type: 'period' }
            >;
          };
    };

/** Recurrence semantics retained by CalDAV but not safely projected by UI. */
export type CalendarEventUnsupportedRecurrence = 'range-this-and-future';

/** Read-only marker for timezone semantics that are unsafe to project. */
export type CalendarEventUnsupportedTimezone = true;

/** One bounded RFC 7986 CONFERENCE property accepted on event creation. */
export type CalendarEventConferenceInput = {
  url: string;
  /** Omission clears any LABEL parameter when replacing an existing value. */
  label?: string;
};

/** Explicit whole-property operation accepted on a master-event patch. */
export type CalendarEventConferencePatch =
  | ({ action: 'set' } & CalendarEventConferenceInput)
  | { action: 'remove' };

/** Read-only warning for CONFERENCE source data outside the write subset. */
export type CalendarEventUnsupportedConference = true;

export type Calendar = {
  id: CalendarId;
  name: string;
  description?: string;
  color?: string;
  timezone?: string;
  readOnly?: boolean;
  /** The collection itself is provisioned and managed outside the widget. */
  operatorManaged?: boolean;
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

  /** Read-only revision metadata; writes are managed by the iCalendar codec. */
  readonly revision?: CalendarEventRevision;
  /** Safe external links projected from the resource by the iCalendar codec. */
  readonly externalLinks?: readonly CalendarEventExternalLink[];
  /** The source CONFERENCE property cannot be changed by this editor. */
  unsupportedConference?: CalendarEventUnsupportedConference;

  status?: CalendarEventStatus;
  transparency?: CalendarEventTransparency;
  location?: string;
  url?: string;
  categories?: string[];
  priority?: number;

  recurrence?: CalendarEventRecurrence;
  /** One supported DISPLAY alarm, when the resource contains one. */
  alarm?: CalendarEventDisplayAlarm;
  /** An existing alarm shape is retained but cannot safely be edited. */
  unsupportedAlarm?: CalendarEventUnsupportedAlarm;
  /** Read-only warning marker derived from recurrence data in the resource. */
  unsupportedRecurrence?: CalendarEventUnsupportedRecurrence;
  /** Read-only marker for an unknown or conflicting embedded VTIMEZONE. */
  unsupportedTimezone?: CalendarEventUnsupportedTimezone;
};

export type CalendarEventInput = Omit<
  CalendarEvent,
  | 'id'
  | 'calendarId'
  | 'alarm'
  | 'recurrence'
  | 'unsupportedRecurrence'
  | 'unsupportedAlarm'
  | 'unsupportedTimezone'
  | 'unsupportedConference'
  | 'revision'
  | 'externalLinks'
> & {
  alarm?: CalendarEventDisplayAlarmInput;
  recurrence?: { rrule?: string };
  conference?: CalendarEventConferenceInput;
};

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
    | 'alarm'
    | 'unsupportedAlarm'
    | 'unsupportedRecurrence'
    | 'unsupportedTimezone'
    | 'unsupportedConference'
    | 'revision'
    | 'externalLinks'
  >
> & {
  alarm?: CalendarEventAlarmPatch;
  recurrence?: CalendarEventRecurrenceWrite;
  conference?: CalendarEventConferencePatch;
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

export function isCalendarEventAlarmRemoval(
  value: unknown,
): value is CalendarEventAlarmRemoval {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    (value as Record<string, unknown>).operation === 'remove'
  );
}
