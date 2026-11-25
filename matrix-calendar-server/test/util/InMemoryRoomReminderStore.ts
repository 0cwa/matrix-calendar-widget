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

import { randomUUID } from 'crypto';
import {
  createReminderDeliveryKey,
  normalizeRoomReminderConfiguration,
  ReminderConfigurationCursor,
  ReminderDeliveryClaim,
  ReminderDeliveryIdentity,
  ReminderDeliverySkipReason,
  RoomReminderConfiguration,
  RoomReminderStore,
  validateReminderConfigurationCursorShape,
  validateReminderConfigurationPageLimit,
  validateReminderDeliveryIdentity,
  validateRoomReminderConfiguration,
} from '../../src/reminder/RoomReminderStore';

type MemoryDelivery = {
  claimToken: string;
  attemptCount: number;
  leaseExpiresAt: Date;
  state: 'claimed' | 'pending' | 'sent' | 'skipped';
  skipReason?: ReminderDeliverySkipReason;
};

/** Test-only store adapter; production always uses Postgres or the disabled store. */
export class InMemoryRoomReminderStore implements RoomReminderStore {
  readonly enabled = true;

  private readonly configurations = new Map<
    string,
    RoomReminderConfiguration
  >();
  private readonly deliveries = new Map<string, MemoryDelivery>();

  async upsertConfiguration(
    configuration: RoomReminderConfiguration,
  ): Promise<void> {
    validateRoomReminderConfiguration(configuration);
    const key = configurationKey(configuration);
    const normalized = normalizeRoomReminderConfiguration(configuration);
    const current = this.configurations.get(key);
    const scheduleUnchanged =
      current &&
      JSON.stringify(current.allDaySchedule) ===
        JSON.stringify(normalized.allDaySchedule);
    const unchanged =
      current &&
      JSON.stringify(current.target) === JSON.stringify(normalized.target) &&
      scheduleUnchanged;
    normalized.revision = current
      ? (current.revision ?? 1) + (unchanged ? 0 : 1)
      : 1;
    if (normalized.allDaySchedule === null) {
      delete normalized.scheduleEffectiveAt;
    } else {
      normalized.scheduleEffectiveAt =
        current &&
        scheduleUnchanged &&
        current.scheduleEffectiveAt instanceof Date
          ? new Date(current.scheduleEffectiveAt.getTime())
          : new Date();
    }
    this.configurations.set(key, cloneConfiguration(normalized));
  }

  async compareAndUpsertConfiguration(
    configuration: RoomReminderConfiguration,
    expectedCurrent: RoomReminderConfiguration | undefined,
  ): Promise<boolean> {
    const current = this.configurations.get(configurationKey(configuration));
    if (expectedCurrent === undefined) {
      if (current) return false;
    } else {
      if (
        configurationKey(expectedCurrent) !== configurationKey(configuration)
      ) {
        return false;
      }
      const expected = normalizeRoomReminderConfiguration(expectedCurrent);
      if (!current || !sameConfigurationSnapshot(current, expected)) {
        return false;
      }
    }

    await this.upsertConfiguration(configuration);
    return true;
  }

  async listConfigurations(
    roomId: string,
    calendarId: string,
  ): Promise<RoomReminderConfiguration[]> {
    return [...this.configurations.values()]
      .filter(
        (configuration) =>
          configuration.roomId === roomId &&
          configuration.calendarId === calendarId,
      )
      .sort(compareConfigurations)
      .map(cloneConfiguration);
  }

  async listConfigurationPage(
    roomId: string,
    calendarId: string,
    after: ReminderConfigurationCursor | undefined,
    limit: number,
    signal?: AbortSignal,
  ): Promise<RoomReminderConfiguration[]> {
    throwIfAborted(signal);
    validateReminderConfigurationPageLimit(limit);
    if (after !== undefined) {
      validateReminderConfigurationCursorShape(after);
    }
    const afterKey = after ? configurationSortKey(after) : undefined;
    return (await this.listConfigurations(roomId, calendarId))
      .filter(
        (configuration) =>
          afterKey === undefined ||
          compareSortKeys(configurationSortKey(configuration), afterKey) > 0,
      )
      .slice(0, limit);
  }

  async hasConfiguration(
    configuration: RoomReminderConfiguration,
    signal?: AbortSignal,
  ): Promise<boolean> {
    throwIfAborted(signal);
    validateRoomReminderConfiguration(configuration);
    return this.configurations.has(configurationKey(configuration));
  }

  async getConfiguration(
    configuration: RoomReminderConfiguration,
    signal?: AbortSignal,
  ): Promise<RoomReminderConfiguration | undefined> {
    throwIfAborted(signal);
    validateRoomReminderConfiguration(configuration);
    const current = this.configurations.get(configurationKey(configuration));
    return current ? cloneConfiguration(current) : undefined;
  }

  async deleteConfiguration(
    configuration: RoomReminderConfiguration,
  ): Promise<void> {
    validateRoomReminderConfiguration(configuration);
    this.configurations.delete(configurationKey(configuration));
  }

  async deleteEventConfigurations(
    calendarId: string,
    eventUid: string,
  ): Promise<void> {
    for (const [key, configuration] of this.configurations) {
      if (
        configuration.calendarId === calendarId &&
        configuration.eventUid === eventUid
      ) {
        this.configurations.delete(key);
      }
    }
  }

  async deleteCalendarConfigurations(calendarId: string): Promise<void> {
    for (const [key, configuration] of this.configurations) {
      if (configuration.calendarId === calendarId) {
        this.configurations.delete(key);
      }
    }
  }

