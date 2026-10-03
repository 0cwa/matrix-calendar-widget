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

import { BadRequestException } from '@nestjs/common';
import type { RoomReminderConfiguration } from './RoomReminderStore';

export const MAX_ROOM_REMINDER_CONFIGURATION_PAGE_SIZE = 100;
export const DEFAULT_ROOM_REMINDER_CONFIGURATION_PAGE_SIZE = 50;
const MAX_CURSOR_LENGTH = 16384;

export type RoomReminderConfigurationIdentity = Pick<
  RoomReminderConfiguration,
  'eventUid' | 'recurrenceId' | 'alarmUid'
>;

export type RoomReminderConfigurationCursor =
  RoomReminderConfigurationIdentity & {
    roomId: string;
    calendarId: string;
    version: 1;
  };

export type RoomReminderConfigurationUpsertInput = {
  eventId: string;
  recurrenceId: string | null;
  alarmUid: string;
};

export function parseReminderConfigurationUpsertInput(
  input: unknown,
): RoomReminderConfigurationUpsertInput {
  const record = plainRecordWithKeys(input, [
    'eventId',
    'recurrenceId',
    'alarmUid',
  ]);
  const eventId = parseReminderConfigurationEventId(record.eventId);
  if (
    !isValidIdentity(record.alarmUid) ||
    !isValidRecurrenceId(record.recurrenceId)
  ) {
    throw invalidRequest();
  }

  return {
    eventId,
    recurrenceId: record.recurrenceId,
    alarmUid: record.alarmUid,
  };
}

/** Validate one opaque direct `.ics` resource URL without trusting its base. */
export function parseReminderConfigurationEventId(value: unknown): string {
  if (!isValidEventId(value)) throw invalidRequest();
  return value;
}

export function parseReminderConfigurationDeleteInput(
  input: unknown,
): RoomReminderConfigurationIdentity {
  const record = plainRecordWithKeys(input, [
    'eventUid',
    'recurrenceId',
    'alarmUid',
  ]);
  if (
    !isValidIdentity(record.eventUid) ||
    !isValidIdentity(record.alarmUid) ||
    !isValidRecurrenceId(record.recurrenceId)
  ) {
    throw invalidRequest();
  }

  return {
    eventUid: record.eventUid,
    recurrenceId: record.recurrenceId,
    alarmUid: record.alarmUid,
  };
}

export function parseReminderConfigurationPageSize(value: unknown): number {
  if (value === undefined) {
    return DEFAULT_ROOM_REMINDER_CONFIGURATION_PAGE_SIZE;
  }
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,2}$/.test(value)) {
    throw invalidRequest();
  }
  const pageSize = Number(value);
  if (pageSize > MAX_ROOM_REMINDER_CONFIGURATION_PAGE_SIZE) {
    throw invalidRequest();
  }
  return pageSize;
}

export function parseReminderConfigurationCursor(
  token: unknown,
): RoomReminderConfigurationCursor | undefined {
  if (token === undefined) return undefined;
  if (
    typeof token !== 'string' ||
    token.length === 0 ||
    token.length > MAX_CURSOR_LENGTH ||
    !/^[A-Za-z0-9_-]+$/.test(token)
  ) {
    throw invalidRequest();
  }

  let source: string;
  let parsed: unknown;
  try {
    const bytes = Buffer.from(token, 'base64url');
    if (bytes.toString('base64url') !== token)
      throw new Error('invalid cursor');
    source = bytes.toString('utf8');
    parsed = JSON.parse(source);
  } catch {
    throw invalidRequest();
  }

  const record = plainRecordWithKeys(parsed, [
    'version',
    'roomId',
    'calendarId',
    'eventUid',
    'recurrenceId',
    'alarmUid',
  ]);
  if (
    JSON.stringify(record) !== source ||
    record.version !== 1 ||
    !isValidIdentity(record.roomId) ||
    !isValidIdentity(record.calendarId) ||
    !isValidIdentity(record.eventUid) ||
    !isValidIdentity(record.alarmUid) ||
    !isValidRecurrenceId(record.recurrenceId)
  ) {
    throw invalidRequest();
  }

  return {
    version: 1,
    roomId: record.roomId,
    calendarId: record.calendarId,
    eventUid: record.eventUid,
    recurrenceId: record.recurrenceId,
    alarmUid: record.alarmUid,
  };
}

