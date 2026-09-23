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
  CalendarAuthorization,
  CalendarAuthorizationRequest,
} from '@matrix-calendar-widget/calendar';
import { Injectable } from '@nestjs/common';
import { MatrixClient, PowerLevelsEventContent } from 'matrix-bot-sdk';
import { StateEventName } from '../model/StateEventName';

export const MATRIX_CALENDAR_EVENT_WRITE_POLICY =
  'io.github.0cwa.matrix-calendar.event.write';
export const MATRIX_CALENDAR_MANAGE_POLICY =
  'io.github.0cwa.matrix-calendar.manage';

@Injectable()
export class MatrixCalendarAuthorizationFactory {
  constructor(private readonly matrixClient: MatrixClient) {}

  forRoom(userId: string, roomId: string): CalendarAuthorization {
    return new MatrixRoomCalendarAuthorization(
      this.matrixClient,
      userId,
      roomId,
    );
  }
}

class MatrixRoomCalendarAuthorization implements CalendarAuthorization {
  constructor(
    private readonly matrixClient: MatrixClient,
    private readonly userId: string,
    private readonly roomId: string,
  ) {}

  async isAllowed(request: CalendarAuthorizationRequest): Promise<boolean> {
    if (!(await this.isJoinedMember())) {
      return false;
    }

    switch (request.action) {
      case 'list-calendars':
      case 'read-events':
        return true;
      case 'create-event':
      case 'update-event':
      case 'delete-event':
        return await this.hasEventWritePower();
      case 'create-calendar':
      case 'manage-calendar':
        return await this.hasCalendarManagePower();
    }
  }

  private async isJoinedMember(): Promise<boolean> {
    try {
      const members = await this.matrixClient.getJoinedRoomMembers(this.roomId);
      return members.includes(this.userId);
    } catch {
      return false;
    }
  }

  private async hasEventWritePower(): Promise<boolean> {
    const powerLevels = await this.getPowerLevels();
    const requiredPower =
      powerLevels?.events?.[MATRIX_CALENDAR_EVENT_WRITE_POLICY] ??
      powerLevels?.events_default ??
      0;

    return this.userPower(powerLevels) >= requiredPower;
  }

  private async hasCalendarManagePower(): Promise<boolean> {
    const powerLevels = await this.getPowerLevels();
    const requiredPower =
      powerLevels?.events?.[MATRIX_CALENDAR_MANAGE_POLICY] ??
      powerLevels?.state_default ??
      50;

    return this.userPower(powerLevels) >= requiredPower;
  }

  private async getPowerLevels(): Promise<PowerLevelsEventContent | undefined> {
    try {
      return await this.matrixClient.getRoomStateEvent(
        this.roomId,
        StateEventName.M_ROOM_POWER_LEVELS_EVENT,
        '',
      );
    } catch {
      return undefined;
    }
  }

  private userPower(powerLevels: PowerLevelsEventContent | undefined): number {
    return powerLevels?.users?.[this.userId] ?? powerLevels?.users_default ?? 0;
  }
}
