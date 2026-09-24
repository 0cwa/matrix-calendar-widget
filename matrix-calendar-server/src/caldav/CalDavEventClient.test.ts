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
  CalDavEventTransportError,
} from './CalDavEventClient';

const credentialProvider: CalDavCredentialProvider = {
  getRequestHeaders: async () => ({
    Authorization: 'Basic delegated',
  }),
};

describe('CalDavEventClient', () => {
  it('queries VEVENT resources in a UTC visible range across arbitrary namespace prefixes', async () => {
    const fetchMock = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValue(
        new Response(
          multistatus(
            `
            <x:response>
              <x:href>/alice/events/first.ics</x:href>
              <x:propstat>
                <x:prop>
                  <x:getetag>"first-etag"</x:getetag>
                  <c:calendar-data>BEGIN:VCALENDAR
BEGIN:VEVENT
UID:first@example.test
END:VEVENT
END:VCALENDAR</c:calendar-data>
                </x:prop>
                <x:status>HTTP/1.1 200 OK</x:status>
              </x:propstat>
            </x:response>
            <x:response>
              <x:href>/alice/events/second.ics</x:href>
              <x:propstat>
                <x:prop>
                  <x:getetag>"second-etag"</x:getetag>
                  <c:calendar-data>BEGIN:VCALENDAR
BEGIN:VEVENT
UID:second@example.test
END:VEVENT
END:VCALENDAR</c:calendar-data>
                </x:prop>
                <x:status>HTTP/1.1 200 OK</x:status>
              </x:propstat>
            </x:response>
            <x:response>
              <x:href>/alice/events/gone.ics</x:href>
              <x:propstat>
                <x:prop><x:getetag/></x:prop>
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
      start: '2026-09-24T08:00:00+02:00',
      end: '2026-09-24T10:30:00+02:00',
    });

    expect(result).toEqual([
      {
        href: 'https://radicale.example.test/alice/events/first.ics',
        etag: '"first-etag"',
        icalendar: expect.stringContaining('UID:first@example.test'),
      },
      {
        href: 'https://radicale.example.test/alice/events/second.ics',
        etag: '"second-etag"',
        icalendar: expect.stringContaining('UID:second@example.test'),
      },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://radicale.example.test/alice/events/');
    expect(init?.method).toBe('REPORT');
    expect(new Headers(init?.headers).get('Authorization')).toBe(
      'Basic delegated',
    );
    expect(new Headers(init?.headers).get('Depth')).toBe('1');
    expect(init?.body).toContain('name="VEVENT"');
    expect(init?.body).toContain('start="20260924T060000Z"');
    expect(init?.body).toContain('end="20260924T083000Z"');
  });

  it.each([
    ['ETag', '<c:calendar-data>BEGIN:VCALENDAR\nEND:VCALENDAR</c:calendar-data>'],
    ['calendar data', '<d:getetag>"etag"</d:getetag>'],
  ])('rejects a successful REPORT row without %s', async (_missing, properties) => {
    const fetchMock = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValue(
        new Response(
          multistatus(`
            <d:response>
              <d:href>/alice/events/incomplete.ics</d:href>
              <d:propstat>
                <d:prop>${properties}</d:prop>
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
          start: '2026-09-24T00:00:00Z',
          end: '2026-09-25T00:00:00Z',
        },
      ),
    ).rejects.toMatchObject({
      code: 'invalid-response',
      method: 'REPORT',
      status: 207,
      url: 'https://radicale.example.test/alice/events/',
    });
  });

  it('gets one event with its ETag and raw iCalendar body', async () => {
    const fetchMock = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValue(
        new Response('BEGIN:VCALENDAR\nEND:VCALENDAR', {
          status: 200,
          headers: { ETag: '"event-etag"' },
        }),
      );

    await expect(
      new CalDavEventClient(credentialProvider, fetchMock).getEvent(
        'https://radicale.example.test/alice/events/event.ics',
      ),
    ).resolves.toEqual({
      href: 'https://radicale.example.test/alice/events/event.ics',
      etag: '"event-etag"',
      icalendar: 'BEGIN:VCALENDAR\nEND:VCALENDAR',
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(init?.method).toBe('GET');
    expect(new Headers(init?.headers).get('Authorization')).toBe(
      'Basic delegated',
    );
    expect(new Headers(init?.headers).get('Accept')).toBe('text/calendar');
  });

  it('rejects a GET response without an ETag or calendar body', async () => {
    const fetchMock = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValue(new Response('', { status: 200 }));

    await expect(
      new CalDavEventClient(credentialProvider, fetchMock).getEvent(
        'https://radicale.example.test/alice/events/event.ics',
      ),
    ).rejects.toMatchObject({
      code: 'invalid-response',
      method: 'GET',
      status: 200,
    });
  });

  it.each([
    ['REPORT', 401],
    ['GET', 503],
  ] as const)(
    'maps a rejected %s request to a structured transport error',
    async (method, status) => {
      const fetchMock = jest
        .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
        .mockResolvedValue(new Response('Rejected', { status }));
      const client = new CalDavEventClient(credentialProvider, fetchMock);

      const promise =
        method === 'REPORT'
          ? client.listEvents(
              'https://radicale.example.test/alice/events/',
              {
                start: '2026-09-24T00:00:00Z',
                end: '2026-09-25T00:00:00Z',
              },
            )
          : client.getEvent(
              'https://radicale.example.test/alice/events/event.ics',
            );

      await expect(promise).rejects.toEqual(
        new CalDavEventTransportError(
          'request-failed',
          `CalDAV ${method} failed with status ${status}`,
          method,
          status,
          method === 'REPORT'
            ? 'https://radicale.example.test/alice/events/'
            : 'https://radicale.example.test/alice/events/event.ics',
        ),
      );
    },
  );

  it('rejects an invalid or empty range before sending a request', async () => {
    const fetchMock = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();
    const client = new CalDavEventClient(credentialProvider, fetchMock);

    await expect(
      client.listEvents('https://radicale.example.test/alice/events/', {
        start: 'invalid',
        end: '2026-09-25T00:00:00Z',
      }),
    ).rejects.toMatchObject({ code: 'invalid-range' });

    await expect(
      client.listEvents('https://radicale.example.test/alice/events/', {
        start: '2026-09-25T00:00:00Z',
        end: '2026-09-25T00:00:00Z',
      }),
    ).rejects.toMatchObject({ code: 'invalid-range' });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

function multistatus(body: string, davPrefix = 'd'): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<${davPrefix}:multistatus
  xmlns:${davPrefix}="DAV:"
  xmlns:c="urn:ietf:params:xml:ns:caldav"
>
  ${body}
</${davPrefix}:multistatus>`;
}
