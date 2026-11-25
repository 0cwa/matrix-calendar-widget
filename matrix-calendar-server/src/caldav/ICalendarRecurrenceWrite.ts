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
  CalendarEventOccurrenceWrite,
  CalendarEventRecurrenceDate,
  CalendarEventRecurrenceTiming,
  CalendarEventRecurrenceWrite,
  CalendarEventTimedDateTime,
  CalendarEventTiming,
  calendarEventRecurrenceIdentity,
  calendarEventTimedDateTimeToDateTime,
  calendarLocalDateTimeToUnixMillis,
  isCalendarEventOccurrenceWrite,
  isCalendarTimezoneSupported,
  isSupportedCalendarEventOccurrenceExclusion,
  parseSupportedCalendarEventRecurrenceRule,
} from '@matrix-calendar-widget/calendar';
import ICAL from 'ical.js';
import { DateTime } from 'luxon';
import {
  ICalendarEventCodecError,
  unsupportedRecurrencePatch,
} from './ICalendarCodecError';
import { contentLineParameters } from './ICalendarContentLine';
import { textValue } from './ICalendarEventFields';
import { type RawVeventProperty } from './ICalendarRawRead';
import { readPeriodRdateValue } from './ICalendarRecurrenceRead';
import {
  readDateTimeProperty,
  readDateTimeValue,
  readDuration,
  readRecurrenceTimingWithDuration,
  readRecurrenceTimingWithEnd,
} from './ICalendarTiming';
import {
  normalizeLocalDateTime,
  setTimeProperty,
} from './ICalendarTimingWrite';

export function recurrenceWriteFromUnknown(
  value: unknown,
): CalendarEventRecurrenceWrite | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw unsupportedRecurrencePatch();
  }

  const fields = value as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(fields, 'following')) {
    const operation = fields.following;
    if (
      Object.keys(fields).length !== 1 ||
      !operation ||
      typeof operation !== 'object' ||
      Array.isArray(operation)
    ) {
      throw unsupportedFollowingTimingPatch();
    }
    const following = operation as Record<string, unknown>;
    if (
      Object.keys(following).length !== 4 ||
      !['action', 'recurrenceId', 'timing', 'viewerTimezone'].every((key) =>
        Object.prototype.hasOwnProperty.call(following, key),
      ) ||
      following.action !== 'set-timing' ||
      typeof following.viewerTimezone !== 'string'
    ) {
      throw unsupportedFollowingTimingPatch();
    }
    const timing = recurrenceTimingFromUnknown(following.timing);
    if (timing.type !== 'end') {
      throw unsupportedFollowingTimingPatch();
    }
    return {
      following: {
        action: 'set-timing',
        recurrenceId: recurrenceDateTimeFromUnknown(following.recurrenceId),
        timing,
        viewerTimezone: following.viewerTimezone,
      },
    };
  }
  if (Object.prototype.hasOwnProperty.call(fields, 'occurrence')) {
    const operation = fields.occurrence;
    if (
      Object.keys(fields).length !== 1 ||
      !operation ||
      typeof operation !== 'object' ||
      Array.isArray(operation)
    ) {
      throw unsupportedOccurrenceTimingPatch();
    }
    const occurrence = operation;
    if (!isCalendarEventOccurrenceWrite(occurrence)) {
      throw unsupportedOccurrenceTimingPatch();
    }
    const parsedOperation: CalendarEventOccurrenceWrite = {
      ...occurrence,
      recurrenceId: recurrenceDateTimeFromUnknown(occurrence.recurrenceId),
      ...(occurrence.timing
        ? { timing: recurrenceTimingFromUnknown(occurrence.timing) }
        : {}),
    } as CalendarEventOccurrenceWrite;
    return { occurrence: parsedOperation };
  }
  if (Object.prototype.hasOwnProperty.call(fields, 'exdate')) {
    const operation = fields.exdate;
    if (
      Object.keys(fields).length !== 1 ||
      !operation ||
      typeof operation !== 'object' ||
      Array.isArray(operation)
    ) {
      throw unsupportedRecurrencePatch();
    }

    const exdate = operation as Record<string, unknown>;
    if (
      Object.keys(exdate).length !== 2 ||
      !['action', 'recurrenceId'].every((key) =>
        Object.prototype.hasOwnProperty.call(exdate, key),
      ) ||
      (exdate.action !== 'add' && exdate.action !== 'remove')
    ) {
      throw unsupportedRecurrencePatch();
    }

    return {
      exdate: {
        action: exdate.action,
        recurrenceId: exdate.recurrenceId as CalendarEventDateTime,
      },
    };
  }

  if (Object.prototype.hasOwnProperty.call(fields, 'rdate')) {
    const operation = fields.rdate;
    if (
      Object.keys(fields).length !== 1 ||
      !operation ||
      typeof operation !== 'object' ||
      Array.isArray(operation)
    ) {
      throw unsupportedRecurrencePatch();
    }

    const rdate = operation as Record<string, unknown>;
    if (
      !Object.prototype.hasOwnProperty.call(rdate, 'action') ||
      !Object.prototype.hasOwnProperty.call(rdate, 'value') ||
      (rdate.action !== 'add' &&
        rdate.action !== 'remove' &&
        rdate.action !== 'add-period' &&
        rdate.action !== 'remove-period' &&
        rdate.action !== 'replace-period')
    ) {
      throw unsupportedRecurrencePatch();
    }

    if (rdate.action === 'replace-period') {
      if (
        Object.keys(rdate).length !== 3 ||
        !Object.prototype.hasOwnProperty.call(rdate, 'replacement')
      ) {
        throw unsupportedRecurrencePatch();
      }
      return {
        rdate: {
          action: 'replace-period',
          value: recurrencePeriodFromUnknown(rdate.value),
          replacement: recurrencePeriodFromUnknown(rdate.replacement),
        },
      };
    }

    if (Object.keys(rdate).length !== 2) {
      throw unsupportedRecurrencePatch();
    }
    if (rdate.action === 'remove-period' || rdate.action === 'add-period') {
      const value = recurrencePeriodFromUnknown(rdate.value);
      if (rdate.action === 'add-period') {
        return {
          rdate: {
            action: 'add-period',
            value,
          },
        };
      }
      return { rdate: { action: 'remove-period', value } };
    }

    return {
      rdate: {
        action: rdate.action,
        value: recurrenceDateTimeFromUnknown(rdate.value),
      },
    };
  }

  if (
    Object.keys(fields).some((key) => key !== 'rrule') ||
    (fields.rrule !== undefined && typeof fields.rrule !== 'string')
  ) {
    throw unsupportedRecurrencePatch();
  }

  return { rrule: fields.rrule as string | undefined };
}

