import assert from 'node:assert/strict';
import test from 'node:test';

import {
  emptyUidLifecycleObservation,
  emptyUidProcessStopDiagnostics,
  emptyUidStartupObservation,
  resolveTrustedRendererSandbox,
  sanitizeDesktopStages,
  sanitizeEgressCounterObservation,
  sanitizeUidLifecycleObservation,
  sanitizeUidProcessObservation,
  sanitizeUidStartupObservation,
  sanitizeUidTcpSocketObservation,
  uidProcessObservationFromLifecycle,
  validDesktopSummary,
} from './element-desktop-evidence.mjs';
import { summarizeUidLifecycleObservation } from './element-desktop-startup.mjs';

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
    policyState: 'verified',
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

function passingSecretService() {
  return {
    step: 'none',
    dbusAddressPresent: true,
    daemonOutcome: 'passed',
    daemonExitStatus: 0,
    daemonControlPresent: false,
    storeOutcome: 'passed',
    storeExitStatus: 0,
    lookupOutcome: 'passed',
    lookupExitStatus: 0,
    lookupMatches: true,
    clearOutcome: 'passed',
    clearExitStatus: 0,
    keyringFilePresent: true,
  };
}

function passingDesktopObservation(overrides = {}) {
  return {
    childState: 'running',
    childExitStatus: null,
    childSignal: null,
    childSpawnErrorClass: null,
    cdp: {
      versionResponseCount: 1,
      versionOkResponseCount: 1,
      versionLastStatus: 200,
      versionJsonValidObserved: true,
      targetListResponseCount: 1,
      targetListOkResponseCount: 1,
      targetListLastStatus: 200,
      targetListJsonValidObserved: true,
      pageTargetCount: 1,
      fixedOriginPageCount: 1,
    },
    pageLoadOutcome: 'domcontentloaded',
    configInMemoryObservation: { state: 'observed', matchesFixture: true },
    ...overrides,
  };
}

function passingUidLifecycleObservation() {
  return {
    state: 'observed',
    overflow: false,
    uidProcessCount: 2,
    nonZombieProcessCount: 2,
    zombieCount: 0,
    unreadableProcessCount: 0,
    unattributedProcessCount: 0,
    processClassCounts: {
      application: 1,
      browser: 0,
      renderer: 1,
      zygote: 0,
      gpu: 0,
      utility: 0,
      other: 0,
      unknown: 0,
    },
    processRoleCounts: {
      application: 1,
      chromium: 1,
      keyring: 0,
      dbus: 0,
      xvfb: 0,
      other: 0,
      unknown: 0,
    },
    rendererOwnership: {
      state: 'observed',
      appIdentityState: 'verified',
      rendererCount: 1,
      appDescendantCount: 1,
      appProcessGroupCount: 1,
      appDescendantAndProcessGroupCount: 1,
      appDescendantOnlyCount: 0,
      appProcessGroupOnlyCount: 0,
      noCurrentLinkCount: 0,
      otherUidAppDescendantCount: 0,
      securityCoverageState: 'observed',
    },
    cdpRendererObservation: {
      state: 'observed',
      overflow: false,
      rendererCount: 1,
      missingCount: 0,
      unreadableCount: 0,
      uidMatchCount: 1,
      uidMismatchCount: 0,
      appIdentityState: 'verified',
      appDescendantCount: 1,
      appDescendantUnobservedCount: 0,
      appProcessGroupCount: 1,
      appProcessGroupUnobservedCount: 0,
      appDescendantAndProcessGroupCount: 1,
      argvRendererMatchCount: 1,
      noSandboxFlagCount: 0,
      seccompState: 'enabled',
      noNewPrivsState: 'enabled',
    },
    seccompState: 'enabled',
    noNewPrivsState: 'enabled',
  };
}

function observedEmptyUidLifecycleObservation() {
  return {
    state: 'observed',
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
    rendererOwnership: {
      state: 'not_observed',
      appIdentityState: 'not_observed',
      rendererCount: null,
      appDescendantCount: null,
      appProcessGroupCount: null,
      appDescendantAndProcessGroupCount: null,
      appDescendantOnlyCount: null,
      appProcessGroupOnlyCount: null,
      noCurrentLinkCount: null,
      otherUidAppDescendantCount: null,
      securityCoverageState: 'not_observed',
    },
    cdpRendererObservation:
      emptyUidLifecycleObservation().cdpRendererObservation,
    seccompState: 'not_observed',
    noNewPrivsState: 'not_observed',
  };
}

function observedStopCensus(lifecycle) {
  return {
    state: lifecycle.state,
    outcome: lifecycle.overflow ? 'overflow' : 'observed',
    exitStatus: null,
    stderrOutcome: 'absent',
    stderrEmitter: 'other',
    stderrLineShape: 'empty',
    overflow: lifecycle.overflow,
    uidProcessCount: lifecycle.uidProcessCount,
    nonZombieProcessCount: lifecycle.nonZombieProcessCount,
    zombieCount: lifecycle.zombieCount,
    unreadableProcessCount: lifecycle.unreadableProcessCount,
    unattributedProcessCount: lifecycle.unattributedProcessCount,
    processClassCounts: lifecycle.processClassCounts,
    processRoleCounts: lifecycle.processRoleCounts,
  };
}

function passedStopDiagnostics() {
  const diagnostics = emptyUidProcessStopDiagnostics();
  diagnostics.status = 'passed';
  diagnostics.initial = {
    inspection: 'absent',
    census: observedStopCensus(observedEmptyUidLifecycleObservation()),
  };
  return diagnostics;
}

function observedEmptyUidTcpSocketObservation() {
  return {
    coverage: 'process_owned_tcp_only',
    packetAttribution: 'not_observed',
    state: 'observed',
    overflow: false,
    tcpSocketCount: 0,
    buckets: [],
  };
}

function passingUidTcpSocketObservation() {
  return {
    coverage: 'process_owned_tcp_only',
    packetAttribution: 'not_observed',
    state: 'observed',
    overflow: false,
    tcpSocketCount: 1,
    buckets: [
      {
        processRole: 'renderer',
        peerCategory: 'matrix_loopback',
        tcpState: 'established',
        count: 1,
      },
    ],
  };
}

function passingRendererDiagnostics(overrides = {}) {
  return {
    state: 'observed',
    sandboxReason: 'passed',
    applicationProcessObserved: true,
    processGroupCount: 3,
    unreadableProcessCount: 0,
    uidMismatchCount: 0,
    noSandboxFlagCount: 0,
    rendererCount: 1,
    seccompState: 'enabled',
    noNewPrivsState: 'enabled',
    ...overrides,
  };
}

function notObservedRendererDiagnostics() {
  return {
    state: 'not_observed',
    sandboxReason: 'not_observed',
    applicationProcessObserved: null,
    processGroupCount: null,
    unreadableProcessCount: null,
    uidMismatchCount: null,
    noSandboxFlagCount: null,
    rendererCount: null,
    seccompState: 'not_observed',
    noNewPrivsState: 'not_observed',
  };
}

function observedCounters(
  ipv4Blocked = 0,
  ipv6Blocked = 0,
  policyState = 'verified',
) {
  return countersFromClasses(
    { other: ipv4Blocked },
    { other: ipv6Blocked },
    policyState,
  );
}

