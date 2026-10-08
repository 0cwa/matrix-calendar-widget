import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { emptyUidLifecycleObservation } from './element-desktop-evidence.mjs';
import {
  buildDesktopPolicyArguments,
  classifyPasswdLookupResult,
  cleanupProofAllowsPolicyRemoval,
  cleanupUser,
  createJourneyChildEnvironment,
  createSystemCommandEnvironment,
  lookupPasswdAccount,
  parseStartupProgressRecord,
  selectAvailableProbeUid,
  selectPinnedPackageHash,
  stopUidProcesses,
  validateDefaultPolicyPort,
  validateJourneyPolicyPorts,
} from './element-desktop-journey-runner.mjs';

const PACKAGE_HASH = 'a'.repeat(64);

function observedUidCensus(uidProcessCount) {
  return {
    ...emptyUidLifecycleObservation(),
    state: 'observed',
    overflow: false,
    uidProcessCount,
    nonZombieProcessCount: uidProcessCount,
    zombieCount: 0,
    unreadableProcessCount: 0,
    unattributedProcessCount: 0,
    processClassCounts: {
      application: 0,
      browser: 0,
      renderer: 0,
      zygote: 0,
      gpu: 0,
      utility: 0,
      other: uidProcessCount,
      unknown: 0,
    },
    processRoleCounts: {
      application: 0,
      chromium: 0,
      keyring: 0,
      dbus: 0,
      xvfb: 0,
      other: uidProcessCount,
      unknown: 0,
    },
  };
}

function observedEmptyLifecycle() {
  return {
    ...emptyUidLifecycleObservation('observed'),
    overflow: false,
    uidProcessCount: 0,
    nonZombieProcessCount: 0,
    zombieCount: 0,
    unreadableProcessCount: 0,
    unattributedProcessCount: 0,
    processClassCounts: {
      application: 0,
      browser: 0,
      renderer: 0,
      zygote: 0,
      gpu: 0,
      utility: 0,
      other: 0,
      unknown: 0,
    },
    processRoleCounts: {
      application: 0,
      chromium: 0,
      keyring: 0,
      dbus: 0,
      xvfb: 0,
      other: 0,
      unknown: 0,
    },
  };
}

function censusChild({ chunks = [], status = 0, signal = null, error } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  queueMicrotask(() => {
    if (error !== undefined) {
      child.emit('error', error);
      return;
    }
    for (const chunk of chunks) child.stdout.emit('data', chunk);
    child.emit('close', status, signal);
  });
  return child;
}

async function initialUidCensus(spawnCensus) {
  const result = await stopUidProcesses(
    { uid: 24_323 },
    { runCommand: () => 1, spawnCensus },
  );
  return result.diagnostics.initial.census;
}

test('default UID census uses the supplied state and keeps failed capture unavailable', async () => {
  const spawned = [];
  const result = await stopUidProcesses(
    { uid: 24_321 },
    {
      runCommand: () => 1,
      spawnCensus: (program, args, options) => {
        spawned.push([program, args, options]);
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        queueMicrotask(() => {
          child.stdout.emit(
            'data',
            Buffer.from(JSON.stringify(observedEmptyLifecycle())),
          );
          child.emit('close', 0, null);
        });
        return child;
      },
    },
  );

  assert.equal(result.status, 'passed');
  assert.equal(result.diagnostics.initial.census.state, 'observed');
  assert.equal(result.diagnostics.initial.census.uidProcessCount, 0);
  assert.equal(result.diagnostics.initial.census.outcome, 'observed');
  assert.equal(result.diagnostics.initial.census.exitStatus, 0);
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0][0], 'timeout');
  assert.equal(spawned[0][1].at(-1), '24321');

  const failedCapture = await stopUidProcesses(
    { uid: 24_322 },
    {
      runCommand: () => 1,
      spawnCensus: () => {
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        queueMicrotask(() => child.emit('close', 1, null));
        return child;
      },
    },
  );
  assert.equal(failedCapture.status, 'passed');
  assert.equal(failedCapture.diagnostics.initial.census.state, 'unavailable');
  assert.equal(failedCapture.diagnostics.initial.census.uidProcessCount, null);
  assert.equal(
    failedCapture.diagnostics.initial.census.outcome,
    'nonzero-exit',
  );
  assert.equal(failedCapture.diagnostics.initial.census.exitStatus, 1);
});

