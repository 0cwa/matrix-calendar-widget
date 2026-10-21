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
import {
  NewPrivateCalendarClientRecord,
  PRIVATE_CALENDAR_CLIENT_LIMITS,
  PrivateCalendarClientInsertResult,
  PrivateCalendarClientMapState,
  PrivateCalendarClientRecord,
  PrivateCalendarClientState,
  PrivateCalendarClientStore,
  PrivateCalendarClientTarget,
} from '../model/IPrivateCalendarClientStore';
import { isMatrixUserId } from './MatrixIdentifiers';
import { isCanonicalMatrixRoomId } from './RoomCalendarBindingResolver';

type Sql = ReturnType<typeof postgres>;

type PrivateCalendarClientRow = {
  app_id: string;
  created_by: string;
  target_kind: string;
  owner_user_id: string | null;
  room_id: string | null;
  calendar_id: string;
  canonical_path: string;
  secret_verifier: string | null;
  credential_epoch_hash: string;
  state: string;
  map_state: string;
  created_at: Date | string;
  expires_at: Date | string;
  revoked_at: Date | string | null;
};

const APP_ID_PATTERN = /^mcwpc~[a-f0-9]{48}$/u;
const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const CALENDAR_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const STORE_MIGRATIONS = [
  {
    version: 1,
    sql: `
      CREATE TABLE matrix_calendar_private_clients.private_calendar_clients (
        app_id text PRIMARY KEY,
        created_by text NOT NULL,
        target_kind text NOT NULL CHECK (target_kind IN ('personal', 'room')),
        owner_user_id text,
        room_id text,
        calendar_id text NOT NULL,
        canonical_path text NOT NULL,
        secret_verifier text,
        credential_epoch_hash text NOT NULL,
        state text NOT NULL CHECK (state IN ('pending', 'active', 'revoked')),
        map_state text NOT NULL CHECK (map_state IN ('pending', 'present', 'cleanup-pending', 'removed')),
        created_at timestamptz NOT NULL,
        expires_at timestamptz NOT NULL,
        revoked_at timestamptz,
        CHECK (app_id ~ '^mcwpc~[a-f0-9]{48}$'),
        CHECK (secret_verifier IS NULL OR secret_verifier ~ '^[a-f0-9]{64}$'),
        CHECK (credential_epoch_hash ~ '^[a-f0-9]{64}$'),
        CHECK (expires_at > created_at),
        CHECK (
          (target_kind = 'personal' AND owner_user_id = created_by AND room_id IS NULL)
          OR
          (target_kind = 'room' AND owner_user_id IS NULL AND room_id IS NOT NULL)
        ),
        CHECK (
          (state = 'revoked' AND secret_verifier IS NULL AND revoked_at IS NOT NULL
            AND map_state IN ('cleanup-pending', 'removed'))
          OR
          (state = 'pending' AND secret_verifier IS NOT NULL AND revoked_at IS NULL
            AND map_state = 'pending')
          OR
          (state = 'active' AND secret_verifier IS NOT NULL AND revoked_at IS NULL
            AND map_state = 'present')
        )
      );

      CREATE INDEX private_calendar_clients_target_idx
        ON matrix_calendar_private_clients.private_calendar_clients
          (target_kind, room_id, owner_user_id, calendar_id, created_at DESC);
      CREATE INDEX private_calendar_clients_expiry_idx
        ON matrix_calendar_private_clients.private_calendar_clients
          (expires_at)
        WHERE state = 'active';
    `,
  },
];

const latestMigrationVersion = Math.max(
  ...STORE_MIGRATIONS.map(({ version }) => version),
);

function toDate(value: Date | string | null): Date | undefined {
  if (value === null) return undefined;
  const date =
    value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isFinite(date.getTime()) ? date : undefined;
}

