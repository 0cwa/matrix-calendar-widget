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
import { RRule, type Options } from 'rrule';
import type {
  AllDayCalendarEventTiming,
  CalendarEvent,
  CalendarEventDateTime,
  CalendarEventDuration,
  CalendarEventRecurrenceDate,
  CalendarEventRecurrenceOverride,
  CalendarEventRecurrenceTiming,
  CalendarEventTimedDateTime,
  CalendarEventTiming,
  CalendarTimeRange,
  TimedCalendarEventTiming,
} from '../model';
import { isAllDayCalendarEvent, isTimedCalendarEvent } from '../model';
import { calendarEventTimedDateTimeToDateTime } from './calendarEventTimedDateTime';
import {
  CalendarEventTimezoneError,
  calendarLocalDateTimeToUnixMillis,
  calendarUnixMillisToLocalDateTime,
  isCalendarRecurrenceWallTimeValid,
  isCalendarTimezoneSupported,
} from './calendarEventTimezone';

/** Maximum RRULE candidates returned for one resource in one projection. */
export const MAX_PROJECTED_OCCURRENCES_PER_EVENT = 512;

/** Bounds historical work when an old high-frequency RRULE is queried. */
const MAX_RRULE_SCAN_STEPS = 100_000;
/** Bounds exception/additional-date work before recurrence arrays are traversed. */
const MAX_RECURRENCE_INPUT_MEMBERS = 4_096;

const supportedRRuleParts = new Set([
  'BYDAY',
  'BYHOUR',
  'BYMINUTE',
  'BYMONTH',
  'BYMONTHDAY',
  'BYSECOND',
  'BYSETPOS',
  'BYYEARDAY',
  'BYWEEKNO',
  'COUNT',
  'FREQ',
  'INTERVAL',
  'UNTIL',
  'WKST',
]);

const numericByPartRanges: Record<
  string,
  { min: number; max: number; allowZero?: boolean }
> = {
  BYHOUR: { min: 0, max: 23 },
  BYMINUTE: { min: 0, max: 59 },
  BYMONTH: { min: 1, max: 12 },
  BYMONTHDAY: { min: -31, max: 31, allowZero: false },
  BYSECOND: { min: 0, max: 60 },
  BYSETPOS: { min: -366, max: 366, allowZero: false },
  BYYEARDAY: { min: -366, max: 366, allowZero: false },
  BYWEEKNO: { min: -53, max: 53, allowZero: false },
};

const numericByPartPatterns: Record<string, RegExp> = {
  BYHOUR: /^\d{1,2}$/,
  BYMINUTE: /^\d{1,2}$/,
  BYMONTH: /^\d{1,2}$/,
  BYMONTHDAY: /^[+-]?\d{1,2}$/,
  BYSECOND: /^\d{1,2}$/,
  BYSETPOS: /^[+-]?\d{1,3}$/,
  BYYEARDAY: /^[+-]?\d{1,3}$/,
  BYWEEKNO: /^[+-]?\d{1,2}$/,
};

export type CalendarEventProjectionDiagnosticReason =
  | 'invalid-recurrence'
  | 'invalid-timing'
  | 'occurrence-limit'
  | 'recurrence-input-limit'
  | 'unsupported-recurrence'
  | 'unsupported-timezone';

export type CalendarEventProjectionDiagnostic = {
  sourceEvent: CalendarEvent;
  reason: CalendarEventProjectionDiagnosticReason;
};

/**
 * An occurrence is a view-only event copy. Its ID is stable for the source
 * resource and recurrence identity; sourceEvent remains the CalDAV resource
 * whose ID and ETag must be used by later actions.
 */
export type ProjectedCalendarEventOccurrence = {
  event: CalendarEvent;
  sourceEvent: CalendarEvent;
  recurrenceIdentity?: string;
};

export type CalendarEventProjection = {
  occurrences: ProjectedCalendarEventOccurrence[];
  diagnostics: CalendarEventProjectionDiagnostic[];
};

type ProjectionError = {
  reason: CalendarEventProjectionDiagnosticReason;
};

type Candidate = {
  recurrenceId: CalendarEventDateTime;
  fromRuleOrRdate: boolean;
  rdateTiming?: CalendarEventRecurrenceTiming;
};

type ParsedUntil =
  | { type: 'date'; value: string }
  | { type: 'floating-date-time'; value: string }
  | { type: 'utc-date-time'; value: string; instant: number };

export type SupportedCalendarEventRecurrenceFrequency =
  | 'DAILY'
  | 'WEEKLY'
  | 'MONTHLY'
  | 'YEARLY';

export type SupportedCalendarEventRecurrenceEnd =
  | { type: 'never' }
  | { type: 'count'; count: number }
  | { type: 'until'; value: string };

export type SupportedCalendarEventRecurrenceRule = {
  frequency: SupportedCalendarEventRecurrenceFrequency;
  interval: number;
  end: SupportedCalendarEventRecurrenceEnd;
};

const editorFrequencies = new Set<SupportedCalendarEventRecurrenceFrequency>([
  'DAILY',
  'WEEKLY',
  'MONTHLY',
  'YEARLY',
]);

/**
 * Parse only the recurrence subset exposed by the first series editor. The
 * existing projection parser remains authoritative for anchor and UNTIL
 * semantics, while the editor deliberately excludes BY* and other RRULE parts.
 */
