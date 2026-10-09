import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  deriveServerDockerfile,
  validatePlatform,
  verifyArchive,
  verifyGitSource,
} from './release-image-archive.mjs';

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
  }).trim();
}

function digest(value) {
  return `sha256:${value.repeat(64)}`;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

test('source checkout must be the requested commit and an ancestor of main', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mcw-source-binding-'));
  try {
    git(root, 'init', '--quiet', '--initial-branch=main');
    git(root, 'config', 'user.name', 'Release archive test');
    git(root, 'config', 'user.email', 'release-test@example.invalid');
    await writeFile(path.join(root, 'source.txt'), 'candidate\n');
    git(root, 'add', 'source.txt');
    git(root, 'commit', '--quiet', '-m', 'candidate');
    const sourceSha = git(root, 'rev-parse', 'HEAD');
    await writeFile(path.join(root, 'source.txt'), 'main update\n');
    git(root, 'commit', '--quiet', '-am', 'main update');
    const mainSha = git(root, 'rev-parse', 'HEAD');

    git(root, 'checkout', '--quiet', '--detach', sourceSha);
    assert.equal(verifyGitSource(root, sourceSha, mainSha).sha, sourceSha);
    assert.throws(
      () => verifyGitSource(root, mainSha, sourceSha),
      /does not match the requested source SHA/,
    );
    assert.throws(
      () => verifyGitSource(root, sourceSha, 'f'.repeat(40)),
      /dispatch commit is missing/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('only the declared generic platform is accepted', () => {
  assert.equal(validatePlatform('linux/amd64'), 'linux/amd64');
  assert.throws(() => validatePlatform('linux/arm64'), /Only linux\/amd64/);
  assert.throws(
    () => validatePlatform('actual-host-platform'),
    /Only linux\/amd64/,
  );
});

test('server recipe changes only its two mutable Node base lines', () => {
  const source = [
    'FROM aquasec/trivy:0.71.2@sha256:' + 'a'.repeat(64) + ' AS scanner',
    'FROM node:22-bookworm-slim AS builder',
    'RUN echo builder',
    'FROM node:22-bookworm-slim',
    'CMD ["node"]',
    '',
  ].join('\n');
  const nodeBase = `node:22-bookworm-slim@${digest('b')}`;
  const result = deriveServerDockerfile(source, nodeBase);
  assert.equal(result.replacements, 2);
  assert.equal(result.text.split(nodeBase).length - 1, 2);
  assert.equal(
    result.text.replaceAll(nodeBase, 'node:22-bookworm-slim'),
    source,
  );
  assert.throws(
    () => deriveServerDockerfile('FROM node:22-bookworm-slim\n', nodeBase),
    /exactly two/,
  );
});

async function makeValidArtifact(root) {
  await mkdir(path.join(root, 'images'), { recursive: true });
  const imageSpecs = [
    {
      name: 'server',
      dockerfile: 'matrix-calendar-server/Dockerfile',
      archive: 'images/server-linux-amd64.tar',
      bases: [
        `aquasec/trivy:0.71.2@${digest('2')}`,
        `node:22-bookworm-slim@${digest('3')}`,
      ],
      transformation: {
        from: 'node:22-bookworm-slim',
        to: `node:22-bookworm-slim@${digest('3')}`,
        replacements: 2,
      },
    },
    {
      name: 'widget',
      dockerfile: 'matrix-calendar-widget/Dockerfile',
      archive: 'images/widget-linux-amd64.tar',
      bases: [
        `aquasec/trivy:0.71.2@${digest('2')}`,
        `ghcr.io/example/widget-server:1@${digest('5')}`,
      ],
      transformation: null,
    },
    {
      name: 'radicale',
      dockerfile: 'radicale-auth/Dockerfile',
      archive: 'images/radicale-linux-amd64.tar',
      bases: [`ghcr.io/example/radicale:3@${digest('7')}`],
      transformation: null,
    },
  ];
  const manifestImages = [];
  for (let index = 0; index < imageSpecs.length; index += 1) {
    const spec = imageSpecs[index];
    const bytes = Buffer.from(`synthetic image archive ${spec.name}\n`);
    await writeFile(path.join(root, spec.archive), bytes);
    manifestImages.push({
      name: spec.name,
      tag: `matrix-calendar-widget/${spec.name === 'radicale' ? 'radicale-openid' : spec.name}:archive-12345-1`,
      image_id: digest(String(index + 1)),
      buildx_manifest_digest: digest(String(index + 2)),
      dockerfile: {
        source_path: spec.dockerfile,
        source_sha256: 'a'.repeat(64),
        build_path:
          spec.name === 'server'
            ? 'workflow-derived/server.Dockerfile'
            : spec.dockerfile,
        build_sha256: spec.name === 'server' ? 'b'.repeat(64) : 'a'.repeat(64),
        transformation: spec.transformation,
      },
      base_images: spec.bases,
      archive: {
        path: spec.archive,
        sha256: sha256(bytes),
        bytes: bytes.length,
      },
    });
  }
  const sourceSha = '8'.repeat(40);
  const manifest = {
    schema_version: 1,
    source: { sha: sourceSha, tree: '9'.repeat(40), dispatch_sha: sourceSha },
    workflow: {
      repository: '0cwa/matrix-calendar-widget',
      ref: '0cwa/matrix-calendar-widget/.github/workflows/release-image-archive.yml@refs/heads/main',
      sha: 'a'.repeat(40),
      run_id: 12345,
      run_attempt: 1,
      run_url:
        'https://github.com/0cwa/matrix-calendar-widget/actions/runs/12345',
    },
    builder: { helper_sha256: 'c'.repeat(64), workflow_sha256: 'd'.repeat(64) },
    platform: 'linux/amd64',
    images: manifestImages,
  };
  await writeFile(
    path.join(root, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return { manifest, sourceSha };
}

test('archive verification binds source/platform and checks every archive hash', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mcw-image-archive-'));
  try {
    const { sourceSha } = await makeValidArtifact(root);
    const manifestPath = path.join(root, 'manifest.json');
    const originalManifest = await readFile(manifestPath, 'utf8');
    assert.equal(
      (await verifyArchive(root, { expectedSourceSha: sourceSha })).source.sha,
      sourceSha,
    );
    await assert.rejects(
      verifyArchive(root, { expectedSourceSha: 'f'.repeat(40) }),
      /source SHA/,
    );
    await assert.rejects(
      verifyArchive(root, { expectedPlatform: 'linux/arm64' }),
      /platform/,
    );

    const unsafeManifest = JSON.parse(originalManifest);
    unsafeManifest.images[0].archive.path = '../../outside.tar';
    await writeFile(manifestPath, JSON.stringify(unsafeManifest));
    await assert.rejects(verifyArchive(root), /missing the server image/);
    await writeFile(manifestPath, originalManifest);

    await writeFile(
      path.join(root, 'extra-output.txt'),
      'must not be archived\n',
    );
    await assert.rejects(verifyArchive(root), /unexpected file/);
    await rm(path.join(root, 'extra-output.txt'));

    const archivePath = path.join(root, 'images/server-linux-amd64.tar');
    const tampered = Buffer.from(`synthetic image archive server\n`);
    tampered[0] ^= 1;
    await writeFile(archivePath, tampered);
    await assert.rejects(verifyArchive(root), /failed SHA-256 verification/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
