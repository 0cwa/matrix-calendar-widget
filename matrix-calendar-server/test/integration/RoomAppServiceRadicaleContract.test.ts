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
  ForbiddenException,
  INestApplication,
  INestMicroservice,
  LoggerService,
  Module,
  Type,
  VersioningType,
} from '@nestjs/common';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { MicroserviceOptions } from '@nestjs/microservices';
import { NextFunction, Request, Response } from 'express';
import fetchMock from 'jest-fetch-mock';
import { MatrixClient, type PowerLevelsEventContent } from 'matrix-bot-sdk';
import { getRequestFn, setRequestFn } from 'matrix-bot-sdk/lib/request';
import { PinoLogger } from 'nestjs-pino';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { default as pino } from 'pino';
import postgres from 'postgres';
import { AppRuntimeContext } from '../../src/AppRuntimeContext';
import { CalDavEventClient } from '../../src/caldav/CalDavEventClient';
import { MatrixOpenIdCalDavCredentialProviderFactory } from '../../src/caldav/MatrixOpenIdCalDavCredentialProviderFactory';
import { MeetingClient } from '../../src/client/MeetingClient';
import { ReactionClient } from '../../src/client/ReactionClient';
import { WidgetClient } from '../../src/client/WidgetClient';
import { CalendarGatewayController } from '../../src/controller/CalendarGatewayController';
import { CommandController } from '../../src/controller/CommandController';
import { EventContentRenderer } from '../../src/EventContentRenderer';
import { MatrixAuthGuard } from '../../src/guard/MatrixAuthGuard';
import { MatrixRoomMembershipGuard } from '../../src/guard/MatrixRoomMembershipGuard';
import { IAppConfiguration } from '../../src/IAppConfiguration';
import { AutojoinRoomsMixin } from '../../src/matrix/mixins/AutojoinRoomsMixin';
import { MatrixAuthMiddleware } from '../../src/middleware/MatrixAuthMiddleware';
import type {
  PrivateCalendarClientRecord,
  PrivateCalendarClientStore,
} from '../../src/model/IPrivateCalendarClientStore';
import type { RoomCalendarBindingRecord } from '../../src/model/IRoomCalendarBindingStore';
import { StateEventName } from '../../src/model/StateEventName';
import { WidgetType } from '../../src/model/WidgetType';
import { ModuleProviderToken } from '../../src/ModuleProviderToken';
import type { PostgresDatabaseTlsMode } from '../../src/reminder/ReminderDatabaseConnection';
import { getPostgresDatabaseTlsOptions } from '../../src/reminder/ReminderDatabaseConnection';
import { MatrixServer } from '../../src/rpc/MatrixServer';
import {
  CalendarCommandService,
  CalendarCommandTranslation,
} from '../../src/service/CalendarCommandService';
import { CommandService } from '../../src/service/CommandService';
import { ConfiguredRoomCalendarPrincipalIdentityProvider } from '../../src/service/ConfiguredRoomCalendarPrincipalIdentityProvider';
import { DisabledRoomCalendarBindingStore } from '../../src/service/DisabledRoomCalendarBindingStore';
import type { RoomCalendarBindingRegistry } from '../../src/service/IRoomCalendarBindingRegistry';
import {
  MATRIX_CALENDAR_MANAGE_POLICY,
  MatrixCalendarAuthorizationFactory,
} from '../../src/service/MatrixCalendarAuthorization';
import { PostgresRoomCalendarBindingStore } from '../../src/service/PostgresRoomCalendarBindingStore';
import { privateCalendarClientSecretVerifier } from '../../src/service/private-client/PrivateCalendarClientCredentials';
import { PrivateCalendarClientPolicy } from '../../src/service/private-client/PrivateCalendarClientPolicy';
import { PrivateCalendarClientService } from '../../src/service/private-client/PrivateCalendarClientService';
import { RoomCalendarBindingRegistryAdapter } from '../../src/service/RoomCalendarBindingRegistryAdapter';
import { RoomCalendarBindingError } from '../../src/service/RoomCalendarBindingResolver';
import { RoomCalendarCalDavAccess } from '../../src/service/RoomCalendarCalDavAccess';
import { RoomCalendarEventOperations } from '../../src/service/RoomCalendarEventOperations';
import type { RoomCalendarPrincipalIdentityProvider } from '../../src/service/RoomCalendarPrincipalIdentity';
import { MatrixRoomCalendarPrincipalOpenIdProofProvider } from '../../src/service/RoomCalendarPrincipalOpenIdProofProvider';
import { RoomCalendarSetupCalDavProvisioner } from '../../src/service/RoomCalendarSetupCalDavProvisioner';
import { MatrixRoomCalendarSetupService } from '../../src/service/RoomCalendarSetupService';
import { RoomCalendarSetupWidgetInstaller } from '../../src/service/RoomCalendarSetupWidgetInstaller';
import { RoomMessageService } from '../../src/service/RoomMessageService';
import { WelcomeWorkflowService } from '../../src/service/WelcomeWorkflowService';
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
let normalBotClient: MatrixClient | undefined;
let normalBotUserId = '';
const bindingDatabaseUrl = process.env.MATRIX_CALENDAR_BINDING_DATABASE_URL;

function bindingDatabaseTlsMode(
  value: string | undefined,
): PostgresDatabaseTlsMode {
  if (value === undefined || value === 'verify-full') return 'verify-full';
  if (value === 'trusted-private-network') return value;
  throw new Error(
    'MATRIX_CALENDAR_BINDING_DATABASE_TLS_MODE must be verify-full or trusted-private-network',
  );
}

function bindingRecordsSnapshot(
  records: readonly RoomCalendarBindingRecord[],
): Array<{
  roomId: string;
  calendarId: string;
  status: string;
  createdBy: string;
  createdAt: string;
  readyAt: string | null;
}> {
  return records
    .map((record) => ({
      roomId: record.roomId,
      calendarId: record.calendarId,
      status: record.status,
      createdBy: record.createdBy,
      createdAt: record.createdAt.toISOString(),
      readyAt: record.readyAt?.toISOString() ?? null,
    }))
    .sort((left, right) => left.roomId.localeCompare(right.roomId));
}

function widgetIdentitySnapshot(
  state: readonly unknown[],
): Array<[stateKey: string, sender: string | null, contentId: string | null]> {
  return state
    .filter(
      (event): event is Record<string, unknown> =>
        typeof event === 'object' && event !== null,
    )
    .filter(
      (event) => event.type === StateEventName.IM_VECTOR_MODULAR_WIDGETS_EVENT,
    )
    .map((event): [string, string | null, string | null] => {
      const content =
        typeof event.content === 'object' && event.content !== null
          ? (event.content as Record<string, unknown>)
          : {};
      return [
        typeof event.state_key === 'string' ? event.state_key : '',
        typeof event.sender === 'string' ? event.sender : null,
        typeof content.id === 'string' ? content.id : null,
      ];
    })
    .sort((left, right) =>
      `${left[0]}\u0000${left[1] ?? ''}\u0000${left[2] ?? ''}`.localeCompare(
        `${right[0]}\u0000${right[1] ?? ''}\u0000${right[2] ?? ''}`,
      ),
    );
}

function createBindingTestPostgresClient(): ReturnType<typeof postgres> {
  if (!bindingDatabaseUrl) {
    throw new Error('The isolated binding database URL is missing');
  }
  const options = {
    ...getPostgresDatabaseTlsOptions(
      bindingDatabaseTlsMode(
        process.env.MATRIX_CALENDAR_BINDING_DATABASE_TLS_MODE,
      ),
      bindingDatabaseUrl,
    ),
    max: 3,
    connect_timeout: 5,
  } as unknown as Parameters<typeof postgres>[1];
  return postgres(bindingDatabaseUrl, options);
}