function recurrencePeriodFromUnknown(
  value: unknown,
): Extract<CalendarEventRecurrenceDate, { type: 'period' }> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw unsupportedRecurrencePatch();
  }
  const period = value as Record<string, unknown>;
  if (
    Object.keys(period).length !== 2 ||
    period.type !== 'period' ||
    !Object.prototype.hasOwnProperty.call(period, 'timing') ||
    !period.timing ||
    typeof period.timing !== 'object' ||
    Array.isArray(period.timing)
  ) {
    throw unsupportedRecurrencePatch();
  }
  const timing = period.timing as Record<string, unknown>;
  if (timing.type === 'end') {
    if (
      Object.keys(timing).length !== 3 ||
      !Object.prototype.hasOwnProperty.call(timing, 'start') ||
      !Object.prototype.hasOwnProperty.call(timing, 'end')
    ) {
      throw unsupportedRecurrencePatch();
    }
    const start = recurrenceDateTimeFromUnknown(timing.start);
    const end = recurrenceDateTimeFromUnknown(timing.end);
    if (start.type === 'date' || end.type === 'date') {
      throw unsupportedRecurrencePatch();
    }
    return { type: 'period', timing: { type: 'end', start, end } };
  }
  if (timing.type === 'duration') {
    if (
      Object.keys(timing).length !== 3 ||
      !Object.prototype.hasOwnProperty.call(timing, 'start') ||
      !Object.prototype.hasOwnProperty.call(timing, 'duration')
    ) {
      throw unsupportedRecurrencePatch();
    }
    const start = recurrenceDateTimeFromUnknown(timing.start);
    const rawDuration = timing.duration;
    if (
      start.type === 'date' ||
      !rawDuration ||
      typeof rawDuration !== 'object' ||
      Array.isArray(rawDuration)
    ) {
      throw unsupportedRecurrencePatch();
    }
    if (!isPositiveRfcDuration(rawDuration)) {
      throw unsupportedRecurrencePatch();
    }
    return {
      type: 'period',
      timing: {
        type: 'duration',
        start,
        duration: rawDuration,
      },
    };
  }
  throw unsupportedRecurrencePatch();
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

export function assertOccurrenceExdateCanBeEdited(
  event: CalendarEvent,
  recurrenceId: CalendarEventDateTime,
  listProjectionDiagnostic?: 'unsupported-recurrence',
): void {
  if (
    listProjectionDiagnostic === 'unsupported-recurrence' ||
    !isSupportedCalendarEventOccurrenceExclusion(event, recurrenceId)
  ) {
    throw new ICalendarEventCodecError(
      'unsupported-patch',
      'Occurrence exceptions are not supported for this recurrence',
    );
  }
}

export function unsupportedOccurrenceTimingPatch(): ICalendarEventCodecError {
  return new ICalendarEventCodecError(
    'unsupported-patch',
    'This occurrence cannot be timed safely because its recurrence identity or source data is unsupported or ambiguous.',
  );
}

export function unsupportedFollowingTimingPatch(): ICalendarEventCodecError {
  return new ICalendarEventCodecError(
    'unsupported-patch',
    'This and following timing edit is unavailable because the recurrence or source data is unsupported or ambiguous.',
  );
}

export function followingResourceTooLarge(): ICalendarEventCodecError {
  return new ICalendarEventCodecError(
    'event-too-large',
    'This and following edit would exceed the supported calendar resource size.',
  );
}

export function validateOccurrenceRecurrenceSource(
  master: ICAL.Component,
  event: CalendarEvent,
): void {
  if (master.getAllProperties('rrule').length === 1) {
    const rule = master.getFirstPropertyValue('rrule');
    if (rule === null || rule === undefined) {
      throw unsupportedOccurrenceTimingPatch();
    }
    validateRecurrenceRule(String(rule), timingStartAsDateTime(event.timing));
  }
  assertRdatePropertiesCanBeEdited(master, event);
  assertExdatePropertiesCanBeRead(master, event);
}

function assertExdatePropertiesCanBeRead(
  master: ICAL.Component,
  event: CalendarEvent,
): void {
  const anchor = timingStartAsDateTime(event.timing);
  for (const property of master.getAllProperties('exdate')) {
    let values: ReturnType<ICAL.Property['getValues']>;
    try {
      values = property.getValues();
    } catch {
      throw unsupportedOccurrenceTimingPatch();
    }

    const explicitValueType = property.getFirstParameter('value');
    const tzid = property.getFirstParameter('tzid');
    if (
      values.length === 0 ||
      (explicitValueType !== null &&
        explicitValueType !== undefined &&
        (typeof explicitValueType !== 'string' ||
          !['DATE', 'DATE-TIME'].includes(explicitValueType.toUpperCase()))) ||
      (tzid !== null &&
        tzid !== undefined &&
        (typeof tzid !== 'string' || !tzid.trim()))
    ) {
      throw unsupportedOccurrenceTimingPatch();
    }

    for (const value of values) {
      if (!(value instanceof ICAL.Time)) {
        throw unsupportedOccurrenceTimingPatch();
      }
      if (
        (value.isDate &&
          explicitValueType !== null &&
          explicitValueType !== undefined &&
          explicitValueType.toUpperCase() !== 'DATE') ||
        (!value.isDate &&
          explicitValueType !== null &&
          explicitValueType !== undefined &&
          explicitValueType.toUpperCase() !== 'DATE-TIME') ||
        (typeof tzid === 'string' &&
          (value.isDate || value.zone === ICAL.Timezone.utcTimezone))
      ) {
        throw unsupportedOccurrenceTimingPatch();
      }
      validatePointRdateValue(readDateTimeValue(value, property), anchor);
    }
  }
}