export function parseSupportedCalendarEventRecurrenceRule(
  rawRule: string | undefined,
  anchor: CalendarEventDateTime,
): SupportedCalendarEventRecurrenceRule | undefined {
  if (rawRule === undefined) {
    return undefined;
  }

  const ruleText = rawRule.trim().replace(/^RRULE:/i, '');
  const parts = new Map<string, string>();
  for (const component of ruleText.split(';')) {
    const separator = component.indexOf('=');
    if (separator <= 0) {
      throw new Error('Unsupported recurrence rule');
    }
    const key = component.slice(0, separator).toUpperCase();
    const value = component.slice(separator + 1);
    if (
      !['FREQ', 'INTERVAL', 'COUNT', 'UNTIL'].includes(key) ||
      !value ||
      parts.has(key)
    ) {
      throw new Error('Unsupported recurrence rule');
    }
    parts.set(key, value);
  }

  const frequency = parts.get('FREQ')?.toUpperCase();
  const intervalText = parts.get('INTERVAL') ?? '1';
  const countText = parts.get('COUNT');
  const until = parts.get('UNTIL');
  const interval = Number(intervalText);
  const count = countText === undefined ? undefined : Number(countText);
  if (
    !frequency ||
    !editorFrequencies.has(
      frequency as SupportedCalendarEventRecurrenceFrequency,
    ) ||
    !/^\d+$/.test(intervalText) ||
    !Number.isSafeInteger(interval) ||
    interval <= 0 ||
    (countText !== undefined &&
      (!/^\d+$/.test(countText) ||
        !Number.isSafeInteger(count) ||
        (count ?? 0) <= 0)) ||
    (countText !== undefined && until !== undefined)
  ) {
    throw new Error('Unsupported recurrence rule');
  }

  try {
    buildRule(ruleText, anchor);
    parseUntil(ruleText, anchor);
  } catch {
    throw new Error('Unsupported recurrence rule');
  }

  return {
    frequency: frequency as SupportedCalendarEventRecurrenceFrequency,
    interval,
    end:
      count !== undefined
        ? { type: 'count', count }
        : until !== undefined
          ? { type: 'until', value: until }
          : { type: 'never' },
  };
}

/** Serialize and validate the editor's limited rule against its DTSTART kind. */
export function formatSupportedCalendarEventRecurrenceRule(
  rule: SupportedCalendarEventRecurrenceRule,
  anchor: CalendarEventDateTime,
): string {
  const components = [`FREQ=${rule.frequency}`];
  if (rule.interval !== 1) {
    components.push(`INTERVAL=${rule.interval}`);
  }
  if (rule.end.type === 'count') {
    components.push(`COUNT=${rule.end.count}`);
  } else if (rule.end.type === 'until') {
    components.push(`UNTIL=${rule.end.value}`);
  }

  const result = components.join(';');
  parseSupportedCalendarEventRecurrenceRule(result, anchor);
  return result;
}

/**
 * Expand canonical typed events into a bounded, read-only view projection.
 * Invalid or unsupported recurrence is omitted as one opaque resource and
 * returned in diagnostics; the source event is never changed.
 */
export function projectCalendarEventOccurrences(
  events: CalendarEvent[],
  range: CalendarTimeRange,
  viewerTimezone: string,
): CalendarEventProjection {
  const rangeStart = DateTime.fromISO(range.start, { setZone: true });
  const rangeEnd = DateTime.fromISO(range.end, { setZone: true });
  if (!rangeStart.isValid || !rangeEnd.isValid || rangeEnd <= rangeStart) {
    return { occurrences: [], diagnostics: [] };
  }

  const occurrences: ProjectedCalendarEventOccurrence[] = [];
  const diagnostics: CalendarEventProjectionDiagnostic[] = [];

  for (const sourceEvent of events) {
    try {
      const projected = projectEvent(
        sourceEvent,
        rangeStart,
        rangeEnd,
        viewerTimezone,
      );
      occurrences.push(...projected);
    } catch (error) {
      diagnostics.push({
        sourceEvent,
        reason: projectionErrorReason(error),
      });
    }
  }

  return { occurrences, diagnostics };
}

function projectEvent(
  sourceEvent: CalendarEvent,
  rangeStart: DateTime,
  rangeEnd: DateTime,
  viewerTimezone: string,
): ProjectedCalendarEventOccurrence[] {
  if (sourceEvent.unsupportedTimezone) {
    throw projectionError('unsupported-timezone');
  }
  if (sourceEvent.unsupportedRecurrence === 'range-this-and-future') {
    throw projectionError('invalid-recurrence');
  }
  const recurrence = sourceEvent.recurrence;
  assertRecurrenceInputLimit(recurrence);
  if (!recurrenceHasProjectionData(recurrence)) {
    const interval = eventInterval(sourceEvent, viewerTimezone);
    return intersects(interval, rangeStart, rangeEnd)
      ? [{ event: sourceEvent, sourceEvent }]
      : [];
  }

  if (recurrence?.recurrenceId && !hasMasterRecurrenceData(recurrence)) {
    const interval = eventInterval(sourceEvent, viewerTimezone);
    return intersects(interval, rangeStart, rangeEnd)
      ? [
          makeOccurrence(
            sourceEvent,
            sourceEvent.timing,
            recurrence.recurrenceId,
          ),
        ]
      : [];
  }

  if (isAllDayCalendarEvent(sourceEvent)) {
    return projectAllDaySeries(
      sourceEvent,
      rangeStart,
      rangeEnd,
      viewerTimezone,
    );
  }

  if (isTimedCalendarEvent(sourceEvent)) {
    return projectTimedSeries(
      sourceEvent,
      rangeStart,
      rangeEnd,
      viewerTimezone,
    );
  }

  throw projectionError('invalid-timing');
}

function assertRecurrenceInputLimit(
  recurrence: CalendarEvent['recurrence'],
): void {
  const memberCount =
    (recurrence?.rdates?.length ?? 0) +
    (recurrence?.exdates?.length ?? 0) +
    (recurrence?.overrides?.length ?? 0);
  if (memberCount > MAX_RECURRENCE_INPUT_MEMBERS) {
    throw projectionError('recurrence-input-limit');
  }
}

