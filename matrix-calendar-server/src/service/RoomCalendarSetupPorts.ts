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

import type { RoomCalendarBinding } from '../model/IRoomCalendarBinding';

export interface RoomCalendarSetupConfiguration {
  readonly enabled: boolean;
  readonly staticBindings: readonly RoomCalendarBinding[];
  /** Explicit federated moderator server allowlist; empty means bot server. */
  readonly allowedActorServerNames?: readonly string[];
}

export interface RoomCalendarSetupAuthorizationPort {
  canManageCalendars(actorUserId: string, roomId: string): Promise<boolean>;
}

export interface RoomCalendarSetupMatrixPreconditionsPort {
  getJoinedRoomMembers(roomId: string): Promise<readonly string[]>;
  getRoomState(roomId: string): Promise<unknown>;
  getRoomStateEvent(
    roomId: string,
    eventType: string,
    stateKey: string,
  ): Promise<unknown>;
}

export type RoomCalendarSetupCalDavMode = 'create-if-missing' | 'verify-only';

export type RoomCalendarSetupCalDavOutcome =
  | 'created'
  | 'existing'
  | 'missing'
  | 'conflict';

export interface RoomCalendarSetupCalDavPort {
  reconcile(
    binding: RoomCalendarBinding,
    mode: RoomCalendarSetupCalDavMode,
  ): Promise<RoomCalendarSetupCalDavOutcome>;
}

export type RoomCalendarSetupWidgetOutcome =
  | 'installed'
  | 'already-present'
  | 'conflict'
  | 'unavailable';

export type RoomCalendarSetupWidgetPreflightOutcome =
  | 'ready'
  | 'conflict'
  | 'unavailable';

export interface RoomCalendarSetupWidgetPort {
  /** Checks existing widget state and new-widget URL before persistence. */
  preflight(
    roomId: string,
    calendarId?: string,
  ): Promise<RoomCalendarSetupWidgetPreflightOutcome>;
  install(binding: RoomCalendarBinding): Promise<RoomCalendarSetupWidgetOutcome>;
}
