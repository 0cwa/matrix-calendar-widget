import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import test from 'node:test';

import {
  createKeyringUnlockInput,
  createSafeStorageLogCollector,
  readKeyringControl,
  waitForDesktopChildSpawn,
} from './element-desktop-startup.mjs';

test('missing desktop executable is reported as a finite spawn outcome', async () => {
  const child = spawn('/usr/bin/element-desktop-startup-missing-test', [], {
    stdio: 'ignore',
  });
  const result = await waitForDesktopChildSpawn(child);

  assert.deepEqual(result, {
    outcome: 'spawn-error',
    errorClass: 'missing-executable',
  });
  assert.equal(child.pid, undefined);
});

test('keyring unlock entropy is encoded as an ASCII line without embedded NULs', () => {
  const entropy = Buffer.from([
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
    21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31,
  ]);
  const input = createKeyringUnlockInput(entropy);

  assert.equal(input.toString('ascii'), `${entropy.toString('hex')}\n`);
  assert.equal(input.at(-1), 0x0a);
  assert.match(input.subarray(0, -1).toString('ascii'), /^[0-9a-f]{64}$/u);
  assert.equal(input.includes(0), false);
});

test('keyring control accepts modern plain output and legacy export output without requiring a PID', () => {
  assert.equal(
    readKeyringControl('GNOME_KEYRING_CONTROL=/tmp/private-runtime/keyring\n'),
    '/tmp/private-runtime/keyring',
  );
  assert.equal(
    readKeyringControl(
      'GNOME_KEYRING_CONTROL=/tmp/private-runtime/keyring; export GNOME_KEYRING_CONTROL;\nGNOME_KEYRING_PID=42\n',
    ),
    '/tmp/private-runtime/keyring',
  );
  assert.equal(readKeyringControl('GNOME_KEYRING_PID=42\n'), undefined);
  assert.equal(readKeyringControl('ordinary output\n'), undefined);
});

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
