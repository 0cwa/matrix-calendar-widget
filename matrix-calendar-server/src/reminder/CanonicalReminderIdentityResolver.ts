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

import { CalendarEventDateTime } from '@matrix-calendar-widget/calendar';
import ICAL from 'ical.js';
import { ICalendarEventCodec } from '../caldav/ICalendarEventCodec';
import {
  ReminderDeliveryIdentity,
  RoomReminderConfiguration,
} from './RoomReminderStore';

export type CanonicalReminderIdentity = Pick<
  RoomReminderConfiguration,
  'calendarId' | 'eventUid' | 'recurrenceId' | 'alarmUid'
>;

export type CanonicalReminderResolution = {
  resolved: true;
  identity: CanonicalReminderIdentity;
};

/** A stored configuration may omit the delivery-specific trigger ordinal. */
export type CanonicalReminderLookupIdentity = CanonicalReminderIdentity &
  Partial<Pick<ReminderDeliveryIdentity, 'triggerOrdinal'>>;

/** Raw CalDAV resource data and the collection it was read from. */
export type CanonicalReminderResourceData = {
  calendarId: string;
  icalendar: string;
};

export type CanonicalReminderDeliveryResolution = {
  resolved: true;
  identity: CanonicalReminderIdentity;
  triggerOrdinal: number;
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

/** Safe failure that never includes VEVENT or VALARM property values. */
export class CanonicalReminderResolutionError extends Error {
  constructor(public readonly code: CanonicalReminderResolutionErrorCode) {
    super(`Reminder identity could not be resolved (${code})`);
    this.name = 'CanonicalReminderResolutionError';
  }
}

/**
 * Resolves one alarm firing against an already-fetched raw CalDAV resource.
 * The collection ID is checked separately because it is not present in ICS.
 * This function performs no IO and returns undefined unless exactly one
 * event, recurrence component, and DISPLAY alarm match.
 * It verifies identity only; callers must confirm the alarm has a usable
 * TRIGGER and is schedulable (including `triggerEditable`) before scheduling.
 */
export function resolveCanonicalReminderIdentityFromResource(
  identity: CanonicalReminderLookupIdentity,
  resource: CanonicalReminderResourceData,
): CanonicalReminderDeliveryResolution | undefined {
  const triggerOrdinal = identity.triggerOrdinal ?? 0;
  if (
    resource.calendarId !== identity.calendarId ||
    !Number.isSafeInteger(triggerOrdinal) ||
    triggerOrdinal < 0
  ) {
    return undefined;
  }

  let alarm: ICAL.Component;
  try {
    ({ alarm } = resolveCanonicalReminderComponents(
      identity,
      resource.icalendar,
    ));
  } catch {
    return undefined;
  }
  if (!alarmSupportsTriggerOrdinal(alarm, triggerOrdinal)) {
    return undefined;
  }

  return {
    resolved: true,
    identity: {
      calendarId: identity.calendarId,
      eventUid: identity.eventUid,
      recurrenceId: identity.recurrenceId,
      alarmUid: identity.alarmUid,
    },
    triggerOrdinal,
  };
}

/**
 * Confirms an inert reminder identity against one already-fetched canonical
 * CalDAV resource. The function performs no IO and returns only identity data;
 * callers must still authorize delivery at send time.
 */
export function resolveCanonicalReminderIdentity(
  identity: CanonicalReminderIdentity,
  canonicalCalendarData: string,
): CanonicalReminderResolution {
  resolveCanonicalReminderComponents(identity, canonicalCalendarData);
  return {
    resolved: true,
    identity: { ...identity },
  };
}

function resolveCanonicalReminderComponents(
  identity: CanonicalReminderIdentity,
  canonicalCalendarData: string,
): { event: ICAL.Component; alarm: ICAL.Component } {
  let calendar: ICAL.Component;
  try {
    calendar = ICAL.Component.fromString(canonicalCalendarData);
    new ICalendarEventCodec().parse(
      identity.calendarId,
      'canonical-reminder-resource',
      canonicalCalendarData,
    );
  } catch {
    throw new CanonicalReminderResolutionError('invalid-calendar');
  }
  if (calendar.name !== 'vcalendar') {
    throw new CanonicalReminderResolutionError('invalid-calendar');
  }

  const matchingEvents = calendar
    .getAllSubcomponents('vevent')
    .filter((event) => {
      const uid = readEventUid(event);
      if (!uid) {
        throw new CanonicalReminderResolutionError('invalid-event-identity');
      }
      return uid === identity.eventUid;
    });
  if (matchingEvents.length === 0) {
    throw new CanonicalReminderResolutionError('event-not-found');
  }

  const event = selectEvent(matchingEvents, identity.recurrenceId);
  const alarm = selectDisplayAlarm(event, identity.alarmUid);
  if (!alarm) {
    throw new CanonicalReminderResolutionError('alarm-not-found');
  }
  return { event, alarm };
}

function readEventUid(event: ICAL.Component): string | undefined {
  const properties = event.getAllProperties('uid');
  if (properties.length !== 1) {
    return undefined;
  }
  const value = properties[0].getFirstValue();
  return typeof value === 'string' && isValidIdentity(value)
    ? value
    : undefined;
}

function selectEvent(
  events: ICAL.Component[],
  recurrenceId: string | null,
): ICAL.Component {
  const matches: ICAL.Component[] = [];
  for (const event of events) {
    const properties = event.getAllProperties('recurrence-id');
    if (properties.length > 1) {
      throw new CanonicalReminderResolutionError('invalid-event-identity');
    }
    if (properties.length === 0) {
      if (recurrenceId === null) {
        matches.push(event);
      }
      continue;
    }
    if (recurrenceId === null) {
      continue;
    }
    let key: string;
    try {
      key = canonicalRecurrenceKey(readRecurrenceIdentity(properties[0]));
    } catch {
      throw new CanonicalReminderResolutionError('invalid-event-identity');
    }
    if (key === recurrenceId) {
      matches.push(event);
    }
  }
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

function selectDisplayAlarm(
  event: ICAL.Component,
  alarmUid: string,
): ICAL.Component | undefined {
  const matches: ICAL.Component[] = [];
  const seenUids = new Set<string>();
  for (const alarm of event.getAllSubcomponents('valarm')) {
    const uids = alarm.getAllProperties('uid');
    // UID-less legacy alarms remain valid calendar data but cannot be selected.
    if (uids.length === 0) {
      continue;
    }
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
      actions.length !== 1 ||
      String(actions[0].getFirstValue()).toUpperCase() !== 'DISPLAY'
    ) {
      continue;
    }
    if (uid === alarmUid) {
      matches.push(alarm);
    }
  }
  if (matches.length > 1) {
    throw new CanonicalReminderResolutionError('ambiguous-alarm');
  }
  return matches[0];
}

function alarmSupportsTriggerOrdinal(
  alarm: ICAL.Component,
  triggerOrdinal: number,
): boolean {
  const repeats = alarm.getAllProperties('repeat');
  const durations = alarm.getAllProperties('duration');
  if (repeats.length === 0 && durations.length === 0) {
    return triggerOrdinal === 0;
  }
  if (repeats.length !== 1 || durations.length !== 1) {
    return false;
  }

  const repeatCount = Number(repeats[0].getFirstValue());
  const duration = durations[0].getFirstValue();
  if (
    !Number.isSafeInteger(repeatCount) ||
    repeatCount < 1 ||
    !(duration instanceof ICAL.Duration)
  ) {
    return false;
  }
  const durationSeconds = duration.toSeconds();
  return (
    Number.isSafeInteger(durationSeconds) &&
    durationSeconds > 0 &&
    triggerOrdinal <= repeatCount
  );
}

function readRecurrenceIdentity(
  property: ICAL.Property,
): CalendarEventDateTime {
  const value = property.getFirstValue();
  if (!(value instanceof ICAL.Time)) {
    throw new Error('Invalid recurrence identity');
  }
  if (value.isDate) {
    return { type: 'date', value: formatDate(value) };
  }

  const tzid = property.getFirstParameter('tzid');
  const mode =
    typeof tzid === 'string' && tzid.length > 0
      ? 'tzid'
      : value.zone === ICAL.Timezone.utcTimezone || value.zone?.tzid === 'Z'
        ? 'utc'
        : 'floating';
  return {
    type: 'date-time',
    value: {
      local: `${formatDate(value)}T${pad(value.hour)}:${pad(value.minute)}:${pad(value.second)}`,
      timezone:
        mode === 'utc'
          ? 'UTC'
          : mode === 'floating'
            ? 'floating'
            : (tzid as string),
      mode,
    },
  };
}

function formatDate(value: ICAL.Time): string {
  return `${value.year.toString().padStart(4, '0')}-${pad(value.month)}-${pad(value.day)}`;
}

function pad(value: number): string {
  return value.toString().padStart(2, '0');
}

/** Matches the strict canonical tuple accepted by the reminder API. */
function canonicalRecurrenceKey(value: CalendarEventDateTime): string {
  if (value.type === 'date') {
    return JSON.stringify(['date', value.value]);
  }
  const mode =
    value.value.mode ??
    (value.value.timezone === 'UTC'
      ? 'utc'
      : value.value.timezone === 'floating'
        ? 'floating'
        : 'tzid');
  return JSON.stringify([
    'date-time',
    mode,
    mode === 'tzid' ? value.value.timezone : '',
    value.value.local,
  ]);
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
