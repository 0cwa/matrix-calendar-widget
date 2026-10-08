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
    'removes one PERIOD RDATE from a serialized CalDAV resource with its current ETag',
    'event-period-rdate-removal',
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
  [
    'matrix-calendar-server/test/integration/RoomAppServiceRadicaleContract.test.ts',
    'lists only the exact room binding through the appservice principal',
    'room-appservice-exact-binding',
  ],
  [
    'matrix-calendar-server/test/integration/RoomAppServiceRadicaleContract.test.ts',
    'binds the Radicale OpenID subject to the configured service user, not the room sender',
    'room-appservice-subject-binding',
  ],
  [
    'matrix-calendar-server/test/integration/RoomAppServiceRadicaleContract.test.ts',
    'forbids a cross-room calendar before appservice proof or CalDAV I/O',
    'room-appservice-cross-room-denial',
  ],
  [
    'matrix-calendar-server/test/integration/RoomAppServiceRadicaleContract.test.ts',
    'creates, lists, reads, and deletes an event through the room bot commands',
    'room-appservice-bot-command-write',
  ],
  [
    'matrix-calendar-server/test/integration/RoomAppServiceRadicaleContract.test.ts',
    'denies an unauthorized room bot command before proof or CalDAV I/O',
    'room-appservice-bot-command-denial',
  ],
  [
    'matrix-calendar-server/test/integration/RoomReminderDeliveryContract.test.ts',
    'claims a canonical due alarm, sends it, and deduplicates repeated stable transactions',
    'room-reminder-live-idempotent-delivery',
  ],
  [
    'matrix-calendar-server/test/integration/RoomReminderDeliveryContract.test.ts',
    'denies a changed room binding before making a UID REPORT request',
    'room-reminder-changed-binding-denial',
  ],
  [
    'matrix-calendar-server/test/integration/RoomReminderDeliveryContract.test.ts',
    'denies an encrypted room before making a UID REPORT request',
    'room-reminder-encrypted-room-denial',
  ],
  [
    'matrix-calendar-server/src/controller/RoomCalendarTarget.test.ts',
    'authorizes and resolves the exact binding before requesting a proof or CalDAV',
    'room-calendar-target-exact-binding',
  ],
  [
    'matrix-calendar-server/src/controller/RoomCalendarTarget.test.ts',
    'denies a nonmember before requesting the appservice proof',
    'room-calendar-target-nonmember-denial',
  ],
  [
    'matrix-calendar-server/src/controller/RoomCalendarTarget.test.ts',
    'denies a mismatched room/calendar binding before proof or CalDAV',
    'room-calendar-target-mismatch-denial',
  ],
  [
    'matrix-calendar-server/src/service/RoomCalendarCalDavAccess.test.ts',
    'requests a transient proof for the configured principal and exact binding',
    'room-calendar-proof-exact-principal',
  ],
  [
    'matrix-calendar-server/src/service/RoomCalendarCalDavAccess.test.ts',
    'never mints a proof when the access feature is disabled',
    'room-calendar-proof-disabled-gate',
  ],
  [
    'matrix-calendar-server/src/service/RoomCalendarCalDavAccess.test.ts',
    'rejects a changed or unbound target before requesting a proof',
    'room-calendar-proof-target-rejection',
  ],
  [
    'matrix-calendar-server/src/service/RoomCalendarCalDavAccess.test.ts',
    'fails closed when the homeserver cannot mint the configured proof',
    'room-calendar-proof-fail-closed',
  ],
  [
    'matrix-calendar-server/src/service/RoomCalendarCalDavAccess.test.ts',
    'rejects a proof whose homeserver does not match the configured principal',
    'room-calendar-proof-subject-rejection',
  ],
  [
    'matrix-calendar-server/src/service/RoomCalendarCalDavAccess.test.ts',
    'does not expose the application-service token in an error',
    'room-calendar-proof-error-redaction',
  ],
  [
    'matrix-calendar-server/test/middleware/CalendarGatewayRateLimitMiddleware.test.ts',
    'allows a bounded burst and reports the fixed-window retry delay',
    'calendar-gateway-rate-limit-window',
  ],
  [
    'matrix-calendar-server/test/middleware/CalendarGatewayRateLimitMiddleware.test.ts',
    'fails closed at the source-key cap and frees expired entries during bounded cleanup',
    'calendar-gateway-rate-limit-key-cap',
  ],
  [
    'matrix-calendar-server/test/middleware/CalendarGatewayRateLimitMiddleware.test.ts',
    'matches only the versioned calendar route and its path-boundary descendants',
    'calendar-gateway-rate-limit-route-scope',
  ],
  [
    'matrix-calendar-server/test/middleware/CalendarGatewayRateLimitMiddleware.test.ts',
    'does not throttle non-gateway routes and ignores caller-supplied forwarded addresses',
    'calendar-gateway-rate-limit-peer-address',
  ],
  [
    'matrix-calendar-server/src/http/CalendarGatewayHttpApplication.test.ts',
    'handles Authorization preflight before OpenID verification and rejects excess GETs before verification',
    'calendar-gateway-openid-rate-limit-order',
  ],
  [
    'matrix-calendar-server/src/http/CalendarGatewayHttpApplication.test.ts',
    'keeps CORS headers on an authorization rejection',
    'calendar-gateway-cors-auth-rejection',
  ],
  [
    'matrix-calendar-server/src/http/CalendarGatewayHttpApplication.test.ts',
    'keeps CORS headers on the existing request-body limit response',
    'calendar-gateway-body-limit-before-auth',
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
    [
      ...knownCases.map(
        ([, , caseId], index) =>
          `contract-case ${caseId} ${index === 0 ? 'failed' : 'passed'}`,
      ),
      'contract-suite membership-guard failed',
    ].sort(),
  );
});

