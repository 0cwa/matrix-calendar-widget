const FAILURE_CODES = new Set([
  'performance-setup-failed',
  'performance-widget-open-failed',
  'performance-host-layout-failed',
  'performance-range-selection-failed',
  'performance-cold-list-failed',
  'performance-warmup-failed',
  'performance-view-sample-failed',
  'performance-overflow-failed',
  'performance-details-failed',
  'performance-egress-blocked',
  'performance-page-error',
  'performance-threshold-exceeded',
]);
const ENDPOINTS = new Set([
  'context',
  'calendars',
  'events',
  'openid',
  'other-calendar',
  'other-api',
]);
const TARGETS = new Set(['none', 'personal', 'room', 'other']);
const RANGE_CLASSES = new Set([
  'not-applicable',
  'preselection',
  'list31',
  'month-padded',
  'overflow-day',
  'mismatch',
]);
const API_SAMPLE =
  /^(?:cold-list|warmup-(?:list|month)-[12]|measured-(?:list|month)-[1-5]|overflow-(?:month|day|reset-month|reset-list)|details-warmup-[12]|details-[1-5])$/u;

const REPORT_KEYS = [
  'version',
  'year',
  'month',
  'viewportWidth',
  'viewportHeight',
  'workloadEvents',
  'calendarDays',
  'timezone',
  'preparation',
  'coldList',
  'viewWarmups',
  'viewSamples',
  'detailWarmups',
  'detailSamples',
  'overflow',
  'apiResponses',
  'blockedRequestCount',
  'pageErrorCount',
];
const PREPARATION_KEYS = ['elementLoginMs', 'roomNavigationMs'];
const COLD_KEYS = [
  'durationMs',
  'widgetStartupMs',
  'activationMs',
  'capabilityApprovalMs',
  'identityApprovalMs',
  'iframeReadyMs',
  'initialIframeWidth',
  'maximizeControlCount',
  'hostMaximizeMs',
  'maximizedIframeWidth',
  'maximizedLayout',
  'rangeSelectionMs',
  'openIdResponseCount',
  'openIdMaxMs',
  'apiRangeMaxMs',
  'selectedRoomResponseCount',
  'returnedCount',
  'renderedCount',
  'expectedRangeMatches',
  'identitiesMatch',
  'diagnosticsZero',
  'stable',
  'horizontalOverflow',
];
const VIEW_SAMPLE_KEYS = [
  'index',
  'view',
  'durationMs',
  'apiResponseCount',
  'apiRangeMaxMs',
  'roomResponseCount',
  'returnedCount',
  'renderedCount',
  'rangeMatches',
  'identitiesMatch',
  'diagnosticsZero',
  'stable',
  'horizontalOverflow',
];
const DETAIL_SAMPLE_KEYS = [
  'index',
  'durationMs',
  'visible',
  'titleMatches',
  'stable',
  'horizontalOverflow',
];
const OVERFLOW_KEYS = [
  'visibleEventCount',
  'collapsedEventCount',
  'renderedEventCount',
  'opened',
  'expectedDayEventCount',
  'dayEventCount',
  'dayIdentityMatches',
  'stable',
];
const API_KEYS = [
  'sample',
  'endpoint',
  'method',
  'status',
  'durationMs',
  'decoded',
  'eventCount',
  'diagnosticCount',
  'target',
  'calendarMatches',
  'rangeClass',
  'rangeDays',
  'rangeMatches',
  'expectedTitlesMatch',
];
const API_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'OTHER']);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  return (
    isRecord(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function boundedInteger(value, minimum = 0, maximum = 600_000) {
  return Number.isInteger(value) && value >= minimum && value <= maximum;
}

function boundedNumber(value, minimum = 0, maximum = 600_000) {
  return Number.isFinite(value) && value >= minimum && value <= maximum;
}

function optionalMilliseconds(value) {
  return value === null || boundedNumber(value);
}

function optionalCount(value, maximum = 1000) {
  return value === null || boundedInteger(value, 0, maximum);
}

function optionalDays(value) {
  return value === null || boundedNumber(value, 0, 60);
}

function validViewSample(value, view, index) {
  return (
    hasExactKeys(value, VIEW_SAMPLE_KEYS) &&
    boundedInteger(value.index, 1, index) &&
    value.view === view &&
    optionalMilliseconds(value.durationMs) &&
    boundedInteger(value.apiResponseCount, 0, 64) &&
    optionalMilliseconds(value.apiRangeMaxMs) &&
    boundedInteger(value.roomResponseCount, 0, 8) &&
    optionalCount(value.returnedCount) &&
    optionalCount(value.renderedCount) &&
    typeof value.rangeMatches === 'boolean' &&
    typeof value.identitiesMatch === 'boolean' &&
    typeof value.diagnosticsZero === 'boolean' &&
    typeof value.stable === 'boolean' &&
    (typeof value.horizontalOverflow === 'boolean' ||
      value.horizontalOverflow === null)
  );
}

function validDetailSample(value, index) {
  return (
    hasExactKeys(value, DETAIL_SAMPLE_KEYS) &&
    value.index === index &&
    optionalMilliseconds(value.durationMs) &&
    typeof value.visible === 'boolean' &&
    typeof value.titleMatches === 'boolean' &&
    typeof value.stable === 'boolean' &&
    (typeof value.horizontalOverflow === 'boolean' ||
      value.horizontalOverflow === null)
  );
}

function validApiResponse(value) {
  if (
    !hasExactKeys(value, API_KEYS) ||
    typeof value.sample !== 'string' ||
    !API_SAMPLE.test(value.sample) ||
    !ENDPOINTS.has(value.endpoint) ||
    !API_METHODS.has(value.method) ||
    !(value.status === 0 || boundedInteger(value.status, 100, 599)) ||
    !boundedNumber(value.durationMs) ||
    typeof value.decoded !== 'boolean' ||
    !TARGETS.has(value.target) ||
    !RANGE_CLASSES.has(value.rangeClass)
  ) {
    return false;
  }

  if (value.endpoint === 'events') {
    return (
      optionalCount(value.eventCount) &&
      optionalCount(value.diagnosticCount) &&
      typeof value.calendarMatches === 'boolean' &&
      optionalDays(value.rangeDays) &&
      (typeof value.rangeMatches === 'boolean' ||
        value.rangeMatches === null) &&
      (typeof value.expectedTitlesMatch === 'boolean' ||
        value.expectedTitlesMatch === null) &&
      value.target !== 'none'
    );
  }

  return (
    value.eventCount === null &&
    value.diagnosticCount === null &&
    value.target === 'none' &&
    value.calendarMatches === null &&
    value.rangeClass === 'not-applicable' &&
    value.rangeDays === null &&
    value.rangeMatches === null &&
    value.expectedTitlesMatch === null
  );
}

function validReport(report) {
  return (
    hasExactKeys(report, REPORT_KEYS) &&
    report.version === 1 &&
    boundedInteger(report.year, 2020, 2200) &&
    boundedInteger(report.month, 1, 12) &&
    new Date(Date.UTC(report.year, report.month, 0)).getUTCDate() === 31 &&
    boundedInteger(report.viewportWidth, 1, 4096) &&
    boundedInteger(report.viewportHeight, 1, 4096) &&
    report.workloadEvents === 250 &&
    report.calendarDays === 31 &&
    report.timezone === 'Europe/Stockholm' &&
    hasExactKeys(report.preparation, PREPARATION_KEYS) &&
    PREPARATION_KEYS.every((key) =>
      optionalMilliseconds(report.preparation[key]),
    ) &&
    hasExactKeys(report.coldList, COLD_KEYS) &&
    COLD_KEYS.slice(0, 6).every((key) =>
      optionalMilliseconds(report.coldList[key]),
    ) &&
    optionalCount(report.coldList.initialIframeWidth, 4096) &&
    boundedInteger(report.coldList.maximizeControlCount, 0, 2) &&
    optionalMilliseconds(report.coldList.hostMaximizeMs) &&
    optionalCount(report.coldList.maximizedIframeWidth, 4096) &&
    typeof report.coldList.maximizedLayout === 'boolean' &&
    optionalMilliseconds(report.coldList.rangeSelectionMs) &&
    boundedInteger(report.coldList.openIdResponseCount, 0, 8) &&
    optionalMilliseconds(report.coldList.openIdMaxMs) &&
    optionalMilliseconds(report.coldList.apiRangeMaxMs) &&
    boundedInteger(report.coldList.selectedRoomResponseCount, 0, 8) &&
    optionalCount(report.coldList.returnedCount) &&
    optionalCount(report.coldList.renderedCount) &&
    [
      'expectedRangeMatches',
      'identitiesMatch',
      'diagnosticsZero',
      'stable',
    ].every((key) => typeof report.coldList[key] === 'boolean') &&
    (typeof report.coldList.horizontalOverflow === 'boolean' ||
      report.coldList.horizontalOverflow === null) &&
    Array.isArray(report.viewWarmups) &&
    report.viewWarmups.length <= 4 &&
    report.viewWarmups.every(
      (sample) =>
        (sample.view === 'list' || sample.view === 'month') &&
        validViewSample(sample, sample.view, 2),
    ) &&
    Array.isArray(report.viewSamples) &&
    report.viewSamples.length <= 10 &&
    report.viewSamples.every(
      (sample) =>
        (sample.view === 'list' || sample.view === 'month') &&
        validViewSample(sample, sample.view, 5),
    ) &&
    Array.isArray(report.detailWarmups) &&
    report.detailWarmups.length <= 2 &&
    report.detailWarmups.every((sample, index) =>
      validDetailSample(sample, index + 1),
    ) &&
    Array.isArray(report.detailSamples) &&
    report.detailSamples.length <= 5 &&
    report.detailSamples.every((sample, index) =>
      validDetailSample(sample, index + 1),
    ) &&
    hasExactKeys(report.overflow, OVERFLOW_KEYS) &&
    optionalCount(report.overflow.visibleEventCount) &&
    optionalCount(report.overflow.collapsedEventCount) &&
    optionalCount(report.overflow.renderedEventCount) &&
    typeof report.overflow.opened === 'boolean' &&
    optionalCount(report.overflow.expectedDayEventCount, 9) &&
    optionalCount(report.overflow.dayEventCount, 9) &&
    typeof report.overflow.dayIdentityMatches === 'boolean' &&
    typeof report.overflow.stable === 'boolean' &&
    Array.isArray(report.apiResponses) &&
    report.apiResponses.length <= 512 &&
    report.apiResponses.every(validApiResponse) &&
    optionalCount(report.blockedRequestCount, 100_000) &&
    optionalCount(report.pageErrorCount, 100_000)
  );
}

function requiredViewSamples(report, view, count) {
  return (
    report.viewSamples.filter((sample) => sample.view === view).length === count
  );
}

function samplePasses(sample, enforceViewThreshold = true) {
  return (
    sample.durationMs !== null &&
    (!enforceViewThreshold || sample.durationMs <= 2000) &&
    sample.apiResponseCount > 0 &&
    sample.apiRangeMaxMs !== null &&
    sample.apiRangeMaxMs <= 1000 &&
    sample.roomResponseCount === 1 &&
    sample.returnedCount === 250 &&
    sample.renderedCount === 250 &&
    sample.rangeMatches &&
    sample.identitiesMatch &&
    sample.diagnosticsZero &&
    sample.stable &&
    sample.horizontalOverflow === false
  );
}

function reportPasses(report) {
  return (
    report.viewportWidth === 1280 &&
    report.viewportHeight === 800 &&
    report.coldList.durationMs !== null &&
    report.coldList.durationMs <= 2000 &&
    [
      report.preparation.elementLoginMs,
      report.preparation.roomNavigationMs,
      report.coldList.widgetStartupMs,
      report.coldList.activationMs,
      report.coldList.capabilityApprovalMs,
      report.coldList.identityApprovalMs,
      report.coldList.iframeReadyMs,
      report.coldList.hostMaximizeMs,
      report.coldList.rangeSelectionMs,
    ].every((value) => value !== null) &&
    report.coldList.openIdResponseCount > 0 &&
    report.coldList.openIdMaxMs !== null &&
    report.coldList.initialIframeWidth !== null &&
    report.coldList.initialIframeWidth > 0 &&
    report.coldList.initialIframeWidth < 800 &&
    report.coldList.maximizeControlCount === 1 &&
    report.coldList.maximizedIframeWidth !== null &&
    report.coldList.maximizedIframeWidth >= 800 &&
    report.coldList.maximizedLayout &&
    report.coldList.expectedRangeMatches &&
    report.coldList.selectedRoomResponseCount === 1 &&
    report.coldList.returnedCount === 250 &&
    report.coldList.renderedCount === 250 &&
    report.coldList.identitiesMatch &&
    report.coldList.diagnosticsZero &&
    report.coldList.stable &&
    report.coldList.horizontalOverflow === false &&
    report.coldList.apiRangeMaxMs !== null &&
    report.coldList.apiRangeMaxMs <= 1000 &&
    report.viewWarmups.length === 4 &&
    report.viewWarmups.filter(({ view }) => view === 'list').length === 2 &&
    report.viewWarmups.filter(({ view }) => view === 'month').length === 2 &&
    ['list', 'month'].every(
      (view) =>
        report.viewWarmups
          .filter((sample) => sample.view === view)
          .map(({ index }) => index)
          .sort((a, b) => a - b)
          .join(',') === '1,2',
    ) &&
    report.viewWarmups.every((sample) => samplePasses(sample, false)) &&
    report.viewSamples.length === 10 &&
    requiredViewSamples(report, 'list', 5) &&
    requiredViewSamples(report, 'month', 5) &&
    ['list', 'month'].every(
      (view) =>
        report.viewSamples
          .filter((sample) => sample.view === view)
          .map(({ index }) => index)
          .sort((a, b) => a - b)
          .join(',') === '1,2,3,4,5',
    ) &&
    report.viewSamples.every(samplePasses) &&
    report.detailWarmups.length === 2 &&
    report.detailWarmups.every(
      (sample) =>
        sample.durationMs !== null &&
        sample.visible &&
        sample.titleMatches &&
        sample.stable,
    ) &&
    report.detailSamples.length === 5 &&
    report.detailSamples.every(
      (sample) =>
        sample.durationMs !== null &&
        sample.durationMs <= 500 &&
        sample.visible &&
        sample.titleMatches &&
        sample.stable &&
        sample.horizontalOverflow === false,
    ) &&
    report.overflow.visibleEventCount !== null &&
    report.overflow.collapsedEventCount !== null &&
    report.overflow.renderedEventCount === 250 &&
    report.overflow.visibleEventCount + report.overflow.collapsedEventCount ===
      report.overflow.renderedEventCount &&
    report.overflow.opened &&
    report.overflow.expectedDayEventCount === 9 &&
    report.overflow.dayEventCount === report.overflow.expectedDayEventCount &&
    report.overflow.dayIdentityMatches &&
    report.overflow.stable &&
    report.blockedRequestCount === 0 &&
    report.pageErrorCount === 0 &&
    report.apiResponses.every(
      (row) =>
        row.status === 200 &&
        row.decoded &&
        row.method === (row.endpoint === 'openid' ? 'POST' : 'GET') &&
        (row.endpoint === 'openid' || row.durationMs <= 1000) &&
        (row.endpoint !== 'events' ||
          row.rangeClass === 'preselection' ||
          row.rangeMatches === true) &&
        (row.endpoint !== 'events' || row.diagnosticCount === 0) &&
        (row.endpoint !== 'events' ||
          row.target !== 'room' ||
          row.rangeClass === 'preselection' ||
          (row.calendarMatches === true &&
            row.expectedTitlesMatch === true &&
            row.eventCount === (row.rangeClass === 'overflow-day' ? 9 : 250))),
    )
  );
}

function display(value) {
  return value === null ? 'unavailable' : String(value);
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

export function formatPerformanceEvidence(record) {
  if (
    !isRecord(record) ||
    record.phase !== 'performance-pilot' ||
    !['started', 'passed', 'failed'].includes(record.status) ||
    !validReport(record.performanceReport) ||
    (record.failureCode !== undefined &&
      !FAILURE_CODES.has(record.failureCode)) ||
    (record.status === 'passed' &&
      (record.failureCode !== undefined ||
        !reportPasses(record.performanceReport))) ||
    (record.status === 'failed' && !FAILURE_CODES.has(record.failureCode))
  ) {
    throw new Error('invalid performance evidence');
  }

  const report = record.performanceReport;
  const lines = [
    [
      'phase=performance-pilot',
      `status=${record.status}`,
      `failure_code=${record.failureCode ?? 'none'}`,
      `month=${report.year}-${String(report.month).padStart(2, '0')}`,
      `events=${report.workloadEvents}`,
      `calendar_days=${report.calendarDays}`,
      `timezone=${report.timezone}`,
      `viewport_width=${report.viewportWidth}`,
      `viewport_height=${report.viewportHeight}`,
      `blocked_requests=${display(report.blockedRequestCount)}`,
      `page_errors=${display(report.pageErrorCount)}`,
    ].join(' '),
    `performance_preparation login_ms=${display(report.preparation.elementLoginMs)} room_navigation_ms=${display(report.preparation.roomNavigationMs)}`,
    [
      'performance_cold_list',
      `total_ms=${display(report.coldList.durationMs)}`,
      `widget_startup_ms=${display(report.coldList.widgetStartupMs)}`,
      `activation_ms=${display(report.coldList.activationMs)}`,
      `capability_approval_ms=${display(report.coldList.capabilityApprovalMs)}`,
      `identity_approval_ms=${display(report.coldList.identityApprovalMs)}`,
      `iframe_ready_ms=${display(report.coldList.iframeReadyMs)}`,
      `embedded_iframe_width=${display(report.coldList.initialIframeWidth)}`,
      `maximize_control_count=${report.coldList.maximizeControlCount}`,
      `host_maximize_ms=${display(report.coldList.hostMaximizeMs)}`,
      `maximized_iframe_width=${display(report.coldList.maximizedIframeWidth)}`,
      `maximized_layout=${report.coldList.maximizedLayout}`,
      `range_selection_ms=${display(report.coldList.rangeSelectionMs)}`,
      `openid_responses=${report.coldList.openIdResponseCount}`,
      `openid_max_ms=${display(report.coldList.openIdMaxMs)}`,
      `event_api_max_ms=${display(report.coldList.apiRangeMaxMs)}`,
      `room_responses=${report.coldList.selectedRoomResponseCount}`,
      `returned=${display(report.coldList.returnedCount)}`,
      `rendered=${display(report.coldList.renderedCount)}`,
      `range_matches=${report.coldList.expectedRangeMatches}`,
      `identities_match=${report.coldList.identitiesMatch}`,
      `diagnostics_zero=${report.coldList.diagnosticsZero}`,
      `stable=${report.coldList.stable}`,
      `horizontal_overflow=${display(report.coldList.horizontalOverflow)}`,
    ].join(' '),
  ];

  for (const row of report.apiResponses) {
    lines.push(
      [
        'performance_api',
        `sample=${row.sample}`,
        `endpoint=${row.endpoint}`,
        `method=${row.method}`,
        `status=${row.status}`,
        `duration_ms=${row.durationMs}`,
        `decoded=${row.decoded}`,
        `event_count=${display(row.eventCount)}`,
        `diagnostics=${display(row.diagnosticCount)}`,
        `target=${row.target}`,
        `calendar_matches=${display(row.calendarMatches)}`,
        `range_class=${row.rangeClass}`,
        `range_days=${display(row.rangeDays)}`,
        `range_matches=${display(row.rangeMatches)}`,
        `expected_titles_match=${display(row.expectedTitlesMatch)}`,
      ].join(' '),
    );
  }

  for (const [label, samples] of [
    ['warmup', report.viewWarmups],
    ['measured', report.viewSamples],
  ]) {
    for (const sample of samples) {
      lines.push(
        [
          `performance_${label}`,
          `view=${sample.view}`,
          `index=${sample.index}`,
          `duration_ms=${display(sample.durationMs)}`,
          `api_responses=${sample.apiResponseCount}`,
          `event_api_max_ms=${display(sample.apiRangeMaxMs)}`,
          `room_responses=${sample.roomResponseCount}`,
          `returned=${display(sample.returnedCount)}`,
          `rendered=${display(sample.renderedCount)}`,
          `range_matches=${sample.rangeMatches}`,
          `identities_match=${sample.identitiesMatch}`,
          `diagnostics_zero=${sample.diagnosticsZero}`,
          `stable=${sample.stable}`,
          `horizontal_overflow=${display(sample.horizontalOverflow)}`,
        ].join(' '),
      );
    }
  }

  for (const [label, samples] of [
    ['details_warmup', report.detailWarmups],
    ['details', report.detailSamples],
  ]) {
    for (const sample of samples) {
      lines.push(
        `${label === 'details' ? 'performance_details' : 'performance_details_warmup'} index=${sample.index} duration_ms=${display(sample.durationMs)} visible=${sample.visible} title_matches=${sample.titleMatches} stable=${sample.stable} horizontal_overflow=${display(sample.horizontalOverflow)}`,
      );
    }
  }

  lines.push(
    `performance_overflow visible=${display(report.overflow.visibleEventCount)} collapsed=${display(report.overflow.collapsedEventCount)} rendered=${display(report.overflow.renderedEventCount)} opened=${report.overflow.opened} expected_day_events=${display(report.overflow.expectedDayEventCount)} day_events=${display(report.overflow.dayEventCount)} identities_match=${report.overflow.dayIdentityMatches} stable=${report.overflow.stable}`,
  );

  for (const view of ['list', 'month']) {
    const values = report.viewSamples
      .filter((sample) => sample.view === view && sample.durationMs !== null)
      .map((sample) => sample.durationMs);
    lines.push(
      `performance_view_stats view=${view} samples=${values.length} median_ms=${display(median(values))} max_ms=${display(values.length ? Math.max(...values) : null)}`,
    );
  }
  const details = report.detailSamples
    .filter((sample) => sample.durationMs !== null)
    .map((sample) => sample.durationMs);
  lines.push(
    `performance_details_stats samples=${details.length} median_ms=${display(median(details))} max_ms=${display(details.length ? Math.max(...details) : null)}`,
  );
  return lines;
}
