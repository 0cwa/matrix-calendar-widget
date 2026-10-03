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

import { MatrixClient, MatrixError } from 'matrix-bot-sdk';
import {
  RoomCalendarEventAuditContext,
  RoomCalendarEventAuditService,
} from './RoomCalendarEventAuditService';

const roomId = '!team:example.test';
const calendarId = 'team-calendar';
const actorUserId = '@alice:example.test';
const senderUserId = '@calendar-bot:example.test';
const bindings = [{ roomId, calendarId }];

describe('RoomCalendarEventAuditService', () => {
  const context: RoomCalendarEventAuditContext = {
    roomId,
    calendarId,
    actorUserId,
    action: 'created',
    resourceId: 'opaque-event.ics',
    title: 'Roadmap review',
  };

  let client: {
    getUserId: jest.Mock;
    getJoinedRoomMembers: jest.Mock;
    getRoomStateEvent: jest.Mock;
    sendMessage: jest.Mock;
    crypto: { isRoomEncrypted: jest.Mock };
  };

  function createService(
    options: ConstructorParameters<typeof RoomCalendarEventAuditService>[1] = {
      enabled: true,
      roomCalendarBindings: bindings,
    },
  ): RoomCalendarEventAuditService {
    return new RoomCalendarEventAuditService(
      client as unknown as MatrixClient,
      options,
    );
  }

  beforeEach(() => {
    client = {
      getUserId: jest.fn().mockResolvedValue(senderUserId),
      getJoinedRoomMembers: jest.fn().mockResolvedValue([senderUserId]),
      getRoomStateEvent: jest.fn(async (_room: string, type: string) => {
        if (type === 'm.room.power_levels') {
          return {
            users: { [senderUserId]: 50 },
            events: { 'm.room.message': 0 },
          };
        }
        if (type === 'm.room.create') return { room_version: '10' };
        if (type === 'm.room.encryption') {
          throw new MatrixError(
            { errcode: 'M_NOT_FOUND', error: 'not encrypted' },
            404,
          );
        }
        throw new Error('Unexpected state lookup');
      }),
      sendMessage: jest.fn().mockResolvedValue('$notice'),
      crypto: { isRoomEncrypted: jest.fn().mockResolvedValue(true) },
    };
  });

  it('does nothing by default and performs no Matrix lookups', async () => {
    await createService({ roomCalendarBindings: bindings }).record(context);

    expect(client.getUserId).not.toHaveBeenCalled();
    expect(client.getJoinedRoomMembers).not.toHaveBeenCalled();
    expect(client.getRoomStateEvent).not.toHaveBeenCalled();
    expect(client.sendMessage).not.toHaveBeenCalled();
  });

  it('rechecks the SDK sender membership and m.room.message power', async () => {
    await createService().record(context);

    expect(client.getUserId).toHaveBeenCalledTimes(1);
    expect(client.getJoinedRoomMembers).toHaveBeenCalledWith(roomId);
    expect(client.getRoomStateEvent).toHaveBeenCalledWith(
      roomId,
      'm.room.power_levels',
      '',
    );
    expect(client.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('uses the actual bot sender identity separately from actor attribution', async () => {
    await createService().record(context);

    expect(client.getJoinedRoomMembers).toHaveBeenCalledWith(roomId);
    expect(client.sendMessage).toHaveBeenCalledWith(roomId, {
      body: expect.stringContaining('Actor: ＠alice:example.test'),
      msgtype: 'm.notice',
      'm.mentions': {},
    });
  });

  it('does not send when the current bot is no longer joined', async () => {
    client.getJoinedRoomMembers.mockResolvedValue([]);

    await createService().record(context);

    expect(client.getRoomStateEvent).not.toHaveBeenCalled();
    expect(client.sendMessage).not.toHaveBeenCalled();
  });

  it('does not send when current message power exceeds the bot power', async () => {
    client.getRoomStateEvent.mockImplementation(
      async (_room: string, type: string) => {
        if (type === 'm.room.power_levels') {
          return {
            users: { [senderUserId]: 40 },
            events: { 'm.room.message': 50 },
          };
        }
        if (type === 'm.room.create') return { room_version: '10' };
        if (type === 'm.room.encryption') {
          throw new MatrixError(
            { errcode: 'M_NOT_FOUND', error: 'not encrypted' },
            404,
          );
        }
        throw new Error('Unexpected state lookup');
      },
    );

    await createService().record(context);

    expect(client.sendMessage).not.toHaveBeenCalled();
  });

  it.each([
    ['null power-level event', null],
    ['array power-level event', []],
    ['string power-level event', 'malformed'],
    ['null users map', { users: null }],
    ['array users map', { users: [] }],
    ['string users map', { users: 'malformed' }],
    ['null events map', { events: null }],
    ['array events map', { events: [] }],
    ['string events map', { events: 'malformed' }],
    [
      'malformed explicit sender power',
      { users: { [senderUserId]: 'not-a-power-level' }, events_default: 0 },
    ],
    [
      'malformed explicit message power',
      { users: { [senderUserId]: 50 }, events: { 'm.room.message': NaN } },
    ],
    [
      'malformed sender default power',
      { users_default: 'invalid', events_default: 0 },
    ],
    [
      'malformed event default power',
      { users_default: 0, events_default: Infinity },
    ],
  ])('fails closed for %s', async (_case, powerLevels) => {
    client.getRoomStateEvent.mockImplementation(
      async (_room: string, type: string) => {
        if (type === 'm.room.power_levels') return powerLevels;
        if (type === 'm.room.create') return { room_version: '10' };
        if (type === 'm.room.encryption') {
          throw new MatrixError(
            { errcode: 'M_NOT_FOUND', error: 'not encrypted' },
            404,
          );
        }
        throw new Error('Unexpected state lookup');
      },
    );

    await createService().record(context);

    expect(client.sendMessage).not.toHaveBeenCalled();
  });

  it('applies default power only when the power-level event is exactly missing', async () => {
    client.getRoomStateEvent.mockImplementation(
      async (_room: string, type: string) => {
        if (type === 'm.room.power_levels') {
          throw new MatrixError(
            { errcode: 'M_NOT_FOUND', error: 'missing state' },
            404,
          );
        }
        if (type === 'm.room.create') return { room_version: '10' };
        if (type === 'm.room.encryption') {
          throw new MatrixError(
            { errcode: 'M_NOT_FOUND', error: 'not encrypted' },
            404,
          );
        }
        throw new Error('Unexpected state lookup');
      },
    );

    await createService().record(context);

    expect(client.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('does not infer legacy room version from malformed array creation state', async () => {
    client.getRoomStateEvent.mockImplementation(
      async (_room: string, type: string) => {
        if (type === 'm.room.power_levels') {
          return {
            users: { [senderUserId]: '50' },
            events: { 'm.room.message': '0' },
          };
        }
        if (type === 'm.room.create') return [];
        if (type === 'm.room.encryption') {
          throw new MatrixError(
            { errcode: 'M_NOT_FOUND', error: 'not encrypted' },
            404,
          );
        }
        throw new Error('Unexpected state lookup');
      },
    );

    await createService().record(context);

    expect(client.sendMessage).not.toHaveBeenCalled();
  });

  it.each([
    [
      'another missing-state error code',
      new MatrixError({ errcode: 'M_UNKNOWN', error: 'unknown error' }, 404),
    ],
    [
      'M_NOT_FOUND with a non-404 status',
      new MatrixError({ errcode: 'M_NOT_FOUND', error: 'wrong status' }, 500),
    ],
  ])('does not default for %s', async (_case, powerLevelError) => {
    client.getRoomStateEvent.mockImplementation(
      async (_room: string, type: string) => {
        if (type === 'm.room.power_levels') throw powerLevelError;
        if (type === 'm.room.create') return { room_version: '10' };
        if (type === 'm.room.encryption') {
          throw new MatrixError(
            { errcode: 'M_NOT_FOUND', error: 'not encrypted' },
            404,
          );
        }
        throw new Error('Unexpected state lookup');
      },
    );

    await createService().record(context);

    expect(client.sendMessage).not.toHaveBeenCalled();
  });

  it('fails closed if the room binding has changed', async () => {
    await createService({
      enabled: true,
      roomCalendarBindings: [{ roomId, calendarId: 'other-calendar' }],
    }).record(context);

    expect(client.getJoinedRoomMembers).not.toHaveBeenCalled();
    expect(client.sendMessage).not.toHaveBeenCalled();
  });

  it('rejects a href where the audit context requires an opaque resource ID', async () => {
    await createService().record({
      ...context,
      resourceId: 'https://radicale.example.test/team/opaque-event.ics',
    });

    expect(client.getUserId).not.toHaveBeenCalled();
    expect(client.sendMessage).not.toHaveBeenCalled();
  });

  it('strips controls and neutralizes mentions in the plain notice', async () => {
    await createService().record({
      ...context,
      title: 'Roadmap\n@room\u202eattack',
      resourceId: 'project@alice.ics',
    });

    const sent = client.sendMessage.mock.calls[0][1];
    expect(sent.msgtype).toBe('m.notice');
    expect(sent['m.mentions']).toEqual({});
    expect(sent.body).toContain('Roadmap ＠room attack');
    expect(sent.body).toContain('project＠alice.ics');
    expect(sent.body).not.toContain('@room');
    expect(sent.body).not.toContain('\u202e');
    expect(sent.body).not.toContain('<');
  });

  it('skips encrypted rooms unless configured crypto and the SDK confirm encryption', async () => {
    client.getRoomStateEvent.mockImplementation(
      async (_room: string, type: string) => {
        if (type === 'm.room.power_levels') {
          return { users: { [senderUserId]: 50 }, events_default: 0 };
        }
        if (type === 'm.room.create') return { room_version: '10' };
        if (type === 'm.room.encryption') {
          return { algorithm: 'm.megolm.v1.aes-sha2' };
        }
        throw new Error('Unexpected state lookup');
      },
    );

    await createService({
      enabled: true,
      roomCalendarBindings: bindings,
      encryptionEnabled: false,
    }).record(context);
    expect(client.crypto.isRoomEncrypted).not.toHaveBeenCalled();
    expect(client.sendMessage).not.toHaveBeenCalled();

    client.crypto.isRoomEncrypted.mockResolvedValue(false);
    await createService({
      enabled: true,
      roomCalendarBindings: bindings,
      encryptionEnabled: true,
    }).record(context);
    expect(client.sendMessage).not.toHaveBeenCalled();

    client.crypto.isRoomEncrypted.mockResolvedValue(true);
    await createService({
      enabled: true,
      roomCalendarBindings: bindings,
      encryptionEnabled: true,
    }).record(context);
    expect(client.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('does not send if encryption state is unavailable', async () => {
    client.getRoomStateEvent.mockRejectedValue(new Error('state unavailable'));

    await createService().record(context);

    expect(client.sendMessage).not.toHaveBeenCalled();
  });

  it('swallows message-send failures after the CalDAV mutation has succeeded', async () => {
    client.sendMessage.mockRejectedValue(new Error('homeserver unavailable'));

    await expect(createService().record(context)).resolves.toBeUndefined();
  });

  it.each([
    ['created', 'created'],
    ['updated', 'updated'],
    ['deleted', 'deleted'],
  ] as const)(
    'formats the %s action without changing its meaning',
    async (action, verb) => {
      await createService().record({ ...context, action });

      expect(client.sendMessage.mock.calls[0][1].body).toContain(
        `Calendar event ${verb}.`,
      );
    },
  );

  it('omits event details from deletion notices', async () => {
    await createService().record({
      ...context,
      action: 'deleted',
      title: 'Private title',
    });

    const body = client.sendMessage.mock.calls[0][1].body;
    expect(body).toContain('Calendar event deleted.');
    expect(body).not.toContain('Private title');
  });
});
