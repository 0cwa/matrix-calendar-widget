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

import { UserID } from 'matrix-bot-sdk';
import type { MatrixClient } from 'matrix-bot-sdk';
import type { AppRuntimeContext } from '../AppRuntimeContext';
import type { IAppConfiguration } from '../IAppConfiguration';
import type {
  RoomCalendarPrincipalIdentity,
  RoomCalendarPrincipalIdentityProvider,
} from './RoomCalendarPrincipalIdentity';

export class RoomCalendarPrincipalIdentityUnavailableError extends Error {
  constructor() {
    super('Room calendar principal identity is unavailable');
    this.name = 'RoomCalendarPrincipalIdentityUnavailableError';
  }
}

/** Resolves one process-selected principal from its configured identity source. */
export class ConfiguredRoomCalendarPrincipalIdentityProvider implements RoomCalendarPrincipalIdentityProvider {
  private identityPromise?: Promise<RoomCalendarPrincipalIdentity>;

  constructor(
    private readonly appConfig: Pick<
      IAppConfiguration,
      'room_calendar_principal_mode' | 'application_service_user_id'
    >,
    private readonly matrixClient: Pick<MatrixClient, 'getUserId'>,
    private readonly appRuntimeContext: Pick<AppRuntimeContext, 'botUserId'>,
  ) {}

  resolve(): Promise<RoomCalendarPrincipalIdentity> {
    if (!this.identityPromise) {
      const attempt = this.resolveOnce();
      const memoized = attempt.catch((error: unknown) => {
        if (this.identityPromise === memoized) {
          this.identityPromise = undefined;
        }
        throw error;
      });
      this.identityPromise = memoized;
    }
    return this.identityPromise;
  }

  private async resolveOnce(): Promise<RoomCalendarPrincipalIdentity> {
    const mode = this.appConfig.room_calendar_principal_mode;
    let userId: string | undefined;

    if (mode === 'appservice') {
      userId = this.appConfig.application_service_user_id;
    } else if (mode === 'bot-account') {
      try {
        userId = await this.matrixClient.getUserId();
      } catch {
        throw new RoomCalendarPrincipalIdentityUnavailableError();
      }

      if (
        typeof userId !== 'string' ||
        userId !== this.appRuntimeContext.botUserId
      ) {
        throw new RoomCalendarPrincipalIdentityUnavailableError();
      }
    } else {
      throw new RoomCalendarPrincipalIdentityUnavailableError();
    }

    if (!isCanonicalMatrixUserId(userId)) {
      throw new RoomCalendarPrincipalIdentityUnavailableError();
    }

    return Object.freeze({ mode, userId });
  }
}

function isCanonicalMatrixUserId(value: unknown): value is string {
  if (typeof value !== 'string') return false;

  try {
    const parsed = new UserID(value);
    const separator = value.indexOf(':');
    return (
      value.startsWith('@') &&
      separator > 1 &&
      separator < value.length - 1 &&
      parsed.localpart.length > 0 &&
      parsed.domain.length > 0 &&
      value.slice(1, separator) === parsed.localpart &&
      value.slice(separator + 1) === parsed.domain
    );
  } catch {
    return false;
  }
}
