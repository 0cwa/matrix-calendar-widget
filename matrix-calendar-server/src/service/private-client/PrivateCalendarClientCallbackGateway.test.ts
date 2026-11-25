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

import type { NextFunction, Request, Response } from 'express';
import { IAppConfiguration } from '../../IAppConfiguration';
import {
  callbackRequestSignature,
  callbackResponseSignature,
  PRIVATE_CALENDAR_CLIENT_CALLBACK_AUTH_PATH,
  PrivateCalendarClientCallbackGateway,
} from './PrivateCalendarClientCallbackGateway';
import { PrivateCalendarClientPolicy } from './PrivateCalendarClientPolicy';

const KEY = Buffer.alloc(32, 17);
const APP_ID = 'mcwpc~0123456789abcdef0123456789abcdef0123456789abcdef';
const SECRET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq';
const NOW = 1_792_590_000_000;

describe('private CalDAV callback gateway', () => {
  let policy: {
    authenticate: jest.Mock;
    rights: jest.Mock;
  };
  let gateway: PrivateCalendarClientCallbackGateway;

  beforeEach(() => {
    policy = {
      authenticate: jest.fn().mockResolvedValue(true),
      rights: jest.fn().mockResolvedValue('rw'),
    };
    gateway = new PrivateCalendarClientCallbackGateway(
      {
        private_calendar_clients_enabled: true,
        private_calendar_client_callback_key: KEY,
      } as IAppConfiguration,
      policy as unknown as PrivateCalendarClientPolicy,
      () => NOW,
    );
  });

  it('authenticates exact raw request bytes and signs the bounded response', async () => {
    const path = PRIVATE_CALENDAR_CLIENT_CALLBACK_AUTH_PATH;
    const timestamp = String(Math.floor(NOW / 1000));
    const nonce = Buffer.alloc(16, 3).toString('base64url');
    const body = Buffer.from(
      JSON.stringify({ username: APP_ID, password: SECRET }),
    );
    const signature = callbackRequestSignature(
      KEY,
      path,
      timestamp,
      nonce,
      body,
    );
    const response = await dispatch(gateway, path, body, [
      ['content-type', 'application/octet-stream'],
      ['x-mcw-callback-timestamp', timestamp],
      ['x-mcw-callback-nonce', nonce],
      ['x-mcw-callback-signature', signature],
    ]);
    const responseBody = response.body as Buffer;

    expect(response.statusCode).toBe(200);
    expect(response.headers['Content-Type']).toBe('application/octet-stream');
    expect(JSON.parse(responseBody.toString('utf8'))).toEqual({
      allowed: true,
    });
    expect(response.headers['X-MCW-Callback-Response-Signature']).toBe(
      callbackResponseSignature(KEY, 200, path, nonce, responseBody),
    );
    expect(policy.authenticate).toHaveBeenCalledWith(APP_ID, SECRET);
    expect(policy.rights).not.toHaveBeenCalled();
  });

  it('rejects an invalid HMAC and a replayed nonce without policy access', async () => {
    const path = PRIVATE_CALENDAR_CLIENT_CALLBACK_AUTH_PATH;
    const timestamp = String(Math.floor(NOW / 1000));
    const nonce = Buffer.alloc(16, 4).toString('base64url');
    const body = Buffer.from(
      JSON.stringify({ username: APP_ID, password: SECRET }),
    );
    const validSignature = callbackRequestSignature(
      KEY,
      path,
      timestamp,
      nonce,
      body,
    );
    const headers: [string, string][] = [
      ['content-type', 'application/octet-stream'],
      ['x-mcw-callback-timestamp', timestamp],
      ['x-mcw-callback-nonce', nonce],
      ['x-mcw-callback-signature', '0'.repeat(64)],
    ];

    const invalid = await dispatch(gateway, path, body, headers);
    const validHeaders = headers.map(([name, value]) =>
      name === 'x-mcw-callback-signature'
        ? ([name, validSignature] as [string, string])
        : ([name, value] as [string, string]),
    );
    const accepted = await dispatch(gateway, path, body, validHeaders);
    const replay = await dispatch(gateway, path, body, validHeaders);

    expect(invalid.statusCode).toBe(404);
    expect(accepted.statusCode).toBe(200);
    expect(replay.statusCode).toBe(404);
    expect(policy.authenticate).toHaveBeenCalledTimes(1);
  });

  it('rejects stale, duplicated, malformed, and unknown callbacks', async () => {
    const path = PRIVATE_CALENDAR_CLIENT_CALLBACK_AUTH_PATH;
    const timestamp = String(Math.floor(NOW / 1000) - 31);
    const nonce = Buffer.alloc(16, 5).toString('base64url');
    const body = Buffer.from(
      JSON.stringify({ username: APP_ID, password: SECRET }),
    );
    const signature = callbackRequestSignature(
      KEY,
      path,
      timestamp,
      nonce,
      body,
    );
    const requiredHeaders: [string, string][] = [
      ['content-type', 'application/octet-stream'],
      ['x-mcw-callback-timestamp', timestamp],
      ['x-mcw-callback-nonce', nonce],
      ['x-mcw-callback-signature', signature],
    ];

    const stale = await dispatch(gateway, path, body, requiredHeaders);
    const duplicate = await dispatch(gateway, path, body, [
      ...requiredHeaders,
      ['x-mcw-callback-nonce', nonce],
    ]);
    const malformedNonce = Buffer.alloc(16, 6).toString('base64url');
    const malformedBody = Buffer.from('{');
    const currentTimestamp = String(Math.floor(NOW / 1000));
    const malformedHeaders: [string, string][] = [
      ['content-type', 'application/octet-stream'],
      ['x-mcw-callback-timestamp', currentTimestamp],
      ['x-mcw-callback-nonce', malformedNonce],
      [
        'x-mcw-callback-signature',
        callbackRequestSignature(
          KEY,
          path,
          currentTimestamp,
          malformedNonce,
          malformedBody,
        ),
      ],
    ];
    const malformed = await dispatch(
      gateway,
      path,
      malformedBody,
      malformedHeaders,
    );
    const unknown = await dispatch(
      gateway,
      `${path}?extra=1`,
      body,
      requiredHeaders,
    );

    expect(stale.statusCode).toBe(404);
    expect(duplicate.statusCode).toBe(404);
    expect(malformed.statusCode).toBe(200);
    expect(malformed.body).toEqual(Buffer.from('{"allowed":false}'));
    expect(unknown.statusCode).toBe(404);
    expect(policy.authenticate).not.toHaveBeenCalled();
  });
});

function dispatch(
  gateway: PrivateCalendarClientCallbackGateway,
  path: string,
  body: Buffer,
  headers: readonly (readonly [string, string])[],
): Promise<{
  statusCode: number | undefined;
  headers: Record<string, string>;
  body: unknown;
}> {
  return new Promise((resolve) => {
    const rawHeaders = headers.flatMap(([name, value]) => [name, value]);
    const headerRecord = Object.fromEntries(
      headers.map(([name, value]) => [name, value]),
    );
    const request = {
      method: 'POST',
      originalUrl: path,
      url: path,
      headers: headerRecord,
      rawHeaders,
      body,
    } as unknown as Request;
    const state: {
      statusCode: number | undefined;
      headers: Record<string, string>;
      body: unknown;
    } = { statusCode: undefined, headers: {}, body: undefined };
    const response = {
      headersSent: false,
      status(statusCode: number) {
        state.statusCode = statusCode;
        return this;
      },
      setHeader(name: string, value: string) {
        state.headers[name] = value;
        return this;
      },
      end(value?: unknown) {
        state.body = value;
        resolve(state);
        return this;
      },
    } as unknown as Response;
    const next = jest.fn() as unknown as NextFunction;
    gateway.use(request, response, next);
  });
}
