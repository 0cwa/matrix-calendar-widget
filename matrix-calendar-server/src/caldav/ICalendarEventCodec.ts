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
  CalendarEventId,
  CalendarId,
} from '@matrix-calendar-widget/calendar';
import ICAL from 'ical.js';

type JCalParameters = Record<string, string | string[]>;
type JCalProperty = [
  name: string,
  parameters: JCalParameters,
  valueType: string,
  ...values: unknown[],
];
type JCalComponent = [
  name: string,
  properties: JCalProperty[],
  components: JCalComponent[],
];

export type ICalendarEventIdentity = {
  calendarId: CalendarId;
  eventId: CalendarEventId;
};

export type DecodedICalendarEvent = {
  event: CalendarEvent;
  /**
   * Original source used as the preservation substrate for later edits.
   * Unsupported properties/components are reparsed from here and left untouched.
   */
  source: string;
};

export class ICalendarEventCodecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ICalendarEventCodecError';
  }
}

/**
 * Preservation-first VEVENT codec.
 *
 * The product model intentionally covers only fields the widget edits today.
 * Encoding reparses the original VCALENDAR and patches only those fields, so
 * unsupported recurrence metadata, attendees, alarms, VTIMEZONE definitions,
 * attachments, vendor properties, and sibling components survive edits.
 */
export class ICalendarEventCodec {
  decode(
    source: string,
    identity: ICalendarEventIdentity,
  ): DecodedICalendarEvent {
    const root = parseCalendar(source);
    const eventComponent = findEventComponent(root);

    const uid = requiredTextProperty(eventComponent, 'uid');
    const title = optionalTextProperty(eventComponent, 'summary') ?? '';
    const timing = decodeTiming(eventComponent);

    return {
      source,
      event: {
        id: identity.eventId,
        calendarId: identity.calendarId,
        uid,
        title,
        description: optionalTextProperty(eventComponent, 'description'),
        timing,
        status: decodeStatus(optionalTextProperty(eventComponent, 'status')),
        transparency: decodeTransparency(
          optionalTextProperty(eventComponent, 'transp'),
        ),
        location: optionalTextProperty(eventComponent, 'location'),
        url: optionalTextProperty(eventComponent, 'url'),
        categories: optionalTextListProperty(eventComponent, 'categories'),
        priority: optionalIntegerProperty(eventComponent, 'priority'),
      },
    };
  }

  encode(source: string, event: CalendarEvent): string {
    const parsed = ICAL.parse(source);
    const root = asComponent(parsed);
    const eventComponent = findEventComponent(root);

    setProperty(eventComponent, 'uid', {}, 'text', [event.uid]);
    setOptionalTextProperty(eventComponent, 'summary', event.title);
    setOptionalTextProperty(
      eventComponent,
      'description',
      event.description,
    );
    encodeTiming(eventComponent, event);
    setOptionalTextProperty(eventComponent, 'status', event.status?.toUpperCase());
    setOptionalTextProperty(
      eventComponent,
      'transp',
      event.transparency?.toUpperCase(),
    );
    setOptionalTextProperty(eventComponent, 'location', event.location);
    setOptionalProperty(eventComponent, 'url', {}, 'uri', event.url);
    setOptionalListProperty(
      eventComponent,
      'categories',
      {},
      'text',
      event.categories,
    );
    setOptionalProperty(
      eventComponent,
      'priority',
      {},
      'integer',
      event.priority,
    );

    return new ICAL.Component(parsed).toString();
  }
}

function parseCalendar(source: string): JCalComponent {
  try {
    return asComponent(ICAL.parse(source));
  } catch (error) {
    throw new ICalendarEventCodecError(
      `Invalid iCalendar document: ${errorMessage(error)}`,
    );
  }
}

function asComponent(value: unknown): JCalComponent {
  if (
    !Array.isArray(value) ||
    typeof value[0] !== 'string' ||
    !Array.isArray(value[1]) ||
    !Array.isArray(value[2])
  ) {
    throw new ICalendarEventCodecError('Invalid iCalendar component structure');
  }

  return value as JCalComponent;
}

function findEventComponent(root: JCalComponent): JCalComponent {
  if (root[0].toLowerCase() !== 'vcalendar') {
    throw new ICalendarEventCodecError('Expected a VCALENDAR document');
  }

  const event = root[2].find(
    (component) => component[0].toLowerCase() === 'vevent',
  );

  if (!event) {
    throw new ICalendarEventCodecError('VCALENDAR does not contain a VEVENT');
  }

  return event;
}

function decodeTiming(event: JCalComponent): CalendarEvent['timing'] {
  const start = requiredProperty(event, 'dtstart');
  const end = requiredProperty(event, 'dtend');

  if (start[2] === 'date') {
    if (end[2] !== 'date') {
      throw new ICalendarEventCodecError(
        'All-day DTSTART and DTEND must both use DATE values',
      );
    }

    return {
      type: 'all-day',
      startDate: requiredStringValue(start, 'DTSTART'),
      endDate: requiredStringValue(end, 'DTEND'),
    };
  }

  if (start[2] !== 'date-time' || end[2] !== 'date-time') {
    throw new ICalendarEventCodecError(
      'Timed DTSTART and DTEND must both use DATE-TIME values',
    );
  }

  const startValue = requiredStringValue(start, 'DTSTART');
  const endValue = requiredStringValue(end, 'DTEND');

  return {
    type: 'timed',
    start: decodeDateTime(startValue, start[1], 'DTSTART'),
    end: decodeDateTime(endValue, end[1], 'DTEND'),
  };
}

