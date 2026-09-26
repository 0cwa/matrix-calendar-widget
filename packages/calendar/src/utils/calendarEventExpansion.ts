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
import { RRule } from 'rrule';
import {
  CalendarEvent,
  CalendarEventDateTime,
  CalendarEventOccurrence,
  CalendarEventRecurrenceOverride,
  CalendarEventRecurrencePeriod,
  CalendarEventTiming,
  CalendarTimeRange,
  ZonedCalendarDateTime,
} from '../model';

const dayMilliseconds = 24 * 60 * 60 * 1000;
const maximumRuleCandidates = 100_000;
const validRuleParts = new Set([
  'FREQ',
  'UNTIL',
  'COUNT',
  'INTERVAL',
  'BYSECOND',
  'BYMINUTE',
  'BYHOUR',
  'BYDAY',
  'BYMONTHDAY',
  'BYYEARDAY',
  'BYWEEKNO',
  'BYMONTH',
  'BYSETPOS',
  'WKST',
]);

export type CalendarTimezoneResolver = {
  /** Resolve an iCalendar wall time; generated gaps return undefined. */
  resolveLocalDateTime(
    local: string,
    timezone: string,
    generated: boolean,
  ): { instant: number; local: string } | undefined;
  /** Convert an instant back to the wall time in the supplied TZID. */
  localDateTimeAt(instant: number, timezone: string): string;
};

export type ExpandCalendarEventOptions = {
  /** Required for DATE and floating values, whose values have no TZID. */
  rangeTimezone?: string;
  timezoneResolver?: CalendarTimezoneResolver;
  /** Hard work bound for old/high-frequency series; exceeding it fails visibly. */
  maxRuleCandidates?: number;
};

export type CalendarEventExpansionErrorCode =
  | 'invalid-range'
  | 'invalid-date-time'
  | 'invalid-recurrence-rule'
  | 'unsupported-recurrence-rule'
  | 'range-timezone-required'
  | 'unsupported-timezone'
  | 'recurrence-expansion-limit'
  | 'invalid-period'
  | 'unsupported-recurrence-override';

export class CalendarEventExpansionError extends Error {
  constructor(
    public readonly code: CalendarEventExpansionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CalendarEventExpansionError';
  }
}

type RecurrenceCandidate = {
  recurrenceId: CalendarEventDateTime;
  period?: CalendarEventRecurrencePeriod;
  generated: boolean;
};

type ParsedRule = {
  rule: RRule;
  count?: number;
  until?: { instant: number; utc: boolean };
};

export const defaultCalendarTimezoneResolver: CalendarTimezoneResolver = {
  resolveLocalDateTime(local, timezone, generated) {
    const wall = parseLocalDateTime(local);
    const offsets = new Set<number>();
    for (const hours of [-36, -24, -12, 0, 12, 24, 36]) {
      const sample = DateTime.fromMillis(wall + hours * 60 * 60 * 1000, {
        zone: timezone,
      });
      if (!sample.isValid) {
        throw new CalendarEventExpansionError(
          'unsupported-timezone',
          `Cannot resolve timezone ${timezone}`,
        );
      }
      offsets.add(sample.offset);
    }

    const candidates = [...offsets]
      .map((offset) => {
        const instant = wall - offset * 60_000;
        const value = DateTime.fromMillis(instant, { zone: timezone });
        return {
          offset,
          instant,
          local: value.isValid ? formatLocal(value) : '',
          actualOffset: value.offset,
        };
      })
      .filter(
        ({ offset, local: resolvedLocal, actualOffset }) =>
          actualOffset === offset && resolvedLocal === local,
      )
      .sort((left, right) => left.instant - right.instant);

    if (candidates.length > 0) {
      const first = candidates[0];
      return { instant: first.instant, local: first.local };
    }

    if (generated) {
      return undefined;
    }

    // For a forward gap, applying the pre-transition offset lands after the
    // gap. This is RFC 5545's explicit DATE-TIME interpretation.
    const normalized = [...offsets]
      .map((offset) => {
        const instant = wall - offset * 60_000;
        const value = DateTime.fromMillis(instant, { zone: timezone });
        return {
          offset,
          instant,
          local: value.isValid ? formatLocal(value) : '',
          actualOffset: value.offset,
        };
      })
      .filter(
        ({ offset, local: resolvedLocal, actualOffset }) =>
          actualOffset > offset && resolvedLocal > local,
      )
      .sort((left, right) => left.instant - right.instant)[0];
    if (normalized) {
      return { instant: normalized.instant, local: normalized.local };
    }

    throw new CalendarEventExpansionError(
      'unsupported-timezone',
      `Cannot resolve local time ${local} in timezone ${timezone}`,
    );
  },

  localDateTimeAt(instant, timezone) {
    const value = DateTime.fromMillis(instant, { zone: timezone });
    if (!value.isValid) {
      throw new CalendarEventExpansionError(
        'unsupported-timezone',
        `Cannot resolve timezone ${timezone}`,
      );
    }
    return formatLocal(value);
  },
};

