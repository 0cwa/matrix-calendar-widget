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
  CalendarEventDateTime,
  CalendarEventInput,
  CalendarEventOccurrencePatch,
  CalendarEventPatch,
  CalendarEventRecurrence,
  CalendarEventTiming,
  CalendarId,
  isAllDayCalendarEvent,
  isCalendarEventRecurrenceRuleSupported,
  isTimedCalendarEvent,
} from '@matrix-calendar-widget/calendar';
import { DateTime } from 'luxon';

export type CalendarEventRecurrenceDateMode =
  | 'date'
  | 'floating'
  | 'utc'
  | 'tzid';

export type CalendarEventRecurrenceDateValue = {
  mode: CalendarEventRecurrenceDateMode;
  value: string;
  timezone: string;
};

export type CalendarEventRecurrenceFormValues = {
  /** Original domain value is retained until a user changes recurrence. */
  original?: CalendarEventRecurrence;
  rule?: string;
  ruleEditable: boolean;
  ruleEdited: boolean;
  ruleValid: boolean;
  rdates: CalendarEventRecurrenceDateValue[];
  rdatesEdited: boolean;
  exdates: CalendarEventRecurrenceDateValue[];
  exdatesEdited: boolean;
};

export type CalendarEventFormValues = {
  calendarId: CalendarId;
  title: string;
  description: string;
  location: string;
  timingType: 'timed' | 'all-day';
  start: string;
  end: string;
  timezone: string;
  recurrence: CalendarEventRecurrenceFormValues;
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
    recurrence: recurrenceFormValuesFromDomain(undefined, 'timed', timezone),
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
      recurrence: recurrenceFormValuesFromDomain(
        event.recurrence,
        'all-day',
        calendar.timezone ?? DateTime.local().zoneName,
      ),
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
    recurrence: recurrenceFormValuesFromDomain(
      event.recurrence,
      'timed',
      event.timing.start.timezone,
    ),
  };
}

export function calendarEventInputFromForm(
  values: CalendarEventFormValues,
  uid: string,
): CalendarEventInput {
  const recurrence = calendarEventRecurrenceFromForm(
    values.recurrence,
    values.timingType,
    values.timezone,
  );
  return {
    uid,
    ...calendarEventEditableFieldsFromForm(values),
    ...(recurrence ? { recurrence } : {}),
  };
}

export function calendarEventPatchFromForm(
  values: CalendarEventFormValues,
): CalendarEventPatch {
  const recurrence = calendarEventRecurrenceFromForm(
    values.recurrence,
    values.timingType,
    values.timezone,
  );
  return {
    ...calendarEventEditableFieldsFromForm(values),
    description: normalizeOptional(values.description),
    location: normalizeOptional(values.location),
    ...(recurrence !== undefined ? { recurrence } : {}),
  };
}

export function calendarEventOccurrencePatchFromForm(
  values: CalendarEventFormValues,
): CalendarEventOccurrencePatch {
  const description = normalizeOptional(values.description);
  const location = normalizeOptional(values.location);
  return {
    title: values.title.trim(),
    description: description ?? null,
    location: location ?? null,
    timing: calendarEventTimingFromForm(values),
  };
}

export function calendarEventTimingFromForm(
  values: CalendarEventFormValues,
): CalendarEventTiming {
  const mode =
    values.timezone === 'UTC'
      ? 'utc'
      : values.timezone === 'floating'
        ? 'floating'
        : 'tzid';
  return values.timingType === 'all-day'
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
          local: `${values.start}:00`,
          timezone: values.timezone,
          mode,
        },
        end: {
          local: `${values.end}:00`,
          timezone: values.timezone,
          mode,
        },
      };
}

export function recurrenceDateValueFromForm(
  value: CalendarEventRecurrenceDateValue,
): CalendarEventDateTime | undefined {
  if (value.mode === 'date') {
    const date = DateTime.fromISO(value.value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value.value) || !date.isValid) {
      return undefined;
    }
    return { type: 'date', value: value.value };
  }

  const zone =
    value.mode === 'tzid'
      ? value.timezone
      : value.mode === 'utc'
        ? 'UTC'
        : 'floating';
  const dateTime = DateTime.fromISO(value.value, {
    zone: zone === 'floating' ? 'UTC' : zone,
  });
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value.value) ||
    !dateTime.isValid ||
    (value.mode === 'tzid' && !DateTime.local().setZone(value.timezone).isValid)
  ) {
    return undefined;
  }

  return {
    type: 'date-time',
    value: {
      local: value.value.length === 16 ? `${value.value}:00` : value.value,
      timezone: zone,
      mode: value.mode === 'tzid' ? 'tzid' : value.mode,
    },
  };
}

