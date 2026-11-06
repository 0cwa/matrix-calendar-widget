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

import { MatrixClient, MemoryStorageProvider } from 'matrix-bot-sdk';
import { CheckpointMatrixClient } from '../CheckpointMatrixClient';
import { AutojoinRoomsMixin } from './AutojoinRoomsMixin';

describe('AutojoinRoomsMixin', () => {
  it('continues to join ordinary bot invites when the welcome workflow is disabled', async () => {
    const roomId = '!calendar:example.test';
    const joinRoom = jest.fn().mockResolvedValue(roomId);
    let onInvite: ((invitedRoomId: string) => Promise<void>) | undefined;
    const client = {
      on: jest.fn(
        (
          eventName: string,
          listener: (invitedRoomId: string) => Promise<void>,
        ) => {
          if (eventName === 'room.invite') onInvite = listener;
        },
      ),
      joinRoom,
    } as unknown as MatrixClient;

    AutojoinRoomsMixin.setupOnClient(client);

    expect(onInvite).toBeDefined();
    await onInvite?.(roomId);

    expect(joinRoom).toHaveBeenCalledWith(roomId);
  });

  it('marks checkpoints unsafe when an autojoin failure is caught', async () => {
    const roomId = '!calendar:example.test';
    const client = new CheckpointMatrixClient(
      'https://matrix.example.test',
      'token',
      new MemoryStorageProvider(),
    );
    jest.spyOn(client, 'joinRoom').mockRejectedValue(new Error('join failed'));
    AutojoinRoomsMixin.setupOnClient(client);

    const listeners = client.listeners('room.invite');
    const listener = listeners[listeners.length - 1] as (
      invitedRoomId: string,
    ) => Promise<void>;
    await listener(roomId);

    await expect(client.assertCheckpointSafe()).rejects.toThrow(
      'Matrix checkpoint is not known safe; operator review is required',
    );
  });
});
