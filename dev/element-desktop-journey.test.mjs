import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ElementDesktopAcceptanceResultReporter from '../e2e/src/elementDesktopAcceptanceResultReporter.mjs';
import {
  appendDesktopChildCompletion,
  appendDesktopJourneyOutcome,
  appendDesktopJourneyProgress,
  appendDesktopLoginStep,
  appendDesktopPlaywrightResult,
  appendDesktopRefreshFailureWithFallback,
  appendDesktopUncaughtError,
  classifyDesktopJourneyErrorClass,
  classifyDesktopJourneyEvidence,
  classifyDesktopJourneyEvidenceState,
  classifyDesktopLoginFailure,
  classifyDesktopRoomNavigationClickFailure,
  DESKTOP_A_REFRESH_FAILURE_POINTS,
  DESKTOP_JOURNEY_FAILURE_POINTS,
  DESKTOP_JOURNEY_PHASES,
  DESKTOP_LOGIN_ENTRIES,
  DESKTOP_LOGIN_FAILURE_REASONS,
  DESKTOP_LOGIN_STEPS,
  desktopRouteEnforcementOutcome,
  desktopWidgetIsReady,
  enterDesktopPasswordLogin,
  findUniqueWebBEventId,
  initializeDesktopJourneyEvidence,
  inspectWebBEventList,
  isBoundedWebBEventListBodyLength,
  isBoundedWebBEventListResponse,
  observeWebBEditRowRenderWithinDeadline,
  prepareDesktopWidget,
  readDesktopJourneyEvidence,
  readDesktopJourneyParentDiagnostic,
  readOnlyWidgetIsReady,
  readSyntheticDesktopCredentials,
  summarizeDesktopJourneyEvidence,
  unavailableWebBEditRowRenderDiagnostic,
  writeDesktopJourneyParentDiagnostic,
  writeSyntheticDesktopCredentials,
} from './element-desktop-journey.mjs';

test('route enforcement finalization preserves journey and route policy outcomes', () => {
  const routePhaseIndex = DESKTOP_JOURNEY_PHASES.indexOf(
    'web-http-route-enforcement',
  );
  const passedPhases = new Set(
    DESKTOP_JOURNEY_PHASES.slice(0, routePhaseIndex),
  );

  assert.equal(
    desktopRouteEnforcementOutcome({
      failed: false,
      recorded: passedPhases,
      observedHttpRequests: 1,
      blockedHttpRequests: 0,
    }),
    'passed',
  );
  assert.equal(
    desktopRouteEnforcementOutcome({
      failed: false,
      recorded: new Set(
        [...passedPhases].filter((phase) => phase !== 'desktop-a-refresh'),
      ),
      observedHttpRequests: 1,
      blockedHttpRequests: 0,
    }),
    undefined,
  );
  assert.equal(
    desktopRouteEnforcementOutcome({
      failed: true,
      recorded: passedPhases,
      observedHttpRequests: 1,
      blockedHttpRequests: 0,
    }),
    undefined,
  );
  assert.equal(
    desktopRouteEnforcementOutcome({
      failed: false,
      recorded: passedPhases,
      observedHttpRequests: 1,
      blockedHttpRequests: 1,
    }),
    'failed',
  );
});

function withTempDirectory(run) {
  const runnerTemp = mkdtempSync(join(tmpdir(), 'mcw-desktop-journey-test-'));
  try {
    run(runnerTemp);
  } finally {
    rmSync(runnerTemp, { recursive: true, force: true });
  }
}

const DESKTOP_REFRESH_SOURCE_SHA = 'e'.repeat(40);
const DESKTOP_REFRESH_PRIOR_PHASES = DESKTOP_JOURNEY_PHASES.slice(
  0,
  DESKTOP_JOURNEY_PHASES.indexOf('desktop-a-refresh'),
);

function appendDesktopRefreshPrefix(filePath, runnerTemp) {
  for (const phase of DESKTOP_REFRESH_PRIOR_PHASES) {
    appendDesktopJourneyOutcome({
      filePath,
      runnerTemp,
      phase,
      status: 'passed',
    });
    if (phase === 'desktop-login') {
      appendDesktopLoginStep({
        filePath,
        runnerTemp,
        step: 'complete',
        entry: 'password_form_present',
      });
    }
  }
}

function appendDesktopRefreshBegin(filePath, runnerTemp) {
  return appendDesktopJourneyProgress({
    filePath,
    runnerTemp,
    sourceSha: DESKTOP_REFRESH_SOURCE_SHA,
    event: 'begin',
    phase: 'desktop-a-refresh',
  });
}

function appendDesktopRefreshPoint(
  filePath,
  runnerTemp,
  failurePoint,
  desktopRefreshRoomNavigationDiagnostic,
) {
  return appendDesktopJourneyProgress({
    filePath,
    runnerTemp,
    sourceSha: DESKTOP_REFRESH_SOURCE_SHA,
    event: 'point',
    phase: 'desktop-a-refresh',
    failurePoint,
    ...(desktopRefreshRoomNavigationDiagnostic === undefined
      ? {}
      : { desktopRefreshRoomNavigationDiagnostic }),
  });
}

function appendDesktopRefreshStarted(
  filePath,
  runnerTemp,
  desktopRefreshRoomNavigationDiagnostic,
) {
  return appendDesktopJourneyProgress({
    filePath,
    runnerTemp,
    sourceSha: DESKTOP_REFRESH_SOURCE_SHA,
    event: 'started',
    phase: 'desktop-a-refresh',
    failurePoint: 'desktop-refresh-room-navigation',
    desktopRefreshRoomNavigationDiagnostic,
  });
}

function appendDesktopRefreshComplete(
  filePath,
  runnerTemp,
  failurePoint,
  desktopRefreshRoomNavigationDiagnostic,
) {
  return appendDesktopJourneyProgress({
    filePath,
    runnerTemp,
    sourceSha: DESKTOP_REFRESH_SOURCE_SHA,
    event: 'complete',
    phase: 'desktop-a-refresh',
    failurePoint,
    ...(desktopRefreshRoomNavigationDiagnostic === undefined
      ? {}
      : { desktopRefreshRoomNavigationDiagnostic }),
  });
}

test('inspects only bounded event identity and emits no event content', () => {
  const privateId = 'private-event-id-7f4d1c';
  const privateTitle = 'private event title 4d763a';
  const calendarId = 'private-calendar-id-5c331a';
  const editedTitle = `${privateTitle} edited`;
  const originalBody = {
    events: [
      {
        event: {
          id: privateId,
          calendarId,
          title: privateTitle,
          description: 'private description',
        },
      },
    ],
  };
  assert.equal(
    findUniqueWebBEventId(originalBody, calendarId, privateTitle),
    privateId,
  );

  const editedBody = {
    events: [
      {
        event: { id: privateId, calendarId, title: editedTitle },
      },
    ],
  };
  const edited = inspectWebBEventList(
    editedBody,
    calendarId,
    privateId,
    editedTitle,
  );
  assert.deepEqual(edited, {
    state: 'decoded',
    sameEventObserved: true,
    sameEventEditedTitleMatch: true,
  });
  assert.doesNotMatch(JSON.stringify(edited), /private-event|private event/u);

  const absent = inspectWebBEventList(
    { events: [] },
    calendarId,
    privateId,
    editedTitle,
  );
  assert.deepEqual(absent, {
    state: 'decoded',
    sameEventObserved: false,
    sameEventEditedTitleMatch: false,
  });
  assert.deepEqual(
    inspectWebBEventList(
      { events: Array.from({ length: 513 }, () => editedBody.events[0]) },
      calendarId,
      privateId,
      editedTitle,
    ),
    {
      state: 'unavailable',
      sameEventObserved: null,
      sameEventEditedTitleMatch: null,
    },
  );
  assert.equal(
    findUniqueWebBEventId(
      { events: [editedBody.events[0], editedBody.events[0]] },
      calendarId,
      editedTitle,
    ),
    null,
  );
});

test('requires identity-encoded bounded JSON before reading a B event response', () => {
  assert.equal(
    isBoundedWebBEventListResponse({
      'content-length': '65536',
      'content-type': 'application/json; charset=utf-8',
    }),
    true,
  );
  for (const headers of [
    { 'content-length': '65537', 'content-type': 'application/json' },
    { 'content-type': 'application/json' },
    { 'content-length': '-1', 'content-type': 'application/json' },
    { 'content-length': '1.5', 'content-type': 'application/json' },
    { 'content-length': '10', 'content-type': 'text/plain' },
    {
      'content-length': '10',
      'content-type': 'application/json',
      'content-encoding': 'gzip',
    },
    {
      'content-length': '10',
      'content-type': 'application/json',
      'content-encoding': '',
    },
    null,
  ]) {
    assert.equal(isBoundedWebBEventListResponse(headers), false);
  }
  assert.equal(isBoundedWebBEventListBodyLength(0), true);
  assert.equal(isBoundedWebBEventListBodyLength(65_536), true);
  assert.equal(isBoundedWebBEventListBodyLength(65_537), false);
});

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
      entry: 'password_form_present',
    });
    appendDesktopJourneyOutcome({
      filePath,
      runnerTemp,
      phase: 'web-member-b-read',
      status: 'passed',
    });

    const summary = readDesktopJourneyEvidence({ filePath, runnerTemp });
    assert.equal(summary.schemaVersion, 19);
    assert.equal(summary.status, 'incomplete');
    assert.equal(summary.loginStep, 'complete');
    assert.equal(summary.loginEntry, 'password_form_present');
    assert.equal(summary.roomsReadyDiagnostic, null);
    assert.equal(summary.failurePoint, null);
    assert.equal(summary.cases['desktop-login'], 'passed');
    assert.equal(summary.cases['desktop-widget-origin-isolation'], 'not_run');
    assert.equal(summary.cases['web-member-b-read'], 'passed');
    assert.equal(summary.cases['canonical-edit-read'], 'not_run');
    assert.deepEqual(Object.keys(summary.cases), [...DESKTOP_JOURNEY_PHASES]);
    assert.equal(
      readFileSync(filePath, 'utf8'),
      '{"phase":"desktop-login","status":"passed"}\n' +
        '{"loginStep":"complete","loginEntry":"password_form_present"}\n' +
        '{"phase":"web-member-b-read","status":"passed"}\n',
    );
  });
});

