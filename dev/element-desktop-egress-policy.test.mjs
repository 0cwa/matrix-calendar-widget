import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  aggregateDropCounterDetails,
  EGRESS_DROP_COUNTER_CLASSES,
  negativeProbePassed,
  parseDropCounterDetails,
  policySpec,
  probeFromSpawn,
  RUNTIME_FACTS_SOURCE,
  runtimeFactsFromSpawn,
  stagedE2ePackagePath,
} from './element-desktop-egress-policy.mjs';

function passingFamily() {
  return {
    listenerBound: true,
    childResult: 'probe-reported',
    childExitStatus: 2,
    childSignal: null,
    spawnErrorClass: null,
    stderrClass: 'empty',
    probeMarkerPresent: true,
    probeUidMatches: true,
    connectAttempted: true,
    connectionOutcome: 'timeout',
    listenerAcceptedCount: 0,
    dropCount: 1,
  };
}

function childStdoutAvailable() {
  const result = spawnSync(
    process.execPath,
    ['-e', "process.stdout.write('probe-output')"],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2_000,
    },
  );
  return result.status === 0 && result.stdout === 'probe-output';
}

test('desktop egress permits only the fixture homeserver and loopback CDP ports', () => {
  const [ipv4, ipv6] = policySpec(42_420, '7315', 9_223);

  assert.deepEqual(ipv4.hook, [
    '-m',
    'owner',
    '--uid-owner',
    '42420',
    '-j',
    'MCWD_7315_4',
  ]);
  assert.deepEqual(ipv6.hook, [
    '-m',
    'owner',
    '--uid-owner',
    '42420',
    '-j',
    'MCWD_7315_6',
  ]);
  const acceptedRules = [
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
      '127.0.0.1/32',
      '-m',
      'multiport',
      '--dports',
      '8008,9223',
      '-m',
      'conntrack',
      '--ctstate',
      'NEW',
      '-j',
      'ACCEPT',
    ],
  ];
  assert.deepEqual(ipv4.chainRules.slice(0, 2), acceptedRules);
  assert.deepEqual(ipv6.chainRules.slice(0, 2), [
    acceptedRules[0],
    [...acceptedRules[1].slice(0, 5), '::1/128', ...acceptedRules[1].slice(6)],
  ]);
  for (const family of [ipv4, ipv6]) {
    assert.deepEqual(
      family.chainRules.slice(2),
      EGRESS_DROP_COUNTER_CLASSES.map(({ rule }) => rule),
    );
    assert.ok(
      family.chainRules.slice(2).every((rule) => rule.at(-1) === 'DROP'),
    );
  }
});

test('drop counter classes stay disjoint, aggregate, capped, and unavailable on malformed rules', () => {
  const chain = 'MCWD_7315_4';
  const makeSaveOutput = (counts) =>
    EGRESS_DROP_COUNTER_CLASSES.map(
      ({ name, rule }) => `[${counts[name]}:0] -A ${chain} ${rule.join(' ')}`,
    ).join('\n');
  const details = parseDropCounterDetails(
    makeSaveOutput({
      udp_dns_port: 2,
      tcp_dns_port: 3,
      tcp_https_port: 5,
      other: 6,
    }),
    chain,
  );
  assert.deepEqual(details, {
    blocked: 16,
    classes: {
      udp_dns_port: 2,
      tcp_dns_port: 3,
      tcp_https_port: 5,
      other: 6,
    },
    overflow: false,
  });

  assert.throws(
    () =>
      parseDropCounterDetails(
        makeSaveOutput({
          udp_dns_port: 0,
          tcp_dns_port: 0,
          tcp_https_port: 0,
          other: 0,
        }).replace(/-A MCWD_7315_4 -j DROP/u, '-A MCWD_7315_4 -j ACCEPT'),
        chain,
      ),
    /egress counter unavailable/u,
  );
  assert.throws(
    () =>
      parseDropCounterDetails(
        `${makeSaveOutput({ udp_dns_port: 0, tcp_dns_port: 0, tcp_https_port: 0, other: 0 })}\n[0:0] -A ${chain} -j DROP`,
        chain,
      ),
    /egress counter unavailable/u,
  );

  const overflow = parseDropCounterDetails(
    makeSaveOutput({
      udp_dns_port: 100_001,
      tcp_dns_port: 0,
      tcp_https_port: 0,
      other: 0,
    }),
    chain,
  );
  assert.deepEqual(overflow, {
    blocked: 100_000,
    classes: {
      udp_dns_port: 100_000,
      tcp_dns_port: 0,
      tcp_https_port: 0,
      other: 0,
    },
    overflow: true,
  });
});

