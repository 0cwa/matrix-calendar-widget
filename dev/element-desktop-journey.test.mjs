import assert from 'node:assert/strict';
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  DESKTOP_JOURNEY_PHASES,
  appendDesktopJourneyOutcome,
  initializeDesktopJourneyEvidence,
  readDesktopJourneyEvidence,
  readSyntheticDesktopCredentials,
  summarizeDesktopJourneyEvidence,
} from './element-desktop-journey.mjs';

function withTempDirectory(run) {
  const runnerTemp = mkdtempSync(join(tmpdir(), 'mcw-desktop-journey-test-'));
  try {
    run(runnerTemp);
  } finally {
    rmSync(runnerTemp, { recursive: true, force: true });
  }
}

test('reads and removes private synthetic Desktop credentials', () => {
  withTempDirectory((runnerTemp) => {
    const filePath = join(
      runnerTemp,
      'element-acceptance-desktop-credentials.json',
    );
    writeFileSync(
      filePath,
      JSON.stringify({
        username: 'element-0123456789-a',
        password: 'Abcdefghijklmnopqrstuvwxyz012345',
      }),
      { mode: 0o600, flag: 'wx' },
    );

    const credentials = readSyntheticDesktopCredentials({
      filePath,
      runnerTemp,
    });

    assert.deepEqual(credentials, {
      username: 'element-0123456789-a',
      password: 'Abcdefghijklmnopqrstuvwxyz012345',
    });
    assert.throws(
      () => readSyntheticDesktopCredentials({ filePath, runnerTemp }),
      /Invalid Desktop journey input/u,
    );
  });
});

test('rejects broad permissions and extra credential fields', () => {
  withTempDirectory((runnerTemp) => {
    const filePath = join(
      runnerTemp,
      'element-acceptance-desktop-credentials.json',
    );
    writeFileSync(
      filePath,
      JSON.stringify({
        username: 'element-0123456789-a',
        password: 'Abcdefghijklmnopqrstuvwxyz012345',
        accessToken: 'must-not-be-present',
      }),
      { mode: 0o600, flag: 'wx' },
    );
    assert.throws(
      () => readSyntheticDesktopCredentials({ filePath, runnerTemp }),
      /Invalid Desktop journey input/u,
    );

    writeFileSync(
      filePath,
      JSON.stringify({
        username: 'element-0123456789-a',
        password: 'Abcdefghijklmnopqrstuvwxyz012345',
      }),
      { mode: 0o600 },
    );
    chmodSync(filePath, 0o644);
    assert.throws(
      () => readSyntheticDesktopCredentials({ filePath, runnerTemp }),
      /Invalid Desktop journey input/u,
    );
  });
});

test('keeps journey evidence within finite phases and statuses', () => {
  withTempDirectory((runnerTemp) => {
    const filePath = join(runnerTemp, 'element-desktop-journey-stage.jsonl');
    initializeDesktopJourneyEvidence({ filePath, runnerTemp });

    appendDesktopJourneyOutcome({
      filePath,
      runnerTemp,
      phase: 'desktop-login',
      status: 'passed',
    });
    appendDesktopJourneyOutcome({
      filePath,
      runnerTemp,
      phase: 'web-member-b-read',
      status: 'passed',
    });

    const summary = readDesktopJourneyEvidence({ filePath, runnerTemp });
    assert.equal(summary.status, 'incomplete');
    assert.equal(summary.cases['desktop-login'], 'passed');
    assert.equal(summary.cases['desktop-widget-origin-isolation'], 'not_run');
    assert.equal(summary.cases['web-member-b-read'], 'passed');
    assert.equal(summary.cases['canonical-edit-read'], 'not_run');
    assert.deepEqual(Object.keys(summary.cases), [...DESKTOP_JOURNEY_PHASES]);
    assert.equal(
      readFileSync(filePath, 'utf8'),
      '{"phase":"desktop-login","status":"passed"}\n' +
        '{"phase":"web-member-b-read","status":"passed"}\n',
    );
  });
});

test('rejects duplicate or private-shaped evidence rows', () => {
  assert.throws(
    () =>
      summarizeDesktopJourneyEvidence(
        '{"phase":"desktop-login","status":"passed"}\n' +
          '{"phase":"desktop-login","status":"passed"}\n',
      ),
    /Invalid Desktop journey input/u,
  );
  assert.throws(
    () =>
      summarizeDesktopJourneyEvidence(
        '{"phase":"desktop-login","status":"passed","title":"secret"}\n',
      ),
    /Invalid Desktop journey input/u,
  );
  assert.throws(
    () =>
      summarizeDesktopJourneyEvidence(
        '{"phase":"unbounded-event-id","status":"passed"}\n',
      ),
    /Invalid Desktop journey input/u,
  );
});