export function validateOccurrenceTiming(
  timing: CalendarEventRecurrenceTiming,
  sourceEvent: CalendarEvent,
  viewerTimezone: string,
): void {
  const anchor = timingStartAsDateTime(sourceEvent.timing);
  validatePointRdateValue(timing.start, anchor);
  const startInstant = recurrenceDateTimeInstant(timing.start, viewerTimezone);

  if (timing.type === 'duration') {
    if (
      timing.start.type === 'date' ||
      !isPositiveRfcDuration(timing.duration)
    ) {
      throw unsupportedOccurrenceTimingPatch();
    }
    const endInstant = recurrenceDurationEndInstant(
      timing.start,
      timing.duration,
      viewerTimezone,
    );
    if (endInstant <= startInstant) {
      throw unsupportedOccurrenceTimingPatch();
    }
    return;
  }

  validatePointRdateValue(timing.end, anchor);
  if ((timing.start.type === 'date') !== (timing.end.type === 'date')) {
    throw unsupportedOccurrenceTimingPatch();
  }
  if (recurrenceDateTimeInstant(timing.end, viewerTimezone) <= startInstant) {
    throw unsupportedOccurrenceTimingPatch();
  }
}

function recurrenceDateTimeInstant(
  value: CalendarEventDateTime,
  viewerTimezone: string,
): number {
  if (!isCalendarTimezoneSupported(viewerTimezone)) {
    throw unsupportedOccurrenceTimingPatch();
  }
  if (value.type === 'date') {
    const local = `${value.value}T00:00:00`;
    const instant = calendarLocalDateTimeToUnixMillis(local, viewerTimezone);
    if (
      DateTime.fromMillis(instant, { zone: viewerTimezone }).toFormat(
        'yyyy-MM-dd',
      ) !== value.value
    ) {
      throw unsupportedOccurrenceTimingPatch();
    }
    return instant;
  }

  const timezone =
    value.type === 'date-time' ? value.value.timezone : viewerTimezone;
  if (timezone !== 'UTC' && !isCalendarTimezoneSupported(timezone)) {
    throw unsupportedOccurrenceTimingPatch();
  }
  const timedValue: CalendarEventTimedDateTime =
    value.type === 'floating-date-time'
      ? { type: 'floating', local: value.value }
      : { type: 'zoned', local: value.value.local, timezone };
  const interpreted = calendarEventTimedDateTimeToDateTime(
    timedValue,
    timezone,
  );
  if (
    !interpreted.isValid ||
    interpreted.toFormat("yyyy-MM-dd'T'HH:mm:ss") !==
      (value.type === 'floating-date-time' ? value.value : value.value.local)
  ) {
    // A local wall time that cannot round-trip has no unambiguous supported
    // representation for this typed endpoint.
    throw unsupportedOccurrenceTimingPatch();
  }
  return interpreted.toMillis();
}

function recurrenceDurationEndInstant(
  start: CalendarEventDateTime,
  duration: CalendarEventDuration,
  viewerTimezone: string,
): number {
  if (start.type === 'date' || !isPositiveRfcDuration(duration)) {
    throw unsupportedOccurrenceTimingPatch();
  }
  const timezone =
    start.type === 'date-time' ? start.value.timezone : viewerTimezone;
  const localStart =
    start.type === 'date-time' ? start.value.local : start.value;
  const wallStart = DateTime.fromISO(localStart, { zone: 'UTC' });
  if (!wallStart.isValid) {
    throw unsupportedOccurrenceTimingPatch();
  }

  const calendarDays = duration.weeks > 0 ? duration.weeks * 7 : duration.days;
  const localAfterCalendarUnits = wallStart
    .plus({ days: calendarDays })
    .toFormat("yyyy-MM-dd'T'HH:mm:ss");
  const instantAfterCalendarUnits = calendarLocalDateTimeToUnixMillis(
    localAfterCalendarUnits,
    timezone,
  );
  const exactMilliseconds =
    ((duration.hours * 60 + duration.minutes) * 60 + duration.seconds) * 1000;
  return instantAfterCalendarUnits + exactMilliseconds;
}

export function validateExistingOverrideTiming(
  component: ICAL.Component,
): CalendarEventRecurrenceTiming {
  const statusProperties = component.getAllProperties('status');
  if (
    statusProperties.length > 1 ||
    textValue(statusProperties[0]?.getFirstValue())?.toUpperCase() ===
      'CANCELLED'
  ) {
    throw unsupportedOccurrenceTimingPatch();
  }
  const startProperties = component.getAllProperties('dtstart');
  const endProperties = component.getAllProperties('dtend');
  const durationProperties = component.getAllProperties('duration');
  if (
    startProperties.length !== 1 ||
    (endProperties.length === 1) === (durationProperties.length === 1) ||
    endProperties.length > 1 ||
    durationProperties.length > 1
  ) {
    throw unsupportedOccurrenceTimingPatch();
  }

  try {
    const current =
      endProperties.length === 1
        ? readRecurrenceTimingWithEnd(component)
        : readRecurrenceTimingWithDuration(component);
    return recurrenceTimingFromUnknown(current);
  } catch {
    throw unsupportedOccurrenceTimingPatch();
  }
}

export function sameOccurrenceTiming(
  left: CalendarEventRecurrenceTiming,
  right: CalendarEventRecurrenceTiming,
): boolean {
  if (
    left.type !== right.type ||
    calendarEventRecurrenceIdentity(left.start) !==
      calendarEventRecurrenceIdentity(right.start)
  ) {
    return false;
  }

  if (left.type === 'end' && right.type === 'end') {
    return (
      calendarEventRecurrenceIdentity(left.end) ===
      calendarEventRecurrenceIdentity(right.end)
    );
  }
  if (left.type === 'duration' && right.type === 'duration') {
    return (
      left.duration.weeks === right.duration.weeks &&
      left.duration.days === right.duration.days &&
      left.duration.hours === right.duration.hours &&
      left.duration.minutes === right.duration.minutes &&
      left.duration.seconds === right.duration.seconds &&
      left.duration.isNegative === right.duration.isNegative
    );
  }
  return false;
}

export function setOccurrenceTiming(
  component: ICAL.Component,
  timing: CalendarEventRecurrenceTiming,
): void {
  const start = recurrenceIdAsIcalTime(timing.start);
  setTimeProperty(component, 'dtstart', start.value, start.timezone);
  if (timing.type === 'end') {
    const end = recurrenceIdAsIcalTime(timing.end);
    setTimeProperty(component, 'dtend', end.value, end.timezone);
    component.removeAllProperties('duration');
    return;
  }

  component.removeAllProperties('dtend');
  let durationProperty = component.getFirstProperty('duration');
  if (!durationProperty) {
    durationProperty = new ICAL.Property('duration');
    component.addProperty(durationProperty);
  }
  durationProperty.setValue(ICAL.Duration.fromData(timing.duration));
}

