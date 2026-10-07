import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  negativeProbePassed,
  policySpec,
  probeFromSpawn,
  RUNTIME_FACTS_SOURCE,
  runtimeFactsFromSpawn,
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
  assert.deepEqual(ipv4.chainRules, [
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
    ['-j', 'DROP'],
  ]);
  assert.deepEqual(ipv6.chainRules, [
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
      '::1/128',
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
    ['-j', 'DROP'],
  ]);
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
  const script = fileURLToPath(
    new URL('./element-desktop-egress-policy.mjs', import.meta.url),
  );
  const result = spawnSync(
    process.execPath,
    ['-e', RUNTIME_FACTS_SOURCE, String(uid), script],
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
  assert.equal(facts.nodeVersionSupported, facts.nodeVersion.startsWith('22.'));
  assert.equal(facts.nodeExecutableRunnable, true);
  assert.equal(facts.scriptExists, true);
  assert.equal(facts.scriptReadable, true);
  assert.equal(JSON.stringify(facts).includes(script), false);
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
