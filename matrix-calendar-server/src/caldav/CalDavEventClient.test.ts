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
import {
  CalDavEventClient,
  CalDavEventConflictError,
  CalDavEventTransportError,
} from './CalDavEventClient';

const credentialProvider: CalDavCredentialProvider = {
  getRequestHeaders: async () => ({
    Authorization: 'Basic delegated',
  }),
};

describe('CalDavEventClient', () => {
  it('queries VEVENT resources for the visible UTC range', async () => {
    const fetchMock = mockFetch(
      new Response(
        multistatus(`
          <x:response>
            <x:href>/alice/events/one.ics</x:href>
            <x:propstat>
              <x:prop>
                <x:getetag>"one"</x:getetag>
                <c:calendar-data>BEGIN:VCALENDAR
BEGIN:VEVENT
UID:one
END:VEVENT
END:VCALENDAR</c:calendar-data>
              </x:prop>
              <x:status>HTTP/1.1 200 OK</x:status>
            </x:propstat>
          </x:response>
          <x:response>
            <x:href>/alice/events/ignored.ics</x:href>
            <x:propstat>
              <x:prop><x:getetag>"ignored"</x:getetag></x:prop>
              <x:status>HTTP/1.1 404 Not Found</x:status>
            </x:propstat>
          </x:response>
        `,
          'x',
        ),
        { status: 207 },
      ),
    );

    const result = await new CalDavEventClient(
      credentialProvider,
      fetchMock,
    ).listEvents('https://radicale.example.test/alice/events/', {
      start: '2026-09-01T00:00:00.000Z',
      end: '2026-10-01T00:00:00.000Z',
    });

    expect(result).toEqual([
      {
        href: 'https://radicale.example.test/alice/events/one.ics',
        etag: '"one"',
        icalendar:
          'BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:one\nEND:VEVENT\nEND:VCALENDAR',
      },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://radicale.example.test/alice/events/');
    expect(init?.method).toBe('REPORT');
    expect(new Headers(init?.headers).get('Depth')).toBe('1');
    expect(new Headers(init?.headers).get('Authorization')).toBe(
      'Basic delegated',
    );
    expect(String(init?.body)).toContain(
      '<C:time-range start="20260901T000000Z" end="20261001T000000Z"/>',
    );
  });

  it('fails closed when a REPORT resource is missing its ETag', async () => {
    const fetchMock = mockFetch(
      new Response(
        multistatus(`
          <d:response>
            <d:href>/alice/events/one.ics</d:href>
            <d:propstat>
              <d:prop>
                <c:calendar-data>BEGIN:VCALENDAR
END:VCALENDAR</c:calendar-data>
              </d:prop>
              <d:status>HTTP/1.1 200 OK</d:status>
            </d:propstat>
          </d:response>
        `),
        { status: 207 },
      ),
    );

    await expect(
      new CalDavEventClient(credentialProvider, fetchMock).listEvents(
        'https://radicale.example.test/alice/events/',
        {
          start: '2026-09-01T00:00:00Z',
          end: '2026-10-01T00:00:00Z',
        },
      ),
    ).rejects.toEqual(
      new CalDavEventTransportError(
        'CalDAV REPORT resource is missing href, ETag, or calendar-data',
        207,
        'https://radicale.example.test/alice/events/',
      ),
    );
  });

  it('maps non-success REPORT responses to a structured transport error', async () => {
    const fetchMock = mockFetch(new Response('Nope', { status: 503 }));

    await expect(
      new CalDavEventClient(credentialProvider, fetchMock).listEvents(
        'https://radicale.example.test/alice/events/',
        {
          start: '2026-09-01T00:00:00Z',
          end: '2026-10-01T00:00:00Z',
        },
      ),
    ).rejects.toEqual(
      new CalDavEventTransportError(
        'CalDAV REPORT failed with status 503',
        503,
        'https://radicale.example.test/alice/events/',
      ),
    );
  });

  it('gets one event with its ETag and calendar body', async () => {
    const fetchMock = mockFetch(
      new Response('BEGIN:VCALENDAR\nEND:VCALENDAR', {
        status: 200,
        headers: { ETag: '"fresh"' },
      }),
    );

    await expect(
      new CalDavEventClient(credentialProvider, fetchMock).getEvent(
        'https://radicale.example.test/alice/events/one.ics',
      ),
    ).resolves.toEqual({
      href: 'https://radicale.example.test/alice/events/one.ics',
      etag: '"fresh"',
      icalendar: 'BEGIN:VCALENDAR\nEND:VCALENDAR',
    });

    expect(fetchMock.mock.calls[0][1]?.method).toBe('GET');
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('Accept')).toBe(
      'text/calendar',
    );
  });

  it('fails closed when GET omits the ETag', async () => {
    const fetchMock = mockFetch(
      new Response('BEGIN:VCALENDAR\nEND:VCALENDAR', { status: 200 }),
    );

    await expect(
      new CalDavEventClient(credentialProvider, fetchMock).getEvent(
        'https://radicale.example.test/alice/events/one.ics',
      ),
    ).rejects.toEqual(
      new CalDavEventTransportError(
        'CalDAV GET response is missing ETag or calendar body',
        200,
        'https://radicale.example.test/alice/events/one.ics',
      ),
    );
  });

  it('creates with If-None-Match and returns a server ETag when available', async () => {
    const fetchMock = mockFetch(
      new Response(null, {
        status: 201,
        headers: { ETag: '"created"' },
      }),
    );

    await expect(
      new CalDavEventClient(credentialProvider, fetchMock).createEvent(
        'https://radicale.example.test/alice/events/new.ics',
        'BEGIN:VCALENDAR\nEND:VCALENDAR',
      ),
    ).resolves.toEqual({
      href: 'https://radicale.example.test/alice/events/new.ics',
      etag: '"created"',
    });

    const init = fetchMock.mock.calls[0][1];
    expect(init?.method).toBe('PUT');
    expect(new Headers(init?.headers).get('If-None-Match')).toBe('*');
    expect(String(init?.body)).toBe('BEGIN:VCALENDAR\nEND:VCALENDAR');
  });

  it('maps create collisions to a structured conflict error', async () => {
    const fetchMock = mockFetch(new Response(null, { status: 412 }));

    await expect(
      new CalDavEventClient(credentialProvider, fetchMock).createEvent(
        'https://radicale.example.test/alice/events/existing.ics',
        'BEGIN:VCALENDAR\nEND:VCALENDAR',
      ),
    ).rejects.toEqual(
      new CalDavEventConflictError(
        412,
        'https://radicale.example.test/alice/events/existing.ics',
        'create',
      ),
    );
  });

  it('updates with If-Match and returns the latest ETag', async () => {
    const fetchMock = mockFetch(
      new Response(null, {
        status: 204,
        headers: { ETag: '"next"' },
      }),
    );

    await expect(
      new CalDavEventClient(credentialProvider, fetchMock).updateEvent(
        'https://radicale.example.test/alice/events/one.ics',
        '"previous"',
        'BEGIN:VCALENDAR\nEND:VCALENDAR',
      ),
    ).resolves.toEqual({
      href: 'https://radicale.example.test/alice/events/one.ics',
      etag: '"next"',
    });

    expect(
      new Headers(fetchMock.mock.calls[0][1]?.headers).get('If-Match'),
    ).toBe('"previous"');
  });

  it('deletes with If-Match and maps stale ETags to conflicts', async () => {
    const successFetch = mockFetch(new Response(null, { status: 204 }));
    await new CalDavEventClient(credentialProvider, successFetch).deleteEvent(
      'https://radicale.example.test/alice/events/one.ics',
      '"current"',
    );

    expect(successFetch.mock.calls[0][1]?.method).toBe('DELETE');
    expect(
      new Headers(successFetch.mock.calls[0][1]?.headers).get('If-Match'),
    ).toBe('"current"');

    const conflictFetch = mockFetch(new Response(null, { status: 409 }));
    await expect(
      new CalDavEventClient(credentialProvider, conflictFetch).deleteEvent(
        'https://radicale.example.test/alice/events/one.ics',
        '"stale"',
      ),
    ).rejects.toEqual(
      new CalDavEventConflictError(
        409,
        'https://radicale.example.test/alice/events/one.ics',
        'delete',
      ),
    );
  });
});

function mockFetch(...responses: Response[]): jest.MockedFunction<typeof fetch> {
  return jest
    .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
    .mockImplementation(async () => responses.shift()!);
}

function multistatus(body: string, davPrefix = 'd'): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<${davPrefix}:multistatus
  xmlns:${davPrefix}="DAV:"
  xmlns:c="urn:ietf:params:xml:ns:caldav"
>
  ${body}
</${davPrefix}:multistatus>`;
}
