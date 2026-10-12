#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, createReadStream, openSync } from 'node:fs';
import {
  access,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const COMPOSE_FILE = 'deploy/etke-sidecar.compose.yaml';
const SERVICE_NAMES = ['widget', 'server', 'radicale'];
const STOP_ORDER = ['widget', 'server', 'radicale'];
const START_ORDER = ['radicale', 'server', 'widget'];
const VOLUME_SUFFIXES = ['radicale-data', 'server-data'];
const ARCHIVE_NAMES = ['radicale-data.tar', 'server-data.tar'];
const DUMP_NAME = 'reminder-postgresql.dump';
const DUMP_PARTIAL_NAME = `${DUMP_NAME}.partial`;
const CHECKSUM_NAME = 'SHA256SUMS';
const CAPTURE_MARKER_NAME = '.capture-complete';
const LOCK_NAME = '.matrix-calendar-cold-backup.lock';
const COMMAND_TIMEOUT_MS = 30_000;
const CHILD_KILL_GRACE_MS = 5_000;
const CAPTURE_TIMEOUT_MS = 30 * 60_000;
const UPLOAD_TIMEOUT_MS = 2 * 60 * 60_000;
const DOCKER_STOP_TIMEOUT_SECONDS = 30;
const PRIVATE_FILE_MASK = 0o077;
const PRIVATE_DIRECTORY_MASK = 0o077;
const SAFE_PATH = /^[^\0\r\n]+$/u;
const FIXED_PATH =
  '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';

const CONFIG_KEYS = new Set([
  'projectName',
  'projectDirectory',
  'composeEnvFile',
  'captureRoot',
  'dockerSocket',
  'helperImage',
  'reminderDatabaseEnabled',
  'pgService',
  'repository',
  'awsRegion',
  'awsProfile',
  'resticHost',
  'resticTags',
]);

const SAFE_TAG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/u;
const SAFE_PROJECT = /^[a-z0-9][a-z0-9_-]{0,62}$/u;
const SAFE_SERVICE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}$/u;
const SAFE_REGION = /^[a-z0-9][a-z0-9-]{0,62}$/u;
const SAFE_IMAGE = /^[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64}$/u;

export class ColdBackupFailure extends Error {
  constructor(stage) {
    super('Cold backup stage failed.');
    this.name = 'ColdBackupFailure';
    this.stage = stage;
  }
}

