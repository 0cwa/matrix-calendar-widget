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

import { createHash } from 'node:crypto';
import postgres from 'postgres';
import { PRIVATE_CALENDAR_CLIENT_LIMITS } from '../model/IPrivateCalendarClientStore';
import {
  getPostgresDatabaseTlsOptions,
  parseReminderDatabaseTlsMode,
} from '../reminder/ReminderDatabaseConnection';
import { PostgresPrivateCalendarClientStore } from './PostgresPrivateCalendarClientStore';
import { privateCalendarClientSecretVerifier } from './private-client/PrivateCalendarClientCredentials';
import { PrivateCalendarClientPolicy } from './private-client/PrivateCalendarClientPolicy';

const databaseUrl = process.env.MATRIX_CALENDAR_PRIVATE_CLIENT_DATABASE_URL;
const databaseTlsMode = parseReminderDatabaseTlsMode(
  process.env.MATRIX_CALENDAR_PRIVATE_CLIENT_DATABASE_TLS_MODE,
);
const databaseName = 'matrix_calendar_private_clients_test';
const owner = '@private-client-store-test:example.test';
const localpart = 'private-client-store-test';
const target = {
  target: 'personal' as const,
  calendarId: `http://radicale.example.test/${localpart}/personal/`,
};
const appIds = {
  pending: `mcwpc~${'1'.repeat(48)}`,
  active: `mcwpc~${'2'.repeat(48)}`,
  revoked: `mcwpc~${'3'.repeat(48)}`,
  removed: `mcwpc~${'4'.repeat(48)}`,
  expiredActive: `mcwpc~${'5'.repeat(48)}`,
  expiredPending: `mcwpc~${'6'.repeat(48)}`,
};
const now = new Date('2026-10-21T12:00:00.000Z');
const clientSecret = Buffer.alloc(32, 0x73).toString('base64url');
const epochKey = Buffer.alloc(32, 0x61);
const rotatedEpochKey = Buffer.alloc(32, 0x62);
const callbackKey = Buffer.alloc(32, 0x63);
const epochHash = createHash('sha256').update(epochKey).digest('hex');
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const verifyRestoredDump =
  process.env.MATRIX_CALENDAR_PRIVATE_CLIENT_STORE_VERIFY_RESTORED === 'true';

function parseExplicitDisposableDatabaseUrl(value: string): URL {
  const parsed = new URL(value);
  if (
    !['localhost', '127.0.0.1'].includes(parsed.hostname) ||
    parsed.pathname.slice(1) !== databaseName ||
    decodeURIComponent(parsed.username) !== 'matrix_calendar_app' ||
    parsed.search !== '' ||
    parsed.hash !== '' ||
    !/^\d{1,5}$/u.test(parsed.port) ||
    Number(parsed.port) < 1 ||
    Number(parsed.port) > 65535
  ) {
    throw new Error(
      `The private client contract requires a query-free loopback URL for ${databaseName} and matrix_calendar_app`,
    );
  }
  return parsed;
}

function createTestPostgresClient(): ReturnType<typeof postgres> {
  const parsed = parseExplicitDisposableDatabaseUrl(databaseUrl as string);
  const options = {
    ...getPostgresDatabaseTlsOptions(databaseTlsMode, parsed.toString()),
    max: 3,
    connect_timeout: 5,
    onnotice: () => undefined,
  } as unknown as Parameters<typeof postgres>[1];
  return postgres(parsed.toString(), options);
}

