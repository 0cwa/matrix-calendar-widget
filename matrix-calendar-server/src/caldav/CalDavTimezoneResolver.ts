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
  CalendarEventExpansionError,
  CalendarTimezoneResolver,
  defaultCalendarTimezoneResolver,
} from '@matrix-calendar-widget/calendar';
import ICAL from 'ical.js';
import { DateTime } from 'luxon';

type Transition = {
  instant: number;
  offsetFrom: number;
  offsetTo: number;
};

type RecurringTransitionBudget = {
  rule: ICAL.Recur;
  startYear: number;
  maximumPerYear: number;
};

type TimezoneEntry = {
  zone: ICAL.Timezone;
  startYear: number;
  fixedTransitions: number;
  recurringTransitions: RecurringTransitionBudget[];
};

const defaultMaximumTimezoneTransitions = 100_000;

/**
 * Use ical.js to parse/expand VTIMEZONE observances, then resolve wall times
 * against those transitions with RFC 5545 gap/fold selection. The iCalendar
 * library's direct utcOffset conversion chooses the later fold offset, so the
 * transition table is used to select the first valid occurrence explicitly.
 */
export function createCalDavTimezoneResolver(
  calendar: ICAL.Component,
  maximumTransitions = defaultMaximumTimezoneTransitions,
): CalendarTimezoneResolver {
  const zones = new Map<string, TimezoneEntry>();
  if (!Number.isInteger(maximumTransitions) || maximumTransitions < 1) {
    throw new CalendarEventExpansionError(
      'recurrence-expansion-limit',
      'VTIMEZONE transition limit must be a positive integer',
    );
  }

  for (const component of calendar.getAllSubcomponents('vtimezone')) {
    const tzid = component.getFirstPropertyValue('tzid');
    if (typeof tzid !== 'string' || !tzid) {
      continue;
    }
    try {
      zones.set(tzid, {
        zone: ICAL.Timezone.fromData({ component, tzid }),
        ...inspectTimezoneBudget(component, tzid),
      });
    } catch (error) {
      throw unsupportedVtimezone(tzid, error);
    }
  }

  return {
    resolveLocalDateTime(local, timezone, generated) {
      const zone = zones.get(timezone);
      return zone
        ? resolveWithVtimezone(
            local,
            timezone,
            zone,
            generated,
            maximumTransitions,
          )
        : defaultCalendarTimezoneResolver.resolveLocalDateTime(
            local,
            timezone,
            generated,
          );
    },
    localDateTimeAt(instant, timezone) {
      const zone = zones.get(timezone);
      if (!zone) {
        return defaultCalendarTimezoneResolver.localDateTimeAt(
          instant,
          timezone,
        );
      }
      const utc = DateTime.fromMillis(instant, { zone: 'UTC' });
      if (!utc.isValid) {
        throw unsupportedVtimezone(timezone);
      }
      const transitions = readTransitions(
        zone,
        formatLocal(utc),
        timezone,
        maximumTransitions,
      );
      const offset = offsetAt(transitions, instant);
      return formatLocal(
        DateTime.fromMillis(instant + offset * 1000, { zone: 'UTC' }),
      );
    },
  };
}

function resolveWithVtimezone(
  local: string,
  timezone: string,
  entry: TimezoneEntry,
  generated: boolean,
  maximumTransitions: number,
): { instant: number; local: string } | undefined {
  const wall = localWallMillis(local);
  const transitions = readTransitions(
    entry,
    local,
    timezone,
    maximumTransitions,
  );
  const offsets = new Set<number>();
  for (const transition of transitions) {
    offsets.add(transition.offsetFrom);
    offsets.add(transition.offsetTo);
  }

  const candidates = [...offsets]
    .map((offset) => ({
      offset,
      instant: wall - offset * 1000,
    }))
    .filter(
      ({ offset, instant }) =>
        offsetAt(transitions, instant) === offset &&
        instant + offset * 1000 === wall,
    )
    .sort((left, right) => left.instant - right.instant);

  if (candidates.length > 0) {
    const instant = candidates[0].instant;
    const activeOffset = offsetAt(transitions, instant);
    return {
      instant,
      local: formatLocal(
        DateTime.fromMillis(instant + activeOffset * 1000, { zone: 'UTC' }),
      ),
    };
  }

  if (generated) {
    return undefined;
  }

  // RFC 5545 interprets an explicit local time in a forward gap using the
  // offset before the transition, producing the later valid wall time.
  for (const transition of transitions) {
    if (transition.offsetTo <= transition.offsetFrom) {
      continue;
    }
    const gapStart = transition.instant + transition.offsetFrom * 1000;
    const gapEnd = transition.instant + transition.offsetTo * 1000;
    if (wall >= gapStart && wall < gapEnd) {
      const instant = wall - transition.offsetFrom * 1000;
      const activeOffset = offsetAt(transitions, instant);
      return {
        instant,
        local: formatLocal(
          DateTime.fromMillis(instant + activeOffset * 1000, { zone: 'UTC' }),
        ),
      };
    }
  }

  throw unsupportedVtimezone(timezone);
}

