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
import postgres from 'postgres';
import {
  createReminderDeliveryKey,
  ReminderConfigurationCursor,
  ReminderDeliveryClaim,
  ReminderDeliveryIdentity,
  RoomReminderConfiguration,
  RoomReminderStore,
  validateReminderConfigurationCursorShape,
  validateReminderConfigurationPageLimit,
  validateReminderDeliveryIdentity,
  validateRoomReminderConfiguration,
} from './RoomReminderStore';

export { createReminderDeliveryKey } from './RoomReminderStore';

type Sql = ReturnType<typeof postgres>;

type DatabaseRoomReminderConfiguration = {
  room_id: string;
  calendar_id: string;
  event_uid: string;
  recurrence_id: string;
  alarm_uid: string;
};

type DatabaseDeliveryClaim = {
  delivery_key: string;
  claim_token: string;
  attempt_count: number;
  lease_expires_at: Date;
};

type CancellableQuery<T> = Promise<T> & { cancel(): void };

/**
 * Request cancellation of queued/in-flight PostgreSQL work when a deadline
 * expires. PostgreSQL cancellation is best effort; the caller must remain
 * safe if the statement completes despite the abort.
 */
function awaitCancellableQuery<T>(
  query: CancellableQuery<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (signal === undefined) return query;

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      query.cancel();
      reject(new Error('Reminder store operation aborted'));
    };
    if (signal.aborted) {
      onAbort();
      void query.catch(() => undefined);
      return;
    }

    signal.addEventListener('abort', onAbort, { once: true });
    void query
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', onAbort))
      .catch(reject);
  });
}

const reminderStoreMigrations = [
  {
    version: 1,
    sql: `
      CREATE TABLE matrix_calendar.room_reminder_configurations (
        room_id text NOT NULL,
        calendar_id text NOT NULL,
        event_uid text NOT NULL,
        recurrence_id text NOT NULL DEFAULT '',
        alarm_uid text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        PRIMARY KEY (room_id, calendar_id, event_uid, recurrence_id, alarm_uid)
      );

      CREATE INDEX room_reminder_configurations_calendar_idx
        ON matrix_calendar.room_reminder_configurations (calendar_id, event_uid);

      CREATE TABLE matrix_calendar.reminder_deliveries (
        delivery_key text PRIMARY KEY,
        room_id text NOT NULL,
        calendar_id text NOT NULL,
        event_uid text NOT NULL,
        recurrence_id text NOT NULL DEFAULT '',
        alarm_uid text NOT NULL,
        trigger_ordinal integer NOT NULL CHECK (trigger_ordinal >= 0),
        state text NOT NULL CHECK (state IN ('claimed', 'pending', 'sent')),
        claim_token uuid,
        lease_expires_at timestamptz,
        attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
        created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        sent_at timestamptz,
        UNIQUE (room_id, calendar_id, event_uid, recurrence_id, alarm_uid, trigger_ordinal),
        CHECK ((state = 'sent') = (sent_at IS NOT NULL)),
        CHECK (
          (state = 'claimed' AND claim_token IS NOT NULL AND lease_expires_at IS NOT NULL)
          OR
          (state <> 'claimed' AND claim_token IS NULL AND lease_expires_at IS NULL)
        )
      );

      CREATE INDEX reminder_deliveries_claim_idx
        ON matrix_calendar.reminder_deliveries (state, lease_expires_at);
    `,
  },
];
const latestReminderStoreMigrationVersion = Math.max(
  ...reminderStoreMigrations.map(({ version }) => version),
);

function readConfigurationRow(
  row: DatabaseRoomReminderConfiguration,
): RoomReminderConfiguration {
  if (
    typeof row.room_id !== 'string' ||
    typeof row.calendar_id !== 'string' ||
    typeof row.event_uid !== 'string' ||
    typeof row.recurrence_id !== 'string' ||
    typeof row.alarm_uid !== 'string'
  ) {
    throw new Error('Invalid room reminder configuration in store');
  }
  const configuration: RoomReminderConfiguration = {
    roomId: row.room_id,
    calendarId: row.calendar_id,
    eventUid: row.event_uid,
    recurrenceId: row.recurrence_id || null,
    alarmUid: row.alarm_uid,
  };
  try {
    validateRoomReminderConfiguration(configuration);
  } catch {
    throw new Error('Invalid room reminder configuration in store');
  }
  return configuration;
}

/**
 * PostgreSQL adapter for Matrix-specific reminder metadata and delivery
 * claims. CalDAV remains the canonical source of calendar/event data.
 */
export class PostgresRoomReminderStore implements RoomReminderStore {
  readonly enabled = true;