function fail(stage) {
  throw new ColdBackupFailure(stage);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isSafePath(value) {
  return (
    typeof value === 'string' && isAbsolute(value) && SAFE_PATH.test(value)
  );
}

function parseS3Repository(value) {
  if (typeof value !== 'string' || !value.startsWith('s3:https://'))
    return false;

  try {
    const url = new URL(value.slice('s3:'.length));
    const segments = url.pathname.split('/').filter(Boolean);
    return (
      url.protocol === 'https:' &&
      url.hostname !== '' &&
      url.username === '' &&
      url.password === '' &&
      url.search === '' &&
      url.hash === '' &&
      segments.length >= 2 &&
      segments.every((segment) => segment !== '.' && segment !== '..')
    );
  } catch {
    return false;
  }
}

function validateConfig(config) {
  if (!isRecord(config)) fail('configuration');
  if (Object.keys(config).some((key) => !CONFIG_KEYS.has(key))) {
    fail('configuration');
  }

  if (
    !SAFE_PROJECT.test(config.projectName ?? '') ||
    !isSafePath(config.projectDirectory) ||
    !isSafePath(config.composeEnvFile) ||
    !isSafePath(config.captureRoot) ||
    !isSafePath(config.dockerSocket) ||
    !SAFE_IMAGE.test(config.helperImage ?? '') ||
    typeof config.reminderDatabaseEnabled !== 'boolean' ||
    !parseS3Repository(config.repository) ||
    !SAFE_REGION.test(config.awsRegion ?? '') ||
    (config.awsProfile !== undefined &&
      !SAFE_SERVICE.test(config.awsProfile ?? '')) ||
    !SAFE_TAG.test(config.resticHost ?? '') ||
    !Array.isArray(config.resticTags) ||
    config.resticTags.length !== 2 ||
    !config.resticTags.every((tag) => SAFE_TAG.test(tag)) ||
    new Set(config.resticTags).size !== config.resticTags.length
  ) {
    fail('configuration');
  }

  if (config.reminderDatabaseEnabled) {
    if (!SAFE_SERVICE.test(config.pgService ?? '')) fail('configuration');
  } else if (config.pgService !== null) {
    fail('configuration');
  }

  return config;
}

async function requirePrivateRegularFile(path, stage) {
  if (!isSafePath(path)) fail(stage);
  let info;
  try {
    info = await lstat(path);
  } catch {
    fail(stage);
  }
  if (
    !info.isFile() ||
    (info.mode & PRIVATE_FILE_MASK) !== 0 ||
    info.size === 0
  ) {
    fail(stage);
  }
  try {
    await access(path);
  } catch {
    fail(stage);
  }
}

async function requirePrivateDirectory(path, stage) {
  if (!isSafePath(path)) fail(stage);
  let info;
  try {
    info = await lstat(path);
  } catch {
    fail(stage);
  }
  if (
    !info.isDirectory() ||
    (info.mode & PRIVATE_DIRECTORY_MASK) !== 0 ||
    (typeof process.getuid === 'function' && info.uid !== process.getuid())
  ) {
    fail(stage);
  }
}

async function validateConfigFiles(config, runtimeEnv) {
  await requirePrivateRegularFile(runtimeEnv.RESTIC_PASSWORD_FILE, 'preflight');
  await requirePrivateRegularFile(
    runtimeEnv.AWS_SHARED_CREDENTIALS_FILE,
    'preflight',
  );
  await requirePrivateDirectory(runtimeEnv.RESTIC_CACHE_DIR, 'preflight');
  await requirePrivateDirectory(config.captureRoot, 'preflight');

  let projectInfo;
  let composeInfo;
  try {
    projectInfo = await lstat(config.projectDirectory);
    composeInfo = await lstat(join(config.projectDirectory, COMPOSE_FILE));
  } catch {
    fail('preflight');
  }
  if (
    !projectInfo.isDirectory() ||
    composeInfo.isSymbolicLink() ||
    !composeInfo.isFile()
  ) {
    fail('preflight');
  }

  await requirePrivateRegularFile(config.composeEnvFile, 'preflight');

  if (config.reminderDatabaseEnabled) {
    await requirePrivateRegularFile(runtimeEnv.PGSERVICEFILE, 'preflight');
    await requirePrivateRegularFile(runtimeEnv.PGPASSFILE, 'preflight');
    if (
      await serviceFileContainsPassword(
        runtimeEnv.PGSERVICEFILE,
        config.pgService,
      )
    ) {
      fail('preflight');
    }
  }

  try {
    return {
      projectDirectory: await realpath(config.projectDirectory),
      composeFile: await realpath(join(config.projectDirectory, COMPOSE_FILE)),
      composeEnvFile: await realpath(config.composeEnvFile),
      captureRoot: await realpath(config.captureRoot),
    };
  } catch {
    fail('preflight');
  }
}

async function serviceFileContainsPassword(path, serviceName) {
  let contents;
  try {
    contents = await readFile(path, 'utf8');
  } catch {
    fail('preflight');
  }

  let inService = false;
  for (const rawLine of contents.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#') || line.startsWith(';')) continue;
    const section = /^\[([^\]]+)\]$/u.exec(line);
    if (section) {
      inService = section[1] === serviceName;
      continue;
    }
    if (inService && /^password\s*=/iu.test(line)) return true;
  }
  return false;
}

function composeArgs(config, paths, args) {
  return [
    'compose',
    '--project-name',
    config.projectName,
    '--env-file',
    paths.composeEnvFile,
    '-f',
    paths.composeFile,
    ...args,
  ];
}

function baseEnvironment(config, paths) {
  return {
    PATH: FIXED_PATH,
    HOME: process.env.HOME ?? '/',
    ...(paths ? { PWD: paths.projectDirectory } : {}),
    ...(config ? { DOCKER_HOST: `unix://${config.dockerSocket}` } : {}),
  };
}

