import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeElementAcceptance } from './sanitize-element-acceptance.mjs';

const sourceSha = 'b'.repeat(40);

function viewSample(view, index, durationMs = 800) {
  return {
    index,
    view,
    durationMs,
    apiResponseCount: 1,
    apiRangeMaxMs: 600,
    roomResponseCount: 1,
    returnedCount: 250,
    renderedCount: 250,
    rangeMatches: true,
    identitiesMatch: true,
    diagnosticsZero: true,
    stable: true,
    horizontalOverflow: false,
  };
}

function detailSample(index, durationMs = 300) {
  return {
    index,
    durationMs,
    visible: true,
    titleMatches: true,
    stable: true,
    horizontalOverflow: false,
  };
}

function eventsResponse(sample, rangeClass = 'list31') {
  return {
    sample,
    endpoint: 'events',
    method: 'GET',
    status: 200,
    durationMs: 600,
    decoded: true,
    eventCount: 250,
    diagnosticCount: 0,
    target: 'room',
    calendarMatches: true,
    rangeClass,
    rangeDays: rangeClass === 'month-padded' ? 45 : 31,
    rangeMatches: true,
    expectedTitlesMatch: true,
  };
}

function completeReport() {
  const warmupOrder = [
    ['month', 1],
    ['list', 1],
    ['month', 2],
    ['list', 2],
  ];
  const measuredOrder = Array.from({ length: 10 }, (_, index) => [
    index % 2 === 0 ? 'month' : 'list',
    Math.floor(index / 2) + 1,
  ]);
  const apiResponses = [eventsResponse('cold-list')];
  for (const [view, index] of warmupOrder) {
    apiResponses.push(
      eventsResponse(
        `warmup-${view}-${index}`,
        view === 'month' ? 'month-padded' : 'list31',
      ),
    );
  }
  for (const [view, index] of measuredOrder) {
    apiResponses.push(
      eventsResponse(
        `measured-${view}-${index}`,
        view === 'month' ? 'month-padded' : 'list31',
      ),
    );
  }
  apiResponses.push({
    sample: 'cold-list',
    endpoint: 'openid',
    method: 'POST',
    status: 200,
    durationMs: 100,
    decoded: true,
    eventCount: null,
    diagnosticCount: null,
    target: 'none',
    calendarMatches: null,
    rangeClass: 'not-applicable',
    rangeDays: null,
    rangeMatches: null,
    expectedTitlesMatch: null,
  });

  return {
    version: 2,
    year: 2026,
    month: 12,
    viewportWidth: 1280,
    viewportHeight: 800,
    workloadEvents: 250,
    calendarDays: 31,
    timezone: 'Europe/Stockholm',
    preparation: { elementLoginMs: 3000, roomNavigationMs: 1000 },
    coldList: {
      durationMs: 1800,
      widgetStartupMs: 900,
      activationMs: 100,
      capabilityApprovalMs: 150,
      identityApprovalMs: 200,
      iframeReadyMs: 400,
      placement: 'widget-card',
      widgetCardCount: 1,
      widgetCardVisible: true,
      appDrawerCount: 0,
      persistedHostFrameCount: 1,
      persistedHostFrameVisible: true,
      iframeWidth: 319,
      iframeHeight: 690,
      hostHorizontalOverflow: false,
      rangeSelectionMs: 400,
      openIdResponseCount: 1,
      openIdMaxMs: 100,
      apiRangeMaxMs: 600,
      selectedRoomResponseCount: 1,
      returnedCount: 250,
      renderedCount: 250,
      expectedRangeMatches: true,
      identitiesMatch: true,
      diagnosticsZero: true,
      stable: true,
      horizontalOverflow: false,
    },
    viewWarmups: warmupOrder.map(([view, index]) =>
      viewSample(view, index, 900),
    ),
    viewSamples: measuredOrder.map(([view, index]) =>
      viewSample(view, index, 900),
    ),
    detailWarmups: [detailSample(1, 400), detailSample(2, 450)],
    detailSamples: Array.from({ length: 5 }, (_, index) =>
      detailSample(index + 1, 400),
    ),
    overflow: {
      visibleEventCount: 62,
      collapsedEventCount: 188,
      renderedEventCount: 250,
      opened: true,
      expectedDayEventCount: 9,
      dayEventCount: 9,
      dayIdentityMatches: true,
      stable: true,
    },
    apiResponses,
    blockedRequestCount: 0,
    pageErrorCount: 0,
    pageErrorClass: 'none',
  };
}

function stage(status, performanceReport, failureCode) {
  return {
    phase: 'performance-pilot',
    status,
    ...(failureCode ? { failureCode } : {}),
    performanceReport,
  };
}

test('sanitizes complete performance samples and bounded decoded API timings', () => {
  const summary = sanitizeElementAcceptance(
    JSON.stringify(stage('passed', completeReport())),
    sourceSha,
  );
  assert.match(
    summary,
    /phase=performance-pilot report_version=2 status=passed/u,
  );
  assert.match(
    summary,
    /events=250 calendar_days=31 timezone=Europe\/Stockholm/u,
  );
  assert.match(
    summary,
    /placement=widget-card widget_card_count=1 widget_card_visible=true app_drawer_count=0 persisted_host_frame_count=1 persisted_host_frame_visible=true iframe_width=319 iframe_height=690 host_horizontal_overflow=false/u,
  );
  assert.doesNotMatch(summary, /maximi[sz]ed|pin_control|host_hover/u);
  assert.match(
    summary,
    /performance_api sample=measured-month-5 endpoint=events method=GET status=200 duration_ms=600 decoded=true/u,
  );
  assert.match(summary, /sample=cold-list endpoint=openid method=POST/u);
  assert.match(
    summary,
    /performance_view_stats view=list samples=5 median_ms=900 max_ms=900/u,
  );
  assert.match(
    summary,
    /performance_details_stats samples=5 median_ms=400 max_ms=400/u,
  );
  assert.doesNotMatch(
    summary,
    /Performance\s+\d|@matrix-calendar-widget|access_token|https?:\/\/|error message|stack/u,
  );
});

