import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import test from 'node:test';

import {
  createKeyringUnlockInput,
  createSafeStorageLogCollector,
  readKeyringControl,
  SANDBOX_REASONS,
  summarizeProcessCoverageAndSandbox,
  summarizeUidProcessObservations,
  waitForDesktopChildSpawn,
} from './element-desktop-startup.mjs';

test('missing desktop executable is reported as a finite spawn outcome', async () => {
  const child = spawn('/usr/bin/element-desktop-startup-missing-test', [], {
    stdio: 'ignore',
  });
  const result = await waitForDesktopChildSpawn(child);

  assert.deepEqual(result, {
    outcome: 'spawn-error',
    errorClass: 'missing-executable',
  });
  assert.equal(child.pid, undefined);
});

test('keyring unlock entropy is encoded as an ASCII line without embedded NULs', () => {
  const entropy = Buffer.from([
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
    21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31,
  ]);
  const input = createKeyringUnlockInput(entropy);

  assert.equal(input.toString('ascii'), `${entropy.toString('hex')}\n`);
  assert.equal(input.at(-1), 0x0a);
  assert.match(input.subarray(0, -1).toString('ascii'), /^[0-9a-f]{64}$/u);
  assert.equal(input.includes(0), false);
});

test('keyring control accepts modern plain output and legacy export output without requiring a PID', () => {
  assert.equal(
    readKeyringControl('GNOME_KEYRING_CONTROL=/tmp/private-runtime/keyring\n'),
    '/tmp/private-runtime/keyring',
  );
  assert.equal(
    readKeyringControl(
      'GNOME_KEYRING_CONTROL=/tmp/private-runtime/keyring; export GNOME_KEYRING_CONTROL;\nGNOME_KEYRING_PID=42\n',
    ),
    '/tmp/private-runtime/keyring',
  );
  assert.equal(readKeyringControl('GNOME_KEYRING_PID=42\n'), undefined);
  assert.equal(readKeyringControl('ordinary output\n'), undefined);
});

test('safe-storage collector recognizes the exact vendor marker across chunks', () => {
  const collector = createSafeStorageLogCollector();
  collector.write('stdout', 'ordinary startup output\nUsing storage mode');
  collector.write(
    'stdout',
    " 'encrypted' with backend 'gnome_libsecret'\nmore ordinary output\n",
  );

  assert.deepEqual(collector.finish(true), {
    mode: 'encrypted',
    backend: 'gnome_libsecret',
    markerCount: 1,
    complete: true,
  });
});

test('safe-storage collector rejects duplicate and degraded markers without retaining log text', () => {
  const duplicate = createSafeStorageLogCollector();
  duplicate.write(
    'stdout',
    "Using storage mode 'encrypted' with backend 'gnome_libsecret'\n",
  );
  duplicate.write(
    'stderr',
    "Using storage mode 'encrypted' with backend 'kwallet'\n",
  );
  assert.deepEqual(duplicate.finish(true), {
    mode: 'ambiguous',
    backend: 'ambiguous',
    markerCount: 2,
    complete: true,
  });

  const degraded = createSafeStorageLogCollector();
  degraded.write(
    'stdout',
    "Using storage mode 'basic_text' with backend 'gnome_libsecret'\nprivate-canary\n",
  );
  const observed = degraded.finish(true);
  assert.deepEqual(observed, {
    mode: 'basic_text',
    backend: 'gnome_libsecret',
    markerCount: 1,
    complete: true,
  });
  assert.equal(JSON.stringify(observed).includes('private-canary'), false);
});

test('safe-storage collector fails closed on incomplete process output', () => {
  const missingClose = createSafeStorageLogCollector();
  missingClose.write(
    'stdout',
    "Using storage mode 'encrypted' with backend 'gnome_libsecret'\n",
  );
  assert.equal(missingClose.finish(false).complete, false);

  const oversized = createSafeStorageLogCollector();
  oversized.write('stdout', Buffer.alloc(1_048_577));
  assert.deepEqual(oversized.finish(true), {
    mode: 'not_observed',
    backend: 'not_observed',
    markerCount: 0,
    complete: false,
  });
});

function desktopProcess(pid, args, overrides = {}) {
  return {
    pid,
    uids: [24000, 24000, 24000, 24000],
    args,
    seccomp: null,
    noNewPrivs: null,
    unreadable: false,
    ...overrides,
  };
}

function passingProcessGroup(overrides = {}) {
  return [
    desktopProcess(10, ['/usr/bin/element-desktop', '--type=browser']),
    desktopProcess(11, ['--type=renderer'], {
      seccomp: '2',
      noNewPrivs: '1',
    }),
    ...(overrides.extraProcesses ?? []),
  ];
}

