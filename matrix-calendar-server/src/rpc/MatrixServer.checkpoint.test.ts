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
import { AppRuntimeContext } from '../AppRuntimeContext';
import { ReactionClient } from '../client/ReactionClient';
import { IAppConfiguration } from '../IAppConfiguration';
import { MATRIX_CHECKPOINT_STATE_STORAGE_KEY } from '../matrix/AtomicFsStorageProvider';
import { BotEventType } from '../matrix/BotEventType';
import { CheckpointMatrixClient } from '../matrix/CheckpointMatrixClient';
import { RoomMessageService } from '../service/RoomMessageService';
import { MatrixServer } from './MatrixServer';

describe('MatrixServer checkpoint failure integration', () => {
  it('latches a caught room handler failure in durable Matrix storage', async () => {
    const storage = new MemoryStorageProvider();
    storage.storeValue(MATRIX_CHECKPOINT_STATE_STORAGE_KEY, 'safe');
    const client = new CheckpointMatrixClient(
      'https://matrix.example.org',
      'test-token',
      storage,
    );
    const server = new MatrixServer(
      {} as AppRuntimeContext,
      client,
      {} as ReactionClient,
      {} as RoomMessageService,
      {} as IAppConfiguration,
    );
    const loggerError = jest.spyOn((server as any).logger, 'error');
    jest
      .spyOn(server, 'processEvent')
      .mockRejectedValue(new Error('synthetic handler failure'));

    server.listen(() => undefined);
    client.emit(BotEventType.ROOM_MESSAGE, '!room:example.org', {});

    await expect(waitForCheckpointState(storage)).resolves.toBe('unsafe');
    await expect(client.assertCheckpointSafe()).rejects.toThrow(
      'Matrix checkpoint is not known safe; operator review is required',
    );
    expect(loggerError).toHaveBeenCalledWith(expect.any(Error));
    server.close();
  });
});

async function waitForCheckpointState(
  storage: MemoryStorageProvider,
): Promise<string | null | undefined> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const state = storage.readValue(MATRIX_CHECKPOINT_STATE_STORAGE_KEY);
    if (state === 'unsafe') return state;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error('Timed out waiting for unsafe Matrix checkpoint state');
}
