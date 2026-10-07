import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import test from 'node:test';

import {
  classifyUidSocketProcess,
  createKeyringUnlockInput,
  createSafeStorageLogCollector,
  parseProcCommandLine,
  readKeyringControl,
  SANDBOX_REASONS,
  selectUidLifecycleProcessEntries,
  summarizeProcessCoverageAndSandbox,
  summarizeUidLifecycleObservation,
  summarizeUidProcessObservations,
  summarizeUidTcpSocketObservation,
  summarizeUidTcpSocketTables,
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

function lifecycleProcess(
  pid,
  parentPid,
  processGroupId,
  args,
  overrides = {},
) {
  return {
    pid,
    parentPid,
    processGroupId,
    state: 'S',
    uids: [24_000, 24_000, 24_000, 24_000],
    args,
    seccomp: '2',
    noNewPrivs: '1',
    unreadable: false,
    ...overrides,
  };
}

test('UID lifecycle process cap marks app PID substitution and overflow honestly', () => {
  assert.deepEqual(selectUidLifecycleProcessEntries(['10', '11'], 99, 3), {
    entries: ['10', '11', '99'],
    overflow: false,
  });
  assert.deepEqual(
    selectUidLifecycleProcessEntries(['10', '11', '12'], 99, 3),
    { entries: ['10', '11', '99'], overflow: true },
  );
  assert.deepEqual(
    selectUidLifecycleProcessEntries(['10', '11', '12', '13'], 99, 3),
    { entries: ['10', '11', '99'], overflow: true },
  );
  assert.deepEqual(
    selectUidLifecycleProcessEntries(['10', '11', '99'], 99, 3),
    { entries: ['10', '11', '99'], overflow: false },
  );
});

test('UID lifecycle diagnostics compare app ancestry with process-group coverage', () => {
  const observation = summarizeUidLifecycleObservation(
    [
      lifecycleProcess(98_765, 1, 98_765, ['/usr/bin/element-desktop']),
      lifecycleProcess(98_766, 98_765, 98_765, ['--type=zygote']),
      lifecycleProcess(98_767, 98_766, 99_000, [
        '--type=renderer',
        'private-canary',
      ]),
      lifecycleProcess(98_768, 2, 98_765, ['--type=renderer']),
      lifecycleProcess(98_769, 1, 98_769, ['--type=renderer']),
      lifecycleProcess(98_770, 98_766, 98_765, ['--type=renderer'], {
        uids: [25_000, 25_000, 25_000, 25_000],
      }),
    ],
    24_000,
    98_765,
  );

  assert.equal(observation.state, 'observed');
  assert.equal(observation.rendererOwnership.appIdentityState, 'verified');
  assert.equal(observation.uidProcessCount, 5);
  assert.equal(observation.processClassCounts.application, 1);
  assert.equal(observation.processClassCounts.zygote, 1);
  assert.equal(observation.processClassCounts.renderer, 3);
  assert.deepEqual(
    {
      total: observation.rendererOwnership.rendererCount,
      appDescendant: observation.rendererOwnership.appDescendantCount,
      appProcessGroup: observation.rendererOwnership.appProcessGroupCount,
      both: observation.rendererOwnership.appDescendantAndProcessGroupCount,
      descendantOnly: observation.rendererOwnership.appDescendantOnlyCount,
      processGroupOnly: observation.rendererOwnership.appProcessGroupOnlyCount,
      noCurrentLink: observation.rendererOwnership.noCurrentLinkCount,
      otherUidAppDescendant:
        observation.rendererOwnership.otherUidAppDescendantCount,
    },
    {
      total: 3,
      appDescendant: 1,
      appProcessGroup: 1,
      both: 0,
      descendantOnly: 1,
      processGroupOnly: 1,
      noCurrentLink: 1,
      otherUidAppDescendant: 1,
    },
  );
  assert.equal(observation.seccompState, 'enabled');
  assert.equal(observation.noNewPrivsState, 'enabled');
  assert.equal(JSON.stringify(observation).includes('private-canary'), false);
  assert.equal(JSON.stringify(observation).includes('98765'), false);
  assert.equal(JSON.stringify(observation).includes('24000'), false);
});

test('UID lifecycle cleanup keeps process ownership unobserved and retains capped class counts', () => {
  const cleanup = summarizeUidLifecycleObservation(
    [
      lifecycleProcess(20, 1, 20, ['private-command']),
      lifecycleProcess(21, 1, 21, ['--type=renderer'], { state: 'Z' }),
    ],
    24_000,
  );
  assert.equal(cleanup.state, 'observed');
  assert.equal(cleanup.uidProcessCount, 2);
  assert.equal(cleanup.nonZombieProcessCount, 1);
  assert.equal(cleanup.zombieCount, 1);
  assert.equal(cleanup.rendererOwnership.state, 'not_observed');
  assert.equal(cleanup.rendererOwnership.rendererCount, null);
  assert.equal(cleanup.seccompState, 'not_observed');
  assert.equal(cleanup.processClassCounts.renderer, 1);
  assert.equal(JSON.stringify(cleanup).includes('private-command'), false);

  const partial = summarizeUidLifecycleObservation(
    [
      lifecycleProcess(22, 1, 22, ['/usr/bin/element-desktop']),
      lifecycleProcess(23, 22, 22, null, {
        uids: null,
        unreadable: true,
      }),
      lifecycleProcess(24, 2, 24, null, {
        uids: null,
        unreadable: true,
      }),
    ],
    24_000,
    22,
  );
  assert.equal(partial.state, 'partial');
  assert.equal(partial.uidProcessCount, 1);
  assert.equal(partial.unreadableProcessCount, 0);
  assert.equal(partial.unattributedProcessCount, 1);
  assert.equal(partial.processClassCounts.application, 1);
  assert.equal(partial.processClassCounts.unknown, 0);
  assert.equal(partial.overflow, false);

  const cleanupPartial = summarizeUidLifecycleObservation(
    [{ pid: 25, state: 'S', uids: null, unreadable: true }],
    24_000,
    null,
    false,
  );
  assert.equal(cleanupPartial.state, 'partial');
  assert.equal(cleanupPartial.unattributedProcessCount, 0);

  const overflow = summarizeUidLifecycleObservation(
    Array.from({ length: 105 }, (_, index) =>
      lifecycleProcess(index + 100, 1, index + 100, ['--type=renderer']),
    ),
    24_000,
  );
  assert.equal(overflow.state, 'partial');
  assert.equal(overflow.overflow, true);
  assert.equal(overflow.uidProcessCount, 100);
  assert.equal(overflow.processClassCounts.renderer, 100);
});

function procTcpRow(index, uid, local, remote, state, inode) {
  return `${index}: ${local} ${remote} ${state} 00000000:00000000 00:00000000 00000000 ${uid} 0 ${inode}`;
}

test('TCP socket observer groups safe peer and state categories by process role', () => {
  const owners = new Map([
    ['1001', new Map([[11, 'renderer']])],
    ['1002', new Map([[12, 'browser']])],
    ['1003', new Map([[13, 'application']])],
    [
      '2001',
      new Map([
        [14, 'renderer'],
        [15, 'browser'],
      ]),
    ],
  ]);
  const ipv4Text = [
    '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode',
    procTcpRow(0, 24_000, '0100007F:C350', '0100007F:1F48', '01', '1001'),
    procTcpRow(1, 24_000, '0100007F:C351', '4438B85D:01BB', '02', '1002'),
    procTcpRow(2, 24_000, '0100007F:A5B8', '00000000:0000', '0A', '1003'),
    procTcpRow(3, 25_000, '0100007F:C352', '0100007F:1F48', '01', '2001'),
  ].join('\n');
  const result = summarizeUidTcpSocketTables(
    owners,
    [{ family: 4, text: ipv4Text }],
    24_000,
    42_424,
  );

  assert.equal(result.state, 'observed');
  assert.equal(result.tcpSocketCount, 3);
  assert.deepEqual(result.buckets, [
    {
      processRole: 'application',
      peerCategory: 'cdp_loopback_listener',
      tcpState: 'listening',
      count: 1,
    },
    {
      processRole: 'browser',
      peerCategory: 'non_loopback_web',
      tcpState: 'syn_sent',
      count: 1,
    },
    {
      processRole: 'renderer',
      peerCategory: 'matrix_loopback',
      tcpState: 'established',
      count: 1,
    },
  ]);
  assert.equal(JSON.stringify(result).includes('192'), false);
  assert.equal(JSON.stringify(result).includes('4438B85D'), false);
  assert.equal(JSON.stringify(result).includes('1001'), false);
  assert.equal(JSON.stringify(result).includes('42424'), false);
  assert.equal(result.coverage, 'process_owned_tcp_only');
  assert.equal(result.packetAttribution, 'not_observed');
});

test('TCP observer recognizes Linux procfs IPv6 loopback endpoints', () => {
  const owners = new Map([['6001', new Map([[61, 'renderer']])]]);
  const loopback = '00000000000000000000000001000000';
  const result = summarizeUidTcpSocketTables(
    owners,
    [
      {
        family: 6,
        text: [
          'header',
          procTcpRow(
            0,
            24_000,
            `${loopback}:C350`,
            `${loopback}:1F48`,
            '01',
            '6001',
          ),
        ].join('\n'),
      },
    ],
    24_000,
    42_424,
  );

  assert.deepEqual(result.buckets, [
    {
      processRole: 'renderer',
      peerCategory: 'matrix_loopback',
      tcpState: 'established',
      count: 1,
    },
  ]);
});

test('TCP socket process roles require all four target UID credentials', () => {
  const renderer = {
    pid: 56_700,
    uids: [24_000, 24_000, 24_000, 24_000],
    args: ['--type=renderer'],
  };
  assert.equal(classifyUidSocketProcess(renderer, 24_000), 'renderer');
  assert.equal(
    classifyUidSocketProcess(
      { ...renderer, uids: [24_000, 24_001, 24_000, 24_000] },
      24_000,
    ),
    null,
  );
  assert.equal(
    classifyUidSocketProcess({ ...renderer, args: null }, 24_000),
    'unknown',
  );
  assert.equal(
    classifyUidSocketProcess(renderer, 24_000, 56_700, true),
    'application',
  );
  assert.equal(
    classifyUidSocketProcess(renderer, 24_000, 56_700, false),
    'unknown',
  );
});

test('TCP socket observer marks malformed, unknown, duplicate, and unavailable observations truthfully', () => {
  const owners = new Map([['3001', new Map([[31, 'renderer']])]]);
  const malformed = summarizeUidTcpSocketTables(
    owners,
    [{ family: 4, text: 'header\nnot-a-proc-row' }],
    24_000,
    42_424,
  );
  assert.equal(malformed.state, 'partial');
  assert.equal(malformed.tcpSocketCount, 0);
  assert.equal(malformed.overflow, false);

  const unknown = summarizeUidTcpSocketTables(
    owners,
    [
      {
        family: 4,
        text: [
          'header',
          procTcpRow(0, 24_000, '0100007F:C350', '0100007F:1F48', 'FF', '3001'),
        ].join('\n'),
      },
    ],
    24_000,
    42_424,
  );
  assert.equal(unknown.state, 'partial');
  assert.deepEqual(unknown.buckets, [
    {
      processRole: 'renderer',
      peerCategory: 'matrix_loopback',
      tcpState: 'unknown',
      count: 1,
    },
  ]);

  const duplicate = summarizeUidTcpSocketObservation(
    owners,
    [
      {
        inode: '3001',
        uid: 24_000,
        state: 'established',
        local: { family: 4, port: 50_000, loopback: true, unspecified: false },
        remote: { family: 4, port: 8_008, loopback: true, unspecified: false },
      },
      {
        inode: '3001',
        uid: 24_000,
        state: 'established',
        local: { family: 4, port: 50_000, loopback: true, unspecified: false },
        remote: { family: 4, port: 8_008, loopback: true, unspecified: false },
      },
    ],
    24_000,
    true,
    false,
    42_424,
  );
  assert.equal(duplicate.state, 'partial');
  assert.equal(duplicate.tcpSocketCount, 1);

  const unavailable = summarizeUidTcpSocketTables(owners, [], 24_000, 42_424);
  assert.equal(unavailable.state, 'unavailable');
  assert.equal(unavailable.tcpSocketCount, null);
  assert.equal(unavailable.buckets, null);
});

test('TCP socket counts cap at one hundred and set overflow without exposing identifiers', () => {
  const owners = new Map(
    Array.from({ length: 105 }, (_, index) => [
      String(4_000 + index),
      new Map([[index + 50, 'renderer']]),
    ]),
  );
  const text = [
    'header',
    ...Array.from({ length: 105 }, (_, index) =>
      procTcpRow(
        index,
        24_000,
        `0100007F:${(50_000 + index).toString(16).toUpperCase()}`,
        '0100007F:1F48',
        '01',
        String(4_000 + index),
      ),
    ),
  ].join('\n');
  const result = summarizeUidTcpSocketTables(
    owners,
    [{ family: 4, text }],
    24_000,
    42_424,
  );
  assert.equal(result.state, 'partial');
  assert.equal(result.overflow, true);
  assert.equal(result.tcpSocketCount, 100);
  assert.equal(result.buckets[0].count, 100);
  assert.equal(JSON.stringify(result).includes('4000'), false);
  assert.equal(JSON.stringify(result).includes('24000'), false);
});

test('TCP observer classifies same-role sockets shared by multiple processes as shared', () => {
  const owners = new Map([
    [
      '5001',
      new Map([
        [51, 'renderer'],
        [52, 'renderer'],
      ]),
    ],
  ]);
  const result = summarizeUidTcpSocketTables(
    owners,
    [
      {
        family: 4,
        text: [
          'header',
          procTcpRow(0, 24_000, '0100007F:C350', '0100007F:1F48', '01', '5001'),
        ].join('\n'),
      },
    ],
    24_000,
    42_424,
  );

  assert.deepEqual(result.buckets, [
    {
      processRole: 'shared',
      peerCategory: 'matrix_loopback',
      tcpState: 'established',
      count: 1,
    },
  ]);
  assert.equal(JSON.stringify(result).includes('51'), false);
  assert.equal(JSON.stringify(result).includes('52'), false);
});

test('truncated proc command lines remain explicitly incomplete', () => {
  const complete = parseProcCommandLine(
    Buffer.from('--type=renderer\0private-canary\0'),
  );
  assert.deepEqual(complete, {
    args: ['--type=renderer', 'private-canary'],
    complete: true,
  });

  const truncated = parseProcCommandLine(
    Buffer.concat([
      Buffer.from('--type=renderer\0private-canary\0'),
      Buffer.alloc(4_097, 0x78),
    ]),
  );
  const observation = summarizeUidLifecycleObservation(
    [
      lifecycleProcess(60, 1, 60, ['/usr/bin/element-desktop']),
      lifecycleProcess(61, 60, 60, truncated.args, {
        unreadable: !truncated.complete,
      }),
    ],
    24_000,
    60,
  );

  assert.equal(truncated.complete, false);
  assert.equal(observation.state, 'partial');
  assert.equal(observation.unreadableProcessCount, 1);
  assert.equal(observation.rendererOwnership.rendererCount, 1);
  assert.equal(JSON.stringify(observation).includes('private-canary'), false);
});
