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
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserContextParam } from '../decorator/UserContextParam';
import { MatrixAuthGuard } from '../guard/MatrixAuthGuard';
import { MatrixRoomMembershipGuard } from '../guard/MatrixRoomMembershipGuard';
import { IUserContext } from '../model/IUserContext';
import { RoomReminderConfigurationService } from '../reminder/RoomReminderConfigurationService';

@Controller({
  path: 'calendar/rooms/:roomId/reminders',
  version: ['1'],
})
@UseGuards(MatrixAuthGuard, MatrixRoomMembershipGuard)
export class RoomReminderConfigurationController {
  constructor(
    private readonly configurations: RoomReminderConfigurationService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(
    @UserContextParam() userContext: IUserContext,
    @Param('roomId') roomId: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.configurations.list(userContext?.userId, roomId, limit, cursor);
  }

  @Put()
  @Header('Cache-Control', 'no-store')
  upsert(
    @UserContextParam() userContext: IUserContext,
    @Param('roomId') roomId: string,
    @Body() body: unknown,
  ) {
    return this.configurations.upsert(userContext?.userId, roomId, body);
  }

  @Delete()
  @Header('Cache-Control', 'no-store')
  delete(
    @UserContextParam() userContext: IUserContext,
    @Param('roomId') roomId: string,
    @Body() body: unknown,
  ) {
    return this.configurations.delete(userContext?.userId, roomId, body);
  }
}
