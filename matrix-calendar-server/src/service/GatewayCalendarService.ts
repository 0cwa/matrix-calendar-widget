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
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { IAppConfiguration } from '../IAppConfiguration';
import { ModuleProviderToken } from '../ModuleProviderToken';
import {
  CalDavDiscoveryClient,
  MatrixOpenIdCalDavCredentialError,
  MatrixOpenIdCalDavCredentialProviderFactory,
} from '../caldav';
import { CalendarGatewayCalendarDto } from '../dto/CalendarGatewayCalendarDto';
import { CalendarGatewayDiagnosticsDto } from '../dto/CalendarGatewayDiagnosticsDto';
import { IMatrixOpenIdCredential } from '../model/IMatrixOpenIdCredential';
import { IUserContext } from '../model/IUserContext';
import { GatewayAccessService } from './GatewayAccessService';
import { MatrixCalendarAuthorizationFactory } from './MatrixCalendarAuthorization';
import { RoomCalendarCalDavAccess } from './RoomCalendarCalDavAccess';

import { runCalDav } from '../controller/runGatewayCalDav';

@Injectable()
export class GatewayCalendarService {
  constructor(
    @Inject(ModuleProviderToken.APP_CONFIGURATION)
    private readonly appConfig: IAppConfiguration,
    private readonly authorizationFactory: MatrixCalendarAuthorizationFactory,
    private readonly credentialProviderFactory: MatrixOpenIdCalDavCredentialProviderFactory,
    @Inject(ModuleProviderToken.ROOM_CALENDAR_CALDAV_ACCESS)
    private readonly roomCalendarCalDavAccess: RoomCalendarCalDavAccess,
    private readonly gatewayAccessService: GatewayAccessService,
  ) {}
  async listCalendars(
    userContext: IUserContext,
    openIdCredential: IMatrixOpenIdCredential | undefined,
    roomId?: string,
    target?: string,
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

  async getCalendarDiagnostics(
    userContext: IUserContext,
    openIdCredential: IMatrixOpenIdCredential | undefined,
    roomId?: string,
    target?: string,
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

  async createCalendar(
    userContext: IUserContext,
    openIdCredential: IMatrixOpenIdCredential | undefined,
    name: string,
    requiredRoomId: string,
    roomId?: string,
    target?: string,
  ): Promise<CalendarGatewayCalendarDto> {
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

  async updateCalendarDescription(
    userContext: IUserContext,
    openIdCredential: IMatrixOpenIdCredential | undefined,
    description: string,
    roomId?: string,
    calendarId?: string,
    target?: string,
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

  async updateCalendarColor(
    userContext: IUserContext,
    openIdCredential: IMatrixOpenIdCredential | undefined,
    color: string,
    roomId?: string,
    calendarId?: string,
    target?: string,
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

  async renameCalendar(
    userContext: IUserContext,
    openIdCredential: IMatrixOpenIdCredential | undefined,
    name: string,
    requiredRoomId: string,
    roomId?: string,
    calendarId?: string,
    target?: string,
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

  async deleteCalendar(
    userContext: IUserContext,
    openIdCredential: IMatrixOpenIdCredential | undefined,
    roomId?: string,
    calendarId?: string,
    target?: string,
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