/**
 * Expand one domain event into occurrences whose effective start is inside the
 * requested half-open instant range. DATE and floating series require an
 * explicit range timezone. COUNT is evaluated after nonexistent generated
 * TZID local times are omitted, as required by RFC 5545.
 */
export function expandCalendarEvent(
  event: CalendarEvent,
  range: CalendarTimeRange,
  options: ExpandCalendarEventOptions = {},
): CalendarEventOccurrence[] {
  const rangeStart = Date.parse(range.start);
  const rangeEnd = Date.parse(range.end);
  if (
    !hasExplicitOffset(range.start) ||
    !hasExplicitOffset(range.end) ||
    !Number.isFinite(rangeStart) ||
    !Number.isFinite(rangeEnd) ||
    rangeStart >= rangeEnd
  ) {
    throw new CalendarEventExpansionError(
      'invalid-range',
      'Expansion range must contain valid increasing instants',
    );
  }

  const resolver = options.timezoneResolver ?? defaultCalendarTimezoneResolver;
  const maxCandidates = options.maxRuleCandidates ?? maximumRuleCandidates;
  if (!Number.isInteger(maxCandidates) || maxCandidates < 1) {
    throw new CalendarEventExpansionError(
      'recurrence-expansion-limit',
      'Rule candidate limit must be a positive integer',
    );
  }

  const recurrence = event.recurrence;
  const recurrenceId = recurrence?.recurrenceId;
  if (
    !recurrence?.rrule &&
    !recurrence?.rdates?.length &&
    !recurrence?.rdatePeriods?.length &&
    !recurrence?.overrides?.length &&
    !recurrence?.exdates?.length
  ) {
    const id = recurrenceId ?? timingStartAsDateTime(event.timing);
    return occurrenceInRange(
      event,
      id,
      event.timing,
      rangeStart,
      rangeEnd,
      options,
      resolver,
    )
      ? [makeOccurrence(event, id, event.timing)]
      : [];
  }

  const start = timingStartAsDateTime(event.timing);
  const overrides = recurrence?.overrides ?? [];
  const overrideMap = new Map(
    overrides.map((override) => [dateTimeKey(override.recurrenceId), override]),
  );
  const exclusions = new Set((recurrence?.exdates ?? []).map(dateTimeKey));
  const candidates = new Map<string, RecurrenceCandidate>();

  addCandidate(candidates, exclusions, {
    recurrenceId: start,
    generated: false,
  });
  for (const rdate of recurrence?.rdates ?? []) {
    addCandidate(candidates, exclusions, {
      recurrenceId: rdate,
      generated: false,
    });
  }
  for (const period of recurrence?.rdatePeriods ?? []) {
    addCandidate(candidates, exclusions, {
      recurrenceId: period.start,
      period,
      generated: false,
    });
  }

  if (recurrence?.rrule) {
    const parsedRule = parseRule(recurrence.rrule, start);
    const maxOverrideTime = overrides.reduce(
      (latest, override) =>
        Math.max(latest, dateTimeWallMillis(override.recurrenceId)),
      dateTimeWallMillis(start),
    );
    const searchEnd = Math.max(
      rangeEnd + 2 * dayMilliseconds,
      maxOverrideTime + 2 * dayMilliseconds,
    );
    const ruleStart = dateTimeWallMillis(start);
    const ruleStartDate = new Date(ruleStart);
    const seen = new Set<string>();
    let validRuleOccurrences = 0;
    let visitedCandidates = 0;
    let hitLimit = false;

    parsedRule.rule.all((pseudoDate) => {
      const pseudoMillis = pseudoDate.getTime();
      if (pseudoMillis > searchEnd) {
        return false;
      }
      visitedCandidates += 1;
      if (visitedCandidates > maxCandidates) {
        hitLimit = true;
        return false;
      }

      const generatedId = dateTimeFromPseudoDate(pseudoDate, start);
      const resolved = resolveStart(generatedId, options, resolver, true);
      if (!resolved) {
        return true;
      }

      if (
        parsedRule.until &&
        isAfterUntil(pseudoMillis, resolved.instant, parsedRule.until, start)
      ) {
        return false;
      }

      const key = dateTimeKey(generatedId);
      if (seen.has(key)) {
        return true;
      }
      seen.add(key);
      validRuleOccurrences += 1;
      if (
        parsedRule.count !== undefined &&
        validRuleOccurrences > parsedRule.count
      ) {
        return false;
      }

      if (!exclusions.has(key)) {
        addCandidate(candidates, exclusions, {
          recurrenceId: generatedId,
          generated: true,
        });
      }

      return (
        parsedRule.count === undefined ||
        validRuleOccurrences < parsedRule.count
      );
    });

    if (hitLimit) {
      throw new CalendarEventExpansionError(
        'recurrence-expansion-limit',
        `RRULE expansion exceeded ${maxCandidates} candidates`,
      );
    }

    // A valid rule must be synchronized with DTSTART. A mismatched DTSTART has
    // undefined recurrence semantics under RFC 5545 and is not guessed here.
    if (parsedRule.rule.after(ruleStartDate, true)?.getTime() !== ruleStart) {
      throw new CalendarEventExpansionError(
        'invalid-recurrence-rule',
        'DTSTART does not match the RRULE recurrence pattern',
      );
    }
  }

  const result: CalendarEventOccurrence[] = [];
  for (const candidate of candidates.values()) {
    const override = overrideMap.get(dateTimeKey(candidate.recurrenceId));
    if (override?.status === 'cancelled') {
      continue;
    }

    const timing =
      override?.timing ??
      occurrenceTiming(event.timing, candidate, options, resolver);
    if (
      !occurrenceInRange(
        event,
        candidate.recurrenceId,
        timing,
        rangeStart,
        rangeEnd,
        options,
        resolver,
      )
    ) {
      continue;
    }
    result.push(
      makeOccurrence(event, candidate.recurrenceId, timing, override),
    );
  }

  return result.sort(
    (left, right) =>
      startInstant(left.timing, options, resolver) -
      startInstant(right.timing, options, resolver),
  );
}

