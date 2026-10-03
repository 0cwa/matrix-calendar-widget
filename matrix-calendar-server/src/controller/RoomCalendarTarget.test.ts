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

import type { CalendarAuthorizationRequest } from '@matrix-calendar-widget/calendar';
import { ForbiddenException } from '@nestjs/common';
import fetch from 'jest-fetch-mock';
import { IAppConfiguration } from '../IAppConfiguration';
import { MatrixOpenIdCalDavCredentialProviderFactory } from '../caldav/MatrixOpenIdCalDavCredentialProviderFactory';
import { MatrixCalendarAuthorizationFactory } from '../service/MatrixCalendarAuthorization';
import { RoomCalendarCalDavAccess } from '../service/RoomCalendarCalDavAccess';
import { CalendarGatewayController } from './CalendarGatewayController';

const roomId = '!calendar-room:example.test';
const calendarId = 'room-calendar';
const userContext = {
  userId: '@actor:example.test',
  locale: 'en',
  timezone: 'UTC',
};
const configuration = {
  homeserver_url: 'https://matrix.example.test',
  radicale_url: 'https://radicale.example.test/',
  room_calendar_bindings: [{ roomId, calendarId }],
} as unknown as IAppConfiguration;

describe('room calendar event listing', () => {
  const isAllowed = jest.fn(
    async (_request: CalendarAuthorizationRequest): Promise<boolean> => false,
  );
  const forRoom = jest.fn(() => ({ isAllowed }));
  const authorizationFactory = {
    forRoom,
  } as unknown as MatrixCalendarAuthorizationFactory;
  const forAuthorizedTarget = jest.fn();
  const roomAccess = {
    forAuthorizedTarget,
  } as unknown as RoomCalendarCalDavAccess;

  beforeEach(() => {
    fetch.resetMocks();
    fetch.enableMocks();
    isAllowed.mockReset();
    isAllowed.mockResolvedValue(false);
    forRoom.mockReset();
    forRoom.mockImplementation(() => ({ isAllowed }));
    forAuthorizedTarget.mockReset();
  });

  it('authorizes and resolves the exact binding before requesting a proof or CalDAV', async () => {
    isAllowed.mockResolvedValue(true);
    forAuthorizedTarget.mockResolvedValue({
      userId: '@_matrix_calendar_service:example.test',
      calendarUrl:
        'https://radicale.example.test/matrix_calendar_service/room-calendar/',
      credential: {
        accessToken: 'synthetic-openid-proof',
        matrixServerName: 'example.test',
      },
    });
    fetch.mockResponseOnce(
      '<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"></d:multistatus>',
      { status: 207 },
    );
    const controller = createController();

    await expect(
      controller.listEvents(
        userContext,
        undefined,
        roomId,
        calendarId,
        '2026-01-01T00:00:00.000Z',
        '2026-01-02T00:00:00.000Z',
        'UTC',
        'room',
      ),
    ).resolves.toMatchObject({ events: [] });

    expect(forRoom).toHaveBeenCalledWith(userContext.userId, roomId);
    expect(isAllowed).toHaveBeenCalledWith({
      action: 'read-events',
      calendarId,
    });
    expect(forAuthorizedTarget).toHaveBeenCalledWith({
      roomId,
      calendarId,
      principal: { kind: 'service' },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe(
      'https://radicale.example.test/matrix_calendar_service/room-calendar/',
    );
    expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'REPORT' });
    expect(isAllowed.mock.invocationCallOrder[0]).toBeLessThan(
      forAuthorizedTarget.mock.invocationCallOrder[0],
    );
    expect(forAuthorizedTarget.mock.invocationCallOrder[0]).toBeLessThan(
      fetch.mock.invocationCallOrder[0],
    );
  });

  it('denies a nonmember before requesting the appservice proof', async () => {
    isAllowed.mockResolvedValue(false);

    await expect(
      createController().listEvents(
        userContext,
        undefined,
        roomId,
        calendarId,
        '2026-01-01T00:00:00.000Z',
        '2026-01-02T00:00:00.000Z',
        'UTC',
        'room',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(forAuthorizedTarget).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('enforces the configured response cap on application-principal room reads', async () => {
    isAllowed.mockResolvedValue(true);
    forAuthorizedTarget.mockResolvedValue({
      userId: '@_matrix_calendar_service:example.test',
      calendarUrl:
        'https://radicale.example.test/matrix_calendar_service/room-calendar/',
      credential: {
        accessToken: 'synthetic-openid-proof',
        matrixServerName: 'example.test',
      },
    });
    fetch.mockResponseOnce('oversized response', {
      status: 207,
      headers: { 'Content-Length': '100' },
    });
    const controller = new CalendarGatewayController(
      { ...configuration, caldav_max_event_response_bytes: 10 },
      authorizationFactory,
      new MatrixOpenIdCalDavCredentialProviderFactory(),
      roomAccess,
    );

    await expect(
      controller.listEvents(
        userContext,
        undefined,
        roomId,
        calendarId,
        '2026-01-01T00:00:00.000Z',
        '2026-01-02T00:00:00.000Z',
        'UTC',
        'room',
      ),
    ).rejects.toMatchObject({
      status: 502,
      response: { code: 'caldav-upstream-error' },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('denies a mismatched room/calendar binding before proof or CalDAV', async () => {
    isAllowed.mockResolvedValue(true);

    await expect(
      createController().listEvents(
        userContext,
        undefined,
        roomId,
        'another-room-calendar',
        '2026-01-01T00:00:00.000Z',
        '2026-01-02T00:00:00.000Z',
        'UTC',
        'room',
      ),
    ).rejects.toMatchObject({ status: 403 });

    expect(forAuthorizedTarget).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  function createController(): CalendarGatewayController {
    return new CalendarGatewayController(
      configuration,
      authorizationFactory,
      new MatrixOpenIdCalDavCredentialProviderFactory(),
      roomAccess,
    );
  }
});
