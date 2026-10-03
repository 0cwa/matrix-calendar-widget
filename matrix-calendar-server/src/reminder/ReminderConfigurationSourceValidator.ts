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

import type {
  CalendarEventTimedDateTime,
  CalendarEventTiming,
} from '@matrix-calendar-widget/calendar';
import { calendarLocalDateTimeToUnixMillis } from '@matrix-calendar-widget/calendar';
import { getVTimezoneBlock } from '@matrix-calendar-widget/ical-timezones';
import ICAL from 'ical.js';
import { hasUnsupportedTimezoneRules } from '../caldav/ICalendarTimezoneProjectionSafety';
import {
  CanonicalReminderIdentity,
  CanonicalReminderResourceData,
  CanonicalReminderResourceSelection,
  resolveCanonicalReminderResourceSelection,
} from './CanonicalReminderIdentityResolver';
import {
  ReminderAlarmTimingOption,
  ResolvedReminderOccurrenceTiming,
  isReminderScheduleWithinLimits,
  readReminderAlarmTimingOption,
} from './ReminderTrigger';

const projectedTimezoneCache = new Map<string, ICAL.Timezone>();

export class ReminderConfigurationSourceError extends Error {
  constructor() {
    super('Reminder source is not supported');
    this.name = 'ReminderConfigurationSourceError';
  }
}

/**
 * Resolve and validate one selected alarm using the current CalDAV source.
 * Calendar and alarm text remain internal; the returned value contains only
 * the canonical sidecar identity.
 */
export function resolveTriggerableReminderIdentity(
  identity: Pick<
    CanonicalReminderIdentity,
    'calendarId' | 'recurrenceId' | 'alarmUid'
  > & { eventUid?: string },
  resource: CanonicalReminderResourceData,
): CanonicalReminderIdentity {
  try {
    const selection = resolveCanonicalReminderResourceSelection(
      identity,
      resource,
    );
    if (
      hasUnsupportedTimezoneRules(
        selection.calendar,
        selection.identity.eventUid,
      )
    ) {
      throw new Error('Unsupported timezone data');
    }

    const timing = resolveSelectedEventTiming(selection);
    if (!isReminderScheduleWithinLimits(selection.alarmSource, timing)) {
      throw new Error('Unsupported reminder trigger');
    }
    return selection.identity;
  } catch {
    throw new ReminderConfigurationSourceError();
  }
}

/**
 * Validate one already-selected source alarm and return only its timing
 * metadata for the manager-facing options response. The canonical resource
 * resolver has already prepared the source once; this function performs no
 * DAV I/O and never returns event text or iCalendar content.
 */
export function resolveTriggerableReminderAlarmOption(
  selection: CanonicalReminderResourceSelection,
):
  | (ReminderAlarmTimingOption & {
      eventUid: string;
      recurrenceId: string | null;
      alarmUid: string;
    })
  | undefined {
  try {
    if (
      hasUnsupportedTimezoneRules(
        selection.calendar,
        selection.identity.eventUid,
      )
    ) {
      return undefined;
    }

    const timing = resolveSelectedEventTiming(selection);
    if (!isReminderScheduleWithinLimits(selection.alarmSource, timing)) {
      return undefined;
    }

    const alarmTiming = readReminderAlarmTimingOption(selection.alarmSource);
    if (!alarmTiming) return undefined;
    return {
      eventUid: selection.identity.eventUid,
      recurrenceId: selection.identity.recurrenceId,
      alarmUid: selection.identity.alarmUid,
      ...alarmTiming,
    };
  } catch {
    return undefined;
  }
}

/**
 * Convert one already-projected timed occurrence using the selected
 * canonical resource's IANA rules. This internal seam is shared with the
 * scheduler adapter; it returns no event or iCalendar data.
 */
