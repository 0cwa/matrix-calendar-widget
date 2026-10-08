import { spawn, spawnSync } from 'node:child_process';
import {
  appendFileSync,
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import {
  acknowledgedEgressCounterObservation,
  emptyCleanupOriginProbe,
  emptyUidLifecycleObservation,
  emptyUidProcessStopDiagnostics,
  emptyUidStartupObservation,
  isValidUidLifecycleObservation,
  resolveTrustedRendererSandbox,
  sanitizeCleanupOriginProbe,
  sanitizeDesktopStages,
  sanitizeEgressCounterObservation,
  sanitizeUidLifecycleObservation,
  sanitizeUidStartupObservation,
  UID_CENSUS_STDERR_PREFIX_CATEGORIES,
  uidProcessObservationFromLifecycle,
} from './element-desktop-evidence.mjs';

const PACKAGE_VERSION = '1.12.30';
const PROBE_USERNAME = 'mcwdesktopprobe';
const PROBE_UID_START = 24_000;
const PROBE_UID_END = 65_535;
const JOURNEY_HOLD_MS = 180_000;
const STARTUP_WAIT_MS = 90_000;
const STARTUP_EXIT_WAIT_MS = 20_000;
const PLAYWRIGHT_TIMEOUT_MS = 165_000;
const SPAWN_SYNC_TIMEOUT_SIGNAL = 'SIGTERM';
const SPAWN_ERROR_CODE_PATTERN = /^E[A-Z0-9]{1,31}$/u;
const PROCESS_SIGNAL_PATTERN = /^SIG[A-Z0-9]{1,13}$/u;
const RUNNER_STATE_NAME = 'element-desktop-journey-runner-state.json';
const DESKTOP_RESULT_NAME = 'element-desktop-journey-startup-output.jsonl';
const DESKTOP_STAGE_NAME = 'element-desktop-startup-stage.jsonl';
const DESKTOP_EVIDENCE_MAX_BYTES = 1_048_576;
const UID_CENSUS_MAX_BYTES = 16_384;
const UID_CENSUS_STDERR_MAX_BYTES = 4_096;
const UID_CENSUS_STDERR_PREFIX_COUNT_MAX = 100;
const UID_STOP_CENSUS_CAPTURE = Symbol('uid-stop-census-capture');
const UNAVAILABLE_UID_CENSUS_STDERR = Object.freeze({
  outcome: 'unavailable',
  emitter: 'unavailable',
  lineShape: 'unavailable',
  prefixCounts: null,
  prefixOverflow: null,
});
const UID_STOP_CENSUS_WAIT_LIMITS_MS = Object.freeze({
  initial: 1_200,
  postTerm: 1_500,
  postKill: 900,
});
const WORKSPACE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const POLICY_SCRIPT = resolve(
  WORKSPACE_ROOT,
  'dev/element-desktop-egress-policy.mjs',
);
const STARTUP_SCRIPT = resolve(
  WORKSPACE_ROOT,
  'dev/element-desktop-startup.mjs',
);
const CONFIG_FILE = resolve(
  WORKSPACE_ROOT,
  'dev/element-desktop-probe-config.json',
);
const E2E_PACKAGE_FILE = resolve(WORKSPACE_ROOT, 'e2e/package.json');

const RUNNER_STATE_KEYS = Object.freeze([
  'runId',
  'runAttempt',
  'sourceSha',
  'journey',
  'username',
  'uid',
  'groupId',
  'profileRoot',
  'appPid',
  'appStartTimeTicks',
  'controllerPid',
  'controllerStartTimeTicks',
  'cdpPort',
  'packageSha256',
  'policyMayBeInstalled',
  'userMayBeCreated',
  'resultPath',
]);

const PROGRESS_SHAPES = Object.freeze({
  'before-app': ['milestone', 'phase'],
  'after-app-spawn': ['appPid', 'appStartTimeTicks', 'milestone', 'phase'],
  'after-page-load': ['appPid', 'cdpRendererHandoff', 'milestone', 'phase'],
  'desktop-journey-ready': ['milestone', 'phase'],
});

function failure(code = 'desktop-journey-runner-failed') {
  const error = new Error('Element Desktop journey runner failed');
  error.code = code;
  return error;
}

function safePath(input, expectedName, runnerTemp) {
  if (
    typeof input !== 'string' ||
    typeof runnerTemp !== 'string' ||
    !isAbsolute(input) ||
    !isAbsolute(runnerTemp) ||
    resolve(input) !== resolve(runnerTemp, expectedName)
  ) {
    throw failure();
  }
  return resolve(input);
}

function requiredEnvironment(name, pattern) {
  const value = process.env[name];
  if (typeof value !== 'string' || !pattern.test(value)) throw failure();
  return value;
}

export function createSystemCommandEnvironment(sourceEnvironment) {
  if (sourceEnvironment === null || typeof sourceEnvironment !== 'object') {
    throw failure();
  }
  const environment = {};
  for (const name of ['HOME', 'LANG', 'LC_ALL', 'PATH']) {
    if (typeof sourceEnvironment[name] === 'string') {
      environment[name] = sourceEnvironment[name];
    }
  }
  environment.TMPDIR =
    typeof sourceEnvironment.RUNNER_TEMP === 'string' &&
    isAbsolute(sourceEnvironment.RUNNER_TEMP)
      ? sourceEnvironment.RUNNER_TEMP
      : '/tmp';
  return environment;
}

function capture(program, args, { input, timeout = 10_000, cwd, env } = {}) {
  const result = spawnSync(program, args, {
    cwd,
    env: env ?? createSystemCommandEnvironment(process.env),
    encoding: 'utf8',
    input,
    stdio: ['pipe', 'pipe', 'ignore'],
    timeout,
    maxBuffer: 1_048_576,
  });
  if (result.error || result.signal || result.status !== 0) return undefined;
  return result.stdout;
}

export function classifyPasswdLookupResult(result, expectedUsername) {
  if (
    result === null ||
    typeof result !== 'object' ||
    result.error ||
    (result.signal !== null && result.signal !== undefined) ||
    !Number.isInteger(result.status) ||
    typeof expectedUsername !== 'string'
  ) {
    return { state: 'unavailable' };
  }
  if (result.status === 2 && result.stdout === '') {
    return { state: 'absent' };
  }
  if (
    result.status !== 0 ||
    typeof result.stdout !== 'string' ||
    Buffer.byteLength(result.stdout) > 4_096
  ) {
    return { state: 'unavailable' };
  }

  const records = result.stdout.split(/\r?\n/u);
  if (records.at(-1) === '') records.pop();
  if (records.length !== 1) return { state: 'unavailable' };
  const fields = records[0].split(':');
  if (
    fields.length !== 7 ||
    fields[0] !== expectedUsername ||
    !/^[0-9]{1,10}$/u.test(fields[2]) ||
    !/^[0-9]{1,10}$/u.test(fields[3])
  ) {
    return { state: 'unavailable' };
  }
  const uid = Number(fields[2]);
  const groupId = Number(fields[3]);
  if (!Number.isSafeInteger(uid) || !Number.isSafeInteger(groupId)) {
    return { state: 'unavailable' };
  }
  return { state: 'present', uid };
}

export function lookupPasswdAccount(username, commandRunner = spawnSync) {
  if (typeof username !== 'string' || typeof commandRunner !== 'function') {
    return { state: 'unavailable' };
  }
  let result;
  try {
    result = commandRunner('getent', ['-s', 'files', 'passwd', username], {
      encoding: 'utf8',
      env: createSystemCommandEnvironment(process.env),
      maxBuffer: 8_192,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2_000,
    });
  } catch {
    return { state: 'unavailable' };
  }
  return classifyPasswdLookupResult(result, username);
}

function requiredCommand(program, args, options = {}) {
  const output = capture(program, args, options);
  if (output === undefined) throw failure();
  return output;
}

function runQuietly(program, args, { input, timeout = 10_000, cwd, env } = {}) {
  const result = spawnSync(program, args, {
    cwd,
    env: env ?? createSystemCommandEnvironment(process.env),
    encoding: 'utf8',
    input,
    stdio: ['pipe', 'ignore', 'ignore'],
    timeout,
  });
  if (result.error || result.signal || !Number.isInteger(result.status)) {
    return undefined;
  }
  return result.status;
}

export function parseStartupProgressRecord(line) {
  if (typeof line !== 'string' || Buffer.byteLength(line) > 8_192) {
    return undefined;
  }
  let value;
  try {
    value = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    value.phase !== 'desktop-startup-progress' ||
    !Object.hasOwn(PROGRESS_SHAPES, value.milestone) ||
    Object.keys(value).sort().join(',') !==
      [...PROGRESS_SHAPES[value.milestone]].sort().join(',')
  ) {
    return undefined;
  }
  if (
    ['after-app-spawn', 'after-page-load'].includes(value.milestone) &&
    (!Number.isSafeInteger(value.appPid) ||
      value.appPid < 2 ||
      value.appPid > 2_147_483_647)
  ) {
    return undefined;
  }
  if (
    value.milestone === 'after-app-spawn' &&
    value.appStartTimeTicks !== null &&
    (typeof value.appStartTimeTicks !== 'string' ||
      !/^[0-9]{1,20}$/u.test(value.appStartTimeTicks))
  ) {
    return undefined;
  }
  if (
    value.milestone === 'after-page-load' &&
    !validRendererHandoff(value.cdpRendererHandoff)
  ) {
    return undefined;
  }
  return value;
}

function readProcStartTimeTicks(pid) {
  if (!Number.isSafeInteger(pid) || pid < 2 || pid > 2_147_483_647) {
    return null;
  }
  try {
    const text = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const end = text.lastIndexOf(')');
    if (end < 0) return null;
    const fields = text
      .slice(end + 2)
      .trim()
      .split(/\s+/u);
    return fields.length >= 20 && /^[0-9]{1,20}$/u.test(fields[19] ?? '')
      ? fields[19]
      : null;
  } catch {
    return null;
  }
}

function validRendererHandoff(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !==
      'overflow,pids,rendererCount,state' ||
    !['unavailable', 'partial', 'observed'].includes(value.state)
  ) {
    return false;
  }
  if (value.state === 'unavailable') {
    return (
      value.overflow === null &&
      value.pids === null &&
      value.rendererCount === null
    );
  }
  return (
    typeof value.overflow === 'boolean' &&
    Number.isSafeInteger(value.rendererCount) &&
    value.rendererCount >= 0 &&
    value.rendererCount <= 64 &&
    Array.isArray(value.pids) &&
    value.pids.length === value.rendererCount &&
    value.pids.every(
      (pid, index) =>
        Number.isSafeInteger(pid) &&
        pid >= 2 &&
        pid <= 2_147_483_647 &&
        value.pids.indexOf(pid) === index,
    ) &&
    (value.state !== 'observed' || value.overflow === false)
  );
}

function statePath() {
  const runnerTemp = requiredEnvironment('RUNNER_TEMP', /^.+$/u);
  return safePath(
    join(runnerTemp, RUNNER_STATE_NAME),
    RUNNER_STATE_NAME,
    runnerTemp,
  );
}

