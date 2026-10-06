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
  CalendarEventOccurrenceValidationError,
  isCalendarEventOccurrenceWrite,
  validateCalendarEventPatchOccurrence,
} from './calendarEventOccurrenceWrite';

const recurrenceId = {
  type: 'date-time',
  value: { local: '2026-10-25T09:00:00', timezone: 'Europe/Stockholm' },
};
const timing = {
  type: 'end',
  start: recurrenceId,
  end: {
    type: 'date-time',
    value: { local: '2026-10-25T10:00:00', timezone: 'Europe/Stockholm' },
  },
};

describe('selected-occurrence text write validation', () => {
  it('keeps the legacy timing-only write and accepts sparse text-only writes', () => {
    expect(
      isCalendarEventOccurrenceWrite({
        action: 'set-timing',
        recurrenceId,
        timing,
        viewerTimezone: 'Europe/Stockholm',
      }),
    ).toBe(true);
    expect(
      isCalendarEventOccurrenceWrite({
        action: 'set-fields',
        recurrenceId,
        viewerTimezone: 'Europe/Stockholm',
        title: { action: 'set', value: 'Planning' },
        description: { action: 'set', value: '' },
        location: { action: 'inherit' },
      }),
    ).toBe(true);
  });

  it.each([
    { action: 'set-fields', recurrenceId, viewerTimezone: 'Europe/Stockholm' },
    {
      action: 'set-fields',
      recurrenceId,
      viewerTimezone: 'Europe/Stockholm',
      title: { action: 'set', value: '   ' },
    },
    {
      action: 'set-fields',
      recurrenceId,
      viewerTimezone: 'Europe/Stockholm',
      location: { action: 'set', value: 'Room', unexpected: true },
    },
    {
      action: 'set-fields',
      recurrenceId,
      viewerTimezone: 'Europe/Stockholm',
      description: { action: 'inherit' },
      unexpected: true,
    },
  ])('rejects malformed or empty operations: %o', (operation) => {
    expect(isCalendarEventOccurrenceWrite(operation)).toBe(false);
  });

  it('rejects occurrence writes mixed with unrelated event patch fields', () => {
    expect(() =>
      validateCalendarEventPatchOccurrence({
        title: 'Changed series',
        recurrence: {
          occurrence: {
            action: 'set-fields',
            recurrenceId,
            viewerTimezone: 'Europe/Stockholm',
            location: { action: 'set', value: 'Room' },
          },
        },
      }),
    ).toThrow(CalendarEventOccurrenceValidationError);
  });

  it('rejects a malformed recurrence container before transport reads', () => {
    expect(() =>
      validateCalendarEventPatchOccurrence({ recurrence: 'not-an-object' }),
    ).toThrow(CalendarEventOccurrenceValidationError);
  });
});
