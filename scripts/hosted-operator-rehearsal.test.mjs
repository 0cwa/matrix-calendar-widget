import assert from 'node:assert/strict';
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  assertNoCollision,
  compareForeign,
  fixtureIdentity,
  formatFailureDiagnostic,
  formatFailureSummary,
  formatSuccessSummary,
  planOwnedCleanup,
  validateLockedImageInspect,
  writeFailureDiagnostic,
} from './hosted-operator-rehearsal.mjs';

const runId = '0123456789abcdef';
const project = `mcw-p0-${runId}`;
const imageId = `sha256:${'a'.repeat(64)}`;
const manifestDigest = `sha256:${'b'.repeat(64)}`;
const sourceSha = '1'.repeat(40);
const workflowPath = fileURLToPath(
  new URL('../.github/workflows/release-image-archive.yml', import.meta.url),
);

function emptyInventory() {
  return {
    containers: [],
    images: [],
    networks: [],
    volumes: [],
    listeners: [],
  };
}

function throwsCode(code) {
  return (error) => error?.code === code;
}

test('fixture tags resolve to immutable linux/amd64 IDs and RepoDigests', () => {
  const expectedTag = 'ghcr.io/element-hq/synapse:v1.161.0';
  const locked = fixtureIdentity(
    [
      {
        Id: imageId,
        Os: 'linux',
        Architecture: 'amd64',
        RepoTags: [expectedTag],
        RepoDigests: [`ghcr.io/element-hq/synapse@${manifestDigest}`],
      },
    ],
    expectedTag,
  );

  assert.equal(locked.ref, `ghcr.io/element-hq/synapse@${manifestDigest}`);
  assert.equal(locked.id, imageId);
  assert.equal(locked.architecture, 'amd64');
});

test('locked image drift fails closed', () => {
  assert.throws(
    () =>
      validateLockedImageInspect(
        [
          {
            Id: `sha256:${'c'.repeat(64)}`,
            Os: 'linux',
            Architecture: 'amd64',
            RepoDigests: [`ghcr.io/element-hq/synapse@${manifestDigest}`],
          },
        ],
        { id: imageId, ref: `ghcr.io/element-hq/synapse@${manifestDigest}` },
      ),
    throwsCode('image-id-drift'),
  );
});

test('a preexisting container in the unique project namespace blocks the run', () => {
  const inventory = emptyInventory();
  inventory.containers.push({
    Id: imageId,
    Name: `/${project}-synapse-1`,
    Config: {
      Labels: {
        'io.matrix-calendar-widget.local-rehearsal': runId,
        'com.docker.compose.project': project,
      },
    },
  });

  assert.throws(
    () => assertNoCollision(inventory, runId, project),
    throwsCode('project-collision'),
  );
});

test('foreign resources with a partial task label fail closed', () => {
  const before = emptyInventory();
  const after = emptyInventory();
  after.volumes.push({
    Name: `${project}_unknown`,
    Labels: { 'io.matrix-calendar-widget.local-rehearsal': runId },
  });

  assert.throws(
    () => compareForeign(before, after, runId, project),
    throwsCode('owner-label-mismatch'),
  );
});

test('failure cleanup accepts an empty owned set and rejects an unknown service', () => {
  assert.deepEqual(
    planOwnedCleanup(emptyInventory(), runId, project, [], {
      allowPartial: true,
    }),
    { containers: [], volumes: [], network: undefined, partial: true },
  );

  const inventory = emptyInventory();
  inventory.containers.push({
    Id: `sha256:${'d'.repeat(64)}`,
    Name: `/${project}-unexpected-1`,
    Image: imageId,
    Config: {
      Labels: {
        'io.matrix-calendar-widget.local-rehearsal': runId,
        'com.docker.compose.project': project,
        'com.docker.compose.service': 'element',
      },
    },
  });
  assert.throws(
    () =>
      planOwnedCleanup(
        inventory,
        runId,
        project,
        [{ role: 'synapse', id: imageId }],
        { allowPartial: true },
      ),
    throwsCode('service-image-mismatch'),
  );
});

test('success summaries require cleanup; failure summaries disclose only fixed fields', () => {
  assert.throws(
    () =>
      formatSuccessSummary({
        result: 'pending-cleanup',
        cleanup_verified: false,
        source_sha: sourceSha,
      }),
    throwsCode('cleanup-not-verified'),
  );
  assert.match(
    formatSuccessSummary({
      result: 'passed',
      cleanup_verified: true,
      source_sha: sourceSha,
    }),
    /Exact owned-resource cleanup: passed/u,
  );

  const summary = formatFailureSummary(
    sourceSha,
    'secret-token-in-error',
    'unverified',
  );
  assert.match(summary, /Failed phase: runner/u);
  assert.match(summary, /Owned cleanup: unverified/u);
  assert.match(summary, /Success receipt: not published/u);
  assert.doesNotMatch(summary, /secret-token/u);
});

