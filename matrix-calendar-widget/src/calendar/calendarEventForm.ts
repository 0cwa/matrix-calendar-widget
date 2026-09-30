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
  CalendarEventPatch,
  CalendarEventTiming,
  CalendarEventWeekday,
  CalendarId,
  SupportedCalendarEventRecurrenceFrequency,
  calendarLocalDateTimeToUnixMillis,
  formatSupportedCalendarEventRecurrenceRule,
  isAllDayCalendarEvent,
  isTimedCalendarEvent,
  parseSupportedCalendarEventRecurrenceRule,
  type TimedCalendarEventTiming,
} from '@matrix-calendar-widget/calendar';
import { DateTime } from 'luxon';

export type CalendarEventFormValues = {
  calendarId: CalendarId;
  title: string;
  description: string;
  location: string;
  timingType: 'timed' | 'all-day';
  timedKind?: 'floating' | 'zoned' | 'mixed';
  start: string;
  end: string;
  timezone: string;
  timingChanged?: boolean;
  timezoneChanged?: boolean;
  originalTiming?: CalendarEventTiming;
  repeats?: boolean;
  recurrenceFrequency?: SupportedCalendarEventRecurrenceFrequency;
  recurrenceInterval?: string;
  recurrenceEnd?: 'never' | 'count' | 'until';
  recurrenceCount?: string;
  recurrenceUntil?: string;
  recurrenceWeekdays?: CalendarEventWeekday[];
  recurrenceEditable?: boolean;
  recurrenceDisabledReason?: 'complex' | 'unsupported';
  recurrenceChanged?: boolean;
};

export type CalendarEventValidationError =
  | 'title-required'
  | 'invalid-range'
  | 'invalid-timezone'
  | 'invalid-recurrence';

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
    timedKind: 'zoned',
    start: start.toFormat("yyyy-MM-dd'T'HH:mm"),
    end: end.toFormat("yyyy-MM-dd'T'HH:mm"),
    timezone,
    timingChanged: false,
    timezoneChanged: false,
    repeats: false,
    recurrenceFrequency: 'DAILY',
    recurrenceInterval: '1',
    recurrenceEnd: 'never',
    recurrenceCount: '2',
    recurrenceUntil: start.toISODate() ?? '',
    recurrenceEditable: true,
    recurrenceChanged: false,
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
      timedKind: 'zoned',
      start: event.timing.startDate,
      end:
        DateTime.fromISO(event.timing.endDate).minus({ days: 1 }).toISODate() ??
        event.timing.startDate,
      timezone: calendar.timezone ?? DateTime.local().zoneName ?? 'UTC',
      timingChanged: false,
      timezoneChanged: false,
      originalTiming: event.timing,
      ...recurrenceFormValues(event),
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
    timedKind: timedKindForTiming(event.timing),
    start: event.timing.start.local.slice(0, 16),
    end: event.timing.end.local.slice(0, 16),
    timezone:
      event.timing.start.type === 'zoned'
        ? event.timing.start.timezone
        : (calendar.timezone ?? DateTime.local().zoneName ?? 'UTC'),
    timingChanged: false,
    timezoneChanged: false,
    originalTiming: event.timing,
    ...recurrenceFormValues(event),
  };
}

function timedKindForTiming(
  timing: TimedCalendarEventTiming,
): NonNullable<CalendarEventFormValues['timedKind']> {
  if (timing.start.type === 'floating' && timing.end.type === 'floating') {
    return 'floating';
  }

  if (
    timing.start.type === 'zoned' &&
    timing.end.type === 'zoned' &&
    timing.start.timezone === timing.end.timezone
  ) {
    return 'zoned';
  }

  return 'mixed';
}

export function calendarEventInputFromForm(
  values: CalendarEventFormValues,
  uid: string,
): CalendarEventInput {
  const editableFields = calendarEventEditableFieldsFromForm(values);
  return {
    uid,
    ...editableFields,
    ...(values.repeats
      ? {
          recurrence: {
            rrule: recurrenceRuleFromForm(values, editableFields.timing),
          },
        }
      : {}),
  };
}

