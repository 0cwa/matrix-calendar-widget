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
  CalendarEventExpansionError,
  CalendarEventId,
  CalendarEventInput,
  CalendarEventOccurrence,
  CalendarEventPatch,
  CalendarEventRecurrence,
  CalendarEventRecurrenceOverride,
  CalendarEventRecurrencePeriod,
  CalendarEventStatus,
  CalendarEventTiming,
  CalendarEventTransparency,
  CalendarId,
  CalendarTimeRange,
  ZonedCalendarDateTime,
  expandCalendarEvent,
  isCalendarEventRecurrenceRuleSupported,
} from '@matrix-calendar-widget/calendar';
import ICAL from 'ical.js';
import { createCalDavTimezoneResolver } from './CalDavTimezoneResolver';

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
  | 'invalid-recurrence'
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
  ) {}

  expandOccurrences(
    range: CalendarTimeRange,
    options: {
      rangeTimezone?: string;
      maxRuleCandidates?: number;
    } = {},
  ): CalendarEventOccurrence[] {
    if (hasRangedRecurrenceOverride(this.calendar, this.event.uid)) {
      throw new CalendarEventExpansionError(
        'unsupported-recurrence-override',
        'RECURRENCE-ID RANGE=THISANDFUTURE is preserved but cannot be expanded safely yet',
      );
    }
    return expandCalendarEvent(this.event, range, {
      ...options,
      timezoneResolver: createCalDavTimezoneResolver(
        this.calendar,
        options.maxRuleCandidates,
      ),
    });
  }

  applyPatch(patch: CalendarEventPatch): EncodedICalendarEvent {
    const calendar = ICAL.Component.fromString(this.calendar.toString());
    const vevent = findMasterEvent(calendar, this.event.uid);
    if (!vevent) {
      throw new ICalendarEventCodecError(
        'missing-event',
        'Parsed iCalendar no longer contains the target VEVENT',
      );
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
    if (hasOwn(patch, 'recurrence')) {
      setRecurrence(
        vevent,
        patch.recurrence,
        this.event.recurrence,
        patch.timing ?? this.event.timing,
      );
    }

    return {
      event: {
        ...this.event,
        ...patch,
        title: patch.title ?? this.event.title,
        timing: normalizeTiming(patch.timing ?? this.event.timing),
      },
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
    if (input.recurrence) {
      setRecurrence(vevent, input.recurrence, undefined, input.timing);
    }

    return {
      event: {
        ...input,
        timing: normalizeTiming(input.timing),
        id: eventId,
        calendarId,
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

    assertSingleRrulePerVevent(calendar);

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
      ...(recurrence ? { recurrence } : {}),
    };

    return new ParsedICalendarEvent(calendar, event);
  }
}

function assertSingleRrulePerVevent(calendar: ICAL.Component): void {
  for (const vevent of calendar.getAllSubcomponents('vevent')) {
    if (vevent.getAllProperties('rrule').length > 1) {
      throw new ICalendarEventCodecError(
        'invalid-recurrence',
        'A VEVENT cannot contain multiple RRULE properties',
      );
    }
  }
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
  if (typeof rule === 'string') {
    recurrence.rrule = rule;
  } else if (
    rule &&
    typeof (rule as { toString?: unknown }).toString === 'function'
  ) {
    recurrence.rrule = String(rule);
  }

  const { rdates, rdatePeriods } = readRdateProperties(master);
  const exdates = readDateTimeProperties(master, 'exdate');
  if (rdates.length > 0) {
    recurrence.rdates = rdates;
  }
  if (rdatePeriods.length > 0) {
    recurrence.rdatePeriods = rdatePeriods;
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
        event.hasProperty('recurrence-id') &&
        !hasRecurrenceRange(event),
    )
    .map(readRecurrenceOverride);
  if (overrides.length > 0) {
    recurrence.overrides = overrides;
  }

  return Object.keys(recurrence).length > 0 ? recurrence : undefined;
}

function hasRecurrenceRange(vevent: ICAL.Component): boolean {
  const recurrenceId = vevent.getFirstProperty('recurrence-id');
  return Boolean(recurrenceId?.getFirstParameter('range'));
}

function hasRangedRecurrenceOverride(
  calendar: ICAL.Component,
  uid: string,
): boolean {
  return calendar
    .getAllSubcomponents('vevent')
    .some(
      (vevent) =>
        textValue(vevent.getFirstPropertyValue('uid')) === uid &&
        hasRecurrenceRange(vevent),
    );
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
  if (hasStart !== hasEnd) {
    throw new ICalendarEventCodecError(
      'invalid-timing',
      'Recurrence override DTSTART and DTEND must be provided together',
    );
  }

  return {
    recurrenceId: readDateTimeProperty(recurrenceId),
    title: textValue(vevent.getFirstPropertyValue('summary')),
    description: textValue(vevent.getFirstPropertyValue('description')),
    timing: hasStart ? readTiming(vevent) : undefined,
    status: readStatus(vevent.getFirstPropertyValue('status')),
    transparency: readTransparency(vevent.getFirstPropertyValue('transp')),
    location: textValue(vevent.getFirstPropertyValue('location')),
    url: textValue(vevent.getFirstPropertyValue('url')),
    categories: readCategories(vevent),
    priority: numberValue(vevent.getFirstPropertyValue('priority')),
  };
}

function readDateTimeProperties(
  component: ICAL.Component,
  name: 'exdate',
): CalendarEventDateTime[] {
  return component.getAllProperties(name).flatMap((property) =>
    property.getValues().flatMap((value) => {
      if (!(value instanceof ICAL.Time)) {
        return [];
      }
      return [readDateTimeValue(value, property)];
    }),
  );
}

function readRdateProperties(component: ICAL.Component): {
  rdates: CalendarEventDateTime[];
  rdatePeriods: CalendarEventRecurrencePeriod[];
} {
  const rdates: CalendarEventDateTime[] = [];
  const rdatePeriods: CalendarEventRecurrencePeriod[] = [];

  for (const property of component.getAllProperties('rdate')) {
    for (const value of property.getValues()) {
      if (value instanceof ICAL.Time) {
        rdates.push(readDateTimeValue(value, property));
        continue;
      }
      if (!(value instanceof ICAL.Period)) {
        continue;
      }
      if (value.start.isDate || (value.end && value.end.isDate)) {
        throw new ICalendarEventCodecError(
          'invalid-timing',
          'RDATE PERIOD values must use DATE-TIME values',
        );
      }

      rdatePeriods.push({
        start: readPeriodDateTime(value.start, property),
        end: value.end ? readPeriodDateTime(value.end, property) : undefined,
        duration: value.duration?.toString(),
      });
    }
  }

  return { rdates, rdatePeriods };
}

function readPeriodDateTime(
  value: ICAL.Time,
  property: ICAL.Property,
): { type: 'date-time'; value: ZonedCalendarDateTime } {
  const dateTime = readDateTimeValue(value, property);
  if (dateTime.type !== 'date-time') {
    throw new ICalendarEventCodecError(
      'invalid-timing',
      'RDATE PERIOD values must use DATE-TIME values',
    );
  }
  return dateTime;
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
  property?: ICAL.Property,
): CalendarEventDateTime {
  if (value.isDate) {
    return { type: 'date', value: formatDate(value) };
  }

  return {
    type: 'date-time',
    value: {
      local: formatLocalDateTime(value),
      ...readTimezone(property, value),
    },
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
    start: {
      local: formatLocalDateTime(start),
      ...readTimezone(startProperty, start),
    },
    end: {
      local: formatLocalDateTime(end),
      ...readTimezone(endProperty, end),
    },
  };
}

function readTimezone(
  property: ICAL.Property | undefined,
  time: ICAL.Time,
): Pick<ZonedCalendarDateTime, 'timezone' | 'mode'> {
  const tzid = property?.getFirstParameter('tzid');
  if (typeof tzid === 'string' && tzid.length > 0) {
    return { timezone: tzid, mode: 'tzid' };
  }

  if (time.zone === ICAL.Timezone.utcTimezone || time.zone?.tzid === 'Z') {
    return { timezone: 'UTC', mode: 'utc' };
  }

  return { timezone: 'floating', mode: 'floating' };
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

function setRecurrence(
  component: ICAL.Component,
  recurrence: CalendarEventRecurrence | undefined,
  previous?: CalendarEventRecurrence,
  timing?: CalendarEventTiming,
): void {
  if (recurrence === undefined) {
    component.removeAllProperties('rrule');
    component.removeAllProperties('rdate');
    component.removeAllProperties('exdate');
    return;
  }

  if (recurrence.rrule !== previous?.rrule) {
    component.removeAllProperties('rrule');
    if (recurrence.rrule !== undefined) {
      const timingType = timing?.type ?? 'timed';
      const timezone = timing?.type === 'timed' ? timing.start.timezone : 'UTC';
      if (
        !isCalendarEventRecurrenceRuleSupported(
          recurrence.rrule,
          timingType,
          timezone,
        )
      ) {
        throw new ICalendarEventCodecError(
          'unsupported-patch',
          'The recurrence rule uses options that the calendar form cannot edit',
        );
      }
      try {
        const property = new ICAL.Property('rrule');
        property.setValue(ICAL.Recur.fromString(recurrence.rrule));
        component.addProperty(property);
      } catch {
        throw new ICalendarEventCodecError(
          'invalid-recurrence',
          'The recurrence rule is invalid',
        );
      }
    }
  }

  if (Object.prototype.hasOwnProperty.call(recurrence, 'rdates')) {
    updateDateTimeProperties(
      component,
      'rdate',
      recurrence.rdates ?? [],
      previous?.rdates ?? [],
    );
  }
  if (Object.prototype.hasOwnProperty.call(recurrence, 'exdates')) {
    updateDateTimeProperties(
      component,
      'exdate',
      recurrence.exdates ?? [],
      previous?.exdates ?? [],
    );
  }
}

function updateDateTimeProperties(
  component: ICAL.Component,
  name: 'rdate' | 'exdate',
  nextValues: CalendarEventDateTime[],
  previousValues: CalendarEventDateTime[],
): void {
  if (sameDateTimeValues(nextValues, previousValues)) {
    return;
  }

  const remaining = new Map<string, number>();
  for (const value of nextValues) {
    const key = dateTimeValueKey(value);
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }

  for (const property of component.getAllProperties(name)) {
    const values = property.getValues();
    // Keep PERIOD-valued RDATEs and any form this adapter cannot edit intact.
    if (values.some((value) => !(value instanceof ICAL.Time))) {
      continue;
    }

    const retained = values.filter((value) => {
      const key = dateTimeValueKey(
        readDateTimeValue(value as ICAL.Time, property),
      );
      const count = remaining.get(key) ?? 0;
      if (count === 0) {
        return false;
      }
      remaining.set(key, count - 1);
      return true;
    });

    if (retained.length === 0) {
      component.removeProperty(property);
    } else if (retained.length !== values.length) {
      property.setValues(retained);
    }
  }

  for (const [key, count] of remaining) {
    for (let index = 0; index < count; index += 1) {
      const value = nextValues.find(
        (candidate) => dateTimeValueKey(candidate) === key,
      );
      if (value) {
        component.addProperty(dateTimeProperty(name, value));
      }
    }
  }
}

function dateTimeProperty(
  name: 'rdate' | 'exdate',
  value: CalendarEventDateTime,
): ICAL.Property {
  const property = new ICAL.Property(name);
  if (value.type === 'date') {
    property.setValue(ICAL.Time.fromDateString(value.value));
    return property;
  }

  property.setValue(
    timedValue(value.value.local, value.value.timezone, value.value.mode),
  );
  if (dateTimeMode(value.value) === 'tzid') {
    property.setParameter('tzid', value.value.timezone);
  }
  return property;
}

function sameDateTimeValues(
  left: CalendarEventDateTime[],
  right: CalendarEventDateTime[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (value, index) =>
        dateTimeValueKey(value) === dateTimeValueKey(right[index]),
    )
  );
}

function dateTimeValueKey(value: CalendarEventDateTime): string {
  if (value.type === 'date') {
    return `DATE:${value.value}`;
  }
  return `DATE-TIME:${dateTimeMode(value.value)}:${value.value.timezone}:${value.value.local}`;
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
    timedValue(timing.start.local, timing.start.timezone, timing.start.mode),
    dateTimeMode(timing.start) === 'tzid' ? timing.start.timezone : undefined,
  );
  setTimeProperty(
    component,
    'dtend',
    timedValue(timing.end.local, timing.end.timezone, timing.end.mode),
    dateTimeMode(timing.end) === 'tzid' ? timing.end.timezone : undefined,
  );
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

function timedValue(
  local: string,
  timezone: string,
  mode?: ZonedCalendarDateTime['mode'],
): ICAL.Time {
  const normalized = normalizeLocalDateTime(local);
  const resolvedMode =
    mode ??
    (timezone === 'UTC'
      ? 'utc'
      : timezone === 'floating'
        ? 'floating'
        : 'tzid');
  return ICAL.Time.fromDateTimeString(
    resolvedMode === 'utc' ? `${normalized}Z` : normalized,
  );
}

function normalizeTiming(timing: CalendarEventTiming): CalendarEventTiming {
  if (timing.type === 'all-day') {
    return { ...timing };
  }
  return {
    type: 'timed',
    start: { ...timing.start, mode: dateTimeMode(timing.start) },
    end: { ...timing.end, mode: dateTimeMode(timing.end) },
  };
}

function dateTimeMode(
  value: ZonedCalendarDateTime,
): NonNullable<ZonedCalendarDateTime['mode']> {
  return (
    value.mode ??
    (value.timezone === 'UTC'
      ? 'utc'
      : value.timezone === 'floating'
        ? 'floating'
        : 'tzid')
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
