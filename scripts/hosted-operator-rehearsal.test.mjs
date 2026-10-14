import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  addOperatorRehearsalProfileToComposeArgs,
  assertNoCollision,
  compareForeign,
  failureOperationForStage,
  fixtureIdentity,
  formatFailureDiagnostic,
  formatFailureSummary,
  formatSuccessSummary,
  planOwnedCleanup,
  validateLockedImageInspect,
  writeDockerAdapter,
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

test('the task Docker adapter adds the disabled profile to config only', () => {
  const configArgs = [
    'compose',
    '-p',
    project,
    '--env-file',
    '/private/compose.env',
    '-f',
    '/private/compose.yaml',
    'config',
    '--format',
    'json',
  ];
  assert.deepEqual(addOperatorRehearsalProfileToComposeArgs(configArgs), [
    ...configArgs.slice(0, -3),
    '--profile',
    'operator-rehearsal-disabled',
    ...configArgs.slice(-3),
  ]);

  for (const args of [
    ['compose', '-p', project, 'up', '-d', 'synapse'],
    ['compose', '-p', project, 'restart', 'gateway'],
    ['compose', '-p', project, 'exec', 'gateway', 'true'],
    ['inspect', 'some-container'],
    ['compose', '--unknown-option', 'config'],
  ]) {
    assert.strictEqual(addOperatorRehearsalProfileToComposeArgs(args), args);
  }
});

