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

import { IAppConfiguration } from '../../IAppConfiguration';
import { IMatrixOpenIdCredential } from '../../model/IMatrixOpenIdCredential';
import {
  NewPrivateCalendarClientRecord,
  PrivateCalendarClientRecord,
  PrivateCalendarClientStore,
} from '../../model/IPrivateCalendarClientStore';
import { IUserContext } from '../../model/IUserContext';
import { PrivateCalendarClientService } from './PrivateCalendarClientService';

const USER_ID = '@alice:example.test';
const CALENDAR_URL = 'http://radicale.example.test/alice/personal/';
const APP_ID = `mcwpc~${'0'.repeat(48)}`;
const SECRET = Buffer.alloc(32).toString('base64url');
const NOW = new Date('2026-10-21T12:00:00.000Z');

const userContext: IUserContext = {
  userId: USER_ID,
  locale: 'en',
  timezone: 'UTC',
};
const openIdCredential: IMatrixOpenIdCredential = {
  accessToken: 'matrix-openid-proof',
  matrixServerName: 'example.test',
};

function configuration(
  overrides: Partial<IAppConfiguration> = {},
): IAppConfiguration {
  return {
    access_token: 'bot-token',
    homeserver_url: 'https://matrix.example.test',
    radicale_url: 'http://radicale.example.test/',
    private_calendar_clients_enabled: true,
    private_calendar_client_origin: 'https://api.example.test/',
    private_calendar_client_database_url:
      'postgresql://private-clients@db.example.test/calendar',
    private_calendar_client_epoch_key: Buffer.alloc(32, 1),
    private_calendar_client_callback_key: Buffer.alloc(32, 2),
    room_calendar_bindings: [],
    room_calendar_principal_mode: 'appservice',
    room_calendar_binding_database_tls_mode: 'verify-full',
    room_calendar_setup_enabled: false,
    room_calendar_setup_allowed_actor_server_names: [],
    room_calendar_access_enabled: true,
    room_calendar_event_writes_enabled: true,
    room_reminder_delivery_enabled: false,
    calendar_gateway_rate_limit_requests: 50,
    calendar_gateway_rate_limit_window_ms: 60_000,
    calendar_gateway_rate_limit_max_keys: 1000,
    room_reminder_configuration_enabled: false,
    room_calendar_action_messages_enabled: false,
    meetingwidget_url: 'https://widget.example.test',
    meetingwidget_name: 'Widget',
    breakout_session_widget_url: 'https://widget.example.test/breakout',
    breakout_session_widget_name: 'Breakout',
    meetingwidget_cockpit_url: 'https://widget.example.test/cockpit',
    meetingwidget_cockpit_name: 'Cockpit',
    auto_deletion_offset: undefined,
    matrix_link_share: 'https://matrix.example.test',
    data_path: '/tmp',
    data_filename: 'bot.json',
    enable_crypto: false,
    crypto_data_path: 'crypto',
    enable_welcome_workflow: false,
    enable_control_room_migration: false,
    enable_private_room_error_sending: false,
    default_events_config: '/tmp/events.json',
    default_widget_layouts_config: '/tmp/layouts.json',
    welcome_workflow_default_locale: 'en',
    matrix_server_event_max_age_minutes: 5,
    calendar_room_name: 'Calendar',
    matrix_filter_apply: true,
    matrix_filter_timeline_limit: 50,
    enable_guest_user_power_level_change: false,
    guest_user_prefix: '@guest-',
    guest_user_default_power_level: 0,
    guest_user_delete_power_level_on_leave: true,
    ...overrides,
  } as IAppConfiguration;
}

