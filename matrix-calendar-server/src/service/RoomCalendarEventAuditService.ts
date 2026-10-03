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

import { MatrixClient, MatrixError, UserID } from 'matrix-bot-sdk';
import { RoomCalendarBinding } from '../model/IRoomCalendarBinding';
import { resolveRoomCalendarBinding } from './RoomCalendarBindingResolver';

export type RoomCalendarEventAuditAction = 'created' | 'updated' | 'deleted';

/** Data safe to project into a room audit notice. Never pass credentials or ICS. */
export interface RoomCalendarEventAuditContext {
  readonly roomId: string;
  readonly calendarId: string;
  readonly actorUserId: string;
  readonly action: RoomCalendarEventAuditAction;
  /** One validated collection-relative .ics leaf, never a CalDAV href. */
  readonly resourceId: string;
  /** Omitted for deletion notices to avoid an extra CalDAV read. */
  readonly title?: string;
}

export interface RoomCalendarEventAuditOptions {
  /** Explicit opt-in; omitted and false both disable room messages. */
  readonly enabled?: boolean;
  readonly roomCalendarBindings?: readonly RoomCalendarBinding[];
  readonly encryptionEnabled?: boolean;
}

/**
 * Sends best-effort audit notices after a successful room event mutation.
 * Every prerequisite is rechecked against current Matrix state. All errors are
 * swallowed so a post-commit Matrix failure cannot turn a successful CalDAV
 * mutation into an apparent failed request.
 */
export class RoomCalendarEventAuditService {
  constructor(
    private readonly matrixClient: MatrixClient,
    private readonly options: RoomCalendarEventAuditOptions,
  ) {}

  async record(context: RoomCalendarEventAuditContext): Promise<void> {
    if (this.options.enabled !== true) {
      return;
    }

    try {
      if (!isSafeAuditContext(context)) {
        return;
      }

      const senderUserId = await this.matrixClient.getUserId();
      if (!isCanonicalMatrixUserId(senderUserId)) {
        return;
      }

      resolveRoomCalendarBinding(
        this.options.roomCalendarBindings,
        context.roomId,
        context.calendarId,
      );

      const joinedMembers = await this.matrixClient.getJoinedRoomMembers(
        context.roomId,
      );
      if (!joinedMembers.includes(senderUserId)) {
        return;
      }

      const [powerLevels, roomVersion, encrypted] = await Promise.all([
        this.getPowerLevels(context.roomId),
        this.getRoomVersion(context.roomId),
        this.isEncrypted(context.roomId),
      ]);
      if (
        !canSendMessage(powerLevels, senderUserId, roomVersion) ||
        encrypted === undefined
      ) {
        return;
      }

      if (encrypted) {
        // MatrixClient.sendMessage is encryption-aware, but only when crypto is
        // enabled and its own room tracker confirms encryption. Never let it
        // fall back to a plaintext m.room.message in an encrypted room.
        if (
          !this.options.encryptionEnabled ||
          !this.matrixClient.crypto ||
          !(await this.matrixClient.crypto.isRoomEncrypted(context.roomId))
        ) {
          return;
        }
      }

      await this.matrixClient.sendMessage(context.roomId, {
        body: formatAuditNotice(context),
        msgtype: 'm.notice',
        'm.mentions': {},
      });
    } catch {
      // This message is post-commit best effort. Do not log Matrix state,
      // event data, or credentials from a failed audit attempt.
    }
  }

  private async getPowerLevels(
    roomId: string,
  ): Promise<RoomCalendarAuditPowerLevels | undefined> {
    try {
      const event: unknown = await this.matrixClient.getRoomStateEvent(
        roomId,
        'm.room.power_levels',
        '',
      );
      if (!isPlainRecord(event)) {
        throw new Error('Room power-level state is malformed');
      }
      for (const mapName of ['users', 'events'] as const) {
        if (
          Object.prototype.hasOwnProperty.call(event, mapName) &&
          !isPlainRecord(event[mapName])
        ) {
          throw new Error('Room power-level state is malformed');
        }
      }
      return event as RoomCalendarAuditPowerLevels;
    } catch (error) {
      if (isMissingStateEvent(error)) {
        return undefined;
      }
      throw error;
    }
  }

  private async getRoomVersion(roomId: string): Promise<string> {
    const createEvent = await this.matrixClient.getRoomStateEvent(
      roomId,
      'm.room.create',
      '',
    );
    if (!isPlainRecord(createEvent)) {
      throw new Error('Room creation state is unavailable');
    }
    if (!('room_version' in createEvent)) return '1';

    const version = (createEvent as { room_version?: unknown }).room_version;
    return typeof version === 'string' && /^[1-9][0-9]{0,2}$/.test(version)
      ? version
      : 'unknown';
  }

  private async isEncrypted(roomId: string): Promise<boolean | undefined> {
    try {
      const event = await this.matrixClient.getRoomStateEvent(
        roomId,
        'm.room.encryption',
        '',
      );
      if (event === null || typeof event !== 'object') {
        return undefined;
      }
      const algorithm = (event as { algorithm?: unknown }).algorithm;
      return typeof algorithm === 'string' && algorithm.length > 0
        ? true
        : undefined;
    } catch (error) {
      return isMissingStateEvent(error) ? false : undefined;
    }
  }
}