test('IPv4 and IPv6 class counters aggregate without changing the blocked totals', () => {
  const parseFamily = (chain, counts) =>
    parseDropCounterDetails(
      EGRESS_DROP_COUNTER_CLASSES.map(
        ({ name, rule }) => `[${counts[name]}:0] -A ${chain} ${rule.join(' ')}`,
      ).join('\n'),
      chain,
    );
  const ipv4 = parseFamily('MCWD_7315_4', {
    udp_dns_port: 2,
    tcp_dns_port: 1,
    tcp_https_port: 0,
    other: 3,
  });
  const ipv6 = parseFamily('MCWD_7315_6', {
    udp_dns_port: 0,
    tcp_dns_port: 1,
    tcp_https_port: 4,
    other: 0,
  });
  assert.deepEqual(aggregateDropCounterDetails(ipv4, ipv6), {
    ipv4: 6,
    ipv6: 5,
    ipv4Classes: {
      udp_dns_port: 2,
      tcp_dns_port: 1,
      tcp_https_port: 0,
      other: 3,
    },
    ipv6Classes: {
      udp_dns_port: 0,
      tcp_dns_port: 1,
      tcp_https_port: 4,
      other: 0,
    },
    overflow: false,
  });
  assert.throws(
    () => aggregateDropCounterDetails({ ...ipv4, blocked: 7 }, ipv6),
    /egress counter unavailable/u,
  );
});

test('desktop egress rejects invalid identifiers and a CDP port that shadows Synapse', () => {
  assert.throws(() => policySpec(0, '7315', 9_223), /invalid policy input/u);
  assert.throws(
    () => policySpec(42_420, '../7315', 9_223),
    /invalid policy input/u,
  );
  assert.throws(
    () => policySpec(42_420, '7315', 8008),
    /invalid policy input/u,
  );
  assert.throws(() => policySpec(42_420, '7315', 80), /invalid policy input/u);
});

test('negative egress requires the expected uid, timed-out connects and DROP counters in both families', () => {
  const diagnostic = { ipv4: passingFamily(), ipv6: passingFamily() };
  assert.equal(negativeProbePassed(diagnostic), true);

  for (const [family, field, value] of [
    ['ipv4', 'probeUidMatches', false],
    ['ipv4', 'connectionOutcome', 'connected'],
    ['ipv4', 'listenerAcceptedCount', 1],
    ['ipv4', 'dropCount', 0],
    ['ipv6', 'listenerBound', false],
    ['ipv6', 'dropCount', null],
  ]) {
    const failed = structuredClone(diagnostic);
    failed[family][field] = value;
    assert.equal(negativeProbePassed(failed), false);
  }
});

