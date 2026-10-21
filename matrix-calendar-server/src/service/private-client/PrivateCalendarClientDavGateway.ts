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
import type { IAppConfiguration } from '../../IAppConfiguration';
import { assertVeventOnlyCalendar } from '../public-feed/PublicCalendarFeedIcs';
import { PRIVATE_CALENDAR_CLIENT_APP_ID_PATTERN } from './PrivateCalendarClientCredentials';
import {
  PrivateCalendarClientDavMethod,
  PrivateCalendarClientDavScope,
  PrivateCalendarClientPolicy,
} from './PrivateCalendarClientPolicy';

const MAX_REQUEST_BODY_BYTES = 4 * 1024 * 1024;
const MAX_RESPONSE_BODY_BYTES = 16 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 5_000;
const APP_ID_PREFIX = 'mcwpc~';
const DAV_METHODS = new Set<PrivateCalendarClientDavMethod>([
  'OPTIONS',
  'PROPFIND',
  'REPORT',
  'GET',
  'HEAD',
  'PUT',
  'DELETE',
]);

type PrivateDavTarget = Readonly<{
  appId: string;
  path: string;
  scope: PrivateCalendarClientDavScope;
}>;

type ReadBodyResult =
  | Readonly<{ kind: 'ok'; bytes: Buffer }>
  | Readonly<{ kind: 'too-large' }>
  | Readonly<{ kind: 'timeout' }>
  | Readonly<{ kind: 'failed' }>;

/** Narrow same-origin CalDAV proxy for the reserved private-client namespace. */
export class PrivateCalendarClientDavGateway {
  constructor(
    private readonly appConfig: IAppConfiguration,
    private readonly policy: PrivateCalendarClientPolicy,
    private readonly fetchImpl: typeof fetch = globalThis.fetch.bind(
      globalThis,
    ),
  ) {}

  use(request: Request, response: Response, next: NextFunction): void {
    const rawTarget = request.originalUrl ?? request.url ?? '';
    if (!isReservedPrivateClientTarget(rawTarget)) {
      next();
      return;
    }

    void this.handle(request, response, rawTarget).catch(() => {
      if (!response.headersSent) this.respondEmpty(response, 502);
    });
  }

  private async handle(
    request: Request,
    response: Response,
    rawTarget: string,
  ): Promise<void> {
    const target = parseDavTarget(rawTarget);
    const method = request.method.toUpperCase();
    const radicaleBase = parseRadicaleBaseUrl(this.appConfig.radicale_url);
    if (!target) {
      this.respondEmpty(response, 404);
      return;
    }
    if (!DAV_METHODS.has(method as PrivateCalendarClientDavMethod)) {
      this.respondEmpty(response, 405);
      return;
    }
    if (
      [
        'authorization',
        'content-length',
        'content-type',
        'depth',
        'if-match',
        'if-none-match',
      ].some((name) => hasDuplicateHeader(request, name))
    ) {
      this.respondEmpty(response, 400);
      return;
    }
    if (
      this.appConfig.private_calendar_clients_enabled !== true ||
      !this.appConfig.private_calendar_client_origin ||
      !radicaleBase
    ) {
      this.respondEmpty(response, 404);
      return;
    }

    const davMethod = method as PrivateCalendarClientDavMethod;
    if (!isMethodPathAllowed(davMethod, target, request)) {
      this.respondEmpty(response, 405);
      return;
    }

    const authorization = readSingleHeader(request, 'authorization');
    const credential = parseBasicCredential(authorization, target.appId);
    if (
      !credential ||
      !(await this.policy.authenticate(target.appId, credential))
    ) {
      this.requireBasic(response);
      return;
    }
    if (
      !(await this.policy.authorizeDavRequest(
        target.appId,
        davMethod,
        target.scope,
      ))
    ) {
      this.respondEmpty(response, 403);
      return;
    }

    const incomingBody = await this.readRequestBody(request, davMethod);
    if (incomingBody.kind === 'too-large') {
      this.respondEmpty(response, 413);
      return;
    }
    if (incomingBody.kind === 'timeout') {
      this.respondEmpty(response, 408);
      return;
    }
    if (incomingBody.kind !== 'ok') {
      this.respondEmpty(response, 400);
      return;
    }
    if (
      ['GET', 'HEAD', 'DELETE', 'OPTIONS'].includes(davMethod) &&
      incomingBody.bytes.byteLength > 0
    ) {
      this.respondEmpty(response, 400);
      return;
    }

    const upstreamUrl = new URL(rawTarget, radicaleBase);
    const upstreamHeaders = copyRequestHeaders(request);
    if (davMethod === 'PUT') {
      if (!isCalendarContentType(upstreamHeaders.get('Content-Type'))) {
        this.respondEmpty(response, 415);
        return;
      }
      try {
        assertVeventOnlyCalendar(incomingBody.bytes);
      } catch {
        this.respondEmpty(response, 400);
        return;
      }
    }

    if (davMethod === 'PUT' || davMethod === 'DELETE') {
      const safe = await this.checkExistingResource(
        upstreamUrl,
        authorization ?? '',
      );
      if (safe.kind === 'unsupported') {
        this.respondEmpty(response, 409);
        return;
      }
      if (safe.kind === 'missing') {
        if (davMethod === 'DELETE') {
          this.respondEmpty(response, 404);
          return;
        }
        if (
          !upstreamHeaders.has('If-Match') &&
          !upstreamHeaders.has('If-None-Match')
        ) {
          upstreamHeaders.set('If-None-Match', '*');
        }
      } else if (safe.kind === 'safe') {
        if (
          !upstreamHeaders.has('If-Match') &&
          !upstreamHeaders.has('If-None-Match')
        ) {
          upstreamHeaders.set('If-Match', safe.etag);
        }
      } else {
        this.respondEmpty(response, 502);
        return;
      }
    }

    const upstream = await this.fetchUpstream(
      upstreamUrl,
      davMethod,
      upstreamHeaders,
      incomingBody.bytes,
    );
    if (!upstream) {
      this.respondEmpty(response, 502);
      return;
    }
    this.respondUpstream(response, upstream);
  }

