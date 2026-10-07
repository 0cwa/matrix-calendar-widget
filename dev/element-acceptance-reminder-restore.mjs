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

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  inspectStoppedContainerState,
  isPrivateArtifactPath,
  isSafeRestoreTargetPlan,
} from './element-acceptance-reminder-restore-guards.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RADICALE_IMAGE = 'matrix-calendar-widget/radicale-openid:3.8.0.0';
const RADICALE_CREATE_TAR = [
  'import sys,tarfile',
  "with tarfile.open(fileobj=sys.stdout.buffer,mode='w|') as archive:",
  " archive.add('/data',arcname='.',recursive=True)",
].join('\n');
const RADICALE_EXTRACT_TAR = [
  'import posixpath,sys,tarfile',
  'def safe(member):',
  ' name=posixpath.normpath(member.name)',
  " if member.name.startswith('/') or name=='..' or name.startswith('../'): raise ValueError()",
  ' if member.issym() or member.islnk() or not (member.isdir() or member.isfile()): raise ValueError()',
  ' return member',
  "with tarfile.open(fileobj=sys.stdin.buffer,mode='r|*') as archive:",
  ' for member in archive:',
  "  archive.extract(safe(member),'/data')",
].join('\n');
const MAX_COMMAND_BUFFER = 16 * 1024 * 1024;
const MAX_WAIT_MS = 120_000;
const PHASES = new Set([
  'reminder-compose-validation',
  'reminder-postgres-ready',
  'reminder-role-verified',
  'reminder-gateway-migrated',
  'reminder-delivery-snapshot',
  'reminder-gateway-restarted',
  'reminder-restart-delivery-row',
  'restore-quiesced',
  'restore-radicale-backup',
  'restore-postgres-backup',
  'restore-targets-prepared',
  'restore-radicale-ready',
  'restore-postgres-role-ready',
  'restore-gateway-ready',
  'restore-element-ready',
  'restore-delivery-row',
]);

class StageFailure extends Error {
  constructor(phase, details = {}) {
    super('Element reminder acceptance stage failed');
    this.phase = phase;
    this.details = details;
  }
}

function required(name) {
  const value = process.env[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw new StageFailure('reminder-compose-validation');
  }
  return value;
}

function validatePrivatePath(path, runnerTemp) {
  if (!isPrivateArtifactPath(path, runnerTemp)) {
    throw new StageFailure('reminder-compose-validation');
  }
  return resolve(path);
}

let projectName;
let envFile;
let stageFile;
let eventFile;
let deliveryFile;
let runnerTemp;
let radicaleArchivePath;
let postgresDumpPath;
let restoreVolumeName;
let commonComposeArgs;
let failureStageRecorded = false;

function initializeConfiguration() {
  runnerTemp = resolve(required('RUNNER_TEMP'));
  const proposedStageFile = process.env.ELEMENT_ACCEPTANCE_STAGE_FILE;
  if (typeof proposedStageFile === 'string' && isAbsolute(proposedStageFile)) {
    stageFile = validatePrivatePath(proposedStageFile, runnerTemp);
  }

  projectName = required('COMPOSE_PROJECT_NAME');
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/u.test(projectName)) {
    throw new StageFailure('reminder-compose-validation');
  }
  envFile = validatePrivatePath(
    required('ELEMENT_ACCEPTANCE_SERVER_ENV_FILE'),
    runnerTemp,
  );
  stageFile = validatePrivatePath(
    required('ELEMENT_ACCEPTANCE_STAGE_FILE'),
    runnerTemp,
  );
  eventFile = validatePrivatePath(
    required('ELEMENT_ACCEPTANCE_REMINDER_EVENT_FILE'),
    runnerTemp,
  );
  deliveryFile = validatePrivatePath(
    required('ELEMENT_ACCEPTANCE_REMINDER_DELIVERY_FILE'),
    runnerTemp,
  );
  const privatePaths = [envFile, stageFile, eventFile, deliveryFile];
  if (new Set(privatePaths).size !== privatePaths.length) {
    throw new StageFailure('reminder-compose-validation');
  }
  radicaleArchivePath = resolve(runnerTemp, 'element-acceptance-radicale.tar');
  postgresDumpPath = resolve(
    runnerTemp,
    'element-acceptance-reminder.pgcustom',
  );
  restoreVolumeName = required('ELEMENT_ACCEPTANCE_RESTORE_VOLUME_NAME');
  if (restoreVolumeName !== `${projectName}_radicale-restore`) {
    throw new StageFailure('reminder-compose-validation');
  }
  commonComposeArgs = [
    'compose',
    '-p',
    projectName,
    '--env-file',
    envFile,
    '-f',
    'dev/compose.yaml',
    '-f',
    'dev/element-acceptance.compose.yaml',
    '-f',
    'dev/element-acceptance-reminder.compose.yaml',
  ];
}