test('child result classification does not treat spawn or identity failures as blocked connects', () => {
  const timeout = probeFromSpawn({
    pid: 123,
    status: 2,
    signal: null,
    stdout: 'probe-started\nprobe-result:timeout\n',
  });
  assert.deepEqual(timeout, {
    childResult: 'probe-reported',
    childExitStatus: 2,
    childSignal: null,
    spawnErrorClass: null,
    stderrClass: 'empty',
    probeMarkerPresent: true,
    probeUidMatches: true,
    connectAttempted: true,
    connectionOutcome: 'timeout',
  });
  const uidMismatch = probeFromSpawn({
    pid: 123,
    status: 3,
    signal: null,
    stdout: 'probe-started\nprobe-uid-mismatch\n',
  });
  assert.equal(uidMismatch.childResult, 'probe-reported');
  assert.equal(uidMismatch.connectionOutcome, 'uid-mismatch');

  const beforeMarker = probeFromSpawn({
    pid: 123,
    status: 1,
    signal: null,
    stdout: '',
    stderr: 'sudo: a password is required\n',
  });
  assert.deepEqual(beforeMarker, {
    childResult: 'exited-before-marker',
    childExitStatus: 1,
    childSignal: null,
    spawnErrorClass: null,
    stderrClass: 'sudo-policy',
    probeMarkerPresent: false,
    probeUidMatches: null,
    connectAttempted: false,
    connectionOutcome: 'unexpected-exit',
  });

  const spawnFailure = probeFromSpawn({
    pid: undefined,
    status: null,
    signal: null,
    error: Object.assign(new Error(), { code: 'EACCES' }),
    stdout: '',
    stderr: 'permission denied',
  });
  assert.equal(spawnFailure.childResult, 'spawn-error');
  assert.equal(spawnFailure.spawnErrorClass, 'permission');
  assert.equal(spawnFailure.stderrClass, 'permission');
  assert.equal(spawnFailure.probeMarkerPresent, false);
  assert.equal(
    JSON.stringify(spawnFailure).includes('permission denied'),
    false,
  );

  const signaled = probeFromSpawn({
    pid: 123,
    status: null,
    signal: 'SIGTERM',
    stdout: 'probe-started\n',
    stderr: '',
  });
  assert.equal(signaled.childResult, 'signaled');
  assert.equal(signaled.childSignal, 'SIGTERM');
  assert.equal(signaled.probeMarkerPresent, true);
  assert.equal(signaled.connectionOutcome, 'signaled');

  assert.equal(
    probeFromSpawn({
      pid: 123,
      status: 0,
      signal: null,
      stdout: 'probe-started\nprobe-result:connected\n',
    }).connectionOutcome,
    'connected',
  );
  const socketInitError = probeFromSpawn({
    pid: 123,
    status: 7,
    signal: null,
    stdout: 'probe-started\nprobe-result:socket-init-error\n',
  });
  assert.equal(socketInitError.probeUidMatches, true);
  assert.equal(socketInitError.connectAttempted, false);
  assert.equal(socketInitError.connectionOutcome, 'socket-init-error');
});

test('child stderr classification distinguishes script, import, syntax, version, and access failures', () => {
  const script = '/workspace/dev/element-desktop-egress-policy.mjs';
  const classify = (stderr) =>
    probeFromSpawn({ status: 1, stdout: '', stderr }, script).stderrClass;

  assert.equal(
    classify(`Error: Cannot find module '${script}'`),
    'missing-script',
  );
  assert.equal(
    classify(
      `Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'private-pkg' imported from ${script}`,
    ),
    'missing-import',
  );
  assert.equal(classify('SyntaxError: Unexpected token'), 'syntax');
  assert.equal(
    classify('This application requires a newer Node version'),
    'runtime-version',
  );
  assert.equal(classify('EACCES: permission denied'), 'permission');
  assert.equal(classify('sudo: a password is required'), 'sudo-policy');
  assert.equal(
    JSON.stringify(
      probeFromSpawn({ status: 1, stderr: script }, script),
    ).includes(script),
    false,
  );
});

test('isolated runtime facts parser accepts only fixed fields and Node 22 version evidence', () => {
  const facts = {
    uidMatches: true,
    nodeVersion: '22.23.3',
    nodeExecutableRunnable: true,
    scriptExists: true,
    scriptReadable: true,
    startupScriptReadable: true,
    configReadable: true,
    e2eManifestReadable: true,
    playwrightUsable: true,
    checkoutControlProtected: true,
  };
  const result = runtimeFactsFromSpawn(
    {
      status: 0,
      signal: null,
      stdout: `runtime-facts-started\n${JSON.stringify(facts)}\n`,
      stderr: '',
    },
    '/workspace/dev/element-desktop-egress-policy.mjs',
  );
  assert.deepEqual(result, {
    childResult: 'probe-reported',
    childExitStatus: 0,
    childSignal: null,
    spawnErrorClass: null,
    stderrClass: 'empty',
    markerPresent: true,
    uidMatches: true,
    nodeVersion: '22.23.3',
    nodeVersionSupported: true,
    nodeExecutableRunnable: true,
    scriptExists: true,
    scriptReadable: true,
    startupScriptReadable: true,
    configReadable: true,
    e2eManifestReadable: true,
    playwrightUsable: true,
    checkoutControlProtected: true,
  });

  const malformed = runtimeFactsFromSpawn(
    {
      status: 0,
      signal: null,
      stdout: `runtime-facts-started\n${JSON.stringify({ ...facts, path: '/private/path' })}\n`,
      stderr: '',
    },
    '/workspace/dev/element-desktop-egress-policy.mjs',
  );
  assert.equal(malformed.childResult, 'protocol-invalid');
  assert.equal(JSON.stringify(malformed).includes('/private/path'), false);

  const timedOut = runtimeFactsFromSpawn(
    {
      status: null,
      signal: 'SIGTERM',
      error: Object.assign(new Error(), { code: 'ETIMEDOUT' }),
      stdout: '',
      stderr: '',
    },
    '/workspace/dev/element-desktop-egress-policy.mjs',
  );
  assert.equal(timedOut.childResult, 'spawn-error');
  assert.equal(timedOut.spawnErrorClass, 'timeout');
  assert.equal(timedOut.childSignal, 'SIGTERM');
  assert.equal(timedOut.markerPresent, false);
});

