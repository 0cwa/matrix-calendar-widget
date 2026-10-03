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
import { NextFunction, Request, Response } from 'express';
import fetchMock from 'jest-fetch-mock';
import { MatrixClient } from 'matrix-bot-sdk';
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { IAppConfiguration } from '../../src/IAppConfiguration';
import { ModuleProviderToken } from '../../src/ModuleProviderToken';
import { CalDavEventClient } from '../../src/caldav/CalDavEventClient';
import { MatrixOpenIdCalDavCredentialProviderFactory } from '../../src/caldav/MatrixOpenIdCalDavCredentialProviderFactory';
import { CalendarGatewayController } from '../../src/controller/CalendarGatewayController';
import { MatrixAuthGuard } from '../../src/guard/MatrixAuthGuard';
import { MatrixRoomMembershipGuard } from '../../src/guard/MatrixRoomMembershipGuard';
import { MatrixAuthMiddleware } from '../../src/middleware/MatrixAuthMiddleware';
import { MatrixCalendarAuthorizationFactory } from '../../src/service/MatrixCalendarAuthorization';
import { RoomCalendarCalDavAccess } from '../../src/service/RoomCalendarCalDavAccess';

const describeContract =
  process.env.CALDAV_CONTRACT === '1' ? describe : describe.skip;
const serviceToken = process.env.MATRIX_APPLICATION_SERVICE_TOKEN ?? '';
const serviceUserId =
  process.env.MATRIX_APPLICATION_SERVICE_USER_ID ??
  '@_matrix_calendar_service:localhost';
const radicaleBaseUrl = process.env.CALDAV_BASE_URL ?? 'http://localhost:5232/';
const homeserverUrl =
  process.env.MATRIX_CALENDAR_DEV_HOMESERVER_URL ?? 'http://localhost:8008';
const matrixServerName =
  process.env.MATRIX_CALENDAR_DEV_SERVER_NAME ?? 'localhost';
const testConfiguration = {
  homeserver_url: homeserverUrl,
  radicale_url: radicaleBaseUrl,
  room_calendar_access_enabled: true,
  application_service_token: serviceToken,
  application_service_user_id: serviceUserId,
  room_calendar_bindings: [],
} as unknown as IAppConfiguration;

let app: INestApplication;
let actorAccessToken: string;
let actorIdentity: { access_token: string; matrix_server_name: string };
let nativeFetch: typeof fetch;
let gatewayUrl: string;
let roomIds: string[];
let calendarIds: string[];
let activeCalDavRequests:
  | Array<{ method: string; pathname: string }>
  | undefined;
const serviceOpenIdTokens: string[] = [];
const serviceUserAccessTokens: string[] = [];
const gatewayLogLines: string[] = [];
type RoomAppServiceListingCheckpoint =
  | 'room-one-response-status'
  | 'room-one-response-json-parsed'
  | 'room-one-event-summary'
  | 'room-one-caldav-requests'
  | 'room-one-target-path'
  | 'room-one-no-root-discovery'
  | 'room-one-no-response-secret'
  | 'room-two-response-status'
  | 'room-two-response-json-parsed'
  | 'room-two-event-summary'
  | 'room-two-caldav-requests'
  | 'room-two-target-path'
  | 'room-two-no-root-discovery'
  | 'room-two-no-response-secret'
  | 'logs-secret-free';

function captureGatewayLog(...values: unknown[]): void {
  gatewayLogLines.push(values.map(String).join(' '));
}

const gatewayLogger: LoggerService = {
  log: captureGatewayLog,
  error: captureGatewayLog,
  warn: captureGatewayLog,
  debug: captureGatewayLog,
  verbose: captureGatewayLog,
  fatal: captureGatewayLog,
};

