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
  CalendarEventAttachmentValidationError,
  CalendarEventConferenceValidationError,
  CalendarEventInput,
  CalendarEventOccurrenceValidationError,
  CalendarEventPatch,
  validateCalendarEventInputAttachment,
  validateCalendarEventInputConference,
  validateCalendarEventPatchAttachment,
  validateCalendarEventPatchConference,
  validateCalendarEventPatchOccurrence,
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
  UseGuards,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { IAppConfiguration } from '../IAppConfiguration';
import { ModuleProviderToken } from '../ModuleProviderToken';
import {
  CalDavDiscoveryClient,
  MatrixOpenIdCalDavCredentialError,
  MatrixOpenIdCalDavCredentialProviderFactory,
} from '../caldav';
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
import { GatewayAccessService } from '../service/GatewayAccessService';
import { GatewayContextService } from '../service/GatewayContextService';
import { MatrixCalendarAuthorizationFactory } from '../service/MatrixCalendarAuthorization';
import { RoomCalendarCalDavAccess } from '../service/RoomCalendarCalDavAccess';

import { GatewayEventService } from '../service/GatewayEventService';
import { runCalDav } from './runGatewayCalDav';

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
    private readonly gatewayAccessService: GatewayAccessService,
    private readonly gatewayContextService: GatewayContextService,
    private readonly gatewayEventService: GatewayEventService,
  ) {}

  @Get('context')
  async getContext(
    @UserContextParam() userContext: IUserContext,
    @Query('roomId') roomId?: string,
  ): Promise<CalendarGatewayContextDto> {
    return this.gatewayContextService.getContext(userContext, roomId);
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
      const canWriteEvents =
        this.appConfig.room_calendar_access_enabled === true &&
        this.appConfig.room_calendar_event_writes_enabled === true &&
        (await authorization.isAllowed({
          action: 'create-event',
          calendarId: roomTarget.calendarId,
        }));
      return [
        new CalendarGatewayCalendarDto(
          roomTarget.calendarId,
          'Room calendar',
          undefined,
          !canWriteEvents,
          undefined,
          ['VEVENT'],
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

    return runCalDav(async () => {
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
      const roomTarget =
        await this.gatewayAccessService.authorizeRoomCalendarTarget(
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

    return runCalDav(async () => {
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
      await this.gatewayAccessService.authorizeRoomCalendarTarget(
        userContext,
        roomId,
        undefined,
        {
          action: 'create-calendar',
        },
      );
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

    return runCalDav(async () => {
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
      await this.gatewayAccessService.authorizeRoomCalendarTarget(
        userContext,
        roomId,
        calendarId,
        {
          action: 'manage-calendar',
          calendarId: calendarId ?? '',
        },
      );
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

    await runCalDav(async () => {
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
      await this.gatewayAccessService.authorizeRoomCalendarTarget(
        userContext,
        roomId,
        calendarId,
        {
          action: 'manage-calendar',
          calendarId: calendarId ?? '',
        },
      );
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

    await runCalDav(async () => {
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
      await this.gatewayAccessService.authorizeRoomCalendarTarget(
        userContext,
        roomId,
        calendarId,
        {
          action: 'manage-calendar',
          calendarId: calendarId ?? '',
        },
      );
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

    await runCalDav(async () => {
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
      await this.gatewayAccessService.authorizeRoomCalendarTarget(
        userContext,
        roomId,
        calendarId,
        {
          action: 'manage-calendar',
          calendarId: calendarId ?? '',
        },
      );
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

    await runCalDav(async () => {
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
    return this.gatewayEventService.listEvents(
      userContext,
      openIdCredential,
      roomId,
      calendarId,
      start,
      end,
      timezone,
      target,
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
    return this.gatewayEventService.getEvent(
      userContext,
      openIdCredential,
      roomId,
      calendarId,
      eventId,
      target,
    );
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
    assertValidEventLinkPayload(input, 'create');
    return this.gatewayEventService.createEvent(
      userContext,
      openIdCredential,
      input,
      roomId,
      calendarId,
      target,
    );
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
    assertValidEventLinkPayload(patch, 'patch');
    assertValidOccurrencePayload(patch);
    return this.gatewayEventService.updateEvent(
      userContext,
      openIdCredential,
      patch,
      ifMatch,
      roomId,
      calendarId,
      eventId,
      target,
    );
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
    return this.gatewayEventService.deleteEvent(
      userContext,
      openIdCredential,
      ifMatch,
      roomId,
      calendarId,
      eventId,
      target,
    );
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
}

function calendarDiagnosticsUnavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    code: 'calendar-diagnostics-unavailable',
    message: 'CalDAV diagnostics are unavailable',
  });
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

function assertValidOccurrencePayload(value: unknown): void {
  try {
    validateCalendarEventPatchOccurrence(value);
  } catch (error) {
    if (error instanceof CalendarEventOccurrenceValidationError) {
      throw new BadRequestException({
        code: 'invalid-event-occurrence',
        message: 'The selected occurrence operation is invalid or unsupported.',
      });
    }
    throw error;
  }
}

function assertValidEventLinkPayload(
  value: unknown,
  mode: 'create' | 'patch',
): void {
  try {
    if (mode === 'create') {
      validateCalendarEventInputConference(value);
      validateCalendarEventInputAttachment(value);
    } else {
      validateCalendarEventPatchConference(value);
      validateCalendarEventPatchAttachment(value);
    }
  } catch (error) {
    if (error instanceof CalendarEventConferenceValidationError) {
      throw new BadRequestException({
        code: 'invalid-event-conference',
        message: 'The conference link operation is invalid or unsupported.',
      });
    }
    if (error instanceof CalendarEventAttachmentValidationError) {
      throw new BadRequestException({
        code: 'invalid-event-attachment',
        message: 'The attachment link operation is invalid or unsupported.',
      });
    }
    throw error;
  }
}
