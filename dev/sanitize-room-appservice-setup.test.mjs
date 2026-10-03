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
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  formatPersonalOpenIdSetupDiagnostic,
  formatRoomAppServiceSetupDiagnostic,
} from './sanitize-room-appservice-setup.mjs';

const roomSuitePath = fileURLToPath(
  new URL(
    '../matrix-calendar-server/test/integration/RoomAppServiceRadicaleContract.test.ts',
    import.meta.url,
  ),
);
const personalSuitePath = fileURLToPath(
  new URL(
    '../matrix-calendar-server/test/integration/PersonalOpenIdRadicaleContract.test.ts',
    import.meta.url,
  ),
);

function report(
  message,
  statuses = ['failed', 'failed', 'failed'],
  suiteStatus = 'failed',
) {
  return {
    testResults: [
      {
        name: roomSuitePath,
        status: suiteStatus,
        message,
        assertionResults: statuses.map((status) => ({ status })),
      },
    ],
  };
}

test('emits only a categorized setup error, repository frame, and case counts', () => {
  const credential = 'fixtureOpenIdSecretValue0123456789';
  const appserviceToken = 'matrix-calendar-contract-as-token';
  const source =
    '/home/runner/work/matrix-calendar-widget/matrix-calendar-widget/matrix-calendar-server/test/integration/RoomAppServiceRadicaleContract.test.ts:205:12';
  const diagnostic = formatRoomAppServiceSetupDiagnostic(
    report(
      `TypeError: failed to reach https://homeserver.example/_matrix?access_token=${credential} with Bearer ${appserviceToken}\n    at registerServiceUser (${source})`,
    ),
    'room-appservice-setup-start\nroom-appservice-setup-stage-register-service-user\n',
  );

  assert.equal(
    diagnostic,
    [
      'room-appservice-setup-test-results stage=register-service-user http-status=unavailable matrix-errcode=unavailable total=3 passed=0 failed=3 pending=0 test-bodies-started=0/7',
      'room-appservice-setup-exception class=TypeError message="service request failed" source=matrix-calendar-server/test/integration/RoomAppServiceRadicaleContract.test.ts:205:12',
    ].join('\n'),
  );
  assert.equal(diagnostic.includes(credential), false);
  assert.equal(diagnostic.includes(appserviceToken), false);
  assert.equal(diagnostic.includes('homeserver.example'), false);
  assert.equal(diagnostic.includes('/home/runner'), false);
});

test('does not expose a test-body failure as a setup exception', () => {
  const diagnostic = formatRoomAppServiceSetupDiagnostic(
    report('AssertionError: event title mismatch'),
    'room-appservice-setup-start\nroom-appservice-case-start-exact-binding\nroom-appservice-case-start-event-write\nroom-appservice-case-start-bot-command-write\n',
  );
  assert.equal(
    diagnostic,
    'room-appservice-setup-diagnostic not-a-setup-failure test-bodies=3/7',
  );
  assert.equal(diagnostic.includes('event title mismatch'), false);
});

test('does not expose suite errors when setup completed or the suite was skipped', () => {
  assert.equal(
    formatRoomAppServiceSetupDiagnostic(
      report('Error: private detail'),
      'room-appservice-setup-start\nroom-appservice-setup-complete\n',
    ),
    'room-appservice-setup-diagnostic setup-completed',
  );
  assert.equal(
    formatRoomAppServiceSetupDiagnostic(
      report(
        'Error: private detail',
        ['pending', 'pending', 'pending'],
        'pending',
      ),
      '',
    ),
    'room-appservice-setup-diagnostic suite-status-pending setup-start=false',
  );
});

test('captures a sanitized suite-load exception when setup never started', () => {
  const diagnostic = formatRoomAppServiceSetupDiagnostic(
    report(
      'SyntaxError: Cannot find module privateDependencyName0123456789\n    at Object.<anonymous> (/runner/matrix-calendar-server/test/integration/RoomAppServiceRadicaleContract.test.ts:18:1)',
      [],
    ),
    '',
  );
  assert.equal(
    diagnostic,
    [
      'room-appservice-suite-load-test-results stage=unavailable http-status=unavailable matrix-errcode=unavailable total=0 passed=0 failed=0 pending=0 test-bodies-started=0/7',
      'room-appservice-suite-load-exception class=SyntaxError message="module not found" source=matrix-calendar-server/test/integration/RoomAppServiceRadicaleContract.test.ts:18:1',
    ].join('\n'),
  );
  assert.equal(diagnostic.includes('privateDependencyName0123456789'), false);
});

