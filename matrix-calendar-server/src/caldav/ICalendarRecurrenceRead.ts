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
  CalendarEventDateTime,
  CalendarEventOccurrenceTextField,
  CalendarEventRecurrence,
  CalendarEventRecurrenceDate,
  CalendarEventRecurrenceOverride,
} from '@matrix-calendar-widget/calendar';
import ICAL from 'ical.js';
import {
  ICalendarEventCodecError,
  unsupportedRecurrencePatch,
} from './ICalendarCodecError';
import { readStatus, textValue } from './ICalendarEventFields';
import {
  readDateTimeProperty,
  readDateTimeValue,
  readDuration,
  readRecurrenceTimingWithDuration,
  readRecurrenceTimingWithEnd,
} from './ICalendarTiming';

export function readUnsupportedRecurrence(
  calendar: ICAL.Component,
  uid: string,
): CalendarEvent['unsupportedRecurrence'] {
  const hasThisAndFutureOverride = calendar
    .getAllSubcomponents('vevent')
    .some((vevent) => {
      const recurrenceId = vevent.getFirstProperty('recurrence-id');
      if (
        textValue(vevent.getFirstPropertyValue('uid')) !== uid ||
        !recurrenceId
      ) {
        return false;
      }

      return (
        recurrenceId.getFirstParameter('range')?.toUpperCase() ===
        'THISANDFUTURE'
      );
    });

  return hasThisAndFutureOverride ? 'range-this-and-future' : undefined;
}

export function findMasterEvent(
  calendar: ICAL.Component,
  uid?: string,
): ICAL.Component | undefined {
  const events = calendar.getAllSubcomponents('vevent');
  const matching = uid
    ? events.filter(
        (event) => textValue(event.getFirstPropertyValue('uid')) === uid,
      )
    : events;

  return (
    matching.find((event) => !event.hasProperty('recurrence-id')) ?? matching[0]
  );
}

export function readRecurrence(
  calendar: ICAL.Component,
  master: ICAL.Component,
  uid: string,
): CalendarEventRecurrence | undefined {
  const recurrence: CalendarEventRecurrence = {};
  const rule = master.getFirstPropertyValue('rrule');
  if (rule !== null && rule !== undefined) {
    recurrence.rrule = String(rule);
  }

  const rdates = readRecurrenceDates(master, 'rdate');
  const exdates = readRecurrenceDates(master, 'exdate');
  if (rdates.length > 0) {
    recurrence.rdates = rdates;
  }
  if (exdates.length > 0) {
    recurrence.exdates = exdates;
  }

  const masterRecurrenceId = master.getFirstProperty('recurrence-id');
  if (masterRecurrenceId) {
    recurrence.recurrenceId = readDateTimeProperty(masterRecurrenceId);
  }

  const overrides = calendar
    .getAllSubcomponents('vevent')
    .filter(
      (event) =>
        event !== master &&
        textValue(event.getFirstPropertyValue('uid')) === uid &&
        event.hasProperty('recurrence-id'),
    )
    .map(readRecurrenceOverride);
  if (overrides.length > 0) {
    recurrence.overrides = overrides;
  }

  return Object.keys(recurrence).length > 0 ? recurrence : undefined;
}

function readRecurrenceOverride(
  vevent: ICAL.Component,
): CalendarEventRecurrenceOverride {
  const recurrenceId = vevent.getFirstProperty('recurrence-id');
  if (!recurrenceId) {
    throw new ICalendarEventCodecError(
      'invalid-timing',
      'Recurrence override VEVENT must contain RECURRENCE-ID',
    );
  }

  const hasStart = vevent.hasProperty('dtstart');
  const hasEnd = vevent.hasProperty('dtend');
  const hasDuration = vevent.hasProperty('duration');

  const override: CalendarEventRecurrenceOverride = {
    recurrenceId: readDateTimeProperty(recurrenceId),
  };
  // Keep unsupported or incomplete exception timing in the raw resource, but
  // do not let it block decoding the recurrence identity and status.
  if (hasStart && hasEnd) {
    override.timing = readRecurrenceTimingWithEnd(vevent);
  } else if (hasStart && hasDuration) {
    override.timing = readRecurrenceTimingWithDuration(vevent);
  }

  const status = readStatus(vevent.getFirstPropertyValue('status'));
  if (status) {
    override.status = status;
  }

  Object.assign(override, readOccurrenceTextProperties(vevent));
  return override;
}

