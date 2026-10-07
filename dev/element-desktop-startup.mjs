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
const CHECK_NAMES = Object.freeze([
  'sourceSha',
  'runner',
  'package',
  'privateProfile',
  'secretService',
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
  'probe-internal-error',
]);

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
  node: process.versions.node,
  chromium: null,
  runner: 'ubuntu-24.04',
};

let app;
let browser;
let keyringPid = null;
let failureCode = null;

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
  const unlock = randomBytes(32);
  const unlockInput = Buffer.concat([unlock, Buffer.from('\n')]);
  try {
    const output = safeCommand(
      'gnome-keyring-daemon',
      ['--unlock', '--components=secrets'],
      { input: unlockInput, timeout: 10_000 },
    );
    if (output === null) fail('secret-service-unavailable', 'secretService');
    const values = new Map();
    for (const line of output.split(/\r?\n/u)) {
      const match =
        /^(GNOME_KEYRING_CONTROL|GNOME_KEYRING_PID)=([^;\r\n]+); export \1;$/u.exec(
          line,
        );
      if (match) values.set(match[1], match[2]);
    }
    const pidValue = values.get('GNOME_KEYRING_PID');
    if (!pidValue || !/^[1-9][0-9]{0,8}$/u.test(pidValue)) {
      fail('secret-service-unavailable', 'secretService');
    }
    keyringPid = Number(pidValue);
    process.env.GNOME_KEYRING_PID = pidValue;
    const control = values.get('GNOME_KEYRING_CONTROL');
    if (control) process.env.GNOME_KEYRING_CONTROL = control;

    const challenge = randomBytes(32).toString('hex');
    if (
      safeCommand(
        'secret-tool',
        [
          'store',
          '--label=Desktop startup synthetic check',
          'desktop-startup',
          'secret-service',
        ],
        { input: `${challenge}\n` },
      ) === null
    ) {
      fail('secret-service-unavailable', 'secretService');
    }
    const observed = safeCommand('secret-tool', [
      'lookup',
      'desktop-startup',
      'secret-service',
    ]);
    const cleared = safeCommand('secret-tool', [
      'clear',
      'desktop-startup',
      'secret-service',
    ]);
    const keyringDirectory = `${process.env.XDG_DATA_HOME}/keyrings`;
    const hasPrivateKeyring =
      existsSync(keyringDirectory) &&
      readdirSync(keyringDirectory).some((name) => name.endsWith('.keyring'));
    if (
      observed?.trim() !== challenge ||
      cleared === null ||
      !hasPrivateKeyring
    ) {
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
      const [versionResponse, targetResponse] = await Promise.all([
        fetch(`http://127.0.0.1:${cdpPort}/json/version`, {
          redirect: 'error',
          signal: AbortSignal.timeout(750),
        }),
        fetch(`http://127.0.0.1:${cdpPort}/json/list`, {
          redirect: 'error',
          signal: AbortSignal.timeout(750),
        }),
      ]);
      if (versionResponse.ok && targetResponse.ok) {
        const [versionInfo, targets] = await Promise.all([
          versionResponse.json(),
          targetResponse.json(),
        ]);
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
        if (page) {
          const match =
            /(?:Chrome|Chromium)\/([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)/u.exec(
              String(versionInfo.Browser ?? ''),
            );
          if (match) runtime.chromium = match[1];
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
  } catch {
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
  if (keyringPid !== null) {
    try {
      process.kill(keyringPid, 'SIGTERM');
    } catch {
      // The session bus may already have stopped the daemon.
    }
  }
}

function emitRecord(rendererCount = 0) {
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
    rendererCount,
    checks,
  };
  process.stdout.write(`${JSON.stringify(record)}\n`);
  if (!passed) process.exitCode = 1;
}

async function main() {
  let rendererCount = 0;
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
        '--remote-debugging-address=127.0.0.1',
        `--remote-debugging-port=${cdpPort}`,
      ],
      {
        detached: true,
        stdio: 'ignore',
        env: process.env,
      },
    );
    if (!Number.isSafeInteger(app.pid))
      fail('desktop-not-ready', 'desktopProcess');
    writeFileSync(`${profileRoot}/process-group`, `${app.pid}\n`, {
      mode: 0o600,
    });
    app.on('error', () => {
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
    await stopApp();
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
        rendererCount: 0,
        checks,
      })}\n`,
    );
    process.exitCode = 1;
  });
}
