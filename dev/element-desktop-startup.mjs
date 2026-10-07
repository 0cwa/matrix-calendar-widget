import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  opendirSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  readSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXED_ORIGIN = 'vector://vector';
const PROFILE_MARKER = 'element-desktop-startup-profile-v1';
const SAFE_STORAGE_PREFIX = 'Using storage mode ';
const SAFE_STORAGE_BACKENDS = new Set([
  'gnome_libsecret',
  'kwallet',
  'kwallet5',
  'kwallet6',
]);
const SAFE_STORAGE_MODES = new Set(['encrypted', 'plaintext', 'basic_text']);
const MAX_SAFE_STORAGE_LOG_BYTES = 1_048_576;
const MAX_SAFE_STORAGE_LINE_LENGTH = 512;
const DESKTOP_SPAWN_WAIT_MS = 5_000;
const MAX_DIAGNOSTIC_COUNT = 100;
const MAX_UID_LIFECYCLE_PROCESSES = 4_096;
const MAX_CDP_PROCESS_INFO_RECORDS = 128;
const MAX_CDP_RENDERER_PIDS = 64;
const MAX_CDP_RENDERER_HANDOFF_BYTES = 2_048;
const MAX_PROC_COMMAND_LINE_BYTES = 4_096;
const MAX_PROC_NETWORK_TABLE_BYTES = 1_048_576;
const MAX_UID_SOCKET_FD_REFERENCES = 8_192;
const MAX_UID_SOCKET_BUCKETS = 100;
// The workflow budgets 13s for each marker ACK, including command kill grace;
// leave 2s of the 15s helper wait for polling and dispatch overhead.
const EGRESS_COUNTER_ACK_WAIT_MS = 15_000;
const CDP_PROCESS_INFO_TIMEOUT_MS = 2_000;
const UID_SOCKET_PROCESS_ROLES = Object.freeze([
  'application',
  'browser',
  'renderer',
  'zygote',
  'gpu',
  'utility',
  'other',
  'shared',
  'unknown',
]);
const UID_SOCKET_PEER_CATEGORIES = Object.freeze([
  'matrix_loopback',
  'loopback_other',
  'non_loopback_web',
  'non_loopback_other',
  'cdp_loopback_listener',
  'cdp_non_loopback_listener',
  'other_listener',
  'no_peer',
  'unknown',
]);
const UID_TCP_STATES = Object.freeze([
  'established',
  'syn_sent',
  'syn_received',
  'fin_wait',
  'time_wait',
  'close_wait',
  'last_ack',
  'closing',
  'listening',
  'closed',
  'unknown',
]);
export const SANDBOX_REASONS = Object.freeze([
  'not_observed',
  'passed',
  'application_process_missing',
  'unreadable_process_member',
  'uid_mismatch',
  'no_sandbox_flag',
  'renderer_missing',
  'renderer_ownership_unconfirmed',
  'seccomp_unconfirmed',
  'no_new_privs_unconfirmed',
]);
const CHILD_SIGNALS = new Set([
  'SIGABRT',
  'SIGALRM',
  'SIGBUS',
  'SIGFPE',
  'SIGHUP',
  'SIGILL',
  'SIGINT',
  'SIGKILL',
  'SIGPIPE',
  'SIGQUIT',
  'SIGSEGV',
  'SIGTERM',
  'SIGTRAP',
  'SIGUSR1',
  'SIGUSR2',
  'other',
]);
const CHILD_SPAWN_ERRORS = new Set([
  'missing-executable',
  'other',
  'permission',
  'resource',
]);
const CHECK_NAMES = Object.freeze([
  'sourceSha',
  'runner',
  'package',
  'privateProfile',
  'secretService',
  'safeStorageBackend',
  'config',
  'updatesDisabled',
  'desktopProcess',
  'loopbackCdp',
  'packagedOrigin',
  'nativeSandbox',
  'nodeIntegrationDisabled',
]);
const FAILURE_CODES = Object.freeze([
  'invalid-source-sha',
  'unsupported-runner',
  'package-unavailable',
  'package-mismatch',
  'invalid-profile',
  'secret-service-unavailable',
  'invalid-config',
  'updates-enabled',
  'desktop-not-ready',
  'cdp-not-loopback',
  'unexpected-origin',
  'renderer-sandbox-unconfirmed',
  'node-integration-visible',
  'safe-storage-backend-unconfirmed',
  'probe-internal-error',
]);

export function createSafeStorageLogCollector() {
  const streams = new Map([
    ['stdout', { pending: '', discarding: false }],
    ['stderr', { pending: '', discarding: false }],
  ]);
  let bytesRead = 0;
  let overflow = false;
  let longMarker = false;
  let markerCount = 0;
  let mode = 'not_observed';
  let backend = 'not_observed';
  let finished = false;

  function observeLine(rawLine) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (!line.startsWith(SAFE_STORAGE_PREFIX)) return;
    markerCount = Math.min(markerCount + 1, 2);
    if (markerCount > 1) {
      mode = 'ambiguous';
      backend = 'ambiguous';
      return;
    }
    const match =
      /^Using storage mode '([A-Za-z0-9_]{1,32})' with backend '([A-Za-z0-9_]{1,32})'$/u.exec(
        line,
      );
    if (!match) {
      mode = 'other';
      backend = 'other';
      return;
    }
    mode = SAFE_STORAGE_MODES.has(match[1]) ? match[1] : 'other';
    backend = SAFE_STORAGE_BACKENDS.has(match[2]) ? match[2] : 'other';
  }

  function write(streamName, chunk) {
    if (finished || overflow) return;
    const state = streams.get(streamName);
    if (!state) throw new Error('invalid safe storage stream');
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytesRead += buffer.length;
    if (bytesRead > MAX_SAFE_STORAGE_LOG_BYTES) {
      overflow = true;
      return;
    }

    let text = buffer.toString('utf8');
    if (state.discarding) {
      const newline = text.indexOf('\n');
      if (newline < 0) return;
      text = text.slice(newline + 1);
      state.discarding = false;
    }
    const lines = `${state.pending}${text}`.split('\n');
    state.pending = lines.pop() ?? '';
    for (const line of lines) {
      if (line.length > MAX_SAFE_STORAGE_LINE_LENGTH) {
        if (line.startsWith(SAFE_STORAGE_PREFIX)) {
          longMarker = true;
          observeLine(line.slice(0, MAX_SAFE_STORAGE_LINE_LENGTH));
        }
      } else {
        observeLine(line);
      }
    }
    if (state.pending.length > MAX_SAFE_STORAGE_LINE_LENGTH) {
      if (state.pending.startsWith(SAFE_STORAGE_PREFIX)) {
        longMarker = true;
        observeLine(state.pending.slice(0, MAX_SAFE_STORAGE_LINE_LENGTH));
      }
      state.pending = '';
      state.discarding = true;
    }
  }

  function finish(processClosed) {
    if (!finished) {
      for (const state of streams.values()) {
        if (!state.discarding && state.pending.length > 0) {
          observeLine(state.pending);
        }
        state.pending = '';
      }
      finished = true;
    }
    return {
      mode,
      backend,
      markerCount,
      complete: processClosed === true && !overflow && !longMarker,
    };
  }

  return Object.freeze({ write, finish });
}

export function createKeyringUnlockInput(entropy) {
  if (!Buffer.isBuffer(entropy) || entropy.length !== 32) {
    throw new TypeError('invalid keyring unlock entropy');
  }
  return Buffer.from(`${entropy.toString('hex')}\n`, 'ascii');
}

export function waitForDesktopChildSpawn(child) {
  return new Promise((resolveSpawn) => {
    let settled = false;
    const finish = (outcome, errorClass = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off('spawn', onSpawn);
      child.off('error', onError);
      resolveSpawn({ outcome, errorClass });
    };
    const onSpawn = () => finish('spawned');
    const onError = (error) =>
      finish('spawn-error', classifyChildSpawnError(error));
    const timer = setTimeout(() => finish('timeout'), DESKTOP_SPAWN_WAIT_MS);
    child.once('spawn', onSpawn);
    child.once('error', onError);
  });
}

export function readKeyringControl(stdout) {
  if (typeof stdout !== 'string') return undefined;
  for (const line of stdout.split(/\r?\n/u)) {
    const match =
      /^GNOME_KEYRING_CONTROL=([^;\r\n]{1,512})(?:; export GNOME_KEYRING_CONTROL;)?$/u.exec(
        line,
      );
    if (match) return match[1];
  }
  return undefined;
}

function emptySecretServiceObservation() {
  return {
    step: 'not-run',
    dbusAddressPresent: false,
    daemonOutcome: 'not-run',
    daemonExitStatus: null,
    daemonControlPresent: false,
    storeOutcome: 'not-run',
    storeExitStatus: null,
    lookupOutcome: 'not-run',
    lookupExitStatus: null,
    lookupMatches: false,
    clearOutcome: 'not-run',
    clearExitStatus: null,
    keyringFilePresent: false,
  };
}

function runSecretCommand(program, args, { input, timeout = 5_000 } = {}) {
  let result;
  try {
    result = spawnSync(program, args, {
      encoding: 'utf8',
      input,
      stdio: ['pipe', 'pipe', 'ignore'],
      timeout,
      maxBuffer: 128 * 1024,
    });
  } catch {
    return { outcome: 'spawn-error', exitStatus: null, stdout: '' };
  }
  let outcome = 'passed';
  if (result.error) {
    outcome = result.error.code === 'ETIMEDOUT' ? 'timeout' : 'spawn-error';
  } else if (result.signal) {
    outcome = 'signaled';
  } else if (result.status !== 0) {
    outcome = 'nonzero-exit';
  }
  return {
    outcome,
    exitStatus:
      Number.isSafeInteger(result.status) &&
      result.status >= 0 &&
      result.status <= 255
        ? result.status
        : null,
    stdout: outcome === 'passed' ? result.stdout : '',
  };
}

class ProbeFailure extends Error {
  constructor(code, check) {
    super('Desktop startup check failed');
    this.code = FAILURE_CODES.includes(code) ? code : 'probe-internal-error';
    this.check = check;
  }
}

const checks = Object.fromEntries(CHECK_NAMES.map((name) => [name, 'not_run']));
const sourceSha = process.env.ELEMENT_DESKTOP_SOURCE_SHA ?? '';
const packageSha256 = process.env.ELEMENT_DESKTOP_PACKAGE_SHA256 ?? '';
const profileRoot = process.env.ELEMENT_DESKTOP_PROFILE_ROOT ?? '';
const configPath = process.env.ELEMENT_DESKTOP_CONFIG_PATH ?? '';
const cdpPort = Number(process.env.ELEMENT_DESKTOP_CDP_PORT);
const expectedUid = Number(process.env.ELEMENT_DESKTOP_PROBE_UID);
const packageInfo = { version: null, architecture: null, sha256: null };
const runtime = {
  probeNode: process.versions.node,
  embeddedNode: null,
  electron: null,
  chromium: null,
  runner: 'ubuntu-24.04',
};

