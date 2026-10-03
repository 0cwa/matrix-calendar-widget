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

import postgres from 'postgres';
import { PostgresRoomReminderStore } from './PostgresRoomReminderStore';

type CapturedQuery = {
  text: string;
  values: unknown[];
};

function createMockSql(results: unknown[][]): {
  sql: ReturnType<typeof postgres>;
  queries: CapturedQuery[];
} {
  const queries: CapturedQuery[] = [];
  const tag = (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<unknown[]> & { cancel: jest.Mock } => {
    queries.push({
      text: strings.join(' $value ').replace(/\s+/gu, ' ').trim(),
      values,
    });
    const query = Promise.resolve(results.shift() ?? []) as Promise<
      unknown[]
    > & {
      cancel: jest.Mock;
    };
    query.cancel = jest.fn();
    return query;
  };

  return {
    sql: tag as unknown as ReturnType<typeof postgres>,
    queries,
  };
}

function createPendingQuery(): Promise<unknown[]> & { cancel: jest.Mock } {
  const query = new Promise<unknown[]>(() => undefined) as Promise<
    unknown[]
  > & {
    cancel: jest.Mock;
  };
  query.cancel = jest.fn();
  return query;
}

describe('PostgresRoomReminderStore claimDelivery query contract', () => {
  const identity = {
    roomId: '!planning:example.test',
    calendarId: 'room-calendar',
    eventUid: 'weekly-planning',
    recurrenceId: '20261001T090000Z',
    alarmUid: 'alarm-uid',
    triggerOrdinal: 2,
  };

  it('handles every unique conflict with an exact, lease-guarded reclaim query', async () => {
    const claim = {
      delivery_key: 'key',
      claim_token: 'claim-token',
      attempt_count: 2,
      lease_expires_at: new Date('2026-10-03T12:00:00.000Z'),
    };
    const { sql, queries } = createMockSql([[], [claim]]);
    const store = new PostgresRoomReminderStore(sql);

    await expect(store.claimDelivery(identity, 30_000)).resolves.toEqual({
      deliveryKey: claim.delivery_key,
      claimToken: claim.claim_token,
      attemptCount: claim.attempt_count,
      leaseExpiresAt: claim.lease_expires_at,
    });

    expect(queries).toHaveLength(2);
    expect(queries[0].text).toContain('ON CONFLICT DO NOTHING');
    expect(queries[0].text).toContain('RETURNING delivery_key');
    expect(queries[1].text).toContain(
      'UPDATE matrix_calendar.reminder_deliveries',
    );
    expect(queries[1].text).toContain('WHERE delivery_key = $value');
    expect(queries[1].text).toContain('AND room_id = $value');
    expect(queries[1].text).toContain('AND trigger_ordinal = $value');
    expect(queries[1].text).toContain("state = 'pending'");
    expect(queries[1].text).toContain('lease_expires_at <= clock_timestamp()');
    expect(queries[1].values).toEqual(
      expect.arrayContaining([
        identity.roomId,
        identity.calendarId,
        identity.eventUid,
        identity.recurrenceId,
        identity.alarmUid,
        identity.triggerOrdinal,
      ]),
    );
  });

  it('does not claim a conflicting row that is already leased or has a different identity', async () => {
    const { sql, queries } = createMockSql([[], []]);
    const store = new PostgresRoomReminderStore(sql);

    await expect(
      store.claimDelivery(identity, 30_000),
    ).resolves.toBeUndefined();
    expect(queries).toHaveLength(2);
    expect(queries[1].text).toContain('AND event_uid = $value');
    expect(queries[1].text).toContain('AND recurrence_id = $value');
  });

  it('propagates non-conflict database errors without attempting reclaim', async () => {
    const databaseError = new Error('database unavailable');
    const failingTag = jest.fn(() =>
      Promise.reject(databaseError),
    ) as unknown as ReturnType<typeof postgres>;
    const store = new PostgresRoomReminderStore(failingTag);

    await expect(store.claimDelivery(identity, 30_000)).rejects.toBe(
      databaseError,
    );
    expect(failingTag).toHaveBeenCalledTimes(1);
  });

  it('cancels an in-flight insert when its signal aborts', async () => {
    const insertQuery = createPendingQuery();
    const sqlTag = jest.fn(() => insertQuery) as unknown as ReturnType<
      typeof postgres
    >;
    const store = new PostgresRoomReminderStore(sqlTag);
    const controller = new AbortController();
    const pendingClaim = store.claimDelivery(
      identity,
      30_000,
      controller.signal,
    );

    controller.abort();

    await expect(pendingClaim).rejects.toThrow(
      'Reminder store operation aborted',
    );
    expect(insertQuery.cancel).toHaveBeenCalledTimes(1);
    expect(sqlTag).toHaveBeenCalledTimes(1);
  });

  it('cancels the reclaim query when its signal aborts', async () => {
    const insertQuery = Object.assign(Promise.resolve([]), {
      cancel: jest.fn(),
    }) as Promise<unknown[]> & { cancel: jest.Mock };
    const reclaimQuery = createPendingQuery();
    let notifyReclaimStarted: (() => void) | undefined;
    const reclaimStarted = new Promise<void>((resolve) => {
      notifyReclaimStarted = resolve;
    });
    let queryCount = 0;
    const sqlTag = jest.fn(() => {
      queryCount += 1;
      if (queryCount === 1) return insertQuery;
      notifyReclaimStarted?.();
      return reclaimQuery;
    }) as unknown as ReturnType<typeof postgres>;
    const store = new PostgresRoomReminderStore(sqlTag);
    const controller = new AbortController();
    const pendingClaim = store.claimDelivery(
      identity,
      30_000,
      controller.signal,
    );

    await reclaimStarted;
    controller.abort();

    await expect(pendingClaim).rejects.toThrow(
      'Reminder store operation aborted',
    );
    expect(insertQuery.cancel).not.toHaveBeenCalled();
    expect(reclaimQuery.cancel).toHaveBeenCalledTimes(1);
    expect(sqlTag).toHaveBeenCalledTimes(2);
  });
});
