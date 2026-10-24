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

import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  Request as ExpressRequest,
  Response as ExpressResponse,
  NextFunction,
} from 'express';
import type { MatrixClient } from 'matrix-bot-sdk';
import { execFile, spawn } from 'node:child_process';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { once } from 'node:events';
import {
  chmodSync,
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import {
  request as createHttpRequest,
  createServer as createHttpServer,
} from 'node:http';
import {
  request as createHttpsRequest,
  createServer as createHttpsServer,
} from 'node:https';
import { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve as resolvePath } from 'node:path';
import { ReadableStream } from 'node:stream/web';
import { promisify } from 'node:util';
import type { CalDavCredentialProvider } from '../../src/caldav/CalDavCredentialProvider';
import { createCalendarGatewayHttpApplication } from '../../src/http/CalendarGatewayHttpApplication';
import type { IAppConfiguration } from '../../src/IAppConfiguration';
import type {
  PrivateCalendarClientRecord,
  PrivateCalendarClientStore,
} from '../../src/model/IPrivateCalendarClientStore';
import type { MatrixCalendarAuthorizationFactory } from '../../src/service/MatrixCalendarAuthorization';
import { PrivateCalendarClientCallbackGateway } from '../../src/service/private-client/PrivateCalendarClientCallbackGateway';
import { privateCalendarClientSecretVerifier } from '../../src/service/private-client/PrivateCalendarClientCredentials';
import { PrivateCalendarClientDavGateway } from '../../src/service/private-client/PrivateCalendarClientDavGateway';
import { PrivateCalendarClientPolicy } from '../../src/service/private-client/PrivateCalendarClientPolicy';
import { RadicalePrivateClientMapClient } from '../../src/service/private-client/RadicalePrivateClientMapClient';
import type { RoomCalendarCalDavAccess } from '../../src/service/RoomCalendarCalDavAccess';

const execFileAsync = promisify(execFile);
const contractEnabled = process.env.PRIVATE_CALDAV_CONTRACT === '1';
const describeContract = contractEnabled ? describe : describe.skip;

const APP_ID_PATTERN = /^mcwpc~[a-f0-9]{48}$/u;
const TEST_MATRIX_SERVER = 'example.test';
const TEST_ACTOR = '@alice:example.test';
const CONTROL_HEADER = 'x-contract-key';

function mkCalendar(components: readonly string[] = ['VEVENT']): Buffer {
  const componentXml = components
    .map((name) => `<c:comp name="${name}"/>`)
    .join('');
  return Buffer.from(
    `<?xml version="1.0" encoding="utf-8"?><c:mkcalendar xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:d="DAV:"><d:set><d:prop><d:displayname>Contract Calendar</d:displayname><c:supported-calendar-component-set>${componentXml}</c:supported-calendar-component-set></d:prop></d:set></c:mkcalendar>`,
  );
}
const INITIAL_EVENT = Buffer.from(
  'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Matrix Calendar Widget//Private client contract//EN\r\nBEGIN:VEVENT\r\nUID:private-contract-event\r\nDTSTAMP:20261021T100000Z\r\nDTSTART:20261022T090000Z\r\nDTEND:20261022T100000Z\r\nSUMMARY:Canonical event before client edit\r\nX-COMPANY-OPAQUE;X-KEEP=attribute:keep-this-value\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n',
);
const OTHER_EVENT = Buffer.from(
  'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Matrix Calendar Widget//Private client contract//EN\r\nBEGIN:VEVENT\r\nUID:other-calendar-contract-event\r\nDTSTAMP:20261021T100000Z\r\nDTSTART:20261022T090000Z\r\nDTEND:20261022T100000Z\r\nSUMMARY:Do not disclose another calendar\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n',
);
const MIXED_RESOURCE = Buffer.from(
  'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Matrix Calendar Widget//Private client contract//EN\r\nBEGIN:VTODO\r\nUID:mixed-contract-task\r\nDTSTAMP:20261021T100000Z\r\nSUMMARY:Mixed collection task before guarded writes\r\nEND:VTODO\r\nEND:VCALENDAR\r\n',
);
const PENDING_CALENDAR_QUERY = Buffer.from(
  '<?xml version="1.0" encoding="utf-8"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"/></c:comp-filter></c:filter></c:calendar-query>',
);

type ResponseBody = Readonly<{
  status: number;
  headers: Headers;
  body: Buffer;
}>;

type ContractRecordStore = Pick<
  PrivateCalendarClientStore,
  'enabled' | 'getByAppId' | 'beginBootstrap' | 'activate' | 'revoke'
>;

class PrivateContractMatrixAuth {}

let callbackGateway: PrivateCalendarClientCallbackGateway;
let davGateway: PrivateCalendarClientDavGateway;
let contractConfig: IAppConfiguration;

const configProvider = {
  getOrThrow: () => contractConfig,
};

@Module({
  providers: [
    { provide: ConfigService, useValue: configProvider },
    {
      provide: PrivateCalendarClientCallbackGateway,
      useFactory: () => callbackGateway,
    },
    {
      provide: PrivateCalendarClientDavGateway,
      useFactory: () => davGateway,
    },
    {
      provide: PrivateContractMatrixAuth,
      useValue: {
        use: (
          _request: ExpressRequest,
          _response: ExpressResponse,
          next: NextFunction,
        ) => next(),
      },
    },
  ],
})
class PrivateCalendarClientRadicaleContractModule {}

describeContract(
  'private CalDAV client with Radicale and python-caldav',
  () => {
    jest.setTimeout(90_000);

    it('discovers and edits only the mapped calendar through the HTTPS gateway', async () => {
      const root = resolvePath(__dirname, '../../..');
      const python =
        process.env.MCW_PRIVATE_CALDAV_PYTHON ??
        '/tmp/mcw-public-feeds-radicale-venv/bin/python';
      const caldavSitePackages =
        process.env.MCW_PRIVATE_CALDAV_SITE_PACKAGES ??
        resolvePath(root, '../private-client-contract/site-packages');
      const pluginSource = join(root, 'radicale-auth', 'src');
      const pythonContract = join(
        root,
        'radicale-auth',
        'tests',
        'private_client_caldav_contract.py',
      );
      expect(existsSync(python)).toBe(true);
      expect(
        existsSync(join(caldavSitePackages, 'caldav', '__init__.py')),
      ).toBe(true);

      const temp = await mkdtemp(join(tmpdir(), 'mcw-private-client-runtime-'));
      chmodSync(temp, 0o700);
      const logPath = join(temp, 'radicale.log');
      const logFd = openSync(logPath, 'w', 0o600);
      let radicale: ReturnType<typeof spawn> | undefined;
      let userInfoServer: ReturnType<typeof createHttpServer> | undefined;
      let httpsServer: ReturnType<typeof createHttpsServer> | undefined;
      let controlServer: ReturnType<typeof createHttpServer> | undefined;
      let nestApplication:
        | Awaited<
            ReturnType<typeof createCalendarGatewayHttpApplication>
          >['app']
        | undefined;
      let store: ContractRecordStore | undefined;
      let records: Map<string, PrivateCalendarClientRecord> | undefined;
      let callbackCount = 0;
      let davPolicyCount = 0;
      let rightsPolicyCount = 0;
      let managerPowerChecks = 0;
      let roomMember = true;
      let managerPower = true;
      let mapStage = 'seeded';
      const mapRightsTrace: string[] = [];
      const homeProbeStatuses: number[] = [];
      const clientSecrets = new Map<string, string>();

      const personalAppId = `mcwpc~${randomBytes(24).toString('hex')}`;
      const roomAppId = `mcwpc~${randomBytes(24).toString('hex')}`;
      const personalSecret = randomBytes(32).toString('base64url');
      const roomSecret = randomBytes(32).toString('base64url');
      const callbackKey = randomBytes(32);
      const epochKey = randomBytes(32);
      const controlKey = randomBytes(32).toString('base64url');
      expect(APP_ID_PATTERN.test(personalAppId)).toBe(true);
      expect(APP_ID_PATTERN.test(roomAppId)).toBe(true);
      clientSecrets.set(personalAppId, personalSecret);
      clientSecrets.set(roomAppId, roomSecret);

      try {
        const certificates = await createContractCertificates(temp);
        const radicalePort = await availablePort();

        const subjects = new Map<string, string>([
          ['contract-owner-proof', '@alice:example.test'],
          ['contract-calendarbot-proof', '@calendarbot:example.test'],
          ['reserved-openid-proof', `@${personalAppId}:example.test`],
        ]);
        userInfoServer = createHttpServer((request, response) => {
          const url = new URL(request.url ?? '/', 'http://localhost');
          const token = url.searchParams.get('access_token') ?? '';
          const subject = subjects.get(token);
          if (
            request.method !== 'GET' ||
            url.pathname !== '/_matrix/federation/v1/openid/userinfo' ||
            !subject
          ) {
            response.writeHead(401).end();
            return;
          }
          const bytes = Buffer.from(JSON.stringify({ sub: subject }));
          response
            .writeHead(200, {
              'Content-Type': 'application/json',
              'Content-Length': String(bytes.byteLength),
            })
            .end(bytes);
        });
        await listen(userInfoServer);
        const userInfoActualPort = portOf(userInfoServer);

        const personalRecord = createRecord(
          personalAppId,
          personalSecret,
          epochKey,
          { target: 'personal', calendarId: 'personal' },
          '/alice/personal/',
        );
        const roomRecord = createRecord(
          roomAppId,
          roomSecret,
          epochKey,
          {
            target: 'room',
            roomId: '!contract-room:example.test',
            calendarId: 'room-team',
          },
          '/calendarbot/room-team/',
        );
        records = new Map([
          [personalAppId, personalRecord],
          [roomAppId, roomRecord],
        ]);
        store = {
          enabled: true,
          async getByAppId(appId) {
            return records?.get(appId);
          },
          async beginBootstrap(appId, now) {
            const current = records?.get(appId);
            if (
              !current ||
              current.state !== 'pending' ||
              current.mapState !== 'pending' ||
              current.expiresAt <= now ||
              current.createdAt.getTime() <= now.getTime() - 5 * 60 * 1000
            ) {
              return undefined;
            }
            const bootstrap = Object.freeze({
              ...current,
              mapState: 'bootstrap' as const,
            });
            records?.set(appId, bootstrap);
            return bootstrap;
          },
          async activate(appId, now) {
            const current = records?.get(appId);
            if (
              !current ||
              current.state !== 'pending' ||
              current.mapState !== 'bootstrap' ||
              current.expiresAt <= now ||
              current.createdAt.getTime() <= now.getTime() - 5 * 60 * 1000
            ) {
              return undefined;
            }
            const active = Object.freeze({
              ...current,
              state: 'active' as const,
              mapState: 'present' as const,
            });
            records?.set(appId, active);
            return active;
          },
          async revoke(appId, revokedAt) {
            const current = records?.get(appId);
            if (!current || !records) return undefined;
            const revoked = Object.freeze({
              ...current,
              state: 'revoked' as const,
              secretVerifier: undefined,
              revokedAt,
              mapState: 'cleanup-pending' as const,
            });
            records.set(appId, revoked);
            return revoked;
          },
        };

        const authorizationFactory = {
          async canManageCalendars() {
            managerPowerChecks += 1;
            return managerPower;
          },
        };
        const matrixClient = {
          async getJoinedRoomMembers() {
            return roomMember ? [TEST_ACTOR] : [];
          },
        };
        const roomCalendarCalDavAccess = {
          async forAuthorizedTarget() {
            return {
              calendarUrl: `http://127.0.0.1:${radicalePort}/calendarbot/room-team/`,
            };
          },
        };

        const policy = new PrivateCalendarClientPolicy(
          {
            private_calendar_clients_enabled: true,
            private_calendar_client_epoch_key: epochKey,
            private_calendar_client_callback_key: callbackKey,
          } as IAppConfiguration,
          store as PrivateCalendarClientStore,
          authorizationFactory as unknown as MatrixCalendarAuthorizationFactory,
          matrixClient as unknown as MatrixClient,
          roomCalendarCalDavAccess as unknown as RoomCalendarCalDavAccess,
        );
        const authenticate = policy.authenticate.bind(policy);
        policy.authenticate = async (...args) => {
          callbackCount += 1;
          return authenticate(...args);
        };
        const authorizeDavRequest = policy.authorizeDavRequest.bind(policy);
        policy.authorizeDavRequest = async (...args) => {
          davPolicyCount += 1;
          return authorizeDavRequest(...args);
        };
        const rights = policy.rights.bind(policy);
        policy.rights = async (...args) => {
          rightsPolicyCount += 1;
          const result = await rights(...args);
          const [username, path] = args;
          if (typeof username === 'string' && typeof path === 'string') {
            const safeUser = APP_ID_PATTERN.test(username) ? 'app' : username;
            const safePath = path
              .replaceAll(personalAppId, '<app>')
              .replaceAll(roomAppId, '<app>')
              .replaceAll('/alice/personal/', '/owner/calendar/')
              .replaceAll('/calendarbot/room-team/', '/bot/room/');
            mapRightsTrace.push(
              `${mapStage} ${safeUser} ${safePath} ${result || 'deny'}`,
            );
          }
          return result;
        };

        const apiAddress = await availablePort();
        contractConfig = {
          private_calendar_clients_enabled: true,
          private_calendar_client_origin: `https://localhost:${apiAddress}`,
          private_calendar_client_epoch_key: epochKey,
          private_calendar_client_callback_key: callbackKey,
          radicale_url: `http://127.0.0.1:${radicalePort}`,
          calendar_gateway_rate_limit_requests: 10_000,
          calendar_gateway_rate_limit_window_ms: 60_000,
          calendar_gateway_rate_limit_max_keys: 50,
        } as IAppConfiguration;
        callbackGateway = new PrivateCalendarClientCallbackGateway(
          contractConfig,
          policy,
        );
        davGateway = new PrivateCalendarClientDavGateway(
          contractConfig,
          policy,
          contractFetch,
        );

        const gateway = await createCalendarGatewayHttpApplication(
          PrivateCalendarClientRadicaleContractModule,
          PrivateContractMatrixAuth,
        );
        nestApplication = gateway.app;
        nestApplication.useLogger(false);
        await nestApplication.init();
        httpsServer = createHttpsServer(
          {
            key: await readFile(certificates.serverKey),
            cert: await readFile(certificates.serverCert),
          },
          nestApplication.getHttpAdapter().getInstance(),
        );
        await listen(httpsServer, '127.0.0.1', apiAddress);

        controlServer = createHttpServer((request, response) => {
          void handleControlRequest(
            request,
            response,
            controlKey,
            (change) => {
              if (typeof change.member === 'boolean')
                roomMember = change.member;
              if (typeof change.manager === 'boolean')
                managerPower = change.manager;
            },
            async () => {
              await store?.revoke(personalAppId, new Date());
            },
          );
        });
        await listen(controlServer);

        const collections = join(temp, 'collections');
        const configPath = join(temp, 'radicale.conf');
        writeFileSync(
          configPath,
          `[server]\nhosts = 127.0.0.1:${radicalePort}\nmax_connections = 4\nmax_content_length = 4194304\nmax_resource_size = 4194304\ntimeout = 5\n\n[auth]\ntype = matrix_calendar_radicale_auth\ncache_logins = False\nlc_username = False\nuc_username = False\nstrip_domain = False\nurldecode_username = False\ndelay = 0\n\n[rights]\ntype = matrix_calendar_radicale_auth.private_client_rights\n\n[storage]\ntype = multifilesystem\nfilesystem_folder = ${collections}\n\n[sharing]\ntype = files\ncollection_by_token = True\ncollection_by_map = True\npermit_create_token = True\npermit_create_map = True\npermit_properties_overlay = False\ndefault_permissions_create_token = r\n\n[logging]\nlevel = info\nmask_passwords = True\n`,
          { mode: 0o600 },
        );
        const callbackKeyText = callbackKey.toString('base64url');
        const pyEnv = {
          ...process.env,
          PYTHONPATH: [pluginSource, caldavSitePackages, process.env.PYTHONPATH]
            .filter(Boolean)
            .join(delimiter),
          SSL_CERT_FILE: certificates.caCert,
          RADICALE_MATRIX_HOMESERVER_URL: `http://127.0.0.1:${userInfoActualPort}`,
          RADICALE_MATRIX_SERVER_NAME: TEST_MATRIX_SERVER,
          RADICALE_PRIVATE_CLIENT_CALLBACK_ORIGIN: `https://localhost:${apiAddress}`,
          RADICALE_PRIVATE_CLIENT_CALLBACK_KEY: callbackKeyText,
        };
        radicale = spawn(python, ['-m', 'radicale', '--config', configPath], {
          cwd: temp,
          env: pyEnv,
          stdio: ['ignore', logFd, logFd],
        });
        await waitForRadicale(radicale, radicalePort, logPath);

        await seedCollection(
          radicalePort,
          '/alice/personal/',
          openIdPassword('contract-owner-proof'),
          INITIAL_EVENT,
          ['VEVENT', 'VTODO'],
        );
        await seedCollection(
          radicalePort,
          '/alice/other/',
          openIdPassword('contract-owner-proof'),
          OTHER_EVENT,
        );
        await seedCollection(
          radicalePort,
          '/calendarbot/room-team/',
          openIdPassword('contract-calendarbot-proof'),
          INITIAL_EVENT,
        );
        const mixedWrite = await requestRadicale(
          radicalePort,
          'PUT',
          '/alice/personal/mixed.ics',
          MIXED_RESOURCE,
          openIdAuthorization('alice', 'contract-owner-proof'),
          { 'Content-Type': 'text/calendar' },
        );
        expect([201, 204]).toContain(mixedWrite.status);

        const mapClient = new RadicalePrivateClientMapClient(
          `http://127.0.0.1:${radicalePort}`,
          contractFetch,
        );
        const ownerCredential = credentialProvider(
          'alice',
          openIdPassword('contract-owner-proof'),
        );
        const botCredential = credentialProvider(
          'calendarbot',
          openIdPassword('contract-calendarbot-proof'),
        );
        const personalCredential = credentialProvider(
          personalAppId,
          personalSecret,
        );
        const roomCredential = credentialProvider(roomAppId, roomSecret);
        const mapRequests: string[] = [];
        const mapFetch: typeof fetch = async (input, init) => {
          const response = await contractFetch(input, init);
          const url =
            input instanceof URL
              ? input
              : input instanceof globalThis.Request
                ? new URL(input.url)
                : new URL(input);
          if (url.pathname.startsWith('/.sharing/v1/map/')) {
            const authorization = new Headers(init?.headers).get(
              'Authorization',
            );
            const encoded = authorization?.startsWith('Basic ')
              ? Buffer.from(authorization.slice(6), 'base64').toString('utf8')
              : '';
            const username = encoded.split(':', 1)[0];
            const bodyText = await response.clone().text();
            let bodyStatus = 'non-json';
            try {
              const parsed = JSON.parse(bodyText) as Record<string, unknown>;
              bodyStatus =
                typeof parsed.Status === 'string' ? parsed.Status : 'no-status';
            } catch {
              // Record only the shape of a non-JSON response, never its body.
              bodyStatus = `non-json-${bodyText.length}`;
            }
            mapRequests.push(
              `${init?.method ?? 'GET'} ${url.pathname.split('/').at(-1)} ${response.status} ${response.headers.get('Content-Type') ?? 'no-content-type'} ${bodyStatus} ${APP_ID_PATTERN.test(username) ? 'app' : username || 'anonymous'}`,
            );
          }
          if (url.pathname === `/${personalAppId}/`) {
            homeProbeStatuses.push(response.status);
          }
          return response;
        };
        const tracedMapClient = new RadicalePrivateClientMapClient(
          `http://127.0.0.1:${radicalePort}`,
          mapFetch,
        );

        const pendingCredential = `Basic ${Buffer.from(
          `${personalAppId}:${personalSecret}`,
        ).toString('base64')}`;
        const syntheticHome = `/${personalAppId}/`;
        mapStage = 'home-preflight';
        await tracedMapClient.assertPrincipalHomeAbsent(
          personalAppId,
          personalCredential,
        );
        expect(homeProbeStatuses).toEqual([404]);
        const bootstrap = await store?.beginBootstrap(
          personalAppId,
          new Date(),
        );
        expect(bootstrap).toMatchObject({
          state: 'pending',
          mapState: 'bootstrap',
        });

        // The alias remains pending until map read-back succeeds. The exact map
        // API is exercised here as the canonical owner and then as app ID.
        mapStage = 'create';
        try {
          await tracedMapClient.createForClient(
            '/alice/personal/',
            personalAppId,
            ownerCredential,
          );
        } catch (error) {
          throw new Error(
            `Private map create failed (${error instanceof Error ? `${error.name}: ${error.message}` : 'unknown'}): ${mapRequests.join(', ')}; rights=${mapRightsTrace.slice(-12).join(' | ')}`,
          );
        }
        mapStage = 'accept';
        try {
          await tracedMapClient.acceptForClient(
            personalAppId,
            personalCredential,
          );
        } catch {
          throw new Error(
            `Private map acceptance failed: ${mapRequests.join(', ')}`,
          );
        }
        const personalMaps = await mapClient.listForCollection(
          '/alice/personal/',
          ownerCredential,
        );
        expect(personalMaps).toHaveLength(1);
        expect(personalMaps[0]).toMatchObject({
          PathOrToken: `/${personalAppId}/calendar/`,
          PathMapped: '/alice/personal/',
          Owner: 'alice',
          User: personalAppId,
          Permissions: 'rw',
          EnabledByOwner: true,
          EnabledByUser: true,
          HiddenByOwner: false,
          HiddenByUser: false,
        });
        const homeProbe = await requestRadicale(
          radicalePort,
          'PROPFIND',
          syntheticHome,
          Buffer.from(
            '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:allprop/></d:propfind>',
          ),
          pendingCredential,
          { Depth: '0', 'Content-Type': 'application/xml; charset=utf-8' },
        );
        if (homeProbe.status !== 207) {
          throw new Error(
            `Synthetic-home PROPFIND returned ${homeProbe.status}; rights=${mapRightsTrace.slice(-12).join(' | ')}`,
          );
        }
        await expect(
          tracedMapClient.assertPrincipalHomeAbsent(
            personalAppId,
            personalCredential,
          ),
        ).rejects.toMatchObject({ code: 'conflict' });
        expect(homeProbeStatuses).toEqual([404, 207]);
        expect(
          homeProbe.body.includes(Buffer.from('current-user-principal')),
        ).toBe(true);
        expect(homeProbe.body.includes(Buffer.from('calendar-home-set'))).toBe(
          true,
        );
        mapStage = 'home-create';
        const homeCreated = await requestRadicale(
          radicalePort,
          'MKCOL',
          syntheticHome,
          Buffer.alloc(0),
          pendingCredential,
        );
        expect(homeCreated.status).toBe(405);
        const ownHomeDelete = await requestRadicale(
          radicalePort,
          'DELETE',
          syntheticHome,
          Buffer.alloc(0),
          pendingCredential,
        );
        expect(ownHomeDelete.status).toBe(403);
        const pendingUrl = `/${personalAppId}/calendar/`;
        const pendingProbes: Array<{
          surface: 'native' | 'gateway';
          method: string;
          status: number;
          calendarData: boolean;
        }> = [];
        const pendingRequests: Array<{
          method: string;
          body: Buffer;
          headers: Record<string, string>;
        }> = [
          { method: 'GET', body: Buffer.alloc(0), headers: {} },
          {
            method: 'REPORT',
            body: PENDING_CALENDAR_QUERY,
            headers: { 'Content-Type': 'application/xml; charset=utf-8' },
          },
          {
            method: 'PROPFIND',
            body: Buffer.from(
              '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:allprop/></d:propfind>',
            ),
            headers: {
              Depth: '1',
              'Content-Type': 'application/xml; charset=utf-8',
            },
          },
        ];
        for (const probe of pendingRequests) {
          const native = await requestRadicale(
            radicalePort,
            probe.method,
            pendingUrl,
            probe.body,
            pendingCredential,
            probe.headers,
          );
          const gatewayResponse = await requestGatewayHttps(
            apiAddress,
            pendingUrl,
            probe.method,
            certificates.caCert,
            probe.body,
            pendingCredential,
            probe.headers,
          );
          const containsData = (body: Buffer) =>
            body.includes(Buffer.from('private-contract-event')) ||
            body.includes(Buffer.from('Canonical event before client edit')) ||
            body.includes(Buffer.from('X-COMPANY-OPAQUE'));
          pendingProbes.push(
            {
              surface: 'native',
              method: probe.method,
              status: native.status,
              calendarData: containsData(native.body),
            },
            {
              surface: 'gateway',
              method: probe.method,
              status: gatewayResponse.status,
              calendarData: containsData(gatewayResponse.body),
            },
          );
        }
        expect(
          pendingProbes.filter((probe) => probe.surface === 'gateway'),
        ).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              method: 'GET',
              status: 403,
              calendarData: false,
            }),
            expect.objectContaining({
              method: 'REPORT',
              status: 403,
              calendarData: false,
            }),
            expect.objectContaining({
              method: 'PROPFIND',
              status: 403,
              calendarData: false,
            }),
          ]),
        );
        process.stdout.write(
          `PRIVATE_PENDING_BOUNDARY ${JSON.stringify(pendingProbes)}\n`,
        );
        await activateRecord(records, personalAppId);
        const activeHomeDelete = await requestRadicale(
          radicalePort,
          'DELETE',
          syntheticHome,
          Buffer.alloc(0),
          pendingCredential,
        );
        const activeHomeCreate = await requestRadicale(
          radicalePort,
          'MKCOL',
          `${syntheticHome}blocked/`,
          Buffer.alloc(0),
          pendingCredential,
        );
        const activeShareAttempt = await requestRadicale(
          radicalePort,
          'POST',
          '/.sharing/v1/map/create',
          Buffer.from(
            JSON.stringify({
              PathMapped: '/alice/other/',
              PathOrToken: `/${personalAppId}/other/`,
              User: personalAppId,
              Permissions: 'rw',
              Conversion: 'none',
              Enabled: true,
              Hidden: false,
              Properties: {},
            }),
          ),
          pendingCredential,
          { 'Content-Type': 'application/json', Accept: 'application/json' },
        );
        let activeShareStatus = 'non-json';
        try {
          const body = JSON.parse(activeShareAttempt.body.toString('utf8')) as {
            Status?: unknown;
          };
          activeShareStatus =
            typeof body.Status === 'string' ? body.Status : 'missing-status';
        } catch {
          // Preserve only the response shape in the diagnostic output.
        }
        expect(activeHomeDelete.status).toBe(403);
        expect(activeHomeCreate.status).toBe(403);
        expect(activeShareStatus).not.toBe('success');
        const otherMapsAfterActiveShareAttempt =
          await mapClient.listForCollection('/alice/other/', ownerCredential);
        expect(otherMapsAfterActiveShareAttempt).toHaveLength(0);
        process.stdout.write(
          `PRIVATE_HOME_MASKS ${JSON.stringify({
            pendingRHome: homeProbeStatuses[0],
            pendingRWdDHome: homeProbe.status,
            pendingRWdDDelete: ownHomeDelete.status,
            activeRDelete: activeHomeDelete.status,
            activeRCreate: activeHomeCreate.status,
            activeRShare: activeShareAttempt.status,
            activeRShareStatus: activeShareStatus,
          })}\n`,
        );

        await tracedMapClient.assertPrincipalHomeAbsent(
          roomAppId,
          roomCredential,
        );
        expect(
          await store?.beginBootstrap(roomAppId, new Date()),
        ).toMatchObject({ state: 'pending', mapState: 'bootstrap' });
        await mapClient.createForClient(
          '/calendarbot/room-team/',
          roomAppId,
          botCredential,
        );
        await mapClient.acceptForClient(roomAppId, roomCredential);
        const roomMaps = await mapClient.listForCollection(
          '/calendarbot/room-team/',
          botCredential,
        );
        expect(roomMaps).toHaveLength(1);
        expect(roomMaps[0]).toMatchObject({
          PathOrToken: `/${roomAppId}/calendar/`,
          PathMapped: '/calendarbot/room-team/',
          Owner: 'calendarbot',
          User: roomAppId,
          Permissions: 'rw',
          EnabledByOwner: true,
          EnabledByUser: true,
          HiddenByOwner: false,
          HiddenByUser: false,
        });
        await activateRecord(records, roomAppId);

        const contractProcess = spawn(python, [pythonContract], {
          cwd: root,
          env: {
            ...pyEnv,
            MCW_PRIVATE_CALDAV_RADICALE_PORT: String(radicalePort),
            MCW_PRIVATE_CALDAV_CONTROL_PORT: String(portOf(controlServer)),
            MCW_PRIVATE_CALDAV_API_ORIGIN: `https://localhost:${apiAddress}`,
            MCW_PRIVATE_CALDAV_CA_FILE: certificates.caCert,
            MCW_PRIVATE_CALDAV_PERSONAL_APP_ID: personalAppId,
            MCW_PRIVATE_CALDAV_PERSONAL_SECRET: personalSecret,
            MCW_PRIVATE_CALDAV_ROOM_APP_ID: roomAppId,
            MCW_PRIVATE_CALDAV_ROOM_SECRET: roomSecret,
            MCW_PRIVATE_CALDAV_CONTROL_KEY: controlKey,
          },
        });
        let stdout = '';
        let stderr = '';
        contractProcess.stdout?.on('data', (chunk: Buffer) => {
          stdout += chunk.toString('utf8');
        });
        contractProcess.stderr?.on('data', (chunk: Buffer) => {
          stderr += chunk.toString('utf8');
        });
        const contractExit = await waitForChild(contractProcess, 70_000);
        if (contractExit !== 0) {
          const diagnostics = `${stdout}\n${stderr}`
            .replaceAll(personalSecret, '<secret>')
            .replaceAll(roomSecret, '<secret>')
            .replaceAll(controlKey, '<control-key>')
            .replaceAll(personalAppId, '<app-id>')
            .replaceAll(roomAppId, '<app-id>')
            .replace(
              /Authorization: Basic [A-Za-z0-9+/=]+/gu,
              'Authorization: Basic <redacted>',
            )
            .slice(-6000);
          throw new Error(
            `Python CalDAV contract exited ${contractExit}: ${diagnostics}`,
          );
        }
        const resultLine = stdout
          .split(/\r?\n/u)
          .map((line) => line.trim())
          .filter((line) => line.startsWith('{'))
          .at(-1);
        expect(resultLine).toBeDefined();
        expect(JSON.parse(resultLine ?? '{}')).toMatchObject({
          status: 'passed',
        });
        expect(stderr).toBe('');
        expect(callbackCount).toBeGreaterThan(20);
        expect(davPolicyCount).toBeGreaterThan(10);
        expect(rightsPolicyCount).toBeGreaterThan(20);
        expect(managerPowerChecks).toBeGreaterThan(0);
        expect(records.get(roomAppId)?.state).toBe('revoked');
        expect(records.get(personalAppId)?.state).toBe('revoked');

        await stopChild(radicale);
        const radicaleLog = readFileSync(logPath, 'utf8');
        expect(radicaleLog).not.toContain(personalSecret);
        expect(radicaleLog).not.toContain(roomSecret);
        expect(radicaleLog).not.toContain(personalAppId);
        expect(radicaleLog).not.toContain(roomAppId);
      } finally {
        if (radicale) await stopChild(radicale);
        if (httpsServer) await closeServer(httpsServer);
        if (controlServer) await closeServer(controlServer);
        if (userInfoServer) await closeServer(userInfoServer);
        if (nestApplication) await nestApplication.close();
        closeSync(logFd);
        rmSync(temp, { recursive: true, force: true });
      }
    });
  },
);

