import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  constants as fsConstants,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  classifyUidSocketProcess,
  createKeyringUnlockInput,
  createSafeStorageLogCollector,
  matchesProbeConfigProjection,
  parseCdpRendererHandoff,
  parseProcCommandLine,
  parseProcStartTimeTicks,
  readCappedDirectoryEntries,
  readCleanupOriginObservation,
  readKeyringControl,
  SANDBOX_REASONS,
  scanCleanupOriginProcesses,
  selectUidLifecycleProcessEntries,
  summarizeCdpRendererProcessInfo,
  summarizeProcessCoverageAndSandbox,
  summarizeUidLifecycleObservation,
  summarizeUidProcessObservations,
  summarizeUidTcpSocketObservation,
  summarizeUidTcpSocketTables,
  waitForDesktopChildSpawn,
  waitForDesktopJourneyCompletion,
  writeDesktopJourneyCompletionMarker,
  writeDesktopJourneyReadyMarker,
} from './element-desktop-startup.mjs';

async function withPrivateProfile(run) {
  const profileRoot = mkdtempSync(join(tmpdir(), 'mcw-desktop-startup-test-'));
  chmodSync(profileRoot, 0o700);
  try {
    await run(profileRoot, process.getuid());
  } finally {
    rmSync(profileRoot, { recursive: true, force: true });
  }
}

async function withCleanupOriginProfile(run) {
  const profileRoot = mkdtempSync('/tmp/mcw-element-desktop-41-2-');
  chmodSync(profileRoot, 0o700);
  const uid = process.getuid();
  writeFileSync(
    join(profileRoot, '.owned'),
    'element-desktop-startup-profile-v1\n',
    {
      flag: 'wx',
      mode: 0o600,
    },
  );
  writeFileSync(join(profileRoot, 'process-group'), '101 1001\n', {
    flag: 'wx',
    mode: 0o600,
  });
  try {
    await run(profileRoot, uid);
  } finally {
    rmSync(profileRoot, { recursive: true, force: true });
  }
}

function cleanupOriginProcess(
  pid,
  parentPid,
  processGroupId,
  startTimeTicks,
  uid,
  executableName,
  state = 'S',
) {
  return {
    pid,
    parentPid,
    processGroupId,
    state,
    startTimeTicks,
    uids: [uid, uid, uid, uid],
    uidMember: false,
    boundIdentity: false,
    ancestorOnly: false,
    executableName,
  };
}

function cleanupOriginSnapshot(uid) {
  const otherUid = uid === 2 ? 3 : 2;
  const processes = [
    cleanupOriginProcess(1, 0, 1, '10', otherUid, 'systemd'),
    cleanupOriginProcess(80, 1, 80, '800', otherUid, 'node'),
    cleanupOriginProcess(90, 1, 90, '900', otherUid, 'timeout'),
    cleanupOriginProcess(101, 80, 101, '1001', uid, 'element-desktop'),
    cleanupOriginProcess(102, 101, 101, '1002', uid, 'chrome'),
    cleanupOriginProcess(103, 90, 90, '1003', uid, 'dbus-daemon'),
    cleanupOriginProcess(104, 90, 104, '1004', uid, 'gnome-keyring-daemon'),
    cleanupOriginProcess(105, 1, 105, '1005', uid, 'other-helper'),
    cleanupOriginProcess(106, 1, 106, '1006', uid, 'xvfb'),
  ];
  return new Map(
    processes.map((item) => [
      item.pid,
      {
        ...item,
        uidMember: item.uids.includes(uid),
        boundIdentity: [90, 101].includes(item.pid),
      },
    ]),
  );
}

function cloneCleanupOriginSnapshot(processes) {
  return new Map(
    [...processes].map(([pid, item]) => [
      pid,
      { ...item, uids: [...item.uids] },
    ]),
  );
}

function cleanupOriginRequest(profileRoot, uid, overrides = {}) {
  return {
    uid,
    runId: '41',
    runAttempt: '2',
    profileRoot,
    appPid: 101,
    appStartTimeTicks: '1001',
    controllerPid: 90,
    controllerStartTimeTicks: '900',
    ...overrides,
  };
}

function fakeProcStatus(uids, { minimumBytes = 0 } = {}) {
  const header = `Name:\tsynthetic\nUid:\t${uids.join('\t')}\n`;
  return `${header}${'x'.repeat(Math.max(0, minimumBytes - header.length))}`;
}

function fakeProcStat(
  pid,
  parentPid,
  processGroupId,
  startTimeTicks,
  { minimumBytes = 0, name = 'synthetic', raw } = {},
) {
  if (raw !== undefined) return raw;
  const fields = Array.from({ length: 20 }, () => '0');
  fields[0] = 'S';
  fields[1] = String(parentPid);
  fields[2] = String(processGroupId);
  fields[19] = String(startTimeTicks);
  const text = `${pid} (${name}) ${fields.join(' ')}`;
  return `${text}${' '.repeat(Math.max(0, minimumBytes - text.length))}`;
}

