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

import ICAL from 'ical.js';

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
    const alarm = ICAL.Component.fromString(alarmSource.trim());
    if (
      alarm.name !== 'valarm' ||
      !Number.isSafeInteger(triggerOrdinal) ||
      triggerOrdinal < 0
    ) {
      return undefined;
    }

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
    const triggerValues = rawPropertyValues(alarmSource, 'TRIGGER');
    if (triggers.length !== 1 || triggerValues.length !== 1) {
      return undefined;
    }
    const trigger = triggers[0];
    if (
      trigger.type !== 'duration' ||
      !(trigger.getFirstValue() instanceof ICAL.Duration)
    ) {
      return undefined;
    }
    const triggerDuration = strictDuration(triggerValues[0]);
    if (!triggerDuration) return undefined;

    const relationValue = trigger.getParameter('related');
    if (Array.isArray(relationValue) && relationValue.length !== 1) {
      return undefined;
    }
    const relation = Array.isArray(relationValue)
      ? relationValue[0]
      : relationValue;
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
    const repeatValues = rawPropertyValues(alarmSource, 'REPEAT');
    const repeatDurationValues = rawPropertyValues(alarmSource, 'DURATION');
    if (repeats.length === 0 && repeatDurations.length === 0) {
      if (
        repeatValues.length !== 0 ||
        repeatDurationValues.length !== 0 ||
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
        repeatValues.length !== 1 ||
        repeatDurationValues.length !== 1
      ) {
        return undefined;
      }
      const repeatCount = strictRepeatCount(repeatValues[0]);
      const repeatDuration = strictDuration(repeatDurationValues[0]);
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

function isResolvableDateTime(value: ICAL.Time): boolean {
  return (
    !value.isDate &&
    value.zone !== ICAL.Timezone.localTimezone &&
    typeof value.zone?.tzid === 'string' &&
    value.zone.tzid.length > 0
  );
}

function rawPropertyValues(source: string, propertyName: string): string[] {
  const unfoldedLines = source.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  return unfoldedLines.flatMap((line) => {
    const separator = findUnquotedColon(line);
    if (separator < 0) return [];
    const property = line.slice(0, separator);
    const name = property.split(';', 1)[0];
    return name.toUpperCase() === propertyName
      ? [line.slice(separator + 1)]
      : [];
  });
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
  const calendarDate = calendarAdjusted.toJSDate();
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
