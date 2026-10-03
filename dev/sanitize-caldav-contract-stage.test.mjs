import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatContractPhase,
  formatPersonalOpenIdSetupFailure,
  formatPersonalOpenIdSetupHttpStatus,
  formatPersonalOpenIdSetupMatrixErrorCode,
  formatPersonalOpenIdSetupStage,
  formatPersonalOpenIdSetupStart,
  formatPersonalOpenIdSetupStatus,
  formatRoomAppServiceCaseBodyCount,
  formatRoomAppServiceListingCheckpoint,
  formatRoomAppServiceSetupStage,
  formatRoomAppServiceSetupStart,
  formatRoomAppServiceSetupStatus,
} from './sanitize-caldav-contract-stage.mjs';

test('emits only the latest fixed phase from the closed allowlist', () => {
  const content = [
    'unrecognized phase with arbitrary diagnostic data',
    'period-resource-created',
    'period-target-validated',
    'period-patch-applied',
    'period-update-started',
    'period-removal-verified extra text',
  ].join('\n');

  assert.equal(
    formatContractPhase(content),
    'contract-phase period-update-started\n',
  );

  for (const phase of [
    'period-target-validated',
    'period-patch-applied',
    'period-update-started',
  ]) {
    assert.equal(formatContractPhase(phase), `contract-phase ${phase}\n`);
  }
});

test('does not emit arbitrary phase names or data', () => {
  const content = [
    'response body must remain private',
    'seed-put-http-500',
    'unexpected-dynamic-phase',
  ].join('\n');

  const output = formatContractPhase(content);

  assert.equal(output, '');
  assert.doesNotMatch(
    output,
    /response body|seed-put-http|unexpected-dynamic-phase/,
  );
});

test('reports only whether RoomAppService beforeAll completed', () => {
  assert.equal(
    formatRoomAppServiceSetupStatus('period-removal-verified\n'),
    'room-appservice-setup not-reached\n',
  );
  assert.equal(
    formatRoomAppServiceSetupStatus(
      'room-appservice-setup-complete\nperiod-removal-verified\n',
    ),
    'room-appservice-setup complete\n',
  );
});

test('reports the latest fixed RoomAppService setup stage', () => {
  assert.equal(
    formatRoomAppServiceSetupStage(
      [
        'room-appservice-setup-stage-register-service-user',
        'room-appservice-setup-stage-create-room-one',
      ].join('\n'),
    ),
    'room-appservice-setup-stage create-room-one\n',
  );
  assert.equal(
    formatRoomAppServiceSetupStage(
      'room-appservice-setup-stage-private-room-and-token',
    ),
    '',
  );
});

test('reports whether room contract test bodies started', () => {
  assert.equal(
    formatRoomAppServiceSetupStart('room-appservice-setup-start\n'),
    'room-appservice-setup-start reached\n',
  );
  assert.equal(
    formatRoomAppServiceSetupStart(''),
    'room-appservice-setup-start not-reached\n',
  );
  assert.equal(
    formatRoomAppServiceCaseBodyCount(
      [
        'room-appservice-case-start-exact-binding',
        'room-appservice-case-start-cross-room-denial',
        'room-appservice-case-start-unknown-private-value',
      ].join('\n'),
    ),
    'room-appservice-test-bodies started=2/3\n',
  );
});

test('reports only whether the personal OpenID beforeAll completed', () => {
  assert.equal(
    formatPersonalOpenIdSetupStatus('period-removal-verified\n'),
    'personal-openid-setup not-reached\n',
  );
  assert.equal(
    formatPersonalOpenIdSetupStatus('personal-openid-setup-complete\n'),
    'personal-openid-setup complete\n',
  );
});

test('reports only whether the personal OpenID beforeAll started', () => {
  assert.equal(
    formatPersonalOpenIdSetupStart('period-removal-verified\n'),
    'personal-openid-setup-start not-reached\n',
  );
  assert.equal(
    formatPersonalOpenIdSetupStart(
      'personal-openid-setup-start\npersonal-openid-setup-complete\n',
    ),
    'personal-openid-setup-start reached\n',
  );
});

test('emits only the latest fixed personal OpenID setup stage', () => {
  assert.equal(
    formatPersonalOpenIdSetupStage(
      [
        'personal-openid-setup-stage-actor-login',
        'personal-openid-setup-stage-create-personal-room',
        'personal-openid-setup-stage-nonmember-openid-proof',
      ].join('\n'),
    ),
    'personal-openid-setup-stage nonmember-openid-proof\n',
  );
});

test('does not emit arbitrary personal OpenID setup stages or values', () => {
  const privateSentinel =
    'personal-openid-setup-stage-private-user-id-and-event-data';
  const output = formatPersonalOpenIdSetupStage(privateSentinel);

  assert.equal(output, '');
  assert.equal(output.includes(privateSentinel), false);
});

test('emits only a closed nonmember login failure category', () => {
  for (const category of [
    'transport',
    'http-status',
    'json-or-token-parse',
    'other',
  ]) {
    assert.equal(
      formatPersonalOpenIdSetupFailure(
        `personal-openid-setup-failure-${category}\n`,
      ),
      `personal-openid-setup-failure ${category}\n`,
    );
  }
});

test('fails closed for unknown login failure categories and attached data', () => {
  const privateSentinel =
    'personal-openid-setup-failure-http-status-401-private-response';
  const output = formatPersonalOpenIdSetupFailure(
    `${privateSentinel}\npersonal-openid-setup-failure-unknown-token\n`,
  );

  assert.equal(output, '');
  assert.equal(output.includes(privateSentinel), false);
});

test('reports only bounded Personal OpenID HTTP status and known Matrix codes', () => {
  assert.equal(
    formatPersonalOpenIdSetupHttpStatus(
      'personal-openid-http-status-403\npersonal-openid-http-status-999\n',
    ),
    'personal-openid-http-status 403\n',
  );
  assert.equal(
    formatPersonalOpenIdSetupHttpStatus(
      'personal-openid-http-status-200-private-data',
    ),
    '',
  );
  assert.equal(
    formatPersonalOpenIdSetupMatrixErrorCode(
      'personal-openid-matrix-error-M_FORBIDDEN\npersonal-openid-matrix-error-M_PRIVATE_TOKEN',
    ),
    'personal-openid-matrix-error M_FORBIDDEN\n',
  );
});

test('does not expose unknown stage data or accept a partial setup marker', () => {
  const privateSentinel = 'room-appservice-setup-complete private-event-data';
  const output = formatRoomAppServiceSetupStatus(privateSentinel);

  assert.equal(output, 'room-appservice-setup not-reached\n');
  assert.equal(output.includes(privateSentinel), false);
});

test('emits only the latest fixed RoomAppService listing checkpoint', () => {
  assert.equal(
    formatRoomAppServiceListingCheckpoint(
      [
        'room-appservice-listing-room-one-response-status',
        'room-appservice-listing-room-one-event-summary',
        'room-appservice-listing-room-two-response-json-parsed',
      ].join('\n'),
    ),
    'room-appservice-listing room-two-response-json-parsed\n',
  );
});

test('does not emit unknown RoomAppService checkpoint text', () => {
  const privateSentinel = 'room-appservice-listing-private-user-event-details';
  const output = formatRoomAppServiceListingCheckpoint(privateSentinel);

  assert.equal(output, '');
  assert.equal(output.includes(privateSentinel), false);
});