function createRecord(
  appId: string,
  secret: string,
  epochKey: Buffer,
  target: PrivateCalendarClientRecord['target'],
  canonicalPath: string,
): PrivateCalendarClientRecord {
  const now = new Date();
  return Object.freeze({
    appId,
    createdBy: TEST_ACTOR,
    target,
    canonicalPath,
    secretVerifier: privateCalendarClientSecretVerifier(appId, secret),
    credentialEpochHash: createHash('sha256').update(epochKey).digest('hex'),
    state: 'pending',
    mapState: 'pending',
    createdAt: now,
    expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
  });
}

async function activateRecord(
  records: Map<string, PrivateCalendarClientRecord>,
  appId: string,
): Promise<void> {
  const pending = records.get(appId);
  if (!pending || pending.mapState !== 'bootstrap') {
    throw new Error('contract record is not ready for activation');
  }
  records.set(
    appId,
    Object.freeze({ ...pending, state: 'active', mapState: 'present' }),
  );
}

function credentialProvider(
  username: string,
  password: string,
): CalDavCredentialProvider {
  return {
    async getRequestHeaders() {
      const encoded = Buffer.from(`${username}:${password}`, 'utf8').toString(
        'base64',
      );
      return { Authorization: `Basic ${encoded}` };
    },
  };
}

