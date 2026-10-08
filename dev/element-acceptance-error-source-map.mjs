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
const ELEMENT_BUNDLE_PATH =
  /^\/bundles\/[a-f0-9]{8,64}\/[A-Za-z0-9._~-]+\.js$/u;

/**
 * @typedef {{bundleUrl: string, generatedLine: number, generatedColumn: number}} ElementBundleFrame
 * @typedef {{bundleUrl: string, sourceMapText: string | null}} ElementSourceMapResult
 * @typedef {{sourceMapStatus: 'not-eligible' | 'not-attempted' | 'unavailable' | 'invalid' | 'unmapped' | 'mapped', sourceRefSha256: string | null, sourceLine: number | null, sourceColumn: number | null}} ElementErrorSourcePointer
 */

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

function canonicalElementSourcePath(source) {
  if (
    typeof source !== 'string' ||
    source.length > MAX_SOURCE_MAP_SOURCE_LENGTH
  ) {
    return null;
  }

  const prefixes = [
    'webpack://element-web/./',
    'webpack://element-web/',
    'webpack:///./',
    'webpack:///',
  ];
  const prefix = prefixes.find((candidate) => source.startsWith(candidate));
  if (!prefix) return null;

  const relative = source.slice(prefix.length);
  if (
    relative.length === 0 ||
    relative.startsWith('/') ||
    relative.includes('\\') ||
    relative.includes('\0')
  ) {
    return null;
  }

  const normalized = path.normalize(relative);
  if (
    normalized !== relative ||
    !/^(?:apps\/web|packages)\/[A-Za-z0-9._/-]+$/u.test(normalized) ||
    normalized.split('/').some((segment) => segment === '.' || segment === '..')
  ) {
    return null;
  }
  return normalized;
}

function invalidPointer() {
  return {
    sourceMapStatus: 'invalid',
    sourceRefSha256: null,
    sourceLine: null,
    sourceColumn: null,
  };
}

function unmappedPointer() {
  return {
    sourceMapStatus: 'unmapped',
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
    else hadValidUnmappedFrame = true;
  }

  if (hadUnavailableMap) {
    return {
      sourceMapStatus: 'unavailable',
      sourceRefSha256: null,
      sourceLine: null,
      sourceColumn: null,
    };
  }
  if (hadValidUnmappedFrame) return unmappedPointer();
  if (hadInvalidMap) return invalidPointer();
  return {
    sourceMapStatus: 'unavailable',
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
      return unmappedPointer();
    }
    bundleName = path.basename(bundleUrl.pathname);
  } catch {
    return unmappedPointer();
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
    const sourcePath = canonicalElementSourcePath(original.source);
    if (
      sourcePath === null ||
      !Number.isSafeInteger(original.line) ||
      original.line < 1 ||
      original.line > MAX_SOURCE_LOCATION ||
      !Number.isSafeInteger(original.column) ||
      original.column < 0 ||
      original.column > MAX_SOURCE_LOCATION
    ) {
      return unmappedPointer();
    }

    const sourceReference = `${ELEMENT_WEB_REPOSITORY}@${ELEMENT_WEB_COMMIT}:${sourcePath}`;
    const sourceRefSha256 = createHash('sha256')
      .update(sourceReference, 'utf8')
      .digest('hex');
    return {
      sourceMapStatus: 'mapped',
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
