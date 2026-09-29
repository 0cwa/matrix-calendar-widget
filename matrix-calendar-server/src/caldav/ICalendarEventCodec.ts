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
  CalendarEventDuration,
  CalendarEventId,
  CalendarEventInput,
  CalendarEventPatch,
  CalendarEventRecurrence,
  CalendarEventRecurrenceDate,
  CalendarEventRecurrenceOverride,
  CalendarEventRecurrenceTiming,
  CalendarEventStatus,
  CalendarEventTimedDateTime,
  CalendarEventTiming,
  CalendarEventTransparency,
  CalendarId,
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
  ) {}

  applyPatch(patch: CalendarEventPatch): EncodedICalendarEvent {
    if (this.event.unsupportedTimezone && hasOwn(patch, 'timing')) {
      throw new ICalendarEventCodecError(
        'unsupported-patch',
        'Timing edits are not supported for events with unsupported timezone rules',
      );
    }
    if (hasOwn(patch, 'recurrence')) {
      throw new ICalendarEventCodecError(
        'unsupported-patch',
        'Recurrence editing is not part of the basic VEVENT codec',
      );
    }

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

    return {
      event: {
        ...this.event,
        ...patch,
        title: patch.title ?? this.event.title,
        timing: patch.timing ?? this.event.timing,
        recurrence: this.event.recurrence,
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
    if (input.recurrence) {
      throw new ICalendarEventCodecError(
        'unsupported-patch',
        'Recurrence creation is not part of the basic VEVENT codec',
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

    return {
      event: {
        ...input,
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
    const unsupportedTimezone = hasUnsupportedTimezoneRules(calendar, uid);

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
      ...(unsupportedRecurrence ? { unsupportedRecurrence } : {}),
      ...(unsupportedTimezone ? { unsupportedTimezone: true } : {}),
    };

    return new ParsedICalendarEvent(calendar, event);
  }
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