function openIdPassword(accessToken: string): string {
  const proof = Buffer.from(
    JSON.stringify({
      access_token: accessToken,
      matrix_server_name: TEST_MATRIX_SERVER,
    }),
  ).toString('base64url');
  return `matrix-openid:${proof}`;
}

function openIdAuthorization(username: string, accessToken: string): string {
  return `Basic ${Buffer.from(
    `${username}:${openIdPassword(accessToken)}`,
    'utf8',
  ).toString('base64')}`;
}

async function seedCollection(
  port: number,
  path: string,
  openId: string,
  event: Buffer,
  components: readonly string[] = ['VEVENT'],
): Promise<void> {
  const owner = path.split('/')[1];
  const authorization = `Basic ${Buffer.from(`${owner}:${openId}`).toString('base64')}`;
  const created = await requestRadicale(
    port,
    'MKCALENDAR',
    path,
    mkCalendar(components),
    authorization,
    { 'Content-Type': 'application/xml; charset=utf-8' },
  );
  expect([201, 207]).toContain(created.status);
  const written = await requestRadicale(
    port,
    'PUT',
    `${path}event.ics`,
    event,
    authorization,
    { 'Content-Type': 'text/calendar' },
  );
  expect([201, 204]).toContain(written.status);
}

async function requestRadicale(
  port: number,
  method: string,
  path: string,
  body: Buffer,
  authorization?: string,
  extraHeaders: Record<string, string> = {},
): Promise<ResponseBody> {
  const headers = new Headers(extraHeaders);
  if (authorization) headers.set('Authorization', authorization);
  const response = await contractFetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers,
    body,
    signal: AbortSignal.timeout(5_000),
  });
  return {
    status: response.status,
    headers: response.headers,
    body: Buffer.from(await response.arrayBuffer()),
  };
}