test('classifies UID census subprocess results without exposing subprocess output', async () => {
  const spawnFailure = await initialUidCensus(() => {
    throw new Error('private spawn details');
  });
  assert.equal(spawnFailure.state, 'unavailable');
  assert.equal(spawnFailure.outcome, 'spawn-error');
  assert.equal(spawnFailure.exitStatus, null);

  const childFailure = await initialUidCensus(() =>
    censusChild({ error: new Error('private child details') }),
  );
  assert.equal(childFailure.outcome, 'spawn-error');
  assert.equal(childFailure.exitStatus, null);

  const timeout = await initialUidCensus(() => censusChild({ status: 124 }));
  assert.equal(timeout.outcome, 'timeout');
  assert.equal(timeout.exitStatus, 124);

  const nonzero = await initialUidCensus(() => censusChild({ status: 7 }));
  assert.equal(nonzero.outcome, 'nonzero-exit');
  assert.equal(nonzero.exitStatus, 7);

  const signaled = await initialUidCensus(() =>
    censusChild({ status: null, signal: 'SIGTERM' }),
  );
  assert.equal(signaled.outcome, 'signal');
  assert.equal(signaled.exitStatus, null);

  const outputOverflow = await initialUidCensus(() =>
    censusChild({ chunks: [Buffer.alloc(16_385, 120)] }),
  );
  assert.equal(outputOverflow.outcome, 'overflow');
  assert.equal(outputOverflow.state, 'unavailable');
  assert.equal(outputOverflow.exitStatus, 0);

  for (const output of ['not-json', JSON.stringify({ state: 'observed' })]) {
    const malformed = await initialUidCensus(() =>
      censusChild({ chunks: [Buffer.from(output)] }),
    );
    assert.equal(malformed.outcome, 'malformed');
    assert.equal(malformed.state, 'unavailable');
    assert.equal(malformed.exitStatus, 0);
    assert.doesNotMatch(JSON.stringify(malformed), /not-json|private/u);
  }

  const observed = await initialUidCensus(() =>
    censusChild({
      chunks: [Buffer.from(JSON.stringify(observedEmptyLifecycle()))],
    }),
  );
  assert.equal(observed.outcome, 'observed');
  assert.equal(observed.state, 'observed');
  assert.equal(observed.uidProcessCount, 0);
  assert.equal(observed.exitStatus, 0);
});

test('marks the existing census collection deadline as a timeout outcome', async () => {
  const census = await stopUidProcesses(
    { uid: 24_324 },
    {
      runCommand: () => 1,
      census: () => new Promise(() => {}),
    },
  );
  assert.equal(census.diagnostics.initial.census.state, 'unavailable');
  assert.equal(census.diagnostics.initial.census.outcome, 'timeout');
  assert.equal(census.diagnostics.initial.census.exitStatus, null);
});

test('records a clear initial UID inspection without entering the signal path', async () => {
  const calls = [];
  const waits = [];
  const result = await stopUidProcesses(
    { uid: 24_000 },
    {
      runCommand: (program, args) => {
        calls.push([program, ...args]);
        return 1;
      },
      wait: async (duration) => waits.push(duration),
      census: async () => observedUidCensus(0),
    },
  );

  assert.equal(result.status, 'passed');
  assert.equal(result.diagnostics.initial.inspection, 'absent');
  assert.equal(result.diagnostics.initial.census.uidProcessCount, 0);
  assert.equal(result.diagnostics.termSignal, 'not_attempted');
  assert.equal(result.diagnostics.killSignal, 'not_attempted');
  assert.deepEqual(calls, [['pgrep', '-u', '24000']]);
  assert.deepEqual(waits, []);
});

test('keeps unavailable UID inspection distinct from an empty census', async () => {
  const calls = [];
  const result = await stopUidProcesses(
    { uid: 24_000 },
    {
      runCommand: (program, args) => {
        calls.push([program, ...args]);
        return undefined;
      },
      wait: async () => assert.fail('unavailable inspection must not wait'),
      census: async () => undefined,
    },
  );

  assert.equal(result.status, 'failed');
  assert.equal(result.diagnostics.initial.inspection, 'unavailable');
  assert.equal(result.diagnostics.initial.census.state, 'unavailable');
  assert.equal(result.diagnostics.initial.census.uidProcessCount, null);
  assert.equal(result.diagnostics.termSignal, 'not_attempted');
  assert.equal(result.diagnostics.killSignal, 'not_attempted');
  assert.deepEqual(calls, [['pgrep', '-u', '24000']]);
});

