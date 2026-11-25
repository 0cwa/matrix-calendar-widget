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

import { CalendarRepositoryError } from '@matrix-calendar-widget/calendar';
import type {
  CalendarRoomReminderAlarmOption,
  CalendarRoomReminderAllDaySchedule,
  CalendarRoomReminderConfiguration,
  CalendarRoomReminderIdentity,
  CalendarRoomReminderRecipient,
  CalendarRoomReminderTarget,
} from './CalendarRoomReminderRepository';
import {
  containsControlCharacters,
  isBoundedString,
} from './gatewayParserUtils';

export function parseRoomReminderOptions(
  value: unknown,
): CalendarRoomReminderAlarmOption[] {
  if (
    !value ||
    typeof value !== 'object' ||
    !('options' in value) ||
    !Array.isArray(value.options) ||
    value.options.length > 64
  ) {
    throw invalidRoomReminderResponse();
  }

  return value.options.map((candidate) => {
    if (
      !candidate ||
      typeof candidate !== 'object' ||
      Object.keys(candidate).some(
        (key) =>
          ![
            'eventUid',
            'recurrenceId',
            'alarmUid',
            'timingType',
            'supported',
            'requiresAllDaySchedule',
            'unavailableReason',
            'relatedTo',
            'trigger',
            'repeat',
          ].includes(key),
      ) ||
      !('eventUid' in candidate) ||
      !isBoundedString(candidate.eventUid, 255) ||
      candidate.eventUid.trim() !== candidate.eventUid ||
      !('recurrenceId' in candidate) ||
      !(
        candidate.recurrenceId === null ||
        isBoundedString(candidate.recurrenceId, 4096)
      ) ||
      !('alarmUid' in candidate) ||
      !isBoundedString(candidate.alarmUid, 255) ||
      !('timingType' in candidate) ||
      !['timed', 'all-day', 'unsupported'].includes(
        String(candidate.timingType),
      ) ||
      !('supported' in candidate) ||
      typeof candidate.supported !== 'boolean' ||
      !('requiresAllDaySchedule' in candidate) ||
      typeof candidate.requiresAllDaySchedule !== 'boolean' ||
      ('unavailableReason' in candidate &&
        candidate.unavailableReason !== undefined &&
        ![
          'unsupported-timezone',
          'unsupported-event-timing',
          'absolute-trigger',
          'unsupported-trigger',
        ].includes(String(candidate.unavailableReason))) ||
      ('relatedTo' in candidate &&
        candidate.relatedTo !== undefined &&
        candidate.relatedTo !== 'start' &&
        candidate.relatedTo !== 'end')
    ) {
      throw invalidRoomReminderResponse();
    }

    const trigger =
      'trigger' in candidate && candidate.trigger !== undefined
        ? parseReminderDuration(candidate.trigger)
        : undefined;
    const relatedTo =
      candidate.relatedTo === 'start' || candidate.relatedTo === 'end'
        ? candidate.relatedTo
        : undefined;
    let repeat: CalendarRoomReminderAlarmOption['repeat'];
    if ('repeat' in candidate && candidate.repeat !== undefined) {
      const rawRepeat = candidate.repeat;
      if (
        !rawRepeat ||
        typeof rawRepeat !== 'object' ||
        !('count' in rawRepeat) ||
        !Number.isSafeInteger(rawRepeat.count) ||
        (rawRepeat.count as number) <= 0 ||
        !('interval' in rawRepeat)
      ) {
        throw invalidRoomReminderResponse();
      }
      const interval = parseReminderDuration(rawRepeat.interval);
      if (
        interval.isNegative ||
        interval.weeks +
          interval.days +
          interval.hours +
          interval.minutes +
          interval.seconds ===
          0
      ) {
        throw invalidRoomReminderResponse();
      }
      repeat = { count: rawRepeat.count as number, interval };
    }

    if (
      (candidate.supported && (!trigger || !relatedTo)) ||
      (candidate.supported && candidate.unavailableReason !== undefined) ||
      (candidate.timingType === 'all-day' &&
        candidate.supported &&
        candidate.requiresAllDaySchedule !== true) ||
      (candidate.timingType === 'timed' &&
        candidate.requiresAllDaySchedule === true) ||
      (!candidate.supported && candidate.unavailableReason === undefined)
    ) {
      throw invalidRoomReminderResponse();
    }

    return {
      eventUid: candidate.eventUid,
      recurrenceId: candidate.recurrenceId as string | null,
      alarmUid: candidate.alarmUid,
      timingType:
        candidate.timingType as CalendarRoomReminderAlarmOption['timingType'],
      supported: candidate.supported,
      requiresAllDaySchedule: candidate.requiresAllDaySchedule,
      ...(candidate.unavailableReason === undefined
        ? {}
        : {
            unavailableReason: candidate.unavailableReason as NonNullable<
              CalendarRoomReminderAlarmOption['unavailableReason']
            >,
          }),
      ...(relatedTo ? { relatedTo } : {}),
      ...(trigger ? { trigger } : {}),
      ...(repeat ? { repeat } : {}),
    };
  });
}

