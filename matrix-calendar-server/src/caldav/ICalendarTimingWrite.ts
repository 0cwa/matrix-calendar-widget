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
  CalendarEventTimedDateTime,
  CalendarEventTiming,
} from '@matrix-calendar-widget/calendar';
import { getVTimezoneBlock } from '@matrix-calendar-widget/ical-timezones';
import ICAL from 'ical.js';
import { ICalendarEventCodecError } from './ICalendarCodecError';

export function setTextProperty(
  component: ICAL.Component,
  name: string,
  value: string,
): void {
  component.updatePropertyWithValue(name, value);
}

export function setOptionalProperty(
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

export function setCategories(
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

export function setTiming(
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

export function addNewEventTimezoneDefinitions(
  calendar: ICAL.Component,
  timing: CalendarEventTiming,
): void {
  if (timing.type !== 'timed') {
    return;
  }

  const timezoneIds = new Set<string>();
  for (const endpoint of [timing.start, timing.end]) {
    if (endpoint.type === 'zoned' && endpoint.timezone !== 'UTC') {
      timezoneIds.add(endpoint.timezone);
    }
  }

  for (const timezoneId of timezoneIds) {
    const definition = getVTimezoneBlock(timezoneId);
    if (definition) {
      calendar.addSubcomponent(ICAL.Component.fromString(definition));
    }
  }
}

function timedValueForEventEndpoint(
  value: CalendarEventTimedDateTime,
): ICAL.Time {
  return value.type === 'floating'
    ? ICAL.Time.fromDateTimeString(normalizeLocalDateTime(value.local))
    : timedValue(value.local, value.timezone);
}

export function setTimeProperty(
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

export function normalizeLocalDateTime(value: string): string {
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