export function calendarEventPatchFromForm(
  values: CalendarEventFormValues,
): CalendarEventPatch {
  const editableFields = calendarEventEditableFieldsFromForm(values);
  const { timing, ...fields } = editableFields;
  const recurrenceNeedsAnchorUpdate =
    recurrenceUntilNeedsAnchorUpdate(values, timing) ||
    recurrenceWeekdayNeedsAnchorUpdate(values, timing);

  return {
    ...fields,
    ...(values.timingChanged === false ? {} : { timing }),
    description: normalizeOptional(values.description),
    location: normalizeOptional(values.location),
    ...(values.recurrenceChanged || recurrenceNeedsAnchorUpdate
      ? {
          recurrence: values.repeats
            ? { rrule: recurrenceRuleFromForm(values, timing) }
            : {},
        }
      : {}),
  };
}

function recurrenceUntilNeedsAnchorUpdate(
  values: CalendarEventFormValues,
  nextTiming: CalendarEventTiming,
): boolean {
  if (
    !values.repeats ||
    values.recurrenceEnd !== 'until' ||
    values.recurrenceEditable === false ||
    !values.originalTiming
  ) {
    return false;
  }

  const previousStart = timingStartAsDateTime(values.originalTiming);
  const nextStart = timingStartAsDateTime(nextTiming);
  if (previousStart.type !== nextStart.type) {
    return true;
  }

  return (
    previousStart.type === 'date-time' &&
    nextStart.type === 'date-time' &&
    previousStart.value.timezone !== nextStart.value.timezone
  );
}

function recurrenceWeekdayNeedsAnchorUpdate(
  values: CalendarEventFormValues,
  nextTiming: CalendarEventTiming,
): boolean {
  if (
    !values.repeats ||
    values.recurrenceEditable === false ||
    values.recurrenceFrequency !== 'WEEKLY' ||
    values.recurrenceWeekdays === undefined ||
    !values.originalTiming
  ) {
    return false;
  }

  return (
    startWeekdayForTiming(values.originalTiming) !==
    startWeekdayForTiming(nextTiming)
  );
}

export function validateCalendarEventForm(
  values: CalendarEventFormValues,
): CalendarEventValidationError | undefined {
  if (!values.title.trim()) {
    return 'title-required';
  }

  if (values.timingType === 'all-day') {
    const start = DateTime.fromISO(values.start);
    const end = DateTime.fromISO(values.end);

    if (!start.isValid || !end.isValid || end < start) {
      return 'invalid-range';
    }

    return validateRecurrence(
      values,
      calendarEventEditableFieldsFromForm(values).timing,
    );
  }

  const timedKind = values.timedKind ?? 'zoned';
  if (
    timedKind === 'zoned' &&
    (!values.timezone.trim() ||
      !DateTime.local().setZone(values.timezone).isValid)
  ) {
    return 'invalid-timezone';
  }

  const viewerTimezone = DateTime.local().zoneName ?? 'UTC';
  const start = DateTime.fromISO(values.start, {
    zone: formEndpointTimezone(values, 'start', viewerTimezone),
  });
  const end = DateTime.fromISO(values.end, {
    zone: formEndpointTimezone(values, 'end', viewerTimezone),
  });

  if (!start.isValid || !end.isValid || end <= start) {
    return 'invalid-range';
  }

  return validateRecurrence(
    values,
    calendarEventEditableFieldsFromForm(values).timing,
  );
}

function recurrenceFormValues(
  event: CalendarEvent,
): Pick<
  CalendarEventFormValues,
  | 'repeats'
  | 'recurrenceFrequency'
  | 'recurrenceInterval'
  | 'recurrenceEnd'
  | 'recurrenceCount'
  | 'recurrenceUntil'
  | 'recurrenceWeekdays'
  | 'recurrenceEditable'
  | 'recurrenceDisabledReason'
  | 'recurrenceChanged'
