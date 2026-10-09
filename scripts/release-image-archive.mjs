#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SUPPORTED_PLATFORM = 'linux/amd64';
export const REPOSITORY = '0cwa/matrix-calendar-widget';
export const WORKFLOW_PATH = '.github/workflows/release-image-archive.yml';
export const HELPER_PATH = 'scripts/release-image-archive.mjs';

const GIT_SHA = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const BASE_REF = /^\S+@sha256:[0-9a-f]{64}$/;
const images = [
  {
    name: 'server',
    tagRepository: 'server',
    dockerfile: 'matrix-calendar-server/Dockerfile',
    archive: 'images/server-linux-amd64.tar',
    metadata: 'server.json',
    imageId: 'server.image-id',
  },
  {
    name: 'widget',
    tagRepository: 'widget',
    dockerfile: 'matrix-calendar-widget/Dockerfile',
    archive: 'images/widget-linux-amd64.tar',
    metadata: 'widget.json',
    imageId: 'widget.image-id',
  },
  {
    name: 'radicale',
    tagRepository: 'radicale-openid',
    dockerfile: 'radicale-auth/Dockerfile',
    archive: 'images/radicale-linux-amd64.tar',
    metadata: 'radicale.json',
    imageId: 'radicale.image-id',
  },
];

function fail(message) {
  throw new Error(message);
}

function requireValue(value, name) {
  if (typeof value !== 'string' || value.length === 0)
    fail(`${name} is required.`);
  return value;
}

function requireGitSha(value, name) {
  if (typeof value !== 'string' || !GIT_SHA.test(value))
    fail(`${name} must be a full lowercase Git SHA.`);
  return value;
}

function requireSha256(value, name) {
  if (typeof value !== 'string' || !SHA256.test(value))
    fail(`${name} must be a lowercase SHA-256 digest.`);
  return value;
}

function git(root, args, allowFailure = false) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  if (result.error) fail(`Could not run git: ${result.error.message}`);
  if (!allowFailure && result.status !== 0)
    fail(`Git ${args[0]} failed: ${result.stderr.trim()}`);
  return { status: result.status, value: result.stdout.trim() };
}

export function validateSourceBinding({ sourceSha, checkoutSha, dispatchSha }) {
  requireGitSha(sourceSha, 'Requested source SHA');
  requireGitSha(checkoutSha, 'Checked-out source SHA');
  requireGitSha(dispatchSha, 'Workflow dispatch SHA');
  if (sourceSha !== checkoutSha)
    fail(
      'Checked-out application source does not match the requested source SHA.',
    );
}

export function validatePlatform(platform) {
  if (platform !== SUPPORTED_PLATFORM)
    fail(`Only ${SUPPORTED_PLATFORM} archives are supported.`);
  return platform;
}

export function validateNodeBase(reference) {
  requireValue(reference, 'Resolved Node base image');
  if (!/^node:22-bookworm-slim@sha256:[0-9a-f]{64}$/.test(reference)) {
    fail('Node base must pin node:22-bookworm-slim to a SHA-256 digest.');
  }
  return reference;
}

export function deriveServerDockerfile(sourceText, nodeBase) {
  validateNodeBase(nodeBase);
  const from = /^FROM node:22-bookworm-slim(?=\s|$)/gm;
  const matches = [...sourceText.matchAll(from)];
  if (matches.length !== 2)
    fail(
      'Expected exactly two mutable Node FROM lines in the source Dockerfile.',
    );
  return {
    text: sourceText.replace(from, `FROM ${nodeBase}`),
    replacements: matches.length,
  };
}

