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
  Controller,
  Delete,
  Get,
  Headers,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
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
import { GatewayContextService } from '../service/GatewayContextService';

import { GatewayEventService } from '../service/GatewayEventService';

import { GatewayCalendarService } from '../service/GatewayCalendarService';

@Controller({
  path: 'calendar',
  version: ['1'],
})
@UseGuards(MatrixAuthGuard, MatrixRoomMembershipGuard)
export class CalendarGatewayController {
  constructor(
    private readonly gatewayContextService: GatewayContextService,
    private readonly gatewayEventService: GatewayEventService,
    private readonly gatewayCalendarService: GatewayCalendarService,
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
    return this.gatewayCalendarService.listCalendars(
      userContext,
      openIdCredential,
      roomId,
      target,
    );
  }

  @Get('calendars/diagnostics')
  async getCalendarDiagnostics(
    @UserContextParam() userContext: IUserContext,
    @MatrixOpenIdCredentialParam()
    openIdCredential: IMatrixOpenIdCredential | undefined,
    @Query('roomId') roomId?: string,
    @Query('target') target?: string,
  ): Promise<CalendarGatewayDiagnosticsDto> {
    return this.gatewayCalendarService.getCalendarDiagnostics(
      userContext,
      openIdCredential,
      roomId,
      target,
    );
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
    const requiredRoomId = requireQuery(roomId, 'roomId');
    const name = input?.name?.trim();
    if (!name) {
      throw new BadRequestException('calendar name is required');
    }

    return this.gatewayCalendarService.createCalendar(
      userContext,
      openIdCredential,
      name,
      requiredRoomId,
      roomId,
      target,
    );
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

    return this.gatewayCalendarService.updateCalendarDescription(
      userContext,
      openIdCredential,
      description,
      roomId,
      calendarId,
      target,
    );
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

    return this.gatewayCalendarService.updateCalendarColor(
      userContext,
      openIdCredential,
      color,
      roomId,
      calendarId,
      target,
    );
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
    const requiredRoomId = requireQuery(roomId, 'roomId');
    const name = input?.name?.trim();
    if (!name) {
      throw new BadRequestException('calendar name is required');
    }

    return this.gatewayCalendarService.renameCalendar(
      userContext,
      openIdCredential,
      name,
      requiredRoomId,
      roomId,
      calendarId,
      target,
    );
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
    return this.gatewayCalendarService.deleteCalendar(
      userContext,
      openIdCredential,
      roomId,
      calendarId,
      target,
    );
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

function requireQuery(value: string | undefined, name: string): string {
  if (!value) throw new BadRequestException(`${name} is required`);
  return value;
}
