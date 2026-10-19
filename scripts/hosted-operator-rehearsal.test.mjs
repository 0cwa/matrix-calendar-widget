import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { release as osRelease, tmpdir } from 'node:os';
import { delimiter, dirname, isAbsolute, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import {
  API_PROBE_FAILURE_CODES,
  API_PROBE_STAGES,
  runElementAcceptanceApiProbe,
} from '../dev/element-acceptance-api-probe.mjs';
import { LOCAL_REMINDER_FIXTURE_FAILURE_PHASES } from '../dev/local-reminder-fixture.mjs';
import { formatStartupStageFailure } from '../dev/synapse-startup-diagnostic.mjs';
import {
  addOperatorRehearsalProfileToComposeArgs,
  assertApiCrudProbePassed,
  assertNoCollision,
  assertReminderResult,
  assertTaskServiceSet,
  canonicalLocalJson,
  compareForeign,
  enableHostedSharedDockerRehearsal,
  exactSourceImages,
  failureOperationForStage,
  fixtureIdentity,
  formatFailureDiagnostic,
  formatFailureSummary,
  formatSuccessSummary,
  GATEWAY_NETWORK_SMOKE_SCRIPT,
  gatewayNetworkSmokeArgs,
  handoffGeneratedComposeEnvironment,
  hashExtractedGitTree,
  HOSTED_INHERITED_IMAGE_TMPFS,
  HOSTED_REMINDER_FIXTURE_FAILURE_PHASES,
  isLocalProfileHostedContext,
  listenerScopeDelta,
  LOCAL_MICROSANDBOX_MANIFEST_EXAMPLE_WITH_PLACEHOLDERS,
  LOCAL_MICROSANDBOX_MANIFEST_SCHEMA,
  LOCAL_MICROSANDBOX_PROBE_RECEIPT_EXAMPLE_WITH_PLACEHOLDERS,
  LOCAL_MICROSANDBOX_PROBE_RECEIPT_SCHEMA,
  localProfileReceipt,
  lockedLocalFixtureIdentity,
  makeComposeOverride,
  parseApiCrudProbeFailure,
  parseGatewayNetworkSmokeFailure,
  parseOperatorRehearsalProfileArgs,
  parseReminderFixtureOutcome,
  parseStartupFailureMarker,
  planOwnedCleanup,
  removeOwnedResources,
  runTask,
  taskEnvironment,
  validateComposeModel,
  validateLocalManifestContract,
  validateLocalProbeReceipt,
  validateLocalProfileReceipt,
  validateLockedImageInspect,
  writeDockerAdapter,
  writeFailureDiagnostic,
  writeLocalDockerShim,
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

function ownedContainer(service, mounts) {
  return {
    Id: `container-${service}-private-id`,
    Name: `/${project}-${service}`,
    Config: {
      Labels: {
        'io.matrix-calendar-widget.local-rehearsal': runId,
        'com.docker.compose.project': project,
        'com.docker.compose.service': service,
      },
    },
    Mounts: mounts,
  };
}

function foreignVolume(name) {
  return { Name: name, Labels: {} };
}

function foreignFailure(before, after, checkpoint) {
  let failure;
  assert.throws(
    () => compareForeign(before, after, runId, project, checkpoint),
    (error) => {
      failure = error;
      return error.code === 'foreign-state-changed';
    },
  );
  return failure;
}

function reminderFixtureSummary({
  flow = 'initial',
  status = 'passed',
  failurePhase,
  markerCount = flow === 'initial' ? 1 : flow === 'restart' ? 2 : 3,
  cleanup = {
    reminderConfiguration: 'not-attempted',
    event: 'not-attempted',
  },
} = {}) {
  const summary = {
    phase: 'local-reminder-fixture',
    flow,
    status,
    markerWritten: status === 'passed',
    cleanup,
  };
  if (status === 'passed') summary.markerCount = markerCount;
  else summary.failurePhase = failurePhase;
  return summary;
}

async function runMockGatewayNetworkSmoke(mockFetch) {
  const output = [];
  const requests = [];
  const child = {
    exitCode: 0,
    stdout: { write: (value) => output.push(value) },
  };
  await runInNewContext(GATEWAY_NETWORK_SMOKE_SCRIPT, {
    AbortSignal: { timeout: (milliseconds) => ({ milliseconds }) },
    fetch: async (url, options) => {
      requests.push({ url, options });
      return mockFetch(url, options);
    },
    process: child,
  });
  return {
    output: output.join(''),
    requests,
    processExitCode: child.exitCode,
  };
}

function apiProbeSummary(failedStage, failureCode, failureHttpStatus = null) {
  const failedIndex = API_PROBE_STAGES.indexOf(failedStage);
  const stages = Object.fromEntries(
    API_PROBE_STAGES.map((stage, index) => [
      stage,
      stage === 'owned-cleanup'
        ? failedStage === stage
          ? 'failed'
          : 'passed'
        : failedStage === undefined
          ? 'passed'
          : index < failedIndex
            ? 'passed'
            : index === failedIndex
              ? 'failed'
              : 'skipped',
    ]),
  );
  return {
    status: failedStage === undefined ? 'passed' : 'failed',
    stages,
    ...(failureCode === undefined ? {} : { failureCode, failureHttpStatus }),
  };
}

test('profile selection keeps hosted as the zero-argument default and requires an absolute local manifest', () => {
  assert.deepEqual(parseOperatorRehearsalProfileArgs([]), {
    profile: 'hosted',
  });
  assert.deepEqual(
    parseOperatorRehearsalProfileArgs([
      '--profile',
      'local-microsandbox',
      '--manifest',
      '/private/job/manifest.json',
    ]),
    {
      profile: 'local-microsandbox',
      manifestPath: '/private/job/manifest.json',
    },
  );
  for (const args of [
    ['--profile', 'local-microsandbox'],
    ['--profile', 'hosted'],
    ['--profile', 'local-microsandbox', '--manifest', 'relative.json'],
    ['--manifest', '/private/job/manifest.json'],
  ]) {
    assert.throws(
      () => parseOperatorRehearsalProfileArgs(args),
      (error) => error.code === 'profile-arguments-invalid',
    );
  }
});

test('local profile manifest is closed and pins source, lineage, guest networking, and fixture identities', () => {
  const example = structuredClone(
    LOCAL_MICROSANDBOX_MANIFEST_EXAMPLE_WITH_PLACEHOLDERS,
  );
  assert.equal(validateLocalManifestContract(example), example);
  assert.equal(example.vm_proof.network_enabled, true);
  assert.equal(
    Object.hasOwn(example.synthetic_identity, 'external_matrix_egress'),
    false,
  );
  assert.equal(LOCAL_MICROSANDBOX_MANIFEST_SCHEMA.additionalProperties, false);
  assert.equal(
    LOCAL_MICROSANDBOX_PROBE_RECEIPT_SCHEMA.additionalProperties,
    false,
  );
  assert.equal(
    canonicalLocalJson(
      JSON.parse(
        canonicalLocalJson(
          LOCAL_MICROSANDBOX_PROBE_RECEIPT_EXAMPLE_WITH_PLACEHOLDERS,
        ),
      ),
    ),
    canonicalLocalJson(
      LOCAL_MICROSANDBOX_PROBE_RECEIPT_EXAMPLE_WITH_PLACEHOLDERS,
    ),
  );

  const invalidManifests = [
    (value) => {
      value.extra = 'closed contracts reject unknown keys';
    },
    (value) => {
      value.source.commit = 'a'.repeat(40);
    },
    (value) => {
      value.tooling.accepted_hosted_lineage = 'b'.repeat(40);
    },
    (value) => {
      value.vm_proof.host_mounts = ['/host'];
    },
    (value) => {
      value.vm_proof.host_credentials_mounted = true;
    },
    (value) => {
      value.vm_proof.network_enabled = false;
    },
    (value) => {
      value.paths.docker_socket = '/job/private/other.sock';
    },
    (value) => {
      value.fixture_lock.images[1].role = 'synapse';
    },
    (value) => {
      value.fixture_lock.images[1].metadata_proof_sha256 = 'bad';
    },
  ];
  for (const mutate of invalidManifests) {
    const invalid = structuredClone(
      LOCAL_MICROSANDBOX_MANIFEST_EXAMPLE_WITH_PLACEHOLDERS,
    );
    mutate(invalid);
    assert.throws(() => validateLocalManifestContract(invalid));
  }
});

test('local Postgres fixture manifest accepts only the Docker Hub short alias spelling', () => {
  const shortAlias = structuredClone(
    LOCAL_MICROSANDBOX_MANIFEST_EXAMPLE_WITH_PLACEHOLDERS,
  );
  shortAlias.fixture_lock.images[1].repo_digest = `postgres@sha256:${'0'.repeat(64)}`;
  assert.equal(validateLocalManifestContract(shortAlias), shortAlias);

  for (const repoDigest of [
    `registry.example/postgres@sha256:${'0'.repeat(64)}`,
    `postgres@sha256:${'g'.repeat(64)}`,
  ]) {
    const invalid = structuredClone(
      LOCAL_MICROSANDBOX_MANIFEST_EXAMPLE_WITH_PLACEHOLDERS,
    );
    invalid.fixture_lock.images[1].repo_digest = repoDigest;
    assert.throws(
      () => validateLocalManifestContract(invalid),
      (error) => error.code === 'fixture-image-invalid',
    );
  }
});

test('local fixture lock rejects wrong loaded IDs, tags, repo digests, and platforms without pulling', () => {
  const expected = {
    role: 'postgres',
    tag: 'postgres:16.15-alpine3.23',
    repo_digest: `docker.io/library/postgres@sha256:${'b'.repeat(64)}`,
    image_id: `sha256:${'c'.repeat(64)}`,
    platform: 'linux/amd64',
    metadata_proof_sha256: 'd'.repeat(64),
  };
  const actual = [
    {
      Id: expected.image_id,
      Os: 'linux',
      Architecture: 'amd64',
      RepoTags: [expected.tag],
      RepoDigests: [expected.repo_digest],
    },
  ];
  assert.equal(
    lockedLocalFixtureIdentity(actual, expected).ref,
    expected.repo_digest,
  );
  const shortAlias = {
    ...expected,
    repo_digest: `postgres@sha256:${'b'.repeat(64)}`,
  };
  assert.equal(
    lockedLocalFixtureIdentity(
      [{ ...actual[0], RepoDigests: [shortAlias.repo_digest] }],
      shortAlias,
    ).ref,
    shortAlias.repo_digest,
  );
  for (const invalid of [
    [{ ...actual[0], Id: `sha256:${'e'.repeat(64)}` }],
    [{ ...actual[0], Architecture: 'arm64' }],
    [{ ...actual[0], RepoTags: ['postgres:latest'] }],
    [{ ...actual[0], RepoDigests: [] }],
  ]) {
    assert.throws(
      () => lockedLocalFixtureIdentity(invalid, expected),
      (error) => error.code === 'fixture-lock-mismatch',
    );
  }
});

test('local release manifest binding uses its explicit run ID without hosted environment', (t) => {
  const previousRunId = process.env.RELEASE_RUN_ID;
  delete process.env.RELEASE_RUN_ID;
  t.after(() => {
    if (previousRunId === undefined) delete process.env.RELEASE_RUN_ID;
    else process.env.RELEASE_RUN_ID = previousRunId;
  });

  const source = LOCAL_MICROSANDBOX_MANIFEST_EXAMPLE_WITH_PLACEHOLDERS.source;
  const lineage =
    LOCAL_MICROSANDBOX_MANIFEST_EXAMPLE_WITH_PLACEHOLDERS.tooling
      .accepted_hosted_lineage;
  const runId = '38913010664';
  const attempt = '1';
  const names = ['server', 'widget', 'radicale'];
  const prefixes = [
    'matrix-calendar-widget/server',
    'matrix-calendar-widget/widget',
    'matrix-calendar-widget/radicale-openid',
  ];
  const manifest = {
    schema_version: 2,
    source: {
      sha: source.commit,
      tree: source.tree,
      dispatch_sha: lineage,
    },
    workflow: {
      sha: lineage,
      repository: '0cwa/matrix-calendar-widget',
      ref: '0cwa/matrix-calendar-widget/.github/workflows/release-image-archive.yml@refs/heads/main',
      run_id: Number(runId),
      run_attempt: Number(attempt),
    },
    platform: 'linux/amd64',
    images: names.map((name, index) => ({
      name,
      tag: `${prefixes[index]}:archive-${runId}-${attempt}`,
      image_id: imageId,
      buildx_manifest_digest: manifestDigest,
      platform: 'linux/amd64',
    })),
  };

  assert.equal(
    exactSourceImages(manifest, source.commit, source.tree, runId, attempt, {
      dispatchSha: lineage,
      workflowSha: lineage,
    }).length,
    3,
  );
});

test('microsandbox probe receipt binds current guest identity and manifest provenance', (t) => {
  const runnerTemp = mkdtempSync(join(tmpdir(), 'mcw-local-vm-proof-'));
  chmodSync(runnerTemp, 0o700);
  t.after(() => rmSync(runnerTemp, { recursive: true, force: true }));
  const manifest = structuredClone(
    LOCAL_MICROSANDBOX_MANIFEST_EXAMPLE_WITH_PLACEHOLDERS,
  );
  manifest.paths.runner_temp = runnerTemp;
  manifest.paths.docker_socket = join(runnerTemp, 'docker', 'docker.sock');
  manifest.vm_proof.docker_endpoint = `unix://${manifest.paths.docker_socket}`;
  manifest.vm_proof.guest_kernel = osRelease();
  const receiptPath = join(runnerTemp, 'vm-probe.json');
  const receipt = structuredClone(
    LOCAL_MICROSANDBOX_PROBE_RECEIPT_EXAMPLE_WITH_PLACEHOLDERS,
  );
  receipt.instance_id = manifest.vm_proof.instance_id;
  receipt.guest_kernel = osRelease();
  receipt.guest_boot_id = readFileSync(
    '/proc/sys/kernel/random/boot_id',
    'utf8',
  ).trim();
  receipt.observed_at = new Date().toISOString();
  receipt.docker_endpoint = manifest.vm_proof.docker_endpoint;
  receipt.provenance = {
    source_commit: manifest.source.commit,
    source_tree: manifest.source.tree,
    source_archive_sha256: manifest.source.git_archive_sha256,
    tooling_commit: manifest.tooling.commit,
    tooling_tree: manifest.tooling.tree,
    tooling_archive_sha256: manifest.tooling.git_archive_sha256,
    helper_sha256: manifest.tooling.helper_sha256,
    release_manifest_sha256: manifest.release_archive.manifest_sha256,
    release_run_id: manifest.release_archive.release_run_id,
    attempt: manifest.release_archive.attempt,
    fixture_lock_sha256: createHash('sha256')
      .update(canonicalLocalJson(manifest.fixture_lock))
      .digest('hex'),
  };
  const writeReceipt = (value) => {
    const bytes = canonicalLocalJson(value);
    writeFileSync(receiptPath, bytes, { mode: 0o600 });
    chmodSync(receiptPath, 0o600);
    manifest.vm_proof.probe_receipt_sha256 = createHash('sha256')
      .update(bytes)
      .digest('hex');
  };
  writeReceipt(receipt);
  assert.equal(receipt.schema_version, 1);
  assert.equal(receipt.result, 'passed');
  assert.equal(receipt.provider, 'microsandbox');
  assert.equal(receipt.network_enabled, true);
  assert.equal(receipt.provider, manifest.vm_proof.provider);
  assert.equal(receipt.instance_id, manifest.vm_proof.instance_id);
  assert.equal(receipt.guest_kernel, manifest.vm_proof.guest_kernel);
  assert.equal(receipt.guest_kernel, osRelease());
  assert.equal(
    receipt.guest_boot_id,
    readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(),
  );
  assert.equal(
    new Date(Date.parse(receipt.observed_at)).toISOString(),
    receipt.observed_at,
  );
  assert.equal(receipt.network_enabled, manifest.vm_proof.network_enabled);
  assert.equal(receipt.host_mounts.length, 0);
  assert.equal(receipt.host_docker_socket_forwarded, false);
  assert.equal(receipt.host_credentials_mounted, false);
  assert.equal(receipt.docker_endpoint, manifest.vm_proof.docker_endpoint);
  assert.deepEqual(receipt.provenance, {
    source_commit: manifest.source.commit,
    source_tree: manifest.source.tree,
    source_archive_sha256: manifest.source.git_archive_sha256,
    tooling_commit: manifest.tooling.commit,
    tooling_tree: manifest.tooling.tree,
    tooling_archive_sha256: manifest.tooling.git_archive_sha256,
    helper_sha256: manifest.tooling.helper_sha256,
    release_manifest_sha256: manifest.release_archive.manifest_sha256,
    release_run_id: manifest.release_archive.release_run_id,
    attempt: manifest.release_archive.attempt,
    fixture_lock_sha256: createHash('sha256')
      .update(canonicalLocalJson(manifest.fixture_lock))
      .digest('hex'),
  });
  assert.ok(Object.values(receipt.checks).every((value) => value === 'passed'));
  assert.equal(
    validateLocalProbeReceipt(manifest, receiptPath).result,
    'passed',
  );

  for (const mutate of [
    (value) => {
      value.host_mounts = ['/host'];
    },
    (value) => {
      value.guest_boot_id = '00000000-0000-0000-0000-000000000000';
    },
    (value) => {
      value.network_enabled = false;
    },
    (value) => {
      value.checks.namespaces = 'failed';
    },
    (value) => {
      value.provenance.tooling_commit = 'f'.repeat(40);
    },
  ]) {
    const invalid = structuredClone(receipt);
    mutate(invalid);
    writeReceipt(invalid);
    assert.throws(() => validateLocalProbeReceipt(manifest, receiptPath));
  }
});

test('local profile rejects GitHub hosted context and cannot publish a hosted summary', (t) => {
  assert.equal(isLocalProfileHostedContext({}), false);
  assert.equal(isLocalProfileHostedContext({ GITHUB_ACTIONS: 'true' }), true);
  assert.equal(
    isLocalProfileHostedContext({ RUNNER_ENVIRONMENT: 'github-hosted' }),
    true,
  );

  const temporaryRoot = mkdtempSync(join(tmpdir(), 'mcw-local-profile-guard-'));
  t.after(() => rmSync(temporaryRoot, { recursive: true, force: true }));
  const summaryPath = join(temporaryRoot, 'summary.md');
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(
        new URL('./hosted-operator-rehearsal.mjs', import.meta.url),
      ),
      '--profile',
      'local-microsandbox',
      '--manifest',
      join(temporaryRoot, 'not-read-on-hosted-runner.json'),
    ],
    {
      cwd: temporaryRoot,
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        OPERATOR_REHEARSAL_ENABLED: 'true',
        GITHUB_ACTIONS: 'true',
        GITHUB_STEP_SUMMARY: summaryPath,
      },
    },
  );
  assert.equal(result.status, 1);
  assert.equal(
    result.stderr,
    'Local microsandbox operator rehearsal failed; owned cleanup not-run.\n',
  );
  assert.equal(existsSync(summaryPath), false);
});

