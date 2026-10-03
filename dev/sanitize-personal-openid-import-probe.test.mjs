import assert from 'node:assert/strict';
import test from 'node:test';
import { formatPersonalOpenIdImportProbe } from './sanitize-personal-openid-import-probe.mjs';

test('prints only the ordered allowlisted import IDs', () => {
  const stageContent = Array.from({ length: 16 }, (_, index) => {
    const id = String(index + 1).padStart(2, '0');
    return `personal-openid-import-${id} passed`;
  }).join('\n');
  const result = formatPersonalOpenIdImportProbe(`${stageContent}\n`);

  assert.deepEqual(result, {
    output: `${stageContent.split('\n').join('\n')}\n`,
    exitCode: 0,
  });
});

test('reports a fixed ID and status when an import fails', () => {
  const result = formatPersonalOpenIdImportProbe(
    'personal-openid-import-01 failed\n',
  );

  assert.deepEqual(result, {
    output: 'personal-openid-import-01 failed\n',
    exitCode: 1,
  });
});

test('does not treat a truncated success sequence as complete', () => {
  const result = formatPersonalOpenIdImportProbe(
    'personal-openid-import-01 passed\n',
  );

  assert.deepEqual(result, {
    output: 'personal-openid-import-probe incomplete\n',
    exitCode: 1,
  });
});

test('never emits unrecognized text or malformed markers', () => {
  const result = formatPersonalOpenIdImportProbe(
    'personal-openid-import-01 passed\nsecret-event-text\n',
  );

  assert.deepEqual(result, {
    output: 'personal-openid-import-probe unclassified\n',
    exitCode: 1,
  });
  assert.equal(result.output.includes('secret-event-text'), false);
});

test('reports a fixed not-reached marker when no import status was written', () => {
  assert.deepEqual(formatPersonalOpenIdImportProbe(''), {
    output: 'personal-openid-import-probe not-reached\n',
    exitCode: 1,
  });
});
