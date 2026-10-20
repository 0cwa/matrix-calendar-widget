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
import type { RoomCalendarBindingRegistry } from './IRoomCalendarBindingRegistry';
import {
  RoomCalendarPrincipalOpenIdProofUnavailableError,
  type RoomCalendarPrincipalOpenIdProofPort,
} from './RoomCalendarPrincipalOpenIdProofProvider';
import type { RoomCalendarPrincipalIdentity } from './RoomCalendarPrincipalIdentity';

export interface RoomCalendarTarget {
  readonly roomId: string;
  /** Stable server-configured collection identifier, never a DAV href. */
  readonly calendarId: string;
  readonly principal: { readonly kind: 'service' };
}

export interface RoomCalendarCalDavPrincipal {
  readonly identity: RoomCalendarPrincipalIdentity;
  readonly userId: string;
  readonly calendarUrl: string;
  readonly credential: IMatrixOpenIdCredential;
}

export type RoomCalendarAccessMode = 'read' | 'write';

export function isSafeRoomCalendarServiceUserLocalpart(
  localpart: string,
): boolean {
  return (
    /^[A-Za-z0-9._=-]{1,255}$/.test(localpart) &&
    localpart !== '.' &&
    localpart !== '..'
  );
}

export function parseRoomCalendarServiceUserId(
  userId: string,
): { localpart: string; serverName: string } | undefined {
  try {
    const parsedUserId = new UserID(userId);
    const localpart = parsedUserId.localpart;
    const serverName = parsedUserId.domain;
    const delimiter = userId.indexOf(':');
    if (
      !userId.startsWith('@') ||
      delimiter <= 1 ||
      delimiter === userId.length - 1 ||
      !localpart ||
      !serverName ||
      userId.slice(1, delimiter) !== localpart ||
      userId.slice(delimiter + 1) !== serverName
    ) {
      return undefined;
    }

    return { localpart, serverName };
  } catch {
    return undefined;
  }
}

/**
 * Room-target CalDAV uses the process-selected server principal and exact room
 * binding. Deployment must keep the explicit access gate disabled until the
 * selected principal and isolation contracts pass.
 */
@Injectable()
export class RoomCalendarCalDavAccess {
  constructor(
    @Optional()
    @Inject(ModuleProviderToken.APP_CONFIGURATION)
    private readonly appConfig?: IAppConfiguration,
    @Optional()
    @Inject(ModuleProviderToken.ROOM_CALENDAR_BINDING_REGISTRY)
    private readonly bindingRegistry?: RoomCalendarBindingRegistry,
    @Optional()
    @Inject(ModuleProviderToken.ROOM_CALENDAR_PRINCIPAL_OPENID_PROOF_PROVIDER)
    private readonly proofProvider?: RoomCalendarPrincipalOpenIdProofPort,
  ) {}

  assertDisabled(_target: RoomCalendarTarget): never {
    throw this.disabledError();
  }

  /**
   * Resolve the exact selected-principal collection and mint its
   * request-scoped OpenID proof. Call only after actor authorization.
   */
  async forAuthorizedTarget(
    target: RoomCalendarTarget,
    mode: RoomCalendarAccessMode,
    signal?: AbortSignal,
  ): Promise<RoomCalendarCalDavPrincipal> {
    if (signal?.aborted) throw abortError();
    const config = this.appConfig;
    if (
      (mode !== 'read' && mode !== 'write') ||
      !config?.room_calendar_access_enabled ||
      (mode === 'write' && !config.room_calendar_event_writes_enabled)
    ) {
      throw this.disabledError();
    }

    if (target?.principal?.kind !== 'service') {
      throw this.disabledError();
    }

    let binding: RoomCalendarBinding;
    try {
      if (!this.bindingRegistry) throw new Error('Room calendar registry missing');
      binding = await this.bindingRegistry.resolve(
        target.roomId,
        target.calendarId,
        signal,
      );
    } catch {
      if (signal?.aborted) throw abortError();
      throw this.disabledError();
    }

    const principalMode = config.room_calendar_principal_mode;
    const radicaleUrl = config.radicale_url;
    if (!radicaleUrl) {
      throw this.disabledError();
    }
    assertSafeRadicaleBaseUrl(radicaleUrl);

    if (principalMode === 'appservice') {
      const configuredPrincipal = config.application_service_user_id
        ? parseRoomCalendarServiceUserId(config.application_service_user_id)
        : undefined;
      if (
        !configuredPrincipal ||
        !isSafeRoomCalendarServiceUserLocalpart(
          configuredPrincipal.localpart,
        ) ||
        !config.application_service_token
      ) {
        throw this.disabledError();
      }
    } else if (principalMode === 'bot-account') {
      if (!config.access_token) throw this.disabledError();
    } else {
      throw this.disabledError();
    }

    const proofProvider = this.proofProvider;
    if (!proofProvider) throw this.disabledError();

    let proof: Awaited<ReturnType<RoomCalendarPrincipalOpenIdProofPort['request']>>;
    try {
      proof = await proofProvider.request(signal);
    } catch (error) {
      if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
        throw error;
      }
      if (error instanceof RoomCalendarPrincipalOpenIdProofUnavailableError) {
        throw this.authorizationUnavailableError();
      }
      throw this.authorizationUnavailableError();
    }

    if (proof === null || typeof proof !== 'object') {
      throw this.authorizationUnavailableError();
    }
    const parsedUserId = parseRoomCalendarServiceUserId(proof.userId);
    if (
      !parsedUserId ||
      proof.identity?.mode !== principalMode ||
      proof.identity.userId !== proof.userId ||
      (principalMode === 'appservice' &&
        proof.userId !== config.application_service_user_id) ||
      !isValidProofCredential(proof.credential, parsedUserId.serverName)
    ) {
      throw this.authorizationUnavailableError();
    }

    const calendarUrl = roomCalendarCollectionUrl(
      radicaleUrl,
      parsedUserId.localpart,
      binding.calendarId,
    );

    return {
      identity: proof.identity,
      userId: proof.userId,
      calendarUrl,
      credential: proof.credential,
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

function abortError(): Error {
  return new DOMException('The operation was aborted', 'AbortError');
}

function isValidProofCredential(
  credential: IMatrixOpenIdCredential | undefined,
  serverName: string,
): credential is IMatrixOpenIdCredential {
  return (
    credential !== undefined &&
    typeof credential.accessToken === 'string' &&
    credential.accessToken.length > 0 &&
    credential.matrixServerName === serverName
  );
}

function assertSafeRadicaleBaseUrl(radicaleUrl: string): void {
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
  } catch {
    throw new ServiceUnavailableException({
      code: 'room-calendar-caldav-disabled',
      message: 'Room calendar CalDAV access is not enabled',
    });
  }
}

function roomCalendarCollectionUrl(
  radicaleUrl: string,
  localpart: string,
  calendarId: string,
): string {
  try {
    // Service principals use one literal, unambiguous CalDAV home segment.
    // Dot segments normalize away before percent encoding can confine them.
    if (!isSafeRoomCalendarServiceUserLocalpart(localpart)) {
      throw new Error('invalid application-service home segment');
    }
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
