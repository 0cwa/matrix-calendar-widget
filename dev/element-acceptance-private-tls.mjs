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

import { execFileSync } from 'node:child_process';
import { createHash, X509Certificate } from 'node:crypto';
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, join, resolve, sep } from 'node:path';

export const PRIVATE_ACCEPTANCE_TLS = Object.freeze({
  browserOrigin: 'https://127.0.0.1:3001',
  callbackOrigin: 'https://private-gateway-https:3443',
  mountPath: '/run/mcw-private-ui-tls',
  proxyContainerPort: 3443,
  proxyHostPort: 3001,
  spkiPinFlag: '--ignore-certificate-errors-spki-list=',
});

const CERTIFICATE_FILES = Object.freeze([
  'ca-key.pem',
  'ca.pem',
  'server-key.pem',
  'server.csr',
  'server.pem',
  'server.ext',
  'ca.srl',
]);

function invalidFixture() {
  return new TypeError('Private acceptance TLS fixture path is invalid');
}

function privateDirectory(directory) {
  if (typeof directory !== 'string' || !isAbsolute(directory)) {
    throw invalidFixture();
  }

  const absoluteDirectory = resolve(directory);
  try {
    mkdirSync(absoluteDirectory, { mode: 0o700 });
  } catch {
    throw invalidFixture();
  }
  const info = lstatSync(absoluteDirectory);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    (info.mode & 0o077) !== 0 ||
    (typeof process.getuid === 'function' && info.uid !== process.getuid())
  ) {
    throw invalidFixture();
  }
  return absoluteDirectory;
}

/**
 * Create a disposable certificate chain for the isolated Element acceptance
 * profile and Radicale callback. The private key is mode 0600; public
 * certificates are mode 0644 so Radicale can read its mounted CA file without
 * assuming a numeric runtime UID.
 */
export function createPrivateAcceptanceTlsFixture({
  directory,
  execute = execFileSync,
} = {}) {
  const root = privateDirectory(directory);
  const files = Object.freeze({
    caKey: join(root, 'ca-key.pem'),
    caCert: join(root, 'ca.pem'),
    serverKey: join(root, 'server-key.pem'),
    serverCsr: join(root, 'server.csr'),
    serverCert: join(root, 'server.pem'),
    extensions: join(root, 'server.ext'),
  });

  const runOpenSsl = (arguments_) => {
    try {
      execute('openssl', arguments_, {
        stdio: 'ignore',
        timeout: 30_000,
        windowsHide: true,
      });
    } catch {
      throw new Error('Unable to create private acceptance TLS fixture');
    }
  };

  try {
    writeFileSync(
      files.extensions,
      [
        'basicConstraints=critical,CA:FALSE',
        'keyUsage=critical,digitalSignature,keyEncipherment',
        'extendedKeyUsage=serverAuth',
        'subjectAltName=IP:127.0.0.1,DNS:private-gateway-https',
        '',
      ].join('\n'),
      { encoding: 'utf8', flag: 'wx', mode: 0o600 },
    );

    runOpenSsl([
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      files.caKey,
      '-out',
      files.caCert,
      '-days',
      '1',
      '-subj',
      '/CN=Matrix Calendar Widget private acceptance CA',
      '-addext',
      'basicConstraints=critical,CA:TRUE',
      '-addext',
      'keyUsage=critical,keyCertSign,cRLSign',
    ]);
    runOpenSsl([
      'req',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      files.serverKey,
      '-out',
      files.serverCsr,
      '-subj',
      '/CN=private-gateway-https',
    ]);
    runOpenSsl([
      'x509',
      '-req',
      '-in',
      files.serverCsr,
      '-CA',
      files.caCert,
      '-CAkey',
      files.caKey,
      '-CAcreateserial',
      '-out',
      files.serverCert,
      '-days',
      '1',
      '-sha256',
      '-extfile',
      files.extensions,
    ]);

    for (const path of Object.values(files)) chmodSync(path, 0o600);

    const certificate = new X509Certificate(readFileSync(files.serverCert));
    const subjectPublicKeyInfo = certificate.publicKey.export({
      format: 'der',
      type: 'spki',
    });
    const serverSpkiPin = createHash('sha256')
      .update(subjectPublicKeyInfo)
      .digest('base64');
    const isHostBound =
      certificate.checkIP('127.0.0.1') === '127.0.0.1' &&
      certificate.checkHost('private-gateway-https') ===
        'private-gateway-https';

    for (const name of CERTIFICATE_FILES) {
      if (
        name === 'ca.pem' ||
        name === 'server-key.pem' ||
        name === 'server.pem'
      ) {
        continue;
      }
      rmSync(join(root, name), { force: true });
    }
    chmodSync(files.caCert, 0o644);
    chmodSync(files.serverCert, 0o644);
    if (!isHostBound || !/^[A-Za-z0-9+/]{43}=$/u.test(serverSpkiPin)) {
      throw new Error('Private acceptance TLS fixture failed its host checks');
    }

    return Object.freeze({
      directory: root,
      caCertPath: files.caCert,
      serverCertPath: files.serverCert,
      serverKeyPath: files.serverKey,
      serverSpkiPin,
    });
  } catch {
    rmSync(root, { recursive: true, force: true });
    throw new Error('Unable to create private acceptance TLS fixture');
  }
}

/** Validate a TLS directory before mounting it into the isolated containers. */
export function validatePrivateAcceptanceTlsFixture({ directory } = {}) {
  if (typeof directory !== 'string' || !isAbsolute(directory)) {
    throw invalidFixture();
  }
  const root = resolve(directory);
  const info = lstatSync(root);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    (info.mode & 0o077) !== 0 ||
    (typeof process.getuid === 'function' && info.uid !== process.getuid())
  ) {
    throw invalidFixture();
  }

  const caCertPath = join(root, 'ca.pem');
  const serverCertPath = join(root, 'server.pem');
  const serverKeyPath = join(root, 'server-key.pem');
  [caCertPath, serverCertPath, serverKeyPath].forEach((path) => {
    const file = lstatSync(path);
    if (
      !file.isFile() ||
      file.isSymbolicLink() ||
      (file.mode & 0o777) !== (path === serverKeyPath ? 0o600 : 0o644) ||
      (typeof process.getuid === 'function' && file.uid !== process.getuid())
    ) {
      throw invalidFixture();
    }
  });
  const certificate = new X509Certificate(readFileSync(serverCertPath));
  const subjectPublicKeyInfo = certificate.publicKey.export({
    format: 'der',
    type: 'spki',
  });
  const serverSpkiPin = createHash('sha256')
    .update(subjectPublicKeyInfo)
    .digest('base64');
  const isHostBound =
    certificate.checkIP('127.0.0.1') === '127.0.0.1' &&
    certificate.checkHost('private-gateway-https') === 'private-gateway-https';

  if (!isHostBound || !/^[A-Za-z0-9+/]{43}=$/u.test(serverSpkiPin)) {
    throw invalidFixture();
  }

  return Object.freeze({
    directory: root,
    caCertPath,
    serverCertPath,
    serverKeyPath,
    serverSpkiPin,
  });
}

export function isInsidePrivateAcceptanceDirectory(directory, candidate) {
  if (
    typeof directory !== 'string' ||
    typeof candidate !== 'string' ||
    !isAbsolute(directory) ||
    !isAbsolute(candidate)
  ) {
    return false;
  }
  return resolve(candidate).startsWith(`${resolve(directory)}${sep}`);
}
