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
const MAX_DIAGNOSTIC_COUNT = 100;
const SANDBOX_DIAGNOSTIC_STATES = new Set(['not_observed', 'observed']);
const SANDBOX_DIAGNOSTIC_REASONS = new Set([
  'not_observed',
  'passed',
  'application_process_missing',
  'unreadable_process_member',
  'uid_mismatch',
  'no_sandbox_flag',
  'renderer_missing',
  'renderer_ownership_unconfirmed',
  'seccomp_unconfirmed',
  'no_new_privs_unconfirmed',
]);
const SANDBOX_DIAGNOSTIC_VALUES = new Set([
  'not_observed',
  'unavailable',
  'enabled',
  'disabled',
  'mixed',
]);
const COUNTER_OBSERVATION_STATES = new Set([
  'not_observed',
  'unavailable',
  'partial',
  'observed',
]);
const COUNTER_POLICY_STATES = new Set([
  'not_observed',
  'verified',
  'mismatch',
  'unavailable',
]);
const EGRESS_DROP_COUNTER_CLASSES = Object.freeze([
  'udp_dns_port',
  'tcp_dns_port',
  'tcp_https_port',
  'other',
]);
const CDP_RENDERER_OBSERVATION_STATES = new Set([
  'not_observed',
  'unavailable',
  'partial',
  'observed',
]);
const UID_PROCESS_OBSERVATION_STATES = new Set([
  'not_observed',
  'unavailable',
  'partial',
  'observed',
]);
const UID_LIFECYCLE_STATES = new Set([
  'not_observed',
  'unavailable',
  'partial',
  'observed',
]);
const UID_LIFECYCLE_PROCESS_CLASSES = Object.freeze([
  'application',
  'browser',
  'renderer',
  'zygote',
  'gpu',
  'utility',
  'other',
  'unknown',
]);
const UID_LIFECYCLE_PROCESS_ROLES = Object.freeze([
  'application',
  'chromium',
  'keyring',
  'dbus',
  'xvfb',
  'other',
  'unknown',
]);
const UID_STOP_INSPECTION_STATES = new Set([
  'not_attempted',
  'unavailable',
  'absent',
  'present',
]);
const UID_STOP_SIGNAL_OUTCOMES = new Set([
  'not_attempted',
  'unavailable',
  'no_process',
  'failed',
  'sent',
]);
const UID_LIFECYCLE_RELATION_STATES = new Set([
  'not_observed',
  'unavailable',
  'partial',
  'observed',
]);
const UID_LIFECYCLE_APP_IDENTITY_STATES = new Set([
  'not_observed',
  'unavailable',
  'verified',
]);
const UID_TCP_SOCKET_STATES = new Set([
  'not_observed',
  'unavailable',
  'partial',
  'observed',
]);
const UID_TCP_PROCESS_ROLES = Object.freeze([
  'application',
  'browser',
  'renderer',
  'zygote',
  'gpu',
  'utility',
  'other',
  'shared',
  'unknown',
]);
const UID_TCP_PEER_CATEGORIES = new Set([
  'matrix_loopback',
  'loopback_other',
  'non_loopback_web',
  'non_loopback_other',
  'cdp_loopback_listener',
  'cdp_non_loopback_listener',
  'other_listener',
  'no_peer',
  'unknown',
]);
const UID_TCP_STATE_CATEGORIES = new Set([
  'established',
  'syn_sent',
  'syn_received',
  'fin_wait',
  'time_wait',
  'close_wait',
  'last_ack',
  'closing',
  'listening',
  'closed',
  'unknown',
]);
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
const SECRET_SERVICE_STEPS = new Set([
  'not-run',
  'dbus-session',
  'daemon-start',
  'secret-store',
  'secret-lookup',
  'secret-clear',
  'keyring-file',
  'none',
]);
const SECRET_COMMAND_OUTCOMES = new Set([
  'not-run',
  'passed',
  'spawn-error',
  'signaled',
  'nonzero-exit',
  'timeout',
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
const DESKTOP_CHILD_STATES = new Set([
  'not-started',
  'launch-timeout',
  'running',
  'exited',
  'signaled',
  'spawn-error',
]);
const DESKTOP_CHILD_SPAWN_ERRORS = new Set([
  'missing-executable',
  'other',
  'permission',
  'resource',
]);
const DESKTOP_PAGE_LOAD_OUTCOMES = new Set([
  'not-attempted',
  'domcontentloaded',
  'domcontentloaded-timeout',
  'domcontentloaded-failed',
]);
const CONFIG_IN_MEMORY_STATES = new Set([
  'not_observed',
  'unavailable',
  'observed',
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
const UID_STOP_CENSUS_OUTCOMES = new Set([
  'observed',
  'spawn-error',
  'timeout',
  'nonzero-exit',
  'signal',
  'overflow',
  'malformed',
  'unavailable',
]);
const UID_STOP_STDERR_OUTCOMES = new Set([
  'absent',
  'not_attempted',
  'other',
  'sudo-launch-failure',
  'timeout-launch-failure',
  'timeout-permission',
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

function diagnosticCount(value) {
  return (
    Number.isSafeInteger(value) && value >= 0 && value <= MAX_DIAGNOSTIC_COUNT
  );
}

function validateCounterObservation(value) {
  if (
    !hasKeys(value, [
      'state',
      'policyState',
      'ipv4Blocked',
      'ipv6Blocked',
      'ipv4Classes',
      'ipv6Classes',
      'overflow',
    ]) ||
    !COUNTER_OBSERVATION_STATES.has(value.state) ||
    !COUNTER_POLICY_STATES.has(value.policyState) ||
    (value.state === 'not_observed'
      ? value.policyState !== 'not_observed'
      : value.policyState === 'not_observed')
  ) {
    return false;
  }
  if (value.state === 'observed' || value.state === 'partial') {
    if (
      !count(value.ipv4Blocked) ||
      !count(value.ipv6Blocked) ||
      !hasKeys(value.ipv4Classes, EGRESS_DROP_COUNTER_CLASSES) ||
      !hasKeys(value.ipv6Classes, EGRESS_DROP_COUNTER_CLASSES) ||
      EGRESS_DROP_COUNTER_CLASSES.some(
        (name) =>
          !count(value.ipv4Classes[name]) || !count(value.ipv6Classes[name]),
      ) ||
      typeof value.overflow !== 'boolean' ||
      value.state !== (value.overflow ? 'partial' : 'observed')
    ) {
      return false;
    }
    const ipv4ClassTotal = EGRESS_DROP_COUNTER_CLASSES.reduce(
      (total, name) => total + value.ipv4Classes[name],
      0,
    );
    const ipv6ClassTotal = EGRESS_DROP_COUNTER_CLASSES.reduce(
      (total, name) => total + value.ipv6Classes[name],
      0,
    );
    const ipv4ClassTotalMatches =
      value.overflow && value.ipv4Blocked === 100_000
        ? ipv4ClassTotal >= value.ipv4Blocked
        : ipv4ClassTotal === value.ipv4Blocked;
    const ipv6ClassTotalMatches =
      value.overflow && value.ipv6Blocked === 100_000
        ? ipv6ClassTotal >= value.ipv6Blocked
        : ipv6ClassTotal === value.ipv6Blocked;
    return value.overflow
      ? (value.ipv4Blocked === 100_000 || value.ipv6Blocked === 100_000) &&
          ipv4ClassTotalMatches &&
          ipv6ClassTotalMatches
      : ipv4ClassTotalMatches && ipv6ClassTotalMatches;
  }
  return (
    value.ipv4Blocked === null &&
    value.ipv6Blocked === null &&
    value.ipv4Classes === null &&
    value.ipv6Classes === null &&
    value.overflow === null
  );
}

function validateEgressPhaseCounters(value) {
  return (
    hasKeys(value, ['beforeApp', 'afterAppSpawn', 'afterPageLoad']) &&
    validateCounterObservation(value.beforeApp) &&
    validateCounterObservation(value.afterAppSpawn) &&
    validateCounterObservation(value.afterPageLoad)
  );
}

export function sanitizeEgressCounterObservation(input) {
  let value = input;
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input);
    } catch {
      return emptyCounterObservation('unavailable');
    }
  }
  if (!validateCounterObservation(value)) {
    const policyState =
      COUNTER_POLICY_STATES.has(value?.policyState) &&
      value.policyState !== 'not_observed'
        ? value.policyState
        : 'unavailable';
    return emptyCounterObservation('unavailable', policyState);
  }
  return {
    state: value.state,
    policyState: value.policyState,
    ipv4Blocked: value.ipv4Blocked,
    ipv6Blocked: value.ipv6Blocked,
    ipv4Classes:
      value.ipv4Classes === null
        ? null
        : Object.fromEntries(
            EGRESS_DROP_COUNTER_CLASSES.map((name) => [
              name,
              value.ipv4Classes[name],
            ]),
          ),
    ipv6Classes:
      value.ipv6Classes === null
        ? null
        : Object.fromEntries(
            EGRESS_DROP_COUNTER_CLASSES.map((name) => [
              name,
              value.ipv6Classes[name],
            ]),
          ),
    overflow: value.overflow,
  };
}

export function acknowledgedEgressCounterObservation(
  snapshot,
  acknowledgement,
) {
  if (acknowledgement === 'not_observed') {
    return emptyCounterObservation('not_observed');
  }
  const sanitized = sanitizeEgressCounterObservation(snapshot);
  if (
    acknowledgement !== 'observed' ||
    !['observed', 'partial'].includes(sanitized.state)
  ) {
    return emptyCounterObservation('unavailable');
  }
  return sanitized;
}

function validateRendererDiagnostics(value) {
  if (
    !hasKeys(value, [
      'state',
      'sandboxReason',
      'applicationProcessObserved',
      'processGroupCount',
      'unreadableProcessCount',
      'uidMismatchCount',
      'noSandboxFlagCount',
      'rendererCount',
      'seccompState',
      'noNewPrivsState',
    ]) ||
    !SANDBOX_DIAGNOSTIC_STATES.has(value.state) ||
    !SANDBOX_DIAGNOSTIC_REASONS.has(value.sandboxReason) ||
    !SANDBOX_DIAGNOSTIC_VALUES.has(value.seccompState) ||
    !SANDBOX_DIAGNOSTIC_VALUES.has(value.noNewPrivsState)
  ) {
    return false;
  }
  if (value.state === 'not_observed') {
    return (
      value.sandboxReason === 'not_observed' &&
      value.applicationProcessObserved === null &&
      value.processGroupCount === null &&
      value.unreadableProcessCount === null &&
      value.uidMismatchCount === null &&
      value.noSandboxFlagCount === null &&
      value.rendererCount === null &&
      value.seccompState === 'not_observed' &&
      value.noNewPrivsState === 'not_observed'
    );
  }
  if (
    value.sandboxReason === 'not_observed' ||
    typeof value.applicationProcessObserved !== 'boolean' ||
    !diagnosticCount(value.processGroupCount) ||
    !diagnosticCount(value.unreadableProcessCount) ||
    !diagnosticCount(value.uidMismatchCount) ||
    !diagnosticCount(value.noSandboxFlagCount) ||
    !diagnosticCount(value.rendererCount) ||
    value.seccompState === 'not_observed' ||
    value.noNewPrivsState === 'not_observed'
  ) {
    return false;
  }
  return (
    value.sandboxReason !== 'passed' ||
    (value.applicationProcessObserved &&
      value.unreadableProcessCount === 0 &&
      value.uidMismatchCount === 0 &&
      value.noSandboxFlagCount === 0 &&
      value.rendererCount > 0 &&
      value.seccompState === 'enabled' &&
      value.noNewPrivsState === 'enabled')
  );
}

function matchesTrustedRendererSandbox(processGroup, lifecycle, rendererCount) {
  const resolved = resolveTrustedRendererSandbox(processGroup, lifecycle);
  return (
    resolved.passed &&
    rendererCount === resolved.rendererCount &&
    Object.keys(resolved.rendererDiagnostics).every(
      (field) => processGroup[field] === resolved.rendererDiagnostics[field],
    )
  );
}

function trustedRendererSandboxReason(processGroup, lifecycle) {
  if (!validateRendererDiagnostics(processGroup)) {
    return 'renderer_ownership_unconfirmed';
  }
  if (processGroup.state === 'not_observed') {
    return 'renderer_ownership_unconfirmed';
  }
  if (!processGroup.applicationProcessObserved) {
    return 'application_process_missing';
  }
  if (processGroup.unreadableProcessCount > 0) {
    return 'unreadable_process_member';
  }
  if (processGroup.uidMismatchCount > 0) return 'uid_mismatch';
  if (processGroup.noSandboxFlagCount > 0) return 'no_sandbox_flag';
  if (
    ['disabled', 'mixed'].includes(processGroup.seccompState) ||
    ['disabled', 'mixed'].includes(processGroup.noNewPrivsState)
  ) {
    return 'renderer_ownership_unconfirmed';
  }
  if (
    ![
      'passed',
      'renderer_missing',
      'seccomp_unconfirmed',
      'no_new_privs_unconfirmed',
    ].includes(processGroup.sandboxReason)
  ) {
    return 'renderer_ownership_unconfirmed';
  }
  if (
    (processGroup.sandboxReason === 'renderer_missing' &&
      (processGroup.rendererCount !== 0 ||
        processGroup.seccompState !== 'unavailable' ||
        processGroup.noNewPrivsState !== 'unavailable')) ||
    (processGroup.sandboxReason !== 'renderer_missing' &&
      processGroup.rendererCount === 0) ||
    (processGroup.sandboxReason === 'seccomp_unconfirmed' &&
      processGroup.seccompState === 'enabled') ||
    (processGroup.sandboxReason === 'no_new_privs_unconfirmed' &&
      (processGroup.seccompState !== 'enabled' ||
        processGroup.noNewPrivsState === 'enabled'))
  ) {
    return 'renderer_ownership_unconfirmed';
  }
  if (
    !validateUidLifecycleObservation(lifecycle) ||
    lifecycle.state !== 'observed' ||
    lifecycle.overflow ||
    lifecycle.unreadableProcessCount > 0 ||
    lifecycle.unattributedProcessCount > 0
  ) {
    return 'renderer_ownership_unconfirmed';
  }

  const renderer = lifecycle.cdpRendererObservation;
  if (renderer.state !== 'observed' || renderer.overflow) {
    return 'renderer_ownership_unconfirmed';
  }
  if (renderer.rendererCount === 0) return 'renderer_missing';
  if (renderer.uidMismatchCount > 0) return 'uid_mismatch';
  if (renderer.unreadableCount > 0 || renderer.missingCount > 0) {
    return 'unreadable_process_member';
  }
  if (renderer.noSandboxFlagCount > 0) return 'no_sandbox_flag';
  if (
    renderer.appIdentityState !== 'verified' ||
    renderer.uidMatchCount !== renderer.rendererCount ||
    renderer.appDescendantCount !== renderer.rendererCount ||
    renderer.appDescendantUnobservedCount !== 0 ||
    renderer.appProcessGroupCount !== renderer.rendererCount ||
    renderer.appProcessGroupUnobservedCount !== 0 ||
    renderer.appDescendantAndProcessGroupCount !== renderer.rendererCount
  ) {
    return 'renderer_ownership_unconfirmed';
  }
  const ownership = lifecycle.rendererOwnership;
  if (
    ownership.appIdentityState !== 'verified' ||
    ownership.state !== 'observed' ||
    ownership.securityCoverageState !== 'observed' ||
    ownership.otherUidAppDescendantCount !== 0 ||
    ownership.rendererCount !== renderer.argvRendererMatchCount ||
    ownership.appDescendantCount !== ownership.rendererCount ||
    ownership.appProcessGroupCount !== ownership.rendererCount ||
    ownership.appDescendantAndProcessGroupCount !== ownership.rendererCount ||
    ownership.appDescendantOnlyCount !== 0 ||
    ownership.appProcessGroupOnlyCount !== 0 ||
    ownership.noCurrentLinkCount !== 0 ||
    (ownership.rendererCount === 0 &&
      (lifecycle.seccompState !== 'unavailable' ||
        lifecycle.noNewPrivsState !== 'unavailable')) ||
    (ownership.rendererCount > 0 &&
      (lifecycle.seccompState !== 'enabled' ||
        lifecycle.noNewPrivsState !== 'enabled'))
  ) {
    return 'renderer_ownership_unconfirmed';
  }
  if (renderer.seccompState !== 'enabled') return 'seccomp_unconfirmed';
  if (renderer.noNewPrivsState !== 'enabled') {
    return 'no_new_privs_unconfirmed';
  }
  return 'passed';
}

export function resolveTrustedRendererSandbox(processGroup, lifecycle) {
  const validProcessGroup = validateRendererDiagnostics(processGroup);
  const reason = trustedRendererSandboxReason(processGroup, lifecycle);
  if (!validProcessGroup || processGroup.state === 'not_observed') {
    return {
      passed: false,
      rendererCount: null,
      rendererDiagnostics: emptyRendererDiagnostics(),
    };
  }
  const cdpObservation = validateUidLifecycleObservation(lifecycle)
    ? lifecycle.cdpRendererObservation
    : null;
  const rendererDiagnostics = {
    ...processGroup,
    sandboxReason: reason,
    unreadableProcessCount: Math.max(
      processGroup.unreadableProcessCount,
      cdpObservation?.unreadableCount ?? 0,
    ),
    uidMismatchCount: Math.max(
      processGroup.uidMismatchCount,
      cdpObservation?.uidMismatchCount ?? 0,
    ),
    noSandboxFlagCount: Math.max(
      processGroup.noSandboxFlagCount,
      cdpObservation?.noSandboxFlagCount ?? 0,
    ),
    rendererCount:
      cdpObservation?.state === 'observed' ||
      cdpObservation?.state === 'partial'
        ? cdpObservation.rendererCount
        : processGroup.rendererCount,
    seccompState: ['disabled', 'mixed'].includes(processGroup.seccompState)
      ? processGroup.seccompState
      : (cdpObservation?.seccompState ?? processGroup.seccompState),
    noNewPrivsState: ['disabled', 'mixed'].includes(
      processGroup.noNewPrivsState,
    )
      ? processGroup.noNewPrivsState
      : (cdpObservation?.noNewPrivsState ?? processGroup.noNewPrivsState),
  };
  return {
    passed: reason === 'passed',
    rendererCount:
      reason === 'passed' ? Math.min(2, cdpObservation.rendererCount) : null,
    rendererDiagnostics,
  };
}

function emptyRendererDiagnostics() {
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

function emptyCounterObservation(
  state = 'not_observed',
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

function validateUidProcessObservation(value) {
  if (
    !hasKeys(value, [
      'state',
      'uidProcessCount',
      'nonZombieProcessCount',
      'zombieCount',
      'unreadableProcessCount',
    ]) ||
    !UID_PROCESS_OBSERVATION_STATES.has(value.state)
  ) {
    return false;
  }
  if (value.state === 'observed' || value.state === 'partial') {
    return (
      diagnosticCount(value.uidProcessCount) &&
      diagnosticCount(value.nonZombieProcessCount) &&
      value.nonZombieProcessCount <= value.uidProcessCount &&
      diagnosticCount(value.zombieCount) &&
      value.zombieCount <= value.uidProcessCount &&
      diagnosticCount(value.unreadableProcessCount) &&
      value.unreadableProcessCount <= value.uidProcessCount
    );
  }
  return (
    value.uidProcessCount === null &&
    value.nonZombieProcessCount === null &&
    value.zombieCount === null &&
    value.unreadableProcessCount === null
  );
}

export function emptyUidLifecycleObservation(state = 'not_observed') {
  const unavailable = state === 'unavailable';
  const rendererState =
    state === 'not_observed' ? 'not_observed' : 'unavailable';
  const securityState =
    state === 'not_observed' ? 'not_observed' : 'unavailable';
  return {
    state,
    overflow: null,
    uidProcessCount: null,
    nonZombieProcessCount: null,
    zombieCount: null,
    unreadableProcessCount: null,
    unattributedProcessCount: null,
    processClassCounts: null,
    processRoleCounts: null,
    rendererOwnership: {
      state: rendererState,
      appIdentityState: unavailable ? 'unavailable' : rendererState,
      rendererCount: null,
      appDescendantCount: null,
      appProcessGroupCount: null,
      appDescendantAndProcessGroupCount: null,
      appDescendantOnlyCount: null,
      appProcessGroupOnlyCount: null,
      noCurrentLinkCount: null,
      otherUidAppDescendantCount: null,
      securityCoverageState: rendererState,
    },
    cdpRendererObservation: emptyCdpRendererObservation(
      unavailable ? 'unavailable' : rendererState,
    ),
    seccompState: securityState,
    noNewPrivsState: securityState,
  };
}

function emptyCdpRendererObservation(state) {
  const securityState =
    state === 'not_observed' ? 'not_observed' : 'unavailable';
  return {
    state,
    overflow: null,
    rendererCount: null,
    missingCount: null,
    unreadableCount: null,
    uidMatchCount: null,
    uidMismatchCount: null,
    appIdentityState: securityState,
    appDescendantCount: null,
    appDescendantUnobservedCount: null,
    appProcessGroupCount: null,
    appProcessGroupUnobservedCount: null,
    appDescendantAndProcessGroupCount: null,
    argvRendererMatchCount: null,
    noSandboxFlagCount: null,
    seccompState: securityState,
    noNewPrivsState: securityState,
  };
}

function validateCdpRendererObservation(value) {
  const fields = [
    'state',
    'overflow',
    'rendererCount',
    'missingCount',
    'unreadableCount',
    'uidMatchCount',
    'uidMismatchCount',
    'appIdentityState',
    'appDescendantCount',
    'appDescendantUnobservedCount',
    'appProcessGroupCount',
    'appProcessGroupUnobservedCount',
    'appDescendantAndProcessGroupCount',
    'argvRendererMatchCount',
    'noSandboxFlagCount',
    'seccompState',
    'noNewPrivsState',
  ];
  if (
    !hasKeys(value, fields) ||
    !CDP_RENDERER_OBSERVATION_STATES.has(value.state) ||
    !UID_LIFECYCLE_APP_IDENTITY_STATES.has(value.appIdentityState) ||
    !SANDBOX_DIAGNOSTIC_VALUES.has(value.seccompState) ||
    !SANDBOX_DIAGNOSTIC_VALUES.has(value.noNewPrivsState)
  ) {
    return false;
  }
  if (value.state === 'not_observed' || value.state === 'unavailable') {
    const expected = emptyCdpRendererObservation(value.state);
    return fields.every((field) => value[field] === expected[field]);
  }
  if (
    typeof value.overflow !== 'boolean' ||
    !diagnosticCount(value.rendererCount) ||
    value.rendererCount > 64 ||
    [
      'missingCount',
      'unreadableCount',
      'uidMatchCount',
      'uidMismatchCount',
      'argvRendererMatchCount',
      'noSandboxFlagCount',
    ].some(
      (field) =>
        !diagnosticCount(value[field]) || value[field] > value.rendererCount,
    )
  ) {
    return false;
  }
  if (value.uidMatchCount + value.uidMismatchCount > value.rendererCount) {
    return false;
  }
  const relationCounts = [
    'appDescendantCount',
    'appDescendantUnobservedCount',
    'appProcessGroupCount',
    'appProcessGroupUnobservedCount',
    'appDescendantAndProcessGroupCount',
  ];
  if (value.appIdentityState === 'verified') {
    if (
      relationCounts.some(
        (field) =>
          !diagnosticCount(value[field]) || value[field] > value.rendererCount,
      ) ||
      value.appDescendantAndProcessGroupCount >
        Math.min(value.appDescendantCount, value.appProcessGroupCount) ||
      (value.state === 'observed' &&
        (value.overflow ||
          value.missingCount > 0 ||
          value.unreadableCount > 0 ||
          value.uidMismatchCount > 0 ||
          value.appDescendantUnobservedCount > 0 ||
          value.appProcessGroupUnobservedCount > 0))
    ) {
      return false;
    }
  } else if (
    value.state !== 'partial' ||
    relationCounts.some((field) => value[field] !== null)
  ) {
    return false;
  }
  return true;
}

function validateUidLifecycleObservation(value) {
  if (
    !hasKeys(value, [
      'state',
      'overflow',
      'uidProcessCount',
      'nonZombieProcessCount',
      'zombieCount',
      'unreadableProcessCount',
      'unattributedProcessCount',
      'processClassCounts',
      'processRoleCounts',
      'rendererOwnership',
      'cdpRendererObservation',
      'seccompState',
      'noNewPrivsState',
    ]) ||
    !UID_LIFECYCLE_STATES.has(value.state) ||
    !SANDBOX_DIAGNOSTIC_VALUES.has(value.seccompState) ||
    !SANDBOX_DIAGNOSTIC_VALUES.has(value.noNewPrivsState)
  ) {
    return false;
  }
  if (!validateCdpRendererObservation(value.cdpRendererObservation)) {
    return false;
  }

  const ownership = value.rendererOwnership;
  if (
    !hasKeys(ownership, [
      'state',
      'appIdentityState',
      'rendererCount',
      'appDescendantCount',
      'appProcessGroupCount',
      'appDescendantAndProcessGroupCount',
      'appDescendantOnlyCount',
      'appProcessGroupOnlyCount',
      'noCurrentLinkCount',
      'otherUidAppDescendantCount',
      'securityCoverageState',
    ]) ||
    !UID_LIFECYCLE_RELATION_STATES.has(ownership.state) ||
    !UID_LIFECYCLE_APP_IDENTITY_STATES.has(ownership.appIdentityState) ||
    !UID_LIFECYCLE_RELATION_STATES.has(ownership.securityCoverageState)
  ) {
    return false;
  }

  if (value.state === 'not_observed' || value.state === 'unavailable') {
    const expected = emptyUidLifecycleObservation(value.state);
    return (
      value.overflow === expected.overflow &&
      value.uidProcessCount === expected.uidProcessCount &&
      value.nonZombieProcessCount === expected.nonZombieProcessCount &&
      value.zombieCount === expected.zombieCount &&
      value.unreadableProcessCount === expected.unreadableProcessCount &&
      value.unattributedProcessCount === expected.unattributedProcessCount &&
      value.processClassCounts === expected.processClassCounts &&
      value.processRoleCounts === expected.processRoleCounts &&
      ownership.state === expected.rendererOwnership.state &&
      ownership.appIdentityState ===
        expected.rendererOwnership.appIdentityState &&
      ownership.rendererCount === null &&
      ownership.appDescendantCount === null &&
      ownership.appProcessGroupCount === null &&
      ownership.appDescendantAndProcessGroupCount === null &&
      ownership.appDescendantOnlyCount === null &&
      ownership.appProcessGroupOnlyCount === null &&
      ownership.noCurrentLinkCount === null &&
      ownership.otherUidAppDescendantCount === null &&
      ownership.securityCoverageState ===
        expected.rendererOwnership.securityCoverageState &&
      Object.keys(expected.cdpRendererObservation).every(
        (field) =>
          value.cdpRendererObservation[field] ===
          expected.cdpRendererObservation[field],
      ) &&
      value.seccompState === expected.seccompState &&
      value.noNewPrivsState === expected.noNewPrivsState
    );
  }

  if (
    typeof value.overflow !== 'boolean' ||
    !diagnosticCount(value.uidProcessCount) ||
    !diagnosticCount(value.nonZombieProcessCount) ||
    !diagnosticCount(value.zombieCount) ||
    !diagnosticCount(value.unreadableProcessCount) ||
    !diagnosticCount(value.unattributedProcessCount) ||
    !hasKeys(value.processClassCounts, UID_LIFECYCLE_PROCESS_CLASSES) ||
    !hasKeys(value.processRoleCounts, UID_LIFECYCLE_PROCESS_ROLES) ||
    UID_LIFECYCLE_PROCESS_CLASSES.some(
      (name) => !diagnosticCount(value.processClassCounts[name]),
    ) ||
    UID_LIFECYCLE_PROCESS_ROLES.some(
      (name) => !diagnosticCount(value.processRoleCounts[name]),
    )
  ) {
    return false;
  }

  const classCountTotal = UID_LIFECYCLE_PROCESS_CLASSES.reduce(
    (total, name) => total + value.processClassCounts[name],
    0,
  );
  const roleCountTotal = UID_LIFECYCLE_PROCESS_ROLES.reduce(
    (total, name) => total + value.processRoleCounts[name],
    0,
  );
  if (
    value.nonZombieProcessCount > value.uidProcessCount ||
    value.zombieCount > value.uidProcessCount ||
    value.unreadableProcessCount > value.uidProcessCount ||
    UID_LIFECYCLE_PROCESS_CLASSES.some(
      (name) => value.processClassCounts[name] > value.uidProcessCount,
    ) ||
    UID_LIFECYCLE_PROCESS_ROLES.some(
      (name) => value.processRoleCounts[name] > value.uidProcessCount,
    ) ||
    (!value.overflow &&
      (value.nonZombieProcessCount + value.zombieCount >
        value.uidProcessCount ||
        classCountTotal !== value.uidProcessCount ||
        roleCountTotal !== value.uidProcessCount)) ||
    (value.state === 'observed' &&
      (value.overflow ||
        value.nonZombieProcessCount + value.zombieCount !==
          value.uidProcessCount))
  ) {
    return false;
  }

  if (ownership.appIdentityState === 'not_observed') {
    return (
      ownership.state === 'not_observed' &&
      ownership.rendererCount === null &&
      ownership.appDescendantCount === null &&
      ownership.appProcessGroupCount === null &&
      ownership.appDescendantAndProcessGroupCount === null &&
      ownership.appDescendantOnlyCount === null &&
      ownership.appProcessGroupOnlyCount === null &&
      ownership.noCurrentLinkCount === null &&
      ownership.otherUidAppDescendantCount === null &&
      ownership.securityCoverageState === 'not_observed' &&
      value.seccompState === 'not_observed' &&
      value.noNewPrivsState === 'not_observed'
    );
  }
  if (ownership.appIdentityState === 'unavailable') {
    return (
      ownership.state === 'unavailable' &&
      ownership.rendererCount === null &&
      ownership.appDescendantCount === null &&
      ownership.appProcessGroupCount === null &&
      ownership.appDescendantAndProcessGroupCount === null &&
      ownership.appDescendantOnlyCount === null &&
      ownership.appProcessGroupOnlyCount === null &&
      ownership.noCurrentLinkCount === null &&
      ownership.otherUidAppDescendantCount === null &&
      ownership.securityCoverageState === 'unavailable' &&
      value.seccompState === 'unavailable' &&
      value.noNewPrivsState === 'unavailable'
    );
  }
  const ownershipCounts = [
    'rendererCount',
    'appDescendantCount',
    'appProcessGroupCount',
    'appDescendantAndProcessGroupCount',
    'appDescendantOnlyCount',
    'appProcessGroupOnlyCount',
    'noCurrentLinkCount',
    'otherUidAppDescendantCount',
  ];
  if (
    ownership.state !== value.state ||
    ownershipCounts.some((name) => !diagnosticCount(ownership[name])) ||
    !['observed', 'partial'].includes(ownership.securityCoverageState) ||
    ownership.rendererCount !== value.processClassCounts.renderer ||
    ownership.appDescendantCount > ownership.rendererCount ||
    ownership.appProcessGroupCount > ownership.rendererCount ||
    ownership.appDescendantAndProcessGroupCount >
      Math.min(ownership.appDescendantCount, ownership.appProcessGroupCount) ||
    ownership.appDescendantOnlyCount !==
      ownership.appDescendantCount -
        ownership.appDescendantAndProcessGroupCount ||
    ownership.appProcessGroupOnlyCount !==
      ownership.appProcessGroupCount -
        ownership.appDescendantAndProcessGroupCount ||
    ownership.noCurrentLinkCount !==
      ownership.rendererCount -
        ownership.appDescendantCount -
        ownership.appProcessGroupCount +
        ownership.appDescendantAndProcessGroupCount ||
    (value.state === 'observed' &&
      (value.overflow || ownership.securityCoverageState !== 'observed'))
  ) {
    return false;
  }

  return true;
}

export function sanitizeUidProcessObservation(input) {
  const fallback = {
    state: 'unavailable',
    uidProcessCount: null,
    nonZombieProcessCount: null,
    zombieCount: null,
    unreadableProcessCount: null,
  };
  let value = input;
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input);
    } catch {
      return fallback;
    }
  }
  if (!validateUidProcessObservation(value)) return fallback;
  return {
    state: value.state,
    uidProcessCount: value.uidProcessCount,
    nonZombieProcessCount: value.nonZombieProcessCount,
    zombieCount: value.zombieCount,
    unreadableProcessCount: value.unreadableProcessCount,
  };
}

export function sanitizeUidLifecycleObservation(input) {
  if (input === undefined) return emptyUidLifecycleObservation('not_observed');
  const fallback = emptyUidLifecycleObservation('unavailable');
  let value = input;
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input);
    } catch {
      return fallback;
    }
  }
  if (!validateUidLifecycleObservation(value)) return fallback;
  return {
    state: value.state,
    overflow: value.overflow,
    uidProcessCount: value.uidProcessCount,
    nonZombieProcessCount: value.nonZombieProcessCount,
    zombieCount: value.zombieCount,
    unreadableProcessCount: value.unreadableProcessCount,
    unattributedProcessCount: value.unattributedProcessCount,
    processClassCounts:
      value.processClassCounts === null
        ? null
        : Object.fromEntries(
            UID_LIFECYCLE_PROCESS_CLASSES.map((name) => [
              name,
              value.processClassCounts[name],
            ]),
          ),
    processRoleCounts:
      value.processRoleCounts === null
        ? null
        : Object.fromEntries(
            UID_LIFECYCLE_PROCESS_ROLES.map((name) => [
              name,
              value.processRoleCounts[name],
            ]),
          ),
    rendererOwnership: {
      state: value.rendererOwnership.state,
      appIdentityState: value.rendererOwnership.appIdentityState,
      rendererCount: value.rendererOwnership.rendererCount,
      appDescendantCount: value.rendererOwnership.appDescendantCount,
      appProcessGroupCount: value.rendererOwnership.appProcessGroupCount,
      appDescendantAndProcessGroupCount:
        value.rendererOwnership.appDescendantAndProcessGroupCount,
      appDescendantOnlyCount: value.rendererOwnership.appDescendantOnlyCount,
      appProcessGroupOnlyCount:
        value.rendererOwnership.appProcessGroupOnlyCount,
      noCurrentLinkCount: value.rendererOwnership.noCurrentLinkCount,
      otherUidAppDescendantCount:
        value.rendererOwnership.otherUidAppDescendantCount,
      securityCoverageState: value.rendererOwnership.securityCoverageState,
    },
    cdpRendererObservation: Object.fromEntries(
      Object.keys(value.cdpRendererObservation).map((name) => [
        name,
        value.cdpRendererObservation[name],
      ]),
    ),
    seccompState: value.seccompState,
    noNewPrivsState: value.noNewPrivsState,
  };
}

