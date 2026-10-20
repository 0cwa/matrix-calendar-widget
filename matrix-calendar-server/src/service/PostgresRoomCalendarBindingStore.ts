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

import postgres from 'postgres';
import { RoomCalendarBinding } from '../model/IRoomCalendarBinding';
import {
  ROOM_CALENDAR_BINDING_LIMITS,
  RoomCalendarBindingRecord,
  RoomCalendarBindingRecordStatus,
  RoomCalendarBindingReservation,
  RoomCalendarBindingReservationResult,
  RoomCalendarBindingStore,
} from '../model/IRoomCalendarBindingStore';
import { isMatrixUserId } from './MatrixIdentifiers';
import {
  isCanonicalMatrixRoomId,
  validateRoomCalendarBindings,
} from './RoomCalendarBindingResolver';

type Sql = ReturnType<typeof postgres>;

type DatabaseRoomCalendarBinding = {
  room_id: string;
  calendar_id: string;
  status: string;
  created_by: string;
  created_at: Date | string;
  ready_at: Date | string | null;
};

const bindingStoreMigrations = [
  {
    version: 1,
    sql: `
      CREATE TABLE matrix_calendar_bindings.room_calendar_bindings (
        room_id text PRIMARY KEY,
        calendar_id text NOT NULL UNIQUE,
        status text NOT NULL CHECK (status IN ('pending', 'ready')),
        created_by text NOT NULL,
        created_at timestamptz NOT NULL,
        ready_at timestamptz,
        CHECK ((status = 'ready') = (ready_at IS NOT NULL))
      );

      CREATE INDEX room_calendar_bindings_status_idx
        ON matrix_calendar_bindings.room_calendar_bindings (status, room_id);
    `,
  },
];

const latestBindingStoreMigrationVersion = Math.max(
  ...bindingStoreMigrations.map(({ version }) => version),
);

function toDate(value: Date | string): Date | undefined {
  const date =
    value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isFinite(date.getTime()) ? date : undefined;
}

function readBindingRecord(
  row: DatabaseRoomCalendarBinding,
): RoomCalendarBindingRecord {
  const createdAt = toDate(row.created_at);
  const readyAt = row.ready_at === null ? undefined : toDate(row.ready_at);
  if (
    !isCanonicalMatrixRoomId(row.room_id) ||
    typeof row.calendar_id !== 'string' ||
    (row.status !== 'pending' && row.status !== 'ready') ||
    !isMatrixUserId(row.created_by, true) ||
    createdAt === undefined ||
    (row.ready_at !== null && readyAt === undefined) ||
    (row.status === 'pending' && readyAt !== undefined) ||
    (row.status === 'ready' && readyAt === undefined)
  ) {
    throw new Error('Invalid room calendar binding in store');
  }

  const binding = validateRoomCalendarBindings([
    { roomId: row.room_id, calendarId: row.calendar_id },
  ])[0];
  const record: RoomCalendarBindingRecord = {
    ...binding,
    status: row.status as RoomCalendarBindingRecordStatus,
    createdBy: row.created_by,
    createdAt,
    ...(readyAt === undefined ? {} : { readyAt }),
  };
  return Object.freeze(record);
}

function validateRecordDate(value: Date, name: string): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error(`Invalid room calendar binding ${name}`);
  }
  return new Date(value.getTime());
}

function validateReservation(reservation: RoomCalendarBindingReservation): {
  binding: RoomCalendarBinding;
  staticBindings: readonly RoomCalendarBinding[];
  createdBy: string;
  createdAt: Date;
} {
  const staticBindings = validateRoomCalendarBindings(
    reservation.staticBindings,
  );
  const binding = validateRoomCalendarBindings([reservation.binding])[0];
  if (!isMatrixUserId(reservation.createdBy, true)) {
    throw new Error('Invalid room calendar binding actor');
  }
  return {
    binding,
    staticBindings,
    createdBy: reservation.createdBy,
    createdAt: validateRecordDate(reservation.createdAt, 'creation time'),
  };
}

function staticConflict(
  binding: RoomCalendarBinding,
  staticBindings: readonly RoomCalendarBinding[],
): boolean {
  return staticBindings.some(
    (staticBinding) =>
      staticBinding.roomId === binding.roomId ||
      staticBinding.calendarId === binding.calendarId,
  );
}

/** PostgreSQL adapter for append-only dynamic room/calendar bindings. */
export class PostgresRoomCalendarBindingStore implements RoomCalendarBindingStore {
  readonly enabled = true;

  constructor(private readonly sql: Sql) {}

