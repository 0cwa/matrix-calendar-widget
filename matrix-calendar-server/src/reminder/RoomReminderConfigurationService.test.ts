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

import fs from 'fs';
import path from 'path';
import { IAppConfiguration } from '../IAppConfiguration';
import { IMatrixOpenIdCredential } from '../model/IMatrixOpenIdCredential';
import { RoomCalendarBinding } from '../model/IRoomCalendarBinding';
import {
  RoomCalendarCalDavAccess,
  RoomCalendarCalDavPrincipal,
} from '../service/RoomCalendarCalDavAccess';
import { RoomCalendarEventOperations } from '../service/RoomCalendarEventOperations';
import { RoomMentionMatrixState } from './RoomMentionPolicy';
import { RoomReminderConfigurationService } from './RoomReminderConfigurationService';
import type { RoomReminderStore } from './RoomReminderStore';

const roomId = '!team:example.test';
const calendarId = 'team-calendar';
const actor = '@alice:example.test';
const alarmUid = 'master-alarm@example.test';
const icalendar = fs
  .readFileSync(
    path.resolve(
      __dirname,
      '../../../fixtures/ical/reminder-identity-resource.ics',
    ),
    'utf8',
  )
  .replace(/BEGIN:VTIMEZONE[\s\S]*?END:VTIMEZONE\r?\n/, '');