test('sandbox diagnostics preserve a fixed reason for each failed coverage condition', () => {
  const cases = [
    [[], 'application_process_missing'],
    [
      [
        desktopProcess(10, [], { unreadable: true }),
        desktopProcess(11, ['--type=renderer'], {
          seccomp: '2',
          noNewPrivs: '1',
        }),
      ],
      'unreadable_process_member',
    ],
    [
      [
        desktopProcess(10, ['/usr/bin/element-desktop'], {
          uids: [24000, 25000, 24000, 24000],
        }),
        desktopProcess(11, ['--type=renderer'], {
          seccomp: '2',
          noNewPrivs: '1',
        }),
      ],
      'uid_mismatch',
    ],
    [
      [
        desktopProcess(10, ['/usr/bin/element-desktop', '--no-sandbox']),
        desktopProcess(11, ['--type=renderer'], {
          seccomp: '2',
          noNewPrivs: '1',
        }),
      ],
      'no_sandbox_flag',
    ],
    [[desktopProcess(10, ['/usr/bin/element-desktop'])], 'renderer_missing'],
    [
      [
        desktopProcess(10, ['/usr/bin/element-desktop']),
        desktopProcess(11, ['--type=renderer'], {
          seccomp: '0',
          noNewPrivs: '1',
        }),
      ],
      'seccomp_unconfirmed',
    ],
    [
      [
        desktopProcess(10, ['/usr/bin/element-desktop']),
        desktopProcess(11, ['--type=renderer'], {
          seccomp: '2',
          noNewPrivs: '0',
        }),
      ],
      'no_new_privs_unconfirmed',
    ],
  ];

  for (const [processes, reason] of cases) {
    const diagnostic = summarizeProcessCoverageAndSandbox(processes, 10, 24000);
    assert.equal(diagnostic.sandboxReason, reason);
    assert.ok(SANDBOX_REASONS.includes(diagnostic.sandboxReason));
    assert.equal(diagnostic.state, 'observed');
  }
});

test('sandbox diagnostics report aggregate security state and bounded counts without argv or PIDs', () => {
  const mixed = summarizeProcessCoverageAndSandbox(
    passingProcessGroup({
      extraProcesses: [
        desktopProcess(12, ['--type=renderer', 'private-canary'], {
          seccomp: '0',
          noNewPrivs: '1',
        }),
      ],
    }),
    10,
    24000,
  );
  assert.equal(mixed.sandboxReason, 'seccomp_unconfirmed');
  assert.equal(mixed.seccompState, 'mixed');
  assert.equal(mixed.noNewPrivsState, 'enabled');
  assert.equal(JSON.stringify(mixed).includes('private-canary'), false);
  assert.equal(JSON.stringify(mixed).includes('24000'), false);
  assert.equal(JSON.stringify(mixed).includes('11'), false);

  const unavailable = summarizeProcessCoverageAndSandbox(
    [
      desktopProcess(10, ['/usr/bin/element-desktop']),
      desktopProcess(11, ['--type=renderer'], { seccomp: null }),
    ],
    10,
    24000,
  );
  assert.equal(unavailable.seccompState, 'unavailable');
  assert.equal(unavailable.noNewPrivsState, 'unavailable');

  const capped = summarizeProcessCoverageAndSandbox(
    [
      ...Array.from({ length: 120 }, (_, index) =>
        desktopProcess(index + 1, ['--type=renderer'], {
          seccomp: '2',
          noNewPrivs: '1',
        }),
      ),
    ],
    1,
    24000,
  );
  assert.equal(capped.processGroupCount, 100);
  assert.equal(capped.rendererCount, 100);
});

test('UID cleanup summaries expose only bounded process and zombie counts', () => {
  const diagnostic = summarizeUidProcessObservations(
    [
      { uids: [24000, 24000, 24000, 24000], state: 'Z' },
      { uids: [24000, 24000, 24000, 24000], state: 'S' },
      { uids: [24000, 24000, 24000, 24000], state: null },
      { uids: [25000, 25000, 25000, 25000], state: 'Z' },
    ],
    24000,
    false,
  );
  assert.deepEqual(diagnostic, {
    state: 'partial',
    uidProcessCount: 3,
    nonZombieProcessCount: 1,
    zombieCount: 1,
    unreadableProcessCount: 1,
  });
  assert.equal(JSON.stringify(diagnostic).includes('25000'), false);
  assert.equal(JSON.stringify(diagnostic).includes('pid'), false);

  const capped = summarizeUidProcessObservations(
    Array.from({ length: 105 }, () => ({ uids: [24000], state: 'Z' })),
    24000,
  );
  assert.deepEqual(capped, {
    state: 'observed',
    uidProcessCount: 100,
    nonZombieProcessCount: 0,
    zombieCount: 100,
    unreadableProcessCount: 0,
  });
});
