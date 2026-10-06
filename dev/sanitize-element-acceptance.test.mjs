import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeElementAcceptance } from './sanitize-element-acceptance.mjs';

const sourceSha = 'a'.repeat(40);

test('emits only fixed phase names, outcomes, and source SHA', () => {
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

test('emits bounded setup substeps and numeric failure details', () => {
  const summary = sanitizeElementAcceptance(
    [
      JSON.stringify({
        phase: 'member-a-registration',
        status: 'failed',
        failureCode: 'docker-command-failed',
        processExitCode: 1,
      }),
      JSON.stringify({
        phase: 'member-a-login',
        status: 'failed',
        failureCode: 'matrix-http-failed',
        httpStatus: 401,
      }),
    ].join('\n'),
    sourceSha,
  );

  assert.equal(
    summary,
    [
      `element-acceptance source_sha=${sourceSha}`,
      'phase=member-a-registration status=failed failure_code=docker-command-failed process_exit_code=1',
      'phase=member-a-login status=failed http_status=401 failure_code=matrix-http-failed',
      '',
    ].join('\n'),
  );
});

test('labels configured service tags and observed browser and runner versions', () => {
  const summary = sanitizeElementAcceptance(
    JSON.stringify({
      phase: 'runtime-versions',
      status: 'passed',
      elementWebConfiguredTag: 'v1.12.30',
      synapseConfiguredTag: 'v1.161.0',
      radicaleConfiguredTag: '3.8.0.0',
      chromiumVersion: '140.0.7339.80',
      runnerOS: 'linux',
      runnerOSVersion: '6.8.0-1027-azure',
      runnerArchitecture: 'x64',
      nodeVersion: 'v22.23.3',
    }),
    sourceSha,
  );

  assert.equal(
    summary,
    [
      `element-acceptance source_sha=${sourceSha}`,
      'phase=runtime-versions status=passed element_web_configured_tag=v1.12.30 synapse_configured_tag=v1.161.0 radicale_configured_tag=3.8.0.0 chromium_observed=140.0.7339.80 runner_os=linux kernel_release=6.8.0-1027-azure runner_arch=x64 node_observed=v22.23.3',
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

test('rejects arbitrary failure labels, invalid exit codes, and untrusted versions', () => {
  const rejectedRecords = [
    {
      phase: 'member-a-registration',
      status: 'failed',
      failureCode: 'password=synthetic-secret',
      processExitCode: 1,
    },
    {
      phase: 'member-a-registration',
      status: 'failed',
      failureCode: 'docker-command-failed',
      processExitCode: 256,
    },
    {
      phase: 'runtime-versions',
      status: 'passed',
      elementWebConfiguredTag: 'v1.12.30',
      synapseConfiguredTag: 'v1.161.0',
      radicaleConfiguredTag: '3.8.0.0',
      chromiumVersion: '140.0.7339.80 token=secret',
      runnerOS: 'linux',
      runnerOSVersion: '6.8.0-1027-azure',
      runnerArchitecture: 'x64',
      nodeVersion: 'v22.23.3',
    },
  ];

  for (const record of rejectedRecords) {
    assert.throws(
      () => sanitizeElementAcceptance(JSON.stringify(record), sourceSha),
      { message: 'invalid element acceptance summary' },
    );
  }
});
