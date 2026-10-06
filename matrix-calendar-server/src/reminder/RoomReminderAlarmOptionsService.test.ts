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

import { ForbiddenException } from '@nestjs/common';
import { CanonicalReminderResourceData } from './CanonicalReminderIdentityResolver';
import { RoomReminderAlarmOptionsService } from './RoomReminderAlarmOptionsService';
import { RoomReminderConfigurationService } from './RoomReminderConfigurationService';

const eventId = 'https://dav.example.test/calendar/planning.ics';
const calendarId = 'team-calendar';
const actor = '@alice:example.test';
const roomId = '!team:example.test';

describe('RoomReminderAlarmOptionsService', () => {
  it('returns only supported timing and identity metadata from the bound current source', async () => {
    const readSourceForAlarmOptions = jest.fn().mockResolvedValue({
      calendarId,
      icalendar: resourceWithTwoSupportedAlarms(),
    });
    const service = new RoomReminderAlarmOptionsService({
      readSourceForAlarmOptions,
    } as unknown as RoomReminderConfigurationService);

    const result = await service.list(actor, roomId, eventId);

    expect(readSourceForAlarmOptions).toHaveBeenCalledWith(
      actor,
      roomId,
      eventId,
    );
    expect(result).toEqual({
      options: [
        {
          eventUid: 'planning@example.test',
          recurrenceId: null,
          alarmUid: 'start-alarm@example.test',
          relatedTo: 'start',
          trigger: {
            weeks: 0,
            days: 0,
            hours: 0,
            minutes: 15,
            seconds: 0,
            isNegative: true,
          },
        },
        {
          eventUid: 'planning@example.test',
          recurrenceId: null,
          alarmUid: 'end-alarm@example.test',
          relatedTo: 'end',
          trigger: {
            weeks: 0,
            days: 0,
            hours: 0,
            minutes: 10,
            seconds: 0,
            isNegative: false,
          },
          repeat: {
            count: 2,
            interval: {
              weeks: 0,
              days: 0,
              hours: 0,
              minutes: 5,
              seconds: 0,
              isNegative: false,
            },
          },
        },
      ],
    });
    const serialized = JSON.stringify(result);
    for (const privateValue of [
      'Private title',
      'Private alarm description',
      eventId,
      'BEGIN:VCALENDAR',
    ]) {
      expect(serialized).not.toContain(privateValue);
    }
  });

  it('returns the canonical event UID for each alarm in a multi-event resource', async () => {
    const resource: CanonicalReminderResourceData = {
      calendarId,
      icalendar: [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        event(
          'first@example.test',
          'DTSTART:20261001T090000Z',
          'TRIGGER:-PT5M',
        ),
        event(
          'second@example.test',
          'DTSTART:20261001T090000Z',
          'TRIGGER:-PT10M',
        ),
        'END:VCALENDAR',
        '',
      ].join('\r\n'),
    };
    const service = new RoomReminderAlarmOptionsService({
      readSourceForAlarmOptions: jest.fn().mockResolvedValue(resource),
    } as unknown as RoomReminderConfigurationService);

    const result = await service.list(actor, roomId, eventId);

    expect(
      result.options.map(({ eventUid, alarmUid, trigger }) => ({
        eventUid,
        alarmUid,
        trigger,
      })),
    ).toEqual([
      {
        eventUid: 'first@example.test',
        alarmUid: 'first@example.test-alarm',
        trigger: {
          weeks: 0,
          days: 0,
          hours: 0,
          minutes: 5,
          seconds: 0,
          isNegative: true,
        },
      },
      {
        eventUid: 'second@example.test',
        alarmUid: 'second@example.test-alarm',
        trigger: {
          weeks: 0,
          days: 0,
          hours: 0,
          minutes: 10,
          seconds: 0,
          isNegative: true,
        },
      },
    ]);
    expect(JSON.stringify(result)).not.toContain('Reminder');
    expect(JSON.stringify(result)).not.toContain('BEGIN:VCALENDAR');
  });

  it('returns no trigger option after a configured relative alarm becomes absolute', async () => {
    const resource: CanonicalReminderResourceData = {
      calendarId,
      icalendar: [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        event(
          'planning@example.test',
          'DTSTART:20261001T090000Z',
          'TRIGGER;VALUE=DATE-TIME:20261001T085500Z',
        ),
        'END:VCALENDAR',
        '',
      ].join('\r\n'),
    };
    const service = new RoomReminderAlarmOptionsService({
      readSourceForAlarmOptions: jest.fn().mockResolvedValue(resource),
    } as unknown as RoomReminderConfigurationService);

    await expect(service.list(actor, roomId, eventId)).resolves.toEqual({
      options: [],
    });
  });

  it('omits alarms with unsupported anchors, absolute triggers, or malformed raw parameters', async () => {
    const resource: CanonicalReminderResourceData = {
      calendarId,
      icalendar: [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        event(
          'floating@example.test',
          'DTSTART:20261001T090000',
          'TRIGGER:-PT5M',
        ),
        event(
          'absolute@example.test',
          'DTSTART:20261001T090000Z',
          'TRIGGER;VALUE=DATE-TIME:20261001T085500Z',
        ),
        event(
          'malformed@example.test',
          'DTSTART:20261001T090000Z',
          'TRIGGER;RELATED=START;RELATED=END:-PT5M',
        ),
        'END:VCALENDAR',
        '',
      ].join('\r\n'),
    };
    const service = new RoomReminderAlarmOptionsService({
      readSourceForAlarmOptions: jest.fn().mockResolvedValue(resource),
    } as unknown as RoomReminderConfigurationService);

    await expect(service.list(actor, roomId, eventId)).resolves.toEqual({
      options: [],
    });
  });

  it('fails with a fixed unavailable result instead of truncating after an overflow', async () => {
    const resource: CanonicalReminderResourceData = {
      calendarId,
      icalendar: resourceWithAlarms(65),
    };
    const service = new RoomReminderAlarmOptionsService({
      readSourceForAlarmOptions: jest.fn().mockResolvedValue(resource),
    } as unknown as RoomReminderConfigurationService);

    await expect(service.list(actor, roomId, eventId)).rejects.toMatchObject({
      status: 503,
      response: {
        code: 'room-reminder-options-unavailable',
        message: 'Room reminder alarm options are unavailable',
      },
    });
  });

  it('preserves authorization failures and does not expose source errors', async () => {
    const forbidden = new ForbiddenException('Not permitted');
    const denied = new RoomReminderAlarmOptionsService({
      readSourceForAlarmOptions: jest.fn().mockRejectedValue(forbidden),
    } as unknown as RoomReminderConfigurationService);
    await expect(denied.list(actor, roomId, eventId)).rejects.toBe(forbidden);

    const sourceFailure = new RoomReminderAlarmOptionsService({
      readSourceForAlarmOptions: jest
        .fn()
        .mockRejectedValue(new Error('private source detail')),
    } as unknown as RoomReminderConfigurationService);
    await expect(
      sourceFailure.list(actor, roomId, eventId),
    ).rejects.toMatchObject({
      status: 503,
      response: {
        code: 'room-reminder-options-unavailable',
        message: 'Room reminder alarm options are unavailable',
      },
    });
  });
});

