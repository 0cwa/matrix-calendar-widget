import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { SourceMapGenerator } from 'source-map-js';
import {
  classifyElementHostStack,
  extractElementBundleFrames,
  readElementErrorSourceMapInPage,
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
  source = 'src/components/Widget.tsx',
  file = 'app.js',
  sourceRoot = 'webpack://element-web/./',
) {
  const generator = new SourceMapGenerator({
    file,
    sourceRoot,
  });
  generator.addMapping({
    generated: { line: 13, column: 7 },
    source,
    original: { line: 42, column: 5 },
  });
  return generator.toString();
}

function expectedPointer(sourcePath, sourceLine = 42, sourceColumn = 5) {
  return {
    sourceMapStatus: 'mapped',
    sourceMapResolution: 'mapped',
    sourceMapUnsupportedReason: 'not-applicable',
    sourceMapNamespaceClass: 'not-applicable',
    sourceRefSha256: createHash('sha256')
      .update(
        `element-hq/element-web@f19cfd9030429240a4209bf5175b372175cf0464:${sourcePath}`,
      )
      .digest('hex'),
    sourceLine,
    sourceColumn,
  };
}

function expectedPointerState(
  sourceMapStatus,
  sourceMapResolution = 'not-applicable',
  sourceMapUnsupportedReason = 'not-applicable',
  sourceMapNamespaceClass = 'not-applicable',
) {
  return {
    sourceMapStatus,
    sourceMapResolution,
    sourceMapUnsupportedReason,
    sourceMapNamespaceClass,
    sourceRefSha256: null,
    sourceLine: null,
    sourceColumn: null,
  };
}

