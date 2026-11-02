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

import { createHash, timingSafeEqual } from 'node:crypto';
import {
  lstat,
  mkdtemp,
  open,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import {
  COLD_CAPTURE_MARKER_CONTENT,
  serializeCaptureManifest,
} from '../scripts/matrix-calendar-cold-backup.mjs';

const ARCHIVES = ['radicale-data.tar', 'server-data.tar'];
const DUMP = 'reminder-postgresql.dump';
const MANIFEST = 'capture-manifest.json';
const CHECKSUMS = 'SHA256SUMS';
const MARKER = '.capture-complete';
const MAX_INPUT_BYTES = 4 * 1024 * 1024;
const MAX_INPUT_TOTAL_BYTES = 16 * 1024 * 1024;
const SAFE_INPUT_NAME = /^[a-z0-9][a-z0-9_-]{0,62}$/u;

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function fail() {
  throw new Error('synthetic capture verification failed');
}

function safeName(name) {
  return (
    typeof name === 'string' &&
    name !== '.' &&
    name !== '..' &&
    /^[A-Za-z0-9._-]+$/u.test(name)
  );
}

export async function createSyntheticCaptureDirectory(parentDirectory) {
  return await mkdtemp(
    join(resolve(parentDirectory), 'synthetic-cold-capture-'),
  );
}

export async function removeSyntheticCaptureDirectory(
  parentDirectory,
  captureDirectory,
) {
  const parent = resolve(parentDirectory);
  const directory = resolve(captureDirectory);
  if (
    dirname(directory) !== parent ||
    !basename(directory).startsWith('synthetic-cold-capture-')
  )
    fail();

  let directoryInfo;
  try {
    directoryInfo = await lstat(directory);
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    fail();
  }
  if (
    !directoryInfo.isDirectory() ||
    directoryInfo.isSymbolicLink() ||
    (directoryInfo.mode & 0o077) !== 0
  )
    fail();

  await rm(directory, { recursive: true });
}

export async function withSyntheticCaptureDirectory(parentDirectory, callback) {
  const directory = await createSyntheticCaptureDirectory(parentDirectory);
  let callbackFailed = false;
  try {
    return await callback(directory);
  } catch (error) {
    callbackFailed = true;
    throw error;
  } finally {
    try {
      await removeSyntheticCaptureDirectory(parentDirectory, directory);
    } catch (cleanupError) {
      if (!callbackFailed) throw cleanupError;
    }
  }
}

export async function createSyntheticColdCapture(
  captureDirectory,
  { postgresDump, restoreInputs = [] },
) {
  const directory = resolve(captureDirectory);
  const directoryInfo = await lstat(directory);
  if (
    !directoryInfo.isDirectory() ||
    directoryInfo.isSymbolicLink() ||
    (directoryInfo.mode & 0o077) !== 0
  )
    fail();
  if (
    !postgresDump ||
    postgresDump.enabled !== true ||
    postgresDump.format !== 'custom' ||
    !['native', 'container-exec'].includes(postgresDump.transport) ||
    typeof postgresDump.pgDumpVersion !== 'string' ||
    typeof postgresDump.pgRestoreVersion !== 'string' ||
    !Array.isArray(restoreInputs) ||
    restoreInputs.length > 32
  )
    fail();
  const inputNames = new Set();
  let total = 0;
  const inputs = [];
  for (let index = 0; index < restoreInputs.length; index += 1) {
    const input = restoreInputs[index];
    if (
      !input ||
      typeof input.name !== 'string' ||
      !SAFE_INPUT_NAME.test(input.name) ||
      inputNames.has(input.name) ||
      typeof input.sourcePath !== 'string' ||
      !input.sourcePath.startsWith('/synthetic-fixture/') ||
      resolve(input.sourcePath) !== input.sourcePath ||
      !(
        Buffer.isBuffer(input.contents) || input.contents instanceof Uint8Array
      ) ||
      input.contents.length < 1 ||
      input.contents.length > MAX_INPUT_BYTES ||
      total + input.contents.length > MAX_INPUT_TOTAL_BYTES
    )
      fail();
    inputNames.add(input.name);
    total += input.contents.length;
    const archiveName = `restore-input-${String(index).padStart(4, '0')}.bin`;
    const contents = Buffer.from(input.contents);
    const destination = join(directory, archiveName);
    await writeFile(destination, contents, { flag: 'wx', mode: 0o600 });
    const info = await lstat(destination);
    if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0)
      fail();
    inputs.push({
      name: input.name,
      sourcePath: input.sourcePath,
      archiveName,
      mode: 0o600,
      sourceUid: process.getuid?.() ?? 0,
      sourceGid: process.getgid?.() ?? 0,
      size: contents.length,
      sha256: sha256(contents),
    });
  }
  const manifestBytes = Buffer.from(
    serializeCaptureManifest(postgresDump, inputs),
  );
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const files = new Map([
    ['capture-manifest.json', manifestBytes],
    ['.capture-complete', Buffer.from(COLD_CAPTURE_MARKER_CONTENT)],
  ]);
  for (const name of ARCHIVES) {
    const path = join(directory, name);
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size === 0) fail();
    files.set(name, await readFile(path));
  }
  const dumpPath = join(directory, DUMP);
  const dumpInfo = await lstat(dumpPath);
  if (!dumpInfo.isFile() || dumpInfo.isSymbolicLink() || dumpInfo.size === 0)
    fail();
  files.set(DUMP, await readFile(dumpPath));
  for (const input of inputs)
    files.set(
      input.archiveName,
      await readFile(join(directory, input.archiveName)),
    );
  const checksumNames = [
    ...ARCHIVES,
    DUMP,
    ...inputs.map((input) => input.archiveName),
    MANIFEST,
  ];
  const checksums =
    checksumNames
      .map((name) => `${sha256(files.get(name))}  ${name}`)
      .join('\n') + '\n';
  await writeFile(join(directory, MANIFEST), manifestBytes, {
    flag: 'wx',
    mode: 0o600,
  });
  await writeFile(join(directory, MARKER), COLD_CAPTURE_MARKER_CONTENT, {
    flag: 'wx',
    mode: 0o600,
  });
  await writeFile(join(directory, CHECKSUMS), checksums, {
    flag: 'wx',
    mode: 0o600,
  });
  return manifest;
}

