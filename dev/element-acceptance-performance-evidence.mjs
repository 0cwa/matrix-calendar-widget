const FAILURE_CODES = new Set([
  'performance-setup-failed',
  'performance-widget-open-failed',
  'performance-host-layout-failed',
  'performance-default-view-failed',
  'performance-warmup-failed',
  'performance-view-sample-failed',
  'performance-overflow-failed',
  'performance-details-failed',
  'performance-egress-blocked',
  'performance-page-error',
  'performance-threshold-exceeded',
]);
const DEFAULT_WAIT_ENDPOINTS = [
  'context',
  'calendars',
  'events',
  'openid',
  'other-calendar',
  'other-api',
];
const ENDPOINTS = new Set(DEFAULT_WAIT_ENDPOINTS);
export const MAX_DEFAULT_WAIT_DIAGNOSTIC_COUNT = 512;
const TARGETS = new Set(['none', 'personal', 'room', 'other']);
const RANGE_CLASSES = new Set([
  'not-applicable',
  'preselection',
  'preselection-next',
  'list31',
  'month-padded',
  'overflow-day',
  'mismatch',
]);
const PAGE_ERROR_CLASSES = new Set([
  'none',
  'error',
  'type-error',
  'reference-error',
  'syntax-error',
  'range-error',
  'uri-error',
  'eval-error',
  'other',
]);
const API_SAMPLE =
  /^(?:cold-list|warmup-(?:list|month)-[12]|measured-(?:list|month)-[1-5]|overflow-(?:month|day|reset-month|reset-list)|details-warmup-[12]|details-[1-5]|(?:empty|events-25)-(?:default|refresh-setup|refresh)|events-25-details-[1-5])$/u;

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
  'pageErrorClass',
];
const PREPARATION_KEYS = ['elementLoginMs', 'roomNavigationMs'];
const COLD_KEYS = [
  'durationMs',
  'widgetStartupMs',
  'activationMs',
  'capabilityApprovalMs',
  'identityApprovalMs',
  'iframeReadyMs',
  'placement',
  'widgetCardCount',
  'widgetCardVisible',
  'appDrawerCount',
  'persistedHostFrameCount',
  'persistedHostFrameVisible',
  'iframeWidth',
  'iframeHeight',
  'hostHorizontalOverflow',
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

export function summarizeDefaultWaitObservation(
  pendingEndpointCounts,
  otherOriginCalendarPathCount,
  failureSnapshot = unavailableDefaultWaitFailureSnapshot(),
) {
  if (
    !isRecord(pendingEndpointCounts) ||
    Object.keys(pendingEndpointCounts).length !==
      DEFAULT_WAIT_ENDPOINTS.length ||
    Object.keys(pendingEndpointCounts).some(
      (endpoint) => !ENDPOINTS.has(endpoint),
    ) ||
    DEFAULT_WAIT_ENDPOINTS.some(
      (endpoint) =>
        !Number.isSafeInteger(pendingEndpointCounts[endpoint]) ||
        pendingEndpointCounts[endpoint] < 0,
    ) ||
    !Number.isSafeInteger(otherOriginCalendarPathCount) ||
    otherOriginCalendarPathCount < 0
  ) {
    throw new Error('invalid default wait observation input');
  }

  const pendingByEndpoint = {};
  const pendingOverflowByEndpoint = {};
  for (const endpoint of DEFAULT_WAIT_ENDPOINTS) {
    const count = pendingEndpointCounts[endpoint];
    pendingByEndpoint[endpoint] = Math.min(
      count,
      MAX_DEFAULT_WAIT_DIAGNOSTIC_COUNT,
    );
    pendingOverflowByEndpoint[endpoint] =
      count > MAX_DEFAULT_WAIT_DIAGNOSTIC_COUNT;
  }

  if (!validDefaultWaitFailureSnapshot(failureSnapshot)) {
    throw new Error('invalid default wait observation input');
  }

  const completedByEndpoint = summarizeCompletedDefaultApiRows(
    failureSnapshot.completedApiRows,
  );

  return {
    pendingByEndpoint,
    pendingOverflowByEndpoint,
    otherOriginCalendarPathCount: Math.min(
      otherOriginCalendarPathCount,
      MAX_DEFAULT_WAIT_DIAGNOSTIC_COUNT,
    ),
    otherOriginCalendarPathOverflow:
      otherOriginCalendarPathCount > MAX_DEFAULT_WAIT_DIAGNOSTIC_COUNT,
    widgetConfiguration: failureSnapshot.widgetConfiguration,
    createControl: failureSnapshot.createControl,
    completedByEndpoint,
    completedApiRowsOverflow: failureSnapshot.completedApiRowsOverflow,
  };
}

const DEFAULT_COMPLETED_ENDPOINTS = [
  'context',
  'calendars',
  'events',
  'openid',
];
const DEFAULT_REPOSITORY_SELECTIONS = new Set([
  'explicit-gateway-parameters',
  'in-memory-forced',
  'build-config-fallback-possible',
  'unavailable',
]);
const DEFAULT_COMPLETED_STATUS_BUCKETS = [
  'success',
  'clientError',
  'serverError',
  'otherStatus',
  'requestFailed',
];

function unavailableDefaultWaitFailureSnapshot() {
  return {
    widgetConfiguration: {
      available: false,
      gatewayBaseParameterPresent: null,
      gatewayBaseValuePresent: null,
      gatewayBaseOriginMatches: null,
      roomIdParameterPresent: null,
      roomIdValuePresent: null,
      roomIdMatches: null,
      repositoryConfig: 'unavailable',
    },
    createControl: {
      available: false,
      count: null,
      visible: null,
      enabled: null,
    },
    completedApiRows: [],
    completedApiRowsOverflow: false,
  };
}

function validDefaultWaitFailureSnapshot(value) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'widgetConfiguration',
      'createControl',
      'completedApiRows',
      'completedApiRowsOverflow',
    ]) ||
    !hasExactKeys(value.widgetConfiguration, [
      'available',
      'gatewayBaseParameterPresent',
      'gatewayBaseValuePresent',
      'gatewayBaseOriginMatches',
      'roomIdParameterPresent',
      'roomIdValuePresent',
      'roomIdMatches',
      'repositoryConfig',
    ]) ||
    typeof value.widgetConfiguration.available !== 'boolean' ||
    ![null, true, false].includes(
      value.widgetConfiguration.gatewayBaseParameterPresent,
    ) ||
    ![null, true, false].includes(
      value.widgetConfiguration.gatewayBaseValuePresent,
    ) ||
    ![null, true, false].includes(
      value.widgetConfiguration.gatewayBaseOriginMatches,
    ) ||
    ![null, true, false].includes(
      value.widgetConfiguration.roomIdParameterPresent,
    ) ||
    ![null, true, false].includes(
      value.widgetConfiguration.roomIdValuePresent,
    ) ||
    ![null, true, false].includes(value.widgetConfiguration.roomIdMatches) ||
    !DEFAULT_REPOSITORY_SELECTIONS.has(
      value.widgetConfiguration.repositoryConfig,
    ) ||
    !hasExactKeys(value.createControl, [
      'available',
      'count',
      'visible',
      'enabled',
    ]) ||
    typeof value.createControl.available !== 'boolean' ||
    ![null, 0, 1, 2].includes(value.createControl.count) ||
    ![null, true, false].includes(value.createControl.visible) ||
    ![null, true, false].includes(value.createControl.enabled) ||
    !Array.isArray(value.completedApiRows) ||
    value.completedApiRows.length > MAX_DEFAULT_WAIT_DIAGNOSTIC_COUNT ||
    typeof value.completedApiRowsOverflow !== 'boolean'
  ) {
    return false;
  }

  const configuration = value.widgetConfiguration;
  if (
    configuration.available !==
    (configuration.repositoryConfig !== 'unavailable')
  ) {
    return false;
  }
  if (
    !configuration.available &&
    (configuration.gatewayBaseValuePresent !== null ||
      configuration.gatewayBaseParameterPresent !== null ||
      configuration.gatewayBaseOriginMatches !== null ||
      configuration.roomIdParameterPresent !== null ||
      configuration.roomIdValuePresent !== null ||
      configuration.roomIdMatches !== null)
  ) {
    return false;
  }
  if (
    configuration.available &&
    (typeof configuration.gatewayBaseParameterPresent !== 'boolean' ||
      typeof configuration.gatewayBaseValuePresent !== 'boolean' ||
      typeof configuration.roomIdParameterPresent !== 'boolean' ||
      typeof configuration.roomIdValuePresent !== 'boolean' ||
      !DEFAULT_REPOSITORY_SELECTIONS.has(configuration.repositoryConfig))
  ) {
    return false;
  }
  if (
    configuration.available &&
    ((!configuration.gatewayBaseParameterPresent &&
      configuration.gatewayBaseValuePresent) ||
      (configuration.gatewayBaseValuePresent &&
        typeof configuration.gatewayBaseOriginMatches !== 'boolean') ||
      (!configuration.gatewayBaseValuePresent &&
        configuration.gatewayBaseOriginMatches !== null) ||
      (!configuration.roomIdParameterPresent &&
        configuration.roomIdValuePresent) ||
      (configuration.roomIdValuePresent &&
        typeof configuration.roomIdMatches !== 'boolean') ||
      (!configuration.roomIdValuePresent &&
        configuration.roomIdMatches !== null))
  ) {
    return false;
  }
  if (
    configuration.gatewayBaseValuePresent === true &&
    configuration.gatewayBaseParameterPresent !== true
  ) {
    return false;
  }
  if (
    configuration.roomIdValuePresent === true &&
    configuration.roomIdParameterPresent !== true
  ) {
    return false;
  }
  if (
    configuration.repositoryConfig === 'explicit-gateway-parameters' &&
    (configuration.gatewayBaseParameterPresent !== true ||
      configuration.gatewayBaseValuePresent !== true ||
      configuration.roomIdValuePresent !== true)
  ) {
    return false;
  }
  if (
    configuration.repositoryConfig === 'in-memory-forced' &&
    configuration.roomIdValuePresent === true &&
    !(
      configuration.gatewayBaseParameterPresent === true &&
      configuration.gatewayBaseValuePresent === false
    )
  ) {
    return false;
  }
  if (
    configuration.repositoryConfig === 'build-config-fallback-possible' &&
    (configuration.gatewayBaseParameterPresent !== false ||
      configuration.roomIdValuePresent !== true)
  ) {
    return false;
  }
  if (
    configuration.available &&
    configuration.repositoryConfig === 'unavailable'
  ) {
    return false;
  }

  if (
    (!value.createControl.available &&
      (value.createControl.count !== null ||
        value.createControl.visible !== null ||
        value.createControl.enabled !== null)) ||
    (value.createControl.available && value.createControl.count === null) ||
    (value.createControl.count === 0 &&
      (value.createControl.visible !== false ||
        value.createControl.enabled !== false)) ||
    (value.createControl.count === 1 &&
      (![null, true, false].includes(value.createControl.visible) ||
        ![null, true, false].includes(value.createControl.enabled))) ||
    (value.createControl.count === 2 &&
      (value.createControl.visible !== null ||
        value.createControl.enabled !== null))
  ) {
    return false;
  }

  if (
    value.completedApiRowsOverflow &&
    value.completedApiRows.length !== MAX_DEFAULT_WAIT_DIAGNOSTIC_COUNT
  ) {
    return false;
  }

  return value.completedApiRows.every(
    (row) =>
      isRecord(row) &&
      hasExactKeys(row, ['endpoint', 'status', 'decoded']) &&
      DEFAULT_COMPLETED_ENDPOINTS.includes(row.endpoint) &&
      (row.status === 0 || boundedInteger(row.status, 100, 599)) &&
      typeof row.decoded === 'boolean',
  );
}

