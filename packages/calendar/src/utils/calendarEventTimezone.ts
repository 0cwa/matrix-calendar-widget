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

import { getVTimezoneBlock } from '@matrix-calendar-widget/ical-timezones';
import ICAL from 'ical.js';
import { DateTime } from 'luxon';

type ZoneChange = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  utcOffset: number;
  prevUtcOffset: number;
};

const localDateTimePattern = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::(\d{2}))?$/;

/**
 * A timezone or local wall time that cannot be represented by the bundled
 * IANA 2026d data and its iCalendar rules.
 */
export class CalendarEventTimezoneError extends Error {
  constructor(
    public readonly code: 'unsupported-timezone' | 'invalid-local-time',
  ) {
    super(code);
    this.name = 'CalendarEventTimezoneError';
  }
}

const timezones = new Map<string, ICAL.Timezone>();

export function isCalendarTimezoneSupported(timezoneId: string): boolean {
  return Boolean(getVTimezoneBlock(timezoneId));
}

/** Interpret a typed DATE-TIME wall value using the bundled IANA rules. */
export function calendarLocalDateTimeToUnixMillis(
  local: string,
  timezoneId: string,
): number {
  const { wallMillis, timezone, transitions } = timezoneContext(
    local,
    timezoneId,
  );
  const nearbyTransition = findLocalTransition(wallMillis, transitions);

  if (nearbyTransition?.kind === 'overlap') {
    // RFC 5545 resolves an ambiguous local value to its first occurrence.
    return wallMillis - nearbyTransition.change.prevUtcOffset * 1000;
  }

  if (nearbyTransition?.kind === 'gap') {
    // RFC 5545 interprets explicit local values with the offset before a gap.
    return wallMillis - nearbyTransition.change.prevUtcOffset * 1000;
  }

  const wallTime = ICAL.Time.fromJSDate(new Date(wallMillis), true);
  const instant = wallMillis - timezone.utcOffset(wallTime) * 1000;
  if (instantToWallMillis(instant, transitions, timezone) !== wallMillis) {
    throw new CalendarEventTimezoneError('invalid-local-time');
  }
  return instant;
}

/** Return false for an RRULE-generated wall time in a local DST gap. */
export function isCalendarRecurrenceWallTimeValid(
  local: string,
  timezoneId: string,
): boolean {
  const { wallMillis, transitions } = timezoneContext(local, timezoneId);
  return findLocalTransition(wallMillis, transitions)?.kind !== 'gap';
}

/** Convert an instant to a local iCalendar value without host tzdata. */
export function calendarUnixMillisToLocalDateTime(
  instantMillis: number,
  timezoneId: string,
): string {
  const timezone = timezoneFor(timezoneId);
  const transitions = getTransitions(timezone, instantMillis);
  const offset = offsetAtInstant(instantMillis, transitions, timezone);
  const local = DateTime.fromMillis(instantMillis + offset * 1000, {
    zone: 'UTC',
  });
  if (!local.isValid) {
    throw new CalendarEventTimezoneError('invalid-local-time');
  }
  return local.toFormat("yyyy-MM-dd'T'HH:mm:ss");
}

function timezoneContext(
  local: string,
  timezoneId: string,
): { wallMillis: number; timezone: ICAL.Timezone; transitions: ZoneChange[] } {
  const localMatch = local.match(localDateTimePattern);
  const wall = DateTime.fromISO(local, { zone: 'UTC' });
  if (
    !localMatch ||
    !wall.isValid ||
    (localMatch[2]
      ? wall.toFormat("yyyy-MM-dd'T'HH:mm:ss")
      : wall.toFormat("yyyy-MM-dd'T'HH:mm")) !== local
  ) {
    throw new CalendarEventTimezoneError('invalid-local-time');
  }
  const timezone = timezoneFor(timezoneId);
  return {
    wallMillis: wall.toMillis(),
    timezone,
    transitions: getTransitions(timezone, wall.toMillis()),
  };
}

function timezoneFor(timezoneId: string): ICAL.Timezone {
  const cached = timezones.get(timezoneId);
  if (cached) {
    return cached;
  }

  const component = getVTimezoneBlock(timezoneId);
  if (!component) {
    throw new CalendarEventTimezoneError('unsupported-timezone');
  }

  const timezone = new ICAL.Timezone({
    component: ICAL.Component.fromString(component),
    tzid: timezoneId,
  });
  timezones.set(timezoneId, timezone);
  return timezone;
}

function getTransitions(
  timezone: ICAL.Timezone,
  instantMillis: number,
): ZoneChange[] {
  const year = DateTime.fromMillis(instantMillis, { zone: 'UTC' }).year;
  timezone._ensureCoverage(year + 1);
  return timezone.changes as ZoneChange[];
}

function transitionMillis(change: ZoneChange): number {
  const date = new Date(0);
  date.setUTCFullYear(change.year, change.month - 1, change.day);
  date.setUTCHours(change.hour, change.minute, change.second, 0);
  return date.getTime();
}

function findLocalTransition(
  wallMillis: number,
  transitions: ZoneChange[],
): { kind: 'gap' | 'overlap'; change: ZoneChange } | undefined {
  for (const change of transitions) {
    const transition = transitionMillis(change);
    const beforeWall = transition + change.prevUtcOffset * 1000;
    const afterWall = transition + change.utcOffset * 1000;
    if (
      afterWall > beforeWall &&
      wallMillis >= beforeWall &&
      wallMillis < afterWall
    ) {
      return { kind: 'gap', change };
    }
    if (
      afterWall < beforeWall &&
      wallMillis >= afterWall &&
      wallMillis < beforeWall
    ) {
      return { kind: 'overlap', change };
    }
  }
  return undefined;
}

function offsetAtInstant(
  instantMillis: number,
  transitions: ZoneChange[],
  timezone: ICAL.Timezone,
): number {
  const first = transitions[0];
  let offset = first
    ? first.prevUtcOffset
    : timezone.utcOffset(ICAL.Time.fromJSDate(new Date(instantMillis), true));

  for (const change of transitions) {
    if (transitionMillis(change) > instantMillis) {
      break;
    }
    offset = change.utcOffset;
  }
  return offset;
}

function instantToWallMillis(
  instantMillis: number,
  transitions: ZoneChange[],
  timezone: ICAL.Timezone,
): number {
  return (
    instantMillis + offsetAtInstant(instantMillis, transitions, timezone) * 1000
  );
}