let app;
let browser;
let appClosePromise;
let appClosed = false;
let appSpawnErrorClass = null;
let appLaunchState = 'not-started';
let safeStorageLogCollector;
let safeStorageObservation = {
  mode: 'not_observed',
  backend: 'not_observed',
  markerCount: 0,
  complete: false,
};
let secretServiceObservation = emptySecretServiceObservation();
const desktopObservation = {
  childState: 'not-started',
  childExitStatus: null,
  childSignal: null,
  childSpawnErrorClass: null,
  cdp: {
    versionResponseCount: 0,
    versionOkResponseCount: 0,
    versionLastStatus: null,
    versionJsonValidObserved: false,
    targetListResponseCount: 0,
    targetListOkResponseCount: 0,
    targetListLastStatus: null,
    targetListJsonValidObserved: false,
    pageTargetCount: null,
    fixedOriginPageCount: null,
  },
  pageLoadOutcome: 'not-attempted',
};
let failureCode = null;
let rendererDiagnostics = emptyRendererDiagnostics();
let egressPhaseCounters = {
  beforeApp: emptyEgressCounterObservation(),
  afterAppSpawn: emptyEgressCounterObservation(),
  afterPageLoad: emptyEgressCounterObservation(),
};

function cappedTwo(value) {
  return Math.min(value, 2);
}

function cappedDiagnosticCount(value) {
  return Math.min(value, MAX_DIAGNOSTIC_COUNT);
}

function emptyRendererDiagnostics() {
  return {
    state: 'not_observed',
    sandboxReason: 'not_observed',
    applicationProcessObserved: null,
    processGroupCount: null,
    unreadableProcessCount: null,
    uidMismatchCount: null,
    noSandboxFlagCount: null,
    rendererCount: null,
    seccompState: 'not_observed',
    noNewPrivsState: 'not_observed',
  };
}

function emptyEgressCounterObservation(state = 'not_observed') {
  return {
    state,
    ipv4Blocked: null,
    ipv6Blocked: null,
    ipv4Classes: null,
    ipv6Classes: null,
    overflow: null,
  };
}

function emptyCdpRendererObservation(state) {
  const securityState =
    state === 'not_observed' ? 'not_observed' : 'unavailable';
  return {
    state,
    overflow: null,
    rendererCount: null,
    missingCount: null,
    unreadableCount: null,
    uidMatchCount: null,
    uidMismatchCount: null,
    appIdentityState: state === 'not_observed' ? 'not_observed' : 'unavailable',
    appDescendantCount: null,
    appDescendantUnobservedCount: null,
    appProcessGroupCount: null,
    appProcessGroupUnobservedCount: null,
    appDescendantAndProcessGroupCount: null,
    argvRendererMatchCount: null,
    noSandboxFlagCount: null,
    seccompState: securityState,
    noNewPrivsState: securityState,
  };
}

function aggregateRendererSecurityState(renderers, field, expected) {
  if (renderers.length === 0) return 'unavailable';
  const values = renderers.map((renderer) => renderer[field]);
  if (values.some((value) => value === null || value === undefined)) {
    return 'unavailable';
  }
  const enabled = values.filter((value) => value === expected).length;
  if (enabled === values.length) return 'enabled';
  if (enabled === 0) return 'disabled';
  return 'mixed';
}

export function summarizeProcessCoverageAndSandbox(
  processes,
  appPid,
  expectedUid,
) {
  const applicationProcessObserved = processes.some(
    (item) => item.pid === appPid,
  );
  const unreadableProcessCount = processes.filter(
    (item) =>
      item.unreadable || !Array.isArray(item.uids) || !Array.isArray(item.args),
  ).length;
  const uidMismatchCount = processes.filter(
    (item) =>
      !item.unreadable &&
      Array.isArray(item.uids) &&
      item.uids.some((uid) => uid !== expectedUid),
  ).length;
  const noSandboxFlagCount = processes.filter(
    (item) =>
      Array.isArray(item.args) &&
      item.args.some((arg) => arg.startsWith('--no-sandbox')),
  ).length;
  const renderers = processes.filter(
    (item) =>
      Array.isArray(item.args) &&
      item.args.some((arg) => arg.startsWith('--type=renderer')),
  );
  const seccompState = aggregateRendererSecurityState(
    renderers,
    'seccomp',
    '2',
  );
  const noNewPrivsState = aggregateRendererSecurityState(
    renderers,
    'noNewPrivs',
    '1',
  );

  let sandboxReason = 'passed';
  if (!applicationProcessObserved) {
    sandboxReason = 'application_process_missing';
  } else if (unreadableProcessCount > 0) {
    sandboxReason = 'unreadable_process_member';
  } else if (uidMismatchCount > 0) {
    sandboxReason = 'uid_mismatch';
  } else if (noSandboxFlagCount > 0) {
    sandboxReason = 'no_sandbox_flag';
  } else if (renderers.length === 0) {
    sandboxReason = 'renderer_missing';
  } else if (seccompState !== 'enabled') {
    sandboxReason = 'seccomp_unconfirmed';
  } else if (noNewPrivsState !== 'enabled') {
    sandboxReason = 'no_new_privs_unconfirmed';
  }

  return {
    state: 'observed',
    sandboxReason,
    applicationProcessObserved,
    processGroupCount: cappedDiagnosticCount(processes.length),
    unreadableProcessCount: cappedDiagnosticCount(unreadableProcessCount),
    uidMismatchCount: cappedDiagnosticCount(uidMismatchCount),
    noSandboxFlagCount: cappedDiagnosticCount(noSandboxFlagCount),
    rendererCount: cappedDiagnosticCount(renderers.length),
    seccompState,
    noNewPrivsState,
  };
}

export function summarizeUidProcessObservations(
  processes,
  expectedUid,
  complete = true,
) {
  let uidProcessCount = 0;
  let nonZombieProcessCount = 0;
  let zombieCount = 0;
  let unreadableProcessCount = 0;
  for (const item of processes) {
    if (!Array.isArray(item.uids)) continue;
    if (!item.uids.includes(expectedUid)) continue;
    uidProcessCount += 1;
    if (item.state === 'Z') {
      zombieCount += 1;
    } else if (item.state === null || item.state === undefined) {
      unreadableProcessCount += 1;
    } else {
      nonZombieProcessCount += 1;
    }
  }
  return {
    state: complete ? 'observed' : 'partial',
    uidProcessCount: cappedDiagnosticCount(uidProcessCount),
    nonZombieProcessCount: cappedDiagnosticCount(nonZombieProcessCount),
    zombieCount: cappedDiagnosticCount(zombieCount),
    unreadableProcessCount: cappedDiagnosticCount(unreadableProcessCount),
  };
}

function emptyUidLifecycleObservation(state) {
  const rendererState =
    state === 'not_observed' ? 'not_observed' : 'unavailable';
  const securityState =
    state === 'not_observed' ? 'not_observed' : 'unavailable';
  return {
    state,
    overflow: null,
    uidProcessCount: null,
    nonZombieProcessCount: null,
    zombieCount: null,
    unreadableProcessCount: null,
    unattributedProcessCount: null,
    processClassCounts: null,
    rendererOwnership: {
      state: rendererState,
      appIdentityState: rendererState,
      rendererCount: null,
      appDescendantCount: null,
      appProcessGroupCount: null,
      appDescendantAndProcessGroupCount: null,
      appDescendantOnlyCount: null,
      appProcessGroupOnlyCount: null,
      noCurrentLinkCount: null,
      otherUidAppDescendantCount: null,
      securityCoverageState: rendererState,
    },
    cdpRendererObservation: emptyCdpRendererObservation(
      state === 'not_observed' ? 'not_observed' : 'unavailable',
    ),
    seccompState: securityState,
    noNewPrivsState: securityState,
  };
}

function classifyUidProcess(args, pid, applicationPid) {
  if (pid === applicationPid) return 'application';
  if (!Array.isArray(args) || args.length === 0) return 'unknown';
  const processType = args.find((arg) => arg.startsWith('--type='));
  if (processType === '--type=browser') return 'browser';
  if (processType === '--type=renderer') return 'renderer';
  if (processType === '--type=zygote') return 'zygote';
  if (processType === '--type=gpu-process') return 'gpu';
  if (processType === '--type=utility') return 'utility';
  return 'other';
}

export function classifyUidSocketProcess(
  process,
  expectedUid,
  applicationPid = null,
  applicationIdentityVerified = false,
) {
  if (
    !Number.isSafeInteger(expectedUid) ||
    expectedUid < 1 ||
    expectedUid > 65_535 ||
    !Array.isArray(process?.uids) ||
    process.uids.length !== 4 ||
    !process.uids.every((uid) => uid === expectedUid)
  ) {
    return null;
  }
  if (
    Number.isSafeInteger(applicationPid) &&
    process.pid === applicationPid &&
    !applicationIdentityVerified
  ) {
    return 'unknown';
  }
  return classifyUidProcess(
    process.args,
    process.pid,
    applicationIdentityVerified ? applicationPid : null,
  );
}

function hasProcessAncestor(process, processByPid, ancestorPid) {
  if (!Number.isSafeInteger(process.parentPid)) return false;
  let parentPid = process.parentPid;
  const visited = new Set();
  for (let depth = 0; depth < 64; depth += 1) {
    if (parentPid === ancestorPid) return true;
    if (parentPid <= 1 || visited.has(parentPid)) return false;
    visited.add(parentPid);
    const parent = processByPid.get(parentPid);
    if (!parent || !Number.isSafeInteger(parent.parentPid)) return false;
    parentPid = parent.parentPid;
  }
  return false;
}

function processAncestorStatus(process, processByPid, ancestorPid) {
  if (!Number.isSafeInteger(process?.parentPid)) return 'unavailable';
  let parentPid = process.parentPid;
  const visited = new Set();
  for (let depth = 0; depth < 64; depth += 1) {
    if (parentPid === ancestorPid) return 'ancestor';
    if (parentPid <= 1) return 'not-ancestor';
    if (visited.has(parentPid)) return 'unavailable';
    visited.add(parentPid);
    const parent = processByPid.get(parentPid);
    if (!parent || !Number.isSafeInteger(parent.parentPid)) {
      return 'unavailable';
    }
    parentPid = parent.parentPid;
  }
  return 'unavailable';
}

export function summarizeCdpRendererProcessInfo(processInfo) {
  const unavailable = emptyCdpRendererObservation('unavailable');
  unavailable.pids = null;
  if (!Array.isArray(processInfo)) return unavailable;

  const pids = [];
  const seen = new Set();
  let overflow = processInfo.length > MAX_CDP_PROCESS_INFO_RECORDS;
  let malformed = false;
  const recordLimit = Math.min(
    processInfo.length,
    MAX_CDP_PROCESS_INFO_RECORDS,
  );
  for (let index = 0; index < recordLimit; index += 1) {
    const item = processInfo[index];
    if (
      item === null ||
      typeof item !== 'object' ||
      typeof item.type !== 'string' ||
      item.type.length === 0 ||
      item.type.length > 64
    ) {
      malformed = true;
      continue;
    }
    if (item.type !== 'renderer') continue;
    if (
      !Number.isSafeInteger(item.id) ||
      item.id < 2 ||
      item.id > 2_147_483_647 ||
      seen.has(item.id)
    ) {
      malformed = true;
      continue;
    }
    seen.add(item.id);
    if (pids.length === MAX_CDP_RENDERER_PIDS) {
      overflow = true;
      continue;
    }
    pids.push(item.id);
  }
  return {
    state: overflow || malformed ? 'partial' : 'observed',
    overflow,
    rendererCount: pids.length,
    pids,
  };
}