function emptyCompletedEndpointSummary() {
  return {
    count: 0,
    success: 0,
    clientError: 0,
    serverError: 0,
    otherStatus: 0,
    requestFailed: 0,
    decoded: 0,
    decodeFailed: 0,
  };
}

function summarizeCompletedDefaultApiRows(rows) {
  const result = Object.fromEntries(
    DEFAULT_COMPLETED_ENDPOINTS.map((endpoint) => [
      endpoint,
      emptyCompletedEndpointSummary(),
    ]),
  );

  for (const row of rows) {
    const summary = result[row.endpoint];
    summary.count += 1;

    const bucket =
      row.status === 0
        ? 'requestFailed'
        : row.status >= 200 && row.status < 300
          ? 'success'
          : row.status >= 400 && row.status < 500
            ? 'clientError'
            : row.status >= 500 && row.status < 600
              ? 'serverError'
              : 'otherStatus';
    summary[bucket] = Math.min(
      summary[bucket] + 1,
      MAX_DEFAULT_WAIT_DIAGNOSTIC_COUNT,
    );
    const decodeBucket = row.decoded ? 'decoded' : 'decodeFailed';
    summary[decodeBucket] = Math.min(
      summary[decodeBucket] + 1,
      MAX_DEFAULT_WAIT_DIAGNOSTIC_COUNT,
    );
  }

  return result;
}