test('records only the source-bound Playwright result and child completion', () => {
  withTempDirectory((runnerTemp) => {
    const filePath = join(runnerTemp, 'element-desktop-journey-stage.jsonl');
    const sourceSha = 'a'.repeat(40);
    initializeDesktopJourneyEvidence({ filePath, runnerTemp });
    const previousEnvironment = {
      stageFile: process.env.ELEMENT_DESKTOP_JOURNEY_STAGE_FILE,
      runnerTemp: process.env.RUNNER_TEMP,
      sourceSha: process.env.ELEMENT_DESKTOP_SOURCE_SHA,
    };
    process.env.ELEMENT_DESKTOP_JOURNEY_STAGE_FILE = filePath;
    process.env.RUNNER_TEMP = runnerTemp;
    process.env.ELEMENT_DESKTOP_SOURCE_SHA = sourceSha;
    try {
      new ElementDesktopAcceptanceResultReporter().onEnd({
        status: 'timedout',
        errors: [{ message: 'private Playwright error' }],
        title: 'private test title',
        attachments: [{ body: 'private attachment' }],
      });
    } finally {
      for (const [key, value] of Object.entries({
        ELEMENT_DESKTOP_JOURNEY_STAGE_FILE: previousEnvironment.stageFile,
        RUNNER_TEMP: previousEnvironment.runnerTemp,
        ELEMENT_DESKTOP_SOURCE_SHA: previousEnvironment.sourceSha,
      })) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
    writeFileSync(
      filePath,
      `${JSON.stringify({
        type: 'desktop-child-completion',
        sourceSha,
        desktopChildCompletion: {
          outcome: 'exited',
          exitStatus: 1,
          timedOut: false,
        },
      })}\n`,
      { flag: 'a', mode: 0o600 },
    );

    const raw = readFileSync(filePath, 'utf8');
    assert.equal(
      raw,
      `{"type":"desktop-playwright-result","sourceSha":"${sourceSha}","playwrightResult":"timed_out"}\n` +
        `{"type":"desktop-child-completion","sourceSha":"${sourceSha}","desktopChildCompletion":{"outcome":"exited","exitStatus":1,"timedOut":false}}\n`,
    );
    assert.doesNotMatch(
      raw,
      /private Playwright error|private test title|private attachment/u,
    );
    const summary = readDesktopJourneyEvidence({
      filePath,
      runnerTemp,
      expectedSourceSha: sourceSha,
    });
    assert.equal(summary.schemaVersion, 19);
    assert.equal(summary.sourceSha, sourceSha);
    assert.equal(summary.status, 'incomplete');
    assert.equal(summary.playwrightResult, 'timed_out');
    assert.deepEqual(summary.desktopChildCompletion, {
      outcome: 'exited',
      exitStatus: 1,
      timedOut: false,
    });
  });
});

test('reports missing, malformed, duplicate, and conflicting results as unknown', () => {
  const sourceSha = 'c'.repeat(40);
  const completion = (exitStatus) => ({
    type: 'desktop-child-completion',
    sourceSha,
    desktopChildCompletion: {
      outcome: 'exited',
      exitStatus,
      timedOut: false,
    },
  });
  const reporter = (playwrightResult) => ({
    type: 'desktop-playwright-result',
    sourceSha,
    playwrightResult,
  });
  const summarize = (...rows) =>
    summarizeDesktopJourneyEvidence(
      `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`,
      { expectedSourceSha: sourceSha },
    );

  assert.equal(summarize().desktopChildCompletion.outcome, 'unknown');
  assert.equal(summarize(completion(1)).playwrightResult, 'unknown');
  assert.equal(
    summarize(completion(1), {
      ...reporter('failed'),
      unexpected: 'private data',
    }).playwrightResult,
    'unknown',
  );
  assert.equal(
    summarize(completion(0), reporter('passed'), reporter('passed'))
      .playwrightResult,
    'unknown',
  );
  assert.equal(
    summarize(completion(0), reporter('failed')).playwrightResult,
    'unknown',
  );
  assert.equal(
    summarize(completion(1), reporter('passed')).playwrightResult,
    'unknown',
  );
  assert.equal(
    summarize(completion(1), reporter('failed')).playwrightResult,
    'failed',
  );
  const mismatchedSource = summarize(completion(1), {
    ...reporter('failed'),
    sourceSha: 'd'.repeat(40),
  });
  assert.equal(mismatchedSource.sourceSha, sourceSha);
  assert.equal(mismatchedSource.desktopChildCompletion.outcome, 'unknown');
  assert.equal(mismatchedSource.playwrightResult, 'unknown');
  const malformedSource = summarize(completion(1), {
    ...reporter('failed'),
    sourceSha: 'not-a-commit',
  });
  assert.equal(malformedSource.desktopChildCompletion.outcome, 'unknown');
  assert.equal(malformedSource.playwrightResult, 'unknown');
});

test('passes Desktop journey evidence only with complete source-bound success diagnostics', () => {
  const sourceSha = 'f'.repeat(40);
  const childCompletion = (outcome, exitStatus, timedOut) => ({
    type: 'desktop-child-completion',
    sourceSha,
    desktopChildCompletion: { outcome, exitStatus, timedOut },
  });
  const playwright = (playwrightResult, recordSourceSha = sourceSha) => ({
    type: 'desktop-playwright-result',
    sourceSha: recordSourceSha,
    playwrightResult,
  });
  const phaseRows = [];
  for (const phase of DESKTOP_JOURNEY_PHASES) {
    if (phase === 'desktop-a-refresh') {
      phaseRows.push({
        type: 'desktop-journey-progress',
        event: 'begin',
        sourceSha,
        phase,
      });
      for (const failurePoint of DESKTOP_A_REFRESH_FAILURE_POINTS) {
        phaseRows.push(
          {
            type: 'desktop-journey-progress',
            event: 'point',
            sourceSha,
            phase,
            failurePoint,
          },
          {
            type: 'desktop-journey-progress',
            event: 'complete',
            sourceSha,
            phase,
            failurePoint,
          },
        );
      }
    }
    phaseRows.push({ phase, status: 'passed' });
  }
  phaseRows.push({
    loginStep: 'complete',
    loginEntry: 'password_form_present',
  });
  const summarize = (...rows) =>
    summarizeDesktopJourneyEvidence(
      `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`,
      { expectedSourceSha: sourceSha },
    );
  const validCompletion = childCompletion('exited', 0, false);
  const validPlaywright = playwright('passed');

  assert.equal(
    summarize(...phaseRows, validCompletion, validPlaywright).status,
    'passed',
  );

  const incompleteEvidence = [
    [validPlaywright],
    [validCompletion],
    [
      {
        ...validCompletion,
        desktopChildCompletion: {
          outcome: 'exited',
          exitStatus: 256,
          timedOut: false,
        },
      },
      validPlaywright,
    ],
    [childCompletion('unknown', null, false), playwright('unknown')],
    [childCompletion('exited', 0, false), playwright('failed')],
    [childCompletion('exited', 1, false), playwright('failed')],
    [childCompletion('timeout', null, true), playwright('timed_out')],
    [validCompletion, playwright('passed', '0'.repeat(40))],
  ];
  for (const diagnostics of incompleteEvidence) {
    assert.equal(summarize(...phaseRows, ...diagnostics).status, 'incomplete');
  }
  assert.throws(
    () =>
      summarizeDesktopJourneyEvidence(
        `${phaseRows.map((row) => JSON.stringify(row)).join('\n')}\n` +
          '{"type":"desktop-child-completion","sourceSha":"' +
          sourceSha +
          '","desktopChildCompletion":not-json}\n',
        { expectedSourceSha: sourceSha },
      ),
    /Invalid Desktop journey input/u,
  );
});

test('preflights both diagnostic rows at the evidence cap without changing phase evidence', () => {
  const sourceSha = 'e'.repeat(40);
  const phase = 'web-member-b-keyboard-open';
  const completion = {
    outcome: 'spawn_error',
    exitStatus: null,
    timedOut: false,
  };
  const childRowBytes = Buffer.byteLength(
    `${JSON.stringify({
      type: 'desktop-child-completion',
      sourceSha,
      desktopChildCompletion: completion,
    })}\n`,
  );
  const reporterRowBytes = Buffer.byteLength(
    `${JSON.stringify({
      type: 'desktop-playwright-result',
      sourceSha,
      playwrightResult: 'interrupted',
    })}\n`,
  );
  const maximumEvidenceBytes = 16_384;
  const createEvidenceAtSize = (runnerTemp, targetBytes) => {
    const filePath = join(runnerTemp, 'element-desktop-journey-stage.jsonl');
    initializeDesktopJourneyEvidence({ filePath, runnerTemp });
    appendDesktopJourneyOutcome({
      filePath,
      runnerTemp,
      phase,
      status: 'passed',
    });
    const currentBytes = statSync(filePath).size;
    assert.ok(targetBytes >= currentBytes);
    appendFileSync(filePath, '\n'.repeat(targetBytes - currentBytes));
    return { filePath, originalBytes: readFileSync(filePath) };
  };
  const appendChild = (filePath, runnerTemp) =>
    appendDesktopChildCompletion({
      filePath,
      runnerTemp,
      sourceSha,
      completion,
    });

  withTempDirectory((runnerTemp) => {
    const targetBytes = maximumEvidenceBytes - reporterRowBytes - childRowBytes;
    const { filePath } = createEvidenceAtSize(runnerTemp, targetBytes);
    assert.equal(
      appendDesktopPlaywrightResult({
        filePath,
        runnerTemp,
        sourceSha,
        status: 'interrupted',
      }),
      true,
    );
    assert.equal(appendChild(filePath, runnerTemp), true);
    assert.equal(statSync(filePath).size, maximumEvidenceBytes);
    const summary = readDesktopJourneyEvidence({
      filePath,
      runnerTemp,
      expectedSourceSha: sourceSha,
    });
    assert.equal(summary.cases[phase], 'passed');
    assert.equal(summary.desktopChildCompletion.outcome, 'spawn_error');
    assert.equal(summary.playwrightResult, 'unknown');
  });

  withTempDirectory((runnerTemp) => {
    const targetBytes =
      maximumEvidenceBytes - reporterRowBytes - childRowBytes + 1;
    const { filePath, originalBytes } = createEvidenceAtSize(
      runnerTemp,
      targetBytes,
    );
    assert.equal(
      appendDesktopPlaywrightResult({
        filePath,
        runnerTemp,
        sourceSha,
        status: 'interrupted',
      }),
      false,
    );
    assert.deepEqual(readFileSync(filePath), originalBytes);
    const summary = readDesktopJourneyEvidence({
      filePath,
      runnerTemp,
      expectedSourceSha: sourceSha,
    });
    assert.equal(summary.cases[phase], 'passed');
    assert.equal(summary.desktopChildCompletion.outcome, 'unknown');
    assert.equal(summary.playwrightResult, 'unknown');
  });

  withTempDirectory((runnerTemp) => {
    const targetBytes = maximumEvidenceBytes - childRowBytes;
    const { filePath } = createEvidenceAtSize(runnerTemp, targetBytes);
    assert.equal(appendChild(filePath, runnerTemp), true);
    assert.equal(statSync(filePath).size, maximumEvidenceBytes);
    const summary = readDesktopJourneyEvidence({
      filePath,
      runnerTemp,
      expectedSourceSha: sourceSha,
    });
    assert.equal(summary.cases[phase], 'passed');
    assert.equal(summary.desktopChildCompletion.outcome, 'spawn_error');
    assert.equal(summary.playwrightResult, 'unknown');
  });

  withTempDirectory((runnerTemp) => {
    const targetBytes = maximumEvidenceBytes - childRowBytes + 1;
    const { filePath, originalBytes } = createEvidenceAtSize(
      runnerTemp,
      targetBytes,
    );
    assert.equal(appendChild(filePath, runnerTemp), false);
    assert.deepEqual(readFileSync(filePath), originalBytes);
    const summary = readDesktopJourneyEvidence({
      filePath,
      runnerTemp,
      expectedSourceSha: sourceSha,
    });
    assert.equal(summary.cases[phase], 'passed');
    assert.equal(summary.desktopChildCompletion.outcome, 'unknown');
    assert.equal(summary.playwrightResult, 'unknown');
  });
});

test('records one fixed failure point for a failed Desktop room read', () => {
  withTempDirectory((runnerTemp) => {
    const filePath = join(runnerTemp, 'element-desktop-journey-stage.jsonl');
    initializeDesktopJourneyEvidence({ filePath, runnerTemp });
    appendDesktopJourneyOutcome({
      filePath,
      runnerTemp,
      phase: 'desktop-room-widget-read',
      status: 'failed',
      failurePoint: 'gateway-read-status',
    });

    const summary = readDesktopJourneyEvidence({ filePath, runnerTemp });
    assert.deepEqual(summary.failurePoint, {
      phase: 'desktop-room-widget-read',
      point: 'gateway-read-status',
    });
    assert.equal(summary.cases['desktop-room-widget-read'], 'failed');
    assert.throws(
      () =>
        appendDesktopJourneyOutcome({
          filePath,
          runnerTemp,
          phase: 'desktop-widget-origin-isolation',
          status: 'failed',
          failurePoint: 'origin-isolation',
        }),
      /Invalid Desktop journey input/u,
    );
    assert.equal(
      readFileSync(filePath, 'utf8'),
      '{"phase":"desktop-room-widget-read","status":"failed","failurePoint":"gateway-read-status"}\n',
    );
  });
});

test('reports bounded Desktop accessibility failure phases', () => {
  const cases = [
    {
      phase: 'desktop-keyboard-focus',
      failurePoint: 'desktop-keyboard-focus-observation',
    },
    {
      phase: 'desktop-side-panel-layout',
      failurePoint: 'desktop-side-panel-layout-evidence',
    },
  ];

  for (const { phase, failurePoint } of cases) {
    withTempDirectory((runnerTemp) => {
      const filePath = join(runnerTemp, 'element-desktop-journey-stage.jsonl');
      initializeDesktopJourneyEvidence({ filePath, runnerTemp });
      for (const priorPhase of DESKTOP_JOURNEY_PHASES.slice(
        0,
        DESKTOP_JOURNEY_PHASES.indexOf(phase),
      )) {
        appendDesktopJourneyOutcome({
          filePath,
          runnerTemp,
          phase: priorPhase,
          status: 'passed',
        });
        if (priorPhase === 'desktop-login') {
          appendDesktopLoginStep({
            filePath,
            runnerTemp,
            step: 'complete',
            entry: 'password_form_present',
          });
        }
      }
      appendDesktopJourneyOutcome({
        filePath,
        runnerTemp,
        phase,
        status: 'failed',
        failurePoint,
      });

      const summary = readDesktopJourneyEvidence({ filePath, runnerTemp });
      assert.equal(summary.schemaVersion, 19);
      assert.equal(summary.cases[phase], 'failed');
      assert.deepEqual(summary.failurePoint, { phase, point: failurePoint });
      assert.equal(summary.status, 'failed');
    });
  }
});

test('records closed Desktop create observations without event or URL data', () => {
  const makeDiagnostic = (overrides = {}) => ({
    createPostObserved: null,
    createPostRequestFailed: null,
    createPostStatus: null,
    createResponseHasEvent: null,
    createResponseTitleMatches: null,
    createResponseCalendarMatches: null,
    postCreateEventGetRequestCountCapped: null,
    postCreateRoomRangeGetRequestCountCapped: null,
    postCreateRoomRangeGetResponseCountCapped: null,
    postCreateRoomRangeGetStatus: null,
    roomListHasEventsArray: null,
    roomListEventCountCapped: null,
    roomListTitleMatches: null,
    roomListIdMatches: null,
    roomListCalendarMatches: null,
    createResponseTimingComparable: null,
    createResponseEventIntersectsRoomRange: null,
    calendarEventsRegionCountCapped: null,
    calendarEventsRegionVisible: null,
    calendarEventsVisibleRowCountCapped: null,
    progressbarVisible: null,
    errorAlertVisible: null,
    matchingRowCountCapped: null,
    matchingRowVisible: null,
    ...overrides,
  });
  const diagnostic = makeDiagnostic({
    createPostObserved: true,
    createPostRequestFailed: false,
    createPostStatus: 201,
    createResponseHasEvent: true,
    createResponseTitleMatches: true,
    createResponseCalendarMatches: true,
    postCreateEventGetRequestCountCapped: 0,
    postCreateRoomRangeGetRequestCountCapped: 1,
    postCreateRoomRangeGetResponseCountCapped: 1,
    postCreateRoomRangeGetStatus: 200,
    roomListHasEventsArray: true,
    roomListEventCountCapped: 1,
    roomListTitleMatches: true,
    roomListIdMatches: true,
    roomListCalendarMatches: true,
    createResponseTimingComparable: true,
    createResponseEventIntersectsRoomRange: true,
    calendarEventsRegionCountCapped: 1,
    calendarEventsRegionVisible: true,
    calendarEventsVisibleRowCountCapped: 1,
    progressbarVisible: false,
    errorAlertVisible: false,
    matchingRowCountCapped: 1,
    matchingRowVisible: false,
  });
  withTempDirectory((runnerTemp) => {
    const filePath = join(runnerTemp, 'element-desktop-journey-stage.jsonl');
    initializeDesktopJourneyEvidence({ filePath, runnerTemp });
    appendDesktopJourneyOutcome({
      filePath,
      runnerTemp,
      phase: 'desktop-event-create',
      status: 'failed',
      failurePoint: 'event-create-exact-row-visible',
      desktopEventCreateDiagnostic: diagnostic,
    });

    const raw = readFileSync(filePath, 'utf8');
    assert.deepEqual(JSON.parse(raw), {
      phase: 'desktop-event-create',
      status: 'failed',
      failurePoint: 'event-create-exact-row-visible',
      desktopEventCreateDiagnostic: diagnostic,
    });
    assert.doesNotMatch(
      raw,
      /private room|private title|private-event-id|response body|request URL/u,
    );
    const summary = readDesktopJourneyEvidence({ filePath, runnerTemp });
    assert.equal(summary.schemaVersion, 19);
    assert.deepEqual(summary.failurePoint, {
      phase: 'desktop-event-create',
      point: 'event-create-exact-row-visible',
    });
    assert.deepEqual(summary.desktopEventCreateDiagnostic, diagnostic);
    assert.equal(summary.cases['desktop-event-create'], 'failed');
  });

  const summarize = (row) =>
    summarizeDesktopJourneyEvidence(`${JSON.stringify(row)}\n`);
  assert.deepEqual(
    summarize({
      phase: 'desktop-event-create',
      status: 'failed',
      failurePoint: 'event-create-post-await',
      desktopEventCreateDiagnostic: makeDiagnostic({
        createPostObserved: true,
        createPostRequestFailed: true,
        createPostStatus: null,
        postCreateEventGetRequestCountCapped: 0,
        postCreateRoomRangeGetRequestCountCapped: 0,
        postCreateRoomRangeGetResponseCountCapped: 0,
      }),
    }).desktopEventCreateDiagnostic,
    makeDiagnostic({
      createPostObserved: true,
      createPostRequestFailed: true,
      createPostStatus: null,
      postCreateEventGetRequestCountCapped: 0,
      postCreateRoomRangeGetRequestCountCapped: 0,
      postCreateRoomRangeGetResponseCountCapped: 0,
    }),
  );
  assert.deepEqual(
    summarize({
      phase: 'desktop-event-create',
      status: 'failed',
      failurePoint: 'event-create-setup',
      desktopEventCreateDiagnostic: makeDiagnostic({
        createPostObserved: false,
        createPostRequestFailed: false,
        createPostStatus: null,
        postCreateEventGetRequestCountCapped: 0,
        postCreateRoomRangeGetRequestCountCapped: 0,
        postCreateRoomRangeGetResponseCountCapped: 0,
      }),
    }).failurePoint,
    { phase: 'desktop-event-create', point: 'event-create-setup' },
  );
  for (const row of [
    {
      phase: 'desktop-event-create',
      status: 'failed',
      failurePoint: 'room-id',
      desktopEventCreateDiagnostic: diagnostic,
    },
    {
      phase: 'desktop-room-widget-read',
      status: 'failed',
      failurePoint: 'event-create-post-status',
      desktopEventCreateDiagnostic: diagnostic,
    },
    {
      phase: 'desktop-event-create',
      status: 'failed',
      failurePoint: 'event-create-post-status',
    },
    {
      phase: 'desktop-event-create',
      status: 'failed',
      failurePoint: 'event-create-post-status',
      desktopEventCreateDiagnostic: {
        ...diagnostic,
        responseBody: 'private event response',
      },
    },
    {
      phase: 'desktop-event-create',
      status: 'failed',
      failurePoint: 'event-create-post-status',
      desktopEventCreateDiagnostic: makeDiagnostic({
        createPostObserved: false,
        createPostRequestFailed: false,
        createPostStatus: 503,
      }),
    },
    {
      phase: 'desktop-event-create',
      status: 'failed',
      failurePoint: 'event-create-post-status',
      desktopEventCreateDiagnostic: makeDiagnostic({
        createPostObserved: true,
        createPostRequestFailed: true,
        createPostStatus: 503,
      }),
    },
  ]) {
    assert.throws(() => summarize(row), /Invalid Desktop journey input/u);
  }
});

test('records room-navigation evidence only at its closed failure boundary', () => {
  const diagnostic = {
    currentOption: { countCapped: 0, visible: null, enabled: null },
    currentRow: { countCapped: 1, visible: false, enabled: false },
    legacyTreeItem: { countCapped: 2, visible: null, enabled: null },
    roomsReady: {
      roomList: { countCapped: 1, visibility: 'visible' },
      matrixChatShell: { countCapped: 1, visibility: 'visible' },
      matrixChatStateAvailable: true,
      matrixChatView: 'logged-in',
      matrixChatReady: true,
      matrixChatPageType: 'home-page',
      matrixChatCurrentRoomKnown: false,
      matrixChatCurrentRoomMatchesExpected: false,
      matrixChatSecurityFlowView: false,
      matrixClientMatchesMemberA: true,
    },
    clickProgress: {
      targetMatched: true,
      targetVisible: false,
      targetEnabled: false,
      clickStarted: true,
      clickResolved: false,
      elapsedBucket: '1_to_5s',
    },
  };
  withTempDirectory((runnerTemp) => {
    const filePath = join(runnerTemp, 'element-desktop-journey-stage.jsonl');
    initializeDesktopJourneyEvidence({ filePath, runnerTemp });
    appendDesktopJourneyOutcome({
      filePath,
      runnerTemp,
      phase: 'desktop-room-widget-read',
      status: 'failed',
      failurePoint: 'room-navigation',
      roomNavigationDiagnostic: diagnostic,
    });
    const summary = readDesktopJourneyEvidence({ filePath, runnerTemp });
    assert.equal(summary.schemaVersion, 19);
    assert.deepEqual(summary.roomNavigationDiagnostic, diagnostic);
    assert.equal(summary.roomsReadyDiagnostic, null);
    assert.deepEqual(
      Object.keys(summary.roomNavigationDiagnostic.clickProgress).sort(),
      [
        'clickResolved',
        'clickStarted',
        'elapsedBucket',
        'targetEnabled',
        'targetMatched',
        'targetVisible',
      ],
    );
    assert.doesNotMatch(
      JSON.stringify(summary.roomNavigationDiagnostic),
      /private room name|private-selector-value|roomId|selector/u,
    );
    assert.doesNotMatch(
      readFileSync(filePath, 'utf8'),
      /room-name|room-id|user-id|target-name/u,
    );

    for (const override of [
      {
        phase: 'desktop-room-widget-read',
        status: 'failed',
        failurePoint: 'room-heading',
      },
      {
        phase: 'desktop-member-identity',
        status: 'failed',
        failurePoint: 'room-navigation',
      },
      {
        phase: 'desktop-room-widget-read',
        status: 'passed',
        failurePoint: 'room-navigation',
      },
    ]) {
      assert.throws(
        () =>
          summarizeDesktopJourneyEvidence(
            JSON.stringify({
              ...override,
              roomNavigationDiagnostic: diagnostic,
            }),
          ),
        /Invalid Desktop journey input/u,
      );
    }
    for (const invalid of [
      { ...diagnostic, roomName: 'private room name' },
      {
        ...diagnostic,
        currentRow: { countCapped: 2, visible: false, enabled: false },
      },
      {
        ...diagnostic,
        currentOption: {
          countCapped: 1,
          visible: 'private text',
          enabled: true,
        },
      },
      {
        ...diagnostic,
        clickProgress: {
          ...diagnostic.clickProgress,
          targetVisible: 'private room name',
        },
      },
      {
        ...diagnostic,
        clickProgress: {
          ...diagnostic.clickProgress,
          elapsedBucket: 'private-selector-value',
        },
      },
    ]) {
      assert.throws(
        () =>
          summarizeDesktopJourneyEvidence(
            JSON.stringify({
              phase: 'desktop-room-widget-read',
              status: 'failed',
              failurePoint: 'room-navigation',
              roomNavigationDiagnostic: invalid,
            }),
          ),
        /Invalid Desktop journey input/u,
      );
    }

    const headingRunnerTemp = join(runnerTemp, 'heading');
    mkdirSync(headingRunnerTemp, { mode: 0o700 });
    const headingFilePath = join(
      headingRunnerTemp,
      'element-desktop-journey-stage.jsonl',
    );
    initializeDesktopJourneyEvidence({
      filePath: headingFilePath,
      runnerTemp: headingRunnerTemp,
    });
    appendDesktopJourneyOutcome({
      filePath: headingFilePath,
      runnerTemp: headingRunnerTemp,
      phase: 'desktop-room-widget-read',
      status: 'failed',
      failurePoint: 'room-heading',
      roomNavigationDiagnostic: {
        ...diagnostic,
        clickProgress: {
          ...diagnostic.clickProgress,
          clickResolved: true,
          elapsedBucket: 'under_1s',
        },
      },
    });
    const headingSummary = readDesktopJourneyEvidence({
      filePath: headingFilePath,
      runnerTemp: headingRunnerTemp,
    });
    assert.equal(
      headingSummary.roomNavigationDiagnostic?.clickProgress.clickResolved,
      true,
    );
  });
});

test('records closed gateway-read observations and distinguishes false from unavailable', () => {
  const observedDiagnostic = {
    eventsGetCandidateCountCapped: 2,
    expectedRoomCalendarGetObserved: true,
    widgetWarningObserved: false,
    widgetWarningContinued: false,
    capabilityPromptObserved: true,
    capabilityApproved: true,
    identityApprovalAttempted: true,
    identityApprovalCompleted: true,
    iframeAttached: true,
    createControlVisible: true,
  };
  const unavailableDiagnostic = {
    eventsGetCandidateCountCapped: null,
    expectedRoomCalendarGetObserved: null,
    widgetWarningObserved: null,
    widgetWarningContinued: null,
    capabilityPromptObserved: null,
    capabilityApproved: null,
    identityApprovalAttempted: null,
    identityApprovalCompleted: null,
    iframeAttached: null,
    createControlVisible: null,
  };

  withTempDirectory((runnerTemp) => {
    const filePath = join(runnerTemp, 'element-desktop-journey-stage.jsonl');
    initializeDesktopJourneyEvidence({ filePath, runnerTemp });
    appendDesktopJourneyOutcome({
      filePath,
      runnerTemp,
      phase: 'desktop-room-widget-read',
      status: 'failed',
      failurePoint: 'gateway-read-await',
      gatewayReadDiagnostic: observedDiagnostic,
    });

    const summary = readDesktopJourneyEvidence({ filePath, runnerTemp });
    assert.deepEqual(summary.gatewayReadDiagnostic, observedDiagnostic);
    assert.deepEqual(summary.failurePoint, {
      phase: 'desktop-room-widget-read',
      point: 'gateway-read-await',
    });
    const evidence = readFileSync(filePath, 'utf8');
    const row = JSON.parse(evidence);
    assert.deepEqual(Object.keys(row).sort(), [
      'failurePoint',
      'gatewayReadDiagnostic',
      'phase',
      'status',
    ]);
    assert.doesNotMatch(evidence, /https?:\/\/|access_token|private-title/u);
  });

  const unavailableSummary = summarizeDesktopJourneyEvidence(
    `${JSON.stringify({
      phase: 'desktop-room-widget-read',
      status: 'failed',
      failurePoint: 'widget-open',
      gatewayReadDiagnostic: unavailableDiagnostic,
    })}\n`,
  );
  assert.deepEqual(
    unavailableSummary.gatewayReadDiagnostic,
    unavailableDiagnostic,
  );
  assert.equal(
    unavailableSummary.gatewayReadDiagnostic.widgetWarningObserved,
    null,
  );
});

test('rejects inconsistent and open-ended gateway-read failure diagnostics', () => {
  const validDiagnostic = {
    eventsGetCandidateCountCapped: 1,
    expectedRoomCalendarGetObserved: false,
    widgetWarningObserved: false,
    widgetWarningContinued: false,
    capabilityPromptObserved: null,
    capabilityApproved: null,
    identityApprovalAttempted: null,
    identityApprovalCompleted: null,
    iframeAttached: false,
    createControlVisible: false,
  };
  const summarize = (row) =>
    summarizeDesktopJourneyEvidence(`${JSON.stringify(row)}\n`);
  const row = (gatewayReadDiagnostic) => ({
    phase: 'desktop-room-widget-read',
    status: 'failed',
    failurePoint: 'gateway-read-await',
    gatewayReadDiagnostic,
  });

  assert.doesNotThrow(() => summarize(row(validDiagnostic)));
  assert.doesNotThrow(() =>
    summarize(
      row({
        ...validDiagnostic,
        iframeAttached: true,
      }),
    ),
  );

  for (const diagnostic of [
    {
      ...validDiagnostic,
      eventsGetCandidateCountCapped: 0,
      expectedRoomCalendarGetObserved: true,
    },
    {
      ...validDiagnostic,
      eventsGetCandidateCountCapped: null,
      expectedRoomCalendarGetObserved: false,
    },
    {
      ...validDiagnostic,
      widgetWarningObserved: false,
      widgetWarningContinued: true,
    },
    {
      ...validDiagnostic,
      identityApprovalAttempted: false,
      identityApprovalCompleted: true,
    },
    {
      ...validDiagnostic,
      capabilityApproved: false,
      identityApprovalAttempted: true,
      identityApprovalCompleted: false,
    },
    {
      ...validDiagnostic,
      iframeAttached: false,
      createControlVisible: true,
    },
    { ...validDiagnostic, privateUrl: 'https://private.invalid/path' },
  ]) {
    assert.throws(
      () => summarize(row(diagnostic)),
      /Invalid Desktop journey input/u,
    );
  }

  assert.throws(
    () =>
      summarize({
        ...row(validDiagnostic),
        status: 'passed',
      }),
    /Invalid Desktop journey input/u,
  );
  assert.throws(
    () =>
      summarize({
        ...row(validDiagnostic),
        failurePoint: 'room-heading',
      }),
    /Invalid Desktop journey input/u,
  );
  assert.throws(
    () =>
      summarize({
        ...row(validDiagnostic),
        phase: 'desktop-widget-origin-isolation',
        failurePoint: 'origin-isolation',
      }),
    /Invalid Desktop journey input/u,
  );
});

test('accepts only the closed failure-point enum with its failed-phase match', () => {
  assert.deepEqual(
    [...DESKTOP_JOURNEY_FAILURE_POINTS],
    [
      'room-navigation',
      'room-heading',
      'room-id',
      'gateway-read-await',
      'widget-open',
      'gateway-read-status',
      'create-control',
      'origin-isolation',
      'event-create-setup',
      'event-create-control-click',
      'event-create-dialog-visible',
      'event-create-calendar-select',
      'event-create-title-fill',
      'event-create-submit-click',
      'event-create-post-await',
      'event-create-post-status',
      'event-create-exact-row-visible',
      'desktop-keyboard-focus-observation',
      'desktop-keyboard-focus-evidence',
      'desktop-keyboard-focus-assertion',
      'desktop-side-panel-layout-observation',
      'desktop-side-panel-layout-evidence',
      'desktop-side-panel-layout-assertion',
      'web-b-authentication',
      'web-b-room-navigation',
      'web-b-widget-open',
      'web-b-gateway-read-await',
      'web-b-gateway-read-status',
      'web-b-event-row',
      'web-b-edit-details-open',
      'web-b-edit-open',
      'web-b-edit-title-fill',
      'web-b-edit-save-click',
      'web-b-edit-patch-await',
      'web-b-edit-patch-status',
      'web-b-edit-details-returned',
      'web-b-edit-details-close-click',
      'web-b-edit-details-close-hidden',
      'web-b-edit-event-row',
      ...DESKTOP_A_REFRESH_FAILURE_POINTS,
    ],
  );

  const summarize = (row) =>
    summarizeDesktopJourneyEvidence(`${JSON.stringify(row)}\n`);
  assert.deepEqual(
    summarize({
      phase: 'desktop-widget-origin-isolation',
      status: 'failed',
      failurePoint: 'origin-isolation',
    }).failurePoint,
    {
      phase: 'desktop-widget-origin-isolation',
      point: 'origin-isolation',
    },
  );
  assert.deepEqual(
    summarize({
      phase: 'web-member-b-read',
      status: 'failed',
      failurePoint: 'web-b-event-row',
    }).failurePoint,
    {
      phase: 'web-member-b-read',
      point: 'web-b-event-row',
    },
  );

  for (const row of [
    {
      phase: 'desktop-room-widget-read',
      status: 'passed',
      failurePoint: 'gateway-read-status',
    },
    {
      phase: 'desktop-room-widget-read',
      status: 'failed',
      failurePoint: 'origin-isolation',
    },
    {
      phase: 'desktop-widget-origin-isolation',
      status: 'failed',
      failurePoint: 'create-control',
    },
    {
      phase: 'desktop-event-create',
      status: 'failed',
      failurePoint: 'room-id',
    },
    {
      phase: 'desktop-room-widget-read',
      status: 'failed',
      failurePoint: 'web-b-widget-open',
    },
    {
      phase: 'web-member-b-read',
      status: 'failed',
      failurePoint: 'widget-open',
    },
    {
      phase: 'web-member-b-read',
      status: 'passed',
      failurePoint: 'web-b-event-row',
    },
    {
      phase: 'web-member-b-keyboard-open',
      status: 'failed',
      failurePoint: 'web-b-event-row',
    },
    {
      phase: 'desktop-room-widget-read',
      status: 'failed',
      failurePoint: 'private-error-message',
    },
    {
      phase: 'desktop-room-widget-read',
      status: 'failed',
      failurePoint: 'room-navigation',
      message: 'private error text',
    },
  ]) {
    assert.throws(() => summarize(row), /Invalid Desktop journey input/u);
  }

  assert.throws(
    () =>
      summarizeDesktopJourneyEvidence(
        '{"phase":"desktop-room-widget-read","status":"failed","failurePoint":"room-heading"}\n' +
          '{"phase":"desktop-widget-origin-isolation","status":"failed","failurePoint":"origin-isolation"}\n',
      ),
    /Invalid Desktop journey input/u,
  );
});

test('bounds B row-render observations and keeps late results out of failure evidence', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let finishLateObservation;
  const lateObservation = observeWebBEditRowRenderWithinDeadline(
    () =>
      new Promise((resolve) => {
        finishLateObservation = resolve;
      }),
  );
  context.mock.timers.tick(500);
  const unavailable = unavailableWebBEditRowRenderDiagnostic();
  const failureEvidence = { eventRowRender: await lateObservation };
  assert.deepEqual(failureEvidence.eventRowRender, unavailable);
  assert.equal(typeof finishLateObservation, 'function');

  finishLateObservation({
    state: 'observed',
    editedRowCountCapped: 1,
    editedRowVisible: true,
    selectedRowCountCapped: 0,
    selectedRowVisible: false,
    calendarEventsListVisibleRowCountCapped: 1,
    progressbarVisible: false,
    errorAlertVisible: false,
  });
  await Promise.resolve();
  assert.deepEqual(failureEvidence.eventRowRender, unavailable);

  const rejected = await observeWebBEditRowRenderWithinDeadline(async () => {
    throw new Error('private browser failure');
  });
  assert.deepEqual(rejected, unavailable);
});

