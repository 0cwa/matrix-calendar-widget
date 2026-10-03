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
  CalendarEventTiming,
  calendarEventTimedDateTimeToDateTime,
} from '@matrix-calendar-widget/calendar';
import { DateTime } from 'luxon';
import {
  MAX_CALENDAR_EVENT_DESCRIPTION_LENGTH,
  MAX_CALENDAR_EVENT_TITLE_LENGTH,
} from './CalendarCommandParser';

export interface CalendarCommandEventLabels {
  id: string;
  title: string;
  when: string;
  description: string;
  untitled: string;
  timeUnavailable: string;
}

/** Keep untrusted CalDAV text to one plain, direction-safe Matrix line. */
export function sanitizeCalendarDisplayText(
  value: unknown,
  maxLength: number,
  fallback: string,
): string {
  if (typeof value !== 'string') {
    return fallback;
  }

  const normalized = Array.from(value)
    .map((character) => (isUnsafeDisplayCharacter(character) ? ' ' : character))
    .join('')
    .replace(/\s+/gu, ' ')
    .trim();
  if (!normalized) {
    return fallback;
  }

  const characters = Array.from(normalized);
  if (characters.length <= maxLength) {
    return normalized;
  }

  return `${characters.slice(0, Math.max(0, maxLength - 1)).join('')}…`;
}

function isUnsafeDisplayCharacter(character: string): boolean {
  const codePoint = character.codePointAt(0) ?? 0;
  return (
    codePoint <= 0x1f ||
    (codePoint >= 0x7f && codePoint <= 0x9f) ||
    codePoint === 0x061c ||
    codePoint === 0x200e ||
    codePoint === 0x200f ||
    (codePoint >= 0x202a && codePoint <= 0x202e) ||
    (codePoint >= 0x2066 && codePoint <= 0x206f)
  );
}

export function formatCalendarEventWhen(
  timing: CalendarEventTiming,
  timeZone: string,
  unavailable: string,
): string {
  if (timing.type === 'all-day') {
    const start = DateTime.fromISO(timing.startDate, { zone: 'UTC' });
    const end = DateTime.fromISO(timing.endDate, { zone: 'UTC' });
    if (!start.isValid || !end.isValid || end <= start) {
      return unavailable;
    }

    const lastDay = end.minus({ days: 1 });
    return start.hasSame(lastDay, 'day')
      ? (start.toISODate() ?? unavailable)
      : `${start.toISODate()} – ${lastDay.toISODate()}`;
  }

  const start = calendarEventTimedDateTimeToDateTime(timing.start, timeZone);
  const end = calendarEventTimedDateTimeToDateTime(timing.end, timeZone);
  if (!start.isValid || !end.isValid || end <= start) {
    return unavailable;
  }

  const formattedStart = start.toFormat('yyyy-LL-dd HH:mm');
  const formattedEnd = end.hasSame(start, 'day')
    ? end.toFormat('HH:mm')
    : end.toFormat('yyyy-LL-dd HH:mm');
  return `${formattedStart} – ${formattedEnd}`;
}

export function formatCalendarEventDetails(
  event: CalendarEvent,
  resourceId: string,
  timeZone: string,
  labels: CalendarCommandEventLabels,
): string {
  const lines = [
    `${labels.id}: ${resourceId}`,
    `${labels.title}: ${sanitizeCalendarDisplayText(
      event.title,
      MAX_CALENDAR_EVENT_TITLE_LENGTH,
      labels.untitled,
    )}`,
    `${labels.when}: ${formatCalendarEventWhen(
      event.timing,
      timeZone,
      labels.timeUnavailable,
    )}`,
  ];
  const description = sanitizeCalendarDisplayText(
    event.description,
    MAX_CALENDAR_EVENT_DESCRIPTION_LENGTH,
    '',
  );
  if (description) {
    lines.push(`${labels.description}: ${description}`);
  }
  return lines.join('\n');
}

export function formatCalendarEventOccurrence(
  event: CalendarEvent,
  resourceId: string,
  timeZone: string,
  labels: Pick<CalendarCommandEventLabels, 'untitled' | 'timeUnavailable'>,
): string {
  const title = sanitizeCalendarDisplayText(
    event.title,
    MAX_CALENDAR_EVENT_TITLE_LENGTH,
    labels.untitled,
  );
  const when = formatCalendarEventWhen(
    event.timing,
    timeZone,
    labels.timeUnavailable,
  );
  return `${resourceId} — ${when} — ${title}`;
}