function readTransitions(
  entry: TimezoneEntry,
  local: string,
  timezone: string,
  maximumTransitions: number,
): Transition[] {
  assertTimezoneExpansionBudget(entry, local, timezone, maximumTransitions);
  try {
    // This public conversion call causes ical.js to expand the observance
    // DTSTART/RRULE/RDATE coverage needed for the requested year.
    entry.zone.utcOffset(ICAL.Time.fromDateTimeString(local));
  } catch (error) {
    throw unsupportedVtimezone(timezone, error);
  }

  const changes = entry.zone.changes as Array<{
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
    prevUtcOffset: number;
    utcOffset: number;
  }>;
  const transitions = changes
    .map((change) => ({
      instant: DateTime.fromObject(
        {
          year: change.year,
          month: change.month,
          day: change.day,
          hour: change.hour,
          minute: change.minute,
          second: change.second,
        },
        { zone: 'UTC' },
      ).toMillis(),
      offsetFrom: change.prevUtcOffset,
      offsetTo: change.utcOffset,
    }))
    .filter((transition) => Number.isFinite(transition.instant))
    .sort((left, right) => left.instant - right.instant);

  if (transitions.length === 0) {
    throw unsupportedVtimezone(timezone);
  }
  if (transitions.length > maximumTransitions) {
    throw timezoneExpansionLimit(timezone, maximumTransitions);
  }
  return transitions;
}

function inspectTimezoneBudget(
  component: ICAL.Component,
  timezone: string,
): Omit<TimezoneEntry, 'zone'> {
  const observances = component.getAllSubcomponents();
  if (observances.length === 0) {
    throw unsupportedVtimezone(timezone);
  }

  let startYear = Number.POSITIVE_INFINITY;
  let fixedTransitions = 0;
  const recurringTransitions: RecurringTransitionBudget[] = [];

  for (const observance of observances) {
    const startValue = observance.getFirstPropertyValue('dtstart');
    if (!(startValue instanceof ICAL.Time)) {
      throw unsupportedVtimezone(timezone);
    }
    startYear = Math.min(startYear, startValue.year);

    const rules = observance.getAllProperties('rrule');
    if (rules.length > 1) {
      throw unsupportedVtimezone(
        timezone,
        new Error(
          'A VTIMEZONE observance cannot contain multiple RRULE properties',
        ),
      );
    }
    const ruleProperty = rules[0];
    if (ruleProperty) {
      const serializedRule = ruleProperty
        .toICALString()
        .split(':')
        .slice(1)
        .join(':');
      const rule = ruleProperty.getFirstValue();
      if (
        !(rule instanceof ICAL.Recur) ||
        !/(?:^|;)FREQ=YEARLY(?:;|$)/i.test(serializedRule) ||
        rule.freq !== 'YEARLY'
      ) {
        throw unsupportedVtimezone(
          timezone,
          new Error('Only bounded YEARLY VTIMEZONE rules are supported'),
        );
      }
      recurringTransitions.push({
        rule,
        startYear: startValue.year,
        maximumPerYear: estimateYearlyTransitions(rule),
      });
    } else {
      fixedTransitions += 1;
    }

    for (const rdate of observance.getAllProperties('rdate')) {
      fixedTransitions += rdate.getValues().length;
    }
  }

  if (!Number.isFinite(startYear)) {
    throw unsupportedVtimezone(timezone);
  }

  return { startYear, fixedTransitions, recurringTransitions };
}

