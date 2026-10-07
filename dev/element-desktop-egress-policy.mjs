import { spawnSync } from 'node:child_process';
import { createConnection, createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const LOCAL_HOMESERVER_PORT = 8008;
const MAX_COUNT = 100_000;
const FAMILIES = Object.freeze([
  { name: 'ipv4', tool: 'iptables', suffix: '4', destination: '127.0.0.1/32' },
  { name: 'ipv6', tool: 'ip6tables', suffix: '6', destination: '::1/128' },
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
      ['-j', 'DROP'],
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
      if (activeRules.length !== 3) throw new Error('egress chain incomplete');
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

function parseDropCounter(saveOutput, chain) {
  const escaped = chain.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const matches = [
    ...saveOutput.matchAll(
      new RegExp(`^\\[(\\d+):\\d+\\] -A ${escaped} -j DROP$`, 'gmu'),
    ),
  ];
  if (matches.length !== 1) throw new Error('egress counter unavailable');
  const count = BigInt(matches[0][1]);
  return Number(count > BigInt(MAX_COUNT) ? BigInt(MAX_COUNT) : count);
}

export function readBlockedCounters(runIdValue) {
  const families = runIdChains(runIdValue);
  if (process.geteuid?.() !== 0) throw new Error('egress policy requires root');
  const counts = {};
  for (const family of families) {
    counts[family.name] = readBlockedCounter(family);
  }
  return counts;
}

function readBlockedCounter(family) {
  if (process.geteuid?.() !== 0) throw new Error('egress policy requires root');
  const output = command(`${family.tool}-save`, ['-c']);
  return parseDropCounter(output, family.chain);
}

export function resetCounters(runIdValue) {
  if (process.geteuid?.() !== 0) throw new Error('egress policy requires root');
  for (const family of runIdChains(runIdValue)) {
    command(family.tool, ['-w', '-Z', family.chain]);
  }
  const counts = readBlockedCounters(runIdValue);
  if (Object.values(counts).some((value) => value !== 0)) {
    throw new Error('egress counters did not reset');
  }
  return true;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function probeFromSpawn(result) {
  const output = typeof result?.stdout === 'string' ? result.stdout : '';
  const lines = output.split(/\r?\n/u).filter(Boolean);
  const probeSpawned = lines[0] === 'probe-started';
  const defaults = {
    probeSpawned,
    probeUidMatches: null,
    connectAttempted: false,
    connectionOutcome: 'unexpected-exit',
  };
  if (!probeSpawned) {
    return {
      ...defaults,
      connectionOutcome: result?.error ? 'spawn-error' : 'unexpected-exit',
    };
  }
  if (result?.signal) return { ...defaults, connectionOutcome: 'signaled' };
  if (result?.error || lines.length !== 2) return defaults;
  if (lines[1] === 'probe-uid-mismatch') {
    if (result?.status === 3) {
      return {
        ...defaults,
        probeUidMatches: false,
        connectionOutcome: 'uid-mismatch',
      };
    }
    return defaults;
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
    return defaults;
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
    value.probeSpawned === true &&
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

async function testFamilyAsUid(uid, host, port) {
  const script = fileURLToPath(import.meta.url);
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
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2_000,
      maxBuffer: 1_024,
    },
  );
  return probeFromSpawn(result);
}

export async function negativeLocalEgressCheck(
  uidValue,
  runIdValue,
  cdpPortValue,
) {
  const uid = requireDecimal(uidValue, 1, 65_535);
  const cdpPort = requireDecimal(cdpPortValue, 1_024, 65_535);
  requireRunId(runIdValue);
  const diagnostic = {};
  for (const family of FAMILIES) {
    const host = family.name === 'ipv4' ? '127.0.0.1' : '::1';
    const value = {
      listenerBound: false,
      probeSpawned: false,
      probeUidMatches: null,
      connectAttempted: false,
      connectionOutcome: 'listener-error',
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
        Object.assign(value, await testFamilyAsUid(uid, host, listener.port));
      } catch {
        value.connectionOutcome = 'probe-error';
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
  process.stdout.write(`${JSON.stringify(counts)}\n`);
}

async function main(args) {
  const [operation, ...values] = args;
  if (operation === 'install' && values.length === 3) {
    installPolicy(values[0], values[1], values[2]);
    return;
  }
  if (operation === 'negative-self-test' && values.length === 3) {
    const diagnostic = await negativeLocalEgressCheck(
      values[0],
      values[1],
      values[2],
    );
    process.stdout.write(`${JSON.stringify(diagnostic)}\n`);
    if (!diagnostic.passed) process.exitCode = 2;
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
