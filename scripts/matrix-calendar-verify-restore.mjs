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

import { spawn } from 'node:child_process';
import { createHash, timingSafeEqual } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { mkdir, mkdtemp, open, readdir, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ARCHIVES = ['radicale-data.tar', 'server-data.tar'];
const DUMP = 'reminder-postgresql.dump';
const MANIFEST = 'capture-manifest.json';
const CHECKSUMS = 'SHA256SUMS';
const MARKER = '.capture-complete';
const MAX_INPUTS = 32;
const MAX_INPUT_BYTES = 4 * 1024 * 1024;
const MAX_INPUT_TOTAL = 16 * 1024 * 1024;
const MAX_MEMBER_FILE_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_TOTAL_EXTRACTED_BYTES = 2 * 1024 * 1024 * 1024;
const INPUT_NAME = /^[a-z0-9][a-z0-9_-]{0,62}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const PG_VERSION =
  /^pg_(?:dump|restore) \(PostgreSQL\) [0-9]+(?:\.[0-9]+){0,2}(?: \([^()\r\n]*\))?$/u;
const MARKERS = new Set([
  'Cold capture verified and services resumed.\n',
  'Online capture verified while services remained running.\n',
]);

function fail() {
  throw new Error('backup verification failed');
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function run(command, args) {
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      env: { PATH: '/usr/local/bin:/usr/bin:/bin', LANG: 'C' },
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    child.once('error', () => reject(new Error('backup verification failed')));
    child.once('close', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error('backup verification failed'));
    });
  });
}

async function runForOutput(command, args) {
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      env: { PATH: '/usr/local/bin:/usr/bin:/bin', LANG: 'C' },
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const chunks = [];
    let size = 0;
    child.stdout.on('data', (chunk) => {
      size += chunk.length;
      if (size > 128) {
        child.kill('SIGKILL');
        reject(new Error('backup verification failed'));
      } else {
        chunks.push(chunk);
      }
    });
    child.once('error', () => reject(new Error('backup verification failed')));
    child.once('close', (code) => {
      if (code === 0) resolvePromise(Buffer.concat(chunks).toString('utf8'));
      else reject(new Error('backup verification failed'));
    });
  });
}

function parseArguments(args) {
  if (args.length !== 2 || args[0] !== '--capture-dir' || !args[1]) fail();
  return args[1];
}

async function readRegularFile(directory, name) {
  const path = join(directory, name);
  let handle;
  try {
    handle = await open(
      path,
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK,
    );
    const info = await handle.stat();
    if (!info.isFile() || info.size > MAX_INPUT_TOTAL) fail();
    const chunks = [];
    let bytesRead = 0;
    let position = 0;
    while (true) {
      const buffer = Buffer.alloc(
        Math.min(64 * 1024, MAX_INPUT_TOTAL + 1 - bytesRead),
      );
      const result = await handle.read(buffer, 0, buffer.length, position);
      if (result.bytesRead === 0) break;
      bytesRead += result.bytesRead;
      if (bytesRead > MAX_INPUT_TOTAL) fail();
      position += result.bytesRead;
      chunks.push(buffer.subarray(0, result.bytesRead));
    }
    return Buffer.concat(chunks, bytesRead);
  } catch {
    fail();
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function stageVerifiedRegularFile(
  sourcePath,
  targetPath,
  expectedHash,
  maxBytes,
) {
  let sourceHandle;
  let targetHandle;
  let targetCreated = false;
  try {
    sourceHandle = await open(
      sourcePath,
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK,
    );
    const before = await sourceHandle.stat();
    if (!before.isFile() || before.size < 1 || before.size > maxBytes) fail();
    targetHandle = await open(targetPath, 'wx', 0o600);
    targetCreated = true;
    const hash = createHash('sha256');
    let copied = 0;
    const buffer = Buffer.alloc(64 * 1024);
    while (true) {
      const { bytesRead } = await sourceHandle.read(
        buffer,
        0,
        buffer.length,
        copied,
      );
      if (bytesRead === 0) break;
      const targetPosition = copied;
      copied += bytesRead;
      if (copied > maxBytes) fail();
      const chunk = buffer.subarray(0, bytesRead);
      hash.update(chunk);
      let written = 0;
      while (written < bytesRead) {
        const result = await targetHandle.write(
          chunk,
          written,
          bytesRead - written,
          targetPosition + written,
        );
        if (result.bytesWritten === 0) fail();
        written += result.bytesWritten;
      }
    }
    const after = await sourceHandle.stat();
    const actualHash = hash.digest();
    const wantedHash = Buffer.from(expectedHash, 'hex');
    if (
      copied !== before.size ||
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      !timingSafeEqual(actualHash, wantedHash)
    )
      fail();
    await targetHandle.sync();
    return { size: copied };
  } catch {
    if (targetCreated) await unlink(targetPath).catch(() => {});
    fail();
  } finally {
    await sourceHandle?.close().catch(() => {});
    await targetHandle?.close().catch(() => {});
  }
}

function parseManifest(bytes) {
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    fail();
  }
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    value.schemaVersion !== 1
  )
    fail();
  if (
    Object.keys(value).some(
      (key) =>
        !['schemaVersion', 'postgresDump', 'restoreInputs'].includes(key),
    )
  )
    fail();
  const database = value.postgresDump;
  if (
    !database ||
    typeof database !== 'object' ||
    Array.isArray(database) ||
    typeof database.enabled !== 'boolean' ||
    Object.keys(database).some(
      (key) =>
        ![
          'enabled',
          'format',
          'transport',
          'pgDumpVersion',
          'pgRestoreVersion',
        ].includes(key),
    )
  )
    fail();
  if (database.enabled) {
    if (
      database.format !== 'custom' ||
      !['native', 'container-exec'].includes(database.transport) ||
      !PG_VERSION.test(database.pgDumpVersion ?? '') ||
      !PG_VERSION.test(database.pgRestoreVersion ?? '')
    )
      fail();
  } else if (Object.keys(database).length !== 1) fail();

  const inputs = value.restoreInputs ?? [];
  if (!Array.isArray(inputs) || inputs.length > MAX_INPUTS) fail();
  let total = 0;
  const names = new Set();
  const paths = new Set();
  for (let index = 0; index < inputs.length; index += 1) {
    const input = inputs[index];
    const archiveName = `restore-input-${String(index).padStart(4, '0')}.bin`;
    if (
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      Object.keys(input).some(
        (key) =>
          ![
            'name',
            'sourcePath',
            'archiveName',
            'mode',
            'sourceUid',
            'sourceGid',
            'size',
            'sha256',
          ].includes(key),
      ) ||
      typeof input.name !== 'string' ||
      !INPUT_NAME.test(input.name) ||
      names.has(input.name) ||
      typeof input.sourcePath !== 'string' ||
      input.sourcePath.includes('\0') ||
      input.sourcePath.includes('\n') ||
      !isAbsolute(input.sourcePath) ||
      resolve(input.sourcePath) !== input.sourcePath ||
      paths.has(input.sourcePath) ||
      input.archiveName !== archiveName ||
      !Number.isInteger(input.mode) ||
      input.mode < 0 ||
      input.mode > 0o777 ||
      !Number.isSafeInteger(input.sourceUid) ||
      input.sourceUid < 0 ||
      !Number.isSafeInteger(input.sourceGid) ||
      input.sourceGid < 0 ||
      !Number.isSafeInteger(input.size) ||
      input.size < 1 ||
      input.size > MAX_INPUT_BYTES ||
      typeof input.sha256 !== 'string' ||
      !SHA256.test(input.sha256) ||
      total + input.size > MAX_INPUT_TOTAL
    )
      fail();
    total += input.size;
    names.add(input.name);
    paths.add(input.sourcePath);
  }
  return { database, inputs };
}

