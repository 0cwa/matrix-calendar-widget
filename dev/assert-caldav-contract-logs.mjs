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

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PERIOD_CONTRACT_SUITE_PATH = fileURLToPath(
  new URL(
    '../matrix-calendar-server/test/integration/CalDavEventRoundTripContract.test.ts',
    import.meta.url,
  ),
);

const CONTRACT_CASES = [
  {
    title:
      'round-trips through the gateway core and a direct CalDAV client without data loss',
    id: 'gateway-direct-client-round-trip',
  },
  {
    title:
      'round-trips a recurring master and detached overrides in one CalDAV resource',
    id: 'recurring-master-detached-overrides',
  },
  {
    title:
      'round-trips a TZID PERIOD RDATE with an explicit end through Radicale',
    id: 'period-explicit-end',
  },
  {
    title: 'round-trips a TZID PERIOD RDATE with a duration through Radicale',
    id: 'period-duration',
  },
  {
    title:
      'overfetches floating and DATE boundary candidates without modifying their resources',
    id: 'floating-date-boundary-candidates',
  },
];

const PERIOD_CASES = CONTRACT_CASES.filter(({ id }) =>
  id.startsWith('period-'),
);

const PERIOD_STAGES = [
  'put-start',
  'put-complete',
  'get-start',
  'get-complete',
  'compare-start',
  'complete',
];
const RECURRING_OVERRIDE_CASE_ID = 'recurring-master-detached-overrides';
const RECURRING_OVERRIDE_STAGES = [
  'seed-put-start',
  'seed-put-complete',
  'initial-get-start',
  'initial-get-complete',
  'initial-compare-start',
  'initial-compare-complete',
  'patch-put-start',
  'patch-put-complete',
  'patch-get-start',
  'patch-get-complete',
  'patch-compare-start',
  'patch-compare-complete',
];
const STAGES_BY_CASE = new Map([
  ...PERIOD_CASES.map(({ id }) => [id, PERIOD_STAGES]),
  [RECURRING_OVERRIDE_CASE_ID, RECURRING_OVERRIDE_STAGES],
]);

export function safePeriodFailureLines(testReport) {
  return collectContractCaseStatuses(testReport)
    .filter(({ id, status }) => id.startsWith('period-') && status === 'failed')
    .map(({ id }) => `Known failed PERIOD contract case: ${id}`);
}

export function safeContractCaseStatusLines(testReport) {
  return collectContractCaseStatuses(testReport).map(
    ({ id, status }) => `Known contract case status: ${id}:${status}`,
  );
}

function collectContractCaseStatuses(testReport) {
  if (!testReport || !Array.isArray(testReport.testResults)) {
    return [];
  }

  const statusByTitle = new Map();
  for (const suite of testReport.testResults) {
    if (
      suite?.name !== PERIOD_CONTRACT_SUITE_PATH ||
      !Array.isArray(suite.assertionResults)
    ) {
      continue;
    }

    for (const assertion of suite.assertionResults) {
      if (assertion?.status !== 'passed' && assertion?.status !== 'failed') {
        continue;
      }
      for (const contractCase of CONTRACT_CASES) {
        if (assertion.title !== contractCase.title) {
          continue;
        }

        const currentStatus = statusByTitle.get(contractCase.title);
        if (assertion.status === 'failed' || !currentStatus) {
          statusByTitle.set(contractCase.title, assertion.status);
        }
      }
    }
  }

  return CONTRACT_CASES.map(({ title, id }) => ({
    id,
    status: statusByTitle.get(title) ?? 'case-not-seen',
  }));
}

export function safeContractStageLines(stageText, failedCaseIds) {
  if (typeof stageText !== 'string' || !Array.isArray(failedCaseIds)) {
    return [];
  }

  const knownCaseIds = new Set(STAGES_BY_CASE.keys());
  const failedCases = new Set(
    failedCaseIds.filter((caseId) => knownCaseIds.has(caseId)),
  );
  const lastStageByCase = new Map();
  const allowedTokens = new Set(
    [...STAGES_BY_CASE].flatMap(([caseId, stages]) =>
      stages.map((stage) => `${caseId}:${stage}`),
    ),
  );

  for (const token of stageText.split(/\r?\n/)) {
    if (!allowedTokens.has(token)) {
      continue;
    }
    const [caseId, stage] = token.split(':');
    if (failedCases.has(caseId)) {
      lastStageByCase.set(caseId, stage);
    }
  }

  return CONTRACT_CASES.filter(({ id }) => lastStageByCase.has(id)).map(
    ({ id }) =>
      `${id.startsWith('period-') ? 'Known PERIOD contract stage' : 'Known contract stage'}: ${id}:${lastStageByCase.get(id)}`,
  );
}