test('sanitizes gateway rate-limit failures and hides unknown private case details', () => {
  const privateSentinels = [
    'private-openid-case-title',
    'private-openid-assertion-value',
    'private-openid-response-body',
    'private-openid-token',
  ];
  const testReport = {
    testResults: [
      {
        name: suitePath(
          'matrix-calendar-server/test/middleware/CalendarGatewayRateLimitMiddleware.test.ts',
        ),
        status: 'failed',
        assertionResults: [
          {
            title:
              'does not throttle non-gateway routes and ignores caller-supplied forwarded addresses',
            status: 'failed',
            failureMessages: ['private forwarded address detail'],
          },
          {
            title: privateSentinels[0],
            fullName: privateSentinels[1],
            status: 'failed',
            failureMessages: [`${privateSentinels[2]} ${privateSentinels[3]}`],
          },
        ],
      },
      {
        name: suitePath(
          'matrix-calendar-server/src/http/CalendarGatewayHttpApplication.test.ts',
        ),
        status: 'failed',
        assertionResults: [
          {
            title:
              'handles Authorization preflight before OpenID verification and rejects excess GETs before verification',
            status: 'failed',
            failureMessages: ['private Matrix response and credential'],
          },
        ],
        failureMessage: 'private HTTP path and stack',
      },
    ],
  };

  const output = safeContractCaseStatusLines(testReport).join('\n');

  assert.equal(
    output,
    [
      'contract-case calendar-gateway-openid-rate-limit-order failed',
      'contract-case calendar-gateway-rate-limit-peer-address failed',
      'contract-suite calendar-gateway-http-setup failed',
      'contract-suite calendar-gateway-rate-limit failed',
      'unmapped-failure count=1',
    ].join('\n'),
  );
  assert.doesNotMatch(
    output,
    /private|forwarded address|Matrix response|credential|stack/,
  );
  for (const sentinel of privateSentinels) {
    assert.equal(output.includes(sentinel), false);
  }
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
    'contract-suite membership-guard failed',
  ]);
});

test('maps suite execution failures without exposing error details', () => {
  const testReport = {
    testResults: [
      {
        name: suitePath(
          'matrix-calendar-server/test/integration/PersonalOpenIdRadicaleContract.test.ts',
        ),
        status: 'failed',
        assertionResults: [],
        testExecError: {
          name: 'Error',
          message: 'private module path, token, event body',
          stack: 'private stack text',
        },
        failureMessage: 'private failure message',
      },
    ],
  };

  const output = safeContractCaseStatusLines(testReport).join('\n');
  assert.equal(output, 'contract-suite personal-openid-contract failed');
  assert.doesNotMatch(
    output,
    /private module path|token|event body|stack text|failure message/,
  );
});

