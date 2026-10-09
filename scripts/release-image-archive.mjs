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
export const MAX_MANIFEST_BYTES = 64 * 1024;
export const MAX_IMAGE_ARCHIVE_BYTES = 2 * 1024 * 1024 * 1024;
export const MAX_TOTAL_ARCHIVE_BYTES = 4 * 1024 * 1024 * 1024;
export const MAX_NOTICE_FILE_BYTES = 1024 * 1024;
export const MAX_TOTAL_NOTICE_BYTES = 8 * 1024 * 1024;

const GIT_SHA = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const IMAGE_DIGEST = /^sha256:[0-9a-f]{64}$/;
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
const noticeFiles = [
  { sourcePath: 'LICENSE', archivePath: 'notices/project-LICENSE' },
  { sourcePath: 'NOTICE', archivePath: 'notices/project-NOTICE' },
  {
    sourcePath: 'matrix-calendar-server/NOTICE',
    archivePath: 'notices/server-NOTICE',
  },
  {
    sourcePath: 'matrix-calendar-widget/NOTICE',
    archivePath: 'notices/widget-NOTICE',
  },
  {
    sourcePath: 'packages/ical-timezones/NOTICE.md',
    archivePath: 'notices/ical-timezones-NOTICE.md',
  },
  {
    sourcePath: 'packages/ical-timezones/src/data/licenses/IANA-theory.html',
    archivePath: 'notices/IANA-theory.html',
  },
  {
    sourcePath:
      'packages/ical-timezones/src/data/licenses/timezones-ical-library-LICENSE',
    archivePath: 'notices/timezones-ical-library-LICENSE',
  },
];

function fail(message) {
  throw new Error(message);
}

function isJsonObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOwnJsonField(value, field) {
  return isJsonObject(value) && Object.hasOwn(value, field);
}

function isImageDigest(value) {
  return typeof value === 'string' && IMAGE_DIGEST.test(value);
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

export function imageBaseRefs(text, name) {
  const refs = [];
  const stageAliases = new Set();
  for (const line of text.split(/\r?\n/)) {
    if (!/^\s*FROM\s/i.test(line)) continue;
    const match = line.trim().match(/^FROM\s+(\S+)(?:\s+AS\s+(\S+))?\s*$/i);
    if (!match) fail(`${name} has an unresolved or unpinned base image.`);
    const [, base, stageAlias] = match;
    if (!stageAliases.has(base)) {
      if (!BASE_REF.test(base))
        fail(`${name} has an unresolved or unpinned base image.`);
      if (!refs.includes(base)) refs.push(base);
    }
    if (stageAlias) stageAliases.add(stageAlias);
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

function validateNoticeSizes(noticesToCheck) {
  let total = 0;
  for (const { sourcePath, bytes } of noticesToCheck) {
    if (!Number.isSafeInteger(bytes) || bytes < 1)
      fail(`${sourcePath} notice size is invalid.`);
    if (bytes > MAX_NOTICE_FILE_BYTES)
      fail(`${sourcePath} exceeds the 1 MiB notice-file limit.`);
    total += bytes;
  }
  if (total > MAX_TOTAL_NOTICE_BYTES)
    fail('License and notice files exceed the 8 MiB combined limit.');
}

function sourceNoticeBlobs(sourceRoot, sourceSha) {
  const entries = [];
  for (const definition of noticeFiles) {
    const treeEntry = git(sourceRoot, [
      'ls-tree',
      sourceSha,
      '--',
      definition.sourcePath,
    ]).value;
    const [metadata, sourcePath] = treeEntry.split('\t');
    const [mode, type, blobSha] = (metadata ?? '').split(/\s+/);
    if (
      mode !== '100644' ||
      type !== 'blob' ||
      sourcePath !== definition.sourcePath ||
      !GIT_SHA.test(blobSha ?? '')
    ) {
      fail(
        `${definition.sourcePath} must be a regular file in the source commit.`,
      );
    }
    const bytes = Number(git(sourceRoot, ['cat-file', '-s', blobSha]).value);
    entries.push({ ...definition, blobSha, bytes });
  }
  validateNoticeSizes(entries);

  return entries.map((entry) => {
    const result = spawnSync(
      'git',
      ['-C', sourceRoot, 'cat-file', 'blob', entry.blobSha],
      { encoding: null, maxBuffer: MAX_NOTICE_FILE_BYTES + 1 },
    );
    if (result.error || result.status !== 0 || !Buffer.isBuffer(result.stdout))
      fail(
        `Could not read ${entry.sourcePath} from the accepted source commit.`,
      );
    if (result.stdout.length !== entry.bytes)
      fail(`${entry.sourcePath} changed while reading the source commit.`);
    return { ...entry, content: result.stdout };
  });
}

async function writeNoticeBundle(sourceRoot, sourceSha, archiveRoot) {
  const sourceNotices = sourceNoticeBlobs(sourceRoot, sourceSha);
  await mkdir(archiveRoot, { recursive: true });
  const rootInfo = await lstat(archiveRoot);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink())
    fail('Artifact root must be a real directory.');
  await mkdir(childPath(archiveRoot, 'notices', 'Notice bundle path'));
  for (const notice of sourceNotices) {
    await writeNew(
      childPath(archiveRoot, notice.archivePath, 'Notice archive path'),
      notice.content,
    );
  }
  return sourceNotices.map((notice) => ({
    source_path: notice.sourcePath,
    path: notice.archivePath,
    sha256: sha256Text(notice.content),
    bytes: notice.bytes,
  }));
}

async function validateNoticeBundle(sourceRoot, sourceSha, archiveRoot) {
  const sourceNotices = sourceNoticeBlobs(sourceRoot, sourceSha);
  const rootInfo = await lstat(archiveRoot);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink())
    fail('Artifact root must be a real directory.');
  const root = await realpath(archiveRoot);
  const noticeRoot = childPath(root, 'notices', 'Notice bundle path');
  const noticeRootInfo = await lstat(noticeRoot);
  if (!noticeRootInfo.isDirectory() || noticeRootInfo.isSymbolicLink())
    fail('Notice bundle must be a real directory.');
  const resolvedNoticeRoot = await realpath(noticeRoot);
  if (!resolvedNoticeRoot.startsWith(`${root}${path.sep}`))
    fail('Notice bundle resolves outside the artifact.');

  const records = [];
  for (const notice of sourceNotices) {
    const file = childPath(root, notice.archivePath, 'Notice archive path');
    const resolvedFile = await realpath(file);
    if (!resolvedFile.startsWith(`${resolvedNoticeRoot}${path.sep}`))
      fail(`${notice.archivePath} resolves outside the notice bundle.`);
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size !== notice.bytes) {
      fail(`${notice.archivePath} has an invalid file type or size.`);
    }
    const content = await readFile(file);
    if (!content.equals(notice.content))
      fail(`${notice.archivePath} does not match its accepted source file.`);
    records.push({
      source_path: notice.sourcePath,
      path: notice.archivePath,
      sha256: sha256Text(notice.content),
      bytes: notice.bytes,
    });
  }
  return records;
}