async function requestGatewayHttps(
  port: number,
  path: string,
  method: string,
  caFile: string,
  body: Buffer<ArrayBufferLike> = Buffer.alloc(0),
  authorization?: string,
  extraHeaders: Record<string, string> = {},
): Promise<ResponseBody> {
  const headers = new Headers(extraHeaders);
  if (authorization) headers.set('Authorization', authorization);
  if (body.byteLength > 0 && !headers.has('Content-Length')) {
    headers.set('Content-Length', String(body.byteLength));
  }
  return await new Promise<ResponseBody>((resolve, reject) => {
    const request = createHttpsRequest(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: Object.fromEntries(headers.entries()),
        ca: readFileSync(caFile),
        servername: 'localhost',
        rejectUnauthorized: true,
        timeout: 5_000,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.byteLength;
          if (size > 1024 * 1024) {
            request.destroy(new Error('gateway contract response too large'));
            return;
          }
          chunks.push(Buffer.from(chunk));
        });
        response.once('error', reject);
        response.once('end', () => {
          const responseHeaders = new Headers();
          for (const [name, value] of Object.entries(response.headers)) {
            if (typeof value === 'string') responseHeaders.set(name, value);
            else if (Array.isArray(value)) {
              for (const item of value) responseHeaders.append(name, item);
            }
          }
          resolve({
            status: response.statusCode ?? 502,
            headers: responseHeaders,
            body: Buffer.concat(chunks),
          });
        });
      },
    );
    request.once('error', reject);
    if (body.byteLength > 0) request.write(body);
    request.end();
  });
}

