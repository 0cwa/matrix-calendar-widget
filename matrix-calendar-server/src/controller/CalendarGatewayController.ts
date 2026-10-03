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
  isCalendarTimezoneSupported,
  projectCalendarEventOccurrences,
  type CalendarEventListDiagnosticReason,
} from '@matrix-calendar-widget/calendar';
import {
  BadGatewayException,
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
  Optional,
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
  ICalendarEventCodecError,
  MatrixOpenIdCalDavCredentialError,
  MatrixOpenIdCalDavCredentialProviderFactory,
} from '../caldav';
import { isSafeSingleVeventSeries } from '../caldav/ICalendarDeletionSafety';
import { MatrixOpenIdCredentialParam } from '../decorator/MatrixOpenIdCredentialParam';
import { UserContextParam } from '../decorator/UserContextParam';
import { CalendarGatewayCalendarDto } from '../dto/CalendarGatewayCalendarDto';
import { CalendarGatewayContextDto } from '../dto/CalendarGatewayContextDto';
import { CalendarGatewayDiagnosticsDto } from '../dto/CalendarGatewayDiagnosticsDto';
import { CalendarGatewayEventDto } from '../dto/CalendarGatewayEventDto';
import { CalendarGatewayEventListDto } from '../dto/CalendarGatewayEventListDto';
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
import {
  RoomCalendarEventOperationError,
  RoomCalendarEventOperations,
} from '../service/RoomCalendarEventOperations';

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
    private readonly credentialProviderFactory: MatrixOpenIdCalDavCredentialProviderFactory,
    @Inject(ModuleProviderToken.ROOM_CALENDAR_CALDAV_ACCESS)
    private readonly roomCalendarCalDavAccess: RoomCalendarCalDavAccess,
    @Optional()
    @Inject(RoomCalendarEventOperations)
    private readonly roomCalendarEventOperations: RoomCalendarEventOperations = new RoomCalendarEventOperations(),
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
    @Query('target') target?: string,
  ): Promise<CalendarGatewayCalendarDto[]> {
    if (this.isRoomTarget(target)) {
      const roomTarget = await this.authorizeRoomCalendarTarget(
        userContext,
        roomId,
        undefined,
        { action: 'list-calendars' },
      );
      return [
        new CalendarGatewayCalendarDto(
          roomTarget.calendarId,
          roomTarget.calendarId,
          undefined,
          true,
        ),
      ];
    }

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
    const credentialProvider = this.credentialProviderFactory.forRequest(
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
            calendar.description,
            calendar.components,
          ),
      );
    });
  }

  @Get('calendars/diagnostics')
  async getCalendarDiagnostics(
    @UserContextParam() userContext: IUserContext,
    @MatrixOpenIdCredentialParam()
    openIdCredential: IMatrixOpenIdCredential | undefined,
    @Query('roomId') roomId?: string,
    @Query('target') target?: string,
  ): Promise<CalendarGatewayDiagnosticsDto> {
    if (this.isRoomTarget(target)) {
      const roomTarget = await this.authorizeRoomCalendarTarget(
        userContext,
        roomId,
        undefined,
        { action: 'manage-calendar', calendarId: '' },
      );
      return this.roomCalendarCalDavAccess.assertDisabled(roomTarget);
    }

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

    let radicaleUrl: string;
    try {
      radicaleUrl = this.requireRadicaleBaseUrl();
    } catch {
      throw calendarDiagnosticsUnavailable();
    }

    const credentialProvider = this.credentialProviderFactory.forRequest(
      userContext,
      openIdCredential,
    );

    return this.runCalDav(async () => {
      try {
        const discovery = await new CalDavDiscoveryClient(
          radicaleUrl,
          credentialProvider,
        ).discover();
        const excludedRoots = new Set(
          [radicaleUrl, discovery.principalUrl, discovery.calendarHomeUrl].map(
            normalizeUrlForComparison,
          ),
        );

        return new CalendarGatewayDiagnosticsDto(
          discovery.calendars.flatMap((calendar) => {
            const url = safeCalendarCollectionUrl(
              calendar.rawHref ?? calendar.href,
              calendar.href,
              radicaleUrl,
              excludedRoots,
            );
            return url ? [{ name: calendar.displayName, url }] : [];
          }),
        );
      } catch (error) {
        if (error instanceof MatrixOpenIdCalDavCredentialError) {
          throw error;
        }

        throw calendarDiagnosticsUnavailable();
      }
    });
  }

  @Post('calendars')
  async createCalendar(
    @UserContextParam() userContext: IUserContext,
    @MatrixOpenIdCredentialParam()
    openIdCredential: IMatrixOpenIdCredential | undefined,
    @Body() input: { name?: string },
    @Query('roomId') roomId?: string,
    @Query('target') target?: string,
  ): Promise<CalendarGatewayCalendarDto> {
    const requiredRoomId = this.requireQuery(roomId, 'roomId');
    const name = input?.name?.trim();
    if (!name) {
      throw new BadRequestException('calendar name is required');
    }

    if (this.isRoomTarget(target)) {
      await this.authorizeRoomCalendarTarget(userContext, roomId, undefined, {
        action: 'create-calendar',
      });
      throw this.operatorManagedCollectionError();
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

    const credentialProvider = this.credentialProviderFactory.forRequest(
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
        calendar.description,
      );
    });
  }

  @Patch('calendars/description')
  async updateCalendarDescription(
    @UserContextParam() userContext: IUserContext,
    @MatrixOpenIdCredentialParam()
    openIdCredential: IMatrixOpenIdCredential | undefined,
    @Body() input: { description?: unknown } | undefined,
    @Query('roomId') roomId?: string,
    @Query('calendarId') calendarId?: string,
    @Query('target') target?: string,
  ): Promise<void> {
    if (!input || Object.keys(input).length !== 1) {
      throw new BadRequestException(
        'calendar description must be the only string property',
      );
    }
    const description = input.description;
    if (
      !Object.prototype.hasOwnProperty.call(input, 'description') ||
      typeof description !== 'string'
    ) {
      throw new BadRequestException(
        'calendar description must be the only string property',
      );
    }

    if (this.isRoomTarget(target)) {
      await this.authorizeRoomCalendarTarget(userContext, roomId, calendarId, {
        action: 'manage-calendar',
        calendarId: calendarId ?? '',
      });
      throw this.operatorManagedCollectionError();
    }

    const requiredRoomId = this.requireQuery(roomId, 'roomId');
    const normalizedCalendarId = this.normalizeRadicaleUrl(
      this.requireQuery(calendarId, 'calendarId'),
      'calendarId',
    );
    const authorization = this.authorizationFactory.forRoom(
      userContext.userId,
      requiredRoomId,
    );
    if (
      !(await authorization.isAllowed({
        action: 'manage-calendar',
        calendarId: normalizedCalendarId,
      }))
    ) {
      throw new ForbiddenException(
        'Not allowed to manage calendars for this Matrix room',
      );
    }

    const credentialProvider = this.credentialProviderFactory.forRequest(
      userContext,
      openIdCredential,
    );

    await this.runCalDav(async () => {
      await new CalDavDiscoveryClient(
        this.requireRadicaleBaseUrl(),
        credentialProvider,
      ).updateCalendarDescription(normalizedCalendarId, description);
    });
  }

  @Patch('calendars/color')
  async updateCalendarColor(
    @UserContextParam() userContext: IUserContext,
    @MatrixOpenIdCredentialParam()
    openIdCredential: IMatrixOpenIdCredential | undefined,
    @Body() input: { color?: unknown } | undefined,
    @Query('roomId') roomId?: string,
    @Query('calendarId') calendarId?: string,
    @Query('target') target?: string,
  ): Promise<void> {
    if (
      !input ||
      Object.keys(input).length !== 1 ||
      !Object.prototype.hasOwnProperty.call(input, 'color') ||
      typeof input.color !== 'string' ||
      (input.color !== '' && !/^#[\da-fA-F]{6}$/.test(input.color))
    ) {
      throw new BadRequestException(
        'calendar color must be empty or a six-digit hex color',
      );
    }
    const color = input.color;

    if (this.isRoomTarget(target)) {
      await this.authorizeRoomCalendarTarget(userContext, roomId, calendarId, {
        action: 'manage-calendar',
        calendarId: calendarId ?? '',
      });
      throw this.operatorManagedCollectionError();
    }

    const requiredRoomId = this.requireQuery(roomId, 'roomId');
    const normalizedCalendarId = this.normalizeRadicaleUrl(
      this.requireQuery(calendarId, 'calendarId'),
      'calendarId',
    );
    const authorization = this.authorizationFactory.forRoom(
      userContext.userId,
      requiredRoomId,
    );
    if (
      !(await authorization.isAllowed({
        action: 'manage-calendar',
        calendarId: normalizedCalendarId,
      }))
    ) {
      throw new ForbiddenException(
        'Not allowed to manage calendars for this Matrix room',
      );
    }

    const credentialProvider = this.credentialProviderFactory.forRequest(
      userContext,
      openIdCredential,
    );

    await this.runCalDav(async () => {
      await new CalDavDiscoveryClient(
        this.requireRadicaleBaseUrl(),
        credentialProvider,
      ).updateCalendarColor(normalizedCalendarId, color);
    });
  }

  @Patch('calendars')
  async renameCalendar(
    @UserContextParam() userContext: IUserContext,
    @MatrixOpenIdCredentialParam()
    openIdCredential: IMatrixOpenIdCredential | undefined,
    @Body() input: { name?: string },
    @Query('roomId') roomId?: string,
    @Query('calendarId') calendarId?: string,
    @Query('target') target?: string,
  ): Promise<void> {
    const requiredRoomId = this.requireQuery(roomId, 'roomId');
    const name = input?.name?.trim();
    if (!name) {
      throw new BadRequestException('calendar name is required');
    }

    if (this.isRoomTarget(target)) {
      await this.authorizeRoomCalendarTarget(userContext, roomId, calendarId, {
        action: 'manage-calendar',
        calendarId: calendarId ?? '',
      });
      throw this.operatorManagedCollectionError();
    }

    const normalizedCalendarId = this.normalizeRadicaleUrl(
      this.requireQuery(calendarId, 'calendarId'),
      'calendarId',
    );
    const authorization = this.authorizationFactory.forRoom(
      userContext.userId,
      requiredRoomId,
    );
    if (
      !(await authorization.isAllowed({
        action: 'manage-calendar',
        calendarId: normalizedCalendarId,
      }))
    ) {
      throw new ForbiddenException(
        'Not allowed to manage calendars for this Matrix room',
      );
    }

    const credentialProvider = this.credentialProviderFactory.forRequest(
      userContext,
      openIdCredential,
    );

    await this.runCalDav(async () => {
      await new CalDavDiscoveryClient(
        this.requireRadicaleBaseUrl(),
        credentialProvider,
      ).renameCalendar(normalizedCalendarId, name);
    });
  }

  @Delete('calendars')
  async deleteCalendar(
    @UserContextParam() userContext: IUserContext,
    @MatrixOpenIdCredentialParam()
    openIdCredential: IMatrixOpenIdCredential | undefined,
    @Query('roomId') roomId?: string,
    @Query('calendarId') calendarId?: string,
    @Query('target') target?: string,
  ): Promise<void> {
    if (this.isRoomTarget(target)) {
      await this.authorizeRoomCalendarTarget(userContext, roomId, calendarId, {
        action: 'manage-calendar',
        calendarId: calendarId ?? '',
      });
      throw this.operatorManagedCollectionError();
    }

    const requestedCalendarId = this.requireQuery(calendarId, 'calendarId');
    const scope = await this.eventScope(
      userContext,
      roomId,
      requestedCalendarId,
      {
        action: 'manage-calendar',
        calendarId: requestedCalendarId,
      },
    );
    const client = new CalDavDiscoveryClient(
      this.requireRadicaleBaseUrl(),
      this.credentialProviderFactory.forRequest(userContext, openIdCredential),
    );

    await this.runCalDav(async () => {
      const discovery = await client.discover();
      const calendar = discovery.calendars.find(
        (candidate) => candidate.href === scope.calendarId,
      );
      if (
        !calendar?.components ||
        calendar.components.length !== 1 ||
        calendar.components[0] !== 'VEVENT' ||
        calendar.readOnly !== false
      ) {
        throw new ConflictException({
          code: 'calendar-delete-unsafe',
          message:
            'Calendar deletion is only allowed for explicitly VEVENT-only collections',
        });
      }

      await client.deleteCalendar(scope.calendarId);
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
    @Query('timezone') timezone?: string,
    @Query('target') target?: string,
  ): Promise<CalendarGatewayEventListDto> {
    if (this.isRoomTarget(target)) {
      const viewerTimezone = this.requireQuery(timezone, 'timezone');
      if (!isCalendarTimezoneSupported(viewerTimezone)) {
        throw new BadRequestException({
          code: 'unsupported-timezone',
          message: 'timezone must be a supported IANA time zone',
        });
      }
      const range: CalendarTimeRange = {
        start: this.requireQuery(start, 'start'),
        end: this.requireQuery(end, 'end'),
      };
      const roomTarget = await this.authorizeRoomCalendarTarget(
        userContext,
        roomId,
        calendarId,
        { action: 'read-events', calendarId: calendarId ?? '' },
      );

      return this.runCalDav(async () => {
        const principal =
          await this.roomCalendarCalDavAccess.forAuthorizedTarget(
            roomTarget,
            'read',
          );
        return this.listCalendarEvents(
          this.eventClientForPrincipal(principal.userId, principal.credential),
          principal.calendarUrl,
          range,
          viewerTimezone,
        );
      });
    }

    const requestedCalendarId = this.requireQuery(calendarId, 'calendarId');
    const viewerTimezone = this.requireQuery(timezone, 'timezone');
    if (!isCalendarTimezoneSupported(viewerTimezone)) {
      throw new BadRequestException({
        code: 'unsupported-timezone',
        message: 'timezone must be a supported IANA time zone',
      });
    }
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

    return this.runCalDav(() =>
      this.listCalendarEvents(
        this.eventClient(userContext, openIdCredential),
        scope.calendarId,
        range,
        viewerTimezone,
      ),
    );
  }

  @Get('event')
  async getEvent(
    @UserContextParam() userContext: IUserContext,
    @MatrixOpenIdCredentialParam()
    openIdCredential: IMatrixOpenIdCredential | undefined,
    @Query('roomId') roomId?: string,
    @Query('calendarId') calendarId?: string,
    @Query('eventId') eventId?: string,
    @Query('target') target?: string,
  ): Promise<CalendarGatewayEventDto> {
    if (this.isRoomTarget(target)) {
      const roomTarget = await this.authorizeRoomCalendarTarget(
        userContext,
        roomId,
        calendarId,
        { action: 'read-events', calendarId: calendarId ?? '' },
      );
      const requiredEventId = this.requireQuery(eventId, 'eventId');
      const principal = await this.roomCalendarCalDavAccess.forAuthorizedTarget(
        roomTarget,
        'read',
      );
      const result = await this.runCalDav(() =>
        this.roomCalendarEventOperations.getEvent(
          { target: roomTarget, servicePrincipal: principal },
          requiredEventId,
        ),
      );
      return new CalendarGatewayEventDto(result.event, result.etag);
    }

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
    @Query('target') target?: string,
  ): Promise<CalendarGatewayEventDto> {
    if (this.isRoomTarget(target)) {
      const roomTarget = await this.authorizeRoomCalendarTarget(
        userContext,
        roomId,
        calendarId,
        { action: 'create-event', calendarId: calendarId ?? '' },
      );
      if (
        !input ||
        typeof input.uid !== 'string' ||
        !isSafeRoomCalendarEventUid(input.uid)
      ) {
        throw new BadRequestException('event uid is required');
      }
      const principal = await this.roomCalendarCalDavAccess.forAuthorizedTarget(
        roomTarget,
        'write',
      );
      const result = await this.runCalDav(() =>
        this.roomCalendarEventOperations.createEvent(
          { target: roomTarget, servicePrincipal: principal },
          input,
        ),
      );
      return new CalendarGatewayEventDto(result.event, result.etag);
    }

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
    @Query('target') target?: string,
  ): Promise<CalendarGatewayEventDto> {
    if (this.isRoomTarget(target)) {
      const roomTarget = await this.authorizeRoomCalendarTarget(
        userContext,
        roomId,
        calendarId,
        {
          action: 'update-event',
          calendarId: calendarId ?? '',
          eventId: eventId ?? '',
        },
      );
      const requiredEventId = this.requireQuery(eventId, 'eventId');
      const expectedEtag = this.requireQuery(ifMatch, 'If-Match');
      const principal = await this.roomCalendarCalDavAccess.forAuthorizedTarget(
        roomTarget,
        'write',
      );
      const result = await this.runCalDav(() =>
        this.roomCalendarEventOperations.updateEvent(
          { target: roomTarget, servicePrincipal: principal },
          requiredEventId,
          expectedEtag,
          patch ?? {},
        ),
      );
      return new CalendarGatewayEventDto(result.event, result.etag);
    }

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

      if (
        patch?.recurrence &&
        'occurrence' in patch.recurrence &&
        encoded.icalendar === current.icalendar &&
        etag === current.etag
      ) {
        return this.eventDto(codec, scope.calendarId, current);
      }

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
    @Query('target') target?: string,
  ): Promise<void> {
    if (this.isRoomTarget(target)) {
      const roomTarget = await this.authorizeRoomCalendarTarget(
        userContext,
        roomId,
        calendarId,
        {
          action: 'delete-event',
          calendarId: calendarId ?? '',
          eventId: eventId ?? '',
        },
      );
      const requiredEventId = this.requireQuery(eventId, 'eventId');
      const expectedEtag = this.requireQuery(ifMatch, 'If-Match');
      const principal = await this.roomCalendarCalDavAccess.forAuthorizedTarget(
        roomTarget,
        'write',
      );
      await this.runCalDav(() =>
        this.roomCalendarEventOperations.deleteEvent(
          { target: roomTarget, servicePrincipal: principal },
          requiredEventId,
          expectedEtag,
        ),
      );
      return;
    }

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
    if (!isConcreteStrongEtag(etag)) {
      throw new BadRequestException({
        code: 'invalid-event-etag',
        message: 'If-Match must contain one strong ETag',
      });
    }

    await this.runCalDav(async () => {
      const client = this.eventClient(userContext, openIdCredential);
      const current = await client.getEvent(normalizedEventId);
      if (current.etag !== etag) {
        throw new ConflictException({
          code: 'etag-conflict',
          message: 'Calendar event changed; reload before retrying',
        });
      }
      if (!isSafeSingleVeventSeries(current.icalendar)) {
        throw new ConflictException({
          code: 'unsafe-event-resource',
          message: 'Calendar event contains data that cannot be safely deleted',
        });
      }
      await client.deleteEvent(normalizedEventId, etag);
    });
  }

  private isRoomTarget(target: string | undefined): boolean {
    if (target === undefined || target === 'personal') {
      return false;
    }
    if (target === 'room') {
      return true;
    }

    throw new BadRequestException({
      code: 'invalid-calendar-target',
      message: 'target must be personal or room',
    });
  }

  private async authorizeRoomCalendarTarget(
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

  private operatorManagedCollectionError(): ForbiddenException {
    return new ForbiddenException({
      code: 'room-calendar-collection-operator-managed',
      message: 'Room calendar collection changes are managed by the operator',
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
      this.credentialProviderFactory.forRequest(userContext, openIdCredential),
      fetch,
      this.appConfig.caldav_max_event_response_bytes,
    );
  }

  private eventClientForPrincipal(
    userId: string,
    openIdCredential: IMatrixOpenIdCredential,
  ): CalDavEventClient {
    return new CalDavEventClient(
      this.credentialProviderFactory.forPrincipal(userId, openIdCredential),
      fetch,
      this.appConfig.caldav_max_event_response_bytes,
    );
  }

  private async listCalendarEvents(
    client: CalDavEventClient,
    calendarId: string,
    range: CalendarTimeRange,
    viewerTimezone: string,
  ): Promise<CalendarGatewayEventListDto> {
    const codec = new ICalendarEventCodec();
    const resources = await client.listEvents(calendarId, range);
    const parsedResources = resources.map((resource) => {
      const parsed = codec.parse(calendarId, resource.href, resource.icalendar);
      return { resource, parsed, event: parsed.event };
    });
    const rangeUnsupportedResources = parsedResources.filter(
      ({ event }) => event.unsupportedRecurrence === 'range-this-and-future',
    );
    const projectionUnsupportedResources = parsedResources.filter(
      ({ parsed }) => parsed.listProjectionDiagnostic !== undefined,
    );
    const projectableResources = parsedResources.filter(
      ({ event, parsed }) =>
        event.unsupportedRecurrence !== 'range-this-and-future' &&
        parsed.listProjectionDiagnostic === undefined,
    );
    const projection = projectCalendarEventOccurrences(
      projectableResources.map(({ event }) => event),
      range,
      viewerTimezone,
    );
    const inRangeResourceIds = new Set(
      projection.occurrences.map(({ sourceEvent }) => sourceEvent.id),
    );
    const diagnosticCounts = new Map<
      CalendarEventListDiagnosticReason,
      number
    >();
    const addDiagnostic = (reason: CalendarEventListDiagnosticReason) => {
      diagnosticCounts.set(reason, (diagnosticCounts.get(reason) ?? 0) + 1);
    };

    if (rangeUnsupportedResources.length > 0) {
      diagnosticCounts.set(
        'range-this-and-future',
        rangeUnsupportedResources.length,
      );
    }
    if (projectionUnsupportedResources.length > 0) {
      diagnosticCounts.set(
        'unsupported-recurrence',
        projectionUnsupportedResources.length,
      );
    }
    for (const diagnostic of projection.diagnostics) {
      addDiagnostic(diagnostic.reason);
    }

    return new CalendarGatewayEventListDto(
      parsedResources
        .filter(({ event }) => inRangeResourceIds.has(event.id))
        .map(
          ({ resource, event }) =>
            new CalendarGatewayEventDto(event, resource.etag),
        ),
      [...diagnosticCounts.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([reason, count]) => ({ reason, count })),
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

      if (
        error instanceof CalDavEventTransportError &&
        ['redirected', 'response-read-failed', 'response-too-large'].includes(
          error.code,
        )
      ) {
        throw new BadGatewayException({
          code: 'caldav-upstream-error',
          message: 'CalDAV event request failed',
        });
      }

      if (error instanceof ICalendarEventCodecError) {
        throw new BadRequestException({
          code: error.code,
          message: error.message,
        });
      }

      if (error instanceof RoomCalendarEventOperationError) {
        switch (error.code) {
          case 'invalid-event-url':
          case 'invalid-event-etag':
          case 'invalid-event-input':
            throw new BadRequestException({
              code: error.code,
              message: 'Room calendar event request is invalid',
            });
          case 'etag-conflict':
            throw new ConflictException({
              code: error.code,
              message: 'Room calendar event changed; reload before retrying',
            });
          case 'unsafe-event-resource':
            throw new ConflictException({
              code: error.code,
              message:
                'Room calendar event contains data that cannot be safely deleted',
            });
          case 'event-write-disabled':
          case 'invalid-room-access':
            throw new ServiceUnavailableException({
              code: 'room-calendar-caldav-disabled',
              message: 'Room calendar CalDAV access is not enabled',
            });
        }
      }

      throw error;
    }
  }
}

function calendarDiagnosticsUnavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    code: 'calendar-diagnostics-unavailable',
    message: 'CalDAV diagnostics are unavailable',
  });
}

function isSafeRoomCalendarEventUid(value: string): boolean {
  if (
    value.length === 0 ||
    Buffer.byteLength(value, 'utf8') > 251 ||
    /%[0-9a-f]{2}/i.test(value) ||
    containsSlashOrControlCharacters(value)
  ) {
    return false;
  }

  try {
    encodeURIComponent(value);
    return true;
  } catch {
    return false;
  }
}

function containsSlashOrControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (
      value[index] === '/' ||
      value[index] === '\\' ||
      code <= 0x1f ||
      code === 0x7f
    ) {
      return true;
    }
  }
  return false;
}

