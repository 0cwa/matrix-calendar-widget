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
  CalendarEventDuration,
  CalendarEventId,
  CalendarId,
  CalendarRepository,
} from '@matrix-calendar-widget/calendar';

export type CalendarRoomReminderAlarmOption = {
  eventUid: string;
  recurrenceId: string | null;
  alarmUid: string;
  timingType: 'timed' | 'all-day' | 'unsupported';
  supported: boolean;
  requiresAllDaySchedule: boolean;
  unavailableReason?:
    | 'unsupported-timezone'
    | 'unsupported-event-timing'
    | 'absolute-trigger'
    | 'unsupported-trigger';
  relatedTo?: 'start' | 'end';
  trigger?: CalendarEventDuration;
  repeat?: {
    count: number;
    interval: CalendarEventDuration;
  };
};

export type CalendarRoomReminderIdentity = {
  eventUid: string;
  recurrenceId: string | null;
  alarmUid: string;
};

export type CalendarRoomReminderRecipient = Readonly<{
  userId: string;
  displayName: string | null;
}>;

export type CalendarRoomReminderTarget =
  | Readonly<{ kind: 'room' }>
  | Readonly<{ kind: 'users'; userIds: readonly string[] }>;

export type CalendarRoomReminderAllDaySchedule = Readonly<{
  daysBefore: number;
  localTime: string;
  timezone: string;
}>;

export type CalendarRoomReminderConfiguration = CalendarRoomReminderIdentity &
  Readonly<{
    target: CalendarRoomReminderTarget;
    allDaySchedule: CalendarRoomReminderAllDaySchedule | null;
    revision: number;
  }>;

export interface CalendarRoomReminderRepository {
  /** Complete current joined-member options for the bound room, when supported. */
  listRoomReminderRecipients?(): Promise<CalendarRoomReminderRecipient[]>;

  listRoomReminderAlarmOptions(
    calendarId: CalendarId,
    eventId: CalendarEventId,
  ): Promise<CalendarRoomReminderAlarmOption[]>;

  listRoomReminderConfigurations(): Promise<
    CalendarRoomReminderConfiguration[]
  >;

  enableRoomReminder(
    calendarId: CalendarId,
    eventId: CalendarEventId,
    alarmUid: string,
    recurrenceId: string | null,
    target: CalendarRoomReminderTarget,
    allDaySchedule: CalendarRoomReminderAllDaySchedule | null,
  ): Promise<CalendarRoomReminderConfiguration>;

  disableRoomReminder(identity: CalendarRoomReminderIdentity): Promise<void>;
}

export function isCalendarRoomReminderRepository(
  repository: CalendarRepository,
): repository is CalendarRepository & CalendarRoomReminderRepository {
  return (
    'listRoomReminderAlarmOptions' in repository &&
    typeof repository.listRoomReminderAlarmOptions === 'function' &&
    'listRoomReminderConfigurations' in repository &&
    typeof repository.listRoomReminderConfigurations === 'function' &&
    'enableRoomReminder' in repository &&
    typeof repository.enableRoomReminder === 'function' &&
    'disableRoomReminder' in repository &&
    typeof repository.disableRoomReminder === 'function'
  );
}
