import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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
  retryLateEffectiveUidStop,
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
    effectiveUidMatchCount: uidProcessCount,
    nonEffectiveUidOnlyCount: 0,
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
    effectiveUidMatchCount: 0,
    nonEffectiveUidOnlyCount: 0,
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

function censusChild({
  chunks = [],
  stderrChunks = [],
  status = 0,
  signal = null,
  error,
} = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  queueMicrotask(() => {
    if (error !== undefined) {
      child.emit('error', error);
      return;
    }
    for (const chunk of chunks) child.stdout.emit('data', chunk);
    for (const chunk of stderrChunks) child.stderr.emit('data', chunk);
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
        child.stderr = new EventEmitter();
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
  assert.equal(result.diagnostics.initial.census.effectiveUidMatchCount, 0);
  assert.equal(result.diagnostics.initial.census.nonEffectiveUidOnlyCount, 0);
  assert.equal(result.diagnostics.initial.census.outcome, 'observed');
  assert.equal(result.diagnostics.initial.census.stderrOutcome, 'absent');
  assert.equal(result.diagnostics.initial.census.stderrEmitter, 'other');
  assert.equal(result.diagnostics.initial.census.stderrLineShape, 'empty');
  assert.deepEqual(result.diagnostics.initial.census.stderrPrefixCounts, {
    timeoutTimerWarning: 0,
    timeoutForkFailure: 0,
    timeoutWaitFailure: 0,
    timeoutOther: 0,
    sudo: 0,
    nodeRuntime: 0,
    other: 0,
  });
  assert.equal(result.diagnostics.initial.census.stderrPrefixOverflow, false);
  assert.equal(result.diagnostics.initial.census.exitStatus, 0);
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0][0], 'timeout');
  assert.equal(spawned[0][1].at(-1), '24321');
  assert.equal(spawned[0][2].env.LC_ALL, 'C');

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

test('uses a GNU timeout grace interval accepted by the census argv', async () => {
  let captured;
  await stopUidProcesses(
    { uid: 24_323 },
    {
      runCommand: () => 1,
      spawnCensus: (program, args, options) => {
        captured = { program, args, options };
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
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

  assert.ok(captured);
  assert.equal(captured.program, 'timeout');
  const timeoutArguments = captured.args.slice(0, 3);
  assert.deepEqual(timeoutArguments, [
    '--signal=TERM',
    '--kill-after=0.25s',
    '1s',
  ]);
  const result = spawnSync(
    captured.program,
    [...timeoutArguments, process.execPath, '-e', 'process.exit(0)'],
    { env: captured.options.env, encoding: 'utf8' },
  );
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
  assert.equal(result.signal, null);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
});

test('classifies UID census subprocess results without exposing subprocess output', async () => {
  const spawnFailure = await initialUidCensus(() => {
    throw new Error('private spawn details');
  });
  assert.equal(spawnFailure.state, 'unavailable');
  assert.equal(spawnFailure.outcome, 'spawn-error');
  assert.equal(spawnFailure.exitStatus, null);
  assert.equal(spawnFailure.stderrOutcome, 'unavailable');

  const childFailure = await initialUidCensus(() =>
    censusChild({ error: new Error('private child details') }),
  );
  assert.equal(childFailure.outcome, 'spawn-error');
  assert.equal(childFailure.exitStatus, null);
  assert.equal(childFailure.stderrOutcome, 'unavailable');
  assert.equal(childFailure.stderrEmitter, 'unavailable');
  assert.equal(childFailure.stderrLineShape, 'unavailable');

  const missingStderrStream = await initialUidCensus(() => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    queueMicrotask(() => child.emit('close', 1, null));
    return child;
  });
  assert.equal(missingStderrStream.stderrOutcome, 'unavailable');
  assert.equal(missingStderrStream.stderrEmitter, 'unavailable');
  assert.equal(missingStderrStream.stderrLineShape, 'unavailable');

  const timeout = await initialUidCensus(() => censusChild({ status: 124 }));
  assert.equal(timeout.outcome, 'timeout');
  assert.equal(timeout.exitStatus, 124);

  const nonzero = await initialUidCensus(() => censusChild({ status: 7 }));
  assert.equal(nonzero.outcome, 'nonzero-exit');
  assert.equal(nonzero.exitStatus, 7);
  assert.equal(nonzero.stderrOutcome, 'absent');
  assert.equal(nonzero.stderrEmitter, 'other');
  assert.equal(nonzero.stderrLineShape, 'empty');

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

  const timeoutSignalText =
    "timeout: sending signal TERM to command 'sudo': Operation not permitted\n";
  const timeoutSignalOutput = await initialUidCensus(() =>
    censusChild({ status: 125, stderrChunks: [timeoutSignalText] }),
  );
  assert.equal(timeoutSignalOutput.stderrOutcome, 'other');
  assert.equal(timeoutSignalOutput.stderrEmitter, 'timeout');
  assert.equal(timeoutSignalOutput.stderrLineShape, 'single');
  assert.equal(timeoutSignalOutput.stderrPrefixCounts.timeoutOther, 1);
  assert.doesNotMatch(
    JSON.stringify(timeoutSignalOutput),
    /Operation not permitted|timeout:|sudo: /u,
  );

  const timeoutForkFailure = await initialUidCensus(() =>
    censusChild({
      status: 125,
      stderrChunks: [
        'timeout: fork system call failed: Resource unavailable\n',
      ],
    }),
  );
  assert.equal(timeoutForkFailure.stderrOutcome, 'timeout-fork-failure');
  assert.equal(timeoutForkFailure.stderrEmitter, 'timeout');
  assert.equal(timeoutForkFailure.stderrLineShape, 'single');
  assert.deepEqual(timeoutForkFailure.stderrPrefixCounts, {
    timeoutTimerWarning: 0,
    timeoutForkFailure: 1,
    timeoutWaitFailure: 0,
    timeoutOther: 0,
    sudo: 0,
    nodeRuntime: 0,
    other: 0,
  });
  assert.equal(timeoutForkFailure.stderrPrefixOverflow, false);
  assert.equal(timeoutForkFailure.exitStatus, 125);
  assert.doesNotMatch(
    JSON.stringify(timeoutForkFailure),
    /Resource unavailable|timeout:/u,
  );

  const timeoutWaitFailure = await initialUidCensus(() =>
    censusChild({
      status: 125,
      stderrChunks: [
        'timeout: error waiting for command: Interrupted system call\n',
      ],
    }),
  );
  assert.equal(timeoutWaitFailure.stderrOutcome, 'timeout-wait-failure');
  assert.equal(timeoutWaitFailure.stderrEmitter, 'timeout');
  assert.equal(timeoutWaitFailure.stderrLineShape, 'single');
  assert.equal(timeoutWaitFailure.stderrPrefixCounts.timeoutWaitFailure, 1);
  assert.doesNotMatch(
    JSON.stringify(timeoutWaitFailure),
    /Interrupted system call|timeout:/u,
  );

  const childExit125 = await initialUidCensus(() =>
    censusChild({
      status: 125,
      stderrChunks: ['sudo: a password is required\n'],
    }),
  );
  assert.equal(childExit125.stderrOutcome, 'other');
  assert.equal(childExit125.stderrEmitter, 'sudo');
  assert.equal(childExit125.stderrLineShape, 'single');
  assert.equal(childExit125.exitStatus, 125);
  assert.equal(
    JSON.stringify(childExit125).includes('a password is required'),
    false,
  );

  const timeoutLaunchFailure = await initialUidCensus(() =>
    censusChild({
      status: 127,
      stderrChunks: [
        "timeout: failed to run command 'sudo': No such file or directory\n",
      ],
    }),
  );
  assert.equal(timeoutLaunchFailure.stderrOutcome, 'other');
  assert.equal(timeoutLaunchFailure.stderrEmitter, 'timeout');
  assert.equal(timeoutLaunchFailure.stderrLineShape, 'single');

  const nodeRuntimeFailure = await initialUidCensus(() =>
    censusChild({
      status: 1,
      stderrChunks: ['node:internal/modules/cjs/loader: missing module\n'],
    }),
  );
  assert.equal(nodeRuntimeFailure.stderrOutcome, 'other');
  assert.equal(nodeRuntimeFailure.stderrEmitter, 'node-runtime');
  assert.equal(nodeRuntimeFailure.stderrLineShape, 'single');
  assert.doesNotMatch(
    JSON.stringify(nodeRuntimeFailure),
    /node:internal|missing module/u,
  );

  const multipleLines = await initialUidCensus(() =>
    censusChild({
      status: 125,
      stderrChunks: [
        'timeout: warning: timer_create: Resource unavailable\ntimeout: fork system call failed: Resource unavailable\nsudo: private later line\n',
      ],
    }),
  );
  assert.equal(multipleLines.stderrOutcome, 'other');
  assert.equal(multipleLines.stderrEmitter, 'other');
  assert.equal(multipleLines.stderrLineShape, 'multiple');
  assert.deepEqual(multipleLines.stderrPrefixCounts, {
    timeoutTimerWarning: 1,
    timeoutForkFailure: 1,
    timeoutWaitFailure: 0,
    timeoutOther: 0,
    sudo: 1,
    nodeRuntime: 0,
    other: 0,
  });
  assert.equal(multipleLines.stderrPrefixOverflow, false);
  assert.doesNotMatch(
    JSON.stringify(multipleLines),
    /Resource unavailable|private later line|timeout:|sudo: /u,
  );

  const lineCountOverflow = await initialUidCensus(() =>
    censusChild({
      status: 1,
      stderrChunks: ['private census line\n'.repeat(110)],
    }),
  );
  assert.equal(lineCountOverflow.stderrLineShape, 'multiple');
  assert.equal(lineCountOverflow.stderrPrefixCounts.other, 100);
  assert.equal(lineCountOverflow.stderrPrefixOverflow, true);
  assert.doesNotMatch(
    JSON.stringify(lineCountOverflow),
    /private census line/u,
  );

  const otherStderr = await initialUidCensus(() =>
    censusChild({ status: 1, stderrChunks: ['unrecognized private detail\n'] }),
  );
  assert.equal(otherStderr.stderrOutcome, 'other');
  assert.equal(otherStderr.stderrEmitter, 'other');
  assert.equal(otherStderr.stderrLineShape, 'single');
  assert.doesNotMatch(JSON.stringify(otherStderr), /private detail/u);

  const prefixedError = await initialUidCensus(() =>
    censusChild({
      status: 1,
      stderrChunks: [
        "wrapper: timeout: sending signal TERM to command 'sudo': Operation not permitted\n",
      ],
    }),
  );
  assert.equal(prefixedError.stderrOutcome, 'other');
  assert.equal(prefixedError.stderrEmitter, 'other');
  assert.equal(prefixedError.stderrLineShape, 'single');

  const stderrOverflow = await initialUidCensus(() =>
    censusChild({
      status: 1,
      stderrChunks: [Buffer.alloc(4_097, 120)],
    }),
  );
  assert.equal(stderrOverflow.stderrOutcome, 'unavailable');
  assert.equal(stderrOverflow.stderrEmitter, 'unavailable');
  assert.equal(stderrOverflow.stderrLineShape, 'unavailable');
  assert.equal(stderrOverflow.stderrPrefixCounts, null);
  assert.equal(stderrOverflow.stderrPrefixOverflow, null);

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

test('retries one scoped stop after a clear initial inspection finds a late effective-UID process', async () => {
  const state = { uid: 24_000 };
  const initialStop = await stopUidProcesses(state, {
    runCommand: () => 1,
    census: async () => observedUidCensus(0),
  });
  const lateObservation = observedUidCensus(1);
  const stopCalls = [];
  const commandCalls = [];
  const waitCalls = [];
  const captureCalls = [];

  const result = await retryLateEffectiveUidStop(
    state,
    initialStop,
    lateObservation,
    {
      stop: (target) => {
        stopCalls.push(target);
        const statuses = [0, 0, 1];
        return stopUidProcesses(target, {
          runCommand: (program, args) => {
            commandCalls.push([program, ...args]);
            return statuses.shift();
          },
          wait: async (duration) => waitCalls.push(duration),
          census: async () => observedUidCensus(0),
        });
      },
      capture: (target) => {
        captureCalls.push(target);
        return observedUidCensus(0);
      },
    },
  );

  assert.equal(initialStop.diagnostics.initial.inspection, 'absent');
  assert.equal(initialStop.diagnostics.termSignal, 'not_attempted');
  assert.equal(result.stopResult.status, 'passed');
  assert.equal(result.stopResult.diagnostics.termSignal, 'sent');
  assert.equal(result.observation.uidProcessCount, 0);
  assert.equal(stopCalls.length, 1);
  assert.equal(stopCalls[0], state);
  assert.equal(captureCalls.length, 1);
  assert.equal(captureCalls[0], state);
  assert.deepEqual(waitCalls, [2_000]);
  assert.deepEqual(
    commandCalls.map((call) => call.slice(0, 4)),
    [
      ['pgrep', '-u', '24000'],
      ['sudo', '-n', 'pkill', '-TERM'],
      ['pgrep', '-u', '24000'],
    ],
  );
  assert.deepEqual(result.lateUidRetry.triggerUidProcessObservation, {
    state: 'observed',
    overflow: false,
    uidProcessCount: 1,
    effectiveUidMatchCount: 1,
    nonEffectiveUidOnlyCount: 0,
    nonZombieProcessCount: 1,
    zombieCount: 0,
    unreadableProcessCount: 0,
  });
});

test('does not retry for non-effective-only, overflowed, or already-signaled cleanup observations', async () => {
  const state = { uid: 24_000 };
  const initialStop = await stopUidProcesses(state, {
    runCommand: () => 1,
    census: async () => observedUidCensus(0),
  });
  const noRetryCases = [];
  const nonEffectiveOnly = observedUidCensus(1);
  nonEffectiveOnly.effectiveUidMatchCount = 0;
  nonEffectiveOnly.nonEffectiveUidOnlyCount = 1;
  noRetryCases.push(nonEffectiveOnly);
  const overflowed = observedUidCensus(1);
  overflowed.state = 'partial';
  overflowed.overflow = true;
  overflowed.effectiveUidMatchCount = 1;
  overflowed.nonEffectiveUidOnlyCount = 1;
  noRetryCases.push(overflowed);

  const signaledStop = await stopUidProcesses(state, {
    runCommand: (() => {
      const statuses = [0, 0, 1];
      return () => statuses.shift();
    })(),
    wait: async () => {},
    census: async () => observedUidCensus(0),
  });
  assert.equal(signaledStop.diagnostics.termSignal, 'sent');

  for (const [stopResult, observation] of [
    [initialStop, nonEffectiveOnly],
    [initialStop, overflowed],
    [signaledStop, observedUidCensus(1)],
  ]) {
    let stopCalls = 0;
    let captureCalls = 0;
    const result = await retryLateEffectiveUidStop(
      state,
      stopResult,
      observation,
      {
        stop: async () => {
          stopCalls += 1;
          return assert.fail('retry must not run');
        },
        capture: async () => {
          captureCalls += 1;
          return assert.fail('fresh census must not run');
        },
      },
    );
    assert.equal(result.lateUidRetry, null);
    assert.equal(result.stopResult, stopResult);
    assert.equal(result.observation, observation);
    assert.equal(stopCalls, 0);
    assert.equal(captureCalls, 0);
  }
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
