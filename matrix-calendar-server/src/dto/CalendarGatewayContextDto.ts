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

import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class CalendarGatewayRoomCapabilityDto {
  @IsString()
  calendarId: string;

  @IsBoolean()
  canReadEvents: boolean;

  @IsBoolean()
  canWriteEvents: boolean;

  @IsBoolean()
  canManageReminders: boolean;

  constructor(
    calendarId: string,
    canReadEvents: boolean,
    canWriteEvents: boolean,
    canManageReminders: boolean,
  ) {
    this.calendarId = calendarId;
    this.canReadEvents = canReadEvents;
    this.canWriteEvents = canWriteEvents;
    this.canManageReminders = canManageReminders;
  }
}

export class CalendarGatewayContextDto {
  @IsString()
  userId: string;

  @IsOptional()
  @IsString()
  roomId?: string;

  @IsOptional()
  roomCalendar?: CalendarGatewayRoomCapabilityDto;

  constructor(
    userId: string,
    roomId?: string,
    roomCalendar?: CalendarGatewayRoomCapabilityDto,
  ) {
    this.userId = userId;
    this.roomId = roomId;
    this.roomCalendar = roomCalendar;
  }
}
