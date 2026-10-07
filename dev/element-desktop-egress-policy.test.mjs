import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  negativeProbePassed,
  policySpec,
  probeFromSpawn,
} from './element-desktop-egress-policy.mjs';

function passingFamily() {
  return {
    listenerBound: true,
    probeSpawned: true,
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
    probeSpawned: true,
    probeUidMatches: true,
    connectAttempted: true,
    connectionOutcome: 'timeout',
  });
  assert.equal(
    probeFromSpawn({
      pid: 123,
      status: 3,
      signal: null,
      stdout: 'probe-started\nprobe-uid-mismatch\n',
    }).connectionOutcome,
    'uid-mismatch',
  );
  assert.equal(
    probeFromSpawn({
      pid: undefined,
      status: null,
      error: new Error(),
      stdout: '',
    }).connectionOutcome,
    'spawn-error',
  );
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
    probeSpawned: true,
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
    probeSpawned: true,
    probeUidMatches: false,
    connectAttempted: false,
    connectionOutcome: 'uid-mismatch',
  });
});
