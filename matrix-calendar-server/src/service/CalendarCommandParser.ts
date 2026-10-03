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
  isCalendarTimezoneSupported,
  type CalendarEventTiming,
} from '@matrix-calendar-widget/calendar';
import ICAL from 'ical.js';
import { DateTime } from 'luxon';
import { parseCommandContext } from './CommandContext';

export const DEFAULT_UPCOMING_EVENT_COUNT = 5;
export const MAX_UPCOMING_EVENT_COUNT = 10;
export const UPCOMING_HORIZON_DAYS = 30;
export const MAX_CALENDAR_COMMAND_LENGTH = 2048;
export const MAX_CALENDAR_RESOURCE_ID_LENGTH = 128;
export const MAX_CALENDAR_EVENT_TITLE_LENGTH = 120;
export const MAX_CALENDAR_EVENT_DESCRIPTION_LENGTH = 1000;

const LOCAL_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const LOCAL_DATE_TIME_FORMAT = "yyyy-MM-dd'T'HH:mm";
const RESOURCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._@+-]*\.ics$/;

export type CalendarCommandRequest =
  | {
      kind: 'upcoming';
      count: number;
      timeZone: string;
    }
  | {
      kind: 'event';
      resourceId: string;
      timeZone: string;
    }
  | {
      kind: 'delete';
      resourceId: string;
    }
  | {
      kind: 'create';
      title: string;
      description?: string;
      timing: CalendarEventTiming;
    };

export class InvalidCalendarCommandError extends Error {
  constructor() {
    super('Use !calendar help for command syntax.');
    this.name = 'InvalidCalendarCommandError';
  }
}

type CommandToken = {
  value: string;
  quoted: boolean;
};

/**
 * Parse a command tail (the text after `!calendar`) without shell expansion.
 * Quoting exists only so create titles and descriptions can contain spaces.
 */
export function parseCalendarCommand(
  commandText: string,
): CalendarCommandRequest {
  if (
    commandText.length > MAX_CALENDAR_COMMAND_LENGTH ||
    hasControlCharacters(commandText, true)
  ) {
    throw new InvalidCalendarCommandError();
  }

  const [command, ...tokens] = tokenize(commandText);
  if (!command || command.quoted) {
    throw new InvalidCalendarCommandError();
  }

  switch (command.value) {
    case 'upcoming':
      return parseUpcoming(tokens);
    case 'event':
      return parseEvent(tokens);
    case 'delete':
    case 'cancel':
      return parseDelete(tokens);
    case 'create':
      return parseCreate(tokens);
    default:
      throw new InvalidCalendarCommandError();
  }
}

/**
 * Convert an authorized event href into the one-segment ID exposed to bot
 * users. URLs outside the exact collection and unsafe leaf names are hidden.
 */
export function calendarResourceIdFromHref(
  eventHref: string,
  collectionHref: string,
): string | undefined {
  try {
    const collection = new URL(collectionHref);
    const event = new URL(eventHref);
    if (
      collection.username ||
      collection.password ||
      collection.search ||
      collection.hash ||
      event.username ||
      event.password ||
      event.search ||
      event.hash ||
      event.origin !== collection.origin
    ) {
      return undefined;
    }

    const collectionPath = collection.pathname.endsWith('/')
      ? collection.pathname
      : `${collection.pathname}/`;
    if (!event.pathname.startsWith(collectionPath)) {
      return undefined;
    }

    const encodedLeaf = event.pathname.slice(collectionPath.length);
    if (!encodedLeaf || encodedLeaf.includes('/')) {
      return undefined;
    }

    const resourceId = decodeURIComponent(encodedLeaf);
    return isSafeCalendarResourceId(resourceId) ? resourceId : undefined;
  } catch {
    return undefined;
  }
}

/** Build a child resource URL only from the parser's safe opaque ID grammar. */
export function calendarResourceHref(
  collectionHref: string,
  resourceId: string,
): string | undefined {
  if (!isSafeCalendarResourceId(resourceId)) {
    return undefined;
  }

  try {
    const collection = new URL(collectionHref);
    if (
      collection.username ||
      collection.password ||
      collection.search ||
      collection.hash
    ) {
      return undefined;
    }
    if (!collection.pathname.endsWith('/')) {
      collection.pathname += '/';
    }
    return new URL(encodeURIComponent(resourceId), collection).toString();
  } catch {
    return undefined;
  }
}

/**
 * Return true only when deleting the whole resource removes VEVENT data alone.
 * VTIMEZONE and VALARM are retained as standard supporting components.
 */