function parseRule(ruleText: string, start: CalendarEventDateTime): ParsedRule {
  const normalized = ruleText.trim().replace(/^RRULE:/i, '');
  if (!normalized) {
    throw invalidRule();
  }

  const parts = new Map<string, string>();
  for (const part of normalized.split(';')) {
    const separator = part.indexOf('=');
    if (separator <= 0) {
      throw invalidRule();
    }
    const name = part.slice(0, separator).toUpperCase();
    const value = part.slice(separator + 1);
    if (!validRuleParts.has(name)) {
      throw new CalendarEventExpansionError(
        'unsupported-recurrence-rule',
        `Unsupported RRULE part: ${name}`,
      );
    }
    if (parts.has(name) || value.length === 0) {
      throw invalidRule();
    }
    parts.set(name, value);
  }

  if (!parts.has('FREQ')) {
    throw invalidRule();
  }

  const countText = parts.get('COUNT');
  const count = countText === undefined ? undefined : Number(countText);
  if (count !== undefined && (!Number.isInteger(count) || count < 1)) {
    throw invalidRule();
  }
  if (count !== undefined && parts.has('UNTIL')) {
    throw invalidRule();
  }

  const untilText = parts.get('UNTIL');
  const until =
    untilText === undefined ? undefined : parseUntil(untilText, start);
  const ruleParts = [...parts.entries()]
    .filter(([name]) => name !== 'COUNT' && name !== 'UNTIL')
    .map(([name, value]) => `${name}=${value}`);

  try {
    const parsed = RRule.parseString(ruleParts.join(';'));
    const startWall = dateTimeWallMillis(start);
    return {
      rule: new RRule({
        ...parsed,
        dtstart: new Date(startWall),
        count: null,
        until: null,
        tzid: null,
      }),
      count,
      until,
    };
  } catch (error) {
    if (error instanceof CalendarEventExpansionError) {
      throw error;
    }
    throw invalidRule();
  }
}

