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

import base64url from 'base64url';
import { Request, Response } from 'express';
import fetch from 'jest-fetch-mock';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  BoundedFixedWindowSourceRateLimiter,
  CalendarGatewayRateLimitMiddleware,
  isCalendarGatewayPath,
} from '../../src/middleware/CalendarGatewayRateLimitMiddleware';
import { MatrixAuthMiddleware } from '../../src/middleware/MatrixAuthMiddleware';
import { createAppConfig } from '../util/MockUtils';

type MockResponse = Response & {
  setHeader: jest.Mock;
  status: jest.Mock;
  json: jest.Mock;
};

function createRequest(
  path: string,
  remoteAddress = '192.0.2.10',
  forwardedFor = '198.51.100.10',
): Request {
  return {
    path,
    url: path,
    socket: { remoteAddress },
    headers: { 'x-forwarded-for': forwardedFor },
  } as unknown as Request;
}

function createResponse(): MockResponse {
  return {
    setHeader: jest.fn(),
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  } as unknown as MockResponse;
}

describe('CalendarGatewayRateLimitMiddleware', () => {
  beforeEach(() => {
    fetch.resetMocks();
    fetch.enableMocks();
  });

  it('allows a bounded burst and reports the fixed-window retry delay', () => {
    const limiter = new BoundedFixedWindowSourceRateLimiter(2, 1_500, 10);

    expect(limiter.consume('192.0.2.10', 0)).toEqual({ allowed: true });
    expect(limiter.consume('192.0.2.10', 100)).toEqual({ allowed: true });
    expect(limiter.consume('192.0.2.10', 100)).toEqual({
      allowed: false,
      retryAfterSeconds: 2,
    });
    expect(limiter.consume('192.0.2.10', 501)).toEqual({
      allowed: false,
      retryAfterSeconds: 1,
    });
    expect(limiter.consume('192.0.2.10', 1_500)).toEqual({ allowed: true });
  });

  it('fails closed at the source-key cap and frees expired entries during bounded cleanup', () => {
    const limiter = new BoundedFixedWindowSourceRateLimiter(5, 1_000, 1);

    expect(limiter.consume('192.0.2.10', 0)).toEqual({ allowed: true });
    expect(limiter.consume('192.0.2.11', 0)).toEqual({
      allowed: false,
      retryAfterSeconds: 1,
    });
    expect(limiter.consume('192.0.2.11', 1_000)).toEqual({ allowed: true });
  });

  it('matches only the versioned calendar route and its path-boundary descendants', () => {
    expect(isCalendarGatewayPath('/v1/calendar')).toBe(true);
    expect(isCalendarGatewayPath('/v1/calendar/')).toBe(true);
    expect(isCalendarGatewayPath('/v1/calendar/events')).toBe(true);
    expect(isCalendarGatewayPath('/V1/Calendar/Events')).toBe(true);
    expect(isCalendarGatewayPath('/v1/calendarish')).toBe(false);
    expect(isCalendarGatewayPath('/v1/configuration')).toBe(false);
    expect(isCalendarGatewayPath('/calendar')).toBe(false);
  });

  it('does not throttle non-gateway routes and ignores caller-supplied forwarded addresses', () => {
    const limiter = new BoundedFixedWindowSourceRateLimiter(1, 60_000, 10);
    const middleware = new CalendarGatewayRateLimitMiddleware(limiter);
    const firstNext = jest.fn();
    const blockedNext = jest.fn();
    const nonGatewayNext = jest.fn();
    const firstResponse = createResponse();
    const blockedResponse = createResponse();

    middleware.use(
      createRequest('/v1/calendar/events', '192.0.2.10', '198.51.100.10'),
      firstResponse,
      firstNext,
    );
    middleware.use(
      createRequest('/V1/Calendar/Events', '192.0.2.10', '203.0.113.55'),
      blockedResponse,
      blockedNext,
    );
    middleware.use(
      createRequest('/v1/calendarish', '192.0.2.10'),
      createResponse(),
      nonGatewayNext,
    );

    expect(firstNext).toHaveBeenCalledTimes(1);
    expect(blockedNext).not.toHaveBeenCalled();
    expect(blockedResponse.setHeader).toHaveBeenCalledWith('Retry-After', '60');
    expect(blockedResponse.status).toHaveBeenCalledWith(429);
    expect(blockedResponse.json).toHaveBeenCalledWith({
      statusCode: 429,
      message: 'Too many requests',
    });
    expect(JSON.stringify(blockedResponse.json.mock.calls)).not.toContain(
      '192.0.2.10',
    );
    expect(JSON.stringify(blockedResponse.json.mock.calls)).not.toContain(
      '203.0.113.55',
    );
    expect(nonGatewayNext).toHaveBeenCalledTimes(1);
  });

  it('registers before OpenID auth and prevents the excess request from reaching homeserver verification', async () => {
    const bootstrap = readFileSync(
      resolve(__dirname, '../../src/index.ts'),
      'utf8',
    );
    const rateLimitRegistration = bootstrap.indexOf(
      'calendarGatewayRateLimitMiddleware.use.bind',
    );
    const authRegistration = bootstrap.indexOf('matrixAuthMiddleware.use.bind');
    expect(rateLimitRegistration).toBeGreaterThanOrEqual(0);
    expect(authRegistration).toBeGreaterThan(rateLimitRegistration);

    const config = createAppConfig();
    config.homeserver_url = 'https://matrix.example.test';
    const authMiddleware = new MatrixAuthMiddleware(config);
    const rateLimitMiddleware = new CalendarGatewayRateLimitMiddleware(
      new BoundedFixedWindowSourceRateLimiter(1, 60_000, 10),
    );
    const authorization = `MX-Identity ${base64url(
      JSON.stringify({
        access_token: 'openid-proof-sentinel',
        matrix_server_name: 'example.test',
      }),
    )}`;
    fetch.mockResponseOnce(JSON.stringify({ sub: '@alice:example.test' }));

    const dispatch = async (response: Response) => {
      const request = createRequest('/v1/calendar/events');
      request.headers.authorization = authorization;

      await new Promise<void>((resolve) => {
        let continued = false;
        rateLimitMiddleware.use(request, response, () => {
          continued = true;
          void authMiddleware.use(request, response, () => resolve());
        });
        if (!continued) {
          resolve();
        }
      });
    };

    await dispatch(createResponse());
    const blockedResponse = createResponse();
    await dispatch(blockedResponse);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(blockedResponse.status).toHaveBeenCalledWith(429);
    expect(JSON.stringify(blockedResponse.json.mock.calls)).not.toContain(
      'openid-proof-sentinel',
    );
  });
});
