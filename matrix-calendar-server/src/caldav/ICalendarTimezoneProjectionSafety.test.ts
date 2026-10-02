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

import { getVTimezoneBlock } from '@matrix-calendar-widget/ical-timezones';
import ICAL from 'ical.js';
import { hasUnsupportedTimezoneRules } from './ICalendarTimezoneProjectionSafety';

const timezoneId = 'Europe/Stockholm';
const eventUid = 'timezone-order-fixture';

describe('hasUnsupportedTimezoneRules', () => {
  it('accepts bundled observances in a different component order', () => {
    const calendar = calendarWithTimezone(
      reorderObservances(bundledTimezone()),
    );

    expect(hasUnsupportedTimezoneRules(calendar, eventUid)).toBe(false);
  });

  it('rejects a material observance rule change after order normalization', () => {
    const changed = reorderObservances(bundledTimezone()).replace(
      /TZOFFSETTO:([+-])/,
      (_match, sign: string) => `TZOFFSETTO:${sign === '+' ? '-' : '+'}`,
    );
    const calendar = calendarWithTimezone(changed);

    expect(hasUnsupportedTimezoneRules(calendar, eventUid)).toBe(true);
  });
});

function bundledTimezone(): string {
  const block = getVTimezoneBlock(timezoneId);
  if (!block) {
    throw new Error('Bundled timezone fixture is unavailable');
  }
  return block;
}

function reorderObservances(block: string): string {
  const standard = block.match(/BEGIN:STANDARD\r?\n[\s\S]*?END:STANDARD/);
  const daylight = block.match(/BEGIN:DAYLIGHT\r?\n[\s\S]*?END:DAYLIGHT/);
  if (!standard || !daylight) {
    throw new Error('Bundled timezone fixture has incomplete observances');
  }

  const marker = 'X-TEST-OBSERVANCE-ORDER-MARKER';
  return block
    .replace(standard[0], marker)
    .replace(daylight[0], standard[0])
    .replace(marker, daylight[0]);
}

function calendarWithTimezone(timezone: string): ICAL.Component {
  return ICAL.Component.fromString(
    [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      timezone.trim(),
      'BEGIN:VEVENT',
      `UID:${eventUid}`,
      `DTSTART;TZID=${timezoneId}:20261026T090000`,
      `DTEND;TZID=${timezoneId}:20261026T100000`,
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n'),
  );
}
