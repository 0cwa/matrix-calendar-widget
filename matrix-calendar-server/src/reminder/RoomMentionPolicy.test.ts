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

import { MATRIX_CALENDAR_MANAGE_POLICY } from '../service/MatrixCalendarAuthorization';
import {
  authorizeRoomMentionDelivery,
  authorizeRoomMentionScheduling,
  RoomMentionMatrixState,
} from './RoomMentionPolicy';

const roomId = '!team:example.test';
const calendarId = 'team';
const actorUserId = '@alice:example.test';
const senderUserId = '@calendar-bot:example.test';
const configuredBindings = [{ roomId, calendarId }];

describe('authorizeRoomMentionScheduling', () => {
  let state: jest.Mocked<RoomMentionMatrixState>;
  const request = {
    authenticatedActorUserId: actorUserId,
    roomId,
    calendarId,
    configuredBindings,
  };

  beforeEach(() => {
    state = {
      getJoinedRoomMembers: jest.fn().mockResolvedValue([actorUserId]),
      getPowerLevels: jest.fn().mockResolvedValue({
        users: { [actorUserId]: 50 },
        state_default: 50,
      }),
    };
  });

  it('allows the current actor when joined with app action power and an exact binding', async () => {
    const binding = await authorizeRoomMentionScheduling(request, state);

    expect(state.getJoinedRoomMembers).toHaveBeenCalledWith(roomId);
    expect(state.getPowerLevels).toHaveBeenCalledWith(roomId);
    expect(binding).toEqual({ roomId, calendarId });
    expect(binding).not.toHaveProperty('actorUserId');
  });

  it('denies an actor who is not currently joined', async () => {
    state.getJoinedRoomMembers.mockResolvedValue(['@someone-else:example.test']);

    await expect(
      authorizeRoomMentionScheduling(request, state),
    ).resolves.toBeUndefined();
  });

  it('denies an actor below the default app action power', async () => {
    state.getPowerLevels.mockResolvedValue({
      users: { [actorUserId]: 49 },
      state_default: 50,
    });

    await expect(
      authorizeRoomMentionScheduling(request, state),
    ).resolves.toBeUndefined();
  });

  it('uses the configured app action power override', async () => {
    state.getPowerLevels.mockResolvedValue({
      users: { [actorUserId]: 40 },
      events: { [MATRIX_CALENDAR_MANAGE_POLICY]: 40 },
      state_default: 50,
    });

    await expect(authorizeRoomMentionScheduling(request, state)).resolves.toEqual({
      roomId,
      calendarId,
    });
  });

  it('denies a missing or mismatched binding', async () => {
    await expect(
      authorizeRoomMentionScheduling(
        { ...request, calendarId: 'other' },
        state,
      ),
    ).resolves.toBeUndefined();
  });

  it.each(['membership', 'power levels'])(
    'fails closed on a %s lookup error',
    async (lookup) => {
      if (lookup === 'membership') {
        state.getJoinedRoomMembers.mockRejectedValue(
          new Error('state unavailable'),
        );
      } else {
        state.getPowerLevels.mockRejectedValue(new Error('state unavailable'));
      }

      await expect(
        authorizeRoomMentionScheduling(request, state),
      ).resolves.toBeUndefined();
    },
  );
});

describe('authorizeRoomMentionDelivery', () => {
  let state: jest.Mocked<RoomMentionMatrixState>;
  const request = {
    roomId,
    calendarId,
    applicationServiceSenderUserId: senderUserId,
    configuredBindings,
  };

  beforeEach(() => {
    state = {
      getJoinedRoomMembers: jest.fn().mockResolvedValue([senderUserId]),
      getPowerLevels: jest.fn().mockResolvedValue({
        users: { [senderUserId]: 50 },
        events_default: 0,
      }),
    };
  });

  it('allows the joined sender when message and default room mention thresholds are met', async () => {
    await expect(authorizeRoomMentionDelivery(request, state)).resolves.toEqual({
      roomId,
      calendarId,
    });
  });

  it('denies a sender who is not currently joined', async () => {
    state.getJoinedRoomMembers.mockResolvedValue(['@someone-else:example.test']);

    await expect(
      authorizeRoomMentionDelivery(request, state),
    ).resolves.toBeUndefined();
  });

  it('denies when current m.room.message power is above the sender power', async () => {
    state.getPowerLevels.mockResolvedValue({
      users: { [senderUserId]: 40 },
      events: { 'm.room.message': 50 },
      notifications: { room: 0 },
    });

    await expect(
      authorizeRoomMentionDelivery(request, state),
    ).resolves.toBeUndefined();
  });

  it('applies the default room mention threshold of 50', async () => {
    state.getPowerLevels.mockResolvedValue({
      users: { [senderUserId]: 49 },
      events_default: 0,
    });

    await expect(
      authorizeRoomMentionDelivery(request, state),
    ).resolves.toBeUndefined();
  });

  it('denies when the current room mention threshold is above the sender power', async () => {
    state.getPowerLevels.mockResolvedValue({
      users: { [senderUserId]: 49 },
      events_default: 0,
      notifications: { room: 50 },
    });

    await expect(
      authorizeRoomMentionDelivery(request, state),
    ).resolves.toBeUndefined();
  });

  it('uses the current room mention threshold override', async () => {
    state.getPowerLevels.mockResolvedValue({
      users: { [senderUserId]: 60 },
      events_default: 0,
      notifications: { room: 60 },
    });

    await expect(authorizeRoomMentionDelivery(request, state)).resolves.toEqual({
      roomId,
      calendarId,
    });
  });

  it('denies if the binding changed after scheduling', async () => {
    await expect(
      authorizeRoomMentionDelivery(
        { ...request, configuredBindings: [{ roomId, calendarId: 'new-team' }] },
        state,
      ),
    ).resolves.toBeUndefined();
    expect(state.getJoinedRoomMembers).not.toHaveBeenCalled();
  });

  it('rechecks membership and power state on each delivery', async () => {
    await expect(authorizeRoomMentionDelivery(request, state)).resolves.toEqual({
      roomId,
      calendarId,
    });
    state.getJoinedRoomMembers.mockResolvedValue([]);
    await expect(
      authorizeRoomMentionDelivery(request, state),
    ).resolves.toBeUndefined();
    expect(state.getJoinedRoomMembers).toHaveBeenCalledTimes(2);
    expect(state.getPowerLevels).toHaveBeenCalledTimes(2);
  });

  it.each(['membership', 'power levels'])('fails closed on a %s lookup error', async (lookup) => {
    if (lookup === 'membership') {
      state.getJoinedRoomMembers.mockRejectedValue(new Error('state unavailable'));
    } else {
      state.getPowerLevels.mockRejectedValue(new Error('state unavailable'));
    }

    await expect(
      authorizeRoomMentionDelivery(request, state),
    ).resolves.toBeUndefined();
  });

  it('uses Matrix default power when no power-level state event exists', async () => {
    state.getPowerLevels.mockResolvedValue(undefined);

    await expect(
      authorizeRoomMentionDelivery(request, state),
    ).resolves.toBeUndefined();
  });
});
