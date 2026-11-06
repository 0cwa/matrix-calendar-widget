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

import { MemoryStorageProvider } from 'matrix-bot-sdk';
import { CheckpointMatrixClient } from '../CheckpointMatrixClient';
import { AutojoinUpgradedRoomsMixin } from './AutojoinUpgradedRoomsMixin';

describe('AutojoinUpgradedRoomsMixin', () => {
  it('marks checkpoints unsafe when joining an upgraded room fails', async () => {
    const client = new CheckpointMatrixClient(
      'https://matrix.example.test',
      'token',
      new MemoryStorageProvider(),
    );
    jest.spyOn(client, 'joinRoom').mockRejectedValue(new Error('join failed'));
    AutojoinUpgradedRoomsMixin.setupOnClient(client);

    const listener = client.listeners('room.archived')[0] as (
      roomId: string,
      event: { content: { replacement_room: string }; sender: string },
    ) => Promise<void>;
    await listener('!old:example.test', {
      content: { replacement_room: '!new:example.test' },
      sender: '@bot:example.test',
    });

    await expect(client.assertCheckpointSafe()).rejects.toThrow(
      'Matrix checkpoint is not known safe; operator review is required',
    );
  });
});
