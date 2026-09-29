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

import { getVTimezoneBlock } from '@matrix-calendar-widget/ical-timezones';
import ICAL from 'ical.js';

type JCalProperty = [
  name: string,
  parameters: Record<string, unknown>,
  type: string,
  ...values: unknown[],
];

type JCalComponent = [
  name: string,
  properties: JCalProperty[],
  components: JCalComponent[],
];

const eventDateProperties = [
  'dtstart',
  'dtend',
  'recurrence-id',
  'rdate',
  'exdate',
];

const permittedTimezoneProperties = new Set([
  'dtstart',
  'rdate',
  'rrule',
  'tzname',
  'tzoffsetfrom',
  'tzoffsetto',
]);

const permittedTimezoneMetadata = new Set([
  'tzid',
  'x-lic-location',
  'x-proleptic-tzname',
]);

/**
 * Return true when this resource uses a timezone that cannot safely be
 * projected with the repository's bundled IANA rules. An absent embedded
 * VTIMEZONE keeps the project's existing exact-IANA-ID fallback.
 */
export function hasUnsupportedTimezoneRules(
  calendar: ICAL.Component,
  uid: string,
): boolean {
  const usedTimezones = new Set<string>();

  for (const vevent of calendar.getAllSubcomponents('vevent')) {
    if (readText(vevent.getFirstPropertyValue('uid')) !== uid) {
      continue;
    }

    for (const propertyName of eventDateProperties) {
      for (const property of vevent.getAllProperties(propertyName)) {
        const value = property.getParameter('tzid');
        if (value === undefined) {
          continue;
        }
        if (typeof value !== 'string' || value.length === 0) {
          return true;
        }
        usedTimezones.add(value);
      }
    }
  }

  const definitions = calendar.getAllSubcomponents('vtimezone');
  for (const timezoneId of usedTimezones) {
    const bundled = getVTimezoneBlock(timezoneId);
    if (!bundled) {
      return true;
    }

    const matching = definitions.filter(
      (definition) =>
        readText(definition.getFirstPropertyValue('tzid')) === timezoneId,
    );
    if (matching.length === 0) {
      continue;
    }
    if (
      matching.length !== 1 ||
      !matchesBundledDefinition(matching[0], bundled, timezoneId)
    ) {
      return true;
    }
  }

  return false;
}

function matchesBundledDefinition(
  embedded: ICAL.Component,
  bundledText: string,
  timezoneId: string,
): boolean {
  try {
    const bundled = ICAL.Component.fromString(bundledText);
    const embeddedForm = normalizeTimezone(embedded, timezoneId);
    const bundledForm = normalizeTimezone(bundled, timezoneId);
    return Boolean(
      embeddedForm &&
      bundledForm &&
      stableJson(embeddedForm) === stableJson(bundledForm),
    );
  } catch {
    return false;
  }
}

