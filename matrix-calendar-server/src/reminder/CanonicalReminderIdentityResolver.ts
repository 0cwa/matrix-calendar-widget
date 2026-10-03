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
import type { RoomReminderConfiguration } from './RoomReminderStore';

/** The identity that keys reminder metadata, without delivery-specific data. */
export type CanonicalReminderIdentity = Pick<
  RoomReminderConfiguration,
  'calendarId' | 'eventUid' | 'recurrenceId' | 'alarmUid'
>;

/** CalDAV resource bytes and the collection from which they were fetched. */
export type CanonicalReminderResourceData = {
  calendarId: string;
  icalendar: string;
};

export type CanonicalReminderResolution = {
  resolved: true;
  identity: CanonicalReminderIdentity;
};

export type CanonicalReminderResolutionErrorCode =
  | 'invalid-calendar'
  | 'event-not-found'
  | 'recurrence-not-found'
  | 'alarm-not-found'
  | 'ambiguous-event'
  | 'ambiguous-recurrence'
  | 'ambiguous-alarm'
  | 'invalid-event-identity'
  | 'invalid-alarm-identity';

/** Safe failure; messages and codes never include iCalendar property values. */
export class CanonicalReminderResolutionError extends Error {
  constructor(public readonly code: CanonicalReminderResolutionErrorCode) {
    super(`Reminder identity could not be resolved (${code})`);
    this.name = 'CanonicalReminderResolutionError';
  }
}

/**
 * Confirms an inert reminder identity against one already-fetched CalDAV
 * resource. This function performs no I/O and returns no calendar content.
 * A VALARM without a stable UID cannot be selected and therefore fails closed.
 */
export function resolveCanonicalReminderIdentity(
  identity: CanonicalReminderIdentity,
  resource: CanonicalReminderResourceData,
): CanonicalReminderResolution {
  if (
    !isValidCalendarId(identity.calendarId) ||
    !isValidCalendarId(resource.calendarId) ||
    identity.calendarId !== resource.calendarId
  ) {
    throw new CanonicalReminderResolutionError('invalid-calendar');
  }
  if (!isValidIdentity(identity.eventUid)) {
    throw new CanonicalReminderResolutionError('invalid-event-identity');
  }
  if (!isValidIdentity(identity.alarmUid)) {
    throw new CanonicalReminderResolutionError('invalid-alarm-identity');
  }

  let calendar: ICAL.Component;
  try {
    calendar = ICAL.Component.fromString(resource.icalendar);
  } catch {
    throw new CanonicalReminderResolutionError('invalid-calendar');
  }
  if (calendar.name !== 'vcalendar') {
    throw new CanonicalReminderResolutionError('invalid-calendar');
  }

  const events = calendar.getAllSubcomponents('vevent');
  let recurrenceIdLines: string[][];
  try {
    recurrenceIdLines = readRawRecurrenceIds(resource.icalendar);
  } catch {
    throw new CanonicalReminderResolutionError('invalid-event-identity');
  }
  if (recurrenceIdLines.length !== events.length) {
    throw new CanonicalReminderResolutionError('invalid-event-identity');
  }

  const matchingEvents: EventWithRecurrenceSource[] = [];
  for (const [index, event] of events.entries()) {
    const recurrenceIds = event.getAllProperties('recurrence-id');
    if (recurrenceIds.length !== recurrenceIdLines[index].length) {
      throw new CanonicalReminderResolutionError('invalid-event-identity');
    }
    const uid = readEventUid(event);
    if (!uid) {
      throw new CanonicalReminderResolutionError('invalid-event-identity');
    }
    if (uid === identity.eventUid) {
      matchingEvents.push({
        event,
        recurrenceIdLines: recurrenceIdLines[index],
      });
    }
  }
  if (matchingEvents.length === 0) {
    throw new CanonicalReminderResolutionError('event-not-found');
  }

  const event = selectEvent(matchingEvents, identity.recurrenceId);
  if (!selectDisplayAlarm(event, identity.alarmUid)) {
    throw new CanonicalReminderResolutionError('alarm-not-found');
  }

  return {
    resolved: true,
    identity: {
      calendarId: identity.calendarId,
      eventUid: identity.eventUid,
      recurrenceId: identity.recurrenceId,
      alarmUid: identity.alarmUid,
    },
  };
}

function readEventUid(event: ICAL.Component): string | undefined {
  const properties = event.getAllProperties('uid');
  if (properties.length !== 1) return undefined;
  const value = properties[0].getFirstValue();
  return typeof value === 'string' && isValidIdentity(value)
    ? value
    : undefined;
}

type EventWithRecurrenceSource = {
  event: ICAL.Component;
  recurrenceIdLines: string[];
};

