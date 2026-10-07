import { spawnSync } from 'node:child_process';
import { createConnection, createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LOCAL_HOMESERVER_PORT = 8008;
const MAX_COUNT = 100_000;
export const EGRESS_DROP_COUNTER_CLASSES = Object.freeze([
  {
    name: 'udp_dns_port',
    rule: ['-p', 'udp', '-m', 'udp', '--dport', '53', '-j', 'DROP'],
  },
  {
    name: 'tcp_dns_port',
    rule: ['-p', 'tcp', '-m', 'tcp', '--dport', '53', '-j', 'DROP'],
  },
  {
    name: 'tcp_https_port',
    rule: ['-p', 'tcp', '-m', 'tcp', '--dport', '443', '-j', 'DROP'],
  },
  { name: 'other', rule: ['-j', 'DROP'] },
]);
const FAMILIES = Object.freeze([
  { name: 'ipv4', tool: 'iptables', suffix: '4', destination: '127.0.0.1/32' },
  { name: 'ipv6', tool: 'ip6tables', suffix: '6', destination: '::1/128' },
]);
const SAFE_SIGNALS = new Set([
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
]);

function requireDecimal(value, min, max) {
  if (!/^[0-9]{1,20}$/u.test(String(value)))
    throw new Error('invalid policy input');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error('invalid policy input');
  }
  return parsed;
}

function requireRunId(value) {
  if (!/^[0-9]{1,18}$/u.test(String(value)))
    throw new Error('invalid policy input');
  return String(value);
}

export function policySpec(uidValue, runIdValue, cdpPortValue) {
  const uid = requireDecimal(uidValue, 1, 65_535);
  const runId = requireRunId(runIdValue);
  const cdpPort = requireDecimal(cdpPortValue, 1_024, 65_535);
  if (cdpPort === LOCAL_HOMESERVER_PORT)
    throw new Error('invalid policy input');

  return FAMILIES.map(({ name, tool, suffix, destination }) => {
    const chain = `MCWD_${runId}_${suffix}`;
    if (chain.length > 28) throw new Error('invalid policy input');
    const chainRules = [
      [
        '-o',
        'lo',
        '-m',
        'conntrack',
        '--ctstate',
        'ESTABLISHED,RELATED',
        '-j',
        'ACCEPT',
      ],
      [
        '-o',
        'lo',
        '-p',
        'tcp',
        '-d',
        destination,
        '-m',
        'multiport',
        '--dports',
        `${LOCAL_HOMESERVER_PORT},${cdpPort}`,
        '-m',
        'conntrack',
        '--ctstate',
        'NEW',
        '-j',
        'ACCEPT',
      ],
      ...EGRESS_DROP_COUNTER_CLASSES.map(({ rule }) => rule),
    ];
    return {
      name,
      tool,
      chain,
      hook: ['-m', 'owner', '--uid-owner', String(uid), '-j', chain],
      chainRules,
    };
  });
}

function command(tool, args, { input, timeout = 5_000 } = {}) {
  const result = spawnSync(tool, args, {
    encoding: 'utf8',
    input,
    stdio: ['pipe', 'pipe', 'ignore'],
    timeout,
    maxBuffer: 256 * 1024,
  });
  if (result.error || result.signal || result.status !== 0) {
    throw new Error('egress policy command failed');
  }
  return result.stdout;
}

function commandExists(tool) {
  try {
    command(tool, ['-w', '-S']);
    return true;
  } catch {
    return false;
  }
}

function runIdChains(runIdValue) {
  const runId = requireRunId(runIdValue);
  return FAMILIES.map(({ name, tool, suffix }) => ({
    name,
    tool,
    chain: `MCWD_${runId}_${suffix}`,
  }));
}

function chainExists(tool, chain) {
  return command(tool, ['-w', '-S'])
    .split(/\r?\n/u)
    .some((line) => line === `-N ${chain}`);
}

function hasRule(tool, location, rule) {
  try {
    command(tool, ['-w', '-C', location, ...rule]);
    return true;
  } catch {
    return false;
  }
}