const matrixClient = {
  async getJoinedRoomMembers(roomId: string): Promise<string[]> {
    const response = await fetch(
      new URL(
        `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/joined_members`,
        homeserverUrl,
      ),
      { headers: { Authorization: `Bearer ${actorAccessToken}` } },
    );
    if (!response.ok) throw new Error('membership lookup failed');
    const body = (await response.json()) as {
      joined?: Record<string, unknown>;
    };
    return Object.keys(body.joined ?? {});
  },
  async getRoomStateEvent(roomId: string, eventType: string, stateKey: string) {
    const response = await fetch(
      new URL(
        `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/${encodeURIComponent(eventType)}/${encodeURIComponent(stateKey)}`,
        homeserverUrl,
      ),
      { headers: { Authorization: `Bearer ${actorAccessToken}` } },
    );
    if (response.status === 404) {
      const error = new Error('state not found') as Error & {
        statusCode: number;
        errcode: string;
      };
      error.statusCode = 404;
      error.errcode = 'M_NOT_FOUND';
      throw error;
    }
    if (!response.ok) throw new Error('power-level lookup failed');
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
    MatrixOpenIdCalDavCredentialProviderFactory,
    {
      provide: ModuleProviderToken.ROOM_CALENDAR_CALDAV_ACCESS,
      useClass: RoomCalendarCalDavAccess,
    },
    MatrixAuthMiddleware,
    MatrixAuthGuard,
    MatrixRoomMembershipGuard,
  ],
})
class RoomAppServiceGatewayContractModule {}

