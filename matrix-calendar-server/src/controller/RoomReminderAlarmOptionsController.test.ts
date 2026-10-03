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

import { BadRequestException, RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  HEADERS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { MatrixAuthGuard } from '../guard/MatrixAuthGuard';
import { MatrixRoomMembershipGuard } from '../guard/MatrixRoomMembershipGuard';
import { RoomReminderAlarmOptionsService } from '../reminder/RoomReminderAlarmOptionsService';
import { RoomReminderAlarmOptionsController } from './RoomReminderAlarmOptionsController';

describe('RoomReminderAlarmOptionsController', () => {
  it('requires authentication and joined-room guards and marks the route no-store', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, RoomReminderAlarmOptionsController),
    ).toEqual([MatrixAuthGuard, MatrixRoomMembershipGuard]);
    expect(
      Reflect.getMetadata(PATH_METADATA, RoomReminderAlarmOptionsController),
    ).toBe('calendar/rooms/:roomId/reminders');
    expect(
      Reflect.getMetadata(
        PATH_METADATA,
        RoomReminderAlarmOptionsController.prototype.list,
      ),
    ).toBe('options');
    expect(
      Reflect.getMetadata(
        METHOD_METADATA,
        RoomReminderAlarmOptionsController.prototype.list,
      ),
    ).toBe(RequestMethod.GET);
    expect(
      Reflect.getMetadata(
        HEADERS_METADATA,
        RoomReminderAlarmOptionsController.prototype.list,
      ),
    ).toEqual([{ name: 'Cache-Control', value: 'no-store' }]);
  });

  it('passes only the server actor, room, and validated exact query to the service', async () => {
    const list = jest.fn().mockResolvedValue({ options: [] });
    const controller = new RoomReminderAlarmOptionsController({
      list,
    } as unknown as RoomReminderAlarmOptionsService);

    await controller.list(
      { userId: '@alice:example.test' } as never,
      '!team:example.test',
      { eventId: 'https://dav.example.test/calendar/planning.ics' },
    );

    expect(list).toHaveBeenCalledWith(
      '@alice:example.test',
      '!team:example.test',
      'https://dav.example.test/calendar/planning.ics',
    );
  });

  it.each([
    [
      'duplicate event IDs',
      {
        eventId: [
          'https://dav.example.test/calendar/planning.ics',
          'https://dav.example.test/calendar/other.ics',
        ],
      },
    ],
    [
      'an unknown query field',
      {
        eventId: 'https://dav.example.test/calendar/planning.ics',
        token: 'must-not-be-accepted',
      },
    ],
    [
      'a credential-bearing URL',
      {
        eventId: 'https://alice:secret@dav.example.test/calendar/planning.ics',
      },
    ],
    [
      'a collection URL without a .ics leaf',
      { eventId: 'https://dav.example.test/calendar/' },
    ],
  ])('rejects %s before calling the service', (_name, query) => {
    const list = jest.fn();
    const controller = new RoomReminderAlarmOptionsController({
      list,
    } as unknown as RoomReminderAlarmOptionsService);

    expect(() =>
      controller.list(
        { userId: '@alice:example.test' } as never,
        '!team:example.test',
        query,
      ),
    ).toThrow(BadRequestException);
    expect(list).not.toHaveBeenCalled();
  });
});