function resourceWithTwoSupportedAlarms(): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VEVENT',
    'UID:planning@example.test',
    'DTSTAMP:20260926T120000Z',
    'DTSTART:20261001T090000Z',
    'DTEND:20261001T100000Z',
    'SUMMARY:Private title',
    'BEGIN:VALARM',
    'UID:start-alarm@example.test',
    'ACTION:DISPLAY',
    'DESCRIPTION:Private alarm description',
    'TRIGGER:-PT15M',
    'END:VALARM',
    'BEGIN:VALARM',
    'UID:end-alarm@example.test',
    'ACTION:DISPLAY',
    'DESCRIPTION:Private alarm description',
    'TRIGGER;RELATED=END:PT10M',
    'REPEAT:2',
    'DURATION:PT5M',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

function resourceWithAlarms(count: number): string {
  const alarms = Array.from({ length: count }, (_, index) =>
    [
      'BEGIN:VALARM',
      `UID:alarm-${index}@example.test`,
      'ACTION:DISPLAY',
      'DESCRIPTION:Reminder',
      'TRIGGER:-PT5M',
      'END:VALARM',
    ].join('\r\n'),
  );
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VEVENT',
    'UID:bounded@example.test',
    'DTSTAMP:20260926T120000Z',
    'DTSTART:20261001T090000Z',
    'DTEND:20261001T100000Z',
    ...alarms,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

function event(uid: string, start: string, trigger: string): string {
  return [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    'DTSTAMP:20260926T120000Z',
    start,
    'DTEND:20261001T100000Z',
    'BEGIN:VALARM',
    `UID:${uid}-alarm`,
    'ACTION:DISPLAY',
    'DESCRIPTION:Reminder',
    trigger,
    'END:VALARM',
    'END:VEVENT',
  ].join('\r\n');
}