export async function verifySyntheticColdCapture(captureDirectory) {
  const directory = resolve(captureDirectory);
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0)
    fail();
  const entries = await readdir(directory);
  const manifestBytes = await readFile(join(directory, MANIFEST));
  const marker = await readFile(join(directory, MARKER), 'utf8');
  if (marker !== COLD_CAPTURE_MARKER_CONTENT) fail();
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes);
  } catch {
    fail();
  }
  if (
    !manifest ||
    manifest.schemaVersion !== 1 ||
    manifest.postgresDump?.enabled !== true
  )
    fail();
  const inputs = manifest.restoreInputs ?? [];
  if (!Array.isArray(inputs) || inputs.length > 32) fail();
  const expected = [
    ...ARCHIVES,
    DUMP,
    ...inputs.map((input) => input.archiveName),
    MANIFEST,
  ];
  if (
    new Set(expected).size !== expected.length ||
    expected.some((name) => !safeName(name))
  )
    fail();
  if (
    entries.length !== expected.length + 2 ||
    entries.some((name) => ![...expected, CHECKSUMS, MARKER].includes(name))
  )
    fail();
  const checksumsText = await readFile(join(directory, CHECKSUMS), 'utf8');
  const sums = new Map();
  for (const line of checksumsText.trimEnd().split('\n')) {
    const match = /^([a-f0-9]{64})  ([A-Za-z0-9._-]+)$/u.exec(line);
    if (!match || sums.has(match[2])) fail();
    sums.set(match[2], match[1]);
  }
  if (!checksumsText.endsWith('\n') || sums.size !== expected.length) fail();
  for (const name of expected) {
    const path = join(directory, name);
    const sourceInfo = await lstat(path);
    if (!sourceInfo.isFile() || sourceInfo.isSymbolicLink()) fail();
    const handle = await open(path, 'r');
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size < 1) fail();
      const bytes = await handle.readFile();
      const actual = Buffer.from(sha256(bytes), 'hex');
      const expectedHash = Buffer.from(sums.get(name) ?? '', 'hex');
      if (
        expectedHash.length !== actual.length ||
        !timingSafeEqual(actual, expectedHash)
      )
        fail();
    } finally {
      await handle.close();
    }
  }
  if (sha256(manifestBytes) !== sums.get(MANIFEST)) fail();
  return manifest;
}
