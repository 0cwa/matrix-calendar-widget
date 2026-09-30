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
  CalendarEventStatus,
  CalendarEventTimedDateTime,
  CalendarEventTiming,
  CalendarEventTransparency,
  CalendarId,
  calendarEventRecurrenceIdentity,
  isSupportedCalendarEventOccurrenceExclusion,
  parseSupportedCalendarEventRecurrenceRule,
} from '@matrix-calendar-widget/calendar';
import ICAL from 'ical.js';
import { hasUnsupportedTimezoneRules } from './ICalendarTimezoneProjectionSafety';

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
    if (hasAlarmPatch && patch.alarm !== undefined) {
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
      } else {
        setRecurrenceRule(vevent, recurrenceWrite?.rrule);
      }
    }
    if (hasAlarmPatch) {
      setDisplayAlarm(vevent, patch.alarm, patch.title ?? this.event.title);
    }

    const recurrence = hasRecurrencePatch
      ? recurrenceWrite && 'exdate' in recurrenceWrite
        ? readRecurrence(calendar, vevent, this.event.uid)
        : recurrenceWrite?.rrule
          ? { rrule: canonicalizeRecurrenceRule(recurrenceWrite.rrule) }
          : undefined
      : this.event.recurrence;

    const event: CalendarEvent = {
      ...this.event,
      ...patch,
      title: patch.title ?? this.event.title,
      timing: patch.timing ?? this.event.timing,
      recurrence,
    };
    if (hasAlarmPatch) {
      if (patch.alarm) {
        event.alarm = patch.alarm;
      } else {
        delete event.alarm;
      }
      delete event.unsupportedAlarm;
    }

    return {
      event,
      icalendar: calendar.toString(),
    };
  }
}

export class ICalendarEventCodec {
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
      ...(alarmState.alarm ? { alarm: alarmState.alarm } : {}),
      ...(alarmState.unsupported ? { unsupportedAlarm: true } : {}),
      ...(unsupportedRecurrence ? { unsupportedRecurrence } : {}),
      ...(unsupportedTimezone ? { unsupportedTimezone: true } : {}),
    };

    return new ParsedICalendarEvent(
      calendar,
      event,
      hasMultipleMasterRules ? 'unsupported-recurrence' : undefined,
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

  if (
    Object.keys(fields).some((key) => key !== 'rrule') ||
    (fields.rrule !== undefined && typeof fields.rrule !== 'string')
  ) {
    throw unsupportedRecurrencePatch();
  }

  return { rrule: fields.rrule as string | undefined };
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
  alarm: CalendarEventDisplayAlarm | undefined,
  description: string,
): void {
  const existing = vevent.getAllSubcomponents('valarm');
  if (!alarm) {
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
  return component.getAllProperties(name).flatMap((property) =>
    property.getValues().flatMap<CalendarEventRecurrenceDate>((value) => {
      if (value instanceof ICAL.Time) {
        return [readDateTimeValue(value, property)];
      }

      if (name === 'rdate' && value instanceof ICAL.Period) {
        const start = value.start;
        const end = value.end;
        if (!(start instanceof ICAL.Time) || start.isDate) {
          return [];
        }

        if (end instanceof ICAL.Time && !end.isDate) {
          return [
            {
              type: 'period',
              timing: {
                type: 'end',
                start: readDateTimeValue(start, property),
                end: readDateTimeValue(end, property),
              },
            },
          ];
        }

        if (value.duration instanceof ICAL.Duration) {
          return [
            {
              type: 'period',
              timing: {
                type: 'duration',
                start: readDateTimeValue(start, property),
                duration: readDuration(value.duration),
              },
            },
          ];
        }
      }

      return [];
    }),
  );
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
