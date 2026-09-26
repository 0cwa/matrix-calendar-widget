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
} from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import fetch from 'jest-fetch-mock';
import { IAppConfiguration } from '../IAppConfiguration';
import { CalDavEventClient } from '../caldav';
import { MatrixAuthGuard } from '../guard/MatrixAuthGuard';
import { MatrixRoomMembershipGuard } from '../guard/MatrixRoomMembershipGuard';
import { IMatrixOpenIdCredential } from '../model/IMatrixOpenIdCredential';
import { IUserContext } from '../model/IUserContext';
import { MatrixCalendarAuthorizationFactory } from '../service/MatrixCalendarAuthorization';
import {
  RoomCalendarCalDavAccess,
  RoomCalendarTarget,
} from '../service/RoomCalendarCalDavAccess';
import { CalendarGatewayController } from './CalendarGatewayController';

jest.mock('matrix-bot-sdk', () => ({
  UserID: class UserID {
    readonly localpart: string;

    constructor(userId: string) {
      const separator = userId.indexOf(':');
      this.localpart =
        userId.startsWith('@') && separator > 1
          ? userId.slice(1, separator)
          : userId;
    }
  },
}));

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
  const calendarId = 'team-calendar';
  const calendarUrl = 'https://radicale.example.test/alice/team/';
  const appConfig = {
    radicale_url: 'https://radicale.example.test/',
    room_calendar_bindings: [{ roomId, calendarId }],
  } as unknown as IAppConfiguration;
  const isAllowed = jest.fn();
  const forRoom = jest.fn(() => ({ isAllowed }));
  const canManageCalendars = jest.fn();
  const authorizationFactory = {
    forRoom,
    canManageCalendars,
  } as unknown as MatrixCalendarAuthorizationFactory;
  const requestHeaders = jest.fn(async () => ({
    Authorization: 'Basic fake-room-principal',
  }));
  const collectionUrl = jest.fn((_target: RoomCalendarTarget) => calendarUrl);
  const createEventClient = jest.fn(
    (_target: RoomCalendarTarget) =>
      new CalDavEventClient({ getRequestHeaders: requestHeaders }),
  );
  const roomCalendarCalDavAccess = {
    collectionUrl,
    createEventClient,
  } as unknown as RoomCalendarCalDavAccess;

  beforeEach(() => {
    fetch.resetMocks();
    fetch.enableMocks();
    isAllowed.mockReset();
    forRoom.mockReset();
    forRoom.mockImplementation(() => ({ isAllowed }));
    canManageCalendars.mockReset();
    canManageCalendars.mockResolvedValue(true);
    collectionUrl.mockReset().mockReturnValue(calendarUrl);
    createEventClient
      .mockReset()
      .mockImplementation(
        (_target: RoomCalendarTarget) =>
          new CalDavEventClient({ getRequestHeaders: requestHeaders }),
      );
    requestHeaders
      .mockReset()
      .mockResolvedValue({ Authorization: 'Basic fake-room-principal' });
  });

  function createController(
    config: IAppConfiguration = appConfig,
    access: RoomCalendarCalDavAccess = roomCalendarCalDavAccess,
  ): CalendarGatewayController {
    return new CalendarGatewayController(config, authorizationFactory, access);
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

  it('lists only the configured room calendar without CalDAV discovery', async () => {
    isAllowed.mockResolvedValue(true);

    await expect(
      createController().listCalendars(userContext, openIdCredential, roomId),
    ).resolves.toEqual([
      {
        id: calendarId,
        name: calendarId,
        color: undefined,
        readOnly: false,
      },
    ]);

    expect(forRoom).toHaveBeenCalledWith(userContext.userId, roomId);
    expect(isAllowed).toHaveBeenCalledWith({ action: 'list-calendars' });
    expect(collectionUrl).not.toHaveBeenCalled();
    expect(createEventClient).not.toHaveBeenCalled();
    expect(requestHeaders).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns diagnostics for only the configured collection to a manager', async () => {
    isAllowed.mockResolvedValue(true);

    const result = await createController().getCalendarDiagnostics(
      userContext,
      openIdCredential,
      roomId,
    );

    expect(result).toEqual({
      calendars: [{ name: calendarId, url: calendarUrl }],
    });
    expect(canManageCalendars).toHaveBeenCalledWith(userContext.userId, roomId);
    expect(collectionUrl).toHaveBeenCalledWith({
      roomId,
      calendarId,
      principal: { kind: 'service' },
    });
    expect(createEventClient).not.toHaveBeenCalled();
    expect(requestHeaders).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('denies room diagnostics before resolving a target without manage permission', async () => {
    canManageCalendars.mockResolvedValue(false);

    await expect(
      createController().getCalendarDiagnostics(
        userContext,
        openIdCredential,
        roomId,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(collectionUrl).not.toHaveBeenCalled();
    expect(createEventClient).not.toHaveBeenCalled();
    expect(requestHeaders).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects room collection lifecycle changes after authorization without CalDAV', async () => {
    isAllowed.mockResolvedValue(true);
    const controller = createController();

    await expect(
      controller.createCalendar(
        userContext,
        openIdCredential,
        { name: 'New calendar' },
        roomId,
      ),
    ).rejects.toMatchObject({
      response: { code: 'room-calendar-collection-operator-managed' },
    });
    await expect(
      controller.renameCalendar(
        userContext,
        openIdCredential,
        { name: 'Renamed' },
        roomId,
        calendarId,
      ),
    ).rejects.toMatchObject({
      response: { code: 'room-calendar-collection-operator-managed' },
    });
    await expect(
      controller.updateCalendarMetadata(
        userContext,
        openIdCredential,
        { description: 'Changed' },
        roomId,
        calendarId,
      ),
    ).rejects.toMatchObject({
      response: { code: 'room-calendar-collection-operator-managed' },
    });
    await expect(
      controller.deleteCalendar(
        userContext,
        openIdCredential,
        roomId,
        calendarId,
      ),
    ).rejects.toMatchObject({
      response: { code: 'room-calendar-collection-operator-managed' },
    });

    expect(isAllowed).toHaveBeenCalledWith({ action: 'create-calendar' });
    expect(isAllowed).toHaveBeenCalledWith({
      action: 'manage-calendar',
      calendarId,
    });
    expect(collectionUrl).not.toHaveBeenCalled();
    expect(createEventClient).not.toHaveBeenCalled();
    expect(requestHeaders).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([calendarUrl, 'other-room-calendar'])(
    'rejects caller-selected room calendar targets before any CalDAV factory call (%s)',
    async (requestedCalendarId) => {
      isAllowed.mockResolvedValue(true);

      await expect(
        createController().listEvents(
          userContext,
          openIdCredential,
          roomId,
          requestedCalendarId,
          '2026-09-24T00:00:00Z',
          '2026-09-25T00:00:00Z',
        ),
      ).rejects.toMatchObject({
        response: { code: 'room-calendar-target-mismatch' },
      });

      expect(collectionUrl).not.toHaveBeenCalled();
      expect(createEventClient).not.toHaveBeenCalled();
      expect(requestHeaders).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it('rejects an unbound room before any CalDAV factory call', async () => {
    isAllowed.mockResolvedValue(true);
    const unboundRoomId = '!another:example.test';

    await expect(
      createController().listEvents(
        userContext,
        openIdCredential,
        unboundRoomId,
        calendarId,
        '2026-09-24T00:00:00Z',
        '2026-09-25T00:00:00Z',
      ),
    ).rejects.toMatchObject({
      response: { code: 'room-calendar-binding-missing' },
    });

    expect(collectionUrl).not.toHaveBeenCalled();
    expect(createEventClient).not.toHaveBeenCalled();
    expect(requestHeaders).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fails closed on duplicate configured collection assignments before CalDAV', async () => {
    isAllowed.mockResolvedValue(true);
    const duplicateBindings = {
      ...appConfig,
      room_calendar_bindings: [
        { roomId, calendarId },
        { roomId: '!other:example.test', calendarId },
      ],
    } as IAppConfiguration;

    await expect(
      createController(duplicateBindings).listEvents(
        userContext,
        openIdCredential,
        roomId,
        calendarId,
        '2026-09-24T00:00:00Z',
        '2026-09-25T00:00:00Z',
      ),
    ).rejects.toMatchObject({
      response: { code: 'room-calendar-binding-invalid' },
    });

    expect(collectionUrl).not.toHaveBeenCalled();
    expect(createEventClient).not.toHaveBeenCalled();
    expect(requestHeaders).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('denies membership, action power, and lookup failures before CalDAV', async () => {
    isAllowed.mockResolvedValue(false);

    await expect(
      createController().createEvent(
        userContext,
        openIdCredential,
        {
          uid: 'event@example.test',
          title: 'Blocked',
          timing: {
            type: 'timed',
            start: { local: '2026-09-24T08:00:00', timezone: 'UTC' },
            end: { local: '2026-09-24T09:00:00', timezone: 'UTC' },
          },
        },
        roomId,
        calendarId,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(forRoom).toHaveBeenCalledWith(userContext.userId, roomId);
    expect(isAllowed).toHaveBeenCalledWith({
      action: 'create-event',
      calendarId,
    });
    expect(collectionUrl).not.toHaveBeenCalled();
    expect(createEventClient).not.toHaveBeenCalled();
    expect(requestHeaders).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('denies discovery when Matrix room policy rejects list-calendars', async () => {
    isAllowed.mockResolvedValue(false);

    await expect(
      createController().listCalendars(userContext, openIdCredential, roomId),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(collectionUrl).not.toHaveBeenCalled();
    expect(createEventClient).not.toHaveBeenCalled();
    expect(requestHeaders).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not use the widget OpenID credential as the room CalDAV principal', async () => {
    isAllowed.mockResolvedValue(true);

    await expect(
      createController().listCalendars(userContext, undefined, roomId),
    ).resolves.toEqual([
      { id: calendarId, name: calendarId, color: undefined, readOnly: false },
    ]);
    expect(createEventClient).not.toHaveBeenCalled();
    expect(requestHeaders).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps live service-principal CalDAV access disabled by default', async () => {
    isAllowed.mockResolvedValue(true);

    await expect(
      createController(appConfig, new RoomCalendarCalDavAccess()).listEvents(
        userContext,
        openIdCredential,
        roomId,
        calendarId,
        '2026-09-24T00:00:00Z',
        '2026-09-25T00:00:00Z',
      ),
    ).rejects.toMatchObject({
      response: {
        code: 'room-calendar-caldav-disabled',
        message: 'Room calendar CalDAV access is not enabled',
      },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('requires a room id for room-scoped discovery', async () => {
    await expect(
      createController().listCalendars(userContext, openIdCredential),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(forRoom).not.toHaveBeenCalled();
  });

  it('lists authorized VEVENT resources through the gateway', async () => {
    isAllowed.mockResolvedValue(true);
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
    expect(collectionUrl).toHaveBeenCalledWith({
      roomId,
      calendarId,
      principal: { kind: 'service' },
    });
    expect(createEventClient).toHaveBeenCalledWith({
      roomId,
      calendarId,
      principal: { kind: 'service' },
    });
    expect(requestHeaders).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1]?.method).toBe('REPORT');
    expect(requestHeader(fetch.mock.calls[0][1], 'Authorization')).toBe(
      'Basic fake-room-principal',
    );
  });

  it('returns supported following recurrence metadata with the event DTO', async () => {
    isAllowed.mockResolvedValue(true);
    const rangedIcs = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:ranged@example.test
DTSTART:20260924T080000Z
DTEND:20260924T090000Z
RRULE:FREQ=DAILY;COUNT=3
END:VEVENT
BEGIN:VEVENT
UID:ranged@example.test
RECURRENCE-ID;RANGE=THISANDFUTURE:20260925T080000Z
DTSTART:20260925T100000Z
DTEND:20260925T110000Z
END:VEVENT
END:VCALENDAR`;
    fetch.mockResponseOnce(
      multistatus(`
        <d:response>
          <d:href>/alice/team/ranged.ics</d:href>
          <d:propstat>
            <d:prop>
              <d:getetag>"ranged-etag"</d:getetag>
              <c:calendar-data>${rangedIcs}</c:calendar-data>
            </d:prop>
            <d:status>HTTP/1.1 200 OK</d:status>
          </d:propstat>
        </d:response>
      `),
      { status: 207 },
    );

    const result = await createController().listEvents(
      userContext,
      openIdCredential,
      roomId,
      calendarId,
      '2026-09-24T00:00:00Z',
      '2026-09-28T00:00:00Z',
    );

    expect(result[0].event.unsupportedRecurrence).toBeUndefined();
    expect(result[0].event.recurrence?.overrides).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ range: 'this-and-following' }),
      ]),
    );
    expect(JSON.stringify(result)).not.toContain('THISANDFUTURE');
  });

  it('creates a basic VEVENT and returns the server resource state', async () => {
    isAllowed.mockResolvedValue(true);
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
    expect(putInit?.method).toBe('PUT');
    expect(requestHeader(putInit, 'If-None-Match')).toBe('*');
    expect(putInit?.body).toContain('UID:event@example.test');
    expect(putInit?.body).toContain('SUMMARY:Created event');
  });

  it('preserves unknown iCalendar data when updating an event', async () => {
    isAllowed.mockResolvedValue(true);
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
    expect(putInit?.method).toBe('PUT');
    expect(requestHeader(putInit, 'If-Match')).toBe('"old-etag"');
    expect(putInit?.body).toContain('SUMMARY:After update');
    expect(putInit?.body).toContain('X-CUSTOM:preserve');
  });

  it('rejects a series edit that removes an override identity before CalDAV PUT', async () => {
    isAllowed.mockResolvedValue(true);
    const eventId = `${calendarUrl}series.ics`;
    fetch.mockResponseOnce(
      `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:series@example.test
DTSTART:20260924T080000Z
DTEND:20260924T090000Z
RRULE:FREQ=DAILY;COUNT=3
SUMMARY:Team planning
END:VEVENT
BEGIN:VEVENT
UID:series@example.test
RECURRENCE-ID:20260926T080000Z
DTSTART:20260926T100000Z
DTEND:20260926T110000Z
SUMMARY:Moved planning
END:VEVENT
END:VCALENDAR`,
      {
        status: 200,
        headers: { ETag: '"current-etag"' },
      },
    );

    try {
      await createController().updateEvent(
        userContext,
        openIdCredential,
        { recurrence: { rrule: 'FREQ=DAILY;COUNT=2' } },
        '"current-etag"',
        roomId,
        calendarId,
        eventId,
      );
      throw new Error('Expected an orphaning series edit to be refused');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toEqual({
        code: 'recurrence-exception-orphaned',
        message: expect.stringContaining('would detach an existing'),
      });
      expect(
        JSON.stringify((error as BadRequestException).getResponse()),
      ).not.toContain('Moved planning');
    }

    expect(isAllowed).toHaveBeenCalledWith({
      action: 'update-event',
      calendarId,
      eventId,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1]?.method).toBe('GET');
  });

  it('refuses an unverifiable detached VEVENT before CalDAV PUT', async () => {
    isAllowed.mockResolvedValue(true);
    const eventId = `${calendarUrl}series.ics`;
    fetch.mockResponseOnce(
      `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:series@example.test
DTSTART:20260924T080000Z
DTEND:20260924T090000Z
RRULE:FREQ=DAILY;COUNT=3
SUMMARY:Team planning
END:VEVENT
BEGIN:VEVENT
RECURRENCE-ID:20260926T080000Z
DTSTART:20260926T100000Z
DTEND:20260926T110000Z
SUMMARY:Unverifiable moved planning
END:VEVENT
END:VCALENDAR`,
      {
        status: 200,
        headers: { ETag: '"current-etag"' },
      },
    );

    try {
      await createController().updateEvent(
        userContext,
        openIdCredential,
        { recurrence: { rrule: 'FREQ=DAILY;COUNT=2' } },
        '"current-etag"',
        roomId,
        calendarId,
        eventId,
      );
      throw new Error('Expected an unverifiable series edit to be refused');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toEqual({
        code: 'recurrence-exception-unverifiable',
        message: expect.stringContaining('cannot be checked safely'),
      });
      expect(
        JSON.stringify((error as BadRequestException).getResponse()),
      ).not.toContain('Unverifiable moved planning');
    }

    expect(isAllowed).toHaveBeenCalledWith({
      action: 'update-event',
      calendarId,
      eventId,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1]?.method).toBe('GET');
  });

  it('maps stale event updates to a stable conflict response', async () => {
    isAllowed.mockResolvedValue(true);
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

  it('updates one occurrence through an authorized conditional resource PUT', async () => {
    isAllowed.mockResolvedValue(true);
    const eventId = `${calendarUrl}series.ics`;
    fetch
      .mockResponseOnce(recurringEventIcs(), {
        status: 200,
        headers: { ETag: '"old-etag"' },
      })
      .mockResponseOnce('', {
        status: 204,
        headers: { ETag: '"new-etag"' },
      })
      .mockResponseOnce(recurringEventIcs(), {
        status: 200,
        headers: { ETag: '"new-etag"' },
      });

    const result = await createController().updateOccurrence(
      userContext,
      openIdCredential,
      {
        recurrenceId: {
          type: 'date-time',
          value: {
            local: '2026-09-25T08:00:00',
            timezone: 'UTC',
            mode: 'utc',
          },
        },
        patch: { title: 'Moved planning' },
      },
      '"old-etag"',
      roomId,
      calendarId,
      eventId,
    );

    expect(result.etag).toBe('"new-etag"');
    expect(isAllowed).toHaveBeenCalledWith({
      action: 'update-event',
      calendarId,
      eventId,
    });
    expect(fetch).toHaveBeenCalledTimes(3);
    const [, putInit] = fetch.mock.calls[1];
    expect(putInit?.method).toBe('PUT');
    expect(requestHeader(putInit, 'If-Match')).toBe('"old-etag"');
    expect(putInit?.body).toContain('UID:series@example.test');
    expect(putInit?.body).toContain('RECURRENCE-ID:20260925T080000Z');
    expect(putInit?.body).toContain('SUMMARY:Moved planning');
  });

  it('cancels one occurrence with a same-resource conditional PUT', async () => {
    isAllowed.mockResolvedValue(true);
    const eventId = `${calendarUrl}series.ics`;
    fetch
      .mockResponseOnce(recurringEventIcs(), {
        status: 200,
        headers: { ETag: '"old-etag"' },
      })
      .mockResponseOnce('', {
        status: 204,
        headers: { ETag: '"new-etag"' },
      })
      .mockResponseOnce(recurringEventIcs(), {
        status: 200,
        headers: { ETag: '"new-etag"' },
      });

    await createController().cancelOccurrence(
      userContext,
      openIdCredential,
      {
        recurrenceId: {
          type: 'date-time',
          value: {
            local: '2026-09-25T08:00:00',
            timezone: 'UTC',
            mode: 'utc',
          },
        },
      },
      '"old-etag"',
      roomId,
      calendarId,
      eventId,
    );

    const [, putInit] = fetch.mock.calls[1];
    expect(putInit?.method).toBe('PUT');
    expect(requestHeader(putInit, 'If-Match')).toBe('"old-etag"');
    expect(putInit?.body).toContain('RECURRENCE-ID:20260925T080000Z');
    expect(putInit?.body).toContain('STATUS:CANCELLED');
    expect(putInit?.method).not.toBe('DELETE');
  });

  it('updates supported following timing with authorization and If-Match', async () => {
    isAllowed.mockResolvedValue(true);
    const eventId = `${calendarUrl}series.ics`;
    const original = recurringEventIcs();
    const updated = `${original.replace(
      'END:VCALENDAR',
      `BEGIN:VEVENT
UID:series@example.test
RECURRENCE-ID;RANGE=THISANDFUTURE:20260925T080000Z
DTSTART:20260925T100000Z
DTEND:20260925T113000Z
END:VEVENT
END:VCALENDAR`,
    )}`;
    fetch
      .mockResponseOnce(original, {
        status: 200,
        headers: { ETag: '"old-etag"' },
      })
      .mockResponseOnce('', {
        status: 204,
        headers: { ETag: '"new-etag"' },
      })
      .mockResponseOnce(updated, {
        status: 200,
        headers: { ETag: '"new-etag"' },
      });

    const result = await createController().updateFollowingOccurrence(
      userContext,
      openIdCredential,
      {
        recurrenceId: {
          type: 'date-time',
          value: {
            local: '2026-09-25T08:00:00',
            timezone: 'UTC',
            mode: 'utc',
          },
        },
        timing: {
          type: 'timed',
          start: {
            local: '2026-09-25T10:00:00',
            timezone: 'UTC',
            mode: 'utc',
          },
          end: {
            local: '2026-09-25T11:30:00',
            timezone: 'UTC',
            mode: 'utc',
          },
        },
      },
      '"old-etag"',
      roomId,
      calendarId,
      eventId,
    );

    expect(result.event.recurrence?.overrides).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          recurrenceId: {
            type: 'date-time',
            value: {
              local: '2026-09-25T08:00:00',
              timezone: 'UTC',
              mode: 'utc',
            },
          },
          range: 'this-and-following',
        }),
      ]),
    );
    expect(isAllowed).toHaveBeenCalledWith({
      action: 'update-event',
      calendarId,
      eventId,
    });
    const [, putInit] = fetch.mock.calls[1];
    expect(putInit?.method).toBe('PUT');
    expect(requestHeader(putInit, 'If-Match')).toBe('"old-etag"');
    expect(putInit?.body).toContain('RANGE=THISANDFUTURE');
    expect(putInit?.body).toContain(
      'RECURRENCE-ID;RANGE=THISANDFUTURE:20260925T080000Z',
    );
    expect(putInit?.body).toContain('DTSTART:20260925T100000Z');
  });

  it('rejects unsupported following payloads before PUT and leaves the CalDAV body untouched', async () => {
    isAllowed.mockResolvedValue(true);
    const eventId = `${calendarUrl}series.ics`;
    const unsupported = `${recurringEventIcs().replace(
      'END:VCALENDAR',
      `BEGIN:VEVENT
UID:series@example.test
RECURRENCE-ID;RANGE=THISANDFUTURE:20260925T080000Z
DTSTART:20260925T100000Z
DTEND:20260925T110000Z
SUMMARY:Unsupported propagated field
END:VEVENT
END:VCALENDAR`,
    )}`;
    fetch.mockResponseOnce(unsupported, {
      status: 200,
      headers: { ETag: '"old-etag"' },
    });

    await expect(
      createController().updateFollowingOccurrence(
        userContext,
        openIdCredential,
        {
          recurrenceId: {
            type: 'date-time',
            value: {
              local: '2026-09-25T08:00:00',
              timezone: 'UTC',
              mode: 'utc',
            },
          },
          timing: {
            type: 'timed',
            start: {
              local: '2026-09-25T12:00:00',
              timezone: 'UTC',
              mode: 'utc',
            },
            end: {
              local: '2026-09-25T13:00:00',
              timezone: 'UTC',
              mode: 'utc',
            },
          },
        },
        '"old-etag"',
        roomId,
        calendarId,
        eventId,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'unsupported-recurrence-range',
      }),
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1]?.method).toBe('GET');
  });

  it('rejects a ranged VALARM before PUT', async () => {
    isAllowed.mockResolvedValue(true);
    const eventId = `${calendarUrl}series.ics`;
    const withAlarm = `${recurringEventIcs().replace(
      'END:VCALENDAR',
      `BEGIN:VEVENT
UID:series@example.test
RECURRENCE-ID;RANGE=THISANDFUTURE:20260925T080000Z
DTSTART:20260925T100000Z
DTEND:20260925T110000Z
BEGIN:VALARM
ACTION:DISPLAY
TRIGGER:-PT15M
DESCRIPTION:Reminder
END:VALARM
END:VEVENT
END:VCALENDAR`,
    )}`;
    fetch.mockResponseOnce(withAlarm, {
      status: 200,
      headers: { ETag: '"old-etag"' },
    });

    await expect(
      createController().updateFollowingOccurrence(
        userContext,
        openIdCredential,
        {
          recurrenceId: {
            type: 'date-time',
            value: {
              local: '2026-09-25T08:00:00',
              timezone: 'UTC',
              mode: 'utc',
            },
          },
          timing: {
            type: 'timed',
            start: {
              local: '2026-09-25T12:00:00',
              timezone: 'UTC',
              mode: 'utc',
            },
            end: {
              local: '2026-09-25T13:00:00',
              timezone: 'UTC',
              mode: 'utc',
            },
          },
        },
        '"old-etag"',
        roomId,
        calendarId,
        eventId,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'unsupported-recurrence-range',
      }),
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1]?.method).toBe('GET');
    expect(withAlarm).toContain('DESCRIPTION:Reminder');
  });

  it('denies following-scope edits before a CalDAV request', async () => {
    isAllowed.mockResolvedValue(false);
    const eventId = `${calendarUrl}series.ics`;

    await expect(
      createController().updateFollowingOccurrence(
        userContext,
        openIdCredential,
        {
          recurrenceId: {
            type: 'date-time',
            value: {
              local: '2026-09-25T08:00:00',
              timezone: 'UTC',
              mode: 'utc',
            },
          },
          timing: {
            type: 'timed',
            start: {
              local: '2026-09-25T10:00:00',
              timezone: 'UTC',
              mode: 'utc',
            },
            end: {
              local: '2026-09-25T11:00:00',
              timezone: 'UTC',
              mode: 'utc',
            },
          },
        },
        '"old-etag"',
        roomId,
        calendarId,
        eventId,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects unsafe occurrence requests before a CalDAV fetch', async () => {
    isAllowed.mockResolvedValue(true);
    const eventId = `${calendarUrl}series.ics`;
    const controller = createController();

    await expect(
      controller.updateOccurrence(
        userContext,
        openIdCredential,
        { patch: { title: 'Missing identity' } },
        '"etag"',
        roomId,
        calendarId,
        eventId,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      controller.updateOccurrence(
        userContext,
        openIdCredential,
        {
          recurrenceId: {
            type: 'date-time',
            value: {
              local: '2026-09-25T08:00:00',
              timezone: 'UTC',
              mode: 'utc',
            },
          },
          patch: { title: 'Updated', uid: 'attacker@example.test' },
        },
        '"etag"',
        roomId,
        calendarId,
        eventId,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      controller.updateOccurrence(
        userContext,
        openIdCredential,
        {
          recurrenceId: {
            type: 'date-time',
            value: {
              local: '2026-09-25T08:00:00',
              timezone: 'floating',
              mode: 'utc',
            },
          },
          patch: { title: 'Updated' },
        },
        '"etag"',
        roomId,
        calendarId,
        eventId,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      controller.updateOccurrence(
        userContext,
        openIdCredential,
        {
          recurrenceId: {
            type: 'date-time',
            value: {
              local: '2026-09-25T08:00:00',
              timezone: 'UTC',
              mode: 'utc',
            },
          },
          patch: { title: 'Updated' },
        },
        undefined,
        roomId,
        calendarId,
        eventId,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      controller.updateOccurrence(
        userContext,
        openIdCredential,
        {
          recurrenceId: {
            type: 'date-time',
            value: {
              local: '2026-09-25T08:00:00',
              timezone: 'UTC',
              mode: 'utc',
            },
          },
          patch: { title: 'Updated' },
        },
        '"etag"',
        roomId,
        calendarId,
        'https://radicale.example.test/alice/other/series.ics',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(fetch).not.toHaveBeenCalled();

    fetch.mockResponseOnce(recurringEventIcs(), {
      status: 200,
      headers: { ETag: '"etag"' },
    });
    await expect(
      controller.updateOccurrence(
        userContext,
        openIdCredential,
        {
          recurrenceId: {
            type: 'date-time',
            value: {
              local: '2026-09-25T08:00:00',
              timezone: 'Europe/Stockholm',
              mode: 'tzid',
            },
          },
          patch: { title: 'Wrong resource timezone' },
        },
        '"etag"',
        roomId,
        calendarId,
        eventId,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(fetch).toHaveBeenCalledTimes(1);

    fetch.resetMocks();
  });

  it('rejects an unauthorized occurrence update before accessing CalDAV', async () => {
    isAllowed.mockResolvedValue(false);

    await expect(
      createController().cancelOccurrence(
        userContext,
        openIdCredential,
        {
          recurrenceId: {
            type: 'date-time',
            value: {
              local: '2026-09-25T08:00:00',
              timezone: 'UTC',
              mode: 'utc',
            },
          },
        },
        '"etag"',
        roomId,
        calendarId,
        'https://radicale.example.test/alice/team/series.ics',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('maps stale occurrence resource writes to conflict without retry', async () => {
    isAllowed.mockResolvedValue(true);
    fetch
      .mockResponseOnce(recurringEventIcs(), {
        status: 200,
        headers: { ETag: '"current-etag"' },
      })
      .mockResponseOnce('Precondition failed', { status: 412 });

    await expect(
      createController().cancelOccurrence(
        userContext,
        openIdCredential,
        {
          recurrenceId: {
            type: 'date-time',
            value: {
              local: '2026-09-25T08:00:00',
              timezone: 'UTC',
              mode: 'utc',
            },
          },
        },
        '"stale-etag"',
        roomId,
        calendarId,
        'https://radicale.example.test/alice/team/series.ics',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1][0]).toBe(fetch.mock.calls[0][0]);
  });

  it('deletes an authorized event with the caller ETag', async () => {
    isAllowed.mockResolvedValue(true);
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
    expect(requestHeader(init, 'If-Match')).toBe('"event-etag"');
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
    const config = {
      room_calendar_bindings: [{ roomId, calendarId }],
    } as unknown as IAppConfiguration;

    try {
      await createController(config).listEvents(
        userContext,
        openIdCredential,
        roomId,
        calendarId,
        '2026-09-24T00:00:00Z',
        '2026-09-25T00:00:00Z',
      );
      throw new Error('Expected event access to require RADICALE_URL');
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect((error as ServiceUnavailableException).getResponse()).toEqual({
        code: 'radicale-not-configured',
        message: 'RADICALE_URL is required for calendar access',
      });
    }
  });
});

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

function recurringEventIcs(): string {
  return `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Matrix Calendar Widget Tests//EN
BEGIN:VEVENT
UID:series@example.test
DTSTART:20260924T080000Z
DTEND:20260924T090000Z
RRULE:FREQ=DAILY;COUNT=3
SUMMARY:Team planning
X-KEEP:resource-property
END:VEVENT
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

function requestHeader(
  init: { headers?: unknown } | undefined,
  name: string,
): string | undefined {
  const headers = init?.headers;
  if (!headers || typeof headers !== 'object') {
    return undefined;
  }

  const get = (headers as { get?: (headerName: string) => string | null }).get;
  if (typeof get === 'function') {
    return get.call(headers, name) ?? undefined;
  }

  if (Array.isArray(headers)) {
    const entry = headers.find(
      (candidate: unknown) =>
        Array.isArray(candidate) &&
        typeof candidate[0] === 'string' &&
        candidate[0].toLowerCase() === name.toLowerCase(),
    );
    return entry ? String(entry[1]) : undefined;
  }

  const entry = Object.entries(headers).find(
    ([headerName]) => headerName.toLowerCase() === name.toLowerCase(),
  );
  return entry ? String(entry[1]) : undefined;
}
