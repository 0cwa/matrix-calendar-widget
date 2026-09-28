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
