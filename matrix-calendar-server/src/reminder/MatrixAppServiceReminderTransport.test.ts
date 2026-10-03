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
  MatrixAppServiceReminderTransport,
  MatrixReminderTransportError,
} from './MatrixAppServiceReminderTransport';
import { ReminderSchedulerRuntimeSource } from './RoomReminderScheduler';

const roomId = '!team:example.test';
const calendarId = 'team-calendar';
const senderUserId = '@calendar_bot:example.test';
const token = 'synthetic-appservice-token';
function createRuntime(boundRoomId = roomId): ReminderSchedulerRuntimeSource {
  return {
    getCurrentConfiguration: jest.fn(async () => ({
      roomCalendarBindings: [{ roomId: boundRoomId, calendarId }],
      applicationServiceSenderUserId: senderUserId,
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
) {
  return new MatrixAppServiceReminderTransport(
    {
      homeserverUrl: 'https://matrix.example.test',
      applicationServiceToken: token,
      applicationServiceSenderUserId: senderUserId,
    },
    runtime,
    fetchMock,
  );
}

function missingState(): Response {
  return new Response(JSON.stringify({ errcode: 'M_NOT_FOUND' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('MatrixAppServiceReminderTransport', () => {
  it('reads joined members through the configured AS identity and honors cancellation', async () => {
    const fetchMock = createFetchMock().mockResolvedValue(
      new Response(
        JSON.stringify({
          joined: {
            '@alice:example.test': { display_name: 'private display name' },
            [senderUserId]: { avatar_url: 'mxc://private' },
          },
        }),
        { status: 200 },
      ),
    );
    const transport = createTransport(fetchMock);
    const controller = new AbortController();

    await expect(
      transport.getJoinedRoomMembers(roomId, controller.signal),
    ).resolves.toEqual(['@alice:example.test', senderUserId]);
    const [url, init] = fetchMock.mock.calls[0];
    const parsedUrl = new URL(String(url));
    expect(parsedUrl.pathname).toBe(
      '/_matrix/client/v3/rooms/!team%3Aexample.test/joined_members',
    );
    expect(parsedUrl.searchParams.get('user_id')).toBe(senderUserId);
    expect(new Headers(init?.headers).get('Authorization')).toBe(
      `Bearer ${token}`,
    );
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.signal).not.toBe(controller.signal);
    expect(init?.redirect).toBe('manual');
  });

  it('treats only an explicit M_NOT_FOUND encryption event as plaintext', async () => {
    const fetchMock = createFetchMock()
      .mockResolvedValueOnce(missingState())
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ errcode: 'M_FORBIDDEN' }), {
          status: 404,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ algorithm: 'm.megolm.v1.aes-sha2' }), {
          status: 200,
        }),
      );
    const transport = createTransport(fetchMock);

    await expect(transport.isRoomEncrypted(roomId)).resolves.toBe(false);
    await expect(transport.isRoomEncrypted(roomId)).rejects.toEqual(
      new MatrixReminderTransportError('request-failed'),
    );
    await expect(transport.isRoomEncrypted(roomId)).resolves.toBe(true);
  });

  it('preserves raw power values and reads the Matrix room version', async () => {
    const fetchMock = createFetchMock()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            users: { [senderUserId]: 'bad-power-value' },
            events: { 'm.room.message': 3 },
            notifications: { room: 50 },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ room_version: '10' }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));
    const transport = createTransport(fetchMock);

    await expect(transport.getPowerLevels(roomId)).resolves.toEqual({
      users: { [senderUserId]: 'bad-power-value' },
      events: { 'm.room.message': 3 },
      notifications: { room: 50 },
    });
    await expect(transport.getRoomVersion(roomId)).resolves.toBe('10');
    await expect(transport.getRoomVersion(roomId)).resolves.toBe('1');
    const [powerLevelsUrl] = fetchMock.mock.calls[0];
    expect(new URL(String(powerLevelsUrl)).pathname).toBe(
      '/_matrix/client/v3/rooms/!team%3Aexample.test/state/m.room.power_levels/',
    );
    expect(new URL(String(powerLevelsUrl)).searchParams.has('format')).toBe(
      false,
    );
  });

  it.each(
    ['users', 'events', 'notifications'].flatMap((mapName) =>
      [null, [], 'invalid'].map((value) => [mapName, value] as const),
    ),
  )(
    'rejects a malformed %s map before applying policy defaults',
    async (mapName, value) => {
      const fetchMock = createFetchMock().mockResolvedValue(
        new Response(
          JSON.stringify({
            [mapName]: value,
            users_default: 100,
            events_default: 100,
            state_default: 100,
          }),
          { status: 200 },
        ),
      );

      await expect(
        createTransport(fetchMock).getPowerLevels(roomId),
      ).rejects.toEqual(new MatrixReminderTransportError('invalid-response'));
    },
  );

  it('sends a bounded room mention with the supplied stable transaction ID as the configured AS user', async () => {
    const fetchMock = createFetchMock()
      .mockResolvedValueOnce(missingState())
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ joined: { [senderUserId]: {} } }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            users: { [senderUserId]: 100 },
            events: { 'm.room.message': 0 },
            notifications: { room: 0 },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ room_version: '10' }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ event_id: '$sent:example.test' }), {
          status: 200,
        }),
      );
    const transport = createTransport(fetchMock);
    const controller = new AbortController();
    const transactionId = `mcal-reminder-${'a'.repeat(64)}`;

    await transport.sendRoomMention(
      roomId,
      calendarId,
      {
        type: 'm.room.message',
        content: {
          msgtype: 'm.text',
          body: 'A meeting is starting',
          'm.mentions': { room: true },
        },
      },
      transactionId,
      controller.signal,
    );

    expect(fetchMock).toHaveBeenCalledTimes(5);
    const [url, init] = fetchMock.mock.calls[4];
    const parsedUrl = new URL(String(url));
    expect(parsedUrl.pathname).toBe(
      `/_matrix/client/v3/rooms/!team%3Aexample.test/send/m.room.message/${transactionId}`,
    );
    expect(parsedUrl.searchParams.get('user_id')).toBe(senderUserId);
    expect(init?.method).toBe('PUT');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.signal).not.toBe(controller.signal);
    expect(JSON.parse(String(init?.body))).toEqual({
      msgtype: 'm.text',
      body: 'A meeting is starting',
      'm.mentions': { room: true },
    });
  });

  it('uses canonical room-version 12 IDs for state reads and sends', async () => {
    const domainlessRoomId = `!${'A'.repeat(43)}`;
    const fetchMock = createFetchMock()
      .mockResolvedValueOnce(missingState())
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ joined: { [senderUserId]: {} } }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            users: { [senderUserId]: 100 },
            events: { 'm.room.message': 0 },
            notifications: { room: 0 },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ room_version: '12' }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ event_id: '$sent:example.test' }), {
          status: 200,
        }),
      );
    const transport = createTransport(
      fetchMock,
      createRuntime(domainlessRoomId),
    );
    const message = {
      type: 'm.room.message' as const,
      content: {
        msgtype: 'm.text' as const,
        body: 'Reminder',
        'm.mentions': { room: true as const },
      },
    };

    await transport.sendRoomMention(
      domainlessRoomId,
      calendarId,
      message,
      `mcal-reminder-${'c'.repeat(64)}`,
      new AbortController().signal,
    );

    const basePath = `/_matrix/client/v3/rooms/${encodeURIComponent(domainlessRoomId)}`;
    expect(
      fetchMock.mock.calls.map(([url]) => new URL(String(url)).pathname),
    ).toEqual([
      `${basePath}/state/m.room.encryption/`,
      `${basePath}/joined_members`,
      `${basePath}/state/m.room.power_levels/`,
      `${basePath}/state/m.room.create/`,
      `${basePath}/send/m.room.message/mcal-reminder-${'c'.repeat(64)}`,
    ]);
  });

  it('does not send to encrypted rooms, changed bindings, or a different configured sender', async () => {
    const encryptedFetch = createFetchMock().mockResolvedValue(
      new Response(JSON.stringify({ algorithm: 'm.megolm.v1.aes-sha2' }), {
        status: 200,
      }),
    );
    const encrypted = createTransport(encryptedFetch);
    const signal = new AbortController().signal;
    const message = {
      type: 'm.room.message' as const,
      content: {
        msgtype: 'm.text' as const,
        body: 'Reminder',
        'm.mentions': { room: true as const },
      },
    };
    const transactionId = `mcal-reminder-${'b'.repeat(64)}`;

    await expect(
      encrypted.sendRoomMention(
        roomId,
        calendarId,
        message,
        transactionId,
        signal,
      ),
    ).rejects.toMatchObject({ code: 'authorization-denied' });
    expect(encryptedFetch).toHaveBeenCalledTimes(1);

    const changedRuntime = {
      getCurrentConfiguration: jest.fn(async () => ({
        roomCalendarBindings: [{ roomId, calendarId: 'other-calendar' }],
        applicationServiceSenderUserId: senderUserId,
        roomCalendarAccessEnabled: true,
        roomReminderDeliveryEnabled: true,
        reminderStoreEnabled: true,
      })),
    };
    const noBindingFetch = createFetchMock();
    const noBinding = new MatrixAppServiceReminderTransport(
      {
        homeserverUrl: 'https://matrix.example.test',
        applicationServiceToken: token,
        applicationServiceSenderUserId: senderUserId,
      },
      changedRuntime,
      noBindingFetch,
    );
    await expect(
      noBinding.sendRoomMention(
        roomId,
        calendarId,
        message,
        transactionId,
        signal,
      ),
    ).rejects.toMatchObject({ code: 'authorization-denied' });
    expect(noBindingFetch).not.toHaveBeenCalled();

    const disabledRuntime = {
      getCurrentConfiguration: jest.fn(async () => ({
        roomCalendarBindings: [{ roomId, calendarId }],
        applicationServiceSenderUserId: senderUserId,
        roomCalendarAccessEnabled: true,
        roomReminderDeliveryEnabled: false,
        reminderStoreEnabled: true,
      })),
    };
    const disabledFetch = createFetchMock();
    const disabled = new MatrixAppServiceReminderTransport(
      {
        homeserverUrl: 'https://matrix.example.test',
        applicationServiceToken: token,
        applicationServiceSenderUserId: senderUserId,
      },
      disabledRuntime,
      disabledFetch,
    );
    await expect(
      disabled.sendRoomMention(
        roomId,
        calendarId,
        message,
        transactionId,
        signal,
      ),
    ).rejects.toMatchObject({ code: 'authorization-denied' });
    expect(disabledFetch).not.toHaveBeenCalled();
  });

  it('aborts before I/O and rejects redirects without following them', async () => {
    const fetchMock = createFetchMock().mockResolvedValue(
      new Response('private body', {
        status: 302,
        headers: { Location: 'https://other.example.test/path' },
      }),
    );
    const transport = createTransport(fetchMock);
    const aborted = new AbortController();
    aborted.abort();
    await expect(
      transport.getJoinedRoomMembers(roomId, aborted.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).not.toHaveBeenCalled();

    await expect(transport.getJoinedRoomMembers(roomId)).rejects.toEqual(
      new MatrixReminderTransportError('request-failed'),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]?.redirect).toBe('manual');
  });

  it('maps malformed or oversized responses to fixed safe errors', async () => {
    const malformed = createFetchMock().mockResolvedValue(
      new Response('{not-json', { status: 200 }),
    );
    await expect(
      createTransport(malformed).getJoinedRoomMembers(roomId),
    ).rejects.toEqual(new MatrixReminderTransportError('invalid-response'));

    const oversized = createFetchMock().mockResolvedValue(
      new Response('{}', {
        status: 200,
        headers: { 'Content-Length': String(3 * 1024 * 1024) },
      }),
    );
    await expect(
      createTransport(oversized).getJoinedRoomMembers(roomId),
    ).rejects.toEqual(new MatrixReminderTransportError('response-too-large'));
  });

  it('composes caller cancellation into a request that did not supply a signal', async () => {
    let observedSignal: AbortSignal | undefined;
    const fetchMock = createFetchMock().mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          observedSignal = init?.signal as AbortSignal | undefined;
          observedSignal?.addEventListener(
            'abort',
            () => reject(new Error('private transport details')),
            { once: true },
          );
        }),
    );
    const transport = createTransport(fetchMock);
    const controller = new AbortController();

    const request = transport.getJoinedRoomMembers(roomId, controller.signal);
    await new Promise<void>((resolve) => setImmediate(resolve));
    controller.abort();
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    expect(observedSignal?.aborted).toBe(true);
  });

  it('bounds signal-less state requests and hides fetch error details', async () => {
    const fetchMock = createFetchMock().mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new Error('private token and URL details')),
            { once: true },
          );
        }),
    );
    const transport = createTransport(fetchMock);
    const startedAt = Date.now();

    await expect(transport.getJoinedRoomMembers(roomId)).rejects.toEqual(
      new MatrixReminderTransportError('request-failed'),
    );

    expect(Date.now() - startedAt).toBeLessThan(3_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
