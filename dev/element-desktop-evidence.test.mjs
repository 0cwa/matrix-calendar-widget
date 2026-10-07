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
    'config',
    'updatesDisabled',
    'desktopProcess',
    'loopbackCdp',
    'packagedOrigin',
    'nativeSandbox',
    'nodeIntegrationDisabled',
  ].map((name) => [name, 'passed']),
);

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
        node: '22.23.3',
        chromium: '149.0.7827.55',
        runner: 'ubuntu-24.04',
      },
      origin: 'vector://vector',
      rendererCount: 1,
      checks,
    },
    { phase: 'egress-policy', status: 'passed', negativeTest: 'passed' },
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
  assert.equal(summary.failureCode, null);
  assert.deepEqual(summary.egressBlocked, { ipv4: 0, ipv6: 0 });
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
});

test('Desktop evidence cannot pass with missing policy or unsuccessful cleanup', () => {
  const missingPolicy = stages().filter(
    (record) => record.phase !== 'egress-policy',
  );
  const missingSummary = sanitizeDesktopStages(missingPolicy, sourceSha);
  assert.equal(missingSummary.status, 'failed');
  assert.equal(missingSummary.failureCode, 'evidence-incomplete');

  const failedCleanup = stages();
  failedCleanup[3].policy = 'failed';
  const cleanupSummary = sanitizeDesktopStages(failedCleanup, sourceSha);
  assert.equal(cleanupSummary.status, 'failed');
  assert.equal(cleanupSummary.failureCode, 'cleanup-failed');

  const malformedPackage = sanitizeDesktopStages(stages(), sourceSha);
  malformedPackage.package.version = '1.12.31';
  assert.equal(validDesktopSummary(malformedPackage), false);
});