export function resolveProjectedReminderOccurrenceTiming(
  selection: Pick<CanonicalReminderResourceSelection, 'calendar' | 'identity'>,
  timing: CalendarEventTiming,
): ResolvedReminderOccurrenceTiming {
  if (
    timing.type !== 'timed' ||
    hasUnsupportedTimezoneRules(selection.calendar, selection.identity.eventUid)
  ) {
    throw new ReminderConfigurationSourceError();
  }

  try {
    const start = resolveProjectedDateTime(
      selection.calendar,
      selection.identity.eventUid,
      timing.start,
    );
    const end = resolveProjectedDateTime(
      selection.calendar,
      selection.identity.eventUid,
      timing.end,
    );
    if (
      start.zone.tzid !== end.zone.tzid ||
      canonicalInstantForTime(end) <= canonicalInstantForTime(start)
    ) {
      throw new Error('Incompatible event timing');
    }
    return { start, end };
  } catch {
    throw new ReminderConfigurationSourceError();
  }
}

type ParsedDateTimeSource = {
  name: 'DTSTART' | 'DTEND';
  timeZoneId: string;
  isUtc: boolean;
  expected: {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
  };
};

function resolveSelectedEventTiming(selection: {
  calendar: ICAL.Component;
  event: ICAL.Component;
  dateTimeLines: readonly string[];
}): { start: ICAL.Time; end: ICAL.Time } {
  const sources = selection.dateTimeLines.map(parseDateTimeSource);
  const startSources = sources.filter(({ name }) => name === 'DTSTART');
  const endSources = sources.filter(({ name }) => name === 'DTEND');
  const startProperties = selection.event.getAllProperties('dtstart');
  const endProperties = selection.event.getAllProperties('dtend');
  if (
    startSources.length !== 1 ||
    endSources.length !== 1 ||
    startProperties.length !== startSources.length ||
    endProperties.length !== endSources.length ||
    selection.event.getAllProperties('duration').length !== 0
  ) {
    throw new Error('Invalid event time properties');
  }

  addBundledTimezones(selection.calendar, sources);
  const start = readDateTime(startProperties[0], startSources[0]);
  const end = readDateTime(endProperties[0], endSources[0]);
  if (
    start.zone.tzid !== end.zone.tzid ||
    canonicalInstantForTime(end) <= canonicalInstantForTime(start)
  ) {
    throw new Error('Incompatible event timing');
  }
  return { start, end };
}

function resolveProjectedDateTime(
  calendar: ICAL.Component,
  eventUid: string,
  value: CalendarEventTimedDateTime,
): ICAL.Time {
  if (value.type !== 'zoned') {
    throw new Error('Floating event timing is unsupported');
  }
  const expected = parseLocalDateTime(value.local);
  const timezoneId = value.timezone;
  if (!isValidTimezoneId(timezoneId)) {
    throw new Error('Invalid event timezone');
  }
  const timezoneProperties = calendar
    .getAllSubcomponents('vevent')
    .filter((event) => event.getFirstPropertyValue('uid') === eventUid)
    .flatMap((event) =>
      ['dtstart', 'dtend', 'recurrence-id', 'rdate', 'exdate'].flatMap(
        (propertyName) => event.getAllProperties(propertyName),
      ),
    );
  if (
    timezoneId !== 'UTC' &&
    !timezoneProperties.some(
      (property) => property.getFirstParameter('tzid') === timezoneId,
    )
  ) {
    throw new Error('Timezone is not present in canonical event source');
  }

  const zone = getProjectedTimezone(calendar, timezoneId);
  const time = ICAL.Time.fromData({ ...expected, isDate: false }, zone);
  const canonicalInstant =
    timezoneId === 'UTC'
      ? utcInstantMillis(
          expected.year,
          expected.month,
          expected.day,
          expected.hour,
          expected.minute,
          expected.second,
        )
      : calendarLocalDateTimeToUnixMillis(value.local, timezoneId);
  if (
    time.zone.tzid !== timezoneId ||
    time.zone === ICAL.Timezone.localTimezone ||
    !Number.isFinite(canonicalInstant)
  ) {
    throw new Error('Event time is unresolved');
  }
  return time;
}