export function parseRoomReminderConfigurationPage(value: unknown): {
  items: CalendarRoomReminderConfiguration[];
  nextCursor?: string;
} {
  if (
    !value ||
    typeof value !== 'object' ||
    !('items' in value) ||
    !Array.isArray(value.items) ||
    value.items.length > 100
  ) {
    throw invalidRoomReminderResponse();
  }
  const items = value.items.map(parseRoomReminderConfiguration);
  let nextCursor: string | undefined;
  if ('nextCursor' in value && value.nextCursor !== undefined) {
    if (!isBoundedString(value.nextCursor, 16384)) {
      throw invalidRoomReminderResponse();
    }
    nextCursor = value.nextCursor;
  }
  return { items, ...(nextCursor ? { nextCursor } : {}) };
}

export function parseRoomReminderRecipients(
  value: unknown,
): CalendarRoomReminderRecipient[] {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    !('recipients' in value) ||
    !Array.isArray(value.recipients) ||
    value.recipients.length > 20_000
  ) {
    throw invalidRoomReminderResponse();
  }

  const seen = new Set<string>();
  return value.recipients.map((recipient) => {
    if (
      !recipient ||
      typeof recipient !== 'object' ||
      Array.isArray(recipient) ||
      Object.keys(recipient).length !== 2 ||
      !('userId' in recipient) ||
      typeof recipient.userId !== 'string' ||
      !/^@[^\s:#?]+:[^\s?#]+$/.test(recipient.userId) ||
      seen.has(recipient.userId) ||
      !('displayName' in recipient) ||
      !isNormalizedReminderDisplayName(recipient.displayName)
    ) {
      throw invalidRoomReminderResponse();
    }
    seen.add(recipient.userId);
    return {
      userId: recipient.userId,
      displayName: recipient.displayName,
    };
  });
}

function isNormalizedReminderDisplayName(
  value: unknown,
): value is string | null {
  if (value === null) return true;
  if (typeof value !== 'string' || Array.from(value).length > 256) return false;
  return (
    value.length > 0 &&
    !containsControlCharacters(value) &&
    value === value.normalize('NFC').replace(/\s+/g, ' ').trim()
  );
}

function parseRoomReminderIdentity(
  value: unknown,
): CalendarRoomReminderIdentity {
  if (
    !value ||
    typeof value !== 'object' ||
    !('eventUid' in value) ||
    !isBoundedString(value.eventUid, 255) ||
    value.eventUid.trim() !== value.eventUid ||
    !('recurrenceId' in value) ||
    !(
      value.recurrenceId === null || isBoundedString(value.recurrenceId, 4096)
    ) ||
    !('alarmUid' in value) ||
    !isBoundedString(value.alarmUid, 255)
  ) {
    throw invalidRoomReminderResponse();
  }
  return {
    eventUid: value.eventUid,
    recurrenceId: value.recurrenceId as string | null,
    alarmUid: value.alarmUid,
  };
}

