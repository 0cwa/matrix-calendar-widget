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
  CalendarId,
  CalendarRepository,
} from '@matrix-calendar-widget/calendar';

export type CalendarPublicFeedPublication = Readonly<{
  enabled: boolean;
  published: boolean;
  url?: string;
}>;

export interface CalendarPublicFeedRepository {
  getPublicCalendarFeedPublication(
    calendarId: CalendarId,
  ): Promise<CalendarPublicFeedPublication>;

  publishPublicCalendarFeed(
    calendarId: CalendarId,
    confirmed: boolean,
  ): Promise<CalendarPublicFeedPublication>;

  unpublishPublicCalendarFeed(
    calendarId: CalendarId,
  ): Promise<CalendarPublicFeedPublication>;
}

export function isCalendarPublicFeedRepository(
  repository: CalendarRepository,
): repository is CalendarRepository & CalendarPublicFeedRepository {
  return (
    'getPublicCalendarFeedPublication' in repository &&
    typeof repository.getPublicCalendarFeedPublication === 'function' &&
    'publishPublicCalendarFeed' in repository &&
    typeof repository.publishPublicCalendarFeed === 'function' &&
    'unpublishPublicCalendarFeed' in repository &&
    typeof repository.unpublishPublicCalendarFeed === 'function'
  );
}
