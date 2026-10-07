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

function stages(overrides = {}) {
  return [
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
  assert.equal(summary.schemaVersion, 3);
  assert.equal(summary.failureCode, null);
  assert.deepEqual(summary.egressBlocked, { ipv4: 0, ipv6: 0 });
  assert.deepEqual(summary.egressProbe, passingProbe());
  assert.equal(validDesktopSummary(summary), true);
});

test('Desktop evidence fails closed on blocked egress and rejects private-shaped fields', () => {
  const blocked = stages();
  blocked[2] = {
    phase: 'egress-observation',
    status: 'passed',
    ipv4Blocked: 1,
    ipv6Blocked: 0,
  };
  const summary = sanitizeDesktopStages(blocked, sourceSha);
  assert.equal(summary.status, 'failed');
  assert.equal(summary.failureCode, 'blocked-egress');

  const failedProbe = stages();
  failedProbe[1].status = 'failed';
  failedProbe[1].negativeTest = 'failed';
  failedProbe[1].diagnostic.ipv6.dropCount = 0;
  failedProbe[1].diagnostic.ipv6.connectionOutcome = 'connected';
  failedProbe[1].diagnostic.ipv6.childExitStatus = 0;
  failedProbe[1].diagnostic.ipv6.listenerAcceptedCount = 1;
  failedProbe[1].diagnostic.passed = false;
  const failedProbeSummary = sanitizeDesktopStages(failedProbe, sourceSha);
  assert.equal(failedProbeSummary.status, 'failed');
  assert.equal(failedProbeSummary.egressProbe.passed, false);

  const beforeMarker = stages();
  beforeMarker[1].status = 'failed';
  beforeMarker[1].negativeTest = 'failed';
  beforeMarker[1].diagnostic.ipv4.childResult = 'exited-before-marker';
  beforeMarker[1].diagnostic.ipv4.childExitStatus = 1;
  beforeMarker[1].diagnostic.ipv4.stderrClass = 'sudo-policy';
  beforeMarker[1].diagnostic.ipv4.probeMarkerPresent = false;
  beforeMarker[1].diagnostic.ipv4.probeUidMatches = null;
  beforeMarker[1].diagnostic.ipv4.connectAttempted = false;
  beforeMarker[1].diagnostic.ipv4.connectionOutcome = 'unexpected-exit';
  beforeMarker[1].diagnostic.ipv4.dropCount = 0;
  beforeMarker[1].diagnostic.passed = false;
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
  privateProbe[1].diagnostic.ipv4.rawAddress = '127.0.0.1';
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
  absentDiagnostic[1].diagnostic = null;
  assert.throws(
    () => sanitizeDesktopStages(absentDiagnostic, sourceSha),
    /invalid Desktop evidence input/u,
  );

  const failedCleanup = stages();
  failedCleanup[3].policy = 'failed';
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

  const degraded = stages();
  degraded[0].status = 'failed';
  degraded[0].failureCode = 'safe-storage-backend-unconfirmed';
  degraded[0].checks.safeStorageBackend = 'failed';
  degraded[0].safeStorage = {
    mode: 'basic_text',
    backend: 'gnome_libsecret',
    markerCount: 1,
    complete: true,
  };
  const degradedSummary = sanitizeDesktopStages(degraded, sourceSha);
  assert.equal(degradedSummary.status, 'failed');
  assert.equal(degradedSummary.failureCode, 'safe-storage-backend-unconfirmed');
});
