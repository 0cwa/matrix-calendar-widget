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
  Inject,
  Injectable,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { UserID } from 'matrix-bot-sdk';
import { IAppConfiguration } from '../IAppConfiguration';
import { ModuleProviderToken } from '../ModuleProviderToken';
import { IMatrixOpenIdCredential } from '../model/IMatrixOpenIdCredential';
import { RoomCalendarBinding } from '../model/IRoomCalendarBinding';
import { resolveRoomCalendarBinding } from './RoomCalendarBindingResolver';

export interface RoomCalendarTarget {
  readonly roomId: string;
  /** Stable server-configured collection identifier, never a DAV href. */
  readonly calendarId: string;
  readonly principal: { readonly kind: 'service' };
}

export interface RoomCalendarCalDavPrincipal {
  readonly userId: string;
  readonly calendarUrl: string;
  readonly credential: IMatrixOpenIdCredential;
}

/**
 * Room-target CalDAV uses only a server-configured application principal and
 * exact room binding. Deployment must keep the explicit access gate disabled
 * until the real appservice and isolation contracts pass.
 */
@Injectable()
export class RoomCalendarCalDavAccess {
  constructor(
    @Optional()
    @Inject(ModuleProviderToken.APP_CONFIGURATION)
    private readonly appConfig?: IAppConfiguration,
  ) {}

  assertDisabled(_target: RoomCalendarTarget): never {
    throw this.disabledError();
  }

  /**
   * Resolve the exact configured service-principal collection and mint its
   * request-scoped OpenID proof. Call only after actor authorization.
   */
  async forAuthorizedTarget(
    target: RoomCalendarTarget,
  ): Promise<RoomCalendarCalDavPrincipal> {
    const config = this.appConfig;
    if (!config?.room_calendar_access_enabled) {
      throw this.disabledError();
    }

    if (target.principal.kind !== 'service') {
      throw this.disabledError();
    }

    let binding: RoomCalendarBinding;
    try {
      binding = resolveRoomCalendarBinding(
        config.room_calendar_bindings,
        target.roomId,
        target.calendarId,
      );
    } catch {
      throw this.disabledError();
    }

    const serviceUserId = config.application_service_user_id;
    const serviceToken = config.application_service_token;
    const radicaleUrl = config.radicale_url;
    if (!serviceUserId || !serviceToken || !radicaleUrl) {
      throw this.disabledError();
    }

    let localpart: string;
    let serverName: string;
    try {
      const parsedUserId = new UserID(serviceUserId);
      localpart = parsedUserId.localpart;
      serverName = parsedUserId.domain;
      const delimiter = serviceUserId.indexOf(':');
      if (
        !serviceUserId.startsWith('@') ||
        delimiter <= 1 ||
        delimiter === serviceUserId.length - 1 ||
        !localpart ||
        !serverName ||
        serviceUserId.slice(1, delimiter) !== localpart ||
        serviceUserId.slice(delimiter + 1) !== serverName
      ) {
        throw new Error('invalid configured application-service user ID');
      }
    } catch {
      throw this.disabledError();
    }

    const calendarUrl = roomCalendarCollectionUrl(
      radicaleUrl,
      localpart,
      binding.calendarId,
    );
    const credential = await this.requestOpenIdCredential(
      serviceUserId,
      serviceToken,
      serverName,
      config.homeserver_url,
    );

    return { userId: serviceUserId, calendarUrl, credential };
  }

  private async requestOpenIdCredential(
    userId: string,
    serviceToken: string,
    serverName: string,
    homeserverUrl: string,
  ): Promise<IMatrixOpenIdCredential> {
    let response: Response;
    try {
      response = await fetch(
        `${homeserverUrl.replace(/\/$/, '')}/_matrix/client/v3/user/${encodeURIComponent(userId)}/openid/request_token`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${serviceToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ user_id: userId }),
          redirect: 'error',
          signal: AbortSignal.timeout(10_000),
        },
      );
    } catch {
      throw this.authorizationUnavailableError();
    }

    if (!response.ok) {
      throw this.authorizationUnavailableError();
    }

    let result: unknown;
    try {
      result = await response.json();
    } catch {
      throw this.authorizationUnavailableError();
    }

    if (result === null || typeof result !== 'object') {
      throw this.authorizationUnavailableError();
    }

    const credential = result as Record<string, unknown>;
    const accessToken = credential.access_token;
    if (
      typeof accessToken !== 'string' ||
      accessToken.length === 0 ||
      credential.matrix_server_name !== serverName
    ) {
      throw this.authorizationUnavailableError();
    }

    return {
      accessToken,
      matrixServerName: serverName,
    };
  }

  private disabledError(): ServiceUnavailableException {
    return new ServiceUnavailableException({
      code: 'room-calendar-caldav-disabled',
      message: 'Room calendar CalDAV access is not enabled',
    });
  }

  private authorizationUnavailableError(): ServiceUnavailableException {
    return new ServiceUnavailableException({
      code: 'room-calendar-authorization-unavailable',
      message: 'Room calendar access is unavailable',
    });
  }
}

function roomCalendarCollectionUrl(
  radicaleUrl: string,
  localpart: string,
  calendarId: string,
): string {
  try {
    const base = new URL(radicaleUrl);
    if (
      (base.protocol !== 'http:' && base.protocol !== 'https:') ||
      base.username ||
      base.password ||
      base.search ||
      base.hash
    ) {
      throw new Error('invalid Radicale base URL');
    }
    if (!base.pathname.endsWith('/')) {
      base.pathname = `${base.pathname}/`;
    }

    return new URL(
      `${encodeURIComponent(localpart)}/${encodeURIComponent(calendarId)}/`,
      base,
    ).toString();
  } catch {
    throw new ServiceUnavailableException({
      code: 'room-calendar-caldav-disabled',
      message: 'Room calendar CalDAV access is not enabled',
    });
  }
}