async function requireIsolatedTestDatabase(
  sql: ReturnType<typeof postgres>,
): Promise<void> {
  const [database] = await sql<
    {
      name: string;
      role: string;
      owner: string;
      is_superuser: boolean;
      can_create_database: boolean;
      can_create_role: boolean;
      can_connect_current_database: boolean;
      can_connect_postgres: boolean;
      can_connect_template1: boolean;
    }[]
  >`
    SELECT current_database() AS name,
           current_user AS role,
           pg_get_userbyid(database.datdba) AS owner,
           role_row.rolsuper AS is_superuser,
           role_row.rolcreatedb AS can_create_database,
           role_row.rolcreaterole AS can_create_role,
           has_database_privilege(current_user, current_database(), 'CONNECT') AS can_connect_current_database,
           has_database_privilege(current_user, 'postgres', 'CONNECT') AS can_connect_postgres,
           has_database_privilege(current_user, 'template1', 'CONNECT') AS can_connect_template1
    FROM pg_database AS database
    JOIN pg_roles AS role_row ON role_row.rolname = current_user
    WHERE database.datname = current_database()
  `;
  if (
    database.name !== databaseName ||
    database.role !== 'matrix_calendar_app'
  ) {
    throw new Error(
      `The private client contract requires the isolated ${databaseName} database and matrix_calendar_app role`,
    );
  }
  if (
    database.owner !== database.role ||
    database.is_superuser ||
    database.can_create_database ||
    database.can_create_role ||
    !database.can_connect_current_database ||
    database.can_connect_postgres ||
    database.can_connect_template1
  ) {
    throw new Error(
      'The private client contract requires a database-owning role without elevated PostgreSQL privileges',
    );
  }
}

