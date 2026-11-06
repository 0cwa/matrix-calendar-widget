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
import test from 'node:test';
import {
  withBoundedDockerRunArgs,
  withLocalOwnedDockerRunArgs,
} from './element-acceptance-overrides.mjs';
import { hasAcceptanceContainerResourceLimits } from './validate-element-acceptance-compose.mjs';

test('every acceptance Compose service must have the fixed resource limits', () => {
  const model = {
    services: {
      synapse: { mem_limit: '2147483648', cpus: 2 },
      restore: { mem_limit: '2g', cpus: 2 },
    },
  };
  assert.equal(hasAcceptanceContainerResourceLimits(model), true);
  assert.equal(
    hasAcceptanceContainerResourceLimits({
      services: { ...model.services, restore: { mem_limit: '2g' } },
    }),
    false,
  );
  assert.equal(hasAcceptanceContainerResourceLimits({ services: {} }), false);
});

test('every fixture helper Docker run receives fixed memory and CPU limits', () => {
  assert.deepEqual(withBoundedDockerRunArgs(['run', '--rm', 'image']), [
    'run',
    '--memory=2g',
    '--cpus=2',
    '--rm',
    'image',
  ]);
  assert.throws(
    () => withBoundedDockerRunArgs(['run', '--memory=4g', 'image']),
    /resource limits are controlled/u,
  );
  assert.deepEqual(
    withLocalOwnedDockerRunArgs(
      ['run', '--rm', 'image'],
      {
        localPrebuilt: true,
        projectName: 'mcw-p0-abc',
        runId: 'abc',
      },
      1,
    ),
    [
      'run',
      '--memory=2g',
      '--cpus=2',
      '--pull=never',
      '--label',
      'io.matrix-calendar-widget.local-rehearsal=abc',
      '--name',
      'mcw-p0-abc-local-abc-1',
      '--rm',
      'image',
    ],
  );
});
