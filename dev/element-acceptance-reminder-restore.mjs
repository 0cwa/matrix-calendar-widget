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
export const RADICALE_EXTRACT_TAR = [
  'import os,posixpath,pwd,sys,tarfile',
  'destination=sys.argv[1]',
  'account=pwd.getpwnam(sys.argv[2])',
  'def safe(member,dest):',
  ' name=posixpath.normpath(member.name)',
  " if member.name.startswith('/') or name=='..' or name.startswith('../'): raise ValueError()",
  " if name=='.' and member.name not in ('.','./'): raise ValueError()",
  ' target=os.path.realpath(os.path.join(dest,name))',
  ' base=os.path.realpath(dest)',
  ' if os.path.commonpath((base,target))!=base: raise ValueError()',
  ' if member.issym() or member.islnk() or not (member.isdir() or member.isfile()): raise ValueError()',
  ' if member.uid!=account.pw_uid or member.gid!=account.pw_gid: raise ValueError()',
  ' if not isinstance(member.mode,int) or member.mode<0 or member.mode>0o777 or member.mode&0o002: raise ValueError()',
  ' member.name=name',
  ' return member',
  "with tarfile.open(fileobj=sys.stdin.buffer,mode='r|*') as archive:",
  ' for member in archive:',
  '  if sys.version_info >= (3,12):',
  '   archive.extract(member,destination,numeric_owner=True,filter=safe)',
  '  else:',
  '   archive.extract(safe(member,destination),destination,numeric_owner=True)',
].join('\n');
export const RADICALE_FILESYSTEM_PROBE = [
  'import json,os,pwd,stat,sys',
  'account=pwd.getpwnam("radicale")',
  'def path_state(path):',
  ' try: info=os.stat(path)',
  ' except OSError: return {"exists":False,"uid":0,"gid":0,"mode":0,"readable":False,"searchable":False}',
  ' return {"exists":True,"uid":info.st_uid,"gid":info.st_gid,"mode":stat.S_IMODE(info.st_mode),"readable":os.access(path,os.R_OK,effective_ids=True),"searchable":os.access(path,os.X_OK,effective_ids=True)}',
  'tree={"complete":True,"entries":0,"accessFailures":0}',
  'def fail(): tree["accessFailures"]=min(tree["accessFailures"]+1,2)',
  'def walk_error(_error): tree["complete"]=False; fail()',
  'data=path_state("/data"); collections=path_state("/data/collections")',
  'if not collections["exists"]: tree["complete"]=False; fail()',
  'for root,dirs,files in os.walk("/data/collections",topdown=True,onerror=walk_error,followlinks=False):',
  ' dirs.sort(); files.sort()',
  ' for name in dirs+files:',
  '  if tree["entries"]==512: tree["complete"]=False; break',
  '  path=os.path.join(root,name); tree["entries"]+=1',
  '  try: info=os.lstat(path)',
  '  except OSError: tree["complete"]=False; fail(); continue',
  '  if stat.S_ISDIR(info.st_mode): flags=(os.R_OK,os.X_OK)',
  '  elif stat.S_ISREG(info.st_mode): flags=(os.R_OK,)',
  '  else: fail(); continue',
  '  if not all(os.access(path,flag,effective_ids=True) for flag in flags): fail()',
  ' if not tree["complete"] and tree["entries"]==512: break',
  'print(json.dumps({"pythonVersion":"%d.%d.%d"%sys.version_info[:3],"runtimeOwner":os.geteuid()==account.pw_uid and os.getegid()==account.pw_gid,"data":data,"collections":collections,"tree":tree},separators=(",",":")))',
].join('\n');
const RADICALE_LOOPBACK_HTTP_PROBE = [
  // An unauthenticated root GET observes the listener without reading calendar data.
  'import http.client,json',
  'result={"httpStatus":None}',
  'connection=http.client.HTTPConnection("127.0.0.1",5232,timeout=2)',
  'try:',
  ' connection.request("GET","/")',
  ' response=connection.getresponse()',
  ' result["httpStatus"]=response.status',
  ' response.close()',
  'except Exception:',
  ' pass',
  'finally:',
  ' connection.close()',
  'print(json.dumps(result,separators=(",",":")))',
].join('\n');
const MAX_COMMAND_BUFFER = 16 * 1024 * 1024;
const MAX_RADICALE_LOG_BUFFER = 1024 * 1024;
const MAX_WAIT_MS = 120_000;
const COMPOSE_GRACEFUL_STOP_COMMAND_TIMEOUT_MS = 75_000;
const CONTAINER_STATUS_VALUES = new Set([
  'created',
  'restarting',
  'running',
  'removing',
  'paused',
  'exited',
  'dead',
]);
const CONTAINER_HEALTH_VALUES = new Set(['starting', 'healthy', 'unhealthy']);
const RADICALE_EMPTY_DIRECTORY_CHECK = [
  'import os,sys',
  "entries=os.listdir('/data')",
  "sys.stdout.write('empty' if not entries else 'nonempty')",
].join(';');
const RADICALE_ENTRY_COUNT_CHECK = [
  'import os',
  "print(min(len(os.listdir('/data')),2))",
].join(';');
const PHASES = new Set([
  'reminder-compose-validation',
  'reminder-postgres-ready',
  'reminder-role-verified',
  'reminder-gateway-migrated',
  'reminder-configuration-stored',
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
const RESTORE_TARGET_STEPS = new Set([
  'target-volume-check',
  'target-database-check',
  'target-plan-check',
  'volume-create',
  'volume-empty-check',
  'database-create',
  'archive-extract',
  'restored-volume-count',
  'postgres-restore',
  'complete',
]);

class StageFailure extends Error {
  constructor(phase, details = {}) {
    super('Element reminder acceptance stage failed');
    this.phase = phase;
    this.details = details;
  }
}

export function formatFailureMarker(phase, restoreStep) {
  const safePhase = PHASES.has(phase) ? phase : 'reminder-compose-validation';
  const safeRestoreStep =
    safePhase === 'restore-targets-prepared' &&
    RESTORE_TARGET_STEPS.has(restoreStep)
      ? ` restore_step=${restoreStep}`
      : '';
  return `Reminder acceptance fixture failed phase=${safePhase}${safeRestoreStep}`;
}

export function classifyRadicaleStartupLogs(logText) {
  // These fixed signatures are diagnostic hints; unknown output remains opaque.
  const logsAvailable = typeof logText === 'string';
  const logs = logsAvailable ? logText : '';
  const startupExceptionPresent = logs.includes(
    'An exception occurred during server startup: ',
  );
  const readyMarkerPresent = logs.includes('Radicale server ready');
  const exceptionClass = !logsAvailable
    ? 'unavailable'
    : logs.includes('PermissionError:')
      ? 'permission-error'
      : logs.includes('FileNotFoundError:')
        ? 'missing-path-error'
        : logs.includes('ModuleNotFoundError:')
          ? 'module-not-found'
          : logs.includes('ImportError:')
            ? 'import-error'
            : logs.includes('OSError:')
              ? 'os-error'
              : startupExceptionPresent
                ? 'other'
                : 'none';
  const errno = !logsAvailable
    ? 'unavailable'
    : logs.includes('[Errno 13]')
      ? 'eacces'
      : logs.includes('[Errno 30]')
        ? 'erofs'
        : logs.includes('[Errno 2]')
          ? 'enoent'
          : /\[Errno [0-9]+\]/u.test(logs)
            ? 'other'
            : 'none';
  const pathBucket = !logsAvailable
    ? 'unavailable'
    : /['"]\/data\/collections(?:\/|['"])/u.test(logs)
      ? 'collections'
      : /['"]\/data(?:\/|['"])/u.test(logs)
        ? 'data-root'
        : /['"]\/etc\/radicale(?:\/|['"])/u.test(logs)
          ? 'config'
          : /['"]\/opt\/radicale-auth(?:\/|['"])/u.test(logs)
            ? 'plugin'
            : /['"]\/[^'"]+['"]/u.test(logs)
              ? 'other-path'
              : 'none';
  let signature = logsAvailable ? 'unclassified' : 'unavailable';

  if (logsAvailable) {
    if (
      logs.includes('Radicale OpenID homeserver URL is invalid') ||
      logs.includes('Radicale OpenID Matrix server name is invalid')
    ) {
      signature = 'plugin-config-invalid';
    } else if (logs.includes('Invalid configuration: ')) {
      signature = 'invalid-configuration';
    } else if (
      logs.includes('ModuleNotFoundError:') ||
      logs.includes('ImportError:')
    ) {
      signature = 'module-import-failed';
    } else if (
      logs.includes('PermissionError:') ||
      logs.includes('[Errno 13]') ||
      logs.includes('Permission denied')
    ) {
      signature = 'filesystem-permission';
    } else if (
      logs.includes('Read-only file system') ||
      logs.includes('[Errno 30]')
    ) {
      signature = 'filesystem-readonly';
    } else if (
      logs.includes('No such file or directory') ||
      logs.includes('[Errno 2]')
    ) {
      signature = 'filesystem-missing-path';
    } else if (logs.includes('No servers started')) {
      signature = 'no-listener';
    } else if (logs.includes("cannot create server socket on '")) {
      signature = 'bind-failed';
    } else if (logs.includes("cannot retrieve IPv4 or IPv6 address of '")) {
      signature = 'address-resolution-failed';
    } else if (startupExceptionPresent) {
      signature = 'startup-exception';
    }
  }

  return {
    restoreRadicaleStartupSignature: signature,
    restoreRadicaleLogsAvailable: logsAvailable,
    restoreRadicaleStartupExceptionPresent: startupExceptionPresent,
    restoreRadicaleReadyMarkerPresent: readyMarkerPresent,
    restoreRadicaleStartupExceptionClass: exceptionClass,
    restoreRadicaleStartupErrno: errno,
    restoreRadicaleStartupPathBucket: pathBucket,
  };
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
let sourceRadicaleFilesystemProbe;
let restoredRadicaleFilesystemProbe;

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

function isRadicaleFilesystemProbe(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !==
      'collections,data,pythonVersion,runtimeOwner,tree' ||
    typeof value.pythonVersion !== 'string' ||
    !/^\d+\.\d+\.\d+$/u.test(value.pythonVersion) ||
    typeof value.runtimeOwner !== 'boolean'
  ) {
    return false;
  }

  for (const pathState of [value.data, value.collections]) {
    if (
      pathState === null ||
      typeof pathState !== 'object' ||
      Array.isArray(pathState) ||
      Object.keys(pathState).sort().join(',') !==
        'exists,gid,mode,readable,searchable,uid' ||
      typeof pathState.exists !== 'boolean' ||
      typeof pathState.readable !== 'boolean' ||
      typeof pathState.searchable !== 'boolean' ||
      !Number.isInteger(pathState.mode) ||
      pathState.mode < 0 ||
      pathState.mode > 0o777 ||
      !Number.isInteger(pathState.uid) ||
      pathState.uid < 0 ||
      pathState.uid > 65535 ||
      !Number.isInteger(pathState.gid) ||
      pathState.gid < 0 ||
      pathState.gid > 65535 ||
      (!pathState.exists &&
        (pathState.uid !== 0 ||
          pathState.gid !== 0 ||
          pathState.mode !== 0 ||
          pathState.readable ||
          pathState.searchable))
    ) {
      return false;
    }
  }

  return (
    value.tree !== null &&
    typeof value.tree === 'object' &&
    !Array.isArray(value.tree) &&
    Object.keys(value.tree).sort().join(',') ===
      'accessFailures,complete,entries' &&
    typeof value.tree.complete === 'boolean' &&
    Number.isInteger(value.tree.entries) &&
    value.tree.entries >= 0 &&
    value.tree.entries <= 512 &&
    Number.isInteger(value.tree.accessFailures) &&
    value.tree.accessFailures >= 0 &&
    value.tree.accessFailures <= 2
  );
}

function captureRadicaleFilesystemProbe(volumeName) {
  // The mount is read-only; this sample reports metadata and read/search access only.
  const result = run(
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
      RADICALE_FILESYSTEM_PROBE,
    ],
    { timeout: 10_000, maxBuffer: 64 * 1024 },
  );
  if (result.status !== 0) return undefined;

  try {
    const probe = JSON.parse(result.stdout.toString('utf8'));
    return isRadicaleFilesystemProbe(probe) ? probe : undefined;
  } catch {
    return undefined;
  }
}

function samePathValue(left, right, property) {
  return left.exists && right.exists && left[property] === right[property];
}

export function createRadicaleFilesystemEvidence(source, restored) {
  const sourceAvailable = isRadicaleFilesystemProbe(source);
  const restoredAvailable = isRadicaleFilesystemProbe(restored);
  const comparable = sourceAvailable && restoredAvailable;
  return {
    restoreRadicaleSourceProbeAvailable: sourceAvailable,
    restoreRadicaleFilesystemProbeAvailable: restoredAvailable,
    restoreRadicalePythonVersion: restoredAvailable
      ? restored.pythonVersion
      : 'unavailable',
    restoreRadicalePythonVersionMatchesSource:
      comparable && source.pythonVersion === restored.pythonVersion,
    restoreRadicaleRuntimeMatchesAccount:
      restoredAvailable && restored.runtimeOwner,
    restoreRadicaleDataUidMatchesSource:
      comparable && samePathValue(source.data, restored.data, 'uid'),
    restoreRadicaleDataGidMatchesSource:
      comparable && samePathValue(source.data, restored.data, 'gid'),
    restoreRadicaleDataModeMatchesSource:
      comparable && samePathValue(source.data, restored.data, 'mode'),
    restoreRadicaleCollectionsUidMatchesSource:
      comparable &&
      samePathValue(source.collections, restored.collections, 'uid'),
    restoreRadicaleCollectionsGidMatchesSource:
      comparable &&
      samePathValue(source.collections, restored.collections, 'gid'),
    restoreRadicaleCollectionsModeMatchesSource:
      comparable &&
      samePathValue(source.collections, restored.collections, 'mode'),
    restoreRadicaleDataRootReadable:
      restoredAvailable && restored.data.exists && restored.data.readable,
    restoreRadicaleDataRootSearchable:
      restoredAvailable && restored.data.exists && restored.data.searchable,
    restoreRadicaleCollectionsRootReadable:
      restoredAvailable &&
      restored.collections.exists &&
      restored.collections.readable,
    restoreRadicaleCollectionsRootSearchable:
      restoredAvailable &&
      restored.collections.exists &&
      restored.collections.searchable,
    restoreRadicaleCollectionTreeComplete:
      restoredAvailable && restored.tree.complete,
    restoreRadicaleCollectionEntryCount: restoredAvailable
      ? restored.tree.entries
      : 0,
    restoreRadicaleCollectionReadSearchFailureCount: restoredAvailable
      ? restored.tree.accessFailures
      : 0,
  };
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
    runtimeErrorPresent:
      typeof state.Error === 'string' && state.Error.length > 0,
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

function readReminderMarkerTitles(phase = 'reminder-configuration-stored') {
  let titles;
  try {
    titles = JSON.parse(readFileSync(eventFile, 'utf8'));
  } catch {
    throw new StageFailure(phase);
  }
  if (
    !Array.isArray(titles) ||
    titles.length < 1 ||
    titles.length > 3 ||
    titles.some(
      (title) =>
        typeof title !== 'string' ||
        !/^Reminder acceptance [0-9a-f-]{36}$/u.test(title),
    ) ||
    new Set(titles).size !== titles.length
  ) {
    throw new StageFailure(phase);
  }
  return titles;
}

function parseDeliveryRows(database, phase) {
  if (
    !['matrix_calendar_test', 'matrix_calendar_restored'].includes(database)
  ) {
    throw new StageFailure(phase);
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
    phase,
  )
    .toString('utf8')
    .trim();
  const lines = output ? output.split(/\r?\n/u) : [];
  if (lines.length > 3) throw new StageFailure(phase, { count: 4 });
  const deliveries = [];
  for (const line of lines) {
    const fields = line.split('|');
    if (
      fields.length !== 6 ||
      !/^[a-f0-9]{64}$/u.test(fields[0]) ||
      !['claimed', 'pending', 'sent'].includes(fields[1]) ||
      !/^\d+$/u.test(fields[2]) ||
      !['t', 'f'].includes(fields[3]) ||
      !['t', 'f'].includes(fields[4]) ||
      !['t', 'f'].includes(fields[5])
    ) {
      throw new StageFailure(phase, { count: Math.min(lines.length, 3) });
    }
    deliveries.push({
      deliveryKey: fields[0],
      state: fields[1],
      attemptCount: Number(fields[2]),
      sentAtPresent: fields[3] === 't',
      claimClear: fields[4] === 't' && fields[5] === 't',
    });
  }
  return deliveries;
}

function readDeliverySnapshot(phase) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(deliveryFile, 'utf8'));
  } catch {
    throw new StageFailure(phase);
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length < 1 ||
    parsed.length > 2 ||
    parsed.some(
      (delivery) =>
        delivery === null ||
        typeof delivery !== 'object' ||
        Array.isArray(delivery) ||
        Object.keys(delivery).length !== 2 ||
        !Object.hasOwn(delivery, 'deliveryKey') ||
        !Object.hasOwn(delivery, 'attemptCount') ||
        !/^[a-f0-9]{64}$/u.test(delivery.deliveryKey) ||
        !Number.isSafeInteger(delivery.attemptCount) ||
        delivery.attemptCount < 1,
    ) ||
    new Set(parsed.map((delivery) => delivery.deliveryKey)).size !==
      parsed.length
  ) {
    throw new StageFailure(phase);
  }
  return parsed;
}

function summarizeDeliveries(deliveries, expectedCount, snapshots = []) {
  const uniqueKeys =
    new Set(deliveries.map((delivery) => delivery.deliveryKey)).size ===
    deliveries.length;
  const sent = deliveries.every(
    (delivery) =>
      delivery.state === 'sent' &&
      delivery.sentAtPresent &&
      delivery.claimClear &&
      delivery.attemptCount >= 1,
  );
  const byKey = new Map(
    deliveries.map((delivery) => [delivery.deliveryKey, delivery]),
  );
  const preserved = snapshots.every((snapshot) => {
    const current = byKey.get(snapshot.deliveryKey);
    return current?.attemptCount === snapshot.attemptCount;
  });
  const details = {
    count: deliveries.length,
    attemptCount: deliveries.reduce(
      (total, delivery) => total + delivery.attemptCount,
      0,
    ),
    deliveryStateSent: sent,
    deliveryClaimClear: deliveries.every((delivery) => delivery.claimClear),
    deliveryKeyUnchanged:
      snapshots.length === 0 ||
      snapshots.every((snapshot) => byKey.has(snapshot.deliveryKey)),
    attemptCountUnchanged: snapshots.length === 0 || preserved,
  };
  return {
    ...details,
    complete:
      deliveries.length === expectedCount &&
      uniqueKeys &&
      sent &&
      details.deliveryClaimClear &&
      details.deliveryKeyUnchanged &&
      details.attemptCountUnchanged,
  };
}

function reminderConfigurationCount(database, phase) {
  if (
    !['matrix_calendar_test', 'matrix_calendar_restored'].includes(database)
  ) {
    throw new StageFailure(phase);
  }
  const output = queryPostgres(
    database,
    'SELECT count(*) FROM matrix_calendar.room_reminder_configurations;',
    'matrix_calendar_app',
    phase,
  );
  if (!/^\d+$/u.test(output)) throw new StageFailure(phase);
  return Number(output);
}

async function verifyReminderConfiguration(database) {
  await withStage('reminder-configuration-stored', async () => {
    const titles = readReminderMarkerTitles();
    const count = reminderConfigurationCount(
      database,
      'reminder-configuration-stored',
    );
    if (count !== titles.length) {
      throw new StageFailure('reminder-configuration-stored', { count });
    }
    return { count };
  });
}

async function snapshotDelivery() {
  await withStage('reminder-delivery-snapshot', async () => {
    const titles = readReminderMarkerTitles('reminder-delivery-snapshot');
    const deliveries = parseDeliveryRows(
      'matrix_calendar_test',
      'reminder-delivery-snapshot',
    );
    const summary = summarizeDeliveries(deliveries, titles.length);
    const details = {
      count: summary.count,
      attemptCount: summary.attemptCount,
      deliveryStateSent: summary.deliveryStateSent,
      deliveryClaimClear: summary.deliveryClaimClear,
    };
    if (!summary.complete) {
      throw new StageFailure('reminder-delivery-snapshot', details);
    }
    writeFileSync(
      deliveryFile,
      `${JSON.stringify(
        deliveries.map(({ deliveryKey, attemptCount }) => ({
          deliveryKey,
          attemptCount,
        })),
      )}\n`,
      { encoding: 'utf8', mode: 0o600 },
    );
    return details;
  });
}

async function restartGateway() {
  await withStage('reminder-gateway-restarted', async () => {
    requireSuccess(
      compose(['restart', '--timeout', '60', 'gateway'], {
        timeout: COMPOSE_GRACEFUL_STOP_COMMAND_TIMEOUT_MS,
      }),
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

async function verifyDelivery(database, phase, expectedCount) {
  await withStage(phase, async () => {
    const titles = readReminderMarkerTitles(phase);
    const snapshot = readDeliverySnapshot(phase);
    const deliveries = parseDeliveryRows(database, phase);
    const summary = summarizeDeliveries(deliveries, expectedCount, snapshot);
    const { complete, ...details } = summary;
    if (
      titles.length !== expectedCount ||
      snapshot.length + 1 !== expectedCount ||
      !complete
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
      compose(['stop', '--timeout', '60', 'element', 'widget'], {
        timeout: COMPOSE_GRACEFUL_STOP_COMMAND_TIMEOUT_MS,
      }),
      'restore-quiesced',
    );
    requireSuccess(
      compose(['stop', '--timeout', '60', 'gateway'], {
        timeout: COMPOSE_GRACEFUL_STOP_COMMAND_TIMEOUT_MS,
      }),
      'restore-quiesced',
    );
    requireSuccess(
      compose(['stop', '--timeout', '60', 'radicale'], {
        timeout: COMPOSE_GRACEFUL_STOP_COMMAND_TIMEOUT_MS,
      }),
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
    sourceRadicaleFilesystemProbe = captureRadicaleFilesystemProbe(volumeName);
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

function verifyVolumeAbsentAndCreate(sourceVolumeName, diagnostics) {
  diagnostics.restoreStep = 'target-volume-check';
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
  diagnostics.restoreVolumeExists = restoreVolumeExists;
  diagnostics.restoreStep = 'target-database-check';
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
  diagnostics.restoreDatabaseExists = freshDatabaseExists;
  diagnostics.restoreStep = 'target-plan-check';
  const targetPlanIsSafe = isSafeRestoreTargetPlan({
    projectName,
    sourceVolumeName,
    restoreVolumeName,
    restoreVolumeExists,
    sourceDatabase: 'matrix_calendar_test',
    restoreDatabase: 'matrix_calendar_restored',
    restoreDatabaseExists: freshDatabaseExists,
  });
  diagnostics.restoreTargetPlanSafe = targetPlanIsSafe;
  if (!targetPlanIsSafe) {
    throw new StageFailure('restore-targets-prepared', {
      freshVolume: !restoreVolumeExists,
      freshDatabase: !freshDatabaseExists,
    });
  }
  diagnostics.restoreStep = 'volume-create';
  const created = requireSuccess(
    run('docker', ['volume', 'create', '--name', restoreVolumeName]),
    'restore-targets-prepared',
  )
    .toString('utf8')
    .trim();
  diagnostics.restoreVolumeCreated = created === restoreVolumeName;
  if (!diagnostics.restoreVolumeCreated) {
    throw new StageFailure('restore-targets-prepared', {
      freshVolume: false,
      freshDatabase: false,
    });
  }
  diagnostics.restoreStep = 'volume-empty-check';
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
      RADICALE_EMPTY_DIRECTORY_CHECK,
    ]),
    'restore-targets-prepared',
  )
    .toString('utf8')
    .trim();
  diagnostics.restoreVolumeEmpty = emptyCheck === 'empty';
  if (!diagnostics.restoreVolumeEmpty) {
    throw new StageFailure('restore-targets-prepared', {
      freshVolume: false,
      freshDatabase: false,
    });
  }

  diagnostics.restoreStep = 'database-create';
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
  diagnostics.restoreDatabaseCreated = true;
  return { freshVolume: true, freshDatabase: true };
}

function restoreRadicaleArchive(diagnostics) {
  diagnostics.restoreStep = 'archive-extract';
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
        '/data',
        'radicale',
      ],
      { input: archive, timeout: 120_000 },
    ),
    'restore-targets-prepared',
  );
  diagnostics.restoreArchiveExtracted = true;
  diagnostics.restoreStep = 'restored-volume-count';
  diagnostics.restoreArchiveCountProbeValid = false;
  const entryCount = requireSuccess(
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
      RADICALE_ENTRY_COUNT_CHECK,
    ]),
    'restore-targets-prepared',
  )
    .toString('utf8')
    .trim();
  diagnostics.restoreArchiveCountProbeValid = /^[012]$/u.test(entryCount);
  if (diagnostics.restoreArchiveCountProbeValid) {
    diagnostics.restoreArchiveEntryCount = Number(entryCount);
  }
  if (
    !diagnostics.restoreArchiveCountProbeValid ||
    diagnostics.restoreArchiveEntryCount === 0
  ) {
    throw new StageFailure('restore-targets-prepared', {
      freshVolume: true,
      freshDatabase: true,
    });
  }
  restoredRadicaleFilesystemProbe =
    captureRadicaleFilesystemProbe(restoreVolumeName);
}

function restorePostgresDump(diagnostics) {
  diagnostics.restoreStep = 'postgres-restore';
  const dump = readFileSync(postgresDumpPath);
  // Omit the archive filename operand so pg_restore reads the supplied stdin.
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
      ],
      { input: dump, timeout: 120_000 },
    ),
    'restore-targets-prepared',
  );
  diagnostics.restorePostgresRestored = true;
}

