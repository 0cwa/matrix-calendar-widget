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

import { GUARDS_METADATA, HEADERS_METADATA } from '@nestjs/common/constants';
import { MatrixAuthGuard } from '../guard/MatrixAuthGuard';
import { MatrixRoomMembershipGuard } from '../guard/MatrixRoomMembershipGuard';
import { RoomReminderConfigurationService } from '../reminder/RoomReminderConfigurationService';
import { RoomReminderConfigurationController } from './RoomReminderConfigurationController';

describe('RoomReminderConfigurationController', () => {
  it('requires authenticated and joined-room request guards', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, RoomReminderConfigurationController),
    ).toEqual([MatrixAuthGuard, MatrixRoomMembershipGuard]);
  });

  it('marks every identity-bearing response no-store', () => {
    for (const handler of ['list', 'upsert', 'delete'] as const) {
      expect(
        Reflect.getMetadata(
          HEADERS_METADATA,
          RoomReminderConfigurationController.prototype[handler],
        ),
      ).toEqual([{ name: 'Cache-Control', value: 'no-store' }]);
    }
  });

  it('passes only the server context actor and route/body values to the service', async () => {
    const list = jest.fn().mockResolvedValue({ items: [] });
    const upsert = jest.fn().mockResolvedValue({ eventUid: 'event' });
    const remove = jest.fn().mockResolvedValue({ deleted: true });
    const service = {
      list,
      upsert,
      delete: remove,
    } as unknown as RoomReminderConfigurationService;
    const controller = new RoomReminderConfigurationController(service);
    const userContext = {
      userId: '@alice:example.test',
      locale: 'en',
      timezone: 'UTC',
    };
    const body = {
      eventId: 'planning.ics',
      recurrenceId: null,
      alarmUid: 'alarm@example.test',
    };

    await controller.list(userContext, '!team:example.test', '20', 'cursor');
    await controller.upsert(userContext, '!team:example.test', body);
    await controller.delete(userContext, '!team:example.test', body);

    expect(list).toHaveBeenCalledWith(
      '@alice:example.test',
      '!team:example.test',
      '20',
      'cursor',
    );
    expect(upsert).toHaveBeenCalledWith(
      '@alice:example.test',
      '!team:example.test',
      body,
    );
    expect(remove).toHaveBeenCalledWith(
      '@alice:example.test',
      '!team:example.test',
      body,
    );
  });
});