async function requireIsolatedBindingTestDatabase(
  sql: ReturnType<typeof postgres>,
): Promise<void> {
  const [database] = await sql<
    {
      name: string;
      role: string;
      owner: string;
      is_superuser: boolean;
      can_create_database: boolean;
      can_create_role: boolean;
      can_connect_current_database: boolean;
      can_connect_postgres: boolean;
      can_connect_template1: boolean;
    }[]
  >`
    SELECT current_database() AS name,
           current_user AS role,
           pg_get_userbyid(database.datdba) AS owner,
           current_role_row.rolsuper AS is_superuser,
           current_role_row.rolcreatedb AS can_create_database,
           current_role_row.rolcreaterole AS can_create_role,
           has_database_privilege(current_user, current_database(), 'CONNECT') AS can_connect_current_database,
           has_database_privilege(current_user, 'postgres', 'CONNECT') AS can_connect_postgres,
           has_database_privilege(current_user, 'template1', 'CONNECT') AS can_connect_template1
    FROM pg_database AS database
    JOIN pg_roles AS current_role_row
      ON current_role_row.rolname = current_user
    WHERE database.datname = current_database()
  `;
  if (database.name !== 'matrix_calendar_binding_test') {
    throw new Error(
      'The room setup contract requires the isolated matrix_calendar_binding_test database',
    );
  }
  if (
    database.owner !== database.role ||
    database.is_superuser ||
    database.can_create_database ||
    database.can_create_role ||
    !database.can_connect_current_database ||
    database.can_connect_postgres ||
    database.can_connect_template1
  ) {
    throw new Error(
      'The room setup contract requires a database-owning role without elevated PostgreSQL privileges',
    );
  }
}

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
  readonly bodyIsEmptyObject: boolean;
}> = [];
const gatewayLogLines: string[] = [];

function createPrivatePolicyRecord(input: {
  readonly createdBy: string;
  readonly roomId: string;
  readonly calendarId: string;
  readonly canonicalPath: string;
  readonly epochKey: Buffer;
}): { readonly record: PrivateCalendarClientRecord; readonly secret: string } {
  const appId = `mcwpc~${randomBytes(24).toString('hex')}`;
  const secret = randomBytes(32).toString('base64url');
  const createdAt = new Date();
  return {
    secret,
    record: {
      appId,
      createdBy: input.createdBy,
      target: {
        target: 'room',
        roomId: input.roomId,
        calendarId: input.calendarId,
      },
      canonicalPath: input.canonicalPath,
      secretVerifier: privateCalendarClientSecretVerifier(appId, secret),
      credentialEpochHash: createHash('sha256')
        .update(input.epochKey)
        .digest('hex'),
      state: 'active',
      mapState: 'present',
      createdAt,
      expiresAt: new Date(createdAt.getTime() + 60 * 60 * 1000),
    },
  };
}

function createPrivatePolicyStore(
  initialRecords: readonly PrivateCalendarClientRecord[],
): {
  readonly store: PrivateCalendarClientStore;
  readonly get: (appId: string) => PrivateCalendarClientRecord | undefined;
  readonly revocationCount: () => number;
} {
  const records = new Map(
    initialRecords.map((record) => [record.appId, record]),
  );
  let revocations = 0;
  const unexpectedOperation = async (): Promise<never> => {
    throw new Error('Unexpected private-client store operation');
  };
  const store = {
    enabled: true,
    createPending: unexpectedOperation,
    async getByAppId(appId: string) {
      return records.get(appId);
    },
    async listForTarget() {
      return [];
    },
    beginBootstrap: unexpectedOperation,
    activate: unexpectedOperation,
    async revoke(appId: string, now: Date) {
      const record = records.get(appId);
      if (!record) return undefined;
      revocations += 1;
      const revoked: PrivateCalendarClientRecord = {
        ...record,
        state: 'revoked',
        mapState: 'cleanup-pending',
        secretVerifier: undefined,
        revokedAt: now,
      };
      records.set(appId, revoked);
      return revoked;
    },
    markMapRemoved: unexpectedOperation,
  } as unknown as PrivateCalendarClientStore;

  return {
    store,
    get: (appId) => records.get(appId),
    revocationCount: () => revocations,
  };
}

describe('normal bot account registration command', () => {
  it('chooses non-admin for non-interactive Synapse registration', () => {
    const args = buildNormalBotAccountRegistrationArgs('synthetic-bot');

    expect(args).toContain('--no-admin');
    expect(args).not.toContain('-a');
    expect(args).toContain('--password-file');
  });
});

type MatrixSdkErrorClass =
  | 'none'
  | 'error'
  | 'matrix-error'
  | 'type-error'
  | 'other';
type MatrixSdkRequestMethod = 'unobserved' | 'get' | 'other';
type MatrixSdkResponseShape =
  | 'unobserved'
  | 'missing'
  | 'object'
  | 'invalid-json'
  | 'other';
type MatrixSdkResponseUserId = 'unobserved' | 'string' | 'missing' | 'other';
type MatrixSdkWhoAmIOutcome =
  | 'api-unavailable'
  | 'matched'
  | 'mismatched'
  | 'missing-user-id'
  | 'rejected';

interface MatrixSdkWhoAmIObservation {
  readonly getUserIdAvailable: boolean;
  readonly getWhoAmIAvailable: boolean;
  readonly requestSeen: boolean;
  readonly requestMethod: MatrixSdkRequestMethod;
  readonly authorizationPresent: boolean | undefined;
  readonly responseStatus: number | undefined;
  readonly responseShape: MatrixSdkResponseShape;
  readonly responseUserId: MatrixSdkResponseUserId;
  readonly transportError: MatrixSdkErrorClass;
  readonly sdkError: MatrixSdkErrorClass;
  readonly identityMatches: boolean | undefined;
  readonly outcome: MatrixSdkWhoAmIOutcome;
}

interface MatrixSdkWhoAmIResult {
  readonly userId: unknown;
  readonly error: unknown;
  readonly observation: MatrixSdkWhoAmIObservation;
}

interface MatrixSdkRequestResponse {
  readonly statusCode?: unknown;
  readonly body?: unknown;
}

type MatrixSdkRequestCallback = (
  error: unknown,
  response?: MatrixSdkRequestResponse,
  body?: unknown,
) => void;

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function classifyMatrixSdkError(error: unknown): MatrixSdkErrorClass {
  if (error === undefined || error === null) return 'none';
  if (!isObjectRecord(error) || typeof error.name !== 'string') return 'other';
  if (error.name === 'TypeError') return 'type-error';
  if (error.name === 'MatrixError') return 'matrix-error';
  if (error.name === 'Error') return 'error';
  return 'other';
}

function readMatrixSdkResponse(
  body: unknown,
  response: MatrixSdkRequestResponse | undefined,
): Pick<MatrixSdkWhoAmIObservation, 'responseShape' | 'responseUserId'> {
  const raw = body === undefined ? response?.body : body;
  if (raw === undefined || raw === null) {
    return { responseShape: 'missing', responseUserId: 'unobserved' };
  }

  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      return { responseShape: 'invalid-json', responseUserId: 'unobserved' };
    }
  }
  if (!isObjectRecord(value)) {
    return { responseShape: 'other', responseUserId: 'unobserved' };
  }

  const responseUserId = value.user_id;
  return {
    responseShape: 'object',
    responseUserId:
      typeof responseUserId === 'string'
        ? 'string'
        : responseUserId === undefined
          ? 'missing'
          : 'other',
  };
}

function formatMatrixSdkWhoAmIObservation(
  accountRegistrationAndLoginVerified: boolean,
  observation: MatrixSdkWhoAmIObservation,
): string {
  const authorizationPresent =
    observation.authorizationPresent === undefined
      ? 'unavailable'
      : String(observation.authorizationPresent);
  const responseStatus =
    observation.responseStatus === undefined
      ? 'unavailable'
      : String(observation.responseStatus);
  const identityMatches =
    observation.identityMatches === undefined
      ? 'unavailable'
      : String(observation.identityMatches);

  return [
    'room-appservice-sdk-whoami',
    `account_verified=${accountRegistrationAndLoginVerified}`,
    `get_user_id_available=${observation.getUserIdAvailable}`,
    `get_who_am_i_available=${observation.getWhoAmIAvailable}`,
    `request_seen=${observation.requestSeen}`,
    `request_method=${observation.requestMethod}`,
    `authorization_present=${authorizationPresent}`,
    `response_status=${responseStatus}`,
    `response_shape=${observation.responseShape}`,
    `response_user_id=${observation.responseUserId}`,
    `transport_error=${observation.transportError}`,
    `sdk_error=${observation.sdkError}`,
    `identity_match=${identityMatches}`,
    `outcome=${observation.outcome}`,
  ].join(' ');
}