function selectEvent(
  events: EventWithRecurrenceSource[],
  recurrenceId: string | null,
): ICAL.Component {
  const matches: EventWithRecurrenceSource[] = [];
  for (const candidate of events) {
    const properties = candidate.event.getAllProperties('recurrence-id');
    if (properties.length > 1) {
      throw new CanonicalReminderResolutionError('invalid-event-identity');
    }
    if (properties.length === 0) {
      if (recurrenceId === null) matches.push(candidate);
      continue;
    }
    if (recurrenceId === null) continue;

    let key: string;
    try {
      key = recurrenceIdentityKey(
        properties[0],
        candidate.recurrenceIdLines[0],
      );
    } catch {
      throw new CanonicalReminderResolutionError('invalid-event-identity');
    }
    if (key === recurrenceId) matches.push(candidate);
  }

  if (matches.length === 0) {
    throw new CanonicalReminderResolutionError('recurrence-not-found');
  }
  if (matches.length > 1) {
    throw new CanonicalReminderResolutionError(
      recurrenceId === null ? 'ambiguous-event' : 'ambiguous-recurrence',
    );
  }
  return matches[0].event;
}

/**
 * Use a typed key so DATE, floating, UTC, and TZID recurrence identities can
 * never alias one another. The string format is the tuple stored in reminder
 * metadata and accepted by the reminder-configuration contract.
 */
function recurrenceIdentityKey(
  property: ICAL.Property,
  rawLine: string,
): string {
  const raw = parseRawRecurrenceId(rawLine);
  if (raw.parameters.has('range')) {
    throw new Error('Unsupported recurrence identity');
  }
  const value = property.getFirstValue();
  if (!(value instanceof ICAL.Time)) {
    throw new Error('Unsupported recurrence identity');
  }

  const valueType = raw.parameters.get('value')?.toUpperCase();
  const tzid = raw.parameters.get('tzid');
  if (tzid !== undefined && property.getFirstParameter('tzid') !== tzid) {
    throw new Error('Invalid TZID recurrence identity');
  }

  const dateMatch = /^(\d{4})(\d{2})(\d{2})$/.exec(raw.value);
  if (dateMatch) {
    if (
      valueType !== 'DATE' ||
      tzid !== undefined ||
      !value.isDate ||
      !isValidDate(dateMatch[1], dateMatch[2], dateMatch[3])
    ) {
      throw new Error('Invalid DATE recurrence identity');
    }
    return JSON.stringify([
      'date',
      `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`,
    ]);
  }

  const dateTimeMatch =
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(raw.value);
  if (
    !dateTimeMatch ||
    valueType === 'DATE' ||
    (valueType !== undefined && valueType !== 'DATE-TIME') ||
    value.isDate ||
    !isValidDate(dateTimeMatch[1], dateTimeMatch[2], dateTimeMatch[3]) ||
    Number(dateTimeMatch[4]) > 23 ||
    Number(dateTimeMatch[5]) > 59 ||
    Number(dateTimeMatch[6]) > 60
  ) {
    throw new Error('Invalid DATE-TIME recurrence identity');
  }

  const hasUtcSuffix = dateTimeMatch[7] === 'Z';
  if (tzid !== undefined && hasUtcSuffix) {
    throw new Error('Invalid TZID recurrence identity');
  }

  const local = `${dateTimeMatch[1]}-${dateTimeMatch[2]}-${dateTimeMatch[3]}T${dateTimeMatch[4]}:${dateTimeMatch[5]}:${dateTimeMatch[6]}`;
  if (tzid !== undefined) {
    if (!isValidIdentity(tzid)) {
      throw new Error('Invalid TZID recurrence identity');
    }
    return JSON.stringify(['date-time', 'tzid', tzid, local]);
  }

  return JSON.stringify([
    'date-time',
    hasUtcSuffix ? 'utc' : 'floating',
    '',
    local,
  ]);
}

/**
 * Reads unfolded RECURRENCE-ID source lines in event order. The iCalendar
 * parser normalizes invalid dates and duplicate parameters, so the source
 * spelling must be checked before those normalized values can form a key.
 */
function readRawRecurrenceIds(icalendar: string): string[][] {
  const physicalLines = icalendar.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/);
  const lines: string[] = [];
  for (const line of physicalLines) {
    if (/^[ \t]/.test(line)) {
      if (lines.length === 0) throw new Error('Invalid folded line');
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  }

  const events: string[][] = [];
  const components: string[] = [];
  let rootSeen = false;
  for (const line of lines) {
    if (line.length === 0) continue;

    const begin = /^BEGIN:([A-Z0-9-]+)$/i.exec(line);
    if (begin) {
      const name = begin[1].toUpperCase();
      if (components.length === 0) {
        if (rootSeen || name !== 'VCALENDAR') {
          throw new Error('Invalid calendar components');
        }
        rootSeen = true;
      }
      if (name === 'VEVENT') {
        if (components.length !== 1 || components[0] !== 'VCALENDAR') {
          throw new Error('Invalid event nesting');
        }
        events.push([]);
      }
      components.push(name);
      continue;
    }

    const end = /^END:([A-Z0-9-]+)$/i.exec(line);
    if (end) {
      if (components.pop() !== end[1].toUpperCase()) {
        throw new Error('Invalid calendar components');
      }
      continue;
    }

    if (components[components.length - 1] === 'VEVENT') {
      const propertyName = readRawPropertyName(line);
      if (propertyName === 'RECURRENCE-ID') {
        events[events.length - 1].push(line);
      }
    }
  }

  if (!rootSeen || components.length !== 0) {
    throw new Error('Incomplete calendar components');
  }
  return events;
}