function createStore(): {
  store: PrivateCalendarClientStore;
  row: PrivateCalendarClientRecord | undefined;
  calls: { create: jest.Mock; activate: jest.Mock; revoke: jest.Mock };
} {
  let row: PrivateCalendarClientRecord | undefined;
  const calls = {
    create: jest.fn(),
    activate: jest.fn(),
    revoke: jest.fn(),
  };
  const store = {
    enabled: true,
    createPending: jest.fn(async (record: NewPrivateCalendarClientRecord) => {
      calls.create(record);
      row = { ...record, state: 'pending', mapState: 'pending' };
      return { kind: 'created' as const };
    }),
    getByAppId: jest.fn(async () => row),
    listForTarget: jest.fn(async () => (row ? [row] : [])),
    activate: jest.fn(async () => {
      calls.activate();
      if (!row) return undefined;
      row = { ...row, state: 'active', mapState: 'present' };
      return row;
    }),
    revoke: jest.fn(async () => {
      calls.revoke();
      if (!row) return undefined;
      row = {
        ...row,
        state: 'revoked',
        mapState: 'cleanup-pending',
        secretVerifier: undefined,
        revokedAt: NOW,
      };
      return row;
    }),
    markMapRemoved: jest.fn(async () => undefined),
  } as unknown as PrivateCalendarClientStore;
  return {
    store,
    get row() {
      return row;
    },
    calls,
  };
}

function mapRecord(accepted: boolean): Record<string, unknown> {
  return {
    ShareType: 'map',
    PathOrToken: `/${APP_ID}/calendar/`,
    PathMapped: '/alice/personal/',
    Owner: 'alice',
    User: APP_ID,
    Permissions: 'rw',
    Conversion: 'none',
    EnabledByOwner: true,
    EnabledByUser: accepted,
    HiddenByOwner: false,
    HiddenByUser: !accepted,
  };
}

function response(value: unknown): Response {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return {
    status: 200,
    headers: new Headers({
      'Content-Type': 'application/json',
      'Content-Length': String(bytes.byteLength),
    }),
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
  } as unknown as Response;
}