export function isValidUidLifecycleObservation(input) {
  return validateUidLifecycleObservation(input);
}

function emptyUidStopCensus(state) {
  return {
    state,
    outcome: 'unavailable',
    exitStatus: null,
    stderrOutcome: state === 'not_attempted' ? 'not_attempted' : 'unavailable',
    overflow: null,
    uidProcessCount: null,
    nonZombieProcessCount: null,
    zombieCount: null,
    unreadableProcessCount: null,
    unattributedProcessCount: null,
    processClassCounts: null,
    processRoleCounts: null,
  };
}

function emptyUidStopCheckpoint() {
  return {
    inspection: 'not_attempted',
    census: emptyUidStopCensus('not_attempted'),
  };
}

export function emptyUidProcessStopDiagnostics() {
  return {
    status: 'not_run',
    initial: emptyUidStopCheckpoint(),
    termSignal: 'not_attempted',
    postTerm: emptyUidStopCheckpoint(),
    killSignal: 'not_attempted',
    postKill: emptyUidStopCheckpoint(),
  };
}

function validateUidStopCensus(value) {
  if (
    !hasKeys(value, [
      'state',
      'outcome',
      'exitStatus',
      'stderrOutcome',
      'overflow',
      'uidProcessCount',
      'nonZombieProcessCount',
      'zombieCount',
      'unreadableProcessCount',
      'unattributedProcessCount',
      'processClassCounts',
      'processRoleCounts',
    ]) ||
    !['not_attempted', 'unavailable', 'partial', 'observed'].includes(
      value.state,
    ) ||
    !UID_STOP_CENSUS_OUTCOMES.has(value.outcome) ||
    !UID_STOP_STDERR_OUTCOMES.has(value.stderrOutcome) ||
    (value.state !== 'not_attempted' &&
      value.stderrOutcome === 'not_attempted') ||
    !(
      value.exitStatus === null ||
      (Number.isSafeInteger(value.exitStatus) &&
        value.exitStatus >= 0 &&
        value.exitStatus <= 255)
    )
  ) {
    return false;
  }
  if (value.state === 'not_attempted' || value.state === 'unavailable') {
    const emptyCounts =
      value.overflow === null &&
      value.uidProcessCount === null &&
      value.nonZombieProcessCount === null &&
      value.zombieCount === null &&
      value.unreadableProcessCount === null &&
      value.unattributedProcessCount === null &&
      value.processClassCounts === null &&
      value.processRoleCounts === null;
    if (!emptyCounts) return false;
    if (value.state === 'not_attempted') {
      return (
        value.outcome === 'unavailable' &&
        value.exitStatus === null &&
        value.stderrOutcome === 'not_attempted'
      );
    }
    if (
      value.outcome === 'spawn-error' &&
      value.stderrOutcome !== 'unavailable'
    ) {
      return false;
    }
    switch (value.outcome) {
      case 'signal':
      case 'unavailable':
        return value.exitStatus === null;
      case 'timeout':
        return value.exitStatus === null || value.exitStatus === 124;
      case 'nonzero-exit':
        return (
          value.exitStatus !== null &&
          value.exitStatus !== 0 &&
          value.exitStatus !== 124
        );
      case 'overflow':
      case 'malformed':
        return value.exitStatus === 0;
      case 'observed':
        return false;
      default:
        return false;
    }
  }
  if (
    typeof value.overflow !== 'boolean' ||
    !diagnosticCount(value.uidProcessCount) ||
    !diagnosticCount(value.nonZombieProcessCount) ||
    !diagnosticCount(value.zombieCount) ||
    !diagnosticCount(value.unreadableProcessCount) ||
    !diagnosticCount(value.unattributedProcessCount) ||
    !hasKeys(value.processClassCounts, UID_LIFECYCLE_PROCESS_CLASSES) ||
    !hasKeys(value.processRoleCounts, UID_LIFECYCLE_PROCESS_ROLES) ||
    UID_LIFECYCLE_PROCESS_CLASSES.some(
      (name) => !diagnosticCount(value.processClassCounts[name]),
    ) ||
    UID_LIFECYCLE_PROCESS_ROLES.some(
      (name) => !diagnosticCount(value.processRoleCounts[name]),
    ) ||
    value.nonZombieProcessCount > value.uidProcessCount ||
    value.zombieCount > value.uidProcessCount ||
    value.unreadableProcessCount > value.uidProcessCount ||
    value.unattributedProcessCount > value.uidProcessCount ||
    UID_LIFECYCLE_PROCESS_CLASSES.some(
      (name) => value.processClassCounts[name] > value.uidProcessCount,
    ) ||
    UID_LIFECYCLE_PROCESS_ROLES.some(
      (name) => value.processRoleCounts[name] > value.uidProcessCount,
    )
  ) {
    return false;
  }
  const classTotal = UID_LIFECYCLE_PROCESS_CLASSES.reduce(
    (total, name) => total + value.processClassCounts[name],
    0,
  );
  const roleTotal = UID_LIFECYCLE_PROCESS_ROLES.reduce(
    (total, name) => total + value.processRoleCounts[name],
    0,
  );
  return (
    value.nonZombieProcessCount + value.zombieCount <= value.uidProcessCount &&
    (value.overflow ||
      (value.nonZombieProcessCount + value.zombieCount ===
        value.uidProcessCount &&
        classTotal === value.uidProcessCount &&
        roleTotal === value.uidProcessCount)) &&
    (value.state !== 'observed' || !value.overflow) &&
    ((value.outcome === 'observed' &&
      (value.exitStatus === null || value.exitStatus === 0) &&
      !value.overflow &&
      ![
        'timeout-permission',
        'timeout-launch-failure',
        'sudo-launch-failure',
      ].includes(value.stderrOutcome)) ||
      (value.outcome === 'overflow' &&
        (value.exitStatus === null || value.exitStatus === 0) &&
        value.state === 'partial' &&
        value.overflow))
  );
}