export function applyOccurrenceExdate(
  vevent: ICAL.Component,
  operation: Extract<
    CalendarEventRecurrenceWrite,
    { exdate: unknown }
  >['exdate'],
): void {
  const targetIdentity = calendarEventRecurrenceIdentity(
    operation.recurrenceId,
  );
  const properties = vevent.getAllProperties('exdate');

  if (operation.action === 'add') {
    const alreadyExcluded = properties.some((property) =>
      property
        .getValues()
        .some(
          (value) =>
            value instanceof ICAL.Time &&
            calendarEventRecurrenceIdentity(
              readDateTimeValue(value, property),
            ) === targetIdentity,
        ),
    );
    if (alreadyExcluded) {
      return;
    }

    const property = new ICAL.Property('exdate');
    const { value, timezone } = recurrenceIdAsIcalTime(operation.recurrenceId);
    property.setValue(value);
    if (timezone) {
      property.setParameter('tzid', timezone);
    }
    vevent.addProperty(property);
    return;
  }

  for (const property of properties) {
    const values = property.getValues();
    let removed = false;
    const remaining = values.filter((value) => {
      const matches =
        value instanceof ICAL.Time &&
        calendarEventRecurrenceIdentity(readDateTimeValue(value, property)) ===
          targetIdentity;
      if (matches) {
        removed = true;
      }
      return !matches;
    });

    if (!removed) {
      continue;
    }
    if (remaining.length === 0) {
      vevent.removeProperty(property);
    } else {
      property.setValues(remaining);
    }
  }
}

export function assertPointRdateCanBeEdited(
  event: CalendarEvent,
  value: CalendarEventDateTime,
  listProjectionDiagnostic?: 'unsupported-recurrence',
): void {
  const recurrence = event.recurrence;
  if (
    listProjectionDiagnostic === 'unsupported-recurrence' ||
    event.unsupportedTimezone ||
    event.unsupportedRecurrence ||
    !recurrence ||
    (!recurrence.rrule && !recurrence.rdates?.length)
  ) {
    throw unsupportedRecurrencePatch();
  }

  if (recurrence.rrule !== undefined) {
    validateRecurrenceRule(
      recurrence.rrule,
      timingStartAsDateTime(event.timing),
    );
  }

  validatePointRdateValue(value, timingStartAsDateTime(event.timing));
}

export function assertRdatePropertiesCanBeEdited(
  vevent: ICAL.Component,
  event: CalendarEvent,
): void {
  const anchor = timingStartAsDateTime(event.timing);
  for (const property of vevent.getAllProperties('rdate')) {
    let values: ReturnType<ICAL.Property['getValues']>;
    try {
      values = property.getValues();
    } catch {
      throw unsupportedRecurrencePatch();
    }
    if (values.length === 0) {
      throw unsupportedRecurrencePatch();
    }

    const valueKind = values.map((value) =>
      value instanceof ICAL.Period
        ? 'period'
        : value instanceof ICAL.Time
          ? value.isDate
            ? 'date'
            : 'date-time'
          : 'unsupported',
    );
    if (
      valueKind.includes('unsupported') ||
      valueKind.some((kind) => kind !== valueKind[0])
    ) {
      throw unsupportedRecurrencePatch();
    }

    // PERIOD values are changed only by the exact add/remove operations below.
    if (valueKind[0] === 'period') {
      const explicitValueType = property.getFirstParameter('value');
      const tzid = property.getFirstParameter('tzid');
      if (
        (explicitValueType !== null &&
          explicitValueType !== undefined &&
          (typeof explicitValueType !== 'string' ||
            explicitValueType.toUpperCase() !== 'PERIOD')) ||
        (tzid !== null &&
          tzid !== undefined &&
          (typeof tzid !== 'string' || !tzid.trim()))
      ) {
        throw unsupportedRecurrencePatch();
      }
      for (const value of values) {
        if (!(value instanceof ICAL.Period)) {
          throw unsupportedRecurrencePatch();
        }
        const start = value.start;
        const end = value.end;
        if (
          typeof tzid === 'string' &&
          (start.zone === ICAL.Timezone.utcTimezone ||
            (end instanceof ICAL.Time &&
              end.zone === ICAL.Timezone.utcTimezone))
        ) {
          throw unsupportedRecurrencePatch();
        }
        readPeriodRdateValue(value, property);
      }
      continue;
    }

    const explicitValueType = property.getFirstParameter('value');
    if (
      (valueKind[0] === 'date' &&
        (typeof explicitValueType !== 'string' ||
          explicitValueType.toUpperCase() !== 'DATE')) ||
      (valueKind[0] === 'date-time' &&
        explicitValueType !== null &&
        explicitValueType !== undefined &&
        (typeof explicitValueType !== 'string' ||
          explicitValueType.toUpperCase() !== 'DATE-TIME'))
    ) {
      throw unsupportedRecurrencePatch();
    }

    for (const value of values) {
      if (!(value instanceof ICAL.Time)) {
        throw unsupportedRecurrencePatch();
      }
      const tzid = property.getFirstParameter('tzid');
      if (
        (tzid !== null &&
          tzid !== undefined &&
          (typeof tzid !== 'string' || !tzid.trim())) ||
        (typeof tzid === 'string' &&
          (value.isDate || value.zone === ICAL.Timezone.utcTimezone))
      ) {
        throw unsupportedRecurrencePatch();
      }
      validatePointRdateValue(readDateTimeValue(value, property), anchor);
    }
  }
}

export function assertPeriodRdateCanBeRemoved(
  event: CalendarEvent,
  value: Extract<CalendarEventRecurrenceDate, { type: 'period' }>,
  listProjectionDiagnostic?: 'unsupported-recurrence',
): void {
  const recurrence = event.recurrence;
  if (
    listProjectionDiagnostic === 'unsupported-recurrence' ||
    event.unsupportedTimezone ||
    event.unsupportedRecurrence ||
    !recurrence ||
    !recurrence.rdates?.some(
      (candidate) =>
        recurrenceRdateIdentity(candidate) === recurrenceRdateIdentity(value),
    )
  ) {
    throw unsupportedRecurrencePatch();
  }
  if (recurrence.rrule !== undefined) {
    validateRecurrenceRule(
      recurrence.rrule,
      timingStartAsDateTime(event.timing),
    );
  }
}

