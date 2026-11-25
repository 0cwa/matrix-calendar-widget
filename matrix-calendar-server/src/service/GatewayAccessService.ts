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
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { IAppConfiguration } from '../IAppConfiguration';
import { ModuleProviderToken } from '../ModuleProviderToken';
import { IUserContext } from '../model/IUserContext';
import type { RoomCalendarBindingRegistry } from './IRoomCalendarBindingRegistry';
import { MatrixCalendarAuthorizationFactory } from './MatrixCalendarAuthorization';
import { RoomCalendarBindingError } from './RoomCalendarBindingResolver';
import { RoomCalendarTarget } from './RoomCalendarCalDavAccess';

@Injectable()
export class GatewayAccessService {
  constructor(
    @Inject(ModuleProviderToken.APP_CONFIGURATION)
    private readonly appConfig: IAppConfiguration,
    private readonly authorizationFactory: MatrixCalendarAuthorizationFactory,
    @Inject(ModuleProviderToken.ROOM_CALENDAR_BINDING_REGISTRY)
    private readonly roomCalendarBindingRegistry?: RoomCalendarBindingRegistry,
  ) {}

  async authorizeRoomCalendarTarget(
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

  async authorizePersonalCalendarRequest(
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

  private async resolveRoomTarget(
    roomId: string,
    requestedCalendarId?: string,
  ): Promise<RoomCalendarTarget> {
    try {
      const registry = this.roomCalendarBindingRegistry;
      if (!registry) throw new Error('Room calendar binding registry missing');
      const binding = await registry.resolve(roomId, requestedCalendarId);
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

  private requireQuery(value: string | undefined, name: string): string {
    if (!value) {
      throw new BadRequestException(`${name} is required`);
    }
    return value;
  }
}