function parseLocalDateTime(value: string): ParsedDateTimeSource['expected'] {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error('Invalid projected event time');
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] =
    match;
  const expected = {
    year: Number(yearText),
    month: Number(monthText),
    day: Number(dayText),
    hour: Number(hourText),
    minute: Number(minuteText),
    second: Number(secondText),
  };
  if (
    !isValidDate(expected.year, expected.month, expected.day) ||
    expected.hour > 23 ||
    expected.minute > 59 ||
    expected.second > 59
  ) {
    throw new Error('Invalid projected event time');
  }
  return expected;
}

function getProjectedTimezone(
  calendar: ICAL.Component,
  timezoneId: string,
): ICAL.Timezone {
  if (timezoneId === 'UTC') return ICAL.Timezone.utcTimezone;
  const cached = projectedTimezoneCache.get(timezoneId);
  if (cached) return cached;

  const timezoneComponents = calendar
    .getAllSubcomponents('vtimezone')
    .filter(
      (component) => component.getFirstPropertyValue('tzid') === timezoneId,
    );
  if (timezoneComponents.length > 1) {
    throw new Error('Ambiguous event timezone');
  }

  let component = timezoneComponents[0];
  if (!component) {
    const block = getVTimezoneBlock(timezoneId);
    if (!block) throw new Error('Unsupported event timezone');
    component = ICAL.Component.fromString(block);
  }
  if (
    component.name !== 'vtimezone' ||
    component.getFirstPropertyValue('tzid') !== timezoneId
  ) {
    throw new Error('Invalid event timezone');
  }
  const timezone = new ICAL.Timezone({ component, tzid: timezoneId });
  projectedTimezoneCache.set(timezoneId, timezone);
  return timezone;
}

function parseDateTimeSource(line: string): ParsedDateTimeSource {
  const separator = findUnquotedColon(line);
  if (separator < 0) throw new Error('Invalid event time property');
  const sections = splitOutsideQuotes(line.slice(0, separator), ';');
  const rawName = sections.shift()?.toUpperCase();
  if (rawName !== 'DTSTART' && rawName !== 'DTEND') {
    throw new Error('Invalid event time property');
  }

  const parameters = new Map<string, string>();
  for (const section of sections) {
    const equals = section.indexOf('=');
    if (equals <= 0) throw new Error('Invalid event time parameter');
    const name = section.slice(0, equals).toUpperCase();
    const rawValue = section.slice(equals + 1);
    if (
      !['TZID', 'VALUE'].includes(name) ||
      rawValue.length === 0 ||
      parameters.has(name)
    ) {
      throw new Error('Invalid event time parameter');
    }
    parameters.set(name, unquoteParameterValue(rawValue));
  }
  const valueType = parameters.get('VALUE');
  if (valueType !== undefined && valueType.toUpperCase() !== 'DATE-TIME') {
    throw new Error('Date-only event timing is unsupported');
  }

  const rawValue = line.slice(separator + 1);
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(
    rawValue,
  );
  if (!match) throw new Error('Invalid event date-time');
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] =
    match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (
    !isValidDate(year, month, day) ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    throw new Error('Invalid event date-time');
  }

  const tzid = parameters.get('TZID');
  const isUtc = tzid === undefined && match[7] === 'Z';
  if (tzid !== undefined && (match[7] === 'Z' || !isValidTimezoneId(tzid))) {
    throw new Error('Invalid event timezone');
  }
  if (tzid === undefined && !isUtc) {
    throw new Error('Floating event timing is unsupported');
  }

  return {
    name: rawName as 'DTSTART' | 'DTEND',
    timeZoneId: tzid ?? 'UTC',
    isUtc,
    expected: { year, month, day, hour, minute, second },
  };
}