function countersFromClasses(ipv4 = {}, ipv6 = {}, policyState = 'verified') {
  const classes = (values) => ({
    udp_dns_port: 0,
    tcp_dns_port: 0,
    tcp_https_port: 0,
    other: 0,
    ...values,
  });
  const ipv4Classes = classes(ipv4);
  const ipv6Classes = classes(ipv6);
  return {
    state: 'observed',
    policyState,
    ipv4Blocked: Object.values(ipv4Classes).reduce(
      (total, count) => total + count,
      0,
    ),
    ipv6Blocked: Object.values(ipv6Classes).reduce(
      (total, count) => total + count,
      0,
    ),
    ipv4Classes,
    ipv6Classes,
    overflow: false,
  };
}

function emptyCounters(
  state,
  policyState = state === 'not_observed' ? 'not_observed' : 'unavailable',
) {
  return {
    state,
    policyState,
    ipv4Blocked: null,
    ipv6Blocked: null,
    ipv4Classes: null,
    ipv6Classes: null,
    overflow: null,
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
      secretService: passingSecretService(),
      safeStorage: {
        mode: 'encrypted',
        backend: 'gnome_libsecret',
        markerCount: 1,
        complete: true,
      },
      desktopObservation: passingDesktopObservation(),
      rendererCount: 1,
      rendererDiagnostics: passingRendererDiagnostics(),
      uidLifecycleDiagnostics: {
        beforeApp: observedEmptyUidLifecycleObservation(),
        afterAppSpawn: observedEmptyUidLifecycleObservation(),
        afterPageLoad: passingUidLifecycleObservation(),
      },
      uidTcpSocketDiagnostics: {
        beforeApp: observedEmptyUidTcpSocketObservation(),
        afterPageLoad: passingUidTcpSocketObservation(),
      },
      egressPhaseCounters: {
        beforeApp: observedCounters(),
        afterAppSpawn: observedCounters(),
        afterPageLoad: observedCounters(),
      },
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
      policyState: 'verified',
      ipv4Blocked: 0,
      ipv6Blocked: 0,
      ipv4Classes: observedCounters().ipv4Classes,
      ipv6Classes: observedCounters().ipv6Classes,
      overflow: false,
    },
    {
      phase: 'cleanup',
      isolatedProcesses: 'passed',
      policy: 'passed',
      user: 'passed',
      profile: 'passed',
      aptSource: 'passed',
      accountState: 'absent',
      userdelStatus: 'not_run',
      userdelExitStatus: null,
      stopDiagnostics: passedStopDiagnostics(),
      uidProcessObservation: {
        state: 'observed',
        uidProcessCount: 0,
        nonZombieProcessCount: 0,
        zombieCount: 0,
        unreadableProcessCount: 0,
      },
      uidLifecycleObservationBeforeUserdel:
        observedEmptyUidLifecycleObservation(),
      finalUidLifecycleObservation: observedEmptyUidLifecycleObservation(),
    },
    ...(overrides.extraStages ?? []),
  ];
}

test('Desktop evidence passes with complete verified isolation and cleanup', () => {
  const summary = sanitizeDesktopStages(stages(), sourceSha);
  assert.equal(summary.status, 'passed');
  assert.equal(summary.schemaVersion, 19);
  assert.deepEqual(summary.desktopObservation.configInMemoryObservation, {
    state: 'observed',
    matchesFixture: true,
  });
  assert.equal(summary.failureCode, null);
  assert.equal(summary.checks.isolatedNodePreflight, 'passed');
  assert.equal(summary.targetUidPreflight.status, 'passed');
  assert.equal(summary.checks.networkIsolationVerified, 'passed');
  assert.deepEqual(summary.egressBlocked, { ipv4: 0, ipv6: 0 });
  assert.equal(summary.rendererDiagnostics.sandboxReason, 'passed');
  assert.deepEqual(summary.uidEgressPhaseCounters, {
    beforeApp: observedCounters(),
    afterAppSpawn: observedCounters(),
    afterPageLoad: observedCounters(),
    final: observedCounters(),
  });
  assert.deepEqual(summary.uidEgressPhaseDeltas, {
    beforeAppToAfterAppSpawn: {
      state: 'observed',
      ipv4Blocked: 0,
      ipv6Blocked: 0,
      ipv4Classes: observedCounters().ipv4Classes,
      ipv6Classes: observedCounters().ipv6Classes,
    },
    afterAppSpawnToAfterPageLoad: {
      state: 'observed',
      ipv4Blocked: 0,
      ipv6Blocked: 0,
      ipv4Classes: observedCounters().ipv4Classes,
      ipv6Classes: observedCounters().ipv6Classes,
    },
    afterPageLoadToFinal: {
      state: 'observed',
      ipv4Blocked: 0,
      ipv6Blocked: 0,
      ipv4Classes: observedCounters().ipv4Classes,
      ipv6Classes: observedCounters().ipv6Classes,
    },
  });
  assert.deepEqual(summary.cleanupDiagnostics, {
    policyStatus: 'passed',
    accountState: 'absent',
    userdelStatus: 'not_run',
    userdelExitStatus: null,
    stopDiagnostics: passedStopDiagnostics(),
    uidProcessObservation: {
      state: 'observed',
      uidProcessCount: 0,
      nonZombieProcessCount: 0,
      zombieCount: 0,
      unreadableProcessCount: 0,
    },
  });
  assert.equal(
    summary.cleanupDiagnostics.stopDiagnostics.initial.census.outcome,
    'observed',
  );
  assert.equal(
    summary.cleanupDiagnostics.stopDiagnostics.initial.census.uidProcessCount,
    0,
  );
  assert.deepEqual(summary.uidLifecycleDiagnostics, {
    beforeApp: observedEmptyUidLifecycleObservation(),
    afterAppSpawn: observedEmptyUidLifecycleObservation(),
    afterPageLoad: passingUidLifecycleObservation(),
    beforeUserdel: observedEmptyUidLifecycleObservation(),
  });
  assert.deepEqual(summary.uidTcpSocketDiagnostics, {
    beforeApp: observedEmptyUidTcpSocketObservation(),
    afterPageLoad: passingUidTcpSocketObservation(),
  });
  assert.deepEqual(summary.egressProbe, passingProbe());
  assert.deepEqual(summary.secretService, passingSecretService());
  assert.equal(validDesktopSummary(summary), true);
});

test('cleanup reports the deny policy retained when account removal is unproven', () => {
  const retainedPolicy = stages();
  retainedPolicy[4].isolatedProcesses = 'failed';
  retainedPolicy[4].policy = 'retained';
  retainedPolicy[4].user = 'failed';
  retainedPolicy[4].accountState = 'uid_match';

  const summary = sanitizeDesktopStages(retainedPolicy, sourceSha);
  assert.equal(summary.status, 'failed');
  assert.equal(summary.failureCode, 'cleanup-failed');
  assert.equal(summary.cleanupDiagnostics.policyStatus, 'retained');
  assert.equal(summary.checks.cleanupPolicy, 'failed');

  const unjustifiedRetention = stages();
  unjustifiedRetention[4].policy = 'retained';
  assert.throws(
    () => sanitizeDesktopStages(unjustifiedRetention, sourceSha),
    /invalid Desktop evidence input/u,
  );
});

