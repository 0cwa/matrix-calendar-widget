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
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { safeContractCaseStatusLines } from './caldav-contract-status.mjs';

const suitePath = (path) =>
  fileURLToPath(new URL(`../${path}`, import.meta.url));

const knownCases = [
  [
    'matrix-calendar-server/test/CalendarGatewayMembershipGuard.test.ts',
    'denies a nonmember before authorization, credential construction, or CalDAV',
    'membership-nonmember-denial',
  ],
  [
    'matrix-calendar-server/test/CalendarGatewayMembershipGuard.test.ts',
    'fails closed when membership lookup fails before downstream I/O',
    'membership-lookup-fail-closed',
  ],
  [
    'matrix-calendar-server/test/CalendarGatewayMembershipGuard.test.ts',
    'denies a failed authorization decision before credential or CalDAV I/O',
    'membership-authorization-denial',
  ],
  [
    'matrix-calendar-server/test/CalendarGatewayMembershipGuard.test.ts',
    'allows a joined member to reach authorized calendar discovery',
    'membership-joined-member-discovery',
  ],
  [
    'matrix-calendar-server/test/integration/PersonalOpenIdRadicaleContract.test.ts',
    'uses the actor proof and returns only the actor personal calendar',
    'personal-openid-actor-enumeration',
  ],
  [
    'matrix-calendar-server/test/integration/PersonalOpenIdRadicaleContract.test.ts',
    'denies missing and malformed identity before any CalDAV request',
    'personal-openid-invalid-identity-denial',
  ],
  [
    'matrix-calendar-server/test/integration/PersonalOpenIdRadicaleContract.test.ts',
    'denies a valid nonmember identity before any CalDAV request',
    'personal-openid-nonmember-denial',
  ],
  [
    'matrix-calendar-server/test/integration/CalDavDiscoveryContract.test.ts',
    'discovers a real VEVENT collection',
    'caldav-discovery-vevent-collection',
  ],
  [
    'matrix-calendar-server/test/integration/CalDavDiscoveryContract.test.ts',
    'sets, reads, and clears calendar-description on a real collection',
    'caldav-description-round-trip',
  ],
  [
    'matrix-calendar-server/test/integration/CalDavDiscoveryContract.test.ts',
    'sets, reads, and clears Apple calendar-color on a real collection',
    'caldav-color-round-trip',
  ],
  [
    'matrix-calendar-server/test/integration/CalDavDiscoveryContract.test.ts',
    'fails closed for invalid Radicale credentials',
    'caldav-invalid-credential-denial',
  ],
  [
    'matrix-calendar-server/test/integration/CalDavEventRoundTripContract.test.ts',
    'round-trips through the gateway core and a direct CalDAV client without data loss',
    'event-direct-caldav-round-trip',
  ],
  [
    'matrix-calendar-server/test/integration/CalDavEventRoundTripContract.test.ts',
    'round-trips a recurring master and detached overrides in one CalDAV resource',
    'event-recurring-master-detached-overrides',
  ],
  [
    'matrix-calendar-server/test/integration/CalDavEventRoundTripContract.test.ts',
    'overfetches floating and DATE boundary candidates without modifying their resources',
    'event-floating-date-boundary-candidates',
  ],
  [
    'matrix-calendar-server/test/integration/CalendarDiagnosticsContract.test.ts',
    'denies a joined non-manager before making any Radicale request',
    'calendar-diagnostics-nonmanager-denial',
  ],
  [
    'matrix-calendar-server/test/integration/CalendarDiagnosticsContract.test.ts',
    'returns only the valid in-base collection from real Radicale discovery',
    'calendar-diagnostics-safe-collection-discovery',
  ],
];

test('reports only constant IDs and closed statuses for allowlisted cases', () => {
  const testReport = {
    testResults: knownCases.map(([path, title], index) => ({
      name: suitePath(path),
      status: index === 0 ? 'failed' : 'passed',
      assertionResults: [
        {
          title,
          fullName: `untrusted full name ${index}`,
          status: index === 0 ? 'failed' : 'passed',
          failureMessages: ['untrusted assertion details'],
        },
      ],
    })),
  };

  const lines = safeContractCaseStatusLines(testReport);

  assert.deepEqual(
    lines,
    knownCases
      .map(
        ([, , caseId], index) =>
          `contract-case ${caseId} ${index === 0 ? 'failed' : 'passed'}`,
      )
      .sort(),
  );
});

test('maps pending and unknown status values to the closed pending category', () => {
  const testReport = {
    testResults: [
      {
        name: suitePath(knownCases[0][0]),
        status: 'failed',
        assertionResults: [
          { title: knownCases[0][1], status: 'pending' },
          { title: knownCases[1][1], status: 'future-status' },
        ],
      },
    ],
  };

  assert.deepEqual(safeContractCaseStatusLines(testReport), [
    'contract-case membership-lookup-fail-closed pending',
    'contract-case membership-nonmember-denial pending',
    'unmapped-failure count=1',
  ]);
});

test('hides unknown case names, assertion details, values, and locations', () => {
  const privateSentinels = [
    'private-test-title-sentinel',
    'private-full-name-sentinel',
    'private-assertion-value-sentinel',
    'private-ics-body-sentinel',
    'private-location-sentinel',
  ];
  const testReport = {
    testResults: [
      {
        name: suitePath(knownCases[0][0]),
        status: 'failed',
        assertionResults: [
          {
            title: privateSentinels[0],
            fullName: privateSentinels[1],
            status: 'failed',
            failureMessages: [
              `${privateSentinels[2]} ${privateSentinels[3]} ${privateSentinels[4]}`,
            ],
            location: { line: 999, column: 7 },
          },
        ],
      },
    ],
  };

  const output = safeContractCaseStatusLines(testReport).join('\n');

  assert.equal(output, 'unmapped-failure count=1');
  for (const sentinel of privateSentinels) {
    assert.equal(output.includes(sentinel), false);
  }
});

test('counts a failing suite at an unknown path without exposing the path', () => {
  const testReport = {
    testResults: [
      {
        name: '/private/repository/path/unknown-suite.test.ts',
        status: 'failed',
        assertionResults: [{ title: 'private title', status: 'failed' }],
      },
    ],
  };

  assert.deepEqual(safeContractCaseStatusLines(testReport), [
    'unmapped-failure count=1',
  ]);
});

test('fails closed when the Jest report has no test results array', () => {
  assert.deepEqual(safeContractCaseStatusLines({}), [
    'unmapped-failure count=1',
  ]);
});
