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

export {
  isCalendarDiagnosticsRepository,
  type CalendarDiagnosticCollection,
  type CalendarDiagnostics,
  type CalendarDiagnosticsRepository,
} from './CalendarDiagnosticsRepository';
export {
  calendarEventInputFromForm,
  calendarEventPatchFromForm,
  calendarEventToFormValues,
  createCalendarEventFormValues,
  validateCalendarEventForm,
} from './calendarEventForm';
export type {
  CalendarEventFormValues,
  CalendarEventValidationError,
} from './calendarEventForm';
export { isCalendarEventDiagnosticsRepository } from './CalendarEventListDiagnosticsRepository';
export {
  calendarEventKey,
  calendarEventStartDate,
  calendarEventToFullCalendarEvent,
  filterCalendarEvents,
  groupCalendarEventsByDay,
  repositoryRangeForView,
  visibleRangeForView,
} from './calendarEventPresentation';
export {
  CalendarRepositoryProvider,
  useCalendarRepository,
  useCalendarRepositoryRevision,
  useInvalidateCalendarRepository,
} from './CalendarRepositoryProvider';
export { GatewayCalendarRepository } from './GatewayCalendarRepository';
export type { GatewayCalendarRepositoryOptions } from './GatewayCalendarRepository';
export type { CalendarFilters } from './types';
export {
  useCreateCalendar,
  useCreateCalendarEvent,
  useDeleteCalendar,
  useDeleteCalendarEvent,
  useRenameCalendar,
  useUpdateCalendarColor,
  useUpdateCalendarDescription,
  useUpdateCalendarEvent,
} from './useCalendarMutations';
export {
  useCalendarEvent,
  useCalendarEvents,
  useCalendars,
} from './useCalendarQueries';
export type {
  CalendarEventsQueryState,
  CalendarQueryState,
} from './useCalendarQueries';
