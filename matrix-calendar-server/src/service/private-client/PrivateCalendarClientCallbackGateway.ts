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

import type { NextFunction, Request, Response } from 'express';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { IAppConfiguration } from '../../IAppConfiguration';
import { PrivateCalendarClientPolicy } from './PrivateCalendarClientPolicy';

export const PRIVATE_CALENDAR_CLIENT_CALLBACK_ROOT =
  '/v1/private-calendar-client-callback';
export const PRIVATE_CALENDAR_CLIENT_CALLBACK_AUTH_PATH = `${PRIVATE_CALENDAR_CLIENT_CALLBACK_ROOT}/auth`;
export const PRIVATE_CALENDAR_CLIENT_CALLBACK_RIGHTS_PATH = `${PRIVATE_CALENDAR_CLIENT_CALLBACK_ROOT}/rights`;

export const PRIVATE_CALENDAR_CLIENT_CALLBACK_LIMITS = Object.freeze({
  maxBodyBytes: 16 * 1024,
  maxClockSkewSeconds: 30,
  nonceLifetimeMs: 60_000,
  maxNonceEntries: 10_000,
  nonceCleanupIntervalMs: 1_000,
});

const TIMESTAMP_PATTERN = /^(?:0|[1-9][0-9]{0,10})$/u;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{22}$/u;
const SIGNATURE_PATTERN = /^[a-f0-9]{64}$/u;

type CallbackAction = 'auth' | 'rights';

type CallbackPayload =
  | Readonly<{ username: string; password: string }>
  | Readonly<{ username: string; path: string }>;

type CallbackResult =
  | Readonly<{ allowed: boolean }>
  | Readonly<{ rights: string }>;

/** Single-process bounded replay cache; multi-replica mode is not supported. */
export class PrivateCalendarClientCallbackReplayCache {
  private readonly nonces = new Map<string, number>();
  private nextCleanupAt = 0;

  consume(nonce: string, now: number): boolean {
    this.cleanup(now);
    if (
      this.nonces.has(nonce) ||
      this.nonces.size >=
        PRIVATE_CALENDAR_CLIENT_CALLBACK_LIMITS.maxNonceEntries
    ) {
      return false;
    }
    this.nonces.set(
      nonce,
      now + PRIVATE_CALENDAR_CLIENT_CALLBACK_LIMITS.nonceLifetimeMs,
    );
    return true;
  }

  private cleanup(now: number): void {
    if (now < this.nextCleanupAt) return;
    for (const [nonce, expiresAt] of this.nonces) {
      if (expiresAt <= now) this.nonces.delete(nonce);
    }
    this.nextCleanupAt =
      now + PRIVATE_CALENDAR_CLIENT_CALLBACK_LIMITS.nonceCleanupIntervalMs;
  }
}

/** HMAC-authenticated Radicale callback ingress. Never logs its request path/body. */
export class PrivateCalendarClientCallbackGateway {
  private readonly replayCache = new PrivateCalendarClientCallbackReplayCache();

  constructor(
    private readonly appConfig: IAppConfiguration,
    private readonly policy: PrivateCalendarClientPolicy,
    private readonly now: () => number = Date.now,
  ) {}

  use(request: Request, response: Response, next: NextFunction): void {
    const rawTarget = request.originalUrl ?? request.url ?? '';
    if (!rawTarget.startsWith(`${PRIVATE_CALENDAR_CLIENT_CALLBACK_ROOT}/`)) {
      next();
      return;
    }

    void this.handle(request, response, rawTarget).catch(() => {
      if (!response.headersSent) response.status(404).end();
    });
  }

