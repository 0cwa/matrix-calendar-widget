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
  LoggerService,
  MiddlewareConsumer,
  Module,
  NestModule,
  VersioningType,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import fetchMock from 'jest-fetch-mock';
import { MatrixClient } from 'matrix-bot-sdk';
import { execFileSync } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { IAppConfiguration } from '../../src/IAppConfiguration';
import { ModuleProviderToken } from '../../src/ModuleProviderToken';
import { MatrixOpenIdCalDavCredentialProviderFactory } from '../../src/caldav/MatrixOpenIdCalDavCredentialProviderFactory';
import { CalendarGatewayController } from '../../src/controller/CalendarGatewayController';
import { MatrixAuthGuard } from '../../src/guard/MatrixAuthGuard';
import { MatrixRoomMembershipGuard } from '../../src/guard/MatrixRoomMembershipGuard';
import { MatrixAuthMiddleware } from '../../src/middleware/MatrixAuthMiddleware';
import { MatrixCalendarAuthorizationFactory } from '../../src/service/MatrixCalendarAuthorization';
import { RoomCalendarCalDavAccess } from '../../src/service/RoomCalendarCalDavAccess';

const describeContract =
  process.env.CALDAV_CONTRACT === '1' ? describe : describe.skip;
const CALDAV_OPENID_PREFIX = 'matrix-openid:';

type MatrixIdentity = { access_token: string; matrix_server_name: string };

let homeserverUrl: string;
let matrixServerName: string;
let actorUserId: string;
let actorAccessToken: string;
let nonmemberLoginAccessToken: string;
let roomId: string;
let actorIdentity: MatrixIdentity;
let nonmemberIdentity: MatrixIdentity;
let nonmemberIdentityHeader: string;
let actorTaggedCredential: string;
let app: INestApplication;
let gatewayBaseUrl: string;
let countCalDavRequests: () => number;
const gatewayLogLines: string[] = [];

function captureGatewayLog(...values: unknown[]): void {
  gatewayLogLines.push(
    values
      .map((value) =>
        value instanceof Error
          ? `${value.name}: ${value.message}`
          : String(value),
      )
      .join(' '),
  );
}

const gatewayLogger: LoggerService = {
  log: captureGatewayLog,
  error: captureGatewayLog,
  warn: captureGatewayLog,
  debug: captureGatewayLog,
  verbose: captureGatewayLog,
  fatal: captureGatewayLog,
};
const credentialProviderFactory =
  new MatrixOpenIdCalDavCredentialProviderFactory();
const credentialProviderFactorySpy = jest.spyOn(
  credentialProviderFactory,
  'forRequest',
);

const radicaleBaseUrl = process.env.CALDAV_BASE_URL ?? 'http://localhost:5232/';
const testConfiguration = {
  homeserver_url:
    process.env.MATRIX_CALENDAR_DEV_HOMESERVER_URL ?? 'http://localhost:8008',
  radicale_url: radicaleBaseUrl,
} as IAppConfiguration;

const matrixClient = {
  async getJoinedRoomMembers(requestedRoomId: string): Promise<string[]> {
    const response = await fetch(
      new URL(
        `/_matrix/client/v3/rooms/${encodeURIComponent(requestedRoomId)}/joined_members`,
        homeserverUrl,
      ),
      { headers: { Authorization: `Bearer ${actorAccessToken}` } },
    );
    if (!response.ok) {
      throw new Error('Matrix membership lookup failed');
    }
    const result = (await response.json()) as {
      joined?: Record<string, unknown>;
    };
    return Object.keys(result.joined ?? {});
  },
} as unknown as MatrixClient;

