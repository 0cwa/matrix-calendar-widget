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

import type {
  CalendarEvent,
  CalendarEventTimedDateTime,
} from '@matrix-calendar-widget/calendar';
import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import {
  calendarEventSchedule,
  describeCalendarWallTime,
} from './calendarEventSchedule';

const zoned = (
  local: string,
  timezone = 'Europe/Stockholm',
): CalendarEventTimedDateTime => ({ type: 'zoned', local, timezone });

const timed = (
  start: CalendarEventTimedDateTime,
  end: CalendarEventTimedDateTime,
): CalendarEvent => ({
  id: 'event',
  calendarId: 'team',
  uid: 'event@example.test',
  title: 'Event',
  timing: { type: 'timed', start, end },
});

describe('calendarEventSchedule', () => {
  const event = timed(
    zoned('2026-09-23T09:00:00'),
    zoned('2026-09-23T10:00:00'),
  );

  it('names one clock when the viewer shares the event offsets', () => {
    expect(calendarEventSchedule(event, 'Europe/Berlin')).toEqual({
      kind: 'same-clock',
      timezone: 'Europe/Stockholm',
      offsets: { start: 'UTC+02:00', end: 'UTC+02:00' },
    });
  });

  it('separates viewer and source offsets when clocks differ', () => {
    expect(calendarEventSchedule(event, 'Asia/Kolkata')).toEqual({
      kind: 'other-clock',
      timezone: 'Europe/Stockholm',
      offsets: { start: 'UTC+02:00', end: 'UTC+02:00' },
      viewerOffsets: { start: 'UTC+05:30', end: 'UTC+05:30' },
    });
  });

  it('keeps both offsets across a clock change', () => {
    expect(
      calendarEventSchedule(
        timed(zoned('2026-10-24T12:00:00'), zoned('2026-10-26T12:00:00')),
        'UTC',
      ),
    ).toMatchObject({
      offsets: { start: 'UTC+02:00', end: 'UTC+01:00' },
      viewerOffsets: { start: 'UTC+00:00', end: 'UTC+00:00' },
    });
  });

  it('gives floating and all-day events no time zone', () => {
    expect(
      calendarEventSchedule(
        timed(
          { type: 'floating', local: '2026-09-23T09:00:00' },
          { type: 'floating', local: '2026-09-23T10:00:00' },
        ),
        'Asia/Kolkata',
      ),
    ).toEqual({ kind: 'floating' });
    expect(
      calendarEventSchedule(
        {
          ...event,
          timing: {
            type: 'all-day',
            startDate: '2026-09-23',
            endDate: '2026-09-24',
          },
        },
        'Asia/Kolkata',
      ),
    ).toEqual({ kind: 'all-day' });
  });

  it('describes each endpoint when they keep different zones', () => {
    const schedule = calendarEventSchedule(
      timed(
        zoned('2026-09-23T09:00:00'),
        zoned('2026-09-23T10:00:00', 'America/New_York'),
      ),
      'UTC',
    );
    expect(schedule).toMatchObject({
      kind: 'mixed',
      start: { timezone: 'Europe/Stockholm', offset: 'UTC+02:00' },
      end: { timezone: 'America/New_York', offset: 'UTC-04:00' },
    });
  });

  it.each([
    {
      name: 'an unknown zone',
      event: timed(
        zoned('2026-09-23T09:00:00', 'Custom/Office'),
        zoned('2026-09-23T10:00:00', 'Custom/Office'),
      ),
    },
    {
      name: 'a conflicting embedded zone',
      event: { ...event, unsupportedTimezone: true as const },
    },
  ])('shows saved times without offsets for $name', ({ event }) => {
    const schedule = calendarEventSchedule(event, 'UTC');
    expect(schedule.kind).toBe('unverified');
    expect(schedule).not.toHaveProperty('start.offset');
    expect(schedule).toHaveProperty(
      'start.local',
      DateTime.fromISO('2026-09-23T09:00:00', { zone: 'UTC' }),
    );
  });
});

describe('describeCalendarWallTime', () => {
  it('gives no offset to a time skipped by a clock change', () => {
    const wallTime = describeCalendarWallTime(
      '2026-03-29T02:30',
      'Europe/Stockholm',
    );
    expect(wallTime?.status).toBe('skipped');
    expect(wallTime).not.toHaveProperty('offset');
  });

  it('reads a repeated time as its first occurrence', () => {
    expect(
      describeCalendarWallTime('2026-10-25T02:30', 'Europe/Stockholm'),
    ).toEqual({
      status: 'repeated',
      instant: Date.parse('2026-10-25T00:30:00Z'),
      offset: 'UTC+02:00',
    });
  });

  it('states ordinary and half-hour offsets', () => {
    expect(
      describeCalendarWallTime('2026-10-25T03:30', 'Europe/Stockholm'),
    ).toMatchObject({ status: 'unique', offset: 'UTC+01:00' });
    expect(
      describeCalendarWallTime('2026-09-23T09:00', 'Asia/Kolkata'),
    ).toMatchObject({ status: 'unique', offset: 'UTC+05:30' });
  });

  it('says nothing about zones outside the bundled list or partial input', () => {
    expect(
      describeCalendarWallTime('2026-09-23T09:00', 'UTC+3'),
    ).toBeUndefined();
    expect(describeCalendarWallTime('', 'Europe/Stockholm')).toBeUndefined();
  });
});
