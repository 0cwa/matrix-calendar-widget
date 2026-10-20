import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveDesktopViewportSize } from './element-desktop-viewport.mjs';

test('uses measured browser dimensions when the configured viewport is absent', () => {
  assert.deepEqual(
    resolveDesktopViewportSize(null, { width: 1280, height: 720 }),
    { width: 1280, height: 720 },
  );
});

test('prefers configured viewport dimensions when available', () => {
  assert.deepEqual(
    resolveDesktopViewportSize(
      { width: 1024, height: 768 },
      { width: 1280, height: 720 },
    ),
    { width: 1024, height: 768 },
  );
});

test('keeps unavailable or invalid viewport measurements unavailable', () => {
  assert.equal(resolveDesktopViewportSize(null, null), null);
  assert.equal(
    resolveDesktopViewportSize(null, { width: 0, height: 720 }),
    null,
  );
  assert.equal(
    resolveDesktopViewportSize(null, { width: 1280, height: 720.5 }),
    null,
  );
});
