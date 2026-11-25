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

import type { Calendar } from '@matrix-calendar-widget/calendar';
import type { ChangeEvent, Dispatch, SetStateAction } from 'react';
import type { CalendarEventFormValues } from '../../calendar';

export function createTimingHandlers(
  setValues: Dispatch<SetStateAction<CalendarEventFormValues | undefined>>,
  calendars: Calendar[],
) {
  const handleCalendarChange = (change: ChangeEvent<HTMLInputElement>) => {
    const calendarId = change.target.value;
    const calendar = calendars.find((candidate) => candidate.id === calendarId);

    setValues((current) =>
      current
        ? {
            ...current,
            calendarId,
            timezone: calendar?.timezone ?? current.timezone,
            timingChanged: true,
            timezoneChanged: true,
          }
        : current,
    );
  };

  const handleTimingTypeChange = (change: ChangeEvent<HTMLInputElement>) => {
    const timingType = change.target.checked ? 'all-day' : 'timed';

    setValues((current) => {
      if (!current || current.timingType === timingType) {
        return current;
      }

      if (timingType === 'all-day') {
        return {
          ...current,
          timingType,
          start: current.start.slice(0, 10),
          end: current.end.slice(0, 10),
          timingChanged: true,
        };
      }

      return {
        ...current,
        timingType,
        start: `${current.start}T09:00`,
        end: `${current.end}T10:00`,
        timingChanged: true,
      };
    });
  };

  return { handleCalendarChange, handleTimingTypeChange };
}