function estimateYearlyTransitions(rule: ICAL.Recur): number {
  const parts = rule.parts;
  const dayBounds: number[] = [];
  const hasDayPart = Boolean(
    parts.BYYEARDAY?.length ||
    parts.BYWEEKNO?.length ||
    parts.BYMONTHDAY?.length ||
    parts.BYDAY?.length,
  );

  if (parts.BYYEARDAY?.length) {
    dayBounds.push(parts.BYYEARDAY.length);
  }
  if (parts.BYWEEKNO?.length) {
    dayBounds.push(parts.BYWEEKNO.length * 7);
  }
  if (parts.BYMONTHDAY?.length) {
    dayBounds.push(parts.BYMONTHDAY.length * (parts.BYMONTH?.length ?? 12));
  }
  if (parts.BYDAY?.length) {
    dayBounds.push(parts.BYDAY.length * 53 * (parts.BYMONTH?.length ?? 1));
  }
  if (parts.BYMONTH?.length && !hasDayPart) {
    dayBounds.push(parts.BYMONTH.length);
  }

  const maximumDatesPerYear = parts.BYWEEKNO?.length ? 371 : 366;
  const days = Math.min(
    maximumDatesPerYear,
    ...(dayBounds.length > 0 ? dayBounds : [1]),
  );
  const times =
    (parts.BYHOUR?.length ?? 1) *
    (parts.BYMINUTE?.length ?? 1) *
    (parts.BYSECOND?.length ?? 1);
  return days * times;
}

function assertTimezoneExpansionBudget(
  entry: TimezoneEntry,
  local: string,
  timezone: string,
  maximumTransitions: number,
): void {
  const requestedYear = Number(local.slice(0, 4));
  const currentYear = new Date().getUTCFullYear() + 1;
  const endYear =
    Math.max(requestedYear, currentYear) +
    (Number(ICAL.Timezone.EXTRA_COVERAGE) || 0);

  let estimated = entry.fixedTransitions;
  for (const transition of entry.recurringTransitions) {
    const ruleEndYear = Math.min(
      endYear,
      transition.rule.until?.year ?? endYear,
    );
    const yearCount = Math.max(0, ruleEndYear - transition.startYear + 1);
    let occurrences = yearCount * transition.maximumPerYear;
    if (transition.rule.count !== null) {
      occurrences = Math.min(occurrences, transition.rule.count);
    }
    estimated += occurrences;
    if (estimated > maximumTransitions) {
      throw timezoneExpansionLimit(timezone, maximumTransitions);
    }
  }
  if (estimated > maximumTransitions) {
    throw timezoneExpansionLimit(timezone, maximumTransitions);
  }
}

function timezoneExpansionLimit(
  timezone: string,
  maximumTransitions: number,
): CalendarEventExpansionError {
  return new CalendarEventExpansionError(
    'recurrence-expansion-limit',
    `VTIMEZONE ${timezone} exceeds the ${maximumTransitions}-transition expansion limit`,
  );
}

function offsetAt(transitions: Transition[], instant: number): number {
  let offset = transitions[0].offsetFrom;
  for (const transition of transitions) {
    if (transition.instant > instant) {
      break;
    }
    offset = transition.offsetTo;
  }
  return offset;
}

function localWallMillis(local: string): number {
  const value = DateTime.fromISO(local, { zone: 'UTC' });
  if (!value.isValid || formatLocal(value) !== local) {
    throw new CalendarEventExpansionError(
      'invalid-date-time',
      `Invalid local DATE-TIME value: ${local}`,
    );
  }
  return value.toMillis();
}

function formatLocal(value: DateTime): string {
  return value.toFormat("yyyy-MM-dd'T'HH:mm:ss");
}

function unsupportedVtimezone(
  timezone: string,
  cause?: unknown,
): CalendarEventExpansionError {
  const detail = cause instanceof Error ? `: ${cause.message}` : '';
  return new CalendarEventExpansionError(
    'unsupported-timezone',
    `Cannot safely expand VTIMEZONE ${timezone}${detail}`,
  );
}