test('skips KILL when the post-TERM inspection is clear', async () => {
  const statuses = [0, 0, 1];
  const calls = [];
  const waits = [];
  const result = await stopUidProcesses(
    { uid: 24_000 },
    {
      runCommand: (program, args) => {
        calls.push([program, ...args]);
        return statuses.shift();
      },
      wait: async (duration) => waits.push(duration),
      census: async () => observedUidCensus(0),
    },
  );

  assert.equal(result.status, 'passed');
  assert.deepEqual(waits, [2_000]);
  assert.deepEqual(
    calls.map((call) => call.slice(0, 4)),
    [
      ['pgrep', '-u', '24000'],
      ['sudo', '-n', 'pkill', '-TERM'],
      ['pgrep', '-u', '24000'],
    ],
  );
  assert.equal(result.diagnostics.postTerm.inspection, 'absent');
  assert.equal(result.diagnostics.killSignal, 'not_attempted');
  assert.equal(result.diagnostics.postKill.inspection, 'not_attempted');
});

test('uses the existing conditional KILL branch and bounded waits', async () => {
  const statuses = [0, 0, 0, 0, 1];
  const calls = [];
  const waits = [];
  const censuses = [];
  const result = await stopUidProcesses(
    { uid: 24_000 },
    {
      runCommand: (program, args) => {
        calls.push([program, ...args]);
        return statuses.shift();
      },
      wait: async (duration) => waits.push(duration),
      census: async (_state, checkpoint) => {
        censuses.push(checkpoint);
        return observedUidCensus(checkpoint === 'post-kill' ? 0 : 1);
      },
    },
  );

  assert.equal(result.status, 'passed');
  assert.deepEqual(waits, [2_000, 1_000]);
  assert.deepEqual(censuses, ['initial', 'post-term', 'post-kill']);
  assert.deepEqual(
    calls.map((call) => call.slice(0, 4)),
    [
      ['pgrep', '-u', '24000'],
      ['sudo', '-n', 'pkill', '-TERM'],
      ['pgrep', '-u', '24000'],
      ['sudo', '-n', 'pkill', '-KILL'],
      ['pgrep', '-u', '24000'],
    ],
  );
  assert.equal(result.diagnostics.termSignal, 'sent');
  assert.equal(result.diagnostics.postTerm.inspection, 'present');
  assert.equal(result.diagnostics.killSignal, 'sent');
  assert.equal(result.diagnostics.postKill.inspection, 'absent');
});

test('accepts only bounded Desktop startup progress records', () => {
  assert.deepEqual(
    parseStartupProgressRecord(
      '{"phase":"desktop-startup-progress","milestone":"before-app"}',
    ),
    { phase: 'desktop-startup-progress', milestone: 'before-app' },
  );
  assert.deepEqual(
    parseStartupProgressRecord(
      JSON.stringify({
        phase: 'desktop-startup-progress',
        milestone: 'after-page-load',
        appPid: 12,
        cdpRendererHandoff: {
          overflow: false,
          pids: [13],
          rendererCount: 1,
          state: 'observed',
        },
      }),
    ),
    {
      phase: 'desktop-startup-progress',
      milestone: 'after-page-load',
      appPid: 12,
      cdpRendererHandoff: {
        overflow: false,
        pids: [13],
        rendererCount: 1,
        state: 'observed',
      },
    },
  );

  for (const line of [
    '{"phase":"desktop-startup-progress","milestone":"before-app","url":"vector://private"}',
    '{"phase":"desktop-startup-progress","milestone":"desktop-journey-ready","pid":12}',
    JSON.stringify({
      phase: 'desktop-startup-progress',
      milestone: 'after-app-spawn',
      appPid: 1,
    }),
    JSON.stringify({
      phase: 'desktop-startup-progress',
      milestone: 'after-page-load',
      appPid: 12,
      cdpRendererHandoff: {
        overflow: false,
        pids: [12, 12],
        rendererCount: 2,
        state: 'observed',
      },
    }),
    'x'.repeat(8_193),
  ]) {
    assert.equal(parseStartupProgressRecord(line), undefined);
  }
});

test('keeps the journey CDP port distinct from every fixed loopback service', () => {
  assert.equal(validateJourneyPolicyPorts(42_424), true);
  for (const port of [8_008, 3_000, 8_080, 1_023, 65_536, 42_424.5]) {
    assert.equal(validateJourneyPolicyPorts(port), false);
  }
});

