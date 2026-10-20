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

/**
 * Async view of immutable static bindings plus ready dynamic bindings.
 * Implementations keep the existing pure parse/validation resolver functions;
 * they validate the complete set for uniqueness before returning it. When the
 * dynamic store is enabled, they also apply its total configured-binding cap
 * to static plus all dynamic rows, including pending. Disabled static-only
 * mode preserves the legacy static validation without that additional cap.
 */
export interface RoomCalendarBindingRegistry {
  /**
   * Current snapshot for enumeration and one scheduler scan. Return static
   * and ready dynamic bindings only. With dynamic storage enabled, fail closed
   * rather than truncate if the complete configured set exceeds the shared
   * 32-binding cap or is invalid. With storage disabled, validate and return
   * the complete static-only set without applying a new count cap.
   * Check `signal` before and after the store read; the store port cannot cancel
   * an in-flight read, so an aborted result is suppressed when that read ends.
   */
  getSnapshot(signal?: AbortSignal): Promise<readonly RoomCalendarBinding[]>;

  /**
   * Resolve the current exact binding before proof issuance or CalDAV I/O.
   * Apply the same complete-set validity and cap checks as getSnapshot;
   * pending dynamic reservations are never returned.
   */
  resolve(
    roomId: string,
    calendarId?: string,
    signal?: AbortSignal,
  ): Promise<RoomCalendarBinding>;
}
