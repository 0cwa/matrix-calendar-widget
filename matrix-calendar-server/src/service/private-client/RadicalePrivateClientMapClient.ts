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

import { CalDavCredentialProvider } from '../../caldav/CalDavCredentialProvider';

const MAX_RESPONSE_BYTES = 1024 * 1024;
const REQUEST_TIMEOUT_MS = 5_000;
const APP_ID_PATTERN = /^mcwpc~[a-f0-9]{48}$/u;

export type RadicalePrivateClientMapRecord = Readonly<{
  PathOrToken: string;
  PathMapped: string;
  Owner: string;
  User: string;
  Permissions: string;
  Conversion: string | null;
  EnabledByOwner: boolean;
  EnabledByUser: boolean;
  HiddenByOwner: boolean;
  HiddenByUser: boolean;
}>;

export type PrivateClientMapExpectation = 'pending' | 'accepted' | 'cleanup';

export class RadicalePrivateClientMapError extends Error {
  constructor(
    readonly code:
      | 'unauthorized'
      | 'unavailable'
      | 'invalid-response'
      | 'redirected'
      | 'conflict',
  ) {
    super('Radicale private calendar map operation failed');
    this.name = 'RadicalePrivateClientMapError';
  }
}

/** Server-only owner-authenticated Radicale map administration. */
export class RadicalePrivateClientMapClient {
  private readonly baseUrl: URL;

  constructor(
    radicaleBaseUrl: string,
    private readonly fetchImpl: typeof fetch = globalThis.fetch.bind(
      globalThis,
    ),
  ) {
    this.baseUrl = parseBaseUrl(radicaleBaseUrl);
  }

  async listForCollection(
    canonicalPath: string,
    ownerCredential: CalDavCredentialProvider,
  ): Promise<readonly RadicalePrivateClientMapRecord[]> {
    assertCanonicalCollectionPath(canonicalPath);
    const response = await this.requestJson(
      '/.sharing/v1/map/list',
      { PathMapped: canonicalPath },
      ownerCredential,
      true,
    );
    if (
      response.Status === 'not-found' &&
      (response.Content === undefined ||
        (Array.isArray(response.Content) && response.Content.length === 0))
    ) {
      return Object.freeze([]);
    }
    if (
      response.Status !== 'success' ||
      !Array.isArray(response.Content) ||
      response.Content.length > 10_000
    ) {
      throw new RadicalePrivateClientMapError('invalid-response');
    }
    const records = response.Content.map(parseMapRecord);
    if (records.some((record) => record === undefined)) {
      throw new RadicalePrivateClientMapError('invalid-response');
    }
    return Object.freeze(records as RadicalePrivateClientMapRecord[]);
  }

  async createForClient(
    canonicalPath: string,
    appId: string,
    ownerCredential: CalDavCredentialProvider,
  ): Promise<void> {
    assertCanonicalCollectionPath(canonicalPath);
    const alias = clientAlias(appId);
    const response = await this.requestJson(
      '/.sharing/v1/map/create',
      {
        PathMapped: canonicalPath,
        PathOrToken: alias,
        User: appId,
        Permissions: 'rw',
        Conversion: 'none',
        Enabled: true,
        Hidden: false,
        Properties: {},
      },
      ownerCredential,
    );
    if (response.Status === 'conflict') {
      throw new RadicalePrivateClientMapError('conflict');
    }
    if (response.Status !== 'success') {
      throw new RadicalePrivateClientMapError('invalid-response');
    }
  }

  async acceptForClient(
    appId: string,
    clientCredential: CalDavCredentialProvider,
  ): Promise<void> {
    const alias = clientAlias(appId);
    for (const action of ['enable', 'unhide'] as const) {
      const response = await this.requestJson(
        `/.sharing/v1/map/${action}`,
        { PathOrToken: alias },
        clientCredential,
      );
      if (response.Status !== 'success') {
        throw new RadicalePrivateClientMapError('invalid-response');
      }
    }
  }

  async deleteExact(
    record: RadicalePrivateClientMapRecord,
    canonicalPath: string,
    appId: string,
    nativeOwner: string,
    ownerCredential: CalDavCredentialProvider,
  ): Promise<void> {
    assertCanonicalCollectionPath(canonicalPath);
    if (!isExactMap(record, canonicalPath, appId, nativeOwner, 'cleanup')) {
      throw new RadicalePrivateClientMapError('invalid-response');
    }
    const response = await this.requestJson(
      '/.sharing/v1/map/delete',
      { PathOrToken: record.PathOrToken },
      ownerCredential,
    );
    if (response.Status !== 'success' && response.Status !== 'not-found') {
      throw new RadicalePrivateClientMapError('invalid-response');
    }
    const remaining = await this.listForCollection(
      canonicalPath,
      ownerCredential,
    );
    if (
      remaining.some(
        (candidate) => candidate.PathOrToken === record.PathOrToken,
      )
    ) {
      throw new RadicalePrivateClientMapError('invalid-response');
    }
  }

  private async requestJson(
    path: string,
    body: Readonly<Record<string, unknown>>,
    credentialProvider: CalDavCredentialProvider,
    allowNotFound = false,
  ): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      let response: Response;
      try {
        const credentialHeaders = await credentialProvider.getRequestHeaders();
        const headers = new Headers(credentialHeaders);
        headers.set('Accept', 'application/json');
        headers.set('Content-Type', 'application/json');
        response = await this.fetchImpl(new URL(path, this.baseUrl), {
          method: 'POST',
          redirect: 'manual',
          signal: controller.signal,
          headers,
          body: JSON.stringify(body),
        });
      } catch {
        throw new RadicalePrivateClientMapError('unavailable');
      }

