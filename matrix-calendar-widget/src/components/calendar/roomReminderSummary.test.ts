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

import { describe, expect, it } from 'vitest';
import type {
  CalendarRoomReminderAlarmOption,
  CalendarRoomReminderConfiguration,
} from '../../calendar';
import { reminderOptionKey, summarizeRoomReminders } from './roomReminderModel';

const alert: CalendarRoomReminderAlarmOption = {
  eventUid: 'test-event@example.test',
  alarmUid: 'test-alert',
  recurrenceId: null,
  timingType: 'timed',
  supported: true,
  requiresAllDaySchedule: false,
};
const wholeRoom: CalendarRoomReminderConfiguration = {
  eventUid: alert.eventUid,
  alarmUid: alert.alarmUid,
  recurrenceId: alert.recurrenceId,
  target: { kind: 'room' },
  allDaySchedule: null,
  revision: 1,
};
const selectedPeople: CalendarRoomReminderConfiguration = {
  ...wholeRoom,
  target: {
    kind: 'users',
    userIds: ['@alex:example.test', '@sam:example.test'],
  },
};
const secondAlert = { ...alert, alarmUid: 'second-alert' };

describe('saved room notification summary', () => {
  it('reports loading and failures before interpreting saved settings', () => {
    const saved = { [reminderOptionKey(alert)]: wholeRoom };
    expect(summarizeRoomReminders(true, false, [alert], saved, [])).toEqual({
      kind: 'loading',
    });
    expect(summarizeRoomReminders(false, true, [alert], saved, [])).toEqual({
      kind: 'error',
    });
  });

  it('distinguishes unavailable alerts, inactive notifications, and orphaned settings', () => {
    expect(summarizeRoomReminders(false, false, [], {}, [])).toEqual({
      kind: 'no-alerts',
    });
    expect(summarizeRoomReminders(false, false, [alert], {}, [])).toEqual({
      kind: 'off',
    });
    expect(summarizeRoomReminders(false, false, [], {}, [wholeRoom])).toEqual({
      kind: 'orphaned',
    });
  });

  it('uses saved identities and targets without inspecting the room roster', () => {
    const key = reminderOptionKey(alert);
    expect(
      summarizeRoomReminders(false, false, [alert], { [key]: wholeRoom }, []),
    ).toEqual({
      kind: 'whole-room',
    });
    expect(
      summarizeRoomReminders(
        false,
        false,
        [alert],
        { [key]: selectedPeople },
        [],
      ),
    ).toEqual({
      kind: 'selected-people',
      count: 2,
    });
    expect(
      summarizeRoomReminders(
        false,
        false,
        [{ ...alert, supported: false }],
        { [key]: wholeRoom },
        [],
      ),
    ).toEqual({
      kind: 'unsupported',
    });
    expect(
      summarizeRoomReminders(
        false,
        false,
        [alert, secondAlert],
        {
          [key]: wholeRoom,
          [reminderOptionKey(secondAlert)]: {
            ...wholeRoom,
            alarmUid: secondAlert.alarmUid,
          },
        },
        [],
      ),
    ).toEqual({
      kind: 'multiple',
      count: 2,
    });
  });
});