function isConcreteStrongEtag(value: string): boolean {
  return value.trim() === value && /^"[\x21\x23-\x7e]*"$/.test(value);
}

function safeCalendarCollectionUrl(
  rawHref: string,
  resolvedHref: string,
  radicaleUrl: string,
  excludedRoots: Set<string>,
): string | undefined {
  let url: URL;
  let serviceUrl: URL;
  const trimmedRawHref = rawHref.trim();
  const rawPath = rawDavHrefPath(trimmedRawHref);
  try {
    url = new URL(resolvedHref);
    serviceUrl = new URL(radicaleUrl);
  } catch {
    return undefined;
  }

  const servicePath = serviceUrl.pathname.endsWith('/')
    ? serviceUrl.pathname
    : `${serviceUrl.pathname}/`;
  let collectionPath: string;
  let decodedServicePath: string;
  try {
    collectionPath = decodeURIComponent(url.pathname);
    decodedServicePath = decodeURIComponent(servicePath);
  } catch {
    return undefined;
  }
  const hasEncodedPathSeparator = /%(?:2f|5c)/i.test(url.pathname);
  const hasDotSegment = collectionPath
    .split('/')
    .some((segment) => segment === '.' || segment === '..');
  const hasUnsafeRawHref =
    !rawPath ||
    trimmedRawHref.includes('\\') ||
    /%(?:2f|5c)/i.test(rawPath) ||
    rawPath.split('/').some((segment) => {
      try {
        const decodedSegment = decodeURIComponent(segment);
        return decodedSegment === '.' || decodedSegment === '..';
      } catch {
        return true;
      }
    });

  if (
    (serviceUrl.protocol !== 'http:' && serviceUrl.protocol !== 'https:') ||
    url.username ||
    url.password ||
    rawHrefHasUserInfo(trimmedRawHref) ||
    /[?#]/.test(trimmedRawHref) ||
    url.search ||
    url.hash ||
    url.origin !== serviceUrl.origin ||
    !url.pathname.startsWith(servicePath) ||
    !collectionPath.startsWith(decodedServicePath) ||
    hasEncodedPathSeparator ||
    hasDotSegment ||
    hasUnsafeRawHref ||
    excludedRoots.has(normalizeUrlForComparison(url.toString()))
  ) {
    return undefined;
  }

  return url.toString();
}

function rawDavHrefPath(value: string): string | undefined {
  const authorityPrefix = /^(?:[a-z][a-z\d+.-]*:)?\/\//i.exec(value)?.[0];
  if (authorityPrefix) {
    const afterAuthorityPrefix = value.slice(authorityPrefix.length);
    const pathStart = afterAuthorityPrefix.search(/[/?#]/);
    if (pathStart < 0 || afterAuthorityPrefix[pathStart] !== '/') {
      return '/';
    }

    return afterAuthorityPrefix.slice(pathStart).split(/[?#]/, 1)[0];
  }

  return value.split(/[?#]/, 1)[0];
}

function rawHrefHasUserInfo(value: string): boolean {
  const authorityPrefix = /^(?:[a-z][a-z\d+.-]*:)?\/\//i.exec(value)?.[0];
  if (!authorityPrefix) {
    return false;
  }

  const authority = value.slice(authorityPrefix.length).split(/[/?#]/, 1)[0];
  return authority.includes('@');
}

function normalizeUrlForComparison(value: string): string {
  const url = new URL(value);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  return `${url.origin}${path}`;
}