export function encodeReminderConfigurationCursor(
  roomId: string,
  calendarId: string,
  identity: RoomReminderConfigurationIdentity,
): string {
  return Buffer.from(
    JSON.stringify({
      version: 1,
      roomId,
      calendarId,
      eventUid: identity.eventUid,
      recurrenceId: identity.recurrenceId,
      alarmUid: identity.alarmUid,
    }),
    'utf8',
  ).toString('base64url');
}

export function assertReminderConfigurationIdentity(
  identity: RoomReminderConfigurationIdentity,
): void {
  if (
    !isValidIdentity(identity.eventUid) ||
    !isValidIdentity(identity.alarmUid) ||
    !isValidRecurrenceId(identity.recurrenceId)
  ) {
    throw invalidRequest();
  }
}

export function assertReminderConfigurationCursorScope(
  cursor: RoomReminderConfigurationCursor | undefined,
  roomId: string,
  calendarId: string,
): void {
  if (
    cursor !== undefined &&
    (cursor.roomId !== roomId || cursor.calendarId !== calendarId)
  ) {
    throw invalidRequest();
  }
}

function plainRecordWithKeys(
  value: unknown,
  expectedKeys: readonly string[],
): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw invalidRequest();
  }
  const record = value as Record<string, unknown>;
  const keys = Reflect.ownKeys(record);
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
  ) {
    throw invalidRequest();
  }
  return record;
}

function isValidEventId(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 2048 ||
    value.trim() !== value ||
    containsControlCharacters(value) ||
    /\s/.test(value)
  ) {
    return false;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    return false;
  }

  const rawLeaf = url.pathname.slice(url.pathname.lastIndexOf('/') + 1);
  let leaf: string;
  try {
    leaf = decodeURIComponent(rawLeaf);
  } catch {
    return false;
  }
  return (
    leaf.length > 0 &&
    leaf !== '.' &&
    leaf !== '..' &&
    Buffer.byteLength(leaf, 'utf8') <= 255 &&
    !/[\\/]/.test(leaf) &&
    !containsControlCharacters(leaf) &&
    !/%[0-9a-f]{2}/i.test(leaf) &&
    leaf.toLowerCase().endsWith('.ics')
  );
}

function isValidIdentity(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 255 &&
    value.trim() === value &&
    !containsControlCharacters(value)
  );
}

function isValidRecurrenceId(value: unknown): value is string | null {
  if (value === null) return true;
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 1024 ||
    value.trim() !== value ||
    containsControlCharacters(value)
  ) {
    return false;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return false;
  }
  if (!Array.isArray(parsed) || JSON.stringify(parsed) !== value) {
    return false;
  }
  if (
    parsed.length === 2 &&
    parsed[0] === 'date' &&
    typeof parsed[1] === 'string'
  ) {
    return isValidCalendarDate(parsed[1]);
  }
  if (
    parsed.length !== 4 ||
    parsed[0] !== 'date-time' ||
    !['floating', 'utc', 'tzid'].includes(parsed[1]) ||
    typeof parsed[2] !== 'string' ||
    typeof parsed[3] !== 'string' ||
    !isValidLocalDateTime(parsed[3])
  ) {
    return false;
  }
  return parsed[1] === 'tzid' ? isValidIdentity(parsed[2]) : parsed[2] === '';
}

function isValidCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match || Number(match[1]) < 1) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthLengths = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return day >= 1 && day <= monthLengths[month - 1];
}

function isValidLocalDateTime(value: string): boolean {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(value);
  return (
    match !== null &&
    isValidCalendarDate(match[1]) &&
    Number(match[2]) <= 23 &&
    Number(match[3]) <= 59 &&
    Number(match[4]) <= 59
  );
}

function containsControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 0x1f || code === 0x7f;
  });
}

function invalidRequest(): BadRequestException {
  return new BadRequestException({
    code: 'room-reminder-request-invalid',
    message: 'Room reminder request is invalid',
  });
}