test('correlates failed B edit/save points with a bounded matched PATCH status', () => {
  const summarize = (row) =>
    summarizeDesktopJourneyEvidence(`${JSON.stringify(row)}\n`);
  const decodedEventList = {
    state: 'decoded',
    matchingGetRequestCountCapped: 1,
    matchingGetResponseCountCapped: 1,
    firstMatchedGetStatus: 200,
    selectedEventIdentity: 'available',
    sameEventObserved: true,
    sameEventEditedTitleMatch: true,
  };
  const observedRowRender = {
    state: 'observed',
    editedRowCountCapped: 0,
    editedRowVisible: false,
    selectedRowCountCapped: 1,
    selectedRowVisible: true,
    calendarEventsListVisibleRowCountCapped: 1,
    progressbarVisible: false,
    errorAlertVisible: false,
  };
  const unavailableRowRender = {
    state: 'unavailable',
    editedRowCountCapped: null,
    editedRowVisible: null,
    selectedRowCountCapped: null,
    selectedRowVisible: null,
    calendarEventsListVisibleRowCountCapped: null,
    progressbarVisible: null,
    errorAlertVisible: null,
  };
  const row = (
    failurePoint,
    matchedPatchStatus,
    eventListRead,
    eventRowRender = observedRowRender,
  ) => ({
    phase: 'web-member-b-edit-save',
    status: 'failed',
    failurePoint,
    webBEditSaveDiagnostic: {
      matchedPatchStatus,
      ...(eventListRead === undefined ? {} : { eventListRead }),
      ...(failurePoint === 'web-b-edit-event-row' ? { eventRowRender } : {}),
    },
  });

  for (const point of [
    'web-b-edit-details-open',
    'web-b-edit-open',
    'web-b-edit-title-fill',
    'web-b-edit-save-click',
    'web-b-edit-patch-await',
  ]) {
    assert.deepEqual(summarize(row(point, null)).webBEditSaveDiagnostic, {
      matchedPatchStatus: null,
    });
  }
  assert.deepEqual(
    summarize(row('web-b-edit-patch-status', 409)).webBEditSaveDiagnostic,
    { matchedPatchStatus: 409 },
  );
  for (const point of [
    'web-b-edit-details-returned',
    'web-b-edit-details-close-click',
    'web-b-edit-details-close-hidden',
  ]) {
    assert.deepEqual(summarize(row(point, 204)).webBEditSaveDiagnostic, {
      matchedPatchStatus: 204,
    });
  }
  assert.deepEqual(
    summarize(row('web-b-edit-event-row', 204, decodedEventList))
      .webBEditSaveDiagnostic,
    {
      matchedPatchStatus: 204,
      eventListRead: decodedEventList,
      eventRowRender: observedRowRender,
    },
  );
  assert.deepEqual(
    summarize(
      row('web-b-edit-event-row', 204, decodedEventList, unavailableRowRender),
    ).webBEditSaveDiagnostic.eventRowRender,
    unavailableRowRender,
  );
  const pendingRead = {
    state: 'request-pending',
    matchingGetRequestCountCapped: 1,
    matchingGetResponseCountCapped: 1,
    firstMatchedGetStatus: null,
    selectedEventIdentity: 'pending',
    sameEventObserved: null,
    sameEventEditedTitleMatch: null,
  };
  assert.deepEqual(
    summarize(row('web-b-edit-event-row', 204, pendingRead))
      .webBEditSaveDiagnostic.eventListRead,
    pendingRead,
  );
  assert.deepEqual(
    summarize(
      row('web-b-edit-event-row', 204, {
        ...decodedEventList,
        sameEventEditedTitleMatch: false,
      }),
    ).webBEditSaveDiagnostic.eventListRead.sameEventEditedTitleMatch,
    false,
  );
  const unavailableIdentityRead = {
    ...decodedEventList,
    selectedEventIdentity: 'unavailable',
    sameEventObserved: null,
    sameEventEditedTitleMatch: null,
  };
  assert.deepEqual(
    summarize(row('web-b-edit-event-row', 204, unavailableIdentityRead))
      .webBEditSaveDiagnostic.eventListRead,
    unavailableIdentityRead,
  );
  const failedGetRead = {
    state: 'status-not-200',
    matchingGetRequestCountCapped: 1,
    matchingGetResponseCountCapped: 1,
    firstMatchedGetStatus: 503,
    selectedEventIdentity: 'available',
    sameEventObserved: null,
    sameEventEditedTitleMatch: null,
  };
  assert.deepEqual(
    summarize(row('web-b-edit-event-row', 204, failedGetRead))
      .webBEditSaveDiagnostic.eventListRead,
    failedGetRead,
  );

  for (const invalid of [
    { ...row('web-b-edit-title-fill', 409) },
    { ...row('web-b-edit-patch-status', null) },
    { ...row('web-b-edit-patch-status', 200) },
    { ...row('web-b-edit-patch-status', 204) },
    { ...row('web-b-edit-patch-status', 299) },
    { ...row('web-b-edit-details-returned', null) },
    { ...row('web-b-edit-details-returned', 409) },
    { ...row('web-b-edit-details-close-click', 204, decodedEventList) },
    { ...row('web-b-edit-details-close-hidden', 204, decodedEventList) },
    { ...row('web-b-edit-event-row', 409, decodedEventList) },
    { ...row('web-b-edit-event-row', null, decodedEventList) },
    { ...row('web-b-edit-event-row', 204) },
    {
      ...row('web-b-edit-event-row', 204, {
        ...decodedEventList,
        matchingGetRequestCountCapped: 0,
      }),
    },
    {
      ...row('web-b-edit-event-row', 204, {
        ...decodedEventList,
        matchingGetResponseCountCapped: 0,
      }),
    },
    {
      ...row('web-b-edit-event-row', 204, {
        ...decodedEventList,
        firstMatchedGetStatus: 503,
      }),
    },
    {
      ...row('web-b-edit-event-row', 204, {
        ...failedGetRead,
        firstMatchedGetStatus: 200,
      }),
    },
    {
      ...row('web-b-edit-event-row', 204, {
        ...decodedEventList,
        selectedEventIdentity: 'unavailable',
      }),
    },
    {
      ...row('web-b-edit-event-row', 204, {
        ...decodedEventList,
        matchingGetResponseCountCapped: 2,
      }),
    },
    {
      ...row('web-b-edit-event-row', 204, {
        ...pendingRead,
        state: 'awaiting-patch',
      }),
    },
    { ...row('web-b-edit-title-fill', null, pendingRead) },
    {
      ...row('web-b-edit-event-row', 204, {
        ...pendingRead,
        matchingGetResponseCountCapped: 3,
      }),
    },
    {
      ...row('web-b-edit-event-row', 204, {
        ...decodedEventList,
        sameEventObserved: false,
      }),
    },
    {
      ...row('web-b-edit-event-row', 204, {
        ...decodedEventList,
        extra: 'private text',
      }),
    },
    {
      ...row('web-b-edit-event-row', 204, decodedEventList, {
        ...observedRowRender,
        editedRowVisible: true,
      }),
    },
    {
      ...row('web-b-edit-event-row', 204, decodedEventList, {
        ...observedRowRender,
        calendarEventsListVisibleRowCountCapped: 0,
      }),
    },
    {
      ...row('web-b-edit-event-row', 204, decodedEventList, {
        ...unavailableRowRender,
        errorAlertVisible: false,
      }),
    },
    {
      ...row('web-b-edit-event-row', 204, decodedEventList, {
        ...observedRowRender,
        selectedRowCountCapped: 3,
      }),
    },
    {
      ...row('web-b-edit-event-row', 204, decodedEventList, {
        ...observedRowRender,
        additional: 'private text',
      }),
    },
    {
      ...row('web-b-edit-event-row', 204, decodedEventList),
      webBEditSaveDiagnostic: {
        ...row('web-b-edit-event-row', 204, decodedEventList)
          .webBEditSaveDiagnostic,
        extra: 'private text',
      },
    },
    {
      ...row('web-b-edit-details-close-click', 204),
      webBEditSaveDiagnostic: {
        matchedPatchStatus: 204,
        eventRowRender: observedRowRender,
      },
    },
    { ...row('web-b-edit-patch-status', 99) },
    { ...row('web-b-edit-patch-status', 600) },
    { ...row('web-b-edit-patch-status', 409), body: 'private response' },
    {
      phase: 'web-member-b-edit-save',
      status: 'failed',
      failurePoint: 'web-b-edit-patch-status',
    },
    {
      phase: 'web-member-b-edit-save',
      status: 'passed',
      failurePoint: 'web-b-edit-patch-status',
      webBEditSaveDiagnostic: { matchedPatchStatus: 409 },
    },
    {
      ...row('web-b-edit-patch-status', 409),
      phase: 'web-member-b-read',
    },
  ]) {
    assert.throws(() => summarize(invalid), /Invalid Desktop journey input/u);
  }

  withTempDirectory((runnerTemp) => {
    const filePath = join(runnerTemp, 'element-desktop-journey-stage.jsonl');
    initializeDesktopJourneyEvidence({ filePath, runnerTemp });
    assert.throws(
      () =>
        appendDesktopJourneyOutcome({
          filePath,
          runnerTemp,
          phase: 'web-member-b-edit-save',
          status: 'failed',
          failurePoint: 'web-b-edit-event-row',
          webBEditSaveDiagnostic: {
            matchedPatchStatus: 204,
            eventListRead: decodedEventList,
          },
        }),
      /Invalid Desktop journey input/u,
    );
    appendDesktopJourneyOutcome({
      filePath,
      runnerTemp,
      phase: 'web-member-b-edit-save',
      status: 'failed',
      failurePoint: 'web-b-edit-patch-status',
      webBEditSaveDiagnostic: { matchedPatchStatus: 409 },
    });
    assert.equal(
      readFileSync(filePath, 'utf8'),
      '{"phase":"web-member-b-edit-save","status":"failed","failurePoint":"web-b-edit-patch-status","webBEditSaveDiagnostic":{"matchedPatchStatus":409}}\n',
    );
    assert.equal(
      readDesktopJourneyEvidence({ filePath, runnerTemp })
        .webBEditSaveDiagnostic.matchedPatchStatus,
      409,
    );
  });

  withTempDirectory((runnerTemp) => {
    const filePath = join(runnerTemp, 'element-desktop-journey-stage.jsonl');
    initializeDesktopJourneyEvidence({ filePath, runnerTemp });
    appendDesktopJourneyOutcome({
      filePath,
      runnerTemp,
      phase: 'web-member-b-edit-save',
      status: 'failed',
      failurePoint: 'web-b-edit-event-row',
      webBEditSaveDiagnostic: {
        matchedPatchStatus: 204,
        eventListRead: decodedEventList,
        eventRowRender: observedRowRender,
      },
    });
    const persisted = readFileSync(filePath, 'utf8');
    assert.equal(
      persisted,
      '{"phase":"web-member-b-edit-save","status":"failed","failurePoint":"web-b-edit-event-row","webBEditSaveDiagnostic":{"matchedPatchStatus":204,"eventListRead":{"state":"decoded","matchingGetRequestCountCapped":1,"matchingGetResponseCountCapped":1,"firstMatchedGetStatus":200,"selectedEventIdentity":"available","sameEventObserved":true,"sameEventEditedTitleMatch":true},"eventRowRender":{"state":"observed","editedRowCountCapped":0,"editedRowVisible":false,"selectedRowCountCapped":1,"selectedRowVisible":true,"calendarEventsListVisibleRowCountCapped":1,"progressbarVisible":false,"errorAlertVisible":false}}}\n',
    );
    assert.doesNotMatch(persisted, /private-event-id|private event title/u);
    assert.deepEqual(
      readDesktopJourneyEvidence({ filePath, runnerTemp })
        .webBEditSaveDiagnostic.eventRowRender,
      observedRowRender,
    );
  });
});