  private async handle(
    request: Request,
    response: Response,
    rawTarget: string,
  ): Promise<void> {
    const action = actionForTarget(rawTarget);
    const key = this.appConfig.private_calendar_client_callback_key;
    const now = this.now();
    const body = request.body;
    if (
      !action ||
      !key ||
      key.byteLength !== 32 ||
      request.method !== 'POST' ||
      request.headers['content-type'] !== 'application/octet-stream' ||
      !Buffer.isBuffer(body) ||
      body.byteLength > PRIVATE_CALENDAR_CLIENT_CALLBACK_LIMITS.maxBodyBytes
    ) {
      response.status(404).end();
      return;
    }

    const timestampText = readSingleHeader(request, 'x-mcw-callback-timestamp');
    const nonce = readSingleHeader(request, 'x-mcw-callback-nonce');
    const signature = readSingleHeader(request, 'x-mcw-callback-signature');
    if (
      !timestampText ||
      !TIMESTAMP_PATTERN.test(timestampText) ||
      !nonce ||
      !isCanonicalNonce(nonce) ||
      !signature ||
      !SIGNATURE_PATTERN.test(signature)
    ) {
      response.status(404).end();
      return;
    }

    const timestamp = Number(timestampText);
    const nowSeconds = Math.floor(now / 1000);
    if (
      !Number.isSafeInteger(timestamp) ||
      Math.abs(nowSeconds - timestamp) >
        PRIVATE_CALENDAR_CLIENT_CALLBACK_LIMITS.maxClockSkewSeconds
    ) {
      response.status(404).end();
      return;
    }

    const expectedSignature = callbackRequestSignature(
      key,
      rawTarget,
      timestampText,
      nonce,
      body,
    );
    if (!constantTimeHexEqual(signature, expectedSignature)) {
      response.status(404).end();
      return;
    }
    if (!this.replayCache.consume(nonce, now)) {
      response.status(404).end();
      return;
    }

    const payload = parsePayload(action, body);
    let result: CallbackResult =
      action === 'auth' ? { allowed: false } : { rights: '' };
    if (action === 'auth' && payload && 'password' in payload) {
      try {
        result = {
          allowed: await this.policy.authenticate(
            payload.username,
            payload.password,
          ),
        };
      } catch {
        // Policy, credential-store, and Matrix failures are indistinguishable denies.
      }
    } else if (action === 'rights' && payload && 'path' in payload) {
      try {
        result = {
          rights: await this.policy.rights(payload.username, payload.path),
        };
      } catch {
        // Policy, credential-store, and Matrix failures are indistinguishable denies.
      }
    }

    const responseBytes = Buffer.from(JSON.stringify(result), 'utf8');
    response
      .status(200)
      .setHeader('Content-Type', 'application/octet-stream')
      .setHeader('Cache-Control', 'no-store')
      .setHeader(
        'X-MCW-Callback-Response-Signature',
        callbackResponseSignature(key, 200, rawTarget, nonce, responseBytes),
      )
      .setHeader('Content-Length', String(responseBytes.byteLength))
      .end(responseBytes);
  }
}

export function callbackRequestSignature(
  key: Buffer,
  path: string,
  timestamp: string,
  nonce: string,
  body: Uint8Array,
): string {
  const bodyHash = createHash('sha256').update(body).digest('hex');
  return createHmac('sha256', key)
    .update(
      `mcw-private-callback-v1\nPOST\n${path}\n${timestamp}\n${nonce}\n${bodyHash}`,
    )
    .digest('hex');
}

export function callbackResponseSignature(
  key: Buffer,
  status: number,
  path: string,
  nonce: string,
  body: Uint8Array,
): string {
  const bodyHash = createHash('sha256').update(body).digest('hex');
  return createHmac('sha256', key)
    .update(
      `mcw-private-callback-response-v1\n${status}\n${path}\n${nonce}\n${bodyHash}`,
    )
    .digest('hex');
}

function actionForTarget(target: string): CallbackAction | undefined {
  if (target === PRIVATE_CALENDAR_CLIENT_CALLBACK_AUTH_PATH) return 'auth';
  if (target === PRIVATE_CALENDAR_CLIENT_CALLBACK_RIGHTS_PATH) return 'rights';
  return undefined;
}

function readSingleHeader(request: Request, name: string): string | undefined {
  const matches: string[] = [];
  const rawHeaders = request.rawHeaders ?? [];
  for (let index = 0; index + 1 < rawHeaders.length; index += 2) {
    if (rawHeaders[index].toLowerCase() === name)
      matches.push(rawHeaders[index + 1]);
  }
  if (matches.length !== 1) return undefined;
  return matches[0];
}

function isCanonicalNonce(value: string): boolean {
  if (!NONCE_PATTERN.test(value)) return false;
  const bytes = Buffer.from(value, 'base64url');
  return bytes.byteLength === 16 && bytes.toString('base64url') === value;
}

function parsePayload(
  action: CallbackAction,
  bytes: Buffer,
): CallbackPayload | undefined {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return undefined;
  }
  if (!isPlainRecord(value)) return undefined;
  if (
    action === 'auth' &&
    hasExactKeys(value, ['username', 'password']) &&
    typeof value.username === 'string' &&
    typeof value.password === 'string'
  ) {
    return { username: value.username, password: value.password };
  }
  if (
    action === 'rights' &&
    hasExactKeys(value, ['username', 'path']) &&
    typeof value.username === 'string' &&
    typeof value.path === 'string'
  ) {
    return { username: value.username, path: value.path };
  }
  return undefined;
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === expected.length &&
    expected.every((key) => keys.includes(key))
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function constantTimeHexEqual(left: string, right: string): boolean {
  if (!SIGNATURE_PATTERN.test(left) || !SIGNATURE_PATTERN.test(right))
    return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}
