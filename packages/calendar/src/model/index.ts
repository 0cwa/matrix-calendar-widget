/* Modified for Matrix Calendar Widget fork, 2026. */
/*
 * Copyright 2023 Nordeck IT + Consulting GmbH
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

export { calendarEntrySchema, dateTimeEntrySchema } from './calendarEntry';
export type { CalendarEntry, DateTimeEntry } from './calendarEntry';
export type { CalendarEventExternalLink } from './calendarEventExternalLink';

export {
  isAllDayCalendarEvent,
  isCalendarEventAlarmRemoval,
  isTimedCalendarEvent,
} from './calendar';
export type {
  AllDayCalendarEventTiming,
  Calendar,
  CalendarDate,
  CalendarEvent,
  CalendarEventAlarmLeadTime,
  CalendarEventAlarmPatch,
  CalendarEventAlarmRemoval,
  CalendarEventConferenceInput,
  CalendarEventConferencePatch,
  CalendarEventDateTime,
  CalendarEventDisplayAlarm,
  CalendarEventDisplayAlarmInput,
  CalendarEventDuration,
  CalendarEventFollowingTimingWrite,
  CalendarEventId,
  CalendarEventInput,
  CalendarEventPatch,
  CalendarEventRecurrence,
  CalendarEventRecurrenceDate,
  CalendarEventRecurrenceOverride,
  CalendarEventRecurrenceTiming,
  CalendarEventRecurrenceWrite,
  CalendarEventRevision,
  CalendarEventStatus,
  CalendarEventTimedDateTime,
  CalendarEventTiming,
  CalendarEventTransparency,
  CalendarEventUnsupportedAlarm,
  CalendarEventUnsupportedConference,
  CalendarEventUnsupportedRecurrence,
  CalendarEventUnsupportedTimezone,
  CalendarEventWeekday,
  CalendarEventWeekdayOrdinal,
  CalendarId,
  CalendarTimeRange,
  LocalCalendarDateTime,
  TimedCalendarEventTiming,
  ZonedCalendarDateTime,
} from './calendar';
