import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ORIGIN = 'vector://vector';
const CHECK_NAMES = Object.freeze([
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
]);
const CHECK_STATES = new Set(['not_run', 'passed', 'failed']);
const STARTUP_FAILURES = new Set([
  'invalid-source-sha',
  'unsupported-runner',
  'package-unavailable',
  'package-mismatch',
  'invalid-profile',
  'secret-service-unavailable',
  'invalid-config',
  'updates-enabled',
  'desktop-not-ready',
  'cdp-not-loopback',
  'unexpected-origin',
  'renderer-sandbox-unconfirmed',
  'node-integration-visible',
  'safe-storage-backend-unconfirmed',
  'probe-internal-error',
]);
const SAFE_STORAGE_MODES = new Set([
  'encrypted',
  'plaintext',
  'basic_text',
  'other',
  'ambiguous',
  'not_observed',
]);
const SAFE_STORAGE_BACKENDS = new Set([
  'gnome_libsecret',
  'kwallet',
  'kwallet5',
  'kwallet6',
  'other',
  'ambiguous',
  'not_observed',
]);
const ENCRYPTED_STORAGE_BACKENDS = new Set([
  'gnome_libsecret',
  'kwallet',
  'kwallet5',
  'kwallet6',
]);
const PROBE_OUTCOMES = new Set([
  'connected',
  'listener-error',
  'protocol-error',
  'probe-error',
  'refused',
  'signaled',
  'socket-error',
  'socket-init-error',
  'spawn-error',
  'timeout',
  'unexpected-exit',
  'uid-mismatch',
  'unreachable',
]);
const PROBE_CHILD_RESULTS = new Set([
  'exited-before-marker',
  'not-run',
  'probe-error',
  'probe-reported',
  'protocol-invalid',
  'signaled',
  'spawn-error',
]);
const PROBE_SIGNALS = new Set([
  'SIGABRT',
  'SIGALRM',
  'SIGBUS',
  'SIGFPE',
  'SIGHUP',
  'SIGILL',
  'SIGINT',
  'SIGKILL',
  'SIGPIPE',
  'SIGQUIT',
  'SIGSEGV',
  'SIGTERM',
  'SIGTRAP',
  'SIGUSR1',
  'SIGUSR2',
  'other',
]);
const PROBE_SPAWN_ERRORS = new Set([
  'missing-executable',
  'other',
  'permission',
  'resource',
  'timeout',
]);
const PROBE_STDERR_CLASSES = new Set([
  'empty',
  'missing-import',
  'missing-script',
  'other',
  'permission',
  'runtime-version',
  'sudo-policy',
  'syntax',
  'unavailable',
]);
const STAGES = new Set([
  'target-uid-preflight',
  'desktop-startup',
  'egress-policy',
  'egress-observation',
  'cleanup',
]);

function hasKeys(value, expected) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join('\0') === [...expected].sort().join('\0')
  );
}

function isStatus(value) {
  return CHECK_STATES.has(value);
}

function count(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 100_000;
}

function validateSafeStorage(value) {
  if (
    !hasKeys(value, ['mode', 'backend', 'markerCount', 'complete']) ||
    !SAFE_STORAGE_MODES.has(value.mode) ||
    !SAFE_STORAGE_BACKENDS.has(value.backend) ||
    !Number.isSafeInteger(value.markerCount) ||
    value.markerCount < 0 ||
    value.markerCount > 2 ||
    typeof value.complete !== 'boolean'
  ) {
    return false;
  }
  if (value.markerCount === 0) {
    return value.mode === 'not_observed' && value.backend === 'not_observed';
  }
  if (value.markerCount === 2) {
    return value.mode === 'ambiguous' && value.backend === 'ambiguous';
  }
  return (
    !['not_observed', 'ambiguous'].includes(value.mode) &&
    !['not_observed', 'ambiguous'].includes(value.backend)
  );
}

function safeStoragePassed(value) {
  return (
    value.complete === true &&
    value.markerCount === 1 &&
    value.mode === 'encrypted' &&
    ENCRYPTED_STORAGE_BACKENDS.has(value.backend)
  );
}

