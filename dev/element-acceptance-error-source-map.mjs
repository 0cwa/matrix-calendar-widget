/* Modified for Matrix Calendar Widget fork, 2026. */
/*
 * Copyright 2026 Matrix Calendar Widget contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { createHash } from 'node:crypto';
import { posix as path } from 'node:path';
import { SourceMapConsumer } from 'source-map-js';

const ELEMENT_WEB_COMMIT = 'f19cfd9030429240a4209bf5175b372175cf0464';
const ELEMENT_WEB_REPOSITORY = 'element-hq/element-web';
const MAX_STACK_CHARACTERS = 16_384;
const MAX_STACK_FRAMES = 24;
const MAX_ELEMENT_BUNDLE_FRAMES = 8;
const MAX_SOURCE_MAP_LOOKUPS = 4;
const MAX_SOURCE_MAP_BYTES = 64 * 1024 * 1024;
const MAX_SOURCE_MAP_SOURCES = 4096;
const MAX_SOURCE_MAP_SOURCE_LENGTH = 4096;
const MAX_SOURCE_LOCATION = 1_000_000;
const ELEMENT_WEB_SOURCE_ROOTS = new Set([
  '',
  'webpack://element-web/',
  'webpack://element-web/./',
]);
const ELEMENT_BUNDLE_PATH =
  /^\/bundles\/[a-f0-9]{8,64}\/[A-Za-z0-9._~-]+\.js$/u;

/**
 * @typedef {{bundleUrl: string, generatedLine: number, generatedColumn: number}} ElementBundleFrame
 * @typedef {{bundleUrl: string, sourceMapText: string | null}} ElementSourceMapResult
 * @typedef {{sourceMapStatus: 'not-eligible' | 'not-attempted' | 'unavailable' | 'invalid' | 'unmapped' | 'mapped', sourceMapResolution: 'not-applicable' | 'mapped' | 'no-original-position' | 'dependency-source' | 'unsupported-source' | 'invalid-coordinate', sourceRefSha256: string | null, sourceLine: number | null, sourceColumn: number | null}} ElementErrorSourcePointer
 * @typedef {{bundleUrl: string, expectedOrigin: string, maxBytes: number, timeoutMs: number}} ElementSourceMapReadRequest
 * @typedef {{text: string | null, bytesRead: number, limitReached: boolean}} ElementSourceMapReadResult
 */

/**
 * A self-contained callback for Page.evaluate. It reads one same-origin map
 * under the caller's byte and time budgets and cancels bodies rejected before
 * streaming, so the diagnostic does not continue consuming an unused response.
 *
 * @param {ElementSourceMapReadRequest} request
 * @returns {Promise<ElementSourceMapReadResult>}
 */