async function waitForRestoreRadicale() {
  return waitForHttp(
    'http://127.0.0.1:5233/',
    (status) => status >= 400 && status < 500,
    'restore-radicale-ready',
  );
}

function inspectRestoreRadicaleReadiness() {
  let container = {
    containerState: 'unavailable',
    containerHealth: 'unavailable',
  };
  try {
    const state = inspectContainer(
      'restore-radicale',
      'restore-radicale-ready',
    );
    container = {
      containerState: CONTAINER_STATUS_VALUES.has(state.status)
        ? state.status
        : 'unavailable',
      containerHealth:
        state.healthStatus === undefined
          ? 'none'
          : CONTAINER_HEALTH_VALUES.has(state.healthStatus)
            ? state.healthStatus
            : 'unavailable',
      ...(Number.isInteger(state.exitCode)
        ? { containerExitCode: state.exitCode }
        : {}),
      ...(typeof state.oomKilled === 'boolean'
        ? { containerOomKilled: state.oomKilled }
        : {}),
      containerRuntimeErrorPresent: state.runtimeErrorPresent,
    };
  } catch {
    // Preserve the failed HTTP/container observation if inspection is unavailable.
  }

  let startupLogs;
  try {
    const containerId = serviceContainerId(
      'restore-radicale',
      'restore-radicale-ready',
    );
    startupLogs = readRadicaleStartupLogs(containerId);
  } catch {
    // Log retrieval failure is represented as unavailable, never as a guessed cause.
  }

  let listener = {
    restoreRadicaleContainerHttpOutcome: 'unavailable',
    restoreRadicalePublishedPortBinding: 'unavailable',
  };
  let containerId;
  try {
    containerId = serviceContainerId(
      'restore-radicale',
      'restore-radicale-ready',
    );
  } catch {
    // Listener and published-port probes are unavailable without a container.
  }
  if (containerId) {
    try {
      listener = {
        ...listener,
        ...inspectRestoreRadicaleContainerHttp(containerId),
      };
    } catch {
      // Keep the independent published-port observation.
    }
    try {
      listener.restoreRadicalePublishedPortBinding =
        inspectRestoreRadicalePublishedPortBinding(containerId);
    } catch {
      // Keep the independent in-container HTTP observation.
    }
  }

  return {
    ...container,
    ...listener,
    ...classifyRadicaleStartupLogs(startupLogs),
    ...createRadicaleFilesystemEvidence(
      sourceRadicaleFilesystemProbe,
      restoredRadicaleFilesystemProbe,
    ),
  };
}