function appendStage(phase, status, details = {}) {
  if (!stageFile || !PHASES.has(phase)) {
    throw new StageFailure('reminder-compose-validation');
  }
  appendFileSync(
    stageFile,
    `${JSON.stringify({ phase, status, ...details })}\n`,
    { encoding: 'utf8', mode: 0o600 },
  );
}

async function withStage(phase, operation) {
  appendStage(phase, 'started');
  try {
    const details = (await operation()) ?? {};
    appendStage(phase, 'passed', details);
    return details;
  } catch (error) {
    const details = error instanceof StageFailure ? error.details : {};
    appendStage(phase, 'failed', details);
    failureStageRecorded = true;
    throw new StageFailure(phase, details);
  }
}

function run(
  command,
  args,
  { input, timeout = 30_000, maxBuffer = MAX_COMMAND_BUFFER } = {},
) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    input,
    timeout,
    maxBuffer,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return {
    status: Number.isInteger(result.status) ? result.status : 1,
    stdout: result.stdout ?? Buffer.alloc(0),
  };
}

function requireSuccess(result, phase) {
  if (result.status !== 0) {
    throw new StageFailure(phase, {
      processExitCode: result.status > 0 ? result.status : 1,
    });
  }
  return result.stdout;
}

function compose(args, options) {
  return run('docker', [...commonComposeArgs, ...args], options);
}

async function sleep(milliseconds) {
  await new Promise((resolvePromise) =>
    setTimeout(resolvePromise, milliseconds),
  );
}

async function validateCompose() {
  await withStage('reminder-compose-validation', async () => {
    requireSuccess(
      compose(['config', '--quiet']),
      'reminder-compose-validation',
    );
    const rendered = requireSuccess(
      compose(['config', '--format', 'json'], { timeout: 30_000 }),
      'reminder-compose-validation',
    );
    const validation = run(
      process.execPath,
      ['dev/validate-element-acceptance-compose.mjs'],
      { input: rendered, timeout: 10_000, maxBuffer: 1024 * 1024 },
    );
    requireSuccess(validation, 'reminder-compose-validation');
  });
}

function serviceContainerId(service, phase = 'reminder-compose-validation') {
  const output = requireSuccess(compose(['ps', '--all', '-q', service]), phase)
    .toString('utf8')
    .trim()
    .split(/\s+/u)
    .filter(Boolean);
  if (output.length !== 1 || !/^[a-f0-9]{12,64}$/iu.test(output[0])) {
    throw new StageFailure(phase);
  }
  return output[0];
}

function inspectContainer(service, phase = 'restore-quiesced') {
  const id = serviceContainerId(service, phase);
  const stateJson = requireSuccess(
    run('docker', ['inspect', '--format', '{{json .State}}', id]),
    phase,
  );
  let state;
  try {
    state = JSON.parse(stateJson.toString('utf8'));
  } catch {
    throw new StageFailure(phase);
  }
  return {
    status: state.Status,
    exitCode: Number.isInteger(state.ExitCode) ? state.ExitCode : undefined,
    oomKilled:
      typeof state.OOMKilled === 'boolean' ? state.OOMKilled : undefined,
    healthStatus:
      typeof state.Health?.Status === 'string'
        ? state.Health.Status
        : undefined,
  };
}

async function waitForHealth(service) {
  const deadline = Date.now() + MAX_WAIT_MS;
  while (Date.now() < deadline) {
    try {
      const state = inspectContainer(service);
      if (state.status === 'running' && state.healthStatus === 'healthy') {
        return;
      }
      if (state.status === 'exited' || state.status === 'dead') break;
    } catch {
      // Compose may not have created the container yet.
    }
    await sleep(1_000);
  }
  throw new StageFailure('reminder-postgres-ready');
}

