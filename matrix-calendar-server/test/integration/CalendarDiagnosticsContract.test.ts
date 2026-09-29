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
import fetchMock from 'jest-fetch-mock';
import { MatrixClient } from 'matrix-bot-sdk';
import { AddressInfo } from 'net';
import { IAppConfiguration } from '../../src/IAppConfiguration';
import { ModuleProviderToken } from '../../src/ModuleProviderToken';
import { CalDavCredentialProvider } from '../../src/caldav';
import { MatrixOpenIdCalDavCredentialProviderFactory } from '../../src/caldav/MatrixOpenIdCalDavCredentialProviderFactory';
import { CalendarGatewayController } from '../../src/controller/CalendarGatewayController';
import { NET_NORDECK_CONTEXT } from '../../src/decorator/IParamExtractor';
import { MatrixAuthGuard } from '../../src/guard/MatrixAuthGuard';
import { MatrixRoomMembershipGuard } from '../../src/guard/MatrixRoomMembershipGuard';
import { IUserContext } from '../../src/model/IUserContext';
import { MatrixCalendarAuthorizationFactory } from '../../src/service/MatrixCalendarAuthorization';
import { RoomCalendarCalDavAccess } from '../../src/service/RoomCalendarCalDavAccess';

const describeContract =
  process.env.CALDAV_CONTRACT === '1' ? describe : describe.skip;

const roomId = '!diagnostics-contract:localhost';
const managerId = '@contract-manager:localhost';
const memberId = '@contract-member:localhost';

/**
 * This test-only middleware stands in for the Matrix identity proof boundary.
 * It sets the same request context consumed by the production guards and
 * controller; it does not claim to validate OpenID or exercise ADR009 token
 * delegation. The real Radicale service is reached with its supported local
 * password test account through ContractCalDavCredentialProviderFactory.
 */
@Injectable()
class ContractIdentityMiddleware implements NestMiddleware {
  use(request: Request, _response: Response, next: NextFunction): void {
    const actor = request.header('x-contract-actor');
    const userId =
      actor === 'manager'
        ? managerId
        : actor === 'member'
          ? memberId
          : undefined;

    if (userId) {
      (request as Request & { [NET_NORDECK_CONTEXT]?: IUserContext })[
        NET_NORDECK_CONTEXT
      ] = {
        userId,
        locale: 'en',
        timezone: 'UTC',
      };
    }

    next();
  }
}

@Injectable()
class ContractCalDavCredentialProviderFactory {
  forRequest(): CalDavCredentialProvider {
    const username = process.env.CALDAV_USERNAME ?? 'calendar';
    const password = process.env.CALDAV_PASSWORD ?? 'calendar-dev-password';
    const authorization = Buffer.from(
      `${username}:${password}`,
      'utf8',
    ).toString('base64');

    return {
      async getRequestHeaders() {
        return { Authorization: `Basic ${authorization}` };
      },
    };
  }
}

const contractMatrixClient = {
  async getJoinedRoomMembers(requestedRoomId: string): Promise<string[]> {
    return requestedRoomId === roomId ? [managerId, memberId] : [];
  },
  async getRoomStateEvent() {
    return {
      users: { [managerId]: 100 },
      users_default: 0,
      state_default: 50,
    };
  },
} as unknown as MatrixClient;

const radicaleBaseUrl = process.env.CALDAV_BASE_URL ?? 'http://localhost:5232/';

@Module({
  controllers: [CalendarGatewayController],
  providers: [
    {
      provide: ModuleProviderToken.APP_CONFIGURATION,
      useValue: { radicale_url: radicaleBaseUrl } as IAppConfiguration,
    },
    { provide: MatrixClient, useValue: contractMatrixClient },
    MatrixAuthGuard,
    MatrixRoomMembershipGuard,
    MatrixCalendarAuthorizationFactory,
    {
      provide: ModuleProviderToken.ROOM_CALENDAR_CALDAV_ACCESS,
      useClass: RoomCalendarCalDavAccess,
    },
    {
      provide: MatrixOpenIdCalDavCredentialProviderFactory,
      useClass: ContractCalDavCredentialProviderFactory,
    },
  ],
})
class CalendarDiagnosticsContractModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(ContractIdentityMiddleware).forRoutes('*');
  }
}

describeContract('Calendar diagnostics composed Radicale contract', () => {
  let app: INestApplication | undefined;
  let baseAddress: string;
  let fetchSpy: jest.SpyInstance | undefined;
  let nativeFetch: typeof fetch;

  beforeAll(async () => {
    fetchMock.disableMocks();
    nativeFetch = global.fetch.bind(global);
    app = await NestFactory.create(CalendarDiagnosticsContractModule, {
      logger: false,
    });
    app.enableVersioning({ type: VersioningType.URI });
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    baseAddress = `http://127.0.0.1:${address.port}`;
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  beforeEach(() => {
    fetchSpy?.mockImplementation(nativeFetch);
    fetchSpy?.mockClear();
  });

  afterAll(async () => {
    fetchSpy?.mockRestore();
    if (app) {
      await app.close();
    }
    fetchMock.enableMocks();
    fetchMock.dontMock();
  });

  it('denies a joined non-manager before making any Radicale request', async () => {
    const response = await getJson(diagnosticsUrl(), {
      'x-contract-actor': 'member',
    });

    expect(response.status).toBe(403);
    expect(JSON.parse(response.body)).toMatchObject({ statusCode: 403 });
    expect(radicaleRequests()).toHaveLength(0);
  });

  it('returns only the valid in-base collection from real Radicale discovery', async () => {
    const response = await getJson(diagnosticsUrl(), {
      'x-contract-actor': 'manager',
    });

    expect(response.status).toBe(200);
    const result = JSON.parse(response.body) as {
      calendars: Array<{ name?: string; url: string }>;
    };
    const expectedCalendarUrl = new URL(
      `${encodeURIComponent(process.env.CALDAV_USERNAME ?? 'calendar')}/contract-calendar/`,
      radicaleBaseUrl,
    ).toString();

    expect(result).toEqual({
      calendars: [{ name: 'Contract Calendar', url: expectedCalendarUrl }],
    });
    for (const calendar of result.calendars) {
      const parsed = new URL(calendar.url);
      expect(parsed.origin).toBe(new URL(radicaleBaseUrl).origin);
      expect(
        parsed.pathname.startsWith(new URL(radicaleBaseUrl).pathname),
      ).toBe(true);
      expect(parsed.username).toBe('');
      expect(parsed.password).toBe('');
      expect(parsed.search).toBe('');
      expect(parsed.hash).toBe('');
    }
    expect(radicaleRequests().length).toBeGreaterThan(0);
  });

  function diagnosticsUrl(): string {
    const query = new URLSearchParams({ roomId });
    return `${baseAddress}/v1/calendar/calendars/diagnostics?${query}`;
  }

  function getJson(
    url: string,
    headers: Readonly<Record<string, string>>,
  ): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const request = httpRequest(url, { headers }, (response) => {
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

  function radicaleRequests(): string[] {
    return (fetchSpy?.mock.calls ?? [])
      .map(([input]) =>
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url,
      )
      .filter((url) => url.startsWith(radicaleBaseUrl));
  }
});
