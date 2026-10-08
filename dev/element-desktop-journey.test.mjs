import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  DESKTOP_JOURNEY_PHASES,
  DESKTOP_LOGIN_FAILURE_REASONS,
  DESKTOP_LOGIN_STEPS,
  appendDesktopJourneyOutcome,
  appendDesktopLoginStep,
  classifyDesktopLoginFailure,
  initializeDesktopJourneyEvidence,
  readDesktopJourneyEvidence,
  readSyntheticDesktopCredentials,
  summarizeDesktopJourneyEvidence,
  writeSyntheticDesktopCredentials,
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

test('writes synthetic Desktop credentials once with private runner permissions', () => {
  withTempDirectory((runnerTemp) => {
    const filePath = join(
      runnerTemp,
      'element-acceptance-desktop-credentials.json',
    );
    writeSyntheticDesktopCredentials({
      filePath,
      runnerTemp,
      username: 'element-0123456789-a',
      password: 'Abcdefghijklmnopqrstuvwxyz012345',
    });

    assert.equal(statSync(filePath).mode & 0o777, 0o600);
    assert.throws(
      () =>
        writeSyntheticDesktopCredentials({
          filePath,
          runnerTemp,
          username: 'element-0123456789-a',
          password: 'Abcdefghijklmnopqrstuvwxyz012345',
        }),
      /Invalid Desktop journey input/u,
    );
    assert.deepEqual(
      readSyntheticDesktopCredentials({ filePath, runnerTemp }),
      {
        username: 'element-0123456789-a',
        password: 'Abcdefghijklmnopqrstuvwxyz012345',
      },
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
    assert.equal(existsSync(filePath), false);

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
    assert.equal(existsSync(filePath), true);
  });
});

test('removes malformed credential JSON without exposing its contents', () => {
  withTempDirectory((runnerTemp) => {
    const filePath = join(
      runnerTemp,
      'element-acceptance-desktop-credentials.json',
    );
    writeFileSync(filePath, '{invalid json', {
      mode: 0o600,
      flag: 'wx',
    });

    assert.throws(
      () => readSyntheticDesktopCredentials({ filePath, runnerTemp }),
      /Invalid Desktop journey input/u,
    );
    assert.equal(existsSync(filePath), false);
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
    appendDesktopLoginStep({
      filePath,
      runnerTemp,
      step: 'complete',
    });
    appendDesktopJourneyOutcome({
      filePath,
      runnerTemp,
      phase: 'web-member-b-read',
      status: 'passed',
    });

    const summary = readDesktopJourneyEvidence({ filePath, runnerTemp });
    assert.equal(summary.status, 'incomplete');
    assert.equal(summary.loginStep, 'complete');
    assert.equal(summary.cases['desktop-login'], 'passed');
    assert.equal(summary.cases['desktop-widget-origin-isolation'], 'not_run');
    assert.equal(summary.cases['web-member-b-read'], 'passed');
    assert.equal(summary.cases['canonical-edit-read'], 'not_run');
    assert.deepEqual(Object.keys(summary.cases), [...DESKTOP_JOURNEY_PHASES]);
    assert.equal(
      readFileSync(filePath, 'utf8'),
      '{"phase":"desktop-login","status":"passed"}\n' +
        '{"loginStep":"complete"}\n' +
        '{"phase":"web-member-b-read","status":"passed"}\n',
    );
  });
});

test('records only the fixed Desktop login step in private journey evidence', () => {
  assert.deepEqual(
    [...DESKTOP_LOGIN_STEPS],
    [
      'not_observed',
      'cdp_connect',
      'page_select',
      'credentials_read',
      'login_form_select',
      'username_fill',
      'password_fill',
      'sign_in_submit',
      'rooms_ready',
      'complete',
    ],
  );

  withTempDirectory((runnerTemp) => {
    const filePath = join(runnerTemp, 'element-desktop-journey-stage.jsonl');
    initializeDesktopJourneyEvidence({ filePath, runnerTemp });
    appendDesktopLoginStep({
      filePath,
      runnerTemp,
      step: 'sign_in_submit',
    });

    const summary = readDesktopJourneyEvidence({ filePath, runnerTemp });
    assert.equal(summary.loginStep, 'sign_in_submit');
    assert.throws(
      () =>
        appendDesktopLoginStep({
          filePath,
          runnerTemp,
          step: 'complete',
        }),
      /Invalid Desktop journey input/u,
    );
    assert.throws(
      () =>
        summarizeDesktopJourneyEvidence(
          '{"phase":"desktop-login","status":"passed"}\n',
        ),
      /Invalid Desktop journey input/u,
    );
    assert.throws(
      () =>
        summarizeDesktopJourneyEvidence(
          '{"loginStep":"not-a-fixed-step","private":"value"}\n',
        ),
      /Invalid Desktop journey input/u,
    );
    assert.equal(
      readFileSync(filePath, 'utf8'),
      '{"loginStep":"sign_in_submit"}\n',
    );
  });
});

test('classifies Desktop login failures to fixed reasons without retaining error text', () => {
  const uniqueField = {
    countCapped: 1,
    visible: true,
    enabled: true,
    editable: true,
  };
  const absentField = {
    countCapped: 0,
    visible: null,
    enabled: null,
    editable: null,
  };
  const duplicateField = {
    countCapped: 2,
    visible: null,
    enabled: null,
    editable: null,
  };
  const beforeFill = {
    username: uniqueField,
    password: uniqueField,
  };
  const atFailure = {
    username: uniqueField,
    password: uniqueField,
  };
  const classify = (
    error,
    step = 'username_fill',
    before = beforeFill,
    after = atFailure,
  ) => classifyDesktopLoginFailure(error, step, before, after);

  const cases = [
    [
      Object.assign(new Error('private password text'), {
        name: 'TimeoutError',
      }),
      'timeout',
    ],
    [
      new Error('strict mode violation: private accessible name'),
      'strict-mode',
    ],
    [
      new Error('Element is not visible; private details omitted'),
      'not-visible',
    ],
    [
      new Error('Element is not enabled; private details omitted'),
      'not-enabled',
    ],
    [
      new Error('fill failed'),
      'detached',
      beforeFill,
      { username: absentField, password: uniqueField },
    ],
    [new Error('private error text'), 'other'],
    [undefined, 'unavailable'],
  ];
  for (const [
    error,
    expected,
    before = beforeFill,
    after = atFailure,
  ] of cases) {
    const result = classify(error, 'username_fill', before, after);
    assert.equal(result, expected);
    assert.ok(DESKTOP_LOGIN_FAILURE_REASONS.includes(result));
    assert.doesNotMatch(JSON.stringify(result), /private|password text/u);
  }
  assert.equal(
    classify(
      new Error('strict mode violation: private'),
      'username_fill',
      { username: duplicateField, password: uniqueField },
      { username: duplicateField, password: uniqueField },
    ),
    'strict-mode',
  );
});

test('persists only capped Desktop login locator observations and fixed failure reasons', () => {
  const unavailableField = {
    countCapped: null,
    visible: null,
    enabled: null,
    editable: null,
  };
  const duplicateField = {
    countCapped: 2,
    visible: null,
    enabled: null,
    editable: null,
  };
  const diagnostic = {
    failureReason: 'timeout',
    beforeFill: {
      username: duplicateField,
      password: unavailableField,
    },
    atFailure: {
      username: duplicateField,
      password: unavailableField,
    },
  };
  withTempDirectory((runnerTemp) => {
    const filePath = join(runnerTemp, 'element-desktop-journey-stage.jsonl');
    initializeDesktopJourneyEvidence({ filePath, runnerTemp });
    appendDesktopLoginStep({
      filePath,
      runnerTemp,
      step: 'username_fill',
      diagnostic,
    });

    const summary = readDesktopJourneyEvidence({ filePath, runnerTemp });
    assert.equal(summary.loginStep, 'username_fill');
    assert.deepEqual(summary.loginDiagnostic, diagnostic);
    assert.doesNotMatch(
      readFileSync(filePath, 'utf8'),
      /private|password text|message|URL/u,
    );
  });

  assert.throws(
    () =>
      summarizeDesktopJourneyEvidence(
        JSON.stringify({
          loginStep: 'username_fill',
          loginDiagnostic: {
            ...diagnostic,
            failureMessage: 'private error',
          },
        }),
      ),
    /Invalid Desktop journey input/u,
  );
  assert.throws(
    () =>
      summarizeDesktopJourneyEvidence(
        JSON.stringify({
          loginStep: 'username_fill',
          loginDiagnostic: {
            ...diagnostic,
            beforeFill: {
              username: {
                ...duplicateField,
                visible: true,
              },
              password: unavailableField,
            },
          },
        }),
      ),
    /Invalid Desktop journey input/u,
  );
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