function fakeCleanupOriginProcess(
  pid,
  parentPid,
  processGroupId,
  startTimeTicks,
  uids,
  executableName,
  { statusBytes = 0, statBytes = 0, statText } = {},
) {
  return {
    status: fakeProcStatus(uids, { minimumBytes: statusBytes }),
    stat:
      statText ??
      fakeProcStat(pid, parentPid, processGroupId, startTimeTicks, {
        minimumBytes: statBytes,
      }),
    executablePath: `/usr/bin/${executableName}`,
  };
}

function fakeCleanupOriginProcIo(
  snapshots,
  { now = () => 0, readlink = (_path, target) => target } = {},
) {
  const versions = Array.isArray(snapshots) ? snapshots : [snapshots];
  let activeSnapshot = new Map();
  let snapshotIndex = 0;
  let nextDescriptor = 1;
  const descriptors = new Map();
  const openedPaths = [];
  const openCalls = [];
  const readCalls = [];
  const readlinkPaths = [];
  const io = {
    opendirSync(path) {
      assert.equal(path, '/proc');
      activeSnapshot = versions[Math.min(snapshotIndex, versions.length - 1)];
      snapshotIndex += 1;
      const names = [...activeSnapshot.keys()].map(String);
      let entryIndex = 0;
      return {
        readSync() {
          return entryIndex < names.length
            ? { name: names[entryIndex++] }
            : null;
        },
        closeSync() {},
      };
    },
    openSync(path, flags) {
      const match = /^\/proc\/([0-9]+)\/(status|stat)$/u.exec(path);
      if (!match) throw new Error('Unexpected proc file');
      const process = activeSnapshot.get(Number(match[1]));
      const content = process?.[match[2]];
      if (typeof content !== 'string') throw new Error('Missing proc file');
      const descriptor = nextDescriptor++;
      descriptors.set(descriptor, {
        path,
        content: Buffer.from(content),
        offset: 0,
      });
      openedPaths.push(path);
      openCalls.push({ path, flags });
      return descriptor;
    },
    readSync(descriptor, buffer, offset, length) {
      const file = descriptors.get(descriptor);
      if (!file) throw new Error('Unknown proc descriptor');
      const count = Math.min(length, file.content.length - file.offset);
      if (count > 0) {
        file.content.copy(buffer, offset, file.offset, file.offset + count);
        file.offset += count;
      }
      readCalls.push({
        path: file.path,
        requestedBytes: length,
        readBytes: count,
      });
      return count;
    },
    closeSync(descriptor) {
      descriptors.delete(descriptor);
    },
    readlinkSync(path) {
      readlinkPaths.push(path);
      const match = /^\/proc\/([0-9]+)\/exe$/u.exec(path);
      if (!match) throw new Error('Unexpected executable link');
      const executablePath = activeSnapshot.get(
        Number(match[1]),
      )?.executablePath;
      if (typeof executablePath !== 'string') {
        throw new Error('Missing executable link');
      }
      return readlink(path, executablePath);
    },
    now: () => now(snapshotIndex),
  };
  return {
    io,
    openedPaths,
    openCalls,
    readCalls,
    readlinkPaths,
    snapshotCount: () => snapshotIndex,
  };
}

test('process start ticks are parsed after the command field, including parentheses', () => {
  const fields = Array.from({ length: 20 }, () => '0');
  fields[0] = 'S';
  fields[1] = '1';
  fields[2] = '42';
  fields[19] = '987654';
  const stat = `42 (synthetic ) command) ${fields.join(' ')}`;

  assert.equal(parseProcStartTimeTicks(42, stat), '987654');
  assert.equal(parseProcStartTimeTicks(42, '42 (short) S 1 2'), null);
});

test('cleanup-origin probe attributes only bounded fixed counts from stable identities', async () => {
  await withCleanupOriginProfile(async (profileRoot, uid) => {
    const processes = cleanupOriginSnapshot(uid);
    const observation = readCleanupOriginObservation(
      cleanupOriginRequest(profileRoot, uid),
      () => ({
        state: 'observed',
        processes: cloneCleanupOriginSnapshot(processes),
      }),
    );

    assert.deepEqual(observation, {
      state: 'observed',
      reason: 'attributed',
      overflow: false,
      processCount: 6,
      attributionCounts: {
        appgroup: 2,
        controllergroup: 1,
        descendant: 1,
        unlinked: 2,
        unknown: 0,
      },
      processRoleCounts: {
        application: 1,
        chromium: 1,
        keyring: 1,
        dbus: 1,
        xvfb: 1,
        other: 1,
        unknown: 0,
      },
    });
    assert.doesNotMatch(
      JSON.stringify(observation),
      /(?:\/proc|\/tmp|appPid|controllerPid|argv|commandline|101|1001|900)/iu,
    );
  });
});

