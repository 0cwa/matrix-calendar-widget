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
  Controller,
  Get,
  Head,
  HttpStatus,
  Param,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { PublicCalendarFeedComponentError } from '../service/public-feed/PublicCalendarFeedIcs';
import { PublicCalendarFeedService } from '../service/public-feed/PublicCalendarFeedService';
import { PUBLIC_CALENDAR_FEED_PATH } from '../service/public-feed/PublicCalendarFeedToken';
import { RadicalePublicFeedError } from '../service/public-feed/RadicalePublicFeedClient';

@Controller({ path: 'public-calendar-feeds', version: ['1'] })
export class PublicCalendarFeedController {
  constructor(private readonly feeds: PublicCalendarFeedService) {}

  // Register HEAD explicitly before GET because Express otherwise handles HEAD
  // through the GET route before reaching an explicitly registered HEAD route.
  @Head(':envelope')
  async head(
    @Param('envelope') envelope: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    await this.sendFeed(envelope, request, response, true);
  }

  @Get(':envelope')
  async get(
    @Param('envelope') envelope: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    await this.sendFeed(envelope, request, response, false);
  }

  private async sendFeed(
    envelope: string,
    request: Request,
    response: Response,
    headOnly: boolean,
  ): Promise<void> {
    this.setPrivateResponseHeaders(response);
    const expectedPath = `${PUBLIC_CALENDAR_FEED_PATH}/${envelope}`;
    if (request.originalUrl !== expectedPath) {
      response.status(HttpStatus.NOT_FOUND).end();
      return;
    }

    try {
      // Always retrieve and validate the complete canonical feed, including on
      // HEAD. Upstream validators are intentionally ignored so mixed component
      // changes cannot be hidden behind an early 304 response.
      const feed = await this.feeds.readPublicFeed(envelope);
      response.statusCode = HttpStatus.OK;
      response.setHeader('Content-Type', feed.contentType);
      response.setHeader('Content-Length', String(feed.bytes.byteLength));
      response.removeHeader('ETag');
      if (!headOnly) response.write(feed.bytes);
      response.end();
    } catch (error) {
      if (error instanceof PublicCalendarFeedComponentError) {
        // A collection can change after publication. Fail closed without
        // returning a partial calendar body.
        response.status(HttpStatus.CONFLICT).end();
        return;
      }
      if (
        error instanceof RadicalePublicFeedError &&
        error.code === 'not-found'
      ) {
        response.status(HttpStatus.NOT_FOUND).end();
        return;
      }
      response.status(HttpStatus.SERVICE_UNAVAILABLE).end();
    }
  }

  private setPrivateResponseHeaders(response: Response): void {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Pragma', 'no-cache');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.removeHeader('ETag');
  }
}
