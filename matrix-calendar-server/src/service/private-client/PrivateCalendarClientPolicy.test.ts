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

import type { MatrixClient } from 'matrix-bot-sdk';
import { createHash } from 'node:crypto';
import { IAppConfiguration } from '../../IAppConfiguration';
import {
  PrivateCalendarClientRecord,
  PrivateCalendarClientStore,
} from '../../model/IPrivateCalendarClientStore';
import { MatrixCalendarAuthorizationFactory } from '../MatrixCalendarAuthorization';
import { RoomCalendarCalDavAccess } from '../RoomCalendarCalDavAccess';
import { privateCalendarClientSecretVerifier } from './PrivateCalendarClientCredentials';
import { PrivateCalendarClientPolicy } from './PrivateCalendarClientPolicy';

const APP_ID = 'mcwpc~0123456789abcdef0123456789abcdef0123456789abcdef';
const SECRET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq';
const EPOCH = Buffer.alloc(32, 21);
const NOW = new Date('2026-10-21T12:00:00.000Z');

describe('private CalDAV credential and Matrix policy', () => {
  let record: PrivateCalendarClientRecord;
  let store: {
    enabled: boolean;
    getByAppId: jest.Mock;
    revoke: jest.Mock;
  };
  let matrixClient: { getJoinedRoomMembers: jest.Mock };
  let authorizationFactory: { canManageCalendars: jest.Mock };
  let roomCalendarCalDavAccess: { forAuthorizedTarget: jest.Mock };
  let appConfig: IAppConfiguration;
  let policy: PrivateCalendarClientPolicy;

  beforeEach(() => {
    record = activeRecord('personal', '/alice/personal/');
    store = {
      enabled: true,
      getByAppId: jest.fn().mockImplementation(async () => record),
      revoke: jest.fn().mockImplementation(async () => {
        record = { ...record, state: 'revoked', secretVerifier: undefined };
        return record;
      }),
    };
    matrixClient = {
      getJoinedRoomMembers: jest
        .fn()
        .mockResolvedValue(['@alice:example.test']),
    };
    authorizationFactory = {
      canManageCalendars: jest.fn().mockResolvedValue(true),
    };
    roomCalendarCalDavAccess = {
      forAuthorizedTarget: jest.fn().mockResolvedValue({
        calendarUrl: 'http://radicale.internal/calendarbot/room-team/',
      }),
    };
    appConfig = {
      private_calendar_clients_enabled: true,
      private_calendar_client_epoch_key: EPOCH,
      private_calendar_client_callback_key: Buffer.alloc(32, 22),
    } as IAppConfiguration;
    policy = new PrivateCalendarClientPolicy(
      appConfig,
      store as unknown as PrivateCalendarClientStore,
      authorizationFactory as unknown as MatrixCalendarAuthorizationFactory,
      matrixClient as unknown as MatrixClient,
      roomCalendarCalDavAccess as unknown as RoomCalendarCalDavAccess,
      () => NOW,
    );
  });

  it('authenticates only the scoped app secret in the active epoch', async () => {
    expect(await policy.authenticate(APP_ID, SECRET)).toBe(true);
    expect(await policy.authenticate(APP_ID, `${SECRET}x`)).toBe(false);
    expect(await policy.authenticate(`${APP_ID}x`, SECRET)).toBe(false);
    expect(await policy.authenticate(APP_ID, SECRET)).toBe(true);
    expect(store.getByAppId).toHaveBeenCalledTimes(2);
    expect(matrixClient.getJoinedRoomMembers).not.toHaveBeenCalled();
  });

  it('scopes Radicale rights to the one alias and its exact canonical collection', async () => {
    expect(await policy.rights(APP_ID, `/${APP_ID}/`)).toBe('r');
    expect(await policy.rights(APP_ID, `/${APP_ID}/calendar/`)).toBe('r');
    expect(await policy.rights(APP_ID, `/${APP_ID}/calendar/event.ics`)).toBe(
      'rw',
    );
    expect(await policy.rights(APP_ID, '/alice/personal/')).toBe('rw');
    expect(await policy.rights(APP_ID, '/alice/personal/event.ics')).toBe('rw');
    for (const path of [
      '/alice/other/event.ics',
      '/calendarbot/room-team/event.ics',
      `/${APP_ID}/other/event.ics`,
      `/${APP_ID}/calendar/%2e%2e/other.ics`,
      '/alice/personal/other/nested.ics',
      '/alice/personal/event.ics?leak=1',
    ]) {
      expect(await policy.rights(APP_ID, path)).toBe('');
    }
  });

  it('tombstones a leave observed by a request and does not revive it after rejoin', async () => {
    record = activeRecord('room', '/calendarbot/room-team/');
    matrixClient.getJoinedRoomMembers.mockResolvedValueOnce([]);

    expect(await policy.authorizeDavRequest(APP_ID, 'GET', 'resource')).toBe(
      false,
    );
    expect(record.state).toBe('revoked');
    expect(store.revoke).toHaveBeenCalledWith(APP_ID, NOW);

    expect(await policy.authorizeDavRequest(APP_ID, 'GET', 'resource')).toBe(
      false,
    );
    expect(matrixClient.getJoinedRoomMembers).toHaveBeenCalledTimes(1);
    expect(store.revoke).toHaveBeenCalledTimes(1);
  });

  it('rechecks room membership, current binding, and manager power for every request', async () => {
    record = activeRecord('room', '/calendarbot/room-team/');
    expect(await policy.authorizeDavRequest(APP_ID, 'PUT', 'resource')).toBe(
      true,
    );
    expect(matrixClient.getJoinedRoomMembers).toHaveBeenCalledTimes(1);
    expect(authorizationFactory.canManageCalendars).toHaveBeenCalledWith(
      '@alice:example.test',
      '!room:example.test',
    );
    expect(roomCalendarCalDavAccess.forAuthorizedTarget).toHaveBeenCalledWith(
      {
        roomId: '!room:example.test',
        calendarId: 'room-team',
        principal: { kind: 'service' },
      },
      'read',
    );

    authorizationFactory.canManageCalendars.mockResolvedValueOnce(false);
    expect(await policy.authorizeDavRequest(APP_ID, 'PUT', 'resource')).toBe(
      false,
    );
    expect(await policy.authorizeDavRequest(APP_ID, 'GET', 'resource')).toBe(
      true,
    );
    expect(matrixClient.getJoinedRoomMembers).toHaveBeenCalledTimes(3);

    matrixClient.getJoinedRoomMembers.mockResolvedValueOnce([]);
    expect(
      await policy.rights(APP_ID, '/calendarbot/room-team/event.ics'),
    ).toBe('');
    expect(store.revoke).toHaveBeenCalledWith(APP_ID, NOW);
    expect(
      await policy.rights(APP_ID, '/calendarbot/room-team/event.ics'),
    ).toBe('');
  });

  it('denies a room alias after its current binding points elsewhere', async () => {
    record = activeRecord('room', '/calendarbot/room-team/');
    roomCalendarCalDavAccess.forAuthorizedTarget.mockResolvedValue({
      calendarUrl: 'http://radicale.internal/calendarbot/reassigned/',
    });

    expect(
      await policy.rights(APP_ID, '/calendarbot/room-team/event.ics'),
    ).toBe('');
    expect(await policy.authorizeDavRequest(APP_ID, 'GET', 'resource')).toBe(
      false,
    );
  });

  function activeRecord(
    target: 'personal' | 'room',
    canonicalPath: string,
  ): PrivateCalendarClientRecord {
    const createdAt = new Date(NOW.getTime() - 60_000);
    return {
      appId: APP_ID,
      createdBy: '@alice:example.test',
      target:
        target === 'room'
          ? {
              target: 'room',
              roomId: '!room:example.test',
              calendarId: 'room-team',
            }
          : { target: 'personal', calendarId: 'personal' },
      canonicalPath,
      secretVerifier: privateCalendarClientSecretVerifier(APP_ID, SECRET),
      credentialEpochHash: createHash('sha256').update(EPOCH).digest('hex'),
      state: 'active',
      mapState: 'present',
      createdAt,
      expiresAt: new Date(NOW.getTime() + 60_000),
    };
  }
});