function validateCdpRendererHandoff(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !==
      'overflow,pids,rendererCount,state' ||
    !['not_observed', 'unavailable', 'partial', 'observed'].includes(
      value.state,
    )
  ) {
    return false;
  }
  if (value.state === 'not_observed' || value.state === 'unavailable') {
    return (
      value.overflow === null &&
      value.rendererCount === null &&
      value.pids === null
    );
  }
  return (
    typeof value.overflow === 'boolean' &&
    Number.isSafeInteger(value.rendererCount) &&
    value.rendererCount >= 0 &&
    value.rendererCount <= MAX_CDP_RENDERER_PIDS &&
    Array.isArray(value.pids) &&
    value.pids.length === value.rendererCount &&
    value.pids.length <= MAX_CDP_RENDERER_PIDS &&
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

export function parseCdpRendererHandoff(input) {
  const unavailable = {
    state: 'unavailable',
    overflow: null,
    rendererCount: null,
    pids: null,
  };
  if (
    typeof input !== 'string' ||
    input.length > MAX_CDP_RENDERER_HANDOFF_BYTES
  ) {
    return unavailable;
  }
  let value;
  try {
    value = JSON.parse(input);
  } catch {
    return unavailable;
  }
  return validateCdpRendererHandoff(value) ? value : unavailable;
}

function summarizeCdpRendererOwnership(
  processes,
  expectedUid,
  applicationPid,
  handoff,
) {
  if (!validateCdpRendererHandoff(handoff)) {
    return emptyCdpRendererObservation('unavailable');
  }
  if (handoff.state === 'not_observed' || handoff.state === 'unavailable') {
    return emptyCdpRendererObservation(handoff.state);
  }

  const processByPid = new Map(
    processes
      .filter((item) => Number.isSafeInteger(item?.pid) && item.pid > 0)
      .map((item) => [item.pid, item]),
  );
  const application = processByPid.get(applicationPid);
  const applicationIdentityVerified = Boolean(
    Number.isSafeInteger(applicationPid) &&
    application &&
    Array.isArray(application.uids) &&
    application.uids.length === 4 &&
    application.uids.every((uid) => uid === expectedUid) &&
    application.processGroupId === applicationPid &&
    application.unreadable !== true,
  );
  let missingCount = 0;
  let unreadableCount = 0;
  let uidMatchCount = 0;
  let uidMismatchCount = 0;
  let appDescendantCount = 0;
  let appDescendantUnobservedCount = 0;
  let appProcessGroupCount = 0;
  let appProcessGroupUnobservedCount = 0;
  let appDescendantAndProcessGroupCount = 0;
  let argvRendererMatchCount = 0;
  let noSandboxFlagCount = 0;
  const securityRows = [];

  for (const pid of handoff.pids) {
    const item = processByPid.get(pid);
    if (!item) {
      missingCount += 1;
      continue;
    }
    const isZombie = item.state === 'Z';
    const hasUids =
      Array.isArray(item.uids) &&
      item.uids.length === 4 &&
      item.uids.every(Number.isSafeInteger);
    const uidMatches = hasUids && item.uids.every((uid) => uid === expectedUid);
    let processUnreadable =
      !hasUids ||
      item.unreadable === true ||
      isZombie ||
      !Array.isArray(item.args) ||
      item.args.length === 0;
    if (uidMatches) uidMatchCount += 1;
    else if (hasUids) uidMismatchCount += 1;

    const ancestorStatus =
      applicationIdentityVerified && pid !== applicationPid
        ? processAncestorStatus(item, processByPid, applicationPid)
        : 'not-ancestor';
    const appDescendant = ancestorStatus === 'ancestor';
    if (ancestorStatus === 'unavailable') appDescendantUnobservedCount += 1;
    const inAppProcessGroup =
      applicationIdentityVerified && item.processGroupId === applicationPid;
    if (
      applicationIdentityVerified &&
      !Number.isSafeInteger(item.processGroupId)
    ) {
      appProcessGroupUnobservedCount += 1;
    }
    if (appDescendant) appDescendantCount += 1;
    if (inAppProcessGroup) appProcessGroupCount += 1;
    if (appDescendant && inAppProcessGroup) {
      appDescendantAndProcessGroupCount += 1;
    }

    if (uidMatches && Array.isArray(item.args)) {
      if (classifyUidProcess(item.args, pid, null) === 'renderer') {
        argvRendererMatchCount += 1;
      }
      if (
        item.args.some(
          (arg) => arg === '--no-sandbox' || arg.startsWith('--no-sandbox='),
        )
      ) {
        noSandboxFlagCount += 1;
      }
    } else if (uidMatches) {
      processUnreadable = true;
    }
    if (processUnreadable) unreadableCount += 1;
    if (
      uidMatches &&
      !processUnreadable &&
      (appDescendant || inAppProcessGroup)
    ) {
      securityRows.push(item);
    }
  }

  const completeSecurityCoverage =
    applicationIdentityVerified &&
    securityRows.length === handoff.rendererCount &&
    missingCount === 0 &&
    unreadableCount === 0 &&
    uidMismatchCount === 0;
  return {
    state:
      handoff.state === 'partial' ||
      !applicationIdentityVerified ||
      missingCount > 0 ||
      unreadableCount > 0 ||
      uidMismatchCount > 0 ||
      appDescendantUnobservedCount > 0 ||
      appProcessGroupUnobservedCount > 0
        ? 'partial'
        : 'observed',
    overflow: handoff.overflow,
    rendererCount: handoff.rendererCount,
    missingCount: cappedDiagnosticCount(missingCount),
    unreadableCount: cappedDiagnosticCount(unreadableCount),
    uidMatchCount: cappedDiagnosticCount(uidMatchCount),
    uidMismatchCount: cappedDiagnosticCount(uidMismatchCount),
    appIdentityState: applicationIdentityVerified ? 'verified' : 'unavailable',
    appDescendantCount: applicationIdentityVerified
      ? cappedDiagnosticCount(appDescendantCount)
      : null,
    appDescendantUnobservedCount: applicationIdentityVerified
      ? cappedDiagnosticCount(appDescendantUnobservedCount)
      : null,
    appProcessGroupCount: applicationIdentityVerified
      ? cappedDiagnosticCount(appProcessGroupCount)
      : null,
    appProcessGroupUnobservedCount: applicationIdentityVerified
      ? cappedDiagnosticCount(appProcessGroupUnobservedCount)
      : null,
    appDescendantAndProcessGroupCount: applicationIdentityVerified
      ? cappedDiagnosticCount(appDescendantAndProcessGroupCount)
      : null,
    argvRendererMatchCount: cappedDiagnosticCount(argvRendererMatchCount),
    noSandboxFlagCount: cappedDiagnosticCount(noSandboxFlagCount),
    seccompState: completeSecurityCoverage
      ? aggregateRendererSecurityState(securityRows, 'seccomp', '2')
      : 'unavailable',
    noNewPrivsState: completeSecurityCoverage
      ? aggregateRendererSecurityState(securityRows, 'noNewPrivs', '1')
      : 'unavailable',
  };
}

function readBoundedCdpRendererHandoff() {
  const buffer = Buffer.alloc(MAX_CDP_RENDERER_HANDOFF_BYTES + 1);
  let bytesRead = 0;
  try {
    while (bytesRead < buffer.length) {
      const count = readSync(
        0,
        buffer,
        bytesRead,
        buffer.length - bytesRead,
        null,
      );
      if (count === 0) break;
      bytesRead += count;
    }
  } catch {
    return parseCdpRendererHandoff(null);
  }
  if (bytesRead > MAX_CDP_RENDERER_HANDOFF_BYTES) {
    return parseCdpRendererHandoff(null);
  }
  return parseCdpRendererHandoff(
    buffer.subarray(0, bytesRead).toString('utf8'),
  );
}

export function summarizeUidLifecycleObservation(
  processes,
  expectedUid,
  applicationPid = null,
  complete = true,
  overflow = false,
  cdpRendererHandoff = {
    state: 'not_observed',
    overflow: null,
    rendererCount: null,
    pids: null,
  },
) {
  if (
    !Array.isArray(processes) ||
    !Number.isSafeInteger(expectedUid) ||
    expectedUid < 1 ||
    expectedUid > 65_535
  ) {
    return emptyUidLifecycleObservation('unavailable');
  }

  const processByPid = new Map(
    processes
      .filter((item) => Number.isSafeInteger(item?.pid) && item.pid > 0)
      .map((item) => [item.pid, item]),
  );
  const application =
    Number.isSafeInteger(applicationPid) && applicationPid > 1
      ? processByPid.get(applicationPid)
      : undefined;
  const applicationIdentityVerified = Boolean(
    application &&
    Array.isArray(application.uids) &&
    application.uids.length === 4 &&
    application.uids.every((uid) => uid === expectedUid) &&
    application.processGroupId === applicationPid &&
    application.unreadable !== true,
  );

  const classCounts = {
    application: 0,
    browser: 0,
    renderer: 0,
    zygote: 0,
    gpu: 0,
    utility: 0,
    other: 0,
    unknown: 0,
  };
  const rendererSecurityRows = [];
  const completeCdpRendererPids =
    validateCdpRendererHandoff(cdpRendererHandoff) &&
    cdpRendererHandoff.state === 'observed' &&
    !cdpRendererHandoff.overflow
      ? new Set(cdpRendererHandoff.pids)
      : null;
  const appBoundRendererPids = new Set();
  let uidProcessCount = 0;
  let nonZombieProcessCount = 0;
  let zombieCount = 0;
  let unreadableProcessCount = 0;
  let unattributedProcessCount = 0;
  let uidRendererCount = 0;
  let appDescendantRendererCount = 0;
  let appProcessGroupRendererCount = 0;
  let appDescendantAndProcessGroupRendererCount = 0;
  let appDescendantOnlyRendererCount = 0;
  let appProcessGroupOnlyRendererCount = 0;
  let noCurrentLinkRendererCount = 0;
  let otherUidAppDescendantRendererCount = 0;
  let sawCountOverflow = overflow;

  for (const item of processes) {
    const appDescendant =
      applicationIdentityVerified &&
      Number.isSafeInteger(item?.pid) &&
      item.pid !== applicationPid &&
      hasProcessAncestor(item, processByPid, applicationPid);
    if (!Array.isArray(item?.uids)) {
      if (
        applicationIdentityVerified &&
        (appDescendant || item?.processGroupId === applicationPid)
      ) {
        unattributedProcessCount += 1;
      }
      complete = false;
      continue;
    }

    const processClass = classifyUidProcess(
      item.args,
      item.pid,
      applicationIdentityVerified ? applicationPid : null,
    );
    const matchesUid = item.uids.includes(expectedUid);

    if (appDescendant && !matchesUid && processClass === 'renderer') {
      otherUidAppDescendantRendererCount += 1;
    }
    if (!matchesUid) continue;

    uidProcessCount += 1;
    let processUnreadable =
      item.unreadable === true || !Array.isArray(item.args);
    if (item.state === 'Z') {
      zombieCount += 1;
    } else if (typeof item.state === 'string' && item.state.length === 1) {
      nonZombieProcessCount += 1;
    } else {
      processUnreadable = true;
    }

    if (processUnreadable) {
      unreadableProcessCount += 1;
      complete = false;
    }
    classCounts[processClass] += 1;

    if (processClass !== 'renderer') continue;
    uidRendererCount += 1;
    if (!applicationIdentityVerified) continue;

    const inAppProcessGroup = item.processGroupId === applicationPid;
    if (appDescendant || inAppProcessGroup) {
      appBoundRendererPids.add(item.pid);
    }
    if (appDescendant) appDescendantRendererCount += 1;
    if (inAppProcessGroup) appProcessGroupRendererCount += 1;
    if (appDescendant && inAppProcessGroup) {
      appDescendantAndProcessGroupRendererCount += 1;
      rendererSecurityRows.push(item);
    } else if (appDescendant) {
      appDescendantOnlyRendererCount += 1;
      rendererSecurityRows.push(item);
    } else if (inAppProcessGroup) {
      appProcessGroupOnlyRendererCount += 1;
    } else {
      noCurrentLinkRendererCount += 1;
    }
  }

  const countValues = [
    uidProcessCount,
    nonZombieProcessCount,
    zombieCount,
    unreadableProcessCount,
    unattributedProcessCount,
    uidRendererCount,
    appDescendantRendererCount,
    appProcessGroupRendererCount,
    appDescendantAndProcessGroupRendererCount,
    appDescendantOnlyRendererCount,
    appProcessGroupOnlyRendererCount,
    noCurrentLinkRendererCount,
    otherUidAppDescendantRendererCount,
    ...Object.values(classCounts),
  ];
  if (countValues.some((value) => value > MAX_DIAGNOSTIC_COUNT)) {
    sawCountOverflow = true;
  }
  const cdpRendererCoverageComplete =
    completeCdpRendererPids === null ||
    [...appBoundRendererPids].every((pid) => completeCdpRendererPids.has(pid));
  const state =
    complete && !sawCountOverflow && cdpRendererCoverageComplete
      ? 'observed'
      : 'partial';
  const rendererOwnershipState = applicationIdentityVerified
    ? state
    : applicationPid === null
      ? 'not_observed'
      : 'unavailable';
  const securityCoverageState = applicationIdentityVerified
    ? state
    : applicationPid === null
      ? 'not_observed'
      : 'unavailable';

  return {
    state,
    overflow: sawCountOverflow,
    uidProcessCount: cappedDiagnosticCount(uidProcessCount),
    nonZombieProcessCount: cappedDiagnosticCount(nonZombieProcessCount),
    zombieCount: cappedDiagnosticCount(zombieCount),
    unreadableProcessCount: cappedDiagnosticCount(unreadableProcessCount),
    unattributedProcessCount: cappedDiagnosticCount(unattributedProcessCount),
    processClassCounts: Object.fromEntries(
      Object.entries(classCounts).map(([name, value]) => [
        name,
        cappedDiagnosticCount(value),
      ]),
    ),
    rendererOwnership: {
      state: rendererOwnershipState,
      appIdentityState: applicationIdentityVerified
        ? 'verified'
        : applicationPid === null
          ? 'not_observed'
          : 'unavailable',
      rendererCount: applicationIdentityVerified
        ? cappedDiagnosticCount(uidRendererCount)
        : null,
      appDescendantCount: applicationIdentityVerified
        ? cappedDiagnosticCount(appDescendantRendererCount)
        : null,
      appProcessGroupCount: applicationIdentityVerified
        ? cappedDiagnosticCount(appProcessGroupRendererCount)
        : null,
      appDescendantAndProcessGroupCount: applicationIdentityVerified
        ? cappedDiagnosticCount(appDescendantAndProcessGroupRendererCount)
        : null,
      appDescendantOnlyCount: applicationIdentityVerified
        ? cappedDiagnosticCount(appDescendantOnlyRendererCount)
        : null,
      appProcessGroupOnlyCount: applicationIdentityVerified
        ? cappedDiagnosticCount(appProcessGroupOnlyRendererCount)
        : null,
      noCurrentLinkCount: applicationIdentityVerified
        ? cappedDiagnosticCount(noCurrentLinkRendererCount)
        : null,
      otherUidAppDescendantCount: applicationIdentityVerified
        ? cappedDiagnosticCount(otherUidAppDescendantRendererCount)
        : null,
      securityCoverageState,
    },
    cdpRendererObservation: summarizeCdpRendererOwnership(
      processes,
      expectedUid,
      applicationPid,
      cdpRendererHandoff,
    ),
    seccompState: applicationIdentityVerified
      ? aggregateRendererSecurityState(rendererSecurityRows, 'seccomp', '2')
      : applicationPid === null
        ? 'not_observed'
        : 'unavailable',
    noNewPrivsState: applicationIdentityVerified
      ? aggregateRendererSecurityState(rendererSecurityRows, 'noNewPrivs', '1')
      : applicationPid === null
        ? 'not_observed'
        : 'unavailable',
  };
}

function emptyUidTcpSocketObservation(state) {
  return {
    coverage: 'process_owned_tcp_only',
    packetAttribution: 'not_observed',
    state,
    overflow: null,
    tcpSocketCount: null,
    buckets: null,
  };
}

function parseProcEndpoint(value, family) {
  if (typeof value !== 'string') return null;
  const parts = value.split(':');
  const addressHex = parts[0]?.toLowerCase();
  const portHex = parts[1];
  const addressLength = family === 4 ? 8 : 32;
  if (
    parts.length !== 2 ||
    !new RegExp(`^[0-9a-f]{${addressLength}}$`, 'u').test(addressHex ?? '') ||
    !/^[0-9a-f]{4}$/iu.test(portHex ?? '')
  ) {
    return null;
  }
  const port = Number.parseInt(portHex, 16);
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) return null;

  let loopback = false;
  let unspecified = false;
  if (family === 4) {
    const octets = addressHex
      .match(/.{2}/gu)
      .reverse()
      .map((octet) => Number.parseInt(octet, 16));
    unspecified = octets.every((octet) => octet === 0);
    loopback = octets[0] === 127;
  } else {
    unspecified = /^0{32}$/u.test(addressHex);
    loopback =
      /^0{30}01$/u.test(addressHex) || /^0{24}01000000$/u.test(addressHex);
  }

  return { family, addressHex, port, loopback, unspecified };
}

