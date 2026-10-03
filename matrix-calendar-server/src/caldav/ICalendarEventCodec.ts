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
  CalendarEvent,
  CalendarEventAlarmPatch,
  CalendarEventDateTime,
  CalendarEventDisplayAlarm,
  CalendarEventDuration,
  CalendarEventId,
  CalendarEventInput,
  CalendarEventPatch,
  CalendarEventRecurrence,
  CalendarEventRecurrenceDate,
  CalendarEventRecurrenceOverride,
  CalendarEventRecurrenceTiming,
  CalendarEventRecurrenceWrite,
  CalendarEventRevision,
  CalendarEventStatus,
  CalendarEventTimedDateTime,
  CalendarEventTiming,
  CalendarEventTransparency,
  CalendarId,
  calendarEventRecurrenceIdentity,
  isCalendarEventAlarmRemoval,
  isCalendarTimezoneSupported,
  isSupportedCalendarEventOccurrenceExclusion,
  parseSupportedCalendarEventRecurrenceRule,
} from '@matrix-calendar-widget/calendar';
import ICAL from 'ical.js';
import { DateTime } from 'luxon';
import { hasUnsupportedTimezoneRules } from './ICalendarTimezoneProjectionSafety';

type RevisionPropertyState<T> =
  | { kind: 'missing' }
  | { kind: 'valid'; value: T }
  | { kind: 'invalid' };

type ICalendarContentLine = {
  value: string;
  physicalLines: string[];
};

type RawRevisionProperty = ICalendarContentLine & {
  name: 'dtstamp' | 'created' | 'last-modified' | 'sequence';
};

const systemClock = (): Date => new Date();
// RFC 5545 INTEGER is a signed 32-bit value; SEQUENCE uses its nonnegative range.
const MAX_ICALENDAR_SEQUENCE = 2_147_483_647;

export type EncodedICalendarEvent = {
  event: CalendarEvent;
  icalendar: string;
};

export type ICalendarEventCodecErrorCode =
  | 'invalid-calendar'
  | 'missing-event'
  | 'missing-uid'
  | 'missing-timing'
  | 'invalid-timing'
  | 'unsupported-patch';

export class ICalendarEventCodecError extends Error {
  constructor(
    public readonly code: ICalendarEventCodecErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ICalendarEventCodecError';
  }
}

export class ParsedICalendarEvent {
  constructor(
    private readonly calendar: ICAL.Component,
    public readonly event: CalendarEvent,
    /** Internal marker for count-only list diagnostics, not event payloads. */
    public readonly listProjectionDiagnostic?: 'unsupported-recurrence',
    private readonly clock: () => Date = systemClock,
    private readonly sourceRevisionProperties?: RawRevisionProperty[],
  ) {}

  applyPatch(patch: CalendarEventPatch): EncodedICalendarEvent {
    if (this.event.unsupportedTimezone && hasOwn(patch, 'timing')) {
      throw new ICalendarEventCodecError(
        'unsupported-patch',
        'Timing edits are not supported for events with unsupported timezone rules',
      );
    }
    const hasRecurrencePatch = hasOwn(patch, 'recurrence');
    const hasAlarmPatch = hasOwn(patch, 'alarm');
    if (hasAlarmPatch && this.event.unsupportedAlarm) {
      throw unsupportedAlarmPatch();
    }
    if (hasAlarmPatch && !isCalendarEventAlarmRemoval(patch.alarm)) {
      validateDisplayAlarm(patch.alarm);
    }
    const recurrenceWrite = hasRecurrencePatch
      ? recurrenceWriteFromUnknown(patch.recurrence)
      : undefined;
    if (hasRecurrencePatch) {
      if (recurrenceWrite && 'exdate' in recurrenceWrite) {
        assertOccurrenceExdateCanBeEdited(
          this.event,
          recurrenceWrite.exdate.recurrenceId,
          this.listProjectionDiagnostic,
        );
      } else if (recurrenceWrite && 'rdate' in recurrenceWrite) {
        if (recurrenceWrite.rdate.action === 'remove-period') {
          assertPeriodRdateCanBeRemoved(
            this.event,
            recurrenceWrite.rdate.value,
            this.listProjectionDiagnostic,
          );
        } else if (recurrenceWrite.rdate.action === 'add-period') {
          assertPeriodRdateCanBeAdded(
            this.event,
            recurrenceWrite.rdate.value,
            this.listProjectionDiagnostic,
          );
        } else {
          assertPointRdateCanBeEdited(
            this.event,
            recurrenceWrite.rdate.value,
            this.listProjectionDiagnostic,
          );
        }
      } else {
        if (this.listProjectionDiagnostic === 'unsupported-recurrence') {
          throw unsupportedRecurrencePatch();
        }
        assertSimpleRecurrenceCanBeEdited(this.event);
        const nextRule = recurrenceWrite?.rrule;
        if (nextRule !== undefined) {
          validateRecurrenceRule(
            nextRule,
            timingStartAsDateTime(patch.timing ?? this.event.timing),
          );
        }
      }
    }

    const calendar = ICAL.Component.fromString(this.calendar.toString());
    const vevent = findMasterEvent(calendar, this.event.uid);
    if (!vevent) {
      throw new ICalendarEventCodecError(
        'missing-event',
        'Parsed iCalendar no longer contains the target VEVENT',
      );
    }
    if (
      hasAlarmPatch &&
      (this.event.unsupportedAlarm ||
        readResourceAlarm(calendar, vevent).unsupported)
    ) {
      throw unsupportedAlarmPatch();
    }
    const eventSourceBeforePatch = vevent.toString();

    if (hasOwn(patch, 'title')) {
      setTextProperty(vevent, 'summary', patch.title ?? '');
    }
    if (hasOwn(patch, 'description')) {
      setOptionalProperty(vevent, 'description', patch.description);
    }
    if (hasOwn(patch, 'timing') && patch.timing) {
      setTiming(vevent, patch.timing);
    }
    if (hasOwn(patch, 'status')) {
      setOptionalProperty(vevent, 'status', patch.status?.toUpperCase());
    }
    if (hasOwn(patch, 'transparency')) {
      setOptionalProperty(
        vevent,
        'transp',
        patch.transparency === undefined
          ? undefined
          : patch.transparency === 'transparent'
            ? 'TRANSPARENT'
            : 'OPAQUE',
      );
    }
    if (hasOwn(patch, 'location')) {
      setOptionalProperty(vevent, 'location', patch.location);
    }
    if (hasOwn(patch, 'url')) {
      setOptionalProperty(vevent, 'url', patch.url);
    }
    if (hasOwn(patch, 'categories')) {
      setCategories(vevent, patch.categories);
    }
    if (hasOwn(patch, 'priority')) {
      setOptionalProperty(vevent, 'priority', patch.priority);
    }
    if (hasRecurrencePatch) {
      if (recurrenceWrite && 'exdate' in recurrenceWrite) {
        applyOccurrenceExdate(vevent, recurrenceWrite.exdate);
      } else if (recurrenceWrite && 'rdate' in recurrenceWrite) {
        if (recurrenceWrite.rdate.action === 'remove-period') {
          assertRdatePropertiesCanBeEdited(vevent, this.event);
          applyPeriodRdate(vevent, recurrenceWrite.rdate.value);
        } else if (recurrenceWrite.rdate.action === 'add-period') {
          assertRdatePropertiesCanBeEdited(vevent, this.event);
          applyPeriodRdate(vevent, recurrenceWrite.rdate.value, calendar);
        } else {
          assertRdatePropertiesCanBeEdited(vevent, this.event);
          applyPointRdate(calendar, vevent, recurrenceWrite.rdate, this.event);
        }
        if (hasUnsupportedTimezoneRules(calendar, this.event.uid)) {
          throw unsupportedRecurrencePatch();
        }
      } else {
        setRecurrenceRule(vevent, recurrenceWrite?.rrule);
      }
    }
    if (hasAlarmPatch) {
      setDisplayAlarm(vevent, patch.alarm, patch.title ?? this.event.title);
    }

    const revisionUpdated =
      vevent.toString() !== eventSourceBeforePatch &&
      updateRevisionMetadata(
        vevent,
        this.clock(),
        this.sourceRevisionProperties,
      );

    const recurrence = hasRecurrencePatch
      ? recurrenceWrite && 'exdate' in recurrenceWrite
        ? readRecurrence(calendar, vevent, this.event.uid)
        : recurrenceWrite && 'rdate' in recurrenceWrite
          ? readRecurrence(calendar, vevent, this.event.uid)
          : recurrenceWrite?.rrule
            ? { rrule: canonicalizeRecurrenceRule(recurrenceWrite.rrule) }
            : undefined
      : this.event.recurrence;

    const { alarm: alarmPatch, ...eventPatch } = patch;
    const event: CalendarEvent = {
      ...this.event,
      ...eventPatch,
      title: patch.title ?? this.event.title,
      timing: patch.timing ?? this.event.timing,
      recurrence,
      revision: revisionUpdated
        ? readUpdatedCalendarEventRevision(
            vevent,
            this.sourceRevisionProperties,
          )
        : this.event.revision,
    };
    if (hasAlarmPatch) {
      if (isCalendarEventAlarmRemoval(alarmPatch)) {
        delete event.alarm;
      } else {
        event.alarm = alarmPatch as CalendarEventDisplayAlarm;
      }
      delete event.unsupportedAlarm;
    }

    const preservedRevisionProperties = restoreRevisionProperties(
      calendar.toString(),
      this.sourceRevisionProperties,
      revisionUpdated
        ? ['created']
        : ['dtstamp', 'created', 'last-modified', 'sequence'],
    );

    return {
      event,
      icalendar: preservedRevisionProperties,
    };
  }
}

