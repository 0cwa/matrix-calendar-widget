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

import { RoomCalendarBinding } from '../model/IRoomCalendarBinding';
import {
  ROOM_CALENDAR_BINDING_LIMITS,
  RoomCalendarBindingRecord,
  RoomCalendarBindingStore,
} from '../model/IRoomCalendarBindingStore';
import { RoomCalendarBindingRegistry } from './IRoomCalendarBindingRegistry';
import { isMatrixUserId } from './MatrixIdentifiers';
import {
  resolveRoomCalendarBinding,
  validateRoomCalendarBindings,
} from './RoomCalendarBindingResolver';

export type RoomCalendarBindingRegistryErrorCode =
  | 'invalid_stored_record'
  | 'configured_binding_limit_exceeded'
  | 'aborted';

/** Safe error for an invalid persisted registry or bounded-read failure. */
export class RoomCalendarBindingRegistryError extends Error {
  constructor(readonly code: RoomCalendarBindingRegistryErrorCode) {
    super(`Room calendar binding registry ${code.replaceAll('_', ' ')}`);
    this.name = 'RoomCalendarBindingRegistryError';
  }
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new RoomCalendarBindingRegistryError('aborted');
  }
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function validateRecord(
  record: RoomCalendarBindingRecord,
): RoomCalendarBinding {
  if (
    record === null ||
    typeof record !== 'object' ||
    (record.status !== 'pending' && record.status !== 'ready') ||
    !isMatrixUserId(record.createdBy, true) ||
    !isValidDate(record.createdAt) ||
    (record.status === 'ready' && !isValidDate(record.readyAt)) ||
    (record.status === 'pending' && record.readyAt !== undefined)
  ) {
    throw new RoomCalendarBindingRegistryError('invalid_stored_record');
  }

  try {
    return validateRoomCalendarBindings([
      { roomId: record.roomId, calendarId: record.calendarId },
    ])[0];
  } catch {
    throw new RoomCalendarBindingRegistryError('invalid_stored_record');
  }
}

/** Async resolver over immutable operator bindings and durable room bindings. */
export class RoomCalendarBindingRegistryAdapter implements RoomCalendarBindingRegistry {
  private readonly staticBindings: readonly RoomCalendarBinding[];

  constructor(
    staticBindings: readonly RoomCalendarBinding[],
    private readonly store: RoomCalendarBindingStore,
  ) {
    this.staticBindings = validateRoomCalendarBindings(staticBindings);
  }

  async getSnapshot(
    signal?: AbortSignal,
  ): Promise<readonly RoomCalendarBinding[]> {
    assertNotAborted(signal);
    if (!this.store.enabled) {
      // URL-absent mode preserves the legacy static resolver contract: static
      // rows are fully validated at construction, but dynamic-store limits do
      // not narrow static-only installations.
      assertNotAborted(signal);
      return this.staticBindings;
    }

    const records = await this.store.listAll();
    assertNotAborted(signal);

    const dynamicBindings = records.map(validateRecord);
    const completeSet = validateRoomCalendarBindings([
      ...this.staticBindings,
      ...dynamicBindings,
    ]);
    if (
      completeSet.length > ROOM_CALENDAR_BINDING_LIMITS.maxConfiguredBindings
    ) {
      throw new RoomCalendarBindingRegistryError(
        'configured_binding_limit_exceeded',
      );
    }

    const readyDynamicBindings = records
      .filter(({ status }) => status === 'ready')
      .map(({ roomId, calendarId }) => Object.freeze({ roomId, calendarId }));
    return Object.freeze([...this.staticBindings, ...readyDynamicBindings]);
  }

  async resolve(
    roomId: string,
    calendarId?: string,
    signal?: AbortSignal,
  ): Promise<RoomCalendarBinding> {
    const snapshot = await this.getSnapshot(signal);
    return resolveRoomCalendarBinding(snapshot, roomId, calendarId);
  }
}
