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
  DESKTOP_JOURNEY_FAILURE_POINTS,
  DESKTOP_JOURNEY_PHASES,
  DESKTOP_LOGIN_ENTRIES,
  DESKTOP_LOGIN_FAILURE_REASONS,
  DESKTOP_LOGIN_STEPS,
  appendDesktopJourneyOutcome,
  appendDesktopLoginStep,
  classifyDesktopLoginFailure,
  desktopWidgetIsReady,
  enterDesktopPasswordLogin,
  findUniqueWebBEventId,
  initializeDesktopJourneyEvidence,
  inspectWebBEventList,
  isBoundedWebBEventListBodyLength,
  isBoundedWebBEventListResponse,
  prepareDesktopWidget,
  readDesktopJourneyEvidence,
  readOnlyWidgetIsReady,
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
    assert.equal(summary.schemaVersion, 6);
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
  const row = (failurePoint, matchedPatchStatus, eventListRead) => ({
    phase: 'web-member-b-edit-save',
    status: 'failed',
    failurePoint,
    webBEditSaveDiagnostic: {
      matchedPatchStatus,
      ...(eventListRead === undefined ? {} : { eventListRead }),
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
    { matchedPatchStatus: 204, eventListRead: decodedEventList },
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
      },
    });
    const persisted = readFileSync(filePath, 'utf8');
    assert.equal(
      persisted,
      '{"phase":"web-member-b-edit-save","status":"failed","failurePoint":"web-b-edit-event-row","webBEditSaveDiagnostic":{"matchedPatchStatus":204,"eventListRead":{"state":"decoded","matchingGetRequestCountCapped":1,"matchingGetResponseCountCapped":1,"firstMatchedGetStatus":200,"selectedEventIdentity":"available","sameEventObserved":true,"sameEventEditedTitleMatch":true}}}\n',
    );
    assert.doesNotMatch(persisted, /private-event-id|private event title/u);
  });
});

test('records a later phase failure without a completed B edit checkpoint', () => {
  withTempDirectory((runnerTemp) => {
    const filePath = join(runnerTemp, 'element-desktop-journey-stage.jsonl');
    initializeDesktopJourneyEvidence({ filePath, runnerTemp });
    appendDesktopJourneyOutcome({
      filePath,
      runnerTemp,
      phase: 'web-member-b-edit-save',
      status: 'passed',
    });

    assert.throws(
      () =>
        appendDesktopJourneyOutcome({
          filePath,
          runnerTemp,
          phase: 'desktop-a-refresh',
          status: 'failed',
          failurePoint: 'web-b-edit-event-row',
        }),
      /Invalid Desktop journey input/u,
    );
    appendDesktopJourneyOutcome({
      filePath,
      runnerTemp,
      phase: 'desktop-a-refresh',
      status: 'failed',
    });

    const summary = readDesktopJourneyEvidence({ filePath, runnerTemp });
    assert.equal(summary.cases['web-member-b-edit-save'], 'passed');
    assert.equal(summary.cases['desktop-a-refresh'], 'failed');
    assert.equal(summary.failurePoint, null);
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
