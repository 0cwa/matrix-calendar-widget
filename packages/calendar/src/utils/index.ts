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

export {
  MAX_CALENDAR_EVENT_EXTERNAL_LINKS,
  MAX_CALENDAR_EVENT_EXTERNAL_LINK_LABEL_LENGTH,
  MAX_CALENDAR_EVENT_EXTERNAL_LINK_URI_LENGTH,
  boundCalendarEventExternalLinkLabel,
  canonicalizeCalendarExternalUrl,
} from './calendarEventExternalLinks';
export {
  MAX_FOLLOWING_OCCURRENCES_PER_EVENT,
  MAX_PROJECTED_OCCURRENCES_PER_EVENT,
  calendarEventFollowingTimingOverrides,
  calendarEventRecurrenceIdentity,
  formatSupportedCalendarEventRecurrenceRule,
  isSupportedCalendarEventFollowingTimingEdit,
  isSupportedCalendarEventOccurrenceExclusion,
  parseSupportedCalendarEventRecurrenceRule,
  projectCalendarEventOccurrenceByRecurrenceId,
  projectCalendarEventOccurrences,
} from './calendarEventOccurrenceProjection';
export type {
  CalendarEventProjection,
  CalendarEventProjectionDiagnostic,
  CalendarEventProjectionDiagnosticReason,
  ProjectedCalendarEventOccurrence,
  SupportedCalendarEventRecurrenceEnd,
  SupportedCalendarEventRecurrenceFrequency,
  SupportedCalendarEventRecurrenceRule,
} from './calendarEventOccurrenceProjection';
export { calendarEventTimedDateTimeToDateTime } from './calendarEventTimedDateTime';
export {
  calendarLocalDateTimeToUnixMillis,
  isCalendarLocalDateTimeUnambiguous,
  isCalendarTimezoneSupported,
} from './calendarEventTimezone';
export * from './calendarUtils';
export { formatICalDate, parseICalDate, toISOString } from './dateTimeUtils';
export { formatRRuleText, getOrdinalLabel, parseRRule } from './format';
export {
  isWeekdays,
  normalizeByWeekday,
  normalizeNumeric,
  normalizeWeekday,
} from './helpers';