test('local receipt refuses false success and carries only its closed contract', () => {
  const manifest = JSON.parse(
    canonicalLocalJson(LOCAL_MICROSANDBOX_MANIFEST_EXAMPLE_WITH_PLACEHOLDERS),
  );
  const checkNames = [
    'source_binding',
    'fixture_identity',
    'api_authorization_and_crud',
    'reminder_initial_and_restart',
    'paired_store_restore',
    'owned_cleanup',
    'foreign_inventory_preservation',
  ];
  assert.equal(
    validateLocalProfileReceipt(
      localProfileReceipt(
        manifest,
        Object.fromEntries(checkNames.map((name) => [name, 'not-run'])),
        'failed',
        'preflight',
        'not-run',
      ),
      manifest,
    ).result,
    'failed',
  );
  const checks = Object.fromEntries(checkNames.map((name) => [name, 'passed']));
  const successful = localProfileReceipt(
    manifest,
    checks,
    'passed',
    null,
    'verified',
  );
  assert.equal(
    validateLocalProfileReceipt(successful, manifest).result,
    'passed',
  );
  const roundTripped = JSON.parse(canonicalLocalJson(successful));
  assert.equal(
    validateLocalProfileReceipt(roundTripped, manifest).result,
    'passed',
  );
  assert.equal(successful.vm_proof.network_enabled, true);
  assert.equal(
    Object.hasOwn(successful.synthetic_identity, 'external_matrix_egress'),
    false,
  );
  assert.throws(
    () =>
      validateLocalProfileReceipt(
        {
          ...successful,
          vm_proof: { ...successful.vm_proof, network_enabled: false },
        },
        manifest,
      ),
    (error) => error.code === 'local-receipt-provenance-mismatch',
  );
  assert.throws(
    () =>
      validateLocalProfileReceipt(
        {
          ...roundTripped,
          tooling: { ...roundTripped.tooling, helper_sha256: 'f'.repeat(64) },
        },
        manifest,
      ),
    (error) => error.code === 'local-receipt-provenance-mismatch',
  );
  assert.throws(
    () =>
      validateLocalProfileReceipt(
        { ...successful, cleanup_status: 'unverified' },
        manifest,
      ),
    (error) => error.code === 'local-receipt-false-success',
  );
  assert.throws(
    () =>
      validateLocalProfileReceipt(
        { ...successful, unexpected: 'private-path' },
        manifest,
      ),
    (error) => error.code === 'local-receipt-shape-invalid',
  );
});

test('extracted Git archive hashing matches Git tree identity and rejects symlinks', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'mcw-git-tree-hash-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'file.txt'), 'local tree hash fixture\n', {
    mode: 0o644,
  });
  mkdirSync(join(root, 'nested'));
  writeFileSync(join(root, 'nested', 'run.sh'), '#!/bin/sh\nexit 0\n', {
    mode: 0o755,
  });
  chmodSync(join(root, 'nested', 'run.sh'), 0o755);
  const init = spawnSync('git', ['init', '--quiet', root], {
    encoding: 'utf8',
  });
  assert.equal(init.status, 0, init.stderr);
  const add = spawnSync('git', ['-C', root, 'add', '--all'], {
    encoding: 'utf8',
  });
  assert.equal(add.status, 0, add.stderr);
  const tree = spawnSync('git', ['-C', root, 'write-tree'], {
    encoding: 'utf8',
  });
  assert.equal(tree.status, 0, tree.stderr);
  rmSync(join(root, '.git'), { recursive: true, force: true });
  assert.equal(hashExtractedGitTree(root), tree.stdout.trim());
  symlinkSync(join(root, 'file.txt'), join(root, 'link.txt'));
  assert.throws(
    () => hashExtractedGitTree(root),
    (error) => error.code === 'archive-tree-entry-invalid',
  );
});

test('gateway network smoke passes through the direct Node entrypoint for expected service responses', async () => {
  const compose = [
    'compose',
    '--project-name',
    project,
    '--env-file',
    '/private/compose.env',
  ];
  const args = gatewayNetworkSmokeArgs(compose, runId, project);
  assert.deepEqual(args.slice(compose.length), [
    'run',
    '--pull',
    'never',
    '--no-deps',
    '--rm',
    '--label',
    `io.matrix-calendar-widget.local-rehearsal=${runId}`,
    '--name',
    `${project}-local-${runId}-900`,
    '--entrypoint',
    'node',
    'gateway',
    '-e',
    GATEWAY_NETWORK_SMOKE_SCRIPT,
  ]);

  const composeSource = readFileSync(
    fileURLToPath(
      new URL('../dev/element-acceptance.compose.yaml', import.meta.url),
    ),
    'utf8',
  );
  assert.match(
    composeSource,
    /^  gateway:\n[\s\S]*?dockerfile: matrix-calendar-server\/Dockerfile\n[\s\S]*?^  widget:/mu,
  );

  const dockerfile = readFileSync(
    fileURLToPath(
      new URL('../matrix-calendar-server/Dockerfile', import.meta.url),
    ),
    'utf8',
  );
  assert.match(dockerfile, /^CMD \["node", "\.\/lib\/src\/index\.js"\]$/mu);
  assert.doesNotMatch(dockerfile, /^ENTRYPOINT\b/mu);

  const result = await runMockGatewayNetworkSmoke(async (url) => ({
    status: url.includes('synapse') ? 200 : 403,
    body: 'private response body',
  }));
  assert.equal(result.processExitCode, 0);
  assert.equal(result.output, '');
  assert.deepEqual(
    result.requests.map(({ url }) => url),
    ['http://synapse:8008/_matrix/client/versions', 'http://radicale:5232/'],
  );
  for (const { options } of result.requests) {
    assert.equal(options.redirect, 'manual');
    assert.equal(options.signal.milliseconds, 5000);
  }
});

test('gateway network smoke accepts Radicale root redirect but rejects an unexpected success page', async () => {
  const redirectedRoot = await runMockGatewayNetworkSmoke(async (url) => ({
    status: url.includes('synapse') ? 200 : 302,
    body: 'private response body',
  }));
  assert.equal(redirectedRoot.processExitCode, 0);
  assert.equal(redirectedRoot.output, '');
  assert.equal(redirectedRoot.requests[1].options.redirect, 'manual');

  const unexpectedSuccessPage = await runMockGatewayNetworkSmoke(async () => ({
    status: 200,
    body: 'private response body',
  }));
  assert.equal(unexpectedSuccessPage.processExitCode, 1);
  assert.equal(
    unexpectedSuccessPage.output,
    'gateway_network_smoke synapse=200:none radicale=200:none\n',
  );
});

test('gateway network smoke failure marker records bounded role results only', async () => {
  const result = await runMockGatewayNetworkSmoke(async (url) => {
    if (url.includes('synapse')) {
      return { status: 503, body: 'private response body' };
    }
    const error = new Error('private error with token=secret');
    error.cause = { code: 'ECONNREFUSED' };
    throw error;
  });

  assert.equal(result.processExitCode, 1);
  assert.equal(
    result.output,
    'gateway_network_smoke synapse=503:none radicale=unavailable:connection-refused\n',
  );
  assert.deepEqual(
    parseGatewayNetworkSmokeFailure(result.output, result.processExitCode),
    {
      marker_status: 'captured',
      process_exit_code: 1,
      synapse: { http_status: 503, error_class: 'none' },
      radicale: {
        http_status: 'unavailable',
        error_class: 'connection-refused',
      },
    },
  );
  assert.doesNotMatch(result.output, /https?:|:8008|:5232|secret|private/u);
});

test('gateway network smoke parser distinguishes absent and invalid markers without copying them', () => {
  const absent = parseGatewayNetworkSmokeFailure(
    'node exited before the smoke marker',
    null,
  );
  assert.equal(absent.marker_status, 'absent');
  assert.equal(absent.process_exit_code, 'unavailable');

  const invalid = parseGatewayNetworkSmokeFailure(
    'gateway_network_smoke synapse=200:none radicale=401:none token=secret\n',
    1,
  );
  assert.equal(invalid.marker_status, 'invalid');
  assert.equal(invalid.process_exit_code, 1);
  assert.deepEqual(invalid.synapse, {
    http_status: 'unavailable',
    error_class: 'unavailable',
  });
  assert.doesNotMatch(JSON.stringify(invalid), /token|secret/u);

  const repeated = parseGatewayNetworkSmokeFailure(
    'gateway_network_smoke synapse=200:none radicale=401:none\n'.repeat(2),
    1,
  );
  assert.equal(repeated.marker_status, 'invalid');
});

