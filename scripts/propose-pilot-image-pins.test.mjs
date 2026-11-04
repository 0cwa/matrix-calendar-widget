import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createProposal } from './propose-pilot-image-pins.mjs';

const targets = [
  'scripts/validate-pilot-sidecar.mjs',
  'deploy/etke-sidecar.pilot-images.compose.yaml',
  'docs/deployment-docker.md',
];

function candidateManifest(overrides = {}) {
  const runId = 39876543210;
  const runAttempt = 2;
  const runTag = `archive-${runId}-${runAttempt}`;
  return {
    schema_version: 2,
    source: {
      sha: '1234567890abcdef1234567890abcdef12345678',
      tree: '234567890abcdef1234567890abcdef123456789',
      dispatch_sha: '34567890abcdef1234567890abcdef1234567890',
    },
    workflow: {
      repository: '0cwa/matrix-calendar-widget',
      ref: '0cwa/matrix-calendar-widget/.github/workflows/release-image-archive.yml@refs/heads/main',
      sha: '4567890abcdef1234567890abcdef12345678901',
      run_id: runId,
      run_attempt: runAttempt,
      run_url: `https://github.com/0cwa/matrix-calendar-widget/actions/runs/${runId}`,
    },
    platform: 'linux/amd64',
    image_set: 'all',
    images: [
      {
        name: 'server',
        tag: `matrix-calendar-widget/server:${runTag}`,
        image_id: `sha256:${'a'.repeat(64)}`,
        buildx_manifest_digest: `sha256:${'b'.repeat(64)}`,
      },
      {
        name: 'widget',
        tag: `matrix-calendar-widget/widget:${runTag}`,
        image_id: `sha256:${'c'.repeat(64)}`,
        buildx_manifest_digest: `sha256:${'d'.repeat(64)}`,
      },
      {
        name: 'radicale',
        tag: `matrix-calendar-widget/radicale-openid:${runTag}`,
        image_id: `sha256:${'e'.repeat(64)}`,
        buildx_manifest_digest: `sha256:${'f'.repeat(64)}`,
      },
    ],
    ...overrides,
  };
}

function files() {
  return Object.fromEntries(
    targets.map((filename) => [filename, readFileSync(filename, 'utf8')]),
  );
}

function propose(manifest, inputFiles = files()) {
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  return createProposal({
    manifestBytes,
    expectedManifestSha256: createHash('sha256')
      .update(manifestBytes)
      .digest('hex'),
    files: inputFiles,
  });
}

test('proposal updates the three accepted pin locations without writing files', () => {
  const before = files();
  const manifest = candidateManifest();
  const manifestDigest = createHash('sha256')
    .update(JSON.stringify(manifest))
    .digest('hex');
  const proposal = propose(manifest);

  assert.match(
    proposal,
    /PILOT_SOURCE = '1234567890abcdef1234567890abcdef12345678'/,
  );
  assert.match(
    proposal,
    /PILOT_WORKFLOW = '4567890abcdef1234567890abcdef12345678901'/,
  );
  assert.match(proposal, /archive-39876543210-2/);
  assert.match(proposal, /workflow 39876543210, attempt 2/);
  assert.match(proposal, /actions\/runs\/39876543210/);
  assert.ok(proposal.includes(manifestDigest));
  for (const filename of targets) {
    assert.equal(readFileSync(filename, 'utf8'), before[filename]);
  }
});

test('proposal rejects an unauthenticated manifest digest with a fixed error', () => {
  const manifestBytes = Buffer.from(JSON.stringify(candidateManifest()));

  assert.throws(
    () =>
      createProposal({
        manifestBytes,
        expectedManifestSha256: '0'.repeat(64),
        files: files(),
      }),
    {
      message:
        'Could not propose pilot image pins. Verify the accepted archive and its manifest SHA-256, then review the current pilot pin files.',
    },
  );
});

test('proposal rejects wrong trust identity, platform, image set, and image tags', () => {
  const cases = [
    candidateManifest({
      workflow: {
        ...candidateManifest().workflow,
        ref: '0cwa/matrix-calendar-widget/release-image-archive.yml@refs/heads/feature',
      },
    }),
    candidateManifest({ platform: 'linux/arm64' }),
    candidateManifest({ image_set: 'server-only' }),
    candidateManifest({
      images: candidateManifest().images.map((image) =>
        image.name === 'widget'
          ? { ...image, tag: 'matrix-calendar-widget/widget:latest' }
          : image,
      ),
    }),
  ];

  for (const manifest of cases) {
    assert.throws(
      () => propose(manifest),
      /Could not propose pilot image pins/,
    );
  }
});

test('proposal refuses stale or manually inconsistent pin locations', () => {
  const changedFiles = files();
  changedFiles['deploy/etke-sidecar.pilot-images.compose.yaml'] = changedFiles[
    'deploy/etke-sidecar.pilot-images.compose.yaml'
  ].replace('archive-38913010664-1', 'archive-1-1');

  assert.throws(() => propose(candidateManifest(), changedFiles), {
    message:
      'Could not propose pilot image pins. Verify the accepted archive and its manifest SHA-256, then review the current pilot pin files.',
  });
});

test('proposal rejects image tags assigned to the wrong Compose services', () => {
  const changedFiles = files();
  const overlay = changedFiles['deploy/etke-sidecar.pilot-images.compose.yaml'];
  changedFiles['deploy/etke-sidecar.pilot-images.compose.yaml'] = overlay
    .replace(
      'image: matrix-calendar-widget/radicale-openid:archive-38913010664-1',
      'image: matrix-calendar-widget/__swap__:archive-38913010664-1',
    )
    .replace(
      'image: matrix-calendar-widget/server:archive-38913010664-1',
      'image: matrix-calendar-widget/radicale-openid:archive-38913010664-1',
    )
    .replace(
      'image: matrix-calendar-widget/__swap__:archive-38913010664-1',
      'image: matrix-calendar-widget/server:archive-38913010664-1',
    );

  assert.throws(() => propose(candidateManifest(), changedFiles), {
    message:
      'Could not propose pilot image pins. Verify the accepted archive and its manifest SHA-256, then review the current pilot pin files.',
  });
});

test('proposal output excludes arbitrary private fields from the manifest', () => {
  const proposal = propose(
    candidateManifest({ private_operator_value: 'DO_NOT_PRINT_7ec914' }),
  );

  assert.equal(proposal.includes('DO_NOT_PRINT_7ec914'), false);
});
