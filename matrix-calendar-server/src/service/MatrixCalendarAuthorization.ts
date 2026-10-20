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
import {
  MatrixClient,
  MatrixError,
  PowerLevelsEventContent,
} from 'matrix-bot-sdk';
import { StateEventName } from '../model/StateEventName';
import { isMatrixUserId } from './MatrixIdentifiers';

export const MATRIX_CALENDAR_EVENT_WRITE_POLICY =
  'io.github.0cwa.matrix-calendar.event.write';
export const MATRIX_CALENDAR_MANAGE_POLICY =
  'io.github.0cwa.matrix-calendar.manage';

/**
 * Room versions 1–9 retain deprecated string and float encodings for power
 * levels. Version 10 and later require integers, so legacy encodings are
 * accepted only when the current room version is known to be 1–9.
 */
export function normalizeMatrixPowerLevel(
  value: unknown,
  roomVersion: string | undefined,
): number | undefined {
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    return value;
  }

  if (roomVersion === undefined || !/^[1-9]$/u.test(roomVersion)) {
    return undefined;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!/^[+-]?[0-9]+$/u.test(trimmed)) {
      return undefined;
    }
    const parsed = Number(trimmed);
    return Number.isSafeInteger(parsed) ? parsed : undefined;
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }

  const truncated = Math.trunc(value);
  return Number.isSafeInteger(truncated) ? truncated : undefined;
}

type PowerLevelsLookup =
  | { kind: 'present'; content: PowerLevelsEventContent }
  | { kind: 'absent' }
  | { kind: 'failed' };

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

  canManageCalendars(userId: string, roomId: string): Promise<boolean> {
    return new MatrixRoomCalendarAuthorization(
      this.matrixClient,
      userId,
      roomId,
    ).canManageCalendars();
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

  async canManageCalendars(): Promise<boolean> {
    if (!(await this.isJoinedMember())) {
      return false;
    }

    return this.hasCalendarManagePower();
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
    const lookup = await this.getPowerLevels();
    if (lookup.kind === 'failed') {
      return false;
    }

    const powerLevels = lookup.kind === 'present' ? lookup.content : undefined;
    const requiredPower =
      powerLevels?.events?.[MATRIX_CALENDAR_EVENT_WRITE_POLICY] ??
      powerLevels?.events_default ??
      0;

    return this.userPower(powerLevels) >= requiredPower;
  }

  private async hasCalendarManagePower(): Promise<boolean> {
    const lookup = await this.getPowerLevels();
    if (lookup.kind === 'failed') {
      return false;
    }

    const powerLevels = lookup.kind === 'present' ? lookup.content : undefined;
    const requiredPower =
      powerLevels?.events?.[MATRIX_CALENDAR_MANAGE_POLICY] ??
      powerLevels?.state_default ??
      50;

    if (this.userPower(powerLevels) >= requiredPower) {
      return true;
    }

    return isMatrixRoomV12Creator(this.matrixClient, this.userId, this.roomId);
  }

  private async getPowerLevels(): Promise<PowerLevelsLookup> {
    try {
      return {
        kind: 'present',
        content: await this.matrixClient.getRoomStateEvent(
          this.roomId,
          StateEventName.M_ROOM_POWER_LEVELS_EVENT,
          '',
        ),
      };
    } catch (error) {
      if (
        error instanceof MatrixError &&
        error.statusCode === 404 &&
        error.errcode === 'M_NOT_FOUND'
      ) {
        return { kind: 'absent' };
      }

      return { kind: 'failed' };
    }
  }

  private userPower(powerLevels: PowerLevelsEventContent | undefined): number {
    return powerLevels?.users?.[this.userId] ?? powerLevels?.users_default ?? 0;
  }
}

/**
 * Returns whether a user has the implicit creator power granted by room
 * version 12. Malformed or unavailable creation state fails closed.
 */
export async function isMatrixRoomV12Creator(
  matrixClient: { getRoomState(roomId: string): Promise<unknown> },
  userId: string,
  roomId: string,
): Promise<boolean> {
  try {
    const state = await matrixClient.getRoomState(roomId);
    if (!Array.isArray(state)) {
      return false;
    }

    const createEvents = state.filter(
      (event: unknown) => isRecord(event) && event.type === 'm.room.create',
    );
    if (createEvents.length !== 1) {
      return false;
    }

    const createEvent = createEvents[0];
    if (
      !isRecord(createEvent) ||
      createEvent.state_key !== '' ||
      !isRecord(createEvent.content) ||
      createEvent.content.room_version !== '12' ||
      !isMatrixUserId(createEvent.sender, true)
    ) {
      return false;
    }

    const additionalCreators = createEvent.content.additional_creators;
    if (
      additionalCreators !== undefined &&
      (!Array.isArray(additionalCreators) ||
        !additionalCreators.every((value) => isMatrixUserId(value)))
    ) {
      return false;
    }

    return (
      createEvent.sender === userId ||
      (additionalCreators?.includes(userId) ?? false)
    );
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