export class ICalendarEventCodec {
  constructor(private readonly clock: () => Date = systemClock) {}

  create(
    calendarId: CalendarId,
    eventId: CalendarEventId,
    input: CalendarEventInput,
  ): EncodedICalendarEvent {
    if (input.alarm !== undefined) {
      validateDisplayAlarm(input.alarm);
    }
    const recurrenceWrite = recurrenceWriteFromUnknown(input.recurrence);
    if (input.recurrence) {
      if (
        !recurrenceWrite ||
        !('rrule' in recurrenceWrite) ||
        !recurrenceWrite.rrule
      ) {
        throw unsupportedRecurrencePatch();
      }
      validateRecurrenceRule(
        recurrenceWrite.rrule,
        timingStartAsDateTime(input.timing),
      );
    }

    const calendar = new ICAL.Component('vcalendar');
    calendar.addPropertyWithValue('version', '2.0');
    calendar.addPropertyWithValue('prodid', '-//Matrix Calendar Widget//EN');

    const vevent = new ICAL.Component('vevent');
    calendar.addSubcomponent(vevent);

    setTextProperty(vevent, 'uid', input.uid);
    setInitialRevisionMetadata(vevent, this.clock());
    setTextProperty(vevent, 'summary', input.title);
    setTiming(vevent, input.timing);
    setOptionalProperty(vevent, 'description', input.description);
    setOptionalProperty(vevent, 'status', input.status?.toUpperCase());
    setOptionalProperty(
      vevent,
      'transp',
      input.transparency === undefined
        ? undefined
        : input.transparency === 'transparent'
          ? 'TRANSPARENT'
          : 'OPAQUE',
    );
    setOptionalProperty(vevent, 'location', input.location);
    setOptionalProperty(vevent, 'url', input.url);
    setCategories(vevent, input.categories);
    setOptionalProperty(vevent, 'priority', input.priority);
    const recurrenceRule =
      recurrenceWrite && 'rrule' in recurrenceWrite
        ? recurrenceWrite.rrule
        : undefined;
    setRecurrenceRule(vevent, recurrenceRule);
    if (input.alarm) {
      setDisplayAlarm(vevent, input.alarm, input.title);
    }

    return {
      event: {
        ...input,
        id: eventId,
        calendarId,
        revision: readCalendarEventRevision(vevent),
        recurrence: recurrenceRule
          ? { rrule: canonicalizeRecurrenceRule(recurrenceRule) }
          : undefined,
      },
      icalendar: calendar.toString(),
    };
  }

  parse(
    calendarId: CalendarId,
    eventId: CalendarEventId,
    source: string,
  ): ParsedICalendarEvent {
    let calendar: ICAL.Component;

    try {
      calendar = ICAL.Component.fromString(source);
    } catch (error) {
      throw new ICalendarEventCodecError(
        'invalid-calendar',
        error instanceof Error
          ? `Invalid iCalendar document: ${error.message}`
          : 'Invalid iCalendar document',
      );
    }

    if (calendar.name !== 'vcalendar') {
      throw new ICalendarEventCodecError(
        'invalid-calendar',
        'iCalendar resource must contain a VCALENDAR root',
      );
    }

    const vevent = findMasterEvent(calendar);
    if (!vevent) {
      throw new ICalendarEventCodecError(
        'missing-event',
        'iCalendar resource does not contain a VEVENT',
      );
    }

    const uid = textValue(vevent.getFirstPropertyValue('uid'));
    if (!uid) {
      throw new ICalendarEventCodecError(
        'missing-uid',
        'VEVENT does not contain a UID',
      );
    }

    const sourceRevisionProperties = readMasterRevisionProperties(source);
    const timing = readTiming(vevent);
    const recurrence = readRecurrence(calendar, vevent, uid);
    const unsupportedRecurrence = readUnsupportedRecurrence(calendar, uid);
    const hasMultipleMasterRules = vevent.getAllProperties('rrule').length > 1;
    const unsupportedTimezone = hasUnsupportedTimezoneRules(calendar, uid);
    const alarmState = readResourceAlarm(calendar, vevent);

    const event: CalendarEvent = {
      id: eventId,
      calendarId,
      uid,
      title: textValue(vevent.getFirstPropertyValue('summary')) ?? '',
      description: textValue(vevent.getFirstPropertyValue('description')),
      timing,
      status: readStatus(vevent.getFirstPropertyValue('status')),
      transparency: readTransparency(vevent.getFirstPropertyValue('transp')),
      location: textValue(vevent.getFirstPropertyValue('location')),
      url: textValue(vevent.getFirstPropertyValue('url')),
      categories: readCategories(vevent),
      priority: numberValue(vevent.getFirstPropertyValue('priority')),
      recurrence,
      revision: readCalendarEventRevision(vevent, sourceRevisionProperties),
      ...(alarmState.alarm ? { alarm: alarmState.alarm } : {}),
      ...(alarmState.unsupported ? { unsupportedAlarm: true } : {}),
      ...(unsupportedRecurrence ? { unsupportedRecurrence } : {}),
      ...(unsupportedTimezone ? { unsupportedTimezone: true } : {}),
    };

    return new ParsedICalendarEvent(
      calendar,
      event,
      hasMultipleMasterRules ? 'unsupported-recurrence' : undefined,
      this.clock,
      sourceRevisionProperties,
    );
  }
}

function recurrenceWriteFromUnknown(
  value: unknown,
): CalendarEventRecurrenceWrite | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw unsupportedRecurrencePatch();
  }

  const fields = value as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(fields, 'exdate')) {
    const operation = fields.exdate;
    if (
      Object.keys(fields).length !== 1 ||
      !operation ||
      typeof operation !== 'object' ||
      Array.isArray(operation)
    ) {
      throw unsupportedRecurrencePatch();
    }

    const exdate = operation as Record<string, unknown>;
    if (
      Object.keys(exdate).length !== 2 ||
      !['action', 'recurrenceId'].every((key) =>
        Object.prototype.hasOwnProperty.call(exdate, key),
      ) ||
      (exdate.action !== 'add' && exdate.action !== 'remove')
    ) {
      throw unsupportedRecurrencePatch();
    }

    return {
      exdate: {
        action: exdate.action,
        recurrenceId: exdate.recurrenceId as CalendarEventDateTime,
      },
    };
  }

  if (Object.prototype.hasOwnProperty.call(fields, 'rdate')) {
    const operation = fields.rdate;
    if (
      Object.keys(fields).length !== 1 ||
      !operation ||
      typeof operation !== 'object' ||
      Array.isArray(operation)
    ) {
      throw unsupportedRecurrencePatch();
    }

    const rdate = operation as Record<string, unknown>;
    if (
      Object.keys(rdate).length !== 2 ||
      !['action', 'value'].every((key) =>
        Object.prototype.hasOwnProperty.call(rdate, key),
      ) ||
      (rdate.action !== 'add' &&
        rdate.action !== 'remove' &&
        rdate.action !== 'add-period' &&
        rdate.action !== 'remove-period')
    ) {
      throw unsupportedRecurrencePatch();
    }

    if (rdate.action === 'remove-period' || rdate.action === 'add-period') {
      const value = recurrencePeriodFromUnknown(rdate.value);
      if (rdate.action === 'add-period') {
        return {
          rdate: {
            action: 'add-period',
            value,
          },
        };
      }
      return { rdate: { action: 'remove-period', value } };
    }

    return {
      rdate: {
        action: rdate.action,
        value: recurrenceDateTimeFromUnknown(rdate.value),
      },
    };
  }

  if (
    Object.keys(fields).some((key) => key !== 'rrule') ||
    (fields.rrule !== undefined && typeof fields.rrule !== 'string')
  ) {
    throw unsupportedRecurrencePatch();
  }

  return { rrule: fields.rrule as string | undefined };
}

function recurrencePeriodFromUnknown(
  value: unknown,
): Extract<CalendarEventRecurrenceDate, { type: 'period' }> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw unsupportedRecurrencePatch();
  }
  const period = value as Record<string, unknown>;
  if (
    Object.keys(period).length !== 2 ||
    period.type !== 'period' ||
    !Object.prototype.hasOwnProperty.call(period, 'timing') ||
    !period.timing ||
    typeof period.timing !== 'object' ||
    Array.isArray(period.timing)
  ) {
    throw unsupportedRecurrencePatch();
  }
  const timing = period.timing as Record<string, unknown>;
  if (timing.type === 'end') {
    if (
      Object.keys(timing).length !== 3 ||
      !Object.prototype.hasOwnProperty.call(timing, 'start') ||
      !Object.prototype.hasOwnProperty.call(timing, 'end')
    ) {
      throw unsupportedRecurrencePatch();
    }
    const start = recurrenceDateTimeFromUnknown(timing.start);
    const end = recurrenceDateTimeFromUnknown(timing.end);
    if (start.type === 'date' || end.type === 'date') {
      throw unsupportedRecurrencePatch();
    }
    return { type: 'period', timing: { type: 'end', start, end } };
  }
  if (timing.type === 'duration') {
    if (
      Object.keys(timing).length !== 3 ||
      !Object.prototype.hasOwnProperty.call(timing, 'start') ||
      !Object.prototype.hasOwnProperty.call(timing, 'duration')
    ) {
      throw unsupportedRecurrencePatch();
    }
    const start = recurrenceDateTimeFromUnknown(timing.start);
    const rawDuration = timing.duration;
    if (
      start.type === 'date' ||
      !rawDuration ||
      typeof rawDuration !== 'object' ||
      Array.isArray(rawDuration)
    ) {
      throw unsupportedRecurrencePatch();
    }
    if (!isPositiveRfcDuration(rawDuration)) {
      throw unsupportedRecurrencePatch();
    }
    return {
      type: 'period',
      timing: {
        type: 'duration',
        start,
        duration: rawDuration,
      },
    };
  }
  throw unsupportedRecurrencePatch();
}