export async function readElementErrorSourceMapInPage({
  bundleUrl,
  expectedOrigin,
  maxBytes,
  timeoutMs,
}) {
  let byteCount = 0;
  let budgetExhausted = false;
  let response;
  let reader;
  let timeout;

  const cancelRejectedBody = async () => {
    try {
      if (reader !== undefined) {
        await reader.cancel();
      } else if (response?.body !== null && response?.body !== undefined) {
        await response.body.cancel();
      }
    } catch {
      // A rejected or already-closed body is still safe to leave unavailable.
    }
  };

  try {
    if (
      window.location.origin !== expectedOrigin ||
      !Number.isSafeInteger(maxBytes) ||
      maxBytes < 1 ||
      maxBytes > 64 * 1024 * 1024 ||
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs < 1 ||
      timeoutMs > 2_500
    ) {
      return { text: null, bytesRead: 0, limitReached: false };
    }

    const bundle = new URL(bundleUrl);
    if (
      bundle.origin !== expectedOrigin ||
      !/^\/bundles\/[a-f0-9]{8,64}\/[A-Za-z0-9._~-]+\.js$/u.test(
        bundle.pathname,
      ) ||
      bundle.search !== '' ||
      bundle.hash !== ''
    ) {
      return { text: null, bytesRead: 0, limitReached: false };
    }

    const sourceMapUrl = new URL(`${bundle.pathname}.map`, expectedOrigin);
    const controller = new AbortController();
    timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    response = await fetch(sourceMapUrl.href, {
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      signal: controller.signal,
    });

    if (
      !response.ok ||
      response.redirected ||
      response.url !== sourceMapUrl.href ||
      !/^application\/(?:json|octet-stream)(?:\s*;|$)/iu.test(
        response.headers.get('content-type') ?? '',
      )
    ) {
      await cancelRejectedBody();
      return { text: null, bytesRead: 0, limitReached: false };
    }

    const contentLength = response.headers.get('content-length');
    if (
      contentLength !== null &&
      (!/^\d+$/u.test(contentLength) || Number(contentLength) > maxBytes)
    ) {
      await cancelRejectedBody();
      return { text: null, bytesRead: 0, limitReached: false };
    }
    if (response.body === null) {
      return { text: null, bytesRead: 0, limitReached: false };
    }

    reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let text = '';
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      if (byteCount + result.value.byteLength > maxBytes) {
        byteCount = maxBytes;
        budgetExhausted = true;
        await cancelRejectedBody();
        return { text: null, bytesRead: maxBytes, limitReached: true };
      }
      byteCount += result.value.byteLength;
      text += decoder.decode(result.value, { stream: true });
    }

    return {
      text: text + decoder.decode(),
      bytesRead: byteCount,
      limitReached: false,
    };
  } catch {
    await cancelRejectedBody();
    return {
      text: null,
      bytesRead: byteCount,
      limitReached: budgetExhausted,
    };
  } finally {
    if (timeout !== undefined) window.clearTimeout(timeout);
    if (reader !== undefined) reader.releaseLock();
  }
}

function readStack(error) {
  if (
    error === null ||
    (typeof error !== 'object' && typeof error !== 'function')
  ) {
    return null;
  }
  try {
    const stack = error.stack;
    return typeof stack === 'string' && stack.length > 0 ? stack : null;
  } catch {
    return null;
  }
}

function parseStackLocation(frame) {
  const normalized = frame.trim();
  const chromiumDirect = /^at\s+(https?:\/\/\S+)$/u.exec(normalized);
  const chromiumNamed = /^at\s+.+\s+\((https?:\/\/\S+)\)$/u.exec(normalized);
  const firefoxNamed = /^[^@\s][^@]*@(https?:\/\/\S+)$/u.exec(normalized);
  const locatedUrl =
    chromiumDirect?.[1] ?? chromiumNamed?.[1] ?? firefoxNamed?.[1];
  if (!locatedUrl) return null;

  const location = /^(https?:\/\/.*):([1-9]\d{0,6}):([1-9]\d{0,6})$/u.exec(
    locatedUrl,
  );
  if (!location) return null;

  const generatedLine = Number(location[2]);
  const oneBasedColumn = Number(location[3]);
  if (
    !Number.isSafeInteger(generatedLine) ||
    generatedLine > MAX_SOURCE_LOCATION ||
    !Number.isSafeInteger(oneBasedColumn) ||
    oneBasedColumn > MAX_SOURCE_LOCATION
  ) {
    return null;
  }

  let url;
  try {
    url = new URL(location[1]);
  } catch {
    return null;
  }
  return {
    url,
    generatedLine,
    // Chromium and Firefox stack columns are one-based; source-map columns
    // are zero-based.
    generatedColumn: oneBasedColumn - 1,
  };
}

/**
 * Returns a bounded list of transient pointers to pinned Element static
 * bundle frames. The returned URLs must stay in memory and must never be
 * serialized into acceptance evidence.
 *
 * @param {unknown} error Browser error supplied by Playwright.
 * @param {string} elementUrl Configured pinned Element URL.
 * @returns {ElementBundleFrame[]}
 */
