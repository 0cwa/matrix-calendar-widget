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

import { CalendarAuthorization } from '@matrix-calendar-widget/calendar';
import { MatrixClient, PowerLevelsEventContent } from 'matrix-bot-sdk';
import { instance, mock, when } from 'ts-mockito';
import { StateEventName } from '../model/StateEventName';
import {
  MATRIX_CALENDAR_EVENT_WRITE_POLICY,
  MATRIX_CALENDAR_MANAGE_POLICY,
  MatrixCalendarAuthorizationFactory,
} from './MatrixCalendarAuthorization';

describe('MatrixCalendarAuthorizationFactory', () => {
  const roomId = '!team:example.test';
  const userId = '@alice:example.test';

  let matrixClientMock: MatrixClient;
  let authorization: CalendarAuthorization;

  beforeEach(() => {
    matrixClientMock = mock(MatrixClient);
    authorization = new MatrixCalendarAuthorizationFactory(
      instance(matrixClientMock),
    ).forRoom(userId, roomId);

    when(matrixClientMock.getJoinedRoomMembers(roomId)).thenResolve([userId]);
  });

  it('allows joined members to discover and read calendars', async () => {
    await expect(
      authorization.isAllowed({ action: 'list-calendars' }),
    ).resolves.toBe(true);
    await expect(
      authorization.isAllowed({
        action: 'read-events',
        calendarId: 'team',
      }),
    ).resolves.toBe(true);
  });

  it('denies all actions to users who are not joined', async () => {
    when(matrixClientMock.getJoinedRoomMembers(roomId)).thenResolve([
      '@someone-else:example.test',
    ]);

    await expect(
      authorization.isAllowed({
        action: 'read-events',
        calendarId: 'team',
      }),
    ).resolves.toBe(false);
    await expect(
      authorization.isAllowed({
        action: 'create-event',
        calendarId: 'team',
      }),
    ).resolves.toBe(false);
  });

  it('uses events_default for event writes by default', async () => {
    setPowerLevels({
      users: { [userId]: 0 },
      events_default: 0,
      state_default: 50,
    });

    await expect(
      authorization.isAllowed({
        action: 'create-event',
        calendarId: 'team',
      }),
    ).resolves.toBe(true);
    await expect(
      authorization.isAllowed({
        action: 'delete-event',
        calendarId: 'team',
        eventId: 'planning',
      }),
    ).resolves.toBe(true);
  });

  it('uses state_default for calendar management by default', async () => {
    setPowerLevels({
      users: { [userId]: 50 },
      events_default: 0,
      state_default: 50,
    });

    await expect(
      authorization.isAllowed({ action: 'create-calendar' }),
    ).resolves.toBe(true);
    await expect(
      authorization.isAllowed({
        action: 'manage-calendar',
        calendarId: 'team',
      }),
    ).resolves.toBe(true);
  });

  it('denies calendar management to ordinary members', async () => {
    setPowerLevels({
      users: { [userId]: 0 },
      events_default: 0,
      state_default: 50,
    });

    await expect(
      authorization.isAllowed({ action: 'create-calendar' }),
    ).resolves.toBe(false);
  });

  it('supports dedicated Matrix power-level overrides', async () => {
    setPowerLevels({
      users: { [userId]: 50 },
      events: {
        [MATRIX_CALENDAR_EVENT_WRITE_POLICY]: 40,
        [MATRIX_CALENDAR_MANAGE_POLICY]: 75,
      },
      events_default: 0,
      state_default: 50,
    });

    await expect(
      authorization.isAllowed({
        action: 'update-event',
        calendarId: 'team',
        eventId: 'planning',
      }),
    ).resolves.toBe(true);
    await expect(
      authorization.isAllowed({
        action: 'manage-calendar',
        calendarId: 'team',
      }),
    ).resolves.toBe(false);
  });

  it('falls back to Matrix defaults if no power-level event exists', async () => {
    when(
      matrixClientMock.getRoomStateEvent(
        roomId,
        StateEventName.M_ROOM_POWER_LEVELS_EVENT,
        '',
      ),
    ).thenReject(new Error('missing'));

    await expect(
      authorization.isAllowed({
        action: 'create-event',
        calendarId: 'team',
      }),
    ).resolves.toBe(true);
    await expect(
      authorization.isAllowed({ action: 'create-calendar' }),
    ).resolves.toBe(false);
  });

  function setPowerLevels(content: Partial<PowerLevelsEventContent>): void {
    when(
      matrixClientMock.getRoomStateEvent(
        roomId,
        StateEventName.M_ROOM_POWER_LEVELS_EVENT,
        '',
      ),
    ).thenResolve(content as PowerLevelsEventContent);
  }
});