function readDateTime(
  property: ICAL.Property,
  source: ParsedDateTimeSource,
): ICAL.Time {
  if (
    property.type !== 'date-time' ||
    property.getFirstParameter('tzid') !==
      (source.isUtc ? undefined : source.timeZoneId)
  ) {
    throw new Error('Event time source does not match parsed value');
  }
  const value = property.getFirstValue();
  if (!(value instanceof ICAL.Time) || value.isDate) {
    throw new Error('Event time is not a DATE-TIME');
  }
  const { year, month, day, hour, minute, second } = source.expected;
  const canonicalInstant = source.isUtc
    ? utcInstantMillis(year, month, day, hour, minute, second)
    : calendarLocalDateTimeToUnixMillis(
        `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`,
        source.timeZoneId,
      );
  if (
    value.year !== year ||
    value.month !== month ||
    value.day !== day ||
    value.hour !== hour ||
    value.minute !== minute ||
    value.second !== second ||
    value.zone.tzid !== source.timeZoneId ||
    value.zone === ICAL.Timezone.localTimezone ||
    !Number.isFinite(canonicalInstant)
  ) {
    throw new Error('Event time was normalized or is unresolved');
  }
  return value;
}

function utcInstantMillis(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): number {
  const value = new Date(0);
  value.setUTCFullYear(year, month - 1, day);
  value.setUTCHours(hour, minute, second, 0);
  return value.getTime();
}

function canonicalInstantForTime(value: ICAL.Time): number {
  return calendarLocalDateTimeToUnixMillis(
    formatLocalDateTime(value),
    value.zone.tzid,
  );
}

function formatLocalDateTime(value: ICAL.Time): string {
  return `${String(value.year).padStart(4, '0')}-${String(value.month).padStart(2, '0')}-${String(value.day).padStart(2, '0')}T${String(value.hour).padStart(2, '0')}:${String(value.minute).padStart(2, '0')}:${String(value.second).padStart(2, '0')}`;
}

function addBundledTimezones(
  calendar: ICAL.Component,
  sources: readonly ParsedDateTimeSource[],
): void {
  const embedded = calendar.getAllSubcomponents('vtimezone');
  const seen = new Set<string>();
  for (const { isUtc, timeZoneId } of sources) {
    if (isUtc || seen.has(timeZoneId)) continue;
    seen.add(timeZoneId);
    const matches = embedded.filter(
      (timezone) => timezone.getFirstPropertyValue('tzid') === timeZoneId,
    );
    if (matches.length > 1) throw new Error('Ambiguous event timezone');
    if (matches.length === 1) continue;

    const block = getVTimezoneBlock(timeZoneId);
    if (!block) throw new Error('Unsupported event timezone');
    const timezone = ICAL.Component.fromString(block);
    if (
      timezone.name !== 'vtimezone' ||
      timezone.getFirstPropertyValue('tzid') !== timeZoneId
    ) {
      throw new Error('Invalid bundled timezone');
    }
    calendar.addSubcomponent(timezone);
  }
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
  if (quoted) throw new Error('Malformed event time parameter');
  sections.push(value.slice(start));
  return sections;
}

function findUnquotedColon(line: string): number {
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === '"') quoted = !quoted;
    if (line[index] === ':' && !quoted) return index;
  }
  return -1;
}

function unquoteParameterValue(value: string): string {
  if (value.startsWith('"') || value.endsWith('"')) {
    if (
      value.length < 2 ||
      !value.startsWith('"') ||
      !value.endsWith('"') ||
      value.slice(1, -1).includes('"')
    ) {
      throw new Error('Malformed event time parameter');
    }
    return value.slice(1, -1);
  }
  if (value.includes('"')) throw new Error('Malformed event time parameter');
  return value;
}

function isValidTimezoneId(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 255 &&
    value.trim() === value &&
    !Array.from(value).some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 0x1f || code === 0x7f;
    })
  );
}

function isValidDate(year: number, month: number, day: number): boolean {
  if (year < 1 || month < 1 || month > 12) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthLengths = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return day >= 1 && day <= monthLengths[month - 1];
}
