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
import {
  cancelDavResponse,
  readBoundedDavResponse,
} from '../caldav/BoundedDavResponse';
import type { IAppConfiguration } from '../IAppConfiguration';
import { IMatrixOpenIdCredential } from '../model/IMatrixOpenIdCredential';
import type {
  RoomCalendarPrincipalIdentity,
  RoomCalendarPrincipalIdentityProvider,
} from './RoomCalendarPrincipalIdentity';

const MAX_OPENID_RESPONSE_BYTES = 16 * 1024;
const OPENID_REQUEST_TIMEOUT_MS = 10_000;

/** A short-lived OpenID proof for the one server-selected room principal. */
export type RoomCalendarPrincipalOpenIdProof = Readonly<{
  identity: RoomCalendarPrincipalIdentity;
  userId: string;
  credential: IMatrixOpenIdCredential;
}>;

/** Shared proof source for bound room access and the setup provisioner. */
export interface RoomCalendarPrincipalOpenIdProofPort {
  request(signal?: AbortSignal): Promise<RoomCalendarPrincipalOpenIdProof>;
}

export class RoomCalendarPrincipalOpenIdProofUnavailableError extends Error {
  constructor() {
    super('Room calendar authorization is unavailable');
    this.name = 'RoomCalendarPrincipalOpenIdProofUnavailableError';
  }
}

/**
 * Mints an in-memory tagged OpenID credential only for the identity selected
 * by ADR041. The result is never persisted or logged.
 */
export class MatrixRoomCalendarPrincipalOpenIdProofProvider implements RoomCalendarPrincipalOpenIdProofPort {
  constructor(
    private readonly appConfig: Pick<
      IAppConfiguration,
      | 'room_calendar_principal_mode'
      | 'application_service_user_id'
      | 'application_service_token'
      | 'access_token'
      | 'homeserver_url'
    >,
    private readonly principalIdentityProvider: RoomCalendarPrincipalIdentityProvider,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async request(
    signal?: AbortSignal,
  ): Promise<RoomCalendarPrincipalOpenIdProof> {
    if (signal?.aborted) throw abortError();

    const { identity, serviceToken } = await this.resolvePrincipal();
    const parsed = parseCanonicalServiceUserId(identity.userId);
    if (!parsed) throw new RoomCalendarPrincipalOpenIdProofUnavailableError();

    const responseSignal = signal
      ? AbortSignal.any([
          signal,
          AbortSignal.timeout(OPENID_REQUEST_TIMEOUT_MS),
        ])
      : AbortSignal.timeout(OPENID_REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await this.fetchImpl(
        `${this.appConfig.homeserver_url.replace(/\/$/u, '')}/_matrix/client/v3/user/${encodeURIComponent(identity.userId)}/openid/request_token`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${serviceToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(
            identity.mode === 'appservice' ? { user_id: identity.userId } : {},
          ),
          redirect: 'error',
          signal: responseSignal,
        },
      );
    } catch {
      if (signal?.aborted) throw abortError();
      throw new RoomCalendarPrincipalOpenIdProofUnavailableError();
    }

    if (!response.ok) {
      await cancelDavResponse(response);
      throw new RoomCalendarPrincipalOpenIdProofUnavailableError();
    }

    let result: unknown;
    try {
      result = JSON.parse(
        await readBoundedDavResponse(response, MAX_OPENID_RESPONSE_BYTES),
      );
    } catch {
      if (signal?.aborted) throw abortError();
      throw new RoomCalendarPrincipalOpenIdProofUnavailableError();
    }

    if (!isRecord(result)) {
      throw new RoomCalendarPrincipalOpenIdProofUnavailableError();
    }
    const accessToken = result.access_token;
    if (
      typeof accessToken !== 'string' ||
      accessToken.length === 0 ||
      result.matrix_server_name !== parsed.serverName
    ) {
      throw new RoomCalendarPrincipalOpenIdProofUnavailableError();
    }

    return Object.freeze({
      identity,
      userId: identity.userId,
      credential: Object.freeze({
        accessToken,
        matrixServerName: parsed.serverName,
      }),
    });
  }

  private async resolvePrincipal(): Promise<{
    identity: RoomCalendarPrincipalIdentity;
    serviceToken: string;
  }> {
    const config = this.appConfig;
    const mode = config.room_calendar_principal_mode;
    let identity: RoomCalendarPrincipalIdentity;
    try {
      identity = await this.principalIdentityProvider.resolve();
    } catch {
      throw new RoomCalendarPrincipalOpenIdProofUnavailableError();
    }

    if (identity.mode !== mode) {
      throw new RoomCalendarPrincipalOpenIdProofUnavailableError();
    }

    let serviceToken: string | undefined;
    if (mode === 'appservice') {
      if (
        !config.application_service_user_id ||
        identity.userId !== config.application_service_user_id
      ) {
        throw new RoomCalendarPrincipalOpenIdProofUnavailableError();
      }
      serviceToken = config.application_service_token;
    } else if (mode === 'bot-account') {
      serviceToken = config.access_token;
    } else {
      throw new RoomCalendarPrincipalOpenIdProofUnavailableError();
    }

    if (!serviceToken || !config.homeserver_url) {
      throw new RoomCalendarPrincipalOpenIdProofUnavailableError();
    }

    return { identity, serviceToken };
  }
}

function parseCanonicalServiceUserId(
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function abortError(): Error {
  return new DOMException('The operation was aborted', 'AbortError');
}
