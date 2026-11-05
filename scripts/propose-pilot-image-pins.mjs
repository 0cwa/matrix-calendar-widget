#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
} from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const REPOSITORY = '0cwa/matrix-calendar-widget';
const WORKFLOW_PATH = '.github/workflows/release-image-archive.yml';
const MANIFEST_LIMIT = 64 * 1024;
const PLATFORM = 'linux/amd64';
const IMAGE_REPOSITORIES = Object.freeze({
  server: 'matrix-calendar-widget/server',
  widget: 'matrix-calendar-widget/widget',
  radicale: 'matrix-calendar-widget/radicale-openid',
});
const TARGETS = Object.freeze([
  'scripts/validate-pilot-sidecar.mjs',
  'deploy/etke-sidecar.pilot-images.compose.yaml',
  'docs/deployment-docker.md',
]);
const FAILURE =
  'Could not propose pilot image pins. Verify the accepted archive and its manifest SHA-256, then review the current pilot pin files.';

function fail() {
  throw new Error(FAILURE);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readManifestBytes(filename) {
  let fd;
  try {
    fd = openSync(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = fstatSync(fd);
    if (!info.isFile() || info.size < 1 || info.size > MANIFEST_LIMIT) fail();
    const bytes = readFileSync(fd);
    if (bytes.length < 1 || bytes.length > MANIFEST_LIMIT) fail();
    return bytes;
  } catch {
    fail();
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function validateManifest(manifest, imageSet = 'all') {
  const repositories =
    imageSet === 'server-only'
      ? { server: IMAGE_REPOSITORIES.server }
      : IMAGE_REPOSITORIES;
  const sha = /^[0-9a-f]{40}$/;
  const digest = /^sha256:[0-9a-f]{64}$/;
  if (
    !isRecord(manifest) ||
    manifest.schema_version !== 2 ||
    (manifest.image_set === undefined ? 'all' : manifest.image_set) !==
      imageSet ||
    !isRecord(manifest.source) ||
    !sha.test(manifest.source.sha ?? '') ||
    !sha.test(manifest.source.tree ?? '') ||
    !sha.test(manifest.source.dispatch_sha ?? '') ||
    !isRecord(manifest.workflow) ||
    manifest.workflow.repository !== REPOSITORY ||
    manifest.workflow.ref !==
      `${REPOSITORY}/${WORKFLOW_PATH}@refs/heads/main` ||
    !sha.test(manifest.workflow.sha ?? '') ||
    !Number.isSafeInteger(manifest.workflow.run_id) ||
    manifest.workflow.run_id < 1 ||
    !Number.isSafeInteger(manifest.workflow.run_attempt) ||
    manifest.workflow.run_attempt < 1 ||
    manifest.workflow.run_url !==
      `https://github.com/${REPOSITORY}/actions/runs/${manifest.workflow.run_id}` ||
    manifest.platform !== PLATFORM ||
    !Array.isArray(manifest.images) ||
    manifest.images.length !== Object.keys(repositories).length
  ) {
    fail();
  }

  const tag = `archive-${manifest.workflow.run_id}-${manifest.workflow.run_attempt}`;
  const images = {};
  for (const [name, repository] of Object.entries(repositories)) {
    const matches = manifest.images.filter((image) => image?.name === name);
    if (
      matches.length !== 1 ||
      matches[0].tag !== `${repository}:${tag}` ||
      !digest.test(matches[0].image_id ?? '') ||
      !digest.test(matches[0].buildx_manifest_digest ?? '')
    ) {
      fail();
    }
    images[name] = matches[0].tag;
  }

  return {
    sourceSha: manifest.source.sha,
    workflowSha: manifest.workflow.sha,
    runId: manifest.workflow.run_id,
    runAttempt: manifest.workflow.run_attempt,
    platform: manifest.platform,
    images,
  };
}

function replaceCount(text, before, after, expectedCount) {
  let count = 0;
  const result = text.replaceAll(before, () => {
    count += 1;
    return after;
  });
  if (count !== expectedCount) fail();
  return result;
}

function currentValidatorPins(source) {
  const captures = [
    [...source.matchAll(/const PILOT_SOURCE = '([0-9a-f]{40})';/g)],
    [...source.matchAll(/const PILOT_WORKFLOW = '([0-9a-f]{40})';/g)],
    [...source.matchAll(/const PILOT_MANIFEST_SHA256 =\s*'([0-9a-f]{64})';/g)],
    [...source.matchAll(/const PILOT_RUN_ID = (\d+);/g)],
    [...source.matchAll(/const PILOT_RUN_ATTEMPT = (\d+);/g)],
    [...source.matchAll(/const PILOT_PLATFORM = '([^']+)';/g)],
  ];
  if (captures.some((matches) => matches.length !== 1)) fail();
  const images = {};
  for (const name of Object.keys(IMAGE_REPOSITORIES)) {
    const matches = [
      ...source.matchAll(
        new RegExp(`name: '${name}',[\\s\\S]*?tag: '([^']+)'`, 'g'),
      ),
    ];
    if (matches.length !== 1) fail();
    images[name] = matches[0][1];
  }
  const pins = {
    sourceSha: captures[0][0][1],
    workflowSha: captures[1][0][1],
    manifestSha256: captures[2][0][1],
    runId: Number(captures[3][0][1]),
    runAttempt: Number(captures[4][0][1]),
    platform: captures[5][0][1],
    images,
  };
  const expectedTag = `archive-${pins.runId}-${pins.runAttempt}`;
  if (
    pins.platform !== PLATFORM ||
    Object.entries(IMAGE_REPOSITORIES).some(
      ([name, repository]) =>
        pins.images[name] !== `${repository}:${expectedTag}`,
    )
  ) {
    fail();
  }
  return pins;
}

function validateOverlayImageMapping(overlay, currentImages) {
  const entries = [
    ...overlay.matchAll(
      /^ {2}(radicale|server|widget):\n {4}image: ([^\s#]+)$/gm,
    ),
  ];
  if (entries.length !== Object.keys(IMAGE_REPOSITORIES).length) fail();

  const imagesByService = Object.fromEntries(
    entries.map(([, service, image]) => [service, image]),
  );
  if (
    Object.keys(IMAGE_REPOSITORIES).some(
      (service) => imagesByService[service] !== currentImages[service],
    )
  ) {
    fail();
  }
}

function updatePinsInFiles(files, current, proposed) {
  validateOverlayImageMapping(files[TARGETS[1]], current.images);

  let validator = files[TARGETS[0]];
  validator = replaceCount(
    validator,
    `const PILOT_SOURCE = '${current.sourceSha}';`,
    `const PILOT_SOURCE = '${proposed.sourceSha}';`,
    1,
  );
  validator = replaceCount(
    validator,
    `const PILOT_WORKFLOW = '${current.workflowSha}';`,
    `const PILOT_WORKFLOW = '${proposed.workflowSha}';`,
    1,
  );
  validator = replaceCount(
    validator,
    current.manifestSha256,
    proposed.manifestSha256,
    1,
  );
  validator = replaceCount(
    validator,
    `const PILOT_RUN_ID = ${current.runId};`,
    `const PILOT_RUN_ID = ${proposed.runId};`,
    1,
  );
  validator = replaceCount(
    validator,
    `const PILOT_RUN_ATTEMPT = ${current.runAttempt};`,
    `const PILOT_RUN_ATTEMPT = ${proposed.runAttempt};`,
    1,
  );
  validator = replaceCount(
    validator,
    `const PILOT_PLATFORM = '${current.platform}';`,
    `const PILOT_PLATFORM = '${proposed.platform}';`,
    1,
  );
  for (const name of Object.keys(IMAGE_REPOSITORIES)) {
    validator = replaceCount(
      validator,
      current.images[name],
      proposed.images[name],
      1,
    );
  }

  let overlay = replaceCount(
    files[TARGETS[1]],
    `archive-${current.runId}-${current.runAttempt}`,
    `archive-${proposed.runId}-${proposed.runAttempt}`,
    3,
  );
  overlay = replaceCount(
    overlay,
    `workflow ${current.runId}, attempt ${current.runAttempt}`,
    `workflow ${proposed.runId}, attempt ${proposed.runAttempt}`,
    1,
  );
  let documentation = replaceCount(
    files[TARGETS[2]],
    `archive-${current.runId}-${current.runAttempt}`,
    `archive-${proposed.runId}-${proposed.runAttempt}`,
    1,
  );
  documentation = replaceCount(
    documentation,
    current.sourceSha,
    proposed.sourceSha,
    1,
  );
  documentation = replaceCount(
    documentation,
    `[${current.runId}](https://github.com/${REPOSITORY}/actions/runs/${current.runId})`,
    `[${proposed.runId}](https://github.com/${REPOSITORY}/actions/runs/${proposed.runId})`,
    1,
  );
  documentation = replaceCount(
    documentation,
    `attempt ${current.runAttempt}`,
    `attempt ${proposed.runAttempt}`,
    1,
  );
  documentation = replaceCount(
    documentation,
    current.manifestSha256,
    proposed.manifestSha256,
    1,
  );
  return {
    [TARGETS[0]]: validator,
    [TARGETS[1]]: replaceCount(
      overlay,
      current.sourceSha,
      proposed.sourceSha,
      1,
    ),
    [TARGETS[2]]: documentation,
  };
}

function makeDiff(filename, before, after) {
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  if (before.endsWith('\n')) beforeLines.pop();
  if (after.endsWith('\n')) afterLines.pop();
  if (beforeLines.length !== afterLines.length) fail();

  const changedLines = [];
  for (let index = 0; index < beforeLines.length; index += 1) {
    if (beforeLines[index] !== afterLines[index]) {
      changedLines.push(index);
    }
  }
  if (changedLines.length === 0) return '';

  const groups = [];
  for (const index of changedLines) {
    const previous = groups.at(-1);
    if (previous && index <= previous.end + 6) {
      previous.end = index;
    } else {
      groups.push({ start: index, end: index });
    }
  }

  const hunks = groups.map(({ start, end }) => {
    const firstLine = Math.max(0, start - 3);
    const finalLine = Math.min(beforeLines.length, end + 4);
    const lines = [];
    for (let index = firstLine; index < finalLine; index += 1) {
      if (beforeLines[index] === afterLines[index]) {
        lines.push(` ${beforeLines[index]}`);
      } else {
        lines.push(`-${beforeLines[index]}`, `+${afterLines[index]}`);
      }
    }
    const count = finalLine - firstLine;
    return `@@ -${firstLine + 1},${count} +${firstLine + 1},${count} @@\n${lines.join('\n')}\n`;
  });
  return `--- a/${filename}\n+++ b/${filename}\n${hunks.join('')}`;
}

// This produces an overlay only; the archive must be verified separately.
export function createServerOverlay({ manifestBytes, expectedManifestSha256 }) {
  if (!/^[0-9a-f]{64}$/.test(expectedManifestSha256 ?? '')) fail();
  if (
    createHash('sha256').update(manifestBytes).digest('hex') !==
    expectedManifestSha256
  )
    fail();
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString('utf8'));
  } catch {
    fail();
  }
  const candidate = validateManifest(manifest, 'server-only');
  return `services:\n  server:\n    image: ${candidate.images.server}\n`;
}

export function createProposal({
  manifestBytes,
  expectedManifestSha256,
  files,
}) {
  if (!/^[0-9a-f]{64}$/.test(expectedManifestSha256 ?? '')) fail();
  const actualManifestSha256 = createHash('sha256')
    .update(manifestBytes)
    .digest('hex');
  if (actualManifestSha256 !== expectedManifestSha256) fail();

  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString('utf8'));
  } catch {
    fail();
  }
  const proposed = validateManifest(manifest);
  proposed.manifestSha256 = actualManifestSha256;
  const current = currentValidatorPins(files[TARGETS[0]]);
  if (
    proposed.sourceSha === current.sourceSha &&
    proposed.workflowSha === current.workflowSha &&
    proposed.manifestSha256 === current.manifestSha256 &&
    proposed.runId === current.runId &&
    proposed.runAttempt === current.runAttempt &&
    proposed.platform === current.platform &&
    Object.keys(IMAGE_REPOSITORIES).every(
      (name) => proposed.images[name] === current.images[name],
    )
  ) {
    fail();
  }

  const updated = updatePinsInFiles(files, current, proposed);
  const patch = TARGETS.map((filename) =>
    makeDiff(filename, files[filename], updated[filename]),
  ).join('');
  if (patch.length === 0) fail();
  return patch;
}

function main(args) {
  try {
    const { values, positionals } = parseArgs({
      args,
      options: {
        manifest: { type: 'string' },
        'manifest-sha256': { type: 'string' },
        'server-only-overlay': { type: 'boolean' },
      },
      strict: true,
      allowPositionals: false,
    });
    if (
      positionals.length !== 0 ||
      typeof values.manifest !== 'string' ||
      typeof values['manifest-sha256'] !== 'string'
    ) {
      fail();
    }
    const manifestBytes = readManifestBytes(values.manifest);
    if (values['server-only-overlay']) {
      process.stdout.write(
        createServerOverlay({
          manifestBytes,
          expectedManifestSha256: values['manifest-sha256'],
        }),
      );
      return;
    }
    const files = Object.fromEntries(
      TARGETS.map((filename) => [
        filename,
        readFileSync(path.resolve(filename), 'utf8'),
      ]),
    );
    const patch = createProposal({
      manifestBytes,
      expectedManifestSha256: values['manifest-sha256'],
      files,
    });
    process.stdout.write(
      '# Proposal only: review this patch; no files were changed.\n',
    );
    process.stdout.write(patch);
  } catch {
    process.stderr.write(`${FAILURE}\n`);
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main(process.argv.slice(2));
}
