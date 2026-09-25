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
import { vi } from 'vitest';
import { GatewayCalendarRepository } from './GatewayCalendarRepository';

const calendarId = 'https://radicale.example.test/alice/team/';
const eventId = 'https://radicale.example.test/alice/team/event.ics';
const event: CalendarEvent = {
  id: eventId,
  calendarId,
  uid: 'event@example.test',
  title: 'Team planning',
  timing: {
    type: 'timed',
    start: {
      local: '2026-09-24T08:00:00',
      timezone: 'UTC',
    },
    end: {
      local: '2026-09-24T09:00:00',
      timezone: 'UTC',
    },
  },
};

describe('GatewayCalendarRepository', () => {
  it('creates a calendar through the authenticated gateway', async () => {
    const createdCalendar = {
      id: 'https://radicale.example.test/alice/calendar-1/',
      name: 'Project Alpha',
      readOnly: false,
    };
    const fetchMock = mockFetch(jsonResponse(createdCalendar));
    const repository = createRepository(fetchMock);

    await expect(repository.createCalendar('Project Alpha')).resolves.toEqual(
      createdCalendar,
    );

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/v1/calendar/calendars?');
    expect(new URL(url).searchParams.get('roomId')).toBe('!team:example.test');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('Authorization')).toBe(
      'MX-Identity delegated',
    );
    expect(new Headers(init?.headers).get('Content-Type')).toBe(
      'application/json',
    );
    expect(init?.body).toBe(JSON.stringify({ name: 'Project Alpha' }));
  });

  it('loads visible events and reuses their ETag for updates', async () => {
    const fetchMock = mockFetch(
      jsonResponse([{ event, etag: '"event-etag"' }]),
      jsonResponse({
        event: { ...event, title: 'Updated' },
        etag: '"updated-etag"',
      }),
    );
    const repository = createRepository(fetchMock);

    await expect(
      repository.listEvents([calendarId], {
        start: '2026-09-24T00:00:00Z',
        end: '2026-09-25T00:00:00Z',
      }),
    ).resolves.toEqual([event]);

    await expect(
      repository.updateEvent(calendarId, eventId, { title: 'Updated' }),
    ).resolves.toMatchObject({ title: 'Updated' });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toContain('/v1/calendar/events?');
    expect(fetchMock.mock.calls[0][0]).toContain(
      `calendarId=${encodeURIComponent(calendarId)}`,
    );

    const [, updateInit] = fetchMock.mock.calls[1];
    expect(updateInit?.method).toBe('PATCH');
    expect(new Headers(updateInit?.headers).get('If-Match')).toBe(
      '"event-etag"',
    );
    expect(new Headers(updateInit?.headers).get('Authorization')).toBe(
      'MX-Identity delegated',
    );
  });

  it('fetches an ETag before a mutation when the event was not loaded', async () => {
    const fetchMock = mockFetch(
      jsonResponse({ event, etag: '"fresh-etag"' }),
      jsonResponse({
        event: { ...event, title: 'Updated' },
        etag: '"updated-etag"',
      }),
    );
    const repository = createRepository(fetchMock);

    await repository.updateEvent(calendarId, eventId, { title: 'Updated' });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toContain('/v1/calendar/event?');
    expect(
      new Headers(fetchMock.mock.calls[1][1]?.headers).get('If-Match'),
    ).toBe('"fresh-etag"');
  });

  it('clears a stale ETag after conflict so a retry reloads current state', async () => {
    const fetchMock = mockFetch(
      jsonResponse([{ event, etag: '"stale-etag"' }]),
      new Response('', { status: 409 }),
      jsonResponse({ event, etag: '"fresh-etag"' }),
      jsonResponse({
        event: { ...event, title: 'Retry' },
        etag: '"retry-etag"',
      }),
    );
    const repository = createRepository(fetchMock);

    await repository.listEvents([calendarId], {
      start: '2026-09-24T00:00:00Z',
      end: '2026-09-25T00:00:00Z',
    });

    await expect(
      repository.updateEvent(calendarId, eventId, { title: 'Conflict' }),
    ).rejects.toMatchObject({ code: 'event-conflict' });

    await expect(
      repository.updateEvent(calendarId, eventId, { title: 'Retry' }),
    ).resolves.toMatchObject({ title: 'Retry' });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[2][0]).toContain('/v1/calendar/event?');
    expect(
      new Headers(fetchMock.mock.calls[3][1]?.headers).get('If-Match'),
    ).toBe('"fresh-etag"');
  });

  it('maps a gateway authentication failure to the repository contract', async () => {
    const repository = createRepository(
      mockFetch(new Response('', { status: 401 })),
    );

    await expect(repository.listCalendars()).rejects.toEqual(
      new CalendarRepositoryError(
        'authentication-required',
        'Calendar gateway authentication is required',
      ),
    );
  });

  it('creates and deletes through the gateway', async () => {
    const created = {
      ...event,
      id: 'https://radicale.example.test/alice/team/new.ics',
      uid: 'new@example.test',
      title: 'New event',
    };
    const fetchMock = mockFetch(
      jsonResponse({ event: created, etag: '"created-etag"' }),
      new Response(null, { status: 204 }),
    );
    const repository = createRepository(fetchMock);

    await expect(
      repository.createEvent(calendarId, {
        uid: created.uid,
        title: created.title,
        timing: created.timing,
      }),
    ).resolves.toEqual(created);

    await expect(
      repository.deleteEvent(calendarId, created.id),
    ).resolves.toBeUndefined();

    expect(fetchMock.mock.calls[0][1]?.method).toBe('POST');
    expect(fetchMock.mock.calls[1][1]?.method).toBe('DELETE');
    expect(
      new Headers(fetchMock.mock.calls[1][1]?.headers).get('If-Match'),
    ).toBe('"created-etag"');
  });
});

function createRepository(fetchImpl: typeof fetch): GatewayCalendarRepository {
  return new GatewayCalendarRepository({
    baseUrl: 'https://widget-api.example.test',
    roomId: '!team:example.test',
    getAuthorizationHeader: async () => 'MX-Identity delegated',
    fetchImpl,
  });
}

function mockFetch(...responses: Response[]) {
  const mock = vi.fn<typeof fetch>();
  for (const response of responses) {
    mock.mockResolvedValueOnce(response);
  }
  return mock;
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
