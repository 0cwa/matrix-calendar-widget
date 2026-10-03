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

import { CalendarTimeRange } from '@matrix-calendar-widget/calendar';
import { XMLParser } from 'fast-xml-parser';
import { CalDavCredentialProvider } from './CalDavCredentialProvider';
import { DEFAULT_CALDAV_EVENT_RESPONSE_MAX_BYTES } from './CalDavTransportLimits';

export type CalDavEventResource = {
  href: string;
  etag: string;
  icalendar: string;
};

export type CalDavEventWriteResult = {
  href: string;
  etag?: string;
};

export type CalDavEventTransportErrorCode =
  | 'etag-conflict'
  | 'invalid-uid'
  | 'invalid-range'
  | 'invalid-response'
  | 'redirected'
  | 'response-read-failed'
  | 'response-too-large'
  | 'request-failed';

export type CalDavEventTransportMethod = 'DELETE' | 'GET' | 'PUT' | 'REPORT';

export class CalDavEventTransportError extends Error {
  constructor(
    public readonly code: CalDavEventTransportErrorCode,
    message: string,
    public readonly method?: CalDavEventTransportMethod,
    public readonly status?: number,
    public readonly url?: string,
  ) {
    super(message);
    this.name = 'CalDavEventTransportError';
  }
}

type DavNode = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
});

// Radicale's pinned release ignores CALDAV:timezone. Fetch a conservative
// candidate window for supported IANA offsets, then let the widget interpret
// floating values in the viewer's timezone and clip the exact interval.
const candidateRangeOverfetchMs = 32 * 60 * 60 * 1000;

type AsyncResponseBody = AsyncIterable<Uint8Array | string> & {
  cancel?: () => Promise<void>;
  destroy?: () => unknown;
  getReader?: () => ReadableStreamDefaultReader<Uint8Array>;
};

export class CalDavEventClient {
  constructor(
    private readonly credentialProvider: CalDavCredentialProvider,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly maxResponseBytes = DEFAULT_CALDAV_EVENT_RESPONSE_MAX_BYTES,
  ) {}

  async listEvents(
    calendarUrl: string,
    range: CalendarTimeRange,
    signal?: AbortSignal,
  ): Promise<CalDavEventResource[]> {
    const url = new URL(calendarUrl).toString();
    const start = parseRangeInstant(range.start, 'start');
    const end = parseRangeInstant(range.end, 'end');

    if (start.getTime() >= end.getTime()) {
      throw new CalDavEventTransportError(
        'invalid-range',
        'CalDAV event query range start must be before end',
      );
    }

    const candidateStart = new Date(
      start.getTime() - candidateRangeOverfetchMs,
    );
    const candidateEnd = new Date(end.getTime() + candidateRangeOverfetchMs);

    const headers = await this.requestHeaders(signal);
    headers.set('Content-Type', 'application/xml; charset=utf-8');
    headers.set('Depth', '1');

    const response = await this.sendRequest(url, 'REPORT', {
      headers,
      body: calendarQueryBody(candidateStart, candidateEnd),
      signal,
    });

    if (!response.ok) {
      await cancelResponseBody(response);
      throw requestFailure('REPORT', url, response.status);
    }

    const responseText = await readResponseText(
      response,
      this.maxResponseBytes,
      'REPORT',
      signal,
    );
    assertSafeXmlDocument(responseText, 'REPORT', response.status);
    const document = asNode(parser.parse(responseText));
    const multistatus = asNode(document?.multistatus);
    const resources: CalDavEventResource[] = [];

    for (const responseValue of asArray(multistatus?.response)) {
      const responseNode = asNode(responseValue);
      if (!responseNode) {
        continue;
      }

      const properties = successfulProperties(responseNode);
      if (Object.keys(properties).length === 0) {
        continue;
      }

      const href = textValue(responseNode.href);
      const etag = textValue(properties.getetag);
      const icalendar = textValue(properties['calendar-data']);

      if (!href || !etag || !icalendar) {
        throw new CalDavEventTransportError(
          'invalid-response',
          'CalDAV calendar-query returned an event without href, ETag, or calendar-data',
          'REPORT',
          response.status,
          url,
        );
      }

      resources.push({
        href: new URL(href, url).toString(),
        etag,
        icalendar,
      });
    }

    return resources;
  }

