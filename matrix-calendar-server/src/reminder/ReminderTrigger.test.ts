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

import ICAL from 'ical.js';
import { calculateDisplayReminderDueAt } from './ReminderTrigger';

const stockholmTimezone = `
  BEGIN:VTIMEZONE
  TZID:Europe/Stockholm
  BEGIN:DAYLIGHT
  TZOFFSETFROM:+0100
  TZOFFSETTO:+0200
  TZNAME:CEST
  DTSTART:19700329T020000
  RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU
  END:DAYLIGHT
  BEGIN:STANDARD
  TZOFFSETFROM:+0200
  TZOFFSETTO:+0100
  TZNAME:CET
  DTSTART:19701025T030000
  RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU
  END:STANDARD
  END:VTIMEZONE
`;

function parseComponent(source: string): ICAL.Component {
  return ICAL.Component.fromString(
    source
      .trim()
      .split('\n')
      .map((line) => line.trim())
      .join('\n'),
  );
}

function parsedEvent(
  event: string,
  alarm: string,
  timezone = '',
  includeDescription = true,
) {
  const alarmContent = [
    ...(includeDescription ? ['DESCRIPTION:Reminder'] : []),
    alarm,
  ].join('\n');
  const calendar = parseComponent(`
    BEGIN:VCALENDAR
    VERSION:2.0
    PRODID:-//Matrix Calendar Widget//Reminder Trigger Test//EN
    ${timezone}
    ${event}
    BEGIN:VALARM
    ${alarmContent}
    END:VALARM
    END:VEVENT
    END:VCALENDAR
  `);
  const vevent = calendar.getFirstSubcomponent('vevent');
  if (!vevent) {
    throw new Error('test event did not parse');
  }
  const parsedAlarm = vevent.getFirstSubcomponent('valarm');
  const start = vevent.getFirstPropertyValue('dtstart');
  if (!parsedAlarm || !(start instanceof ICAL.Time)) {
    throw new Error('test alarm or start did not parse');
  }
  const end = vevent.getFirstPropertyValue('dtend');
  return {
    alarm: `BEGIN:VALARM\n${alarmContent}\nEND:VALARM`,
    occurrence: {
      start,
      ...(end instanceof ICAL.Time ? { end } : {}),
    },
  };
}