function readRecord(
  row: PrivateCalendarClientRow,
): PrivateCalendarClientRecord {
  const createdAt = toDate(row.created_at);
  const expiresAt = toDate(row.expires_at);
  const revokedAt = toDate(row.revoked_at);
  const target =
    row.target_kind === 'personal' && row.owner_user_id !== null
      ? { target: 'personal' as const, calendarId: row.calendar_id }
      : row.target_kind === 'room' && row.room_id !== null
        ? {
            target: 'room' as const,
            roomId: row.room_id,
            calendarId: row.calendar_id,
          }
        : undefined;

  if (
    !APP_ID_PATTERN.test(row.app_id) ||
    !isMatrixUserId(row.created_by, true) ||
    !target ||
    (target.target === 'personal' && row.owner_user_id !== row.created_by) ||
    (target.target === 'personal' &&
      !isPersonalTargetPath(row.calendar_id, row.canonical_path)) ||
    (target.target === 'room' && !isCanonicalMatrixRoomId(target.roomId)) ||
    (target.target === 'room' &&
      !CALENDAR_ID_PATTERN.test(target.calendarId)) ||
    !isSafeCanonicalPath(row.canonical_path) ||
    (row.secret_verifier !== null && !HASH_PATTERN.test(row.secret_verifier)) ||
    !HASH_PATTERN.test(row.credential_epoch_hash) ||
    !isClientState(row.state) ||
    !isMapState(row.map_state) ||
    !createdAt ||
    !expiresAt ||
    expiresAt <= createdAt ||
    (row.revoked_at !== null && !revokedAt) ||
    (row.state === 'revoked' &&
      (row.secret_verifier !== null ||
        revokedAt === undefined ||
        !['cleanup-pending', 'removed'].includes(row.map_state))) ||
    (row.state !== 'revoked' &&
      (row.secret_verifier === null ||
        revokedAt !== undefined ||
        (row.state === 'pending' && row.map_state !== 'pending') ||
        (row.state === 'active' && row.map_state !== 'present')))
  ) {
    throw new Error('Invalid private calendar client record in store');
  }

  return Object.freeze({
    appId: row.app_id,
    createdBy: row.created_by,
    target,
    canonicalPath: row.canonical_path,
    ...(row.secret_verifier ? { secretVerifier: row.secret_verifier } : {}),
    credentialEpochHash: row.credential_epoch_hash,
    state: row.state as PrivateCalendarClientState,
    mapState: row.map_state as PrivateCalendarClientMapState,
    createdAt,
    expiresAt,
    ...(revokedAt ? { revokedAt } : {}),
  });
}

function isClientState(value: string): value is PrivateCalendarClientState {
  return value === 'pending' || value === 'active' || value === 'revoked';
}

function isMapState(value: string): value is PrivateCalendarClientMapState {
  return (
    value === 'pending' ||
    value === 'present' ||
    value === 'cleanup-pending' ||
    value === 'removed'
  );
}

function isSafeCanonicalPath(path: string): boolean {
  if (
    !path.startsWith('/') ||
    !path.endsWith('/') ||
    path.includes('?') ||
    path.includes('#') ||
    path.includes('\\') ||
    /%(?![A-Fa-f0-9]{2})|%(?:2f|5c|00)/iu.test(path)
  ) {
    return false;
  }

  const segments = path.slice(1, -1).split('/');
  if (segments.length !== 2 || segments.some((segment) => !segment)) {
    return false;
  }
  return segments.every((segment) => {
    try {
      const decoded = decodeURIComponent(segment);
      return (
        decoded !== '.' &&
        decoded !== '..' &&
        !decoded.includes('/') &&
        !decoded.includes('\\') &&
        !decoded.includes('%') &&
        !/[\u0000-\u001f\u007f]/u.test(decoded)
      );
    } catch {
      return false;
    }
  });
}

function targetColumns(target: PrivateCalendarClientTarget): {
  targetKind: 'personal' | 'room';
  ownerUserId: string | null;
  roomId: string | null;
  calendarId: string;
} {
  if (target.target === 'personal') {
    return {
      targetKind: 'personal',
      ownerUserId: null,
      roomId: null,
      calendarId: target.calendarId,
    };
  }
  return {
    targetKind: 'room',
    ownerUserId: null,
    roomId: target.roomId,
    calendarId: target.calendarId,
  };
}

function validateNewRecord(record: NewPrivateCalendarClientRecord): void {
  if (
    !APP_ID_PATTERN.test(record.appId) ||
    !isMatrixUserId(record.createdBy, true) ||
    !isSafeCanonicalPath(record.canonicalPath) ||
    !HASH_PATTERN.test(record.secretVerifier) ||
    !HASH_PATTERN.test(record.credentialEpochHash) ||
    !(record.createdAt instanceof Date) ||
    !Number.isFinite(record.createdAt.getTime()) ||
    !(record.expiresAt instanceof Date) ||
    !Number.isFinite(record.expiresAt.getTime()) ||
    record.expiresAt <= record.createdAt ||
    record.expiresAt.getTime() - record.createdAt.getTime() >
      PRIVATE_CALENDAR_CLIENT_LIMITS.credentialLifetimeMs ||
    (record.target.target === 'personal' &&
      !isPersonalTargetPath(record.target.calendarId, record.canonicalPath))
  ) {
    throw new Error('Invalid new private calendar client record');
  }

  if (
    record.target.target === 'room' &&
    (!isCanonicalMatrixRoomId(record.target.roomId) ||
      !CALENDAR_ID_PATTERN.test(record.target.calendarId))
  ) {
    throw new Error('Invalid new private calendar client target');
  }
}

/** PostgreSQL-backed credential registry; revoked app IDs remain tombstoned. */
export class PostgresPrivateCalendarClientStore implements PrivateCalendarClientStore {
  readonly enabled = true;