function isPositiveRfcDuration(value: unknown): value is CalendarEventDuration {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const duration = value as Record<string, unknown>;
  const units = ['weeks', 'days', 'hours', 'minutes', 'seconds'] as const;
  if (
    Object.keys(duration).length !== units.length + 1 ||
    units.some(
      (unit) =>
        !Number.isSafeInteger(duration[unit]) || (duration[unit] as number) < 0,
    ) ||
    typeof duration.isNegative !== 'boolean' ||
    duration.isNegative ||
    !units.some((unit) => (duration[unit] as number) > 0)
  ) {
    return false;
  }

  const hasWeeks = (duration.weeks as number) > 0;
  const hasOtherUnits = units
    .slice(1)
    .some((unit) => (duration[unit] as number) > 0);
  return !(hasWeeks && hasOtherUnits);
}

function readResourceAlarm(
  calendar: ICAL.Component,
  master: ICAL.Component,
): { alarm?: CalendarEventDisplayAlarm; unsupported?: true } {
  const alarms = calendar
    .getAllSubcomponents('vevent')
    .flatMap((vevent) =>
      vevent
        .getAllSubcomponents('valarm')
        .map((alarm) => ({ owner: vevent, alarm })),
    );
  if (alarms.length === 0) {
    return {};
  }
  if (alarms.length !== 1 || alarms[0].owner !== master) {
    return { unsupported: true };
  }

  const alarm = readDisplayAlarm(alarms[0].alarm);
  return alarm ? { alarm } : { unsupported: true };
}

function readDisplayAlarm(
  component: ICAL.Component,
): CalendarEventDisplayAlarm | undefined {
  const actionProperties = component.getAllProperties('action');
  const triggerProperties = component.getAllProperties('trigger');
  const descriptions = component.getAllProperties('description');
  if (
    actionProperties.length !== 1 ||
    triggerProperties.length !== 1 ||
    descriptions.length !== 1 ||
    component.hasProperty('repeat') ||
    component.hasProperty('duration') ||
    textValue(actionProperties[0].getFirstValue())?.toUpperCase() !== 'DISPLAY'
  ) {
    return undefined;
  }

  const triggerProperty = triggerProperties[0];
  const trigger = triggerProperty.getFirstValue();
  const related = triggerProperty.getParameter('related');
  const valueType = triggerProperty.getFirstParameter('value');
  const triggerParameters = Object.keys(triggerProperty.jCal[1] ?? {});
  if (
    !(trigger instanceof ICAL.Duration) ||
    !trigger.isNegative ||
    triggerParameters.some(
      (parameter) => !['related', 'value'].includes(parameter),
    ) ||
    (related !== undefined &&
      (typeof related !== 'string' || related.toUpperCase() !== 'START')) ||
    (valueType !== undefined &&
      (typeof valueType !== 'string' || valueType.toUpperCase() !== 'DURATION'))
  ) {
    return undefined;
  }

  const leadTime = {
    weeks: trigger.weeks,
    days: trigger.days,
    hours: trigger.hours,
    minutes: trigger.minutes,
    seconds: trigger.seconds,
  };
  if (!isValidAlarmLeadTime(leadTime)) {
    return undefined;
  }

  return { action: 'display', trigger: leadTime };
}

function validateDisplayAlarm(
  value: unknown,
): asserts value is CalendarEventDisplayAlarm {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== 2
  ) {
    throw unsupportedAlarmPatch();
  }
  const alarm = value as Record<string, unknown>;
  if (
    alarm.action !== 'display' ||
    !alarm.trigger ||
    typeof alarm.trigger !== 'object' ||
    Array.isArray(alarm.trigger) ||
    Object.keys(alarm.trigger).length !== 5 ||
    !isValidAlarmLeadTime(alarm.trigger as Record<string, unknown>)
  ) {
    throw unsupportedAlarmPatch();
  }
}

function isValidAlarmLeadTime(
  value: Record<string, unknown>,
): value is Record<'weeks' | 'days' | 'hours' | 'minutes' | 'seconds', number> {
  const units = ['weeks', 'days', 'hours', 'minutes', 'seconds'] as const;
  if (
    Object.keys(value).length !== units.length ||
    units.some(
      (unit) =>
        !Number.isSafeInteger(value[unit]) || (value[unit] as number) < 0,
    )
  ) {
    return false;
  }

  const hasWeeks = (value.weeks as number) > 0;
  const hasOtherUnits = units
    .slice(1)
    .some((unit) => (value[unit] as number) > 0);
  const hasLeadTime = units.some((unit) => (value[unit] as number) > 0);
  return hasLeadTime && !(hasWeeks && hasOtherUnits);
}

function setDisplayAlarm(
  vevent: ICAL.Component,
  alarm: CalendarEventAlarmPatch | undefined,
  description: string,
): void {
  const existing = vevent.getAllSubcomponents('valarm');
  if (alarm === undefined || isCalendarEventAlarmRemoval(alarm)) {
    existing.forEach((component) => vevent.removeSubcomponent(component));
    return;
  }

  const trigger = ICAL.Duration.fromData({
    ...alarm.trigger,
    isNegative: true,
  });
  if (existing.length === 1) {
    const triggerProperty = existing[0].getFirstProperty('trigger');
    if (!triggerProperty || !readDisplayAlarm(existing[0])) {
      throw unsupportedAlarmPatch();
    }
    triggerProperty.setValue(trigger);
    return;
  }
  if (existing.length > 1) {
    throw unsupportedAlarmPatch();
  }

  const component = new ICAL.Component('valarm');
  component.addPropertyWithValue('action', 'DISPLAY');
  component.addPropertyWithValue('description', description);
  const triggerProperty = new ICAL.Property('trigger');
  triggerProperty.setValue(trigger);
  component.addProperty(triggerProperty);
  vevent.addSubcomponent(component);
}

function unsupportedAlarmPatch(): ICalendarEventCodecError {
  return new ICalendarEventCodecError(
    'unsupported-patch',
    'Only one negative relative DISPLAY alarm from DTSTART is supported',
  );
}

function assertOccurrenceExdateCanBeEdited(
  event: CalendarEvent,
  recurrenceId: CalendarEventDateTime,
  listProjectionDiagnostic?: 'unsupported-recurrence',
): void {
  if (
    listProjectionDiagnostic === 'unsupported-recurrence' ||
    !isSupportedCalendarEventOccurrenceExclusion(event, recurrenceId)
  ) {
    throw new ICalendarEventCodecError(
      'unsupported-patch',
      'Occurrence exceptions are not supported for this recurrence',
    );
  }
}

function applyOccurrenceExdate(
  vevent: ICAL.Component,
  operation: Extract<
    CalendarEventRecurrenceWrite,
    { exdate: unknown }
  >['exdate'],
): void {
  const targetIdentity = calendarEventRecurrenceIdentity(
    operation.recurrenceId,
  );
  const properties = vevent.getAllProperties('exdate');

  if (operation.action === 'add') {
    const alreadyExcluded = properties.some((property) =>
      property
        .getValues()
        .some(
          (value) =>
            value instanceof ICAL.Time &&
            calendarEventRecurrenceIdentity(
              readDateTimeValue(value, property),
            ) === targetIdentity,
        ),
    );
    if (alreadyExcluded) {
      return;
    }

    const property = new ICAL.Property('exdate');
    const { value, timezone } = recurrenceIdAsIcalTime(operation.recurrenceId);
    property.setValue(value);
    if (timezone) {
      property.setParameter('tzid', timezone);
    }
    vevent.addProperty(property);
    return;
  }

  for (const property of properties) {
    const values = property.getValues();
    let removed = false;
    const remaining = values.filter((value) => {
      const matches =
        value instanceof ICAL.Time &&
        calendarEventRecurrenceIdentity(readDateTimeValue(value, property)) ===
          targetIdentity;
      if (matches) {
        removed = true;
      }
      return !matches;
    });

    if (!removed) {
      continue;
    }
    if (remaining.length === 0) {
      vevent.removeProperty(property);
    } else {
      property.setValues(remaining);
    }
  }
}

function assertPointRdateCanBeEdited(
  event: CalendarEvent,
  value: CalendarEventDateTime,
  listProjectionDiagnostic?: 'unsupported-recurrence',
): void {
  const recurrence = event.recurrence;
  if (
    listProjectionDiagnostic === 'unsupported-recurrence' ||
    event.unsupportedTimezone ||
    event.unsupportedRecurrence ||
    !recurrence ||
    (!recurrence.rrule && !recurrence.rdates?.length)
  ) {
    throw unsupportedRecurrencePatch();
  }

  if (recurrence.rrule !== undefined) {
    validateRecurrenceRule(
      recurrence.rrule,
      timingStartAsDateTime(event.timing),
    );
  }

  validatePointRdateValue(value, timingStartAsDateTime(event.timing));
}

