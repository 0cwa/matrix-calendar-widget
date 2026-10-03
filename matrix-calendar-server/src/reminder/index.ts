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

export {
  CanonicalReminderResolutionError,
  resolveCanonicalReminderIdentity,
} from './CanonicalReminderIdentityResolver';
export type {
  CanonicalReminderIdentity,
  CanonicalReminderResolution,
  CanonicalReminderResolutionErrorCode,
  CanonicalReminderResourceData,
} from './CanonicalReminderIdentityResolver';
export {
  PostgresRoomReminderStore,
  createReminderDeliveryKey,
} from './PostgresRoomReminderStore';
export { calculateDisplayReminderDueAt } from './ReminderTrigger';
export type { ResolvedReminderOccurrenceTiming } from './ReminderTrigger';
export {
  ROOM_REMINDER_SCHEDULER_LIMITS,
  RoomReminderScheduler,
} from './RoomReminderScheduler';
export type {
  CanonicalReminderSchedulerSource,
  ReminderCandidateCursor,
  ReminderDueCandidate,
  ReminderSchedulerRuntimeConfiguration,
  ReminderSchedulerRuntimeSource,
  ReminderSchedulerWindow,
  ResolvedReminderDelivery,
  RoomReminderSchedulerDependencies,
  RoomReminderSchedulerOptions,
  RoomReminderSchedulerReport,
  RoomReminderSchedulerSender,
} from './RoomReminderScheduler';
export {
  DisabledRoomReminderStore,
  ReminderStoreDisabledError,
  validateReminderConfigurationCursorShape,
  validateReminderDeliveryIdentity,
  validateRoomReminderConfiguration,
} from './RoomReminderStore';
export type {
  ReminderConfigurationCursor,
  ReminderDeliveryClaim,
  ReminderDeliveryIdentity,
  ReminderFiringIdentity,
  RoomReminderConfiguration,
  RoomReminderStore,
} from './RoomReminderStore';
