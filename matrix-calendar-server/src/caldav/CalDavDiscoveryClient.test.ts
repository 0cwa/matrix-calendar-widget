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
  CalDavDiscoveryClient,
  CalDavDiscoveryError,
} from './CalDavDiscoveryClient';

const credentialProvider: CalDavCredentialProvider = {
  getRequestHeaders: async () => ({
    Authorization: 'Basic delegated',
  }),
};

describe('CalDavDiscoveryClient', () => {
  it('discovers VEVENT calendars across arbitrary XML namespace prefixes', async () => {
    const fetchMock = createFetchMock(
      multistatus(
        `
        <x:response>
          <x:href>/</x:href>
          <x:propstat>
            <x:prop>
              <x:current-user-principal>
                <x:href>/principals/alice/</x:href>
              </x:current-user-principal>
            </x:prop>
            <x:status>HTTP/1.1 200 OK</x:status>
          </x:propstat>
        </x:response>
      `,
        'x',
      ),
      multistatus(`
        <d:response>
          <d:href>/principals/alice/</d:href>
          <d:propstat>
            <d:prop>
              <c:calendar-home-set>
                <d:href>/alice/</d:href>
              </c:calendar-home-set>
            </d:prop>
            <d:status>HTTP/1.1 200 OK</d:status>
          </d:propstat>
        </d:response>
      `),
      multistatus(`
        <d:response>
          <d:href>/alice/events/</d:href>
          <d:propstat>
            <d:prop>
              <d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
              <d:displayname>Team events</d:displayname>
              <a:calendar-color>#336699ff</a:calendar-color>
              <c:supported-calendar-component-set>
                <c:comp name="VEVENT"/>
                <c:comp name="VTODO"/>
              </c:supported-calendar-component-set>
              <d:current-user-privilege-set>
                <d:privilege><d:read/></d:privilege>
                <d:privilege><d:write-content/></d:privilege>
              </d:current-user-privilege-set>
            </d:prop>
            <d:status>HTTP/1.1 200 OK</d:status>
          </d:propstat>
        </d:response>
        <d:response>
          <d:href>/alice/tasks/</d:href>
          <d:propstat>
            <d:prop>
              <d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
              <d:displayname>Tasks only</d:displayname>
              <c:supported-calendar-component-set>
                <c:comp name="VTODO"/>
              </c:supported-calendar-component-set>
            </d:prop>
            <d:status>HTTP/1.1 200 OK</d:status>
          </d:propstat>
        </d:response>
      `),
    );

    const result = await new CalDavDiscoveryClient(
      'https://radicale.example.test/',
      credentialProvider,
      fetchMock,
    ).discover();

    expect(result).toEqual({
      principalUrl: 'https://radicale.example.test/principals/alice/',
      calendarHomeUrl: 'https://radicale.example.test/alice/',
      calendars: [
        {
          href: 'https://radicale.example.test/alice/events/',
          displayName: 'Team events',
          color: '#336699ff',
          components: ['VEVENT', 'VTODO'],
          readOnly: false,
        },
      ],
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.method).toBe('PROPFIND');
      expect(new Headers(init?.headers).get('Authorization')).toBe(
        'Basic delegated',
      );
    }
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('Depth')).toBe(
      '0',
    );
    expect(new Headers(fetchMock.mock.calls[2][1]?.headers).get('Depth')).toBe(
      '1',
    );
  });

  it('includes calendars without a component restriction and preserves missing optional properties', async () => {
    const fetchMock = createFetchMock(
      principalResponse('/p/alice/'),
      homeResponse('/home/alice/'),
      multistatus(`
        <d:response>
          <d:href>/home/alice/default/</d:href>
          <d:propstat>
            <d:prop>
              <d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
            </d:prop>
            <d:status>HTTP/1.1 200 OK</d:status>
          </d:propstat>
        </d:response>
      `),
    );

    await expect(
      new CalDavDiscoveryClient(
        'https://radicale.example.test/',
        credentialProvider,
        fetchMock,
      ).discover(),
    ).resolves.toEqual({
      principalUrl: 'https://radicale.example.test/p/alice/',
      calendarHomeUrl: 'https://radicale.example.test/home/alice/',
      calendars: [
        {
          href: 'https://radicale.example.test/home/alice/default/',
          displayName: undefined,
          color: undefined,
          components: undefined,
          readOnly: undefined,
        },
      ],
    });
  });

  it('marks collections read-only when DAV write privileges are absent', async () => {
    const fetchMock = createFetchMock(
      principalResponse('/p/alice/'),
      homeResponse('/home/alice/'),
      multistatus(`
        <d:response>
          <d:href>/home/alice/read-only/</d:href>
          <d:propstat>
            <d:prop>
              <d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
              <c:supported-calendar-component-set>
                <c:comp name="VEVENT"/>
              </c:supported-calendar-component-set>
              <d:current-user-privilege-set>
                <d:privilege><d:read/></d:privilege>
              </d:current-user-privilege-set>
            </d:prop>
            <d:status>HTTP/1.1 200 OK</d:status>
          </d:propstat>
        </d:response>
      `),
    );

    const result = await new CalDavDiscoveryClient(
      'https://radicale.example.test/',
      credentialProvider,
      fetchMock,
    ).discover();

    expect(result.calendars[0].readOnly).toBe(true);
  });

  it('creates a VEVENT-only calendar in the discovered calendar home', async () => {
    const fetchMock = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValueOnce(
        new Response(principalResponse('/principals/alice/'), { status: 207 }),
      )
      .mockResolvedValueOnce(
        new Response(homeResponse('/alice/'), { status: 207 }),
      )
      .mockResolvedValueOnce(new Response('', { status: 201 }));

    await expect(
      new CalDavDiscoveryClient(
        'https://radicale.example.test/',
        credentialProvider,
        fetchMock,
      ).createCalendar('Team & Planning', 'calendar-123'),
    ).resolves.toEqual({
      href: 'https://radicale.example.test/alice/calendar-123/',
      displayName: 'Team & Planning',
      components: ['VEVENT'],
      readOnly: false,
    });

    const [url, init] = fetchMock.mock.calls[2];
    expect(url).toBe('https://radicale.example.test/alice/calendar-123/');
    expect(init?.method).toBe('MKCALENDAR');
    expect(new Headers(init?.headers).get('Authorization')).toBe(
      'Basic delegated',
    );
    expect(init?.body).toContain(
      '<D:displayname>Team &amp; Planning</D:displayname>',
    );
    expect(init?.body).toContain('<C:comp name="VEVENT"/>');
    expect(init?.body).not.toContain('VTODO');
    expect(init?.body).not.toContain('VJOURNAL');
  });

  it('fails with status and URL when a PROPFIND request is rejected', async () => {
    const fetchMock = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValue(new Response('Unauthorized', { status: 401 }));

    await expect(
      new CalDavDiscoveryClient(
        'https://radicale.example.test/',
        credentialProvider,
        fetchMock,
      ).discover(),
    ).rejects.toEqual(
      new CalDavDiscoveryError(
        'CalDAV PROPFIND failed with status 401',
        401,
        'https://radicale.example.test/',
      ),
    );
  });
});

