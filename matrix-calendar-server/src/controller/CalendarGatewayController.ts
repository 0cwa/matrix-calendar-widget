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
  CalendarAuthorizationRequest,
  CalendarEventInput,
  CalendarEventPatch,
  CalendarTimeRange,
} from '@matrix-calendar-widget/calendar';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  Inject,
  Patch,
  Post,
  Query,
  ServiceUnavailableException,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { IAppConfiguration } from '../IAppConfiguration';
import { ModuleProviderToken } from '../ModuleProviderToken';
import {
  CalDavDiscoveryClient,
  CalDavEventClient,
  CalDavEventResource,
  CalDavEventTransportError,
  ICalendarEventCodec,
  MatrixOpenIdCalDavCredentialError,
  MatrixOpenIdCalDavCredentialProvider,
} from '../caldav';
import { MatrixOpenIdCredentialParam } from '../decorator/MatrixOpenIdCredentialParam';
import { UserContextParam } from '../decorator/UserContextParam';
import { CalendarGatewayCalendarDto } from '../dto/CalendarGatewayCalendarDto';
import { CalendarGatewayContextDto } from '../dto/CalendarGatewayContextDto';
import { CalendarGatewayEventDto } from '../dto/CalendarGatewayEventDto';
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
    const requiredRoomId = this.requireQuery(roomId, 'roomId');
    const authorization = this.authorizationFactory.forRoom(
      userContext.userId,
      requiredRoomId,
    );
    if (!(await authorization.isAllowed({ action: 'list-calendars' }))) {
      throw new ForbiddenException(
        'Not allowed to list calendars for this Matrix room',
      );
    }

    const radicaleUrl = this.requireRadicaleBaseUrl();
    const credentialProvider = new MatrixOpenIdCalDavCredentialProvider(
      userContext,
      openIdCredential,
    );

    return this.runCalDav(async () => {
      const result = await new CalDavDiscoveryClient(
        radicaleUrl,
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
    });
  }

  @Post('calendars')
  async createCalendar(
    @UserContextParam() userContext: IUserContext,
    @MatrixOpenIdCredentialParam()
    openIdCredential: IMatrixOpenIdCredential | undefined,
    @Body() input: { name?: string },
    @Query('roomId') roomId?: string,
  ): Promise<CalendarGatewayCalendarDto> {
    const requiredRoomId = this.requireQuery(roomId, 'roomId');
    const name = input?.name?.trim();
    if (!name) {
      throw new BadRequestException('calendar name is required');
    }

    const authorization = this.authorizationFactory.forRoom(
      userContext.userId,
      requiredRoomId,
    );
    if (!(await authorization.isAllowed({ action: 'create-calendar' }))) {
      throw new ForbiddenException(
        'Not allowed to create calendars for this Matrix room',
      );
    }

    const credentialProvider = new MatrixOpenIdCalDavCredentialProvider(
      userContext,
      openIdCredential,
    );

    return this.runCalDav(async () => {
      const calendar = await new CalDavDiscoveryClient(
        this.requireRadicaleBaseUrl(),
        credentialProvider,
      ).createCalendar(name, `calendar-${randomUUID()}`);

      return new CalendarGatewayCalendarDto(
        calendar.href,
        calendar.displayName ?? name,
        calendar.color,
        calendar.readOnly,
      );
    });
  }

  @Get('events')
  async listEvents(
    @UserContextParam() userContext: IUserContext,
    @MatrixOpenIdCredentialParam()
    openIdCredential: IMatrixOpenIdCredential | undefined,
    @Query('roomId') roomId?: string,
    @Query('calendarId') calendarId?: string,
    @Query('start') start?: string,
    @Query('end') end?: string,
  ): Promise<CalendarGatewayEventDto[]> {
    const requestedCalendarId = this.requireQuery(calendarId, 'calendarId');
    const scope = await this.eventScope(
      userContext,
      roomId,
      requestedCalendarId,
      {
        action: 'read-events',
        calendarId: requestedCalendarId,
      },
    );
    const range: CalendarTimeRange = {
      start: this.requireQuery(start, 'start'),
      end: this.requireQuery(end, 'end'),
    };

    return this.runCalDav(async () => {
      const client = this.eventClient(userContext, openIdCredential);
      const codec = new ICalendarEventCodec();
      const resources = await client.listEvents(scope.calendarId, range);
      return resources.map((resource) =>
        this.eventDto(codec, scope.calendarId, resource),
      );
    });
  }

  @Get('event')
  async getEvent(
    @UserContextParam() userContext: IUserContext,
    @MatrixOpenIdCredentialParam()
    openIdCredential: IMatrixOpenIdCredential | undefined,
    @Query('roomId') roomId?: string,
    @Query('calendarId') calendarId?: string,
    @Query('eventId') eventId?: string,
  ): Promise<CalendarGatewayEventDto> {
    const requestedCalendarId = this.requireQuery(calendarId, 'calendarId');
    const scope = await this.eventScope(
      userContext,
      roomId,
      requestedCalendarId,
      {
        action: 'read-events',
        calendarId: requestedCalendarId,
      },
    );
    const normalizedEventId = this.normalizeEventUrl(
      this.requireQuery(eventId, 'eventId'),
      scope.calendarId,
    );

    return this.runCalDav(async () => {
      const client = this.eventClient(userContext, openIdCredential);
      const resource = await client.getEvent(normalizedEventId);
      return this.eventDto(
        new ICalendarEventCodec(),
        scope.calendarId,
        resource,
      );
    });
  }

  @Post('events')
  async createEvent(
    @UserContextParam() userContext: IUserContext,
    @MatrixOpenIdCredentialParam()
    openIdCredential: IMatrixOpenIdCredential | undefined,
    @Body() input: CalendarEventInput,
    @Query('roomId') roomId?: string,
    @Query('calendarId') calendarId?: string,
  ): Promise<CalendarGatewayEventDto> {
    const requestedCalendarId = this.requireQuery(calendarId, 'calendarId');
    const scope = await this.eventScope(
      userContext,
      roomId,
      requestedCalendarId,
      {
        action: 'create-event',
        calendarId: requestedCalendarId,
      },
    );

    if (!input || typeof input.uid !== 'string' || input.uid.length === 0) {
      throw new BadRequestException('event uid is required');
    }

    const eventId = new URL(
      `${encodeURIComponent(input.uid)}.ics`,
      this.asCollectionUrl(scope.calendarId),
    ).toString();

    return this.runCalDav(async () => {
      const client = this.eventClient(userContext, openIdCredential);
      const codec = new ICalendarEventCodec();
      const encoded = codec.create(scope.calendarId, eventId, input);
      await client.createEvent(eventId, encoded.icalendar);
      return this.eventDto(
        codec,
        scope.calendarId,
        await client.getEvent(eventId),
      );
    });
  }

  @Patch('events')
  async updateEvent(
    @UserContextParam() userContext: IUserContext,
    @MatrixOpenIdCredentialParam()
    openIdCredential: IMatrixOpenIdCredential | undefined,
    @Body() patch: CalendarEventPatch,
    @Headers('if-match') ifMatch?: string,
    @Query('roomId') roomId?: string,
    @Query('calendarId') calendarId?: string,
    @Query('eventId') eventId?: string,
  ): Promise<CalendarGatewayEventDto> {
    const requestedCalendarId = this.requireQuery(calendarId, 'calendarId');
    const normalizedCalendarId = this.normalizeRadicaleUrl(
      requestedCalendarId,
      'calendarId',
    );
    const normalizedEventId = this.normalizeEventUrl(
      this.requireQuery(eventId, 'eventId'),
      normalizedCalendarId,
    );
    const scope = await this.eventScope(
      userContext,
      roomId,
      normalizedCalendarId,
      {
        action: 'update-event',
        calendarId: normalizedCalendarId,
        eventId: normalizedEventId,
      },
    );
    const etag = this.requireQuery(ifMatch, 'If-Match');

    return this.runCalDav(async () => {
      const client = this.eventClient(userContext, openIdCredential);
      const codec = new ICalendarEventCodec();
      const current = await client.getEvent(normalizedEventId);
      const encoded = codec
        .parse(scope.calendarId, normalizedEventId, current.icalendar)
        .applyPatch(patch ?? {});

      await client.updateEvent(normalizedEventId, etag, encoded.icalendar);

      return this.eventDto(
        codec,
        scope.calendarId,
        await client.getEvent(normalizedEventId),
      );
    });
  }

  @Delete('events')
  async deleteEvent(
    @UserContextParam() userContext: IUserContext,
    @MatrixOpenIdCredentialParam()
    openIdCredential: IMatrixOpenIdCredential | undefined,
    @Headers('if-match') ifMatch?: string,
    @Query('roomId') roomId?: string,
    @Query('calendarId') calendarId?: string,
    @Query('eventId') eventId?: string,
  ): Promise<void> {
    const requestedCalendarId = this.requireQuery(calendarId, 'calendarId');
    const normalizedCalendarId = this.normalizeRadicaleUrl(
      requestedCalendarId,
      'calendarId',
    );
    const normalizedEventId = this.normalizeEventUrl(
      this.requireQuery(eventId, 'eventId'),
      normalizedCalendarId,
    );
    await this.eventScope(userContext, roomId, normalizedCalendarId, {
      action: 'delete-event',
      calendarId: normalizedCalendarId,
      eventId: normalizedEventId,
    });
    const etag = this.requireQuery(ifMatch, 'If-Match');

    await this.runCalDav(async () => {
      await this.eventClient(userContext, openIdCredential).deleteEvent(
        normalizedEventId,
        etag,
      );
    });
  }

  private async eventScope(
    userContext: IUserContext,
    roomId: string | undefined,
    calendarId: string,
    request: CalendarAuthorizationRequest,
  ): Promise<{ roomId: string; calendarId: string }> {
    const requiredRoomId = this.requireQuery(roomId, 'roomId');
    const normalizedCalendarId = this.normalizeRadicaleUrl(
      calendarId,
      'calendarId',
    );
    let normalizedRequest: CalendarAuthorizationRequest;
    switch (request.action) {
      case 'read-events':
      case 'create-event':
      case 'manage-calendar':
        normalizedRequest = {
          action: request.action,
          calendarId: normalizedCalendarId,
        };
        break;
      case 'update-event':
      case 'delete-event':
        normalizedRequest = {
          action: request.action,
          calendarId: normalizedCalendarId,
          eventId: this.normalizeEventUrl(
            request.eventId,
            normalizedCalendarId,
          ),
        };
        break;
      case 'list-calendars':
      case 'create-calendar':
        normalizedRequest = request;
        break;
    }
    const authorization = this.authorizationFactory.forRoom(
      userContext.userId,
      requiredRoomId,
    );

    if (!(await authorization.isAllowed(normalizedRequest))) {
      throw new ForbiddenException(
        `Not allowed to ${request.action} for this Matrix room`,
      );
    }

    return {
      roomId: requiredRoomId,
      calendarId: normalizedCalendarId,
    };
  }

  private eventClient(
    userContext: IUserContext,
    openIdCredential: IMatrixOpenIdCredential | undefined,
  ): CalDavEventClient {
    return new CalDavEventClient(
      new MatrixOpenIdCalDavCredentialProvider(userContext, openIdCredential),
    );
  }

  private eventDto(
    codec: ICalendarEventCodec,
    calendarId: string,
    resource: CalDavEventResource,
  ): CalendarGatewayEventDto {
    return new CalendarGatewayEventDto(
      codec.parse(calendarId, resource.href, resource.icalendar).event,
      resource.etag,
    );
  }

  private requireRadicaleBaseUrl(): string {
    if (!this.appConfig.radicale_url) {
      throw new ServiceUnavailableException({
        code: 'radicale-not-configured',
        message: 'RADICALE_URL is required for calendar discovery',
      });
    }

    return new URL(this.appConfig.radicale_url).toString();
  }

  private normalizeRadicaleUrl(value: string, field: string): string {
    const base = new URL(this.requireRadicaleBaseUrl());
    let target: URL;

    try {
      target = new URL(value);
    } catch {
      throw new BadRequestException(`${field} must be an absolute URL`);
    }

    const basePath = base.pathname.endsWith('/')
      ? base.pathname
      : `${base.pathname}/`;

    if (
      target.username ||
      target.password ||
      target.origin !== base.origin ||
      !target.pathname.startsWith(basePath)
    ) {
      throw new BadRequestException(
        `${field} must be within the configured Radicale service`,
      );
    }

    return target.toString();
  }

  private normalizeEventUrl(value: string, calendarId: string): string {
    const eventUrl = new URL(this.normalizeRadicaleUrl(value, 'eventId'));
    const calendarUrl = new URL(this.asCollectionUrl(calendarId));

    if (!eventUrl.pathname.startsWith(calendarUrl.pathname)) {
      throw new BadRequestException(
        'eventId must be within the selected calendar',
      );
    }

    return eventUrl.toString();
  }

  private asCollectionUrl(calendarId: string): string {
    const url = new URL(calendarId);
    if (!url.pathname.endsWith('/')) {
      url.pathname = `${url.pathname}/`;
    }
    return url.toString();
  }

  private requireQuery(value: string | undefined, name: string): string {
    if (!value) {
      throw new BadRequestException(`${name} is required`);
    }
    return value;
  }

  private async runCalDav<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof MatrixOpenIdCalDavCredentialError) {
        throw new UnauthorizedException({
          code: error.code,
          message: error.message,
        });
      }

      if (
        error instanceof CalDavEventTransportError &&
        error.code === 'etag-conflict'
      ) {
        throw new ConflictException({
          code: 'etag-conflict',
          message: error.message,
        });
      }

      if (
        error instanceof CalDavEventTransportError &&
        error.code === 'invalid-range'
      ) {
        throw new BadRequestException({
          code: 'invalid-range',
          message: error.message,
        });
      }

      throw error;
    }
  }
}