> {
  const recurrence = event.recurrence;
  const hasComplexData = Boolean(
    recurrence?.rdates?.length ||
    recurrence?.exdates?.length ||
    recurrence?.recurrenceId ||
    recurrence?.overrides?.length,
  );
  let parsed:
    | ReturnType<typeof parseSupportedCalendarEventRecurrenceRule>
    | undefined;
  let unsupportedRule = false;
  const hasRRule = Boolean(
    recurrence && Object.prototype.hasOwnProperty.call(recurrence, 'rrule'),
  );
  if (hasRRule) {
    if (typeof recurrence?.rrule !== 'string') {
      unsupportedRule = true;
    } else {
      try {
        parsed = parseSupportedCalendarEventRecurrenceRule(
          recurrence.rrule,
          timingStartAsDateTime(event.timing),
        );
      } catch {
        unsupportedRule = true;
      }
    }
  }

  const unsupported = Boolean(
    event.unsupportedTimezone || event.unsupportedRecurrence || unsupportedRule,
  );
  const end = parsed?.end;

  return {
    repeats: hasRRule,
    recurrenceFrequency: parsed?.frequency ?? 'DAILY',
    recurrenceInterval: String(parsed?.interval ?? 1),
    recurrenceEnd:
      end?.type === 'count'
        ? 'count'
        : end?.type === 'until'
          ? 'until'
          : 'never',
    recurrenceCount: end?.type === 'count' ? String(end.count) : '2',
    recurrenceUntil:
      end?.type === 'until'
        ? recurrenceUntilDate(end.value, event.timing)
        : eventDate(event),
    recurrenceWeekdays: parsed?.weekdays,
    recurrenceEditable: !hasComplexData && !unsupported,
    recurrenceDisabledReason: hasComplexData
      ? 'complex'
      : unsupported
        ? 'unsupported'
        : undefined,
    recurrenceChanged: false,
  };
}

function validateRecurrence(
  values: CalendarEventFormValues,
  timing: CalendarEventTiming,
): CalendarEventValidationError | undefined {
  if (!values.repeats || values.recurrenceEditable === false) {
    return undefined;
  }

  if (
    !/^\d+$/.test(values.recurrenceInterval ?? '') ||
    !Number.isSafeInteger(Number(values.recurrenceInterval ?? '')) ||
    Number(values.recurrenceInterval ?? '') <= 0 ||
    ((values.recurrenceEnd ?? 'never') === 'count' &&
      (!/^\d+$/.test(values.recurrenceCount ?? '') ||
        !Number.isSafeInteger(Number(values.recurrenceCount ?? '')) ||
        Number(values.recurrenceCount ?? '') <= 0))
  ) {
    return 'invalid-recurrence';
  }

  try {
    recurrenceRuleFromForm(values, timing);
    return undefined;
  } catch {
    return 'invalid-recurrence';
  }
}

function recurrenceRuleFromForm(
  values: CalendarEventFormValues,
  timing: CalendarEventTiming,
): string {
  const end =
    (values.recurrenceEnd ?? 'never') === 'count'
      ? { type: 'count' as const, count: Number(values.recurrenceCount ?? '2') }
      : (values.recurrenceEnd ?? 'never') === 'until'
        ? {
            type: 'until' as const,
            value: recurrenceUntilValue(values, timing),
          }
        : { type: 'never' as const };

  return formatSupportedCalendarEventRecurrenceRule(
    {
      frequency: values.recurrenceFrequency ?? 'DAILY',
      interval: Number(values.recurrenceInterval ?? '1'),
      end,
      ...(values.recurrenceWeekdays !== undefined &&
      (values.recurrenceFrequency ?? 'DAILY') === 'WEEKLY'
        ? {
            weekdays: normalizeFormWeekdays(values.recurrenceWeekdays, timing),
          }
        : {}),
    },
    timingStartAsDateTime(timing),
  );
}

const WEEKDAY_TOKENS: CalendarEventWeekday[] = [
  'MO',
  'TU',
  'WE',
  'TH',
  'FR',
  'SA',
  'SU',
];

function normalizeFormWeekdays(
  weekdays: CalendarEventWeekday[],
  timing: CalendarEventTiming,
): CalendarEventWeekday[] {
  return Array.from(new Set([...weekdays, startWeekdayForTiming(timing)])).sort(
    (left, right) =>
      WEEKDAY_TOKENS.indexOf(left) - WEEKDAY_TOKENS.indexOf(right),
  );
}

export function calendarEventFormStartWeekday(
  values: CalendarEventFormValues,
): CalendarEventWeekday {
  return startWeekdayForTiming(
    calendarEventEditableFieldsFromForm(values).timing,
  );
}

