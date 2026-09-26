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
import { CalDavEventClient } from '../caldav';

export interface RoomCalendarTarget {
  readonly roomId: string;
  /** Stable server-configured collection identifier, never a DAV href. */
  readonly calendarId: string;
  readonly principal: { readonly kind: 'service' };
}

/**
 * The initial M6 preflight deliberately has no room-principal credential or
 * CalDAV transport implementation. Tests can inject a fake access adapter and
 * verify the resolved target; production fails closed until the separate
 * OpenID/plugin and trusted-domain gates are complete.
 */
@Injectable()
export class RoomCalendarCalDavAccess {
  collectionUrl(_target: RoomCalendarTarget): string {
    throw this.disabledError();
  }

  createEventClient(_target: RoomCalendarTarget): CalDavEventClient {
    throw this.disabledError();
  }

  private disabledError(): ServiceUnavailableException {
    return new ServiceUnavailableException({
      code: 'room-calendar-caldav-disabled',
      message: 'Room calendar CalDAV access is not enabled',
    });
  }
}
