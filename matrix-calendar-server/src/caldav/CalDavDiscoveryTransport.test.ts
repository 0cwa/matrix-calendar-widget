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

import { CalDavDiscoveryClient } from './CalDavDiscoveryClient';

describe('CalDAV collection transport boundaries', () => {
  const base = 'https://radicale.example.test/dav/';
  const collection = `${base}alice/calendar/`;
  const getRequestHeaders = jest.fn(async () => ({}));
  const fetchImpl = jest.fn<
    ReturnType<typeof fetch>,
    Parameters<typeof fetch>
  >();
  beforeEach(() => {
    getRequestHeaders.mockReset().mockResolvedValue({});
    fetchImpl.mockReset();
  });
  const client = () =>
    new CalDavDiscoveryClient(base, { getRequestHeaders }, fetchImpl);

  it.each(['.', '..', 'a'.repeat(256)])(
    'rejects a path-normalizing or oversized collection name before credentials',
    async (name) => {
      await expect(
        client().createCalendar('Calendar', name),
      ).rejects.toMatchObject({ name: 'CalDavDiscoveryError' });
      expect(getRequestHeaders).not.toHaveBeenCalled();
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );

  it.each([
    'https://other.example.test/calendar/',
    `${base}../outside/`,
    `${collection}?key=value`,
    `${collection}#fragment`,
  ])(
    'confines collection mutation before requesting credentials',
    async (url) => {
      await expect(client().deleteCalendar(url)).rejects.toMatchObject({
        name: 'CalDavDiscoveryError',
      });
      expect(getRequestHeaders).not.toHaveBeenCalled();
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );

  const mutations = [
    [
      'rename',
      (c: CalDavDiscoveryClient) => c.renameCalendar(collection, 'New name'),
    ],
    [
      'description',
      (c: CalDavDiscoveryClient) =>
        c.updateCalendarDescription(collection, 'New description'),
    ],
    [
      'color',
      (c: CalDavDiscoveryClient) =>
        c.updateCalendarColor(collection, '#112233'),
    ],
    ['delete', (c: CalDavDiscoveryClient) => c.deleteCalendar(collection)],
  ] as const;
  it.each(mutations)(
    'refuses a %s redirect without reading Location or content',
    async (_, operation) => {
      const cancel = jest.fn(async () => undefined);
      const text = jest.fn();
      const get = jest.fn(() => {
        throw new Error('private Location');
      });
      fetchImpl.mockResolvedValue({
        status: 307,
        ok: false,
        headers: { get },
        body: { cancel },
        text,
      } as unknown as Response);
      await expect(operation(client())).rejects.toMatchObject({
        message: 'CalDAV discovery request was redirected',
      });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(fetchImpl.mock.calls[0][1]?.redirect).toBe('manual');
      expect(get).not.toHaveBeenCalled();
      expect(text).not.toHaveBeenCalled();
      expect(cancel).toHaveBeenCalledTimes(1);
    },
  );

  it('bounds a successful PROPPATCH XML response before parsing', async () => {
    const getReader = jest.fn();
    const cancel = jest.fn(async () => undefined);
    fetchImpl.mockResolvedValue({
      status: 207,
      ok: true,
      headers: new Headers({ 'Content-Length': String(16 * 1024 * 1024 + 1) }),
      body: { getReader, cancel },
    } as unknown as Response);
    await expect(
      client().renameCalendar(collection, 'New name'),
    ).rejects.toMatchObject({
      message: 'CalDAV XML response could not be read within the size limit',
    });
    expect(getReader).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('rejects DTD input with a fixed error before XML entity expansion', async () => {
    fetchImpl.mockResolvedValue({
      status: 207,
      ok: true,
      headers: new Headers(),
      body: '<!DOCTYPE multistatus [<!ENTITY private "private peer data">]><multistatus>&private;</multistatus>',
    } as unknown as Response);
    await expect(client().discover()).rejects.toMatchObject({
      message: 'CalDAV XML response could not be read within the size limit',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('refuses an MKCALENDAR redirect after confined home discovery', async () => {
    const davResponse = (property: string, href: string): Response =>
      ({
        status: 207,
        ok: true,
        headers: new Headers(),
        body: `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:propstat><d:prop><${property}><d:href>${href}</d:href></${property}></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`,
      }) as unknown as Response;
    const cancel = jest.fn(async () => undefined);
    fetchImpl
      .mockResolvedValueOnce(
        davResponse('d:current-user-principal', '/dav/alice/'),
      )
      .mockResolvedValueOnce(davResponse('c:calendar-home-set', '/dav/alice/'))
      .mockResolvedValueOnce({
        status: 302,
        ok: false,
        body: { cancel },
      } as unknown as Response);
    await expect(
      client().createCalendar('Calendar', 'calendar'),
    ).rejects.toMatchObject({
      message: 'CalDAV discovery request was redirected',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls[2][1]).toMatchObject({
      method: 'MKCALENDAR',
      redirect: 'manual',
    });
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
