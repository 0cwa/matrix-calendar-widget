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
      type: 'zoned',
      local: '2026-09-24T08:00:00',
      timezone: 'UTC',
    },
    end: {
      type: 'zoned',
      local: '2026-09-24T09:00:00',
      timezone: 'UTC',
    },
  },
};

describe('GatewayCalendarRepository', () => {
  it('binds the default fetch implementation to the global receiver', async () => {
    const originalFetch = globalThis.fetch;
    const roomId = '!team:example.test';
    const defaultFetch = vi.fn(function (this: unknown): Promise<Response> {
      expect(this).toBe(globalThis);
      return Promise.resolve(
        jsonResponse({
          roomId,
          roomCalendar: {
            calendarId,
            canReadEvents: true,
            canWriteEvents: true,
            canManageReminders: false,
          },
        }),
      );
    }) as typeof fetch;
    vi.stubGlobal('fetch', defaultFetch);

    try {
      const repository = new GatewayCalendarRepository({
        baseUrl: 'https://widget-api.example.test',
        roomId,
        getAuthorizationHeader: async () => 'MX-Identity delegated',
      });

      await expect(repository.getRoomCalendarCapabilities()).resolves.toEqual({
        calendarId,
        roomId,
        canReadEvents: true,
        canWriteEvents: true,
        canManageReminders: false,
      });
      expect(defaultFetch).toHaveBeenCalledTimes(1);
    } finally {
      vi.stubGlobal('fetch', originalFetch);
    }
  });

  it('uses the server-authorized room ID from the matching context response', async () => {
    const roomId = '!team:example.test';
    const fetchMock = mockFetch(
      jsonResponse({
        userId: '@alice:example.test',
        roomId,
        roomCalendar: {
          calendarId,
          canReadEvents: true,
          canWriteEvents: true,
          canManageReminders: false,
        },
      }),
    );
    const repository = new GatewayCalendarRepository({
      baseUrl: 'https://widget-api.example.test',
      roomId,
      getAuthorizationHeader: async () => 'MX-Identity delegated',
      fetchImpl: fetchMock,
    });

    await expect(repository.getRoomCalendarCapabilities()).resolves.toEqual({
      calendarId,
      roomId,
      canReadEvents: true,
      canWriteEvents: true,
      canManageReminders: false,
    });
    expect(
      new URL(fetchMock.mock.calls[0][0] as string).searchParams.get('roomId'),
    ).toBe(roomId);
  });

  it('rejects a server context that names a different room', async () => {
    const fetchMock = mockFetch(
      jsonResponse({
        roomId: '!other:example.test',
        roomCalendar: {
          calendarId,
          canReadEvents: true,
          canWriteEvents: true,
          canManageReminders: false,
        },
      }),
    );
    const repository = new GatewayCalendarRepository({
      baseUrl: 'https://widget-api.example.test',
      roomId: '!team:example.test',
      getAuthorizationHeader: async () => 'MX-Identity delegated',
      fetchImpl: fetchMock,
    });

    await expect(
      repository.getRoomCalendarCapabilities(),
    ).rejects.toMatchObject({ code: 'request-failed' });
  });

  it('loads safe calendar diagnostics through the authenticated gateway', async () => {
    const diagnostics = {
      calendars: [
        {
          name: 'Team calendar',
          url: 'https://radicale.example.test/alice/team/',
        },
      ],
    };
    const fetchMock = mockFetch(jsonResponse(diagnostics));
    const repository = createRepository(fetchMock);

    await expect(repository.getCalendarDiagnostics()).resolves.toEqual(
      diagnostics,
    );

    const [url, init] = fetchMock.mock.calls[0];
    expect(typeof url).toBe('string');
    if (typeof url !== 'string') {
      throw new Error('Expected the gateway request URL to be a string');
    }
    expect(new URL(url).pathname).toBe('/v1/calendar/calendars/diagnostics');
    expect(new URL(url).searchParams.get('roomId')).toBe('!team:example.test');
    expect(new Headers(init?.headers).get('Authorization')).toBe(
      'MX-Identity delegated',
    );
  });

  it('returns supported component metadata from the gateway DTO', async () => {
    const calendars = [
      {
        id: calendarId,
        name: 'Team calendar',
        description: 'Planning and review',
        readOnly: false,
        supportedComponents: ['VEVENT', 'VTODO'],
      },
    ];
    const repository = createRepository(mockFetch(jsonResponse(calendars)));

    await expect(repository.listCalendars()).resolves.toEqual([
      {
        ...calendars[0],
        id: publicCalendarId('personal', calendarId),
      },
    ]);
  });

  it('keeps room and personal resources separately namespaced and scoped', async () => {
    const roomCalendar = {
      id: calendarId,
      name: 'Room calendar',
      readOnly: false,
      supportedComponents: ['VEVENT'],
      operatorManaged: true,
    };
    const personalCalendar = {
      id: calendarId,
      name: 'Personal collection',
      readOnly: false,
      supportedComponents: ['VEVENT'],
    };
    const roomEvent = { ...event, title: 'Room planning' };
    const fetchMock = mockFetch(
      jsonResponse([personalCalendar]),
      jsonResponse([roomCalendar]),
      jsonResponse({
        events: [{ event, etag: '"personal-etag"' }],
        diagnostics: [],
      }),
      jsonResponse({
        events: [{ event: roomEvent, etag: '"room-etag"' }],
        diagnostics: [],
      }),
      jsonResponse({
        event: { ...roomEvent, title: 'Updated room planning' },
        etag: '"updated-room-etag"',
      }),
    );
    const repository = createRepository(fetchMock, 'UTC', () => ({
      calendarId,
      canReadEvents: true,
      canWriteEvents: true,
      canManageReminders: false,
    }));
    const calendarResult = await repository.listCalendarsWithAvailability();
    const personalPublicId = publicCalendarId('personal', calendarId);
    const roomPublicId = publicCalendarId('room', calendarId);

    expect(calendarResult).toEqual({
      calendars: [
        { ...personalCalendar, id: personalPublicId },
        { ...roomCalendar, id: roomPublicId, operatorManaged: true },
      ],
      partialAvailability: false,
      canManageCalendarCollections: true,
      roomCapabilities: {
        calendarId,
        canReadEvents: true,
        canWriteEvents: true,
        canManageReminders: false,
      },
    });

    const listedEvents = await repository.listEventsWithAvailability(
      [personalPublicId, roomPublicId],
      {
        start: '2026-09-24T00:00:00Z',
        end: '2026-09-25T00:00:00Z',
      },
    );
    expect(listedEvents.events).toEqual([
      {
        ...event,
        id: publicEventId('personal', calendarId, eventId),
        calendarId: personalPublicId,
      },
      {
        ...roomEvent,
        id: publicEventId('room', calendarId, eventId),
        calendarId: roomPublicId,
      },
    ]);

    await repository.updateEvent(
      roomPublicId,
      publicEventId('room', calendarId, eventId),
      { title: 'Updated room planning' },
    );
    const updateUrl = new URL(fetchMock.mock.calls[4][0] as string);
    expect(updateUrl.searchParams.get('target')).toBe('room');
    expect(updateUrl.searchParams.get('calendarId')).toBe(calendarId);
    expect(updateUrl.searchParams.get('eventId')).toBe(eventId);
    expect(
      new Headers(fetchMock.mock.calls[4][1]?.headers).get('If-Match'),
    ).toBe('"room-etag"');

    await expect(
      repository.renameCalendar(roomPublicId, 'renamed'),
    ).rejects.toMatchObject({
      code: 'request-failed',
    });
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('keeps the available room calendar when personal listing fails', async () => {
    const fetchMock = mockFetch(
      new Response('', { status: 503 }),
      jsonResponse([
        {
          id: calendarId,
          name: 'Room calendar',
          readOnly: false,
          supportedComponents: ['VEVENT'],
        },
      ]),
    );
    const repository = createRepository(fetchMock, 'UTC', () => ({
      calendarId,
      canReadEvents: true,
      canWriteEvents: true,
      canManageReminders: false,
    }));

    await expect(
      repository.listCalendarsWithAvailability(),
    ).resolves.toMatchObject({
      calendars: [
        {
          id: publicCalendarId('room', calendarId),
          operatorManaged: true,
        },
      ],
      partialAvailability: true,
      canManageCalendarCollections: false,
    });
    expect(
      new URL(fetchMock.mock.calls[0][0] as string).searchParams.get('target'),
    ).toBe('personal');
    expect(
      new URL(fetchMock.mock.calls[1][0] as string).searchParams.get('target'),
    ).toBe('room');
  });

  it('keeps personal events when the optional room event request fails', async () => {
    const fetchMock = mockFetch(
      jsonResponse([{ id: calendarId, name: 'Personal' }]),
      jsonResponse([
        {
          id: calendarId,
          name: 'Room calendar',
          readOnly: false,
          supportedComponents: ['VEVENT'],
        },
      ]),
      jsonResponse({
        events: [{ event, etag: '"personal-etag"' }],
        diagnostics: [],
      }),
      new Response('', { status: 503 }),
    );
    const repository = createRepository(fetchMock, 'UTC', () => ({
      calendarId,
      canReadEvents: true,
      canWriteEvents: true,
      canManageReminders: false,
    }));
    const { calendars } = await repository.listCalendarsWithAvailability();
    const result = await repository.listEventsWithAvailability(
      calendars.map(({ id }) => id),
      {
        start: '2026-09-24T00:00:00Z',
        end: '2026-09-25T00:00:00Z',
      },
    );

    expect(result).toMatchObject({
      events: [{ id: publicEventId('personal', calendarId, eventId) }],
      partialAvailability: true,
    });
    expect(
      new URL(fetchMock.mock.calls[3][0] as string).searchParams.get('target'),
    ).toBe('room');
  });

  it('uses the authenticated room reminder API with opaque identities only', async () => {
    const option = {
      eventUid: event.uid,
      recurrenceId: null,
      alarmUid: 'alarm-stable-1',
      relatedTo: 'start' as const,
      trigger: {
        weeks: 0,
        days: 0,
        hours: 0,
        minutes: 15,
        seconds: 0,
        isNegative: true,
      },
      repeat: {
        count: 2,
        interval: {
          weeks: 0,
          days: 0,
          hours: 0,
          minutes: 5,
          seconds: 0,
          isNegative: false,
        },
      },
    };
    const identity = {
      eventUid: event.uid,
      recurrenceId: null,
      alarmUid: option.alarmUid,
    };
    const fetchMock = mockFetch(
      jsonResponse([]),
      jsonResponse([{ id: calendarId, name: 'Room calendar' }]),
      jsonResponse({
        events: [
          {
            event: {
              ...event,
              alarm: {
                action: 'display',
                uid: option.alarmUid,
                trigger: {
                  weeks: 0,
                  days: 0,
                  hours: 0,
                  minutes: 15,
                  seconds: 0,
                },
              },
            },
            etag: '"room-etag"',
          },
        ],
        diagnostics: [],
      }),
      jsonResponse({ options: [option] }),
      jsonResponse({ items: [] }),
      jsonResponse(identity),
      jsonResponse({ deleted: true }),
    );
    const repository = createRepository(fetchMock, 'UTC', () => ({
      calendarId,
      canReadEvents: true,
      canWriteEvents: true,
      canManageReminders: true,
    }));
    const { calendars } = await repository.listCalendarsWithAvailability();
    const roomCalendarId = calendars[0].id;
    const { events } = await repository.listEventsWithAvailability(
      [roomCalendarId],
      { start: '2026-09-24T00:00:00Z', end: '2026-09-25T00:00:00Z' },
    );
    const publicEvent = events[0];

    await expect(
      repository.listRoomReminderAlarmOptions(roomCalendarId, publicEvent.id),
    ).resolves.toEqual([option]);
    await expect(repository.listRoomReminderConfigurations()).resolves.toEqual(
      [],
    );
    await expect(
      repository.enableRoomReminder(
        roomCalendarId,
        publicEvent.id,
        option.alarmUid,
        null,
      ),
    ).resolves.toEqual(identity);
    await expect(
      repository.disableRoomReminder(identity),
    ).resolves.toBeUndefined();

    const optionsUrl = new URL(fetchMock.mock.calls[3][0] as string);
    expect(optionsUrl.pathname).toBe(
      '/v1/calendar/rooms/%21team%3Aexample.test/reminders/options',
    );
    expect(optionsUrl.searchParams.get('eventId')).toBe(eventId);
    expect(fetchMock.mock.calls[3][1]?.cache).toBe('no-store');
    const settingsGetUrl = new URL(fetchMock.mock.calls[4][0] as string);
    expect(settingsGetUrl.pathname).toBe(
      '/v1/calendar/rooms/%21team%3Aexample.test/reminders',
    );
    expect(settingsGetUrl.searchParams.get('limit')).toBe('100');
    expect(fetchMock.mock.calls[4][1]?.cache).toBe('no-store');
    const [putUrl, putInit] = fetchMock.mock.calls[5];
    expect(new URL(putUrl as string).pathname).toBe(settingsGetUrl.pathname);
    expect(putInit?.method).toBe('PUT');
    expect(putInit?.body).toBe(
      JSON.stringify({
        eventId,
        recurrenceId: null,
        alarmUid: option.alarmUid,
      }),
    );
    const [deleteUrl, deleteInit] = fetchMock.mock.calls[6];
    expect(new URL(deleteUrl as string).pathname).toBe(settingsGetUrl.pathname);
    expect(deleteInit?.method).toBe('DELETE');
    expect(deleteInit?.body).toBe(JSON.stringify(identity));
    expect(fetchMock).toHaveBeenCalledTimes(7);
  });

  it('creates a calendar through the authenticated gateway', async () => {
    const createdCalendar = {
      id: 'https://radicale.example.test/alice/calendar-1/',
      name: 'Project Alpha',
      readOnly: false,
    };
    const fetchMock = mockFetch(jsonResponse(createdCalendar));
    const repository = createRepository(fetchMock);

    await expect(repository.createCalendar('Project Alpha')).resolves.toEqual({
      ...createdCalendar,
      id: publicCalendarId('personal', createdCalendar.id),
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/v1/calendar/calendars?');
    if (typeof url !== 'string') {
      throw new Error('Expected the gateway request URL to be a string');
    }
    expect(new URL(url).searchParams.get('roomId')).toBe('!team:example.test');
    expect(new URL(url).searchParams.get('target')).toBe('personal');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('Authorization')).toBe(
      'MX-Identity delegated',
    );
    expect(new Headers(init?.headers).get('Content-Type')).toBe(
      'application/json',
    );
    expect(init?.body).toBe(JSON.stringify({ name: 'Project Alpha' }));
  });

  it('renames a calendar through the authenticated gateway', async () => {
    const fetchMock = mockFetch(new Response(null, { status: 204 }));
    const repository = createRepository(fetchMock);

    await expect(
      repository.renameCalendar(calendarId, 'Product calendar'),
    ).resolves.toBeUndefined();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/v1/calendar/calendars?');
    expect(url).toContain(`calendarId=${encodeURIComponent(calendarId)}`);
    expect(init?.method).toBe('PATCH');
    expect(new Headers(init?.headers).get('Authorization')).toBe(
      'MX-Identity delegated',
    );
    expect(init?.body).toBe(JSON.stringify({ name: 'Product calendar' }));
  });

  it('sends description-only updates through the authenticated gateway', async () => {
    const fetchMock = mockFetch(new Response(null, { status: 204 }));
    const repository = createRepository(fetchMock);

    await expect(
      repository.updateCalendarDescription(calendarId, 'Project planning'),
    ).resolves.toBeUndefined();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/v1/calendar/calendars/description?');
    expect(url).toContain(`calendarId=${encodeURIComponent(calendarId)}`);
    expect(init?.method).toBe('PATCH');
    expect(new Headers(init?.headers).get('Authorization')).toBe(
      'MX-Identity delegated',
    );
    expect(init?.body).toBe(
      JSON.stringify({ description: 'Project planning' }),
    );
  });

  it('sends an empty description to clear the calendar property', async () => {
    const fetchMock = mockFetch(new Response(null, { status: 204 }));
    const repository = createRepository(fetchMock);

    await repository.updateCalendarDescription(calendarId, '');

    expect(fetchMock.mock.calls[0][1]?.body).toBe(
      JSON.stringify({ description: '' }),
    );
  });

  it('sends color-only updates through the authenticated gateway', async () => {
    const fetchMock = mockFetch(new Response(null, { status: 204 }));
    const repository = createRepository(fetchMock);

    await expect(
      repository.updateCalendarColor(calendarId, '#Ab12cD'),
    ).resolves.toBeUndefined();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/v1/calendar/calendars/color?');
    expect(url).toContain(`calendarId=${encodeURIComponent(calendarId)}`);
    expect(init?.method).toBe('PATCH');
    expect(new Headers(init?.headers).get('Authorization')).toBe(
      'MX-Identity delegated',
    );
    expect(init?.body).toBe(JSON.stringify({ color: '#Ab12cD' }));
  });

  it('sends an empty color as an explicit clear', async () => {
    const fetchMock = mockFetch(new Response(null, { status: 204 }));
    const repository = createRepository(fetchMock);

    await repository.updateCalendarColor(calendarId, '');

    expect(fetchMock.mock.calls[0][1]?.body).toBe(
      JSON.stringify({ color: '' }),
    );
  });

  it('deletes a calendar through the authenticated gateway', async () => {
    const fetchMock = mockFetch(new Response(null, { status: 204 }));
    const repository = createRepository(fetchMock);

    await expect(
      repository.deleteCalendar(calendarId),
    ).resolves.toBeUndefined();

    const [url, init] = fetchMock.mock.calls[0];
    if (typeof url !== 'string') {
      throw new Error('Expected the gateway request URL to be a string');
    }
    const requestUrl = new URL(url);
    expect(requestUrl.pathname).toBe('/v1/calendar/calendars');
    expect(requestUrl.searchParams.get('roomId')).toBe('!team:example.test');
    expect(requestUrl.searchParams.get('calendarId')).toBe(calendarId);
    expect(init?.method).toBe('DELETE');
    expect(new Headers(init?.headers).get('Authorization')).toBe(
      'MX-Identity delegated',
    );
  });

  it('does not expose calendar deletion conflicts as event conflicts', async () => {
    const repository = createRepository(
      mockFetch(
        new Response(JSON.stringify({ code: 'calendar-delete-unsafe' }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    await expect(repository.deleteCalendar(calendarId)).rejects.toMatchObject({
      code: 'request-failed',
      message: 'Calendar deletion was rejected by the gateway',
    });
  });

  it('loads visible events and reuses their ETag for updates', async () => {
    const fetchMock = mockFetch(
      jsonResponse({
        events: [{ event, etag: '"event-etag"' }],
        diagnostics: [],
      }),
      jsonResponse({
        event: { ...event, recurrence: { rrule: 'FREQ=WEEKLY;COUNT=4' } },
        etag: '"updated-etag"',
      }),
    );
    const repository = createRepository(fetchMock, 'Europe/Stockholm');

    await expect(
      repository.listEvents([calendarId], {
        start: '2026-09-24T00:00:00Z',
        end: '2026-09-25T00:00:00Z',
      }),
    ).resolves.toEqual([
      { ...event, id: publicEventId('personal', calendarId, eventId) },
    ]);

    const recurrencePatch = {
      recurrence: { rrule: 'FREQ=WEEKLY;COUNT=4' },
    };
    await expect(
      repository.updateEvent(calendarId, eventId, recurrencePatch),
    ).resolves.toMatchObject({ recurrence: recurrencePatch.recurrence });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toContain('/v1/calendar/events?');
    expect(
      new URL(fetchMock.mock.calls[0][0] as string).searchParams.get('target'),
    ).toBe('personal');
    expect(fetchMock.mock.calls[0][0]).toContain(
      `calendarId=${encodeURIComponent(calendarId)}`,
    );
    expect(
      new URL(fetchMock.mock.calls[0][0] as string).searchParams.get(
        'timezone',
      ),
    ).toBe('Europe/Stockholm');

    const [, updateInit] = fetchMock.mock.calls[1];
    expect(updateInit?.method).toBe('PATCH');
    expect(new Headers(updateInit?.headers).get('If-Match')).toBe(
      '"event-etag"',
    );
    expect(new Headers(updateInit?.headers).get('Authorization')).toBe(
      'MX-Identity delegated',
    );
    expect(updateInit?.body).toBe(JSON.stringify(recurrencePatch));
  });

  it('serializes one typed point RDATE and preserves the loaded ETag', async () => {
    const recurringEvent: CalendarEvent = {
      ...event,
      recurrence: { rrule: 'FREQ=WEEKLY;COUNT=4' },
    };
    const fetchMock = mockFetch(
      jsonResponse({ event: recurringEvent, etag: '"rdate-etag"' }),
      jsonResponse({
        event: {
          ...recurringEvent,
          recurrence: {
            ...recurringEvent.recurrence,
            rdates: [
              {
                type: 'date-time',
                value: {
                  local: '2026-10-30T09:00:00',
                  timezone: 'America/New_York',
                },
              },
            ],
          },
        },
        etag: '"updated-rdate-etag"',
      }),
    );
    const repository = createRepository(fetchMock);
    const rdatePatch = {
      recurrence: {
        rdate: {
          action: 'add' as const,
          value: {
            type: 'date-time' as const,
            value: {
              local: '2026-10-30T09:00:00',
              timezone: 'America/New_York',
            },
          },
        },
      },
    };

    await expect(
      repository.updateEvent(calendarId, eventId, rdatePatch),
    ).resolves.toMatchObject({
      id: publicEventId('personal', calendarId, eventId),
      recurrence: { rdates: [rdatePatch.recurrence.rdate.value] },
    });

    const [, updateInit] = fetchMock.mock.calls[1];
    expect(updateInit?.method).toBe('PATCH');
    expect(new Headers(updateInit?.headers).get('If-Match')).toBe(
      '"rdate-etag"',
    );
    expect(updateInit?.body).toBe(JSON.stringify(rdatePatch));
  });

  it('passes count-only projection diagnostics through from the gateway', async () => {
    const repository = createRepository(
      mockFetch(
        jsonResponse({
          events: [],
          diagnostics: [{ reason: 'range-this-and-future', count: 1 }],
        }),
      ),
    );

    await expect(
      repository.listEventsWithDiagnostics([calendarId], {
        start: '2026-09-24T00:00:00Z',
        end: '2026-10-01T00:00:00Z',
      }),
    ).resolves.toEqual({
      events: [],
      diagnostics: [
        {
          calendarId,
          reason: 'range-this-and-future',
          count: 1,
        },
      ],
    });
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
      new URL(fetchMock.mock.calls[0][0] as string).searchParams.get('target'),
    ).toBe('personal');
    expect(
      new Headers(fetchMock.mock.calls[1][1]?.headers).get('If-Match'),
    ).toBe('"fresh-etag"');
  });

  it('serializes the explicit alarm removal operation through the gateway', async () => {
    const eventWithAlarm: CalendarEvent = {
      ...event,
      alarm: {
        action: 'display',
        trigger: { weeks: 0, days: 0, hours: 0, minutes: 15, seconds: 0 },
      },
    };
    const fetchMock = mockFetch(
      jsonResponse({ event: eventWithAlarm, etag: '"old-etag"' }),
      jsonResponse({ event, etag: '"new-etag"' }),
    );
    const repository = createRepository(fetchMock);

    await expect(
      repository.updateEvent(calendarId, eventId, {
        alarm: { operation: 'remove' },
      }),
    ).resolves.toMatchObject({
      id: publicEventId('personal', calendarId, eventId),
      title: event.title,
    });

    const requestBody = fetchMock.mock.calls[1][1]?.body;
    expect(requestBody).toBe(
      JSON.stringify({ alarm: { operation: 'remove' } }),
    );
    expect(JSON.parse(requestBody as string)).toEqual({
      alarm: { operation: 'remove' },
    });
  });

  it('clears a stale ETag after conflict so a retry reloads current state', async () => {
    const fetchMock = mockFetch(
      jsonResponse({
        events: [{ event, etag: '"stale-etag"' }],
        diagnostics: [],
      }),
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

  it('retains safe occurrence preflight messages from the gateway', async () => {
    const failedRepository = createRepository(
      mockFetch(
        new Response(
          JSON.stringify({
            code: 'unsupported-patch',
            message:
              'Occurrence timing edits are unavailable for recurrence resources with VALARM data; alarms are preserved unchanged.',
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

    await expect(failedRepository.getCalendarDiagnostics()).rejects.toEqual(
      new CalendarRepositoryError(
        'unsupported-patch',
        'Occurrence timing edits are unavailable for recurrence resources with VALARM data; alarms are preserved unchanged.',
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
    ).resolves.toEqual({
      ...created,
      id: publicEventId('personal', calendarId, created.id),
    });

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

function createRepository(
  fetchImpl: typeof fetch,
  timezone = 'UTC',
  getRoomCalendarCapabilities:
    | (() =>
        | {
            calendarId: string;
            canReadEvents: boolean;
            canWriteEvents: boolean;
            canManageReminders: boolean;
          }
        | undefined)
    | undefined = undefined,
): GatewayCalendarRepository {
  return new GatewayCalendarRepository({
    baseUrl: 'https://widget-api.example.test',
    roomId: '!team:example.test',
    getAuthorizationHeader: async () => 'MX-Identity delegated',
    getViewerTimezone: () => timezone,
    getRoomCalendarCapabilities: async () => getRoomCalendarCapabilities?.(),
    fetchImpl,
  });
}

function publicCalendarId(target: 'personal' | 'room', id: string): string {
  return `matrix-calendar-target://${target}/${encodeURIComponent(id)}`;
}

function publicEventId(
  target: 'personal' | 'room',
  calendarId: string,
  eventId: string,
): string {
  return `matrix-calendar-event://${target}/${encodeURIComponent(calendarId)}/${encodeURIComponent(eventId)}`;
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
