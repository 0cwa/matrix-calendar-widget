#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  createReadStream,
  constants as fsConstants,
  openSync,
} from 'node:fs';
import {
  access,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rmdir,
  unlink,
  writeFile,
} from 'node:fs/promises';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  normalize,
  relative,
  resolve,
  sep,
} from 'node:path';
import { fileURLToPath } from 'node:url';

const COMPOSE_FILE = 'deploy/etke-sidecar.compose.yaml';
const SERVICE_NAMES = ['widget', 'server', 'radicale'];
const STOP_ORDER = ['widget', 'server', 'radicale'];
const START_ORDER = ['radicale', 'server', 'widget'];
const VOLUME_SUFFIXES = ['radicale-data', 'server-data'];
const ARCHIVE_NAMES = ['radicale-data.tar', 'server-data.tar'];
const DUMP_NAME = 'reminder-postgresql.dump';
const DUMP_PARTIAL_NAME = `${DUMP_NAME}.partial`;
const RESTORE_INPUT_PREFIX = 'restore-input-';
const MAX_RESTORE_INPUTS = 32;
const MAX_RESTORE_INPUT_BYTES = 4 * 1024 * 1024;
const MAX_RESTORE_INPUT_TOTAL_BYTES = 16 * 1024 * 1024;
const MAX_COMPOSE_FILES = 16;
const CAPTURE_MANIFEST_NAME = 'capture-manifest.json';
const CHECKSUM_NAME = 'SHA256SUMS';
const CAPTURE_MARKER_NAME = '.capture-complete';
const COLD_CAPTURE_MARKER_CONTENT =
  'Cold capture verified and services resumed.\n';
const ONLINE_CAPTURE_MARKER_CONTENT =
  'Online capture verified while services remained running.\n';
const LOCK_NAME = '.matrix-calendar-cold-backup.lock';
const SNAPSHOT_ID = /^[a-f0-9]{64}$/u;
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
  'composeFiles',
  'captureRoot',
  'dockerSocket',
  'helperImage',
  'reminderDatabaseEnabled',
  'pgService',
  'postgresDumpTransport',
  'postgresContainer',
  'repository',
  'awsRegion',
  'awsProfile',
  'resticHost',
  'resticTags',
  'resticRetentionEnabled',
  'cleanupSuccessfulCapture',
  'captureMode',
  'restoreInputs',
]);

const SAFE_TAG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/u;
const SAFE_PROJECT = /^[a-z0-9][a-z0-9_-]{0,62}$/u;
const SAFE_SERVICE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}$/u;
const SAFE_RESTORE_INPUT_NAME = /^[a-z0-9][a-z0-9_-]{0,62}$/u;
const SAFE_REGION = /^[a-z0-9][a-z0-9-]{0,62}$/u;
const SAFE_IMAGE = /^[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64}$/u;
const SAFE_DATABASE_NAME = /^[A-Za-z_][A-Za-z0-9_.-]{0,62}$/u;
const SAFE_POSTGRES_VERSION =
  /^pg_(?:dump|restore) \(PostgreSQL\) [0-9]+(?:\.[0-9]+){0,2}(?: \([^()\r\n]*\))?$/u;
const POSTGRES_CONTAINER_PATH = '/usr/local/bin:/usr/bin:/bin';

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

function isSafeComposeRelativePath(value) {
  return (
    typeof value === 'string' &&
    value.length <= 4096 &&
    SAFE_PATH.test(value) &&
    !isAbsolute(value) &&
    !value.includes('\\') &&
    normalize(value) === value &&
    value !== '.' &&
    value
      .split('/')
      .every((segment) => segment !== '' && segment !== '.' && segment !== '..')
  );
}

function isWithinDirectory(directory, filePath) {
  const relativePath = relative(directory, filePath);
  return (
    relativePath !== '' &&
    relativePath !== '..' &&
    !relativePath.startsWith(`..${sep}`) &&
    !isAbsolute(relativePath)
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
    typeof config.projectName !== 'string' ||
    !SAFE_PROJECT.test(config.projectName) ||
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
    typeof config.resticHost !== 'string' ||
    !SAFE_TAG.test(config.resticHost) ||
    !Array.isArray(config.resticTags) ||
    config.resticTags.length !== 2 ||
    !config.resticTags.every(
      (tag) => typeof tag === 'string' && SAFE_TAG.test(tag),
    ) ||
    new Set(config.resticTags).size !== config.resticTags.length ||
    (config.resticRetentionEnabled !== undefined &&
      typeof config.resticRetentionEnabled !== 'boolean') ||
    (config.cleanupSuccessfulCapture !== undefined &&
      typeof config.cleanupSuccessfulCapture !== 'boolean')
  ) {
    fail('configuration');
  }

  const dumpTransport = config.postgresDumpTransport ?? 'native';
  if (!['native', 'container-exec'].includes(dumpTransport)) {
    fail('configuration');
  }

  if (config.postgresContainer !== undefined) {
    if (
      dumpTransport !== 'container-exec' ||
      !isRecord(config.postgresContainer)
    ) {
      fail('configuration');
    }
    const container = config.postgresContainer;
    if (
      Object.keys(container).some(
        (key) =>
          ![
            'projectName',
            'serviceName',
            'image',
            'database',
            'username',
          ].includes(key),
      ) ||
      typeof container.projectName !== 'string' ||
      !SAFE_PROJECT.test(container.projectName) ||
      typeof container.serviceName !== 'string' ||
      !SAFE_SERVICE.test(container.serviceName) ||
      !SAFE_IMAGE.test(container.image ?? '') ||
      typeof container.database !== 'string' ||
      !SAFE_DATABASE_NAME.test(container.database) ||
      typeof container.username !== 'string' ||
      !SAFE_DATABASE_NAME.test(container.username)
    ) {
      fail('configuration');
    }
  } else if (dumpTransport === 'container-exec') {
    fail('configuration');
  }

  if (
    config.resticRetentionEnabled &&
    (config.resticHost !== config.projectName ||
      !config.resticTags.includes(config.projectName))
  ) {
    fail('configuration');
  }

  if (config.reminderDatabaseEnabled) {
    if (dumpTransport === 'native') {
      if (!SAFE_SERVICE.test(config.pgService ?? '')) fail('configuration');
    } else if (config.pgService !== null) {
      fail('configuration');
    }
  } else if (config.pgService !== null) {
    fail('configuration');
  } else if (
    dumpTransport !== 'native' ||
    config.postgresContainer !== undefined
  ) {
    fail('configuration');
  }

  if (
    config.captureMode !== undefined &&
    !['cold', 'online'].includes(config.captureMode)
  ) {
    fail('configuration');
  }

  if (config.composeFiles !== undefined) {
    if (
      !Array.isArray(config.composeFiles) ||
      config.composeFiles.length === 0 ||
      config.composeFiles.length > MAX_COMPOSE_FILES ||
      !config.composeFiles.every(isSafeComposeRelativePath) ||
      new Set(config.composeFiles).size !== config.composeFiles.length
    ) {
      fail('configuration');
    }
  }

  const restoreInputs = config.restoreInputs ?? [];
  if (
    !Array.isArray(restoreInputs) ||
    restoreInputs.length > MAX_RESTORE_INPUTS
  ) {
    fail('configuration');
  }
  const restoreInputNames = new Set();
  const restoreInputPaths = new Set();
  for (const input of restoreInputs) {
    if (
      !isRecord(input) ||
      Object.keys(input).some((key) => !['name', 'path'].includes(key)) ||
      typeof input.name !== 'string' ||
      !SAFE_RESTORE_INPUT_NAME.test(input.name) ||
      typeof input.path !== 'string' ||
      !isSafePath(input.path) ||
      resolve(input.path) !== input.path ||
      restoreInputNames.has(input.name) ||
      restoreInputPaths.has(input.path)
    ) {
      fail('configuration');
    }
    restoreInputNames.add(input.name);
    restoreInputPaths.add(input.path);
  }
  config.restoreInputs = restoreInputs;

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
    info = await lstat(path, { bigint: true });
  } catch {
    fail(stage);
  }
  if (
    !info.isDirectory() ||
    (info.mode & BigInt(PRIVATE_DIRECTORY_MASK)) !== 0n ||
    (typeof process.getuid === 'function' &&
      info.uid !== BigInt(process.getuid()))
  ) {
    fail(stage);
  }
  return info;
}

