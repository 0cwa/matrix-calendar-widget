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
import type { RoomCalendarBindingRegistry } from '../service/IRoomCalendarBindingRegistry';
import { resolveRoomCalendarBinding } from '../service/RoomCalendarBindingResolver';
import {
  RoomCalendarCalDavAccess,
  RoomCalendarCalDavPrincipal,
} from '../service/RoomCalendarCalDavAccess';
import { RoomCalendarEventOperations } from '../service/RoomCalendarEventOperations';
import type { RoomCalendarPrincipalIdentity } from '../service/RoomCalendarPrincipalIdentity';
import { RoomMentionMatrixState } from './RoomMentionPolicy';
import { RoomReminderConfigurationService } from './RoomReminderConfigurationService';
import type { RoomReminderStore } from './RoomReminderStore';

const roomId = '!team:example.test';
const calendarId = 'team-calendar';
const actor = '@alice:example.test';
const serviceIdentity: RoomCalendarPrincipalIdentity = Object.freeze({
  mode: 'appservice',
  userId: '@calendar-service:example.test',
});
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
  let compareAndUpsertConfiguration: jest.Mock;
  let getConfiguration: jest.Mock;
  let deleteConfiguration: jest.Mock;
  let getJoinedRoomMembers: jest.Mock;
  let getPowerLevels: jest.Mock;
  let getRoomVersion: jest.Mock;
  let isRoomEncrypted: jest.Mock;
  let forAuthorizedTarget: jest.Mock;
  let getEventResource: jest.Mock;
  let currentTime: number;
  let service: RoomReminderConfigurationService;
  let bindingRegistry: RoomCalendarBindingRegistry;

  beforeEach(() => {
    currentTime = Date.parse('2026-10-01T00:00:00.000Z');
    configuration = {
      room_reminder_configuration_enabled: true,
      room_calendar_access_enabled: true,
      room_calendar_principal_mode: 'appservice',
      room_calendar_bindings: [{ roomId, calendarId } as RoomCalendarBinding],
    } as unknown as IAppConfiguration;
    bindingRegistry = {
      getSnapshot: async () => configuration.room_calendar_bindings,
      resolve: async (requestedRoomId, requestedCalendarId) =>
        resolveRoomCalendarBinding(
          configuration.room_calendar_bindings,
          requestedRoomId,
          requestedCalendarId,
        ),
    };

    listConfigurationPage = jest.fn().mockResolvedValue([]);
    compareAndUpsertConfiguration = jest.fn().mockResolvedValue(true);
    getConfiguration = jest.fn().mockImplementation(async (identity) => ({
      ...identity,
      target: { kind: 'room' },
      allDaySchedule: null,
      revision: 1,
    }));
    deleteConfiguration = jest.fn().mockResolvedValue(undefined);
    const store = {
      enabled: true,
      listConfigurationPage,
      compareAndUpsertConfiguration,
      getConfiguration,
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
      identity: serviceIdentity,
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
      bindingRegistry,
      () => currentTime,
    );
  });

  it('returns target and schedule metadata with canonical identities from a bounded page', async () => {
    listConfigurationPage.mockResolvedValue([
      {
        roomId,
        calendarId,
        eventUid: 'event@example.test',
        recurrenceId: null,
        alarmUid,
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
        target: { kind: 'room' },
        allDaySchedule: null,
        revision: 1,
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
    expect(compareAndUpsertConfiguration).not.toHaveBeenCalled();
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
      expect(compareAndUpsertConfiguration).not.toHaveBeenCalled();
      expect(deleteConfiguration).not.toHaveBeenCalled();
    },
  );

  it('validates the live canonical source before persisting its sidecar target and schedule', async () => {
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
    expect(compareAndUpsertConfiguration).toHaveBeenCalledWith(
      {
        roomId,
        calendarId,
        eventUid: 'team-planning@example.test',
        recurrenceId: null,
        alarmUid,
        target: { kind: 'room' },
        allDaySchedule: null,
      },
      {
        roomId,
        calendarId,
        eventUid: 'team-planning@example.test',
        recurrenceId: null,
        alarmUid,
        target: { kind: 'room' },
        allDaySchedule: null,
        revision: 1,
      },
    );
    expect(result).toEqual({
      eventUid: 'team-planning@example.test',
      recurrenceId: null,
      alarmUid,
      target: { kind: 'room' },
      allDaySchedule: null,
      revision: 1,
    });
    expect(JSON.stringify(result)).not.toContain('private');
    expect(
      JSON.stringify(compareAndUpsertConfiguration.mock.calls),
    ).not.toContain('proof-secret');
    expect(getJoinedRoomMembers.mock.invocationCallOrder[0]).toBeLessThan(
      forAuthorizedTarget.mock.invocationCallOrder[0],
    );
    expect(forAuthorizedTarget.mock.invocationCallOrder[0]).toBeLessThan(
      getEventResource.mock.invocationCallOrder[0],
    );
    expect(getEventResource.mock.invocationCallOrder[0]).toBeLessThan(
      compareAndUpsertConfiguration.mock.invocationCallOrder[0],
    );
    expect(getConfiguration).toHaveBeenCalledWith({
      roomId,
      calendarId,
      eventUid: 'team-planning@example.test',
      recurrenceId: null,
      alarmUid,
    });
  });

  it('validates selected users against current joined membership before reading CalDAV', async () => {
    const target = {
      kind: 'users' as const,
      userIds: ['@bob:example.test', '@former:example.test'],
    };
    getJoinedRoomMembers.mockResolvedValue([
      actor,
      '@bob:example.test',
      '@calendar-service:example.test',
    ]);
    getConfiguration.mockResolvedValue({
      roomId,
      calendarId,
      eventUid: 'team-planning@example.test',
      recurrenceId: null,
      alarmUid,
      target,
      allDaySchedule: null,
      revision: 2,
    });

    await expect(
      service.upsert(actor, roomId, {
        eventId: 'https://dav.example.test/calendar/planning.ics',
        recurrenceId: null,
        alarmUid,
        target,
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(getJoinedRoomMembers).toHaveBeenCalledTimes(2);
    expect(forAuthorizedTarget).not.toHaveBeenCalled();
    expect(getEventResource).not.toHaveBeenCalled();
    expect(compareAndUpsertConfiguration).not.toHaveBeenCalled();
  });

  it('rejects a selected user who left before configuration', async () => {
    getJoinedRoomMembers
      .mockResolvedValueOnce([actor])
      .mockResolvedValueOnce([actor]);

    await expect(
      service.upsert(actor, roomId, {
        eventId: 'https://dav.example.test/calendar/planning.ics',
        recurrenceId: null,
        alarmUid,
        target: { kind: 'users', userIds: ['@former:example.test'] },
      }),
    ).rejects.toMatchObject({
      status: 400,
      response: {
        code: 'room-reminder-recipient-not-joined',
      },
    });
    expect(forAuthorizedTarget).not.toHaveBeenCalled();
    expect(getEventResource).not.toHaveBeenCalled();
    expect(compareAndUpsertConfiguration).not.toHaveBeenCalled();
  });

  it('allows an explicitly scheduled DATE alarm and persists only its schedule sidecar', async () => {
    const allDayIcalendar = icalendar
      .replace('RRULE:FREQ=WEEKLY;COUNT=3', '')
      .replace(
        'DTSTART;TZID=Europe/Stockholm:20261005T090000',
        'DTSTART;VALUE=DATE:20261005',
      )
      .replace(
        'DTEND;TZID=Europe/Stockholm:20261005T100000',
        'DTEND;VALUE=DATE:20261006',
      );
    getEventResource.mockResolvedValue({
      event: { summary: 'private title' },
      etag: 'private-etag',
      icalendar: allDayIcalendar,
    });
    const allDaySchedule = {
      daysBefore: 1,
      localTime: '09:00',
      timezone: 'Europe/Stockholm',
    };
    getConfiguration.mockImplementation(async (identity) => ({
      ...identity,
      target: { kind: 'room' },
      allDaySchedule,
      revision: 1,
    }));

    await expect(
      service.upsert(actor, roomId, {
        eventId: 'https://dav.example.test/calendar/planning.ics',
        recurrenceId: null,
        alarmUid,
        allDaySchedule,
      }),
    ).resolves.toMatchObject({
      eventUid: 'team-planning@example.test',
      target: { kind: 'room' },
      allDaySchedule,
    });
    expect(compareAndUpsertConfiguration).toHaveBeenCalledWith(
      {
        roomId,
        calendarId,
        eventUid: 'team-planning@example.test',
        recurrenceId: null,
        alarmUid,
        target: { kind: 'room' },
        allDaySchedule,
      },
      expect.objectContaining({ target: { kind: 'room' }, allDaySchedule }),
    );
  });

  it('rejects a past one-time DATE reminder on the server before persistence', async () => {
    const allDayIcalendar = icalendar
      .replace('RRULE:FREQ=WEEKLY;COUNT=3', '')
      .replace(
        'DTSTART;TZID=Europe/Stockholm:20261005T090000',
        'DTSTART;VALUE=DATE:20261005',
      )
      .replace(
        'DTEND;TZID=Europe/Stockholm:20261005T100000',
        'DTEND;VALUE=DATE:20261006',
      );
    getEventResource.mockResolvedValue({
      event: { summary: 'private title' },
      etag: 'private-etag',
      icalendar: allDayIcalendar,
    });
    currentTime = Date.parse('2026-10-04T07:01:00.000Z');

    await expect(
      service.upsert(actor, roomId, {
        eventId: 'https://dav.example.test/calendar/planning.ics',
        recurrenceId: null,
        alarmUid,
        allDaySchedule: {
          daysBefore: 1,
          localTime: '09:00',
          timezone: 'Europe/Stockholm',
        },
      }),
    ).rejects.toMatchObject({
      status: 400,
      response: {
        code: 'room-reminder-time-in-past',
      },
    });
    expect(compareAndUpsertConfiguration).not.toHaveBeenCalled();
  });

  it('allows a recipient-only edit after an existing DATE reminder becomes due', async () => {
    const allDayIcalendar = icalendar
      .replace('RRULE:FREQ=WEEKLY;COUNT=3', '')
      .replace(
        'DTSTART;TZID=Europe/Stockholm:20261005T090000',
        'DTSTART;VALUE=DATE:20261005',
      )
      .replace(
        'DTEND;TZID=Europe/Stockholm:20261005T100000',
        'DTEND;VALUE=DATE:20261006',
      );
    getEventResource.mockResolvedValue({
      event: { summary: 'private title' },
      etag: 'private-etag',
      icalendar: allDayIcalendar,
    });
    const allDaySchedule = {
      daysBefore: 1,
      localTime: '09:00',
      timezone: 'Europe/Stockholm',
    };
    const existing = {
      roomId,
      calendarId,
      eventUid: 'team-planning@example.test',
      recurrenceId: null,
      alarmUid,
      target: { kind: 'room' as const },
      allDaySchedule,
      scheduleEffectiveAt: new Date('2026-10-03T07:00:00.000Z'),
      revision: 4,
    };
    const target = { kind: 'users' as const, userIds: [actor] };
    getConfiguration
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce({ ...existing, target, revision: 5 });
    currentTime = Date.parse('2026-10-04T07:01:00.000Z');

    await expect(
      service.upsert(actor, roomId, {
        eventId: 'https://dav.example.test/calendar/planning.ics',
        recurrenceId: null,
        alarmUid,
        target,
        allDaySchedule,
      }),
    ).resolves.toMatchObject({ target, allDaySchedule, revision: 5 });
    expect(compareAndUpsertConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({ target, allDaySchedule }),
      existing,
    );
  });

  it('rejects a stale recipient edit when its configuration snapshot changed', async () => {
    const allDayIcalendar = icalendar
      .replace('RRULE:FREQ=WEEKLY;COUNT=3', '')
      .replace(
        'DTSTART;TZID=Europe/Stockholm:20261005T090000',
        'DTSTART;VALUE=DATE:20261005',
      )
      .replace(
        'DTEND;TZID=Europe/Stockholm:20261005T100000',
        'DTEND;VALUE=DATE:20261006',
      );
    getEventResource.mockResolvedValue({
      event: { summary: 'private title' },
      etag: 'private-etag',
      icalendar: allDayIcalendar,
    });
    const allDaySchedule = {
      daysBefore: 1,
      localTime: '09:00',
      timezone: 'Europe/Stockholm',
    };
    const existing = {
      roomId,
      calendarId,
      eventUid: 'team-planning@example.test',
      recurrenceId: null,
      alarmUid,
      target: { kind: 'room' as const },
      allDaySchedule,
      scheduleEffectiveAt: new Date('2026-10-03T07:00:00.000Z'),
      revision: 4,
    };
    const target = { kind: 'users' as const, userIds: [actor] };
    getConfiguration.mockResolvedValueOnce(existing);
    compareAndUpsertConfiguration.mockResolvedValueOnce(false);
    currentTime = Date.parse('2026-10-04T07:01:00.000Z');

    await expect(
      service.upsert(actor, roomId, {
        eventId: 'https://dav.example.test/calendar/planning.ics',
        recurrenceId: null,
        alarmUid,
        target,
        allDaySchedule,
      }),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: 'room-reminder-configuration-changed' },
    });
    expect(compareAndUpsertConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({ target, allDaySchedule }),
      existing,
    );
    expect(getConfiguration).toHaveBeenCalledTimes(1);
  });

  it('allows a past current DATE occurrence when the selected master is recurring', async () => {
    const allDayRecurringIcalendar = icalendar
      .replace(
        'DTSTART;TZID=Europe/Stockholm:20261005T090000',
        'DTSTART;VALUE=DATE:20261005',
      )
      .replace('RRULE:FREQ=WEEKLY;COUNT=3', 'RRULE:FREQ=DAILY;COUNT=3')
      .replace(
        'DTEND;TZID=Europe/Stockholm:20261005T100000',
        'DTEND;VALUE=DATE:20261006',
      );
    getEventResource.mockResolvedValue({
      event: { summary: 'private title' },
      etag: 'private-etag',
      icalendar: allDayRecurringIcalendar,
    });
    const allDaySchedule = {
      daysBefore: 0,
      localTime: '09:00',
      timezone: 'Europe/Stockholm',
    };
    getConfiguration.mockImplementation(async (identity) => ({
      ...identity,
      target: { kind: 'room' },
      allDaySchedule,
      revision: 1,
    }));
    currentTime = Date.parse('2026-10-05T08:00:00.000Z');

    await expect(
      service.upsert(actor, roomId, {
        eventId: 'https://dav.example.test/calendar/planning.ics',
        recurrenceId: null,
        alarmUid,
        allDaySchedule,
      }),
    ).resolves.toMatchObject({
      target: { kind: 'room' },
      allDaySchedule,
    });
    expect(compareAndUpsertConfiguration).toHaveBeenCalledTimes(1);
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
    expect(compareAndUpsertConfiguration).not.toHaveBeenCalled();
  });

  it('rejects stale relative reminder intent when the current alarm is absolute', async () => {
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
    expect(compareAndUpsertConfiguration).not.toHaveBeenCalled();
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
    expect(compareAndUpsertConfiguration).not.toHaveBeenCalled();
  });
});
