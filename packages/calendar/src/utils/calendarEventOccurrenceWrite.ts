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

import { DateTime } from 'luxon';
import type {
  CalendarEventDateTime,
  CalendarEventDuration,
  CalendarEventOccurrenceTextOperation,
  CalendarEventOccurrenceWrite,
  CalendarEventPatch,
  CalendarEventRecurrenceTiming,
} from '../model';
import { isCalendarTimezoneSupported } from './calendarEventTimezone';

/** Invalid runtime payload for the bounded selected-occurrence write. */
export class CalendarEventOccurrenceValidationError extends Error {
  constructor() {
    super('Invalid selected occurrence operation');
    this.name = 'CalendarEventOccurrenceValidationError';
  }
}

/**
 * Validate the selected-occurrence write shape before repositories or gateway
 * transports read the CalDAV resource. The codec repeats this validation at
 * the persistence boundary.
 */
export function validateCalendarEventPatchOccurrence(
  value: unknown,
): asserts value is CalendarEventPatch {
  if (!isRecord(value)) {
    return;
  }
  if (
    Object.prototype.hasOwnProperty.call(value, 'recurrence') &&
    !isRecord(value.recurrence)
  ) {
    throw new CalendarEventOccurrenceValidationError();
  }
  if (!isRecord(value.recurrence)) {
    return;
  }
  const recurrence = value.recurrence;
  if (!Object.prototype.hasOwnProperty.call(recurrence, 'occurrence')) {
    return;
  }
  if (
    Object.keys(value).length !== 1 ||
    Object.keys(recurrence).length !== 1 ||
    !isCalendarEventOccurrenceWrite(recurrence.occurrence)
  ) {
    throw new CalendarEventOccurrenceValidationError();
  }
}

export function isCalendarEventOccurrenceWrite(
  value: unknown,
): value is CalendarEventOccurrenceWrite {
  if (!isRecord(value)) {
    return false;
  }
  if (value.action === 'set-timing') {
    return (
      hasExactlyKeys(value, [
        'action',
        'recurrenceId',
        'timing',
        'viewerTimezone',
      ]) &&
      isCalendarEventDateTime(value.recurrenceId) &&
      isCalendarEventRecurrenceTiming(value.timing) &&
      isValidTimezone(value.viewerTimezone)
    );
  }
  if (value.action !== 'set-fields') {
    return false;
  }

  const allowedKeys = new Set([
    'action',
    'recurrenceId',
    'timing',
    'viewerTimezone',
    'title',
    'description',
    'location',
  ]);
  if (
    Object.keys(value).some((key) => !allowedKeys.has(key)) ||
    !Object.prototype.hasOwnProperty.call(value, 'action') ||
    !Object.prototype.hasOwnProperty.call(value, 'recurrenceId') ||
    !Object.prototype.hasOwnProperty.call(value, 'viewerTimezone') ||
    !isCalendarEventDateTime(value.recurrenceId) ||
    !isValidTimezone(value.viewerTimezone)
  ) {
    return false;
  }
  if (
    Object.prototype.hasOwnProperty.call(value, 'timing') &&
    !isCalendarEventRecurrenceTiming(value.timing)
  ) {
    return false;
  }

  const textFields = ['title', 'description', 'location'] as const;
  let hasTextOperation = false;
  for (const field of textFields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      continue;
    }
    hasTextOperation = true;
    const operation = value[field];
    if (!isTextOperation(operation)) {
      return false;
    }
    if (
      field === 'title' &&
      operation.action === 'set' &&
      !operation.value.trim()
    ) {
      return false;
    }
  }
  return hasTextOperation;
}

export function isCalendarEventDateTime(
  value: unknown,
): value is CalendarEventDateTime {
  if (!isRecord(value) || !hasExactlyKeys(value, ['type', 'value'])) {
    return false;
  }
  if (value.type === 'date') {
    return (
      typeof value.value === 'string' &&
      isValidCalendarDate(value.value)
    );
  }
  if (value.type === 'floating-date-time') {
    return (
      typeof value.value === 'string' &&
      isValidLocalCalendarDateTime(value.value)
    );
  }
  if (
    value.type === 'date-time' &&
    isRecord(value.value) &&
    hasExactlyKeys(value.value, ['local', 'timezone']) &&
    typeof value.value.local === 'string' &&
    typeof value.value.timezone === 'string'
  ) {
    return (
      isValidLocalCalendarDateTime(value.value.local) &&
      (value.value.timezone === 'UTC' ||
        isCalendarTimezoneSupported(value.value.timezone))
    );
  }
  return false;
}

export function isCalendarEventRecurrenceTiming(
  value: unknown,
): value is CalendarEventRecurrenceTiming {
  if (!isRecord(value)) {
    return false;
  }
  if (value.type === 'end') {
    return (
      hasExactlyKeys(value, ['type', 'start', 'end']) &&
      isCalendarEventDateTime(value.start) &&
      isCalendarEventDateTime(value.end) &&
      (value.start.type === 'date') === (value.end.type === 'date')
    );
  }
  if (value.type === 'duration') {
    return (
      hasExactlyKeys(value, ['type', 'start', 'duration']) &&
      isCalendarEventDateTime(value.start) &&
      value.start.type !== 'date' &&
      isPositiveDuration(value.duration)
    );
  }
  return false;
}

function isTextOperation(
  value: unknown,
): value is CalendarEventOccurrenceTextOperation {
  if (!isRecord(value)) {
    return false;
  }
  if (
    value.action === 'inherit' &&
    hasExactlyKeys(value, ['action'])
  ) {
    return true;
  }
  return (
    value.action === 'set' &&
    hasExactlyKeys(value, ['action', 'value']) &&
    typeof value.value === 'string'
  );
}

function isPositiveDuration(value: unknown): value is CalendarEventDuration {
  if (!isRecord(value)) {
    return false;
  }
  const units = ['weeks', 'days', 'hours', 'minutes', 'seconds'] as const;
  if (
    !hasExactlyKeys(value, [...units, 'isNegative']) ||
    units.some(
      (unit) =>
        !Number.isSafeInteger(value[unit]) ||
        (value[unit] as number) < 0,
    ) ||
    typeof value.isNegative !== 'boolean' ||
    value.isNegative ||
    !units.some((unit) => (value[unit] as number) > 0)
  ) {
    return false;
  }
  const hasWeeks = (value.weeks as number) > 0;
  const hasOtherUnits = units
    .slice(1)
    .some((unit) => (value[unit] as number) > 0);
  return !(hasWeeks && hasOtherUnits);
}

function isValidTimezone(value: unknown): value is string {
  return typeof value === 'string' && isCalendarTimezoneSupported(value);
}

function isValidCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = DateTime.fromISO(value, { zone: 'UTC' });
  return date.isValid && date.toISODate() === value;
}

function isValidLocalCalendarDateTime(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value)) {
    return false;
  }
  const dateTime = DateTime.fromISO(value, { zone: 'UTC' });
  return (
    dateTime.isValid && dateTime.toFormat("yyyy-MM-dd'T'HH:mm:ss") === value
  );
}

function hasExactlyKeys(
  value: Record<string, unknown>,
  keys: string[],
): boolean {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