  private async readRequestBody(
    request: Request,
    method: PrivateCalendarClientDavMethod,
  ): Promise<ReadBodyResult> {
    const maxBytes = method === 'PUT' ? MAX_REQUEST_BODY_BYTES : 1024 * 1024;
    const lengthHeader = readSingleHeader(request, 'content-length');
    if (lengthHeader !== undefined) {
      if (!/^(?:0|[1-9][0-9]{0,8})$/u.test(lengthHeader)) {
        request.resume();
        return { kind: 'failed' };
      }
      if (Number(lengthHeader) > maxBytes) {
        request.resume();
        return { kind: 'too-large' };
      }
    }

    return new Promise((resolve) => {
      const chunks: Buffer[] = [];
      let size = 0;
      let finished = false;
      const timeout = setTimeout(
        () => finish({ kind: 'timeout' }),
        UPSTREAM_TIMEOUT_MS,
      );
      request.setTimeout(UPSTREAM_TIMEOUT_MS, () =>
        finish({ kind: 'timeout' }),
      );
      const finish = (result: ReadBodyResult) => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        request.setTimeout(0);
        resolve(result);
      };
      request.on('data', (chunk: Buffer | string) => {
        if (finished) return;
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += bytes.byteLength;
        if (size > maxBytes) {
          request.resume();
          finish({ kind: 'too-large' });
          return;
        }
        chunks.push(bytes);
      });
      request.once('end', () => {
        finish({ kind: 'ok', bytes: Buffer.concat(chunks, size) });
      });
      request.once('error', () => finish({ kind: 'failed' }));
      request.once('aborted', () => finish({ kind: 'failed' }));
    });
  }

  private async checkExistingResource(
    url: URL,
    authorization: string,
  ): Promise<
    | Readonly<{ kind: 'safe'; etag: string }>
    | Readonly<{ kind: 'missing' }>
    | Readonly<{ kind: 'unsupported' }>
    | Readonly<{ kind: 'failed' }>
  > {
    const headers = new Headers({ Authorization: authorization });
    const exchange = await this.request(url, 'GET', headers);
    if (!exchange) return { kind: 'failed' };
    try {
      const { response } = exchange;
      if (response.status === 404) {
        await cancelBody(response);
        return { kind: 'missing' };
      }
      if (response.status !== 200) {
        await cancelBody(response);
        return { kind: 'failed' };
      }
      const bytes = await readBoundedResponse(response, MAX_REQUEST_BODY_BYTES);
      const etag = response.headers.get('ETag');
      if (!bytes || !etag || etag.trim() !== etag || etag.includes(',')) {
        return { kind: 'failed' };
      }
      try {
        assertVeventOnlyCalendar(bytes);
      } catch {
        return { kind: 'unsupported' };
      }
      return { kind: 'safe', etag };
    } finally {
      exchange.finish();
    }
  }

  private async fetchUpstream(
    url: URL,
    method: PrivateCalendarClientDavMethod,
    headers: Headers,
    body: Buffer,
  ): Promise<UpstreamResponse | undefined> {
    const exchange = await this.request(
      url,
      method,
      headers,
      ['PUT', 'REPORT', 'PROPFIND'].includes(method) ? body : undefined,
    );
    if (!exchange) {
      return undefined;
    }
    try {
      const { response } = exchange;
      if (response.status >= 300 && response.status < 400) {
        await cancelBody(response);
        return undefined;
      }
      const bytes =
        method === 'HEAD' || response.status === 204 || response.status === 304
          ? Buffer.alloc(0)
          : await readBoundedResponse(response, MAX_RESPONSE_BODY_BYTES);
      if (!bytes) return undefined;
      const headersOut = new Headers();
      for (const name of [
        'Allow',
        'DAV',
        'ETag',
        'Last-Modified',
        'Content-Type',
        'WWW-Authenticate',
        'MS-Author-Via',
        'Preference-Applied',
      ]) {
        const value = response.headers.get(name);
        if (value !== null) headersOut.set(name, value);
      }
      return { status: response.status, headers: headersOut, bytes };
    } finally {
      exchange.finish();
    }
  }

  private async request(
    url: URL,
    method: string,
    headers: Headers,
    body?: Buffer,
  ): Promise<UpstreamExchange | undefined> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    try {
      const response = await this.fetchImpl(url, {
        method,
        headers,
        ...(body && body.byteLength > 0 ? { body } : {}),
        redirect: 'manual',
        signal: controller.signal,
      });
      if (response.status >= 300 && response.status < 400) {
        await cancelBody(response);
      }
      return {
        response,
        finish: () => clearTimeout(timeout),
      };
    } catch {
      clearTimeout(timeout);
      return undefined;
    }
  }

  private respondUpstream(
    response: Response,
    upstream: UpstreamResponse,
  ): void {
    response.status(upstream.status);
    for (const [name, value] of upstream.headers)
      response.setHeader(name, value);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Pragma', 'no-cache');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Length', String(upstream.bytes.byteLength));
    response.end(upstream.bytes);
  }

  private requireBasic(response: Response): void {
    response.setHeader('WWW-Authenticate', 'Basic realm="Matrix Calendar"');
    this.respondEmpty(response, 401);
  }

  private respondEmpty(response: Response, status: number): void {
    response
      .status(status)
      .setHeader('Cache-Control', 'no-store')
      .setHeader('Pragma', 'no-cache')
      .setHeader('X-Content-Type-Options', 'nosniff')
      .end();
  }
}

