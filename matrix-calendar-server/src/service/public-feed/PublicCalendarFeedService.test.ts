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

import { ConflictException } from '@nestjs/common';
import { IAppConfiguration } from '../../IAppConfiguration';
import { MatrixOpenIdCalDavCredentialProviderFactory } from '../../caldav/MatrixOpenIdCalDavCredentialProviderFactory';
import { IMatrixOpenIdCredential } from '../../model/IMatrixOpenIdCredential';
import { IUserContext } from '../../model/IUserContext';
import { MatrixCalendarAuthorizationFactory } from '../MatrixCalendarAuthorization';
import { RoomCalendarCalDavAccess } from '../RoomCalendarCalDavAccess';
import { PublicCalendarFeedService } from './PublicCalendarFeedService';
import { RadicaleNativeTokenShare } from './RadicalePublicFeedClient';

jest.mock('../../caldav/MatrixOpenIdCalDavCredentialProvider', () => ({
  MatrixOpenIdCalDavCredentialError: class MatrixOpenIdCalDavCredentialError extends Error {},
}));

const CALENDAR_URL = 'https://radicale.example.test/alice/team/';
const PUBLIC_ORIGIN = 'https://feeds.example.test';
const OWNER: IUserContext = {
  userId: '@alice:example.test',
  locale: 'en',
  timezone: 'Europe/Stockholm',
};
const OPENID_CREDENTIAL: IMatrixOpenIdCredential = {
  accessToken: 'synthetic-openid-token',
  matrixServerName: 'example.test',
};
const VEVENT_FEED = Buffer.from(
  'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:synthetic\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n',
);
const MIXED_FEED = Buffer.from(
  'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:event\r\nEND:VEVENT\r\nBEGIN:VTODO\r\nUID:task\r\nEND:VTODO\r\nEND:VCALENDAR\r\n',
);

