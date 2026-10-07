import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
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

function cappedTwo(value) {
  return Math.min(value, 2);
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
  if (appSpawnErrorClass !== null) {
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
  if (!processes.some((item) => item.pid === appPid)) {
    fail('renderer-sandbox-unconfirmed', 'nativeSandbox');
  }
  if (
    processes.some(
      (item) => item.unreadable || item.uids.some((uid) => uid !== expectedUid),
    )
  ) {
    fail('renderer-sandbox-unconfirmed', 'nativeSandbox');
  }
  if (
    processes.some((item) =>
      item.args.some((arg) => arg.startsWith('--no-sandbox')),
    )
  ) {
    fail('renderer-sandbox-unconfirmed', 'nativeSandbox');
  }
  const renderers = processes.filter((item) =>
    item.args.some((arg) => arg.startsWith('--type=renderer')),
  );
  if (
    renderers.length === 0 ||
    renderers.some((item) => item.seccomp !== '2' || item.noNewPrivs !== '1')
  ) {
    fail('renderer-sandbox-unconfirmed', 'nativeSandbox');
  }
  pass('desktopProcess');
  pass('nativeSandbox');
  return renderers.length > 1 ? 2 : renderers.length;
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
    if (!Number.isSafeInteger(app.pid))
      fail('desktop-not-ready', 'desktopProcess');
    writeFileSync(`${profileRoot}/process-group`, `${app.pid}\n`, {
      mode: 0o600,
    });
    app.on('error', (error) => {
      appSpawnErrorClass = classifyChildSpawnError(error);
      failureCode ??= 'desktop-not-ready';
    });
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
        checks,
      })}\n`,
    );
    process.exitCode = 1;
  });
}
