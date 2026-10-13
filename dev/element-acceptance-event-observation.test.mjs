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

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compareEventTimingWithRoomRange,
  inspectExpectedEventList,
  readCreatedEventTiming,
} from './element-acceptance-event-observation.mjs';

function localDateTime(instant, timezone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA-u-ca-iso8601', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(instant)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

test('reads only timed events with zoned endpoints', () => {
  const value = {
    type: 'timed',
    start: {
      type: 'zoned',
      local: '2026-02-10T13:00',
      timezone: 'Europe/Stockholm',
    },
    end: {
      type: 'zoned',
      local: '2026-02-10T14:00',
      timezone: 'Europe/Stockholm',
    },
  };
  assert.deepEqual(readCreatedEventTiming(value), value);
  assert.equal(
    readCreatedEventTiming({ ...value, type: 'all-day' }),
    undefined,
  );
  assert.equal(
    readCreatedEventTiming({ ...value, end: { ...value.end, timezone: '' } }),
    undefined,
  );
  assert.equal(readCreatedEventTiming('private title and event id'), undefined);
});

test('summarizes only capped list facts and match booleans', () => {
  const privateTitle = 'private sentinel title';
  const privateId = 'private-sentinel-id';
  const privateCalendar = 'private-calendar-id';
  const diagnostic = inspectExpectedEventList(
    {
      events: [
        {
          event: {
            id: privateId,
            title: privateTitle,
            calendarId: privateCalendar,
          },
        },
      ],
    },
    {
      expectedTitle: privateTitle,
      expectedCalendarId: privateCalendar,
      createdEventId: privateId,
    },
  );
  assert.deepEqual(diagnostic, {
    hasEventsArray: true,
    eventCountCapped: 1,
    titleMatches: true,
    idMatches: true,
    calendarMatches: true,
  });
  assert.doesNotMatch(JSON.stringify(diagnostic), /private sentinel|private-/u);
  assert.deepEqual(
    inspectExpectedEventList(
      { events: [] },
      { expectedTitle: privateTitle, expectedCalendarId: privateCalendar },
    ),
    {
      hasEventsArray: true,
      eventCountCapped: 0,
      titleMatches: false,
      idMatches: null,
      calendarMatches: false,
    },
  );
  assert.deepEqual(
    inspectExpectedEventList(null, {
      expectedTitle: privateTitle,
      expectedCalendarId: privateCalendar,
    }),
    {
      hasEventsArray: false,
      eventCountCapped: null,
      titleMatches: null,
      idMatches: null,
      calendarMatches: null,
    },
  );
  assert.throws(
    () =>
      inspectExpectedEventList(
        { events: [] },
        {
          expectedTitle: privateTitle,
          expectedCalendarId: privateCalendar,
          createdEventId: null,
        },
      ),
    /Invalid expected event identity/u,
  );
});

test('compares zoned timing against the same browser-local room range', () => {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const start = new Date('2026-02-10T13:00:00.000Z');
  const end = new Date('2026-02-10T14:00:00.000Z');
  const timing = {
    type: 'timed',
    start: { type: 'zoned', local: localDateTime(start, timezone), timezone },
    end: { type: 'zoned', local: localDateTime(end, timezone), timezone },
  };
  const roomRange = {
    start: '2026-02-10T12:30:00.000Z',
    end: '2026-02-10T13:30:00.000Z',
    timezone,
  };
  assert.deepEqual(
    compareEventTimingWithRoomRange({ timing, range: roomRange }),
    { comparable: true, intersects: true },
  );
  assert.deepEqual(
    compareEventTimingWithRoomRange({
      timing,
      range: {
        start: '2026-02-10T14:00:00.000Z',
        end: '2026-02-10T15:00:00.000Z',
        timezone,
      },
    }),
    { comparable: true, intersects: false },
  );
  assert.deepEqual(
    compareEventTimingWithRoomRange({
      timing: {
        ...timing,
        start: { ...timing.start, timezone: 'Etc/Unknown' },
      },
      range: roomRange,
    }),
    { comparable: false, intersects: false },
  );
  assert.deepEqual(
    compareEventTimingWithRoomRange({
      timing,
      range: { ...roomRange, end: 'not a date' },
    }),
    { comparable: false, intersects: false },
  );
});