describeWithDatabase('PostgresPrivateCalendarClientStore integration', () => {
  let sql: ReturnType<typeof postgres>;
  let store: PostgresPrivateCalendarClientStore;
  let initialized = false;

  beforeAll(async () => {
    sql = createTestPostgresClient();
    await requireIsolatedTestDatabase(sql);
    store = new PostgresPrivateCalendarClientStore(sql);
    await store.migrate();
    if (!verifyRestoredDump) {
      await sql`
        DELETE FROM matrix_calendar_private_clients.private_calendar_clients
        WHERE app_id = ANY(${Object.values(appIds)}::text[])
      `;
    }
    initialized = true;
  });

  afterAll(async () => {
    if (!initialized) {
      await sql?.end({ timeout: 5 });
      return;
    }
    await sql.end({ timeout: 5 });
  });

  it('persists pending, active, expired, and revoked rows across adapter restart', async () => {
    const activeExpiry = new Date(now.getTime() + 1);
    const makeRecord = (
      appId: string,
      createdAt = now,
      expiresAt = new Date(
        createdAt.getTime() +
          PRIVATE_CALENDAR_CLIENT_LIMITS.credentialLifetimeMs,
      ),
    ) => ({
      appId,
      createdBy: owner,
      target,
      canonicalPath: `/${localpart}/personal/`,
      secretVerifier: privateCalendarClientSecretVerifier(appId, clientSecret),
      credentialEpochHash: epochHash,
      createdAt,
      expiresAt,
    });
    if (verifyRestoredDump) {
      expect(await store.getByAppId(appIds.pending, now)).toMatchObject({
        state: 'pending',
        mapState: 'pending',
        secretVerifier: privateCalendarClientSecretVerifier(
          appIds.pending,
          clientSecret,
        ),
      });
      expect(await store.getByAppId(appIds.active, now)).toMatchObject({
        state: 'active',
        mapState: 'present',
        credentialEpochHash: epochHash,
      });
      for (const [appId, mapState] of [
        [appIds.revoked, 'cleanup-pending'],
        [appIds.removed, 'removed'],
        [appIds.expiredActive, 'cleanup-pending'],
        [appIds.expiredPending, 'cleanup-pending'],
      ] as const) {
        const revoked = await store.getByAppId(appId, now);
        expect(revoked).toMatchObject({ state: 'revoked', mapState });
        expect(revoked).not.toHaveProperty('secretVerifier');
      }

      const policyForEpoch = (key: Buffer) =>
        new PrivateCalendarClientPolicy(
          {
            private_calendar_clients_enabled: true,
            private_calendar_client_epoch_key: key,
            private_calendar_client_callback_key: callbackKey,
          } as never,
          store,
          { canManageCalendars: jest.fn() } as never,
          { getJoinedRoomMembers: jest.fn() } as never,
          {} as never,
          () => now,
        );
      expect(
        await policyForEpoch(epochKey).authenticate(
          appIds.active,
          clientSecret,
        ),
      ).toBe(true);
      expect(
        await policyForEpoch(rotatedEpochKey).authenticate(
          appIds.active,
          clientSecret,
        ),
      ).toBe(false);
      return;
    }

    const created = await store.createPending(makeRecord(appIds.pending));
    expect(created).toEqual({ kind: 'created' });
    expect(await store.createPending(makeRecord(appIds.active))).toEqual({
      kind: 'created',
    });
    expect(await store.activate(appIds.active, now)).toMatchObject({
      state: 'active',
      mapState: 'present',
      secretVerifier: privateCalendarClientSecretVerifier(
        appIds.active,
        clientSecret,
      ),
    });

    await store.createPending(makeRecord(appIds.revoked));
    await store.activate(appIds.revoked, now);
    const revoked = await store.revoke(appIds.revoked, now);
    expect(revoked).toMatchObject({
      state: 'revoked',
      mapState: 'cleanup-pending',
      revokedAt: now,
    });
    expect(revoked).not.toHaveProperty('secretVerifier');

    await store.createPending(makeRecord(appIds.removed));
    await store.activate(appIds.removed, now);
    const revokedRemoved = await store.revoke(appIds.removed, now);
    expect(revokedRemoved).not.toHaveProperty('secretVerifier');
    const removed = await store.markMapRemoved(appIds.removed);
    expect(removed).toMatchObject({
      state: 'revoked',
      mapState: 'removed',
    });
    expect(removed).not.toHaveProperty('secretVerifier');

    await store.createPending(
      makeRecord(appIds.expiredActive, now, activeExpiry),
    );
    expect(await store.activate(appIds.expiredActive, now)).toMatchObject({
      state: 'active',
      secretVerifier: privateCalendarClientSecretVerifier(
        appIds.expiredActive,
        clientSecret,
      ),
    });
    const expiredActive = await store.getByAppId(
      appIds.expiredActive,
      activeExpiry,
    );
    expect(expiredActive).toMatchObject({
      state: 'revoked',
      mapState: 'cleanup-pending',
      revokedAt: activeExpiry,
    });
    expect(expiredActive).not.toHaveProperty('secretVerifier');

    const expiredPendingCreatedAt = new Date(
      now.getTime() - PRIVATE_CALENDAR_CLIENT_LIMITS.pendingLifetimeMs,
    );
    await store.createPending(
      makeRecord(appIds.expiredPending, expiredPendingCreatedAt),
    );
    const expiredPending = await store.getByAppId(appIds.expiredPending, now);
    expect(expiredPending).toMatchObject({
      state: 'revoked',
      mapState: 'cleanup-pending',
      revokedAt: now,
    });
    expect(expiredPending).not.toHaveProperty('secretVerifier');

    await store.onApplicationShutdown();
    sql = createTestPostgresClient();
    await requireIsolatedTestDatabase(sql);
    store = new PostgresPrivateCalendarClientStore(sql);
    await store.migrate();

    expect(await store.getByAppId(appIds.pending, now)).toMatchObject({
      state: 'pending',
      mapState: 'pending',
      secretVerifier: privateCalendarClientSecretVerifier(
        appIds.pending,
        clientSecret,
      ),
    });
    expect(await store.getByAppId(appIds.active, now)).toMatchObject({
      state: 'active',
      mapState: 'present',
      secretVerifier: privateCalendarClientSecretVerifier(
        appIds.active,
        clientSecret,
      ),
    });
    for (const appId of [
      appIds.revoked,
      appIds.removed,
      appIds.expiredActive,
      appIds.expiredPending,
    ]) {
      const record = await store.getByAppId(appId, now);
      expect(record).toMatchObject({ state: 'revoked' });
      expect(record).not.toHaveProperty('secretVerifier');
    }
    expect(await store.getByAppId(appIds.revoked, now)).toMatchObject({
      state: 'revoked',
      mapState: 'cleanup-pending',
    });
    expect(await store.getByAppId(appIds.removed, now)).toMatchObject({
      state: 'revoked',
      mapState: 'removed',
    });
    expect(await store.createPending(makeRecord(appIds.revoked))).toEqual({
      kind: 'id-collision',
    });
  });
});