async function createContractCertificates(temp: string): Promise<{
  caCert: string;
  serverKey: string;
  serverCert: string;
}> {
  const caKey = join(temp, 'contract-ca.key');
  const caCert = join(temp, 'contract-ca.pem');
  const serverKey = join(temp, 'server.key');
  const serverCsr = join(temp, 'server.csr');
  const serverCert = join(temp, 'server.pem');
  const extensions = join(temp, 'server.ext');
  writeFileSync(
    extensions,
    'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:localhost\n',
    { mode: 0o600 },
  );
  await execFileAsync('openssl', [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    caKey,
    '-out',
    caCert,
    '-days',
    '1',
    '-subj',
    '/CN=MCW private-client contract CA',
    '-addext',
    'basicConstraints=critical,CA:TRUE',
    '-addext',
    'keyUsage=critical,keyCertSign,cRLSign',
  ]);
  await execFileAsync('openssl', [
    'req',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    serverKey,
    '-out',
    serverCsr,
    '-subj',
    '/CN=localhost',
  ]);
  await execFileAsync('openssl', [
    'x509',
    '-req',
    '-in',
    serverCsr,
    '-CA',
    caCert,
    '-CAkey',
    caKey,
    '-CAcreateserial',
    '-out',
    serverCert,
    '-days',
    '1',
    '-sha256',
    '-extfile',
    extensions,
  ]);
  chmodSync(caKey, 0o600);
  chmodSync(serverKey, 0o600);
  return { caCert, serverKey, serverCert };
}

