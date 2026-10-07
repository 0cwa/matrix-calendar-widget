import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyPerformanceHoverFailure } from './element-acceptance-performance-evidence.mjs';
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
    version: 1,
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
      initialIframeWidth: 460,
      pinControlCount: 1,
      pinControlVisible: true,
      pinControlEnabled: true,
      pinActionCompleted: true,
      appDrawerCount: 1,
      appDrawerFrameCount: 0,
      persistedHostFrameCount: 1,
      persistedHostFrameVisible: true,
      appTileSnapshotAvailable: null,
      appTileCount: null,
      appTileFrameCount: null,
      appTileNamedFrameCount: null,
      appPermissionCount: null,
      appLoadingIndicatorCount: null,
      appWarningCount: null,
      appDrawerMaximised: null,
      hostHoverActionability: {
        available: true,
        connected: true,
        visible: true,
        positiveBox: true,
        viewportIntersection: true,
        hiddenAncestor: false,
        centerHit: 'toolbar',
        occluder: {
          available: false,
          path: null,
          pathTruncated: null,
          classOverflow: null,
        },
        failureClass: 'none',
      },
      hostTileCountBeforeHover: 1,
      hostToolbarCountBeforeHover: 1,
      hostMaximizeCountBeforeHover: 0,
      hostMaximizeVisibleBeforeHover: false,
      hostHeaderHoverAttempted: true,
      hostHeaderHoverCompleted: true,
      hostTileCountAfterHover: 1,
      hostToolbarCountAfterHover: 1,
      hostMaximizeVisibleAfterHover: true,
      maximizeControlCount: 1,
      hostMaximizeMs: 180,
      maximizedIframeWidth: 1280,
      maximizedLayout: true,
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

function failedHoverReport() {
  const report = completeReport();
  report.coldList.hostHeaderHoverCompleted = false;
  report.coldList.hostHoverActionability.failureClass = 'intercepted';
  report.coldList.hostHoverActionability.occluder = {
    available: true,
    path: [
      { tag: 'iframe', classes: [], root: 'none' },
      { tag: 'div', classes: [], root: 'persisted-element-instance' },
      { tag: 'div', classes: [], root: 'persisted-element-container' },
      { tag: 'body', classes: [], root: 'document-body' },
      { tag: 'html', classes: [], root: 'document-element' },
    ],
    pathTruncated: false,
    classOverflow: false,
  };
  return report;
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
  assert.match(summary, /phase=performance-pilot status=passed/u);
  assert.match(
    summary,
    /events=250 calendar_days=31 timezone=Europe\/Stockholm/u,
  );
  assert.match(
    summary,
    /embedded_iframe_width=460 .*maximize_control_count=1/u,
  );
  assert.match(
    summary,
    /pin_control_count=1 pin_control_visible=true pin_control_enabled=true pin_action_completed=true app_drawer_count=1 app_drawer_frame_count=0 persisted_host_frame_count=1 persisted_host_frame_visible=true/u,
  );
  assert.match(
    summary,
    /host_hover_observation_available=true host_hover_toolbar_connected=true host_hover_toolbar_visible=true host_hover_toolbar_positive_box=true host_hover_toolbar_viewport_intersection=true host_hover_toolbar_hidden_ancestor=false host_hover_center_hit=toolbar host_hover_occluder_available=false host_hover_occluder_path_node_count=unavailable host_hover_occluder_class_count=unavailable host_hover_occluder_path_truncated=unavailable host_hover_occluder_class_overflow=unavailable host_hover_occluder_path=unavailable host_hover_failure_class=none/u,
  );
  assert.match(summary, /maximized_iframe_width=1280 maximized_layout=true/u);
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
  assert.match(
    summary,
    /host_tile_count_before_hover=1 host_toolbar_count_before_hover=1 host_maximize_count_before_hover=0 host_maximize_visible_before_hover=false host_header_hover_attempted=true host_header_hover_completed=true .*host_tile_count_after_hover=1 host_toolbar_count_after_hover=1 host_maximize_visible_after_hover=true maximize_control_count=1/u,
  );
});

test('maps host hover failures to fixed classes without preserving error text', () => {
  const classified = [
    [new Error('Element is not visible secret-value'), 'not-visible'],
    [
      new Error('Element is outside of the viewport private-value'),
      'outside-viewport',
    ],
    [
      new Error('Other element intercepts pointer events hidden-title'),
      'intercepted',
    ],
    [new Error('Element is not attached to the DOM private-url'), 'detached'],
    [
      Object.assign(new Error('Timeout 5000ms exceeded private-detail'), {
        name: 'TimeoutError',
      }),
      'timeout',
    ],
    [new Error('unclassified secret-value'), 'other'],
  ].map(([error, expected]) => [
    classifyPerformanceHoverFailure(error),
    expected,
  ]);
  for (const [actual, expected] of classified) assert.equal(actual, expected);
  assert.doesNotMatch(
    JSON.stringify(classified),
    /secret-value|private-value|hidden-title|private-url|private-detail/u,
  );
});

