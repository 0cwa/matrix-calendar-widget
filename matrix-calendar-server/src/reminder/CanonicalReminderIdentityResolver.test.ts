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
import {
  CanonicalReminderIdentity,
  CanonicalReminderResolutionError,
  CanonicalReminderResourceData,
  encodeCanonicalReminderFiringRecurrenceIdentity,
  enumerateCanonicalReminderResourceSelections,
  resolveCanonicalReminderIdentity,
  resolveCanonicalReminderResourceSelection,
} from './CanonicalReminderIdentityResolver';

const icalendar = fs.readFileSync(
  path.resolve(
    __dirname,
    '../../../fixtures/ical/reminder-identity-resource.ics',
  ),
  'utf8',
);

const resource: CanonicalReminderResourceData = {
  calendarId: 'team-calendar',
  icalendar,
};

const masterIdentity: CanonicalReminderIdentity = {
  calendarId: 'team-calendar',
  eventUid: 'team-planning@example.test',
  recurrenceId: null,
  alarmUid: 'master-alarm@example.test',
};

const overrideIdentity: CanonicalReminderIdentity = {
  ...masterIdentity,
  recurrenceId: JSON.stringify([
    'date-time',
    'tzid',
    'Europe/Stockholm',
    '2026-10-12T09:00:00',
  ]),
  alarmUid: 'override-alarm@example.test',
};

