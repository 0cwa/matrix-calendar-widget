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

import {
  CalendarEvent,
  CalendarRepositoryError,
} from '@matrix-calendar-widget/calendar';
import { WidgetApi } from '@matrix-widget-toolkit/api';
import { describe, expect, it, vi } from 'vitest';
import { CalendarGatewayRepository } from './CalendarGatewayRepository';

const calendarId = 'https://radicale.example.test/alice/team/';
const eventId = 'https://radicale.example.test/alice/team/event.ics';

const event: CalendarEvent = {
  id: eventId,
  calendarId,
  uid: 'event@example.test',
  title: 'Planning',
  timing: {
    type: 'timed',
    start: {
      local: '2026-10-01T09:00:00',
      timezone: 'Europe/Stockholm',
    },
    end: {
      local: '2026-10-01T10:00:00',
      timezone: 'Europe/Stockholm',
    },
  },
};

describe('CalendarGatewayRepository', () => {
  it('lists calendars with Matrix OpenID authentication and room scope', async () => {
    const fetchMock = mockFetch(
      jsonResponse([
        {
          id: calendarId,
          name: 'Team',
          color: '#112233',
          readOnly: false,
        },
      ]),
    );
    const repository = createRepository(fetchMock);

    await expect(repository.listCalendars()).resolves.toEqual([
      {
        id: calendarId,
        name: 'Team',
        color: '#112233',
        timezone: undefined,
        readOnly: false,
      },
    ]);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'https://gateway.example.test/v1/calendar/calendars?roomId=%21team%3Aexample.test',
    );
    expect(new Headers(init?.headers).get('Authorization')).toMatch(
      /^MX-Identity /,
    );
  });

  it('queries each selected calendar for the visible range and remembers ETags', async () => {
    const secondCalendar = 'https://radicale.example.test/alice/other/';
    const fetchMock = mockFetch(
      jsonResponse([{ event, etag: '"one"' }]),
      jsonResponse([
        {
          event: {
            ...event,
            id: `${secondCalendar}other.ics`,
            calendarId: secondCalendar,
            uid: 'other@example.test',
          },
          etag: '"two"',
        },
      ]),
      jsonResponse({ event: { ...event, title: 'Updated' }, etag: '"next"' }),
    );
    const repository = createRepository(fetchMock);

    const events = await repository.listEvents([calendarId, secondCalendar], {
      start: '2026-10-01T00:00:00Z',
      end: '2026-10-02T00:00:00Z',
    });

    expect(events).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      'start=2026-10-01T00%3A00%3A00Z',
    );

    await repository.updateEvent(calendarId, eventId, { title: 'Updated' });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(
      new Headers(fetchMock.mock.calls[2][1]?.headers).get('If-Match'),
    ).toBe('"one"');
  });

  it('refreshes the ETag after a conflict so retry can use the latest resource', async () => {
    const fetchMock = mockFetch(
      jsonResponse({ event, etag: '"old"' }),
      jsonResponse(
        { code: 'etag-conflict', message: 'The event changed' },
        409,
      ),
      jsonResponse({ event, etag: '"fresh"' }),
      jsonResponse({ event: { ...event, title: 'Mine' }, etag: '"new"' }),
    );
    const repository = createRepository(fetchMock);

    await expect(
      repository.updateEvent(calendarId, eventId, { title: 'Mine' }),
    ).rejects.toMatchObject({
      code: 'etag-conflict',
    });

    await expect(
      repository.updateEvent(calendarId, eventId, { title: 'Mine' }),
    ).resolves.toMatchObject({ title: 'Mine' });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(
      new Headers(fetchMock.mock.calls[3][1]?.headers).get('If-Match'),
    ).toBe('"fresh"');
  });

  it('maps gateway authorization failures to repository errors', async () => {
    const fetchMock = mockFetch(
      jsonResponse({ message: 'OpenID required' }, 401),
    );
    const repository = createRepository(fetchMock);

    const request = repository.listCalendars();
    await expect(request).rejects.toBeInstanceOf(CalendarRepositoryError);
    await expect(request).rejects.toMatchObject({
      code: 'gateway-auth-failed',
    });
  });

  it('fails before fetching when the widget has no room context', async () => {
    const fetchMock = mockFetch();
    const repository = createRepository(fetchMock, undefined);

    await expect(repository.listCalendars()).rejects.toMatchObject({
      code: 'gateway-request-failed',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

function createRepository(
  fetchImpl: typeof fetch,
  roomId: string | undefined = '!team:example.test',
): CalendarGatewayRepository {
  const widgetApi = {
    widgetParameters: { roomId },
    requestOpenIDConnectToken: vi.fn().mockResolvedValue({
      matrix_server_name: 'example.test',
      access_token: 'openid-token',
    }),
  } as unknown as WidgetApi;

  return new CalendarGatewayRepository({
    widgetApiPromise: Promise.resolve(widgetApi),
    baseUrl: 'https://gateway.example.test',
    fetchImpl,
  });
}

function mockFetch(...responses: Response[]): typeof fetch {
  return vi.fn(async () => responses.shift()!) as unknown as typeof fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
