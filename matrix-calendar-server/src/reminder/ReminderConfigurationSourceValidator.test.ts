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
  CanonicalReminderResourceData,
  resolveCanonicalReminderResourceSelection,
} from './CanonicalReminderIdentityResolver';
import {
  ReminderConfigurationSourceError,
  resolveProjectedReminderOccurrenceTiming,
  resolveTriggerableReminderIdentity,
} from './ReminderConfigurationSourceValidator';
import { calculateDisplayReminderDueAt } from './ReminderTrigger';

const icalendar = fs.readFileSync(
  path.resolve(
    __dirname,
    '../../../fixtures/ical/reminder-identity-resource.ics',
  ),
  'utf8',
);

const resource: CanonicalReminderResourceData = {
  calendarId: 'team-calendar',
  // The complete bundled IANA component is injected by the validator. This
  // tests its fallback without accepting a hand-authored, partial VTIMEZONE.
  icalendar: icalendar.replace(/BEGIN:VTIMEZONE[\s\S]*?END:VTIMEZONE\r?\n/, ''),
};

const master = {
  calendarId: 'team-calendar',
  recurrenceId: null,
  alarmUid: 'master-alarm@example.test',
};

const override = {
  calendarId: 'team-calendar',
  recurrenceId: JSON.stringify([
    'date-time',
    'tzid',
    'Europe/Stockholm',
    '2026-10-12T09:00:00',
  ]),
  alarmUid: 'override-alarm@example.test',
};