type UpstreamResponse = Readonly<{
  status: number;
  headers: Headers;
  bytes: Buffer;
}>;

type UpstreamExchange = Readonly<{
  response: globalThis.Response;
  finish: () => void;
}>;

function parseRadicaleBaseUrl(value: string | undefined): URL | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    ) {
      return undefined;
    }
    return new URL(`${url.origin}/`);
  } catch {
    return undefined;
  }
}

function isReservedPrivateClientTarget(rawTarget: string): boolean {
  if (!rawTarget.startsWith('/')) return false;
  const rawSegment = rawTarget.slice(1).split(/[/?#]/u, 1)[0];
  if (rawSegment.startsWith(APP_ID_PREFIX)) return true;
  try {
    // Malformed escapes after a reserved prefix still belong to this route and
    // are rejected by parseDavTarget instead of falling through to Matrix auth.
    const tolerant = rawSegment.replace(/%(?![a-f0-9]{2})/giu, '%25');
    return decodeURIComponent(tolerant).startsWith(APP_ID_PREFIX);
  } catch {
    return false;
  }
}

function parseDavTarget(rawTarget: string): PrivateDavTarget | undefined {
  if (
    !rawTarget.startsWith('/') ||
    rawTarget.includes('?') ||
    rawTarget.includes('#') ||
    rawTarget.includes('\\') ||
    rawTarget.includes('//') ||
    /%(?:2f|5c|00|25)/iu.test(rawTarget)
  ) {
    return undefined;
  }
  const segments = rawTarget.slice(1).split('/');
  const appId = segments[0];
  if (
    !PRIVATE_CALENDAR_CLIENT_APP_ID_PATTERN.test(appId) ||
    segments.some((segment) => segment === '.' || segment === '..')
  ) {
    return undefined;
  }
  if (segments.length === 2 && segments[1] === '') {
    return { appId, path: rawTarget, scope: 'principal' };
  }
  if (
    segments.length === 3 &&
    segments[1] === 'calendar' &&
    segments[2] === ''
  ) {
    return { appId, path: rawTarget, scope: 'collection' };
  }
  if (
    segments.length === 3 &&
    segments[1] === 'calendar' &&
    segments[2] !== ''
  ) {
    try {
      const decoded = decodeURIComponent(segments[2]);
      if (
        !decoded ||
        decoded === '.' ||
        decoded === '..' ||
        decoded.includes('/') ||
        decoded.includes('\\') ||
        decoded.includes('%') ||
        // Intentional validation of raw control characters in resource names.
        // eslint-disable-next-line no-control-regex
        /[\u0000-\u001f\u007f]/u.test(decoded)
      ) {
        return undefined;
      }
    } catch {
      return undefined;
    }
    return { appId, path: rawTarget, scope: 'resource' };
  }
  return undefined;
}

function isMethodPathAllowed(
  method: PrivateCalendarClientDavMethod,
  target: PrivateDavTarget,
  request: Request,
): boolean {
  if (method === 'OPTIONS') return target.scope !== 'resource';
  if (method === 'PROPFIND') {
    if (target.scope === 'resource') return false;
    const depth = readSingleHeader(request, 'depth');
    return depth === '0' || depth === '1';
  }
  if (method === 'REPORT') return target.scope !== 'principal';
  if (method === 'GET' || method === 'HEAD')
    return target.scope !== 'principal';
  return (
    (method === 'PUT' || method === 'DELETE') && target.scope === 'resource'
  );
}

function parseBasicCredential(
  authorization: string | undefined,
  expectedUsername: string,
): string | undefined {
  if (!authorization?.startsWith('Basic ')) return undefined;
  const encoded = authorization.slice('Basic '.length);
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(encoded)) return undefined;
  let decoded: string;
  try {
    const bytes = Buffer.from(encoded, 'base64');
    if (bytes.toString('base64') !== encoded) return undefined;
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
  const separator = decoded.indexOf(':');
  if (separator < 1 || decoded.indexOf(':', separator + 1) !== -1)
    return undefined;
  const username = decoded.slice(0, separator);
  const password = decoded.slice(separator + 1);
  return username === expectedUsername && password ? password : undefined;
}

function copyRequestHeaders(request: Request): Headers {
  const headers = new Headers();
  for (const name of [
    'accept',
    'authorization',
    'content-type',
    'depth',
    'if-match',
    'if-none-match',
    'if-modified-since',
    'if-unmodified-since',
    'prefer',
    'brief',
  ]) {
    const value = readSingleHeader(request, name);
    if (value !== undefined) headers.set(name, value);
  }
  return headers;
}

function readSingleHeader(request: Request, name: string): string | undefined {
  const matches: string[] = [];
  const rawHeaders = request.rawHeaders ?? [];
  for (let index = 0; index + 1 < rawHeaders.length; index += 2) {
    if (rawHeaders[index].toLowerCase() === name.toLowerCase()) {
      matches.push(rawHeaders[index + 1]);
    }
  }
  if (matches.length > 1) return undefined;
  return matches[0];
}

function hasDuplicateHeader(request: Request, name: string): boolean {
  let matches = 0;
  const rawHeaders = request.rawHeaders ?? [];
  for (let index = 0; index + 1 < rawHeaders.length; index += 2) {
    if (rawHeaders[index].toLowerCase() === name) matches += 1;
  }
  return matches > 1;
}

function isCalendarContentType(value: string | null): boolean {
  return value !== null && /^text\/calendar(?:\s*;|$)/iu.test(value);
}

async function readBoundedResponse(
  response: globalThis.Response,
  maxBytes: number,
): Promise<Buffer | undefined> {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        return undefined;
      }
      chunks.push(value);
    }
  } catch {
    return undefined;
  }
  return Buffer.concat(chunks, size);
}

async function cancelBody(response: globalThis.Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Closing an unread upstream body is best effort.
  }
}