function deleteOneFamily(tool, chain, uid) {
  let complete = true;
  const hook = ['-m', 'owner', '--uid-owner', String(uid), '-j', chain];
  if (hasRule(tool, 'OUTPUT', hook)) {
    try {
      command(tool, ['-w', '-D', 'OUTPUT', ...hook]);
    } catch {
      complete = false;
    }
  }
  if (chainExists(tool, chain)) {
    try {
      command(tool, ['-w', '-F', chain]);
      command(tool, ['-w', '-X', chain]);
    } catch {
      complete = false;
    }
  }
  return (
    complete && !chainExists(tool, chain) && !hasRule(tool, 'OUTPUT', hook)
  );
}

export function removePolicy(uidValue, runIdValue) {
  const uid = requireDecimal(uidValue, 1, 65_535);
  const families = runIdChains(runIdValue);
  if (process.geteuid?.() !== 0) throw new Error('egress policy requires root');
  let complete = true;
  for (const family of families) {
    if (
      !commandExists(family.tool) ||
      !deleteOneFamily(family.tool, family.chain, uid)
    ) {
      complete = false;
    }
  }
  return complete;
}

export function installPolicy(uidValue, runIdValue, cdpPortValue) {
  const families = policySpec(uidValue, runIdValue, cdpPortValue);
  if (process.geteuid?.() !== 0) throw new Error('egress policy requires root');
  if (families.some(({ tool }) => !commandExists(tool))) {
    throw new Error('egress policy tool unavailable');
  }
  if (families.some(({ tool, chain }) => chainExists(tool, chain))) {
    throw new Error('egress policy chain already exists');
  }

  try {
    for (const { tool, chain, chainRules } of families) {
      command(tool, ['-w', '-N', chain]);
      for (const rule of chainRules)
        command(tool, ['-w', '-A', chain, ...rule]);
    }
    for (const { tool, chain, hook, chainRules } of families) {
      command(tool, ['-w', '-I', 'OUTPUT', '1', ...hook]);
      if (!hasRule(tool, 'OUTPUT', hook)) throw new Error('egress hook absent');
      for (const rule of chainRules) {
        if (!hasRule(tool, chain, rule)) throw new Error('egress rule absent');
      }
      const activeRules = command(tool, ['-w', '-S', chain])
        .split(/\r?\n/u)
        .filter((line) => line.startsWith(`-A ${chain} `));
      if (activeRules.length !== chainRules.length)
        throw new Error('egress chain incomplete');
    }
  } catch {
    try {
      removePolicy(uidValue, runIdValue);
    } catch {
      // The workflow's always-run cleanup checks policy removal separately.
    }
    throw new Error('egress policy installation failed');
  }
  return true;
}

export function parseDropCounterDetails(saveOutput, chain) {
  if (
    typeof saveOutput !== 'string' ||
    typeof chain !== 'string' ||
    !/^[A-Za-z0-9_]{1,28}$/u.test(chain)
  ) {
    throw new Error('egress counter unavailable');
  }
  const classes = {};
  let total = 0n;
  let overflow = false;
  for (const counterClass of EGRESS_DROP_COUNTER_CLASSES) {
    const rule = counterClass.rule.join(' ');
    const matches = [
      ...saveOutput.matchAll(
        new RegExp(`^\\[(\\d+):\\d+\\] -A ${chain} ${rule}$`, 'gmu'),
      ),
    ];
    if (matches.length !== 1) throw new Error('egress counter unavailable');
    const rawCount = BigInt(matches[0][1]);
    if (rawCount > BigInt(MAX_COUNT)) overflow = true;
    total += rawCount;
    classes[counterClass.name] = Number(
      rawCount > BigInt(MAX_COUNT) ? BigInt(MAX_COUNT) : rawCount,
    );
  }
  if (total > BigInt(MAX_COUNT)) overflow = true;
  return {
    blocked: Number(total > BigInt(MAX_COUNT) ? BigInt(MAX_COUNT) : total),
    classes,
    overflow,
  };
}

