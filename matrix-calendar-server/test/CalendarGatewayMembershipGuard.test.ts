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
  INestApplication,
  Injectable,
  MiddlewareConsumer,
  Module,
  NestMiddleware,
  NestModule,
  VersioningType,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NextFunction, Request, Response } from 'express';
import { request as httpRequest } from 'http';
import fetch from 'jest-fetch-mock';
import { MatrixClient } from 'matrix-bot-sdk';
import { AddressInfo } from 'net';
import { IAppConfiguration } from '../src/IAppConfiguration';
import { ModuleProviderToken } from '../src/ModuleProviderToken';
import { CalDavCredentialProvider } from '../src/caldav/CalDavCredentialProvider';
import { MatrixOpenIdCalDavCredentialProviderFactory } from '../src/caldav/MatrixOpenIdCalDavCredentialProviderFactory';
import { CalendarGatewayController } from '../src/controller/CalendarGatewayController';
import { NET_NORDECK_CONTEXT } from '../src/decorator/IParamExtractor';
import { MatrixAuthGuard } from '../src/guard/MatrixAuthGuard';
import { MatrixRoomMembershipGuard } from '../src/guard/MatrixRoomMembershipGuard';
import { IUserContext } from '../src/model/IUserContext';
import { MatrixCalendarAuthorizationFactory } from '../src/service/MatrixCalendarAuthorization';
import { RoomCalendarCalDavAccess } from '../src/service/RoomCalendarCalDavAccess';

const roomId = '!membership-guard:localhost';
const userId = '@membership-guard:localhost';

/**
 * This test-only middleware supplies the context consumed by the production
 * guards. It does not validate Matrix OpenID or exercise ADR009 delegation.
 */
@Injectable()
class TestIdentityMiddleware implements NestMiddleware {
  use(request: Request, _response: Response, next: NextFunction): void {
    (request as Request & { [NET_NORDECK_CONTEXT]?: IUserContext })[
      NET_NORDECK_CONTEXT
    ] = {
      userId,
      locale: 'en',
      timezone: 'UTC',
    };
    next();
  }
}

const getJoinedRoomMembers = jest.fn();
const matrixClient = {
  getJoinedRoomMembers,
} as unknown as MatrixClient;

const isAllowed = jest.fn();
const forRoom = jest.fn(() => ({ isAllowed }));
const authorizationFactory = {
  forRoom,
} as unknown as MatrixCalendarAuthorizationFactory;

const getRequestHeaders = jest.fn();
const credentialProvider: CalDavCredentialProvider = { getRequestHeaders };
const forRequest = jest.fn(() => credentialProvider);
const credentialProviderFactory = {
  forRequest,
} as unknown as MatrixOpenIdCalDavCredentialProviderFactory;

const testConfiguration = {
  radicale_url: 'https://radicale.example.test/',
} as IAppConfiguration;

@Module({
  controllers: [CalendarGatewayController],
  providers: [
    {
      provide: ModuleProviderToken.APP_CONFIGURATION,
      useValue: testConfiguration,
    },
    { provide: MatrixClient, useValue: matrixClient },
    {
      provide: MatrixCalendarAuthorizationFactory,
      useValue: authorizationFactory,
    },
    {
      provide: MatrixOpenIdCalDavCredentialProviderFactory,
      useValue: credentialProviderFactory,
    },
    {
      provide: ModuleProviderToken.ROOM_CALENDAR_CALDAV_ACCESS,
      useClass: RoomCalendarCalDavAccess,
    },
    MatrixAuthGuard,
    MatrixRoomMembershipGuard,
  ],
})
class CalendarGatewayMembershipTestModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TestIdentityMiddleware).forRoutes('*');
  }
}

describe('GET /v1/calendar/calendars room membership guard', () => {
  let app: INestApplication;
  let baseAddress: string;

  beforeAll(async () => {
    fetch.enableMocks();
    app = await NestFactory.create(CalendarGatewayMembershipTestModule, {
      logger: false,
    });
    app.enableVersioning({ type: VersioningType.URI });
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    baseAddress = `http://127.0.0.1:${address.port}`;
  });

  beforeEach(() => {
    fetch.resetMocks();
    getJoinedRoomMembers.mockReset();
    isAllowed.mockReset().mockResolvedValue(true);
    forRoom.mockReset().mockImplementation(() => ({ isAllowed }));
    getRequestHeaders
      .mockReset()
      .mockResolvedValue({ Authorization: 'Basic test-credential' });
    forRequest.mockReset().mockReturnValue(credentialProvider);
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    fetch.resetMocks();
  });

  it('denies a nonmember before authorization, credential construction, or CalDAV', async () => {
    getJoinedRoomMembers.mockResolvedValue([]);

    const response = await getJson(calendarsUrl());

    expect(response.status).toBe(403);
    expect(getJoinedRoomMembers).toHaveBeenCalledWith(roomId);
    expect(forRoom).not.toHaveBeenCalled();
    expect(forRequest).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fails closed when membership lookup fails before downstream I/O', async () => {
    getJoinedRoomMembers.mockRejectedValue(new Error('homeserver unavailable'));

    const response = await getJson(calendarsUrl());

    expect(response.status).toBe(403);
    expect(getJoinedRoomMembers).toHaveBeenCalledWith(roomId);
    expect(forRoom).not.toHaveBeenCalled();
    expect(forRequest).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('denies a failed authorization decision before credential or CalDAV I/O', async () => {
    getJoinedRoomMembers.mockResolvedValue([userId]);
    isAllowed.mockResolvedValue(false);

    const response = await getJson(calendarsUrl());

    expect(response.status).toBe(403);
    expect(forRoom).toHaveBeenCalledWith(userId, roomId);
    expect(isAllowed).toHaveBeenCalledWith({ action: 'list-calendars' });
    expect(forRequest).not.toHaveBeenCalled();
    expect(getRequestHeaders).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('allows a joined member to reach authorized calendar discovery', async () => {
    getJoinedRoomMembers.mockResolvedValue([userId]);
    fetch.mockResponses(
      [
        '<D:multistatus xmlns:D="DAV:"><D:response><D:href>/</D:href><D:propstat><D:prop><D:current-user-principal><D:href>/principals/member/</D:href></D:current-user-principal></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response></D:multistatus>',
        { status: 207 },
      ],
      [
        '<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:response><D:href>/principals/member/</D:href><D:propstat><D:prop><C:calendar-home-set><D:href>/calendars/member/</D:href></C:calendar-home-set></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response></D:multistatus>',
        { status: 207 },
      ],
      [
        '<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"/>',
        { status: 207 },
      ],
    );

    const response = await getJson(calendarsUrl());

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual([]);
    expect(getJoinedRoomMembers).toHaveBeenCalledWith(roomId);
    expect(forRoom).toHaveBeenCalledWith(userId, roomId);
    expect(isAllowed).toHaveBeenCalledWith({ action: 'list-calendars' });
    expect(forRequest).toHaveBeenCalledTimes(1);
    expect(getRequestHeaders).toHaveBeenCalledTimes(3);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  function calendarsUrl(): string {
    const query = new URLSearchParams({ roomId });
    return `${baseAddress}/v1/calendar/calendars?${query}`;
  }

  function getJson(url: string): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const request = httpRequest(url, (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer | string) => {
          chunks.push(Buffer.from(chunk));
        });
        response.on('end', () => {
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      });
      request.on('error', reject);
      request.end();
    });
  }
});