test('requires ordered Desktop refresh progress before a complete pass', () => {
  withTempDirectory((runnerTemp) => {
    const filePath = join(runnerTemp, 'element-desktop-journey-stage.jsonl');
    initializeDesktopJourneyEvidence({ filePath, runnerTemp });
    appendDesktopRefreshPrefix(filePath, runnerTemp);
    assert.equal(appendDesktopRefreshBegin(filePath, runnerTemp), true);
    for (const failurePoint of DESKTOP_A_REFRESH_FAILURE_POINTS) {
      assert.equal(
        appendDesktopRefreshPoint(filePath, runnerTemp, failurePoint),
        true,
      );
      assert.equal(
        appendDesktopRefreshComplete(filePath, runnerTemp, failurePoint),
        true,
      );
    }
    appendDesktopJourneyOutcome({
      filePath,
      runnerTemp,
      phase: 'desktop-a-refresh',
      status: 'passed',
    });
    for (const phase of DESKTOP_JOURNEY_PHASES.slice(
      DESKTOP_JOURNEY_PHASES.indexOf('desktop-a-refresh') + 1,
    )) {
      appendDesktopJourneyOutcome({
        filePath,
        runnerTemp,
        phase,
        status: 'passed',
      });
    }
    appendDesktopPlaywrightResult({
      filePath,
      runnerTemp,
      sourceSha: DESKTOP_REFRESH_SOURCE_SHA,
      status: 'passed',
    });
    appendDesktopChildCompletion({
      filePath,
      runnerTemp,
      sourceSha: DESKTOP_REFRESH_SOURCE_SHA,
      completion: { outcome: 'exited', exitStatus: 0, timedOut: false },
    });

    const summary = readDesktopJourneyEvidence({
      filePath,
      runnerTemp,
      expectedSourceSha: DESKTOP_REFRESH_SOURCE_SHA,
    });
    assert.equal(summary.schemaVersion, 19);
    assert.equal(summary.status, 'passed');
    assert.equal(summary.cases['desktop-a-refresh'], 'passed');
    assert.equal(summary.failureObservation, null);
    assert.doesNotMatch(
      readFileSync(filePath, 'utf8'),
      /private error|PRIVATE_TOKEN_SENTINEL/u,
    );
  });
});