test('failure artifact carries only the closed gateway smoke classification', () => {
  const gatewayNetworkSmoke = parseGatewayNetworkSmokeFailure(
    'gateway_network_smoke synapse=503:none radicale=unavailable:dns\n',
    1,
  );
  const diagnostic = formatFailureDiagnostic({
    phase: 'compose-run-gateway-smoke',
    failureClass: 'gate-failed',
    operation: failureOperationForStage('compose-run-gateway-smoke'),
    failureCode: 'gateway-network-smoke-failed',
    gatewayNetworkSmoke,
  });

  assert.equal(diagnostic.schema_version, 10);
  assert.equal(diagnostic.failed_phase, 'compose-run-gateway-smoke');
  assert.equal(diagnostic.failure_operation, 'gateway-network-smoke');
  assert.equal(diagnostic.failure_check, 'network-smoke');
  assert.deepEqual(diagnostic.gateway_network_smoke, gatewayNetworkSmoke);
});

test('API CRUD summary parser keeps only a finite first failed stage and code', () => {
  const summary = apiProbeSummary('event-update', 'gateway-rejected');
  const output = JSON.stringify(summary);
  assert.deepEqual(parseApiCrudProbeFailure(output, 1), {
    marker_status: 'captured',
    process_exit_code: 1,
    status: 'failed',
    first_failed_stage: 'event-update',
    failure_code: 'gateway-rejected',
    first_failure_http_status: null,
    owned_cleanup_status: 'passed',
  });

  assert.deepEqual(
    parseApiCrudProbeFailure(JSON.stringify(apiProbeSummary()), 0),
    {
      marker_status: 'captured',
      process_exit_code: 0,
      status: 'passed',
      first_failed_stage: 'unavailable',
      failure_code: 'unavailable',
      first_failure_http_status: null,
      owned_cleanup_status: 'passed',
    },
  );
  assert.equal(API_PROBE_STAGES.length, 12);
  assert.ok(API_PROBE_FAILURE_CODES.includes('gateway-rejected'));
  const updatedReadback = parseApiCrudProbeFailure(
    JSON.stringify(
      apiProbeSummary('updated-readback', 'updated-resource-unverified', 502),
    ),
    1,
  );
  assert.equal(updatedReadback.failure_code, 'updated-resource-unverified');
  assert.equal(updatedReadback.first_failure_http_status, 502);
});

test('API CRUD producer status is captured without retaining response data', async () => {
  const fixture = {
    homeserverUrl: 'http://127.0.0.1:8008',
    gatewayUrl: 'http://127.0.0.1:3000',
    calendarId: 'element-acceptance',
    principalMode: 'bot-account',
    teamRoomId: '!synthetic-team:localhost',
    outsiderRoomId: '!synthetic-outsider:localhost',
    users: {
      memberA: { userId: '@member-a:localhost', accessToken: 'member-token' },
      outsider: {
        userId: '@outsider:localhost',
        accessToken: 'outsider-token',
      },
      bot: { userId: '@bot:localhost', accessToken: 'bot-token' },
    },
    serviceSender: { userId: '@bot:localhost', accessToken: 'bot-token' },
  };
  const result = await runElementAcceptanceApiProbe({
    fixture,
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      if (url.pathname.includes('member-a')) {
        return new Response(
          JSON.stringify({
            access_token: 'private-openid-token',
            matrix_server_name: 'localhost',
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ detail: 'private response body' }), {
        status: 503,
      });
    },
  });
  const diagnostic = parseApiCrudProbeFailure(JSON.stringify(result), 1);
  assert.equal(diagnostic.marker_status, 'captured');
  assert.equal(diagnostic.status, 'failed');
  assert.equal(diagnostic.first_failed_stage, 'outsider-openid');
  assert.equal(diagnostic.failure_code, 'openid-rejected');
  assert.equal(diagnostic.first_failure_http_status, 503);
  assert.equal(diagnostic.owned_cleanup_status, 'passed');
  assert.doesNotMatch(JSON.stringify(result), /private|token/u);
  assert.doesNotMatch(JSON.stringify(diagnostic), /private|token/u);
});

test('API CRUD parser accepts cleanup-only failure and closes unknown or hostile summaries', () => {
  const cleanupOnly = {
    status: 'failed',
    failureCode: 'cleanup-read-failed',
    failureHttpStatus: 503,
    stages: Object.fromEntries(
      API_PROBE_STAGES.map((stage) => [
        stage,
        stage === 'owned-cleanup' ? 'failed' : 'passed',
      ]),
    ),
  };
  assert.equal(
    parseApiCrudProbeFailure(JSON.stringify(cleanupOnly), 0).first_failed_stage,
    'owned-cleanup',
  );
  assert.equal(
    parseApiCrudProbeFailure(
      JSON.stringify({
        ...apiProbeSummary('fixture', 'fixture-invalid'),
        token: 'secret',
      }),
      1,
    ).marker_status,
    'invalid',
  );
  assert.equal(
    parseApiCrudProbeFailure(
      JSON.stringify(apiProbeSummary('fixture', 'secret-token')),
      1,
    ).marker_status,
    'invalid',
  );
  const malformed = parseApiCrudProbeFailure('private body token=secret', 1);
  assert.equal(malformed.marker_status, 'invalid');
  assert.equal(malformed.process_exit_code, 1);
  assert.doesNotMatch(JSON.stringify(malformed), /private|secret|token/u);
});

test('API CRUD zero-status failure keeps its first check in the structured error', () => {
  const output = JSON.stringify(
    apiProbeSummary('canonical-readback', 'canonical-content-mismatch'),
  );
  assert.throws(
    () => assertApiCrudProbePassed(output),
    (error) => {
      assert.equal(error.stage, 'api-crud-probe');
      assert.equal(error.code, 'api-stage-failed');
      assert.equal(error.apiCrudProbe.marker_status, 'captured');
      assert.equal(error.apiCrudProbe.first_failed_stage, 'canonical-readback');
      assert.equal(
        error.apiCrudProbe.failure_code,
        'canonical-content-mismatch',
      );
      return true;
    },
  );
});

test('API CRUD nonzero child keeps only the validated summary in its task failure', (t) => {
  const taskDir = mkdtempSync(join(tmpdir(), 'mcw-api-probe-task-'));
  t.after(() => rmSync(taskDir, { recursive: true, force: true }));
  const output = JSON.stringify(
    apiProbeSummary('outsider-denied', 'not-denied'),
  );
  const script = `process.stdout.write(${JSON.stringify(output)}); process.exitCode = 1;`;

  assert.throws(
    () =>
      runTask('api-crud-probe', process.execPath, ['-e', script], {
        taskDir,
        apiCrudProbeParser: parseApiCrudProbeFailure,
      }),
    (error) => {
      assert.equal(error.stage, 'api-crud-probe');
      assert.equal(error.code, 'api-probe-process-failed');
      assert.equal(error.apiCrudProbe.marker_status, 'captured');
      assert.equal(error.apiCrudProbe.first_failed_stage, 'outsider-denied');
      assert.equal(error.apiCrudProbe.failure_code, 'not-denied');
      assert.doesNotMatch(
        JSON.stringify(error.apiCrudProbe),
        /token|secret|body/u,
      );
      return true;
    },
  );
});

test('failure artifact projects only the API CRUD probe enum fields', () => {
  const apiCrudProbe = parseApiCrudProbeFailure(
    JSON.stringify(apiProbeSummary('event-create', 'gateway-rejected')),
    1,
  );
  const diagnostic = formatFailureDiagnostic({
    phase: 'api-crud-probe',
    failureCode: 'api-probe-process-failed',
    apiCrudProbe,
  });
  assert.equal(diagnostic.schema_version, 10);
  assert.equal(diagnostic.failure_check, 'api-contract');
  assert.deepEqual(diagnostic.api_crud_probe, apiCrudProbe);

  const hostile = formatFailureDiagnostic({
    phase: 'api-crud-probe',
    apiCrudProbe: {
      marker_status: 'captured',
      process_exit_code: 1,
      status: 'failed',
      first_failed_stage: 'event-create token=secret',
      failure_code: 'https://private.example/token',
      owned_cleanup_status: 'failed',
    },
  });
  assert.equal(hostile.api_crud_probe.marker_status, 'invalid');
  assert.equal(hostile.api_crud_probe.first_failed_stage, 'unavailable');
  assert.doesNotMatch(JSON.stringify(hostile), /secret|private|https/u);
});

test('reminder outcome parser stays aligned with the producer across all flows and failure phases', () => {
  assert.deepEqual(
    [...HOSTED_REMINDER_FIXTURE_FAILURE_PHASES].sort(),
    [...LOCAL_REMINDER_FIXTURE_FAILURE_PHASES].sort(),
  );

  for (const [flow, markerCount] of [
    ['initial', 1],
    ['restart', 2],
    ['restore', 3],
  ]) {
    assert.deepEqual(
      parseReminderFixtureOutcome(
        `${JSON.stringify(reminderFixtureSummary({ flow, markerCount }))}\n`,
      ),
      {
        marker_status: 'captured',
        status: 'passed',
        failure_phase: 'none',
      },
      flow,
    );
  }

  for (const failurePhase of LOCAL_REMINDER_FIXTURE_FAILURE_PHASES) {
    assert.deepEqual(
      parseReminderFixtureOutcome(
        JSON.stringify(
          reminderFixtureSummary({
            flow: 'restore',
            status: 'failed',
            failurePhase,
            cleanup: {
              reminderConfiguration: 'unresolved',
              event: 'confirmed-absent',
            },
          }),
        ),
      ),
      {
        marker_status: 'captured',
        status: 'failed',
        failure_phase: failurePhase,
      },
      failurePhase,
    );
  }
});

test('reminder child failures retain only the finite fixture outcome and validated exit code', (t) => {
  const taskDir = mkdtempSync(join(tmpdir(), 'mcw-reminder-fixture-task-'));
  t.after(() => rmSync(taskDir, { recursive: true, force: true }));
  const summary = reminderFixtureSummary({
    flow: 'restore',
    status: 'failed',
    failurePhase: 'reminder-delivery',
  });
  const output = `${JSON.stringify(summary)}\n`;
  const script = `process.stdout.write(${JSON.stringify(output)}); process.exitCode = 1;`;

  assert.throws(
    () =>
      runTask('reminder-restore-fixture', process.execPath, ['-e', script], {
        taskDir,
        reminderFixtureOutcomeParser: parseReminderFixtureOutcome,
      }),
    (error) => {
      assert.equal(error.stage, 'reminder-restore-fixture');
      assert.equal(error.code, 'reminder-fixture-failed');
      assert.equal(error.childExitCode, 1);
      assert.deepEqual(error.reminderFixture, {
        marker_status: 'captured',
        status: 'failed',
        failure_phase: 'reminder-delivery',
      });
      const diagnostic = formatFailureDiagnostic({
        phase: error.stage,
        failureClass: 'gate-failed',
        operation: failureOperationForStage(error.stage),
        failureCode: error.code,
        childExitCode: error.childExitCode,
        reminderFixture: error.reminderFixture,
      });
      assert.equal(diagnostic.schema_version, 10);
      assert.equal(diagnostic.failure_check, 'reminder-fixture');
      assert.equal(diagnostic.child_exit_code, 1);
      assert.deepEqual(diagnostic.reminder_fixture, error.reminderFixture);
      assert.doesNotMatch(JSON.stringify(diagnostic), /secret|https|body/u);
      const artifactPath = join(
        taskDir,
        'matrix-calendar-widget-operator-rehearsal-failure.json',
      );
      assert.equal(
        writeFailureDiagnostic(taskDir, {
          phase: error.stage,
          failureClass: 'gate-failed',
          operation: failureOperationForStage(error.stage),
          failureCode: error.code,
          childExitCode: error.childExitCode,
          reminderFixture: error.reminderFixture,
          cleanupStatus: 'pending',
          cleanupAttempted: false,
        }),
        true,
      );
      assert.equal(statSync(artifactPath).mode & 0o777, 0o600);
      const writtenArtifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
      assert.deepEqual(writtenArtifact.reminder_fixture, error.reminderFixture);
      assert.equal(writtenArtifact.child_exit_code, 1);
      assert.doesNotMatch(
        JSON.stringify(writtenArtifact),
        /secret|https|body/u,
      );
      return true;
    },
  );
});

test('reminder failed-summary and marker-gate paths preserve bounded outcomes', () => {
  const failed = reminderFixtureSummary({
    flow: 'restore',
    status: 'failed',
    failurePhase: 'prior-deliveries',
  });
  assert.throws(
    () =>
      assertReminderResult(
        JSON.stringify(failed),
        '/unread/if-summary-fails-first',
        3,
        'reminder-restore-fixture',
      ),
    (error) => {
      assert.equal(error.code, 'reminder-fixture-failed');
      assert.equal(error.childExitCode, 0);
      assert.deepEqual(error.reminderFixture, {
        marker_status: 'captured',
        status: 'failed',
        failure_phase: 'prior-deliveries',
      });
      return true;
    },
  );

  const inconsistentCount = reminderFixtureSummary({
    flow: 'restore',
    status: 'passed',
    markerCount: 2,
  });
  assert.throws(
    () =>
      assertReminderResult(
        JSON.stringify(inconsistentCount),
        '/unread/if-count-fails-first',
        3,
        'reminder-restore-fixture',
      ),
    (error) => {
      assert.equal(error.code, 'reminder-marker-count-mismatch');
      assert.equal(error.childExitCode, 0);
      assert.deepEqual(error.reminderFixture, {
        marker_status: 'captured',
        status: 'passed',
        failure_phase: 'none',
      });
      return true;
    },
  );
});

