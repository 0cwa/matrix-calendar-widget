import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { SourceMapGenerator } from 'source-map-js';
import {
  extractElementBundleFrames,
  resolveElementErrorSourcePointer,
} from './element-acceptance-error-source-map.mjs';

const elementUrl = 'https://element.invalid/';
const bundleUrl = 'https://element.invalid/bundles/0123456789abcdef/app.js';

function errorAt(url, line = 13, column = 8) {
  const error = new Error('private error text');
  error.stack = `Error: private error text\n    at render (${url}:${line}:${column})`;
  return error;
}

function errorWithFrames(frames) {
  const error = new Error('private error text');
  error.stack = ['Error: private error text', ...frames].join('\n');
  return error;
}

function validMap(
  source = 'apps/web/src/components/Widget.tsx',
  file = 'app.js',
) {
  const generator = new SourceMapGenerator({
    file,
    sourceRoot: 'webpack://element-web/./',
  });
  generator.addMapping({
    generated: { line: 13, column: 7 },
    source,
    original: { line: 42, column: 5 },
  });
  return generator.toString();
}

test('extracts only a bounded first-party production-bundle frame', () => {
  const frames = extractElementBundleFrames(errorAt(bundleUrl), elementUrl);
  assert.deepEqual(frames, [
    {
      bundleUrl,
      generatedLine: 13,
      generatedColumn: 7,
    },
  ]);

  for (const rejectedUrl of [
    'https://other.invalid/bundles/0123456789abcdef/app.js',
    'https://element.invalid/assets/app.js',
    'https://element.invalid/bundles/short/app.js',
    'https://element.invalid/bundles/0123456789abcdef/app.js?token=private',
    'https://user:secret@element.invalid/bundles/0123456789abcdef/app.js',
  ]) {
    assert.deepEqual(
      extractElementBundleFrames(errorAt(rejectedUrl), elementUrl),
      [],
    );
  }

  const oversizedStack = new Error('private');
  oversizedStack.stack = `Error: private\n${'x'.repeat(16_385)}`;
  assert.deepEqual(extractElementBundleFrames(oversizedStack, elementUrl), []);

  const manyFrames = errorWithFrames(
    Array.from(
      { length: 12 },
      (_, index) =>
        `    at frame${index} (https://element.invalid/bundles/0123456789abcdef/app.js:${13 + index}:8)`,
    ),
  );
  assert.equal(extractElementBundleFrames(manyFrames, elementUrl).length, 8);
});

test('resolves an eligible map to an opaque pinned source reference', () => {
  const frames = extractElementBundleFrames(errorAt(bundleUrl), elementUrl);
  const pointer = resolveElementErrorSourcePointer(frames, [
    { bundleUrl, sourceMapText: validMap() },
  ]);
  const expectedRef = createHash('sha256')
    .update(
      'element-hq/element-web@f19cfd9030429240a4209bf5175b372175cf0464:apps/web/src/components/Widget.tsx',
    )
    .digest('hex');

  assert.deepEqual(pointer, {
    sourceMapStatus: 'mapped',
    sourceRefSha256: expectedRef,
    sourceLine: 42,
    sourceColumn: 5,
  });
  assert.doesNotMatch(
    JSON.stringify(pointer),
    /Widget\.tsx|https?:\/\/|0123456789abcdef|private error/u,
  );
});

test('keeps unknown repositories and unmapped positions opaque', () => {
  const frames = extractElementBundleFrames(errorAt(bundleUrl), elementUrl);

  assert.deepEqual(
    resolveElementErrorSourcePointer(frames, [
      {
        bundleUrl,
        sourceMapText: validMap('../node_modules/some-package/index.js'),
      },
    ]),
    {
      sourceMapStatus: 'unmapped',
      sourceRefSha256: null,
      sourceLine: null,
      sourceColumn: null,
    },
  );
  assert.deepEqual(resolveElementErrorSourcePointer([], []), {
    sourceMapStatus: 'not-eligible',
    sourceRefSha256: null,
    sourceLine: null,
    sourceColumn: null,
  });
  assert.deepEqual(
    resolveElementErrorSourcePointer(frames, [
      {
        bundleUrl,
        sourceMapText: null,
      },
    ]),
    {
      sourceMapStatus: 'unavailable',
      sourceRefSha256: null,
      sourceLine: null,
      sourceColumn: null,
    },
  );
});

test('rejects malformed, mismatched, and oversized maps without leaking data', () => {
  const frames = extractElementBundleFrames(errorAt(bundleUrl), elementUrl);
  const malformed = resolveElementErrorSourcePointer(frames, [
    {
      bundleUrl,
      sourceMapText: '{private',
    },
  ]);
  const wrongFile = JSON.parse(validMap());
  wrongFile.file = 'other.js';
  const mismatched = resolveElementErrorSourcePointer(frames, [
    { bundleUrl, sourceMapText: JSON.stringify(wrongFile) },
  ]);
  const oversized = resolveElementErrorSourcePointer(frames, [
    { bundleUrl, sourceMapText: ' '.repeat(64 * 1024 * 1024 + 1) },
  ]);

  for (const pointer of [malformed, mismatched, oversized]) {
    assert.deepEqual(pointer, {
      sourceMapStatus: 'invalid',
      sourceRefSha256: null,
      sourceLine: null,
      sourceColumn: null,
    });
    assert.doesNotMatch(
      JSON.stringify(pointer),
      /private|https?:\/\/|other\.js|0123456789abcdef/u,
    );
  }
});