@Module({
  controllers: [CalendarGatewayController],
  providers: [
    {
      provide: ModuleProviderToken.APP_CONFIGURATION,
      useValue: testConfiguration,
    },
    { provide: MatrixClient, useValue: matrixClient },
    MatrixCalendarAuthorizationFactory,
    {
      provide: MatrixOpenIdCalDavCredentialProviderFactory,
      useValue: credentialProviderFactory,
    },
    {
      provide: ModuleProviderToken.ROOM_CALENDAR_CALDAV_ACCESS,
      useClass: RoomCalendarCalDavAccess,
    },
    MatrixAuthMiddleware,
    MatrixAuthGuard,
    MatrixRoomMembershipGuard,
  ],
})
class PersonalOpenIdGatewayContractModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(MatrixAuthMiddleware).forRoutes('*');
  }
}

describeContract('personal Matrix OpenID gateway against real Radicale', () => {
  beforeAll(async () => {
    fetchMock.disableMocks();
    homeserverUrl = testConfiguration.homeserver_url;
    matrixServerName =
      process.env.MATRIX_CALENDAR_DEV_SERVER_NAME ?? 'localhost';
    const username = process.env.MATRIX_CALENDAR_DEV_USER ?? 'calendar';
    const password =
      process.env.MATRIX_CALENDAR_DEV_PASSWORD ?? 'calendar-dev-password';
    const taggedCredential = process.env.CALDAV_OPENID_CREDENTIAL ?? '';
    if (!taggedCredential.startsWith(CALDAV_OPENID_PREFIX)) {
      throw new Error(
        'CALDAV_OPENID_CREDENTIAL must contain the tagged fixture proof',
      );
    }

    actorUserId = `@${username}:${matrixServerName}`;
    actorTaggedCredential = taggedCredential;
    const actorLogin = await login(username, password);
    actorAccessToken = actorLogin.access_token;
    actorIdentity = decodeTaggedCredential(taggedCredential);
    if (actorIdentity.matrix_server_name !== matrixServerName) {
      throw new Error('Fixture proof has an unexpected Matrix server name');
    }

    const createdRoom = await matrixJson<{ room_id: string }>(
      '/_matrix/client/v3/createRoom',
      {
        method: 'POST',
        token: actorAccessToken,
        body: { name: 'M2 personal CalDAV contract', preset: 'private_chat' },
      },
    );
    roomId = createdRoom.room_id;

    const nonmemberName = 'calendar-contract-nonmember';
    const nonmemberPassword = password;
    await matrixJson(
      `/_synapse/admin/v2/users/${encodeURIComponent(`@${nonmemberName}:${matrixServerName}`)}`,
      {
        method: 'PUT',
        token: actorAccessToken,
        body: { password: nonmemberPassword, admin: false },
      },
    );
    const nonmemberLogin = await login(nonmemberName, nonmemberPassword);
    nonmemberLoginAccessToken = nonmemberLogin.access_token;
    nonmemberIdentity = await matrixJson<MatrixIdentity>(
      `/_matrix/client/v3/user/${encodeURIComponent(`@${nonmemberName}:${matrixServerName}`)}/openid/request_token`,
      { method: 'POST', token: nonmemberLoginAccessToken, body: {} },
    );
    nonmemberIdentityHeader = identityHeader(nonmemberIdentity);

    app = await NestFactory.create(PersonalOpenIdGatewayContractModule, {
      logger: gatewayLogger,
    });
    app.enableVersioning({ type: VersioningType.URI });
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    gatewayBaseUrl = `http://127.0.0.1:${address.port}`;
    countCalDavRequests = instrumentCalDavRequests();
  }, 30000);

  afterAll(async () => {
    if (app) await app.close();
    jest.restoreAllMocks();
    fetchMock.enableMocks();
    fetchMock.dontMock();
  });

  it('uses the actor proof and returns only the actor personal calendar', async () => {
    const response = await gatewayRequest(identityHeader(actorIdentity));

    expect(response.status).toBe(200);
    const calendars = JSON.parse(response.body) as Array<{
      id: string;
      name: string;
    }>;
    expect(calendars).toHaveLength(1);
    expect(calendars[0]).toMatchObject({
      id: new URL(
        `${encodeURIComponent(actorUserId.split(':')[0].slice(1))}/contract-calendar/`,
        radicaleBaseUrl,
      ).toString(),
      name: 'Contract Calendar',
    });
    expect(countCalDavRequests()).toBeGreaterThan(0);
    expect(credentialProviderFactorySpy).toHaveBeenCalledTimes(1);
    expectResponseToOmitCredentials(response.body, actorIdentity.access_token);
    expectGatewayLogsToOmitCredentials();
  });

  it('denies missing and malformed identity before any CalDAV request', async () => {
    const initialCount = countCalDavRequests();
    const initialProviderCalls = credentialProviderFactorySpy.mock.calls.length;
    const missing = await gatewayRequest(undefined);
    expect(missing.status).toBe(403);
    expect(countCalDavRequests()).toBe(initialCount);
    expect(credentialProviderFactorySpy).toHaveBeenCalledTimes(
      initialProviderCalls,
    );

    const malformed = await gatewayRequest(
      'MX-Identity invalid-proof-sentinel',
    );
    expect(malformed.status).toBe(403);
    expect(countCalDavRequests()).toBe(initialCount);
    expect(credentialProviderFactorySpy).toHaveBeenCalledTimes(
      initialProviderCalls,
    );
    expectResponseToOmitCredentials(malformed.body, 'invalid-proof-sentinel');

    const invalidOpenIdToken = 'invalid-openid-token-sentinel';
    const invalid = await gatewayRequest(
      identityHeader({
        access_token: invalidOpenIdToken,
        matrix_server_name: matrixServerName,
      }),
    );
    expect(invalid.status).toBe(403);
    expect(countCalDavRequests()).toBe(initialCount);
    expect(credentialProviderFactorySpy).toHaveBeenCalledTimes(
      initialProviderCalls,
    );
    expectResponseToOmitCredentials(invalid.body, invalidOpenIdToken);
    expectGatewayLogsToOmitCredentials(invalidOpenIdToken);

    const mismatchedServerHeader = identityHeader({
      ...actorIdentity,
      matrix_server_name: 'different-server.example',
    });
    const mismatchedServer = await gatewayRequest(mismatchedServerHeader);
    expect(mismatchedServer.status).toBe(403);
    expect(countCalDavRequests()).toBe(initialCount);
    expect(credentialProviderFactorySpy).toHaveBeenCalledTimes(
      initialProviderCalls,
    );
    expectResponseToOmitCredentials(
      mismatchedServer.body,
      actorIdentity.access_token,
    );
    expectGatewayLogsToOmitCredentials(mismatchedServerHeader);
  });

  it('denies a valid nonmember identity before any CalDAV request', async () => {
    const initialCount = countCalDavRequests();
    const initialProviderCalls = credentialProviderFactorySpy.mock.calls.length;
    const response = await gatewayRequest(nonmemberIdentityHeader);

    expect(response.status).toBe(403);
    expect(countCalDavRequests()).toBe(initialCount);
    expect(credentialProviderFactorySpy).toHaveBeenCalledTimes(
      initialProviderCalls,
    );
    expectResponseToOmitCredentials(
      response.body,
      nonmemberIdentityHeader,
      nonmemberIdentity.access_token,
      nonmemberLoginAccessToken,
    );
    expectGatewayLogsToOmitCredentials(nonmemberIdentity.access_token);
    assertServiceLogsOmit(
      actorAccessToken,
      actorIdentity.access_token,
      nonmemberLoginAccessToken,
      nonmemberIdentity.access_token,
      nonmemberIdentityHeader,
    );
  });

  async function gatewayRequest(
    authorization?: string,
  ): Promise<{ status: number; body: string }> {
    const query = new URLSearchParams({ roomId });
    return new Promise((resolve, reject) => {
      const request = httpRequest(
        `${gatewayBaseUrl}/v1/calendar/calendars?${query}`,
        authorization ? { headers: { Authorization: authorization } } : {},
        (response) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer | string) =>
            chunks.push(Buffer.from(chunk)),
          );
          response.on('end', () =>
            resolve({
              status: response.statusCode ?? 0,
              body: Buffer.concat(chunks).toString('utf8'),
            }),
          );
        },
      );
      request.on('error', reject);
      request.end();
    });
  }
});