export async function prepareBuild({
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
  const notices = await writeNoticeBundle(sourceRoot, source.sha, archiveRoot);
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
  return { notices };
}

function validateArchiveSizes(archives) {
  let total = 0;
  for (const { name, bytes } of archives) {
    if (!Number.isSafeInteger(bytes) || bytes < 1)
      fail(`${name} archive must be a non-empty regular file.`);
    if (bytes > MAX_IMAGE_ARCHIVE_BYTES)
      fail(`${name} archive exceeds the 2 GiB per-image limit.`);
    total += bytes;
  }
  if (total > MAX_TOTAL_ARCHIVE_BYTES)
    fail('Image archives exceed the 4 GiB combined limit.');
}

async function archiveRecords(root) {
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink())
    fail('Artifact root must be a real directory.');
  const resolvedRoot = await realpath(root);
  const records = [];
  for (const definition of images) {
    const file = childPath(root, definition.archive, 'Archive path');
    const resolvedFile = await realpath(file);
    if (!resolvedFile.startsWith(`${resolvedRoot}${path.sep}`))
      fail(`${definition.archive} resolves outside the artifact.`);
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink())
      fail(`${definition.archive} must be a non-empty regular file.`);
    records.push({
      name: definition.name,
      file,
      path: definition.archive,
      bytes: info.size,
    });
  }
  validateArchiveSizes(records);
  const result = new Map();
  for (const record of records) {
    result.set(record.name, {
      path: record.path,
      sha256: await sha256File(record.file),
      bytes: record.bytes,
    });
  }
  return result;
}