  constructor(private readonly sql: Sql) {}

  async onModuleInit(): Promise<void> {
    await this.migrate();
  }

  async onModuleDestroy(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }

  async migrate(): Promise<void> {
    await this.sql.begin(async (transaction) => {
      await transaction`SELECT pg_advisory_xact_lock(1464097347, 1)`;
      await transaction`CREATE SCHEMA IF NOT EXISTS matrix_calendar`;
      await transaction`
        CREATE TABLE IF NOT EXISTS matrix_calendar.schema_migrations (
          version integer PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
        )
      `;

      const [newerMigration] = await transaction<{ version: number }[]>`
        SELECT version
        FROM matrix_calendar.schema_migrations
        WHERE version > ${latestReminderStoreMigrationVersion}
        ORDER BY version DESC
        LIMIT 1
      `;
      if (newerMigration) {
        throw new Error(
          `Reminder store schema version ${newerMigration.version} is newer than the supported version ${latestReminderStoreMigrationVersion}`,
        );
      }

      for (const migration of reminderStoreMigrations) {
        const [applied] = await transaction<{ version: number }[]>`
          SELECT version
          FROM matrix_calendar.schema_migrations
          WHERE version = ${migration.version}
        `;
        if (!applied) {
          await transaction.unsafe(migration.sql);
          await transaction`
            INSERT INTO matrix_calendar.schema_migrations (version)
            VALUES (${migration.version})
          `;
        }
      }
    });
  }

  async upsertConfiguration(
    configuration: RoomReminderConfiguration,
  ): Promise<void> {
    validateRoomReminderConfiguration(configuration);
    await this.sql`
      INSERT INTO matrix_calendar.room_reminder_configurations (
        room_id, calendar_id, event_uid, recurrence_id, alarm_uid
      ) VALUES (
        ${configuration.roomId},
        ${configuration.calendarId},
        ${configuration.eventUid},
        ${configuration.recurrenceId ?? ''},
        ${configuration.alarmUid}
      )
      ON CONFLICT (room_id, calendar_id, event_uid, recurrence_id, alarm_uid)
      DO NOTHING
    `;
  }

  async listConfigurations(
    roomId: string,
    calendarId: string,
  ): Promise<RoomReminderConfiguration[]> {
    const rows = await this.sql<DatabaseRoomReminderConfiguration[]>`
      SELECT room_id, calendar_id, event_uid, recurrence_id, alarm_uid
      FROM matrix_calendar.room_reminder_configurations
      WHERE room_id = ${roomId} AND calendar_id = ${calendarId}
      ORDER BY event_uid, recurrence_id, alarm_uid
    `;

    return rows.map(readConfigurationRow);
  }

  async listConfigurationPage(
    roomId: string,
    calendarId: string,
    after: ReminderConfigurationCursor | undefined,
    limit: number,
    signal?: AbortSignal,
  ): Promise<RoomReminderConfiguration[]> {
    validateReminderConfigurationPageLimit(limit);
    if (after !== undefined) {
      validateReminderConfigurationCursorShape(after);
    }

    const query = after
      ? this.sql<DatabaseRoomReminderConfiguration[]>`
          SELECT room_id, calendar_id, event_uid, recurrence_id, alarm_uid
          FROM matrix_calendar.room_reminder_configurations
          WHERE room_id = ${roomId}
            AND calendar_id = ${calendarId}
            AND (event_uid, recurrence_id, alarm_uid) > (
              ${after.eventUid}, ${after.recurrenceId ?? ''}, ${after.alarmUid}
            )
          ORDER BY event_uid, recurrence_id, alarm_uid
          LIMIT ${limit}
        `
      : this.sql<DatabaseRoomReminderConfiguration[]>`
          SELECT room_id, calendar_id, event_uid, recurrence_id, alarm_uid
          FROM matrix_calendar.room_reminder_configurations
          WHERE room_id = ${roomId} AND calendar_id = ${calendarId}
          ORDER BY event_uid, recurrence_id, alarm_uid
          LIMIT ${limit}
        `;
    const rows = await awaitCancellableQuery(query, signal);

    return rows.map(readConfigurationRow);
  }