export function aggregateDropCounterDetails(ipv4, ipv6) {
  const validDetails = (value) =>
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === 'blocked,classes,overflow' &&
    Number.isSafeInteger(value.blocked) &&
    value.blocked >= 0 &&
    value.blocked <= MAX_COUNT &&
    typeof value.overflow === 'boolean' &&
    value.classes !== null &&
    typeof value.classes === 'object' &&
    !Array.isArray(value.classes) &&
    Object.keys(value.classes).sort().join(',') ===
      EGRESS_DROP_COUNTER_CLASSES.map(({ name }) => name)
        .sort()
        .join(',') &&
    EGRESS_DROP_COUNTER_CLASSES.every(
      ({ name }) =>
        Number.isSafeInteger(value.classes[name]) &&
        value.classes[name] >= 0 &&
        value.classes[name] <= MAX_COUNT,
    ) &&
    (value.overflow
      ? value.blocked === MAX_COUNT &&
        EGRESS_DROP_COUNTER_CLASSES.reduce(
          (total, { name }) => total + value.classes[name],
          0,
        ) >= value.blocked
      : EGRESS_DROP_COUNTER_CLASSES.reduce(
          (total, { name }) => total + value.classes[name],
          0,
        ) === value.blocked);
  if (!validDetails(ipv4) || !validDetails(ipv6)) {
    throw new Error('egress counter unavailable');
  }
  return {
    ipv4: ipv4.blocked,
    ipv6: ipv6.blocked,
    ipv4Classes: ipv4.classes,
    ipv6Classes: ipv6.classes,
    overflow: ipv4.overflow || ipv6.overflow,
  };
}

export function readBlockedCounters(runIdValue) {
  const families = runIdChains(runIdValue);
  if (process.geteuid?.() !== 0) throw new Error('egress policy requires root');
  return aggregateDropCounterDetails(
    readBlockedCounterDetails(families[0]),
    readBlockedCounterDetails(families[1]),
  );
}

function readBlockedCounter(family) {
  return readBlockedCounterDetails(family).blocked;
}

function readBlockedCounterDetails(family) {
  if (process.geteuid?.() !== 0) throw new Error('egress policy requires root');
  const output = command(`${family.tool}-save`, ['-c']);
  return parseDropCounterDetails(output, family.chain);
}