      if (response.status >= 300 && response.status < 400) {
        await cancelResponse(response);
        throw new RadicalePrivateClientMapError('redirected');
      }
      if (response.status === 401 || response.status === 403) {
        await cancelResponse(response);
        throw new RadicalePrivateClientMapError('unauthorized');
      }
      if (response.status === 404 && allowNotFound) {
        await cancelResponse(response);
        return { Status: 'not-found' };
      }
      if (response.status === 409) {
        await cancelResponse(response);
        return { Status: 'conflict' };
      }
      if (response.status !== 200) {
        await cancelResponse(response);
        throw new RadicalePrivateClientMapError('unavailable');
      }
      const contentType = response.headers.get('Content-Type') ?? '';
      if (!/^application\/json(?:\s*;|$)/iu.test(contentType)) {
        await cancelResponse(response);
        throw new RadicalePrivateClientMapError('invalid-response');
      }
      const bytes = await readBoundedBytes(response, MAX_RESPONSE_BYTES);
      let parsed: unknown;
      try {
        parsed = JSON.parse(
          new TextDecoder('utf-8', { fatal: true }).decode(bytes),
        );
      } catch {
        throw new RadicalePrivateClientMapError('invalid-response');
      }
      if (!isRecord(parsed)) {
        throw new RadicalePrivateClientMapError('invalid-response');
      }
      return parsed;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function clientAlias(appId: string): string {
  if (!APP_ID_PATTERN.test(appId)) {
    throw new RadicalePrivateClientMapError('invalid-response');
  }
  return `/${appId}/calendar/`;
}

export function isExactMap(
  record: RadicalePrivateClientMapRecord,
  canonicalPath: string,
  appId: string,
  nativeOwner: string,
  expectation: PrivateClientMapExpectation,
): boolean {
  const exactIdentity =
    record.PathOrToken === clientAlias(appId) &&
    record.PathMapped === canonicalPath &&
    record.Owner === nativeOwner &&
    record.User === appId &&
    record.Permissions === 'rw' &&
    record.Conversion === 'none';
  if (!exactIdentity) return false;
  if (expectation === 'cleanup') return true;
  if (expectation === 'pending') {
    return (
      record.EnabledByOwner === true &&
      record.HiddenByOwner === false &&
      record.EnabledByUser === false &&
      record.HiddenByUser === true
    );
  }
  return (
    record.EnabledByOwner === true &&
    record.HiddenByOwner === false &&
    record.EnabledByUser === true &&
    record.HiddenByUser === false
  );
}

function parseMapRecord(
  value: unknown,
): RadicalePrivateClientMapRecord | undefined {
  if (
    !isRecord(value) ||
    typeof value.PathOrToken !== 'string' ||
    typeof value.PathMapped !== 'string' ||
    typeof value.Owner !== 'string' ||
    typeof value.User !== 'string' ||
    typeof value.Permissions !== 'string' ||
    (value.Conversion !== null && typeof value.Conversion !== 'string') ||
    typeof value.EnabledByOwner !== 'boolean' ||
    typeof value.EnabledByUser !== 'boolean' ||
    typeof value.HiddenByOwner !== 'boolean' ||
    typeof value.HiddenByUser !== 'boolean'
  ) {
    return undefined;
  }
  return Object.freeze({
    PathOrToken: value.PathOrToken,
    PathMapped: value.PathMapped,
    Owner: value.Owner,
    User: value.User,
    Permissions: value.Permissions,
    Conversion: value.Conversion,
    EnabledByOwner: value.EnabledByOwner,
    EnabledByUser: value.EnabledByUser,
    HiddenByOwner: value.HiddenByOwner,
    HiddenByUser: value.HiddenByUser,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseBaseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new RadicalePrivateClientMapError('invalid-response');
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new RadicalePrivateClientMapError('invalid-response');
  }
  return new URL(url.origin + '/');
}

function assertCanonicalCollectionPath(path: string): void {
  if (
    !path.startsWith('/') ||
    !path.endsWith('/') ||
    path.includes('?') ||
    path.includes('#') ||
    path.includes('\\') ||
    /%(?![0-9a-f]{2})|%(?:2f|5c|00)/iu.test(path)
  ) {
    throw new RadicalePrivateClientMapError('invalid-response');
  }
  const segments = path.slice(1, -1).split('/');
  if (
    segments.length !== 2 ||
    segments.some((segment) => {
      try {
        const decoded = decodeURIComponent(segment);
        return (
          !decoded ||
          decoded === '.' ||
          decoded === '..' ||
          decoded.includes('/') ||
          decoded.includes('\\') ||
          decoded.includes('%') ||
          // Intentional validation of raw control characters in path segments.
          // eslint-disable-next-line no-control-regex
          /[\u0000-\u001f\u007f]/u.test(decoded)
        );
      } catch {
        return true;
      }
    })
  ) {
    throw new RadicalePrivateClientMapError('invalid-response');
  }
}

async function readBoundedBytes(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  const contentLength = response.headers.get('Content-Length');
  if (contentLength && /^[0-9]+$/u.test(contentLength)) {
    const parsed = Number(contentLength);
    if (parsed > maxBytes) {
      await cancelResponse(response);
      throw new RadicalePrivateClientMapError('invalid-response');
    }
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new RadicalePrivateClientMapError('invalid-response');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function cancelResponse(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Closing a rejected response is best effort.
  }
}