async function waitForHttp(url, predicate, phase) {
  const deadline = Date.now() + MAX_WAIT_MS;
  let lastStatus;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        redirect: 'error',
        signal: AbortSignal.timeout(3_000),
      });
      lastStatus = response.status;
      await response.body?.cancel().catch(() => undefined);
      if (predicate(lastStatus)) return lastStatus;
    } catch {
      // A listener can refuse connections while its container starts.
    }
    await sleep(1_000);
  }
  throw new StageFailure(phase, {
    ...(Number.isInteger(lastStatus) ? { httpStatus: lastStatus } : {}),
  });
}

function queryPostgres(
  database,
  query,
  user = 'reminder_bootstrap',
  phase = 'reminder-role-verified',
) {
  const output = requireSuccess(
    compose([
      'exec',
      '-T',
      'postgres',
      'psql',
      '--username',
      user,
      '--dbname',
      database,
      '--no-align',
      '--tuples-only',
      '--field-separator',
      '|',
      '--set',
      'ON_ERROR_STOP=1',
      '--command',
      query,
    ]),
    phase,
  );
  return output.toString('utf8').trim();
}

function verifyRestrictedRole(database, phase) {
  if (
    !['matrix_calendar_test', 'matrix_calendar_restored'].includes(database)
  ) {
    throw new StageFailure(phase);
  }
  const query = [
    'SELECT r.rolcanlogin, r.rolsuper, r.rolcreatedb, r.rolcreaterole,',
    "d.datname, has_database_privilege(r.rolname, 'postgres', 'CONNECT'),",
    "has_database_privilege(r.rolname, 'template1', 'CONNECT')",
    'FROM pg_roles r JOIN pg_database d ON d.datdba = r.oid',
    "WHERE r.rolname = 'matrix_calendar_app' AND d.datname = '" +
      database +
      "';",
  ].join(' ');
  const fields = queryPostgres(
    'postgres',
    query,
    'reminder_bootstrap',
    phase,
  ).split('|');
  const verified =
    fields.length === 7 &&
    fields[0] === 't' &&
    fields[1] === 'f' &&
    fields[2] === 'f' &&
    fields[3] === 'f' &&
    fields[4] === database &&
    fields[5] === 'f' &&
    fields[6] === 'f';
  if (!verified) {
    throw new StageFailure(phase, { rolePolicyVerified: false });
  }
}

async function enableReminderRuntime() {
  await validateCompose();
  await withStage('reminder-postgres-ready', async () => {
    requireSuccess(
      compose(['up', '--no-build', '-d', 'postgres']),
      'reminder-postgres-ready',
    );
    await waitForHealth('postgres');
    return { count: 1 };
  });
  await withStage('reminder-role-verified', async () => {
    verifyRestrictedRole('matrix_calendar_test', 'reminder-role-verified');
    return { rolePolicyVerified: true };
  });
  await withStage('reminder-gateway-migrated', async () => {
    requireSuccess(
      compose(['up', '--no-build', '--force-recreate', '-d', 'gateway']),
      'reminder-gateway-migrated',
    );
    const httpStatus = await waitForHttp(
      'http://127.0.0.1:3000/v1/calendar/context',
      (status) => status >= 400 && status < 500,
      'reminder-gateway-migrated',
    );
    return { httpStatus };
  });
}