export function resetCounters(runIdValue) {
  if (process.geteuid?.() !== 0) throw new Error('egress policy requires root');
  for (const family of runIdChains(runIdValue)) {
    command(family.tool, ['-w', '-Z', family.chain]);
  }
  const counts = readBlockedCounters(runIdValue);
  if (counts.ipv4 !== 0 || counts.ipv6 !== 0 || counts.overflow) {
    throw new Error('egress counters did not reset');
  }
  return true;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function classifySpawnError(error) {
  switch (error?.code) {
    case 'ENOENT':
      return 'missing-executable';
    case 'EACCES':
    case 'EPERM':
      return 'permission';
    case 'ETIMEDOUT':
      return 'timeout';
    case 'EAGAIN':
    case 'EMFILE':
    case 'ENFILE':
    case 'ENOMEM':
      return 'resource';
    default:
      return 'other';
  }
}

function classifyChildStderr(stderr, expectedScriptPath) {
  const text = stderr.toLowerCase();
  if (text.trim().length === 0) return 'empty';
  if (
    [
      'a password is required',
      'a terminal is required',
      'not allowed to execute',
      'not in the sudoers',
    ].some((marker) => text.includes(marker))
  ) {
    return 'sudo-policy';
  }
  if (
    ['permission denied', 'eacces', 'eperm'].some((marker) =>
      text.includes(marker),
    )
  ) {
    return 'permission';
  }
  const missingModule = /cannot find module\s+['"]([^'"]+)['"]/iu.exec(stderr);
  if (missingModule) {
    const missingTarget = missingModule[1];
    let normalizedTarget = missingTarget;
    if (normalizedTarget.startsWith('file:')) {
      try {
        normalizedTarget = fileURLToPath(normalizedTarget);
      } catch {
        // An invalid or unexpected module target remains a generic import failure.
      }
    }
    if (expectedScriptPath && normalizedTarget === expectedScriptPath) {
      return 'missing-script';
    }
    return 'missing-import';
  }
  if (
    /cannot find package\s+['"]/iu.test(stderr) ||
    /err_module_not_found/iu.test(stderr)
  ) {
    return 'missing-import';
  }
  if (
    /syntaxerror|unexpected token|cannot use import statement outside a module/iu.test(
      stderr,
    )
  ) {
    return 'syntax';
  }
  if (
    [
      'requires a newer node',
      'unsupported node version',
      'node version is not supported',
      'bad option',
      'unknown option',
      'err_unknown_file_extension',
      'err_unsupported_dir_import',
      'err_require_esm',
      'compiled against a different node.js version',
      'module version mismatch',
      'node_module_version',
    ].some((marker) => text.includes(marker))
  ) {
    return 'runtime-version';
  }
  return 'other';
}

export function probeFromSpawn(
  result,
  expectedScriptPath = fileURLToPath(import.meta.url),
) {
  const output = typeof result?.stdout === 'string' ? result.stdout : '';
  const stderr = typeof result?.stderr === 'string' ? result.stderr : '';
  const lines = output.split(/\r?\n/u).filter(Boolean);
  const probeMarkerPresent = lines[0] === 'probe-started';
  const childExitStatus =
    Number.isSafeInteger(result?.status) &&
    result.status >= 0 &&
    result.status <= 255
      ? result.status
      : null;
  const childSignal =
    typeof result?.signal === 'string' && result.signal.length > 0
      ? SAFE_SIGNALS.has(result.signal)
        ? result.signal
        : 'other'
      : null;
  const defaults = {
    childResult: 'probe-reported',
    childExitStatus,
    childSignal,
    spawnErrorClass: result?.error ? classifySpawnError(result.error) : null,
    stderrClass: classifyChildStderr(stderr, expectedScriptPath),
    probeMarkerPresent,
    probeUidMatches: null,
    connectAttempted: false,
    connectionOutcome: 'unexpected-exit',
  };
  if (result?.error) {
    return {
      ...defaults,
      childResult: 'spawn-error',
      connectionOutcome: 'spawn-error',
    };
  }
  if (childSignal !== null) {
    return {
      ...defaults,
      childResult: 'signaled',
      connectionOutcome: 'signaled',
    };
  }
  if (!probeMarkerPresent) {
    return {
      ...defaults,
      childResult:
        lines.length === 0 ? 'exited-before-marker' : 'protocol-invalid',
      connectionOutcome:
        lines.length === 0 ? 'unexpected-exit' : 'protocol-error',
    };
  }
  if (lines.length !== 2) {
    return {
      ...defaults,
      childResult: 'protocol-invalid',
      connectionOutcome: 'protocol-error',
    };
  }
  if (lines[1] === 'probe-uid-mismatch') {
    if (result?.status === 3) {
      return {
        ...defaults,
        probeUidMatches: false,
        connectionOutcome: 'uid-mismatch',
      };
    }
    return {
      ...defaults,
      childResult: 'protocol-invalid',
      connectionOutcome: 'protocol-error',
    };
  }
  const outcome = lines[1].startsWith('probe-result:')
    ? lines[1].slice('probe-result:'.length)
    : null;
  const exitStatus = {
    connected: 0,
    timeout: 2,
    refused: 4,
    unreachable: 5,
    'socket-error': 6,
    'socket-init-error': 7,
  }[outcome];
  if (!Number.isSafeInteger(exitStatus) || result?.status !== exitStatus) {
    return {
      ...defaults,
      childResult: 'protocol-invalid',
      connectionOutcome: 'protocol-error',
    };
  }
  return {
    ...defaults,
    probeUidMatches: true,
    connectAttempted: outcome !== 'socket-init-error',
    connectionOutcome: outcome,
  };
}

function familyProbePassed(value) {
  return (
    value?.listenerBound === true &&
    value.childResult === 'probe-reported' &&
    value.probeMarkerPresent === true &&
    value.probeUidMatches === true &&
    value.connectAttempted === true &&
    value.connectionOutcome === 'timeout' &&
    value.listenerAcceptedCount === 0 &&
    Number.isSafeInteger(value.dropCount) &&
    value.dropCount > 0
  );
}

export function negativeProbePassed(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    familyProbePassed(value.ipv4) &&
    familyProbePassed(value.ipv6)
  );
}

function unrunChildObservation() {
  return {
    childResult: 'not-run',
    childExitStatus: null,
    childSignal: null,
    spawnErrorClass: null,
    stderrClass: 'empty',
    probeMarkerPresent: false,
    probeUidMatches: null,
    connectAttempted: false,
    connectionOutcome: 'listener-error',
  };
}

async function localListener(host, excludedPort) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const server = createServer();
    let accepts = 0;
    server.on('connection', (socket) => {
      accepts += 1;
      socket.destroy();
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(
        host === '::1' ? { host, port: 0, ipv6Only: true } : { host, port: 0 },
        resolve,
      );
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      await new Promise((resolve) => server.close(resolve));
      continue;
    }
    if (
      address.port === LOCAL_HOMESERVER_PORT ||
      address.port === excludedPort
    ) {
      await new Promise((resolve) => server.close(resolve));
      continue;
    }
    return { server, port: address.port, getAccepts: () => accepts };
  }
  throw new Error('negative egress listener unavailable');
}

