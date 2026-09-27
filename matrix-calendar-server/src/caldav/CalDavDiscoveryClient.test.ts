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
              <c:calendar-description>Planning &amp; review</c:calendar-description>
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
          description: 'Planning & review',
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
          description: undefined,
          color: undefined,
          components: undefined,
          readOnly: undefined,
        },
      ],
    });
  });

  it('leaves calendar safety metadata unavailable when its propstats fail', async () => {
    const fetchMock = createFetchMock(
      principalResponse('/p/alice/'),
      homeResponse('/home/alice/'),
      multistatus(`
        <d:response>
          <d:href>/home/alice/team/</d:href>
          <d:propstat>
            <d:prop>
              <d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
              <d:displayname>Team events</d:displayname>
            </d:prop>
            <d:status>HTTP/1.1 200 OK</d:status>
          </d:propstat>
          <d:propstat>
            <d:prop>
              <c:supported-calendar-component-set>
                <c:comp name="VEVENT"/>
              </c:supported-calendar-component-set>
            </d:prop>
            <d:status>HTTP/1.1 403 Forbidden</d:status>
          </d:propstat>
          <d:propstat>
            <d:prop>
              <d:current-user-privilege-set>
                <d:privilege><d:read/></d:privilege>
                <d:privilege><d:write/></d:privilege>
              </d:current-user-privilege-set>
            </d:prop>
            <d:status>HTTP/1.1 403 Forbidden</d:status>
          </d:propstat>
          <d:propstat>
            <d:prop><c:calendar-description/></d:prop>
            <d:status>HTTP/1.1 403 Forbidden</d:status>
          </d:propstat>
        </d:response>
      `),
    );

    const result = await new CalDavDiscoveryClient(
      'https://radicale.example.test/',
      credentialProvider,
      fetchMock,
    ).discover();

    expect(result.calendars).toEqual([
      {
        href: 'https://radicale.example.test/home/alice/team/',
        displayName: 'Team events',
        description: undefined,
        color: undefined,
        components: undefined,
        readOnly: undefined,
      },
    ]);
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

  it('renames only the DAV display name with PROPPATCH', async () => {
    const fetchMock = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValue(
        new Response(
          multistatus(`
            <d:response>
              <d:href>/alice/team/</d:href>
              <d:propstat>
                <d:prop><d:displayname/></d:prop>
                <d:status>HTTP/1.1 200 OK</d:status>
              </d:propstat>
            </d:response>
          `),
          { status: 207 },
        ),
      );

    await expect(
      new CalDavDiscoveryClient(
        'https://radicale.example.test/',
        credentialProvider,
        fetchMock,
      ).renameCalendar(
        'https://radicale.example.test/alice/team/',
        'Team & Planning',
      ),
    ).resolves.toBeUndefined();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://radicale.example.test/alice/team/');
    expect(init?.method).toBe('PROPPATCH');
    expect(new Headers(init?.headers).get('Authorization')).toBe(
      'Basic delegated',
    );
    expect(init?.body).toContain(
      '<D:displayname>Team &amp; Planning</D:displayname>',
    );
    expect(init?.body).not.toContain('calendar-color');
    expect(init?.body).not.toContain('supported-calendar-component-set');
  });

  it('fails with status and URL when a PROPPATCH request is rejected', async () => {
    const fetchMock = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValue(new Response('Forbidden', { status: 403 }));

    await expect(
      new CalDavDiscoveryClient(
        'https://radicale.example.test/',
        credentialProvider,
        fetchMock,
      ).renameCalendar(
        'https://radicale.example.test/alice/team/',
        'Product calendar',
      ),
    ).rejects.toEqual(
      new CalDavDiscoveryError(
        'CalDAV PROPPATCH failed with status 403',
        403,
        'https://radicale.example.test/alice/team/',
      ),
    );
  });

  it('rejects a 207 PROPPATCH response when displayname failed', async () => {
    const fetchMock = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValue(
        new Response(
          multistatus(`
            <d:response>
              <d:href>/alice/team/</d:href>
              <d:propstat>
                <d:prop><d:displayname/></d:prop>
                <d:status>HTTP/1.1 403 Forbidden</d:status>
              </d:propstat>
            </d:response>
          `),
          { status: 207 },
        ),
      );

    await expect(
      new CalDavDiscoveryClient(
        'https://radicale.example.test/',
        credentialProvider,
        fetchMock,
      ).renameCalendar(
        'https://radicale.example.test/alice/team/',
        'Product calendar',
      ),
    ).rejects.toEqual(
      new CalDavDiscoveryError(
        'CalDAV PROPPATCH failed for displayname with status 403',
        403,
        'https://radicale.example.test/alice/team/',
      ),
    );
  });

  it('sets only the calendar description and escapes XML text', async () => {
    const fetchMock = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValue(
        new Response(
          multistatus(`
            <d:response>
              <d:href>/alice/team/</d:href>
              <d:propstat>
                <d:prop><c:calendar-description/></d:prop>
                <d:status>HTTP/1.1 200 OK</d:status>
              </d:propstat>
            </d:response>
          `),
          { status: 207 },
        ),
      );

    await expect(
      new CalDavDiscoveryClient(
        'https://radicale.example.test/',
        credentialProvider,
        fetchMock,
      ).updateCalendarDescription(
        'https://radicale.example.test/alice/team/',
        'Plan <Q&A>',
      ),
    ).resolves.toBeUndefined();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://radicale.example.test/alice/team/');
    expect(init?.method).toBe('PROPPATCH');
    expect(new Headers(init?.headers).get('Authorization')).toBe(
      'Basic delegated',
    );
    expect(init?.body).toContain(
      '<C:calendar-description>Plan &lt;Q&amp;A&gt;</C:calendar-description>',
    );
    expect(init?.body).not.toContain('displayname');
    expect(init?.body).not.toContain('calendar-color');
    expect(init?.body).not.toContain('timezone');
  });

  it('round-trips calendar-description whitespace without trimming other DAV values', async () => {
    const description = '  Plan <Q&A>  ';
    const writeFetch = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValue(
        new Response(
          multistatus(`
            <d:response>
              <d:href>/alice/team/</d:href>
              <d:propstat>
                <d:prop><c:calendar-description/></d:prop>
                <d:status>HTTP/1.1 200 OK</d:status>
              </d:propstat>
            </d:response>
          `),
          { status: 207 },
        ),
      );

    await new CalDavDiscoveryClient(
      'https://radicale.example.test/',
      credentialProvider,
      writeFetch,
    ).updateCalendarDescription(
      'https://radicale.example.test/alice/team/',
      description,
    );

    expect(writeFetch.mock.calls[0][1]?.body).toContain(
      '<C:calendar-description>  Plan &lt;Q&amp;A&gt;  </C:calendar-description>',
    );

    const readFetch = createFetchMock(
      principalResponse('/principals/alice/'),
      homeResponse('/alice/'),
      multistatus(`
        <d:response>
          <d:href>  /alice/team/  </d:href>
          <d:propstat>
            <d:prop>
              <d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
              <d:displayname>  Team calendar  </d:displayname>
              <c:calendar-description>  Plan &lt;Q&amp;A&gt;  </c:calendar-description>
            </d:prop>
            <d:status>HTTP/1.1 200 OK</d:status>
          </d:propstat>
        </d:response>
      `),
    );
    const result = await new CalDavDiscoveryClient(
      'https://radicale.example.test/',
      credentialProvider,
      readFetch,
    ).discover();

    expect(result.calendars[0]).toMatchObject({
      href: 'https://radicale.example.test/alice/team/',
      displayName: 'Team calendar',
      description,
    });
  });

  it('removes calendar-description when the submitted description is empty', async () => {
    const fetchMock = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValue(
        new Response(
          multistatus(`
            <d:response>
              <d:href>/alice/team/</d:href>
              <d:propstat>
                <d:prop><c:calendar-description/></d:prop>
                <d:status>HTTP/1.1 200 OK</d:status>
              </d:propstat>
            </d:response>
          `),
          { status: 207 },
        ),
      );

    await new CalDavDiscoveryClient(
      'https://radicale.example.test/',
      credentialProvider,
      fetchMock,
    ).updateCalendarDescription(
      'https://radicale.example.test/alice/team/',
      '',
    );

    expect(fetchMock.mock.calls[0][1]?.body).toContain(
      '<D:remove><D:prop><C:calendar-description/></D:prop></D:remove>',
    );
    expect(fetchMock.mock.calls[0][1]?.body).not.toContain('<D:set>');
  });

  it('rejects a 207 response when calendar-description alone failed', async () => {
    const fetchMock = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValue(
        new Response(
          multistatus(`
            <d:response>
              <d:href>/alice/team/</d:href>
              <d:propstat>
                <d:prop><d:displayname/></d:prop>
                <d:status>HTTP/1.1 200 OK</d:status>
              </d:propstat>
              <d:propstat>
                <d:prop><c:calendar-description/></d:prop>
                <d:status>HTTP/1.1 403 Forbidden</d:status>
              </d:propstat>
            </d:response>
          `),
          { status: 207 },
        ),
      );

    await expect(
      new CalDavDiscoveryClient(
        'https://radicale.example.test/',
        credentialProvider,
        fetchMock,
      ).updateCalendarDescription(
        'https://radicale.example.test/alice/team/',
        'Updated description',
      ),
    ).rejects.toEqual(
      new CalDavDiscoveryError(
        'CalDAV PROPPATCH failed for calendar-description with status 403',
        403,
        'https://radicale.example.test/alice/team/',
      ),
    );
  });

  it('sets only calendar-color and escapes XML text', async () => {
    const fetchMock = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValue(
        new Response(
          multistatus(`
            <d:response>
              <d:href>/alice/team/</d:href>
              <d:propstat>
                <d:prop><a:calendar-color/></d:prop>
                <d:status>HTTP/1.1 200 OK</d:status>
              </d:propstat>
            </d:response>
          `),
          { status: 207 },
        ),
      );

    await expect(
      new CalDavDiscoveryClient(
        'https://radicale.example.test/',
        credentialProvider,
        fetchMock,
      ).updateCalendarColor(
        'https://radicale.example.test/alice/team/',
        '#Ab12cD',
      ),
    ).resolves.toBeUndefined();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://radicale.example.test/alice/team/');
    expect(init?.method).toBe('PROPPATCH');
    expect(new Headers(init?.headers).get('Authorization')).toBe(
      'Basic delegated',
    );
    expect(init?.body).toContain(
      '<A:calendar-color>#Ab12cD</A:calendar-color>',
    );
    expect(init?.body).not.toContain('calendar-description');
    expect(init?.body).not.toContain('displayname');
    expect(init?.body).not.toContain('timezone');
  });

  it('removes calendar-color on explicit clear and rejects other new values', async () => {
    const fetchMock = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValue(
        new Response(
          multistatus(`
            <d:response>
              <d:href>/alice/team/</d:href>
              <d:propstat>
                <d:prop><a:calendar-color/></d:prop>
                <d:status>HTTP/1.1 200 OK</d:status>
              </d:propstat>
            </d:response>
          `),
          { status: 207 },
        ),
      );
    const client = new CalDavDiscoveryClient(
      'https://radicale.example.test/',
      credentialProvider,
      fetchMock,
    );

    await client.updateCalendarColor(
      'https://radicale.example.test/alice/team/',
      '',
    );
    expect(fetchMock.mock.calls[0][1]?.body).toContain(
      '<D:remove><D:prop><A:calendar-color/></D:prop></D:remove>',
    );

    for (const color of ['red', '#12345678', '#12345G', ' #123456']) {
      await expect(
        client.updateCalendarColor(
          'https://radicale.example.test/alice/team/',
          color,
        ),
      ).rejects.toMatchObject({
        name: 'CalDavDiscoveryError',
        message: 'Calendar color must be a six-digit hex color',
      });
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('checks calendar-color property status in a 207 response', async () => {
    const fetchMock = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValue(
        new Response(
          multistatus(`
            <d:response>
              <d:href>/alice/team/</d:href>
              <d:propstat>
                <d:prop><d:displayname/></d:prop>
                <d:status>HTTP/1.1 200 OK</d:status>
              </d:propstat>
              <d:propstat>
                <d:prop><a:calendar-color/></d:prop>
                <d:status>HTTP/1.1 403 Forbidden</d:status>
              </d:propstat>
            </d:response>
          `),
          { status: 207 },
        ),
      );

    await expect(
      new CalDavDiscoveryClient(
        'https://radicale.example.test/',
        credentialProvider,
        fetchMock,
      ).updateCalendarColor(
        'https://radicale.example.test/alice/team/',
        '#123456',
      ),
    ).rejects.toEqual(
      new CalDavDiscoveryError(
        'CalDAV PROPPATCH failed for calendar-color with status 403',
        403,
        'https://radicale.example.test/alice/team/',
      ),
    );
  });

  it('matches the Apple calendar-color QName when other namespaces use the same local name', async () => {
    const fetchMock = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValue(
        new Response(
          multistatus(`
            <d:response>
              <d:propstat>
                <d:prop><x:calendar-color/></d:prop>
                <d:status>HTTP/1.1 200 OK</d:status>
              </d:propstat>
              <d:propstat>
                <d:prop><a:calendar-color/></d:prop>
                <d:status>HTTP/1.1 403 Forbidden</d:status>
              </d:propstat>
            </d:response>
          `),
          { status: 207 },
        ),
      );

    await expect(
      new CalDavDiscoveryClient(
        'https://radicale.example.test/',
        credentialProvider,
        fetchMock,
      ).updateCalendarColor(
        'https://radicale.example.test/alice/team/',
        '#123456',
      ),
    ).rejects.toEqual(
      new CalDavDiscoveryError(
        'CalDAV PROPPATCH failed for calendar-color with status 403',
        403,
        'https://radicale.example.test/alice/team/',
      ),
    );
  });

  it('deletes a calendar collection with delegated credentials', async () => {
    const fetchMock = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValue(new Response('', { status: 204 }));

    await expect(
      new CalDavDiscoveryClient(
        'https://radicale.example.test/',
        credentialProvider,
        fetchMock,
      ).deleteCalendar('https://radicale.example.test/alice/team/'),
    ).resolves.toBeUndefined();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://radicale.example.test/alice/team/');
    expect(init?.method).toBe('DELETE');
    expect(new Headers(init?.headers).get('Authorization')).toBe(
      'Basic delegated',
    );
  });

  it('fails with status and URL when DELETE is rejected', async () => {
    const fetchMock = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValue(new Response('Forbidden', { status: 403 }));

    await expect(
      new CalDavDiscoveryClient(
        'https://radicale.example.test/',
        credentialProvider,
        fetchMock,
      ).deleteCalendar('https://radicale.example.test/alice/team/'),
    ).rejects.toEqual(
      new CalDavDiscoveryError(
        'CalDAV DELETE failed with status 403',
        403,
        'https://radicale.example.test/alice/team/',
      ),
    );
  });

  it('rejects a DELETE multistatus because it reports member failures', async () => {
    const fetchMock = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValue(
        new Response(
          multistatus(`
            <d:response>
              <d:href>/alice/team/locked.ics</d:href>
              <d:status>HTTP/1.1 423 Locked</d:status>
            </d:response>
          `),
          { status: 207 },
        ),
      );

    await expect(
      new CalDavDiscoveryClient(
        'https://radicale.example.test/',
        credentialProvider,
        fetchMock,
      ).deleteCalendar('https://radicale.example.test/alice/team/'),
    ).rejects.toEqual(
      new CalDavDiscoveryError(
        'CalDAV DELETE reported member failures',
        207,
        'https://radicale.example.test/alice/team/',
      ),
    );
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
  xmlns:x="urn:example:other"
>
  ${body}
</${davPrefix}:multistatus>`;
}