function inspectRestoreRadicaleContainerHttp(containerId) {
  const result = run(
    'docker',
    [
      'exec',
      containerId,
      '/app/bin/python',
      '-c',
      RADICALE_LOOPBACK_HTTP_PROBE,
    ],
    { timeout: 5_000, maxBuffer: 4096 },
  );
  if (result.status !== 0) {
    return { restoreRadicaleContainerHttpOutcome: 'unavailable' };
  }

  try {
    const observation = JSON.parse(result.stdout.toString('utf8'));
    if (
      observation === null ||
      typeof observation !== 'object' ||
      Array.isArray(observation) ||
      Object.keys(observation).join(',') !== 'httpStatus' ||
      (observation.httpStatus !== null &&
        (!Number.isInteger(observation.httpStatus) ||
          observation.httpStatus < 100 ||
          observation.httpStatus > 599))
    ) {
      return { restoreRadicaleContainerHttpOutcome: 'unavailable' };
    }
    return observation.httpStatus === null
      ? { restoreRadicaleContainerHttpOutcome: 'no-response' }
      : {
          restoreRadicaleContainerHttpOutcome: 'http-status',
          restoreRadicaleContainerHttpStatus: observation.httpStatus,
        };
  } catch {
    return { restoreRadicaleContainerHttpOutcome: 'unavailable' };
  }
}

