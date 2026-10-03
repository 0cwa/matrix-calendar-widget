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

import { fileURLToPath } from 'node:url';

const suitePath = (path) =>
  fileURLToPath(new URL(`../${path}`, import.meta.url));

const SUITE_IDS = new Map([
  [
    suitePath(
      'matrix-calendar-server/test/CalendarGatewayMembershipGuard.test.ts',
    ),
    'membership-guard',
  ],
  [
    suitePath(
      'matrix-calendar-server/test/integration/PersonalOpenIdRadicaleContract.test.ts',
    ),
    'personal-openid-contract',
  ],
  [
    suitePath(
      'matrix-calendar-server/test/integration/CalDavDiscoveryContract.test.ts',
    ),
    'caldav-discovery-contract',
  ],
  [
    suitePath(
      'matrix-calendar-server/test/integration/CalDavEventRoundTripContract.test.ts',
    ),
    'caldav-event-round-trip-contract',
  ],
  [
    suitePath(
      'matrix-calendar-server/test/integration/CalendarDiagnosticsContract.test.ts',
    ),
    'calendar-diagnostics-contract',
  ],
  [
    suitePath(
      'matrix-calendar-server/test/integration/RoomAppServiceRadicaleContract.test.ts',
    ),
    'room-appservice-radicale-contract',
  ],
]);

const CASE_IDS = new Map([
  [
    'membership-guard\0denies a nonmember before authorization, credential construction, or CalDAV',
    'membership-nonmember-denial',
  ],
  [
    'membership-guard\0fails closed when membership lookup fails before downstream I/O',
    'membership-lookup-fail-closed',
  ],
  [
    'membership-guard\0denies a failed authorization decision before credential or CalDAV I/O',
    'membership-authorization-denial',
  ],
  [
    'membership-guard\0allows a joined member to reach authorized calendar discovery',
    'membership-joined-member-discovery',
  ],
  [
    'personal-openid-contract\0uses the actor proof and returns only the actor personal calendar',
    'personal-openid-actor-enumeration',
  ],
  [
    'personal-openid-contract\0denies missing and malformed identity before any CalDAV request',
    'personal-openid-invalid-identity-denial',
  ],
  [
    'personal-openid-contract\0denies a valid nonmember identity before any CalDAV request',
    'personal-openid-nonmember-denial',
  ],
  [
    'caldav-discovery-contract\0discovers a real VEVENT collection',
    'caldav-discovery-vevent-collection',
  ],
  [
    'caldav-discovery-contract\0sets, reads, and clears calendar-description on a real collection',
    'caldav-description-round-trip',
  ],
  [
    'caldav-discovery-contract\0sets, reads, and clears Apple calendar-color on a real collection',
    'caldav-color-round-trip',
  ],
  [
    'caldav-discovery-contract\0fails closed for invalid Radicale credentials',
    'caldav-invalid-credential-denial',
  ],
  [
    'caldav-event-round-trip-contract\0round-trips through the gateway core and a direct CalDAV client without data loss',
    'event-direct-caldav-round-trip',
  ],
  [
    'caldav-event-round-trip-contract\0round-trips a recurring master and detached overrides in one CalDAV resource',
    'event-recurring-master-detached-overrides',
  ],
  [
    'caldav-event-round-trip-contract\0removes one PERIOD RDATE from a serialized CalDAV resource with its current ETag',
    'event-period-rdate-removal',
  ],
  [
    'caldav-event-round-trip-contract\0overfetches floating and DATE boundary candidates without modifying their resources',
    'event-floating-date-boundary-candidates',
  ],
  [
    'calendar-diagnostics-contract\0denies a joined non-manager before making any Radicale request',
    'calendar-diagnostics-nonmanager-denial',
  ],
  [
    'calendar-diagnostics-contract\0returns only the valid in-base collection from real Radicale discovery',
    'calendar-diagnostics-safe-collection-discovery',
  ],
  [
    'room-appservice-radicale-contract\0lists only the exact room binding through the appservice principal',
    'room-appservice-exact-binding',
  ],
  [
    'room-appservice-radicale-contract\0binds the Radicale OpenID subject to the configured service user, not the room sender',
    'room-appservice-subject-binding',
  ],
  [
    'room-appservice-radicale-contract\0forbids a cross-room calendar before appservice proof or CalDAV I/O',
    'room-appservice-cross-room-denial',
  ],
]);

function closedStatus(status) {
  if (status === 'passed') return 'passed';
  if (status === 'failed') return 'failed';
  return 'pending';
}

export function safeContractCaseStatusLines(testReport) {
  if (!Array.isArray(testReport?.testResults)) {
    return ['unmapped-failure count=1'];
  }

  const statusByCaseId = new Map();
  let unmappedFailures = 0;

  for (const suite of testReport.testResults) {
    const suiteId = SUITE_IDS.get(suite?.name);
    if (!suiteId) {
      if (suite?.status === 'failed') unmappedFailures += 1;
      continue;
    }

    const assertions = Array.isArray(suite.assertionResults)
      ? suite.assertionResults
      : [];
    let hasFailedAssertion = false;

    for (const assertion of assertions) {
      if (assertion?.status === 'failed') hasFailedAssertion = true;
      const caseId = CASE_IDS.get(`${suiteId}\0${assertion?.title}`);
      if (!caseId) {
        if (assertion?.status === 'failed') unmappedFailures += 1;
        continue;
      }

      const status = closedStatus(assertion?.status);
      const previous = statusByCaseId.get(caseId);
      if (previous !== 'failed' || status === 'failed') {
        statusByCaseId.set(caseId, status);
      }
    }

    if (suite.status === 'failed' && !hasFailedAssertion) {
      unmappedFailures += 1;
    }
  }

  const lines = [...statusByCaseId]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([caseId, status]) => `contract-case ${caseId} ${status}`);
  if (unmappedFailures > 0) {
    lines.push(`unmapped-failure count=${unmappedFailures}`);
  }
  return lines;
}
