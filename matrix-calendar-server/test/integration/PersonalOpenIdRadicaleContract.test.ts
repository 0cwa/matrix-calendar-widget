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
  Module,
  VersioningType,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type {
  Response as ExpressResponse,
  NextFunction,
  Request,
} from 'express';
import fetchMock from 'jest-fetch-mock';
import { MatrixClient, MatrixError } from 'matrix-bot-sdk';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';
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
let authMiddleware: MatrixAuthMiddleware;
let originalExtractUserContext: MatrixAuthMiddleware['extractUserContext'];
let nativeFetch: typeof fetch;
let gatewayBaseUrl: string;
let countCalDavRequests: () => number;
const gatewayLogLines: string[] = [];
type PersonalOpenIdSetupStage =
  | 'fixture-input-check'
  | 'actor-login'
  | 'actor-proof-validation'
  | 'create-personal-room'
  | 'create-nonmember'
  | 'nonmember-login'
  | 'nonmember-openid-proof'
  | 'gateway-init'
  | 'gateway-listen';
type PersonalOpenIdFailureCategory =
  | 'transport'
  | 'http-status'
  | 'json-or-token-parse'
  | 'other';
const PERSONAL_OPENID_MATRIX_ERROR_CODES = new Set([
  'M_BAD_JSON',
  'M_FORBIDDEN',
  'M_INVALID_PARAM',
  'M_INVALID_PASSWORD',
  'M_INVALID_USERNAME',
  'M_LIMIT_EXCEEDED',
  'M_MISSING_PARAM',
  'M_NOT_FOUND',
  'M_THREEPID_AUTH_FAILED',
  'M_UNAUTHORIZED',
  'M_UNKNOWN',
  'M_UNKNOWN_TOKEN',
  'M_USER_DEACTIVATED',
  'M_USER_IN_USE',
]);
type ContractStageDiagnostics = {
  middlewareCalls: number;
  authorizationHeader: 'not-observed' | 'present' | 'absent';
  identity: 'not-observed' | 'actor' | 'other' | 'absent' | 'rejected';
  userInfoStatuses: number[];
  membershipResults: boolean[];
  caldavStatuses: number[];
};
let activeStageDiagnostics: ContractStageDiagnostics | undefined;

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
const createCredentialProvider = credentialProviderFactory.forRequest.bind(
  credentialProviderFactory,
);
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
    const members = Object.keys(result.joined ?? {});
    activeStageDiagnostics?.membershipResults.push(
      members.includes(actorUserId),
    );
    return members;
  },
  async getRoomStateEvent(
    requestedRoomId: string,
    eventType: string,
    stateKey: string,
  ) {
    const response = await fetch(
      new URL(
        `/_matrix/client/v3/rooms/${encodeURIComponent(requestedRoomId)}/state/${encodeURIComponent(eventType)}/${encodeURIComponent(stateKey)}`,
        homeserverUrl,
      ),
      { headers: { Authorization: `Bearer ${actorAccessToken}` } },
    );
    if (response.status === 404) {
      throw new MatrixError(
        { errcode: 'M_NOT_FOUND', error: 'State event not found' },
        404,
      );
    }
    if (!response.ok) throw new Error('Matrix authorization lookup failed');
    return response.json();
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
class PersonalOpenIdGatewayContractModule {}

describeContract('personal Matrix OpenID gateway against real Radicale', () => {
  beforeAll(async () => {
    markPersonalOpenIdSetupStart();
    markPersonalOpenIdSetupStage('fixture-input-check');
    fetchMock.disableMocks();
    nativeFetch = globalThis.fetch.bind(globalThis);
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
    markPersonalOpenIdSetupStage('actor-login');
    let actorLoginFailureReported = false;
    let actorLogin: { access_token: string };
    try {
      actorLogin = await login(username, password, (category, status, code) => {
        markPersonalOpenIdSetupFailure(category, status, code);
        actorLoginFailureReported = true;
      });
    } catch (error) {
      if (!actorLoginFailureReported) {
        markPersonalOpenIdSetupFailure('other');
      }
      throw error;
    }
    actorAccessToken = actorLogin.access_token;
    markPersonalOpenIdSetupStage('actor-proof-validation');
    actorIdentity = decodeTaggedCredential(taggedCredential);
    if (actorIdentity.matrix_server_name !== matrixServerName) {
      throw new Error('Fixture proof has an unexpected Matrix server name');
    }

    markPersonalOpenIdSetupStage('create-personal-room');
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
    markPersonalOpenIdSetupStage('create-nonmember');
    await matrixJson(
      `/_synapse/admin/v2/users/${encodeURIComponent(`@${nonmemberName}:${matrixServerName}`)}`,
      {
        method: 'PUT',
        token: actorAccessToken,
        body: { password: nonmemberPassword, admin: false },
      },
    );
    markPersonalOpenIdSetupStage('nonmember-login');
    let nonmemberLoginFailureReported = false;
    let nonmemberLogin: { access_token: string };
    try {
      nonmemberLogin = await login(
        nonmemberName,
        nonmemberPassword,
        (category, status, code) => {
          markPersonalOpenIdSetupFailure(category, status, code);
          nonmemberLoginFailureReported = true;
        },
      );
    } catch (error) {
      if (!nonmemberLoginFailureReported) {
        markPersonalOpenIdSetupFailure('other');
      }
      throw error;
    }
    nonmemberLoginAccessToken = nonmemberLogin.access_token;
    markPersonalOpenIdSetupStage('nonmember-openid-proof');
    nonmemberIdentity = await matrixJson<MatrixIdentity>(
      `/_matrix/client/v3/user/${encodeURIComponent(`@${nonmemberName}:${matrixServerName}`)}/openid/request_token`,
      { method: 'POST', token: nonmemberLoginAccessToken, body: {} },
    );
    nonmemberIdentityHeader = identityHeader(nonmemberIdentity);

    markPersonalOpenIdSetupStage('gateway-init');
    app = await NestFactory.create(PersonalOpenIdGatewayContractModule, {
      logger: gatewayLogger,
    });
    authMiddleware = app.get(MatrixAuthMiddleware);
    originalExtractUserContext =
      authMiddleware.extractUserContext.bind(authMiddleware);
    app.use(
      (request: Request, response: ExpressResponse, next: NextFunction) => {
        if (activeStageDiagnostics) {
          activeStageDiagnostics.middlewareCalls += 1;
          activeStageDiagnostics.authorizationHeader =
            request.headers.authorization === undefined ? 'absent' : 'present';
        }
        return authMiddleware.use(request, response, next);
      },
    );
    app.enableVersioning({ type: VersioningType.URI });
    markPersonalOpenIdSetupStage('gateway-listen');
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    gatewayBaseUrl = `http://127.0.0.1:${address.port}`;
    markPersonalOpenIdSetupComplete();
  }, 30000);

  beforeEach(() => {
    credentialProviderFactorySpy.mockImplementation(createCredentialProvider);
    jest
      .spyOn(authMiddleware, 'extractUserContext')
      .mockImplementation(async (request) => {
        try {
          const context = await originalExtractUserContext(request);
          if (activeStageDiagnostics) {
            activeStageDiagnostics.identity = context
              ? context.userId === actorUserId
                ? 'actor'
                : 'other'
              : 'absent';
          }
          return context;
        } catch {
          if (activeStageDiagnostics) {
            activeStageDiagnostics.identity = 'rejected';
          }
          throw new Error('Matrix identity verification failed');
        }
      });
    countCalDavRequests = instrumentCalDavRequests(nativeFetch);
  });

  afterAll(async () => {
    if (app) await app.close();
    jest.restoreAllMocks();
    fetchMock.enableMocks();
    fetchMock.dontMock();
  });

  it('uses the actor proof and returns only the actor personal calendar', async () => {
    const providerCallsBefore = credentialProviderFactorySpy.mock.calls.length;
    const stages: ContractStageDiagnostics = {
      middlewareCalls: 0,
      authorizationHeader: 'not-observed',
      identity: 'not-observed',
      userInfoStatuses: [],
      membershipResults: [],
      caldavStatuses: [],
    };
    activeStageDiagnostics = stages;
    const response = await gatewayRequest(identityHeader(actorIdentity));
    activeStageDiagnostics = undefined;

    if (response.status !== 200) {
      const membership =
        stages.membershipResults.length === 0
          ? 'none'
          : stages.membershipResults
              .map((joined) => (joined ? 'yes' : 'no'))
              .join(',');
      const caldavStatus =
        stages.caldavStatuses.length === 0
          ? 'none'
          : stages.caldavStatuses.join(',');
      const userInfoStatus =
        stages.userInfoStatuses.length === 0
          ? 'none'
          : stages.userInfoStatuses.join(',');
      throw new Error(
        `SAFE_CALDAV_CONTRACT_DIAGNOSTIC gateway_status=${response.status} middleware_calls=${stages.middlewareCalls} authorization=${stages.authorizationHeader} identity=${stages.identity} userinfo_status=${userInfoStatus} membership=${membership} provider_calls=${credentialProviderFactorySpy.mock.calls.length - providerCallsBefore} caldav_status=${caldavStatus}`,
      );
    }

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

  it('keeps personal event create, read, and safe conditional delete working', async () => {
    const calendarId = new URL(
      `${encodeURIComponent(actorUserId.split(':')[0].slice(1))}/contract-calendar/`,
      radicaleBaseUrl,
    ).toString();
    const providerCallsBefore = credentialProviderFactorySpy.mock.calls.length;
    const calDavRequestsBefore = countCalDavRequests();
    const createResponse = await gatewayEventRequest(
      'POST',
      calendarId,
      undefined,
      {
        uid: `personal-delete-${randomUUID()}@example.test`,
        title: 'Personal delete contract',
        timing: {
          type: 'timed',
          start: {
            type: 'zoned',
            local: '2030-01-15T10:00:00',
            timezone: 'UTC',
          },
          end: {
            type: 'zoned',
            local: '2030-01-15T11:00:00',
            timezone: 'UTC',
          },
        },
      },
    );
    expect(createResponse.status).toBe(201);
    const created = JSON.parse(createResponse.body) as {
      event: { id: string; title: string };
      etag: string;
    };
    expect(created.event.title).toBe('Personal delete contract');
    expect(created.etag).toMatch(/^".+"$/);

    const getResponse = await gatewayEventRequest(
      'GET',
      calendarId,
      created.event.id,
    );
    expect(getResponse.status).toBe(200);
    expect(JSON.parse(getResponse.body)).toMatchObject({
      event: { id: created.event.id, title: 'Personal delete contract' },
      etag: created.etag,
    });

    const deleteResponse = await gatewayEventRequest(
      'DELETE',
      calendarId,
      created.event.id,
      undefined,
      created.etag,
    );
    expect(deleteResponse.status).toBe(200);
    expect(countCalDavRequests()).toBeGreaterThan(calDavRequestsBefore);
    expect(
      credentialProviderFactorySpy.mock.calls.length,
    ).toBeGreaterThanOrEqual(providerCallsBefore + 3);
    expectResponseToOmitCredentials(
      createResponse.body,
      actorIdentity.access_token,
    );
    expectResponseToOmitCredentials(
      getResponse.body,
      actorIdentity.access_token,
    );
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

  async function gatewayEventRequest(
    method: 'GET' | 'POST' | 'DELETE',
    calendarId: string,
    eventId?: string,
    body?: unknown,
    ifMatch?: string,
  ): Promise<{ status: number; body: string }> {
    const query = new URLSearchParams({ roomId, calendarId });
    if (eventId) query.set('eventId', eventId);
    const endpoint = method === 'GET' ? 'event' : 'events';
    const headers = {
      Authorization: identityHeader(actorIdentity),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(ifMatch === undefined ? {} : { 'If-Match': ifMatch }),
    };
    return new Promise((resolve, reject) => {
      const request = httpRequest(
        `${gatewayBaseUrl}/v1/calendar/${endpoint}?${query}`,
        { method, headers },
        (response) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer | string) =>
            chunks.push(Buffer.from(chunk)),
          );
          response.on('end', () => {
            const status = response.statusCode ?? 0;
            const stageFile = process.env.CALDAV_CONTRACT_STAGE_FILE;
            if (stageFile && status >= 100 && status <= 599) {
              try {
                appendFileSync(
                  stageFile,
                  `personal-openid-event-http-${method}-${status}\n`,
                  'utf8',
                );
              } catch {
                // Optional diagnostics contain only fixed methods and status codes.
              }
            }
            resolve({ status, body: Buffer.concat(chunks).toString('utf8') });
          });
        },
      );
      request.on('error', reject);
      if (body !== undefined) request.write(JSON.stringify(body));
      request.end();
    });
  }
});

function markPersonalOpenIdSetupComplete(): void {
  const stageFile = process.env.CALDAV_CONTRACT_STAGE_FILE;
  if (process.env.CALDAV_CONTRACT !== '1' || !stageFile) {
    return;
  }

  try {
    appendFileSync(stageFile, 'personal-openid-setup-complete\n', 'utf8');
  } catch {
    // Diagnostics must not change contract-test behavior.
  }
}

function markPersonalOpenIdSetupStart(): void {
  const stageFile = process.env.CALDAV_CONTRACT_STAGE_FILE;
  if (process.env.CALDAV_CONTRACT !== '1' || !stageFile) {
    return;
  }

  try {
    appendFileSync(stageFile, 'personal-openid-setup-start\n', 'utf8');
  } catch {
    // Diagnostics must not change contract-test behavior.
  }
}

function markPersonalOpenIdSetupStage(stage: PersonalOpenIdSetupStage): void {
  const stageFile = process.env.CALDAV_CONTRACT_STAGE_FILE;
  if (process.env.CALDAV_CONTRACT !== '1' || !stageFile) {
    return;
  }

  try {
    appendFileSync(stageFile, `personal-openid-setup-stage-${stage}\n`, 'utf8');
  } catch {
    // Diagnostics must not change contract-test behavior.
  }
}

function markPersonalOpenIdSetupFailure(
  category: PersonalOpenIdFailureCategory,
  status?: number,
  matrixErrorCode?: string,
): void {
  const stageFile = process.env.CALDAV_CONTRACT_STAGE_FILE;
  if (process.env.CALDAV_CONTRACT !== '1' || !stageFile) {
    return;
  }

  try {
    const markers = [`personal-openid-setup-failure-${category}`];
    if (
      typeof status === 'number' &&
      Number.isInteger(status) &&
      status >= 400 &&
      status <= 599
    ) {
      markers.push(`personal-openid-http-status-${status}`);
    }
    if (
      matrixErrorCode &&
      PERSONAL_OPENID_MATRIX_ERROR_CODES.has(matrixErrorCode)
    ) {
      markers.push(`personal-openid-matrix-error-${matrixErrorCode}`);
    }
    appendFileSync(stageFile, `${markers.join('\n')}\n`, 'utf8');
  } catch {
    // Diagnostics must not change contract-test behavior.
  }
}

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
  onFailureCategory?: (
    category: PersonalOpenIdFailureCategory,
    status?: number,
    matrixErrorCode?: string,
  ) => void,
): Promise<{ access_token: string }> {
  return matrixJson('/_matrix/client/v3/login', {
    method: 'POST',
    body: {
      type: 'm.login.password',
      identifier: { type: 'm.id.user', user: username },
      password,
    },
    onFailureCategory,
  });
}

async function matrixJson<T = Record<string, unknown>>(
  path: string,
  options: {
    method: string;
    token?: string;
    body: unknown;
    onFailureCategory?: (
      category: PersonalOpenIdFailureCategory,
      status?: number,
      matrixErrorCode?: string,
    ) => void;
  },
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(new URL(path, homeserverUrl), {
      method: options.method,
      headers: {
        'Content-Type': 'application/json',
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      body: JSON.stringify(options.body),
    });
  } catch (error) {
    options.onFailureCategory?.('transport');
    throw error;
  }
  if (!response.ok) {
    const matrixErrorCode = options.onFailureCategory
      ? await readMatrixErrorCode(response)
      : undefined;
    options.onFailureCategory?.(
      'http-status',
      response.status,
      matrixErrorCode,
    );
    throw new Error(
      `Matrix contract fixture request failed (${response.status})`,
    );
  }
  try {
    return (await response.json()) as T;
  } catch (error) {
    options.onFailureCategory?.('json-or-token-parse');
    throw error;
  }
}

async function readMatrixErrorCode(
  response: Response,
): Promise<string | undefined> {
  try {
    const body: unknown = await response.clone().json();
    if (
      body !== null &&
      typeof body === 'object' &&
      !Array.isArray(body) &&
      'errcode' in body &&
      typeof body.errcode === 'string' &&
      PERSONAL_OPENID_MATRIX_ERROR_CODES.has(body.errcode)
    ) {
      return body.errcode;
    }
  } catch {
    // Error response details must not affect the contract failure path.
  }
  return undefined;
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

function instrumentCalDavRequests(originalFetch: typeof fetch): () => number {
  const caldavOrigin = new URL(radicaleBaseUrl).origin;
  let requestCount = 0;
  jest.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url =
      typeof input === 'string' || input instanceof URL ? input : input.url;
    if (new URL(url, radicaleBaseUrl).origin === caldavOrigin) {
      requestCount += 1;
    }
    return originalFetch(input, init).then((response) => {
      const parsedUrl = new URL(url, radicaleBaseUrl);
      if (
        activeStageDiagnostics &&
        parsedUrl.pathname === '/_matrix/federation/v1/openid/userinfo'
      ) {
        activeStageDiagnostics.userInfoStatuses.push(response.status);
      }
      if (activeStageDiagnostics && parsedUrl.origin === caldavOrigin) {
        activeStageDiagnostics.caldavStatuses.push(response.status);
      }
      return response;
    });
  });
  return () => requestCount;
}