test('reports uncaught Desktop refresh exceptions with fixed classifications', () => {
  withTempDirectory((runnerTemp) => {
    const filePath = join(runnerTemp, 'element-desktop-journey-stage.jsonl');
    initializeDesktopJourneyEvidence({ filePath, runnerTemp });
    appendDesktopRefreshPrefix(filePath, runnerTemp);
    appendDesktopRefreshBegin(filePath, runnerTemp);
    const failurePoint = 'desktop-refresh-room-navigation';
    for (const point of DESKTOP_A_REFRESH_FAILURE_POINTS.slice(
      0,
      DESKTOP_A_REFRESH_FAILURE_POINTS.indexOf(failurePoint),
    )) {
      appendDesktopRefreshPoint(filePath, runnerTemp, point);
      appendDesktopRefreshComplete(filePath, runnerTemp, point);
    }
    appendDesktopRefreshPoint(filePath, runnerTemp, failurePoint);
    appendDesktopUncaughtError({
      filePath,
      runnerTemp,
      sourceSha: DESKTOP_REFRESH_SOURCE_SHA,
      errorClass: classifyDesktopJourneyErrorClass(
        new Error('private room id, URL, and stack'),
      ),
    });

    const previousEnvironment = {
      stageFile: process.env.ELEMENT_DESKTOP_JOURNEY_STAGE_FILE,
      runnerTemp: process.env.RUNNER_TEMP,
      sourceSha: process.env.ELEMENT_DESKTOP_SOURCE_SHA,
    };
    process.env.ELEMENT_DESKTOP_JOURNEY_STAGE_FILE = filePath;
    process.env.RUNNER_TEMP = runnerTemp;
    process.env.ELEMENT_DESKTOP_SOURCE_SHA = DESKTOP_REFRESH_SOURCE_SHA;
    try {
      new ElementDesktopAcceptanceResultReporter().onEnd({
        status: 'failed',
        errors: [{ message: 'private Playwright error' }],
        title: 'private test title',
        attachments: [{ body: 'private attachment' }],
      });
    } finally {
      for (const [key, value] of Object.entries({
        ELEMENT_DESKTOP_JOURNEY_STAGE_FILE: previousEnvironment.stageFile,
        RUNNER_TEMP: previousEnvironment.runnerTemp,
        ELEMENT_DESKTOP_SOURCE_SHA: previousEnvironment.sourceSha,
      })) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
    appendDesktopChildCompletion({
      filePath,
      runnerTemp,
      sourceSha: DESKTOP_REFRESH_SOURCE_SHA,
      completion: { outcome: 'exited', exitStatus: 1, timedOut: false },
    });

    const raw = readFileSync(filePath, 'utf8');
    assert.doesNotMatch(
      raw,
      /private room id|URL|stack|private Playwright error|private test title|private attachment/u,
    );
    const summary = readDesktopJourneyEvidence({
      filePath,
      runnerTemp,
      expectedSourceSha: DESKTOP_REFRESH_SOURCE_SHA,
    });
    assert.equal(summary.schemaVersion, 19);
    assert.equal(summary.status, 'incomplete');
    assert.equal(summary.playwrightResult, 'failed');
    assert.deepEqual(summary.failureObservation, {
      kind: 'unexpected-child-exit',
      phase: 'desktop-a-refresh',
      failurePoint,
      errorClass: 'runtime',
    });
  });
});

test('records bounded Desktop refresh room-navigation progress', () => {
  const beforeClick = {
    roomListItemCountCapped: 2,
    targetCountCapped: null,
    fixtureRoomTargetVisible: true,
    centerHitObserved: null,
    centerHitWithinTarget: null,
    centerHitRole: 'unavailable',
    clickFailureClass: 'not_observed',
    roomIdMatchesAfterFailure: null,
    clickAttempted: false,
    clickCompleted: false,
    elapsedBucket: 'not_started',
    progressTimeline: [
      {
        stage: 'target_observed',
        roomListItemCountCapped: 2,
        fixtureRoomTargetVisible: true,
        elapsedBucket: 'not_started',
      },
    ],
  };
  const startedClick = {
    ...beforeClick,
    clickAttempted: true,
    elapsedBucket: 'not_completed',
    progressTimeline: [
      ...beforeClick.progressTimeline,
      {
        stage: 'click_started',
        roomListItemCountCapped: 2,
        fixtureRoomTargetVisible: true,
        elapsedBucket: 'under_1s',
      },
    ],
  };
  const afterClick = {
    ...startedClick,
    clickCompleted: true,
    elapsedBucket: '1_to_5s',
    progressTimeline: [
      ...startedClick.progressTimeline,
      {
        stage: 'click_resolved',
        roomListItemCountCapped: 2,
        fixtureRoomTargetVisible: true,
        elapsedBucket: '1_to_5s',
      },
    ],
  };
  withTempDirectory((runnerTemp) => {
    const filePath = join(runnerTemp, 'element-desktop-journey-stage.jsonl');
    initializeDesktopJourneyEvidence({ filePath, runnerTemp });
    appendDesktopRefreshPrefix(filePath, runnerTemp);
    appendDesktopRefreshBegin(filePath, runnerTemp);
    for (const failurePoint of DESKTOP_A_REFRESH_FAILURE_POINTS.slice(
      0,
      DESKTOP_A_REFRESH_FAILURE_POINTS.indexOf(
        'desktop-refresh-room-navigation',
      ),
    )) {
      appendDesktopRefreshPoint(filePath, runnerTemp, failurePoint);
      appendDesktopRefreshComplete(filePath, runnerTemp, failurePoint);
    }
    assert.throws(
      () => appendDesktopRefreshStarted(filePath, runnerTemp, startedClick),
      /Invalid Desktop journey input/u,
    );
    assert.equal(
      appendDesktopRefreshPoint(
        filePath,
        runnerTemp,
        'desktop-refresh-room-navigation',
        beforeClick,
      ),
      true,
    );
    assert.throws(
      () =>
        appendDesktopRefreshStarted(filePath, runnerTemp, {
          ...startedClick,
          elapsedBucket: 'not_started',
        }),
      /Invalid Desktop journey input/u,
    );
    assert.equal(
      appendDesktopRefreshStarted(filePath, runnerTemp, startedClick),
      true,
    );
    assert.throws(
      () => appendDesktopRefreshStarted(filePath, runnerTemp, startedClick),
      /Invalid Desktop journey input/u,
    );
    appendDesktopChildCompletion({
      filePath,
      runnerTemp,
      sourceSha: DESKTOP_REFRESH_SOURCE_SHA,
      completion: { outcome: 'exited', exitStatus: 1, timedOut: false },
    });
    appendDesktopPlaywrightResult({
      filePath,
      runnerTemp,
      sourceSha: DESKTOP_REFRESH_SOURCE_SHA,
      status: 'failed',
    });

    const summary = readDesktopJourneyEvidence({
      filePath,
      runnerTemp,
      expectedSourceSha: DESKTOP_REFRESH_SOURCE_SHA,
    });
    assert.equal(summary.status, 'incomplete');
    assert.deepEqual(summary.failureObservation, {
      kind: 'unexpected-child-exit',
      phase: 'desktop-a-refresh',
      failurePoint: 'desktop-refresh-room-navigation',
      errorClass: null,
    });
    assert.deepEqual(
      summary.desktopRefreshRoomNavigationDiagnostic,
      startedClick,
    );
    assert.equal(summary.desktopChildCompletion.exitStatus, 1);
    assert.equal(summary.desktopChildCompletion.timedOut, false);
    assert.doesNotMatch(
      readFileSync(filePath, 'utf8'),
      /fixture room|room-name|room-id|private URL/u,
    );
  });

  withTempDirectory((runnerTemp) => {
    const filePath = join(runnerTemp, 'element-desktop-journey-stage.jsonl');
    initializeDesktopJourneyEvidence({ filePath, runnerTemp });
    appendDesktopRefreshPrefix(filePath, runnerTemp);
    appendDesktopRefreshBegin(filePath, runnerTemp);
    for (const failurePoint of DESKTOP_A_REFRESH_FAILURE_POINTS.slice(
      0,
      DESKTOP_A_REFRESH_FAILURE_POINTS.indexOf(
        'desktop-refresh-room-navigation',
      ),
    )) {
      appendDesktopRefreshPoint(filePath, runnerTemp, failurePoint);
      appendDesktopRefreshComplete(filePath, runnerTemp, failurePoint);
    }
    appendDesktopRefreshPoint(
      filePath,
      runnerTemp,
      'desktop-refresh-room-navigation',
      beforeClick,
    );
    appendDesktopRefreshStarted(filePath, runnerTemp, startedClick);
    appendDesktopRefreshComplete(
      filePath,
      runnerTemp,
      'desktop-refresh-room-navigation',
      afterClick,
    );
    assert.deepEqual(
      readDesktopJourneyEvidence({ filePath, runnerTemp })
        .desktopRefreshRoomNavigationDiagnostic,
      afterClick,
    );
  });

  for (const invalid of [
    { ...beforeClick, roomName: 'private room name' },
    { ...beforeClick, roomListItemCountCapped: 3 },
    { ...beforeClick, fixtureRoomTargetVisible: 'private room name' },
    { ...beforeClick, elapsedBucket: 1_237 },
    { ...beforeClick, clickAttempted: true },
    { ...afterClick, clickCompleted: false },
    {
      ...beforeClick,
      progressTimeline: [
        ...beforeClick.progressTimeline,
        {
          stage: 'click_started',
          roomListItemCountCapped: 2,
          fixtureRoomTargetVisible: true,
          elapsedBucket: 'under_1s',
        },
      ],
    },
    {
      ...afterClick,
      progressTimeline: afterClick.progressTimeline.map((sample, index) =>
        index === 1 ? { ...sample, roomName: 'private room name' } : sample,
      ),
    },
    {
      ...afterClick,
      progressTimeline: [
        ...afterClick.progressTimeline,
        afterClick.progressTimeline.at(-1),
      ],
    },
  ]) {
    assert.throws(
      () =>
        appendDesktopRefreshPoint(
          '/tmp/unused-stage.jsonl',
          '/tmp',
          'desktop-refresh-room-navigation',
          invalid,
        ),
      /Invalid Desktop journey input/u,
    );
  }
});

test('rejects malformed room-navigation diagnostics while parsing evidence', () => {
  const diagnostic = {
    roomListItemCountCapped: 2,
    targetCountCapped: null,
    fixtureRoomTargetVisible: true,
    centerHitObserved: null,
    centerHitWithinTarget: null,
    centerHitRole: 'unavailable',
    clickFailureClass: 'not_observed',
    roomIdMatchesAfterFailure: null,
    clickAttempted: false,
    clickCompleted: false,
    elapsedBucket: 'not_started',
    progressTimeline: [
      {
        stage: 'target_observed',
        roomListItemCountCapped: 2,
        fixtureRoomTargetVisible: true,
        elapsedBucket: 'not_started',
      },
    ],
  };

  for (const malformedDiagnostic of [
    { ...diagnostic, unexpectedKey: true },
    { ...diagnostic, roomListItemCountCapped: 3 },
    { ...diagnostic, clickFailureClass: 'private room title' },
    {
      ...diagnostic,
      progressTimeline: [
        ...diagnostic.progressTimeline,
        { stage: 'click_started', roomName: 'private room name' },
      ],
    },
  ]) {
    withTempDirectory((runnerTemp) => {
      const filePath = join(runnerTemp, 'element-desktop-journey-stage.jsonl');
      initializeDesktopJourneyEvidence({ filePath, runnerTemp });
      appendDesktopRefreshPrefix(filePath, runnerTemp);
      appendDesktopRefreshBegin(filePath, runnerTemp);
      for (const failurePoint of DESKTOP_A_REFRESH_FAILURE_POINTS.slice(
        0,
        DESKTOP_A_REFRESH_FAILURE_POINTS.indexOf(
          'desktop-refresh-room-navigation',
        ),
      )) {
        appendDesktopRefreshPoint(filePath, runnerTemp, failurePoint);
        appendDesktopRefreshComplete(filePath, runnerTemp, failurePoint);
      }
      appendDesktopRefreshPoint(
        filePath,
        runnerTemp,
        'desktop-refresh-room-navigation',
        diagnostic,
      );

      const rows = readFileSync(filePath, 'utf8')
        .trimEnd()
        .split('\n')
        .map((row) => JSON.parse(row));
      const diagnosticRow = rows.find(
        (row) =>
          row.type === 'desktop-journey-progress' &&
          row.event === 'point' &&
          row.failurePoint === 'desktop-refresh-room-navigation',
      );
      diagnosticRow.desktopRefreshRoomNavigationDiagnostic =
        malformedDiagnostic;

      assert.throws(
        () =>
          summarizeDesktopJourneyEvidence(rows.map(JSON.stringify).join('\n')),
        /Invalid Desktop journey input/u,
      );
    });
  }
});

test('records only bounded failed refresh room-navigation progress', () => {
  const failedDiagnostic = {
    roomListItemCountCapped: 1,
    targetCountCapped: 1,
    fixtureRoomTargetVisible: true,
    centerHitObserved: true,
    centerHitWithinTarget: false,
    centerHitRole: 'button',
    clickFailureClass: 'pointer_interception',
    roomIdMatchesAfterFailure: false,
    clickAttempted: true,
    clickCompleted: false,
    elapsedBucket: '5_to_15s',
    progressTimeline: [
      {
        stage: 'target_observed',
        roomListItemCountCapped: 1,
        fixtureRoomTargetVisible: true,
        elapsedBucket: 'not_started',
      },
      {
        stage: 'click_started',
        roomListItemCountCapped: 1,
        fixtureRoomTargetVisible: true,
        elapsedBucket: 'under_1s',
      },
      {
        stage: 'click_failed',
        roomListItemCountCapped: 1,
        fixtureRoomTargetVisible: true,
        elapsedBucket: '5_to_15s',
      },
    ],
  };
  const startedDiagnostic = {
    ...failedDiagnostic,
    targetCountCapped: null,
    centerHitObserved: null,
    centerHitWithinTarget: null,
    centerHitRole: 'unavailable',
    clickFailureClass: 'not_observed',
    roomIdMatchesAfterFailure: null,
    elapsedBucket: 'not_completed',
    progressTimeline: failedDiagnostic.progressTimeline.slice(0, 2),
  };
  withTempDirectory((runnerTemp) => {
    const filePath = join(runnerTemp, 'element-desktop-journey-stage.jsonl');
    initializeDesktopJourneyEvidence({ filePath, runnerTemp });
    appendDesktopRefreshPrefix(filePath, runnerTemp);
    appendDesktopRefreshBegin(filePath, runnerTemp);
    for (const failurePoint of DESKTOP_A_REFRESH_FAILURE_POINTS.slice(
      0,
      DESKTOP_A_REFRESH_FAILURE_POINTS.indexOf(
        'desktop-refresh-room-navigation',
      ),
    )) {
      appendDesktopRefreshPoint(filePath, runnerTemp, failurePoint);
      appendDesktopRefreshComplete(filePath, runnerTemp, failurePoint);
    }
    appendDesktopRefreshPoint(
      filePath,
      runnerTemp,
      'desktop-refresh-room-navigation',
      {
        ...startedDiagnostic,
        clickAttempted: false,
        elapsedBucket: 'not_started',
        progressTimeline: failedDiagnostic.progressTimeline.slice(0, 1),
      },
    );
    appendDesktopRefreshStarted(filePath, runnerTemp, startedDiagnostic);
    assert.equal(
      appendDesktopRefreshFailureWithFallback({
        filePath,
        runnerTemp,
        failurePoint: 'desktop-refresh-room-navigation',
        errorClass: 'timeout',
        desktopRefreshRoomNavigationDiagnostic: failedDiagnostic,
      }),
      true,
    );
    appendDesktopPlaywrightResult({
      filePath,
      runnerTemp,
      sourceSha: DESKTOP_REFRESH_SOURCE_SHA,
      status: 'failed',
    });
    appendDesktopChildCompletion({
      filePath,
      runnerTemp,
      sourceSha: DESKTOP_REFRESH_SOURCE_SHA,
      completion: { outcome: 'exited', exitStatus: 1, timedOut: false },
    });

    const summary = readDesktopJourneyEvidence({
      filePath,
      runnerTemp,
      expectedSourceSha: DESKTOP_REFRESH_SOURCE_SHA,
    });
    assert.equal(summary.status, 'failed');
    assert.equal(
      summary.failureObservation.failurePoint,
      'desktop-refresh-room-navigation',
    );
    assert.deepEqual(
      summary.desktopRefreshRoomNavigationDiagnostic,
      failedDiagnostic,
    );
    assert.doesNotMatch(
      readFileSync(filePath, 'utf8'),
      /room-name|room-id|private|token|raw error/iu,
    );
  });
});

test('classifies caught Desktop refresh errors without persisting error text', () => {
  withTempDirectory((runnerTemp) => {
    const filePath = join(runnerTemp, 'element-desktop-journey-stage.jsonl');
    const privateError = new Error('private assertion, URL, and room text');
    initializeDesktopJourneyEvidence({ filePath, runnerTemp });
    appendDesktopRefreshPrefix(filePath, runnerTemp);
    appendDesktopRefreshBegin(filePath, runnerTemp);
    const failurePoint = DESKTOP_A_REFRESH_FAILURE_POINTS[2];
    for (const point of DESKTOP_A_REFRESH_FAILURE_POINTS.slice(0, 3)) {
      appendDesktopRefreshPoint(filePath, runnerTemp, point);
      if (point !== failurePoint) {
        appendDesktopRefreshComplete(filePath, runnerTemp, point);
      }
    }
    appendDesktopJourneyOutcome({
      filePath,
      runnerTemp,
      phase: 'desktop-a-refresh',
      status: 'failed',
      failurePoint,
      errorClass: classifyDesktopJourneyErrorClass(privateError),
    });
    appendDesktopPlaywrightResult({
      filePath,
      runnerTemp,
      sourceSha: DESKTOP_REFRESH_SOURCE_SHA,
      status: 'failed',
    });
    appendDesktopChildCompletion({
      filePath,
      runnerTemp,
      sourceSha: DESKTOP_REFRESH_SOURCE_SHA,
      completion: { outcome: 'exited', exitStatus: 1, timedOut: false },
    });

    const summary = readDesktopJourneyEvidence({
      filePath,
      runnerTemp,
      expectedSourceSha: DESKTOP_REFRESH_SOURCE_SHA,
    });
    assert.equal(summary.status, 'failed');
    assert.deepEqual(summary.failureObservation, {
      kind: 'caught-error',
      phase: 'desktop-a-refresh',
      failurePoint,
      errorClass: 'runtime',
    });
    assert.doesNotMatch(
      readFileSync(filePath, 'utf8'),
      /private assertion|URL|room text/u,
    );
    assert.equal(classifyDesktopJourneyErrorClass({}), 'unknown');
    const timeout = new Error();
    timeout.name = 'TimeoutError';
    assert.equal(classifyDesktopJourneyErrorClass(timeout), 'timeout');
    const assertion = new Error();
    assertion.name = 'AssertionError';
    assert.equal(classifyDesktopJourneyErrorClass(assertion), 'assertion');
  });
});

test('classifies Desktop room-navigation click failures into closed reasons', () => {
  const timeout = new Error('Playwright timed out');
  timeout.name = 'TimeoutError';
  assert.equal(
    classifyDesktopRoomNavigationClickFailure(timeout),
    'playwright_timeout',
  );
  assert.equal(
    classifyDesktopRoomNavigationClickFailure(
      new Error('another element intercepts pointer events'),
    ),
    'pointer_interception',
  );
  assert.equal(
    classifyDesktopRoomNavigationClickFailure(
      new Error('waiting for scheduled navigations to finish'),
    ),
    'navigation_wait',
  );
  assert.equal(
    classifyDesktopRoomNavigationClickFailure(new Error('Frame was detached')),
    'frame_gone',
  );
  assert.equal(
    classifyDesktopRoomNavigationClickFailure(
      new Error('private room title and private URL'),
    ),
    'other',
  );
});

test('refresh failure fallback records the minimal error when optional diagnostics fail', () => {
  withTempDirectory((runnerTemp) => {
    const filePath = join(runnerTemp, 'element-desktop-journey-stage.jsonl');
    initializeDesktopJourneyEvidence({ filePath, runnerTemp });
    appendDesktopRefreshPrefix(filePath, runnerTemp);
    appendDesktopRefreshBegin(filePath, runnerTemp);
    const failurePoint = DESKTOP_A_REFRESH_FAILURE_POINTS[4];
    for (const point of DESKTOP_A_REFRESH_FAILURE_POINTS.slice(0, 5)) {
      appendDesktopRefreshPoint(filePath, runnerTemp, point);
      if (point !== failurePoint) {
        appendDesktopRefreshComplete(filePath, runnerTemp, point);
      }
    }

    assert.equal(
      appendDesktopRefreshFailureWithFallback({
        filePath,
        runnerTemp,
        failurePoint,
        errorClass: 'assertion',
        roomNavigationDiagnostic: { invalid: 'private diagnostic content' },
      }),
      true,
    );

    const summary = readDesktopJourneyEvidence({
      filePath,
      runnerTemp,
      expectedSourceSha: DESKTOP_REFRESH_SOURCE_SHA,
    });
    assert.deepEqual(summary.failureObservation, {
      kind: 'caught-error',
      phase: 'desktop-a-refresh',
      failurePoint,
      errorClass: 'assertion',
    });
    assert.doesNotMatch(
      readFileSync(filePath, 'utf8'),
      /private diagnostic content/u,
    );
  });
});

test('projects a failed refresh when final route enforcement is not eligible', () => {
  withTempDirectory((runnerTemp) => {
    const filePath = join(runnerTemp, 'element-desktop-journey-stage.jsonl');
    const failurePoint = 'desktop-refresh-widget-frame';
    const recorded = new Set(DESKTOP_REFRESH_PRIOR_PHASES);
    initializeDesktopJourneyEvidence({ filePath, runnerTemp });
    appendDesktopRefreshPrefix(filePath, runnerTemp);
    appendDesktopRefreshBegin(filePath, runnerTemp);
    appendDesktopRefreshPoint(filePath, runnerTemp, failurePoint);
    if (
      appendDesktopRefreshFailureWithFallback({
        filePath,
        runnerTemp,
        failurePoint,
        errorClass: 'timeout',
      })
    ) {
      recorded.add('desktop-a-refresh');
    }
    assert.equal(recorded.has('desktop-a-refresh'), true);
    const routeOutcome = desktopRouteEnforcementOutcome({
      failed: true,
      recorded,
      observedHttpRequests: 1,
      blockedHttpRequests: 0,
    });
    assert.equal(routeOutcome, undefined);
    if (routeOutcome !== undefined) {
      appendDesktopJourneyOutcome({
        filePath,
        runnerTemp,
        phase: 'web-http-route-enforcement',
        status: routeOutcome,
      });
    }

    appendDesktopPlaywrightResult({
      filePath,
      runnerTemp,
      sourceSha: DESKTOP_REFRESH_SOURCE_SHA,
      status: 'failed',
    });
    appendDesktopChildCompletion({
      filePath,
      runnerTemp,
      sourceSha: DESKTOP_REFRESH_SOURCE_SHA,
      completion: { outcome: 'exited', exitStatus: 1, timedOut: false },
    });

    const summary = readDesktopJourneyEvidence({
      filePath,
      runnerTemp,
      expectedSourceSha: DESKTOP_REFRESH_SOURCE_SHA,
    });
    assert.equal(summary.status, 'failed');
    assert.equal(summary.cases['desktop-a-refresh'], 'failed');
    assert.equal(summary.cases['web-http-route-enforcement'], 'not_run');
    assert.deepEqual(summary.failureObservation, {
      kind: 'caught-error',
      phase: 'desktop-a-refresh',
      failurePoint,
      errorClass: 'timeout',
    });
  });
});

test('rejects orphaned, reordered, malformed, or unexecuted Desktop refresh evidence', () => {
  const sourceSha = DESKTOP_REFRESH_SOURCE_SHA;
  const priorRows = DESKTOP_REFRESH_PRIOR_PHASES.flatMap((phase) => [
    { phase, status: 'passed' },
    ...(phase === 'desktop-login'
      ? [{ loginStep: 'complete', loginEntry: 'password_form_present' }]
      : []),
  ]);
  const begin = {
    type: 'desktop-journey-progress',
    event: 'begin',
    sourceSha,
    phase: 'desktop-a-refresh',
  };
  const point = (failurePoint, extra = {}) => ({
    type: 'desktop-journey-progress',
    event: 'point',
    sourceSha,
    phase: 'desktop-a-refresh',
    failurePoint,
    ...extra,
  });
  const summarize = (rows) =>
    summarizeDesktopJourneyEvidence(
      `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`,
      { expectedSourceSha: sourceSha },
    );
  const assertRejected = (rows) =>
    assert.throws(() => summarize(rows), /Invalid Desktop journey input/u);

  assertRejected([...priorRows, point(DESKTOP_A_REFRESH_FAILURE_POINTS[0])]);
  assertRejected([...priorRows.slice(0, -1), begin]);
  assertRejected([...priorRows, begin, begin]);
  assertRejected([
    ...priorRows,
    begin,
    point(DESKTOP_A_REFRESH_FAILURE_POINTS[1]),
  ]);
  assertRejected([...priorRows, { ...begin, phase: 'canonical-edit-read' }]);
  assertRejected([
    ...priorRows,
    begin,
    point(DESKTOP_A_REFRESH_FAILURE_POINTS[0], {
      accessToken: 'PRIVATE_SENTINEL_SHOULD_NOT_EMIT',
    }),
  ]);
  assertRejected([
    ...priorRows,
    begin,
    ...DESKTOP_A_REFRESH_FAILURE_POINTS.flatMap((failurePoint, index) => [
      point(failurePoint),
      ...(index === DESKTOP_A_REFRESH_FAILURE_POINTS.length - 1
        ? []
        : [
            {
              type: 'desktop-journey-progress',
              event: 'complete',
              sourceSha,
              phase: 'desktop-a-refresh',
              failurePoint,
            },
          ]),
    ]),
    { phase: 'desktop-a-refresh', status: 'passed' },
  ]);
  assertRejected([
    ...priorRows,
    begin,
    point(DESKTOP_A_REFRESH_FAILURE_POINTS[0]),
    {
      phase: 'desktop-a-refresh',
      status: 'failed',
      failurePoint: DESKTOP_A_REFRESH_FAILURE_POINTS[1],
      errorClass: 'runtime',
    },
  ]);
  assertRejected([
    ...priorRows,
    begin,
    {
      type: 'desktop-journey-progress',
      event: 'complete',
      sourceSha,
      phase: 'desktop-a-refresh',
      failurePoint: DESKTOP_A_REFRESH_FAILURE_POINTS[0],
    },
  ]);
  assertRejected([
    ...priorRows,
    begin,
    point(DESKTOP_A_REFRESH_FAILURE_POINTS[0]),
    point(DESKTOP_A_REFRESH_FAILURE_POINTS[1]),
  ]);
  assertRejected([
    ...priorRows,
    begin,
    point(DESKTOP_A_REFRESH_FAILURE_POINTS[0]),
    {
      type: 'desktop-journey-progress',
      event: 'complete',
      sourceSha,
      phase: 'desktop-a-refresh',
      failurePoint: DESKTOP_A_REFRESH_FAILURE_POINTS[1],
    },
  ]);
  assertRejected([
    ...priorRows,
    begin,
    point(DESKTOP_A_REFRESH_FAILURE_POINTS[0]),
    {
      phase: 'desktop-a-refresh',
      status: 'failed',
      failurePoint: DESKTOP_A_REFRESH_FAILURE_POINTS[0],
      errorClass: 'private-error-message',
    },
  ]);
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
      'welcome_sign_in',
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
      entry: 'welcome_sign_in_clicked',
    });

    const summary = readDesktopJourneyEvidence({ filePath, runnerTemp });
    assert.equal(summary.loginStep, 'sign_in_submit');
    assert.equal(summary.loginEntry, 'welcome_sign_in_clicked');
    assert.equal(summary.roomsReadyDiagnostic, null);
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
    assert.throws(
      () =>
        summarizeDesktopJourneyEvidence(
          '{"loginStep":"complete","loginEntry":"private"}\n',
        ),
      /Invalid Desktop journey input/u,
    );
    assert.throws(
      () =>
        summarizeDesktopJourneyEvidence(
          '{"loginStep":"username_fill","loginEntry":"welcome_sign_in_attempted"}\n',
        ),
      /Invalid Desktop journey input/u,
    );
    assert.throws(
      () =>
        summarizeDesktopJourneyEvidence(
          '{"phase":"desktop-login","status":"passed"}\n' +
            '{"loginStep":"complete","loginEntry":"welcome_sign_in_attempted"}\n',
        ),
      /Invalid Desktop journey input/u,
    );
    assert.equal(
      readFileSync(filePath, 'utf8'),
      '{"loginStep":"sign_in_submit","loginEntry":"welcome_sign_in_clicked"}\n',
    );
  });
});