test('malformed reminder outcomes remain unknown and reject extra fields or text', () => {
  const expected = {
    marker_status: 'invalid',
    status: 'unknown',
    failure_phase: 'unknown',
  };
  const valid = reminderFixtureSummary({
    flow: 'restore',
    status: 'failed',
    failurePhase: 'reminder-delivery',
  });
  const unknownPhase = reminderFixtureSummary({
    flow: 'restore',
    status: 'failed',
    failurePhase: 'https://private.example/token=secret',
  });
  const extraField = { ...valid, body: 'secret payload' };

  assert.deepEqual(
    parseReminderFixtureOutcome('private body token=secret'),
    expected,
  );
  assert.deepEqual(
    parseReminderFixtureOutcome(`${JSON.stringify(valid)}\nextra text`),
    expected,
  );
  assert.deepEqual(
    parseReminderFixtureOutcome(JSON.stringify(unknownPhase)),
    expected,
  );
  assert.deepEqual(
    parseReminderFixtureOutcome(JSON.stringify(extraField)),
    expected,
  );
  assert.doesNotMatch(
    JSON.stringify([
      parseReminderFixtureOutcome('private body token=secret'),
      parseReminderFixtureOutcome(JSON.stringify(unknownPhase)),
      parseReminderFixtureOutcome(JSON.stringify(extraField)),
    ]),
    /secret|private|https|body/u,
  );
  assert.deepEqual(parseReminderFixtureOutcome(''), {
    marker_status: 'absent',
    status: 'unknown',
    failure_phase: 'unknown',
  });
});

test('unknown reminder child outcomes still fail with only unknown artifact fields', (t) => {
  const taskDir = mkdtempSync(join(tmpdir(), 'mcw-reminder-unknown-task-'));
  t.after(() => rmSync(taskDir, { recursive: true, force: true }));

  for (const output of ['', 'private body token=secret']) {
    const script = `process.stdout.write(${JSON.stringify(output)}); process.exitCode = 1;`;
    assert.throws(
      () =>
        runTask('reminder-restore-fixture', process.execPath, ['-e', script], {
          taskDir,
          reminderFixtureOutcomeParser: parseReminderFixtureOutcome,
        }),
      (error) => {
        assert.equal(error.childExitCode, 1);
        assert.deepEqual(error.reminderFixture, {
          marker_status: output === '' ? 'absent' : 'invalid',
          status: 'unknown',
          failure_phase: 'unknown',
        });
        const diagnostic = formatFailureDiagnostic({
          phase: error.stage,
          failureClass: 'gate-failed',
          operation: failureOperationForStage(error.stage),
          failureCode: error.code,
          childExitCode: error.childExitCode,
          reminderFixture: error.reminderFixture,
        });
        assert.equal(diagnostic.failure_check, 'unknown');
        assert.equal(diagnostic.child_exit_code, 1);
        assert.deepEqual(diagnostic.reminder_fixture, error.reminderFixture);
        assert.doesNotMatch(JSON.stringify(diagnostic), /secret|private|body/u);
        return true;
      },
    );
  }
});

test('hosted shared-Docker mode requires a private adapter and exact hosted main context', (t) => {
  const taskDir = mkdtempSync(join(tmpdir(), 'mcw-hosted-docker-mode-'));
  t.after(() => rmSync(taskDir, { recursive: true, force: true }));
  const dockerConfig = join(taskDir, 'docker-config');
  mkdirSync(dockerConfig, { mode: 0o700 });
  const adapter = writeDockerAdapter(taskDir, process.execPath);
  const workflowEnvironment = {
    MATRIX_CALENDAR_HOSTED_SHARED_DOCKER_REHEARSAL: 'true',
    GITHUB_ACTIONS: 'true',
    RUNNER_ENVIRONMENT: 'github-hosted',
    RUNNER_OS: 'Linux',
    GITHUB_REPOSITORY: '0cwa/matrix-calendar-widget',
    GITHUB_REF: 'refs/heads/main',
  };
  const makeTaskEnvironment = () => ({
    DOCKER_CONFIG: dockerConfig,
    PATH: `${adapter.dockerBinDir}${delimiter}${process.env.PATH}`,
  });
  const adapterContext = {
    taskDir,
    dockerBinDir: adapter.dockerBinDir,
    dockerAdapterPath: adapter.dockerAdapterPath,
    dockerExecutable: process.execPath,
  };

  const taskEnvironment = makeTaskEnvironment();
  assert.equal(
    taskEnvironment.MATRIX_CALENDAR_HOSTED_SHARED_DOCKER_REHEARSAL,
    undefined,
  );
  enableHostedSharedDockerRehearsal(
    taskEnvironment,
    workflowEnvironment,
    adapterContext,
  );
  assert.equal(
    taskEnvironment.MATRIX_CALENDAR_HOSTED_SHARED_DOCKER_REHEARSAL,
    'true',
  );
  assert.equal(taskEnvironment.GITHUB_REF, 'refs/heads/main');
  for (const key of [
    'DOCKER_HOST',
    'DOCKER_CONTEXT',
    'DOCKER_API_VERSION',
    'DOCKER_TLS_VERIFY',
    'DOCKER_CERT_PATH',
    'COMPOSE_FILE',
    'COMPOSE_PROFILES',
    'COMPOSE_ENV_FILES',
    'COMPOSE_PATH_SEPARATOR',
  ]) {
    assert.equal(taskEnvironment[key], undefined, key);
  }

  for (const invalidWorkflowEnvironment of [
    { ...workflowEnvironment, RUNNER_ENVIRONMENT: 'self-hosted' },
    { ...workflowEnvironment, RUNNER_OS: 'Windows' },
    { ...workflowEnvironment, GITHUB_REPOSITORY: 'other/project' },
    { ...workflowEnvironment, GITHUB_REF: 'refs/heads/feature' },
    { ...workflowEnvironment, GITHUB_ACTIONS: 'false' },
    {
      ...workflowEnvironment,
      MATRIX_CALENDAR_HOSTED_SHARED_DOCKER_REHEARSAL: undefined,
    },
  ]) {
    assert.throws(
      () =>
        enableHostedSharedDockerRehearsal(
          makeTaskEnvironment(),
          invalidWorkflowEnvironment,
          adapterContext,
        ),
      (error) => error.code === 'hosted-runner-context-invalid',
    );
  }

  for (const invalidTaskEnvironment of [
    { ...makeTaskEnvironment(), DOCKER_HOST: 'tcp://docker.invalid:2376' },
    { ...makeTaskEnvironment(), DOCKER_CONTEXT: 'default' },
    { ...makeTaskEnvironment(), COMPOSE_PROFILES: 'element' },
  ]) {
    assert.throws(
      () =>
        enableHostedSharedDockerRehearsal(
          invalidTaskEnvironment,
          workflowEnvironment,
          adapterContext,
        ),
      (error) => error.code === 'hosted-docker-context-invalid',
    );
  }

  const helperSource = readFileSync(
    fileURLToPath(new URL('./hosted-operator-rehearsal.mjs', import.meta.url)),
    'utf8',
  );
  const baselineIndex = helperSource.indexOf(
    "const baseline = captureInventory('baseline', context);",
  );
  const collisionIndex = helperSource.indexOf(
    'assertNoCollision(baseline, id, project);',
    baselineIndex,
  );
  const enableIndex = helperSource.indexOf(
    'enableHostedSharedDockerRehearsal(dockerEnv, env, {',
    collisionIndex,
  );
  const startIndex = helperSource.indexOf(
    "'start-synapse-radicale'",
    enableIndex,
  );
  assert.ok(
    baselineIndex >= 0 &&
      collisionIndex > baselineIndex &&
      enableIndex > collisionIndex &&
      startIndex > enableIndex,
  );
});