function connectResult(host, port) {
  return new Promise((resolve) => {
    let socket;
    try {
      socket = createConnection({ host, port });
    } catch {
      resolve('socket-init-error');
      return;
    }
    let settled = false;
    const finish = (outcome) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(outcome);
    };
    socket.setTimeout(600, () => finish('timeout'));
    socket.once('connect', () => finish('connected'));
    socket.once('error', (error) => {
      if (error.code === 'ECONNREFUSED') finish('refused');
      else if (
        ['EHOSTUNREACH', 'ENETUNREACH', 'EADDRNOTAVAIL'].includes(error.code)
      ) {
        finish('unreachable');
      } else finish('socket-error');
    });
  });
}

async function testFamilyAsUid(
  uid,
  host,
  port,
  script = fileURLToPath(import.meta.url),
) {
  const result = spawnSync(
    'sudo',
    [
      '-n',
      '-u',
      `#${uid}`,
      '--',
      process.execPath,
      script,
      '--connect',
      String(uid),
      host,
      String(port),
    ],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 2_000,
      maxBuffer: 4_096,
    },
  );
  return probeFromSpawn(result, script);
}

export function stagedE2ePackagePath(scriptPath) {
  if (typeof scriptPath !== 'string' || scriptPath.length === 0) {
    throw new Error('invalid staged probe script');
  }
  return join(dirname(dirname(scriptPath)), 'e2e', 'package.json');
}

export const RUNTIME_FACTS_SOURCE = `
const fs = require('node:fs');
const { createRequire } = require('node:module');
const [expectedUidText, scriptPath, startupPath, configPath, e2ePackagePath, checkoutRootPath, checkoutDevPath, controlScriptPath] = process.argv.slice(1);
const expectedUid = Number(expectedUidText);
const canAccess = (path, mode) => {
  try { fs.accessSync(path, mode); return true; } catch { return false; }
};
let playwrightUsable = false;
try {
  const e2eRequire = createRequire(e2ePackagePath);
  playwrightUsable = typeof e2eRequire('@playwright/test').chromium?.connectOverCDP === 'function';
} catch {}
const facts = {
  uidMatches: process.getuid?.() === expectedUid,
  nodeVersion: process.versions.node,
  nodeExecutableRunnable: canAccess(process.execPath, fs.constants.X_OK),
  scriptExists: fs.existsSync(scriptPath),
  scriptReadable: canAccess(scriptPath, fs.constants.R_OK),
  startupScriptReadable: canAccess(startupPath, fs.constants.R_OK),
  configReadable: canAccess(configPath, fs.constants.R_OK),
  e2eManifestReadable: canAccess(e2ePackagePath, fs.constants.R_OK),
  playwrightUsable,
  checkoutControlProtected: [
    checkoutRootPath,
    checkoutDevPath,
    controlScriptPath,
  ].every(
    (path) =>
      typeof path === 'string' &&
      path.length > 0 &&
      !canAccess(path, fs.constants.W_OK),
  ),
};
process.stdout.write('runtime-facts-started\\n' + JSON.stringify(facts) + '\\n');
`;

