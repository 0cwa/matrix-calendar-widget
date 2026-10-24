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
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import {
  preparePrivateUiAcceptance,
  readPrivateUiComposeEnvironment,
} from './element-acceptance-private-ui-prepare.mjs';

const temporaryDirectories = [];

function makeTemporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'mcw-private-ui-prepare-'));
  chmodSync(directory, 0o700);
  temporaryDirectories.push(directory);
  return directory;
}

after(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('opt-in TLS material and Compose secrets stay private and distinct', () => {
  const runnerTemp = makeTemporaryDirectory();
  const githubEnvFile = join(runnerTemp, 'github-env');
  writeFileSync(githubEnvFile, '', { mode: 0o600 });

  const prepared = preparePrivateUiAcceptance({ runnerTemp, githubEnvFile });
  const privateEnvironment = readPrivateUiComposeEnvironment({
    filePath: prepared.composeEnvironmentPath,
    runnerTemp,
  });
  const githubEnvironment = readFileSync(githubEnvFile, 'utf8');
  const keyInfo = lstatSync(prepared.serverKeyPath);
  const envInfo = lstatSync(prepared.composeEnvironmentPath);
  const rootInfo = lstatSync(prepared.directory);
  const secretsAreCanonicalAndDistinct =
    /^[A-Za-z0-9_-]{43}$/u.test(
      privateEnvironment.MATRIX_CALENDAR_PRIVATE_CLIENT_EPOCH_KEY,
    ) &&
    /^[A-Za-z0-9_-]{43}$/u.test(
      privateEnvironment.MATRIX_CALENDAR_PRIVATE_CLIENT_CALLBACK_KEY,
    ) &&
    privateEnvironment.MATRIX_CALENDAR_PRIVATE_CLIENT_EPOCH_KEY !==
      privateEnvironment.MATRIX_CALENDAR_PRIVATE_CLIENT_CALLBACK_KEY &&
    privateEnvironment.MATRIX_CALENDAR_PRIVATE_CLIENT_CALLBACK_KEY ===
      privateEnvironment.RADICALE_PRIVATE_CLIENT_CALLBACK_KEY;
  const workflowEnvironmentContainsPathsAndPinOnly =
    githubEnvironment.includes('ELEMENT_ACCEPTANCE_PRIVATE_UI=true\n') &&
    githubEnvironment.includes(prepared.composeEnvironmentPath) &&
    githubEnvironment.includes(prepared.tlsDirectory) &&
    githubEnvironment.includes('ELEMENT_ACCEPTANCE_PRIVATE_TLS_SPKI_PIN=') &&
    !githubEnvironment.includes(
      privateEnvironment.MATRIX_CALENDAR_PRIVATE_CLIENT_EPOCH_KEY,
    ) &&
    !githubEnvironment.includes(
      privateEnvironment.MATRIX_CALENDAR_PRIVATE_CLIENT_CALLBACK_KEY,
    );

  assert.equal(
    (rootInfo.mode & 0o777) === 0o700 &&
      (envInfo.mode & 0o777) === 0o600 &&
      (keyInfo.mode & 0o777) === 0o600 &&
      prepared.spkiPinPresent &&
      secretsAreCanonicalAndDistinct &&
      workflowEnvironmentContainsPathsAndPinOnly &&
      privateEnvironment.MATRIX_CALENDAR_PRIVATE_CLIENTS_ENABLED === 'true' &&
      privateEnvironment.MATRIX_CALENDAR_PRIVATE_CLIENT_DATABASE_TLS_MODE ===
        'trusted-private-network',
    true,
  );
});

test('Compose private settings require a private runner-owned environment file', () => {
  const runnerTemp = makeTemporaryDirectory();
  const githubEnvFile = join(runnerTemp, 'github-env');
  writeFileSync(githubEnvFile, '', { mode: 0o600 });
  const prepared = preparePrivateUiAcceptance({ runnerTemp, githubEnvFile });

  chmodSync(prepared.composeEnvironmentPath, 0o644);
  assert.throws(
    () =>
      readPrivateUiComposeEnvironment({
        filePath: prepared.composeEnvironmentPath,
        runnerTemp,
      }),
    TypeError,
  );
});
