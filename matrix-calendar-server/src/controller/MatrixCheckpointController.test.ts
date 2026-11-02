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
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import type { Request } from 'express';
import { MemoryStorageProvider } from 'matrix-bot-sdk';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { IAppConfiguration } from '../IAppConfiguration';
import {
  AtomicFsStorageProvider,
  MATRIX_CHECKPOINT_STATE_SAFE,
  MATRIX_CHECKPOINT_STATE_STORAGE_KEY,
  writeJsonAtomically,
} from '../matrix/AtomicFsStorageProvider';
import { CheckpointMatrixClient } from '../matrix/CheckpointMatrixClient';
import { AppWriteFenceService } from '../service/AppWriteFenceService';
import { MatrixCheckpointController } from './MatrixCheckpointController';

const token = 'synthetic-checkpoint-token-that-is-long-enough';
const auth = token;
const localRequest = (remoteAddress = '127.0.0.1') =>
  ({ socket: { remoteAddress } }) as Request;
const safeClient = () => {
  const storage = new MemoryStorageProvider();
  storage.storeValue('matrix_calendar_checkpoint_state', 'safe');
  return new CheckpointMatrixClient(
    'https://matrix.example.org',
    'test-token',
    storage,
  );
};
const config = (overrides: Partial<IAppConfiguration> = {}) =>
  ({
    checkpoint_control_token: token,
    enable_crypto: false,
    ...overrides,
  }) as IAppConfiguration;