export function assertPeriodRdateCanBeAdded(
  event: CalendarEvent,
  value: Extract<CalendarEventRecurrenceDate, { type: 'period' }>,
  listProjectionDiagnostic?: 'unsupported-recurrence',
): void {
  const recurrence = event.recurrence;
  if (
    listProjectionDiagnostic === 'unsupported-recurrence' ||
    event.unsupportedTimezone ||
    event.unsupportedRecurrence ||
    !recurrence ||
    (!recurrence.rrule && !recurrence.rdates?.length)
  ) {
    throw unsupportedRecurrencePatch();
  }
  if (recurrence.rrule !== undefined) {
    validateRecurrenceRule(
      recurrence.rrule,
      timingStartAsDateTime(event.timing),
    );
  }

  if (event.timing.type !== 'timed') {
    throw unsupportedRecurrencePatch();
  }

  const { timing } = value;
  const anchor = timingStartAsDateTime(event.timing);
  validatePointRdateValue(timing.start, anchor);
  if (timing.type === 'duration') {
    if (!isPositiveRfcDuration(timing.duration)) {
      throw unsupportedRecurrencePatch();
    }
    return;
  }

  validatePointRdateValue(timing.end, anchor);
  if (
    timing.start.type !== timing.end.type ||
    (timing.start.type === 'date-time' &&
      timing.end.type === 'date-time' &&
      timing.start.value.timezone !== timing.end.value.timezone)
  ) {
    throw unsupportedRecurrencePatch();
  }
  const zone =
    timing.start.type === 'date-time' ? timing.start.value.timezone : 'UTC';
  const startValue =
    timing.start.type === 'floating-date-time'
      ? timing.start.value
      : timing.start.type === 'date-time'
        ? timing.start.value.local
        : undefined;
  const endValue =
    timing.end.type === 'floating-date-time'
      ? timing.end.value
      : timing.end.type === 'date-time'
        ? timing.end.value.local
        : undefined;
  if (!startValue || !endValue) {
    throw unsupportedRecurrencePatch();
  }
  const startInstant = DateTime.fromISO(startValue, { zone });
  const endInstant = DateTime.fromISO(endValue, { zone });
  if (
    !startInstant.isValid ||
    !endInstant.isValid ||
    endInstant.toMillis() <= startInstant.toMillis()
  ) {
    throw unsupportedRecurrencePatch();
  }
}

export function assertPeriodRdateCanBeReplaced(
  event: CalendarEvent,
  source: Extract<CalendarEventRecurrenceDate, { type: 'period' }>,
  replacement: Extract<CalendarEventRecurrenceDate, { type: 'period' }>,
  listProjectionDiagnostic?: 'unsupported-recurrence',
): void {
  const recurrence = event.recurrence;
  const sourceIdentity = recurrenceRdateIdentity(source);
  const matchingSources = recurrence?.rdates?.filter(
    (candidate) =>
      candidate.type === 'period' &&
      recurrenceRdateIdentity(candidate) === sourceIdentity,
  );
  if (
    listProjectionDiagnostic === 'unsupported-recurrence' ||
    event.unsupportedTimezone ||
    event.unsupportedRecurrence ||
    event.timing.type !== 'timed' ||
    !recurrence ||
    matchingSources?.length !== 1
  ) {
    throw unsupportedRecurrencePatch();
  }
  if (recurrence.rrule !== undefined) {
    validateRecurrenceRule(
      recurrence.rrule,
      timingStartAsDateTime(event.timing),
    );
  }

  if (
    source.timing.type !== replacement.timing.type ||
    !samePeriodDateTimeIdentity(source.timing.start, replacement.timing.start)
  ) {
    throw unsupportedRecurrencePatch();
  }
  if (
    source.timing.type === 'end' &&
    (replacement.timing.type !== 'end' ||
      !samePeriodDateTimeIdentity(source.timing.end, replacement.timing.end))
  ) {
    throw unsupportedRecurrencePatch();
  }

  validateEditablePeriod(source, event);
  validateEditablePeriod(replacement, event);
}

function validateEditablePeriod(
  value: Extract<CalendarEventRecurrenceDate, { type: 'period' }>,
  event: CalendarEvent,
): void {
  const anchor = timingStartAsDateTime(event.timing);
  validatePointRdateValue(value.timing.start, anchor);
  if (value.timing.type === 'duration') {
    if (!isPositiveRfcDuration(value.timing.duration)) {
      throw unsupportedRecurrencePatch();
    }
    return;
  }

  validatePointRdateValue(value.timing.end, anchor);
  if (
    !samePeriodDateTimeIdentity(value.timing.start, value.timing.end) ||
    !periodEndIsAfterStart(value.timing.start, value.timing.end)
  ) {
    throw unsupportedRecurrencePatch();
  }
}

function samePeriodDateTimeIdentity(
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

function periodEndIsAfterStart(
  start: CalendarEventDateTime,
  end: CalendarEventDateTime,
): boolean {
  if (start.type === 'date' || end.type === 'date') {
    return false;
  }
  const startLocal =
    start.type === 'date-time' ? start.value.local : start.value;
  const endLocal = end.type === 'date-time' ? end.value.local : end.value;
  const timezone = start.type === 'date-time' ? start.value.timezone : 'UTC';
  const startDateTime = DateTime.fromISO(startLocal, { zone: timezone });
  const endDateTime = DateTime.fromISO(endLocal, { zone: timezone });
  return (
    isExactLocalDateTime(startDateTime, startLocal) &&
    isExactLocalDateTime(endDateTime, endLocal) &&
    endDateTime.toMillis() > startDateTime.toMillis()
  );
}

function validatePointRdateValue(
  value: CalendarEventDateTime,
  anchor: CalendarEventDateTime,
): void {
  if ((anchor.type === 'date') !== (value.type === 'date')) {
    throw unsupportedRecurrencePatch();
  }

  switch (value.type) {
    case 'date':
      if (!isValidCalendarDate(value.value)) {
        throw unsupportedRecurrencePatch();
      }
      return;
    case 'floating-date-time':
      if (anchor.type === 'date' || !isValidLocalDateTime(value.value)) {
        throw unsupportedRecurrencePatch();
      }
      return;
    case 'date-time':
      if (
        anchor.type === 'date' ||
        !isValidLocalDateTime(value.value.local) ||
        (value.value.timezone !== 'UTC' &&
          !isCalendarTimezoneSupported(value.value.timezone))
      ) {
        throw unsupportedRecurrencePatch();
      }
      return;
  }
}

function isValidCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = DateTime.fromISO(value, { zone: 'UTC' });
  return date.isValid && date.toISODate() === value;
}

