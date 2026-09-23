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
  CalendarAuthorization,
  CalendarAuthorizationError,
  CalendarAuthorizationRequest,
  requireCalendarAuthorization,
} from './calendarAuthorization';

class TestAuthorization implements CalendarAuthorization {
  constructor(private readonly allowed: boolean) {}

  async isAllowed(
    _request: CalendarAuthorizationRequest,
  ): Promise<boolean> {
    return this.allowed;
  }
}

describe('calendar authorization', () => {
  it('allows authorized actions', async () => {
    const request: CalendarAuthorizationRequest = {
      action: 'read-events',
      calendarId: 'team',
    };

    await expect(
      requireCalendarAuthorization(new TestAuthorization(true), request),
    ).resolves.toBeUndefined();
  });

  it('returns a structured error for denied actions', async () => {
    const request: CalendarAuthorizationRequest = {
      action: 'delete-event',
      calendarId: 'team',
      eventId: 'planning',
    };

    await expect(
      requireCalendarAuthorization(new TestAuthorization(false), request),
    ).rejects.toEqual(new CalendarAuthorizationError(request));
  });

  it('preserves the denied request on the error', async () => {
    const request: CalendarAuthorizationRequest = {
      action: 'create-calendar',
    };

    try {
      await requireCalendarAuthorization(
        new TestAuthorization(false),
        request,
      );
      throw new Error('Expected authorization to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(CalendarAuthorizationError);
      expect((error as CalendarAuthorizationError).request).toEqual(request);
    }
  });
});
