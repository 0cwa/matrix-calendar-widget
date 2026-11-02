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
import { IAppConfiguration } from '../IAppConfiguration';
import { CheckpointMatrixClient } from '../matrix/CheckpointMatrixClient';
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
    expect(acquired.leaseTimeoutMs).toBe(120_000);
    await expect(
      controller.verify(acquired.leaseId, auth, localRequest()),
    ).resolves.toEqual({ active: true });
    expect(lease.assertActive).toHaveBeenCalledTimes(3);
    expect(controller.release(acquired.leaseId, auth, localRequest())).toEqual({
      released: true,
    });
    expect(lease.release).toHaveBeenCalledTimes(1);
    await expect(
      controller.verify(acquired.leaseId, auth, localRequest()),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects an expired or invalid lease before backup proceeds', async () => {
    const client = safeClient();
    const lease = {
      assertActive: jest
        .fn()
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
});