test('requires visible unobscured hover evidence for pass and preserves fixed failure class', () => {
  const unavailablePass = completeReport();
  Object.assign(unavailablePass.coldList.hostHoverActionability, {
    available: false,
    connected: null,
    visible: null,
    positiveBox: null,
    viewportIntersection: null,
    hiddenAncestor: null,
    centerHit: null,
    occluder: {
      available: false,
      path: null,
      pathTruncated: null,
      classOverflow: null,
    },
  });
  assert.throws(
    () =>
      sanitizeElementAcceptance(
        JSON.stringify(stage('passed', unavailablePass)),
        sourceSha,
      ),
    /invalid element acceptance summary/u,
  );

  const hiddenPass = completeReport();
  hiddenPass.coldList.hostHoverActionability.hiddenAncestor = true;
  assert.throws(
    () =>
      sanitizeElementAcceptance(
        JSON.stringify(stage('passed', hiddenPass)),
        sourceSha,
      ),
    /invalid element acceptance summary/u,
  );

  const hoverFailure = failedHoverReport();
  hoverFailure.coldList.hostHeaderHoverCompleted = false;
  hoverFailure.coldList.hostHoverActionability.failureClass = 'intercepted';
  hoverFailure.coldList.hostHoverActionability.centerHit =
    'persisted-widget-iframe';
  const summary = sanitizeElementAcceptance(
    JSON.stringify(
      stage('failed', hoverFailure, 'performance-host-layout-failed'),
    ),
    sourceSha,
  );
  assert.match(summary, /host_hover_failure_class=intercepted/u);
  assert.match(summary, /host_hover_center_hit=persisted-widget-iframe/u);
  assert.match(
    summary,
    /host_hover_occluder_path=iframe\[\]@none>div\[\]@persisted-element-instance>div\[\]@persisted-element-container/u,
  );
  assert.doesNotMatch(summary, /pointer|hidden-title|secret-value/u);

  const successfulHoverWithPath = completeReport();
  successfulHoverWithPath.coldList.hostHoverActionability.occluder =
    failedHoverReport().coldList.hostHoverActionability.occluder;
  assert.throws(
    () =>
      sanitizeElementAcceptance(
        JSON.stringify(stage('passed', successfulHoverWithPath)),
        sourceSha,
      ),
    /invalid element acceptance summary/u,
  );

  const unknownHit = completeReport();
  unknownHit.coldList.hostHeaderHoverCompleted = false;
  unknownHit.coldList.hostHoverActionability.failureClass = 'intercepted';
  unknownHit.coldList.hostHoverActionability.centerHit = 'private-selector';
  assert.throws(
    () =>
      sanitizeElementAcceptance(
        JSON.stringify(
          stage('failed', unknownHit, 'performance-host-layout-failed'),
        ),
        sourceSha,
      ),
    /invalid element acceptance summary/u,
  );

  const unknownClass = failedHoverReport();
  unknownClass.coldList.hostHoverActionability.occluder.path[0].classes.push(
    'private-class',
  );
  assert.throws(
    () =>
      sanitizeElementAcceptance(
        JSON.stringify(
          stage('failed', unknownClass, 'performance-host-layout-failed'),
        ),
        sourceSha,
      ),
    /invalid element acceptance summary/u,
  );

  const unboundedPath = failedHoverReport();
  unboundedPath.coldList.hostHoverActionability.occluder.path = Array.from(
    { length: 17 },
    () => ({ tag: 'div', classes: [], root: 'none' }),
  );
  unboundedPath.coldList.hostHoverActionability.occluder.pathTruncated = true;
  assert.throws(
    () =>
      sanitizeElementAcceptance(
        JSON.stringify(
          stage('failed', unboundedPath, 'performance-host-layout-failed'),
        ),
        sourceSha,
      ),
    /invalid element acceptance summary/u,
  );

  const falseClassOverflow = failedHoverReport();
  falseClassOverflow.coldList.hostHoverActionability.occluder.classOverflow = true;
  assert.throws(
    () =>
      sanitizeElementAcceptance(
        JSON.stringify(
          stage('failed', falseClassOverflow, 'performance-host-layout-failed'),
        ),
        sourceSha,
      ),
    /invalid element acceptance summary/u,
  );

  const mismatchedRoot = failedHoverReport();
  mismatchedRoot.coldList.hostHoverActionability.occluder.path[1].tag = 'span';
  assert.throws(
    () =>
      sanitizeElementAcceptance(
        JSON.stringify(
          stage('failed', mismatchedRoot, 'performance-host-layout-failed'),
        ),
        sourceSha,
      ),
    /invalid element acceptance summary/u,
  );
});

