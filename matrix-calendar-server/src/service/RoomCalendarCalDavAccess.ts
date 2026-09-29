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

import { Injectable, ServiceUnavailableException } from '@nestjs/common';

export interface RoomCalendarTarget {
  readonly roomId: string;
  /** Stable server-configured collection identifier, never a DAV href. */
  readonly calendarId: string;
  readonly principal: { readonly kind: 'service' };
}

/**
 * Room-target CalDAV is deliberately unavailable until its server-side
 * application-principal authentication and deployment-isolation gates pass.
 * This service is a fail-closed gate only and performs no I/O.
 */
@Injectable()
export class RoomCalendarCalDavAccess {
  assertDisabled(_target: RoomCalendarTarget): never {
    throw new ServiceUnavailableException({
      code: 'room-calendar-caldav-disabled',
      message: 'Room calendar CalDAV access is not enabled',
    });
  }
}
