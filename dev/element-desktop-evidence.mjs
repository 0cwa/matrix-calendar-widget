import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ORIGIN = 'vector://vector';
const CHECK_NAMES = Object.freeze([
  'sourceSha',
  'runner',
  'package',
  'privateProfile',
  'secretService',
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
  'probe-internal-error',
]);
const STAGES = new Set([
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
    !hasKeys(record.runtime, ['node', 'chromium', 'runner']) ||
    !/^\d+\.\d+\.\d+$/u.test(record.runtime.node) ||
    ![null, /^\d+\.\d+\.\d+(?:\.\d+)?$/u].some((pattern) =>
      pattern === null
        ? record.runtime.chromium === null
        : pattern.test(record.runtime.chromium ?? ''),
    ) ||
    record.runtime.runner !== 'ubuntu-24.04' ||
    !hasKeys(record.checks, CHECK_NAMES) ||
    Object.values(record.checks).some((value) => !isStatus(value))
  ) {
    return false;
  }
  if (
    record.status === 'passed' &&
    (record.failureCode !== null ||
      record.rendererCount < 1 ||
      Object.values(record.checks).some((value) => value !== 'passed') ||
      record.package.version !== '1.12.30' ||
      record.package.architecture !== 'amd64' ||
      record.package.sha256 === null ||
      record.runtime.chromium === null)
  ) {
    return false;
  }
  return record.status === 'failed' ? record.failureCode !== null : true;
}

function validatePolicy(record) {
  return (
    hasKeys(record, ['phase', 'status', 'negativeTest']) &&
    record.phase === 'egress-policy' &&
    ['passed', 'failed', 'not_run'].includes(record.status) &&
    ['passed', 'failed', 'not_run'].includes(record.negativeTest) &&
    (record.status === 'passed' ? record.negativeTest === 'passed' : true)
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
    records.length > 4
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
      record.phase === 'desktop-startup'
        ? validateStartup(record, sourceSha)
        : record.phase === 'egress-policy'
          ? validatePolicy(record)
          : record.phase === 'egress-observation'
            ? validateObservation(record)
            : validateCleanup(record);
    if (!valid) throw new Error('invalid Desktop evidence input');
    byPhase.set(record.phase, record);
  }

  const startup = byPhase.get('desktop-startup');
  const policy = byPhase.get('egress-policy');
  const observation = byPhase.get('egress-observation');
  const cleanup = byPhase.get('cleanup');
  const checks = defaultChecks();
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
    : (setFailure(startup, 'startup-observation-missing') ??
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
    schemaVersion: 1,
    sourceSha,
    status: allPassed ? 'passed' : 'failed',
    failureCode,
    package: startup?.package ?? {
      version: null,
      architecture: null,
      sha256: null,
    },
    runtime: startup?.runtime ?? {
      node: null,
      chromium: null,
      runner: 'ubuntu-24.04',
    },
    origin: ORIGIN,
    rendererCount: startup?.rendererCount ?? 0,
    egressBlocked: {
      ipv4: observation?.ipv4Blocked ?? null,
      ipv6: observation?.ipv6Blocked ?? null,
    },
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
      'rendererCount',
      'egressBlocked',
      'checks',
    ]) &&
    value.schemaVersion === 1 &&
    /^[0-9a-f]{40}$/u.test(value.sourceSha) &&
    ['passed', 'failed'].includes(value.status) &&
    (value.failureCode === null ||
      [
        'blocked-egress',
        'cleanup-failed',
        'egress-policy-failed',
        'evidence-incomplete',
        'startup-observation-missing',
        ...STARTUP_FAILURES,
      ].includes(value.failureCode)) &&
    hasKeys(value.package, ['version', 'architecture', 'sha256']) &&
    hasKeys(value.runtime, ['node', 'chromium', 'runner']) &&
    (value.package.version === null || value.package.version === '1.12.30') &&
    (value.package.architecture === null ||
      value.package.architecture === 'amd64') &&
    (value.package.sha256 === null ||
      /^[0-9a-f]{64}$/u.test(value.package.sha256)) &&
    (value.runtime.node === null ||
      /^\d+\.\d+\.\d+$/u.test(value.runtime.node)) &&
    (value.runtime.chromium === null ||
      /^\d+\.\d+\.\d+(?:\.\d+)?$/u.test(value.runtime.chromium)) &&
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
    hasKeys(value.checks, [
      ...CHECK_NAMES,
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
