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
  CalendarRoomReminderAlarmOption,
  CalendarRoomReminderAllDaySchedule,
  CalendarRoomReminderConfiguration,
  CalendarRoomReminderIdentity,
} from '../../calendar';

export type CalendarReminderMember = Readonly<{
  userId: string;
  displayName: string;
}>;

export type ReminderDestinationChoice = 'off' | 'room' | 'users';

export type ReminderDraft = Readonly<{
  destination: ReminderDestinationChoice;
  userIds: readonly string[];
  allDaySchedule: CalendarRoomReminderAllDaySchedule;
  departedUserIds: readonly string[];
}>;

export function createDraft(
  configuration: CalendarRoomReminderConfiguration | undefined,
  members: readonly CalendarReminderMember[],
  calendarTimezone?: string,
  membersUnavailable = false,
): ReminderDraft {
  const configuredIds =
    configuration?.target.kind === 'users'
      ? [...configuration.target.userIds]
      : [];
  const joinedIds = new Set(members.map((member) => member.userId));
  return {
    destination: configuration?.target.kind ?? 'off',
    userIds: membersUnavailable
      ? configuredIds
      : configuredIds.filter((userId) => joinedIds.has(userId)),
    departedUserIds: membersUnavailable
      ? []
      : configuredIds.filter((userId) => !joinedIds.has(userId)),
    allDaySchedule: configuration?.allDaySchedule ?? {
      daysBefore: 0,
      localTime: '09:00',
      timezone: calendarTimezone ?? '',
    },
  };
}

export function sameAllDaySchedule(
  left: CalendarRoomReminderAllDaySchedule,
  right: CalendarRoomReminderAllDaySchedule | null | undefined,
): boolean {
  return (
    right !== null &&
    right !== undefined &&
    left.daysBefore === right.daysBefore &&
    left.localTime === right.localTime &&
    left.timezone === right.timezone
  );
}

export function isSameDraft(
  draft: ReminderDraft,
  configuration: CalendarRoomReminderConfiguration | undefined,
  option: CalendarRoomReminderAlarmOption,
): boolean {
  if (draft.destination === 'off') return configuration === undefined;
  if (!configuration) return false;
  const sameTarget =
    draft.destination === configuration.target.kind &&
    (draft.destination !== 'users' ||
      (configuration.target.kind === 'users' &&
        sameStrings(draft.userIds, configuration.target.userIds)));
  const validSchedule = validateAllDayDraft(draft.allDaySchedule);
  const sameSchedule = option.requiresAllDaySchedule
    ? validSchedule !== null &&
      JSON.stringify(validSchedule) ===
        JSON.stringify(configuration.allDaySchedule)
    : configuration.allDaySchedule === null;
  return sameTarget && sameSchedule && draft.departedUserIds.length === 0;
}

function sameStrings(
  left: readonly string[],
  right: readonly string[],
): boolean {
  const leftSorted = [...left].sort();
  const rightSorted = [...right].sort();
  return (
    leftSorted.length === rightSorted.length &&
    leftSorted.every((value, index) => value === rightSorted[index])
  );
}

export function canSaveDraft(
  draft: ReminderDraft,
  option: CalendarRoomReminderAlarmOption,
): boolean {
  if (draft.destination === 'users') {
    if (draft.userIds.length === 0 || draft.userIds.length > 50) {
      return false;
    }
  }
  return (
    !option.requiresAllDaySchedule ||
    draft.destination === 'off' ||
    validateAllDayDraft(draft.allDaySchedule) !== null
  );
}

export function validateAllDayDraft(
  schedule: CalendarRoomReminderAllDaySchedule,
): CalendarRoomReminderAllDaySchedule | null {
  if (
    !Number.isSafeInteger(schedule.daysBefore) ||
    schedule.daysBefore < 0 ||
    schedule.daysBefore > 366 ||
    !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(schedule.localTime) ||
    !isValidRoomReminderTimezone(schedule.timezone)
  ) {
    return null;
  }
  return { ...schedule };
}

export function isValidRoomReminderTimezone(timezone: string): boolean {
  if (
    timezone.trim() !== timezone ||
    timezone.length === 0 ||
    timezone.length > 64
  ) {
    return false;
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export function reminderOptionKey(
  option: CalendarRoomReminderIdentity,
): string {
  return JSON.stringify([
    option.eventUid,
    option.alarmUid,
    option.recurrenceId,
  ]);
}