function validLegacyReport(report) {
  return (
    hasExactKeys(report, REPORT_KEYS) &&
    report.version === 2 &&
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
    ['widget-card', 'apps-drawer', 'unknown'].includes(
      report.coldList.placement,
    ) &&
    boundedInteger(report.coldList.widgetCardCount, 0, 2) &&
    typeof report.coldList.widgetCardVisible === 'boolean' &&
    (!report.coldList.widgetCardVisible ||
      report.coldList.widgetCardCount === 1) &&
    boundedInteger(report.coldList.appDrawerCount, 0, 2) &&
    boundedInteger(report.coldList.persistedHostFrameCount, 0, 2) &&
    typeof report.coldList.persistedHostFrameVisible === 'boolean' &&
    (!report.coldList.persistedHostFrameVisible ||
      report.coldList.persistedHostFrameCount === 1) &&
    optionalCount(report.coldList.iframeWidth, 4096) &&
    optionalCount(report.coldList.iframeHeight, 4096) &&
    (typeof report.coldList.hostHorizontalOverflow === 'boolean' ||
      report.coldList.hostHorizontalOverflow === null) &&
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
    optionalCount(report.pageErrorCount, 100_000) &&
    PAGE_ERROR_CLASSES.has(report.pageErrorClass) &&
    (report.pageErrorCount === null
      ? report.pageErrorClass === 'none'
      : report.pageErrorCount === 0
        ? report.pageErrorClass === 'none'
        : report.pageErrorClass !== 'none')
  );
}

