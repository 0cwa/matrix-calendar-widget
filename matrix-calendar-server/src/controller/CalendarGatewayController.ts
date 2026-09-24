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
  ForbiddenException,
  Get,
  Inject,
  Query,
  ServiceUnavailableException,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { IAppConfiguration } from '../IAppConfiguration';
import { ModuleProviderToken } from '../ModuleProviderToken';
import {
  CalDavDiscoveryClient,
  MatrixOpenIdCalDavCredentialError,
  MatrixOpenIdCalDavCredentialProvider,
} from '../caldav';
import { MatrixOpenIdCredentialParam } from '../decorator/MatrixOpenIdCredentialParam';
import { UserContextParam } from '../decorator/UserContextParam';
import { CalendarGatewayCalendarDto } from '../dto/CalendarGatewayCalendarDto';
import { CalendarGatewayContextDto } from '../dto/CalendarGatewayContextDto';
import { MatrixAuthGuard } from '../guard/MatrixAuthGuard';
import { MatrixRoomMembershipGuard } from '../guard/MatrixRoomMembershipGuard';
import { IMatrixOpenIdCredential } from '../model/IMatrixOpenIdCredential';
import { IUserContext } from '../model/IUserContext';
import { MatrixCalendarAuthorizationFactory } from '../service/MatrixCalendarAuthorization';

@Controller({
  path: 'calendar',
  version: ['1'],
})
@UseGuards(MatrixAuthGuard, MatrixRoomMembershipGuard)
export class CalendarGatewayController {
  constructor(
    @Inject(ModuleProviderToken.APP_CONFIGURATION)
    private readonly appConfig: IAppConfiguration,
    private readonly authorizationFactory: MatrixCalendarAuthorizationFactory,
  ) {}

  @Get('context')
  getContext(
    @UserContextParam() userContext: IUserContext,
    @Query('roomId') roomId?: string,
  ): CalendarGatewayContextDto {
    return new CalendarGatewayContextDto(userContext.userId, roomId);
  }

  @Get('calendars')
  async listCalendars(
    @UserContextParam() userContext: IUserContext,
    @MatrixOpenIdCredentialParam()
    openIdCredential: IMatrixOpenIdCredential | undefined,
    @Query('roomId') roomId?: string,
  ): Promise<CalendarGatewayCalendarDto[]> {
    if (!roomId) {
      throw new BadRequestException('roomId is required');
    }

    const authorization = this.authorizationFactory.forRoom(
      userContext.userId,
      roomId,
    );
    if (!(await authorization.isAllowed({ action: 'list-calendars' }))) {
      throw new ForbiddenException(
        'Not allowed to list calendars for this Matrix room',
      );
    }

    if (!this.appConfig.radicale_url) {
      throw new ServiceUnavailableException({
        code: 'radicale-not-configured',
        message: 'RADICALE_URL is required for calendar discovery',
      });
    }

    const credentialProvider = new MatrixOpenIdCalDavCredentialProvider(
      userContext,
      openIdCredential,
    );

    try {
      const result = await new CalDavDiscoveryClient(
        this.appConfig.radicale_url,
        credentialProvider,
      ).discover();

      return result.calendars.map(
        (calendar) =>
          new CalendarGatewayCalendarDto(
            calendar.href,
            calendar.displayName ?? calendar.href,
            calendar.color,
            calendar.readOnly,
          ),
      );
    } catch (error) {
      if (error instanceof MatrixOpenIdCalDavCredentialError) {
        throw new UnauthorizedException({
          code: error.code,
          message: error.message,
        });
      }

      throw error;
    }
  }
}