function commandEnvironment(config, paths, runtimeEnv, kind) {
  if (kind === 'restic') {
    return {
      PATH: FIXED_PATH,
      HOME: process.env.HOME ?? '/',
      RESTIC_PASSWORD_FILE: runtimeEnv.RESTIC_PASSWORD_FILE,
      AWS_SHARED_CREDENTIALS_FILE: runtimeEnv.AWS_SHARED_CREDENTIALS_FILE,
      RESTIC_CACHE_DIR: runtimeEnv.RESTIC_CACHE_DIR,
      AWS_REGION: config.awsRegion,
      AWS_DEFAULT_REGION: config.awsRegion,
      RESTIC_REPOSITORY: config.repository,
      ...(config.awsProfile ? { AWS_PROFILE: config.awsProfile } : {}),
    };
  }
  if (kind === 'postgres') {
    return {
      PATH: FIXED_PATH,
      HOME: process.env.HOME ?? '/',
      PGSERVICE: config.pgService,
      PGSERVICEFILE: runtimeEnv.PGSERVICEFILE,
      PGPASSFILE: runtimeEnv.PGPASSFILE,
    };
  }
  return baseEnvironment(config, paths);
}

export function defaultCommand(command, args, options = {}) {
  return new Promise((resolveResult) => {
    if (options.signal?.aborted) {
      resolveResult({ status: 1, stdout: '' });
      return;
    }

    let stdoutFd;
    try {
      if (options.stdoutPath) {
        stdoutFd = openSync(options.stdoutPath, 'wx', 0o600);
      }
    } catch {
      resolveResult({ status: 1, stdout: '' });
      return;
    }

    let child;
    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env,
        stdio: [
          'ignore',
          stdoutFd !== undefined
            ? stdoutFd
            : options.discardStdout
              ? 'ignore'
              : 'pipe',
          options.captureStderr ? 'pipe' : 'ignore',
        ],
      });
    } catch {
      if (stdoutFd !== undefined) closeSync(stdoutFd);
      resolveResult({ status: 1, stdout: '' });
      return;
    }

    const chunks = [];
    const stderrChunks = [];
    let outputSize = 0;
    let stderrSize = 0;
    let settled = false;
    let timedOut = false;
    let aborted = false;
    let terminationStarted = false;
    let killEscalation;
    const maxOutputBytes = 1024 * 1024;

    function terminateChild() {
      if (terminationStarted) return;
      terminationStarted = true;
      child.kill('SIGTERM');
      killEscalation = setTimeout(() => {
        if (!settled) child.kill('SIGKILL');
      }, CHILD_KILL_GRACE_MS);
      killEscalation.unref();
    }

    const timeout = setTimeout(() => {
      timedOut = true;
      terminateChild();
    }, options.timeoutMs ?? COMMAND_TIMEOUT_MS);
    timeout.unref();

    const onAbort = () => {
      aborted = true;
      terminateChild();
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout?.on('data', (chunk) => {
      outputSize += chunk.length;
      if (outputSize > maxOutputBytes) {
        terminateChild();
        return;
      }
      chunks.push(chunk);
    });

    child.stderr?.on('data', (chunk) => {
      stderrSize += chunk.length;
      if (stderrSize > maxOutputBytes) {
        terminateChild();
        return;
      }
      stderrChunks.push(chunk);
    });

    child.on('error', () => finish(1));
    child.on('close', (code) => {
      finish(
        code === 0 &&
          !timedOut &&
          !aborted &&
          outputSize <= maxOutputBytes &&
          stderrSize <= maxOutputBytes
          ? 0
          : Number.isInteger(code) && code > 0
            ? code
            : 1,
      );
    });

    function finish(status) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(killEscalation);
      options.signal?.removeEventListener('abort', onAbort);
      if (stdoutFd !== undefined) closeSync(stdoutFd);
      resolveResult({
        status,
        stdout: Buffer.concat(chunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
      });
    }
  });
}

function isSuccess(result) {
  return result !== null && typeof result === 'object' && result.status === 0;
}

async function runCommand(
  deps,
  command,
  args,
  options,
  stage,
  strictStderr = false,
) {
  let result;
  try {
    result = await deps.command(command, args, options);
  } catch {
    fail(stage);
  }
  if (!isSuccess(result)) fail(stage);
  if (
    strictStderr &&
    typeof result.stderr === 'string' &&
    result.stderr.trim() !== ''
  ) {
    fail(stage);
  }
  return result.stdout ?? '';
}

function parseJsonLines(output, stage) {
  try {
    const trimmed = output.trim();
    if (trimmed === '') return [];
    const parsed = trimmed.startsWith('[')
      ? JSON.parse(trimmed)
      : trimmed.split(/\r?\n/u).map((line) => JSON.parse(line));
    if (!Array.isArray(parsed) || !parsed.every(isRecord)) fail(stage);
    return parsed;
  } catch {
    fail(stage);
  }
}