export function hasInvalidCalendarEventRecurrenceFormValues(
  values: CalendarEventRecurrenceFormValues,
  timingType: CalendarEventFormValues['timingType'],
  timezone: string,
): boolean {
  if (
    values.ruleEdited &&
    (!values.ruleValid ||
      (values.rule &&
        !isCalendarEventRecurrenceRuleSupported(
          values.rule,
          timingType,
          timezone,
        )))
  ) {
    return true;
  }

  const recurrenceEdited =
    values.ruleEdited || values.rdatesEdited || values.exdatesEdited;
  if (!recurrenceEdited) {
    return false;
  }

  if (
    timingType === 'all-day' &&
    (values.original?.rdatePeriods?.length ?? 0) > 0
  ) {
    return true;
  }

  return [...values.rdates, ...values.exdates].some(
    (value) =>
      recurrenceDateValueFromForm(value) === undefined ||
      !recurrenceDateValueMatchesTimingType(value, timingType),
  );
}

export function recurrenceDateValueMatchesTimingType(
  value: CalendarEventRecurrenceDateValue,
  timingType: CalendarEventFormValues['timingType'],
): boolean {
  return timingType === 'all-day'
    ? value.mode === 'date'
    : value.mode !== 'date';
}

export function hasRecurrenceDateTypeMismatch(
  values: CalendarEventRecurrenceFormValues,
  timingType: CalendarEventFormValues['timingType'],
): boolean {
  const recurrenceEdited =
    values.ruleEdited || values.rdatesEdited || values.exdatesEdited;
  if (!recurrenceEdited) {
    return false;
  }

  return (
    (timingType === 'all-day' &&
      (values.original?.rdatePeriods?.length ?? 0) > 0) ||
    [...values.rdates, ...values.exdates].some(
      (value) => !recurrenceDateValueMatchesTimingType(value, timingType),
    )
  );
}

function recurrenceFormValuesFromDomain(
  recurrence?: CalendarEventRecurrence,
  timingType: CalendarEventFormValues['timingType'] = 'timed',
  timezone = 'UTC',
): CalendarEventRecurrenceFormValues {
  const ruleEditable = isCalendarEventRecurrenceRuleSupported(
    recurrence?.rrule,
    timingType,
    timezone,
  );
  return {
    original: recurrence,
    rule: ruleEditable ? recurrence?.rrule : undefined,
    ruleEditable,
    ruleEdited: false,
    ruleValid: true,
    rdates: (recurrence?.rdates ?? []).map(recurrenceDateValueToForm),
    rdatesEdited: false,
    exdates: (recurrence?.exdates ?? []).map(recurrenceDateValueToForm),
    exdatesEdited: false,
  };
}

function recurrenceDateValueToForm(
  value: CalendarEventDateTime,
): CalendarEventRecurrenceDateValue {
  if (value.type === 'date') {
    return { mode: 'date', value: value.value, timezone: '' };
  }

  const mode =
    value.value.mode ??
    (value.value.timezone === 'UTC'
      ? 'utc'
      : value.value.timezone === 'floating'
        ? 'floating'
        : 'tzid');
  return {
    mode,
    value: value.value.local,
    timezone: mode === 'tzid' ? value.value.timezone : '',
  };
}

function calendarEventRecurrenceFromForm(
  values: CalendarEventRecurrenceFormValues,
  timingType: CalendarEventFormValues['timingType'],
  timezone: string,
): CalendarEventRecurrence | undefined {
  if (!values.ruleEdited && !values.rdatesEdited && !values.exdatesEdited) {
    return undefined;
  }

  if (
    hasInvalidCalendarEventRecurrenceFormValues(values, timingType, timezone)
  ) {
    throw new Error('Invalid recurrence values');
  }

  const recurrence: CalendarEventRecurrence = { ...values.original };
  if (values.ruleEdited) {
    if (values.rule) {
      recurrence.rrule = values.rule;
    } else {
      delete recurrence.rrule;
    }
  }
  if (values.rdatesEdited) {
    recurrence.rdates = values.rdates
      .map(recurrenceDateValueFromForm)
      .map(requireRecurrenceDateValue);
  }
  if (values.exdatesEdited) {
    recurrence.exdates = values.exdates
      .map(recurrenceDateValueFromForm)
      .map(requireRecurrenceDateValue);
  }

  return recurrence;
}

function requireRecurrenceDateValue(
  value: CalendarEventDateTime | undefined,
): CalendarEventDateTime {
  if (!value) {
    throw new Error('Invalid recurrence date value');
  }
  return value;
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