test('cleanup keeps unavailable stop snapshots null and cannot treat them as clear', () => {
  const unavailable = stages();
  unavailable[4].isolatedProcesses = 'failed';
  unavailable[4].policy = 'retained';
  unavailable[4].user = 'failed';
  unavailable[4].accountState = 'uid_match';
  unavailable[4].stopDiagnostics = emptyUidProcessStopDiagnostics();
  unavailable[4].stopDiagnostics.status = 'failed';
  unavailable[4].stopDiagnostics.initial.inspection = 'unavailable';
  unavailable[4].stopDiagnostics.initial.census.state = 'unavailable';
  unavailable[4].stopDiagnostics.initial.census.outcome = 'unavailable';
  unavailable[4].stopDiagnostics.initial.census.stderrOutcome = 'unavailable';

  const summary = sanitizeDesktopStages(unavailable, sourceSha);
  assert.equal(summary.cleanupDiagnostics.policyStatus, 'retained');
  assert.equal(
    summary.cleanupDiagnostics.stopDiagnostics.initial.inspection,
    'unavailable',
  );
  assert.equal(
    summary.cleanupDiagnostics.stopDiagnostics.initial.census.uidProcessCount,
    null,
  );
  assert.equal(
    summary.cleanupDiagnostics.stopDiagnostics.initial.census.outcome,
    'unavailable',
  );

  unavailable[4].stopDiagnostics.initial.census.outcome = 'observed';
  assert.throws(
    () => sanitizeDesktopStages(unavailable, sourceSha),
    /invalid Desktop evidence input/u,
  );
  unavailable[4].stopDiagnostics.initial.census.outcome = 'unavailable';

  unavailable[4].stopDiagnostics.status = 'passed';
  assert.throws(
    () => sanitizeDesktopStages(unavailable, sourceSha),
    /invalid Desktop evidence input/u,
  );
});

test('cleanup pass requires observed zero UID counts on both sides of user deletion', () => {
  const unclearedBeforeUserdel = stages();
  unclearedBeforeUserdel[4].uidLifecycleObservationBeforeUserdel = {
    ...observedEmptyUidLifecycleObservation(),
    uidProcessCount: 1,
    nonZombieProcessCount: 1,
    processClassCounts: {
      ...observedEmptyUidLifecycleObservation().processClassCounts,
      other: 1,
    },
    processRoleCounts: {
      ...observedEmptyUidLifecycleObservation().processRoleCounts,
      other: 1,
    },
  };
  assert.throws(
    () => sanitizeDesktopStages(unclearedBeforeUserdel, sourceSha),
    /invalid Desktop evidence input/u,
  );

  const remainingAfterUserdel = stages();
  remainingAfterUserdel[4].finalUidLifecycleObservation = {
    ...observedEmptyUidLifecycleObservation(),
    state: 'partial',
  };
  remainingAfterUserdel[4].uidProcessObservation =
    uidProcessObservationFromLifecycle(
      remainingAfterUserdel[4].finalUidLifecycleObservation,
    );
  assert.throws(
    () => sanitizeDesktopStages(remainingAfterUserdel, sourceSha),
    /invalid Desktop evidence input/u,
  );
});

test('verified dual-stack policy passes with positive DROP counts and retains each class', () => {
  const positiveDrops = stages();
  const snapshot = countersFromClasses(
    { udp_dns_port: 2, tcp_https_port: 1 },
    { tcp_dns_port: 1, other: 1 },
  );
  positiveDrops[1].egressPhaseCounters = {
    beforeApp: snapshot,
    afterAppSpawn: snapshot,
    afterPageLoad: snapshot,
  };
  positiveDrops[3] = {
    phase: 'egress-observation',
    status: 'passed',
    policyState: 'verified',
    ipv4Blocked: snapshot.ipv4Blocked,
    ipv6Blocked: snapshot.ipv6Blocked,
    ipv4Classes: snapshot.ipv4Classes,
    ipv6Classes: snapshot.ipv6Classes,
    overflow: false,
  };

  const summary = sanitizeDesktopStages(positiveDrops, sourceSha);
  assert.equal(summary.status, 'passed');
  assert.equal(summary.checks.networkIsolationVerified, 'passed');
  assert.deepEqual(summary.egressBlocked, { ipv4: 3, ipv6: 2 });
  assert.deepEqual(
    summary.uidEgressPhaseCounters.afterAppSpawn.ipv4Classes,
    snapshot.ipv4Classes,
  );
  assert.deepEqual(
    summary.uidEgressPhaseCounters.final.ipv6Classes,
    snapshot.ipv6Classes,
  );
});

test('partial overflow counters remain visible but cannot verify network isolation', () => {
  const overflow = {
    state: 'partial',
    policyState: 'verified',
    ipv4Blocked: 100_000,
    ipv6Blocked: 0,
    ipv4Classes: {
      udp_dns_port: 100_000,
      tcp_dns_port: 0,
      tcp_https_port: 0,
      other: 0,
    },
    ipv6Classes: {
      udp_dns_port: 0,
      tcp_dns_port: 0,
      tcp_https_port: 0,
      other: 0,
    },
    overflow: true,
  };
  const withOverflow = stages();
  withOverflow[1].egressPhaseCounters.afterPageLoad = overflow;

  const summary = sanitizeDesktopStages(withOverflow, sourceSha);
  assert.equal(summary.status, 'failed');
  assert.equal(summary.checks.networkIsolationVerified, 'failed');
  assert.equal(summary.uidEgressPhaseCounters.afterPageLoad.state, 'partial');
  assert.equal(
    summary.uidEgressPhaseCounters.afterPageLoad.ipv4Blocked,
    100_000,
  );
});

test('in-memory config evidence exposes only a fixed match result and remains diagnostic', () => {
  const unavailableConfig = stages();
  unavailableConfig[1].desktopObservation.configInMemoryObservation = {
    state: 'unavailable',
    matchesFixture: null,
  };
  const summary = sanitizeDesktopStages(unavailableConfig, sourceSha);
  assert.equal(summary.status, 'passed');
  assert.deepEqual(summary.desktopObservation.configInMemoryObservation, {
    state: 'unavailable',
    matchesFixture: null,
  });

  const privateConfig = stages();
  privateConfig[1].desktopObservation.configInMemoryObservation = {
    state: 'observed',
    matchesFixture: true,
    sessionId: 'private-session-canary',
  };
  assert.throws(
    () => sanitizeDesktopStages(privateConfig, sourceSha),
    /invalid Desktop evidence input/u,
  );
});