function readRawPropertyName(line: string): string | undefined {
  const colon = findContentLineColon(line);
  if (colon < 0) return undefined;
  const header = line.slice(0, colon);
  const parameterStart = header.indexOf(';');
  const rawName = parameterStart < 0 ? header : header.slice(0, parameterStart);
  const propertyName = rawName.split('.').pop();
  if (
    propertyName?.trim().toUpperCase() === 'RECURRENCE-ID' &&
    propertyName !== propertyName.trim()
  ) {
    throw new Error('Malformed recurrence property name');
  }
  return propertyName && /^[A-Z0-9-]+$/i.test(propertyName)
    ? propertyName.toUpperCase()
    : undefined;
}

function findContentLineColon(line: string): number {
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === '"') quoted = !quoted;
    if (line[index] === ':' && !quoted) return index;
  }
  return -1;
}

function parseRawRecurrenceId(rawLine: string): {
  value: string;
  parameters: Map<string, string>;
} {
  const colon = findContentLineColon(rawLine);
  if (colon < 0) throw new Error('Malformed recurrence identity');

  const header = rawLine.slice(0, colon);
  const sections = splitOutsideQuotes(header, ';');
  const rawName = sections.shift();
  if (!rawName || readRawPropertyName(`${rawName}:`) !== 'RECURRENCE-ID') {
    throw new Error('Malformed recurrence identity');
  }

  const knownParameters = new Map<string, string>();
  for (const section of sections) {
    const equals = section.indexOf('=');
    if (equals <= 0) throw new Error('Malformed recurrence parameter');
    const name = section.slice(0, equals).toLowerCase();
    if (!/^[a-z0-9-]+$/.test(name)) {
      throw new Error('Malformed recurrence parameter');
    }
    const rawValue = section.slice(equals + 1);
    if (rawValue.length === 0)
      throw new Error('Malformed recurrence parameter');
    if (!['tzid', 'value', 'range'].includes(name)) continue;
    if (knownParameters.has(name)) {
      throw new Error('Duplicate recurrence parameter');
    }

    const value = unquoteParameterValue(rawValue);
    if (value.length === 0 || (name !== 'tzid' && value.includes(','))) {
      throw new Error('Malformed recurrence parameter');
    }
    knownParameters.set(name, value);
  }

  return { value: rawLine.slice(colon + 1), parameters: knownParameters };
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

function unquoteParameterValue(value: string): string {
  if (value.startsWith('"') || value.endsWith('"')) {
    if (
      value.length < 2 ||
      !value.startsWith('"') ||
      !value.endsWith('"') ||
      value.slice(1, -1).includes('"')
    ) {
      throw new Error('Malformed quoted parameter');
    }
    return value.slice(1, -1);
  }
  if (value.includes('"')) throw new Error('Malformed quoted parameter');
  return value;
}

function isValidDate(year: string, month: string, day: string): boolean {
  const numericYear = Number(year);
  const numericMonth = Number(month);
  const numericDay = Number(day);
  if (numericYear < 1 || numericMonth < 1 || numericMonth > 12) return false;

  const leapYear =
    numericYear % 4 === 0 &&
    (numericYear % 100 !== 0 || numericYear % 400 === 0);
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
  return numericDay >= 1 && numericDay <= monthLengths[numericMonth - 1];
}

function selectDisplayAlarm(
  event: ICAL.Component,
  alarmUid: string,
): ICAL.Component | undefined {
  const matches: ICAL.Component[] = [];
  const seenUids = new Set<string>();
  for (const alarm of event.getAllSubcomponents('valarm')) {
    const uids = alarm.getAllProperties('uid');
    // Legacy alarms without a stable identity remain valid but unselectable.
    if (uids.length === 0) continue;
    if (uids.length !== 1) {
      throw new CanonicalReminderResolutionError('invalid-alarm-identity');
    }

    const uid = uids[0].getFirstValue();
    if (typeof uid !== 'string' || !isValidIdentity(uid)) {
      throw new CanonicalReminderResolutionError('invalid-alarm-identity');
    }
    if (seenUids.has(uid)) {
      throw new CanonicalReminderResolutionError('ambiguous-alarm');
    }
    seenUids.add(uid);

    const actions = alarm.getAllProperties('action');
    if (
      actions.length === 1 &&
      String(actions[0].getFirstValue()).toUpperCase() === 'DISPLAY' &&
      uid === alarmUid
    ) {
      matches.push(alarm);
    }
  }
  if (matches.length > 1) {
    throw new CanonicalReminderResolutionError('ambiguous-alarm');
  }
  return matches[0];
}

function isValidIdentity(value: string): boolean {
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

function isValidCalendarId(value: string): boolean {
  return (
    value.length > 0 &&
    value.trim() === value &&
    !Array.from(value).some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 0x1f || code === 0x7f;
    })
  );
}