test('production cleanup-origin reader keeps only UID members, bindings, and ancestry links', async () => {
  await withCleanupOriginProfile(async (profileRoot, uid) => {
    const otherUid = uid === 2 ? 3 : 2;
    const processes = new Map([
      [
        1,
        fakeCleanupOriginProcess(
          1,
          0,
          1,
          '10',
          [otherUid, otherUid, otherUid, otherUid],
          'systemd',
        ),
      ],
      [
        80,
        fakeCleanupOriginProcess(
          80,
          1,
          80,
          '800',
          [otherUid, otherUid, otherUid, otherUid],
          'node',
        ),
      ],
      [
        90,
        fakeCleanupOriginProcess(
          90,
          1,
          90,
          '900',
          [otherUid, otherUid, otherUid, otherUid],
          'timeout',
        ),
      ],
      [
        101,
        fakeCleanupOriginProcess(
          101,
          80,
          101,
          '1001',
          [uid, uid, uid, uid],
          'element-desktop',
          { statusBytes: 65_536, statBytes: 65_536 },
        ),
      ],
      [
        102,
        fakeCleanupOriginProcess(
          102,
          101,
          101,
          '1002',
          [uid, uid, uid, uid],
          'chrome',
        ),
      ],
      [
        200,
        fakeCleanupOriginProcess(
          200,
          1,
          200,
          '2000',
          [otherUid, otherUid, otherUid, otherUid],
          'private-unrelated-command',
          { statusBytes: 65_536 },
        ),
      ],
    ]);
    const fakeIo = fakeCleanupOriginProcIo(processes);
    const snapshots = [];
    const observation = readCleanupOriginObservation(
      cleanupOriginRequest(profileRoot, uid),
      (scanUid, identityPids, budget) => {
        const result = scanCleanupOriginProcesses(
          scanUid,
          identityPids,
          budget,
        );
        snapshots.push(result);
        return result;
      },
      fakeIo.io,
    );

    assert.equal(observation.state, 'observed');
    assert.equal(observation.processCount, 2);
    assert.equal(observation.attributionCounts.appgroup, 2);
    assert.equal(observation.processRoleCounts.application, 1);
    assert.equal(observation.processRoleCounts.chromium, 1);
    assert.deepEqual(
      [...snapshots[0].processes.keys()].sort((left, right) => left - right),
      [80, 90, 101, 102],
    );
    const parent = snapshots[0].processes.get(80);
    assert.deepEqual(Object.keys(parent).sort(), [
      'ancestorOnly',
      'boundIdentity',
      'parentPid',
      'pid',
      'startTimeTicks',
      'uidMember',
    ]);
    assert.equal(parent.ancestorOnly, true);
    assert.equal(parent.uids, undefined);
    assert.equal(snapshots[0].processes.has(200), false);
    assert.equal(
      fakeIo.openedPaths.some((path) => path === '/proc/200/stat'),
      false,
    );
    assert.equal(fakeIo.readlinkPaths.includes('/proc/200/exe'), false);
    assert.equal(fakeIo.openedPaths.includes('/proc/1/stat'), false);
    assert.equal(fakeIo.openedPaths.includes('/proc/80/status'), true);
    assert.equal(fakeIo.readlinkPaths.includes('/proc/80/exe'), false);
    assert.ok(fakeIo.readCalls.every((call) => call.requestedBytes <= 1_024));
    assert.equal(
      fakeIo.readCalls
        .filter((call) => call.path === '/proc/200/status')
        .reduce((sum, call) => sum + call.readBytes, 0),
      2_048,
    );
    assert.equal(
      fakeIo.readCalls
        .filter((call) => call.path === '/proc/101/stat')
        .reduce((sum, call) => sum + call.readBytes, 0),
      2_048,
    );
    assert.ok(
      fakeIo.openCalls.every(
        ({ flags }) => (flags & (fsConstants.O_NOFOLLOW ?? 0)) !== 0,
      ),
    );
    assert.doesNotMatch(
      JSON.stringify(observation),
      /200|private-unrelated-command/u,
    );
  });
});

