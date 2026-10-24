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
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { MatrixOpenIdCredentialParam } from '../decorator/MatrixOpenIdCredentialParam';
import { UserContextParam } from '../decorator/UserContextParam';
import { MatrixAuthGuard } from '../guard/MatrixAuthGuard';
import { IMatrixOpenIdCredential } from '../model/IMatrixOpenIdCredential';
import { IUserContext } from '../model/IUserContext';
import { PrivateCalendarClientService } from '../service/private-client/PrivateCalendarClientService';
import {
  parsePublicCalendarFeedTarget,
  parsePublicCalendarFeedTargetBody,
} from '../service/public-feed/PublicCalendarFeedService';

@Controller({ path: 'calendar/private-clients', version: ['1'] })
@UseGuards(MatrixAuthGuard)
export class PrivateCalendarClientController {
  constructor(private readonly clients: PrivateCalendarClientService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @Header('Pragma', 'no-cache')
  list(
    @UserContextParam() userContext: IUserContext,
    @MatrixOpenIdCredentialParam()
    openIdCredential: IMatrixOpenIdCredential | undefined,
    @Query('target') target: string | undefined,
    @Query('calendarId') calendarId: string | undefined,
    @Query('roomId') roomId: string | undefined,
  ) {
    return this.clients.list(
      userContext,
      openIdCredential,
      parsePublicCalendarFeedTarget(target, calendarId, roomId),
    );
  }

  @Post()
  @Header('Cache-Control', 'no-store')
  @Header('Pragma', 'no-cache')
  create(
    @UserContextParam() userContext: IUserContext,
    @MatrixOpenIdCredentialParam()
    openIdCredential: IMatrixOpenIdCredential | undefined,
    @Body() body: unknown,
  ) {
    return this.clients.create(
      userContext,
      openIdCredential,
      parsePublicCalendarFeedTargetBody(body),
    );
  }

  @Delete(':appId')
  @Header('Cache-Control', 'no-store')
  @Header('Pragma', 'no-cache')
  revoke(
    @UserContextParam() userContext: IUserContext,
    @MatrixOpenIdCredentialParam()
    openIdCredential: IMatrixOpenIdCredential | undefined,
    @Param('appId') appId: string,
  ) {
    return this.clients.revoke(userContext, openIdCredential, appId);
  }
}