test('fails closed when the report has no repository source frame', () => {
  const diagnostic = formatRoomAppServiceSetupDiagnostic(
    report('Error: missing Matrix response'),
    'room-appservice-setup-start\n',
  );
  assert.match(
    diagnostic,
    /class=Error message="unclassified" source=unavailable$/,
  );
});

test('does not interpolate unknown suite statuses or source filenames', () => {
  const privateStatus = 'failed secret=private-status-value';
  const diagnostic = formatRoomAppServiceSetupDiagnostic(
    report(
      'Error: sanitized text\n    at request (/workspace/matrix-calendar-server/test/private-user@private.example:88:3)',
      [],
      privateStatus,
    ),
    'room-appservice-setup-start\n',
  );

  assert.equal(
    diagnostic,
    'room-appservice-setup-diagnostic suite-status-unknown setup-start=true',
  );
  assert.equal(diagnostic.includes(privateStatus), false);
  assert.equal(diagnostic.includes('private-user'), false);
  assert.equal(diagnostic.includes('private.example'), false);
});

test('does not emit freeform token, API key, client secret, session key, or JSON values', () => {
  const diagnostic = formatRoomAppServiceSetupDiagnostic(
    report(
      'Error: token=tiny-token-sentinel api-key="tiny-api-sentinel" client-secret=tiny-client-sentinel session-key=tiny-session-sentinel response={"access_token":"tiny-json-sentinel"}',
    ),
    'room-appservice-setup-start\nroom-appservice-setup-stage-actor-login\n',
  );

  for (const secret of [
    'tiny-token-sentinel',
    'tiny-api-sentinel',
    'tiny-client-sentinel',
    'tiny-session-sentinel',
    'tiny-json-sentinel',
  ]) {
    assert.equal(
      diagnostic.includes(secret),
      false,
      `${secret} was not redacted`,
    );
  }
  assert.match(diagnostic, /stage=actor-login/);
  assert.match(diagnostic, /message="unclassified"/);
});

test('does not emit private hosts, addresses, or paths while preserving the error class', () => {
  const diagnostic = formatRoomAppServiceSetupDiagnostic(
    report(
      'TypeError: request failed at homeserver.private.example:8008 /runner/private-user/workspace with ECONNREFUSED 192.0.2.44:5232',
    ),
    'room-appservice-setup-start\n',
  );

  assert.match(diagnostic, /class=TypeError/);
  for (const privateValue of [
    'homeserver.private.example',
    'private-user',
    '192.0.2.44',
    '/runner',
  ]) {
    assert.equal(diagnostic.includes(privateValue), false);
  }
});

test('reports hook failures with no assertion results using a safe category', () => {
  const diagnostic = formatRoomAppServiceSetupDiagnostic(
    report(
      'AxiosError: Request failed with status code 403 response={"token":"private-hook-secret"}',
      [],
    ),
    'room-appservice-setup-start\nroom-appservice-setup-stage-register-service-user\n',
  );

  assert.equal(
    diagnostic,
    [
      'room-appservice-setup-test-results stage=register-service-user http-status=unavailable matrix-errcode=unavailable total=0 passed=0 failed=0 pending=0 test-bodies-started=0/7',
      'room-appservice-setup-exception class=AxiosError message="HTTP request failed with status 403" source=unavailable',
    ].join('\n'),
  );
  assert.equal(diagnostic.includes('private-hook-secret'), false);
});

test('reports bounded Matrix request status and code for Room fixture setup', () => {
  const diagnostic = formatRoomAppServiceSetupDiagnostic(
    report(
      'Error: Matrix contract fixture request failed (403) response={"errcode":"M_FORBIDDEN","error":"private-room-detail"}\n    at matrixJson (/repo/matrix-calendar-server/test/integration/RoomAppServiceRadicaleContract.test.ts:616:11)',
    ),
    [
      'room-appservice-setup-start',
      'room-appservice-setup-stage-actor-login',
      'room-appservice-http-status-403',
      'room-appservice-matrix-error-M_FORBIDDEN',
    ].join('\n'),
  );

  assert.equal(
    diagnostic,
    [
      'room-appservice-setup-test-results stage=actor-login http-status=403 matrix-errcode=M_FORBIDDEN total=3 passed=0 failed=3 pending=0 test-bodies-started=0/7',
      'room-appservice-setup-exception class=Error message="Matrix fixture HTTP status 403" source=matrix-calendar-server/test/integration/RoomAppServiceRadicaleContract.test.ts:616:11',
    ].join('\n'),
  );
  assert.equal(diagnostic.includes('private-room-detail'), false);
  assert.equal(diagnostic.includes('/repo/'), false);
});

