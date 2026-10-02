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

import { RoomCalendarBinding } from '../model/IRoomCalendarBinding';
import { MATRIX_CALENDAR_MANAGE_POLICY } from '../service/MatrixCalendarAuthorization';
import { resolveRoomCalendarBinding } from '../service/RoomCalendarBindingResolver';

export interface RoomMentionPowerLevels {
  readonly users?: Readonly<Record<string, number>>;
  readonly users_default?: number;
  readonly events?: Readonly<Record<string, number>>;
  readonly events_default?: number;
  readonly state_default?: number;
  readonly notifications?: Readonly<Record<string, number>>;
}

/**
 * This port must return undefined only when m.room.power_levels is genuinely
 * absent. Transport and state lookup errors must reject so policy fails closed.
 */
export interface RoomMentionMatrixState {
  getJoinedRoomMembers(roomId: string): Promise<readonly string[]>;
  getPowerLevels(roomId: string): Promise<RoomMentionPowerLevels | undefined>;
}

export interface RoomMentionScheduleRequest {
  /** Validated current widget actor, never copied from an untrusted body. */
  readonly authenticatedActorUserId: string;
  readonly roomId: string;
  readonly calendarId: string;
  readonly configuredBindings: unknown;
}

/**
 * Authorize configuration with the current widget actor. The returned binding
 * deliberately contains no actor identity for later delivery.
 */
export async function authorizeRoomMentionScheduling(
  request: RoomMentionScheduleRequest,
  state: RoomMentionMatrixState,
): Promise<RoomCalendarBinding | undefined> {
  if (request.authenticatedActorUserId.length === 0) {
    return undefined;
  }

  try {
    const members = await state.getJoinedRoomMembers(request.roomId);
    if (!members.includes(request.authenticatedActorUserId)) {
      return undefined;
    }
    const powerLevels = await state.getPowerLevels(request.roomId);

    const actorPower =
      powerLevels?.users?.[request.authenticatedActorUserId] ??
      powerLevels?.users_default ??
      0;
    const managePower =
      powerLevels?.events?.[MATRIX_CALENDAR_MANAGE_POLICY] ??
      powerLevels?.state_default ??
      50;
    if (!isPowerLevel(actorPower) || !isPowerLevel(managePower)) {
      return undefined;
    }
    if (actorPower < managePower) {
      return undefined;
    }

    return resolveRoomCalendarBinding(
      request.configuredBindings,
      request.roomId,
      request.calendarId,
    );
  } catch {
    return undefined;
  }
}

export interface RoomMentionDeliveryRequest {
  readonly roomId: string;
  readonly calendarId: string;
  /** Trusted server-configured application-service sender, not request input. */
  readonly applicationServiceSenderUserId: string;
  readonly configuredBindings: unknown;
}

/** Re-resolve room binding and current sender authorization for each delivery. */
export async function authorizeRoomMentionDelivery(
  request: RoomMentionDeliveryRequest,
  state: RoomMentionMatrixState,
): Promise<RoomCalendarBinding | undefined> {
  if (request.applicationServiceSenderUserId.length === 0) {
    return undefined;
  }

  let binding: RoomCalendarBinding;
  try {
    binding = resolveRoomCalendarBinding(
      request.configuredBindings,
      request.roomId,
      request.calendarId,
    );
  } catch {
    return undefined;
  }

  try {
    const [members, powerLevels] = await Promise.all([
      state.getJoinedRoomMembers(request.roomId),
      state.getPowerLevels(request.roomId),
    ]);
    if (!members.includes(request.applicationServiceSenderUserId)) {
      return undefined;
    }

    const senderPower =
      powerLevels?.users?.[request.applicationServiceSenderUserId] ??
      powerLevels?.users_default ??
      0;
    const messagePower =
      powerLevels?.events?.['m.room.message'] ??
      powerLevels?.events_default ??
      0;
    const roomMentionPower = powerLevels?.notifications?.room ?? 50;

    if (
      !isPowerLevel(senderPower) ||
      !isPowerLevel(messagePower) ||
      !isPowerLevel(roomMentionPower) ||
      senderPower < messagePower ||
      senderPower < roomMentionPower
    ) {
      return undefined;
    }

    return binding;
  } catch {
    return undefined;
  }
}

function isPowerLevel(value: number): boolean {
  return Number.isInteger(value);
}