test('preserves default and journey egress profile command grammars', () => {
  const common = {
    uid: 24_001,
    runId: '12345',
    cdpPort: 42_424,
  };
  const startupState = { ...common, journey: false };
  const journeyState = { ...common, journey: true };

  assert.deepEqual(buildDesktopPolicyArguments(startupState, 'install'), [
    'install',
    '24001',
    '12345',
    '42424',
  ]);
  assert.deepEqual(
    buildDesktopPolicyArguments(startupState, 'negative-self-test', [
      '/tmp/private/policy.mjs',
    ]),
    [
      'negative-self-test',
      '24001',
      '12345',
      '42424',
      '/tmp/private/policy.mjs',
    ],
  );
  assert.deepEqual(buildDesktopPolicyArguments(startupState, 'zero-counters'), [
    'zero-counters',
    '24001',
    '12345',
    '42424',
  ]);
  assert.deepEqual(buildDesktopPolicyArguments(startupState, 'counters'), [
    'counters',
    '24001',
    '12345',
    '42424',
  ]);
  assert.deepEqual(buildDesktopPolicyArguments(startupState, 'remove'), [
    'remove',
    '24001',
    '12345',
  ]);

  for (const command of [
    'install',
    'negative-self-test',
    'zero-counters',
    'counters',
  ]) {
    const argumentsForJourney = buildDesktopPolicyArguments(
      journeyState,
      command,
      command === 'negative-self-test' ? ['/tmp/private/policy.mjs'] : [],
    );
    assert.equal(argumentsForJourney.at(-1), '--journey');
  }
  assert.deepEqual(buildDesktopPolicyArguments(journeyState, 'remove'), [
    'remove',
    '24001',
    '12345',
  ]);
});

test('keeps the default CDP port distinct from the Matrix fixture', () => {
  assert.equal(validateDefaultPolicyPort(42_424), true);
  for (const port of [8_008, 1_023, 65_536, 42_424.5]) {
    assert.equal(validateDefaultPolicyPort(port), false);
  }
});

test('removes the probe account only after authoritative passwd lookups', () => {
  const notFound = classifyPasswdLookupResult(
    { status: 2, signal: null, stdout: '' },
    'mcwdesktopprobe',
  );
  assert.deepEqual(notFound, { state: 'absent' });
  assert.deepEqual(
    classifyPasswdLookupResult(
      { status: 0, signal: null, stdout: 'malformed passwd record\n' },
      'mcwdesktopprobe',
    ),
    { state: 'unavailable' },
  );

  const state = {
    username: 'mcwdesktopprobe',
    uid: 24_001,
    userMayBeCreated: true,
  };
  let lookupCount = 0;
  const injectedGetent = (program, args) => {
    assert.equal(program, 'getent');
    assert.deepEqual(args, ['-s', 'files', 'passwd', 'mcwdesktopprobe']);
    lookupCount += 1;
    if (lookupCount === 1) {
      return {
        error: Object.assign(new Error('injected timeout'), {
          code: 'ETIMEDOUT',
        }),
        signal: 'SIGTERM',
        status: null,
        stdout: '',
      };
    }
    return { status: 2, signal: null, stdout: '' };
  };
  const cleanup = cleanupUser(state, true, injectedGetent);
  assert.equal(lookupCount, 2);
  assert.deepEqual(cleanup, {
    status: 'failed',
    userdelStatus: 'not_run',
    userdelExitStatus: null,
    accountState: 'absent',
  });

  const requiredEvidence = {
    processStatus: 'passed',
    beforeUserdelClear: true,
    finalUidClear: true,
  };
  assert.equal(
    cleanupProofAllowsPolicyRemoval({ ...requiredEvidence, user: cleanup }),
    false,
  );
  assert.equal(
    cleanupProofAllowsPolicyRemoval({
      ...requiredEvidence,
      user: {
        status: 'passed',
        accountState: 'absent',
      },
    }),
    true,
  );

  const confirmedAbsent = lookupPasswdAccount('mcwdesktopprobe', () => ({
    status: 2,
    signal: null,
    stdout: '',
  }));
  assert.deepEqual(confirmedAbsent, { state: 'absent' });
});

