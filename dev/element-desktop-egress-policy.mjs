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
    const output = command(`${family.tool}-save`, ['-c']);
    counts[family.name] = parseDropCounter(output, family.chain);
  }
  return counts;
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
    const socket = createConnection({ host, port });
    let settled = false;
    const finish = (connected) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(connected);
    };
    socket.setTimeout(600, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
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
      host,
      String(port),
    ],
    { encoding: 'utf8', stdio: ['ignore', 'ignore', 'ignore'], timeout: 2_000 },
  );
  return (
    result.error === undefined && result.signal === null && result.status === 2
  );
}

export async function negativeLocalEgressCheck(
  uidValue,
  runIdValue,
  cdpPortValue,
) {
  const uid = requireDecimal(uidValue, 1, 65_535);
  const cdpPort = requireDecimal(cdpPortValue, 1_024, 65_535);
  requireRunId(runIdValue);
  const listeners = [];
  try {
    for (const host of ['127.0.0.1', '::1']) {
      const listener = await localListener(host, cdpPort);
      listeners.push(listener);
      const connected = await testFamilyAsUid(uid, host, listener.port);
      await wait(25);
      if (connected || listener.getAccepts() !== 0) return false;
    }
    const counts = readBlockedCounters(runIdValue);
    return counts.ipv4 > 0 && counts.ipv6 > 0;
  } catch {
    return false;
  } finally {
    await Promise.all(
      listeners.map(
        ({ server }) => new Promise((resolve) => server.close(resolve)),
      ),
    );
  }
}

async function connectOnly(host, port) {
  const normalizedHost = host === '127.0.0.1' || host === '::1' ? host : null;
  const normalizedPort = requireDecimal(port, 1, 65_535);
  if (normalizedHost === null) process.exit(2);
  process.exit((await connectResult(normalizedHost, normalizedPort)) ? 0 : 2);
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
    const passed = await negativeLocalEgressCheck(
      values[0],
      values[1],
      values[2],
    );
    if (!passed) throw new Error('negative egress self-test failed');
    process.stdout.write('desktop-egress-negative-test=passed\n');
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
  if (operation === '--connect' && values.length === 2) {
    await connectOnly(values[0], values[1]);
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