function createFetchMock(...xmlResponses: string[]) {
  const responses = xmlResponses.map(
    (xml) =>
      new Response(xml, {
        status: 207,
        headers: { 'Content-Type': 'application/xml' },
      }),
  );

  return jest
    .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
    .mockImplementation(async () => responses.shift()!);
}

function principalResponse(href: string): string {
  return multistatus(`
    <d:response>
      <d:propstat>
        <d:prop>
          <d:current-user-principal><d:href>${href}</d:href></d:current-user-principal>
        </d:prop>
        <d:status>HTTP/1.1 200 OK</d:status>
      </d:propstat>
    </d:response>
  `);
}

function homeResponse(href: string): string {
  return multistatus(`
    <d:response>
      <d:propstat>
        <d:prop>
          <c:calendar-home-set><d:href>${href}</d:href></c:calendar-home-set>
        </d:prop>
        <d:status>HTTP/1.1 200 OK</d:status>
      </d:propstat>
    </d:response>
  `);
}

function multistatus(body: string, davPrefix = 'd'): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<${davPrefix}:multistatus
  xmlns:${davPrefix}="DAV:"
  xmlns:c="urn:ietf:params:xml:ns:caldav"
  xmlns:a="http://apple.com/ns/ical/"
>
  ${body}
</${davPrefix}:multistatus>`;
}