  /**
   * Find at most two resources in this exact collection whose VEVENT UID is
   * equal to the configured UID. Two results are enough to reject ambiguity;
   * the response byte cap bounds malformed or non-conforming servers too.
   */
  async listEventsByUid(
    calendarUrl: string,
    eventUid: string,
    signal?: AbortSignal,
  ): Promise<CalDavEventResource[]> {
    const collection = normalizeCollectionUrl(calendarUrl);
    if (!isSafeCalendarUid(eventUid)) {
      throw new CalDavEventTransportError(
        'invalid-uid',
        'CalDAV event UID query requires a valid UID',
        'REPORT',
      );
    }

    const headers = await this.requestHeaders(signal);
    headers.set('Content-Type', 'application/xml; charset=utf-8');
    headers.set('Depth', '1');
    const response = await this.sendRequest(collection.toString(), 'REPORT', {
      headers,
      body: calendarUidQueryBody(eventUid),
      signal,
    });

    if (!response.ok) {
      await cancelResponseBody(response);
      throw requestFailure('REPORT', collection.toString(), response.status);
    }

    const responseText = await readResponseText(
      response,
      this.maxResponseBytes,
      'REPORT',
      signal,
    );
    assertSafeXmlDocument(responseText, 'REPORT', response.status);
    const document = asNode(parser.parse(responseText));
    const multistatus = asNode(document?.multistatus);
    const resources: CalDavEventResource[] = [];

    for (const responseValue of asArray(multistatus?.response)) {
      if (resources.length === 2) {
        throw new CalDavEventTransportError(
          'invalid-response',
          'CalDAV UID query returned more than two matching resources',
          'REPORT',
          response.status,
          collection.toString(),
        );
      }
      const responseNode = asNode(responseValue);
      if (!responseNode) continue;

      const properties = successfulProperties(responseNode);
      if (Object.keys(properties).length === 0) continue;

      const hrefValue = textValue(responseNode.href);
      const etag = textValue(properties.getetag);
      const icalendar = textValue(properties['calendar-data']);
      if (!hrefValue || !etag || !icalendar) {
        throw new CalDavEventTransportError(
          'invalid-response',
          'CalDAV UID query returned an event without href, ETag, or calendar-data',
          'REPORT',
          response.status,
          collection.toString(),
        );
      }

      const href = resolveDirectCollectionResource(collection, hrefValue);
      resources.push({ href, etag, icalendar });
    }

    return resources;
  }

  async getEvent(
    resourceUrl: string,
    signal?: AbortSignal,
  ): Promise<CalDavEventResource> {
    const url = new URL(resourceUrl).toString();
    const headers = await this.requestHeaders(signal);
    headers.set('Accept', 'text/calendar');

    const response = await this.sendRequest(url, 'GET', {
      headers,
      signal,
    });

    if (!response.ok) {
      await cancelResponseBody(response);
      throw requestFailure('GET', url, response.status);
    }

    const etag = response.headers.get('ETag')?.trim();
    const icalendar = await readResponseText(
      response,
      this.maxResponseBytes,
      'GET',
      signal,
    );

    if (!etag || !icalendar.trim()) {
      throw new CalDavEventTransportError(
        'invalid-response',
        'CalDAV GET returned an event without ETag or calendar data',
        'GET',
        response.status,
        url,
      );
    }

    return {
      href: url,
      etag,
      icalendar,
    };
  }

  async createEvent(
    resourceUrl: string,
    icalendar: string,
    signal?: AbortSignal,
  ): Promise<CalDavEventWriteResult> {
    return this.putEvent(resourceUrl, icalendar, 'If-None-Match', '*', signal);
  }

  async updateEvent(
    resourceUrl: string,
    etag: string,
    icalendar: string,
    signal?: AbortSignal,
  ): Promise<CalDavEventWriteResult> {
    return this.putEvent(resourceUrl, icalendar, 'If-Match', etag, signal);
  }

  async deleteEvent(
    resourceUrl: string,
    etag: string,
    signal?: AbortSignal,
  ): Promise<CalDavEventWriteResult> {
    const url = new URL(resourceUrl).toString();
    const headers = await this.requestHeaders(signal);
    headers.set('If-Match', etag);

    const response = await this.sendRequest(url, 'DELETE', {
      headers,
      signal,
    });

    await this.assertWriteSuccess('DELETE', url, response);

    return writeResult(url, response);
  }

  private async putEvent(
    resourceUrl: string,
    icalendar: string,
    conditionHeader: 'If-Match' | 'If-None-Match',
    conditionValue: string,
    signal?: AbortSignal,
  ): Promise<CalDavEventWriteResult> {
    const url = new URL(resourceUrl).toString();
    const headers = await this.requestHeaders(signal);
    headers.set('Content-Type', 'text/calendar; charset=utf-8');
    headers.set(conditionHeader, conditionValue);

    const response = await this.sendRequest(url, 'PUT', {
      headers,
      body: icalendar,
      signal,
    });

    await this.assertWriteSuccess('PUT', url, response);

    return writeResult(url, response);
  }

