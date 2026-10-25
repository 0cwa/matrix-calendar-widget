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

import type { CalDavCredentialProvider } from '../../caldav/CalDavCredentialProvider';

export const PUBLIC_CALENDAR_FEED_MAX_BYTES = 16 * 1024 * 1024;
const RADICALE_SHARING_RESPONSE_MAX_BYTES = 1024 * 1024;
const RADICALE_REQUEST_TIMEOUT_MS = 5_000;
const TOKEN_PATH_PATTERN = /^\/\.token\/v1\/[A-Za-z0-9_-]{44}\/$/u;

export type RadicaleNativeTokenShare = Readonly<{
  PathOrToken: string;
  PathMapped: string;
  Permissions: string;
  Conversion: string | null;
  EnabledByOwner: boolean;
  Properties: Readonly<Record<string, string>> | null;
}>;

export class RadicalePublicFeedError extends Error {
  constructor(
    readonly code:
      | 'unauthorized'
      | 'unavailable'
      | 'invalid-response'
      | 'response-too-large'
      | 'redirected'
      | 'not-found',
  ) {
    super('Radicale public feed operation failed');
    this.name = 'RadicalePublicFeedError';
  }
}

export type NativeCalendarFeed = Readonly<{
  bytes: Uint8Array;
  contentType: string;
}>;

export class RadicalePublicFeedClient {
  private readonly baseUrl: URL;
  private readonly fetchImpl: typeof fetch;

  constructor(
    radicaleBaseUrl: string,
    fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {
    this.baseUrl = parseRadicaleBaseUrl(radicaleBaseUrl);
    this.fetchImpl = fetchImpl;
  }

  async listTokenShares(
    collectionPath: string,
    credentialProvider: CalDavCredentialProvider,
  ): Promise<readonly RadicaleNativeTokenShare[]> {
    if (!isCanonicalCollectionPath(collectionPath)) {
      throw new RadicalePublicFeedError('invalid-response');
    }
    const response = await this.requestJson(
      '/.sharing/v1/token/list',
      { PathMapped: collectionPath },
      credentialProvider,
    );
    if (
      isRecord(response) &&
      response.Status === 'not-found' &&
      Array.isArray(response.Content) &&
      response.Content.length === 0
    ) {
      return Object.freeze([]);
    }
    if (
      !isRecord(response) ||
      response.Status !== 'success' ||
      !Array.isArray(response.Content)
    ) {
      throw new RadicalePublicFeedError('invalid-response');
    }

    const parsed = response.Content.map(parseNativeTokenShare);
    if (parsed.some((share) => share === undefined)) {
      throw new RadicalePublicFeedError('invalid-response');
    }
    return parsed as RadicaleNativeTokenShare[];
  }

  async createReadOnlyTokenShare(
    collectionPath: string,
    marker: string,
    credentialProvider: CalDavCredentialProvider,
  ): Promise<string> {
    if (
      !isCanonicalCollectionPath(collectionPath) ||
      !/^Matrix Calendar Widget public feed:[A-Za-z0-9_-]{43}$/u.test(marker)
    ) {
      throw new RadicalePublicFeedError('invalid-response');
    }
    const response = await this.requestJson(
      '/.sharing/v1/token/create',
      {
        PathMapped: collectionPath,
        Permissions: 'r',
        Conversion: 'none',
        Enabled: true,
        Hidden: false,
        Properties: { 'D:displayname': marker },
      },
      credentialProvider,
    );
    if (
      !isRecord(response) ||
      response.Status !== 'success' ||
      typeof response.PathOrToken !== 'string' ||
      !TOKEN_PATH_PATTERN.test(response.PathOrToken)
    ) {
      throw new RadicalePublicFeedError('invalid-response');
    }
    return response.PathOrToken;
  }

  async deleteTokenShare(
    tokenPath: string,
    credentialProvider: CalDavCredentialProvider,
  ): Promise<void> {
    if (!TOKEN_PATH_PATTERN.test(tokenPath)) {
      throw new RadicalePublicFeedError('invalid-response');
    }
    const response = await this.requestJson(
      '/.sharing/v1/token/delete',
      { PathOrToken: tokenPath },
      credentialProvider,
    );
    if (!isRecord(response) || response.Status !== 'success') {
      throw new RadicalePublicFeedError('invalid-response');
    }
  }

  async getNativeCalendarFeed(tokenPath: string): Promise<NativeCalendarFeed> {
    if (!TOKEN_PATH_PATTERN.test(tokenPath)) {
      throw new RadicalePublicFeedError('not-found');
    }
    return this.withTimeout(async (signal) => {
      let response: Response;
      try {
        response = await this.fetchImpl(new URL(tokenPath, this.baseUrl), {
          method: 'GET',
          redirect: 'manual',
          signal,
          headers: { Accept: 'text/calendar' },
        });
      } catch {
        throw new RadicalePublicFeedError('unavailable');
      }

      if (response.status >= 300 && response.status < 400) {
        await cancelResponse(response);
        throw new RadicalePublicFeedError('redirected');
      }
      if (
        response.status === 401 ||
        response.status === 403 ||
        response.status === 404
      ) {
        await cancelResponse(response);
        throw new RadicalePublicFeedError('not-found');
      }
      if (response.status !== 200) {
        await cancelResponse(response);
        throw new RadicalePublicFeedError('unavailable');
      }

      const contentType = response.headers.get('Content-Type') ?? '';
      if (!/^text\/calendar(?:\s*;|$)/iu.test(contentType)) {
        await cancelResponse(response);
        throw new RadicalePublicFeedError('invalid-response');
      }
      const bytes = await readBoundedResponseBytes(
        response,
        PUBLIC_CALENDAR_FEED_MAX_BYTES,
      );
      return { bytes, contentType };
    });
  }

  private async requestJson(
    path: string,
    body: Readonly<Record<string, unknown>>,
    credentialProvider: CalDavCredentialProvider,
  ): Promise<unknown> {
    return this.withTimeout(async (signal) => {
      const credentialHeaders = await credentialProvider.getRequestHeaders();
      const headers = new Headers(credentialHeaders);
      headers.set('Accept', 'application/json');
      headers.set('Content-Type', 'application/json');
      let response: Response;
      try {
        response = await this.fetchImpl(new URL(path, this.baseUrl), {
          method: 'POST',
          redirect: 'manual',
          signal,
          headers,
          body: JSON.stringify(body),
        });
      } catch {
        throw new RadicalePublicFeedError('unavailable');
      }

      if (response.status >= 300 && response.status < 400) {
        await cancelResponse(response);
        throw new RadicalePublicFeedError('redirected');
      }
      if (response.status === 401 || response.status === 403) {
        await cancelResponse(response);
        throw new RadicalePublicFeedError('unauthorized');
      }
      if (!response.ok) {
        await cancelResponse(response);
        throw new RadicalePublicFeedError('unavailable');
      }

      const bytes = await readBoundedResponseBytes(
        response,
        RADICALE_SHARING_RESPONSE_MAX_BYTES,
      );
      try {
        return JSON.parse(
          new TextDecoder('utf-8', { fatal: true }).decode(bytes),
        );
      } catch {
        throw new RadicalePublicFeedError('invalid-response');
      }
    });
  }

  private async withTimeout<T>(
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      RADICALE_REQUEST_TIMEOUT_MS,
    );
    try {
      return await operation(controller.signal);
    } catch (error) {
      if (error instanceof RadicalePublicFeedError) throw error;
      throw new RadicalePublicFeedError('unavailable');
    } finally {
      clearTimeout(timeout);
    }
  }
}

