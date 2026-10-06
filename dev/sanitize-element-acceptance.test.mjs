import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeElementAcceptance } from './sanitize-element-acceptance.mjs';

const sourceSha = 'a'.repeat(40);

test('emits only fixed phase names, results, HTTP statuses, counts, and source SHA', () => {
  const summary = sanitizeElementAcceptance(
    [
      JSON.stringify({ phase: 'accounts-ready', status: 'passed', count: 3 }),
      JSON.stringify({
        phase: 'outsider-room-widget-team-target',
        status: 'passed',
        httpStatus: 403,
      }),
      JSON.stringify({
        phase: 'outsider-own-unbound-room',
        status: 'passed',
        httpStatus: 404,
      }),
      JSON.stringify({
        phase: 'stale-etag-conflict',
        status: 'passed',
        httpStatus: 409,
      }),
    ].join('\n'),
    sourceSha,
  );

  assert.equal(
    summary,
    [
      `element-acceptance source_sha=${sourceSha}`,
      'phase=accounts-ready status=passed count=3',
      'phase=outsider-room-widget-team-target status=passed http_status=403',
      'phase=outsider-own-unbound-room status=passed http_status=404',
      'phase=stale-etag-conflict status=passed http_status=409',
      '',
    ].join('\n'),
  );
});

test('rejects unexpected fields without reflecting their values', () => {
  const secret = 'synthetic-secret-that-must-not-be-reported';
  assert.throws(
    () =>
      sanitizeElementAcceptance(
        JSON.stringify({
          phase: 'accounts-ready',
          status: 'failed',
          secret,
        }),
        sourceSha,
      ),
    { message: 'invalid element acceptance summary' },
  );
});

test('rejects invalid phases, HTTP statuses, and source revisions', () => {
  assert.throws(
    () =>
      sanitizeElementAcceptance(
        JSON.stringify({ phase: 'unknown', status: 'passed' }),
        sourceSha,
      ),
    { message: 'invalid element acceptance summary' },
  );
  assert.throws(
    () =>
      sanitizeElementAcceptance(
        JSON.stringify({
          phase: 'stale-etag-conflict',
          status: 'passed',
          httpStatus: 0,
        }),
        sourceSha,
      ),
    { message: 'invalid element acceptance summary' },
  );
  assert.throws(() => sanitizeElementAcceptance('', 'not-a-commit'), {
    message: 'invalid element acceptance summary',
  });
});