function parseDeliveryRow(database) {
  if (
    !['matrix_calendar_test', 'matrix_calendar_restored'].includes(database)
  ) {
    throw new StageFailure('reminder-delivery-snapshot');
  }
  const query = [
    'SELECT delivery_key, state, attempt_count, (sent_at IS NOT NULL),',
    '(claim_token IS NULL), (lease_expires_at IS NULL)',
    'FROM matrix_calendar.reminder_deliveries ORDER BY delivery_key;',
  ].join(' ');
  const output = requireSuccess(
    compose([
      'exec',
      '-T',
      'postgres',
      'psql',
      '--username',
      'matrix_calendar_app',
      '--dbname',
      database,
      '--no-align',
      '--tuples-only',
      '--field-separator',
      '|',
      '--set',
      'ON_ERROR_STOP=1',
      '--command',
      query,
    ]),
    'reminder-delivery-snapshot',
  )
    .toString('utf8')
    .trim();
  const rows = output ? output.split(/\r?\n/u) : [];
  if (rows.length !== 1) return { rows, delivery: undefined };
  const fields = rows[0].split('|');
  if (
    fields.length !== 6 ||
    !/^[a-f0-9]{64}$/u.test(fields[0]) ||
    !['claimed', 'pending', 'sent'].includes(fields[1]) ||
    !/^\d+$/u.test(fields[2]) ||
    !['t', 'f'].includes(fields[3]) ||
    !['t', 'f'].includes(fields[4]) ||
    !['t', 'f'].includes(fields[5])
  ) {
    return { rows, delivery: undefined };
  }
  return {
    rows,
    delivery: {
      deliveryKey: fields[0],
      state: fields[1],
      attemptCount: Number(fields[2]),
      sentAtPresent: fields[3] === 't',
      claimClear: fields[4] === 't' && fields[5] === 't',
    },
  };
}

function readDeliverySnapshot() {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(deliveryFile, 'utf8'));
  } catch {
    throw new StageFailure('reminder-delivery-snapshot');
  }
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    !/^[a-f0-9]{64}$/u.test(parsed.deliveryKey) ||
    !Number.isSafeInteger(parsed.attemptCount) ||
    parsed.attemptCount < 1
  ) {
    throw new StageFailure('reminder-delivery-snapshot');
  }
  return parsed;
}

function deliveryDetails(row, snapshot) {
  const deliveryStateSent = row?.state === 'sent' && row.sentAtPresent;
  const deliveryClaimClear = row?.claimClear === true;
  const deliveryKeyUnchanged = row?.deliveryKey === snapshot.deliveryKey;
  const attemptCountUnchanged = row?.attemptCount === snapshot.attemptCount;
  return {
    count: row ? 1 : 0,
    ...(row ? { attemptCount: row.attemptCount } : {}),
    deliveryStateSent,
    deliveryClaimClear,
    deliveryKeyUnchanged,
    attemptCountUnchanged,
  };
}

async function snapshotDelivery() {
  await withStage('reminder-delivery-snapshot', async () => {
    const { rows, delivery } = parseDeliveryRow('matrix_calendar_test');
    const details = {
      count: delivery ? 1 : 0,
      ...(delivery ? { attemptCount: delivery.attemptCount } : {}),
      deliveryStateSent: delivery?.state === 'sent' && delivery.sentAtPresent,
      deliveryClaimClear: delivery?.claimClear === true,
    };
    if (
      rows.length !== 1 ||
      !delivery ||
      delivery.state !== 'sent' ||
      !delivery.sentAtPresent ||
      !delivery.claimClear ||
      delivery.attemptCount < 1
    ) {
      throw new StageFailure('reminder-delivery-snapshot', details);
    }
    writeFileSync(
      deliveryFile,
      `${JSON.stringify({
        deliveryKey: delivery.deliveryKey,
        attemptCount: delivery.attemptCount,
      })}\n`,
      { encoding: 'utf8', flag: 'wx', mode: 0o600 },
    );
    return details;
  });
}

async function restartGateway() {
  await withStage('reminder-gateway-restarted', async () => {
    requireSuccess(
      compose(['restart', '--timeout', '60', 'gateway']),
      'reminder-gateway-restarted',
    );
    const httpStatus = await waitForHttp(
      'http://127.0.0.1:3000/v1/calendar/context',
      (status) => status >= 400 && status < 500,
      'reminder-gateway-restarted',
    );
    return { httpStatus };
  });
}

async function verifyDelivery(database, phase) {
  await withStage(phase, async () => {
    const snapshot = readDeliverySnapshot();
    const { rows, delivery } = parseDeliveryRow(database);
    const details = deliveryDetails(delivery, snapshot);
    if (
      rows.length !== 1 ||
      !delivery ||
      !details.deliveryStateSent ||
      !details.deliveryClaimClear ||
      !details.deliveryKeyUnchanged ||
      !details.attemptCountUnchanged
    ) {
      throw new StageFailure(phase, details);
    }
    return details;
  });
}

