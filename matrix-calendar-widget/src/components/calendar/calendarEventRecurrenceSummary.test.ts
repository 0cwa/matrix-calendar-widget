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

import type { CalendarEvent } from '@matrix-calendar-widget/calendar';
import i18next from 'i18next';
import { describe, expect, it } from 'vitest';
import { calendarEventRecurrenceSummary } from './calendarEventRecurrenceSummary';

// Wednesday 2026-09-23.
const event: CalendarEvent = {
  id: 'series',
  calendarId: 'team',
  uid: 'series@example.test',
  title: 'Series',
  timing: {
    type: 'timed',
    start: {
      type: 'zoned',
      local: '2026-09-23T09:00:00',
      timezone: 'Europe/Stockholm',
    },
    end: {
      type: 'zoned',
      local: '2026-09-23T10:00:00',
      timezone: 'Europe/Stockholm',
    },
  },
};

const summary = (
  recurrence: CalendarEvent['recurrence'],
  { viewer = 'Europe/Stockholm', locale = 'en' } = {},
) =>
  calendarEventRecurrenceSummary(
    { ...event, recurrence },
    locale,
    viewer,
    i18next.getFixedT(locale),
  ).join(' ');

describe('calendarEventRecurrenceSummary', () => {
  it.each([
    ['FREQ=DAILY', 'Repeats daily.'],
    [
      'FREQ=DAILY;INTERVAL=3;COUNT=1',
      'Repeats every 3 days. Number of occurrences: 1.',
    ],
    [
      'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE',
      'Repeats every 2 weeks on Monday and Wednesday.',
    ],
    ['FREQ=MONTHLY', 'Repeats monthly on day 23.'],
    ['FREQ=MONTHLY;BYDAY=4WE', 'Repeats monthly on the fourth Wednesday.'],
    ['FREQ=YEARLY', 'Repeats yearly on September 23.'],
  ])('describes %s', (rrule, expected) => {
    expect(summary({ rrule })).toBe(expected);
  });

  it('keeps an end date that still admits the start time', () => {
    // 21:59:59Z is the end of October 7 in Stockholm.
    expect(summary({ rrule: 'FREQ=DAILY;UNTIL=20261007T215959Z' })).toBe(
      'Repeats daily. Ends by October 7, 2026.',
    );
  });

  it('drops an end date that closes before the start time', () => {
    // 05:00Z is 07:00 in Stockholm, before the 09:00 occurrence.
    expect(summary({ rrule: 'FREQ=DAILY;UNTIL=20261007T050000Z' })).toBe(
      'Repeats daily. Ends by October 6, 2026.',
    );
  });

  it('says whose calendar days the rule follows for another viewer', () => {
    expect(
      summary({ rrule: 'FREQ=WEEKLY' }, { viewer: 'Pacific/Auckland' }),
    ).toBe(
      'Repeats weekly on Wednesday. Repeat dates follow Europe/Stockholm.',
    );
  });

  it('reports exceptions alongside the rule', () => {
    const recurrenceId = {
      type: 'date-time' as const,
      value: { local: '2026-09-30T09:00:00', timezone: 'Europe/Stockholm' },
    };
    expect(
      summary({
        rrule: 'FREQ=WEEKLY',
        rdates: [recurrenceId],
        exdates: [recurrenceId],
        overrides: [{ recurrenceId }],
      }),
    ).toBe(
      'Repeats weekly on Wednesday. Includes additional dates. Some dates are skipped. Some occurrences have their own changes.',
    );
  });

  it.each(['FREQ=HOURLY', 'FREQ=MONTHLY;BYSETPOS=1;BYDAY=MO', 'nonsense'])(
    'does not guess at %s',
    (rrule) => {
      expect(summary({ rrule })).toBe('Repeats on a custom schedule.');
    },
  );

  it('names selected dates and unsupported data without a rule', () => {
    expect(summary({ rdates: [{ type: 'date', value: '2026-09-30' }] })).toBe(
      'Repeats on selected dates.',
    );
    expect(
      calendarEventRecurrenceSummary(
        { ...event, unsupportedRecurrence: 'range-this-and-future' },
        'en',
        'UTC',
        i18next.getFixedT('en'),
      ),
    ).toEqual(['Repeats on a custom schedule.']);
  });

  it('uses German sentences and weekday names', () => {
    expect(summary({ rrule: 'FREQ=WEEKLY' }, { locale: 'de' })).toBe(
      'Wiederholt sich wöchentlich am Mittwoch.',
    );
  });
});
