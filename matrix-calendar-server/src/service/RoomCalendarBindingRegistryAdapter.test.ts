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
  RoomCalendarBindingRecord,
  RoomCalendarBindingReservation,
  RoomCalendarBindingReservationResult,
  RoomCalendarBindingStore,
} from '../model/IRoomCalendarBindingStore';
import { DisabledRoomCalendarBindingStore } from './DisabledRoomCalendarBindingStore';
import { RoomCalendarBindingRegistryAdapter } from './RoomCalendarBindingRegistryAdapter';

class TestRoomCalendarBindingStore implements RoomCalendarBindingStore {
  readonly enabled = true;

  constructor(readonly records: readonly RoomCalendarBindingRecord[] = []) {}

  async listAll(): Promise<readonly RoomCalendarBindingRecord[]> {
    return this.records;
  }

  async reserve(
    _reservation: RoomCalendarBindingReservation,
  ): Promise<RoomCalendarBindingReservationResult> {
    throw new Error('Not used by registry tests');
  }

  async markReady(
    _binding: RoomCalendarBinding,
    _readyAt: Date,
  ): Promise<RoomCalendarBindingRecord> {
    throw new Error('Not used by registry tests');
  }
}

function record(
  roomId: string,
  calendarId: string,
  status: 'pending' | 'ready',
): RoomCalendarBindingRecord {
  return {
    roomId,
    calendarId,
    status,
    createdBy: '@moderator:example.test',
    createdAt: new Date('2026-10-20T12:00:00.000Z'),
    ...(status === 'ready'
      ? { readyAt: new Date('2026-10-20T12:01:00.000Z') }
      : {}),
  };
}

