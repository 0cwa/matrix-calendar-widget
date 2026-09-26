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

import { CalendarAuthorizationRequest } from '@matrix-calendar-widget/calendar';
import {
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { IAppConfiguration } from '../IAppConfiguration';
import { RoomReminderConfiguration, RoomReminderStore } from '../reminder';
import { MatrixCalendarAuthorizationFactory } from './MatrixCalendarAuthorization';
import { RoomReminderConfigurationService } from './RoomReminderConfigurationService';

const roomId = '!team:example.test';
const actorId = '@alice:example.test';
const configuration: RoomReminderConfiguration = {
  roomId,
  calendarId: 'team-calendar',
  eventUid: 'planning@example.test',
  recurrenceId: null,
  alarmUid: 'alarm-uid@example.test',
};

function createHarness(options: { enabled?: boolean } = {}) {
  const calls: string[] = [];
  const rows = new Map<string, RoomReminderConfiguration>();
  const authorization = {
    isAllowed: jest.fn(async (request: CalendarAuthorizationRequest) => {
      calls.push(request.action);
      return true;
    }),
  };
  const authorizationFactory = {
    forRoom: jest.fn(() => authorization),
  };
  const store: RoomReminderStore = {
    enabled: options.enabled ?? true,
    upsertConfiguration: jest.fn(async (value) => {
      calls.push('upsert');
      rows.set(identityKey(value), value);
    }),
    listConfigurations: jest.fn(async (requestedRoom, calendarId) => {
      calls.push('list');
      return [...rows.values()].filter(
        (row) => row.roomId === requestedRoom && row.calendarId === calendarId,
      );
    }),
    deleteConfiguration: jest.fn(async (value) => {
      calls.push('delete');
      rows.delete(identityKey(value));
    }),
    deleteEventConfigurations: jest.fn(),
    deleteCalendarConfigurations: jest.fn(),
    claimDelivery: jest.fn(),
    markDeliverySent: jest.fn(),
    releaseDeliveryClaim: jest.fn(),
  };
  const appConfig = {
    room_calendar_bindings: [
      { roomId, calendarId: 'team-calendar' },
      { roomId: '!other:example.test', calendarId: 'other-calendar' },
    ],
  } as unknown as IAppConfiguration;
  const service = new RoomReminderConfigurationService(
    appConfig,
    authorizationFactory as unknown as MatrixCalendarAuthorizationFactory,
    store,
  );
  return { service, authorization, authorizationFactory, store, rows, calls };
}

function identityKey(configuration: RoomReminderConfiguration): string {
  return [
    configuration.roomId,
    configuration.calendarId,
    configuration.eventUid,
    configuration.recurrenceId ?? '',
    configuration.alarmUid,
  ].join('|');
}

describe('RoomReminderConfigurationService', () => {
  it('authorizes a room read before making a room-and-calendar-scoped store call', async () => {
    const { service, authorization, store, rows, calls } = createHarness();
    rows.set(identityKey(configuration), configuration);

    await expect(service.list(actorId, roomId)).resolves.toEqual([
      configuration,
    ]);

    expect(authorization.isAllowed).toHaveBeenCalledWith({
      action: 'read-events',
      calendarId: 'team-calendar',
    });
    expect(store.listConfigurations).toHaveBeenCalledWith(
      roomId,
      'team-calendar',
    );
    expect(calls).toEqual(['list-calendars', 'read-events', 'list']);
  });

  it('does not access the store when the actor lacks read permission', async () => {
    const { service, authorization, store } = createHarness();
    authorization.isAllowed.mockImplementation(async (request) => {
      return request.action !== 'read-events';
    });

    await expect(service.list(actorId, roomId)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(store.listConfigurations).not.toHaveBeenCalled();
  });

  it('does not resolve a binding or access the store for a non-member', async () => {
    const { service, authorization, store } = createHarness();
    authorization.isAllowed.mockResolvedValueOnce(false);

    await expect(service.list(actorId, roomId)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(authorization.isAllowed).toHaveBeenCalledWith({
      action: 'list-calendars',
    });
    expect(authorization.isAllowed).toHaveBeenCalledTimes(1);
    expect(store.listConfigurations).not.toHaveBeenCalled();
  });

  it('does not access the store when the room has no configured binding', async () => {
    const { service, authorizationFactory, store } = createHarness();

    await expect(
      service.list(actorId, '!unbound:example.test'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(authorizationFactory.forRoom).toHaveBeenCalledWith(
      actorId,
      '!unbound:example.test',
    );
    expect(store.listConfigurations).not.toHaveBeenCalled();
  });

  it('uses update-event permission and the event UID for mutations', async () => {
    const { service, authorization, store, calls } = createHarness();
    const identity = {
      eventUid: configuration.eventUid,
      recurrenceId: configuration.recurrenceId,
      alarmUid: configuration.alarmUid,
    };

    await expect(service.put(actorId, roomId, identity)).resolves.toEqual(
      configuration,
    );
    await service.put(actorId, roomId, identity);
    await expect(service.list(actorId, roomId)).resolves.toEqual([
      configuration,
    ]);
    await service.delete(actorId, roomId, identity);
    await service.delete(actorId, roomId, identity);
    await expect(service.list(actorId, roomId)).resolves.toEqual([]);

    expect(authorization.isAllowed).toHaveBeenNthCalledWith(2, {
      action: 'update-event',
      calendarId: 'team-calendar',
      eventId: configuration.eventUid,
    });
    expect(store.upsertConfiguration).toHaveBeenCalledTimes(2);
    expect(store.deleteConfiguration).toHaveBeenCalledTimes(2);
    expect(calls).toEqual([
      'list-calendars',
      'update-event',
      'upsert',
      'list-calendars',
      'update-event',
      'upsert',
      'list-calendars',
      'read-events',
      'list',
      'list-calendars',
      'update-event',
      'delete',
      'list-calendars',
      'update-event',
      'delete',
      'list-calendars',
      'read-events',
      'list',
    ]);
  });

  it('does not access the store when the actor lacks event-write power', async () => {
    const { service, authorization, store } = createHarness();
    authorization.isAllowed.mockImplementation(async (request) => {
      return request.action !== 'update-event';
    });

    await expect(
      service.put(actorId, roomId, {
        eventUid: configuration.eventUid,
        recurrenceId: null,
        alarmUid: configuration.alarmUid,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(store.upsertConfiguration).not.toHaveBeenCalled();
  });

  it('fails closed with 503 while reminder storage is disabled', async () => {
    const { service, store, authorization } = createHarness({ enabled: false });

    await expect(service.list(actorId, roomId)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(authorization.isAllowed).toHaveBeenCalled();
    expect(store.listConfigurations).not.toHaveBeenCalled();
  });

  it('scopes a second room to its own statically bound calendar', async () => {
    const { service, store } = createHarness();

    await service.list(actorId, '!other:example.test');

    expect(store.listConfigurations).toHaveBeenCalledWith(
      '!other:example.test',
      'other-calendar',
    );
  });
});