describe('resolveCanonicalReminderIdentity', () => {
  it('enumerates only canonical master and detached DISPLAY alarm identities', () => {
    const selections = enumerateCanonicalReminderResourceSelections(resource);

    expect(
      selections.map(({ identity }) => ({
        eventUid: identity.eventUid,
        recurrenceId: identity.recurrenceId,
        alarmUid: identity.alarmUid,
      })),
    ).toEqual([
      {
        eventUid: 'team-planning@example.test',
        recurrenceId: null,
        alarmUid: 'master-alarm@example.test',
      },
      {
        eventUid: 'team-planning@example.test',
        recurrenceId: JSON.stringify([
          'date-time',
          'tzid',
          'Europe/Stockholm',
          '2026-10-12T09:00:00',
        ]),
        alarmUid: 'override-alarm@example.test',
      },
      {
        eventUid: 'unrelated@example.test',
        recurrenceId: null,
        alarmUid: 'unrelated-alarm@example.test',
      },
    ]);
  });

  it('rejects a resource with more than 64 VALARMs before returning selections', () => {
    const alarm = [
      'BEGIN:VALARM',
      'UID:alarm@example.test',
      'ACTION:DISPLAY',
      'DESCRIPTION:Reminder',
      'TRIGGER:-PT5M',
      'END:VALARM',
    ].join('\r\n');
    const tooManyAlarms = resourceWith(
      [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'BEGIN:VEVENT',
        'UID:bounded@example.test',
        'DTSTAMP:20260926T120000Z',
        'DTSTART:20261001T090000Z',
        'DTEND:20261001T100000Z',
        ...Array.from({ length: 65 }, () => alarm),
        'END:VEVENT',
        'END:VCALENDAR',
        '',
      ].join('\r\n'),
    );

    expect(() =>
      enumerateCanonicalReminderResourceSelections(tooManyAlarms),
    ).toThrow(CanonicalReminderResolutionError);
  });

  it('rejects excessive nested components and properties before parsing', () => {
    const nestedComponents = resourceWith(
      [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'BEGIN:VEVENT',
        'UID:bounded@example.test',
        'DTSTAMP:20260926T120000Z',
        'DTSTART:20261001T090000Z',
        'DTEND:20261001T100000Z',
        ...Array.from({ length: 1023 }, () => 'BEGIN:VENDOR'),
        ...Array.from({ length: 1023 }, () => 'END:VENDOR'),
        'END:VEVENT',
        'END:VCALENDAR',
        '',
      ].join('\r\n'),
    );
    const tooManyProperties = resourceWith(
      [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'BEGIN:VEVENT',
        'UID:bounded@example.test',
        'DTSTAMP:20260926T120000Z',
        'DTSTART:20261001T090000Z',
        'DTEND:20261001T100000Z',
        ...Array.from({ length: 4096 }, (_, index) => `X-TEST-${index}:x`),
        'END:VEVENT',
        'END:VCALENDAR',
        '',
      ].join('\r\n'),
    );

    expect(() =>
      enumerateCanonicalReminderResourceSelections(nestedComponents),
    ).toThrow(CanonicalReminderResolutionError);
    expect(() =>
      enumerateCanonicalReminderResourceSelections(tooManyProperties),
    ).toThrow(CanonicalReminderResolutionError);
  });

  it('encodes projected firing identities from raw DTSTART and override source', () => {
    const selection = resolveCanonicalReminderResourceSelection(
      {
        calendarId: 'team-calendar',
        recurrenceId: null,
        alarmUid: masterIdentity.alarmUid,
      },
      resource,
    );

    expect(
      encodeCanonicalReminderFiringRecurrenceIdentity(selection, {
        type: 'date-time',
        value: {
          local: '2026-10-05T09:00:00',
          timezone: 'Europe/Stockholm',
        },
      }),
    ).toBe(
      JSON.stringify([
        'date-time',
        'tzid',
        'Europe/Stockholm',
        '2026-10-05T09:00:00',
      ]),
    );
    expect(
      encodeCanonicalReminderFiringRecurrenceIdentity(selection, {
        type: 'date-time',
        value: {
          local: '2026-10-12T09:00:00',
          timezone: 'Europe/Stockholm',
        },
      }),
    ).toBe(overrideIdentity.recurrenceId);
  });

  it.each([
    {
      name: 'UTC',
      start: 'DTSTART:20261005T090000Z',
      end: 'DTEND:20261005T100000Z',
      timezone: 'UTC',
      kind: 'utc',
      localValues: ['2026-10-12T09:00:00', '2026-10-19T09:00:00'],
    },
    {
      name: 'explicit TZID=UTC',
      start: 'DTSTART;TZID=UTC:20261005T090000',
      end: 'DTEND;TZID=UTC:20261005T100000',
      timezone: 'UTC',
      kind: 'tzid',
      localValues: ['2026-10-12T09:00:00', '2026-10-19T09:00:00'],
    },
    {
      name: 'Europe/Stockholm after its spring DST gap',
      start: 'DTSTART;TZID=Europe/Stockholm:20260315T023000',
      end: 'DTEND;TZID=Europe/Stockholm:20260315T033000',
      timezone: 'Europe/Stockholm',
      kind: 'tzid',
      count: 4,
      localValues: ['2026-03-22T02:30:00', '2026-04-05T02:30:00'],
    },
  ])('encodes later generated RRULE occurrences for $name', (testCase) => {
    const generatedResource = resourceWith(
      [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'BEGIN:VEVENT',
        'UID:generated-event@example.test',
        'DTSTAMP:20260926T120000Z',
        testCase.start,
        testCase.end,
        `RRULE:FREQ=WEEKLY;COUNT=${testCase.count ?? 3}`,
        'BEGIN:VALARM',
        'UID:generated-alarm@example.test',
        'ACTION:DISPLAY',
        'DESCRIPTION:Reminder',
        'TRIGGER:-PT5M',
        'END:VALARM',
        'END:VEVENT',
        'END:VCALENDAR',
        '',
      ].join('\r\n'),
    );
    const selection = resolveCanonicalReminderResourceSelection(
      {
        calendarId: resource.calendarId,
        recurrenceId: null,
        alarmUid: 'generated-alarm@example.test',
      },
      generatedResource,
    );

    for (const local of testCase.localValues) {
      expect(
        encodeCanonicalReminderFiringRecurrenceIdentity(selection, {
          type: 'date-time',
          value: { local, timezone: testCase.timezone },
        }),
      ).toBe(
        JSON.stringify([
          'date-time',
          testCase.kind,
          testCase.kind === 'tzid' ? testCase.timezone : '',
          local,
        ]),
      );
    }
  });

  it('preserves raw RDATE TZID when it differs from DTSTART UTC spelling', () => {
    const rdateResource = resourceWith(
      [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'BEGIN:VEVENT',
        'UID:rdate-event@example.test',
        'DTSTAMP:20260926T120000Z',
        'DTSTART:20261005T090000Z',
        'DTEND:20261005T100000Z',
        'RDATE;TZID=UTC:20261006T090000',
        'BEGIN:VALARM',
        'UID:rdate-alarm@example.test',
        'ACTION:DISPLAY',
        'DESCRIPTION:Reminder',
        'TRIGGER:-PT5M',
        'END:VALARM',
        'END:VEVENT',
        'END:VCALENDAR',
        '',
      ].join('\r\n'),
    );
    const selection = resolveCanonicalReminderResourceSelection(
      {
        calendarId: resource.calendarId,
        recurrenceId: null,
        alarmUid: 'rdate-alarm@example.test',
      },
      rdateResource,
    );

    expect(
      encodeCanonicalReminderFiringRecurrenceIdentity(selection, {
        type: 'date-time',
        value: { local: '2026-10-06T09:00:00', timezone: 'UTC' },
      }),
    ).toBe(JSON.stringify(['date-time', 'tzid', 'UTC', '2026-10-06T09:00:00']));
  });

  it('uses DTSTART as the typed firing identity for a non-recurring event', () => {
    const singleEventResource = resourceWith(
      [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'BEGIN:VEVENT',
        'UID:single-event@example.test',
        'DTSTAMP:20260926T120000Z',
        'DTSTART:20261005T090000Z',
        'DTEND:20261005T100000Z',
        'BEGIN:VALARM',
        'UID:single-alarm@example.test',
        'ACTION:DISPLAY',
        'DESCRIPTION:Reminder',
        'TRIGGER:-PT5M',
        'END:VALARM',
        'END:VEVENT',
        'END:VCALENDAR',
        '',
      ].join('\r\n'),
    );
    const selection = resolveCanonicalReminderResourceSelection(
      {
        calendarId: resource.calendarId,
        recurrenceId: null,
        alarmUid: 'single-alarm@example.test',
      },
      singleEventResource,
    );

    expect(encodeCanonicalReminderFiringRecurrenceIdentity(selection)).toBe(
      JSON.stringify(['date-time', 'utc', '', '2026-10-05T09:00:00']),
    );
  });

  it('returns raw source only for the uniquely selected master DISPLAY alarm', () => {
    const selection = resolveCanonicalReminderResourceSelection(
      {
        calendarId: 'team-calendar',
        recurrenceId: null,
        alarmUid: 'master-alarm@example.test',
      },
      resource,
    );

    expect(selection.identity).toEqual(masterIdentity);
    expect(selection.event.getFirstPropertyValue('uid')).toBe(
      'team-planning@example.test',
    );
    expect(selection.alarm.getFirstPropertyValue('uid')).toBe(
      'master-alarm@example.test',
    );
    expect(selection.alarmSource).toContain('TRIGGER:-PT15M');
  });

  it('returns the override alarm source matching the typed recurrence identity', () => {
    const selection = resolveCanonicalReminderResourceSelection(
      {
        calendarId: 'team-calendar',
        recurrenceId: overrideIdentity.recurrenceId,
        alarmUid: overrideIdentity.alarmUid,
      },
      resource,
    );

    expect(selection.identity).toEqual(overrideIdentity);
    expect(
      selection.event.getFirstPropertyValue('recurrence-id'),
    ).not.toBeNull();
    expect(selection.alarm.getFirstPropertyValue('uid')).toBe(
      'override-alarm@example.test',
    );
    expect(selection.alarmSource).toContain('TRIGGER:-PT20M');
  });

  it('rejects an alarm UID duplicated in another VEVENT, even with a known event UID', () => {
    const duplicateAlarmEvent = `\nBEGIN:VEVENT\nUID:other-event@example.test\nDTSTAMP:20260926T120000Z\nDTSTART:20261006T130000Z\nDTEND:20261006T140000Z\nBEGIN:VALARM\nUID:master-alarm@example.test\nACTION:DISPLAY\nDESCRIPTION:Another reminder\nTRIGGER:-PT5M\nEND:VALARM\nEND:VEVENT\n`;
    const candidate = resourceWith(
      icalendar.replace(
        'BEGIN:VEVENT\nUID:unrelated@example.test',
        `${duplicateAlarmEvent}BEGIN:VEVENT\nUID:unrelated@example.test`,
      ),
    );

    try {
      resolveCanonicalReminderResourceSelection(
        {
          calendarId: 'team-calendar',
          recurrenceId: null,
          alarmUid: 'master-alarm@example.test',
        },
        candidate,
      );
      fail('expected duplicate alarm identity to be rejected');
    } catch (error) {
      expect(error).toBeInstanceOf(CanonicalReminderResolutionError);
      expect((error as CanonicalReminderResolutionError).code).toBe(
        'ambiguous-alarm',
      );
    }

    expect(() =>
      resolveCanonicalReminderResourceSelection(
        {
          calendarId: resource.calendarId,
          eventUid: masterIdentity.eventUid,
          recurrenceId: null,
          alarmUid: masterIdentity.alarmUid,
        },
        candidate,
      ),
    ).toThrow(CanonicalReminderResolutionError);
  });

  it('rejects a selected alarm UID that collides with a VEVENT UID', () => {
    const candidate = resourceWith(
      icalendar.replace(
        'UID:unrelated@example.test',
        'UID:master-alarm@example.test',
      ),
    );
    expectResolutionError(masterIdentity, candidate, 'invalid-alarm-identity');
  });

  it('checks nested calendar components for resource-wide UID collisions', () => {
    const candidate = resourceWith(
      icalendar.replace(
        'END:VTIMEZONE',
        [
          'BEGIN:VTODO',
          'UID:master-alarm@example.test',
          'DTSTAMP:20260926T120000Z',
          'END:VTODO',
          'END:VTIMEZONE',
        ].join('\n'),
      ),
    );

    expectResolutionError(masterIdentity, candidate, 'invalid-alarm-identity');
  });

  it.each(['RECURRENCE-ID ', 'RECURRENCE-ID\t'])(
    'rejects malformed %s instead of resolving it as a master',
    (name) => {
      const malformed = icalendar.replace(
        'UID:team-planning@example.test',
        `UID:team-planning@example.test\n${name}:20261012T090000Z`,
      );
      expectResolutionError(
        masterIdentity,
        resourceWith(malformed),
        'invalid-event-identity',
      );
    },
  );

  it('resolves a stable DISPLAY alarm on the master event', () => {
    expect(resolveCanonicalReminderIdentity(masterIdentity, resource)).toEqual({
      resolved: true,
      identity: masterIdentity,
    });
  });

  it('resolves a typed recurrence identity and alarm on its detached event', () => {
    expect(
      resolveCanonicalReminderIdentity(overrideIdentity, resource),
    ).toEqual({
      resolved: true,
      identity: overrideIdentity,
    });
  });

  it('preserves valid DATE, floating, UTC, and unknown TZID identities', () => {
    const recurrenceLine =
      'RECURRENCE-ID;TZID=Europe/Stockholm:20261012T090000';
    const cases = [
      {
        line: 'RECURRENCE-ID;VALUE=DATE:20261012',
        recurrenceId: JSON.stringify(['date', '2026-10-12']),
      },
      {
        line: 'RECURRENCE-ID:20261012T090000',
        recurrenceId: JSON.stringify([
          'date-time',
          'floating',
          '',
          '2026-10-12T09:00:00',
        ]),
      },
      {
        line: 'RECURRENCE-ID:20261012T090000Z',
        recurrenceId: JSON.stringify([
          'date-time',
          'utc',
          '',
          '2026-10-12T09:00:00',
        ]),
      },
      {
        line: 'RECURRENCE-ID;TZID=UTC:20261012T090000',
        recurrenceId: JSON.stringify([
          'date-time',
          'tzid',
          'UTC',
          '2026-10-12T09:00:00',
        ]),
      },
      {
        line: 'RECURRENCE-ID;TZID=Unknown/CalendarZone:20261012T090000',
        recurrenceId: JSON.stringify([
          'date-time',
          'tzid',
          'Unknown/CalendarZone',
          '2026-10-12T09:00:00',
        ]),
      },
    ];

    for (const { line, recurrenceId } of cases) {
      const candidate = resourceWith(icalendar.replace(recurrenceLine, line));
      const identity = { ...overrideIdentity, recurrenceId };
      expect(resolveCanonicalReminderIdentity(identity, candidate)).toEqual({
        resolved: true,
        identity,
      });
    }
  });

  it('does not confuse recurrence value types or another VEVENT alarm', () => {
    expectResolutionError(
      { ...overrideIdentity, recurrenceId: '2026-10-12T09:00:00' },
      resource,
      'recurrence-not-found',
    );
    expectResolutionError(
      { ...masterIdentity, alarmUid: 'override-alarm@example.test' },
      resource,
      'alarm-not-found',
    );
    expectResolutionError(
      { ...masterIdentity, alarmUid: 'Private master alarm text' },
      resource,
      'alarm-not-found',
    );
  });

  it('requires the resource collection, event UID, and alarm UID to match', () => {
    expectResolutionError(
      masterIdentity,
      { ...resource, calendarId: 'other-calendar' },
      'invalid-calendar',
    );
    expectResolutionError(
      { ...masterIdentity, eventUid: 'missing@example.test' },
      resource,
      'event-not-found',
    );
    expectResolutionError(
      { ...masterIdentity, alarmUid: 'missing-alarm@example.test' },
      resource,
      'alarm-not-found',
    );
  });

  it('rejects duplicate master and detached recurrence components', () => {
    const duplicateMaster = icalendar.replace(
      'BEGIN:VEVENT\nUID:unrelated@example.test',
      'BEGIN:VEVENT\nUID:team-planning@example.test\nDTSTAMP:20260926T120000Z\nDTSTART:20261006T130000Z\nDTEND:20261006T140000Z\nEND:VEVENT\nBEGIN:VEVENT\nUID:unrelated@example.test',
    );
    expectResolutionError(
      masterIdentity,
      resourceWith(duplicateMaster),
      'ambiguous-event',
    );

    const duplicateOverride = icalendar.replace(
      'BEGIN:VEVENT\nUID:unrelated@example.test',
      'BEGIN:VEVENT\nUID:team-planning@example.test\nDTSTAMP:20260926T120000Z\nRECURRENCE-ID;TZID=Europe/Stockholm:20261012T090000\nDTSTART;TZID=Europe/Stockholm:20261012T130000\nDTEND;TZID=Europe/Stockholm:20261012T140000\nEND:VEVENT\nBEGIN:VEVENT\nUID:unrelated@example.test',
    );
    expectResolutionError(
      overrideIdentity,
      resourceWith(duplicateOverride),
      'ambiguous-recurrence',
    );
  });

  it('rejects malformed or unsupported event identities', () => {
    const duplicateUid = icalendar.replace(
      'UID:unrelated@example.test',
      'UID:unrelated@example.test\nUID:second-uid@example.test',
    );
    expectResolutionError(
      masterIdentity,
      resourceWith(duplicateUid),
      'invalid-event-identity',
    );

    const duplicateRecurrenceId = icalendar.replace(
      'RECURRENCE-ID;TZID=Europe/Stockholm:20261012T090000',
      'RECURRENCE-ID;TZID=Europe/Stockholm:20261012T090000\nRECURRENCE-ID;TZID=Europe/Stockholm:20261012T090000',
    );
    expectResolutionError(
      overrideIdentity,
      resourceWith(duplicateRecurrenceId),
      'invalid-event-identity',
    );

    const rangeRecurrenceId = icalendar.replace(
      'RECURRENCE-ID;TZID=Europe/Stockholm:20261012T090000',
      'RECURRENCE-ID;RANGE=THISANDFUTURE;TZID=Europe/Stockholm:20261012T090000',
    );
    expectResolutionError(
      overrideIdentity,
      resourceWith(rangeRecurrenceId),
      'invalid-event-identity',
    );

    const periodRecurrenceId = icalendar.replace(
      'RECURRENCE-ID;TZID=Europe/Stockholm:20261012T090000',
      'RECURRENCE-ID;VALUE=PERIOD:20261012T090000Z/PT1H',
    );
    expectResolutionError(
      overrideIdentity,
      resourceWith(periodRecurrenceId),
      'invalid-event-identity',
    );

    const overflowDateTime = icalendar.replace(
      'RECURRENCE-ID;TZID=Europe/Stockholm:20261012T090000',
      'RECURRENCE-ID:20261340T999999Z',
    );
    expectResolutionError(
      {
        ...overrideIdentity,
        recurrenceId: JSON.stringify([
          'date-time',
          'utc',
          '',
          '2027-02-13T04:40:39',
        ]),
      },
      resourceWith(overflowDateTime),
      'invalid-event-identity',
    );

    const duplicateTzid = icalendar.replace(
      'RECURRENCE-ID;TZID=Europe/Stockholm:20261012T090000',
      'RECURRENCE-ID;TZID=Europe/Stockholm;TZID=America/New_York:20261012T090000',
    );
    expectResolutionError(
      {
        ...overrideIdentity,
        recurrenceId: JSON.stringify([
          'date-time',
          'tzid',
          'America/New_York',
          '2026-10-12T09:00:00',
        ]),
      },
      resourceWith(duplicateTzid),
      'invalid-event-identity',
    );

    const duplicateValue = icalendar.replace(
      'RECURRENCE-ID;TZID=Europe/Stockholm:20261012T090000',
      'RECURRENCE-ID;VALUE=DATE-TIME;VALUE=DATE:20261012',
    );
    expectResolutionError(
      {
        ...overrideIdentity,
        recurrenceId: JSON.stringify(['date', '2026-10-12']),
      },
      resourceWith(duplicateValue),
      'invalid-event-identity',
    );
  });

  it('rejects duplicate and malformed VALARM UIDs', () => {
    const duplicateUidProperty = icalendar.replace(
      'UID:master-alarm@example.test',
      'UID:master-alarm@example.test\nUID:master-alarm@example.test',
    );
    expectResolutionError(
      masterIdentity,
      resourceWith(duplicateUidProperty),
      'invalid-alarm-identity',
    );

    const duplicateUidCollision = icalendar.replace(
      'END:VALARM\nEND:VEVENT',
      'END:VALARM\nBEGIN:VALARM\nUID:master-alarm@example.test\nACTION:EMAIL\nTRIGGER:-PT5M\nEND:VALARM\nEND:VEVENT',
    );
    expectResolutionError(
      masterIdentity,
      resourceWith(duplicateUidCollision),
      'ambiguous-alarm',
    );

    const malformedUid = icalendar.replace(
      'UID:master-alarm@example.test',
      'UID:master\\nmalformed',
    );
    expectResolutionError(
      masterIdentity,
      resourceWith(malformedUid),
      'invalid-alarm-identity',
    );
  });

  it('fails closed when the alarm has no stable UID or is not DISPLAY', () => {
    const uidless = icalendar.replace('UID:master-alarm@example.test\n', '');
    expectResolutionError(
      masterIdentity,
      resourceWith(uidless),
      'alarm-not-found',
    );

    const emailAlarm = icalendar.replace(
      'ACTION:DISPLAY\nTRIGGER:-PT15M',
      'ACTION:EMAIL\nTRIGGER:-PT15M',
    );
    expectResolutionError(
      masterIdentity,
      resourceWith(emailAlarm),
      'alarm-not-found',
    );
  });

  it('returns only identity data and keeps calendar content out of errors', () => {
    try {
      resolveCanonicalReminderIdentity(
        { ...masterIdentity, alarmUid: 'missing-alarm' },
        resource,
      );
      throw new Error('Expected identity resolution to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(CanonicalReminderResolutionError);
      expect((error as Error).message).not.toContain('Private');
      expect(JSON.stringify(error)).not.toContain('Private');
    }
  });
});

function expectResolutionError(
  identity: CanonicalReminderIdentity,
  resource: CanonicalReminderResourceData,
  code: CanonicalReminderResolutionError['code'],
): void {
  try {
    resolveCanonicalReminderIdentity(identity, resource);
    throw new Error('Expected identity resolution to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(CanonicalReminderResolutionError);
    expect((error as CanonicalReminderResolutionError).code).toBe(code);
    expect((error as Error).message).not.toContain('Private');
  }
}

function resourceWith(icalendar: string): CanonicalReminderResourceData {
  return { ...resource, icalendar };
}
