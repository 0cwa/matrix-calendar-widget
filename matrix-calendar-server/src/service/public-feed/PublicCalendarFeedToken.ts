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

import { createHmac, timingSafeEqual } from 'node:crypto';

export const PUBLIC_CALENDAR_FEED_PATH = '/v1/public-calendar-feeds';
const NATIVE_TOKEN_PATH_PATTERN = /^\/\.token\/v1\/[A-Za-z0-9_-]{44}\/$/u;
const SCOPE_HASH_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const MAX_ENVELOPE_LENGTH = 1024;
const MAX_PAYLOAD_LENGTH = 768;

export type PublicCalendarFeedEnvelope = Readonly<{
  tokenPath: string;
  scopeHash: string;
}>;

/** Derive a stable, non-reversible marker for one authorized publication scope. */
export function hashPublicCalendarFeedScope(
  signingKey: Uint8Array,
  scope: string,
): string {
  return createHmac('sha256', signingKey)
    .update('matrix-calendar-widget/public-calendar-feed/scope/v1\0')
    .update(scope)
    .digest('base64url');
}

/** Create a signed URL capability over an exact native read-only token path. */
export function signPublicCalendarFeedEnvelope(
  tokenPath: string,
  scopeHash: string,
  signingKey: Uint8Array,
): string {
  if (
    !NATIVE_TOKEN_PATH_PATTERN.test(tokenPath) ||
    !SCOPE_HASH_PATTERN.test(scopeHash) ||
    signingKey.byteLength < 32
  ) {
    throw new Error('Public calendar feed envelope inputs are invalid');
  }

  const payload = Buffer.from(
    JSON.stringify({ v: 1, tokenPath, scopeHash }),
    'utf8',
  ).toString('base64url');
  const signature = createHmac('sha256', signingKey)
    .update(payload)
    .digest('base64url');
  return `${payload}.${signature}`;
}

/** Reject malformed, unsigned, tampered, or non-canonical feed capabilities. */
export function verifyPublicCalendarFeedEnvelope(
  value: string,
  signingKey: Uint8Array | undefined,
): PublicCalendarFeedEnvelope | undefined {
  if (
    !signingKey ||
    signingKey.byteLength < 32 ||
    value.length < 1 ||
    value.length > MAX_ENVELOPE_LENGTH
  ) {
    return undefined;
  }

  const separator = value.indexOf('.');
  if (
    separator < 1 ||
    separator !== value.lastIndexOf('.') ||
    separator > MAX_PAYLOAD_LENGTH
  ) {
    return undefined;
  }

  const payload = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  if (
    !/^[A-Za-z0-9_-]+$/u.test(payload) ||
    !SIGNATURE_PATTERN.test(signature)
  ) {
    return undefined;
  }

  let payloadBytes: Buffer;
  let suppliedSignature: Buffer;
  try {
    payloadBytes = Buffer.from(payload, 'base64url');
    suppliedSignature = Buffer.from(signature, 'base64url');
  } catch {
    return undefined;
  }
  if (
    payloadBytes.toString('base64url') !== payload ||
    suppliedSignature.toString('base64url') !== signature
  ) {
    return undefined;
  }

  const expectedSignature = createHmac('sha256', signingKey)
    .update(payload)
    .digest();
  if (
    suppliedSignature.byteLength !== expectedSignature.byteLength ||
    !timingSafeEqual(suppliedSignature, expectedSignature)
  ) {
    return undefined;
  }

  let json: string;
  try {
    json = new TextDecoder('utf-8', { fatal: true }).decode(payloadBytes);
  } catch {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return undefined;
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    Object.getPrototypeOf(parsed) !== Object.prototype
  ) {
    return undefined;
  }

  const record = parsed as Record<string, unknown>;
  const keys = Reflect.ownKeys(record);
  if (
    keys.length !== 3 ||
    !keys.includes('v') ||
    !keys.includes('tokenPath') ||
    !keys.includes('scopeHash') ||
    record.v !== 1 ||
    typeof record.tokenPath !== 'string' ||
    !NATIVE_TOKEN_PATH_PATTERN.test(record.tokenPath) ||
    typeof record.scopeHash !== 'string' ||
    !SCOPE_HASH_PATTERN.test(record.scopeHash) ||
    JSON.stringify({
      v: 1,
      tokenPath: record.tokenPath,
      scopeHash: record.scopeHash,
    }) !== json
  ) {
    return undefined;
  }

  return { tokenPath: record.tokenPath, scopeHash: record.scopeHash };
}

export function publicCalendarFeedUrl(
  publicOrigin: string,
  envelope: string,
): string {
  return new URL(
    `${PUBLIC_CALENDAR_FEED_PATH}/${envelope}`,
    `${publicOrigin.replace(/\/$/u, '')}/`,
  ).toString();
}
