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
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { formatFailedCalDavTestIdentities } from './caldav-contract-diagnostics.mjs';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const suitePath = path.join(
  repoRoot,
  'matrix-calendar-server/test/integration/CalDavEventRoundTripContract.test.ts',
);
const staticTitle =
  'removes one PERIOD RDATE from a serialized CalDAV resource with its current ETag';

test('reports static failed test identity without failure details', () => {
  const report = {
    testResults: [
      {
        name: suitePath,
        status: 'failed',
        assertionResults: [
          {
            title: staticTitle,
            status: 'failed',
            location: { line: 199, column: 3 },
            failureMessages: [
              'CALDAV_OPENID_CREDENTIAL=matrix-openid:secret-token',
              'BEGIN:VCALENDAR\nSUMMARY:private title\nEND:VCALENDAR',
              'private response body SAFE_CALDAV_PERIOD_STAGE=period-duration-removed',
              'BEGIN:VCALENDAR\nSUMMARY:private title\nEND:VCALENDAR',
              'at Object.<anonymous> (/untrusted/path/NotAllowed.test.ts:123:45)',
            ],
          },
          {
            title: 'dynamic secret-token-value',
            status: 'failed',
            location: { line: 222, column: 5 },
            failureMessages: ['private response body'],
          },
          {
            title: 'failure without test coordinates',
            status: 'failed',
            failureMessages: ['private response body without location'],
          },
        ],
      },
    ],
  };

  const identities = formatFailedCalDavTestIdentities(
    report,
    repoRoot,
    [
      'period-test-start',
      'period-resource-read',
      'untrusted-stage-secret-token',
      'SAFE_CALDAV_PERIOD_STAGE=period-duration-removed',
      'period-target-validated',
      'seed-put-http-399',
      'seed-put-http-400',
      'seed-put-http-500',
      'seed-put-http-499',
    ].join('\n'),
  );
  const output = JSON.stringify(identities);

  assert.match(
    output,
    /CalDavEventRoundTripContract\.test\.ts.*199.*3.*removes one PERIOD RDATE from a serialized CalDAV resource with its current ETag/,
  );
  assert.match(output, /222.*5.*static title withheld/);
  assert.equal(identities[0]?.safePeriodStage, 'seed-put-http-499');
  assert.equal(identities[1]?.safePeriodStage, null);
  assert.doesNotMatch(
    output,
    /secret-token|BEGIN:VCALENDAR|private title|response body|coordinates|NotAllowed|untrusted|CALDAV_OPENID|SUMMARY|SAFE_CALDAV_PERIOD_STAGE=|seed-put-http-(?:399|500)/,
  );
});
