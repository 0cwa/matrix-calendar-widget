import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_DEFAULT_WAIT_DIAGNOSTIC_COUNT,
  classifyPerformancePageError,
  summarizeDefaultWaitObservation,
} from './element-acceptance-performance-evidence.mjs';
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

function ordinaryAction(eventCount, durationMs = 900) {
  return {
    durationMs,
    apiResponseCount: 1,
    apiRangeMaxMs: 600,
    roomResponseCount: 1,
    returnedCount: eventCount,
    renderedCount: eventCount,
    rangeMatches: true,
    identitiesMatch: true,
    diagnosticsZero: true,
    stable: true,
    horizontalOverflow: false,
  };
}

function ordinaryColdList(eventCount, durationMs = 1800) {
  return {
    durationMs,
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
    rangeSelectionMs: null,
    openIdResponseCount: 1,
    openIdMaxMs: 100,
    apiRangeMaxMs: 600,
    selectedRoomResponseCount: 1,
    returnedCount: eventCount,
    renderedCount: eventCount,
    expectedRangeMatches: true,
    identitiesMatch: true,
    diagnosticsZero: true,
    stable: true,
    horizontalOverflow: false,
  };
}

function ordinaryEventsResponse(sample, eventCount, rangeClass) {
  return {
    sample,
    endpoint: 'events',
    method: 'GET',
    status: 200,
    durationMs: 600,
    decoded: true,
    eventCount,
    diagnosticCount: 0,
    target: 'room',
    calendarMatches: true,
    rangeClass,
    rangeDays:
      rangeClass === 'preselection'
        ? 7
        : rangeClass === 'preselection-next'
          ? 7
          : rangeClass === 'month-padded'
            ? 44
            : 31,
    rangeMatches: true,
    expectedTitlesMatch: true,
  };
}

function openIdResponse(sample) {
  return {
    sample,
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
  };
}

function ordinaryCase(profile, year, month, eventCount) {
  return {
    profile,
    year,
    month,
    eventCount,
    preparation: { elementLoginMs: 3000, roomNavigationMs: 1000 },
    defaultView: {
      durationMs: 1800,
      apiResponseCount: 1,
      apiRangeMaxMs: 600,
      returnedCount: eventCount,
      renderedCount: eventCount,
      rangeMatches: true,
      countMatches: true,
      usableControlVisible: true,
      stable: true,
    },
    defaultWaitObservation: null,
    coldList: ordinaryColdList(eventCount),
    refreshSetup: ordinaryAction(0, 2500),
    refresh: ordinaryAction(eventCount, 1900),
    detailSamples:
      eventCount === 25
        ? Array.from({ length: 5 }, (_, index) => ({
            ...detailSample(index + 1),
            durationMs: 400,
          }))
        : [],
  };
}

function ordinaryReport() {
  const report = {
    version: 11,
    viewportWidth: 1280,
    viewportHeight: 800,
    calendarDays: 7,
    timezone: 'Europe/Stockholm',
    cases: [
      ordinaryCase('empty', 2026, 11, 0),
      ordinaryCase('events-25', 2026, 11, 25),
    ],
    apiResponses: [],
    blockedRequestCount: 0,
    pageErrorCount: 0,
    pageErrorClass: 'none',
    pageErrorObservations: [],
    pageErrorObservationOverflow: false,
  };
  for (const performanceCase of report.cases) {
    const { profile, eventCount } = performanceCase;
    report.apiResponses.push(
      ordinaryEventsResponse(`${profile}-default`, eventCount, 'preselection'),
      openIdResponse(`${profile}-default`),
      ordinaryEventsResponse(
        `${profile}-refresh-setup`,
        0,
        'preselection-next',
      ),
      ordinaryEventsResponse(`${profile}-refresh`, eventCount, 'preselection'),
    );
  }
  return report;
}

