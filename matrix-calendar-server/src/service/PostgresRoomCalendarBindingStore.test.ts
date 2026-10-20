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
import { PostgresRoomCalendarBindingStore } from './PostgresRoomCalendarBindingStore';

function createMockSql(rows: unknown[][]): ReturnType<typeof postgres> {
  const tag = (
    _strings: TemplateStringsArray,
    ..._values: unknown[]
  ): Promise<unknown[]> => Promise.resolve(rows.shift() ?? []);
  return tag as unknown as ReturnType<typeof postgres>;
}

describe('PostgresRoomCalendarBindingStore row decoding', () => {
  it('rejects a pending row with a malformed non-null ready timestamp', async () => {
    const store = new PostgresRoomCalendarBindingStore(
      createMockSql([
        [
          {
            room_id: '!damaged:example.test',
            calendar_id: 'damaged-calendar',
            status: 'pending',
            created_by: '@moderator:example.test',
            created_at: new Date('2026-10-20T12:00:00.000Z'),
            ready_at: 'not-a-timestamp',
          },
        ],
      ]),
    );

    await expect(store.listAll()).rejects.toThrow(
      'Invalid room calendar binding in store',
    );
  });

  it('accepts a pending row only when ready_at is SQL NULL', async () => {
    const store = new PostgresRoomCalendarBindingStore(
      createMockSql([
        [
          {
            room_id: '!pending:example.test',
            calendar_id: 'pending-calendar',
            status: 'pending',
            created_by: '@moderator:example.test',
            created_at: new Date('2026-10-20T12:00:00.000Z'),
            ready_at: null,
          },
        ],
      ]),
    );

    const [record] = await store.listAll();
    expect(record).toMatchObject({ status: 'pending' });
    expect(record).not.toHaveProperty('readyAt');
  });
});
