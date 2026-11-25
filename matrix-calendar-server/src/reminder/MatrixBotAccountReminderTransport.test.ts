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

import type { RoomCalendarPrincipalIdentity } from '../service/RoomCalendarPrincipalIdentity';
import { MatrixReminderTransportError } from './MatrixAppServiceReminderTransport';
import { MatrixBotAccountReminderTransport } from './MatrixBotAccountReminderTransport';
import type { ReminderSchedulerRuntimeSource } from './RoomReminderScheduler';

const roomId = '!team:example.test';
const calendarId = 'team-calendar';
const botIdentity: RoomCalendarPrincipalIdentity = Object.freeze({
  mode: 'bot-account',
  userId: '@normal-bot:example.test',
});
const accessToken = 'synthetic-access-token';
const transactionId = `mcal-reminder-${'a'.repeat(64)}`;
const message = {
  type: 'm.room.message' as const,
  content: {
    msgtype: 'm.text' as const,
    body: 'A meeting is starting',
    'm.mentions': { room: true as const },
  },
};

function createRuntime(
  identity: RoomCalendarPrincipalIdentity = botIdentity,
): ReminderSchedulerRuntimeSource {
  return {
    getCurrentConfiguration: jest.fn(async () => ({
      roomCalendarBindings: [{ roomId, calendarId }],
      roomCalendarPrincipalIdentity: identity,
      roomCalendarAccessEnabled: true,
      roomReminderDeliveryEnabled: true,
      reminderStoreEnabled: true,
    })),
  };
}

function createFetchMock(): jest.MockedFunction<typeof fetch> {
  return jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();
}