  constructor(private readonly sql: Sql) {}

  async migrate(): Promise<void> {
    await this.sql.begin(async (transaction) => {
      await transaction`SELECT pg_advisory_xact_lock(1464097347, 4)`;
      await transaction`CREATE SCHEMA IF NOT EXISTS matrix_calendar_private_clients`;
      await transaction`
        CREATE TABLE IF NOT EXISTS matrix_calendar_private_clients.schema_migrations (
          version integer PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
        )
      `;
      const [newerMigration] = await transaction<{ version: number }[]>`
        SELECT version
        FROM matrix_calendar_private_clients.schema_migrations
        WHERE version > ${latestMigrationVersion}
        ORDER BY version DESC
        LIMIT 1
      `;
      if (newerMigration) {
        throw new Error(
          `Private calendar client store schema version ${newerMigration.version} is newer than the supported version ${latestMigrationVersion}`,
        );
      }

      for (const migration of STORE_MIGRATIONS) {
        const [applied] = await transaction<{ version: number }[]>`
          SELECT version
          FROM matrix_calendar_private_clients.schema_migrations
          WHERE version = ${migration.version}
        `;
        if (!applied) {
          await transaction.unsafe(migration.sql);
          await transaction`
            INSERT INTO matrix_calendar_private_clients.schema_migrations (version)
            VALUES (${migration.version})
          `;
        }
      }
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }

  async createPending(
    record: NewPrivateCalendarClientRecord,
  ): Promise<PrivateCalendarClientInsertResult> {
    validateNewRecord(record);
    const columns = targetColumns(record.target);
    if (
      (record.target.target === 'personal' && record.createdBy.length === 0) ||
      (record.target.target === 'room' &&
        columns.roomId !== record.target.roomId)
    ) {
      throw new Error('Invalid private calendar client owner');
    }

    return this.sql.begin(async (transaction) => {
      await transaction`SELECT pg_advisory_xact_lock(1464097347, 4)`;
      await transaction`
        UPDATE matrix_calendar_private_clients.private_calendar_clients
        SET state = 'revoked',
            secret_verifier = NULL,
            revoked_at = COALESCE(revoked_at, ${record.createdAt}),
            map_state = CASE WHEN map_state = 'removed' THEN 'removed' ELSE 'cleanup-pending' END
        WHERE (state = 'active' AND expires_at <= ${record.createdAt})
           OR (state = 'pending' AND created_at <= ${new Date(record.createdAt.getTime() - PRIVATE_CALENDAR_CLIENT_LIMITS.pendingLifetimeMs)})
      `;

      const [existing] = await transaction<{ app_id: string }[]>`
        SELECT app_id
        FROM matrix_calendar_private_clients.private_calendar_clients
        WHERE app_id = ${record.appId}
      `;
      if (existing) return { kind: 'id-collision' };

      const roomId = columns.roomId;
      const ownerUserId =
        record.target.target === 'personal' ? record.createdBy : null;
      const [countRow] = await transaction<{ count: number }[]>`
        SELECT COUNT(*)::int AS count
        FROM matrix_calendar_private_clients.private_calendar_clients
        WHERE created_by = ${record.createdBy}
          AND target_kind = ${columns.targetKind}
          AND owner_user_id IS NOT DISTINCT FROM ${ownerUserId}
          AND room_id IS NOT DISTINCT FROM ${roomId}
          AND calendar_id = ${columns.calendarId}
          AND state IN ('pending', 'active')
          AND expires_at > ${record.createdAt}
      `;
      if (
        !Number.isInteger(countRow?.count) ||
        (countRow?.count ?? 0) >=
          PRIVATE_CALENDAR_CLIENT_LIMITS.maxActivePerActorAndTarget
      ) {
        return { kind: 'capacity-reached' };
      }

      try {
        await transaction`
          INSERT INTO matrix_calendar_private_clients.private_calendar_clients (
            app_id, created_by, target_kind, owner_user_id, room_id,
            calendar_id, canonical_path, secret_verifier,
            credential_epoch_hash, state, map_state, created_at, expires_at,
            revoked_at
          ) VALUES (
            ${record.appId}, ${record.createdBy}, ${columns.targetKind},
            ${ownerUserId}, ${roomId}, ${columns.calendarId},
            ${record.canonicalPath}, ${record.secretVerifier},
            ${record.credentialEpochHash}, 'pending', 'pending',
            ${record.createdAt}, ${record.expiresAt}, NULL
          )
        `;
      } catch (error) {
        if (isUniqueViolation(error)) return { kind: 'id-collision' };
        throw error;
      }
      return { kind: 'created' };
    });
  }

  async getByAppId(
    appId: string,
    now: Date,
  ): Promise<PrivateCalendarClientRecord | undefined> {
    await expireRows(this.sql, now, appId);
    const [row] = await this.sql<PrivateCalendarClientRow[]>`
      SELECT *
      FROM matrix_calendar_private_clients.private_calendar_clients
      WHERE app_id = ${appId}
    `;
    return row ? readRecord(row) : undefined;
  }

  async listForTarget(
    target: PrivateCalendarClientTarget,
    personalOwnerUserId: string,
    now: Date,
  ): Promise<readonly PrivateCalendarClientRecord[]> {
    const columns = targetColumns(target);
    if (!isMatrixUserId(personalOwnerUserId, true)) {
      throw new Error('Invalid private calendar client target owner');
    }
    await expireRows(this.sql, now);
    const ownerUserId =
      target.target === 'personal' ? personalOwnerUserId : null;
    const rows = await this.sql<PrivateCalendarClientRow[]>`
      SELECT *
      FROM matrix_calendar_private_clients.private_calendar_clients
      WHERE target_kind = ${columns.targetKind}
        AND owner_user_id IS NOT DISTINCT FROM ${ownerUserId}
        AND room_id IS NOT DISTINCT FROM ${columns.roomId}
        AND calendar_id = ${columns.calendarId}
      ORDER BY created_at DESC, app_id
    `;
    return Object.freeze(rows.map(readRecord));
  }

  async activate(
    appId: string,
    now: Date,
  ): Promise<PrivateCalendarClientRecord | undefined> {
    const [row] = await this.sql<PrivateCalendarClientRow[]>`
      UPDATE matrix_calendar_private_clients.private_calendar_clients
      SET state = 'active', map_state = 'present'
      WHERE app_id = ${appId}
        AND state = 'pending'
        AND expires_at > ${now}
        AND created_at > ${new Date(now.getTime() - PRIVATE_CALENDAR_CLIENT_LIMITS.pendingLifetimeMs)}
      RETURNING *
    `;
    return row ? readRecord(row) : undefined;
  }

  async revoke(
    appId: string,
    now: Date,
  ): Promise<PrivateCalendarClientRecord | undefined> {
    await this.sql`
      UPDATE matrix_calendar_private_clients.private_calendar_clients
      SET state = 'revoked',
          secret_verifier = NULL,
          revoked_at = COALESCE(revoked_at, ${now}),
          map_state = CASE WHEN map_state = 'removed' THEN 'removed' ELSE 'cleanup-pending' END
      WHERE app_id = ${appId}
        AND state <> 'revoked'
    `;
    return this.getByAppId(appId, now);
  }

  async markMapRemoved(
    appId: string,
  ): Promise<PrivateCalendarClientRecord | undefined> {
    const [row] = await this.sql<PrivateCalendarClientRow[]>`
      UPDATE matrix_calendar_private_clients.private_calendar_clients
      SET map_state = 'removed'
      WHERE app_id = ${appId}
        AND state = 'revoked'
      RETURNING *
    `;
    return row ? readRecord(row) : undefined;
  }
}

export class DisabledPrivateCalendarClientStore implements PrivateCalendarClientStore {
  readonly enabled = false;

  async createPending(): Promise<PrivateCalendarClientInsertResult> {
    throw new Error('Private calendar client store is disabled');
  }

  async getByAppId(): Promise<undefined> {
    return undefined;
  }

  async listForTarget(): Promise<readonly PrivateCalendarClientRecord[]> {
    return Object.freeze([]);
  }

  async activate(): Promise<undefined> {
    return undefined;
  }

  async revoke(): Promise<undefined> {
    return undefined;
  }

  async markMapRemoved(): Promise<undefined> {
    return undefined;
  }
}

async function expireRows(sql: Sql, now: Date, appId?: string): Promise<void> {
  const pendingBefore = new Date(
    now.getTime() - PRIVATE_CALENDAR_CLIENT_LIMITS.pendingLifetimeMs,
  );
  await sql`
    UPDATE matrix_calendar_private_clients.private_calendar_clients
    SET state = 'revoked',
        secret_verifier = NULL,
        revoked_at = COALESCE(revoked_at, ${now}),
        map_state = CASE WHEN map_state = 'removed' THEN 'removed' ELSE 'cleanup-pending' END
    WHERE (${appId ?? null}::text IS NULL OR app_id = ${appId ?? null})
      AND ((state = 'active' AND expires_at <= ${now})
        OR (state = 'pending' AND created_at <= ${pendingBefore}))
  `;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}

function isPersonalTargetPath(
  calendarId: string,
  canonicalPath: string,
): boolean {
  try {
    const url = new URL(calendarId);
    return (
      url.origin !== 'null' &&
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === canonicalPath
    );
  } catch {
    return false;
  }
}
