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
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  stageVerifiedRegularFile,
  verifyCapture,
} from './matrix-calendar-verify-restore.mjs';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function withTimeout(promise, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), 1000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

test('offline verifier checks checksums and manifest, stages exact inputs, and rejects unsafe archive members', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'matrix-calendar-verify-test-'));
  t.after(async () => await rm(root, { recursive: true, force: true }));
  const capture = join(root, 'capture');
  const data = join(root, 'data');
  await Promise.all([mkdir(capture, { mode: 0o700 }), mkdir(data)]);
  await writeFile(
    join(data, 'synthetic-calendar.ics'),
    'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n',
  );
  for (const archive of ['radicale-data.tar', 'server-data.tar']) {
    execFileSync('tar', ['-cpf', join(capture, archive), '-C', data, '.']);
  }
  const key = Buffer.from('synthetic-signing-key');
  const inputName = 'restore-input-0000.bin';
  const manifest = {
    schemaVersion: 1,
    postgresDump: { enabled: false },
    restoreInputs: [
      {
        name: 'public-feed-signing-key',
        sourcePath: '/synthetic/public-feed.key',
        archiveName: inputName,
        mode: 0o600,
        sourceUid: 1000,
        sourceGid: 1000,
        size: key.length,
        sha256: sha256(key),
      },
    ],
  };
  await writeFile(join(capture, inputName), key);
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(capture, 'capture-manifest.json'), manifestBytes);
  const entries = [
    ...[
      'radicale-data.tar',
      'server-data.tar',
      inputName,
      'capture-manifest.json',
    ],
  ];
  const checksumContents = await Promise.all(
    entries.map(async (name) => {
      const bytes = await readFile(join(capture, name));
      return `${sha256(bytes)}  ${name}`;
    }),
  );
  await writeFile(
    join(capture, 'SHA256SUMS'),
    `${checksumContents.join('\n')}\n`,
  );
  await writeFile(
    join(capture, '.capture-complete'),
    'Cold capture verified and services resumed.\n',
  );

  assert.deepEqual(await verifyCapture(capture), {
    archives: 2,
    database: false,
    inputs: 1,
  });

  await writeFile(
    join(capture, inputName),
    Buffer.from('tampered-signing-key'),
  );
  await assert.rejects(verifyCapture(capture), /backup verification failed/u);
  await writeFile(join(capture, inputName), key);

  const unsafeData = join(root, 'unsafe-data');
  await mkdir(unsafeData);
  await symlink('/outside-target', join(unsafeData, 'escape'));
  execFileSync('tar', [
    '-cpf',
    join(capture, 'radicale-data.tar'),
    '-C',
    unsafeData,
    '.',
  ]);
  const archiveBytes = await readFile(join(capture, 'radicale-data.tar'));
  const sums = await readFile(join(capture, 'SHA256SUMS'), 'utf8');
  const updated = sums.replace(
    /^[a-f0-9]{64}(?=  radicale-data\.tar$)/mu,
    sha256(archiveBytes),
  );
  await writeFile(join(capture, 'SHA256SUMS'), updated);
  await assert.rejects(verifyCapture(capture), /backup verification failed/u);
});

test('staging never follows a capture path replaced by a symlink or FIFO', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'matrix-calendar-race-test-'));
  t.after(async () => await rm(root, { recursive: true, force: true }));
  const sourcePath = join(root, 'capture-file');
  const original = Buffer.from('trusted archive bytes');
  const secretPath = join(root, 'outside-secret');
  const stagedPath = join(root, 'staged-copy');
  await writeFile(sourcePath, original);
  await writeFile(secretPath, 'outside secret');

  const staging = stageVerifiedRegularFile(
    sourcePath,
    stagedPath,
    sha256(original),
    1024,
  );
  const renamedPath = join(root, 'renamed-original');
  await rename(sourcePath, renamedPath);
  await symlink(secretPath, sourcePath);

  const result = await withTimeout(
    staging.then(
      (value) => ({ value }),
      (error) => ({ error }),
    ),
    'staging hung on a replaced path',
  );
  if (result.value) {
    assert.equal(result.value.size, original.length);
    assert.deepEqual(await readFile(stagedPath), original);
  } else {
    assert.match(result.error.message, /backup verification failed/u);
  }

  const fifoPath = join(root, 'capture-fifo');
  execFileSync('mkfifo', [fifoPath]);
  await assert.rejects(
    withTimeout(
      stageVerifiedRegularFile(
        fifoPath,
        join(root, 'fifo-copy'),
        sha256(original),
        1024,
      ),
      'staging blocked on FIFO',
    ),
    /backup verification failed/u,
  );
});

test('failed exclusive staging preserves a preexisting target', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'matrix-calendar-existing-stage-'));
  t.after(async () => await rm(root, { recursive: true, force: true }));
  const sourcePath = join(root, 'capture-file');
  const targetPath = join(root, 'staged-copy');
  const source = Buffer.from('trusted archive bytes');
  const existing = Buffer.from('preexisting target bytes');
  await writeFile(sourcePath, source);
  await writeFile(targetPath, existing);

  await assert.rejects(
    stageVerifiedRegularFile(sourcePath, targetPath, sha256(source), 1024),
    /backup verification failed/u,
  );
  assert.deepEqual(await readFile(targetPath), existing);
});