test('failure diagnostic writes fixed identity and cleanup fields outside task data', () => {
  const runnerTemp = mkdtempSync(join(tmpdir(), 'mcw-operator-summary-'));
  chmodSync(runnerTemp, 0o700);
  const fields = {
    sourceSha,
    workflowSha: '2'.repeat(40),
    runId,
    attempt: '1',
    phase: 'fixture-setup',
    failureClass: 'gate-failed',
    sourceImageIds: [imageId, manifestDigest, `sha256:${'c'.repeat(64)}`],
    cleanupStatus: 'pending',
    cleanupAttempted: false,
  };

  try {
    assert.equal(writeFailureDiagnostic(runnerTemp, fields), true);
    const file = join(
      runnerTemp,
      'matrix-calendar-widget-operator-rehearsal-failure.json',
    );
    assert.equal(
      file,
      join(
        runnerTemp,
        'matrix-calendar-widget-operator-rehearsal-failure.json',
      ),
    );
    assert.equal(statSync(file).mode & 0o777, 0o600);
    const initial = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(initial.failed_phase, 'fixture-setup');
    assert.equal(initial.failure_class, 'gate-failed');
    assert.deepEqual(initial.source_image_ids, fields.sourceImageIds);
    assert.equal(initial.cleanup_status, 'pending');
    assert.equal(initial.cleanup_attempted, false);
    assert.equal(initial.owned_cleanup_verified, false);

    assert.equal(
      writeFailureDiagnostic(
        runnerTemp,
        { ...fields, cleanupStatus: 'verified', cleanupAttempted: true },
        true,
      ),
      true,
    );
    const final = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(final.cleanup_status, 'verified');
    assert.equal(final.cleanup_attempted, true);
    assert.equal(final.owned_cleanup_verified, true);
    assert.equal(final.foreign_inventory_unchanged, true);
  } finally {
    rmSync(runnerTemp, { recursive: true, force: true });
  }
});

test('failure diagnostic maps hostile values to closed fields and never claims unverified cleanup', () => {
  const diagnostic = formatFailureDiagnostic({
    sourceSha: 'secret-source-token',
    workflowSha: 'https://private.example/workflow',
    runId: '123?token=secret',
    attempt: 'BEGIN:VCALENDAR',
    phase: 'private-server-name',
    failureClass: 'token=secret',
    sourceImageIds: [
      imageId,
      'https://private.example/secret',
      'BEGIN:VCALENDAR',
    ],
    cleanupStatus: 'verified',
    cleanupAttempted: false,
  });
  const serialized = JSON.stringify(diagnostic);
  assert.equal(diagnostic.failed_phase, 'runner');
  assert.equal(diagnostic.failure_class, 'unknown');
  assert.equal(diagnostic.source_sha, 'unavailable');
  assert.equal(diagnostic.workflow_sha, 'unavailable');
  assert.equal(diagnostic.run_id, 'unavailable');
  assert.equal(diagnostic.attempt, 'unavailable');
  assert.deepEqual(diagnostic.source_image_ids, []);
  assert.equal(diagnostic.cleanup_status, 'unverified');
  assert.equal(diagnostic.owned_cleanup_verified, false);
  assert.equal(diagnostic.foreign_inventory_unchanged, false);
  assert.doesNotMatch(serialized, /secret|https|private|BEGIN:VCALENDAR/u);
});

test('workflow rehearsal input defaults off and executes between manifest verification and upload', () => {
  const workflow = readFileSync(workflowPath, 'utf8');
  assert.match(
    workflow,
    /operator_rehearsal:[\s\S]*?default: false[\s\S]*?type: boolean/u,
  );

  const verifyIndex = workflow.indexOf('release-image-archive.mjs verify');
  const rehearsalIndex = workflow.indexOf(
    'Run the opt-in hosted Docker operator rehearsal',
  );
  const uploadIndex = workflow.indexOf(
    'Upload immutable per-run image archive',
  );
  const failureUploadIndex = workflow.indexOf(
    'Upload the sanitized operator rehearsal failure summary',
  );
  const rehearsalStep = workflow.slice(rehearsalIndex, failureUploadIndex);
  const failureUpload = workflow.slice(
    failureUploadIndex,
    workflow.indexOf('\n      - name:', failureUploadIndex + 1),
  );
  assert.ok(
    verifyIndex >= 0 &&
      rehearsalIndex > verifyIndex &&
      failureUploadIndex > rehearsalIndex &&
      uploadIndex > rehearsalIndex,
  );
  assert.match(rehearsalStep, /id: operator_rehearsal/u);
  assert.match(
    failureUpload,
    /if: \$\{\{ failure\(\) && inputs\.operator_rehearsal && steps\.operator_rehearsal\.outcome == 'failure' \}\}/u,
  );
  assert.ok(
    failureUpload.includes(
      'path: ${{ runner.temp }}/matrix-calendar-widget-operator-rehearsal-failure.json',
    ),
  );
  assert.match(failureUpload, /retention-days: 1/u);
  assert.match(failureUpload, /if-no-files-found: ignore/u);
  assert.doesNotMatch(failureUpload, /\*/u);
});
