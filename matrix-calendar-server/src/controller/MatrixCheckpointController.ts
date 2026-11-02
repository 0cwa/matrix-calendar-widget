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
  Controller,
  Header,
  Headers,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Request } from 'express';
import { MatrixClient } from 'matrix-bot-sdk';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { IAppConfiguration } from '../IAppConfiguration';
import { ModuleProviderToken } from '../ModuleProviderToken';
import {
  CheckpointMatrixClient,
  MatrixSyncPauseLease,
} from '../matrix/CheckpointMatrixClient';
import {
  AppWriteFenceLease,
  AppWriteFenceService,
} from '../service/AppWriteFenceService';

const CHECKPOINT_BOUNDARY_TIMEOUT_MS = 30_000;
const CHECKPOINT_LEASE_TIMEOUT_MS = 120_000;
const CHECKPOINT_TOKEN_HEADER = 'x-matrix-checkpoint-token';

/**
 * Internal control surface for a host-side online backup coordinator.
 * Disabled unless a dedicated control token is configured. It pauses Matrix
 * sync and drains app-owned writes before exposing a checkpoint lease.
 */
@Controller({ path: 'internal/backup-checkpoint', version: ['1'] })
export class MatrixCheckpointController {
  private readonly leases = new Map<string, MatrixSyncPauseLease>();

  constructor(
    @Inject(ModuleProviderToken.APP_CONFIGURATION)
    private readonly appConfig: IAppConfiguration,
    private readonly matrixClient: MatrixClient,
    @Inject(AppWriteFenceService)
    private readonly writeFence: AppWriteFenceService = new AppWriteFenceService(),
  ) {}

  @Post('acquire')
  @Header('Cache-Control', 'no-store')
  async acquire(
    @Headers(CHECKPOINT_TOKEN_HEADER) controlToken: string | undefined,
    @Req() request: Request,
  ) {
    this.authorize(controlToken, request);
    this.pruneExpiredLeases();
    if (this.leases.size > 0) {
      throw new ConflictException(
        'A Matrix checkpoint lease is already active',
      );
    }
    if (this.appConfig.enable_crypto) {
      throw new ServiceUnavailableException(
        'Online checkpoints are unavailable while Matrix crypto is enabled',
      );
    }

    const client = this.getCheckpointClient();
    await client.assertCheckpointSafe();
    const syncLease = await client.pauseAtSyncBoundary(
      CHECKPOINT_BOUNDARY_TIMEOUT_MS,
      CHECKPOINT_LEASE_TIMEOUT_MS + 1_000,
    );
    let writeLease: AppWriteFenceLease | undefined;
    try {
      syncLease.assertActive();
      await client.assertCheckpointSafe();
      writeLease = await this.writeFence.acquireCheckpointFence(
        CHECKPOINT_BOUNDARY_TIMEOUT_MS,
        CHECKPOINT_LEASE_TIMEOUT_MS,
        () => syncLease.release(),
      );
      const lease: MatrixSyncPauseLease = {
        assertActive: () => {
          syncLease.assertActive();
          writeLease?.assertActive();
        },
        release: () => {
          try {
            syncLease.release();
          } finally {
            writeLease?.release();
          }
        },
      };
      lease.assertActive();
      await client.assertCheckpointSafe();
      const leaseId = randomUUID();
      this.leases.set(leaseId, lease);
      return {
        leaseId,
        leaseTimeoutMs: Math.max(0, writeLease.expiresAt - Date.now()),
      };
    } catch (error) {
      try {
        syncLease.release();
      } finally {
        writeLease?.release();
      }
      throw error;
    }
  }

  @Post(':leaseId/verify')
  @Header('Cache-Control', 'no-store')
  async verify(
    @Param('leaseId') leaseId: string,
    @Headers(CHECKPOINT_TOKEN_HEADER) controlToken: string | undefined,
    @Req() request: Request,
  ) {
    this.authorize(controlToken, request);
    if (this.appConfig.enable_crypto) {
      throw new ServiceUnavailableException(
        'Online checkpoints are unavailable while Matrix crypto is enabled',
      );
    }

    const lease = this.leases.get(leaseId);
    if (!lease) {
      throw new ConflictException('Matrix checkpoint lease is unavailable');
    }
    try {
      lease.assertActive();
      await this.getCheckpointClient().assertCheckpointSafe();
      if (this.leases.get(leaseId) !== lease) {
        throw new Error('Matrix checkpoint lease changed during verification');
      }
      lease.assertActive();
      return { active: true };
    } catch {
      if (this.leases.get(leaseId) === lease) {
        this.leases.delete(leaseId);
        lease.release();
      }
      throw new ConflictException('Matrix checkpoint lease is unavailable');
    }
  }

  @Post(':leaseId/release')
  @Header('Cache-Control', 'no-store')
  release(
    @Param('leaseId') leaseId: string,
    @Headers(CHECKPOINT_TOKEN_HEADER) controlToken: string | undefined,
    @Req() request: Request,
  ) {
    this.authorize(controlToken, request);
    const lease = this.leases.get(leaseId);
    if (!lease) {
      throw new ConflictException('Matrix checkpoint lease is unavailable');
    }
    this.leases.delete(leaseId);
    lease.release();
    return { released: true };
  }

  private authorize(controlToken: string | undefined, request: Request): void {
    const expected = this.appConfig.checkpoint_control_token;
    if (
      !expected ||
      !isLoopbackAddress(request.socket.remoteAddress) ||
      !controlToken
    ) {
      throw new NotFoundException();
    }
    const supplied = Buffer.from(controlToken);
    const configured = Buffer.from(expected);
    if (
      supplied.byteLength !== configured.byteLength ||
      !timingSafeEqual(supplied, configured)
    ) {
      throw new NotFoundException();
    }
  }

  private getCheckpointClient(): CheckpointMatrixClient {
    if (!(this.matrixClient instanceof CheckpointMatrixClient)) {
      throw new ServiceUnavailableException(
        'Matrix checkpoint control is unavailable',
      );
    }
    return this.matrixClient;
  }

  private pruneExpiredLeases(): void {
    for (const [leaseId, lease] of this.leases) {
      try {
        lease.assertActive();
      } catch {
        this.leases.delete(leaseId);
        lease.release();
      }
    }
  }
}

function isLoopbackAddress(address: string | undefined): boolean {
  return (
    address === '127.0.0.1' ||
    address === '::1' ||
    address === '::ffff:127.0.0.1'
  );
}
