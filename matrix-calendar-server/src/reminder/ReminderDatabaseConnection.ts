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

import { isIP } from 'net';

export const REMINDER_DATABASE_TLS_MODES = [
  'verify-full',
  'trusted-private-network',
] as const;

export type ReminderDatabaseTlsMode =
  (typeof REMINDER_DATABASE_TLS_MODES)[number];

export function parseReminderDatabaseTlsMode(
  value: string | undefined,
): ReminderDatabaseTlsMode {
  if (value === undefined || value === 'verify-full') {
    return 'verify-full';
  }

  if (value === 'trusted-private-network') {
    return value;
  }

  throw new Error(
    'MATRIX_CALENDAR_REMINDER_DATABASE_TLS_MODE must be verify-full or trusted-private-network',
  );
}

export type ReminderDatabaseTlsOptions = {
  host?: string[];
  port?: number[];
  ssl: 'verify-full' | false | { host: string; rejectUnauthorized: true };
};

type DatabaseUrlHost = { hostname: string; port?: number };

function parseDatabasePort(port: string | undefined): number {
  if (port === undefined || port === '') {
    const pgPort = process.env.PGPORT;
    if (pgPort === undefined || pgPort === '') {
      return 5432;
    }

    port = pgPort;
  }

  if (!/^\d{1,5}$/.test(port)) {
    throw new Error('Verified PostgreSQL TLS requires a valid database port');
  }

  const parsedPort = Number(port);
  if (parsedPort < 1 || parsedPort > 65535) {
    throw new Error('Verified PostgreSQL TLS requires a valid database port');
  }

  return parsedPort;
}

function getUrlHosts(databaseUrl: string): DatabaseUrlHost[] {
  const authority = databaseUrl.match(/^[a-z][a-z\d+.-]*:\/\/([^/?#]*)/i)?.[1];
  if (!authority) {
    throw new Error(
      'Verified PostgreSQL TLS requires a database URL with a hostname or IP address',
    );
  }

  const hostList = authority.slice(authority.lastIndexOf('@') + 1);
  const hostPorts = hostList.split(',');
  const hosts = hostPorts.map((hostPort) => {
    const ipv6 = hostPort.match(/^\[([^\]]+)\](?::(\d+))?$/);
    if (ipv6) {
      if (isIP(ipv6[1]) !== 6) {
        throw new Error(
          'Verified PostgreSQL TLS requires unambiguous database host entries',
        );
      }

      return {
        hostname: ipv6[1],
        port: ipv6[2] === undefined ? undefined : parseDatabasePort(ipv6[2]),
      };
    }

    const hostname = hostPort.match(/^([^:]+)(?::(\d+))?$/);
    if (hostname) {
      return {
        hostname: hostname[1],
        port:
          hostname[2] === undefined
            ? undefined
            : parseDatabasePort(hostname[2]),
      };
    }

    throw new Error(
      'Verified PostgreSQL TLS requires unambiguous database host entries',
    );
  });

  return hosts;
}

export function getReminderDatabaseTlsOptions(
  mode: ReminderDatabaseTlsMode,
  databaseUrl: string,
): ReminderDatabaseTlsOptions {
  if (mode === 'trusted-private-network') {
    return { ssl: false };
  }

  const hosts = getUrlHosts(databaseUrl);
  const ipHosts = hosts.filter((host) => isIP(host.hostname) !== 0);
  if (ipHosts.length === 0) {
    return { ssl: 'verify-full' };
  }

  if (hosts.length !== 1) {
    throw new Error(
      'Verified PostgreSQL TLS for IP addresses requires a single database host',
    );
  }

  // Postgres.js 3.4.5 splits host strings on colons, including bracketed IPv6
  // literals. Supply its supported host/port arrays to preserve the socket
  // target, and pass the same IP to Node TLS for certificate identity checks.
  const host = hosts[0];
  return {
    host: [host.hostname],
    port: [host.port ?? parseDatabasePort(undefined)],
    ssl: { host: host.hostname, rejectUnauthorized: true },
  };
}