test('follows the Welcome sign-in link before filling and skips it when login is already open', async () => {
  const field = (present) =>
    present
      ? {
          countCapped: 1,
          visible: true,
          enabled: true,
          editable: true,
        }
      : {
          countCapped: 0,
          visible: null,
          enabled: null,
          editable: null,
        };
  const welcomeForm = {
    username: field(false),
    password: field(false),
  };
  const passwordForm = {
    username: field(true),
    password: field(true),
  };
  const flow = [];
  const steps = [];
  const entries = [];
  let welcomeOpened = false;
  const afterWelcome = await enterDesktopPasswordLogin({
    initialForm: welcomeForm,
    clickWelcomeSignIn: async () => {
      flow.push('welcome-sign-in-click');
      welcomeOpened = true;
    },
    observeForm: async () => (welcomeOpened ? passwordForm : welcomeForm),
    onBeforeFill: (form) => assert.deepEqual(form, passwordForm),
    fillCredentials: async () => {
      flow.push('username-fill', 'password-fill');
    },
    setLoginEntry: (entry) => entries.push(entry),
    setLoginStep: (step) => steps.push(step),
  });
  assert.deepEqual(afterWelcome, passwordForm);
  assert.deepEqual(flow, [
    'welcome-sign-in-click',
    'username-fill',
    'password-fill',
  ]);
  assert.deepEqual(entries, [
    'welcome_sign_in_attempted',
    'welcome_sign_in_clicked',
  ]);
  assert.deepEqual(steps, ['welcome_sign_in', 'login_form_select']);

  const alreadyOpenFlow = [];
  const alreadyOpenEntries = [];
  const alreadyOpen = await enterDesktopPasswordLogin({
    initialForm: passwordForm,
    clickWelcomeSignIn: async () => {
      alreadyOpenFlow.push('unexpected-welcome-click');
    },
    observeForm: async () => {
      assert.fail('already-open login form does not need a second observation');
    },
    onBeforeFill: (form) => assert.deepEqual(form, passwordForm),
    fillCredentials: async () => {
      alreadyOpenFlow.push('username-fill', 'password-fill');
    },
    setLoginEntry: (entry) => alreadyOpenEntries.push(entry),
    setLoginStep: () =>
      assert.fail('already-open login form does not change login step'),
  });
  assert.deepEqual(alreadyOpen, passwordForm);
  assert.deepEqual(alreadyOpenFlow, ['username-fill', 'password-fill']);
  assert.deepEqual(alreadyOpenEntries, ['password_form_present']);
  assert.deepEqual(
    [...DESKTOP_LOGIN_ENTRIES],
    [
      'not_observed',
      'password_form_present',
      'welcome_sign_in_attempted',
      'welcome_sign_in_clicked',
    ],
  );
});

