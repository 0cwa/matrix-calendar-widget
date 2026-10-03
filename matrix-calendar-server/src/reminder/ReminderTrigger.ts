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

import type { CalendarEventDuration } from '@matrix-calendar-widget/calendar';
import { calendarLocalDateTimeToUnixMillis } from '@matrix-calendar-widget/calendar';
import ICAL from 'ical.js';

export const MAX_REMINDER_REPEAT_COUNT = 100;
export const MAX_REMINDER_TRIGGER_HORIZON_MS = 366 * 24 * 60 * 60 * 1000;
export const MAX_REMINDER_EVENT_DURATION_MS = 366 * 24 * 60 * 60 * 1000;

/**
 * Timing for one already-expanded VEVENT occurrence. The caller must pass
 * timezone-aware date-times from the canonical resource after applying any
 * recurrence override. Date-only values are rejected because no user timezone
 * is available to resolve their firing instant; floating values are rejected
 * because they do not identify a UTC instant.
 */
export type ResolvedReminderOccurrenceTiming = {
  start: ICAL.Time;
  end?: ICAL.Time;
};

export type ReminderAlarmTimingOption = {
  relatedTo: 'start' | 'end';
  trigger: CalendarEventDuration;
  repeat?: {
    count: number;
    interval: CalendarEventDuration;
  };
};

type RawAlarmProperty = {
  name: string;
  value: string;
  parameters: ReadonlyMap<string, string>;
};

type ValidatedDisplayAlarmSource = {
  alarm: ICAL.Component;
  properties: readonly RawAlarmProperty[];
};

/**
 * Calculate one DISPLAY VALARM firing from its original, identity-resolved
 * content-line source. The original text is required because ical.js parses
 * INTEGER and DURATION values with parseInt and can normalize malformed text.
 *
 * Supported TRIGGERs are relative DURATION values with RELATED omitted,
 * START, or END. RFC 5545's default relation is START. Positive, zero, and
 * negative trigger durations are applied in the occurrence's VTIMEZONE, so
 * nominal days/weeks preserve local calendar arithmetic across DST, before
 * exact hours/minutes/seconds are applied as elapsed time. Absolute
 * DATE-TIME triggers are deliberately unsupported because their relationship
 * to per-occurrence sidecar identities is not defined yet.
 *
 * REPEAT and its positive DURATION must either both be absent or both occur
 * once. Repeat intervals are limited to exact hours/minutes/seconds; this
 * avoids ambiguous nominal-day arithmetic when advancing a repeat ordinal.
 * `triggerOrdinal` is zero for the initial firing and 1..REPEAT thereafter.
 * Unsupported or malformed alarm forms return undefined without exposing ICS
 * values to callers.
 */