function validateUidStopCheckpoint(value) {
  return (
    hasKeys(value, ['inspection', 'census']) &&
    UID_STOP_INSPECTION_STATES.has(value.inspection) &&
    validateUidStopCensus(value.census) &&
    (value.inspection !== 'not_attempted' ||
      value.census.state === 'not_attempted')
  );
}

function validateUidProcessStopDiagnostics(value) {
  if (
    !hasKeys(value, [
      'status',
      'initial',
      'termSignal',
      'postTerm',
      'killSignal',
      'postKill',
    ]) ||
    !['not_run', 'passed', 'failed'].includes(value.status) ||
    !validateUidStopCheckpoint(value.initial) ||
    !validateUidStopCheckpoint(value.postTerm) ||
    !validateUidStopCheckpoint(value.postKill) ||
    !UID_STOP_SIGNAL_OUTCOMES.has(value.termSignal) ||
    !UID_STOP_SIGNAL_OUTCOMES.has(value.killSignal)
  ) {
    return false;
  }
  const initialAbsent = value.initial.inspection === 'absent';
  const initialPresent = value.initial.inspection === 'present';
  const postTermAbsent = value.postTerm.inspection === 'absent';
  const postTermPresent = value.postTerm.inspection === 'present';
  const termNotAttempted = value.termSignal === 'not_attempted';
  const killNotAttempted = value.killSignal === 'not_attempted';
  if (initialAbsent || value.initial.inspection !== 'present') {
    if (
      !termNotAttempted ||
      value.postTerm.inspection !== 'not_attempted' ||
      !killNotAttempted ||
      value.postKill.inspection !== 'not_attempted'
    ) {
      return false;
    }
  } else if (termNotAttempted) {
    return false;
  }
  if (postTermPresent) {
    if (killNotAttempted || value.postKill.inspection === 'not_attempted') {
      return false;
    }
  } else if (
    !killNotAttempted ||
    value.postKill.inspection !== 'not_attempted'
  ) {
    return false;
  }
  const observedClear =
    initialAbsent ||
    postTermAbsent ||
    (postTermPresent && value.postKill.inspection === 'absent');
  return value.status !== 'passed' || observedClear;
}