export function parseRoomReminderConfiguration(
  value: unknown,
): CalendarRoomReminderConfiguration {
  const identity = parseRoomReminderIdentity(value);
  if (!value || typeof value !== 'object') throw invalidRoomReminderResponse();
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).some(
      (key) =>
        ![
          'eventUid',
          'recurrenceId',
          'alarmUid',
          'target',
          'allDaySchedule',
          'revision',
        ].includes(key),
    )
  ) {
    throw invalidRoomReminderResponse();
  }
  const target =
    record.target === undefined
      ? { kind: 'room' as const }
      : parseRoomReminderTarget(record.target);
  const allDaySchedule =
    record.allDaySchedule === undefined || record.allDaySchedule === null
      ? null
      : parseAllDayReminderSchedule(record.allDaySchedule);
  const revision = record.revision === undefined ? 1 : record.revision;
  if (!Number.isSafeInteger(revision) || (revision as number) < 1) {
    throw invalidRoomReminderResponse();
  }
  return {
    ...identity,
    target,
    allDaySchedule,
    revision: revision as number,
  };
}

function parseRoomReminderTarget(value: unknown): CalendarRoomReminderTarget {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidRoomReminderResponse();
  }
  const record = value as Record<string, unknown>;
  if (record.kind === 'room' && Object.keys(record).length === 1) {
    return { kind: 'room' };
  }
  if (
    record.kind !== 'users' ||
    Object.keys(record).length !== 2 ||
    !Array.isArray(record.userIds) ||
    record.userIds.length === 0 ||
    record.userIds.length > 50 ||
    record.userIds.some(
      (userId) =>
        typeof userId !== 'string' ||
        userId.length > 255 ||
        !/^@[^:\s?#]+:[^\s?#]+$/.test(userId),
    ) ||
    new Set(record.userIds).size !== record.userIds.length
  ) {
    throw invalidRoomReminderResponse();
  }
  return {
    kind: 'users',
    userIds: [...(record.userIds as string[])].sort(),
  };
}

function parseAllDayReminderSchedule(
  value: unknown,
): CalendarRoomReminderAllDaySchedule {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidRoomReminderResponse();
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 3 ||
    !Number.isSafeInteger(record.daysBefore) ||
    (record.daysBefore as number) < 0 ||
    (record.daysBefore as number) > 366 ||
    typeof record.localTime !== 'string' ||
    !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(record.localTime) ||
    typeof record.timezone !== 'string' ||
    record.timezone.length === 0 ||
    record.timezone.length > 64
  ) {
    throw invalidRoomReminderResponse();
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: record.timezone });
  } catch {
    throw invalidRoomReminderResponse();
  }
  return {
    daysBefore: record.daysBefore as number,
    localTime: record.localTime,
    timezone: record.timezone,
  };
}

function parseReminderDuration(
  value: unknown,
): NonNullable<CalendarRoomReminderAlarmOption['trigger']> {
  if (
    !value ||
    typeof value !== 'object' ||
    !('weeks' in value) ||
    !isNonnegativeSafeInteger(value.weeks) ||
    !('days' in value) ||
    !isNonnegativeSafeInteger(value.days) ||
    !('hours' in value) ||
    !isNonnegativeSafeInteger(value.hours) ||
    !('minutes' in value) ||
    !isNonnegativeSafeInteger(value.minutes) ||
    !('seconds' in value) ||
    !isNonnegativeSafeInteger(value.seconds) ||
    !('isNegative' in value) ||
    typeof value.isNegative !== 'boolean'
  ) {
    throw invalidRoomReminderResponse();
  }
  return {
    weeks: value.weeks,
    days: value.days,
    hours: value.hours,
    minutes: value.minutes,
    seconds: value.seconds,
    isNegative: value.isNegative,
  };
}

function isNonnegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function invalidRoomReminderResponse(): CalendarRepositoryError {
  return new CalendarRepositoryError(
    'request-failed',
    'Room reminder settings are unavailable',
  );
}
