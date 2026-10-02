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
import { formatFailedCalDavTestIdentities } from './caldav-contract-diagnostics.mjs';

const credential = process.env.CALDAV_OPENID_CREDENTIAL ?? '';
const username = process.env.CALDAV_USERNAME ?? 'calendar';
const fixturePassword = process.env.MATRIX_CALENDAR_DEV_PASSWORD ?? '';
const logFile = process.argv[2];
const reportFile = process.argv[3];
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
try {
  testLogs = readFileSync(logFile, 'utf8');
  testReportText = readFileSync(reportFile, 'utf8');
} catch {
  process.stderr.write('Unable to inspect CalDAV contract test output.\n');
  process.exit(1);
}

if (
  [testLogs, testReportText, serviceLogs].some((logs) =>
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

const failedSuites = (testReport.testResults ?? []).filter(
  (suite) => suite.status === 'failed',
);
if (failedSuites.length === 0) {
  process.stdout.write(
    'CalDAV contract test and service logs contain no protected authentication material.\n',
  );
} else {
  process.stdout.write(
    'CalDAV contract tests failed; sensitive failure details are withheld.\n',
  );
  for (const identity of formatFailedCalDavTestIdentities(testReport)) {
    process.stdout.write(
      `Failed contract test: ${identity.suiteBasename}:${identity.line}:${identity.column} ${identity.staticTitle}\n`,
    );
    for (const location of identity.assertionLocations) {
      process.stdout.write(
        `Safe assertion location: CalDavEventRoundTripContract.test.ts:${location}\n`,
      );
    }
  }
  for (const suite of failedSuites) {
    const failureText = [
      suite.message,
      ...(suite.assertionResults ?? []).flatMap(
        (test) => test.failureMessages ?? [],
      ),
    ].join('\n');
    const statusAssertion = failureText.match(
      /Expected: (\d{3})\s+Received: (\d{3})/,
    );
    if (statusAssertion) {
      process.stdout.write(
        `HTTP status assertion: expected ${statusAssertion[1]}, received ${statusAssertion[2]}\n`,
      );
    }
    const stageDiagnostic = failureText.match(
      /SAFE_CALDAV_CONTRACT_DIAGNOSTIC gateway_status=(\d{3}) middleware_calls=(\d+) authorization=(not-observed|present|absent) identity=(not-observed|actor|other|absent|rejected) userinfo_status=(none|(?:\d{3})(?:,\d{3})*) membership=(none|(?:yes|no)(?:,(?:yes|no))*) provider_calls=(\d+) caldav_status=(none|(?:\d{3})(?:,\d{3})*)/,
    );
    if (stageDiagnostic) {
      process.stdout.write(
        `Safe contract stages: gateway_status=${stageDiagnostic[1]}, middleware_calls=${stageDiagnostic[2]}, authorization=${stageDiagnostic[3]}, identity=${stageDiagnostic[4]}, userinfo_status=${stageDiagnostic[5]}, membership=${stageDiagnostic[6]}, provider_calls=${stageDiagnostic[7]}, caldav_status=${stageDiagnostic[8]}\n`,
      );
    }
  }
}