async function sha256File(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

function sha256Text(text) {
  return createHash('sha256').update(text).digest('hex');
}

export function verifyGitSource(sourceRoot, sourceSha, dispatchSha) {
  const checkoutSha = git(sourceRoot, ['rev-parse', 'HEAD']).value;
  validateSourceBinding({ sourceSha, checkoutSha, dispatchSha });
  if (
    git(sourceRoot, ['cat-file', '-e', `${dispatchSha}^{commit}`], true)
      .status !== 0
  ) {
    fail('Workflow dispatch commit is missing from source history.');
  }
  if (
    git(
      sourceRoot,
      ['merge-base', '--is-ancestor', sourceSha, dispatchSha],
      true,
    ).status !== 0
  ) {
    fail(
      'Requested source is not an ancestor of the trusted main workflow commit.',
    );
  }
  return {
    sha: sourceSha,
    tree: git(sourceRoot, ['rev-parse', `${sourceSha}^{tree}`]).value,
  };
}

function validateContext(context) {
  requireGitSha(context.sourceSha, 'Requested source SHA');
  requireGitSha(context.dispatchSha, 'Workflow dispatch SHA');
  requireGitSha(context.workflowSha, 'Workflow SHA');
  validatePlatform(context.platform);
  validateNodeBase(context.nodeBase);
  if (context.repository !== REPOSITORY)
    fail(`Workflow must run in ${REPOSITORY}.`);
  if (
    context.workflowRef !== `${REPOSITORY}/${WORKFLOW_PATH}@refs/heads/main`
  ) {
    fail('Workflow must run from the trusted main branch.');
  }
  for (const field of ['runId', 'runAttempt']) {
    if (!/^\d+$/.test(String(context[field])) || Number(context[field]) < 1)
      fail(`${field} must be positive.`);
  }
  if (!/^https:\/\/[a-z0-9.-]+$/.test(context.serverUrl))
    fail('GitHub server URL must be an HTTPS origin.');
}

function imageBaseRefs(text, name) {
  const refs = [];
  for (const line of text.split(/\r?\n/)) {
    if (!/^\s*FROM\s/i.test(line)) continue;
    const match = line.trim().match(/^FROM\s+(\S+)(?:\s+AS\s+\S+)?\s*$/i);
    if (!match || !BASE_REF.test(match[1]))
      fail(`${name} has an unresolved or unpinned base image.`);
    if (!refs.includes(match[1])) refs.push(match[1]);
  }
  if (refs.length === 0) fail(`${name} has no base image.`);
  return refs;
}

function childPath(root, relative, label) {
  if (path.isAbsolute(relative)) fail(`${label} must be relative.`);
  const resolved = path.resolve(root, relative);
  const rootPath = path.resolve(root);
  if (resolved !== rootPath && !resolved.startsWith(`${rootPath}${path.sep}`))
    fail(`${label} escapes its directory.`);
  return resolved;
}

async function writeNew(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, data, { flag: 'wx' });
}

export async function prepareBuild({
  sourceRoot,
  toolingRoot,
  buildRoot,
  context,
}) {
  validateContext(context);
  const source = verifyGitSource(
    sourceRoot,
    context.sourceSha,
    context.dispatchSha,
  );
  if (git(toolingRoot, ['rev-parse', 'HEAD']).value !== context.workflowSha) {
    fail('Builder checkout does not match the trusted workflow SHA.');
  }
  const originalPath = path.join(
    sourceRoot,
    'matrix-calendar-server/Dockerfile',
  );
  const original = await readFile(originalPath, 'utf8');
  const derived = deriveServerDockerfile(original, context.nodeBase);
  const derivedPath = path.join(buildRoot, 'server.Dockerfile');
  await writeNew(derivedPath, derived.text);
  const recipe = {
    source_sha: source.sha,
    source_tree: source.tree,
    source_dockerfile_sha256: sha256Text(original),
    build_dockerfile_sha256: sha256Text(derived.text),
    node_base: context.nodeBase,
    replacements: derived.replacements,
  };
  await writeNew(
    path.join(buildRoot, 'server-recipe.json'),
    `${JSON.stringify(recipe, null, 2)}\n`,
  );
}

async function archiveRecord(root, relative) {
  const file = childPath(root, relative, 'Archive path');
  const resolvedRoot = await realpath(root);
  const resolvedFile = await realpath(file);
  if (!resolvedFile.startsWith(`${resolvedRoot}${path.sep}`))
    fail(`Archive ${relative} resolves outside the artifact.`);
  const info = await lstat(file);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    !Number.isSafeInteger(info.size) ||
    info.size < 1
  ) {
    fail(`Archive ${relative} must be a non-empty regular file.`);
  }
  return { path: relative, sha256: await sha256File(file), bytes: info.size };
}

