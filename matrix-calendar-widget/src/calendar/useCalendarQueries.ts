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
  CalendarId,
  CalendarTimeRange,
} from '@matrix-calendar-widget/calendar';
import { useEffect, useState } from 'react';
import { useCalendarRepository } from './CalendarRepositoryProvider';

export type CalendarQueryState<T> = {
  data: T;
  loading: boolean;
  error?: Error;
};

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export function useCalendars(): CalendarQueryState<Calendar[]> {
  const repository = useCalendarRepository();
  const [state, setState] = useState<CalendarQueryState<Calendar[]>>({
    data: [],
    loading: true,
  });

  useEffect(() => {
    let ignore = false;

    setState((current) => ({ ...current, loading: true, error: undefined }));

    repository.listCalendars().then(
      (data) => {
        if (!ignore) {
          setState({ data, loading: false });
        }
      },
      (error: unknown) => {
        if (!ignore) {
          setState({ data: [], loading: false, error: asError(error) });
        }
      },
    );

    return () => {
      ignore = true;
    };
  }, [repository]);

  return state;
}

export function useCalendarEvents(
  calendarIds: CalendarId[],
  range: CalendarTimeRange,
): CalendarQueryState<CalendarEvent[]> {
  const repository = useCalendarRepository();
  const calendarIdsKey = JSON.stringify(calendarIds);
  const [state, setState] = useState<CalendarQueryState<CalendarEvent[]>>({
    data: [],
    loading: true,
  });

  useEffect(() => {
    let ignore = false;
    const requestedCalendarIds = JSON.parse(calendarIdsKey) as CalendarId[];
    const requestedRange: CalendarTimeRange = {
      start: range.start,
      end: range.end,
    };

    setState((current) => ({ ...current, loading: true, error: undefined }));

    repository.listEvents(requestedCalendarIds, requestedRange).then(
      (data) => {
        if (!ignore) {
          setState({ data, loading: false });
        }
      },
      (error: unknown) => {
        if (!ignore) {
          setState({ data: [], loading: false, error: asError(error) });
        }
      },
    );

    return () => {
      ignore = true;
    };
  }, [calendarIdsKey, range.end, range.start, repository]);

  return state;
}

export function useCalendarEvent(
  calendarId: CalendarId,
  eventId: CalendarEventId,
): CalendarQueryState<CalendarEvent | undefined> {
  const repository = useCalendarRepository();
  const [state, setState] = useState<
    CalendarQueryState<CalendarEvent | undefined>
  >({
    data: undefined,
    loading: true,
  });

  useEffect(() => {
    let ignore = false;

    setState((current) => ({ ...current, loading: true, error: undefined }));

    repository.getEvent(calendarId, eventId).then(
      (data) => {
        if (!ignore) {
          setState({ data, loading: false });
        }
      },
      (error: unknown) => {
        if (!ignore) {
          setState({ data: undefined, loading: false, error: asError(error) });
        }
      },
    );

    return () => {
      ignore = true;
    };
  }, [calendarId, eventId, repository]);

  return state;
}
