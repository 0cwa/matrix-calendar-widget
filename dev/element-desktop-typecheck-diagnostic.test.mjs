import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import {
  runTypecheck,
  summarizeTypecheckOutput,
} from './element-desktop-typecheck-diagnostic.mjs';

function createFakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  return child;
}

test('typecheck summary keeps only allowlisted categories and numeric locations', () => {
  const output = summarizeTypecheckOutput({
    stdout:
      '/runner/repo/e2e/src/elementDesktopCalendarAcceptance.spec.ts(44,7): error TS18048: PRIVATE_MESSAGE_TOKEN\n',
    stderr:
      '/private/worktree/packages/widget/src/unrelated.ts(3,9): error TS2345: CALDAV_SECRET_TOKEN\nerror TS6053: PRIVATE_PATH_TOKEN',
    processState: 'completed-nonzero',
  });

  assert.deepEqual(output, {
    processState: 'completed-nonzero',
    diagnosticCount: 3,
    overflow: false,
    diagnostics: [
      {
        sourceCategory: 'desktop-e2e',
        code: 18048,
        line: 44,
        column: 7,
      },
      { sourceCategory: 'other', code: 2345, line: 3, column: 9 },
      { sourceCategory: 'unclassified', code: 6053, line: null, column: null },
    ],
  });

  const serialized = JSON.stringify(output);
  for (const privateValue of [
    '/runner/repo',
    'elementDesktopCalendarAcceptance.spec.ts',
    '/private/worktree',
    'PRIVATE_MESSAGE_TOKEN',
    'CALDAV_SECRET_TOKEN',
    'PRIVATE_PATH_TOKEN',
  ]) {
    assert.equal(serialized.includes(privateValue), false);
  }
});

test('reported diagnostics and their count are capped with overflow marked', () => {
  const stdout = Array.from(
    { length: 40 },
    (_, index) =>
      `e2e/src/elementDesktopCalendarAcceptance.spec.ts(${index + 1},2): error TS2322: PRIVATE_${index}`,
  ).join('\n');
  const output = summarizeTypecheckOutput({ stdout });

  assert.equal(output.diagnosticCount, 40);
  assert.equal(output.diagnostics.length, 25);
  assert.equal(output.overflow, true);
  assert.equal(JSON.stringify(output).includes('PRIVATE_'), false);
});

test('Desktop declarations, helpers, and runner map to fixed categories', () => {
  const output = summarizeTypecheckOutput({
    stdout: [
      '/runner/repo/dev/element-desktop-journey.d.mts(2,1): error TS1234: SECRET',
      '/runner/repo/dev/element-desktop-journey.mjs(3,1): error TS1234: SECRET',
      '/runner/repo/dev/element-desktop-journey-runner.mjs(4,1): error TS1234: SECRET',
    ].join('\n'),
  });

  assert.deepEqual(
    output.diagnostics.map((diagnostic) => diagnostic.sourceCategory),
    ['desktop-declarations', 'desktop-helper', 'desktop-runner'],
  );
});

test('typecheck runs yarn tsc once and preserves a compiler failure status', async () => {
  const child = createFakeChild();
  const calls = [];
  const pending = runTypecheck({
    repositoryRoot: '/private/repository/root',
    spawnImpl: (command, args, options) => {
      calls.push({ command, args, options });
      queueMicrotask(() => {
        child.stdout.emit(
          'data',
          Buffer.from('Yarn diagnostic PRIVATE_LOG_TOKEN\n'),
        );
        child.stderr.emit(
          'data',
          Buffer.from(
            'e2e/src/elementDesktopCalendarAcceptance.spec.ts(52,4): error TS1234: PRIVATE_COMPILER_MESSAGE\n',
          ),
        );
        child.emit('close', 23, null);
      });
      return child;
    },
  });
  const result = await pending;

  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'yarn');
  assert.deepEqual(calls[0].args, ['tsc']);
  assert.equal(calls[0].options.cwd, '/private/repository/root');
  assert.deepEqual(calls[0].options.stdio, ['ignore', 'pipe', 'pipe']);
  assert.equal(result.exitCode, 23);
  assert.equal(result.summary.processState, 'completed-nonzero');
  assert.equal(result.summary.diagnosticCount, 1);

  const serialized = JSON.stringify(result.summary);
  assert.equal(serialized.includes('PRIVATE_LOG_TOKEN'), false);
  assert.equal(serialized.includes('PRIVATE_COMPILER_MESSAGE'), false);
  assert.equal(serialized.includes('/private/repository/root'), false);
});

test('a missing yarn launcher remains a failed check with a closed state', async () => {
  const result = await runTypecheck({
    spawnImpl: () => {
      throw new Error('PRIVATE_LAUNCHER_ERROR');
    },
  });

  assert.equal(result.exitCode, 127);
  assert.deepEqual(result.summary, {
    processState: 'spawn-error',
    diagnosticCount: 0,
    overflow: false,
    diagnostics: [],
  });
  assert.equal(
    JSON.stringify(result.summary).includes('PRIVATE_LAUNCHER_ERROR'),
    false,
  );
});

test('output capture is bounded, marked, and does not change the compiler status', async () => {
  const child = createFakeChild();
  const pending = runTypecheck({
    spawnImpl: () => {
      queueMicrotask(() => {
        child.stdout.emit('data', Buffer.alloc(1024 * 1024 + 1, 120));
        child.emit('close', 19, null);
      });
      return child;
    },
  });
  const result = await pending;

  assert.equal(result.exitCode, 19);
  assert.equal(result.summary.processState, 'completed-nonzero');
  assert.equal(result.summary.diagnosticCount, 0);
  assert.equal(result.summary.overflow, true);
  assert.equal(result.summary.diagnostics.length, 0);
  assert.ok(Buffer.byteLength(JSON.stringify(result.summary)) < 512);
});