function projectAllDaySeries(
  sourceEvent: CalendarEvent & { timing: AllDayCalendarEventTiming },
  rangeStart: DateTime,
  rangeEnd: DateTime,
  viewerTimezone: string,
): ProjectedCalendarEventOccurrence[] {
  assertTimezone(viewerTimezone);
  const recurrence = sourceEvent.recurrence;
  const anchor = dateValue(sourceEvent.timing.startDate);
  const candidates = makeCandidates(anchor, recurrence?.rdates);
  const exclusions = recurrence?.exdates ?? [];
  const overrides = recurrence?.overrides ?? [];
  addOverrideCandidates(candidates, overrides);

  validateRecurrenceValues(anchor, candidates, exclusions, overrides);

  const baseDurationDays = dateDifference(
    sourceEvent.timing.startDate,
    sourceEvent.timing.endDate,
  );
  if (baseDurationDays <= 0) {
    throw projectionError('invalid-timing');
  }

  const rule = buildRule(recurrence?.rrule, anchor);
  const localRangeStart = calendarUnixMillisToLocalDateTime(
    rangeStart.toMillis(),
    viewerTimezone,
  );
  const localRangeEnd = calendarUnixMillisToLocalDateTime(
    rangeEnd.toMillis(),
    viewerTimezone,
  );
  const lowerDate = parseDate(localRangeStart.slice(0, 10))
    ?.minus({ days: baseDurationDays })
    .toISODate();
  const upperDate = parseDate(localRangeEnd.slice(0, 10))?.toISODate();
  if (!lowerDate || !upperDate) {
    throw projectionError('invalid-timing');
  }

  addRuleCandidates(
    candidates,
    rule,
    anchor,
    dateValue(lowerDate),
    dateValue(upperDate),
    {
      rangeStart,
      rangeEnd,
      viewerTimezone,
      until: parseUntil(recurrence?.rrule, anchor),
    },
  );

  return materializeCandidates(
    sourceEvent,
    candidates,
    exclusions,
    overrides,
    rangeStart,
    rangeEnd,
    viewerTimezone,
    (candidate) => {
      const specialTiming = candidate.override?.timing ?? candidate.rdateTiming;
      const timing = specialTiming
        ? allDayTimingFromRecurrenceTiming(specialTiming)
        : allDayTimingForStart(candidate.recurrenceId, baseDurationDays);
      return timing;
    },
  );
}

function projectTimedSeries(
  sourceEvent: CalendarEvent & { timing: TimedCalendarEventTiming },
  rangeStart: DateTime,
  rangeEnd: DateTime,
  viewerTimezone: string,
): ProjectedCalendarEventOccurrence[] {
  const recurrence = sourceEvent.recurrence;
  const anchor = timedValue(sourceEvent.timing.start);
  const candidates = makeCandidates(anchor, recurrence?.rdates);
  const exclusions = recurrence?.exdates ?? [];
  const overrides = recurrence?.overrides ?? [];
  addOverrideCandidates(candidates, overrides);

  validateRecurrenceValues(anchor, candidates, exclusions, overrides);
  const baseInterval = timedInterval(sourceEvent.timing, viewerTimezone);
  const baseDurationMillis = baseInterval.end - baseInterval.start;
  if (baseDurationMillis <= 0) {
    throw projectionError('invalid-timing');
  }

  const rule = buildRule(recurrence?.rrule, anchor);
  const anchorTimezone = dateTimeTimezone(anchor, viewerTimezone);
  const lowerValue = dateTimeValueFromWallString(
    calendarUnixMillisToLocalDateTime(
      rangeStart.toMillis() - baseDurationMillis,
      anchorTimezone,
    ),
    anchor,
  );
  const upperValue = dateTimeValueFromWallString(
    calendarUnixMillisToLocalDateTime(rangeEnd.toMillis(), anchorTimezone),
    anchor,
  );
  addRuleCandidates(candidates, rule, anchor, lowerValue, upperValue, {
    rangeStart,
    rangeEnd,
    viewerTimezone,
    until: parseUntil(recurrence?.rrule, anchor),
  });

  return materializeCandidates(
    sourceEvent,
    candidates,
    exclusions,
    overrides,
    rangeStart,
    rangeEnd,
    viewerTimezone,
    (candidate) => {
      const specialTiming = candidate.override?.timing ?? candidate.rdateTiming;
      if (specialTiming) {
        return timedTimingFromRecurrenceTiming(specialTiming, viewerTimezone);
      }

      const startValue = dateTimeValueToTimedDateTime(candidate.recurrenceId);
      const start = timedValueToDateTime(startValue, viewerTimezone);
      const endValue = timedDateTimeAtInstant(
        start.toMillis() + baseDurationMillis,
        sourceEvent.timing.end,
        viewerTimezone,
      );

      return {
        type: 'timed',
        start: startValue,
        end: endValue,
      };
    },
  );
}

type MaterializedCandidate = Candidate & {
  override?: CalendarEventRecurrenceOverride;
};

function materializeCandidates(
  sourceEvent: CalendarEvent,
  candidates: Map<string, Candidate>,
  exclusions: CalendarEventDateTime[],
  overrides: CalendarEventRecurrenceOverride[],
  rangeStart: DateTime,
  rangeEnd: DateTime,
  viewerTimezone: string,
  timingFor: (candidate: MaterializedCandidate) => CalendarEventTiming,
): ProjectedCalendarEventOccurrence[] {
  const excluded = new Set(exclusions.map(recurrenceIdentity));
  const overrideMap = new Map(
    overrides.map((override) => [
      recurrenceIdentity(override.recurrenceId),
      override,
    ]),
  );
  if (candidates.size > MAX_RRULE_SCAN_STEPS) {
    throw projectionError('occurrence-limit');
  }
  const result: ProjectedCalendarEventOccurrence[] = [];

  for (const [identity, candidate] of candidates) {
    const override = overrideMap.get(identity);
    if (override?.status === 'cancelled') {
      continue;
    }
    if (excluded.has(identity) && !override) {
      continue;
    }
    if (override && !override.timing && !candidate.fromRuleOrRdate) {
      continue;
    }

    const displayTiming = timingFor({ ...candidate, override });
    const displayEvent: CalendarEvent = {
      ...sourceEvent,
      status: override?.status ?? sourceEvent.status,
      timing: displayTiming,
    };
    const interval = eventInterval(displayEvent, viewerTimezone);
    if (intersects(interval, rangeStart, rangeEnd)) {
      result.push(
        makeOccurrence(
          sourceEvent,
          displayTiming,
          candidate.recurrenceId,
          override?.status,
        ),
      );
    }
  }

  if (result.length > MAX_PROJECTED_OCCURRENCES_PER_EVENT) {
    throw projectionError('occurrence-limit');
  }

  return result;
}

function makeOccurrence(
  sourceEvent: CalendarEvent,
  timing: CalendarEventTiming,
  recurrenceId?: CalendarEventDateTime,
  status?: CalendarEvent['status'],
): ProjectedCalendarEventOccurrence {
  if (!recurrenceId) {
    return {
      event: { ...sourceEvent, status: status ?? sourceEvent.status, timing },
      sourceEvent,
    };
  }

  const identity = recurrenceIdentity(recurrenceId);
  return {
    event: {
      ...sourceEvent,
      id: `${sourceEvent.id}::occurrence::${encodeURIComponent(identity)}`,
      status: status ?? sourceEvent.status,
      timing,
    },
    sourceEvent,
    recurrenceIdentity: identity,
  };
}