test('maps PersonalOpenId assertion failures with fixed suite and case statuses', () => {
  const testReport = {
    testResults: [
      {
        name: suitePath(
          'matrix-calendar-server/test/integration/PersonalOpenIdRadicaleContract.test.ts',
        ),
        status: 'failed',
        assertionResults: [
          {
            title:
              'uses the actor proof and returns only the actor personal calendar',
            status: 'failed',
            failureMessages: [
              'private event body, user ID, and exception text',
            ],
          },
        ],
        failureMessage: 'private stack and credential text',
      },
    ],
  };

  const output = safeContractCaseStatusLines(testReport).join('\n');
  assert.equal(
    output,
    [
      'contract-case personal-openid-actor-enumeration failed',
      'contract-suite personal-openid-contract failed',
    ].join('\n'),
  );
  assert.doesNotMatch(
    output,
    /private event body|user ID|exception text|stack|credential text/,
  );
});

test('maps PersonalOpenId beforeAll failures without classifying their cause', () => {
  const testReport = {
    testResults: [
      {
        name: suitePath(
          'matrix-calendar-server/test/integration/PersonalOpenIdRadicaleContract.test.ts',
        ),
        status: 'failed',
        assertionResults: [],
        failureMessage: 'untrusted details do not classify this failure',
      },
    ],
  };

  assert.deepEqual(safeContractCaseStatusLines(testReport), [
    'contract-suite personal-openid-contract failed',
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

  assert.equal(
    output,
    'contract-suite membership-guard failed\nunmapped-failure count=1',
  );
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

test('fails closed for an unknown RoomAppService assertion without exposing it', () => {
  const testReport = {
    testResults: [
      {
        name: suitePath(
          'matrix-calendar-server/test/integration/RoomAppServiceRadicaleContract.test.ts',
        ),
        status: 'failed',
        assertionResults: [
          {
            title: 'private-room-contract-title',
            status: 'failed',
            failureMessages: ['private-room-contract-detail'],
          },
        ],
      },
    ],
  };

  const output = safeContractCaseStatusLines(testReport).join('\n');

  assert.equal(
    output,
    'contract-suite room-appservice-radicale-contract failed\nunmapped-failure count=1',
  );
  assert.equal(output.includes('private-room-contract-title'), false);
  assert.equal(output.includes('private-room-contract-detail'), false);
});

test('sanitizes live reminder delivery contract failures to closed case IDs', () => {
  const testReport = {
    testResults: [
      {
        name: suitePath(
          'matrix-calendar-server/test/integration/RoomReminderDeliveryContract.test.ts',
        ),
        status: 'failed',
        assertionResults: [
          {
            title:
              'denies a changed room binding before making a UID REPORT request',
            status: 'passed',
            failureMessages: [],
          },
          {
            title:
              'denies an encrypted room before making a UID REPORT request',
            status: 'passed',
            failureMessages: [],
          },
          {
            title:
              'claims a canonical due alarm, sends it, and deduplicates repeated stable transactions',
            status: 'failed',
            fullName: 'private room, event and transaction data',
            failureMessages: ['private token and event content'],
          },
        ],
        testExecError: {
          message: 'private homeserver response and credentials',
          stack: 'private stack',
        },
        failureMessage: 'private failure report',
      },
    ],
  };

  const output = safeContractCaseStatusLines(testReport).join('\n');
  assert.equal(
    output,
    [
      'contract-case room-reminder-changed-binding-denial passed',
      'contract-case room-reminder-encrypted-room-denial passed',
      'contract-case room-reminder-live-idempotent-delivery failed',
      'contract-suite room-reminder-delivery-contract failed',
    ].join('\n'),
  );
  assert.doesNotMatch(output, /private|credentials|event content|stack/);
});

test('fails closed when the Jest report has no test results array', () => {
  assert.deepEqual(safeContractCaseStatusLines({}), [
    'unmapped-failure count=1',
  ]);
});
