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

import type {
  CalendarEventFollowingTimingWrite,
  CalendarEventInput,
  CalendarEventPatch,
} from '@matrix-calendar-widget/calendar';
import fs from 'fs';
import path from 'path';
import { ICalendarEventCodec } from '../caldav';
import {
  AuthorizedRoomCalendarEventAccess,
  RoomCalendarEventOperationError,
  RoomCalendarEventOperations,
  RoomCalendarEventServicePrincipal,
} from './RoomCalendarEventOperations';

const calendarId = 'room-calendar';
const roomId = '!team:example.test';
const roomCalendarBindings = [{ roomId, calendarId }];
const collectionUrl =
  'https://radicale.example.test/caldav/_matrix_calendar_service/room-calendar/';
const serviceUserId = '@_matrix_calendar_service:example.test';
const serviceProof = 'appservice-openid-proof';
const mixedCalendar = fs.readFileSync(
  path.resolve(__dirname, '../../../fixtures/ical/mixed-components.ics'),
  'utf8',
);
const simpleCalendar = fs.readFileSync(
  path.resolve(__dirname, '../../../fixtures/ical/simple-timed.ics'),
  'utf8',
);

function absoluteAlarmAttachmentSource(): {
  alarm: {
    action: 'display';
    trigger: { type: 'absolute'; value: string };
  };
  attachmentUrl: string;
  source: string;
} {
  const attachmentUrl = 'https://files.example.test/agenda';
  const alarm = {
    action: 'display' as const,
    trigger: { type: 'absolute' as const, value: '2026-10-05T08:45:00Z' },
  };
  const source = simpleCalendar.replace(
    'END:VEVENT',
    [
      `ATTACH;VALUE=URI:${attachmentUrl}`,
      'BEGIN:VALARM',
      'UID:stable-alarm@example.test',
      'ACTION:DISPLAY',
      'DESCRIPTION:Keep this alarm description',
      'TRIGGER;VALUE=DATE-TIME:20261005T084500Z',
      'X-ALARM-METADATA:preserve-alarm-property',
      'END:VALARM',
      'END:VEVENT',
    ].join('\r\n'),
  );
  return { alarm, attachmentUrl, source };
}

