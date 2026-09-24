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