function validateRuntimeFacts(value) {
  if (
    !hasKeys(value, [
      'childResult',
      'childExitStatus',
      'childSignal',
      'spawnErrorClass',
      'stderrClass',
      'markerPresent',
      'uidMatches',
      'nodeVersion',
      'nodeVersionSupported',
      'nodeExecutableRunnable',
      'scriptExists',
      'scriptReadable',
      'startupScriptReadable',
      'configReadable',
      'e2eManifestReadable',
      'playwrightUsable',
      'checkoutControlProtected',
    ]) ||
    ![
      'exited-before-marker',
      'probe-reported',
      'protocol-invalid',
      'signaled',
      'spawn-error',
    ].includes(value.childResult) ||
    (value.childExitStatus !== null &&
      (!Number.isSafeInteger(value.childExitStatus) ||
        value.childExitStatus < 0 ||
        value.childExitStatus > 255)) ||
    (value.childSignal !== null && !PROBE_SIGNALS.has(value.childSignal)) ||
    (value.spawnErrorClass !== null &&
      !PROBE_SPAWN_ERRORS.has(value.spawnErrorClass)) ||
    !PROBE_STDERR_CLASSES.has(value.stderrClass) ||
    typeof value.markerPresent !== 'boolean' ||
    ![null, true, false].includes(value.uidMatches) ||
    (value.nodeVersion !== null &&
      !/^\d+\.\d+\.\d+$/u.test(value.nodeVersion)) ||
    typeof value.nodeVersionSupported !== 'boolean' ||
    ![null, true, false].includes(value.nodeExecutableRunnable) ||
    ![null, true, false].includes(value.scriptExists) ||
    ![null, true, false].includes(value.scriptReadable) ||
    ![null, true, false].includes(value.startupScriptReadable) ||
    ![null, true, false].includes(value.configReadable) ||
    ![null, true, false].includes(value.e2eManifestReadable) ||
    ![null, true, false].includes(value.playwrightUsable) ||
    ![null, true, false].includes(value.checkoutControlProtected)
  ) {
    return false;
  }
  if (value.childResult === 'probe-reported') {
    return (
      value.childExitStatus === 0 &&
      value.childSignal === null &&
      value.spawnErrorClass === null &&
      value.markerPresent &&
      typeof value.uidMatches === 'boolean' &&
      value.nodeVersion !== null &&
      value.nodeVersionSupported ===
        (value.nodeVersion.split('.')[0] === '22') &&
      typeof value.nodeExecutableRunnable === 'boolean' &&
      typeof value.scriptExists === 'boolean' &&
      typeof value.scriptReadable === 'boolean' &&
      typeof value.startupScriptReadable === 'boolean' &&
      typeof value.configReadable === 'boolean' &&
      typeof value.e2eManifestReadable === 'boolean' &&
      typeof value.playwrightUsable === 'boolean' &&
      typeof value.checkoutControlProtected === 'boolean'
    );
  }
  return (
    (value.childResult === 'spawn-error'
      ? value.spawnErrorClass !== null
      : value.spawnErrorClass === null) &&
    (value.childResult === 'signaled'
      ? value.childSignal !== null
      : value.childResult === 'spawn-error' || value.childSignal === null) &&
    value.uidMatches === null &&
    value.nodeVersion === null &&
    !value.nodeVersionSupported &&
    value.nodeExecutableRunnable === null &&
    value.scriptExists === null &&
    value.scriptReadable === null &&
    value.startupScriptReadable === null &&
    value.configReadable === null &&
    value.e2eManifestReadable === null &&
    value.playwrightUsable === null &&
    value.checkoutControlProtected === null
  );
}

function runtimeFactsPassed(value) {
  return (
    value?.childResult === 'probe-reported' &&
    value.uidMatches === true &&
    value.nodeVersionSupported === true &&
    value.nodeExecutableRunnable === true &&
    value.scriptExists === true &&
    value.scriptReadable === true &&
    value.startupScriptReadable === true &&
    value.configReadable === true &&
    value.e2eManifestReadable === true &&
    value.playwrightUsable === true &&
    value.checkoutControlProtected === true
  );
}