export function calculateDisplayReminderDueAt(
  alarmSource: string,
  occurrence: ResolvedReminderOccurrenceTiming,
  triggerOrdinal = 0,
): Date | undefined {
  try {
    const validated = parseDisplayAlarmSource(alarmSource);
    if (
      !validated ||
      !Number.isSafeInteger(triggerOrdinal) ||
      triggerOrdinal < 0
    ) {
      return undefined;
    }
    const { alarm, properties } = validated;

    const actions = alarm.getAllProperties('action');
    if (
      actions.length !== 1 ||
      String(actions[0].getFirstValue()).toUpperCase() !== 'DISPLAY'
    ) {
      return undefined;
    }
    if (alarm.getAllProperties('description').length !== 1) {
      return undefined;
    }

    const triggers = alarm.getAllProperties('trigger');
    const triggerProperty = oneRawProperty(properties, 'TRIGGER');
    if (triggers.length !== 1 || !triggerProperty) return undefined;
    const trigger = triggers[0];
    if (
      trigger.type !== 'duration' ||
      !(trigger.getFirstValue() instanceof ICAL.Duration)
    ) {
      return undefined;
    }
    if (
      triggerProperty.parameters.has('VALUE') &&
      triggerProperty.parameters.get('VALUE')?.toUpperCase() !== 'DURATION'
    ) {
      return undefined;
    }
    const triggerDuration = strictDuration(triggerProperty.value);
    if (!triggerDuration) return undefined;

    const relation = triggerProperty.parameters.get('RELATED');
    if (
      typeof relation === 'string' &&
      !['START', 'END'].includes(relation.toUpperCase())
    ) {
      return undefined;
    }
    const useEnd =
      typeof relation === 'string' && relation.toUpperCase() === 'END';
    const anchor = useEnd ? occurrence.end : occurrence.start;
    if (!anchor || !isResolvableDateTime(anchor)) {
      return undefined;
    }

    const repeats = alarm.getAllProperties('repeat');
    const repeatDurations = alarm.getAllProperties('duration');
    const repeatProperty = oneRawProperty(properties, 'REPEAT');
    const repeatDurationProperty = oneRawProperty(properties, 'DURATION');
    if (repeats.length === 0 && repeatDurations.length === 0) {
      if (
        repeatProperty !== undefined ||
        repeatDurationProperty !== undefined ||
        triggerOrdinal !== 0
      ) {
        return undefined;
      }
    } else {
      if (
        repeats.length !== 1 ||
        repeatDurations.length !== 1 ||
        repeats[0].type !== 'integer' ||
        repeatDurations[0].type !== 'duration' ||
        repeatProperty === undefined ||
        repeatDurationProperty === undefined
      ) {
        return undefined;
      }
      const repeatCount = strictRepeatCount(repeatProperty.value);
      const repeatDuration = strictDuration(repeatDurationProperty.value);
      if (
        repeatCount === undefined ||
        repeatCount < 1 ||
        repeatCount > 2_147_483_647 ||
        triggerOrdinal > repeatCount ||
        !repeatDuration ||
        repeatDuration.isNegative ||
        repeatDuration.weeks !== 0 ||
        repeatDuration.days !== 0
      ) {
        return undefined;
      }
      const repeatSeconds = exactDurationSeconds(repeatDuration);
      if (repeatSeconds === undefined) {
        return undefined;
      }
      const repeatedMilliseconds = repeatSeconds * triggerOrdinal * 1000;
      if (repeatSeconds <= 0 || !Number.isSafeInteger(repeatedMilliseconds)) {
        return undefined;
      }
      const firstDueAt = relativeTriggerDate(anchor, triggerDuration);
      return firstDueAt
        ? validDate(new Date(firstDueAt.getTime() + repeatedMilliseconds))
        : undefined;
    }

    return relativeTriggerDate(anchor, triggerDuration);
  } catch {
    return undefined;
  }
}

/**
 * Apply the bounded trigger policy used by both settings validation and the
 * canonical scheduler adapter. Keep the general RFC calculator above
 * unbounded so other callers can inspect valid RFC alarms independently of
 * the initial delivery policy.
 */
export function isReminderScheduleWithinLimits(
  alarmSource: string,
  occurrence: ResolvedReminderOccurrenceTiming,
): boolean {
  try {
    const validated = parseDisplayAlarmSource(alarmSource);
    if (!validated) return false;
    const { alarm, properties } = validated;

    const repeats = alarm.getAllProperties('repeat');
    const repeatProperty = oneRawProperty(properties, 'REPEAT');
    let repeatCount = 0;
    if (repeats.length > 0) {
      if (repeats.length !== 1 || !repeatProperty) return false;
      const parsedCount = strictRepeatCount(repeatProperty.value);
      if (
        parsedCount === undefined ||
        parsedCount < 1 ||
        parsedCount > MAX_REMINDER_REPEAT_COUNT
      ) {
        return false;
      }
      repeatCount = parsedCount;
    } else if (repeatProperty !== undefined) {
      return false;
    }

    const triggers = alarm.getAllProperties('trigger');
    const triggerProperty = oneRawProperty(properties, 'TRIGGER');
    if (triggers.length !== 1 || !triggerProperty) return false;
    if (
      triggerProperty.parameters.has('VALUE') &&
      triggerProperty.parameters.get('VALUE')?.toUpperCase() !== 'DURATION'
    ) {
      return false;
    }
    const related = triggerProperty.parameters.get('RELATED');
    const useEnd =
      typeof related === 'string' && related.toUpperCase() === 'END';
    const anchor = useEnd ? occurrence.end : occurrence.start;
    if (!anchor || !isResolvableDateTime(anchor)) return false;

    if (useEnd) {
      const start = occurrence.start;
      const end = occurrence.end;
      if (
        !start ||
        !end ||
        !isResolvableDateTime(start) ||
        !isResolvableDateTime(end) ||
        start.zone.tzid !== end.zone.tzid
      ) {
        return false;
      }
      const startInstant = calendarLocalDateTimeToUnixMillis(
        formatLocalDateTime(start),
        start.zone.tzid,
      );
      const endInstant = calendarLocalDateTimeToUnixMillis(
        formatLocalDateTime(end),
        end.zone.tzid,
      );
      const eventDuration = endInstant - startInstant;
      if (
        !Number.isFinite(eventDuration) ||
        eventDuration <= 0 ||
        eventDuration > MAX_REMINDER_EVENT_DURATION_MS
      ) {
        return false;
      }
    }

    const anchorInstant = calendarLocalDateTimeToUnixMillis(
      formatLocalDateTime(anchor),
      anchor.zone.tzid,
    );
    const firstDueAt = calculateDisplayReminderDueAt(
      alarmSource,
      occurrence,
      0,
    );
    const lastDueAt = calculateDisplayReminderDueAt(
      alarmSource,
      occurrence,
      repeatCount,
    );
    if (!Number.isFinite(anchorInstant) || !firstDueAt || !lastDueAt) {
      return false;
    }

    return (
      Math.abs(firstDueAt.getTime() - anchorInstant) <=
        MAX_REMINDER_TRIGGER_HORIZON_MS &&
      Math.abs(lastDueAt.getTime() - anchorInstant) <=
        MAX_REMINDER_TRIGGER_HORIZON_MS
    );
  } catch {
    return false;
  }
}