export function extractElementBundleFrames(error, elementUrl) {
  const stack = readStack(error);
  if (stack === null || stack.length > MAX_STACK_CHARACTERS) return [];

  const lines = stack.split(/\r?\n/u);

  let expectedOrigin;
  try {
    expectedOrigin = new URL(elementUrl).origin;
  } catch {
    return [];
  }

  const frames = [];
  for (const frame of lines.slice(1, MAX_STACK_FRAMES + 1)) {
    if (frames.length >= MAX_ELEMENT_BUNDLE_FRAMES) break;
    const parsed = parseStackLocation(frame);
    if (!parsed) continue;
    const { url, generatedLine, generatedColumn } = parsed;
    if (
      url.origin !== expectedOrigin ||
      url.username !== '' ||
      url.password !== '' ||
      url.search !== '' ||
      url.hash !== '' ||
      !ELEMENT_BUNDLE_PATH.test(url.pathname)
    ) {
      continue;
    }

    frames.push({
      bundleUrl: url.href,
      generatedLine,
      generatedColumn,
    });
  }

  return frames;
}

function isValidElementBundleFrame(frame) {
  if (
    frame === null ||
    typeof frame !== 'object' ||
    typeof frame.bundleUrl !== 'string' ||
    !Number.isSafeInteger(frame.generatedLine) ||
    frame.generatedLine < 1 ||
    frame.generatedLine > MAX_SOURCE_LOCATION ||
    !Number.isSafeInteger(frame.generatedColumn) ||
    frame.generatedColumn < 0 ||
    frame.generatedColumn > MAX_SOURCE_LOCATION
  ) {
    return false;
  }
  try {
    const url = new URL(frame.bundleUrl);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.username === '' &&
      url.password === '' &&
      url.search === '' &&
      url.hash === '' &&
      ELEMENT_BUNDLE_PATH.test(url.pathname)
    );
  } catch {
    return false;
  }
}

function safeRepositoryPath(pathname) {
  return (
    pathname.length > 0 &&
    /^(?:apps\/web|packages)\/[A-Za-z0-9._/-]+$/u.test(pathname) &&
    !pathname
      .split('/')
      .some((segment) => segment === '' || segment === '.' || segment === '..')
  );
}

function safePathTail(value) {
  return (
    value.length > 0 &&
    /^[A-Za-z0-9@._/-]+$/u.test(value) &&
    !value
      .split('/')
      .some((segment) => segment === '' || segment === '.' || segment === '..')
  );
}

function canonicalWorkspacePath(relativePath) {
  const prefix = '../../packages/';
  if (
    !relativePath.startsWith(prefix) ||
    !safePathTail(relativePath.slice(prefix.length))
  ) {
    return null;
  }
  const canonical = path.normalize(path.join('apps/web', relativePath));
  return canonical.startsWith('packages/') && safeRepositoryPath(canonical)
    ? canonical
    : null;
}

