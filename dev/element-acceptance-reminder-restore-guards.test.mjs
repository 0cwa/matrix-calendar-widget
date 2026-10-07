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
  inspectStoppedContainerState,
  isPrivateArtifactPath,
  isSafeRestoreTargetPlan,
} from './element-acceptance-reminder-restore-guards.mjs';
import { formatFailureMarker } from './element-acceptance-reminder-restore.mjs';

const safePlan = {
  projectName: 'matrix-calendar-element-123-1',
  sourceVolumeName: 'matrix-calendar-element-123-1_radicale-data',
  restoreVolumeName: 'matrix-calendar-element-123-1_radicale-restore',
  restoreVolumeExists: false,
  sourceDatabase: 'matrix_calendar_test',
  restoreDatabase: 'matrix_calendar_restored',
  restoreDatabaseExists: false,
};

test('restore target plan uses distinct, absent destinations', () => {
  assert.equal(isSafeRestoreTargetPlan(safePlan), true);
  assert.equal(
    isSafeRestoreTargetPlan({ ...safePlan, restoreVolumeExists: true }),
    false,
  );
  assert.equal(
    isSafeRestoreTargetPlan({ ...safePlan, restoreDatabaseExists: true }),
    false,
  );
  assert.equal(
    isSafeRestoreTargetPlan({
      ...safePlan,
      restoreVolumeName: safePlan.sourceVolumeName,
    }),
    false,
  );
  assert.equal(
    isSafeRestoreTargetPlan({
      ...safePlan,
      restoreDatabase: safePlan.sourceDatabase,
    }),
    false,
  );
  assert.equal(
    isSafeRestoreTargetPlan({
      ...safePlan,
      restoreVolumeName: 'another-project_radicale-restore',
    }),
    false,
  );
});

test('private acceptance artifacts stay below runner temp', () => {
  assert.equal(
    isPrivateArtifactPath(
      '/tmp/runner/element-acceptance-reminder.pgcustom',
      '/tmp/runner',
    ),
    true,
  );
  assert.equal(
    isPrivateArtifactPath('/tmp/runner-private/file', '/tmp/runner'),
    false,
  );
  assert.equal(
    isPrivateArtifactPath('/var/tmp/public-report', '/tmp/runner'),
    false,
  );
  assert.equal(isPrivateArtifactPath('relative/path', '/tmp/runner'), false);
});

test('quiescent snapshot accepts graceful stop only without OOM', () => {
  for (const exitCode of [0, 143]) {
    assert.deepEqual(
      inspectStoppedContainerState({
        status: 'exited',
        exitCode,
        oomKilled: false,
      }),
      {
        stopped: true,
        gracefulExit: true,
        oomFree: true,
        accepted: true,
      },
    );
  }
  assert.equal(
    inspectStoppedContainerState({
      status: 'exited',
      exitCode: 137,
      oomKilled: false,
    }).accepted,
    false,
  );
  assert.equal(
    inspectStoppedContainerState({
      status: 'exited',
      exitCode: 0,
      oomKilled: true,
    }).accepted,
    false,
  );
  assert.equal(
    inspectStoppedContainerState({
      status: 'running',
      exitCode: 0,
      oomKilled: false,
    }).accepted,
    false,
  );
});

test('failure marker emits only a known restore substep', () => {
  assert.equal(
    formatFailureMarker('restore-targets-prepared', 'archive-extract'),
    'Reminder acceptance fixture failed phase=restore-targets-prepared restore_step=archive-extract',
  );
  assert.equal(
    formatFailureMarker('restore-targets-prepared', 'private-token'),
    'Reminder acceptance fixture failed phase=restore-targets-prepared',
  );
  assert.equal(
    formatFailureMarker('reminder-compose-validation', 'archive-extract'),
    'Reminder acceptance fixture failed phase=reminder-compose-validation',
  );
  assert.equal(
    formatFailureMarker('private-data', 'private-token'),
    'Reminder acceptance fixture failed phase=reminder-compose-validation',
  );
});