function main() {
  const credential = process.env.CALDAV_OPENID_CREDENTIAL ?? '';
  const username = process.env.CALDAV_USERNAME ?? 'calendar';
  const fixturePassword = process.env.MATRIX_CALENDAR_DEV_PASSWORD ?? '';
  const logFile = process.argv[2];
  const reportFile = process.argv[3];
  const stageFile = process.argv[4];
  if (!credential.startsWith('matrix-openid:') || !logFile || !reportFile) {
    process.stderr.write('Unable to verify CalDAV contract log redaction.\n');
    process.exit(1);
  }

  let identity;
  try {
    identity = JSON.parse(
      Buffer.from(
        credential.slice('matrix-openid:'.length),
        'base64url',
      ).toString('utf8'),
    );
  } catch {
    process.stderr.write('Unable to verify CalDAV contract log redaction.\n');
    process.exit(1);
  }

  const mxIdentityPayload = Buffer.from(JSON.stringify(identity)).toString(
    'base64url',
  );
  const mxIdentityHeader = `MX-Identity ${mxIdentityPayload}`;
  const basicHeader = `Basic ${Buffer.from(`${username}:${credential}`).toString('base64')}`;
  const protectedValues = [
    identity.access_token,
    fixturePassword,
    'invalid-openid-token-sentinel',
    credential,
    JSON.stringify(identity),
    mxIdentityPayload,
    mxIdentityHeader,
    basicHeader,
    `Authorization: ${mxIdentityHeader}`,
    `Authorization: ${basicHeader}`,
  ].filter((value) => typeof value === 'string' && value.length > 0);

  let serviceLogs;
  try {
    serviceLogs = execFileSync(
      'docker',
      [
        'compose',
        '-f',
        'dev/compose.yaml',
        'logs',
        '--no-color',
        '--no-log-prefix',
        'synapse',
        'radicale',
      ],
      { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
    );
  } catch {
    process.stderr.write('Unable to inspect CalDAV contract service logs.\n');
    process.exit(1);
  }

  let testLogs;
  let testReportText;
  let stageText = '';
  try {
    testLogs = readFileSync(logFile, 'utf8');
    testReportText = readFileSync(reportFile, 'utf8');
    if (stageFile) {
      stageText = readFileSync(stageFile, 'utf8');
    }
  } catch {
    process.stderr.write('Unable to inspect CalDAV contract test output.\n');
    process.exit(1);
  }

  if (
    [testLogs, testReportText, serviceLogs, stageText].some((logs) =>
      protectedValues.some((value) => logs.includes(value)),
    )
  ) {
    process.stderr.write(
      'CalDAV contract logs contain protected authentication material.\n',
    );
    process.exit(1);
  }

  let testReport;
  try {
    testReport = JSON.parse(testReportText);
  } catch {
    process.stderr.write('Unable to inspect CalDAV contract test results.\n');
    process.exit(1);
  }

  if (!Array.isArray(testReport.testResults)) {
    process.stderr.write('Unable to inspect CalDAV contract test results.\n');
    process.exit(1);
  }

  const failedSuites = (testReport.testResults ?? []).filter(
    (suite) => suite?.status === 'failed',
  );
  const caseStatusLines = safeContractCaseStatusLines(testReport);
  const failedCaseIds = CONTRACT_CASES.filter(({ id }) =>
    caseStatusLines.includes(`Known contract case status: ${id}:failed`),
  ).map(({ id }) => id);

  if (failedSuites.length === 0) {
    process.stdout.write(
      'CalDAV contract test and service logs contain no protected authentication material.\n',
    );
  } else {
    process.stdout.write(
      'CalDAV contract tests failed; sensitive failure details are withheld.\n',
    );
  }

  for (const line of caseStatusLines) {
    process.stdout.write(`${line}\n`);
  }
  if (stageFile && failedCaseIds.length > 0) {
    for (const line of safeContractStageLines(stageText, failedCaseIds)) {
      process.stdout.write(`${line}\n`);
    }
  }
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  main();
}
