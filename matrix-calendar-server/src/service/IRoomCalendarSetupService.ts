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

/** Context from the authenticated Matrix room event; no target is caller-set. */
export type RoomCalendarSetupRequest = Readonly<{
  roomId: string;
  actorUserId: string;
}>;

/** Safe outcomes for localized command replies; do not attach raw errors. */
export type RoomCalendarSetupStatus =
  | 'created'
  | 'already-ready'
  | 'widget-installed'
  | 'pending'
  | 'widget-pending'
  | 'disabled'
  | 'not-authorized'
  | 'unsupported-room'
  | 'bot-not-ready'
  | 'widget-power-required'
  | 'capacity-reached'
  | 'conflict'
  | 'unavailable';

export type RoomCalendarSetupResult = Readonly<{
  status: RoomCalendarSetupStatus;
}>;

/**
 * Moderator-authorized, idempotent room setup. The service selects the
 * collection and widget state key; command callers cannot supply either.
 */
export interface RoomCalendarSetupService {
  setup(request: RoomCalendarSetupRequest): Promise<RoomCalendarSetupResult>;
}