function emptyUidTcpSocketObservation(state = 'not_observed') {
  return {
    coverage: 'process_owned_tcp_only',
    packetAttribution: 'not_observed',
    state,
    overflow: null,
    tcpSocketCount: null,
    buckets: null,
  };
}

function validateUidTcpSocketObservation(value) {
  if (
    !hasKeys(value, [
      'coverage',
      'packetAttribution',
      'state',
      'overflow',
      'tcpSocketCount',
      'buckets',
    ]) ||
    value.coverage !== 'process_owned_tcp_only' ||
    value.packetAttribution !== 'not_observed' ||
    !UID_TCP_SOCKET_STATES.has(value.state)
  ) {
    return false;
  }
  if (value.state === 'not_observed' || value.state === 'unavailable') {
    return (
      value.overflow === null &&
      value.tcpSocketCount === null &&
      value.buckets === null
    );
  }
  if (
    typeof value.overflow !== 'boolean' ||
    !diagnosticCount(value.tcpSocketCount) ||
    !Array.isArray(value.buckets) ||
    value.buckets.length > MAX_DIAGNOSTIC_COUNT
  ) {
    return false;
  }
  const seen = new Set();
  let bucketTotal = 0;
  for (const bucket of value.buckets) {
    if (
      !hasKeys(bucket, ['processRole', 'peerCategory', 'tcpState', 'count']) ||
      !UID_TCP_PROCESS_ROLES.includes(bucket.processRole) ||
      !UID_TCP_PEER_CATEGORIES.has(bucket.peerCategory) ||
      !UID_TCP_STATE_CATEGORIES.has(bucket.tcpState) ||
      !diagnosticCount(bucket.count) ||
      bucket.count < 1
    ) {
      return false;
    }
    const key = `${bucket.processRole}\u0000${bucket.peerCategory}\u0000${bucket.tcpState}`;
    if (seen.has(key)) return false;
    seen.add(key);
    bucketTotal += bucket.count;
  }
  if (
    (value.tcpSocketCount === 0) !== (value.buckets.length === 0) ||
    value.buckets.length > value.tcpSocketCount
  ) {
    return false;
  }
  return (
    value.state !== 'observed' ||
    (!value.overflow && bucketTotal === value.tcpSocketCount)
  );
}