function parseChecksums(bytes) {
  const contents = bytes.toString('utf8');
  if (!contents.endsWith('\n')) fail();
  const entries = new Map();
  for (const line of contents.slice(0, -1).split('\n')) {
    const match = /^([a-f0-9]{64})  ([A-Za-z0-9._-]+)$/u.exec(line);
    if (!match || entries.has(match[2])) fail();
    entries.set(match[2], match[1]);
  }
  return entries;
}

async function verifyArchiveTypes(path, destination, remainingBytes) {
  const script = [
    'import os,sys,tarfile',
    'archive_path,destination=sys.argv[1:3]; limit=int(sys.argv[3])',
    'def safe_name(member):',
    ' if member.name in (".", "./") and member.isdir(): return None',
    ' name=member.name.removeprefix("./").rstrip("/")',
    ' if not name or name=="." or name.startswith("/") or "\\\\" in name or any(part in ("", "..") for part in name.split("/")): raise ValueError()',
    ' if not (member.isfile() or member.isdir()): raise ValueError()',
    ' return name',
    'count=0; total=0',
    'with tarfile.open(archive_path,"r:*") as archive:',
    ' for member in archive:',
    '  count+=1; safe_name(member); total+=member.size',
    '  if count>1000000 or total>limit or member.size<0: raise ValueError()',
    'if count==0: raise ValueError()',
    'extracted=0; base=os.path.realpath(destination)',
    'with tarfile.open(archive_path,"r:*") as archive:',
    ' for member in archive:',
    '  name=safe_name(member)',
    '  if name is None: continue',
    '  target=os.path.realpath(os.path.join(destination,name))',
    '  if os.path.commonpath((base,target))!=base: raise ValueError()',
    '  if member.isdir(): os.makedirs(target,mode=0o700,exist_ok=True); continue',
    '  os.makedirs(os.path.dirname(target),mode=0o700,exist_ok=True)',
    '  fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)',
    '  stream=archive.extractfile(member)',
    '  if stream is None: os.close(fd); raise ValueError()',
    '  written=0',
    '  with os.fdopen(fd,"wb") as output:',
    '   while True:',
    '    block=stream.read(1024*1024)',
    '    if not block: break',
    '    written+=len(block); extracted+=len(block)',
    '    if extracted>limit or written>member.size: raise ValueError()',
    '    output.write(block)',
    '  if written!=member.size: raise ValueError()',
    'print(extracted)',
  ].join('\n');
  const output = await runForOutput('python3', [
    '-c',
    script,
    path,
    destination,
    String(remainingBytes),
  ]);
  if (!/^\d+\n$/u.test(output)) fail();
  return Number(output.trim());
}