  /** The provider awaits this before exposing the store to consumers. */
  async migrate(): Promise<void> {
    await this.sql.begin(async (transaction) => {
      await transaction`SELECT pg_advisory_xact_lock(1464097347, 2)`;
      await transaction`CREATE SCHEMA IF NOT EXISTS matrix_calendar_bindings`;
      await transaction`
        CREATE TABLE IF NOT EXISTS matrix_calendar_bindings.schema_migrations (
          version integer PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
        )
      `;

      const [newerMigration] = await transaction<{ version: number }[]>`
        SELECT version
        FROM matrix_calendar_bindings.schema_migrations
        WHERE version > ${latestBindingStoreMigrationVersion}
        ORDER BY version DESC
        LIMIT 1
      `;
      if (newerMigration) {
        throw new Error(
          `Room calendar binding store schema version ${newerMigration.version} is newer than the supported version ${latestBindingStoreMigrationVersion}`,
        );
      }

      for (const migration of bindingStoreMigrations) {
        const [applied] = await transaction<{ version: number }[]>`
          SELECT version
          FROM matrix_calendar_bindings.schema_migrations
          WHERE version = ${migration.version}
        `;
        if (!applied) {
          await transaction.unsafe(migration.sql);
          await transaction`
            INSERT INTO matrix_calendar_bindings.schema_migrations (version)
            VALUES (${migration.version})
          `;
        }
      }
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }

  async listAll(): Promise<readonly RoomCalendarBindingRecord[]> {
    const rows = await this.sql<DatabaseRoomCalendarBinding[]>`
      SELECT room_id, calendar_id, status, created_by, created_at, ready_at
      FROM matrix_calendar_bindings.room_calendar_bindings
      ORDER BY room_id
    `;
    return Object.freeze(rows.map(readBindingRecord));
  }

  async reserve(
    reservation: RoomCalendarBindingReservation,
  ): Promise<RoomCalendarBindingReservationResult> {
    const validated = validateReservation(reservation);
    if (staticConflict(validated.binding, validated.staticBindings)) {
      return { kind: 'static-conflict' };
    }

    return this.sql.begin(async (transaction) => {
      // This lock serializes capacity checks and inserts across service
      // instances, while unique constraints remain the final identity guard.
      await transaction`SELECT pg_advisory_xact_lock(1464097347, 2)`;

      const [countRow] = await transaction<{ count: number }[]>`
        SELECT COUNT(*)::int AS count
        FROM matrix_calendar_bindings.room_calendar_bindings
      `;
      const dynamicCount = countRow?.count;
      if (!Number.isInteger(dynamicCount) || dynamicCount < 0) {
        throw new Error('Invalid room calendar binding store count');
      }
      const configuredCount = validated.staticBindings.length + dynamicCount;
      if (
        configuredCount > ROOM_CALENDAR_BINDING_LIMITS.maxConfiguredBindings
      ) {
        return { kind: 'capacity-reached' };
      }

      const [existingRoom] = await transaction<DatabaseRoomCalendarBinding[]>`
        SELECT room_id, calendar_id, status, created_by, created_at, ready_at
        FROM matrix_calendar_bindings.room_calendar_bindings
        WHERE room_id = ${validated.binding.roomId}
      `;
      if (existingRoom) {
        const existing = readBindingRecord(existingRoom);
        if (staticConflict(existing, validated.staticBindings)) {
          return { kind: 'static-conflict' };
        }
        return { kind: 'existing', record: existing };
      }

      const [existingCalendar] = await transaction<{ room_id: string }[]>`
        SELECT room_id
        FROM matrix_calendar_bindings.room_calendar_bindings
        WHERE calendar_id = ${validated.binding.calendarId}
      `;
      if (existingCalendar) {
        return { kind: 'collection-conflict' };
      }

      if (
        configuredCount >= ROOM_CALENDAR_BINDING_LIMITS.maxConfiguredBindings
      ) {
        return { kind: 'capacity-reached' };
      }

      const [inserted] = await transaction<DatabaseRoomCalendarBinding[]>`
        INSERT INTO matrix_calendar_bindings.room_calendar_bindings (
          room_id, calendar_id, status, created_by, created_at, ready_at
        ) VALUES (
          ${validated.binding.roomId},
          ${validated.binding.calendarId},
          'pending',
          ${validated.createdBy},
          ${validated.createdAt},
          NULL
        )
        ON CONFLICT DO NOTHING
        RETURNING room_id, calendar_id, status, created_by, created_at, ready_at
      `;
      if (inserted) {
        return { kind: 'reserved', record: readBindingRecord(inserted) };
      }

      // A writer outside this adapter may have raced despite our lock.
      const [racedRoom] = await transaction<DatabaseRoomCalendarBinding[]>`
        SELECT room_id, calendar_id, status, created_by, created_at, ready_at
        FROM matrix_calendar_bindings.room_calendar_bindings
        WHERE room_id = ${validated.binding.roomId}
      `;
      if (racedRoom) {
        const existing = readBindingRecord(racedRoom);
        if (staticConflict(existing, validated.staticBindings)) {
          return { kind: 'static-conflict' };
        }
        return { kind: 'existing', record: existing };
      }
      return { kind: 'collection-conflict' };
    });
  }

  async markReady(
    binding: RoomCalendarBinding,
    readyAt: Date,
  ): Promise<RoomCalendarBindingRecord> {
    const [validatedBinding] = validateRoomCalendarBindings([binding]);
    const transitionTime = validateRecordDate(readyAt, 'ready time');

    return this.sql.begin(async (transaction) => {
      const [stored] = await transaction<DatabaseRoomCalendarBinding[]>`
        SELECT room_id, calendar_id, status, created_by, created_at, ready_at
        FROM matrix_calendar_bindings.room_calendar_bindings
        WHERE room_id = ${validatedBinding.roomId}
          AND calendar_id = ${validatedBinding.calendarId}
        FOR UPDATE
      `;
      if (!stored) {
        throw new Error('Room calendar binding reservation not found');
      }

      const record = readBindingRecord(stored);
      if (record.status === 'ready') {
        return record;
      }

      const [updated] = await transaction<DatabaseRoomCalendarBinding[]>`
        UPDATE matrix_calendar_bindings.room_calendar_bindings
        SET status = 'ready', ready_at = ${transitionTime}
        WHERE room_id = ${validatedBinding.roomId}
          AND calendar_id = ${validatedBinding.calendarId}
          AND status = 'pending'
        RETURNING room_id, calendar_id, status, created_by, created_at, ready_at
      `;
      if (!updated) {
        throw new Error('Room calendar binding could not be marked ready');
      }
      return readBindingRecord(updated);
    });
  }
}
