import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDesktopPolicyArguments,
  createJourneyChildEnvironment,
  createSystemCommandEnvironment,
  parseStartupProgressRecord,
  selectAvailableProbeUid,
  selectPinnedPackageHash,
  validateDefaultPolicyPort,
  validateJourneyPolicyPorts,
} from './element-desktop-journey-runner.mjs';

const PACKAGE_HASH = 'a'.repeat(64);

test('accepts only bounded Desktop startup progress records', () => {
  assert.deepEqual(
    parseStartupProgressRecord(
      '{"phase":"desktop-startup-progress","milestone":"before-app"}',
    ),
    { phase: 'desktop-startup-progress', milestone: 'before-app' },
  );
  assert.deepEqual(
    parseStartupProgressRecord(
      JSON.stringify({
        phase: 'desktop-startup-progress',
        milestone: 'after-page-load',
        appPid: 12,
        cdpRendererHandoff: {
          overflow: false,
          pids: [13],
          rendererCount: 1,
          state: 'observed',
        },
      }),
    ),
    {
      phase: 'desktop-startup-progress',
      milestone: 'after-page-load',
      appPid: 12,
      cdpRendererHandoff: {
        overflow: false,
        pids: [13],
        rendererCount: 1,
        state: 'observed',
      },
    },
  );

  for (const line of [
    '{"phase":"desktop-startup-progress","milestone":"before-app","url":"vector://private"}',
    '{"phase":"desktop-startup-progress","milestone":"desktop-journey-ready","pid":12}',
    JSON.stringify({
      phase: 'desktop-startup-progress',
      milestone: 'after-app-spawn',
      appPid: 1,
    }),
    JSON.stringify({
      phase: 'desktop-startup-progress',
      milestone: 'after-page-load',
      appPid: 12,
      cdpRendererHandoff: {
        overflow: false,
        pids: [12, 12],
        rendererCount: 2,
        state: 'observed',
      },
    }),
    'x'.repeat(8_193),
  ]) {
    assert.equal(parseStartupProgressRecord(line), undefined);
  }
});

test('keeps the journey CDP port distinct from every fixed loopback service', () => {
  assert.equal(validateJourneyPolicyPorts(42_424), true);
  for (const port of [8_008, 3_000, 8_080, 1_023, 65_536, 42_424.5]) {
    assert.equal(validateJourneyPolicyPorts(port), false);
  }
});

test('preserves default and journey egress profile command grammars', () => {
  const common = {
    uid: 24_001,
    runId: '12345',
    cdpPort: 42_424,
  };
  const startupState = { ...common, journey: false };
  const journeyState = { ...common, journey: true };

  assert.deepEqual(buildDesktopPolicyArguments(startupState, 'install'), [
    'install',
    '24001',
    '12345',
    '42424',
  ]);
  assert.deepEqual(
    buildDesktopPolicyArguments(startupState, 'negative-self-test', [
      '/tmp/private/policy.mjs',
    ]),
    [
      'negative-self-test',
      '24001',
      '12345',
      '42424',
      '/tmp/private/policy.mjs',
    ],
  );
  assert.deepEqual(buildDesktopPolicyArguments(startupState, 'zero-counters'), [
    'zero-counters',
    '24001',
    '12345',
    '42424',
  ]);
  assert.deepEqual(buildDesktopPolicyArguments(startupState, 'counters'), [
    'counters',
    '24001',
    '12345',
    '42424',
  ]);
  assert.deepEqual(buildDesktopPolicyArguments(startupState, 'remove'), [
    'remove',
    '24001',
    '12345',
  ]);

  for (const command of [
    'install',
    'negative-self-test',
    'zero-counters',
    'counters',
  ]) {
    const argumentsForJourney = buildDesktopPolicyArguments(
      journeyState,
      command,
      command === 'negative-self-test' ? ['/tmp/private/policy.mjs'] : [],
    );
    assert.equal(argumentsForJourney.at(-1), '--journey');
  }
  assert.deepEqual(buildDesktopPolicyArguments(journeyState, 'remove'), [
    'remove',
    '24001',
    '12345',
  ]);
});

test('keeps the default CDP port distinct from the Matrix fixture', () => {
  assert.equal(validateDefaultPolicyPort(42_424), true);
  for (const port of [8_008, 1_023, 65_536, 42_424.5]) {
    assert.equal(validateDefaultPolicyPort(port), false);
  }
});