async function inspectMatrixSdkWhoAmI(
  client: MatrixClient,
  expectedUserId: string,
): Promise<MatrixSdkWhoAmIResult> {
  const getUserIdAvailable = typeof client.getUserId === 'function';
  const getWhoAmIAvailable = typeof client.getWhoAmI === 'function';
  const observation: {
    getUserIdAvailable: boolean;
    getWhoAmIAvailable: boolean;
    requestSeen: boolean;
    requestMethod: MatrixSdkRequestMethod;
    authorizationPresent: boolean | undefined;
    responseStatus: number | undefined;
    responseShape: MatrixSdkResponseShape;
    responseUserId: MatrixSdkResponseUserId;
    transportError: MatrixSdkErrorClass;
    sdkError: MatrixSdkErrorClass;
    identityMatches: boolean | undefined;
    outcome: MatrixSdkWhoAmIOutcome;
  } = {
    getUserIdAvailable,
    getWhoAmIAvailable,
    requestSeen: false,
    requestMethod: 'unobserved',
    authorizationPresent: undefined,
    responseStatus: undefined,
    responseShape: 'unobserved',
    responseUserId: 'unobserved',
    transportError: 'none',
    sdkError: 'none',
    identityMatches: undefined,
    outcome: 'api-unavailable',
  };

  if (!getUserIdAvailable || !getWhoAmIAvailable) {
    return { userId: undefined, error: undefined, observation };
  }

  const originalRequestFn = getRequestFn();
  const whoAmIPath = '/_matrix/client/v3/account/whoami';
  setRequestFn(
    (requestOptions: unknown, callback: MatrixSdkRequestCallback) => {
      const options = isObjectRecord(requestOptions) ? requestOptions : {};
      let pathname = '';
      try {
        pathname = new URL(String(options.uri)).pathname;
      } catch {
        return originalRequestFn(requestOptions, callback);
      }
      if (pathname !== whoAmIPath) {
        return originalRequestFn(requestOptions, callback);
      }

      observation.requestSeen = true;
      observation.requestMethod =
        typeof options.method === 'string' &&
        options.method.toUpperCase() === 'GET'
          ? 'get'
          : 'other';
      const headers = isObjectRecord(options.headers) ? options.headers : {};
      const authorization = headers.Authorization ?? headers.authorization;
      observation.authorizationPresent =
        typeof authorization === 'string' &&
        authorization.startsWith('Bearer ');

      return originalRequestFn(
        requestOptions,
        (
          error: unknown,
          response: MatrixSdkRequestResponse | undefined,
          body: unknown,
        ) => {
          observation.transportError = classifyMatrixSdkError(error);
          const statusCode = response?.statusCode;
          if (
            typeof statusCode === 'number' &&
            Number.isInteger(statusCode) &&
            statusCode >= 100 &&
            statusCode <= 599
          ) {
            observation.responseStatus = statusCode;
          }
          Object.assign(observation, readMatrixSdkResponse(body, response));
          callback(error, response, body);
        },
      );
    },
  );

  try {
    const userId: unknown = await client.getUserId();
    observation.identityMatches = userId === expectedUserId;
    if (typeof userId !== 'string') {
      observation.outcome = 'missing-user-id';
    } else {
      observation.outcome = observation.identityMatches
        ? 'matched'
        : 'mismatched';
    }
    return { userId, error: undefined, observation };
  } catch (error) {
    observation.sdkError = classifyMatrixSdkError(error);
    observation.outcome = 'rejected';
    return { userId: undefined, error, observation };
  } finally {
    setRequestFn(originalRequestFn);
  }
}

async function withMatrixSdkRequest(
  requestFn: (
    requestOptions: unknown,
    callback: MatrixSdkRequestCallback,
  ) => unknown,
  action: () => Promise<void>,
): Promise<void> {
  const originalRequestFn = getRequestFn();
  setRequestFn(requestFn);
  try {
    await action();
  } finally {
    setRequestFn(originalRequestFn);
  }
}

describe('Matrix SDK whoami diagnostic probe', () => {
  const expectedUserId = '@synthetic-room-calendar:localhost';
  const syntheticToken = 'synthetic-room-calendar-token-sentinel';

  it('uses the SDK default request transport in the Jest contract environment', async () => {
    const originalRequestFn = getRequestFn();
    expect(typeof originalRequestFn).toBe('function');

    const requests: Array<{
      readonly method: string;
      readonly whoAmIPath: boolean;
      readonly authorizationPresent: boolean;
    }> = [];
    const server = createServer((request, response) => {
      const authorization = request.headers.authorization;
      requests.push({
        method: request.method ?? '',
        whoAmIPath: request.url === '/_matrix/client/v3/account/whoami',
        authorizationPresent:
          typeof authorization === 'string' &&
          authorization.startsWith('Bearer '),
      });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ user_id: expectedUserId }));
    });

    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      const address = server.address() as AddressInfo;
      const result = await inspectMatrixSdkWhoAmI(
        new MatrixClient(`http://127.0.0.1:${address.port}`, syntheticToken),
        expectedUserId,
      );

      expect(result.userId).toBe(expectedUserId);
      expect(result.error).toBeUndefined();
      expect(result.observation).toMatchObject({
        requestSeen: true,
        requestMethod: 'get',
        authorizationPresent: true,
        responseStatus: 200,
        responseShape: 'object',
        responseUserId: 'string',
        identityMatches: true,
        outcome: 'matched',
      });
      expect(requests).toEqual([
        {
          method: 'GET',
          whoAmIPath: true,
          authorizationPresent: true,
        },
      ]);
      expect(getRequestFn()).toBe(originalRequestFn);
    } finally {
      server.closeAllConnections();
      if (server.listening) {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        });
      }
    }
  }, 10000);

  it('uses the installed SDK GET whoami request and verifies its identity', async () => {
    await withMatrixSdkRequest(
      (_requestOptions, callback) => {
        const body = { user_id: expectedUserId };
        callback(null, { statusCode: 200, body }, body);
      },
      async () => {
        const result = await inspectMatrixSdkWhoAmI(
          new MatrixClient('http://localhost:8008', syntheticToken),
          expectedUserId,
        );
        const safeProbe = formatMatrixSdkWhoAmIObservation(
          true,
          result.observation,
        );

        expect(result.userId).toBe(expectedUserId);
        expect(result.error).toBeUndefined();
        expect(result.observation).toMatchObject({
          getUserIdAvailable: true,
          getWhoAmIAvailable: true,
          requestSeen: true,
          requestMethod: 'get',
          authorizationPresent: true,
          responseStatus: 200,
          responseShape: 'object',
          responseUserId: 'string',
          transportError: 'none',
          sdkError: 'none',
          identityMatches: true,
          outcome: 'matched',
        });
        expect(safeProbe).not.toContain(expectedUserId);
        expect(safeProbe).not.toContain(syntheticToken);
      },
    );
  });

  it('classifies a transport TypeError without retaining its message', async () => {
    const originalRequestFn = getRequestFn();
    const sdkLogMessages: string[] = [];
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation((...args) => {
        sdkLogMessages.push(args.map(String).join(' '));
      });
    let safeProbe = '';
    try {
      await withMatrixSdkRequest(
        (_requestOptions, callback) => {
          callback(new TypeError('synthetic transport failure'));
        },
        async () => {
          const result = await inspectMatrixSdkWhoAmI(
            new MatrixClient('http://localhost:8008', syntheticToken),
            expectedUserId,
          );
          safeProbe = formatMatrixSdkWhoAmIObservation(
            true,
            result.observation,
          );

          expect(result.error).toBeInstanceOf(TypeError);
          expect(result.observation).toMatchObject({
            requestSeen: true,
            authorizationPresent: true,
            responseStatus: undefined,
            responseShape: 'missing',
            transportError: 'type-error',
            sdkError: 'type-error',
            outcome: 'rejected',
          });
          expect(safeProbe).not.toContain('synthetic transport failure');
          expect(safeProbe).not.toContain(syntheticToken);
        },
      );
    } finally {
      consoleError.mockRestore();
    }

    expect(getRequestFn()).toBe(originalRequestFn);
    const sdkLog = sdkLogMessages.join('\n');
    expect(sdkLog).toContain('TypeError');
    expect(sdkLog).not.toContain(syntheticToken);
    expect(sdkLog).not.toContain(expectedUserId);
  });

  it('distinguishes a whoami response with no user_id', async () => {
    await withMatrixSdkRequest(
      (_requestOptions, callback) => {
        const body = {};
        callback(null, { statusCode: 200, body }, body);
      },
      async () => {
        const result = await inspectMatrixSdkWhoAmI(
          new MatrixClient('http://localhost:8008', syntheticToken),
          expectedUserId,
        );

        expect(result.userId).toBeUndefined();
        expect(result.observation).toMatchObject({
          requestSeen: true,
          responseStatus: 200,
          responseShape: 'object',
          responseUserId: 'missing',
          identityMatches: false,
          outcome: 'missing-user-id',
        });
      },
    );
  });

  it('distinguishes a valid but mismatched whoami identity without exposing either ID', async () => {
    const otherUserId = '@synthetic-other:localhost';
    await withMatrixSdkRequest(
      (_requestOptions, callback) => {
        const body = { user_id: otherUserId };
        callback(null, { statusCode: 200, body }, body);
      },
      async () => {
        const result = await inspectMatrixSdkWhoAmI(
          new MatrixClient('http://localhost:8008', syntheticToken),
          expectedUserId,
        );
        const safeProbe = formatMatrixSdkWhoAmIObservation(
          true,
          result.observation,
        );

        expect(result.userId).toBe(otherUserId);
        expect(result.observation).toMatchObject({
          requestSeen: true,
          responseStatus: 200,
          responseShape: 'object',
          responseUserId: 'string',
          identityMatches: false,
          outcome: 'mismatched',
        });
        expect(safeProbe).not.toContain(expectedUserId);
        expect(safeProbe).not.toContain(otherUserId);
        expect(safeProbe).not.toContain(syntheticToken);
      },
    );
  });
});
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
  | 'bot-command-denial'
  | 'private-client-live-policy';