function desktopStagePath() {
  const runnerTemp = requiredEnvironment('RUNNER_TEMP', /^.+$/u);
  return safePath(
    process.env.ELEMENT_DESKTOP_STAGE_FILE ??
      join(runnerTemp, DESKTOP_STAGE_NAME),
    DESKTOP_STAGE_NAME,
    runnerTemp,
  );
}

function writePrivateJson(path, value) {
  const temporaryPath = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(value)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    chmodSync(temporaryPath, 0o600);
    renameSync(temporaryPath, path);
  } catch {
    try {
      unlinkSync(temporaryPath);
    } catch {
      // Keep the original safe failure if cleanup has nothing to remove.
    }
    throw failure();
  }
}

function persistState(state) {
  if (
    Object.keys(state).sort().join(',') !==
    [...RUNNER_STATE_KEYS].sort().join(',')
  ) {
    throw failure();
  }
  writePrivateJson(statePath(), state);
}

function readState() {
  const path = statePath();
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    return undefined;
  }
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    stat.uid !== process.getuid?.() ||
    (stat.mode & 0o777) !== 0o600 ||
    stat.size > 8_192
  ) {
    throw failure();
  }
  let state;
  try {
    state = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw failure();
  }
  if (
    state === null ||
    typeof state !== 'object' ||
    Array.isArray(state) ||
    Object.keys(state).sort().join(',') !==
      [...RUNNER_STATE_KEYS].sort().join(',') ||
    !/^[0-9]{1,18}$/u.test(state.runId) ||
    !/^[0-9]{1,6}$/u.test(state.runAttempt) ||
    !/^[0-9a-f]{40}$/u.test(state.sourceSha) ||
    typeof state.journey !== 'boolean' ||
    state.username !== PROBE_USERNAME ||
    !Number.isSafeInteger(state.uid) ||
    state.uid < PROBE_UID_START ||
    state.uid > PROBE_UID_END ||
    !Number.isSafeInteger(state.groupId) ||
    state.groupId < 1 ||
    typeof state.profileRoot !== 'string' ||
    !new RegExp(
      `^/tmp/mcw-element-desktop-${state.runId}-${state.runAttempt}-[A-Za-z0-9]{6}$`,
      'u',
    ).test(state.profileRoot) ||
    (state.appPid === null) !== (state.appStartTimeTicks === null) ||
    (state.appPid !== null &&
      (!Number.isSafeInteger(state.appPid) ||
        state.appPid < 2 ||
        state.appPid > 2_147_483_647 ||
        typeof state.appStartTimeTicks !== 'string' ||
        !/^[0-9]{1,20}$/u.test(state.appStartTimeTicks))) ||
    (state.controllerPid === null) !==
      (state.controllerStartTimeTicks === null) ||
    (state.controllerPid !== null &&
      (!Number.isSafeInteger(state.controllerPid) ||
        state.controllerPid < 2 ||
        state.controllerPid > 2_147_483_647 ||
        typeof state.controllerStartTimeTicks !== 'string' ||
        !/^[0-9]{1,20}$/u.test(state.controllerStartTimeTicks))) ||
    !Number.isSafeInteger(state.cdpPort) ||
    state.cdpPort < 1_024 ||
    state.cdpPort > 65_535 ||
    (state.packageSha256 !== null &&
      !/^[0-9a-f]{64}$/u.test(state.packageSha256)) ||
    typeof state.policyMayBeInstalled !== 'boolean' ||
    typeof state.userMayBeCreated !== 'boolean' ||
    typeof state.resultPath !== 'string' ||
    !isAbsolute(state.resultPath) ||
    resolve(state.resultPath) !==
      resolve(requiredEnvironment('RUNNER_TEMP', /^.+$/u), DESKTOP_RESULT_NAME)
  ) {
    throw failure();
  }
  return state;
}

function appendStage(path, record) {
  const serialized = `${JSON.stringify(record)}\n`;
  let size = 0;
  try {
    const stat = lstatSync(path);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.nlink !== 1 ||
      stat.uid !== process.getuid?.() ||
      (stat.mode & 0o777) !== 0o600
    ) {
      throw failure();
    }
    size = stat.size;
  } catch {
    if (!existsSync(path)) {
      writeFileSync(path, '', { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    } else {
      throw failure();
    }
  }
  if (size + Buffer.byteLength(serialized) > DESKTOP_EVIDENCE_MAX_BYTES) {
    throw failure();
  }
  appendFileSync(path, serialized, { encoding: 'utf8', mode: 0o600 });
}

export function validateJourneyPolicyPorts(cdpPort) {
  return (
    Number.isSafeInteger(cdpPort) &&
    cdpPort >= 1_024 &&
    cdpPort <= 65_535 &&
    ![8_008, 3_000, 8_080].includes(cdpPort)
  );
}

export function validateDefaultPolicyPort(cdpPort) {
  return (
    Number.isSafeInteger(cdpPort) &&
    cdpPort >= 1_024 &&
    cdpPort <= 65_535 &&
    cdpPort !== 8_008
  );
}

export function buildDesktopPolicyArguments(
  state,
  command,
  extraArguments = [],
) {
  if (
    state === null ||
    typeof state !== 'object' ||
    ![
      'install',
      'negative-self-test',
      'zero-counters',
      'counters',
      'remove',
    ].includes(command) ||
    !Array.isArray(extraArguments) ||
    !extraArguments.every((argument) => typeof argument === 'string')
  ) {
    throw failure();
  }
  const base = [command, String(state.uid), state.runId];
  if (command === 'remove') return base;
  return [
    ...base,
    String(state.cdpPort),
    ...extraArguments,
    ...(state.journey ? ['--journey'] : []),
  ];
}

export function selectAvailableProbeUid(passwdEntries, processUidEntries = '') {
  if (
    typeof passwdEntries !== 'string' ||
    passwdEntries.length > 4_194_304 ||
    typeof processUidEntries !== 'string' ||
    processUidEntries.length > 1_048_576
  ) {
    throw failure('unsupported-runner');
  }
  const usedUids = new Set();
  for (const entry of passwdEntries.split(/\r?\n/u)) {
    const match = /^[^:\n]{1,256}:[^:\n]*:([0-9]{1,10}):/u.exec(entry);
    if (!match) continue;
    const uid = Number(match[1]);
    if (
      Number.isSafeInteger(uid) &&
      uid >= PROBE_UID_START &&
      uid <= PROBE_UID_END
    ) {
      usedUids.add(uid);
    }
  }
  for (const entry of processUidEntries.split(/\s+/u)) {
    if (!/^[0-9]{1,10}$/u.test(entry)) continue;
    const uid = Number(entry);
    if (
      Number.isSafeInteger(uid) &&
      uid >= PROBE_UID_START &&
      uid <= PROBE_UID_END
    ) {
      usedUids.add(uid);
    }
  }
  for (let uid = PROBE_UID_START; uid <= PROBE_UID_END; uid += 1) {
    if (!usedUids.has(uid)) return uid;
  }
  throw failure('unsupported-runner');
}

export function createJourneyChildEnvironment(
  sourceEnvironment,
  config,
  state,
) {
  if (
    sourceEnvironment === null ||
    typeof sourceEnvironment !== 'object' ||
    config === null ||
    typeof config !== 'object' ||
    state === null ||
    typeof state !== 'object'
  ) {
    throw failure();
  }
  return {
    CI: 'true',
    HOME:
      typeof sourceEnvironment.HOME === 'string'
        ? sourceEnvironment.HOME
        : '/home/runner',
    PATH:
      typeof sourceEnvironment.PATH === 'string'
        ? sourceEnvironment.PATH
        : '/usr/local/bin:/usr/bin:/bin',
    TMPDIR: config.runnerTemp,
    GITHUB_WORKSPACE: config.workspace,
    RUNNER_TEMP: config.runnerTemp,
    ELEMENT_DESKTOP_SOURCE_SHA: state.sourceSha,
    ELEMENT_DESKTOP_CDP_PORT: String(state.cdpPort),
    ELEMENT_DESKTOP_JOURNEY_STAGE_FILE: config.journeyStageFile,
    ELEMENT_DESKTOP_JOURNEY_PLAYWRIGHT_OUTPUT: config.playwrightOutput,
    ELEMENT_ACCEPTANCE_USERS_FILE: config.usersFile,
    ELEMENT_ACCEPTANCE_DESKTOP_CREDENTIALS_FILE: config.credentialsFile,
    ...(typeof sourceEnvironment.PLAYWRIGHT_BROWSERS_PATH === 'string'
      ? {
          PLAYWRIGHT_BROWSERS_PATH: sourceEnvironment.PLAYWRIGHT_BROWSERS_PATH,
        }
      : {}),
  };
}

function validateEnvironment(mode) {
  const runId = requiredEnvironment('GITHUB_RUN_ID', /^[0-9]{1,18}$/u);
  const runAttempt = requiredEnvironment('GITHUB_RUN_ATTEMPT', /^[0-9]{1,6}$/u);
  const sourceSha = requiredEnvironment(
    'ELEMENT_DESKTOP_SOURCE_SHA',
    /^[0-9a-f]{40}$/u,
  );
  const runnerTemp = requiredEnvironment('RUNNER_TEMP', /^.+$/u);
  const workspace = requiredEnvironment('GITHUB_WORKSPACE', /^.+$/u);
  const usersFile =
    mode === 'journey'
      ? safePath(
          process.env.ELEMENT_ACCEPTANCE_USERS_FILE,
          'element-acceptance-users.json',
          runnerTemp,
        )
      : undefined;
  const credentialsFile =
    mode === 'journey'
      ? safePath(
          process.env.ELEMENT_ACCEPTANCE_DESKTOP_CREDENTIALS_FILE,
          'element-acceptance-desktop-credentials.json',
          runnerTemp,
        )
      : undefined;
  const playwrightOutput =
    mode === 'journey'
      ? safePath(
          process.env.ELEMENT_DESKTOP_JOURNEY_PLAYWRIGHT_OUTPUT,
          'element-desktop-journey-playwright-output',
          runnerTemp,
        )
      : undefined;
  const journeyStageFile =
    mode === 'journey'
      ? safePath(
          process.env.ELEMENT_DESKTOP_JOURNEY_STAGE_FILE,
          'element-desktop-journey-stage.jsonl',
          runnerTemp,
        )
      : undefined;
  const workspaceReal = resolve(workspace);
  if (
    !isAbsolute(runnerTemp) ||
    !isAbsolute(workspace) ||
    workspaceReal !== WORKSPACE_ROOT
  ) {
    throw failure();
  }
  return {
    runId,
    runAttempt,
    sourceSha,
    runnerTemp: resolve(runnerTemp),
    workspace: workspaceReal,
    usersFile,
    credentialsFile,
    playwrightOutput,
    journeyStageFile,
    stateFile: statePath(),
    stageFile: desktopStagePath(),
  };
}

export function selectPinnedPackageHash(metadata) {
  if (typeof metadata !== 'string' || metadata.length > 4_194_304) {
    throw failure('package-unavailable');
  }
  const matchingBlocks = metadata.split(/\n\n+/u).filter((block) => {
    const fields = new Map();
    for (const line of block.split(/\r?\n/u)) {
      const separator = line.indexOf(':');
      if (separator < 1) continue;
      fields.set(line.slice(0, separator), line.slice(separator + 1).trim());
    }
    return (
      fields.get('Package') === 'element-desktop' &&
      fields.get('Version') === PACKAGE_VERSION &&
      fields.get('Architecture') === 'amd64'
    );
  });
  const hashes = matchingBlocks.map((block) => {
    const values = block
      .split(/\r?\n/u)
      .filter((line) => line.startsWith('SHA256:'));
    if (values.length !== 1) return '';
    const match = /^SHA256:\s+([0-9a-f]{64})$/u.exec(values[0]);
    return match?.[1] ?? '';
  });
  if (hashes.length !== 1 || !/^[0-9a-f]{64}$/u.test(hashes[0])) {
    throw failure('package-unavailable');
  }
  return hashes[0];
}

function installPinnedDesktopPackage(runnerTemp) {
  const keyFile = join(runnerTemp, 'element-io-archive-keyring.gpg');
  const debFile = join(
    runnerTemp,
    `element-desktop_${PACKAGE_VERSION}_amd64.deb`,
  );
  const sourceFile = '/etc/apt/sources.list.d/element-desktop-startup.list';
  const systemKey = '/usr/share/keyrings/element-desktop-startup.gpg';

  requiredCommand('curl', [
    '--fail',
    '--silent',
    '--show-error',
    '--location',
    'https://packages.element.io/debian/element-io-archive-keyring.gpg',
    '--output',
    keyFile,
  ]);
  requiredCommand('sudo', [
    '-n',
    'install',
    '-D',
    '-m',
    '0644',
    keyFile,
    systemKey,
  ]);
  requiredCommand('sudo', ['-n', 'tee', sourceFile], {
    input: `deb [arch=amd64 signed-by=${systemKey}] https://packages.element.io/debian/ default main\n`,
  });
  requiredCommand('sudo', ['-n', 'apt-get', 'update', '--quiet'], {
    timeout: 300_000,
  });
  const packageHash = selectPinnedPackageHash(
    requiredCommand('apt-cache', [
      'show',
      `element-desktop=${PACKAGE_VERSION}`,
    ]),
  );
  requiredCommand(
    'apt-get',
    ['download', `element-desktop=${PACKAGE_VERSION}`],
    {
      cwd: runnerTemp,
      timeout: 300_000,
    },
  );
  const downloadedHash = requiredCommand('sha256sum', [debFile])
    .trim()
    .split(/\s+/u)[0];
  if (downloadedHash !== packageHash) throw failure('package-mismatch');
  requiredCommand(
    'sudo',
    [
      '-n',
      'env',
      'DEBIAN_FRONTEND=noninteractive',
      'apt-get',
      'install',
      '--yes',
      '--no-install-recommends',
      'xvfb',
      'xauth',
      'dbus-daemon',
      'gnome-keyring',
      'libsecret-tools',
      'iptables',
      'iproute2',
      `element-desktop:amd64=${PACKAGE_VERSION}`,
    ],
    { timeout: 600_000 },
  );
  const installed = requiredCommand('dpkg-query', [
    '-W',
    '-f=${Version}\t${Architecture}',
    'element-desktop',
  ]);
  if (installed !== `${PACKAGE_VERSION}\tamd64`) {
    throw failure('package-mismatch');
  }
  return { packageHash, keyFile, debFile, sourceFile, systemKey };
}

function allocateUid() {
  return selectAvailableProbeUid(
    requiredCommand('getent', ['passwd']),
    requiredCommand('ps', ['-eo', 'uid=']),
  );
}

function localCdpPort() {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.once('error', () => rejectPort(failure('cdp-not-loopback')));
    server.listen({ host: '127.0.0.1', port: 0 }, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => rejectPort(failure('cdp-not-loopback')));
        return;
      }
      server.close((error) => {
        if (error) rejectPort(failure('cdp-not-loopback'));
        else resolvePort(address.port);
      });
    });
  });
}