test('skips dependency frames and continues to the first repository-owned source', () => {
  const vendorUrl =
    'https://element.invalid/bundles/0123456789abcdef/vendor.js';
  const vendorGenerator = new SourceMapGenerator({
    file: 'vendor.js',
    sourceRoot: 'webpack://element-web/./',
  });
  vendorGenerator.addMapping({
    generated: { line: 13, column: 7 },
    source: '../node_modules/some-package/index.js',
    original: { line: 4, column: 2 },
  });
  const appUrl = 'https://element.invalid/bundles/0123456789abcdef/app.js';
  const appGenerator = new SourceMapGenerator({
    file: 'app.js',
    sourceRoot: 'webpack://element-web/./',
  });
  appGenerator.addMapping({
    generated: { line: 14, column: 7 },
    source: 'apps/web/src/components/Widget.tsx',
    original: { line: 42, column: 5 },
  });
  const frames = extractElementBundleFrames(
    errorWithFrames([
      `    at dependency (${vendorUrl}:13:8)`,
      `    at render (${appUrl}:14:8)`,
    ]),
    elementUrl,
  );

  assert.deepEqual(
    resolveElementErrorSourcePointer(frames, [
      { bundleUrl: vendorUrl, sourceMapText: vendorGenerator.toString() },
      { bundleUrl: appUrl, sourceMapText: appGenerator.toString() },
    ]),
    {
      sourceMapStatus: 'mapped',
      sourceRefSha256: createHash('sha256')
        .update(
          'element-hq/element-web@f19cfd9030429240a4209bf5175b372175cf0464:apps/web/src/components/Widget.tsx',
        )
        .digest('hex'),
      sourceLine: 42,
      sourceColumn: 5,
    },
  );
});

test('continues through later positions in the same bundle map', () => {
  const generator = new SourceMapGenerator({
    file: 'app.js',
    sourceRoot: 'webpack://element-web/./',
  });
  generator.addMapping({
    generated: { line: 13, column: 7 },
    source: '../node_modules/some-package/index.js',
    original: { line: 4, column: 2 },
  });
  generator.addMapping({
    generated: { line: 14, column: 7 },
    source: 'apps/web/src/components/Widget.tsx',
    original: { line: 42, column: 5 },
  });
  const frames = extractElementBundleFrames(
    errorWithFrames([
      `    at dependency (${bundleUrl}:13:8)`,
      `    at render (${bundleUrl}:14:8)`,
    ]),
    elementUrl,
  );

  assert.deepEqual(
    resolveElementErrorSourcePointer(frames, [
      { bundleUrl, sourceMapText: generator.toString() },
    ]),
    {
      sourceMapStatus: 'mapped',
      sourceRefSha256: createHash('sha256')
        .update(
          'element-hq/element-web@f19cfd9030429240a4209bf5175b372175cf0464:apps/web/src/components/Widget.tsx',
        )
        .digest('hex'),
      sourceLine: 42,
      sourceColumn: 5,
    },
  );
});

test('enforces the bounded map lookup list and keeps unavailable ahead of partial unmapped data', () => {
  const dependencyUrl =
    'https://element.invalid/bundles/0123456789abcdef/vendor.js';
  const frames = extractElementBundleFrames(
    errorWithFrames([
      `    at dependency (${dependencyUrl}:13:8)`,
      `    at app (${bundleUrl}:14:8)`,
    ]),
    elementUrl,
  );
  const dependencyMap = new SourceMapGenerator({
    file: 'vendor.js',
    sourceRoot: 'webpack://element-web/./',
  });
  dependencyMap.addMapping({
    generated: { line: 13, column: 7 },
    source: '../node_modules/some-package/index.js',
    original: { line: 4, column: 2 },
  });

  assert.deepEqual(
    resolveElementErrorSourcePointer(frames, [
      { bundleUrl: dependencyUrl, sourceMapText: dependencyMap.toString() },
      { bundleUrl: bundleUrl, sourceMapText: null },
    ]),
    {
      sourceMapStatus: 'unavailable',
      sourceRefSha256: null,
      sourceLine: null,
      sourceColumn: null,
    },
  );
  assert.equal(
    resolveElementErrorSourcePointer(
      frames,
      Array.from({ length: 5 }, () => ({
        bundleUrl,
        sourceMapText: null,
      })).map((map, index) => ({ ...map, bundleUrl: `${bundleUrl}?${index}` })),
    ).sourceMapStatus,
    'invalid',
  );
});

test('rejects a source map associated with a different captured bundle', () => {
  const frames = extractElementBundleFrames(errorAt(bundleUrl), elementUrl);
  const wrongBundleUrl =
    'https://element.invalid/bundles/0123456789abcdef/vendor.js';

  assert.deepEqual(
    resolveElementErrorSourcePointer(frames, [
      { bundleUrl: wrongBundleUrl, sourceMapText: validMap() },
    ]),
    {
      sourceMapStatus: 'invalid',
      sourceRefSha256: null,
      sourceLine: null,
      sourceColumn: null,
    },
  );
});