function procTcpState(code) {
  const states = {
    '01': 'established',
    '02': 'syn_sent',
    '03': 'syn_received',
    '04': 'fin_wait',
    '05': 'fin_wait',
    '06': 'time_wait',
    '07': 'closed',
    '08': 'close_wait',
    '09': 'last_ack',
    '0A': 'listening',
    '0B': 'closing',
  };
  return states[String(code).toUpperCase()] ?? 'unknown';
}

function procTcpPeerCategory(state, local, remote, cdpPort) {
  if (state === 'listening') {
    if (local.port === cdpPort) {
      return local.loopback
        ? 'cdp_loopback_listener'
        : 'cdp_non_loopback_listener';
    }
    return 'other_listener';
  }
  if (remote.unspecified && remote.port === 0) return 'no_peer';
  if (remote.loopback) {
    return remote.port === 8_008 ? 'matrix_loopback' : 'loopback_other';
  }
  if (remote.unspecified) return 'unknown';
  if (remote.port === 80 || remote.port === 443) return 'non_loopback_web';
  return 'non_loopback_other';
}

function parseProcTcpTable(text, family, expectedUid, desiredInodes) {
  const rows = [];
  let complete = true;
  for (const line of text.split(/\r?\n/u).slice(1)) {
    if (line.trim() === '') continue;
    const fields = line.trim().split(/\s+/u);
    if (fields.length < 10 || !/^\d+:$/u.test(fields[0] ?? '')) {
      complete = false;
      continue;
    }
    const inode = fields[9];
    if (!desiredInodes.has(inode)) continue;
    if (!/^\d+$/u.test(fields[7] ?? '')) {
      complete = false;
      continue;
    }
    const uid = Number(fields[7]);
    if (!Number.isSafeInteger(uid)) {
      complete = false;
      continue;
    }
    if (uid !== expectedUid) continue;
    const local = parseProcEndpoint(fields[1], family);
    const remote = parseProcEndpoint(fields[2], family);
    const state = procTcpState(fields[3]);
    if (!local || !remote || state === 'unknown') complete = false;
    rows.push({
      inode,
      uid,
      state,
      local,
      remote,
      family,
    });
  }
  return { rows, complete };
}

