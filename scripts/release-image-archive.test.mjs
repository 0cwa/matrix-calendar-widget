import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  truncate,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  createManifest,
  deriveServerDockerfile,
  MAX_IMAGE_ARCHIVE_BYTES,
  MAX_MANIFEST_BYTES,
  MAX_NOTICE_FILE_BYTES,
  MAX_TOTAL_ARCHIVE_BYTES,
  prepareBuild,
  validatePlatform,
  verifyArchive,
  verifyGitSource,
} from './release-image-archive.mjs';

const testNotices = [
  { sourcePath: 'LICENSE', path: 'notices/project-LICENSE' },
  { sourcePath: 'NOTICE', path: 'notices/project-NOTICE' },
  {
    sourcePath: 'matrix-calendar-server/NOTICE',
    path: 'notices/server-NOTICE',
  },
  {
    sourcePath: 'matrix-calendar-widget/NOTICE',
    path: 'notices/widget-NOTICE',
  },
  {
    sourcePath: 'packages/ical-timezones/NOTICE.md',
    path: 'notices/ical-timezones-NOTICE.md',
  },
  {
    sourcePath: 'packages/ical-timezones/src/data/licenses/IANA-theory.html',
    path: 'notices/IANA-theory.html',
  },
  {
    sourcePath:
      'packages/ical-timezones/src/data/licenses/timezones-ical-library-LICENSE',
    path: 'notices/timezones-ical-library-LICENSE',
  },
];

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
  await mkdir(path.join(root, 'notices'), { recursive: true });
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
  const manifestNotices = [];
  for (const notice of testNotices) {
    const bytes = Buffer.from(
      `synthetic notice source: ${notice.sourcePath}\n`,
    );
    await writeFile(path.join(root, notice.path), bytes);
    manifestNotices.push({
      source_path: notice.sourcePath,
      path: notice.path,
      sha256: sha256(bytes),
      bytes: bytes.length,
    });
  }
  const sourceSha = '8'.repeat(40);
  const manifest = {
    schema_version: 2,
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
    notices: manifestNotices,
  };
  await writeFile(
    path.join(root, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return { manifest, sourceSha };
}

test('release preparation packages notices from the accepted source tree', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mcw-release-notices-'));
  try {
    const sourceRoot = path.join(root, 'source');
    const buildRoot = path.join(root, 'build');
    const archiveRoot = path.join(root, 'archive');
    const toolingRoot = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '..',
    );
    const scannerBase = `aquasec/trivy:0.71.2@${digest('a')}`;
    await mkdir(path.join(sourceRoot, 'matrix-calendar-server'), {
      recursive: true,
    });
    await mkdir(path.join(sourceRoot, 'matrix-calendar-widget'), {
      recursive: true,
    });
    await mkdir(path.join(sourceRoot, 'radicale-auth'), { recursive: true });
    await writeFile(
      path.join(sourceRoot, 'matrix-calendar-server/Dockerfile'),
      [
        `FROM ${scannerBase} AS scanner`,
        'FROM node:22-bookworm-slim AS builder',
        'FROM node:22-bookworm-slim',
        'CMD ["node"]',
        '',
      ].join('\n'),
    );
    await writeFile(
      path.join(sourceRoot, 'matrix-calendar-widget/Dockerfile'),
      [
        `FROM ${scannerBase} AS scanner`,
        `FROM ghcr.io/example/widget-server:1@${digest('b')}`,
        '',
      ].join('\n'),
    );
    await writeFile(
      path.join(sourceRoot, 'radicale-auth/Dockerfile'),
      `FROM ghcr.io/example/radicale:3@${digest('c')}\n`,
    );
    const sourceNoticeContent = new Map();
    for (const notice of testNotices) {
      const content = Buffer.from(`accepted notice: ${notice.sourcePath}\n`);
      const file = path.join(sourceRoot, notice.sourcePath);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, content);
      sourceNoticeContent.set(notice.sourcePath, content);
    }
    git(sourceRoot, 'init', '--quiet', '--initial-branch=main');
    git(sourceRoot, 'config', 'user.name', 'Release archive test');
    git(sourceRoot, 'config', 'user.email', 'release-test@example.invalid');
    git(sourceRoot, 'add', '.');
    git(sourceRoot, 'commit', '--quiet', '-m', 'accepted source');
    const sourceSha = git(sourceRoot, 'rev-parse', 'HEAD');
    await writeFile(path.join(sourceRoot, 'main-only.txt'), 'main update\n');
    git(sourceRoot, 'add', 'main-only.txt');
    git(sourceRoot, 'commit', '--quiet', '-m', 'main update');
    const dispatchSha = git(sourceRoot, 'rev-parse', 'HEAD');
    git(sourceRoot, 'checkout', '--quiet', '--detach', sourceSha);

    await writeFile(
      path.join(sourceRoot, 'LICENSE'),
      'uncommitted workspace change\n',
    );
    const workflowSha = git(toolingRoot, 'rev-parse', 'HEAD');
    const context = {
      sourceSha,
      dispatchSha,
      repository: '0cwa/matrix-calendar-widget',
      workflowRef:
        '0cwa/matrix-calendar-widget/.github/workflows/release-image-archive.yml@refs/heads/main',
      workflowSha,
      runId: '456',
      runAttempt: '1',
      serverUrl: 'https://github.com',
      platform: 'linux/amd64',
      nodeBase: `node:22-bookworm-slim@${digest('d')}`,
    };
    const prepared = await prepareBuild({
      sourceRoot,
      toolingRoot,
      buildRoot,
      archiveRoot,
      context,
    });
    assert.deepEqual(
      prepared.notices.map((notice) => notice.source_path),
      testNotices.map((notice) => notice.sourcePath),
    );
    for (const notice of testNotices) {
      assert.deepEqual(
        await readFile(path.join(archiveRoot, notice.path)),
        sourceNoticeContent.get(notice.sourcePath),
      );
    }

    await mkdir(path.join(archiveRoot, 'images'));
    const buildImageSpecs = [
      {
        name: 'server',
        archive: 'images/server-linux-amd64.tar',
        metadata: 'server.json',
        imageIdFile: 'server.image-id',
      },
      {
        name: 'widget',
        archive: 'images/widget-linux-amd64.tar',
        metadata: 'widget.json',
        imageIdFile: 'widget.image-id',
      },
      {
        name: 'radicale',
        archive: 'images/radicale-linux-amd64.tar',
        metadata: 'radicale.json',
        imageIdFile: 'radicale.image-id',
      },
    ];
    for (let index = 0; index < buildImageSpecs.length; index += 1) {
      const spec = buildImageSpecs[index];
      const archive = Buffer.from(`synthetic ${spec.name} image\n`);
      const manifestDigest = digest(String(index + 1));
      const imageId = digest(String(index + 4));
      await writeFile(path.join(archiveRoot, spec.archive), archive);
      await writeFile(
        path.join(buildRoot, spec.metadata),
        JSON.stringify({
          'containerimage.digest': manifestDigest,
          'containerimage.config.digest': imageId,
          'containerimage.descriptor': { digest: manifestDigest },
        }),
      );
      await writeFile(path.join(buildRoot, spec.imageIdFile), `${imageId}\n`);
    }
    const manifest = await createManifest({
      sourceRoot,
      toolingRoot,
      buildRoot,
      archiveRoot,
      context,
    });
    assert.equal(manifest.schema_version, 2);
    assert.equal(manifest.notices.length, testNotices.length);
    assert.equal(
      manifest.notices[0].sha256,
      sha256(sourceNoticeContent.get('LICENSE')),
    );
    assert.equal(
      (await verifyArchive(archiveRoot, { expectedSourceSha: sourceSha }))
        .notices.length,
      testNotices.length,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

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

    await writeFile(manifestPath, ' '.repeat(MAX_MANIFEST_BYTES + 1));
    await assert.rejects(
      verifyArchive(root),
      /manifest exceeds the 64 KiB limit/,
    );
    await writeFile(manifestPath, originalManifest);

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

    const badNoticeMapping = JSON.parse(originalManifest);
    badNoticeMapping.notices[0].path = 'notices/other-license';
    await writeFile(manifestPath, JSON.stringify(badNoticeMapping));
    await assert.rejects(
      verifyArchive(root),
      /missing required notice LICENSE/,
    );
    await writeFile(manifestPath, originalManifest);

    const noticePath = path.join(root, testNotices[0].path);
    const originalNotice = await readFile(noticePath);
    const tamperedNotice = Buffer.from(originalNotice);
    tamperedNotice[0] ^= 1;
    await writeFile(noticePath, tamperedNotice);
    await assert.rejects(
      verifyArchive(root),
      /notices\/project-LICENSE failed SHA-256 verification/,
    );
    await writeFile(noticePath, originalNotice);

    const missingNotice = path.join(root, testNotices[1].path);
    await rm(missingNotice);
    await assert.rejects(verifyArchive(root), /ENOENT/);
    await writeFile(
      missingNotice,
      Buffer.from(`synthetic notice source: ${testNotices[1].sourcePath}\n`),
    );

    const extraNotice = path.join(root, 'notices/extra.txt');
    await writeFile(extraNotice, 'unlisted notice\n');
    await assert.rejects(
      verifyArchive(root),
      /unexpected file: notices\/extra.txt/,
    );
    await rm(extraNotice);

    const oversizedNotice = JSON.parse(originalManifest);
    oversizedNotice.notices[0].bytes = MAX_NOTICE_FILE_BYTES + 1;
    await writeFile(manifestPath, JSON.stringify(oversizedNotice));
    await assert.rejects(
      verifyArchive(root),
      /LICENSE exceeds the 1 MiB notice-file limit/,
    );
    await writeFile(manifestPath, originalManifest);

    const oversizedManifest = JSON.parse(originalManifest);
    const oversizedImage = oversizedManifest.images[0];
    oversizedImage.archive.bytes = MAX_IMAGE_ARCHIVE_BYTES + 1;
    await truncate(
      path.join(root, oversizedImage.archive.path),
      oversizedImage.archive.bytes,
    );
    await writeFile(manifestPath, JSON.stringify(oversizedManifest));
    await assert.rejects(verifyArchive(root), /2 GiB per-image limit/);
    await restoreSmallArchives(root);
    await writeFile(manifestPath, originalManifest);

    const aggregateManifest = JSON.parse(originalManifest);
    const archiveBytes = Math.floor(MAX_TOTAL_ARCHIVE_BYTES / 3) + 1;
    for (const image of aggregateManifest.images) {
      image.archive.bytes = archiveBytes;
      await truncate(path.join(root, image.archive.path), archiveBytes);
    }
    await writeFile(manifestPath, JSON.stringify(aggregateManifest));
    await assert.rejects(verifyArchive(root), /4 GiB combined limit/);
    await restoreSmallArchives(root);
    await writeFile(manifestPath, originalManifest);

    const archivePath = path.join(root, 'images/server-linux-amd64.tar');
    const tampered = Buffer.from(`synthetic image archive server\n`);
    tampered[0] ^= 1;
    await writeFile(archivePath, tampered);
    await assert.rejects(verifyArchive(root), /failed SHA-256 verification/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function restoreSmallArchives(root) {
  for (const name of ['server', 'widget', 'radicale']) {
    const archive = path.join(root, `images/${name}-linux-amd64.tar`);
    const contents = `synthetic image archive ${name}\n`;
    await writeFile(archive, contents);
    await truncate(archive, Buffer.byteLength(contents));
  }
}