  private async assertWriteSuccess(
    method: 'DELETE' | 'PUT',
    url: string,
    response: Response,
  ): Promise<void> {
    if (response.ok) {
      return;
    }

    await cancelResponseBody(response);
    if (response.status === 409 || response.status === 412) {
      throw new CalDavEventTransportError(
        'etag-conflict',
        `CalDAV ${method} conflicted with the current event resource`,
        method,
        response.status,
        url,
      );
    }

    throw requestFailure(method, url, response.status);
  }

  private async requestHeaders(signal?: AbortSignal): Promise<Headers> {
    throwIfAborted(signal);
    return new Headers(
      await readWithAbort(this.credentialProvider.getRequestHeaders(), signal),
    );
  }

  private async sendRequest(
    url: string,
    method: CalDavEventTransportMethod,
    init: Omit<RequestInit, 'method' | 'redirect'>,
  ): Promise<Response> {
    throwIfAborted(init.signal ?? undefined);
    const response = await this.fetchImpl(url, {
      ...init,
      method,
      redirect: 'manual',
    });

    if (response.status >= 300 && response.status < 400) {
      await cancelResponseBody(response);
      throw new CalDavEventTransportError(
        'redirected',
        'CalDAV event request was redirected',
        method,
        response.status,
      );
    }

    return response;
  }
}

async function readResponseText(
  response: Response,
  maxBytes: number,
  method: 'GET' | 'REPORT',
  signal?: AbortSignal,
): Promise<string> {
  throwIfAborted(signal);
  const contentLength = response.headers.get('Content-Length');
  if (
    contentLength !== null &&
    /^\d+$/.test(contentLength) &&
    BigInt(contentLength) > BigInt(maxBytes)
  ) {
    await cancelResponseBody(response);
    throw responseTooLarge(method, response.status);
  }

  const chunks: Uint8Array[] = [];
  let size = 0;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const rawBody = response.body as unknown;
    if (typeof rawBody === 'string' || rawBody instanceof Uint8Array) {
      const bytes =
        typeof rawBody === 'string'
          ? new TextEncoder().encode(rawBody)
          : rawBody;
      if (bytes.byteLength > maxBytes) {
        throw responseTooLarge(method, response.status);
      }
      return new TextDecoder().decode(bytes);
    }

    const body = rawBody as AsyncResponseBody | null;
    if (!body) {
      return '';
    }

    reader = body.getReader?.();
    const appendChunk = (value: Uint8Array | string): void => {
      const chunk =
        typeof value === 'string' ? new TextEncoder().encode(value) : value;
      size += chunk.byteLength;
      if (size > maxBytes) {
        throw responseTooLarge(method, response.status);
      }
      chunks.push(chunk);
    };

    if (reader) {
      while (true) {
        const { done, value } = await readWithAbort(reader.read(), signal);
        if (done) {
          break;
        }
        appendChunk(value);
      }
    } else if (body[Symbol.asyncIterator]) {
      for await (const chunk of body) {
        throwIfAborted(signal);
        appendChunk(chunk);
      }
    } else {
      throw new Error('Unsupported response body stream');
    }
  } catch (error) {
    if (reader) {
      try {
        await reader.cancel();
      } catch {
        // A failed or locked reader may not support cancellation.
      }
    } else {
      await cancelResponseBody(response);
    }

    if (error instanceof CalDavEventTransportError) {
      throw error;
    }

    if (signal?.aborted) {
      throw abortError();
    }

    throw new CalDavEventTransportError(
      'response-read-failed',
      'CalDAV event response could not be read',
      method,
      response.status,
    );
  } finally {
    try {
      reader?.releaseLock();
    } catch {
      // Reader acquisition or cancellation can leave the stream unusable.
    }
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(bytes);
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    const body = response.body as unknown as AsyncResponseBody | null;
    if (body?.cancel) {
      await body.cancel();
    } else {
      body?.destroy?.();
    }
  } catch {
    // The response is already closed or consumed; no body data is needed here.
  }
}

function responseTooLarge(
  method: 'GET' | 'REPORT',
  status: number,
): CalDavEventTransportError {
  return new CalDavEventTransportError(
    'response-too-large',
    'CalDAV event response exceeded the configured size limit',
    method,
    status,
  );
}

async function writeResult(
  url: string,
  response: Response,
): Promise<CalDavEventWriteResult> {
  const result = {
    href: url,
    etag: response.headers.get('ETag')?.trim() || undefined,
  };
  await cancelResponseBody(response);
  return result;
}

