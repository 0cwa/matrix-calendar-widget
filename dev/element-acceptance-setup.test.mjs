import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRegisterUserArgs } from './element-acceptance-setup.mjs';

test('selects non-admin mode for non-interactive fixture registration', () => {
  const args = buildRegisterUserArgs(
    'mcw-element-acceptance-test',
    'element-fixture-user',
  );

  assert.ok(args.includes('--no-admin'));
  assert.ok(args.indexOf('--password-file') < args.indexOf('--no-admin'));
  assert.equal(args.includes('-a'), false);
  assert.equal(args.includes('--admin'), false);
});
