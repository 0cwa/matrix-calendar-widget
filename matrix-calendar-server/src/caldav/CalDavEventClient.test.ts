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
  it('overfetches VEVENT candidates by 32 hours without changing the caller range', async () => {
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

    const callerRange = {
      start: '2026-09-24T08:00:00+02:00',
      end: '2026-09-24T10:30:00+02:00',
    };
    const originalCallerRange = { ...callerRange };
    const result = await new CalDavEventClient(
      credentialProvider,
      fetchMock,
    ).listEvents('https://radicale.example.test/alice/events/', {
      ...callerRange,
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
    expect(init?.body).toContain('start="20260922T220000Z"');
    expect(init?.body).toContain('end="20260925T163000Z"');
    expect(callerRange).toEqual(originalCallerRange);
  });

  it('uses a collection-scoped exact UID query and bounds ambiguity results', async () => {
    const fetchMock = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValue(
        new Response(
          multistatus(`
            <d:response>
              <d:href>/alice/team/event%201.ics</d:href>
              <d:propstat><d:prop><d:getetag>"one"</d:getetag><c:calendar-data>BEGIN:VCALENDAR
BEGIN:VEVENT
UID:event&amp;one@example.test
END:VEVENT
END:VCALENDAR</c:calendar-data></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
            </d:response>
          `),
          { status: 207 },
        ),
      );
    const controller = new AbortController();
    const result = await new CalDavEventClient(
      credentialProvider,
      fetchMock,
    ).listEventsByUid(
      'https://radicale.example.test/alice/team/',
      'event&one@example.test',
      controller.signal,
    );

    expect(result).toEqual([
      {
        href: 'https://radicale.example.test/alice/team/event%201.ics',
        etag: '"one"',
        icalendar: expect.stringContaining('UID:event&one@example.test'),
      },
    ]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://radicale.example.test/alice/team/');
    expect(init?.method).toBe('REPORT');
    expect(init?.signal).toBe(controller.signal);
    expect(new Headers(init?.headers).get('Depth')).toBe('1');
    expect(init?.body).toContain('<C:prop-filter name="UID">');
    expect(init?.body).toContain('collation="i;octet" match-type="equals"');
    expect(init?.body).toContain('event&amp;one@example.test');
    expect(init?.body).not.toContain('time-range');
  });

  it.each([
    [
      'a resource outside the collection',
      '<d:href>/alice/private/event.ics</d:href>',
      'invalid-response',
    ],
    [
      'a response with a document type declaration',
      '<!DOCTYPE multistatus [<!ENTITY leaked "secret">]><d:href>/alice/team/event.ics</d:href>',
      'invalid-response',
    ],
  ])('rejects %s', async (_case, responseFragment, code) => {
    const responseBody = responseFragment.startsWith('<!DOCTYPE')
      ? `<?xml version="1.0"?>\n${responseFragment}<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:propstat><d:prop><d:getetag>"etag"</d:getetag><c:calendar-data>BEGIN:VCALENDAR\nEND:VCALENDAR</c:calendar-data></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`
      : multistatus(
          `<d:response>${responseFragment}<d:propstat><d:prop><d:getetag>"etag"</d:getetag><c:calendar-data>BEGIN:VCALENDAR\nEND:VCALENDAR</c:calendar-data></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`,
        );
    const fetchMock = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValue(new Response(responseBody, { status: 207 }));

    await expect(
      new CalDavEventClient(credentialProvider, fetchMock).listEventsByUid(
        'https://radicale.example.test/alice/team/',
        'event@example.test',
      ),
    ).rejects.toMatchObject({ code, method: 'REPORT' });
  });

  it('does not start a CalDAV request for an already aborted operation', async () => {
    const fetchMock = jest.fn<
      ReturnType<typeof fetch>,
      Parameters<typeof fetch>
    >();
    const controller = new AbortController();
    controller.abort();

    await expect(
      new CalDavEventClient(credentialProvider, fetchMock).listEventsByUid(
        'https://radicale.example.test/alice/team/',
        'event@example.test',
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [
      'ETag',
      '<c:calendar-data>BEGIN:VCALENDAR\nEND:VCALENDAR</c:calendar-data>',
    ],
    ['calendar data', '<d:getetag>"etag"</d:getetag>'],
  ])(
    'rejects a successful REPORT row without %s',
    async (_missing, properties) => {
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
    },
  );

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
    expect(init?.redirect).toBe('manual');
    expect(new Headers(init?.headers).get('Authorization')).toBe(
      'Basic delegated',
    );
    expect(new Headers(init?.headers).get('Accept')).toBe('text/calendar');
  });

  it.each([
    ['REPORT', 'https://radicale.example.test/alice/events/'] as const,
    ['GET', 'https://radicale.example.test/alice/events/event.ics'] as const,
    ['PUT', 'https://radicale.example.test/alice/events/event.ics'] as const,
    ['DELETE', 'https://radicale.example.test/alice/events/event.ics'] as const,
  ])(
    'rejects %s redirects without following or exposing their Location',
    async (method, url) => {
      const redirectResponse = new Response('secret response body', {
        status: 302,
        headers: {
          Location: 'https://redirect.example.test/steal?token=secret-value',
        },
      });
      const responseText = jest.spyOn(redirectResponse, 'text');
      const headerGet = jest.spyOn(redirectResponse.headers, 'get');
      const fetchMock = jest
        .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
        .mockResolvedValue(redirectResponse);
      const client = new CalDavEventClient(credentialProvider, fetchMock);
      const promise =
        method === 'REPORT'
          ? client.listEvents(url, {
              start: '2026-09-24T00:00:00Z',
              end: '2026-09-25T00:00:00Z',
            })
          : method === 'GET'
            ? client.getEvent(url)
            : method === 'PUT'
              ? client.createEvent(url, 'BEGIN:VCALENDAR\nEND:VCALENDAR')
              : client.deleteEvent(url, '"etag"');

      await expect(promise).rejects.toEqual(
        new CalDavEventTransportError(
          'redirected',
          'CalDAV event request was redirected',
          method,
          302,
        ),
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][1]?.redirect).toBe('manual');
      expect(responseText).not.toHaveBeenCalled();
      expect(headerGet).not.toHaveBeenCalledWith('Location');
    },
  );

  it.each([
    [
      'a same-origin path change',
      'https://radicale.example.test/alice/other-events/event.ics',
    ],
    [
      'the exact same resource',
      'https://radicale.example.test/alice/events/event.ics',
    ],
  ])(
    'rejects redirects to %s without inspecting Location',
    async (_case, location) => {
      const redirectResponse = new Response('', {
        status: 307,
        headers: { Location: location },
      });
      const headerGet = jest.spyOn(redirectResponse.headers, 'get');
      const fetchMock = jest
        .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
        .mockResolvedValue(redirectResponse);

      await expect(
        new CalDavEventClient(credentialProvider, fetchMock).getEvent(
          'https://radicale.example.test/alice/events/event.ics',
        ),
      ).rejects.toMatchObject({
        code: 'redirected',
        message: 'CalDAV event request was redirected',
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(headerGet).not.toHaveBeenCalledWith('Location');
    },
  );

  it('decodes a multibyte character split across response chunks at the byte limit', async () => {
    const icalendar = 'BEGIN:VCALENDAR\nSUMMARY:Café\nEND:VCALENDAR';
    const encoded = new TextEncoder().encode(icalendar);
    const cafeByte = encoded.findIndex((byte) => byte === 0xc3);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoded.slice(0, cafeByte + 1));
        controller.enqueue(encoded.slice(cafeByte + 1));
        controller.close();
      },
    });
    const response = {
      status: 200,
      ok: true,
      headers: new Headers({ ETag: '"etag"', 'Content-Length': '1' }),
      body: stream,
    } as Response;
    const fetchMock = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValue(response);

    await expect(
      new CalDavEventClient(
        credentialProvider,
        fetchMock,
        encoded.byteLength,
      ).getEvent('https://radicale.example.test/alice/events/event.ics'),
    ).resolves.toEqual({
      href: 'https://radicale.example.test/alice/events/event.ics',
      etag: '"etag"',
      icalendar,
    });
  });

  it.each(['REPORT', 'GET'] as const)(
    'enforces the response byte limit for %s with a misleading Content-Length and split UTF-8 chunks',
    async (method) => {
      const responseBody =
        method === 'REPORT'
          ? multistatus(`
            <d:response>
              <d:href>/alice/events/event.ics</d:href>
              <d:propstat>
                <d:prop>
                  <d:getetag>"etag"</d:getetag>
                  <c:calendar-data>BEGIN:VCALENDAR\nSUMMARY:Café\nEND:VCALENDAR</c:calendar-data>
                </d:prop>
                <d:status>HTTP/1.1 200 OK</d:status>
              </d:propstat>
            </d:response>
          `)
          : 'BEGIN:VCALENDAR\nSUMMARY:Café\nEND:VCALENDAR';
      const encoded = new TextEncoder().encode(responseBody);
      const cafeByte = encoded.findIndex((byte) => byte === 0xc3);
      const cancel = jest.fn();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoded.slice(0, cafeByte + 1));
          controller.enqueue(encoded.slice(cafeByte + 1));
        },
        cancel,
      });
      const response = {
        status: method === 'REPORT' ? 207 : 200,
        ok: true,
        headers: new Headers({
          'Content-Length': '1',
          ...(method === 'GET' ? { ETag: '"etag"' } : {}),
        }),
        body: stream,
      } as Response;
      const fetchMock = jest
        .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
        .mockResolvedValue(response);
      const client = new CalDavEventClient(
        credentialProvider,
        fetchMock,
        encoded.byteLength - 1,
      );
      const promise =
        method === 'REPORT'
          ? client.listEvents('https://radicale.example.test/alice/events/', {
              start: '2026-09-24T00:00:00Z',
              end: '2026-09-25T00:00:00Z',
            })
          : client.getEvent(
              'https://radicale.example.test/alice/events/event.ics',
            );

      await expect(promise).rejects.toMatchObject({
        code: 'response-too-large',
        message: 'CalDAV event response exceeded the configured size limit',
        method,
        status: method === 'REPORT' ? 207 : 200,
        url: undefined,
      });
      expect(cancel).toHaveBeenCalledTimes(1);
    },
  );

  it('maps response stream errors to a fixed message without returning body or URL data', async () => {
    const response = {
      status: 200,
      ok: true,
      headers: new Headers({ ETag: '"etag"' }),
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(new Error('secret body content'));
        },
      }),
    } as Response;
    const fetchMock = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValue(response);
    const secretUrl =
      'https://radicale.example.test/alice/events/event.ics?access_token=secret';

    await expect(
      new CalDavEventClient(credentialProvider, fetchMock).getEvent(secretUrl),
    ).rejects.toEqual(
      new CalDavEventTransportError(
        'response-read-failed',
        'CalDAV event response could not be read',
        'GET',
        200,
      ),
    );
  });

  it('maps a response reader acquisition error to a fixed message and attempts cancellation', async () => {
    const cancel = jest.fn().mockResolvedValue(undefined);
    const response = {
      status: 200,
      ok: true,
      headers: new Headers({ ETag: '"etag"' }),
      body: {
        getReader: () => {
          throw new Error('private stream sentinel');
        },
        cancel,
      },
    } as unknown as Response;
    const fetchMock = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValue(response);
    const secretUrl =
      'https://radicale.example.test/alice/events/event.ics?access_token=secret';

    await expect(
      new CalDavEventClient(credentialProvider, fetchMock).getEvent(secretUrl),
    ).rejects.toEqual(
      new CalDavEventTransportError(
        'response-read-failed',
        'CalDAV event response could not be read',
        'GET',
        200,
      ),
    );
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('maps a response body accessor error to a fixed message without leaking its detail', async () => {
    const response = new Response('private body sentinel', {
      status: 200,
      headers: { ETag: '"etag"' },
    });
    Object.defineProperty(response, 'body', {
      get() {
        throw new Error('private body accessor sentinel');
      },
    });
    const fetchMock = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValue(response);
    const secretUrl =
      'https://radicale.example.test/alice/events/event.ics?access_token=secret';

    await expect(
      new CalDavEventClient(credentialProvider, fetchMock).getEvent(secretUrl),
    ).rejects.toEqual(
      new CalDavEventTransportError(
        'response-read-failed',
        'CalDAV event response could not be read',
        'GET',
        200,
      ),
    );
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
          ? client.listEvents('https://radicale.example.test/alice/events/', {
              start: '2026-09-24T00:00:00Z',
              end: '2026-09-25T00:00:00Z',
            })
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
    const fetchMock = jest.fn<
      ReturnType<typeof fetch>,
      Parameters<typeof fetch>
    >();
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

  it('creates an event with If-None-Match and returns the response ETag', async () => {
    const fetchMock = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValue(
        new Response('', {
          status: 201,
          headers: { ETag: '"created-etag"' },
        }),
      );
    const client = new CalDavEventClient(credentialProvider, fetchMock);

    await expect(
      client.createEvent(
        'https://radicale.example.test/alice/events/new.ics',
        'BEGIN:VCALENDAR\nEND:VCALENDAR',
      ),
    ).resolves.toEqual({
      href: 'https://radicale.example.test/alice/events/new.ics',
      etag: '"created-etag"',
    });

    const [, init] = fetchMock.mock.calls[0];
    const headers = new Headers(init?.headers);
    expect(init?.method).toBe('PUT');
    expect(headers.get('Authorization')).toBe('Basic delegated');
    expect(headers.get('Content-Type')).toBe('text/calendar; charset=utf-8');
    expect(headers.get('If-None-Match')).toBe('*');
    expect(headers.get('If-Match')).toBeNull();
    expect(init?.body).toBe('BEGIN:VCALENDAR\nEND:VCALENDAR');
  });

  it('cancels unused write response bodies after extracting the ETag', async () => {
    const cancel = jest.fn();
    const response = {
      status: 201,
      ok: true,
      headers: new Headers({ ETag: '"created-etag"' }),
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('ignored body'));
        },
        cancel,
      }),
    } as Response;
    const fetchMock = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValue(response);

    await expect(
      new CalDavEventClient(credentialProvider, fetchMock).createEvent(
        'https://radicale.example.test/alice/events/new.ics',
        'BEGIN:VCALENDAR\nEND:VCALENDAR',
      ),
    ).resolves.toEqual({
      href: 'https://radicale.example.test/alice/events/new.ics',
      etag: '"created-etag"',
    });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('updates an event with If-Match and returns the latest ETag when present', async () => {
    const fetchMock = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValue(
        new Response('', {
          status: 204,
          headers: { ETag: '"updated-etag"' },
        }),
      );
    const client = new CalDavEventClient(credentialProvider, fetchMock);

    await expect(
      client.updateEvent(
        'https://radicale.example.test/alice/events/event.ics',
        '"old-etag"',
        'BEGIN:VCALENDAR\nEND:VCALENDAR',
      ),
    ).resolves.toEqual({
      href: 'https://radicale.example.test/alice/events/event.ics',
      etag: '"updated-etag"',
    });

    const [, init] = fetchMock.mock.calls[0];
    const headers = new Headers(init?.headers);
    expect(init?.method).toBe('PUT');
    expect(headers.get('If-Match')).toBe('"old-etag"');
    expect(headers.get('If-None-Match')).toBeNull();
  });

  it('deletes an event with If-Match and tolerates a success response without ETag', async () => {
    const fetchMock = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValue(new Response('', { status: 204 }));
    const client = new CalDavEventClient(credentialProvider, fetchMock);

    await expect(
      client.deleteEvent(
        'https://radicale.example.test/alice/events/event.ics',
        '"current-etag"',
      ),
    ).resolves.toEqual({
      href: 'https://radicale.example.test/alice/events/event.ics',
      etag: undefined,
    });

    const [, init] = fetchMock.mock.calls[0];
    const headers = new Headers(init?.headers);
    expect(init?.method).toBe('DELETE');
    expect(headers.get('If-Match')).toBe('"current-etag"');
  });

  it.each([
    ['create', 412],
    ['update', 412],
    ['delete', 409],
  ] as const)(
    'maps a stale %s to an ETag conflict',
    async (operation, status) => {
      const fetchMock = jest
        .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
        .mockResolvedValue(new Response('Conflict', { status }));
      const client = new CalDavEventClient(credentialProvider, fetchMock);
      const url = 'https://radicale.example.test/alice/events/event.ics';

      const promise =
        operation === 'create'
          ? client.createEvent(url, 'BEGIN:VCALENDAR\nEND:VCALENDAR')
          : operation === 'update'
            ? client.updateEvent(
                url,
                '"stale-etag"',
                'BEGIN:VCALENDAR\nEND:VCALENDAR',
              )
            : client.deleteEvent(url, '"stale-etag"');

      await expect(promise).rejects.toMatchObject({
        code: 'etag-conflict',
        method: operation === 'delete' ? 'DELETE' : 'PUT',
        status,
        url,
      });
    },
  );
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
