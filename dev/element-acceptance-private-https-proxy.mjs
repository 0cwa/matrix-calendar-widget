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

import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';

const ALLOWED_HOSTS = new Set(['127.0.0.1:3001', 'private-gateway-https:3443']);
const ALLOWED_METHODS = new Set([
  'GET',
  'HEAD',
  'OPTIONS',
  'PATCH',
  'POST',
  'PROPFIND',
  'PUT',
  'REPORT',
  'DELETE',
]);
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);
const MAX_REQUEST_LIFETIME_MS = 60_000;
const LISTEN_HOST = '0.0.0.0';
const LISTEN_PORT = 3443;
const UPSTREAM_HOST = 'gateway';
const UPSTREAM_PORT = 3000;
const TLS_MOUNT_PATH = '/run/mcw-private-ui-tls';
const GATEWAY_RUNTIME_UID = 101;
const GATEWAY_RUNTIME_GID = 0;

function invalidConfiguration() {
  return new TypeError(
    'Private acceptance HTTPS proxy configuration is invalid',
  );
}

function normalizeAllowedHosts(value) {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some(
      (host) =>
        typeof host !== 'string' ||
        host.length === 0 ||
        host !== host.trim() ||
        !ALLOWED_HOSTS.has(host.toLowerCase()),
    )
  ) {
    throw invalidConfiguration();
  }
  return new Set(value.map((host) => host.toLowerCase()));
}

function cleanRequestHeaders(request) {
  const connectionTokens = new Set(
    String(request.headers.connection ?? '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
  const forwardedHeaders = [];
  for (let index = 0; index + 1 < request.rawHeaders.length; index += 2) {
    const name = request.rawHeaders[index];
    const value = request.rawHeaders[index + 1];
    const lowerName = name.toLowerCase();
    if (
      !HOP_BY_HOP_HEADERS.has(lowerName) &&
      !connectionTokens.has(lowerName)
    ) {
      forwardedHeaders.push(name, value);
    }
  }
  return forwardedHeaders;
}

function cleanResponseHeaders(headers) {
  const result = Object.create(null);
  for (const [name, value] of Object.entries(headers)) {
    if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase())) result[name] = value;
  }
  return result;
}