function assertRdatePropertiesCanBeEdited(
  vevent: ICAL.Component,
  event: CalendarEvent,
): void {
  const anchor = timingStartAsDateTime(event.timing);
  for (const property of vevent.getAllProperties('rdate')) {
    let values: ReturnType<ICAL.Property['getValues']>;
    try {
      values = property.getValues();
    } catch {
      throw unsupportedRecurrencePatch();
    }
    if (values.length === 0) {
      throw unsupportedRecurrencePatch();
    }

    const valueKind = values.map((value) =>
      value instanceof ICAL.Period
        ? 'period'
        : value instanceof ICAL.Time
          ? value.isDate
            ? 'date'
            : 'date-time'
          : 'unsupported',
    );
    if (
      valueKind.includes('unsupported') ||
      valueKind.some((kind) => kind !== valueKind[0])
    ) {
      throw unsupportedRecurrencePatch();
    }

    // PERIOD values are changed only by the exact add/remove operations below.
    if (valueKind[0] === 'period') {
      const explicitValueType = property.getFirstParameter('value');
      const tzid = property.getFirstParameter('tzid');
      if (
        (explicitValueType !== null &&
          explicitValueType !== undefined &&
          (typeof explicitValueType !== 'string' ||
            explicitValueType.toUpperCase() !== 'PERIOD')) ||
        (tzid !== null &&
          tzid !== undefined &&
          (typeof tzid !== 'string' || !tzid.trim()))
      ) {
        throw unsupportedRecurrencePatch();
      }
      for (const value of values) {
        if (!(value instanceof ICAL.Period)) {
          throw unsupportedRecurrencePatch();
        }
        const start = value.start;
        const end = value.end;
        if (
          typeof tzid === 'string' &&
          (start.zone === ICAL.Timezone.utcTimezone ||
            (end instanceof ICAL.Time &&
              end.zone === ICAL.Timezone.utcTimezone))
        ) {
          throw unsupportedRecurrencePatch();
        }
        readPeriodRdateValue(value, property);
      }
      continue;
    }

    const explicitValueType = property.getFirstParameter('value');
    if (
      (valueKind[0] === 'date' &&
        (typeof explicitValueType !== 'string' ||
          explicitValueType.toUpperCase() !== 'DATE')) ||
      (valueKind[0] === 'date-time' &&
        explicitValueType !== null &&
        explicitValueType !== undefined &&
        (typeof explicitValueType !== 'string' ||
          explicitValueType.toUpperCase() !== 'DATE-TIME'))
    ) {
      throw unsupportedRecurrencePatch();
    }

    for (const value of values) {
      if (!(value instanceof ICAL.Time)) {
        throw unsupportedRecurrencePatch();
      }
      const tzid = property.getFirstParameter('tzid');
      if (
        (tzid !== null &&
          tzid !== undefined &&
          (typeof tzid !== 'string' || !tzid.trim())) ||
        (typeof tzid === 'string' &&
          (value.isDate || value.zone === ICAL.Timezone.utcTimezone))
      ) {
        throw unsupportedRecurrencePatch();
      }
      validatePointRdateValue(readDateTimeValue(value, property), anchor);
    }
  }
}

function assertPeriodRdateCanBeRemoved(
  event: CalendarEvent,
  value: Extract<CalendarEventRecurrenceDate, { type: 'period' }>,
  listProjectionDiagnostic?: 'unsupported-recurrence',
): void {
  const recurrence = event.recurrence;
  if (
    listProjectionDiagnostic === 'unsupported-recurrence' ||
    event.unsupportedTimezone ||
    event.unsupportedRecurrence ||
    !recurrence ||
    !recurrence.rdates?.some(
      (candidate) =>
        recurrenceRdateIdentity(candidate) === recurrenceRdateIdentity(value),
    )
  ) {
    throw unsupportedRecurrencePatch();
  }
  if (recurrence.rrule !== undefined) {
    validateRecurrenceRule(
      recurrence.rrule,
      timingStartAsDateTime(event.timing),
    );
  }
}

function assertPeriodRdateCanBeAdded(
  event: CalendarEvent,
  value: Extract<CalendarEventRecurrenceDate, { type: 'period' }>,
  listProjectionDiagnostic?: 'unsupported-recurrence',
): void {
  const recurrence = event.recurrence;
  if (
    listProjectionDiagnostic === 'unsupported-recurrence' ||
    event.unsupportedTimezone ||
    event.unsupportedRecurrence ||
    !recurrence ||
    (!recurrence.rrule && !recurrence.rdates?.length)
  ) {
    throw unsupportedRecurrencePatch();
  }
  if (recurrence.rrule !== undefined) {
    validateRecurrenceRule(
      recurrence.rrule,
      timingStartAsDateTime(event.timing),
    );
  }

  if (event.timing.type !== 'timed') {
    throw unsupportedRecurrencePatch();
  }

  const { timing } = value;
  const anchor = timingStartAsDateTime(event.timing);
  validatePointRdateValue(timing.start, anchor);
  if (timing.type === 'duration') {
    if (!isPositiveRfcDuration(timing.duration)) {
      throw unsupportedRecurrencePatch();
    }
    return;
  }

  validatePointRdateValue(timing.end, anchor);
  if (
    timing.start.type !== timing.end.type ||
    (timing.start.type === 'date-time' &&
      timing.end.type === 'date-time' &&
      timing.start.value.timezone !== timing.end.value.timezone)
  ) {
    throw unsupportedRecurrencePatch();
  }
  const zone =
    timing.start.type === 'date-time' ? timing.start.value.timezone : 'UTC';
  const startValue =
    timing.start.type === 'floating-date-time'
      ? timing.start.value
      : timing.start.type === 'date-time'
        ? timing.start.value.local
        : undefined;
  const endValue =
    timing.end.type === 'floating-date-time'
      ? timing.end.value
      : timing.end.type === 'date-time'
        ? timing.end.value.local
        : undefined;
  if (!startValue || !endValue) {
    throw unsupportedRecurrencePatch();
  }
  const startInstant = DateTime.fromISO(startValue, { zone });
  const endInstant = DateTime.fromISO(endValue, { zone });
  if (
    !startInstant.isValid ||
    !endInstant.isValid ||
    endInstant.toMillis() <= startInstant.toMillis()
  ) {
    throw unsupportedRecurrencePatch();
  }
}

function validatePointRdateValue(
  value: CalendarEventDateTime,
  anchor: CalendarEventDateTime,
): void {
  if ((anchor.type === 'date') !== (value.type === 'date')) {
    throw unsupportedRecurrencePatch();
  }

  switch (value.type) {
    case 'date':
      if (!isValidCalendarDate(value.value)) {
        throw unsupportedRecurrencePatch();
      }
      return;
    case 'floating-date-time':
      if (anchor.type === 'date' || !isValidLocalDateTime(value.value)) {
        throw unsupportedRecurrencePatch();
      }
      return;
    case 'date-time':
      if (
        anchor.type === 'date' ||
        !isValidLocalDateTime(value.value.local) ||
        (value.value.timezone !== 'UTC' &&
          !isCalendarTimezoneSupported(value.value.timezone))
      ) {
        throw unsupportedRecurrencePatch();
      }
      return;
  }
}

function isValidCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = DateTime.fromISO(value, { zone: 'UTC' });
  return date.isValid && date.toISODate() === value;
}

function isValidLocalDateTime(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value)) {
    return false;
  }

  const dateTime = DateTime.fromISO(value, { zone: 'UTC' });
  return (
    dateTime.isValid && dateTime.toFormat("yyyy-MM-dd'T'HH:mm:ss") === value
  );
}

function applyPointRdate(
  calendar: ICAL.Component,
  vevent: ICAL.Component,
  operation: {
    action: 'add' | 'remove';
    value: CalendarEventDateTime;
  },
  event: CalendarEvent,
): void {
  const targetIdentity = calendarEventRecurrenceIdentity(operation.value);
  const properties = vevent.getAllProperties('rdate');

  if (operation.action === 'add') {
    // DTSTART, RRULE, RDATE, and detached instances form one recurrence set.
    // An exact existing identity is already represented and must stay unique.
    const recurrenceWithoutExdates = event.recurrence
      ? { ...event, recurrence: { ...event.recurrence, exdates: [] } }
      : event;
    if (
      isSupportedCalendarEventOccurrenceExclusion(
        recurrenceWithoutExdates,
        operation.value,
      )
    ) {
      return;
    }

    if (operation.value.type === 'date-time') {
      const timezoneId = operation.value.value.timezone;
      if (
        timezoneId !== 'UTC' &&
        !calendar
          .getAllSubcomponents('vtimezone')
          .some(
            (timezone) => timezone.getFirstPropertyValue('tzid') === timezoneId,
          )
      ) {
        throw unsupportedRecurrencePatch();
      }
    }

    const property = new ICAL.Property('rdate');
    const { value, timezone } = recurrenceIdAsIcalTime(operation.value);
    if (timezone) {
      property.setParameter('tzid', timezone);
    }
    property.setValue(value);
    vevent.addProperty(property);
    return;
  }

  for (const property of properties) {
    const values = property.getValues();
    let removed = false;
    const remaining = values.filter((value) => {
      const matches =
        value instanceof ICAL.Time &&
        calendarEventRecurrenceIdentity(readDateTimeValue(value, property)) ===
          targetIdentity;
      if (matches) {
        removed = true;
      }
      return !matches;
    });

    if (!removed) {
      continue;
    }
    if (remaining.length === 0) {
      vevent.removeProperty(property);
    } else {
      property.setValues(remaining);
    }
  }
}

function recurrenceRdateIdentity(value: CalendarEventRecurrenceDate): string {
  if (value.type !== 'period') {
    return `point:${calendarEventRecurrenceIdentity(value)}`;
  }
  const { timing } = value;
  return timing.type === 'end'
    ? `period:end:${calendarEventRecurrenceIdentity(timing.start)}:${calendarEventRecurrenceIdentity(timing.end)}`
    : `period:duration:${calendarEventRecurrenceIdentity(timing.start)}:${timing.duration.weeks}:${timing.duration.days}:${timing.duration.hours}:${timing.duration.minutes}:${timing.duration.seconds}:${timing.duration.isNegative}`;
}