test('Room setup diagnosis rejects injected status and Matrix code markers', () => {
  const diagnostic = formatRoomAppServiceSetupDiagnostic(
    report(
      'Error: Matrix contract fixture request failed (403)\n    at matrixJson (/repo/matrix-calendar-server/test/integration/RoomAppServiceRadicaleContract.test.ts:616:11)',
    ),
    [
      'room-appservice-setup-stage-actor-login',
      'room-appservice-http-status-403 secret=hidden',
      'room-appservice-matrix-error-M_PRIVATE_TOKEN',
    ].join('\n'),
  );

  assert.match(
    diagnostic,
    /http-status=unavailable matrix-errcode=unavailable/,
  );
  assert.equal(diagnostic.includes('hidden'), false);
  assert.equal(diagnostic.includes('M_PRIVATE_TOKEN'), false);
});

test('maps a fixed Matrix error code while dropping its freeform response', () => {
  const diagnostic = formatRoomAppServiceSetupDiagnostic(
    report('MatrixError: M_FORBIDDEN response={"error":"private room detail"}'),
    'room-appservice-setup-start\nroom-appservice-setup-stage-create-room-one\n',
  );

  assert.match(diagnostic, /message="Matrix response M_FORBIDDEN"/);
  assert.equal(diagnostic.includes('private room detail'), false);
});

test('reports only safe Personal OpenID status, Matrix code, class, and source', () => {
  const source =
    '/home/runner/work/matrix-calendar-widget/matrix-calendar-widget/matrix-calendar-server/test/integration/PersonalOpenIdRadicaleContract.test.ts:701:11';
  const diagnostic = formatPersonalOpenIdSetupDiagnostic(
    {
      testResults: [
        {
          name: personalSuitePath,
          status: 'failed',
          message: `Error: Matrix contract fixture request failed (403) response={"errcode":"M_FORBIDDEN","error":"private-room-detail"}\n    at matrixJson (${source})`,
          assertionResults: [
            { status: 'failed' },
            { status: 'failed' },
            { status: 'failed' },
          ],
        },
      ],
    },
    [
      'personal-openid-setup-start',
      'personal-openid-setup-stage-nonmember-login',
      'personal-openid-setup-failure-http-status',
      'personal-openid-http-status-403',
      'personal-openid-matrix-error-M_FORBIDDEN',
    ].join('\n'),
  );

  assert.equal(
    diagnostic,
    [
      'personal-openid-setup-failure stage=nonmember-login category=http-status http-status=403 matrix-errcode=M_FORBIDDEN failed-case-results=3/3',
      'personal-openid-setup-exception class=Error message="Matrix fixture HTTP status 403" source=matrix-calendar-server/test/integration/PersonalOpenIdRadicaleContract.test.ts:701:11',
    ].join('\n'),
  );
  assert.equal(diagnostic.includes('private-room-detail'), false);
  assert.equal(diagnostic.includes('/home/runner'), false);
});

test('Personal OpenID diagnosis rejects injected HTTP status and Matrix code markers', () => {
  const diagnostic = formatPersonalOpenIdSetupDiagnostic(
    {
      testResults: [
        {
          name: personalSuitePath,
          status: 'failed',
          message:
            'Error: Matrix contract fixture request failed (403)\n    at matrixJson (/repo/matrix-calendar-server/test/integration/PersonalOpenIdRadicaleContract.test.ts:701:11)',
          assertionResults: [],
        },
      ],
    },
    [
      'personal-openid-setup-stage-nonmember-login',
      'personal-openid-setup-failure-http-status',
      'personal-openid-http-status-403 secret=hidden',
      'personal-openid-matrix-error-M_PRIVATE_TOKEN',
    ].join('\n'),
  );

  assert.match(
    diagnostic,
    /category=http-status http-status=unavailable matrix-errcode=unavailable/,
  );
  assert.equal(diagnostic.includes('hidden'), false);
  assert.equal(diagnostic.includes('M_PRIVATE_TOKEN'), false);
});

test('does not emit configured workflow credentials even when their shape is short', () => {
  const previous = process.env.MATRIX_APPLICATION_SERVICE_TOKEN;
  process.env.MATRIX_APPLICATION_SERVICE_TOKEN = 'short-secret-sentinel';
  try {
    const diagnostic = formatRoomAppServiceSetupDiagnostic(
      report('Error: rejected short-secret-sentinel'),
      'room-appservice-setup-start\n',
    );
    assert.equal(diagnostic.includes('short-secret-sentinel'), false);
    assert.match(diagnostic, /message="unclassified"/);
  } finally {
    if (previous === undefined) {
      delete process.env.MATRIX_APPLICATION_SERVICE_TOKEN;
    } else {
      process.env.MATRIX_APPLICATION_SERVICE_TOKEN = previous;
    }
  }
});