function isValidLocalDateTime(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value)) {
    return false;
  }

  const dateTime = DateTime.fromISO(value, { zone: 'UTC' });
  return (
    dateTime.isValid && dateTime.toFormat("yyyy-MM-dd'T'HH:mm:ss") === value
  );
}

function isExactLocalDateTime(dateTime: DateTime, local: string): boolean {
  return (
    dateTime.isValid && dateTime.toFormat("yyyy-MM-dd'T'HH:mm:ss") === local
  );
}

export function applyPointRdate(
  calendar: ICAL.Component,
  vevent: ICAL.Component,
  operation: {
    action: 'add' | 'remove';
    value: CalendarEventDateTime;
  },
  event: CalendarEvent,
): void {
  const targetIdentity = calendarEventRecurrenceIdentity(operation.value);
  const properties = vevent.getAllProperties('rdate');

  if (operation.action === 'add') {
    // DTSTART, RRULE, RDATE, and detached instances form one recurrence set.
    // An exact existing identity is already represented and must stay unique.
    const recurrenceWithoutExdates = event.recurrence
      ? { ...event, recurrence: { ...event.recurrence, exdates: [] } }
      : event;
    if (
      isSupportedCalendarEventOccurrenceExclusion(
        recurrenceWithoutExdates,
        operation.value,
      )
    ) {
      return;
    }

    if (operation.value.type === 'date-time') {
      const timezoneId = operation.value.value.timezone;
      if (
        timezoneId !== 'UTC' &&
        !calendar
          .getAllSubcomponents('vtimezone')
          .some(
            (timezone) => timezone.getFirstPropertyValue('tzid') === timezoneId,
          )
      ) {
        throw unsupportedRecurrencePatch();
      }
    }

    const property = new ICAL.Property('rdate');
    const { value, timezone } = recurrenceIdAsIcalTime(operation.value);
    if (timezone) {
      property.setParameter('tzid', timezone);
    }
    property.setValue(value);
    vevent.addProperty(property);
    return;
  }

  for (const property of properties) {
    const values = property.getValues();
    let removed = false;
    const remaining = values.filter((value) => {
      const matches =
        value instanceof ICAL.Time &&
        calendarEventRecurrenceIdentity(readDateTimeValue(value, property)) ===
          targetIdentity;
      if (matches) {
        removed = true;
      }
      return !matches;
    });

    if (!removed) {
      continue;
    }
    if (remaining.length === 0) {
      vevent.removeProperty(property);
    } else {
      property.setValues(remaining);
    }
  }
}

function recurrenceRdateIdentity(value: CalendarEventRecurrenceDate): string {
  if (value.type !== 'period') {
    return `point:${calendarEventRecurrenceIdentity(value)}`;
  }
  const { timing } = value;
  return timing.type === 'end'
    ? `period:end:${calendarEventRecurrenceIdentity(timing.start)}:${calendarEventRecurrenceIdentity(timing.end)}`
    : `period:duration:${calendarEventRecurrenceIdentity(timing.start)}:${timing.duration.weeks}:${timing.duration.days}:${timing.duration.hours}:${timing.duration.minutes}:${timing.duration.seconds}:${timing.duration.isNegative}`;
}

export function applyPeriodRdate(
  vevent: ICAL.Component,
  target: Extract<CalendarEventRecurrenceDate, { type: 'period' }>,
  calendar?: ICAL.Component,
): void {
  if (calendar) {
    const targetIdentity = recurrenceRdateIdentity(target);
    const alreadyPresent = vevent
      .getAllProperties('rdate')
      .some((property) =>
        property
          .getValues()
          .some(
            (value) =>
              value instanceof ICAL.Period &&
              recurrenceRdateIdentity(readPeriodRdateValue(value, property)) ===
                targetIdentity,
          ),
      );
    if (alreadyPresent) {
      return;
    }

    const { start } = target.timing;
    const startIcal = recurrenceIdAsIcalTime(start);
    if (startIcal.timezone) {
      if (
        !calendar
          .getAllSubcomponents('vtimezone')
          .some(
            (timezone) =>
              timezone.getFirstPropertyValue('tzid') === startIcal.timezone,
          )
      ) {
        throw unsupportedRecurrencePatch();
      }
    }

    const period =
      target.timing.type === 'end'
        ? ICAL.Period.fromData({
            start: startIcal.value,
            end: recurrenceIdAsIcalTime(target.timing.end).value,
          })
        : ICAL.Period.fromData({
            start: startIcal.value,
            duration: ICAL.Duration.fromData(target.timing.duration),
          });
    const property = new ICAL.Property('rdate');
    if (startIcal.timezone) {
      property.setParameter('tzid', startIcal.timezone);
    }
    property.setValue(period);
    vevent.addProperty(property);
    return;
  }
  const targetIdentity = recurrenceRdateIdentity(target);
  for (const property of vevent.getAllProperties('rdate')) {
    const values = property.getValues();
    let removed = false;
    const remaining = values.filter((value) => {
      if (removed || !(value instanceof ICAL.Period)) {
        return true;
      }
      if (
        recurrenceRdateIdentity(readPeriodRdateValue(value, property)) !==
        targetIdentity
      ) {
        return true;
      }
      removed = true;
      return false;
    });
    if (!removed) {
      continue;
    }
    if (remaining.length === 0) {
      vevent.removeProperty(property);
    } else {
      property.setValues(remaining);
    }
    return;
  }
}

