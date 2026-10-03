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

import { ServiceUnavailableException } from '@nestjs/common';
import fetch from 'jest-fetch-mock';
import { IAppConfiguration } from '../IAppConfiguration';
import {
  RoomCalendarCalDavAccess,
  RoomCalendarTarget,
} from './RoomCalendarCalDavAccess';

const roomId = '!team:example.test';
const calendarId = 'team-calendar';
const applicationServiceUserId = '@matrix_calendar_service:example.test';
const target: RoomCalendarTarget = {
  roomId,
  calendarId,
  principal: { kind: 'service' },
};

function configuration(
  overrides: Partial<IAppConfiguration> = {},
): IAppConfiguration {
  return {
    homeserver_url: 'https://matrix.example.test/',
    radicale_url: 'https://radicale.example.test/caldav/',
    room_calendar_bindings: [{ roomId, calendarId }],
    room_calendar_access_enabled: true,
    room_calendar_event_writes_enabled: false,
    application_service_token: 'synthetic-test-as-token',
    application_service_user_id: applicationServiceUserId,
    ...overrides,
  } as IAppConfiguration;
}

describe('RoomCalendarCalDavAccess', () => {
  beforeEach(() => {
    fetch.resetMocks();
    fetch.enableMocks();
  });

  it('requests a transient proof for the configured principal and exact binding', async () => {
    fetch.mockResponseOnce(
      JSON.stringify({
        access_token: 'synthetic-test-openid-proof',
        matrix_server_name: 'example.test',
        expires_in: 3600,
      }),
      { status: 200 },
    );
    const access = new RoomCalendarCalDavAccess(configuration());

    await expect(access.forAuthorizedTarget(target, 'read')).resolves.toEqual({
      userId: applicationServiceUserId,
      calendarUrl:
        'https://radicale.example.test/caldav/matrix_calendar_service/team-calendar/',
      credential: {
        accessToken: 'synthetic-test-openid-proof',
        matrixServerName: 'example.test',
      },
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe(
      'https://matrix.example.test/_matrix/client/v3/user/%40matrix_calendar_service%3Aexample.test/openid/request_token',
    );
    expect(fetch.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      headers: {
        Authorization: 'Bearer synthetic-test-as-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ user_id: applicationServiceUserId }),
      redirect: 'error',
    });
  });

  it('never mints a proof when the access feature is disabled', async () => {
    const access = new RoomCalendarCalDavAccess(
      configuration({ room_calendar_access_enabled: false }),
    );

    await expect(
      access.forAuthorizedTarget(target, 'read'),
    ).rejects.toMatchObject({
      response: { code: 'room-calendar-caldav-disabled' },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('propagates an already-aborted caller signal without proof I/O', async () => {
    const access = new RoomCalendarCalDavAccess(configuration());
    const controller = new AbortController();
    controller.abort();

    await expect(
      access.forAuthorizedTarget(target, 'read', controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('passes the caller signal to the homeserver proof request', async () => {
    fetch.mockResponseOnce(
      JSON.stringify({
        access_token: 'synthetic-test-openid-proof',
        matrix_server_name: 'example.test',
      }),
      { status: 200 },
    );
    const access = new RoomCalendarCalDavAccess(configuration());
    const controller = new AbortController();

    await access.forAuthorizedTarget(target, 'read', controller.signal);

    expect(fetch.mock.calls[0][1]?.signal).not.toBeUndefined();
    expect(fetch.mock.calls[0][1]?.signal?.aborted).toBe(false);
  });

  it('never mints a proof for writes when the separate write gate is disabled', async () => {
    const access = new RoomCalendarCalDavAccess(
      configuration({
        room_calendar_access_enabled: true,
        room_calendar_event_writes_enabled: false,
      }),
    );

    await expect(
      access.forAuthorizedTarget(target, 'write'),
    ).rejects.toMatchObject({
      response: { code: 'room-calendar-caldav-disabled' },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not let the write gate bypass the general room-access gate', async () => {
    const access = new RoomCalendarCalDavAccess(
      configuration({
        room_calendar_access_enabled: false,
        room_calendar_event_writes_enabled: true,
      }),
    );

    await expect(
      access.forAuthorizedTarget(target, 'write'),
    ).rejects.toMatchObject({
      response: { code: 'room-calendar-caldav-disabled' },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['.', '..', 'a/b', 'a\\b', 'a%2Fb', 'a space'])(
    'rejects unsafe configured home segment %s before proof I/O',
    async (localpart) => {
      const access = new RoomCalendarCalDavAccess(
        configuration({
          application_service_user_id: `@${localpart}:example.test`,
        }),
      );
      await expect(
        access.forAuthorizedTarget(target, 'read'),
      ).rejects.toMatchObject({
        response: { code: 'room-calendar-caldav-disabled' },
      });
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it('rejects a changed or unbound target before requesting a proof', async () => {
    const access = new RoomCalendarCalDavAccess(configuration());

    await expect(
      access.forAuthorizedTarget(
        { ...target, calendarId: 'another-calendar' },
        'read',
      ),
    ).rejects.toMatchObject({
      response: { code: 'room-calendar-caldav-disabled' },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fails closed when the homeserver cannot mint the configured proof', async () => {
    fetch.mockResponseOnce('unavailable', { status: 503 });
    const access = new RoomCalendarCalDavAccess(configuration());

    await expect(
      access.forAuthorizedTarget(target, 'read'),
    ).rejects.toMatchObject({
      response: { code: 'room-calendar-authorization-unavailable' },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects a proof whose homeserver does not match the configured principal', async () => {
    fetch.mockResponseOnce(
      JSON.stringify({
        access_token: 'untrusted-openid-proof',
        matrix_server_name: 'different.example.test',
      }),
      { status: 200 },
    );
    const access = new RoomCalendarCalDavAccess(configuration());

    await expect(
      access.forAuthorizedTarget(target, 'read'),
    ).rejects.toMatchObject({
      response: { code: 'room-calendar-authorization-unavailable' },
    });
  });

  it('does not expose the application-service token in an error', async () => {
    fetch.mockResponseOnce('unavailable', { status: 503 });
    const access = new RoomCalendarCalDavAccess(configuration());

    try {
      await access.forAuthorizedTarget(target, 'read');
      throw new Error('expected authorization failure');
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect(JSON.stringify(error)).not.toContain('synthetic-test-as-token');
    }
  });
});
