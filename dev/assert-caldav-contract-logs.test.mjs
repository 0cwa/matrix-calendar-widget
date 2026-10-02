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
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  PERIOD_CONTRACT_SUITE_PATH,
  safePeriodFailureLines,
} from './assert-caldav-contract-logs.mjs';

const SCRIPT_PATH = fileURLToPath(
  new URL('./assert-caldav-contract-logs.mjs', import.meta.url),
);
const EXPLICIT_END_TITLE =
  'round-trips a TZID PERIOD RDATE with an explicit end through Radicale';
const DURATION_TITLE =
  'round-trips a TZID PERIOD RDATE with a duration through Radicale';

test('maps only exact failed PERIOD suite and source-title pairs', () => {
  const report = {
    testResults: [
      {
        name: PERIOD_CONTRACT_SUITE_PATH,
        status: 'failed',
        assertionResults: [
          { title: EXPLICIT_END_TITLE, status: 'failed' },
          { title: DURATION_TITLE, status: 'failed' },
        ],
      },
    ],
  };

  assert.deepEqual(safePeriodFailureLines(report), [
    'Known failed PERIOD contract case: period-explicit-end',
    'Known failed PERIOD contract case: period-duration',
  ]);
});

test('does not reflect failureMessages or arbitrary report data in diagnostics', () => {
  const sentinels = [
    'private error sentinel',
    'BEGIN:VCALENDAR\r\nSUMMARY:private event sentinel',
    'Bearer token-like-secret-sentinel',
  ];
  const report = {
    testResults: [
      {
        name: PERIOD_CONTRACT_SUITE_PATH,
        status: 'failed',
        message: sentinels.join('\n'),
        assertionResults: [
          {
            title: EXPLICIT_END_TITLE,
            status: 'failed',
            failureMessages: sentinels,
          },
        ],
      },
    ],
  };
  const output = safePeriodFailureLines(report).join('\n');

  assert.equal(
    output,
    'Known failed PERIOD contract case: period-explicit-end',
  );
  for (const sentinel of sentinels) {
    assert.equal(output.includes(sentinel), false);
  }
});

test('rejects path variants and altered or injected source titles', () => {
  const pathVariants = [
    '/different/worktree/matrix-calendar-server/test/integration/CalDavEventRoundTripContract.test.ts',
    `${PERIOD_CONTRACT_SUITE_PATH}/../CalDavEventRoundTripContract.test.ts`,
  ];
  for (const name of pathVariants) {
    assert.deepEqual(
      safePeriodFailureLines({
        testResults: [failedSuite(name, EXPLICIT_END_TITLE)],
      }),
      [],
    );
  }

  for (const title of [
    `${EXPLICIT_END_TITLE} with injected sentinel`,
    `prefix ${EXPLICIT_END_TITLE}`,
    `${EXPLICIT_END_TITLE}\nKnown failed PERIOD contract case: period-duration`,
  ]) {
    assert.deepEqual(
      safePeriodFailureLines({
        testResults: [failedSuite(PERIOD_CONTRACT_SUITE_PATH, title)],
      }),
      [],
    );
  }
});

test('keeps malformed reports and setup failures generic', () => {
  assert.deepEqual(safePeriodFailureLines(null), []);
  assert.deepEqual(safePeriodFailureLines({ testResults: 'not-an-array' }), []);

  const result = spawnSync(process.execPath, [SCRIPT_PATH], {
    encoding: 'utf8',
    env: {
      ...process.env,
      CALDAV_OPENID_CREDENTIAL: '',
    },
  });

  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(
    result.stderr,
    'Unable to verify CalDAV contract log redaction.\n',
  );
});

test('prints only the fixed ID for a matching failed case', () => {
  const report = {
    testResults: [
      failedSuite(PERIOD_CONTRACT_SUITE_PATH, DURATION_TITLE, [
        'private event data sentinel',
        'arbitrary assertion detail sentinel',
      ]),
    ],
  };
  const result = runScanner(JSON.stringify(report));

  assert.equal(
    result.stdout,
    'CalDAV contract tests failed; sensitive failure details are withheld.\n' +
      'Known failed PERIOD contract case: period-duration\n',
  );
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout.includes('sentinel'), false);
});