test('cleanup-origin production reader shares its deadline across both snapshots', async () => {
  await withCleanupOriginProfile(async (profileRoot, uid) => {
    const otherUid = uid === 2 ? 3 : 2;
    const processes = new Map([
      [
        1,
        fakeCleanupOriginProcess(
          1,
          0,
          1,
          '10',
          [otherUid, otherUid, otherUid, otherUid],
          'systemd',
        ),
      ],
      [
        90,
        fakeCleanupOriginProcess(
          90,
          1,
          90,
          '900',
          [otherUid, otherUid, otherUid, otherUid],
          'timeout',
        ),
      ],
      [
        101,
        fakeCleanupOriginProcess(
          101,
          1,
          101,
          '1001',
          [uid, uid, uid, uid],
          'element-desktop',
        ),
      ],
    ]);
    const fakeIo = fakeCleanupOriginProcIo(processes, {
      now: (snapshotCount) => (snapshotCount >= 2 ? 5_000 : 0),
    });

    const observation = readCleanupOriginObservation(
      cleanupOriginRequest(profileRoot, uid),
      scanCleanupOriginProcesses,
      fakeIo.io,
    );

    assert.equal(fakeIo.snapshotCount(), 2);
    assert.equal(observation.state, 'unknown');
    assert.equal(observation.reason, 'process_scan_overflow');
    assert.equal(observation.processCount, null);
    assert.doesNotMatch(JSON.stringify(observation), /(?:101|1001|900)/u);
  });
});

test('cleanup-origin production reader fails closed on unreadable or overlong executable links', async () => {
  await withCleanupOriginProfile(async (profileRoot, uid) => {
    const otherUid = uid === 2 ? 3 : 2;
    const processes = new Map([
      [
        1,
        fakeCleanupOriginProcess(
          1,
          0,
          1,
          '10',
          [otherUid, otherUid, otherUid, otherUid],
          'systemd',
        ),
      ],
      [
        90,
        fakeCleanupOriginProcess(
          90,
          1,
          90,
          '900',
          [otherUid, otherUid, otherUid, otherUid],
          'timeout',
        ),
      ],
      [
        101,
        fakeCleanupOriginProcess(
          101,
          1,
          101,
          '1001',
          [uid, uid, uid, uid],
          'element-desktop',
        ),
      ],
    ]);
    const cases = [
      {
        name: 'unreadable executable link',
        readlink: () => {
          throw new Error('permission denied');
        },
        reason: 'process_snapshot_incomplete',
      },
      {
        name: 'overlong executable link',
        readlink: () => `${'x'.repeat(4_096)}/chrome`,
        reason: 'process_scan_overflow',
      },
    ];

    for (const testCase of cases) {
      const fakeIo = fakeCleanupOriginProcIo(processes, {
        readlink: testCase.readlink,
      });
      const observation = readCleanupOriginObservation(
        cleanupOriginRequest(profileRoot, uid),
        scanCleanupOriginProcesses,
        fakeIo.io,
      );

      assert.equal(observation.state, 'unknown', testCase.name);
      assert.equal(observation.reason, testCase.reason, testCase.name);
      assert.doesNotMatch(
        JSON.stringify(observation),
        /(?:101|1001|900|xxxx)/u,
      );
    }
  });
});

test('cleanup-origin production reader fails closed when status or stat reads fail', async () => {
  await withCleanupOriginProfile(async (profileRoot, uid) => {
    const otherUid = uid === 2 ? 3 : 2;
    const makeProcesses = () =>
      new Map([
        [
          1,
          fakeCleanupOriginProcess(
            1,
            0,
            1,
            '10',
            [otherUid, otherUid, otherUid, otherUid],
            'systemd',
          ),
        ],
        [
          90,
          fakeCleanupOriginProcess(
            90,
            1,
            90,
            '900',
            [otherUid, otherUid, otherUid, otherUid],
            'timeout',
          ),
        ],
        [
          101,
          fakeCleanupOriginProcess(
            101,
            1,
            101,
            '1001',
            [uid, uid, uid, uid],
            'element-desktop',
          ),
        ],
      ]);
    const cases = [
      {
        name: 'status read',
        pid: 1,
        field: 'status',
      },
      {
        name: 'stat read',
        pid: 101,
        field: 'stat',
      },
    ];

    for (const testCase of cases) {
      const processes = makeProcesses();
      processes.set(testCase.pid, {
        ...processes.get(testCase.pid),
        [testCase.field]: undefined,
      });
      const fakeIo = fakeCleanupOriginProcIo(processes);
      const observation = readCleanupOriginObservation(
        cleanupOriginRequest(profileRoot, uid),
        scanCleanupOriginProcesses,
        fakeIo.io,
      );

      assert.equal(observation.state, 'unknown', testCase.name);
      assert.equal(
        observation.reason,
        'process_snapshot_incomplete',
        testCase.name,
      );
      assert.equal(observation.processCount, null, testCase.name);
    }
  });
});

