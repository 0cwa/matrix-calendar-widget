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

const CURRENT_USER_ID_LOCALPART_PATTERN = /^[a-z0-9._=/+-]+$/;

/**
 * Validate a Matrix user ID using the current localpart grammar, or the
 * historical localpart rules used for senders in current-room-version events.
 */
export function isMatrixUserId(
  value: unknown,
  allowHistoricalLocalpart = false,
): value is string {
  if (typeof value !== 'string' || !value.startsWith('@')) {
    return false;
  }

  const separator = value.indexOf(':', 1);
  if (separator === -1 || Buffer.byteLength(value, 'utf8') > 255) {
    return false;
  }

  const localpart = value.slice(1, separator);
  if (!isMatrixServerName(value.slice(separator + 1))) {
    return false;
  }

  return (
    CURRENT_USER_ID_LOCALPART_PATTERN.test(localpart) ||
    (allowHistoricalLocalpart && isValidHistoricalLocalpart(localpart))
  );
}

/** Validate a Matrix server name using the room-binding parser's rules. */
export function isMatrixServerName(value: string): boolean {
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

function isValidHistoricalLocalpart(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.codePointAt(index);
    if (
      codePoint === undefined ||
      codePoint === 0 ||
      (codePoint >= 0xd800 && codePoint <= 0xdfff)
    ) {
      return false;
    }
    if (codePoint > 0xffff) {
      index += 1;
    }
  }

  return true;
}

function isValidPort(value: string | undefined): boolean {
  if (value === undefined) {
    return true;
  }
  if (!/^[0-9]{1,5}$/.test(value)) {
    return false;
  }

  const port = Number(value);
  return port >= 1 && port <= 65535;
}
