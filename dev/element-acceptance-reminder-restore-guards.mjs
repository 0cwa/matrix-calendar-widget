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

import { isAbsolute, resolve, sep } from 'node:path';

const PROJECT_NAME = /^[a-z0-9][a-z0-9_-]{0,62}$/u;

export function isPrivateArtifactPath(path, runnerTemp) {
  return (
    typeof path === 'string' &&
    typeof runnerTemp === 'string' &&
    isAbsolute(path) &&
    resolve(path).startsWith(resolve(runnerTemp) + sep)
  );
}

export function isSafeRestoreTargetPlan({
  projectName,
  sourceVolumeName,
  restoreVolumeName,
  restoreVolumeExists,
  sourceDatabase,
  restoreDatabase,
  restoreDatabaseExists,
}) {
  return (
    typeof projectName === 'string' &&
    PROJECT_NAME.test(projectName) &&
    sourceVolumeName === `${projectName}_radicale-data` &&
    restoreVolumeName === `${projectName}_radicale-restore` &&
    restoreVolumeName !== sourceVolumeName &&
    restoreVolumeExists === false &&
    sourceDatabase === 'matrix_calendar_test' &&
    restoreDatabase === 'matrix_calendar_restored' &&
    restoreDatabase !== sourceDatabase &&
    restoreDatabaseExists === false
  );
}

export function inspectStoppedContainerState(state) {
  const stopped = state?.status === 'exited';
  const gracefulExit = state?.exitCode === 0 || state?.exitCode === 143;
  const oomFree = state?.oomKilled === false;
  return {
    stopped,
    gracefulExit,
    oomFree,
    accepted: stopped && gracefulExit && oomFree,
  };
}
