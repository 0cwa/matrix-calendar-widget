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

import { XMLParser } from 'fast-xml-parser';
import { CalDavCredentialProvider } from './CalDavCredentialProvider';

export type CalDavEventResource = {
  href: string;
  etag: string;
  icalendar: string;
};

export type CalDavEventWriteResult = {
  href: string;
  etag?: string;
};

export type CalDavUtcRange = {
  start: string;
  end: string;
};

export class CalDavEventTransportError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly url?: string,
  ) {
    super(message);
    this.name = 'CalDavEventTransportError';
  }
}

export class CalDavEventConflictError extends CalDavEventTransportError {
  constructor(
    status: number,
    url: string,
    public readonly operation: 'create' | 'update' | 'delete',
  ) {
    super(
      `CalDAV ${operation} conflicted with the current resource state (status ${status})`,
      status,
      url,
    );
    this.name = 'CalDavEventConflictError';
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
    range: CalDavUtcRange,
  ): Promise<CalDavEventResource[]> {
    const url = new URL(calendarUrl).toString();
    const response = await this.request(url, {
      method: 'REPORT',
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        Depth: '1',
      },
      body: calendarQueryBody(range),
    });

    this.assertSuccess(response, 'REPORT', url);

    const xml = await response.text();
    const document = asNode(parser.parse(xml));
    const multistatus = asNode(document?.multistatus);

    if (!multistatus) {
      throw new CalDavEventTransportError(
        'CalDAV REPORT response did not include a DAV multistatus document',
        response.status,
        url,
      );
    }

    return asArray(multistatus.response).flatMap((responseValue) => {
      const responseNode = asNode(responseValue);
      if (!responseNode) {
        return [];
      }

      const properties = successfulProperties(responseNode);
      const hasCalendarData = Object.prototype.hasOwnProperty.call(
        properties,
        'calendar-data',
      );
      const hasEtag = Object.prototype.hasOwnProperty.call(
        properties,
        'getetag',
      );

      // Some servers include the calendar collection itself in multistatus.
      if (!hasCalendarData && !hasEtag) {
        return [];
      }

      const href = textValue(responseNode.href);
      const etag = textValue(properties.getetag);
      const icalendar = textValue(properties['calendar-data']);

      if (!href || !etag || !icalendar) {
        throw new CalDavEventTransportError(
          'CalDAV REPORT resource is missing href, ETag, or calendar-data',
          response.status,
          url,
        );
      }

      return [
        {
          href: new URL(href, url).toString(),
          etag,
          icalendar,
        },
      ];
    });
  }

  async getEvent(resourceUrl: string): Promise<CalDavEventResource> {
    const url = new URL(resourceUrl).toString();
    const response = await this.request(url, {
      method: 'GET',
      headers: {
        Accept: 'text/calendar',
      },
    });

    this.assertSuccess(response, 'GET', url);

    const etag = response.headers.get('ETag') ?? undefined;
    const icalendar = await response.text();

    if (!etag || !icalendar) {
      throw new CalDavEventTransportError(
        'CalDAV GET response is missing ETag or calendar body',
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
  ): Promise<CalDavEventWriteResult> {
    return this.putEvent(resourceUrl, icalendar, {
      'If-None-Match': '*',
    }, 'create');
  }

  async updateEvent(
    resourceUrl: string,
    etag: string,
    icalendar: string,
  ): Promise<CalDavEventWriteResult> {
    return this.putEvent(
      resourceUrl,
      icalendar,
      {
        'If-Match': etag,
      },
      'update',
    );
  }

  async deleteEvent(resourceUrl: string, etag: string): Promise<void> {
    const url = new URL(resourceUrl).toString();
    const response = await this.request(url, {
      method: 'DELETE',
      headers: {
        'If-Match': etag,
      },
    });

    this.assertWriteSuccess(response, 'delete', url);
  }

  private async putEvent(
    resourceUrl: string,
    icalendar: string,
    preconditionHeaders: Record<string, string>,
    operation: 'create' | 'update',
  ): Promise<CalDavEventWriteResult> {
    const url = new URL(resourceUrl).toString();
    const response = await this.request(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        ...preconditionHeaders,
      },
      body: icalendar,
    });

    this.assertWriteSuccess(response, operation, url);

    return {
      href: url,
      etag: response.headers.get('ETag') ?? undefined,
    };
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    const credentialHeaders = await this.credentialProvider.getRequestHeaders();
    const headers = new Headers(credentialHeaders);

    new Headers(init.headers).forEach((value, key) => {
      headers.set(key, value);
    });

    return this.fetchImpl(url, {
      ...init,
      headers,
    });
  }

  private assertWriteSuccess(
    response: Response,
    operation: 'create' | 'update' | 'delete',
    url: string,
  ): void {
    if (response.status === 409 || response.status === 412) {
      throw new CalDavEventConflictError(response.status, url, operation);
    }

    this.assertSuccess(response, operation.toUpperCase(), url);
  }

  private assertSuccess(response: Response, method: string, url: string): void {
    if (!response.ok) {
      throw new CalDavEventTransportError(
        `CalDAV ${method} failed with status ${response.status}`,
        response.status,
        url,
      );
    }
  }
}

function calendarQueryBody(range: CalDavUtcRange): string {
  const start = formatUtcInstant(range.start);
  const end = formatUtcInstant(range.end);

  return `<?xml version="1.0" encoding="utf-8" ?>
<C:calendar-query
  xmlns:D="DAV:"
  xmlns:C="urn:ietf:params:xml:ns:caldav"
>
  <D:prop>
    <D:getetag/>
    <C:calendar-data/>
  </D:prop>
  <C:filter>
    <C:comp-filter name="VCALENDAR">
      <C:comp-filter name="VEVENT">
        <C:time-range start="${start}" end="${end}"/>
      </C:comp-filter>
    </C:comp-filter>
  </C:filter>
</C:calendar-query>`;
}

function formatUtcInstant(value: string): string {
  const instant = new Date(value);

  if (Number.isNaN(instant.getTime())) {
    throw new CalDavEventTransportError(
      `Invalid CalDAV UTC range instant: ${value}`,
    );
  }

  return instant
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