test('selects the first unused UID from one bounded account snapshot', () => {
  assert.equal(
    selectAvailableProbeUid('root:x:0:0:root:/root:/bin/bash\n'),
    24_000,
  );
  assert.equal(
    selectAvailableProbeUid(
      'runner:x:24000:0:runner:/home/runner:/bin/bash\nother:x:24002:0::/:/usr/sbin/nologin\n',
    ),
    24_001,
  );
  assert.equal(selectAvailableProbeUid('', '24000\n24002\n'), 24_001);
  assert.equal(selectAvailableProbeUid(''), 24_000);
});

test('passes only fixed Desktop journey paths and excludes fixture secrets', () => {
  const environment = createJourneyChildEnvironment(
    {
      HOME: '/home/runner',
      PATH: '/usr/local/bin:/usr/bin:/bin',
      MATRIX_APPLICATION_SERVICE_TOKEN: 'private-service-token',
      MATRIX_CALENDAR_DEV_PASSWORD: 'private-homeserver-password',
      PLAYWRIGHT_BROWSERS_PATH: '/home/runner/.cache/ms-playwright',
    },
    {
      runnerTemp: '/tmp/runner',
      workspace: '/home/runner/work/repo/repo',
      journeyStageFile: '/tmp/runner/journey.jsonl',
      playwrightOutput: '/tmp/runner/playwright-output',
      usersFile: '/tmp/runner/users.json',
      credentialsFile: '/tmp/runner/desktop-credentials.json',
    },
    { sourceSha: 'b'.repeat(40), cdpPort: 42_424 },
  );

  assert.deepEqual(Object.keys(environment).sort(), [
    'CI',
    'ELEMENT_ACCEPTANCE_DESKTOP_CREDENTIALS_FILE',
    'ELEMENT_ACCEPTANCE_USERS_FILE',
    'ELEMENT_DESKTOP_CDP_PORT',
    'ELEMENT_DESKTOP_JOURNEY_PLAYWRIGHT_OUTPUT',
    'ELEMENT_DESKTOP_JOURNEY_STAGE_FILE',
    'ELEMENT_DESKTOP_SOURCE_SHA',
    'GITHUB_WORKSPACE',
    'HOME',
    'PATH',
    'PLAYWRIGHT_BROWSERS_PATH',
    'RUNNER_TEMP',
    'TMPDIR',
  ]);
  assert.equal(
    JSON.stringify(environment).includes('private-service-token'),
    false,
  );
  assert.equal(
    JSON.stringify(environment).includes('private-homeserver-password'),
    false,
  );
  assert.equal(environment.ELEMENT_DESKTOP_CDP_PORT, '42424');
  assert.equal(environment.TMPDIR, '/tmp/runner');
});

test('keeps fixture credentials out of native command environments', () => {
  const environment = createSystemCommandEnvironment({
    HOME: '/home/runner',
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    PATH: '/usr/local/bin:/usr/bin:/bin',
    RUNNER_TEMP: '/tmp/runner',
    MATRIX_APPLICATION_SERVICE_TOKEN: 'private-service-token',
    MATRIX_CALENDAR_DEV_PASSWORD: 'private-homeserver-password',
    ELEMENT_ACCEPTANCE_DESKTOP_CREDENTIALS_FILE: '/tmp/runner/credentials.json',
  });

  assert.deepEqual(environment, {
    HOME: '/home/runner',
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    PATH: '/usr/local/bin:/usr/bin:/bin',
    TMPDIR: '/tmp/runner',
  });
});

test('selects exactly one pinned amd64 Element Desktop package hash', () => {
  const block = [
    'Package: element-desktop',
    'Version: 1.12.30',
    'Architecture: amd64',
    `SHA256: ${PACKAGE_HASH}`,
  ].join('\n');
  assert.equal(selectPinnedPackageHash(block), PACKAGE_HASH);
  assert.throws(
    () => selectPinnedPackageHash(`${block}\n\n${block}`),
    /Element Desktop journey runner failed/u,
  );
  assert.throws(
    () =>
      selectPinnedPackageHash(
        block.replace('Version: 1.12.30', 'Version: 1.12.31'),
      ),
    /Element Desktop journey runner failed/u,
  );
  assert.throws(
    () => selectPinnedPackageHash(block.replace(PACKAGE_HASH, 'invalid')),
    /Element Desktop journey runner failed/u,
  );
  assert.throws(
    () => selectPinnedPackageHash(`${block}\nSHA256: ${PACKAGE_HASH}`),
    /Element Desktop journey runner failed/u,
  );
});
