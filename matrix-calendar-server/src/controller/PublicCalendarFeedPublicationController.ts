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
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { MatrixOpenIdCredentialParam } from '../decorator/MatrixOpenIdCredentialParam';
import { UserContextParam } from '../decorator/UserContextParam';
import { MatrixAuthGuard } from '../guard/MatrixAuthGuard';
import { IMatrixOpenIdCredential } from '../model/IMatrixOpenIdCredential';
import { IUserContext } from '../model/IUserContext';
import {
  parsePublicCalendarFeedTarget,
  parsePublicCalendarFeedTargetBody,
  PublicCalendarFeedService,
} from '../service/public-feed/PublicCalendarFeedService';

@Controller({ path: 'calendar-feeds/publication', version: ['1'] })
@UseGuards(MatrixAuthGuard)
export class PublicCalendarFeedPublicationController {
  constructor(private readonly feeds: PublicCalendarFeedService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  get(
    @UserContextParam() userContext: IUserContext,
    @MatrixOpenIdCredentialParam()
    openIdCredential: IMatrixOpenIdCredential | undefined,
    @Query('target') target: string | undefined,
    @Query('calendarId') calendarId: string | undefined,
    @Query('roomId') roomId: string | undefined,
  ) {
    return this.feeds.getPublication(
      userContext,
      openIdCredential,
      parsePublicCalendarFeedTarget(target, calendarId, roomId),
    );
  }

  @Put()
  @Header('Cache-Control', 'no-store')
  publish(
    @UserContextParam() userContext: IUserContext,
    @MatrixOpenIdCredentialParam()
    openIdCredential: IMatrixOpenIdCredential | undefined,
    @Body() body: unknown,
  ) {
    const target = parsePublicCalendarFeedTargetBody(body, true);
    return this.feeds.publish(userContext, openIdCredential, target, true);
  }

  @Delete()
  @Header('Cache-Control', 'no-store')
  unpublish(
    @UserContextParam() userContext: IUserContext,
    @MatrixOpenIdCredentialParam()
    openIdCredential: IMatrixOpenIdCredential | undefined,
    @Body() body: unknown,
  ) {
    return this.feeds.unpublish(
      userContext,
      openIdCredential,
      parsePublicCalendarFeedTargetBody(body),
    );
  }
}
