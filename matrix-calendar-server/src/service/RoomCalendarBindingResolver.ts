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

import { isIP } from 'node:net';
import { RoomCalendarBinding } from '../model/IRoomCalendarBinding';

export type RoomCalendarBindingErrorCode =
  | 'invalid_json'
  | 'invalid_configuration'
  | 'invalid_room_id'
  | 'invalid_calendar_id'
  | 'duplicate_room_id'
  | 'duplicate_calendar_id'
  | 'missing_binding'
  | 'request_calendar_mismatch';

/** Safe error for invalid operator configuration or an unresolvable request. */
export class RoomCalendarBindingError extends Error {
  constructor(readonly code: RoomCalendarBindingErrorCode) {
    super(`Room calendar binding ${code.replaceAll('_', ' ')}`);
    this.name = 'RoomCalendarBindingError';
  }
}

const CALENDAR_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const DOMAINLESS_ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * Read a JSON array rather than a JSON object so duplicate room entries remain
 * visible and can be rejected before any lookup structure is constructed.
 */
export function parseRoomCalendarBindings(
  serialized: string | undefined,
): readonly RoomCalendarBinding[] {
  if (serialized === undefined) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new RoomCalendarBindingError('invalid_json');
  }

  return validateRoomCalendarBindings(parsed);
}

/** Validate the full configuration before resolving any individual room. */
export function validateRoomCalendarBindings(
  value: unknown,
): readonly RoomCalendarBinding[] {
  if (!Array.isArray(value)) {
    throw new RoomCalendarBindingError('invalid_configuration');
  }

  const roomIds = new Set<string>();
  const calendarIds = new Set<string>();
  const bindings: RoomCalendarBinding[] = [];

  for (const entry of value) {
    if (
      entry === null ||
      typeof entry !== 'object' ||
      Array.isArray(entry) ||
      Object.getPrototypeOf(entry) !== Object.prototype
    ) {
      throw new RoomCalendarBindingError('invalid_configuration');
    }

    const record = entry as Record<string, unknown>;
    const keys = Reflect.ownKeys(record);
    if (
      keys.length !== 2 ||
      !keys.includes('roomId') ||
      !keys.includes('calendarId')
    ) {
      throw new RoomCalendarBindingError('invalid_configuration');
    }

    if (!isCanonicalMatrixRoomId(record.roomId)) {
      throw new RoomCalendarBindingError('invalid_room_id');
    }
    if (!isAppOwnedCalendarId(record.calendarId)) {
      throw new RoomCalendarBindingError('invalid_calendar_id');
    }

    const roomId = record.roomId;
    const calendarId = record.calendarId;
    if (roomIds.has(roomId)) {
      throw new RoomCalendarBindingError('duplicate_room_id');
    }
    if (calendarIds.has(calendarId)) {
      throw new RoomCalendarBindingError('duplicate_calendar_id');
    }

    roomIds.add(roomId);
    calendarIds.add(calendarId);
    bindings.push(Object.freeze({ roomId, calendarId }));
  }

  return Object.freeze(bindings);
}

/** Resolve only an exact configured room and reject caller-selected targets. */
export function resolveRoomCalendarBinding(
  configuredBindings: unknown,
  requestedRoomId: unknown,
  requestedCalendarId?: unknown,
): RoomCalendarBinding {
  const bindings = validateRoomCalendarBindings(configuredBindings);
  if (!isCanonicalMatrixRoomId(requestedRoomId)) {
    throw new RoomCalendarBindingError('invalid_room_id');
  }
  if (
    requestedCalendarId !== undefined &&
    !isAppOwnedCalendarId(requestedCalendarId)
  ) {
    throw new RoomCalendarBindingError('request_calendar_mismatch');
  }

  const binding = bindings.find(({ roomId }) => roomId === requestedRoomId);
  if (binding === undefined) {
    throw new RoomCalendarBindingError('missing_binding');
  }
  if (
    requestedCalendarId !== undefined &&
    binding.calendarId !== requestedCalendarId
  ) {
    throw new RoomCalendarBindingError('request_calendar_mismatch');
  }

  return binding;
}

function isAppOwnedCalendarId(value: unknown): value is string {
  return typeof value === 'string' && CALENDAR_ID_PATTERN.test(value);
}

function isCanonicalMatrixRoomId(value: unknown): value is string {
  if (typeof value !== 'string' || !value.startsWith('!')) {
    return false;
  }

  const identifier = value.slice(1);
  const delimiter = identifier.indexOf(':');
  const opaqueId =
    delimiter === -1 ? identifier : identifier.slice(0, delimiter);
  if (opaqueId.length === 0 || containsInvalidUnicode(opaqueId)) {
    return false;
  }

  // Room version 12 IDs are the unpadded URL-safe Base64 SHA-256 reference
  // hash of the m.room.create event. Older room IDs append a server name.
  if (delimiter === -1) {
    if (!DOMAINLESS_ROOM_ID_PATTERN.test(identifier)) {
      return false;
    }
    const hash = Buffer.from(identifier, 'base64url');
    return hash.length === 32 && hash.toString('base64url') === identifier;
  }

  return (
    Buffer.byteLength(value, 'utf8') <= 255 &&
    isMatrixServerName(identifier.slice(delimiter + 1))
  );
}

function isMatrixServerName(value: string): boolean {
  if (value.length === 0 || /[\s/?#@]/u.test(value)) {
    return false;
  }

  const bracketedIpv6 = /^(\[[0-9A-Fa-f:.]+\])(?::([0-9]+))?$/.exec(value);
  if (bracketedIpv6 !== null) {
    const address = bracketedIpv6[1].slice(1, -1);
    return isIP(address) === 6 && isValidPort(bracketedIpv6[2]);
  }

  const hostAndPort = /^([^:]+)(?::([0-9]+))?$/.exec(value);
  if (hostAndPort === null) {
    return false;
  }

  const host = hostAndPort[1];
  if (!isValidPort(hostAndPort[2])) {
    return false;
  }
  if (isIP(host) === 4) {
    return true;
  }
  if (/^[0-9.]+$/.test(host) || host.length > 255) {
    return false;
  }

  return host
    .split('.')
    .every((label) =>
      /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label),
    );
}

function isValidPort(value: string | undefined): boolean {
  if (value === undefined) {
    return true;
  }
  return /^[0-9]{1,5}$/.test(value);
}

function containsInvalidUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.codePointAt(index);
    if (codePoint === undefined || codePoint === 0) {
      return true;
    }
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) {
      return true;
    }
    if (codePoint > 0xffff) {
      index += 1;
    }
  }
  return false;
}
