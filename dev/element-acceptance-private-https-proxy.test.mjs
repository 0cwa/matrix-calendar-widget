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

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer as createHttpServer } from 'node:http';
import https from 'node:https';
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import {
  createPrivateAcceptanceTlsFixture,
  validatePrivateAcceptanceTlsFixture,
} from './element-acceptance-private-tls.mjs';
import {
  createPrivateAcceptanceHttpsProxy,
  dropToGatewayRuntimeUser,
  readTlsMaterialAndDropPrivileges,
} from './element-acceptance-private-https-proxy.mjs';

let fixtureDirectory;
let certificateFixture;
let backend;
let proxy;
let backendPort;
let proxyPort;
let forwardedDavRequest = false;
let forwardedCallbackRequest = false;

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server.address().port);
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    if (!server?.listening) return resolve();
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function requestOverTls({
  hostHeader,
  path,
  method,
  body = Buffer.alloc(0),
  headers = {},
  ca = readFileSync(certificateFixture.caCertPath),
  servername,
}) {
  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        hostname: '127.0.0.1',
        port: proxyPort,
        method,
        path,
        servername,
        ca,
        headers: {
          host: hostHeader,
          'content-length': String(body.byteLength),
          ...headers,
        },
        agent: false,
        timeout: 5_000,
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        response.once('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    request.once('error', reject);
    request.end(body);
  });
}

before(async () => {
  fixtureDirectory = mkdtempSync(join(tmpdir(), 'mcw-private-ui-tls-'));
  chmodSync(fixtureDirectory, 0o700);
  certificateFixture = createPrivateAcceptanceTlsFixture({
    directory: join(fixtureDirectory, 'certificates'),
  });

  const expectedDavBodyHash = createHash('sha256')
    .update('synthetic DAV request body')
    .digest('hex');
  const expectedCallbackBodyHash = createHash('sha256')
    .update('synthetic callback request body')
    .digest('hex');
  const syntheticAppId = `mcwpc~${'a'.repeat(48)}`;
  const davPath = `/${syntheticAppId}/calendar/probe.ics`;
  const callbackPath = '/v1/private-calendar-client-callback/rights';

  backend = createHttpServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    request.once('end', () => {
      const bodyHash = createHash('sha256')
        .update(Buffer.concat(chunks))
        .digest('hex');
      if (request.method === 'PROPFIND') {
        forwardedDavRequest =
          request.url === davPath &&
          request.headers.host === '127.0.0.1:3001' &&
          request.headers.authorization === 'Basic synthetic-only' &&
          bodyHash === expectedDavBodyHash;
      }
      if (request.method === 'POST') {
        forwardedCallbackRequest =
          request.url === callbackPath &&
          request.headers.host === 'private-gateway-https:3443' &&
          request.headers['x-mcw-callback-signature'] === 'synthetic-only' &&
          bodyHash === expectedCallbackBodyHash;
      }
      response.writeHead(request.method === 'PROPFIND' ? 207 : 200, {
        'content-type': 'application/octet-stream',
        etag: '"synthetic-etag"',
      });
      response.end('synthetic response');
    });
  });
  backendPort = await listen(backend);

  proxy = createPrivateAcceptanceHttpsProxy({
    key: readFileSync(certificateFixture.serverKeyPath),
    cert: readFileSync(certificateFixture.serverCertPath),
    upstreamHost: '127.0.0.1',
    upstreamPort: backendPort,
    listenHost: '127.0.0.1',
    listenPort: 0,
  });
  proxyPort = await listen(proxy);
});

after(async () => {
  await close(proxy);
  await close(backend);
  if (fixtureDirectory)
    rmSync(fixtureDirectory, { recursive: true, force: true });
});

test('the ephemeral certificate binds both acceptance origins and stays private', () => {
  const checked = validatePrivateAcceptanceTlsFixture({
    directory: certificateFixture.directory,
  });
  const serverKey = lstatSync(checked.serverKeyPath);
  const caFile = lstatSync(checked.caCertPath);
  const serverCertificate = lstatSync(checked.serverCertPath);
  assert.equal((serverKey.mode & 0o777) === 0o600, true);
  assert.equal((caFile.mode & 0o777) === 0o644, true);
  assert.equal((serverCertificate.mode & 0o777) === 0o644, true);
  assert.equal((lstatSync(checked.directory).mode & 0o777) === 0o700, true);
  assert.equal(
    checked.serverSpkiPin === certificateFixture.serverSpkiPin,
    true,
  );
});

test('trusted TLS forwards a raw DAV request and its authorization header unchanged', async () => {
  const body = Buffer.from('synthetic DAV request body');
  const syntheticAppId = `mcwpc~${'a'.repeat(48)}`;
  const result = await requestOverTls({
    hostHeader: '127.0.0.1:3001',
    method: 'PROPFIND',
    path: `/${syntheticAppId}/calendar/probe.ics`,
    body,
    headers: { authorization: 'Basic synthetic-only' },
  });
  assert.equal(result.status === 207, true);
  assert.equal(forwardedDavRequest, true);
  assert.equal(result.body.byteLength > 0, true);
});

