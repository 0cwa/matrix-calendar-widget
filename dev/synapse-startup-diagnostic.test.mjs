import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  classifySynapseStartupLines,
  formatStartupDiagnostic,
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
    'category=unclassified exit_code=1 oom=false',
  );
  assert.equal(
    formatStartupDiagnostic(arbitrary, { exitCode: '1', oom: arbitrary }),
    'category=unclassified exit_code=unavailable oom=unavailable',
  );
});

test('accepts only numeric exit code and boolean OOM state from inspect output', () => {
  assert.deepEqual(parseContainerState('1 false\n'), { exitCode: 1, oom: 'false' });
  assert.deepEqual(parseContainerState('0 true'), { exitCode: 0, oom: 'true' });
  assert.deepEqual(parseContainerState('1 false extra'), {
    exitCode: 'unavailable',
    oom: 'unavailable',
  });
});
