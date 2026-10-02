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
  safeContractCaseStatusLines,
  safePeriodFailureLines,
  safePeriodStageLines,
} from './assert-caldav-contract-logs.mjs';

const SCRIPT_PATH = fileURLToPath(
  new URL('./assert-caldav-contract-logs.mjs', import.meta.url),
);
const EXPLICIT_END_TITLE =
  'round-trips a TZID PERIOD RDATE with an explicit end through Radicale';
const DURATION_TITLE =
  'round-trips a TZID PERIOD RDATE with a duration through Radicale';
const GATEWAY_ROUND_TRIP_TITLE =
  'round-trips through the gateway core and a direct CalDAV client without data loss';
const RECURRING_OVERRIDES_TITLE =
  'round-trips a recurring master and detached overrides in one CalDAV resource';
const FLOATING_DATE_TITLE =
  'overfetches floating and DATE boundary candidates without modifying their resources';

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

test('maps every fixed CalDAV contract title to a hardcoded ID', () => {
  const report = {
    testResults: [
      {
        name: PERIOD_CONTRACT_SUITE_PATH,
        status: 'failed',
        assertionResults: [
          GATEWAY_ROUND_TRIP_TITLE,
          RECURRING_OVERRIDES_TITLE,
          EXPLICIT_END_TITLE,
          DURATION_TITLE,
          FLOATING_DATE_TITLE,
        ].map((title) => ({
          title,
          status: 'failed',
          failureMessages: ['private assertion sentinel'],
        })),
      },
    ],
  };

  assert.deepEqual(safeContractCaseStatusLines(report), [
    'Known contract case status: gateway-direct-client-round-trip:failed',
    'Known contract case status: recurring-master-detached-overrides:failed',
    'Known contract case status: period-explicit-end:failed',
    'Known contract case status: period-duration:failed',
    'Known contract case status: floating-date-boundary-candidates:failed',
  ]);
  assert.equal(
    safeContractCaseStatusLines(report)
      .join('\n')
      .includes('private assertion sentinel'),
    false,
  );
});

test('reports exact PERIOD pass, fail, and case-not-seen statuses only', () => {
  const sentinels = ['private assertion sentinel', 'Bearer token sentinel'];
  const report = {
    testResults: [
      {
        name: PERIOD_CONTRACT_SUITE_PATH,
        status: 'failed',
        assertionResults: [
          {
            title: EXPLICIT_END_TITLE,
            status: 'passed',
            failureMessages: sentinels,
          },
          {
            title: DURATION_TITLE,
            status: 'failed',
            failureMessages: sentinels,
          },
        ],
      },
    ],
  };

  assert.deepEqual(safeContractCaseStatusLines(report), [
    'Known contract case status: gateway-direct-client-round-trip:case-not-seen',
    'Known contract case status: recurring-master-detached-overrides:case-not-seen',
    'Known contract case status: period-explicit-end:passed',
    'Known contract case status: period-duration:failed',
    'Known contract case status: floating-date-boundary-candidates:case-not-seen',
  ]);
  assert.deepEqual(
    safeContractCaseStatusLines({
      testResults: [failedSuite('/untrusted/path', EXPLICIT_END_TITLE)],
    }),
    [
      'Known contract case status: gateway-direct-client-round-trip:case-not-seen',
      'Known contract case status: recurring-master-detached-overrides:case-not-seen',
      'Known contract case status: period-explicit-end:case-not-seen',
      'Known contract case status: period-duration:case-not-seen',
      'Known contract case status: floating-date-boundary-candidates:case-not-seen',
    ],
  );
  const output = safeContractCaseStatusLines(report).join('\n');
  for (const sentinel of sentinels) {
    assert.equal(output.includes(sentinel), false);
  }
});

test('maps every fixed PERIOD stage token and keeps the last stage per case', () => {
  const stages = [
    'put-start',
    'put-complete',
    'get-start',
    'get-complete',
    'compare-start',
    'complete',
  ];
  const stageText = [
    ...stages.map((stage) => `period-explicit-end:${stage}`),
    ...stages.map((stage) => `period-duration:${stage}`),
  ].join('\n');

  assert.deepEqual(
    safePeriodStageLines(stageText, ['period-explicit-end', 'period-duration']),
    [
      'Known PERIOD contract stage: period-explicit-end:complete',
      'Known PERIOD contract stage: period-duration:complete',
    ],
  );
  assert.deepEqual(
    safePeriodStageLines(
      'period-explicit-end:put-start\nperiod-explicit-end:get-start',
      ['period-explicit-end'],
    ),
    ['Known PERIOD contract stage: period-explicit-end:get-start'],
  );
});