test('trusted sandbox resolution uses root-bound CDP identity when argv misses a renderer', () => {
  const lifecycle = passingUidLifecycleObservation();
  lifecycle.processClassCounts.renderer = 0;
  lifecycle.processClassCounts.unknown = 1;
  lifecycle.rendererOwnership = {
    ...lifecycle.rendererOwnership,
    rendererCount: 0,
    appDescendantCount: 0,
    appProcessGroupCount: 0,
    appDescendantAndProcessGroupCount: 0,
    appDescendantOnlyCount: 0,
    appProcessGroupOnlyCount: 0,
    noCurrentLinkCount: 0,
  };
  lifecycle.cdpRendererObservation.argvRendererMatchCount = 0;
  lifecycle.seccompState = 'unavailable';
  lifecycle.noNewPrivsState = 'unavailable';

  const processGroup = passingRendererDiagnostics({
    sandboxReason: 'renderer_missing',
    rendererCount: 0,
    seccompState: 'unavailable',
    noNewPrivsState: 'unavailable',
  });
  const resolved = resolveTrustedRendererSandbox(processGroup, lifecycle);

  assert.equal(resolved.passed, true);
  assert.equal(resolved.rendererCount, 1);
  assert.equal(resolved.rendererDiagnostics.sandboxReason, 'passed');
  assert.equal(resolved.rendererDiagnostics.rendererCount, 1);
  assert.equal(resolved.rendererDiagnostics.seccompState, 'enabled');
  assert.equal(resolved.rendererDiagnostics.noNewPrivsState, 'enabled');

  const detached = structuredClone(lifecycle);
  detached.cdpRendererObservation.appProcessGroupCount = 0;
  detached.cdpRendererObservation.appDescendantAndProcessGroupCount = 0;
  const detachedResult = resolveTrustedRendererSandbox(processGroup, detached);
  assert.equal(detachedResult.passed, false);
  assert.equal(
    detachedResult.rendererDiagnostics.sandboxReason,
    'renderer_ownership_unconfirmed',
  );

  const incomplete = structuredClone(lifecycle);
  incomplete.cdpRendererObservation.state = 'partial';
  incomplete.cdpRendererObservation.overflow = true;
  const incompleteResult = resolveTrustedRendererSandbox(
    processGroup,
    incomplete,
  );
  assert.equal(incompleteResult.passed, false);
  assert.equal(
    incompleteResult.rendererDiagnostics.sandboxReason,
    'renderer_ownership_unconfirmed',
  );

  const rejectedCases = [
    [
      'foreign uid',
      (renderer) => {
        renderer.state = 'partial';
        renderer.uidMatchCount = 0;
        renderer.uidMismatchCount = 1;
      },
    ],
    [
      'missing pid',
      (renderer) => {
        renderer.state = 'partial';
        renderer.missingCount = 1;
      },
    ],
    [
      'unreadable proc data',
      (renderer) => {
        renderer.state = 'partial';
        renderer.unreadableCount = 1;
      },
    ],
    [
      'no sandbox',
      (renderer) => {
        renderer.noSandboxFlagCount = 1;
      },
    ],
    [
      'seccomp disabled',
      (renderer) => {
        renderer.seccompState = 'disabled';
      },
    ],
    [
      'no new privs disabled',
      (renderer) => {
        renderer.noNewPrivsState = 'disabled';
      },
    ],
  ];
  for (const [name, mutate] of rejectedCases) {
    const unsafe = structuredClone(lifecycle);
    mutate(unsafe.cdpRendererObservation);
    const result = resolveTrustedRendererSandbox(processGroup, unsafe);
    assert.equal(result.passed, false, name);
  }
});

test('trusted CDP proof cannot override explicit unsafe app-group sandbox states', () => {
  const lifecycle = passingUidLifecycleObservation();
  const rejectedStates = [
    [
      'disabled seccomp',
      {
        sandboxReason: 'seccomp_unconfirmed',
        rendererCount: 1,
        seccompState: 'disabled',
        noNewPrivsState: 'enabled',
      },
      'seccompState',
      'disabled',
    ],
    [
      'mixed seccomp',
      {
        sandboxReason: 'seccomp_unconfirmed',
        rendererCount: 1,
        seccompState: 'mixed',
        noNewPrivsState: 'enabled',
      },
      'seccompState',
      'mixed',
    ],
    [
      'disabled no new privs',
      {
        sandboxReason: 'no_new_privs_unconfirmed',
        rendererCount: 1,
        seccompState: 'enabled',
        noNewPrivsState: 'disabled',
      },
      'noNewPrivsState',
      'disabled',
    ],
    [
      'mixed no new privs',
      {
        sandboxReason: 'no_new_privs_unconfirmed',
        rendererCount: 1,
        seccompState: 'enabled',
        noNewPrivsState: 'mixed',
      },
      'noNewPrivsState',
      'mixed',
    ],
  ];

  for (const [name, overrides, stateField, expectedState] of rejectedStates) {
    const result = resolveTrustedRendererSandbox(
      passingRendererDiagnostics(overrides),
      lifecycle,
    );
    assert.equal(result.passed, false, name);
    assert.equal(
      result.rendererDiagnostics.sandboxReason,
      'renderer_ownership_unconfirmed',
      name,
    );
    assert.equal(result.rendererDiagnostics[stateField], expectedState, name);
  }

  const unavailableSeccomp = resolveTrustedRendererSandbox(
    passingRendererDiagnostics({
      sandboxReason: 'seccomp_unconfirmed',
      rendererCount: 1,
      seccompState: 'unavailable',
      noNewPrivsState: 'enabled',
    }),
    lifecycle,
  );
  assert.equal(unavailableSeccomp.passed, true);
  assert.equal(unavailableSeccomp.rendererDiagnostics.seccompState, 'enabled');

  const unavailableNoNewPrivs = resolveTrustedRendererSandbox(
    passingRendererDiagnostics({
      sandboxReason: 'no_new_privs_unconfirmed',
      rendererCount: 1,
      seccompState: 'enabled',
      noNewPrivsState: 'unavailable',
    }),
    lifecycle,
  );
  assert.equal(unavailableNoNewPrivs.passed, true);
  assert.equal(
    unavailableNoNewPrivs.rendererDiagnostics.noNewPrivsState,
    'enabled',
  );
});

test('trusted CDP renderer set reconciles with the complete root lifecycle census', () => {
  const processGroup = passingRendererDiagnostics();
  const mismatchedCount = passingUidLifecycleObservation();
  mismatchedCount.uidProcessCount = 3;
  mismatchedCount.nonZombieProcessCount = 3;
  mismatchedCount.processClassCounts.renderer = 2;
  mismatchedCount.rendererOwnership = {
    ...mismatchedCount.rendererOwnership,
    rendererCount: 2,
    appDescendantCount: 2,
    appProcessGroupCount: 2,
    appDescendantAndProcessGroupCount: 2,
  };

  const countMismatchResult = resolveTrustedRendererSandbox(
    processGroup,
    mismatchedCount,
  );
  assert.equal(countMismatchResult.passed, false);
  assert.equal(
    countMismatchResult.rendererDiagnostics.sandboxReason,
    'renderer_ownership_unconfirmed',
  );

  const uncontainedRenderer = passingUidLifecycleObservation();
  uncontainedRenderer.rendererOwnership = {
    ...uncontainedRenderer.rendererOwnership,
    appProcessGroupCount: 0,
    appDescendantAndProcessGroupCount: 0,
    appDescendantOnlyCount: 1,
  };
  const uncontainedResult = resolveTrustedRendererSandbox(
    processGroup,
    uncontainedRenderer,
  );
  assert.equal(uncontainedResult.passed, false);

  const unsafeLifecycleSecurity = passingUidLifecycleObservation();
  unsafeLifecycleSecurity.seccompState = 'disabled';
  const unsafeSecurityResult = resolveTrustedRendererSandbox(
    processGroup,
    unsafeLifecycleSecurity,
  );
  assert.equal(unsafeSecurityResult.passed, false);

  const foreignAppDescendant = passingUidLifecycleObservation();
  foreignAppDescendant.rendererOwnership.otherUidAppDescendantCount = 1;
  const foreignDescendantResult = resolveTrustedRendererSandbox(
    processGroup,
    foreignAppDescendant,
  );
  assert.equal(foreignDescendantResult.passed, false);
});