function normalizeTimezone(
  component: ICAL.Component,
  timezoneId: string,
): unknown[] | undefined {
  const [name, properties, components] = component.toJSON() as JCalComponent;
  if (name !== 'vtimezone' || components.length === 0) {
    return undefined;
  }

  const rootProperties = properties.filter(([propertyName]) =>
    permittedTimezoneMetadata.has(propertyName),
  );
  if (rootProperties.length !== properties.length) {
    return undefined;
  }
  const identifiers = rootProperties.filter(
    ([propertyName]) => propertyName === 'tzid',
  );
  if (
    identifiers.length !== 1 ||
    !hasNoParameters(identifiers[0][1]) ||
    identifiers[0][2] !== 'text' ||
    identifiers[0].length !== 4 ||
    identifiers[0][3] !== timezoneId
  ) {
    return undefined;
  }

  const metadataCounts = new Map<string, number>();
  for (const [propertyName] of rootProperties) {
    metadataCounts.set(
      propertyName,
      (metadataCounts.get(propertyName) ?? 0) + 1,
    );
  }
  if ([...metadataCounts.values()].some((count) => count > 1)) {
    return undefined;
  }

  const observances: unknown[][] = [];
  for (const [
    observanceName,
    observanceProperties,
    nestedComponents,
  ] of components) {
    if (
      (observanceName !== 'standard' && observanceName !== 'daylight') ||
      nestedComponents.length > 0
    ) {
      return undefined;
    }

    const ruleProperties = observanceProperties.filter(
      ([propertyName]) => propertyName !== 'tzname',
    );
    if (
      ruleProperties.some(
        ([propertyName]) => !permittedTimezoneProperties.has(propertyName),
      )
    ) {
      return undefined;
    }

    const start = singleValue(ruleProperties, 'dtstart', 'date-time');
    const offsetFrom = singleValue(
      ruleProperties,
      'tzoffsetfrom',
      'utc-offset',
    );
    const offsetTo = singleValue(ruleProperties, 'tzoffsetto', 'utc-offset');
    const recurrence = ruleProperties.filter(
      ([propertyName]) => propertyName === 'rrule',
    );
    const recurrenceDates = ruleProperties.filter(
      ([propertyName]) => propertyName === 'rdate',
    );
    if (
      start === undefined ||
      offsetFrom === undefined ||
      offsetTo === undefined ||
      recurrence.length > 1
    ) {
      return undefined;
    }

    const exactOffsetFrom = parseOffsetSeconds(offsetFrom);
    const exactOffsetTo = parseOffsetSeconds(offsetTo);
    if (exactOffsetFrom === undefined || exactOffsetTo === undefined) {
      return undefined;
    }

    let recurrenceRule: unknown;
    if (recurrence.length === 1) {
      const [propertyName, parameters, type, ...values] = recurrence[0];
      if (
        propertyName !== 'rrule' ||
        !hasNoParameters(parameters) ||
        type !== 'recur' ||
        values.length !== 1 ||
        typeof values[0] !== 'object' ||
        values[0] === null
      ) {
        return undefined;
      }
      recurrenceRule = values[0];
    }

    const dates: string[] = [];
    for (const [propertyName, parameters, type, ...values] of recurrenceDates) {
      if (
        propertyName !== 'rdate' ||
        !hasNoParameters(parameters) ||
        type !== 'date-time' ||
        values.length === 0 ||
        values.some((value) => typeof value !== 'string')
      ) {
        return undefined;
      }
      dates.push(...(values as string[]));
    }
    dates.sort();

    observances.push([
      observanceName,
      start,
      exactOffsetFrom,
      exactOffsetTo,
      recurrenceRule,
      dates,
    ]);
  }

  return [timezoneId, observances];
}

function singleValue(
  properties: JCalProperty[],
  propertyName: string,
  expectedType: string,
): string | undefined {
  const matches = properties.filter(([name]) => name === propertyName);
  if (matches.length !== 1) {
    return undefined;
  }

  const [, parameters, type, value, ...extraValues] = matches[0];
  if (
    !hasNoParameters(parameters) ||
    type !== expectedType ||
    typeof value !== 'string' ||
    extraValues.length > 0
  ) {
    return undefined;
  }

  return value;
}

function parseOffsetSeconds(value: string): number | undefined {
  const match = value.match(/^([+-])(\d{2}):?(\d{2})(?::?(\d{2}))?$/);
  if (!match) {
    return undefined;
  }

  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  const seconds = Number(match[4] ?? '0');
  if (hours > 23 || minutes > 59 || seconds > 59) {
    return undefined;
  }

  const magnitude = hours * 3600 + minutes * 60 + seconds;
  return match[1] === '-' ? -magnitude : magnitude;
}

function hasNoParameters(parameters: Record<string, unknown>): boolean {
  return (
    typeof parameters === 'object' &&
    parameters !== null &&
    Object.keys(parameters).length === 0
  );
}

function readText(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}