describe('PublicCalendarFeedService', () => {
  it.each(['%1F', '%7F'])(
    'rejects personal calendar path segments containing encoded control character %s',
    async (encodedControl) => {
      const fixture = createFixture();

      await expect(
        fixture.service.publish(
          OWNER,
          OPENID_CREDENTIAL,
          {
            target: 'personal',
            calendarId: `https://radicale.example.test/alice/team${encodedControl}/`,
          },
          true,
        ),
      ).rejects.toMatchObject({ status: 400 });
      expect(fixture.calls).toHaveLength(0);
    },
  );

  it('creates one native read-only publication and returns only the external signed URL', async () => {
    const fixture = createFixture();
    const result = await fixture.service.publish(
      OWNER,
      OPENID_CREDENTIAL,
      { target: 'personal', calendarId: CALENDAR_URL },
      true,
    );

    expect(result).toEqual({
      enabled: true,
      published: true,
      url: expect.stringMatching(
        /^https:\/\/feeds\.example\.test\/v1\/public-calendar-feeds\//u,
      ),
    });
    expect(result.url).not.toContain('radicale.example.test');
    const createCall = fixture.calls.find(
      (call) => call.path === '/.sharing/v1/token/create',
    );
    expect(createCall?.body).toMatchObject({
      PathMapped: '/alice/team/',
      Permissions: 'r',
      Conversion: 'none',
      Enabled: true,
      Hidden: false,
    });
    expect(fixture.shares).toHaveLength(1);

    const state = await fixture.service.getPublication(
      OWNER,
      OPENID_CREDENTIAL,
      { target: 'personal', calendarId: CALENDAR_URL },
    );
    expect(state).toEqual(result);
  });

  it('serializes concurrent publishes for one target and leaves foreign shares untouched', async () => {
    const fixture = createFixture();
    fixture.shares.push({
      PathOrToken: tokenPath('Z'),
      PathMapped: '/alice/team/',
      Permissions: 'rw',
      Conversion: 'none',
      EnabledByOwner: true,
      Properties: { 'D:displayname': "another owner's share" },
    });

    const target = { target: 'personal' as const, calendarId: CALENDAR_URL };
    const [first, second] = await Promise.all([
      fixture.service.publish(OWNER, OPENID_CREDENTIAL, target, true),
      fixture.service.publish(OWNER, OPENID_CREDENTIAL, target, true),
    ]);

    expect(first.url).toBe(second.url);
    expect(
      fixture.calls.filter((call) => call.path === '/.sharing/v1/token/create'),
    ).toHaveLength(1);
    expect(fixture.shares.map((share) => share.PathOrToken)).toEqual([
      tokenPath('Z'),
      tokenPath('A'),
    ]);
  });

  it('cleans up a new share when an unsupported component is present', async () => {
    const fixture = createFixture({ feed: MIXED_FEED });

    await expect(
      fixture.service.publish(
        OWNER,
        OPENID_CREDENTIAL,
        { target: 'personal', calendarId: CALENDAR_URL },
        true,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(fixture.shares).toHaveLength(0);
    expect(
      fixture.calls.some((call) => call.path === '/.sharing/v1/token/delete'),
    ).toBe(true);
  });

  it('reconciles an exact marked share when create commits but its response is lost', async () => {
    const fixture = createFixture({ loseCreateResponse: true });
    const foreignShare: RadicaleNativeTokenShare = {
      PathOrToken: tokenPath('Z'),
      PathMapped: '/alice/team/',
      Permissions: 'r',
      Conversion: 'none',
      EnabledByOwner: true,
      Properties: { 'D:displayname': 'another native share' },
    };
    fixture.shares.push(foreignShare);

    await expect(
      fixture.service.publish(
        OWNER,
        OPENID_CREDENTIAL,
        { target: 'personal', calendarId: CALENDAR_URL },
        true,
      ),
    ).rejects.toMatchObject({ status: 503 });

    expect(fixture.shares).toEqual([foreignShare]);
    const deleteCalls = fixture.calls.filter(
      (call) => call.path === '/.sharing/v1/token/delete',
    );
    expect(deleteCalls.map((call) => call.body?.PathOrToken)).toEqual([
      tokenPath('A'),
    ]);
  });

  it('requires current room-manager authorization and removes only marked shares on unpublish', async () => {
    const fixture = createFixture({ roomMode: true });
    const roomTarget = {
      target: 'room' as const,
      roomId: '!synthetic:example.test',
      calendarId: 'team-calendar',
    };
    const published = await fixture.service.publish(
      OWNER,
      undefined,
      roomTarget,
      true,
    );
    expect(published.published).toBe(true);
    expect(fixture.roomAuthorizationCalls).toBe(2);

    fixture.roomAuthorizationAllowed = false;
    await expect(
      fixture.service.unpublish(OWNER, undefined, roomTarget),
    ).rejects.toMatchObject({ status: 403 });
    expect(fixture.shares).toHaveLength(1);

    fixture.roomAuthorizationAllowed = true;
    await fixture.service.unpublish(OWNER, undefined, roomTarget);
    expect(fixture.shares).toHaveLength(0);
  });
});

function createFixture(
  options: {
    feed?: Buffer;
    roomMode?: boolean;
    loseCreateResponse?: boolean;
  } = {},
) {
  const key = Buffer.alloc(32, 0x5a);
  const appConfig = {
    radicale_url: 'https://radicale.example.test',
    public_calendar_feed_origin: PUBLIC_ORIGIN,
    public_calendar_feed_signing_key: key,
    public_calendar_feed_enabled: true,
    room_calendar_access_enabled: true,
    room_calendar_event_writes_enabled: false,
  } as unknown as IAppConfiguration;
  const credentials = {
    getRequestHeaders: jest.fn().mockResolvedValue({
      Authorization: 'Basic synthetic-owner-proof',
    }),
  };
  const credentialProviderFactory = {
    forRequest: jest.fn(() => credentials),
    forPrincipal: jest.fn(() => credentials),
  } as unknown as MatrixOpenIdCalDavCredentialProviderFactory;
  let roomAuthorizationAllowed = true;
  let roomAuthorizationCalls = 0;
  const authorizationFactory = {
    forRoom: jest.fn(() => ({
      isAllowed: jest.fn(async () => {
        roomAuthorizationCalls += 1;
        return roomAuthorizationAllowed;
      }),
    })),
  } as unknown as MatrixCalendarAuthorizationFactory;
  const roomCalendarCalDavAccess = {
    forAuthorizedTarget: jest.fn(async () => ({
      userId: '@calendarbot:example.test',
      calendarUrl: options.roomMode
        ? 'https://radicale.example.test/calendarbot/team-calendar/'
        : CALENDAR_URL,
      credential: OPENID_CREDENTIAL,
      identity: { mode: 'appservice', userId: '@calendarbot:example.test' },
    })),
  } as unknown as RoomCalendarCalDavAccess;
  const shares: RadicaleNativeTokenShare[] = [];
  const calls: Array<{
    path: string;
    method: string;
    body?: Record<string, unknown>;
    authorization?: string;
  }> = [];
  let tokenSequence = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(input.toString());
    const method = init?.method ?? 'GET';
    const authorization =
      new Headers(init?.headers).get('Authorization') ?? undefined;
    const body =
      typeof init?.body === 'string'
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : undefined;
    calls.push({ path: url.pathname, method, body, authorization });

    if (url.pathname === '/.sharing/v1/token/list') {
      return jsonResponse({
        Status: 'success',
        Content: shares.filter(
          (share) => share.PathMapped === body?.PathMapped,
        ),
      });
    }
    if (url.pathname === '/.sharing/v1/token/create') {
      tokenSequence += 1;
      const token = tokenSequence === 1 ? 'A' : 'B';
      const PathOrToken = tokenPath(token);
      shares.push({
        PathOrToken,
        PathMapped: String(body?.PathMapped),
        Permissions: String(body?.Permissions),
        Conversion: String(body?.Conversion),
        EnabledByOwner: body?.Enabled === true,
        Properties: body?.Properties as Record<string, string>,
      });
      if (options.loseCreateResponse) {
        throw new Error('Synthetic response lost after Radicale committed');
      }
      return jsonResponse({ Status: 'success', PathOrToken });
    }
    if (url.pathname === '/.sharing/v1/token/delete') {
      const index = shares.findIndex(
        (share) => share.PathOrToken === body?.PathOrToken,
      );
      if (index >= 0) shares.splice(index, 1);
      return jsonResponse({ Status: 'success' });
    }
    if (url.pathname.startsWith('/.token/v1/')) {
      return shares.some((share) => share.PathOrToken === url.pathname)
        ? new Response(options.feed ?? VEVENT_FEED, {
            headers: { 'Content-Type': 'text/calendar; charset=utf-8' },
          })
        : new Response(null, { status: 404 });
    }
    return new Response(null, { status: 404 });
  };
  const service = new PublicCalendarFeedService(
    appConfig,
    authorizationFactory,
    credentialProviderFactory,
    roomCalendarCalDavAccess,
    fetchImpl,
  );

  return {
    service,
    shares,
    calls,
    authorizationFactory,
    roomCalendarCalDavAccess,
    get roomAuthorizationCalls() {
      return roomAuthorizationCalls;
    },
    get roomAuthorizationAllowed() {
      return roomAuthorizationAllowed;
    },
    set roomAuthorizationAllowed(value: boolean) {
      roomAuthorizationAllowed = value;
    },
  };
}

function tokenPath(letter: string): string {
  return `/.token/v1/${letter.repeat(44)}/`;
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { 'Content-Type': 'application/json' },
  });
}
