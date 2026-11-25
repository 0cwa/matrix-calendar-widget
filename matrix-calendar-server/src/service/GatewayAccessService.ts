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

import { CalendarAuthorizationRequest } from '@matrix-calendar-widget/calendar';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ModuleProviderToken } from '../ModuleProviderToken';
import { IUserContext } from '../model/IUserContext';
import type { RoomCalendarBindingRegistry } from './IRoomCalendarBindingRegistry';
import { MatrixCalendarAuthorizationFactory } from './MatrixCalendarAuthorization';
import { RoomCalendarBindingError } from './RoomCalendarBindingResolver';
import { RoomCalendarTarget } from './RoomCalendarCalDavAccess';

@Injectable()
export class GatewayAccessService {
  constructor(
    private readonly authorizationFactory: MatrixCalendarAuthorizationFactory,
    @Inject(ModuleProviderToken.ROOM_CALENDAR_BINDING_REGISTRY)
    private readonly roomCalendarBindingRegistry?: RoomCalendarBindingRegistry,
  ) {}

  async authorizeRoomCalendarTarget(
    userContext: IUserContext,
    roomId: string | undefined,
    requestedCalendarId: string | undefined,
    request: CalendarAuthorizationRequest,
  ): Promise<RoomCalendarTarget> {
    const requiredRoomId = this.requireQuery(roomId, 'roomId');
    const authorization = this.authorizationFactory.forRoom(
      userContext.userId,
      requiredRoomId,
    );

    if (!(await authorization.isAllowed(request))) {
      throw new ForbiddenException(
        `Not allowed to ${request.action} for this Matrix room`,
      );
    }

    return this.resolveRoomTarget(requiredRoomId, requestedCalendarId);
  }

  private async resolveRoomTarget(
    roomId: string,
    requestedCalendarId?: string,
  ): Promise<RoomCalendarTarget> {
    try {
      const registry = this.roomCalendarBindingRegistry;
      if (!registry) throw new Error('Room calendar binding registry missing');
      const binding = await registry.resolve(roomId, requestedCalendarId);
      return {
        roomId: binding.roomId,
        calendarId: binding.calendarId,
        principal: { kind: 'service' },
      };
    } catch (error) {
      if (!(error instanceof RoomCalendarBindingError)) {
        throw new ServiceUnavailableException({
          code: 'room-calendar-binding-invalid',
          message: 'Room calendar configuration is unavailable',
        });
      }

      switch (error.code) {
        case 'invalid_room_id':
          throw new BadRequestException({
            code: 'invalid-room-id',
            message: 'Matrix room identifier is invalid',
          });
        case 'missing_binding':
          throw new NotFoundException({
            code: 'room-calendar-binding-missing',
            message: 'No calendar is configured for this Matrix room',
          });
        case 'request_calendar_mismatch':
          throw new ForbiddenException({
            code: 'room-calendar-target-mismatch',
            message: 'Requested calendar is not the configured room calendar',
          });
        default:
          throw new ServiceUnavailableException({
            code: 'room-calendar-binding-invalid',
            message: 'Room calendar configuration is unavailable',
          });
      }
    }
  }

  private requireQuery(value: string | undefined, name: string): string {
    if (!value) {
      throw new BadRequestException(`${name} is required`);
    }
    return value;
  }
}