/**
 * Return the minimal timing metadata for a raw alarm source after its caller
 * has established event timing and schedule limits. This intentionally omits
 * descriptions, extensions, and all other iCalendar content.
 */
export function readReminderAlarmTimingOption(
  alarmSource: string,
): ReminderAlarmTimingOption | undefined {
  const validated = parseDisplayAlarmSource(alarmSource);
  if (!validated) return undefined;

  const triggerProperty = oneRawProperty(validated.properties, 'TRIGGER');
  if (!triggerProperty) return undefined;
  const triggerDuration = strictDuration(triggerProperty.value);
  if (!triggerDuration) return undefined;

  const repeatProperty = oneRawProperty(validated.properties, 'REPEAT');
  const repeatDurationProperty = oneRawProperty(
    validated.properties,
    'DURATION',
  );
  let repeat: ReminderAlarmTimingOption['repeat'];
  if (repeatProperty && repeatDurationProperty) {
    const count = strictRepeatCount(repeatProperty.value);
    const duration = strictDuration(repeatDurationProperty.value);
    if (
      count === undefined ||
      count < 1 ||
      count > MAX_REMINDER_REPEAT_COUNT ||
      !duration ||
      duration.isNegative ||
      duration.weeks !== 0 ||
      duration.days !== 0 ||
      (exactDurationSeconds(duration) ?? 0) <= 0
    ) {
      return undefined;
    }
    repeat = {
      count,
      interval: toCalendarEventDuration(duration),
    };
  } else if (repeatProperty || repeatDurationProperty) {
    return undefined;
  }

  return {
    relatedTo:
      triggerProperty.parameters.get('RELATED')?.toUpperCase() === 'END'
        ? 'end'
        : 'start',
    trigger: toCalendarEventDuration(triggerDuration),
    ...(repeat ? { repeat } : {}),
  };
}

function toCalendarEventDuration(
  duration: ICAL.Duration,
): CalendarEventDuration {
  return {
    weeks: duration.weeks,
    days: duration.days,
    hours: duration.hours,
    minutes: duration.minutes,
    seconds: duration.seconds,
    isNegative: duration.isNegative,
  };
}

function isResolvableDateTime(value: ICAL.Time): boolean {
  return (
    !value.isDate &&
    value.zone !== ICAL.Timezone.localTimezone &&
    typeof value.zone?.tzid === 'string' &&
    value.zone.tzid.length > 0
  );
}