async function imageRecord(
  definition,
  { sourceRoot, buildRoot, source, nodeBase, runTag, archives },
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

  const metadataText = await readFile(
    path.join(buildRoot, definition.metadata),
    'utf8',
  );
  let metadata;
  try {
    metadata = JSON.parse(metadataText);
  } catch (error) {
    if (error instanceof SyntaxError)
      fail(
        `${definition.name} Buildx metadata is invalid JSON. diagnostic={"reason":"invalid_metadata_json"}`,
      );
    throw error;
  }
  const metadataIsObject = isJsonObject(metadata);
  const descriptor = metadataIsObject
    ? metadata['containerimage.descriptor']
    : undefined;
  const descriptorIsObject = isJsonObject(descriptor);
  const digest = metadataIsObject
    ? metadata['containerimage.digest']
    : undefined;
  const configDigest = metadataIsObject
    ? metadata['containerimage.config.digest']
    : undefined;
  const descriptorDigest = descriptorIsObject ? descriptor.digest : undefined;
  let imageId = '';
  let imageIdReadable = true;
  let imageIdReadError;
  try {
    imageId = (
      await readFile(path.join(buildRoot, definition.imageId), 'utf8')
    ).trim();
  } catch (error) {
    imageIdReadable = false;
    imageIdReadError = error;
  }
  const digestValid = isImageDigest(digest);
  const descriptorDigestValid = isImageDigest(descriptorDigest);
  const configDigestValid = isImageDigest(configDigest);
  const imageIdValid = imageIdReadable && isImageDigest(imageId);
  const diagnosticFacts = {
    metadata_is_object: metadataIsObject,
    manifest_digest_present: hasOwnJsonField(metadata, 'containerimage.digest'),
    manifest_digest_is_string: typeof digest === 'string',
    manifest_digest_is_sha256: digestValid,
    descriptor_present: hasOwnJsonField(metadata, 'containerimage.descriptor'),
    descriptor_is_object: descriptorIsObject,
    descriptor_digest_present: hasOwnJsonField(descriptor, 'digest'),
    descriptor_digest_is_string: typeof descriptorDigest === 'string',
    descriptor_digest_is_sha256: descriptorDigestValid,
    manifest_and_descriptor_values_equal:
      typeof digest === 'string' &&
      typeof descriptorDigest === 'string' &&
      descriptorDigest === digest,
    valid_manifest_and_descriptor_digests_equal:
      digestValid && descriptorDigestValid && descriptorDigest === digest,
    config_digest_present: hasOwnJsonField(
      metadata,
      'containerimage.config.digest',
    ),
    config_digest_is_string: typeof configDigest === 'string',
    config_digest_is_sha256: configDigestValid,
    loaded_image_id_available: imageIdReadable,
    loaded_image_id_is_sha256: imageIdValid,
    manifest_digest_equals_loaded_image_id:
      digestValid && imageIdValid && digest === imageId,
    config_digest_equals_loaded_image_id:
      configDigestValid && imageIdValid && configDigest === imageId,
  };
  const manifestDigestReason = !digestValid
    ? 'invalid_result_digest'
    : !descriptorDigestValid
      ? 'invalid_descriptor_digest'
      : diagnosticFacts.valid_manifest_and_descriptor_digests_equal
        ? undefined
        : 'result_descriptor_digest_mismatch';
  if (manifestDigestReason) {
    fail(
      `${definition.name} Buildx metadata has no consistent image manifest digest. diagnostic=${JSON.stringify(
        { reason: manifestDigestReason, ...diagnosticFacts },
      )}`,
    );
  }
  if (!imageIdReadable) throw imageIdReadError;
  const configDigestReason = !configDigestValid
    ? 'invalid_config_digest'
    : !imageIdValid
      ? 'invalid_loaded_image_id'
      : diagnosticFacts.config_digest_equals_loaded_image_id
        ? undefined
        : 'config_loaded_image_id_mismatch';
  if (configDigestReason) {
    fail(
      `${definition.name} loaded image ID does not match the Buildx config digest. diagnostic=${JSON.stringify(
        { reason: configDigestReason, ...diagnosticFacts },
      )}`,
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
    archive: archives.get(definition.name),
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
  const archives = await archiveRecords(archiveRoot);
  const notices = await validateNoticeBundle(
    sourceRoot,
    source.sha,
    archiveRoot,
  );
  const runTag = `archive-${context.runId}-${context.runAttempt}`;
  const builtImages = [];
  for (const definition of images) {
    builtImages.push(
      await imageRecord(definition, {
        sourceRoot,
        buildRoot,
        source,
        nodeBase: context.nodeBase,
        runTag,
        archives,
      }),
    );
  }
  const manifest = {
    schema_version: 2,
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
    notices,
  };
  validateManifest(manifest);
  const manifestBytes = `${JSON.stringify(manifest, null, 2)}\n`;
  if (Buffer.byteLength(manifestBytes) > MAX_MANIFEST_BYTES)
    fail('Image archive manifest exceeds the 64 KiB limit.');
  await writeNew(path.join(archiveRoot, 'manifest.json'), manifestBytes);
  return manifest;
}

function validateManifest(manifest) {
  if (
    manifest?.schema_version !== 2 ||
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
  const archiveSizes = [];
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
    archiveSizes.push({ name: definition.name, bytes: image.archive.bytes });
  }
  validateArchiveSizes(archiveSizes);
  validateManifestNotices(manifest.notices);
}

function validateManifestNotices(noticesInManifest) {
  if (
    !Array.isArray(noticesInManifest) ||
    noticesInManifest.length !== noticeFiles.length
  ) {
    fail('Manifest must contain all seven required license and notice files.');
  }
  const noticeSizes = [];
  for (const definition of noticeFiles) {
    const notice = noticesInManifest.find(
      (entry) => entry.source_path === definition.sourcePath,
    );
    if (!notice || notice.path !== definition.archivePath)
      fail(`Manifest is missing required notice ${definition.sourcePath}.`);
    requireSha256(notice.sha256, `${definition.sourcePath} notice hash`);
    noticeSizes.push({
      sourcePath: definition.sourcePath,
      bytes: notice.bytes,
    });
  }
  validateNoticeSizes(noticeSizes);
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
  const manifestInfo = await lstat(manifestPath);
  if (!manifestInfo.isFile() || manifestInfo.isSymbolicLink())
    fail('Manifest must be a regular file.');
  if (manifestInfo.size > MAX_MANIFEST_BYTES)
    fail('Image archive manifest exceeds the 64 KiB limit.');
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
    ...noticeFiles.map((notice) => notice.archivePath),
  ]);
  const archiveFiles = [];
  let totalArchiveBytes = 0;
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
    if (info.size > MAX_IMAGE_ARCHIVE_BYTES)
      fail(`${image.name} archive exceeds the 2 GiB per-image limit.`);
    totalArchiveBytes += info.size;
    archiveFiles.push({
      file,
      path: image.archive.path,
      sha256: image.archive.sha256,
    });
  }
  if (totalArchiveBytes > MAX_TOTAL_ARCHIVE_BYTES)
    fail('Image archives exceed the 4 GiB combined limit.');

  const noticeArchiveFiles = [];
  let totalNoticeBytes = 0;
  const noticesRoot = childPath(root, 'notices', 'Notice bundle path');
  const noticesRootInfo = await lstat(noticesRoot);
  if (!noticesRootInfo.isDirectory() || noticesRootInfo.isSymbolicLink())
    fail('Notice bundle must be a real directory.');
  const resolvedNoticesRoot = await realpath(noticesRoot);
  if (!resolvedNoticesRoot.startsWith(`${root}${path.sep}`))
    fail('Notice bundle resolves outside the artifact directory.');
  for (const notice of manifest.notices) {
    const file = childPath(root, notice.path, 'Notice archive path');
    const resolved = await realpath(file);
    if (!resolved.startsWith(`${resolvedNoticesRoot}${path.sep}`))
      fail(`${notice.path} escapes the notice bundle.`);
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size !== notice.bytes) {
      fail(`${notice.path} has an invalid file type or size.`);
    }
    if (info.size > MAX_NOTICE_FILE_BYTES)
      fail(`${notice.source_path} exceeds the 1 MiB notice-file limit.`);
    totalNoticeBytes += info.size;
    noticeArchiveFiles.push({
      file,
      path: notice.path,
      sha256: notice.sha256,
    });
  }
  if (totalNoticeBytes > MAX_TOTAL_NOTICE_BYTES)
    fail('License and notice files exceed the 8 MiB combined limit.');
  for (const archive of archiveFiles) {
    if ((await sha256File(archive.file)) !== archive.sha256)
      fail(`${archive.path} failed SHA-256 verification.`);
  }
  for (const notice of noticeArchiveFiles) {
    if ((await sha256File(notice.file)) !== notice.sha256)
      fail(`${notice.path} failed SHA-256 verification.`);
  }
  async function inspect(directory, prefix = '') {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const name = prefix ? `${prefix}/${item.name}` : item.name;
      const file = path.join(directory, item.name);
      const info = await lstat(file);
      if (info.isSymbolicLink())
        fail(`Artifact contains a symbolic link: ${name}.`);
      if (info.isDirectory()) {
        if (name !== 'images' && name !== 'notices')
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
      archiveRoot: resolve('archive-root'),
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
