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

import { CalendarEventId, CalendarId } from '../model';

export type CalendarAuthorizationRequest =
  | {
      action: 'list-calendars' | 'create-calendar';
    }
  | {
      action: 'read-events' | 'create-event' | 'manage-calendar';
      calendarId: CalendarId;
    }
  | {
      action: 'update-event' | 'delete-event';
      calendarId: CalendarId;
      eventId: CalendarEventId;
    };

export interface CalendarAuthorization {
  isAllowed(request: CalendarAuthorizationRequest): Promise<boolean>;
}

export class CalendarAuthorizationError extends Error {
  constructor(public readonly request: CalendarAuthorizationRequest) {
    super(`Calendar action is not authorized: ${request.action}`);
    this.name = 'CalendarAuthorizationError';
  }
}

export async function requireCalendarAuthorization(
  authorization: CalendarAuthorization,
  request: CalendarAuthorizationRequest,
): Promise<void> {
  if (!(await authorization.isAllowed(request))) {
    throw new CalendarAuthorizationError(request);
  }
}