async function imageRecord(
  definition,
  { sourceRoot, buildRoot, archiveRoot, source, nodeBase, runTag },
) {
  const sourceDockerfile = await readFile(
    path.join(sourceRoot, definition.dockerfile),
    'utf8',
  );
  let buildDockerfile = sourceDockerfile;
  let transformation = null;
  if (definition.name === 'server') {
    const recipe = JSON.parse(
      await readFile(path.join(buildRoot, 'server-recipe.json'), 'utf8'),
    );
    buildDockerfile = await readFile(
      path.join(buildRoot, 'server.Dockerfile'),
      'utf8',
    );
    const derived = deriveServerDockerfile(sourceDockerfile, nodeBase);
    if (
      recipe.source_sha !== source.sha ||
      recipe.source_tree !== source.tree ||
      recipe.source_dockerfile_sha256 !== sha256Text(sourceDockerfile) ||
      recipe.build_dockerfile_sha256 !== sha256Text(buildDockerfile) ||
      recipe.replacements !== derived.replacements ||
      buildDockerfile !== derived.text
    )
      fail(
        'Derived server recipe is not the recorded two-line digest pin of the requested source.',
      );
    transformation = {
      from: 'node:22-bookworm-slim',
      to: nodeBase,
      replacements: derived.replacements,
    };
  }

  const metadata = JSON.parse(
    await readFile(path.join(buildRoot, definition.metadata), 'utf8'),
  );
  const digest = metadata['containerimage.digest'];
  const configDigest = metadata['containerimage.config.digest'];
  const descriptorDigest = metadata['containerimage.descriptor']?.digest;
  if (
    !/^sha256:[0-9a-f]{64}$/.test(digest ?? '') ||
    descriptorDigest !== digest
  ) {
    fail(
      `${definition.name} Buildx metadata has no consistent image manifest digest.`,
    );
  }
  const imageId = (
    await readFile(path.join(buildRoot, definition.imageId), 'utf8')
  ).trim();
  if (
    !/^sha256:[0-9a-f]{64}$/.test(configDigest ?? '') ||
    imageId !== configDigest
  ) {
    fail(
      `${definition.name} loaded image ID does not match the Buildx config digest.`,
    );
  }
  const baseImages = imageBaseRefs(buildDockerfile, definition.name);
  if (definition.name === 'server' && !baseImages.includes(nodeBase))
    fail('Server base list omits the pinned Node image.');

  return {
    name: definition.name,
    tag: `matrix-calendar-widget/${definition.tagRepository}:${runTag}`,
    image_id: imageId,
    buildx_manifest_digest: digest,
    dockerfile: {
      source_path: definition.dockerfile,
      source_sha256: sha256Text(sourceDockerfile),
      build_path: transformation
        ? 'workflow-derived/server.Dockerfile'
        : definition.dockerfile,
      build_sha256: sha256Text(buildDockerfile),
      transformation,
    },
    base_images: baseImages,
    archive: await archiveRecord(archiveRoot, definition.archive),
  };
}

