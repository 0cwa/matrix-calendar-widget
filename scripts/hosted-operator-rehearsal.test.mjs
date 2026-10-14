import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  assertNoCollision,
  compareForeign,
  fixtureIdentity,
  formatFailureSummary,
  formatSuccessSummary,
  planOwnedCleanup,
  validateLockedImageInspect,
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
  assert.ok(
    verifyIndex >= 0 &&
      rehearsalIndex > verifyIndex &&
      uploadIndex > rehearsalIndex,
  );
});
