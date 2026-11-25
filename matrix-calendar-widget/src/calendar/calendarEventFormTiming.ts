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
  calendarLocalDateTimeToUnixMillis,
  calendarUnixMillisToLocalDateTime,
  isCalendarLocalDateTimeUnambiguous,
  isCalendarTimezoneSupported,
  type TimedCalendarEventTiming,
} from '@matrix-calendar-widget/calendar';
import { DateTime } from 'luxon';
import type { CalendarEventFormValues } from './calendarEventForm';

const DEFAULT_EVENT_DURATION_HOURS = 1;
const DEFAULT_EVENT_RANGE_SEARCH_HOURS = 48;

// The form stores local date-times without offsets. Defaults must resolve to
// exactly one instant so different CalDAV clients cannot choose different
// occurrences of a repeated local time.
export function defaultEventTimedRange(
  now: DateTime,
  timezone: string,
): { start: string; end: string } {
  if (!now.isValid || !isCalendarTimezoneSupported(timezone)) {
    return { start: 'Invalid DateTime', end: 'Invalid DateTime' };
  }

  const nowMillis = now.toMillis();
  const localNow = calendarUnixMillisToLocalDateTime(nowMillis, timezone);
  const firstStart = DateTime.fromISO(localNow, { zone: 'UTC' }).startOf(
    'hour',
  );

  if (!firstStart.isValid) {
    return { start: 'Invalid DateTime', end: 'Invalid DateTime' };
  }

  for (
    let searchHours = 0;
    searchHours <= DEFAULT_EVENT_RANGE_SEARCH_HOURS;
    searchHours += 1
  ) {
    const start = formDateTimeValue(firstStart.plus({ hours: searchHours }));
    const startMillis = uniqueCalendarLocalDateTimeInstant(start, timezone);
    if (startMillis === undefined) {
      continue;
    }

    const endMillis =
      startMillis + DEFAULT_EVENT_DURATION_HOURS * 60 * 60 * 1000;
    if (
      (searchHours > 0 && startMillis <= nowMillis) ||
      endMillis <= nowMillis
    ) {
      continue;
    }

    const end = calendarUnixMillisToLocalDateTime(endMillis, timezone).slice(
      0,
      16,
    );
    const endRoundTripMillis = uniqueCalendarLocalDateTimeInstant(
      end,
      timezone,
    );
    if (endRoundTripMillis === endMillis) {
      return { start, end };
    }
  }

  throw new Error(
    'Unable to generate a representable default event range within 48 hours',
  );
}

function formDateTimeValue(value: DateTime): string {
  return value.toFormat("yyyy-MM-dd'T'HH:mm");
}

function uniqueCalendarLocalDateTimeInstant(
  local: string,
  timezone: string,
): number | undefined {
  if (!isCalendarLocalDateTimeUnambiguous(local, timezone)) {
    return undefined;
  }

  const instantMillis = calendarLocalDateTimeToUnixMillis(local, timezone);
  return calendarUnixMillisToLocalDateTime(instantMillis, timezone).slice(
    0,
    16,
  ) === local
    ? instantMillis
    : undefined;
}

export function timedKindForTiming(
  timing: TimedCalendarEventTiming,
): NonNullable<CalendarEventFormValues['timedKind']> {
  if (timing.start.type === 'floating' && timing.end.type === 'floating') {
    return 'floating';
  }

  if (
    timing.start.type === 'zoned' &&
    timing.end.type === 'zoned' &&
    timing.start.timezone === timing.end.timezone
  ) {
    return 'zoned';
  }

  return 'mixed';
}

export function editableTimedEndpoint(
  values: CalendarEventFormValues,
  endpoint: 'start' | 'end',
) {
  const original =
    values.originalTiming?.type === 'timed'
      ? values.originalTiming[endpoint]
      : undefined;
  const local = values[endpoint];

  if (values.timedKind === 'floating') {
    return { type: 'floating' as const, local };
  }

  if (original && values.timedKind === 'mixed') {
    return { ...original, local };
  }

  if (original?.type === 'zoned' && !values.timezoneChanged) {
    return { ...original, local };
  }

  return { type: 'zoned' as const, local, timezone: values.timezone };
}

export function formEndpointTimezone(
  values: CalendarEventFormValues,
  endpoint: 'start' | 'end',
  viewerTimezone: string,
): string {
  const timedKind = values.timedKind ?? 'zoned';
  if (timedKind === 'floating') {
    return viewerTimezone;
  }

  const original =
    values.originalTiming?.type === 'timed'
      ? values.originalTiming[endpoint]
      : undefined;
  if (timedKind === 'mixed') {
    if (original?.type === 'floating') {
      return viewerTimezone;
    }
    if (original?.type === 'zoned') {
      return original.timezone;
    }
  }

  return values.timezone;
}