test('selects the first unused UID from one bounded account snapshot', () => {
  assert.equal(
    selectAvailableProbeUid('root:x:0:0:root:/root:/bin/bash\n'),
    24_000,
  );
  assert.equal(
    selectAvailableProbeUid(
      'runner:x:24000:0:runner:/home/runner:/bin/bash\nother:x:24002:0::/:/usr/sbin/nologin\n',
    ),
    24_001,
  );
  assert.equal(selectAvailableProbeUid('', '24000\n24002\n'), 24_001);
  assert.equal(selectAvailableProbeUid(''), 24_000);
});

test('passes only fixed Desktop journey paths and excludes fixture secrets', () => {
  const environment = createJourneyChildEnvironment(
    {
      HOME: '/home/runner',
      PATH: '/usr/local/bin:/usr/bin:/bin',
      MATRIX_APPLICATION_SERVICE_TOKEN: 'private-service-token',
      MATRIX_CALENDAR_DEV_PASSWORD: 'private-homeserver-password',
      PLAYWRIGHT_BROWSERS_PATH: '/home/runner/.cache/ms-playwright',
    },
    {
      runnerTemp: '/tmp/runner',
      workspace: '/home/runner/work/repo/repo',
      journeyStageFile: '/tmp/runner/journey.jsonl',
      playwrightOutput: '/tmp/runner/playwright-output',
      usersFile: '/tmp/runner/users.json',
      credentialsFile: '/tmp/runner/desktop-credentials.json',
    },
    { sourceSha: 'b'.repeat(40), cdpPort: 42_424 },
  );

  assert.deepEqual(Object.keys(environment).sort(), [
    'CI',
    'ELEMENT_ACCEPTANCE_DESKTOP_CREDENTIALS_FILE',
    'ELEMENT_ACCEPTANCE_USERS_FILE',
    'ELEMENT_DESKTOP_CDP_PORT',
    'ELEMENT_DESKTOP_JOURNEY_PLAYWRIGHT_OUTPUT',
    'ELEMENT_DESKTOP_JOURNEY_STAGE_FILE',
    'ELEMENT_DESKTOP_SOURCE_SHA',
    'GITHUB_WORKSPACE',
    'HOME',
    'PATH',
    'PLAYWRIGHT_BROWSERS_PATH',
    'RUNNER_TEMP',
    'TMPDIR',
  ]);
  assert.equal(
    JSON.stringify(environment).includes('private-service-token'),
    false,
  );
  assert.equal(
    JSON.stringify(environment).includes('private-homeserver-password'),
    false,
  );
  assert.equal(environment.ELEMENT_DESKTOP_CDP_PORT, '42424');
  assert.equal(environment.TMPDIR, '/tmp/runner');
});

test('keeps fixture credentials out of native command environments', () => {
  const environment = createSystemCommandEnvironment({
    HOME: '/home/runner',
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    PATH: '/usr/local/bin:/usr/bin:/bin',
    RUNNER_TEMP: '/tmp/runner',
    MATRIX_APPLICATION_SERVICE_TOKEN: 'private-service-token',
    MATRIX_CALENDAR_DEV_PASSWORD: 'private-homeserver-password',
    ELEMENT_ACCEPTANCE_DESKTOP_CREDENTIALS_FILE: '/tmp/runner/credentials.json',
  });

  assert.deepEqual(environment, {
    HOME: '/home/runner',
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    PATH: '/usr/local/bin:/usr/bin:/bin',
    TMPDIR: '/tmp/runner',
  });
});

test('selects exactly one pinned amd64 Element Desktop package hash', () => {
  const block = [
    'Package: element-desktop',
    'Version: 1.12.30',
    'Architecture: amd64',
    `SHA256: ${PACKAGE_HASH}`,
  ].join('\n');
  assert.equal(selectPinnedPackageHash(block), PACKAGE_HASH);
  assert.throws(
    () => selectPinnedPackageHash(`${block}\n\n${block}`),
    /Element Desktop journey runner failed/u,
  );
  assert.throws(
    () =>
      selectPinnedPackageHash(
        block.replace('Version: 1.12.30', 'Version: 1.12.31'),
      ),
    /Element Desktop journey runner failed/u,
  );
  assert.throws(
    () => selectPinnedPackageHash(block.replace(PACKAGE_HASH, 'invalid')),
    /Element Desktop journey runner failed/u,
  );
  assert.throws(
    () => selectPinnedPackageHash(`${block}\nSHA256: ${PACKAGE_HASH}`),
    /Element Desktop journey runner failed/u,
  );
});
