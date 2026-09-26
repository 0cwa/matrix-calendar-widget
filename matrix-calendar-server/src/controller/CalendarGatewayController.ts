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
  CalendarEventDateTime,
  CalendarEventInput,
  CalendarEventOccurrencePatch,
  CalendarEventPatch,
  CalendarMetadataPatch,
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
  NotFoundException,
  Patch,
  Post,
  Query,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { IAppConfiguration } from '../IAppConfiguration';
import { ModuleProviderToken } from '../ModuleProviderToken';
import {
  CalDavEventClient,
  CalDavEventResource,
  CalDavEventTransportError,
  ICalendarEventCodec,
  ICalendarEventCodecError,
} from '../caldav';
import { MatrixOpenIdCredentialParam } from '../decorator/MatrixOpenIdCredentialParam';
import { UserContextParam } from '../decorator/UserContextParam';
import { CalendarGatewayCalendarDto } from '../dto/CalendarGatewayCalendarDto';
import { CalendarGatewayContextDto } from '../dto/CalendarGatewayContextDto';
import { CalendarGatewayDiagnosticsDto } from '../dto/CalendarGatewayDiagnosticsDto';
import { CalendarGatewayEventDto } from '../dto/CalendarGatewayEventDto';
import { MatrixAuthGuard } from '../guard/MatrixAuthGuard';
import { MatrixRoomMembershipGuard } from '../guard/MatrixRoomMembershipGuard';
import { IMatrixOpenIdCredential } from '../model/IMatrixOpenIdCredential';
import { IUserContext } from '../model/IUserContext';
import { MatrixCalendarAuthorizationFactory } from '../service/MatrixCalendarAuthorization';
import {
  resolveRoomCalendarBinding,
  RoomCalendarBindingError,
} from '../service/RoomCalendarBindingResolver';
import {
  RoomCalendarCalDavAccess,
  RoomCalendarTarget,
} from '../service/RoomCalendarCalDavAccess';

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
    @Inject(ModuleProviderToken.ROOM_CALENDAR_CALDAV_ACCESS)
    private readonly roomCalendarCalDavAccess: RoomCalendarCalDavAccess,
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
    _openIdCredential: IMatrixOpenIdCredential | undefined,
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

    const target = this.resolveRoomTarget(requiredRoomId);
    return [
      new CalendarGatewayCalendarDto(
        target.calendarId,
        target.calendarId,
        undefined,
        false,
      ),
    ];
  }

  @Get('calendars/diagnostics')
  async getCalendarDiagnostics(
    @UserContextParam() userContext: IUserContext,
    @MatrixOpenIdCredentialParam()
    _openIdCredential: IMatrixOpenIdCredential | undefined,
    @Query('roomId') roomId?: string,
  ): Promise<CalendarGatewayDiagnosticsDto> {
    const requiredRoomId = this.requireQuery(roomId, 'roomId');
    if (
      !(await this.authorizationFactory.canManageCalendars(
        userContext.userId,
        requiredRoomId,
      ))
    ) {
      throw new ForbiddenException(
        'Not allowed to view CalDAV diagnostics for this Matrix room',
      );
    }

    const target = this.resolveRoomTarget(requiredRoomId);
    const url = this.roomCollectionUrl(target);
    return new CalendarGatewayDiagnosticsDto([
      { name: target.calendarId, url },
    ]);
  }

  @Post('calendars')
  async createCalendar(
    @UserContextParam() userContext: IUserContext,
    @MatrixOpenIdCredentialParam()
    _openIdCredential: IMatrixOpenIdCredential | undefined,
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
    this.resolveRoomTarget(requiredRoomId);
    throw this.operatorManagedCollectionError();
  }

  @Patch('calendars')
  async renameCalendar(
    @UserContextParam() userContext: IUserContext,
    @MatrixOpenIdCredentialParam()
    _openIdCredential: IMatrixOpenIdCredential | undefined,
    @Body() input: { name?: string },
    @Query('roomId') roomId?: string,
    @Query('calendarId') calendarId?: string,
  ): Promise<void> {
    const requiredRoomId = this.requireQuery(roomId, 'roomId');
    const name = input?.name?.trim();
    if (!name) {
      throw new BadRequestException('calendar name is required');
    }

    const requestedCalendarId = this.requireQuery(calendarId, 'calendarId');
    const authorization = this.authorizationFactory.forRoom(
      userContext.userId,
      requiredRoomId,
    );
    if (
      !(await authorization.isAllowed({
        action: 'manage-calendar',
        calendarId: requestedCalendarId,
      }))
    ) {
      throw new ForbiddenException(
        'Not allowed to manage calendars for this Matrix room',
      );
    }

    this.resolveRoomTarget(requiredRoomId, requestedCalendarId);
    throw this.operatorManagedCollectionError();
  }

  @Patch('calendars/metadata')
  async updateCalendarMetadata(
    @UserContextParam() userContext: IUserContext,
    @MatrixOpenIdCredentialParam()
    _openIdCredential: IMatrixOpenIdCredential | undefined,
    @Body() input: unknown,
    @Query('roomId') roomId?: string,
    @Query('calendarId') calendarId?: string,
  ): Promise<void> {
    const requiredRoomId = this.requireQuery(roomId, 'roomId');
    this.parseCalendarMetadataPatch(input);
    const requestedCalendarId = this.requireQuery(calendarId, 'calendarId');
    const authorization = this.authorizationFactory.forRoom(
      userContext.userId,
      requiredRoomId,
    );
    if (
      !(await authorization.isAllowed({
        action: 'manage-calendar',
        calendarId: requestedCalendarId,
      }))
    ) {
      throw new ForbiddenException(
        'Not allowed to manage calendars for this Matrix room',
      );
    }

    this.resolveRoomTarget(requiredRoomId, requestedCalendarId);
    throw this.operatorManagedCollectionError();
  }

  @Delete('calendars')
  async deleteCalendar(
    @UserContextParam() userContext: IUserContext,
    @MatrixOpenIdCredentialParam()
    _openIdCredential: IMatrixOpenIdCredential | undefined,
    @Query('roomId') roomId?: string,
    @Query('calendarId') calendarId?: string,
  ): Promise<void> {
    const requestedCalendarId = this.requireQuery(calendarId, 'calendarId');
    const requiredRoomId = this.requireQuery(roomId, 'roomId');
    const authorization = this.authorizationFactory.forRoom(
      userContext.userId,
      requiredRoomId,
    );
    if (
      !(await authorization.isAllowed({
        action: 'manage-calendar',
        calendarId: requestedCalendarId,
      }))
    ) {
      throw new ForbiddenException(
        'Not allowed to manage calendars for this Matrix room',
      );
    }
    this.resolveRoomTarget(requiredRoomId, requestedCalendarId);
    throw this.operatorManagedCollectionError();
  }

  @Get('events')
  async listEvents(
    @UserContextParam() userContext: IUserContext,
    @MatrixOpenIdCredentialParam()
    _openIdCredential: IMatrixOpenIdCredential | undefined,
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
    const calendarUrl = this.roomCollectionUrl(scope);
    const range: CalendarTimeRange = {
      start: this.requireQuery(start, 'start'),
      end: this.requireQuery(end, 'end'),
    };

    return this.runCalDav(async () => {
      const client = this.eventClient(scope);
      const codec = new ICalendarEventCodec();
      const resources = await client.listEvents(calendarUrl, range);
      return resources.map((resource) =>
        this.eventDto(codec, scope.calendarId, resource),
      );
    });
  }

  @Get('event')
  async getEvent(
    @UserContextParam() userContext: IUserContext,
    @MatrixOpenIdCredentialParam()
    _openIdCredential: IMatrixOpenIdCredential | undefined,
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
      this.roomCollectionUrl(scope),
    );

    return this.runCalDav(async () => {
      const client = this.eventClient(scope);
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
    _openIdCredential: IMatrixOpenIdCredential | undefined,
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
      this.roomCollectionUrl(scope),
    ).toString();

    return this.runCalDav(async () => {
      const client = this.eventClient(scope);
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
    _openIdCredential: IMatrixOpenIdCredential | undefined,
    @Body() patch: CalendarEventPatch,
    @Headers('if-match') ifMatch?: string,
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
        action: 'update-event',
        calendarId: requestedCalendarId,
        eventId: this.requireQuery(eventId, 'eventId'),
      },
    );
    const normalizedEventId = this.normalizeEventUrl(
      this.requireQuery(eventId, 'eventId'),
      this.roomCollectionUrl(scope),
    );
    const etag = this.requireQuery(ifMatch, 'If-Match');

    return this.runCodecCalDav(async () => {
      const client = this.eventClient(scope);
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

  @Patch('events/occurrence')
  async updateOccurrence(
    @UserContextParam() userContext: IUserContext,
    @MatrixOpenIdCredentialParam()
    _openIdCredential: IMatrixOpenIdCredential | undefined,
    @Body() input: unknown,
    @Headers('if-match') ifMatch?: string,
    @Query('roomId') roomId?: string,
    @Query('calendarId') calendarId?: string,
    @Query('eventId') eventId?: string,
  ): Promise<CalendarGatewayEventDto> {
    const { recurrenceId, patch } = parseOccurrenceUpdateBody(input);
    const requestedCalendarId = this.requireQuery(calendarId, 'calendarId');
    const scope = await this.eventScope(
      userContext,
      roomId,
      requestedCalendarId,
      {
        action: 'update-event',
        calendarId: requestedCalendarId,
        eventId: this.requireQuery(eventId, 'eventId'),
      },
    );
    const normalizedEventId = this.normalizeOccurrenceEventUrl(
      this.requireQuery(eventId, 'eventId'),
      this.roomCollectionUrl(scope),
    );
    const etag = this.requireQuery(ifMatch, 'If-Match');

    return this.runCodecCalDav(async () => {
      const client = this.eventClient(scope);
      const codec = new ICalendarEventCodec();
      const current = await client.getEvent(normalizedEventId);
      const encoded = codec
        .parse(scope.calendarId, normalizedEventId, current.icalendar)
        .applyOccurrencePatch(recurrenceId, patch);
      await client.updateEvent(normalizedEventId, etag, encoded.icalendar);
      return this.eventDto(
        codec,
        scope.calendarId,
        await client.getEvent(normalizedEventId),
      );
    });
  }

  @Patch('events/occurrence/following')
  async updateFollowingOccurrence(
    @UserContextParam() userContext: IUserContext,
    @MatrixOpenIdCredentialParam()
    _openIdCredential: IMatrixOpenIdCredential | undefined,
    @Body() input: unknown,
    @Headers('if-match') ifMatch?: string,
    @Query('roomId') roomId?: string,
    @Query('calendarId') calendarId?: string,
    @Query('eventId') eventId?: string,
  ): Promise<CalendarGatewayEventDto> {
    const { recurrenceId, timing } = parseFollowingOccurrenceBody(input);
    const requestedCalendarId = this.requireQuery(calendarId, 'calendarId');
    const scope = await this.eventScope(
      userContext,
      roomId,
      requestedCalendarId,
      {
        action: 'update-event',
        calendarId: requestedCalendarId,
        eventId: this.requireQuery(eventId, 'eventId'),
      },
    );
    const normalizedEventId = this.normalizeOccurrenceEventUrl(
      this.requireQuery(eventId, 'eventId'),
      this.roomCollectionUrl(scope),
    );
    const etag = this.requireQuery(ifMatch, 'If-Match');

    return this.runCodecCalDav(async () => {
      const client = this.eventClient(scope);
      const codec = new ICalendarEventCodec();
      const current = await client.getEvent(normalizedEventId);
      const encoded = codec
        .parse(scope.calendarId, normalizedEventId, current.icalendar)
        .applyFollowingOccurrencePatch(recurrenceId, timing);
      await client.updateEvent(normalizedEventId, etag, encoded.icalendar);
      return this.eventDto(
        codec,
        scope.calendarId,
        await client.getEvent(normalizedEventId),
      );
    });
  }

  @Post('events/occurrence/cancel')
  async cancelOccurrence(
    @UserContextParam() userContext: IUserContext,
    @MatrixOpenIdCredentialParam()
    _openIdCredential: IMatrixOpenIdCredential | undefined,
    @Body() input: unknown,
    @Headers('if-match') ifMatch?: string,
    @Query('roomId') roomId?: string,
    @Query('calendarId') calendarId?: string,
    @Query('eventId') eventId?: string,
  ): Promise<CalendarGatewayEventDto> {
    const recurrenceId = parseOccurrenceCancelBody(input);
    const requestedCalendarId = this.requireQuery(calendarId, 'calendarId');
    const scope = await this.eventScope(
      userContext,
      roomId,
      requestedCalendarId,
      {
        action: 'update-event',
        calendarId: requestedCalendarId,
        eventId: this.requireQuery(eventId, 'eventId'),
      },
    );
    const normalizedEventId = this.normalizeOccurrenceEventUrl(
      this.requireQuery(eventId, 'eventId'),
      this.roomCollectionUrl(scope),
    );
    const etag = this.requireQuery(ifMatch, 'If-Match');

    return this.runCodecCalDav(async () => {
      const client = this.eventClient(scope);
      const codec = new ICalendarEventCodec();
      const current = await client.getEvent(normalizedEventId);
      const encoded = codec
        .parse(scope.calendarId, normalizedEventId, current.icalendar)
        .applyOccurrenceCancellation(recurrenceId);
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
    _openIdCredential: IMatrixOpenIdCredential | undefined,
    @Headers('if-match') ifMatch?: string,
    @Query('roomId') roomId?: string,
    @Query('calendarId') calendarId?: string,
    @Query('eventId') eventId?: string,
  ): Promise<void> {
    const requestedCalendarId = this.requireQuery(calendarId, 'calendarId');
    const scope = await this.eventScope(
      userContext,
      roomId,
      requestedCalendarId,
      {
        action: 'delete-event',
        calendarId: requestedCalendarId,
        eventId: this.requireQuery(eventId, 'eventId'),
      },
    );
    const normalizedEventId = this.normalizeEventUrl(
      this.requireQuery(eventId, 'eventId'),
      this.roomCollectionUrl(scope),
    );
    const etag = this.requireQuery(ifMatch, 'If-Match');

    await this.runCalDav(async () => {
      await this.eventClient(scope).deleteEvent(normalizedEventId, etag);
    });
  }

  private async eventScope(
    userContext: IUserContext,
    roomId: string | undefined,
    calendarId: string,
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

    return this.resolveRoomTarget(requiredRoomId, calendarId);
  }

  private resolveRoomTarget(
    roomId: string,
    requestedCalendarId?: string,
  ): RoomCalendarTarget {
    try {
      const binding = resolveRoomCalendarBinding(
        this.appConfig.room_calendar_bindings,
        roomId,
        requestedCalendarId,
      );
      return {
        roomId: binding.roomId,
        calendarId: binding.calendarId,
        principal: { kind: 'service' },
      };
    } catch (error) {
      if (!(error instanceof RoomCalendarBindingError)) {
        throw error;
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
          throw new BadRequestException({
            code: 'room-calendar-target-mismatch',
            message: 'Requested calendar is not the configured room calendar',
          });
        default:
          throw new ServiceUnavailableException({
            code: 'room-calendar-binding-invalid',
            message: 'Room calendar configuration is invalid',
          });
      }
    }
  }

  private roomCollectionUrl(target: RoomCalendarTarget): string {
    const collectionUrl = this.roomCalendarCalDavAccess.collectionUrl(target);
    return this.asCollectionUrl(
      this.normalizeRadicaleUrl(collectionUrl, 'bound calendar URL'),
    );
  }

  private eventClient(target: RoomCalendarTarget): CalDavEventClient {
    return this.roomCalendarCalDavAccess.createEventClient(target);
  }

  private operatorManagedCollectionError(): ForbiddenException {
    return new ForbiddenException({
      code: 'room-calendar-collection-operator-managed',
      message: 'Room calendar collection changes are managed by the operator',
    });
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
        message: 'RADICALE_URL is required for calendar access',
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

  private normalizeEventUrl(value: string, calendarUrl: string): string {
    const eventUrl = new URL(this.normalizeRadicaleUrl(value, 'eventId'));
    const collectionUrl = new URL(this.asCollectionUrl(calendarUrl));

    const resourcePath = eventUrl.pathname.slice(collectionUrl.pathname.length);
    if (
      eventUrl.search ||
      eventUrl.hash ||
      eventUrl.pathname === collectionUrl.pathname ||
      !eventUrl.pathname.startsWith(collectionUrl.pathname) ||
      resourcePath.includes('/')
    ) {
      throw new BadRequestException(
        'eventId must be within the selected calendar',
      );
    }

    return eventUrl.toString();
  }

  private normalizeOccurrenceEventUrl(
    value: string,
    calendarUrl: string,
  ): string {
    const normalized = this.normalizeEventUrl(value, calendarUrl);
    const eventUrl = new URL(normalized);
    const collectionUrl = new URL(this.asCollectionUrl(calendarUrl));
    if (
      eventUrl.search ||
      eventUrl.hash ||
      eventUrl.pathname === collectionUrl.pathname ||
      eventUrl.pathname.slice(collectionUrl.pathname.length).includes('/')
    ) {
      throw new BadRequestException(
        'eventId must identify one resource directly within the selected calendar',
      );
    }
    return normalized;
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

  private parseCalendarMetadataPatch(input: unknown): CalendarMetadataPatch {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new BadRequestException('calendar metadata patch is required');
    }

    const body = input as Record<string, unknown>;
    const keys = Object.keys(body);
    if (
      keys.length === 0 ||
      keys.some((key) => key !== 'description' && key !== 'color')
    ) {
      throw new BadRequestException(
        'calendar metadata patch may contain only description and color',
      );
    }

    const patch: CalendarMetadataPatch = {};
    if (Object.prototype.hasOwnProperty.call(body, 'description')) {
      if (body.description !== null && typeof body.description !== 'string') {
        throw new BadRequestException(
          'calendar description must be text or null',
        );
      }
      patch.description = body.description as string | null;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'color')) {
      if (
        body.color !== null &&
        (typeof body.color !== 'string' ||
          !/^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/.test(body.color))
      ) {
        throw new BadRequestException(
          'calendar color must be a six- or eight-digit hex color or null',
        );
      }
      patch.color = body.color as string | null;
    }

    return patch;
  }

  private async runCalDav<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
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

  private async runCodecCalDav<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await this.runCalDav(operation);
    } catch (error) {
      if (error instanceof ICalendarEventCodecError) {
        throw new BadRequestException({
          code: error.code,
          message: error.message,
        });
      }
      throw error;
    }
  }
}

const occurrencePatchKeys = new Set([
  'title',
  'description',
  'timing',
  'transparency',
  'location',
  'url',
  'categories',
  'priority',
]);

function parseOccurrenceUpdateBody(input: unknown): {
  recurrenceId: CalendarEventDateTime;
  patch: CalendarEventOccurrencePatch;
} {
  const body = plainRecord(input, 'occurrence patch body');
  if (
    Object.keys(body).length !== 2 ||
    !Object.prototype.hasOwnProperty.call(body, 'recurrenceId') ||
    !Object.prototype.hasOwnProperty.call(body, 'patch')
  ) {
    throw new BadRequestException(
      'occurrence patch body must contain recurrenceId and patch only',
    );
  }
  const recurrenceId = parseOccurrenceIdentity(body.recurrenceId);
  const rawPatch = plainRecord(body.patch, 'occurrence patch');
  const keys = Object.keys(rawPatch);
  if (keys.length === 0 || keys.some((key) => !occurrencePatchKeys.has(key))) {
    throw new BadRequestException(
      'occurrence patch must contain only supported occurrence fields',
    );
  }

  const patch: CalendarEventOccurrencePatch = {};
  for (const key of keys) {
    const value = rawPatch[key];
    switch (key) {
      case 'title':
        if (typeof value !== 'string' || value.trim().length === 0) {
          throw new BadRequestException(
            'occurrence title must be non-empty text',
          );
        }
        patch.title = value;
        break;
      case 'description':
      case 'location':
      case 'url':
        if (value !== null && typeof value !== 'string') {
          throw new BadRequestException(`${key} must be text or null`);
        }
        if (key === 'description') patch.description = value as string | null;
        if (key === 'location') patch.location = value as string | null;
        if (key === 'url') patch.url = value as string | null;
        break;
      case 'timing':
        patch.timing = parseOccurrenceTiming(value, recurrenceId);
        break;
      case 'transparency':
        if (value !== 'opaque' && value !== 'transparent') {
          throw new BadRequestException(
            'occurrence transparency must be opaque or transparent',
          );
        }
        patch.transparency = value;
        break;
      case 'categories':
        if (
          !Array.isArray(value) ||
          value.some((category) => typeof category !== 'string')
        ) {
          throw new BadRequestException(
            'occurrence categories must be an array of text values',
          );
        }
        patch.categories = [...value] as string[];
        break;
      case 'priority':
        if (
          value !== null &&
          (typeof value !== 'number' || !Number.isInteger(value))
        ) {
          throw new BadRequestException(
            'occurrence priority must be an integer or null',
          );
        }
        patch.priority = value as number | null;
        break;
    }
  }
  return { recurrenceId, patch };
}

function parseOccurrenceCancelBody(input: unknown): CalendarEventDateTime {
  const body = plainRecord(input, 'occurrence cancellation body');
  if (
    Object.keys(body).length !== 1 ||
    !Object.prototype.hasOwnProperty.call(body, 'recurrenceId')
  ) {
    throw new BadRequestException(
      'occurrence cancellation body must contain recurrenceId only',
    );
  }
  return parseOccurrenceIdentity(body.recurrenceId);
}

function parseFollowingOccurrenceBody(input: unknown): {
  recurrenceId: CalendarEventDateTime;
  timing: NonNullable<CalendarEventOccurrencePatch['timing']>;
} {
  const body = plainRecord(input, 'following occurrence patch body');
  if (
    Object.keys(body).length !== 2 ||
    !Object.prototype.hasOwnProperty.call(body, 'recurrenceId') ||
    !Object.prototype.hasOwnProperty.call(body, 'timing')
  ) {
    throw new BadRequestException(
      'following occurrence patch must contain only recurrenceId and timing',
    );
  }
  const recurrenceId = parseOccurrenceIdentity(body.recurrenceId);
  const timing = parseOccurrenceTiming(body.timing, recurrenceId);
  if (!timing) {
    throw new BadRequestException('following occurrence timing is required');
  }
  return { recurrenceId, timing };
}

function parseOccurrenceIdentity(input: unknown): CalendarEventDateTime {
  const identity = plainRecord(input, 'recurrenceId');
  if (
    Object.keys(identity).length !== 2 ||
    (identity.type !== 'date' && identity.type !== 'date-time') ||
    !Object.prototype.hasOwnProperty.call(identity, 'value')
  ) {
    throw new BadRequestException('recurrenceId has an invalid value type');
  }
  if (identity.type === 'date') {
    if (typeof identity.value !== 'string' || !isValidDate(identity.value)) {
      throw new BadRequestException('recurrenceId DATE must be YYYY-MM-DD');
    }
    return { type: 'date', value: identity.value };
  }

  return {
    type: 'date-time',
    value: parseZonedDateTime(identity.value, 'recurrenceId'),
  };
}

function parseOccurrenceTiming(
  input: unknown,
  recurrenceId: CalendarEventDateTime,
): CalendarEventOccurrencePatch['timing'] {
  const timing = plainRecord(input, 'occurrence timing');
  if (timing.type === 'all-day') {
    if (
      Object.keys(timing).length !== 3 ||
      recurrenceId.type !== 'date' ||
      typeof timing.startDate !== 'string' ||
      typeof timing.endDate !== 'string' ||
      !isValidDate(timing.startDate) ||
      !isValidDate(timing.endDate) ||
      timing.endDate <= timing.startDate
    ) {
      throw new BadRequestException(
        'all-day occurrence timing must use a valid DATE range matching recurrenceId',
      );
    }
    return {
      type: 'all-day',
      startDate: timing.startDate,
      endDate: timing.endDate,
    };
  }
  if (
    timing.type !== 'timed' ||
    Object.keys(timing).length !== 3 ||
    recurrenceId.type !== 'date-time'
  ) {
    throw new BadRequestException(
      'timed occurrence timing must use DATE-TIME values matching recurrenceId',
    );
  }
  const start = parseZonedDateTime(timing.start, 'timing.start');
  const end = parseZonedDateTime(timing.end, 'timing.end');
  if (
    start.mode !== end.mode ||
    start.timezone !== end.timezone ||
    end.local <= start.local
  ) {
    throw new BadRequestException(
      'timed occurrence values must use one mode and timezone and end after start',
    );
  }
  return { type: 'timed', start, end };
}

function parseZonedDateTime(
  input: unknown,
  field: string,
): { local: string; timezone: string; mode: 'floating' | 'utc' | 'tzid' } {
  const value = plainRecord(input, field);
  if (
    Object.keys(value).some(
      (key) => !['local', 'timezone', 'mode'].includes(key),
    ) ||
    typeof value.local !== 'string' ||
    typeof value.timezone !== 'string' ||
    !['floating', 'utc', 'tzid'].includes(String(value.mode))
  ) {
    throw new BadRequestException(
      `${field} must include local, timezone, and mode`,
    );
  }
  const local = value.local;
  const timezone = value.timezone;
  const mode = value.mode as 'floating' | 'utc' | 'tzid';
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/.test(local) ||
    !isValidDateTime(local) ||
    (mode === 'floating' && timezone !== 'floating') ||
    (mode === 'utc' && timezone !== 'UTC') ||
    (mode === 'tzid' &&
      (!timezone || timezone === 'UTC' || timezone === 'floating'))
  ) {
    throw new BadRequestException(
      `${field} has inconsistent DATE-TIME mode or timezone`,
    );
  }
  return { local, timezone, mode };
}

function plainRecord(input: unknown, field: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new BadRequestException(`${field} must be an object`);
  }
  return input as Record<string, unknown>;
}

function isValidDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
}

function isValidDateTime(value: string): boolean {
  const [date, time] = value.split('T');
  if (!isValidDate(date)) return false;
  const match = /^(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/.exec(time);
  if (!match) return false;
  return (
    Number(match[1]) <= 23 && Number(match[2]) <= 59 && Number(match[3]) <= 59
  );
}
