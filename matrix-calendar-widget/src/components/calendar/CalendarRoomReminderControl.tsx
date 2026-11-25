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
  CalendarEventId,
  CalendarEventTiming,
  CalendarId,
} from '@matrix-calendar-widget/calendar';
import { CalendarRoomReminderPicker } from './CalendarRoomReminderPicker';
import { useRoomReminderSettings } from './useRoomReminderSettings';

type CalendarRoomReminderControlProps = {
  calendarId: CalendarId;
  eventId: CalendarEventId;
  eventUid: string;
  roomId?: string;
  calendarTimezone?: string;
  popperContainer?: () => HTMLElement | null;
  eventTiming: CalendarEventTiming;
  isRecurringSeries: boolean;
  openRequest?: number;
  refreshToken: number;
  canManageReminders: boolean;
  onEditCalendarReminder: () => void;
};

export function CalendarRoomReminderControl({
  calendarId,
  eventId,
  eventUid,
  roomId,
  calendarTimezone,
  popperContainer,
  eventTiming,
  isRecurringSeries,
  openRequest = 0,
  refreshToken,
  canManageReminders,
  onEditCalendarReminder,
}: CalendarRoomReminderControlProps) {
  const settings = useRoomReminderSettings({
    calendarId,
    eventId,
    eventUid,
    roomId,
    calendarTimezone,
    eventTiming,
    isRecurringSeries,
    openRequest,
    refreshToken,
    canManageReminders,
  });
  if (!canManageReminders || !settings.reminderRepository) return null;
  return (
    <CalendarRoomReminderPicker
      {...settings}
      calendarTimezone={calendarTimezone}
      eventTiming={eventTiming}
      isRecurringSeries={isRecurringSeries}
      onEditCalendarReminder={onEditCalendarReminder}
      popperContainer={popperContainer}
    />
  );
}