describe('RoomReminderConfigurationService', () => {
  let configuration: IAppConfiguration;
  let listConfigurationPage: jest.Mock;
  let upsertConfiguration: jest.Mock;
  let deleteConfiguration: jest.Mock;
  let getJoinedRoomMembers: jest.Mock;
  let getPowerLevels: jest.Mock;
  let getRoomVersion: jest.Mock;
  let isRoomEncrypted: jest.Mock;
  let forAuthorizedTarget: jest.Mock;
  let getEventResource: jest.Mock;
  let service: RoomReminderConfigurationService;

  beforeEach(() => {
    configuration = {
      room_reminder_configuration_enabled: true,
      room_calendar_access_enabled: true,
      room_calendar_bindings: [{ roomId, calendarId } as RoomCalendarBinding],
    } as unknown as IAppConfiguration;

    listConfigurationPage = jest.fn().mockResolvedValue([]);
    upsertConfiguration = jest.fn().mockResolvedValue(undefined);
    deleteConfiguration = jest.fn().mockResolvedValue(undefined);
    const store = {
      enabled: true,
      listConfigurationPage,
      upsertConfiguration,
      deleteConfiguration,
    } as unknown as RoomReminderStore;

    getJoinedRoomMembers = jest.fn().mockResolvedValue([actor]);
    getPowerLevels = jest.fn().mockResolvedValue({
      users: { [actor]: 100 },
      events: { 'io.github.0cwa.matrix-calendar.manage': 50 },
    });
    getRoomVersion = jest.fn().mockResolvedValue('10');
    isRoomEncrypted = jest.fn().mockResolvedValue(false);
    const matrixState = {
      getJoinedRoomMembers,
      getPowerLevels,
      getRoomVersion,
      isRoomEncrypted,
    } as unknown as RoomMentionMatrixState;

    const principal: RoomCalendarCalDavPrincipal = {
      userId: '@calendar-service:example.test',
      calendarUrl: 'https://dav.example.test/calendar',
      credential: {
        accessToken: 'proof-secret',
        matrixServerName: 'example.test',
      } as IMatrixOpenIdCredential,
    };
    forAuthorizedTarget = jest.fn().mockResolvedValue(principal);
    getEventResource = jest.fn().mockResolvedValue({
      event: { summary: 'private title' },
      etag: 'private-etag',
      icalendar,
    });
    service = new RoomReminderConfigurationService(
      configuration,
      store,
      matrixState,
      { forAuthorizedTarget } as unknown as RoomCalendarCalDavAccess,
      { getEventResource } as unknown as RoomCalendarEventOperations,
    );
  });

  it('returns only canonical identity tuples from a bounded, room-scoped page', async () => {
    listConfigurationPage.mockResolvedValue([
      {
        roomId,
        calendarId,
        eventUid: 'event@example.test',
        recurrenceId: null,
        alarmUid,
        privateText: 'must not escape',
      },
    ]);

    const result = await service.list(actor, roomId, '1', undefined);

    expect(listConfigurationPage).toHaveBeenCalledWith(
      roomId,
      calendarId,
      undefined,
      1,
    );
    expect(result.items).toEqual([
      {
        eventUid: 'event@example.test',
        recurrenceId: null,
        alarmUid,
      },
    ]);
    expect(JSON.stringify(result)).not.toContain('private');
    expect(result.nextCursor).toBeDefined();
  });

  it('does not read the store when a cursor belongs to another room', async () => {
    const otherScopeCursor = Buffer.from(
      JSON.stringify({
        version: 1,
        roomId: '!other:example.test',
        calendarId,
        eventUid: 'event@example.test',
        recurrenceId: null,
        alarmUid,
      }),
    ).toString('base64url');

    await expect(
      service.list(actor, roomId, '10', otherScopeCursor),
    ).rejects.toMatchObject({ status: 400 });
    expect(listConfigurationPage).not.toHaveBeenCalled();
  });

  it('fails closed if the page store violates the requested bound', async () => {
    listConfigurationPage.mockResolvedValue([
      {
        roomId,
        calendarId,
        eventUid: 'one@example.test',
        recurrenceId: null,
        alarmUid,
      },
      {
        roomId,
        calendarId,
        eventUid: 'two@example.test',
        recurrenceId: null,
        alarmUid,
      },
    ]);

    await expect(
      service.list(actor, roomId, '1', undefined),
    ).rejects.toMatchObject({
      status: 503,
    });
  });

  it('fails closed if the page store returns a row outside the authorized scope', async () => {
    listConfigurationPage.mockResolvedValue([
      {
        roomId: '!other:example.test',
        calendarId,
        eventUid: 'private-event@example.test',
        recurrenceId: null,
        alarmUid,
      },
    ]);

    await expect(
      service.list(actor, roomId, '10', undefined),
    ).rejects.toMatchObject({ status: 503 });
  });

  it('authorizes the current joined manager before proof, CalDAV, or writes', async () => {
    getPowerLevels.mockResolvedValue({
      users: { [actor]: 0 },
      events: { 'io.github.0cwa.matrix-calendar.manage': 50 },
    });

    await expect(
      service.upsert(actor, roomId, {
        eventId: 'https://dav.example.test/calendar/planning.ics',
        recurrenceId: null,
        alarmUid,
      }),
    ).rejects.toMatchObject({ status: 403 });

    expect(forAuthorizedTarget).not.toHaveBeenCalled();
    expect(getEventResource).not.toHaveBeenCalled();
    expect(upsertConfiguration).not.toHaveBeenCalled();
  });

  it.each(['encrypted', 'unknown encryption state'] as const)(
    'denies %s rooms before source reads or configuration store operations',
    async (encryptionState) => {
      if (encryptionState === 'encrypted') {
        isRoomEncrypted.mockResolvedValue(true);
      } else {
        isRoomEncrypted.mockRejectedValue(
          new Error('private Matrix state failure'),
        );
      }

      await expect(
        service.list(actor, roomId, '10', undefined),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        service.upsert(actor, roomId, {
          eventId: 'https://dav.example.test/calendar/planning.ics',
          recurrenceId: null,
          alarmUid,
        }),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        service.delete(actor, roomId, {
          eventUid: 'event@example.test',
          recurrenceId: null,
          alarmUid,
        }),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        service.readSourceForAlarmOptions(
          actor,
          roomId,
          'https://dav.example.test/calendar/planning.ics',
        ),
      ).rejects.toMatchObject({ status: 403 });

      expect(isRoomEncrypted).toHaveBeenCalledTimes(4);
      expect(getJoinedRoomMembers).not.toHaveBeenCalled();
      expect(forAuthorizedTarget).not.toHaveBeenCalled();
      expect(getEventResource).not.toHaveBeenCalled();
      expect(listConfigurationPage).not.toHaveBeenCalled();
      expect(upsertConfiguration).not.toHaveBeenCalled();
      expect(deleteConfiguration).not.toHaveBeenCalled();
    },
  );

  it('validates the live canonical source before persisting only its identity', async () => {
    const result = await service.upsert(actor, roomId, {
      eventId: 'https://dav.example.test/calendar/planning.ics',
      recurrenceId: null,
      alarmUid,
    });

    expect(getJoinedRoomMembers).toHaveBeenCalledWith(roomId);
    expect(forAuthorizedTarget).toHaveBeenCalledWith(
      { roomId, calendarId, principal: { kind: 'service' } },
      'read',
    );
    expect(getEventResource).toHaveBeenCalledWith(
      {
        target: { roomId, calendarId, principal: { kind: 'service' } },
        servicePrincipal: expect.objectContaining({
          userId: '@calendar-service:example.test',
        }),
      },
      'https://dav.example.test/calendar/planning.ics',
    );
    expect(upsertConfiguration).toHaveBeenCalledWith({
      roomId,
      calendarId,
      eventUid: 'team-planning@example.test',
      recurrenceId: null,
      alarmUid,
    });
    expect(result).toEqual({
      eventUid: 'team-planning@example.test',
      recurrenceId: null,
      alarmUid,
    });
    expect(JSON.stringify(result)).not.toContain('private');
    expect(JSON.stringify(upsertConfiguration.mock.calls)).not.toContain(
      'proof-secret',
    );
    expect(getJoinedRoomMembers.mock.invocationCallOrder[0]).toBeLessThan(
      forAuthorizedTarget.mock.invocationCallOrder[0],
    );
    expect(forAuthorizedTarget.mock.invocationCallOrder[0]).toBeLessThan(
      getEventResource.mock.invocationCallOrder[0],
    );
    expect(getEventResource.mock.invocationCallOrder[0]).toBeLessThan(
      upsertConfiguration.mock.invocationCallOrder[0],
    );
  });

  it('shares the authorized current-source read with internal alarm-options code', async () => {
    const result = await service.readSourceForAlarmOptions(
      actor,
      roomId,
      'https://dav.example.test/calendar/planning.ics',
    );

    expect(result).toEqual({ calendarId, icalendar });
    expect(forAuthorizedTarget).toHaveBeenCalledWith(
      { roomId, calendarId, principal: { kind: 'service' } },
      'read',
    );
    expect(getEventResource).toHaveBeenCalledWith(
      {
        target: { roomId, calendarId, principal: { kind: 'service' } },
        servicePrincipal: expect.objectContaining({
          userId: '@calendar-service:example.test',
        }),
      },
      'https://dav.example.test/calendar/planning.ics',
    );
  });

  it('denies internal source access before proof when the actor is unauthorized', async () => {
    getPowerLevels.mockResolvedValue({
      users: { [actor]: 0 },
      events: { 'io.github.0cwa.matrix-calendar.manage': 50 },
    });

    await expect(
      service.readSourceForAlarmOptions(
        actor,
        roomId,
        'https://dav.example.test/calendar/planning.ics',
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(forAuthorizedTarget).not.toHaveBeenCalled();
    expect(getEventResource).not.toHaveBeenCalled();
  });

  it('rejects an unsafe internal source identifier before proof', async () => {
    await expect(
      service.readSourceForAlarmOptions(actor, roomId, '../planning.ics'),
    ).rejects.toMatchObject({ status: 400 });
    expect(forAuthorizedTarget).not.toHaveBeenCalled();
    expect(getEventResource).not.toHaveBeenCalled();
  });

  it('rejects caller-selected event identity and arbitrary body properties before I/O', async () => {
    await expect(
      service.upsert(actor, roomId, {
        eventId: 'https://dav.example.test/calendar/planning.ics',
        recurrenceId: null,
        alarmUid,
        eventUid: 'attacker-selected@example.test',
      }),
    ).rejects.toMatchObject({ status: 400 });

    expect(getJoinedRoomMembers).not.toHaveBeenCalled();
    expect(forAuthorizedTarget).not.toHaveBeenCalled();
    expect(getEventResource).not.toHaveBeenCalled();
    expect(upsertConfiguration).not.toHaveBeenCalled();
  });

  it('rejects a non-triggerable or stale alarm without storing calendar text', async () => {
    getEventResource.mockResolvedValue({
      event: { summary: 'private title' },
      etag: 'private-etag',
      icalendar: icalendar.replace(
        'TRIGGER:-PT15M',
        'TRIGGER;VALUE=DATE-TIME:20261005T080000Z',
      ),
    });

    await expect(
      service.upsert(actor, roomId, {
        eventId: 'https://dav.example.test/calendar/planning.ics',
        recurrenceId: null,
        alarmUid,
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(upsertConfiguration).not.toHaveBeenCalled();
    expect(forAuthorizedTarget).toHaveBeenCalledTimes(1);
  });

  it('deletes stale tuples under current manager policy without a CalDAV fetch', async () => {
    const identity = {
      eventUid: 'deleted-event@example.test',
      recurrenceId: null,
      alarmUid,
    };

    await expect(service.delete(actor, roomId, identity)).resolves.toEqual({
      deleted: true,
    });
    expect(deleteConfiguration).toHaveBeenCalledWith({
      roomId,
      calendarId,
      ...identity,
    });
    expect(forAuthorizedTarget).not.toHaveBeenCalled();
    expect(getEventResource).not.toHaveBeenCalled();
  });

  it('fails closed without external calls while disabled', async () => {
    configuration.room_reminder_configuration_enabled = false;

    await expect(
      service.upsert(actor, roomId, {
        eventId: 'https://dav.example.test/calendar/planning.ics',
        recurrenceId: null,
        alarmUid,
      }),
    ).rejects.toMatchObject({ status: 503 });
    expect(getJoinedRoomMembers).not.toHaveBeenCalled();
    expect(forAuthorizedTarget).not.toHaveBeenCalled();
    expect(getEventResource).not.toHaveBeenCalled();
    expect(upsertConfiguration).not.toHaveBeenCalled();
  });
});
