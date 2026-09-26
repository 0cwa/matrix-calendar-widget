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

import { Injectable } from '@nestjs/common';
import { MatrixClient } from 'matrix-bot-sdk';
import { AppRuntimeContext } from '../AppRuntimeContext';
import { StateEventName } from '../model/StateEventName';

@Injectable()
export class RoomReminderMatrixDelivery {
  constructor(
    private readonly matrixClient: MatrixClient,
    private readonly appRuntimeContext: AppRuntimeContext,
  ) {}

  async sendRoomReminder(roomId: string, body: string): Promise<boolean> {
    if (!roomId || !body || !(await this.canMentionRoom(roomId))) {
      return false;
    }

    await this.matrixClient.sendEvent(roomId, 'm.room.message', {
      msgtype: 'm.text',
      body,
      'm.mentions': { room: true },
    });
    return true;
  }

  private async canMentionRoom(roomId: string): Promise<boolean> {
    try {
      const joinedRooms: unknown = await this.matrixClient.getJoinedRooms();
      if (
        !Array.isArray(joinedRooms) ||
        !joinedRooms.every((joinedRoom) => typeof joinedRoom === 'string') ||
        !joinedRooms.includes(roomId)
      ) {
        return false;
      }

      const powerLevels: unknown = await this.matrixClient.getRoomStateEvent(
        roomId,
        StateEventName.M_ROOM_POWER_LEVELS_EVENT,
        '',
      );
      if (!isRecord(powerLevels)) {
        return false;
      }

      const roomNotificationLevel = notificationLevel(powerLevels);
      const botPowerLevel = userPowerLevel(
        powerLevels,
        this.appRuntimeContext.botUserId,
      );
      return (
        roomNotificationLevel !== undefined &&
        botPowerLevel !== undefined &&
        botPowerLevel >= roomNotificationLevel
      );
    } catch {
      return false;
    }
  }
}

function notificationLevel(
  powerLevels: Record<string, unknown>,
): number | undefined {
  if (powerLevels.notifications === undefined) {
    return 50;
  }
  if (!isRecord(powerLevels.notifications)) {
    return undefined;
  }

  const level = powerLevels.notifications.room;
  if (level === undefined) {
    return 50;
  }
  return isPowerLevel(level) ? level : undefined;
}

function userPowerLevel(
  powerLevels: Record<string, unknown>,
  botUserId: string,
): number | undefined {
  if (powerLevels.users !== undefined && !isRecord(powerLevels.users)) {
    return undefined;
  }

  const users = powerLevels.users as Record<string, unknown> | undefined;
  const explicitPower = users?.[botUserId];
  if (explicitPower !== undefined) {
    return isPowerLevel(explicitPower) ? explicitPower : undefined;
  }

  const defaultPower = powerLevels.users_default;
  if (defaultPower === undefined) {
    return 0;
  }
  return isPowerLevel(defaultPower) ? defaultPower : undefined;
}

function isPowerLevel(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