function expectGatewayLogsToOmitCredentials(
  ...additionalSecrets: string[]
): void {
  const username = process.env.MATRIX_CALENDAR_DEV_USER ?? 'calendar';
  const actorHeader = identityHeader(actorIdentity);
  const basicHeader = `Basic ${Buffer.from(
    `${username}:${actorTaggedCredential}`,
    'utf8',
  ).toString('base64')}`;
  const logText = gatewayLogLines.join('\n');
  const secrets = [
    actorAccessToken,
    actorIdentity.access_token,
    actorTaggedCredential,
    actorHeader,
    basicHeader,
    nonmemberLoginAccessToken,
    nonmemberIdentityHeader,
    nonmemberIdentity.access_token,
    'invalid-openid-token-sentinel',
    ...additionalSecrets,
  ];
  expect(secrets.some((secret) => logText.includes(secret))).toBe(false);
}

function expectResponseToOmitCredentials(
  body: string,
  ...secrets: string[]
): void {
  if (secrets.some((secret) => secret.length > 0 && body.includes(secret))) {
    throw new Error(
      'Gateway response contains protected authentication material',
    );
  }
}

function assertServiceLogsOmit(...secrets: string[]): void {
  let logs: string;
  try {
    logs = execFileSync(
      'docker',
      [
        'compose',
        '-f',
        resolve(__dirname, '../../../dev/compose.yaml'),
        'logs',
        '--no-color',
        '--no-log-prefix',
        'synapse',
        'radicale',
      ],
      { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
    );
  } catch {
    throw new Error('Unable to inspect contract service logs');
  }
  if (secrets.some((secret) => secret.length > 0 && logs.includes(secret))) {
    throw new Error(
      'Contract service logs contain protected authentication material',
    );
  }
}

async function login(
  username: string,
  password: string,
): Promise<{ access_token: string }> {
  return matrixJson('/_matrix/client/v3/login', {
    method: 'POST',
    body: {
      type: 'm.login.password',
      identifier: { type: 'm.id.user', user: username },
      password,
    },
  });
}

async function matrixJson<T = Record<string, unknown>>(
  path: string,
  options: {
    method: string;
    token?: string;
    body: unknown;
  },
): Promise<T> {
  const response = await fetch(new URL(path, homeserverUrl), {
    method: options.method,
    headers: {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: JSON.stringify(options.body),
  });
  if (!response.ok) {
    throw new Error(
      `Matrix contract fixture request failed (${response.status})`,
    );
  }
  return (await response.json()) as T;
}

function decodeTaggedCredential(credential: string): MatrixIdentity {
  try {
    return JSON.parse(
      Buffer.from(
        credential.slice(CALDAV_OPENID_PREFIX.length),
        'base64url',
      ).toString('utf8'),
    ) as MatrixIdentity;
  } catch {
    throw new Error('CALDAV_OPENID_CREDENTIAL is malformed');
  }
}

function identityHeader(identity: MatrixIdentity): string {
  const encodedPayload = Buffer.from(JSON.stringify(identity), 'utf8').toString(
    'base64url',
  );
  return `MX-Identity ${encodedPayload}`;
}

function instrumentCalDavRequests(): () => number {
  const originalFetch = globalThis.fetch.bind(globalThis);
  const caldavOrigin = new URL(radicaleBaseUrl).origin;
  let requestCount = 0;
  jest.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url =
      typeof input === 'string' || input instanceof URL ? input : input.url;
    if (new URL(url, radicaleBaseUrl).origin === caldavOrigin) {
      requestCount += 1;
    }
    return originalFetch(input, init);
  });
  return () => requestCount;
}
