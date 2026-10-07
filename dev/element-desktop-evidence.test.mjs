import assert from 'node:assert/strict';
import test from 'node:test';

import {
  sanitizeDesktopStages,
  validDesktopSummary,
} from './element-desktop-evidence.mjs';

const sourceSha = 'a'.repeat(40);
const checks = Object.fromEntries(
  [
    'sourceSha',
    'runner',
    'package',
    'privateProfile',
    'secretService',
    'safeStorageBackend',
    'config',
    'updatesDisabled',
    'desktopProcess',
    'loopbackCdp',
    'packagedOrigin',
    'nativeSandbox',
    'nodeIntegrationDisabled',
  ].map((name) => [name, 'passed']),
);

function passingProbeFamily() {
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

function passingProbe() {
  return {
    passed: true,
    ipv4: passingProbeFamily(),
    ipv6: passingProbeFamily(),
  };
}

function passingTargetUidPreflight() {
  return {
    phase: 'target-uid-preflight',
    status: 'passed',
    runtimeFacts: {
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
    },
    scriptProbe: {
      listenerBound: true,
      childResult: 'probe-reported',
      childExitStatus: 0,
      childSignal: null,
      spawnErrorClass: null,
      stderrClass: 'empty',
      probeMarkerPresent: true,
      probeUidMatches: true,
      connectAttempted: true,
      connectionOutcome: 'connected',
      listenerAcceptedCount: 1,
    },
  };
}

function stages(overrides = {}) {
  return [
    passingTargetUidPreflight(),
    {
      phase: 'desktop-startup',
      status: 'passed',
      failureCode: null,
      sourceSha,
      package: {
        version: '1.12.30',
        architecture: 'amd64',
        sha256: 'b'.repeat(64),
      },
      runtime: {
        probeNode: '22.23.3',
        embeddedNode: null,
        electron: '44.3.0',
        chromium: '149.0.7827.55',
        runner: 'ubuntu-24.04',
      },
      origin: 'vector://vector',
      safeStorage: {
        mode: 'encrypted',
        backend: 'gnome_libsecret',
        markerCount: 1,
        complete: true,
      },
      rendererCount: 1,
      checks: { ...checks },
    },
    {
      phase: 'egress-policy',
      status: 'passed',
      negativeTest: 'passed',
      diagnostic: passingProbe(),
    },
    {
      phase: 'egress-observation',
      status: 'passed',
      ipv4Blocked: 0,
      ipv6Blocked: 0,
    },
    {
      phase: 'cleanup',
      isolatedProcesses: 'passed',
      policy: 'passed',
      user: 'passed',
      profile: 'passed',
      aptSource: 'passed',
    },
    ...(overrides.extraStages ?? []),
  ];
}

test('Desktop evidence passes only with a complete startup, deny test, zero-egress, and cleanup record', () => {
  const summary = sanitizeDesktopStages(stages(), sourceSha);
  assert.equal(summary.status, 'passed');
  assert.equal(summary.schemaVersion, 5);
  assert.equal(summary.failureCode, null);
  assert.equal(summary.checks.isolatedNodePreflight, 'passed');
  assert.equal(summary.targetUidPreflight.status, 'passed');
  assert.deepEqual(summary.egressBlocked, { ipv4: 0, ipv6: 0 });
  assert.deepEqual(summary.egressProbe, passingProbe());
  assert.equal(validDesktopSummary(summary), true);
});

test('Desktop evidence fails closed on blocked egress and rejects private-shaped fields', () => {
  const blocked = stages();
  blocked[3] = {
    phase: 'egress-observation',
    status: 'passed',
    ipv4Blocked: 1,
    ipv6Blocked: 0,
  };
  const summary = sanitizeDesktopStages(blocked, sourceSha);
  assert.equal(summary.status, 'failed');
  assert.equal(summary.failureCode, 'blocked-egress');

  const failedProbe = stages();
  failedProbe[2].status = 'failed';
  failedProbe[2].negativeTest = 'failed';
  failedProbe[2].diagnostic.ipv6.dropCount = 0;
  failedProbe[2].diagnostic.ipv6.connectionOutcome = 'connected';
  failedProbe[2].diagnostic.ipv6.childExitStatus = 0;
  failedProbe[2].diagnostic.ipv6.listenerAcceptedCount = 1;
  failedProbe[2].diagnostic.passed = false;
  const failedProbeSummary = sanitizeDesktopStages(failedProbe, sourceSha);
  assert.equal(failedProbeSummary.status, 'failed');
  assert.equal(failedProbeSummary.egressProbe.passed, false);

  const beforeMarker = stages();
  beforeMarker[2].status = 'failed';
  beforeMarker[2].negativeTest = 'failed';
  beforeMarker[2].diagnostic.ipv4.childResult = 'exited-before-marker';
  beforeMarker[2].diagnostic.ipv4.childExitStatus = 1;
  beforeMarker[2].diagnostic.ipv4.stderrClass = 'sudo-policy';
  beforeMarker[2].diagnostic.ipv4.probeMarkerPresent = false;
  beforeMarker[2].diagnostic.ipv4.probeUidMatches = null;
  beforeMarker[2].diagnostic.ipv4.connectAttempted = false;
  beforeMarker[2].diagnostic.ipv4.connectionOutcome = 'unexpected-exit';
  beforeMarker[2].diagnostic.ipv4.dropCount = 0;
  beforeMarker[2].diagnostic.passed = false;
  const beforeMarkerSummary = sanitizeDesktopStages(beforeMarker, sourceSha);
  assert.equal(
    beforeMarkerSummary.egressProbe.ipv4.childResult,
    'exited-before-marker',
  );
  assert.equal(beforeMarkerSummary.egressProbe.ipv4.childExitStatus, 1);
  assert.equal(beforeMarkerSummary.egressProbe.ipv4.stderrClass, 'sudo-policy');

  const privateRecord = stages();
  privateRecord[0].rawUrl = 'http://private.invalid/path';
  assert.throws(
    () => sanitizeDesktopStages(privateRecord, sourceSha),
    /invalid Desktop evidence input/u,
  );
  assert.throws(
    () => sanitizeDesktopStages(stages(), 'not-a-source-sha'),
    /invalid Desktop evidence input/u,
  );
  const privateProbe = stages();
  privateProbe[2].diagnostic.ipv4.rawAddress = '127.0.0.1';
  assert.throws(
    () => sanitizeDesktopStages(privateProbe, sourceSha),
    /invalid Desktop evidence input/u,
  );
});

test('Desktop evidence cannot pass with missing policy or unsuccessful cleanup', () => {
  const missingPolicy = stages().filter(
    (record) => record.phase !== 'egress-policy',
  );
  const missingSummary = sanitizeDesktopStages(missingPolicy, sourceSha);
  assert.equal(missingSummary.status, 'failed');
  assert.equal(missingSummary.failureCode, 'evidence-incomplete');

  const absentDiagnostic = stages();
  absentDiagnostic[2].diagnostic = null;
  assert.throws(
    () => sanitizeDesktopStages(absentDiagnostic, sourceSha),
    /invalid Desktop evidence input/u,
  );

  const failedCleanup = stages();
  failedCleanup[4].policy = 'failed';
  const cleanupSummary = sanitizeDesktopStages(failedCleanup, sourceSha);
  assert.equal(cleanupSummary.status, 'failed');
  assert.equal(cleanupSummary.failureCode, 'cleanup-failed');

  const malformedPackage = sanitizeDesktopStages(stages(), sourceSha);
  malformedPackage.package.version = '1.12.31';
  assert.equal(validDesktopSummary(malformedPackage), false);
});

test('Desktop evidence reports absent startup as incomplete and rejects degraded storage', () => {
  const missingStartup = stages().filter(
    (record) => record.phase !== 'desktop-startup',
  );
  const missingSummary = sanitizeDesktopStages(missingStartup, sourceSha);
  assert.equal(missingSummary.status, 'failed');
  assert.equal(missingSummary.failureCode, 'evidence-incomplete');
  assert.equal(missingSummary.checks.privateProfile, 'not_run');

  const missingPreflight = stages().filter(
    (record) => record.phase !== 'target-uid-preflight',
  );
  const missingPreflightSummary = sanitizeDesktopStages(
    missingPreflight,
    sourceSha,
  );
  assert.equal(missingPreflightSummary.status, 'failed');
  assert.equal(missingPreflightSummary.checks.isolatedNodePreflight, 'not_run');
  assert.equal(missingPreflightSummary.failureCode, 'evidence-incomplete');

  const failedPreflight = stages().filter(
    (record) => record.phase !== 'desktop-startup',
  );
  failedPreflight[0].status = 'failed';
  failedPreflight[0].runtimeFacts.stderrClass = 'missing-import';
  failedPreflight[0].runtimeFacts.childResult = 'exited-before-marker';
  failedPreflight[0].runtimeFacts.childExitStatus = 1;
  failedPreflight[0].runtimeFacts.markerPresent = false;
  failedPreflight[0].runtimeFacts.uidMatches = null;
  failedPreflight[0].runtimeFacts.nodeVersion = null;
  failedPreflight[0].runtimeFacts.nodeVersionSupported = false;
  failedPreflight[0].runtimeFacts.nodeExecutableRunnable = null;
  failedPreflight[0].runtimeFacts.scriptExists = null;
  failedPreflight[0].runtimeFacts.scriptReadable = null;
  failedPreflight[0].runtimeFacts.startupScriptReadable = null;
  failedPreflight[0].runtimeFacts.configReadable = null;
  failedPreflight[0].runtimeFacts.e2eManifestReadable = null;
  failedPreflight[0].runtimeFacts.playwrightUsable = null;
  failedPreflight[0].runtimeFacts.checkoutControlProtected = null;
  failedPreflight[0].scriptProbe = {
    listenerBound: false,
    childResult: 'not-run',
    childExitStatus: null,
    childSignal: null,
    spawnErrorClass: null,
    stderrClass: 'empty',
    probeMarkerPresent: false,
    probeUidMatches: null,
    connectAttempted: false,
    connectionOutcome: 'listener-error',
    listenerAcceptedCount: null,
  };
  const failedPreflightSummary = sanitizeDesktopStages(
    failedPreflight,
    sourceSha,
  );
  assert.equal(failedPreflightSummary.status, 'failed');
  assert.equal(
    failedPreflightSummary.failureCode,
    'isolated-node-preflight-failed',
  );
  assert.equal(
    failedPreflightSummary.targetUidPreflight.runtimeFacts.stderrClass,
    'missing-import',
  );
  assert.equal(
    JSON.stringify(failedPreflightSummary).includes('/private/'),
    false,
  );

  const unreadableScript = stages();
  unreadableScript[0].status = 'failed';
  unreadableScript[0].runtimeFacts.scriptReadable = false;
  const unreadableSummary = sanitizeDesktopStages(unreadableScript, sourceSha);
  assert.equal(unreadableSummary.status, 'failed');
  assert.equal(unreadableSummary.failureCode, 'isolated-node-preflight-failed');
  assert.equal(
    unreadableSummary.targetUidPreflight.runtimeFacts.scriptReadable,
    false,
  );

  const unusablePlaywright = stages();
  unusablePlaywright[0].status = 'failed';
  unusablePlaywright[0].runtimeFacts.playwrightUsable = false;
  const unusablePlaywrightSummary = sanitizeDesktopStages(
    unusablePlaywright,
    sourceSha,
  );
  assert.equal(unusablePlaywrightSummary.status, 'failed');
  assert.equal(
    unusablePlaywrightSummary.failureCode,
    'isolated-node-preflight-failed',
  );
  assert.equal(
    unusablePlaywrightSummary.targetUidPreflight.runtimeFacts.playwrightUsable,
    false,
  );

  const timedOutPreflight = stages().filter(
    (record) => record.phase !== 'desktop-startup',
  );
  timedOutPreflight[0].status = 'failed';
  Object.assign(timedOutPreflight[0].runtimeFacts, {
    childResult: 'spawn-error',
    childExitStatus: null,
    childSignal: 'SIGTERM',
    spawnErrorClass: 'timeout',
    markerPresent: false,
    uidMatches: null,
    nodeVersion: null,
    nodeVersionSupported: false,
    nodeExecutableRunnable: null,
    scriptExists: null,
    scriptReadable: null,
    startupScriptReadable: null,
    configReadable: null,
    e2eManifestReadable: null,
    playwrightUsable: null,
    checkoutControlProtected: null,
  });
  timedOutPreflight[0].scriptProbe = {
    listenerBound: false,
    childResult: 'not-run',
    childExitStatus: null,
    childSignal: null,
    spawnErrorClass: null,
    stderrClass: 'empty',
    probeMarkerPresent: false,
    probeUidMatches: null,
    connectAttempted: false,
    connectionOutcome: 'listener-error',
    listenerAcceptedCount: null,
  };
  const timedOutSummary = sanitizeDesktopStages(timedOutPreflight, sourceSha);
  assert.equal(timedOutSummary.status, 'failed');
  assert.equal(timedOutSummary.failureCode, 'isolated-node-preflight-failed');
  assert.equal(
    timedOutSummary.targetUidPreflight.runtimeFacts.childResult,
    'spawn-error',
  );
  assert.equal(
    timedOutSummary.targetUidPreflight.runtimeFacts.childSignal,
    'SIGTERM',
  );

  const degraded = stages();
  degraded[1].status = 'failed';
  degraded[1].failureCode = 'safe-storage-backend-unconfirmed';
  degraded[1].checks.safeStorageBackend = 'failed';
  degraded[1].safeStorage = {
    mode: 'basic_text',
    backend: 'gnome_libsecret',
    markerCount: 1,
    complete: true,
  };
  const degradedSummary = sanitizeDesktopStages(degraded, sourceSha);
  assert.equal(degradedSummary.status, 'failed');
  assert.equal(degradedSummary.failureCode, 'safe-storage-backend-unconfirmed');
});
