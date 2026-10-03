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
  Controller,
  Get,
  Header,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserContextParam } from '../decorator/UserContextParam';
import { MatrixAuthGuard } from '../guard/MatrixAuthGuard';
import { MatrixRoomMembershipGuard } from '../guard/MatrixRoomMembershipGuard';
import { IUserContext } from '../model/IUserContext';
import { RoomReminderAlarmOptionsService } from '../reminder/RoomReminderAlarmOptionsService';
import { parseReminderConfigurationEventId } from '../reminder/RoomReminderConfigurationContract';

@Controller({
  path: 'calendar/rooms/:roomId/reminders',
  version: ['1'],
})
@UseGuards(MatrixAuthGuard, MatrixRoomMembershipGuard)
export class RoomReminderAlarmOptionsController {
  constructor(private readonly options: RoomReminderAlarmOptionsService) {}

  @Get('options')
  @Header('Cache-Control', 'no-store')
  list(
    @UserContextParam() userContext: IUserContext,
    @Param('roomId') roomId: string,
    @Query() query: unknown,
  ) {
    const eventId = parseAlarmOptionsQuery(query);
    return this.options.list(userContext?.userId, roomId, eventId);
  }
}

function parseAlarmOptionsQuery(query: unknown): string {
  if (
    query === null ||
    typeof query !== 'object' ||
    Array.isArray(query) ||
    (Object.getPrototypeOf(query) !== Object.prototype &&
      Object.getPrototypeOf(query) !== null)
  ) {
    throw invalidQuery();
  }

  const keys = Reflect.ownKeys(query);
  if (keys.length !== 1 || keys[0] !== 'eventId') throw invalidQuery();
  try {
    return parseReminderConfigurationEventId(
      (query as Record<string, unknown>).eventId,
    );
  } catch {
    throw invalidQuery();
  }
}

function invalidQuery(): BadRequestException {
  return new BadRequestException({
    code: 'invalid-room-reminder-options-request',
    message: 'Reminder options request is invalid',
  });
}
