import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatContractPhase,
  formatPersonalOpenIdSetupStatus,
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
