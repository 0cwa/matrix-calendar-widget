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
  CalDavCalendarClient,
  CalDavCalendarError,
} from './CalDavCalendarClient';

describe('CalDavCalendarClient', () => {
  const credentialProvider: CalDavCredentialProvider = {
    getRequestHeaders: async () => ({ Authorization: 'Basic delegated' }),
  };

  it('creates a VEVENT-only calendar with an escaped display name', async () => {
    const fetchMock = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValue(new Response('', { status: 201 }));

    await new CalDavCalendarClient(credentialProvider, fetchMock).createCalendar(
      'https://radicale.example.test/alice/new-calendar/',
      { displayName: 'Team & planning <2027>' },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://radicale.example.test/alice/new-calendar/');
    expect(init?.method).toBe('MKCALENDAR');
    expect(new Headers(init?.headers).get('Authorization')).toBe(
      'Basic delegated',
    );
    expect(init?.body).toContain(
      '<D:displayname>Team &amp; planning &lt;2027&gt;</D:displayname>',
    );
    expect(init?.body).toContain('<C:comp name="VEVENT"/>');
    expect(init?.body).not.toContain('VTODO');
    expect(init?.body).not.toContain('VJOURNAL');
  });

  it('maps a rejected MKCALENDAR response to a structured error', async () => {
    const fetchMock = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValue(new Response('Conflict', { status: 409 }));

    await expect(
      new CalDavCalendarClient(credentialProvider, fetchMock).createCalendar(
        'https://radicale.example.test/alice/new-calendar/',
        { displayName: 'Team calendar' },
      ),
    ).rejects.toEqual(
      new CalDavCalendarError(
        'CalDAV MKCALENDAR failed with status 409',
        409,
        'https://radicale.example.test/alice/new-calendar/',
      ),
    );
  });
});
