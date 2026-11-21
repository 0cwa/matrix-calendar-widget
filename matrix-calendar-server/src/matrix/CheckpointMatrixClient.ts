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

import { MatrixClient } from 'matrix-bot-sdk';
import {
  MATRIX_CHECKPOINT_STATE_PROCESSED,
  MATRIX_CHECKPOINT_STATE_SAFE,
  MATRIX_CHECKPOINT_STATE_STORAGE_KEY,
} from './AtomicFsStorageProvider';

const CHECKPOINT_PENDING = 'pending';
const CHECKPOINT_UNSAFE = 'unsafe';

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  ((typeof value === 'object' && value !== null) ||
    typeof value === 'function') &&
  typeof (value as { then?: unknown }).then === 'function';

export interface MatrixSyncPauseLease {
  /** Throw if the pause was released, stopped, or expired. */
  assertActive(): void;
  /** Release the pause and resume sync. */
  release(): void;
}

/**
 * MatrixClient variant that persists a sync cursor only after all asynchronous
 * EventEmitter listeners for that sync batch have completed, and can pause
 * before issuing the next /sync request.
 */
export class CheckpointMatrixClient extends MatrixClient {
  protected persistTokenAfterSync = true;

  private pauseRequested = false;
  private paused = false;
  private boundaryReached: (() => void) | undefined;
  private rejectBoundaryWait: ((error: Error) => void) | undefined;
  private resumeSyncLoop: (() => void) | undefined;
  private pauseLeaseTimer: ReturnType<typeof setTimeout> | undefined;
  private pauseGeneration = 0;
  private expiredPauseGeneration: number | undefined;
  private stopped = false;
  private checkpointUnsafe = false;

  /**
   * Persist a write-ahead state before requesting another sync batch. If the
   * process exits before all listeners finish, the next process sees pending
   * and refuses checkpoint acquisition.
   */
  private async markCheckpointPending(): Promise<void> {
    if (this.checkpointUnsafe) {
      return;
    }
    const existingState = await Promise.resolve(
      this.storageProvider.readValue(MATRIX_CHECKPOINT_STATE_STORAGE_KEY),
    );
    const existingToken = await Promise.resolve(
      this.storageProvider.getSyncToken(),
    );
    if (
      existingState === CHECKPOINT_PENDING ||
      existingState === CHECKPOINT_UNSAFE ||
      (existingState !== MATRIX_CHECKPOINT_STATE_SAFE &&
        existingToken != null) ||
      (existingState != null && existingState !== MATRIX_CHECKPOINT_STATE_SAFE)
    ) {
      // A prior interrupted batch, explicit failure, or legacy cursor with no
      // state requires operator review. Do not erase that evidence on restart.
      this.checkpointUnsafe = true;
      if (existingState !== CHECKPOINT_PENDING) {
        try {
          await this.markCheckpointUnsafe();
        } catch {
          // The existing non-safe state or legacy cursor remains fail-closed.
        }
      }
      return;
    }
    await Promise.resolve(
      this.storageProvider.storeValue(
        MATRIX_CHECKPOINT_STATE_STORAGE_KEY,
        CHECKPOINT_PENDING,
      ),
    );
  }

  /** Mark backup snapshots unsafe after Matrix event processing failed. */
  async markCheckpointUnsafe(): Promise<void> {
    this.checkpointUnsafe = true;
    await Promise.resolve(
      this.storageProvider.storeValue(
        MATRIX_CHECKPOINT_STATE_STORAGE_KEY,
        CHECKPOINT_UNSAFE,
      ),
    );
  }

  /** Permit capture only after a complete, successfully processed sync batch. */
  async assertCheckpointSafe(): Promise<void> {
    const storedUnsafe = await Promise.resolve(
      this.storageProvider.readValue(MATRIX_CHECKPOINT_STATE_STORAGE_KEY),
    );
    if (
      this.checkpointUnsafe ||
      storedUnsafe !== MATRIX_CHECKPOINT_STATE_SAFE
    ) {
      throw new Error(
        'Matrix checkpoint is not known safe; operator review is required',
      );
    }
  }

