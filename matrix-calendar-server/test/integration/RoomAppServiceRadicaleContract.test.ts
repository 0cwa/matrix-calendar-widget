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
import { randomBytes, randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { AppRuntimeContext } from '../../src/AppRuntimeContext';
import { IAppConfiguration } from '../../src/IAppConfiguration';
import { ModuleProviderToken } from '../../src/ModuleProviderToken';
import { CalDavEventClient } from '../../src/caldav/CalDavEventClient';
import { MatrixOpenIdCalDavCredentialProviderFactory } from '../../src/caldav/MatrixOpenIdCalDavCredentialProviderFactory';
import { CalendarGatewayController } from '../../src/controller/CalendarGatewayController';
import { MatrixAuthGuard } from '../../src/guard/MatrixAuthGuard';
import { MatrixRoomMembershipGuard } from '../../src/guard/MatrixRoomMembershipGuard';
import { MatrixAuthMiddleware } from '../../src/middleware/MatrixAuthMiddleware';
import {
  CalendarCommandService,
  CalendarCommandTranslation,
} from '../../src/service/CalendarCommandService';
import { ConfiguredRoomCalendarPrincipalIdentityProvider } from '../../src/service/ConfiguredRoomCalendarPrincipalIdentityProvider';
import { MatrixCalendarAuthorizationFactory } from '../../src/service/MatrixCalendarAuthorization';
import { RoomCalendarCalDavAccess } from '../../src/service/RoomCalendarCalDavAccess';
import { RoomCalendarEventOperations } from '../../src/service/RoomCalendarEventOperations';
import type { RoomCalendarPrincipalIdentityProvider } from '../../src/service/RoomCalendarPrincipalIdentity';
import {
  MatrixApplicationServiceFixtureError,
  obtainMatrixApplicationServiceFixtureUserToken,
} from '../util/MatrixApplicationServiceFixtureUser';

const describeContract =
  process.env.CALDAV_CONTRACT === '1' ? describe : describe.skip;
const serviceToken = process.env.MATRIX_APPLICATION_SERVICE_TOKEN ?? '';
const serviceUserId =
  process.env.MATRIX_APPLICATION_SERVICE_USER_ID ??
  '@_matrix_calendar_service:localhost';
const roomPrincipalMode =
  process.env.ROOM_CALENDAR_PRINCIPAL_MODE ?? 'appservice';
if (roomPrincipalMode !== 'appservice' && roomPrincipalMode !== 'bot-account') {
  throw new Error('Room principal contract mode is invalid');
}
if (
  roomPrincipalMode === 'bot-account' &&
  (process.env.MATRIX_CALENDAR_DEV_APPSERVICE_REGISTRATION !== 'disabled' ||
    serviceToken.length > 0)
) {
  throw new Error('Bot-account contract requires an AS-free Synapse fixture');
}
const radicaleBaseUrl = process.env.CALDAV_BASE_URL ?? 'http://localhost:5232/';
const homeserverUrl =
  process.env.MATRIX_CALENDAR_DEV_HOMESERVER_URL ?? 'http://localhost:8008';
const matrixServerName =
  process.env.MATRIX_CALENDAR_DEV_SERVER_NAME ?? 'localhost';
const testConfiguration = {
  homeserver_url: homeserverUrl,
  radicale_url: radicaleBaseUrl,
  room_calendar_principal_mode: roomPrincipalMode,
  access_token: process.env.ACCESS_TOKEN ?? '',
  room_calendar_access_enabled: true,
  room_calendar_event_writes_enabled: true,
  application_service_token: serviceToken,
  application_service_user_id: serviceUserId,
  room_calendar_bindings: [],
} as unknown as IAppConfiguration;
const roomPrincipalIdentity = Object.freeze({
  mode: 'appservice' as const,
  userId: serviceUserId,
});
let roomPrincipalIdentityProvider:
  | RoomCalendarPrincipalIdentityProvider
  | undefined;
let principalUserId = serviceUserId;
let principalAccessToken = '';

let app: INestApplication;
let actorAccessToken: string;
let actorIdentity: { access_token: string; matrix_server_name: string };
let nativeFetch: typeof fetch;
let gatewayUrl: string;
let roomIds: string[];
let calendarIds: string[];
let nonmemberRoomId: string;
let activeCalDavRequests:
  | Array<{ method: string; pathname: string; hasIfMatch: boolean }>
  | undefined;
const serviceOpenIdTokens: string[] = [];
const serviceUserAccessTokens: string[] = [];
const principalOpenIdRequests: Array<{
  readonly authorizationMatchesPrincipal: boolean;
  readonly pathUserId: string;
  readonly hasUserIdQuery: boolean;
  readonly hasUserIdBody: boolean;
}> = [];
const gatewayLogLines: string[] = [];
const matrixErrorCodes = new Set([
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
type RoomAppServiceSetupStage =
  | 'fixture-input-check'
  | 'decode-actor-proof'
  | 'actor-login'
  | 'register-service-user'
  | 'create-room-one'
  | 'create-room-two'
  | 'configure-room-bindings'
  | 'room-one-proof-and-calendar'
  | 'room-two-proof-and-calendar'
  | 'gateway-create'
  | 'gateway-configure'
  | 'gateway-listen';
type RoomAppServiceCase =
  | 'exact-binding'
  | 'subject-binding'
  | 'cross-room-denial'
  | 'event-write'
  | 'unauthorized-write'
  | 'bot-command-write'
  | 'bot-command-denial';
type RoomAppServiceFailureCase = 'subject-binding' | 'cross-room-denial';
type RoomAppServiceCaseFailureStage =
  | 'proof-selected'
  | 'proof-available'
  | 'identities-resolved'
  | 'subject-is-principal'
  | 'subject-not-room-sender'
  | 'principal-requests-collected'
  | 'request-path-matches-principal'
  | 'request-policy-matches-mode'
  | 'proof-count-captured'
  | 'request-completed'
  | 'response-forbidden'
  | 'no-caldav-request'
  | 'no-new-openid-proof'
  | 'logs-secret-free';
type RoomAppServiceTeardownStage =
  | 'started'
  | 'log-check-started'
  | 'log-check-completed'
  | 'app-close-started'
  | 'app-close-completed'
  | 'mocks-reset'
  | 'complete';
type RoomAppServiceTeardownFailure = 'log-check' | 'app-close' | 'mocks-reset';

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
    {
      provide: ModuleProviderToken.NATIVE_FETCH,
      useValue: (input: RequestInfo | URL, init?: RequestInit) =>
        globalThis.fetch(input, init),
    },
    {
      provide: ModuleProviderToken.ROOM_CALENDAR_PRINCIPAL_IDENTITY,
      useFactory: getRoomPrincipalIdentityProvider,
    },
    { provide: MatrixClient, useValue: matrixClient },
    MatrixCalendarAuthorizationFactory,
    MatrixOpenIdCalDavCredentialProviderFactory,
    {
      provide: ModuleProviderToken.ROOM_CALENDAR_CALDAV_ACCESS,
      useClass: RoomCalendarCalDavAccess,
    },
    {
      provide: RoomCalendarEventOperations,
      useFactory: () =>
        new RoomCalendarEventOperations((input, init) => fetch(input, init), {
          eventWritesEnabled: true,
          maxResponseBytes: testConfiguration.caldav_max_event_response_bytes,
          radicaleBaseUrl,
          roomCalendarBindings: testConfiguration.room_calendar_bindings,
          principalIdentityProvider: getRoomPrincipalIdentityProvider(),
        }),
    },
    {
      provide: CalendarCommandService,
      useFactory: (
        appConfig: IAppConfiguration,
        authorizationFactory: MatrixCalendarAuthorizationFactory,
        access: RoomCalendarCalDavAccess,
        operations: RoomCalendarEventOperations,
      ) =>
        new CalendarCommandService(
          appConfig,
          authorizationFactory,
          access,
          operations,
        ),
      inject: [
        ModuleProviderToken.APP_CONFIGURATION,
        MatrixCalendarAuthorizationFactory,
        ModuleProviderToken.ROOM_CALENDAR_CALDAV_ACCESS,
        RoomCalendarEventOperations,
      ],
    },
    MatrixAuthMiddleware,
    MatrixAuthGuard,
    MatrixRoomMembershipGuard,
  ],
})
class RoomAppServiceGatewayContractModule {}