function makeCandidates(
  anchor: CalendarEventDateTime,
  rdates?: CalendarEventRecurrenceDate[],
): Map<string, Candidate> {
  const candidates = new Map<string, Candidate>();
  const anchorIdentity = recurrenceIdentity(anchor);
  candidates.set(anchorIdentity, {
    recurrenceId: anchor,
    fromRuleOrRdate: true,
  });

  for (const rdate of rdates ?? []) {
    const recurrenceId = rdate.type === 'period' ? rdate.timing.start : rdate;
    const identity = recurrenceIdentity(recurrenceId);
    const existing = candidates.get(identity);
    const rdateTiming = rdate.type === 'period' ? rdate.timing : undefined;
    if (existing?.rdateTiming && rdateTiming) {
      throw projectionError('invalid-recurrence');
    }
    candidates.set(identity, {
      recurrenceId,
      fromRuleOrRdate: true,
      rdateTiming: rdateTiming ?? existing?.rdateTiming,
    });
  }

  return candidates;
}

function addOverrideCandidates(
  candidates: Map<string, Candidate>,
  overrides: CalendarEventRecurrenceOverride[],
): void {
  for (const override of overrides) {
    const identity = recurrenceIdentity(override.recurrenceId);
    if (!candidates.has(identity)) {
      candidates.set(identity, {
        recurrenceId: override.recurrenceId,
        fromRuleOrRdate: false,
      });
    }
  }
}

function addRuleCandidates(
  candidates: Map<string, Candidate>,
  rule: RuleExpansion | undefined,
  anchor: CalendarEventDateTime,
  lowerValue: CalendarEventDateTime,
  upperValue: CalendarEventDateTime,
  context: {
    rangeStart: DateTime;
    rangeEnd: DateTime;
    viewerTimezone: string;
    until?: ParsedUntil;
  },
): void {
  if (!rule) {
    return;
  }

  const lowerDate = fakeWallDate(lowerValue);
  const upperDate = fakeWallDate(upperValue);
  const startDate = fakeWallDate(anchor);
  if (!lowerDate || !upperDate || !startDate) {
    throw projectionError('invalid-recurrence');
  }

  const interval = rule.options.interval ?? 1;
  if (
    estimatedRulePeriods(
      rule.options.freq,
      startDate,
      rule.hasCount ? upperDate : lowerDate,
      interval,
    ) > MAX_RRULE_SCAN_STEPS
  ) {
    throw projectionError('occurrence-limit');
  }

  let seen = 0;
  let validCount = 0;
  let scanExceeded = false;
  let outputExceeded = false;
  const ruleStart = rule.hasCount ? startDate : lowerDate;
  const matches = rule.rule.between(ruleStart, upperDate, true, (date) => {
    seen += 1;
    if (seen > MAX_RRULE_SCAN_STEPS) {
      scanExceeded = true;
      return false;
    }

    const recurrenceId = recurrenceValueFromWallDate(date, anchor);
    if (!isValidRecurrenceStart(recurrenceId, context.viewerTimezone)) {
      return true;
    }

    if (
      context.until &&
      isAfterUntil(recurrenceId, context.until, context.viewerTimezone)
    ) {
      return false;
    }

    validCount += 1;
    if (rule.count !== undefined && validCount > rule.count) {
      return false;
    }

    if (
      date.getTime() >= lowerDate.getTime() &&
      date.getTime() <= upperDate.getTime()
    ) {
      const identity = recurrenceIdentity(recurrenceId);
      const current = candidates.get(identity);
      candidates.set(identity, {
        recurrenceId,
        fromRuleOrRdate: true,
        rdateTiming: current?.rdateTiming,
      });
      if (candidates.size > MAX_PROJECTED_OCCURRENCES_PER_EVENT * 2) {
        outputExceeded = true;
        return false;
      }
    }

    return true;
  });

  if (scanExceeded || outputExceeded || matches.length > MAX_RRULE_SCAN_STEPS) {
    throw projectionError('occurrence-limit');
  }
}

type RuleExpansion = {
  rule: RRule;
  options: Partial<Options>;
  count?: number;
  hasCount: boolean;
};

function buildRule(
  rawRule: string | undefined,
  anchor: CalendarEventDateTime,
): RuleExpansion | undefined {
  if (!rawRule) {
    return undefined;
  }

  const ruleText = rawRule.trim().replace(/^RRULE:/i, '');
  const parts = new Map<string, string>();
  for (const component of ruleText.split(';')) {
    const separator = component.indexOf('=');
    if (separator <= 0) {
      throw projectionError('invalid-recurrence');
    }
    const key = component.slice(0, separator).toUpperCase();
    const value = component.slice(separator + 1);
    if (!supportedRRuleParts.has(key) || !value || parts.has(key)) {
      throw projectionError('invalid-recurrence');
    }
    parts.set(key, value);
  }

  const countText = parts.get('COUNT');
  if (countText !== undefined && !/^\d+$/.test(countText)) {
    throw projectionError('invalid-recurrence');
  }
  const count = countText === undefined ? undefined : Number(countText);
  if (
    (count !== undefined && (!Number.isSafeInteger(count) || count <= 0)) ||
    (count !== undefined && parts.has('UNTIL'))
  ) {
    throw projectionError('invalid-recurrence');
  }

  validateByParts(parts);

  const optionsText = [...parts.entries()]
    .filter(([key]) => key !== 'UNTIL' && key !== 'COUNT')
    .map(([key, value]) => `${key}=${value}`)
    .join(';');
  let options: Partial<Options>;
  try {
    options = RRule.parseString(optionsText);
  } catch {
    throw projectionError('invalid-recurrence');
  }
  if (
    options.freq === undefined ||
    (options.interval !== undefined &&
      (!Number.isSafeInteger(options.interval) || options.interval <= 0))
  ) {
    throw projectionError('invalid-recurrence');
  }

  const dtstart = fakeWallDate(anchor);
  if (!dtstart) {
    throw projectionError('invalid-recurrence');
  }

  try {
    return {
      rule: new RRule({ ...options, dtstart }),
      options,
      count,
      hasCount: count !== undefined,
    };
  } catch {
    throw projectionError('invalid-recurrence');
  }
}