describe('calculateDisplayReminderDueAt', () => {
  it('applies a negative duration relative to START by default', () => {
    const { alarm, occurrence } = parsedEvent(
      'BEGIN:VEVENT\nUID:meeting\nDTSTART:20261001T090000Z\nDTEND:20261001T100000Z',
      'ACTION:DISPLAY\nTRIGGER:-PT15M',
    );

    expect(calculateDisplayReminderDueAt(alarm, occurrence)).toEqual(
      new Date('2026-10-01T08:45:00.000Z'),
    );
  });

  it('applies RELATED=END and positive durations to the occurrence end', () => {
    const { alarm, occurrence } = parsedEvent(
      'BEGIN:VEVENT\nUID:meeting\nDTSTART:20261001T090000Z\nDTEND:20261001T100000Z',
      'ACTION:DISPLAY\nTRIGGER;RELATED=END:PT10M',
    );

    expect(calculateDisplayReminderDueAt(alarm, occurrence)).toEqual(
      new Date('2026-10-01T10:10:00.000Z'),
    );
  });

  it('applies nominal day durations in the occurrence timezone across DST', () => {
    const { alarm, occurrence } = parsedEvent(
      'BEGIN:VEVENT\nUID:dst-meeting\nDTSTART;TZID=Europe/Stockholm:20260328T120000',
      'ACTION:DISPLAY\nTRIGGER:P1D',
      stockholmTimezone,
    );

    expect(calculateDisplayReminderDueAt(alarm, occurrence)).toEqual(
      new Date('2026-03-29T10:00:00.000Z'),
    );
  });

  it('treats hours as exact elapsed time when DST changes', () => {
    const { alarm, occurrence } = parsedEvent(
      'BEGIN:VEVENT\nUID:dst-hour\nDTSTART;TZID=Europe/Stockholm:20260329T013000',
      'ACTION:DISPLAY\nTRIGGER:PT1H',
      stockholmTimezone,
    );

    expect(calculateDisplayReminderDueAt(alarm, occurrence)).toEqual(
      new Date('2026-03-29T01:30:00.000Z'),
    );
  });

  it('applies each supported repeat ordinal and rejects ordinals outside REPEAT', () => {
    const { alarm, occurrence } = parsedEvent(
      'BEGIN:VEVENT\nUID:meeting\nDTSTART:20261001T090000Z',
      'ACTION:DISPLAY\nTRIGGER:-PT15M\nREPEAT:2\nDURATION:PT5M',
    );

    expect(calculateDisplayReminderDueAt(alarm, occurrence, 0)).toEqual(
      new Date('2026-10-01T08:45:00.000Z'),
    );
    expect(calculateDisplayReminderDueAt(alarm, occurrence, 2)).toEqual(
      new Date('2026-10-01T08:55:00.000Z'),
    );
    expect(calculateDisplayReminderDueAt(alarm, occurrence, 3)).toBeUndefined();
  });

  it('treats a repeat interval longer than one day as exact elapsed hours', () => {
    const { alarm, occurrence } = parsedEvent(
      'BEGIN:VEVENT\nUID:dst-repeat\nDTSTART;TZID=Europe/Stockholm:20260329T003000',
      'ACTION:DISPLAY\nTRIGGER:PT0S\nREPEAT:1\nDURATION:PT25H',
      stockholmTimezone,
    );

    expect(calculateDisplayReminderDueAt(alarm, occurrence, 1)).toEqual(
      new Date('2026-03-30T00:30:00.000Z'),
    );
  });

  it.each([
    ['absolute UTC trigger', 'TRIGGER;VALUE=DATE-TIME:20261001T084500Z'],
    ['fractional trigger duration', 'TRIGGER:-P1.5D'],
    ['invalid RELATED value', 'TRIGGER;RELATED=NEXT:-PT5M'],
    ['missing trigger', ''],
    ['duplicate triggers', 'TRIGGER:-PT5M\nTRIGGER:-PT10M'],
    ['unsupported action', 'ACTION:EMAIL\nTRIGGER:-PT5M'],
    ['repeat without duration', 'TRIGGER:-PT5M\nREPEAT:2'],
    ['duration without repeat', 'TRIGGER:-PT5M\nDURATION:PT5M'],
    [
      'REPEAT with an invalid TEXT value type',
      'TRIGGER:-PT5M\nREPEAT;VALUE=TEXT:1\nDURATION:PT5M',
    ],
    [
      'DURATION with an invalid TEXT value type',
      'TRIGGER:-PT5M\nREPEAT:1\nDURATION;VALUE=TEXT:PT5M',
    ],
    ['mixed week and time duration', 'TRIGGER:P1WT1H'],
    ['nominal repeat duration', 'TRIGGER:-PT5M\nREPEAT:2\nDURATION:P1D'],
    ['fractional repeat count', 'TRIGGER:-PT5M\nREPEAT:1.5\nDURATION:PT5M'],
    [
      'repeat count above RFC INTEGER range',
      'TRIGGER:-PT5M\nREPEAT:2147483648\nDURATION:PT5M',
    ],
  ])('fails closed for %s', (_name, alarmText) => {
    const { alarm, occurrence } = parsedEvent(
      'BEGIN:VEVENT\nUID:meeting\nDTSTART:20261001T090000Z',
      alarmText,
    );

    expect(calculateDisplayReminderDueAt(alarm, occurrence)).toBeUndefined();
  });

  it('fails closed when DISPLAY DESCRIPTION is missing', () => {
    const { alarm, occurrence } = parsedEvent(
      'BEGIN:VEVENT\nUID:meeting\nDTSTART:20261001T090000Z',
      'ACTION:DISPLAY\nTRIGGER:-PT5M',
      '',
      false,
    );

    expect(calculateDisplayReminderDueAt(alarm, occurrence)).toBeUndefined();
  });

  it('rejects malformed source lexemes that ical.js normalizes with parseInt', () => {
    const malformedTrigger = parsedEvent(
      'BEGIN:VEVENT\nUID:meeting\nDTSTART:20261001T090000Z',
      'ACTION:DISPLAY\nTRIGGER:-P1.5D',
    );
    const parsedTrigger = ICAL.Component.fromString(
      malformedTrigger.alarm,
    ).getFirstPropertyValue('trigger');
    expect(parsedTrigger).toBeInstanceOf(ICAL.Duration);
    expect((parsedTrigger as ICAL.Duration).days).toBe(1);
    expect(
      calculateDisplayReminderDueAt(
        malformedTrigger.alarm,
        malformedTrigger.occurrence,
      ),
    ).toBeUndefined();

    const malformedRepeat = parsedEvent(
      'BEGIN:VEVENT\nUID:meeting\nDTSTART:20261001T090000Z',
      'ACTION:DISPLAY\nTRIGGER:-PT5M\nREPEAT:1.5\nDURATION:PT5M',
    );
    expect(
      ICAL.Component.fromString(malformedRepeat.alarm).getFirstPropertyValue(
        'repeat',
      ),
    ).toBe(1);
    expect(
      calculateDisplayReminderDueAt(
        malformedRepeat.alarm,
        malformedRepeat.occurrence,
      ),
    ).toBeUndefined();
  });

  it('fails closed for a missing END anchor and floating or date-only anchors', () => {
    const endAlarm = [
      'BEGIN:VALARM',
      'DESCRIPTION:Reminder',
      'ACTION:DISPLAY',
      'TRIGGER;RELATED=END:-PT5M',
      'END:VALARM',
    ].join('\n');
    const floating = parsedEvent(
      'BEGIN:VEVENT\nUID:floating\nDTSTART:20261001T090000',
      'ACTION:DISPLAY\nTRIGGER:-PT5M',
    );
    const dateOnly = parsedEvent(
      'BEGIN:VEVENT\nUID:all-day\nDTSTART;VALUE=DATE:20261001',
      'ACTION:DISPLAY\nTRIGGER:-PT5M',
    );

    expect(
      calculateDisplayReminderDueAt(endAlarm, {
        start: floating.occurrence.start,
      }),
    ).toBeUndefined();
    expect(
      calculateDisplayReminderDueAt(floating.alarm, floating.occurrence),
    ).toBeUndefined();
    expect(
      calculateDisplayReminderDueAt(dateOnly.alarm, dateOnly.occurrence),
    ).toBeUndefined();
  });
});
