/*
 * Copyright 2026 Matrix Calendar Widget contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  appendComposeOverrideFiles,
  appendLocalComposeEnvFile,
  DEFAULT_RADICALE_IMAGE,
  hasLocalComposeResourceOwnership,
  loadElementAcceptanceOverrides,
  LOCAL_REHEARSAL_LABEL,
  withLocalNoPullComposeArgs,
  withLocalOwnedDockerRunArgs,
} from './element-acceptance-overrides.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('unset overrides preserve existing Compose arguments and image default', () => {
  const baseArguments = [
    'compose',
    '-p',
    'synthetic-acceptance',
    '-f',
    'dev/compose.yaml',
    'ps',
  ];
  const overrides = loadElementAcceptanceOverrides({}, ROOT);

  assert.deepEqual(overrides.composeFiles, []);
  assert.equal(overrides.skipElement, false);
  assert.deepEqual(
    appendComposeOverrideFiles(baseArguments, overrides.composeFiles),
    baseArguments,
  );
  assert.equal(overrides.radicaleImage, DEFAULT_RADICALE_IMAGE);
  assert.equal(
    withLocalNoPullComposeArgs(['up', '-d', 'synapse'], false)[0],
    'up',
  );
  assert.deepEqual(withLocalNoPullComposeArgs(['up', '-d', 'synapse'], false), [
    'up',
    '-d',
    'synapse',
  ]);
  assert.deepEqual(
    appendLocalComposeEnvFile(['compose', '-p', 'existing'], overrides),
    ['compose', '-p', 'existing'],
  );
});

test('local prebuilt controls bind private project, env, override, and endpoint inputs', (t) => {
  const runnerTemp = mkdtempSync(
    join(tmpdir(), 'mcw-local-prebuilt-overrides-'),
  );
  t.after(() => rmSync(runnerTemp, { recursive: true, force: true }));
  const configDirectory = join(runnerTemp, 'docker-config');
  const engineDirectory = join(runnerTemp, 'engine');
  mkdirSync(configDirectory, { mode: 0o700 });
  mkdirSync(engineDirectory, { mode: 0o700 });
  const overrideFile = join(runnerTemp, 'images.override.yaml');
  const envFile = join(runnerTemp, 'compose.env');
  writeFileSync(overrideFile, 'services: {}\n', { mode: 0o600 });
  writeFileSync(envFile, '\n', { mode: 0o600 });
  const runId = '0123456789abcdef';
  const environment = {
    MATRIX_CALENDAR_LOCAL_PREBUILT_REHEARSAL: 'true',
    ELEMENT_ACCEPTANCE_LOCAL_RUN_ID: runId,
    COMPOSE_PROJECT_NAME: `mcw-p0-${runId}`,
    ELEMENT_ACCEPTANCE_SKIP_ELEMENT: 'true',
    ELEMENT_ACCEPTANCE_COMPOSE_OVERRIDE_FILES: JSON.stringify([overrideFile]),
    MATRIX_CALENDAR_LOCAL_COMPOSE_OVERRIDE_FILE: overrideFile,
    MATRIX_CALENDAR_LOCAL_COMPOSE_ENV_FILE: envFile,
    ELEMENT_ACCEPTANCE_RADICALE_IMAGE:
      'matrix-calendar-widget/radicale-openid:archive-12-1',
    RUNNER_TEMP: runnerTemp,
    DOCKER_HOST: `unix://${join(engineDirectory, 'docker.sock')}`,
    DOCKER_CONFIG: configDirectory,
    MATRIX_CALENDAR_DEV_SYNAPSE_PORT_MAPPING: '127.0.0.1:8008:8008',
    MATRIX_CALENDAR_DEV_RADICALE_PORT_MAPPING: '127.0.0.1:5232:5232',
  };
  const controls = loadElementAcceptanceOverrides(environment, ROOT);

  assert.equal(controls.localPrebuilt, true);
  assert.equal(controls.runId, runId);
  assert.equal(controls.projectName, `mcw-p0-${runId}`);
  assert.equal(controls.composeOverrideFile, overrideFile);
  assert.equal(controls.composeEnvFile, envFile);
  assert.deepEqual(
    appendLocalComposeEnvFile(
      ['compose', '-p', controls.projectName],
      controls,
    ),
    ['compose', '--env-file', envFile, '-p', controls.projectName],
  );
  assert.deepEqual(
    withLocalNoPullComposeArgs(['up', '-d', 'synapse', 'radicale'], true),
    ['up', '--pull', 'never', '--no-build', '-d', 'synapse', 'radicale'],
  );
  assert.deepEqual(
    withLocalNoPullComposeArgs(['run', '--rm', 'synapse', 'generate'], true),
    ['run', '--pull', 'never', '--rm', 'synapse', 'generate'],
  );
  assert.deepEqual(
    withLocalNoPullComposeArgs(
      ['up', '--pull=never', '--no-build', '-d', 'widget'],
      true,
    ),
    ['up', '--pull=never', '--no-build', '-d', 'widget'],
  );
  assert.throws(
    () =>
      withLocalNoPullComposeArgs(['up', '--pull', 'missing', 'synapse'], true),
    /refuses Compose pulls/u,
  );
  assert.throws(
    () => withLocalNoPullComposeArgs(['up', '--build', 'radicale'], true),
    /refuses Compose builds/u,
  );
  assert.throws(
    () => withLocalNoPullComposeArgs(['build', 'radicale'], true),
    /refuses image builds and pulls/u,
  );
  assert.throws(
    () => withLocalNoPullComposeArgs(['pull', 'radicale'], true),
    /refuses image builds and pulls/u,
  );
  assert.deepEqual(
    withLocalOwnedDockerRunArgs(
      ['run', '--rm', '--network', 'none', 'radicale:archive-1-1'],
      controls,
      2,
    ),
    [
      'run',
      '--pull=never',
      '--label',
      `io.matrix-calendar-widget.local-rehearsal=${runId}`,
      '--name',
      `mcw-p0-${runId}-local-${runId}-2`,
      '--rm',
      '--network',
      'none',
      'radicale:archive-1-1',
    ],
  );
});

test('restore helper ownership checks accept matching overlay and Compose labels only', () => {
  const runId = '0123456789abcdef';
  const projectName = `mcw-p0-${runId}`;
  const serviceLabels = {
    [LOCAL_REHEARSAL_LABEL]: runId,
    'com.docker.compose.project': projectName,
    'com.docker.compose.service': 'radicale',
  };
  const volumeLabels = {
    [LOCAL_REHEARSAL_LABEL]: runId,
    'com.docker.compose.project': projectName,
    'com.docker.compose.volume': 'radicale-data',
  };

  assert.equal(
    hasLocalComposeResourceOwnership(serviceLabels, {
      runId,
      projectName,
      service: 'radicale',
    }),
    true,
  );
  assert.equal(
    hasLocalComposeResourceOwnership(volumeLabels, {
      runId,
      projectName,
      volume: 'radicale-data',
    }),
    true,
  );
  assert.equal(
    hasLocalComposeResourceOwnership(
      { ...serviceLabels, 'com.docker.compose.service': 'gateway' },
      { runId, projectName, service: 'radicale' },
    ),
    false,
  );
  assert.equal(
    hasLocalComposeResourceOwnership(
      { ...volumeLabels, [LOCAL_REHEARSAL_LABEL]: 'fedcba9876543210' },
      { runId, projectName, volume: 'radicale-data' },
    ),
    false,
  );
});

test('local prebuilt controls reject ambient contexts, env files, and non-loopback ports', (t) => {
  const runnerTemp = mkdtempSync(join(tmpdir(), 'mcw-local-prebuilt-invalid-'));
  t.after(() => rmSync(runnerTemp, { recursive: true, force: true }));
  const configDirectory = join(runnerTemp, 'docker-config');
  mkdirSync(configDirectory, { mode: 0o700 });
  const overrideFile = join(runnerTemp, 'images.override.yaml');
  const envFile = join(runnerTemp, 'compose.env');
  writeFileSync(overrideFile, 'services: {}\n', { mode: 0o600 });
  writeFileSync(envFile, '\n', { mode: 0o600 });
  const runId = 'fedcba9876543210';
  const baseEnvironment = {
    MATRIX_CALENDAR_LOCAL_PREBUILT_REHEARSAL: 'true',
    ELEMENT_ACCEPTANCE_LOCAL_RUN_ID: runId,
    COMPOSE_PROJECT_NAME: `mcw-p0-${runId}`,
    ELEMENT_ACCEPTANCE_SKIP_ELEMENT: 'true',
    ELEMENT_ACCEPTANCE_COMPOSE_OVERRIDE_FILES: JSON.stringify([overrideFile]),
    MATRIX_CALENDAR_LOCAL_COMPOSE_OVERRIDE_FILE: overrideFile,
    MATRIX_CALENDAR_LOCAL_COMPOSE_ENV_FILE: envFile,
    ELEMENT_ACCEPTANCE_RADICALE_IMAGE:
      'matrix-calendar-widget/radicale-openid:archive-12-1',
    RUNNER_TEMP: runnerTemp,
    DOCKER_HOST: `unix://${join(runnerTemp, 'engine', 'docker.sock')}`,
    DOCKER_CONFIG: configDirectory,
    MATRIX_CALENDAR_DEV_SYNAPSE_PORT_MAPPING: '127.0.0.1:8008:8008',
    MATRIX_CALENDAR_DEV_RADICALE_PORT_MAPPING: '127.0.0.1:5232:5232',
  };
  mkdirSync(join(runnerTemp, 'engine'), { mode: 0o700 });

  for (const environment of [
    { ...baseEnvironment, DOCKER_CONTEXT: '' },
    { ...baseEnvironment, COMPOSE_PROFILES: 'element' },
    {
      ...baseEnvironment,
      DOCKER_HOST: 'unix:///var/run/docker.sock',
    },
    {
      ...baseEnvironment,
      MATRIX_CALENDAR_DEV_SYNAPSE_PORT_MAPPING: '0.0.0.0:8008:8008',
    },
    { ...baseEnvironment, COMPOSE_PROJECT_NAME: 'mcw-p0-other' },
    {
      ...baseEnvironment,
      ELEMENT_ACCEPTANCE_SKIP_ELEMENT: 'false',
    },
    {
      ...baseEnvironment,
      ELEMENT_ACCEPTANCE_RADICALE_IMAGE:
        'matrix-calendar-widget/radicale-openid:3.8.0.0',
    },
    {
      ...baseEnvironment,
      ELEMENT_ACCEPTANCE_RADICALE_IMAGE: undefined,
    },
  ]) {
    assert.throws(
      () => loadElementAcceptanceOverrides(environment, ROOT),
      /Local prebuilt rehearsal controls are invalid/u,
    );
  }
});

test('Element skip accepts only explicit lowercase boolean values', () => {
  assert.equal(
    loadElementAcceptanceOverrides(
      { ELEMENT_ACCEPTANCE_SKIP_ELEMENT: 'true' },
      ROOT,
    ).skipElement,
    true,
  );
  assert.equal(
    loadElementAcceptanceOverrides(
      { ELEMENT_ACCEPTANCE_SKIP_ELEMENT: 'false' },
      ROOT,
    ).skipElement,
    false,
  );

  for (const value of ['', 'TRUE', 'False', '1', 'yes', ' true', 'false\n']) {
    assert.throws(
      () =>
        loadElementAcceptanceOverrides(
          { ELEMENT_ACCEPTANCE_SKIP_ELEMENT: value },
          ROOT,
        ),
      /ELEMENT_ACCEPTANCE_SKIP_ELEMENT/u,
    );
  }
});

test('Compose overrides remain separate arguments and follow all base files', (t) => {
  const fixtureDirectory = mkdtempSync(
    join(tmpdir(), 'mcw-element-acceptance-overrides-'),
  );
  t.after(() => rmSync(fixtureDirectory, { recursive: true, force: true }));

  const firstFile = 'first fixture.yaml';
  const secondFile = 'second-fixture.yaml';
  writeFileSync(join(fixtureDirectory, firstFile), 'services: {}\n');
  writeFileSync(join(fixtureDirectory, secondFile), 'services: {}\n');
  const overrides = loadElementAcceptanceOverrides(
    {
      ELEMENT_ACCEPTANCE_COMPOSE_OVERRIDE_FILES: JSON.stringify([
        firstFile,
        secondFile,
      ]),
      ELEMENT_ACCEPTANCE_RADICALE_IMAGE:
        'registry.example.test:5443/calendar/radicale:release_1@sha256:' +
        'a'.repeat(64),
    },
    fixtureDirectory,
  );
  const baseArguments = [
    'compose',
    '-p',
    'synthetic-acceptance',
    '-f',
    'base.yaml',
    '-f',
    'acceptance.yaml',
  ];

  assert.deepEqual(overrides.composeFiles, [firstFile, secondFile]);
  assert.deepEqual(
    appendComposeOverrideFiles(baseArguments, overrides.composeFiles),
    [...baseArguments, '-f', firstFile, '-f', secondFile],
  );
  assert.equal(
    overrides.radicaleImage,
    'registry.example.test:5443/calendar/radicale:release_1@sha256:' +
      'a'.repeat(64),
  );
});

test('Radicale image references accept valid repository separators', () => {
  for (const image of [
    'registry.example.test:5443/calendar/team__one/radicale--image:release_1',
    'localhost:5000/calendar/team_one/radicale-image:3.8.0',
  ]) {
    assert.equal(
      loadElementAcceptanceOverrides(
        { ELEMENT_ACCEPTANCE_RADICALE_IMAGE: image },
        ROOT,
      ).radicaleImage,
      image,
    );
  }
});

test('invalid Compose lists, paths, control characters, and images are rejected', (t) => {
  const fixtureDirectory = mkdtempSync(
    join(tmpdir(), 'mcw-element-acceptance-invalid-overrides-'),
  );
  t.after(() => rmSync(fixtureDirectory, { recursive: true, force: true }));
  mkdirSync(join(fixtureDirectory, 'directory-input'));

  const cases = [
    [
      { ELEMENT_ACCEPTANCE_COMPOSE_OVERRIDE_FILES: '{}' },
      'COMPOSE_OVERRIDE_FILES',
    ],
    [
      { ELEMENT_ACCEPTANCE_COMPOSE_OVERRIDE_FILES: '["fixture.yaml", 2]' },
      'COMPOSE_OVERRIDE_FILES',
    ],
    [
      {
        ELEMENT_ACCEPTANCE_COMPOSE_OVERRIDE_FILES: JSON.stringify(
          Array.from({ length: 9 }, (_, index) => `override-${index}.yaml`),
        ),
      },
      'COMPOSE_OVERRIDE_FILES',
    ],
    [
      { ELEMENT_ACCEPTANCE_COMPOSE_OVERRIDE_FILES: '["missing.yaml"]' },
      'COMPOSE_OVERRIDE_FILES',
    ],
    [
      { ELEMENT_ACCEPTANCE_COMPOSE_OVERRIDE_FILES: '["directory-input"]' },
      'COMPOSE_OVERRIDE_FILES',
    ],
    [
      { ELEMENT_ACCEPTANCE_COMPOSE_OVERRIDE_FILES: '["fixture.yaml"]\n' },
      'COMPOSE_OVERRIDE_FILES',
    ],
    [
      { ELEMENT_ACCEPTANCE_COMPOSE_OVERRIDE_FILES: '["bad\\u0000path"]' },
      'COMPOSE_OVERRIDE_FILES',
    ],
    [
      {
        ELEMENT_ACCEPTANCE_RADICALE_IMAGE: 'registry.example.test/bad image',
      },
      'RADICALE_IMAGE',
    ],
    [
      {
        ELEMENT_ACCEPTANCE_RADICALE_IMAGE: 'registry.example.test/radicale\n',
      },
      'RADICALE_IMAGE',
    ],
    [
      {
        ELEMENT_ACCEPTANCE_RADICALE_IMAGE:
          'registry.example.test/calendar/team___one/radicale',
      },
      'RADICALE_IMAGE',
    ],
    [
      {
        ELEMENT_ACCEPTANCE_RADICALE_IMAGE:
          'registry.example.test/calendar/team..one/radicale',
      },
      'RADICALE_IMAGE',
    ],
    [
      {
        ELEMENT_ACCEPTANCE_RADICALE_IMAGE:
          'registry.example.test/calendar/team--/radicale',
      },
      'RADICALE_IMAGE',
    ],
  ];

  for (const [environment, expectedMessage] of cases) {
    assert.throws(
      () => loadElementAcceptanceOverrides(environment, fixtureDirectory),
      new RegExp(`ELEMENT_ACCEPTANCE_${expectedMessage}`),
    );
  }
});

test('both helpers reject invalid controls before starting a Docker process', (t) => {
  const fixtureDirectory = mkdtempSync(
    join(tmpdir(), 'mcw-element-acceptance-no-engine-'),
  );
  t.after(() => rmSync(fixtureDirectory, { recursive: true, force: true }));

  const markerPath = join(fixtureDirectory, 'docker-called');
  const dockerPath = join(fixtureDirectory, 'docker');
  writeFileSync(
    dockerPath,
    '#!/bin/sh\nprintf called >> "$ELEMENT_ACCEPTANCE_DOCKER_MARKER"\n',
    { mode: 0o700 },
  );

  const helperPaths = [
    join(ROOT, 'dev/element-acceptance-setup.mjs'),
    join(ROOT, 'dev/element-acceptance-reminder-restore.mjs'),
  ];
  const invalidControls = [
    {
      environment: { ELEMENT_ACCEPTANCE_COMPOSE_OVERRIDE_FILES: '[2]' },
      expectedMessage: 'COMPOSE_OVERRIDE_FILES',
    },
    {
      environment: {
        ELEMENT_ACCEPTANCE_COMPOSE_OVERRIDE_FILES: '["missing.yaml"]',
      },
      expectedMessage: 'COMPOSE_OVERRIDE_FILES',
    },
    {
      environment: { ELEMENT_ACCEPTANCE_RADICALE_IMAGE: 'bad image' },
      expectedMessage: 'RADICALE_IMAGE',
    },
    {
      environment: { ELEMENT_ACCEPTANCE_SKIP_ELEMENT: 'TRUE' },
      expectedMessage: 'SKIP_ELEMENT',
    },
  ];

  for (const helperPath of helperPaths) {
    for (const { environment, expectedMessage } of invalidControls) {
      const result = spawnSync(process.execPath, [helperPath], {
        cwd: ROOT,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: fixtureDirectory,
          ELEMENT_ACCEPTANCE_DOCKER_MARKER: markerPath,
          ...environment,
        },
      });

      assert.notEqual(result.status, 0);
      assert.match(
        result.stderr,
        new RegExp(`ELEMENT_ACCEPTANCE_${expectedMessage}`),
      );
      assert.equal(existsSync(markerPath), false);
    }
  }
});