function applyPeriodRdate(
  vevent: ICAL.Component,
  target: Extract<CalendarEventRecurrenceDate, { type: 'period' }>,
  calendar?: ICAL.Component,
): void {
  if (calendar) {
    const targetIdentity = recurrenceRdateIdentity(target);
    const alreadyPresent = vevent
      .getAllProperties('rdate')
      .some((property) =>
        property
          .getValues()
          .some(
            (value) =>
              value instanceof ICAL.Period &&
              recurrenceRdateIdentity(readPeriodRdateValue(value, property)) ===
                targetIdentity,
          ),
      );
    if (alreadyPresent) {
      return;
    }

    const { start } = target.timing;
    const startIcal = recurrenceIdAsIcalTime(start);
    if (startIcal.timezone) {
      if (
        !calendar
          .getAllSubcomponents('vtimezone')
          .some(
            (timezone) =>
              timezone.getFirstPropertyValue('tzid') === startIcal.timezone,
          )
      ) {
        throw unsupportedRecurrencePatch();
      }
    }

    const period =
      target.timing.type === 'end'
        ? ICAL.Period.fromData({
            start: startIcal.value,
            end: recurrenceIdAsIcalTime(target.timing.end).value,
          })
        : ICAL.Period.fromData({
            start: startIcal.value,
            duration: ICAL.Duration.fromData(target.timing.duration),
          });
    const property = new ICAL.Property('rdate');
    if (startIcal.timezone) {
      property.setParameter('tzid', startIcal.timezone);
    }
    property.setValue(period);
    vevent.addProperty(property);
    return;
  }
  const targetIdentity = recurrenceRdateIdentity(target);
  for (const property of vevent.getAllProperties('rdate')) {
    const values = property.getValues();
    let removed = false;
    const remaining = values.filter((value) => {
      if (removed || !(value instanceof ICAL.Period)) {
        return true;
      }
      if (
        recurrenceRdateIdentity(readPeriodRdateValue(value, property)) !==
        targetIdentity
      ) {
        return true;
      }
      removed = true;
      return false;
    });
    if (!removed) {
      continue;
    }
    if (remaining.length === 0) {
      vevent.removeProperty(property);
    } else {
      property.setValues(remaining);
    }
    return;
  }
}

function recurrenceDateTimeFromUnknown(value: unknown): CalendarEventDateTime {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw unsupportedRecurrencePatch();
  }

  const dateTime = value as Record<string, unknown>;
  if (dateTime.type === 'date') {
    if (
      Object.keys(dateTime).length !== 2 ||
      !Object.prototype.hasOwnProperty.call(dateTime, 'value') ||
      typeof dateTime.value !== 'string' ||
      !isValidCalendarDate(dateTime.value)
    ) {
      throw unsupportedRecurrencePatch();
    }
    return { type: 'date', value: dateTime.value };
  }

  if (dateTime.type === 'floating-date-time') {
    if (
      Object.keys(dateTime).length !== 2 ||
      !Object.prototype.hasOwnProperty.call(dateTime, 'value') ||
      typeof dateTime.value !== 'string' ||
      !isValidLocalDateTime(dateTime.value)
    ) {
      throw unsupportedRecurrencePatch();
    }
    return { type: 'floating-date-time', value: dateTime.value };
  }

  if (dateTime.type === 'date-time') {
    const zonedValue = dateTime.value;
    if (
      Object.keys(dateTime).length !== 2 ||
      !zonedValue ||
      typeof zonedValue !== 'object' ||
      Array.isArray(zonedValue)
    ) {
      throw unsupportedRecurrencePatch();
    }

    const zoned = zonedValue as Record<string, unknown>;
    if (
      Object.keys(zoned).length !== 2 ||
      typeof zoned.local !== 'string' ||
      !isValidLocalDateTime(zoned.local) ||
      typeof zoned.timezone !== 'string' ||
      !zoned.timezone.trim()
    ) {
      throw unsupportedRecurrencePatch();
    }
    return {
      type: 'date-time',
      value: { local: zoned.local, timezone: zoned.timezone },
    };
  }

  throw unsupportedRecurrencePatch();
}

function recurrenceIdAsIcalTime(recurrenceId: CalendarEventDateTime): {
  value: ICAL.Time;
  timezone?: string;
} {
  switch (recurrenceId.type) {
    case 'date':
      return { value: ICAL.Time.fromDateString(recurrenceId.value) };
    case 'floating-date-time':
      return {
        value: ICAL.Time.fromDateTimeString(
          normalizeLocalDateTime(recurrenceId.value),
        ),
      };
    case 'date-time':
      return {
        value: ICAL.Time.fromDateTimeString(
          recurrenceId.value.timezone === 'UTC'
            ? `${normalizeLocalDateTime(recurrenceId.value.local)}Z`
            : normalizeLocalDateTime(recurrenceId.value.local),
        ),
        timezone:
          recurrenceId.value.timezone === 'UTC'
            ? undefined
            : recurrenceId.value.timezone,
      };
  }
}

function assertSimpleRecurrenceCanBeEdited(event: CalendarEvent): void {
  const recurrence = event.recurrence;
  if (
    event.unsupportedTimezone ||
    event.unsupportedRecurrence ||
    recurrence?.rdates?.length ||
    recurrence?.exdates?.length ||
    recurrence?.recurrenceId ||
    recurrence?.overrides?.length
  ) {
    throw unsupportedRecurrencePatch();
  }

  if (recurrence && Object.prototype.hasOwnProperty.call(recurrence, 'rrule')) {
    if (typeof recurrence.rrule !== 'string') {
      throw unsupportedRecurrencePatch();
    }
    validateRecurrenceRule(
      recurrence.rrule,
      timingStartAsDateTime(event.timing),
    );
  }
}

function validateRecurrenceRule(
  rule: string,
  anchor: CalendarEventDateTime,
): void {
  try {
    if (!rule.trim()) {
      throw new Error('empty recurrence rule');
    }
    parseSupportedCalendarEventRecurrenceRule(rule, anchor);
  } catch {
    throw unsupportedRecurrencePatch();
  }
}

function timingStartAsDateTime(
  timing: CalendarEventTiming,
): CalendarEventDateTime {
  if (timing.type === 'all-day') {
    return { type: 'date', value: timing.startDate };
  }

  return timing.start.type === 'floating'
    ? { type: 'floating-date-time', value: timing.start.local }
    : {
        type: 'date-time',
        value: {
          local: timing.start.local,
          timezone: timing.start.timezone,
        },
      };
}

function setRecurrenceRule(
  vevent: ICAL.Component,
  rule: string | undefined,
): void {
  vevent.removeAllProperties('rrule');
  if (rule) {
    const ruleText = rule.trim().replace(/^RRULE:/i, '');
    vevent.addPropertyWithValue('rrule', ICAL.Recur.fromString(ruleText));
  }
}

function canonicalizeRecurrenceRule(rule: string): string {
  const ruleText = rule.trim().replace(/^RRULE:/i, '');
  return String(ICAL.Recur.fromString(ruleText));
}

function unsupportedRecurrencePatch(): ICalendarEventCodecError {
  return new ICalendarEventCodecError(
    'unsupported-patch',
    'Only simple whole-series RRULE changes are supported',
  );
}

function readUnsupportedRecurrence(
  calendar: ICAL.Component,
  uid: string,
): CalendarEvent['unsupportedRecurrence'] {
  const hasThisAndFutureOverride = calendar
    .getAllSubcomponents('vevent')
    .some((vevent) => {
      const recurrenceId = vevent.getFirstProperty('recurrence-id');
      if (
        textValue(vevent.getFirstPropertyValue('uid')) !== uid ||
        !recurrenceId
      ) {
        return false;
      }

      return (
        recurrenceId.getFirstParameter('range')?.toUpperCase() ===
        'THISANDFUTURE'
      );
    });

  return hasThisAndFutureOverride ? 'range-this-and-future' : undefined;
}

function findMasterEvent(
  calendar: ICAL.Component,
  uid?: string,
): ICAL.Component | undefined {
  const events = calendar.getAllSubcomponents('vevent');
  const matching = uid
    ? events.filter(
        (event) => textValue(event.getFirstPropertyValue('uid')) === uid,
      )
    : events;

  return (
    matching.find((event) => !event.hasProperty('recurrence-id')) ?? matching[0]
  );
}

function readRecurrence(
  calendar: ICAL.Component,
  master: ICAL.Component,
  uid: string,
): CalendarEventRecurrence | undefined {
  const recurrence: CalendarEventRecurrence = {};
  const rule = master.getFirstPropertyValue('rrule');
  if (rule !== null && rule !== undefined) {
    recurrence.rrule = String(rule);
  }

  const rdates = readRecurrenceDates(master, 'rdate');
  const exdates = readRecurrenceDates(master, 'exdate');
  if (rdates.length > 0) {
    recurrence.rdates = rdates;
  }
  if (exdates.length > 0) {
    recurrence.exdates = exdates;
  }

  const masterRecurrenceId = master.getFirstProperty('recurrence-id');
  if (masterRecurrenceId) {
    recurrence.recurrenceId = readDateTimeProperty(masterRecurrenceId);
  }

  const overrides = calendar
    .getAllSubcomponents('vevent')
    .filter(
      (event) =>
        event !== master &&
        textValue(event.getFirstPropertyValue('uid')) === uid &&
        event.hasProperty('recurrence-id'),
    )
    .map(readRecurrenceOverride);
  if (overrides.length > 0) {
    recurrence.overrides = overrides;
  }

  return Object.keys(recurrence).length > 0 ? recurrence : undefined;
}

