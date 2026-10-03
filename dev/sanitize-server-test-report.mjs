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

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { safeContractCaseStatusLines } from './caldav-contract-status.mjs';

export function formatServerTestFailureSummary(testReport, testExitCode = 0) {
  if (
    !Number.isInteger(testExitCode) ||
    testExitCode < 0 ||
    testExitCode > 255
  ) {
    return ['server-test-report unavailable'];
  }

  const safeLines = safeContractCaseStatusLines(testReport);
  const failures = safeLines.filter(
    (line) =>
      line.startsWith('unmapped-failure count=') ||
      line.startsWith('contract-suite ') ||
      (line.startsWith('contract-case ') && line.endsWith(' failed')),
  );
  if (failures.length > 0) {
    return failures;
  }

  return [
    testExitCode === 0
      ? 'server-test-report no-failures'
      : 'server-test-report runner-failure-no-case-details',
  ];
}

function emitServerTestFailureSummary(reportPath, testExitCode) {
  let report;
  try {
    report = JSON.parse(readFileSync(reportPath, 'utf8'));
  } catch {
    process.stdout.write('server-test-report unavailable\n');
    process.exitCode = 1;
    return;
  }

  for (const line of formatServerTestFailureSummary(report, testExitCode)) {
    process.stdout.write(`${line}\n`);
  }
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  const reportPath = process.argv[2];
  const testExitCodeText = process.argv[3] ?? '';
  const testExitCode = /^(0|[1-9][0-9]{0,2})$/.test(testExitCodeText)
    ? Number(testExitCodeText)
    : Number.NaN;
  if (!reportPath || !Number.isInteger(testExitCode) || testExitCode > 255) {
    process.stdout.write('server-test-report unavailable\n');
    process.exitCode = 1;
  } else {
    emitServerTestFailureSummary(reportPath, testExitCode);
  }
}
