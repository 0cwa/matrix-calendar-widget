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

export type ReminderDeliveryClaim = {
  deliveryKey: string;
  claimToken: string;
  attemptCount: number;
  leaseExpiresAt: Date;
};

export interface RoomReminderStore {
  /** False when persistence is disabled and all operations reject. */
  readonly enabled: boolean;

  upsertConfiguration(configuration: RoomReminderConfiguration): Promise<void>;
  listConfigurations(
    roomId: string,
    calendarId: string,
  ): Promise<RoomReminderConfiguration[]>;
  deleteConfiguration(configuration: RoomReminderConfiguration): Promise<void>;
  deleteEventConfigurations(
    calendarId: string,
    eventUid: string,
  ): Promise<void>;
  deleteCalendarConfigurations(calendarId: string): Promise<void>;

  claimDelivery(
    identity: ReminderDeliveryIdentity,
    leaseDurationMs: number,
  ): Promise<ReminderDeliveryClaim | undefined>;
  markDeliverySent(deliveryKey: string, claimToken: string): Promise<boolean>;
  releaseDeliveryClaim(
    deliveryKey: string,
    claimToken: string,
  ): Promise<boolean>;
}

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
  ): Promise<ReminderDeliveryClaim | undefined> {
    throw new ReminderStoreDisabledError();
  }

  async markDeliverySent(
    _deliveryKey: string,
    _claimToken: string,
  ): Promise<boolean> {
    throw new ReminderStoreDisabledError();
  }

  async releaseDeliveryClaim(
    _deliveryKey: string,
    _claimToken: string,
  ): Promise<boolean> {
    throw new ReminderStoreDisabledError();
  }
}

export function validateReminderDeliveryIdentity(
  identity: ReminderDeliveryIdentity,
): void {
  for (const [name, value] of Object.entries(identity)) {
    if (name === 'recurrenceId' && value === null) {
      continue;
    }
    if (name === 'triggerOrdinal') {
      if (
        typeof value === 'number' &&
        Number.isSafeInteger(value) &&
        value >= 0
      ) {
        continue;
      }
      throw new Error(`Invalid reminder delivery identity: ${name}`);
    }
    if (typeof value === 'string' && value.trim().length > 0) {
      continue;
    }
    throw new Error(`Invalid reminder delivery identity: ${name}`);
  }
}