async function availablePort(): Promise<number> {
  const server = createHttpServer();
  await listen(server);
  const port = portOf(server);
  await closeServer(server);
  return port;
}

function listen(
  server:
    | ReturnType<typeof createHttpServer>
    | ReturnType<typeof createHttpsServer>,
  host = '127.0.0.1',
  port = 0,
): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
}

function portOf(
  server:
    | ReturnType<typeof createHttpServer>
    | ReturnType<typeof createHttpsServer>,
): number {
  const address = server.address() as AddressInfo | null;
  if (!address || typeof address === 'string') {
    throw new Error('contract server did not bind an ephemeral TCP port');
  }
  return address.port;
}

function closeServer(
  server:
    | ReturnType<typeof createHttpServer>
    | ReturnType<typeof createHttpsServer>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function waitForRadicale(
  child: ReturnType<typeof spawn>,
  port: number,
  logPath: string,
): Promise<void> {
  const deadline = Date.now() + 10_000;
  let lastProbe = 'no HTTP response';
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Radicale exited before readiness (${child.exitCode})`);
    }
    try {
      const response = await contractFetch(`http://127.0.0.1:${port}/`, {
        signal: AbortSignal.timeout(500),
      });
      if (response.status < 500) return;
      lastProbe = `HTTP ${response.status}`;
    } catch (error) {
      lastProbe =
        error instanceof Error ? error.message : 'unknown network error';
      await delay(100);
    }
  }
  const logs = readFileSync(logPath, 'utf8').slice(-3000);
  throw new Error(
    `Radicale readiness exceeded 10 seconds (${lastProbe}): ${logs}`,
  );
}