export async function createManifest({
  sourceRoot,
  toolingRoot,
  buildRoot,
  archiveRoot,
  context,
}) {
  validateContext(context);
  const source = verifyGitSource(
    sourceRoot,
    context.sourceSha,
    context.dispatchSha,
  );
  if (git(toolingRoot, ['rev-parse', 'HEAD']).value !== context.workflowSha) {
    fail('Builder checkout does not match the trusted workflow SHA.');
  }
  const runTag = `archive-${context.runId}-${context.runAttempt}`;
  const builtImages = [];
  for (const definition of images) {
    builtImages.push(
      await imageRecord(definition, {
        sourceRoot,
        buildRoot,
        archiveRoot,
        source,
        nodeBase: context.nodeBase,
        runTag,
      }),
    );
  }
  const manifest = {
    schema_version: 1,
    source: {
      sha: source.sha,
      tree: source.tree,
      dispatch_sha: context.dispatchSha,
    },
    workflow: {
      repository: context.repository,
      ref: context.workflowRef,
      sha: context.workflowSha,
      run_id: Number(context.runId),
      run_attempt: Number(context.runAttempt),
      run_url: `${context.serverUrl}/${context.repository}/actions/runs/${context.runId}`,
    },
    builder: {
      helper_sha256: await sha256File(path.join(toolingRoot, HELPER_PATH)),
      workflow_sha256: await sha256File(path.join(toolingRoot, WORKFLOW_PATH)),
    },
    platform: context.platform,
    images: builtImages,
  };
  validateManifest(manifest);
  await writeNew(
    path.join(archiveRoot, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return manifest;
}

function validateManifest(manifest) {
  if (
    manifest?.schema_version !== 1 ||
    !manifest.source ||
    !manifest.workflow ||
    !manifest.builder
  )
    fail('Invalid image archive manifest.');
  requireGitSha(manifest.source.sha, 'Manifest source SHA');
  requireGitSha(manifest.source.tree, 'Manifest source tree');
  requireGitSha(manifest.source.dispatch_sha, 'Manifest dispatch SHA');
  requireGitSha(manifest.workflow.sha, 'Manifest workflow SHA');
  if (
    manifest.workflow.repository !== REPOSITORY ||
    manifest.workflow.ref !== `${REPOSITORY}/${WORKFLOW_PATH}@refs/heads/main`
  ) {
    fail('Manifest workflow identity is not the trusted main workflow.');
  }
  if (
    !Number.isSafeInteger(manifest.workflow.run_id) ||
    manifest.workflow.run_id < 1 ||
    !Number.isSafeInteger(manifest.workflow.run_attempt) ||
    manifest.workflow.run_attempt < 1
  )
    fail('Manifest workflow run identity is invalid.');
  if (
    manifest.workflow.run_url !==
    `https://github.com/${REPOSITORY}/actions/runs/${manifest.workflow.run_id}`
  ) {
    fail('Manifest workflow run URL is invalid.');
  }
  requireSha256(manifest.builder.helper_sha256, 'Manifest helper SHA-256');
  requireSha256(manifest.builder.workflow_sha256, 'Manifest workflow SHA-256');
  validatePlatform(manifest.platform);
  if (
    !Array.isArray(manifest.images) ||
    manifest.images.length !== images.length
  )
    fail('Manifest must contain all three project images.');
  for (const definition of images) {
    const image = manifest.images.find(
      (entry) => entry.name === definition.name,
    );
    if (!image || image.archive?.path !== definition.archive)
      fail(`Manifest is missing the ${definition.name} image.`);
    if (
      image.tag !==
      `matrix-calendar-widget/${definition.tagRepository}:archive-${manifest.workflow.run_id}-${manifest.workflow.run_attempt}`
    )
      fail(`${definition.name} tag is not unique to this run.`);
    if (
      !/^sha256:[0-9a-f]{64}$/.test(image.image_id ?? '') ||
      !/^sha256:[0-9a-f]{64}$/.test(image.buildx_manifest_digest ?? '')
    )
      fail(`${definition.name} image digests are invalid.`);
    if (image.dockerfile?.source_path !== definition.dockerfile)
      fail(`${definition.name} source Dockerfile path is invalid.`);
    requireSha256(
      image.dockerfile?.source_sha256,
      `${definition.name} source Dockerfile hash`,
    );
    requireSha256(
      image.dockerfile?.build_sha256,
      `${definition.name} build Dockerfile hash`,
    );
    if (
      !Array.isArray(image.base_images) ||
      image.base_images.length === 0 ||
      image.base_images.some((ref) => !BASE_REF.test(ref))
    )
      fail(`${definition.name} base image digest is missing.`);
    if (definition.name === 'server') {
      if (
        image.dockerfile.build_path !== 'workflow-derived/server.Dockerfile' ||
        image.dockerfile.transformation?.from !== 'node:22-bookworm-slim' ||
        image.dockerfile.transformation.replacements !== 2
      )
        fail('Server recipe transformation is invalid.');
      validateNodeBase(image.dockerfile.transformation.to);
      if (!image.base_images.includes(image.dockerfile.transformation.to))
        fail('Server base list omits its pinned Node image.');
    } else if (
      image.dockerfile.transformation !== null ||
      image.dockerfile.build_path !== definition.dockerfile ||
      image.dockerfile.build_sha256 !== image.dockerfile.source_sha256
    ) {
      fail(`${definition.name} must use its exact source Dockerfile.`);
    }
    requireSha256(image.archive.sha256, `${definition.name} archive hash`);
    if (!Number.isSafeInteger(image.archive.bytes) || image.archive.bytes < 1)
      fail(`${definition.name} archive size is invalid.`);
  }
}

export async function verifyArchive(
  archiveRoot,
  {
    expectedSourceSha,
    expectedPlatform = SUPPORTED_PLATFORM,
    expectedHelperSha256,
  } = {},
) {
  const rootInfo = await lstat(archiveRoot);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink())
    fail('Artifact root must be a real directory.');
  const manifestPath = childPath(archiveRoot, 'manifest.json', 'Manifest path');
  if ((await lstat(manifestPath)).isSymbolicLink())
    fail('Manifest cannot be a symbolic link.');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  validateManifest(manifest);
  if (
    expectedSourceSha &&
    manifest.source.sha !==
      requireGitSha(expectedSourceSha, 'Expected source SHA')
  )
    fail('Artifact source SHA does not match the requested SHA.');
  if (manifest.platform !== expectedPlatform)
    fail('Artifact platform does not match the expected platform.');
  if (
    expectedHelperSha256 &&
    manifest.builder.helper_sha256 !== expectedHelperSha256
  )
    fail('Artifact was built with a different validator helper.');

  const root = await realpath(archiveRoot);
  const expectedFiles = new Set([
    'manifest.json',
    ...images.map((image) => image.archive),
  ]);
  for (const image of manifest.images) {
    const file = childPath(root, image.archive.path, 'Archive path');
    const resolved = await realpath(file);
    if (!resolved.startsWith(`${root}${path.sep}`))
      fail(`${image.archive.path} escapes the artifact directory.`);
    const info = await lstat(file);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.size !== image.archive.bytes
    )
      fail(`${image.archive.path} has an invalid file type or size.`);
    if ((await sha256File(file)) !== image.archive.sha256)
      fail(`${image.archive.path} failed SHA-256 verification.`);
  }
  async function inspect(directory, prefix = '') {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const name = prefix ? `${prefix}/${item.name}` : item.name;
      const file = path.join(directory, item.name);
      const info = await lstat(file);
      if (info.isSymbolicLink())
        fail(`Artifact contains a symbolic link: ${name}.`);
      if (info.isDirectory()) {
        if (name !== 'images')
          fail(`Artifact contains an unexpected directory: ${name}.`);
        await inspect(file, name);
      } else if (info.isFile()) {
        if (!expectedFiles.delete(name))
          fail(`Artifact contains an unexpected file: ${name}.`);
      } else {
        fail(`Artifact contains an unsupported entry: ${name}.`);
      }
    }
  }
  await inspect(root);
  if (expectedFiles.size)
    fail(`Artifact is missing: ${[...expectedFiles].join(', ')}.`);
  return manifest;
}