function validatePositiveScriptProbe(value) {
  if (
    !hasKeys(value, [
      'listenerBound',
      'childResult',
      'childExitStatus',
      'childSignal',
      'spawnErrorClass',
      'stderrClass',
      'probeMarkerPresent',
      'probeUidMatches',
      'connectAttempted',
      'connectionOutcome',
      'listenerAcceptedCount',
    ])
  ) {
    return false;
  }
  return validateProbeFamily({ ...value, dropCount: null });
}

function positiveScriptProbePassed(value) {
  return (
    value?.listenerBound === true &&
    value.childResult === 'probe-reported' &&
    value.probeMarkerPresent === true &&
    value.probeUidMatches === true &&
    value.connectAttempted === true &&
    value.connectionOutcome === 'connected' &&
    value.listenerAcceptedCount === 1
  );
}

function validateTargetUidPreflight(record) {
  if (
    !hasKeys(record, ['phase', 'status', 'runtimeFacts', 'scriptProbe']) ||
    record.phase !== 'target-uid-preflight' ||
    !['passed', 'failed'].includes(record.status)
  ) {
    return false;
  }
  if (
    record.status === 'failed' &&
    record.runtimeFacts === null &&
    record.scriptProbe === null
  ) {
    return true;
  }
  if (
    !validateRuntimeFacts(record.runtimeFacts) ||
    !validatePositiveScriptProbe(record.scriptProbe)
  ) {
    return false;
  }
  const passed =
    runtimeFactsPassed(record.runtimeFacts) &&
    positiveScriptProbePassed(record.scriptProbe);
  return record.status === (passed ? 'passed' : 'failed');
}

function validateStartup(record, sourceSha) {
  if (
    !hasKeys(record, [
      'phase',
      'status',
      'failureCode',
      'sourceSha',
      'package',
      'runtime',
      'origin',
      'safeStorage',
      'rendererCount',
      'checks',
    ]) ||
    record.phase !== 'desktop-startup' ||
    !['passed', 'failed'].includes(record.status) ||
    (record.failureCode !== null &&
      !STARTUP_FAILURES.has(record.failureCode)) ||
    record.sourceSha !== sourceSha ||
    record.origin !== ORIGIN ||
    !Number.isSafeInteger(record.rendererCount) ||
    record.rendererCount < 0 ||
    record.rendererCount > 2 ||
    !hasKeys(record.package, ['version', 'architecture', 'sha256']) ||
    ![null, '1.12.30'].includes(record.package.version) ||
    ![null, 'amd64'].includes(record.package.architecture) ||
    (record.package.sha256 !== null &&
      !/^[0-9a-f]{64}$/u.test(record.package.sha256)) ||
    !hasKeys(record.runtime, [
      'probeNode',
      'embeddedNode',
      'electron',
      'chromium',
      'runner',
    ]) ||
    !/^\d+\.\d+\.\d+$/u.test(record.runtime.probeNode) ||
    record.runtime.embeddedNode !== null ||
    (record.runtime.electron !== null &&
      !/^\d+\.\d+\.\d+$/u.test(record.runtime.electron)) ||
    ![null, /^\d+\.\d+\.\d+(?:\.\d+)?$/u].some((pattern) =>
      pattern === null
        ? record.runtime.chromium === null
        : pattern.test(record.runtime.chromium ?? ''),
    ) ||
    !validateSafeStorage(record.safeStorage) ||
    record.runtime.runner !== 'ubuntu-24.04' ||
    !hasKeys(record.checks, CHECK_NAMES) ||
    Object.values(record.checks).some((value) => !isStatus(value))
  ) {
    return false;
  }
  const storagePassed = safeStoragePassed(record.safeStorage);
  if (
    (record.checks.safeStorageBackend === 'passed') !== storagePassed ||
    (record.checks.safeStorageBackend === 'not_run' &&
      record.safeStorage.markerCount > 0)
  ) {
    return false;
  }
  if (
    record.status === 'passed' &&
    (record.failureCode !== null ||
      record.rendererCount < 1 ||
      Object.values(record.checks).some((value) => value !== 'passed') ||
      !safeStoragePassed(record.safeStorage) ||
      record.package.version !== '1.12.30' ||
      record.package.architecture !== 'amd64' ||
      record.package.sha256 === null ||
      record.runtime.electron === null ||
      record.runtime.chromium === null)
  ) {
    return false;
  }
  return record.status === 'failed' ? record.failureCode !== null : true;
}