/** Use Node's real HTTP transport instead of the Jest fetch mock. */
const contractFetch: typeof fetch = (async (
  input: string | URL | globalThis.Request,
  init?: RequestInit,
): Promise<globalThis.Response> => {
  const requestUrl =
    input instanceof globalThis.Request
      ? new URL(input.url)
      : input instanceof URL
        ? input
        : new URL(input);
  if (requestUrl.protocol !== 'http:') {
    throw new Error('contract upstream must use loopback HTTP');
  }
  const headers = new Headers(init?.headers);
  const method = init?.method ?? 'GET';
  const bodyValue = init?.body;
  let body: Buffer | undefined;
  if (typeof bodyValue === 'string') body = Buffer.from(bodyValue);
  else if (Buffer.isBuffer(bodyValue)) body = bodyValue;
  else if (bodyValue instanceof Uint8Array) body = Buffer.from(bodyValue);
  else if (bodyValue !== undefined && bodyValue !== null) {
    throw new Error('unsupported contract request body');
  }
  if (body && !headers.has('content-length')) {
    headers.set('content-length', String(body.byteLength));
  }
  return await new Promise<globalThis.Response>((resolve, reject) => {
    const request = createHttpRequest(
      requestUrl,
      { method, headers: Object.fromEntries(headers.entries()) },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
        response.once('error', reject);
        response.once('end', () => {
          const responseBody = Buffer.concat(chunks);
          const responseHeaders = new Headers();
          for (const [name, value] of Object.entries(response.headers)) {
            if (typeof value === 'string') responseHeaders.set(name, value);
            else if (Array.isArray(value)) {
              for (const item of value) responseHeaders.append(name, item);
            }
          }
          resolve(
            contractResponse(
              response.statusCode ?? 502,
              responseHeaders,
              responseBody,
            ),
          );
        });
      },
    );
    request.once('error', reject);
    const signal = init?.signal;
    if (signal?.aborted) {
      request.destroy(new Error('contract request aborted'));
      return;
    }
    signal?.addEventListener(
      'abort',
      () => request.destroy(new Error('contract request aborted')),
      { once: true },
    );
    if (body) request.write(body);
    request.end();
  });
}) as typeof fetch;

