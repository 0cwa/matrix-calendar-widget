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

import { TFunction } from 'i18next';
import { CalendarListQueryState } from '../../../calendar';

/** Why creating events or changing calendars is not offered right now. */
export function calendarOptionNotes(
  calendars: CalendarListQueryState,
  t: TFunction,
): string[] {
  if (calendars.loading) {
    return [t('calendars.optionNotes.loading', 'Loading calendars…')];
  }

  if (calendars.error) {
    return [
      t(
        'calendars.optionNotes.loadFailed',
        'Calendars could not be loaded. Reopen the widget to try again.',
      ),
    ];
  }

  if (calendars.data.length === 0) {
    return calendars.canManageCalendarCollections
      ? []
      : [
          t(
            'calendars.optionNotes.noCalendars',
            'No calendar is available here. Ask a room moderator or your server administrator.',
          ),
        ];
  }

  const notes: string[] = [];

  if (calendars.data.every((calendar) => calendar.readOnly !== false)) {
    notes.push(
      t(
        'calendars.optionNotes.cannotCreateEvents',
        'You can’t create events here. Ask a room moderator or your server administrator about your permission.',
      ),
    );
  }

  const collections = calendars.data.filter(
    (calendar) => calendar.operatorManaged !== true,
  );

  if (collections.every((calendar) => calendar.readOnly !== false)) {
    notes.push(
      collections.length > 0
        ? t(
            'calendars.optionNotes.managersOnly',
            'Only calendar managers can change or delete these calendars.',
          )
        : t(
            'calendars.optionNotes.roomCalendar',
            'The room calendar can’t be renamed, restyled or deleted here. Ask your server administrator.',
          ),
    );
  }

  return notes;
}