  /**
   * Finish the in-flight sync batch and wait before starting the next request.
   * The boundary timeout bounds acquisition; the lease timeout bounds how long
   * a caller may hold sync paused. An expired lease resumes sync and fails its
   * assertActive() check.
   */
  async pauseAtSyncBoundary(
    boundaryTimeoutMs = 30_000,
    leaseTimeoutMs = 120_000,
  ): Promise<MatrixSyncPauseLease> {
    if (this.pauseRequested || this.paused) {
      throw new Error('Matrix sync is already pausing or paused');
    }

    const generation = ++this.pauseGeneration;
    this.expiredPauseGeneration = undefined;
    this.pauseRequested = true;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        new Promise<void>((resolve, reject) => {
          this.boundaryReached = resolve;
          this.rejectBoundaryWait = reject;
        }),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () =>
              reject(new Error('Timed out waiting for a Matrix sync boundary')),
            boundaryTimeoutMs,
          );
        }),
      ]);
      if (!this.paused || this.stopped) {
        throw new Error('Matrix sync stopped before the pause boundary');
      }
    } catch (error) {
      this.releasePause();
      throw error;
    } finally {
      if (timeout) clearTimeout(timeout);
      this.boundaryReached = undefined;
      this.rejectBoundaryWait = undefined;
    }

    this.pauseLeaseTimer = setTimeout(() => {
      this.expiredPauseGeneration = generation;
      this.releasePause();
    }, leaseTimeoutMs);

    return {
      assertActive: () => {
        if (
          generation !== this.pauseGeneration ||
          generation === this.expiredPauseGeneration ||
          !this.paused
        ) {
          throw new Error('Matrix sync pause lease is no longer active');
        }
      },
      release: () => {
        if (generation === this.pauseGeneration) this.releasePause();
      },
    };
  }

  /** Resume sync after a successful checkpoint. */
  resume(): void {
    if (this.pauseRequested && !this.paused) {
      this.rejectBoundaryWait?.(
        new Error('Matrix sync pause was cancelled before reaching a boundary'),
      );
    }
    this.releasePause();
  }

  override stop(): void {
    this.stopped = true;
    const rejectBoundaryWait = this.rejectBoundaryWait;
    this.releasePause();
    rejectBoundaryWait?.(
      new Error('Matrix sync stopped before reaching the requested boundary'),
    );
    super.stop();
  }

  override async start(filter: any = null): Promise<any> {
    this.stopped = false;
    return super.start(filter);
  }

  private releasePause(): void {
    this.pauseRequested = false;
    this.paused = false;
    if (this.pauseLeaseTimer) clearTimeout(this.pauseLeaseTimer);
    this.pauseLeaseTimer = undefined;
    this.boundaryReached = undefined;
    this.rejectBoundaryWait = undefined;
    this.resumeSyncLoop?.();
    this.resumeSyncLoop = undefined;
  }

  protected async doSync(token: string): Promise<any> {
    if (this.pauseRequested) {
      this.paused = true;
      this.boundaryReached?.();
      await new Promise<void>((resolve) => {
        this.resumeSyncLoop = resolve;
      });
      this.paused = false;
    }

    if (this.stopped) throw new Error('Matrix sync client is stopped');

    // If this write fails, the SDK retries after its normal backoff. No sync
    // request is issued until the write-ahead latch is confirmed durable.
    await this.markCheckpointPending();

    return super.doSync(token);
  }

  protected async processSync(
    raw: any,
    emitFn?: (emitEventType: string, ...payload: any[]) => Promise<any>,
  ): Promise<any> {
    if (emitFn) {
      try {
        const result = await super.processSync(raw, emitFn);
        if (this.checkpointUnsafe) return result;
        await this.markCheckpointProcessed();
        return result;
      } catch (error) {
        try {
          await this.markCheckpointUnsafe();
        } catch {
          // The durable write-ahead value remains pending if this write fails.
        }
        throw error;
      }
    }

    const emitAndWait = async (eventType: string, ...payload: any[]) => {
      // rawListeners() returns once wrappers, so applying the wrapper preserves
      // EventEmitter's one-shot removal, invocation order, and `this` binding.
      const listeners = this.rawListeners(eventType) as Array<
        (...args: any[]) => unknown
      >;
      if (eventType === 'error' && listeners.length === 0) {
        // Preserve EventEmitter's special unhandled "error" behavior.
        this.emit(eventType, ...payload);
      }
      const pending: Promise<{ ok: true } | { ok: false; error: unknown }>[] =
        [];
      let hasSynchronousError = false;
      let synchronousError: unknown;
      for (const listener of listeners) {
        let result: unknown;
        try {
          result = listener.apply(this, payload);
        } catch (error) {
          hasSynchronousError = true;
          synchronousError = error;
          break;
        }
        if (isThenable(result)) {
          // Attach rejection handlers immediately so a later synchronous
          // listener throw cannot leave an earlier rejected promise unhandled.
          pending.push(
            Promise.resolve(result).then(
              () => ({ ok: true }),
              (error: unknown) => ({ ok: false, error }),
            ),
          );
        }
      }
      const outcomes = await Promise.all(pending);
      if (hasSynchronousError) throw synchronousError;
      const rejected = outcomes.find((outcome) => !outcome.ok);
      if (rejected && !rejected.ok) throw rejected.error;
      return listeners.length > 0;
    };

    try {
      const result = await super.processSync(raw, emitAndWait);
      if (this.checkpointUnsafe) return result;
      await this.markCheckpointProcessed();
      return result;
    } catch (error) {
      try {
        await this.markCheckpointUnsafe();
      } catch {
        // The durable write-ahead value remains pending if this write fails.
      }
      throw error;
    }
  }

  private async markCheckpointProcessed(): Promise<void> {
    if (this.checkpointUnsafe) {
      throw new Error('Matrix checkpoint is unsafe until operator review');
    }
    try {
      await Promise.resolve(
        this.storageProvider.storeValue(
          MATRIX_CHECKPOINT_STATE_STORAGE_KEY,
          MATRIX_CHECKPOINT_STATE_PROCESSED,
        ),
      );
    } catch (error) {
      // The on-disk write-ahead value remains pending if replacement failed.
      // Keep the process stopped so it cannot advance from an unconfirmed
      // checkpoint state.
      this.checkpointUnsafe = true;
      this.stop();
      throw error;
    }
  }
}

/** Record failures caught by legacy Matrix listeners for future checkpoints. */
export async function recordCheckpointFailure(
  client: MatrixClient,
): Promise<void> {
  if (client instanceof CheckpointMatrixClient) {
    await client.markCheckpointUnsafe();
  }
}