function namespacePath(rawSource) {
  if (!rawSource.startsWith('webpack://element-web/')) return null;
  const resourcePath = rawSource.slice('webpack://element-web/'.length);
  const safeAppSource = (candidate) =>
    (candidate.startsWith('src/') || candidate.startsWith('./src/')) &&
    safePathTail(candidate.replace(/^\.\//u, ''));
  const safeWorkspaceSource = (candidate) =>
    canonicalWorkspacePath(candidate) !== null;
  const safeDependencySource = (candidate) => {
    for (const prefix of [
      'node_modules/',
      './node_modules/',
      '../../node_modules/',
      '../../packages/',
    ]) {
      if (candidate.startsWith(prefix)) {
        return knownElementDependencySource(candidate);
      }
    }
    return false;
  };
  const safeExplicitAppSource = (candidate) =>
    candidate.startsWith('apps/web/') && safeRepositoryPath(candidate);
  if (
    !safeAppSource(resourcePath) &&
    !safeWorkspaceSource(resourcePath) &&
    !safeDependencySource(resourcePath) &&
    !safeExplicitAppSource(resourcePath)
  ) {
    return null;
  }
  try {
    const url = new URL(rawSource);
    return url.protocol === 'webpack:' &&
      url.hostname === 'element-web' &&
      url.username === '' &&
      url.password === '' &&
      url.port === '' &&
      url.search === '' &&
      url.hash === ''
      ? url.pathname.slice(1)
      : null;
  } catch {
    return null;
  }
}

function resolvedMapSource(rawSource, sourceRoot) {
  try {
    if (sourceRoot !== '') return new URL(rawSource, sourceRoot).href;
    return rawSource.startsWith('webpack://')
      ? new URL(rawSource).href
      : rawSource;
  } catch {
    return null;
  }
}

function knownElementDependencySource(rawSource) {
  let relative = rawSource;
  if (rawSource.startsWith('webpack://element-web/')) {
    const exactNamespacePath = rawSource.slice('webpack://element-web/'.length);
    if (
      !exactNamespacePath.startsWith('node_modules/') &&
      !exactNamespacePath.startsWith('./node_modules/') &&
      !exactNamespacePath.startsWith('../../node_modules/') &&
      !exactNamespacePath.startsWith('../../packages/')
    ) {
      return false;
    }
    relative = exactNamespacePath;
  }

  for (const prefix of [
    'node_modules/',
    './node_modules/',
    '../../node_modules/',
  ]) {
    if (relative.startsWith(prefix)) {
      return safePathTail(relative.slice(prefix.length));
    }
  }

  const workspacePrefix = '../../packages/';
  if (relative.startsWith(workspacePrefix)) {
    const workspacePath = relative.slice(workspacePrefix.length);
    const dependencyIndex = workspacePath.indexOf('/node_modules/');
    return (
      dependencyIndex > 0 &&
      safePathTail(workspacePath.slice(0, dependencyIndex)) &&
      safePathTail(
        workspacePath.slice(dependencyIndex + '/node_modules/'.length),
      )
    );
  }
  return false;
}

function canonicalElementSourcePath(source, rawSource, sourceRoot) {
  if (
    typeof source !== 'string' ||
    source.length > MAX_SOURCE_MAP_SOURCE_LENGTH ||
    typeof rawSource !== 'string' ||
    rawSource.length > MAX_SOURCE_MAP_SOURCE_LENGTH ||
    typeof sourceRoot !== 'string' ||
    !ELEMENT_WEB_SOURCE_ROOTS.has(sourceRoot) ||
    source !== resolvedMapSource(rawSource, sourceRoot)
  ) {
    return null;
  }

  // Webpack's moduleFilenameTemplate is rooted at apps/web for the pinned
  // Element build. App sources are `src/...`; workspace sources are exactly
  // two parent segments followed by `packages/...`.
  const rawNamespacePath = namespacePath(rawSource);
  const pathCandidates = [rawSource, rawNamespacePath].filter(
    (candidate) => typeof candidate === 'string',
  );

  for (const candidate of pathCandidates) {
    if (candidate.startsWith('src/') || candidate.startsWith('./src/')) {
      const relative = candidate.replace(/^\.\//u, '');
      if (safePathTail(relative)) {
        const canonical = `apps/web/${relative}`;
        if (safeRepositoryPath(canonical)) return canonical;
      }
      continue;
    }

    if (candidate.startsWith('../../packages/')) {
      const canonical = canonicalWorkspacePath(candidate);
      if (canonical !== null) {
        return canonical;
      }
      continue;
    }

    if (candidate.startsWith('apps/web/')) {
      return safeRepositoryPath(candidate) ? candidate : null;
    }

    // A source already carrying Webpack's namespace may include the app root
    // or the exact two-level workspace prefix in its resource path.
    if (
      candidate.startsWith('webpack://element-web/src/') ||
      candidate.startsWith('webpack://element-web/./src/')
    ) {
      const appPath = namespacePath(candidate);
      if (appPath?.startsWith('src/') && safePathTail(appPath)) {
        const canonical = `apps/web/${appPath}`;
        if (safeRepositoryPath(canonical)) return canonical;
      }
      continue;
    }

    if (candidate.startsWith('webpack://element-web/../../packages/')) {
      const workspacePath = namespacePath(candidate);
      if (
        workspacePath?.startsWith('packages/') &&
        safeRepositoryPath(workspacePath)
      ) {
        return workspacePath;
      }
      continue;
    }
  }

  return null;
}

function invalidPointer() {
  return {
    sourceMapStatus: 'invalid',
    sourceMapResolution: 'not-applicable',
    sourceRefSha256: null,
    sourceLine: null,
    sourceColumn: null,
  };
}

/** @param {'no-original-position' | 'dependency-source' | 'unsupported-source' | 'invalid-coordinate'} resolution */
function unmappedPointer(resolution) {
  return {
    sourceMapStatus: 'unmapped',
    sourceMapResolution: resolution,
    sourceRefSha256: null,
    sourceLine: null,
    sourceColumn: null,
  };
}

/**
 * Resolves a transient map response to an opaque source reference tied to the
 * exact public Element Web commit. Only repo-owned source paths are eligible;
 * raw source paths, map contents, bundle URLs, and stack text are not returned.
 *
 * @param {ElementBundleFrame[]} frames Transient generated frames in stack order.
 * @param {ElementSourceMapResult[]} sourceMaps Capped same-origin map bodies, if read.
 * @returns {ElementErrorSourcePointer}
 */
export function resolveElementErrorSourcePointer(frames, sourceMaps) {
  if (!Array.isArray(frames) || frames.length === 0) {
    return {
      sourceMapStatus: 'not-eligible',
      sourceMapResolution: 'not-applicable',
      sourceRefSha256: null,
      sourceLine: null,
      sourceColumn: null,
    };
  }
  if (
    !Array.isArray(sourceMaps) ||
    sourceMaps.length > MAX_SOURCE_MAP_LOOKUPS ||
    frames.length > MAX_ELEMENT_BUNDLE_FRAMES ||
    !frames.every(isValidElementBundleFrame)
  ) {
    return invalidPointer();
  }

  const frameBundles = new Set(frames.map((frame) => frame.bundleUrl));
  const mapByBundle = new Map();
  for (const sourceMap of sourceMaps) {
    if (
      sourceMap === null ||
      typeof sourceMap !== 'object' ||
      typeof sourceMap.bundleUrl !== 'string' ||
      !frameBundles.has(sourceMap.bundleUrl) ||
      (sourceMap.sourceMapText !== null &&
        (typeof sourceMap.sourceMapText !== 'string' ||
          Buffer.byteLength(sourceMap.sourceMapText, 'utf8') >
            MAX_SOURCE_MAP_BYTES)) ||
      mapByBundle.has(sourceMap.bundleUrl)
    ) {
      return invalidPointer();
    }
    mapByBundle.set(sourceMap.bundleUrl, sourceMap.sourceMapText);
  }

  let hadInvalidMap = false;
  let hadUnavailableMap = false;
  let hadValidUnmappedFrame = false;
  /** @type {'no-original-position' | 'dependency-source' | 'unsupported-source' | 'invalid-coordinate' | null} */
  let firstUnmappedResolution = null;
  for (const frame of frames) {
    if (!mapByBundle.has(frame.bundleUrl)) {
      hadUnavailableMap = true;
      continue;
    }

    const sourceMapText = mapByBundle.get(frame.bundleUrl);
    if (sourceMapText === null) {
      hadUnavailableMap = true;
      continue;
    }
    const pointer = resolveFramePointer(frame, sourceMapText);
    if (pointer.sourceMapStatus === 'mapped') return pointer;
    if (pointer.sourceMapStatus === 'invalid') hadInvalidMap = true;
    else {
      hadValidUnmappedFrame = true;
      if (firstUnmappedResolution === null) {
        firstUnmappedResolution = pointer.sourceMapResolution;
      }
    }
  }

  if (hadUnavailableMap) {
    return {
      sourceMapStatus: 'unavailable',
      sourceMapResolution: 'not-applicable',
      sourceRefSha256: null,
      sourceLine: null,
      sourceColumn: null,
    };
  }
  if (hadValidUnmappedFrame && firstUnmappedResolution !== null) {
    return unmappedPointer(firstUnmappedResolution);
  }
  if (hadInvalidMap) return invalidPointer();
  return {
    sourceMapStatus: 'unavailable',
    sourceMapResolution: 'not-applicable',
    sourceRefSha256: null,
    sourceLine: null,
    sourceColumn: null,
  };
}

function resolveFramePointer(frame, sourceMapText) {
  if (
    typeof sourceMapText !== 'string' ||
    Buffer.byteLength(sourceMapText, 'utf8') > MAX_SOURCE_MAP_BYTES
  ) {
    return invalidPointer();
  }

  let sourceMap;
  try {
    sourceMap = JSON.parse(sourceMapText);
  } catch {
    return invalidPointer();
  }

  if (
    sourceMap === null ||
    typeof sourceMap !== 'object' ||
    Array.isArray(sourceMap) ||
    sourceMap.version !== 3 ||
    typeof sourceMap.mappings !== 'string' ||
    sourceMap.mappings.length > MAX_SOURCE_MAP_BYTES ||
    !Array.isArray(sourceMap.sources) ||
    sourceMap.sources.length === 0 ||
    sourceMap.sources.length > MAX_SOURCE_MAP_SOURCES ||
    !sourceMap.sources.every(
      (source) =>
        typeof source === 'string' &&
        source.length > 0 &&
        source.length <= MAX_SOURCE_MAP_SOURCE_LENGTH,
    ) ||
    Object.hasOwn(sourceMap, 'sections')
  ) {
    return invalidPointer();
  }
  if (
    (Object.hasOwn(sourceMap, 'sourceRoot') &&
      typeof sourceMap.sourceRoot !== 'string') ||
    !ELEMENT_WEB_SOURCE_ROOTS.has(sourceMap.sourceRoot ?? '')
  ) {
    return invalidPointer();
  }

  let bundleName;
  try {
    const bundleUrl = new URL(frame.bundleUrl);
    if (
      !ELEMENT_BUNDLE_PATH.test(bundleUrl.pathname) ||
      bundleUrl.search !== '' ||
      bundleUrl.hash !== '' ||
      !Number.isSafeInteger(frame.generatedLine) ||
      frame.generatedLine < 1 ||
      frame.generatedLine > MAX_SOURCE_LOCATION ||
      !Number.isSafeInteger(frame.generatedColumn) ||
      frame.generatedColumn < 0 ||
      frame.generatedColumn > MAX_SOURCE_LOCATION
    ) {
      return invalidPointer();
    }
    bundleName = path.basename(bundleUrl.pathname);
  } catch {
    return invalidPointer();
  }
  if (
    (Object.hasOwn(sourceMap, 'file') && typeof sourceMap.file !== 'string') ||
    (typeof sourceMap.file === 'string' &&
      path.basename(sourceMap.file) !== bundleName)
  ) {
    return invalidPointer();
  }

  let consumer;
  try {
    consumer = new SourceMapConsumer(sourceMap);
    const original = consumer.originalPositionFor({
      line: frame.generatedLine,
      column: frame.generatedColumn,
    });
    if (original.source === null) {
      return unmappedPointer('no-original-position');
    }
    if (
      !Number.isSafeInteger(original.line) ||
      original.line < 1 ||
      original.line > MAX_SOURCE_LOCATION ||
      !Number.isSafeInteger(original.column) ||
      original.column < 0 ||
      original.column > MAX_SOURCE_LOCATION
    ) {
      return unmappedPointer('invalid-coordinate');
    }

    const sourceIndices = [];
    for (let index = 0; index < consumer.sources.length; index += 1) {
      if (consumer.sources[index] === original.source)
        sourceIndices.push(index);
    }
    if (sourceIndices.length !== 1) {
      return unmappedPointer('unsupported-source');
    }
    const rawSource = sourceMap.sources[sourceIndices[0]];
    const sourceRoot = sourceMap.sourceRoot ?? '';
    if (knownElementDependencySource(rawSource, sourceRoot)) {
      return unmappedPointer('dependency-source');
    }
    const sourcePath = canonicalElementSourcePath(
      original.source,
      rawSource,
      sourceRoot,
    );
    if (sourcePath === null) {
      return unmappedPointer('unsupported-source');
    }

    const sourceReference = `${ELEMENT_WEB_REPOSITORY}@${ELEMENT_WEB_COMMIT}:${sourcePath}`;
    const sourceRefSha256 = createHash('sha256')
      .update(sourceReference, 'utf8')
      .digest('hex');
    return {
      sourceMapStatus: 'mapped',
      sourceMapResolution: 'mapped',
      sourceRefSha256,
      sourceLine: original.line,
      sourceColumn: original.column,
    };
  } catch {
    return invalidPointer();
  } finally {
    if (consumer && typeof consumer.destroy === 'function') {
      consumer.destroy();
    }
  }
}
