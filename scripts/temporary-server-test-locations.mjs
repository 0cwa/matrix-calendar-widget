#!/usr/bin/env node

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
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TARGETS = Object.freeze({
  'absolute-alarm': Object.freeze([
    {
      jestPath: 'src/caldav/ICalendarEventCodec.test.ts',
      reportPath:
        'matrix-calendar-server/src/caldav/ICalendarEventCodec.test.ts',
    },
    {
      jestPath: 'src/controller/CalendarGatewayController.test.ts',
      reportPath:
        'matrix-calendar-server/src/controller/CalendarGatewayController.test.ts',
    },
    {
      jestPath: 'src/service/RoomCalendarEventOperations.test.ts',
      reportPath:
        'matrix-calendar-server/src/service/RoomCalendarEventOperations.test.ts',
    },
  ]),
  'uri-attachments': Object.freeze([
    {
      jestPath: 'src/caldav/ICalendarEventCodecAttachment.test.ts',
      reportPath:
        'matrix-calendar-server/src/caldav/ICalendarEventCodecAttachment.test.ts',
    },
    {
      jestPath: 'src/controller/CalendarGatewayController.test.ts',
      reportPath:
        'matrix-calendar-server/src/controller/CalendarGatewayController.test.ts',
    },
    {
      jestPath: 'src/service/RoomCalendarEventOperations.test.ts',
      reportPath:
        'matrix-calendar-server/src/service/RoomCalendarEventOperations.test.ts',
    },
  ]),
});

const APPROVED_SOURCE_PATHS = Object.freeze([
  'matrix-calendar-server/src/caldav/ICalendarEventCodec.ts',
  'matrix-calendar-server/src/caldav/ICalendarEventCodec.test.ts',
  'matrix-calendar-server/src/caldav/ICalendarEventCodecAttachment.test.ts',
  'matrix-calendar-server/src/controller/CalendarGatewayController.ts',
  'matrix-calendar-server/src/controller/CalendarGatewayController.test.ts',
  'matrix-calendar-server/src/service/RoomCalendarEventOperations.ts',
  'matrix-calendar-server/src/service/RoomCalendarEventOperations.test.ts',
]);

const MAX_REPORT_BYTES = 20 * 1024 * 1024;
const MAX_AGGREGATE_ASSERTIONS = 25_000;
const MAX_DIAGNOSTIC_STRINGS = 256;
const MAX_DIAGNOSTIC_STRING_LENGTH = 250_000;
const MAX_REPORTED_LOCATIONS = 40;
const MAX_REPORTED_FAILED_TEST_LOCATIONS = 40;
const MAX_REPORTED_TYPESCRIPT_CODES = 20;
const UNAVAILABLE_REPORT_SHAPE = 'diagnostic-unavailable code=report-shape';