function serviceRecordFields(record) {
  return {
    id: record.ID ?? record.Id ?? record.id,
    service: record.Service ?? record.service,
    state: String(record.State ?? record.state ?? '').toLowerCase(),
  };
}

function validateComposeServices(records, mustBeRunning, stage) {
  if (records.length !== SERVICE_NAMES.length) fail(stage);
  const fields = records.map(serviceRecordFields);
  if (
    fields.some(
      ({ id, service }) =>
        typeof id !== 'string' || !SERVICE_NAMES.includes(service),
    ) ||
    new Set(fields.map(({ service }) => service)).size !==
      SERVICE_NAMES.length ||
    new Set(fields.map(({ id }) => id)).size !== SERVICE_NAMES.length
  ) {
    fail(stage);
  }
  if (
    fields.some(({ state }) =>
      mustBeRunning ? state !== 'running' : state === 'running',
    )
  ) {
    fail(stage);
  }
  return Object.fromEntries(fields.map(({ id, service }) => [service, id]));
}

async function composeServices(
  config,
  paths,
  deps,
  runtimeEnv,
  mustBeRunning,
  stage,
  signal,
) {
  const output = await runCommand(
    deps,
    'docker',
    composeArgs(config, paths, ['ps', '--all', '--format', 'json']),
    {
      cwd: paths.projectDirectory,
      env: commandEnvironment(config, paths, runtimeEnv, 'docker'),
      signal,
      timeoutMs: COMMAND_TIMEOUT_MS,
    },
    stage,
  );
  return validateComposeServices(
    parseJsonLines(output, stage),
    mustBeRunning,
    stage,
  );
}

async function inspectStoppedService(
  config,
  paths,
  runtimeEnv,
  deps,
  id,
  stage,
  signal,
) {
  const output = await runCommand(
    deps,
    'docker',
    ['inspect', '--format', '{{json .State}}', id],
    {
      cwd: paths.projectDirectory,
      env: commandEnvironment(config, paths, runtimeEnv, 'docker'),
      signal,
      timeoutMs: COMMAND_TIMEOUT_MS,
    },
    stage,
  );
  let state;
  try {
    state = JSON.parse(output);
  } catch {
    fail(stage);
  }
  if (
    !isRecord(state) ||
    state.Running !== false ||
    state.OOMKilled !== false ||
    !['exited', 'stopped'].includes(String(state.Status).toLowerCase()) ||
    ![0, 143].includes(state.ExitCode)
  ) {
    fail(stage);
  }
}

async function inspectJson(
  config,
  paths,
  runtimeEnv,
  deps,
  id,
  format,
  stage,
  signal,
) {
  const output = await runCommand(
    deps,
    'docker',
    ['inspect', '--format', format, id],
    {
      cwd: paths.projectDirectory,
      env: commandEnvironment(config, paths, runtimeEnv, 'docker'),
      signal,
      timeoutMs: COMMAND_TIMEOUT_MS,
    },
    stage,
  );
  try {
    return JSON.parse(output);
  } catch {
    fail(stage);
  }
}

async function verifyContainerIdentityAndMounts(
  config,
  paths,
  runtimeEnv,
  deps,
  ids,
  stage,
  signal,
) {
  for (const service of SERVICE_NAMES) {
    const labels = await inspectJson(
      config,
      paths,
      runtimeEnv,
      deps,
      ids[service],
      '{{json .Config.Labels}}',
      stage,
      signal,
    );
    if (
      !isRecord(labels) ||
      labels['com.docker.compose.project'] !== config.projectName ||
      labels['com.docker.compose.service'] !== service
    ) {
      fail(stage);
    }
  }

  const expectedMounts = [
    {
      service: 'radicale',
      volume: `${config.projectName}_radicale-data`,
      destination: '/data',
    },
    {
      service: 'server',
      volume: `${config.projectName}_server-data`,
      destination: '/app/storage',
    },
  ];
  for (const expected of expectedMounts) {
    const mounts = await inspectJson(
      config,
      paths,
      runtimeEnv,
      deps,
      ids[expected.service],
      '{{json .Mounts}}',
      stage,
      signal,
    );
    if (
      !Array.isArray(mounts) ||
      mounts.filter(
        (mount) =>
          isRecord(mount) &&
          mount.Type === 'volume' &&
          mount.Name === expected.volume &&
          mount.Destination === expected.destination &&
          mount.RW === true,
      ).length !== 1
    ) {
      fail(stage);
    }
  }
}

