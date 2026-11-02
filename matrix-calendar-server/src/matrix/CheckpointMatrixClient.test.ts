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

import { IStorageProvider, MemoryStorageProvider } from 'matrix-bot-sdk';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  AtomicFsStorageProvider,
  MATRIX_CHECKPOINT_STATE_PROCESSED,
  MATRIX_CHECKPOINT_STATE_SAFE,
  MATRIX_CHECKPOINT_STATE_STORAGE_KEY,
} from './AtomicFsStorageProvider';
import { CheckpointMatrixClient } from './CheckpointMatrixClient';
import { MatrixClientProxyHandler } from './MatrixClientProxyHandler';

class CheckpointStorageProvider extends MemoryStorageProvider {
  override setSyncToken(token: string | null): void {
    super.setSyncToken(token);
    if (
      this.readValue(MATRIX_CHECKPOINT_STATE_STORAGE_KEY) ===
      MATRIX_CHECKPOINT_STATE_PROCESSED
    ) {
      super.storeValue(
        MATRIX_CHECKPOINT_STATE_STORAGE_KEY,
        MATRIX_CHECKPOINT_STATE_SAFE,
      );
    }
  }
}

const deferred = <T>() => {
  let resolveDeferred!: (value: T) => void;
  let rejectDeferred!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolveDeferred = resolve;
    rejectDeferred = reject;
  });
  return { promise, resolve: resolveDeferred, reject: rejectDeferred };
};

const waitFor = async (predicate: () => boolean) => {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() > deadline)
      throw new Error('Timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
};

class TestMatrixClient extends CheckpointMatrixClient {
  readonly requestedSince: (string | undefined)[] = [];
  readonly responses: any[] = [];

  beginSync(): Promise<any> {
    return this.startSync();
  }

  public async doRequest(
    _method: string,
    endpoint: string,
    query?: any,
  ): Promise<any> {
    if (!endpoint.endsWith('/sync'))
      throw new Error(`Unexpected request: ${endpoint}`);
    this.requestedSince.push(query?.since);
    const response = this.responses.shift();
    if (response instanceof Promise) return response;
    return response;
  }

  async processRaw(raw: any): Promise<void> {
    await this.processSync(raw);
  }

  requestSync(token: string): Promise<any> {
    return this.doSync(token);
  }
}

const makeClient = (
  storage: IStorageProvider = new CheckpointStorageProvider(),
) => new TestMatrixClient('https://matrix.example.org', 'test-token', storage);

const batchWithMessages = (count: number) => ({
  rooms: {
    join: {
      '!room:example.org': {
        timeline: {
          events: Array.from({ length: count }, (_, index) => ({
            event_id: `$event-${index}`,
            type: 'm.room.message',
            content: { body: `message ${index}` },
          })),
        },
      },
    },
  },
});

