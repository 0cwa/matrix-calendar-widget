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

import { createHash } from 'crypto';

export type RoomReminderConfiguration = {
  roomId: string;
  calendarId: string;
  eventUid: string;
  recurrenceId: string | null;
  alarmUid: string;
};

/** Stable identity for one alarm firing on one event occurrence. */
export type ReminderDeliveryIdentity = RoomReminderConfiguration & {
  triggerOrdinal: number;
};

/** One actual occurrence firing. Even a non-recurring event uses its DTSTART
 * identity here so moving DTSTART creates a distinct delivery key. */
export type ReminderFiringIdentity = Omit<
  ReminderDeliveryIdentity,
  'recurrenceId'
> & {
  recurrenceId: string;
};

/** Keyset cursor over a room/calendar's ordered reminder configurations. */
export type ReminderConfigurationCursor = Pick<
  RoomReminderConfiguration,
  'eventUid' | 'recurrenceId' | 'alarmUid'
>;

export const MAX_REMINDER_CONFIGURATION_PAGE_SIZE = 100;

export type ReminderDeliveryClaim = {
  deliveryKey: string;
  claimToken: string;
  attemptCount: number;
  leaseExpiresAt: Date;
};

/**
 * Operations that accept a signal must observe abort and settle promptly.
 * Database cancellation is best effort: an aborted caller cannot infer that
 * PostgreSQL did not finish the operation.
 */
export interface RoomReminderStore {
  /** False when persistence is disabled and all operations reject. */
  readonly enabled: boolean;

  upsertConfiguration(configuration: RoomReminderConfiguration): Promise<void>;
  listConfigurations(
    roomId: string,
    calendarId: string,
  ): Promise<RoomReminderConfiguration[]>;
  /** Return a stable, exclusive keyset page ordered by event/recurrence/alarm. */
  listConfigurationPage(
    roomId: string,
    calendarId: string,
    after: ReminderConfigurationCursor | undefined,
    limit: number,
    signal?: AbortSignal,
  ): Promise<RoomReminderConfiguration[]>;
  /** Check that a configuration still exists immediately before delivery. */
  hasConfiguration(
    configuration: RoomReminderConfiguration,
    signal?: AbortSignal,
  ): Promise<boolean>;
  deleteConfiguration(configuration: RoomReminderConfiguration): Promise<void>;
  deleteEventConfigurations(
    calendarId: string,
    eventUid: string,
  ): Promise<void>;
  deleteCalendarConfigurations(calendarId: string): Promise<void>;

  claimDelivery(
    identity: ReminderDeliveryIdentity,
    leaseDurationMs: number,
    signal?: AbortSignal,
  ): Promise<ReminderDeliveryClaim | undefined>;
  markDeliverySent(
    deliveryKey: string,
    claimToken: string,
    signal?: AbortSignal,
  ): Promise<boolean>;
  releaseDeliveryClaim(
    deliveryKey: string,
    claimToken: string,
    signal?: AbortSignal,
  ): Promise<boolean>;
}

const REMINDER_CONFIGURATION_KEYS = [
  'roomId',
  'calendarId',
  'eventUid',
  'recurrenceId',
  'alarmUid',
] as const;
const REMINDER_DELIVERY_IDENTITY_KEYS = [
  ...REMINDER_CONFIGURATION_KEYS,
  'triggerOrdinal',
] as const;

export class ReminderStoreDisabledError extends Error {
  constructor() {
    super(
      'Room reminders are disabled because MATRIX_CALENDAR_REMINDER_DATABASE_URL is not configured',
    );
    this.name = 'ReminderStoreDisabledError';
  }
}

export class DisabledRoomReminderStore implements RoomReminderStore {
  readonly enabled = false;

  async upsertConfiguration(
    _configuration: RoomReminderConfiguration,
  ): Promise<void> {
    throw new ReminderStoreDisabledError();
  }

  async listConfigurations(
    _roomId: string,
    _calendarId: string,
  ): Promise<RoomReminderConfiguration[]> {
    throw new ReminderStoreDisabledError();
  }

  async listConfigurationPage(
    _roomId: string,
    _calendarId: string,
    _after: ReminderConfigurationCursor | undefined,
    _limit: number,
    _signal?: AbortSignal,
  ): Promise<RoomReminderConfiguration[]> {
    throw new ReminderStoreDisabledError();
  }

  async hasConfiguration(
    _configuration: RoomReminderConfiguration,
    _signal?: AbortSignal,
  ): Promise<boolean> {
    throw new ReminderStoreDisabledError();
  }