function contextFromEnv() {
  return {
    sourceSha: process.env.RELEASE_SOURCE_SHA,
    dispatchSha: process.env.RELEASE_DISPATCH_SHA,
    repository: process.env.RELEASE_REPOSITORY,
    workflowRef: process.env.RELEASE_WORKFLOW_REF,
    workflowSha: process.env.RELEASE_WORKFLOW_SHA,
    runId: process.env.RELEASE_RUN_ID,
    runAttempt: process.env.RELEASE_RUN_ATTEMPT,
    serverUrl: process.env.RELEASE_SERVER_URL,
    platform: process.env.IMAGE_PLATFORM,
    nodeBase: process.env.NODE_BASE_IMAGE,
  };
}

function flags(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith('--') || !value || value.startsWith('--'))
      fail(`Invalid command option: ${key ?? ''}`);
    parsed[key.slice(2)] = value;
  }
  return parsed;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const options = flags(args);
  const resolve = (key) => path.resolve(requireValue(options[key], `--${key}`));
  if (command === 'prepare') {
    await prepareBuild({
      sourceRoot: resolve('source-root'),
      toolingRoot: resolve('tooling-root'),
      buildRoot: resolve('build-root'),
      context: contextFromEnv(),
    });
    process.stdout.write('Prepared the exact source-bound build recipe.\n');
    return;
  }
  if (command === 'create') {
    const manifest = await createManifest({
      sourceRoot: resolve('source-root'),
      toolingRoot: resolve('tooling-root'),
      buildRoot: resolve('build-root'),
      archiveRoot: resolve('archive-root'),
      context: contextFromEnv(),
    });
    process.stdout.write(
      `Created image manifest for ${manifest.source.sha}.\n`,
    );
    return;
  }
  if (command === 'verify') {
    const archiveRoot = resolve('archive-root');
    const helperPath = fileURLToPath(import.meta.url);
    const toolingRoot = path.resolve(path.dirname(helperPath), '..');
    const helperHash = await sha256File(helperPath);
    const manifest = await verifyArchive(archiveRoot, {
      expectedSourceSha: options['expected-source-sha'],
      expectedPlatform: options.platform ?? SUPPORTED_PLATFORM,
      expectedHelperSha256: helperHash,
    });
    if (git(toolingRoot, ['rev-parse', 'HEAD']).value !== manifest.workflow.sha)
      fail('Validator checkout does not match the manifest workflow SHA.');
    if (
      (await sha256File(path.join(toolingRoot, WORKFLOW_PATH))) !==
      manifest.builder.workflow_sha256
    )
      fail('Workflow file does not match the manifest workflow hash.');
    process.stdout.write(
      `Verified ${manifest.images.length} archives for ${manifest.source.sha} on ${manifest.platform}.\n`,
    );
    return;
  }
  fail('Usage: release-image-archive.mjs prepare|create|verify --options');
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