export function sanitizeUidTcpSocketObservation(input) {
  if (input === undefined) return emptyUidTcpSocketObservation();
  const fallback = emptyUidTcpSocketObservation('unavailable');
  let value = input;
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input);
    } catch {
      return fallback;
    }
  }
  if (!validateUidTcpSocketObservation(value)) return fallback;
  return {
    coverage: 'process_owned_tcp_only',
    packetAttribution: 'not_observed',
    state: value.state,
    overflow: value.overflow,
    tcpSocketCount: value.tcpSocketCount,
    buckets:
      value.buckets === null
        ? null
        : [...value.buckets]
            .map((bucket) => ({
              processRole: bucket.processRole,
              peerCategory: bucket.peerCategory,
              tcpState: bucket.tcpState,
              count: bucket.count,
            }))
            .sort((left, right) => {
              const leftKey = `${left.processRole}\u0000${left.peerCategory}\u0000${left.tcpState}`;
              const rightKey = `${right.processRole}\u0000${right.peerCategory}\u0000${right.tcpState}`;
              return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
            }),
  };
}

export function emptyUidStartupObservation(state = 'not_observed') {
  return {
    uidLifecycleObservation: emptyUidLifecycleObservation(state),
    tcpSocketObservation: emptyUidTcpSocketObservation(state),
  };
}

export function sanitizeUidStartupObservation(input) {
  if (input === undefined) return emptyUidStartupObservation();
  const fallback = emptyUidStartupObservation('unavailable');
  let value = input;
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input);
    } catch {
      return fallback;
    }
  }
  if (
    !hasKeys(value, ['uidLifecycleObservation', 'tcpSocketObservation']) ||
    !validateUidLifecycleObservation(value.uidLifecycleObservation) ||
    !validateUidTcpSocketObservation(value.tcpSocketObservation)
  ) {
    return fallback;
  }
  return {
    uidLifecycleObservation: sanitizeUidLifecycleObservation(
      value.uidLifecycleObservation,
    ),
    tcpSocketObservation: sanitizeUidTcpSocketObservation(
      value.tcpSocketObservation,
    ),
  };
}

