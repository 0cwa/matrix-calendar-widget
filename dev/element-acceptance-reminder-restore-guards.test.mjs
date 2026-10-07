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
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  inspectStoppedContainerState,
  isPrivateArtifactPath,
  isSafeRestoreTargetPlan,
} from './element-acceptance-reminder-restore-guards.mjs';
import {
  formatFailureMarker,
  RADICALE_EXTRACT_TAR,
} from './element-acceptance-reminder-restore.mjs';

const PYTHON_ACCOUNT = [
  'import json,os,pwd',
  'account=pwd.getpwuid(os.geteuid())',
  'print(json.dumps({"name":account.pw_name,"uid":account.pw_uid,"gid":account.pw_gid}))',
].join('\n');
const PYTHON_ARCHIVE = [
  'import io,sys,tarfile',
  'uid=int(sys.argv[1]); gid=int(sys.argv[2]); variant=sys.argv[3]',
  'members=[(".",tarfile.DIRTYPE,0o700,b""),("collections",tarfile.DIRTYPE,0o750,b""),("collections/event.ics",tarfile.REGTYPE,0o640,b"synthetic")] ',
  'if variant=="traversal": members.append(("../outside",tarfile.REGTYPE,0o600,b"x"))',
  'if variant=="world-writable": members[1]=(members[1][0],members[1][1],0o777,members[1][3])',
  'if variant=="owner-mismatch": uid=65534 if uid!=65534 else 65533',
  'if variant=="group-mismatch": gid=65534 if gid!=65534 else 65533',
  'buffer=io.BytesIO()',
  'with tarfile.open(fileobj=buffer,mode="w") as archive:',
  ' for name,kind,mode,data in members:',
  '  info=tarfile.TarInfo(name); info.type=kind; info.mode=mode; info.uid=uid; info.gid=gid',
  '  if kind==tarfile.REGTYPE: info.size=len(data); archive.addfile(info,io.BytesIO(data))',
  '  else: archive.addfile(info)',
  ' if variant in ("symlink","hardlink"):',
  '  info=tarfile.TarInfo("collections/link")',
  '  info.type=tarfile.SYMTYPE if variant=="symlink" else tarfile.LNKTYPE',
  '  info.linkname="event.ics" if variant=="symlink" else "collections/event.ics"',
  '  info.mode=0o640; info.uid=uid; info.gid=gid; archive.addfile(info)',
  'sys.stdout.buffer.write(buffer.getvalue())',
].join('\n');

function runPython(script, args = [], input) {
  return spawnSync('python3', ['-c', script, ...args], {
    input,
    maxBuffer: 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function createArchive(uid, gid, variant = 'valid') {
  const result = runPython(PYTHON_ARCHIVE, [String(uid), String(gid), variant]);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
  return result.stdout;
}

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

test('Radicale archive extraction preserves validated owner and mode safely', (t) => {
  const accountResult = runPython(PYTHON_ACCOUNT);
  if (accountResult.error?.code === 'EPERM') {
    t.skip('the local sandbox does not allow Node child processes');
    return;
  }
  assert.equal(accountResult.error, undefined);
  assert.equal(accountResult.status, 0);
  const account = JSON.parse(accountResult.stdout.toString('utf8'));
  const root = mkdtempSync(join(tmpdir(), 'mcw-radicale-extract-'));
  try {
    const destination = join(root, 'data');
    mkdirSync(destination, { mode: 0o700 });
    const result = runPython(
      RADICALE_EXTRACT_TAR,
      [destination, account.name],
      createArchive(account.uid, account.gid),
    );
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0);
    const collections = statSync(join(destination, 'collections'));
    const event = statSync(join(destination, 'collections', 'event.ics'));
    assert.deepEqual(
      {
        uid: collections.uid,
        gid: collections.gid,
        mode: collections.mode & 0o777,
        eventUid: event.uid,
        eventGid: event.gid,
        eventMode: event.mode & 0o777,
        content: readFileSync(
          join(destination, 'collections', 'event.ics'),
          'utf8',
        ),
      },
      {
        uid: account.uid,
        gid: account.gid,
        mode: 0o750,
        eventUid: account.uid,
        eventGid: account.gid,
        eventMode: 0o640,
        content: 'synthetic',
      },
    );

    for (const variant of [
      'traversal',
      'owner-mismatch',
      'group-mismatch',
      'world-writable',
      'symlink',
      'hardlink',
    ]) {
      const rejectedDestination = join(root, variant);
      mkdirSync(rejectedDestination, { mode: 0o700 });
      const rejected = runPython(
        RADICALE_EXTRACT_TAR,
        [rejectedDestination, account.name],
        createArchive(account.uid, account.gid, variant),
      );
      assert.equal(rejected.error, undefined);
      assert.notEqual(rejected.status, 0);
    }
    assert.equal(existsSync(join(root, 'outside')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
