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
  CalendarEventDateTime,
  isSupportedCalendarEventFollowingTimingEdit,
} from '@matrix-calendar-widget/calendar';

/**
 * Which edit scopes a selected occurrence offers besides the entire series.
 * The editor's scope choice and the event details copy both read this, so the
 * details never promise a scope the editor disables.
 */
export function calendarEventScopeAvailability(
  event: CalendarEvent | undefined,
  recurrenceId: CalendarEventDateTime | undefined,
  viewerTimezone: string,
): { occurrenceHasAlarm: boolean; followingSupported: boolean } {
  return {
    occurrenceHasAlarm: Boolean(event?.alarm || event?.unsupportedAlarm),
    followingSupported: Boolean(
      event &&
      recurrenceId &&
      isSupportedCalendarEventFollowingTimingEdit(
        event,
        recurrenceId,
        viewerTimezone,
      ),
    ),
  };
}
