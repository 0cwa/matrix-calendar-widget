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

const credential = process.env.CALDAV_OPENID_CREDENTIAL ?? '';
const username = process.env.CALDAV_USERNAME ?? 'calendar';
const fixturePassword = process.env.MATRIX_CALENDAR_DEV_PASSWORD ?? '';
const logFile = process.argv[2];
if (!credential.startsWith('matrix-openid:') || !logFile) {
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
try {
  testLogs = readFileSync(logFile, 'utf8');
} catch {
  process.stderr.write('Unable to inspect CalDAV contract test output.\n');
  process.exit(1);
}

if (
  [testLogs, serviceLogs].some((logs) =>
    protectedValues.some((value) => logs.includes(value)),
  )
) {
  process.stderr.write(
    'CalDAV contract logs contain protected authentication material.\n',
  );
  process.exit(1);
}

process.stdout.write(
  'CalDAV contract test and service logs contain no protected authentication material.\n',
);