export function isWholeEventResourceDeletable(icalendar: string): boolean {
  try {
    const calendar = ICAL.Component.fromString(icalendar);
    if (calendar.name !== 'vcalendar') {
      return false;
    }

    const calendarComponents = calendar.getAllSubcomponents();
    if (
      calendarComponents.some(
        (component) =>
          component.name !== 'vevent' && component.name !== 'vtimezone',
      )
    ) {
      return false;
    }

    const events = calendar.getAllSubcomponents('vevent');
    const masters = events.filter(
      (event) => !event.hasProperty('recurrence-id'),
    );
    if (masters.length !== 1) {
      return false;
    }

    const uid = masters[0].getFirstPropertyValue('uid');
    if (typeof uid !== 'string' || uid.length === 0) {
      return false;
    }

    return events.every((event) => {
      if (event.getFirstPropertyValue('uid') !== uid) {
        return false;
      }

      if (event !== masters[0] && !event.hasProperty('recurrence-id')) {
        return false;
      }

      return event
        .getAllSubcomponents()
        .every((component) => component.name === 'valarm');
    });
  } catch {
    return false;
  }
}

function parseUpcoming(tokens: CommandToken[]): CalendarCommandRequest {
  let count = DEFAULT_UPCOMING_EVENT_COUNT;
  let optionStart = 0;
  if (tokens[0] && !tokens[0].value.startsWith('--')) {
    const countValue = tokens[0].value;
    if (!/^[1-9]\d*$/.test(countValue)) {
      throw new InvalidCalendarCommandError();
    }
    count = Number(countValue);
    if (count > MAX_UPCOMING_EVENT_COUNT) {
      throw new InvalidCalendarCommandError();
    }
    optionStart = 1;
  }

  const { timeZone } = parseTimeZoneOption(tokens.slice(optionStart));
  return { kind: 'upcoming', count, timeZone };
}

function parseEvent(tokens: CommandToken[]): CalendarCommandRequest {
  const resourceId = requireResourceId(tokens[0]);
  const { timeZone } = parseTimeZoneOption(tokens.slice(1));
  return { kind: 'event', resourceId, timeZone };
}

function parseDelete(tokens: CommandToken[]): CalendarCommandRequest {
  const resourceId = requireResourceId(tokens[0]);
  parseNoOptions(tokens.slice(1));
  return { kind: 'delete', resourceId };
}

function parseCreate(tokens: CommandToken[]): CalendarCommandRequest {
  const startLocal = tokens[0]?.value;
  const endLocal = tokens[1]?.value;
  const titleToken = tokens[2];
  if (
    !startLocal ||
    !endLocal ||
    !titleToken?.quoted ||
    !isSafePlainText(titleToken.value, MAX_CALENDAR_EVENT_TITLE_LENGTH)
  ) {
    throw new InvalidCalendarCommandError();
  }

  const options = parseCreateOptions(tokens.slice(3));
  const { timeZone } = parseTimeZoneOption(options.timeZoneArgs);
  const start = parseLocalDateTime(startLocal, timeZone);
  const end = parseLocalDateTime(endLocal, timeZone);
  if (start.toMillis() >= end.toMillis()) {
    throw new InvalidCalendarCommandError();
  }

  const timing: CalendarEventTiming = {
    type: 'timed',
    start: { type: 'zoned', local: startLocal, timezone: timeZone },
    end: { type: 'zoned', local: endLocal, timezone: timeZone },
  };

  return {
    kind: 'create',
    title: titleToken.value,
    description: options.description,
    timing,
  };
}

function parseCreateOptions(tokens: CommandToken[]): {
  description?: string;
  timeZoneArgs: CommandToken[];
} {
  let description: string | undefined;
  let hasDescription = false;
  const timeZoneArgs: CommandToken[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.value === '--description') {
      const value = tokens[index + 1];
      if (
        hasDescription ||
        !value?.quoted ||
        !isSafePlainText(value.value, MAX_CALENDAR_EVENT_DESCRIPTION_LENGTH)
      ) {
        throw new InvalidCalendarCommandError();
      }
      description = value.value;
      hasDescription = true;
      index += 1;
    } else if (token.value === '--tz') {
      const value = tokens[index + 1];
      if (!value) {
        throw new InvalidCalendarCommandError();
      }
      timeZoneArgs.push(token, value);
      index += 1;
    } else {
      throw new InvalidCalendarCommandError();
    }
  }

  return { description, timeZoneArgs };
}

