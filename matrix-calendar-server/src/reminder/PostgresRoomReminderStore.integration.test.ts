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

import { randomUUID } from 'crypto';
import postgres from 'postgres';
import { PostgresRoomReminderStore } from './PostgresRoomReminderStore';

const databaseUrl = process.env.MATRIX_CALENDAR_REMINDER_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase('PostgresRoomReminderStore integration', () => {
  const roomId = `!reminder-store-${randomUUID()}:example.test`;
  const calendarId = 'room-calendar';
  let sql: ReturnType<typeof postgres>;
  let store: PostgresRoomReminderStore;
  let initialized = false;

  beforeAll(async () => {
    sql = postgres(databaseUrl as string, { max: 3, connect_timeout: 5 });
    store = new PostgresRoomReminderStore(sql);
    await store.migrate();
    initialized = true;
  });

  afterAll(async () => {
    if (sql) {
      try {
        if (initialized) {
          await sql`
            DELETE FROM matrix_calendar.reminder_deliveries
            WHERE room_id = ${roomId}
          `;
          await sql`
            DELETE FROM matrix_calendar.room_reminder_configurations
            WHERE room_id = ${roomId}
          `;
        }
      } finally {
        await sql.end({ timeout: 5 });
      }
    }
  });

  it('applies repeatable migrations and upserts/removes room configurations', async () => {
    await store.migrate();
    const config = {
      roomId,
      calendarId,
      eventUid: 'weekly-planning',
      recurrenceId: null,
      alarmUid: 'alarm-uid',
    };

    await store.upsertConfiguration(config);
    await store.upsertConfiguration(config);
    expect(await store.listConfigurations(roomId, calendarId)).toEqual([
      config,
    ]);

    await store.deleteConfiguration(config);
    expect(await store.listConfigurations(roomId, calendarId)).toEqual([]);
  });

  it('atomically grants one concurrent claim and prevents a second send after completion', async () => {
    const identity = {
      roomId,
      calendarId,
      eventUid: 'concurrent-planning',
      recurrenceId: '20261001T090000Z',
      alarmUid: 'alarm-uid',
      triggerOrdinal: 0,
    };
    const claims = await Promise.all([
      store.claimDelivery(identity, 60_000),
      store.claimDelivery(identity, 60_000),
    ]);
    const claim = claims.find((candidate) => candidate !== undefined);

    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(claim?.attemptCount).toBe(1);
    expect(await store.claimDelivery(identity, 60_000)).toBeUndefined();
    expect(
      await store.markDeliverySent(claim!.deliveryKey, claim!.claimToken),
    ).toBe(true);
    expect(await store.claimDelivery(identity, 60_000)).toBeUndefined();
  });

  it('allows a stale lease to be reclaimed and rejects updates from the prior worker', async () => {
    const identity = {
      roomId,
      calendarId,
      eventUid: 'retry-planning',
      recurrenceId: null,
      alarmUid: 'alarm-uid',
      triggerOrdinal: 0,
    };
    const oldClaim = await store.claimDelivery(identity, 50);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const newClaim = await store.claimDelivery(identity, 60_000);

    expect(oldClaim).toBeDefined();
    expect(newClaim?.attemptCount).toBe(2);
    expect(newClaim?.claimToken).not.toBe(oldClaim?.claimToken);
    expect(
      await store.markDeliverySent(oldClaim!.deliveryKey, oldClaim!.claimToken),
    ).toBe(false);
    expect(
      await store.releaseDeliveryClaim(
        newClaim!.deliveryKey,
        newClaim!.claimToken,
      ),
    ).toBe(true);

    const retryClaim = await store.claimDelivery(identity, 60_000);
    expect(retryClaim?.attemptCount).toBe(3);
    expect(
      await store.markDeliverySent(
        retryClaim!.deliveryKey,
        retryClaim!.claimToken,
      ),
    ).toBe(true);
  });

  it('persists reminder configuration and delivery state across repository restart', async () => {
    const config = {
      roomId,
      calendarId,
      eventUid: 'restart-planning',
      recurrenceId: null,
      alarmUid: 'alarm-uid',
    };
    const identity = {
      ...config,
      triggerOrdinal: 0,
    };

    await store.upsertConfiguration(config);
    const claim = await store.claimDelivery(identity, 60_000);
    expect(claim).toBeDefined();
    expect(
      await store.markDeliverySent(claim!.deliveryKey, claim!.claimToken),
    ).toBe(true);

    await store.onModuleDestroy();
    sql = postgres(databaseUrl as string, { max: 3, connect_timeout: 5 });
    store = new PostgresRoomReminderStore(sql);
    await store.migrate();

    expect(await store.listConfigurations(roomId, calendarId)).toContainEqual(
      config,
    );
    expect(await store.claimDelivery(identity, 60_000)).toBeUndefined();
  });
});