function validateByParts(parts: Map<string, string>): void {
  const frequency = parts.get('FREQ')?.toUpperCase();

  for (const [part, { min, max, allowZero = true }] of Object.entries(
    numericByPartRanges,
  )) {
    const value = parts.get(part);
    if (value === undefined) {
      continue;
    }

    const numbers: number[] = [];
    for (const item of value.split(',')) {
      if (!numericByPartPatterns[part].test(item)) {
        throw projectionError('invalid-recurrence');
      }
      const number = Number(item);
      if (
        !Number.isSafeInteger(number) ||
        number < min ||
        number > max ||
        (!allowZero && number === 0)
      ) {
        throw projectionError('invalid-recurrence');
      }
      numbers.push(number);
    }
    if (part === 'BYSECOND' && numbers.includes(60)) {
      // BYSECOND=60 is valid iCalendar syntax for a leap second, but the
      // JavaScript Date/calendar model cannot represent :60 exactly.
      throw projectionError('unsupported-recurrence');
    }
  }

  if (parts.has('BYMONTHDAY') && frequency === 'WEEKLY') {
    throw projectionError('invalid-recurrence');
  }
  if (
    parts.has('BYYEARDAY') &&
    ['DAILY', 'WEEKLY', 'MONTHLY'].includes(frequency ?? '')
  ) {
    throw projectionError('invalid-recurrence');
  }
  if (parts.has('BYWEEKNO') && frequency !== 'YEARLY') {
    throw projectionError('invalid-recurrence');
  }
  if (
    parts.has('BYSETPOS') &&
    ![
      'BYDAY',
      'BYHOUR',
      'BYMINUTE',
      'BYMONTH',
      'BYMONTHDAY',
      'BYSECOND',
      'BYYEARDAY',
      'BYWEEKNO',
    ].some((part) => parts.has(part))
  ) {
    throw projectionError('invalid-recurrence');
  }

  const byDay = parts.get('BYDAY');
  if (byDay === undefined) {
    return;
  }

  for (const day of byDay.split(',')) {
    const match = day.match(/^([+-]?\d{1,2})?(MO|TU|WE|TH|FR|SA|SU)$/i);
    if (!match) {
      throw projectionError('invalid-recurrence');
    }
    if (match[1] === undefined) {
      continue;
    }

    const ordinal = Number(match[1]);
    if (
      !Number.isSafeInteger(ordinal) ||
      ordinal === 0 ||
      ordinal < -53 ||
      ordinal > 53 ||
      !['MONTHLY', 'YEARLY'].includes(frequency ?? '') ||
      (frequency === 'YEARLY' && parts.has('BYWEEKNO'))
    ) {
      throw projectionError('invalid-recurrence');
    }
  }
}

function parseUntil(
  rawRule: string | undefined,
  anchor: CalendarEventDateTime,
): ParsedUntil | undefined {
  const match = rawRule?.match(/(?:^|;)UNTIL=([^;]+)/i);
  if (!match) {
    return undefined;
  }

  const rawValue = match[1];
  if (/^\d{8}$/.test(rawValue)) {
    if (anchor.type !== 'date') {
      throw projectionError('invalid-recurrence');
    }
    const value = compactDate(rawValue);
    if (!parseDate(value)) {
      throw projectionError('invalid-recurrence');
    }
    return { type: 'date', value };
  }

  const dateTimeMatch = rawValue.match(/^(\d{8}T\d{6})(Z?)$/i);
  if (!dateTimeMatch || anchor.type === 'date') {
    throw projectionError('invalid-recurrence');
  }
  const local = compactDateTime(dateTimeMatch[1]);
  if (!local) {
    throw projectionError('invalid-recurrence');
  }

  if (dateTimeMatch[2].toUpperCase() === 'Z') {
    if (anchor.type !== 'date-time') {
      throw projectionError('invalid-recurrence');
    }
    const instant = DateTime.fromISO(local, { zone: 'UTC' });
    if (!instant.isValid) {
      throw projectionError('invalid-recurrence');
    }
    return {
      type: 'utc-date-time',
      value: local,
      instant: instant.toMillis(),
    };
  }

  if (anchor.type !== 'floating-date-time') {
    throw projectionError('invalid-recurrence');
  }
  return { type: 'floating-date-time', value: local };
}

function isAfterUntil(
  value: CalendarEventDateTime,
  until: ParsedUntil,
  viewerTimezone: string,
): boolean {
  if (until.type === 'date') {
    return value.type !== 'date' || value.value > until.value;
  }
  if (until.type === 'floating-date-time') {
    if (value.type !== 'floating-date-time') {
      return true;
    }
    const candidate = fakeWallDate(value);
    const limit = fakeWallDate({
      type: 'floating-date-time',
      value: until.value,
    });
    if (!candidate || !limit) {
      throw projectionError('invalid-recurrence');
    }
    return candidate.getTime() > limit.getTime();
  }

  if (value.type === 'date') {
    return true;
  }
  return (
    recurrenceValueToDateTime(value, viewerTimezone).toMillis() > until.instant
  );
}

function validateRecurrenceValues(
  anchor: CalendarEventDateTime,
  candidates: Map<string, Candidate>,
  exclusions: CalendarEventDateTime[],
  overrides: CalendarEventRecurrenceOverride[],
): void {
  assertRecurrenceValue(anchor);
  for (const candidate of candidates.values()) {
    assertCompatibleValue(anchor, candidate.recurrenceId);
    if (candidate.rdateTiming) {
      if (candidate.recurrenceId.type === 'date') {
        throw projectionError('invalid-recurrence');
      }
      validateRecurrenceTiming(candidate.rdateTiming, anchor);
    }
  }
  for (const exclusion of exclusions) {
    assertCompatibleValue(anchor, exclusion);
  }
  const seenOverrides = new Set<string>();
  for (const override of overrides) {
    assertCompatibleValue(anchor, override.recurrenceId);
    const identity = recurrenceIdentity(override.recurrenceId);
    if (seenOverrides.has(identity)) {
      throw projectionError('invalid-recurrence');
    }
    seenOverrides.add(identity);
    if (override.timing) {
      validateRecurrenceTiming(override.timing, anchor);
    }
  }
}