async function requireNoSymlinkAncestors(path, stage) {
  let current = resolve(path);
  while (true) {
    let info;
    try {
      info = await lstat(current, { bigint: true });
    } catch {
      fail(stage);
    }
    if (info.isSymbolicLink()) fail(stage);
    const parent = dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

function directoryIdentity(info) {
  return {
    dev: info.dev,
    ino: info.ino,
    uid: info.uid,
    mode: info.mode,
  };
}

function sameDirectoryIdentity(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.uid === right.uid &&
    left.mode === right.mode
  );
}

async function validateConfigFiles(config, runtimeEnv) {
  await requirePrivateRegularFile(runtimeEnv.RESTIC_PASSWORD_FILE, 'preflight');
  await requirePrivateRegularFile(
    runtimeEnv.AWS_SHARED_CREDENTIALS_FILE,
    'preflight',
  );
  await requirePrivateDirectory(runtimeEnv.RESTIC_CACHE_DIR, 'preflight');
  const captureRootInfo = await requirePrivateDirectory(
    config.captureRoot,
    'preflight',
  );
  if (config.cleanupSuccessfulCapture) {
    await requireNoSymlinkAncestors(config.captureRoot, 'preflight');
  }

  let projectInfo;
  let projectDirectory;
  try {
    projectInfo = await lstat(config.projectDirectory);
    projectDirectory = await realpath(config.projectDirectory);
  } catch {
    fail('preflight');
  }
  if (!projectInfo.isDirectory()) fail('preflight');

  const composeFiles = config.composeFiles ?? [COMPOSE_FILE];
  const resolvedComposeFiles = [];
  const resolvedComposePaths = new Set();
  for (const composeFile of composeFiles) {
    if (!isSafeComposeRelativePath(composeFile)) fail('preflight');
    const composePath = resolve(projectDirectory, composeFile);
    if (!isWithinDirectory(projectDirectory, composePath)) fail('preflight');
    await requireNoSymlinkAncestors(composePath, 'preflight');
    let composeInfo;
    let canonicalComposePath;
    try {
      composeInfo = await lstat(composePath);
      canonicalComposePath = await realpath(composePath);
    } catch {
      fail('preflight');
    }
    if (
      composeInfo.isSymbolicLink() ||
      !composeInfo.isFile() ||
      canonicalComposePath !== composePath ||
      !isWithinDirectory(projectDirectory, canonicalComposePath) ||
      resolvedComposePaths.has(canonicalComposePath)
    ) {
      fail('preflight');
    }
    resolvedComposePaths.add(canonicalComposePath);
    resolvedComposeFiles.push(canonicalComposePath);
  }

  await requirePrivateRegularFile(config.composeEnvFile, 'preflight');

  let restoreInputBytes = 0;
  for (const input of config.restoreInputs) {
    await requireNoSymlinkAncestors(input.path, 'preflight');
    let info;
    try {
      info = await lstat(input.path, { bigint: true });
    } catch {
      fail('preflight');
    }
    if (
      !info.isFile() ||
      info.nlink !== 1n ||
      (typeof process.getuid === 'function' &&
        process.getuid() !== 0 &&
        info.uid !== BigInt(process.getuid())) ||
      (info.mode & 0o022n) !== 0n ||
      (info.mode & 0o400n) === 0n ||
      info.size === 0n ||
      info.size > BigInt(MAX_RESTORE_INPUT_BYTES) ||
      restoreInputBytes + Number(info.size) > MAX_RESTORE_INPUT_TOTAL_BYTES
    ) {
      fail('preflight');
    }
    restoreInputBytes += Number(info.size);
  }

  if (
    config.reminderDatabaseEnabled &&
    postgresDumpTransport(config) === 'native'
  ) {
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
    const resolvedCaptureRoot = await realpath(config.captureRoot);
    const resolvedCaptureRootInfo = await lstat(resolvedCaptureRoot, {
      bigint: true,
    });
    if (
      !resolvedCaptureRootInfo.isDirectory() ||
      !sameDirectoryIdentity(captureRootInfo, resolvedCaptureRootInfo)
    ) {
      fail('preflight');
    }
    return {
      projectDirectory,
      composeFiles: resolvedComposeFiles,
      composeEnvFile: await realpath(config.composeEnvFile),
      captureRoot: resolvedCaptureRoot,
      captureRootIdentity: directoryIdentity(resolvedCaptureRootInfo),
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

async function readPostgresServiceTarget(path, serviceName) {
  let contents;
  try {
    contents = await readFile(path, 'utf8');
  } catch {
    fail('preflight');
  }
  let inService = false;
  const values = new Map();
  for (const rawLine of contents.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#') || line.startsWith(';')) continue;
    if (/^(?:include|include_if_exists|include_dir)\s*=/iu.test(line)) {
      fail('preflight');
    }
    const section = /^\[([^\]]+)\]$/u.exec(line);
    if (section) {
      inService = section[1] === serviceName;
      continue;
    }
    if (!inService) continue;
    const entry = /^([a-z][a-z0-9_]*)\s*=\s*(.*?)\s*$/iu.exec(line);
    if (!entry || values.has(entry[1].toLowerCase())) fail('preflight');
    values.set(entry[1].toLowerCase(), entry[2]);
  }
  const host = values.get('host');
  const port = values.get('port') ?? '5432';
  const database = values.get('dbname');
  const supportedOptions = new Set([
    'host',
    'port',
    'dbname',
    'user',
    'sslmode',
    'sslrootcert',
    'sslcert',
    'sslkey',
    'connect_timeout',
    'application_name',
  ]);
  if (
    [...values.keys()].some((key) => !supportedOptions.has(key)) ||
    !host ||
    !/^\d{1,5}$/u.test(port) ||
    Number(port) < 1 ||
    Number(port) > 65535 ||
    !database
  ) {
    fail('preflight');
  }
  return { host: host.toLowerCase(), port: String(Number(port)), database };
}

function composeArgs(config, paths, args) {
  return [
    'compose',
    '--project-name',
    config.projectName,
    '--project-directory',
    paths.projectDirectory,
    '--env-file',
    paths.composeEnvFile,
    ...paths.composeFiles.flatMap((composeFile) => ['-f', composeFile]),
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
    if (postgresDumpTransport(config) !== 'native') {
      return { PATH: FIXED_PATH, HOME: process.env.HOME ?? '/' };
    }
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

function postgresDumpTransport(config) {
  return config.postgresDumpTransport ?? 'native';
}

function postgresDockerOptions(config, paths, runtimeEnv, signal) {
  return {
    cwd: paths.projectDirectory,
    env: commandEnvironment(config, paths, runtimeEnv, 'docker'),
    signal,
    timeoutMs: COMMAND_TIMEOUT_MS,
  };
}

async function inspectPostgresContainer(
  config,
  paths,
  runtimeEnv,
  deps,
  stage,
  signal,
  expectedIdentity,
) {
  const target = config.postgresContainer;
  const options = postgresDockerOptions(config, paths, runtimeEnv, signal);
  const listing = await runCommand(
    deps,
    'docker',
    [
      'ps',
      '--all',
      '--filter',
      `label=com.docker.compose.project=${target.projectName}`,
      '--filter',
      `label=com.docker.compose.service=${target.serviceName}`,
      '--format',
      'json',
    ],
    options,
    stage,
  );
  const records = parseJsonLines(listing, stage);
  if (records.length !== 1) fail(stage);
  const listedId = records[0].ID ?? records[0].Id ?? records[0].id;
  if (
    typeof listedId !== 'string' ||
    !/^[a-f0-9]{12,64}$/u.test(listedId) ||
    String(records[0].State ?? records[0].state ?? '').toLowerCase() !==
      'running'
  ) {
    fail(stage);
  }

  const id = await runCommand(
    deps,
    'docker',
    ['inspect', '--format', '{{.Id}}', listedId],
    options,
    stage,
  );
  const fullId = id.trim();
  if (!/^[a-f0-9]{64}$/u.test(fullId) || !fullId.startsWith(listedId)) {
    fail(stage);
  }

  const labels = await inspectJson(
    config,
    paths,
    runtimeEnv,
    deps,
    fullId,
    '{{json .Config.Labels}}',
    stage,
    signal,
  );
  const configuredImage = (
    await runCommand(
      deps,
      'docker',
      ['inspect', '--format', '{{.Config.Image}}', fullId],
      options,
      stage,
    )
  ).trim();
  const imageId = (
    await runCommand(
      deps,
      'docker',
      ['inspect', '--format', '{{.Image}}', fullId],
      options,
      stage,
    )
  ).trim();
  const expectedImageId = (
    await runCommand(
      deps,
      'docker',
      ['image', 'inspect', '--format', '{{.Id}}', target.image],
      options,
      stage,
    )
  ).trim();
  const state = await inspectJson(
    config,
    paths,
    runtimeEnv,
    deps,
    fullId,
    '{{json .State}}',
    stage,
    signal,
  );

  if (
    !isRecord(labels) ||
    labels['com.docker.compose.project'] !== target.projectName ||
    labels['com.docker.compose.service'] !== target.serviceName ||
    configuredImage !== target.image ||
    !/^sha256:[a-f0-9]{64}$/u.test(imageId) ||
    imageId !== expectedImageId ||
    !isRecord(state) ||
    state.Running !== true ||
    String(state.Status).toLowerCase() !== 'running'
  ) {
    fail(stage);
  }

  const identity = {
    id: fullId,
    image: configuredImage,
    imageId,
    projectName: target.projectName,
    serviceName: target.serviceName,
  };
  if (
    expectedIdentity &&
    Object.keys(identity).some((key) => identity[key] !== expectedIdentity[key])
  ) {
    fail(stage);
  }
  return identity;
}

function validatePostgresVersion(output, tool, stage) {
  const version = output.trim();
  if (
    !version.startsWith(`${tool} (PostgreSQL) `) ||
    !SAFE_POSTGRES_VERSION.test(version)
  ) {
    fail(stage);
  }
  return version;
}

async function postgresToolVersion(
  config,
  paths,
  runtimeEnv,
  deps,
  tool,
  args,
  stage,
  signal,
) {
  const output = await runCommand(
    deps,
    tool,
    args,
    {
      env: commandEnvironment(config, paths, runtimeEnv, 'postgres'),
      signal,
    },
    stage,
  );
  return validatePostgresVersion(output, tool, stage);
}

async function dockerExecPostgresVersion(
  config,
  paths,
  runtimeEnv,
  deps,
  containerId,
  stage,
  signal,
) {
  const output = await runCommand(
    deps,
    'docker',
    [
      'exec',
      containerId,
      '/usr/bin/env',
      '-i',
      `PATH=${POSTGRES_CONTAINER_PATH}`,
      'pg_dump',
      '--version',
    ],
    postgresDockerOptions(config, paths, runtimeEnv, signal),
    stage,
  );
  return validatePostgresVersion(output, 'pg_dump', stage);
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

  let postgresPreflight;
  if (config.reminderDatabaseEnabled) {
    const transport = postgresDumpTransport(config);
    const containerIdentity =
      transport === 'container-exec'
        ? await inspectPostgresContainer(
            config,
            paths,
            runtimeEnv,
            deps,
            'preflight',
            signal,
          )
        : undefined;
    const pgDumpVersion =
      transport === 'native'
        ? await postgresToolVersion(
            config,
            paths,
            runtimeEnv,
            deps,
            'pg_dump',
            ['--version'],
            'preflight',
            signal,
          )
        : await dockerExecPostgresVersion(
            config,
            paths,
            runtimeEnv,
            deps,
            containerIdentity.id,
            'preflight',
            signal,
          );
    const pgRestoreVersion = await postgresToolVersion(
      config,
      paths,
      runtimeEnv,
      deps,
      'pg_restore',
      ['--version'],
      'preflight',
      signal,
    );
    postgresPreflight = {
      transport,
      pgDumpVersion,
      pgRestoreVersion,
      ...(containerIdentity ? { containerIdentity } : {}),
    };
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
  return postgresPreflight;
}

export const ONLINE_STORE_INVENTORY_SCRIPT = `
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const keys = [
  'MATRIX_CALENDAR_PRIVATE_CLIENT_DATABASE_URL',
  'MATRIX_CALENDAR_BINDING_DATABASE_URL',
  'MATRIX_CALENDAR_REMINDER_DATABASE_URL',
];
const databases = [];
for (const key of keys) {
  const value = process.env[key];
  if (!value) continue;
  let parsed;
  try { parsed = new URL(value); } catch { process.exit(2); }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname || !parsed.pathname || parsed.pathname === '/') process.exit(2);
  if (parsed.hostname.includes(',') || parsed.searchParams.has('target_session_attrs') || process.env.PGTARGETSESSIONATTRS) process.exit(2);
  let database;
  try { database = decodeURIComponent(parsed.pathname.slice(1)); } catch { process.exit(2); }
  if (!database || parsed.pathname.slice(1).includes('/')) process.exit(2);
  databases.push({ key, host: parsed.hostname.toLowerCase(), port: parsed.port || '5432', database });
}
const known = new Set(keys);
const unknownDatabaseSettings = Object.keys(process.env).filter((key) => /DATABASE_URL$/u.test(key) && !known.has(key));
let publicFeedKeySha256 = null;
const directKey = process.env.MATRIX_CALENDAR_PUBLIC_FEED_SIGNING_KEY;
const keyFile = process.env.MATRIX_CALENDAR_PUBLIC_FEED_SIGNING_KEY_FILE;
if (directKey && keyFile) process.exit(2);
if (directKey || keyFile) {
  let encoded = directKey;
  try { if (keyFile) encoded = readFileSync(keyFile, 'utf8').replace(/\\r?\\n$/u, ''); } catch { process.exit(2); }
  if (!/^[A-Za-z0-9_-]{43}$/u.test(encoded || '')) process.exit(2);
  const key = Buffer.from(encoded, 'base64url');
  if (key.length !== 32 || key.toString('base64url') !== encoded) process.exit(2);
  publicFeedKeySha256 = createHash('sha256').update(key).digest('hex');
}
process.stdout.write(JSON.stringify({
  databases,
  unknownDatabaseSettings,
  publicFeedEnabled: Boolean(process.env.MATRIX_CALENDAR_PUBLIC_FEED_ORIGIN),
  publicFeedKeySha256,
}));
`;

async function onlineStoreInventory(
  config,
  paths,
  deps,
  runtimeEnv,
  ids,
  signal,
) {
  const output = await runCommand(
    deps,
    'docker',
    ['exec', ids.server, 'node', '-e', ONLINE_STORE_INVENTORY_SCRIPT],
    {
      cwd: paths.projectDirectory,
      env: commandEnvironment(config, paths, runtimeEnv, 'docker'),
      signal,
      timeoutMs: COMMAND_TIMEOUT_MS,
    },
    'preflight',
  );
  let inventory;
  try {
    inventory = JSON.parse(output);
  } catch {
    fail('preflight');
  }
  if (
    !isRecord(inventory) ||
    !Array.isArray(inventory.databases) ||
    !Array.isArray(inventory.unknownDatabaseSettings) ||
    typeof inventory.publicFeedEnabled !== 'boolean' ||
    !(
      inventory.publicFeedKeySha256 === null ||
      /^[a-f0-9]{64}$/u.test(inventory.publicFeedKeySha256)
    ) ||
    inventory.unknownDatabaseSettings.length > 0
  ) {
    fail('preflight');
  }
  const targets = new Set();
  for (const database of inventory.databases) {
    if (
      !isRecord(database) ||
      ![
        'MATRIX_CALENDAR_PRIVATE_CLIENT_DATABASE_URL',
        'MATRIX_CALENDAR_BINDING_DATABASE_URL',
        'MATRIX_CALENDAR_REMINDER_DATABASE_URL',
      ].includes(database.key) ||
      typeof database.host !== 'string' ||
      database.host === '' ||
      typeof database.port !== 'string' ||
      !/^\d{1,5}$/u.test(database.port) ||
      typeof database.database !== 'string' ||
      database.database === ''
    ) {
      fail('preflight');
    }
    targets.add(
      `${database.host.toLowerCase()}:${String(Number(database.port))}/${database.database}`,
    );
  }
  if (
    targets.size > 1 ||
    inventory.databases.length > 0 !== config.reminderDatabaseEnabled
  ) {
    fail('preflight');
  }
  if (inventory.databases.length > 0) {
    if (postgresDumpTransport(config) !== 'native') fail('preflight');
    const serviceTarget = await readPostgresServiceTarget(
      runtimeEnv.PGSERVICEFILE,
      config.pgService,
    );
    if (
      targets.values().next().value !==
      `${serviceTarget.host}:${serviceTarget.port}/${serviceTarget.database}`
    ) {
      fail('preflight');
    }
  }
  if (inventory.publicFeedEnabled) {
    const keyInput = config.restoreInputs.find(
      (input) => input.name === 'public-feed-signing-key',
    );
    if (!keyInput || !inventory.publicFeedKeySha256) fail('preflight');
    const source = await readRestoreInputSource(keyInput.path, 'preflight');
    const encoded = source.contents.toString('utf8').replace(/\r?\n$/u, '');
    if (!/^[A-Za-z0-9_-]{43}$/u.test(encoded)) fail('preflight');
    const key = Buffer.from(encoded, 'base64url');
    if (
      key.byteLength !== 32 ||
      key.toString('base64url') !== encoded ||
      hashBytes(key) !== inventory.publicFeedKeySha256
    ) {
      fail('preflight');
    }
  }
  return inventory;
}

async function verifyCapturedPublicFeedInput(
  config,
  inventory,
  captureDirectory,
  restoreInputs,
) {
  if (!inventory.publicFeedEnabled) return;
  const configured = config.restoreInputs.find(
    (input) => input.name === 'public-feed-signing-key',
  );
  const captured = restoreInputs.find(
    (input) => input.name === 'public-feed-signing-key',
  );
  if (!configured || !captured) fail('capture');
  let encoded;
  try {
    encoded = (
      await readFile(join(captureDirectory, captured.archiveName), 'utf8')
    ).replace(/\r?\n$/u, '');
  } catch {
    fail('capture');
  }
  if (!/^[A-Za-z0-9_-]{43}$/u.test(encoded)) fail('capture');
  const key = Buffer.from(encoded, 'base64url');
  if (
    key.byteLength !== 32 ||
    key.toString('base64url') !== encoded ||
    hashBytes(key) !== inventory.publicFeedKeySha256
  ) {
    fail('capture');
  }
}

async function checkpointRequest(
  config,
  paths,
  deps,
  runtimeEnv,
  serverId,
  operation,
  leaseId,
  signal,
) {
  const suffix =
    operation === 'acquire' ? 'acquire' : `${leaseId}/${operation}`;
  const script = `
const token = process.env.MATRIX_CHECKPOINT_CONTROL_TOKEN;
if (!token) process.exit(2);
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 5000);
fetch('http://127.0.0.1:3000/v1/internal/backup-checkpoint/${suffix}', { method: 'POST', headers: { 'X-Matrix-Checkpoint-Token': token }, signal: controller.signal })
  .then(async response => { if (!response.ok) process.exit(3); process.stdout.write(JSON.stringify(await response.json())); })
  .catch(() => process.exit(4))
  .finally(() => clearTimeout(timer));
`;
  const output = await runCommand(
    deps,
    'docker',
    ['exec', serverId, 'node', '-e', script],
    {
      cwd: paths.projectDirectory,
      env: commandEnvironment(config, paths, runtimeEnv, 'docker'),
      signal,
      timeoutMs: 10_000,
    },
    'checkpoint',
  );
  try {
    return JSON.parse(output);
  } catch {
    fail('checkpoint');
  }
}

export const RADICALE_LOCK_SCRIPT = `
import fcntl, os, signal, stat, sys, time
lock_path, marker_path, cancel_path = sys.argv[1:4]
timeout_ms = int(sys.argv[4])
deadline = time.monotonic() + timeout_ms / 1000
def cancel_requested():
    if not os.path.exists(cancel_path): return False
    for path in (marker_path, cancel_path):
        try: os.unlink(path)
        except FileNotFoundError: pass
    return True
if cancel_requested(): sys.exit(3)
fd = os.open(lock_path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
if not stat.S_ISREG(os.fstat(fd).st_mode): sys.exit(2)
def process_start_time(pid):
    raw = open('/proc/%d/stat' % pid, encoding='ascii').read()
    fields = raw[raw.rfind(')') + 2:].split()
    return fields[19]
start_time = process_start_time(os.getpid())
with open(marker_path, 'x', encoding='ascii') as marker:
    opened = os.fstat(fd)
    marker.write('waiting:%d:%s:%d:%d:%d\\n' % (os.getpid(), start_time, opened.st_dev, opened.st_ino, fd))
    marker.flush()
while True:
    if cancel_requested() or time.monotonic() >= deadline: sys.exit(3)
    try:
        fcntl.flock(fd, fcntl.LOCK_SH | fcntl.LOCK_NB)
        break
    except BlockingIOError:
        time.sleep(0.1)
if cancel_requested(): sys.exit(3)
opened = os.fstat(fd)
named = os.stat(lock_path, follow_symlinks=False)
if (opened.st_dev, opened.st_ino) != (named.st_dev, named.st_ino):
    sys.exit(2)
remaining = deadline - time.monotonic()
if remaining <= 0: sys.exit(3)
signal.signal(signal.SIGALRM, lambda _signum, _frame: sys.exit(3))
signal.setitimer(signal.ITIMER_REAL, remaining)
with open(marker_path, 'w', encoding='ascii') as marker:
    marker.write('locked:%d:%d:%d:%s:%d\\n' % (os.getpid(), opened.st_dev, opened.st_ino, start_time, fd))
    marker.flush()
while True:
    if cancel_requested(): sys.exit(3)
    remaining = deadline - time.monotonic()
    if remaining <= 0: sys.exit(3)
    time.sleep(min(0.1, remaining))
`;

const RADICALE_PROCESS_CONTROL_SCRIPT = `
import os, signal, sys
mode, pid_text, expected_start_time, expected_dev, expected_ino, expected_fd = sys.argv[1:7]
try:
    pidfd = os.pidfd_open(int(pid_text), 0)
except ProcessLookupError:
    sys.exit(1)
except OSError:
    sys.exit(2)
try:
    try:
        raw = open('/proc/%s/stat' % pid_text, encoding='ascii').read()
    except FileNotFoundError:
        sys.exit(1)
    except OSError:
        sys.exit(2)
    fields = raw[raw.rfind(')') + 2:].split()
    if fields[19] != expected_start_time:
        sys.exit(1)
    try:
        fd_info = os.stat('/proc/%s/fd/%s' % (pid_text, expected_fd))
    except FileNotFoundError:
        sys.exit(1)
    except OSError:
        sys.exit(2)
    if str(fd_info.st_dev) != expected_dev or str(fd_info.st_ino) != expected_ino:
        sys.exit(1)
    if mode == 'signal':
        signal.pidfd_send_signal(pidfd, int(sys.argv[7]))
    elif mode != 'check':
        sys.exit(2)
finally:
    os.close(pidfd)
`;

const RADICALE_LOCK_VERIFY_SCRIPT = `
import os, sys
path, expected_dev, expected_ino = sys.argv[1:4]
info = os.stat(path, follow_symlinks=False)
if (str(info.st_dev), str(info.st_ino)) != (expected_dev, expected_ino): sys.exit(2)
`;

function radicaleRootExecArgs(radicaleId, ...args) {
  return ['exec', '--user', '0', radicaleId, ...args];
}

function radicaleProcessControlArgs(
  radicaleId,
  mode,
  pid,
  startTime,
  identity,
  lockFd,
  signal,
) {
  return radicaleRootExecArgs(
    radicaleId,
    'python3',
    '-c',
    RADICALE_PROCESS_CONTROL_SCRIPT,
    mode,
    pid,
    startTime,
    ...identity.split(':'),
    lockFd,
    ...(signal === undefined ? [] : [String(signal)]),
  );
}

async function acquireRadicaleSharedLock(
  config,
  paths,
  deps,
  runtimeEnv,
  radicaleId,
  lockId,
  maxHoldMs,
  signal,
) {
  const marker = `/tmp/mcw-backup-lock-${lockId}`;
  const cancel = `/tmp/mcw-backup-cancel-${lockId}`;
  if (!/^[A-Za-z0-9-]{1,64}$/u.test(lockId)) fail('radicale-lock');
  try {
    await runCommand(
      deps,
      'docker',
      [
        'exec',
        '--detach',
        '--user',
        '0',
        radicaleId,
        'python3',
        '-c',
        RADICALE_LOCK_SCRIPT,
        '/data/collections/.Radicale.lock',
        marker,
        cancel,
        String(maxHoldMs),
      ],
      {
        cwd: paths.projectDirectory,
        env: commandEnvironment(config, paths, runtimeEnv, 'docker'),
        signal,
        timeoutMs: COMMAND_TIMEOUT_MS,
      },
      'radicale-lock',
    );
  } catch {
    await deps
      .command('docker', radicaleRootExecArgs(radicaleId, 'touch', cancel), {
        cwd: paths.projectDirectory,
        env: commandEnvironment(config, paths, runtimeEnv, 'docker'),
        timeoutMs: COMMAND_TIMEOUT_MS,
      })
      .catch(() => undefined);
    fail('radicale-lock');
  }
  const deadline =
    Date.now() + (deps.radicaleLockStartupTimeoutMs ?? COMMAND_TIMEOUT_MS);
  let pid;
  let identity;
  let holderStartTime;
  let holderFd;
  let acquired = false;
  while (Date.now() < deadline) {
    const result = await deps
      .command('docker', radicaleRootExecArgs(radicaleId, 'cat', marker), {
        cwd: paths.projectDirectory,
        env: commandEnvironment(config, paths, runtimeEnv, 'docker'),
        signal,
        timeoutMs: COMMAND_TIMEOUT_MS,
      })
      .catch(() => ({ status: 1, stdout: '' }));
    const line = result?.stdout?.trim() ?? '';
    const waiting = /^waiting:(\d+):(\d+):(\d+):(\d+):(\d+)$/u.exec(line);
    const locked = /^locked:(\d+):(\d+):(\d+):(\d+):(\d+)$/u.exec(line);
    let startTime;
    if (waiting) {
      pid = waiting[1];
      startTime = waiting[2];
      identity = `${waiting[3]}:${waiting[4]}`;
      holderFd = waiting[5];
    }
    if (locked) {
      pid = locked[1];
      identity = `${locked[2]}:${locked[3]}`;
      startTime = locked[4];
      holderStartTime = startTime;
      holderFd = locked[5];
      acquired = true;
      break;
    }
    if (startTime) holderStartTime = startTime;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  if (!acquired) {
    const cancelResult = await deps
      .command('docker', radicaleRootExecArgs(radicaleId, 'touch', cancel), {
        cwd: paths.projectDirectory,
        env: commandEnvironment(config, paths, runtimeEnv, 'docker'),
        timeoutMs: COMMAND_TIMEOUT_MS,
      })
      .catch(() => ({ status: 1 }));
    if (
      isSuccess(cancelResult) &&
      pid &&
      identity &&
      holderStartTime &&
      holderFd
    ) {
      const cancelDeadline = Date.now() + CHILD_KILL_GRACE_MS;
      let exited = false;
      while (Date.now() < cancelDeadline) {
        const control = await deps
          .command(
            'docker',
            radicaleProcessControlArgs(
              radicaleId,
              'check',
              pid,
              holderStartTime,
              identity,
              holderFd,
            ),
            {
              cwd: paths.projectDirectory,
              env: commandEnvironment(config, paths, runtimeEnv, 'docker'),
            },
          )
          .catch(() => ({ status: 2 }));
        if (control.status === 1) {
          exited = true;
          break;
        }
        if (control.status !== 0) break;
        const signaled = await deps
          .command(
            'docker',
            radicaleProcessControlArgs(
              radicaleId,
              'signal',
              pid,
              holderStartTime,
              identity,
              holderFd,
              15,
            ),
            {
              cwd: paths.projectDirectory,
              env: commandEnvironment(config, paths, runtimeEnv, 'docker'),
            },
          )
          .catch(() => ({ status: 2 }));
        if (signaled.status !== 0 && signaled.status !== 1) break;
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
      }
      if (exited) {
        await deps
          .command(
            'docker',
            radicaleRootExecArgs(radicaleId, 'rm', '-f', marker, cancel),
            {
              cwd: paths.projectDirectory,
              env: commandEnvironment(config, paths, runtimeEnv, 'docker'),
            },
          )
          .catch(() => undefined);
      }
    }
    fail('radicale-lock');
  }
  return {
    async verify() {
      await runCommand(
        deps,
        'docker',
        radicaleProcessControlArgs(
          radicaleId,
          'check',
          pid,
          holderStartTime,
          identity,
          holderFd,
        ),
        {
          cwd: paths.projectDirectory,
          env: commandEnvironment(config, paths, runtimeEnv, 'docker'),
        },
        'radicale-lock',
      );
      const markerContents = await runCommand(
        deps,
        'docker',
        radicaleRootExecArgs(radicaleId, 'cat', marker),
        {
          cwd: paths.projectDirectory,
          env: commandEnvironment(config, paths, runtimeEnv, 'docker'),
        },
        'radicale-lock',
      );
      if (
        markerContents.trim() !==
        `locked:${pid}:${identity}:${holderStartTime}:${holderFd}`
      ) {
        fail('radicale-lock');
      }
      await runCommand(
        deps,
        'docker',
        [
          ...radicaleRootExecArgs(
            radicaleId,
            'python3',
            '-c',
            RADICALE_LOCK_VERIFY_SCRIPT,
            '/data/collections/.Radicale.lock',
            ...identity.split(':'),
          ),
        ],
        {
          cwd: paths.projectDirectory,
          env: commandEnvironment(config, paths, runtimeEnv, 'docker'),
        },
        'radicale-lock',
      );
    },
    async release() {
      const signalResult = await deps
        .command(
          'docker',
          radicaleProcessControlArgs(
            radicaleId,
            'signal',
            pid,
            holderStartTime,
            identity,
            holderFd,
            15,
          ),
          {
            cwd: paths.projectDirectory,
            env: commandEnvironment(config, paths, runtimeEnv, 'docker'),
          },
        )
        .catch(() => ({ status: 2 }));
      if (signalResult.status === 1) {
        const processState = await deps
          .command(
            'docker',
            radicaleProcessControlArgs(
              radicaleId,
              'check',
              pid,
              holderStartTime,
              identity,
              holderFd,
            ),
            {
              cwd: paths.projectDirectory,
              env: commandEnvironment(config, paths, runtimeEnv, 'docker'),
            },
          )
          .catch(() => ({ status: 2 }));
        if (processState.status !== 1) fail('radicale-lock');
        await runCommand(
          deps,
          'docker',
          radicaleRootExecArgs(radicaleId, 'rm', '-f', marker, cancel),
          {
            cwd: paths.projectDirectory,
            env: commandEnvironment(config, paths, runtimeEnv, 'docker'),
          },
          'radicale-lock',
        );
        fail('radicale-lock');
      }
      if (!isSuccess(signalResult)) fail('radicale-lock');
      const deadline = Date.now() + COMMAND_TIMEOUT_MS;
      let exited = false;
      while (Date.now() < deadline) {
        const check = await deps
          .command(
            'docker',
            radicaleProcessControlArgs(
              radicaleId,
              'check',
              pid,
              holderStartTime,
              identity,
              holderFd,
            ),
            {
              cwd: paths.projectDirectory,
              env: commandEnvironment(config, paths, runtimeEnv, 'docker'),
            },
          )
          .catch(() => ({ status: 2 }));
        if (check.status === 1) {
          exited = true;
          break;
        }
        if (check.status !== 0) fail('radicale-lock');
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
      }
      if (!exited) fail('radicale-lock');
      await runCommand(
        deps,
        'docker',
        radicaleRootExecArgs(radicaleId, 'rm', '-f', marker, cancel),
        {
          cwd: paths.projectDirectory,
          env: commandEnvironment(config, paths, runtimeEnv, 'docker'),
        },
        'radicale-lock',
      );
    },
    identity,
  };
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

function isPrivateOwnedDirectory(info) {
  return (
    info.isDirectory() &&
    (info.mode & 0o077n) === 0n &&
    (typeof process.getuid !== 'function' ||
      info.uid === BigInt(process.getuid()))
  );
}

async function currentCaptureDirectoryIdentity(
  paths,
  captureDirectory,
  runName,
  expectedCaptureIdentity,
) {
  await requireNoSymlinkAncestors(captureDirectory, 'verification');
  if (
    captureDirectory !== join(paths.captureRoot, runName) ||
    dirname(captureDirectory) !== paths.captureRoot ||
    basename(captureDirectory) !== runName
  ) {
    fail('verification');
  }

  let resolvedRoot;
  let resolvedCapture;
  let rootInfo;
  let captureInfo;
  try {
    [resolvedRoot, resolvedCapture, rootInfo, captureInfo] = await Promise.all([
      realpath(paths.captureRoot),
      realpath(captureDirectory),
      lstat(paths.captureRoot, { bigint: true }),
      lstat(captureDirectory, { bigint: true }),
    ]);
  } catch {
    fail('verification');
  }

  if (
    resolvedRoot !== paths.captureRoot ||
    resolvedCapture !== captureDirectory ||
    !isPrivateOwnedDirectory(rootInfo) ||
    !sameDirectoryIdentity(rootInfo, paths.captureRootIdentity) ||
    !isPrivateOwnedDirectory(captureInfo) ||
    (expectedCaptureIdentity !== undefined &&
      !sameDirectoryIdentity(captureInfo, expectedCaptureIdentity))
  ) {
    fail('verification');
  }

  return directoryIdentity(captureInfo);
}

function fileIdentity(info) {
  return {
    dev: info.dev,
    ino: info.ino,
    uid: info.uid,
    mode: info.mode,
    nlink: info.nlink,
    size: info.size,
    mtimeNs: info.mtimeNs,
    ctimeNs: info.ctimeNs,
  };
}

function sameFileIdentity(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.uid === right.uid &&
    left.mode === right.mode &&
    left.nlink === right.nlink &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

async function captureFileIdentities(captureDirectory, expectedNames) {
  let entries;
  try {
    entries = await readdir(captureDirectory);
  } catch {
    fail('verification');
  }
  const sortedEntries = [...entries].sort();
  const sortedExpected = [...expectedNames].sort();
  if (
    sortedEntries.length !== sortedExpected.length ||
    sortedEntries.some((name, index) => name !== sortedExpected[index])
  ) {
    fail('verification');
  }

  const identities = new Map();
  for (const name of expectedNames) {
    let info;
    try {
      info = await lstat(join(captureDirectory, name), { bigint: true });
    } catch {
      fail('verification');
    }
    if (
      !info.isFile() ||
      info.nlink !== 1n ||
      (info.mode & 0o077n) !== 0n ||
      (typeof process.getuid === 'function' &&
        info.uid !== BigInt(process.getuid())) ||
      info.size === 0n
    ) {
      fail('verification');
    }
    identities.set(name, fileIdentity(info));
  }
  return identities;
}

async function localCaptureProof(
  paths,
  captureDirectory,
  runName,
  expectedCaptureIdentity,
  expectedNames,
  markerContent = COLD_CAPTURE_MARKER_CONTENT,
) {
  const captureIdentity = await currentCaptureDirectoryIdentity(
    paths,
    captureDirectory,
    runName,
    expectedCaptureIdentity,
  );
  const files = await captureFileIdentities(captureDirectory, expectedNames);
  let marker;
  try {
    marker = await readFile(
      join(captureDirectory, CAPTURE_MARKER_NAME),
      'utf8',
    );
  } catch {
    fail('verification');
  }
  if (marker !== markerContent) fail('verification');
  return { captureIdentity, files };
}

function sameCaptureProof(left, right, expectedNames) {
  if (!sameDirectoryIdentity(left.captureIdentity, right.captureIdentity)) {
    return false;
  }
  return expectedNames.every((name) => {
    const expected = left.files.get(name);
    const current = right.files.get(name);
    return (
      expected !== undefined &&
      current !== undefined &&
      sameFileIdentity(expected, current)
    );
  });
}

function captureFileNames(hasDatabase, restoreInputs = []) {
  return [
    ...ARCHIVE_NAMES,
    ...(hasDatabase ? [DUMP_NAME] : []),
    ...restoreInputs.map((input) => input.archiveName),
    CAPTURE_MANIFEST_NAME,
    CHECKSUM_NAME,
    CAPTURE_MARKER_NAME,
  ];
}

function resticSnapshotId(backupOutput) {
  const records = parseJsonLines(backupOutput, 'verification');
  const summaries = records.filter(
    (record) => record.message_type === 'summary',
  );
  const summary = records.at(-1);
  if (
    summaries.length !== 1 ||
    summary?.message_type !== 'summary' ||
    summary.dry_run === true ||
    typeof summary.snapshot_id !== 'string' ||
    !SNAPSHOT_ID.test(summary.snapshot_id)
  ) {
    fail('verification');
  }
  return summary.snapshot_id;
}

function restoreInputsFromManifest(contents) {
  let manifest;
  try {
    manifest = JSON.parse(contents);
  } catch {
    fail('verification');
  }
  if (!isRecord(manifest) || manifest.schemaVersion !== 1) {
    fail('verification');
  }
  const inputs = manifest.restoreInputs ?? [];
  if (!Array.isArray(inputs) || inputs.length > MAX_RESTORE_INPUTS) {
    fail('verification');
  }
  let totalBytes = 0;
  const names = new Set();
  const paths = new Set();
  for (let index = 0; index < inputs.length; index += 1) {
    const input = inputs[index];
    const expectedArchiveName = `${RESTORE_INPUT_PREFIX}${String(index).padStart(4, '0')}.bin`;
    if (
      !isRecord(input) ||
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
      !SAFE_RESTORE_INPUT_NAME.test(input.name) ||
      typeof input.sourcePath !== 'string' ||
      !isSafePath(input.sourcePath) ||
      resolve(input.sourcePath) !== input.sourcePath ||
      input.archiveName !== expectedArchiveName ||
      !Number.isInteger(input.mode) ||
      input.mode < 0 ||
      input.mode > 0o777 ||
      !Number.isSafeInteger(input.sourceUid) ||
      input.sourceUid < 0 ||
      !Number.isSafeInteger(input.sourceGid) ||
      input.sourceGid < 0 ||
      !Number.isSafeInteger(input.size) ||
      input.size < 1 ||
      input.size > MAX_RESTORE_INPUT_BYTES ||
      typeof input.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(input.sha256) ||
      names.has(input.name) ||
      paths.has(input.sourcePath) ||
      totalBytes + input.size > MAX_RESTORE_INPUT_TOTAL_BYTES
    ) {
      fail('verification');
    }
    names.add(input.name);
    paths.add(input.sourcePath);
    totalBytes += input.size;
  }
  return inputs;
}

function verifyResticListing(
  listingOutput,
  snapshotId,
  config,
  captureDirectory,
  expectedNames,
  captureProof,
) {
  const records = parseJsonLines(listingOutput, 'verification');
  if (records.length !== expectedNames.length + 2) fail('verification');
  const snapshot = records[0];
  if (
    snapshot.message_type !== 'snapshot' ||
    snapshot.id !== snapshotId ||
    snapshot.hostname !== config.resticHost ||
    !Array.isArray(snapshot.paths) ||
    snapshot.paths.length !== 1 ||
    snapshot.paths[0] !== captureDirectory ||
    !Array.isArray(snapshot.tags)
  ) {
    fail('verification');
  }

  const actualTags = [...snapshot.tags].sort();
  const expectedTags = [...config.resticTags].sort();
  if (
    actualTags.length !== expectedTags.length ||
    actualTags.some((tag, index) => tag !== expectedTags[index])
  ) {
    fail('verification');
  }

  const nodes = records.slice(1);
  if (nodes.some((node) => node.message_type !== 'node')) {
    fail('verification');
  }
  const nodesByPath = new Map();
  for (const node of nodes) {
    if (typeof node.path !== 'string' || nodesByPath.has(node.path)) {
      fail('verification');
    }
    nodesByPath.set(node.path, node);
  }
  if (nodesByPath.size !== expectedNames.length + 1) fail('verification');

  const directoryNode = nodesByPath.get(captureDirectory);
  if (directoryNode?.type !== 'dir') fail('verification');
  for (const name of expectedNames) {
    const node = nodesByPath.get(join(captureDirectory, name));
    const fileIdentity = captureProof.files.get(name);
    if (
      node?.type !== 'file' ||
      !Number.isSafeInteger(node.size) ||
      BigInt(node.size) !== fileIdentity?.size
    ) {
      fail('verification');
    }
  }
}

async function verifyResticSnapshot(
  snapshotId,
  config,
  paths,
  runtimeEnv,
  deps,
  signal,
  captureDirectory,
  expectedNames,
  captureProof,
  markerContent = COLD_CAPTURE_MARKER_CONTENT,
) {
  const commandOptions = {
    env: commandEnvironment(config, paths, runtimeEnv, 'restic'),
    signal,
    timeoutMs: UPLOAD_TIMEOUT_MS,
  };
  const listing = await runCommand(
    deps,
    'restic',
    ['ls', '--json', '--recursive', snapshotId, captureDirectory],
    commandOptions,
    'verification',
  );
  verifyResticListing(
    listing,
    snapshotId,
    config,
    captureDirectory,
    expectedNames,
    captureProof,
  );

  const marker = await runCommand(
    deps,
    'restic',
    ['dump', snapshotId, join(captureDirectory, CAPTURE_MARKER_NAME)],
    commandOptions,
    'verification',
  );
  if (marker !== markerContent) fail('verification');

  let manifestContents;
  try {
    manifestContents = await readFile(
      join(captureDirectory, CAPTURE_MANIFEST_NAME),
      'utf8',
    );
  } catch {
    fail('verification');
  }
  const archivedManifest = await runCommand(
    deps,
    'restic',
    ['dump', snapshotId, join(captureDirectory, CAPTURE_MANIFEST_NAME)],
    commandOptions,
    'verification',
  );
  if (archivedManifest !== manifestContents) fail('verification');
  const restoreInputs = restoreInputsFromManifest(manifestContents);
  await verifyRestoreInputSources(restoreInputs);
  for (const input of restoreInputs) {
    const readbackPath = join(
      captureDirectory,
      `.${input.archiveName}.${randomUUID()}.partial`,
    );
    try {
      await runCommand(
        deps,
        'restic',
        ['dump', snapshotId, join(captureDirectory, input.archiveName)],
        { ...commandOptions, stdoutPath: readbackPath },
        'verification',
      );
      const info = await lstat(readbackPath, { bigint: true });
      if (
        !info.isFile() ||
        info.nlink !== 1n ||
        (info.mode & 0o077n) !== 0n ||
        info.size !== BigInt(input.size) ||
        (typeof process.getuid === 'function' &&
          info.uid !== BigInt(process.getuid())) ||
        (await hashFile(readbackPath, 'verification')) !== input.sha256
      ) {
        fail('verification');
      }
    } finally {
      try {
        await unlink(readbackPath);
      } catch (error) {
        if (error?.code !== 'ENOENT') fail('verification');
      }
    }
  }
}

async function removeVerifiedCapture(
  paths,
  captureDirectory,
  runName,
  expectedNames,
  captureProof,
  markerContent = COLD_CAPTURE_MARKER_CONTENT,
) {
  const currentProof = await localCaptureProof(
    paths,
    captureDirectory,
    runName,
    captureProof.captureIdentity,
    expectedNames,
    markerContent,
  );
  if (!sameCaptureProof(captureProof, currentProof, expectedNames)) {
    fail('verification');
  }

  const removalOrder = expectedNames.filter(
    (name) => name !== CAPTURE_MARKER_NAME,
  );
  removalOrder.push(CAPTURE_MARKER_NAME);
  try {
    for (const name of removalOrder) {
      await unlink(join(captureDirectory, name));
    }
    await rmdir(captureDirectory);
  } catch {
    fail('verification');
  }
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
  postgresPreflight,
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
    return { enabled: false };
  }

  const partialPath = join(captureDirectory, DUMP_PARTIAL_NAME);
  const finalPath = join(captureDirectory, DUMP_NAME);
  const env = commandEnvironment(config, paths, runtimeEnv, 'postgres');
  try {
    if (postgresPreflight?.transport === 'native') {
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
    } else if (postgresPreflight?.transport === 'container-exec') {
      await inspectPostgresContainer(
        config,
        paths,
        runtimeEnv,
        deps,
        'database',
        signal,
        postgresPreflight.containerIdentity,
      );
      const currentVersion = await dockerExecPostgresVersion(
        config,
        paths,
        runtimeEnv,
        deps,
        postgresPreflight.containerIdentity.id,
        'database',
        signal,
      );
      if (currentVersion !== postgresPreflight.pgDumpVersion) {
        fail('database');
      }
      await inspectPostgresContainer(
        config,
        paths,
        runtimeEnv,
        deps,
        'database',
        signal,
        postgresPreflight.containerIdentity,
      );
      await runCommand(
        deps,
        'docker',
        [
          'exec',
          postgresPreflight.containerIdentity.id,
          '/usr/bin/env',
          '-i',
          `PATH=${POSTGRES_CONTAINER_PATH}`,
          'PGPASSFILE=/dev/null/.pgpass',
          'PGSERVICEFILE=/dev/null',
          'pg_dump',
          '--no-password',
          '--host=/var/run/postgresql',
          '--format=custom',
          `--username=${config.postgresContainer.username}`,
          `--dbname=${config.postgresContainer.database}`,
        ],
        {
          ...postgresDockerOptions(config, paths, runtimeEnv, signal),
          timeoutMs: CAPTURE_TIMEOUT_MS,
          stdoutPath: partialPath,
          captureStderr: true,
        },
        'database',
        true,
      );
      await inspectPostgresContainer(
        config,
        paths,
        runtimeEnv,
        deps,
        'database',
        signal,
        postgresPreflight.containerIdentity,
      );
    } else {
      fail('database');
    }

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
    await rename(partialPath, finalPath);
  } catch {
    try {
      await unlink(partialPath);
    } catch (error) {
      if (error?.code !== 'ENOENT') fail('database');
    }
    fail('database');
  }
  return {
    enabled: true,
    format: 'custom',
    transport: postgresPreflight.transport,
    pgDumpVersion: postgresPreflight.pgDumpVersion,
    pgRestoreVersion: postgresPreflight.pgRestoreVersion,
  };
}

function archiveCommand(config, volumeName, captureMode = 'cold') {
  const excludes =
    captureMode === 'online' && volumeName.endsWith('_radicale-data')
      ? ['--exclude=.Radicale.cache', '--exclude=.Radicale.tmp-*']
      : [];
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
    ...excludes,
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
  captureMode,
  signal,
) {
  const partialPath = join(captureDirectory, `${archiveName}.partial`);
  await runCommand(
    deps,
    'docker',
    archiveCommand(config, volumeName, captureMode),
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

function hashBytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function captureRestoreInputs(config, captureDirectory) {
  const captured = [];
  let totalBytes = 0;
  for (let index = 0; index < config.restoreInputs.length; index += 1) {
    const input = config.restoreInputs[index];
    const source = await readRestoreInputSource(input.path, 'capture');
    const size = source.contents.length;
    if (totalBytes + size > MAX_RESTORE_INPUT_TOTAL_BYTES) fail('capture');
    const archiveName = `${RESTORE_INPUT_PREFIX}${String(index).padStart(4, '0')}.bin`;
    const destination = join(captureDirectory, archiveName);
    await writeFile(destination, source.contents, { flag: 'wx', mode: 0o600 });
    const copyInfo = await lstat(destination, { bigint: true });
    const sha256 = hashBytes(source.contents);
    if (
      !copyInfo.isFile() ||
      copyInfo.nlink !== 1n ||
      (copyInfo.mode & 0o077n) !== 0n ||
      copyInfo.size !== BigInt(size) ||
      hashBytes(await readFile(destination)) !== sha256
    ) {
      fail('capture');
    }
    totalBytes += size;
    captured.push({
      name: input.name,
      sourcePath: input.path,
      archiveName,
      mode: source.mode,
      sourceUid: source.uid,
      sourceGid: source.gid,
      size,
      sha256,
    });
  }
  return captured;
}

async function readRestoreInputSource(path, stage) {
  await requireNoSymlinkAncestors(path, stage);
  let handle;
  try {
    handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const before = await handle.stat({ bigint: true });
    const pathInfo = await lstat(path, { bigint: true });
    if (
      !before.isFile() ||
      pathInfo.isSymbolicLink() ||
      !sameFileIdentity(fileIdentity(before), fileIdentity(pathInfo)) ||
      before.nlink !== 1n ||
      (typeof process.getuid === 'function' &&
        process.getuid() !== 0 &&
        before.uid !== BigInt(process.getuid())) ||
      (before.mode & 0o022n) !== 0n ||
      (before.mode & 0o400n) === 0n ||
      before.size === 0n ||
      before.size > BigInt(MAX_RESTORE_INPUT_BYTES)
    ) {
      fail(stage);
    }
    const buffer = Buffer.alloc(MAX_RESTORE_INPUT_BYTES + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const result = await handle.read(
        buffer,
        bytesRead,
        buffer.length - bytesRead,
        bytesRead,
      );
      if (result.bytesRead === 0) break;
      bytesRead += result.bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    const currentPathInfo = await lstat(path, { bigint: true });
    if (
      !sameFileIdentity(fileIdentity(before), fileIdentity(after)) ||
      !sameFileIdentity(fileIdentity(after), fileIdentity(currentPathInfo)) ||
      bytesRead !== Number(before.size) ||
      bytesRead > MAX_RESTORE_INPUT_BYTES
    ) {
      fail(stage);
    }
    return {
      contents: buffer.subarray(0, bytesRead),
      mode: Number(before.mode & 0o777n),
      uid: Number(before.uid),
      gid: Number(before.gid),
    };
  } catch (error) {
    if (error instanceof ColdBackupFailure) throw error;
    fail(stage);
  } finally {
    await handle?.close().catch(() => fail(stage));
  }
}

async function verifyRestoreInputSources(inputs) {
  for (const input of inputs) {
    const source = await readRestoreInputSource(
      input.sourcePath,
      'verification',
    );
    if (
      source.contents.length !== input.size ||
      source.mode !== input.mode ||
      source.uid !== input.sourceUid ||
      source.gid !== input.sourceGid ||
      hashBytes(source.contents) !== input.sha256
    ) {
      fail('verification');
    }
  }
}

async function writeCaptureManifest(
  captureDirectory,
  postgresDump,
  restoreInputs,
) {
  const manifest = {
    schemaVersion: 1,
    postgresDump,
    ...(restoreInputs.length > 0 ? { restoreInputs } : {}),
  };
  await createOutputFile(
    join(captureDirectory, CAPTURE_MANIFEST_NAME),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'verification',
  );
}

async function writeChecksums(captureDirectory, postgresDump, restoreInputs) {
  const names = [
    ...ARCHIVE_NAMES,
    ...(postgresDump.enabled ? [DUMP_NAME] : []),
    ...restoreInputs.map((input) => input.archiveName),
    CAPTURE_MANIFEST_NAME,
  ];
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

async function removeIncompleteCapture(paths, captureDirectory) {
  if (!captureDirectory || dirname(captureDirectory) !== paths.captureRoot)
    return;
  let info;
  let entries;
  try {
    info = await lstat(captureDirectory, { bigint: true });
    entries = await readdir(captureDirectory);
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    fail('capture-cleanup');
  }
  if (!isPrivateOwnedDirectory(info)) fail('capture-cleanup');
  for (const name of entries) {
    if (name.includes('/') || name === '.' || name === '..') {
      fail('capture-cleanup');
    }
    const path = join(captureDirectory, name);
    let file;
    try {
      file = await lstat(path);
    } catch {
      fail('capture-cleanup');
    }
    if (!file.isFile() || file.isSymbolicLink()) fail('capture-cleanup');
    try {
      await unlink(path);
    } catch {
      fail('capture-cleanup');
    }
  }
  try {
    await rmdir(captureDirectory);
  } catch {
    fail('capture-cleanup');
  }
}

function runtimeEnvironment(env = process.env) {
  const credentialsDirectory =
    typeof env.CREDENTIALS_DIRECTORY === 'string' &&
    env.CREDENTIALS_DIRECTORY.length > 0
      ? env.CREDENTIALS_DIRECTORY
      : undefined;

  return {
    RESTIC_PASSWORD_FILE:
      env.RESTIC_PASSWORD_FILE ??
      (credentialsDirectory
        ? join(credentialsDirectory, 'restic-password')
        : undefined),
    AWS_SHARED_CREDENTIALS_FILE:
      env.AWS_SHARED_CREDENTIALS_FILE ??
      (credentialsDirectory
        ? join(credentialsDirectory, 's3-credentials')
        : undefined),
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
    radicaleLockStartupTimeoutMs: dependencies.radicaleLockStartupTimeoutMs,
  };
  const runtimeEnv = runtimeEnvironment(deps.env);
  const paths = await validateConfigFiles(config, runtimeEnv);
  const signal = dependencies.signal;
  const lockPath = join(paths.captureRoot, LOCK_NAME);
  await refuseExistingLock(lockPath);
  const postgresPreflight = await dockerPreflight(
    config,
    paths,
    deps,
    runtimeEnv,
    signal,
  ).catch((error) => {
    if (error instanceof ColdBackupFailure) throw error;
    fail('preflight');
  });

  const lockHandle = await acquireLock(lockPath);
  let captureDirectory;
  let captureDirectoryIdentity;
  let stopAttempted = false;
  let onlineLease;
  let radicaleLock;
  let onlineAbortTimer;
  let captureComplete = false;
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
    if (postgresPreflight?.containerIdentity) {
      await inspectPostgresContainer(
        config,
        paths,
        runtimeEnv,
        deps,
        'preflight',
        signal,
        postgresPreflight.containerIdentity,
      );
    }
    const runName = makeRunName(deps.now(), deps.id());
    captureDirectory = join(paths.captureRoot, runName);
    try {
      await mkdir(captureDirectory, { mode: 0o700 });
    } catch {
      fail('capture');
    }
    if (config.cleanupSuccessfulCapture) {
      captureDirectoryIdentity = await currentCaptureDirectoryIdentity(
        paths,
        captureDirectory,
        runName,
      );
    }

    let postgresDump;
    let restoreInputs;
    const captureMode = config.captureMode ?? 'cold';
    const captureMarkerContent =
      captureMode === 'online'
        ? ONLINE_CAPTURE_MARKER_CONTENT
        : COLD_CAPTURE_MARKER_CONTENT;
    if (captureMode === 'online') {
      const inventory = await onlineStoreInventory(
        config,
        paths,
        deps,
        runtimeEnv,
        current,
        signal,
      );
      const leaseAcquiredAt = Date.now();
      const lease = await checkpointRequest(
        config,
        paths,
        deps,
        runtimeEnv,
        current.server,
        'acquire',
        undefined,
        signal,
      );
      if (
        !isRecord(lease) ||
        typeof lease.leaseId !== 'string' ||
        !/^[a-f0-9-]{36}$/u.test(lease.leaseId) ||
        !Number.isSafeInteger(lease.leaseTimeoutMs) ||
        lease.leaseTimeoutMs < 1 ||
        lease.leaseTimeoutMs > 120_000
      ) {
        fail('checkpoint');
      }
      onlineLease = {
        id: lease.leaseId,
        serverId: current.server,
        deadline: leaseAcquiredAt + lease.leaseTimeoutMs,
      };
      const abortController = new AbortController();
      onlineAbortTimer = setTimeout(
        () => abortController.abort(),
        Math.max(1, onlineLease.deadline - Date.now()),
      );
      onlineAbortTimer.unref();
      const onlineSignal = signal
        ? AbortSignal.any([signal, abortController.signal])
        : abortController.signal;
      await checkpointRequest(
        config,
        paths,
        deps,
        runtimeEnv,
        current.server,
        'verify',
        onlineLease.id,
        onlineSignal,
      );
      radicaleLock = await acquireRadicaleSharedLock(
        config,
        paths,
        deps,
        runtimeEnv,
        current.radicale,
        deps.id(),
        Math.max(1, onlineLease.deadline - Date.now()),
        onlineSignal,
      );
      await radicaleLock.verify();
      await checkpointRequest(
        config,
        paths,
        deps,
        runtimeEnv,
        current.server,
        'verify',
        onlineLease.id,
        onlineSignal,
      );
      postgresDump = await capturePostgres(
        config,
        paths,
        runtimeEnv,
        deps,
        captureDirectory,
        onlineSignal,
        postgresPreflight,
      );
      await checkpointRequest(
        config,
        paths,
        deps,
        runtimeEnv,
        current.server,
        'verify',
        onlineLease.id,
        onlineSignal,
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
          'online',
          onlineSignal,
        );
        await checkpointRequest(
          config,
          paths,
          deps,
          runtimeEnv,
          current.server,
          'verify',
          onlineLease.id,
          onlineSignal,
        );
      }
      restoreInputs = await captureRestoreInputs(config, captureDirectory);
      await verifyCapturedPublicFeedInput(
        config,
        inventory,
        captureDirectory,
        restoreInputs,
      );
      await writeCaptureManifest(captureDirectory, postgresDump, restoreInputs);
      await writeChecksums(captureDirectory, postgresDump, restoreInputs);
      await radicaleLock.verify();
      await checkpointRequest(
        config,
        paths,
        deps,
        runtimeEnv,
        current.server,
        'verify',
        onlineLease.id,
        onlineSignal,
      );
      await radicaleLock.release();
      radicaleLock = undefined;
      await checkpointRequest(
        config,
        paths,
        deps,
        runtimeEnv,
        current.server,
        'release',
        onlineLease.id,
        onlineSignal,
      );
      onlineLease = undefined;
      clearTimeout(onlineAbortTimer);
      onlineAbortTimer = undefined;
    } else {
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

      postgresDump = await capturePostgres(
        config,
        paths,
        runtimeEnv,
        deps,
        captureDirectory,
        signal,
        postgresPreflight,
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
          'cold',
          signal,
        );
      }
      restoreInputs = await captureRestoreInputs(config, captureDirectory);
      await writeCaptureManifest(captureDirectory, postgresDump, restoreInputs);
      await writeChecksums(captureDirectory, postgresDump, restoreInputs);
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
    }

    await createOutputFile(
      join(captureDirectory, CAPTURE_MARKER_NAME),
      captureMarkerContent,
      'verification',
    );
    captureComplete = true;

    let expectedCaptureNames;
    let captureProof;
    if (config.cleanupSuccessfulCapture) {
      expectedCaptureNames = captureFileNames(
        postgresDump.enabled,
        restoreInputs,
      );
      captureProof = await localCaptureProof(
        paths,
        captureDirectory,
        runName,
        captureDirectoryIdentity,
        expectedCaptureNames,
        captureMarkerContent,
      );
    }

    const verifySnapshot =
      config.cleanupSuccessfulCapture || restoreInputs.length > 0;
    if (verifySnapshot) {
      expectedCaptureNames = captureFileNames(
        postgresDump.enabled,
        restoreInputs,
      );
      captureProof = await localCaptureProof(
        paths,
        captureDirectory,
        runName,
        captureDirectoryIdentity,
        expectedCaptureNames,
        captureMarkerContent,
      );
    }

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
    if (verifySnapshot) resticArgs.splice(1, 0, '--quiet', '--json');
    const uploadOutput = await runCommand(
      deps,
      'restic',
      resticArgs,
      verifySnapshot
        ? {
            env: commandEnvironment(config, paths, runtimeEnv, 'restic'),
            signal,
            timeoutMs: UPLOAD_TIMEOUT_MS,
          }
        : {
            env: commandEnvironment(config, paths, runtimeEnv, 'restic'),
            signal,
            timeoutMs: UPLOAD_TIMEOUT_MS,
            discardStdout: true,
          },
      'upload',
    );
    if (verifySnapshot) {
      const snapshotId = resticSnapshotId(uploadOutput);
      await verifyResticSnapshot(
        snapshotId,
        config,
        paths,
        runtimeEnv,
        deps,
        signal,
        captureDirectory,
        expectedCaptureNames,
        captureProof,
        captureMarkerContent,
      );
    }

    if (config.resticRetentionEnabled) {
      await runCommand(
        deps,
        'restic',
        [
          'forget',
          '--host',
          config.resticHost,
          '--tag',
          config.resticTags.join(','),
          '--group-by',
          'host,tags',
          '--keep-daily',
          '30',
          '--prune',
        ],
        {
          env: commandEnvironment(config, paths, runtimeEnv, 'restic'),
          signal,
          timeoutMs: UPLOAD_TIMEOUT_MS,
          discardStdout: true,
        },
        'retention',
      );
    }

    if (config.cleanupSuccessfulCapture) {
      await removeVerifiedCapture(
        paths,
        captureDirectory,
        runName,
        expectedCaptureNames,
        captureProof,
        captureMarkerContent,
      );
    }
  } catch (error) {
    failure =
      error instanceof ColdBackupFailure
        ? error
        : new ColdBackupFailure('capture');
  } finally {
    if (onlineAbortTimer) clearTimeout(onlineAbortTimer);
    if (radicaleLock) {
      await radicaleLock.release().catch(() => {
        failure = new ColdBackupFailure('radicale-lock');
      });
    }
    if (onlineLease) {
      await checkpointRequest(
        config,
        paths,
        deps,
        runtimeEnv,
        onlineLease.serverId,
        'release',
        onlineLease.id,
      ).catch(() => {
        failure ??= new ColdBackupFailure('checkpoint');
      });
    }
    if (
      stopAttempted &&
      !(await startServices(config, paths, runtimeEnv, deps))
    ) {
      failure = new ColdBackupFailure('resume');
    }
    if (!captureComplete && (config.captureMode ?? 'cold') === 'online') {
      await removeIncompleteCapture(paths, captureDirectory).catch(() => {
        failure ??= new ColdBackupFailure('capture-cleanup');
      });
    }
    await releaseLock(lockHandle, lockPath).catch((error) => {
      failure =
        error instanceof ColdBackupFailure
          ? error
          : new ColdBackupFailure('lock');
    });
  }

  if (failure) throw failure;
  return config.cleanupSuccessfulCapture
    ? { captureDirectory, captureDirectoryRemoved: true }
    : { captureDirectory };
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
  let config;
  try {
    const configPath = parseConfigArgument(process.argv.slice(2));
    config = await readConfigFile(configPath);
    controller = new AbortController();
    abortForSignal = () => controller.abort();
    process.once('SIGINT', abortForSignal);
    process.once('SIGTERM', abortForSignal);
    await runColdBackup(config, { signal: controller.signal });
    process.stdout.write(
      (config.captureMode ?? 'cold') === 'online'
        ? 'Online backup completed.\n'
        : 'Cold backup completed.\n',
    );
  } catch (error) {
    const stage =
      error instanceof ColdBackupFailure &&
      [
        'configuration',
        'preflight',
        'lock',
        'radicale-lock',
        'checkpoint',
        'capture',
        'capture-cleanup',
        'quiesce',
        'database',
        'archive',
        'verification',
        'checksums',
        'resume',
        'upload',
        'retention',
      ].includes(error.stage)
        ? error.stage
        : 'configuration';
    process.stderr.write(
      stage === 'retention'
        ? `${(config?.captureMode ?? 'cold') === 'online' ? 'Online' : 'Cold'} backup upload completed, but retention failed; inspect the ` +
            'repository and configured scope.\n'
        : `Cold backup failed during ${stage}; inspect host configuration and service state.\n`,
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