test('trusted renderer proof covers known argv PIDs without equating argv and CDP totals', () => {
  const processRow = (
    pid,
    parentPid,
    processGroupId,
    args,
    overrides = {},
  ) => ({
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
  });
  const app = processRow(500, 1, 500, ['/usr/bin/element-desktop']);
  const summarize = (children, cdpPids) =>
    summarizeUidLifecycleObservation(
      [app, ...children],
      24_000,
      500,
      true,
      false,
      {
        state: 'observed',
        overflow: false,
        rendererCount: cdpPids.length,
        pids: cdpPids,
      },
    );
  const secureRenderer = processRow(502, 500, 500, [
    '--type=renderer',
    'private-process-canary',
  ]);
  const processGroup = passingRendererDiagnostics();

  const argvMiss = summarize(
    [processRow(502, 500, 500, ['--type=utility'])],
    [502],
  );
  assert.equal(argvMiss.state, 'observed');
  assert.equal(argvMiss.rendererOwnership.rendererCount, 0);
  assert.equal(argvMiss.cdpRendererObservation.rendererCount, 1);
  assert.equal(argvMiss.cdpRendererObservation.argvRendererMatchCount, 0);
  assert.equal(
    resolveTrustedRendererSandbox(
      passingRendererDiagnostics({
        sandboxReason: 'renderer_missing',
        rendererCount: 0,
        seccompState: 'unavailable',
        noNewPrivsState: 'unavailable',
      }),
      argvMiss,
    ).passed,
    true,
  );

  const omittedUnsafeRenderer = summarize(
    [secureRenderer, processRow(503, 500, 500, ['--type=renderer'])],
    [502],
  );
  assert.equal(omittedUnsafeRenderer.cdpRendererObservation.state, 'observed');
  assert.equal(omittedUnsafeRenderer.state, 'partial');
  assert.equal(
    resolveTrustedRendererSandbox(processGroup, omittedUnsafeRenderer).passed,
    false,
  );

  const coveredMixedMarkers = summarize(
    [secureRenderer, processRow(503, 500, 500, ['--type=utility'])],
    [502, 503],
  );
  assert.equal(coveredMixedMarkers.state, 'observed');
  assert.equal(coveredMixedMarkers.rendererOwnership.rendererCount, 1);
  assert.equal(coveredMixedMarkers.cdpRendererObservation.rendererCount, 2);
  assert.equal(
    coveredMixedMarkers.cdpRendererObservation.argvRendererMatchCount,
    1,
  );
  const mixedResult = resolveTrustedRendererSandbox(
    processGroup,
    coveredMixedMarkers,
  );
  assert.equal(mixedResult.passed, true);
  assert.equal(mixedResult.rendererCount, 2);

  const uncoveredMixedMarkers = summarize(
    [secureRenderer, processRow(503, 500, 500, ['--type=utility'])],
    [503],
  );
  assert.equal(uncoveredMixedMarkers.state, 'partial');
  assert.equal(
    resolveTrustedRendererSandbox(processGroup, uncoveredMixedMarkers).passed,
    false,
  );
  const publicEvidence = JSON.stringify([
    argvMiss,
    omittedUnsafeRenderer,
    coveredMixedMarkers,
    uncoveredMixedMarkers,
  ]);
  assert.doesNotMatch(publicEvidence, /502|503|private-process-canary/u);
});

test('startup sanitizer rejects a native sandbox pass without full root CDP binding', () => {
  const invalid = stages();
  invalid[1].uidLifecycleDiagnostics.afterPageLoad.cdpRendererObservation.appProcessGroupCount = 0;
  invalid[1].uidLifecycleDiagnostics.afterPageLoad.cdpRendererObservation.appDescendantAndProcessGroupCount = 0;

  assert.throws(
    () => sanitizeDesktopStages(invalid, sourceSha),
    /invalid Desktop evidence input/u,
  );
});

test('Desktop evidence retains only the finite secret-service failure substep', () => {
  const failed = stages();
  failed[1].status = 'failed';
  failed[1].failureCode = 'secret-service-unavailable';
  failed[1].checks.secretService = 'failed';
  failed[1].secretService = {
    ...passingSecretService(),
    step: 'secret-store',
    storeOutcome: 'nonzero-exit',
    storeExitStatus: 1,
  };

  const summary = sanitizeDesktopStages(failed, sourceSha);
  assert.equal(summary.status, 'failed');
  assert.equal(summary.failureCode, 'secret-service-unavailable');
  assert.equal(summary.secretService.step, 'secret-store');
  assert.equal(summary.secretService.storeOutcome, 'nonzero-exit');
  assert.equal(summary.secretService.storeExitStatus, 1);
  assert.equal(JSON.stringify(summary).includes('private-canary'), false);

  const unexpected = stages();
  unexpected[1].secretService.rawOutput = 'private-canary';
  assert.throws(
    () => sanitizeDesktopStages(unexpected, sourceSha),
    /invalid Desktop evidence input/u,
  );

  const inconsistent = stages();
  inconsistent[1].secretService.step = 'secret-store';
  assert.throws(
    () => sanitizeDesktopStages(inconsistent, sourceSha),
    /invalid Desktop evidence input/u,
  );
});

test('Desktop evidence preserves a finite sandbox failure reason without raw process data', () => {
  const failed = stages();
  failed[1].status = 'failed';
  failed[1].failureCode = 'renderer-sandbox-unconfirmed';
  failed[1].checks.nativeSandbox = 'failed';
  failed[1].rendererCount = null;
  failed[1].rendererDiagnostics = passingRendererDiagnostics({
    sandboxReason: 'unreadable_process_member',
    unreadableProcessCount: 1,
    seccompState: 'unavailable',
    noNewPrivsState: 'unavailable',
  });

  const summary = sanitizeDesktopStages(failed, sourceSha);
  assert.equal(summary.status, 'failed');
  assert.equal(summary.failureCode, 'renderer-sandbox-unconfirmed');
  assert.equal(
    summary.rendererDiagnostics.sandboxReason,
    'unreadable_process_member',
  );
  assert.equal(summary.rendererDiagnostics.unreadableProcessCount, 1);
  assert.equal(validDesktopSummary(summary), true);

  const privateDiagnostic = stages();
  privateDiagnostic[1].rendererDiagnostics.pid = 1234;
  assert.throws(
    () => sanitizeDesktopStages(privateDiagnostic, sourceSha),
    /invalid Desktop evidence input/u,
  );
});

test('cleanup census sanitizer accepts the fixed process-count shape and fails closed on malformed fields', () => {
  const observed = {
    state: 'observed',
    uidProcessCount: 3,
    nonZombieProcessCount: 2,
    zombieCount: 1,
    unreadableProcessCount: 0,
  };
  assert.deepEqual(
    sanitizeUidProcessObservation(JSON.stringify(observed)),
    observed,
  );

  const unavailable = {
    state: 'unavailable',
    uidProcessCount: null,
    nonZombieProcessCount: null,
    zombieCount: null,
    unreadableProcessCount: null,
  };
  assert.deepEqual(
    sanitizeUidProcessObservation(JSON.stringify(unavailable)),
    unavailable,
  );
  assert.deepEqual(sanitizeUidProcessObservation('{'), unavailable);
  assert.deepEqual(
    sanitizeUidProcessObservation({ ...observed, processId: 1234 }),
    unavailable,
  );
});

