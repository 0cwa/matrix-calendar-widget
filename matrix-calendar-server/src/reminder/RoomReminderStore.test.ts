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

import { createReminderDeliveryKey } from './PostgresRoomReminderStore';
import {
  DisabledRoomReminderStore,
  ReminderStoreDisabledError,
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
});