const contractDescription = `room ${roomPrincipalMode} proof against real Radicale`;

describeContract(contractDescription, () => {
  beforeAll(async () => {
    markRoomAppServiceSetupStart();
    markRoomAppServiceSetupStage('fixture-input-check');
    fetchMock.disableMocks();
    nativeFetch = globalThis.fetch.bind(globalThis);
    const username = process.env.MATRIX_CALENDAR_DEV_USER ?? 'calendar';
    const password =
      process.env.MATRIX_CALENDAR_DEV_PASSWORD ?? 'calendar-dev-password';
    const personalCredential = process.env.CALDAV_OPENID_CREDENTIAL ?? '';
    if (
      !personalCredential.startsWith('matrix-openid:') ||
      (roomPrincipalMode === 'appservice' && !serviceToken)
    ) {
      throw new Error('Synthetic Matrix contract credentials are missing');
    }
    markRoomAppServiceSetupStage('decode-actor-proof');
    actorIdentity = decodeIdentity(personalCredential);
    markRoomAppServiceSetupStage('actor-login');
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

    markRoomAppServiceSetupStage('register-service-user');
    if (roomPrincipalMode === 'appservice') {
      await registerServiceUser();
      principalUserId = serviceUserId;
      principalAccessToken = serviceToken;
      roomPrincipalIdentityProvider = {
        resolve: async () => roomPrincipalIdentity,
      };
    } else {
      const principal = await registerNormalBotAccount();
      principalUserId = principal.userId;
      principalAccessToken = principal.accessToken;
      serviceUserAccessTokens.push(principal.accessToken);
      testConfiguration.access_token = principal.accessToken;
      const principalClient = new MatrixClient(
        homeserverUrl,
        testConfiguration.access_token,
      );
      const sdkUserId = await principalClient.getUserId();
      if (sdkUserId !== principalUserId) {
        throw new Error(
          'Synthetic bot token identity did not match its account',
        );
      }
      const localpart = sdkUserId.slice(1).split(':')[0];
      const runtimeContext = new AppRuntimeContext(
        sdkUserId,
        localpart,
        localpart,
        ['en'],
      );
      roomPrincipalIdentityProvider =
        new ConfiguredRoomCalendarPrincipalIdentityProvider(
          testConfiguration,
          principalClient,
          runtimeContext,
        );
      const identity = await roomPrincipalIdentityProvider.resolve();
      if (identity.mode !== 'bot-account' || identity.userId !== sdkUserId) {
        throw new Error(
          'Synthetic bot principal identity could not be verified',
        );
      }
    }
    markRoomAppServiceSetupStage('create-room-one');
    const firstRoom = await createRoom('M6 room calendar contract one');
    markRoomAppServiceSetupStage('create-room-two');
    const secondRoom = await createRoom('M6 room calendar contract two');
    roomIds = [firstRoom, secondRoom];
    calendarIds = ['contract-room-one', 'contract-room-two'];
    const serviceUserAccessToken = serviceUserAccessTokens[0];
    if (!serviceUserAccessToken) {
      throw new Error('Synthetic service-user access token is missing');
    }
    nonmemberRoomId = await createRoom(
      'M6 room calendar nonmember contract',
      serviceUserAccessToken,
    );
    markRoomAppServiceSetupStage('configure-room-bindings');
    const nonmemberCalendarId = 'contract-nonmember';
    testConfiguration.room_calendar_bindings = [
      ...roomIds.map((roomId, index) => ({
        roomId,
        calendarId: calendarIds[index],
      })),
      { roomId: nonmemberRoomId, calendarId: nonmemberCalendarId },
    ];

    const access = new RoomCalendarCalDavAccess(
      testConfiguration,
      undefined,
      getRoomPrincipalIdentityProvider(),
    );
    for (let index = 0; index < roomIds.length; index += 1) {
      markRoomAppServiceSetupStage(
        index === 0
          ? 'room-one-proof-and-calendar'
          : 'room-two-proof-and-calendar',
      );
      const principal = await access.forAuthorizedTarget(
        {
          roomId: roomIds[index],
          calendarId: calendarIds[index],
          principal: { kind: 'service' },
        },
        'read',
      );
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
    const nonmemberPrincipal = await access.forAuthorizedTarget(
      {
        roomId: nonmemberRoomId,
        calendarId: nonmemberCalendarId,
        principal: { kind: 'service' },
      },
      'read',
    );
    serviceOpenIdTokens.push(nonmemberPrincipal.credential.accessToken);
    await createServiceCalendar(
      nonmemberPrincipal.calendarUrl,
      nonmemberPrincipal.userId,
      nonmemberPrincipal.credential,
    );

    markRoomAppServiceSetupStage('gateway-create');
    app = await NestFactory.create(RoomAppServiceGatewayContractModule, {
      logger: gatewayLogger,
    });
    markRoomAppServiceSetupStage('gateway-configure');
    const authMiddleware = app.get(MatrixAuthMiddleware);
    app.use((request: Request, response: Response, next: NextFunction) =>
      authMiddleware.use(request, response, next),
    );
    app.enableVersioning({ type: VersioningType.URI });
    markRoomAppServiceSetupStage('gateway-listen');
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
          hasIfMatch: new Headers(init?.headers).has('If-Match'),
        });
      }
      const authorization = new Headers(init?.headers).get('Authorization');
      const openIdPath = parsedUrl.pathname.match(
        /\/user\/([^/]+)\/openid\/request_token$/,
      );
      if (
        parsedUrl.origin === new URL(homeserverUrl).origin &&
        openIdPath !== null
      ) {
        let bodyHasUserId = false;
        if (typeof init?.body === 'string') {
          try {
            const body: unknown = JSON.parse(init.body);
            bodyHasUserId =
              typeof body === 'object' &&
              body !== null &&
              Object.prototype.hasOwnProperty.call(body, 'user_id');
          } catch {
            bodyHasUserId = false;
          }
        }
        principalOpenIdRequests.push({
          authorizationMatchesPrincipal:
            authorization === `Bearer ${principalAccessToken}`,
          pathUserId: decodeURIComponent(openIdPath[1]),
          hasUserIdQuery: parsedUrl.searchParams.has('user_id'),
          hasUserIdBody: bodyHasUserId,
        });
      }
      const response = await nativeFetch(input, init);
      if (
        parsedUrl.origin === new URL(homeserverUrl).origin &&
        parsedUrl.pathname.endsWith('/openid/request_token') &&
        authorization === `Bearer ${principalAccessToken}`
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
    markRoomAppServiceTeardownStage('started');
    let teardownFailed = false;
    let teardownError: unknown;
    if (
      typeof actorIdentity !== 'undefined' &&
      (serviceOpenIdTokens.length > 0 || serviceUserAccessTokens.length > 0)
    ) {
      markRoomAppServiceTeardownStage('log-check-started');
      try {
        assertLogsOmitSecrets();
        markRoomAppServiceTeardownStage('log-check-completed');
      } catch (error) {
        markRoomAppServiceTeardownFailure('log-check');
        teardownFailed = true;
        teardownError = error;
      }
    }
    if (app) {
      markRoomAppServiceTeardownStage('app-close-started');
      try {
        await app.close();
        markRoomAppServiceTeardownStage('app-close-completed');
      } catch (error) {
        markRoomAppServiceTeardownFailure('app-close');
        teardownFailed = true;
        teardownError = error;
      }
    }
    markRoomAppServiceTeardownStage('mocks-reset');
    try {
      jest.restoreAllMocks();
      fetchMock.enableMocks();
      fetchMock.dontMock();
    } catch (error) {
      markRoomAppServiceTeardownFailure('mocks-reset');
      teardownFailed = true;
      teardownError = error;
    }
    if (teardownFailed) throw teardownError;
    markRoomAppServiceTeardownStage('complete');
  });

  it('lists only the exact room binding through the selected principal', async () => {
    markRoomAppServiceCaseStarted('exact-binding');
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
        events: Array<{ event: { id: string; title: string } }>;
      };
      markRoomAppServiceListingCheckpoint(
        `${checkpointRoom}-response-json-parsed`,
      );
      expect(body.events.map(({ event }) => event.title)).toEqual([
        `Room event ${index + 1}`,
      ]);
      markRoomAppServiceListingCheckpoint(`${checkpointRoom}-event-summary`);
      expect(activeCalDavRequests?.length).toBeGreaterThan(0);
      markRoomAppServiceListingCheckpoint(`${checkpointRoom}-caldav-requests`);
      expect(
        activeCalDavRequests?.every(({ pathname }) =>
          pathname.startsWith(
            `/${principalLocalpart()}/${calendarIds[index]}/`,
          ),
        ),
      ).toBe(true);
      markRoomAppServiceListingCheckpoint(`${checkpointRoom}-target-path`);
      expect(
        activeCalDavRequests?.some(
          ({ method, pathname }) =>
            method === 'PROPFIND' && pathname === `/${principalLocalpart()}/`,
        ),
      ).toBe(false);
      markRoomAppServiceListingCheckpoint(
        `${checkpointRoom}-no-root-discovery`,
      );
      const responseSecrets = [
        ...(serviceToken ? [serviceToken] : []),
        principalAccessToken,
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

  it('binds the Radicale OpenID subject to the selected principal, not the room sender', async () => {
    markRoomAppServiceCaseStarted('subject-binding');
    const serviceProof = serviceOpenIdTokens[0];
    markRoomAppServiceCaseStage('subject-binding', 'proof-selected');
    if (serviceProof === undefined) {
      throw new Error('Synthetic room principal OpenID proof is missing');
    }
    markRoomAppServiceCaseStage('subject-binding', 'proof-available');

    const [serviceSubject, roomSender] = await Promise.all([
      matrixOpenIdSubject(serviceProof),
      matrixUserIdForAccessToken(actorAccessToken),
    ]);
    markRoomAppServiceCaseStage('subject-binding', 'identities-resolved');

    expect(serviceSubject).toBe(principalUserId);
    markRoomAppServiceCaseStage('subject-binding', 'subject-is-principal');
    expect(serviceSubject).not.toBe(roomSender);
    markRoomAppServiceCaseStage('subject-binding', 'subject-not-room-sender');
    const selectedPrincipalRequests = principalOpenIdRequests.filter(
      ({ authorizationMatchesPrincipal }) => authorizationMatchesPrincipal,
    );
    expect(selectedPrincipalRequests.length).toBeGreaterThan(0);
    markRoomAppServiceCaseStage(
      'subject-binding',
      'principal-requests-collected',
    );
    expect(
      selectedPrincipalRequests.every(
        ({ pathUserId }) => pathUserId === principalUserId,
      ),
    ).toBe(true);
    markRoomAppServiceCaseStage(
      'subject-binding',
      'request-path-matches-principal',
    );
    if (roomPrincipalMode === 'bot-account') {
      expect(
        selectedPrincipalRequests.every(
          ({ hasUserIdQuery, hasUserIdBody }) =>
            !hasUserIdQuery && !hasUserIdBody,
        ),
      ).toBe(true);
    } else {
      expect(
        selectedPrincipalRequests.every(({ hasUserIdBody }) => hasUserIdBody),
      ).toBe(true);
    }
    markRoomAppServiceCaseStage(
      'subject-binding',
      'request-policy-matches-mode',
    );
    assertLogsOmitSecrets();
    markRoomAppServiceCaseStage('subject-binding', 'logs-secret-free');
  });

  it('forbids a cross-room calendar before principal proof or CalDAV I/O', async () => {
    markRoomAppServiceCaseStarted('cross-room-denial');
    const proofCountBefore = serviceOpenIdTokens.length;
    markRoomAppServiceCaseStage('cross-room-denial', 'proof-count-captured');
    const response = await gatewayRequest({
      roomId: roomIds[0],
      calendarId: calendarIds[1],
    });
    markRoomAppServiceCaseStage('cross-room-denial', 'request-completed');
    expect(response.status).toBe(403);
    markRoomAppServiceCaseStage('cross-room-denial', 'response-forbidden');
    expect(activeCalDavRequests).toEqual([]);
    markRoomAppServiceCaseStage('cross-room-denial', 'no-caldav-request');
    expect(serviceOpenIdTokens).toHaveLength(proofCountBefore);
    markRoomAppServiceCaseStage('cross-room-denial', 'no-new-openid-proof');
    assertLogsOmitSecrets();
    markRoomAppServiceCaseStage('cross-room-denial', 'logs-secret-free');
  });

  it('creates, reads, updates, and conditionally deletes a room event', async () => {
    markRoomAppServiceCaseStarted('event-write');
    const target = { roomId: roomIds[0], calendarId: calendarIds[0] };
    const createResponse = await gatewayEventRequest(
      'POST',
      target,
      undefined,
      {
        uid: `room-write-${randomUUID()}@example.test`,
        title: 'Created room event',
        timing: {
          type: 'timed',
          start: {
            type: 'zoned',
            local: '2026-10-03T12:00:00',
            timezone: 'UTC',
          },
          end: {
            type: 'zoned',
            local: '2026-10-03T13:00:00',
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
    expect(created.event.title).toBe('Created room event');
    expect(created.etag).toMatch(/^".+"$/);

    const getResponse = await gatewayEventRequest(
      'GET',
      target,
      created.event.id,
    );
    expect(getResponse.status).toBe(200);
    const getBody = JSON.parse(getResponse.body) as Record<string, unknown>;
    expect(getBody).toMatchObject({
      event: { id: created.event.id, title: 'Created room event' },
      etag: created.etag,
    });
    expect(Object.keys(getBody).sort()).toEqual(['etag', 'event']);
    expect(getResponse.body).not.toContain('BEGIN:VCALENDAR');

    const updateResponse = await gatewayEventRequest(
      'PATCH',
      target,
      created.event.id,
      { title: 'Updated room event' },
      created.etag,
    );
    expect(updateResponse.status).toBe(200);
    const updated = JSON.parse(updateResponse.body) as {
      event: { id: string; title: string };
      etag: string;
    };
    expect(updated.event.title).toBe('Updated room event');
    expect(updated.etag).not.toBe(created.etag);
    const staleUpdate = await gatewayEventRequest(
      'PATCH',
      target,
      created.event.id,
      { title: 'Must not replace the newer event' },
      created.etag,
    );
    expect(staleUpdate.status).toBe(409);
    const staleDelete = await gatewayEventRequest(
      'DELETE',
      target,
      created.event.id,
      undefined,
      created.etag,
    );
    expect(staleDelete.status).toBe(409);
    expect(
      activeCalDavRequests?.some(({ method }) => method === 'DELETE'),
    ).toBe(false);

    const deleteResponse = await gatewayEventRequest(
      'DELETE',
      target,
      updated.event.id,
      undefined,
      updated.etag,
    );
    expect(deleteResponse.status).toBe(200);
    expect(
      activeCalDavRequests?.some(({ method }) => method === 'DELETE'),
    ).toBe(true);
    assertLogsOmitSecrets();
  }, 30000);

  it('denies cross-room and nonmember writes before proof or CalDAV I/O', async () => {
    markRoomAppServiceCaseStarted('unauthorized-write');
    const input = {
      uid: `unauthorized-${randomUUID()}@example.test`,
      title: 'Must not be written',
      timing: {
        type: 'timed',
        start: {
          type: 'zoned',
          local: '2026-10-03T12:00:00',
          timezone: 'UTC',
        },
        end: {
          type: 'zoned',
          local: '2026-10-03T13:00:00',
          timezone: 'UTC',
        },
      },
    };

    for (const target of [
      { roomId: roomIds[0], calendarId: calendarIds[1] },
      { roomId: nonmemberRoomId, calendarId: 'contract-nonmember' },
    ]) {
      activeCalDavRequests = [];
      const proofCountBefore = serviceOpenIdTokens.length;
      const response = await gatewayEventRequest(
        'POST',
        target,
        undefined,
        input,
      );
      expect([403, 404]).toContain(response.status);
      expect(activeCalDavRequests).toEqual([]);
      expect(serviceOpenIdTokens).toHaveLength(proofCountBefore);
    }
    assertLogsOmitSecrets();
  });

  it('creates, lists, reads, and deletes an event through the room bot commands', async () => {
    markRoomAppServiceCaseStarted('bot-command-write');
    const commandService = app.get(CalendarCommandService);
    const sender = await matrixUserIdForAccessToken(actorAccessToken);
    const start = new Date(Date.now() + 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 16);
    const end = new Date(Date.now() + 25 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 16);
    const title = 'Bot room contract event';
    const createdText = await commandService.execute(
      roomIds[0],
      sender,
      `create ${start} ${end} "${title}" --tz UTC`,
      translateCalendarCommand,
    );
    const resourceIdMatch = createdText.match(
      /^Created event ([A-Za-z0-9._@+-]+\.ics)\.$/,
    );
    expect(resourceIdMatch).not.toBeNull();
    const resourceId = resourceIdMatch?.[1];
    if (!resourceId) throw new Error('Bot command did not create an event');
    expect(activeCalDavRequests?.some(({ method }) => method === 'PUT')).toBe(
      true,
    );

    activeCalDavRequests = [];
    const upcomingText = await commandService.execute(
      roomIds[0],
      sender,
      'upcoming 10 --tz UTC',
      translateCalendarCommand,
    );
    expect(upcomingText).toContain(resourceId);
    expect(upcomingText).toContain(title);
    expect(
      activeCalDavRequests?.some(({ method }) => method === 'REPORT'),
    ).toBe(true);

    activeCalDavRequests = [];
    const eventText = await commandService.execute(
      roomIds[0],
      sender,
      `event ${resourceId} --tz UTC`,
      translateCalendarCommand,
    );
    expect(eventText).toContain(resourceId);
    expect(eventText).toContain(title);
    expect(eventText).not.toContain('BEGIN:VCALENDAR');
    expect(activeCalDavRequests?.some(({ method }) => method === 'GET')).toBe(
      true,
    );

    activeCalDavRequests = [];
    const deletedText = await commandService.execute(
      roomIds[0],
      sender,
      `delete ${resourceId}`,
      translateCalendarCommand,
    );
    expect(deletedText).toBe(`Deleted event ${resourceId}.`);
    expect(
      activeCalDavRequests?.some(
        ({ method, hasIfMatch }) => method === 'DELETE' && hasIfMatch,
      ),
    ).toBe(true);
    expect(
      activeCalDavRequests?.every(({ pathname }) =>
        pathname.startsWith(`/${principalLocalpart()}/contract-room-one/`),
      ),
    ).toBe(true);
    assertLogsOmitSecrets();
  }, 30000);

  it('denies an unauthorized room bot command before proof or CalDAV I/O', async () => {
    markRoomAppServiceCaseStarted('bot-command-denial');
    const commandService = app.get(CalendarCommandService);
    const sender = await matrixUserIdForAccessToken(actorAccessToken);
    activeCalDavRequests = [];
    const proofCountBefore = serviceOpenIdTokens.length;
    const response = await commandService.execute(
      nonmemberRoomId,
      sender,
      'create 2026-10-04T12:00 2026-10-04T13:00 "Must not be written" --tz UTC',
      translateCalendarCommand,
    );
    expect(response).toBe('Not allowed.');
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

  async function gatewayEventRequest(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    target: { roomId: string; calendarId: string },
    eventId?: string,
    body?: unknown,
    ifMatch?: string,
  ): Promise<{ status: number; body: string }> {
    const query = new URLSearchParams({
      target: 'room',
      roomId: target.roomId,
      calendarId: target.calendarId,
    });
    if (eventId) query.set('eventId', eventId);
    const endpoint = method === 'GET' ? 'event' : 'events';
    const headers = {
      Authorization: identityHeader(actorIdentity),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(ifMatch === undefined ? {} : { 'If-Match': ifMatch }),
    };
    return new Promise((resolve, reject) => {
      const request = httpRequest(
        `${gatewayUrl}/v1/calendar/${endpoint}?${query}`,
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
                  `room-appservice-event-http-${method}-${status}\n`,
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

function markRoomAppServiceSetupStart(): void {
  appendRoomAppServiceSetupMarker('room-appservice-setup-start');
}

function markRoomAppServiceSetupStage(stage: RoomAppServiceSetupStage): void {
  appendRoomAppServiceSetupMarker(`room-appservice-setup-stage-${stage}`);
}

function markRoomAppServiceCaseStarted(testCase: RoomAppServiceCase): void {
  appendRoomAppServiceSetupMarker(`room-appservice-case-start-${testCase}`);
}

function markRoomAppServiceCaseStage(
  testCase: RoomAppServiceFailureCase,
  stage: RoomAppServiceCaseFailureStage,
): void {
  appendRoomAppServiceSetupMarker(
    `room-appservice-case-stage-${testCase}-${stage}`,
  );
}

function markRoomAppServiceTeardownStage(
  stage: RoomAppServiceTeardownStage,
): void {
  appendRoomAppServiceSetupMarker(`room-appservice-teardown-stage-${stage}`);
}

function markRoomAppServiceTeardownFailure(
  failure: RoomAppServiceTeardownFailure,
): void {
  appendRoomAppServiceSetupMarker(
    `room-appservice-teardown-failure-${failure}`,
  );
}

function appendRoomAppServiceSetupMarker(marker: string): void {
  const stageFile = process.env.CALDAV_CONTRACT_STAGE_FILE;
  if (process.env.CALDAV_CONTRACT !== '1' || !stageFile) {
    return;
  }

  try {
    appendFileSync(stageFile, `${marker}\n`, 'utf8');
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
  try {
    const token = await obtainMatrixApplicationServiceFixtureUserToken({
      fetchImpl: nativeFetch,
      homeserverUrl,
      applicationServiceToken: serviceToken,
      userId: serviceUserId,
    });
    serviceUserAccessTokens.push(token);
  } catch (error) {
    if (error instanceof MatrixApplicationServiceFixtureError) {
      if (error.status !== undefined) {
        markRoomAppServiceSetupHttpStatus(error.status);
      }
      if (error.matrixErrcode) {
        markRoomAppServiceSetupMatrixErrorCode(error.matrixErrcode);
      }
    }
    throw error;
  }
}

async function registerNormalBotAccount(): Promise<{
  readonly userId: string;
  readonly accessToken: string;
}> {
  const localpart = `room-calendar-bot-${randomUUID().replace(/-/g, '')}`;
  const password = randomBytes(32).toString('base64url');
  try {
    execFileSync(
      'docker',
      [
        'compose',
        '-f',
        resolve(__dirname, '../../../dev/compose.yaml'),
        'exec',
        '-T',
        'synapse',
        'register_new_matrix_user',
        '-c',
        '/data/homeserver.yaml',
        '-u',
        localpart,
        '--password-file',
        '/dev/stdin',
        'http://localhost:8008',
      ],
      { encoding: 'utf8', input: password, timeout: 30_000 },
    );
  } catch {
    throw new Error('Synthetic normal bot account registration failed');
  }

  const login = await matrixJson<{
    user_id?: unknown;
    access_token?: unknown;
  }>('/_matrix/client/v3/login', {
    method: 'POST',
    body: {
      type: 'm.login.password',
      identifier: { type: 'm.id.user', user: localpart },
      password,
    },
  });
  const expectedUserId = `@${localpart}:${matrixServerName}`;
  if (
    login.user_id !== expectedUserId ||
    typeof login.access_token !== 'string' ||
    login.access_token.length === 0
  ) {
    throw new Error('Synthetic normal bot login could not be verified');
  }
  return { userId: expectedUserId, accessToken: login.access_token };
}

function getRoomPrincipalIdentityProvider(): RoomCalendarPrincipalIdentityProvider {
  if (!roomPrincipalIdentityProvider) {
    throw new Error('Room principal identity provider is unavailable');
  }
  return roomPrincipalIdentityProvider;
}

function principalLocalpart(): string {
  return principalUserId.slice(1).split(':')[0];
}

async function createRoom(
  name: string,
  token: string = actorAccessToken,
): Promise<string> {
  const result = await matrixJson<{ room_id: string }>(
    '/_matrix/client/v3/createRoom',
    {
      method: 'POST',
      token,
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

const calendarCommandTranslations: Record<string, string> = {
  'calendarCommandErrors.notAllowed': 'Not allowed.',
  'calendarCommandReplies.descriptionLabel': 'Description',
  'calendarCommandReplies.eventDetails': 'Calendar event:',
  'calendarCommandReplies.idLabel': 'Resource ID',
  'calendarCommandReplies.noUpcoming': 'No upcoming events.',
  'calendarCommandReplies.timeUnavailable': 'Time unavailable',
  'calendarCommandReplies.titleLabel': 'Title',
  'calendarCommandReplies.untitled': '(untitled)',
  'calendarCommandReplies.upcoming': 'Upcoming events:',
  'calendarCommandReplies.upcomingPartial': 'Some events are unavailable.',
  'calendarCommandReplies.whenLabel': 'When',
};

const translateCalendarCommand: CalendarCommandTranslation = (
  key,
  parameters,
) => {
  if (key === 'calendarCommandReplies.eventCreated') {
    return `Created event ${String(parameters?.resourceId)}.`;
  }
  if (key === 'calendarCommandReplies.eventDeleted') {
    return `Deleted event ${String(parameters?.resourceId)}.`;
  }
  return calendarCommandTranslations[key] ?? key;
};

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
  if (!response.ok) {
    markRoomAppServiceSetupHttpStatus(response.status);
    let errorBody: { errcode?: unknown } | undefined;
    try {
      errorBody = (await response.clone().json()) as {
        errcode?: unknown;
      };
    } catch {
      // Error-body parsing must not change the fixture request failure.
    }
    if (
      typeof errorBody?.errcode === 'string' &&
      matrixErrorCodes.has(errorBody.errcode)
    ) {
      markRoomAppServiceSetupMatrixErrorCode(errorBody.errcode);
    }
    throw new Error(
      `Matrix contract fixture request failed (${response.status})`,
    );
  }
  return (await response.json()) as T;
}

function markRoomAppServiceSetupHttpStatus(status: number): void {
  if (Number.isInteger(status) && status >= 400 && status <= 599) {
    appendRoomAppServiceSetupMarker(`room-appservice-http-status-${status}`);
  }
}

function markRoomAppServiceSetupMatrixErrorCode(code: string): void {
  if (matrixErrorCodes.has(code)) {
    appendRoomAppServiceSetupMarker(`room-appservice-matrix-error-${code}`);
  }
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
  const serviceLocalpart = principalLocalpart();
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
