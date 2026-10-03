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

import type { CalendarEventDateTime } from '@matrix-calendar-widget/calendar';
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

/**
 * Internal canonical source selection. This is intentionally not re-exported
 * from the reminder barrel: only server-side validation needs the selected
 * components and raw VALARM text, and they must never enter an HTTP DTO.
 */
export type CanonicalReminderResourceSelection = {
  identity: CanonicalReminderIdentity;
  calendar: ICAL.Component;
  event: ICAL.Component;
  alarm: ICAL.Component;
  alarmSource: string;
  dateTimeLines: readonly string[];
  recurrenceIdLines: readonly string[];
  recurrenceDateLines: readonly string[];
  relatedRecurrenceIdentities: readonly string[];
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

const MAX_REMINDER_RESOURCE_COMPONENTS = 1024;
const MAX_REMINDER_RESOURCE_PROPERTIES = 4096;
const MAX_REMINDER_RESOURCE_ALARMS = 64;
const MAX_REMINDER_RESOURCE_PHYSICAL_LINES = 8192;

/**
 * Confirms an inert reminder identity against one already-fetched CalDAV
 * resource. This function performs no I/O and returns no calendar content.
 * A VALARM without a stable UID cannot be selected and therefore fails closed.
 */
export function resolveCanonicalReminderIdentity(
  identity: CanonicalReminderIdentity,
  resource: CanonicalReminderResourceData,
): CanonicalReminderResolution {
  const selection = selectCanonicalReminderResource(identity, resource);

  return {
    resolved: true,
    identity: selection.identity,
  };
}

/**
 * Resolve the event in one resource from its recurrence and alarm identities,
 * then return its source components for internal trigger validation. The
 * caller cannot choose an event UID; a match across multiple event UIDs fails
 * closed.
 */
export function resolveCanonicalReminderResourceSelection(
  identity: Pick<
    CanonicalReminderIdentity,
    'calendarId' | 'recurrenceId' | 'alarmUid'
  > & { eventUid?: string },
  resource: CanonicalReminderResourceData,
): CanonicalReminderResourceSelection {
  return selectCanonicalReminderResource(identity, resource);
}

/**
 * Enumerate stable DISPLAY-alarm identities from one prepared resource. The
 * result is an internal server-only selection containing parsed components and
 * raw source; callers must project it before returning or logging anything.
 * Unsupported or ambiguous candidates are omitted. Resource parse failures or
 * safety-limit overflows reject the whole enumeration so callers never receive
 * a partial option list.
 */
export function enumerateCanonicalReminderResourceSelections(
  resource: CanonicalReminderResourceData,
): CanonicalReminderResourceSelection[] {
  const prepared = prepareCanonicalReminderResource(resource);
  const selections: CanonicalReminderResourceSelection[] = [];

  for (const [eventUid, group] of prepared.eventsByUid) {
    if (group.hasInvalidRecurrenceIdentity) continue;
    for (const candidate of group.candidates) {
      const recurrenceId = candidate.recurrenceIdentity;
      if (recurrenceId === undefined) continue;

      for (const [alarmUid, candidateAlarm] of candidate.displayAlarmsByUid) {
        try {
          const selection = selectCanonicalReminderResourceFromPrepared(
            {
              calendarId: resource.calendarId,
              eventUid,
              recurrenceId,
              alarmUid,
            },
            prepared,
          );
          if (
            selection.event === candidate.event &&
            selection.alarm === candidateAlarm.component &&
            selection.alarmSource ===
              candidate.alarmSources[candidateAlarm.index]
          ) {
            selections.push(selection);
          }
        } catch {
          // A malformed, duplicate, or resource-colliding identity is not a
          // selectable option. Other independently valid alarms may remain.
        }
      }
    }
  }

  return selections;
}

function selectCanonicalReminderResource(
  identity: Pick<
    CanonicalReminderIdentity,
    'calendarId' | 'recurrenceId' | 'alarmUid'
  > & { eventUid?: string },
  resource: CanonicalReminderResourceData,
): CanonicalReminderResourceSelection {
  if (
    !isValidCalendarId(identity.calendarId) ||
    !isValidCalendarId(resource.calendarId) ||
    identity.calendarId !== resource.calendarId
  ) {
    throw new CanonicalReminderResolutionError('invalid-calendar');
  }
  if (identity.eventUid !== undefined && !isValidIdentity(identity.eventUid)) {
    throw new CanonicalReminderResolutionError('invalid-event-identity');
  }
  if (!isValidIdentity(identity.alarmUid)) {
    throw new CanonicalReminderResolutionError('invalid-alarm-identity');
  }

  return selectCanonicalReminderResourceFromPrepared(
    identity,
    prepareCanonicalReminderResource(resource),
  );
}

type PreparedCanonicalReminderResource = {
  calendarId: string;
  calendar: ICAL.Component;
  eventsByUid: Map<string, EventGroup>;
  componentUidValues: ReadonlySet<string>;
  alarmsByUid: ReadonlyMap<string, readonly ICAL.Component[]>;
};

function prepareCanonicalReminderResource(
  resource: CanonicalReminderResourceData,
): PreparedCanonicalReminderResource {
  if (!isValidCalendarId(resource.calendarId)) {
    throw new CanonicalReminderResolutionError('invalid-calendar');
  }

  let rawSource: RawCalendarSource;
  try {
    rawSource = readRawEventSources(resource.icalendar);
  } catch {
    throw new CanonicalReminderResolutionError('invalid-event-identity');
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
  if (rawSource.events.length !== events.length) {
    throw new CanonicalReminderResolutionError('invalid-event-identity');
  }

  const eventsByUid = new Map<string, EventGroup>();
  for (const [index, event] of events.entries()) {
    const eventSource = rawSource.events[index];
    const recurrenceIds = event.getAllProperties('recurrence-id');
    if (
      recurrenceIds.length !== eventSource.recurrenceIdLines.length ||
      event.getAllProperties('rdate').length !==
        eventSource.recurrenceDateLines.length ||
      event.getAllSubcomponents('valarm').length !==
        eventSource.alarmSources.length
    ) {
      throw new CanonicalReminderResolutionError('invalid-event-identity');
    }
    const uid = readEventUid(event);
    if (!uid) {
      throw new CanonicalReminderResolutionError('invalid-event-identity');
    }

    let recurrenceIdentity: string | null | undefined = null;
    if (recurrenceIds.length > 1) {
      recurrenceIdentity = undefined;
    } else if (recurrenceIds.length === 1) {
      const rawLine = eventSource.recurrenceIdLines[0];
      if (rawLine) {
        try {
          recurrenceIdentity = encodeCanonicalReminderRecurrenceIdentity(
            recurrenceIds[0],
            rawLine,
          );
        } catch {
          recurrenceIdentity = undefined;
        }
      } else {
        recurrenceIdentity = undefined;
      }
    }

    const alarms = event.getAllSubcomponents('valarm');
    const displayAlarmsByUid = new Map<
      string,
      { component: ICAL.Component; index: number }
    >();
    const seenAlarmUids = new Set<string>();
    let alarmIdentityError: 'invalid' | 'ambiguous' | undefined;
    for (const [alarmIndex, alarm] of alarms.entries()) {
      const uidProperties = alarm.getAllProperties('uid');
      if (uidProperties.length === 0) continue;
      if (uidProperties.length !== 1) {
        alarmIdentityError = 'invalid';
        break;
      }

      const alarmUid = uidProperties[0].getFirstValue();
      if (typeof alarmUid !== 'string' || !isValidIdentity(alarmUid)) {
        alarmIdentityError = 'invalid';
        break;
      }
      if (seenAlarmUids.has(alarmUid)) {
        alarmIdentityError = 'ambiguous';
        break;
      }
      seenAlarmUids.add(alarmUid);

      const actions = alarm.getAllProperties('action');
      if (
        actions.length === 1 &&
        String(actions[0].getFirstValue()).toUpperCase() === 'DISPLAY'
      ) {
        displayAlarmsByUid.set(alarmUid, {
          component: alarm,
          index: alarmIndex,
        });
      }
    }

    const candidate: EventWithRecurrenceSource = {
      event,
      recurrenceIdLines: eventSource.recurrenceIdLines,
      recurrenceDateLines: eventSource.recurrenceDateLines,
      alarmSources: eventSource.alarmSources,
      dateTimeLines: eventSource.dateTimeLines,
      recurrenceIdentity,
      displayAlarmsByUid,
      alarmIdentityError,
    };
    const group = eventsByUid.get(uid) ?? {
      candidates: [],
      candidatesByRecurrenceId: new Map<
        string | null,
        EventWithRecurrenceSource[]
      >(),
      relatedRecurrenceIdentities: [],
      hasInvalidRecurrenceIdentity: false,
    };
    group.candidates.push(candidate);
    if (recurrenceIdentity === undefined) {
      group.hasInvalidRecurrenceIdentity = true;
    } else {
      const matchingCandidates =
        group.candidatesByRecurrenceId.get(recurrenceIdentity) ?? [];
      matchingCandidates.push(candidate);
      group.candidatesByRecurrenceId.set(
        recurrenceIdentity,
        matchingCandidates,
      );
      if (recurrenceIdentity !== null) {
        group.relatedRecurrenceIdentities.push(recurrenceIdentity);
      }
    }
    eventsByUid.set(uid, group);
  }

  const componentUidValues = new Set<string>();
  const alarmsByUid = new Map<string, ICAL.Component[]>();
  const relevantComponents = new Set([
    'vevent',
    'vtodo',
    'vjournal',
    'vfreebusy',
  ]);
  const pendingComponents = [...calendar.getAllSubcomponents()];
  while (pendingComponents.length > 0) {
    const component = pendingComponents.pop();
    if (!component) continue;
    pendingComponents.push(...component.getAllSubcomponents());

    if (relevantComponents.has(component.name)) {
      for (const property of component.getAllProperties('uid')) {
        const value = property.getFirstValue();
        if (typeof value === 'string') componentUidValues.add(value);
      }
    }

    if (component.name === 'valarm') {
      for (const property of component.getAllProperties('uid')) {
        const value = property.getFirstValue();
        if (typeof value === 'string') {
          const matchingAlarms = alarmsByUid.get(value) ?? [];
          matchingAlarms.push(component);
          alarmsByUid.set(value, matchingAlarms);
        }
      }
    }
  }

  return {
    calendarId: resource.calendarId,
    calendar,
    eventsByUid,
    componentUidValues,
    alarmsByUid,
  };
}

function selectCanonicalReminderResourceFromPrepared(
  identity: Pick<
    CanonicalReminderIdentity,
    'calendarId' | 'recurrenceId' | 'alarmUid'
  > & { eventUid?: string },
  prepared: PreparedCanonicalReminderResource,
): CanonicalReminderResourceSelection {
  if (
    !isValidCalendarId(identity.calendarId) ||
    identity.calendarId !== prepared.calendarId
  ) {
    throw new CanonicalReminderResolutionError('invalid-calendar');
  }
  if (identity.eventUid !== undefined && !isValidIdentity(identity.eventUid)) {
    throw new CanonicalReminderResolutionError('invalid-event-identity');
  }
  if (!isValidIdentity(identity.alarmUid)) {
    throw new CanonicalReminderResolutionError('invalid-alarm-identity');
  }

  if (prepared.eventsByUid.size === 0) {
    throw new CanonicalReminderResolutionError('event-not-found');
  }
  if (
    identity.eventUid !== undefined &&
    !prepared.eventsByUid.has(identity.eventUid)
  ) {
    throw new CanonicalReminderResolutionError('event-not-found');
  }

  let eventUid: string | undefined = identity.eventUid;
  let selectedEvent: EventWithRecurrenceSource | undefined;
  let selectedAlarm: { component: ICAL.Component; index: number } | undefined;
  let relatedRecurrenceIdentities: string[] = [];
  let recurrenceFound = false;
  const candidateUids =
    identity.eventUid === undefined
      ? [...prepared.eventsByUid.keys()]
      : [identity.eventUid];

  for (const candidateUid of candidateUids) {
    const group = prepared.eventsByUid.get(candidateUid);
    if (!group || group.candidates.length === 0) continue;

    let candidateEvent: EventWithRecurrenceSource;
    try {
      candidateEvent = selectEvent(group, identity.recurrenceId);
    } catch (error) {
      if (
        identity.eventUid === undefined &&
        error instanceof CanonicalReminderResolutionError &&
        error.code === 'recurrence-not-found'
      ) {
        continue;
      }
      throw error;
    }
    recurrenceFound = true;

    const candidateAlarm = selectDisplayAlarm(
      candidateEvent,
      identity.alarmUid,
    );
    if (!candidateAlarm) continue;
    assertAlarmUidIsUniqueAcrossResource(
      prepared,
      identity.alarmUid,
      candidateAlarm.component,
    );
    if (selectedEvent !== undefined) {
      throw new CanonicalReminderResolutionError('ambiguous-event');
    }
    eventUid = candidateUid;
    selectedEvent = candidateEvent;
    selectedAlarm = candidateAlarm;
    relatedRecurrenceIdentities = group.relatedRecurrenceIdentities;
  }

  if (!recurrenceFound) {
    throw new CanonicalReminderResolutionError('recurrence-not-found');
  }
  if (!selectedEvent || !selectedAlarm || !eventUid) {
    throw new CanonicalReminderResolutionError('alarm-not-found');
  }

  const alarmSource = selectedEvent.alarmSources[selectedAlarm.index];
  if (alarmSource === undefined) {
    throw new CanonicalReminderResolutionError('invalid-alarm-identity');
  }

  return {
    identity: {
      calendarId: identity.calendarId,
      eventUid,
      recurrenceId: identity.recurrenceId,
      alarmUid: identity.alarmUid,
    },
    calendar: prepared.calendar,
    event: selectedEvent.event,
    alarm: selectedAlarm.component,
    alarmSource,
    dateTimeLines: selectedEvent.dateTimeLines,
    recurrenceIdLines: selectedEvent.recurrenceIdLines,
    recurrenceDateLines: selectedEvent.recurrenceDateLines,
    relatedRecurrenceIdentities,
  };
}

function assertAlarmUidIsUniqueAcrossResource(
  prepared: PreparedCanonicalReminderResource,
  alarmUid: string,
  selectedAlarm: ICAL.Component,
): void {
  if (prepared.componentUidValues.has(alarmUid)) {
    throw new CanonicalReminderResolutionError('invalid-alarm-identity');
  }
  if (
    prepared.alarmsByUid.get(alarmUid)?.some((alarm) => alarm !== selectedAlarm)
  ) {
    throw new CanonicalReminderResolutionError('ambiguous-alarm');
  }
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
  recurrenceDateLines: string[];
  alarmSources: string[];
  dateTimeLines: string[];
  recurrenceIdentity: string | null | undefined;
  displayAlarmsByUid: Map<string, { component: ICAL.Component; index: number }>;
  alarmIdentityError: 'invalid' | 'ambiguous' | undefined;
};

type EventGroup = {
  candidates: EventWithRecurrenceSource[];
  candidatesByRecurrenceId: Map<string | null, EventWithRecurrenceSource[]>;
  relatedRecurrenceIdentities: string[];
  hasInvalidRecurrenceIdentity: boolean;
};

type RawEventSource = {
  recurrenceIdLines: string[];
  recurrenceDateLines: string[];
  alarmSources: string[];
  dateTimeLines: string[];
};

type RawCalendarSource = {
  events: RawEventSource[];
  componentCount: number;
  propertyCount: number;
  alarmCount: number;
};

function selectEvent(
  group: EventGroup,
  recurrenceId: string | null,
): EventWithRecurrenceSource {
  if (group.hasInvalidRecurrenceIdentity) {
    throw new CanonicalReminderResolutionError('invalid-event-identity');
  }
  const matches = group.candidatesByRecurrenceId.get(recurrenceId) ?? [];

  if (matches.length === 0) {
    throw new CanonicalReminderResolutionError('recurrence-not-found');
  }
  if (matches.length > 1) {
    throw new CanonicalReminderResolutionError(
      recurrenceId === null ? 'ambiguous-event' : 'ambiguous-recurrence',
    );
  }
  return matches[0];
}

/**
 * Use a typed key so DATE, floating, UTC, and TZID recurrence identities can
 * never alias one another. The string format is the tuple stored in reminder
 * metadata and accepted by the reminder-configuration contract.
 */
/**
 * Encode a typed recurrence identity from both its parsed property and raw
 * content line. Scheduler firing keys must retain distinctions such as UTC
 * `Z` versus an explicit `TZID=UTC` that projection may erase.
 */
export function encodeCanonicalReminderRecurrenceIdentity(
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
 * Encode the actual occurrence identity from projection plus canonical source
 * typing. Projected DTOs intentionally collapse UTC `Z` and `TZID=UTC`; raw
 * override and RDATE values restore that distinction for durable firing keys.
 */
export function encodeCanonicalReminderFiringRecurrenceIdentity(
  selection: Pick<
    CanonicalReminderResourceSelection,
    | 'identity'
    | 'event'
    | 'dateTimeLines'
    | 'recurrenceIdLines'
    | 'recurrenceDateLines'
    | 'relatedRecurrenceIdentities'
  >,
  projectedRecurrenceId?: CalendarEventDateTime,
): string {
  if (selection.identity.recurrenceId !== null) {
    const property = selection.event.getFirstProperty('recurrence-id');
    const rawLine = selection.recurrenceIdLines[0];
    if (!property || !rawLine || selection.recurrenceIdLines.length !== 1) {
      throw new Error('Invalid selected recurrence identity');
    }
    const canonical = encodeCanonicalReminderRecurrenceIdentity(
      property,
      rawLine,
    );
    if (
      canonical !== selection.identity.recurrenceId ||
      (projectedRecurrenceId !== undefined &&
        !projectedRecurrenceMatches(canonical, projectedRecurrenceId))
    ) {
      throw new Error('Projected recurrence identity does not match source');
    }
    return canonical;
  }

  const startProperty = selection.event.getFirstProperty('dtstart');
  const startLine = selection.dateTimeLines.find(
    (line) => readRawPropertyName(line) === 'DTSTART',
  );
  if (!startProperty || !startLine) {
    throw new Error('Missing canonical DTSTART source');
  }

  if (projectedRecurrenceId === undefined) {
    if (
      selection.event.getAllProperties('rrule').length > 0 ||
      selection.recurrenceDateLines.length > 0 ||
      selection.relatedRecurrenceIdentities.length > 0
    ) {
      throw new Error('Recurring event has no projected recurrence identity');
    }
    return encodeCanonicalReminderRecurrenceIdentity(
      startProperty,
      replaceRawPropertyName(startLine, 'RECURRENCE-ID'),
    );
  }

  const overrideMatches = selection.relatedRecurrenceIdentities.filter(
    (identity) => projectedRecurrenceMatches(identity, projectedRecurrenceId),
  );
  if (overrideMatches.length > 0) {
    return uniqueRecurrenceIdentity(overrideMatches);
  }

  const rdateMatches = selection.recurrenceDateLines.flatMap((line) =>
    parseRawRdateIdentities(line).filter((identity) =>
      projectedRecurrenceMatches(identity, projectedRecurrenceId),
    ),
  );
  if (rdateMatches.length > 0) {
    return uniqueRecurrenceIdentity(rdateMatches);
  }

  const startIdentity = encodeCanonicalReminderRecurrenceIdentity(
    startProperty,
    replaceRawPropertyName(startLine, 'RECURRENCE-ID'),
  );
  if (
    !projectedRecurrenceMatchesSourceTyping(
      startIdentity,
      projectedRecurrenceId,
    )
  ) {
    throw new Error('Projected recurrence identity has different typing');
  }
  return encodeProjectedRecurrenceIdentity(
    projectedRecurrenceId,
    startIdentity,
  );
}

function projectedRecurrenceMatchesSourceTyping(
  identity: string,
  projected: CalendarEventDateTime,
): boolean {
  let tuple: unknown;
  try {
    tuple = JSON.parse(identity);
  } catch {
    return false;
  }
  if (!Array.isArray(tuple)) return false;

  if (projected.type === 'date') return tuple[0] === 'date';
  if (projected.type === 'floating-date-time') {
    return tuple[0] === 'date-time' && tuple[1] === 'floating';
  }

  const { timezone } = projected.value;
  return (
    tuple[0] === 'date-time' &&
    ((tuple[1] === 'utc' && timezone === 'UTC') ||
      (tuple[1] === 'tzid' && tuple[2] === timezone))
  );
}

function uniqueRecurrenceIdentity(identities: readonly string[]): string {
  const unique = [...new Set(identities)];
  if (unique.length !== 1) {
    throw new Error('Ambiguous recurrence identity source');
  }
  return unique[0];
}

function projectedRecurrenceMatches(
  identity: string,
  projected: CalendarEventDateTime,
): boolean {
  let tuple: unknown;
  try {
    tuple = JSON.parse(identity);
  } catch {
    return false;
  }
  if (!Array.isArray(tuple)) return false;

  if (projected.type === 'date') {
    return tuple[0] === 'date' && tuple[1] === projected.value;
  }
  if (projected.type === 'floating-date-time') {
    return (
      tuple[0] === 'date-time' &&
      tuple[1] === 'floating' &&
      tuple[3] === projected.value
    );
  }

  const { local, timezone } = projected.value;
  return (
    tuple[0] === 'date-time' &&
    tuple[3] === local &&
    ((tuple[1] === 'utc' && timezone === 'UTC') ||
      (tuple[1] === 'tzid' && tuple[2] === timezone))
  );
}

function encodeProjectedRecurrenceIdentity(
  projected: CalendarEventDateTime,
  sourceIdentity: string,
): string {
  if (projected.type !== 'date-time') {
    throw new Error('Only zoned DATE-TIME recurrence is supported');
  }
  const source = JSON.parse(sourceIdentity) as unknown[];
  const local = projected.value.local;
  if (!isValidLocalDateTime(local)) {
    throw new Error('Invalid projected recurrence value');
  }
  if (source[1] === 'utc') {
    return JSON.stringify(['date-time', 'utc', '', local]);
  }
  if (source[1] === 'tzid' && typeof source[2] === 'string') {
    return JSON.stringify(['date-time', 'tzid', source[2], local]);
  }
  throw new Error('Unsupported recurrence source timezone');
}

function isValidLocalDateTime(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(value);
  return Boolean(
    match &&
    isValidDate(match[1], match[2], match[3]) &&
    Number(match[4]) <= 23 &&
    Number(match[5]) <= 59 &&
    Number(match[6]) <= 59,
  );
}

function replaceRawPropertyName(line: string, nextName: string): string {
  const colon = findContentLineColon(line);
  if (colon < 0) throw new Error('Invalid canonical property source');
  const header = line.slice(0, colon);
  const parameterStart = header.indexOf(';');
  const rawName = parameterStart < 0 ? header : header.slice(0, parameterStart);
  const propertyName = rawName.split('.').pop();
  if (propertyName?.toUpperCase() !== 'DTSTART') {
    throw new Error('Invalid canonical DTSTART source');
  }
  const replacement = rawName.replace(/(^|\.)DTSTART$/i, `$1${nextName}`);
  return `${replacement}${header.slice(rawName.length)}:${line.slice(colon + 1)}`;
}

function parseRawRdateIdentities(line: string): string[] {
  const colon = findContentLineColon(line);
  if (colon < 0) throw new Error('Invalid RDATE source');
  const header = line.slice(0, colon);
  const sections = splitOutsideQuotes(header, ';');
  const rawName = sections.shift();
  if (!rawName || readRawPropertyName(`${rawName}:`) !== 'RDATE') {
    throw new Error('Invalid RDATE source');
  }

  const parameters = new Map<string, string>();
  for (const section of sections) {
    const equals = section.indexOf('=');
    if (equals <= 0) throw new Error('Invalid RDATE parameter');
    const name = section.slice(0, equals).toUpperCase();
    const rawValue = section.slice(equals + 1);
    if (
      !['TZID', 'VALUE'].includes(name) ||
      rawValue.length === 0 ||
      parameters.has(name)
    ) {
      throw new Error('Unsupported RDATE parameter');
    }
    parameters.set(name, unquoteParameterValue(rawValue));
  }

  const valueType = parameters.get('VALUE')?.toUpperCase();
  if (valueType !== undefined && !['DATE-TIME', 'PERIOD'].includes(valueType)) {
    throw new Error('Unsupported RDATE value type');
  }

  return splitOutsideQuotes(line.slice(colon + 1), ',').map((entry) => {
    let rawValue = entry;
    if (valueType === 'PERIOD') {
      const period = entry.split('/');
      if (period.length !== 2 || period.some((part) => part.length === 0)) {
        throw new Error('Invalid RDATE period');
      }
      rawValue = period[0];
    } else if (entry.includes('/')) {
      throw new Error('Unexpected RDATE period');
    }

    const recurrenceHeader = [
      rawName.replace(/(^|\.)RDATE$/i, '$1RECURRENCE-ID'),
      ...sections.filter(
        (section) =>
          section.slice(0, section.indexOf('=')).toUpperCase() !== 'VALUE',
      ),
      ...(valueType ? ['VALUE=DATE-TIME'] : []),
    ].join(';');
    const recurrenceLine = `${recurrenceHeader}:${rawValue}`;
    const property = ICAL.Property.fromString(recurrenceLine);
    return encodeCanonicalReminderRecurrenceIdentity(property, recurrenceLine);
  });
}

/**
 * Reads unfolded identity, timing, and VALARM source lines in event order.
 * The iCalendar parser normalizes malformed dates and duplicate parameters,
 * so source spelling must be checked before values form canonical keys or
 * trigger calculations.
 */
function readRawEventSources(icalendar: string): RawCalendarSource {
  if (typeof icalendar !== 'string') throw new Error('Invalid calendar source');

  let physicalLineCount = 1;
  for (let index = 0; index < icalendar.length; index += 1) {
    const character = icalendar[index];
    if (character === '\r') {
      physicalLineCount += 1;
      if (icalendar[index + 1] === '\n') index += 1;
    } else if (character === '\n') {
      physicalLineCount += 1;
    }
    if (physicalLineCount > MAX_REMINDER_RESOURCE_PHYSICAL_LINES) {
      throw new Error('Too many source lines');
    }
  }

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

  const events: RawEventSource[] = [];
  const components: string[] = [];
  let rootSeen = false;
  let currentEvent: RawEventSource | undefined;
  let currentAlarmLines: string[] | undefined;
  let componentCount = 0;
  let propertyCount = 0;
  let alarmCount = 0;
  for (const line of lines) {
    if (line.length === 0) continue;

    const begin = /^BEGIN:([A-Z0-9-]+)$/i.exec(line);
    if (begin) {
      const name = begin[1].toUpperCase();
      componentCount += 1;
      if (componentCount > MAX_REMINDER_RESOURCE_COMPONENTS) {
        throw new Error('Too many source components');
      }
      if (name === 'VALARM') {
        alarmCount += 1;
        if (alarmCount > MAX_REMINDER_RESOURCE_ALARMS) {
          throw new Error('Too many alarms');
        }
      }
      if (components.length === 0) {
        if (rootSeen || name !== 'VCALENDAR') {
          throw new Error('Invalid calendar components');
        }
        rootSeen = true;
      }
      if (name === 'VEVENT') {
        if (
          components.length !== 1 ||
          components[0] !== 'VCALENDAR' ||
          currentEvent !== undefined
        ) {
          throw new Error('Invalid event nesting');
        }
        currentEvent = {
          recurrenceIdLines: [],
          recurrenceDateLines: [],
          alarmSources: [],
          dateTimeLines: [],
        };
        events.push(currentEvent);
      }
      if (currentAlarmLines !== undefined) {
        currentAlarmLines.push(line);
      } else if (
        name === 'VALARM' &&
        components.length === 2 &&
        components[0] === 'VCALENDAR' &&
        components[1] === 'VEVENT' &&
        currentEvent !== undefined
      ) {
        currentAlarmLines = [line];
      }
      components.push(name);
      continue;
    }

    const end = /^END:([A-Z0-9-]+)$/i.exec(line);
    if (end) {
      const name = end[1].toUpperCase();
      if (currentAlarmLines !== undefined) {
        currentAlarmLines.push(line);
        if (name === 'VALARM') {
          if (components.at(-1) !== 'VALARM' || currentEvent === undefined) {
            throw new Error('Invalid alarm nesting');
          }
          currentEvent.alarmSources.push(currentAlarmLines.join('\r\n'));
          currentAlarmLines = undefined;
        }
      }
      if (components.pop() !== name) {
        throw new Error('Invalid calendar components');
      }
      if (name === 'VEVENT') currentEvent = undefined;
      continue;
    }

    propertyCount += 1;
    if (propertyCount > MAX_REMINDER_RESOURCE_PROPERTIES) {
      throw new Error('Too many source properties');
    }
    if (components[components.length - 1] === 'VEVENT') {
      const propertyName = readRawPropertyName(line);
      if (propertyName === 'RECURRENCE-ID') {
        if (currentEvent === undefined) {
          throw new Error('Invalid event nesting');
        }
        currentEvent.recurrenceIdLines.push(line);
      }
      if (propertyName === 'RDATE') {
        if (currentEvent === undefined) {
          throw new Error('Invalid event nesting');
        }
        currentEvent.recurrenceDateLines.push(line);
      }
      if (propertyName === 'DTSTART' || propertyName === 'DTEND') {
        if (currentEvent === undefined) {
          throw new Error('Invalid event nesting');
        }
        currentEvent.dateTimeLines.push(line);
      }
    }
    if (currentAlarmLines !== undefined) currentAlarmLines.push(line);
  }

  if (
    !rootSeen ||
    components.length !== 0 ||
    currentEvent !== undefined ||
    currentAlarmLines !== undefined
  ) {
    throw new Error('Incomplete calendar components');
  }
  return { events, componentCount, propertyCount, alarmCount };
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
  event: EventWithRecurrenceSource,
  alarmUid: string,
): { component: ICAL.Component; index: number } | undefined {
  if (event.alarmIdentityError === 'invalid') {
    throw new CanonicalReminderResolutionError('invalid-alarm-identity');
  }
  if (event.alarmIdentityError === 'ambiguous') {
    throw new CanonicalReminderResolutionError('ambiguous-alarm');
  }
  return event.displayAlarmsByUid.get(alarmUid);
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

function isValidCalendarId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.trim() === value &&
    !Array.from(value).some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 0x1f || code === 0x7f;
    })
  );
}
