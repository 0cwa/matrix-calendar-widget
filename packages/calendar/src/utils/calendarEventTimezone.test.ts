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

import {
  calendarLocalDateTimeToUnixMillis,
  calendarUnixMillisToLocalDateTime,
  isCalendarRecurrenceWallTimeValid,
} from './calendarEventTimezone';

describe('calendarEventTimezone', () => {
  it('preserves second-resolution historical offsets from bundled IANA data', () => {
    const kolkataNoon = calendarLocalDateTimeToUnixMillis(
      '1855-01-01T12:00:00',
      'Asia/Kolkata',
    );

    expect(kolkataNoon).toBe(Date.parse('1855-01-01T06:06:40Z'));
    expect(calendarUnixMillisToLocalDateTime(kolkataNoon, 'Asia/Kolkata')).toBe(
      '1855-01-01T12:00:00',
    );
    expect(
      calendarLocalDateTimeToUnixMillis('1870-01-01T00:10:00', 'Asia/Kolkata'),
    ).toBe(Date.parse('1869-12-31T18:48:50Z'));
  });
});

// Exercise the cached transition index across coverage growth and old/new reads.
describe('indexed timezone transition boundaries', () => {
  it.each([
    ['2026-03-29T01:59:59', '2026-03-29T00:59:59Z', true],
    ['2026-03-29T02:00:00', '2026-03-29T01:00:00Z', false],
    ['2026-03-29T02:59:59', '2026-03-29T01:59:59Z', false],
    ['2026-03-29T03:00:00', '2026-03-29T01:00:00Z', true],
    ['2026-10-25T01:59:59', '2026-10-24T23:59:59Z', true],
    ['2026-10-25T02:00:00', '2026-10-25T00:00:00Z', true],
    ['2026-10-25T02:59:59', '2026-10-25T00:59:59Z', true],
    ['2026-10-25T03:00:00', '2026-10-25T02:00:00Z', true],
  ])('retains explicit and generated semantics at %s', (local, utc, valid) => {
    expect(calendarLocalDateTimeToUnixMillis(local, 'Europe/Stockholm')).toBe(
      Date.parse(utc),
    );
    expect(isCalendarRecurrenceWallTimeValid(local, 'Europe/Stockholm')).toBe(
      valid,
    );
  });

  it('keeps historical exact offsets when future coverage has been cached', () => {
    for (const local of [
      '1855-01-01T12:00:00',
      '2035-01-01T12:00:00',
      '1870-01-01T12:00:00',
      '1855-01-01T12:00:00',
    ]) {
      const instant = calendarLocalDateTimeToUnixMillis(local, 'Asia/Kolkata');
      expect(calendarUnixMillisToLocalDateTime(instant, 'Asia/Kolkata')).toBe(
        local,
      );
    }
    expect(
      calendarLocalDateTimeToUnixMillis('1855-01-01T12:00:00', 'Asia/Kolkata'),
    ).toBe(Date.parse('1855-01-01T06:06:40Z'));
  });
});