function validatePolicy(record) {
  if (
    !hasKeys(record, ['phase', 'status', 'negativeTest', 'diagnostic']) ||
    record.phase !== 'egress-policy' ||
    !['passed', 'failed', 'not_run'].includes(record.status) ||
    !['passed', 'failed', 'not_run'].includes(record.negativeTest) ||
    (record.diagnostic !== null && !validateNegativeProbe(record.diagnostic))
  ) {
    return false;
  }
  if (record.negativeTest === 'passed' && record.diagnostic?.passed !== true) {
    return false;
  }
  if (record.negativeTest === 'failed' && record.diagnostic?.passed === true) {
    return false;
  }
  if (record.negativeTest === 'not_run' && record.diagnostic !== null) {
    return false;
  }
  if (record.status === 'not_run' && record.negativeTest !== 'not_run') {
    return false;
  }
  return record.status !== 'passed' || record.negativeTest === 'passed';
}

function validateProbeFamily(value) {
  if (
    !hasKeys(value, [
      'childResult',
      'childExitStatus',
      'childSignal',
      'spawnErrorClass',
      'stderrClass',
      'listenerBound',
      'probeMarkerPresent',
      'probeUidMatches',
      'connectAttempted',
      'connectionOutcome',
      'listenerAcceptedCount',
      'dropCount',
    ]) ||
    !PROBE_CHILD_RESULTS.has(value.childResult) ||
    (value.childExitStatus !== null &&
      (!Number.isSafeInteger(value.childExitStatus) ||
        value.childExitStatus < 0 ||
        value.childExitStatus > 255)) ||
    (value.childSignal !== null && !PROBE_SIGNALS.has(value.childSignal)) ||
    (value.spawnErrorClass !== null &&
      !PROBE_SPAWN_ERRORS.has(value.spawnErrorClass)) ||
    !PROBE_STDERR_CLASSES.has(value.stderrClass) ||
    typeof value.listenerBound !== 'boolean' ||
    typeof value.probeMarkerPresent !== 'boolean' ||
    ![null, true, false].includes(value.probeUidMatches) ||
    typeof value.connectAttempted !== 'boolean' ||
    !PROBE_OUTCOMES.has(value.connectionOutcome) ||
    (value.listenerAcceptedCount !== null &&
      (!Number.isSafeInteger(value.listenerAcceptedCount) ||
        value.listenerAcceptedCount < 0 ||
        value.listenerAcceptedCount > 2)) ||
    (value.dropCount !== null && !count(value.dropCount))
  ) {
    return false;
  }
  if (value.childResult === 'not-run') {
    return (
      !value.listenerBound &&
      value.listenerAcceptedCount === null &&
      value.childExitStatus === null &&
      value.childSignal === null &&
      value.spawnErrorClass === null &&
      value.stderrClass === 'empty' &&
      !value.probeMarkerPresent &&
      value.probeUidMatches === null &&
      !value.connectAttempted &&
      value.connectionOutcome === 'listener-error'
    );
  }
  if (!value.listenerBound || value.listenerAcceptedCount === null)
    return false;
  if (value.childResult === 'spawn-error') {
    return (
      value.spawnErrorClass !== null &&
      value.probeUidMatches === null &&
      !value.connectAttempted &&
      value.connectionOutcome === 'spawn-error'
    );
  }
  if (value.childResult === 'signaled') {
    return (
      value.childExitStatus === null &&
      value.childSignal !== null &&
      value.spawnErrorClass === null &&
      value.probeUidMatches === null &&
      !value.connectAttempted &&
      value.connectionOutcome === 'signaled'
    );
  }
  if (value.childResult === 'exited-before-marker') {
    return (
      value.childSignal === null &&
      value.spawnErrorClass === null &&
      !value.probeMarkerPresent &&
      value.probeUidMatches === null &&
      !value.connectAttempted &&
      value.connectionOutcome === 'unexpected-exit'
    );
  }
  if (value.childResult === 'protocol-invalid') {
    return (
      value.childSignal === null &&
      value.spawnErrorClass === null &&
      value.probeUidMatches === null &&
      !value.connectAttempted &&
      value.connectionOutcome === 'protocol-error'
    );
  }
  if (value.childResult === 'probe-error') {
    return (
      value.childExitStatus === null &&
      value.childSignal === null &&
      value.spawnErrorClass === null &&
      value.stderrClass === 'unavailable' &&
      !value.probeMarkerPresent &&
      value.probeUidMatches === null &&
      !value.connectAttempted &&
      value.connectionOutcome === 'probe-error'
    );
  }
  if (
    value.childResult !== 'probe-reported' ||
    !value.probeMarkerPresent ||
    value.childSignal !== null ||
    value.spawnErrorClass !== null
  ) {
    return false;
  }
  const expectedExitStatus = {
    connected: 0,
    timeout: 2,
    'uid-mismatch': 3,
    refused: 4,
    unreachable: 5,
    'socket-error': 6,
    'socket-init-error': 7,
  }[value.connectionOutcome];
  if (value.childExitStatus !== expectedExitStatus) return false;
  if (value.connectionOutcome === 'uid-mismatch') {
    return value.probeUidMatches === false && !value.connectAttempted;
  }
  const connectionAttempted = value.connectionOutcome !== 'socket-init-error';
  return (
    value.probeUidMatches === true &&
    value.connectAttempted === connectionAttempted
  );
}

