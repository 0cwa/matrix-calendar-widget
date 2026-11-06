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
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  createSyntheticCaptureDirectory,
  createSyntheticColdCapture,
  removeSyntheticCaptureDirectory,
  verifySyntheticColdCapture,
  withSyntheticCaptureDirectory,
} from './element-acceptance-cold-capture.mjs';

test('synthetic capture directories are unique across repeated restore stages', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'matrix-calendar-capture-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const first = await createSyntheticCaptureDirectory(root);
  const second = await createSyntheticCaptureDirectory(root);
  assert.notEqual(first, second);
  assert.equal((await stat(first)).mode & 0o777, 0o700);
  assert.equal((await stat(second)).mode & 0o777, 0o700);
});

test('synthetic capture cleanup removes only its private directory on success and failure', async (t) => {
  const root = await mkdtemp(
    join(tmpdir(), 'matrix-calendar-capture-cleanup-'),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const unrelated = join(root, 'keep.txt');
  await writeFile(unrelated, 'preserve');

  let successfulDirectory;
  await withSyntheticCaptureDirectory(root, async (directory) => {
    successfulDirectory = directory;
    await writeFile(join(directory, 'server-data.tar'), 'sensitive fixture');
  });
  await assert.rejects(stat(successfulDirectory), { code: 'ENOENT' });

  let failedDirectory;
  await assert.rejects(
    withSyntheticCaptureDirectory(root, async (directory) => {
      failedDirectory = directory;
      await writeFile(join(directory, 'reminder-postgresql.dump'), 'fixture');
      throw new Error('restore failed');
    }),
    /restore failed/u,
  );
  await assert.rejects(stat(failedDirectory), { code: 'ENOENT' });
  assert.equal(await readFile(unrelated, 'utf8'), 'preserve');

  await assert.rejects(
    removeSyntheticCaptureDirectory(root, root),
    /synthetic capture verification failed/u,
  );
});

test('capture cleanup failure preserves a restore error and surfaces after success', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'matrix-calendar-capture-error-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const restoreError = new Error('restore failed');
  const warnings = [];
  const captureWarning = (warning) => {
    if (warning.code === 'MCW_SYNTHETIC_CAPTURE_CLEANUP') {
      warnings.push(warning);
    }
  };
  process.on('warning', captureWarning);

  try {
    await assert.rejects(
      withSyntheticCaptureDirectory(root, async (directory) => {
        await chmod(directory, 0o755);
        throw restoreError;
      }),
      (error) => error === restoreError,
    );
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    process.off('warning', captureWarning);
  }

  assert.equal(warnings.length, 1);
  assert.equal(
    warnings[0].message,
    'Synthetic restore capture cleanup failed after an earlier error.',
  );
  assert.equal(warnings[0].message.includes(root), false);

  await assert.rejects(
    withSyntheticCaptureDirectory(root, async (directory) => {
      await chmod(directory, 0o755);
    }),
    /synthetic capture verification failed/u,
  );
});

async function makeCapture(t) {
  const root = await mkdtemp(join(tmpdir(), 'matrix-calendar-capture-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const capture = join(root, 'capture');
  await mkdir(capture, { mode: 0o700 });
  for (const archive of ['radicale-data.tar', 'server-data.tar']) {
    await writeFile(join(capture, archive), Buffer.from(`archive:${archive}`), {
      mode: 0o600,
    });
  }
  await writeFile(join(capture, 'reminder-postgresql.dump'), 'fixture dump', {
    mode: 0o600,
  });
  await createSyntheticColdCapture(capture, {
    postgresDump: {
      enabled: true,
      format: 'custom',
      transport: 'container-exec',
      pgDumpVersion: 'pg_dump (PostgreSQL) 16.15',
      pgRestoreVersion: 'pg_restore (PostgreSQL) 16.15',
    },
    restoreInputs: [
      {
        name: 'synthetic-signing-key',
        sourcePath: '/synthetic-fixture/signing-key',
        contents: Buffer.from('fixture-only-key'),
      },
    ],
  });
  return capture;
}

test('synthetic capture matches the cold coordinator inventory and verifies', async (t) => {
  const capture = await makeCapture(t);
  const manifest = await verifySyntheticColdCapture(capture);
  assert.equal(manifest.schemaVersion, 1);
  assert.deepEqual(manifest.postgresDump, {
    enabled: true,
    format: 'custom',
    transport: 'container-exec',
    pgDumpVersion: 'pg_dump (PostgreSQL) 16.15',
    pgRestoreVersion: 'pg_restore (PostgreSQL) 16.15',
  });
  assert.equal(manifest.restoreInputs[0].archiveName, 'restore-input-0000.bin');
  const checksums = await readFile(join(capture, 'SHA256SUMS'), 'utf8');
  assert.match(checksums, /radicale-data\.tar/u);
  assert.match(checksums, /server-data\.tar/u);
  assert.match(checksums, /reminder-postgresql\.dump/u);
  assert.match(checksums, /restore-input-0000\.bin/u);
});

test('synthetic capture verification rejects changed or unexpected files', async (t) => {
  const capture = await makeCapture(t);
  await writeFile(join(capture, 'server-data.tar'), 'tampered');
  await assert.rejects(verifySyntheticColdCapture(capture));
  await rm(join(capture, 'server-data.tar'));
  await writeFile(join(capture, 'server-data.tar'), 'archive:server-data.tar');
  await writeFile(join(capture, 'unexpected'), 'extra');
  await assert.rejects(verifySyntheticColdCapture(capture));
});

test('synthetic capture refuses preexisting output names and unsafe inputs', async (t) => {
  const capture = await makeCapture(t);
  await assert.rejects(
    createSyntheticColdCapture(capture, { postgresDump: { enabled: true } }),
  );
  const root = await mkdtemp(join(tmpdir(), 'matrix-calendar-capture-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const empty = join(root, 'capture');
  await mkdir(empty, { mode: 0o700 });
  await assert.rejects(
    createSyntheticColdCapture(empty, {
      postgresDump: {
        enabled: true,
        format: 'custom',
        transport: 'container-exec',
        pgDumpVersion: 'pg_dump (PostgreSQL) 16.15',
        pgRestoreVersion: 'pg_restore (PostgreSQL) 16.15',
      },
      restoreInputs: [
        {
          name: '../escape',
          sourcePath: '/synthetic-fixture/key',
          contents: Buffer.from('bad'),
        },
      ],
    }),
  );
});