test('cleanup-origin production reader applies one byte budget to both snapshots and executable links', async () => {
  await withCleanupOriginProfile(async (profileRoot, uid) => {
    const otherUid = uid === 2 ? 3 : 2;
    const processes = new Map([
      [
        1,
        fakeCleanupOriginProcess(
          1,
          0,
          1,
          '10',
          [otherUid, otherUid, otherUid, otherUid],
          'systemd',
        ),
      ],
      [
        90,
        fakeCleanupOriginProcess(
          90,
          1,
          90,
          '900',
          [otherUid, otherUid, otherUid, otherUid],
          'timeout',
        ),
      ],
    ]);
    const executableTarget = `${'x'.repeat(4_080)}/chrome`;
    for (let pid = 101; pid < 3_101; pid += 1) {
      processes.set(
        pid,
        fakeCleanupOriginProcess(
          pid,
          1,
          101,
          pid === 101 ? '1001' : String(pid + 10_000),
          [uid, uid, uid, uid],
          'chrome',
          { statusBytes: 1_024, statBytes: 1_024 },
        ),
      );
    }
    const fakeIo = fakeCleanupOriginProcIo(processes, {
      readlink: () => executableTarget,
    });

    const observation = readCleanupOriginObservation(
      cleanupOriginRequest(profileRoot, uid),
      scanCleanupOriginProcesses,
      fakeIo.io,
    );

    assert.equal(observation.state, 'unknown');
    assert.equal(observation.reason, 'process_scan_overflow');
    assert.equal(observation.processCount, null);
    assert.ok(fakeIo.readlinkPaths.length < 2 * 3_001);
    assert.doesNotMatch(JSON.stringify(observation), /(?:101|1001|900|xxxx)/u);
  });
});

test('cleanup-origin probe fails closed for unbound roots, unreadable scans, overflow, and marker symlinks', async () => {
  await withCleanupOriginProfile(async (profileRoot, uid) => {
    const processes = cleanupOriginSnapshot(uid);
    const stableScan = () => ({
      state: 'observed',
      processes: cloneCleanupOriginSnapshot(processes),
    });
    const noController = readCleanupOriginObservation(
      cleanupOriginRequest(profileRoot, uid, {
        controllerPid: null,
        controllerStartTimeTicks: null,
      }),
      stableScan,
    );
    assert.equal(noController.state, 'partial');
    assert.equal(noController.reason, 'controller_identity_unavailable');
    assert.equal(noController.attributionCounts.unlinked, 0);
    assert.ok(noController.attributionCounts.unknown > 0);

    const unreadable = readCleanupOriginObservation(
      cleanupOriginRequest(profileRoot, uid),
      () => ({ state: 'incomplete' }),
    );
    assert.equal(unreadable.state, 'unknown');
    assert.equal(unreadable.reason, 'process_snapshot_incomplete');
    assert.equal(unreadable.processCount, null);

    const overflow = readCleanupOriginObservation(
      cleanupOriginRequest(profileRoot, uid),
      () => ({ state: 'overflow' }),
    );
    assert.equal(overflow.state, 'unknown');
    assert.equal(overflow.reason, 'process_scan_overflow');
    assert.equal(overflow.attributionCounts.appgroup, null);

    const markerPath = join(profileRoot, 'process-group');
    rmSync(markerPath);
    const markerTarget = join(profileRoot, 'marker-target');
    writeFileSync(markerTarget, '101 1001\n', { mode: 0o600 });
    symlinkSync(markerTarget, markerPath);
    const symlinkMarker = readCleanupOriginObservation(
      cleanupOriginRequest(profileRoot, uid),
      stableScan,
    );
    assert.equal(symlinkMarker.state, 'unknown');
    assert.equal(symlinkMarker.reason, 'marker_unavailable');
  });
});