function probeFamilyPassed(value) {
  return (
    value.listenerBound === true &&
    value.childResult === 'probe-reported' &&
    value.probeMarkerPresent === true &&
    value.probeUidMatches === true &&
    value.connectAttempted === true &&
    value.connectionOutcome === 'timeout' &&
    value.listenerAcceptedCount === 0 &&
    Number.isSafeInteger(value.dropCount) &&
    value.dropCount > 0
  );
}

function validateNegativeProbe(value) {
  if (
    !hasKeys(value, ['passed', 'ipv4', 'ipv6']) ||
    typeof value.passed !== 'boolean' ||
    !validateProbeFamily(value.ipv4) ||
    !validateProbeFamily(value.ipv6)
  ) {
    return false;
  }
  return (
    value.passed ===
    (probeFamilyPassed(value.ipv4) && probeFamilyPassed(value.ipv6))
  );
}

function validateObservation(record) {
  return (
    hasKeys(record, ['phase', 'status', 'ipv4Blocked', 'ipv6Blocked']) &&
    record.phase === 'egress-observation' &&
    ['passed', 'failed'].includes(record.status) &&
    (record.ipv4Blocked === null || count(record.ipv4Blocked)) &&
    (record.ipv6Blocked === null || count(record.ipv6Blocked)) &&
    (record.status === 'passed'
      ? count(record.ipv4Blocked) && count(record.ipv6Blocked)
      : true)
  );
}

function validateCleanup(record) {
  return (
    hasKeys(record, [
      'phase',
      'isolatedProcesses',
      'policy',
      'user',
      'profile',
      'aptSource',
    ]) &&
    record.phase === 'cleanup' &&
    ['isolatedProcesses', 'policy', 'user', 'profile', 'aptSource'].every(
      (name) => ['passed', 'failed', 'not_run'].includes(record[name]),
    )
  );
}

function defaultChecks() {
  return Object.fromEntries(
    [
      ...CHECK_NAMES,
      'isolatedNodePreflight',
      'egressPolicy',
      'negativeEgress',
      'zeroBlockedEgress',
      'cleanupIsolatedProcesses',
      'cleanupPolicy',
      'cleanupUser',
      'cleanupProfile',
      'cleanupAptSource',
    ].map((name) => [name, 'not_run']),
  );
}

function setFailure(candidate, fallback) {
  if (candidate?.failureCode) return candidate.failureCode;
  if (candidate?.status === 'failed') return fallback;
  return null;
}

