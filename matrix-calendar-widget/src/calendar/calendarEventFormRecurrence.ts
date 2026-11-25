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
  CalendarEventDuration,
  CalendarEventRecurrenceDate,
  CalendarEventTiming,
  CalendarEventWeekday,
  CalendarEventWeekdayOrdinal,
  calendarEventRecurrenceIdentity,
  calendarLocalDateTimeToUnixMillis,
  formatSupportedCalendarEventRecurrenceRule,
  isSupportedCalendarEventOccurrenceExclusion,
  parseSupportedCalendarEventRecurrenceRule,
} from '@matrix-calendar-widget/calendar';
import { DateTime } from 'luxon';
import type {
  CalendarEventFormValues,
  CalendarEventValidationError,
} from './calendarEventForm';

export function recurrenceUntilNeedsAnchorUpdate(
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

export function recurrenceWeekdayNeedsAnchorUpdate(
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

export function validateRdateOperation(
  values: CalendarEventFormValues,
): CalendarEventValidationError | undefined {
  if (!values.rdateChanged) {
    return undefined;
  }

  if (
    !values.rdateOperation ||
    values.recurrenceChanged ||
    values.timingChanged === true ||
    values.timezoneChanged === true
  ) {
    return 'invalid-recurrence';
  }

  if (values.rdateOperation.action === 'add-period') {
    const period = values.rdateOperation.value;
    if (
      values.timingType !== 'timed' ||
      values.originalTiming?.type !== 'timed' ||
      values.rdateEditable === false ||
      period.type !== 'period' ||
      period.timing.type !== 'duration' ||
      period.timing.start.type === 'date' ||
      !isPositiveRfcDuration(period.timing.duration)
    ) {
      return 'invalid-rdate';
    }
  } else if (values.rdateOperation.action === 'replace-period') {
    const { value, replacement } = values.rdateOperation;
    const source = values.rdateEditSource;
    const sourceMatches = (values.rdateValues ?? []).filter(
      (candidate) =>
        candidate.type === 'period' &&
        recurrencePeriodIdentity(candidate) === recurrencePeriodIdentity(value),
    ).length;
    if (
      values.timingType !== 'timed' ||
      values.originalTiming?.type !== 'timed' ||
      values.rdateEditable === false ||
      !source ||
      recurrencePeriodIdentity(source) !== recurrencePeriodIdentity(value) ||
      sourceMatches !== 1 ||
      !isEditablePeriodReplacement(source, replacement)
    ) {
      return 'invalid-rdate';
    }
  }
}

export function validateExdateOperation(
  values: CalendarEventFormValues,
): CalendarEventValidationError | undefined {
  if (!values.exdateChanged) {
    return undefined;
  }

  if (
    !values.exdateOperation ||
    values.rdateChanged ||
    values.recurrenceChanged ||
    values.timingChanged === true ||
    values.timezoneChanged === true
  ) {
    return 'invalid-recurrence';
  }
}

export function recurrenceFormValues(
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
  | 'recurrenceMonthlyByDay'
  | 'recurrenceMonthlyOrdinal'
  | 'recurrenceMonthlyWeekday'
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
    recurrenceMonthlyByDay: parsed?.weekdayOrdinal !== undefined,
    ...(parsed?.weekdayOrdinal
      ? {
          recurrenceMonthlyOrdinal: String(parsed.weekdayOrdinal.ordinal),
          recurrenceMonthlyWeekday: parsed.weekdayOrdinal.weekday,
        }
      : {}),
    recurrenceEditable: !hasComplexData && !unsupported,
    recurrenceDisabledReason: hasComplexData
      ? 'complex'
      : unsupported
        ? 'unsupported'
        : undefined,
    recurrenceChanged: false,
  };
}

export function recurrenceRdateFormValues(
  event: CalendarEvent,
): Pick<
  CalendarEventFormValues,
  'rdateEditable' | 'rdateDraft' | 'rdateValues' | 'rdateChanged'
> {
  const recurrence = event.recurrence;
  const recurrenceDates = recurrence?.rdates ?? [];
  let supportedRule = recurrence?.rrule === undefined;
  if (recurrence?.rrule !== undefined) {
    try {
      parseSupportedCalendarEventRecurrenceRule(
        recurrence.rrule,
        timingStartAsDateTime(event.timing),
      );
      supportedRule = true;
    } catch {
      supportedRule = false;
    }
  }

  const anchor = timingStartAsDateTime(event.timing);
  return {
    rdateEditable: Boolean(
      recurrence &&
      (recurrence.rrule !== undefined || recurrenceDates.length > 0) &&
      !recurrence.recurrenceId &&
      !event.unsupportedRecurrence &&
      !event.unsupportedTimezone &&
      supportedRule,
    ),
    rdateDraft:
      anchor.type === 'date'
        ? anchor.value
        : anchor.type === 'date-time'
          ? anchor.value.local.slice(0, 16)
          : anchor.value.slice(0, 16),
    rdateValues: recurrenceDates,
    rdateChanged: false,
  };
}

export function recurrenceExdateFormValues(
  event: CalendarEvent,
): Pick<
  CalendarEventFormValues,
  'exdateEditable' | 'exdateValues' | 'exdateChanged'
> {
  const recurrence = event.recurrence;
  const exdateValues = recurrence?.exdates ?? [];

  return {
    exdateEditable: Boolean(
      recurrence &&
      exdateValues.length > 0 &&
      !recurrence.recurrenceId &&
      exdateValues.every((recurrenceId) =>
        isSupportedCalendarEventOccurrenceExclusion(event, recurrenceId),
      ),
    ),
    exdateValues,
    exdateChanged: false,
  };
}

export function calendarEventRdateValueFromForm(
  values: CalendarEventFormValues,
): CalendarEventDateTime | undefined {
  const draft = values.rdateDraft?.trim();
  if (!draft) {
    return undefined;
  }

  const anchor = values.originalTiming
    ? timingStartAsDateTime(values.originalTiming)
    : undefined;
  if (values.timingType === 'all-day' || anchor?.type === 'date') {
    return { type: 'date', value: draft };
  }

  const local = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(draft)
    ? `${draft}:00`
    : draft;
  if (anchor?.type === 'floating-date-time') {
    return { type: 'floating-date-time', value: local };
  }
  if (anchor?.type === 'date-time') {
    return {
      type: 'date-time',
      value: { local, timezone: anchor.value.timezone },
    };
  }
  return undefined;
}

export function calendarEventRdatePeriodDurationFromForm(
  values: CalendarEventFormValues,
): CalendarEventDuration | undefined {
  const rawUnits = [
    values.rdatePeriodWeeks,
    values.rdatePeriodDays,
    values.rdatePeriodHours,
    values.rdatePeriodMinutes,
    values.rdatePeriodSeconds,
  ].map((value) => (value === undefined || value === '' ? '0' : value));
  const parsedUnits = rawUnits.map(Number);

  if (
    rawUnits.some(
      (value, index) =>
        !/^\d+$/.test(value) || !Number.isSafeInteger(parsedUnits[index]),
    ) ||
    parsedUnits.every((value) => value === 0) ||
    (parsedUnits[0] > 0 && parsedUnits.slice(1).some((value) => value > 0))
  ) {
    return undefined;
  }

  return {
    weeks: parsedUnits[0],
    days: parsedUnits[1],
    hours: parsedUnits[2],
    minutes: parsedUnits[3],
    seconds: parsedUnits[4],
    isNegative: false,
  };
}

export function calendarEventRdatePeriodValueFromForm(
  values: CalendarEventFormValues,
): Extract<CalendarEventRecurrenceDate, { type: 'period' }> | undefined {
  if (
    values.timingType !== 'timed' ||
    values.originalTiming?.type !== 'timed' ||
    values.rdateEditable === false
  ) {
    return undefined;
  }

  if (values.rdateEditSource) {
    const sourceTiming = values.rdateEditSource.timing;
    const start = calendarEventRdateDateTimeFromDraft(
      values.rdateDraft ?? '',
      sourceTiming.start,
    );
    if (!start) {
      return undefined;
    }

    if (sourceTiming.type === 'end') {
      const end = calendarEventRdateDateTimeFromDraft(
        values.rdateEndDraft ?? '',
        sourceTiming.end,
      );
      if (!end) {
        return undefined;
      }
      return { type: 'period', timing: { type: 'end', start, end } };
    }

    const duration = calendarEventRdatePeriodDurationFromForm(values);
    return duration
      ? {
          type: 'period',
          timing: { type: 'duration', start, duration },
        }
      : undefined;
  }

  const start = calendarEventRdateValueFromForm(values);
  const duration = calendarEventRdatePeriodDurationFromForm(values);
  if (!start || start.type === 'date' || !duration) {
    return undefined;
  }

  return { type: 'period', timing: { type: 'duration', start, duration } };
}

export function calendarEventRdatePeriodIsEditable(
  value: CalendarEventRecurrenceDate,
): value is Extract<CalendarEventRecurrenceDate, { type: 'period' }> {
  if (value.type !== 'period' || value.timing.start.type === 'date') {
    return false;
  }
  if (!isEditablePeriodDateTime(value.timing.start)) {
    return false;
  }
  if (value.timing.type === 'duration') {
    return isPositiveRfcDuration(value.timing.duration);
  }

  return (
    sameDateTimeIdentity(value.timing.start, value.timing.end) &&
    periodEndpointsAreOrdered(value.timing.start, value.timing.end)
  );
}

function isEditablePeriodReplacement(
  source: Extract<CalendarEventRecurrenceDate, { type: 'period' }>,
  replacement: Extract<CalendarEventRecurrenceDate, { type: 'period' }>,
): boolean {
  if (
    !calendarEventRdatePeriodIsEditable(source) ||
    source.timing.type !== replacement.timing.type ||
    !sameDateTimeIdentity(source.timing.start, replacement.timing.start)
  ) {
    return false;
  }

  if (source.timing.type === 'duration') {
    return (
      replacement.timing.type === 'duration' &&
      isPositiveRfcDuration(replacement.timing.duration)
    );
  }

  return (
    replacement.timing.type === 'end' &&
    sameDateTimeIdentity(source.timing.end, replacement.timing.end) &&
    sameDateTimeIdentity(replacement.timing.start, replacement.timing.end) &&
    periodEndpointsAreOrdered(replacement.timing.start, replacement.timing.end)
  );
}

function recurrencePeriodIdentity(
  value: Extract<CalendarEventRecurrenceDate, { type: 'period' }>,
): string {
  return value.timing.type === 'end'
    ? `period:end:${calendarEventRecurrenceIdentity(value.timing.start)}:${calendarEventRecurrenceIdentity(value.timing.end)}`
    : `period:duration:${calendarEventRecurrenceIdentity(value.timing.start)}:${value.timing.duration.weeks}:${value.timing.duration.days}:${value.timing.duration.hours}:${value.timing.duration.minutes}:${value.timing.duration.seconds}:${value.timing.duration.isNegative}`;
}

function sameDateTimeIdentity(
  left: CalendarEventDateTime,
  right: CalendarEventDateTime,
): boolean {
  return (
    left.type === right.type &&
    (left.type !== 'date-time' ||
      (right.type === 'date-time' &&
        left.value.timezone === right.value.timezone))
  );
}

function periodEndpointsAreOrdered(
  start: CalendarEventDateTime,
  end: CalendarEventDateTime,
): boolean {
  if (
    start.type === 'date' ||
    end.type === 'date' ||
    !sameDateTimeIdentity(start, end)
  ) {
    return false;
  }

  const zone = start.type === 'date-time' ? start.value.timezone : 'UTC';
  const startLocal =
    start.type === 'date-time' ? start.value.local : start.value;
  const endLocal = end.type === 'date-time' ? end.value.local : end.value;
  const startDateTime = DateTime.fromISO(startLocal, { zone });
  const endDateTime = DateTime.fromISO(endLocal, { zone });
  return (
    isExactLocalDateTime(startDateTime, startLocal) &&
    isExactLocalDateTime(endDateTime, endLocal) &&
    endDateTime.toMillis() > startDateTime.toMillis()
  );
}

function isExactLocalDateTime(dateTime: DateTime, local: string): boolean {
  return (
    dateTime.isValid && dateTime.toFormat("yyyy-MM-dd'T'HH:mm:ss") === local
  );
}

function isEditablePeriodDateTime(value: CalendarEventDateTime): boolean {
  if (value.type === 'date') {
    return false;
  }
  const local = value.type === 'date-time' ? value.value.local : value.value;
  const zone = value.type === 'date-time' ? value.value.timezone : 'UTC';
  return isExactLocalDateTime(DateTime.fromISO(local, { zone }), local);
}

function calendarEventRdateDateTimeFromDraft(
  draft: string,
  identity: CalendarEventDateTime,
): CalendarEventDateTime | undefined {
  if (identity.type === 'date') {
    return undefined;
  }
  const trimmed = draft.trim();
  const local = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(trimmed)
    ? `${trimmed}:00`
    : trimmed;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(local)) {
    return undefined;
  }
  const zone = identity.type === 'date-time' ? identity.value.timezone : 'UTC';
  if (!isExactLocalDateTime(DateTime.fromISO(local, { zone }), local)) {
    return undefined;
  }
  return identity.type === 'floating-date-time'
    ? { type: 'floating-date-time', value: local }
    : {
        type: 'date-time',
        value: { local, timezone: identity.value.timezone },
      };
}