function inspectRestoreRadicalePublishedPortBinding(containerId) {
  const result = run(
    'docker',
    ['inspect', '--format', '{{json .NetworkSettings.Ports}}', containerId],
    { timeout: 5_000, maxBuffer: 4096 },
  );
  if (result.status !== 0) return 'unavailable';

  try {
    const bindings = JSON.parse(result.stdout.toString('utf8'))?.['5232/tcp'];
    return Array.isArray(bindings) &&
      bindings.length === 1 &&
      bindings[0]?.HostIp === '127.0.0.1' &&
      bindings[0]?.HostPort === '5233'
      ? 'loopback-5233'
      : 'other';
  } catch {
    return 'unavailable';
  }
}

function readRadicaleStartupLogs(containerId) {
  const result = spawnSync('docker', ['logs', '--tail', '100', containerId], {
    cwd: ROOT,
    timeout: 10_000,
    maxBuffer: MAX_RADICALE_LOG_BUFFER / 2,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (
    result.error ||
    result.status !== 0 ||
    result.signal ||
    !Buffer.isBuffer(result.stdout) ||
    !Buffer.isBuffer(result.stderr)
  ) {
    return undefined;
  }

  const separator = Buffer.from('\n');
  const combinedLength =
    result.stdout.length + separator.length + result.stderr.length;
  if (combinedLength > MAX_RADICALE_LOG_BUFFER) return undefined;
  return Buffer.concat([result.stdout, separator, result.stderr]).toString(
    'utf8',
  );
}

async function restoreStores() {
  await validateCompose();
  const sourceVolume = await quiesceWriters();
  await backupRadicale(sourceVolume);
  await backupPostgres();
  await withStage('restore-targets-prepared', async () => {
    const diagnostics = { restoreStep: 'target-volume-check' };
    try {
      const details = verifyVolumeAbsentAndCreate(sourceVolume, diagnostics);
      restoreRadicaleArchive(diagnostics);
      restorePostgresDump(diagnostics);
      diagnostics.restoreStep = 'complete';
      return { ...details, ...diagnostics };
    } catch (error) {
      if (error instanceof StageFailure) {
        error.details = { ...diagnostics, ...error.details };
        throw error;
      }
      throw new StageFailure('restore-targets-prepared', diagnostics);
    }
  });
  await withStage('restore-radicale-ready', async () => {
    requireSuccess(
      compose(['up', '--no-build', '-d', 'restore-radicale']),
      'restore-radicale-ready',
    );
    try {
      return {
        httpStatus: await waitForRestoreRadicale(),
        ...createRadicaleFilesystemEvidence(
          sourceRadicaleFilesystemProbe,
          restoredRadicaleFilesystemProbe,
        ),
      };
    } catch (error) {
      if (
        !(error instanceof StageFailure) ||
        error.phase !== 'restore-radicale-ready'
      ) {
        throw error;
      }
      throw new StageFailure('restore-radicale-ready', {
        ...error.details,
        restoreRadicaleProbeOutcome: Number.isInteger(error.details.httpStatus)
          ? 'http-status'
          : 'no-response',
        ...inspectRestoreRadicaleReadiness(),
      });
    }
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
    } else if (mode === 'verify-configuration') {
      await verifyReminderConfiguration('matrix_calendar_test');
    } else if (mode === 'restart') {
      await restartGateway();
    } else if (mode === 'restore') {
      await restoreStores();
    } else if (mode === 'verify-restart') {
      await verifyDelivery(
        'matrix_calendar_test',
        'reminder-restart-delivery-row',
        2,
      );
    } else if (mode === 'verify-restore') {
      await verifyReminderConfiguration('matrix_calendar_restored');
      await verifyDelivery(
        'matrix_calendar_restored',
        'restore-delivery-row',
        3,
      );
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
    const restoreStep =
      error instanceof StageFailure ? error.details.restoreStep : undefined;
    process.stderr.write(`${formatFailureMarker(phase, restoreStep)}\n`);
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  void main();
}
