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

import { CalendarEventRevision } from '@matrix-calendar-widget/calendar';
import ICAL from 'ical.js';
import {
  calendarParameterValue,
  hasCalendarParameter,
  parseContentLine,
  type ICalendarContentLine,
} from './ICalendarContentLine';
import { formatLocalDateTime } from './ICalendarTiming';
import {
  compactUtcTimestampToIso,
  isValidCompactUtcDateTime,
} from './ICalendarUtcTimestamp';

type RevisionPropertyState<T> =
  { kind: 'missing' } | { kind: 'valid'; value: T } | { kind: 'invalid' };

export type RawRevisionProperty = ICalendarContentLine & {
  name: 'dtstamp' | 'created' | 'last-modified' | 'sequence';
};

// RFC 5545 INTEGER is a signed 32-bit value; SEQUENCE uses its nonnegative range.
const MAX_ICALENDAR_SEQUENCE = 2_147_483_647;

export function readCalendarEventRevision(
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

export function readUpdatedCalendarEventRevision(
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

export function setInitialRevisionMetadata(
  vevent: ICAL.Component,
  now: Date,
): void {
  setUtcTimestamp(vevent, 'dtstamp', now);
  setUtcTimestamp(vevent, 'created', now);
  setUtcTimestamp(vevent, 'last-modified', now);
  vevent.updatePropertyWithValue('sequence', 0);
}

export function updateRevisionMetadata(
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