export function applyPeriodRdateReplacement(
  vevent: ICAL.Component,
  source: Extract<CalendarEventRecurrenceDate, { type: 'period' }>,
  replacement: Extract<CalendarEventRecurrenceDate, { type: 'period' }>,
): boolean {
  const sourceIdentity = recurrenceRdateIdentity(source);
  const replacementIdentity = recurrenceRdateIdentity(replacement);
  const matches: Array<{
    property: ICAL.Property;
    values: ReturnType<ICAL.Property['getValues']>;
    index: number;
  }> = [];

  for (const property of vevent.getAllProperties('rdate')) {
    let values: ReturnType<ICAL.Property['getValues']>;
    try {
      values = property.getValues();
    } catch {
      throw unsupportedRecurrencePatch();
    }
    values.forEach((value, index) => {
      if (
        value instanceof ICAL.Period &&
        recurrenceRdateIdentity(readPeriodRdateValue(value, property)) ===
          sourceIdentity
      ) {
        matches.push({ property, values, index });
      }
    });
  }

  if (matches.length !== 1) {
    throw unsupportedRecurrencePatch();
  }
  if (sourceIdentity === replacementIdentity) {
    return false;
  }

  const match = matches[0];
  const replacementStartIdentity = calendarEventRecurrenceIdentity(
    replacement.timing.start,
  );
  for (const property of vevent.getAllProperties('rdate')) {
    const values = property.getValues();
    for (const [index, value] of values.entries()) {
      if (property === match.property && index === match.index) {
        continue;
      }
      const siblingStart =
        value instanceof ICAL.Period
          ? readPeriodRdateValue(value, property).timing.start
          : value instanceof ICAL.Time
            ? readDateTimeValue(value, property)
            : undefined;
      if (
        siblingStart &&
        calendarEventRecurrenceIdentity(siblingStart) ===
          replacementStartIdentity
      ) {
        throw unsupportedRecurrencePatch();
      }
    }
  }

  const replacementStart = recurrenceIdAsIcalTime(replacement.timing.start);
  const replacementPeriod =
    replacement.timing.type === 'end'
      ? ICAL.Period.fromData({
          start: replacementStart.value,
          end: recurrenceIdAsIcalTime(replacement.timing.end).value,
        })
      : ICAL.Period.fromData({
          start: replacementStart.value,
          duration: ICAL.Duration.fromData(replacement.timing.duration),
        });
  const nextValues = [...match.values];
  nextValues[match.index] = replacementPeriod;
  match.property.setValues(nextValues);
  return true;
}

export function recurrenceDateTimeFromUnknown(
  value: unknown,
): CalendarEventDateTime {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw unsupportedRecurrencePatch();
  }

  const dateTime = value as Record<string, unknown>;
  if (dateTime.type === 'date') {
    if (
      Object.keys(dateTime).length !== 2 ||
      !Object.prototype.hasOwnProperty.call(dateTime, 'value') ||
      typeof dateTime.value !== 'string' ||
      !isValidCalendarDate(dateTime.value)
    ) {
      throw unsupportedRecurrencePatch();
    }
    return { type: 'date', value: dateTime.value };
  }

  if (dateTime.type === 'floating-date-time') {
    if (
      Object.keys(dateTime).length !== 2 ||
      !Object.prototype.hasOwnProperty.call(dateTime, 'value') ||
      typeof dateTime.value !== 'string' ||
      !isValidLocalDateTime(dateTime.value)
    ) {
      throw unsupportedRecurrencePatch();
    }
    return { type: 'floating-date-time', value: dateTime.value };
  }

  if (dateTime.type === 'date-time') {
    const zonedValue = dateTime.value;
    if (
      Object.keys(dateTime).length !== 2 ||
      !zonedValue ||
      typeof zonedValue !== 'object' ||
      Array.isArray(zonedValue)
    ) {
      throw unsupportedRecurrencePatch();
    }

    const zoned = zonedValue as Record<string, unknown>;
    if (
      Object.keys(zoned).length !== 2 ||
      typeof zoned.local !== 'string' ||
      !isValidLocalDateTime(zoned.local) ||
      typeof zoned.timezone !== 'string' ||
      !zoned.timezone.trim()
    ) {
      throw unsupportedRecurrencePatch();
    }
    return {
      type: 'date-time',
      value: { local: zoned.local, timezone: zoned.timezone },
    };
  }

  throw unsupportedRecurrencePatch();
}

export function recurrenceTimingFromUnknown(
  value: unknown,
): CalendarEventRecurrenceTiming {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw unsupportedOccurrenceTimingPatch();
  }

  const timing = value as Record<string, unknown>;
  if (timing.type === 'end') {
    if (
      Object.keys(timing).length !== 3 ||
      !Object.prototype.hasOwnProperty.call(timing, 'start') ||
      !Object.prototype.hasOwnProperty.call(timing, 'end')
    ) {
      throw unsupportedOccurrenceTimingPatch();
    }
    const start = recurrenceDateTimeFromUnknown(timing.start);
    const end = recurrenceDateTimeFromUnknown(timing.end);
    if ((start.type === 'date') !== (end.type === 'date')) {
      throw unsupportedOccurrenceTimingPatch();
    }
    return { type: 'end', start, end };
  }

  if (timing.type === 'duration') {
    if (
      Object.keys(timing).length !== 3 ||
      !Object.prototype.hasOwnProperty.call(timing, 'start') ||
      !Object.prototype.hasOwnProperty.call(timing, 'duration')
    ) {
      throw unsupportedOccurrenceTimingPatch();
    }
    const start = recurrenceDateTimeFromUnknown(timing.start);
    if (start.type === 'date' || !isPositiveRfcDuration(timing.duration)) {
      throw unsupportedOccurrenceTimingPatch();
    }
    return {
      type: 'duration',
      start,
      duration: timing.duration,
    };
  }

  throw unsupportedOccurrenceTimingPatch();
}

export function recurrenceIdAsIcalTime(recurrenceId: CalendarEventDateTime): {
  value: ICAL.Time;
  timezone?: string;
} {
  switch (recurrenceId.type) {
    case 'date':
      return { value: ICAL.Time.fromDateString(recurrenceId.value) };
    case 'floating-date-time':
      return {
        value: ICAL.Time.fromDateTimeString(
          normalizeLocalDateTime(recurrenceId.value),
        ),
      };
    case 'date-time':
      return {
        value: ICAL.Time.fromDateTimeString(
          recurrenceId.value.timezone === 'UTC'
            ? `${normalizeLocalDateTime(recurrenceId.value.local)}Z`
            : normalizeLocalDateTime(recurrenceId.value.local),
        ),
        timezone:
          recurrenceId.value.timezone === 'UTC'
            ? undefined
            : recurrenceId.value.timezone,
      };
  }
}

export function assertSimpleRecurrenceCanBeEdited(event: CalendarEvent): void {
  const recurrence = event.recurrence;
  if (
    event.unsupportedTimezone ||
    event.unsupportedRecurrence ||
    recurrence?.rdates?.length ||
    recurrence?.exdates?.length ||
    recurrence?.recurrenceId ||
    recurrence?.overrides?.length
  ) {
    throw unsupportedRecurrencePatch();
  }

  if (recurrence && Object.prototype.hasOwnProperty.call(recurrence, 'rrule')) {
    if (typeof recurrence.rrule !== 'string') {
      throw unsupportedRecurrencePatch();
    }
    validateRecurrenceRule(
      recurrence.rrule,
      timingStartAsDateTime(event.timing),
    );
  }
}