function inspectRadicaleVolume() {
  const id = serviceContainerId('radicale', 'restore-quiesced');
  const output = requireSuccess(
    run('docker', ['inspect', '--format', '{{json .Mounts}}', id]),
    'restore-quiesced',
  );
  let mounts;
  try {
    mounts = JSON.parse(output.toString('utf8'));
  } catch {
    throw new StageFailure('restore-quiesced');
  }
  const dataMounts = Array.isArray(mounts)
    ? mounts.filter((mount) => mount?.Destination === '/data')
    : [];
  if (
    dataMounts.length !== 1 ||
    dataMounts[0].Type !== 'volume' ||
    dataMounts[0].Name !== `${projectName}_radicale-data`
  ) {
    throw new StageFailure('restore-quiesced');
  }
  return dataMounts[0].Name;
}

function stoppedState(service) {
  return inspectStoppedContainerState(
    inspectContainer(service, 'restore-quiesced'),
  );
}

async function quiesceWriters() {
  let radicaleVolume;
  await withStage('restore-quiesced', async () => {
    requireSuccess(
      compose(['stop', '--timeout', '60', 'element', 'widget']),
      'restore-quiesced',
    );
    requireSuccess(
      compose(['stop', '--timeout', '60', 'gateway']),
      'restore-quiesced',
    );
    requireSuccess(
      compose(['stop', '--timeout', '60', 'radicale']),
      'restore-quiesced',
    );
    const states = ['element', 'widget', 'gateway', 'radicale'].map(
      stoppedState,
    );
    radicaleVolume = inspectRadicaleVolume();
    const gatewayStoppedGracefully =
      states[2].stopped && states[2].gracefulExit;
    const radicaleStoppedGracefully =
      states[3].stopped && states[3].gracefulExit;
    const oomFree = states.every((state) => state.oomFree);
    if (
      !states.every((state) => state.accepted) ||
      !gatewayStoppedGracefully ||
      !radicaleStoppedGracefully ||
      !oomFree
    ) {
      throw new StageFailure('restore-quiesced', {
        count: states.filter((state) => state.stopped).length,
        gatewayStoppedGracefully,
        radicaleStoppedGracefully,
        oomFree,
      });
    }
    const synapse = inspectContainer('synapse', 'restore-quiesced');
    const postgres = inspectContainer('postgres', 'restore-quiesced');
    if (
      synapse.status !== 'running' ||
      postgres.status !== 'running' ||
      postgres.healthStatus !== 'healthy'
    ) {
      throw new StageFailure('restore-quiesced', {
        count: states.filter((state) => state.stopped).length,
        gatewayStoppedGracefully,
        radicaleStoppedGracefully,
        oomFree,
      });
    }
    return {
      count: states.filter((state) => state.stopped).length,
      gatewayStoppedGracefully,
      radicaleStoppedGracefully,
      oomFree,
    };
  });
  return radicaleVolume;
}