export function uidProcessObservationFromLifecycle(input) {
  const observation = sanitizeUidLifecycleObservation(input);
  if (observation.state !== 'observed' && observation.state !== 'partial') {
    return {
      state: observation.state,
      uidProcessCount: null,
      nonZombieProcessCount: null,
      zombieCount: null,
      unreadableProcessCount: null,
    };
  }
  return {
    state: observation.state,
    uidProcessCount: observation.uidProcessCount,
    nonZombieProcessCount: observation.nonZombieProcessCount,
    zombieCount: observation.zombieCount,
    unreadableProcessCount: observation.unreadableProcessCount,
  };
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

function validateDesktopObservation(value) {
  if (
    !hasKeys(value, [
      'childState',
      'childExitStatus',
      'childSignal',
      'childSpawnErrorClass',
      'cdp',
      'pageLoadOutcome',
      'configInMemoryObservation',
    ]) ||
    !DESKTOP_CHILD_STATES.has(value.childState) ||
    ![null, ...PROBE_SIGNALS].includes(value.childSignal) ||
    (value.childExitStatus !== null &&
      (!Number.isSafeInteger(value.childExitStatus) ||
        value.childExitStatus < 0 ||
        value.childExitStatus > 255)) ||
    (value.childSpawnErrorClass !== null &&
      !DESKTOP_CHILD_SPAWN_ERRORS.has(value.childSpawnErrorClass)) ||
    !DESKTOP_PAGE_LOAD_OUTCOMES.has(value.pageLoadOutcome) ||
    !hasKeys(value.configInMemoryObservation, ['state', 'matchesFixture']) ||
    !CONFIG_IN_MEMORY_STATES.has(value.configInMemoryObservation.state) ||
    (value.configInMemoryObservation.state === 'observed'
      ? typeof value.configInMemoryObservation.matchesFixture !== 'boolean'
      : value.configInMemoryObservation.matchesFixture !== null) ||
    !hasKeys(value.cdp, [
      'versionResponseCount',
      'versionOkResponseCount',
      'versionLastStatus',
      'versionJsonValidObserved',
      'targetListResponseCount',
      'targetListOkResponseCount',
      'targetListLastStatus',
      'targetListJsonValidObserved',
      'pageTargetCount',
      'fixedOriginPageCount',
    ])
  ) {
    return false;
  }

  const childShapeValid =
    value.childState === 'not-started' || value.childState === 'launch-timeout'
      ? value.childExitStatus === null &&
        value.childSignal === null &&
        value.childSpawnErrorClass === null
      : value.childState === 'running'
        ? value.childExitStatus === null &&
          value.childSignal === null &&
          value.childSpawnErrorClass === null
        : value.childState === 'exited'
          ? value.childExitStatus !== null &&
            value.childSignal === null &&
            value.childSpawnErrorClass === null
          : value.childState === 'signaled'
            ? value.childExitStatus === null &&
              value.childSignal !== null &&
              value.childSpawnErrorClass === null
            : value.childExitStatus === null &&
              value.childSignal === null &&
              value.childSpawnErrorClass !== null;
  if (!childShapeValid) return false;

  for (const name of ['version', 'targetList']) {
    const responseCount = value.cdp[`${name}ResponseCount`];
    const okCount = value.cdp[`${name}OkResponseCount`];
    const lastStatus = value.cdp[`${name}LastStatus`];
    const jsonValid = value.cdp[`${name}JsonValidObserved`];
    if (
      !Number.isSafeInteger(responseCount) ||
      responseCount < 0 ||
      responseCount > 2 ||
      !Number.isSafeInteger(okCount) ||
      okCount < 0 ||
      okCount > responseCount ||
      (lastStatus !== null &&
        (!Number.isSafeInteger(lastStatus) ||
          lastStatus < 100 ||
          lastStatus > 599)) ||
      (responseCount === 0) !== (lastStatus === null) ||
      typeof jsonValid !== 'boolean' ||
      (jsonValid && okCount === 0)
    ) {
      return false;
    }
  }
  const pageCountsValid = value.cdp.targetListJsonValidObserved
    ? Number.isSafeInteger(value.cdp.pageTargetCount) &&
      value.cdp.pageTargetCount >= 0 &&
      value.cdp.pageTargetCount <= 2 &&
      Number.isSafeInteger(value.cdp.fixedOriginPageCount) &&
      value.cdp.fixedOriginPageCount >= 0 &&
      value.cdp.fixedOriginPageCount <= value.cdp.pageTargetCount
    : value.cdp.pageTargetCount === null &&
      value.cdp.fixedOriginPageCount === null;
  return pageCountsValid;
}

function desktopObservationPassed(value) {
  return (
    value.childState === 'running' &&
    value.cdp.versionOkResponseCount > 0 &&
    value.cdp.versionJsonValidObserved &&
    value.cdp.targetListOkResponseCount > 0 &&
    value.cdp.targetListJsonValidObserved &&
    value.cdp.fixedOriginPageCount > 0 &&
    value.pageLoadOutcome === 'domcontentloaded'
  );
}

function validateSecretService(value) {
  if (
    !hasKeys(value, [
      'step',
      'dbusAddressPresent',
      'daemonOutcome',
      'daemonExitStatus',
      'daemonControlPresent',
      'storeOutcome',
      'storeExitStatus',
      'lookupOutcome',
      'lookupExitStatus',
      'lookupMatches',
      'clearOutcome',
      'clearExitStatus',
      'keyringFilePresent',
    ]) ||
    !SECRET_SERVICE_STEPS.has(value.step) ||
    typeof value.dbusAddressPresent !== 'boolean' ||
    typeof value.daemonControlPresent !== 'boolean' ||
    typeof value.lookupMatches !== 'boolean' ||
    typeof value.keyringFilePresent !== 'boolean'
  ) {
    return false;
  }

  for (const name of ['daemon', 'store', 'lookup', 'clear']) {
    const outcome = value[`${name}Outcome`];
    const exitStatus = value[`${name}ExitStatus`];
    if (
      !SECRET_COMMAND_OUTCOMES.has(outcome) ||
      (exitStatus !== null &&
        (!Number.isSafeInteger(exitStatus) ||
          exitStatus < 0 ||
          exitStatus > 255)) ||
      (outcome === 'not-run' && exitStatus !== null) ||
      (outcome === 'passed' && exitStatus !== 0) ||
      (outcome === 'nonzero-exit' &&
        (exitStatus === null || exitStatus === 0)) ||
      (!['passed', 'nonzero-exit'].includes(outcome) && exitStatus !== null)
    ) {
      return false;
    }
  }

  const daemonPassed = value.daemonOutcome === 'passed';
  const dataCommandsPassed =
    value.storeOutcome === 'passed' &&
    value.lookupOutcome === 'passed' &&
    value.lookupMatches &&
    value.clearOutcome === 'passed';
  const commandsNotRun =
    value.storeOutcome === 'not-run' &&
    value.lookupOutcome === 'not-run' &&
    value.clearOutcome === 'not-run' &&
    !value.lookupMatches &&
    !value.keyringFilePresent;
  const daemonNotRun = value.daemonOutcome === 'not-run';

  switch (value.step) {
    case 'not-run':
      return (
        !value.dbusAddressPresent &&
        daemonNotRun &&
        value.daemonExitStatus === null &&
        !value.daemonControlPresent &&
        commandsNotRun
      );
    case 'dbus-session':
      return (
        !value.dbusAddressPresent &&
        daemonNotRun &&
        value.daemonExitStatus === null &&
        !value.daemonControlPresent &&
        commandsNotRun
      );
    case 'daemon-start':
      return (
        value.dbusAddressPresent &&
        !daemonPassed &&
        !value.daemonControlPresent &&
        commandsNotRun
      );
    case 'secret-store':
      return (
        value.dbusAddressPresent &&
        daemonPassed &&
        value.storeOutcome !== 'passed'
      );
    case 'secret-lookup':
      return (
        value.dbusAddressPresent &&
        daemonPassed &&
        value.storeOutcome === 'passed' &&
        (value.lookupOutcome !== 'passed' || !value.lookupMatches)
      );
    case 'secret-clear':
      return (
        value.dbusAddressPresent &&
        daemonPassed &&
        value.storeOutcome === 'passed' &&
        value.lookupOutcome === 'passed' &&
        value.lookupMatches &&
        value.clearOutcome !== 'passed'
      );
    case 'keyring-file':
      return (
        value.dbusAddressPresent &&
        daemonPassed &&
        dataCommandsPassed &&
        !value.keyringFilePresent
      );
    case 'none':
      return (
        value.dbusAddressPresent &&
        daemonPassed &&
        dataCommandsPassed &&
        value.keyringFilePresent
      );
    default:
      return false;
  }
}

function secretServicePassed(value) {
  return validateSecretService(value) && value.step === 'none';
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
  return validateProbeFamily({
    ...value,
    dropCount: null,
    policyState: 'not_observed',
  });
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
      'secretService',
      'safeStorage',
      'desktopObservation',
      'rendererCount',
      'rendererDiagnostics',
      'uidLifecycleDiagnostics',
      'uidTcpSocketDiagnostics',
      'egressPhaseCounters',
      'checks',
    ]) ||
    record.phase !== 'desktop-startup' ||
    !['passed', 'failed'].includes(record.status) ||
    (record.failureCode !== null &&
      !STARTUP_FAILURES.has(record.failureCode)) ||
    record.sourceSha !== sourceSha ||
    record.origin !== ORIGIN ||
    (record.rendererCount !== null &&
      (!Number.isSafeInteger(record.rendererCount) ||
        record.rendererCount < 1 ||
        record.rendererCount > 2)) ||
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
    !validateSecretService(record.secretService) ||
    !validateSafeStorage(record.safeStorage) ||
    !validateDesktopObservation(record.desktopObservation) ||
    !validateRendererDiagnostics(record.rendererDiagnostics) ||
    !hasKeys(record.uidLifecycleDiagnostics, [
      'beforeApp',
      'afterAppSpawn',
      'afterPageLoad',
    ]) ||
    !validateUidLifecycleObservation(
      record.uidLifecycleDiagnostics.beforeApp,
    ) ||
    !validateUidLifecycleObservation(
      record.uidLifecycleDiagnostics.afterAppSpawn,
    ) ||
    !validateUidLifecycleObservation(
      record.uidLifecycleDiagnostics.afterPageLoad,
    ) ||
    !hasKeys(record.uidTcpSocketDiagnostics, ['beforeApp', 'afterPageLoad']) ||
    !validateUidTcpSocketObservation(
      record.uidTcpSocketDiagnostics.beforeApp,
    ) ||
    !validateUidTcpSocketObservation(
      record.uidTcpSocketDiagnostics.afterPageLoad,
    ) ||
    !validateEgressPhaseCounters(record.egressPhaseCounters) ||
    record.runtime.runner !== 'ubuntu-24.04' ||
    !hasKeys(record.checks, CHECK_NAMES) ||
    Object.values(record.checks).some((value) => !isStatus(value))
  ) {
    return false;
  }
  if (
    (record.checks.nativeSandbox === 'passed' &&
      (record.rendererDiagnostics.sandboxReason !== 'passed' ||
        !matchesTrustedRendererSandbox(
          record.rendererDiagnostics,
          record.uidLifecycleDiagnostics.afterPageLoad,
          record.rendererCount,
        ))) ||
    (record.checks.nativeSandbox === 'failed' &&
      record.rendererDiagnostics.sandboxReason === 'passed') ||
    (record.checks.nativeSandbox === 'not_run' &&
      record.rendererDiagnostics.state !== 'not_observed')
  ) {
    return false;
  }
  const storagePassed = safeStoragePassed(record.safeStorage);
  if (
    (record.checks.secretService === 'passed') !==
      secretServicePassed(record.secretService) ||
    (record.checks.secretService === 'not_run' &&
      record.secretService.step !== 'not-run') ||
    (record.checks.secretService === 'failed' &&
      ['not-run', 'none'].includes(record.secretService.step)) ||
    (record.checks.safeStorageBackend === 'passed') !== storagePassed ||
    (record.checks.safeStorageBackend === 'not_run' &&
      record.safeStorage.markerCount > 0)
  ) {
    return false;
  }
  if (
    record.status === 'passed' &&
    (record.failureCode !== null ||
      record.rendererCount === null ||
      record.rendererCount < 1 ||
      !desktopObservationPassed(record.desktopObservation) ||
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
      'policyState',
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
    !COUNTER_POLICY_STATES.has(value.policyState) ||
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
    value.policyState === 'verified' &&
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
    hasKeys(record, [
      'phase',
      'status',
      'policyState',
      'ipv4Blocked',
      'ipv6Blocked',
      'ipv4Classes',
      'ipv6Classes',
      'overflow',
    ]) &&
    record.phase === 'egress-observation' &&
    ['passed', 'failed'].includes(record.status) &&
    COUNTER_POLICY_STATES.has(record.policyState) &&
    record.policyState !== 'not_observed' &&
    (record.status === 'passed'
      ? validateCounterObservation({
          state: record.overflow ? 'partial' : 'observed',
          policyState: record.policyState,
          ipv4Blocked: record.ipv4Blocked,
          ipv6Blocked: record.ipv6Blocked,
          ipv4Classes: record.ipv4Classes,
          ipv6Classes: record.ipv6Classes,
          overflow: record.overflow,
        })
      : record.ipv4Blocked === null &&
        record.ipv6Blocked === null &&
        record.ipv4Classes === null &&
        record.ipv6Classes === null &&
        record.overflow === null) &&
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
      'accountState',
      'userdelStatus',
      'userdelExitStatus',
      'stopDiagnostics',
      'uidProcessObservation',
      'uidLifecycleObservationBeforeUserdel',
      'finalUidLifecycleObservation',
    ]) &&
    record.phase === 'cleanup' &&
    ['isolatedProcesses', 'user', 'profile', 'aptSource'].every((name) =>
      ['passed', 'failed', 'not_run'].includes(record[name]),
    ) &&
    ['passed', 'failed', 'not_run', 'retained'].includes(record.policy) &&
    [
      'not_observed',
      'unavailable',
      'absent',
      'uid_match',
      'uid_mismatch',
    ].includes(record.accountState) &&
    ['passed', 'failed', 'not_run'].includes(record.userdelStatus) &&
    (record.userdelExitStatus === null ||
      (Number.isSafeInteger(record.userdelExitStatus) &&
        record.userdelExitStatus >= 0 &&
        record.userdelExitStatus <= 255)) &&
    (record.userdelStatus === 'passed'
      ? record.userdelExitStatus === 0
      : record.userdelStatus === 'failed'
        ? record.userdelExitStatus !== null && record.userdelExitStatus !== 0
        : record.userdelExitStatus === null) &&
    validateUidProcessObservation(record.uidProcessObservation) &&
    validateUidProcessStopDiagnostics(record.stopDiagnostics) &&
    validateUidLifecycleObservation(
      record.uidLifecycleObservationBeforeUserdel,
    ) &&
    validateUidLifecycleObservation(record.finalUidLifecycleObservation) &&
    (() => {
      const projected = uidProcessObservationFromLifecycle(
        record.finalUidLifecycleObservation,
      );
      const projectionMatches =
        record.uidProcessObservation.state === projected.state &&
        record.uidProcessObservation.uidProcessCount ===
          projected.uidProcessCount &&
        record.uidProcessObservation.nonZombieProcessCount ===
          projected.nonZombieProcessCount &&
        record.uidProcessObservation.zombieCount === projected.zombieCount &&
        record.uidProcessObservation.unreadableProcessCount ===
          projected.unreadableProcessCount;
      const finalCleanupProven =
        record.uidLifecycleObservationBeforeUserdel.state === 'observed' &&
        record.uidLifecycleObservationBeforeUserdel.uidProcessCount === 0 &&
        record.finalUidLifecycleObservation.state === 'observed' &&
        record.finalUidLifecycleObservation.uidProcessCount === 0 &&
        record.accountState === 'absent' &&
        record.stopDiagnostics.status === 'passed';
      return (
        projectionMatches &&
        (record.policy !== 'passed' ||
          (record.isolatedProcesses === 'passed' && finalCleanupProven)) &&
        (record.policy !== 'retained' ||
          record.isolatedProcesses === 'failed') &&
        (record.isolatedProcesses !== 'passed' || finalCleanupProven) &&
        (record.user !== 'passed' || record.accountState === 'absent')
      );
    })()
  );
}