function readBoundedProcText(path, maximumBytes) {
  let descriptor;
  try {
    descriptor = openSync(path, 'r');
    const buffer = Buffer.alloc(maximumBytes + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const count = readSync(
        descriptor,
        buffer,
        bytesRead,
        buffer.length - bytesRead,
        null,
      );
      if (count === 0) break;
      bytesRead += count;
    }
    const overflow = bytesRead > maximumBytes;
    return {
      text: buffer
        .subarray(0, Math.min(bytesRead, maximumBytes))
        .toString('ascii'),
      complete: !overflow,
      overflow,
    };
  } catch {
    return null;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function summarizeUidTcpSocketObservation(
  socketOwners,
  tcpRows,
  expectedUid,
  complete = true,
  overflow = false,
  cdpPort = null,
) {
  if (
    !(socketOwners instanceof Map) ||
    !Array.isArray(tcpRows) ||
    !Number.isSafeInteger(expectedUid) ||
    expectedUid < 1 ||
    expectedUid > 65_535 ||
    !Number.isSafeInteger(cdpPort) ||
    cdpPort < 1 ||
    cdpPort > 65_535
  ) {
    return emptyUidTcpSocketObservation('unavailable');
  }
  const buckets = new Map();
  const seenSockets = new Set();
  for (const row of tcpRows) {
    if (
      row?.uid !== expectedUid ||
      typeof row.inode !== 'string' ||
      !socketOwners.has(row.inode)
    ) {
      continue;
    }
    if (seenSockets.has(row.inode)) {
      complete = false;
      continue;
    }
    seenSockets.add(row.inode);
    const roles = socketOwners.get(row.inode);
    const observedRole =
      roles instanceof Map && roles.size === 1
        ? roles.values().next().value
        : roles instanceof Map && roles.size > 1
          ? 'shared'
          : 'unknown';
    const role = UID_SOCKET_PROCESS_ROLES.includes(observedRole)
      ? observedRole
      : 'unknown';
    const state = UID_TCP_STATES.includes(row.state) ? row.state : 'unknown';
    const peerCategory =
      row.local && row.remote
        ? procTcpPeerCategory(state, row.local, row.remote, cdpPort)
        : 'unknown';
    if (
      !UID_SOCKET_PROCESS_ROLES.includes(role) ||
      role === 'unknown' ||
      state === 'unknown' ||
      peerCategory === 'unknown'
    ) {
      complete = false;
    }
    const key = `${role}\u0000${peerCategory}\u0000${state}`;
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }

  const orderedBuckets = [...buckets.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, MAX_UID_SOCKET_BUCKETS)
    .map(([key, count]) => {
      const [processRole, peerCategory, state] = key.split('\u0000');
      return {
        processRole,
        peerCategory,
        tcpState: state,
        count: cappedDiagnosticCount(count),
      };
    });
  if (
    seenSockets.size > MAX_DIAGNOSTIC_COUNT ||
    buckets.size > MAX_UID_SOCKET_BUCKETS ||
    [...buckets.values()].some((count) => count > MAX_DIAGNOSTIC_COUNT)
  ) {
    overflow = true;
  }
  return {
    coverage: 'process_owned_tcp_only',
    packetAttribution: 'not_observed',
    state: complete && !overflow ? 'observed' : 'partial',
    overflow,
    tcpSocketCount: cappedDiagnosticCount(seenSockets.size),
    buckets: orderedBuckets,
  };
}

export function summarizeUidTcpSocketTables(
  socketOwners,
  tables,
  expectedUid,
  cdpPort,
  complete = true,
  overflow = false,
) {
  if (!(socketOwners instanceof Map) || !Array.isArray(tables)) {
    return emptyUidTcpSocketObservation('unavailable');
  }
  if (socketOwners.size > 0 && tables.length === 0) {
    return emptyUidTcpSocketObservation('unavailable');
  }
  const desiredInodes = new Set(socketOwners.keys());
  const rows = [];
  for (const table of tables) {
    if (
      !table ||
      typeof table.text !== 'string' ||
      ![4, 6].includes(table.family)
    ) {
      complete = false;
      continue;
    }
    complete &&= table.complete !== false;
    overflow ||= table.overflow === true;
    const parsed = parseProcTcpTable(
      table.text,
      table.family,
      expectedUid,
      desiredInodes,
    );
    complete &&= parsed.complete;
    rows.push(...parsed.rows);
  }
  return summarizeUidTcpSocketObservation(
    socketOwners,
    rows,
    expectedUid,
    complete,
    overflow,
    cdpPort,
  );
}

function readUidTcpSocketObservation(
  processes,
  expectedUid,
  applicationPid,
  processScanComplete,
  processScanOverflow,
  cdpPort,
) {
  if (
    !Array.isArray(processes) ||
    !Number.isSafeInteger(expectedUid) ||
    expectedUid < 1 ||
    expectedUid > 65_535 ||
    !Number.isSafeInteger(cdpPort) ||
    cdpPort < 1 ||
    cdpPort > 65_535
  ) {
    return emptyUidTcpSocketObservation('unavailable');
  }

  let complete = processScanComplete;
  let overflow = processScanOverflow;
  let fdReferenceCount = 0;
  const processByPid = new Map(processes.map((item) => [item.pid, item]));
  const application = processByPid.get(applicationPid);
  const applicationIdentityVerified = Boolean(
    Number.isSafeInteger(applicationPid) &&
    applicationPid > 1 &&
    application &&
    Array.isArray(application.uids) &&
    application.uids.length === 4 &&
    application.uids.every((uid) => uid === expectedUid) &&
    application.processGroupId === applicationPid &&
    application.unreadable !== true,
  );
  const localNetworkNamespace = (() => {
    try {
      return readlinkSync('/proc/self/ns/net');
    } catch {
      return null;
    }
  })();
  if (localNetworkNamespace === null) {
    return emptyUidTcpSocketObservation('unavailable');
  }

  const namespaceGroups = new Map();
  for (const item of processes) {
    if (!Array.isArray(item?.uids) || !item.uids.includes(expectedUid))
      continue;
    if (!item.uids.every((uid) => uid === expectedUid)) {
      complete = false;
      continue;
    }
    let namespace;
    try {
      namespace = readlinkSync(`/proc/${item.pid}/ns/net`);
    } catch {
      if (existsSync(`/proc/${item.pid}`)) complete = false;
      continue;
    }
    if (namespace !== localNetworkNamespace) {
      complete = false;
      continue;
    }
    let group = namespaceGroups.get(namespace);
    if (!group) {
      if (namespaceGroups.size >= 8) {
        overflow = true;
        complete = false;
        continue;
      }
      group = { representativePid: item.pid, processes: [], inodes: new Set() };
      namespaceGroups.set(namespace, group);
    }
    group.processes.push(item);
  }

  const ownersByInode = new Map();
  processScan: for (const group of namespaceGroups.values()) {
    for (const item of group.processes) {
      let fdEntries;
      try {
        fdEntries = readCappedDirectoryEntries(
          opendirSync(`/proc/${item.pid}/fd`),
          MAX_UID_SOCKET_FD_REFERENCES - fdReferenceCount,
          (entry) => /^\d+$/u.test(entry.name),
        );
      } catch {
        if (existsSync(`/proc/${item.pid}`)) complete = false;
        continue;
      }
      for (const entry of fdEntries.entries) {
        const name = entry.name;
        fdReferenceCount += 1;
        let target;
        try {
          target = readlinkSync(`/proc/${item.pid}/fd/${name}`);
        } catch {
          if (existsSync(`/proc/${item.pid}`)) complete = false;
          continue;
        }
        const socket = /^socket:\[(\d+)\]$/u.exec(target);
        if (!socket) continue;
        const inode = socket[1];
        group.inodes.add(inode);
        let owners = ownersByInode.get(inode);
        if (!owners) {
          owners = new Map();
          ownersByInode.set(inode, owners);
        }
        const role = classifyUidSocketProcess(
          item,
          expectedUid,
          applicationPid,
          applicationIdentityVerified,
        );
        owners.set(item.pid, role);
        if (role === 'unknown') complete = false;
      }
      if (fdEntries.overflow) {
        overflow = true;
        complete = false;
        break processScan;
      }
    }
  }

  const tables = [];
  for (const group of namespaceGroups.values()) {
    if (group.inodes.size === 0) continue;
    let tableReadable = false;
    for (const family of [4, 6]) {
      const table = readBoundedProcText(
        `/proc/${group.representativePid}/net/tcp${family === 6 ? '6' : ''}`,
        MAX_PROC_NETWORK_TABLE_BYTES,
      );
      if (!table) {
        complete = false;
        continue;
      }
      tableReadable = true;
      tables.push(table);
      tables[tables.length - 1].family = family;
    }
    if (!tableReadable) {
      return emptyUidTcpSocketObservation('unavailable');
    }
  }

  return summarizeUidTcpSocketTables(
    ownersByInode,
    tables,
    expectedUid,
    cdpPort,
    complete,
    overflow,
  );
}

function parseProcStat(pid, text) {
  const end = text.lastIndexOf(')');
  if (end < 0) return null;
  const fields = text
    .slice(end + 2)
    .trim()
    .split(/\s+/u);
  const parentPid = Number(fields[1]);
  const processGroupId = Number(fields[2]);
  if (
    fields.length < 20 ||
    fields[0]?.length !== 1 ||
    !Number.isSafeInteger(parentPid) ||
    parentPid < 0 ||
    !Number.isSafeInteger(processGroupId) ||
    processGroupId < 0
  ) {
    return null;
  }
  return { pid, parentPid, processGroupId, state: fields[0] };
}

function parseProcStatus(text) {
  const uidText = /^Uid:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)$/mu.exec(text);
  if (!uidText) return null;
  return {
    uids: uidText.slice(1).map(Number),
    seccomp: /^Seccomp:\s+(\d+)$/mu.exec(text)?.[1] ?? null,
    noNewPrivs: /^NoNewPrivs:\s+(\d+)$/mu.exec(text)?.[1] ?? null,
  };
}

export function parseProcCommandLine(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    return { args: null, complete: false };
  }
  const complete = buffer.length <= MAX_PROC_COMMAND_LINE_BYTES;
  return {
    args: buffer
      .subarray(0, MAX_PROC_COMMAND_LINE_BYTES)
      .toString('utf8')
      .split('\0')
      .filter(Boolean),
    complete,
  };
}

function readProcCommandLine(path) {
  const descriptor = openSync(path, 'r');
  try {
    const buffer = Buffer.alloc(MAX_PROC_COMMAND_LINE_BYTES + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const count = readSync(
        descriptor,
        buffer,
        bytesRead,
        buffer.length - bytesRead,
        null,
      );
      if (count === 0) break;
      bytesRead += count;
    }
    return parseProcCommandLine(buffer.subarray(0, bytesRead));
  } finally {
    closeSync(descriptor);
  }
}

export function selectUidLifecycleProcessEntries(
  entries,
  applicationPid = null,
  maximum = MAX_UID_LIFECYCLE_PROCESSES,
  preferredPids = [],
) {
  if (
    !Array.isArray(entries) ||
    !Number.isSafeInteger(maximum) ||
    maximum < 1 ||
    !Array.isArray(preferredPids)
  ) {
    return { entries: [], overflow: true };
  }
  const selected = entries.slice(0, maximum);
  let overflow = entries.length > maximum;
  const requiredPids = [
    ...(Number.isSafeInteger(applicationPid) && applicationPid > 1
      ? [applicationPid]
      : []),
    ...preferredPids.filter((pid) => Number.isSafeInteger(pid) && pid > 1),
  ];
  const requiredNames = new Set(requiredPids.map(String));
  for (const requiredName of requiredNames) {
    if (selected.includes(requiredName)) continue;
    if (selected.length === maximum) {
      let replaceIndex = selected.length - 1;
      while (replaceIndex >= 0 && requiredNames.has(selected[replaceIndex])) {
        replaceIndex -= 1;
      }
      if (replaceIndex < 0) {
        overflow = true;
        continue;
      }
      selected[replaceIndex] = requiredName;
      overflow = true;
    } else {
      selected.push(requiredName);
    }
  }
  return { entries: selected, overflow };
}

export function readCappedDirectoryEntries(
  directory,
  maximum,
  includeEntry = () => true,
) {
  const entries = [];
  let overflow = false;
  try {
    while (true) {
      const entry = directory.readSync();
      if (entry === null) break;
      if (!includeEntry(entry)) continue;
      if (entries.length === maximum) {
        overflow = true;
        break;
      }
      entries.push(entry);
    }
  } finally {
    directory.closeSync();
  }
  return { entries, overflow };
}