function validateRecurrenceTiming(
  timing: CalendarEventRecurrenceTiming,
  anchor: CalendarEventDateTime,
): void {
  assertCompatibleValue(anchor, timing.start);
  assertRecurrenceValue(timing.start);
  if (timing.type === 'end') {
    assertRecurrenceValue(timing.end);
    if ((anchor.type === 'date') !== (timing.end.type === 'date')) {
      throw projectionError('invalid-recurrence');
    }
  } else {
    validateDuration(timing.duration, anchor.type === 'date');
  }
}

function assertCompatibleValue(
  anchor: CalendarEventDateTime,
  value: CalendarEventDateTime,
): void {
  const compatible =
    anchor.type === value.type &&
    (anchor.type !== 'date-time' ||
      value.type !== 'date-time' ||
      anchor.value.timezone === value.value.timezone);
  if (!compatible) {
    throw projectionError('invalid-recurrence');
  }
}

function assertRecurrenceValue(value: CalendarEventDateTime): void {
  if (value.type === 'date') {
    if (!parseDate(value.value)) {
      throw projectionError('invalid-recurrence');
    }
    return;
  }

  if (value.type === 'floating-date-time') {
    assertLocalDateTime(value.value, 'UTC');
    return;
  }

  assertTimezone(value.value.timezone);
  assertLocalDateTime(value.value.local, value.value.timezone);
}

function validateDuration(
  duration: CalendarEventDuration,
  dateOnly: boolean,
): void {
  const units = [
    duration.weeks,
    duration.days,
    duration.hours,
    duration.minutes,
    duration.seconds,
  ];
  if (
    units.some((unit) => !Number.isSafeInteger(unit) || unit < 0) ||
    duration.isNegative ||
    (duration.weeks > 0 &&
      (duration.days > 0 ||
        duration.hours > 0 ||
        duration.minutes > 0 ||
        duration.seconds > 0)) ||
    (dateOnly &&
      (duration.hours !== 0 ||
        duration.minutes !== 0 ||
        duration.seconds !== 0))
  ) {
    throw projectionError('invalid-recurrence');
  }
}

function allDayTimingForStart(
  value: CalendarEventDateTime,
  durationDays: number,
): AllDayCalendarEventTiming {
  if (value.type !== 'date') {
    throw projectionError('invalid-recurrence');
  }
  const start = parseDate(value.value);
  if (!start) {
    throw projectionError('invalid-recurrence');
  }
  return {
    type: 'all-day',
    startDate: value.value,
    endDate: start.plus({ days: durationDays }).toISODate() ?? value.value,
  };
}

function allDayTimingFromRecurrenceTiming(
  timing: CalendarEventRecurrenceTiming,
): AllDayCalendarEventTiming {
  if (timing.start.type !== 'date') {
    throw projectionError('invalid-recurrence');
  }
  if (timing.type === 'end') {
    if (timing.end.type !== 'date') {
      throw projectionError('invalid-recurrence');
    }
    const durationDays = dateDifference(timing.start.value, timing.end.value);
    if (durationDays <= 0) {
      throw projectionError('invalid-timing');
    }
    return allDayTimingForStart(timing.start, durationDays);
  }

  validateDuration(timing.duration, true);
  const durationDays = timing.duration.weeks * 7 + timing.duration.days;
  if (durationDays <= 0) {
    throw projectionError('invalid-timing');
  }
  return allDayTimingForStart(timing.start, durationDays);
}

function timedTimingFromRecurrenceTiming(
  timing: CalendarEventRecurrenceTiming,
  viewerTimezone: string,
): TimedCalendarEventTiming {
  if (timing.start.type === 'date') {
    throw projectionError('invalid-recurrence');
  }
  const start = dateTimeValueToTimedDateTime(timing.start);
  const startDateTime = recurrenceValueToDateTime(timing.start, viewerTimezone);
  if (timing.type === 'end') {
    if (timing.end.type === 'date') {
      throw projectionError('invalid-recurrence');
    }
    const end = dateTimeValueToTimedDateTime(timing.end);
    const endDateTime = recurrenceValueToDateTime(timing.end, viewerTimezone);
    if (endDateTime.toMillis() <= startDateTime.toMillis()) {
      throw projectionError('invalid-timing');
    }
    return { type: 'timed', start, end };
  }

  const endValue = addRfcDuration(
    timing.start,
    timing.duration,
    viewerTimezone,
  );
  const endDateTime = recurrenceValueToDateTime(endValue, viewerTimezone);
  if (endDateTime.toMillis() <= startDateTime.toMillis()) {
    throw projectionError('invalid-timing');
  }
  return {
    type: 'timed',
    start,
    end: dateTimeValueToTimedDateTime(endValue),
  };
}

function addRfcDuration(
  start: CalendarEventDateTime,
  duration: CalendarEventDuration,
  viewerTimezone: string,
): CalendarEventDateTime {
  validateDuration(duration, false);
  const timezone = dateTimeTimezone(start, viewerTimezone);
  const localStart = recurrenceLocalValue(start);
  const wallStart = DateTime.fromISO(localStart, { zone: 'UTC' });
  if (!wallStart.isValid) {
    throw projectionError('invalid-timing');
  }

  const calendarDays = duration.weeks > 0 ? duration.weeks * 7 : duration.days;
  const localAfterCalendarUnits = wallStart
    .plus({ days: calendarDays })
    .toFormat("yyyy-MM-dd'T'HH:mm:ss");
  const instantAfterCalendarUnits = assertLocalDateTime(
    localAfterCalendarUnits,
    timezone,
  );
  const exactMillis =
    ((duration.hours * 60 + duration.minutes) * 60 + duration.seconds) * 1000;

  // Pure calendar units retain their nominal wall value, including an
  // explicit value that falls in a DST gap. Exact units continue from the
  // instant selected by the pinned timezone rules.
  const localEnd =
    exactMillis === 0
      ? localAfterCalendarUnits
      : calendarUnixMillisToLocalDateTime(
          instantAfterCalendarUnits + exactMillis,
          timezone,
        );
  if (
    exactMillis !== 0 &&
    assertLocalDateTime(localEnd, timezone) !==
      instantAfterCalendarUnits + exactMillis
  ) {
    throw projectionError('invalid-timing');
  }
  return recurrenceValueWithLocal(start, localEnd);
}

