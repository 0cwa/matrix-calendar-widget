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
} from '@matrix-calendar-widget/calendar';
import { useCallback } from 'react';
import {
  useCalendarRepository,
  useInvalidateCalendarRepository,
} from './CalendarRepositoryProvider';

export function useCreateCalendar(): (name: string) => Promise<Calendar> {
  const repository = useCalendarRepository();
  const invalidate = useInvalidateCalendarRepository();

  return useCallback(
    async (name: string) => {
      const calendar = await repository.createCalendar(name);
      invalidate();
      return calendar;
    },
    [invalidate, repository],
  );
}

export function useDeleteCalendar(): (calendarId: CalendarId) => Promise<void> {
  const repository = useCalendarRepository();
  const invalidate = useInvalidateCalendarRepository();

  return useCallback(
    async (calendarId: CalendarId) => {
      await repository.deleteCalendar(calendarId);
      invalidate();
    },
    [invalidate, repository],
  );
}

export function useCreateCalendarEvent(): (
  calendarId: CalendarId,
  input: CalendarEventInput,
) => Promise<CalendarEvent> {
  const repository = useCalendarRepository();
  const invalidate = useInvalidateCalendarRepository();

  return useCallback(
    async (calendarId: CalendarId, input: CalendarEventInput) => {
      const event = await repository.createEvent(calendarId, input);
      invalidate();
      return event;
    },
    [invalidate, repository],
  );
}

export function useUpdateCalendarEvent(): (
  calendarId: CalendarId,
  eventId: CalendarEventId,
  patch: CalendarEventPatch,
) => Promise<CalendarEvent> {
  const repository = useCalendarRepository();
  const invalidate = useInvalidateCalendarRepository();

  return useCallback(
    async (
      calendarId: CalendarId,
      eventId: CalendarEventId,
      patch: CalendarEventPatch,
    ) => {
      const event = await repository.updateEvent(calendarId, eventId, patch);
      invalidate();
      return event;
    },
    [invalidate, repository],
  );
}

export function useDeleteCalendarEvent(): (
  calendarId: CalendarId,
  eventId: CalendarEventId,
) => Promise<void> {
  const repository = useCalendarRepository();
  const invalidate = useInvalidateCalendarRepository();

  return useCallback(
    async (calendarId: CalendarId, eventId: CalendarEventId) => {
      await repository.deleteEvent(calendarId, eventId);
      invalidate();
    },
    [invalidate, repository],
  );
}