function ordinaryStage(status, report, failureCode) {
  return {
    phase: 'performance-pilot',
    status,
    ...(failureCode ? { failureCode } : {}),
    performanceReport: report,
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
    /profile=historical-250-diagnostic-only beta_gate_eligible=false/u,
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

test('accepts the ordinary 0-and-25 profile and records an empty seeded default view', () => {
  const report = ordinaryReport();
  const summary = sanitizeElementAcceptance(
    JSON.stringify(ordinaryStage('passed', report)),
    sourceSha,
  );
  assert.match(
    summary,
    /phase=performance-pilot report_version=11 profile=ordinary-0-25 beta_gate_eligible=true status=passed failure_code=none cases=2 calendar_days=7/u,
  );
  assert.match(summary, /performance_case profile=empty events=0/u);
  assert.match(summary, /performance_case profile=events-25 events=25/u);
  assert.match(
    summary,
    /performance_default_view profile=events-25 elapsed_ms=1800 api_responses=1 event_api_max_ms=600 returned=25 rendered=25 range_matches=true count_matches=true create_visible=true stable=true/u,
  );
  assert.match(
    summary,
    /performance_api sample=events-25-refresh-setup endpoint=events method=GET status=200 duration_ms=600 decoded=true event_count=0 diagnostics=0 target=room calendar_matches=true range_class=preselection-next range_days=7 range_matches=true expected_titles_match=true/u,
  );
  assert.match(
    summary,
    /performance_cold_default profile=events-25 total_ms=1800 .*range_selection_ms=unavailable/u,
  );
  assert.match(
    summary,
    /performance_action profile=empty action=refresh-setup duration_ms=2500/u,
  );
  assert.match(
    summary,
    /performance_action profile=events-25 action=refresh duration_ms=1900/u,
  );
  assert.match(summary, /performance_details profile=empty samples=0/u);
  assert.match(summary, /performance_details profile=events-25 index=5/u);
  assert.match(summary, /page_error_observation_overflow=false/u);
  assert.doesNotMatch(summary, /Performance\s+\d|access_token|https?:\/\//u);
});

test('continues to sanitize the previous ordinary report shape', () => {
  const report = ordinaryReport();
  report.version = 9;
  report.pageErrorCount = 1;
  report.pageErrorClass = 'other';
  report.pageErrorObservations = [
    {
      profile: 'empty',
      stage: 'widget-open',
      errorClass: 'other',
      errorSubtype: 'named-error',
      errorSource: 'element',
      stackAvailable: true,
      sourceScanTruncated: false,
    },
  ];
  const summary = sanitizeElementAcceptance(
    JSON.stringify(ordinaryStage('failed', report, 'performance-page-error')),
    sourceSha,
  );
  assert.match(summary, /report_version=9/u);
  assert.match(
    summary,
    /page_error_observation index=1 profile=empty stage=widget-open error_class=other error_subtype=named-error error_source=element stack_available=true source_scan_truncated=false$/mu,
  );
  assert.doesNotMatch(summary, /source_map_status|source_ref_sha256/u);
});

test('classifies only closed page-error subtype and configured origin buckets', () => {
  const fixtureUrls = {
    elementUrl: 'https://element.invalid:8448/',
    widgetUrl: 'http://widget.invalid:3000/',
  };
  const widgetError = new TypeError('private message');
  widgetError.stack =
    'TypeError: private message\n    at initialize (http://widget.invalid:3000/assets/widget.js:1:4)';
  const widgetClassification = classifyPerformancePageError(
    widgetError,
    fixtureUrls,
  );
  assert.deepEqual(widgetClassification, {
    errorClass: 'type-error',
    errorSubtype: 'type-error',
    errorSource: 'widget',
    stackAvailable: true,
    sourceScanTruncated: false,
  });
  assert.doesNotMatch(
    JSON.stringify(widgetClassification),
    /private|https?:\/\/|element\.invalid|widget\.invalid|8448|3000|assets/u,
  );

  const directChromiumFrameError = new Error('private message');
  directChromiumFrameError.stack =
    'Error: private message\n    at http://widget.invalid:3000/assets/widget.js:1:4';
  assert.equal(
    classifyPerformancePageError(directChromiumFrameError, fixtureUrls)
      .errorSource,
    'widget',
  );

  const elementError = new Error('private message');
  elementError.stack =
    'Error: private message\n    at render (https://element.invalid:8448/bundles/app.js:2:5)';
  assert.equal(
    classifyPerformancePageError(elementError, fixtureUrls).errorSource,
    'element',
  );

  const firefoxStackError = new Error('private message');
  firefoxStackError.stack =
    'Error: private message\nrender@https://element.invalid:8448/bundles/app.js:2:5';
  assert.equal(
    classifyPerformancePageError(firefoxStackError, fixtureUrls).errorSource,
    'element',
  );

  const messageUrlError = new Error('private message');
  messageUrlError.stack =
    'Error: private message\nhttps://widget.invalid:3000/private-message';
  assert.equal(
    classifyPerformancePageError(messageUrlError, fixtureUrls).errorSource,
    'unclassified',
  );

  const unsupportedChromiumContinuationError = new Error('private message');
  unsupportedChromiumContinuationError.stack =
    'Error: private message\n    at continuation https://widget.invalid:3000/private-message';
  assert.equal(
    classifyPerformancePageError(
      unsupportedChromiumContinuationError,
      fixtureUrls,
    ).errorSource,
    'unclassified',
  );

  const unrelatedOriginError = new Error('private message');
  unrelatedOriginError.stack =
    'Error: private message\n    at helper (https://third-party.invalid/app.js:2:5)';
  assert.equal(
    classifyPerformancePageError(unrelatedOriginError, fixtureUrls).errorSource,
    'unclassified',
  );

  const ambiguousError = new Error('private message');
  ambiguousError.stack =
    'Error: private message\n    at widget (http://widget.invalid:3000/app.js:1:1)\n    at element (https://element.invalid:8448/app.js:1:1)';
  assert.equal(
    classifyPerformancePageError(ambiguousError, fixtureUrls).errorSource,
    'ambiguous',
  );

  const aggregateError = new AggregateError([], 'private message');
  assert.equal(
    classifyPerformancePageError(aggregateError, fixtureUrls).errorSubtype,
    'aggregate-error',
  );
  const domException = new DOMException('private message', 'AbortError');
  assert.equal(
    classifyPerformancePageError(domException, fixtureUrls).errorSubtype,
    'dom-exception',
  );
});

test('marks unavailable or truncated stack source as unclassified', () => {
  const fixtureUrls = {
    elementUrl: 'https://element.invalid:8448/',
    widgetUrl: 'http://widget.invalid:3000/',
  };
  const stackUnavailable = classifyPerformancePageError(
    new Error('private message'),
    fixtureUrls,
  );
  assert.equal(stackUnavailable.errorSource, 'unclassified');
  assert.equal(stackUnavailable.stackAvailable, true);
  assert.equal(stackUnavailable.sourceScanTruncated, false);

  const noStack = Object.defineProperty({}, 'name', {
    get() {
      throw new Error('private getter failure');
    },
  });
  const unavailable = classifyPerformancePageError(noStack, fixtureUrls);
  assert.deepEqual(unavailable, {
    errorClass: 'other',
    errorSubtype: 'unavailable',
    errorSource: 'unclassified',
    stackAvailable: false,
    sourceScanTruncated: false,
  });

  const truncated = new Error('private message');
  truncated.stack = [
    'Error: private message',
    ...Array.from(
      { length: 25 },
      (_, index) =>
        `    at frame${index} (http://widget.invalid:3000/app.js:${index + 1}:1)`,
    ),
  ].join('\n');
  const truncatedClassification = classifyPerformancePageError(
    truncated,
    fixtureUrls,
  );
  assert.equal(truncatedClassification.errorSource, 'unclassified');
  assert.equal(truncatedClassification.stackAvailable, true);
  assert.equal(truncatedClassification.sourceScanTruncated, true);
  assert.doesNotMatch(
    JSON.stringify(truncatedClassification),
    /private|https?:\/\/|element\.invalid|widget\.invalid|8448|3000/u,
  );
});

test('summarizes bounded page-error stage observations without error text', () => {
  const report = ordinaryReport();
  report.pageErrorCount = 2;
  report.pageErrorClass = 'other';
  report.pageErrorObservations = [
    {
      profile: 'empty',
      stage: 'widget-open',
      errorClass: 'other',
      errorSubtype: 'named-error',
      errorSource: 'widget',
      stackAvailable: true,
      sourceScanTruncated: false,
      sourceMapStatus: 'not-eligible',
      sourceMapResolution: 'not-applicable',
      sourceRefSha256: null,
      sourceLine: null,
      sourceColumn: null,
    },
    {
      profile: 'events-25',
      stage: 'widget-open',
      errorClass: 'type-error',
      errorSubtype: 'type-error',
      errorSource: 'element',
      stackAvailable: true,
      sourceScanTruncated: false,
      sourceMapStatus: 'mapped',
      sourceMapResolution: 'mapped',
      sourceRefSha256: 'a'.repeat(64),
      sourceLine: 42,
      sourceColumn: 5,
    },
  ];
  const summary = sanitizeElementAcceptance(
    JSON.stringify(ordinaryStage('failed', report, 'performance-page-error')),
    sourceSha,
  );
  assert.match(
    summary,
    /page_errors=2 page_error_class=other page_error_observation_overflow=false/u,
  );
  assert.match(
    summary,
    /page_error_observation index=1 profile=empty stage=widget-open error_class=other error_subtype=named-error error_source=widget stack_available=true source_scan_truncated=false source_map_status=not-eligible source_map_resolution=not-applicable source_ref_sha256=none source_line=none source_column=none/u,
  );
  assert.match(
    summary,
    /page_error_observation index=2 profile=events-25 stage=widget-open error_class=type-error error_subtype=type-error error_source=element stack_available=true source_scan_truncated=false source_map_status=mapped source_map_resolution=mapped source_ref_sha256=a{64} source_line=42 source_column=5/u,
  );
  assert.doesNotMatch(
    summary,
    /(?:error_message|error_stack)=|https?:\/\/|access_token|private error message|apps\/web/u,
  );

  const unmapped = ordinaryReport();
  unmapped.pageErrorCount = 1;
  unmapped.pageErrorClass = 'type-error';
  unmapped.pageErrorObservations = [
    {
      profile: 'empty',
      stage: 'widget-open',
      errorClass: 'type-error',
      errorSubtype: 'type-error',
      errorSource: 'element',
      stackAvailable: true,
      sourceScanTruncated: false,
      sourceMapStatus: 'unmapped',
      sourceMapResolution: 'dependency-source',
      sourceRefSha256: null,
      sourceLine: null,
      sourceColumn: null,
    },
  ];
  const unmappedSummary = sanitizeElementAcceptance(
    JSON.stringify(ordinaryStage('failed', unmapped, 'performance-page-error')),
    sourceSha,
  );
  assert.match(
    unmappedSummary,
    /source_map_status=unmapped source_map_resolution=dependency-source source_ref_sha256=none/u,
  );

  const version10 = ordinaryReport();
  version10.version = 10;
  version10.pageErrorCount = 1;
  version10.pageErrorClass = 'type-error';
  version10.pageErrorObservations = [
    {
      profile: 'empty',
      stage: 'widget-open',
      errorClass: 'type-error',
      errorSubtype: 'type-error',
      errorSource: 'element',
      stackAvailable: true,
      sourceScanTruncated: false,
      sourceMapStatus: 'unmapped',
      sourceRefSha256: null,
      sourceLine: null,
      sourceColumn: null,
    },
  ];
  const version10Summary = sanitizeElementAcceptance(
    JSON.stringify(
      ordinaryStage('failed', version10, 'performance-page-error'),
    ),
    sourceSha,
  );
  assert.match(version10Summary, /report_version=10/u);
  assert.match(version10Summary, /source_map_status=unmapped/u);
  assert.doesNotMatch(version10Summary, /source_map_resolution=/u);

  for (const mutate of [
    (invalid) => {
      invalid.pageErrorObservations[0].stage = 'unbounded-stage';
    },
    (invalid) => {
      invalid.pageErrorObservations[0].message = 'private error message';
    },
    (invalid) => {
      invalid.pageErrorObservationOverflow = true;
    },
    (invalid) => {
      invalid.pageErrorObservations[0].errorClass = 'type-error';
    },
    (invalid) => {
      invalid.pageErrorObservations[0].errorSubtype = 'private error name';
    },
    (invalid) => {
      invalid.pageErrorObservations[0].errorSource = 'widget.invalid:3000';
    },
    (invalid) => {
      invalid.pageErrorObservations[0].stackAvailable = false;
    },
    (invalid) => {
      invalid.pageErrorObservations[0].sourceScanTruncated = true;
    },
    (invalid) => {
      invalid.pageErrorObservations[0].errorSource = 'unclassified';
      invalid.pageErrorObservations[0].stackAvailable = false;
      invalid.pageErrorObservations[0].sourceScanTruncated = true;
    },
    (invalid) => {
      invalid.pageErrorObservations[0].sourceMapStatus = 'mapped';
    },
    (invalid) => {
      invalid.pageErrorObservations[0].sourceRefSha256 = 'https://private';
    },
    (invalid) => {
      invalid.pageErrorObservations[1].sourceLine = 0;
    },
    (invalid) => {
      invalid.pageErrorObservations[1].sourceColumn = 1_000_001;
    },
    (invalid) => {
      invalid.pageErrorObservations[1].sourceMapStatus = 'unmapped';
    },
    (invalid) => {
      invalid.pageErrorObservations[1].sourceMapStatus = 'not-eligible';
      invalid.pageErrorObservations[1].sourceRefSha256 = 'a'.repeat(64);
    },
    (invalid) => {
      invalid.pageErrorObservations[0].sourceMapResolution = 'mapped';
    },
    (invalid) => {
      invalid.pageErrorObservations[1].sourceMapResolution =
        'unsupported-source';
    },
    (invalid) => {
      invalid.pageErrorObservations[1].sourceMapStatus = 'unmapped';
      invalid.pageErrorObservations[1].sourceMapResolution = 'not-applicable';
    },
    (invalid) => {
      invalid.pageErrorObservations[1].sourceMapResolution = 'private-path';
    },
  ]) {
    const invalid = ordinaryReport();
    invalid.pageErrorCount = 2;
    invalid.pageErrorClass = 'other';
    invalid.pageErrorObservations = [
      {
        profile: 'empty',
        stage: 'widget-open',
        errorClass: 'other',
        errorSubtype: 'named-error',
        errorSource: 'widget',
        stackAvailable: true,
        sourceScanTruncated: false,
        sourceMapStatus: 'not-eligible',
        sourceMapResolution: 'not-applicable',
        sourceRefSha256: null,
        sourceLine: null,
        sourceColumn: null,
      },
      {
        profile: 'events-25',
        stage: 'widget-open',
        errorClass: 'type-error',
        errorSubtype: 'type-error',
        errorSource: 'element',
        stackAvailable: true,
        sourceScanTruncated: false,
        sourceMapStatus: 'mapped',
        sourceMapResolution: 'mapped',
        sourceRefSha256: 'a'.repeat(64),
        sourceLine: 42,
        sourceColumn: 5,
      },
    ];
    mutate(invalid);
    assert.throws(
      () =>
        sanitizeElementAcceptance(
          JSON.stringify(
            ordinaryStage('failed', invalid, 'performance-page-error'),
          ),
          sourceSha,
        ),
      /invalid element acceptance summary/u,
    );
  }

  const overflow = ordinaryReport();
  overflow.pageErrorCount = 9;
  overflow.pageErrorClass = 'other';
  overflow.pageErrorObservations = Array.from({ length: 8 }, (_, index) => ({
    profile: index < 4 ? 'empty' : 'events-25',
    stage: 'widget-open',
    errorClass: index === 0 ? 'other' : 'type-error',
    errorSubtype: index === 0 ? 'named-error' : 'type-error',
    errorSource: index === 0 ? 'unclassified' : 'widget',
    stackAvailable: true,
    sourceScanTruncated: false,
    sourceMapStatus: 'not-eligible',
    sourceMapResolution: 'not-applicable',
    sourceRefSha256: null,
    sourceLine: null,
    sourceColumn: null,
  }));
  overflow.pageErrorObservations[1].errorSource = 'element';
  overflow.pageErrorObservations[1].sourceMapStatus = 'not-attempted';
  overflow.pageErrorObservationOverflow = true;
  const overflowSummary = sanitizeElementAcceptance(
    JSON.stringify(ordinaryStage('failed', overflow, 'performance-page-error')),
    sourceSha,
  );
  assert.match(overflowSummary, /page_error_observation_overflow=true/u);
  assert.equal(
    (overflowSummary.match(/^page_error_observation /gmu) ?? []).length,
    8,
  );
});

test('reports v12 source-map rejection shapes without exposing source strings', () => {
  const report = ordinaryReport();
  report.version = 12;
  report.pageErrorCount = 2;
  report.pageErrorClass = 'other';
  report.pageErrorObservations = [
    {
      profile: 'empty',
      stage: 'widget-open',
      errorClass: 'other',
      errorSubtype: 'named-error',
      errorSource: 'element',
      stackAvailable: true,
      sourceScanTruncated: false,
      sourceMapStatus: 'unmapped',
      sourceMapResolution: 'unsupported-source',
      sourceMapUnsupportedReason: 'unsupported-namespace',
      sourceMapNamespaceClass: 'matrix-widget-api',
      sourceRefSha256: null,
      sourceLine: null,
      sourceColumn: null,
    },
    {
      profile: 'events-25',
      stage: 'widget-open',
      errorClass: 'type-error',
      errorSubtype: 'type-error',
      errorSource: 'element',
      stackAvailable: true,
      sourceScanTruncated: false,
      sourceMapStatus: 'unmapped',
      sourceMapResolution: 'unsupported-source',
      sourceMapUnsupportedReason: 'repository-root-prefix',
      sourceMapNamespaceClass: 'element-web',
      sourceRefSha256: null,
      sourceLine: null,
      sourceColumn: null,
    },
  ];
  const summary = sanitizeElementAcceptance(
    JSON.stringify(ordinaryStage('failed', report, 'performance-page-error')),
    sourceSha,
  );

  assert.match(
    summary,
    /source_map_status=unmapped source_map_resolution=unsupported-source source_map_unsupported_reason=unsupported-namespace source_map_namespace_class=matrix-widget-api source_ref_sha256=none/u,
  );
  assert.match(
    summary,
    /source_map_status=unmapped source_map_resolution=unsupported-source source_map_unsupported_reason=repository-root-prefix source_map_namespace_class=element-web source_ref_sha256=none/u,
  );
  assert.doesNotMatch(
    summary,
    /(?:webpack:\/\/|apps\/web|sourceRoot|rawSource|https?:\/\/)/u,
  );

  for (const mutate of [
    (invalid) => {
      invalid.pageErrorObservations[0].sourceMapUnsupportedReason =
        'private-path';
    },
    (invalid) => {
      invalid.pageErrorObservations[0].sourceMapNamespaceClass =
        'private-package';
    },
    (invalid) => {
      invalid.pageErrorObservations[0].sourceMapNamespaceClass = 'element-web';
    },
    (invalid) => {
      invalid.pageErrorObservations[0].sourceMapUnsupportedReason =
        'source-not-found';
    },
    (invalid) => {
      invalid.pageErrorObservations[1].sourceMapUnsupportedReason =
        'not-applicable';
    },
  ]) {
    const invalid = structuredClone(report);
    mutate(invalid);
    assert.throws(
      () =>
        sanitizeElementAcceptance(
          JSON.stringify(
            ordinaryStage('failed', invalid, 'performance-page-error'),
          ),
          sourceSha,
        ),
      /invalid element acceptance summary/u,
    );
  }
});

test('accepts seeding between the empty and populated fresh-context samples', () => {
  const stages = [
    ordinaryStage('started', ordinaryReport()),
    { phase: 'performance-seed', status: 'started' },
    { phase: 'performance-seed', status: 'passed', count: 25 },
    ordinaryStage('passed', ordinaryReport()),
    { phase: 'performance-cleanup', status: 'started' },
    {
      phase: 'performance-cleanup',
      status: 'passed',
      manifestEventCount: 25,
      plannedCount: 0,
      confirmedCreatedCount: 25,
      deletedCount: 25,
      alreadyAbsentCount: 0,
      conflictCount: 0,
      unresolvedCount: 0,
      inventoryAvailable: true,
    },
  ];
  const summary = sanitizeElementAcceptance(
    stages.map((stage) => JSON.stringify(stage)).join('\n'),
    sourceSha,
  );
  assert.match(
    summary,
    /performance-seed status=passed count=25 fixture_profile=ordinary-25/u,
  );
  assert.match(
    summary,
    /performance-cleanup status=passed fixture_profile=ordinary-25 manifest_event_count=25/u,
  );
});

test('summarizes default wait counters as observed zero, bounded counts, and overflow', () => {
  const endpoints = {
    context: 0,
    calendars: 0,
    events: 0,
    openid: 0,
    'other-calendar': 0,
    'other-api': 0,
  };
  const observedZero = summarizeDefaultWaitObservation(endpoints, 0);
  assert.equal(observedZero.pendingByEndpoint.events, 0);
  assert.equal(observedZero.pendingOverflowByEndpoint.events, false);
  assert.equal(observedZero.otherOriginCalendarPathCount, 0);
  assert.equal(observedZero.otherOriginCalendarPathOverflow, false);

  const saturated = summarizeDefaultWaitObservation(
    { ...endpoints, events: MAX_DEFAULT_WAIT_DIAGNOSTIC_COUNT + 9 },
    MAX_DEFAULT_WAIT_DIAGNOSTIC_COUNT + 1,
  );
  assert.equal(
    saturated.pendingByEndpoint.events,
    MAX_DEFAULT_WAIT_DIAGNOSTIC_COUNT,
  );
  assert.equal(saturated.pendingOverflowByEndpoint.events, true);
  assert.equal(
    saturated.otherOriginCalendarPathCount,
    MAX_DEFAULT_WAIT_DIAGNOSTIC_COUNT,
  );
  assert.equal(saturated.otherOriginCalendarPathOverflow, true);
  assert.throws(
    () => summarizeDefaultWaitObservation({ ...endpoints, secret: 1 }, 0),
    /invalid default wait observation input/u,
  );
});

test('retains default-wait snapshots only for the matching failed stage', () => {
  const report = ordinaryReport();
  report.cases[0].defaultWaitObservation = summarizeDefaultWaitObservation(
    {
      context: 0,
      calendars: 1,
      events: 1,
      openid: 0,
      'other-calendar': 0,
      'other-api': 0,
    },
    2,
  );
  const summary = sanitizeElementAcceptance(
    JSON.stringify(
      ordinaryStage('failed', report, 'performance-default-view-failed'),
    ),
    sourceSha,
  );
  assert.match(
    summary,
    /performance_default_wait_observation profile=empty pending_context=0 pending_context_overflow=false pending_calendars=1 pending_calendars_overflow=false pending_events=1 pending_events_overflow=false pending_openid=0 pending_openid_overflow=false pending_other_calendar=0 pending_other_calendar_overflow=false pending_other_api=0 pending_other_api_overflow=false other_origin_calendar_paths=2 other_origin_calendar_paths_overflow=false/u,
  );
  assert.match(
    summary,
    /performance_api sample=empty-default endpoint=events/u,
  );

  const observedZero = ordinaryReport();
  observedZero.cases[0].defaultWaitObservation =
    summarizeDefaultWaitObservation(
      {
        context: 0,
        calendars: 0,
        events: 0,
        openid: 0,
        'other-calendar': 0,
        'other-api': 0,
      },
      0,
    );
  const zeroSummary = sanitizeElementAcceptance(
    JSON.stringify(
      ordinaryStage('failed', observedZero, 'performance-default-view-failed'),
    ),
    sourceSha,
  );
  assert.match(zeroSummary, /pending_events=0 pending_events_overflow=false/u);
  assert.match(zeroSummary, /other_origin_calendar_paths=0/u);

  const overflowed = ordinaryReport();
  overflowed.cases[0].defaultWaitObservation = summarizeDefaultWaitObservation(
    {
      context: 0,
      calendars: 0,
      events: MAX_DEFAULT_WAIT_DIAGNOSTIC_COUNT + 1,
      openid: 0,
      'other-calendar': 0,
      'other-api': 0,
    },
    MAX_DEFAULT_WAIT_DIAGNOSTIC_COUNT + 1,
  );
  const overflowSummary = sanitizeElementAcceptance(
    JSON.stringify(
      ordinaryStage('failed', overflowed, 'performance-default-view-failed'),
    ),
    sourceSha,
  );
  assert.match(
    overflowSummary,
    /pending_events=512 pending_events_overflow=true/u,
  );
  assert.match(
    overflowSummary,
    /other_origin_calendar_paths=512 other_origin_calendar_paths_overflow=true/u,
  );

  const passedWithSnapshot = ordinaryReport();
  passedWithSnapshot.cases[0].defaultWaitObservation =
    summarizeDefaultWaitObservation(
      {
        context: 0,
        calendars: 0,
        events: 0,
        openid: 0,
        'other-calendar': 0,
        'other-api': 0,
      },
      0,
    );
  assert.throws(
    () =>
      sanitizeElementAcceptance(
        JSON.stringify(ordinaryStage('passed', passedWithSnapshot)),
        sourceSha,
      ),
    /invalid element acceptance summary/u,
  );
});

test('reports bounded failed-boundary runtime and completed API observations', () => {
  const endpoints = {
    context: 0,
    calendars: 0,
    events: 0,
    openid: 0,
    'other-calendar': 0,
    'other-api': 0,
  };
  const snapshot = {
    widgetConfiguration: {
      available: true,
      gatewayBaseParameterPresent: true,
      gatewayBaseValuePresent: true,
      gatewayBaseOriginMatches: true,
      roomIdParameterPresent: true,
      roomIdValuePresent: true,
      roomIdMatches: true,
      repositoryConfig: 'explicit-gateway-parameters',
    },
    createControl: {
      available: true,
      count: 1,
      visible: true,
      enabled: false,
    },
    completedApiRows: [
      { endpoint: 'context', status: 200, decoded: true },
      { endpoint: 'calendars', status: 200, decoded: true },
      { endpoint: 'events', status: 0, decoded: false },
      { endpoint: 'openid', status: 503, decoded: false },
    ],
    completedApiRowsOverflow: false,
  };
  const report = ordinaryReport();
  report.cases[0].defaultWaitObservation = summarizeDefaultWaitObservation(
    endpoints,
    0,
    snapshot,
  );
  const summary = sanitizeElementAcceptance(
    JSON.stringify(
      ordinaryStage('failed', report, 'performance-default-view-failed'),
    ),
    sourceSha,
  );
  assert.match(
    summary,
    /performance_default_wait_runtime profile=empty config_available=true gateway_base_parameter_present=true gateway_base_value_present=true gateway_base_origin_matches=true room_id_parameter_present=true room_id_value_present=true room_id_matches=true repository_config=explicit-gateway-parameters create_available=true create_count=1 create_visible=true create_enabled=false completed_api_rows_overflow=false/u,
  );
  assert.match(
    summary,
    /performance_default_wait_api profile=empty endpoint=events count=1 success=0 client_error=0 server_error=0 other_status=0 request_failed=1 decoded=0 decode_failed=1/u,
  );
  assert.match(
    summary,
    /performance_default_wait_api profile=empty endpoint=openid count=1 success=0 client_error=0 server_error=1 other_status=0 request_failed=0 decoded=0 decode_failed=1/u,
  );
  assert.doesNotMatch(
    summary,
    /https?:\/\/|matrix_room_id|gatewayBase|access_token|event title|error message/u,
  );
});

test('distinguishes unavailable runtime reads from observed zero responses', () => {
  const report = ordinaryReport();
  report.cases[0].defaultWaitObservation = summarizeDefaultWaitObservation(
    {
      context: 0,
      calendars: 0,
      events: 0,
      openid: 0,
      'other-calendar': 0,
      'other-api': 0,
    },
    0,
  );
  const summary = sanitizeElementAcceptance(
    JSON.stringify(
      ordinaryStage('failed', report, 'performance-default-view-failed'),
    ),
    sourceSha,
  );
  assert.match(
    summary,
    /performance_default_wait_runtime profile=empty config_available=false gateway_base_parameter_present=unavailable gateway_base_value_present=unavailable gateway_base_origin_matches=unavailable room_id_parameter_present=unavailable room_id_value_present=unavailable room_id_matches=unavailable repository_config=unavailable create_available=false create_count=unavailable create_visible=unavailable create_enabled=unavailable completed_api_rows_overflow=false/u,
  );
  assert.match(
    summary,
    /performance_default_wait_api profile=empty endpoint=events count=0 success=0 client_error=0 server_error=0 other_status=0 request_failed=0 decoded=0 decode_failed=0/u,
  );
});

test('caps completed API rows and rejects malformed runtime snapshots', () => {
  const endpoints = {
    context: 0,
    calendars: 0,
    events: 0,
    openid: 0,
    'other-calendar': 0,
    'other-api': 0,
  };
  const baseSnapshot = {
    widgetConfiguration: {
      available: true,
      gatewayBaseParameterPresent: false,
      gatewayBaseValuePresent: false,
      gatewayBaseOriginMatches: null,
      roomIdParameterPresent: true,
      roomIdValuePresent: true,
      roomIdMatches: true,
      repositoryConfig: 'build-config-fallback-possible',
    },
    createControl: {
      available: true,
      count: 0,
      visible: false,
      enabled: false,
    },
    completedApiRows: [],
    completedApiRowsOverflow: false,
  };
  const overflowSnapshot = {
    ...baseSnapshot,
    completedApiRows: Array.from(
      { length: MAX_DEFAULT_WAIT_DIAGNOSTIC_COUNT },
      (_, index) => ({
        endpoint: index === 0 ? 'events' : 'context',
        status: 200,
        decoded: true,
      }),
    ),
    completedApiRowsOverflow: true,
  };
  const report = ordinaryReport();
  report.cases[0].defaultWaitObservation = summarizeDefaultWaitObservation(
    endpoints,
    0,
    overflowSnapshot,
  );
  const summary = sanitizeElementAcceptance(
    JSON.stringify(
      ordinaryStage('failed', report, 'performance-default-view-failed'),
    ),
    sourceSha,
  );
  assert.match(summary, /completed_api_rows_overflow=true/u);
  assert.match(
    summary,
    /performance_default_wait_api profile=empty endpoint=context count=511/u,
  );
  assert.match(
    summary,
    /performance_default_wait_api profile=empty endpoint=events count=1/u,
  );

  for (const invalidSnapshot of [
    { ...baseSnapshot, rawUrl: 'https://private.invalid' },
    {
      ...baseSnapshot,
      completedApiRows: [{ endpoint: 'unknown', status: 200, decoded: true }],
    },
    {
      ...baseSnapshot,
      completedApiRows: [{ endpoint: 'events', status: 99, decoded: true }],
    },
    {
      ...baseSnapshot,
      createControl: {
        available: true,
        count: 0,
        visible: true,
        enabled: false,
      },
    },
  ]) {
    assert.throws(
      () => summarizeDefaultWaitObservation(endpoints, 0, invalidSnapshot),
      /invalid default wait observation input/u,
    );
  }
});

test('rejects malformed or mismatched default-wait diagnostics', () => {
  const makeObservation = () =>
    summarizeDefaultWaitObservation(
      {
        context: 0,
        calendars: 0,
        events: 0,
        openid: 0,
        'other-calendar': 0,
        'other-api': 0,
      },
      0,
    );

  const malformed = ordinaryReport();
  malformed.cases[0].defaultWaitObservation = {
    ...makeObservation(),
    rawUrl: 'https://private.invalid',
  };
  assert.throws(
    () =>
      sanitizeElementAcceptance(
        JSON.stringify(
          ordinaryStage('failed', malformed, 'performance-default-view-failed'),
        ),
        sourceSha,
      ),
    /invalid element acceptance summary/u,
  );

  const inconsistentOverflow = ordinaryReport();
  inconsistentOverflow.cases[0].defaultWaitObservation = makeObservation();
  inconsistentOverflow.cases[0].defaultWaitObservation.pendingOverflowByEndpoint.events = true;
  assert.throws(
    () =>
      sanitizeElementAcceptance(
        JSON.stringify(
          ordinaryStage(
            'failed',
            inconsistentOverflow,
            'performance-default-view-failed',
          ),
        ),
        sourceSha,
      ),
    /invalid element acceptance summary/u,
  );

  const mismatchedFailure = ordinaryReport();
  mismatchedFailure.cases[0].defaultWaitObservation = makeObservation();
  assert.throws(
    () =>
      sanitizeElementAcceptance(
        JSON.stringify(
          ordinaryStage(
            'failed',
            mismatchedFailure,
            'performance-threshold-exceeded',
          ),
        ),
        sourceSha,
      ),
    /invalid element acceptance summary/u,
  );

  assert.throws(
    () =>
      sanitizeElementAcceptance(
        JSON.stringify(
          ordinaryStage(
            'failed',
            ordinaryReport(),
            'performance-default-view-failed',
          ),
        ),
        sourceSha,
      ),
    /invalid element acceptance summary/u,
  );
});

test('rejects contradictory empty counts, incomplete detail samples, and slow refresh', () => {
  const mismatchedDefault = ordinaryReport();
  mismatchedDefault.cases[1].defaultView.renderedCount = 1;
  assert.throws(
    () =>
      sanitizeElementAcceptance(
        JSON.stringify(ordinaryStage('passed', mismatchedDefault)),
        sourceSha,
      ),
    /invalid element acceptance summary/u,
  );

  const wrongEmptyCount = ordinaryReport();
  wrongEmptyCount.cases[0].coldList.returnedCount = 1;
  assert.throws(
    () =>
      sanitizeElementAcceptance(
        JSON.stringify(ordinaryStage('passed', wrongEmptyCount)),
        sourceSha,
      ),
    /invalid element acceptance summary/u,
  );

  const missingDetail = ordinaryReport();
  missingDetail.cases[1].detailSamples.pop();
  assert.throws(
    () =>
      sanitizeElementAcceptance(
        JSON.stringify(ordinaryStage('passed', missingDetail)),
        sourceSha,
      ),
    /invalid element acceptance summary/u,
  );

  const emptyDetail = ordinaryReport();
  emptyDetail.cases[0].detailSamples.push(detailSample(1));
  assert.throws(
    () =>
      sanitizeElementAcceptance(
        JSON.stringify(ordinaryStage('passed', emptyDetail)),
        sourceSha,
      ),
    /invalid element acceptance summary/u,
  );

  const slowRefresh = ordinaryReport();
  slowRefresh.cases[0].refresh.durationMs = 2001;
  assert.throws(
    () =>
      sanitizeElementAcceptance(
        JSON.stringify(ordinaryStage('passed', slowRefresh)),
        sourceSha,
      ),
    /invalid element acceptance summary/u,
  );
});

test('does not apply the 2-second refresh limit to range-restoration setup', () => {
  const report = ordinaryReport();
  report.cases[0].refreshSetup.durationMs = 12_000;
  const summary = sanitizeElementAcceptance(
    JSON.stringify(ordinaryStage('passed', report)),
    sourceSha,
  );
  assert.match(
    summary,
    /performance_action profile=empty action=refresh-setup duration_ms=12000/u,
  );
});

test('gates the cold first usable seven-day view at two seconds', () => {
  const slowDefault = ordinaryReport();
  slowDefault.cases[0].defaultView.durationMs = 2001;
  slowDefault.cases[0].coldList.durationMs = 2001;
  assert.throws(
    () =>
      sanitizeElementAcceptance(
        JSON.stringify(ordinaryStage('passed', slowDefault)),
        sourceSha,
      ),
    /invalid element acceptance summary/u,
  );

  const wrongDefaultRange = ordinaryReport();
  wrongDefaultRange.apiResponses[0].rangeClass = 'list31';
  assert.throws(
    () =>
      sanitizeElementAcceptance(
        JSON.stringify(ordinaryStage('passed', wrongDefaultRange)),
        sourceSha,
      ),
    /invalid element acceptance summary/u,
  );
});

test('requires a new refresh response for the same seven-day range', () => {
  const nonemptySetup = ordinaryReport();
  const setup = nonemptySetup.apiResponses.find(
    ({ sample }) => sample === 'events-25-refresh-setup',
  );
  setup.eventCount = 1;
  assert.throws(
    () =>
      sanitizeElementAcceptance(
        JSON.stringify(ordinaryStage('passed', nonemptySetup)),
        sourceSha,
      ),
    /invalid element acceptance summary/u,
  );

  const wrongRefreshRange = ordinaryReport();
  const refresh = wrongRefreshRange.apiResponses.find(
    ({ sample }) => sample === 'events-25-refresh',
  );
  refresh.rangeClass = 'list31';
  assert.throws(
    () =>
      sanitizeElementAcceptance(
        JSON.stringify(ordinaryStage('passed', wrongRefreshRange)),
        sourceSha,
      ),
    /invalid element acceptance summary/u,
  );

  const missingRefreshResponse = ordinaryReport();
  missingRefreshResponse.apiResponses =
    missingRefreshResponse.apiResponses.filter(
      ({ sample }) => sample !== 'events-25-refresh',
    );
  Object.assign(missingRefreshResponse.cases[1].refresh, {
    apiResponseCount: 0,
    apiRangeMaxMs: null,
    roomResponseCount: 0,
    returnedCount: null,
  });
  assert.throws(
    () =>
      sanitizeElementAcceptance(
        JSON.stringify(ordinaryStage('passed', missingRefreshResponse)),
        sourceSha,
      ),
    /invalid element acceptance summary/u,
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
    /status=failed profile=historical-250-diagnostic-only beta_gate_eligible=false failure_code=performance-threshold-exceeded/u,
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