function readRecurrenceOverride(
  vevent: ICAL.Component,
): CalendarEventRecurrenceOverride {
  const recurrenceId = vevent.getFirstProperty('recurrence-id');
  if (!recurrenceId) {
    throw new ICalendarEventCodecError(
      'invalid-timing',
      'Recurrence override VEVENT must contain RECURRENCE-ID',
    );
  }

  const hasStart = vevent.hasProperty('dtstart');
  const hasEnd = vevent.hasProperty('dtend');
  const hasDuration = vevent.hasProperty('duration');

  const override: CalendarEventRecurrenceOverride = {
    recurrenceId: readDateTimeProperty(recurrenceId),
  };
  // Keep unsupported or incomplete exception timing in the raw resource, but
  // do not let it block decoding the recurrence identity and status.
  if (hasStart && hasEnd) {
    override.timing = readRecurrenceTimingWithEnd(vevent);
  } else if (hasStart && hasDuration) {
    override.timing = readRecurrenceTimingWithDuration(vevent);
  }

  const status = readStatus(vevent.getFirstPropertyValue('status'));
  if (status) {
    override.status = status;
  }

  return override;
}

function readRecurrenceDates(
  component: ICAL.Component,
  name: 'rdate',
): CalendarEventRecurrenceDate[];
function readRecurrenceDates(
  component: ICAL.Component,
  name: 'exdate',
): CalendarEventDateTime[];
function readRecurrenceDates(
  component: ICAL.Component,
  name: 'rdate' | 'exdate',
): CalendarEventRecurrenceDate[] {
  return component.getAllProperties(name).flatMap((property) => {
    let values: ReturnType<ICAL.Property['getValues']>;
    try {
      values = property.getValues();
    } catch {
      // Keep malformed source data opaque in the parsed VCALENDAR. RDATE writes
      // preflight the raw property and fail closed before changing it.
      return [];
    }
    return values.flatMap<CalendarEventRecurrenceDate>((value) => {
      if (value instanceof ICAL.Time) {
        return [readDateTimeValue(value, property)];
      }

      if (name === 'rdate' && value instanceof ICAL.Period) {
        try {
          return [readPeriodRdateValue(value, property)];
        } catch {
          return [];
        }
      }

      return [];
    });
  });
}

function readPeriodRdateValue(
  value: ICAL.Period,
  property: ICAL.Property,
): Extract<CalendarEventRecurrenceDate, { type: 'period' }> {
  const start = value.start;
  const end = value.end;
  if (!(start instanceof ICAL.Time) || start.isDate) {
    throw unsupportedRecurrencePatch();
  }
  if (end instanceof ICAL.Time && !end.isDate) {
    if (start.compare(end) >= 0) {
      throw unsupportedRecurrencePatch();
    }
    return {
      type: 'period',
      timing: {
        type: 'end',
        start: readDateTimeValue(start, property),
        end: readDateTimeValue(end, property),
      },
    };
  }
  if (value.duration instanceof ICAL.Duration) {
    const duration = value.duration;
    const components = [
      duration.weeks,
      duration.days,
      duration.hours,
      duration.minutes,
      duration.seconds,
    ];
    if (
      duration.isNegative ||
      components.some(
        (component) => !Number.isSafeInteger(component) || component < 0,
      ) ||
      components.every((component) => component === 0) ||
      (duration.weeks > 0 &&
        [
          duration.days,
          duration.hours,
          duration.minutes,
          duration.seconds,
        ].some((component) => component > 0))
    ) {
      throw unsupportedRecurrencePatch();
    }
    return {
      type: 'period',
      timing: {
        type: 'duration',
        start: readDateTimeValue(start, property),
        duration: readDuration(duration),
      },
    };
  }
  throw unsupportedRecurrencePatch();
}

function readDateTimeProperty(property: ICAL.Property): CalendarEventDateTime {
  const value = property.getFirstValue();
  if (!(value instanceof ICAL.Time)) {
    throw new ICalendarEventCodecError(
      'invalid-timing',
      `${property.name.toUpperCase()} must be a date or date-time value`,
    );
  }

  return readDateTimeValue(value, property);
}

function readDateTimeValue(
  value: ICAL.Time,
  property: ICAL.Property,
): CalendarEventDateTime {
  if (value.isDate) {
    return { type: 'date', value: formatDate(value) };
  }

  const tzid = property.getFirstParameter('tzid');
  if (typeof tzid === 'string' && tzid.length > 0) {
    return {
      type: 'date-time',
      value: { local: formatLocalDateTime(value), timezone: tzid },
    };
  }

  if (value.zone === ICAL.Timezone.utcTimezone) {
    return {
      type: 'date-time',
      value: { local: formatLocalDateTime(value), timezone: 'UTC' },
    };
  }

  return {
    type: 'floating-date-time',
    value: formatLocalDateTime(value),
  };
}

function readRecurrenceTimingWithDuration(
  vevent: ICAL.Component,
): CalendarEventRecurrenceTiming {
  const startProperty = vevent.getFirstProperty('dtstart');
  const durationProperty = vevent.getFirstProperty('duration');
  const start = startProperty?.getFirstValue();
  const duration = durationProperty?.getFirstValue();

  if (
    !startProperty ||
    !(start instanceof ICAL.Time) ||
    !(duration instanceof ICAL.Duration)
  ) {
    throw new ICalendarEventCodecError(
      'invalid-timing',
      'Recurrence override DTSTART and DURATION must be date or date-time values',
    );
  }

  return {
    type: 'duration',
    start: readDateTimeValue(start, startProperty),
    duration: readDuration(duration),
  };
}

function readRecurrenceTimingWithEnd(
  vevent: ICAL.Component,
): CalendarEventRecurrenceTiming {
  const startProperty = vevent.getFirstProperty('dtstart');
  const endProperty = vevent.getFirstProperty('dtend');
  const start = startProperty?.getFirstValue();
  const end = endProperty?.getFirstValue();

  if (
    !startProperty ||
    !endProperty ||
    !(start instanceof ICAL.Time) ||
    !(end instanceof ICAL.Time)
  ) {
    throw new ICalendarEventCodecError(
      'invalid-timing',
      'Recurrence override DTSTART and DTEND must be date or date-time values',
    );
  }

  if (start.isDate !== end.isDate) {
    throw new ICalendarEventCodecError(
      'invalid-timing',
      'Recurrence override DTSTART and DTEND must use the same value type',
    );
  }

  return {
    type: 'end',
    start: readDateTimeValue(start, startProperty),
    end: readDateTimeValue(end, endProperty),
  };
}

function readDuration(duration: ICAL.Duration): CalendarEventDuration {
  return {
    weeks: duration.weeks,
    days: duration.days,
    hours: duration.hours,
    minutes: duration.minutes,
    seconds: duration.seconds,
    isNegative: duration.isNegative,
  };
}

function readTiming(vevent: ICAL.Component): CalendarEventTiming {
  const startProperty = vevent.getFirstProperty('dtstart');
  const endProperty = vevent.getFirstProperty('dtend');

  if (!startProperty || !endProperty) {
    throw new ICalendarEventCodecError(
      'missing-timing',
      'VEVENT must contain DTSTART and DTEND',
    );
  }

  const start = startProperty.getFirstValue();
  const end = endProperty.getFirstValue();

  if (!(start instanceof ICAL.Time) || !(end instanceof ICAL.Time)) {
    throw new ICalendarEventCodecError(
      'invalid-timing',
      'VEVENT DTSTART and DTEND must be date or date-time values',
    );
  }

  if (start.isDate !== end.isDate) {
    throw new ICalendarEventCodecError(
      'invalid-timing',
      'VEVENT DTSTART and DTEND must use the same value type',
    );
  }

  if (start.isDate) {
    return {
      type: 'all-day',
      startDate: formatDate(start),
      endDate: formatDate(end),
    };
  }

  return {
    type: 'timed',
    start: readMasterDateTimeValue(start, startProperty),
    end: readMasterDateTimeValue(end, endProperty),
  };
}

function readMasterDateTimeValue(
  time: ICAL.Time,
  property: ICAL.Property,
): CalendarEventTimedDateTime {
  const local = formatLocalDateTime(time);
  const tzid = property.getFirstParameter('tzid');
  if (typeof tzid === 'string' && tzid.length > 0) {
    return { type: 'zoned', local, timezone: tzid };
  }

  if (time.zone === ICAL.Timezone.utcTimezone) {
    return { type: 'zoned', local, timezone: 'UTC' };
  }

  return { type: 'floating', local };
}

function formatDate(time: ICAL.Time): string {
  return [
    String(time.year).padStart(4, '0'),
    String(time.month).padStart(2, '0'),
    String(time.day).padStart(2, '0'),
  ].join('-');
}

function formatLocalDateTime(time: ICAL.Time): string {
  return `${formatDate(time)}T${String(time.hour).padStart(2, '0')}:${String(
    time.minute,
  ).padStart(2, '0')}:${String(time.second).padStart(2, '0')}`;
}

function readStatus(value: unknown): CalendarEventStatus | undefined {
  switch (textValue(value)?.toUpperCase()) {
    case 'CONFIRMED':
      return 'confirmed';
    case 'TENTATIVE':
      return 'tentative';
    case 'CANCELLED':
      return 'cancelled';
    default:
      return undefined;
  }
}

function readTransparency(
  value: unknown,
): CalendarEventTransparency | undefined {
  switch (textValue(value)?.toUpperCase()) {
    case 'OPAQUE':
      return 'opaque';
    case 'TRANSPARENT':
      return 'transparent';
    default:
      return undefined;
  }
}

function readCategories(vevent: ICAL.Component): string[] | undefined {
  const categories = vevent
    .getAllProperties('categories')
    .flatMap((property) => property.getValues())
    .flatMap((value) => {
      const text = textValue(value);
      return text ? [text] : [];
    });

  return categories.length > 0 ? categories : undefined;
}

function textValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function readCalendarEventRevision(
  vevent: ICAL.Component,
  sourceProperties?: RawRevisionProperty[],
): CalendarEventRevision | undefined {
  const revision: {
    dtstamp?: string;
    created?: string;
    lastModified?: string;
    sequence?: number;
  } = {};
  const dtstamp = sourceProperties
    ? inspectSourceUtcTimestamp(vevent, sourceProperties, 'dtstamp')
    : inspectUtcTimestamp(vevent, 'dtstamp');
  const created = sourceProperties
    ? inspectSourceUtcTimestamp(vevent, sourceProperties, 'created')
    : inspectUtcTimestamp(vevent, 'created');
  const lastModified = sourceProperties
    ? inspectSourceUtcTimestamp(vevent, sourceProperties, 'last-modified')
    : inspectUtcTimestamp(vevent, 'last-modified');
  const sequence = sourceProperties
    ? inspectSourceSequence(vevent, sourceProperties)
    : inspectSequence(vevent);

  if (dtstamp.kind === 'valid') {
    revision.dtstamp = dtstamp.value;
  }
  if (created.kind === 'valid') {
    revision.created = created.value;
  }
  if (lastModified.kind === 'valid') {
    revision.lastModified = lastModified.value;
  }
  if (sequence.kind === 'valid') {
    revision.sequence = sequence.value;
  }

  return Object.keys(revision).length > 0 ? revision : undefined;
}

function readUpdatedCalendarEventRevision(
  vevent: ICAL.Component,
  sourceProperties?: RawRevisionProperty[],
): CalendarEventRevision | undefined {
  const revision = readCalendarEventRevision(vevent);
  if (!revision || !sourceProperties) {
    return revision;
  }

  const updatedRevision = { ...revision };
  const created = inspectSourceUtcTimestamp(
    vevent,
    sourceProperties,
    'created',
  );
  if (created.kind === 'valid') {
    updatedRevision.created = created.value;
  } else {
    delete updatedRevision.created;
  }

  return Object.keys(updatedRevision).length > 0 ? updatedRevision : undefined;
}

function inspectSourceUtcTimestamp(
  vevent: ICAL.Component,
  sourceProperties: RawRevisionProperty[],
  name: 'dtstamp' | 'created' | 'last-modified',
): RevisionPropertyState<string> {
  const source = inspectRawUtcTimestamp(sourceProperties, name);
  if (source.kind !== 'valid') {
    return source;
  }

  const parsed = inspectUtcTimestamp(vevent, name);
  return parsed.kind === 'valid' ? source : { kind: 'invalid' };
}

function inspectSourceSequence(
  vevent: ICAL.Component,
  sourceProperties: RawRevisionProperty[],
): RevisionPropertyState<number> {
  const source = inspectRawSequence(sourceProperties);
  if (source.kind !== 'valid') {
    return source;
  }

  const parsed = inspectSequence(vevent);
  return parsed.kind === 'valid' ? source : { kind: 'invalid' };
}

function inspectRawUtcTimestamp(
  sourceProperties: RawRevisionProperty[],
  name: 'dtstamp' | 'created' | 'last-modified',
): RevisionPropertyState<string> {
  const properties = sourceProperties.filter(
    (property) => property.name === name,
  );
  if (properties.length === 0) {
    return { kind: 'missing' };
  }
  if (properties.length !== 1) {
    return { kind: 'invalid' };
  }

  const parts = parseContentLine(properties[0].value);
  if (
    !parts ||
    hasCalendarParameter(parts.header, 'tzid') ||
    !isValidCompactUtcDateTime(parts.value) ||
    (calendarParameterValue(parts.header, 'value') !== undefined &&
      calendarParameterValue(parts.header, 'value')?.toUpperCase() !==
        'DATE-TIME') ||
    !/^\d{8}T\d{6}Z$/.test(parts.value)
  ) {
    return { kind: 'invalid' };
  }

  return { kind: 'valid', value: compactUtcTimestampToIso(parts.value) };
}

function inspectRawSequence(
  sourceProperties: RawRevisionProperty[],
): RevisionPropertyState<number> {
  const properties = sourceProperties.filter(
    (property) => property.name === 'sequence',
  );
  if (properties.length === 0) {
    return { kind: 'missing' };
  }
  if (properties.length !== 1) {
    return { kind: 'invalid' };
  }

  const parts = parseContentLine(properties[0].value);
  if (
    !parts ||
    (calendarParameterValue(parts.header, 'value') !== undefined &&
      calendarParameterValue(parts.header, 'value')?.toUpperCase() !==
        'INTEGER') ||
    !/^\+?\d+$/.test(parts.value)
  ) {
    return { kind: 'invalid' };
  }

  const value = Number(parts.value);
  return Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_ICALENDAR_SEQUENCE
    ? { kind: 'valid', value }
    : { kind: 'invalid' };
}

function readMasterRevisionProperties(
  source: string,
): RawRevisionProperty[] | undefined {
  const lines = readContentLines(source);
  const range = findMasterVeventRange(lines);
  if (!range) {
    return undefined;
  }

  const properties: RawRevisionProperty[] = [];
  let nestedComponents = 0;
  for (let index = range.start + 1; index < range.end; index += 1) {
    const line = lines[index];
    const marker = line.value.toUpperCase();
    if (marker.startsWith('BEGIN:')) {
      nestedComponents += 1;
      continue;
    }
    if (marker.startsWith('END:')) {
      nestedComponents = Math.max(0, nestedComponents - 1);
      continue;
    }
    if (nestedComponents > 0) {
      continue;
    }

    const parsed = parseContentLine(line.value);
    if (parsed && isRevisionPropertyName(parsed.name)) {
      properties.push({
        ...line,
        name: parsed.name,
      });
    }
  }

  return properties;
}

function findMasterVeventRange(
  lines: ICalendarContentLine[],
): { start: number; end: number } | undefined {
  let start: number | undefined;
  let hasRecurrenceId = false;
  let nestedComponents = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const marker = lines[index].value.toUpperCase();
    if (start === undefined) {
      if (marker === 'BEGIN:VEVENT') {
        start = index;
        hasRecurrenceId = false;
        nestedComponents = 0;
      }
      continue;
    }

    if (marker === 'END:VEVENT' && nestedComponents === 0) {
      if (!hasRecurrenceId) {
        return { start, end: index };
      }
      start = undefined;
      continue;
    }
    if (marker.startsWith('BEGIN:')) {
      nestedComponents += 1;
      continue;
    }
    if (marker.startsWith('END:')) {
      nestedComponents = Math.max(0, nestedComponents - 1);
      continue;
    }
    if (nestedComponents === 0) {
      hasRecurrenceId ||=
        contentLinePropertyName(lines[index].value) === 'recurrence-id';
    }
  }

  return undefined;
}

function restoreRevisionProperties(
  serialized: string,
  sourceProperties: RawRevisionProperty[] | undefined,
  names: Array<RawRevisionProperty['name']>,
): string {
  if (!sourceProperties) {
    return serialized;
  }

  const lines = readContentLines(serialized);
  const range = findMasterVeventRange(lines);
  if (!range) {
    return serialized;
  }

  const selectedNames = new Set(names);
  const sourceByName = new Map<
    RawRevisionProperty['name'],
    RawRevisionProperty[]
  >();
  for (const property of sourceProperties) {
    if (!selectedNames.has(property.name)) {
      continue;
    }
    const matching = sourceByName.get(property.name) ?? [];
    matching.push(property);
    sourceByName.set(property.name, matching);
  }
  const body: ICalendarContentLine[] = [];
  const outputCounts = new Map<RawRevisionProperty['name'], number>();
  const matchedSource = new Set<RawRevisionProperty>();
  let nestedComponents = 0;

  for (let index = range.start + 1; index < range.end; index += 1) {
    const line = lines[index];
    const marker = line.value.toUpperCase();
    if (marker.startsWith('BEGIN:')) {
      nestedComponents += 1;
      body.push(line);
      continue;
    }
    if (marker.startsWith('END:')) {
      nestedComponents = Math.max(0, nestedComponents - 1);
      body.push(line);
      continue;
    }

    const propertyName =
      nestedComponents === 0 ? contentLinePropertyName(line.value) : undefined;
    if (
      propertyName &&
      isRevisionPropertyName(propertyName) &&
      selectedNames.has(propertyName)
    ) {
      const occurrence = outputCounts.get(propertyName) ?? 0;
      outputCounts.set(propertyName, occurrence + 1);
      const replacement = sourceByName.get(propertyName)?.[occurrence];
      if (replacement) {
        body.push(replacement);
        matchedSource.add(replacement);
      }
      continue;
    }
    body.push(line);
  }

  const unmatchedSource = sourceProperties.filter(
    (property) =>
      selectedNames.has(property.name) && !matchedSource.has(property),
  );
  if (unmatchedSource.length > 0) {
    const uidIndex = body.findIndex(
      (line) => contentLinePropertyName(line.value) === 'uid',
    );
    body.splice(uidIndex < 0 ? 0 : uidIndex + 1, 0, ...unmatchedSource);
  }
  lines.splice(range.start + 1, range.end - range.start - 1, ...body);

  const physicalLines = lines.flatMap((line) => line.physicalLines);
  const hasFinalLineEnding = /(?:\r\n|\n|\r)$/.test(serialized);
  return `${physicalLines.join('\r\n')}${hasFinalLineEnding ? '\r\n' : ''}`;
}

function readContentLines(source: string): ICalendarContentLine[] {
  const physicalLines = source.split(/\r\n|\n|\r/);
  if (physicalLines.at(-1) === '') {
    physicalLines.pop();
  }

  const lines: ICalendarContentLine[] = [];
  for (const physicalLine of physicalLines) {
    if (/^[ \t]/.test(physicalLine) && lines.length > 0) {
      const previous = lines[lines.length - 1];
      previous.value += physicalLine.slice(1);
      previous.physicalLines.push(physicalLine);
    } else {
      lines.push({ value: physicalLine, physicalLines: [physicalLine] });
    }
  }
  return lines;
}