describe('PrivateCalendarClientService', () => {
  it('stores only a verifier and activates after owner map verification and client acceptance', async () => {
    const state = createStore();
    const { store, calls } = state;
    let accepted = false;
    const requests: Array<{
      path: string;
      authorization: string;
      body: string;
    }> = [];
    const fetchImpl = jest.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        const body = String(init?.body ?? '{}');
        const authorization =
          new Headers(init?.headers).get('Authorization') ?? '';
        requests.push({ path: url.pathname, authorization, body });
        if (url.pathname.endsWith('/map/list')) {
          return response(
            accepted
              ? { Status: 'success', Content: [mapRecord(true)] }
              : requests.some((request) => request.path.endsWith('/map/create'))
                ? { Status: 'success', Content: [mapRecord(false)] }
                : { Status: 'not-found', Content: [] },
          );
        }
        if (url.pathname.endsWith('/map/create')) {
          expect(authorization).toBe('Basic owner-proof');
          expect(JSON.parse(body)).toMatchObject({
            PathMapped: '/alice/personal/',
            PathOrToken: `/${APP_ID}/calendar/`,
            User: APP_ID,
            Permissions: 'rw',
            Conversion: 'none',
            Enabled: true,
            Hidden: false,
          });
          return response({ Status: 'success' });
        }
        if (
          url.pathname.endsWith('/map/enable') ||
          url.pathname.endsWith('/map/unhide')
        ) {
          expect(authorization).toContain('Basic ');
          if (url.pathname.endsWith('/map/unhide')) accepted = true;
          return response({ Status: 'success' });
        }
        throw new Error(`Unexpected map request ${url.pathname}`);
      },
    );
    const authorizationFactory = {
      canManageCalendars: jest.fn().mockResolvedValue(true),
    };
    const credentialProviderFactory = {
      forRequest: jest.fn().mockReturnValue({
        getRequestHeaders: async () => ({ Authorization: 'Basic owner-proof' }),
      }),
      forPrincipal: jest.fn(),
    };
    const service = new PrivateCalendarClientService(
      configuration(),
      authorizationFactory as never,
      credentialProviderFactory as never,
      {} as never,
      store,
      fetchImpl as typeof fetch,
      (size) => Buffer.alloc(size),
      () => new Date(NOW),
    );

    const created = await service.create(userContext, openIdCredential, {
      target: 'personal',
      calendarId: CALENDAR_URL,
    });

    expect(created.client.appId).toBe(APP_ID);
    expect(created.secret).toBe(SECRET);
    expect(created.calendarUrl).toBe(
      `https://api.example.test/${APP_ID}/calendar/`,
    );
    expect(calls.activate).toHaveBeenCalledTimes(1);
    expect(state.row).toMatchObject({ state: 'active', mapState: 'present' });
    expect(state.row).not.toHaveProperty('secret');
    expect(state.row?.secretVerifier).not.toBe(SECRET);
    expect(JSON.stringify(created.client)).not.toContain('secretVerifier');
    expect(requests.map(({ path }) => path)).toEqual([
      '/.sharing/v1/map/list',
      '/.sharing/v1/map/create',
      '/.sharing/v1/map/list',
      '/.sharing/v1/map/enable',
      '/.sharing/v1/map/unhide',
      '/.sharing/v1/map/list',
    ]);
  });

  it('rejects a non-owner personal target before any map operation', async () => {
    const { store, calls } = createStore();
    const fetchImpl = jest.fn();
    const service = new PrivateCalendarClientService(
      configuration(),
      { canManageCalendars: jest.fn().mockResolvedValue(false) } as never,
      { forRequest: jest.fn(), forPrincipal: jest.fn() } as never,
      {} as never,
      store,
      fetchImpl as typeof fetch,
    );

    await expect(
      service.create(
        { ...userContext, userId: '@mallory:example.test' },
        openIdCredential,
        { target: 'personal', calendarId: CALENDAR_URL },
      ),
    ).rejects.toMatchObject({
      status: 400,
      response: { code: 'private-calendar-client-target-invalid' },
    });
    expect(calls.create).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('checks current room-manager authorization before resolving the service principal', async () => {
    const { store, calls } = createStore();
    const fetchImpl = jest.fn();
    const roomAccess = {
      forAuthorizedTarget: jest.fn(),
    };
    const service = new PrivateCalendarClientService(
      configuration(),
      { canManageCalendars: jest.fn().mockResolvedValue(false) } as never,
      { forRequest: jest.fn(), forPrincipal: jest.fn() } as never,
      roomAccess as never,
      store,
      fetchImpl as typeof fetch,
    );

    await expect(
      service.list(userContext, openIdCredential, {
        target: 'room',
        roomId: '!room-id:example.test',
        calendarId: 'team-calendar',
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(roomAccess.forAuthorizedTarget).not.toHaveBeenCalled();
    expect(calls.create).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('persists revocation before best-effort native cleanup needs an owner credential', async () => {
    const state = createStore();
    const { store, calls } = state;
    await store.createPending({
      appId: APP_ID,
      createdBy: USER_ID,
      target: { target: 'personal', calendarId: CALENDAR_URL },
      canonicalPath: '/alice/personal/',
      secretVerifier: 'one-way-verifier',
      credentialEpochHash: 'epoch-hash',
      createdAt: NOW,
      expiresAt: new Date(NOW.getTime() + 60_000),
    });
    const forRequest = jest.fn(() => {
      expect(state.row?.state).toBe('revoked');
      throw new Error('owner credential unavailable');
    });
    const service = new PrivateCalendarClientService(
      configuration(),
      { canManageCalendars: jest.fn().mockResolvedValue(true) } as never,
      { forRequest, forPrincipal: jest.fn() } as never,
      {} as never,
      store,
      jest.fn() as typeof fetch,
    );

    const revoked = await service.revoke(userContext, undefined, APP_ID);

    expect(revoked.state).toBe('revoked');
    expect(revoked.mapState).toBe('cleanup-pending');
    expect(state.row?.secretVerifier).toBeUndefined();
    expect(calls.revoke).toHaveBeenCalledTimes(1);
    expect(forRequest).toHaveBeenCalledTimes(1);
  });

  it('keeps capability routes unavailable when the feature flag is omitted', async () => {
    const { store } = createStore();
    const service = new PrivateCalendarClientService(
      configuration({ private_calendar_clients_enabled: false }),
      { canManageCalendars: jest.fn() } as never,
      { forRequest: jest.fn(), forPrincipal: jest.fn() } as never,
      {} as never,
      store,
      jest.fn() as typeof fetch,
    );

    await expect(
      service.list(userContext, openIdCredential, {
        target: 'personal',
        calendarId: CALENDAR_URL,
      }),
    ).rejects.toMatchObject({
      status: 503,
      response: { code: 'private-calendar-clients-disabled' },
    });
  });
});
