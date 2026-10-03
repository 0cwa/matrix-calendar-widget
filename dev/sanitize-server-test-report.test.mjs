// Copyright 2026 Matrix Calendar Widget contributors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { formatServerTestFailureSummary } from './sanitize-server-test-report.mjs';

const suitePath = fileURLToPath(
  new URL(
    '../matrix-calendar-server/test/integration/CalDavEventRoundTripContract.test.ts',
    import.meta.url,
  ),
);

test('emits only allowlisted static suite and case IDs with failed status', () => {
  const report = {
    testResults: [
      {
        name: suitePath,
        status: 'failed',
        assertionResults: [
          {
            title:
              'removes one PERIOD RDATE from a serialized CalDAV resource with its current ETag',
            fullName: 'private full title',
            status: 'failed',
            failureMessages: ['private event data and credential material'],
          },
        ],
        testExecError: {
          message: 'private execution error',
          stack: 'private stack',
        },
        failureMessage: 'private suite failure',
      },
    ],
  };

  const output = formatServerTestFailureSummary(report).join('\n');
  assert.equal(
    output,
    [
      'contract-case event-period-rdate-removal failed',
      'contract-suite caldav-event-round-trip-contract failed',
    ].join('\n'),
  );
  assert.doesNotMatch(
    output,
    /private|event data|credential|stack|failureMessage|serialized CalDAV/,
  );
});

test('emits a bounded count for unknown failing suites without their data', () => {
  const report = {
    testResults: [
      {
        name: '/private/worktree/private-suite.test.ts',
        status: 'failed',
        assertionResults: [
          {
            title: 'private test title',
            status: 'failed',
            failureMessages: ['private assertion text'],
          },
        ],
      },
    ],
  };

  const output = formatServerTestFailureSummary(report).join('\n');
  assert.equal(output, 'unmapped-failure count=1');
  assert.doesNotMatch(output, /private|worktree|suite\.test|assertion/);
});

test('fails closed for malformed report structure', () => {
  assert.deepEqual(formatServerTestFailureSummary({}), [
    'unmapped-failure count=1',
  ]);
});

test('emits only a fixed no-failures marker for passing mapped cases', () => {
  const report = {
    testResults: [
      {
        name: suitePath,
        status: 'passed',
        assertionResults: [
          {
            title:
              'removes one PERIOD RDATE from a serialized CalDAV resource with its current ETag',
            status: 'passed',
            failureMessages: [],
          },
        ],
      },
    ],
  };

  assert.deepEqual(formatServerTestFailureSummary(report), [
    'server-test-report no-failures',
  ]);
});