function pointerForMap(sourceMapText) {
  return resolveElementErrorSourcePointer(
    [{ bundleUrl, generatedLine: 13, generatedColumn: 7 }],
    [{ bundleUrl, sourceMapText }],
  );
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

test('proves only complete stacks led by Element bundles on the fixture origin', () => {
  const widgetUrl = 'http://widget.invalid:3000/';
  const elementBundle =
    'https://element.invalid/bundles/0123456789abcdef/app.js';
  const vendorBundle =
    'https://element.invalid/bundles/0123456789abcdef/vendor.js';
  const fixtureUrls = { elementUrl, widgetUrl };
  const valid = errorWithFrames([
    `    at render (${elementBundle}:13:8)`,
    `    at dispatch (${vendorBundle}:27:2)`,
  ]);
  assert.deepEqual(classifyElementHostStack(valid, fixtureUrls), {
    hostStackStatus: 'complete',
    hostStackFrameCount: 2,
    hostStackOrigin: 'element',
    hostStackFirstFrame: 'element-bundle',
    hostStackTrustedBundleFrameCount: 2,
  });

  const firefox = errorWithFrames([
    `render@${elementBundle}:13:8`,
    `dispatch@${vendorBundle}:27:2`,
  ]);
  assert.deepEqual(classifyElementHostStack(firefox, fixtureUrls), {
    hostStackStatus: 'complete',
    hostStackFrameCount: 2,
    hostStackOrigin: 'element',
    hostStackFirstFrame: 'element-bundle',
    hostStackTrustedBundleFrameCount: 2,
  });

  for (const [stack, expected] of [
    [
      'Error: private error text\n    at anonymous (<anonymous>)\n' +
        `    at render (${elementBundle}:13:8)`,
      'malformed',
    ],
    [
      'Error: private error text\n' +
        `    at initialize (http://widget.invalid:3000/bundles/0123456789abcdef/app.js:1:1)\n` +
        `    at render (${elementBundle}:13:8)`,
      'mixed',
    ],
    [
      'Error: private error text\n' +
        '    at private (https://third-party.invalid/app.js:1:1)',
      'other',
    ],
    [
      'Error: private error text\n' +
        '    at render (https://element.invalid/assets/app.js:13:8)',
      'element',
    ],
    [
      'Error: private error text\n' +
        `    at render (${elementBundle}:13:8)\n    not-a-frame`,
      'malformed',
    ],
  ]) {
    const error = new Error('private error text');
    error.stack = stack;
    const result = classifyElementHostStack(error, fixtureUrls);
    assert.equal(
      result.hostStackStatus,
      expected === 'malformed' ? 'malformed' : 'complete',
    );
    if (expected !== 'malformed') {
      assert.equal(result.hostStackOrigin, expected);
      assert.notEqual(result.hostStackFirstFrame, 'element-bundle');
    }
  }

  const widgetFirst = errorWithFrames([
    '    at initialize (http://widget.invalid:3000/assets/widget.js:1:1)',
    `    at render (${elementBundle}:13:8)`,
  ]);
  assert.deepEqual(classifyElementHostStack(widgetFirst, fixtureUrls), {
    hostStackStatus: 'complete',
    hostStackFrameCount: 2,
    hostStackOrigin: 'mixed',
    hostStackFirstFrame: 'widget',
    hostStackTrustedBundleFrameCount: 1,
  });

  const oversized = errorWithFrames([`    at render (${elementBundle}:13:8)`]);
  oversized.stack = `Error: private error text\n${'x'.repeat(16_385)}`;
  assert.equal(
    classifyElementHostStack(oversized, fixtureUrls).hostStackStatus,
    'truncated',
  );
  const tooMany = errorWithFrames(
    Array.from(
      { length: 25 },
      (_, index) => `    at render (${elementBundle}:${index + 1}:8)`,
    ),
  );
  assert.equal(
    classifyElementHostStack(tooMany, fixtureUrls).hostStackStatus,
    'truncated',
  );
  const noStack = Object.defineProperty({}, 'stack', {
    get() {
      throw new Error('private getter failure');
    },
  });
  assert.equal(
    classifyElementHostStack(noStack, fixtureUrls).hostStackStatus,
    'unavailable',
  );
  assert.doesNotMatch(
    JSON.stringify(classifyElementHostStack(valid, fixtureUrls)),
    /private|https?:\/\/|element\.invalid|widget\.invalid|app\.js/u,
  );
});

test('resolves an eligible map to an opaque pinned source reference', () => {
  const frames = extractElementBundleFrames(errorAt(bundleUrl), elementUrl);
  const pointer = resolveElementErrorSourcePointer(frames, [
    { bundleUrl, sourceMapText: validMap() },
  ]);
  assert.deepEqual(
    pointer,
    expectedPointer('apps/web/src/components/Widget.tsx'),
  );
  assert.doesNotMatch(
    JSON.stringify(pointer),
    /Widget\.tsx|https?:\/\/|0123456789abcdef|private error/u,
  );
});

test('classifies valid unmapped positions without returning source text', () => {
  const frames = extractElementBundleFrames(errorAt(bundleUrl), elementUrl);

  for (const [source, sourceRoot] of [
    ['../../node_modules/some-package/index.js', 'webpack://element-web/./'],
    ['./node_modules/some-package/index.js', 'webpack://element-web/'],
    ['webpack://element-web/../../node_modules/some-package/index.js', ''],
  ]) {
    assert.deepEqual(
      resolveElementErrorSourcePointer(frames, [
        { bundleUrl, sourceMapText: validMap(source, 'app.js', sourceRoot) },
      ]),
      expectedPointerState('unmapped', 'dependency-source'),
    );
  }

  const noPosition = JSON.stringify({
    version: 3,
    file: 'app.js',
    sourceRoot: 'webpack://element-web/',
    sources: ['src/components/Widget.tsx'],
    names: [],
    mappings: '',
  });
  assert.deepEqual(
    pointerForMap(noPosition),
    expectedPointerState('unmapped', 'no-original-position'),
  );

  const invalidCoordinate = JSON.stringify({
    version: 3,
    file: 'app.js',
    sourceRoot: 'webpack://element-web/',
    sources: ['src/components/Widget.tsx'],
    names: [],
    mappings: `${';'.repeat(12)}AADA`,
  });
  assert.deepEqual(
    pointerForMap(invalidCoordinate),
    expectedPointerState('unmapped', 'invalid-coordinate'),
  );

  assert.deepEqual(
    pointerForMap(validMap('./external/source.ts')),
    expectedPointerState(
      'unmapped',
      'unsupported-source',
      'relative-path-prefix',
    ),
  );

  assert.deepEqual(
    resolveElementErrorSourcePointer([], []),
    expectedPointerState('not-eligible'),
  );
  assert.deepEqual(
    resolveElementErrorSourcePointer(frames, [
      {
        bundleUrl,
        sourceMapText: null,
      },
    ]),
    expectedPointerState('unavailable'),
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
    assert.deepEqual(pointer, expectedPointerState('invalid'));
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
    source: '../../node_modules/some-package/index.js',
    original: { line: 4, column: 2 },
  });
  const appUrl = 'https://element.invalid/bundles/0123456789abcdef/app.js';
  const appGenerator = new SourceMapGenerator({
    file: 'app.js',
    sourceRoot: 'webpack://element-web/./',
  });
  appGenerator.addMapping({
    generated: { line: 14, column: 7 },
    source: 'src/components/Widget.tsx',
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
    expectedPointer('apps/web/src/components/Widget.tsx'),
  );
});

test('continues through later positions in the same bundle map', () => {
  const generator = new SourceMapGenerator({
    file: 'app.js',
    sourceRoot: 'webpack://element-web/./',
  });
  generator.addMapping({
    generated: { line: 13, column: 7 },
    source: '../../node_modules/some-package/index.js',
    original: { line: 4, column: 2 },
  });
  generator.addMapping({
    generated: { line: 14, column: 7 },
    source: 'src/components/Widget.tsx',
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
    expectedPointer('apps/web/src/components/Widget.tsx'),
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
    source: '../../node_modules/some-package/index.js',
    original: { line: 4, column: 2 },
  });

  assert.deepEqual(
    resolveElementErrorSourcePointer(frames, [
      { bundleUrl: dependencyUrl, sourceMapText: dependencyMap.toString() },
      { bundleUrl: bundleUrl, sourceMapText: null },
    ]),
    expectedPointerState('unavailable'),
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
    expectedPointerState('invalid'),
  );
});

test('maps only the pinned Webpack app and exact workspace-relative sources', () => {
  const appPath = 'apps/web/src/components/structures/MatrixChat.tsx';
  const workspacePath = 'packages/shared-components/src/RoomListView.tsx';

  for (const [source, sourceRoot] of [
    ['src/components/structures/MatrixChat.tsx', 'webpack://element-web/'],
    ['./src/components/structures/MatrixChat.tsx', 'webpack://element-web/./'],
    ['webpack://element-web/src/components/structures/MatrixChat.tsx', ''],
  ]) {
    assert.deepEqual(
      pointerForMap(validMap(source, 'app.js', sourceRoot)),
      expectedPointer(appPath),
    );
  }

  for (const [source, sourceRoot] of [
    ['../../packages/shared-components/src/RoomListView.tsx', ''],
    [
      '../../packages/shared-components/src/RoomListView.tsx',
      'webpack://element-web/',
    ],
    [
      'webpack://element-web/../../packages/shared-components/src/RoomListView.tsx',
      '',
    ],
  ]) {
    assert.deepEqual(
      pointerForMap(validMap(source, 'app.js', sourceRoot)),
      expectedPointer(workspacePath),
    );
  }

  for (const [source, sourceRoot, reason, namespaceClass] of [
    [
      'packages/shared-components/src/RoomListView.tsx',
      'webpack://element-web/',
      'repository-root-prefix',
      'not-applicable',
    ],
    [
      '../../../packages/shared-components/src/RoomListView.tsx',
      'webpack://element-web/',
      'relative-path-prefix',
      'not-applicable',
    ],
    [
      '../../packages/shared-components/../private.tsx',
      'webpack://element-web/',
      'unsafe-path-segment',
      'not-applicable',
    ],
    [
      'apps/web/src/components/Widget.tsx',
      '',
      'repository-root-prefix',
      'not-applicable',
    ],
    [
      'apps/web/src/components/Widget.tsx',
      'webpack://element-web/',
      'repository-root-prefix',
      'not-applicable',
    ],
    [
      'webpack://element-web/apps/web/src/components/Widget.tsx',
      '',
      'repository-root-prefix',
      'element-web',
    ],
    [
      'webpack://other.example/src/private.tsx',
      '',
      'unsupported-namespace',
      'other',
    ],
    [
      'webpack://element-web/../src/private.tsx',
      '',
      'relative-path-prefix',
      'element-web',
    ],
    [
      'webpack://matrix-react-sdk/src/index.ts',
      '',
      'unsupported-namespace',
      'matrix-react-sdk',
    ],
    [
      'webpack://matrix-widget-api/src/index.ts',
      '',
      'unsupported-namespace',
      'matrix-widget-api',
    ],
    ['webpack:///src/index.ts', '', 'unsupported-namespace', 'empty'],
    [
      'https://vendor.invalid/src/index.ts',
      '',
      'unsupported-scheme',
      'not-applicable',
    ],
    ['/srv/private/index.ts', '', 'absolute-path', 'not-applicable'],
    ['src/index.ts?token=private', '', 'query-or-fragment', 'not-applicable'],
    [
      'src/private/../index.ts',
      '',
      'source-resolution-mismatch',
      'not-applicable',
    ],
    ['src/private name.ts', '', 'invalid-path-character', 'not-applicable'],
    ['vendor/index.ts', '', 'unsupported-path-prefix', 'not-applicable'],
  ]) {
    const pointer = pointerForMap(validMap(source, 'app.js', sourceRoot));
    assert.deepEqual(
      pointer,
      expectedPointerState(
        'unmapped',
        'unsupported-source',
        reason,
        namespaceClass,
      ),
    );
    assert.doesNotMatch(
      JSON.stringify(pointer),
      /RoomListView|Widget\.tsx|private\.tsx|other\.example|apps\/web/u,
    );
  }
});

test('rejects duplicate source identities instead of choosing an ambiguous entry', () => {
  const map = JSON.stringify({
    version: 3,
    file: 'app.js',
    sourceRoot: 'webpack://element-web/',
    sources: ['src/components/Widget.tsx', 'src/components/Widget.tsx'],
    names: [],
    mappings: `${';'.repeat(12)}AAAA`,
  });

  assert.deepEqual(
    pointerForMap(map),
    expectedPointerState('unmapped', 'unsupported-source', 'duplicate-source'),
  );
});

test('keeps the unsupported shape attached to the frame that produced it', () => {
  const otherBundleUrl =
    'https://element.invalid/bundles/abcdef0123456789/chunk.js';
  const pointer = resolveElementErrorSourcePointer(
    [
      { bundleUrl, generatedLine: 13, generatedColumn: 7 },
      { bundleUrl: otherBundleUrl, generatedLine: 13, generatedColumn: 7 },
    ],
    [
      {
        bundleUrl,
        sourceMapText: validMap(
          'webpack://matrix-widget-api/src/index.ts',
          'app.js',
          '',
        ),
      },
      {
        bundleUrl: otherBundleUrl,
        sourceMapText: validMap(
          'apps/web/src/components/Widget.tsx',
          'chunk.js',
          '',
        ),
      },
    ],
  );

  assert.deepEqual(
    pointer,
    expectedPointerState(
      'unmapped',
      'unsupported-source',
      'unsupported-namespace',
      'matrix-widget-api',
    ),
  );
  assert.doesNotMatch(
    JSON.stringify(pointer),
    /webpack:\/\/|apps\/web|src\/index/u,
  );
});

test('cancels response bodies rejected before source-map streaming', async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const sourceMapUrl = `${bundleUrl}.map`;

  try {
    globalThis.window = {
      location: { origin: new URL(elementUrl).origin },
      setTimeout,
      clearTimeout,
    };

    for (const rejection of [
      { ok: false, contentType: 'application/json', contentLength: null },
      { ok: true, contentType: 'text/plain', contentLength: null },
      { ok: true, contentType: 'application/json', contentLength: '65' },
    ]) {
      let canceled = false;
      const body = new ReadableStream({
        cancel() {
          canceled = true;
        },
      });
      globalThis.fetch = async () => ({
        ok: rejection.ok,
        redirected: false,
        url: sourceMapUrl,
        headers: {
          get(name) {
            if (name === 'content-type') return rejection.contentType;
            if (name === 'content-length') return rejection.contentLength;
            return null;
          },
        },
        body,
      });

      const result = await readElementErrorSourceMapInPage({
        bundleUrl,
        expectedOrigin: new URL(elementUrl).origin,
        maxBytes: 64,
        timeoutMs: 100,
      });

      assert.deepEqual(result, {
        text: null,
        bytesRead: 0,
        limitReached: false,
      });
      assert.equal(canceled, true);
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});
