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

import { BadRequestException } from '@nestjs/common';
import { IUserContext } from '../model/IUserContext';
import { RoomReminderConfigurationService } from '../service/RoomReminderConfigurationService';
import {
  parseRoomReminderIdentity,
  RoomReminderConfigurationController,
} from './RoomReminderConfigurationController';

const userContext = { userId: '@alice:example.test' } as IUserContext;
const roomId = '!team:example.test';

describe('parseRoomReminderIdentity', () => {
  it('accepts a master-event alarm identity', () => {
    expect(
      parseRoomReminderIdentity({
        eventUid: 'planning@example.test',
        recurrenceId: null,
        alarmUid: 'alarm-1@example.test',
      }),
    ).toEqual({
      eventUid: 'planning@example.test',
      recurrenceId: null,
      alarmUid: 'alarm-1@example.test',
    });
  });

  it.each([
    JSON.stringify(['date', '2026-09-26']),
    JSON.stringify(['date-time', 'floating', '', '2026-09-26T09:30']),
    JSON.stringify(['date-time', 'utc', '', '2026-09-26T09:30:00']),
    JSON.stringify([
      'date-time',
      'tzid',
      'Europe/Stockholm',
      '2026-09-26T09:30:00',
    ]),
  ])('accepts canonical recurrence identity %s', (recurrenceId) => {
    expect(
      parseRoomReminderIdentity({
        eventUid: 'planning@example.test',
        recurrenceId,
        alarmUid: 'alarm-1@example.test',
      }).recurrenceId,
    ).toBe(recurrenceId);
  });

  it.each([
    null,
    [],
    {
      eventUid: 'event',
      recurrenceId: null,
      alarmUid: 'alarm',
      actorId: '@x:y',
    },
    {
      eventUid: 'event',
      recurrenceId: null,
      alarmUid: 'alarm',
      calendarId: 'team',
    },
    { eventUid: '', recurrenceId: null, alarmUid: 'alarm' },
    { eventUid: ' event ', recurrenceId: null, alarmUid: 'alarm' },
    { eventUid: 'event\n', recurrenceId: null, alarmUid: 'alarm' },
    { eventUid: 'event', recurrenceId: null, alarmUid: '' },
    { eventUid: 'event', recurrenceId: '2026-09-26T09:30', alarmUid: 'alarm' },
    {
      eventUid: 'event',
      recurrenceId: '["date","2026-02-30"]',
      alarmUid: 'alarm',
    },
    {
      eventUid: 'event',
      recurrenceId: '["date-time","tzid","","2026-09-26T09:30"]',
      alarmUid: 'alarm',
    },
    {
      eventUid: 'event',
      recurrenceId:
        '["date-time","floating","Europe/Stockholm","2026-09-26T09:30"]',
      alarmUid: 'alarm',
    },
  ])('rejects malformed or caller-extended identity %j', (input) => {
    expect(() => parseRoomReminderIdentity(input)).toThrow(BadRequestException);
  });
});

describe('RoomReminderConfigurationController', () => {
  it('derives actor and room from middleware context and the route path', async () => {
    const service = {
      put: jest.fn().mockResolvedValue(undefined),
    } as unknown as RoomReminderConfigurationService;
    const controller = new RoomReminderConfigurationController(service);

    await controller.put(userContext, roomId, {
      eventUid: 'planning@example.test',
      recurrenceId: null,
      alarmUid: 'alarm-1@example.test',
    });

    expect(service.put).toHaveBeenCalledWith(userContext.userId, roomId, {
      eventUid: 'planning@example.test',
      recurrenceId: null,
      alarmUid: 'alarm-1@example.test',
    });
  });

  it('rejects caller-selected actor or calendar fields before calling the service', async () => {
    const service = {
      put: jest.fn(),
    } as unknown as RoomReminderConfigurationService;
    const controller = new RoomReminderConfigurationController(service);

    expect(() =>
      controller.put(userContext, roomId, {
        eventUid: 'planning@example.test',
        recurrenceId: null,
        alarmUid: 'alarm-1@example.test',
        actorId: '@mallory:example.test',
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      controller.put(userContext, roomId, {
        eventUid: 'planning@example.test',
        recurrenceId: null,
        alarmUid: 'alarm-1@example.test',
        calendarId: 'another-room-calendar',
      }),
    ).toThrow(BadRequestException);
    expect(service.put).not.toHaveBeenCalled();
  });
});