export async function readBoundedResponseBytes(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  const length = response.headers.get('Content-Length');
  if (length && /^\d+$/u.test(length) && BigInt(length) > BigInt(maxBytes)) {
    await cancelResponse(response);
    throw new RadicalePublicFeedError('response-too-large');
  }

  const body = response.body;
  if (!body) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const append = (value: Uint8Array): void => {
    total += value.byteLength;
    if (total > maxBytes) {
      throw new RadicalePublicFeedError('response-too-large');
    }
    chunks.push(value);
  };

  if (body instanceof Uint8Array) {
    append(body);
  } else if (typeof body.getReader === 'function') {
    const reader = body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        append(value);
      }
    } catch (error) {
      await reader.cancel().catch(() => undefined);
      if (error instanceof RadicalePublicFeedError) throw error;
      throw new RadicalePublicFeedError('unavailable');
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // A failed stream may already have released its reader.
      }
    }
  } else {
    try {
      for await (const value of body as unknown as AsyncIterable<Uint8Array>) {
        append(value);
      }
    } catch (error) {
      if (error instanceof RadicalePublicFeedError) throw error;
      throw new RadicalePublicFeedError('unavailable');
    }
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function parseRadicaleBaseUrl(value: string): URL {
  try {
    const base = new URL(value);
    if (
      !['http:', 'https:'].includes(base.protocol) ||
      base.username ||
      base.password ||
      base.search ||
      base.hash ||
      base.pathname !== '/'
    ) {
      throw new Error();
    }
    return base;
  } catch {
    throw new RadicalePublicFeedError('unavailable');
  }
}

function isCanonicalCollectionPath(value: string): boolean {
  return (
    value.startsWith('/') &&
    value.endsWith('/') &&
    value.length <= 2048 &&
    !value.includes('?') &&
    !value.includes('#') &&
    !value.includes('\\') &&
    !/%2f|%5c|%00/iu.test(value)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function parseNativeTokenShare(
  value: unknown,
): RadicaleNativeTokenShare | undefined {
  if (!isRecord(value)) return undefined;
  const properties = value.Properties;
  let parsedProperties: Readonly<Record<string, string>> | null = null;
  if (properties === null || properties === undefined) {
    parsedProperties = null;
  } else if (isRecord(properties)) {
    const entries = Object.entries(properties);
    if (
      entries.some(([, propertyValue]) => typeof propertyValue !== 'string')
    ) {
      return undefined;
    }
    parsedProperties = Object.fromEntries(entries) as Record<string, string>;
  } else {
    return undefined;
  }

  if (
    typeof value.PathOrToken !== 'string' ||
    !TOKEN_PATH_PATTERN.test(value.PathOrToken) ||
    typeof value.PathMapped !== 'string' ||
    typeof value.Permissions !== 'string' ||
    typeof value.EnabledByOwner !== 'boolean' ||
    (typeof value.Conversion !== 'string' && value.Conversion !== null)
  ) {
    return undefined;
  }

  return {
    PathOrToken: value.PathOrToken,
    PathMapped: value.PathMapped,
    Permissions: value.Permissions,
    Conversion: value.Conversion,
    EnabledByOwner: value.EnabledByOwner,
    Properties: parsedProperties,
  };
}

async function cancelResponse(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Response cleanup must not replace the fixed upstream error.
  }
}