function sendFixedError(response, status, message) {
  const body = Buffer.from(message, 'utf8');
  response.writeHead(status, {
    connection: 'close',
    'content-length': String(body.byteLength),
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(body);
}

/**
 * Create a TLS-only transport bridge for the isolated Element acceptance
 * stack. It forwards HTTP/DAV bytes to the existing gateway and contains no
 * Matrix, CalDAV, or private-client authorization decisions.
 */
export function createPrivateAcceptanceHttpsProxy({
  key,
  cert,
  upstreamHost,
  upstreamPort,
  allowedHosts = [...ALLOWED_HOSTS],
  listenHost = LISTEN_HOST,
  listenPort = LISTEN_PORT,
} = {}) {
  if (
    !(Buffer.isBuffer(key) || typeof key === 'string') ||
    !(Buffer.isBuffer(cert) || typeof cert === 'string') ||
    typeof upstreamHost !== 'string' ||
    !/^[a-z0-9][a-z0-9.-]{0,252}$/u.test(upstreamHost) ||
    !Number.isSafeInteger(upstreamPort) ||
    upstreamPort < 1 ||
    upstreamPort > 65_535 ||
    typeof listenHost !== 'string' ||
    listenHost.length === 0 ||
    !Number.isSafeInteger(listenPort) ||
    listenPort < 0 ||
    listenPort > 65_535
  ) {
    throw invalidConfiguration();
  }
  const hostAllowlist = normalizeAllowedHosts(allowedHosts);

  const server = https.createServer(
    { key, cert, minVersion: 'TLSv1.2', maxVersion: 'TLSv1.3' },
    (request, response) => {
      const host = request.headers.host?.toLowerCase();
      if (!host || !hostAllowlist.has(host)) {
        sendFixedError(response, 421, 'Misdirected Request');
        return;
      }
      if (!ALLOWED_METHODS.has(request.method ?? '')) {
        response.setHeader('allow', [...ALLOWED_METHODS].join(', '));
        sendFixedError(response, 405, 'Method Not Allowed');
        return;
      }

      let upstreamRequest;
      try {
        upstreamRequest = http.request(
          {
            host: upstreamHost,
            port: upstreamPort,
            method: request.method,
            path: request.url,
            headers: cleanRequestHeaders(request),
            timeout: MAX_REQUEST_LIFETIME_MS,
          },
          (upstreamResponse) => {
            const headers = cleanResponseHeaders(upstreamResponse.headers);
            response.writeHead(upstreamResponse.statusCode ?? 502, headers);
            upstreamResponse.pipe(response);
          },
        );
      } catch {
        sendFixedError(response, 502, 'Bad Gateway');
        return;
      }

      upstreamRequest.once('timeout', () => {
        upstreamRequest.destroy();
      });
      upstreamRequest.once('error', () => {
        if (response.headersSent) {
          response.destroy();
        } else {
          sendFixedError(response, 502, 'Bad Gateway');
        }
      });
      request.once('aborted', () => upstreamRequest.destroy());
      request.pipe(upstreamRequest);
    },
  );

  server.headersTimeout = MAX_REQUEST_LIFETIME_MS;
  server.requestTimeout = MAX_REQUEST_LIFETIME_MS;
  server.keepAliveTimeout = 5_000;
  server.on('clientError', (_error, socket) => {
    if (socket.writable) {
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    }
  });
  server.on('tlsClientError', () => undefined);
  return server;
}

export function dropToGatewayRuntimeUser(runtimeProcess = process) {
  if (
    typeof runtimeProcess.getuid !== 'function' ||
    runtimeProcess.getuid() !== 0 ||
    typeof runtimeProcess.setgroups !== 'function' ||
    typeof runtimeProcess.setgid !== 'function' ||
    typeof runtimeProcess.setuid !== 'function'
  ) {
    throw invalidConfiguration();
  }
  // Match matrix-calendar-server/Dockerfile's USER 101 and its 101:0
  // runtime-storage ownership. Remove inherited groups before applying that
  // primary group and user identity.
  runtimeProcess.setgroups([]);
  runtimeProcess.setgid(GATEWAY_RUNTIME_GID);
  runtimeProcess.setuid(GATEWAY_RUNTIME_UID);
}

export function readTlsMaterialAndDropPrivileges({
  mountPath,
  readFile = readFileSync,
  runtimeProcess = process,
} = {}) {
  if (mountPath !== TLS_MOUNT_PATH || typeof readFile !== 'function') {
    throw invalidConfiguration();
  }
  const key = readFile(`${TLS_MOUNT_PATH}/server-key.pem`);
  const cert = readFile(`${TLS_MOUNT_PATH}/server.pem`);
  dropToGatewayRuntimeUser(runtimeProcess);
  return { key, cert };
}

function serveFromContainer() {
  if (
    process.env.ELEMENT_ACCEPTANCE_PRIVATE_TLS_MOUNT !== TLS_MOUNT_PATH ||
    process.env.ELEMENT_ACCEPTANCE_PRIVATE_TLS_MOUNT === undefined
  ) {
    throw invalidConfiguration();
  }
  const { key, cert } = readTlsMaterialAndDropPrivileges({
    mountPath: process.env.ELEMENT_ACCEPTANCE_PRIVATE_TLS_MOUNT,
  });
  const proxy = createPrivateAcceptanceHttpsProxy({
    key,
    cert,
    upstreamHost: UPSTREAM_HOST,
    upstreamPort: UPSTREAM_PORT,
  });
  proxy.once('error', () => {
    process.stderr.write('Private acceptance HTTPS proxy listener failed.\n');
    process.exitCode = 1;
  });
  proxy.listen(LISTEN_PORT, LISTEN_HOST);
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  if (process.argv[2] !== 'serve') throw invalidConfiguration();
  try {
    serveFromContainer();
  } catch {
    process.stderr.write('Private acceptance HTTPS proxy could not start.\n');
    process.exitCode = 1;
  }
}