function createTransport(
  fetchMock = createFetchMock(),
  runtime = createRuntime(),
  resolve: () => Promise<RoomCalendarPrincipalIdentity> = async () =>
    botIdentity,
) {
  return new MatrixBotAccountReminderTransport(
    {
      homeserverUrl: 'https://matrix.example.test',
      accessToken,
      principalIdentityProvider: { resolve },
    },
    runtime,
    fetchMock,
  );
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function assertBotRequest(
  url: string | URL | Request,
  init?: RequestInit,
): void {
  const parsedUrl = new URL(String(url));
  expect(parsedUrl.searchParams.has('user_id')).toBe(false);
  expect(new Headers(init?.headers).get('Authorization')).toBe(
    `Bearer ${accessToken}`,
  );
}

describe('MatrixBotAccountReminderTransport', () => {
  it('uses the same ACCESS_TOKEN without user_id for every state lookup', async () => {
    const fetchMock = createFetchMock()
      .mockResolvedValueOnce(json({ errcode: 'M_NOT_FOUND' }, 404))
      .mockResolvedValueOnce(json({ joined: { [botIdentity.userId]: {} } }))
      .mockResolvedValueOnce(
        json({
          users: { [botIdentity.userId]: 100 },
          events: { 'm.room.message': 0 },
          notifications: { room: 0 },
        }),
      )
      .mockResolvedValueOnce(json({ room_version: '10' }));
    const transport = createTransport(fetchMock);

    await expect(transport.isRoomEncrypted(roomId)).resolves.toBe(false);
    await expect(transport.getJoinedRoomMembers(roomId)).resolves.toEqual([
      botIdentity.userId,
    ]);
    await expect(transport.getPowerLevels(roomId)).resolves.toEqual({
      users: { [botIdentity.userId]: 100 },
      events: { 'm.room.message': 0 },
      notifications: { room: 0 },
    });
    await expect(transport.getRoomVersion(roomId)).resolves.toBe('10');

    expect(fetchMock).toHaveBeenCalledTimes(4);
    for (const [url, init] of fetchMock.mock.calls) {
      assertBotRequest(url, init);
      expect(init?.method).toBe('GET');
      expect(init?.redirect).toBe('manual');
    }
  });

  it('reads recipient labels through the normal bot account without user impersonation', async () => {
    const fetchMock = createFetchMock().mockResolvedValue(
      json({
        joined: {
          '@alice:example.test': {
            display_name: 'Alice',
            avatar_url: 'mxc://private-avatar',
          },
          [botIdentity.userId]: {},
        },
      }),
    );
    const transport = createTransport(fetchMock);

    await expect(transport.getJoinedRoomRecipients(roomId)).resolves.toEqual([
      { userId: '@alice:example.test', displayName: 'Alice' },
      { userId: botIdentity.userId, displayName: null },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    assertBotRequest(url, init);
    expect(new URL(String(url)).pathname).toBe(
      '/_matrix/client/v3/rooms/!team%3Aexample.test/joined_members',
    );
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain(
      'private-avatar',
    );
  });

  it('sends the unchanged room mention as the selected bot account', async () => {
    const fetchMock = createFetchMock()
      .mockResolvedValueOnce(json({ errcode: 'M_NOT_FOUND' }, 404))
      .mockResolvedValueOnce(json({ joined: { [botIdentity.userId]: {} } }))
      .mockResolvedValueOnce(
        json({
          users: { [botIdentity.userId]: 100 },
          events: { 'm.room.message': 0 },
          notifications: { room: 0 },
        }),
      )
      .mockResolvedValueOnce(json({ room_version: '10' }))
      .mockResolvedValueOnce(json({ event_id: '$sent:example.test' }));
    const runtime = createRuntime();
    const transport = createTransport(fetchMock, runtime);

    await transport.sendRoomMention(
      roomId,
      calendarId,
      message,
      transactionId,
      new AbortController().signal,
    );

    expect(runtime.getCurrentConfiguration).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    for (const [url, init] of fetchMock.mock.calls) {
      assertBotRequest(url, init);
    }
    const [sendUrl, sendInit] = fetchMock.mock.calls[4];
    expect(new URL(String(sendUrl)).pathname).toBe(
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${transactionId}`,
    );
    expect(sendInit?.method).toBe('PUT');
    expect(JSON.parse(String(sendInit?.body))).toEqual(message.content);
    expect(message).toEqual({
      type: 'm.room.message',
      content: {
        msgtype: 'm.text',
        body: 'A meeting is starting',
        'm.mentions': { room: true },
      },
    });
  });

  it('fails before any HTTP request when identity resolution fails or selects another mode', async () => {
    const rejectedFetch = createFetchMock();
    const rejected = createTransport(
      rejectedFetch,
      createRuntime(),
      async () => {
        throw new Error('private identity details');
      },
    );
    await expect(rejected.getJoinedRoomMembers(roomId)).rejects.toEqual(
      new MatrixReminderTransportError('authorization-denied'),
    );
    expect(rejectedFetch).not.toHaveBeenCalled();

    const mismatchedFetch = createFetchMock();
    const mismatchedIdentity = Object.freeze({
      mode: 'appservice' as const,
      userId: botIdentity.userId,
    });
    const mismatched = createTransport(
      mismatchedFetch,
      createRuntime(),
      async () => mismatchedIdentity,
    );
    await expect(mismatched.getJoinedRoomMembers(roomId)).rejects.toEqual(
      new MatrixReminderTransportError('authorization-denied'),
    );
    expect(mismatchedFetch).not.toHaveBeenCalled();
  });

  it('honors cancellation while resolving identity before any HTTP request', async () => {
    const fetchMock = createFetchMock();
    let resolveIdentity!: (identity: RoomCalendarPrincipalIdentity) => void;
    const pendingIdentity = new Promise<RoomCalendarPrincipalIdentity>(
      (resolve) => {
        resolveIdentity = resolve;
      },
    );
    const transport = createTransport(
      fetchMock,
      createRuntime(),
      () => pendingIdentity,
    );
    const controller = new AbortController();
    const request = transport.getJoinedRoomMembers(roomId, controller.signal);

    controller.abort();
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).not.toHaveBeenCalled();

    resolveIdentity(botIdentity);
  });

  it('fails before room-state or send HTTP when runtime holds another identity object', async () => {
    const fetchMock = createFetchMock();
    const otherIdentity = Object.freeze({
      mode: 'bot-account' as const,
      userId: botIdentity.userId,
    });
    const transport = createTransport(fetchMock, createRuntime(otherIdentity));

    await expect(
      transport.sendRoomMention(
        roomId,
        calendarId,
        message,
        transactionId,
        new AbortController().signal,
      ),
    ).rejects.toEqual(new MatrixReminderTransportError('authorization-denied'));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
