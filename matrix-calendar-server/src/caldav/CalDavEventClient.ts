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

export type CalDavEventResource = {
  href: string;
  etag: string;
  icalendar: string;
};

export type CalDavEventTransportErrorCode =
  | 'invalid-range'
  | 'invalid-response'
  | 'request-failed';

export type CalDavEventTransportMethod = 'GET' | 'REPORT';

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

export class CalDavEventClient {
  constructor(
    private readonly credentialProvider: CalDavCredentialProvider,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async listEvents(
    calendarUrl: string,
    range: CalendarTimeRange,
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

    const headers = await this.requestHeaders();
    headers.set('Content-Type', 'application/xml; charset=utf-8');
    headers.set('Depth', '1');

    const response = await this.fetchImpl(url, {
      method: 'REPORT',
      headers,
      body: calendarQueryBody(start, end),
    });

    if (!response.ok) {
      throw requestFailure('REPORT', url, response.status);
    }

    const document = asNode(parser.parse(await response.text()));
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

  async getEvent(resourceUrl: string): Promise<CalDavEventResource> {
    const url = new URL(resourceUrl).toString();
    const headers = await this.requestHeaders();
    headers.set('Accept', 'text/calendar');

    const response = await this.fetchImpl(url, {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      throw requestFailure('GET', url, response.status);
    }

    const etag = response.headers.get('ETag')?.trim();
    const icalendar = await response.text();

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

  private async requestHeaders(): Promise<Headers> {
    return new Headers(await this.credentialProvider.getRequestHeaders());
  }
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