test('requires an enabled Create control and orders Desktop widget consent around cold and ready paths', async () => {
  const readyObservation = {
    createControlCountCapped: 1,
    createControlVisible: true,
    createControlEnabled: true,
    capabilityPromptVisible: false,
  };
  assert.equal(desktopWidgetIsReady(readyObservation), true);
  assert.equal(
    desktopWidgetIsReady({
      ...readyObservation,
      createControlEnabled: false,
    }),
    false,
  );
  assert.equal(
    desktopWidgetIsReady({
      ...readyObservation,
      capabilityPromptVisible: null,
    }),
    false,
  );

  const readyPath = [];
  await prepareDesktopWidget({
    isReady: async () => {
      readyPath.push('readiness');
      return true;
    },
    isIframeVisible: async () => {
      readyPath.push('unexpected-iframe-check');
      return true;
    },
    activateWidget: async () => readyPath.push('unexpected-activation'),
    approveWarning: async () => readyPath.push('warning-check'),
    approveCapabilities: async () => readyPath.push('unexpected-capabilities'),
    waitForIdentityContinue: async () => {
      readyPath.push('identity-check');
      return false;
    },
    approveIdentity: async () => readyPath.push('unexpected-identity'),
    waitForIframe: async () => readyPath.push('unexpected-iframe-wait'),
  });
  assert.deepEqual(readyPath, ['readiness', 'warning-check', 'identity-check']);

  const disabledPlaceholderPath = [];
  await prepareDesktopWidget({
    isReady: async () => {
      disabledPlaceholderPath.push('readiness');
      return false;
    },
    isIframeVisible: async () => {
      disabledPlaceholderPath.push('iframe-visible');
      return true;
    },
    activateWidget: async () =>
      disabledPlaceholderPath.push('unexpected-activation'),
    approveWarning: async () => disabledPlaceholderPath.push('warning'),
    approveCapabilities: async () =>
      disabledPlaceholderPath.push('capabilities'),
    waitForIdentityContinue: async () => {
      disabledPlaceholderPath.push('identity-check');
      return true;
    },
    approveIdentity: async () => disabledPlaceholderPath.push('identity'),
    waitForIframe: async () => disabledPlaceholderPath.push('iframe-wait'),
  });
  assert.deepEqual(disabledPlaceholderPath, [
    'readiness',
    'iframe-visible',
    'warning',
    'capabilities',
    'identity-check',
    'identity',
    'iframe-wait',
  ]);

  const coldPath = [];
  await prepareDesktopWidget({
    isReady: async () => {
      coldPath.push('readiness');
      return false;
    },
    isIframeVisible: async () => {
      coldPath.push('iframe-visible');
      return false;
    },
    activateWidget: async () => coldPath.push('activate'),
    approveWarning: async () => coldPath.push('warning'),
    approveCapabilities: async () => coldPath.push('capabilities'),
    waitForIdentityContinue: async () => {
      coldPath.push('identity-check');
      return false;
    },
    approveIdentity: async () => coldPath.push('unexpected-identity'),
    waitForIframe: async () => coldPath.push('iframe-wait'),
  });
  assert.deepEqual(coldPath, [
    'readiness',
    'iframe-visible',
    'activate',
    'warning',
    'capabilities',
    'identity-check',
    'iframe-wait',
  ]);
});