function eventInterval(
  event: CalendarEvent,
  viewerTimezone: string,
): { start: number; end: number } {
  if (isAllDayCalendarEvent(event)) {
    assertTimezone(viewerTimezone);
    if (
      !parseDate(event.timing.startDate) ||
      !parseDate(event.timing.endDate)
    ) {
      throw projectionError('invalid-timing');
    }
    return {
      start: assertLocalDateTime(
        `${event.timing.startDate}T00:00:00`,
        viewerTimezone,
      ),
      end: assertLocalDateTime(
        `${event.timing.endDate}T00:00:00`,
        viewerTimezone,
      ),
    };
  }

  if (isTimedCalendarEvent(event)) {
    const interval = timedInterval(event.timing, viewerTimezone);
    if (interval.end <= interval.start) {
      throw projectionError('invalid-timing');
    }
    return interval;
  }

  throw projectionError('invalid-timing');
}

function timedInterval(
  timing: TimedCalendarEventTiming,
  viewerTimezone: string,
): { start: number; end: number } {
  assertTimedTimezone(timing.start, viewerTimezone);
  assertTimedTimezone(timing.end, viewerTimezone);
  const start = calendarEventTimedDateTimeToDateTime(
    timing.start,
    viewerTimezone,
  );
  const end = calendarEventTimedDateTimeToDateTime(timing.end, viewerTimezone);
  if (!start.isValid || !end.isValid) {
    throw projectionError('invalid-timing');
  }
  return { start: start.toMillis(), end: end.toMillis() };
}

function intersects(
  interval: { start: number; end: number },
  rangeStart: DateTime,
  rangeEnd: DateTime,
): boolean {
  return (
    interval.start < rangeEnd.toMillis() && interval.end > rangeStart.toMillis()
  );
}

function dateValue(value: string): CalendarEventDateTime {
  return { type: 'date', value };
}

function timedValue(value: CalendarEventTimedDateTime): CalendarEventDateTime {
  return value.type === 'floating'
    ? { type: 'floating-date-time', value: value.local }
    : {
        type: 'date-time',
        value: { local: value.local, timezone: value.timezone },
      };
}

function recurrenceIdentity(value: CalendarEventDateTime): string {
  switch (value.type) {
    case 'date':
      return `date:${value.value}`;
    case 'floating-date-time':
      return `floating:${canonicalRecurrenceLocal(value.value)}`;
    case 'date-time':
      return `zoned:${value.value.timezone}:${canonicalRecurrenceLocal(value.value.local)}`;
  }
}

function canonicalRecurrenceLocal(value: string): string {
  const local = DateTime.fromISO(value, { zone: 'UTC' });
  if (!local.isValid) {
    throw projectionError('invalid-recurrence');
  }
  return local.toFormat("yyyy-MM-dd'T'HH:mm:ss");
}

function recurrenceValueToDateTime(
  value: CalendarEventDateTime,
  viewerTimezone: string,
): DateTime {
  if (value.type === 'date') {
    throw projectionError('invalid-recurrence');
  }
  const zone =
    value.type === 'floating-date-time' ? viewerTimezone : value.value.timezone;
  const local =
    value.type === 'floating-date-time' ? value.value : value.value.local;
  return DateTime.fromMillis(assertLocalDateTime(local, zone), { zone: 'UTC' });
}

function dateTimeValueToTimedDateTime(
  value: CalendarEventDateTime,
): CalendarEventTimedDateTime {
  if (value.type === 'date') {
    throw projectionError('invalid-recurrence');
  }
  return value.type === 'floating-date-time'
    ? { type: 'floating', local: value.value }
    : {
        type: 'zoned',
        local: value.value.local,
        timezone: value.value.timezone,
      };
}

function timedValueToDateTime(
  value: CalendarEventTimedDateTime,
  viewerTimezone: string,
): DateTime {
  assertTimedTimezone(value, viewerTimezone);
  return calendarEventTimedDateTimeToDateTime(value, viewerTimezone);
}

function timedDateTimeAtInstant(
  instantMillis: number,
  template: CalendarEventTimedDateTime,
  viewerTimezone: string,
): CalendarEventTimedDateTime {
  const timezone =
    template.type === 'floating' ? viewerTimezone : template.timezone;
  const local = calendarUnixMillisToLocalDateTime(instantMillis, timezone);
  if (assertLocalDateTime(local, timezone) !== instantMillis) {
    // The typed model cannot encode which side of an overlap an instant uses.
    throw projectionError('invalid-timing');
  }

  if (template.type === 'floating') {
    return { type: 'floating', local };
  }
  return { type: 'zoned', local, timezone: template.timezone };
}

function assertTimedTimezone(
  value: CalendarEventTimedDateTime,
  viewerTimezone: string,
): void {
  assertTimezone(value.type === 'floating' ? viewerTimezone : value.timezone);
  assertLocalDateTime(
    value.local,
    value.type === 'floating' ? viewerTimezone : value.timezone,
  );
}

function assertTimezone(timezone: string): void {
  if (!isCalendarTimezoneSupported(timezone)) {
    throw projectionError('unsupported-timezone');
  }
}

function assertLocalDateTime(value: string, timezone: string): number {
  try {
    return calendarLocalDateTimeToUnixMillis(value, timezone);
  } catch (error) {
    if (error instanceof CalendarEventTimezoneError) {
      throw projectionError(
        error.code === 'unsupported-timezone'
          ? 'unsupported-timezone'
          : 'invalid-timing',
      );
    }
    throw error;
  }
}

function parseDate(value: string): DateTime | undefined {
  const date = DateTime.fromISO(value, { zone: 'UTC' });
  return date.isValid && date.toISODate() === value ? date : undefined;
}

function dateDifference(start: string, end: string): number {
  const startDate = parseDate(start);
  const endDate = parseDate(end);
  if (!startDate || !endDate) {
    throw projectionError('invalid-timing');
  }
  return endDate.diff(startDate, 'days').days;
}

