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
  is_daylight: boolean;
};

type IndexedZoneChange = ZoneChange & {
  instantMillis: number;
  beforeWallMillis: number;
  afterWallMillis: number;
};

type ExactZoneOffsets = {
  fromOffset: number;
  toOffset: number;
};

type TimezoneObservance = {
  name: 'STANDARD' | 'DAYLIGHT';
  component: ICAL.Component;
  fromOffset: number;
  toOffset: number;
};

type CalendarTimezone = {
  timezone: ICAL.Timezone;
  observances: TimezoneObservance[];
  initialOffset: number;
  exactTransitions?: IndexedZoneChange[];
  transitionsThroughYear: number;
  exactOffsetsByTransition?: Map<string, ExactZoneOffsets>;
  indexedThroughYear: number;
};

const localDateTimePattern = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::(\d{2}))?$/;

/**
 * A timezone or local wall time that cannot be represented by the bundled
 * IANA 2026d data and its iCalendar rules.
 */
export class CalendarEventTimezoneError extends Error {
  constructor(
    public readonly code:
      | 'unsupported-timezone'
      | 'invalid-local-time'
      | 'invalid-timezone-data',
  ) {
    super(code);
    this.name = 'CalendarEventTimezoneError';
  }
}

const timezones = new Map<string, CalendarTimezone>();

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

  const offset = offsetAtWallTime(
    wallMillis,
    transitions,
    transitions[0]?.prevUtcOffset ?? timezone.initialOffset,
  );
  const instant = wallMillis - offset * 1000;
  if (
    instantToWallMillis(instant, transitions, timezone.initialOffset) !==
    wallMillis
  ) {
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
  const offset = offsetAtInstant(
    instantMillis,
    transitions,
    timezone.initialOffset,
  );
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
): {
  wallMillis: number;
  timezone: CalendarTimezone;
  transitions: IndexedZoneChange[];
} {
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

function timezoneFor(timezoneId: string): CalendarTimezone {
  const cached = timezones.get(timezoneId);
  if (cached) {
    return cached;
  }

  const component = getVTimezoneBlock(timezoneId);
  if (!component) {
    throw new CalendarEventTimezoneError('unsupported-timezone');
  }

  const timezoneComponent = ICAL.Component.fromString(component);
  const observances = parseTimezoneObservances(component, timezoneComponent);
  const timezone = new ICAL.Timezone({
    component: timezoneComponent,
    tzid: timezoneId,
  });
  const adapter: CalendarTimezone = {
    timezone,
    observances,
    initialOffset: observances[0].fromOffset,
    transitionsThroughYear: Number.NEGATIVE_INFINITY,
    indexedThroughYear: Number.NEGATIVE_INFINITY,
  };
  timezones.set(timezoneId, adapter);
  return adapter;
}

function getTransitions(
  adapter: CalendarTimezone,
  instantMillis: number,
): IndexedZoneChange[] {
  const year = DateTime.fromMillis(instantMillis, { zone: 'UTC' }).year;
  adapter.timezone._ensureCoverage(year + 1);
  const changes = adapter.timezone.changes as ZoneChange[];
  const throughYear =
    Math.max(year, ...changes.map((change) => change.year)) + 1;
  if (
    adapter.exactTransitions &&
    adapter.transitionsThroughYear >= throughYear
  ) {
    return adapter.exactTransitions;
  }
  const exactOffsets = exactOffsetsByTransition(adapter, throughYear);

  const transitions = changes
    .map((change) => {
      // ical.js 2.2.1 stores UTC offsets only to the minute. Recover the local
      // transition wall value using its generated offset, then restore the exact
      // source offset from the corresponding bundled VTIMEZONE observance.
      const localMillis =
        transitionMillis(change) + change.prevUtcOffset * 1000;
      const key = transitionKey(
        localMillis,
        change.is_daylight ? 'DAYLIGHT' : 'STANDARD',
      );
      const offsets = exactOffsets.get(key);
      if (!offsets) {
        throw new CalendarEventTimezoneError('invalid-timezone-data');
      }

      const exactTransitionMillis = localMillis - offsets.fromOffset * 1000;
      const date = new Date(exactTransitionMillis);
      return {
        instantMillis: exactTransitionMillis,
        beforeWallMillis: exactTransitionMillis + offsets.fromOffset * 1000,
        afterWallMillis: exactTransitionMillis + offsets.toOffset * 1000,
        year: date.getUTCFullYear(),
        month: date.getUTCMonth() + 1,
        day: date.getUTCDate(),
        hour: date.getUTCHours(),
        minute: date.getUTCMinutes(),
        second: date.getUTCSeconds(),
        utcOffset: offsets.toOffset,
        prevUtcOffset: offsets.fromOffset,
        is_daylight: change.is_daylight,
      };
    })
    .sort((left, right) => left.instantMillis - right.instantMillis);
  adapter.exactTransitions = transitions;
  adapter.transitionsThroughYear = throughYear;
  return transitions;
}

function exactOffsetsByTransition(
  adapter: CalendarTimezone,
  throughYear: number,
): Map<string, ExactZoneOffsets> {
  if (
    adapter.exactOffsetsByTransition &&
    adapter.indexedThroughYear >= throughYear
  ) {
    return adapter.exactOffsetsByTransition;
  }

  const offsetsByTransition = new Map<string, ExactZoneOffsets>();
  for (const observance of adapter.observances) {
    const start = observance.component.getFirstPropertyValue('dtstart');
    if (!(start instanceof ICAL.Time)) {
      throw new CalendarEventTimezoneError('invalid-timezone-data');
    }

    const add = (time: ICAL.Time): void => {
      const key = transitionKey(wallTimeMillis(time), observance.name);
      const offsets = {
        fromOffset: observance.fromOffset,
        toOffset: observance.toOffset,
      };
      const existing = offsetsByTransition.get(key);
      if (
        existing &&
        (existing.fromOffset !== offsets.fromOffset ||
          existing.toOffset !== offsets.toOffset)
      ) {
        throw new CalendarEventTimezoneError('invalid-timezone-data');
      }
      offsetsByTransition.set(key, offsets);
    };

    const recurrence = observance.component.getFirstPropertyValue('rrule');
    const rdates = observance.component.getAllProperties('rdate');
    if (!recurrence && rdates.length === 0) {
      add(start);
      continue;
    }

    for (const rdate of rdates) {
      for (const value of rdate.getValues()) {
        if (!(value instanceof ICAL.Time)) {
          throw new CalendarEventTimezoneError('invalid-timezone-data');
        }
        add(value.isDate ? start : value);
      }
    }

    if (recurrence) {
      if (!(recurrence instanceof ICAL.Recur)) {
        throw new CalendarEventTimezoneError('invalid-timezone-data');
      }
      const iterator = recurrence.iterator(start);
      let occurrence: ICAL.Time | null;
      while ((occurrence = iterator.next())) {
        if (occurrence.year > throughYear) {
          break;
        }
        add(occurrence);
      }
    }
  }

  adapter.exactOffsetsByTransition = offsetsByTransition;
  adapter.indexedThroughYear = throughYear;
  return offsetsByTransition;
}

function parseTimezoneObservances(
  rawTimezone: string,
  component: ICAL.Component,
): TimezoneObservance[] {
  const lines = rawTimezone.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const rawObservances: { name: 'STANDARD' | 'DAYLIGHT'; body: string[] }[] =
    [];
  let current: { name: 'STANDARD' | 'DAYLIGHT'; body: string[] } | undefined;

  for (const line of lines) {
    const begin = line.match(/^BEGIN:(STANDARD|DAYLIGHT)$/);
    if (begin) {
      if (current) {
        throw new CalendarEventTimezoneError('invalid-timezone-data');
      }
      current = { name: begin[1] as 'STANDARD' | 'DAYLIGHT', body: [] };
      continue;
    }
    if (current && line === `END:${current.name}`) {
      rawObservances.push(current);
      current = undefined;
      continue;
    }
    if (current) {
      current.body.push(line);
    }
  }
  if (current) {
    throw new CalendarEventTimezoneError('invalid-timezone-data');
  }

  const subcomponents = component.getAllSubcomponents();
  if (
    rawObservances.length === 0 ||
    rawObservances.length !== subcomponents.length
  ) {
    throw new CalendarEventTimezoneError('invalid-timezone-data');
  }

  return rawObservances.map(({ name, body }, index) => {
    const subcomponent = subcomponents[index];
    if (subcomponent.name.toUpperCase() !== name) {
      throw new CalendarEventTimezoneError('invalid-timezone-data');
    }
    return {
      name,
      component: subcomponent,
      fromOffset: parseRawOffset(body, 'TZOFFSETFROM'),
      toOffset: parseRawOffset(body, 'TZOFFSETTO'),
    };
  });
}

function parseRawOffset(lines: string[], propertyName: string): number {
  const values = lines
    .filter((line) => line.startsWith(`${propertyName}:`))
    .map((line) => line.slice(propertyName.length + 1));
  if (values.length !== 1) {
    throw new CalendarEventTimezoneError('invalid-timezone-data');
  }
  const match = values[0].match(/^([+-])(\d{2})(\d{2})(\d{2})?$/);
  if (!match) {
    throw new CalendarEventTimezoneError('invalid-timezone-data');
  }
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  const seconds = Number(match[4] ?? '0');
  if (hours > 23 || minutes > 59 || seconds > 59) {
    throw new CalendarEventTimezoneError('invalid-timezone-data');
  }
  const magnitude = hours * 3600 + minutes * 60 + seconds;
  return match[1] === '-' ? -magnitude : magnitude;
}

function transitionKey(
  localMillis: number,
  name: 'STANDARD' | 'DAYLIGHT',
): string {
  return `${localMillis}|${name}`;
}

function wallTimeMillis(time: ICAL.Time): number {
  const date = new Date(0);
  date.setUTCFullYear(time.year, time.month - 1, time.day);
  date.setUTCHours(time.hour, time.minute, time.second, 0);
  return date.getTime();
}

function transitionMillis(change: ZoneChange): number {
  const date = new Date(0);
  date.setUTCFullYear(change.year, change.month - 1, change.day);
  date.setUTCHours(change.hour, change.minute, change.second, 0);
  return date.getTime();
}

function findLocalTransition(
  wallMillis: number,
  transitions: IndexedZoneChange[],
): { kind: 'gap' | 'overlap'; change: IndexedZoneChange } | undefined {
  for (const change of transitions) {
    const beforeWall = change.beforeWallMillis;
    const afterWall = change.afterWallMillis;
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

function offsetAtWallTime(
  wallMillis: number,
  transitions: IndexedZoneChange[],
  initialOffset: number,
): number {
  let offset = initialOffset;
  for (const change of transitions) {
    if (change.afterWallMillis > wallMillis) {
      break;
    }
    offset = change.utcOffset;
  }
  return offset;
}

function offsetAtInstant(
  instantMillis: number,
  transitions: IndexedZoneChange[],
  initialOffset: number,
): number {
  const first = transitions[0];
  let offset = first ? first.prevUtcOffset : initialOffset;

  for (const change of transitions) {
    if (change.instantMillis > instantMillis) {
      break;
    }
    offset = change.utcOffset;
  }
  return offset;
}

function instantToWallMillis(
  instantMillis: number,
  transitions: IndexedZoneChange[],
  initialOffset: number,
): number {
  return (
    instantMillis +
    offsetAtInstant(instantMillis, transitions, initialOffset) * 1000
  );
}
