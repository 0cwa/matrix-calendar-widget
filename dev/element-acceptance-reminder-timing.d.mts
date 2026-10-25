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

export type ReminderTimedEventPlan = Readonly<{
  dueAt: number;
  startAt: number;
  endAt: number;
  startValue: string;
  endValue: string;
  alarmLeadMinutes: number;
}>;

export type ReminderAllDayEventPlan = Readonly<{
  dueAt: number;
  timeZone: string;
  scheduleLocalDateTime: string;
  expectedDaysBefore: number;
  eventStartDate: string;
  /** Inclusive DATE value displayed by the event form. */
  eventEndDate: string;
}>;

export type ReminderAllDaySchedulePlan = Readonly<{
  dueAt: number;
  timeZone: string;
  daysBefore: number;
  localTime: string;
  scheduleLocalDateTime: string;
  eventStartDate: string;
}>;

export function reminderFixtureLocalDateTimeInput(
  epochMilliseconds: number,
  timeZone: string,
): string;

export function reminderFixtureLocalDateTimeToUnixMillis(
  localDateTime: string,
  timeZone: string,
): number | undefined;

export function planReminderTimedEvent(
  nowMilliseconds: number,
  timeZone: string,
): ReminderTimedEventPlan;

export function planReminderAllDayEvent(
  nowMilliseconds: number,
  timeZone: string,
): ReminderAllDayEventPlan;

export function planReminderAllDaySchedule(
  nowMilliseconds: number,
  eventStartDate: string,
  timeZone: string,
): ReminderAllDaySchedulePlan;
