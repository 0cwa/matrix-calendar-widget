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
  assertVeventOnlyCalendar,
  PublicCalendarFeedComponentError,
} from './PublicCalendarFeedIcs';

const veventFeed = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nX-OPAQUE-PROP;X-KEEP=attribute:preserved\r\nBEGIN:VTIMEZONE\r\nTZID:Europe/Stockholm\r\nBEGIN:STANDARD\r\nDTSTART:20261025T030000\r\nTZOFFSETFROM:+0200\r\nTZOFFSETTO:+0100\r\nEND:STANDARD\r\nEND:VTIMEZONE\r\nBEGIN:VEVENT\r\nUID:synthetic-event\r\nRRULE:FREQ=WEEKLY;BYDAY=TH;COUNT=3\r\nSUMMARY:Long\r\n  title\r\nBEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT5M\r\nEND:VALARM\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;

describe('assertVeventOnlyCalendar', () => {
  it('accepts VEVENT feeds with canonical timezone, alarm, recurrence, and opaque properties', () => {
    expect(() =>
      assertVeventOnlyCalendar(Buffer.from(veventFeed)),
    ).not.toThrow();
  });

  it.each([
    ['VTODO', 'BEGIN:VTODO\r\nUID:task\r\nEND:VTODO\r\n'],
    ['VJOURNAL', 'BEGIN:VJOURNAL\r\nUID:journal\r\nEND:VJOURNAL\r\n'],
    ['VFREEBUSY', 'BEGIN:VFREEBUSY\r\nUID:busy\r\nEND:VFREEBUSY\r\n'],
  ])('rejects a %s component', (_name, component) => {
    const feed = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${component}END:VCALENDAR\r\n`;
    expect(() => assertVeventOnlyCalendar(Buffer.from(feed))).toThrow(
      PublicCalendarFeedComponentError,
    );
  });

  it.each([
    `X-OUTSIDE:before\r\n${veventFeed}`,
    `${veventFeed}X-OUTSIDE:after\r\n`,
    veventFeed.replace('END:VEVENT', 'END:VTODO'),
    veventFeed.replace('END:VCALENDAR', 'END:VEVENT\r\nEND:VCALENDAR'),
    'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nEND:VEVENT\r\n',
  ])('rejects malformed component boundaries', (feed) => {
    expect(() => assertVeventOnlyCalendar(Buffer.from(feed))).toThrow(
      PublicCalendarFeedComponentError,
    );
  });

  it('rejects invalid UTF-8 instead of forwarding an unchecked body', () => {
    expect(() =>
      assertVeventOnlyCalendar(new Uint8Array([0xff, 0xfe, 0xfd])),
    ).toThrow(PublicCalendarFeedComponentError);
  });
});
