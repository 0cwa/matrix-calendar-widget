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

import { CalDavCredentialProvider } from './CalDavCredentialProvider';

export type CreateCalDavCalendarInput = {
  displayName: string;
};

export class CalDavCalendarError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly url?: string,
  ) {
    super(message);
    this.name = 'CalDavCalendarError';
  }
}

export class CalDavCalendarClient {
  constructor(
    private readonly credentialProvider: CalDavCredentialProvider,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async createCalendar(
    calendarUrl: string,
    input: CreateCalDavCalendarInput,
  ): Promise<void> {
    const credentialHeaders = await this.credentialProvider.getRequestHeaders();
    const headers = new Headers(credentialHeaders);
    headers.set('Content-Type', 'application/xml; charset=utf-8');

    const response = await this.fetchImpl(calendarUrl, {
      method: 'MKCALENDAR',
      headers,
      body: mkcalendarBody(input.displayName),
    });

    if (!response.ok) {
      throw new CalDavCalendarError(
        `CalDAV MKCALENDAR failed with status ${response.status}`,
        response.status,
        calendarUrl,
      );
    }
  }
}

function mkcalendarBody(displayName: string): string {
  return `<?xml version="1.0" encoding="utf-8" ?>
<C:mkcalendar xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:D="DAV:">
  <D:set>
    <D:prop>
      <D:displayname>${escapeXml(displayName)}</D:displayname>
      <C:supported-calendar-component-set>
        <C:comp name="VEVENT"/>
      </C:supported-calendar-component-set>
    </D:prop>
  </D:set>
</C:mkcalendar>`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