test('cleanup-origin probe rejects reused group IDs when start-time bindings differ', async () => {
  await withCleanupOriginProfile(async (profileRoot, uid) => {
    const processes = cleanupOriginSnapshot(uid);
    const appReused = cloneCleanupOriginSnapshot(processes);
    appReused.set(101, {
      ...appReused.get(101),
      startTimeTicks: '9001',
    });
    const appResult = readCleanupOriginObservation(
      cleanupOriginRequest(profileRoot, uid),
      () => ({
        state: 'observed',
        processes: cloneCleanupOriginSnapshot(appReused),
      }),
    );
    assert.equal(appResult.state, 'partial');
    assert.equal(appResult.reason, 'app_identity_unavailable');
    assert.equal(appResult.attributionCounts.appgroup, 0);
    assert.equal(appResult.attributionCounts.unlinked, 0);

    const controllerReused = cloneCleanupOriginSnapshot(processes);
    controllerReused.set(90, {
      ...controllerReused.get(90),
      startTimeTicks: '9001',
    });
    const controllerResult = readCleanupOriginObservation(
      cleanupOriginRequest(profileRoot, uid),
      () => ({
        state: 'observed',
        processes: cloneCleanupOriginSnapshot(controllerReused),
      }),
    );
    assert.equal(controllerResult.state, 'partial');
    assert.equal(controllerResult.reason, 'controller_identity_unavailable');
    assert.equal(controllerResult.attributionCounts.controllergroup, 0);
    assert.equal(controllerResult.attributionCounts.unlinked, 0);

    const appUidTupleMismatch = cloneCleanupOriginSnapshot(processes);
    appUidTupleMismatch.set(101, {
      ...appUidTupleMismatch.get(101),
      uids: [uid, uid + 1, uid, uid],
      uidMember: true,
    });
    const appUidResult = readCleanupOriginObservation(
      cleanupOriginRequest(profileRoot, uid),
      () => ({
        state: 'observed',
        processes: cloneCleanupOriginSnapshot(appUidTupleMismatch),
      }),
    );
    assert.equal(appUidResult.state, 'partial');
    assert.equal(appUidResult.reason, 'app_identity_unavailable');
    assert.equal(appUidResult.attributionCounts.appgroup, 0);
    assert.equal(appUidResult.attributionCounts.unlinked, 0);

    const nonTimeoutController = cloneCleanupOriginSnapshot(processes);
    nonTimeoutController.set(90, {
      ...nonTimeoutController.get(90),
      executableName: 'other-controller',
    });
    const controllerExecutableResult = readCleanupOriginObservation(
      cleanupOriginRequest(profileRoot, uid),
      () => ({
        state: 'observed',
        processes: cloneCleanupOriginSnapshot(nonTimeoutController),
      }),
    );
    assert.equal(controllerExecutableResult.state, 'partial');
    assert.equal(
      controllerExecutableResult.reason,
      'controller_identity_unavailable',
    );
    assert.equal(
      controllerExecutableResult.attributionCounts.controllergroup,
      0,
    );
    assert.equal(controllerExecutableResult.attributionCounts.unlinked, 0);

    const mismatchedMarker = readCleanupOriginObservation(
      cleanupOriginRequest(profileRoot, uid, {
        appStartTimeTicks: '1002',
      }),
      () => ({
        state: 'observed',
        processes: cloneCleanupOriginSnapshot(processes),
      }),
    );
    assert.equal(mismatchedMarker.state, 'unknown');
    assert.equal(mismatchedMarker.reason, 'marker_unavailable');
  });
});

test('cleanup-origin production reader rejects parent-link changes across snapshots', async () => {
  await withCleanupOriginProfile(async (profileRoot, uid) => {
    const first = cleanupOriginSnapshot(uid);
    const second = cloneCleanupOriginSnapshot(first);
    second.set(102, { ...second.get(102), parentPid: 80 });
    let scanCount = 0;

    const observation = readCleanupOriginObservation(
      cleanupOriginRequest(profileRoot, uid),
      () => {
        const processes = scanCount === 0 ? first : second;
        scanCount += 1;
        return {
          state: 'observed',
          processes: cloneCleanupOriginSnapshot(processes),
        };
      },
    );

    assert.equal(observation.state, 'unknown');
    assert.equal(observation.reason, 'process_snapshot_changed');
    assert.equal(observation.processCount, null);
  });
});

test('cleanup-origin count overflow remains capped and partial', async () => {
  await withCleanupOriginProfile(async (profileRoot, uid) => {
    const processes = cleanupOriginSnapshot(uid);
    for (let pid = 200; pid < 301; pid += 1) {
      processes.set(pid, {
        ...cleanupOriginProcess(
          pid,
          1,
          pid,
          String(pid + 10_000),
          uid,
          'helper',
        ),
        uidMember: true,
      });
    }
    const observation = readCleanupOriginObservation(
      cleanupOriginRequest(profileRoot, uid),
      () => ({
        state: 'observed',
        processes: cloneCleanupOriginSnapshot(processes),
      }),
    );

    assert.equal(observation.state, 'partial');
    assert.equal(observation.reason, 'count_capped');
    assert.equal(observation.overflow, true);
    assert.equal(observation.processCount, 100);
    assert.equal(observation.attributionCounts.unlinked, 100);
    assert.equal(observation.processRoleCounts.other, 100);
  });
});

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

test('Desktop journey hold accepts only a private fixed completion marker', async () => {
  await withPrivateProfile(async (profileRoot, expectedUid) => {
    const completionPath = join(profileRoot, '.desktop-journey-complete');
    assert.equal(
      writeDesktopJourneyReadyMarker(profileRoot, expectedUid),
      true,
    );
    setTimeout(() => {
      assert.equal(
        writeDesktopJourneyCompletionMarker(profileRoot, expectedUid),
        true,
      );
    }, 10);
    assert.equal(
      await waitForDesktopJourneyCompletion({
        profileRoot,
        expectedUid,
        timeoutMs: 1_000,
      }),
      true,
    );
    assert.equal(
      writeDesktopJourneyCompletionMarker(profileRoot, expectedUid),
      false,
    );
  });
});