export function runtimeFactsFromSpawn(result, expectedScriptPath) {
  const output = typeof result?.stdout === 'string' ? result.stdout : '';
  const stderr = typeof result?.stderr === 'string' ? result.stderr : '';
  const lines = output.split(/\r?\n/u).filter(Boolean);
  const markerPresent = lines[0] === 'runtime-facts-started';
  const childExitStatus =
    Number.isSafeInteger(result?.status) &&
    result.status >= 0 &&
    result.status <= 255
      ? result.status
      : null;
  const childSignal =
    typeof result?.signal === 'string' && result.signal.length > 0
      ? SAFE_SIGNALS.has(result.signal)
        ? result.signal
        : 'other'
      : null;
  const resultBase = {
    childResult: 'exited-before-marker',
    childExitStatus,
    childSignal,
    spawnErrorClass: result?.error ? classifySpawnError(result.error) : null,
    stderrClass: classifyChildStderr(stderr, expectedScriptPath),
    markerPresent,
    uidMatches: null,
    nodeVersion: null,
    nodeVersionSupported: false,
    nodeExecutableRunnable: null,
    scriptExists: null,
    scriptReadable: null,
    startupScriptReadable: null,
    configReadable: null,
    e2eManifestReadable: null,
    playwrightUsable: null,
    checkoutControlProtected: null,
  };
  if (result?.error) return { ...resultBase, childResult: 'spawn-error' };
  if (childSignal !== null) return { ...resultBase, childResult: 'signaled' };
  if (!markerPresent) {
    return {
      ...resultBase,
      childResult:
        lines.length === 0 ? 'exited-before-marker' : 'protocol-invalid',
    };
  }
  if (lines.length !== 2 || childExitStatus !== 0) {
    return { ...resultBase, childResult: 'protocol-invalid' };
  }
  try {
    const value = JSON.parse(lines[1]);
    const keys = [
      'uidMatches',
      'nodeVersion',
      'nodeExecutableRunnable',
      'scriptExists',
      'scriptReadable',
      'startupScriptReadable',
      'configReadable',
      'e2eManifestReadable',
      'playwrightUsable',
      'checkoutControlProtected',
    ];
    if (
      value === null ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).sort().join('\0') !== keys.sort().join('\0') ||
      typeof value.uidMatches !== 'boolean' ||
      typeof value.nodeVersion !== 'string' ||
      !/^\d+\.\d+\.\d+$/u.test(value.nodeVersion) ||
      [
        'nodeExecutableRunnable',
        'scriptExists',
        'scriptReadable',
        'startupScriptReadable',
        'configReadable',
        'e2eManifestReadable',
        'playwrightUsable',
        'checkoutControlProtected',
      ].some((key) => typeof value[key] !== 'boolean')
    ) {
      return { ...resultBase, childResult: 'protocol-invalid' };
    }
    return {
      ...resultBase,
      childResult: 'probe-reported',
      uidMatches: value.uidMatches,
      nodeVersion: value.nodeVersion,
      nodeVersionSupported: value.nodeVersion.split('.')[0] === '22',
      nodeExecutableRunnable: value.nodeExecutableRunnable,
      scriptExists: value.scriptExists,
      scriptReadable: value.scriptReadable,
      startupScriptReadable: value.startupScriptReadable,
      configReadable: value.configReadable,
      e2eManifestReadable: value.e2eManifestReadable,
      playwrightUsable: value.playwrightUsable,
      checkoutControlProtected: value.checkoutControlProtected,
    };
  } catch {
    return { ...resultBase, childResult: 'protocol-invalid' };
  }
}

function unrunPositiveProbe() {
  return {
    listenerBound: false,
    ...unrunChildObservation(),
    listenerAcceptedCount: null,
  };
}

function requireStagedProbeScript(value) {
  const profileRoot = process.env.ELEMENT_DESKTOP_PROFILE_ROOT ?? '';
  if (
    !/^\/tmp\/mcw-element-desktop-[0-9]{1,18}-[0-9]{1,6}-[A-Za-z0-9]{6}$/u.test(
      profileRoot,
    ) ||
    value !== `${profileRoot}/probe/dev/element-desktop-egress-policy.mjs`
  ) {
    throw new Error('invalid staged probe script');
  }
  return value;
}

