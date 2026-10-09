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
  Body,
  Controller,
  Get,
  Module,
  Post,
  UseGuards,
  VersioningType,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import base64url from 'base64url';
import { NextFunction, Request, Response } from 'express';
import { request as httpRequest, IncomingHttpHeaders } from 'http';
import fetch from 'jest-fetch-mock';
import { AddressInfo } from 'net';
import { IAppConfiguration } from '../IAppConfiguration';
import { MatrixAuthGuard } from '../guard/MatrixAuthGuard';
import {
  MatrixAuthMiddleware,
  MX_IDENTITY,
} from '../middleware/MatrixAuthMiddleware';
import { createCalendarGatewayHttpApplication } from './CalendarGatewayHttpApplication';

jest.mock('matrix-bot-sdk', () => ({
  UserID: class UserID {
    domain: string;

    constructor(userId: string) {
      const separator = userId.indexOf(':');
      if (
        !userId.startsWith('@') ||
        separator < 2 ||
        separator === userId.length - 1
      ) {
        throw new Error('Invalid Matrix user ID');
      }
      this.domain = userId.slice(separator + 1);
    }
  },
}));

const appConfiguration = {
  homeserver_url: 'https://matrix.example.test',
  calendar_gateway_rate_limit_requests: 1,
  calendar_gateway_rate_limit_window_ms: 60_000,
  calendar_gateway_rate_limit_max_keys: 10,
} as IAppConfiguration;

const configService = {
  getOrThrow: jest.fn(() => appConfiguration),
};

let matrixAuthMiddleware: MatrixAuthMiddleware;
const authMiddlewareUse = jest.fn();

class TestMatrixAuthMiddleware {}

const testAuthMiddleware = { use: authMiddlewareUse };

@Controller({ path: 'calendar', version: '1' })
@UseGuards(MatrixAuthGuard)
class CalendarGatewayHttpProbeController {
  @Get()
  list(): { available: true } {
    return { available: true };
  }

  @Post()
  create(@Body() body: { payload: string }): { length: number } {
    return { length: body.payload.length };
  }
}

@Module({
  controllers: [CalendarGatewayHttpProbeController],
  providers: [
    { provide: ConfigService, useValue: configService },
    { provide: TestMatrixAuthMiddleware, useValue: testAuthMiddleware },
    MatrixAuthGuard,
  ],
})
class CalendarGatewayHttpProbeModule {}

type HttpResult = {
  statusCode: number | undefined;
  headers: IncomingHttpHeaders;
  body: string;
};

