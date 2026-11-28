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
  CalendarEventTimedDateTime,
  calendarEventTimedDateTimeToDateTime,
  calendarLocalDateTimeToUnixMillis,
  calendarUnixMillisToLocalDateTime,
  isCalendarLocalDateTimeUnambiguous,
  isCalendarTimezoneSupported,
  isTimedCalendarEvent,
} from '@matrix-calendar-widget/calendar';
import { DateTime } from 'luxon';

/** UTC offsets in effect at an event's start and end, such as `UTC+02:00`. */
export type CalendarOffsets = { start: string; end: string };

export type CalendarScheduleEndpoint = {
  local: DateTime;
  /** Absent for floating times, which belong to no time zone. */
  timezone?: string;
  /** Absent when the offset cannot be stated reliably. */
  offset?: string;
};

export type CalendarEventSchedule =
  | { kind: 'all-day' }
  | { kind: 'floating' }
  /** Both endpoints share a zone whose clock matches the viewer's. */
  | { kind: 'same-clock'; timezone: string; offsets: CalendarOffsets }
  /** Both endpoints share a zone whose clock differs from the viewer's. */
  | {
      kind: 'other-clock';
      timezone: string;
      offsets: CalendarOffsets;
      viewerOffsets: CalendarOffsets;
    }
  /** Endpoints keep different zones or kinds. */
  | {
      kind: 'mixed';
      viewerOffsets: CalendarOffsets;
      start: CalendarScheduleEndpoint;
      end: CalendarScheduleEndpoint;
    }
  /** A zone cannot be converted reliably, so only saved values are shown. */
  | {
      kind: 'unverified';
      start: CalendarScheduleEndpoint;
      end: CalendarScheduleEndpoint;
    };

/**
 * Describe which clocks an event's displayed times belong to. This only reads
 * the event; conversion follows the same helper the displayed times use.
 */
export function calendarEventSchedule(
  event: CalendarEvent,
  viewerTimezone: string,
): CalendarEventSchedule {
  if (!isTimedCalendarEvent(event)) {
    return { kind: 'all-day' };
  }

  const { start, end } = event.timing;
  if (start.type === 'floating' && end.type === 'floating') {
    return { kind: 'floating' };
  }

  const instants = [start, end].map((value) =>
    calendarEventTimedDateTimeToDateTime(value, viewerTimezone),
  );
  const sourceTimes = [start, end].map((value, index) =>
    value.type === 'zoned'
      ? instants[index].setZone(value.timezone)
      : instants[index],
  );

  if (event.unsupportedTimezone || sourceTimes.some((time) => !time.isValid)) {
    return {
      kind: 'unverified',
      start: savedEndpoint(start),
      end: savedEndpoint(end),
    };
  }

  const viewerOffsets = {
    start: formatCalendarOffset(instants[0]),
    end: formatCalendarOffset(instants[1]),
  };

  if (
    start.type === 'zoned' &&
    end.type === 'zoned' &&
    start.timezone === end.timezone
  ) {
    const offsets = {
      start: formatCalendarOffset(sourceTimes[0]),
      end: formatCalendarOffset(sourceTimes[1]),
    };
    return offsets.start === viewerOffsets.start &&
      offsets.end === viewerOffsets.end
      ? { kind: 'same-clock', timezone: start.timezone, offsets }
      : {
          kind: 'other-clock',
          timezone: start.timezone,
          offsets,
          viewerOffsets,
        };
  }

  const endpoint = (
    value: CalendarEventTimedDateTime,
    time: DateTime,
  ): CalendarScheduleEndpoint =>
    value.type === 'floating'
      ? savedEndpoint(value)
      : {
          local: time,
          timezone: value.timezone,
          offset: formatCalendarOffset(time),
        };

  return {
    kind: 'mixed',
    viewerOffsets,
    start: endpoint(start, sourceTimes[0]),
    end: endpoint(end, sourceTimes[1]),
  };
}

export function formatCalendarOffset(time: DateTime): string {
  return time.toFormat("'UTC'ZZ");
}

export type CalendarWallTime =
  | { status: 'unique' | 'repeated'; instant: number; offset: string }
  /** The clock skips this time, so no offset describes it. */
  | { status: 'skipped'; instant: number };

/**
 * Explain a wall time entered for a bundled zone using the same rules that
 * interpret saved values. Returns nothing for other zones or malformed input.
 */
export function describeCalendarWallTime(
  local: string,
  timezone: string,
): CalendarWallTime | undefined {
  if (!isCalendarTimezoneSupported(timezone)) {
    return undefined;
  }

  try {
    const instant = calendarLocalDateTimeToUnixMillis(local, timezone);
    const resolved = calendarUnixMillisToLocalDateTime(instant, timezone);
    if (resolved.slice(0, 16) !== local.slice(0, 16)) {
      return { status: 'skipped', instant };
    }

    const wall = DateTime.fromISO(resolved, { zone: 'UTC' }).toMillis();
    return {
      status: isCalendarLocalDateTimeUnambiguous(local, timezone)
        ? 'unique'
        : 'repeated',
      instant,
      offset: formatOffsetSeconds(Math.round((wall - instant) / 1000)),
    };
  } catch {
    return undefined;
  }
}

function formatOffsetSeconds(offset: number): string {
  const magnitude = Math.abs(offset);
  const parts = [Math.floor(magnitude / 3600), Math.floor(magnitude / 60) % 60];
  if (magnitude % 60) {
    parts.push(magnitude % 60);
  }
  return `UTC${offset < 0 ? '-' : '+'}${parts
    .map((part) => String(part).padStart(2, '0'))
    .join(':')}`;
}

function savedEndpoint(
  value: CalendarEventTimedDateTime,
): CalendarScheduleEndpoint {
  return {
    // UTC keeps the stored wall-clock fields exactly as written.
    local: DateTime.fromISO(value.local, { zone: 'UTC' }),
    ...(value.type === 'zoned' ? { timezone: value.timezone } : {}),
  };
}