test('the task Docker adapter forwards arguments, output, and exit status', () => {
  const root = mkdtempSync(join(tmpdir(), 'mcw-docker-adapter-'));
  chmodSync(root, 0o700);
  const nativeDocker = join(root, 'docker-native');
  const capturePath = join(root, 'argv.json');
  const adapterArgs = [
    'compose',
    '-p',
    project,
    '-f',
    '/private/compose.yaml',
    'config',
    '--format',
    'json',
  ];
  try {
    writeFileSync(
      nativeDocker,
      `#!/usr/bin/env node\nconst fs = require('node:fs');\nfs.writeFileSync(process.env.DOCKER_ARGS_CAPTURE, JSON.stringify(process.argv.slice(2)), { mode: 0o600 });\nprocess.stdout.write('adapter-stdout');\nprocess.stderr.write('adapter-stderr');\nprocess.exit(Number(process.env.DOCKER_EXIT));\n`,
      { mode: 0o700, flag: 'wx' },
    );
    chmodSync(nativeDocker, 0o700);
    const { dockerAdapterPath } = writeDockerAdapter(root, nativeDocker);
    const expectedArgs = addOperatorRehearsalProfileToComposeArgs(adapterArgs);
    const result = spawnSync(
      process.execPath,
      [dockerAdapterPath, ...adapterArgs],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          DOCKER_ARGS_CAPTURE: capturePath,
          DOCKER_EXIT: '23',
        },
        timeout: 5000,
      },
    );
    assert.equal(result.error, undefined);
    assert.equal(result.status, 23);
    assert.equal(result.stdout, 'adapter-stdout');
    assert.equal(result.stderr, 'adapter-stderr');
    assert.deepEqual(
      JSON.parse(readFileSync(capturePath, 'utf8')),
      expectedArgs,
    );
    assert.equal(statSync(dockerAdapterPath).mode & 0o777, 0o700);

    const runtimeArgs = ['compose', '-p', project, 'up', '-d', 'synapse'];
    const runtime = spawnSync(
      process.execPath,
      [dockerAdapterPath, ...runtimeArgs],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          DOCKER_ARGS_CAPTURE: capturePath,
          DOCKER_EXIT: '0',
        },
        timeout: 5000,
      },
    );
    assert.equal(runtime.error, undefined);
    assert.equal(runtime.status, 0);
    assert.deepEqual(
      JSON.parse(readFileSync(capturePath, 'utf8')),
      runtimeArgs,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

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
    operation: 'gate',
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
    assert.equal(initial.schema_version, 2);
    assert.equal(initial.failed_phase, 'fixture-setup');
    assert.equal(initial.failure_class, 'gate-failed');
    assert.equal(initial.failure_operation, 'gate');
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
    operation: 'https://private.example/token=secret',
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
  assert.equal(diagnostic.failure_operation, 'unknown');
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

test('failure operation identifiers cover every literal and generated task label', () => {
  const helperSource = readFileSync(
    fileURLToPath(new URL('./hosted-operator-rehearsal.mjs', import.meta.url)),
    'utf8',
  );
  const literalTaskLabels = [
    ...helperSource.matchAll(
      /\b(?:runTask|runFixtureTask|dockerJson)\s*\(\s*'([^']+)'/gu,
    ),
  ].map((match) => match[1]);
  assert.ok(literalTaskLabels.length > 0);
  for (const stage of literalTaskLabels) {
    assert.notEqual(failureOperationForStage(stage), 'unknown', stage);
  }

  const literalCases = new Map([
    ['docker-api-version', 'docker-api-version'],
    ['docker-cli-version', 'docker-client-version'],
    ['docker-compose-version', 'docker-compose-version'],
    ['compose-config', 'compose-config'],
    ['start-synapse-radicale', 'calendar-services-start'],
    ['setup-fixture', 'fixture-setup'],
    ['start-gateway-widget-postgres', 'primary-services-start'],
    ['wait-element-free', 'primary-services-readiness'],
    ['compose-ps-gateway', 'gateway-service-query'],
    ['exec-synapse-smoke', 'synapse-http-smoke'],
    ['compose-run-gateway-smoke', 'gateway-network-smoke'],
    ['widget-http-smoke', 'widget-http-smoke'],
    ['api-crud-probe', 'api-crud-probe'],
    ['prepare-reminder-room', 'reminder-room-prepare'],
    ['enable-reminder-runtime', 'reminder-runtime-enable'],
    ['reminder-initial-fixture', 'reminder-initial-fixture'],
    ['verify-initial-reminder-config', 'reminder-initial-config-verify'],
    ['snapshot-initial-reminder-state', 'reminder-initial-state-snapshot'],
    ['restart-reminder-gateway', 'reminder-gateway-restart'],
    ['reminder-restart-fixture', 'reminder-restart-fixture'],
    ['verify-restart-reminder-config', 'reminder-restart-config-verify'],
    ['verify-restart-delivery', 'reminder-restart-delivery-verify'],
    ['snapshot-restart-reminder-state', 'reminder-restart-state-snapshot'],
    ['restore-paired-stores', 'paired-store-restore'],
    ['reminder-restore-fixture', 'reminder-restore-fixture'],
    ['verify-paired-restore-delivery', 'paired-restore-delivery-verify'],
    ['success-cleanup', 'cleanup-assertion'],
    ['failure-cleanup', 'cleanup-assertion'],
  ]);
  for (const [stage, operation] of literalCases) {
    assert.equal(failureOperationForStage(stage), operation, stage);
  }

  for (const role of ['gateway', 'widget', 'radicale']) {
    assert.equal(
      failureOperationForStage(`inspect-${role}`),
      'source-image-inspect',
    );
    assert.equal(
      failureOperationForStage(`pre-start-image-lock-${role}`),
      'source-image-lock-recheck',
    );
    assert.equal(
      failureOperationForStage(`pre-restore-image-lock-${role}`),
      'source-image-lock-recheck',
    );
  }
  for (const role of ['synapse', 'postgres']) {
    assert.equal(
      failureOperationForStage(`pull-${role}`),
      'fixture-image-pull',
    );
    assert.equal(
      failureOperationForStage(`inspect-${role}`),
      'fixture-image-inspect',
    );
    assert.equal(
      failureOperationForStage(`inspect-pinned-${role}`),
      'fixture-image-lock-recheck',
    );
  }

  const inventoryBases = [
    'baseline',
    'primary',
    'paired-restore',
    'pre-cleanup',
    'failure-cleanup',
    'success-after-containers',
    'success-after-volumes',
    'success-final-inventory',
    'failure-after-containers',
    'failure-after-volumes',
    'failure-final-inventory',
  ];
  const inventorySuffixes = new Map([
    ['containers', 'inventory-list-containers'],
    ['image-ids', 'inventory-list-images'],
    ['network-ids', 'inventory-list-networks'],
    ['volume-names', 'inventory-list-volumes'],
    ['container-inspect', 'inventory-inspect-containers'],
    ['image-inspect', 'inventory-inspect-images'],
    ['network-inspect', 'inventory-inspect-networks'],
    ['volume-inspect', 'inventory-inspect-volumes'],
    ['listeners', 'inventory-list-listeners'],
  ]);
  for (const base of inventoryBases) {
    for (const [suffix, operation] of inventorySuffixes) {
      assert.equal(failureOperationForStage(`${base}-${suffix}`), operation);
    }
  }

  const cleanupSuffixes = new Map([
    ['inspect-container', 'cleanup-container-inspect'],
    ['stop-container', 'cleanup-container-stop'],
    ['remove-container', 'cleanup-container-remove'],
    ['inspect-volume', 'cleanup-volume-inspect'],
    ['remove-volume', 'cleanup-volume-remove'],
    ['inspect-network', 'cleanup-network-inspect'],
    ['remove-network', 'cleanup-network-remove'],
  ]);
  for (const prefix of ['success', 'failure']) {
    for (const [suffix, operation] of cleanupSuffixes) {
      assert.equal(failureOperationForStage(`${prefix}-${suffix}`), operation);
    }
  }

  assert.equal(failureOperationForStage('private-token=secret'), 'unknown');
  assert.equal(failureOperationForStage('fixture-setup'), 'gate');
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