type RoomAppServiceFailureCase =
  | 'subject-binding'
  | 'cross-room-denial'
  | 'private-client-live-policy';
type RoomAppServiceCaseFailureStage =
  | 'identities'
  | 'room-setup'
  | 'baseline'
  | 'credential-rw'
  | 'issuance-denials'
  | 'unknown-membership'
  | 'demotion'
  | 'leave'
  | 'rejoin'
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
type PrivatePolicyCleanupOperation =
  | 'restore-power-levels'
  | 'lookup-members'
  | 'leave-issuer'
  | 'leave-reader';
type PrivatePolicyCleanupFailure = PrivatePolicyCleanupOperation;
type PrivatePolicyBodyResult = 'completed' | 'failed';
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
      useValue: (
        input: Parameters<typeof globalThis.fetch>[0],
        init?: Parameters<typeof globalThis.fetch>[1],
      ) => globalThis.fetch(input, init),
    },
    {
      provide: ModuleProviderToken.ROOM_CALENDAR_PRINCIPAL_IDENTITY,
      useFactory: getRoomPrincipalIdentityProvider,
    },
    {
      provide:
        ModuleProviderToken.ROOM_CALENDAR_PRINCIPAL_OPENID_PROOF_PROVIDER,
      useFactory: () =>
        new MatrixRoomCalendarPrincipalOpenIdProofProvider(
          testConfiguration,
          getRoomPrincipalIdentityProvider(),
          (input, init) => globalThis.fetch(input, init),
        ),
    },
    {
      provide: ModuleProviderToken.ROOM_CALENDAR_BINDING_REGISTRY,
      useFactory: () =>
        new RoomCalendarBindingRegistryAdapter(
          testConfiguration.room_calendar_bindings,
          new DisabledRoomCalendarBindingStore(),
        ),
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
      useFactory: (bindingRegistry: RoomCalendarBindingRegistry) =>
        new RoomCalendarEventOperations((input, init) => fetch(input, init), {
          eventWritesEnabled: true,
          maxResponseBytes: testConfiguration.caldav_max_event_response_bytes,
          radicaleBaseUrl,
          bindingRegistry,
          principalIdentityProvider: getRoomPrincipalIdentityProvider(),
        }),
      inject: [ModuleProviderToken.ROOM_CALENDAR_BINDING_REGISTRY],
    },
    {
      provide: CalendarCommandService,
      useFactory: (
        appConfig: IAppConfiguration,
        authorizationFactory: MatrixCalendarAuthorizationFactory,
        access: RoomCalendarCalDavAccess,
        operations: RoomCalendarEventOperations,
        bindingRegistry: RoomCalendarBindingRegistry,
      ) =>
        new CalendarCommandService(
          appConfig,
          authorizationFactory,
          access,
          operations,
          bindingRegistry,
        ),
      inject: [
        ModuleProviderToken.APP_CONFIGURATION,
        MatrixCalendarAuthorizationFactory,
        ModuleProviderToken.ROOM_CALENDAR_CALDAV_ACCESS,
        RoomCalendarEventOperations,
        ModuleProviderToken.ROOM_CALENDAR_BINDING_REGISTRY,
      ],
    },
    MatrixAuthMiddleware,
    MatrixAuthGuard,
    MatrixRoomMembershipGuard,
  ],
})
class RoomAppServiceGatewayContractModule {}