  async claimDelivery(
    identity: ReminderDeliveryIdentity,
    leaseDurationMs: number,
    signal?: AbortSignal,
  ): Promise<ReminderDeliveryClaim | undefined> {
    throwIfAborted(signal);
    validateReminderDeliveryIdentity(identity);
    if (!Number.isSafeInteger(leaseDurationMs) || leaseDurationMs <= 0) {
      throw new Error('Reminder delivery lease duration must be positive');
    }

    const deliveryKey = createReminderDeliveryKey(identity);
    const current = this.deliveries.get(deliveryKey);
    const now = Date.now();
    if (
      current?.state === 'sent' ||
      current?.state === 'skipped' ||
      (current?.state === 'claimed' && current.leaseExpiresAt.getTime() > now)
    ) {
      return undefined;
    }

    const claimToken = randomUUID();
    const attemptCount = (current?.attemptCount ?? 0) + 1;
    const leaseExpiresAt = new Date(now + leaseDurationMs);
    this.deliveries.set(deliveryKey, {
      claimToken,
      attemptCount,
      leaseExpiresAt,
      state: 'claimed',
    });
    return { deliveryKey, claimToken, attemptCount, leaseExpiresAt };
  }

  async markDeliverySent(
    deliveryKey: string,
    claimToken: string,
    signal?: AbortSignal,
  ): Promise<boolean> {
    throwIfAborted(signal);
    const current = this.deliveries.get(deliveryKey);
    if (current?.state !== 'claimed' || current.claimToken !== claimToken) {
      return false;
    }
    current.state = 'sent';
    current.claimToken = '';
    current.leaseExpiresAt = new Date(0);
    return true;
  }

  async markDeliverySkipped(
    deliveryKey: string,
    claimToken: string,
    reason: ReminderDeliverySkipReason,
    signal?: AbortSignal,
  ): Promise<boolean> {
    throwIfAborted(signal);
    const current = this.deliveries.get(deliveryKey);
    if (current?.state !== 'claimed' || current.claimToken !== claimToken) {
      return false;
    }
    current.state = 'skipped';
    current.skipReason = reason;
    current.claimToken = '';
    current.leaseExpiresAt = new Date(0);
    return true;
  }

  async releaseDeliveryClaim(
    deliveryKey: string,
    claimToken: string,
    signal?: AbortSignal,
  ): Promise<boolean> {
    throwIfAborted(signal);
    const current = this.deliveries.get(deliveryKey);
    if (current?.state !== 'claimed' || current.claimToken !== claimToken) {
      return false;
    }
    current.state = 'pending';
    current.claimToken = '';
    current.leaseExpiresAt = new Date(0);
    return true;
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new Error('Reminder store operation aborted');
  }
}

function configurationKey(configuration: RoomReminderConfiguration): string {
  return JSON.stringify([
    configuration.roomId,
    configuration.calendarId,
    configuration.eventUid,
    configuration.recurrenceId,
    configuration.alarmUid,
  ]);
}

function cloneConfiguration(
  configuration: RoomReminderConfiguration,
): RoomReminderConfiguration {
  const normalized = normalizeRoomReminderConfiguration(configuration);
  return {
    ...normalized,
    target:
      normalized.target.kind === 'room'
        ? { kind: 'room' }
        : { kind: 'users', userIds: [...normalized.target.userIds] },
    allDaySchedule: normalized.allDaySchedule
      ? { ...normalized.allDaySchedule }
      : null,
    scheduleEffectiveAt:
      normalized.scheduleEffectiveAt instanceof Date
        ? new Date(normalized.scheduleEffectiveAt.getTime())
        : normalized.scheduleEffectiveAt,
  };
}

function sameConfigurationSnapshot(
  current: RoomReminderConfiguration,
  expected: RoomReminderConfiguration,
): boolean {
  const normalizedCurrent = normalizeRoomReminderConfiguration(current);
  const normalizedExpected = normalizeRoomReminderConfiguration(expected);
  const currentEffectiveAt = normalizedCurrent.scheduleEffectiveAt;
  const expectedEffectiveAt = normalizedExpected.scheduleEffectiveAt;
  return (
    normalizedCurrent.revision === normalizedExpected.revision &&
    JSON.stringify(normalizedCurrent.target) ===
      JSON.stringify(normalizedExpected.target) &&
    JSON.stringify(normalizedCurrent.allDaySchedule) ===
      JSON.stringify(normalizedExpected.allDaySchedule) &&
    (currentEffectiveAt == null
      ? expectedEffectiveAt == null
      : expectedEffectiveAt instanceof Date &&
        currentEffectiveAt.getTime() === expectedEffectiveAt.getTime())
  );
}

function compareConfigurations(
  left: RoomReminderConfiguration,
  right: RoomReminderConfiguration,
): number {
  return compareSortKeys(
    configurationSortKey(left),
    configurationSortKey(right),
  );
}

function configurationSortKey(
  configuration: ReminderConfigurationCursor,
): [string, string, string] {
  return [
    configuration.eventUid,
    configuration.recurrenceId ?? '',
    configuration.alarmUid,
  ];
}

function compareSortKeys(
  left: readonly string[],
  right: readonly string[],
): number {
  for (let index = 0; index < left.length; index += 1) {
    const comparison =
      left[index] < right[index] ? -1 : left[index] > right[index] ? 1 : 0;
    if (comparison !== 0) return comparison;
  }
  return 0;
}