async function createPrivateProfile(config, mode) {
  const existingUser = lookupPasswdAccount(PROBE_USERNAME);
  if (existingUser.state !== 'absent') throw failure('unsupported-runner');
  const groupRecord = requiredCommand('getent', ['group', 'nogroup']);
  const groupIdText = groupRecord.split(':')[2];
  if (!/^[0-9]{1,5}$/u.test(groupIdText ?? '')) {
    throw failure('unsupported-runner');
  }
  const groupId = Number(groupIdText);
  const uid = allocateUid();
  const cdpPort = await localCdpPort();
  const journey = mode === 'journey';
  if (
    !['journey', 'startup'].includes(mode) ||
    (journey
      ? !validateJourneyPolicyPorts(cdpPort)
      : !validateDefaultPolicyPort(cdpPort))
  ) {
    throw failure('cdp-not-loopback');
  }
  const profileRoot = mkdtempSync(
    `/tmp/mcw-element-desktop-${config.runId}-${config.runAttempt}-`,
  );
  const resultPath = safePath(
    join(config.runnerTemp, DESKTOP_RESULT_NAME),
    DESKTOP_RESULT_NAME,
    config.runnerTemp,
  );
  const state = {
    runId: config.runId,
    runAttempt: config.runAttempt,
    sourceSha: config.sourceSha,
    journey,
    username: PROBE_USERNAME,
    uid,
    groupId,
    profileRoot,
    appPid: null,
    appStartTimeTicks: null,
    controllerPid: null,
    controllerStartTimeTicks: null,
    cdpPort,
    packageSha256: null,
    policyMayBeInstalled: false,
    userMayBeCreated: false,
    resultPath,
  };
  try {
    persistState(state);
  } catch (error) {
    rmSync(profileRoot, { recursive: true, force: true });
    throw error;
  }
  writeFileSync(resultPath, '', {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  const profileMarker = join(profileRoot, '.owned');
  writeFileSync(profileMarker, 'element-desktop-startup-profile-v1\n', {
    encoding: 'utf8',
    mode: 0o600,
  });
  state.userMayBeCreated = true;
  persistState(state);
  requiredCommand('sudo', [
    '-n',
    'useradd',
    '--uid',
    String(uid),
    '--gid',
    String(groupId),
    '--no-create-home',
    '--shell',
    '/usr/sbin/nologin',
    PROBE_USERNAME,
  ]);
  requiredCommand('sudo', [
    '-n',
    'chown',
    `${uid}:${groupId}`,
    profileRoot,
    profileMarker,
  ]);
  requiredCommand('sudo', ['-n', 'chmod', '0700', profileRoot]);
  for (const child of [
    'home',
    'config',
    'data',
    'cache',
    'runtime',
    'profile',
    'probe',
  ]) {
    requiredCommand('sudo', [
      '-n',
      'install',
      '-d',
      '-m',
      '0700',
      '-o',
      String(uid),
      '-g',
      String(groupId),
      join(profileRoot, child),
    ]);
  }

  const probeRoot = join(profileRoot, 'probe');
  for (const directory of [
    'dev',
    'e2e',
    'node_modules/@playwright/test',
    'node_modules/playwright',
    'node_modules/playwright-core',
  ]) {
    requiredCommand('sudo', [
      '-n',
      'install',
      '-d',
      '-m',
      '0700',
      '-o',
      String(uid),
      '-g',
      String(groupId),
      join(probeRoot, directory),
    ]);
  }
  for (const [source, destination] of [
    [POLICY_SCRIPT, join(probeRoot, 'dev/element-desktop-egress-policy.mjs')],
    [STARTUP_SCRIPT, join(probeRoot, 'dev/element-desktop-startup.mjs')],
    [CONFIG_FILE, join(probeRoot, 'dev/element-desktop-probe-config.json')],
    [E2E_PACKAGE_FILE, join(probeRoot, 'e2e/package.json')],
  ]) {
    requiredCommand('sudo', [
      '-n',
      'install',
      '-o',
      String(uid),
      '-g',
      String(groupId),
      '-m',
      '0400',
      source,
      destination,
    ]);
  }
  for (const packageName of [
    '@playwright/test',
    'playwright',
    'playwright-core',
  ]) {
    const source = resolve(config.workspace, 'node_modules', packageName);
    const destination = join(probeRoot, 'node_modules', packageName);
    if (!existsSync(source)) throw failure('unsupported-runner');
    requiredCommand('sudo', [
      '-n',
      'cp',
      '-aL',
      `${source}/.`,
      `${destination}/`,
    ]);
    requiredCommand('sudo', [
      '-n',
      'chown',
      '-R',
      `${uid}:${groupId}`,
      destination,
    ]);
    requiredCommand('sudo', ['-n', 'chmod', '-R', 'go-rwx', destination]);
  }
  for (const [source, destination] of [
    [POLICY_SCRIPT, join(probeRoot, 'dev/element-desktop-egress-policy.mjs')],
    [STARTUP_SCRIPT, join(probeRoot, 'dev/element-desktop-startup.mjs')],
    [CONFIG_FILE, join(probeRoot, 'dev/element-desktop-probe-config.json')],
    [E2E_PACKAGE_FILE, join(probeRoot, 'e2e/package.json')],
  ]) {
    const comparison = capture('sudo', [
      '-n',
      'cmp',
      '-s',
      source,
      destination,
    ]);
    if (comparison === undefined) throw failure('invalid-profile');
  }

  return state;
}

function profilePaths(state) {
  const profileRoot = state.profileRoot;
  const probeRoot = join(profileRoot, 'probe');
  return {
    profileRoot,
    probeRoot,
    stagedPolicy: join(probeRoot, 'dev/element-desktop-egress-policy.mjs'),
    stagedStartup: join(probeRoot, 'dev/element-desktop-startup.mjs'),
    stagedConfig: join(probeRoot, 'dev/element-desktop-probe-config.json'),
    profileHome: join(profileRoot, 'home'),
    profileConfig: join(profileRoot, 'config'),
    profileData: join(profileRoot, 'data'),
    profileCache: join(profileRoot, 'cache'),
    profileRuntime: join(profileRoot, 'runtime'),
  };
}

function runTargetUidPreflight(state) {
  const paths = profilePaths(state);
  const output = capture(
    'sudo',
    [
      '-n',
      'env',
      `ELEMENT_DESKTOP_PROFILE_ROOT=${paths.profileRoot}`,
      `ELEMENT_DESKTOP_STARTUP_SCRIPT_PATH=${paths.stagedStartup}`,
      `ELEMENT_DESKTOP_CONFIG_PATH=${paths.stagedConfig}`,
      `ELEMENT_DESKTOP_EGRESS_SCRIPT_PATH=${paths.stagedPolicy}`,
      process.execPath,
      POLICY_SCRIPT,
      'target-uid-preflight',
      String(state.uid),
      paths.stagedPolicy,
    ],
    { timeout: 15_000 },
  );
  let record;
  try {
    record = JSON.parse(output ?? '');
  } catch {
    record = undefined;
  }
  if (
    record?.phase !== 'target-uid-preflight' ||
    !['passed', 'failed'].includes(record.status)
  ) {
    record = {
      phase: 'target-uid-preflight',
      status: 'failed',
      runtimeFacts: null,
      scriptProbe: null,
    };
  }
  try {
    sanitizeDesktopStages([record], state.sourceSha);
  } catch {
    record = {
      phase: 'target-uid-preflight',
      status: 'failed',
      runtimeFacts: null,
      scriptProbe: null,
    };
  }
  appendStage(desktopStagePath(), record);
  if (record.status !== 'passed') throw failure('unsupported-runner');
}

function installDesktopPolicy(state) {
  const paths = profilePaths(state);
  state.policyMayBeInstalled = true;
  persistState(state);
  const installStatus = runQuietly('sudo', [
    '-n',
    process.execPath,
    POLICY_SCRIPT,
    ...buildDesktopPolicyArguments(state, 'install'),
  ]);
  let diagnostic;
  let negativeStatus;
  let resetStatus;
  if (installStatus === 0) {
    const output = capture(
      'sudo',
      [
        '-n',
        'env',
        `ELEMENT_DESKTOP_PROFILE_ROOT=${paths.profileRoot}`,
        process.execPath,
        POLICY_SCRIPT,
        ...buildDesktopPolicyArguments(state, 'negative-self-test', [
          paths.stagedPolicy,
        ]),
      ],
      { timeout: 20_000 },
    );
    try {
      diagnostic = JSON.parse(output ?? '');
    } catch {
      diagnostic = undefined;
    }
    negativeStatus =
      diagnostic?.passed === true &&
      typeof diagnostic === 'object' &&
      Object.keys(diagnostic).sort().join(',') === 'ipv4,ipv6,passed'
        ? 'passed'
        : 'failed';
    if (negativeStatus === 'passed') {
      resetStatus = runQuietly('sudo', [
        '-n',
        process.execPath,
        POLICY_SCRIPT,
        ...buildDesktopPolicyArguments(state, 'zero-counters'),
      ]);
      const verifiedCounters = capture(
        'sudo',
        [
          '-n',
          process.execPath,
          POLICY_SCRIPT,
          ...buildDesktopPolicyArguments(state, 'counters'),
        ],
        { timeout: 2_000 },
      );
      const counters = sanitizeEgressCounterObservation(verifiedCounters);
      if (
        resetStatus !== 0 ||
        counters.state !== 'observed' ||
        counters.policyState !== 'verified' ||
        counters.ipv4Blocked !== 0 ||
        counters.ipv6Blocked !== 0
      ) {
        resetStatus = undefined;
      }
    }
  }
  const status =
    installStatus === 0 && negativeStatus === 'passed' && resetStatus === 0
      ? 'passed'
      : 'failed';
  appendStage(desktopStagePath(), {
    phase: 'egress-policy',
    status,
    negativeTest: negativeStatus ?? 'not_run',
    diagnostic: diagnostic ?? null,
  });
  if (status !== 'passed') throw failure('cdp-not-loopback');
}

function parseStartupRecord(line) {
  if (typeof line !== 'string' || Buffer.byteLength(line) > 262_144) {
    return undefined;
  }
  let value;
  try {
    value = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    value.phase !== 'desktop-startup'
  ) {
    return undefined;
  }
  return value;
}

function getProgressCounter(state) {
  const output = capture(
    'timeout',
    [
      '--signal=TERM',
      '--kill-after=1s',
      '1s',
      'sudo',
      '-n',
      process.execPath,
      POLICY_SCRIPT,
      ...buildDesktopPolicyArguments(state, 'counters'),
    ],
    { timeout: 3_000 },
  );
  return sanitizeEgressCounterObservation(output);
}

function getUidStartupObservation(state, appPid, cdpRendererHandoff) {
  const args = [
    '--signal=TERM',
    '--kill-after=1s',
    '4s',
    'sudo',
    '-n',
    process.execPath,
    STARTUP_SCRIPT,
    'uid-startup-observation',
    String(state.uid),
    String(state.cdpPort),
  ];
  let input;
  if (Number.isSafeInteger(appPid) && appPid >= 2) {
    args.push(String(appPid));
    if (cdpRendererHandoff !== undefined) {
      args.push('--cdp-renderer-handoff');
      input = `${JSON.stringify(cdpRendererHandoff)}\n`;
    }
  }
  const output = capture('timeout', args, { input, timeout: 6_000 });
  return sanitizeUidStartupObservation(output);
}

function acknowledgeMilestone(state, milestone, progress) {
  const counters = getProgressCounter(state);
  let observation;
  if (milestone === 'before-app') {
    observation = getUidStartupObservation(state);
  } else if (milestone === 'after-app-spawn') {
    state.appPid = progress.appStartTimeTicks === null ? null : progress.appPid;
    state.appStartTimeTicks = progress.appStartTimeTicks;
    try {
      persistState(state);
    } catch {
      state.appPid = null;
      state.appStartTimeTicks = null;
    }
    observation = getUidStartupObservation(state, progress.appPid);
  } else {
    observation = getUidStartupObservation(
      state,
      progress.appPid,
      progress.cdpRendererHandoff,
    );
  }
  const marker = join(state.profileRoot, `.${milestone}-counter-read`);
  runQuietly(
    'timeout',
    [
      '--signal=TERM',
      '--kill-after=1s',
      '1s',
      'sudo',
      '-n',
      '-u',
      `#${state.uid}`,
      '--',
      'touch',
      marker,
    ],
    { timeout: 3_000 },
  );
  return { counter: counters, observation };
}

function signalDesktopJourneyCompletion(state) {
  const paths = profilePaths(state);
  const output = capture(
    'timeout',
    [
      '--signal=TERM',
      '--kill-after=1s',
      '3s',
      'sudo',
      '-n',
      '-u',
      `#${state.uid}`,
      '--',
      '/usr/bin/env',
      `ELEMENT_DESKTOP_PROFILE_ROOT=${state.profileRoot}`,
      `ELEMENT_DESKTOP_PROBE_UID=${state.uid}`,
      process.execPath,
      paths.stagedStartup,
      'desktop-journey-complete',
    ],
    { timeout: 5_000 },
  );
  try {
    const record = JSON.parse(output ?? '');
    return (
      record !== null &&
      typeof record === 'object' &&
      !Array.isArray(record) &&
      Object.keys(record).sort().join(',') === 'phase,status' &&
      record.phase === 'desktop-journey-completion' &&
      record.status === 'passed'
    );
  } catch {
    return false;
  }
}

function enrichStartupRecord(record, state, progressObservations, exitCode) {
  if (record === undefined) return undefined;
  const initialStatus = record.status;
  const initialFailureCode = record.failureCode;
  const initialNativeSandbox = record.checks?.nativeSandbox;
  const beforeApp =
    progressObservations.get('before-app')?.observation ??
    emptyUidStartupObservation('unavailable');
  const afterAppSpawn =
    progressObservations.get('after-app-spawn')?.observation ??
    emptyUidStartupObservation('unavailable');
  const afterPageLoad =
    progressObservations.get('after-page-load')?.observation ??
    emptyUidStartupObservation('unavailable');
  record.uidLifecycleDiagnostics = {
    beforeApp: beforeApp.uidLifecycleObservation,
    afterAppSpawn: afterAppSpawn.uidLifecycleObservation,
    afterPageLoad: afterPageLoad.uidLifecycleObservation,
  };
  record.uidTcpSocketDiagnostics = {
    beforeApp: beforeApp.tcpSocketObservation,
    afterPageLoad: afterPageLoad.tcpSocketObservation,
  };
  const acknowledgements = record.egressPhaseCounters ?? {};
  record.egressPhaseCounters = {
    beforeApp: acknowledgedEgressCounterObservation(
      progressObservations.get('before-app')?.counter,
      acknowledgements.beforeApp?.state,
    ),
    afterAppSpawn: acknowledgedEgressCounterObservation(
      progressObservations.get('after-app-spawn')?.counter,
      acknowledgements.afterAppSpawn?.state,
    ),
    afterPageLoad: acknowledgedEgressCounterObservation(
      progressObservations.get('after-page-load')?.counter,
      acknowledgements.afterPageLoad?.state,
    ),
  };
  const rendererSandbox = resolveTrustedRendererSandbox(
    record.rendererDiagnostics,
    record.uidLifecycleDiagnostics.afterPageLoad,
  );
  record.rendererDiagnostics = rendererSandbox.rendererDiagnostics;
  record.rendererCount = rendererSandbox.rendererCount;
  record.checks.nativeSandbox = rendererSandbox.passed ? 'passed' : 'failed';
  const otherChecksPassed = Object.entries(record.checks).every(
    ([name, status]) => name === 'nativeSandbox' || status === 'passed',
  );
  const pendingNativeOnly =
    exitCode === 1 &&
    initialStatus === 'failed' &&
    initialFailureCode === null &&
    initialNativeSandbox === 'not_run' &&
    otherChecksPassed;
  const alreadyPassed =
    exitCode === 0 &&
    initialStatus === 'passed' &&
    initialNativeSandbox === 'passed';
  const finalizedPassed =
    initialFailureCode === null &&
    rendererSandbox.passed &&
    otherChecksPassed &&
    (pendingNativeOnly || alreadyPassed);
  if (finalizedPassed) {
    record.failureCode = null;
    record.status = 'passed';
  } else {
    record.failureCode ??= rendererSandbox.passed
      ? 'probe-internal-error'
      : 'renderer-sandbox-unconfirmed';
    record.status = 'failed';
  }
  try {
    sanitizeDesktopStages([record], state.sourceSha);
  } catch {
    throw failure('desktop-not-ready');
  }
  writePrivateJson(state.resultPath, record);
  appendStage(desktopStagePath(), record);
  return record;
}

function createStartupController(state, mode, progressObservations) {
  const paths = profilePaths(state);
  const timeoutSeconds = mode === 'journey' ? '300s' : '150s';
  const appEnvironment = [
    `PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`,
    `HOME=${paths.profileHome}`,
    `XDG_CONFIG_HOME=${paths.profileConfig}`,
    `XDG_DATA_HOME=${paths.profileData}`,
    `XDG_CACHE_HOME=${paths.profileCache}`,
    `XDG_RUNTIME_DIR=${paths.profileRuntime}`,
    `GITHUB_RUN_ID=${state.runId}`,
    `GITHUB_RUN_ATTEMPT=${state.runAttempt}`,
    `ELEMENT_DESKTOP_SOURCE_SHA=${state.sourceSha}`,
    `ELEMENT_DESKTOP_PACKAGE_SHA256=${state.packageSha256}`,
    `ELEMENT_DESKTOP_PROFILE_ROOT=${paths.profileRoot}`,
    `ELEMENT_DESKTOP_CONFIG_PATH=${paths.stagedConfig}`,
    `ELEMENT_DESKTOP_CDP_PORT=${state.cdpPort}`,
    `ELEMENT_DESKTOP_PROBE_UID=${state.uid}`,
    'ELEMENT_DESKTOP_NO_UPDATE=true',
    ...(mode === 'journey' ? ['ELEMENT_DESKTOP_JOURNEY_HOLD=true'] : []),
  ];
  const args = [
    '--signal=TERM',
    '--kill-after=5s',
    timeoutSeconds,
    'sudo',
    '-n',
    '-u',
    `#${state.uid}`,
    '--',
    '/usr/bin/env',
    ...appEnvironment,
    'dbus-run-session',
    '--',
    'xvfb-run',
    '-a',
    process.execPath,
    paths.stagedStartup,
  ];
  let resolveReady;
  let resolveClosed;
  const readyPromise = new Promise((resolvePromise) => {
    resolveReady = resolvePromise;
  });
  const closedPromise = new Promise((resolvePromise) => {
    resolveClosed = resolvePromise;
  });
  const child = spawn('timeout', args, {
    cwd: WORKSPACE_ROOT,
    detached: true,
    env: createSystemCommandEnvironment(process.env),
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const controllerStartTimeTicks = readProcStartTimeTicks(child.pid);
  if (controllerStartTimeTicks !== null) {
    state.controllerPid = child.pid;
    state.controllerStartTimeTicks = controllerStartTimeTicks;
    try {
      persistState(state);
    } catch {
      state.controllerPid = null;
      state.controllerStartTimeTicks = null;
    }
  }
  let startupRecord;
  let protocolFailed = false;
  let ready = false;
  let expectedProgressIndex = 0;
  const progressSequence =
    mode === 'journey'
      ? [
          'before-app',
          'after-app-spawn',
          'after-page-load',
          'desktop-journey-ready',
        ]
      : ['before-app', 'after-app-spawn', 'after-page-load'];
  let progressQueue = Promise.resolve();
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  lines.on('line', (line) => {
    const progress = parseStartupProgressRecord(line);
    if (progress) {
      progressQueue = progressQueue
        .then(async () => {
          if (progress.milestone !== progressSequence[expectedProgressIndex]) {
            protocolFailed = true;
            return;
          }
          expectedProgressIndex += 1;
          if (progress.milestone === 'desktop-journey-ready') {
            ready = true;
            resolveReady(true);
            return;
          }
          progressObservations.set(
            progress.milestone,
            acknowledgeMilestone(state, progress.milestone, progress),
          );
        })
        .catch(() => {
          protocolFailed = true;
          resolveReady(false);
        });
      return;
    }
    const record = parseStartupRecord(line);
    if (record) {
      if (startupRecord !== undefined) {
        protocolFailed = true;
      } else {
        startupRecord = record;
      }
    }
  });
  child.once('error', () => {
    protocolFailed = true;
    resolveReady(false);
  });
  child.once('close', (code, signal) => {
    void progressQueue.finally(() => {
      resolveClosed({ code, signal });
      if (!ready) resolveReady(false);
    });
  });

  return {
    child,
    readyPromise,
    closedPromise,
    get startupRecord() {
      return startupRecord;
    },
    get protocolFailed() {
      return protocolFailed;
    },
    get ready() {
      return ready;
    },
  };
}

async function waitForStartupReady(controller) {
  let timeoutHandle;
  try {
    return await Promise.race([
      controller.readyPromise,
      controller.closedPromise.then(() => false),
      new Promise((resolvePromise) => {
        timeoutHandle = setTimeout(
          () => resolvePromise(false),
          STARTUP_WAIT_MS,
        );
      }),
    ]);
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
  }
}

async function waitForStartupClose(controller, timeoutMs) {
  let timeoutHandle;
  try {
    return await Promise.race([
      controller.closedPromise,
      new Promise((resolvePromise) => {
        timeoutHandle = setTimeout(() => resolvePromise(undefined), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
  }
}

async function stopStartupController(controller) {
  if (
    controller.child.exitCode !== null ||
    controller.child.signalCode !== null
  ) {
    return;
  }
  try {
    process.kill(-controller.child.pid, 'SIGTERM');
  } catch {
    try {
      controller.child.kill('SIGTERM');
    } catch {
      // The child may have exited between status check and signal.
    }
  }
  const closed = await waitForStartupClose(controller, STARTUP_EXIT_WAIT_MS);
  if (closed !== undefined) return;
  try {
    process.kill(-controller.child.pid, 'SIGKILL');
  } catch {
    try {
      controller.child.kill('SIGKILL');
    } catch {
      // The workflow cleanup repeats UID-scoped process removal.
    }
  }
  await waitForStartupClose(controller, 5_000);
}

export function classifyDesktopChildCompletion(result) {
  const unknown = {
    outcome: 'unknown',
    exitStatus: null,
    timedOut: false,
  };
  if (result === null || typeof result !== 'object' || Array.isArray(result)) {
    return unknown;
  }

  const status = result.status;
  const signal = result.signal ?? null;
  const error = result.error;
  if (error !== undefined) {
    if (
      error === null ||
      typeof error !== 'object' ||
      Array.isArray(error) ||
      typeof error.code !== 'string' ||
      !SPAWN_ERROR_CODE_PATTERN.test(error.code)
    ) {
      return unknown;
    }
    if (
      error.code === 'ETIMEDOUT' &&
      status === null &&
      (signal === null || signal === SPAWN_SYNC_TIMEOUT_SIGNAL)
    ) {
      return {
        outcome: 'timeout',
        exitStatus: null,
        timedOut: true,
      };
    }
    if (error.code !== 'ETIMEDOUT' && status === null && signal === null) {
      return {
        outcome: 'spawn_error',
        exitStatus: null,
        timedOut: false,
      };
    }
    return unknown;
  }

  if (
    status === null &&
    typeof signal === 'string' &&
    PROCESS_SIGNAL_PATTERN.test(signal)
  ) {
    return {
      outcome: 'signaled',
      exitStatus: null,
      timedOut: false,
    };
  }
  if (
    Number.isSafeInteger(status) &&
    status >= 0 &&
    status <= 255 &&
    signal === null
  ) {
    return {
      outcome: 'exited',
      exitStatus: status,
      timedOut: false,
    };
  }
  return unknown;
}

export function runDesktopCalendarJourney(
  config,
  state,
  spawnSyncRunner = spawnSync,
) {
  rmSync(config.playwrightOutput, { recursive: true, force: true });
  mkdirSync(config.playwrightOutput, { recursive: false, mode: 0o700 });
  chmodSync(config.playwrightOutput, 0o700);
  const env = createJourneyChildEnvironment(process.env, config, state);
  let result;
  try {
    result = spawnSyncRunner(
      'yarn',
      [
        'workspace',
        'e2e',
        'playwright',
        'test',
        '--config',
        'playwright.element-desktop-acceptance.config.ts',
        '--grep',
        'Element Desktop room event journey',
      ],
      {
        cwd: WORKSPACE_ROOT,
        env,
        encoding: 'utf8',
        stdio: 'ignore',
        timeout: PLAYWRIGHT_TIMEOUT_MS,
      },
    );
  } catch {
    result = undefined;
  }
  const completion = classifyDesktopChildCompletion(result);
  appendStage(config.journeyStageFile, {
    type: 'desktop-child-completion',
    sourceSha: state.sourceSha,
    desktopChildCompletion: completion,
  });
  if (completion.outcome !== 'exited' || completion.exitStatus !== 0) {
    throw failure('desktop-not-ready');
  }
  return completion;
}

async function runDesktopStartup(config, state, mode) {
  const progressObservations = new Map();
  const controller = createStartupController(state, mode, progressObservations);
  let journeyFailure;
  let closeResult;
  try {
    if (mode === 'journey') {
      if (!(await waitForStartupReady(controller))) {
        throw failure('desktop-not-ready');
      }
      runDesktopCalendarJourney(config, state);
    } else {
      closeResult = await waitForStartupClose(controller, 140_000);
      if (closeResult === undefined) throw failure('desktop-not-ready');
    }
  } catch (error) {
    journeyFailure = error;
  } finally {
    if (mode === 'journey' && controller.ready) {
      const completionWritten = signalDesktopJourneyCompletion(state);
      if (!completionWritten) journeyFailure ??= failure('desktop-not-ready');
      closeResult = await waitForStartupClose(controller, STARTUP_EXIT_WAIT_MS);
    }
    if (closeResult === undefined) {
      await stopStartupController(controller);
    }
  }

  closeResult ??= await waitForStartupClose(controller, 0);
  const finalized = enrichStartupRecord(
    controller.startupRecord,
    state,
    progressObservations,
    closeResult?.code ?? null,
  );
  if (
    finalized?.status !== 'passed' ||
    controller.protocolFailed ||
    journeyFailure !== undefined
  ) {
    throw failure(
      finalized?.failureCode === 'renderer-sandbox-unconfirmed'
        ? 'renderer-sandbox-unconfirmed'
        : 'desktop-not-ready',
    );
  }
}

function initializeDesktopStage(path) {
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    if (existsSync(path)) throw failure();
    writeFileSync(path, '', { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    return;
  }
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    stat.uid !== process.getuid?.() ||
    (stat.mode & 0o777) !== 0o600 ||
    stat.size !== 0
  ) {
    throw failure();
  }
}

async function prepareAndRun(config, mode) {
  initializeDesktopStage(config.stageFile);
  const state = await createPrivateProfile(config, mode);
  runTargetUidPreflight(state);
  const packageInfo = installPinnedDesktopPackage(config.runnerTemp);
  state.packageSha256 = packageInfo.packageHash;
  persistState(state);
  installDesktopPolicy(state);
  await runDesktopStartup(config, state, mode);
}

function readDesktopStagePhases(path) {
  if (!existsSync(path)) return new Set();
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    throw failure();
  }
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    stat.uid !== process.getuid?.() ||
    (stat.mode & 0o777) !== 0o600 ||
    stat.size > DESKTOP_EVIDENCE_MAX_BYTES
  ) {
    throw failure();
  }
  const phases = new Set();
  for (const row of readFileSync(path, 'utf8')
    .split(/\r?\n/u)
    .filter(Boolean)) {
    let value;
    try {
      value = JSON.parse(row);
    } catch {
      throw failure();
    }
    if (
      value === null ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      typeof value.phase !== 'string' ||
      phases.has(value.phase)
    ) {
      throw failure();
    }
    phases.add(value.phase);
  }
  return phases;
}

function uidStopCensusFromLifecycle(
  input,
  outcome,
  exitStatus = null,
  stderr = UNAVAILABLE_UID_CENSUS_STDERR,
) {
  const observation = sanitizeUidLifecycleObservation(input);
  const available = ['observed', 'partial'].includes(observation.state);
  const census = available
    ? {
        state: observation.state,
        overflow: observation.overflow,
        stderrOutcome: stderr.outcome,
        stderrEmitter: stderr.emitter,
        stderrLineShape: stderr.lineShape,
        stderrPrefixCounts: stderr.prefixCounts,
        stderrPrefixOverflow: stderr.prefixOverflow,
        uidProcessCount: observation.uidProcessCount,
        effectiveUidMatchCount: observation.effectiveUidMatchCount,
        nonEffectiveUidOnlyCount: observation.nonEffectiveUidOnlyCount,
        nonZombieProcessCount: observation.nonZombieProcessCount,
        zombieCount: observation.zombieCount,
        unreadableProcessCount: observation.unreadableProcessCount,
        unattributedProcessCount: observation.unattributedProcessCount,
        processClassCounts: observation.processClassCounts,
        processRoleCounts: observation.processRoleCounts,
      }
    : {
        state: 'unavailable',
        overflow: null,
        stderrOutcome: stderr.outcome,
        stderrEmitter: stderr.emitter,
        stderrLineShape: stderr.lineShape,
        stderrPrefixCounts: stderr.prefixCounts,
        stderrPrefixOverflow: stderr.prefixOverflow,
        uidProcessCount: null,
        effectiveUidMatchCount: null,
        nonEffectiveUidOnlyCount: null,
        nonZombieProcessCount: null,
        zombieCount: null,
        unreadableProcessCount: null,
        unattributedProcessCount: null,
        processClassCounts: null,
        processRoleCounts: null,
      };
  census.outcome =
    outcome ??
    (!available
      ? 'unavailable'
      : observation.overflow
        ? 'overflow'
        : 'observed');
  census.exitStatus = exitStatus;
  return census;
}

function capturedUidStopCensus(input, outcome, exitStatus, stderr) {
  const census = uidStopCensusFromLifecycle(input, outcome, exitStatus, stderr);
  Object.defineProperty(census, UID_STOP_CENSUS_CAPTURE, { value: true });
  return census;
}

function hasUidCensusStderrPrefix(bytes, start, end, prefix) {
  if (end - start < prefix.length) return false;
  for (let index = 0; index < prefix.length; index += 1) {
    if (bytes[start + index] !== prefix.charCodeAt(index)) return false;
  }
  return true;
}

function classifyUidCensusStderrPrefix(bytes, start, end) {
  if (
    hasUidCensusStderrPrefix(
      bytes,
      start,
      end,
      'timeout: warning: timer_create:',
    ) ||
    hasUidCensusStderrPrefix(
      bytes,
      start,
      end,
      'timeout: warning: timer_settime:',
    ) ||
    hasUidCensusStderrPrefix(bytes, start, end, 'timeout: warning: setitimer:')
  ) {
    return 'timeoutTimerWarning';
  }
  if (
    hasUidCensusStderrPrefix(
      bytes,
      start,
      end,
      'timeout: fork system call failed:',
    )
  ) {
    return 'timeoutForkFailure';
  }
  if (
    hasUidCensusStderrPrefix(
      bytes,
      start,
      end,
      'timeout: error waiting for command:',
    )
  ) {
    return 'timeoutWaitFailure';
  }
  if (hasUidCensusStderrPrefix(bytes, start, end, 'timeout:')) {
    return 'timeoutOther';
  }
  if (hasUidCensusStderrPrefix(bytes, start, end, 'sudo:')) return 'sudo';
  if (hasUidCensusStderrPrefix(bytes, start, end, 'node:')) {
    return 'nodeRuntime';
  }
  return 'other';
}

function uidCensusStderrEmitter(prefix) {
  if (
    prefix === 'timeoutForkFailure' ||
    prefix === 'timeoutWaitFailure' ||
    prefix === 'timeoutTimerWarning' ||
    prefix === 'timeoutOther'
  ) {
    return 'timeout';
  }
  if (prefix === 'nodeRuntime') return 'node-runtime';
  if (prefix === 'sudo') return 'sudo';
  return 'other';
}

function classifyUidCensusStderr(
  bytes,
  length,
  { available, overflow, status },
) {
  if (!available || overflow) return UNAVAILABLE_UID_CENSUS_STDERR;

  const prefixCounts = Object.fromEntries(
    UID_CENSUS_STDERR_PREFIX_CATEGORIES.map((name) => [name, 0]),
  );
  let lineCount = 0;
  let firstLineEmitter = null;
  let firstLinePrefix = null;
  let conflictingEmitters = false;
  let lineStart = 0;
  for (let index = 0; index <= length; index += 1) {
    if (index !== length && bytes[index] !== 0x0a) continue;
    let lineEnd = index;
    if (lineEnd > lineStart && bytes[lineEnd - 1] === 0x0d) lineEnd -= 1;
    if (lineEnd > lineStart) {
      const linePrefix = classifyUidCensusStderrPrefix(
        bytes,
        lineStart,
        lineEnd,
      );
      prefixCounts[linePrefix] += 1;
      const lineEmitter = uidCensusStderrEmitter(linePrefix);
      if (lineCount === 0) {
        firstLineEmitter = lineEmitter;
        firstLinePrefix = linePrefix;
      } else if (
        firstLineEmitter !== 'other' &&
        lineEmitter !== 'other' &&
        lineEmitter !== firstLineEmitter
      ) {
        conflictingEmitters = true;
      }
      lineCount += 1;
    }
    lineStart = index + 1;
  }
  if (lineCount === 0) {
    return {
      outcome: 'absent',
      emitter: 'other',
      lineShape: 'empty',
      prefixCounts,
      prefixOverflow: false,
    };
  }

  const lineShape = lineCount === 1 ? 'single' : 'multiple';
  const emitter = conflictingEmitters ? 'other' : firstLineEmitter;
  let outcome = 'other';

  // GNU coreutils v9.4 emits signal-send diagnostics only with --verbose and
  // returns 125 for these fork/wait failures (source: timeout.c, lines 201-223
  // and 491-530; https://github.com/coreutils/coreutils/blob/v9.4/src/timeout.c).
  // This invocation omits --verbose. Match only the fixed prefix, never the
  // variable strerror suffix; runtime version is not asserted.
  if (
    status === 125 &&
    lineShape === 'single' &&
    firstLinePrefix === 'timeoutForkFailure'
  ) {
    outcome = 'timeout-fork-failure';
  } else if (
    status === 125 &&
    lineShape === 'single' &&
    firstLinePrefix === 'timeoutWaitFailure'
  ) {
    outcome = 'timeout-wait-failure';
  }

  return {
    outcome,
    emitter,
    lineShape,
    prefixCounts: Object.fromEntries(
      UID_CENSUS_STDERR_PREFIX_CATEGORIES.map((name) => [
        name,
        Math.min(prefixCounts[name], UID_CENSUS_STDERR_PREFIX_COUNT_MAX),
      ]),
    ),
    prefixOverflow: lineCount > UID_CENSUS_STDERR_PREFIX_COUNT_MAX,
  };
}

function captureUidStopCensus(state, spawnChild = spawn) {
  return new Promise((resolveCensus) => {
    let output = '';
    let overflow = false;
    const stderr = Buffer.alloc(UID_CENSUS_STDERR_MAX_BYTES);
    let stderrLength = 0;
    let stderrOverflow = false;
    let stderrAvailable = true;
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      stderr.fill(0);
      stderrLength = 0;
      resolveCensus(value);
    };
    let child;
    try {
      child = spawnChild(
        'timeout',
        [
          '--signal=TERM',
          '--kill-after=0.25s',
          '1s',
          'sudo',
          '-n',
          process.execPath,
          STARTUP_SCRIPT,
          'uid-lifecycle-observation',
          String(state.uid),
        ],
        {
          // timeout(1) localizes its stderr using LC_ALL; keep the bounded
          // prefix classifier deterministic for this census child only.
          env: {
            ...createSystemCommandEnvironment(process.env),
            LC_ALL: 'C',
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
    } catch {
      finish(
        capturedUidStopCensus(
          undefined,
          'spawn-error',
          null,
          UNAVAILABLE_UID_CENSUS_STDERR,
        ),
      );
      return;
    }
    child.stdout.on('data', (chunk) => {
      if (overflow) return;
      if (Buffer.byteLength(output) + chunk.length > UID_CENSUS_MAX_BYTES) {
        overflow = true;
        output = '';
        return;
      }
      output += chunk.toString('utf8');
    });
    if (child.stderr && typeof child.stderr.on === 'function') {
      child.stderr.on('data', (chunk) => {
        if (stderrOverflow) return;
        const byteChunk = Buffer.isBuffer(chunk) ? chunk : undefined;
        const chunkLength = byteChunk
          ? byteChunk.byteLength
          : Buffer.byteLength(String(chunk));
        if (stderrLength + chunkLength > UID_CENSUS_STDERR_MAX_BYTES) {
          stderrOverflow = true;
          stderr.fill(0);
          stderrLength = 0;
          return;
        }
        const stderrChunk = byteChunk ?? Buffer.from(String(chunk));
        stderrChunk.copy(stderr, stderrLength);
        stderrLength += chunkLength;
      });
    } else {
      stderrAvailable = false;
    }
    child.once('error', () =>
      finish(
        capturedUidStopCensus(
          undefined,
          'spawn-error',
          null,
          UNAVAILABLE_UID_CENSUS_STDERR,
        ),
      ),
    );
    child.once('close', (status, signal) => {
      const stderrDiagnostics = classifyUidCensusStderr(stderr, stderrLength, {
        available: stderrAvailable,
        overflow: stderrOverflow,
        status: signal === null ? status : null,
      });
      if (signal !== null) {
        finish(
          capturedUidStopCensus(undefined, 'signal', null, stderrDiagnostics),
        );
        return;
      }
      if (status !== 0) {
        const exitStatus =
          Number.isSafeInteger(status) && status >= 0 && status <= 255
            ? status
            : null;
        finish(
          capturedUidStopCensus(
            undefined,
            status === 124
              ? 'timeout'
              : exitStatus === null
                ? 'unavailable'
                : 'nonzero-exit',
            exitStatus,
            stderrDiagnostics,
          ),
        );
        return;
      }
      if (overflow) {
        finish(
          capturedUidStopCensus(undefined, 'overflow', 0, stderrDiagnostics),
        );
        return;
      }
      let observation;
      try {
        observation = JSON.parse(output);
      } catch {
        finish(
          capturedUidStopCensus(undefined, 'malformed', 0, stderrDiagnostics),
        );
        return;
      }
      if (!isValidUidLifecycleObservation(observation)) {
        finish(
          capturedUidStopCensus(undefined, 'malformed', 0, stderrDiagnostics),
        );
        return;
      }
      const sanitized = sanitizeUidLifecycleObservation(observation);
      if (!['observed', 'partial'].includes(sanitized.state)) {
        finish(
          capturedUidStopCensus(undefined, 'unavailable', 0, stderrDiagnostics),
        );
        return;
      }
      finish(
        capturedUidStopCensus(
          sanitized,
          sanitized.overflow ? 'overflow' : 'observed',
          0,
          stderrDiagnostics,
        ),
      );
    });
  });
}

function waitForUidStopCensus(census, checkpoint, state, timeoutMs) {
  let timer;
  return Promise.race([
    Promise.resolve()
      .then(() => census(state, checkpoint))
      .then((result) =>
        result?.[UID_STOP_CENSUS_CAPTURE]
          ? result
          : uidStopCensusFromLifecycle(result),
      )
      .catch(() => uidStopCensusFromLifecycle(undefined)),
    new Promise((resolveTimeout) => {
      timer = setTimeout(
        () => resolveTimeout(uidStopCensusFromLifecycle(undefined, 'timeout')),
        timeoutMs,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

function pgrepInspection(status) {
  return status === 0 ? 'present' : status === 1 ? 'absent' : 'unavailable';
}

function signalOutcome(status) {
  return status === 0
    ? 'sent'
    : status === 1
      ? 'no_process'
      : Number.isInteger(status)
        ? 'failed'
        : 'unavailable';
}

export async function stopUidProcesses(
  state,
  {
    runCommand = runQuietly,
    wait = (duration) =>
      new Promise((resolveWait) => setTimeout(resolveWait, duration)),
    census,
    spawnCensus = spawn,
    targetMatches = () => true,
  } = {},
) {
  const captureCensus =
    census ?? ((censusState) => captureUidStopCensus(censusState, spawnCensus));
  const diagnostics = emptyUidProcessStopDiagnostics();
  const inspect = () => {
    try {
      return runCommand('pgrep', ['-u', String(state.uid)], {
        timeout: 2_000,
      });
    } catch {
      return undefined;
    }
  };
  const signal = (name) => {
    let stillTarget = false;
    try {
      stillTarget = targetMatches() === true;
    } catch {
      stillTarget = false;
    }
    if (!stillTarget) return 'failed';
    let status;
    try {
      status = runCommand(
        'sudo',
        ['-n', 'pkill', `-${name}`, '-u', String(state.uid)],
        { timeout: 2_000 },
      );
    } catch {
      status = undefined;
    }
    return signalOutcome(status);
  };

  const initialCensus = waitForUidStopCensus(
    captureCensus,
    'initial',
    state,
    UID_STOP_CENSUS_WAIT_LIMITS_MS.initial,
  );
  const initialStatus = inspect();
  diagnostics.initial.inspection = pgrepInspection(initialStatus);
  diagnostics.initial.census = await initialCensus;
  if (initialStatus !== 0) {
    diagnostics.status = initialStatus === 1 ? 'passed' : 'failed';
    return { status: diagnostics.status, diagnostics };
  }

  diagnostics.termSignal = signal('TERM');
  const postTermCensus = waitForUidStopCensus(
    captureCensus,
    'post-term',
    state,
    UID_STOP_CENSUS_WAIT_LIMITS_MS.postTerm,
  );
  await wait(2_000);
  const postTermStatus = inspect();
  diagnostics.postTerm.inspection = pgrepInspection(postTermStatus);
  diagnostics.postTerm.census = await postTermCensus;
  if (postTermStatus === 0) {
    diagnostics.killSignal = signal('KILL');
    const postKillCensus = waitForUidStopCensus(
      captureCensus,
      'post-kill',
      state,
      UID_STOP_CENSUS_WAIT_LIMITS_MS.postKill,
    );
    await wait(1_000);
    const postKillStatus = inspect();
    diagnostics.postKill.inspection = pgrepInspection(postKillStatus);
    diagnostics.postKill.census = await postKillCensus;
    diagnostics.status = postKillStatus === 1 ? 'passed' : 'failed';
    return { status: diagnostics.status, diagnostics };
  }
  diagnostics.status = postTermStatus === 1 ? 'passed' : 'failed';
  return { status: diagnostics.status, diagnostics };
}

export async function retryLateEffectiveUidStop(
  state,
  initialStopResult,
  observationBeforeRetry,
  { stop = stopUidProcesses, capture = captureFinalUidLifecycle } = {},
) {
  const initialDiagnostics = initialStopResult?.diagnostics;
  const retryIsIndicated =
    initialStopResult?.status === 'passed' &&
    initialDiagnostics?.initial?.inspection === 'absent' &&
    initialDiagnostics.termSignal === 'not_attempted' &&
    initialDiagnostics.killSignal === 'not_attempted' &&
    isValidUidLifecycleObservation(observationBeforeRetry) &&
    observationBeforeRetry.state === 'observed' &&
    observationBeforeRetry.overflow === false &&
    observationBeforeRetry.effectiveUidMatchCount > 0;
  if (!retryIsIndicated) {
    return {
      stopResult: initialStopResult,
      observation: observationBeforeRetry,
      lateUidRetry: null,
    };
  }

  const retryResult = await stop(state);
  const freshObservation = sanitizeUidLifecycleObservation(
    await capture(state),
  );
  return {
    stopResult: retryResult,
    observation: freshObservation,
    lateUidRetry: {
      triggerUidProcessObservation: uidProcessObservationFromLifecycle(
        observationBeforeRetry,
      ),
      stopDiagnostics: retryResult.diagnostics,
    },
  };
}

export async function retryFinalUidCleanup(
  state,
  initialStopResult,
  priorLateUidRetry,
  user,
  finalObservation,
  {
    stop,
    capture = captureFinalUidLifecycle,
    accountMatches = (target) => {
      const account = lookupPasswdAccount(target.username);
      return account.state === 'present' && account.uid === target.uid;
    },
    deleteUser = (target) => cleanupUser(target, true),
  } = {},
) {
  const initialDiagnostics = initialStopResult?.diagnostics;
  const retryIsIndicated =
    priorLateUidRetry === null &&
    user?.accountState === 'uid_match' &&
    user?.userdelStatus === 'failed' &&
    user?.userdelExitStatus === 8 &&
    initialStopResult?.status === 'passed' &&
    initialDiagnostics?.initial?.inspection === 'absent' &&
    initialDiagnostics.termSignal === 'not_attempted' &&
    initialDiagnostics.killSignal === 'not_attempted' &&
    isValidUidLifecycleObservation(finalObservation) &&
    finalObservation.state === 'observed' &&
    finalObservation.overflow === false &&
    finalObservation.uidProcessCount > 0 &&
    finalObservation.effectiveUidMatchCount > 0;
  if (!retryIsIndicated) {
    return {
      stopResult: initialStopResult,
      user,
      observation: finalObservation,
      beforeRetryDeleteObservation: null,
      lateUidRetry: priorLateUidRetry,
    };
  }

  let accountMatchesBeforeStop = false;
  try {
    accountMatchesBeforeStop = (await accountMatches(state)) === true;
  } catch {
    accountMatchesBeforeStop = false;
  }
  if (!accountMatchesBeforeStop) {
    return {
      stopResult: initialStopResult,
      user,
      observation: finalObservation,
      beforeRetryDeleteObservation: null,
      lateUidRetry: priorLateUidRetry,
    };
  }

  const guardedStop =
    stop ??
    ((target) =>
      stopUidProcesses(target, {
        targetMatches: () => {
          try {
            return accountMatches(target) === true;
          } catch {
            return false;
          }
        },
      }));
  const retry = await retryLateEffectiveUidStop(
    state,
    initialStopResult,
    finalObservation,
    { stop: guardedStop, capture },
  );
  const clearBeforeRetryDelete =
    retry.stopResult.status === 'passed' &&
    isValidUidLifecycleObservation(retry.observation) &&
    retry.observation.state === 'observed' &&
    retry.observation.overflow === false &&
    retry.observation.uidProcessCount === 0;
  if (!clearBeforeRetryDelete) {
    return {
      stopResult: retry.stopResult,
      user,
      observation: retry.observation,
      beforeRetryDeleteObservation: null,
      lateUidRetry: retry.lateUidRetry,
    };
  }

  let accountMatchesBeforeDelete = false;
  try {
    accountMatchesBeforeDelete = (await accountMatches(state)) === true;
  } catch {
    accountMatchesBeforeDelete = false;
  }
  if (!accountMatchesBeforeDelete) {
    return {
      stopResult: retry.stopResult,
      user,
      observation: retry.observation,
      beforeRetryDeleteObservation: null,
      lateUidRetry: retry.lateUidRetry,
    };
  }

  let retriedUser = user;
  try {
    retriedUser = await deleteUser(state);
  } catch {
    retriedUser = {
      status: 'failed',
      userdelStatus: 'not_run',
      userdelExitStatus: null,
      accountState: 'unavailable',
    };
  }
  return {
    stopResult: retry.stopResult,
    user: retriedUser,
    observation: sanitizeUidLifecycleObservation(await capture(state)),
    beforeRetryDeleteObservation: retry.observation,
    lateUidRetry: retry.lateUidRetry,
  };
}

function captureFinalEgress(state) {
  const output = capture(
    'timeout',
    [
      '--signal=TERM',
      '--kill-after=1s',
      '3s',
      'sudo',
      '-n',
      process.execPath,
      POLICY_SCRIPT,
      ...buildDesktopPolicyArguments(state, 'counters'),
    ],
    { timeout: 5_000 },
  );
  const counters = sanitizeEgressCounterObservation(output);
  if (
    !['observed', 'partial'].includes(counters.state) ||
    counters.policyState !== 'verified'
  ) {
    return {
      phase: 'egress-observation',
      status: 'failed',
      policyState: counters.policyState,
      ipv4Blocked: null,
      ipv6Blocked: null,
      ipv4Classes: null,
      ipv6Classes: null,
      overflow: null,
    };
  }
  return {
    phase: 'egress-observation',
    status: 'passed',
    policyState: counters.policyState,
    ipv4Blocked: counters.ipv4Blocked,
    ipv6Blocked: counters.ipv6Blocked,
    ipv4Classes: counters.ipv4Classes,
    ipv6Classes: counters.ipv6Classes,
    overflow: counters.overflow,
  };
}

function captureFinalUidLifecycle(state) {
  const output = capture(
    'timeout',
    [
      '--signal=TERM',
      '--kill-after=1s',
      '7s',
      'sudo',
      '-n',
      process.execPath,
      STARTUP_SCRIPT,
      'uid-lifecycle-observation',
      String(state.uid),
    ],
    { timeout: 9_000 },
  );
  return sanitizeUidLifecycleObservation(output);
}

function captureCleanupOriginProbe(state, finalLifecycle) {
  if (
    finalLifecycle?.state === 'observed' &&
    finalLifecycle.uidProcessCount === 0
  ) {
    return emptyCleanupOriginProbe('not_required', 'no_final_processes');
  }
  if (
    !['observed', 'partial'].includes(finalLifecycle?.state) ||
    !Number.isSafeInteger(finalLifecycle.uidProcessCount) ||
    finalLifecycle.uidProcessCount < 1
  ) {
    return emptyCleanupOriginProbe('unknown', 'final_census_unavailable');
  }
  const request = {
    uid: state.uid,
    runId: state.runId,
    runAttempt: state.runAttempt,
    profileRoot: state.profileRoot,
    appPid: state.appPid,
    appStartTimeTicks: state.appStartTimeTicks,
    controllerPid: state.controllerPid,
    controllerStartTimeTicks: state.controllerStartTimeTicks,
  };
  const output = capture(
    'timeout',
    [
      '--signal=TERM',
      '--kill-after=1s',
      '12s',
      'sudo',
      '-n',
      process.execPath,
      STARTUP_SCRIPT,
      'cleanup-origin-observation',
    ],
    { input: `${JSON.stringify(request)}\n`, timeout: 15_000 },
  );
  return sanitizeCleanupOriginProbe(output);
}

function cleanupPolicy(state) {
  return (
    runQuietly(
      'sudo',
      [
        '-n',
        process.execPath,
        POLICY_SCRIPT,
        ...buildDesktopPolicyArguments(state, 'remove'),
      ],
      { timeout: 10_000 },
    ) === 0
  );
}

export function cleanupUser(state, allowDeletion, commandRunner = spawnSync) {
  const account = lookupPasswdAccount(state.username, commandRunner);
  let userdelStatus = 'not_run';
  let userdelExitStatus = null;
  let status = account.state === 'unavailable' ? 'failed' : 'passed';
  if (account.state === 'present') {
    if (account.uid !== state.uid) {
      status = 'failed';
    } else if (!state.userMayBeCreated || !allowDeletion) {
      status = 'failed';
    } else {
      userdelExitStatus = runQuietly(
        'timeout',
        [
          '--signal=TERM',
          '--kill-after=1s',
          '10s',
          'sudo',
          '-n',
          'userdel',
          state.username,
        ],
        { timeout: 12_000 },
      );
      userdelStatus = userdelExitStatus === 0 ? 'passed' : 'failed';
      if (userdelStatus !== 'passed') status = 'failed';
    }
  }
  const afterDelete = lookupPasswdAccount(state.username, commandRunner);
  let accountState = 'unavailable';
  if (afterDelete.state === 'absent') {
    accountState = 'absent';
  } else if (afterDelete.state === 'present') {
    accountState = afterDelete.uid === state.uid ? 'uid_match' : 'uid_mismatch';
    status = 'failed';
  } else {
    status = 'failed';
  }
  if (account.state === 'unavailable') status = 'failed';
  return { status, userdelStatus, userdelExitStatus, accountState };
}

export function cleanupProofAllowsPolicyRemoval({
  processStatus,
  beforeUserdelClear,
  finalUidClear,
  user,
}) {
  return (
    processStatus === 'passed' &&
    beforeUserdelClear === true &&
    finalUidClear === true &&
    user?.status === 'passed' &&
    user.accountState === 'absent'
  );
}

function cleanupProfile(state, allowCleanup) {
  const profileRoot = state.profileRoot;
  if (!allowCleanup) {
    return runQuietly('sudo', ['-n', 'test', '!', '-e', profileRoot]) === 0
      ? 'passed'
      : 'failed';
  }
  const rootStatText = capture('sudo', [
    '-n',
    'stat',
    '-c',
    '%F %u %a',
    profileRoot,
  ]);
  if (rootStatText === undefined) {
    return runQuietly('sudo', ['-n', 'test', '!', '-e', profileRoot]) === 0
      ? 'passed'
      : 'failed';
  }
  const [fileType, uidText, mode] = rootStatText.trim().split(/\s+/u);
  const rootUid = Number(uidText);
  if (
    fileType !== 'directory' ||
    ![state.uid, process.getuid?.()].includes(rootUid) ||
    mode !== '700' ||
    runQuietly('sudo', ['-n', 'test', '!', '-L', profileRoot]) !== 0
  ) {
    return 'failed';
  }
  const markerPath = join(profileRoot, '.owned');
  const markerStatText = capture('sudo', [
    '-n',
    'stat',
    '-c',
    '%u %a %h %F',
    markerPath,
  ]);
  if (markerStatText !== undefined) {
    const [markerUidText, markerMode, linksText, ...typeParts] = markerStatText
      .trim()
      .split(/\s+/u);
    const markerType = typeParts.join(' ');
    const markerUid = Number(markerUidText);
    const markerContent = capture('sudo', ['-n', 'cat', '--', markerPath]);
    if (
      markerType !== 'regular file' ||
      ![state.uid, process.getuid?.()].includes(markerUid) ||
      markerMode !== '600' ||
      linksText !== '1' ||
      markerContent !== 'element-desktop-startup-profile-v1\n' ||
      runQuietly('sudo', ['-n', 'test', '!', '-L', markerPath]) !== 0
    ) {
      return 'failed';
    }
  } else if (rootUid !== process.getuid?.()) {
    return 'failed';
  }
  if (
    runQuietly('sudo', ['-n', 'rm', '-rf', '--', profileRoot], {
      timeout: 15_000,
    }) !== 0 ||
    runQuietly('sudo', ['-n', 'test', '!', '-e', profileRoot]) !== 0
  ) {
    return 'failed';
  }
  return 'passed';
}

function cleanupAptArtifacts(runnerTemp) {
  const sourceFile = '/etc/apt/sources.list.d/element-desktop-startup.list';
  const systemKey = '/usr/share/keyrings/element-desktop-startup.gpg';
  const localFiles = [
    join(runnerTemp, 'element-io-archive-keyring.gpg'),
    join(runnerTemp, `element-desktop_${PACKAGE_VERSION}_amd64.deb`),
    join(runnerTemp, DESKTOP_RESULT_NAME),
  ];
  const removeSystem = runQuietly('sudo', [
    '-n',
    'rm',
    '-f',
    '--',
    sourceFile,
    systemKey,
  ]);
  let localRemoved = true;
  for (const path of localFiles) {
    try {
      rmSync(path, { force: true });
    } catch {
      localRemoved = false;
    }
  }
  const systemAbsent = [sourceFile, systemKey].every(
    (path) => runQuietly('sudo', ['-n', 'test', '!', '-e', path]) === 0,
  );
  return (
    removeSystem === 0 &&
    localRemoved &&
    systemAbsent &&
    localFiles.every((path) => !existsSync(path))
  );
}

async function cleanupRunner(config) {
  let state;
  let stateInvalid = false;
  try {
    state = readState();
  } catch {
    stateInvalid = true;
  }
  const phases = readDesktopStagePhases(config.stageFile);
  let processStatus = 'not_run';
  let policyStatus = 'not_run';
  let user = {
    status: 'not_run',
    userdelStatus: 'not_run',
    userdelExitStatus: null,
    accountState: 'not_observed',
  };
  let profileStatus = 'not_run';
  let stopDiagnostics = emptyUidProcessStopDiagnostics();
  let lateUidRetry = null;
  let cleanupOriginProbe = emptyCleanupOriginProbe(
    'unknown',
    'final_census_unavailable',
  );
  let lifecycleBeforeUserdel = emptyUidLifecycleObservation('not_observed');
  let finalLifecycle = emptyUidLifecycleObservation('not_observed');
  let egressObservation = {
    phase: 'egress-observation',
    status: 'failed',
    policyState: 'unavailable',
    ipv4Blocked: null,
    ipv6Blocked: null,
    ipv4Classes: null,
    ipv6Classes: null,
    overflow: null,
  };
  if (state !== undefined && !stateInvalid) {
    const stopResult = await stopUidProcesses(state);
    processStatus = stopResult.status;
    stopDiagnostics = stopResult.diagnostics;
    egressObservation = captureFinalEgress(state);
    lifecycleBeforeUserdel = captureFinalUidLifecycle(state);
    const reconciledStop = await retryLateEffectiveUidStop(
      state,
      stopResult,
      lifecycleBeforeUserdel,
    );
    processStatus = reconciledStop.stopResult.status;
    lateUidRetry = reconciledStop.lateUidRetry;
    lifecycleBeforeUserdel = reconciledStop.observation;
    const beforeUserdelClear =
      lifecycleBeforeUserdel.state === 'observed' &&
      lifecycleBeforeUserdel.uidProcessCount === 0;
    user = cleanupUser(state, processStatus === 'passed' && beforeUserdelClear);
    finalLifecycle = captureFinalUidLifecycle(state);
    const finalRetry = await retryFinalUidCleanup(
      state,
      stopResult,
      lateUidRetry,
      user,
      finalLifecycle,
    );
    if (finalRetry.lateUidRetry !== lateUidRetry) {
      processStatus = finalRetry.stopResult.status;
      user = finalRetry.user;
      finalLifecycle = finalRetry.observation;
      lateUidRetry = finalRetry.lateUidRetry;
      if (finalRetry.beforeRetryDeleteObservation !== null) {
        lifecycleBeforeUserdel = finalRetry.beforeRetryDeleteObservation;
      }
    }
    const finalUidClear =
      finalLifecycle.state === 'observed' &&
      finalLifecycle.uidProcessCount === 0;
    const finalBeforeUserdelClear =
      lifecycleBeforeUserdel.state === 'observed' &&
      lifecycleBeforeUserdel.uidProcessCount === 0;
    const cleanupProof = cleanupProofAllowsPolicyRemoval({
      processStatus,
      beforeUserdelClear: finalBeforeUserdelClear,
      finalUidClear,
      user,
    });
    if (cleanupProof) {
      policyStatus =
        !state.policyMayBeInstalled || cleanupPolicy(state)
          ? 'passed'
          : 'failed';
      profileStatus = cleanupProfile(state, true);
    } else {
      policyStatus = state.policyMayBeInstalled ? 'retained' : 'not_run';
      profileStatus = cleanupProfile(state, false);
    }
    cleanupOriginProbe = captureCleanupOriginProbe(state, finalLifecycle);
  }
  const aptStatus = cleanupAptArtifacts(config.runnerTemp)
    ? 'passed'
    : 'failed';
  if (!phases.has('egress-observation')) {
    appendStage(config.stageFile, egressObservation);
  }
  if (!phases.has('cleanup')) {
    appendStage(config.stageFile, {
      phase: 'cleanup',
      isolatedProcesses: stateInvalid
        ? 'failed'
        : state === undefined
          ? 'not_run'
          : processStatus === 'passed' &&
              lifecycleBeforeUserdel.state === 'observed' &&
              lifecycleBeforeUserdel.uidProcessCount === 0 &&
              finalLifecycle.state === 'observed' &&
              finalLifecycle.uidProcessCount === 0 &&
              user.accountState === 'absent'
            ? 'passed'
            : 'failed',
      policy: stateInvalid ? 'failed' : policyStatus,
      user: stateInvalid ? 'failed' : user.status,
      profile: stateInvalid ? 'failed' : profileStatus,
      aptSource: aptStatus,
      accountState: stateInvalid ? 'unavailable' : user.accountState,
      userdelStatus: stateInvalid ? 'not_run' : user.userdelStatus,
      userdelExitStatus: stateInvalid ? null : user.userdelExitStatus,
      stopDiagnostics,
      lateUidRetry,
      uidProcessObservation: uidProcessObservationFromLifecycle(finalLifecycle),
      cleanupOriginProbe,
      uidLifecycleObservationBeforeUserdel: lifecycleBeforeUserdel,
      finalUidLifecycleObservation: finalLifecycle,
    });
  }
  const cleanupPassed =
    !stateInvalid &&
    aptStatus === 'passed' &&
    (state === undefined ||
      (processStatus === 'passed' &&
        lifecycleBeforeUserdel.state === 'observed' &&
        lifecycleBeforeUserdel.uidProcessCount === 0 &&
        finalLifecycle.state === 'observed' &&
        finalLifecycle.uidProcessCount === 0 &&
        user.accountState === 'absent' &&
        policyStatus === 'passed' &&
        user.status === 'passed' &&
        profileStatus === 'passed'));
  if (!cleanupPassed) throw failure('desktop-not-ready');
}

async function main() {
  const mode = process.argv[2];
  if (!['journey', 'startup', 'cleanup'].includes(mode)) throw failure();
  const config = validateEnvironment(
    mode === 'journey' ? 'journey' : 'startup',
  );
  if (mode === 'cleanup') {
    await cleanupRunner(config);
    process.stdout.write('Element Desktop cleanup completed.\n');
    return;
  }
  await prepareAndRun(config, mode);
  process.stdout.write(
    mode === 'journey'
      ? 'Element Desktop calendar journey completed.\n'
      : 'Element Desktop startup completed.\n',
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const code =
      error && typeof error === 'object' && typeof error.code === 'string'
        ? error.code
        : 'desktop-journey-runner-failed';
    process.stderr.write(`Element Desktop runner failed (${code}).\n`);
    process.exitCode = 1;
  });
}
