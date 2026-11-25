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
  CalendarEventDateTime,
  CalendarEventDuration,
  CalendarEventRecurrenceTiming,
  CalendarEventTimedDateTime,
  CalendarEventTiming,
} from '@matrix-calendar-widget/calendar';
import ICAL from 'ical.js';
import { ICalendarEventCodecError } from './ICalendarCodecError';

export function readDateTimeProperty(
  property: ICAL.Property,
): CalendarEventDateTime {
  const value = property.getFirstValue();
  if (!(value instanceof ICAL.Time)) {
    throw new ICalendarEventCodecError(
      'invalid-timing',
      `${property.name.toUpperCase()} must be a date or date-time value`,
    );
  }

  return readDateTimeValue(value, property);
}

export function readDateTimeValue(
  value: ICAL.Time,
  property: ICAL.Property,
): CalendarEventDateTime {
  if (value.isDate) {
    return { type: 'date', value: formatDate(value) };
  }

  const tzid = property.getFirstParameter('tzid');
  if (typeof tzid === 'string' && tzid.length > 0) {
    return {
      type: 'date-time',
      value: { local: formatLocalDateTime(value), timezone: tzid },
    };
  }

  if (value.zone === ICAL.Timezone.utcTimezone) {
    return {
      type: 'date-time',
      value: { local: formatLocalDateTime(value), timezone: 'UTC' },
    };
  }

  return {
    type: 'floating-date-time',
    value: formatLocalDateTime(value),
  };
}

export function readRecurrenceTimingWithDuration(
  vevent: ICAL.Component,
): CalendarEventRecurrenceTiming {
  const startProperty = vevent.getFirstProperty('dtstart');
  const durationProperty = vevent.getFirstProperty('duration');
  const start = startProperty?.getFirstValue();
  const duration = durationProperty?.getFirstValue();

  if (
    !startProperty ||
    !(start instanceof ICAL.Time) ||
    !(duration instanceof ICAL.Duration)
  ) {
    throw new ICalendarEventCodecError(
      'invalid-timing',
      'Recurrence override DTSTART and DURATION must be date or date-time values',
    );
  }

  return {
    type: 'duration',
    start: readDateTimeValue(start, startProperty),
    duration: readDuration(duration),
  };
}

export function readRecurrenceTimingWithEnd(
  vevent: ICAL.Component,
): CalendarEventRecurrenceTiming {
  const startProperty = vevent.getFirstProperty('dtstart');
  const endProperty = vevent.getFirstProperty('dtend');
  const start = startProperty?.getFirstValue();
  const end = endProperty?.getFirstValue();

  if (
    !startProperty ||
    !endProperty ||
    !(start instanceof ICAL.Time) ||
    !(end instanceof ICAL.Time)
  ) {
    throw new ICalendarEventCodecError(
      'invalid-timing',
      'Recurrence override DTSTART and DTEND must be date or date-time values',
    );
  }

  if (start.isDate !== end.isDate) {
    throw new ICalendarEventCodecError(
      'invalid-timing',
      'Recurrence override DTSTART and DTEND must use the same value type',
    );
  }

  return {
    type: 'end',
    start: readDateTimeValue(start, startProperty),
    end: readDateTimeValue(end, endProperty),
  };
}

export function readDuration(duration: ICAL.Duration): CalendarEventDuration {
  return {
    weeks: duration.weeks,
    days: duration.days,
    hours: duration.hours,
    minutes: duration.minutes,
    seconds: duration.seconds,
    isNegative: duration.isNegative,
  };
}

export function readTiming(vevent: ICAL.Component): CalendarEventTiming {
  const startProperty = vevent.getFirstProperty('dtstart');
  const endProperty = vevent.getFirstProperty('dtend');

  if (!startProperty || !endProperty) {
    throw new ICalendarEventCodecError(
      'missing-timing',
      'VEVENT must contain DTSTART and DTEND',
    );
  }

  const start = startProperty.getFirstValue();
  const end = endProperty.getFirstValue();

  if (!(start instanceof ICAL.Time) || !(end instanceof ICAL.Time)) {
    throw new ICalendarEventCodecError(
      'invalid-timing',
      'VEVENT DTSTART and DTEND must be date or date-time values',
    );
  }

  if (start.isDate !== end.isDate) {
    throw new ICalendarEventCodecError(
      'invalid-timing',
      'VEVENT DTSTART and DTEND must use the same value type',
    );
  }

  if (start.isDate) {
    return {
      type: 'all-day',
      startDate: formatDate(start),
      endDate: formatDate(end),
    };
  }

  return {
    type: 'timed',
    start: readMasterDateTimeValue(start, startProperty),
    end: readMasterDateTimeValue(end, endProperty),
  };
}

export function readMasterDateTimeValue(
  time: ICAL.Time,
  property: ICAL.Property,
): CalendarEventTimedDateTime {
  const local = formatLocalDateTime(time);
  const tzid = property.getFirstParameter('tzid');
  if (typeof tzid === 'string' && tzid.length > 0) {
    return { type: 'zoned', local, timezone: tzid };
  }

  if (time.zone === ICAL.Timezone.utcTimezone) {
    return { type: 'zoned', local, timezone: 'UTC' };
  }

  return { type: 'floating', local };
}

export function formatDate(time: ICAL.Time): string {
  return [
    String(time.year).padStart(4, '0'),
    String(time.month).padStart(2, '0'),
    String(time.day).padStart(2, '0'),
  ].join('-');
}

export function formatLocalDateTime(time: ICAL.Time): string {
  return `${formatDate(time)}T${String(time.hour).padStart(2, '0')}:${String(
    time.minute,
  ).padStart(2, '0')}:${String(time.second).padStart(2, '0')}`;
}
