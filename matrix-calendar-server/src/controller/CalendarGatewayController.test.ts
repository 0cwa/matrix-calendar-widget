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
  CalendarEvent,
  CalendarEventInput,
  CalendarEventPatch,
} from '@matrix-calendar-widget/calendar';
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import fs from 'fs';
import fetch from 'jest-fetch-mock';
import path from 'path';
import { IAppConfiguration } from '../IAppConfiguration';
import {
  CalDavDiscoveryError,
  ICalendarEventCodec,
  MatrixOpenIdCalDavCredentialProviderFactory,
} from '../caldav';
import { MatrixAuthGuard } from '../guard/MatrixAuthGuard';
import { MatrixRoomMembershipGuard } from '../guard/MatrixRoomMembershipGuard';
import { IMatrixOpenIdCredential } from '../model/IMatrixOpenIdCredential';
import { IUserContext } from '../model/IUserContext';
import { MatrixCalendarAuthorizationFactory } from '../service/MatrixCalendarAuthorization';
import {
  RoomCalendarAccessMode,
  RoomCalendarCalDavAccess,
  RoomCalendarCalDavPrincipal,
  RoomCalendarTarget,
} from '../service/RoomCalendarCalDavAccess';
import { RoomCalendarEventAuditService } from '../service/RoomCalendarEventAuditService';
import { RoomCalendarEventOperations } from '../service/RoomCalendarEventOperations';
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
    room_calendar_bindings: [{ roomId, calendarId: 'team-calendar' }],
  } as unknown as IAppConfiguration;
  const isAllowed = jest.fn();
  const canManageCalendars = jest.fn();
  const forRoom = jest.fn(() => ({ isAllowed }));
  const authorizationFactory = {
    canManageCalendars,
    forRoom,
  } as unknown as MatrixCalendarAuthorizationFactory;
  const disabledAccess = new RoomCalendarCalDavAccess();
  const assertDisabled = jest.fn((target: RoomCalendarTarget) =>
    disabledAccess.assertDisabled(target),
  );
  const forAuthorizedTarget = jest.fn(
    (target: RoomCalendarTarget, mode: RoomCalendarAccessMode) =>
      disabledAccess.forAuthorizedTarget(target, mode),
  );
  const roomCalendarCalDavAccess = {
    assertDisabled,
    forAuthorizedTarget,
  } as unknown as RoomCalendarCalDavAccess;

  beforeEach(() => {
    fetch.resetMocks();
    fetch.enableMocks();
    isAllowed.mockReset();
    canManageCalendars.mockReset();
    forRoom.mockReset();
    forRoom.mockImplementation(() => ({ isAllowed }));
    assertDisabled.mockReset();
    assertDisabled.mockImplementation((target) =>
      disabledAccess.assertDisabled(target),
    );
    forAuthorizedTarget.mockReset();
    forAuthorizedTarget.mockImplementation((target, mode) =>
      disabledAccess.forAuthorizedTarget(target, mode),
    );
  });

  function createController(
    config: IAppConfiguration = appConfig,
    roomAccess: RoomCalendarCalDavAccess = roomCalendarCalDavAccess,
    credentialProviderFactory: MatrixOpenIdCalDavCredentialProviderFactory = new MatrixOpenIdCalDavCredentialProviderFactory(),
    roomEventOperations: RoomCalendarEventOperations = new RoomCalendarEventOperations(),
    roomEventAuditService?: RoomCalendarEventAuditService,
  ): CalendarGatewayController {
    return new CalendarGatewayController(
      config,
      authorizationFactory,
      credentialProviderFactory,
      roomAccess,
      roomEventOperations,
      roomEventAuditService,
    );
  }

  function createRoomTargetController(config: IAppConfiguration = appConfig): {
    controller: CalendarGatewayController;
    forRequest: jest.Mock;
  } {
    const forRequest = jest.fn();
    const credentialProviderFactory = {
      forRequest,
    } as unknown as MatrixOpenIdCalDavCredentialProviderFactory;

    return {
      controller: createController(
        config,
        roomCalendarCalDavAccess,
        credentialProviderFactory,
      ),
      forRequest,
    };
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

  it('lists only the configured room calendar without user-principal discovery', async () => {
    isAllowed.mockResolvedValue(true);
    const { controller, forRequest } = createRoomTargetController();

    const calendars = await controller.listCalendars(
      userContext,
      openIdCredential,
      roomId,
      'room',
    );

    expect(calendars).toHaveLength(1);
    expect(calendars[0]).toMatchObject({
      id: 'team-calendar',
      name: 'team-calendar',
      readOnly: true,
    });
    expect(forRoom).toHaveBeenCalledWith(userContext.userId, roomId);
    expect(isAllowed).toHaveBeenCalledWith({ action: 'list-calendars' });
    expect(forRequest).not.toHaveBeenCalled();
    expect(assertDisabled).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('denies a room event request before resolving binding or touching CalDAV', async () => {
    isAllowed.mockResolvedValue(false);
    const invalidConfig = {
      ...appConfig,
      room_calendar_bindings: [
        { roomId: 'not-canonical', calendarId: 'bad id' },
      ],
    } as unknown as IAppConfiguration;
    const { controller, forRequest } =
      createRoomTargetController(invalidConfig);

    await expect(
      controller.listEvents(
        userContext,
        openIdCredential,
        roomId,
        'team-calendar',
        '2026-10-01T00:00:00Z',
        '2026-10-02T00:00:00Z',
        'Europe/Stockholm',
        'room',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(isAllowed).toHaveBeenCalledWith({
      action: 'read-events',
      calendarId: 'team-calendar',
    });
    expect(assertDisabled).not.toHaveBeenCalled();
    expect(forRequest).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fails closed on a missing room binding before the disabled access gate', async () => {
    isAllowed.mockResolvedValue(true);
    const configWithoutBindings = {
      ...appConfig,
      room_calendar_bindings: [],
    } as unknown as IAppConfiguration;
    const { controller, forRequest } = createRoomTargetController(
      configWithoutBindings,
    );

    await expect(
      controller.listEvents(
        userContext,
        openIdCredential,
        roomId,
        undefined,
        '2026-10-01T00:00:00Z',
        '2026-10-02T00:00:00Z',
        'Europe/Stockholm',
        'room',
      ),
    ).rejects.toMatchObject({
      response: { code: 'room-calendar-binding-missing' },
    });

    expect(assertDisabled).not.toHaveBeenCalled();
    expect(forRequest).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects a caller-selected collection URL before room CalDAV access', async () => {
    isAllowed.mockResolvedValue(true);
    const { controller, forRequest } = createRoomTargetController();

    await expect(
      controller.listEvents(
        userContext,
        openIdCredential,
        roomId,
        'https://radicale.example.test/alice/team/',
        '2026-10-01T00:00:00Z',
        '2026-10-02T00:00:00Z',
        'Europe/Stockholm',
        'room',
      ),
    ).rejects.toMatchObject({
      response: { code: 'room-calendar-target-mismatch' },
    });

    expect(assertDisabled).not.toHaveBeenCalled();
    expect(forRequest).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps the room principal disabled after an authorized binding preflight', async () => {
    isAllowed.mockResolvedValue(true);
    const { controller, forRequest } = createRoomTargetController();

    await expect(
      controller.listEvents(
        userContext,
        openIdCredential,
        roomId,
        undefined,
        '2026-10-01T00:00:00Z',
        '2026-10-02T00:00:00Z',
        'Europe/Stockholm',
        'room',
      ),
    ).rejects.toMatchObject({
      response: { code: 'room-calendar-caldav-disabled' },
    });

    expect(forAuthorizedTarget).toHaveBeenCalledWith(
      {
        roomId,
        calendarId: 'team-calendar',
        principal: { kind: 'service' },
      },
      'read',
    );
    expect(forRequest).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('denies room event reads and writes before appservice proof or CalDAV I/O', async () => {
    isAllowed.mockResolvedValue(false);
    const operations = {
      getEvent: jest.fn(),
      createEvent: jest.fn(),
      updateEvent: jest.fn(),
      deleteEvent: jest.fn(),
    } as unknown as RoomCalendarEventOperations;
    const securedController = createController(
      appConfig,
      roomCalendarCalDavAccess,
      new MatrixOpenIdCalDavCredentialProviderFactory(),
      operations,
    );
    const eventId = 'https://radicale.example.test/team-calendar/event.ics';
    const validInput: CalendarEventInput = {
      uid: 'event@example.test',
      title: 'Event',
      timing: {
        type: 'timed',
        start: {
          type: 'zoned',
          local: '2026-10-03T12:00:00',
          timezone: 'UTC',
        },
        end: {
          type: 'zoned',
          local: '2026-10-03T13:00:00',
          timezone: 'UTC',
        },
      },
    };

    await expect(
      securedController.getEvent(
        userContext,
        openIdCredential,
        roomId,
        'team-calendar',
        eventId,
        'room',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      securedController.createEvent(
        userContext,
        openIdCredential,
        validInput,
        roomId,
        'team-calendar',
        'room',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      securedController.updateEvent(
        userContext,
        openIdCredential,
        { title: 'Updated' },
        '"event-v1"',
        roomId,
        'team-calendar',
        eventId,
        'room',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      securedController.deleteEvent(
        userContext,
        openIdCredential,
        '"event-v1"',
        roomId,
        'team-calendar',
        eventId,
        'room',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(isAllowed).toHaveBeenNthCalledWith(1, {
      action: 'read-events',
      calendarId: 'team-calendar',
    });
    expect(isAllowed).toHaveBeenNthCalledWith(2, {
      action: 'create-event',
      calendarId: 'team-calendar',
    });
    expect(isAllowed).toHaveBeenNthCalledWith(3, {
      action: 'update-event',
      calendarId: 'team-calendar',
      eventId,
    });
    expect(isAllowed).toHaveBeenNthCalledWith(4, {
      action: 'delete-event',
      calendarId: 'team-calendar',
      eventId,
    });
    expect(forAuthorizedTarget).not.toHaveBeenCalled();
    expect(operations.getEvent).not.toHaveBeenCalled();
    expect(operations.createEvent).not.toHaveBeenCalled();
    expect(operations.updateEvent).not.toHaveBeenCalled();
    expect(operations.deleteEvent).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('uses the write mode only after room create authorization', async () => {
    isAllowed.mockResolvedValue(true);
    const result = {
      event: { id: 'event.ics', calendarId: 'team-calendar', uid: 'event' },
      etag: '"event-v1"',
    };
    const operations = {
      createEvent: jest.fn().mockResolvedValue(result),
    } as unknown as RoomCalendarEventOperations;
    const principal: RoomCalendarCalDavPrincipal = {
      userId: '@_matrix_calendar_service:example.test',
      calendarUrl:
        'https://radicale.example.test/_matrix_calendar_service/team-calendar/',
      credential: {
        accessToken: 'service-openid-proof',
        matrixServerName: 'example.test',
      },
    };
    forAuthorizedTarget.mockResolvedValueOnce(principal);
    const controller = createController(
      appConfig,
      roomCalendarCalDavAccess,
      new MatrixOpenIdCalDavCredentialProviderFactory(),
      operations,
    );
    const input: CalendarEventInput = {
      uid: 'event@example.test',
      title: 'Event',
      timing: {
        type: 'timed',
        start: {
          type: 'zoned',
          local: '2026-10-03T12:00:00',
          timezone: 'UTC',
        },
        end: {
          type: 'zoned',
          local: '2026-10-03T13:00:00',
          timezone: 'UTC',
        },
      },
    };

    await expect(
      controller.createEvent(
        userContext,
        openIdCredential,
        input,
        roomId,
        'team-calendar',
        'room',
      ),
    ).resolves.toMatchObject({ event: result.event, etag: result.etag });

    expect(isAllowed).toHaveBeenCalledWith({
      action: 'create-event',
      calendarId: 'team-calendar',
    });
    expect(forAuthorizedTarget).toHaveBeenCalledWith(
      {
        roomId,
        calendarId: 'team-calendar',
        principal: { kind: 'service' },
      },
      'write',
    );
    expect(isAllowed.mock.invocationCallOrder[0]).toBeLessThan(
      forAuthorizedTarget.mock.invocationCallOrder[0],
    );
    expect(operations.createEvent).toHaveBeenCalledWith(
      {
        target: {
          roomId,
          calendarId: 'team-calendar',
          principal: { kind: 'service' },
        },
        servicePrincipal: principal,
      },
      input,
    );
  });

  it('sends actor-attributed opaque audit context only after room CalDAV writes succeed', async () => {
    isAllowed.mockResolvedValue(true);
    const collectionUrl =
      'https://radicale.example.test/_matrix_calendar_service/team-calendar/';
    const eventHref = `${collectionUrl}event.ics`;
    const principal: RoomCalendarCalDavPrincipal = {
      userId: '@_matrix_calendar_service:example.test',
      calendarUrl: collectionUrl,
      credential: {
        accessToken: 'service-openid-proof',
        matrixServerName: 'example.test',
      },
    };
    forAuthorizedTarget.mockResolvedValue(principal);

    const event: CalendarEvent = {
      id: eventHref,
      calendarId: 'team-calendar',
      uid: 'private-event-uid@example.test',
      title: 'Planning',
      timing: {
        type: 'timed',
        start: {
          type: 'zoned',
          local: '2026-10-03T12:00:00',
          timezone: 'UTC',
        },
        end: {
          type: 'zoned',
          local: '2026-10-03T13:00:00',
          timezone: 'UTC',
        },
      },
    };
    const order: string[] = [];
    const operations = {
      createEvent: jest.fn(async () => {
        order.push('caldav:create');
        return { event, etag: '"event-v1"' };
      }),
      updateEvent: jest.fn(async () => {
        order.push('caldav:update');
        return { event, etag: '"event-v2"' };
      }),
      deleteEvent: jest.fn(async () => {
        order.push('caldav:delete');
      }),
    } as unknown as RoomCalendarEventOperations;
    const record = jest.fn(async (context) => {
      order.push(`audit:${context.action}`);
    });
    const auditService = {
      record,
    } as unknown as RoomCalendarEventAuditService;
    const controller = createController(
      appConfig,
      roomCalendarCalDavAccess,
      new MatrixOpenIdCalDavCredentialProviderFactory(),
      operations,
      auditService,
    );
    const input: CalendarEventInput = {
      uid: 'event-uid@example.test',
      title: 'Planning',
      timing: event.timing,
    };

    await controller.createEvent(
      userContext,
      openIdCredential,
      input,
      roomId,
      'team-calendar',
      'room',
    );
    await controller.updateEvent(
      userContext,
      openIdCredential,
      { title: 'Planning' },
      '"event-v1"',
      roomId,
      'team-calendar',
      eventHref,
      'room',
    );
    await controller.deleteEvent(
      userContext,
      openIdCredential,
      '"event-v2"',
      roomId,
      'team-calendar',
      eventHref,
      'room',
    );

    expect(order).toEqual([
      'caldav:create',
      'audit:created',
      'caldav:update',
      'audit:updated',
      'caldav:delete',
      'audit:deleted',
    ]);
    expect(record).toHaveBeenNthCalledWith(1, {
      roomId,
      calendarId: 'team-calendar',
      actorUserId: userContext.userId,
      action: 'created',
      resourceId: 'event.ics',
      title: 'Planning',
    });
    expect(record).toHaveBeenNthCalledWith(2, {
      roomId,
      calendarId: 'team-calendar',
      actorUserId: userContext.userId,
      action: 'updated',
      resourceId: 'event.ics',
      title: 'Planning',
    });
    expect(record).toHaveBeenNthCalledWith(3, {
      roomId,
      calendarId: 'team-calendar',
      actorUserId: userContext.userId,
      action: 'deleted',
      resourceId: 'event.ics',
    });
    expect(JSON.stringify(record.mock.calls)).not.toContain(eventHref);
    expect(JSON.stringify(record.mock.calls)).not.toContain(
      'private-event-uid',
    );
    expect(JSON.stringify(record.mock.calls)).not.toContain(
      'service-openid-proof',
    );
  });

  it('preserves a successful CalDAV result when Matrix audit delivery fails', async () => {
    isAllowed.mockResolvedValue(true);
    const collectionUrl =
      'https://radicale.example.test/_matrix_calendar_service/team-calendar/';
    const event: CalendarEvent = {
      id: `${collectionUrl}event.ics`,
      calendarId: 'team-calendar',
      uid: 'event-uid@example.test',
      title: 'Planning',
      timing: {
        type: 'timed',
        start: {
          type: 'zoned',
          local: '2026-10-03T12:00:00',
          timezone: 'UTC',
        },
        end: {
          type: 'zoned',
          local: '2026-10-03T13:00:00',
          timezone: 'UTC',
        },
      },
    };
    const operations = {
      createEvent: jest.fn().mockResolvedValue({ event, etag: '"event-v1"' }),
    } as unknown as RoomCalendarEventOperations;
    const auditService = {
      record: jest.fn().mockRejectedValue(new Error('private Matrix failure')),
    } as unknown as RoomCalendarEventAuditService;
    forAuthorizedTarget.mockResolvedValue({
      userId: '@_matrix_calendar_service:example.test',
      calendarUrl: collectionUrl,
      credential: {
        accessToken: 'service-openid-proof',
        matrixServerName: 'example.test',
      },
    });
    const controller = createController(
      appConfig,
      roomCalendarCalDavAccess,
      new MatrixOpenIdCalDavCredentialProviderFactory(),
      operations,
      auditService,
    );

    await expect(
      controller.createEvent(
        userContext,
        openIdCredential,
        {
          uid: 'event-uid@example.test',
          title: 'Planning',
          timing: event.timing,
        },
        roomId,
        'team-calendar',
        'room',
      ),
    ).resolves.toMatchObject({ event, etag: '"event-v1"' });
  });

  it('does not send an audit notice when the room CalDAV mutation fails', async () => {
    isAllowed.mockResolvedValue(true);
    const record = jest.fn();
    const auditService = {
      record,
    } as unknown as RoomCalendarEventAuditService;
    const operations = {
      createEvent: jest.fn().mockRejectedValue(new Error('CalDAV failure')),
    } as unknown as RoomCalendarEventOperations;
    forAuthorizedTarget.mockResolvedValue({
      userId: '@_matrix_calendar_service:example.test',
      calendarUrl:
        'https://radicale.example.test/_matrix_calendar_service/team-calendar/',
      credential: {
        accessToken: 'service-openid-proof',
        matrixServerName: 'example.test',
      },
    });
    const controller = createController(
      appConfig,
      roomCalendarCalDavAccess,
      new MatrixOpenIdCalDavCredentialProviderFactory(),
      operations,
      auditService,
    );

    await expect(
      controller.createEvent(
        userContext,
        openIdCredential,
        {
          uid: 'event-uid@example.test',
          title: 'Planning',
          timing: {
            type: 'timed',
            start: {
              type: 'zoned',
              local: '2026-10-03T12:00:00',
              timezone: 'UTC',
            },
            end: {
              type: 'zoned',
              local: '2026-10-03T13:00:00',
              timezone: 'UTC',
            },
          },
        },
        roomId,
        'team-calendar',
        'room',
      ),
    ).rejects.toThrow('CalDAV failure');
    expect(record).not.toHaveBeenCalled();
  });

  it('rejects unsafe room event IDs before requesting an appservice proof', async () => {
    isAllowed.mockResolvedValue(true);
    const { controller } = createRoomTargetController();
    const invalidInput: CalendarEventInput = {
      uid: 'event%2foutside@example.test',
      title: 'Invalid event ID',
      timing: {
        type: 'timed',
        start: {
          type: 'zoned',
          local: '2026-10-03T12:00:00',
          timezone: 'UTC',
        },
        end: {
          type: 'zoned',
          local: '2026-10-03T13:00:00',
          timezone: 'UTC',
        },
      },
    };

    await expect(
      controller.createEvent(
        userContext,
        openIdCredential,
        invalidInput,
        roomId,
        'team-calendar',
        'room',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(isAllowed).toHaveBeenCalledWith({
      action: 'create-event',
      calendarId: 'team-calendar',
    });
    expect(forAuthorizedTarget).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps room calendar collection lifecycle operator-managed', async () => {
    isAllowed.mockResolvedValue(true);
    const { controller, forRequest } = createRoomTargetController();

    await expect(
      controller.createCalendar(
        userContext,
        openIdCredential,
        { name: 'Events' },
        roomId,
        'room',
      ),
    ).rejects.toMatchObject({
      response: { code: 'room-calendar-collection-operator-managed' },
    });

    expect(assertDisabled).not.toHaveBeenCalled();
    expect(forRequest).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
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
        description: 'Planning & review',
        color: '#336699ff',
        readOnly: false,
        supportedComponents: ['VEVENT', 'VTODO'],
      },
    ]);

    expect(forRoom).toHaveBeenCalledWith(userContext.userId, roomId);
    expect(isAllowed).toHaveBeenCalledWith({ action: 'list-calendars' });
  });

  it('returns only safe in-base collection URLs to calendar managers', async () => {
    canManageCalendars.mockResolvedValue(true);
    const config = {
      ...appConfig,
      radicale_url: 'https://radicale.example.test/radicale/',
    } as IAppConfiguration;
    fetch.mockResponses(
      [principalResponse('/radicale/principals/alice/'), { status: 207 }],
      [homeResponse('/radicale/alice/'), { status: 207 }],
      [
        multistatus(
          [
            diagnosticCalendarCollectionResponse('/radicale/', 'Service root'),
            diagnosticCalendarCollectionResponse(
              '/radicale/principals/alice/',
              'Principal root',
            ),
            diagnosticCalendarCollectionResponse(
              '/radicale/alice/',
              'Calendar home',
            ),
            diagnosticCalendarCollectionResponse(
              '/radicale/alice/team/',
              'Team events',
            ),
          ].join(''),
        ),
        { status: 207 },
      ],
    );

    const result = await createController(config).getCalendarDiagnostics(
      userContext,
      openIdCredential,
      roomId,
    );

    expect(result).toEqual({
      calendars: [
        {
          name: 'Team events',
          url: 'https://radicale.example.test/radicale/alice/team/',
        },
      ],
    });
    expect(result).not.toHaveProperty('principalUrl');
    expect(result).not.toHaveProperty('calendarHomeUrl');
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(JSON.stringify(result)).not.toContain('password');
    expect(canManageCalendars).toHaveBeenCalledWith(userContext.userId, roomId);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('fails diagnostics closed when discovery returns an unsafe collection href', async () => {
    canManageCalendars.mockResolvedValue(true);
    const config = {
      ...appConfig,
      radicale_url: 'https://radicale.example.test/radicale/',
    } as IAppConfiguration;
    fetch.mockResponses(
      [principalResponse('/radicale/principals/alice/'), { status: 207 }],
      [homeResponse('/radicale/alice/'), { status: 207 }],
      [
        multistatus(
          diagnosticCalendarCollectionResponse(
            'https://external.example.test/calendar/',
            'External collection',
          ),
        ),
        { status: 207 },
      ],
    );

    let caught: unknown;
    try {
      await createController(config).getCalendarDiagnostics(
        userContext,
        openIdCredential,
        roomId,
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ServiceUnavailableException);
    expect((caught as ServiceUnavailableException).getResponse()).toEqual({
      code: 'calendar-diagnostics-unavailable',
      message: 'CalDAV diagnostics are unavailable',
    });
    expect(JSON.stringify(caught)).not.toContain('external.example.test');
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('denies diagnostics before CalDAV discovery when manager permission is absent', async () => {
    canManageCalendars.mockResolvedValue(false);

    await expect(
      createController().getCalendarDiagnostics(
        userContext,
        openIdCredential,
        roomId,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(canManageCalendars).toHaveBeenCalledWith(userContext.userId, roomId);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not return CalDAV request details when diagnostics discovery fails', async () => {
    canManageCalendars.mockResolvedValue(true);
    fetch.mockResponseOnce(
      'Unavailable at https://radicale.example.test/private',
      {
        status: 503,
      },
    );

    try {
      await createController().getCalendarDiagnostics(
        userContext,
        openIdCredential,
        roomId,
      );
      throw new Error('Expected diagnostics discovery to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect((error as ServiceUnavailableException).getResponse()).toEqual({
        code: 'calendar-diagnostics-unavailable',
        message: 'CalDAV diagnostics are unavailable',
      });
      expect(JSON.stringify(error)).not.toContain('radicale.example.test');
      expect(JSON.stringify(error)).not.toContain('openid-token');
    }
  });

  it('creates an authorized VEVENT-only Radicale calendar', async () => {
    isAllowed.mockResolvedValue(true);
    fetch.mockResponses(
      [principalResponse('/principals/alice/'), { status: 207 }],
      [homeResponse('/alice/'), { status: 207 }],
      ['', { status: 201 }],
    );

    const result = await createController().createCalendar(
      userContext,
      openIdCredential,
      { name: ' Project Alpha ' },
      roomId,
    );

    expect(result).toEqual({
      id: expect.stringMatching(
        /^https:\/\/radicale\.example\.test\/alice\/calendar-[0-9a-f-]+\/$/,
      ),
      name: 'Project Alpha',
      color: undefined,
      readOnly: false,
    });
    expect(forRoom).toHaveBeenCalledWith(userContext.userId, roomId);
    expect(isAllowed).toHaveBeenCalledWith({ action: 'create-calendar' });

    const [, init] = fetch.mock.calls[2];
    expect(init?.method).toBe('MKCALENDAR');
    expect(init?.body).toContain(
      '<D:displayname>Project Alpha</D:displayname>',
    );
    expect(init?.body).toContain('<C:comp name="VEVENT"/>');
  });

  it('renames an authorized Radicale calendar display name', async () => {
    isAllowed.mockResolvedValue(true);
    const calendarId = 'https://radicale.example.test/alice/team/';
    fetch.mockResponseOnce(
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
    );

    await expect(
      createController().renameCalendar(
        userContext,
        openIdCredential,
        { name: ' Product calendar ' },
        roomId,
        calendarId,
      ),
    ).resolves.toBeUndefined();

    expect(forRoom).toHaveBeenCalledWith(userContext.userId, roomId);
    expect(isAllowed).toHaveBeenCalledWith({
      action: 'manage-calendar',
      calendarId,
    });

    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(calendarId);
    expect(init?.method).toBe('PROPPATCH');
    expect(init?.body).toContain(
      '<D:displayname>Product calendar</D:displayname>',
    );
  });

  it('denies calendar rename when room policy rejects manage-calendar', async () => {
    isAllowed.mockResolvedValue(false);
    const calendarId = 'https://radicale.example.test/alice/team/';

    await expect(
      createController().renameCalendar(
        userContext,
        openIdCredential,
        { name: 'Product calendar' },
        roomId,
        calendarId,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(fetch).not.toHaveBeenCalled();
  });

  it('updates only the calendar description after manage-calendar authorization', async () => {
    isAllowed.mockResolvedValue(true);
    const calendarId = 'https://radicale.example.test/alice/team/';
    fetch.mockResponseOnce(
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
    );

    await expect(
      createController().updateCalendarDescription(
        userContext,
        openIdCredential,
        { description: 'Plan <Q&A>' },
        roomId,
        calendarId,
      ),
    ).resolves.toBeUndefined();

    expect(forRoom).toHaveBeenCalledWith(userContext.userId, roomId);
    expect(isAllowed).toHaveBeenCalledWith({
      action: 'manage-calendar',
      calendarId,
    });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(calendarId);
    expect(init?.method).toBe('PROPPATCH');
    expect(init?.body).toContain(
      '<C:calendar-description>Plan &lt;Q&amp;A&gt;</C:calendar-description>',
    );
    expect(init?.body).not.toContain('displayname');
    expect(init?.body).not.toContain('calendar-color');
  });

  it('denies description updates when manage-calendar is not allowed', async () => {
    isAllowed.mockResolvedValue(false);

    await expect(
      createController().updateCalendarDescription(
        userContext,
        openIdCredential,
        { description: 'Not allowed' },
        roomId,
        'https://radicale.example.test/alice/team/',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(isAllowed).toHaveBeenCalledWith({
      action: 'manage-calendar',
      calendarId: 'https://radicale.example.test/alice/team/',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects description writes with missing or unrelated properties', async () => {
    await expect(
      createController().updateCalendarDescription(
        userContext,
        openIdCredential,
        {},
        roomId,
        'https://radicale.example.test/alice/team/',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      createController().updateCalendarDescription(
        userContext,
        openIdCredential,
        { description: 'text', color: '#ffffff' } as { description?: unknown },
        roomId,
        'https://radicale.example.test/alice/team/',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(forRoom).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('accepts an empty description as a clear operation', async () => {
    isAllowed.mockResolvedValue(true);
    fetch.mockResponseOnce(
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
    );

    await createController().updateCalendarDescription(
      userContext,
      openIdCredential,
      { description: '' },
      roomId,
      'https://radicale.example.test/alice/team/',
    );

    expect(fetch.mock.calls[0][1]?.body).toContain(
      '<D:remove><D:prop><C:calendar-description/></D:prop></D:remove>',
    );
  });

  it('updates only calendar-color after manage-calendar authorization', async () => {
    isAllowed.mockResolvedValue(true);
    const calendarId = 'https://radicale.example.test/alice/team/';
    fetch.mockResponseOnce(
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
    );

    await expect(
      createController().updateCalendarColor(
        userContext,
        openIdCredential,
        { color: '#Ab12cD' },
        roomId,
        calendarId,
      ),
    ).resolves.toBeUndefined();

    expect(forRoom).toHaveBeenCalledWith(userContext.userId, roomId);
    expect(isAllowed).toHaveBeenCalledWith({
      action: 'manage-calendar',
      calendarId,
    });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(calendarId);
    expect(init?.method).toBe('PROPPATCH');
    expect(init?.body).toContain(
      '<A:calendar-color>#Ab12cD</A:calendar-color>',
    );
    expect(init?.body).not.toContain('calendar-description');
    expect(init?.body).not.toContain('displayname');
  });

  it('denies calendar-color updates without manage-calendar permission', async () => {
    isAllowed.mockResolvedValue(false);

    await expect(
      createController().updateCalendarColor(
        userContext,
        openIdCredential,
        { color: '#123456' },
        roomId,
        'https://radicale.example.test/alice/team/',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(isAllowed).toHaveBeenCalledWith({
      action: 'manage-calendar',
      calendarId: 'https://radicale.example.test/alice/team/',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects invalid or mixed calendar-color writes before CalDAV access', async () => {
    const controller = createController();
    const calendarId = 'https://radicale.example.test/alice/team/';

    for (const body of [
      undefined,
      {},
      { color: 'red' },
      { color: '#12345678' },
      { color: '#12345G' },
      { color: '#123456', description: 'also update description' },
    ]) {
      await expect(
        controller.updateCalendarColor(
          userContext,
          openIdCredential,
          body,
          roomId,
          calendarId,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    }

    expect(forRoom).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('accepts empty calendar-color as an explicit clear', async () => {
    isAllowed.mockResolvedValue(true);
    fetch.mockResponseOnce(
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
    );

    await createController().updateCalendarColor(
      userContext,
      openIdCredential,
      { color: '' },
      roomId,
      'https://radicale.example.test/alice/team/',
    );

    expect(fetch.mock.calls[0][1]?.body).toContain(
      '<D:remove><D:prop><A:calendar-color/></D:prop></D:remove>',
    );
  });

  it('rejects an empty calendar rename before CalDAV access', async () => {
    await expect(
      createController().renameCalendar(
        userContext,
        openIdCredential,
        { name: '   ' },
        roomId,
        'https://radicale.example.test/alice/team/',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(forRoom).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects calendar rename targets outside the configured Radicale service', async () => {
    isAllowed.mockResolvedValue(true);

    await expect(
      createController().renameCalendar(
        userContext,
        openIdCredential,
        { name: 'Nope' },
        roomId,
        'https://attacker.example.test/calendar/',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(fetch).not.toHaveBeenCalled();
  });

  it('deletes an authorized explicitly VEVENT-only calendar', async () => {
    isAllowed.mockResolvedValue(true);
    const calendarId = 'https://radicale.example.test/alice/team/';
    fetch.mockResponses(
      [principalResponse('/principals/alice/'), { status: 207 }],
      [homeResponse('/alice/'), { status: 207 }],
      [calendarCollectionResponse(['VEVENT']), { status: 207 }],
      ['', { status: 204 }],
    );

    await expect(
      createController().deleteCalendar(
        userContext,
        openIdCredential,
        roomId,
        calendarId,
      ),
    ).resolves.toBeUndefined();

    expect(isAllowed).toHaveBeenCalledWith({
      action: 'manage-calendar',
      calendarId,
    });
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(fetch.mock.calls[3][0]).toBe(calendarId);
    expect(fetch.mock.calls[3][1]?.method).toBe('DELETE');
  });

  it('denies calendar deletion when room policy rejects manage-calendar', async () => {
    isAllowed.mockResolvedValue(false);
    const calendarId = 'https://radicale.example.test/alice/team/';

    await expect(
      createController().deleteCalendar(
        userContext,
        openIdCredential,
        roomId,
        calendarId,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects calendar deletion targets outside the configured Radicale service', async () => {
    isAllowed.mockResolvedValue(true);

    await expect(
      createController().deleteCalendar(
        userContext,
        openIdCredential,
        roomId,
        'https://attacker.example.test/calendar/',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['mixed', ['VEVENT', 'VTODO'], true],
    ['unknown', undefined, true],
    ['read-only', ['VEVENT'], false],
  ] as const)(
    'refuses to delete a %s calendar collection before DELETE',
    async (_kind, components, writable) => {
      isAllowed.mockResolvedValue(true);
      const calendarId = 'https://radicale.example.test/alice/team/';
      fetch.mockResponses(
        [principalResponse('/principals/alice/'), { status: 207 }],
        [homeResponse('/alice/'), { status: 207 }],
        [calendarCollectionResponse(components, writable), { status: 207 }],
      );

      try {
        await createController().deleteCalendar(
          userContext,
          openIdCredential,
          roomId,
          calendarId,
        );
        throw new Error('Expected unsafe calendar deletion to be rejected');
      } catch (error) {
        expect(error).toBeInstanceOf(ConflictException);
        expect((error as ConflictException).getResponse()).toEqual({
          code: 'calendar-delete-unsafe',
          message:
            'Calendar deletion is only allowed for explicitly VEVENT-only collections',
        });
      }

      expect(fetch).toHaveBeenCalledTimes(3);
      expect(
        fetch.mock.calls.every(([, init]) => init?.method !== 'DELETE'),
      ).toBe(true);
    },
  );

  it('refuses deletion when a PROPFIND safety property has a failed status', async () => {
    isAllowed.mockResolvedValue(true);
    const calendarId = 'https://radicale.example.test/alice/team/';
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
              <d:status>HTTP/1.1 200 OK</d:status>
            </d:propstat>
          </d:response>
        `),
        { status: 207 },
      ],
    );

    await expect(
      createController().deleteCalendar(
        userContext,
        openIdCredential,
        roomId,
        calendarId,
      ),
    ).rejects.toMatchObject({
      response: {
        code: 'calendar-delete-unsafe',
      },
    });

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(
      fetch.mock.calls.every(([, init]) => init?.method !== 'DELETE'),
    ).toBe(true);
  });

  it('refuses deletion when the requested collection is not discoverable', async () => {
    isAllowed.mockResolvedValue(true);
    const calendarId = 'https://radicale.example.test/alice/team/';
    fetch.mockResponses(
      [principalResponse('/principals/alice/'), { status: 207 }],
      [homeResponse('/alice/'), { status: 207 }],
      [
        calendarCollectionResponse(['VEVENT'], true, '/alice/other/'),
        {
          status: 207,
        },
      ],
    );

    await expect(
      createController().deleteCalendar(
        userContext,
        openIdCredential,
        roomId,
        calendarId,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(
      fetch.mock.calls.every(([, init]) => init?.method !== 'DELETE'),
    ).toBe(true);
  });

  it('denies calendar creation when room policy rejects it', async () => {
    isAllowed.mockResolvedValue(false);

    await expect(
      createController().createCalendar(
        userContext,
        openIdCredential,
        { name: 'Project Alpha' },
        roomId,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects an empty calendar name before CalDAV access', async () => {
    await expect(
      createController().createCalendar(
        userContext,
        openIdCredential,
        { name: '   ' },
        roomId,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(forRoom).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
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
        'UTC',
      ),
    ).resolves.toEqual({
      events: [
        {
          event: expect.objectContaining({
            id: 'https://radicale.example.test/alice/team/event.ics',
            calendarId,
            uid: 'event@example.test',
            title: 'Team planning',
          }),
          etag: '"event-etag"',
        },
      ],
      diagnostics: [],
    });

    expect(isAllowed).toHaveBeenCalledWith({
      action: 'read-events',
      calendarId,
    });
    expect(fetch.mock.calls[0][1]?.method).toBe('REPORT');
  });

  it('returns an opaque gateway error for a CalDAV event redirect', async () => {
    isAllowed.mockResolvedValue(true);
    fetch.mockResponseOnce('secret upstream body', {
      status: 302,
      headers: {
        Location: 'https://redirect.example.test/?access_token=secret-value',
      },
    });

    const error = await createController()
      .listEvents(
        userContext,
        openIdCredential,
        roomId,
        'https://radicale.example.test/alice/team/',
        '2026-09-24T00:00:00Z',
        '2026-09-25T00:00:00Z',
        'UTC',
      )
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BadGatewayException);
    expect((error as BadGatewayException).getResponse()).toEqual({
      code: 'caldav-upstream-error',
      message: 'CalDAV event request failed',
    });
    expect(
      JSON.stringify((error as BadGatewayException).getResponse()),
    ).not.toContain('secret-value');
    expect(fetch.mock.calls[0][1]?.redirect).toBe('manual');
  });

  it('suppresses ordinary CalDAV candidates outside the requested range', async () => {
    isAllowed.mockResolvedValue(true);
    const calendarId = 'https://radicale.example.test/alice/team/';
    fetch.mockResponseOnce(
      multistatus(
        eventResourceResponse(
          '/alice/team/outside.ics',
          '"outside-etag"',
          simpleEventIcs('Private outside event'),
        ),
      ),
      { status: 207 },
    );

    const response = await createController().listEvents(
      userContext,
      openIdCredential,
      roomId,
      calendarId,
      '2026-09-24T10:00:00Z',
      '2026-09-24T11:00:00Z',
      'UTC',
    );

    expect(response).toEqual({ events: [], diagnostics: [] });
    expect(JSON.stringify(response)).not.toContain('Private outside event');
    expect(JSON.stringify(response)).not.toContain('outside-etag');
    expect(fetch.mock.calls[0][1]?.method).toBe('REPORT');
  });

  it('projects an embedded VTIMEZONE that exactly matches bundled IANA rules', async () => {
    isAllowed.mockResolvedValue(true);
    const calendarId = 'https://radicale.example.test/alice/team/';
    const etag = '"bundled-timezone-etag"';
    fetch.mockResponseOnce(
      multistatus(
        eventResourceResponse(
          '/alice/team/bundled-timezone.ics',
          etag,
          readFixture('vtimezone-stockholm-bundled-transition.ics'),
        ),
      ),
      { status: 207 },
    );

    const response = await createController().listEvents(
      userContext,
      openIdCredential,
      roomId,
      calendarId,
      '2026-10-25T02:00:00Z',
      '2026-10-25T03:00:00Z',
      'UTC',
    );

    expect(response.events).toEqual([
      {
        event: expect.objectContaining({
          id: 'https://radicale.example.test/alice/team/bundled-timezone.ics',
          title: 'Stockholm transition projection fixture',
        }),
        etag,
      },
    ]);
    expect(response.diagnostics).toEqual([]);
  });

  it('returns only a count diagnostic for a divergent recognized VTIMEZONE near its transition', async () => {
    isAllowed.mockResolvedValue(true);
    const calendarId = 'https://radicale.example.test/alice/team/';
    fetch.mockResponseOnce(
      multistatus(
        eventResourceResponse(
          '/alice/team/divergent-timezone.ics',
          '"divergent-timezone-etag"',
          readFixture('vtimezone-stockholm-divergent-transition.ics'),
        ),
      ),
      { status: 207 },
    );

    const response = await createController().listEvents(
      userContext,
      openIdCredential,
      roomId,
      calendarId,
      '2026-10-25T01:00:00Z',
      '2026-10-25T02:00:00Z',
      'UTC',
    );

    expect(response).toEqual({
      events: [],
      diagnostics: [{ reason: 'unsupported-timezone', count: 1 }],
    });
    const responseText = JSON.stringify(response);
    expect(responseText).not.toContain(
      'Stockholm transition projection fixture',
    );
    expect(responseText).not.toContain('divergent-timezone-etag');
    expect(responseText).not.toContain('Europe/Stockholm');
    expect(responseText).not.toContain('VTIMEZONE');
  });

  it('suppresses multiple master RRULEs and returns only a count diagnostic', async () => {
    isAllowed.mockResolvedValue(true);
    const calendarId = 'https://radicale.example.test/alice/team/';
    fetch.mockResponseOnce(
      multistatus(
        eventResourceResponse(
          '/alice/team/multiple-rules.ics',
          '"multiple-rules-etag"',
          readFixture('recurrence-multiple-master-rules.ics'),
        ),
      ),
      { status: 207 },
    );

    const response = await createController().listEvents(
      userContext,
      openIdCredential,
      roomId,
      calendarId,
      '2026-09-24T09:00:00Z',
      '2026-09-24T10:00:00Z',
      'UTC',
    );

    expect(response).toEqual({
      events: [],
      diagnostics: [{ reason: 'unsupported-recurrence', count: 1 }],
    });
    const responseText = JSON.stringify(response);
    expect(responseText).not.toContain('Private multiple-rule event');
    expect(responseText).not.toContain('multiple-rules-etag');
    expect(responseText).not.toContain('multiple-rules@example.test');
    expect(responseText).not.toContain('RRULE');
    expect(fetch.mock.calls[0][1]?.method).toBe('REPORT');
  });

  it('keeps a recurring source resource when only an occurrence intersects', async () => {
    isAllowed.mockResolvedValue(true);
    const calendarId = 'https://radicale.example.test/alice/team/';
    const href = '/alice/team/daily.ics';
    const etag = '"daily-etag"';
    const icalendar = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Matrix Calendar Widget Tests//EN
BEGIN:VEVENT
UID:daily@example.test
DTSTART:20260920T080000Z
DTEND:20260920T090000Z
RRULE:FREQ=DAILY;COUNT=10
SUMMARY:Daily planning
END:VEVENT
END:VCALENDAR`;
    fetch.mockResponseOnce(
      multistatus(eventResourceResponse(href, etag, icalendar)),
      { status: 207 },
    );

    const response = await createController().listEvents(
      userContext,
      openIdCredential,
      roomId,
      calendarId,
      '2026-09-24T08:30:00Z',
      '2026-09-24T09:30:00Z',
      'UTC',
    );

    expect(response).toEqual({
      events: [
        {
          event: expect.objectContaining({
            id: 'https://radicale.example.test/alice/team/daily.ics',
            calendarId,
            uid: 'daily@example.test',
            title: 'Daily planning',
          }),
          etag,
        },
      ],
      diagnostics: [],
    });
  });

  it('uses the explicit viewer timezone for DATE and floating range boundaries', async () => {
    isAllowed.mockResolvedValue(true);
    const calendarId = 'https://radicale.example.test/alice/team/';
    const resources = [
      eventResourceResponse(
        '/alice/team/all-day.ics',
        '"date-etag"',
        `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Matrix Calendar Widget Tests//EN
BEGIN:VEVENT
UID:date@example.test
DTSTART;VALUE=DATE:20260924
DTEND;VALUE=DATE:20260925
SUMMARY:Local date boundary
END:VEVENT
END:VCALENDAR`,
      ),
      eventResourceResponse(
        '/alice/team/floating.ics',
        '"floating-etag"',
        `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Matrix Calendar Widget Tests//EN
BEGIN:VEVENT
UID:floating@example.test
DTSTART:20260924T003000
DTEND:20260924T013000
SUMMARY:Floating boundary
END:VEVENT
END:VCALENDAR`,
      ),
    ].join('');
    fetch.mockResponses(
      [multistatus(resources), { status: 207 }],
      [multistatus(resources), { status: 207 }],
    );

    const range = {
      start: '2026-09-23T22:15:00Z',
      end: '2026-09-23T22:45:00Z',
    };
    const utcResponse = await createController().listEvents(
      userContext,
      openIdCredential,
      roomId,
      calendarId,
      range.start,
      range.end,
      'UTC',
    );
    const stockholmResponse = await createController().listEvents(
      userContext,
      openIdCredential,
      roomId,
      calendarId,
      range.start,
      range.end,
      'Europe/Stockholm',
    );

    expect(utcResponse.events).toEqual([]);
    expect(stockholmResponse.events.map(({ event }) => event.uid)).toEqual([
      'date@example.test',
      'floating@example.test',
    ]);
    expect(utcResponse.diagnostics).toEqual([]);
    expect(stockholmResponse.diagnostics).toEqual([]);
  });

  it('returns only a count diagnostic for THISANDFUTURE range overrides', async () => {
    isAllowed.mockResolvedValue(true);
    const calendarId = 'https://radicale.example.test/alice/team/';
    fetch.mockResponseOnce(
      multistatus(`
        <d:response>
          <d:href>/alice/team/range-series.ics</d:href>
          <d:propstat>
            <d:prop>
              <d:getetag>"range-etag"</d:getetag>
              <c:calendar-data>${rangeOverrideEventIcs()}</c:calendar-data>
            </d:prop>
            <d:status>HTTP/1.1 200 OK</d:status>
          </d:propstat>
        </d:response>
      `),
      { status: 207 },
    );

    const response = await createController().listEvents(
      userContext,
      openIdCredential,
      roomId,
      calendarId,
      '2026-10-01T00:00:00Z',
      '2026-10-15T00:00:00Z',
      'UTC',
    );

    expect(response).toEqual({
      events: [],
      diagnostics: [{ reason: 'range-this-and-future', count: 1 }],
    });
    expect(JSON.stringify(response)).not.toContain('Planning');
    expect(JSON.stringify(response)).not.toContain('range-etag');
    expect(fetch).toHaveBeenCalledTimes(1);
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

  it('round-trips a serialized RDATE patch through the gateway with If-Match', async () => {
    isAllowed.mockResolvedValue(true);
    const calendarId = 'https://radicale.example.test/alice/team/';
    const eventId = 'https://radicale.example.test/alice/team/recurrence.ics';
    const originalIcs = readFixture('recurrence-override.ics');
    const patch = JSON.parse(
      JSON.stringify({
        recurrence: {
          rdate: {
            action: 'add',
            value: {
              type: 'date-time',
              value: {
                local: '2026-10-27T09:30:00',
                timezone: 'Europe/Stockholm',
              },
            },
          },
        },
      }),
    ) as CalendarEventPatch;
    const updatedIcs = new ICalendarEventCodec()
      .parse(calendarId, eventId, originalIcs)
      .applyPatch(patch).icalendar;
    fetch
      .mockResponseOnce(originalIcs, {
        status: 200,
        headers: { ETag: '"old-etag"' },
      })
      .mockResponseOnce('', {
        status: 200,
        headers: { ETag: '"new-etag"' },
      })
      .mockResponseOnce(updatedIcs, {
        status: 200,
        headers: { ETag: '"new-etag"' },
      });

    const result = await createController().updateEvent(
      userContext,
      openIdCredential,
      patch,
      '"old-etag"',
      roomId,
      calendarId,
      eventId,
    );

    expect(result.etag).toBe('"new-etag"');
    expect(result.event.recurrence?.rdates).toContainEqual({
      type: 'date-time',
      value: {
        local: '2026-10-27T09:30:00',
        timezone: 'Europe/Stockholm',
      },
    });
    expect(result.event.recurrence?.exdates).toHaveLength(2);
    const [, putInit] = fetch.mock.calls[1];
    expect(putInit?.method).toBe('PUT');
    expect(new Headers(putInit?.headers).get('If-Match')).toBe('"old-etag"');
    expect(putInit?.body).toContain(
      'RDATE;TZID=Europe/Stockholm:20261027T093000',
    );
    expect(putInit?.body).toContain(
      'EXDATE;TZID=Europe/Stockholm:20261102T140000',
    );
    expect(putInit?.body).toContain('X-CLIENT-METADATA;X-PARAM=preserve-param');
    expect(putInit?.body).toContain('BEGIN:VALARM');
    expect(putInit?.body).toContain('RECURRENCE-ID;TZID=Europe/Stockholm');
  });

  it('removes one PERIOD RDATE through the gateway with If-Match', async () => {
    isAllowed.mockResolvedValue(true);
    const calendarId = 'https://radicale.example.test/alice/team/';
    const eventId = 'https://radicale.example.test/alice/team/period.ics';
    const originalIcs = readFixture('recurrence-override.ics').replace(
      'RDATE;TZID=Europe/Stockholm:20261026T140000',
      [
        'RDATE;TZID=Europe/Stockholm:20261026T140000',
        'RDATE;VALUE=PERIOD;TZID=Europe/Stockholm;X-KEEP=period:20261027T093000/PT1H',
      ].join('\r\n'),
    );
    const patch = JSON.parse(
      JSON.stringify({
        recurrence: {
          rdate: {
            action: 'remove-period',
            value: {
              type: 'period',
              timing: {
                type: 'duration',
                start: {
                  type: 'date-time',
                  value: {
                    local: '2026-10-27T09:30:00',
                    timezone: 'Europe/Stockholm',
                  },
                },
                duration: {
                  weeks: 0,
                  days: 0,
                  hours: 1,
                  minutes: 0,
                  seconds: 0,
                  isNegative: false,
                },
              },
            },
          },
        },
      }),
    ) as CalendarEventPatch;
    const updatedIcs = new ICalendarEventCodec()
      .parse(calendarId, eventId, originalIcs)
      .applyPatch(patch).icalendar;
    fetch
      .mockResponseOnce(originalIcs, {
        status: 200,
        headers: { ETag: '"old-etag"' },
      })
      .mockResponseOnce('', {
        status: 200,
        headers: { ETag: '"new-etag"' },
      })
      .mockResponseOnce(updatedIcs, {
        status: 200,
        headers: { ETag: '"new-etag"' },
      });

    const result = await createController().updateEvent(
      userContext,
      openIdCredential,
      patch,
      '"old-etag"',
      roomId,
      calendarId,
      eventId,
    );

    expect(result.event.recurrence?.rdates).toHaveLength(3);
    expect(result.event.recurrence?.rdates).toContainEqual({
      type: 'date-time',
      value: {
        local: '2026-10-26T14:00:00',
        timezone: 'Europe/Stockholm',
      },
    });
    expect(result.event.recurrence?.rdates).toContainEqual({
      type: 'period',
      timing: {
        type: 'end',
        start: {
          type: 'date-time',
          value: {
            local: '2026-10-28T14:00:00',
            timezone: 'Europe/Stockholm',
          },
        },
        end: {
          type: 'date-time',
          value: {
            local: '2026-10-28T15:30:00',
            timezone: 'Europe/Stockholm',
          },
        },
      },
    });
    expect(result.event.recurrence?.rdates).toContainEqual({
      type: 'period',
      timing: {
        type: 'duration',
        start: {
          type: 'date-time',
          value: {
            local: '2026-10-29T14:00:00',
            timezone: 'Europe/Stockholm',
          },
        },
        duration: {
          weeks: 0,
          days: 0,
          hours: 1,
          minutes: 30,
          seconds: 0,
          isNegative: false,
        },
      },
    });
    const [, putInit] = fetch.mock.calls[1];
    expect(new Headers(putInit?.headers).get('If-Match')).toBe('"old-etag"');
    expect(putInit?.body).not.toContain('X-KEEP=period');
    expect(putInit?.body).toContain('VALUE=PERIOD');
    expect(putInit?.body).toContain('20261028T140000/20261028T153000');
    expect(putInit?.body).toContain(
      'RDATE;TZID=Europe/Stockholm:20261026T140000',
    );
    expect(putInit?.body).toContain('BEGIN:VTIMEZONE');
    expect(putInit?.body).toContain('RECURRENCE-ID;TZID=Europe/Stockholm');
  });

  it('removes a VALARM from persisted CalDAV data after JSON serialization', async () => {
    isAllowed.mockResolvedValue(true);
    const calendarId = 'https://radicale.example.test/alice/team/';
    const eventId = 'https://radicale.example.test/alice/team/alarm.ics';
    const originalIcs = readFixture('alarm.ics')
      .replace(
        'PRODID:-//Matrix Calendar Widget//Fixtures//EN',
        'PRODID:-//Matrix Calendar Widget//Fixtures//EN\nX-RESOURCE-METADATA:preserve',
      )
      .replace(
        'SUMMARY:Release checkpoint',
        'SUMMARY:Release checkpoint\nX-EVENT-METADATA:preserve',
      );
    const persistedIcs = originalIcs.replace(
      'BEGIN:VALARM\nACTION:DISPLAY\nTRIGGER:-PT15M\nDESCRIPTION:Release checkpoint starts in 15 minutes\nEND:VALARM\n',
      '',
    );
    const removePatch = JSON.parse(
      JSON.stringify({ alarm: { operation: 'remove' } }),
    ) as CalendarEventPatch;

    fetch
      .mockResponseOnce(originalIcs, {
        status: 200,
        headers: { ETag: '"old-etag"' },
      })
      .mockResponseOnce('', {
        status: 200,
        headers: { ETag: '"new-etag"' },
      })
      .mockResponseOnce(persistedIcs, {
        status: 200,
        headers: { ETag: '"new-etag"' },
      });

    const result = await createController().updateEvent(
      userContext,
      openIdCredential,
      removePatch,
      '"old-etag"',
      roomId,
      calendarId,
      eventId,
    );

    expect(result.event.alarm).toBeUndefined();
    expect(result.etag).toBe('"new-etag"');
    const [, putInit] = fetch.mock.calls[1];
    const writtenIcs = putInit?.body as string;
    expect(writtenIcs).not.toContain('BEGIN:VALARM');
    expect(writtenIcs).toContain('X-RESOURCE-METADATA:preserve');
    expect(writtenIcs).toContain('X-EVENT-METADATA:preserve');
    expect(persistedIcs).not.toContain('BEGIN:VALARM');
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
    fetch
      .mockResponseOnce(simpleEventIcs(), {
        status: 200,
        headers: { ETag: '"event-etag"' },
      })
      .mockResponseOnce('', { status: 200 });

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
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0][1]?.method).toBe('GET');
    const [, init] = fetch.mock.calls[1];
    expect(init?.method).toBe('DELETE');
    expect(new Headers(init?.headers).get('If-Match')).toBe('"event-etag"');
  });

  it('refuses to delete a mixed personal resource before DELETE', async () => {
    isAllowed.mockResolvedValue(true);
    const calendarId = 'https://radicale.example.test/alice/team/';
    const eventId = 'https://radicale.example.test/alice/team/event.ics';
    fetch.mockResponseOnce(readFixture('mixed-components.ics'), {
      status: 200,
      headers: { ETag: '"mixed-etag"' },
    });

    await expect(
      createController().deleteEvent(
        userContext,
        openIdCredential,
        '"mixed-etag"',
        roomId,
        calendarId,
        eventId,
      ),
    ).rejects.toMatchObject({
      response: { code: 'unsafe-event-resource' },
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1]?.method).toBe('GET');
  });

  it.each([
    [
      'a VTODO nested in VEVENT',
      simpleEventIcs().replace(
        'END:VEVENT',
        'BEGIN:VTODO\nUID:task@example.test\nEND:VTODO\nEND:VEVENT',
      ),
    ],
    [
      'an unknown component nested in VALARM',
      simpleEventIcs().replace(
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
      simpleEventIcs().replace(
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
  ])(
    'refuses to delete personal resources containing %s',
    async (_description, icalendar) => {
      isAllowed.mockResolvedValue(true);
      const calendarId = 'https://radicale.example.test/alice/team/';
      const eventId = 'https://radicale.example.test/alice/team/event.ics';
      fetch.mockResponseOnce(icalendar, {
        status: 200,
        headers: { ETag: '"nested-etag"' },
      });

      await expect(
        createController().deleteEvent(
          userContext,
          openIdCredential,
          '"nested-etag"',
          roomId,
          calendarId,
          eventId,
        ),
      ).rejects.toMatchObject({ response: { code: 'unsafe-event-resource' } });

      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch.mock.calls[0][1]?.method).toBe('GET');
    },
  );

  it('rejects stale or wildcard personal delete validators before DELETE', async () => {
    isAllowed.mockResolvedValue(true);
    const calendarId = 'https://radicale.example.test/alice/team/';
    const eventId = 'https://radicale.example.test/alice/team/event.ics';
    fetch.mockResponseOnce(simpleEventIcs(), {
      status: 200,
      headers: { ETag: '"current-etag"' },
    });

    await expect(
      createController().deleteEvent(
        userContext,
        openIdCredential,
        '"stale-etag"',
        roomId,
        calendarId,
        eventId,
      ),
    ).rejects.toMatchObject({ response: { code: 'etag-conflict' } });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1]?.method).toBe('GET');

    fetch.mockReset();
    await expect(
      createController().deleteEvent(
        userContext,
        openIdCredential,
        '*',
        roomId,
        calendarId,
        eventId,
      ),
    ).rejects.toMatchObject({ response: { code: 'invalid-event-etag' } });
    expect(fetch).not.toHaveBeenCalled();
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
        'UTC',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([undefined, 'Custom/Unbundled'])(
    'rejects absent or unsupported viewer timezones before CalDAV access',
    async (timezone) => {
      isAllowed.mockResolvedValue(true);

      await expect(
        createController().listEvents(
          userContext,
          openIdCredential,
          roomId,
          'https://radicale.example.test/alice/team/',
          '2026-09-24T00:00:00Z',
          '2026-09-25T00:00:00Z',
          timezone,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(fetch).not.toHaveBeenCalled();
    },
  );

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

function calendarCollectionResponse(
  components?: readonly string[],
  writable = true,
  href = '/alice/team/',
): string {
  const componentSet = components
    ? `
        <c:supported-calendar-component-set>
          ${components
            .map((component) => `<c:comp name="${component}"/>`)
            .join('')}
        </c:supported-calendar-component-set>`
    : '';

  return multistatus(`
    <d:response>
      <d:href>${href}</d:href>
      <d:propstat>
        <d:prop>
          <d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
          <d:displayname>Team events</d:displayname>
          ${componentSet}
          <d:current-user-privilege-set>
            <d:privilege><d:read/></d:privilege>
            ${writable ? '<d:privilege><d:write/></d:privilege>' : ''}
          </d:current-user-privilege-set>
        </d:prop>
        <d:status>HTTP/1.1 200 OK</d:status>
      </d:propstat>
    </d:response>
  `);
}

function diagnosticCalendarCollectionResponse(
  href: string,
  displayName: string,
): string {
  return `
    <d:response>
      <d:href>${href}</d:href>
      <d:propstat>
        <d:prop>
          <d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
          <d:displayname>${displayName}</d:displayname>
          <c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set>
        </d:prop>
        <d:status>HTTP/1.1 200 OK</d:status>
      </d:propstat>
    </d:response>`;
}

function eventResourceResponse(
  href: string,
  etag: string,
  icalendar: string,
): string {
  return `
    <d:response>
      <d:href>${href}</d:href>
      <d:propstat>
        <d:prop>
          <d:getetag>${etag}</d:getetag>
          <c:calendar-data>${icalendar}</c:calendar-data>
        </d:prop>
        <d:status>HTTP/1.1 200 OK</d:status>
      </d:propstat>
    </d:response>`;
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

function readFixture(name: string): string {
  return fs.readFileSync(
    path.resolve(__dirname, '../../../fixtures/ical', name),
    'utf8',
  );
}

function rangeOverrideEventIcs(): string {
  return `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Matrix Calendar Widget Tests//EN
BEGIN:VEVENT
UID:range-series@example.test
DTSTART:20261001T090000Z
DTEND:20261001T100000Z
RRULE:FREQ=WEEKLY;COUNT=4
SUMMARY:Planning
END:VEVENT
BEGIN:VEVENT
UID:range-series@example.test
RECURRENCE-ID;RANGE=THISANDFUTURE:20261008T090000Z
DTSTART:20261008T110000Z
DTEND:20261008T120000Z
SUMMARY:Planning shifted
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