function startWeekdayForTiming(
  timing: CalendarEventTiming,
): CalendarEventWeekday {
  const start =
    timing.type === 'all-day' ? timing.startDate : timing.start.local;
  const date = DateTime.fromISO(start, { zone: 'UTC' });
  const weekday = WEEKDAY_TOKENS[date.weekday - 1];
  if (!date.isValid || !weekday) {
    throw new Error('Invalid DTSTART weekday');
  }
  return weekday;
}

function recurrenceUntilValue(
  values: CalendarEventFormValues,
  timing: CalendarEventTiming,
): string {
  const untilDate = values.recurrenceUntil ?? '';
  const date = DateTime.fromISO(untilDate, { zone: 'UTC' });
  if (!date.isValid || date.toISODate() !== untilDate) {
    throw new Error('Invalid recurrence end date');
  }

  if (timing.type === 'all-day') {
    return date.toFormat('yyyyLLdd');
  }

  const start = timing.start;
  const localEnd = `${untilDate}T23:59:59`;
  if (start.type === 'floating') {
    return localEnd.replace(/[-:]/g, '');
  }

  const instant = calendarLocalDateTimeToUnixMillis(localEnd, start.timezone);
  return DateTime.fromMillis(instant, { zone: 'UTC' }).toFormat(
    "yyyyLLdd'T'HHmmss'Z'",
  );
}

function timingStartAsDateTime(
  timing: CalendarEventTiming,
): CalendarEventDateTime {
  if (timing.type === 'all-day') {
    return { type: 'date', value: timing.startDate };
  }

  return timing.start.type === 'floating'
    ? { type: 'floating-date-time', value: timing.start.local }
    : {
        type: 'date-time',
        value: {
          local: timing.start.local,
          timezone: timing.start.timezone,
        },
      };
}

function recurrenceUntilDate(
  value: string,
  timing: CalendarEventTiming,
): string {
  const match = value.match(
    /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z?))?$/,
  );
  if (!match) {
    return '';
  }

  const date = `${match[1]}-${match[2]}-${match[3]}`;
  if (timing.type === 'all-day' || timing.start.type === 'floating') {
    return date;
  }

  if (!match[4] || match[7] !== 'Z') {
    return '';
  }

  const utc = DateTime.fromFormat(
    `${date}T${match[4]}:${match[5]}:${match[6]}Z`,
    "yyyy-MM-dd'T'HH:mm:ss'Z'",
    { zone: 'UTC' },
  );
  return utc.isValid
    ? (utc.setZone(timing.start.timezone).toISODate() ?? '')
    : '';
}

function eventDate(event: CalendarEvent): string {
  return event.timing.type === 'all-day'
    ? event.timing.startDate
    : event.timing.start.local.slice(0, 10);
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
            start: editableTimedEndpoint(values, 'start'),
            end: editableTimedEndpoint(values, 'end'),
          },
  };
}

function editableTimedEndpoint(
  values: CalendarEventFormValues,
  endpoint: 'start' | 'end',
) {
  const original =
    values.originalTiming?.type === 'timed'
      ? values.originalTiming[endpoint]
      : undefined;
  const local = values[endpoint];

  if (values.timedKind === 'floating') {
    return { type: 'floating' as const, local };
  }

  if (original && values.timedKind === 'mixed') {
    return { ...original, local };
  }

  if (original?.type === 'zoned' && !values.timezoneChanged) {
    return { ...original, local };
  }

  return { type: 'zoned' as const, local, timezone: values.timezone };
}

function formEndpointTimezone(
  values: CalendarEventFormValues,
  endpoint: 'start' | 'end',
  viewerTimezone: string,
): string {
  const timedKind = values.timedKind ?? 'zoned';
  if (timedKind === 'floating') {
    return viewerTimezone;
  }

  const original =
    values.originalTiming?.type === 'timed'
      ? values.originalTiming[endpoint]
      : undefined;
  if (timedKind === 'mixed') {
    if (original?.type === 'floating') {
      return viewerTimezone;
    }
    if (original?.type === 'zoned') {
      return original.timezone;
    }
  }

  return values.timezone;
}

function normalizeOptional(value: string): string | undefined {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}
