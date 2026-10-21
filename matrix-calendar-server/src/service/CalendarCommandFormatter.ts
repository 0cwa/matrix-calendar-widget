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
  allDay: string;
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
  locale = 'en',
  allDayLabel = 'All day',
): string {
  if (timing.type === 'all-day') {
    const start = DateTime.fromISO(timing.startDate, { zone: 'UTC' });
    const end = DateTime.fromISO(timing.endDate, { zone: 'UTC' });
    if (!start.isValid || !end.isValid || end <= start) {
      return unavailable;
    }

    const lastDay = end.minus({ days: 1 });
    const formattedStart = formatLocalizedDate(start.toJSDate(), locale, 'UTC');
    const formattedEnd = formatLocalizedDate(lastDay.toJSDate(), locale, 'UTC');
    if (!formattedStart || !formattedEnd) {
      return unavailable;
    }
    return start.hasSame(lastDay, 'day')
      ? `${allDayLabel} · ${formattedStart}`
      : `${allDayLabel} · ${formattedStart} – ${formattedEnd}`;
  }

  const start = calendarEventTimedDateTimeToDateTime(timing.start, timeZone);
  const end = calendarEventTimedDateTimeToDateTime(timing.end, timeZone);
  if (!start.isValid || !end.isValid || end <= start) {
    return unavailable;
  }

  const formattedStartDate = formatLocalizedDate(
    start.toJSDate(),
    locale,
    timeZone,
  );
  const formattedEndDate = formatLocalizedDate(
    end.toJSDate(),
    locale,
    timeZone,
  );
  const formattedStartTime = formatLocalizedTime(
    start.toJSDate(),
    locale,
    timeZone,
  );
  const formattedEndTime = formatLocalizedTime(
    end.toJSDate(),
    locale,
    timeZone,
  );
  if (
    !formattedStartDate ||
    !formattedEndDate ||
    !formattedStartTime ||
    !formattedEndTime
  ) {
    return unavailable;
  }

  const interval = start.hasSame(end, 'day')
    ? `${formattedStartDate} · ${formattedStartTime}–${formattedEndTime}`
    : `${formattedStartDate}, ${formattedStartTime} – ${formattedEndDate}, ${formattedEndTime}`;
  return `${interval} (${timeZone})`;
}

export function formatCalendarEventDetails(
  event: CalendarEvent,
  resourceId: string,
  timeZone: string,
  labels: CalendarCommandEventLabels,
  locale = 'en',
): string {
  const lines = [
    `${labels.title}: ${sanitizeCalendarDisplayText(
      event.title,
      MAX_CALENDAR_EVENT_TITLE_LENGTH,
      labels.untitled,
    )}`,
    `${labels.when}: ${formatCalendarEventWhen(
      event.timing,
      timeZone,
      labels.timeUnavailable,
      locale,
      labels.allDay,
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
  lines.push(`${labels.id}: ${resourceId}`);
  return lines.join('\n');
}

export function formatCalendarEventOccurrence(
  event: CalendarEvent,
  resourceId: string,
  timeZone: string,
  labels: Pick<
    CalendarCommandEventLabels,
    'id' | 'untitled' | 'timeUnavailable' | 'allDay'
  >,
  locale = 'en',
  includeResourceId = false,
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
    locale,
    labels.allDay,
  );
  return [
    title,
    `  ${when}`,
    ...(includeResourceId ? [`  ${labels.id}: ${resourceId}`] : []),
  ].join('\n');
}

function formatLocalizedDate(
  value: Date,
  locale: string,
  timeZone: string,
): string | undefined {
  return formatLocalizedValue(value, locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone,
  });
}

function formatLocalizedTime(
  value: Date,
  locale: string,
  timeZone: string,
): string | undefined {
  return formatLocalizedValue(value, locale, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  });
}

function formatLocalizedValue(
  value: Date,
  locale: string,
  options: Intl.DateTimeFormatOptions,
): string | undefined {
  try {
    return new Intl.DateTimeFormat(locale, options).format(value);
  } catch {
    try {
      return new Intl.DateTimeFormat('en', options).format(value);
    } catch {
      return undefined;
    }
  }
}
