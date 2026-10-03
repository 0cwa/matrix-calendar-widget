import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatContractPhase,
  formatPersonalOpenIdJestSetup,
  formatPersonalOpenIdProbeLaunch,
  formatPersonalOpenIdRunnerReady,
  formatPersonalOpenIdSetupFailure,
  formatPersonalOpenIdSetupStage,
  formatPersonalOpenIdSetupStart,
  formatPersonalOpenIdSetupStatus,
  formatPersonalOpenIdSuiteLoaded,
  formatPersonalOpenIdSuiteRegistration,
  formatRoomAppServiceListingCheckpoint,
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

test('reports only whether the personal OpenID suite module loaded', () => {
  assert.equal(
    formatPersonalOpenIdSuiteLoaded('personal-openid-setup-start\n'),
    'personal-openid-suite not-reached\n',
  );
  assert.equal(
    formatPersonalOpenIdSuiteLoaded(
      'personal-openid-suite-loaded\npersonal-openid-setup-start\n',
    ),
    'personal-openid-suite loaded\n',
  );
});

test('reports only whether Personal OpenID suite registration completed', () => {
  assert.equal(
    formatPersonalOpenIdSuiteRegistration('personal-openid-suite-loaded\n'),
    'personal-openid-suite-registration not-reached\n',
  );
  assert.equal(
    formatPersonalOpenIdSuiteRegistration(
      'personal-openid-suite-registered\nprivate-event-data',
    ),
    'personal-openid-suite-registration registered\n',
  );
  assert.equal(
    formatPersonalOpenIdSuiteRegistration(
      'personal-openid-suite-registered private-event-data',
    ),
    'personal-openid-suite-registration not-reached\n',
  );
});

test('reports only whether the Personal OpenID Jest runner reached setupFilesAfterEnv', () => {
  assert.equal(
    formatPersonalOpenIdRunnerReady('personal-openid-suite-loaded\n'),
    'personal-openid-runner not-reached\n',
  );
  assert.equal(
    formatPersonalOpenIdRunnerReady('personal-openid-runner-ready\n'),
    'personal-openid-runner ready\n',
  );
});

test('reports only whether the probe command launched', () => {
  assert.equal(
    formatPersonalOpenIdProbeLaunch('personal-openid-suite-loaded\n'),
    'personal-openid-probe not-launched\n',
  );
  assert.equal(
    formatPersonalOpenIdProbeLaunch('personal-openid-probe-launched\n'),
    'personal-openid-probe launched\n',
  );
});

test('reports only whether Jest setupFilesAfterEnv loaded for the probe', () => {
  assert.equal(
    formatPersonalOpenIdJestSetup('personal-openid-probe-launched\n'),
    'personal-openid-jest-setup not-reached\n',
  );
  assert.equal(
    formatPersonalOpenIdJestSetup(
      'personal-openid-jest-setup-loaded\nprivate-diagnostic-data',
    ),
    'personal-openid-jest-setup loaded\n',
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
