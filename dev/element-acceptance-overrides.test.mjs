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
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  appendComposeOverrideFiles,
  DEFAULT_RADICALE_IMAGE,
  loadElementAcceptanceOverrides,
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
