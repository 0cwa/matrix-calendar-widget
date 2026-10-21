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

import type { MatrixClient } from 'matrix-bot-sdk';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { IAppConfiguration } from '../../IAppConfiguration';
import type {
  PrivateCalendarClientRecord,
  PrivateCalendarClientStore,
} from '../../model/IPrivateCalendarClientStore';
import type { MatrixCalendarAuthorizationFactory } from '../MatrixCalendarAuthorization';
import type { RoomCalendarCalDavAccess } from '../RoomCalendarCalDavAccess';
import {
  PRIVATE_CALENDAR_CLIENT_APP_ID_PATTERN,
  privateCalendarClientSecretVerifier,
} from './PrivateCalendarClientCredentials';

export type PrivateCalendarClientDavScope =
  | 'principal'
  | 'collection'
  | 'resource';

export type PrivateCalendarClientDavMethod =
  | 'OPTIONS'
  | 'PROPFIND'
  | 'REPORT'
  | 'GET'
  | 'HEAD'
  | 'PUT'
  | 'DELETE';

type CurrentPolicy = Readonly<{ read: boolean; write: boolean }>;

const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const CLIENT_SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

/** Current credential and Matrix-policy checks shared by the callback and DAV gateways. */
export class PrivateCalendarClientPolicy {
  constructor(
    private readonly appConfig: IAppConfiguration,
    private readonly store: PrivateCalendarClientStore,
    private readonly authorizationFactory: MatrixCalendarAuthorizationFactory,
    private readonly matrixClient: MatrixClient,
    private readonly roomCalendarCalDavAccess: RoomCalendarCalDavAccess,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async authenticate(username: unknown, password: unknown): Promise<boolean> {
    if (
      !this.enabled() ||
      typeof username !== 'string' ||
      !PRIVATE_CALENDAR_CLIENT_APP_ID_PATTERN.test(username) ||
      typeof password !== 'string' ||
      !CLIENT_SECRET_PATTERN.test(password)
    ) {
      return false;
    }

    try {
      const record = await this.store.getByAppId(username, this.now());
      if (
        !record ||
        (record.state !== 'pending' && record.state !== 'active') ||
        !record.secretVerifier ||
        !HASH_PATTERN.test(record.secretVerifier) ||
        !this.hasCurrentEpoch(record)
      ) {
        return false;
      }

      const supplied = privateCalendarClientSecretVerifier(username, password);
      if (!constantTimeHexEqual(record.secretVerifier, supplied)) return false;

      if (record.state === 'active' && record.target.target === 'room') {
        const membership = await this.currentMembership(record);
        if (membership === 'left') {
          await this.store.revoke(record.appId, this.now());
          return false;
        }
        if (membership !== 'joined') return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  async rights(username: unknown, path: unknown): Promise<string> {
    if (
      !this.enabled() ||
      typeof username !== 'string' ||
      !PRIVATE_CALENDAR_CLIENT_APP_ID_PATTERN.test(username) ||
      typeof path !== 'string'
    ) {
      return '';
    }

    try {
      const record = await this.activeRecord(username);
      if (!record) return '';
      const current = await this.currentPolicy(record);
      if (!current.read) return '';

      const pathKind = radicalePathKind(record, path);
      if (pathKind === 'principal' || pathKind === 'alias-collection')
        return 'r';
      if (pathKind === 'alias-resource' || pathKind === 'canonical') {
        // Radicale resolves mapped resources to the canonical owner path before
        // calling Rights. The exact stored collection boundary therefore
        // scopes both canonical and still-aliased callbacks without exposing
        // the owner's other collections.
        return current.write ? 'rw' : 'r';
      }
      return '';
    } catch {
      return '';
    }
  }

  async authorizeDavRequest(
    appId: string,
    method: PrivateCalendarClientDavMethod,
    scope: PrivateCalendarClientDavScope,
  ): Promise<boolean> {
    if (
      !this.enabled() ||
      !PRIVATE_CALENDAR_CLIENT_APP_ID_PATTERN.test(appId)
    ) {
      return false;
    }

    try {
      const record = await this.activeRecord(appId);
      if (!record) return false;
      const current = await this.currentPolicy(record);
      if (!current.read) return false;

      if (method === 'PUT' || method === 'DELETE') {
        return scope === 'resource' && current.write;
      }
      if (method === 'OPTIONS') return scope !== 'resource' || current.read;
      if (method === 'PROPFIND') return true;
      return scope !== 'principal';
    } catch {
      return false;
    }
  }

  private async activeRecord(
    appId: string,
  ): Promise<PrivateCalendarClientRecord | undefined> {
    const record = await this.store.getByAppId(appId, this.now());
    if (
      !record ||
      record.state !== 'active' ||
      record.mapState !== 'present' ||
      !this.hasCurrentEpoch(record)
    ) {
      return undefined;
    }
    return record;
  }

  private async currentPolicy(
    record: PrivateCalendarClientRecord,
  ): Promise<CurrentPolicy> {
    if (record.target.target === 'personal') {
      return { read: true, write: true };
    }

    const membership = await this.currentMembership(record);
    if (membership === 'left') {
      await this.store.revoke(record.appId, this.now());
      return { read: false, write: false };
    }
    if (membership !== 'joined') return { read: false, write: false };

    try {
      const currentCalendar =
        await this.roomCalendarCalDavAccess.forAuthorizedTarget(
          {
            roomId: record.target.roomId,
            calendarId: record.target.calendarId,
            principal: { kind: 'service' },
          },
          'read',
        );
      if (
        new URL(currentCalendar.calendarUrl).pathname !== record.canonicalPath
      ) {
        return { read: false, write: false };
      }
    } catch {
      return { read: false, write: false };
    }

    let canManage = false;
    try {
      canManage = await this.authorizationFactory.canManageCalendars(
        record.createdBy,
        record.target.roomId,
      );
    } catch {
      return { read: false, write: false };
    }
    return { read: true, write: canManage };
  }

  private async currentMembership(
    record: PrivateCalendarClientRecord,
  ): Promise<'joined' | 'left' | 'unknown'> {
    if (record.target.target !== 'room') return 'joined';
    try {
      const members = await this.matrixClient.getJoinedRoomMembers(
        record.target.roomId,
      );
      if (
        !Array.isArray(members) ||
        !members.every((value) => typeof value === 'string')
      ) {
        return 'unknown';
      }
      return members.includes(record.createdBy) ? 'joined' : 'left';
    } catch {
      return 'unknown';
    }
  }

  private hasCurrentEpoch(record: PrivateCalendarClientRecord): boolean {
    const key = this.appConfig.private_calendar_client_epoch_key;
    if (
      !key ||
      key.byteLength !== 32 ||
      !HASH_PATTERN.test(record.credentialEpochHash)
    ) {
      return false;
    }
    const current = createHash('sha256').update(key).digest('hex');
    return constantTimeHexEqual(record.credentialEpochHash, current);
  }

  private enabled(): boolean {
    return (
      this.appConfig.private_calendar_clients_enabled === true &&
      this.appConfig.private_calendar_client_callback_key?.byteLength === 32 &&
      this.store.enabled
    );
  }
}

function radicalePathKind(
  record: PrivateCalendarClientRecord,
  inputPath: string,
):
  | 'principal'
  | 'alias-collection'
  | 'alias-resource'
  | 'canonical'
  | undefined {
  if (
    inputPath.includes('?') ||
    inputPath.includes('#') ||
    inputPath.includes('\\') ||
    /%(?:2f|5c|00|25)/iu.test(inputPath)
  ) {
    return undefined;
  }
  const path = inputPath.startsWith('/') ? inputPath : `/${inputPath}`;
  if (path === `/${record.appId}` || path === `/${record.appId}/`) {
    return 'principal';
  }
  const aliasPrefix = `/${record.appId}/calendar/`;
  if (path === aliasPrefix || path === aliasPrefix.slice(0, -1)) {
    return 'alias-collection';
  }
  if (path.startsWith(aliasPrefix)) {
    if (isOneSafeResourcePath(path.slice(aliasPrefix.length))) {
      return 'alias-resource';
    }
    return undefined;
  }

  const canonicalPath = record.canonicalPath;
  if (path === canonicalPath || path === canonicalPath.slice(0, -1)) {
    return 'canonical';
  }
  if (path.startsWith(canonicalPath)) {
    return isOneSafeResourcePath(path.slice(canonicalPath.length))
      ? 'canonical'
      : undefined;
  }
  return undefined;
}

function isOneSafeResourcePath(leaf: string): boolean {
  if (!leaf || leaf.includes('/')) return false;
  try {
    const decoded = decodeURIComponent(leaf);
    if (
      !decoded ||
      decoded === '.' ||
      decoded === '..' ||
      decoded.includes('/') ||
      decoded.includes('\\') ||
      decoded.includes('%') ||
      // Intentional validation of raw control characters in resource names.
      // eslint-disable-next-line no-control-regex
      /[\u0000-\u001f\u007f]/u.test(decoded)
    ) {
      return false;
    }
  } catch {
    return false;
  }
  return true;
}

function constantTimeHexEqual(left: string, right: string): boolean {
  if (!HASH_PATTERN.test(left) || !HASH_PATTERN.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}
