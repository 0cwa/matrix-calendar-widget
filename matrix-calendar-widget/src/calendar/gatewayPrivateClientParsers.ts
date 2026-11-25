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

import { CalendarRepositoryError } from '@matrix-calendar-widget/calendar';
import type {
  PrivateCalendarClientMetadata,
  PrivateCalendarClientTarget,
} from './CalendarPrivateClientRepository';
import {
  containsControlCharacters,
  isBoundedString,
  isRecord,
  isSafeMatrixRoomId,
} from './gatewayParserUtils';

export function validatePrivateCalendarClientMetadata(
  value: unknown,
  expectedTarget?: PrivateCalendarClientTarget,
): PrivateCalendarClientMetadata {
  if (
    !isRecord(value) ||
    typeof value.appId !== 'string' ||
    !/^mcwpc~[a-f0-9]{48}$/u.test(value.appId) ||
    !isRecord(value.target) ||
    !isBoundedString(value.target.calendarId, 4096) ||
    (value.target.target !== 'personal' && value.target.target !== 'room') ||
    (value.state !== 'pending' &&
      value.state !== 'active' &&
      value.state !== 'revoked') ||
    (value.mapState !== 'pending' &&
      value.mapState !== 'present' &&
      value.mapState !== 'cleanup-pending' &&
      value.mapState !== 'removed') ||
    !isValidTimestamp(value.createdAt) ||
    !isValidTimestamp(value.expiresAt) ||
    (value.revokedAt !== undefined && !isValidTimestamp(value.revokedAt))
  ) {
    throw invalidPrivateCalendarClients();
  }

  let target: PrivateCalendarClientTarget;
  if (value.target.target === 'personal') {
    if ('roomId' in value.target) throw invalidPrivateCalendarClients();
    target = { target: 'personal', calendarId: value.target.calendarId };
  } else {
    if (!isSafeMatrixRoomId(value.target.roomId)) {
      throw invalidPrivateCalendarClients();
    }
    target = {
      target: 'room',
      roomId: value.target.roomId,
      calendarId: value.target.calendarId,
    };
  }

  if (expectedTarget && !samePrivateCalendarTarget(target, expectedTarget)) {
    throw invalidPrivateCalendarClients();
  }

  return Object.freeze({
    appId: value.appId,
    target,
    state: value.state,
    mapState: value.mapState,
    createdAt: value.createdAt,
    expiresAt: value.expiresAt,
    ...(value.revokedAt ? { revokedAt: value.revokedAt } : {}),
  });
}

function samePrivateCalendarTarget(
  left: PrivateCalendarClientTarget,
  right: PrivateCalendarClientTarget,
): boolean {
  return (
    left.target === right.target &&
    left.calendarId === right.calendarId &&
    (left.target === 'personal' ||
      (right.target === 'room' && left.roomId === right.roomId))
  );
}

export function isPrivateClientGatewayUrl(
  value: string,
  appId: string,
  baseUrl: string,
): boolean {
  try {
    const url = new URL(value);
    const gateway = new URL(baseUrl);
    const secureOrLocal =
      url.protocol === 'https:' ||
      (url.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
    return (
      secureOrLocal &&
      url.origin === gateway.origin &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === `/${appId}/calendar/`
    );
  } catch {
    return false;
  }
}

function isValidTimestamp(value: unknown): value is string {
  return (
    isBoundedString(value, 64) &&
    Number.isFinite(Date.parse(value)) &&
    !containsControlCharacters(value)
  );
}

export function invalidPrivateCalendarClients(): CalendarRepositoryError {
  return new CalendarRepositoryError(
    'request-failed',
    'Private calendar app access is unavailable',
  );
}