export function sanitizeDesktopStages(records, sourceSha) {
  if (
    !/^[0-9a-f]{40}$/u.test(sourceSha) ||
    !Array.isArray(records) ||
    records.length > 5
  ) {
    throw new Error('invalid Desktop evidence input');
  }
  const byPhase = new Map();
  for (const record of records) {
    if (
      record === null ||
      typeof record !== 'object' ||
      Array.isArray(record) ||
      !STAGES.has(record.phase)
    ) {
      throw new Error('invalid Desktop evidence input');
    }
    if (byPhase.has(record.phase))
      throw new Error('duplicate Desktop evidence phase');
    const valid =
      record.phase === 'target-uid-preflight'
        ? validateTargetUidPreflight(record)
        : record.phase === 'desktop-startup'
          ? validateStartup(record, sourceSha)
          : record.phase === 'egress-policy'
            ? validatePolicy(record)
            : record.phase === 'egress-observation'
              ? validateObservation(record)
              : validateCleanup(record);
    if (!valid) throw new Error('invalid Desktop evidence input');
    byPhase.set(record.phase, record);
  }

  const targetUidPreflight = byPhase.get('target-uid-preflight');
  const startup = byPhase.get('desktop-startup');
  const policy = byPhase.get('egress-policy');
  const observation = byPhase.get('egress-observation');
  const cleanup = byPhase.get('cleanup');
  const checks = defaultChecks();
  if (targetUidPreflight) {
    checks.isolatedNodePreflight = targetUidPreflight.status;
  }
  if (startup) Object.assign(checks, startup.checks);
  if (policy) {
    checks.egressPolicy = policy.status;
    checks.negativeEgress = policy.negativeTest;
  }
  if (observation?.status === 'passed') {
    checks.zeroBlockedEgress =
      observation.ipv4Blocked === 0 && observation.ipv6Blocked === 0
        ? 'passed'
        : 'failed';
  } else if (observation?.status === 'failed') {
    checks.zeroBlockedEgress = 'failed';
  }
  if (cleanup) {
    checks.cleanupIsolatedProcesses = cleanup.isolatedProcesses;
    checks.cleanupPolicy = cleanup.policy;
    checks.cleanupUser = cleanup.user;
    checks.cleanupProfile = cleanup.profile;
    checks.cleanupAptSource = cleanup.aptSource;
  }

  const allPassed =
    targetUidPreflight?.status === 'passed' &&
    startup?.status === 'passed' &&
    policy?.status === 'passed' &&
    policy.negativeTest === 'passed' &&
    observation?.status === 'passed' &&
    observation.ipv4Blocked === 0 &&
    observation.ipv6Blocked === 0 &&
    cleanup !== undefined &&
    ['isolatedProcesses', 'policy', 'user', 'profile', 'aptSource'].every(
      (name) => cleanup[name] === 'passed',
    ) &&
    Object.values(checks).every((value) => value === 'passed');
  const failureCode = allPassed
    ? null
    : ((targetUidPreflight?.status === 'failed'
        ? 'isolated-node-preflight-failed'
        : null) ??
      setFailure(startup, 'startup-observation-missing') ??
      (policy?.status === 'failed' ? 'egress-policy-failed' : null) ??
      (observation?.status === 'failed' ||
      (observation?.ipv4Blocked ?? 0) > 0 ||
      (observation?.ipv6Blocked ?? 0) > 0
        ? 'blocked-egress'
        : null) ??
      (cleanup &&
      ['isolatedProcesses', 'policy', 'user', 'profile', 'aptSource'].some(
        (name) => cleanup[name] === 'failed',
      )
        ? 'cleanup-failed'
        : 'evidence-incomplete'));

  return {
    schemaVersion: 5,
    sourceSha,
    status: allPassed ? 'passed' : 'failed',
    failureCode,
    package: startup?.package ?? {
      version: null,
      architecture: null,
      sha256: null,
    },
    runtime: startup?.runtime ?? {
      probeNode: null,
      embeddedNode: null,
      electron: null,
      chromium: null,
      runner: 'ubuntu-24.04',
    },
    origin: ORIGIN,
    safeStorage: startup?.safeStorage ?? {
      mode: 'not_observed',
      backend: 'not_observed',
      markerCount: 0,
      complete: false,
    },
    rendererCount: startup?.rendererCount ?? 0,
    targetUidPreflight: targetUidPreflight ?? null,
    egressBlocked: {
      ipv4: observation?.ipv4Blocked ?? null,
      ipv6: observation?.ipv6Blocked ?? null,
    },
    egressProbe: policy?.diagnostic ?? null,
    checks,
  };
}