test('ignores malformed, unknown, and injected sidecar values', () => {
  const sentinels = [
    'private event sentinel',
    'Bearer credential-sentinel',
    'period-explicit-end:get-start injected-sentinel',
    '../period-duration:complete',
    'period-duration:unknown-stage',
  ];
  const output = safePeriodStageLines(sentinels.join('\n'), [
    'period-explicit-end',
    'period-duration',
  ]).join('\n');

  assert.equal(output, '');
  for (const sentinel of sentinels) {
    assert.equal(output.includes(sentinel), false);
  }
  assert.deepEqual(safePeriodStageLines(null, ['period-explicit-end']), []);
  assert.deepEqual(
    safePeriodStageLines('period-explicit-end:get-start', []),
    [],
  );
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

test('does not emit sidecar stages when scanner setup fails', () => {
  const result = runScanner(JSON.stringify({ testResults: [] }), {
    credential: '',
    sidecar: 'period-explicit-end:complete',
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
      'Known contract case status: gateway-direct-client-round-trip:case-not-seen\n' +
      'Known contract case status: recurring-master-detached-overrides:case-not-seen\n' +
      'Known contract case status: period-explicit-end:case-not-seen\n' +
      'Known contract case status: period-duration:failed\n' +
      'Known contract case status: floating-date-boundary-candidates:case-not-seen\n',
  );
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout.includes('sentinel'), false);
});

test('prints fixed passed and case-not-seen statuses without report details', () => {
  const report = {
    testResults: [
      {
        name: PERIOD_CONTRACT_SUITE_PATH,
        status: 'passed',
        assertionResults: [
          {
            title: EXPLICIT_END_TITLE,
            status: 'passed',
            failureMessages: ['private event sentinel'],
          },
        ],
      },
    ],
  };
  const result = runScanner(JSON.stringify(report));

  assert.equal(result.status, 0);
  assert.equal(
    result.stdout,
    'CalDAV contract test and service logs contain no protected authentication material.\n' +
      'Known contract case status: gateway-direct-client-round-trip:case-not-seen\n' +
      'Known contract case status: recurring-master-detached-overrides:case-not-seen\n' +
      'Known contract case status: period-explicit-end:passed\n' +
      'Known contract case status: period-duration:case-not-seen\n' +
      'Known contract case status: floating-date-boundary-candidates:case-not-seen\n',
  );
  assert.equal(result.stdout.includes('private event sentinel'), false);
});

test('prints only fixed stages from an exact runner-local sidecar', () => {
  const report = {
    testResults: [
      failedSuite(PERIOD_CONTRACT_SUITE_PATH, EXPLICIT_END_TITLE, [
        'private event sentinel',
        'assertion detail sentinel',
      ]),
    ],
  };
  const sidecar = [
    'period-explicit-end:put-start',
    'period-explicit-end:put-complete',
    'period-explicit-end:get-start',
    'private ICS sentinel',
    'period-duration:complete injected-token-sentinel',
  ].join('\n');
  const result = runScanner(JSON.stringify(report), { sidecar });

  assert.equal(result.status, 0);
  assert.equal(
    result.stdout,
    'CalDAV contract tests failed; sensitive failure details are withheld.\n' +
      'Known contract case status: gateway-direct-client-round-trip:case-not-seen\n' +
      'Known contract case status: recurring-master-detached-overrides:case-not-seen\n' +
      'Known contract case status: period-explicit-end:failed\n' +
      'Known contract case status: period-duration:case-not-seen\n' +
      'Known contract case status: floating-date-boundary-candidates:case-not-seen\n' +
      'Known PERIOD contract stage: period-explicit-end:get-start\n',
  );
  assert.equal(result.stderr, '');
  for (const sentinel of [
    'private event sentinel',
    'assertion detail sentinel',
    'private ICS sentinel',
    'injected-token-sentinel',
  ]) {
    assert.equal(result.stdout.includes(sentinel), false);
  }
});

test('reports case-not-seen for path or title mismatches', () => {
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
    'CalDAV contract tests failed; sensitive failure details are withheld.\n' +
      'Known contract case status: gateway-direct-client-round-trip:case-not-seen\n' +
      'Known contract case status: recurring-master-detached-overrides:case-not-seen\n' +
      'Known contract case status: period-explicit-end:case-not-seen\n' +
      'Known contract case status: period-duration:case-not-seen\n' +
      'Known contract case status: floating-date-boundary-candidates:case-not-seen\n',
  );
  assert.equal(result.status, 0);
  assert.equal(result.stdout.includes('sentinel'), false);
  assert.equal(result.stdout.includes('untrusted/path'), false);
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
    const stagePath = join(scratchDirectory, 'stages.txt');
    writeFileSync(logPath, '');
    writeFileSync(reportPath, reportText);
    if (typeof overrides.sidecar === 'string') {
      writeFileSync(stagePath, overrides.sidecar);
    }

    const accessToken = 'openid-access-token-sentinel';
    const credential = `matrix-openid:${Buffer.from(
      JSON.stringify({
        access_token: accessToken,
        matrix_server_name: 'localhost',
      }),
    ).toString('base64url')}`;
    const result = spawnSync(
      process.execPath,
      [
        SCRIPT_PATH,
        logPath,
        reportPath,
        ...(overrides.sidecar === undefined ? [] : [stagePath]),
      ],
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
