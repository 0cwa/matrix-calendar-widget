import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  classifySynapseStartupLines,
  formatStartupDiagnostic,
  formatStartupStageFailure,
  parseContainerInspectResult,
  parseContainerListResult,
  parseContainerState,
} from './synapse-startup-diagnostic.mjs';

test('classifies only explicit fixed startup failure signatures', () => {
  const cases = [
    [
      'registration-config',
      'Invalid application service registration configuration',
    ],
    ['homeserver-config', 'ConfigError: invalid homeserver setting'],
    ['database', 'sqlite3.OperationalError: database is locked'],
    ['permission', 'PermissionError: permission denied'],
    ['bind', 'OSError: Address already in use'],
    ['application', 'Failed to start Synapse'],
  ];

  for (const [expected, line] of cases) {
    assert.equal(classifySynapseStartupLines([line]), expected);
  }
});

test('keeps ambiguous and arbitrary log content unclassified', () => {
  const arbitrary = 'opaque startup failure arbitrary-sentinel';
  const result = classifySynapseStartupLines([arbitrary]);

  assert.equal(result, 'unclassified');
  assert.equal(
    formatStartupDiagnostic(result, { exitCode: 1, oom: 'false' }),
    'category=unclassified inspect_result=unavailable state=unavailable health=unavailable exit_code=1 oom=false',
  );
  assert.equal(
    formatStartupDiagnostic(arbitrary, { exitCode: '1', oom: arbitrary }),
    'category=unclassified inspect_result=unavailable state=unavailable health=unavailable exit_code=unavailable oom=unavailable',
  );
});

test('distinguishes Compose list failures, missing IDs, and malformed IDs', () => {
  assert.equal(
    parseContainerListResult({ status: 1, stdout: 'private output' })
      .inspectResult,
    'compose-list-failed',
  );
  assert.equal(
    parseContainerListResult({
      error: new Error('private output'),
      status: 0,
      stdout: '0123456789abcdef',
    }).inspectResult,
    'compose-list-failed',
  );
  assert.equal(
    parseContainerListResult({ status: 0, stdout: '' }).inspectResult,
    'container-id-missing',
  );
  assert.equal(
    parseContainerListResult({ status: 0, stdout: 'private output' })
      .inspectResult,
    'container-id-malformed',
  );
  assert.equal(
    parseContainerListResult({ status: 0, stdout: '0123456789abcdef' })
      .inspectResult,
    'ok',
  );
});

test('distinguishes inspect failure from invalid data and accepts only allowlisted state', () => {
  assert.equal(
    parseContainerInspectResult({ status: 1, stdout: 'private output' })
      .inspectResult,
    'inspect-failed',
  );
  assert.equal(
    parseContainerInspectResult({
      error: new Error('private output'),
      status: 0,
      stdout: 'exited 1 false none',
    }).inspectResult,
    'inspect-failed',
  );
  const invalidInspectData = [
    'unrecognized 1 false none',
    'exited 256 false none',
    'exited -1 false none',
    'exited 1 maybe none',
    'exited 1 false secret',
    'exited 1 false none extra',
  ];
  for (const inspectData of invalidInspectData) {
    assert.equal(
      parseContainerState(inspectData).inspectResult,
      'inspect-data-invalid',
    );
  }
  assert.deepEqual(
    parseContainerInspectResult({
      status: 0,
      stdout: 'exited 1 false none\n',
    }),
    {
      inspectResult: 'ok',
      state: 'exited',
      health: 'not-reported',
      exitCode: 1,
      oom: 'false',
    },
  );
  assert.deepEqual(parseContainerState('running 0 true healthy'), {
    inspectResult: 'ok',
    state: 'running',
    health: 'healthy',
    exitCode: 0,
    oom: 'true',
  });
});

test('formats only fixed diagnostic enums and validated scalar values', () => {
  const formatted = formatStartupDiagnostic('private category', {
    inspectResult: 'private inspect result',
    state: 'private state',
    health: 'private health',
    exitCode: 1,
    oom: 'private oom',
  });
  assert.equal(
    formatted,
    'category=unclassified inspect_result=unavailable state=unavailable health=unavailable exit_code=1 oom=unavailable',
  );
  assert.equal(formatted.includes('private'), false);
  assert.equal(
    formatStartupDiagnostic('permission', {
      inspectResult: 'ok',
      state: 'exited',
      health: 'not-reported',
      exitCode: 3,
      oom: false,
    }),
    'category=permission inspect_result=ok state=exited health=not-reported exit_code=3 oom=false',
  );
});

test('formats only allowlisted startup stages and bounded exit codes', () => {
  const stages = [
    'docker-preflight',
    'curl-preflight',
    'homeserver-probe',
    'homeserver-generate',
    'fixture-permission',
    'registration-update',
    'uid991-access-assertion',
    'synapse-compose-start',
  ];
  for (const stage of stages) {
    assert.equal(
      formatStartupStageFailure(stage, 0),
      `stage=${stage} exit_code=0`,
    );
    assert.equal(
      formatStartupStageFailure(stage, '255'),
      `stage=${stage} exit_code=255`,
    );
  }

  const invalidInputs = [
    ['private-stage arbitrary-sentinel', '1'],
    ['uid991-access-assertion', '1 arbitrary-sentinel'],
    ['uid991-access-assertion', '-1'],
    ['uid991-access-assertion', '256'],
    ['uid991-access-assertion', Number.NaN],
  ];
  for (const [stage, exitCode] of invalidInputs) {
    assert.equal(formatStartupStageFailure(stage, exitCode), undefined);
  }
});