function parseDisplayAlarmSource(
  source: string,
): ValidatedDisplayAlarmSource | undefined {
  try {
    if (source.includes('\r') && /\r(?!\n)/.test(source)) {
      return undefined;
    }
    const physicalLines = source.replace(/\r\n/g, '\n').split('\n');
    if (physicalLines.at(-1) === '') physicalLines.pop();
    const lines: string[] = [];
    for (const line of physicalLines) {
      if (/^[ \t]/.test(line)) {
        if (lines.length === 0) return undefined;
        lines[lines.length - 1] += line.slice(1);
      } else {
        lines.push(line);
      }
    }
    if (
      lines.length < 3 ||
      lines[0].toUpperCase() !== 'BEGIN:VALARM' ||
      lines.at(-1)?.toUpperCase() !== 'END:VALARM'
    ) {
      return undefined;
    }

    const properties: RawAlarmProperty[] = [];
    for (const line of lines.slice(1, -1)) {
      if (line.length === 0) return undefined;
      const property = parseRawAlarmProperty(line);
      if (!property) return undefined;
      properties.push(property);
    }

    const propertyCounts = new Map<string, number>();
    for (const property of properties) {
      propertyCounts.set(
        property.name,
        (propertyCounts.get(property.name) ?? 0) + 1,
      );
    }
    for (const requiredName of ['ACTION', 'DESCRIPTION', 'TRIGGER']) {
      if (propertyCounts.get(requiredName) !== 1) return undefined;
    }
    for (const optionalName of ['UID', 'REPEAT', 'DURATION']) {
      if ((propertyCounts.get(optionalName) ?? 0) > 1) return undefined;
    }
    if (
      (propertyCounts.has('REPEAT') && !propertyCounts.has('DURATION')) ||
      (!propertyCounts.has('REPEAT') && propertyCounts.has('DURATION'))
    ) {
      return undefined;
    }

    const trigger = oneRawProperty(properties, 'TRIGGER');
    if (
      !trigger ||
      (trigger.parameters.has('VALUE') &&
        trigger.parameters.get('VALUE')?.toUpperCase() !== 'DURATION') ||
      (trigger.parameters.has('RELATED') &&
        !['START', 'END'].includes(
          trigger.parameters.get('RELATED')?.toUpperCase() ?? '',
        ))
    ) {
      return undefined;
    }

    const action = oneRawProperty(properties, 'ACTION');
    if (!action || action.value.toUpperCase() !== 'DISPLAY') return undefined;

    const alarm = ICAL.Component.fromString(source.replace(/\r\n/g, '\n'));
    if (alarm.name !== 'valarm') return undefined;
    for (const propertyName of [
      'action',
      'description',
      'trigger',
      'uid',
      'repeat',
      'duration',
    ]) {
      const expectedCount = propertyCounts.get(propertyName.toUpperCase()) ?? 0;
      if (alarm.getAllProperties(propertyName).length !== expectedCount) {
        return undefined;
      }
    }
    return { alarm, properties };
  } catch {
    return undefined;
  }
}

function parseRawAlarmProperty(line: string): RawAlarmProperty | undefined {
  const separator = findUnquotedColon(line);
  if (separator < 0) return undefined;
  const sections = splitOutsideQuotes(line.slice(0, separator), ';');
  const rawName = sections.shift();
  if (!rawName) return undefined;
  const nameParts = rawName.split('.');
  if (nameParts.some((part) => !/^[A-Za-z0-9-]+$/.test(part))) {
    return undefined;
  }
  const name = nameParts.at(-1)?.toUpperCase();
  if (
    !name ||
    (![
      'ACTION',
      'UID',
      'DESCRIPTION',
      'TRIGGER',
      'REPEAT',
      'DURATION',
    ].includes(name) &&
      !name.startsWith('X-'))
  ) {
    return undefined;
  }

  const allowedParameters: Record<string, readonly string[]> = {
    ACTION: [],
    UID: [],
    DESCRIPTION: ['ALTREP', 'LANGUAGE'],
    TRIGGER: ['RELATED', 'VALUE'],
    REPEAT: [],
    DURATION: [],
  };
  const parameters = new Map<string, string>();
  for (const section of sections) {
    const equals = section.indexOf('=');
    if (equals <= 0) return undefined;
    const parameterName = section.slice(0, equals).toUpperCase();
    const rawValue = section.slice(equals + 1);
    const value = unquoteParameterValue(rawValue);
    if (
      !/^[A-Z0-9-]+$/.test(parameterName) ||
      value === undefined ||
      value.length === 0 ||
      parameters.has(parameterName)
    ) {
      return undefined;
    }
    const allowed = allowedParameters[name] ?? [];
    if (!allowed.includes(parameterName) && !parameterName.startsWith('X-')) {
      return undefined;
    }
    parameters.set(parameterName, value);
  }

  return { name, value: line.slice(separator + 1), parameters };
}

function oneRawProperty(
  properties: readonly RawAlarmProperty[],
  name: string,
): RawAlarmProperty | undefined {
  const matches = properties.filter((property) => property.name === name);
  return matches.length === 1 ? matches[0] : undefined;
}

function splitOutsideQuotes(value: string, delimiter: string): string[] {
  const sections: string[] = [];
  let quoted = false;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '"') quoted = !quoted;
    if (value[index] === delimiter && !quoted) {
      sections.push(value.slice(start, index));
      start = index + 1;
    }
  }
  if (quoted) throw new Error('Malformed quoted parameter');
  sections.push(value.slice(start));
  return sections;
}

