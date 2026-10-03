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

import { CalendarEvent } from '@matrix-calendar-widget/calendar';
import {
  formatCalendarEventDetails,
  formatCalendarEventOccurrence,
  formatCalendarEventWhen,
  sanitizeCalendarDisplayText,
} from './CalendarCommandFormatter';

describe('sanitizeCalendarDisplayText', () => {
  test('collapses controls and line breaks and removes bidi controls', () => {
    expect(
      sanitizeCalendarDisplayText(
        ' <b>Planning</b>\n\u061c\u202eattacker\u2066 text\u2069\u206a ',
        120,
        '(untitled)',
      ),
    ).toBe('<b>Planning</b> attacker text');
  });

  test('bounds by Unicode code points and supplies a fallback for empty text', () => {
    expect(sanitizeCalendarDisplayText('A😀BC', 3, 'fallback')).toBe('A😀…');
    expect(sanitizeCalendarDisplayText('\n\u0001', 120, 'fallback')).toBe(
      'fallback',
    );
    expect(sanitizeCalendarDisplayText(undefined, 120, 'fallback')).toBe(
      'fallback',
    );
  });
});

describe('calendar command formatting', () => {
  const labels = {
    id: 'Resource ID',
    title: 'Title',
    when: 'When',
    description: 'Description',
    untitled: '(untitled)',
    timeUnavailable: 'Time unavailable',
  };

  const event: CalendarEvent = {
    id: 'https://dav.example.test/alice/team/event.ics',
    calendarId: 'team',
    uid: 'private-uid@example.test',
    title: '<script>alert(1)</script>\nPlanning',
    description: 'First line\nSecond line\u202e',
    timing: {
      type: 'timed',
      start: {
        type: 'zoned',
        local: '2026-10-04T13:00:00',
        timezone: 'Europe/Stockholm',
      },
      end: {
        type: 'zoned',
        local: '2026-10-04T14:00:00',
        timezone: 'Europe/Stockholm',
      },
    },
  };

  test('formats safe plaintext fields without exposing event UID or href', () => {
    const details = formatCalendarEventDetails(
      event,
      'event.ics',
      'UTC',
      labels,
    );

    expect(details).toContain('Resource ID: event.ics');
    expect(details).toContain('Title: <script>alert(1)</script> Planning');
    expect(details).toContain('When: 2026-10-04 11:00 – 12:00');
    expect(details).toContain('Description: First line Second line');
    expect(details).not.toContain('private-uid');
    expect(details).not.toContain('https://dav.example.test');
    expect(details).not.toContain('\u202e');
  });

  test('formats an occurrence using a plain bounded title and collection ID', () => {
    expect(
      formatCalendarEventOccurrence(event, 'event.ics', 'UTC', labels),
    ).toBe(
      'event.ics — 2026-10-04 11:00 – 12:00 — <script>alert(1)</script> Planning',
    );
  });

  test('formats all-day dates with their exclusive end converted to the last day', () => {
    expect(
      formatCalendarEventWhen(
        {
          type: 'all-day',
          startDate: '2026-10-04',
          endDate: '2026-10-05',
        },
        'UTC',
        'Time unavailable',
      ),
    ).toBe('2026-10-04');
    expect(
      formatCalendarEventWhen(
        {
          type: 'all-day',
          startDate: '2026-10-04',
          endDate: '2026-10-07',
        },
        'UTC',
        'Time unavailable',
      ),
    ).toBe('2026-10-04 – 2026-10-06');
  });
});