describe('RoomCalendarEventOperations', () => {
  let fetchMock: jest.Mock<ReturnType<typeof fetch>, Parameters<typeof fetch>>;
  let operations: RoomCalendarEventOperations;

  beforeEach(() => {
    fetchMock = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();
    operations = new RoomCalendarEventOperations(fetchMock, {
      eventWritesEnabled: true,
      radicaleBaseUrl: 'https://radicale.example.test/caldav/',
      roomCalendarBindings,
      servicePrincipalUserId: serviceUserId,
    });
  });

  it('gets one event only with the appservice principal and its ETag', async () => {
    const eventUrl = `${collectionUrl}event.ics`;
    fetchMock.mockResolvedValueOnce(
      new Response(simpleCalendar, {
        status: 200,
        headers: { ETag: '"event-v1"' },
      }),
    );

    await expect(
      operations.getEvent(access(), eventUrl),
    ).resolves.toMatchObject({
      event: {
        id: eventUrl,
        calendarId,
        uid: 'simple-timed@example.test',
      },
      etag: '"event-v1"',
    });

    const [requestUrl, init] = fetchMock.mock.calls[0];
    expect(requestUrl).toBe(eventUrl);
    expect(init?.method).toBe('GET');
    expect(init?.redirect).toBe('manual');
    expect(new Headers(init?.headers).get('Authorization')).toMatch(/^Basic /);
    expect(basicUsername(init)).toBe('_matrix_calendar_service');
    expect(basicOpenIdCredential(init)).toEqual({
      access_token: serviceProof,
      matrix_server_name: 'example.test',
    });
  });

  it('offers canonical ICS only through the internal resource method', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(simpleCalendar, {
        status: 200,
        headers: { ETag: '"event-v1"' },
      }),
    );

    await expect(
      operations.getEventResource(access(), `${collectionUrl}event.ics`),
    ).resolves.toMatchObject({
      event: { uid: 'simple-timed@example.test' },
      etag: '"event-v1"',
      icalendar: simpleCalendar,
    });
  });

  it('requires a direct .ics leaf before returning raw event resources', async () => {
    await expect(
      operations.getEventResource(access(), `${collectionUrl}event-resource`),
    ).rejects.toMatchObject({ code: 'invalid-event-url' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('preserves the configured bounded CalDAV response size', async () => {
    const cappedOperations = new RoomCalendarEventOperations(fetchMock, {
      maxResponseBytes: 32,
      radicaleBaseUrl: 'https://radicale.example.test/caldav/',
      roomCalendarBindings,
      servicePrincipalUserId: serviceUserId,
    });
    fetchMock.mockResolvedValueOnce(
      new Response(simpleCalendar, {
        status: 200,
        headers: { ETag: '"event-v1"' },
      }),
    );

    await expect(
      cappedOperations.getEvent(access(), `${collectionUrl}event.ics`),
    ).rejects.toMatchObject({ code: 'response-too-large', method: 'GET' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fails closed on redirected room CalDAV requests', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('', {
        status: 302,
        headers: { Location: 'https://attacker.example.test/event.ics' },
      }),
    );

    await expect(
      operations.getEvent(access(), `${collectionUrl}event.ics`),
    ).rejects.toMatchObject({ code: 'redirected', method: 'GET' });
    expect(fetchMock.mock.calls[0][1]?.redirect).toBe('manual');
  });

  it.each([
    'https://attacker.example.test/event.ics',
    'https://radicale.example.test/caldav/_matrix_calendar_service/other-calendar/event.ics',
    `${collectionUrl}nested/event.ics`,
    `${collectionUrl}event.ics?access_token=secret`,
    `${collectionUrl}event.ics#private`,
    `${collectionUrl}`,
    `${collectionUrl}%2e%2e`,
    `${collectionUrl}unsafe%2fchild.ics`,
    `${collectionUrl}unsafe%5cchild.ics`,
    `${collectionUrl}double-%252e%252e.ics`,
    `${collectionUrl}double-%252f.ics`,
    `${collectionUrl}event.txt`,
    'event.ics',
  ])('rejects event URL outside the exact collection: %s', async (eventUrl) => {
    await expect(operations.getEvent(access(), eventUrl)).rejects.toMatchObject(
      { code: 'invalid-event-url' },
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lists only event resources in the exact configured collection', async () => {
    const eventUrl = `${collectionUrl}event.ics`;
    fetchMock.mockResolvedValueOnce(
      new Response(
        `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:href>${eventUrl}</d:href><d:propstat><d:prop><d:getetag>"event-v1"</d:getetag><c:calendar-data>${escapeXml(simpleCalendar)}</c:calendar-data></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`,
        { status: 207 },
      ),
    );

    await expect(
      operations.listEvents(access(), {
        start: '2026-09-24T00:00:00Z',
        end: '2026-09-25T00:00:00Z',
      }),
    ).resolves.toMatchObject([
      {
        event: { id: eventUrl, uid: 'simple-timed@example.test' },
        etag: '"event-v1"',
      },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(collectionUrl);
    expect(fetchMock.mock.calls[0][1]?.method).toBe('REPORT');
  });

  it('rejects a principal assigned to a different user collection', async () => {
    const wrongPrincipal: RoomCalendarEventServicePrincipal = {
      ...principal(),
      calendarUrl: 'https://radicale.example.test/caldav/alice/room-calendar/',
    };

    await expect(
      operations.getEvent(access(wrongPrincipal), `${collectionUrl}event.ics`),
    ).rejects.toMatchObject({ code: 'invalid-room-access' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('re-resolves the exact configured room binding before DAV I/O', async () => {
    const unconfiguredAccess = {
      ...access(),
      target: {
        roomId: '!other:example.test',
        calendarId,
        principal: { kind: 'service' as const },
      },
    };

    await expect(
      operations.getEvent(unconfiguredAccess, `${collectionUrl}event.ics`),
    ).rejects.toMatchObject({ code: 'invalid-room-access' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a principal on an unconfigured CalDAV origin or appservice user', async () => {
    await expect(
      operations.getEvent(
        access({
          ...principal(),
          calendarUrl:
            'https://attacker.example.test/caldav/_matrix_calendar_service/room-calendar/',
        }),
        `${collectionUrl}event.ics`,
      ),
    ).rejects.toMatchObject({ code: 'invalid-room-access' });

    await expect(
      operations.getEvent(
        access({
          ...principal(),
          userId: '@attacker:example.test',
          calendarUrl:
            'https://radicale.example.test/caldav/attacker/room-calendar/',
        }),
        `${collectionUrl}event.ics`,
      ),
    ).rejects.toMatchObject({ code: 'invalid-room-access' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['.', '..', 'a/b', 'a\\b', 'a%2Fb', 'a space'])(
    'rejects unsafe service-user localparts at the operation boundary: %s',
    async (localpart) => {
      const userId = `@${localpart}:example.test`;
      const radicaleBaseUrl = 'https://radicale.example.test/caldav/';
      const servicePrincipal: RoomCalendarEventServicePrincipal = {
        ...principal(),
        userId,
        calendarUrl: `${radicaleBaseUrl}${encodeURIComponent(localpart)}/${calendarId}/`,
      };
      const constrainedOperations = new RoomCalendarEventOperations(fetchMock, {
        radicaleBaseUrl,
        roomCalendarBindings,
        servicePrincipalUserId: userId,
      });

      await expect(
        constrainedOperations.getEvent(
          access(servicePrincipal),
          `${collectionUrl}event.ics`,
        ),
      ).rejects.toMatchObject({ code: 'invalid-room-access' });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('bounds event URLs and decoded resource leaves before DAV I/O', async () => {
    await expect(
      operations.getEvent(access(), `${collectionUrl}${'a'.repeat(4093)}.ics`),
    ).rejects.toMatchObject({ code: 'invalid-event-url' });
    await expect(
      operations.getEvent(access(), `${collectionUrl}${'a'.repeat(252)}.ics`),
    ).rejects.toMatchObject({ code: 'invalid-event-url' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a principal whose OpenID server does not match its user ID', async () => {
    const wrongCredential: RoomCalendarEventServicePrincipal = {
      ...principal(),
      credential: {
        accessToken: serviceProof,
        matrixServerName: 'attacker.example.test',
      },
    };

    await expect(
      operations.getEvent(access(wrongCredential), `${collectionUrl}event.ics`),
    ).rejects.toMatchObject({ code: 'invalid-room-access' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a non-service target before requesting credentials or CalDAV', async () => {
    const personalTargetAccess = {
      ...access(),
      target: {
        roomId: '!team:example.test',
        calendarId,
        principal: { kind: 'personal' },
      },
    } as unknown as AuthorizedRoomCalendarEventAccess;

    await expect(
      operations.getEvent(personalTargetAccess, `${collectionUrl}event.ics`),
    ).rejects.toMatchObject({ code: 'invalid-room-access' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('creates with If-None-Match and reads back the server resource', async () => {
    const input: CalendarEventInput = {
      uid: 'created+event@example.test',
      title: 'Created room event',
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
    const eventUrl = `${collectionUrl}created%2Bevent%40example.test.ics`;
    const createdCalendar = new ICalendarEventCodec().create(
      calendarId,
      eventUrl,
      input,
    ).icalendar;
    fetchMock
      .mockResolvedValueOnce(
        new Response('', {
          status: 201,
          headers: { ETag: '"created-v1"' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(createdCalendar, {
          status: 200,
          headers: { ETag: '"created-v1"' },
        }),
      );

    await expect(
      operations.createEvent(access(), input),
    ).resolves.toMatchObject({
      event: {
        id: eventUrl,
        calendarId,
        uid: input.uid,
        title: input.title,
      },
      etag: '"created-v1"',
    });

    const [putUrl, putInit] = fetchMock.mock.calls[0];
    const putHeaders = new Headers(putInit?.headers);
    expect(putUrl).toBe(eventUrl);
    expect(putInit?.method).toBe('PUT');
    expect(putInit?.redirect).toBe('manual');
    expect(putHeaders.get('If-None-Match')).toBe('*');
    expect(putHeaders.get('If-Match')).toBeNull();
    expect(putInit?.body).toContain(`UID:${input.uid}`);
    expect(basicUsername(putInit)).toBe('_matrix_calendar_service');
  });

  it('keeps writes disabled at the operation boundary without DAV I/O', async () => {
    const disabledOperations = new RoomCalendarEventOperations(fetchMock, {
      eventWritesEnabled: false,
      radicaleBaseUrl: 'https://radicale.example.test/caldav/',
      roomCalendarBindings,
      servicePrincipalUserId: serviceUserId,
    });

    await expect(
      disabledOperations.createEvent(access(), {
        uid: 'disabled@example.test',
        title: 'Disabled event',
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
      }),
    ).rejects.toMatchObject({ code: 'event-write-disabled' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('bounds encoded create UIDs to one filesystem-safe resource leaf', async () => {
    await expect(
      operations.createEvent(access(), {
        uid: 'x'.repeat(252),
        title: 'Oversized UID',
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
      }),
    ).rejects.toMatchObject({ code: 'invalid-event-input' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not overwrite a resource when create reports an existing UID', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 412 }));

    await expect(
      operations.createEvent(access(), {
        uid: 'existing@example.test',
        title: 'Existing event',
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
      }),
    ).rejects.toMatchObject({ code: 'etag-conflict', status: 412 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      new Headers(fetchMock.mock.calls[0][1]?.headers).get('If-None-Match'),
    ).toBe('*');
  });

  it('preserves legacy siblings and unknown iCalendar data on update', async () => {
    const eventUrl = `${collectionUrl}mixed-event.ics`;
    const sourceCalendar = mixedCalendar.replace(
      'SUMMARY:Visible calendar event',
      'SUMMARY:Before update\nX-CUSTOM-EVENT:preserve-me',
    );
    const updatedCalendar = new ICalendarEventCodec()
      .parse(calendarId, eventUrl, sourceCalendar)
      .applyPatch({ title: 'After update' }).icalendar;
    fetchMock
      .mockResolvedValueOnce(
        new Response(sourceCalendar, {
          status: 200,
          headers: { ETag: '"room-v1"' },
        }),
      )
      .mockResolvedValueOnce(
        new Response('', {
          status: 204,
          headers: { ETag: '"room-v2"' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(updatedCalendar, {
          status: 200,
          headers: { ETag: '"room-v2"' },
        }),
      );

    await expect(
      operations.updateEvent(access(), eventUrl, '"room-v1"', {
        title: 'After update',
      }),
    ).resolves.toMatchObject({
      event: { title: 'After update', uid: 'mixed-event@example.test' },
      etag: '"room-v2"',
    });

    const [, putInit] = fetchMock.mock.calls[1];
    const putHeaders = new Headers(putInit?.headers);
    expect(putInit?.method).toBe('PUT');
    expect(putInit?.redirect).toBe('manual');
    expect(putHeaders.get('If-Match')).toBe('"room-v1"');
    expect(putInit?.body).toContain('X-CUSTOM-EVENT:preserve-me');
    expect(putInit?.body).toContain('BEGIN:VTODO');
    expect(putInit?.body).toContain('UID:mixed-task@example.test');
    expect(putInit?.body).toContain('BEGIN:VJOURNAL');
    expect(putInit?.body).toContain('UID:mixed-journal@example.test');
    expect(basicUsername(putInit)).toBe('_matrix_calendar_service');
  });

  it('rejects malformed conference patches before CalDAV reads', async () => {
    await expect(
      operations.updateEvent(
        access(),
        `${collectionUrl}conference.ics`,
        '"room-v1"',
        {
          conference: {
            action: 'set',
            url: 'javascript:alert(1)',
            unexpected: true,
          },
        } as unknown as CalendarEventPatch,
      ),
    ).rejects.toMatchObject({ code: 'invalid-event-input' });
    await expect(
      operations.updateEvent(
        access(),
        `${collectionUrl}conference.ics`,
        '"room-v1"',
        {
          attachment: { action: 'add', url: 'javascript:alert(1)' },
        } as unknown as CalendarEventPatch,
      ),
    ).rejects.toMatchObject({ code: 'invalid-event-input' });
    expect(fetchMock).not.toHaveBeenCalled();

    await expect(
      operations.updateEvent(
        access(),
        `${collectionUrl}occurrence.ics`,
        '"room-v1"',
        {
          recurrence: {
            occurrence: {
              action: 'set-fields',
              recurrenceId: {
                type: 'floating-date-time',
                value: '2026-09-25T09:00:00',
              },
              viewerTimezone: 'UTC',
              title: { action: 'set', value: '   ' },
            },
          },
        } as CalendarEventPatch,
      ),
    ).rejects.toMatchObject({ code: 'invalid-event-input' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('skips same-value conference writes only with the current ETag', async () => {
    const eventUrl = `${collectionUrl}conference.ics`;
    const source = conferenceCalendar();
    fetchMock.mockResolvedValueOnce(
      new Response(source, {
        status: 200,
        headers: { ETag: '"room-v1"' },
      }),
    );

    await expect(
      operations.updateEvent(access(), eventUrl, '"room-v1"', {
        title: 'Team planning',
        description: 'Agenda',
        location: undefined,
        conference: {
          action: 'set',
          url: 'https://meet.example.test/room',
          label: 'Planning room',
        },
      }),
    ).resolves.toMatchObject({ etag: '"room-v1"', noOp: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]?.method).toBe('GET');
  });

  it('skips a same-value attachment write only with the current ETag', async () => {
    const eventUrl = `${collectionUrl}conference.ics`;
    const source = conferenceCalendar().replace(
      'DESCRIPTION:Agenda',
      'ATTACH;VALUE=URI:https://files.example.test/agenda\r\nDESCRIPTION:Agenda',
    );
    fetchMock.mockResolvedValueOnce(
      new Response(source, {
        status: 200,
        headers: { ETag: '"room-v1"' },
      }),
    );

    await expect(
      operations.updateEvent(access(), eventUrl, '"room-v1"', {
        title: 'Team planning',
        description: 'Agenda',
        location: undefined,
        attachment: {
          action: 'set',
          sourceUrl: 'https://files.example.test/agenda',
          url: 'https://files.example.test/agenda',
        },
      }),
    ).resolves.toMatchObject({ etag: '"room-v1"', noOp: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]?.method).toBe('GET');
  });

  it('sends same-value conference operations with stale ETags to conditional PUT', async () => {
    const eventUrl = `${collectionUrl}conference.ics`;
    const source = conferenceCalendar();
    fetchMock
      .mockResolvedValueOnce(
        new Response(source, {
          status: 200,
          headers: { ETag: '"room-v2"' },
        }),
      )
      .mockResolvedValueOnce(
        new Response('Precondition failed', { status: 412 }),
      );

    await expect(
      operations.updateEvent(access(), eventUrl, '"room-v1"', {
        conference: {
          action: 'set',
          url: 'https://meet.example.test/room',
          label: 'Planning room',
        },
      }),
    ).rejects.toMatchObject({ code: 'etag-conflict' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1]?.method).toBe('PUT');
    expect(
      new Headers(fetchMock.mock.calls[1][1]?.headers).get('If-Match'),
    ).toBe('"room-v1"');
  });

  it('skips same-value alarm writes only with the current ETag', async () => {
    const eventUrl = `${collectionUrl}alarm.ics`;
    const alarm = {
      action: 'display' as const,
      trigger: { type: 'absolute' as const, value: '2026-09-24T07:45:00Z' },
    };
    const source = new ICalendarEventCodec()
      .parse(calendarId, eventUrl, simpleCalendar)
      .applyPatch({ alarm }).icalendar;
    fetchMock.mockResolvedValueOnce(
      new Response(source, {
        status: 200,
        headers: { ETag: '"room-v1"' },
      }),
    );

    await expect(
      operations.updateEvent(access(), eventUrl, '"room-v1"', { alarm }),
    ).resolves.toMatchObject({
      etag: '"room-v1"',
      noOp: true,
      event: { alarm: { trigger: alarm.trigger } },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]?.method).toBe('GET');
  });

  it('sends same-value alarm operations with stale ETags to conditional PUT', async () => {
    const eventUrl = `${collectionUrl}alarm.ics`;
    const alarm = {
      action: 'display' as const,
      trigger: { type: 'absolute' as const, value: '2026-09-24T07:45:00Z' },
    };
    const source = new ICalendarEventCodec()
      .parse(calendarId, eventUrl, simpleCalendar)
      .applyPatch({ alarm }).icalendar;
    fetchMock
      .mockResolvedValueOnce(
        new Response(source, {
          status: 200,
          headers: { ETag: '"room-v2"' },
        }),
      )
      .mockResolvedValueOnce(
        new Response('Precondition failed', { status: 412 }),
      );

    await expect(
      operations.updateEvent(access(), eventUrl, '"room-v1"', { alarm }),
    ).rejects.toMatchObject({ code: 'etag-conflict' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1]?.method).toBe('PUT');
    expect(
      new Headers(fetchMock.mock.calls[1][1]?.headers).get('If-Match'),
    ).toBe('"room-v1"');
  });

  it('skips DAV writes for an identical following-suffix ETag retry', async () => {
    const eventUrl = `${collectionUrl}following.ics`;
    const sourceCalendar = followingCalendar();
    const following = followingOperation();
    const generated = new ICalendarEventCodec()
      .parse(calendarId, eventUrl, sourceCalendar)
      .applyPatch({ recurrence: { following } });
    fetchMock.mockResolvedValueOnce(
      new Response(generated.icalendar, {
        status: 200,
        headers: { ETag: '"following-v1"' },
      }),
    );

    await expect(
      operations.updateEvent(access(), eventUrl, '"following-v1"', {
        recurrence: { following },
      }),
    ).resolves.toMatchObject({
      etag: '"following-v1"',
      event: { recurrence: { overrides: [{}, {}] } },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]?.method).toBe('GET');
  });

  it('enforces the configured response cap before a following write', async () => {
    const eventUrl = `${collectionUrl}following.ics`;
    const sourceCalendar = followingCalendar();
    const byteLength = Buffer.byteLength(sourceCalendar, 'utf8');
    const cappedOperations = new RoomCalendarEventOperations(fetchMock, {
      eventWritesEnabled: true,
      maxResponseBytes: byteLength + 64,
      radicaleBaseUrl: 'https://radicale.example.test/caldav/',
      roomCalendarBindings,
      servicePrincipalUserId: serviceUserId,
    });
    fetchMock.mockResolvedValueOnce(
      new Response(sourceCalendar, {
        status: 200,
        headers: { ETag: '"following-v1"' },
      }),
    );

    await expect(
      cappedOperations.updateEvent(access(), eventUrl, '"following-v1"', {
        recurrence: { following: followingOperation() },
      }),
    ).rejects.toMatchObject({ code: 'event-too-large' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]?.method).toBe('GET');
  });

  it('sends the caller ETag unchanged and surfaces stale update conflicts', async () => {
    const eventUrl = `${collectionUrl}event.ics`;
    fetchMock
      .mockResolvedValueOnce(
        new Response(simpleCalendar, {
          status: 200,
          headers: { ETag: '"current-v2"' },
        }),
      )
      .mockResolvedValueOnce(new Response('', { status: 412 }));

    await expect(
      operations.updateEvent(access(), eventUrl, '"stale-v1"', {
        title: 'Do not overwrite',
      }),
    ).rejects.toMatchObject({
      code: 'etag-conflict',
      method: 'PUT',
      status: 412,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      new Headers(fetchMock.mock.calls[1][1]?.headers).get('If-Match'),
    ).toBe('"stale-v1"');
  });

  it('requires an ETag on reads and never turns an update into an unconditional write', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(simpleCalendar, { status: 200 }),
    );
    await expect(
      operations.getEvent(access(), `${collectionUrl}event.ics`),
    ).rejects.toMatchObject({ code: 'invalid-response', method: 'GET' });

    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(
      new Response(simpleCalendar, { status: 200 }),
    );
    await expect(
      operations.updateEvent(
        access(),
        `${collectionUrl}event.ics`,
        '"expected-v1"',
        { title: 'No write without ETag' },
      ),
    ).rejects.toMatchObject({ code: 'invalid-response', method: 'GET' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('requires a concrete ETag for update and delete', async () => {
    await expect(
      operations.updateEvent(access(), `${collectionUrl}event.ics`, '*', {
        title: 'Rejected',
      }),
    ).rejects.toBeInstanceOf(RoomCalendarEventOperationError);
    await expect(
      operations.deleteEvent(access(), `${collectionUrl}event.ics`, '*'),
    ).rejects.toMatchObject({ code: 'invalid-event-etag' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('deletes only with the caller expected ETag', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(simpleCalendar, {
          status: 200,
          headers: { ETag: '"expected-v4"' },
        }),
      )
      .mockResolvedValueOnce(new Response('', { status: 204 }));

    await expect(
      operations.deleteEvent(
        access(),
        `${collectionUrl}event.ics`,
        '"expected-v4"',
      ),
    ).resolves.toBeUndefined();

    const [getUrl, getInit] = fetchMock.mock.calls[0];
    expect(getUrl).toBe(`${collectionUrl}event.ics`);
    expect(getInit?.method).toBe('GET');

    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe(`${collectionUrl}event.ics`);
    expect(init?.method).toBe('DELETE');
    expect(init?.redirect).toBe('manual');
    expect(new Headers(init?.headers).get('If-Match')).toBe('"expected-v4"');
    expect(new Headers(init?.headers).get('If-None-Match')).toBeNull();
  });

  it('refuses to delete resources with mixed components or unrelated masters', async () => {
    const eventUrl = `${collectionUrl}event.ics`;
    fetchMock.mockResolvedValueOnce(
      new Response(mixedCalendar, {
        status: 200,
        headers: { ETag: '"mixed-v1"' },
      }),
    );

    await expect(
      operations.deleteEvent(access(), eventUrl, '"mixed-v1"'),
    ).rejects.toMatchObject({ code: 'unsafe-event-resource' });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const unrelatedMaster = simpleCalendar.replace(
      'END:VCALENDAR',
      'BEGIN:VEVENT\nUID:other-event@example.test\nDTSTART:20260924T100000Z\nDTEND:20260924T110000Z\nEND:VEVENT\nEND:VCALENDAR',
    );
    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(
      new Response(unrelatedMaster, {
        status: 200,
        headers: { ETag: '"multi-v1"' },
      }),
    );

    await expect(
      operations.deleteEvent(access(), eventUrl, '"multi-v1"'),
    ).rejects.toMatchObject({ code: 'unsafe-event-resource' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    'BEGIN:VFREEBUSY\nUID:freebusy@example.test\nEND:VFREEBUSY',
    'BEGIN:X-UNSUPPORTED\nUID:unknown@example.test\nEND:X-UNSUPPORTED',
  ])(
    'refuses to delete resources with unsupported components',
    async (otherComponent) => {
      const eventUrl = `${collectionUrl}event.ics`;
      const mixedCalendar = simpleCalendar.replace(
        'END:VCALENDAR',
        `${otherComponent}\nEND:VCALENDAR`,
      );
      fetchMock.mockResolvedValueOnce(
        new Response(mixedCalendar, {
          status: 200,
          headers: { ETag: '"mixed-v1"' },
        }),
      );

      await expect(
        operations.deleteEvent(access(), eventUrl, '"mixed-v1"'),
      ).rejects.toMatchObject({ code: 'unsafe-event-resource' });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    [
      'a VTODO nested in VEVENT',
      simpleCalendar.replace(
        'END:VEVENT',
        'BEGIN:VTODO\nUID:task@example.test\nEND:VTODO\nEND:VEVENT',
      ),
    ],
    [
      'an unknown component nested in VALARM',
      simpleCalendar.replace(
        'END:VEVENT',
        [
          'BEGIN:VALARM',
          'ACTION:DISPLAY',
          'TRIGGER:-PT5M',
          'BEGIN:X-UNSUPPORTED',
          'END:X-UNSUPPORTED',
          'END:VALARM',
          'END:VEVENT',
        ].join('\n'),
      ),
    ],
    [
      'an unknown component nested in a VTIMEZONE observance',
      simpleCalendar.replace(
        'BEGIN:VEVENT',
        [
          'BEGIN:VTIMEZONE',
          'TZID:Etc/UTC',
          'BEGIN:STANDARD',
          'DTSTART:19700101T000000',
          'TZOFFSETFROM:+0000',
          'TZOFFSETTO:+0000',
          'BEGIN:X-UNSUPPORTED',
          'END:X-UNSUPPORTED',
          'END:STANDARD',
          'END:VTIMEZONE',
          'BEGIN:VEVENT',
        ].join('\n'),
      ),
    ],
  ])('refuses to delete %s', async (_description, unsafeCalendar) => {
    const eventUrl = `${collectionUrl}event.ics`;
    fetchMock.mockResolvedValueOnce(
      new Response(unsafeCalendar, {
        status: 200,
        headers: { ETag: '"nested-v1"' },
      }),
    );

    await expect(
      operations.deleteEvent(access(), eventUrl, '"nested-v1"'),
    ).rejects.toMatchObject({ code: 'unsafe-event-resource' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]?.method).toBe('GET');
  });

  it('allows a single recurrence series with same-UID detached VEVENTs', async () => {
    const eventUrl = `${collectionUrl}event.ics`;
    const recurringSeries = simpleCalendar.replace(
      'END:VCALENDAR',
      [
        'BEGIN:VEVENT',
        'UID:simple-timed@example.test',
        'RECURRENCE-ID:20260925T080000Z',
        'DTSTAMP:20260924T080000Z',
        'DTSTART:20260925T080000Z',
        'DTEND:20260925T090000Z',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\n'),
    );
    fetchMock
      .mockResolvedValueOnce(
        new Response(recurringSeries, {
          status: 200,
          headers: { ETag: '"series-v1"' },
        }),
      )
      .mockResolvedValueOnce(new Response('', { status: 204 }));

    await expect(
      operations.deleteEvent(access(), eventUrl, '"series-v1"'),
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1]?.method).toBe('DELETE');
  });

  it('checks the caller ETag against the resource before delete I/O', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(simpleCalendar, {
        status: 200,
        headers: { ETag: '"current-v2"' },
      }),
    );

    await expect(
      operations.deleteEvent(
        access(),
        `${collectionUrl}event.ics`,
        '"stale-v1"',
      ),
    ).rejects.toMatchObject({ code: 'etag-conflict' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('skips current-ETag alarm and attachment no-ops', async () => {
    const eventUrl = `${collectionUrl}alarm-attachment.ics`;
    const { alarm, attachmentUrl, source } = absoluteAlarmAttachmentSource();
    fetchMock.mockResolvedValueOnce(
      new Response(source, {
        status: 200,
        headers: { ETag: '"room-v1"' },
      }),
    );

    await expect(
      operations.updateEvent(access(), eventUrl, '"room-v1"', {
        alarm,
        attachment: {
          action: 'set',
          sourceUrl: attachmentUrl,
          url: attachmentUrl,
        },
      }),
    ).resolves.toMatchObject({
      etag: '"room-v1"',
      noOp: true,
      event: {
        alarm: { trigger: alarm.trigger },
        attachments: [{ url: attachmentUrl }],
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]?.method).toBe('GET');
  });

  it('sends stale alarm and attachment no-ops to conditional PUT', async () => {
    const eventUrl = `${collectionUrl}alarm-attachment.ics`;
    const { alarm, attachmentUrl, source } = absoluteAlarmAttachmentSource();
    fetchMock
      .mockResolvedValueOnce(
        new Response(source, {
          status: 200,
          headers: { ETag: '"room-v2"' },
        }),
      )
      .mockResolvedValueOnce(
        new Response('Precondition failed', { status: 412 }),
      );

    await expect(
      operations.updateEvent(access(), eventUrl, '"room-v1"', {
        alarm,
        attachment: {
          action: 'set',
          sourceUrl: attachmentUrl,
          url: attachmentUrl,
        },
      }),
    ).rejects.toMatchObject({ code: 'etag-conflict' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1]?.method).toBe('PUT');
    expect(
      new Headers(fetchMock.mock.calls[1][1]?.headers).get('If-Match'),
    ).toBe('"room-v1"');
  });
});

function access(
  servicePrincipal: RoomCalendarEventServicePrincipal = principal(),
): AuthorizedRoomCalendarEventAccess {
  return {
    target: {
      roomId,
      calendarId,
      principal: { kind: 'service' },
    },
    servicePrincipal,
  };
}

function principal(): RoomCalendarEventServicePrincipal {
  return {
    userId: serviceUserId,
    calendarUrl: collectionUrl,
    credential: {
      accessToken: serviceProof,
      matrixServerName: 'example.test',
    },
  };
}

function basicUsername(init: RequestInit | undefined): string | undefined {
  const authorization = new Headers(init?.headers).get('Authorization');
  if (!authorization?.startsWith('Basic ')) return undefined;
  return Buffer.from(authorization.slice('Basic '.length), 'base64')
    .toString('utf8')
    .split(':', 1)[0];
}

function basicOpenIdCredential(
  init: RequestInit | undefined,
): { access_token: string; matrix_server_name: string } | undefined {
  const authorization = new Headers(init?.headers).get('Authorization');
  if (!authorization?.startsWith('Basic ')) return undefined;
  const decoded = Buffer.from(
    authorization.slice('Basic '.length),
    'base64',
  ).toString('utf8');
  const separator = decoded.indexOf(':');
  const username = separator < 0 ? undefined : decoded.slice(0, separator);
  const delegatedCredential =
    separator < 0 ? undefined : decoded.slice(separator + 1);
  if (
    username !== '_matrix_calendar_service' ||
    !delegatedCredential?.startsWith('matrix-openid:')
  ) {
    return undefined;
  }

  return JSON.parse(
    Buffer.from(
      delegatedCredential.slice('matrix-openid:'.length),
      'base64url',
    ).toString('utf8'),
  ) as { access_token: string; matrix_server_name: string };
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function followingCalendar(): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Matrix Calendar Widget//Tests//EN',
    'BEGIN:VEVENT',
    'UID:following-room@example.test',
    'DTSTAMP:20260922T120000Z',
    'DTSTART:20261001T090000Z',
    'DTEND:20261001T100000Z',
    'SUMMARY:Following room event',
    'RRULE:FREQ=DAILY;COUNT=3',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

function followingOperation(): CalendarEventFollowingTimingWrite {
  return {
    action: 'set-timing',
    recurrenceId: {
      type: 'date-time',
      value: { local: '2026-10-02T09:00:00', timezone: 'UTC' },
    },
    timing: {
      type: 'end',
      start: {
        type: 'date-time',
        value: { local: '2026-10-02T11:00:00', timezone: 'UTC' },
      },
      end: {
        type: 'date-time',
        value: { local: '2026-10-02T12:00:00', timezone: 'UTC' },
      },
    },
    viewerTimezone: 'UTC',
  };
}

function conferenceCalendar(): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Matrix Calendar Widget//Tests//EN',
    'BEGIN:VEVENT',
    'UID:conference-room@example.test',
    'DTSTAMP:20261001T120000Z',
    'CREATED:20261001T120000Z',
    'LAST-MODIFIED:20261001T120000Z',
    'SEQUENCE:3',
    'DTSTART:20260924T080000Z',
    'DTEND:20260924T090000Z',
    'SUMMARY:Team planning',
    'CONFERENCE;VALUE=URI;LABEL="Planning room":https://meet.example.test/room',
    'DESCRIPTION:Agenda',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}