test('requires the pinned app-drawer route and retains only fixed page-error classes', () => {
  const missingPin = completeReport();
  missingPin.coldList.pinControlCount = 0;
  missingPin.coldList.pinControlVisible = false;
  missingPin.coldList.pinControlEnabled = false;
  missingPin.coldList.pinActionCompleted = false;
  missingPin.coldList.appDrawerCount = 0;
  missingPin.coldList.appDrawerFrameCount = 0;
  missingPin.coldList.persistedHostFrameCount = 0;
  missingPin.coldList.persistedHostFrameVisible = false;
  assert.throws(
    () =>
      sanitizeElementAcceptance(
        JSON.stringify(stage('passed', missingPin)),
        sourceSha,
      ),
    /invalid element acceptance summary/u,
  );

  const inconsistentHostFrame = completeReport();
  inconsistentHostFrame.coldList.persistedHostFrameCount = 2;
  assert.throws(
    () =>
      sanitizeElementAcceptance(
        JSON.stringify(stage('passed', inconsistentHostFrame)),
        sourceSha,
      ),
    /invalid element acceptance summary/u,
  );

  const missingHeaderHover = completeReport();
  missingHeaderHover.coldList.hostHeaderHoverCompleted = false;
  assert.throws(
    () =>
      sanitizeElementAcceptance(
        JSON.stringify(stage('passed', missingHeaderHover)),
        sourceSha,
      ),
    /invalid element acceptance summary/u,
  );

  const pageError = completeReport();
  pageError.pageErrorCount = 1;
  pageError.pageErrorClass = 'type-error';
  const failed = sanitizeElementAcceptance(
    JSON.stringify(stage('failed', pageError, 'performance-page-error')),
    sourceSha,
  );
  assert.match(failed, /page_errors=1 page_error_class=type-error/u);

  pageError.pageErrorClass = 'message contains private fixture data';
  assert.throws(
    () =>
      sanitizeElementAcceptance(
        JSON.stringify(stage('failed', pageError, 'performance-page-error')),
        sourceSha,
      ),
    /invalid element acceptance summary/u,
  );
});

test('retains only a bounded AppTile render snapshot when iframe attachment fails', () => {
  const report = completeReport();
  report.coldList.appDrawerFrameCount = 0;
  report.coldList.persistedHostFrameCount = 0;
  report.coldList.persistedHostFrameVisible = false;
  Object.assign(report.coldList, {
    appTileSnapshotAvailable: true,
    appTileCount: 1,
    appTileFrameCount: 0,
    appTileNamedFrameCount: 0,
    appPermissionCount: 0,
    appLoadingIndicatorCount: 1,
    appWarningCount: 1,
    appDrawerMaximised: false,
  });
  const summary = sanitizeElementAcceptance(
    JSON.stringify(stage('failed', report, 'performance-widget-open-failed')),
    sourceSha,
  );
  assert.match(
    summary,
    /app_tile_snapshot_available=true app_tile_count=1 app_tile_frame_count=0 app_tile_named_frame_count=0 app_permission_count=0 app_loading_indicator_count=1 app_warning_count=1 app_drawer_maximised=false/u,
  );

  const unavailable = completeReport();
  Object.assign(unavailable.coldList, {
    appTileSnapshotAvailable: false,
    appTileCount: 1,
  });
  assert.throws(
    () =>
      sanitizeElementAcceptance(
        JSON.stringify(
          stage('failed', unavailable, 'performance-widget-open-failed'),
        ),
        sourceSha,
      ),
    /invalid element acceptance summary/u,
  );

  const impossibleFrameCounts = completeReport();
  Object.assign(impossibleFrameCounts.coldList, {
    appTileSnapshotAvailable: true,
    appTileCount: 1,
    appTileFrameCount: 0,
    appTileNamedFrameCount: 1,
    appPermissionCount: 0,
    appLoadingIndicatorCount: 0,
    appWarningCount: 0,
    appDrawerMaximised: false,
  });
  assert.throws(
    () =>
      sanitizeElementAcceptance(
        JSON.stringify(
          stage(
            'failed',
            impossibleFrameCounts,
            'performance-widget-open-failed',
          ),
        ),
        sourceSha,
      ),
    /invalid element acceptance summary/u,
  );

  const privateField = completeReport();
  privateField.coldList.appTileErrorText = 'private widget details';
  assert.throws(
    () =>
      sanitizeElementAcceptance(
        JSON.stringify(
          stage('failed', privateField, 'performance-widget-open-failed'),
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

test('requires the actual Element maximize transition and expected API methods', () => {
  const narrow = completeReport();
  narrow.coldList.maximizedIframeWidth = 799;
  assert.throws(
    () =>
      sanitizeElementAcceptance(
        JSON.stringify(stage('passed', narrow)),
        sourceSha,
      ),
    /invalid element acceptance summary/u,
  );

  const fakeLayout = completeReport();
  fakeLayout.coldList.maximizedLayout = false;
  assert.throws(
    () =>
      sanitizeElementAcceptance(
        JSON.stringify(stage('passed', fakeLayout)),
        sourceSha,
      ),
    /invalid element acceptance summary/u,
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
