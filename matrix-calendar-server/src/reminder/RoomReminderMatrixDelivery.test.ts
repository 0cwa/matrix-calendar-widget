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

import { MatrixClient } from 'matrix-bot-sdk';
import { AppRuntimeContext } from '../AppRuntimeContext';
import { RoomReminderMatrixDelivery } from './RoomReminderMatrixDelivery';

describe('RoomReminderMatrixDelivery', () => {
  const roomId = '!team:example.test';
  const botUserId = '@calendar-bot:example.test';

  function createDelivery(
    joinedRooms: unknown = [roomId],
    powerLevels: unknown = {
      users: { [botUserId]: 50 },
      notifications: { room: 50 },
    },
  ) {
    const matrixClient = {
      getJoinedRooms: jest.fn().mockResolvedValue(joinedRooms),
      getRoomStateEvent: jest.fn().mockResolvedValue(powerLevels),
      sendEvent: jest.fn().mockResolvedValue('$event:example.test'),
    } as unknown as jest.Mocked<MatrixClient>;
    const runtimeContext = new AppRuntimeContext(
      botUserId,
      'Calendar',
      'calendar-bot',
      ['en'],
    );
    return {
      delivery: new RoomReminderMatrixDelivery(matrixClient, runtimeContext),
      matrixClient,
    };
  }

  it('sends a standard room mention after confirming membership and power', async () => {
    const { delivery, matrixClient } = createDelivery();

    await expect(
      delivery.sendRoomReminder(roomId, 'Team calendar reminder'),
    ).resolves.toBe(true);

    expect(matrixClient.getJoinedRooms).toHaveBeenCalledTimes(1);
    expect(matrixClient.getRoomStateEvent).toHaveBeenCalledWith(
      roomId,
      'm.room.power_levels',
      '',
    );
    expect(matrixClient.sendEvent).toHaveBeenCalledWith(
      roomId,
      'm.room.message',
      {
        msgtype: 'm.text',
        body: 'Team calendar reminder',
        'm.mentions': { room: true },
      },
    );
  });

  it.each([
    ['bot is not joined', [], { notifications: { room: 0 } }],
    ['joined-room lookup fails', new Error('unavailable'), undefined],
    ['power-level state is missing', [roomId], null],
    ['power-level lookup fails', [roomId], new Error('unavailable')],
    ['power-level content is malformed', [roomId], { notifications: 'room' }],
    [
      'notification threshold is malformed',
      [roomId],
      { users: { [botUserId]: 100 }, notifications: { room: '50' } },
    ],
    [
      'bot power level is malformed',
      [roomId],
      { users: { [botUserId]: '100' }, notifications: { room: 50 } },
    ],
    [
      'bot is below the notification threshold',
      [roomId],
      { users: { [botUserId]: 49 }, notifications: { room: 50 } },
    ],
  ])('does not send when %s', async (_reason, joinedRooms, powerLevels) => {
    const { delivery, matrixClient } = createDelivery(joinedRooms, powerLevels);
    if (joinedRooms instanceof Error) {
      matrixClient.getJoinedRooms.mockRejectedValue(joinedRooms);
    }
    if (powerLevels instanceof Error) {
      matrixClient.getRoomStateEvent.mockRejectedValue(powerLevels);
    }

    await expect(delivery.sendRoomReminder(roomId, 'Reminder')).resolves.toBe(
      false,
    );
    expect(matrixClient.sendEvent).not.toHaveBeenCalled();
  });

  it('does not send for an empty room or body', async () => {
    const { delivery, matrixClient } = createDelivery();

    await expect(delivery.sendRoomReminder('', 'Reminder')).resolves.toBe(
      false,
    );
    await expect(delivery.sendRoomReminder(roomId, '')).resolves.toBe(false);

    expect(matrixClient.getJoinedRooms).not.toHaveBeenCalled();
    expect(matrixClient.sendEvent).not.toHaveBeenCalled();
  });
});