  async hasConfiguration(
    configuration: RoomReminderConfiguration,
    signal?: AbortSignal,
  ): Promise<boolean> {
    validateRoomReminderConfiguration(configuration);
    const query = this.sql<{ configuration_exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1
        FROM matrix_calendar.room_reminder_configurations
        WHERE room_id = ${configuration.roomId}
          AND calendar_id = ${configuration.calendarId}
          AND event_uid = ${configuration.eventUid}
          AND recurrence_id = ${configuration.recurrenceId ?? ''}
          AND alarm_uid = ${configuration.alarmUid}
      ) AS configuration_exists
    `;
    const [row] = await awaitCancellableQuery(query, signal);
    return row.configuration_exists;
  }

  async deleteConfiguration(
    configuration: RoomReminderConfiguration,
  ): Promise<void> {
    validateRoomReminderConfiguration(configuration);
    await this.sql`
      DELETE FROM matrix_calendar.room_reminder_configurations
      WHERE room_id = ${configuration.roomId}
        AND calendar_id = ${configuration.calendarId}
        AND event_uid = ${configuration.eventUid}
        AND recurrence_id = ${configuration.recurrenceId ?? ''}
        AND alarm_uid = ${configuration.alarmUid}
    `;
  }

  async deleteEventConfigurations(
    calendarId: string,
    eventUid: string,
  ): Promise<void> {
    await this.sql`
      DELETE FROM matrix_calendar.room_reminder_configurations
      WHERE calendar_id = ${calendarId} AND event_uid = ${eventUid}
    `;
  }

  async deleteCalendarConfigurations(calendarId: string): Promise<void> {
    await this.sql`
      DELETE FROM matrix_calendar.room_reminder_configurations
      WHERE calendar_id = ${calendarId}
    `;
  }

  async claimDelivery(
    identity: ReminderDeliveryIdentity,
    leaseDurationMs: number,
    signal?: AbortSignal,
  ): Promise<ReminderDeliveryClaim | undefined> {
    validateReminderDeliveryIdentity(identity);
    if (!Number.isSafeInteger(leaseDurationMs) || leaseDurationMs <= 0) {
      throw new Error('Reminder delivery lease duration must be positive');
    }

    const deliveryKey = createReminderDeliveryKey(identity);
    const claimToken = randomUUID();
    const query = this.sql<DatabaseDeliveryClaim[]>`
      INSERT INTO matrix_calendar.reminder_deliveries (
        delivery_key, room_id, calendar_id, event_uid, recurrence_id,
        alarm_uid, trigger_ordinal, state, claim_token, lease_expires_at,
        attempt_count
      ) VALUES (
        ${deliveryKey},
        ${identity.roomId},
        ${identity.calendarId},
        ${identity.eventUid},
        ${identity.recurrenceId ?? ''},
        ${identity.alarmUid},
        ${identity.triggerOrdinal},
        'claimed',
        ${claimToken},
        clock_timestamp() + (${leaseDurationMs} * interval '1 millisecond'),
        1
      )
      ON CONFLICT (delivery_key) DO UPDATE SET
        state = 'claimed',
        claim_token = EXCLUDED.claim_token,
        lease_expires_at = EXCLUDED.lease_expires_at,
        attempt_count = matrix_calendar.reminder_deliveries.attempt_count + 1,
        updated_at = clock_timestamp()
      WHERE matrix_calendar.reminder_deliveries.state = 'pending'
         OR matrix_calendar.reminder_deliveries.lease_expires_at <= clock_timestamp()
      RETURNING delivery_key, claim_token, attempt_count, lease_expires_at
    `;
    const [row] = await awaitCancellableQuery(query, signal);

    if (!row) {
      return undefined;
    }

    return {
      deliveryKey: row.delivery_key,
      claimToken: row.claim_token,
      attemptCount: row.attempt_count,
      leaseExpiresAt: row.lease_expires_at,
    };
  }

  async markDeliverySent(
    deliveryKey: string,
    claimToken: string,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const query = this.sql<{ delivery_key: string }[]>`
      UPDATE matrix_calendar.reminder_deliveries
      SET state = 'sent',
          claim_token = NULL,
          lease_expires_at = NULL,
          sent_at = clock_timestamp(),
          updated_at = clock_timestamp()
      WHERE delivery_key = ${deliveryKey}
        AND state = 'claimed'
        AND claim_token = ${claimToken}
      RETURNING delivery_key
    `;
    const updated = await awaitCancellableQuery(query, signal);
    return updated.length === 1;
  }

  async releaseDeliveryClaim(
    deliveryKey: string,
    claimToken: string,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const query = this.sql<{ delivery_key: string }[]>`
      UPDATE matrix_calendar.reminder_deliveries
      SET state = 'pending',
          claim_token = NULL,
          lease_expires_at = NULL,
          updated_at = clock_timestamp()
      WHERE delivery_key = ${deliveryKey}
        AND state = 'claimed'
        AND claim_token = ${claimToken}
      RETURNING delivery_key
    `;
    const updated = await awaitCancellableQuery(query, signal);
    return updated.length === 1;
  }
}