function canonicalPathFromReport(value, allowedPaths) {
  if (typeof value !== 'string') return undefined;
  const normalized = value.replaceAll('\\', '/');

  for (const path of allowedPaths) {
    const workspaceRelative = path.replace(/^matrix-calendar-server\//, '');
    if (
      normalized === path ||
      normalized.endsWith('/' + path) ||
      normalized === workspaceRelative ||
      normalized.endsWith('/' + workspaceRelative)
    ) {
      return path;
    }
  }

  return undefined;
}

function addBoundedMessage(messages, value) {
  if (typeof value !== 'string') return true;
  if (
    messages.length >= MAX_DIAGNOSTIC_STRINGS ||
    value.length > MAX_DIAGNOSTIC_STRING_LENGTH
  ) {
    return false;
  }
  messages.push(value);
  return true;
}

function collectFailureMessages(testResult, messages) {
  if (!addBoundedMessage(messages, testResult.failureMessage)) return false;
  if (Array.isArray(testResult.failureMessages)) {
    for (const message of testResult.failureMessages) {
      if (!addBoundedMessage(messages, message)) return false;
    }
  }

  const executionError = testResult.testExecError;
  if (executionError !== undefined) {
    if (!executionError || typeof executionError !== 'object') return false;
    if (!addBoundedMessage(messages, executionError.message)) return false;
    if (!addBoundedMessage(messages, executionError.stack)) return false;
    if (Array.isArray(executionError.failureMessages)) {
      for (const message of executionError.failureMessages) {
        if (!addBoundedMessage(messages, message)) return false;
      }
    }
  }

  if (!Array.isArray(testResult.assertionResults)) return false;
  for (const assertion of testResult.assertionResults) {
    if (!assertion || typeof assertion !== 'object') return false;
    if (assertion.status !== 'failed') continue;
    if (!Array.isArray(assertion.failureMessages)) return false;
    for (const message of assertion.failureMessages) {
      if (!addBoundedMessage(messages, message)) return false;
    }
  }

  return true;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
}

function extractApprovedDiagnostics(messages) {
  const locations = new Set();
  const typescriptCodes = new Set();

  for (const message of messages) {
    for (const match of message.matchAll(/\bTS\d{3,5}\b/g)) {
      typescriptCodes.add(match[0]);
    }

    const normalized = message.replaceAll('\\', '/');
    for (const allowedPath of APPROVED_SOURCE_PATHS) {
      const aliases = [
        allowedPath,
        allowedPath.replace(/^matrix-calendar-server\//, ''),
      ];
      for (const alias of aliases) {
        const pattern =
          '(^|/)' +
          escapeRegExp(alias) +
          ':(\\d+)(?::\\d+)?(?=\\D|$)';
        const expression = new RegExp(pattern, 'g');
        for (const match of normalized.matchAll(expression)) {
          const line = Number(match[2]);
          if (Number.isSafeInteger(line) && line > 0) {
            locations.add(allowedPath + ':' + line);
          }
        }
      }
    }
  }

  return {
    locations: [...locations].sort().slice(0, MAX_REPORTED_LOCATIONS),
    typescriptCodes: [...typescriptCodes]
      .sort()
      .slice(0, MAX_REPORTED_TYPESCRIPT_CODES),
  };
}

function summarizeReport(candidate, report, testExitCode) {
  const targetPaths = TARGETS[candidate];
  if (
    !targetPaths ||
    !Number.isInteger(testExitCode) ||
    testExitCode < 0 ||
    testExitCode > 255 ||
    !report ||
    typeof report !== 'object' ||
    !Array.isArray(report.testResults) ||
    report.testResults.length === 0 ||
    report.testResults.length > targetPaths.length
  ) {
    return [UNAVAILABLE_REPORT_SHAPE];
  }

  const allowedSuites = targetPaths.map(({ reportPath }) => reportPath);
  const suitePaths = [];
  const failedTestLocations = new Set();
  const messages = [];
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let failedSuites = 0;
  let aggregateAssertions = 0;

  for (const testResult of report.testResults) {
    if (!testResult || typeof testResult !== 'object') {
      return [UNAVAILABLE_REPORT_SHAPE];
    }
    const suitePath = canonicalPathFromReport(testResult.name, allowedSuites);
    if (!suitePath || suitePaths.includes(suitePath)) {
      return ['diagnostic-unavailable code=unapproved-suite'];
    }
    suitePaths.push(suitePath);
    if (!Array.isArray(testResult.assertionResults)) {
      return [UNAVAILABLE_REPORT_SHAPE];
    }
    aggregateAssertions += testResult.assertionResults.length;
    if (
      aggregateAssertions > MAX_AGGREGATE_ASSERTIONS ||
      !collectFailureMessages(testResult, messages)
    ) {
      return [UNAVAILABLE_REPORT_SHAPE];
    }

    let suiteAssertionFailures = 0;
    for (const assertion of testResult.assertionResults) {
      switch (assertion.status) {
        case 'passed':
          passed += 1;
          break;
        case 'failed': {
          failed += 1;
          suiteAssertionFailures += 1;
          const line = assertion.location && assertion.location.line;
          if (
            Number.isSafeInteger(line) &&
            line > 0 &&
            (failedTestLocations.size < MAX_REPORTED_FAILED_TEST_LOCATIONS ||
              failedTestLocations.has(suitePath + ':' + line))
          ) {
            failedTestLocations.add(suitePath + ':' + line);
          }
          break;
        }
        case 'pending':
        case 'todo':
        case 'disabled':
          skipped += 1;
          break;
        default:
          return [UNAVAILABLE_REPORT_SHAPE];
      }
    }

    if (testResult.status === 'failed') {
      failedSuites += 1;
      if (suiteAssertionFailures === 0) {
        failed += 1;
        if (failedTestLocations.size < MAX_REPORTED_FAILED_TEST_LOCATIONS) {
          failedTestLocations.add(suitePath);
        }
      }
    } else if (
      testResult.status !== 'passed' &&
      testResult.status !== 'pending'
    ) {
      return [UNAVAILABLE_REPORT_SHAPE];
    }
  }

  if (suitePaths.length === 0) return [UNAVAILABLE_REPORT_SHAPE];
  const diagnostics = extractApprovedDiagnostics(messages);
  const lines = [
    'approved suites: ' + suitePaths.sort().join(', '),
    'tests: passed=' +
      passed +
      ' failed=' +
      failed +
      ' skipped=' +
      skipped +
      '; failed-suites=' +
      failedSuites,
  ];

  if (failedTestLocations.size > 0) {
    lines.push('failed test source locations:');
    for (const location of [...failedTestLocations].sort()) {
      lines.push('- ' + location);
    }
  }
  if (diagnostics.locations.length > 0) {
    lines.push('approved source frames:');
    for (const location of diagnostics.locations) {
      lines.push('- ' + location);
    }
  }
  if (diagnostics.typescriptCodes.length > 0) {
    lines.push('TypeScript codes: ' + diagnostics.typescriptCodes.join(', '));
  }

  return lines;
}

function runSelfTests() {
  const candidate = 'absolute-alarm';
  const suitePath =
    '/runner/work/project/project/matrix-calendar-server/src/caldav/ICalendarEventCodec.test.ts';
  const sentinel = 'PRIVATE_TITLE_MESSAGE_ASSERTION_VALUE_CREDENTIAL';
  const report = {
    testResults: [
      {
        name: suitePath,
        status: 'failed',
        assertionResults: [
          {
            title: sentinel,
            fullName: sentinel,
            status: 'failed',
            location: { line: 123, column: 9 },
            failureMessages: [
              sentinel +
                '\n    at /runner/work/project/project/matrix-calendar-widget/matrix-calendar-server/src/caldav/ICalendarEventCodec.ts:456:8\nerror TS2339: ' +
                sentinel,
            ],
          },
        ],
        failureMessage: sentinel,
        testExecError: { message: sentinel, stack: sentinel },
      },
    ],
  };
  const output = summarizeReport(candidate, report, 1).join('\n');
  assert.match(
    output,
    /matrix-calendar-server\/src\/caldav\/ICalendarEventCodec\.test\.ts:123/,
  );
  assert.match(
    output,
    /matrix-calendar-server\/src\/caldav\/ICalendarEventCodec\.ts:456/,
  );
  assert.match(output, /TypeScript codes: TS2339/);
  assert.equal(output.includes(sentinel), false);
  assert.equal(output.includes('title:'), false);
  assert.equal(output.includes('stack'), false);
  assert.equal(output.includes('expected'), false);

  assert.deepEqual(
    summarizeReport('absolute-alarm', { testResults: {} }, 1),
    [UNAVAILABLE_REPORT_SHAPE],
  );
  assert.deepEqual(
    summarizeReport(
      'absolute-alarm',
      {
        testResults: [
          {
            name: '/private/attacker/secret-suite.test.ts',
            status: 'failed',
            assertionResults: [],
          },
        ],
      },
      1,
    ),
    ['diagnostic-unavailable code=unapproved-suite'],
  );

  const oversizedAssertions = summarizeReport(
    candidate,
    {
      testResults: [
        {
          name: suitePath,
          status: 'passed',
          assertionResults: Array.from(
            { length: MAX_AGGREGATE_ASSERTIONS + 1 },
            () => ({
              status: 'passed',
              failureMessages: [],
            }),
          ),
        },
      ],
    },
    0,
  );
  assert.deepEqual(oversizedAssertions, [UNAVAILABLE_REPORT_SHAPE]);

  const manyFailedAssertions = summarizeReport(
    candidate,
    {
      testResults: [
        {
          name: suitePath,
          status: 'failed',
          assertionResults: Array.from(
            { length: MAX_REPORTED_FAILED_TEST_LOCATIONS + 1 },
            (_, index) => ({
              status: 'failed',
              location: { line: index + 1 },
              failureMessages: [],
            }),
          ),
        },
      ],
    },
    1,
  ).join('\n');
  assert.equal(
    (
      manyFailedAssertions.match(
        /matrix-calendar-server\/src\/caldav\/ICalendarEventCodec\.test\.ts:\d+/g,
      ) || []
    ).length,
    MAX_REPORTED_FAILED_TEST_LOCATIONS,
  );

  const passing = summarizeReport(
    candidate,
    {
      testResults: [
        {
          name: suitePath,
          status: 'passed',
          assertionResults: [
            {
              title: sentinel,
              fullName: sentinel,
              status: 'passed',
              failureMessages: [],
            },
          ],
        },
      ],
    },
    0,
  ).join('\n');
  assert.equal(passing.includes(sentinel), false);
  assert.match(passing, /tests: passed=1 failed=0 skipped=0/);
}

function main(argv) {
  const command = argv[0];
  const candidate = argv[1];
  const reportPath = argv[2];
  const exitCodeText = argv[3];

  if (command === 'self-test') {
    runSelfTests();
    process.stdout.write('safe-test-locator-self-test passed\n');
    return;
  }

  if (command === 'paths') {
    const targetPaths = TARGETS[candidate];
    if (!targetPaths) {
      process.stdout.write('diagnostic-unavailable code=target-map\n');
      process.exitCode = 1;
      return;
    }
    process.stdout.write(
      targetPaths.map(({ jestPath }) => jestPath).join('\n') + '\n',
    );
    return;
  }

  if (command === 'summarize') {
    const testExitCode = /^(0|[1-9][0-9]{0,2})$/.test(exitCodeText || '')
      ? Number(exitCodeText)
      : Number.NaN;
    if (!TARGETS[candidate] || !reportPath) {
      process.stdout.write('diagnostic-unavailable code=invocation\n');
      process.exitCode = 1;
      return;
    }

    let report;
    try {
      const reportStats = statSync(reportPath);
      if (!reportStats.isFile() || reportStats.size > MAX_REPORT_BYTES) {
        throw new Error('report-size-limit');
      }
      report = JSON.parse(readFileSync(reportPath, 'utf8'));
    } catch {
      process.stdout.write(UNAVAILABLE_REPORT_SHAPE + '\n');
      process.exitCode = 1;
      return;
    }

    const lines = summarizeReport(candidate, report, testExitCode);
    process.stdout.write(lines.join('\n') + '\n');
    if (lines.length === 1 && lines[0].startsWith('diagnostic-unavailable')) {
      process.exitCode = 1;
    }
    return;
  }

  process.stdout.write('diagnostic-unavailable code=invocation\n');
  process.exitCode = 1;
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  try {
    main(process.argv.slice(2));
  } catch {
    process.stdout.write(UNAVAILABLE_REPORT_SHAPE + '\n');
    process.exitCode = 1;
  }
}
