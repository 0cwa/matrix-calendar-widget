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

import { isCanonicalMatrixRoomId } from '../service/RoomCalendarBindingResolver';
import type { RoomMentionMessage } from './RoomMentionMessage';
import {
  RoomMentionMatrixState,
  RoomMentionPowerLevels,
  authorizeRoomMentionDelivery,
} from './RoomMentionPolicy';
import type {
  ReminderSchedulerRuntimeSource,
  RoomReminderSchedulerSender,
} from './RoomReminderScheduler';

const MAX_MATRIX_STATE_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_MATRIX_SEND_RESPONSE_BYTES = 16 * 1024;
const MAX_ROOM_MEMBERS = 20_000;
const MATRIX_REMINDER_REQUEST_TIMEOUT_MS = 2_000;
const RESPONSE_CANCEL_TIMEOUT_MS = 100;

export type MatrixAppServiceReminderTransportOptions = Readonly<{
  homeserverUrl: string;
  applicationServiceToken: string;
  applicationServiceSenderUserId: string;
}>;

export type MatrixReminderTransportErrorCode =
  | 'invalid-configuration'
  | 'authorization-denied'
  | 'request-failed'
  | 'invalid-response'
  | 'response-too-large';

/** Fixed-text failure: never includes a URL, token, or homeserver body. */
export class MatrixReminderTransportError extends Error {
  constructor(public readonly code: MatrixReminderTransportErrorCode) {
    super(`Matrix reminder transport failed (${code})`);
    this.name = 'MatrixReminderTransportError';
  }
}

/**
 * Native Matrix Client-Server API adapter for reminder state and sends.
 * All requests are fixed to the configured application-service identity,
 * carry the scheduler's abort signal, reject redirects, and parse bounded
 * response JSON without returning server-provided error text.
 */