function unquoteParameterValue(value: string): string | undefined {
  if (value.startsWith('"') || value.endsWith('"')) {
    if (
      value.length < 2 ||
      !value.startsWith('"') ||
      !value.endsWith('"') ||
      value.slice(1, -1).includes('"')
    ) {
      return undefined;
    }
    return value.slice(1, -1);
  }
  if (value.includes('"')) return undefined;
  return value;
}

function findUnquotedColon(line: string): number {
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === '"') quoted = !quoted;
    if (line[index] === ':' && !quoted) return index;
  }
  return -1;
}

function strictRepeatCount(value: string): number | undefined {
  if (!/^[+-]?\d+$/.test(value)) return undefined;
  const count = Number(value);
  return Number.isInteger(count) &&
    count >= -2_147_483_648 &&
    count <= 2_147_483_647
    ? count
    : undefined;
}

function strictDuration(value: string): ICAL.Duration | undefined {
  const match =
    /^([+-])?P(?:(\d+)W|(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?)$/i.exec(
      value,
    );
  if (!match) return undefined;
  const [, sign, weeksText, daysText, hoursText, minutesText, secondsText] =
    match;
  const parts = [weeksText, daysText, hoursText, minutesText, secondsText];
  if (
    !parts.some((part) => part !== undefined) ||
    (/T/i.test(value) &&
      hoursText === undefined &&
      minutesText === undefined &&
      secondsText === undefined) ||
    (weeksText !== undefined &&
      parts.slice(1).some((part) => part !== undefined))
  ) {
    return undefined;
  }
  const numbers = parts.map((part) => (part === undefined ? 0 : Number(part)));
  if (numbers.some((part) => !Number.isSafeInteger(part))) return undefined;
  const [weeks, days, hours, minutes, seconds] = numbers;
  return ICAL.Duration.fromData({
    weeks,
    days,
    hours,
    minutes,
    seconds,
    isNegative: sign === '-',
  });
}

function relativeTriggerDate(
  anchor: ICAL.Time,
  duration: ICAL.Duration,
): Date | undefined {
  const durationParts = [
    duration.weeks,
    duration.days,
    duration.hours,
    duration.minutes,
    duration.seconds,
  ];
  if (
    durationParts.some((part) => !Number.isSafeInteger(part) || part < 0) ||
    (duration.weeks > 0 &&
      (duration.days > 0 ||
        duration.hours > 0 ||
        duration.minutes > 0 ||
        duration.seconds > 0))
  ) {
    return undefined;
  }

  // RFC 5545 treats weeks/days as nominal calendar units but hours and
  // smaller units as exact elapsed time. Apply the calendar portion in the
  // occurrence timezone first, then apply the signed exact portion as UTC.
  const calendarAdjusted = anchor.clone();
  calendarAdjusted.addDuration(
    ICAL.Duration.fromData({
      weeks: duration.weeks,
      days: duration.days,
      isNegative: duration.isNegative,
    }),
  );
  let calendarDate: Date;
  try {
    calendarDate = new Date(
      calendarLocalDateTimeToUnixMillis(
        formatLocalDateTime(calendarAdjusted),
        calendarAdjusted.zone.tzid,
      ),
    );
  } catch {
    return undefined;
  }
  const exactSeconds = exactDurationSeconds(duration);
  if (
    !Number.isFinite(calendarDate.getTime()) ||
    exactSeconds === undefined ||
    !Number.isSafeInteger(exactSeconds * 1000)
  ) {
    return undefined;
  }
  const sign = duration.isNegative ? -1 : 1;
  return validDate(
    new Date(calendarDate.getTime() + sign * exactSeconds * 1000),
  );
}

function formatLocalDateTime(value: ICAL.Time): string {
  return `${String(value.year).padStart(4, '0')}-${String(value.month).padStart(2, '0')}-${String(value.day).padStart(2, '0')}T${String(value.hour).padStart(2, '0')}:${String(value.minute).padStart(2, '0')}:${String(value.second).padStart(2, '0')}`;
}

function exactDurationSeconds(duration: ICAL.Duration): number | undefined {
  if (
    !Number.isSafeInteger(duration.hours) ||
    duration.hours < 0 ||
    !Number.isSafeInteger(duration.minutes) ||
    duration.minutes < 0 ||
    !Number.isSafeInteger(duration.seconds) ||
    duration.seconds < 0
  ) {
    return undefined;
  }
  const seconds =
    duration.hours * 60 * 60 + duration.minutes * 60 + duration.seconds;
  return Number.isSafeInteger(seconds) ? seconds : undefined;
}

function validDate(value: Date): Date | undefined {
  const date = value;
  return Number.isFinite(date.getTime()) ? date : undefined;
}