function readUidLifecycleObservation(
  uid,
  applicationPid = null,
  cdpPort = null,
  cdpRendererHandoff = {
    state: 'not_observed',
    overflow: null,
    rendererCount: null,
    pids: null,
  },
) {
  const emptyObservation = (state) =>
    cdpPort === null
      ? emptyUidLifecycleObservation(state)
      : {
          uidLifecycleObservation: emptyUidLifecycleObservation(state),
          tcpSocketObservation: emptyUidTcpSocketObservation(state),
        };
  if (
    !Number.isSafeInteger(uid) ||
    uid < 1 ||
    uid > 65_535 ||
    (applicationPid !== null &&
      (!Number.isSafeInteger(applicationPid) ||
        applicationPid < 2 ||
        applicationPid > 2_147_483_647)) ||
    (cdpPort !== null &&
      (!Number.isSafeInteger(cdpPort) || cdpPort < 1 || cdpPort > 65_535))
  ) {
    return emptyObservation('unavailable');
  }

  let directoryEntries;
  try {
    directoryEntries = readCappedDirectoryEntries(
      opendirSync('/proc'),
      MAX_UID_LIFECYCLE_PROCESSES,
      (entry) => /^[0-9]+$/u.test(entry.name),
    );
  } catch {
    return emptyObservation('unavailable');
  }
  const verifiedCdpHandoff = validateCdpRendererHandoff(cdpRendererHandoff)
    ? cdpRendererHandoff
    : {
        state: 'unavailable',
        overflow: null,
        rendererCount: null,
        pids: null,
      };
  const preferredCdpPids =
    verifiedCdpHandoff.state === 'observed' ||
    verifiedCdpHandoff.state === 'partial'
      ? verifiedCdpHandoff.pids
      : [];
  const selectedEntries = selectUidLifecycleProcessEntries(
    directoryEntries.entries.map((entry) => entry.name),
    applicationPid,
    MAX_UID_LIFECYCLE_PROCESSES,
    preferredCdpPids,
  );
  const overflow = directoryEntries.overflow || selectedEntries.overflow;
  const scanEntries = selectedEntries.entries;

  let complete = true;
  const processes = [];
  for (const entry of scanEntries) {
    const pid = Number(entry);
    if (!Number.isSafeInteger(pid) || pid < 1) {
      complete = false;
      continue;
    }
    const path = `/proc/${entry}`;
    let stat = null;
    try {
      stat = parseProcStat(pid, readFileSync(`${path}/stat`, 'utf8'));
    } catch {
      if (existsSync(path)) complete = false;
    }
    if (stat === null && existsSync(path)) complete = false;

    let status = null;
    try {
      status = parseProcStatus(readFileSync(`${path}/status`, 'utf8'));
    } catch {
      if (existsSync(path)) complete = false;
    }
    if (status === null && existsSync(path)) complete = false;
    if (stat === null && status === null) {
      if (preferredCdpPids.includes(pid) && existsSync(path)) {
        processes.push({
          pid,
          parentPid: null,
          processGroupId: null,
          state: null,
          uids: null,
          seccomp: null,
          noNewPrivs: null,
          args: null,
          unreadable: true,
        });
      }
      continue;
    }

    processes.push({
      pid,
      parentPid: stat?.parentPid ?? null,
      processGroupId: stat?.processGroupId ?? null,
      state: stat?.state ?? null,
      uids: status?.uids ?? null,
      seccomp: status?.seccomp ?? null,
      noNewPrivs: status?.noNewPrivs ?? null,
      args: null,
      unreadable: stat === null || status === null,
    });
  }

  const processByPid = new Map(processes.map((item) => [item.pid, item]));
  for (const item of processes) {
    const matchesUid = item.uids?.includes(uid) === true;
    const appDescendant =
      applicationPid !== null &&
      item.pid !== applicationPid &&
      hasProcessAncestor(item, processByPid, applicationPid);
    const inAppProcessGroup =
      applicationPid !== null && item.processGroupId === applicationPid;
    if (!matchesUid && !appDescendant && !inAppProcessGroup) continue;
    try {
      const commandLine = readProcCommandLine(`/proc/${item.pid}/cmdline`);
      item.args = commandLine.args;
      if (!commandLine.complete) {
        item.unreadable = true;
        complete = false;
      }
    } catch {
      if (existsSync(`/proc/${item.pid}`)) {
        item.unreadable = true;
        complete = false;
      }
    }
  }

  const lifecycle = summarizeUidLifecycleObservation(
    processes,
    uid,
    applicationPid,
    complete,
    overflow,
    verifiedCdpHandoff,
  );
  if (cdpPort === null) return lifecycle;
  return {
    uidLifecycleObservation: lifecycle,
    tcpSocketObservation: readUidTcpSocketObservation(
      processes,
      uid,
      applicationPid,
      complete,
      overflow,
      cdpPort,
    ),
  };
}

function readUidProcessObservations(uid) {
  if (!Number.isSafeInteger(uid) || uid < 1 || uid > 65_535) {
    return {
      state: 'unavailable',
      uidProcessCount: null,
      nonZombieProcessCount: null,
      zombieCount: null,
      unreadableProcessCount: null,
    };
  }
  let entries;
  try {
    entries = readdirSync('/proc').filter((name) => /^[0-9]+$/u.test(name));
  } catch {
    return {
      state: 'unavailable',
      uidProcessCount: null,
      nonZombieProcessCount: null,
      zombieCount: null,
      unreadableProcessCount: null,
    };
  }

  const processes = [];
  let complete = true;
  for (const entry of entries) {
    const path = `/proc/${entry}`;
    let statusText;
    try {
      statusText = readFileSync(`${path}/status`, 'utf8');
    } catch {
      if (existsSync(path)) complete = false;
      continue;
    }
    const uidText = /^Uid:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)$/mu.exec(statusText);
    if (!uidText) {
      if (existsSync(path)) complete = false;
      continue;
    }
    const uids = uidText.slice(1).map(Number);
    if (!uids.includes(uid)) continue;
    try {
      const statText = readFileSync(`${path}/stat`, 'utf8');
      const end = statText.lastIndexOf(')');
      const state =
        end < 0
          ? null
          : statText
              .slice(end + 2)
              .trim()
              .split(/\s+/u)[0];
      if (state === null || state.length !== 1) {
        processes.push({ uids, state: null });
        complete = false;
      } else {
        processes.push({ uids, state });
      }
    } catch {
      if (existsSync(path)) {
        processes.push({ uids, state: null });
        complete = false;
      }
    }
  }
  return summarizeUidProcessObservations(processes, uid, complete);
}

function finiteStatus(value) {
  return Number.isSafeInteger(value) && value >= 100 && value <= 599
    ? value
    : null;
}

function recordCdpResponse(name, response) {
  const countName = `${name}ResponseCount`;
  const okCountName = `${name}OkResponseCount`;
  const statusName = `${name}LastStatus`;
  desktopObservation.cdp[countName] = cappedTwo(
    desktopObservation.cdp[countName] + 1,
  );
  desktopObservation.cdp[statusName] = finiteStatus(response.status);
  if (response.ok) {
    desktopObservation.cdp[okCountName] = cappedTwo(
      desktopObservation.cdp[okCountName] + 1,
    );
  }
}

function classifyChildSpawnError(error) {
  if (error?.code === 'ENOENT') return 'missing-executable';
  if (error?.code === 'EACCES' || error?.code === 'EPERM') return 'permission';
  if (['EMFILE', 'ENFILE', 'ENOMEM', 'EAGAIN'].includes(error?.code))
    return 'resource';
  return 'other';
}

function sampleChildBeforeCleanup() {
  if (!app) return;
  if (appLaunchState === 'launch-timeout') {
    desktopObservation.childState = 'launch-timeout';
  } else if (appSpawnErrorClass !== null) {
    desktopObservation.childState = 'spawn-error';
    desktopObservation.childSpawnErrorClass = CHILD_SPAWN_ERRORS.has(
      appSpawnErrorClass,
    )
      ? appSpawnErrorClass
      : 'other';
  } else if (app.exitCode !== null) {
    desktopObservation.childState = 'exited';
    desktopObservation.childExitStatus =
      Number.isSafeInteger(app.exitCode) &&
      app.exitCode >= 0 &&
      app.exitCode <= 255
        ? app.exitCode
        : null;
  } else if (app.signalCode !== null) {
    desktopObservation.childState = 'signaled';
    desktopObservation.childSignal = CHILD_SIGNALS.has(app.signalCode)
      ? app.signalCode
      : 'other';
  } else {
    desktopObservation.childState = 'running';
  }
}

function fail(code, check) {
  throw new ProbeFailure(code, check);
}

function pass(check) {
  checks[check] = 'passed';
}

function status(check, outcome) {
  checks[check] = outcome;
}

function safeCommand(program, args, { input, timeout = 5_000 } = {}) {
  const result = spawnSync(program, args, {
    encoding: 'utf8',
    input,
    stdio: ['pipe', 'pipe', 'ignore'],
    timeout,
    maxBuffer: 128 * 1024,
  });
  if (result.error || result.signal || result.status !== 0) return null;
  return result.stdout;
}

function requireProfile() {
  if (
    !/^([0-9]{1,18})$/u.test(process.env.GITHUB_RUN_ID ?? '') ||
    !/^([0-9]{1,6})$/u.test(process.env.GITHUB_RUN_ATTEMPT ?? '') ||
    dirname(profileRoot) !== '/tmp' ||
    !/^mcw-element-desktop-[0-9]{1,18}-[0-9]{1,6}-[A-Za-z0-9]{6}$/u.test(
      basename(profileRoot),
    ) ||
    !existsSync(profileRoot)
  ) {
    fail('invalid-profile', 'privateProfile');
  }
  const root = lstatSync(profileRoot);
  if (
    root.isSymbolicLink() ||
    !root.isDirectory() ||
    root.uid !== expectedUid ||
    (root.mode & 0o777) !== 0o700
  ) {
    fail('invalid-profile', 'privateProfile');
  }
  for (const name of [
    'home',
    'config',
    'data',
    'cache',
    'runtime',
    'profile',
    'probe',
  ]) {
    const path = `${profileRoot}/${name}`;
    mkdirSync(path, { recursive: true, mode: 0o700 });
    const stat = lstatSync(path);
    if (
      stat.isSymbolicLink() ||
      !stat.isDirectory() ||
      stat.uid !== expectedUid ||
      (stat.mode & 0o777) !== 0o700
    ) {
      fail('invalid-profile', 'privateProfile');
    }
  }
  if (
    process.getuid?.() !== expectedUid ||
    process.geteuid?.() !== expectedUid
  ) {
    fail('invalid-profile', 'privateProfile');
  }
  for (const [name, value] of Object.entries({
    HOME: `${profileRoot}/home`,
    XDG_CONFIG_HOME: `${profileRoot}/config`,
    XDG_DATA_HOME: `${profileRoot}/data`,
    XDG_CACHE_HOME: `${profileRoot}/cache`,
    XDG_RUNTIME_DIR: `${profileRoot}/runtime`,
  })) {
    process.env[name] = value;
  }
  writeFileSync(`${profileRoot}/.owned`, `${PROFILE_MARKER}\n`, {
    mode: 0o600,
  });
  pass('privateProfile');
}

function checkRunner() {
  const release = readFileSync('/etc/os-release', 'utf8');
  if (
    !/^NAME="Ubuntu"$/mu.test(release) ||
    !/^VERSION_ID="24\.04"$/mu.test(release) ||
    !/^22\./u.test(process.versions.node)
  ) {
    fail('unsupported-runner', 'runner');
  }
  pass('runner');
}

function checkSource() {
  if (!/^[0-9a-f]{40}$/u.test(sourceSha))
    fail('invalid-source-sha', 'sourceSha');
  pass('sourceSha');
}

function checkPackage() {
  if (!/^[0-9a-f]{64}$/u.test(packageSha256))
    fail('package-unavailable', 'package');
  const output = safeCommand('dpkg-query', [
    '-W',
    '-f=${Version}\t${Architecture}',
    'element-desktop',
  ]);
  if (output === null) fail('package-unavailable', 'package');
  const [version, architecture] = output.trim().split('\t');
  packageInfo.version = version ?? null;
  packageInfo.architecture = architecture ?? null;
  packageInfo.sha256 = packageSha256;
  if (version !== '1.12.30' || architecture !== 'amd64')
    fail('package-mismatch', 'package');
  pass('package');
}