export class MatrixAppServiceReminderTransport
  implements RoomMentionMatrixState, RoomReminderSchedulerSender
{
  private readonly homeserverBase: URL;

  constructor(
    private readonly options: MatrixAppServiceReminderTransportOptions,
    private readonly runtime: ReminderSchedulerRuntimeSource,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    try {
      const base = new URL(options.homeserverUrl);
      if (
        (base.protocol !== 'http:' && base.protocol !== 'https:') ||
        base.username ||
        base.password ||
        base.search ||
        base.hash ||
        !isCanonicalMatrixUserId(options.applicationServiceSenderUserId) ||
        options.applicationServiceToken.trim().length === 0
      ) {
        throw new Error('invalid configuration');
      }
      this.homeserverBase = base;
    } catch {
      throw new MatrixReminderTransportError('invalid-configuration');
    }
  }

  async isRoomEncrypted(
    roomId: string,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const response = await this.requestState(
      roomId,
      'm.room.encryption',
      signal,
    );
    if (
      response.status === 404 &&
      getErrcode(response.body) === 'M_NOT_FOUND'
    ) {
      return false;
    }
    if (response.status !== 200) {
      throw new MatrixReminderTransportError('request-failed');
    }
    const content = getStateEventContent(response.body);
    if (
      typeof content.algorithm !== 'string' ||
      content.algorithm.length === 0
    ) {
      throw new MatrixReminderTransportError('invalid-response');
    }
    return true;
  }

  async getJoinedRoomMembers(
    roomId: string,
    signal?: AbortSignal,
  ): Promise<readonly string[]> {
    const response = await this.requestJson(
      this.roomPath(roomId, '/joined_members'),
      signal,
      MAX_MATRIX_STATE_RESPONSE_BYTES,
    );
    if (response.status !== 200) {
      throw new MatrixReminderTransportError('request-failed');
    }
    const root = asRecord(response.body);
    const joined = asRecord(root?.joined);
    if (!joined) throw new MatrixReminderTransportError('invalid-response');
    const members = Object.keys(joined);
    if (
      members.length > MAX_ROOM_MEMBERS ||
      members.some((id) => !isCanonicalMatrixUserId(id))
    ) {
      throw new MatrixReminderTransportError('invalid-response');
    }
    return members;
  }

  async getPowerLevels(
    roomId: string,
    signal?: AbortSignal,
  ): Promise<RoomMentionPowerLevels | undefined> {
    const response = await this.requestState(
      roomId,
      'm.room.power_levels',
      signal,
    );
    if (
      response.status === 404 &&
      getErrcode(response.body) === 'M_NOT_FOUND'
    ) {
      return undefined;
    }
    if (response.status !== 200) {
      throw new MatrixReminderTransportError('request-failed');
    }
    const content = getStateEventContent(response.body);
    const users = readOptionalObjectMap(content, 'users');
    const events = readOptionalObjectMap(content, 'events');
    const notifications = readOptionalObjectMap(content, 'notifications');
    return {
      ...(users === undefined
        ? {}
        : { users: users as RoomMentionPowerLevels['users'] }),
      ...(hasOwn(content, 'users_default')
        ? {
            users_default:
              content.users_default as RoomMentionPowerLevels['users_default'],
          }
        : {}),
      ...(events === undefined
        ? {}
        : { events: events as RoomMentionPowerLevels['events'] }),
      ...(hasOwn(content, 'events_default')
        ? {
            events_default:
              content.events_default as RoomMentionPowerLevels['events_default'],
          }
        : {}),
      ...(hasOwn(content, 'state_default')
        ? {
            state_default:
              content.state_default as RoomMentionPowerLevels['state_default'],
          }
        : {}),
      ...(notifications === undefined
        ? {}
        : {
            notifications:
              notifications as RoomMentionPowerLevels['notifications'],
          }),
    };
  }

  async getRoomVersion(
    roomId: string,
    signal?: AbortSignal,
  ): Promise<string | undefined> {
    const response = await this.requestState(roomId, 'm.room.create', signal);
    if (response.status !== 200) {
      throw new MatrixReminderTransportError('request-failed');
    }
    const content = getStateEventContent(response.body);
    const version = content.room_version;
    if (version === undefined) return '1';
    if (typeof version !== 'string' || version.length === 0) {
      throw new MatrixReminderTransportError('invalid-response');
    }
    return version;
  }

  async sendRoomMention(
    roomId: string,
    calendarId: string,
    message: RoomMentionMessage,
    transactionId: string,
    signal: AbortSignal,
  ): Promise<void> {
    throwIfAborted(signal);
    validateMessage(message);
    if (!/^mcal-reminder-[a-f0-9]{64}$/.test(transactionId)) {
      throw new MatrixReminderTransportError('invalid-response');
    }

    const current = await this.runtime.getCurrentConfiguration(signal);
    if (
      current.applicationServiceSenderUserId !==
        this.options.applicationServiceSenderUserId ||
      current.roomCalendarAccessEnabled !== true ||
      current.roomReminderDeliveryEnabled !== true ||
      current.reminderStoreEnabled !== true
    ) {
      throw new MatrixReminderTransportError('authorization-denied');
    }
    const binding = await authorizeRoomMentionDelivery(
      {
        roomId,
        calendarId,
        applicationServiceSenderUserId:
          this.options.applicationServiceSenderUserId,
        configuredBindings: current.roomCalendarBindings,
      },
      this,
      signal,
    );
    if (!binding)
      throw new MatrixReminderTransportError('authorization-denied');

    throwIfAborted(signal);
    const url = this.clientUrl(
      `/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${encodeURIComponent(transactionId)}`,
    );
    url.searchParams.set(
      'user_id',
      this.options.applicationServiceSenderUserId,
    );
    const requestSignal = createRequestSignal(signal);
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'PUT',
        headers: this.headers(),
        body: JSON.stringify(message.content),
        redirect: 'manual',
        signal: requestSignal,
      });
    } catch {
      throw requestError(signal, requestSignal);
    }
    if (isRedirect(response.status)) {
      await cancelResponseBody(response);
      throw new MatrixReminderTransportError('request-failed');
    }
    const result = await readResponseJson(
      response,
      MAX_MATRIX_SEND_RESPONSE_BYTES,
      requestSignal,
      signal,
    );
    if (response.status !== 200) {
      throw new MatrixReminderTransportError('request-failed');
    }
    const eventId = asRecord(result)?.event_id;
    if (
      typeof eventId !== 'string' ||
      eventId.length === 0 ||
      eventId.length > 1024
    ) {
      throw new MatrixReminderTransportError('invalid-response');
    }
  }

  private async requestState(
    roomId: string,
    eventType: string,
    signal?: AbortSignal,
  ): Promise<JsonResponse> {
    return this.requestJson(
      this.roomPath(roomId, `/state/${encodeURIComponent(eventType)}/`),
      signal,
      MAX_MATRIX_STATE_RESPONSE_BYTES,
    );
  }

  private async requestJson(
    path: string,
    signal: AbortSignal | undefined,
    maxBytes: number,
  ): Promise<JsonResponse> {
    throwIfAborted(signal);
    const url = this.clientUrl(path);
    url.searchParams.set(
      'user_id',
      this.options.applicationServiceSenderUserId,
    );
    const requestSignal = createRequestSignal(signal);
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'GET',
        headers: this.headers(),
        redirect: 'manual',
        signal: requestSignal,
      });
    } catch {
      throw requestError(signal, requestSignal);
    }
    if (isRedirect(response.status)) {
      await cancelResponseBody(response);
      throw new MatrixReminderTransportError('request-failed');
    }
    const body = await readResponseJson(
      response,
      maxBytes,
      requestSignal,
      signal,
    );
    return { status: response.status, body };
  }

  private roomPath(roomId: string, suffix: string): string {
    if (!isCanonicalMatrixRoomId(roomId)) {
      throw new MatrixReminderTransportError('authorization-denied');
    }
    return `/rooms/${encodeURIComponent(roomId)}${suffix}`;
  }

  private clientUrl(path: string): URL {
    const prefix = this.homeserverBase.pathname.endsWith('/')
      ? this.homeserverBase.pathname.slice(0, -1)
      : this.homeserverBase.pathname;
    const result = new URL(
      `${prefix}/_matrix/client/v3${path}`,
      this.homeserverBase.origin,
    );
    return result;
  }

  private headers(): Headers {
    return new Headers({
      Authorization: `Bearer ${this.options.applicationServiceToken}`,
      Accept: 'application/json',
    });
  }
}

