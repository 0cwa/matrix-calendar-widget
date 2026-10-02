import assert from 'node:assert/strict';
import test from 'node:test';

import { formatContractPhase } from './sanitize-caldav-contract-stage.mjs';

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
