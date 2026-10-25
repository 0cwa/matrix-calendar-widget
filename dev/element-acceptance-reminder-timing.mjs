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
  calendarLocalDateTimeToUnixMillis,
  calendarUnixMillisToLocalDateTime,
  isCalendarLocalDateTimeUnambiguous,
} from '@matrix-calendar-widget/calendar';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const REMINDER_START_LEAD_MS = 150_000;
const REMINDER_EVENT_DURATION_MS = HOUR_MS;
const REMINDER_EVENT_RANGE_SEARCH_MS = 48 * HOUR_MS;
const REMINDER_ALL_DAY_EXPECTED_DAYS_BEFORE = 1;

export function reminderFixtureLocalDateTimeInput(epochMilliseconds, timeZone) {
  return calendarUnixMillisToLocalDateTime(epochMilliseconds, timeZone).slice(
    0,
    16,
  );
}

export function reminderFixtureLocalDateTimeToUnixMillis(
  localDateTime,
  timeZone,
) {
  try {
    return uniqueFormInstant(localDateTime, timeZone);
  } catch {
    return undefined;
  }
}

export function reminderFixtureAllDayExpectedScheduleMatches({
  allDay,
  expectedDueAt,
  eventStartDate,
  daysBefore,
  localTime,
  timeZone,
}) {
  if (!allDay || expectedDueAt === undefined) {
    return true;
  }

  if (
    !/^\d{4}-\d{2}-\d{2}$/u.test(eventStartDate) ||
    !Number.isSafeInteger(daysBefore) ||
    !/^\d{2}:\d{2}$/u.test(localTime)
  ) {
    return false;
  }

  let expectedScheduleLocalDateTime;
  try {
    expectedScheduleLocalDateTime = reminderFixtureLocalDateTimeInput(
      expectedDueAt,
      timeZone,
    );
  } catch {
    return false;
  }

  const expectedDaysBefore = calendarDaysBetween(
    eventStartDate,
    expectedScheduleLocalDateTime.slice(0, 10),
  );
  return (
    Number.isSafeInteger(expectedDaysBefore) &&
    daysBefore === expectedDaysBefore &&
    localTime === expectedScheduleLocalDateTime.slice(11, 16)
  );
}

export function planReminderTimedEvent(nowMilliseconds, timeZone) {
  const dueAt = reminderDueAt(nowMilliseconds);
  const firstStartAt = dueAt + MINUTE_MS;
  const finalStartAt = firstStartAt + REMINDER_EVENT_RANGE_SEARCH_MS;

  for (
    let startAt = firstStartAt;
    startAt <= finalStartAt;
    startAt += MINUTE_MS
  ) {
    const endAt = startAt + REMINDER_EVENT_DURATION_MS;
    const startValue = reminderFixtureLocalDateTimeInput(startAt, timeZone);
    const endValue = reminderFixtureLocalDateTimeInput(endAt, timeZone);

    if (
      uniqueFormInstant(startValue, timeZone) !== startAt ||
      uniqueFormInstant(endValue, timeZone) !== endAt
    ) {
      continue;
    }

    const alarmLeadMinutes = (startAt - dueAt) / MINUTE_MS;
    if (!Number.isSafeInteger(alarmLeadMinutes) || alarmLeadMinutes < 1) {
      continue;
    }

    return {
      dueAt,
      startAt,
      endAt,
      startValue,
      endValue,
      alarmLeadMinutes,
    };
  }

  throw new Error(
    'Reminder acceptance could not plan a representable timed event',
  );
}

export function planReminderAllDayEvent(nowMilliseconds, timeZone) {
  const dueAt = reminderDueAt(nowMilliseconds);
  const scheduleLocalDateTime = reminderFixtureLocalDateTimeInput(
    dueAt,
    timeZone,
  );
  if (uniqueFormInstant(scheduleLocalDateTime, timeZone) !== dueAt) {
    throw new Error(
      'Reminder acceptance could not plan an unambiguous all-day schedule',
    );
  }

  const expectedDaysBefore = REMINDER_ALL_DAY_EXPECTED_DAYS_BEFORE;
  const eventStartDate = addCalendarDays(
    scheduleLocalDateTime.slice(0, 10),
    expectedDaysBefore,
  );
  return {
    dueAt,
    timeZone,
    scheduleLocalDateTime,
    expectedDaysBefore,
    eventStartDate,
    eventEndDate: eventStartDate,
  };
}

export function planReminderAllDaySchedule(
  nowMilliseconds,
  eventStartDate,
  timeZone,
) {
  const dueAt = reminderDueAt(nowMilliseconds);
  const scheduleLocalDateTime = reminderFixtureLocalDateTimeInput(
    dueAt,
    timeZone,
  );
  if (uniqueFormInstant(scheduleLocalDateTime, timeZone) !== dueAt) {
    throw new Error(
      'Reminder acceptance could not plan an unambiguous all-day schedule',
    );
  }

  const scheduledDate = scheduleLocalDateTime.slice(0, 10);
  const daysBefore = calendarDaysBetween(eventStartDate, scheduledDate);
  if (!Number.isSafeInteger(daysBefore) || daysBefore < 0 || daysBefore > 1) {
    throw new Error(
      'Reminder acceptance all-day schedule is outside its fixture date range',
    );
  }

  const localTime = scheduleLocalDateTime.slice(11, 16);
  const expectedScheduleDate = addCalendarDays(eventStartDate, -daysBefore);
  const reconstructedDueAt = uniqueFormInstant(
    `${expectedScheduleDate}T${localTime}`,
    timeZone,
  );
  if (expectedScheduleDate !== scheduledDate || reconstructedDueAt !== dueAt) {
    throw new Error(
      'Reminder acceptance all-day schedule does not match its event date',
    );
  }

  return {
    dueAt,
    timeZone,
    daysBefore,
    localTime,
    scheduleLocalDateTime,
    eventStartDate,
  };
}

function reminderDueAt(nowMilliseconds) {
  if (!Number.isFinite(nowMilliseconds)) {
    throw new TypeError('Reminder acceptance clock is invalid');
  }
  return (
    Math.ceil((nowMilliseconds + REMINDER_START_LEAD_MS) / MINUTE_MS) *
    MINUTE_MS
  );
}

function uniqueFormInstant(localDateTime, timeZone) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(localDateTime)) {
    return undefined;
  }
  try {
    if (!isCalendarLocalDateTimeUnambiguous(localDateTime, timeZone)) {
      return undefined;
    }
    const instant = calendarLocalDateTimeToUnixMillis(localDateTime, timeZone);
    return reminderFixtureLocalDateTimeInput(instant, timeZone) ===
      localDateTime
      ? instant
      : undefined;
  } catch {
    return undefined;
  }
}

function addCalendarDays(date, days) {
  const [year, month, day] = date.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return [
    String(next.getUTCFullYear()).padStart(4, '0'),
    String(next.getUTCMonth() + 1).padStart(2, '0'),
    String(next.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

function calendarDaysBetween(laterDate, earlierDate) {
  const later = Date.parse(`${laterDate}T00:00:00Z`);
  const earlier = Date.parse(`${earlierDate}T00:00:00Z`);
  return (later - earlier) / (24 * HOUR_MS);
}