type JsonResponse = { status: number; body: unknown };

async function readJsonResponse(
  response: Response,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<unknown> {
  throwIfAborted(signal);
  const contentLength = response.headers.get('Content-Length');
  if (
    contentLength !== null &&
    /^\d+$/.test(contentLength) &&
    BigInt(contentLength) > BigInt(maxBytes)
  ) {
    await cancelResponseBody(response);
    throw new MatrixReminderTransportError('response-too-large');
  }

  const body = response.body as
    | (AsyncIterable<Uint8Array> & {
        cancel?: () => Promise<void>;
        destroy?: () => unknown;
        getReader?: () => ReadableStreamDefaultReader<Uint8Array>;
      })
    | null;
  if (!body) {
    throw new MatrixReminderTransportError('invalid-response');
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (typeof body === 'string' || body instanceof Uint8Array) {
    const bytes =
      typeof body === 'string' ? new TextEncoder().encode(body) : body;
    if (bytes.byteLength > maxBytes) {
      throw new MatrixReminderTransportError('response-too-large');
    }
    try {
      return JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      );
    } catch {
      throw new MatrixReminderTransportError('invalid-response');
    }
  }
  const reader = body.getReader?.();
  try {
    if (reader) {
      while (true) {
        const { done, value } = await readWithAbort(reader.read(), signal);
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
          throw new MatrixReminderTransportError('response-too-large');
        }
        chunks.push(value);
      }
    } else if (body[Symbol.asyncIterator]) {
      const iterator = body[Symbol.asyncIterator]();
      while (true) {
        const next = await readWithAbort(
          Promise.resolve(iterator.next()),
          signal,
        );
        if (next.done) break;
        const value = next.value;
        size += value.byteLength;
        if (size > maxBytes) {
          throw new MatrixReminderTransportError('response-too-large');
        }
        chunks.push(value);
      }
    } else {
      throw new MatrixReminderTransportError('invalid-response');
    }
  } catch (error) {
    try {
      if (reader) {
        await cancelWithinLimit(() => reader.cancel());
      } else if (body.cancel) {
        await cancelWithinLimit(() => body.cancel!());
      } else {
        body.destroy?.();
      }
    } catch {
      // The stream may already be cancelled by fetch abort.
    }
    if (error instanceof MatrixReminderTransportError) throw error;
    if (signal?.aborted) throw abortError();
    throw new MatrixReminderTransportError('invalid-response');
  } finally {
    try {
      reader?.releaseLock();
    } catch {
      // A failed reader can remain locked after cancellation.
    }
  }

  throwIfAborted(signal);
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new MatrixReminderTransportError('invalid-response');
  }
}