function contractResponse(
  status: number,
  headers: Headers,
  bytes: Buffer,
): globalThis.Response {
  const responseBytes = Buffer.from(bytes);
  const noBody = status === 204 || status === 304;
  const body = noBody
    ? null
    : new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(responseBytes);
          controller.close();
        },
      });
  const response = {
    status,
    statusText: '',
    headers,
    body,
    ok: status >= 200 && status < 300,
    redirected: false,
    type: 'basic',
    url: '',
    bodyUsed: false,
    arrayBuffer: async () =>
      responseBytes.buffer.slice(
        responseBytes.byteOffset,
        responseBytes.byteOffset + responseBytes.byteLength,
      ),
    text: async () => responseBytes.toString('utf8'),
    json: async () => JSON.parse(responseBytes.toString('utf8')) as unknown,
    clone: () => contractResponse(status, new Headers(headers), responseBytes),
  };
  return response as unknown as globalThis.Response;
}

async function waitForChild(
  child: ReturnType<typeof spawn>,
  timeoutMs: number,
): Promise<number | null> {
  if (child.exitCode !== null) return child.exitCode;
  const exited = once(child, 'exit').then(
    (values) => values[0] as number | null,
  );
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  const result = await Promise.race([exited, timedOut]);
  if (timer) clearTimeout(timer);
  if (result === null) {
    child.kill('SIGTERM');
    const stopped = await Promise.race([
      once(child, 'exit').then((values) => values[0] as number | null),
      delay(3_000).then(() => null),
    ]);
    if (stopped === null) child.kill('SIGKILL');
    throw new Error(`private CalDAV contract exceeded ${timeoutMs}ms`);
  }
  return result;
}

async function stopChild(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  const stopped = await Promise.race([
    once(child, 'exit').then(() => true),
    delay(3_000).then(() => false),
  ]);
  if (!stopped) {
    child.kill('SIGKILL');
    await Promise.race([once(child, 'exit'), delay(3_000)]);
  }
}

async function handleControlRequest(
  request: import('node:http').IncomingMessage,
  response: import('node:http').ServerResponse,
  controlKey: string,
  updatePolicy: (change: { member?: boolean; manager?: boolean }) => void,
  revokePersonal: () => Promise<void>,
): Promise<void> {
  try {
    if (
      request.method !== 'POST' ||
      !['/policy', '/revoke-personal'].includes(request.url ?? '') ||
      !hasControlKey(request.headers[CONTROL_HEADER], controlKey)
    ) {
      response.writeHead(404).end();
      return;
    }
    const bytes = await readBoundedRequest(request, 1024);
    if (!bytes) {
      response.writeHead(413).end();
      return;
    }
    if (request.url === '/revoke-personal') {
      await revokePersonal();
      response.writeHead(204).end();
      return;
    }
    const parsed: unknown = JSON.parse(bytes.toString('utf8'));
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed) ||
      Object.keys(parsed).some((key) => !['member', 'manager'].includes(key))
    ) {
      response.writeHead(400).end();
      return;
    }
    const change = parsed as { member?: unknown; manager?: unknown };
    if (
      (change.member !== undefined && typeof change.member !== 'boolean') ||
      (change.manager !== undefined && typeof change.manager !== 'boolean')
    ) {
      response.writeHead(400).end();
      return;
    }
    updatePolicy({
      ...(typeof change.member === 'boolean' ? { member: change.member } : {}),
      ...(typeof change.manager === 'boolean'
        ? { manager: change.manager }
        : {}),
    });
    response.writeHead(204).end();
  } catch {
    response.writeHead(400).end();
  }
}

function hasControlKey(
  supplied: string | string[] | undefined,
  expected: string,
): boolean {
  if (typeof supplied !== 'string') return false;
  const actualBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expected);
  return (
    actualBytes.byteLength === expectedBytes.byteLength &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
}

async function readBoundedRequest(
  request: import('node:http').IncomingMessage,
  maxBytes: number,
): Promise<Buffer | undefined> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const value of request) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    size += chunk.byteLength;
    if (size > maxBytes) return undefined;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
