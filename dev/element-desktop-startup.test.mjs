import assert from 'node:assert/strict';
import test from 'node:test';

import { createSafeStorageLogCollector } from './element-desktop-startup.mjs';

test('safe-storage collector recognizes the exact vendor marker across chunks', () => {
  const collector = createSafeStorageLogCollector();
  collector.write('stdout', 'ordinary startup output\nUsing storage mode');
  collector.write(
    'stdout',
    " 'encrypted' with backend 'gnome_libsecret'\nmore ordinary output\n",
  );

  assert.deepEqual(collector.finish(true), {
    mode: 'encrypted',
    backend: 'gnome_libsecret',
    markerCount: 1,
    complete: true,
  });
});

test('safe-storage collector rejects duplicate and degraded markers without retaining log text', () => {
  const duplicate = createSafeStorageLogCollector();
  duplicate.write(
    'stdout',
    "Using storage mode 'encrypted' with backend 'gnome_libsecret'\n",
  );
  duplicate.write(
    'stderr',
    "Using storage mode 'encrypted' with backend 'kwallet'\n",
  );
  assert.deepEqual(duplicate.finish(true), {
    mode: 'ambiguous',
    backend: 'ambiguous',
    markerCount: 2,
    complete: true,
  });

  const degraded = createSafeStorageLogCollector();
  degraded.write(
    'stdout',
    "Using storage mode 'basic_text' with backend 'gnome_libsecret'\nprivate-canary\n",
  );
  const observed = degraded.finish(true);
  assert.deepEqual(observed, {
    mode: 'basic_text',
    backend: 'gnome_libsecret',
    markerCount: 1,
    complete: true,
  });
  assert.equal(JSON.stringify(observed).includes('private-canary'), false);
});

test('safe-storage collector fails closed on incomplete process output', () => {
  const missingClose = createSafeStorageLogCollector();
  missingClose.write(
    'stdout',
    "Using storage mode 'encrypted' with backend 'gnome_libsecret'\n",
  );
  assert.equal(missingClose.finish(false).complete, false);

  const oversized = createSafeStorageLogCollector();
  oversized.write('stdout', Buffer.alloc(1_048_577));
  assert.deepEqual(oversized.finish(true), {
    mode: 'not_observed',
    backend: 'not_observed',
    markerCount: 0,
    complete: false,
  });
});
