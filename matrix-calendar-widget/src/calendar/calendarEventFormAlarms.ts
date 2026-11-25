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
  CalendarEvent,
  CalendarEventDisplayAlarm,
} from '@matrix-calendar-widget/calendar';
import { DateTime } from 'luxon';
import type {
  CalendarEventFormValues,
  CalendarEventValidationError,
} from './calendarEventForm';

export function emptyAlarmFormValues(): Pick<
  CalendarEventFormValues,
  | 'alarmEnabled'
  | 'alarmMode'
  | 'alarmUtcDateTime'
  | 'alarmWeeks'
  | 'alarmDays'
  | 'alarmHours'
  | 'alarmMinutes'
  | 'alarmSeconds'
  | 'alarmEditable'
  | 'alarmChanged'
> {
  return {
    alarmEnabled: false,
    alarmMode: 'relative',
    alarmUtcDateTime: '',
    alarmWeeks: '0',
    alarmDays: '0',
    alarmHours: '0',
    alarmMinutes: '15',
    alarmSeconds: '0',
    alarmEditable: true,
    alarmChanged: false,
  };
}

export function alarmFormValues(
  event: CalendarEvent,
): Pick<
  CalendarEventFormValues,
  | 'alarmEnabled'
  | 'alarmMode'
  | 'alarmUtcDateTime'
  | 'alarmWeeks'
  | 'alarmDays'
  | 'alarmHours'
  | 'alarmMinutes'
  | 'alarmSeconds'
  | 'alarmEditable'
  | 'alarmDisabledReason'
  | 'alarmChanged'
> {
  if (event.unsupportedAlarm) {
    return {
      ...emptyAlarmFormValues(),
      alarmEditable: false,
      alarmDisabledReason: 'unsupported',
    };
  }

  const trigger = event.alarm?.trigger;
  const absolute = trigger && 'type' in trigger ? trigger : undefined;
  return {
    ...emptyAlarmFormValues(),
    alarmEnabled: trigger !== undefined,
    alarmMode: absolute ? 'absolute' : 'relative',
    alarmUtcDateTime: absolute?.value ?? '',
    alarmWeeks: trigger && !('type' in trigger) ? String(trigger.weeks) : '0',
    alarmDays: trigger && !('type' in trigger) ? String(trigger.days) : '0',
    alarmHours: trigger && !('type' in trigger) ? String(trigger.hours) : '0',
    alarmMinutes:
      trigger && !('type' in trigger) ? String(trigger.minutes) : '15',
    alarmSeconds:
      trigger && !('type' in trigger) ? String(trigger.seconds) : '0',
  };
}

export function alarmFromForm(
  values: CalendarEventFormValues,
): CalendarEventDisplayAlarm {
  if (values.alarmMode === 'absolute') {
    return {
      action: 'display',
      trigger: {
        type: 'absolute',
        value: values.alarmUtcDateTime?.trim() ?? '',
      },
    };
  }

  return {
    action: 'display',
    trigger: {
      weeks: Number(values.alarmWeeks ?? '0'),
      days: Number(values.alarmDays ?? '0'),
      hours: Number(values.alarmHours ?? '0'),
      minutes: Number(values.alarmMinutes ?? '0'),
      seconds: Number(values.alarmSeconds ?? '0'),
    },
  };
}

export function validateAlarm(
  values: CalendarEventFormValues,
): CalendarEventValidationError | undefined {
  if (!values.alarmEnabled || values.alarmEditable === false) {
    return undefined;
  }

  if (values.alarmMode === 'absolute') {
    const value = values.alarmUtcDateTime ?? '';
    const parsed = DateTime.fromISO(value, { setZone: true });
    if (
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value) ||
      !parsed.isValid ||
      parsed.offset !== 0 ||
      parsed.toUTC().toFormat("yyyy-MM-dd'T'HH:mm:ss'Z'") !== value
    ) {
      return 'invalid-alarm-utc';
    }
    return undefined;
  }

  const units = [
    values.alarmWeeks ?? '0',
    values.alarmDays ?? '0',
    values.alarmHours ?? '0',
    values.alarmMinutes ?? '0',
    values.alarmSeconds ?? '0',
  ];
  const parsed = units.map((value) => Number(value));
  if (
    units.some(
      (value, index) =>
        !/^\d+$/.test(value) || !Number.isSafeInteger(parsed[index]),
    ) ||
    parsed.every((value) => value === 0) ||
    (parsed[0] > 0 && parsed.slice(1).some((value) => value > 0))
  ) {
    return 'invalid-alarm';
  }

  return undefined;
}