test('runtime facts child emits the exact bounded protocol', (context) => {
  if (!childStdoutAvailable()) {
    context.skip('environment does not expose child stdout');
    return;
  }
  const uid = process.getuid?.();
  assert.ok(Number.isSafeInteger(uid) && uid > 0);
  const root = mkdtempSync(join(tmpdir(), 'mcw-desktop-runtime-facts-'));
  try {
    const script = join(
      root,
      'probe',
      'dev',
      'element-desktop-egress-policy.mjs',
    );
    const startupScript = join(
      root,
      'probe',
      'dev',
      'element-desktop-startup.mjs',
    );
    const configFile = join(
      root,
      'probe',
      'dev',
      'element-desktop-probe-config.json',
    );
    const packageDir = join(
      root,
      'probe',
      'node_modules',
      '@playwright',
      'test',
    );
    const e2ePackage = stagedE2ePackagePath(script);
    const e2eDir = join(root, 'probe', 'e2e');
    const controlRoot = join(root, 'checkout');
    const controlDev = join(controlRoot, 'dev');
    const controlScript = join(controlDev, 'element-desktop-egress-policy.mjs');
    mkdirSync(packageDir, { recursive: true });
    mkdirSync(e2eDir, { recursive: true });
    mkdirSync(join(root, 'probe', 'dev'), { recursive: true });
    mkdirSync(controlDev, { recursive: true });
    writeFileSync(script, 'staged probe script\n');
    writeFileSync(startupScript, 'staged startup script\n');
    writeFileSync(configFile, '{}\n');
    writeFileSync(controlScript, 'trusted control source\n');
    chmodSync(controlScript, 0o400);
    chmodSync(controlDev, 0o500);
    chmodSync(controlRoot, 0o500);
    writeFileSync(e2ePackage, '{}\n');
    writeFileSync(
      join(packageDir, 'package.json'),
      JSON.stringify({ name: '@playwright/test', main: 'index.js' }),
    );
    writeFileSync(
      join(packageDir, 'index.js'),
      'module.exports = { chromium: { connectOverCDP() {} } };\n',
    );
    const result = spawnSync(
      process.execPath,
      [
        '-e',
        RUNTIME_FACTS_SOURCE,
        String(uid),
        script,
        startupScript,
        configFile,
        e2ePackage,
        controlRoot,
        controlDev,
        controlScript,
      ],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 2_000,
        maxBuffer: 4_096,
      },
    );
    const facts = runtimeFactsFromSpawn(result, script);
    assert.equal(facts.childResult, 'probe-reported');
    assert.equal(facts.uidMatches, true);
    assert.match(facts.nodeVersion, /^\d+\.\d+\.\d+$/u);
    assert.equal(
      facts.nodeVersionSupported,
      facts.nodeVersion.startsWith('22.'),
    );
    assert.equal(facts.nodeExecutableRunnable, true);
    assert.equal(facts.scriptExists, true);
    assert.equal(facts.scriptReadable, true);
    assert.equal(facts.startupScriptReadable, true);
    assert.equal(facts.configReadable, true);
    assert.equal(facts.e2eManifestReadable, true);
    assert.equal(facts.playwrightUsable, true);
    assert.equal(facts.checkoutControlProtected, true);
    assert.equal(JSON.stringify(facts).includes(script), false);
    assert.equal(JSON.stringify(facts).includes(root), false);

    rmSync(join(root, 'probe', 'node_modules'), {
      recursive: true,
      force: true,
    });
    const missingStartup = join(root, 'missing-startup.mjs');
    const missingConfig = join(root, 'missing-config.json');
    const missingManifest = join(root, 'missing-e2e', 'package.json');
    const incompleteResult = spawnSync(
      process.execPath,
      [
        '-e',
        RUNTIME_FACTS_SOURCE,
        String(uid),
        script,
        missingStartup,
        missingConfig,
        missingManifest,
        controlRoot,
        controlDev,
        controlScript,
      ],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 2_000,
        maxBuffer: 4_096,
      },
    );
    const incomplete = runtimeFactsFromSpawn(incompleteResult, script);
    assert.equal(incomplete.childResult, 'probe-reported');
    assert.equal(incomplete.startupScriptReadable, false);
    assert.equal(incomplete.configReadable, false);
    assert.equal(incomplete.e2eManifestReadable, false);
    assert.equal(incomplete.playwrightUsable, false);
    assert.equal(incomplete.checkoutControlProtected, true);
    assert.equal(JSON.stringify(incomplete).includes(root), false);
  } finally {
    try {
      chmodSync(join(root, 'checkout', 'dev'), 0o700);
      chmodSync(join(root, 'checkout'), 0o700);
    } catch {
      // Preserve the test result if the fixture was only partially created.
    }
    rmSync(root, { recursive: true, force: true });
  }
});