const ORDINARY_REPORT_KEYS = [
  'version',
  'viewportWidth',
  'viewportHeight',
  'calendarDays',
  'timezone',
  'cases',
  'apiResponses',
  'blockedRequestCount',
  'pageErrorCount',
  'pageErrorClass',
];
const ORDINARY_CASE_KEYS = [
  'profile',
  'year',
  'month',
  'eventCount',
  'preparation',
  'defaultView',
  'defaultWaitObservation',
  'coldList',
  'refreshSetup',
  'refresh',
  'detailSamples',
];
const DEFAULT_VIEW_KEYS = [
  'durationMs',
  'apiResponseCount',
  'apiRangeMaxMs',
  'returnedCount',
  'renderedCount',
  'rangeMatches',
  'countMatches',
  'usableControlVisible',
  'stable',
];
const DEFAULT_WAIT_OBSERVATION_KEYS = [
  'pendingByEndpoint',
  'pendingOverflowByEndpoint',
  'otherOriginCalendarPathCount',
  'otherOriginCalendarPathOverflow',
  'widgetConfiguration',
  'createControl',
  'completedByEndpoint',
  'completedApiRowsOverflow',
];
const DEFAULT_WIDGET_CONFIGURATION_KEYS = [
  'available',
  'gatewayBaseParameterPresent',
  'gatewayBaseValuePresent',
  'gatewayBaseOriginMatches',
  'roomIdParameterPresent',
  'roomIdValuePresent',
  'roomIdMatches',
  'repositoryConfig',
];
const DEFAULT_CREATE_CONTROL_KEYS = [
  'available',
  'count',
  'visible',
  'enabled',
];
const DEFAULT_COMPLETED_SUMMARY_KEYS = [
  'count',
  ...DEFAULT_COMPLETED_STATUS_BUCKETS,
  'decoded',
  'decodeFailed',
];
const ACTION_KEYS = [
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

function validOrdinaryColdList(value) {
  return (
    hasExactKeys(value, COLD_KEYS) &&
    COLD_KEYS.slice(0, 6).every((key) => optionalMilliseconds(value[key])) &&
    ['widget-card', 'apps-drawer', 'unknown'].includes(value.placement) &&
    boundedInteger(value.widgetCardCount, 0, 2) &&
    typeof value.widgetCardVisible === 'boolean' &&
    (!value.widgetCardVisible || value.widgetCardCount === 1) &&
    boundedInteger(value.appDrawerCount, 0, 2) &&
    boundedInteger(value.persistedHostFrameCount, 0, 2) &&
    typeof value.persistedHostFrameVisible === 'boolean' &&
    (!value.persistedHostFrameVisible || value.persistedHostFrameCount === 1) &&
    optionalCount(value.iframeWidth, 4096) &&
    optionalCount(value.iframeHeight, 4096) &&
    (typeof value.hostHorizontalOverflow === 'boolean' ||
      value.hostHorizontalOverflow === null) &&
    optionalMilliseconds(value.rangeSelectionMs) &&
    boundedInteger(value.openIdResponseCount, 0, 8) &&
    optionalMilliseconds(value.openIdMaxMs) &&
    optionalMilliseconds(value.apiRangeMaxMs) &&
    boundedInteger(value.selectedRoomResponseCount, 0, 8) &&
    optionalCount(value.returnedCount) &&
    optionalCount(value.renderedCount) &&
    [
      'expectedRangeMatches',
      'identitiesMatch',
      'diagnosticsZero',
      'stable',
    ].every((key) => typeof value[key] === 'boolean') &&
    (typeof value.horizontalOverflow === 'boolean' ||
      value.horizontalOverflow === null)
  );
}

function validOrdinaryDefaultView(value) {
  return (
    hasExactKeys(value, DEFAULT_VIEW_KEYS) &&
    optionalMilliseconds(value.durationMs) &&
    boundedInteger(value.apiResponseCount, 0, 64) &&
    optionalMilliseconds(value.apiRangeMaxMs) &&
    optionalCount(value.returnedCount, 250) &&
    optionalCount(value.renderedCount, 250) &&
    ['rangeMatches', 'countMatches', 'usableControlVisible', 'stable'].every(
      (key) => typeof value[key] === 'boolean',
    )
  );
}

function validDefaultWaitObservation(value) {
  if (value === null) return true;
  if (
    !hasExactKeys(value, DEFAULT_WAIT_OBSERVATION_KEYS) ||
    !hasExactKeys(value.pendingByEndpoint, DEFAULT_WAIT_ENDPOINTS) ||
    !hasExactKeys(value.pendingOverflowByEndpoint, DEFAULT_WAIT_ENDPOINTS) ||
    !hasExactKeys(
      value.widgetConfiguration,
      DEFAULT_WIDGET_CONFIGURATION_KEYS,
    ) ||
    !hasExactKeys(value.createControl, DEFAULT_CREATE_CONTROL_KEYS) ||
    !hasExactKeys(value.completedByEndpoint, DEFAULT_COMPLETED_ENDPOINTS) ||
    !boundedInteger(
      value.otherOriginCalendarPathCount,
      0,
      MAX_DEFAULT_WAIT_DIAGNOSTIC_COUNT,
    ) ||
    typeof value.otherOriginCalendarPathOverflow !== 'boolean' ||
    typeof value.completedApiRowsOverflow !== 'boolean'
  ) {
    return false;
  }

  for (const endpoint of DEFAULT_WAIT_ENDPOINTS) {
    const count = value.pendingByEndpoint[endpoint];
    const overflow = value.pendingOverflowByEndpoint[endpoint];
    if (
      !boundedInteger(count, 0, MAX_DEFAULT_WAIT_DIAGNOSTIC_COUNT) ||
      typeof overflow !== 'boolean' ||
      (overflow && count !== MAX_DEFAULT_WAIT_DIAGNOSTIC_COUNT)
    ) {
      return false;
    }
  }

  const configuration = value.widgetConfiguration;
  if (typeof configuration.available !== 'boolean') return false;
  if (!configuration.available) {
    if (
      configuration.repositoryConfig !== 'unavailable' ||
      DEFAULT_WIDGET_CONFIGURATION_KEYS.slice(1, -1).some(
        (key) => configuration[key] !== null,
      )
    ) {
      return false;
    }
  } else {
    if (
      configuration.repositoryConfig === 'unavailable' ||
      typeof configuration.gatewayBaseParameterPresent !== 'boolean' ||
      typeof configuration.gatewayBaseValuePresent !== 'boolean' ||
      typeof configuration.roomIdParameterPresent !== 'boolean' ||
      typeof configuration.roomIdValuePresent !== 'boolean' ||
      !DEFAULT_REPOSITORY_SELECTIONS.has(configuration.repositoryConfig)
    ) {
      return false;
    }
    if (
      (!configuration.gatewayBaseParameterPresent &&
        configuration.gatewayBaseValuePresent) ||
      (configuration.gatewayBaseValuePresent &&
        typeof configuration.gatewayBaseOriginMatches !== 'boolean') ||
      (!configuration.gatewayBaseValuePresent &&
        configuration.gatewayBaseOriginMatches !== null) ||
      (!configuration.roomIdParameterPresent &&
        configuration.roomIdValuePresent) ||
      (configuration.roomIdValuePresent &&
        typeof configuration.roomIdMatches !== 'boolean') ||
      (!configuration.roomIdValuePresent &&
        configuration.roomIdMatches !== null)
    ) {
      return false;
    }
    if (
      configuration.repositoryConfig === 'explicit-gateway-parameters' &&
      (!configuration.gatewayBaseParameterPresent ||
        !configuration.gatewayBaseValuePresent ||
        !configuration.roomIdValuePresent)
    ) {
      return false;
    }
    if (
      configuration.repositoryConfig === 'in-memory-forced' &&
      configuration.roomIdValuePresent &&
      !(
        configuration.gatewayBaseParameterPresent &&
        !configuration.gatewayBaseValuePresent
      )
    ) {
      return false;
    }
    if (
      configuration.repositoryConfig === 'build-config-fallback-possible' &&
      (configuration.gatewayBaseParameterPresent ||
        !configuration.roomIdValuePresent)
    ) {
      return false;
    }
  }

  const createControl = value.createControl;
  if (typeof createControl.available !== 'boolean') return false;
  if (!createControl.available) {
    if (
      createControl.count !== null ||
      createControl.visible !== null ||
      createControl.enabled !== null
    ) {
      return false;
    }
  } else if (
    ![0, 1, 2].includes(createControl.count) ||
    (createControl.count === 0 &&
      (createControl.visible !== false || createControl.enabled !== false)) ||
    (createControl.count === 1 &&
      (![null, true, false].includes(createControl.visible) ||
        ![null, true, false].includes(createControl.enabled))) ||
    (createControl.count === 2 &&
      (createControl.visible !== null || createControl.enabled !== null))
  ) {
    return false;
  }

  let totalCompleted = 0;
  for (const endpoint of DEFAULT_COMPLETED_ENDPOINTS) {
    const summary = value.completedByEndpoint[endpoint];
    if (
      !hasExactKeys(summary, DEFAULT_COMPLETED_SUMMARY_KEYS) ||
      !DEFAULT_COMPLETED_SUMMARY_KEYS.every((key) =>
        boundedInteger(summary[key], 0, MAX_DEFAULT_WAIT_DIAGNOSTIC_COUNT),
      ) ||
      DEFAULT_COMPLETED_STATUS_BUCKETS.reduce(
        (total, key) => total + summary[key],
        0,
      ) !== summary.count ||
      summary.decoded + summary.decodeFailed !== summary.count
    ) {
      return false;
    }
    totalCompleted += summary.count;
  }

  return (
    (!value.otherOriginCalendarPathOverflow ||
      value.otherOriginCalendarPathCount ===
        MAX_DEFAULT_WAIT_DIAGNOSTIC_COUNT) &&
    (!value.completedApiRowsOverflow ||
      totalCompleted === MAX_DEFAULT_WAIT_DIAGNOSTIC_COUNT)
  );
}

function validOrdinaryAction(value) {
  return (
    hasExactKeys(value, ACTION_KEYS) &&
    optionalMilliseconds(value.durationMs) &&
    boundedInteger(value.apiResponseCount, 0, 64) &&
    optionalMilliseconds(value.apiRangeMaxMs) &&
    boundedInteger(value.roomResponseCount, 0, 8) &&
    optionalCount(value.returnedCount, 250) &&
    optionalCount(value.renderedCount, 250) &&
    ['rangeMatches', 'identitiesMatch', 'diagnosticsZero', 'stable'].every(
      (key) => typeof value[key] === 'boolean',
    ) &&
    (typeof value.horizontalOverflow === 'boolean' ||
      value.horizontalOverflow === null)
  );
}

function validOrdinaryCase(value) {
  const expectedCount = value?.profile === 'empty' ? 0 : 25;
  return (
    hasExactKeys(value, ORDINARY_CASE_KEYS) &&
    (value.profile === 'empty' || value.profile === 'events-25') &&
    boundedInteger(value.year, 2020, 2200) &&
    boundedInteger(value.month, 1, 12) &&
    value.eventCount === expectedCount &&
    hasExactKeys(value.preparation, PREPARATION_KEYS) &&
    PREPARATION_KEYS.every((key) =>
      optionalMilliseconds(value.preparation[key]),
    ) &&
    validOrdinaryDefaultView(value.defaultView) &&
    validDefaultWaitObservation(value.defaultWaitObservation) &&
    validOrdinaryColdList(value.coldList) &&
    value.coldList.rangeSelectionMs === null &&
    validOrdinaryAction(value.refreshSetup) &&
    validOrdinaryAction(value.refresh) &&
    Array.isArray(value.detailSamples) &&
    value.detailSamples.length <= 5 &&
    value.detailSamples.every((sample, index) =>
      validDetailSample(sample, index + 1),
    )
  );
}

function validOrdinaryReport(report) {
  return (
    hasExactKeys(report, ORDINARY_REPORT_KEYS) &&
    report.version === 7 &&
    report.viewportWidth === 1280 &&
    report.viewportHeight === 800 &&
    report.calendarDays === 7 &&
    report.timezone === 'Europe/Stockholm' &&
    Array.isArray(report.cases) &&
    report.cases.length === 2 &&
    report.cases[0]?.profile === 'empty' &&
    report.cases[1]?.profile === 'events-25' &&
    report.cases.every(validOrdinaryCase) &&
    report.cases[0].year === report.cases[1].year &&
    report.cases[0].month === report.cases[1].month &&
    Array.isArray(report.apiResponses) &&
    report.apiResponses.length <= 512 &&
    report.apiResponses.every(validApiResponse) &&
    report.apiResponses.every((row) =>
      /^(?:empty|events-25)-(?:default|refresh-setup|refresh)$|^events-25-details-[1-5]$/u.test(
        row.sample,
      ),
    ) &&
    optionalCount(report.blockedRequestCount, 100_000) &&
    optionalCount(report.pageErrorCount, 100_000) &&
    PAGE_ERROR_CLASSES.has(report.pageErrorClass) &&
    (report.pageErrorCount === null
      ? report.pageErrorClass === 'none'
      : report.pageErrorCount === 0
        ? report.pageErrorClass === 'none'
        : report.pageErrorClass !== 'none')
  );
}

function validReport(report) {
  return isRecord(report) && report.version === 7
    ? validOrdinaryReport(report)
    : validLegacyReport(report);
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

function legacyReportPasses(report) {
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
      report.coldList.rangeSelectionMs,
    ].every((value) => value !== null) &&
    report.coldList.openIdResponseCount > 0 &&
    report.coldList.openIdMaxMs !== null &&
    report.coldList.placement === 'widget-card' &&
    report.coldList.widgetCardCount === 1 &&
    report.coldList.widgetCardVisible &&
    report.coldList.persistedHostFrameCount === 1 &&
    report.coldList.persistedHostFrameVisible &&
    report.coldList.iframeWidth !== null &&
    report.coldList.iframeWidth > 0 &&
    report.coldList.iframeHeight !== null &&
    report.coldList.iframeHeight > 0 &&
    report.coldList.hostHorizontalOverflow === false &&
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
    report.pageErrorClass === 'none' &&
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

function ordinaryRoomRows(report, sample, rangeClass) {
  return report.apiResponses.filter(
    (row) =>
      row.sample === sample &&
      row.endpoint === 'events' &&
      row.target === 'room' &&
      row.calendarMatches === true &&
      row.rangeClass === rangeClass &&
      row.rangeMatches === true,
  );
}

function ordinaryEvents(report, sample) {
  return report.apiResponses.filter(
    (row) => row.sample === sample && row.endpoint === 'events',
  );
}

function summarizeOrdinaryApi(report, sample, action, rangeClass) {
  const events = ordinaryEvents(report, sample);
  const roomRows = ordinaryRoomRows(report, sample, rangeClass);
  const maxMs = events.length
    ? Math.max(...events.map((row) => row.durationMs))
    : null;
  return (
    action.apiResponseCount === events.length &&
    action.apiRangeMaxMs === maxMs &&
    action.roomResponseCount === roomRows.length &&
    action.returnedCount ===
      (roomRows.length === 1 ? roomRows[0].eventCount : null)
  );
}

function ordinaryDefaultMatches(report, performanceCase) {
  const sample = `${performanceCase.profile}-default`;
  const events = ordinaryEvents(report, sample);
  const rooms = ordinaryRoomRows(report, sample, 'preselection');
  const maxMs = events.length
    ? Math.max(...events.map((row) => row.durationMs))
    : null;
  const view = performanceCase.defaultView;
  return (
    events.length === view.apiResponseCount &&
    maxMs === view.apiRangeMaxMs &&
    rooms.length === 1 &&
    rooms[0].expectedTitlesMatch === true &&
    rooms[0].eventCount === performanceCase.eventCount &&
    view.returnedCount === performanceCase.eventCount &&
    view.renderedCount === performanceCase.eventCount
  );
}

function ordinaryColdMatches(report, performanceCase) {
  const sample = `${performanceCase.profile}-default`;
  const events = ordinaryEvents(report, sample);
  const rooms = ordinaryRoomRows(report, sample, 'preselection');
  const openIdRows = report.apiResponses.filter(
    (row) => row.sample === sample && row.endpoint === 'openid',
  );
  const cold = performanceCase.coldList;
  const defaultView = performanceCase.defaultView;
  const eventMax = events.length
    ? Math.max(...events.map((row) => row.durationMs))
    : null;
  const openIdMax = openIdRows.length
    ? Math.max(...openIdRows.map((row) => row.durationMs))
    : null;
  return (
    cold.durationMs === defaultView.durationMs &&
    cold.apiRangeMaxMs === eventMax &&
    cold.selectedRoomResponseCount === rooms.length &&
    cold.returnedCount === (rooms.length === 1 ? rooms[0].eventCount : null) &&
    cold.renderedCount === defaultView.renderedCount &&
    cold.expectedRangeMatches === defaultView.rangeMatches &&
    cold.identitiesMatch ===
      (rooms.length === 1 && rooms[0].expectedTitlesMatch === true) &&
    cold.diagnosticsZero ===
      (events.length > 0 && events.every((row) => row.diagnosticCount === 0)) &&
    cold.openIdResponseCount === openIdRows.length &&
    cold.openIdMaxMs === openIdMax
  );
}

function ordinaryActionPasses(action, expectedCount, maxDuration) {
  return (
    action.durationMs !== null &&
    (maxDuration === null || action.durationMs <= maxDuration) &&
    action.apiResponseCount > 0 &&
    action.apiRangeMaxMs !== null &&
    action.apiRangeMaxMs <= 1000 &&
    action.roomResponseCount === 1 &&
    action.returnedCount === expectedCount &&
    action.renderedCount === expectedCount &&
    action.rangeMatches &&
    action.identitiesMatch &&
    action.diagnosticsZero &&
    action.stable &&
    action.horizontalOverflow === false
  );
}

function ordinarySetupPasses(action) {
  return (
    action.durationMs !== null &&
    action.apiResponseCount > 0 &&
    action.apiRangeMaxMs !== null &&
    action.apiRangeMaxMs <= 1000 &&
    action.roomResponseCount === 1 &&
    action.returnedCount === 0 &&
    action.renderedCount === 0 &&
    action.rangeMatches &&
    action.identitiesMatch &&
    action.diagnosticsZero &&
    action.stable &&
    action.horizontalOverflow === false
  );
}

function ordinaryCasePasses(report, performanceCase) {
  const count = performanceCase.eventCount;
  const defaultView = performanceCase.defaultView;
  const cold = performanceCase.coldList;
  const setupSample = `${performanceCase.profile}-refresh-setup`;
  const refreshSample = `${performanceCase.profile}-refresh`;
  return (
    [
      performanceCase.preparation.elementLoginMs,
      performanceCase.preparation.roomNavigationMs,
      cold.widgetStartupMs,
      cold.activationMs,
      cold.capabilityApprovalMs,
      cold.identityApprovalMs,
      cold.iframeReadyMs,
    ].every((value) => value !== null) &&
    defaultView.durationMs !== null &&
    defaultView.durationMs <= 2000 &&
    defaultView.apiResponseCount > 0 &&
    defaultView.apiRangeMaxMs !== null &&
    defaultView.apiRangeMaxMs <= 1000 &&
    defaultView.returnedCount === count &&
    defaultView.renderedCount === count &&
    defaultView.rangeMatches &&
    defaultView.countMatches &&
    defaultView.usableControlVisible &&
    defaultView.stable &&
    ordinaryDefaultMatches(report, performanceCase) &&
    cold.rangeSelectionMs === null &&
    cold.durationMs !== null &&
    cold.durationMs === defaultView.durationMs &&
    cold.durationMs <= 2000 &&
    cold.openIdResponseCount > 0 &&
    cold.openIdMaxMs !== null &&
    cold.placement === 'widget-card' &&
    cold.widgetCardCount === 1 &&
    cold.widgetCardVisible &&
    cold.persistedHostFrameCount === 1 &&
    cold.persistedHostFrameVisible &&
    cold.iframeWidth !== null &&
    cold.iframeWidth > 0 &&
    cold.iframeHeight !== null &&
    cold.iframeHeight > 0 &&
    cold.hostHorizontalOverflow === false &&
    cold.expectedRangeMatches &&
    cold.selectedRoomResponseCount === 1 &&
    cold.returnedCount === count &&
    cold.renderedCount === count &&
    cold.identitiesMatch &&
    cold.diagnosticsZero &&
    cold.stable &&
    cold.horizontalOverflow === false &&
    cold.apiRangeMaxMs !== null &&
    cold.apiRangeMaxMs <= 1000 &&
    ordinaryColdMatches(report, performanceCase) &&
    ordinarySetupPasses(performanceCase.refreshSetup) &&
    summarizeOrdinaryApi(
      report,
      setupSample,
      performanceCase.refreshSetup,
      'preselection-next',
    ) &&
    ordinaryActionPasses(performanceCase.refresh, count, 2000) &&
    summarizeOrdinaryApi(
      report,
      refreshSample,
      performanceCase.refresh,
      'preselection',
    ) &&
    performanceCase.detailSamples.length === (count === 25 ? 5 : 0) &&
    performanceCase.detailSamples.every(
      (sample) =>
        sample.durationMs !== null &&
        sample.durationMs <= 500 &&
        sample.visible &&
        sample.titleMatches &&
        sample.stable &&
        sample.horizontalOverflow === false,
    ) &&
    performanceCase.detailSamples.every(
      (sample, index) => sample.index === index + 1,
    )
  );
}

function ordinaryReportPasses(report) {
  return (
    report.cases.every((performanceCase) =>
      ordinaryCasePasses(report, performanceCase),
    ) &&
    report.blockedRequestCount === 0 &&
    report.pageErrorCount === 0 &&
    report.pageErrorClass === 'none' &&
    report.apiResponses.every(
      (row) =>
        row.status === 200 &&
        row.decoded &&
        row.method === (row.endpoint === 'openid' ? 'POST' : 'GET') &&
        (row.endpoint === 'openid' || row.durationMs <= 1000) &&
        (row.endpoint !== 'events' || row.diagnosticCount === 0) &&
        (row.endpoint !== 'events' ||
          row.rangeClass === 'preselection' ||
          row.rangeMatches === true) &&
        (row.endpoint !== 'events' ||
          row.target !== 'room' ||
          (() => {
            const performanceCase = report.cases.find(({ profile }) =>
              row.sample.startsWith(`${profile}-`),
            );
            if (!performanceCase || row.calendarMatches !== true) return false;
            const samplePhase = row.sample.slice(
              performanceCase.profile.length + 1,
            );
            if (samplePhase === 'default') {
              return (
                row.rangeClass === 'preselection' && row.rangeMatches === true
              );
            }
            const expectedRange = {
              'refresh-setup': 'preselection-next',
              refresh: 'preselection',
            }[samplePhase];
            const detailRange = /^details-[1-5]$/u.test(samplePhase)
              ? 'preselection'
              : undefined;
            return (
              (expectedRange !== undefined || detailRange !== undefined) &&
              row.rangeClass === (expectedRange ?? detailRange) &&
              row.rangeMatches === true &&
              row.eventCount ===
                (samplePhase === 'refresh-setup'
                  ? 0
                  : performanceCase.eventCount) &&
              row.expectedTitlesMatch === true
            );
          })()),
    )
  );
}

function reportPasses(report) {
  return report.version === 7
    ? ordinaryReportPasses(report)
    : legacyReportPasses(report);
}

function validDefaultWaitRecord(record) {
  if (record.performanceReport.version !== 7) return true;
  const snapshotCount = record.performanceReport.cases.filter(
    (performanceCase) => performanceCase.defaultWaitObservation !== null,
  ).length;
  return record.status === 'failed' &&
    record.failureCode === 'performance-default-view-failed'
    ? snapshotCount === 1
    : snapshotCount === 0;
}

function display(value) {
  return value === null ? 'unavailable' : String(value);
}

function formatOrdinaryAction(profile, actionName, action) {
  return [
    'performance_action',
    `profile=${profile}`,
    `action=${actionName}`,
    `duration_ms=${display(action.durationMs)}`,
    `api_responses=${action.apiResponseCount}`,
    `event_api_max_ms=${display(action.apiRangeMaxMs)}`,
    `room_responses=${action.roomResponseCount}`,
    `returned=${display(action.returnedCount)}`,
    `rendered=${display(action.renderedCount)}`,
    `range_matches=${action.rangeMatches}`,
    `identities_match=${action.identitiesMatch}`,
    `diagnostics_zero=${action.diagnosticsZero}`,
    `stable=${action.stable}`,
    `horizontal_overflow=${display(action.horizontalOverflow)}`,
  ].join(' ');
}

function formatOrdinaryPerformanceEvidence(record) {
  const report = record.performanceReport;
  const lines = [
    [
      'phase=performance-pilot',
      'report_version=7',
      'profile=ordinary-0-25',
      `beta_gate_eligible=${record.status === 'passed'}`,
      `status=${record.status}`,
      `failure_code=${record.failureCode ?? 'none'}`,
      'cases=2',
      'calendar_days=7',
      `timezone=${report.timezone}`,
      `viewport_width=${report.viewportWidth}`,
      `viewport_height=${report.viewportHeight}`,
      `blocked_requests=${display(report.blockedRequestCount)}`,
      `page_errors=${display(report.pageErrorCount)}`,
      `page_error_class=${report.pageErrorClass}`,
    ].join(' '),
  ];

  for (const performanceCase of report.cases) {
    const {
      profile,
      year,
      month,
      eventCount,
      preparation,
      defaultView,
      defaultWaitObservation,
      coldList,
    } = performanceCase;
    lines.push(
      `performance_case profile=${profile} events=${eventCount} month=${year}-${String(month).padStart(2, '0')}`,
      `performance_preparation profile=${profile} login_ms=${display(preparation.elementLoginMs)} room_navigation_ms=${display(preparation.roomNavigationMs)}`,
      [
        'performance_default_view',
        `profile=${profile}`,
        `elapsed_ms=${display(defaultView.durationMs)}`,
        `api_responses=${defaultView.apiResponseCount}`,
        `event_api_max_ms=${display(defaultView.apiRangeMaxMs)}`,
        `returned=${display(defaultView.returnedCount)}`,
        `rendered=${display(defaultView.renderedCount)}`,
        `range_matches=${defaultView.rangeMatches}`,
        `count_matches=${defaultView.countMatches}`,
        `create_visible=${defaultView.usableControlVisible}`,
        `stable=${defaultView.stable}`,
      ].join(' '),
      [
        'performance_cold_default',
        `profile=${profile}`,
        `total_ms=${display(coldList.durationMs)}`,
        `widget_startup_ms=${display(coldList.widgetStartupMs)}`,
        `activation_ms=${display(coldList.activationMs)}`,
        `capability_approval_ms=${display(coldList.capabilityApprovalMs)}`,
        `identity_approval_ms=${display(coldList.identityApprovalMs)}`,
        `iframe_ready_ms=${display(coldList.iframeReadyMs)}`,
        `placement=${coldList.placement}`,
        `widget_card_count=${coldList.widgetCardCount}`,
        `widget_card_visible=${coldList.widgetCardVisible}`,
        `app_drawer_count=${coldList.appDrawerCount}`,
        `persisted_host_frame_count=${coldList.persistedHostFrameCount}`,
        `persisted_host_frame_visible=${coldList.persistedHostFrameVisible}`,
        `iframe_width=${display(coldList.iframeWidth)}`,
        `iframe_height=${display(coldList.iframeHeight)}`,
        `host_horizontal_overflow=${display(coldList.hostHorizontalOverflow)}`,
        `range_selection_ms=${display(coldList.rangeSelectionMs)}`,
        `openid_responses=${coldList.openIdResponseCount}`,
        `openid_max_ms=${display(coldList.openIdMaxMs)}`,
        `event_api_max_ms=${display(coldList.apiRangeMaxMs)}`,
        `room_responses=${coldList.selectedRoomResponseCount}`,
        `returned=${display(coldList.returnedCount)}`,
        `rendered=${display(coldList.renderedCount)}`,
        `range_matches=${coldList.expectedRangeMatches}`,
        `identities_match=${coldList.identitiesMatch}`,
        `diagnostics_zero=${coldList.diagnosticsZero}`,
        `stable=${coldList.stable}`,
        `horizontal_overflow=${display(coldList.horizontalOverflow)}`,
      ].join(' '),
      formatOrdinaryAction(
        profile,
        'refresh-setup',
        performanceCase.refreshSetup,
      ),
      formatOrdinaryAction(profile, 'refresh', performanceCase.refresh),
    );
    if (defaultWaitObservation !== null) {
      const counts = defaultWaitObservation.pendingByEndpoint;
      const overflows = defaultWaitObservation.pendingOverflowByEndpoint;
      lines.push(
        [
          'performance_default_wait_observation',
          `profile=${profile}`,
          ...DEFAULT_WAIT_ENDPOINTS.flatMap((endpoint) => [
            `pending_${endpoint.replace('-', '_')}=${counts[endpoint]}`,
            `pending_${endpoint.replace('-', '_')}_overflow=${overflows[endpoint]}`,
          ]),
          `other_origin_calendar_paths=${defaultWaitObservation.otherOriginCalendarPathCount}`,
          `other_origin_calendar_paths_overflow=${defaultWaitObservation.otherOriginCalendarPathOverflow}`,
        ].join(' '),
      );
      const configuration = defaultWaitObservation.widgetConfiguration;
      const createControl = defaultWaitObservation.createControl;
      lines.push(
        [
          'performance_default_wait_runtime',
          `profile=${profile}`,
          `config_available=${configuration.available}`,
          `gateway_base_parameter_present=${display(configuration.gatewayBaseParameterPresent)}`,
          `gateway_base_value_present=${display(configuration.gatewayBaseValuePresent)}`,
          `gateway_base_origin_matches=${display(configuration.gatewayBaseOriginMatches)}`,
          `room_id_parameter_present=${display(configuration.roomIdParameterPresent)}`,
          `room_id_value_present=${display(configuration.roomIdValuePresent)}`,
          `room_id_matches=${display(configuration.roomIdMatches)}`,
          `repository_config=${configuration.repositoryConfig}`,
          `create_available=${createControl.available}`,
          `create_count=${display(createControl.count)}`,
          `create_visible=${display(createControl.visible)}`,
          `create_enabled=${display(createControl.enabled)}`,
          `completed_api_rows_overflow=${defaultWaitObservation.completedApiRowsOverflow}`,
        ].join(' '),
      );
      for (const endpoint of DEFAULT_COMPLETED_ENDPOINTS) {
        const summary = defaultWaitObservation.completedByEndpoint[endpoint];
        lines.push(
          [
            'performance_default_wait_api',
            `profile=${profile}`,
            `endpoint=${endpoint}`,
            `count=${summary.count}`,
            ...DEFAULT_COMPLETED_STATUS_BUCKETS.map(
              (bucket) =>
                `${bucket.replace(/[A-Z]/gu, (letter) => `_${letter.toLowerCase()}`)}=${summary[bucket]}`,
            ),
            `decoded=${summary.decoded}`,
            `decode_failed=${summary.decodeFailed}`,
          ].join(' '),
        );
      }
    }
    if (performanceCase.detailSamples.length === 0) {
      lines.push(`performance_details profile=${profile} samples=0`);
    }
    for (const sample of performanceCase.detailSamples) {
      lines.push(
        `performance_details profile=${profile} index=${sample.index} duration_ms=${display(sample.durationMs)} visible=${sample.visible} title_matches=${sample.titleMatches} stable=${sample.stable} horizontal_overflow=${display(sample.horizontalOverflow)}`,
      );
    }
  }

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
  return lines;
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
    !validDefaultWaitRecord(record) ||
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
  if (report.version === 7) {
    return formatOrdinaryPerformanceEvidence(record);
  }
  const lines = [
    [
      'phase=performance-pilot',
      `report_version=${report.version}`,
      `status=${record.status}`,
      'profile=historical-250-diagnostic-only',
      'beta_gate_eligible=false',
      `failure_code=${record.failureCode ?? 'none'}`,
      `month=${report.year}-${String(report.month).padStart(2, '0')}`,
      `events=${report.workloadEvents}`,
      `calendar_days=${report.calendarDays}`,
      `timezone=${report.timezone}`,
      `viewport_width=${report.viewportWidth}`,
      `viewport_height=${report.viewportHeight}`,
      `blocked_requests=${display(report.blockedRequestCount)}`,
      `page_errors=${display(report.pageErrorCount)}`,
      `page_error_class=${report.pageErrorClass}`,
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
      `placement=${report.coldList.placement}`,
      `widget_card_count=${report.coldList.widgetCardCount}`,
      `widget_card_visible=${report.coldList.widgetCardVisible}`,
      `app_drawer_count=${report.coldList.appDrawerCount}`,
      `persisted_host_frame_count=${report.coldList.persistedHostFrameCount}`,
      `persisted_host_frame_visible=${report.coldList.persistedHostFrameVisible}`,
      `iframe_width=${display(report.coldList.iframeWidth)}`,
      `iframe_height=${display(report.coldList.iframeHeight)}`,
      `host_horizontal_overflow=${display(report.coldList.hostHorizontalOverflow)}`,
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