async function assertVolumeWriters(
  config,
  paths,
  runtimeEnv,
  deps,
  ids,
  stopped,
  stage,
  signal,
) {
  const env = commandEnvironment(config, paths, runtimeEnv, 'docker');
  for (let index = 0; index < VOLUME_SUFFIXES.length; index += 1) {
    const volumeName = `${config.projectName}_${VOLUME_SUFFIXES[index]}`;
    const output = await runCommand(
      deps,
      'docker',
      ['ps', '--filter', `volume=${volumeName}`, '--format', 'json'],
      {
        cwd: paths.projectDirectory,
        env,
        signal,
        timeoutMs: COMMAND_TIMEOUT_MS,
      },
      stage,
    );
    const consumers = parseJsonLines(output, stage).map((record) => ({
      id: record.ID ?? record.Id ?? record.id,
      state: String(record.State ?? record.state ?? '').toLowerCase(),
    }));
    if (stopped) {
      if (consumers.length !== 0) fail(stage);
      continue;
    }

    const expectedService = index === 0 ? 'radicale' : 'server';
    if (
      consumers.length !== 1 ||
      consumers[0].state !== 'running' ||
      typeof consumers[0].id !== 'string' ||
      (!ids[expectedService].startsWith(consumers[0].id) &&
        !consumers[0].id.startsWith(ids[expectedService]))
    ) {
      fail(stage);
    }
  }
}

async function assertStoppedServices(
  config,
  paths,
  runtimeEnv,
  deps,
  stage,
  signal,
) {
  const ids = await composeServices(
    config,
    paths,
    deps,
    runtimeEnv,
    false,
    stage,
    signal,
  );
  await assertVolumeWriters(
    config,
    paths,
    runtimeEnv,
    deps,
    ids,
    true,
    stage,
    signal,
  );
  for (const service of SERVICE_NAMES) {
    await inspectStoppedService(
      config,
      paths,
      runtimeEnv,
      deps,
      ids[service],
      stage,
      signal,
    );
  }
}

async function dockerPreflight(config, paths, deps, runtimeEnv, signal) {
  const env = commandEnvironment(config, paths, runtimeEnv, 'docker');
  await runCommand(
    deps,
    'docker',
    composeArgs(config, paths, ['config', '--quiet']),
    { cwd: paths.projectDirectory, env, signal },
    'preflight',
  );
  await runCommand(
    deps,
    'docker',
    ['compose', 'version'],
    { cwd: paths.projectDirectory, env, signal },
    'preflight',
  );
  await runCommand(
    deps,
    'docker',
    ['info', '--format', '{{.ServerVersion}}'],
    { cwd: paths.projectDirectory, env, signal },
    'preflight',
  );
  await runCommand(
    deps,
    'docker',
    ['image', 'inspect', '--format', '{{.Id}}', config.helperImage],
    { cwd: paths.projectDirectory, env, signal },
    'preflight',
  );

  for (const suffix of VOLUME_SUFFIXES) {
    await runCommand(
      deps,
      'docker',
      ['volume', 'inspect', `${config.projectName}_${suffix}`],
      { cwd: paths.projectDirectory, env, signal },
      'preflight',
    );
  }

  const resticEnv = commandEnvironment(config, paths, runtimeEnv, 'restic');
  await runCommand(
    deps,
    'restic',
    ['version'],
    { env: resticEnv, signal },
    'preflight',
  );

  if (config.reminderDatabaseEnabled) {
    const postgresEnv = commandEnvironment(
      config,
      paths,
      runtimeEnv,
      'postgres',
    );
    await runCommand(
      deps,
      'pg_dump',
      ['--version'],
      { env: postgresEnv, signal },
      'preflight',
    );
    await runCommand(
      deps,
      'pg_restore',
      ['--version'],
      { env: postgresEnv, signal },
      'preflight',
    );
  }

  const ids = await composeServices(
    config,
    paths,
    deps,
    runtimeEnv,
    true,
    'preflight',
    signal,
  );
  await verifyContainerIdentityAndMounts(
    config,
    paths,
    runtimeEnv,
    deps,
    ids,
    'preflight',
    signal,
  );
  await assertVolumeWriters(
    config,
    paths,
    runtimeEnv,
    deps,
    ids,
    false,
    'preflight',
    signal,
  );
}