function emptyEgressPhaseCounters() {
  return {
    beforeApp: emptyCounterObservation(),
    afterAppSpawn: emptyCounterObservation(),
    afterPageLoad: emptyCounterObservation(),
    final: emptyCounterObservation(),
  };
}

function emptyEgressPhaseDelta() {
  return {
    state: 'unavailable',
    ipv4Blocked: null,
    ipv6Blocked: null,
    ipv4Classes: null,
    ipv6Classes: null,
  };
}

function counterDelta(before, after) {
  if (
    !validateCounterObservation(before) ||
    !validateCounterObservation(after) ||
    before.state !== 'observed' ||
    after.state !== 'observed'
  ) {
    return emptyEgressPhaseDelta();
  }
  const familyIsMonotonic = (family) =>
    after[`${family}Blocked`] >= before[`${family}Blocked`] &&
    EGRESS_DROP_COUNTER_CLASSES.every(
      (name) =>
        after[`${family}Classes`][name] >= before[`${family}Classes`][name],
    );
  if (!familyIsMonotonic('ipv4') || !familyIsMonotonic('ipv6')) {
    return emptyEgressPhaseDelta();
  }
  return {
    state: 'observed',
    ipv4Blocked: after.ipv4Blocked - before.ipv4Blocked,
    ipv6Blocked: after.ipv6Blocked - before.ipv6Blocked,
    ipv4Classes: Object.fromEntries(
      EGRESS_DROP_COUNTER_CLASSES.map((name) => [
        name,
        after.ipv4Classes[name] - before.ipv4Classes[name],
      ]),
    ),
    ipv6Classes: Object.fromEntries(
      EGRESS_DROP_COUNTER_CLASSES.map((name) => [
        name,
        after.ipv6Classes[name] - before.ipv6Classes[name],
      ]),
    ),
  };
}

function completeVerifiedCounterObservation(value) {
  return (
    validateCounterObservation(value) &&
    value.state === 'observed' &&
    value.overflow === false &&
    value.policyState === 'verified'
  );
}

function networkIsolationEvidencePassed(
  policy,
  startup,
  observation,
  phaseDeltas,
) {
  return (
    policy?.status === 'passed' &&
    policy.negativeTest === 'passed' &&
    policy.diagnostic?.passed === true &&
    startup !== undefined &&
    ['beforeApp', 'afterAppSpawn', 'afterPageLoad'].every((phase) =>
      completeVerifiedCounterObservation(startup.egressPhaseCounters[phase]),
    ) &&
    phaseDeltas !== undefined &&
    Object.values(phaseDeltas).every((delta) => delta.state === 'observed') &&
    observation?.status === 'passed' &&
    observation.overflow === false &&
    observation.policyState === 'verified' &&
    count(observation.ipv4Blocked) &&
    count(observation.ipv6Blocked)
  );
}

function validateEgressPhaseDelta(value) {
  if (
    !hasKeys(value, [
      'state',
      'ipv4Blocked',
      'ipv6Blocked',
      'ipv4Classes',
      'ipv6Classes',
    ])
  ) {
    return false;
  }
  if (value.state === 'unavailable') {
    return (
      value.ipv4Blocked === null &&
      value.ipv6Blocked === null &&
      value.ipv4Classes === null &&
      value.ipv6Classes === null
    );
  }
  if (
    value.state !== 'observed' ||
    !count(value.ipv4Blocked) ||
    !count(value.ipv6Blocked) ||
    !hasKeys(value.ipv4Classes, EGRESS_DROP_COUNTER_CLASSES) ||
    !hasKeys(value.ipv6Classes, EGRESS_DROP_COUNTER_CLASSES)
  ) {
    return false;
  }
  return (
    EGRESS_DROP_COUNTER_CLASSES.every(
      (name) =>
        count(value.ipv4Classes[name]) && count(value.ipv6Classes[name]),
    ) &&
    EGRESS_DROP_COUNTER_CLASSES.reduce(
      (total, name) => total + value.ipv4Classes[name],
      0,
    ) === value.ipv4Blocked &&
    EGRESS_DROP_COUNTER_CLASSES.reduce(
      (total, name) => total + value.ipv6Classes[name],
      0,
    ) === value.ipv6Blocked
  );
}

function validateEgressPhaseDeltas(value) {
  return (
    hasKeys(value, [
      'beforeAppToAfterAppSpawn',
      'afterAppSpawnToAfterPageLoad',
      'afterPageLoadToFinal',
    ]) && Object.values(value).every(validateEgressPhaseDelta)
  );
}

function defaultChecks() {
  return Object.fromEntries(
    [
      ...CHECK_NAMES,
      'isolatedNodePreflight',
      'egressPolicy',
      'negativeEgress',
      'networkIsolationVerified',
      'cleanupIsolatedProcesses',
      'cleanupPolicy',
      'cleanupUser',
      'cleanupProfile',
      'cleanupAptSource',
    ].map((name) => [name, 'not_run']),
  );
}