export async function isolatedUidPreflight(
  uidValue,
  stagedScriptPath = fileURLToPath(import.meta.url),
) {
  const uid = requireDecimal(uidValue, 1, 65_535);
  const script = stagedScriptPath;
  const startupScript = process.env.ELEMENT_DESKTOP_STARTUP_SCRIPT_PATH ?? '';
  const configFile = process.env.ELEMENT_DESKTOP_CONFIG_PATH ?? '';
  const e2ePackage = stagedE2ePackagePath(script);
  const checkoutDev = fileURLToPath(new URL('.', import.meta.url));
  const checkoutRoot = fileURLToPath(new URL('../', import.meta.url));
  const factsResult = spawnSync(
    'sudo',
    [
      '-n',
      '-u',
      `#${uid}`,
      '--',
      process.execPath,
      '-e',
      RUNTIME_FACTS_SOURCE,
      String(uid),
      script,
      startupScript,
      configFile,
      e2ePackage,
      checkoutRoot,
      checkoutDev,
      fileURLToPath(import.meta.url),
    ],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 2_000,
      maxBuffer: 4_096,
    },
  );
  const runtimeFacts = runtimeFactsFromSpawn(factsResult, script);
  let scriptProbe = unrunPositiveProbe();
  let listener;
  try {
    listener = await localListener('127.0.0.1');
  } catch {
    // Retain a fixed not-run result if the loopback listener cannot bind.
  }
  if (listener) {
    try {
      scriptProbe = {
        listenerBound: true,
        ...(await testFamilyAsUid(
          uid,
          '127.0.0.1',
          listener.port,
          stagedScriptPath,
        )),
        listenerAcceptedCount: 0,
      };
    } catch {
      scriptProbe = {
        listenerBound: true,
        childResult: 'probe-error',
        childExitStatus: null,
        childSignal: null,
        spawnErrorClass: null,
        stderrClass: 'unavailable',
        probeMarkerPresent: false,
        probeUidMatches: null,
        connectAttempted: false,
        connectionOutcome: 'probe-error',
        listenerAcceptedCount: 0,
      };
    }
    await wait(25);
    scriptProbe.listenerAcceptedCount = Math.min(2, listener.getAccepts());
    await new Promise((resolve) => listener.server.close(resolve));
  }
  const status =
    runtimeFacts.childResult === 'probe-reported' &&
    runtimeFacts.uidMatches === true &&
    runtimeFacts.nodeVersionSupported === true &&
    runtimeFacts.nodeExecutableRunnable === true &&
    runtimeFacts.scriptExists === true &&
    runtimeFacts.scriptReadable === true &&
    runtimeFacts.startupScriptReadable === true &&
    runtimeFacts.configReadable === true &&
    runtimeFacts.e2eManifestReadable === true &&
    runtimeFacts.playwrightUsable === true &&
    runtimeFacts.checkoutControlProtected === true &&
    scriptProbe.listenerBound === true &&
    scriptProbe.childResult === 'probe-reported' &&
    scriptProbe.probeMarkerPresent === true &&
    scriptProbe.probeUidMatches === true &&
    scriptProbe.connectAttempted === true &&
    scriptProbe.connectionOutcome === 'connected' &&
    scriptProbe.listenerAcceptedCount === 1
      ? 'passed'
      : 'failed';
  return { phase: 'target-uid-preflight', status, runtimeFacts, scriptProbe };
}