test('cleanup summary accepts only correlated fixed census stderr outcomes', () => {
  const summary = sanitizeDesktopStages(stages(), sourceSha);
  const unknownOutcome = structuredClone(summary);
  unknownOutcome.cleanupDiagnostics.stopDiagnostics.initial.census.stderrOutcome =
    'raw-stderr';
  assert.equal(validDesktopSummary(unknownOutcome), false);

  const impossibleObservedFailure = structuredClone(summary);
  impossibleObservedFailure.cleanupDiagnostics.stopDiagnostics.initial.census.stderrOutcome =
    'timeout-fork-failure';
  impossibleObservedFailure.cleanupDiagnostics.stopDiagnostics.initial.census.stderrEmitter =
    'timeout';
  impossibleObservedFailure.cleanupDiagnostics.stopDiagnostics.initial.census.stderrLineShape =
    'single';
  assert.equal(validDesktopSummary(impossibleObservedFailure), false);

  const observedNotAttempted = structuredClone(summary);
  observedNotAttempted.cleanupDiagnostics.stopDiagnostics.initial.census.stderrOutcome =
    'not_attempted';
  assert.equal(validDesktopSummary(observedNotAttempted), false);

  const notAttempted = structuredClone(summary);
  notAttempted.cleanupDiagnostics.stopDiagnostics.postTerm.census.stderrOutcome =
    'absent';
  assert.equal(validDesktopSummary(notAttempted), false);
});

test('cleanup census stderr buckets are closed and correlate timeout 125 signatures', () => {
  const summary = sanitizeDesktopStages(stages(), sourceSha);
  const census = summary.cleanupDiagnostics.stopDiagnostics.initial.census;
  census.state = 'unavailable';
  census.outcome = 'nonzero-exit';
  census.exitStatus = 125;
  census.overflow = null;
  census.uidProcessCount = null;
  census.nonZombieProcessCount = null;
  census.zombieCount = null;
  census.unreadableProcessCount = null;
  census.unattributedProcessCount = null;
  census.processClassCounts = null;
  census.processRoleCounts = null;
  census.stderrOutcome = 'timeout-fork-failure';
  census.stderrEmitter = 'timeout';
  census.stderrLineShape = 'single';
  assert.equal(validDesktopSummary(summary), true);

  const wrongEmitter = structuredClone(summary);
  wrongEmitter.cleanupDiagnostics.stopDiagnostics.initial.census.stderrEmitter =
    'sudo';
  assert.equal(validDesktopSummary(wrongEmitter), false);

  const wrongShape = structuredClone(summary);
  wrongShape.cleanupDiagnostics.stopDiagnostics.initial.census.stderrLineShape =
    'multiple';
  assert.equal(validDesktopSummary(wrongShape), false);

  const wrongStatus = structuredClone(summary);
  wrongStatus.cleanupDiagnostics.stopDiagnostics.initial.census.exitStatus = 1;
  assert.equal(validDesktopSummary(wrongStatus), false);

  const unknownEmitter = structuredClone(summary);
  unknownEmitter.cleanupDiagnostics.stopDiagnostics.initial.census.stderrEmitter =
    'raw-stderr-prefix';
  assert.equal(validDesktopSummary(unknownEmitter), false);

  const unknownLineShape = structuredClone(summary);
  unknownLineShape.cleanupDiagnostics.stopDiagnostics.initial.census.stderrLineShape =
    'three-lines';
  assert.equal(validDesktopSummary(unknownLineShape), false);

  const impossibleEmpty = structuredClone(summary);
  impossibleEmpty.cleanupDiagnostics.stopDiagnostics.initial.census.stderrOutcome =
    'absent';
  assert.equal(validDesktopSummary(impossibleEmpty), false);

  const previousSchema = structuredClone(summary);
  previousSchema.schemaVersion = 18;
  assert.equal(validDesktopSummary(previousSchema), false);
});

test('UID lifecycle sanitizer preserves bounded ownership evidence and unavailable states without private fields', () => {
  const observed = passingUidLifecycleObservation();
  assert.deepEqual(
    sanitizeUidLifecycleObservation(JSON.stringify(observed)),
    observed,
  );
  assert.deepEqual(
    sanitizeUidLifecycleObservation(undefined),
    emptyUidLifecycleObservation('not_observed'),
  );
  assert.deepEqual(
    sanitizeUidLifecycleObservation('{'),
    emptyUidLifecycleObservation('unavailable'),
  );
  assert.deepEqual(
    sanitizeUidLifecycleObservation({
      ...observed,
      applicationPid: 98_765,
      rawCommandLine: 'private-canary',
    }),
    emptyUidLifecycleObservation('unavailable'),
  );

  const partial = {
    ...observed,
    state: 'partial',
    overflow: true,
    rendererOwnership: {
      ...observed.rendererOwnership,
      state: 'partial',
      securityCoverageState: 'partial',
    },
  };
  assert.deepEqual(
    sanitizeUidLifecycleObservation(JSON.stringify(partial)),
    partial,
  );

  const unavailableProjection = uidProcessObservationFromLifecycle('{');
  assert.deepEqual(unavailableProjection, {
    state: 'unavailable',
    uidProcessCount: null,
    nonZombieProcessCount: null,
    zombieCount: null,
    unreadableProcessCount: null,
  });
  assert.equal(JSON.stringify(observed).includes('98765'), false);
  assert.equal(JSON.stringify(observed).includes('private-canary'), false);
});

test('UID lifecycle sanitizer rejects contradictory process and renderer counts', () => {
  const unavailable = emptyUidLifecycleObservation('unavailable');
  const empty = observedEmptyUidLifecycleObservation();

  assert.deepEqual(
    sanitizeUidLifecycleObservation({ ...empty, nonZombieProcessCount: 1 }),
    unavailable,
  );
  assert.deepEqual(
    sanitizeUidLifecycleObservation({
      ...empty,
      state: 'partial',
      overflow: true,
      processClassCounts: { ...empty.processClassCounts, other: 1 },
    }),
    unavailable,
  );
  assert.deepEqual(
    sanitizeUidLifecycleObservation({
      ...empty,
      uidProcessCount: 1,
      nonZombieProcessCount: 0,
      zombieCount: 2,
      processClassCounts: { ...empty.processClassCounts, other: 1 },
    }),
    unavailable,
  );

  const observed = passingUidLifecycleObservation();
  assert.deepEqual(
    sanitizeUidLifecycleObservation({
      ...observed,
      processClassCounts: {
        ...observed.processClassCounts,
        application: 0,
      },
    }),
    unavailable,
  );
  assert.deepEqual(
    sanitizeUidLifecycleObservation({
      ...observed,
      processRoleCounts: {
        ...observed.processRoleCounts,
        other: 1,
      },
    }),
    unavailable,
  );
  assert.deepEqual(
    sanitizeUidLifecycleObservation({
      ...observed,
      rendererOwnership: {
        ...observed.rendererOwnership,
        rendererCount: 0,
        appDescendantCount: 0,
        appProcessGroupCount: 0,
        appDescendantAndProcessGroupCount: 0,
        appDescendantOnlyCount: 0,
        appProcessGroupOnlyCount: 0,
        noCurrentLinkCount: 0,
      },
    }),
    unavailable,
  );
});

test('CDP renderer evidence rejects impossible counts and all process identifiers', () => {
  const observed = passingUidLifecycleObservation();
  const impossible = structuredClone(observed);
  impossible.cdpRendererObservation.uidMatchCount = 2;
  assert.deepEqual(
    sanitizeUidLifecycleObservation(impossible),
    emptyUidLifecycleObservation('unavailable'),
  );

  const privatePid = structuredClone(observed);
  privatePid.cdpRendererObservation.pid = 42_001;
  assert.deepEqual(
    sanitizeUidLifecycleObservation(privatePid),
    emptyUidLifecycleObservation('unavailable'),
  );
  assert.equal(JSON.stringify(observed).includes('42001'), false);
});