function readOccurrenceTextProperties(
  vevent: ICAL.Component,
): Pick<
  CalendarEventRecurrenceOverride,
  'title' | 'description' | 'location' | 'unsupportedText'
> {
  const fieldNames = [
    ['title', 'summary'],
    ['description', 'description'],
    ['location', 'location'],
  ] as const;
  const result: Pick<
    CalendarEventRecurrenceOverride,
    'title' | 'description' | 'location' | 'unsupportedText'
  > = {};
  const unsupportedText: Partial<
    Record<CalendarEventOccurrenceTextField, true>
  > = {};

  for (const [field, propertyName] of fieldNames) {
    const properties = vevent.getAllProperties(propertyName);
    if (properties.length === 0) {
      continue;
    }
    if (properties.length !== 1) {
      unsupportedText[field] = true;
      continue;
    }
    const property = properties[0];
    let values: ReturnType<ICAL.Property['getValues']>;
    try {
      values = property.getValues();
    } catch {
      unsupportedText[field] = true;
      continue;
    }
    const parameters = Object.keys(property.toJSON()[1]);
    if (
      property.type !== 'text' ||
      values.length !== 1 ||
      typeof values[0] !== 'string'
    ) {
      unsupportedText[field] = true;
      continue;
    }
    // A single scalar TEXT value is safe to display even when its parameters
    // make it read-only. The editor disables that field and preserves its raw
    // source line, while projection still shows the actual selected value.
    result[field] = values[0];
    if (parameters.length > 0) {
      unsupportedText[field] = true;
    }
  }

  if (Object.keys(unsupportedText).length > 0) {
    result.unsupportedText = unsupportedText;
  }
  return result;
}

function readRecurrenceDates(
  component: ICAL.Component,
  name: 'rdate',
): CalendarEventRecurrenceDate[];
function readRecurrenceDates(
  component: ICAL.Component,
  name: 'exdate',
): CalendarEventDateTime[];
function readRecurrenceDates(
  component: ICAL.Component,
  name: 'rdate' | 'exdate',
): CalendarEventRecurrenceDate[] {
  return component.getAllProperties(name).flatMap((property) => {
    let values: ReturnType<ICAL.Property['getValues']>;
    try {
      values = property.getValues();
    } catch {
      // Keep malformed source data opaque in the parsed VCALENDAR. RDATE writes
      // preflight the raw property and fail closed before changing it.
      return [];
    }
    return values.flatMap<CalendarEventRecurrenceDate>((value) => {
      if (value instanceof ICAL.Time) {
        return [readDateTimeValue(value, property)];
      }

      if (name === 'rdate' && value instanceof ICAL.Period) {
        try {
          return [readPeriodRdateValue(value, property)];
        } catch {
          return [];
        }
      }

      return [];
    });
  });
}

export function readPeriodRdateValue(
  value: ICAL.Period,
  property: ICAL.Property,
): Extract<CalendarEventRecurrenceDate, { type: 'period' }> {
  const start = value.start;
  const end = value.end;
  if (!(start instanceof ICAL.Time) || start.isDate) {
    throw unsupportedRecurrencePatch();
  }
  if (end instanceof ICAL.Time && !end.isDate) {
    if (start.compare(end) >= 0) {
      throw unsupportedRecurrencePatch();
    }
    return {
      type: 'period',
      timing: {
        type: 'end',
        start: readDateTimeValue(start, property),
        end: readDateTimeValue(end, property),
      },
    };
  }
  if (value.duration instanceof ICAL.Duration) {
    const duration = value.duration;
    const components = [
      duration.weeks,
      duration.days,
      duration.hours,
      duration.minutes,
      duration.seconds,
    ];
    if (
      duration.isNegative ||
      components.some(
        (component) => !Number.isSafeInteger(component) || component < 0,
      ) ||
      components.every((component) => component === 0) ||
      (duration.weeks > 0 &&
        [
          duration.days,
          duration.hours,
          duration.minutes,
          duration.seconds,
        ].some((component) => component > 0))
    ) {
      throw unsupportedRecurrencePatch();
    }
    return {
      type: 'period',
      timing: {
        type: 'duration',
        start: readDateTimeValue(start, property),
        duration: readDuration(duration),
      },
    };
  }
  throw unsupportedRecurrencePatch();
}