function emptyDesktopObservation() {
  return {
    childState: 'not-started',
    childExitStatus: null,
    childSignal: null,
    childSpawnErrorClass: null,
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
    configInMemoryObservation: {
      state: 'not_observed',
      matchesFixture: null,
    },
  };
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
  const uidEgressPhaseCounters = {
    beforeApp:
      startup?.egressPhaseCounters.beforeApp ??
      emptyCounterObservation('not_observed'),
    afterAppSpawn:
      startup?.egressPhaseCounters.afterAppSpawn ??
      emptyCounterObservation('not_observed'),
    afterPageLoad:
      startup?.egressPhaseCounters.afterPageLoad ??
      emptyCounterObservation('not_observed'),
    final:
      observation === undefined
        ? emptyCounterObservation('not_observed')
        : observation.status === 'passed'
          ? {
              state: observation.overflow ? 'partial' : 'observed',
              policyState: observation.policyState,
              ipv4Blocked: observation.ipv4Blocked,
              ipv6Blocked: observation.ipv6Blocked,
              ipv4Classes: observation.ipv4Classes,
              ipv6Classes: observation.ipv6Classes,
              overflow: observation.overflow,
            }
          : emptyCounterObservation('unavailable', observation.policyState),
  };
  const uidEgressPhaseDeltas = {
    beforeAppToAfterAppSpawn: counterDelta(
      uidEgressPhaseCounters.beforeApp,
      uidEgressPhaseCounters.afterAppSpawn,
    ),
    afterAppSpawnToAfterPageLoad: counterDelta(
      uidEgressPhaseCounters.afterAppSpawn,
      uidEgressPhaseCounters.afterPageLoad,
    ),
    afterPageLoadToFinal: counterDelta(
      uidEgressPhaseCounters.afterPageLoad,
      uidEgressPhaseCounters.final,
    ),
  };
  const cleanupDiagnostics = cleanup
    ? {
        policyStatus: cleanup.policy,
        accountState: cleanup.accountState,
        userdelStatus: cleanup.userdelStatus,
        userdelExitStatus: cleanup.userdelExitStatus,
        stopDiagnostics: cleanup.stopDiagnostics,
        uidProcessObservation: cleanup.uidProcessObservation,
      }
    : null;
  const checks = defaultChecks();
  if (targetUidPreflight) {
    checks.isolatedNodePreflight = targetUidPreflight.status;
  }
  if (startup) Object.assign(checks, startup.checks);
  if (policy) {
    checks.egressPolicy = policy.status;
    checks.negativeEgress = policy.negativeTest;
  }
  if (startup && policy && observation) {
    checks.networkIsolationVerified = networkIsolationEvidencePassed(
      policy,
      startup,
      observation,
      uidEgressPhaseDeltas,
    )
      ? 'passed'
      : 'failed';
  }
  if (cleanup) {
    checks.cleanupIsolatedProcesses = cleanup.isolatedProcesses;
    checks.cleanupPolicy =
      cleanup.policy === 'retained' ? 'failed' : cleanup.policy;
    checks.cleanupUser = cleanup.user;
    checks.cleanupProfile = cleanup.profile;
    checks.cleanupAptSource = cleanup.aptSource;
  }

  const allPassed =
    targetUidPreflight?.status === 'passed' &&
    startup?.status === 'passed' &&
    policy?.status === 'passed' &&
    policy.negativeTest === 'passed' &&
    checks.networkIsolationVerified === 'passed' &&
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
      (checks.networkIsolationVerified === 'failed'
        ? 'network-isolation-unverified'
        : null) ??
      (cleanup &&
      (cleanup.policy === 'retained' ||
        ['isolatedProcesses', 'policy', 'user', 'profile', 'aptSource'].some(
          (name) => cleanup[name] === 'failed',
        ))
        ? 'cleanup-failed'
        : 'evidence-incomplete'));

  return {
    schemaVersion: 18,
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
    secretService: startup?.secretService ?? {
      step: 'not-run',
      dbusAddressPresent: false,
      daemonOutcome: 'not-run',
      daemonExitStatus: null,
      daemonControlPresent: false,
      storeOutcome: 'not-run',
      storeExitStatus: null,
      lookupOutcome: 'not-run',
      lookupExitStatus: null,
      lookupMatches: false,
      clearOutcome: 'not-run',
      clearExitStatus: null,
      keyringFilePresent: false,
    },
    safeStorage: startup?.safeStorage ?? {
      mode: 'not_observed',
      backend: 'not_observed',
      markerCount: 0,
      complete: false,
    },
    desktopObservation:
      startup?.desktopObservation ?? emptyDesktopObservation(),
    rendererCount: startup?.rendererCount ?? null,
    rendererDiagnostics:
      startup?.rendererDiagnostics ?? emptyRendererDiagnostics(),
    uidLifecycleDiagnostics: {
      beforeApp:
        startup?.uidLifecycleDiagnostics.beforeApp ??
        emptyUidLifecycleObservation('not_observed'),
      afterAppSpawn:
        startup?.uidLifecycleDiagnostics.afterAppSpawn ??
        emptyUidLifecycleObservation('not_observed'),
      afterPageLoad:
        startup?.uidLifecycleDiagnostics.afterPageLoad ??
        emptyUidLifecycleObservation('not_observed'),
      beforeUserdel:
        cleanup?.uidLifecycleObservationBeforeUserdel ??
        emptyUidLifecycleObservation('not_observed'),
    },
    uidTcpSocketDiagnostics: {
      beforeApp:
        startup?.uidTcpSocketDiagnostics.beforeApp ??
        emptyUidTcpSocketObservation('not_observed'),
      afterPageLoad:
        startup?.uidTcpSocketDiagnostics.afterPageLoad ??
        emptyUidTcpSocketObservation('not_observed'),
    },
    targetUidPreflight: targetUidPreflight ?? null,
    egressBlocked: {
      ipv4: observation?.ipv4Blocked ?? null,
      ipv6: observation?.ipv6Blocked ?? null,
    },
    uidEgressPhaseCounters,
    uidEgressPhaseDeltas,
    egressProbe: policy?.diagnostic ?? null,
    cleanupDiagnostics,
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
      'secretService',
      'safeStorage',
      'desktopObservation',
      'rendererCount',
      'rendererDiagnostics',
      'uidLifecycleDiagnostics',
      'uidTcpSocketDiagnostics',
      'targetUidPreflight',
      'egressBlocked',
      'uidEgressPhaseCounters',
      'uidEgressPhaseDeltas',
      'egressProbe',
      'cleanupDiagnostics',
      'checks',
    ]) &&
    value.schemaVersion === 18 &&
    /^[0-9a-f]{40}$/u.test(value.sourceSha) &&
    ['passed', 'failed'].includes(value.status) &&
    (value.failureCode === null ||
      [
        'cleanup-failed',
        'egress-policy-failed',
        'evidence-incomplete',
        'isolated-node-preflight-failed',
        'network-isolation-unverified',
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
    validateSecretService(value.secretService) &&
    (value.checks?.secretService === 'passed') ===
      secretServicePassed(value.secretService) &&
    (value.checks?.secretService !== 'not_run' ||
      value.secretService.step === 'not-run') &&
    (value.checks?.secretService !== 'failed' ||
      !['not-run', 'none'].includes(value.secretService.step)) &&
    validateSafeStorage(value.safeStorage) &&
    validateDesktopObservation(value.desktopObservation) &&
    validateRendererDiagnostics(value.rendererDiagnostics) &&
    (value.checks?.nativeSandbox !== 'passed' ||
      matchesTrustedRendererSandbox(
        value.rendererDiagnostics,
        value.uidLifecycleDiagnostics?.afterPageLoad,
        value.rendererCount,
      )) &&
    hasKeys(value.uidLifecycleDiagnostics, [
      'beforeApp',
      'afterAppSpawn',
      'afterPageLoad',
      'beforeUserdel',
    ]) &&
    validateUidLifecycleObservation(value.uidLifecycleDiagnostics.beforeApp) &&
    validateUidLifecycleObservation(
      value.uidLifecycleDiagnostics.afterAppSpawn,
    ) &&
    validateUidLifecycleObservation(
      value.uidLifecycleDiagnostics.afterPageLoad,
    ) &&
    validateUidLifecycleObservation(
      value.uidLifecycleDiagnostics.beforeUserdel,
    ) &&
    hasKeys(value.uidTcpSocketDiagnostics, ['beforeApp', 'afterPageLoad']) &&
    validateUidTcpSocketObservation(value.uidTcpSocketDiagnostics.beforeApp) &&
    validateUidTcpSocketObservation(
      value.uidTcpSocketDiagnostics.afterPageLoad,
    ) &&
    validateEgressPhaseCounters({
      beforeApp: value.uidEgressPhaseCounters?.beforeApp,
      afterAppSpawn: value.uidEgressPhaseCounters?.afterAppSpawn,
      afterPageLoad: value.uidEgressPhaseCounters?.afterPageLoad,
    }) &&
    validateCounterObservation(value.uidEgressPhaseCounters?.final) &&
    validateEgressPhaseDeltas(value.uidEgressPhaseDeltas) &&
    (value.checks?.networkIsolationVerified !== 'passed' ||
      (value.checks.egressPolicy === 'passed' &&
        value.checks.negativeEgress === 'passed' &&
        value.egressProbe?.passed === true &&
        [
          value.uidEgressPhaseCounters.beforeApp,
          value.uidEgressPhaseCounters.afterAppSpawn,
          value.uidEgressPhaseCounters.afterPageLoad,
          value.uidEgressPhaseCounters.final,
        ].every(completeVerifiedCounterObservation) &&
        Object.values(value.uidEgressPhaseDeltas).every(
          (delta) => delta.state === 'observed',
        ) &&
        value.egressBlocked.ipv4 ===
          value.uidEgressPhaseCounters.final.ipv4Blocked &&
        value.egressBlocked.ipv6 ===
          value.uidEgressPhaseCounters.final.ipv6Blocked)) &&
    (value.cleanupDiagnostics === null ||
      (hasKeys(value.cleanupDiagnostics, [
        'policyStatus',
        'accountState',
        'userdelStatus',
        'userdelExitStatus',
        'stopDiagnostics',
        'uidProcessObservation',
      ]) &&
        ['passed', 'failed', 'not_run', 'retained'].includes(
          value.cleanupDiagnostics.policyStatus,
        ) &&
        [
          'not_observed',
          'unavailable',
          'absent',
          'uid_match',
          'uid_mismatch',
        ].includes(value.cleanupDiagnostics.accountState) &&
        ['passed', 'failed', 'not_run'].includes(
          value.cleanupDiagnostics.userdelStatus,
        ) &&
        (value.cleanupDiagnostics.userdelExitStatus === null ||
          (Number.isSafeInteger(value.cleanupDiagnostics.userdelExitStatus) &&
            value.cleanupDiagnostics.userdelExitStatus >= 0 &&
            value.cleanupDiagnostics.userdelExitStatus <= 255)) &&
        (value.cleanupDiagnostics.userdelStatus === 'passed'
          ? value.cleanupDiagnostics.userdelExitStatus === 0
          : value.cleanupDiagnostics.userdelStatus === 'failed'
            ? value.cleanupDiagnostics.userdelExitStatus !== null &&
              value.cleanupDiagnostics.userdelExitStatus !== 0
            : value.cleanupDiagnostics.userdelExitStatus === null) &&
        validateUidProcessObservation(
          value.cleanupDiagnostics.uidProcessObservation,
        ) &&
        validateUidProcessStopDiagnostics(
          value.cleanupDiagnostics.stopDiagnostics,
        ))) &&
    (value.cleanupDiagnostics === null
      ? value.checks?.cleanupPolicy === 'not_run'
      : value.checks?.cleanupPolicy ===
        (value.cleanupDiagnostics.policyStatus === 'passed'
          ? 'passed'
          : value.cleanupDiagnostics.policyStatus === 'not_run'
            ? 'not_run'
            : 'failed')) &&
    (value.checks?.cleanupIsolatedProcesses !== 'passed' ||
      (value.cleanupDiagnostics?.accountState === 'absent' &&
        value.cleanupDiagnostics.stopDiagnostics.status === 'passed' &&
        value.cleanupDiagnostics.uidProcessObservation.state === 'observed' &&
        value.cleanupDiagnostics.uidProcessObservation.uidProcessCount ===
          0)) &&
    (value.targetUidPreflight === null ||
      validateTargetUidPreflight(value.targetUidPreflight)) &&
    value.checks?.isolatedNodePreflight ===
      (value.targetUidPreflight?.status ?? 'not_run') &&
    value.runtime.runner === 'ubuntu-24.04' &&
    value.origin === ORIGIN &&
    (value.rendererCount === null ||
      (Number.isSafeInteger(value.rendererCount) &&
        value.rendererCount >= 1 &&
        value.rendererCount <= 2)) &&
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
      'networkIsolationVerified',
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
        secretServicePassed(value.secretService) &&
        safeStoragePassed(value.safeStorage) &&
        desktopObservationPassed(value.desktopObservation) &&
        value.rendererDiagnostics.sandboxReason === 'passed' &&
        value.rendererCount !== null &&
        value.runtime.electron !== null &&
        value.runtime.chromium !== null &&
        value.checks.networkIsolationVerified === 'passed' &&
        value.uidEgressPhaseCounters.final.state === 'observed' &&
        value.uidEgressPhaseCounters.final.policyState === 'verified' &&
        value.cleanupDiagnostics !== null
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
