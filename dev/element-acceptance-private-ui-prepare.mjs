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

import { randomBytes } from 'node:crypto';
import {
  appendFileSync,
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createPrivateAcceptanceTlsFixture,
  PRIVATE_ACCEPTANCE_TLS,
  validatePrivateAcceptanceTlsFixture,
} from './element-acceptance-private-tls.mjs';

const PRIVATE_ENVIRONMENT_KEYS = Object.freeze([
  'ELEMENT_ACCEPTANCE_PRIVATE_TLS_DIR',
  'MATRIX_CALENDAR_PRIVATE_CLIENTS_ENABLED',
  'MATRIX_CALENDAR_PRIVATE_CLIENT_ORIGIN',
  'MATRIX_CALENDAR_PRIVATE_CLIENT_EPOCH_KEY',
  'MATRIX_CALENDAR_PRIVATE_CLIENT_CALLBACK_KEY',
  'MATRIX_CALENDAR_PRIVATE_CLIENT_DATABASE_TLS_MODE',
  'RADICALE_PRIVATE_CLIENT_CALLBACK_ORIGIN',
  'RADICALE_PRIVATE_CLIENT_CALLBACK_KEY',
]);

function invalidPreparation() {
  return new TypeError('Private Element acceptance preparation is invalid');
}

function validateRunnerTempPath(path, runnerTemp) {
  if (
    typeof path !== 'string' ||
    !isAbsolute(path) ||
    typeof runnerTemp !== 'string' ||
    !isAbsolute(runnerTemp) ||
    !resolve(path).startsWith(`${resolve(runnerTemp)}${sep}`)
  ) {
    throw invalidPreparation();
  }
  return resolve(path);
}

function privateOwnedFile(path, expectedMode) {
  const info = lstatSync(path);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    (info.mode & 0o777) !== expectedMode ||
    (typeof process.getuid === 'function' && info.uid !== process.getuid())
  ) {
    throw invalidPreparation();
  }
  return info;
}

function hasControlCharacters(value) {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x1f || codePoint === 0x7f) return true;
  }
  return false;
}

function encodeComposeEnvironment(values) {
  return `${Object.entries(values)
    .map(([name, value]) => {
      if (
        !/^[A-Z][A-Z0-9_]*$/u.test(name) ||
        typeof value !== 'string' ||
        value.length === 0 ||
        hasControlCharacters(value) ||
        value.includes("'")
      ) {
        throw invalidPreparation();
      }
      return `${name}='${value}'`;
    })
    .join('\n')}\n`;
}

function parseComposeEnvironment(text) {
  const values = Object.create(null);
  for (const line of text.split(/\r?\n/u)) {
    if (line.length === 0) continue;
    const match = /^([A-Z][A-Z0-9_]*)='([^'\r\n]+)'$/u.exec(line);
    if (!match || Object.hasOwn(values, match[1])) throw invalidPreparation();
    values[match[1]] = match[2];
  }
  if (
    Object.keys(values).sort().join(',') !==
    [...PRIVATE_ENVIRONMENT_KEYS].sort().join(',')
  ) {
    throw invalidPreparation();
  }
  return values;
}

export function readPrivateUiComposeEnvironment({ filePath, runnerTemp } = {}) {
  const path = validateRunnerTempPath(filePath, runnerTemp);
  privateOwnedFile(path, 0o600);
  return Object.freeze(parseComposeEnvironment(readFileSync(path, 'utf8')));
}

export function preparePrivateUiAcceptance({
  runnerTemp,
  githubEnvFile,
  randomBytesImpl = randomBytes,
  createTlsFixture = createPrivateAcceptanceTlsFixture,
} = {}) {
  if (
    typeof runnerTemp !== 'string' ||
    !isAbsolute(runnerTemp) ||
    typeof githubEnvFile !== 'string'
  ) {
    throw invalidPreparation();
  }
  const root = resolve(runnerTemp);
  const workspace = validateRunnerTempPath(
    join(root, 'element-acceptance-private-ui'),
    root,
  );
  const envPath = validateRunnerTempPath(githubEnvFile, root);
  privateOwnedFile(envPath, 0o600);

  mkdirSync(workspace, { mode: 0o700 });
  try {
    const tlsDirectory = join(workspace, 'tls');
    createTlsFixture({ directory: tlsDirectory });
    const checkedTls = validatePrivateAcceptanceTlsFixture({
      directory: tlsDirectory,
    });
    const callbackKey = randomBytesImpl(32).toString('base64url');
    const epochKey = randomBytesImpl(32).toString('base64url');
    if (
      !/^[A-Za-z0-9_-]{43}$/u.test(callbackKey) ||
      !/^[A-Za-z0-9_-]{43}$/u.test(epochKey) ||
      callbackKey === epochKey
    ) {
      throw invalidPreparation();
    }

    const composeEnvironmentPath = join(workspace, 'private-ui.env');
    writeFileSync(
      composeEnvironmentPath,
      encodeComposeEnvironment({
        ELEMENT_ACCEPTANCE_PRIVATE_TLS_DIR: tlsDirectory,
        MATRIX_CALENDAR_PRIVATE_CLIENTS_ENABLED: 'true',
        MATRIX_CALENDAR_PRIVATE_CLIENT_ORIGIN:
          PRIVATE_ACCEPTANCE_TLS.browserOrigin,
        MATRIX_CALENDAR_PRIVATE_CLIENT_EPOCH_KEY: epochKey,
        MATRIX_CALENDAR_PRIVATE_CLIENT_CALLBACK_KEY: callbackKey,
        MATRIX_CALENDAR_PRIVATE_CLIENT_DATABASE_TLS_MODE:
          'trusted-private-network',
        RADICALE_PRIVATE_CLIENT_CALLBACK_ORIGIN:
          PRIVATE_ACCEPTANCE_TLS.callbackOrigin,
        RADICALE_PRIVATE_CLIENT_CALLBACK_KEY: callbackKey,
      }),
      { encoding: 'utf8', flag: 'wx', mode: 0o600 },
    );
    privateOwnedFile(composeEnvironmentPath, 0o600);

    const environmentLines = [
      'ELEMENT_ACCEPTANCE_PRIVATE_UI=true',
      `ELEMENT_ACCEPTANCE_PRIVATE_UI_ENV_FILE=${composeEnvironmentPath}`,
      `ELEMENT_ACCEPTANCE_PRIVATE_TLS_DIR=${tlsDirectory}`,
      `ELEMENT_ACCEPTANCE_PRIVATE_TLS_SPKI_PIN=${checkedTls.serverSpkiPin}`,
    ].join('\n');
    appendFileSync(envPath, `${environmentLines}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    chmodSync(envPath, 0o600);

    return Object.freeze({
      directory: workspace,
      composeEnvironmentPath,
      tlsDirectory,
      caCertPath: checkedTls.caCertPath,
      serverKeyPath: checkedTls.serverKeyPath,
      spkiPinPresent: checkedTls.serverSpkiPin.length > 0,
    });
  } catch {
    rmSync(workspace, { recursive: true, force: true });
    throw invalidPreparation();
  }
}

function main() {
  if (process.env.ELEMENT_ACCEPTANCE_PRIVATE_UI !== 'true') {
    throw invalidPreparation();
  }
  preparePrivateUiAcceptance({
    runnerTemp: process.env.RUNNER_TEMP,
    githubEnvFile: process.env.GITHUB_ENV,
  });
  process.stdout.write('Private Element acceptance trust material prepared.\n');
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main();
  } catch {
    process.stderr.write('Private Element acceptance preparation failed.\n');
    process.exitCode = 1;
  }
}