function parseUntil(
  value: string,
  start: CalendarEventDateTime,
): { instant: number; utc: boolean } {
  const utc = value.endsWith('Z');
  const bare = utc ? value.slice(0, -1) : value;
  const dateOnly = bare.length === 8;
  const expectedDateOnly = start.type === 'date';
  const mode =
    start.type === 'date-time' ? dateTimeMode(start.value) : undefined;
  if (
    dateOnly !== expectedDateOnly ||
    ((mode === 'tzid' || mode === 'utc') && !utc) ||
    (mode === 'floating' && utc)
  ) {
    throw invalidRule();
  }
  const local = dateOnly ? parseBasicDate(bare) : parseBasicDateTime(bare);
  return { instant: dateTimeWallMillis(local), utc };
}

function parseBasicDate(value: string): CalendarEventDateTime {
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (!match) {
    throw invalidRule();
  }
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  parseDate(date);
  return { type: 'date', value: date };
}

function parseBasicDateTime(value: string): CalendarEventDateTime {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/.exec(value);
  if (!match) {
    throw invalidRule();
  }
  const local = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}`;
  parseLocalDateTime(local);
  return {
    type: 'date-time',
    value: { local, timezone: 'UTC', mode: 'utc' },
  };
}

function isAfterUntil(
  pseudoMillis: number,
  resolvedInstant: number,
  until: NonNullable<ParsedRule['until']>,
  start: CalendarEventDateTime,
): boolean {
  const mode =
    start.type === 'date-time' ? dateTimeMode(start.value) : undefined;
  return until.utc && mode === 'tzid'
    ? resolvedInstant > until.instant
    : pseudoMillis > until.instant;
}

function addCandidate(
  target: Map<string, RecurrenceCandidate>,
  exclusions: Set<string>,
  candidate: RecurrenceCandidate,
): void {
  const key = dateTimeKey(candidate.recurrenceId);
  if (exclusions.has(key)) {
    return;
  }
  const existing = target.get(key);
  if (!existing) {
    target.set(key, candidate);
  } else if (candidate.period && !existing.period) {
    // The recurrence identity stays unique, but an RDATE PERIOD carries the
    // occurrence-specific duration even when DTSTART/RDATE already added it.
    target.set(key, { ...existing, period: candidate.period });
  }
}

function occurrenceTiming(
  masterTiming: CalendarEventTiming,
  candidate: RecurrenceCandidate,
  options: ExpandCalendarEventOptions,
  resolver: CalendarTimezoneResolver,
): CalendarEventTiming {
  if (candidate.recurrenceId.type === 'date') {
    if (masterTiming.type !== 'all-day') {
      throw new CalendarEventExpansionError(
        'invalid-period',
        'DATE recurrence values require an all-day master event',
      );
    }
    const durationDays = dateDifference(
      masterTiming.startDate,
      masterTiming.endDate,
    );
    const startDate = candidate.recurrenceId.value;
    return {
      type: 'all-day',
      startDate,
      endDate: addCalendarDays(startDate, durationDays),
    };
  }

  if (masterTiming.type !== 'timed') {
    throw new CalendarEventExpansionError(
      'invalid-period',
      'DATE-TIME recurrence values require a timed master event',
    );
  }

  const startValue = candidate.recurrenceId.value;
  const resolvedStart = resolveDateTime(
    startValue,
    options,
    resolver,
    candidate.generated,
  );
  if (!resolvedStart) {
    throw new CalendarEventExpansionError(
      'invalid-date-time',
      'A nonexistent generated local time was not omitted',
    );
  }

  if (candidate.period?.end) {
    const resolvedEnd = resolveDateTime(
      candidate.period.end.value,
      options,
      resolver,
      false,
    );
    if (!resolvedEnd || resolvedEnd.instant <= resolvedStart.instant) {
      throw new CalendarEventExpansionError(
        'invalid-period',
        'RDATE PERIOD end must follow its start',
      );
    }
    return {
      type: 'timed',
      start: {
        ...startValue,
        local: resolvedStart.local,
      },
      end: { ...candidate.period.end.value },
    };
  }

  if (candidate.period?.duration) {
    return {
      type: 'timed',
      start: { ...startValue, local: resolvedStart.local },
      end: addCalendarDuration(
        startValue,
        parseCalendarDuration(candidate.period.duration),
        resolver,
      ),
    };
  }

  const duration = timedDuration(masterTiming, options, resolver);
  const endTemplate = masterTiming.end;
  const endInstant = resolvedStart.instant + duration;
  const endValue =
    dateTimeMode(endTemplate) === 'floating'
      ? {
          ...endTemplate,
          local: formatLocal(
            DateTime.fromMillis(
              localDateTimeMillis(startValue.local) + duration,
              { zone: 'UTC' },
            ),
          ),
          mode: 'floating' as const,
        }
      : dateTimeAtInstant(endInstant, endTemplate, resolver);
  return {
    type: 'timed',
    start: {
      ...startValue,
      local: resolvedStart.local,
    },
    end: endValue,
  };
}

function timedDuration(
  timing: Extract<CalendarEventTiming, { type: 'timed' }>,
  options: ExpandCalendarEventOptions,
  resolver: CalendarTimezoneResolver,
): number {
  const startMode = dateTimeMode(timing.start);
  const endMode = dateTimeMode(timing.end);
  if (startMode === 'floating' && endMode === 'floating') {
    return (
      localDateTimeMillis(timing.end.local) -
      localDateTimeMillis(timing.start.local)
    );
  }
  const start = resolveDateTime(timing.start, options, resolver, false);
  const end = resolveDateTime(timing.end, options, resolver, false);
  if (!start || !end || end.instant <= start.instant) {
    throw new CalendarEventExpansionError(
      'invalid-period',
      'Timed event end must follow its start',
    );
  }
  return end.instant - start.instant;
}

type CalendarDuration = {
  weeks: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  milliseconds: number;
};

function parseCalendarDuration(value: string): CalendarDuration {
  const match =
    /^P(?:(\d+)W|(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?)$/.exec(
      value,
    );
  if (
    !match ||
    value.endsWith('T') ||
    !match.slice(1).some((part) => part !== undefined)
  ) {
    throw new CalendarEventExpansionError(
      'invalid-period',
      `Unsupported RDATE PERIOD duration: ${value}`,
    );
  }
  const [, weeks, days, hours, minutes, seconds] = match;
  const milliseconds =
    Number(weeks ?? 0) * 7 * dayMilliseconds +
    Number(days ?? 0) * dayMilliseconds +
    Number(hours ?? 0) * 60 * 60 * 1000 +
    Number(minutes ?? 0) * 60 * 1000 +
    Number(seconds ?? 0) * 1000;
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
    throw new CalendarEventExpansionError(
      'invalid-period',
      `Unsupported RDATE PERIOD duration: ${value}`,
    );
  }
  return {
    weeks: Number(weeks ?? 0),
    days: Number(days ?? 0),
    hours: Number(hours ?? 0),
    minutes: Number(minutes ?? 0),
    seconds: Number(seconds ?? 0),
    milliseconds,
  };
}

function addCalendarDuration(
  start: ZonedCalendarDateTime,
  duration: CalendarDuration,
  resolver: CalendarTimezoneResolver,
): ZonedCalendarDateTime {
  let endWall = DateTime.fromMillis(localDateTimeMillis(start.local), {
    zone: 'UTC',
  });
  if (duration.weeks) endWall = endWall.plus({ weeks: duration.weeks });
  if (duration.days) endWall = endWall.plus({ days: duration.days });

  const timeMilliseconds =
    duration.hours * 60 * 60 * 1000 +
    duration.minutes * 60 * 1000 +
    duration.seconds * 1000;
  const local = formatLocal(endWall);
  if (dateTimeMode(start) === 'tzid') {
    const resolved = resolver.resolveLocalDateTime(
      local,
      start.timezone,
      false,
    );
    if (!resolved) {
      throw new CalendarEventExpansionError(
        'invalid-period',
        `Cannot resolve RDATE PERIOD end in ${start.timezone}`,
      );
    }
    return {
      ...start,
      local: resolver.localDateTimeAt(
        resolved.instant + timeMilliseconds,
        start.timezone,
      ),
    };
  }

  endWall = endWall.plus({ milliseconds: timeMilliseconds });
  return { ...start, local: formatLocal(endWall) };
}

function dateTimeAtInstant(
  instant: number,
  template: ZonedCalendarDateTime,
  resolver: CalendarTimezoneResolver,
): ZonedCalendarDateTime {
  const mode = dateTimeMode(template);
  if (mode === 'utc') {
    return {
      ...template,
      local: formatLocal(DateTime.fromMillis(instant, { zone: 'UTC' })),
      mode,
    };
  }
  return {
    ...template,
    local: resolver.localDateTimeAt(instant, template.timezone),
    mode,
  };
}

function resolveStart(
  value: CalendarEventDateTime,
  options: ExpandCalendarEventOptions,
  resolver: CalendarTimezoneResolver,
  generated: boolean,
): { instant: number; local: string } | undefined {
  if (value.type === 'date') {
    const timezone = requireRangeTimezone(options);
    return resolver.resolveLocalDateTime(
      `${value.value}T00:00:00`,
      timezone,
      false,
    );
  }
  return resolveDateTime(value.value, options, resolver, generated);
}

function resolveDateTime(
  value: ZonedCalendarDateTime,
  options: ExpandCalendarEventOptions,
  resolver: CalendarTimezoneResolver,
  generated: boolean,
): { instant: number; local: string } | undefined {
  const mode = dateTimeMode(value);
  if (mode === 'utc') {
    const instant = localDateTimeMillis(value.local);
    return {
      instant,
      local: formatLocal(DateTime.fromMillis(instant, { zone: 'UTC' })),
    };
  }
  if (mode === 'floating') {
    const timezone = requireRangeTimezone(options);
    // Floating values have no zone-based gap. The range timezone is used only
    // to compare them with instants; the original floating wall time is kept.
    const resolved = resolver.resolveLocalDateTime(
      value.local,
      timezone,
      false,
    );
    return resolved ? { ...resolved, local: value.local } : undefined;
  }
  return resolver.resolveLocalDateTime(value.local, value.timezone, generated);
}

function occurrenceInRange(
  _event: CalendarEvent,
  _recurrenceId: CalendarEventDateTime,
  timing: CalendarEventTiming,
  rangeStart: number,
  rangeEnd: number,
  options: ExpandCalendarEventOptions,
  resolver: CalendarTimezoneResolver,
): boolean {
  const start = startInstant(timing, options, resolver);
  return start >= rangeStart && start < rangeEnd;
}

function startInstant(
  timing: CalendarEventTiming,
  options: ExpandCalendarEventOptions,
  resolver: CalendarTimezoneResolver,
): number {
  if (timing.type === 'all-day') {
    const resolved = resolver.resolveLocalDateTime(
      `${timing.startDate}T00:00:00`,
      requireRangeTimezone(options),
      false,
    );
    if (!resolved) {
      throw new CalendarEventExpansionError(
        'invalid-date-time',
        'Invalid all-day start',
      );
    }
    return resolved.instant;
  }
  const resolved = resolveDateTime(timing.start, options, resolver, false);
  if (!resolved) {
    throw new CalendarEventExpansionError(
      'invalid-date-time',
      'Invalid timed start',
    );
  }
  return resolved.instant;
}

function makeOccurrence(
  event: CalendarEvent,
  recurrenceId: CalendarEventDateTime,
  timing: CalendarEventTiming,
  override?: CalendarEventRecurrenceOverride,
): CalendarEventOccurrence {
  const occurrence: CalendarEventOccurrence = {
    ...event,
    recurrenceId,
    timing,
  };
  delete (occurrence as CalendarEvent & { recurrence?: unknown }).recurrence;
  if (override) {
    if (override.title !== undefined) occurrence.title = override.title;
    if (override.description !== undefined)
      occurrence.description = override.description;
    if (override.status !== undefined) occurrence.status = override.status;
    if (override.transparency !== undefined)
      occurrence.transparency = override.transparency;
    if (override.location !== undefined)
      occurrence.location = override.location;
    if (override.url !== undefined) occurrence.url = override.url;
    if (override.categories !== undefined)
      occurrence.categories = [...override.categories];
    if (override.priority !== undefined)
      occurrence.priority = override.priority;
  }
  return occurrence;
}

function timingStartAsDateTime(
  timing: CalendarEventTiming,
): CalendarEventDateTime {
  return timing.type === 'all-day'
    ? { type: 'date', value: timing.startDate }
    : { type: 'date-time', value: { ...timing.start } };
}

function dateTimeFromPseudoDate(
  date: Date,
  template: CalendarEventDateTime,
): CalendarEventDateTime {
  if (template.type === 'date') {
    return {
      type: 'date',
      value: formatDate(DateTime.fromJSDate(date, { zone: 'UTC' })),
    };
  }
  return {
    type: 'date-time',
    value: {
      ...template.value,
      local: formatLocal(DateTime.fromJSDate(date, { zone: 'UTC' })),
    },
  };
}

function dateTimeKey(value: CalendarEventDateTime): string {
  if (value.type === 'date') {
    return `D:${value.value}`;
  }
  const mode = dateTimeMode(value.value);
  return mode === 'tzid'
    ? `T:${value.value.timezone}:${value.value.local}`
    : `${mode === 'utc' ? 'U' : 'F'}:${value.value.local}`;
}

function dateTimeMode(
  value: ZonedCalendarDateTime,
): 'floating' | 'utc' | 'tzid' {
  if (value.mode) {
    return value.mode;
  }
  if (value.timezone === 'UTC') {
    return 'utc';
  }
  if (value.timezone === 'floating') {
    return 'floating';
  }
  return 'tzid';
}

function dateTimeWallMillis(value: CalendarEventDateTime): number {
  return value.type === 'date'
    ? localDateTimeMillis(`${value.value}T00:00:00`)
    : localDateTimeMillis(value.value.local);
}

function dateDifference(start: string, end: string): number {
  const startDate = parseDate(start);
  const endDate = parseDate(end);
  return endDate.diff(startDate, 'days').days;
}

function addCalendarDays(date: string, amount: number): string {
  return formatDate(parseDate(date).plus({ days: amount }));
}

function parseDate(value: string): DateTime {
  const parsed = DateTime.fromISO(value, { zone: 'UTC' });
  if (!parsed.isValid || parsed.toFormat('yyyy-MM-dd') !== value) {
    throw new CalendarEventExpansionError(
      'invalid-date-time',
      `Invalid DATE value: ${value}`,
    );
  }
  return parsed;
}

function parseLocalDateTime(value: string): number {
  const parsed = DateTime.fromISO(value, { zone: 'UTC' });
  if (!parsed.isValid || formatLocal(parsed) !== value) {
    throw new CalendarEventExpansionError(
      'invalid-date-time',
      `Invalid local DATE-TIME value: ${value}`,
    );
  }
  return parsed.toMillis();
}

function localDateTimeMillis(value: string): number {
  return parseLocalDateTime(value);
}

function formatLocal(value: DateTime): string {
  return value.toFormat("yyyy-MM-dd'T'HH:mm:ss");
}

function formatDate(value: DateTime): string {
  return value.toFormat('yyyy-MM-dd');
}

function requireRangeTimezone(options: ExpandCalendarEventOptions): string {
  if (!options.rangeTimezone) {
    throw new CalendarEventExpansionError(
      'range-timezone-required',
      'DATE and floating values require a range timezone',
    );
  }
  return options.rangeTimezone;
}

function hasExplicitOffset(value: string): boolean {
  return /T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
}

function invalidRule(): CalendarEventExpansionError {
  return new CalendarEventExpansionError(
    'invalid-recurrence-rule',
    'RRULE is malformed or uses unsupported DTSTART/UNTIL value types',
  );
}