test('TCP socket diagnostics preserve only fixed roles, categories, and states', () => {
  const observed = passingUidTcpSocketObservation();
  assert.deepEqual(
    sanitizeUidTcpSocketObservation(JSON.stringify(observed)),
    observed,
  );
  assert.deepEqual(
    sanitizeUidTcpSocketObservation(undefined),
    emptyUidStartupObservation().tcpSocketObservation,
  );
  assert.deepEqual(
    sanitizeUidTcpSocketObservation('{'),
    emptyUidStartupObservation('unavailable').tcpSocketObservation,
  );
  assert.deepEqual(
    sanitizeUidTcpSocketObservation({
      ...observed,
      buckets: [
        {
          ...observed.buckets[0],
          remoteAddress: '192.0.2.44',
          numericPort: 8008,
        },
      ],
    }),
    emptyUidStartupObservation('unavailable').tcpSocketObservation,
  );
  assert.deepEqual(
    sanitizeUidTcpSocketObservation({
      ...observed,
      buckets: [{ ...observed.buckets[0], peerCategory: 'raw_ip_192.0.2.44' }],
    }),
    emptyUidStartupObservation('unavailable').tcpSocketObservation,
  );

  const incomplete = {
    ...observed,
    state: 'partial',
    overflow: true,
  };
  assert.deepEqual(sanitizeUidTcpSocketObservation(incomplete), incomplete);
  assert.equal(
    JSON.stringify(sanitizeUidTcpSocketObservation(observed)).includes(
      '192.0.2.44',
    ),
    false,
  );
});

test('UID startup observation rejects unrecognized envelope fields and keeps missing captures unavailable', () => {
  const observed = {
    uidLifecycleObservation: passingUidLifecycleObservation(),
    tcpSocketObservation: passingUidTcpSocketObservation(),
  };
  assert.deepEqual(
    sanitizeUidStartupObservation(JSON.stringify(observed)),
    observed,
  );
  assert.deepEqual(
    sanitizeUidStartupObservation(undefined),
    emptyUidStartupObservation('not_observed'),
  );
  assert.deepEqual(
    sanitizeUidStartupObservation({ ...observed, applicationPid: 41_002 }),
    emptyUidStartupObservation('unavailable'),
  );
});

test('egress counter sanitizer preserves only fixed classes and honest overflow', () => {
  const observed = observedCounters(2, 1);
  assert.deepEqual(
    sanitizeEgressCounterObservation(JSON.stringify(observed)),
    observed,
  );
  assert.deepEqual(
    sanitizeEgressCounterObservation('{'),
    emptyCounters('unavailable'),
  );
  assert.deepEqual(
    sanitizeEgressCounterObservation({
      ...observed,
      ipv4Classes: { other: 2, numericPort: 443 },
    }),
    emptyCounters('unavailable', 'verified'),
  );
  const overflow = {
    state: 'partial',
    policyState: 'verified',
    ipv4Blocked: 100_000,
    ipv6Blocked: 0,
    ipv4Classes: {
      udp_dns_port: 100_000,
      tcp_dns_port: 0,
      tcp_https_port: 0,
      other: 0,
    },
    ipv6Classes: {
      udp_dns_port: 0,
      tcp_dns_port: 0,
      tcp_https_port: 0,
      other: 0,
    },
    overflow: true,
  };
  assert.deepEqual(sanitizeEgressCounterObservation(overflow), overflow);

  const mixedFamilyOverflow = {
    ...overflow,
    ipv6Classes: {
      udp_dns_port: 0,
      tcp_dns_port: 0,
      tcp_https_port: 0,
      other: 1,
    },
  };
  assert.deepEqual(
    sanitizeEgressCounterObservation(mixedFamilyOverflow),
    emptyCounters('unavailable', 'verified'),
  );
});

test('unavailable phase snapshots prevent a network-isolation pass', () => {
  const withUnavailableSnapshots = stages();
  withUnavailableSnapshots[1].egressPhaseCounters = {
    beforeApp: observedCounters(),
    afterAppSpawn: {
      state: 'unavailable',
      policyState: 'unavailable',
      ipv4Blocked: null,
      ipv6Blocked: null,
      ipv4Classes: null,
      ipv6Classes: null,
      overflow: null,
    },
    afterPageLoad: {
      state: 'unavailable',
      policyState: 'unavailable',
      ipv4Blocked: null,
      ipv6Blocked: null,
      ipv4Classes: null,
      ipv6Classes: null,
      overflow: null,
    },
  };
  withUnavailableSnapshots[1].uidTcpSocketDiagnostics = {
    beforeApp: emptyUidStartupObservation('unavailable').tcpSocketObservation,
    afterPageLoad:
      emptyUidStartupObservation('unavailable').tcpSocketObservation,
  };
  withUnavailableSnapshots[4].accountState = 'absent';
  withUnavailableSnapshots[4].userdelStatus = 'not_run';
  withUnavailableSnapshots[4].uidLifecycleObservationBeforeUserdel =
    observedEmptyUidLifecycleObservation();
  withUnavailableSnapshots[4].finalUidLifecycleObservation =
    observedEmptyUidLifecycleObservation();
  withUnavailableSnapshots[4].uidProcessObservation =
    uidProcessObservationFromLifecycle(
      withUnavailableSnapshots[4].finalUidLifecycleObservation,
    );
  const summary = sanitizeDesktopStages(withUnavailableSnapshots, sourceSha);

  assert.equal(summary.status, 'failed');
  assert.equal(
    summary.uidEgressPhaseCounters.afterPageLoad.state,
    'unavailable',
  );
  assert.deepEqual(summary.uidEgressPhaseCounters.final, observedCounters());
  assert.equal(
    summary.cleanupDiagnostics.uidProcessObservation.state,
    'observed',
  );
  assert.equal(summary.checks.networkIsolationVerified, 'failed');
  assert.equal(summary.failureCode, 'network-isolation-unverified');
});

test('egress phase deltas preserve fixed classes and go unavailable on decrease or malformed totals', () => {
  const phased = stages();
  phased[1].egressPhaseCounters = {
    beforeApp: observedCounters(),
    afterAppSpawn: countersFromClasses({ udp_dns_port: 2 }),
    afterPageLoad: countersFromClasses({ udp_dns_port: 2, other: 3 }),
  };
  const summary = sanitizeDesktopStages(phased, sourceSha);
  assert.equal(summary.status, 'failed');
  assert.deepEqual(summary.uidEgressPhaseDeltas.beforeAppToAfterAppSpawn, {
    state: 'observed',
    ipv4Blocked: 2,
    ipv6Blocked: 0,
    ipv4Classes: {
      udp_dns_port: 2,
      tcp_dns_port: 0,
      tcp_https_port: 0,
      other: 0,
    },
    ipv6Classes: observedCounters().ipv6Classes,
  });
  assert.equal(
    summary.uidEgressPhaseDeltas.afterAppSpawnToAfterPageLoad.ipv4Blocked,
    3,
  );
  assert.equal(
    summary.uidEgressPhaseDeltas.afterPageLoadToFinal.state,
    'unavailable',
  );
  assert.equal(summary.checks.networkIsolationVerified, 'failed');

  const malformed = stages();
  malformed[1].egressPhaseCounters.afterAppSpawn = {
    ...observedCounters(),
    ipv4Classes: { ...observedCounters().ipv4Classes, udp_dns_port: 1 },
  };
  assert.throws(
    () => sanitizeDesktopStages(malformed, sourceSha),
    /invalid Desktop evidence input/u,
  );
});