async function verifyCapture(capturePath) {
  const requested = resolve(capturePath);
  let sourceHandle;
  let stage;
  try {
    sourceHandle = await open(
      requested,
      fsConstants.O_RDONLY |
        fsConstants.O_DIRECTORY |
        fsConstants.O_NOFOLLOW |
        fsConstants.O_NONBLOCK,
    );
    const sourceInfo = await sourceHandle.stat();
    if (!sourceInfo.isDirectory() || (sourceInfo.mode & 0o077) !== 0) fail();
    const source = `/proc/self/fd/${sourceHandle.fd}`;
    stage = await mkdtemp(join(tmpdir(), 'matrix-calendar-restore-check-'));
    const [manifestBytes, checksumsBytes, markerBytes] = await Promise.all([
      readRegularFile(source, MANIFEST),
      readRegularFile(source, CHECKSUMS),
      readRegularFile(source, MARKER),
    ]);
    if (!MARKERS.has(markerBytes.toString('utf8'))) fail();
    const manifest = parseManifest(manifestBytes);
    const expected = [
      ...ARCHIVES,
      ...(manifest.database.enabled ? [DUMP] : []),
      ...manifest.inputs.map((input) => input.archiveName),
      MANIFEST,
    ].sort();
    const checksums = parseChecksums(checksumsBytes);
    if (
      checksums.size !== expected.length ||
      expected.some((name) => !checksums.has(name))
    )
      fail();

    const sourceFiles = await readdir(source);
    const allowed = new Set([...expected, CHECKSUMS, MARKER]);
    if (
      sourceFiles.length !== allowed.size ||
      sourceFiles.some((name) => !allowed.has(name))
    )
      fail();
    if (sha256(manifestBytes) !== checksums.get(MANIFEST)) fail();

    const extracted = join(stage, 'restored');
    const checkedInputs = join(stage, 'restore-inputs');
    await mkdir(extracted, { mode: 0o700 });
    await mkdir(checkedInputs, { mode: 0o700 });
    let totalExpanded = 0;
    for (const archiveName of ARCHIVES) {
      const volume =
        archiveName === ARCHIVES[0] ? 'radicale-data' : 'server-data';
      const destination = join(extracted, volume);
      await mkdir(destination, { mode: 0o700 });
      const stagedArchive = join(stage, archiveName);
      try {
        await stageVerifiedRegularFile(
          join(source, archiveName),
          stagedArchive,
          checksums.get(archiveName),
          MAX_MEMBER_FILE_BYTES,
        );
        const extractedBytes = await verifyArchiveTypes(
          stagedArchive,
          destination,
          MAX_TOTAL_EXTRACTED_BYTES - totalExpanded,
        );
        totalExpanded += extractedBytes;
        if (totalExpanded > MAX_TOTAL_EXTRACTED_BYTES) fail();
      } catch (error) {
        await unlink(stagedArchive).catch(() => {});
        throw error;
      }
      await unlink(stagedArchive);
    }

    if (manifest.database.enabled) {
      const stagedDump = join(stage, DUMP);
      try {
        await stageVerifiedRegularFile(
          join(source, DUMP),
          stagedDump,
          checksums.get(DUMP),
          MAX_MEMBER_FILE_BYTES,
        );
        await run('pg_restore', ['--list', stagedDump]);
      } finally {
        await unlink(stagedDump).catch(() => {});
      }
    }

    for (const input of manifest.inputs) {
      const stagedInput = join(checkedInputs, input.archiveName);
      const result = await stageVerifiedRegularFile(
        join(source, input.archiveName),
        stagedInput,
        checksums.get(input.archiveName),
        MAX_INPUT_BYTES,
      );
      if (result.size !== input.size) fail();
      // The checksum stage hashes the same bytes that it writes into this
      // private file; compare the manifest digest against its checksum entry.
      if (checksums.get(input.archiveName) !== input.sha256) fail();
    }
    return {
      archives: ARCHIVES.length,
      database: manifest.database.enabled,
      inputs: manifest.inputs.length,
    };
  } finally {
    if (stage)
      await rm(stage, { recursive: true, force: true }).catch(() => {});
    await sourceHandle?.close().catch(() => {});
  }
}

async function main() {
  try {
    const captureDir = parseArguments(process.argv.slice(2));
    const result = await verifyCapture(captureDir);
    process.stdout.write(
      `Offline restore verification passed: ${result.archives} archives, database=${result.database}, restoreInputs=${result.inputs}.\n`,
    );
    process.stdout.write(
      'This verifies local bytes and archive extraction only; it does not validate a service restore or production recovery.\n',
    );
  } catch {
    process.stderr.write(
      'Offline restore verification failed; inspect the private capture and local tool availability.\n',
    );
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  void main();
}

export { parseManifest, stageVerifiedRegularFile, verifyCapture };