test('requires the real visible side-panel widget and bounded geometry', () => {
  const hiddenCard = completeReport();
  hiddenCard.coldList.widgetCardVisible = false;
  assert.throws(
    () =>
      sanitizeElementAcceptance(
        JSON.stringify(stage('passed', hiddenCard)),
        sourceSha,
      ),
    /invalid element acceptance summary/u,
  );

  const drawerPlacement = completeReport();
  drawerPlacement.coldList.placement = 'apps-drawer';
  assert.throws(
    () =>
      sanitizeElementAcceptance(
        JSON.stringify(stage('passed', drawerPlacement)),
        sourceSha,
      ),
    /invalid element acceptance summary/u,
  );

  const missingFrame = completeReport();
  missingFrame.coldList.persistedHostFrameCount = 0;
  missingFrame.coldList.persistedHostFrameVisible = false;
  assert.throws(
    () =>
      sanitizeElementAcceptance(
        JSON.stringify(stage('passed', missingFrame)),
        sourceSha,
      ),
    /invalid element acceptance summary/u,
  );

  const hiddenOverflow = completeReport();
  hiddenOverflow.coldList.hostHorizontalOverflow = true;
  assert.throws(
    () =>
      sanitizeElementAcceptance(
        JSON.stringify(stage('passed', hiddenOverflow)),
        sourceSha,
      ),
    /invalid element acceptance summary/u,
  );

  const malformedDimensions = completeReport();
  malformedDimensions.coldList.iframeWidth = 4097;
  assert.throws(
    () =>
      sanitizeElementAcceptance(
        JSON.stringify(
          stage(
            'failed',
            malformedDimensions,
            'performance-host-layout-failed',
          ),
        ),
        sourceSha,
      ),
    /invalid element acceptance summary/u,
  );

  const privateField = completeReport();
  privateField.coldList.iframeSelector = '#private-widget';
  assert.throws(
    () =>
      sanitizeElementAcceptance(
        JSON.stringify(
          stage('failed', privateField, 'performance-host-layout-failed'),
        ),
        sourceSha,
      ),
    /invalid element acceptance summary/u,
  );
});

test('keeps incomplete performance observations on failure and rejects private fields', () => {
  const report = completeReport();
  report.viewSamples = report.viewSamples.slice(0, 1);
  report.apiResponses[0].durationMs = 1250;
  const failed = sanitizeElementAcceptance(
    JSON.stringify(stage('failed', report, 'performance-threshold-exceeded')),
    sourceSha,
  );
  assert.match(
    failed,
    /status=failed failure_code=performance-threshold-exceeded/u,
  );
  assert.match(
    failed,
    /sample=cold-list endpoint=events method=GET status=200 duration_ms=1250/u,
  );
  assert.throws(
    () =>
      sanitizeElementAcceptance(
        JSON.stringify({
          ...stage('failed', report, 'performance-threshold-exceeded'),
          accessToken: 'never allowed',
        }),
        sourceSha,
      ),
    /invalid element acceptance summary/u,
  );
  assert.throws(
    () =>
      sanitizeElementAcceptance(
        JSON.stringify({
          phase: 'browser-egress',
          status: 'failed',
          performanceReport: report,
        }),
        sourceSha,
      ),
    /invalid element acceptance summary/u,
  );
});

test('does not pass missing samples, slow API responses, or duplicate terminal reports', () => {
  const report = completeReport();
  report.viewSamples.pop();
  assert.throws(
    () =>
      sanitizeElementAcceptance(
        JSON.stringify(stage('passed', report)),
        sourceSha,
      ),
    /invalid element acceptance summary/u,
  );

  const slow = completeReport();
  slow.apiResponses[0].durationMs = 1001;
  assert.throws(
    () =>
      sanitizeElementAcceptance(
        JSON.stringify(stage('passed', slow)),
        sourceSha,
      ),
    /invalid element acceptance summary/u,
  );

  const valid = stage('started', completeReport());
  const passed = stage('passed', completeReport());
  assert.throws(
    () =>
      sanitizeElementAcceptance(
        `${JSON.stringify(valid)}\n${JSON.stringify(passed)}\n${JSON.stringify(passed)}`,
        sourceSha,
      ),
    /invalid element acceptance summary/u,
  );
});

test('accepts the measured side-panel width without a minimum and checks expected API methods', () => {
  const sidePanel = completeReport();
  sidePanel.coldList.iframeWidth = 319;
  assert.match(
    sanitizeElementAcceptance(
      JSON.stringify(stage('passed', sidePanel)),
      sourceSha,
    ),
    /iframe_width=319/u,
  );

  const wrongOverflowCount = completeReport();
  wrongOverflowCount.overflow.expectedDayEventCount = 8;
  wrongOverflowCount.overflow.dayEventCount = 8;
  assert.throws(
    () =>
      sanitizeElementAcceptance(
        JSON.stringify(stage('passed', wrongOverflowCount)),
        sourceSha,
      ),
    /invalid element acceptance summary/u,
  );

  const methodMismatch = completeReport();
  methodMismatch.apiResponses[0].method = 'POST';
  assert.throws(
    () =>
      sanitizeElementAcceptance(
        JSON.stringify(stage('passed', methodMismatch)),
        sourceSha,
      ),
    /invalid element acceptance summary/u,
  );
});