test('zero counters cannot hide a missing dual-stack policy snapshot', () => {
  const blocked = stages();
  blocked[1].egressPhaseCounters.afterAppSpawn = observedCounters(
    0,
    0,
    'mismatch',
  );
  const summary = sanitizeDesktopStages(blocked, sourceSha);
  assert.equal(summary.status, 'failed');
  assert.equal(summary.failureCode, 'network-isolation-unverified');
  assert.equal(summary.egressBlocked.ipv4, 0);
  assert.equal(summary.checks.networkIsolationVerified, 'failed');

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

  const failedAccountCleanup = stages();
  failedAccountCleanup[4].isolatedProcesses = 'failed';
  failedAccountCleanup[4].policy = 'retained';
  failedAccountCleanup[4].user = 'failed';
  failedAccountCleanup[4].accountState = 'uid_match';
  failedAccountCleanup[4].userdelStatus = 'failed';
  failedAccountCleanup[4].userdelExitStatus = 8;
  const remainingUidProcesses = {
    ...observedEmptyUidLifecycleObservation(),
    state: 'observed',
    overflow: false,
    uidProcessCount: 2,
    nonZombieProcessCount: 1,
    zombieCount: 1,
    unreadableProcessCount: 0,
    processClassCounts: {
      application: 0,
      browser: 0,
      renderer: 1,
      zygote: 0,
      gpu: 0,
      utility: 0,
      other: 1,
      unknown: 0,
    },
    processRoleCounts: {
      application: 0,
      chromium: 1,
      keyring: 0,
      dbus: 0,
      xvfb: 0,
      other: 1,
      unknown: 0,
    },
  };
  failedAccountCleanup[4].uidLifecycleObservationBeforeUserdel =
    remainingUidProcesses;
  failedAccountCleanup[4].finalUidLifecycleObservation = remainingUidProcesses;
  failedAccountCleanup[4].uidProcessObservation =
    uidProcessObservationFromLifecycle(
      failedAccountCleanup[4].finalUidLifecycleObservation,
    );
  const failedAccountSummary = sanitizeDesktopStages(
    failedAccountCleanup,
    sourceSha,
  );
  assert.equal(failedAccountSummary.status, 'failed');
  assert.equal(failedAccountSummary.failureCode, 'cleanup-failed');
  assert.deepEqual(failedAccountSummary.cleanupDiagnostics, {
    policyStatus: 'retained',
    accountState: 'uid_match',
    userdelStatus: 'failed',
    userdelExitStatus: 8,
    stopDiagnostics: passedStopDiagnostics(),
    uidProcessObservation: {
      state: 'observed',
      uidProcessCount: 2,
      nonZombieProcessCount: 1,
      zombieCount: 1,
      unreadableProcessCount: 0,
    },
  });

  const privateCleanup = stages();
  privateCleanup[4].remainingPid = 1234;
  assert.throws(
    () => sanitizeDesktopStages(privateCleanup, sourceSha),
    /invalid Desktop evidence input/u,
  );

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
  assert.equal(missingSummary.rendererCount, null);
  assert.equal(missingSummary.desktopObservation.childState, 'not-started');
  assert.equal(
    missingSummary.rendererDiagnostics.sandboxReason,
    'not_observed',
  );
  assert.deepEqual(missingSummary.uidEgressPhaseCounters, {
    beforeApp: emptyCounters('not_observed'),
    afterAppSpawn: emptyCounters('not_observed'),
    afterPageLoad: emptyCounters('not_observed'),
    final: observedCounters(),
  });

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

test('Desktop evidence distinguishes pre-cleanup child exit, CDP responses, and page load', () => {
  const spawnFailed = stages();
  spawnFailed[1].status = 'failed';
  spawnFailed[1].failureCode = 'desktop-not-ready';
  spawnFailed[1].rendererCount = null;
  spawnFailed[1].checks.nativeSandbox = 'failed';
  spawnFailed[1].rendererDiagnostics = notObservedRendererDiagnostics();
  spawnFailed[1].uidLifecycleDiagnostics.afterPageLoad =
    emptyUidLifecycleObservation('not_observed');
  spawnFailed[1].desktopObservation = passingDesktopObservation({
    childState: 'spawn-error',
    childSpawnErrorClass: 'missing-executable',
    cdp: {
      versionResponseCount: 0,
      versionOkResponseCount: 0,
      versionLastStatus: null,
      versionJsonValidObserved: false,
      targetListResponseCount: 0,
      targetListOkResponseCount: 0,
      targetListLastStatus: null,
      targetListJsonValidObserved: false,
      pageTargetCount: null,
      fixedOriginPageCount: null,
    },
    pageLoadOutcome: 'not-attempted',
  });
  const spawnSummary = sanitizeDesktopStages(spawnFailed, sourceSha);
  assert.equal(spawnSummary.desktopObservation.childState, 'spawn-error');
  assert.equal(
    spawnSummary.desktopObservation.childSpawnErrorClass,
    'missing-executable',
  );
  assert.notEqual(spawnSummary.desktopObservation.childState, 'running');

  const exited = stages();
  exited[1].status = 'failed';
  exited[1].failureCode = 'desktop-not-ready';
  exited[1].rendererCount = null;
  exited[1].checks.nativeSandbox = 'failed';
  exited[1].rendererDiagnostics = notObservedRendererDiagnostics();
  exited[1].uidLifecycleDiagnostics.afterPageLoad =
    emptyUidLifecycleObservation('not_observed');
  exited[1].desktopObservation = passingDesktopObservation({
    childState: 'exited',
    childExitStatus: 1,
    cdp: {
      versionResponseCount: 1,
      versionOkResponseCount: 1,
      versionLastStatus: 200,
      versionJsonValidObserved: true,
      targetListResponseCount: 1,
      targetListOkResponseCount: 1,
      targetListLastStatus: 200,
      targetListJsonValidObserved: true,
      pageTargetCount: 1,
      fixedOriginPageCount: 0,
    },
    pageLoadOutcome: 'not-attempted',
  });
  const exitedSummary = sanitizeDesktopStages(exited, sourceSha);
  assert.equal(exitedSummary.status, 'failed');
  assert.equal(exitedSummary.desktopObservation.childState, 'exited');
  assert.equal(exitedSummary.desktopObservation.childExitStatus, 1);
  assert.equal(
    exitedSummary.desktopObservation.cdp.versionJsonValidObserved,
    true,
  );
  assert.equal(exitedSummary.desktopObservation.cdp.fixedOriginPageCount, 0);
  assert.equal(exitedSummary.rendererCount, null);

  const timedOutPage = stages();
  timedOutPage[1].status = 'failed';
  timedOutPage[1].failureCode = 'desktop-not-ready';
  timedOutPage[1].rendererCount = null;
  timedOutPage[1].checks.nativeSandbox = 'failed';
  timedOutPage[1].rendererDiagnostics = notObservedRendererDiagnostics();
  timedOutPage[1].uidLifecycleDiagnostics.afterPageLoad =
    emptyUidLifecycleObservation('not_observed');
  timedOutPage[1].desktopObservation = passingDesktopObservation({
    pageLoadOutcome: 'domcontentloaded-timeout',
  });
  const timedOutSummary = sanitizeDesktopStages(timedOutPage, sourceSha);
  assert.equal(
    timedOutSummary.desktopObservation.pageLoadOutcome,
    'domcontentloaded-timeout',
  );

  const impossibleRenderer = stages();
  impossibleRenderer[1].rendererCount = 0;
  assert.throws(
    () => sanitizeDesktopStages(impossibleRenderer, sourceSha),
    /invalid Desktop evidence input/u,
  );
});