function parseContentLine(
  line: string,
): { name: string; header: string; value: string } | undefined {
  const colonIndex = contentLineColonIndex(line);
  if (colonIndex < 0) {
    return undefined;
  }

  const header = line.slice(0, colonIndex);
  const separator = header.indexOf(';');
  const name = (separator < 0 ? header : header.slice(0, separator))
    .trim()
    .toLowerCase();
  return name ? { name, header, value: line.slice(colonIndex + 1) } : undefined;
}

function contentLineColonIndex(line: string): number {
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === '"' && line[index - 1] !== '^') {
      quoted = !quoted;
    } else if (line[index] === ':' && !quoted) {
      return index;
    }
  }
  return -1;
}

function contentLinePropertyName(line: string): string | undefined {
  return parseContentLine(line)?.name;
}

function calendarParameterValue(
  header: string,
  parameterName: string,
): string | undefined {
  const parameters = header.split(';').slice(1);
  const parameter = parameters.find(
    (item) => item.split('=', 1)[0].trim().toLowerCase() === parameterName,
  );
  return parameter?.includes('=')
    ? parameter.slice(parameter.indexOf('=') + 1).replace(/^"|"$/g, '')
    : undefined;
}

function hasCalendarParameter(header: string, parameterName: string): boolean {
  return header
    .split(';')
    .slice(1)
    .some(
      (item) => item.split('=', 1)[0].trim().toLowerCase() === parameterName,
    );
}

function isRevisionPropertyName(
  name: string,
): name is RawRevisionProperty['name'] {
  return (
    name === 'dtstamp' ||
    name === 'created' ||
    name === 'last-modified' ||
    name === 'sequence'
  );
}

function compactUtcTimestampToIso(value: string): string {
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(
    6,
    8,
  )}T${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}Z`;
}

function isValidCompactUtcDateTime(value: string): boolean {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value);
  if (!match) {
    return false;
  }

  const [, yearText, monthText, dayText, hourText, minuteText, secondText] =
    match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const daysInMonth = [
    31,
    isGregorianLeapYear(year) ? 29 : 28,
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
  ][month - 1];

  return (
    daysInMonth !== undefined &&
    day >= 1 &&
    day <= daysInMonth &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59
  );
}

function isGregorianLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function inspectUtcTimestamp(
  component: ICAL.Component,
  name: 'dtstamp' | 'created' | 'last-modified',
): RevisionPropertyState<string> {
  const properties = component.getAllProperties(name);
  if (properties.length === 0) {
    return { kind: 'missing' };
  }
  if (properties.length !== 1) {
    return { kind: 'invalid' };
  }

  const property = properties[0];
  const value = property.getFirstValue();
  const tzid = property.getFirstParameter('tzid');
  if (
    !(value instanceof ICAL.Time) ||
    value.isDate ||
    value.zone !== ICAL.Timezone.utcTimezone ||
    (tzid !== undefined && tzid !== null) ||
    !/^\d{8}T\d{6}Z$/.test(value.toICALString())
  ) {
    return { kind: 'invalid' };
  }

  return { kind: 'valid', value: `${formatLocalDateTime(value)}Z` };
}

function inspectSequence(
  vevent: ICAL.Component,
): RevisionPropertyState<number> {
  const properties = vevent.getAllProperties('sequence');
  if (properties.length === 0) {
    return { kind: 'missing' };
  }
  if (properties.length !== 1) {
    return { kind: 'invalid' };
  }

  const value = properties[0].getFirstValue();
  if (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_ICALENDAR_SEQUENCE
  ) {
    return { kind: 'valid', value };
  }

  if (typeof value === 'string' && /^\+?\d+$/.test(value)) {
    const parsed = Number(value);
    if (
      Number.isSafeInteger(parsed) &&
      parsed >= 0 &&
      parsed <= MAX_ICALENDAR_SEQUENCE
    ) {
      return { kind: 'valid', value: parsed };
    }
  }

  return { kind: 'invalid' };
}

function setInitialRevisionMetadata(vevent: ICAL.Component, now: Date): void {
  setUtcTimestamp(vevent, 'dtstamp', now);
  setUtcTimestamp(vevent, 'created', now);
  setUtcTimestamp(vevent, 'last-modified', now);
  vevent.updatePropertyWithValue('sequence', 0);
}

function updateRevisionMetadata(
  vevent: ICAL.Component,
  now: Date,
  sourceProperties?: RawRevisionProperty[],
): boolean {
  const sequence = inspectSequence(vevent);
  const dtstamp = inspectUtcTimestamp(vevent, 'dtstamp');
  const lastModified = inspectUtcTimestamp(vevent, 'last-modified');
  if (
    sequence.kind === 'invalid' ||
    dtstamp.kind === 'invalid' ||
    lastModified.kind === 'invalid'
  ) {
    return false;
  }
  if (
    sourceProperties &&
    (!revisionStatesAgree(inspectRawSequence(sourceProperties), sequence) ||
      !revisionStatesAgree(
        inspectRawUtcTimestamp(sourceProperties, 'dtstamp'),
        dtstamp,
      ) ||
      !revisionStatesAgree(
        inspectRawUtcTimestamp(sourceProperties, 'last-modified'),
        lastModified,
      ))
  ) {
    return false;
  }

  const previousSequence = sequence.kind === 'valid' ? sequence.value : 0;
  const nextSequence = previousSequence + 1;
  if (
    !Number.isSafeInteger(nextSequence) ||
    nextSequence > MAX_ICALENDAR_SEQUENCE
  ) {
    return false;
  }

  setUtcTimestamp(vevent, 'dtstamp', now);
  setUtcTimestamp(vevent, 'last-modified', now);
  vevent.updatePropertyWithValue('sequence', nextSequence);
  return true;
}

/** Parsed normalization must never turn malformed raw metadata into absence. */
function revisionStatesAgree<T extends string | number>(
  source: RevisionPropertyState<T>,
  parsed: RevisionPropertyState<T>,
): boolean {
  if (source.kind === 'missing') return parsed.kind === 'missing';
  return (
    source.kind === 'valid' &&
    parsed.kind === 'valid' &&
    source.value === parsed.value
  );
}

function setUtcTimestamp(
  vevent: ICAL.Component,
  name: 'dtstamp' | 'created' | 'last-modified',
  value: Date,
): void {
  vevent.updatePropertyWithValue(
    name,
    ICAL.Time.fromDateTimeString(toICalendarUtcDateTime(value)),
  );
}

function toICalendarUtcDateTime(value: Date): string {
  const iso = value.toISOString();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(iso)) {
    throw new RangeError(
      'Timestamp year must be in the four-digit RFC 5545 range',
    );
  }

  return `${iso.slice(0, 19)}Z`;
}

function hasOwn(
  value: CalendarEventPatch,
  key: keyof CalendarEventPatch,
): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function setTextProperty(
  component: ICAL.Component,
  name: string,
  value: string,
): void {
  component.updatePropertyWithValue(name, value);
}

function setOptionalProperty(
  component: ICAL.Component,
  name: string,
  value: string | number | undefined,
): void {
  if (value === undefined) {
    component.removeAllProperties(name);
  } else {
    component.updatePropertyWithValue(name, value);
  }
}

function setCategories(
  component: ICAL.Component,
  categories: string[] | undefined,
): void {
  component.removeAllProperties('categories');

  if (!categories || categories.length === 0) {
    return;
  }

  const property = new ICAL.Property('categories');
  property.setValues(categories);
  component.addProperty(property);
}

function setTiming(
  component: ICAL.Component,
  timing: CalendarEventTiming,
): void {
  if (timing.type === 'all-day') {
    setTimeProperty(
      component,
      'dtstart',
      ICAL.Time.fromDateString(timing.startDate),
    );
    setTimeProperty(
      component,
      'dtend',
      ICAL.Time.fromDateString(timing.endDate),
    );
    return;
  }

  setTimeProperty(
    component,
    'dtstart',
    timedValueForEventEndpoint(timing.start),
    timing.start.type === 'zoned' ? timing.start.timezone : undefined,
  );
  setTimeProperty(
    component,
    'dtend',
    timedValueForEventEndpoint(timing.end),
    timing.end.type === 'zoned' ? timing.end.timezone : undefined,
  );
}

function timedValueForEventEndpoint(
  value: CalendarEventTimedDateTime,
): ICAL.Time {
  return value.type === 'floating'
    ? ICAL.Time.fromDateTimeString(normalizeLocalDateTime(value.local))
    : timedValue(value.local, value.timezone);
}

function setTimeProperty(
  component: ICAL.Component,
  name: string,
  value: ICAL.Time,
  timezone?: string,
): void {
  let property = component.getFirstProperty(name);

  if (!property) {
    property = new ICAL.Property(name);
    component.addProperty(property);
  }

  property.setValue(value);

  if (value.isDate || timezone === undefined || timezone === 'UTC') {
    property.removeParameter('tzid');
  } else {
    property.setParameter('tzid', timezone);
  }
}

function timedValue(local: string, timezone: string): ICAL.Time {
  const normalized = normalizeLocalDateTime(local);
  return ICAL.Time.fromDateTimeString(
    timezone === 'UTC' ? `${normalized}Z` : normalized,
  );
}

function normalizeLocalDateTime(value: string): string {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?$/.exec(
      value,
    );

  if (!match) {
    throw new ICalendarEventCodecError(
      'invalid-timing',
      `Invalid local date-time: ${value}`,
    );
  }

  return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${
    match[6] ?? '00'
  }`;
}