function dateTimeTimezone(
  value: CalendarEventDateTime,
  viewerTimezone: string,
): string {
  if (value.type === 'date') {
    throw projectionError('invalid-recurrence');
  }
  return value.type === 'floating-date-time'
    ? viewerTimezone
    : value.value.timezone;
}

function dateTimeValueFromWallString(
  local: string,
  anchor: CalendarEventDateTime,
): CalendarEventDateTime {
  if (anchor.type === 'date') {
    throw projectionError('invalid-recurrence');
  }
  return anchor.type === 'floating-date-time'
    ? { type: 'floating-date-time', value: local }
    : {
        type: 'date-time',
        value: { local, timezone: anchor.value.timezone },
      };
}

function recurrenceValueFromWallDate(
  value: Date,
  anchor: CalendarEventDateTime,
): CalendarEventDateTime {
  if (anchor.type === 'date') {
    return { type: 'date', value: wallDateToDate(value) };
  }
  const local = wallDateToDateTime(value);
  return anchor.type === 'floating-date-time'
    ? { type: 'floating-date-time', value: local }
    : {
        type: 'date-time',
        value: { local, timezone: anchor.value.timezone },
      };
}

function fakeWallDate(value: CalendarEventDateTime): Date | undefined {
  const local =
    value.type === 'date'
      ? value.value
      : value.type === 'floating-date-time'
        ? value.value
        : value.value.local;
  const date = DateTime.fromISO(local, { zone: 'UTC' });
  if (!date.isValid) {
    return undefined;
  }
  return new Date(
    Date.UTC(
      date.year,
      date.month - 1,
      date.day,
      date.hour,
      date.minute,
      date.second,
      date.millisecond,
    ),
  );
}

function wallDateToDate(value: Date): string {
  return [
    String(value.getUTCFullYear()).padStart(4, '0'),
    String(value.getUTCMonth() + 1).padStart(2, '0'),
    String(value.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

function wallDateToDateTime(value: Date): string {
  return `${wallDateToDate(value)}T${String(value.getUTCHours()).padStart(2, '0')}:${String(value.getUTCMinutes()).padStart(2, '0')}:${String(value.getUTCSeconds()).padStart(2, '0')}`;
}

function compactDate(value: string): string {
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function compactDateTime(value: string): string | undefined {
  if (!/^\d{8}T\d{6}$/i.test(value)) {
    return undefined;
  }
  const local = `${compactDate(value)}T${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}`;
  return DateTime.fromISO(local, { zone: 'UTC' }).isValid ? local : undefined;
}

function isValidRecurrenceStart(
  value: CalendarEventDateTime,
  viewerTimezone: string,
): boolean {
  if (value.type === 'date') {
    return Boolean(parseDate(value.value));
  }
  // RFC 5545 excludes RRULE instances in a local time gap without consuming
  // COUNT. This check occurs before addRuleCandidates increments validCount.
  return isCalendarRecurrenceWallTimeValid(
    recurrenceLocalValue(value),
    dateTimeTimezone(value, viewerTimezone),
  );
}

function recurrenceLocalValue(value: CalendarEventDateTime): string {
  if (value.type === 'date') {
    throw projectionError('invalid-recurrence');
  }
  return value.type === 'floating-date-time' ? value.value : value.value.local;
}

function recurrenceValueWithLocal(
  template: CalendarEventDateTime,
  local: string,
): CalendarEventDateTime {
  if (template.type === 'date') {
    throw projectionError('invalid-recurrence');
  }
  return template.type === 'floating-date-time'
    ? { type: 'floating-date-time', value: local }
    : {
        type: 'date-time',
        value: { local, timezone: template.value.timezone },
      };
}

function estimatedRulePeriods(
  frequency: Options['freq'] | undefined,
  start: Date,
  end: Date,
  interval: number,
): number {
  if (frequency === undefined || end <= start) {
    return 0;
  }
  const startDate = DateTime.fromJSDate(start, { zone: 'UTC' });
  const endDate = DateTime.fromJSDate(end, { zone: 'UTC' });
  let difference: number;
  switch (frequency) {
    case RRule.YEARLY:
      difference = endDate.year - startDate.year;
      break;
    case RRule.MONTHLY:
      difference =
        (endDate.year - startDate.year) * 12 + endDate.month - startDate.month;
      break;
    case RRule.WEEKLY:
      difference = endDate.diff(startDate, 'days').days / 7;
      break;
    case RRule.DAILY:
      difference = endDate.diff(startDate, 'days').days;
      break;
    case RRule.HOURLY:
      difference = endDate.diff(startDate, 'hours').hours;
      break;
    case RRule.MINUTELY:
      difference = endDate.diff(startDate, 'minutes').minutes;
      break;
    case RRule.SECONDLY:
      difference = endDate.diff(startDate, 'seconds').seconds;
      break;
  }
  return Math.ceil(Math.max(0, difference) / interval);
}

function recurrenceHasProjectionData(
  recurrence: CalendarEvent['recurrence'],
): boolean {
  return Boolean(
    recurrence?.rrule ||
    recurrence?.rdates?.length ||
    recurrence?.exdates?.length ||
    recurrence?.recurrenceId ||
    recurrence?.overrides?.length,
  );
}

function hasMasterRecurrenceData(
  recurrence: NonNullable<CalendarEvent['recurrence']>,
): boolean {
  return Boolean(
    recurrence.rrule ||
    recurrence.rdates?.length ||
    recurrence.exdates?.length ||
    recurrence.overrides?.length,
  );
}

function isProjectionError(error: unknown): error is ProjectionError {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'reason' in error &&
    typeof error.reason === 'string',
  );
}

function projectionErrorReason(
  error: unknown,
): CalendarEventProjectionDiagnosticReason {
  if (isProjectionError(error)) {
    return error.reason;
  }
  if (error instanceof CalendarEventTimezoneError) {
    return error.code === 'unsupported-timezone'
      ? 'unsupported-timezone'
      : 'invalid-timing';
  }
  return 'invalid-recurrence';
}

function projectionError(
  reason: CalendarEventProjectionDiagnosticReason,
): ProjectionError {
  return { reason };
}