function decodeDateTime(
  value: string,
  parameters: JCalParameters,
  propertyName: string,
): { local: string; timezone: string } {
  if (value.endsWith('Z')) {
    return {
      local: value.slice(0, -1),
      timezone: 'UTC',
    };
  }

  const timezone = parameters.tzid;
  if (typeof timezone !== 'string' || !timezone) {
    throw new ICalendarEventCodecError(
      `${propertyName} uses a floating time; a named timezone or UTC is required`,
    );
  }

  return {
    local: value,
    timezone,
  };
}

function encodeTiming(
  eventComponent: JCalComponent,
  event: CalendarEvent,
): void {
  if (event.timing.type === 'all-day') {
    setProperty(
      eventComponent,
      'dtstart',
      {},
      'date',
      [event.timing.startDate],
    );
    setProperty(eventComponent, 'dtend', {}, 'date', [event.timing.endDate]);
    return;
  }

  setProperty(
    eventComponent,
    'dtstart',
    dateTimeParameters(event.timing.start.timezone),
    'date-time',
    [encodeDateTime(event.timing.start.local, event.timing.start.timezone)],
  );
  setProperty(
    eventComponent,
    'dtend',
    dateTimeParameters(event.timing.end.timezone),
    'date-time',
    [encodeDateTime(event.timing.end.local, event.timing.end.timezone)],
  );
}

function dateTimeParameters(timezone: string): JCalParameters {
  return timezone === 'UTC' ? {} : { tzid: timezone };
}

function encodeDateTime(local: string, timezone: string): string {
  return timezone === 'UTC' ? `${local}Z` : local;
}

function requiredTextProperty(
  component: JCalComponent,
  name: string,
): string {
  const value = optionalTextProperty(component, name);
  if (value === undefined) {
    throw new ICalendarEventCodecError(
      `VEVENT is missing required ${name.toUpperCase()} property`,
    );
  }
  return value;
}

function optionalTextProperty(
  component: JCalComponent,
  name: string,
): string | undefined {
  const property = findProperty(component, name);
  if (!property) {
    return undefined;
  }

  const value = property[3];
  return typeof value === 'string' ? value : undefined;
}

function optionalTextListProperty(
  component: JCalComponent,
  name: string,
): string[] | undefined {
  const property = findProperty(component, name);
  if (!property) {
    return undefined;
  }

  const values = property.slice(3).filter(
    (value): value is string => typeof value === 'string',
  );
  return values.length > 0 ? values : undefined;
}

function optionalIntegerProperty(
  component: JCalComponent,
  name: string,
): number | undefined {
  const property = findProperty(component, name);
  const value = property?.[3];

  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string' && /^\d+$/.test(value)) {
    return Number(value);
  }

  return undefined;
}

function decodeStatus(
  value: string | undefined,
): CalendarEvent['status'] | undefined {
  const normalized = value?.toLowerCase();
  return normalized === 'confirmed' ||
    normalized === 'tentative' ||
    normalized === 'cancelled'
    ? normalized
    : undefined;
}

function decodeTransparency(
  value: string | undefined,
): CalendarEvent['transparency'] | undefined {
  const normalized = value?.toLowerCase();
  return normalized === 'opaque' || normalized === 'transparent'
    ? normalized
    : undefined;
}

function requiredProperty(
  component: JCalComponent,
  name: string,
): JCalProperty {
  const property = findProperty(component, name);
  if (!property) {
    throw new ICalendarEventCodecError(
      `VEVENT is missing required ${name.toUpperCase()} property`,
    );
  }
  return property;
}

function findProperty(
  component: JCalComponent,
  name: string,
): JCalProperty | undefined {
  return component[1].find(
    (property) => property[0].toLowerCase() === name.toLowerCase(),
  );
}

function requiredStringValue(
  property: JCalProperty,
  name: string,
): string {
  const value = property[3];
  if (typeof value !== 'string' || !value) {
    throw new ICalendarEventCodecError(
      `${name} must contain a non-empty string value`,
    );
  }
  return value;
}

function setOptionalTextProperty(
  component: JCalComponent,
  name: string,
  value: string | undefined,
): void {
  setOptionalProperty(component, name, {}, 'text', value);
}

function setOptionalProperty(
  component: JCalComponent,
  name: string,
  parameters: JCalParameters,
  valueType: string,
  value: unknown,
): void {
  if (value === undefined) {
    removeProperties(component, name);
    return;
  }

  setProperty(component, name, parameters, valueType, [value]);
}

function setOptionalListProperty(
  component: JCalComponent,
  name: string,
  parameters: JCalParameters,
  valueType: string,
  values: unknown[] | undefined,
): void {
  if (!values || values.length === 0) {
    removeProperties(component, name);
    return;
  }

  setProperty(component, name, parameters, valueType, values);
}

function setProperty(
  component: JCalComponent,
  name: string,
  parameters: JCalParameters,
  valueType: string,
  values: unknown[],
): void {
  const properties = component[1];
  const index = properties.findIndex(
    (property) => property[0].toLowerCase() === name.toLowerCase(),
  );
  const next: JCalProperty = [name.toLowerCase(), parameters, valueType, ...values];

  if (index >= 0) {
    properties[index] = next;
    for (let cursor = properties.length - 1; cursor > index; cursor -= 1) {
      if (properties[cursor][0].toLowerCase() === name.toLowerCase()) {
        properties.splice(cursor, 1);
      }
    }
  } else {
    properties.push(next);
  }
}

function removeProperties(component: JCalComponent, name: string): void {
  component[1] = component[1].filter(
    (property) => property[0].toLowerCase() !== name.toLowerCase(),
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