function createCommandAcceptanceModule(
  commandService: CommandService,
  matrixServer: MatrixServer,
  appConfiguration: IAppConfiguration,
  matrixClient: MatrixClient,
  roomMessageService: RoomMessageService,
  reactionClient: ReactionClient,
): Type<unknown> {
  class RoomCommandAcceptanceModule {}
  Module({
    controllers: [CommandController],
    providers: [
      { provide: CommandService, useValue: commandService },
      { provide: MatrixServer, useValue: matrixServer },
      {
        provide: ModuleProviderToken.APP_CONFIGURATION,
        useValue: appConfiguration,
      },
      {
        provide: HttpAdapterHost,
        useValue: { httpAdapter: { getHttpServer: () => ({}) } },
      },
      { provide: MatrixClient, useValue: matrixClient },
      { provide: RoomMessageService, useValue: roomMessageService },
      { provide: ReactionClient, useValue: reactionClient },
    ],
  })(RoomCommandAcceptanceModule);
  return RoomCommandAcceptanceModule;
}

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
      normalBotClient = principalClient;
      normalBotUserId = principal.userId;
      const sdkIdentity = await inspectMatrixSdkWhoAmI(
        principalClient,
        principalUserId,
      );
      appendRoomAppServiceSetupMarker(
        formatMatrixSdkWhoAmIObservation(true, sdkIdentity.observation),
      );
      if (sdkIdentity.observation.outcome === 'api-unavailable') {
        throw new Error('Matrix SDK whoami API is unavailable');
      }
      if (sdkIdentity.error !== undefined) {
        throw sdkIdentity.error;
      }
      if (sdkIdentity.observation.outcome !== 'matched') {
        throw new Error(
          'Synthetic bot token identity did not match its account',
        );
      }
      const sdkUserId = sdkIdentity.userId as string;
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

    const registry = new RoomCalendarBindingRegistryAdapter(
      testConfiguration.room_calendar_bindings,
      new DisabledRoomCalendarBindingStore(),
    );
    const proofProvider = new MatrixRoomCalendarPrincipalOpenIdProofProvider(
      testConfiguration,
      getRoomPrincipalIdentityProvider(),
      nativeFetch,
    );
    const access = new RoomCalendarCalDavAccess(
      testConfiguration,
      registry,
      proofProvider,
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
        let bodyIsEmptyObject = false;
        if (typeof init?.body === 'string') {
          try {
            const body: unknown = JSON.parse(init.body);
            bodyHasUserId =
              typeof body === 'object' &&
              body !== null &&
              Object.prototype.hasOwnProperty.call(body, 'user_id');
            bodyIsEmptyObject =
              typeof body === 'object' &&
              body !== null &&
              !Array.isArray(body) &&
              Object.keys(body).length === 0;
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
          bodyIsEmptyObject,
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

  it('sets up a moderator room with durable binding, widget, and dynamic event access', async () => {
    if (roomPrincipalMode !== 'bot-account') return;
    if (!bindingDatabaseUrl || !normalBotClient || !normalBotUserId) {
      throw new Error('Normal bot setup acceptance fixture is incomplete');
    }
    // Let MatrixServer.stop() drain the test client's in-flight sync promptly.
    normalBotClient.syncingTimeout = 250;

    const setupConfiguration = {
      ...testConfiguration,
      room_calendar_setup_enabled: true,
      room_calendar_setup_allowed_actor_server_names: [matrixServerName],
      meetingwidget_url:
        'https://widget.example.test/calendar#/?meetings_bot_base_url=https://api.example.test/v1&theme=dark',
      meetingwidget_name: 'Calendar',
      welcome_workflow_default_locale: 'en',
    } as IAppConfiguration;
    const sql = createBindingTestPostgresClient();
    let freshSql: ReturnType<typeof postgres> | undefined;
    try {
      await requireIsolatedBindingTestDatabase(sql);
      const bindingStore = new PostgresRoomCalendarBindingStore(sql);
      await bindingStore.migrate();
      const registry = new RoomCalendarBindingRegistryAdapter([], bindingStore);
      const authorization = new MatrixCalendarAuthorizationFactory(
        normalBotClient,
      );
      const proofProvider = new MatrixRoomCalendarPrincipalOpenIdProofProvider(
        setupConfiguration,
        getRoomPrincipalIdentityProvider(),
        globalThis.fetch,
      );
      const renderer = new EventContentRenderer(setupConfiguration);
      const widgetClient = new WidgetClient(
        normalBotClient,
        setupConfiguration,
        renderer,
        {
          stateEvents: [],
          roomEvents: [],
          widgetContents: [],
          allWidgetIds: [],
          defaultWidgetIds: [],
        },
      );
      const widgetInstaller = new RoomCalendarSetupWidgetInstaller(
        normalBotClient,
        widgetClient,
        setupConfiguration.meetingwidget_url,
      );
      const setupService = new MatrixRoomCalendarSetupService(
        {
          enabled: true,
          staticBindings: [],
          allowedActorServerNames: [matrixServerName],
        },
        authorization,
        normalBotClient,
        normalBotUserId,
        registry,
        bindingStore,
        new RoomCalendarSetupCalDavProvisioner(
          radicaleBaseUrl,
          proofProvider,
          globalThis.fetch,
        ),
        widgetInstaller,
      );
      const actorUserId = await matrixUserIdForAccessToken(actorAccessToken);

      const runtimeContext = new AppRuntimeContext(
        normalBotUserId,
        normalBotUserId.slice(1).split(':')[0],
        normalBotUserId.slice(1).split(':')[0],
        ['en'],
      );
      const commandService = new CommandService(
        normalBotClient,
        {} as WelcomeWorkflowService,
        setupConfiguration,
        runtimeContext,
        app.get(CalendarCommandService),
        setupService,
      );
      const reactionClient = new ReactionClient(normalBotClient);
      const roomMessageService = new RoomMessageService(
        normalBotClient,
        new MeetingClient(normalBotClient, renderer),
      );
      const matrixServer = new MatrixServer(
        runtimeContext,
        normalBotClient,
        reactionClient,
        roomMessageService,
        {
          ...setupConfiguration,
          matrix_filter_apply: false,
          matrix_server_event_max_age_minutes: 10,
        } as IAppConfiguration,
      );
      const previousPinoRoot = PinoLogger.root;
      // @ts-expect-error: MatrixServer expects the root configured by LoggerModule.
      PinoLogger.root = pino();
      AutojoinRoomsMixin.setupOnClient(normalBotClient);
      let commandMicroservice: INestMicroservice | undefined;
      try {
        commandMicroservice =
          await NestFactory.createMicroservice<MicroserviceOptions>(
            createCommandAcceptanceModule(
              commandService,
              matrixServer,
              setupConfiguration,
              normalBotClient,
              roomMessageService,
              reactionClient,
            ),
            { strategy: matrixServer, logger: false, abortOnError: false },
          );
        await commandMicroservice.listen();
        const roomId = await createRoom(
          'Moderator room setup acceptance',
          actorAccessToken,
        );
        await expect(registry.resolve(roomId)).rejects.toMatchObject({
          name: RoomCalendarBindingError.name,
          code: 'missing_binding',
        });
        const bindingsBeforeSetup = await bindingStore.listAll();
        const unrelatedBindingsBeforeSetup = bindingRecordsSnapshot(
          bindingsBeforeSetup.filter((record) => record.roomId !== roomId),
        );
        expect(
          bindingsBeforeSetup.filter((record) => record.roomId === roomId),
        ).toHaveLength(0);
        const encryptionStateResponse = await nativeFetch(
          new URL(
            `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/m.room.encryption/`,
            homeserverUrl,
          ),
          { headers: { Authorization: `Bearer ${actorAccessToken}` } },
        );
        expect(encryptionStateResponse.status).toBe(404);
        expect(
          ((await encryptionStateResponse.json()) as { errcode?: string })
            .errcode,
        ).toBe('M_NOT_FOUND');
        await matrixJson(
          `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/invite`,
          {
            method: 'POST',
            token: actorAccessToken,
            body: { user_id: normalBotUserId },
          },
        );
        await waitForRoomMember(roomId, normalBotUserId);
        await matrixJson(
          `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/m.room.power_levels/`,
          {
            method: 'PUT',
            token: actorAccessToken,
            body: {
              users: { [actorUserId]: 100, [normalBotUserId]: 0 },
              users_default: 0,
              state_default: 50,
              events_default: 0,
              events: { [StateEventName.IM_VECTOR_MODULAR_WIDGETS_EVENT]: 0 },
            },
          },
        );

        const helpEventId = await sendRoomCommand(
          roomId,
          actorAccessToken,
          '!calendar help',
        );
        const helpReply = await waitForCommandReply(
          roomId,
          helpEventId,
          normalBotUserId,
        );
        expect(helpReply.content.body).toContain('Room calendar commands');
        expect(helpReply.content.body).toContain('!calendar setup');

        const setupEventId = await sendRoomCommand(
          roomId,
          actorAccessToken,
          '!calendar setup',
        );
        const setupReply = await waitForCommandReply(
          roomId,
          setupEventId,
          normalBotUserId,
        );
        expect(setupReply.content.body).toBe(
          'The room calendar is ready and the widget was added.',
        );
        const records = await bindingStore.listAll();
        const roomRecords = records.filter(
          (record) => record.roomId === roomId,
        );
        expect(roomRecords).toHaveLength(1);
        expect(roomRecords[0]).toMatchObject({ roomId, status: 'ready' });
        expect(
          bindingRecordsSnapshot(
            records.filter((record) => record.roomId !== roomId),
          ),
        ).toEqual(unrelatedBindingsBeforeSetup);
        const bindingSnapshotAfterCreation = bindingRecordsSnapshot(records);
        const calendarId = roomRecords[0].calendarId;
        const roomStateAfterCreation =
          await normalBotClient.getRoomState(roomId);
        const widgetSnapshotAfterCreation = widgetIdentitySnapshot(
          roomStateAfterCreation,
        );
        expect(widgetSnapshotAfterCreation).toEqual([
          [
            `calendar-widget-${calendarId}`,
            normalBotUserId,
            `calendar-widget-${calendarId}`,
          ],
        ]);
        const widgetEvents = roomStateAfterCreation.filter(
          (event) =>
            event.type === StateEventName.IM_VECTOR_MODULAR_WIDGETS_EVENT &&
            event.state_key === `calendar-widget-${calendarId}`,
        );
        expect(widgetEvents).toHaveLength(1);
        expect(widgetEvents[0].content).toMatchObject({
          id: `calendar-widget-${calendarId}`,
          type: WidgetType.MEETINGS,
        });
        const selected = await new RoomCalendarCalDavAccess(
          setupConfiguration,
          registry,
          proofProvider,
        ).forAuthorizedTarget(
          { roomId, calendarId, principal: { kind: 'service' } },
          'read',
        );
        const discovery = await nativeFetch(selected.calendarUrl, {
          method: 'PROPFIND',
          headers: {
            Depth: '0',
            ...(await new MatrixOpenIdCalDavCredentialProviderFactory()
              .forPrincipal(selected.userId, selected.credential)
              .getRequestHeaders()),
          },
        });
        expect(discovery.status).toBe(207);

        freshSql = createBindingTestPostgresClient();
        await requireIsolatedBindingTestDatabase(freshSql);
        const freshStore = new PostgresRoomCalendarBindingStore(freshSql);
        const freshRegistry = new RoomCalendarBindingRegistryAdapter(
          [],
          freshStore,
        );
        const resolved = await freshRegistry.resolve(roomId);
        expect(resolved).toEqual({ roomId, calendarId });
        const freshAccess = new RoomCalendarCalDavAccess(
          setupConfiguration,
          freshRegistry,
          proofProvider,
        );
        const freshPrincipal = await freshAccess.forAuthorizedTarget(
          { roomId, calendarId, principal: { kind: 'service' } },
          'write',
        );
        const operations = new RoomCalendarEventOperations(nativeFetch, {
          eventWritesEnabled: true,
          maxResponseBytes: setupConfiguration.caldav_max_event_response_bytes,
          radicaleBaseUrl,
          bindingRegistry: freshRegistry,
          principalIdentityProvider: getRoomPrincipalIdentityProvider(),
        });
        const event = await operations.createEvent(
          {
            target: { roomId, calendarId, principal: { kind: 'service' } },
            servicePrincipal: freshPrincipal,
          },
          {
            uid: `moderator-setup-${randomUUID()}@example.test`,
            title: 'Dynamic setup event',
            timing: {
              type: 'timed',
              start: {
                type: 'zoned',
                local: '2026-10-21T10:00',
                timezone: 'UTC',
              },
              end: {
                type: 'zoned',
                local: '2026-10-21T11:00',
                timezone: 'UTC',
              },
            },
          },
        );
        const eventAccess = {
          target: {
            roomId,
            calendarId,
            principal: { kind: 'service' as const },
          },
          servicePrincipal: freshPrincipal,
        };
        expect(
          (await operations.getEvent(eventAccess, event.event.id)).event.title,
        ).toBe('Dynamic setup event');
        const updated = await operations.updateEvent(
          eventAccess,
          event.event.id,
          event.etag,
          { title: 'Updated dynamic setup event' },
        );
        expect(updated.event.title).toBe('Updated dynamic setup event');
        await operations.deleteEvent(eventAccess, event.event.id, updated.etag);

        const bindingSnapshotBeforeRetry = bindingRecordsSnapshot(
          await bindingStore.listAll(),
        );
        const widgetSnapshotBeforeRetry = widgetIdentitySnapshot(
          await normalBotClient.getRoomState(roomId),
        );
        const repeated = await setupService.setup({ roomId, actorUserId });
        expect(repeated.status).toBe('already-ready');
        expect(bindingRecordsSnapshot(await bindingStore.listAll())).toEqual(
          bindingSnapshotBeforeRetry,
        );
        expect(bindingSnapshotBeforeRetry).toEqual(
          bindingSnapshotAfterCreation,
        );
        expect(
          widgetIdentitySnapshot(await normalBotClient.getRoomState(roomId)),
        ).toEqual(widgetSnapshotBeforeRetry);
        expect(widgetSnapshotBeforeRetry).toEqual(widgetSnapshotAfterCreation);

        const { userId: outsiderId, accessToken: outsiderToken } =
          await registerNormalBotAccount();
        const outsiderClient = new MatrixClient(homeserverUrl, outsiderToken);
        const deniedRoom = await createRoom(
          'Non-manager room setup denial',
          actorAccessToken,
        );
        await matrixJson(
          `/_matrix/client/v3/rooms/${encodeURIComponent(deniedRoom)}/invite`,
          {
            method: 'POST',
            token: actorAccessToken,
            body: { user_id: normalBotUserId },
          },
        );
        await normalBotClient.joinRoom(deniedRoom);
        await matrixJson(
          `/_matrix/client/v3/rooms/${encodeURIComponent(deniedRoom)}/invite`,
          {
            method: 'POST',
            token: actorAccessToken,
            body: { user_id: outsiderId },
          },
        );
        await outsiderClient.joinRoom(deniedRoom);
        await matrixJson(
          `/_matrix/client/v3/rooms/${encodeURIComponent(deniedRoom)}/state/m.room.power_levels/`,
          {
            method: 'PUT',
            token: actorAccessToken,
            body: {
              users: {
                [actorUserId]: 100,
                [normalBotUserId]: 0,
                [outsiderId]: 0,
              },
              users_default: 0,
              state_default: 50,
              events_default: 0,
              events: { [StateEventName.IM_VECTOR_MODULAR_WIDGETS_EVENT]: 0 },
            },
          },
        );
        const openIdCountBeforeDenial = principalOpenIdRequests.length;
        activeCalDavRequests = [];
        const bindingSnapshotBeforeDenial = bindingRecordsSnapshot(
          await bindingStore.listAll(),
        );
        const widgetSnapshotBeforeDenial = widgetIdentitySnapshot(
          await normalBotClient.getRoomState(deniedRoom),
        );
        const deniedCommandEventId = await sendRoomCommand(
          deniedRoom,
          outsiderToken,
          '!calendar setup',
        );
        const deniedReply = await waitForCommandReply(
          deniedRoom,
          deniedCommandEventId,
          normalBotUserId,
        );
        expect(deniedReply.content.body).toBe(
          'Only a room member from an allowed Matrix server with calendar-manage permission can set up this room.',
        );
        expect(bindingRecordsSnapshot(await bindingStore.listAll())).toEqual(
          bindingSnapshotBeforeDenial,
        );
        expect(
          widgetIdentitySnapshot(
            await normalBotClient.getRoomState(deniedRoom),
          ),
        ).toEqual(widgetSnapshotBeforeDenial);
        expect(widgetSnapshotBeforeDenial).toEqual([]);
        expect(principalOpenIdRequests).toHaveLength(openIdCountBeforeDenial);
        expect(activeCalDavRequests).toEqual([]);
      } finally {
        try {
          await commandMicroservice?.close();
        } finally {
          // @ts-expect-error: restore the process-wide logger state after the fixture.
          PinoLogger.root = previousPinoRoot;
        }
      }
    } finally {
      await Promise.all([
        sql.end({ timeout: 5 }),
        ...(freshSql ? [freshSql.end({ timeout: 5 })] : []),
      ]);
    }
  }, 120000);

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

  // matrixJson can wait twice for server-directed 30s retries in this fixture.
  // Allow that bounded delay plus time for the remaining local room operations.
  it('rechecks private-client room policy against live Synapse state', async () => {
    markRoomAppServiceCaseStarted('private-client-live-policy');
    markRoomAppServiceCaseStage('private-client-live-policy', 'identities');
    const policyReaderToken =
      roomPrincipalMode === 'appservice'
        ? serviceUserAccessTokens[0]
        : principalAccessToken;
    if (!policyReaderToken) {
      throw new Error('Private-client policy reader token is unavailable');
    }

    const ownerUserId = await matrixUserIdForAccessToken(actorAccessToken);
    const issuer = await registerNormalBotAccount();
    const issuerUserId = issuer.userId;
    const issuerToken = issuer.accessToken;
    const readerUserId = await matrixUserIdForAccessToken(policyReaderToken);
    expect(readerUserId).toBe(principalUserId);
    expect(new Set([ownerUserId, issuerUserId, readerUserId]).size).toBe(3);
    const roomOwnerPowerLevel = 100;
    const calendarManagerPowerLevel = 50;
    expect(calendarManagerPowerLevel).toBeLessThan(roomOwnerPowerLevel);

    markRoomAppServiceCaseStage('private-client-live-policy', 'room-setup');
    const roomId = await createRoom(
      'Private client Synapse policy contract',
      actorAccessToken,
    );
    const calendarId = `contract-private-policy-${randomUUID().replace(/-/gu, '')}`;
    const policyRoomConfiguration = {
      ...testConfiguration,
      room_calendar_bindings: [
        ...testConfiguration.room_calendar_bindings,
        { roomId, calendarId },
      ],
    } as IAppConfiguration;
    const registry = new RoomCalendarBindingRegistryAdapter(
      policyRoomConfiguration.room_calendar_bindings,
      new DisabledRoomCalendarBindingStore(),
    );
    const proofProvider = new MatrixRoomCalendarPrincipalOpenIdProofProvider(
      policyRoomConfiguration,
      getRoomPrincipalIdentityProvider(),
      nativeFetch,
    );
    const policyRoomAccess = new RoomCalendarCalDavAccess(
      policyRoomConfiguration,
      registry,
      proofProvider,
    );
    const ownerMatrixClient = new MatrixClient(homeserverUrl, actorAccessToken);
    const policyMatrixClient = new MatrixClient(
      homeserverUrl,
      policyReaderToken,
    );
    const originalPowerLevels = (await ownerMatrixClient.getRoomStateEvent(
      roomId,
      StateEventName.M_ROOM_POWER_LEVELS_EVENT,
      '',
    )) as PowerLevelsEventContent;
    let powerLevelsChanged = false;

    const writePowerLevels = async (
      token: string,
      content: PowerLevelsEventContent,
    ) =>
      matrixJson(
        `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/m.room.power_levels/`,
        { method: 'PUT', token, body: content },
      );
    const inviteAndJoin = async (
      userId: string,
      token: string,
    ): Promise<void> => {
      await matrixJson(
        `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/invite`,
        {
          method: 'POST',
          token: actorAccessToken,
          body: { user_id: userId },
        },
      );
      await matrixJson(
        `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/join`,
        { method: 'POST', token, body: {} },
      );
      await waitForRoomMember(roomId, userId);
    };
    const leaveMember = async (token: string): Promise<void> => {
      await matrixJson(
        `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/leave`,
        { method: 'POST', token, body: {} },
      );
    };

    let privatePolicyBodyFailed = false;
    try {
      await inviteAndJoin(issuerUserId, issuerToken);
      await inviteAndJoin(readerUserId, policyReaderToken);

      const managerPowerLevels: PowerLevelsEventContent = {
        ...originalPowerLevels,
        users: {
          ...originalPowerLevels.users,
          [ownerUserId]: roomOwnerPowerLevel,
          [issuerUserId]: roomOwnerPowerLevel,
          [readerUserId]: 0,
        },
        events: {
          ...originalPowerLevels.events,
          [MATRIX_CALENDAR_MANAGE_POLICY]: calendarManagerPowerLevel,
        },
        state_default: calendarManagerPowerLevel,
      };
      powerLevelsChanged = true;
      await writePowerLevels(actorAccessToken, managerPowerLevels);

      markRoomAppServiceCaseStage('private-client-live-policy', 'baseline');
      const target = {
        roomId,
        calendarId,
        principal: { kind: 'service' as const },
      };
      const calendar = await policyRoomAccess.forAuthorizedTarget(
        target,
        'read',
      );
      await createServiceCalendar(
        calendar.calendarUrl,
        calendar.userId,
        calendar.credential,
      );

      const epochKey = randomBytes(32);
      const callbackKey = randomBytes(32);
      const { record, secret } = createPrivatePolicyRecord({
        createdBy: issuerUserId,
        roomId,
        calendarId,
        canonicalPath: new URL(calendar.calendarUrl).pathname,
        epochKey,
      });
      const missingRoomId = `!private-policy-missing-${randomUUID()}:localhost`;
      const unknownMembershipCredential = createPrivatePolicyRecord({
        createdBy: issuerUserId,
        roomId: missingRoomId,
        calendarId: 'missing-policy-calendar',
        canonicalPath: '/missing-policy-calendar/',
        epochKey,
      });
      const contractStore = createPrivatePolicyStore([
        record,
        unknownMembershipCredential.record,
      ]);
      const privateClientConfig = {
        ...policyRoomConfiguration,
        private_calendar_clients_enabled: true,
        private_calendar_client_epoch_key: epochKey,
        private_calendar_client_callback_key: callbackKey,
        private_calendar_client_origin: 'https://api.example.test',
        private_calendar_client_database_url:
          'postgresql://private-policy.invalid/private_policy_contract',
      } as IAppConfiguration;
      const authorizationFactory = new MatrixCalendarAuthorizationFactory(
        policyMatrixClient,
      );
      const policy = new PrivateCalendarClientPolicy(
        privateClientConfig,
        contractStore.store,
        authorizationFactory,
        policyMatrixClient,
        policyRoomAccess,
      );

      expect(
        await authorizationFactory.canManageCalendars(issuerUserId, roomId),
      ).toBe(true);

      markRoomAppServiceCaseStage(
        'private-client-live-policy',
        'credential-rw',
      );
      expect(await policy.authenticate(record.appId, secret)).toBe(true);
      expect(
        await policy.authorizeDavRequest(record.appId, 'GET', 'resource'),
      ).toBe(true);
      expect(
        await policy.authorizeDavRequest(record.appId, 'PUT', 'resource'),
      ).toBe(true);
      expect(
        await policy.rights(
          record.appId,
          `/${record.appId}/calendar/synthetic-event.ics`,
        ),
      ).toBe('rw');

      const mapFetch = jest.fn(async () => new Response(null, { status: 503 }));
      const privateClientService = new PrivateCalendarClientService(
        privateClientConfig,
        authorizationFactory,
        new MatrixOpenIdCalDavCredentialProviderFactory(),
        policyRoomAccess,
        contractStore.store,
        mapFetch as unknown as typeof fetch,
      );
      const readerContext = {
        userId: readerUserId,
        locale: 'en',
        timezone: 'UTC',
      };
      markRoomAppServiceCaseStage(
        'private-client-live-policy',
        'issuance-denials',
      );
      await expect(
        privateClientService.create(readerContext, undefined, {
          target: 'room',
          roomId,
          calendarId,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        privateClientService.revoke(readerContext, undefined, record.appId),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        privateClientService.create(
          {
            userId: issuerUserId,
            locale: 'en',
            timezone: 'UTC',
          },
          undefined,
          {
            target: 'room',
            roomId: nonmemberRoomId,
            calendarId: 'contract-nonmember',
          },
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(mapFetch).not.toHaveBeenCalled();

      markRoomAppServiceCaseStage(
        'private-client-live-policy',
        'unknown-membership',
      );
      await expect(
        policyMatrixClient.getJoinedRoomMembers(missingRoomId),
      ).rejects.toBeDefined();
      const unknownPolicy = new PrivateCalendarClientPolicy(
        privateClientConfig,
        contractStore.store,
        authorizationFactory,
        policyMatrixClient,
        policyRoomAccess,
      );
      expect(
        await unknownPolicy.authenticate(
          unknownMembershipCredential.record.appId,
          unknownMembershipCredential.secret,
        ),
      ).toBe(false);
      expect(
        contractStore.get(unknownMembershipCredential.record.appId)?.state,
      ).toBe('active');
      expect(contractStore.revocationCount()).toBe(0);

      const readOnlyPowerLevels: PowerLevelsEventContent = {
        ...managerPowerLevels,
        users: {
          ...managerPowerLevels.users,
          [issuerUserId]: 0,
          [readerUserId]: calendarManagerPowerLevel,
        },
      };
      markRoomAppServiceCaseStage('private-client-live-policy', 'demotion');
      await writePowerLevels(issuerToken, readOnlyPowerLevels);
      expect(
        await authorizationFactory.canManageCalendars(readerUserId, roomId),
      ).toBe(true);
      expect(await policy.authenticate(record.appId, secret)).toBe(true);
      expect(
        await policy.authorizeDavRequest(record.appId, 'GET', 'resource'),
      ).toBe(true);
      expect(
        await policy.authorizeDavRequest(record.appId, 'PUT', 'resource'),
      ).toBe(false);
      expect(
        await policy.rights(
          record.appId,
          `/${record.appId}/calendar/synthetic-event.ics`,
        ),
      ).toBe('r');

      markRoomAppServiceCaseStage('private-client-live-policy', 'leave');
      await leaveMember(issuerToken);
      await waitForRoomMembership(
        policyMatrixClient,
        roomId,
        issuerUserId,
        false,
      );
      expect(
        await policy.authorizeDavRequest(record.appId, 'GET', 'resource'),
      ).toBe(false);
      expect(contractStore.get(record.appId)?.state).toBe('revoked');
      expect(contractStore.get(record.appId)?.secretVerifier).toBeUndefined();
      expect(contractStore.revocationCount()).toBe(1);

      markRoomAppServiceCaseStage('private-client-live-policy', 'rejoin');
      await inviteAndJoin(issuerUserId, issuerToken);
      expect(await policy.authenticate(record.appId, secret)).toBe(false);
      expect(
        await policy.authorizeDavRequest(record.appId, 'GET', 'resource'),
      ).toBe(false);
      expect(
        await policy.rights(
          record.appId,
          `/${record.appId}/calendar/synthetic-event.ics`,
        ),
      ).toBe('');
      expect(contractStore.get(record.appId)?.state).toBe('revoked');
      expect(contractStore.revocationCount()).toBe(1);
    } catch (error) {
      privatePolicyBodyFailed = true;
      throw error;
    } finally {
      markPrivatePolicyBodyResult(
        privatePolicyBodyFailed ? 'failed' : 'completed',
      );
      if (powerLevelsChanged) {
        markPrivatePolicyCleanupOperation('restore-power-levels');
        try {
          await writePowerLevels(actorAccessToken, originalPowerLevels);
        } catch (error) {
          markPrivatePolicyCleanupFailure('restore-power-levels');
          if (!privatePolicyBodyFailed) throw error;
        }
      }
      markPrivatePolicyCleanupOperation('lookup-members');
      let joinedMembers: string[];
      try {
        joinedMembers = await ownerMatrixClient.getJoinedRoomMembers(roomId);
      } catch (error) {
        markPrivatePolicyCleanupFailure('lookup-members');
        if (!privatePolicyBodyFailed) throw error;
        joinedMembers = [];
      }
      if (joinedMembers.includes(issuerUserId)) {
        markPrivatePolicyCleanupOperation('leave-issuer');
        try {
          await leaveMember(issuerToken);
        } catch (error) {
          markPrivatePolicyCleanupFailure('leave-issuer');
          if (!privatePolicyBodyFailed) throw error;
        }
      }
      if (joinedMembers.includes(readerUserId)) {
        markPrivatePolicyCleanupOperation('leave-reader');
        try {
          await leaveMember(policyReaderToken);
        } catch (error) {
          markPrivatePolicyCleanupFailure('leave-reader');
          if (!privatePolicyBodyFailed) throw error;
        }
      }
    }
  }, 90_000);

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
      expect(
        selectedPrincipalRequests.every(
          ({ bodyIsEmptyObject }) => bodyIsEmptyObject,
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
      'upcoming 10 --ids --tz UTC',
      translateCalendarCommand,
    );
    expect(upcomingText).toContain(`Resource ID: ${resourceId}`);
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

function markPrivatePolicyBodyResult(result: PrivatePolicyBodyResult): void {
  appendRoomAppServiceSetupMarker(
    `room-appservice-case-body-private-client-live-policy-${result}`,
  );
}

function markPrivatePolicyCleanupOperation(
  operation: PrivatePolicyCleanupOperation,
): void {
  appendRoomAppServiceSetupMarker(
    `room-appservice-case-cleanup-private-client-live-policy-operation-${operation}`,
  );
}

function markPrivatePolicyCleanupFailure(
  failure: PrivatePolicyCleanupFailure,
): void {
  appendRoomAppServiceSetupMarker(
    `room-appservice-case-cleanup-private-client-live-policy-failure-${failure}`,
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
    execFileSync('docker', buildNormalBotAccountRegistrationArgs(localpart), {
      encoding: 'utf8',
      input: password,
      timeout: 30_000,
    });
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

function buildNormalBotAccountRegistrationArgs(localpart: string): string[] {
  return [
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
    '--no-admin',
    'http://localhost:8008',
  ];
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

type MatrixTimelineMessage = {
  event_id?: string;
  sender?: string;
  type?: string;
  content?: {
    body?: string;
    'm.relates_to'?: {
      'm.in_reply_to'?: { event_id?: string };
    };
  };
};

async function sendRoomCommand(
  roomId: string,
  token: string,
  body: string,
): Promise<string> {
  const result = await matrixJson<{ event_id: string }>(
    `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${randomUUID()}`,
    {
      method: 'PUT',
      token,
      body: { msgtype: 'm.text', body },
    },
  );
  return result.event_id;
}

async function waitForRoomMember(
  roomId: string,
  userId: string,
): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const response = await nativeFetch(
      new URL(
        `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/joined_members`,
        homeserverUrl,
      ),
      { headers: { Authorization: `Bearer ${actorAccessToken}` } },
    );
    if (response.ok) {
      const body = (await response.json()) as {
        joined?: Record<string, unknown>;
      };
      if (body.joined && userId in body.joined) return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Normal bot did not join the invited room');
}

async function waitForRoomMembership(
  matrixClient: MatrixClient,
  roomId: string,
  userId: string,
  joined: boolean,
): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const members = await matrixClient.getJoinedRoomMembers(roomId);
    if (members.includes(userId) === joined) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Synapse membership did not reach the expected state');
}

async function waitForCommandReply(
  roomId: string,
  eventId: string,
  senderId: string,
): Promise<
  MatrixTimelineMessage & {
    content: NonNullable<MatrixTimelineMessage['content']>;
  }
> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const response = await nativeFetch(
      new URL(
        `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/messages?dir=b&limit=100`,
        homeserverUrl,
      ),
      { headers: { Authorization: `Bearer ${actorAccessToken}` } },
    );
    if (response.ok) {
      const body = (await response.json()) as {
        chunk?: MatrixTimelineMessage[];
      };
      const reply = (body.chunk ?? []).find(
        (event) =>
          event.type === 'm.room.message' &&
          event.sender === senderId &&
          event.content?.['m.relates_to']?.['m.in_reply_to']?.event_id ===
            eventId,
      );
      if (reply?.content) {
        return reply as MatrixTimelineMessage & {
          content: NonNullable<MatrixTimelineMessage['content']>;
        };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Normal bot did not reply to the Matrix calendar command');
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
  'calendarCommandReplies.allDay': 'All day',
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
  let rateLimitRetries = 0;
  while (true) {
    const response = await nativeFetch(new URL(path, homeserverUrl), {
      method: options.method,
      headers: {
        'Content-Type': 'application/json',
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      body: JSON.stringify(options.body),
    });
    if (response.ok) return (await response.json()) as T;

    markRoomAppServiceSetupHttpStatus(response.status);
    let errorBody: { errcode?: unknown; retry_after_ms?: unknown } | undefined;
    try {
      errorBody = (await response.clone().json()) as {
        errcode?: unknown;
        retry_after_ms?: unknown;
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

    const retryAfterMs = errorBody?.retry_after_ms;
    if (
      response.status === 429 &&
      errorBody?.errcode === 'M_LIMIT_EXCEEDED' &&
      typeof retryAfterMs === 'number' &&
      Number.isSafeInteger(retryAfterMs) &&
      retryAfterMs >= 0 &&
      retryAfterMs <= 30_000 &&
      rateLimitRetries < 2
    ) {
      const route = new URL(path, homeserverUrl).pathname.replace(
        /\/rooms\/[^/]+/g,
        '/rooms/:roomId',
      );
      appendRoomAppServiceSetupMarker(
        `room-appservice-rate-limit-retry-${options.method}-${route}-${retryAfterMs}ms`,
      );
      rateLimitRetries += 1;
      await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
      continue;
    }

    throw new Error(
      `Matrix contract fixture request failed (${response.status})`,
    );
  }
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