describe('RoomCalendarBindingRegistryAdapter', () => {
  it('preserves static-only operation with the disabled store', async () => {
    const staticBindings = Array.from({ length: 33 }, (_, index) => ({
      roomId: `!static-${index}:example.test`,
      calendarId: `static-calendar-${index}`,
    }));
    const store = new DisabledRoomCalendarBindingStore();
    const listAll = jest.spyOn(store, 'listAll');
    const registry = new RoomCalendarBindingRegistryAdapter(
      staticBindings,
      store,
    );

    await expect(registry.getSnapshot()).resolves.toEqual(staticBindings);
    await expect(registry.resolve(staticBindings[32].roomId)).resolves.toEqual(
      staticBindings[32],
    );

    const aborted = new AbortController();
    aborted.abort();
    await expect(registry.getSnapshot(aborted.signal)).rejects.toMatchObject({
      code: 'aborted',
    });
    expect(listAll).not.toHaveBeenCalled();
  });

  it('still rejects malformed or duplicate static bindings without a store', () => {
    const store = new DisabledRoomCalendarBindingStore();
    const binding = {
      roomId: '!static:example.test',
      calendarId: 'static-calendar',
    };

    expect(
      () =>
        new RoomCalendarBindingRegistryAdapter(
          [binding, { ...binding, roomId: '!duplicate:example.test' }],
          store,
        ),
    ).toThrow('Room calendar binding duplicate calendar id');
    expect(
      () =>
        new RoomCalendarBindingRegistryAdapter(
          [{ roomId: 'not-a-room', calendarId: 'calendar' }],
          store,
        ),
    ).toThrow('Room calendar binding invalid room id');
  });

  it('rejects dynamic mutations when the store is disabled', async () => {
    const store = new DisabledRoomCalendarBindingStore();
    const binding = {
      roomId: '!disabled:example.test',
      calendarId: 'disabled-calendar',
    };

    expect(store.enabled).toBe(false);
    await expect(store.listAll()).resolves.toEqual([]);
    await expect(
      store.reserve({
        binding,
        staticBindings: [],
        createdBy: '@moderator:example.test',
        createdAt: new Date(),
      }),
    ).rejects.toThrow('Room calendar binding store is disabled');
    await expect(store.markReady(binding, new Date())).rejects.toThrow(
      'Room calendar binding store is disabled',
    );
  });

  it('returns ready dynamic bindings and never exposes pending rows', async () => {
    const staticBinding = {
      roomId: '!static:example.test',
      calendarId: 'static-calendar',
    };
    const ready = record('!ready:example.test', 'ready-calendar', 'ready');
    const pending = record(
      '!pending:example.test',
      'pending-calendar',
      'pending',
    );
    const registry = new RoomCalendarBindingRegistryAdapter(
      [staticBinding],
      new TestRoomCalendarBindingStore([ready, pending]),
    );

    await expect(registry.getSnapshot()).resolves.toEqual([
      staticBinding,
      { roomId: ready.roomId, calendarId: ready.calendarId },
    ]);
    await expect(registry.resolve(ready.roomId)).resolves.toEqual({
      roomId: ready.roomId,
      calendarId: ready.calendarId,
    });
    await expect(registry.resolve(pending.roomId)).rejects.toMatchObject({
      code: 'missing_binding',
    });
  });

  it('counts pending rows against the combined static and dynamic cap', async () => {
    const staticBindings = Array.from({ length: 32 }, (_, index) => ({
      roomId: `!static-${index}:example.test`,
      calendarId: `static-calendar-${index}`,
    }));
    const pending = record(
      '!pending:example.test',
      'pending-calendar',
      'pending',
    );
    const registry = new RoomCalendarBindingRegistryAdapter(
      staticBindings,
      new TestRoomCalendarBindingStore([pending]),
    );

    await expect(registry.getSnapshot()).rejects.toMatchObject({
      code: 'configured_binding_limit_exceeded',
    });
  });

  it('fails closed on a duplicate static/dynamic identity', async () => {
    const staticBinding = {
      roomId: '!shared:example.test',
      calendarId: 'static-calendar',
    };
    const dynamic = record('!shared:example.test', 'dynamic-calendar', 'ready');
    const registry = new RoomCalendarBindingRegistryAdapter(
      [staticBinding],
      new TestRoomCalendarBindingStore([dynamic]),
    );

    await expect(registry.getSnapshot()).rejects.toMatchObject({
      code: 'duplicate_room_id',
    });
  });

  it('fails closed on a duplicate static/dynamic calendar identity', async () => {
    const staticBinding = {
      roomId: '!static:example.test',
      calendarId: 'shared-calendar',
    };
    const dynamic = record('!dynamic:example.test', 'shared-calendar', 'ready');
    const registry = new RoomCalendarBindingRegistryAdapter(
      [staticBinding],
      new TestRoomCalendarBindingStore([dynamic]),
    );

    await expect(registry.getSnapshot()).rejects.toMatchObject({
      code: 'duplicate_calendar_id',
    });
  });

  it('observes an already aborted signal before reading the store', async () => {
    const controller = new AbortController();
    controller.abort();
    const registry = new RoomCalendarBindingRegistryAdapter(
      [],
      new TestRoomCalendarBindingStore(),
    );

    await expect(registry.getSnapshot(controller.signal)).rejects.toMatchObject(
      {
        code: 'aborted',
      },
    );
  });

  it('suppresses a store result when aborted while the read is pending', async () => {
    const controller = new AbortController();
    let finishRead!: (records: readonly RoomCalendarBindingRecord[]) => void;
    const pendingRead = new Promise<readonly RoomCalendarBindingRecord[]>(
      (resolve) => {
        finishRead = resolve;
      },
    );
    class PendingReadStore extends TestRoomCalendarBindingStore {
      override async listAll(): Promise<readonly RoomCalendarBindingRecord[]> {
        return pendingRead;
      }
    }
    const registry = new RoomCalendarBindingRegistryAdapter(
      [],
      new PendingReadStore(),
    );
    const snapshot = registry.getSnapshot(controller.signal);

    controller.abort();
    finishRead([]);

    await expect(snapshot).rejects.toMatchObject({ code: 'aborted' });
  });
});
