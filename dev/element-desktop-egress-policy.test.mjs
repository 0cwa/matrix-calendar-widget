import assert from 'node:assert/strict';
import test from 'node:test';

import { policySpec } from './element-desktop-egress-policy.mjs';

test('desktop egress permits only the fixture homeserver and loopback CDP ports', () => {
  const [ipv4, ipv6] = policySpec(42_420, '7315', 9_223);

  assert.deepEqual(ipv4.hook, [
    '-m',
    'owner',
    '--uid-owner',
    '42420',
    '-j',
    'MCWD_7315_4',
  ]);
  assert.deepEqual(ipv6.hook, [
    '-m',
    'owner',
    '--uid-owner',
    '42420',
    '-j',
    'MCWD_7315_6',
  ]);
  assert.deepEqual(ipv4.chainRules, [
    [
      '-o',
      'lo',
      '-m',
      'conntrack',
      '--ctstate',
      'ESTABLISHED,RELATED',
      '-j',
      'ACCEPT',
    ],
    [
      '-o',
      'lo',
      '-p',
      'tcp',
      '-d',
      '127.0.0.1/32',
      '-m',
      'multiport',
      '--dports',
      '8008,9223',
      '-m',
      'conntrack',
      '--ctstate',
      'NEW',
      '-j',
      'ACCEPT',
    ],
    ['-j', 'DROP'],
  ]);
  assert.deepEqual(ipv6.chainRules, [
    [
      '-o',
      'lo',
      '-m',
      'conntrack',
      '--ctstate',
      'ESTABLISHED,RELATED',
      '-j',
      'ACCEPT',
    ],
    [
      '-o',
      'lo',
      '-p',
      'tcp',
      '-d',
      '::1/128',
      '-m',
      'multiport',
      '--dports',
      '8008,9223',
      '-m',
      'conntrack',
      '--ctstate',
      'NEW',
      '-j',
      'ACCEPT',
    ],
    ['-j', 'DROP'],
  ]);
});

test('desktop egress rejects invalid identifiers and a CDP port that shadows Synapse', () => {
  assert.throws(() => policySpec(0, '7315', 9_223), /invalid policy input/u);
  assert.throws(
    () => policySpec(42_420, '../7315', 9_223),
    /invalid policy input/u,
  );
  assert.throws(
    () => policySpec(42_420, '7315', 8008),
    /invalid policy input/u,
  );
  assert.throws(() => policySpec(42_420, '7315', 80), /invalid policy input/u);
});