function makeRunName(now, id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9-]{1,64}$/u.test(id)) {
    fail('capture');
  }
  const timestamp = now
    .toISOString()
    .replace(/[-:]/gu, '')
    .replace(/\.\d{3}/u, '');
  return `${timestamp}-${id}`;
}

async function acquireLock(path) {
  try {
    return await open(path, 'wx', 0o600);
  } catch {
    fail('lock');
  }
}

async function refuseExistingLock(path) {
  try {
    await lstat(path);
    fail('lock');
  } catch (error) {
    if (error instanceof ColdBackupFailure) throw error;
    if (error?.code !== 'ENOENT') fail('lock');
  }
}

async function createOutputFile(path, contents, stage) {
  try {
    await writeFile(path, contents, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
  } catch {
    fail(stage);
  }
}

async function requireNonemptyFile(path, stage) {
  let info;
  try {
    info = await lstat(path);
  } catch {
    fail(stage);
  }
  if (!info.isFile() || info.isSymbolicLink() || info.size === 0) fail(stage);
}

async function hashFile(path, stage) {
  return new Promise((resolveHash, rejectHash) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('error', () => rejectHash(new ColdBackupFailure(stage)));
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolveHash(hash.digest('hex')));
  });
}

async function capturePostgres(
  config,
  paths,
  runtimeEnv,
  deps,
  captureDirectory,
  signal,
) {
  if (!config.reminderDatabaseEnabled) {
    for (const name of [DUMP_NAME, DUMP_PARTIAL_NAME]) {
      try {
        await lstat(join(captureDirectory, name));
        fail('database');
      } catch (error) {
        if (error instanceof ColdBackupFailure) throw error;
      }
    }
    return false;
  }

  const partialPath = join(captureDirectory, DUMP_PARTIAL_NAME);
  const finalPath = join(captureDirectory, DUMP_NAME);
  const env = commandEnvironment(config, paths, runtimeEnv, 'postgres');
  await runCommand(
    deps,
    'pg_dump',
    ['--format=custom'],
    {
      cwd: paths.projectDirectory,
      env,
      signal,
      timeoutMs: CAPTURE_TIMEOUT_MS,
      stdoutPath: partialPath,
      captureStderr: true,
    },
    'database',
    true,
  );
  await requireNonemptyFile(partialPath, 'database');
  await runCommand(
    deps,
    'pg_restore',
    ['--list', partialPath],
    {
      cwd: paths.projectDirectory,
      env,
      signal,
      timeoutMs: CAPTURE_TIMEOUT_MS,
      discardStdout: true,
      captureStderr: true,
    },
    'database',
    true,
  );
  try {
    await rename(partialPath, finalPath);
  } catch {
    fail('database');
  }
  return true;
}

function archiveCommand(config, volumeName) {
  return [
    'run',
    '--rm',
    '--pull=never',
    '--network',
    'none',
    '--read-only',
    '--mount',
    `type=volume,src=${volumeName},dst=/source,readonly`,
    '--workdir',
    '/source',
    '--entrypoint',
    'tar',
    config.helperImage,
    '-cpf',
    '-',
    '.',
  ];
}

async function captureArchive(
  config,
  paths,
  runtimeEnv,
  deps,
  captureDirectory,
  volumeName,
  archiveName,
  signal,
) {
  const partialPath = join(captureDirectory, `${archiveName}.partial`);
  await runCommand(
    deps,
    'docker',
    archiveCommand(config, volumeName),
    {
      cwd: paths.projectDirectory,
      env: commandEnvironment(config, paths, runtimeEnv, 'docker'),
      signal,
      timeoutMs: CAPTURE_TIMEOUT_MS,
      stdoutPath: partialPath,
      captureStderr: true,
    },
    'archive',
    true,
  );
  await requireNonemptyFile(partialPath, 'archive');

  const helperCommand = [
    'run',
    '--rm',
    '--pull=never',
    '--network',
    'none',
    '--read-only',
    '--mount',
    `type=bind,src=${captureDirectory},dst=/backup,readonly`,
    '--entrypoint',
    'tar',
    config.helperImage,
    '-tf',
    `/backup/${archiveName}.partial`,
  ];
  await runCommand(
    deps,
    'docker',
    helperCommand,
    {
      cwd: paths.projectDirectory,
      env: commandEnvironment(config, paths, runtimeEnv, 'docker'),
      signal,
      timeoutMs: CAPTURE_TIMEOUT_MS,
      discardStdout: true,
      captureStderr: true,
    },
    'verification',
    true,
  );

  try {
    await rename(partialPath, join(captureDirectory, archiveName));
  } catch {
    fail('archive');
  }
}