async function readWithAbort<T>(
  work: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  throwIfAborted(signal);
  if (!signal) return work;
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
    await cancelWithinLimit(() => response.body?.cancel());
  } catch {
    // The response body is discarded; it is never included in an error.
  }
}

async function readResponseJson(
  response: Response,
  maxBytes: number,
  requestSignal: AbortSignal,
  callerSignal?: AbortSignal,
): Promise<unknown> {
  try {
    return await readJsonResponse(response, maxBytes, requestSignal);
  } catch (error) {
    if (callerSignal?.aborted) throw abortError();
    if (requestSignal.aborted) {
      throw new MatrixReminderTransportError('request-failed');
    }
    if (error instanceof MatrixReminderTransportError) throw error;
    throw new MatrixReminderTransportError('invalid-response');
  }
}

function createRequestSignal(callerSignal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(MATRIX_REMINDER_REQUEST_TIMEOUT_MS);
  return callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout;
}

function requestError(
  callerSignal: AbortSignal | undefined,
  requestSignal: AbortSignal,
): MatrixReminderTransportError | Error {
  if (callerSignal?.aborted) return abortError();
  if (requestSignal.aborted) {
    return new MatrixReminderTransportError('request-failed');
  }
  return new MatrixReminderTransportError('request-failed');
}

async function cancelWithinLimit(
  cancel: () => Promise<unknown> | undefined,
): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      Promise.resolve()
        .then(cancel)
        .then(
          () => undefined,
          () => undefined,
        ),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, RESPONSE_CANCEL_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function validateMessage(message: RoomMentionMessage): void {
  const content = message?.content;
  const mentions = content?.['m.mentions'];
  if (
    !message ||
    message.type !== 'm.room.message' ||
    !content ||
    content.msgtype !== 'm.text' ||
    typeof content.body !== 'string' ||
    content.body.trim().length === 0 ||
    Buffer.byteLength(content.body, 'utf8') > 4_096 ||
    !mentions ||
    mentions.room !== true ||
    Object.keys(mentions).some((key) => key !== 'room') ||
    Object.keys(content).some(
      (key) => !['msgtype', 'body', 'm.mentions'].includes(key),
    )
  ) {
    throw new MatrixReminderTransportError('invalid-response');
  }
}

function isCanonicalMatrixUserId(value: string): boolean {
  return /^@[^\s:#?]+:[^\s?#]+$/.test(value);
}

function getErrcode(value: unknown): string | undefined {
  const object = asRecord(value);
  return typeof object?.errcode === 'string' ? object.errcode : undefined;
}

function getStateEventContent(value: unknown): Record<string, unknown> {
  const content = asRecord(value);
  if (!content) throw new MatrixReminderTransportError('invalid-response');
  return content;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null
    ? (value as Record<string, unknown>)
    : undefined;
}

function readOptionalObjectMap(
  content: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  if (!hasOwn(content, key)) return undefined;
  const map = asRecord(content[key]);
  if (!map) throw new MatrixReminderTransportError('invalid-response');
  return map;
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isRedirect(status: number): boolean {
  return status >= 300 && status < 400;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function abortError(): Error {
  return new DOMException('The operation was aborted', 'AbortError');
}