test('trusted TLS forwards the fixed Radicale callback request unchanged', async () => {
  const result = await requestOverTls({
    hostHeader: 'private-gateway-https:3443',
    method: 'POST',
    path: '/v1/private-calendar-client-callback/rights',
    body: Buffer.from('synthetic callback request body'),
    headers: { 'x-mcw-callback-signature': 'synthetic-only' },
    servername: 'private-gateway-https',
  });
  assert.equal(result.status === 200, true);
  assert.equal(forwardedCallbackRequest, true);
});

test('TLS rejects an untrusted chain and a certificate name outside its SANs', async () => {
  await assert.rejects(
    requestOverTls({
      hostHeader: '127.0.0.1:3001',
      method: 'GET',
      path: '/',
      ca: Buffer.alloc(0),
    }),
  );
  await assert.rejects(
    requestOverTls({
      hostHeader: '127.0.0.1:3001',
      method: 'GET',
      path: '/',
      servername: 'unexpected.invalid',
    }),
  );
});

test('the TLS proxy rejects unexpected host names and methods before forwarding', async () => {
  const wrongHost = await requestOverTls({
    hostHeader: 'unexpected.invalid:3001',
    method: 'GET',
    path: '/',
    servername: 'private-gateway-https',
  });
  const wrongMethod = await requestOverTls({
    hostHeader: '127.0.0.1:3001',
    method: 'MOVE',
    path: '/',
  });
  assert.equal(wrongHost.status === 421, true);
  assert.equal(wrongMethod.status === 405, true);
});

test('the proxy privilege drop matches the built gateway image and clears groups', () => {
  const dockerfile = readFileSync(
    new URL('../matrix-calendar-server/Dockerfile', import.meta.url),
    'utf8',
  );
  const acceptanceCompose = readFileSync(
    new URL('./element-acceptance.compose.yaml', import.meta.url),
    'utf8',
  );
  const calls = [];
  const runtimeProcess = {
    getuid: () => 0,
    setgroups: (groups) =>
      calls.push(
        groups.length === 0 ? 'supplemental-groups-cleared' : 'groups-kept',
      ),
    setgid: (gid) => calls.push(`gid:${gid}`),
    setuid: (uid) => calls.push(`uid:${uid}`),
  };
  dropToGatewayRuntimeUser(runtimeProcess);

  const imageUsesRuntimeUid = /^USER 101\s*$/mu.test(dockerfile);
  const imageUsesRuntimeGroup = /chown -R 101:0 \/app\/storage/u.test(
    dockerfile,
  );
  const acceptanceBuildsThatImage = acceptanceCompose.includes(
    [
      '  gateway:',
      '    image: matrix-calendar-widget/server:element-acceptance',
      '    build:',
      '      context: ..',
      '      dockerfile: matrix-calendar-server/Dockerfile',
    ].join('\n'),
  );
  const runtimeDropMatchesImage =
    calls.join('|') === 'supplemental-groups-cleared|gid:0|uid:101';
  assert.equal(
    imageUsesRuntimeUid &&
      imageUsesRuntimeGroup &&
      acceptanceBuildsThatImage &&
      runtimeDropMatchesImage,
    true,
  );
});

test('the TLS key and certificate are loaded before group and user changes', () => {
  const lifecycle = [];
  const runtimeProcess = {
    getuid: () => 0,
    setgroups: (groups) =>
      lifecycle.push(groups.length === 0 ? 'groups-cleared' : 'groups-kept'),
    setgid: (gid) => lifecycle.push(`gid:${gid}`),
    setuid: (uid) => lifecycle.push(`uid:${uid}`),
  };
  const tls = readTlsMaterialAndDropPrivileges({
    mountPath: '/run/mcw-private-ui-tls',
    readFile: (path) => {
      const isKey = path.endsWith('server-key.pem');
      lifecycle.push(isKey ? 'key-read' : 'cert-read');
      return Buffer.from(
        isKey ? 'synthetic private key' : 'synthetic certificate',
      );
    },
    runtimeProcess,
  });

  assert.equal(
    tls.key.toString() === 'synthetic private key' &&
      tls.cert.toString() === 'synthetic certificate' &&
      lifecycle.join('|') === 'key-read|cert-read|groups-cleared|gid:0|uid:101',
    true,
  );
  assert.throws(
    () =>
      readTlsMaterialAndDropPrivileges({
        mountPath: '/tmp/unexpected-private-tls',
        readFile: () => Buffer.alloc(0),
        runtimeProcess,
      }),
    TypeError,
  );
});