function checkConfig() {
  let config;
  try {
    config = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch {
    fail('invalid-config', 'config');
  }
  const homeserver = config?.default_server_config?.['m.homeserver'];
  const urls = JSON.stringify(config).match(/https?:\/\/[^"\\\s]+/gu) ?? [];
  const allowedOrigins = new Set(['http://127.0.0.1:8008']);
  let allUrlsLocal = true;
  for (const value of urls) {
    try {
      allUrlsLocal &&= allowedOrigins.has(new URL(value).origin);
    } catch {
      allUrlsLocal = false;
    }
  }
  if (
    homeserver?.base_url !== 'http://127.0.0.1:8008' ||
    homeserver?.server_name !== 'localhost' ||
    config.update_base_url !== null ||
    config.disable_custom_urls !== true ||
    config.enable_client_well_known_lookups !== false ||
    config.disable_analytics !== true ||
    config.integrations_ui_url !== '' ||
    config.integrations_rest_url !== '' ||
    config.integrations_widgets_urls?.length !== 0 ||
    config.bug_report_endpoint_url !== '' ||
    Object.keys(config.jitsi ?? {}).length !== 0 ||
    config.map_style_url !== '' ||
    allUrlsLocal !== true
  ) {
    fail('invalid-config', 'config');
  }
  pass('config');
}

function startSecretService() {
  const observation = emptySecretServiceObservation();
  secretServiceObservation = observation;
  observation.dbusAddressPresent = Boolean(
    process.env.DBUS_SESSION_BUS_ADDRESS,
  );
  if (!observation.dbusAddressPresent) {
    observation.step = 'dbus-session';
    fail('secret-service-unavailable', 'secretService');
  }

  observation.step = 'daemon-start';
  const unlock = randomBytes(32);
  const unlockInput = createKeyringUnlockInput(unlock);
  unlock.fill(0);
  try {
    const daemon = runSecretCommand(
      'gnome-keyring-daemon',
      ['--unlock', '--components=secrets'],
      { input: unlockInput, timeout: 10_000 },
    );
    observation.daemonOutcome = daemon.outcome;
    observation.daemonExitStatus = daemon.exitStatus;
    if (daemon.outcome !== 'passed') {
      observation.step = 'daemon-start';
      fail('secret-service-unavailable', 'secretService');
    }
    const control = readKeyringControl(daemon.stdout);
    observation.daemonControlPresent = Boolean(control);
    if (control) process.env.GNOME_KEYRING_CONTROL = control;

    observation.step = 'secret-store';
    const challenge = randomBytes(32).toString('hex');
    const stored = runSecretCommand(
      'secret-tool',
      [
        'store',
        '--label=Desktop startup synthetic check',
        'desktop-startup',
        'secret-service',
      ],
      { input: `${challenge}\n` },
    );
    observation.storeOutcome = stored.outcome;
    observation.storeExitStatus = stored.exitStatus;
    observation.step = 'secret-lookup';
    const observed = runSecretCommand('secret-tool', [
      'lookup',
      'desktop-startup',
      'secret-service',
    ]);
    observation.lookupOutcome = observed.outcome;
    observation.lookupExitStatus = observed.exitStatus;
    observation.lookupMatches =
      observed.outcome === 'passed' && observed.stdout.trim() === challenge;
    observation.step = 'secret-clear';
    const cleared = runSecretCommand('secret-tool', [
      'clear',
      'desktop-startup',
      'secret-service',
    ]);
    observation.clearOutcome = cleared.outcome;
    observation.clearExitStatus = cleared.exitStatus;
    observation.step = 'keyring-file';
    const keyringDirectory = `${process.env.XDG_DATA_HOME}/keyrings`;
    try {
      observation.keyringFilePresent =
        existsSync(keyringDirectory) &&
        readdirSync(keyringDirectory).some((name) => name.endsWith('.keyring'));
    } catch {
      observation.keyringFilePresent = false;
    }

    observation.step =
      stored.outcome !== 'passed'
        ? 'secret-store'
        : observed.outcome !== 'passed' || !observation.lookupMatches
          ? 'secret-lookup'
          : cleared.outcome !== 'passed'
            ? 'secret-clear'
            : !observation.keyringFilePresent
              ? 'keyring-file'
              : 'none';
    if (observation.step !== 'none') {
      fail('secret-service-unavailable', 'secretService');
    }
    pass('secretService');
  } finally {
    unlock.fill(0);
    unlockInput.fill(0);
  }
}

function appProcessGroup(processGroupId) {
  const members = [];
  for (const entry of readdirSync('/proc').filter((name) =>
    /^[0-9]+$/u.test(name),
  )) {
    const pid = Number(entry);
    try {
      const statText = readFileSync(`/proc/${pid}/stat`, 'utf8');
      const end = statText.lastIndexOf(')');
      if (end < 0) continue;
      const fields = statText
        .slice(end + 2)
        .trim()
        .split(/\s+/u);
      if (Number(fields[2]) !== processGroupId) continue;
      const statusText = readFileSync(`/proc/${pid}/status`, 'utf8');
      const uidText = /^Uid:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)$/mu.exec(
        statusText,
      );
      const args = readFileSync(`/proc/${pid}/cmdline`, 'utf8')
        .split('\0')
        .filter(Boolean);
      members.push({
        pid,
        uids: uidText ? uidText.slice(1).map(Number) : [],
        args,
        seccomp: /^Seccomp:\s+(\d+)$/mu.exec(statusText)?.[1] ?? null,
        noNewPrivs: /^NoNewPrivs:\s+(\d+)$/mu.exec(statusText)?.[1] ?? null,
        unreadable: uidText === null,
      });
    } catch {
      // Processes can exit while /proc is being sampled.
      if (existsSync(`/proc/${pid}/stat`))
        members.push({ pid, unreadable: true });
    }
  }
  return members;
}

function verifyProcessCoverageAndSandbox(appPid) {
  const processes = appProcessGroup(appPid);
  rendererDiagnostics = summarizeProcessCoverageAndSandbox(
    processes,
    appPid,
    expectedUid,
  );
  if (
    [
      'application_process_missing',
      'unreadable_process_member',
      'uid_mismatch',
      'no_sandbox_flag',
    ].includes(rendererDiagnostics.sandboxReason)
  ) {
    fail('renderer-sandbox-unconfirmed', 'nativeSandbox');
  }
  pass('desktopProcess');
  status('nativeSandbox', 'not_run');
  return null;
}

function listeningAddresses() {
  const output = safeCommand('ss', ['-ltnpH']);
  if (output === null) fail('cdp-not-loopback', 'loopbackCdp');
  const portText = String(cdpPort);
  const rows = output
    .split(/\r?\n/u)
    .map((line) => line.trim().split(/\s+/u))
    .filter((fields) => fields[3]?.endsWith(`:${portText}`));
  const accepted = new Set([`127.0.0.1:${portText}`, `[::1]:${portText}`]);
  if (rows.length === 0 || rows.some((fields) => !accepted.has(fields[3]))) {
    fail('cdp-not-loopback', 'loopbackCdp');
  }
  const owners = rows.flatMap((fields) =>
    [...fields.join(' ').matchAll(/pid=([0-9]+)/gu)].map((item) =>
      Number(item[1]),
    ),
  );
  const processRows = appProcessGroup(app.pid);
  const owned = new Set(
    processRows.filter((row) => !row.unreadable).map((row) => row.pid),
  );
  if (owners.length === 0 || owners.some((pid) => !owned.has(pid))) {
    fail('cdp-not-loopback', 'loopbackCdp');
  }
  return true;
}

async function waitForCounterAcknowledgement(milestone) {
  const acknowledgement = `${profileRoot}/.${milestone}-counter-read`;
  const deadline = Date.now() + EGRESS_COUNTER_ACK_WAIT_MS;
  while (Date.now() < deadline) {
    if (existsSync(acknowledgement)) return true;
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  return false;
}

async function waitForDebugger() {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (app.exitCode !== null || app.signalCode !== null)
      fail('desktop-not-ready', 'desktopProcess');
    try {
      const [versionResult, targetResult] = await Promise.allSettled([
        fetch(`http://127.0.0.1:${cdpPort}/json/version`, {
          redirect: 'error',
          signal: AbortSignal.timeout(750),
        }),
        fetch(`http://127.0.0.1:${cdpPort}/json/list`, {
          redirect: 'error',
          signal: AbortSignal.timeout(750),
        }),
      ]);
      let versionInfo;
      let targets;
      if (versionResult.status === 'fulfilled') {
        const response = versionResult.value;
        recordCdpResponse('version', response);
        if (response.ok) {
          try {
            const parsed = await response.json();
            if (
              parsed !== null &&
              typeof parsed === 'object' &&
              !Array.isArray(parsed) &&
              typeof parsed.webSocketDebuggerUrl === 'string'
            ) {
              versionInfo = parsed;
              desktopObservation.cdp.versionJsonValidObserved = true;
            }
          } catch {
            // A malformed transient CDP response is recorded only as not valid.
          }
        } else {
          await response.body?.cancel().catch(() => {});
        }
      }
      if (targetResult.status === 'fulfilled') {
        const response = targetResult.value;
        recordCdpResponse('targetList', response);
        if (response.ok) {
          try {
            const parsed = await response.json();
            if (
              Array.isArray(parsed) &&
              parsed.every(
                (target) =>
                  target !== null &&
                  typeof target === 'object' &&
                  typeof target.type === 'string' &&
                  typeof target.url === 'string',
              )
            ) {
              targets = parsed;
              desktopObservation.cdp.targetListJsonValidObserved = true;
              const pageTargets = targets.filter(
                (target) => target.type === 'page',
              );
              const expectedPages = pageTargets.filter((target) =>
                target.url.startsWith(`${FIXED_ORIGIN}/webapp/`),
              );
              desktopObservation.cdp.pageTargetCount = cappedTwo(
                pageTargets.length,
              );
              desktopObservation.cdp.fixedOriginPageCount = cappedTwo(
                expectedPages.length,
              );
            }
          } catch {
            // A malformed transient CDP response is recorded only as not valid.
          }
        } else {
          await response.body?.cancel().catch(() => {});
        }
      }
      if (versionInfo && targets) {
        const websocket = new URL(versionInfo.webSocketDebuggerUrl);
        if (
          websocket.protocol !== 'ws:' ||
          !['127.0.0.1', '[::1]'].includes(websocket.hostname) ||
          websocket.port !== String(cdpPort)
        ) {
          fail('cdp-not-loopback', 'loopbackCdp');
        }
        const page = targets.find(
          (target) =>
            target.type === 'page' &&
            target.url.startsWith(`${FIXED_ORIGIN}/webapp/`),
        );
        const runtimeText = `${versionInfo.Browser ?? ''} ${versionInfo['User-Agent'] ?? ''}`;
        const chromiumMatch =
          /(?:Chrome|Chromium)\/([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)/u.exec(
            runtimeText,
          );
        const electronMatch = /Electron\/([0-9]+\.[0-9]+\.[0-9]+)/u.exec(
          runtimeText,
        );
        if (chromiumMatch) runtime.chromium = chromiumMatch[1];
        if (electronMatch) runtime.electron = electronMatch[1];
        if (runtime.chromium === null || runtime.electron === null) {
          fail('desktop-not-ready', 'desktopProcess');
        }
        if (page) {
          return page;
        }
      }
    } catch (error) {
      if (error instanceof ProbeFailure) throw error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  fail('desktop-not-ready', 'desktopProcess');
}

async function readCdpRendererProcessInfo(browserValue) {
  let session;
  let timeoutHandle;
  try {
    session = await browserValue.newBrowserCDPSession();
    const result = await Promise.race([
      session.send('SystemInfo.getProcessInfo'),
      new Promise((_, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new Error('CDP process info timed out')),
          CDP_PROCESS_INFO_TIMEOUT_MS,
        );
      }),
    ]);
    return summarizeCdpRendererProcessInfo(result?.processInfo);
  } catch {
    return {
      state: 'unavailable',
      overflow: null,
      rendererCount: null,
      pids: null,
    };
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    if (session) void session.detach().catch(() => {});
  }
}

async function connectAndCheckPage() {
  const requireE2e = createRequire(
    new URL('../e2e/package.json', import.meta.url),
  );
  const { chromium } = requireE2e('@playwright/test');
  const pageTarget = await waitForDebugger();
  listeningAddresses();
  pass('loopbackCdp');
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`, {
    timeout: 10_000,
  });
  const page = browser
    .contexts()
    .flatMap((context) => context.pages())
    .find((candidate) => candidate.url().startsWith(`${FIXED_ORIGIN}/webapp/`));
  if (!page || !pageTarget.url.startsWith(`${FIXED_ORIGIN}/webapp/`)) {
    fail('unexpected-origin', 'packagedOrigin');
  }
  try {
    await page.waitForLoadState('domcontentloaded', { timeout: 15_000 });
    desktopObservation.pageLoadOutcome = 'domcontentloaded';
    const cdpRendererHandoff = await readCdpRendererProcessInfo(browser);
    process.stdout.write(
      `${JSON.stringify({
        phase: 'desktop-startup-progress',
        milestone: 'after-page-load',
        appPid: app.pid,
        cdpRendererHandoff,
      })}\n`,
    );
    egressPhaseCounters.afterPageLoad = emptyEgressCounterObservation(
      (await waitForCounterAcknowledgement('after-page-load'))
        ? 'observed'
        : 'unavailable',
    );
  } catch (error) {
    desktopObservation.pageLoadOutcome =
      error?.name === 'TimeoutError'
        ? 'domcontentloaded-timeout'
        : 'domcontentloaded-failed';
    fail('desktop-not-ready', 'desktopProcess');
  }
  const observation = await page.evaluate(() => ({
    protocol: window.location.protocol,
    host: window.location.hostname,
    documentReady: document.readyState !== 'loading',
    bodyPresent: document.body !== null,
    requirePresent: typeof window.require !== 'undefined',
  }));
  if (
    observation.protocol !== 'vector:' ||
    observation.host !== 'vector' ||
    !observation.documentReady ||
    !observation.bodyPresent
  ) {
    fail('unexpected-origin', 'packagedOrigin');
  }
  pass('packagedOrigin');
  if (observation.requirePresent)
    fail('node-integration-visible', 'nodeIntegrationDisabled');
  pass('nodeIntegrationDisabled');
  const rendererCount = verifyProcessCoverageAndSandbox(app.pid);
  return rendererCount;
}

async function stopApp() {
  if (browser) {
    try {
      await browser.close();
    } catch {
      // The process-group shutdown below remains authoritative.
    }
    browser = null;
  }
  if (app?.pid) {
    try {
      process.kill(-app.pid, 'SIGTERM');
    } catch {
      // The process may already have exited.
    }
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const rows = appProcessGroup(app.pid);
      if (rows.length === 0 || rows.every((row) => row.unreadable)) break;
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
    const remaining = appProcessGroup(app.pid);
    if (remaining.some((row) => !row.unreadable)) {
      try {
        process.kill(-app.pid, 'SIGKILL');
      } catch {
        // Workflow cleanup retries by the exact process group and temporary UID.
      }
    }
  }
  if (appClosePromise && !appClosed) {
    let closeTimer;
    await Promise.race([
      appClosePromise,
      new Promise((resolveClose) => {
        closeTimer = setTimeout(resolveClose, 1_000);
      }),
    ]);
    clearTimeout(closeTimer);
  }
}

function emitRecord(rendererCount = null) {
  const values = Object.values(checks);
  const passed =
    failureCode === null && values.every((value) => value === 'passed');
  const record = {
    phase: 'desktop-startup',
    status: passed ? 'passed' : 'failed',
    failureCode,
    sourceSha,
    package: packageInfo,
    runtime,
    origin: FIXED_ORIGIN,
    secretService: secretServiceObservation,
    safeStorage: safeStorageObservation,
    desktopObservation,
    rendererCount,
    rendererDiagnostics,
    egressPhaseCounters,
    checks,
  };
  process.stdout.write(`${JSON.stringify(record)}\n`);
  if (!passed) process.exitCode = 1;
}

async function main() {
  let rendererCount = null;
  try {
    checkSource();
    checkRunner();
    checkPackage();
    requireProfile();
    startSecretService();
    checkConfig();
    if (process.env.ELEMENT_DESKTOP_NO_UPDATE !== 'true') {
      fail('updates-enabled', 'updatesDisabled');
    }
    pass('updatesDisabled');

    if (
      !Number.isSafeInteger(cdpPort) ||
      cdpPort < 1024 ||
      cdpPort > 65535 ||
      cdpPort === 8008 ||
      !existsSync('/usr/bin/element-desktop') ||
      !configPath
    ) {
      fail('probe-internal-error', 'desktopProcess');
    }
    process.stdout.write(
      '{"phase":"desktop-startup-progress","milestone":"before-app"}\n',
    );
    egressPhaseCounters.beforeApp = emptyEgressCounterObservation(
      (await waitForCounterAcknowledgement('before-app'))
        ? 'observed'
        : 'unavailable',
    );
    app = spawn(
      '/usr/bin/element-desktop',
      [
        `--profile-dir=${profileRoot}/profile`,
        `--config=${configPath}`,
        '--no-update',
        '--password-store=gnome-libsecret',
        '--remote-debugging-address=127.0.0.1',
        `--remote-debugging-port=${cdpPort}`,
      ],
      {
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env,
      },
    );
    appLaunchState = 'pending';
    const spawnOutcome = waitForDesktopChildSpawn(app);
    app.on('spawn', () => {
      if (appLaunchState === 'pending') appLaunchState = 'spawned';
    });
    app.on('error', (error) => {
      if (appLaunchState !== 'pending') return;
      appSpawnErrorClass = classifyChildSpawnError(error);
      appLaunchState = 'spawn-error';
      failureCode ??= 'desktop-not-ready';
    });
    safeStorageLogCollector = createSafeStorageLogCollector();
    app.stdout?.on('data', (chunk) =>
      safeStorageLogCollector.write('stdout', chunk),
    );
    app.stderr?.on('data', (chunk) =>
      safeStorageLogCollector.write('stderr', chunk),
    );
    appClosePromise = new Promise((resolveClose) => {
      app.once('close', () => {
        appClosed = true;
        resolveClose();
      });
    });
    const spawnResult = await spawnOutcome;
    if (spawnResult.outcome === 'spawn-error') {
      appLaunchState = 'spawn-error';
      appSpawnErrorClass = spawnResult.errorClass;
      fail('desktop-not-ready', 'desktopProcess');
    }
    if (spawnResult.outcome === 'timeout') {
      appLaunchState = 'launch-timeout';
      fail('desktop-not-ready', 'desktopProcess');
    }
    if (!Number.isSafeInteger(app.pid))
      fail('desktop-not-ready', 'desktopProcess');
    writeFileSync(`${profileRoot}/process-group`, `${app.pid}\n`, {
      mode: 0o600,
    });
    process.stdout.write(
      `${JSON.stringify({
        phase: 'desktop-startup-progress',
        milestone: 'after-app-spawn',
        appPid: app.pid,
      })}\n`,
    );
    egressPhaseCounters.afterAppSpawn = emptyEgressCounterObservation(
      (await waitForCounterAcknowledgement('after-app-spawn'))
        ? 'observed'
        : 'unavailable',
    );
    rendererCount = await connectAndCheckPage();
  } catch (error) {
    failureCode =
      error instanceof ProbeFailure ? error.code : 'probe-internal-error';
    if (
      error instanceof ProbeFailure &&
      error.check &&
      checks[error.check] === 'not_run'
    ) {
      status(error.check, 'failed');
    }
  } finally {
    sampleChildBeforeCleanup();
    if (
      checks.desktopProcess === 'passed' &&
      desktopObservation.childState !== 'running'
    ) {
      failureCode ??= 'desktop-not-ready';
      status('desktopProcess', 'failed');
    }
    await stopApp();
    if (safeStorageLogCollector) {
      safeStorageObservation = safeStorageLogCollector.finish(appClosed);
      const encryptedBackendSelected =
        safeStorageObservation.complete &&
        safeStorageObservation.markerCount === 1 &&
        safeStorageObservation.mode === 'encrypted' &&
        SAFE_STORAGE_BACKENDS.has(safeStorageObservation.backend);
      if (encryptedBackendSelected) {
        pass('safeStorageBackend');
      } else {
        status('safeStorageBackend', 'failed');
        failureCode ??= 'safe-storage-backend-unconfirmed';
      }
    }
    emitRecord(rendererCount);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === 'cleanup-observation') {
    const requestedUid = Number(process.argv[3]);
    const observation = readUidProcessObservations(requestedUid);
    process.stdout.write(`${JSON.stringify(observation)}\n`);
    if (observation.state === 'unavailable') process.exitCode = 1;
  } else if (process.argv[2] === 'uid-lifecycle-observation') {
    const requestedUid = Number(process.argv[3]);
    const requestedAppPid =
      process.argv[4] === undefined ? null : Number(process.argv[4]);
    const observation = readUidLifecycleObservation(
      requestedUid,
      requestedAppPid,
    );
    process.stdout.write(`${JSON.stringify(observation)}\n`);
    if (observation.state === 'unavailable') process.exitCode = 1;
  } else if (process.argv[2] === 'uid-startup-observation') {
    const requestedUid = Number(process.argv[3]);
    const requestedCdpPort = Number(process.argv[4]);
    const requestedAppPid =
      process.argv[5] === undefined ? null : Number(process.argv[5]);
    const hasCdpRendererHandoff = process.argv[6] === '--cdp-renderer-handoff';
    const validArgumentShape = hasCdpRendererHandoff
      ? process.argv.length === 7
      : process.argv.length === (requestedAppPid === null ? 5 : 6);
    if (!validArgumentShape) {
      const unavailable = {
        uidLifecycleObservation: emptyUidLifecycleObservation('unavailable'),
        tcpSocketObservation: emptyUidTcpSocketObservation('unavailable'),
      };
      process.stdout.write(`${JSON.stringify(unavailable)}\n`);
      process.exitCode = 1;
    } else {
      const cdpRendererHandoff = hasCdpRendererHandoff
        ? readBoundedCdpRendererHandoff()
        : {
            state: 'not_observed',
            overflow: null,
            rendererCount: null,
            pids: null,
          };
      const observation = readUidLifecycleObservation(
        requestedUid,
        requestedAppPid,
        requestedCdpPort,
        cdpRendererHandoff,
      );
      process.stdout.write(`${JSON.stringify(observation)}\n`);
      if (
        observation.uidLifecycleObservation.state === 'unavailable' ||
        observation.tcpSocketObservation.state === 'unavailable'
      ) {
        process.exitCode = 1;
      }
    }
  } else {
    main().catch(() => {
      process.stdout.write(
        `${JSON.stringify({
          phase: 'desktop-startup',
          status: 'failed',
          failureCode: 'probe-internal-error',
          sourceSha,
          package: packageInfo,
          runtime,
          origin: FIXED_ORIGIN,
          secretService: secretServiceObservation,
          safeStorage: safeStorageObservation,
          desktopObservation,
          rendererCount: null,
          rendererDiagnostics,
          egressPhaseCounters,
          checks,
        })}\n`,
      );
      process.exitCode = 1;
    });
  }
}