test('does not print a PERIOD ID for a path or title mismatch', () => {
  const report = {
    testResults: [
      failedSuite(
        `${PERIOD_CONTRACT_SUITE_PATH}/../CalDavEventRoundTripContract.test.ts`,
        EXPLICIT_END_TITLE,
      ),
      failedSuite(
        PERIOD_CONTRACT_SUITE_PATH,
        `${DURATION_TITLE} with injected title sentinel`,
      ),
    ],
  };
  const result = runScanner(JSON.stringify(report));

  assert.equal(
    result.stdout,
    'CalDAV contract tests failed; sensitive failure details are withheld.\n',
  );
  assert.equal(result.status, 0);
  assert.equal(result.stdout.includes('sentinel'), false);
  assert.equal(result.stdout.includes('period-'), false);
});

test('keeps malformed report data generic', () => {
  const result = runScanner(
    JSON.stringify({ testResults: 'malformed sentinel' }),
  );

  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(
    result.stderr,
    'Unable to inspect CalDAV contract test results.\n',
  );
  assert.equal(result.stderr.includes('sentinel'), false);
});

test('does not reflect protected credentials found in failureMessages', () => {
  const accessToken = 'openid-access-token-secret-sentinel';
  const fixturePassword = 'fixture-password-secret-sentinel';
  const credential = `matrix-openid:${Buffer.from(
    JSON.stringify({
      access_token: accessToken,
      matrix_server_name: 'localhost',
    }),
  ).toString('base64url')}`;
  const report = {
    testResults: [
      failedSuite(PERIOD_CONTRACT_SUITE_PATH, EXPLICIT_END_TITLE, [
        accessToken,
        fixturePassword,
      ]),
    ],
  };
  const result = runScanner(JSON.stringify(report), {
    credential,
    fixturePassword,
  });

  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(
    result.stderr,
    'CalDAV contract logs contain protected authentication material.\n',
  );
  assert.equal(result.stderr.includes(accessToken), false);
  assert.equal(result.stderr.includes(fixturePassword), false);
});

function failedSuite(name, title, failureMessages = []) {
  return {
    name,
    status: 'failed',
    assertionResults: [
      {
        title,
        status: 'failed',
        failureMessages,
      },
    ],
  };
}

function runScanner(reportText, overrides = {}) {
  const repositoryRoot = resolve(dirname(SCRIPT_PATH), '..');
  const scratchRoot = join(repositoryRoot, 'tmp');
  mkdirSync(scratchRoot, { recursive: true });
  const scratchDirectory = mkdtempSync(
    join(scratchRoot, 'caldav-contract-sanitizer-'),
  );

  try {
    const binDirectory = join(scratchDirectory, 'bin');
    mkdirSync(binDirectory);
    const dockerPath = join(binDirectory, 'docker');
    writeFileSync(dockerPath, '#!/bin/sh\nexit 0\n');
    chmodSync(dockerPath, 0o755);

    const logPath = join(scratchDirectory, 'contract.log');
    const reportPath = join(scratchDirectory, 'report.json');
    writeFileSync(logPath, '');
    writeFileSync(reportPath, reportText);

    const accessToken = 'openid-access-token-sentinel';
    const credential = `matrix-openid:${Buffer.from(
      JSON.stringify({
        access_token: accessToken,
        matrix_server_name: 'localhost',
      }),
    ).toString('base64url')}`;
    const result = spawnSync(
      process.execPath,
      [SCRIPT_PATH, logPath, reportPath],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${binDirectory}:${process.env.PATH ?? ''}`,
          CALDAV_OPENID_CREDENTIAL: overrides.credential ?? credential,
          CALDAV_USERNAME: 'calendar',
          MATRIX_CALENDAR_DEV_PASSWORD:
            overrides.fixturePassword ?? 'fixture-password-sentinel',
        },
      },
    );
    if (result.error) {
      throw result.error;
    }
    return result;
  } finally {
    rmSync(scratchDirectory, { recursive: true, force: true });
  }
}