function parseTimeZoneOption(tokens: CommandToken[]): {
  timeZone: string;
} {
  try {
    const parsed = parseCommandContext(tokens.map(({ value }) => value));
    if (parsed.args.length > 0) {
      throw new InvalidCalendarCommandError();
    }
    return { timeZone: parsed.timeZone };
  } catch {
    throw new InvalidCalendarCommandError();
  }
}

function parseNoOptions(tokens: CommandToken[]): void {
  if (tokens.length > 0) {
    throw new InvalidCalendarCommandError();
  }
}

function requireResourceId(token: CommandToken | undefined): string {
  if (!token || token.quoted) {
    throw new InvalidCalendarCommandError();
  }

  if (!isSafeCalendarResourceId(token.value)) {
    throw new InvalidCalendarCommandError();
  }

  return token.value;
}

function isSafeCalendarResourceId(value: string): boolean {
  return (
    value.length <= MAX_CALENDAR_RESOURCE_ID_LENGTH &&
    RESOURCE_ID_PATTERN.test(value) &&
    !value.includes('..')
  );
}

function parseLocalDateTime(value: string, timeZone: string): DateTime {
  if (
    !LOCAL_DATE_TIME_PATTERN.test(value) ||
    (timeZone !== 'UTC' && !isCalendarTimezoneSupported(timeZone))
  ) {
    throw new InvalidCalendarCommandError();
  }

  const parsed = DateTime.fromFormat(value, LOCAL_DATE_TIME_FORMAT, {
    locale: 'en',
    zone: timeZone,
  });
  if (!parsed.isValid || parsed.toFormat(LOCAL_DATE_TIME_FORMAT) !== value) {
    throw new InvalidCalendarCommandError();
  }

  const localAsUtc = DateTime.fromFormat(value, LOCAL_DATE_TIME_FORMAT, {
    locale: 'en',
    zone: 'UTC',
  });
  const sampledOffsets = new Set<number>();
  for (const hours of [-36, -24, -12, -6, 0, 6, 12, 24, 36]) {
    sampledOffsets.add(
      DateTime.fromMillis(localAsUtc.toMillis() + hours * 60 * 60 * 1000, {
        zone: timeZone,
      }).offset,
    );
  }

  const matchingInstants = new Set<number>();
  for (const offset of sampledOffsets) {
    const candidate = DateTime.fromMillis(
      localAsUtc.toMillis() - offset * 60 * 1000,
      { zone: timeZone },
    );
    if (candidate.toFormat(LOCAL_DATE_TIME_FORMAT) === value) {
      matchingInstants.add(candidate.toMillis());
    }
  }

  if (matchingInstants.size !== 1) {
    throw new InvalidCalendarCommandError();
  }

  return DateTime.fromMillis([...matchingInstants][0], { zone: timeZone });
}

function isSafePlainText(value: string, maxLength: number): boolean {
  const trimmed = value.trim();
  return (
    [...trimmed].length > 0 &&
    [...trimmed].length <= maxLength &&
    !hasControlCharacters(value)
  );
}

function hasControlCharacters(
  value: string,
  allowCommandWhitespace = false,
): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (
      (code < 0x20 &&
        !(
          allowCommandWhitespace &&
          (code === 0x09 || code === 0x0a || code === 0x0d)
        )) ||
      (code >= 0x7f && code <= 0x9f)
    ) {
      return true;
    }
  }

  return false;
}

function tokenize(commandText: string): CommandToken[] {
  const tokens: CommandToken[] = [];
  let index = 0;

  while (index < commandText.length) {
    while (index < commandText.length && /\s/u.test(commandText[index])) {
      index += 1;
    }
    if (index === commandText.length) {
      break;
    }

    const quoted = commandText[index] === '"';
    let value = '';
    if (quoted) {
      index += 1;
      let closed = false;
      while (index < commandText.length) {
        const character = commandText[index];
        if (character === '"') {
          closed = true;
          index += 1;
          break;
        }
        if (
          character === '\\' &&
          (commandText[index + 1] === '"' || commandText[index + 1] === '\\')
        ) {
          value += commandText[index + 1];
          index += 2;
          continue;
        }
        value += character;
        index += 1;
      }
      if (
        !closed ||
        (index < commandText.length && !/\s/u.test(commandText[index]))
      ) {
        throw new InvalidCalendarCommandError();
      }
    } else {
      const start = index;
      while (index < commandText.length && !/\s/u.test(commandText[index])) {
        if (commandText[index] === '"') {
          throw new InvalidCalendarCommandError();
        }
        index += 1;
      }
      value = commandText.slice(start, index);
    }

    tokens.push({ value, quoted });
    if (tokens.length > 12) {
      throw new InvalidCalendarCommandError();
    }
  }

  return tokens;
}
