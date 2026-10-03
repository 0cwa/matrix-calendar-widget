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

import { isMatrixUserId } from '../validator/IsMatrixUserId';
import { isCanonicalMatrixRoomId } from './RoomCalendarBindingResolver';

const WINDOW_MS = 60_000;
const MAX_IN_FLIGHT_GLOBAL = 8;
const MAX_IN_FLIGHT_PER_ROOM = 2;
const MAX_IN_FLIGHT_PER_ACTOR = 1;
const MAX_COMMANDS_PER_ACTOR_WINDOW = 6;
const MAX_STATE_ENTRIES = 1_000;
const MAX_ACTOR_ID_LENGTH = 512;

interface ActorBucket {
  readonly roomId: string;
  readonly acceptedAt: number[];
  inFlight: number;
}

/**
 * Bounds calendar-bot work within one server process. No caller-provided
 * command text is retained, and denials have no logging or reply side effects.
 */
export class CalendarCommandTrafficLimiter {
  private readonly buckets = new Map<string, ActorBucket>();

  constructor(private readonly clock: () => number = Date.now) {}

  /**
   * Reserves one in-flight slot and one rolling-window token. The returned
   * release function is idempotent and must be called when command handling
   * has completed, including reply handling.
   */
  public tryAcquire(
    roomId: unknown,
    actorId: unknown,
  ): (() => void) | undefined {
    const canonicalRoomId = canonicalizeMatrixRoomId(roomId);
    const canonicalActorId = canonicalizeMatrixUserId(actorId);
    if (!canonicalRoomId || !canonicalActorId) return undefined;

    const now = this.readClock();
    if (now === undefined) return undefined;

    this.pruneExpired(now);

    const bucketKey = JSON.stringify([canonicalRoomId, canonicalActorId]);
    const bucket = this.buckets.get(bucketKey);
    let globalInFlight = 0;
    let roomInFlight = 0;
    for (const entry of this.buckets.values()) {
      globalInFlight += entry.inFlight;
      if (entry.roomId === canonicalRoomId) {
        roomInFlight += entry.inFlight;
      }
    }

    if (
      globalInFlight >= MAX_IN_FLIGHT_GLOBAL ||
      roomInFlight >= MAX_IN_FLIGHT_PER_ROOM ||
      (bucket?.inFlight ?? 0) >= MAX_IN_FLIGHT_PER_ACTOR
    ) {
      return undefined;
    }

    if ((bucket?.acceptedAt.length ?? 0) >= MAX_COMMANDS_PER_ACTOR_WINDOW) {
      return undefined;
    }

    if (!bucket && this.buckets.size >= MAX_STATE_ENTRIES) {
      return undefined;
    }

    const acceptedBucket = bucket ?? {
      roomId: canonicalRoomId,
      acceptedAt: [],
      inFlight: 0,
    };
    if (!bucket) this.buckets.set(bucketKey, acceptedBucket);
    acceptedBucket.acceptedAt.push(now);
    acceptedBucket.inFlight += 1;

    let released = false;
    return () => {
      if (released) return;
      released = true;

      acceptedBucket.inFlight -= 1;
      const releasedAt = this.readClock();
      if (releasedAt !== undefined) {
        this.pruneBucket(bucketKey, acceptedBucket, releasedAt);
      }
    };
  }

  private readClock(): number | undefined {
    try {
      const now = this.clock();
      return Number.isFinite(now) ? now : undefined;
    } catch {
      return undefined;
    }
  }

  private pruneExpired(now: number): void {
    for (const [key, bucket] of this.buckets) {
      this.pruneBucket(key, bucket, now);
    }
  }

  private pruneBucket(key: string, bucket: ActorBucket, now: number): void {
    const oldestAcceptedAt = now - WINDOW_MS;
    const recentAcceptances = bucket.acceptedAt.filter(
      (acceptedAt) => acceptedAt > oldestAcceptedAt,
    );
    bucket.acceptedAt.splice(0, bucket.acceptedAt.length, ...recentAcceptances);

    // Active commands keep their concurrency reservation even after their
    // burst tokens expire. Only inactive, expired buckets may be evicted.
    if (
      bucket.inFlight === 0 &&
      bucket.acceptedAt.length === 0 &&
      this.buckets.get(key) === bucket
    ) {
      this.buckets.delete(key);
    }
  }
}

function canonicalizeMatrixRoomId(value: unknown): string | undefined {
  if (!isCanonicalMatrixRoomId(value)) return undefined;

  const separator = value.indexOf(':', 1);
  if (separator === -1) {
    // Room-version-12 IDs have no server suffix; their base64url spelling is
    // case-sensitive and must remain byte-for-byte intact.
    return value;
  }
  return `${value.slice(0, separator + 1)}${value
    .slice(separator + 1)
    .toLowerCase()}`;
}

function canonicalizeMatrixUserId(value: unknown): string | undefined {
  if (
    typeof value !== 'string' ||
    value.length > MAX_ACTOR_ID_LENGTH ||
    !isMatrixUserId(value)
  ) {
    return undefined;
  }

  const separator = value.indexOf(':', 1);
  if (separator < 2 || separator === value.length - 1) {
    return undefined;
  }
  const localpart = value.slice(1, separator);
  const serverName = value.slice(separator + 1);
  if (
    !/^[\x20-\x7e]+$/.test(localpart) ||
    !isCanonicalMatrixRoomId(`!limiter:${serverName}`)
  ) {
    return undefined;
  }

  // Retain the sender's exact spelling. Localparts can contain printable
  // ASCII beyond newly-created user IDs, and the Matrix server supplies this
  // actor identifier; command text never participates in the limiter key.
  return `${value.slice(0, separator + 1)}${serverName.toLowerCase()}`;
}
