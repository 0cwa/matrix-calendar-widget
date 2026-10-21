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

export const PRIVATE_CALENDAR_CLIENT_LIMITS = Object.freeze({
  maxActivePerActorAndTarget: 8,
  credentialLifetimeMs: 90 * 24 * 60 * 60 * 1000,
  pendingLifetimeMs: 5 * 60 * 1000,
});

export type PrivateCalendarClientTarget =
  | Readonly<{ target: 'personal'; calendarId: string }>
  | Readonly<{ target: 'room'; roomId: string; calendarId: string }>;

export type PrivateCalendarClientState = 'pending' | 'active' | 'revoked';
export type PrivateCalendarClientMapState =
  | 'pending'
  | 'present'
  | 'cleanup-pending'
  | 'removed';

/** Persistent data only; never includes the displayed client secret. */
export type PrivateCalendarClientRecord = Readonly<{
  appId: string;
  createdBy: string;
  target: PrivateCalendarClientTarget;
  canonicalPath: string;
  secretVerifier?: string;
  credentialEpochHash: string;
  state: PrivateCalendarClientState;
  mapState: PrivateCalendarClientMapState;
  createdAt: Date;
  expiresAt: Date;
  revokedAt?: Date;
}>;

export type NewPrivateCalendarClientRecord = Readonly<{
  appId: string;
  createdBy: string;
  target: PrivateCalendarClientTarget;
  canonicalPath: string;
  secretVerifier: string;
  credentialEpochHash: string;
  createdAt: Date;
  expiresAt: Date;
}>;

export type PrivateCalendarClientInsertResult =
  | Readonly<{ kind: 'created' }>
  | Readonly<{ kind: 'capacity-reached' }>
  | Readonly<{ kind: 'id-collision' }>;

/** Durable, never-reuse credential registry for scoped CalDAV app IDs. */
export interface PrivateCalendarClientStore {
  readonly enabled: boolean;

  createPending(
    record: NewPrivateCalendarClientRecord,
  ): Promise<PrivateCalendarClientInsertResult>;

  getByAppId(
    appId: string,
    now: Date,
  ): Promise<PrivateCalendarClientRecord | undefined>;

  listForTarget(
    target: PrivateCalendarClientTarget,
    personalOwnerUserId: string,
    now: Date,
  ): Promise<readonly PrivateCalendarClientRecord[]>;

  activate(
    appId: string,
    now: Date,
  ): Promise<PrivateCalendarClientRecord | undefined>;

  /** Revoke first, clear the verifier, and retain the app ID tombstone. */
  revoke(
    appId: string,
    now: Date,
  ): Promise<PrivateCalendarClientRecord | undefined>;

  markMapRemoved(
    appId: string,
  ): Promise<PrivateCalendarClientRecord | undefined>;
}
