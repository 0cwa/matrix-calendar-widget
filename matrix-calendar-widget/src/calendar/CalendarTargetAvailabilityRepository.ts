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

import type {
  Calendar,
  CalendarEventListResult,
  CalendarId,
  CalendarRepository,
  CalendarTimeRange,
} from '@matrix-calendar-widget/calendar';

export type CalendarRoomCapabilities = {
  calendarId: CalendarId;
  /** Present only when the room ID was returned by authorized gateway context. */
  roomId?: string;
  canReadEvents: boolean;
  canWriteEvents: boolean;
  canManageReminders: boolean;
};

export type RoomCalendarListRequestFailurePhase =
  | 'auth-before-fetch'
  | 'header-construction'
  | 'fetch-before-response'
  | 'unavailable';

export type RoomCalendarListDiagnostic = {
  outcome:
    | 'not-requested'
    | 'loaded'
    | 'request-failed'
    | 'invalid-response'
    | 'target-mismatch';
  httpStatus: number | null;
  calendarCountCapped: 0 | 1 | 2 | null;
  expectedTargetMatch: boolean | null;
  requestFailurePhase: RoomCalendarListRequestFailurePhase | null;
};

export type CalendarListWithAvailability = {
  calendars: Calendar[];
  partialAvailability: boolean;
  canManageCalendarCollections: boolean;
  roomCapabilities?: CalendarRoomCapabilities;
  roomCalendarListDiagnostic?: RoomCalendarListDiagnostic;
};

export type CalendarEventsWithAvailability = CalendarEventListResult & {
  partialAvailability: boolean;
};

export interface CalendarTargetAvailabilityRepository {
  getRoomCalendarCapabilities(): Promise<CalendarRoomCapabilities | undefined>;

  listCalendarsWithAvailability(): Promise<CalendarListWithAvailability>;

  listEventsWithAvailability(
    calendarIds: CalendarId[],
    range: CalendarTimeRange,
  ): Promise<CalendarEventsWithAvailability>;
}

export function isCalendarTargetAvailabilityRepository(
  repository: CalendarRepository,
): repository is CalendarRepository & CalendarTargetAvailabilityRepository {
  return (
    'listCalendarsWithAvailability' in repository &&
    typeof repository.listCalendarsWithAvailability === 'function' &&
    'listEventsWithAvailability' in repository &&
    typeof repository.listEventsWithAvailability === 'function' &&
    'getRoomCalendarCapabilities' in repository &&
    typeof repository.getRoomCalendarCapabilities === 'function'
  );
}