  async deleteConfiguration(
    _configuration: RoomReminderConfiguration,
  ): Promise<void> {
    throw new ReminderStoreDisabledError();
  }

  async deleteEventConfigurations(
    _calendarId: string,
    _eventUid: string,
  ): Promise<void> {
    throw new ReminderStoreDisabledError();
  }

  async deleteCalendarConfigurations(_calendarId: string): Promise<void> {
    throw new ReminderStoreDisabledError();
  }

  async claimDelivery(
    _identity: ReminderDeliveryIdentity,
    _leaseDurationMs: number,
    _signal?: AbortSignal,
  ): Promise<ReminderDeliveryClaim | undefined> {
    throw new ReminderStoreDisabledError();
  }

  async markDeliverySent(
    _deliveryKey: string,
    _claimToken: string,
    _signal?: AbortSignal,
  ): Promise<boolean> {
    throw new ReminderStoreDisabledError();
  }

  async releaseDeliveryClaim(
    _deliveryKey: string,
    _claimToken: string,
    _signal?: AbortSignal,
  ): Promise<boolean> {
    throw new ReminderStoreDisabledError();
  }
}

export function validateReminderDeliveryIdentity(
  identity: ReminderDeliveryIdentity,
): void {
  if (!hasExactKeys(identity, REMINDER_DELIVERY_IDENTITY_KEYS)) {
    throw new Error('Invalid reminder delivery identity: shape');
  }
  validateRoomReminderConfiguration({
    roomId: identity.roomId,
    calendarId: identity.calendarId,
    eventUid: identity.eventUid,
    recurrenceId: identity.recurrenceId,
    alarmUid: identity.alarmUid,
  });
  if (
    typeof identity.triggerOrdinal !== 'number' ||
    !Number.isSafeInteger(identity.triggerOrdinal) ||
    identity.triggerOrdinal < 0
  ) {
    throw new Error('Invalid reminder delivery identity: triggerOrdinal');
  }
}

export function validateRoomReminderConfiguration(
  configuration: RoomReminderConfiguration,
): void {
  if (!hasExactKeys(configuration, REMINDER_CONFIGURATION_KEYS)) {
    throw new Error('Invalid room reminder configuration: shape');
  }
  for (const name of [
    'roomId',
    'calendarId',
    'eventUid',
    'alarmUid',
  ] as const) {
    const value = configuration[name];
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(`Invalid room reminder configuration: ${name}`);
    }
  }
  if (
    configuration.recurrenceId !== null &&
    (typeof configuration.recurrenceId !== 'string' ||
      configuration.recurrenceId.trim().length === 0)
  ) {
    throw new Error('Invalid room reminder configuration: recurrenceId');
  }
}

export function validateReminderConfigurationCursorShape(
  cursor: ReminderConfigurationCursor,
): void {
  if (!hasExactKeys(cursor, ['eventUid', 'recurrenceId', 'alarmUid'])) {
    throw new Error('Invalid reminder configuration page cursor');
  }
  if (
    typeof cursor.eventUid !== 'string' ||
    cursor.eventUid.trim().length === 0 ||
    (cursor.recurrenceId !== null &&
      (typeof cursor.recurrenceId !== 'string' ||
        cursor.recurrenceId.trim().length === 0)) ||
    typeof cursor.alarmUid !== 'string' ||
    cursor.alarmUid.trim().length === 0
  ) {
    throw new Error('Invalid reminder configuration page cursor');
  }
}

function hasExactKeys(value: object, expectedKeys: readonly string[]): boolean {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return false;
  }
  const keys = Reflect.ownKeys(value);
  return (
    keys.length === expectedKeys.length &&
    expectedKeys.every((key) => keys.includes(key))
  );
}

/** Stable opaque key shared by the durable store and Matrix transaction ID. */
export function createReminderDeliveryKey(
  identity: ReminderDeliveryIdentity,
): string {
  validateReminderDeliveryIdentity(identity);
  const stableParts = [
    identity.roomId,
    identity.calendarId,
    identity.eventUid,
    identity.recurrenceId,
    identity.alarmUid,
    identity.triggerOrdinal,
  ];
  return createHash('sha256').update(JSON.stringify(stableParts)).digest('hex');
}

export function validateReminderConfigurationPageLimit(limit: number): void {
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > MAX_REMINDER_CONFIGURATION_PAGE_SIZE
  ) {
    throw new Error(
      `Reminder configuration page size must be between 1 and ${MAX_REMINDER_CONFIGURATION_PAGE_SIZE}`,
    );
  }
}