test('connect probe checks its real uid before making a loopback connection', async (context) => {
  if (!childStdoutAvailable()) {
    context.skip('environment does not expose child stdout');
    return;
  }
  const expectedUid = process.getuid?.();
  if (!Number.isSafeInteger(expectedUid) || expectedUid < 1) {
    context.skip('a non-root process UID is required for the synthetic probe');
    return;
  }

  const server = createServer((socket) => socket.destroy());
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen({ host: '127.0.0.1', port: 0 }, resolve);
    });
  } catch (error) {
    if (error?.code === 'EPERM') {
      context.skip('sandbox does not permit loopback listeners');
      return;
    }
    throw error;
  }
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const script = fileURLToPath(
    new URL('./element-desktop-egress-policy.mjs', import.meta.url),
  );
  const runProbe = (uid) =>
    spawnSync(
      process.execPath,
      [script, '--connect', String(uid), '127.0.0.1', String(address.port)],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 2_000,
      },
    );

  const matching = runProbe(expectedUid);
  assert.equal(matching.signal, null);
  assert.equal(matching.status, 0);
  assert.deepEqual(probeFromSpawn(matching), {
    childResult: 'probe-reported',
    childExitStatus: 0,
    childSignal: null,
    spawnErrorClass: null,
    stderrClass: 'empty',
    probeMarkerPresent: true,
    probeUidMatches: true,
    connectAttempted: true,
    connectionOutcome: 'connected',
  });
});

test('connect probe rejects a mismatched uid before attempting a socket', (context) => {
  if (!childStdoutAvailable()) {
    context.skip('environment does not expose child stdout');
    return;
  }
  const actualUid = process.getuid?.();
  const mismatchedUid = actualUid === 65_535 ? actualUid - 1 : actualUid + 1;
  const script = fileURLToPath(
    new URL('./element-desktop-egress-policy.mjs', import.meta.url),
  );
  const mismatched = spawnSync(
    process.execPath,
    [script, '--connect', String(mismatchedUid), '127.0.0.1', '1'],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2_000,
    },
  );
  assert.equal(mismatched.signal, null);
  assert.equal(mismatched.status, 3);
  assert.deepEqual(probeFromSpawn(mismatched), {
    childResult: 'probe-reported',
    childExitStatus: 3,
    childSignal: null,
    spawnErrorClass: null,
    stderrClass: 'empty',
    probeMarkerPresent: true,
    probeUidMatches: false,
    connectAttempted: false,
    connectionOutcome: 'uid-mismatch',
  });
});