async function writeChecksums(captureDirectory, hasDatabase) {
  const names = [...ARCHIVE_NAMES, ...(hasDatabase ? [DUMP_NAME] : [])];
  const lines = [];
  for (const name of names) {
    const path = join(captureDirectory, name);
    await requireNonemptyFile(path, 'checksums');
    lines.push(`${await hashFile(path, 'checksums')}  ${name}`);
  }
  await createOutputFile(
    join(captureDirectory, CHECKSUM_NAME),
    `${lines.join('\n')}\n`,
    'checksums',
  );
}

async function startServices(config, paths, runtimeEnv, deps) {
  let failed = false;
  for (const service of START_ORDER) {
    const result = await deps
      .command('docker', composeArgs(config, paths, ['start', service]), {
        cwd: paths.projectDirectory,
        env: commandEnvironment(config, paths, runtimeEnv, 'docker'),
        timeoutMs: COMMAND_TIMEOUT_MS,
      })
      .catch(() => ({ status: 1, stdout: '' }));
    if (!isSuccess(result)) failed = true;
  }

  try {
    await composeServices(config, paths, deps, runtimeEnv, true, 'resume');
  } catch {
    failed = true;
  }
  return !failed;
}

async function releaseLock(lockHandle, lockPath) {
  try {
    await lockHandle.close();
  } catch {
    fail('lock');
  }
  try {
    await unlink(lockPath);
  } catch {
    fail('lock');
  }
}

function runtimeEnvironment(env = process.env) {
  return {
    RESTIC_PASSWORD_FILE: env.RESTIC_PASSWORD_FILE,
    AWS_SHARED_CREDENTIALS_FILE: env.AWS_SHARED_CREDENTIALS_FILE,
    RESTIC_CACHE_DIR: env.RESTIC_CACHE_DIR,
    PGSERVICEFILE: env.PGSERVICEFILE,
    PGPASSFILE: env.PGPASSFILE,
  };
}