test('uses the exact visible read-only event as widget readiness without requiring Create permission', async () => {
  const readyObservation = {
    expectedEventRowCountCapped: 1,
    expectedEventRowVisible: true,
    capabilityPromptVisible: false,
  };
  assert.equal(readOnlyWidgetIsReady(readyObservation), true);
  for (const observation of [
    {
      ...readyObservation,
      expectedEventRowCountCapped: 0,
      expectedEventRowVisible: null,
    },
    {
      ...readyObservation,
      expectedEventRowCountCapped: 2,
      expectedEventRowVisible: null,
    },
    { ...readyObservation, expectedEventRowVisible: false },
    { ...readyObservation, expectedEventRowVisible: null },
    { ...readyObservation, capabilityPromptVisible: true },
    { ...readyObservation, capabilityPromptVisible: null },
  ]) {
    assert.equal(readOnlyWidgetIsReady(observation), false);
  }
  assert.throws(
    () =>
      readOnlyWidgetIsReady({
        ...readyObservation,
        expectedEventRowCountCapped: 0,
        expectedEventRowVisible: true,
      }),
    /Invalid Desktop journey input/u,
  );
  assert.throws(
    () =>
      readOnlyWidgetIsReady({
        ...readyObservation,
        privateTitle: 'sensitive event',
      }),
    /Invalid Desktop journey input/u,
  );

  const readyPath = [];
  await prepareDesktopWidget({
    isReady: async () => readOnlyWidgetIsReady(readyObservation),
    isIframeVisible: async () => {
      readyPath.push('unexpected-iframe-check');
      return true;
    },
    activateWidget: async () => readyPath.push('unexpected-activation'),
    approveWarning: async () => readyPath.push('warning-check'),
    approveCapabilities: async () =>
      readyPath.push('unexpected-capability-approval'),
    waitForIdentityContinue: async () => {
      readyPath.push('identity-check');
      return false;
    },
    approveIdentity: async () => readyPath.push('unexpected-identity-approval'),
    waitForIframe: async () => readyPath.push('unexpected-iframe-wait'),
  });
  assert.deepEqual(readyPath, ['warning-check', 'identity-check']);

  const coldReadOnlyPath = [];
  await prepareDesktopWidget({
    isReady: async () =>
      readOnlyWidgetIsReady({
        ...readyObservation,
        expectedEventRowCountCapped: 0,
        expectedEventRowVisible: null,
      }),
    isIframeVisible: async () => {
      coldReadOnlyPath.push('iframe-visible');
      return true;
    },
    activateWidget: async () => coldReadOnlyPath.push('unexpected-activation'),
    approveWarning: async () => coldReadOnlyPath.push('warning'),
    approveCapabilities: async () => coldReadOnlyPath.push('capabilities'),
    waitForIdentityContinue: async () => {
      coldReadOnlyPath.push('identity-check');
      return true;
    },
    approveIdentity: async () => coldReadOnlyPath.push('identity-approval'),
    waitForIframe: async () => coldReadOnlyPath.push('iframe-wait'),
  });
  assert.deepEqual(coldReadOnlyPath, [
    'iframe-visible',
    'warning',
    'capabilities',
    'identity-check',
    'identity-approval',
    'iframe-wait',
  ]);
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

test('records a bounded Rooms-ready render snapshot only at that failure boundary', () => {
  const diagnostic = {
    roomList: { countCapped: 0, visibility: 'absent' },
    matrixChatShell: { countCapped: 1, visibility: 'visible' },
    matrixChatStateAvailable: true,
    matrixChatView: 'logged-in',
    matrixChatReady: true,
    matrixChatPageType: 'other-page',
    matrixChatCurrentRoomKnown: false,
    matrixChatCurrentRoomMatchesExpected: false,
    matrixChatSecurityFlowView: false,
    matrixClientMatchesMemberA: true,
  };
  withTempDirectory((runnerTemp) => {
    const filePath = join(runnerTemp, 'element-desktop-journey-stage.jsonl');
    initializeDesktopJourneyEvidence({ filePath, runnerTemp });
    appendDesktopLoginStep({
      filePath,
      runnerTemp,
      step: 'rooms_ready',
      entry: 'welcome_sign_in_clicked',
      roomsReadyDiagnostic: diagnostic,
    });

    const summary = readDesktopJourneyEvidence({ filePath, runnerTemp });
    assert.equal(summary.loginStep, 'rooms_ready');
    assert.equal(summary.loginEntry, 'welcome_sign_in_clicked');
    assert.equal(summary.loginDiagnostic, null);
    assert.deepEqual(summary.roomsReadyDiagnostic, diagnostic);
    assert.equal(summary.status, 'incomplete');
    assert.doesNotMatch(
      readFileSync(filePath, 'utf8'),
      /room-id|user-id|title/u,
    );
  });

  const unavailable = {
    roomList: { countCapped: null, visibility: 'unavailable' },
    matrixChatShell: { countCapped: 1, visibility: 'visible' },
    matrixChatStateAvailable: null,
    matrixChatView: 'unavailable',
    matrixChatReady: null,
    matrixChatPageType: 'unavailable',
    matrixChatCurrentRoomKnown: null,
    matrixChatCurrentRoomMatchesExpected: null,
    matrixChatSecurityFlowView: null,
    matrixClientMatchesMemberA: null,
  };
  assert.deepEqual(
    summarizeDesktopJourneyEvidence(
      JSON.stringify({
        loginStep: 'rooms_ready',
        roomsReadyDiagnostic: unavailable,
      }),
    ).roomsReadyDiagnostic,
    unavailable,
  );
});

test('rejects inconsistent or private-shaped Rooms-ready snapshots', () => {
  const diagnostic = {
    roomList: { countCapped: 0, visibility: 'absent' },
    matrixChatShell: { countCapped: 1, visibility: 'visible' },
    matrixChatStateAvailable: true,
    matrixChatView: 'logged-in',
    matrixChatReady: true,
    matrixChatPageType: 'room-view',
    matrixChatCurrentRoomKnown: false,
    matrixChatCurrentRoomMatchesExpected: false,
    matrixChatSecurityFlowView: false,
    matrixClientMatchesMemberA: true,
  };
  const summarize = (value) =>
    summarizeDesktopJourneyEvidence(JSON.stringify(value));

  assert.throws(
    () =>
      summarize({
        loginStep: 'username_fill',
        roomsReadyDiagnostic: diagnostic,
      }),
    /Invalid Desktop journey input/u,
  );
  assert.throws(
    () =>
      summarize({
        loginStep: 'rooms_ready',
        roomsReadyDiagnostic: {
          ...diagnostic,
          roomList: { countCapped: null, visibility: 'absent' },
        },
      }),
    /Invalid Desktop journey input/u,
  );
  assert.throws(
    () =>
      summarize({
        loginStep: 'rooms_ready',
        roomsReadyDiagnostic: { ...diagnostic, roomName: 'private' },
      }),
    /Invalid Desktop journey input/u,
  );
  assert.throws(
    () =>
      summarize({
        loginStep: 'rooms_ready',
        loginDiagnostic: {
          failureReason: 'timeout',
          beforeFill: {
            username: {
              countCapped: 0,
              visible: null,
              enabled: null,
              editable: null,
            },
            password: {
              countCapped: 0,
              visible: null,
              enabled: null,
              editable: null,
            },
          },
          atFailure: {
            username: {
              countCapped: 0,
              visible: null,
              enabled: null,
              editable: null,
            },
            password: {
              countCapped: 0,
              visible: null,
              enabled: null,
              editable: null,
            },
          },
        },
        roomsReadyDiagnostic: diagnostic,
      }),
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

test('records only bounded child and evidence classification enums', () => {
  withTempDirectory((runnerTemp) => {
    const evidenceFile = join(
      runnerTemp,
      'element-desktop-journey-stage.jsonl',
    );
    const diagnosticFile = join(
      runnerTemp,
      'element-desktop-journey-parent-diagnostic.json',
    );
    assert.equal(
      classifyDesktopJourneyEvidenceState({
        filePath: evidenceFile,
        runnerTemp,
        expectedSourceSha: DESKTOP_REFRESH_SOURCE_SHA,
      }),
      'absent',
    );
    assert.deepEqual(
      classifyDesktopJourneyEvidence({
        filePath: join(runnerTemp, 'unexpected.jsonl'),
        runnerTemp,
        expectedSourceSha: DESKTOP_REFRESH_SOURCE_SHA,
      }),
      {
        evidenceState: 'invalid',
        evidenceFailureCode: 'path_file_rejected',
      },
    );

    initializeDesktopJourneyEvidence({
      filePath: evidenceFile,
      runnerTemp,
    });
    assert.equal(
      classifyDesktopJourneyEvidenceState({
        filePath: evidenceFile,
        runnerTemp,
        expectedSourceSha: DESKTOP_REFRESH_SOURCE_SHA,
      }),
      'valid',
    );
    assert.deepEqual(
      classifyDesktopJourneyEvidence({
        filePath: evidenceFile,
        runnerTemp,
        expectedSourceSha: DESKTOP_REFRESH_SOURCE_SHA,
      }),
      { evidenceState: 'valid' },
    );
    chmodSync(evidenceFile, 0o644);
    assert.deepEqual(
      classifyDesktopJourneyEvidence({
        filePath: evidenceFile,
        runnerTemp,
        expectedSourceSha: DESKTOP_REFRESH_SOURCE_SHA,
      }),
      {
        evidenceState: 'invalid',
        evidenceFailureCode: 'path_file_rejected',
      },
    );
    chmodSync(evidenceFile, 0o600);
    writeFileSync(evidenceFile, '{invalid json\n', { mode: 0o600 });
    assert.deepEqual(
      classifyDesktopJourneyEvidence({
        filePath: evidenceFile,
        runnerTemp,
        expectedSourceSha: DESKTOP_REFRESH_SOURCE_SHA,
      }),
      {
        evidenceState: 'invalid',
        evidenceFailureCode: 'json_parse_failed',
      },
    );
    writeFileSync(
      evidenceFile,
      '{"privateValue":"private-evidence-sentinel"}\n',
      { mode: 0o600 },
    );
    assert.equal(
      classifyDesktopJourneyEvidenceState({
        filePath: evidenceFile,
        runnerTemp,
        expectedSourceSha: DESKTOP_REFRESH_SOURCE_SHA,
      }),
      'invalid',
    );
    assert.deepEqual(
      classifyDesktopJourneyEvidence({
        filePath: evidenceFile,
        runnerTemp,
        expectedSourceSha: DESKTOP_REFRESH_SOURCE_SHA,
      }),
      {
        evidenceState: 'invalid',
        evidenceFailureCode: 'evidence_phase_record_shape_rejected',
      },
    );
    const unreadableTemp = join(runnerTemp, 'unreadable');
    mkdirSync(unreadableTemp, { mode: 0o700 });
    chmodSync(unreadableTemp, 0o000);
    try {
      assert.equal(
        classifyDesktopJourneyEvidenceState({
          filePath: join(unreadableTemp, 'element-desktop-journey-stage.jsonl'),
          runnerTemp: unreadableTemp,
          expectedSourceSha: DESKTOP_REFRESH_SOURCE_SHA,
        }),
        'unreadable',
      );
      assert.deepEqual(
        classifyDesktopJourneyEvidence({
          filePath: join(unreadableTemp, 'element-desktop-journey-stage.jsonl'),
          runnerTemp: unreadableTemp,
          expectedSourceSha: DESKTOP_REFRESH_SOURCE_SHA,
        }),
        { evidenceState: 'unreadable' },
      );
    } finally {
      chmodSync(unreadableTemp, 0o700);
    }

    const childOutcomes = [
      'spawn_error',
      'timeout',
      'signaled',
      'exited',
      'unknown',
    ];
    const evidenceStates = ['absent', 'valid', 'invalid', 'unreadable'];
    for (const childOutcome of childOutcomes) {
      const exitStatuses = childOutcome === 'exited' ? [0, 17, 255] : [null];
      for (const childExitStatus of exitStatuses) {
        for (const evidenceState of evidenceStates) {
          const evidenceFailureCode =
            evidenceState === 'invalid'
              ? 'evidence_validation_failed'
              : undefined;
          writeDesktopJourneyParentDiagnostic({
            filePath: diagnosticFile,
            runnerTemp,
            childOutcome,
            childExitStatus,
            evidenceState,
            ...(evidenceFailureCode === undefined
              ? {}
              : { evidenceFailureCode }),
          });
          assert.deepEqual(
            readDesktopJourneyParentDiagnostic({
              filePath: diagnosticFile,
              runnerTemp,
            }),
            {
              childOutcome,
              childExitStatus,
              evidenceState,
              ...(evidenceFailureCode === undefined
                ? {}
                : { evidenceFailureCode }),
            },
          );
          const serialized = readFileSync(diagnosticFile, 'utf8');
          assert.doesNotMatch(serialized, /private-evidence-sentinel/u);
          assert.equal(statSync(diagnosticFile).mode & 0o777, 0o600);
          unlinkSync(diagnosticFile);
        }
      }
    }
    assert.throws(
      () =>
        writeDesktopJourneyParentDiagnostic({
          filePath: diagnosticFile,
          runnerTemp,
          childOutcome: 'private-evidence-sentinel',
          childExitStatus: null,
          evidenceState: 'invalid',
          evidenceFailureCode: 'evidence_validation_failed',
        }),
      /Invalid Desktop journey input/u,
    );
    for (const invalidExitStatus of [null, -1, 256, 1.5]) {
      assert.throws(
        () =>
          writeDesktopJourneyParentDiagnostic({
            filePath: diagnosticFile,
            runnerTemp,
            childOutcome: 'exited',
            childExitStatus: invalidExitStatus,
            evidenceState: 'invalid',
            evidenceFailureCode: 'evidence_validation_failed',
          }),
        /Invalid Desktop journey input/u,
      );
    }
    assert.throws(
      () =>
        writeDesktopJourneyParentDiagnostic({
          filePath: diagnosticFile,
          runnerTemp,
          childOutcome: 'signaled',
          childExitStatus: 0,
          evidenceState: 'invalid',
          evidenceFailureCode: 'evidence_validation_failed',
        }),
      /Invalid Desktop journey input/u,
    );
    assert.equal(existsSync(diagnosticFile), false);

    for (const evidenceFailureCode of [
      'path_file_rejected',
      'json_parse_failed',
      'evidence_validation_failed',
      'evidence_input_bounds_rejected',
      'evidence_login_record_rejected',
      'evidence_progress_refresh_sequence_rejected',
      'evidence_phase_record_rejected',
      'evidence_phase_record_object_rejected',
      'evidence_phase_record_shape_rejected',
      'evidence_phase_record_order_rejected',
      'evidence_phase_record_diagnostic_rejected',
      'evidence_final_summary_cross_check_rejected',
    ]) {
      const evidenceOrderDiagnostic =
        evidenceFailureCode === 'evidence_phase_record_order_rejected'
          ? {
              reason: 'duplicate_phase',
              recordIndex: 2,
              recordCount: 2,
              observedPhase: 'desktop-login',
              expectedPhase: 'desktop-member-identity',
            }
          : undefined;
      writeDesktopJourneyParentDiagnostic({
        filePath: diagnosticFile,
        runnerTemp,
        childOutcome: 'exited',
        childExitStatus: 23,
        evidenceState: 'invalid',
        evidenceFailureCode,
        ...(evidenceOrderDiagnostic === undefined
          ? {}
          : { evidenceOrderDiagnostic }),
      });
      assert.deepEqual(
        readDesktopJourneyParentDiagnostic({
          filePath: diagnosticFile,
          runnerTemp,
        }),
        {
          childOutcome: 'exited',
          childExitStatus: 23,
          evidenceState: 'invalid',
          evidenceFailureCode,
          ...(evidenceOrderDiagnostic === undefined
            ? {}
            : { evidenceOrderDiagnostic }),
        },
      );
      unlinkSync(diagnosticFile);
    }

    for (const invalidDiagnostic of [
      {
        childOutcome: 'exited',
        childExitStatus: 1,
        evidenceState: 'invalid',
      },
      {
        childOutcome: 'exited',
        childExitStatus: 1,
        evidenceState: 'invalid',
        evidenceFailureCode: 'private-evidence-sentinel',
      },
      {
        childOutcome: 'exited',
        childExitStatus: 0,
        evidenceState: 'valid',
        evidenceFailureCode: 'json_parse_failed',
      },
      {
        childOutcome: 'exited',
        childExitStatus: 1,
        evidenceState: 'invalid',
        evidenceFailureCode: 'evidence_phase_record_order_rejected',
        evidenceOrderDiagnostic: {
          reason: 'duplicate_phase',
          recordIndex: 2,
          recordCount: 2,
          observedPhase: 'private-phase',
          expectedPhase: 'desktop-member-identity',
        },
      },
      {
        childOutcome: 'exited',
        childExitStatus: 1,
        evidenceState: 'invalid',
        evidenceFailureCode: 'evidence_phase_record_order_rejected',
        evidenceOrderDiagnostic: {
          reason: 'private-evidence-sentinel',
          recordIndex: 2,
          recordCount: 2,
          observedPhase: 'desktop-login',
          expectedPhase: 'desktop-member-identity',
        },
      },
    ]) {
      assert.throws(
        () =>
          writeDesktopJourneyParentDiagnostic({
            filePath: diagnosticFile,
            runnerTemp,
            ...invalidDiagnostic,
          }),
        /Invalid Desktop journey input/u,
      );
    }
    assert.equal(existsSync(diagnosticFile), false);

    for (const invalidDiagnostic of [
      {
        childOutcome: 'exited',
        childExitStatus: 1,
        evidenceState: 'invalid',
        evidenceFailureCode: 'private-evidence-sentinel',
      },
      {
        childOutcome: 'exited',
        childExitStatus: 0,
        evidenceState: 'valid',
        evidenceFailureCode: 'json_parse_failed',
      },
    ]) {
      writeFileSync(diagnosticFile, `${JSON.stringify(invalidDiagnostic)}\n`, {
        mode: 0o600,
      });
      assert.deepEqual(
        readDesktopJourneyParentDiagnostic({
          filePath: diagnosticFile,
          runnerTemp,
        }),
        {
          childOutcome: 'unknown',
          childExitStatus: null,
          evidenceState: 'unreadable',
        },
      );
      unlinkSync(diagnosticFile);
    }
  });
});

test('classifies fixed evidence validation stages without exposing input', () => {
  withTempDirectory((runnerTemp) => {
    const filePath = join(runnerTemp, 'element-desktop-journey-stage.jsonl');
    const cases = [
      {
        input: Array.from({ length: 100 }, () => '{}').join('\n'),
        expected: 'evidence_input_bounds_rejected',
      },
      {
        input: 'null',
        expected: 'evidence_phase_record_object_rejected',
      },
      {
        input: JSON.stringify({ loginStep: 'private-evidence-sentinel' }),
        expected: 'evidence_login_record_rejected',
      },
      {
        input: JSON.stringify({
          type: 'desktop-journey-progress',
          sourceSha: DESKTOP_REFRESH_SOURCE_SHA,
          phase: 'desktop-a-refresh',
          event: 'point',
        }),
        expected: 'evidence_progress_refresh_sequence_rejected',
      },
      {
        input: JSON.stringify({ privateValue: 'private-evidence-sentinel' }),
        expected: 'evidence_phase_record_shape_rejected',
      },
      {
        input:
          '{"phase":"desktop-login","status":"passed"}\n' +
          '{"phase":"desktop-login","status":"passed"}',
        expected: 'evidence_phase_record_order_rejected',
        details: {
          evidenceOrderDiagnostic: {
            reason: 'duplicate_phase',
            recordIndex: 2,
            recordCount: 2,
            observedPhase: 'desktop-login',
            expectedPhase: 'desktop-member-identity',
          },
        },
      },
      {
        input: JSON.stringify({
          phase: 'desktop-room-widget-read',
          status: 'failed',
          failurePoint: 'room-navigation',
          roomNavigationDiagnostic: {
            privateValue: 'private-evidence-sentinel',
          },
        }),
        expected: 'evidence_phase_record_diagnostic_rejected',
      },
      {
        input: JSON.stringify({ phase: 'desktop-login', status: 'passed' }),
        expected: 'evidence_final_summary_cross_check_rejected',
      },
    ];

    for (const { input, expected, details = {} } of cases) {
      writeFileSync(filePath, `${input}\n`, { mode: 0o600 });
      assert.deepEqual(
        classifyDesktopJourneyEvidence({
          filePath,
          runnerTemp,
          expectedSourceSha: DESKTOP_REFRESH_SOURCE_SHA,
        }),
        {
          evidenceState: 'invalid',
          evidenceFailureCode: expected,
          ...details,
        },
      );
    }

    writeFileSync(
      filePath,
      `${JSON.stringify({
        type: 'desktop-child-completion',
        sourceSha: DESKTOP_REFRESH_SOURCE_SHA,
        desktopChildCompletion: { outcome: 'private-evidence-sentinel' },
      })}\n`,
      { mode: 0o600 },
    );
    assert.deepEqual(
      classifyDesktopJourneyEvidence({
        filePath,
        runnerTemp,
        expectedSourceSha: DESKTOP_REFRESH_SOURCE_SHA,
      }),
      { evidenceState: 'valid' },
    );
    const summary = summarizeDesktopJourneyEvidence(
      readFileSync(filePath, 'utf8'),
      { expectedSourceSha: DESKTOP_REFRESH_SOURCE_SHA },
    );
    assert.equal(summary.status, 'incomplete');
    assert.equal(summary.desktopChildCompletion.outcome, 'unknown');
  });
});

test('emits a sanitized unavailable summary when evidence validation fails', () => {
  withTempDirectory((runnerTemp) => {
    const filePath = join(runnerTemp, 'element-desktop-journey-stage.jsonl');
    const privateSentinel = 'private-evidence-sentinel';
    writeFileSync(
      filePath,
      `${JSON.stringify({ type: 'invalid', privateValue: privateSentinel })}\n`,
      { mode: 0o600 },
    );
    writeDesktopJourneyParentDiagnostic({
      filePath: join(
        runnerTemp,
        'element-desktop-journey-parent-diagnostic.json',
      ),
      runnerTemp,
      childOutcome: 'exited',
      childExitStatus: 23,
      evidenceState: 'invalid',
      evidenceFailureCode: 'evidence_phase_record_shape_rejected',
    });

    const scriptPath = fileURLToPath(
      new URL('./element-desktop-journey.mjs', import.meta.url),
    );
    const result = spawnSync(process.execPath, [scriptPath, 'summary'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        RUNNER_TEMP: runnerTemp,
        ELEMENT_DESKTOP_JOURNEY_STAGE_FILE: filePath,
        ELEMENT_DESKTOP_SOURCE_SHA: DESKTOP_REFRESH_SOURCE_SHA,
      },
    });

    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.equal(result.signal, null);
    assert.match(result.stderr, /Desktop journey evidence is unavailable\./u);
    assert.doesNotMatch(result.stdout, new RegExp(privateSentinel, 'u'));
    assert.doesNotMatch(result.stderr, new RegExp(privateSentinel, 'u'));

    const summary = JSON.parse(result.stdout);
    assert.equal(summary.schemaVersion, 23);
    assert.equal(summary.sourceSha, DESKTOP_REFRESH_SOURCE_SHA);
    assert.equal(summary.status, 'unavailable');
    assert.equal(summary.desktopChildCompletion.outcome, 'unknown');
    assert.equal(summary.desktopChildCompletion.timedOut, null);
    assert.deepEqual(summary.desktopChildDiagnostic, {
      childOutcome: 'exited',
      childExitStatus: 23,
      evidenceState: 'invalid',
      evidenceFailureCode: 'evidence_phase_record_shape_rejected',
    });
    assert.equal(summary.cases['desktop-a-refresh'], 'not_run');
  });
});

test('retains only bounded Desktop phase-order details for the safe summary', () => {
  withTempDirectory((runnerTemp) => {
    const filePath = join(runnerTemp, 'element-desktop-journey-stage.jsonl');
    writeFileSync(
      filePath,
      '{"phase":"desktop-login","status":"passed"}\n' +
        '{"phase":"desktop-login","status":"passed"}\n',
      { mode: 0o600 },
    );
    const classification = classifyDesktopJourneyEvidence({
      filePath,
      runnerTemp,
      expectedSourceSha: DESKTOP_REFRESH_SOURCE_SHA,
    });
    assert.deepEqual(classification, {
      evidenceState: 'invalid',
      evidenceFailureCode: 'evidence_phase_record_order_rejected',
      evidenceOrderDiagnostic: {
        reason: 'duplicate_phase',
        recordIndex: 2,
        recordCount: 2,
        observedPhase: 'desktop-login',
        expectedPhase: 'desktop-member-identity',
      },
    });
    writeDesktopJourneyParentDiagnostic({
      filePath: join(
        runnerTemp,
        'element-desktop-journey-parent-diagnostic.json',
      ),
      runnerTemp,
      childOutcome: 'exited',
      childExitStatus: 23,
      ...classification,
    });

    const parentDiagnostic = readDesktopJourneyParentDiagnostic({
      filePath: join(
        runnerTemp,
        'element-desktop-journey-parent-diagnostic.json',
      ),
      runnerTemp,
    });
    assert.deepEqual(parentDiagnostic, {
      childOutcome: 'exited',
      childExitStatus: 23,
      evidenceState: 'invalid',
      evidenceFailureCode: 'evidence_phase_record_order_rejected',
      evidenceOrderDiagnostic: {
        reason: 'duplicate_phase',
        recordIndex: 2,
        recordCount: 2,
        observedPhase: 'desktop-login',
        expectedPhase: 'desktop-member-identity',
      },
    });
    assert.doesNotMatch(
      readFileSync(
        join(runnerTemp, 'element-desktop-journey-parent-diagnostic.json'),
        'utf8',
      ),
      /private-evidence-sentinel|private-phase/u,
    );
    let summaryError;
    assert.throws(
      () =>
        summarizeDesktopJourneyEvidence(readFileSync(filePath, 'utf8'), {
          expectedSourceSha: DESKTOP_REFRESH_SOURCE_SHA,
        }),
      (error) => {
        summaryError = error;
        return true;
      },
    );
    assert.equal(summaryError.code, 'evidence_phase_record_order_rejected');
  });
});

test('declares the schema-23 CLI parent diagnostic shape', () => {
  const declarations = readFileSync(
    new URL('./element-desktop-journey.d.mts', import.meta.url),
    'utf8',
  );
  assert.match(declarations, /schemaVersion: 23;/u);
  assert.match(declarations, /DesktopJourneyEvidenceFailureCode/u);
  assert.match(
    declarations,
    /'path_file_rejected'[\s\S]*?'json_parse_failed'[\s\S]*?'evidence_validation_failed'[\s\S]*?'evidence_input_bounds_rejected'[\s\S]*?'evidence_login_record_rejected'[\s\S]*?'evidence_progress_refresh_sequence_rejected'[\s\S]*?'evidence_phase_record_rejected'[\s\S]*?'evidence_phase_record_object_rejected'[\s\S]*?'evidence_phase_record_shape_rejected'[\s\S]*?'evidence_phase_record_order_rejected'[\s\S]*?'evidence_phase_record_diagnostic_rejected'[\s\S]*?'evidence_final_summary_cross_check_rejected'/u,
  );
  assert.match(
    declarations,
    /evidenceFailureCode: 'evidence_phase_record_order_rejected'/u,
  );
  assert.match(
    declarations,
    /desktopChildDiagnostic: DesktopChildDiagnostic;/u,
  );
  assert.match(
    declarations,
    /DesktopEvidenceOrderDiagnostic[\s\S]*?evidenceOrderDiagnostic: DesktopEvidenceOrderDiagnostic/u,
  );
  assert.match(declarations, /childExitStatus: number;/u);
  assert.match(declarations, /childExitStatus: null;/u);
  assert.match(declarations, /status: 'unavailable';[\s\S]*?timedOut: null;/u);
  assert.match(
    declarations,
    /status: 'passed' \| 'failed' \| 'incomplete';[\s\S]*?timedOut: boolean;/u,
  );
});

test('private acceptance cleanup removes the parent diagnostic file', () => {
  withTempDirectory((runnerTemp) => {
    const action = readFileSync(
      new URL(
        '../.github/actions/element-acceptance/action.yml',
        import.meta.url,
      ),
      'utf8',
    );
    const cleanupBlock = action.match(/if ! rm -f \\\n([\s\S]*?); then/u)?.[1];
    assert.equal(typeof cleanupBlock, 'string');
    const fileNames = [
      ...cleanupBlock.matchAll(/\$RUNNER_TEMP\/([^"\s]+)"/gu),
    ].map((match) => match[1]);
    const diagnosticName = 'element-desktop-journey-parent-diagnostic.json';
    assert.ok(fileNames.includes(diagnosticName));

    const diagnosticPath = join(runnerTemp, diagnosticName);
    writeFileSync(diagnosticPath, '{"childOutcome":"unknown"}\n', {
      mode: 0o600,
    });
    const result = spawnSync(
      'rm',
      ['-f', ...fileNames.map((name) => join(runnerTemp, name))],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 0);
    assert.equal(existsSync(diagnosticPath), false);
  });
});
