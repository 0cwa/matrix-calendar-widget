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

import { InMemoryRoomReminderStore } from '../../test/util/InMemoryRoomReminderStore';
import { createReminderDeliveryKey } from './PostgresRoomReminderStore';
import {
  DisabledRoomReminderStore,
  ReminderStoreDisabledError,
  normalizeRoomReminderConfiguration,
  validateReminderDeliveryIdentity,
  validateRoomReminderConfiguration,
} from './RoomReminderStore';

describe('DisabledRoomReminderStore', () => {
  it('exposes disabled state and rejects writes instead of silently dropping them', async () => {
    const store = new DisabledRoomReminderStore();

    expect(store.enabled).toBe(false);
    await expect(
      store.upsertConfiguration({
        roomId: '!team:example.org',
        calendarId: 'team',
        eventUid: 'planning',
        recurrenceId: null,
        alarmUid: 'alarm-1',
      }),
    ).rejects.toBeInstanceOf(ReminderStoreDisabledError);
    await expect(
      store.listConfigurationPage('!team:example.org', 'team', undefined, 10),
    ).rejects.toBeInstanceOf(ReminderStoreDisabledError);
    await expect(
      store.hasConfiguration({
        roomId: '!team:example.org',
        calendarId: 'team',
        eventUid: 'planning',
        recurrenceId: null,
        alarmUid: 'alarm-1',
      }),
    ).rejects.toBeInstanceOf(ReminderStoreDisabledError);
  });
});

describe('InMemoryRoomReminderStore configuration paging', () => {
  it('orders a master null recurrence before instances and advances exclusively', async () => {
    const store = new InMemoryRoomReminderStore();
    const master = {
      roomId: '!team:example.org',
      calendarId: 'team',
      eventUid: 'planning',
      recurrenceId: null,
      alarmUid: 'alarm-1',
    };
    const occurrence = { ...master, recurrenceId: '20261001T090000Z' };

    await store.upsertConfiguration(occurrence);
    await store.upsertConfiguration(master);

    const firstPage = await store.listConfigurationPage(
      master.roomId,
      master.calendarId,
      undefined,
      1,
    );
    expect(firstPage).toEqual([normalizeRoomReminderConfiguration(master)]);

    const secondPage = await store.listConfigurationPage(
      master.roomId,
      master.calendarId,
      {
        eventUid: master.eventUid,
        recurrenceId: firstPage[0].recurrenceId,
        alarmUid: firstPage[0].alarmUid,
      },
      1,
    );
    expect(secondPage).toEqual([
      normalizeRoomReminderConfiguration(occurrence),
    ]);
  });

  it('rejects a stale configuration snapshot without replacing newer settings', async () => {
    const store = new InMemoryRoomReminderStore();
    const identity = {
      roomId: '!team:example.org',
      calendarId: 'team',
      eventUid: 'planning',
      recurrenceId: null,
      alarmUid: 'alarm-1',
    };
    const firstSchedule = {
      daysBefore: 1,
      localTime: '09:00',
      timezone: 'Europe/Stockholm',
    };
    const changedSchedule = { ...firstSchedule, daysBefore: 2 };

    await store.upsertConfiguration({
      ...identity,
      allDaySchedule: firstSchedule,
    });
    const snapshot = await store.getConfiguration(identity);
    expect(snapshot).toBeDefined();
    await store.upsertConfiguration({
      ...identity,
      allDaySchedule: changedSchedule,
    });

    await expect(
      store.compareAndUpsertConfiguration(
        {
          ...identity,
          target: {
            kind: 'users',
            userIds: ['@alice:example.org'],
          },
          allDaySchedule: firstSchedule,
        },
        snapshot,
      ),
    ).resolves.toBe(false);
    await expect(store.getConfiguration(identity)).resolves.toMatchObject({
      target: { kind: 'room' },
      allDaySchedule: changedSchedule,
      revision: 2,
    });
  });
});

describe('createReminderDeliveryKey', () => {
  const identity = {
    roomId: '!team:example.org',
    calendarId: 'team',
    eventUid: 'planning',
    recurrenceId: '20261001T090000Z',
    alarmUid: 'alarm-1',
    triggerOrdinal: 0,
  };

  it('returns a stable opaque key for a reminder occurrence and alarm firing', () => {
    expect(createReminderDeliveryKey(identity)).toBe(
      createReminderDeliveryKey({ ...identity }),
    );
    expect(createReminderDeliveryKey(identity)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('normalizes legacy configuration rows to room-target timing defaults', () => {
    expect(
      normalizeRoomReminderConfiguration({
        roomId: identity.roomId,
        calendarId: identity.calendarId,
        eventUid: identity.eventUid,
        recurrenceId: null,
        alarmUid: identity.alarmUid,
      }),
    ).toEqual({
      roomId: identity.roomId,
      calendarId: identity.calendarId,
      eventUid: identity.eventUid,
      recurrenceId: null,
      alarmUid: identity.alarmUid,
      target: { kind: 'room' },
      allDaySchedule: null,
      revision: 1,
    });
  });

  it.each([
    {
      target: { kind: 'future-target', extra: true },
      allDaySchedule: null,
      revision: 1,
    },
    {
      target: { kind: 'users', userIds: ['@alice:example.test'] },
      allDaySchedule: {
        daysBefore: 0,
        localTime: '09:00',
        timezone: 'Unknown/Zone',
      },
      revision: 1,
    },
  ])('fails closed for unknown reminder metadata', (metadata) => {
    expect(() =>
      normalizeRoomReminderConfiguration({
        roomId: identity.roomId,
        calendarId: identity.calendarId,
        eventUid: identity.eventUid,
        recurrenceId: null,
        alarmUid: identity.alarmUid,
        ...metadata,
      } as any),
    ).toThrow('Invalid room reminder configuration');
  });

  it.each([
    { ...identity, roomId: '!other:example.org' },
    { ...identity, recurrenceId: null },
    { ...identity, alarmUid: 'alarm-2' },
    { ...identity, triggerOrdinal: 1 },
  ])('changes when the delivery identity changes', (changedIdentity) => {
    expect(createReminderDeliveryKey(changedIdentity)).not.toBe(
      createReminderDeliveryKey(identity),
    );
  });

  it('rejects an invalid trigger ordinal', () => {
    expect(() =>
      createReminderDeliveryKey({ ...identity, triggerOrdinal: -1 }),
    ).toThrow('Invalid reminder delivery identity: triggerOrdinal');
  });

  it('rejects delivery identities with missing or extra keys', () => {
    expect(() =>
      validateReminderDeliveryIdentity({
        roomId: identity.roomId,
        calendarId: identity.calendarId,
        eventUid: identity.eventUid,
        recurrenceId: identity.recurrenceId,
        alarmUid: identity.alarmUid,
      } as any),
    ).toThrow('Invalid reminder delivery identity: shape');
    expect(() =>
      validateReminderDeliveryIdentity({
        ...identity,
        extra: 'value',
      } as any),
    ).toThrow('Invalid reminder delivery identity: shape');
  });

  it('rejects missing configuration fields before they reach persistence', () => {
    expect(() =>
      validateRoomReminderConfiguration({
        roomId: '!team:example.org',
        calendarId: 'team',
        eventUid: 'planning',
        recurrenceId: null,
      } as any),
    ).toThrow('Invalid room reminder configuration: shape');
  });
});