test('Desktop journey hold fails closed on malformed, insecure, and late markers', async () => {
  await withPrivateProfile(async (profileRoot, expectedUid) => {
    const readyPath = join(profileRoot, '.desktop-journey-ready');
    const completionPath = join(profileRoot, '.desktop-journey-complete');
    assert.equal(
      writeDesktopJourneyReadyMarker(profileRoot, expectedUid),
      true,
    );
    writeFileSync(completionPath, 'wrong marker\n', {
      flag: 'wx',
      mode: 0o600,
    });
    assert.equal(
      await waitForDesktopJourneyCompletion({
        profileRoot,
        expectedUid,
        timeoutMs: 100,
      }),
      false,
    );

    rmSync(completionPath);
    writeFileSync(
      completionPath,
      'matrix-calendar-desktop-journey-complete-v1\n',
      {
        flag: 'wx',
        mode: 0o600,
      },
    );
    chmodSync(completionPath, 0o644);
    assert.equal(
      await waitForDesktopJourneyCompletion({
        profileRoot,
        expectedUid,
        timeoutMs: 100,
      }),
      false,
    );

    rmSync(completionPath);
    assert.equal(
      await waitForDesktopJourneyCompletion({
        profileRoot,
        expectedUid,
        timeoutMs: 10,
      }),
      false,
    );
    setTimeout(() => {
      writeFileSync(
        completionPath,
        'matrix-calendar-desktop-journey-complete-v1\n',
        { flag: 'wx', mode: 0o600 },
      );
    }, 25);
    assert.equal(
      await waitForDesktopJourneyCompletion({
        profileRoot,
        expectedUid,
        timeoutMs: 10,
      }),
      false,
    );
    await new Promise((resolveWait) => setTimeout(resolveWait, 30));
    assert.equal(existsSync(completionPath), true);
    rmSync(completionPath);
    rmSync(readyPath);
  });
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

test('in-memory config projection recognizes only the fixed local fixture settings', () => {
  const config = {
    default_server_config: {
      'm.homeserver': {
        base_url: 'http://127.0.0.1:8008',
        server_name: 'localhost',
      },
    },
    update_base_url: null,
    disable_custom_urls: true,
    enable_client_well_known_lookups: false,
    disable_analytics: true,
    integrations_ui_url: '',
    integrations_rest_url: '',
    integrations_widgets_urls: [],
    bug_report_endpoint_url: '',
    jitsi: {},
    map_style_url: '',
  };

  assert.equal(matchesProbeConfigProjection(config), true);
  assert.equal(
    matchesProbeConfigProjection({
      ...config,
      default_server_config: {
        'm.homeserver': {
          ...config.default_server_config['m.homeserver'],
          base_url: 'https://example.invalid',
        },
      },
    }),
    false,
  );
  assert.equal(
    matchesProbeConfigProjection({
      ...config,
      integrations_widgets_urls: ['https://example.invalid/widget'],
    }),
    false,
  );
  assert.equal(matchesProbeConfigProjection(null), false);
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
  assert.deepEqual(
    selectUidLifecycleProcessEntries(['10', '11', '12'], 99, 3, [101, 102]),
    { entries: ['102', '101', '99'], overflow: true },
  );
});

test('CDP renderer handoff is bounded, private, and reports unknown process lists', () => {
  const processInfo = [
    { type: 'browser', id: 4 },
    ...Array.from({ length: 65 }, (_, index) => ({
      type: 'renderer',
      id: 100 + index,
    })),
  ];
  const summary = summarizeCdpRendererProcessInfo(processInfo);
  assert.equal(summary.state, 'partial');
  assert.equal(summary.overflow, true);
  assert.equal(summary.rendererCount, 64);
  assert.equal(summary.pids.length, 64);
  assert.equal(JSON.stringify(summary).includes('type'), false);

  const unavailable = parseCdpRendererHandoff('{"state":"observed"}');
  assert.deepEqual(unavailable, {
    state: 'unavailable',
    overflow: null,
    rendererCount: null,
    pids: null,
  });
  assert.deepEqual(parseCdpRendererHandoff('x'.repeat(2_049)), unavailable);
});

test('CDP renderer ownership compares live UID, app ancestry, process group, argv, and security', () => {
  const handoff = {
    state: 'observed',
    overflow: false,
    rendererCount: 2,
    pids: [502, 503],
  };
  const observation = summarizeUidLifecycleObservation(
    [
      lifecycleProcess(500, 1, 500, ['/usr/bin/element-desktop']),
      lifecycleProcess(501, 500, 500, ['--type=zygote']),
      lifecycleProcess(502, 501, 500, ['--type=renderer'], {
        seccomp: '2',
        noNewPrivs: '1',
      }),
      lifecycleProcess(503, 1, 503, ['--type=renderer', '--no-sandbox']),
    ],
    24_000,
    500,
    true,
    false,
    handoff,
  );
  assert.deepEqual(observation.cdpRendererObservation, {
    state: 'observed',
    overflow: false,
    rendererCount: 2,
    missingCount: 0,
    unreadableCount: 0,
    uidMatchCount: 2,
    uidMismatchCount: 0,
    appIdentityState: 'verified',
    appDescendantCount: 1,
    appDescendantUnobservedCount: 0,
    appProcessGroupCount: 1,
    appProcessGroupUnobservedCount: 0,
    appDescendantAndProcessGroupCount: 1,
    argvRendererMatchCount: 2,
    noSandboxFlagCount: 1,
    seccompState: 'unavailable',
    noNewPrivsState: 'unavailable',
  });
  assert.equal(JSON.stringify(observation).includes('502'), false);
  assert.equal(JSON.stringify(observation).includes('24000'), false);
});

test('CDP renderer with an empty command line remains unreadable', () => {
  const observation = summarizeUidLifecycleObservation(
    [
      lifecycleProcess(500, 1, 500, ['/usr/bin/element-desktop']),
      lifecycleProcess(502, 500, 500, [], {
        seccomp: '2',
        noNewPrivs: '1',
      }),
    ],
    24_000,
    500,
    true,
    false,
    {
      state: 'observed',
      overflow: false,
      rendererCount: 1,
      pids: [502],
    },
  );

  assert.equal(observation.cdpRendererObservation.state, 'partial');
  assert.equal(observation.cdpRendererObservation.unreadableCount, 1);
  assert.equal(observation.cdpRendererObservation.seccompState, 'unavailable');
  assert.doesNotMatch(JSON.stringify(observation), /502|24000/u);
});

test('capped directory iteration reads only through the first excess match and closes', () => {
  const names = ['metadata', '10', '11', '12', '13'];
  let readCalls = 0;
  let closed = false;
  const directory = {
    readSync() {
      const name = names[readCalls];
      readCalls += 1;
      return name === undefined ? null : { name };
    },
    closeSync() {
      closed = true;
    },
  };

  const result = readCappedDirectoryEntries(directory, 2, (entry) =>
    /^[0-9]+$/u.test(entry.name),
  );

  assert.deepEqual(
    result.entries.map((entry) => entry.name),
    ['10', '11'],
  );
  assert.equal(result.overflow, true);
  assert.equal(readCalls, 4);
  assert.equal(closed, true);
});

test('capped directory iteration closes its handle when reading fails', () => {
  let closed = false;
  const directory = {
    readSync() {
      throw new Error('directory read failed');
    },
    closeSync() {
      closed = true;
    },
  };

  assert.throws(() => readCappedDirectoryEntries(directory, 2));
  assert.equal(closed, true);
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
  assert.deepEqual(observation.processRoleCounts, {
    application: 1,
    chromium: 4,
    keyring: 0,
    dbus: 0,
    xvfb: 0,
    other: 0,
    unknown: 0,
  });
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
  assert.deepEqual(cleanup.processRoleCounts, {
    application: 0,
    chromium: 1,
    keyring: 0,
    dbus: 0,
    xvfb: 0,
    other: 1,
    unknown: 0,
  });
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
  assert.equal(overflow.processRoleCounts.chromium, 100);
});

test('UID lifecycle separates effective matches from other UID-slot matches', () => {
  const observed = summarizeUidLifecycleObservation(
    [
      lifecycleProcess(30, 1, 30, ['private-effective-command']),
      lifecycleProcess(31, 1, 31, ['private-non-effective-command'], {
        uids: [24_000, 35_000, 24_000, 24_000],
      }),
      lifecycleProcess(32, 1, 32, ['private-unmatched-command'], {
        uids: [35_000, 35_000, 35_000, 35_000],
      }),
    ],
    24_000,
  );

  assert.equal(observed.state, 'observed');
  assert.equal(observed.uidProcessCount, 2);
  assert.equal(observed.effectiveUidMatchCount, 1);
  assert.equal(observed.nonEffectiveUidOnlyCount, 1);
  assert.doesNotMatch(JSON.stringify(observed), /private|24000|35000/u);

  const capped = summarizeUidLifecycleObservation(
    [
      ...Array.from({ length: 101 }, (_, index) =>
        lifecycleProcess(100 + index, 1, 100 + index, ['--type=renderer']),
      ),
      ...Array.from({ length: 101 }, (_, index) =>
        lifecycleProcess(300 + index, 1, 300 + index, ['--type=renderer'], {
          uids: [24_000, 35_000, 24_000, 24_000],
        }),
      ),
    ],
    24_000,
  );
  assert.equal(capped.state, 'partial');
  assert.equal(capped.overflow, true);
  assert.equal(capped.uidProcessCount, 100);
  assert.equal(capped.effectiveUidMatchCount, 100);
  assert.equal(capped.nonEffectiveUidOnlyCount, 100);
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
