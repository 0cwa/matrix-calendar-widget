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
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Put,
  UseGuards,
} from '@nestjs/common';
import { UserContextParam } from '../decorator/UserContextParam';
import { MatrixAuthGuard } from '../guard/MatrixAuthGuard';
import { MatrixRoomMembershipGuard } from '../guard/MatrixRoomMembershipGuard';
import { IUserContext } from '../model/IUserContext';
import {
  RoomReminderConfigurationService,
  RoomReminderIdentity,
} from '../service/RoomReminderConfigurationService';

@Controller({
  path: 'calendar/rooms/:roomId/reminders',
  version: ['1'],
})
@UseGuards(MatrixAuthGuard, MatrixRoomMembershipGuard)
export class RoomReminderConfigurationController {
  constructor(
    private readonly reminderConfiguration: RoomReminderConfigurationService,
  ) {}

  @Get()
  list(
    @UserContextParam() userContext: IUserContext,
    @Param('roomId') roomId: string,
  ) {
    return this.reminderConfiguration.list(userContext.userId, roomId);
  }

  @Put()
  put(
    @UserContextParam() userContext: IUserContext,
    @Param('roomId') roomId: string,
    @Body() input: unknown,
  ) {
    return this.reminderConfiguration.put(
      userContext.userId,
      roomId,
      parseRoomReminderIdentity(input),
    );
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @UserContextParam() userContext: IUserContext,
    @Param('roomId') roomId: string,
    @Body() input: unknown,
  ): Promise<void> {
    await this.reminderConfiguration.delete(
      userContext.userId,
      roomId,
      parseRoomReminderIdentity(input),
    );
  }
}

export function parseRoomReminderIdentity(
  input: unknown,
): RoomReminderIdentity {
  if (
    input === null ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.getPrototypeOf(input) !== Object.prototype
  ) {
    throw new BadRequestException('reminder identity must be an object');
  }

  const record = input as Record<string, unknown>;
  const keys = Reflect.ownKeys(record);
  if (
    keys.length !== 3 ||
    !keys.includes('eventUid') ||
    !keys.includes('recurrenceId') ||
    !keys.includes('alarmUid')
  ) {
    throw new BadRequestException(
      'reminder identity must contain eventUid, recurrenceId, and alarmUid only',
    );
  }

  if (!isValidIdentityString(record.eventUid)) {
    throw new BadRequestException('eventUid is invalid');
  }
  if (!isValidIdentityString(record.alarmUid)) {
    throw new BadRequestException('alarmUid is invalid');
  }
  if (
    record.recurrenceId !== null &&
    !isValidRecurrenceId(record.recurrenceId)
  ) {
    throw new BadRequestException('recurrenceId is invalid');
  }

  return {
    eventUid: record.eventUid,
    recurrenceId: record.recurrenceId as string | null,
    alarmUid: record.alarmUid,
  };
}

function isValidIdentityString(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 255 &&
    value.trim() === value &&
    !containsControlCharacters(value)
  );
}

function isValidRecurrenceId(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 1024 ||
    value.trim() !== value ||
    containsControlCharacters(value)
  ) {
    return false;
  }

  let identity: unknown;
  try {
    identity = JSON.parse(value);
  } catch {
    return false;
  }
  if (!Array.isArray(identity) || JSON.stringify(identity) !== value) {
    return false;
  }
  if (
    identity.length === 2 &&
    identity[0] === 'date' &&
    typeof identity[1] === 'string'
  ) {
    return isValidCalendarDate(identity[1]);
  }
  if (
    identity.length !== 4 ||
    identity[0] !== 'date-time' ||
    !['floating', 'utc', 'tzid'].includes(identity[1]) ||
    typeof identity[2] !== 'string' ||
    typeof identity[3] !== 'string' ||
    !isValidLocalDateTime(identity[3])
  ) {
    return false;
  }
  return identity[1] === 'tzid'
    ? identity[2].length > 0 &&
        identity[2].length <= 255 &&
        !containsControlCharacters(identity[2])
    : identity[2] === '';
}

function isValidCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

function isValidLocalDateTime(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/u.test(value) &&
    isValidCalendarDate(value.slice(0, 10)) &&
    Number(value.slice(11, 13)) <= 23 &&
    Number(value.slice(14, 16)) <= 59 &&
    (value.length < 19 || Number(value.slice(17, 19)) <= 59)
  );
}

function containsControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 0x1f || code === 0x7f;
  });
}