function requestFailure(
  method: CalDavEventTransportMethod,
  url: string,
  status: number,
): CalDavEventTransportError {
  return new CalDavEventTransportError(
    'request-failed',
    `CalDAV ${method} failed with status ${status}`,
    method,
    status,
    url,
  );
}

function calendarQueryBody(start: Date, end: Date): string {
  return `<?xml version="1.0" encoding="utf-8" ?>
<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop>
    <D:getetag/>
    <C:calendar-data/>
  </D:prop>
  <C:filter>
    <C:comp-filter name="VCALENDAR">
      <C:comp-filter name="VEVENT">
        <C:time-range start="${calDavUtc(start)}" end="${calDavUtc(end)}"/>
      </C:comp-filter>
    </C:comp-filter>
  </C:filter>
</C:calendar-query>`;
}

function calendarUidQueryBody(eventUid: string): string {
  return `<?xml version="1.0" encoding="utf-8" ?>
<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop>
    <D:getetag/>
    <C:calendar-data/>
  </D:prop>
  <C:filter>
    <C:comp-filter name="VCALENDAR">
      <C:comp-filter name="VEVENT">
        <C:prop-filter name="UID">
          <C:text-match collation="i;octet" match-type="equals">${escapeXml(eventUid)}</C:text-match>
        </C:prop-filter>
      </C:comp-filter>
    </C:comp-filter>
  </C:filter>
</C:calendar-query>`;
}

function normalizeCollectionUrl(value: string): URL {
  const url = new URL(value);
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new CalDavEventTransportError(
      'invalid-response',
      'CalDAV UID query collection URL is invalid',
      'REPORT',
    );
  }
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url;
}

function resolveDirectCollectionResource(
  collection: URL,
  href: string,
): string {
  let resource: URL;
  try {
    resource = new URL(href, collection);
  } catch {
    throw invalidUidHref(collection);
  }
  const suffix = resource.pathname.startsWith(collection.pathname)
    ? resource.pathname.slice(collection.pathname.length)
    : '';
  let decodedSuffix: string;
  try {
    decodedSuffix = decodeURIComponent(suffix);
  } catch {
    throw invalidUidHref(collection);
  }
  if (
    resource.origin !== collection.origin ||
    resource.username ||
    resource.password ||
    resource.search ||
    resource.hash ||
    !suffix ||
    suffix.includes('/') ||
    decodedSuffix.includes('/') ||
    decodedSuffix.includes('\\') ||
    decodedSuffix === '.' ||
    decodedSuffix === '..' ||
    containsControlCharacters(decodedSuffix)
  ) {
    throw invalidUidHref(collection);
  }
  return resource.toString();
}

function invalidUidHref(collection: URL): CalDavEventTransportError {
  return new CalDavEventTransportError(
    'invalid-response',
    'CalDAV UID query returned a resource outside the configured collection',
    'REPORT',
    undefined,
    collection.toString(),
  );
}

function isSafeCalendarUid(value: string): boolean {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 1024 &&
    !containsControlCharacters(value)
  );
}

function containsControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&apos;';
      default:
        return character;
    }
  });
}

function assertSafeXmlDocument(
  xml: string,
  method: 'REPORT',
  status: number,
): void {
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) {
    throw new CalDavEventTransportError(
      'invalid-response',
      'CalDAV REPORT returned an unsupported XML document',
      method,
      status,
    );
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function abortError(): Error {
  return new DOMException('The operation was aborted', 'AbortError');
}

async function readWithAbort<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  throwIfAborted(signal);
  if (!signal) return promise;
  let onAbort: (() => void) | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(abortError());
        signal.addEventListener('abort', onAbort, { once: true });
      }),
    ]);
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
}

function parseRangeInstant(value: string, field: 'start' | 'end'): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new CalDavEventTransportError(
      'invalid-range',
      `CalDAV event query ${field} must be a valid ISO instant`,
    );
  }
  return parsed;
}

function calDavUtc(value: Date): string {
  return value
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

function successfulProperties(response: DavNode): DavNode {
  const result: DavNode = {};

  for (const propstatValue of asArray(response.propstat)) {
    const propstat = asNode(propstatValue);
    const status = textValue(propstat?.status);
    if (!status?.includes(' 200 ')) {
      continue;
    }

    Object.assign(result, asNode(propstat?.prop) ?? {});
  }

  return result;
}

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function asNode(value: unknown): DavNode | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as DavNode)
    : undefined;
}

function textValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
