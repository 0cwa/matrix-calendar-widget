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

import { Inject, Injectable } from '@nestjs/common';
import { IAppConfiguration } from '../IAppConfiguration';
import { ModuleProviderToken } from '../ModuleProviderToken';
import {
  CalendarGatewayContextDto,
  CalendarGatewayRoomCapabilityDto,
} from '../dto/CalendarGatewayContextDto';
import { IUserContext } from '../model/IUserContext';
import { GatewayAccessService } from './GatewayAccessService';
import { MatrixCalendarAuthorizationFactory } from './MatrixCalendarAuthorization';

@Injectable()
export class GatewayContextService {
  constructor(
    @Inject(ModuleProviderToken.APP_CONFIGURATION)
    private readonly appConfig: IAppConfiguration,
    private readonly authorizationFactory: MatrixCalendarAuthorizationFactory,
    private readonly gatewayAccessService: GatewayAccessService,
  ) {}

  async getContext(
    userContext: IUserContext,
    roomId?: string,
  ): Promise<CalendarGatewayContextDto> {
    if (roomId === undefined) {
      return new CalendarGatewayContextDto(userContext.userId);
    }

    const roomTarget =
      await this.gatewayAccessService.authorizeRoomCalendarTarget(
        userContext,
        roomId,
        undefined,
        { action: 'list-calendars' },
      );
    const authorization = this.authorizationFactory.forRoom(
      userContext.userId,
      roomTarget.roomId,
    );
    const canReadEvents =
      this.appConfig.room_calendar_access_enabled === true &&
      (await authorization.isAllowed({
        action: 'read-events',
        calendarId: roomTarget.calendarId,
      }));
    const canWriteEvents =
      canReadEvents &&
      this.appConfig.room_calendar_event_writes_enabled === true &&
      (await authorization.isAllowed({
        action: 'create-event',
        calendarId: roomTarget.calendarId,
      }));
    const canManageReminders =
      this.appConfig.room_calendar_access_enabled === true &&
      this.appConfig.room_reminder_configuration_enabled === true &&
      Boolean(this.appConfig.reminder_database_url) &&
      (await this.authorizationFactory.canManageCalendars(
        userContext.userId,
        roomTarget.roomId,
      ));

    return new CalendarGatewayContextDto(
      userContext.userId,
      roomTarget.roomId,
      new CalendarGatewayRoomCapabilityDto(
        roomTarget.calendarId,
        canReadEvents,
        canWriteEvents,
        canManageReminders,
      ),
    );
  }
}
