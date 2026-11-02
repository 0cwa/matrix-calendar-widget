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

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  classifyReadinessFailure,
  waitForEndpoint,
} from './element-acceptance-setup.mjs';
import { sanitizeElementAcceptance } from './sanitize-element-acceptance.mjs';

const SOURCE_SHA = 'a'.repeat(40);

test('readiness errors use fixed timeout and connection classes', () => {
  assert.equal(classifyReadinessFailure({ name: 'TimeoutError' }), 'timeout');
  assert.equal(classifyReadinessFailure({ name: 'AbortError' }), 'timeout');
  assert.equal(
    classifyReadinessFailure(new TypeError('private detail')),
    'connection-error',
  );
  assert.equal(
    classifyReadinessFailure(new Error('private detail')),
    'connection-error',
  );
});

test('readiness failure records the latest HTTP status without response details', async (t) => {
  const runnerTemp = mkdtempSync(join(tmpdir(), 'mcw-readiness-'));
  const stageFile = join(runnerTemp, 'stages.jsonl');
  const previousRunnerTemp = process.env.RUNNER_TEMP;
  const previousStageFile = process.env.ELEMENT_ACCEPTANCE_STAGE_FILE;
  process.env.RUNNER_TEMP = runnerTemp;
  process.env.ELEMENT_ACCEPTANCE_STAGE_FILE = stageFile;
  t.after(() => {
    if (previousRunnerTemp === undefined) delete process.env.RUNNER_TEMP;
    else process.env.RUNNER_TEMP = previousRunnerTemp;
    if (previousStageFile === undefined)
      delete process.env.ELEMENT_ACCEPTANCE_STAGE_FILE;
    else process.env.ELEMENT_ACCEPTANCE_STAGE_FILE = previousStageFile;
    rmSync(runnerTemp, { recursive: true, force: true });
  });

  let now = 0;
  await assert.rejects(
    waitForEndpoint(
      'widget-ready',
      'http://127.0.0.1:8080/',
      (status) => status === 200,
      {
        fetchImpl: async () => ({
          status: 503,
          body: { cancel: async () => undefined },
        }),
        now: () => now,
        delay: async (milliseconds) => {
          now += milliseconds;
        },
        timeoutMs: 1,
        pollIntervalMs: 1,
      },
    ),
    (error) => error.httpStatus === 503 && error.failureClass === 'http-status',
  );

  const records = readFileSync(stageFile, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.deepEqual(records, [{ phase: 'widget-ready', status: 'started' }]);

  const summary = sanitizeElementAcceptance(
    [
      { phase: 'widget-ready', status: 'started' },
      {
        phase: 'widget-ready',
        status: 'failed',
        httpStatus: 503,
        failureClass: 'http-status',
      },
    ]
      .map((record) => JSON.stringify(record))
      .join('\n'),
    SOURCE_SHA,
  );
  assert.match(
    summary,
    /phase=widget-ready status=failed http_status=503 failure_class=http-status/u,
  );
  assert.doesNotMatch(summary, /private detail|127\.0\.0\.1|response body/u);
});

test('readiness failure classifies a missing HTTP response without retaining the error', async (t) => {
  const runnerTemp = mkdtempSync(join(tmpdir(), 'mcw-readiness-'));
  const stageFile = join(runnerTemp, 'stages.jsonl');
  const previousRunnerTemp = process.env.RUNNER_TEMP;
  const previousStageFile = process.env.ELEMENT_ACCEPTANCE_STAGE_FILE;
  process.env.RUNNER_TEMP = runnerTemp;
  process.env.ELEMENT_ACCEPTANCE_STAGE_FILE = stageFile;
  t.after(() => {
    if (previousRunnerTemp === undefined) delete process.env.RUNNER_TEMP;
    else process.env.RUNNER_TEMP = previousRunnerTemp;
    if (previousStageFile === undefined)
      delete process.env.ELEMENT_ACCEPTANCE_STAGE_FILE;
    else process.env.ELEMENT_ACCEPTANCE_STAGE_FILE = previousStageFile;
    rmSync(runnerTemp, { recursive: true, force: true });
  });

  let now = 0;
  await assert.rejects(
    waitForEndpoint(
      'element-ready',
      'http://127.0.0.1:8090/',
      (status) => status === 200,
      {
        fetchImpl: async () => {
          throw new TypeError('synthetic private connection detail');
        },
        now: () => now,
        delay: async (milliseconds) => {
          now += milliseconds;
        },
        timeoutMs: 1,
        pollIntervalMs: 1,
      },
    ),
    (error) =>
      error.httpStatus === undefined &&
      error.failureClass === 'connection-error',
  );

  const sanitized = sanitizeElementAcceptance(
    [
      { phase: 'element-ready', status: 'started' },
      {
        phase: 'element-ready',
        status: 'failed',
        failureClass: 'connection-error',
      },
    ]
      .map((record) => JSON.stringify(record))
      .join('\n'),
    SOURCE_SHA,
  );
  assert.match(
    sanitized,
    /phase=element-ready status=failed failure_class=connection-error/u,
  );
  assert.doesNotMatch(sanitized, /synthetic private connection detail/u);
});