describe('resolveTriggerableReminderIdentity', () => {
  it('accepts a UID-selected UTC or bundled-TZID DISPLAY alarm', () => {
    expect(resolveTriggerableReminderIdentity(master, resource)).toEqual({
      ...master,
      eventUid: 'team-planning@example.test',
    });
    expect(resolveTriggerableReminderIdentity(override, resource)).toEqual({
      ...override,
      eventUid: 'team-planning@example.test',
    });
  });

  it('rejects a duplicate resource alarm UID even when the event UID is known', () => {
    const duplicateEvent = [
      'BEGIN:VEVENT',
      'UID:other-planning@example.test',
      'DTSTAMP:20260926T120000Z',
      'DTSTART;TZID=Europe/Stockholm:20261005T090000',
      'DTEND;TZID=Europe/Stockholm:20261005T100000',
      'BEGIN:VALARM',
      'UID:master-alarm@example.test',
      'ACTION:DISPLAY',
      'DESCRIPTION:Another reminder',
      'TRIGGER:-PT30M',
      'END:VALARM',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:unrelated@example.test',
    ].join('\n');
    const ambiguous = {
      ...resource,
      icalendar: resource.icalendar.replace(
        'BEGIN:VEVENT\nUID:unrelated@example.test',
        duplicateEvent,
      ),
    };

    expect(() => resolveTriggerableReminderIdentity(master, ambiguous)).toThrow(
      ReminderConfigurationSourceError,
    );
    expect(() =>
      resolveTriggerableReminderIdentity(
        { ...master, eventUid: 'team-planning@example.test' },
        ambiguous,
      ),
    ).toThrow(ReminderConfigurationSourceError);
  });

  it.each([
    [
      'duplicate RELATED parameters',
      'TRIGGER;RELATED=START;RELATED=END:-PT15M',
    ],
    [
      'duplicate VALUE parameters',
      'TRIGGER;VALUE=DURATION;VALUE=DURATION:-PT15M',
    ],
    [
      'invalid and duplicate RELATED parameters',
      'TRIGGER;RELATED=BOGUS;RELATED=START:-PT15M',
    ],
  ])('rejects %s before saving the identity', (_case, rawTrigger) => {
    const candidate = {
      ...resource,
      icalendar: resource.icalendar.replace('TRIGGER:-PT15M', rawTrigger),
    };
    expect(() => resolveTriggerableReminderIdentity(master, candidate)).toThrow(
      ReminderConfigurationSourceError,
    );
  });

  it('uses the canonical RFC wall-time rule for explicit TZID gaps and folds', () => {
    const selection = resolveCanonicalReminderResourceSelection(
      master,
      resource,
    );
    const gapTiming = resolveProjectedReminderOccurrenceTiming(selection, {
      type: 'timed',
      start: {
        type: 'zoned',
        local: '2026-03-29T02:30:00',
        timezone: 'Europe/Stockholm',
      },
      end: {
        type: 'zoned',
        local: '2026-03-29T04:30:00',
        timezone: 'Europe/Stockholm',
      },
    });
    const foldTiming = resolveProjectedReminderOccurrenceTiming(selection, {
      type: 'timed',
      start: {
        type: 'zoned',
        local: '2026-10-25T02:30:00',
        timezone: 'Europe/Stockholm',
      },
      end: {
        type: 'zoned',
        local: '2026-10-25T03:30:00',
        timezone: 'Europe/Stockholm',
      },
    });

    expect(gapTiming.start.hour).toBe(2);
    expect(foldTiming.start.hour).toBe(2);
    expect(
      calculateDisplayReminderDueAt(
        selection.alarmSource,
        gapTiming,
      )?.toISOString(),
    ).toBe('2026-03-29T01:15:00.000Z');
    expect(
      calculateDisplayReminderDueAt(
        selection.alarmSource,
        foldTiming,
      )?.toISOString(),
    ).toBe('2026-10-25T00:15:00.000Z');
  });

  it('rejects END-relative alarms whose event duration exceeds the shared bound', () => {
    const longRelatedEndEvent = {
      ...resource,
      icalendar: resource.icalendar
        .replace(
          'DTEND;TZID=Europe/Stockholm:20261005T100000',
          'DTEND;TZID=Europe/Stockholm:20271007T100000',
        )
        .replace('TRIGGER:-PT15M', 'TRIGGER;RELATED=END:-PT15M'),
    };

    expect(() =>
      resolveTriggerableReminderIdentity(master, longRelatedEndEvent),
    ).toThrow(ReminderConfigurationSourceError);
  });

  it.each([
    {
      label: 'floating time',
      timing: {
        type: 'timed',
        start: { type: 'floating', local: '2026-10-05T09:00:00' },
        end: {
          type: 'zoned',
          local: '2026-10-05T10:00:00',
          timezone: 'Europe/Stockholm',
        },
      },
    },
    {
      label: 'all-day DATE',
      timing: {
        type: 'all-day',
        startDate: '2026-10-05',
        endDate: '2026-10-06',
      },
    },
    {
      label: 'unknown TZID',
      timing: {
        type: 'timed',
        start: {
          type: 'zoned',
          local: '2026-10-05T09:00:00',
          timezone: 'Unknown/Zone',
        },
        end: {
          type: 'zoned',
          local: '2026-10-05T10:00:00',
          timezone: 'Unknown/Zone',
        },
      },
    },
  ])('rejects projected $label timing', ({ timing }) => {
    const selection = resolveCanonicalReminderResourceSelection(
      master,
      resource,
    );
    expect(() =>
      resolveProjectedReminderOccurrenceTiming(selection, timing as never),
    ).toThrow(ReminderConfigurationSourceError);
  });

  it.each([
    [
      'floating DTSTART',
      (source: string) =>
        source.replace(
          'DTSTART;TZID=Europe/Stockholm:20261005T090000',
          'DTSTART:20261005T090000',
        ),
    ],
    [
      'DATE DTSTART',
      (source: string) =>
        source.replace(
          'DTSTART;TZID=Europe/Stockholm:20261005T090000',
          'DTSTART;VALUE=DATE:20261005',
        ),
    ],
    [
      'invalid Gregorian DTSTART',
      (source: string) => source.replace('20261005T090000', '20260230T090000'),
    ],
    [
      'TZID mixed with UTC suffix',
      (source: string) =>
        source.replace(
          'DTSTART;TZID=Europe/Stockholm:20261005T090000',
          'DTSTART;TZID=Europe/Stockholm:20261005T090000Z',
        ),
    ],
    [
      'duplicate DTSTART',
      (source: string) =>
        source.replace(
          'DTSTART;TZID=Europe/Stockholm:20261005T090000',
          'DTSTART;TZID=Europe/Stockholm:20261005T090000\nDTSTART;TZID=Europe/Stockholm:20261005T090000',
        ),
    ],
    [
      'missing DTEND',
      (source: string) =>
        source.replace('DTEND;TZID=Europe/Stockholm:20261005T100000\n', ''),
    ],
    [
      'VEVENT DURATION timing',
      (source: string) =>
        source.replace(
          'DTEND;TZID=Europe/Stockholm:20261005T100000',
          'DURATION:PT1H',
        ),
    ],
    [
      'VEVENT with both DTEND and DURATION',
      (source: string) =>
        source.replace(
          'DTEND;TZID=Europe/Stockholm:20261005T100000',
          'DTEND;TZID=Europe/Stockholm:20261005T100000\nDURATION:PT1H',
        ),
    ],
    [
      'duplicate TZID parameter',
      (source: string) =>
        source.replace(
          'DTSTART;TZID=Europe/Stockholm:20261005T090000',
          'DTSTART;TZID=Europe/Stockholm;TZID=Europe/Stockholm:20261005T090000',
        ),
    ],
    [
      'unsupported named TZID',
      (source: string) =>
        source.replaceAll('Europe/Stockholm', 'Unknown/NotBundled'),
    ],
    [
      'malformed trigger duration',
      (source: string) => source.replace('TRIGGER:-PT15M', 'TRIGGER:-PT15Mx'),
    ],
    [
      'trigger more than 366 days from its anchor',
      (source: string) => source.replace('TRIGGER:-PT15M', 'TRIGGER:P367D'),
    ],
    [
      'repeat count above the supported limit',
      (source: string) =>
        source.replace(
          'TRIGGER:-PT15M',
          'TRIGGER:-PT15M\nREPEAT:101\nDURATION:PT1M',
        ),
    ],
  ])(
    'fails closed for %s without returning source details',
    (_label, mutate) => {
      const candidate = { ...resource, icalendar: mutate(resource.icalendar) };
      try {
        resolveTriggerableReminderIdentity(master, candidate);
        fail('expected unsupported source to fail');
      } catch (error) {
        expect(error).toBeInstanceOf(ReminderConfigurationSourceError);
        expect((error as Error).message).toBe(
          'Reminder source is not supported',
        );
        expect(JSON.stringify(error)).not.toContain('Private');
        expect(JSON.stringify(error)).not.toContain('Unknown/NotBundled');
      }
    },
  );
});
