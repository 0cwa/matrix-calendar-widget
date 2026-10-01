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

import { DateTime } from 'luxon';
import type { CalendarEventTimedDateTime } from '../model';
import {
  calendarLocalDateTimeToUnixMillis,
  isCalendarTimezoneSupported,
} from './calendarEventTimezone';

/**
 * Returns the event time in the viewer's local zone. Floating wall times are
 * interpreted there; zoned values keep their instant and are converted from
 * their stored iCalendar timezone.
 */
export function calendarEventTimedDateTimeToDateTime(
  value: CalendarEventTimedDateTime,
  viewerTimezone = DateTime.local().zoneName ?? 'UTC',
): DateTime {
  const storedTimezone =
    value.type === 'floating' ? viewerTimezone : value.timezone;
  if (!isCalendarTimezoneSupported(storedTimezone)) {
    // Keep non-projection consumers compatible. The occurrence projector
    // checks bundle support first and diagnoses unsupported zones as opaque.
    return DateTime.fromISO(value.local, { zone: storedTimezone }).setZone(
      viewerTimezone,
    );
  }

  const instant = calendarLocalDateTimeToUnixMillis(
    value.local,
    storedTimezone,
  );

  return DateTime.fromMillis(instant, { zone: viewerTimezone });
}
