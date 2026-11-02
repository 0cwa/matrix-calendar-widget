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

import { AppWriteFenceService } from './AppWriteFenceService';

describe('AppWriteFenceService', () => {
  it('closes admission, drains active writes, and reopens on release', async () => {
    const fence = new AppWriteFenceService();
    const existingWrite = fence.admitWrite();
    expect(existingWrite).toBeDefined();
    const onExpire = jest.fn();

    const acquiring = fence.acquireCheckpointFence(1_000, 5_000, onExpire);
    expect(fence.admitWrite()).toBeUndefined();
    existingWrite?.release();

    const lease = await acquiring;
    expect(onExpire).not.toHaveBeenCalled();
    expect(fence.admitWrite()).toBeUndefined();
    lease.assertActive();
    lease.release();

    const resumedWrite = fence.admitWrite();
    expect(resumedWrite).toBeDefined();
    resumedWrite?.release();
  });

  it('reopens admission if active writes do not drain before the deadline', async () => {
    const fence = new AppWriteFenceService();
    const existingWrite = fence.admitWrite();

    await expect(
      fence.acquireCheckpointFence(1, 5_000, jest.fn()),
    ).rejects.toThrow('Timed out draining application writes');

    const resumedWrite = fence.admitWrite();
    expect(resumedWrite).toBeDefined();
    resumedWrite?.release();
    existingWrite?.release();
  });

  it('waits to run a complete scheduled task until a checkpoint lease releases', async () => {
    const fence = new AppWriteFenceService();
    const lease = await fence.acquireCheckpointFence(1_000, 5_000, jest.fn());
    const run = jest.fn(async () => ({ completed: true }));
    const controller = new AbortController();

    const scheduledRun = fence.runWhenOpen(run, controller.signal);
    await Promise.resolve();
    expect(run).not.toHaveBeenCalled();

    lease.release();
    await expect(scheduledRun).resolves.toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('cancels a scheduled task waiting on the fence during shutdown', async () => {
    const fence = new AppWriteFenceService();
    const lease = await fence.acquireCheckpointFence(1_000, 5_000, jest.fn());
    const run = jest.fn(async () => undefined);
    const controller = new AbortController();
    const scheduledRun = fence.runWhenOpen(run, controller.signal);

    controller.abort();
    await expect(scheduledRun).resolves.toBe(false);
    expect(run).not.toHaveBeenCalled();
    lease.release();
  });

  it('releases the checkpoint lease and its timer during module shutdown', async () => {
    jest.useFakeTimers();
    try {
      const fence = new AppWriteFenceService();
      const releaseMatrixPause = jest.fn();
      const lease = await fence.acquireCheckpointFence(
        1_000,
        120_000,
        releaseMatrixPause,
      );

      expect(jest.getTimerCount()).toBe(1);
      fence.onModuleDestroy();

      expect(jest.getTimerCount()).toBe(0);
      expect(releaseMatrixPause).toHaveBeenCalledTimes(1);
      expect(() => lease.assertActive()).toThrow(
        'Application write fence lease is no longer active',
      );
      const resumedWrite = fence.admitWrite();
      expect(resumedWrite).toBeDefined();
      resumedWrite?.release();
    } finally {
      jest.useRealTimers();
    }
  });

  it('cancels a pending drain and its timeout during module shutdown', async () => {
    jest.useFakeTimers();
    let existingWrite: ReturnType<AppWriteFenceService['admitWrite']> =
      undefined;
    try {
      const fence = new AppWriteFenceService();
      existingWrite = fence.admitWrite();
      const releaseMatrixPause = jest.fn();
      const acquiring = fence.acquireCheckpointFence(
        30_000,
        120_000,
        releaseMatrixPause,
      );

      expect(jest.getTimerCount()).toBe(2);
      fence.onModuleDestroy();

      await expect(acquiring).rejects.toThrow(
        'Application write fence stopped during shutdown',
      );
      expect(jest.getTimerCount()).toBe(0);
      expect(releaseMatrixPause).toHaveBeenCalledTimes(1);
      const resumedWrite = fence.admitWrite();
      expect(resumedWrite).toBeDefined();
      resumedWrite?.release();
    } finally {
      existingWrite?.release();
      jest.useRealTimers();
    }
  });
});