export async function negativeLocalEgressCheck(
  uidValue,
  runIdValue,
  cdpPortValue,
  stagedScriptPath = fileURLToPath(import.meta.url),
) {
  const uid = requireDecimal(uidValue, 1, 65_535);
  const cdpPort = requireDecimal(cdpPortValue, 1_024, 65_535);
  requireRunId(runIdValue);
  const diagnostic = {};
  for (const family of FAMILIES) {
    const host = family.name === 'ipv4' ? '127.0.0.1' : '::1';
    const value = {
      listenerBound: false,
      ...unrunChildObservation(),
      listenerAcceptedCount: null,
      dropCount: null,
    };
    let listener;
    try {
      listener = await localListener(host, cdpPort);
      value.listenerBound = true;
      value.listenerAcceptedCount = 0;
    } catch {
      // Keep the fixed listener-error observation and continue to IPv6/IPv4.
    }
    if (listener) {
      try {
        Object.assign(
          value,
          await testFamilyAsUid(uid, host, listener.port, stagedScriptPath),
        );
      } catch {
        Object.assign(value, {
          childResult: 'probe-error',
          childExitStatus: null,
          childSignal: null,
          spawnErrorClass: null,
          stderrClass: 'unavailable',
          probeMarkerPresent: false,
          probeUidMatches: null,
          connectAttempted: false,
          connectionOutcome: 'probe-error',
        });
      }
      await wait(25);
      value.listenerAcceptedCount = Math.min(2, listener.getAccepts());
      await new Promise((resolve) => listener.server.close(resolve));
    }
    try {
      const counterFamily = runIdChains(runIdValue).find(
        (entry) => entry.name === family.name,
      );
      if (!counterFamily) throw new Error('counter family unavailable');
      value.dropCount = readBlockedCounter(counterFamily);
    } catch {
      // Null distinguishes an unavailable counter from a measured zero.
    }
    diagnostic[family.name] = value;
  }
  return { ...diagnostic, passed: negativeProbePassed(diagnostic) };
}

async function connectOnly(expectedUidValue, host, port) {
  process.stdout.write('probe-started\n');
  const expectedUid = requireDecimal(expectedUidValue, 1, 65_535);
  const normalizedHost = host === '127.0.0.1' || host === '::1' ? host : null;
  const normalizedPort = requireDecimal(port, 1, 65_535);
  if (normalizedHost === null) {
    process.stdout.write('probe-result:socket-init-error\n');
    process.exitCode = 7;
    return;
  }
  if (process.getuid?.() !== expectedUid) {
    process.stdout.write('probe-uid-mismatch\n');
    process.exitCode = 3;
    return;
  }
  const outcome = await connectResult(normalizedHost, normalizedPort);
  const status = {
    connected: 0,
    timeout: 2,
    refused: 4,
    unreachable: 5,
    'socket-error': 6,
    'socket-init-error': 7,
  }[outcome];
  process.stdout.write(`probe-result:${outcome}\n`);
  process.exitCode = status ?? 6;
}

function printCounters(runId) {
  const counts = readBlockedCounters(runId);
  process.stdout.write(
    `${JSON.stringify({
      ipv4Blocked: counts.ipv4,
      ipv6Blocked: counts.ipv6,
      ipv4Classes: counts.ipv4Classes,
      ipv6Classes: counts.ipv6Classes,
      overflow: counts.overflow,
    })}\n`,
  );
}

async function main(args) {
  const [operation, ...values] = args;
  if (operation === 'install' && values.length === 3) {
    installPolicy(values[0], values[1], values[2]);
    return;
  }
  if (operation === 'negative-self-test' && values.length === 4) {
    const diagnostic = await negativeLocalEgressCheck(
      values[0],
      values[1],
      values[2],
      requireStagedProbeScript(values[3]),
    );
    process.stdout.write(`${JSON.stringify(diagnostic)}\n`);
    if (!diagnostic.passed) process.exitCode = 2;
    return;
  }
  if (operation === 'target-uid-preflight' && values.length === 2) {
    let record;
    try {
      record = await isolatedUidPreflight(
        values[0],
        requireStagedProbeScript(values[1]),
      );
    } catch {
      record = {
        phase: 'target-uid-preflight',
        status: 'failed',
        runtimeFacts: null,
        scriptProbe: null,
      };
    }
    process.stdout.write(`${JSON.stringify(record)}\n`);
    if (record.status !== 'passed') process.exitCode = 2;
    return;
  }
  if (operation === 'zero-counters' && values.length === 1) {
    resetCounters(values[0]);
    return;
  }
  if (operation === 'counters' && values.length === 1) {
    printCounters(values[0]);
    return;
  }
  if (operation === 'remove' && values.length === 2) {
    if (!removePolicy(values[0], values[1]))
      throw new Error('egress policy cleanup failed');
    return;
  }
  if (operation === '--connect' && values.length === 3) {
    await connectOnly(values[0], values[1], values[2]);
    return;
  }
  throw new Error('invalid egress policy operation');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(() => {
    process.stderr.write('element desktop egress policy failed\n');
    process.exitCode = 1;
  });
}