test('local Docker shim runs without PATH resolving Node and keeps hosted shim behavior unchanged', (t) => {
  const taskDir = mkdtempSync(join(tmpdir(), 'mcw-local-docker-shim-'));
  chmodSync(taskDir, 0o700);
  t.after(() => rmSync(taskDir, { recursive: true, force: true }));
  const nativeDocker = join(taskDir, 'native-docker');
  const argsCapture = join(taskDir, 'docker-args.json');
  writeFileSync(
    nativeDocker,
    '#!/bin/sh\nprintf \'%s\\n\' "$@" > "$DOCKER_ARGS_CAPTURE"\nprintf adapter-ok\n',
    { mode: 0o700, flag: 'wx' },
  );
  chmodSync(nativeDocker, 0o700);
  const shim = writeLocalDockerShim(taskDir, nativeDocker);
  const source = readFileSync(shim.dockerAdapterPath, 'utf8');
  assert.equal(source.split('\n', 1)[0], `#!${process.execPath}`);
  assert.ok(isAbsolute(process.execPath));
  assert.match(source, /addOperatorRehearsalProfileToComposeArgs/u);
  assert.doesNotMatch(
    source,
    /GITHUB_ACTIONS|GITHUB_REF|GITHUB_REPOSITORY|RUNNER_ENVIRONMENT|MATRIX_CALENDAR_HOSTED_SHARED_DOCKER_REHEARSAL/u,
  );
  assert.equal(statSync(shim.dockerAdapterPath).mode & 0o777, 0o700);

  const args = ['compose', '-p', project, 'config'];
  const result = spawnSync(shim.dockerAdapterPath, args, {
    encoding: 'utf8',
    env: { PATH: '', DOCKER_ARGS_CAPTURE: argsCapture },
    timeout: 5000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'adapter-ok');
  assert.equal(result.stderr, '');
  assert.deepEqual(
    readFileSync(argsCapture, 'utf8').trimEnd().split('\n'),
    addOperatorRehearsalProfileToComposeArgs(args),
  );

  const hostedDir = join(taskDir, 'hosted');
  mkdirSync(hostedDir, { mode: 0o700 });
  const hostedShim = writeDockerAdapter(hostedDir, nativeDocker);
  assert.equal(
    readFileSync(hostedShim.dockerAdapterPath, 'utf8').split('\n', 1)[0],
    '#!/usr/bin/env node',
  );
});

function throwsCode(code) {
  return (error) => error?.code === code;
}

test('fixture setup keeps a bootstrap env until validated output is handed off', (t) => {
  const taskDir = mkdtempSync(join(tmpdir(), 'mcw-compose-env-handoff-'));
  chmodSync(taskDir, 0o700);
  t.after(() => rmSync(taskDir, { recursive: true, force: true }));

  const paths = {
    dockerBinDir: join(taskDir, 'docker-bin'),
    homeDir: join(taskDir, 'home'),
    tmpDir: join(taskDir, 'tmp'),
    bootstrapEnvFile: join(taskDir, 'compose.bootstrap.env'),
    envFile: join(taskDir, 'compose.env'),
    overrideFile: join(taskDir, 'compose.override.yaml'),
    stageFile: join(taskDir, 'phases.jsonl'),
    usersFile: join(taskDir, 'users.json'),
    eventFile: join(taskDir, 'events.json'),
    deliveryFile: join(taskDir, 'deliveries.json'),
    radicaleImage: 'matrix-calendar-widget/radicale-openid:archive-1-1',
  };
  const environment = taskEnvironment(
    taskDir,
    join(taskDir, 'docker-config'),
    runId,
    project,
    paths,
  );
  assert.equal(
    environment.MATRIX_CALENDAR_LOCAL_COMPOSE_ENV_FILE,
    paths.bootstrapEnvFile,
  );
  assert.equal(
    environment.MATRIX_CALENDAR_DEV_SYNAPSE_PORT_MAPPING,
    '127.0.0.1:8008:8008',
  );
  assert.equal(
    environment.MATRIX_CALENDAR_DEV_RADICALE_PORT_MAPPING,
    '127.0.0.1:5232:5232',
  );
  assert.equal(environment.ELEMENT_ACCEPTANCE_SERVER_ENV_FILE, paths.envFile);
  for (const key of [
    'GITHUB_ACTIONS',
    'GITHUB_REF',
    'GITHUB_REPOSITORY',
    'RUNNER_ENVIRONMENT',
    'MATRIX_CALENDAR_HOSTED_SHARED_DOCKER_REHEARSAL',
  ]) {
    assert.equal(environment[key], undefined, key);
  }

  writeFileSync(paths.bootstrapEnvFile, 'bootstrap-only\n', { mode: 0o600 });
  chmodSync(paths.bootstrapEnvFile, 0o600);
  writeFileSync(paths.envFile, 'generated-private-env\n', { mode: 0o600 });
  chmodSync(paths.envFile, 0o600);

  const initialCompose = ['compose', '--env-file', paths.bootstrapEnvFile];
  const context = { env: environment, compose: initialCompose };
  const handoff = () =>
    handoffGeneratedComposeEnvironment(
      context,
      environment,
      {
        taskDir,
        bootstrapEnvFile: paths.bootstrapEnvFile,
        envFile: paths.envFile,
        sourceRoot: '/trusted/source',
        project,
        overrideFile: paths.overrideFile,
      },
      (generatedCompose, generatedEnvironment) => {
        assert.equal(
          generatedCompose[generatedCompose.indexOf('--env-file') + 1],
          paths.envFile,
        );
        assert.equal(
          generatedEnvironment.MATRIX_CALENDAR_LOCAL_COMPOSE_ENV_FILE,
          paths.envFile,
        );
        assert.equal(
          environment.MATRIX_CALENDAR_LOCAL_COMPOSE_ENV_FILE,
          paths.bootstrapEnvFile,
        );
      },
    );

  assert.throws(
    () =>
      handoffGeneratedComposeEnvironment(
        context,
        environment,
        {
          taskDir,
          bootstrapEnvFile: paths.bootstrapEnvFile,
          envFile: paths.envFile,
          sourceRoot: '/trusted/source',
          project,
          overrideFile: paths.overrideFile,
        },
        () => {
          throw new Error('generated compose validation failed');
        },
      ),
    /generated compose validation failed/u,
  );
  assert.strictEqual(context.compose, initialCompose);
  assert.equal(
    environment.MATRIX_CALENDAR_LOCAL_COMPOSE_ENV_FILE,
    paths.bootstrapEnvFile,
  );
  assert.equal(
    readFileSync(paths.bootstrapEnvFile, 'utf8'),
    'bootstrap-only\n',
  );

  const generatedCompose = handoff();
  assert.strictEqual(context.compose, generatedCompose);
  assert.equal(
    environment.MATRIX_CALENDAR_LOCAL_COMPOSE_ENV_FILE,
    paths.envFile,
  );
  assert.equal(environment.ELEMENT_ACCEPTANCE_SERVER_ENV_FILE, paths.envFile);
  assert.equal(
    generatedCompose[generatedCompose.indexOf('--env-file') + 1],
    paths.envFile,
  );
  assert.equal(readFileSync(paths.envFile, 'utf8'), 'generated-private-env\n');
  assert.equal(statSync(paths.envFile).mode & 0o777, 0o600);
  assert.throws(() => statSync(paths.bootstrapEnvFile), { code: 'ENOENT' });
});

test('fixture setup runs before bootstrap env removal is possible', () => {
  const helperSource = readFileSync(
    fileURLToPath(new URL('./hosted-operator-rehearsal.mjs', import.meta.url)),
    'utf8',
  );
  const setupPhaseIndex = helperSource.indexOf("stage = 'fixture-setup';");
  const setupIndex = helperSource.indexOf("'setup-fixture'", setupPhaseIndex);
  const handoffIndex = helperSource.indexOf(
    'handoffGeneratedComposeEnvironment(',
    setupIndex,
  );
  const primaryStartIndex = helperSource.indexOf(
    "stage = 'start-primary-services';",
    handoffIndex,
  );
  assert.ok(
    setupPhaseIndex >= 0 &&
      setupIndex > setupPhaseIndex &&
      handoffIndex > setupIndex &&
      primaryStartIndex > handoffIndex,
  );
  assert.equal(
    helperSource.slice(setupPhaseIndex, handoffIndex).includes('rmSync('),
    false,
  );
  assert.match(
    helperSource.slice(setupIndex, primaryStartIndex),
    /compose = handoffGeneratedComposeEnvironment/u,
  );
  assert.equal(
    helperSource.slice(primaryStartIndex).includes('bootstrapEnvFile'),
    false,
  );

  const setupSource = readFileSync(
    fileURLToPath(
      new URL('../dev/element-acceptance-setup.mjs', import.meta.url),
    ),
    'utf8',
  );
  const writerStart = setupSource.indexOf('function writeComposeEnvironment(');
  const writerEnd = setupSource.indexOf(
    '\nfunction writePrivateJson',
    writerStart,
  );
  const writer = setupSource.slice(writerStart, writerEnd);
  assert.match(
    setupSource,
    /requiredEnvironment\(\s*'ELEMENT_ACCEPTANCE_SERVER_ENV_FILE'/u,
  );
  assert.match(setupSource, /writeComposeEnvironment\(serverEnvFile,/u);
  assert.match(writer, /flag:\s*'wx'/u);
  assert.match(writer, /mode:\s*0o600/u);
});

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

test('operator Compose replaces pinned inherited scratch volumes with bounded tmpfs', () => {
  const widgetDockerfile = readFileSync(
    new URL('../matrix-calendar-widget/Dockerfile', import.meta.url),
    'utf8',
  );
  const radicaleDockerfile = readFileSync(
    new URL('../radicale-auth/Dockerfile', import.meta.url),
    'utf8',
  );
  assert.ok(
    widgetDockerfile.includes(
      'FROM ghcr.io/nordeck/matrix-widget-toolkit/widget-server:1.2.3@sha256:1cb5845a60176e8146a2fe8acde028a5a726f13bc3d4963feccfa581cc9ba62f',
    ),
  );
  assert.ok(
    radicaleDockerfile.includes(
      'FROM ghcr.io/kozea/radicale:3.8.0@sha256:0d60d544710bda0fa83bfdea685db731b6cbf74e12d7f22b4997e9cff3a50468',
    ),
  );
  assert.deepEqual(HOSTED_INHERITED_IMAGE_TMPFS, {
    widget: ['/tmp:mode=1777,size=64m', '/var/cache/nginx:mode=1777,size=64m'],
    radicale: ['/var/lib/radicale:mode=1777,size=16m'],
    'restore-radicale': ['/var/lib/radicale:mode=1777,size=16m'],
  });

  const lock = {
    images: ['synapse', 'radicale', 'gateway', 'widget', 'postgres'].map(
      (role, index) => ({
        role,
        ref: `example/${role}@sha256:${String(index + 1).repeat(64)}`,
      }),
    ),
  };
  const override = makeComposeOverride(lock, runId, project);
  assert.equal((override.match(/^    tmpfs:$/gmu) ?? []).length, 3);
  assert.equal(
    (
      override.match(
        /^      - "\/var\/lib\/radicale:mode=1777,size=16m"$/gmu,
      ) ?? []
    ).length,
    2,
  );
  assert.equal(
    (override.match(/^      - ".*:mode=1777,size=/gmu) ?? []).length,
    4,
  );

  const imageRefs = new Map(lock.images.map(({ role, ref }) => [role, ref]));
  const services = Object.fromEntries(
    [
      'synapse',
      'radicale',
      'gateway',
      'widget',
      'postgres',
      'restore-radicale',
      'restore-gateway',
    ].map((service) => {
      const role = service.startsWith('restore-')
        ? service.slice('restore-'.length)
        : service;
      return [
        service,
        {
          image: imageRefs.get(role),
          labels: { 'io.matrix-calendar-widget.local-rehearsal': runId },
          ...(HOSTED_INHERITED_IMAGE_TMPFS[service]
            ? { tmpfs: [...HOSTED_INHERITED_IMAGE_TMPFS[service]] }
            : {}),
        },
      ];
    }),
  );
  services.element = { profiles: ['operator-rehearsal-disabled'] };
  const model = {
    services,
    networks: {
      default: {
        labels: { 'io.matrix-calendar-widget.local-rehearsal': runId },
      },
    },
    volumes: Object.fromEntries(
      [
        'synapse-data',
        'radicale-data',
        'postgres-data',
        'reminder-restore-radicale-data',
      ].map((name) => [
        name,
        { labels: { 'io.matrix-calendar-widget.local-rehearsal': runId } },
      ]),
    ),
  };

  assert.doesNotThrow(() => validateComposeModel(model, lock, runId, project));
  assert.deepEqual(Object.keys(model.volumes).sort(), [
    'postgres-data',
    'radicale-data',
    'reminder-restore-radicale-data',
    'synapse-data',
  ]);
  const missingScratchMount = structuredClone(model);
  missingScratchMount.services.widget.tmpfs.pop();
  assert.throws(
    () => validateComposeModel(missingScratchMount, lock, runId, project),
    throwsCode('inherited-image-volume-mismatch'),
  );
  assert.equal(
    formatFailureDiagnostic({
      phase: 'compose-validation',
      failureCode: 'inherited-image-volume-mismatch',
    }).failure_check,
    'volume',
  );
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
    Id: 'e'.repeat(64),
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

test('service inventory separates container IDs from locked image IDs', () => {
  const services = ['synapse', 'radicale', 'gateway', 'widget', 'postgres'];
  const images = services.map((role, index) => ({
    role,
    id: `sha256:${String(index + 1).repeat(64)}`,
  }));
  const containers = services.map((service, index) => ({
    Id: String(index + 1).repeat(64),
    Image: images[index].id,
    Config: {
      Labels: {
        'io.matrix-calendar-widget.local-rehearsal': runId,
        'com.docker.compose.project': project,
        'com.docker.compose.service': service,
      },
    },
    State: { Status: 'running' },
  }));
  const options = {
    runId,
    project,
    images,
    services,
    runningServices: services,
  };

  assert.deepEqual(assertTaskServiceSet({ containers }, options), containers);

  containers[0].Id = `sha256:${'a'.repeat(64)}`;
  assert.throws(
    () => assertTaskServiceSet({ containers }, options),
    throwsCode('container-id-invalid'),
  );

  containers[0].Id = '1'.repeat(64);
  containers[0].Image = `sha256:${'f'.repeat(64)}`;
  assert.throws(
    () => assertTaskServiceSet({ containers }, options),
    throwsCode('service-image-mismatch'),
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

test('foreign inventory failures preserve the cleanup gate and classify each category', () => {
  const cases = [
    ['containers', { Id: 'container-id', Config: { Labels: {} } }],
    ['networks', { Id: 'network-id', Name: 'foreign-network', Labels: {} }],
    ['volumes', { Name: 'foreign-volume', Labels: {} }],
    ['listeners', 'LISTEN 0 128 127.0.0.1:9000 0.0.0.0:*'],
  ];

  for (const [category, changedValue] of cases) {
    const before = emptyInventory();
    const after = emptyInventory();
    if (category === 'listeners') {
      after.listeners.push(changedValue);
    } else {
      after[category].push(changedValue);
    }
    let failure;
    assert.throws(
      () =>
        compareForeign(
          before,
          after,
          runId,
          project,
          'owned-cleanup-preflight',
        ),
      (error) => {
        failure = error;
        return error.code === 'foreign-state-changed';
      },
      category,
    );
    assert.equal(failure.stage, 'foreign-inventory');
    assert.deepEqual(failure.foreignInventoryChange, {
      checkpoint: 'owned-cleanup-preflight',
      containers:
        category === 'containers' ? 'identity-set-cardinality' : 'unchanged',
      networks:
        category === 'networks' ? 'identity-set-cardinality' : 'unchanged',
      volumes:
        category === 'volumes' ? 'identity-set-cardinality' : 'unchanged',
      images: 'unchanged',
      listeners:
        category === 'listeners' ? 'identity-set-cardinality' : 'unchanged',
      volume_identity_change:
        category === 'volumes'
          ? {
              added_count: 1,
              removed_count: 0,
              added_association: 'unattached',
              removed_association: 'not-applicable',
            }
          : {
              added_count: 'not-applicable',
              removed_count: 'not-applicable',
              added_association: 'not-applicable',
              removed_association: 'not-applicable',
            },
    });
  }
});

test('foreign volume deltas stay gated and report bounded direction and owned mount class', () => {
  const before = emptyInventory();
  const after = emptyInventory();
  const removedName = 'private-removed-volume-id';
  const addedName = 'private-added-volume-id';
  before.volumes.push(foreignVolume(removedName));
  before.containers.push(
    ownedContainer('radicale', [
      { Type: 'volume', Name: removedName, Destination: '/data' },
    ]),
  );
  after.volumes.push(foreignVolume(addedName));
  after.containers.push(
    ownedContainer('postgres', [
      {
        Type: 'volume',
        Name: addedName,
        Destination: '/var/lib/postgresql/data',
      },
    ]),
  );
  after.listeners.push('LISTEN 0 128 127.0.0.1:9000 0.0.0.0:*');

  const failure = foreignFailure(before, after, 'owned-cleanup-preflight');
  assert.equal(failure.stage, 'foreign-inventory');
  assert.equal(
    failure.foreignInventoryChange.volumes,
    'identity-set-cardinality',
  );
  assert.equal(
    failure.foreignInventoryChange.listeners,
    'identity-set-cardinality',
  );
  assert.deepEqual(failure.foreignInventoryChange.volume_identity_change, {
    added_count: 1,
    removed_count: 1,
    added_association: 'postgres-data',
    removed_association: 'radicale-data',
  });

  const diagnostic = formatFailureDiagnostic({
    phase: failure.stage,
    failureClass: 'gate-failed',
    operation: 'gate',
    failureCode: failure.code,
    foreignInventoryChange: failure.foreignInventoryChange,
  });
  assert.equal(diagnostic.schema_version, 10);
  assert.equal(diagnostic.cleanup_attempted, false);
  assert.equal(diagnostic.owned_cleanup_verified, false);
  const serialized = JSON.stringify(diagnostic);
  assert.doesNotMatch(serialized, /private-(?:removed|added)-volume-id/u);
  assert.doesNotMatch(serialized, /container-radicale-private-id/u);
  assert.doesNotMatch(serialized, /container-postgres-private-id/u);
  assert.doesNotMatch(serialized, /\/var\/lib\/postgresql\/data|\/data/u);
});

test('foreign volume projection bounds counts and closes malformed or unowned details', () => {
  const before = emptyInventory();
  const many = emptyInventory();
  for (let index = 0; index < 40; index += 1)
    many.volumes.push(foreignVolume(`private-volume-${index}`));
  const manyFailure = foreignFailure(before, many);
  assert.deepEqual(manyFailure.foreignInventoryChange.volume_identity_change, {
    added_count: '32+',
    removed_count: 0,
    added_association: 'unattached',
    removed_association: 'not-applicable',
  });
  assert.doesNotMatch(
    JSON.stringify(manyFailure.foreignInventoryChange),
    /private-volume-/u,
  );

  const unowned = emptyInventory();
  unowned.volumes.push(foreignVolume('private-unowned-volume-id'));
  unowned.containers.push({
    Config: { Labels: { private_label: 'private-label-value' } },
    Mounts: [
      {
        Type: 'volume',
        Name: 'private-unowned-volume-id',
        Destination: '/private/path',
      },
    ],
  });
  const unownedFailure = foreignFailure(before, unowned);
  assert.deepEqual(
    unownedFailure.foreignInventoryChange.volume_identity_change,
    {
      added_count: 1,
      removed_count: 0,
      added_association: 'unknown',
      removed_association: 'not-applicable',
    },
  );
  assert.doesNotMatch(
    JSON.stringify(unownedFailure.foreignInventoryChange),
    /private-unowned|private-label|\/private\/path/u,
  );

  const malformed = emptyInventory();
  malformed.volumes.push({
    Name: { private_identity: 'do-not-project' },
    Labels: { private_label: 'do-not-project' },
  });
  const malformedFailure = foreignFailure(before, malformed);
  assert.equal(malformedFailure.foreignInventoryChange.volumes, 'unknown');
  assert.deepEqual(
    malformedFailure.foreignInventoryChange.volume_identity_change,
    {
      added_count: 'unknown',
      removed_count: 'unknown',
      added_association: 'unknown',
      removed_association: 'unknown',
    },
  );
  assert.doesNotMatch(
    JSON.stringify(malformedFailure.foreignInventoryChange),
    /do-not-project|private_identity|private_label/u,
  );

  const inconsistentProjection = formatFailureDiagnostic({
    foreignInventoryChange: {
      checkpoint: 'owned-cleanup-preflight',
      containers: 'unchanged',
      networks: 'unchanged',
      volumes: 'identity-set-cardinality',
      images: 'unchanged',
      listeners: 'unchanged',
      volume_identity_change: {
        added_count: 0,
        removed_count: 0,
        added_association: 'not-applicable',
        removed_association: 'not-applicable',
      },
    },
  });
  assert.deepEqual(
    inconsistentProjection.foreign_inventory_change.volume_identity_change,
    {
      added_count: 'unknown',
      removed_count: 'unknown',
      added_association: 'unknown',
      removed_association: 'unknown',
    },
  );
});

test('one foreign inventory failure classifies simultaneous changes without resource values', () => {
  const before = emptyInventory();
  const after = emptyInventory();
  after.images.push({ Id: null, RepoTags: ['private-image-tag'] });
  after.listeners.push('LISTEN 0 128 127.0.0.1:9000 0.0.0.0:*');

  let failure;
  assert.throws(
    () =>
      compareForeign(before, after, runId, project, 'owned-cleanup-preflight'),
    (error) => {
      failure = error;
      return error.code === 'foreign-state-changed';
    },
  );
  assert.deepEqual(failure.foreignInventoryChange, {
    checkpoint: 'owned-cleanup-preflight',
    containers: 'unchanged',
    networks: 'unchanged',
    volumes: 'unchanged',
    images: 'unknown',
    listeners: 'identity-set-cardinality',
    volume_identity_change: {
      added_count: 'not-applicable',
      removed_count: 'not-applicable',
      added_association: 'not-applicable',
      removed_association: 'not-applicable',
    },
  });
  const projection = JSON.stringify(failure.foreignInventoryChange);
  assert.equal(projection.includes('private-image-tag'), false);
  assert.equal(projection.includes('127.0.0.1:9000'), false);
});

test('foreign image changes distinguish identity, ordering, and metadata without changing the gate', () => {
  const image = {
    Id: imageId,
    RepoTags: [
      'matrix-calendar-widget/server:one',
      'matrix-calendar-widget/server:two',
    ],
    RepoDigests: ['matrix-calendar-widget/server@sha256:one'],
    Created: '2026-10-16T00:00:00Z',
    Config: { Cmd: ['node', 'server.js'] },
  };
  const classify = (images) => {
    const before = emptyInventory();
    const after = emptyInventory();
    before.images = [image];
    after.images = images;
    let failure;
    assert.throws(
      () =>
        compareForeign(
          before,
          after,
          runId,
          project,
          'owned-cleanup-preflight',
        ),
      (error) => {
        failure = error;
        return error.code === 'foreign-state-changed';
      },
    );
    return failure.foreignInventoryChange.images;
  };

  assert.equal(
    classify([{ ...image, Id: `sha256:${'c'.repeat(64)}` }]),
    'identity-set-cardinality',
  );
  assert.equal(
    classify([
      {
        ...image,
        RepoTags: [...image.RepoTags].reverse(),
        RepoDigests: [...image.RepoDigests].reverse(),
      },
    ]),
    'ordering-only',
  );
  assert.equal(
    classify([{ ...image, Created: '2026-10-17T00:00:00Z' }]),
    'descriptor-metadata',
  );
});

test('cleanup checkpoint labels are bound to the preflight and each cleanup census', () => {
  const helperSource = readFileSync(
    fileURLToPath(new URL('./hosted-operator-rehearsal.mjs', import.meta.url)),
    'utf8',
  );
  assert.match(
    helperSource,
    /compareForeign\(\s*baseline,\s*current,\s*id,\s*project,\s*'owned-cleanup-preflight',?\s*\)/u,
  );
  assert.match(
    helperSource,
    /compareForeign\(\s*baseline,\s*current,\s*runId,\s*project,\s*'failure-cleanup-preflight',?\s*\)/u,
  );
  assert.match(
    helperSource,
    /compareForeign\(\s*baseline,\s*afterContainers,[\s\S]*?foreignCheckpoints\.afterContainers/u,
  );
  assert.match(
    helperSource,
    /compareForeign\(\s*baseline,\s*afterVolumes,[\s\S]*?foreignCheckpoints\.afterVolumes/u,
  );
  assert.match(
    helperSource,
    /compareForeign\(\s*baseline,\s*finalInventory,[\s\S]*?foreignCheckpoints\.finalInventory/u,
  );
  for (const checkpoint of [
    'success-after-containers',
    'success-after-volumes',
    'success-final-inventory',
    'failure-after-containers',
    'failure-after-volumes',
    'failure-final-inventory',
  ]) {
    assert.ok(helperSource.includes(`'${checkpoint}'`), checkpoint);
  }
});

test('listener scope compares endpoint identities and counts actual changes', () => {
  const baseline = [
    'LISTEN 0 128 127.0.0.1:5232 0.0.0.0:*',
    'LISTEN 0 4096 127.0.0.1:9000 0.0.0.0:*',
  ];
  const queueOnlyChange = [
    'LISTEN 7 256 127.0.0.1:5232 0.0.0.0:*',
    'LISTEN 19 8192 127.0.0.1:9000 0.0.0.0:*',
  ];
  assert.deepEqual(listenerScopeDelta(queueOnlyChange, baseline), {
    added: 0,
    removed: 0,
  });
  assert.deepEqual(
    listenerScopeDelta(
      [
        'LISTEN 0 1 127.0.0.1:9000 0.0.0.0:*',
        'LISTEN 0 1 127.0.0.1:9001 0.0.0.0:*',
      ],
      ['LISTEN 0 1 127.0.0.1:9000 0.0.0.0:*'],
    ),
    { added: 1, removed: 0 },
  );
  assert.deepEqual(
    listenerScopeDelta(
      ['LISTEN 0 1 127.0.0.1:9000 0.0.0.0:*'],
      [
        'LISTEN 0 1 127.0.0.1:9000 0.0.0.0:*',
        'LISTEN 0 1 127.0.0.1:9001 0.0.0.0:*',
      ],
    ),
    { added: 0, removed: 1 },
  );
  assert.throws(
    () => listenerScopeDelta(['malformed listener row'], []),
    throwsCode('listener-output-invalid'),
  );

  const before = emptyInventory();
  const after = emptyInventory();
  before.listeners = baseline;
  after.listeners = queueOnlyChange;
  assert.doesNotThrow(() => compareForeign(before, after, runId, project));
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
    Id: 'd'.repeat(64),
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

test('owned cleanup removes in order and refuses a remaining foreign network attachment', (t) => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'mcw-owned-cleanup-order-'));
  chmodSync(temporaryRoot, 0o700);
  t.after(() => rmSync(temporaryRoot, { recursive: true, force: true }));

  const dockerBin = join(temporaryRoot, 'bin');
  mkdirSync(dockerBin, { mode: 0o700 });
  const dockerPath = join(dockerBin, 'docker');
  const ssPath = join(dockerBin, 'ss');
  const statePath = join(temporaryRoot, 'state.json');
  const taskDir = join(temporaryRoot, 'task');
  mkdirSync(taskDir, { mode: 0o700 });

  writeFileSync(
    dockerPath,
    `#!${process.execPath}
const fs = require('node:fs');
const statePath = process.env.CLEANUP_STATE;
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
const args = process.argv.slice(2);
state.calls.push(args);
const save = () => fs.writeFileSync(statePath, JSON.stringify(state), { mode: 0o600 });
const inspect = (id) => state.containers[id] ?? state.images[id] ?? state.networks[id] ?? state.volumes[id];
let output = '';
if (args[0] === 'ps' && args[1] === '-aq') output = Object.keys(state.containers).sort().join('\\n');
else if (args[0] === 'image' && args[1] === 'ls') output = Object.keys(state.images).sort().join('\\n');
else if (args[0] === 'network' && args[1] === 'ls') output = Object.keys(state.networks).sort().join('\\n');
else if (args[0] === 'volume' && args[1] === 'ls') output = Object.keys(state.volumes).sort().join('\\n');
else if (args[0] === 'volume' && args[1] === 'inspect') output = JSON.stringify(args.slice(2).map((name) => state.volumes[name]));
else if (args[0] === 'network' && args[1] === 'inspect') output = JSON.stringify(args.slice(2).map((id) => state.networks[id]));
else if (args[0] === 'inspect') output = JSON.stringify(args.slice(1).map(inspect));
else if (args[0] === 'container' && args[1] === 'stop') {
  const id = args.at(-1);
  state.containers[id].State.Running = false;
  state.containers[id].State.Status = 'exited';
  output = id + '\\n';
} else if (args[0] === 'container' && args[1] === 'rm') {
  const id = args.at(-1);
  delete state.containers[id];
  for (const network of Object.values(state.networks)) delete network.Containers[id];
  output = id + '\\n';
} else if (args[0] === 'volume' && args[1] === 'rm') {
  const name = args.at(-1);
  delete state.volumes[name];
  output = name + '\\n';
} else if (args[0] === 'network' && args[1] === 'rm') {
  const id = args.at(-1);
  if (Object.keys(state.networks[id]?.Containers ?? {}).length !== 0) process.exit(1);
  delete state.networks[id];
  output = id + '\\n';
} else process.exit(2);
save();
process.stdout.write(output);
`,
    { mode: 0o700, flag: 'wx' },
  );
  writeFileSync(ssPath, `#!${process.execPath}\nprocess.stdout.write('');\n`, {
    mode: 0o700,
    flag: 'wx',
  });
  chmodSync(dockerPath, 0o700);
  chmodSync(ssPath, 0o700);

  const containerId = 'd'.repeat(64);
  const foreignContainerId = 'e'.repeat(64);
  const networkId = 'c'.repeat(64);
  const volumeName = `${project}_radicale-data`;
  const networkName = `${project}_default`;
  const localLabel = 'io.matrix-calendar-widget.local-rehearsal';
  const projectLabel = 'com.docker.compose.project';
  const volumeLabel = 'com.docker.compose.volume';
  const containerLabels = {
    [localLabel]: runId,
    [projectLabel]: project,
    'com.docker.compose.service': 'radicale',
  };
  const volumeLabels = {
    [localLabel]: runId,
    [projectLabel]: project,
    [volumeLabel]: 'radicale-data',
  };
  const networkLabels = { [localLabel]: runId, [projectLabel]: project };
  const mount = {
    Type: 'volume',
    Name: volumeName,
    Source: `/var/lib/docker/volumes/${volumeName}/_data`,
    Destination: '/data',
    Driver: 'local',
    Mode: 'rw',
    RW: true,
    Propagation: '',
  };
  const container = {
    Id: containerId,
    Name: `/${project}-radicale`,
    Image: imageId,
    Config: {
      Image: 'synthetic:cleanup-test',
      Labels: containerLabels,
      Env: [],
      Cmd: ['sleep', 'infinity'],
      Entrypoint: null,
      WorkingDir: '/app',
      User: '1000',
    },
    State: {
      Status: 'running',
      Running: true,
      Paused: false,
      Restarting: false,
      OOMKilled: false,
      Dead: false,
      ExitCode: 0,
      Health: null,
    },
    Mounts: [mount],
    HostConfig: {
      NetworkMode: networkName,
      PortBindings: null,
      RestartPolicy: { Name: 'no', MaximumRetryCount: 0 },
    },
    NetworkSettings: {
      Ports: null,
      Networks: {
        [networkName]: { NetworkID: networkId, EndpointID: 'owned-endpoint' },
      },
    },
  };
  const foreignContainer = {
    ...container,
    Id: foreignContainerId,
    Name: '/unrelated-service',
    Config: { ...container.Config, Labels: {} },
    Mounts: [],
    NetworkSettings: {
      Ports: null,
      Networks: {
        [networkName]: { NetworkID: networkId, EndpointID: 'foreign-endpoint' },
      },
    },
  };
  const stableContainer = (value) => ({
    Id: value.Id,
    Name: value.Name,
    Image: value.Image,
    Config: {
      Image: value.Config.Image,
      Labels: value.Config.Labels,
      Env: value.Config.Env,
      Cmd: value.Config.Cmd,
      Entrypoint: value.Config.Entrypoint,
      WorkingDir: value.Config.WorkingDir,
      User: value.Config.User,
    },
    State: {
      Status: value.State.Status,
      Running: value.State.Running,
      Paused: value.State.Paused,
      Restarting: value.State.Restarting,
      OOMKilled: value.State.OOMKilled,
      Dead: value.State.Dead,
      ExitCode: value.State.ExitCode,
      Health: null,
    },
    Mounts: value.Mounts,
    HostConfig: {
      NetworkMode: value.HostConfig.NetworkMode,
      PortBindings: value.HostConfig.PortBindings,
      RestartPolicy: value.HostConfig.RestartPolicy,
    },
    NetworkSettings: {
      Ports: value.NetworkSettings.Ports,
      Networks: value.NetworkSettings.Networks,
    },
  });
  const volume = {
    Name: volumeName,
    Driver: 'local',
    Mountpoint: `/var/lib/docker/volumes/${volumeName}/_data`,
    Labels: volumeLabels,
    Options: null,
    Scope: 'local',
  };
  const network = (attachments) => ({
    Id: networkId,
    Name: networkName,
    Driver: 'bridge',
    Scope: 'local',
    Internal: false,
    Attachable: false,
    Ingress: false,
    Labels: networkLabels,
    IPAM: { Driver: 'default', Config: [], Options: null },
    Options: null,
    Containers: attachments,
  });
  const image = {
    Id: imageId,
    RepoTags: ['synthetic:cleanup-test'],
    RepoDigests: [],
    Config: { Labels: {} },
  };
  const ownedAttachment = {
    Name: `${project}-radicale`,
    EndpointID: 'owned-endpoint',
    MacAddress: '02:42:ac:11:00:02',
    IPv4Address: '172.18.0.2/16',
    IPv6Address: '',
  };
  const foreignAttachment = {
    Name: 'unrelated-service',
    EndpointID: 'foreign-endpoint',
    MacAddress: '02:42:ac:11:00:03',
    IPv4Address: '172.18.0.3/16',
    IPv6Address: '',
  };
  const baseline = {
    containers: [],
    images: [image],
    networks: [],
    volumes: [],
    listeners: [],
  };
  const context = {
    cwd: temporaryRoot,
    env: { PATH: dockerBin, CLEANUP_STATE: statePath },
    taskDir,
  };

  function runCleanup(foreignAttached) {
    const attachments = { [containerId]: ownedAttachment };
    const containers = { [containerId]: container };
    if (foreignAttached) {
      attachments[foreignContainerId] = foreignAttachment;
      containers[foreignContainerId] = foreignContainer;
      baseline.containers = [stableContainer(foreignContainer)];
    } else {
      baseline.containers = [];
    }
    const plan = {
      containers: [stableContainer(container)],
      volumes: [volume],
      network: network(attachments),
      partial: false,
    };
    writeFileSync(
      statePath,
      JSON.stringify({
        containers,
        images: { [imageId]: image },
        networks: { [networkId]: network(attachments) },
        volumes: { [volumeName]: volume },
        calls: [],
      }),
      { mode: 0o600 },
    );
    return { plan, callsPath: statePath };
  }

  const successful = runCleanup(false);
  const cleaned = removeOwnedResources({
    plan: successful.plan,
    context,
    baseline,
    runId,
    project,
    prefix: 'success',
  });
  assert.deepEqual(cleaned, baseline);
  const successfulCalls = JSON.parse(
    readFileSync(successful.callsPath, 'utf8'),
  ).calls;
  const removeContainer = successfulCalls.findIndex(
    (args) => args[0] === 'container' && args[1] === 'rm',
  );
  const removeVolume = successfulCalls.findIndex(
    (args) => args[0] === 'volume' && args[1] === 'rm',
  );
  const removeNetwork = successfulCalls.findIndex(
    (args) => args[0] === 'network' && args[1] === 'rm',
  );
  assert.ok(removeContainer >= 0 && removeContainer < removeVolume);
  assert.ok(removeVolume < removeNetwork);

  const foreign = runCleanup(true);
  assert.throws(
    () =>
      removeOwnedResources({
        plan: foreign.plan,
        context,
        baseline,
        runId,
        project,
        prefix: 'success',
      }),
    (error) =>
      error.stage === 'success-cleanup' &&
      error.code === 'owned-network-still-attached',
  );
  const foreignCalls = JSON.parse(
    readFileSync(foreign.callsPath, 'utf8'),
  ).calls;
  assert.ok(
    !foreignCalls.some((args) => args[0] === 'network' && args[1] === 'rm'),
  );
  assert.equal(
    Object.hasOwn(
      JSON.parse(readFileSync(foreign.callsPath, 'utf8')).containers,
      foreignContainerId,
    ),
    true,
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
    startupStage: 'homeserver-probe',
    childExitCode: 125,
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
    assert.equal(initial.schema_version, 10);
    assert.equal(initial.failed_phase, 'fixture-setup');
    assert.equal(initial.failure_class, 'gate-failed');
    assert.equal(initial.failure_operation, 'gate');
    assert.equal(initial.failure_check, 'unknown');
    assert.deepEqual(initial.service_roles, {
      synapse: {
        present: 'unavailable',
        state: 'unavailable',
        exit_code: 'unavailable',
        image_matches: 'unavailable',
        health: 'unavailable',
      },
      radicale: {
        present: 'unavailable',
        state: 'unavailable',
        exit_code: 'unavailable',
        image_matches: 'unavailable',
        health: 'unavailable',
      },
      gateway: {
        present: 'unavailable',
        state: 'unavailable',
        exit_code: 'unavailable',
        image_matches: 'unavailable',
        health: 'unavailable',
      },
      widget: {
        present: 'unavailable',
        state: 'unavailable',
        exit_code: 'unavailable',
        image_matches: 'unavailable',
        health: 'unavailable',
      },
      postgres: {
        present: 'unavailable',
        state: 'unavailable',
        exit_code: 'unavailable',
        image_matches: 'unavailable',
        health: 'unavailable',
      },
    });
    assert.equal(initial.startup_stage, 'homeserver-probe');
    assert.equal(initial.child_exit_code, 125);
    assert.deepEqual(initial.source_image_ids, fields.sourceImageIds);
    assert.deepEqual(initial.listener_scope, {
      callsite: 'not-applicable',
      added_count: 'unavailable',
      removed_count: 'unavailable',
    });
    assert.deepEqual(initial.gateway_network_smoke, {
      marker_status: 'not-applicable',
      process_exit_code: 'unavailable',
      synapse: {
        http_status: 'unavailable',
        error_class: 'unavailable',
      },
      radicale: {
        http_status: 'unavailable',
        error_class: 'unavailable',
      },
    });
    assert.deepEqual(initial.api_crud_probe, {
      marker_status: 'not-applicable',
      process_exit_code: 'unavailable',
      status: 'unavailable',
      first_failed_stage: 'unavailable',
      failure_code: 'unavailable',
      first_failure_http_status: null,
      owned_cleanup_status: 'unavailable',
    });
    assert.equal(initial.cleanup_status, 'pending');
    assert.equal(initial.cleanup_attempted, false);
    assert.equal(initial.owned_cleanup_verified, false);
    assert.equal(initial.foreign_inventory_change.checkpoint, 'not-applicable');

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
    assert.equal(final.startup_stage, 'homeserver-probe');
    assert.equal(final.child_exit_code, 125);
    assert.equal(final.cleanup_attempted, true);
    assert.equal(final.owned_cleanup_verified, true);
    assert.equal(final.foreign_inventory_unchanged, true);
  } finally {
    rmSync(runnerTemp, { recursive: true, force: true });
  }
});

test('failure artifact admits one fixed foreign outcome from failure cleanup only', (t) => {
  const runnerTemp = mkdtempSync(
    join(tmpdir(), 'mcw-foreign-cleanup-summary-'),
  );
  chmodSync(runnerTemp, 0o700);
  t.after(() => rmSync(runnerTemp, { recursive: true, force: true }));
  const fields = {
    sourceSha,
    workflowSha: '2'.repeat(40),
    runId,
    attempt: '1',
    phase: 'fixture-setup',
    failureClass: 'gate-failed',
    operation: 'gate',
    failureCode: 'fixture-stage-not-passed',
    cleanupStatus: 'pending',
    cleanupAttempted: false,
  };
  assert.equal(writeFailureDiagnostic(runnerTemp, fields), true);
  const pathName = join(
    runnerTemp,
    'matrix-calendar-widget-operator-rehearsal-failure.json',
  );
  const foreignInventoryChange = {
    checkpoint: 'failure-cleanup-preflight',
    containers: 'unchanged',
    networks: 'unchanged',
    volumes: 'unchanged',
    images: 'identity-set-cardinality',
    listeners: 'unchanged',
    volume_identity_change: {
      added_count: 'not-applicable',
      removed_count: 'not-applicable',
      added_association: 'not-applicable',
      removed_association: 'not-applicable',
    },
  };
  assert.equal(
    writeFailureDiagnostic(
      runnerTemp,
      {
        ...fields,
        cleanupStatus: 'unverified',
        cleanupAttempted: true,
        foreignInventoryChange,
      },
      true,
    ),
    true,
  );
  assert.deepEqual(
    JSON.parse(readFileSync(pathName, 'utf8')).foreign_inventory_change,
    foreignInventoryChange,
  );
  assert.equal(
    writeFailureDiagnostic(
      runnerTemp,
      {
        ...fields,
        cleanupStatus: 'unverified',
        cleanupAttempted: true,
        foreignInventoryChange: {
          ...foreignInventoryChange,
          checkpoint: 'owned-cleanup-preflight',
        },
      },
      true,
    ),
    false,
  );
  assert.deepEqual(
    JSON.parse(readFileSync(pathName, 'utf8')).foreign_inventory_change,
    foreignInventoryChange,
  );
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
    startupStage: 'https://private.example/token=secret',
    childExitCode: 'BEGIN:VCALENDAR',
    sourceImageIds: [
      imageId,
      'https://private.example/secret',
      'BEGIN:VCALENDAR',
    ],
    cleanupStatus: 'verified',
    cleanupAttempted: false,
    failureCode: 'https://private.example/token=secret',
    gatewayNetworkSmoke: {
      marker_status: 'captured',
      process_exit_code: 1,
      synapse: {
        http_status: 'https://private.example/token=secret',
        error_class: 'token=secret',
      },
      radicale: {
        http_status: 200,
        error_class: 'token=secret',
      },
    },
    apiCrudProbe: {
      marker_status: 'captured',
      process_exit_code: 1,
      status: 'failed',
      first_failed_stage: 'https://private.example/token=secret',
      failure_code: 'token=secret',
      owned_cleanup_status: 'secret',
    },
    listenerScope: {
      site: 'https://private.example/token=secret',
      added: 'private-count',
      removed: -1,
    },
    foreignInventoryChange: {
      checkpoint: 'https://private.example/token=secret',
      containers: 'token=secret',
      networks: { id: 'private-resource' },
      volumes: ['private-volume'],
      images: 'BEGIN:VCALENDAR',
      listeners: 'secret',
      volume_identity_change: {
        added_count: 1,
        removed_count: 0,
        added_association: 'private-container-id',
        removed_association: 'not-applicable',
        raw_mount: '/private/path token=secret',
      },
      arbitrary: 'do-not-project',
    },
  });
  const serialized = JSON.stringify(diagnostic);
  assert.equal(diagnostic.failed_phase, 'runner');
  assert.equal(diagnostic.failure_class, 'unknown');
  assert.equal(diagnostic.failure_operation, 'unknown');
  assert.equal(diagnostic.failure_check, 'unknown');
  assert.equal(diagnostic.startup_stage, 'unknown');
  assert.equal(diagnostic.child_exit_code, 'unavailable');
  assert.equal(diagnostic.source_sha, 'unavailable');
  assert.equal(diagnostic.workflow_sha, 'unavailable');
  assert.equal(diagnostic.run_id, 'unavailable');
  assert.equal(diagnostic.attempt, 'unavailable');
  assert.deepEqual(diagnostic.source_image_ids, []);
  assert.equal(diagnostic.cleanup_status, 'unverified');
  assert.equal(diagnostic.owned_cleanup_verified, false);
  assert.equal(diagnostic.foreign_inventory_unchanged, false);
  assert.deepEqual(diagnostic.listener_scope, {
    callsite: 'not-applicable',
    added_count: 'unavailable',
    removed_count: 'unavailable',
  });
  assert.deepEqual(diagnostic.foreign_inventory_change, {
    checkpoint: 'unknown',
    containers: 'unknown',
    networks: 'unknown',
    volumes: 'unknown',
    images: 'unknown',
    listeners: 'unknown',
    volume_identity_change: {
      added_count: 'unknown',
      removed_count: 'unknown',
      added_association: 'unknown',
      removed_association: 'unknown',
    },
  });
  assert.equal(diagnostic.gateway_network_smoke.marker_status, 'invalid');
  assert.deepEqual(diagnostic.gateway_network_smoke.synapse, {
    http_status: 'unavailable',
    error_class: 'unavailable',
  });
  assert.equal(diagnostic.api_crud_probe.marker_status, 'invalid');
  assert.equal(diagnostic.api_crud_probe.first_failed_stage, 'unavailable');
  assert.doesNotMatch(serialized, /secret|https|private|BEGIN:VCALENDAR/u);
});

test('failure diagnostics project only fixed primary-role inventory fields', () => {
  const roles = ['synapse', 'radicale', 'gateway', 'widget', 'postgres'];
  const expectedImages = roles.map((role, index) => ({
    role,
    id: `sha256:${String(index + 1).repeat(64)}`,
  }));
  const labels = (role) => ({
    'io.matrix-calendar-widget.local-rehearsal': runId,
    'com.docker.compose.project': project,
    'com.docker.compose.service': role,
    hostile: 'token=do-not-publish',
  });
  const container = (role, index, overrides = {}) => ({
    Id: String(index + 1).repeat(64),
    Name: `/private-${role}`,
    Image: expectedImages[index].id,
    Config: {
      Labels: labels(role),
      Env: ['MATRIX_TOKEN=do-not-publish'],
    },
    State: {
      Status: 'running',
      ExitCode: 0,
      Health: null,
      ...overrides,
    },
    HostConfig: { PortBindings: { '5232/tcp': 'private-address' } },
  });
  const serviceInventory = {
    containers: [
      container('synapse', 0),
      container('radicale', 1, { Health: { Status: 'healthy' } }),
      container('gateway', 2, {
        Status: 'exited',
        ExitCode: 17,
        Health: { Status: 'unhealthy', Log: ['private error'] },
      }),
      container('widget', 3),
      container('widget', 3),
    ],
  };
  const diagnostic = formatFailureDiagnostic({
    sourceSha,
    workflowSha: '2'.repeat(40),
    runId,
    attempt: '1',
    phase: 'service-inventory',
    failureClass: 'gate-failed',
    operation: 'gate',
    failureCode: 'service-state-mismatch',
    serviceInventory,
    serviceRunId: runId,
    serviceProject: project,
    serviceImages: expectedImages,
    sourceImageIds: [imageId, manifestDigest, `sha256:${'c'.repeat(64)}`],
    cleanupStatus: 'unverified',
    cleanupAttempted: true,
  });

  assert.equal(diagnostic.failure_check, 'state');
  assert.deepEqual(diagnostic.service_roles, {
    synapse: {
      present: true,
      state: 'running',
      exit_code: 0,
      image_matches: true,
      health: 'none',
    },
    radicale: {
      present: true,
      state: 'running',
      exit_code: 0,
      image_matches: true,
      health: 'healthy',
    },
    gateway: {
      present: true,
      state: 'exited',
      exit_code: 17,
      image_matches: true,
      health: 'unhealthy',
    },
    widget: {
      present: true,
      state: 'unknown',
      exit_code: 'unavailable',
      image_matches: 'unavailable',
      health: 'unknown',
    },
    postgres: {
      present: false,
      state: 'unavailable',
      exit_code: 'unavailable',
      image_matches: 'unavailable',
      health: 'unavailable',
    },
  });
  const serialized = JSON.stringify(diagnostic);
  assert.doesNotMatch(
    serialized,
    /container-private|private-|MATRIX_TOKEN|do-not-publish|private-address|private error/u,
  );
});

test('failure checks use fixed assertion codes and unknown fallback', () => {
  const cases = [
    ['service-set-mismatch', 'service-set'],
    ['api-stage-failed', 'api-contract'],
    ['api-probe-process-failed', 'api-contract'],
    ['service-image-mismatch', 'image'],
    ['container-id-invalid', 'container-identity'],
    ['service-state-mismatch', 'state'],
    ['element-container-present', 'element'],
    ['volume-set-mismatch', 'volume'],
    ['network-set-mismatch', 'network'],
    ['foreign-listener-changed', 'listener'],
    ['foreign-state-changed', 'foreign-inventory'],
    ['cleanup-service-set-invalid', 'cleanup-resource-set'],
    ['cleanup-volume-set-invalid', 'cleanup-resource-set'],
    ['cleanup-network-set-invalid', 'cleanup-resource-set'],
    ['resource-owner-changed', 'cleanup-resource-identity'],
    ['unknown-service', 'cleanup-resource-set'],
    ['container-image-invalid', 'cleanup-resource-identity'],
    ['owned-container-remains', 'cleanup-container'],
    ['container-changed-before-cleanup', 'cleanup-container'],
    ['owned-volume-remains', 'cleanup-volume'],
    ['volume-changed-before-cleanup', 'cleanup-volume'],
    ['owned-volume-still-mounted', 'cleanup-volume'],
    ['owned-network-remains', 'cleanup-network'],
    ['network-changed-before-cleanup', 'cleanup-network'],
    ['owned-network-still-attached', 'cleanup-network'],
    ['inventory-postcondition-failed', 'cleanup-inventory'],
    ['service-state-mismatch token=secret', 'unknown'],
  ];
  for (const [failureCode, expected] of cases) {
    assert.equal(
      formatFailureDiagnostic({
        phase: 'service-inventory',
        failureCode,
      }).failure_check,
      expected,
    );
  }
  assert.deepEqual(
    formatFailureDiagnostic({
      phase: 'listener-inventory',
      listenerScope: { site: 'paired-restore', added: 2, removed: 1 },
    }).listener_scope,
    {
      callsite: 'paired-restore',
      added_count: 2,
      removed_count: 1,
    },
  );
});

test('cleanup failure diagnostics retain the fixed check and safe phase only', () => {
  const fixedChecks = [
    ['owned-container-remains', 'cleanup-container'],
    ['owned-volume-still-mounted', 'cleanup-volume'],
    ['owned-network-still-attached', 'cleanup-network'],
    ['inventory-postcondition-failed', 'cleanup-inventory'],
  ];

  for (const [failureCode, failureCheck] of fixedChecks) {
    const diagnostic = formatFailureDiagnostic({
      sourceSha,
      workflowSha: '2'.repeat(40),
      runId,
      attempt: '1',
      phase: 'success-cleanup',
      failureClass: 'gate-failed',
      operation: failureOperationForStage('success-cleanup'),
      failureCode,
      cleanupStatus: 'verified',
      cleanupAttempted: true,
    });

    assert.equal(diagnostic.failed_phase, 'success-cleanup');
    assert.equal(diagnostic.failure_operation, 'cleanup-assertion');
    assert.equal(diagnostic.failure_check, failureCheck);
    assert.equal(diagnostic.cleanup_status, 'verified');
    assert.equal(diagnostic.foreign_inventory_unchanged, true);
    assert.doesNotMatch(JSON.stringify(diagnostic), new RegExp(failureCode));
  }

  const unknownCode = 'arbitrary error token=synthetic-private-value';
  const hostile = formatFailureDiagnostic({
    sourceSha,
    workflowSha: '2'.repeat(40),
    runId,
    attempt: '1',
    phase: 'success-cleanup',
    failureClass: 'gate-failed',
    operation: failureOperationForStage('success-cleanup'),
    failureCode: unknownCode,
    errorMessage: unknownCode,
    cleanupStatus: 'unverified',
    cleanupAttempted: true,
  });
  assert.equal(hostile.failed_phase, 'success-cleanup');
  assert.equal(hostile.failure_operation, 'cleanup-assertion');
  assert.equal(hostile.failure_check, 'unknown');
  assert.doesNotMatch(JSON.stringify(hostile), /synthetic-private-value/u);
});

test('startup failure markers accept only one source-formatted closed marker matching child status', () => {
  const stages = [
    'configuration-preflight',
    'docker-preflight',
    'curl-preflight',
    'homeserver-probe',
    'homeserver-generate',
    'fixture-permission',
    'registration-update',
    'uid991-access-assertion',
    'synapse-compose-start',
  ];
  const startupDiagnosticSource = readFileSync(
    fileURLToPath(
      new URL('../dev/synapse-startup-diagnostic.mjs', import.meta.url),
    ),
    'utf8',
  );
  const enumSource = /const STARTUP_FAILURE_STAGES = \[([\s\S]*?)\];/u.exec(
    startupDiagnosticSource,
  )?.[1];
  assert.ok(enumSource);
  assert.deepEqual(
    [...enumSource.matchAll(/'([^']+)'/gu)].map((match) => match[1]),
    stages,
  );
  for (const stage of stages) {
    const marker = formatStartupStageFailure(stage, 7);
    assert.equal(marker, `stage=${stage} exit_code=7`);
    assert.deepEqual(
      parseStartupFailureMarker(
        `ordinary child output\n${marker}\n`,
        7,
        formatStartupStageFailure,
      ),
      { startupStage: stage, childExitCode: 7 },
    );
  }
  assert.equal(stages.length, 9);
});

test('startup failure markers fail closed on absent, duplicate, malformed, mismatched, or hostile marker lines', () => {
  const marker = formatStartupStageFailure('homeserver-generate', 7);
  const unknown = { startupStage: 'unknown', childExitCode: 7 };
  for (const stdout of [
    'ordinary child output\n',
    `${marker}\n${marker}\n`,
    `${marker}\nstage=bad exit_code=7 extra=BEGIN:VCALENDAR\n`,
    `${marker}\nstage=hostile-token=secret exit_code=7\n`,
    'stage=homeserver-generate exit_code=999\n',
  ]) {
    assert.deepEqual(
      parseStartupFailureMarker(stdout, 7, formatStartupStageFailure),
      unknown,
    );
  }
  assert.deepEqual(
    parseStartupFailureMarker(marker, 8, formatStartupStageFailure),
    { startupStage: 'unknown', childExitCode: 8 },
  );
  assert.deepEqual(
    parseStartupFailureMarker(marker, 0, formatStartupStageFailure),
    { startupStage: 'unknown', childExitCode: 0 },
  );
  assert.deepEqual(
    parseStartupFailureMarker(marker, null, formatStartupStageFailure),
    { startupStage: 'unknown', childExitCode: 'unavailable' },
  );
  assert.deepEqual(
    parseStartupFailureMarker(marker, 7, () => 'not-the-source-marker'),
    unknown,
  );
  assert.doesNotMatch(
    JSON.stringify(
      parseStartupFailureMarker(
        `${marker}\nstage=hostile-token=secret exit_code=7\n`,
        7,
        formatStartupStageFailure,
      ),
    ),
    /secret|BEGIN:VCALENDAR/u,
  );
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
  assert.match(workflow, /image_set:[\s\S]*?default: all[\s\S]*?server-only/u);
  assert.match(
    workflow,
    /operator_rehearsal:[\s\S]*?default: false[\s\S]*?type: boolean/u,
  );
  assert.match(
    workflow,
    /server-only' && "\$INPUT_OPERATOR_REHEARSAL" == 'true'[\s\S]*?operator_rehearsal requires image_set=all/u,
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
  assert.match(workflow, /runs-on: ubuntu-latest/u);
  assert.doesNotMatch(workflow, /self-hosted/u);
  assert.match(
    rehearsalStep,
    /MATRIX_CALENDAR_HOSTED_SHARED_DOCKER_REHEARSAL: 'true'/u,
  );
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

test('trusted sparse checkout can load its hosted tooling entry points', (t) => {
  const workflow = readFileSync(workflowPath, 'utf8');
  const lines = workflow.split(/\r?\n/u);
  const sparseCheckoutIndex = lines.findIndex((line) =>
    /^\s*sparse-checkout:\s*\|$/u.test(line),
  );
  assert.notEqual(sparseCheckoutIndex, -1);
  const sparseCheckoutIndent =
    lines[sparseCheckoutIndex].length -
    lines[sparseCheckoutIndex].trimStart().length;
  const sparsePaths = [];
  for (const line of lines.slice(sparseCheckoutIndex + 1)) {
    if (line.trim() === '') continue;
    const indent = line.length - line.trimStart().length;
    if (indent <= sparseCheckoutIndent) break;
    sparsePaths.push(line.trim());
  }
  assert.ok(sparsePaths.includes('dev/element-acceptance-api-probe.mjs'));

  const workspaceRoot = fileURLToPath(new URL('../', import.meta.url));
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'mcw-tooling-sparse-'));
  t.after(() => rmSync(temporaryRoot, { recursive: true, force: true }));
  const toolingRoot = join(temporaryRoot, 'tooling');
  const runnerTemp = join(temporaryRoot, 'runner-temp');
  mkdirSync(runnerTemp, { recursive: true });
  for (const sparsePath of sparsePaths) {
    const sourcePath = join(workspaceRoot, sparsePath);
    const destinationPath = join(toolingRoot, sparsePath);
    mkdirSync(dirname(destinationPath), { recursive: true });
    copyFileSync(sourcePath, destinationPath);
  }

  assert.ok(sparsePaths.includes('scripts/release-image-archive.mjs'));

  const result = spawnSync(
    process.execPath,
    [join(toolingRoot, 'scripts/hosted-operator-rehearsal.mjs')],
    {
      cwd: toolingRoot,
      encoding: 'utf8',
      env: {
        OPERATOR_REHEARSAL_ENABLED: 'false',
        RUNNER_TEMP: runnerTemp,
      },
    },
  );
  assert.equal(result.status, 1, result.stderr);
  assert.match(
    result.stderr,
    /failed at phase preflight; owned cleanup not-run/u,
  );
  assert.doesNotMatch(result.stderr, /ERR_MODULE_NOT_FOUND/u);

  const archiveResult = spawnSync(
    process.execPath,
    [join(toolingRoot, 'scripts/release-image-archive.mjs')],
    {
      cwd: toolingRoot,
      encoding: 'utf8',
      env: {},
    },
  );
  assert.equal(archiveResult.status, 1, archiveResult.stderr);
  assert.match(
    archiveResult.stderr,
    /Usage: release-image-archive\.mjs prepare\|create\|verify --options/u,
  );
  assert.doesNotMatch(archiveResult.stderr, /ERR_MODULE_NOT_FOUND/u);
});