function isPositiveRfcDuration(value: unknown): value is CalendarEventDuration {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const duration = value as Record<string, unknown>;
  const units = ['weeks', 'days', 'hours', 'minutes', 'seconds'] as const;
  if (
    Object.keys(duration).length !== units.length + 1 ||
    units.some(
      (unit) =>
        !Number.isSafeInteger(duration[unit]) || (duration[unit] as number) < 0,
    ) ||
    typeof duration.isNegative !== 'boolean' ||
    duration.isNegative ||
    !units.some((unit) => (duration[unit] as number) > 0)
  ) {
    return false;
  }

  const hasWeeks = (duration.weeks as number) > 0;
  const hasOtherUnits = units
    .slice(1)
    .some((unit) => (duration[unit] as number) > 0);
  return !(hasWeeks && hasOtherUnits);
}

export function validateRecurrence(
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

export function recurrenceRuleFromForm(
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
      ...(values.recurrenceMonthlyByDay &&
      (values.recurrenceFrequency ?? 'DAILY') === 'MONTHLY'
        ? {
            weekdayOrdinal: {
              ordinal: monthlyOrdinalFromForm(values.recurrenceMonthlyOrdinal),
              weekday: monthlyWeekdayFromForm(
                values.recurrenceMonthlyWeekday ??
                  startWeekdayForTiming(timing),
              ),
            },
          }
        : {}),
    },
    timingStartAsDateTime(timing),
  );
}

function monthlyOrdinalFromForm(
  value: string | undefined,
): CalendarEventWeekdayOrdinal['ordinal'] {
  switch (value) {
    case '-1':
      return -1;
    case '1':
      return 1;
    case '2':
      return 2;
    case '3':
      return 3;
    case '4':
      return 4;
    case '5':
      return 5;
    default:
      throw new Error('Unsupported monthly ordinal');
  }
}

function monthlyWeekdayFromForm(value: string): CalendarEventWeekday {
  if (WEEKDAY_TOKENS.includes(value as CalendarEventWeekday)) {
    return value as CalendarEventWeekday;
  }
  throw new Error('Unsupported monthly weekday');
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

export function startWeekdayForTiming(
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