export function validateRecurrenceRule(
  rule: string,
  anchor: CalendarEventDateTime,
): void {
  try {
    if (!rule.trim()) {
      throw new Error('empty recurrence rule');
    }
    parseSupportedCalendarEventRecurrenceRule(rule, anchor);
  } catch {
    throw unsupportedRecurrencePatch();
  }
}

export function timingStartAsDateTime(
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

export function setRecurrenceRule(
  vevent: ICAL.Component,
  rule: string | undefined,
): void {
  vevent.removeAllProperties('rrule');
  if (rule) {
    const ruleText = rule.trim().replace(/^RRULE:/i, '');
    vevent.addPropertyWithValue('rrule', ICAL.Recur.fromString(ruleText));
  }
}

export function canonicalizeRecurrenceRule(rule: string): string {
  const ruleText = rule.trim().replace(/^RRULE:/i, '');
  return String(ICAL.Recur.fromString(ruleText));
}

export function validateRawOccurrenceTimingProperties(
  rawProperties: RawVeventProperty[],
  component: ICAL.Component,
): void {
  for (const name of ['dtstart', 'dtend', 'recurrence-id']) {
    const raw = rawProperties.filter((property) => property.name === name);
    const parsed = component.getAllProperties(name);
    if (
      raw.length !== parsed.length ||
      (name === 'dtstart' && raw.length !== 1) ||
      (name !== 'dtstart' && raw.length > 1)
    ) {
      throw unsupportedOccurrenceTimingPatch();
    }
    for (let index = 0; index < raw.length; index += 1) {
      const value = rawOccurrenceDateTime(raw[index]);
      if (
        name === 'recurrence-id' &&
        contentLineParameters(raw[index].header).some(
          (parameter) => parameter.name === 'range',
        )
      ) {
        throw unsupportedOccurrenceTimingPatch();
      }
      let parsedValue: CalendarEventDateTime;
      try {
        parsedValue = readDateTimeProperty(parsed[index]);
      } catch {
        throw unsupportedOccurrenceTimingPatch();
      }
      if (
        calendarEventRecurrenceIdentity(value) !==
        calendarEventRecurrenceIdentity(parsedValue)
      ) {
        throw unsupportedOccurrenceTimingPatch();
      }
    }
  }

  const rawDurations = rawProperties.filter(
    (property) => property.name === 'duration',
  );
  const parsedDurations = component.getAllProperties('duration');
  if (
    rawDurations.length !== parsedDurations.length ||
    rawDurations.length > 1 ||
    (rawDurations.length > 0 && component.getAllProperties('dtend').length > 0)
  ) {
    throw unsupportedOccurrenceTimingPatch();
  }
  for (let index = 0; index < rawDurations.length; index += 1) {
    const parameters = contentLineParameters(rawDurations[index].header);
    if (
      parameters.some(
        (parameter) => parameter.name === 'tzid' || parameter.name === 'value',
      )
    ) {
      throw unsupportedOccurrenceTimingPatch();
    }
    const rawDuration = positiveDurationFromRaw(rawDurations[index].value);
    const parsedDuration = parsedDurations[index].getFirstValue();
    if (
      !rawDuration ||
      !(parsedDuration instanceof ICAL.Duration) ||
      !sameDuration(rawDuration, readDuration(parsedDuration))
    ) {
      throw unsupportedOccurrenceTimingPatch();
    }
  }
}

function rawOccurrenceDateTime(
  property: RawVeventProperty,
): CalendarEventDateTime {
  const parameters = contentLineParameters(property.header);
  const valueParameters = parameters.filter(
    (parameter) => parameter.name === 'value',
  );
  const timezoneParameters = parameters.filter(
    (parameter) => parameter.name === 'tzid',
  );
  if (valueParameters.length > 1 || timezoneParameters.length > 1) {
    throw unsupportedOccurrenceTimingPatch();
  }
  const valueType = valueParameters[0]?.value?.toUpperCase();
  const timezone = timezoneParameters[0]?.value;
  if (
    (valueParameters.length > 0 && !valueType) ||
    (timezoneParameters.length > 0 && !timezone)
  ) {
    throw unsupportedOccurrenceTimingPatch();
  }

  const date = /^(\d{4})(\d{2})(\d{2})$/.exec(property.value);
  if (date) {
    const value = `${date[1]}-${date[2]}-${date[3]}`;
    if (
      !isValidCalendarDate(value) ||
      (valueType !== undefined && valueType !== 'DATE') ||
      timezone !== undefined
    ) {
      throw unsupportedOccurrenceTimingPatch();
    }
    return { type: 'date', value };
  }

  const dateTime = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(
    property.value,
  );
  if (!dateTime || (valueType !== undefined && valueType !== 'DATE-TIME')) {
    throw unsupportedOccurrenceTimingPatch();
  }
  const local = `${dateTime[1]}-${dateTime[2]}-${dateTime[3]}T${dateTime[4]}:${dateTime[5]}:${dateTime[6]}`;
  if (!isValidLocalDateTime(local)) {
    throw unsupportedOccurrenceTimingPatch();
  }
  if (timezone !== undefined) {
    if (
      dateTime[7] ||
      timezone === 'UTC' ||
      !isCalendarTimezoneSupported(timezone)
    ) {
      throw unsupportedOccurrenceTimingPatch();
    }
    return { type: 'date-time', value: { local, timezone } };
  }
  return dateTime[7]
    ? { type: 'date-time', value: { local, timezone: 'UTC' } }
    : { type: 'floating-date-time', value: local };
}

function positiveDurationFromRaw(
  value: string,
): CalendarEventDuration | undefined {
  const match =
    /^([+-])?P(?:(\d+)W|(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?)$/.exec(
      value,
    );
  if (!match || (value.includes('T') && !match[4] && !match[5] && !match[6])) {
    return undefined;
  }
  const duration: CalendarEventDuration = {
    weeks: Number(match[2] ?? 0),
    days: Number(match[3] ?? 0),
    hours: Number(match[4] ?? 0),
    minutes: Number(match[5] ?? 0),
    seconds: Number(match[6] ?? 0),
    isNegative: match[1] === '-',
  };
  return isPositiveRfcDuration(duration) ? duration : undefined;
}

function sameDuration(
  left: CalendarEventDuration,
  right: CalendarEventDuration,
): boolean {
  return (
    left.weeks === right.weeks &&
    left.days === right.days &&
    left.hours === right.hours &&
    left.minutes === right.minutes &&
    left.seconds === right.seconds &&
    left.isNegative === right.isNegative
  );
}