describe('CheckpointMatrixClient', () => {
  it('waits for async event listeners before saving the cursor and pauses at the next sync boundary', async () => {
    const storage = new CheckpointStorageProvider();
    storage.setSyncToken('old-token');
    storage.storeValue(
      MATRIX_CHECKPOINT_STATE_STORAGE_KEY,
      MATRIX_CHECKPOINT_STATE_SAFE,
    );
    const client = makeClient(storage);
    const listenerStarted = deferred<void>();
    const finishListener = deferred<void>();
    const firstResponse = deferred<any>();
    const secondResponse = deferred<any>();
    client.responses.push(firstResponse.promise, secondResponse.promise);

    client.on('room.event', async () => {
      listenerStarted.resolve();
      await finishListener.promise;
    });

    void client.beginSync();
    await waitFor(() => client.requestedSince.length === 1);
    firstResponse.resolve({
      ...batchWithMessages(1),
      next_batch: 'next-token',
    });
    await listenerStarted.promise;

    const paused = client.pauseAtSyncBoundary(1_000, 2_000);
    await Promise.resolve();
    expect(storage.getSyncToken()).toBe('old-token');
    expect(client.requestedSince).toEqual(['old-token']);

    finishListener.resolve();
    const lease = await paused;
    lease.assertActive();
    expect(storage.getSyncToken()).toBe('next-token');
    expect(client.requestedSince).toEqual(['old-token']);

    lease.release();
    expect(() => lease.assertActive()).toThrow(
      'Matrix sync pause lease is no longer active',
    );
    await waitFor(() => client.requestedSince.length === 2);
    expect(client.requestedSince[1]).toBe('next-token');
    client.stop();
    secondResponse.resolve({ next_batch: 'after-resume' });
  });

  it('persists a real sync checkpoint and cursor across AtomicFsStorageProvider reopen', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'matrix-checkpoint-'));
    const filename = path.join(directory, 'bot.json');
    try {
      const storage = new AtomicFsStorageProvider(filename);
      storage.setSyncToken('before-checkpoint');
      storage.storeValue(
        MATRIX_CHECKPOINT_STATE_STORAGE_KEY,
        MATRIX_CHECKPOINT_STATE_SAFE,
      );
      const client = makeClient(storage);
      const response = deferred<any>();
      client.responses.push(response.promise);
      client.on('room.event', async () => Promise.resolve());

      void client.beginSync();
      await waitFor(() => client.requestedSince.length === 1);
      const pausePromise = client.pauseAtSyncBoundary(1_000, 2_000);
      expect(storage.readValue(MATRIX_CHECKPOINT_STATE_STORAGE_KEY)).toBe(
        'pending',
      );
      response.resolve({
        ...batchWithMessages(1),
        next_batch: 'checkpoint-token',
      });

      const lease = await pausePromise;
      expect(storage.getSyncToken()).toBe('checkpoint-token');
      expect(storage.readValue(MATRIX_CHECKPOINT_STATE_STORAGE_KEY)).toBe(
        MATRIX_CHECKPOINT_STATE_SAFE,
      );

      const reopened = new AtomicFsStorageProvider(filename);
      const restartedClient = makeClient(reopened);
      await expect(
        restartedClient.assertCheckpointSafe(),
      ).resolves.toBeUndefined();
      expect(reopened.getSyncToken()).toBe('checkpoint-token');
      expect(reopened.readValue(MATRIX_CHECKPOINT_STATE_STORAGE_KEY)).toBe(
        MATRIX_CHECKPOINT_STATE_SAFE,
      );

      client.stop();
      lease.release();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('preserves once listeners, listener order, and EventEmitter receiver context', async () => {
    const client = makeClient();
    const calls: string[] = [];
    const receiver: unknown[] = [];
    client.once('room.event', function (this: TestMatrixClient) {
      calls.push('once');
      receiver.push(this);
    });
    client.on('room.event', function (this: TestMatrixClient) {
      calls.push('regular');
      receiver.push(this);
    });

    await client.processRaw(batchWithMessages(2));

    expect(calls).toEqual(['once', 'regular', 'regular']);
    expect(receiver).toEqual([client, client, client]);
    expect(client.listenerCount('room.event')).toBe(1);
  });

  it('latches checkpoint safety when an awaited listener rejects', async () => {
    const storage = new CheckpointStorageProvider();
    storage.setSyncToken('old-token');
    storage.storeValue(
      MATRIX_CHECKPOINT_STATE_STORAGE_KEY,
      MATRIX_CHECKPOINT_STATE_SAFE,
    );
    const client = makeClient(storage);

    client.on('room.event', async () => {
      throw new Error('listener failed');
    });

    await expect(client.processRaw(batchWithMessages(1))).rejects.toThrow(
      'listener failed',
    );

    expect(storage.getSyncToken()).toBe('old-token');
    await expect(client.assertCheckpointSafe()).rejects.toThrow(
      'Matrix checkpoint is not known safe; operator review is required',
    );
    const restartedClient = makeClient(storage);
    await expect(restartedClient.assertCheckpointSafe()).rejects.toThrow(
      'Matrix checkpoint is not known safe; operator review is required',
    );
  });

  it('writes pending before requesting sync and remains unsafe if unsafe-marker persistence fails', async () => {
    class FaultingStorage extends CheckpointStorageProvider {
      failUnsafeMarker = false;

      override storeValue(key: string, value: string): void {
        if (this.failUnsafeMarker && value === 'unsafe') {
          throw new Error('injected marker write failure');
        }
        super.storeValue(key, value);
      }
    }

    const storage = new FaultingStorage();
    storage.setSyncToken('old-token');
    storage.storeValue(MATRIX_CHECKPOINT_STATE_STORAGE_KEY, 'pending');
    const client = makeClient(storage);
    client.on('room.event', async () => {
      storage.failUnsafeMarker = true;
      await client.markCheckpointUnsafe();
    });

    await expect(client.processRaw(batchWithMessages(1))).rejects.toThrow(
      'injected marker write failure',
    );
    expect(storage.readValue(MATRIX_CHECKPOINT_STATE_STORAGE_KEY)).toBe(
      'pending',
    );
    await expect(makeClient(storage).assertCheckpointSafe()).rejects.toThrow(
      'Matrix checkpoint is not known safe; operator review is required',
    );
  });

  it('does not issue a sync request when the write-ahead marker cannot be stored', async () => {
    class FaultingStorage extends CheckpointStorageProvider {
      override storeValue(key: string, value: string): void {
        if (
          key === MATRIX_CHECKPOINT_STATE_STORAGE_KEY &&
          value === 'pending'
        ) {
          throw new Error('injected pending write failure');
        }
        super.storeValue(key, value);
      }
    }

    const client = makeClient(new FaultingStorage());
    await expect(client.requestSync('old-token')).rejects.toThrow(
      'injected pending write failure',
    );
    expect(client.requestedSince).toEqual([]);
  });

  it('does not clear an unsafe state on restart after a later successful sync', async () => {
    const storage = new CheckpointStorageProvider();
    storage.setSyncToken('old-token');
    storage.storeValue(MATRIX_CHECKPOINT_STATE_STORAGE_KEY, 'unsafe');
    const client = makeClient(storage);
    const secondResponse = deferred<any>();
    client.responses.push(
      { ...batchWithMessages(1), next_batch: 'next-token' },
      secondResponse.promise,
    );

    void client.beginSync();
    await waitFor(() => client.requestedSince.length === 2);

    expect(storage.readValue(MATRIX_CHECKPOINT_STATE_STORAGE_KEY)).toBe(
      'unsafe',
    );
    await expect(client.assertCheckpointSafe()).rejects.toThrow(
      'Matrix checkpoint is not known safe; operator review is required',
    );
    client.stop();
    secondResponse.resolve({ next_batch: 'after-stop' });
  });

  it('records a caught handler failure while preserving the SDK sync loop behavior', async () => {
    const storage = new CheckpointStorageProvider();
    storage.setSyncToken('old-token');
    storage.storeValue(
      MATRIX_CHECKPOINT_STATE_STORAGE_KEY,
      MATRIX_CHECKPOINT_STATE_SAFE,
    );
    const client = makeClient(storage);
    const secondResponse = deferred<any>();
    client.responses.push(
      { ...batchWithMessages(1), next_batch: 'cursor-after-failure' },
      secondResponse.promise,
    );

    client.on('room.event', async () => {
      try {
        throw new Error('handler failed');
      } catch {
        // MatrixServer's current listener catches and logs this error.
        await client.markCheckpointUnsafe();
      }
    });

    void client.beginSync();
    await waitFor(() => client.requestedSince.length === 2);

    // Pinned SDK startSync advances its in-memory and persisted cursor after a
    // listener resolves. The sticky unsafe latch must prevent a backup from
    // presenting that state as a consistent checkpoint.
    expect(client.requestedSince).toEqual([
      'old-token',
      'cursor-after-failure',
    ]);
    expect(storage.getSyncToken()).toBe('cursor-after-failure');
    await expect(client.assertCheckpointSafe()).rejects.toThrow(
      'Matrix checkpoint is not known safe; operator review is required',
    );

    client.stop();
    secondResponse.resolve({ next_batch: 'after-stop' });
  });

  it('releases the paused SDK loop when stop is called', async () => {
    const storage = new CheckpointStorageProvider();
    storage.setSyncToken('old-token');
    storage.storeValue(
      MATRIX_CHECKPOINT_STATE_STORAGE_KEY,
      MATRIX_CHECKPOINT_STATE_SAFE,
    );
    const client = makeClient(storage);
    const firstResponse = deferred<any>();
    client.responses.push(firstResponse.promise);
    void client.beginSync();
    await waitFor(() => client.requestedSince.length === 1);

    const leasePromise = client.pauseAtSyncBoundary(1_000, 1_000);
    firstResponse.resolve({ next_batch: 'next-token' });
    const lease = await leasePromise;
    client.stop();

    expect(() => lease.assertActive()).toThrow(
      'Matrix sync pause lease is no longer active',
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(client.requestedSince).toEqual(['old-token']);
  });

  it('expires a pause lease and resumes sync if the coordinator does not release it', async () => {
    const client = makeClient();
    const firstResponse = deferred<any>();
    const secondResponse = deferred<any>();
    client.responses.push(firstResponse.promise, secondResponse.promise);
    void client.beginSync();
    await waitFor(() => client.requestedSince.length === 1);

    const leasePromise = client.pauseAtSyncBoundary(1_000, 10);
    firstResponse.resolve({ next_batch: 'next-token' });
    const lease = await leasePromise;
    await waitFor(() => client.requestedSince.length === 2);
    expect(() => lease.assertActive()).toThrow(
      'Matrix sync pause lease is no longer active',
    );
    client.stop();
    secondResponse.resolve({ next_batch: 'after-stop' });
  });

  it('releases a timed-out boundary request', async () => {
    const client = makeClient();
    await expect(client.pauseAtSyncBoundary(5)).rejects.toThrow(
      'Timed out waiting for a Matrix sync boundary',
    );
    expect(() => client.resume()).not.toThrow();
  });

  it('keeps the checkpoint safety API available through the app client proxy', async () => {
    const client = makeClient();
    const proxiedClient = new Proxy(client, new MatrixClientProxyHandler());
    const checkpointClient = proxiedClient as CheckpointMatrixClient;

    expect(proxiedClient instanceof CheckpointMatrixClient).toBe(true);
    await checkpointClient.markCheckpointUnsafe();
    await expect(checkpointClient.assertCheckpointSafe()).rejects.toThrow(
      'Matrix checkpoint is not known safe; operator review is required',
    );
  });
});