export function validDesktopSummary(value) {
  return (
    hasKeys(value, [
      'schemaVersion',
      'sourceSha',
      'status',
      'failureCode',
      'package',
      'runtime',
      'origin',
      'safeStorage',
      'rendererCount',
      'targetUidPreflight',
      'egressBlocked',
      'egressProbe',
      'checks',
    ]) &&
    value.schemaVersion === 5 &&
    /^[0-9a-f]{40}$/u.test(value.sourceSha) &&
    ['passed', 'failed'].includes(value.status) &&
    (value.failureCode === null ||
      [
        'blocked-egress',
        'cleanup-failed',
        'egress-policy-failed',
        'evidence-incomplete',
        'isolated-node-preflight-failed',
        'startup-observation-missing',
        ...STARTUP_FAILURES,
      ].includes(value.failureCode)) &&
    hasKeys(value.package, ['version', 'architecture', 'sha256']) &&
    hasKeys(value.runtime, [
      'probeNode',
      'embeddedNode',
      'electron',
      'chromium',
      'runner',
    ]) &&
    (value.package.version === null || value.package.version === '1.12.30') &&
    (value.package.architecture === null ||
      value.package.architecture === 'amd64') &&
    (value.package.sha256 === null ||
      /^[0-9a-f]{64}$/u.test(value.package.sha256)) &&
    (value.runtime.probeNode === null ||
      /^\d+\.\d+\.\d+$/u.test(value.runtime.probeNode)) &&
    value.runtime.embeddedNode === null &&
    (value.runtime.electron === null ||
      /^\d+\.\d+\.\d+$/u.test(value.runtime.electron)) &&
    (value.runtime.chromium === null ||
      /^\d+\.\d+\.\d+(?:\.\d+)?$/u.test(value.runtime.chromium)) &&
    validateSafeStorage(value.safeStorage) &&
    (value.targetUidPreflight === null ||
      validateTargetUidPreflight(value.targetUidPreflight)) &&
    value.checks?.isolatedNodePreflight ===
      (value.targetUidPreflight?.status ?? 'not_run') &&
    value.runtime.runner === 'ubuntu-24.04' &&
    value.origin === ORIGIN &&
    Number.isSafeInteger(value.rendererCount) &&
    value.rendererCount >= 0 &&
    value.rendererCount <= 2 &&
    hasKeys(value.egressBlocked, ['ipv4', 'ipv6']) &&
    ['ipv4', 'ipv6'].every(
      (family) =>
        value.egressBlocked[family] === null ||
        count(value.egressBlocked[family]),
    ) &&
    (value.egressProbe === null || validateNegativeProbe(value.egressProbe)) &&
    hasKeys(value.checks, [
      ...CHECK_NAMES,
      'isolatedNodePreflight',
      'egressPolicy',
      'negativeEgress',
      'zeroBlockedEgress',
      'cleanupIsolatedProcesses',
      'cleanupPolicy',
      'cleanupUser',
      'cleanupProfile',
      'cleanupAptSource',
    ]) &&
    Object.values(value.checks).every(isStatus) &&
    (value.status === 'passed'
      ? value.failureCode === null &&
        Object.values(value.checks).every((state) => state === 'passed') &&
        value.targetUidPreflight?.status === 'passed' &&
        safeStoragePassed(value.safeStorage) &&
        value.runtime.electron !== null &&
        value.runtime.chromium !== null &&
        value.egressBlocked.ipv4 === 0 &&
        value.egressBlocked.ipv6 === 0
      : value.failureCode !== null)
  );
}

function sanitizeFile(path, sourceSha) {
  try {
    const content = readFileSync(path, 'utf8');
    const records = content
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const summary = sanitizeDesktopStages(records, sourceSha);
    if (!validDesktopSummary(summary)) throw new Error('invalid summary');
    return summary;
  } catch {
    throw new Error('Desktop evidence could not be sanitized');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const [stagePath, sourceSha] = process.argv.slice(2);
    const summary = sanitizeFile(stagePath, sourceSha);
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } catch {
    process.stderr.write(
      'Desktop evidence did not match the fixed summary schema.\n',
    );
    process.exitCode = 1;
  }
}
