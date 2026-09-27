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
  CanonicalReminderLookupIdentity,
  CanonicalReminderResourceData,
  CanonicalReminderResolutionError,
  resolveCanonicalReminderIdentity,
  resolveCanonicalReminderIdentityFromResource,
} from './CanonicalReminderIdentityResolver';

const resource = fs.readFileSync(
  path.resolve(
    __dirname,
    '../../../fixtures/ical/reminder-identity-resource.ics',
  ),
  'utf8',
);

const canonicalResource: CanonicalReminderResourceData = {
  calendarId: 'team-calendar',
  icalendar: resource,
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
  it('resolves the unique DISPLAY alarm on the master VEVENT', () => {
    expect(resolveCanonicalReminderIdentity(masterIdentity, resource)).toEqual({
      resolved: true,
      identity: masterIdentity,
    });
  });

  it('resolves the exact recurrence key and alarm on a detached VEVENT', () => {
    expect(
      resolveCanonicalReminderIdentity(overrideIdentity, resource),
    ).toEqual({
      resolved: true,
      identity: overrideIdentity,
    });
  });

  it('does not use alarm identity from another VEVENT or from event text', () => {
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

  it('requires exact event UID and canonical recurrence identity', () => {
    expectResolutionError(
      { ...masterIdentity, eventUid: 'missing@example.test' },
      resource,
      'event-not-found',
    );
    expectResolutionError(
      {
        ...overrideIdentity,
        recurrenceId: JSON.stringify(['date', '2026-10-12']),
      },
      resource,
      'recurrence-not-found',
    );
  });

  it('fails closed for duplicate target alarm UIDs', () => {
    const duplicateAlarm = resource.replace(
      'END:VALARM\nEND:VEVENT',
      'END:VALARM\nBEGIN:VALARM\nUID:master-alarm@example.test\nACTION:DISPLAY\nTRIGGER:-PT5M\nDESCRIPTION:second private alarm\nEND:VALARM\nEND:VEVENT',
    );
    expectResolutionError(masterIdentity, duplicateAlarm, 'ambiguous-alarm');

    const displayEmailCollision = resource.replace(
      'END:VALARM\nEND:VEVENT\nBEGIN:VEVENT\nUID:team-planning@example.test',
      'END:VALARM\nBEGIN:VALARM\nUID:master-alarm@example.test\nACTION:EMAIL\nTRIGGER:-PT5M\nATTENDEE:mailto:recipient@example.test\nEND:VALARM\nEND:VEVENT\nBEGIN:VEVENT\nUID:team-planning@example.test',
    );
    expectResolutionError(
      masterIdentity,
      displayEmailCollision,
      'ambiguous-alarm',
    );
  });

  it.each([
    {
      label: 'DATE',
      recurrenceKey: JSON.stringify(['date', '2026-10-12']),
      masterStart: 'DTSTART;VALUE=DATE:20261005',
      masterEnd: 'DTEND;VALUE=DATE:20261006',
      recurrenceLine: 'RECURRENCE-ID;VALUE=DATE:20261012',
      overrideStart: 'DTSTART;VALUE=DATE:20261012',
      overrideEnd: 'DTEND;VALUE=DATE:20261013',
    },
    {
      label: 'floating DATE-TIME',
      recurrenceKey: JSON.stringify([
        'date-time',
        'floating',
        '',
        '2026-10-12T09:00:00',
      ]),
      masterStart: 'DTSTART:20261005T090000',
      masterEnd: 'DTEND:20261005T100000',
      recurrenceLine: 'RECURRENCE-ID:20261012T090000',
      overrideStart: 'DTSTART:20261012T110000',
      overrideEnd: 'DTEND:20261012T120000',
    },
    {
      label: 'UTC DATE-TIME',
      recurrenceKey: JSON.stringify([
        'date-time',
        'utc',
        '',
        '2026-10-12T09:00:00',
      ]),
      masterStart: 'DTSTART:20261005T090000Z',
      masterEnd: 'DTEND:20261005T100000Z',
      recurrenceLine: 'RECURRENCE-ID:20261012T090000Z',
      overrideStart: 'DTSTART:20261012T110000Z',
      overrideEnd: 'DTEND:20261012T120000Z',
    },
  ])('resolves canonical $label recurrence keys', (recurrence) => {
    const identity = {
      ...overrideIdentity,
      recurrenceId: recurrence.recurrenceKey,
    };
    expect(
      resolveCanonicalReminderIdentity(
        identity,
        recurrenceResource(recurrence),
      ),
    ).toEqual({ resolved: true, identity });
  });

  it('fails closed for duplicate master components with the same event UID', () => {
    const duplicateMaster = resource.replace(
      'BEGIN:VEVENT\nUID:unrelated@example.test',
      'BEGIN:VEVENT\nUID:team-planning@example.test\nDTSTAMP:20260926T120000Z\nDTSTART:20261006T130000Z\nDTEND:20261006T140000Z\nSUMMARY:duplicate master\nEND:VEVENT\nBEGIN:VEVENT\nUID:unrelated@example.test',
    );
    expectResolutionError(masterIdentity, duplicateMaster, 'ambiguous-event');

    const duplicateOverride = resource.replace(
      'BEGIN:VEVENT\nUID:unrelated@example.test',
      'BEGIN:VEVENT\nUID:team-planning@example.test\nDTSTAMP:20260926T120000Z\nRECURRENCE-ID;TZID=Europe/Stockholm:20261012T090000\nDTSTART;TZID=Europe/Stockholm:20261012T130000\nDTEND;TZID=Europe/Stockholm:20261012T140000\nSUMMARY:duplicate override\nEND:VEVENT\nBEGIN:VEVENT\nUID:unrelated@example.test',
    );
    expectResolutionError(
      overrideIdentity,
      duplicateOverride,
      'ambiguous-recurrence',
    );
  });

  it('fails closed for malformed event and recurrence identities', () => {
    const duplicateEventUid = resource.replace(
      'UID:unrelated@example.test',
      'UID:unrelated@example.test\nUID:second-uid@example.test',
    );
    expectResolutionError(
      masterIdentity,
      duplicateEventUid,
      'invalid-event-identity',
    );

    const duplicateRecurrenceId = resource.replace(
      'RECURRENCE-ID;TZID=Europe/Stockholm:20261012T090000',
      'RECURRENCE-ID;TZID=Europe/Stockholm:20261012T090000\nRECURRENCE-ID;TZID=Europe/Stockholm:20261012T090000',
    );
    expectResolutionError(
      overrideIdentity,
      duplicateRecurrenceId,
      'invalid-event-identity',
    );
  });

  it('fails closed when a DISPLAY alarm has duplicate UID properties', () => {
    const duplicateAlarmUid = resource.replace(
      'UID:master-alarm@example.test',
      'UID:master-alarm@example.test\nUID:master-alarm@example.test',
    );
    expectResolutionError(
      masterIdentity,
      duplicateAlarmUid,
      'invalid-alarm-identity',
    );
  });

  it('does not select UID-less legacy alarms or non-DISPLAY alarms', () => {
    const noStableAlarm = resource
      .replace('UID:master-alarm@example.test\n', '')
      .replace('UID:override-alarm@example.test\n', '');
    expectResolutionError(masterIdentity, noStableAlarm, 'alarm-not-found');
    expectResolutionError(
      { ...masterIdentity, alarmUid: 'unrelated-alarm@example.test' },
      resource,
      'alarm-not-found',
    );
  });

  it('returns only identity data and keeps event content out of failures', () => {
    try {
      resolveCanonicalReminderIdentity(
        { ...masterIdentity, alarmUid: 'missing-alarm' },
        resource,
      );
      throw new Error('Expected identity resolution to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(CanonicalReminderResolutionError);
      expect(JSON.stringify(error)).not.toContain('Private');
      expect((error as Error).message).not.toContain('Private');
    }
  });
});

describe('resolveCanonicalReminderIdentityFromResource', () => {
  it('resolves the exact alarm on a detached recurrence component', () => {
    const deliveryIdentity: CanonicalReminderLookupIdentity = {
      ...overrideIdentity,
      triggerOrdinal: 0,
    };

    expect(
      resolveCanonicalReminderIdentityFromResource(
        deliveryIdentity,
        canonicalResource,
      ),
    ).toEqual({
      resolved: true,
      identity: overrideIdentity,
      triggerOrdinal: 0,
    });
  });

  it('returns unresolved when the resource identity does not match exactly', () => {
    expect(
      resolveCanonicalReminderIdentityFromResource(
        { ...overrideIdentity, recurrenceId: masterIdentity.recurrenceId },
        canonicalResource,
      ),
    ).toBeUndefined();
    expect(
      resolveCanonicalReminderIdentityFromResource(
        { ...overrideIdentity, eventUid: 'missing@example.test' },
        canonicalResource,
      ),
    ).toBeUndefined();
    expect(
      resolveCanonicalReminderIdentityFromResource(
        { ...overrideIdentity, alarmUid: 'missing-alarm@example.test' },
        canonicalResource,
      ),
    ).toBeUndefined();
    expect(
      resolveCanonicalReminderIdentityFromResource(
        overrideIdentity,
        { ...canonicalResource, calendarId: 'other-calendar' },
      ),
    ).toBeUndefined();
  });

  it('returns unresolved when event or alarm matches are ambiguous', () => {
    const duplicateOverride = resource.replace(
      'BEGIN:VEVENT\nUID:unrelated@example.test',
      'BEGIN:VEVENT\nUID:team-planning@example.test\nDTSTAMP:20260926T120000Z\nRECURRENCE-ID;TZID=Europe/Stockholm:20261012T090000\nDTSTART;TZID=Europe/Stockholm:20261012T130000\nDTEND;TZID=Europe/Stockholm:20261012T140000\nBEGIN:VALARM\nUID:override-alarm@example.test\nACTION:DISPLAY\nTRIGGER:-PT5M\nEND:VALARM\nEND:VEVENT\nBEGIN:VEVENT\nUID:unrelated@example.test',
    );
    expect(
      resolveCanonicalReminderIdentityFromResource(
        overrideIdentity,
        { ...canonicalResource, icalendar: duplicateOverride },
      ),
    ).toBeUndefined();

    const duplicateAlarm = resource.replace(
      'END:VALARM\nEND:VEVENT',
      'END:VALARM\nBEGIN:VALARM\nUID:master-alarm@example.test\nACTION:DISPLAY\nTRIGGER:-PT5M\nEND:VALARM\nEND:VEVENT',
    );
    expect(
      resolveCanonicalReminderIdentityFromResource(
        masterIdentity,
        { ...canonicalResource, icalendar: duplicateAlarm },
      ),
    ).toBeUndefined();
  });

  it('matches only trigger ordinals present in VALARM REPEAT and DURATION', () => {
    const repeatedAlarmResource = resource.replace(
      'TRIGGER:-PT15M',
      'TRIGGER:-PT15M\nREPEAT:1\nDURATION:PT5M',
    );
    const repeatedResource = {
      ...canonicalResource,
      icalendar: repeatedAlarmResource,
    };

    expect(
      resolveCanonicalReminderIdentityFromResource(
        { ...masterIdentity, triggerOrdinal: 1 },
        repeatedResource,
      ),
    ).toEqual({
      resolved: true,
      identity: masterIdentity,
      triggerOrdinal: 1,
    });
    expect(
      resolveCanonicalReminderIdentityFromResource(
        { ...masterIdentity, triggerOrdinal: 2 },
        repeatedResource,
      ),
    ).toBeUndefined();
    expect(
      resolveCanonicalReminderIdentityFromResource(
        { ...masterIdentity, triggerOrdinal: 1 },
        canonicalResource,
      ),
    ).toBeUndefined();
  });
});

function expectResolutionError(
  identity: CanonicalReminderIdentity,
  calendarData: string,
  code: CanonicalReminderResolutionError['code'],
): void {
  try {
    resolveCanonicalReminderIdentity(identity, calendarData);
    throw new Error('Expected identity resolution to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(CanonicalReminderResolutionError);
    expect((error as CanonicalReminderResolutionError).code).toBe(code);
  }
}

function recurrenceResource(recurrence: {
  masterStart: string;
  masterEnd: string;
  recurrenceLine: string;
  overrideStart: string;
  overrideEnd: string;
}): string {
  return `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Matrix Calendar Widget//Recurrence Key Test//EN
BEGIN:VEVENT
UID:team-planning@example.test
DTSTAMP:20260926T120000Z
${recurrence.masterStart}
${recurrence.masterEnd}
RRULE:FREQ=WEEKLY;COUNT=3
END:VEVENT
BEGIN:VEVENT
UID:team-planning@example.test
DTSTAMP:20260926T120000Z
${recurrence.recurrenceLine}
${recurrence.overrideStart}
${recurrence.overrideEnd}
BEGIN:VALARM
UID:override-alarm@example.test
ACTION:DISPLAY
TRIGGER:-PT15M
DESCRIPTION:Occurrence reminder
END:VALARM
END:VEVENT
END:VCALENDAR`;
}