export async function runColdBackup(configInput, dependencies = {}) {
  const config = validateConfig(configInput);
  const deps = {
    command: dependencies.command ?? defaultCommand,
    now: dependencies.now ?? (() => new Date()),
    id: dependencies.id ?? randomUUID,
    env: dependencies.env ?? process.env,
  };
  const runtimeEnv = runtimeEnvironment(deps.env);
  const paths = await validateConfigFiles(config, runtimeEnv);
  const signal = dependencies.signal;
  const lockPath = join(paths.captureRoot, LOCK_NAME);
  await refuseExistingLock(lockPath);
  await dockerPreflight(config, paths, deps, runtimeEnv, signal).catch(
    (error) => {
      if (error instanceof ColdBackupFailure) throw error;
      fail('preflight');
    },
  );

  const lockHandle = await acquireLock(lockPath);
  let captureDirectory;
  let stopAttempted = false;
  let failure;

  try {
    const current = await composeServices(
      config,
      paths,
      deps,
      runtimeEnv,
      true,
      'preflight',
      signal,
    );
    await verifyContainerIdentityAndMounts(
      config,
      paths,
      runtimeEnv,
      deps,
      current,
      'preflight',
      signal,
    );
    await assertVolumeWriters(
      config,
      paths,
      runtimeEnv,
      deps,
      current,
      false,
      'preflight',
      signal,
    );
    const runName = makeRunName(deps.now(), deps.id());
    captureDirectory = join(paths.captureRoot, runName);
    try {
      await mkdir(captureDirectory, { mode: 0o700 });
    } catch {
      fail('capture');
    }

    // From the first stop onward, every exit path attempts dependency-order resume.
    stopAttempted = true;
    for (const service of STOP_ORDER) {
      await runCommand(
        deps,
        'docker',
        composeArgs(config, paths, [
          'stop',
          '--timeout',
          String(DOCKER_STOP_TIMEOUT_SECONDS),
          service,
        ]),
        {
          cwd: paths.projectDirectory,
          env: commandEnvironment(config, paths, runtimeEnv, 'docker'),
          signal,
          timeoutMs: (DOCKER_STOP_TIMEOUT_SECONDS + 30) * 1000,
        },
        'quiesce',
      );
    }

    await assertStoppedServices(
      config,
      paths,
      runtimeEnv,
      deps,
      'quiesce',
      signal,
    );
    for (const service of SERVICE_NAMES) {
      await inspectStoppedService(
        config,
        paths,
        runtimeEnv,
        deps,
        current[service],
        'quiesce',
        signal,
      );
    }

    const hasDatabase = await capturePostgres(
      config,
      paths,
      runtimeEnv,
      deps,
      captureDirectory,
      signal,
    );
    for (let index = 0; index < VOLUME_SUFFIXES.length; index += 1) {
      const volumeName = `${config.projectName}_${VOLUME_SUFFIXES[index]}`;
      await captureArchive(
        config,
        paths,
        runtimeEnv,
        deps,
        captureDirectory,
        volumeName,
        ARCHIVE_NAMES[index],
        signal,
      );
    }
    await writeChecksums(captureDirectory, hasDatabase);
    await assertStoppedServices(
      config,
      paths,
      runtimeEnv,
      deps,
      'verification',
      signal,
    );

    // Restart before marking the capture complete and before any S3 access.
    const resumed = await startServices(config, paths, runtimeEnv, deps);
    stopAttempted = false;
    if (!resumed) fail('resume');

    await createOutputFile(
      join(captureDirectory, CAPTURE_MARKER_NAME),
      'Cold capture verified and services resumed.\n',
      'verification',
    );

    const resticArgs = [
      'backup',
      '--host',
      config.resticHost,
      '--tag',
      config.resticTags[0],
      '--tag',
      config.resticTags[1],
      '--group-by',
      'host,tags',
      captureDirectory,
    ];
    await runCommand(
      deps,
      'restic',
      resticArgs,
      {
        env: commandEnvironment(config, paths, runtimeEnv, 'restic'),
        signal,
        timeoutMs: UPLOAD_TIMEOUT_MS,
        discardStdout: true,
      },
      'upload',
    );
  } catch (error) {
    failure =
      error instanceof ColdBackupFailure
        ? error
        : new ColdBackupFailure('capture');
  } finally {
    if (
      stopAttempted &&
      !(await startServices(config, paths, runtimeEnv, deps))
    ) {
      failure = new ColdBackupFailure('resume');
    }
    await releaseLock(lockHandle, lockPath).catch((error) => {
      failure =
        error instanceof ColdBackupFailure
          ? error
          : new ColdBackupFailure('lock');
    });
  }

  if (failure) throw failure;
  return { captureDirectory };
}

async function readConfigFile(path) {
  if (!isSafePath(path)) fail('configuration');
  await requirePrivateRegularFile(path, 'configuration');
  try {
    return validateConfig(JSON.parse(await readFile(path, 'utf8')));
  } catch {
    fail('configuration');
  }
}

function parseConfigArgument(args) {
  if (args.length !== 2 || args[0] !== '--config') fail('configuration');
  return args[1];
}

async function main() {
  let controller;
  let abortForSignal;
  try {
    const configPath = parseConfigArgument(process.argv.slice(2));
    const config = await readConfigFile(configPath);
    controller = new AbortController();
    abortForSignal = () => controller.abort();
    process.once('SIGINT', abortForSignal);
    process.once('SIGTERM', abortForSignal);
    await runColdBackup(config, { signal: controller.signal });
    process.stdout.write('Cold backup completed.\n');
  } catch (error) {
    const stage =
      error instanceof ColdBackupFailure &&
      [
        'configuration',
        'preflight',
        'lock',
        'capture',
        'quiesce',
        'database',
        'archive',
        'verification',
        'checksums',
        'resume',
        'upload',
      ].includes(error.stage)
        ? error.stage
        : 'configuration';
    process.stderr.write(
      `Cold backup failed during ${stage}; inspect host configuration and service state.\n`,
    );
    process.exitCode = 1;
  } finally {
    if (abortForSignal) {
      process.removeListener('SIGINT', abortForSignal);
      process.removeListener('SIGTERM', abortForSignal);
    }
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  void main();
}