function hash(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function savePrivateArtifact(path, content, phase) {
  try {
    writeFileSync(path, content, { flag: 'wx', mode: 0o600 });
  } catch {
    throw new StageFailure(phase);
  }
}

function backupRadicale(volumeName) {
  return withStage('restore-radicale-backup', async () => {
    const archive = requireSuccess(
      run(
        'docker',
        [
          'run',
          '--rm',
          '--network',
          'none',
          '--mount',
          `type=volume,src=${volumeName},dst=/data,readonly`,
          '--entrypoint',
          '/app/bin/python',
          RADICALE_IMAGE,
          '-c',
          RADICALE_CREATE_TAR,
        ],
        { timeout: 120_000 },
      ),
      'restore-radicale-backup',
    );
    if (archive.length === 0) {
      throw new StageFailure('restore-radicale-backup');
    }
    savePrivateArtifact(
      radicaleArchivePath,
      archive,
      'restore-radicale-backup',
    );
    return { checksum: hash(archive) };
  });
}

function backupPostgres() {
  return withStage('restore-postgres-backup', async () => {
    const dump = requireSuccess(
      compose(
        [
          'exec',
          '-T',
          'postgres',
          'pg_dump',
          '--format=custom',
          '--no-owner',
          '--no-acl',
          '--username',
          'matrix_calendar_app',
          '--dbname',
          'matrix_calendar_test',
        ],
        { timeout: 120_000 },
      ),
      'restore-postgres-backup',
    );
    if (dump.length === 0) {
      throw new StageFailure('restore-postgres-backup');
    }
    savePrivateArtifact(postgresDumpPath, dump, 'restore-postgres-backup');
    return { checksum: hash(dump) };
  });
}

function verifyVolumeAbsentAndCreate(sourceVolumeName) {
  const listedVolumes = requireSuccess(
    run('docker', [
      'volume',
      'ls',
      '--quiet',
      '--filter',
      `name=${restoreVolumeName}`,
    ]),
    'restore-targets-prepared',
  )
    .toString('utf8')
    .trim()
    .split(/\r?\n/u)
    .filter(Boolean);
  const restoreVolumeExists = listedVolumes.length !== 0;
  const databaseExists = queryPostgres(
    'postgres',
    "SELECT count(*) FROM pg_database WHERE datname = 'matrix_calendar_restored';",
    'reminder_bootstrap',
    'restore-targets-prepared',
  );
  if (databaseExists !== '0' && databaseExists !== '1') {
    throw new StageFailure('restore-targets-prepared', {
      freshVolume: !restoreVolumeExists,
      freshDatabase: false,
    });
  }
  const freshDatabaseExists = databaseExists === '1';
  const targetPlanIsSafe = isSafeRestoreTargetPlan({
    projectName,
    sourceVolumeName,
    restoreVolumeName,
    restoreVolumeExists,
    sourceDatabase: 'matrix_calendar_test',
    restoreDatabase: 'matrix_calendar_restored',
    restoreDatabaseExists: freshDatabaseExists,
  });
  if (!targetPlanIsSafe) {
    throw new StageFailure('restore-targets-prepared', {
      freshVolume: !restoreVolumeExists,
      freshDatabase: !freshDatabaseExists,
    });
  }
  const created = requireSuccess(
    run('docker', ['volume', 'create', '--name', restoreVolumeName]),
    'restore-targets-prepared',
  )
    .toString('utf8')
    .trim();
  if (created !== restoreVolumeName) {
    throw new StageFailure('restore-targets-prepared', {
      freshVolume: false,
      freshDatabase: false,
    });
  }
  const emptyCheck = requireSuccess(
    run('docker', [
      'run',
      '--rm',
      '--network',
      'none',
      '--user',
      '0:0',
      '--mount',
      `type=volume,src=${restoreVolumeName},dst=/data,volume-nocopy`,
      '--entrypoint',
      '/app/bin/python',
      RADICALE_IMAGE,
      '-c',
      "import os,sys; sys.exit(0 if not os.listdir('/data') else 1)",
    ]),
    'restore-targets-prepared',
  );
  if (emptyCheck.length !== 0) {
    throw new StageFailure('restore-targets-prepared', {
      freshVolume: false,
      freshDatabase: false,
    });
  }

  requireSuccess(
    compose(
      [
        'exec',
        '-T',
        'postgres',
        'psql',
        '--username',
        'reminder_bootstrap',
        '--dbname',
        'postgres',
        '--set',
        'ON_ERROR_STOP=1',
      ],
      {
        input:
          'CREATE DATABASE matrix_calendar_restored OWNER matrix_calendar_app;\n',
      },
    ),
    'restore-targets-prepared',
  );
  return { freshVolume: true, freshDatabase: true };
}

function restoreRadicaleArchive() {
  const archive = readFileSync(radicaleArchivePath);
  requireSuccess(
    run(
      'docker',
      [
        'run',
        '--rm',
        '-i',
        '--network',
        'none',
        '--user',
        '0:0',
        '--mount',
        `type=volume,src=${restoreVolumeName},dst=/data,volume-nocopy`,
        '--entrypoint',
        '/app/bin/python',
        RADICALE_IMAGE,
        '-c',
        RADICALE_EXTRACT_TAR,
      ],
      { input: archive, timeout: 120_000 },
    ),
    'restore-targets-prepared',
  );
  const nonEmptyCheck = requireSuccess(
    run('docker', [
      'run',
      '--rm',
      '--network',
      'none',
      '--user',
      '0:0',
      '--mount',
      `type=volume,src=${restoreVolumeName},dst=/data,readonly`,
      '--entrypoint',
      '/app/bin/python',
      RADICALE_IMAGE,
      '-c',
      "import os,sys; sys.exit(0 if os.listdir('/data') else 1)",
    ]),
    'restore-targets-prepared',
  );
  if (nonEmptyCheck.length !== 0) {
    throw new StageFailure('restore-targets-prepared', {
      freshVolume: true,
      freshDatabase: true,
    });
  }
}

function restorePostgresDump() {
  const dump = readFileSync(postgresDumpPath);
  requireSuccess(
    compose(
      [
        'exec',
        '-T',
        'postgres',
        'pg_restore',
        '--format=custom',
        '--no-owner',
        '--no-acl',
        '--exit-on-error',
        '--single-transaction',
        '--username',
        'matrix_calendar_app',
        '--dbname',
        'matrix_calendar_restored',
        '-',
      ],
      { input: dump, timeout: 120_000 },
    ),
    'restore-targets-prepared',
  );
}

async function waitForRestoreRadicale() {
  return waitForHttp(
    'http://127.0.0.1:5233/',
    (status) => status >= 400 && status < 500,
    'restore-radicale-ready',
  );
}

async function restoreStores() {
  await validateCompose();
  const sourceVolume = await quiesceWriters();
  await backupRadicale(sourceVolume);
  await backupPostgres();
  await withStage('restore-targets-prepared', async () => {
    const details = verifyVolumeAbsentAndCreate(sourceVolume);
    restoreRadicaleArchive();
    restorePostgresDump();
    return details;
  });
  await withStage('restore-radicale-ready', async () => {
    requireSuccess(
      compose(['up', '--no-build', '-d', 'restore-radicale']),
      'restore-radicale-ready',
    );
    return { httpStatus: await waitForRestoreRadicale() };
  });
  await withStage('restore-postgres-role-ready', async () => {
    verifyRestrictedRole(
      'matrix_calendar_restored',
      'restore-postgres-role-ready',
    );
    return { rolePolicyVerified: true };
  });
  await withStage('restore-gateway-ready', async () => {
    requireSuccess(
      compose(['up', '--no-build', '-d', 'restore-gateway']),
      'restore-gateway-ready',
    );
    return {
      httpStatus: await waitForHttp(
        'http://127.0.0.1:3000/v1/calendar/context',
        (status) => status >= 400 && status < 500,
        'restore-gateway-ready',
      ),
    };
  });
  await withStage('restore-element-ready', async () => {
    requireSuccess(
      compose(['up', '--no-build', '-d', 'widget', 'element']),
      'restore-element-ready',
    );
    const statuses = await Promise.all([
      waitForHttp(
        'http://127.0.0.1:8080/',
        (status) => status === 200,
        'restore-element-ready',
      ),
      waitForHttp(
        'http://127.0.0.1:8090/',
        (status) => status === 200,
        'restore-element-ready',
      ),
    ]);
    return {
      count: statuses.filter((status) => status === 200).length,
      httpStatus: statuses[1],
    };
  });
}

async function main() {
  const mode = process.argv[2];
  try {
    initializeConfiguration();
    if (mode === 'enable') {
      await enableReminderRuntime();
    } else if (mode === 'snapshot') {
      await snapshotDelivery();
    } else if (mode === 'restart') {
      await restartGateway();
    } else if (mode === 'restore') {
      await restoreStores();
    } else if (mode === 'verify-restart') {
      await verifyDelivery(
        'matrix_calendar_test',
        'reminder-restart-delivery-row',
      );
    } else if (mode === 'verify-restore') {
      await verifyDelivery('matrix_calendar_restored', 'restore-delivery-row');
    } else {
      throw new StageFailure('reminder-compose-validation');
    }
  } catch (error) {
    const phase =
      error instanceof StageFailure && PHASES.has(error.phase)
        ? error.phase
        : 'reminder-compose-validation';
    if (!failureStageRecorded && stageFile) {
      try {
        appendStage(phase, 'failed');
      } catch {
        // Keep the fixed stderr summary if the private stage file is unavailable.
      }
    }
    process.stderr.write(`Reminder acceptance fixture failed phase=${phase}\n`);
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  void main();
}
