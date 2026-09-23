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

import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { UserContextParam } from '../decorator/UserContextParam';
import { CalendarGatewayContextDto } from '../dto/CalendarGatewayContextDto';
import { MatrixAuthGuard } from '../guard/MatrixAuthGuard';
import { MatrixRoomMembershipGuard } from '../guard/MatrixRoomMembershipGuard';
import { IUserContext } from '../model/IUserContext';

@Controller({
  path: 'calendar',
  version: ['1'],
})
@UseGuards(MatrixAuthGuard, MatrixRoomMembershipGuard)
export class CalendarGatewayController {
  @Get('context')
  getContext(
    @UserContextParam() userContext: IUserContext,
    @Query('roomId') roomId?: string,
  ): CalendarGatewayContextDto {
    return new CalendarGatewayContextDto(userContext.userId, roomId);
  }
}
