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
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  createServerDataMarkerCleanupScript,
  createServerDataMarkerWriterProgram,
  createSyntheticServerDataMarker,
} from './element-acceptance-server-data-marker.mjs';

test('server data marker uses exclusive creation and only removes its exact fixture file', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'matrix-calendar-marker-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const collisionMarker = createSyntheticServerDataMarker();
  const collisionWriter = createServerDataMarkerWriterProgram(
    directory,
    collisionMarker.contents,
  );
  const existingName = collisionMarker.name;
  const existingPath = join(directory, existingName);
  await writeFile(existingPath, collisionMarker.contents, { mode: 0o600 });
  const collision = spawnSync(process.execPath, [
    '-e',
    collisionWriter,
    existingName,
  ]);
  assert.equal(collision.status, 73);
  assert.equal(await readFile(existingPath, 'utf8'), collisionMarker.contents);

  const marker = createSyntheticServerDataMarker();
  const writer = createServerDataMarkerWriterProgram(
    directory,
    marker.contents,
  );
  const created = spawnSync(process.execPath, ['-e', writer, marker.name]);
  assert.equal(created.status, 0);
  const markerPath = join(directory, marker.name);
  assert.equal(await readFile(markerPath, 'utf8'), marker.contents);

  const cleanupArgs = [
    '-c',
    createServerDataMarkerCleanupScript(marker.contents),
    directory,
    marker.name,
    String(process.getuid?.() ?? 0),
    String(process.getgid?.() ?? 0),
  ];
  const cleanup = spawnSync('python3', cleanupArgs);
  assert.equal(cleanup.status, 0);

  const changedMarker = createSyntheticServerDataMarker();
  const changedPath = join(directory, changedMarker.name);
  await writeFile(changedPath, 'do not remove changed file\n', { mode: 0o600 });
  const changedCleanup = spawnSync('python3', [
    '-c',
    createServerDataMarkerCleanupScript(changedMarker.contents),
    directory,
    changedMarker.name,
    String(process.getuid?.() ?? 0),
    String(process.getgid?.() ?? 0),
  ]);
  assert.notEqual(changedCleanup.status, 0);
  assert.equal(
    await readFile(changedPath, 'utf8'),
    'do not remove changed file\n',
  );
});