describe('MatrixCheckpointController', () => {
  it('exposes explicit acquire, verify, and release control routes', () => {
    expect(Reflect.getMetadata(PATH_METADATA, MatrixCheckpointController)).toBe(
      'internal/backup-checkpoint',
    );
    for (const method of ['acquire', 'verify', 'release'] as const) {
      expect(
        Reflect.getMetadata(
          METHOD_METADATA,
          MatrixCheckpointController.prototype[method],
        ),
      ).toBe(1);
    }
  });

  it('requires the configured dedicated control token', async () => {
    const controller = new MatrixCheckpointController(config(), safeClient());
    await expect(
      controller.acquire(undefined, localRequest()),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      controller.acquire('wrong-token', localRequest()),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      controller.acquire(auth, localRequest('192.168.1.2')),
    ).rejects.toBeInstanceOf(NotFoundException);

    const disabled = new MatrixCheckpointController(
      config({ checkpoint_control_token: undefined }),
      safeClient(),
    );
    await expect(disabled.acquire(auth, localRequest())).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('refuses checkpoint acquisition while Matrix crypto is enabled', async () => {
    const controller = new MatrixCheckpointController(
      config({ enable_crypto: true }),
      safeClient(),
    );
    await expect(
      controller.acquire(auth, localRequest()),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('holds a sync lease until verified and released by the coordinator', async () => {
    const client = safeClient();
    const lease = { assertActive: jest.fn(), release: jest.fn() };
    jest.spyOn(client, 'pauseAtSyncBoundary').mockResolvedValue(lease);
    const controller = new MatrixCheckpointController(config(), client);

    const acquired = await controller.acquire(auth, localRequest());
    expect(acquired.leaseTimeoutMs).toBeGreaterThan(0);
    expect(acquired.leaseTimeoutMs).toBeLessThanOrEqual(120_000);
    await expect(
      controller.verify(acquired.leaseId, auth, localRequest()),
    ).resolves.toEqual({ active: true });
    expect(lease.assertActive).toHaveBeenCalledTimes(5);
    expect(controller.release(acquired.leaseId, auth, localRequest())).toEqual({
      released: true,
    });
    expect(lease.release).toHaveBeenCalledTimes(1);
    await expect(
      controller.verify(acquired.leaseId, auth, localRequest()),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('holds app write admission closed for the acquired Matrix lease', async () => {
    const client = safeClient();
    const syncLease = { assertActive: jest.fn(), release: jest.fn() };
    jest.spyOn(client, 'pauseAtSyncBoundary').mockResolvedValue(syncLease);
    const writeFence = new AppWriteFenceService();
    const controller = new MatrixCheckpointController(
      config(),
      client,
      writeFence,
    );

    const acquired = await controller.acquire(auth, localRequest());
    expect(writeFence.admitWrite()).toBeUndefined();

    expect(controller.release(acquired.leaseId, auth, localRequest())).toEqual({
      released: true,
    });
    expect(syncLease.release).toHaveBeenCalledTimes(1);
    const resumedWrite = writeFence.admitWrite();
    expect(resumedWrite).toBeDefined();
    resumedWrite?.release();
  });

  it('unwinds the Matrix pause and write fence if final checkpoint validation fails', async () => {
    const client = safeClient();
    const syncLease = { assertActive: jest.fn(), release: jest.fn() };
    jest.spyOn(client, 'pauseAtSyncBoundary').mockResolvedValue(syncLease);
    jest
      .spyOn(client, 'assertCheckpointSafe')
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('checkpoint state changed'));
    const writeFence = new AppWriteFenceService();
    const controller = new MatrixCheckpointController(
      config(),
      client,
      writeFence,
    );

    await expect(controller.acquire(auth, localRequest())).rejects.toThrow(
      'checkpoint state changed',
    );
    expect(syncLease.release).toHaveBeenCalledTimes(1);
    const resumedWrite = writeFence.admitWrite();
    expect(resumedWrite).toBeDefined();
    resumedWrite?.release();
  });

  it('rechecks lease expiry after the final checkpoint safety await', async () => {
    jest.useFakeTimers();
    try {
      const client = safeClient();
      const syncLease = { assertActive: jest.fn(), release: jest.fn() };
      jest.spyOn(client, 'pauseAtSyncBoundary').mockResolvedValue(syncLease);
      let beginFinalSafetyCheck!: () => void;
      const finalSafetyStarted = new Promise<void>((resolve) => {
        beginFinalSafetyCheck = resolve;
      });
      let completeFinalSafetyCheck!: () => void;
      const finalSafety = new Promise<void>((resolve) => {
        completeFinalSafetyCheck = resolve;
      });
      jest
        .spyOn(client, 'assertCheckpointSafe')
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockImplementationOnce(() => {
          beginFinalSafetyCheck();
          return finalSafety;
        });
      const controller = new MatrixCheckpointController(
        config(),
        client,
        new AppWriteFenceService(),
      );

      const acquiring = controller.acquire(auth, localRequest());
      await finalSafetyStarted;
      await jest.advanceTimersByTimeAsync(120_000);
      completeFinalSafetyCheck();

      await expect(acquiring).rejects.toThrow(
        'Application write fence lease is no longer active',
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('shares one 30-second deadline between Matrix pause and app write drain', async () => {
    jest.useFakeTimers();
    try {
      const client = safeClient();
      const syncLease = { assertActive: jest.fn(), release: jest.fn() };
      let completePause!: (lease: typeof syncLease) => void;
      let notifyPauseStarted!: () => void;
      const pauseStarted = new Promise<void>((resolve) => {
        notifyPauseStarted = resolve;
      });
      const pause = jest
        .spyOn(client, 'pauseAtSyncBoundary')
        .mockImplementation(
          () =>
            new Promise((resolve) => {
              completePause = resolve;
              notifyPauseStarted();
            }),
        );
      const writeFence = new AppWriteFenceService();
      const acquireFence = jest.spyOn(writeFence, 'acquireCheckpointFence');
      const controller = new MatrixCheckpointController(
        config(),
        client,
        writeFence,
      );

      const acquiring = controller.acquire(auth, localRequest());
      await pauseStarted;
      expect(pause).toHaveBeenCalledWith(30_000, 121_000);
      await jest.advanceTimersByTimeAsync(20_000);
      completePause(syncLease);
      const acquired = await acquiring;

      expect(acquireFence).toHaveBeenCalledWith(
        10_000,
        120_000,
        expect.any(Function),
      );
      controller.release(acquired.leaseId, auth, localRequest());
    } finally {
      jest.useRealTimers();
    }
  });

  it('rejects an expired or invalid lease before backup proceeds', async () => {
    const client = safeClient();
    const lease = {
      assertActive: jest
        .fn()
        .mockImplementationOnce(() => undefined)
        .mockImplementationOnce(() => undefined)
        .mockImplementationOnce(() => undefined)
        .mockImplementationOnce(() => undefined)
        .mockImplementation(() => {
          throw new Error('expired');
        }),
      release: jest.fn(),
    };
    jest.spyOn(client, 'pauseAtSyncBoundary').mockResolvedValue(lease);
    const controller = new MatrixCheckpointController(config(), client);
    const acquired = await controller.acquire(auth, localRequest());

    await expect(
      controller.verify(acquired.leaseId, auth, localRequest()),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('releases a lease if it expires while checkpoint safety is checked', async () => {
    const client = safeClient();
    const lease = { assertActive: jest.fn(), release: jest.fn() };
    jest.spyOn(client, 'pauseAtSyncBoundary').mockResolvedValue(lease);
    const assertSafe = jest
      .spyOn(client, 'assertCheckpointSafe')
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);
    const controller = new MatrixCheckpointController(config(), client);
    const acquired = await controller.acquire(auth, localRequest());
    assertSafe.mockImplementationOnce(async () => {
      controller.release(acquired.leaseId, auth, localRequest());
    });

    await expect(
      controller.verify(acquired.leaseId, auth, localRequest()),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(lease.release).toHaveBeenCalledTimes(1);
  });

  it('refuses acquisition when a replaced pending latch has uncertain directory durability', async () => {
    const directory = fs.mkdtempSync(path.join(tmpdir(), 'checkpoint-test-'));
    const filename = path.join(directory, 'bot.json');
    let failDirectorySync = false;
    const fileSystem: Parameters<typeof writeJsonAtomically>[2] = {
      ...fs,
      fsyncSync: (descriptor) => {
        if (failDirectorySync && fs.fstatSync(descriptor).isDirectory()) {
          throw new Error('synthetic directory fsync failure');
        }
        fs.fsyncSync(descriptor);
      },
    };
    try {
      const storage = new AtomicFsStorageProvider(
        filename,
        true,
        20,
        fileSystem,
      );
      storage.storeValue(
        MATRIX_CHECKPOINT_STATE_STORAGE_KEY,
        MATRIX_CHECKPOINT_STATE_SAFE,
      );
      const client = new CheckpointMatrixClient(
        'https://matrix.example.org',
        'test-token',
        storage,
      );
      const pause = jest.spyOn(client, 'pauseAtSyncBoundary');
      failDirectorySync = true;

      expect(() =>
        storage.storeValue(MATRIX_CHECKPOINT_STATE_STORAGE_KEY, 'pending'),
      ).toThrow(
        expect.objectContaining({
          name: 'AtomicJsonWriteError',
          targetReplaced: true,
        }),
      );
      const controller = new MatrixCheckpointController(config(), client);
      await expect(controller.acquire(auth, localRequest())).rejects.toThrow(
        'Matrix checkpoint is not known safe; operator review is required',
      );
      expect(pause).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
