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

export type RoomMentionPowerLevel = number | string;

export interface RoomMentionPowerLevels {
  readonly users?: Readonly<Record<string, RoomMentionPowerLevel>>;
  readonly users_default?: RoomMentionPowerLevel;
  readonly events?: Readonly<Record<string, RoomMentionPowerLevel>>;
  readonly events_default?: RoomMentionPowerLevel;
  readonly state_default?: RoomMentionPowerLevel;
  readonly notifications?: Readonly<Record<string, RoomMentionPowerLevel>>;
}

/**
 * This port must return undefined only when m.room.power_levels is genuinely
 * absent. Transport and state lookup errors must reject so policy fails closed.
 */
export interface RoomMentionMatrixState {
  getJoinedRoomMembers(roomId: string): Promise<readonly string[]>;
  /** Preserve raw string/number fields; do not coerce before policy evaluation. */
  getPowerLevels(roomId: string): Promise<RoomMentionPowerLevels | undefined>;
  /**
   * Resolve from m.room.create. Return "1" when an older create event omits
   * content.room_version. Undefined means unknown; reject on lookup errors.
   */
  getRoomVersion(roomId: string): Promise<string | undefined>;
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
    const [powerLevels, roomVersion] = await Promise.all([
      state.getPowerLevels(request.roomId),
      state.getRoomVersion(request.roomId),
    ]);

    const actorPower = effectivePowerLevel(
      powerLevels?.users?.[request.authenticatedActorUserId],
      powerLevels?.users_default,
      0,
      roomVersion,
    );
    const managePower = effectivePowerLevel(
      powerLevels?.events?.[MATRIX_CALENDAR_MANAGE_POLICY],
      powerLevels?.state_default,
      50,
      roomVersion,
    );
    if (actorPower === undefined || managePower === undefined) {
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
    const [members, powerLevels, roomVersion] = await Promise.all([
      state.getJoinedRoomMembers(request.roomId),
      state.getPowerLevels(request.roomId),
      state.getRoomVersion(request.roomId),
    ]);
    if (!members.includes(request.applicationServiceSenderUserId)) {
      return undefined;
    }

    const senderPower = effectivePowerLevel(
      powerLevels?.users?.[request.applicationServiceSenderUserId],
      powerLevels?.users_default,
      0,
      roomVersion,
    );
    const messagePower = effectivePowerLevel(
      powerLevels?.events?.['m.room.message'],
      powerLevels?.events_default,
      0,
      roomVersion,
    );
    const roomMentionPower = effectivePowerLevel(
      powerLevels?.notifications?.room,
      undefined,
      50,
      roomVersion,
    );

    if (
      senderPower === undefined ||
      messagePower === undefined ||
      roomMentionPower === undefined ||
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

/**
 * Room versions 1–9 retain deprecated string and float encodings for power
 * levels. Version 10 and later require integers. Since the injected state port
 * supplies the room version, tolerate legacy encodings only for those versions.
 */
function normalizePowerLevel(
  value: unknown,
  roomVersion: string | undefined,
): number | undefined {
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    return value;
  }

  if (!supportsLegacyPowerLevelEncoding(roomVersion)) {
    return undefined;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!/^[+-]?[0-9]+$/.test(trimmed)) {
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

function supportsLegacyPowerLevelEncoding(
  roomVersion: string | undefined,
): boolean {
  return roomVersion !== undefined && /^[1-9]$/.test(roomVersion);
}

/** Undefined means absent and may use the fallback; malformed is denied. */
function effectivePowerLevel(
  value: unknown,
  fallback: unknown,
  defaultValue: number,
  roomVersion: string | undefined,
): number | undefined {
  if (value !== undefined) {
    return normalizePowerLevel(value, roomVersion);
  }
  if (fallback !== undefined) {
    return normalizePowerLevel(fallback, roomVersion);
  }
  return defaultValue;
}
