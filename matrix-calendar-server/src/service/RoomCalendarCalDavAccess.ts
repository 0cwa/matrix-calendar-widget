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

/**
 * Room-target CalDAV uses only a server-configured application principal and
 * exact room binding. Deployment must keep the explicit access gate disabled
 * until the real appservice and isolation contracts pass.
 */
@Injectable()
export class RoomCalendarCalDavAccess {
  private readonly fetchImpl: typeof fetch;

  constructor(
    @Optional()
    @Inject(ModuleProviderToken.APP_CONFIGURATION)
    private readonly appConfig?: IAppConfiguration,
    @Optional()
    @Inject(ModuleProviderToken.NATIVE_FETCH)
    fetchImpl?: typeof fetch,
  ) {
    this.fetchImpl = fetchImpl ?? fetch;
  }

  assertDisabled(_target: RoomCalendarTarget): never {
    throw this.disabledError();
  }

  /**
   * Resolve the exact configured service-principal collection and mint its
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
      signal,
    );

    return { userId: serviceUserId, calendarUrl, credential };
  }

  private async requestOpenIdCredential(
    userId: string,
    serviceToken: string,
    serverName: string,
    homeserverUrl: string,
    signal?: AbortSignal,
  ): Promise<IMatrixOpenIdCredential> {
    if (signal?.aborted) throw abortError();
    let response: Response;
    try {
      response = await this.fetchImpl(
        `${homeserverUrl.replace(/\/$/, '')}/_matrix/client/v3/user/${encodeURIComponent(userId)}/openid/request_token`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${serviceToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ user_id: userId }),
          redirect: 'error',
          signal: signal
            ? AbortSignal.any([signal, AbortSignal.timeout(10_000)])
            : AbortSignal.timeout(10_000),
        },
      );
    } catch {
      if (signal?.aborted) throw abortError();
      throw this.authorizationUnavailableError();
    }

    if (!response.ok) {
      await cancelResponseBody(response);
      throw this.authorizationUnavailableError();
    }

    let result: unknown;
    try {
      result = await readJsonResponse(
        response,
        16 * 1024,
        signal
          ? AbortSignal.any([signal, AbortSignal.timeout(10_000)])
          : AbortSignal.timeout(10_000),
      );
    } catch {
      if (signal?.aborted) throw abortError();
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

function abortError(): Error {
  return new DOMException('The operation was aborted', 'AbortError');
}

async function readJsonResponse(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<unknown> {
  const contentLength = response.headers.get('Content-Length');
  if (
    contentLength !== null &&
    /^\d+$/.test(contentLength) &&
    BigInt(contentLength) > BigInt(maxBytes)
  ) {
    await cancelResponseBody(response);
    throw new Error('proof response too large');
  }
  const body = response.body as
    | (AsyncIterable<Uint8Array> & {
        cancel?: () => Promise<void>;
        destroy?: () => unknown;
        getReader?: () => ReadableStreamDefaultReader<Uint8Array>;
      })
    | null;
  if (!body) throw new Error('proof response missing body');
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (typeof body === 'string' || body instanceof Uint8Array) {
    const bytes =
      typeof body === 'string' ? new TextEncoder().encode(body) : body;
    if (bytes.byteLength > maxBytes)
      throw new Error('proof response too large');
    if (signal.aborted) throw abortError();
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  }
  const reader = body.getReader?.();
  try {
    if (reader) {
      while (true) {
        const { done, value } = await readWithAbort(reader.read(), signal);
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) throw new Error('proof response too large');
        chunks.push(value);
      }
    } else if (body[Symbol.asyncIterator]) {
      for await (const value of body) {
        if (signal.aborted) throw abortError();
        size += value.byteLength;
        if (size > maxBytes) throw new Error('proof response too large');
        chunks.push(value);
      }
    } else {
      throw new Error('proof response stream unavailable');
    }
  } catch (error) {
    try {
      if (reader) {
        await reader.cancel();
      } else if (body.cancel) {
        await body.cancel();
      } else {
        body.destroy?.();
      }
    } catch {
      // Fetch abort or a consumed body may already have closed the stream.
    }
    throw error;
  } finally {
    try {
      reader?.releaseLock();
    } catch {
      // Ignore a reader that the failed stream did not release cleanly.
    }
  }
  if (signal.aborted) throw abortError();
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

async function readWithAbort<T>(
  work: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) throw abortError();
  let onAbort: (() => void) | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(abortError());
        signal.addEventListener('abort', onAbort, { once: true });
      }),
    ]);
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    const body = response.body as
      | (AsyncIterable<Uint8Array> & {
          cancel?: () => Promise<void>;
          destroy?: () => unknown;
        })
      | null;
    if (body?.cancel) {
      await body.cancel();
    } else {
      body?.destroy?.();
    }
  } catch {
    // The response is discarded and no body text belongs in errors.
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
