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
  Calendar,
  CalendarEvent,
  CalendarEventId,
  CalendarEventInput,
  CalendarEventPatch,
  CalendarId,
  CalendarTimeRange,
} from '../model';

export type CalendarRepositoryErrorCode =
  | 'calendar-not-found'
  | 'event-not-found'
  | 'calendar-read-only'
  | 'invalid-calendar-name'
  | 'invalid-range'
  | 'event-conflict'
  | 'authentication-required'
  | 'request-failed';

export class CalendarRepositoryError extends Error {
  constructor(
    public readonly code: CalendarRepositoryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CalendarRepositoryError';
  }
}

export interface CalendarRepository {
  listCalendars(): Promise<Calendar[]>;

  createCalendar(name: string): Promise<Calendar>;

  deleteCalendar(calendarId: CalendarId): Promise<void>;

  listEvents(
    calendarIds: CalendarId[],
    range: CalendarTimeRange,
  ): Promise<CalendarEvent[]>;

  getEvent(
    calendarId: CalendarId,
    eventId: CalendarEventId,
  ): Promise<CalendarEvent>;

  createEvent(
    calendarId: CalendarId,
    input: CalendarEventInput,
  ): Promise<CalendarEvent>;

  updateEvent(
    calendarId: CalendarId,
    eventId: CalendarEventId,
    patch: CalendarEventPatch,
  ): Promise<CalendarEvent>;

  deleteEvent(calendarId: CalendarId, eventId: CalendarEventId): Promise<void>;
}
