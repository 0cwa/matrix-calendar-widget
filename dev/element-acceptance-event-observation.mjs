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

export function readCreatedEventTiming(value) {
  if (!isRecord(value) || value.type !== 'timed') return undefined;
  const readEndpoint = (endpoint) => {
    if (
      !isRecord(endpoint) ||
      endpoint.type !== 'zoned' ||
      typeof endpoint.local !== 'string' ||
      typeof endpoint.timezone !== 'string' ||
      endpoint.timezone.length === 0
    ) {
      return undefined;
    }
    return {
      type: 'zoned',
      local: endpoint.local,
      timezone: endpoint.timezone,
    };
  };
  const start = readEndpoint(value.start);
  const end = readEndpoint(value.end);
  return start && end ? { type: 'timed', start, end } : undefined;
}

export function inspectExpectedEventList(value, identity) {
  if (
    !isRecord(identity) ||
    typeof identity.expectedTitle !== 'string' ||
    typeof identity.expectedCalendarId !== 'string' ||
    (identity.createdEventId !== undefined &&
      typeof identity.createdEventId !== 'string')
  ) {
    throw new TypeError('Invalid expected event identity');
  }
  if (!isRecord(value) || !Array.isArray(value.events)) {
    return {
      hasEventsArray: false,
      eventCountCapped: null,
      titleMatches: null,
      idMatches: null,
      calendarMatches: null,
    };
  }

  const matching = value.events.find(
    (candidate) =>
      isRecord(candidate) &&
      isRecord(candidate.event) &&
      candidate.event.title === identity.expectedTitle,
  );
  if (!matching || !isRecord(matching) || !isRecord(matching.event)) {
    return {
      hasEventsArray: true,
      eventCountCapped: Math.min(value.events.length, 2),
      titleMatches: false,
      idMatches: identity.createdEventId ? false : null,
      calendarMatches: false,
    };
  }
  return {
    hasEventsArray: true,
    eventCountCapped: Math.min(value.events.length, 2),
    titleMatches: true,
    idMatches:
      identity.createdEventId === undefined
        ? null
        : matching.event.id === identity.createdEventId,
    calendarMatches:
      typeof matching.event.calendarId === 'string' &&
      matching.event.calendarId === identity.expectedCalendarId,
  };
}

// This function is also passed to Playwright page.evaluate, so it must remain
// self-contained and use only browser globals.
export function compareEventTimingWithRoomRange({ timing, range }) {
  const rangeStart = Date.parse(range.start);
  const rangeEnd = Date.parse(range.end);
  const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (
    !Number.isFinite(rangeStart) ||
    !Number.isFinite(rangeEnd) ||
    rangeEnd <= rangeStart ||
    timing.start.timezone !== browserTimezone ||
    timing.end.timezone !== browserTimezone
  ) {
    return { comparable: false, intersects: false };
  }

  const toInstant = (local, timezone) => {
    const match =
      /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/u.exec(
        local,
      );
    if (!match || timezone !== browserTimezone) return undefined;
    const [, year, month, day, hour, minute, second, fraction] = match;
    const instant = Date.parse(local);
    if (!Number.isFinite(instant)) return undefined;
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-CA-u-ca-iso8601', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      })
        .formatToParts(new Date(instant))
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, Number(part.value)]),
    );
    const milliseconds = Number((fraction ?? '').padEnd(3, '0') || '0');
    if (
      parts.year !== Number(year) ||
      parts.month !== Number(month) ||
      parts.day !== Number(day) ||
      parts.hour !== Number(hour) ||
      parts.minute !== Number(minute) ||
      parts.second !== Number(second ?? '0') ||
      new Date(instant).getUTCMilliseconds() !== milliseconds
    ) {
      return undefined;
    }
    return instant;
  };

  const start = toInstant(timing.start.local, timing.start.timezone);
  const end = toInstant(timing.end.local, timing.end.timezone);
  if (start === undefined || end === undefined || end <= start) {
    return { comparable: false, intersects: false };
  }
  return {
    comparable: true,
    intersects: start < rangeEnd && end > rangeStart,
  };
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