describeContract('room appservice proof against real Radicale', () => {
  beforeAll(async () => {
    fetchMock.disableMocks();
    nativeFetch = globalThis.fetch.bind(globalThis);
    const username = process.env.MATRIX_CALENDAR_DEV_USER ?? 'calendar';
    const password =
      process.env.MATRIX_CALENDAR_DEV_PASSWORD ?? 'calendar-dev-password';
    const personalCredential = process.env.CALDAV_OPENID_CREDENTIAL ?? '';
    if (!personalCredential.startsWith('matrix-openid:') || !serviceToken) {
      throw new Error('Synthetic Matrix contract credentials are missing');
    }
    actorIdentity = decodeIdentity(personalCredential);
    actorAccessToken = (
      await matrixJson<{ access_token: string }>('/_matrix/client/v3/login', {
        method: 'POST',
        body: {
          type: 'm.login.password',
          identifier: { type: 'm.id.user', user: username },
          password,
        },
      })
    ).access_token;

    await registerServiceUser();
    const firstRoom = await createRoom('M6 room calendar contract one');
    const secondRoom = await createRoom('M6 room calendar contract two');
    roomIds = [firstRoom, secondRoom];
    calendarIds = ['contract-room-one', 'contract-room-two'];
    testConfiguration.room_calendar_bindings = roomIds.map((roomId, index) => ({
      roomId,
      calendarId: calendarIds[index],
    }));

    const access = new RoomCalendarCalDavAccess(testConfiguration);
    for (let index = 0; index < roomIds.length; index += 1) {
      const principal = await access.forAuthorizedTarget({
        roomId: roomIds[index],
        calendarId: calendarIds[index],
        principal: { kind: 'service' },
      });
      serviceOpenIdTokens.push(principal.credential.accessToken);
      await createServiceCalendar(
        principal.calendarUrl,
        principal.userId,
        principal.credential,
      );
      await new CalDavEventClient(
        new MatrixOpenIdCalDavCredentialProviderFactory().forPrincipal(
          principal.userId,
          principal.credential,
        ),
      ).createEvent(
        new URL(`room-${index + 1}.ics`, principal.calendarUrl).toString(),
        eventCalendar(`room-${index + 1}`, `Room event ${index + 1}`),
      );
    }

    app = await NestFactory.create(RoomAppServiceGatewayContractModule, {
      logger: gatewayLogger,
    });
    const authMiddleware = app.get(MatrixAuthMiddleware);
    app.use((request: Request, response: Response, next: NextFunction) =>
      authMiddleware.use(request, response, next),
    );
    app.enableVersioning({ type: VersioningType.URI });
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    gatewayUrl = `http://127.0.0.1:${address.port}`;
    markRoomAppServiceSetupComplete();
  }, 30000);

  beforeEach(() => {
    activeCalDavRequests = [];
    jest.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url =
        typeof input === 'string' || input instanceof URL ? input : input.url;
      const parsedUrl = new URL(url, radicaleBaseUrl);
      if (parsedUrl.origin === new URL(radicaleBaseUrl).origin) {
        activeCalDavRequests?.push({
          method: init?.method ?? 'GET',
          pathname: parsedUrl.pathname,
        });
      }
      const response = await nativeFetch(input, init);
      if (
        parsedUrl.origin === new URL(homeserverUrl).origin &&
        parsedUrl.pathname.endsWith('/openid/request_token') &&
        init?.headers &&
        new Headers(init.headers).get('Authorization') ===
          `Bearer ${serviceToken}`
      ) {
        const result = (await response.clone().json()) as {
          access_token?: unknown;
        };
        if (typeof result.access_token === 'string') {
          serviceOpenIdTokens.push(result.access_token);
        }
      }
      return response;
    });
  });

  afterAll(async () => {
    try {
      if (
        typeof actorIdentity !== 'undefined' &&
        (serviceOpenIdTokens.length > 0 || serviceUserAccessTokens.length > 0)
      ) {
        assertLogsOmitSecrets();
      }
    } finally {
      if (app) await app.close();
      jest.restoreAllMocks();
      fetchMock.enableMocks();
      fetchMock.dontMock();
    }
  });

  it('lists only the exact room binding through the appservice principal', async () => {
    for (let index = 0; index < roomIds.length; index += 1) {
      activeCalDavRequests = [];
      const response = await gatewayRequest({
        roomId: roomIds[index],
        calendarId: calendarIds[index],
      });
      expect(response.status).toBe(200);
      const checkpointRoom = index === 0 ? 'room-one' : 'room-two';
      markRoomAppServiceListingCheckpoint(`${checkpointRoom}-response-status`);
      const body = JSON.parse(response.body) as {
        events: Array<{ event: { id: string; summary: string } }>;
      };
      markRoomAppServiceListingCheckpoint(
        `${checkpointRoom}-response-json-parsed`,
      );
      expect(body.events.map(({ event }) => event.summary)).toEqual([
        `Room event ${index + 1}`,
      ]);
      markRoomAppServiceListingCheckpoint(`${checkpointRoom}-event-summary`);
      expect(activeCalDavRequests?.length).toBeGreaterThan(0);
      markRoomAppServiceListingCheckpoint(`${checkpointRoom}-caldav-requests`);
      expect(
        activeCalDavRequests?.every(({ pathname }) =>
          pathname.startsWith(
            `/_matrix_calendar_service/${calendarIds[index]}/`,
          ),
        ),
      ).toBe(true);
      markRoomAppServiceListingCheckpoint(`${checkpointRoom}-target-path`);
      expect(
        activeCalDavRequests?.some(
          ({ method, pathname }) =>
            method === 'PROPFIND' && pathname === '/_matrix_calendar_service/',
        ),
      ).toBe(false);
      markRoomAppServiceListingCheckpoint(
        `${checkpointRoom}-no-root-discovery`,
      );
      const responseSecrets = [
        serviceToken,
        actorAccessToken,
        ...serviceOpenIdTokens,
        ...serviceUserAccessTokens,
      ];
      expect(
        responseSecrets.some((secret) => response.body.includes(secret)),
      ).toBe(false);
      markRoomAppServiceListingCheckpoint(
        `${checkpointRoom}-no-response-secret`,
      );
    }
    assertLogsOmitSecrets();
    markRoomAppServiceListingCheckpoint('logs-secret-free');
  });

  it('binds the Radicale OpenID subject to the configured service user, not the room sender', async () => {
    const serviceProof = serviceOpenIdTokens[0];
    if (serviceProof === undefined) {
      throw new Error('Synthetic appservice OpenID proof is missing');
    }

    const [serviceSubject, roomSender] = await Promise.all([
      matrixOpenIdSubject(serviceProof),
      matrixUserIdForAccessToken(actorAccessToken),
    ]);

    expect(serviceSubject).toBe(serviceUserId);
    expect(serviceSubject).not.toBe(roomSender);
    assertLogsOmitSecrets();
  });

  it('forbids a cross-room calendar before appservice proof or CalDAV I/O', async () => {
    const proofCountBefore = serviceOpenIdTokens.length;
    const response = await gatewayRequest({
      roomId: roomIds[0],
      calendarId: calendarIds[1],
    });
    expect(response.status).toBe(403);
    expect(activeCalDavRequests).toEqual([]);
    expect(serviceOpenIdTokens).toHaveLength(proofCountBefore);
    assertLogsOmitSecrets();
  });

  async function gatewayRequest(target: {
    roomId: string;
    calendarId: string;
  }): Promise<{ status: number; body: string }> {
    const query = new URLSearchParams({
      target: 'room',
      roomId: target.roomId,
      calendarId: target.calendarId,
      start: '2026-01-01T00:00:00.000Z',
      end: '2027-01-01T00:00:00.000Z',
      timezone: 'UTC',
    });
    const authorization = identityHeader(actorIdentity);
    return new Promise((resolve, reject) => {
      const request = httpRequest(
        `${gatewayUrl}/v1/calendar/events?${query}`,
        { headers: { Authorization: authorization } },
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

function markRoomAppServiceSetupComplete(): void {
  const stageFile = process.env.CALDAV_CONTRACT_STAGE_FILE;
  if (process.env.CALDAV_CONTRACT !== '1' || !stageFile) {
    return;
  }

  try {
    appendFileSync(stageFile, 'room-appservice-setup-complete\n', 'utf8');
  } catch {
    // Diagnostics must not change contract-test behavior.
  }
}

function markRoomAppServiceListingCheckpoint(
  checkpoint: RoomAppServiceListingCheckpoint,
): void {
  const stageFile = process.env.CALDAV_CONTRACT_STAGE_FILE;
  if (process.env.CALDAV_CONTRACT !== '1' || !stageFile) {
    return;
  }

  try {
    appendFileSync(
      stageFile,
      `room-appservice-listing-${checkpoint}\n`,
      'utf8',
    );
  } catch {
    // Diagnostics must not change contract-test behavior.
  }
}

async function registerServiceUser(): Promise<void> {
  const response = await nativeFetch(
    new URL('/_matrix/client/v3/register', homeserverUrl),
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'm.login.application_service',
        username: serviceUserId.slice(1).split(':')[0],
      }),
    },
  );
  if (!response.ok)
    throw new Error('Application-service fixture registration failed');
  const result = (await response.json()) as {
    user_id?: string;
    access_token?: string;
  };
  if (result.user_id !== serviceUserId) {
    throw new Error(
      'Application-service fixture user did not match configuration',
    );
  }
  if (result.access_token) serviceUserAccessTokens.push(result.access_token);
}

async function createRoom(name: string): Promise<string> {
  const result = await matrixJson<{ room_id: string }>(
    '/_matrix/client/v3/createRoom',
    {
      method: 'POST',
      token: actorAccessToken,
      body: { name, preset: 'private_chat' },
    },
  );
  return result.room_id;
}

async function createServiceCalendar(
  calendarUrl: string,
  userId: string,
  credential: { accessToken: string; matrixServerName: string },
): Promise<void> {
  const auth = await new MatrixOpenIdCalDavCredentialProviderFactory()
    .forPrincipal(userId, credential)
    .getRequestHeaders();
  const response = await nativeFetch(calendarUrl, {
    method: 'MKCALENDAR',
    headers: {
      ...auth,
      'Content-Type': 'application/xml; charset=utf-8',
    },
    body: '<C:mkcalendar xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:D="DAV:"><D:set><D:prop><D:displayname>Room contract</D:displayname><C:supported-calendar-component-set><C:comp name="VEVENT"/></C:supported-calendar-component-set></D:prop></D:set></C:mkcalendar>',
  });
  if (!response.ok) throw new Error('Synthetic room calendar creation failed');
}

function eventCalendar(uid: string, summary: string): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Matrix Calendar Widget//Room Contract//EN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    'DTSTAMP:20261002T120000Z',
    'DTSTART:20261003T120000Z',
    'DTEND:20261003T130000Z',
    `SUMMARY:${summary}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

async function matrixJson<T>(
  path: string,
  options: { method: string; token?: string; body: unknown },
): Promise<T> {
  const response = await nativeFetch(new URL(path, homeserverUrl), {
    method: options.method,
    headers: {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: JSON.stringify(options.body),
  });
  if (!response.ok) throw new Error('Matrix contract fixture request failed');
  return (await response.json()) as T;
}

async function matrixOpenIdSubject(accessToken: string): Promise<string> {
  const url = new URL('/_matrix/federation/v1/openid/userinfo', homeserverUrl);
  url.searchParams.set('access_token', accessToken);
  const response = await nativeFetch(url);
  if (!response.ok) throw new Error('Synthetic OpenID subject is unavailable');
  const result = (await response.json()) as { sub?: unknown };
  if (typeof result.sub !== 'string') {
    throw new Error('Synthetic OpenID subject is malformed');
  }
  return result.sub;
}

async function matrixUserIdForAccessToken(
  accessToken: string,
): Promise<string> {
  const response = await nativeFetch(
    new URL('/_matrix/client/v3/account/whoami', homeserverUrl),
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!response.ok) throw new Error('Synthetic room sender is unavailable');
  const result = (await response.json()) as { user_id?: unknown };
  if (typeof result.user_id !== 'string') {
    throw new Error('Synthetic room sender is malformed');
  }
  return result.user_id;
}

function decodeIdentity(credential: string): {
  access_token: string;
  matrix_server_name: string;
} {
  try {
    return JSON.parse(
      Buffer.from(
        credential.slice('matrix-openid:'.length),
        'base64url',
      ).toString('utf8'),
    ) as { access_token: string; matrix_server_name: string };
  } catch {
    throw new Error('CalDAV contract identity is malformed');
  }
}

function identityHeader(identity: {
  access_token: string;
  matrix_server_name: string;
}): string {
  return `MX-Identity ${Buffer.from(JSON.stringify(identity)).toString('base64url')}`;
}

function assertLogsOmitSecrets(): void {
  let serviceLogs: string;
  try {
    serviceLogs = execFileSync(
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
  const logs = `${gatewayLogLines.join('\n')}\n${serviceLogs}`;
  const actorTaggedProof = taggedProof(actorIdentity);
  const actorAuthorization = identityHeader(actorIdentity);
  const serviceLocalpart = serviceUserId.slice(1).split(':')[0];
  const serviceTaggedProofs = serviceOpenIdTokens.map((accessToken) =>
    taggedProof({
      access_token: accessToken,
      matrix_server_name: matrixServerName,
    }),
  );
  const serviceBasicHeaders = serviceTaggedProofs.map(
    (proof) =>
      `Basic ${Buffer.from(`${serviceLocalpart}:${proof}`, 'utf8').toString('base64')}`,
  );
  const secrets = [
    serviceToken,
    `Bearer ${serviceToken}`,
    actorAccessToken,
    actorIdentity.access_token,
    actorTaggedProof,
    actorAuthorization,
    ...serviceOpenIdTokens,
    ...serviceTaggedProofs,
    ...serviceBasicHeaders,
    ...serviceUserAccessTokens,
  ];
  if (secrets.some((secret) => secret && logs.includes(secret))) {
    throw new Error('Contract logs contain protected authentication material');
  }
}

function taggedProof(identity: {
  access_token: string;
  matrix_server_name: string;
}): string {
  return `matrix-openid:${Buffer.from(JSON.stringify(identity)).toString('base64url')}`;
}