interface RoomCalendarAuditPowerLevels {
  readonly users?: Readonly<Record<string, unknown>>;
  readonly users_default?: unknown;
  readonly events?: Readonly<Record<string, unknown>>;
  readonly events_default?: unknown;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canSendMessage(
  powerLevels: RoomCalendarAuditPowerLevels | undefined,
  senderUserId: string,
  roomVersion: string,
): boolean {
  const legacyEncoding = /^[1-9]$/.test(roomVersion);
  const senderPower = effectivePowerLevel(
    powerLevels?.users?.[senderUserId],
    powerLevels?.users_default,
    legacyEncoding,
    0,
  );
  const messagePower = effectivePowerLevel(
    powerLevels?.events?.['m.room.message'],
    powerLevels?.events_default,
    legacyEncoding,
    0,
  );
  return (
    senderPower !== undefined &&
    messagePower !== undefined &&
    senderPower >= messagePower
  );
}

function effectivePowerLevel(
  value: unknown,
  fallback: unknown,
  legacyEncoding: boolean,
  defaultValue: number,
): number | undefined {
  const selected = value === undefined ? fallback : value;
  if (selected === undefined) {
    return defaultValue;
  }
  if (typeof selected === 'number') {
    if (!Number.isFinite(selected)) {
      return undefined;
    }
    if (Number.isSafeInteger(selected)) {
      return selected;
    }
    return legacyEncoding && Number.isSafeInteger(Math.trunc(selected))
      ? Math.trunc(selected)
      : undefined;
  }
  if (legacyEncoding && typeof selected === 'string') {
    const trimmed = selected.trim();
    if (!/^[+-]?[0-9]+$/.test(trimmed)) {
      return undefined;
    }
    const parsed = Number(trimmed);
    return Number.isSafeInteger(parsed) ? parsed : undefined;
  }
  return undefined;
}

function isMissingStateEvent(error: unknown): boolean {
  return (
    error instanceof MatrixError &&
    error.statusCode === 404 &&
    error.errcode === 'M_NOT_FOUND'
  );
}

function isCanonicalMatrixUserId(userId: string): boolean {
  try {
    const parsed = new UserID(userId);
    const separator = userId.indexOf(':');
    return (
      userId.startsWith('@') &&
      separator > 1 &&
      separator < userId.length - 1 &&
      parsed.localpart.length > 0 &&
      parsed.domain.length > 0 &&
      userId.slice(1, separator) === parsed.localpart &&
      userId.slice(separator + 1) === parsed.domain
    );
  } catch {
    return false;
  }
}

function isSafeAuditContext(context: RoomCalendarEventAuditContext): boolean {
  return (
    !!context &&
    typeof context.roomId === 'string' &&
    context.roomId.length > 0 &&
    typeof context.calendarId === 'string' &&
    context.calendarId.length > 0 &&
    typeof context.actorUserId === 'string' &&
    context.actorUserId.length <= 255 &&
    isCanonicalMatrixUserId(context.actorUserId) &&
    (context.action === 'created' ||
      context.action === 'updated' ||
      context.action === 'deleted') &&
    typeof context.resourceId === 'string' &&
    context.resourceId.length <= 128 &&
    /^[A-Za-z0-9][A-Za-z0-9._@+-]*\.ics$/i.test(context.resourceId) &&
    !context.resourceId.includes('..') &&
    (context.title === undefined || typeof context.title === 'string')
  );
}

function formatAuditNotice(context: RoomCalendarEventAuditContext): string {
  const verb = context.action;
  const actor = singleLine(context.actorUserId, 255).replace(/^@/, '＠');
  const eventSummary =
    context.action === 'deleted'
      ? ''
      : ` Event: ${singleLine(context.title ?? '', 120) || 'Untitled event'}.`;
  const resourceId = singleLine(context.resourceId, 128);
  return `Calendar event ${verb}. Actor: ${actor}.${eventSummary} Resource: ${resourceId}.`;
}

function singleLine(value: string, maxCodePoints: number): string {
  const safe = Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return isUnsafeFormattingCodePoint(codePoint) ? ' ' : character;
  })
    .join('')
    .replace(/\s+/gu, ' ')
    .replace(/@/g, '＠')
    .trim();
  return Array.from(safe).slice(0, maxCodePoints).join('');
}

function isUnsafeFormattingCodePoint(codePoint: number): boolean {
  return (
    codePoint <= 0x1f ||
    (codePoint >= 0x7f && codePoint <= 0x9f) ||
    codePoint === 0x061c ||
    (codePoint >= 0x200b && codePoint <= 0x200f) ||
    (codePoint >= 0x202a && codePoint <= 0x202e) ||
    (codePoint >= 0x2060 && codePoint <= 0x206f) ||
    codePoint === 0xfeff
  );
}
