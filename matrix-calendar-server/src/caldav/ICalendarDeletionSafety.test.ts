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
import { isSafeSingleVeventSeries } from './ICalendarDeletionSafety';

const simpleCalendar = fs.readFileSync(
  path.resolve(__dirname, '../../../fixtures/ical/simple-timed.ics'),
  'utf8',
);

describe('isSafeSingleVeventSeries', () => {
  it('allows one VEVENT series and its supported standard children', () => {
    const calendarWithTimezone = simpleCalendar
      .replace(
        'BEGIN:VEVENT',
        [
          'BEGIN:VTIMEZONE',
          'TZID:Etc/UTC',
          'BEGIN:STANDARD',
          'DTSTART:19700101T000000',
          'TZOFFSETFROM:+0000',
          'TZOFFSETTO:+0000',
          'END:STANDARD',
          'END:VTIMEZONE',
          'BEGIN:VEVENT',
        ].join('\n'),
      )
      .replace(
        'END:VEVENT',
        [
          'BEGIN:VALARM',
          'ACTION:DISPLAY',
          'TRIGGER:-PT5M',
          'DESCRIPTION:Reminder',
          'END:VALARM',
          'END:VEVENT',
        ].join('\n'),
      );

    expect(isSafeSingleVeventSeries(calendarWithTimezone)).toBe(true);
  });

  it.each([
    [
      'a VTODO nested in VEVENT',
      simpleCalendar.replace(
        'END:VEVENT',
        'BEGIN:VTODO\nUID:task@example.test\nEND:VTODO\nEND:VEVENT',
      ),
    ],
    [
      'an unknown component nested in VALARM',
      simpleCalendar.replace(
        'END:VEVENT',
        [
          'BEGIN:VALARM',
          'ACTION:DISPLAY',
          'TRIGGER:-PT5M',
          'BEGIN:X-UNSUPPORTED',
          'END:X-UNSUPPORTED',
          'END:VALARM',
          'END:VEVENT',
        ].join('\n'),
      ),
    ],
    [
      'an unknown component nested in a VTIMEZONE observance',
      simpleCalendar.replace(
        'BEGIN:VEVENT',
        [
          'BEGIN:VTIMEZONE',
          'TZID:Etc/UTC',
          'BEGIN:STANDARD',
          'DTSTART:19700101T000000',
          'TZOFFSETFROM:+0000',
          'TZOFFSETTO:+0000',
          'BEGIN:X-UNSUPPORTED',
          'END:X-UNSUPPORTED',
          'END:STANDARD',
          'END:VTIMEZONE',
          'BEGIN:VEVENT',
        ].join('\n'),
      ),
    ],
  ])('rejects %s', (_description, icalendar) => {
    expect(isSafeSingleVeventSeries(icalendar)).toBe(false);
  });
});