describe('calendar gateway HTTP middleware setup', () => {
  let app: Awaited<
    ReturnType<typeof createCalendarGatewayHttpApplication>
  >['app'];
  let baseUrl: string;

  beforeEach(async () => {
    fetch.resetMocks();
    fetch.enableMocks();
    configService.getOrThrow.mockClear().mockReturnValue(appConfiguration);
    authMiddlewareUse
      .mockClear()
      .mockImplementation(
        (request: Request, response: Response, next: NextFunction) =>
          matrixAuthMiddleware.use(request, response, next),
      );
    matrixAuthMiddleware = new MatrixAuthMiddleware(
      appConfiguration as IAppConfiguration,
    );

    const application = await createCalendarGatewayHttpApplication(
      CalendarGatewayHttpProbeModule,
      TestMatrixAuthMiddleware,
    );
    app = application.app;
    app.useLogger(false);
    app.enableVersioning({ type: VersioningType.URI });
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  it('handles Authorization preflight before OpenID verification and rejects excess GETs before verification', async () => {
    const origin = 'https://widget.example.test';
    const authorization = `${MX_IDENTITY} ${base64url(
      JSON.stringify({
        access_token: 'synthetic-openid-proof',
        matrix_server_name: 'example.test',
      }),
    )}`;
    fetch.mockResponseOnce(JSON.stringify({ sub: '@alice:example.test' }));
    const preflight = await send('OPTIONS', '/v1/calendar', {
      Origin: origin,
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'authorization',
    });
    const authCallsAfterPreflight = authMiddlewareUse.mock.calls.length;
    const openIdCallsAfterPreflight = fetch.mock.calls.length;

    const accepted = await send('GET', '/v1/calendar', {
      Origin: origin,
      Authorization: authorization,
    });
    const openIdCallsAfterAccepted = fetch.mock.calls.length;
    const limited = await send('GET', '/v1/calendar', {
      Origin: origin,
      Authorization: authorization,
    });
    const openIdCallsAfterLimited = fetch.mock.calls.length;
    const retryAfter = Number(limited.headers['retry-after']);

    expect({
      preflightStatus: preflight.statusCode,
      preflightOrigin: preflight.headers['access-control-allow-origin'],
      preflightMethods: preflight.headers['access-control-allow-methods'],
      preflightHeaders: preflight.headers['access-control-allow-headers'],
      authCallsAfterPreflight,
      acceptedStatus: accepted.statusCode,
      acceptedBody: accepted.body,
      acceptedOrigin: accepted.headers['access-control-allow-origin'],
      limitedStatus: limited.statusCode,
      limitedBody: limited.body,
      limitedOrigin: limited.headers['access-control-allow-origin'],
      retryAfterValid:
        Number.isSafeInteger(retryAfter) && retryAfter > 0 && retryAfter <= 60,
      authCallsAfterGets:
        authMiddlewareUse.mock.calls.length - authCallsAfterPreflight,
      openIdCallsAfterPreflight,
      openIdCallsAfterAccepted,
      openIdCallsAfterLimited,
    }).toEqual({
      preflightStatus: 204,
      preflightOrigin: '*',
      preflightMethods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
      preflightHeaders: 'authorization',
      authCallsAfterPreflight: 0,
      acceptedStatus: 200,
      acceptedBody: '{"available":true}',
      acceptedOrigin: '*',
      limitedStatus: 429,
      limitedBody: '{"statusCode":429,"message":"Too many requests"}',
      limitedOrigin: '*',
      retryAfterValid: true,
      authCallsAfterGets: 1,
      openIdCallsAfterPreflight: 0,
      openIdCallsAfterAccepted: 1,
      openIdCallsAfterLimited: 1,
    });
  });

  it('keeps CORS headers on an authorization rejection', async () => {
    const response = await send('GET', '/v1/calendar', {
      Origin: 'https://widget.example.test',
    });

    expect(response.statusCode).toBe(403);
    expect(response.headers['access-control-allow-origin']).toBe('*');
    expect(authMiddlewareUse).toHaveBeenCalledTimes(1);
  });

  it('keeps CORS headers on the existing request-body limit response', async () => {
    const body = JSON.stringify({ payload: 'x'.repeat(110 * 1024) });
    const response = await send(
      'POST',
      '/v1/calendar',
      {
        Origin: 'https://widget.example.test',
        'Content-Type': 'application/json',
        'Content-Length': String(Buffer.byteLength(body)),
      },
      body,
    );

    expect(response.statusCode).toBe(413);
    expect(response.headers['access-control-allow-origin']).toBe('*');
    expect(authMiddlewareUse).not.toHaveBeenCalled();
  });

  function send(
    method: string,
    path: string,
    headers: Record<string, string>,
    body?: string,
  ): Promise<HttpResult> {
    return new Promise((resolve, reject) => {
      const outgoing = httpRequest(
        `${baseUrl}${path}`,
        { method, headers },
        (incoming) => {
          let responseBody = '';
          incoming.setEncoding('utf8');
          incoming.on('data', (chunk: string) => (responseBody += chunk));
          incoming.on('end', () =>
            resolve({
              statusCode: incoming.statusCode,
              headers: incoming.headers,
              body: responseBody,
            }),
          );
        },
      );
      outgoing.on('error', reject);
      outgoing.end(body);
    });
  }
});
