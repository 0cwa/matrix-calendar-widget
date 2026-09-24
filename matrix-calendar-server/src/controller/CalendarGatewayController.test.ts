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
  BadRequestException,
  ConflictException,
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import fetch from 'jest-fetch-mock';
import { IAppConfiguration } from '../IAppConfiguration';
import { CalDavDiscoveryError } from '../caldav';
import { MatrixAuthGuard } from '../guard/MatrixAuthGuard';
import { MatrixRoomMembershipGuard } from '../guard/MatrixRoomMembershipGuard';
import { IMatrixOpenIdCredential } from '../model/IMatrixOpenIdCredential';
import { IUserContext } from '../model/IUserContext';
import { MatrixCalendarAuthorizationFactory } from '../service/MatrixCalendarAuthorization';
import { CalendarGatewayController } from './CalendarGatewayController';

describe('CalendarGatewayController', () => {
  const userContext: IUserContext = {
    userId: '@alice:example.test',
    locale: 'en',
    timezone: 'Europe/Stockholm',
  };
  const openIdCredential: IMatrixOpenIdCredential = {
    accessToken: 'openid-token',
    matrixServerName: 'example.test',
  };
  const roomId = '!team:example.test';
  const appConfig = {
    radicale_url: 'https://radicale.example.test/',
  } as IAppConfiguration;
  const isAllowed = jest.fn();
  const forRoom = jest.fn(() => ({ isAllowed }));
  const authorizationFactory = {
    forRoom,
  } as unknown as MatrixCalendarAuthorizationFactory;

  beforeEach(() => {
    fetch.resetMocks();
    fetch.enableMocks();
    isAllowed.mockReset();
    forRoom.mockReset();
    forRoom.mockImplementation(() => ({ isAllowed }));
  });

  function createController(
    config: IAppConfiguration = appConfig,
  ): CalendarGatewayController {
    return new CalendarGatewayController(config, authorizationFactory);
  }

  it('returns the server-validated Matrix user identity', () => {
    const controller = createController();

    expect(controller.getContext(userContext)).toEqual({
      userId: '@alice:example.test',
      roomId: undefined,
    });
  });

  it('echoes a room id only after guard processing', () => {
    const controller = createController();

    expect(controller.getContext(userContext, roomId)).toEqual({
      userId: '@alice:example.test',
      roomId,
    });
  });

  it('requires Matrix authentication and optional room membership', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, CalendarGatewayController),
    ).toEqual([MatrixAuthGuard, MatrixRoomMembershipGuard]);
  });

  it('discovers and maps authorized Radicale calendars', async () => {
    isAllowed.mockResolvedValue(true);
    fetch.mockResponses(
      [principalResponse('/principals/alice/'), { status: 207 }],
      [homeResponse('/alice/'), { status: 207 }],
      [
        multistatus(`
          <d:response>
            <d:href>/alice/team/</d:href>
            <d:propstat>
              <d:prop>
                <d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
                <d:displayname>Team events</d:displayname>
                <a:calendar-color>#336699ff</a:calendar-color>
                <c:supported-calendar-component-set>
                  <c:comp name="VEVENT"/>
                </c:supported-calendar-component-set>
                <d:current-user-privilege-set>
                  <d:privilege><d:read/></d:privilege>
                  <d:privilege><d:write-content/></d:privilege>
                </d:current-user-privilege-set>
              </d:prop>
              <d:status>HTTP/1.1 200 OK</d:status>
            </d:propstat>
          </d:response>
        `),
        { status: 207 },
      ],
    );

    await expect(
      createController().listCalendars(userContext, openIdCredential, roomId),
    ).resolves.toEqual([
      {
        id: 'https://radicale.example.test/alice/team/',
        name: 'Team events',
        color: '#336699ff',
        readOnly: false,
      },
    ]);

    expect(forRoom).toHaveBeenCalledWith(userContext.userId, roomId);
    expect(isAllowed).toHaveBeenCalledWith({ action: 'list-calendars' });
  });

  it('denies discovery when Matrix room policy rejects list-calendars', async () => {
    isAllowed.mockResolvedValue(false);

    await expect(
      createController().listCalendars(userContext, openIdCredential, roomId),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fails closed when the request has no OpenID delegation credential', async () => {
    isAllowed.mockResolvedValue(true);

    try {
      await createController().listCalendars(userContext, undefined, roomId);
      throw new Error('Expected discovery to reject without OpenID delegation');
    } catch (error) {
      expect(error).toBeInstanceOf(UnauthorizedException);
      expect((error as UnauthorizedException).getResponse()).toEqual({
        code: 'missing-openid-credential',
        message:
          'Matrix OpenID delegation credential is required for CalDAV access',
      });
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('propagates structured CalDAV failures', async () => {
    isAllowed.mockResolvedValue(true);
    fetch.mockResponseOnce('Unavailable', { status: 503 });

    await expect(
      createController().listCalendars(userContext, openIdCredential, roomId),
    ).rejects.toEqual(
      new CalDavDiscoveryError(
        'CalDAV PROPFIND failed with status 503',
        503,
        'https://radicale.example.test/',
      ),
    );
  });

  it('requires a room id for room-scoped discovery', async () => {
    await expect(
      createController().listCalendars(userContext, openIdCredential),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(forRoom).not.toHaveBeenCalled();
  });

  it('lists authorized VEVENT resources through the gateway', async () => {
    isAllowed.mockResolvedValue(true);
    const calendarId = 'https://radicale.example.test/alice/team/';
    fetch.mockResponseOnce(
      multistatus(`
        <d:response>
          <d:href>/alice/team/event.ics</d:href>
          <d:propstat>
            <d:prop>
              <d:getetag>"event-etag"</d:getetag>
              <c:calendar-data>${simpleEventIcs()}</c:calendar-data>
            </d:prop>
            <d:status>HTTP/1.1 200 OK</d:status>
          </d:propstat>
        </d:response>
      `),
      { status: 207 },
    );

    await expect(
      createController().listEvents(
        userContext,
        openIdCredential,
        roomId,
        calendarId,
        '2026-09-24T00:00:00Z',
        '2026-09-25T00:00:00Z',
      ),
    ).resolves.toEqual([
      {
        event: expect.objectContaining({
          id: 'https://radicale.example.test/alice/team/event.ics',
          calendarId,
          uid: 'event@example.test',
          title: 'Team planning',
        }),
        etag: '"event-etag"',
      },
    ]);

    expect(isAllowed).toHaveBeenCalledWith({
      action: 'read-events',
      calendarId,
    });
    expect(fetch.mock.calls[0][1]?.method).toBe('REPORT');
  });

  it('creates a basic VEVENT and returns the server resource state', async () => {
    isAllowed.mockResolvedValue(true);
    const calendarId = 'https://radicale.example.test/alice/team/';
    fetch
      .mockResponseOnce('', {
        status: 201,
        headers: { ETag: '"created-etag"' },
      })
      .mockResponseOnce(simpleEventIcs('Created event'), {
        status: 200,
        headers: { ETag: '"created-etag"' },
      });

    const result = await createController().createEvent(
      userContext,
      openIdCredential,
      {
        uid: 'event@example.test',
        title: 'Created event',
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
      },
      roomId,
      calendarId,
    );

    expect(result).toEqual({
      event: expect.objectContaining({
        id: 'https://radicale.example.test/alice/team/event%40example.test.ics',
        calendarId,
        uid: 'event@example.test',
        title: 'Created event',
      }),
      etag: '"created-etag"',
    });
    expect(isAllowed).toHaveBeenCalledWith({
      action: 'create-event',
      calendarId,
    });

    const [, putInit] = fetch.mock.calls[0];
    const putHeaders = new Headers(putInit?.headers);
    expect(putInit?.method).toBe('PUT');
    expect(putHeaders.get('If-None-Match')).toBe('*');
    expect(putInit?.body).toContain('UID:event@example.test');
    expect(putInit?.body).toContain('SUMMARY:Created event');
  });

  it('preserves unknown iCalendar data when updating an event', async () => {
    isAllowed.mockResolvedValue(true);
    const calendarId = 'https://radicale.example.test/alice/team/';
    const eventId = 'https://radicale.example.test/alice/team/event.ics';
    fetch
      .mockResponseOnce(simpleEventIcs('Before update', 'X-CUSTOM:preserve'), {
        status: 200,
        headers: { ETag: '"old-etag"' },
      })
      .mockResponseOnce('', {
        status: 200,
        headers: { ETag: '"new-etag"' },
      })
      .mockResponseOnce(simpleEventIcs('After update', 'X-CUSTOM:preserve'), {
        status: 200,
        headers: { ETag: '"new-etag"' },
      });

    const result = await createController().updateEvent(
      userContext,
      openIdCredential,
      { title: 'After update' },
      '"old-etag"',
      roomId,
      calendarId,
      eventId,
    );

    expect(result.event.title).toBe('After update');
    expect(result.etag).toBe('"new-etag"');
    expect(isAllowed).toHaveBeenCalledWith({
      action: 'update-event',
      calendarId,
      eventId,
    });

    const [, putInit] = fetch.mock.calls[1];
    const putHeaders = new Headers(putInit?.headers);
    expect(putInit?.method).toBe('PUT');
    expect(putHeaders.get('If-Match')).toBe('"old-etag"');
    expect(putInit?.body).toContain('SUMMARY:After update');
    expect(putInit?.body).toContain('X-CUSTOM:preserve');
  });

  it('maps stale event updates to a stable conflict response', async () => {
    isAllowed.mockResolvedValue(true);
    const calendarId = 'https://radicale.example.test/alice/team/';
    const eventId = 'https://radicale.example.test/alice/team/event.ics';
    fetch
      .mockResponseOnce(simpleEventIcs('Before update'), {
        status: 200,
        headers: { ETag: '"current-etag"' },
      })
      .mockResponseOnce('Precondition failed', { status: 412 });

    try {
      await createController().updateEvent(
        userContext,
        openIdCredential,
        { title: 'Stale update' },
        '"stale-etag"',
        roomId,
        calendarId,
        eventId,
      );
      throw new Error('Expected stale update to conflict');
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toEqual({
        code: 'etag-conflict',
        message: 'CalDAV PUT conflicted with the current event resource',
      });
    }
  });

  it('deletes an authorized event with the caller ETag', async () => {
    isAllowed.mockResolvedValue(true);
    const calendarId = 'https://radicale.example.test/alice/team/';
    const eventId = 'https://radicale.example.test/alice/team/event.ics';
    fetch.mockResponseOnce('', { status: 200 });

    await expect(
      createController().deleteEvent(
        userContext,
        openIdCredential,
        '"event-etag"',
        roomId,
        calendarId,
        eventId,
      ),
    ).resolves.toBeUndefined();

    expect(isAllowed).toHaveBeenCalledWith({
      action: 'delete-event',
      calendarId,
      eventId,
    });
    const [, init] = fetch.mock.calls[0];
    expect(init?.method).toBe('DELETE');
    expect(new Headers(init?.headers).get('If-Match')).toBe('"event-etag"');
  });

  it('rejects calendar URLs outside the configured Radicale service', async () => {
    isAllowed.mockResolvedValue(true);

    await expect(
      createController().listEvents(
        userContext,
        openIdCredential,
        roomId,
        'https://attacker.example.test/calendar/',
        '2026-09-24T00:00:00Z',
        '2026-09-25T00:00:00Z',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(fetch).not.toHaveBeenCalled();
  });

  it('fails closed when Radicale is not configured', async () => {
    isAllowed.mockResolvedValue(true);
    const config = {} as IAppConfiguration;

    try {
      await createController(config).listCalendars(
        userContext,
        openIdCredential,
        roomId,
      );
      throw new Error('Expected discovery to require RADICALE_URL');
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect((error as ServiceUnavailableException).getResponse()).toEqual({
        code: 'radicale-not-configured',
        message: 'RADICALE_URL is required for calendar discovery',
      });
    }
  });
});

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

function simpleEventIcs(
  title = 'Team planning',
  extraProperty?: string,
): string {
  return `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Matrix Calendar Widget Tests//EN
BEGIN:VEVENT
UID:event@example.test
DTSTART:20260924T080000Z
DTEND:20260924T090000Z
SUMMARY:${title}
${extraProperty ? `${extraProperty}\n` : ''}END:VEVENT
END:VCALENDAR`;
}

function multistatus(body: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus
  xmlns:d="DAV:"
  xmlns:c="urn:ietf:params:xml:ns:caldav"
  xmlns:a="http://apple.com/ns/ical/"
>
  ${body}
</d:multistatus>`;
}
