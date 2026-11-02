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

import { OnModuleDestroy } from '@nestjs/common';

export interface AppWriteAdmission {
  release(): void;
}

export interface AppWriteFenceLease {
  readonly expiresAt: number;
  assertActive(): void;
  release(): void;
}

/** Closes app write admission and drains HTTP and scheduled writes for backup. */
export class AppWriteFenceService implements OnModuleDestroy {
  private generation = 0;
  private closedGeneration: number | undefined;
  private activeWrites = 0;
  private leaseTimer: ReturnType<typeof setTimeout> | undefined;
  private onLeaseEnd: (() => void) | undefined;
  private readonly drainWaiters = new Set<() => void>();
  private readonly cancelDrainWaiters = new Set<() => void>();
  private readonly openWaiters = new Set<() => void>();

  /** Release an active checkpoint fence during application shutdown. */
  onModuleDestroy(): void {
    const generation = this.closedGeneration;
    if (generation === undefined) return;

    const onLeaseEnd = this.onLeaseEnd;
    for (const cancel of this.cancelDrainWaiters) cancel();
    this.open(generation);
    onLeaseEnd?.();
  }

  /** Admit one write until the owning HTTP response or scheduler run completes. */
  admitWrite(): AppWriteAdmission | undefined {
    if (this.closedGeneration !== undefined) return undefined;

    this.activeWrites += 1;
    let active = true;
    return {
      release: () => {
        if (!active) return;
        active = false;
        this.activeWrites -= 1;
        if (this.activeWrites === 0) {
          for (const resolve of this.drainWaiters) resolve();
          this.drainWaiters.clear();
        }
      },
    };
  }

  /**
   * Stop admitting writes, wait for admitted work to finish, then hold the
   * fence until release or its fixed deadline. Expiry also resumes Matrix sync.
   */
  async acquireCheckpointFence(
    drainTimeoutMs: number,
    leaseTimeoutMs: number,
    onExpire: () => void,
  ): Promise<AppWriteFenceLease> {
    if (this.closedGeneration !== undefined) {
      throw new Error('Application write fence is already active');
    }
    if (
      !Number.isSafeInteger(drainTimeoutMs) ||
      drainTimeoutMs < 1 ||
      !Number.isSafeInteger(leaseTimeoutMs) ||
      leaseTimeoutMs < 1
    ) {
      throw new Error('Application write fence timeout is invalid');
    }

    const generation = ++this.generation;
    const expiresAt = Date.now() + leaseTimeoutMs;
    this.closedGeneration = generation;
    this.onLeaseEnd = onExpire;
    this.leaseTimer = setTimeout(() => {
      if (this.closedGeneration !== generation) return;
      this.open(generation);
      onExpire();
    }, leaseTimeoutMs);

    try {
      await this.waitForDrain(drainTimeoutMs);
      if (this.closedGeneration !== generation || Date.now() >= expiresAt) {
        throw new Error('Application write fence expired during acquisition');
      }

      return {
        expiresAt,
        assertActive: () => {
          if (this.closedGeneration !== generation || Date.now() >= expiresAt) {
            throw new Error(
              'Application write fence lease is no longer active',
            );
          }
        },
        release: () => this.open(generation),
      };
    } catch (error) {
      this.open(generation);
      throw error;
    }
  }

  /** Run one complete scheduler task after the fence opens, or stop on abort. */
  async runWhenOpen(
    run: () => Promise<unknown>,
    signal: AbortSignal,
  ): Promise<boolean> {
    while (!signal.aborted) {
      const admission = this.admitWrite();
      if (admission) {
        try {
          await run();
          return true;
        } finally {
          admission.release();
        }
      }

      if (!(await this.waitUntilOpen(signal))) return false;
    }
    return false;
  }

  private waitForDrain(timeoutMs: number): Promise<void> {
    if (this.activeWrites === 0) return Promise.resolve();

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.drainWaiters.delete(onDrained);
        this.cancelDrainWaiters.delete(onShutdown);
        if (error) reject(error);
        else resolve();
      };
      const onDrained = () => finish();
      const onShutdown = () =>
        finish(new Error('Application write fence stopped during shutdown'));
      const timer = setTimeout(
        () => finish(new Error('Timed out draining application writes')),
        timeoutMs,
      );
      this.drainWaiters.add(onDrained);
      this.cancelDrainWaiters.add(onShutdown);
      if (this.activeWrites === 0) onDrained();
    });
  }

  private waitUntilOpen(signal: AbortSignal): Promise<boolean> {
    if (signal.aborted) return Promise.resolve(false);
    if (this.closedGeneration === undefined) return Promise.resolve(true);

    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (opened: boolean) => {
        if (settled) return;
        settled = true;
        this.openWaiters.delete(onOpen);
        signal.removeEventListener('abort', onAbort);
        resolve(opened);
      };
      const onOpen = () => finish(true);
      const onAbort = () => finish(false);
      this.openWaiters.add(onOpen);
      signal.addEventListener('abort', onAbort, { once: true });
      if (this.closedGeneration === undefined) onOpen();
    });
  }

  private open(generation: number): void {
    if (this.closedGeneration !== generation) return;
    this.closedGeneration = undefined;
    if (this.leaseTimer) clearTimeout(this.leaseTimer);
    this.leaseTimer = undefined;
    this.onLeaseEnd = undefined;
    for (const resolve of this.openWaiters) resolve();
    this.openWaiters.clear();
  }
}
