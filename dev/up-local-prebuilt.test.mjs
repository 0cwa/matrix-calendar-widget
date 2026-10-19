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
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  LOCAL_REHEARSAL_LABEL,
  LOCAL_REHEARSAL_SERVICES,
  LOCAL_REHEARSAL_VOLUMES,
} from './element-acceptance-overrides.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const UP_SCRIPT = join(ROOT, 'dev/up.sh');
const RUN_ID = '0123456789abcdef';
const PROJECT = `mcw-p0-${RUN_ID}`;
const RADICALE_IMAGE = 'matrix-calendar-widget/radicale-openid:archive-103-2';
const OWNER_LABEL = LOCAL_REHEARSAL_LABEL;
const REAL_DOCKER_BIN = (process.env.PATH ?? '')
  .split(delimiter)
  .map((directory) => join(directory || '.', 'docker'))
  .find((candidate) => {
    try {
      accessSync(candidate, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });

function localImagesAndOwnershipOverride() {
  const labels = { [OWNER_LABEL]: RUN_ID };
  return {
    services: {
      ...Object.fromEntries(
        LOCAL_REHEARSAL_SERVICES.map((name) => [name, { labels }]),
      ),
      synapse: {
        image: `ghcr.io/element-hq/synapse@sha256:${'a'.repeat(64)}`,
        labels,
      },
      radicale: { image: RADICALE_IMAGE, labels },
    },
    volumes: Object.fromEntries(
      LOCAL_REHEARSAL_VOLUMES.map((name) => [name, { labels }]),
    ),
  };
}

function writeExecutable(path, source) {
  writeFileSync(path, source, { mode: 0o700 });
}

function dockerCalls(path) {
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, 'utf8');
  if (!raw) return [];
  return raw
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function makeSandbox(t) {
  const root = mkdtempSync(join(tmpdir(), 'mcw-local-up-fake-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, 'bin');
  const runtime = join(root, `mcw-p0-${RUN_ID}`);
  const runnerTemp = join(root, `mcw-p0-runner-${RUN_ID}`);
  const dockerConfig = join(runtime, 'docker-config');
  mkdirSync(bin, { mode: 0o700 });
  mkdirSync(runtime, { mode: 0o700 });
  mkdirSync(dockerConfig, { mode: 0o700 });
  mkdirSync(runnerTemp, { mode: 0o700 });
  const overrideFile = join(runnerTemp, 'images.override.yaml');
  const composeEnvFile = join(runnerTemp, 'compose.env');
  const dockerLog = join(root, 'docker.jsonl');
  writeFileSync(
    overrideFile,
    JSON.stringify(localImagesAndOwnershipOverride()),
    { mode: 0o600 },
  );
  writeFileSync(
    composeEnvFile,
    'MATRIX_CALENDAR_DEV_SYNAPSE_PORT_MAPPING=127.0.0.1:8008:8008\nMATRIX_CALENDAR_DEV_RADICALE_PORT_MAPPING=127.0.0.1:5232:5232\n',
    { mode: 0o600 },
  );
  writeExecutable(
    join(bin, 'docker'),
    // The client-only Compose renderer is real; mutating Docker commands stay fake.
    '#!/bin/sh\nprintf "%s\\n" "$(node -e \'process.stdout.write(JSON.stringify(process.argv.slice(1)))\' "$@")" >> "$FAKE_DOCKER_LOG"\ncase "$*" in *" config --format json") exec "$REAL_DOCKER_BIN" "$@" ;; esac\n',
  );
  writeExecutable(
    join(bin, 'curl'),
    '#!/bin/sh\ncase "$*" in *"/_matrix/client/v3/login"*) printf \'{"access_token":"synthetic"}\' ;; esac\nexit 0\n',
  );
  writeExecutable(
    join(bin, 'node'),
    '#!/bin/sh\ncase "$*" in *synapse-startup-diagnostic.mjs*--stage-failure*) printf "stage=configuration-preflight exit_code=2\\n" ;; *mint-openid-credential.mjs*) printf synthetic-openid-proof ;; *) exec "$REAL_NODE_BIN" "$@" ;; esac\n',
  );
  const common = {
    PATH: `${bin}:${process.env.PATH}`,
    REAL_NODE_BIN: process.execPath,
    REAL_DOCKER_BIN,
    FAKE_DOCKER_LOG: dockerLog,
    MATRIX_CALENDAR_DEV_APPSERVICE_REGISTRATION: 'disabled',
    MATRIX_CALENDAR_DEV_PASSWORD: 'synthetic-password',
  };
  const local = {
    ...common,
    MATRIX_CALENDAR_LOCAL_PREBUILT_REHEARSAL: 'true',
    ELEMENT_ACCEPTANCE_LOCAL_RUN_ID: RUN_ID,
    COMPOSE_PROJECT_NAME: PROJECT,
    ELEMENT_ACCEPTANCE_SKIP_ELEMENT: 'true',
    ELEMENT_ACCEPTANCE_COMPOSE_OVERRIDE_FILES: JSON.stringify([overrideFile]),
    MATRIX_CALENDAR_LOCAL_COMPOSE_OVERRIDE_FILE: overrideFile,
    MATRIX_CALENDAR_LOCAL_COMPOSE_ENV_FILE: composeEnvFile,
    ELEMENT_ACCEPTANCE_RADICALE_IMAGE: RADICALE_IMAGE,
    RUNNER_TEMP: runnerTemp,
    DOCKER_HOST: `unix://${join(runtime, 'docker.sock')}`,
    DOCKER_CONFIG: dockerConfig,
    MATRIX_CALENDAR_DEV_SYNAPSE_PORT_MAPPING: '127.0.0.1:8008:8008',
    MATRIX_CALENDAR_DEV_RADICALE_PORT_MAPPING: '127.0.0.1:5232:5232',
  };
  return { bin, dockerLog, local, common, overrideFile };
}

function runUp(environment) {
  return spawnSync('bash', [UP_SCRIPT], {
    cwd: ROOT,
    env: environment,
    encoding: 'utf8',
    timeout: 10_000,
  });
}

function hasDockerComposeClient(environment) {
  if (!environment.REAL_DOCKER_BIN) return false;
  const result = spawnSync(
    environment.REAL_DOCKER_BIN,
    ['compose', 'version'],
    {
      env: {
        PATH: environment.PATH,
        DOCKER_CONFIG: environment.DOCKER_CONFIG,
        DOCKER_HOST: environment.DOCKER_HOST,
      },
      encoding: 'utf8',
      timeout: 5_000,
    },
  );
  return result.status === 0;
}

test('local dev/up validates the owned prebuilt overlay before no-pull startup', (t) => {
  const { dockerLog, local, overrideFile } = makeSandbox(t);
  if (!hasDockerComposeClient(local)) {
    t.skip('Docker Compose client is unavailable');
    return;
  }
  assert.equal(local.DOCKER_CONTEXT, undefined);
  assert.equal(existsSync(local.DOCKER_HOST.slice('unix://'.length)), false);
  const result = runUp(local);
  assert.equal(result.status, 0, result.stderr);
  const calls = dockerCalls(dockerLog);
  assert.ok(calls.length > 0);
  const configIndex = calls.findIndex((args) => args.includes('config'));
  const firstMutationIndex = calls.findIndex(
    (args) =>
      args.includes('run') || args.includes('up') || args.includes('build'),
  );
  assert.ok(configIndex >= 0);
  assert.ok(firstMutationIndex > configIndex);
  const override = JSON.parse(readFileSync(overrideFile, 'utf8'));
  assert.deepEqual(
    Object.keys(override.services).sort(),
    [...LOCAL_REHEARSAL_SERVICES].sort(),
  );
  assert.deepEqual(
    Object.keys(override.volumes).sort(),
    [...LOCAL_REHEARSAL_VOLUMES].sort(),
  );
  for (const name of LOCAL_REHEARSAL_SERVICES) {
    assert.deepEqual(override.services[name].labels, {
      [OWNER_LABEL]: RUN_ID,
    });
  }
  for (const name of LOCAL_REHEARSAL_VOLUMES) {
    assert.deepEqual(override.volumes[name].labels, {
      [OWNER_LABEL]: RUN_ID,
    });
  }
  for (const composeFile of [
    'dev/compose.yaml',
    'dev/element-acceptance.compose.yaml',
    'dev/element-acceptance-reminder.compose.yaml',
    'dev/element-acceptance-local-prebuilt.compose.yaml',
  ]) {
    assert.ok(
      calls[configIndex].some((argument) => argument.endsWith(composeFile)),
    );
  }
  for (const args of calls) {
    assert.equal(args[0], 'compose');
    assert.ok(args.includes('-p'));
    assert.ok(args.includes(PROJECT));
    if (args[1] === '-p') assert.equal(args[2], PROJECT);
    assert.ok(args.includes('--env-file'));
    assert.ok(args.includes(local.MATRIX_CALENDAR_LOCAL_COMPOSE_OVERRIDE_FILE));
    assert.equal(
      args.some((argument) => argument === 'element'),
      false,
    );
    if (args.includes('run')) {
      assert.ok(args.includes('never'));
      assert.ok(args.includes('--label'));
      assert.ok(args.includes('--name'));
    }
    if (args.includes('up')) {
      assert.ok(args.includes('--pull'));
      assert.ok(args.includes('never'));
      assert.ok(args.includes('--no-build'));
    }
    assert.equal(args.includes('build'), false);
  }
  assert.match(
    readFileSync(local.MATRIX_CALENDAR_LOCAL_COMPOSE_OVERRIDE_FILE, 'utf8'),
    new RegExp(RADICALE_IMAGE.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'),
  );
});

test('default dev/up preserves the hosted image build and Compose defaults', (t) => {
  const { dockerLog, common } = makeSandbox(t);
  const result = runUp(common);
  assert.equal(result.status, 0, result.stderr);
  const calls = dockerCalls(dockerLog);
  assert.ok(
    calls.some((args) => args.includes('build') && args.includes('radicale')),
  );
  assert.ok(calls.every((args) => !args.includes('-p')));
  assert.ok(calls.every((args) => !args.includes('--pull')));
  assert.ok(calls.every((args) => !args.includes('--label')));
  assert.ok(
    calls.every(
      (args) =>
        !args.some((argument) =>
          argument.endsWith('element-acceptance-local-prebuilt.compose.yaml'),
        ),
    ),
  );
});

test('invalid local endpoint, image, or project controls stop before Docker mutation', (t) => {
  const { dockerLog, local } = makeSandbox(t);
  for (const invalidEnvironment of [
    { ...local, DOCKER_CONTEXT: 'default' },
    {
      ...local,
      ELEMENT_ACCEPTANCE_RADICALE_IMAGE:
        'matrix-calendar-widget/radicale-openid:3.8.0.0',
    },
    { ...local, COMPOSE_PROJECT_NAME: 'matrix-calendar-dev' },
  ]) {
    const result = runUp(invalidEnvironment);
    assert.notEqual(result.status, 0);
  }
  assert.deepEqual(dockerCalls(dockerLog), []);
});

test('invalid prebuilt context fails before Docker and emits a closed preflight marker', (t) => {
  const { dockerLog, local } = makeSandbox(t);
  const result = runUp({
    ...local,
    DOCKER_CONTEXT: 'default',
  });

  assert.notEqual(result.status, 0);
  assert.match(
    result.stdout,
    /^stage=configuration-preflight exit_code=2\n$/u,
    result.stderr,
  );
  assert.deepEqual(dockerCalls(dockerLog), []);
  assert.doesNotMatch(
    `${result.stdout}\n${result.stderr}`,
    /synthetic-password|docker\.sock|BEGIN:VCALENDAR/u,
  );
});

test('missing or mismatched overlay labels stop before run, up, or build', (t) => {
  for (const ownershipCase of ['missing-service', 'mismatched-volume']) {
    const { dockerLog, local, overrideFile } = makeSandbox(t);
    if (!hasDockerComposeClient(local)) {
      t.skip('Docker Compose client is unavailable');
      return;
    }
    assert.equal(local.DOCKER_CONTEXT, undefined);
    assert.equal(existsSync(local.DOCKER_HOST.slice('unix://'.length)), false);
    const override = JSON.parse(readFileSync(overrideFile, 'utf8'));
    if (ownershipCase === 'missing-service') {
      delete override.services.gateway.labels[OWNER_LABEL];
    } else {
      override.volumes['radicale-data'].labels[OWNER_LABEL] =
        'fedcba9876543210';
    }
    writeFileSync(overrideFile, JSON.stringify(override), { mode: 0o600 });

    const result = runUp(local);

    assert.notEqual(result.status, 0, ownershipCase);
    const calls = dockerCalls(dockerLog);
    assert.equal(calls.length, 1, ownershipCase);
    assert.ok(calls[0].includes('config'), ownershipCase);
    assert.equal(
      calls.some((args) =>
        ['run', 'up', 'build'].some((operation) => args.includes(operation)),
      ),
      false,
      ownershipCase,
    );
  }
});
