import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isMissingModuleKind,
  isRuntimeDependencyName,
  loadRuntimeDependencyAllowlist,
} from './element-acceptance-diagnostics.mjs';

const RUNTIME_DEPENDENCIES = loadRuntimeDependencyAllowlist(
  resolve(dirname(fileURLToPath(import.meta.url)), '..'),
);

const PHASES = new Set([
  'accounts-ready',
  'service-calendar-ready',
  'service-room-ready',
  'room-ready',
  'widget-registered',
  'runtime-ready',
  'gateway-ready',
  'widget-ready',
  'element-ready',
  'member-a-registration',
  'member-a-login',
  'member-b-registration',
  'member-b-login',
  'outsider-registration',
  'outsider-login',
  'bot-registration',
  'bot-login',
  'member-a-authenticated',
  'member-a-origin-navigation',
  'member-a-credentials-seeded',
  'member-a-root-navigation',
  'member-a-session-observed',
  'member-b-authenticated',
  'outsider-authenticated',
  'member-a-room-navigation',
  'member-a-room-context',
  'member-b-room-context',
  'outsider-room-context',
  'widget-a-room-info-button',
  'widget-a-extensions-menuitem',
  'widget-a-extension-row',
  'widget-a-warning-not-required',
  'widget-a-capabilities-approval',
  'widget-a-identity-dialog-observed',
  'widget-a-identity-dialog-not-required',
  'widget-a-identity-approval',
  'widget-a-iframe-attached',
  'widget-a-runtime-observed',
  'widget-a-iframe-ready',
  'widget-a-approved',
  'widget-b-approved',
  'outsider-widget-approved',
  'browser-test-suite',
  'gateway-backed-read',
  'event-create-dialog',
  'event-create-calendar-selected',
  'event-create-title-entered',
  'event-create-submit',
  'event-create-response',
  'event-create-post-refresh-observed',
  'event-create-visible',
  'event-created',
  'shared-visibility',
  'member-a-edited',
  'outsider-room-widget-team-target',
  'outsider-room-events-api-team-target',
  'outsider-own-unbound-room',
  'stale-etag-conflict',
  'canonical-read-after-denial',
  'browser-egress',
  'runtime-versions',
  'reminder-compose-validation',
  'reminder-postgres-ready',
  'reminder-role-verified',
  'reminder-gateway-migrated',
  'reminder-configuration-stored',
  'reminder-delivery-snapshot',
  'reminder-gateway-restarted',
  'reminder-restart-delivery-row',
  'restore-quiesced',
  'restore-radicale-backup',
  'restore-postgres-backup',
  'restore-targets-prepared',
  'restore-radicale-ready',
  'restore-postgres-role-ready',
  'restore-gateway-ready',
  'restore-element-ready',
  'restore-delivery-row',
  'reminder-browser-egress',
  'reminder-room-context',
  'reminder-widget-context',
  'reminder-event-create-dialog',
  'reminder-event-created',
  'reminder-event-visible',
  'reminder-alarm-ui-readback',
  'reminder-room-configuration-enabled',
  'reminder-ui-readback',
  'reminder-initial-delivery',
  'reminder-restart-prior-state',
  'reminder-restart-scheduler-scan',
  'reminder-restart-no-duplicate',
  'reminder-restore-prior-state',
  'reminder-restore-scheduler-scan',
  'reminder-restore-no-duplicate',
  'g6-member-a-room-context',
  'g6-member-b-room-context',
  'g6-fixture-ready',
  'g6-unsupported-preservation',
  'g6-delete-and-refresh',
  'g6-keyboard-focus',
  'g6-side-panel-layout',
  'g6-browser-egress',
  'g6-resource-cleanup',
]);
const ROOM_CONTEXT_PHASES = new Set([
  'member-a-room-context',
  'reminder-room-context',
  'g6-member-a-room-context',
  'g6-member-b-room-context',
]);
const G6_PHASES = new Set(
  [...PHASES].filter(
    (phase) => phase.startsWith('g6-') && !ROOM_CONTEXT_PHASES.has(phase),
  ),
);
const REMINDER_ROOM_LAYOUT_FIELDS = [
  'roomViewPresent',
  'roomHeaderPresent',
  'roomHeadingDomPresent',
  'roomInfoControlPresent',
  'fixtureCalendarIframePresent',
];
const REMINDER_ROOM_CONTEXT_RESPONSE_FIELDS = [
  'reminderWidgetContextResponseCount',
  'reminderWidgetContextResponseStatus',
];
const PHASE_BOOLEAN_FIELDS = new Map([
  ['service-room-ready', ['serviceUserJoined', 'powerPolicyVerified']],
  ['reminder-role-verified', ['rolePolicyVerified']],
  ['reminder-widget-context', ['canManageReminders']],
  ['reminder-alarm-ui-readback', ['relativeAlarmReadback']],
  ['reminder-room-configuration-enabled', ['reminderEnabled']],
  ['reminder-ui-readback', ['relativeAlarmReadback', 'reminderEnabled']],
  [
    'reminder-initial-delivery',
    ['canaryDelivered', 'roomMentioned', 'deliveredAfterDue', 'allMarkersOnce'],
  ],
  [
    'reminder-restart-scheduler-scan',
    ['canaryDelivered', 'roomMentioned', 'deliveredAfterDue', 'allMarkersOnce'],
  ],
  [
    'reminder-restore-scheduler-scan',
    ['canaryDelivered', 'roomMentioned', 'deliveredAfterDue', 'allMarkersOnce'],
  ],
  ['reminder-restart-no-duplicate', ['allMarkersOnce']],
  ['reminder-restart-prior-state', ['allMarkersOnce']],
  ['reminder-restore-no-duplicate', ['allMarkersOnce']],
  ['reminder-restore-prior-state', ['allMarkersOnce']],
  ['reminder-delivery-snapshot', ['deliveryStateSent', 'deliveryClaimClear']],
  [
    'reminder-restart-delivery-row',
    [
      'deliveryStateSent',
      'deliveryClaimClear',
      'deliveryKeyUnchanged',
      'attemptCountUnchanged',
    ],
  ],
  [
    'restore-quiesced',
    ['gatewayStoppedGracefully', 'radicaleStoppedGracefully', 'oomFree'],
  ],
  ['restore-targets-prepared', ['freshVolume', 'freshDatabase']],
  ['restore-postgres-role-ready', ['rolePolicyVerified']],
  [
    'restore-delivery-row',
    [
      'deliveryStateSent',
      'deliveryClaimClear',
      'deliveryKeyUnchanged',
      'attemptCountUnchanged',
    ],
  ],
  ['g6-fixture-ready', ['openIdProofValid', 'allResourcesSeeded']],
  [
    'g6-unsupported-preservation',
    [
      'unsupportedWarningVisible',
      'unsupportedRowOmitted',
      'supportedNeighborVisible',
      'canonicalSnapshotAvailable',
      'neighborEditedRowVisible',
      'supportedNeighborEdited',
      'canonicalUnsupportedObjectUnchanged',
      'neighborOwnershipUpdated',
      'neighborUpdateIdentityMatches',
    ],
  ],
  [
    'g6-delete-and-refresh',
    [
      'memberBDeleteRowVisible',
      'deleteButtonVisible',
      'deleteConfirmationVisible',
      'deletedRowAbsent',
      'canonicalObjectAbsent',
      'memberBDeleteRowAbsent',
      'supportedNeighborVisible',
    ],
  ],
  [
    'g6-keyboard-focus',
    [
      'keyboardEventFocused',
      'detailsOpened',
      'editActionFocused',
      'deleteActionFocused',
      'closeActionFocused',
      'escapeClosedDialog',
      'focusReturnedToEvent',
    ],
  ],
  [
    'g6-side-panel-layout',
    [
      'widgetCardVisible',
      'createControlReachable',
      'eventDetailsReachable',
      'hostNoHorizontalOverflow',
      'widgetNoHorizontalOverflow',
      'persistedHostFramePresent',
    ],
  ],
  ['g6-browser-egress', ['browserEgressClear']],
  ['g6-resource-cleanup', ['allOwnedResourcesRemoved']],
]);
const G6_NUMERIC_FIELDS_BY_PHASE = new Map([
  ['g6-fixture-ready', ['httpStatus', 'count']],
  [
    'g6-unsupported-preservation',
    [
      'projectionHttpStatus',
      'canonicalBeforeHttpStatus',
      'neighborPatchHttpStatus',
      'canonicalAfterHttpStatus',
      'neighborCanonicalTitleReadbackHttpStatus',
      'neighborListRefreshHttpStatus',
      'neighborListRefreshEventCountCapped',
      'neighborEditedRowCountCapped',
      'count',
    ],
  ],
  [
    'g6-delete-and-refresh',
    [
      'memberBEventsHttpStatus',
      'deleteHttpStatus',
      'canonicalDeleteHttpStatus',
      'memberBReloadHttpStatus',
      'count',
    ],
  ],
  [
    'g6-keyboard-focus',
    ['count', 'eventActionTabCount', 'detailsActionTabCount'],
  ],
  [
    'g6-side-panel-layout',
    [
      'viewportWidth',
      'viewportHeight',
      'iframeWidth',
      'iframeHeight',
      'widgetCardCount',
      'appDrawerCount',
      'managementToolbarNavCountCapped',
      'createEventButtonCountCapped',
    ],
  ],
  ['g6-browser-egress', ['count']],
  [
    'g6-resource-cleanup',
    [
      'count',
      'plannedCount',
      'confirmedCreatedCount',
      'conflictCount',
      'notCreatedCount',
      'createUnresolvedCount',
      'deletedCount',
      'alreadyAbsentCount',
      'cleanupUnresolvedCount',
    ],
  ],
]);
const G6_EXTRA_NUMERIC_FIELDS = new Set(
  [...G6_NUMERIC_FIELDS_BY_PHASE.values()]
    .flat()
    .filter((key) => key !== 'httpStatus' && key !== 'count'),
);
const G6_ENUM_FIELDS_BY_PHASE = new Map([
  [
    'g6-unsupported-preservation',
    ['neighborPatchTitleOutcome', 'neighborCanonicalTitleReadbackOutcome'],
  ],
  [
    'g6-side-panel-layout',
    [
      'managementToolbarNavVisibility',
      'createEventButtonVisibility',
      'createEventButtonEnabled',
    ],
  ],
]);
const G6_POSTSAVE_ENUM_FIELDS = new Set([
  'neighborListRefreshOutcome',
  'neighborListUiObservation',
]);
const G6_POSTSAVE_BOOLEAN_FIELDS = new Set([
  'neighborListRefreshEventCountOverflow',
  'neighborListRefreshEditedTitleMatches',
  'neighborListLoadingVisible',
  'neighborListErrorVisible',
  'neighborListEditedRowVisible',
  'neighborEditedRowCountOverflow',
]);
const G6_POSTSAVE_DIAGNOSTIC_FIELDS = new Set([
  ...G6_POSTSAVE_ENUM_FIELDS,
  ...G6_POSTSAVE_BOOLEAN_FIELDS,
  'neighborListRefreshHttpStatus',
  'neighborListRefreshEventCountCapped',
  'neighborEditedRowCountCapped',
]);
const G6_POSTSAVE_ENUM_VALUES = new Map([
  [
    'neighborListRefreshOutcome',
    new Set([
      'not-observed',
      'decoding',
      'unexpected-status',
      'decode-error',
      'invalid-response',
      'decoded',
      'decoded-overflow',
    ]),
  ],
  ['neighborListUiObservation', new Set(['observed', 'unavailable'])],
]);
const G6_POSTSAVE_FIELDS_BY_PHASE = new Map([
  ['g6-unsupported-preservation', G6_POSTSAVE_DIAGNOSTIC_FIELDS],
]);
const G6_EXTRA_ENUM_FIELDS = new Set(
  [...G6_ENUM_FIELDS_BY_PHASE.values()].flat(),
);
for (const key of G6_POSTSAVE_ENUM_FIELDS) {
  G6_EXTRA_ENUM_FIELDS.add(key);
}
const G6_EXTRA_BOOLEAN_FIELDS = new Set([...G6_POSTSAVE_BOOLEAN_FIELDS]);
const G6_ENUM_VALUES = new Map([
  [
    'neighborPatchTitleOutcome',
    new Set(['matched', 'mismatched', 'unavailable']),
  ],
  [
    'neighborCanonicalTitleReadbackOutcome',
    new Set([
      'not-needed',
      'not-owned',
      'matched',
      'mismatched',
      'unavailable',
    ]),
  ],
  [
    'managementToolbarNavVisibility',
    new Set(['absent', 'visible', 'hidden', 'ambiguous', 'unavailable']),
  ],
  [
    'createEventButtonVisibility',
    new Set(['absent', 'visible', 'hidden', 'ambiguous', 'unavailable']),
  ],
  [
    'createEventButtonEnabled',
    new Set(['absent', 'enabled', 'disabled', 'ambiguous', 'unavailable']),
  ],
]);

function validG6SidePanelToolbarObservation(record) {
  const requiredFields = [
    'managementToolbarNavCountCapped',
    'managementToolbarNavVisibility',
    'createEventButtonCountCapped',
    'createEventButtonVisibility',
    'createEventButtonEnabled',
  ];
  if (!requiredFields.every((key) => Object.hasOwn(record, key))) {
    return false;
  }

  const navCount = record.managementToolbarNavCountCapped;
  const createCount = record.createEventButtonCountCapped;
  if (navCount === null || createCount === null) {
    return (
      navCount === null &&
      createCount === null &&
      record.managementToolbarNavVisibility === 'unavailable' &&
      record.createEventButtonVisibility === 'unavailable' &&
      record.createEventButtonEnabled === 'unavailable'
    );
  }

  const validCappedCount = (value) =>
    Number.isInteger(value) && value >= 0 && value <= 2;
  const validVisibility = (count, value) =>
    (count === 0 && value === 'absent') ||
    (count === 1 && ['visible', 'hidden', 'unavailable'].includes(value)) ||
    (count === 2 && value === 'ambiguous');
  const validEnabled = (count, value) =>
    (count === 0 && value === 'absent') ||
    (count === 1 && ['enabled', 'disabled', 'unavailable'].includes(value)) ||
    (count === 2 && value === 'ambiguous');

  return (
    validCappedCount(navCount) &&
    validCappedCount(createCount) &&
    validVisibility(navCount, record.managementToolbarNavVisibility) &&
    validVisibility(createCount, record.createEventButtonVisibility) &&
    validEnabled(createCount, record.createEventButtonEnabled)
  );
}

const G6_SEED_CREATE_OUTCOMES = new Set([
  'response',
  'timeout',
  'aborted',
  'network-error',
  'other-error',
  'not-sent',
]);
const REMINDER_DELIVERY_PHASES = new Set([
  'reminder-delivery-snapshot',
  'reminder-restart-delivery-row',
  'restore-delivery-row',
]);
const REMINDER_TIMELINE_COUNTS = new Map([
  ['reminder-initial-delivery', 1],
  ['reminder-restart-prior-state', 1],
  ['reminder-restart-scheduler-scan', 2],
  ['reminder-restart-no-duplicate', 2],
  ['reminder-restore-prior-state', 2],
  ['reminder-restore-scheduler-scan', 3],
  ['reminder-restore-no-duplicate', 3],
]);
const PRIVATE_CHECKSUM_PHASES = new Set([
  'restore-radicale-backup',
  'restore-postgres-backup',
]);
const RESTORE_TARGET_STEPS = new Set([
  'target-volume-check',
  'target-database-check',
  'target-plan-check',
  'volume-create',
  'volume-empty-check',
  'database-create',
  'archive-extract',
  'restored-volume-count',
  'postgres-restore',
  'complete',
]);
const RESTORE_TARGET_DIAGNOSTIC_FIELDS = [
  'restoreStep',
  'restoreVolumeExists',
  'restoreDatabaseExists',
  'restoreTargetPlanSafe',
  'restoreVolumeCreated',
  'restoreVolumeEmpty',
  'restoreDatabaseCreated',
  'restoreArchiveExtracted',
  'restoreArchiveEntryCount',
  'restoreArchiveCountProbeValid',
  'restorePostgresRestored',
];
const PINNED_WIDGET_CONTROL_PHASES = new Set([
  'widget-a-room-info-button',
  'widget-a-extensions-menuitem',
  'widget-a-extension-row',
]);
const PINNED_WIDGET_PANEL_PHASES = new Set([
  'widget-a-extensions-menuitem',
  'widget-a-extension-row',
]);
const STATUSES = new Set(['started', 'passed', 'failed', 'unavailable']);
const SUMMARY_FAILURE_CATEGORIES = new Set([
  'invalid-source-sha',
  'invalid-stage-json',
  'invalid-stage-record',
  'summary-unavailable',
]);
const BLOCKED_REQUEST_ACTORS = new Set(['member-a', 'member-b', 'outsider']);
const BLOCKED_REQUEST_CLASSES = new Set([
  'fixture-host-origin-mismatch',
  'matrix-client-well-known-discovery',
  'matrix-server-well-known-discovery',
  'non-http-scheme',
  'invalid-url',
  'unapproved-loopback-origin',
  'external-http-origin',
]);
const BLOCKED_REQUEST_RESOURCE_TYPES = new Set([
  'document',
  'stylesheet',
  'image',
  'media',
  'font',
  'script',
  'texttrack',
  'xhr',
  'fetch',
  'eventsource',
  'websocket',
  'manifest',
  'other',
]);
const FAILURE_CODES = new Set([
  'docker-command-failed',
  'docker-process-spawn-failed',
  'invalid-login-response',
  'invalid-project-name',
  'matrix-http-failed',
  'matrix-invalid-json',
  'matrix-transport-failed',
  'gateway-listener-port-conflict',
  'gateway-matrix-unauthorized',
  'gateway-matrix-connect-failed',
  'gateway-module-load-failed',
  'gateway-config-validation-failed',
  'gateway-out-of-memory',
  'gateway-startup-unknown',
  'element-room-navigation-failed',
  'element-room-observation-unavailable',
  'element-room-session-mismatch',
  'element-room-not-known',
  'element-room-not-joined',
  'element-room-route-mismatch',
  'element-room-heading-not-present',
  'element-room-name-mismatch',
  'element-room-heading-wait-timeout',
]);
const CONTAINER_STATES = new Set([
  'created',
  'restarting',
  'running',
  'removing',
  'paused',
  'exited',
  'dead',
  'unavailable',
]);
const CONTAINER_HEALTH_STATES = new Set([
  'starting',
  'healthy',
  'unhealthy',
  'none',
  'unavailable',
]);
const RESTORE_RADICALE_PROBE_OUTCOMES = new Set(['no-response', 'http-status']);
const RESTORE_RADICALE_CONTAINER_HTTP_OUTCOMES = new Set([
  'unavailable',
  'no-response',
  'http-status',
]);
const RESTORE_RADICALE_PUBLISHED_PORT_BINDINGS = new Set([
  'unavailable',
  'other',
  'loopback-5233',
]);
const RESTORE_RADICALE_FILESYSTEM_FIELDS = [
  'restoreRadicaleSourceProbeAvailable',
  'restoreRadicaleFilesystemProbeAvailable',
  'restoreRadicalePythonVersion',
  'restoreRadicalePythonVersionMatchesSource',
  'restoreRadicaleRuntimeMatchesAccount',
  'restoreRadicaleDataUidMatchesSource',
  'restoreRadicaleDataGidMatchesSource',
  'restoreRadicaleDataModeMatchesSource',
  'restoreRadicaleCollectionsUidMatchesSource',
  'restoreRadicaleCollectionsGidMatchesSource',
  'restoreRadicaleCollectionsModeMatchesSource',
  'restoreRadicaleDataRootReadable',
  'restoreRadicaleDataRootSearchable',
  'restoreRadicaleCollectionsRootReadable',
  'restoreRadicaleCollectionsRootSearchable',
  'restoreRadicaleCollectionTreeComplete',
  'restoreRadicaleCollectionEntryCount',
  'restoreRadicaleCollectionReadSearchFailureCount',
];
const RESTORE_RADICALE_FILESYSTEM_BOOLEAN_FIELDS = [
  'restoreRadicaleSourceProbeAvailable',
  'restoreRadicaleFilesystemProbeAvailable',
  'restoreRadicalePythonVersionMatchesSource',
  'restoreRadicaleRuntimeMatchesAccount',
  'restoreRadicaleDataUidMatchesSource',
  'restoreRadicaleDataGidMatchesSource',
  'restoreRadicaleDataModeMatchesSource',
  'restoreRadicaleCollectionsUidMatchesSource',
  'restoreRadicaleCollectionsGidMatchesSource',
  'restoreRadicaleCollectionsModeMatchesSource',
  'restoreRadicaleDataRootReadable',
  'restoreRadicaleDataRootSearchable',
  'restoreRadicaleCollectionsRootReadable',
  'restoreRadicaleCollectionsRootSearchable',
  'restoreRadicaleCollectionTreeComplete',
];
const RESTORE_RADICALE_STARTUP_EXCEPTION_CLASSES = new Set([
  'unavailable',
  'none',
  'permission-error',
  'missing-path-error',
  'module-not-found',
  'import-error',
  'os-error',
  'other',
]);
const RESTORE_RADICALE_STARTUP_ERRNOS = new Set([
  'unavailable',
  'none',
  'eacces',
  'erofs',
  'enoent',
  'other',
]);
const RESTORE_RADICALE_STARTUP_PATH_BUCKETS = new Set([
  'unavailable',
  'none',
  'collections',
  'data-root',
  'config',
  'plugin',
  'other-path',
]);
const RESTORE_RADICALE_STARTUP_SIGNATURES = new Set([
  'unavailable',
  'unclassified',
  'plugin-config-invalid',
  'invalid-configuration',
  'module-import-failed',
  'filesystem-permission',
  'filesystem-readonly',
  'filesystem-missing-path',
  'no-listener',
  'bind-failed',
  'address-resolution-failed',
  'startup-exception',
]);
const MATRIX_SYNC_STATES = new Set([
  'ERROR',
  'PREPARED',
  'RECONNECTING',
  'STOPPED',
  'SYNCING',
  'CATCHUP',
  'UNKNOWN',
]);
const VERSION_FIELDS = new Set([
  'elementWebConfiguredTag',
  'synapseConfiguredTag',
  'radicaleConfiguredTag',
  'chromiumVersion',
  'runnerOS',
  'runnerOSVersion',
  'runnerArchitecture',
  'nodeVersion',
]);
const GATEWAY_ENDPOINTS = new Set([
  'context',
  'calendars',
  'events',
  'other-calendar',
  'other-api',
  'none',
]);
const GATEWAY_METHODS = new Set([
  'GET',
  'POST',
  'PATCH',
  'PUT',
  'DELETE',
  'OPTIONS',
  'HEAD',
  'OTHER',
  'NONE',
]);
const WIDGET_READY_STATES = new Set([
  'loading',
  'interactive',
  'complete',
  'unavailable',
]);
const WIDGET_PAGE_ERROR_CLASSES = new Set([
  'Error',
  'TypeError',
  'ReferenceError',
  'SyntaxError',
  'RangeError',
  'URIError',
  'EvalError',
  'AggregateError',
  'OTHER',
  'NONE',
]);
const OPENID_PROTOCOL_STATES = new Set([
  'none',
  'allowed',
  'request',
  'blocked',
  'other',
]);
const RUNTIME_OBSERVATION_FIELDS = [
  'gatewayContextRequestCount',
  'gatewayCalendarsRequestCount',
  'gatewayEventsRequestCount',
  'gatewayOtherCalendarRequestCount',
  'gatewayOtherApiRequestCount',
  'gatewayOptionsRequestCount',
  'gatewayFailedRequestCount',
  'gatewayLastRequestEndpoint',
  'gatewayLastRequestMethod',
  'gatewayLastResponseEndpoint',
  'gatewayLastResponseMethod',
  'iframeObservationAvailable',
  'iframeGatewayBaseOriginMatches',
  'iframeRoomIdMatches',
  'createEventVisible',
  'identityContinueVisible',
  'widgetDocumentRequestCount',
  'widgetScriptRequestCount',
  'widgetStylesheetRequestCount',
  'widgetDocumentFailureCount',
  'widgetScriptFailureCount',
  'widgetStylesheetFailureCount',
  'openIdRequestCount',
  'openIdOptionsRequestCount',
  'openIdFailedRequestCount',
  'openIdLastRequestMethod',
  'widgetPageErrorCount',
  'widgetLastPageErrorClass',
  'widgetFrameAvailable',
  'widgetDocumentReadyState',
  'widgetRootHasChildren',
  'widgetLoadingVisible',
  'widgetMissingCapabilitiesVisible',
  'widgetRegistrationErrorVisible',
  'widgetOutsideClientVisible',
  'widgetChildErrorVisible',
  'widgetApiParentObserverAvailable',
  'widgetApiGetOpenIdRequestCount',
  'widgetApiRequestSourceMatches',
  'widgetApiRequestOriginMatches',
  'widgetApiRequestWidgetIdMatches',
  'widgetApiInitialResponseCount',
  'widgetApiInitialResponseState',
  'widgetApiInitialResponseSourceMatches',
  'widgetApiInitialResponseOriginMatches',
  'widgetApiInitialResponseWidgetIdMatches',
  'widgetApiFollowupCount',
  'widgetApiFollowupState',
  'widgetApiFollowupRequestIdMatches',
  'widgetApiFollowupSourceMatches',
  'widgetApiFollowupOriginMatches',
  'widgetApiFollowupWidgetIdMatches',
  'widgetParametersObserved',
  'widgetGatewayBaseOriginMatches',
  'widgetRoomIdMatches',
  'widgetIdParameterPresent',
  'calendarEventsLoadingVisible',
  'calendarEventsLoadErrorVisible',
  'createEventEnabled',
];
const OPTIONAL_RUNTIME_STATUS_FIELDS = [
  'gatewayLastResponseStatus',
  'widgetDocumentLastStatus',
  'widgetScriptLastStatus',
  'widgetStylesheetLastStatus',
  'openIdLastResponseStatus',
];
const POST_CREATE_VISIBILITY_FIELDS = [
  'postCreateEventGetRequestCount',
  'roomTargetRangeRequestCount',
  'expectedRoomRangeRequestSeen',
  'roomTargetRangeResponseCount',
  'roomTargetRangeLastStatus',
  'createResponseHasEvent',
  'createResponseTitleMatches',
  'createResponseCalendarMatches',
  'createResponseTimingComparable',
  'createResponseEventIntersectsRoomRange',
  'caldavReportProbeCompleted',
  'caldavOpenIdHttpStatus',
  'caldavReportHttpStatus',
  'caldavReportContainsCreatedEvent',
  'caldavProjection',
  'roomListResponseHasEventsArray',
  'roomListResponseEventCount',
  'roomListDiagnostics',
  'roomListResponseTitleMatches',
  'roomListResponseIdMatches',
  'roomListResponseCalendarMatches',
  'listViewHeadingPresent',
  'matchingListItemCount',
];
const POST_CREATE_VISIBILITY_COUNTER_FIELDS = [
  'postCreateEventGetRequestCount',
  'roomTargetRangeRequestCount',
  'roomTargetRangeResponseCount',
  'roomListResponseEventCount',
  'matchingListItemCount',
];
const REMINDER_CONFIGURATION_STEPS = new Set([
  'event-details',
  'notify-control',
  'options-load',
  'eligible-option',
  'put-response',
  'complete',
]);
const REMINDER_CONFIGURATION_FIELDS = [
  'reminderStep',
  'notifyButtonCount',
  'notifyButtonVisible',
  'reminderOptionsGetCount',
  'reminderOptionsGetStatus',
  'reminderConfigGetCount',
  'reminderConfigGetStatus',
  'reminderEligibleOptionCount',
  'reminderOptionCheckedBefore',
  'reminderOptionCheckAttempted',
  'reminderPutCount',
  'reminderPutStatus',
  'reminderOptionCheckedAfter',
];
const REMINDER_CONFIGURATION_COUNTER_FIELDS = [
  'notifyButtonCount',
  'reminderOptionsGetCount',
  'reminderConfigGetCount',
  'reminderEligibleOptionCount',
  'reminderPutCount',
];
const REMINDER_CONFIGURATION_STATUS_FIELDS = [
  'reminderOptionsGetStatus',
  'reminderConfigGetStatus',
  'reminderPutStatus',
];
const RUNTIME_COUNTER_FIELDS = [
  'gatewayContextRequestCount',
  'gatewayCalendarsRequestCount',
  'gatewayEventsRequestCount',
  'gatewayOtherCalendarRequestCount',
  'gatewayOtherApiRequestCount',
  'gatewayOptionsRequestCount',
  'gatewayFailedRequestCount',
  'widgetDocumentRequestCount',
  'widgetScriptRequestCount',
  'widgetStylesheetRequestCount',
  'widgetDocumentFailureCount',
  'widgetScriptFailureCount',
  'widgetStylesheetFailureCount',
  'openIdRequestCount',
  'openIdOptionsRequestCount',
  'openIdFailedRequestCount',
  'widgetApiGetOpenIdRequestCount',
  'widgetApiInitialResponseCount',
  'widgetApiFollowupCount',
  'widgetPageErrorCount',
];
const ALLOWED_KEYS = new Set([
  'phase',
  'status',
  'httpStatus',
  'count',
  'originMatchesElement',
  'teamRoomMatches',
  'blockedRequestDiagnostics',
  'blockedRequestDiagnosticOverflow',
  'controlVisible',
  'panelPresent',
  'matrixClientHookPresent',
  'matrixClientPresent',
  'matrixUserMatches',
  'matrixSyncState',
  'matrixRoomKnown',
  'matrixRoomJoined',
  'roomNavigationCompleted',
  'roomHeadingReady',
  'roomHeadingPresent',
  'roomNameMatches',
  'roomIdMatches',
  ...REMINDER_ROOM_LAYOUT_FIELDS,
  ...REMINDER_ROOM_CONTEXT_RESPONSE_FIELDS,
  'blockedExternalRequestCount',
  'homeserverHttpErrorCount',
  'homeserverLastHttpErrorStatus',
  'failureCode',
  'missingModuleKind',
  'missingDependency',
  'processExitCode',
  'serviceUserJoined',
  'powerPolicyVerified',
  'rolePolicyVerified',
  'deliveryStateSent',
  'deliveryClaimClear',
  'deliveryKeyUnchanged',
  'attemptCountUnchanged',
  'relativeAlarmReadback',
  'reminderEnabled',
  'canaryDelivered',
  'roomMentioned',
  'deliveredAfterDue',
  'allMarkersOnce',
  'attemptCount',
  'checksum',
  'gatewayStoppedGracefully',
  'radicaleStoppedGracefully',
  'oomFree',
  'freshVolume',
  'freshDatabase',
  ...RESTORE_TARGET_DIAGNOSTIC_FIELDS,
  'containerState',
  'containerHealth',
  'containerExitCode',
  'containerOomKilled',
  'containerRuntimeErrorPresent',
  'restoreRadicaleProbeOutcome',
  'restoreRadicaleContainerHttpOutcome',
  'restoreRadicaleContainerHttpStatus',
  'restoreRadicalePublishedPortBinding',
  'restoreRadicaleStartupSignature',
  'restoreRadicaleLogsAvailable',
  'restoreRadicaleStartupExceptionPresent',
  'restoreRadicaleReadyMarkerPresent',
  ...RESTORE_RADICALE_FILESYSTEM_FIELDS,
  'restoreRadicaleStartupExceptionClass',
  'restoreRadicaleStartupErrno',
  'restoreRadicaleStartupPathBucket',
  ...RUNTIME_OBSERVATION_FIELDS,
  ...OPTIONAL_RUNTIME_STATUS_FIELDS,
  ...POST_CREATE_VISIBILITY_FIELDS,
  'canManageReminders',
  ...REMINDER_CONFIGURATION_FIELDS,
  ...VERSION_FIELDS,
  'openIdProofValid',
  'allResourcesSeeded',
  'seedCreateObservations',
  'unsupportedWarningVisible',
  'unsupportedRowOmitted',
  'supportedNeighborVisible',
  'canonicalSnapshotAvailable',
  'neighborEditedRowVisible',
  'supportedNeighborEdited',
  'canonicalUnsupportedObjectUnchanged',
  'neighborOwnershipUpdated',
  'neighborUpdateIdentityMatches',
  ...G6_EXTRA_ENUM_FIELDS,
  ...G6_POSTSAVE_DIAGNOSTIC_FIELDS,
  'deleteButtonVisible',
  'deleteConfirmationVisible',
  'deletedRowAbsent',
  'canonicalObjectAbsent',
  'memberBDeleteRowVisible',
  'memberBDeleteRowAbsent',
  'keyboardEventFocused',
  'detailsOpened',
  'editActionFocused',
  'deleteActionFocused',
  'closeActionFocused',
  'escapeClosedDialog',
  'focusReturnedToEvent',
  'widgetCardVisible',
  'createControlReachable',
  'eventDetailsReachable',
  'hostNoHorizontalOverflow',
  'widgetNoHorizontalOverflow',
  'persistedHostFramePresent',
  'browserEgressClear',
  'allOwnedResourcesRemoved',
  ...G6_EXTRA_NUMERIC_FIELDS,
]);

function validG6Observation(record) {
  if (!G6_PHASES.has(record.phase)) return true;

  const booleanFields = PHASE_BOOLEAN_FIELDS.get(record.phase) ?? [];
  const numericFields = G6_NUMERIC_FIELDS_BY_PHASE.get(record.phase) ?? [];
  const enumFields = G6_ENUM_FIELDS_BY_PHASE.get(record.phase) ?? [];
  const postSaveFields =
    G6_POSTSAVE_FIELDS_BY_PHASE.get(record.phase) ?? new Set();
  const postSaveBooleanFields = [...G6_POSTSAVE_BOOLEAN_FIELDS].filter((key) =>
    postSaveFields.has(key),
  );
  const allowedFields = new Set([
    'phase',
    'status',
    ...booleanFields,
    ...numericFields,
    ...enumFields,
    ...postSaveFields,
    ...(record.phase === 'g6-fixture-ready' ? ['seedCreateObservations'] : []),
  ]);
  if (
    Object.keys(record).some((key) => !allowedFields.has(key)) ||
    booleanFields.some(
      (key) => Object.hasOwn(record, key) && typeof record[key] !== 'boolean',
    ) ||
    postSaveBooleanFields.some(
      (key) => Object.hasOwn(record, key) && typeof record[key] !== 'boolean',
    ) ||
    numericFields.some((key) => {
      if (!Object.hasOwn(record, key)) return false;
      const value = record[key];
      if (key === 'neighborListRefreshHttpStatus' && value === null) {
        return false;
      }
      if (
        (key === 'managementToolbarNavCountCapped' ||
          key === 'createEventButtonCountCapped') &&
        value === null
      ) {
        return false;
      }
      if (!Number.isInteger(value)) return true;
      if (key === 'httpStatus' || key.endsWith('HttpStatus')) {
        return value < 100 || value > 599;
      }
      if (key === 'neighborListRefreshEventCountCapped') {
        return value < 0 || value > 100;
      }
      if (key === 'neighborEditedRowCountCapped') {
        return value < 0 || value > 2;
      }
      if (key.endsWith('Width') || key.endsWith('Height')) {
        return value < 1 || value > 10_000;
      }
      if (record.phase === 'g6-side-panel-layout') {
        return value < 0 || value > 2;
      }
      if (key === 'eventActionTabCount') return value < 0 || value > 80;
      if (key === 'detailsActionTabCount') return value < 0 || value > 14;
      if (record.phase === 'g6-resource-cleanup') return value < 0 || value > 4;
      return value < 0 || value > 100_000;
    }) ||
    enumFields.some(
      (key) =>
        Object.hasOwn(record, key) &&
        !G6_ENUM_VALUES.get(key)?.has(record[key]),
    ) ||
    [...G6_POSTSAVE_ENUM_VALUES].some(
      ([key, values]) => Object.hasOwn(record, key) && !values.has(record[key]),
    )
  ) {
    return false;
  }

  const hasPostSaveDiagnostics = [...postSaveFields].some((key) =>
    Object.hasOwn(record, key),
  );
  if (hasPostSaveDiagnostics) {
    const responseOutcome = record.neighborListRefreshOutcome;
    const responseStatus = record.neighborListRefreshHttpStatus;
    const hasResultCount = Object.hasOwn(
      record,
      'neighborListRefreshEventCountCapped',
    );
    const hasResultOverflow = Object.hasOwn(
      record,
      'neighborListRefreshEventCountOverflow',
    );
    const hasTitleMatch = Object.hasOwn(
      record,
      'neighborListRefreshEditedTitleMatches',
    );
    const hasResultSummary =
      hasResultCount || hasResultOverflow || hasTitleMatch;
    const responseShapeIsValid = (() => {
      switch (responseOutcome) {
        case 'not-observed':
          return responseStatus === null && !hasResultSummary;
        case 'decoding':
        case 'decode-error':
        case 'invalid-response':
          return responseStatus === 200 && !hasResultSummary;
        case 'unexpected-status':
          return (
            Number.isInteger(responseStatus) &&
            responseStatus !== 200 &&
            !hasResultSummary
          );
        case 'decoded':
          return (
            responseStatus === 200 &&
            Number.isInteger(record.neighborListRefreshEventCountCapped) &&
            record.neighborListRefreshEventCountCapped >= 0 &&
            record.neighborListRefreshEventCountCapped <= 100 &&
            record.neighborListRefreshEventCountOverflow === false &&
            typeof record.neighborListRefreshEditedTitleMatches === 'boolean'
          );
        case 'decoded-overflow':
          return (
            responseStatus === 200 &&
            record.neighborListRefreshEventCountCapped === 100 &&
            record.neighborListRefreshEventCountOverflow === true &&
            !hasTitleMatch
          );
        default:
          return false;
      }
    })();
    const uiObservation = record.neighborListUiObservation;
    const uiFields = [
      'neighborListLoadingVisible',
      'neighborListErrorVisible',
      'neighborListEditedRowVisible',
      'neighborEditedRowCountCapped',
      'neighborEditedRowCountOverflow',
    ];
    const hasEveryUiField = uiFields.every((key) => Object.hasOwn(record, key));
    const hasAnyUiField = uiFields.some((key) => Object.hasOwn(record, key));
    const uiShapeIsValid =
      (uiObservation === 'observed' &&
        hasEveryUiField &&
        record.neighborEditedRowCountCapped >= 0 &&
        record.neighborEditedRowCountCapped <= 2 &&
        (record.neighborEditedRowCountOverflow === false ||
          record.neighborEditedRowCountCapped === 2) &&
        (record.neighborListEditedRowVisible !== true ||
          record.neighborEditedRowCountCapped > 0 ||
          record.neighborEditedRowCountOverflow) &&
        (record.neighborEditedRowCountCapped !== 0 ||
          record.neighborEditedRowCountOverflow ||
          record.neighborListEditedRowVisible === false)) ||
      (uiObservation === 'unavailable' &&
        Object.hasOwn(record, 'neighborEditedRowVisible') &&
        !hasAnyUiField);
    if (
      !Object.hasOwn(record, 'neighborListRefreshOutcome') ||
      !Object.hasOwn(record, 'neighborListRefreshHttpStatus') ||
      !Object.hasOwn(record, 'neighborListUiObservation') ||
      !responseShapeIsValid ||
      !uiShapeIsValid
    ) {
      return false;
    }
  }

  if (record.phase === 'g6-unsupported-preservation' && enumFields.length > 0) {
    const hasAnyEnumField = enumFields.some((key) =>
      Object.hasOwn(record, key),
    );
    const hasEveryEnumField = enumFields.every((key) =>
      Object.hasOwn(record, key),
    );
    if (
      (record.status === 'passed' && !hasEveryEnumField) ||
      (hasAnyEnumField && !hasEveryEnumField)
    ) {
      return false;
    }
    if (hasEveryEnumField) {
      const patchOutcome = record.neighborPatchTitleOutcome;
      const canonicalOutcome = record.neighborCanonicalTitleReadbackOutcome;
      const canonicalStatusPresent = Object.hasOwn(
        record,
        'neighborCanonicalTitleReadbackHttpStatus',
      );
      if (
        (patchOutcome !== 'unavailable' &&
          !Object.hasOwn(record, 'neighborPatchHttpStatus')) ||
        (canonicalOutcome === 'not-needed' &&
          record.neighborEditedRowVisible !== true) ||
        (canonicalOutcome !== 'not-needed' &&
          record.neighborEditedRowVisible !== false) ||
        (record.supportedNeighborEdited === true &&
          (canonicalOutcome !== 'not-needed' ||
            record.neighborEditedRowVisible !== true)) ||
        ((canonicalOutcome === 'matched' ||
          canonicalOutcome === 'mismatched') &&
          record.neighborCanonicalTitleReadbackHttpStatus !== 200) ||
        ((canonicalOutcome === 'not-needed' ||
          canonicalOutcome === 'not-owned') &&
          canonicalStatusPresent)
      ) {
        return false;
      }
    }
  }

  if (Object.hasOwn(record, 'seedCreateObservations')) {
    const observations = record.seedCreateObservations;
    if (
      record.phase !== 'g6-fixture-ready' ||
      !Array.isArray(observations) ||
      observations.length !== 4 ||
      observations.some((observation) => {
        if (
          observation === null ||
          typeof observation !== 'object' ||
          Array.isArray(observation) ||
          Object.keys(observation).length !== 4 ||
          !Object.hasOwn(observation, 'outcome') ||
          !Object.hasOwn(observation, 'status') ||
          !Object.hasOwn(observation, 'etagPresent') ||
          !Object.hasOwn(observation, 'etagStrong') ||
          !G6_SEED_CREATE_OUTCOMES.has(observation.outcome)
        ) {
          return true;
        }
        if (observation.outcome === 'response') {
          return (
            !Number.isInteger(observation.status) ||
            observation.status < 100 ||
            observation.status > 599 ||
            typeof observation.etagPresent !== 'boolean' ||
            typeof observation.etagStrong !== 'boolean' ||
            (observation.etagStrong && !observation.etagPresent)
          );
        }
        return (
          observation.status !== null ||
          observation.etagPresent !== null ||
          observation.etagStrong !== null
        );
      })
    ) {
      return false;
    }
  }

  if (
    record.phase === 'g6-side-panel-layout' &&
    ((record.widgetCardVisible === true && record.widgetCardCount !== 1) ||
      (record.persistedHostFramePresent === true &&
        (!Number.isInteger(record.iframeWidth) ||
          !Number.isInteger(record.iframeHeight))) ||
      !validG6SidePanelToolbarObservation(record))
  ) {
    return false;
  }

  if (record.phase === 'g6-resource-cleanup') {
    const cleanupCounts = [
      'count',
      'plannedCount',
      'confirmedCreatedCount',
      'conflictCount',
      'notCreatedCount',
      'createUnresolvedCount',
      'deletedCount',
      'alreadyAbsentCount',
      'cleanupUnresolvedCount',
    ];
    if (cleanupCounts.some((key) => !Number.isInteger(record[key]))) {
      return false;
    }
    if (
      record.plannedCount !==
        record.confirmedCreatedCount +
          record.conflictCount +
          record.notCreatedCount +
          record.createUnresolvedCount ||
      record.confirmedCreatedCount !==
        record.deletedCount +
          record.alreadyAbsentCount +
          record.cleanupUnresolvedCount ||
      record.count !== record.deletedCount + record.alreadyAbsentCount ||
      record.allOwnedResourcesRemoved !==
        (record.createUnresolvedCount === 0 &&
          record.cleanupUnresolvedCount === 0)
    ) {
      return false;
    }
  }

  if (record.status !== 'passed') return true;
  switch (record.phase) {
    case 'g6-fixture-ready':
      return (
        record.httpStatus === 200 &&
        record.openIdProofValid === true &&
        record.count === 4 &&
        Array.isArray(record.seedCreateObservations) &&
        record.seedCreateObservations.length === 4 &&
        record.seedCreateObservations.every(
          (observation) =>
            observation.outcome === 'response' &&
            observation.status >= 200 &&
            observation.status < 300 &&
            observation.etagPresent === true &&
            observation.etagStrong === true,
        )
      );
    case 'g6-unsupported-preservation':
      return (
        record.projectionHttpStatus === 200 &&
        record.canonicalBeforeHttpStatus === 200 &&
        Number.isInteger(record.neighborPatchHttpStatus) &&
        record.neighborPatchHttpStatus >= 200 &&
        record.neighborPatchHttpStatus < 300 &&
        record.canonicalAfterHttpStatus === 200 &&
        record.count === 1 &&
        record.neighborOwnershipUpdated === true &&
        record.neighborUpdateIdentityMatches === true
      );
    case 'g6-delete-and-refresh':
      return (
        record.memberBEventsHttpStatus === 200 &&
        Number.isInteger(record.deleteHttpStatus) &&
        record.deleteHttpStatus >= 200 &&
        record.deleteHttpStatus < 300 &&
        record.canonicalDeleteHttpStatus === 404 &&
        record.memberBReloadHttpStatus === 200 &&
        record.count === 1
      );
    case 'g6-keyboard-focus':
      return (
        record.count === record.eventActionTabCount &&
        record.eventActionTabCount <= 80 &&
        record.detailsActionTabCount <= 14
      );
    case 'g6-side-panel-layout':
      return (
        record.viewportWidth === 1440 &&
        record.viewportHeight === 900 &&
        record.widgetCardCount === 1 &&
        record.widgetCardVisible === true &&
        record.persistedHostFramePresent === true &&
        Number.isInteger(record.iframeWidth) &&
        record.iframeWidth > 0 &&
        Number.isInteger(record.iframeHeight) &&
        record.iframeHeight > 0 &&
        record.createControlReachable === true &&
        record.eventDetailsReachable === true &&
        record.hostNoHorizontalOverflow === true &&
        record.widgetNoHorizontalOverflow === true
      );
    case 'g6-browser-egress':
      return record.count === 0;
    case 'g6-resource-cleanup':
      return record.allOwnedResourcesRemoved === true && record.count <= 4;
    default:
      return false;
  }
}

function validRuntimeObservation(record) {
  const expectedKeys = new Set([
    'phase',
    'status',
    ...RUNTIME_OBSERVATION_FIELDS,
    ...OPTIONAL_RUNTIME_STATUS_FIELDS.filter((key) =>
      Object.hasOwn(record, key),
    ),
  ]);
  if (
    Object.keys(record).length !== expectedKeys.size ||
    Object.keys(record).some((key) => !expectedKeys.has(key)) ||
    !['passed', 'unavailable'].includes(record.status) ||
    RUNTIME_COUNTER_FIELDS.some(
      (key) =>
        !Number.isInteger(record[key]) || record[key] < 0 || record[key] > 2,
    ) ||
    !GATEWAY_ENDPOINTS.has(record.gatewayLastRequestEndpoint) ||
    !GATEWAY_METHODS.has(record.gatewayLastRequestMethod) ||
    !GATEWAY_ENDPOINTS.has(record.gatewayLastResponseEndpoint) ||
    !GATEWAY_METHODS.has(record.gatewayLastResponseMethod) ||
    typeof record.iframeObservationAvailable !== 'boolean' ||
    typeof record.iframeGatewayBaseOriginMatches !== 'boolean' ||
    typeof record.iframeRoomIdMatches !== 'boolean' ||
    typeof record.createEventVisible !== 'boolean' ||
    typeof record.identityContinueVisible !== 'boolean' ||
    !OPENID_PROTOCOL_STATES.has(record.widgetApiInitialResponseState) ||
    !OPENID_PROTOCOL_STATES.has(record.widgetApiFollowupState) ||
    !Number.isInteger(record.openIdRequestCount) ||
    !Number.isInteger(record.openIdOptionsRequestCount) ||
    !Number.isInteger(record.openIdFailedRequestCount) ||
    !GATEWAY_METHODS.has(record.openIdLastRequestMethod) ||
    !WIDGET_PAGE_ERROR_CLASSES.has(record.widgetLastPageErrorClass) ||
    !WIDGET_READY_STATES.has(record.widgetDocumentReadyState) ||
    [
      'widgetRootHasChildren',
      'widgetLoadingVisible',
      'widgetMissingCapabilitiesVisible',
      'widgetRegistrationErrorVisible',
      'widgetOutsideClientVisible',
      'widgetChildErrorVisible',
      'widgetFrameAvailable',
      'widgetApiRequestSourceMatches',
      'widgetApiParentObserverAvailable',
      'widgetApiRequestOriginMatches',
      'widgetApiRequestWidgetIdMatches',
      'widgetApiInitialResponseSourceMatches',
      'widgetApiInitialResponseOriginMatches',
      'widgetApiInitialResponseWidgetIdMatches',
      'widgetApiFollowupRequestIdMatches',
      'widgetApiFollowupSourceMatches',
      'widgetApiFollowupOriginMatches',
      'widgetApiFollowupWidgetIdMatches',
      'widgetParametersObserved',
      'widgetGatewayBaseOriginMatches',
      'widgetRoomIdMatches',
      'widgetIdParameterPresent',
      'calendarEventsLoadingVisible',
      'calendarEventsLoadErrorVisible',
      'createEventEnabled',
    ].some((key) => typeof record[key] !== 'boolean') ||
    record.openIdRequestCount > 2 ||
    record.widgetApiGetOpenIdRequestCount > 2 ||
    record.widgetApiInitialResponseCount > 2 ||
    record.widgetApiFollowupCount > 2 ||
    (record.widgetApiGetOpenIdRequestCount === 0 &&
      (record.widgetApiRequestSourceMatches ||
        record.widgetApiRequestOriginMatches ||
        record.widgetApiRequestWidgetIdMatches)) ||
    (!record.widgetApiParentObserverAvailable &&
      (record.widgetApiGetOpenIdRequestCount !== 0 ||
        record.widgetApiRequestSourceMatches ||
        record.widgetApiRequestOriginMatches ||
        record.widgetApiRequestWidgetIdMatches)) ||
    (record.widgetApiInitialResponseCount === 0 &&
      (record.widgetApiInitialResponseState !== 'none' ||
        record.widgetApiInitialResponseSourceMatches ||
        record.widgetApiInitialResponseOriginMatches ||
        record.widgetApiInitialResponseWidgetIdMatches)) ||
    (record.widgetApiInitialResponseCount > 0 &&
      record.widgetApiInitialResponseState === 'none') ||
    (record.widgetApiFollowupCount === 0 &&
      (record.widgetApiFollowupState !== 'none' ||
        record.widgetApiFollowupRequestIdMatches ||
        record.widgetApiFollowupSourceMatches ||
        record.widgetApiFollowupOriginMatches ||
        record.widgetApiFollowupWidgetIdMatches)) ||
    (record.widgetApiFollowupCount > 0 &&
      record.widgetApiFollowupState === 'none') ||
    (!record.widgetParametersObserved &&
      (record.widgetGatewayBaseOriginMatches ||
        record.widgetRoomIdMatches ||
        record.widgetIdParameterPresent)) ||
    record.openIdOptionsRequestCount > record.openIdRequestCount ||
    record.openIdFailedRequestCount > record.openIdRequestCount ||
    (record.openIdRequestCount === 0) !==
      (record.openIdLastRequestMethod === 'NONE') ||
    (record.openIdRequestCount === 0 &&
      Object.hasOwn(record, 'openIdLastResponseStatus')) ||
    (record.widgetPageErrorCount === 0) !==
      (record.widgetLastPageErrorClass === 'NONE') ||
    (record.widgetFrameAvailable
      ? record.widgetDocumentReadyState === 'unavailable'
      : record.widgetDocumentReadyState !== 'unavailable') ||
    (record.status === 'passed' && !record.iframeObservationAvailable) ||
    (record.status === 'unavailable' && record.iframeObservationAvailable) ||
    (!record.iframeObservationAvailable &&
      (record.iframeGatewayBaseOriginMatches || record.iframeRoomIdMatches)) ||
    (record.gatewayLastRequestEndpoint === 'none') !==
      (record.gatewayLastRequestMethod === 'NONE') ||
    (record.gatewayLastResponseEndpoint === 'none') !==
      (record.gatewayLastResponseMethod === 'NONE') ||
    (record.gatewayLastResponseEndpoint === 'none') !==
      !Object.hasOwn(record, 'gatewayLastResponseStatus') ||
    OPTIONAL_RUNTIME_STATUS_FIELDS.some((key) => {
      if (!Object.hasOwn(record, key)) return false;
      const status = record[key];
      if (!Number.isInteger(status) || status < 100 || status > 599)
        return true;
      if (key === 'openIdLastResponseStatus') {
        return record.openIdRequestCount === 0;
      }
      if (key === 'widgetDocumentLastStatus') {
        return record.widgetDocumentRequestCount === 0;
      }
      if (key === 'widgetScriptLastStatus') {
        return record.widgetScriptRequestCount === 0;
      }
      if (key === 'widgetStylesheetLastStatus') {
        return record.widgetStylesheetRequestCount === 0;
      }
      return false;
    }) ||
    ['document', 'script', 'stylesheet'].some((kind) => {
      const suffix = `${kind[0].toUpperCase()}${kind.slice(1)}`;
      return (
        record[`widget${suffix}FailureCount`] >
        record[`widget${suffix}RequestCount`]
      );
    }) ||
    (!record.widgetFrameAvailable &&
      (record.widgetRootHasChildren ||
        record.widgetLoadingVisible ||
        record.widgetMissingCapabilitiesVisible ||
        record.widgetRegistrationErrorVisible ||
        record.widgetOutsideClientVisible ||
        record.widgetChildErrorVisible ||
        record.widgetPageErrorCount !== 0))
  ) {
    return false;
  }

  return true;
}

function validRestoreRadicaleFilesystemEvidence(record) {
  const present = RESTORE_RADICALE_FILESYSTEM_FIELDS.some((key) =>
    Object.hasOwn(record, key),
  );
  if (!present) return true;
  if (
    record.phase !== 'restore-radicale-ready' ||
    !['passed', 'failed'].includes(record.status) ||
    !RESTORE_RADICALE_FILESYSTEM_FIELDS.every((key) =>
      Object.hasOwn(record, key),
    ) ||
    RESTORE_RADICALE_FILESYSTEM_BOOLEAN_FIELDS.some(
      (key) => typeof record[key] !== 'boolean',
    ) ||
    !Number.isInteger(record.restoreRadicaleCollectionEntryCount) ||
    record.restoreRadicaleCollectionEntryCount < 0 ||
    record.restoreRadicaleCollectionEntryCount > 512 ||
    !Number.isInteger(record.restoreRadicaleCollectionReadSearchFailureCount) ||
    record.restoreRadicaleCollectionReadSearchFailureCount < 0 ||
    record.restoreRadicaleCollectionReadSearchFailureCount > 2 ||
    (record.restoreRadicaleFilesystemProbeAvailable
      ? !/^\d+\.\d+\.\d+$/u.test(record.restoreRadicalePythonVersion)
      : record.restoreRadicalePythonVersion !== 'unavailable')
  ) {
    return false;
  }

  const metadataMatches = [
    'restoreRadicalePythonVersionMatchesSource',
    'restoreRadicaleDataUidMatchesSource',
    'restoreRadicaleDataGidMatchesSource',
    'restoreRadicaleDataModeMatchesSource',
    'restoreRadicaleCollectionsUidMatchesSource',
    'restoreRadicaleCollectionsGidMatchesSource',
    'restoreRadicaleCollectionsModeMatchesSource',
  ];
  const targetAccess = [
    'restoreRadicaleRuntimeMatchesAccount',
    'restoreRadicaleDataRootReadable',
    'restoreRadicaleDataRootSearchable',
    'restoreRadicaleCollectionsRootReadable',
    'restoreRadicaleCollectionsRootSearchable',
    'restoreRadicaleCollectionTreeComplete',
  ];

  return (
    ((record.restoreRadicaleSourceProbeAvailable &&
      record.restoreRadicaleFilesystemProbeAvailable) ||
      metadataMatches.every((key) => !record[key])) &&
    (record.restoreRadicaleFilesystemProbeAvailable ||
      (targetAccess.every((key) => !record[key]) &&
        record.restoreRadicaleCollectionEntryCount === 0 &&
        record.restoreRadicaleCollectionReadSearchFailureCount === 0))
  );
}

function validPostCreateVisibilityObservation(record) {
  const expectedKeys = new Set([
    'phase',
    'status',
    ...POST_CREATE_VISIBILITY_FIELDS,
  ]);
  return (
    Object.keys(record).length === expectedKeys.size &&
    Object.keys(record).every((key) => expectedKeys.has(key)) &&
    record.status === 'passed' &&
    POST_CREATE_VISIBILITY_COUNTER_FIELDS.every(
      (key) =>
        Number.isInteger(record[key]) && record[key] >= 0 && record[key] <= 2,
    ) &&
    typeof record.expectedRoomRangeRequestSeen === 'boolean' &&
    (record.roomTargetRangeLastStatus === null ||
      (Number.isInteger(record.roomTargetRangeLastStatus) &&
        record.roomTargetRangeLastStatus >= 100 &&
        record.roomTargetRangeLastStatus <= 599)) &&
    typeof record.createResponseHasEvent === 'boolean' &&
    typeof record.createResponseTitleMatches === 'boolean' &&
    typeof record.createResponseCalendarMatches === 'boolean' &&
    typeof record.createResponseTimingComparable === 'boolean' &&
    typeof record.createResponseEventIntersectsRoomRange === 'boolean' &&
    typeof record.caldavReportProbeCompleted === 'boolean' &&
    (record.caldavOpenIdHttpStatus === null ||
      (Number.isInteger(record.caldavOpenIdHttpStatus) &&
        record.caldavOpenIdHttpStatus >= 100 &&
        record.caldavOpenIdHttpStatus <= 599)) &&
    (record.caldavReportHttpStatus === null ||
      (Number.isInteger(record.caldavReportHttpStatus) &&
        record.caldavReportHttpStatus >= 100 &&
        record.caldavReportHttpStatus <= 599)) &&
    (record.caldavReportContainsCreatedEvent === null ||
      typeof record.caldavReportContainsCreatedEvent === 'boolean') &&
    validCalDavProjectionObservation(record.caldavProjection) &&
    typeof record.roomListResponseHasEventsArray === 'boolean' &&
    Number.isInteger(record.roomListResponseEventCount) &&
    validProjectionDiagnosticSummary(record.roomListDiagnostics) &&
    typeof record.roomListResponseTitleMatches === 'boolean' &&
    typeof record.roomListResponseIdMatches === 'boolean' &&
    typeof record.roomListResponseCalendarMatches === 'boolean' &&
    typeof record.listViewHeadingPresent === 'boolean' &&
    (record.roomTargetRangeResponseCount === 0
      ? record.roomTargetRangeLastStatus === null
      : record.roomTargetRangeLastStatus !== null) &&
    (!record.expectedRoomRangeRequestSeen ||
      record.roomTargetRangeRequestCount > 0) &&
    (record.roomTargetRangeResponseCount === 0 ||
      record.expectedRoomRangeRequestSeen) &&
    (!record.createResponseTitleMatches || record.createResponseHasEvent) &&
    (!record.createResponseCalendarMatches || record.createResponseHasEvent) &&
    (!record.createResponseTimingComparable ||
      (record.createResponseHasEvent && record.expectedRoomRangeRequestSeen)) &&
    (!record.createResponseEventIntersectsRoomRange ||
      record.createResponseTimingComparable) &&
    (record.caldavReportHttpStatus === null ||
      record.caldavOpenIdHttpStatus === 200) &&
    (!record.caldavReportProbeCompleted ||
      (record.caldavOpenIdHttpStatus === 200 &&
        record.caldavReportHttpStatus >= 200 &&
        record.caldavReportHttpStatus < 300)) &&
    record.caldavReportProbeCompleted ===
      (record.caldavReportContainsCreatedEvent !== null) &&
    (!record.caldavReportContainsCreatedEvent ||
      record.caldavReportProbeCompleted) &&
    (!record.roomListResponseHasEventsArray ||
      record.roomTargetRangeResponseCount > 0) &&
    (record.roomListResponseHasEventsArray ||
      record.roomListResponseEventCount === 0) &&
    (record.roomListDiagnostics.complete ||
      Object.values(record.roomListDiagnostics.counts).every(
        (count) => count === 0,
      )) &&
    (!record.roomListResponseTitleMatches ||
      record.roomListResponseHasEventsArray) &&
    (!record.roomListResponseIdMatches ||
      (record.roomListResponseTitleMatches && record.createResponseHasEvent)) &&
    (!record.roomListResponseCalendarMatches ||
      record.roomListResponseTitleMatches) &&
    (record.matchingListItemCount === 0 || record.listViewHeadingPresent)
  );
}

function validReminderConfigurationObservation(record) {
  const expectedKeys = new Set([
    'phase',
    'status',
    ...['httpStatus', 'count'].filter((key) => Object.hasOwn(record, key)),
    'reminderEnabled',
    ...REMINDER_CONFIGURATION_FIELDS,
  ]);
  return (
    Object.keys(record).length === expectedKeys.size &&
    Object.keys(record).every((key) => expectedKeys.has(key)) &&
    (record.status === 'passed' || record.status === 'failed') &&
    typeof record.reminderEnabled === 'boolean' &&
    REMINDER_CONFIGURATION_STEPS.has(record.reminderStep) &&
    REMINDER_CONFIGURATION_COUNTER_FIELDS.every(
      (key) =>
        Number.isInteger(record[key]) && record[key] >= 0 && record[key] <= 2,
    ) &&
    REMINDER_CONFIGURATION_STATUS_FIELDS.every(
      (key) =>
        Number.isInteger(record[key]) &&
        (record[key] === 0 || (record[key] >= 100 && record[key] <= 599)),
    ) &&
    [
      'notifyButtonVisible',
      'reminderOptionCheckedBefore',
      'reminderOptionCheckAttempted',
      'reminderOptionCheckedAfter',
    ].every((key) => typeof record[key] === 'boolean') &&
    (!record.notifyButtonVisible || record.notifyButtonCount === 1) &&
    (record.reminderOptionsGetCount > 0 ||
      record.reminderOptionsGetStatus === 0) &&
    (record.reminderConfigGetCount > 0 ||
      record.reminderConfigGetStatus === 0) &&
    (record.reminderPutCount > 0 || record.reminderPutStatus === 0) &&
    (!record.reminderOptionCheckedBefore ||
      record.reminderEligibleOptionCount === 1) &&
    (!record.reminderOptionCheckAttempted ||
      (record.reminderEligibleOptionCount === 1 &&
        !record.reminderOptionCheckedBefore)) &&
    (!record.reminderOptionCheckedAfter ||
      record.reminderEligibleOptionCount === 1) &&
    (!Object.hasOwn(record, 'count') ||
      (record.status === 'passed' && record.count === 1)) &&
    (record.status !== 'passed' ||
      (record.reminderStep === 'complete' &&
        record.notifyButtonCount === 1 &&
        record.notifyButtonVisible &&
        record.reminderOptionsGetCount >= 1 &&
        record.reminderOptionsGetStatus >= 200 &&
        record.reminderOptionsGetStatus < 300 &&
        record.reminderConfigGetCount >= 1 &&
        record.reminderConfigGetStatus >= 200 &&
        record.reminderConfigGetStatus < 300 &&
        record.reminderEligibleOptionCount === 1 &&
        !record.reminderOptionCheckedBefore &&
        record.reminderOptionCheckAttempted &&
        record.reminderPutCount === 1 &&
        record.reminderPutStatus >= 200 &&
        record.reminderPutStatus < 300 &&
        record.reminderOptionCheckedAfter &&
        record.reminderEnabled &&
        record.httpStatus === record.reminderPutStatus &&
        record.count === 1))
  );
}

const PROJECTION_DIAGNOSTIC_REASONS = [
  'invalid-recurrence',
  'invalid-timing',
  'occurrence-limit',
  'recurrence-input-limit',
  'unsupported-recurrence',
  'unsupported-timezone',
  'range-this-and-future',
];

function validProjectionDiagnosticCounts(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const keys = Object.keys(value);
  return (
    keys.length === PROJECTION_DIAGNOSTIC_REASONS.length &&
    keys.every((key) => PROJECTION_DIAGNOSTIC_REASONS.includes(key)) &&
    PROJECTION_DIAGNOSTIC_REASONS.every(
      (reason) =>
        Number.isInteger(value[reason]) &&
        value[reason] >= 0 &&
        value[reason] <= 2,
    )
  );
}

function validProjectionDiagnosticSummary(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === 2 &&
    Object.hasOwn(value, 'complete') &&
    Object.hasOwn(value, 'counts') &&
    typeof value.complete === 'boolean' &&
    validProjectionDiagnosticCounts(value.counts)
  );
}

function validCalDavProjectionObservation(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== 5 ||
    !Object.hasOwn(value, 'completed') ||
    !Object.hasOwn(value, 'includesCreatedEvent') ||
    !Object.hasOwn(value, 'diagnosticCode') ||
    !Object.hasOwn(value, 'diagnosticCounts') ||
    !Object.hasOwn(value, 'timezoneAudit') ||
    typeof value.completed !== 'boolean' ||
    (value.includesCreatedEvent !== null &&
      typeof value.includesCreatedEvent !== 'boolean') ||
    !validProjectionDiagnosticCounts(value.diagnosticCounts) ||
    !validTimezoneSafetyObservation(value.timezoneAudit)
  ) {
    return false;
  }
  const diagnosticCodeIsKnown =
    value.diagnosticCode === 'none' ||
    value.diagnosticCode === 'inconclusive' ||
    PROJECTION_DIAGNOSTIC_REASONS.includes(value.diagnosticCode);
  return (
    diagnosticCodeIsKnown &&
    value.completed === (value.includesCreatedEvent !== null) &&
    (value.completed || value.diagnosticCode === 'inconclusive') &&
    (value.includesCreatedEvent !== true || value.diagnosticCode === 'none') &&
    (value.completed ||
      Object.values(value.diagnosticCounts).every((count) => count === 0))
  );
}

const TIMEZONE_AUDIT_CLASSIFICATIONS = new Set([
  'unsupported-zone-id',
  'no-embedded-definition',
  'duplicate-definitions',
  'embedded-definition-mismatch',
  'embedded-definition-matches',
  'other-unsupported-timezone',
  'no-zoned-start',
  'inconclusive',
]);

function validTimezoneSafetyObservation(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== 6 ||
    !Object.hasOwn(value, 'completed') ||
    !Object.hasOwn(value, 'parsedEventUnsupportedTimezone') ||
    !Object.hasOwn(value, 'bundledZoneId') ||
    !Object.hasOwn(value, 'embeddedDefinitionCount') ||
    !Object.hasOwn(value, 'canonicalEmbeddedDefinitionMatches') ||
    !Object.hasOwn(value, 'classification') ||
    typeof value.completed !== 'boolean' ||
    (value.parsedEventUnsupportedTimezone !== null &&
      typeof value.parsedEventUnsupportedTimezone !== 'boolean') ||
    (value.bundledZoneId !== null &&
      typeof value.bundledZoneId !== 'boolean') ||
    !Number.isInteger(value.embeddedDefinitionCount) ||
    value.embeddedDefinitionCount < 0 ||
    value.embeddedDefinitionCount > 2 ||
    (value.canonicalEmbeddedDefinitionMatches !== null &&
      typeof value.canonicalEmbeddedDefinitionMatches !== 'boolean') ||
    !TIMEZONE_AUDIT_CLASSIFICATIONS.has(value.classification)
  ) {
    return false;
  }
  return (
    (value.completed ||
      (value.parsedEventUnsupportedTimezone === null &&
        value.bundledZoneId === null &&
        value.embeddedDefinitionCount === 0 &&
        value.canonicalEmbeddedDefinitionMatches === null &&
        value.classification === 'inconclusive')) &&
    (value.canonicalEmbeddedDefinitionMatches === null ||
      (value.embeddedDefinitionCount === 1 && value.bundledZoneId === true)) &&
    (value.classification === 'inconclusive'
      ? !value.completed
      : value.completed) &&
    (value.classification !== 'unsupported-zone-id' ||
      (value.bundledZoneId === false &&
        value.parsedEventUnsupportedTimezone === true)) &&
    (value.classification !== 'no-embedded-definition' ||
      (value.bundledZoneId === true &&
        value.embeddedDefinitionCount === 0 &&
        value.parsedEventUnsupportedTimezone === false)) &&
    (value.classification !== 'duplicate-definitions' ||
      (value.bundledZoneId === true &&
        value.embeddedDefinitionCount === 2 &&
        value.parsedEventUnsupportedTimezone === true)) &&
    (value.classification !== 'embedded-definition-mismatch' ||
      (value.bundledZoneId === true &&
        value.embeddedDefinitionCount === 1 &&
        value.parsedEventUnsupportedTimezone === true &&
        value.canonicalEmbeddedDefinitionMatches === false)) &&
    (value.classification !== 'embedded-definition-matches' ||
      (value.bundledZoneId === true &&
        value.embeddedDefinitionCount === 1 &&
        value.parsedEventUnsupportedTimezone === false &&
        value.canonicalEmbeddedDefinitionMatches === true)) &&
    (value.classification !== 'other-unsupported-timezone' ||
      value.parsedEventUnsupportedTimezone === true) &&
    (value.classification !== 'no-zoned-start' ||
      (value.parsedEventUnsupportedTimezone === false &&
        value.bundledZoneId === null &&
        value.embeddedDefinitionCount === 0 &&
        value.canonicalEmbeddedDefinitionMatches === null))
  );
}

function validRuntimeVersions(record) {
  const expectedKeys = new Set(['phase', 'status', ...VERSION_FIELDS]);
  if (
    Object.keys(record).length !== expectedKeys.size ||
    Object.keys(record).some((key) => !expectedKeys.has(key)) ||
    record.status !== 'passed' ||
    record.elementWebConfiguredTag !== 'v1.12.30' ||
    record.synapseConfiguredTag !== 'v1.161.0' ||
    record.radicaleConfiguredTag !== '3.8.0.0' ||
    typeof record.chromiumVersion !== 'string' ||
    !/^\d{1,3}(?:\.\d{1,5}){2,3}$/u.test(record.chromiumVersion) ||
    record.runnerOS !== 'linux' ||
    typeof record.runnerOSVersion !== 'string' ||
    !/^\d+(?:\.\d+){1,4}(?:-\d+(?:-(?:azure|aws|gcp|generic))?)?$/u.test(
      record.runnerOSVersion,
    ) ||
    !['x64', 'arm64'].includes(record.runnerArchitecture) ||
    typeof record.nodeVersion !== 'string' ||
    !/^v\d{1,3}\.\d{1,3}\.\d{1,3}$/u.test(record.nodeVersion)
  ) {
    return false;
  }

  return true;
}

class SummaryValidationError extends Error {
  constructor(category, phase) {
    super('invalid element acceptance summary');
    this.category = SUMMARY_FAILURE_CATEGORIES.has(category)
      ? category
      : 'summary-unavailable';
    this.phase = PHASES.has(phase) ? phase : 'unknown';
  }
}

export function formatSanitizerFailureSummary(error, sourceSha) {
  const safeSourceSha =
    typeof sourceSha === 'string' && /^[a-f0-9]{40}$/iu.test(sourceSha)
      ? sourceSha.toLowerCase()
      : 'unavailable';
  const category = SUMMARY_FAILURE_CATEGORIES.has(error?.category)
    ? error.category
    : 'summary-unavailable';
  const phase = PHASES.has(error?.phase) ? error.phase : 'unknown';
  return [
    `element-acceptance source_sha=${safeSourceSha}`,
    `phase=summary status=unavailable category=${category} rejected_phase=${phase}`,
    '',
  ].join('\n');
}

export function sanitizeElementAcceptance(input, sourceSha) {
  if (typeof sourceSha !== 'string' || !/^[a-f0-9]{40}$/i.test(sourceSha)) {
    throw new SummaryValidationError('invalid-source-sha', 'unknown');
  }

  const phases = new Map();
  let rejectedPhase = 'unknown';
  let rejectionCategory = 'invalid-stage-record';
  for (const line of input.split(/\r?\n/u)) {
    if (!line) continue;

    let record;
    rejectedPhase = 'unknown';
    rejectionCategory = 'invalid-stage-json';
    try {
      record = JSON.parse(line);
    } catch {
      throw new SummaryValidationError(rejectionCategory, rejectedPhase);
    }
    rejectionCategory = 'invalid-stage-record';
    rejectedPhase =
      record !== null &&
      typeof record === 'object' &&
      !Array.isArray(record) &&
      PHASES.has(record.phase)
        ? record.phase
        : 'unknown';

    if (
      record === null ||
      typeof record !== 'object' ||
      Array.isArray(record) ||
      Object.keys(record).some((key) => !ALLOWED_KEYS.has(key)) ||
      !PHASES.has(record.phase) ||
      !STATUSES.has(record.status)
    ) {
      throw new SummaryValidationError(rejectionCategory, rejectedPhase);
    }

    const hasRuntimeObservation = RUNTIME_OBSERVATION_FIELDS.some((key) =>
      Object.hasOwn(record, key),
    );
    const hasPostCreateVisibilityObservation =
      POST_CREATE_VISIBILITY_FIELDS.some((key) => Object.hasOwn(record, key));
    const hasReminderConfigurationObservation =
      REMINDER_CONFIGURATION_FIELDS.some((key) => Object.hasOwn(record, key));
    if (
      (record.phase === 'widget-a-runtime-observed' &&
        !validRuntimeObservation(record)) ||
      (record.phase !== 'widget-a-runtime-observed' &&
        (hasRuntimeObservation ||
          OPTIONAL_RUNTIME_STATUS_FIELDS.some((key) =>
            Object.hasOwn(record, key),
          ))) ||
      (record.phase === 'event-create-post-refresh-observed' &&
        !validPostCreateVisibilityObservation(record)) ||
      (record.phase !== 'event-create-post-refresh-observed' &&
        hasPostCreateVisibilityObservation) ||
      (record.phase === 'reminder-room-configuration-enabled' &&
        !validReminderConfigurationObservation(record)) ||
      (record.phase !== 'reminder-room-configuration-enabled' &&
        hasReminderConfigurationObservation)
    ) {
      throw new SummaryValidationError(rejectionCategory, rejectedPhase);
    }

    if (
      Object.hasOwn(record, 'httpStatus') &&
      (!Number.isInteger(record.httpStatus) ||
        record.httpStatus < 100 ||
        record.httpStatus > 599)
    ) {
      throw new SummaryValidationError(rejectionCategory, rejectedPhase);
    }

    if (
      (Object.hasOwn(record, 'teamRoomMatches') &&
        typeof record.teamRoomMatches !== 'boolean') ||
      (record.phase !== 'outsider-room-widget-team-target' &&
        Object.hasOwn(record, 'teamRoomMatches')) ||
      (record.phase === 'outsider-room-widget-team-target' &&
        record.status === 'passed' &&
        (record.httpStatus !== 403 || record.teamRoomMatches !== true)) ||
      (record.phase === 'outsider-room-events-api-team-target' &&
        record.status === 'passed' &&
        record.httpStatus !== 403) ||
      (record.phase === 'outsider-own-unbound-room' &&
        record.status === 'passed' &&
        record.httpStatus !== 404)
    ) {
      throw new SummaryValidationError(rejectionCategory, rejectedPhase);
    }

    if (
      (record.phase === 'reminder-widget-context' &&
        typeof record.canManageReminders !== 'boolean') ||
      (record.phase !== 'reminder-widget-context' &&
        Object.hasOwn(record, 'canManageReminders'))
    ) {
      throw new SummaryValidationError(rejectionCategory, rejectedPhase);
    }

    if (
      Object.hasOwn(record, 'count') &&
      (!Number.isInteger(record.count) ||
        record.count < 0 ||
        record.count > 100000)
    ) {
      throw new SummaryValidationError(rejectionCategory, rejectedPhase);
    }

    if (
      !validG6Observation(record) ||
      ([...G6_EXTRA_NUMERIC_FIELDS].some((key) => Object.hasOwn(record, key)) &&
        !G6_PHASES.has(record.phase)) ||
      ([...G6_EXTRA_ENUM_FIELDS].some((key) => Object.hasOwn(record, key)) &&
        !G6_PHASES.has(record.phase)) ||
      ([...G6_EXTRA_BOOLEAN_FIELDS].some((key) => Object.hasOwn(record, key)) &&
        !G6_PHASES.has(record.phase))
    ) {
      throw new SummaryValidationError(rejectionCategory, rejectedPhase);
    }

    const phaseBooleans = PHASE_BOOLEAN_FIELDS.get(record.phase) ?? [];
    if (
      [...PHASE_BOOLEAN_FIELDS.values()]
        .flat()
        .some(
          (key) =>
            Object.hasOwn(record, key) &&
            (!phaseBooleans.includes(key) || typeof record[key] !== 'boolean'),
        ) ||
      (record.status === 'passed' &&
        phaseBooleans.some((key) => record[key] !== true))
    ) {
      throw new SummaryValidationError(rejectionCategory, rejectedPhase);
    }

    if (
      (Object.hasOwn(record, 'attemptCount') &&
        (!REMINDER_DELIVERY_PHASES.has(record.phase) ||
          !Number.isSafeInteger(record.attemptCount) ||
          record.attemptCount < 0)) ||
      (Object.hasOwn(record, 'checksum') &&
        (!PRIVATE_CHECKSUM_PHASES.has(record.phase) ||
          typeof record.checksum !== 'string' ||
          !/^[a-f0-9]{64}$/u.test(record.checksum))) ||
      (record.status === 'passed' &&
        REMINDER_DELIVERY_PHASES.has(record.phase) &&
        (!Number.isSafeInteger(record.attemptCount) ||
          record.attemptCount < 1)) ||
      (record.status === 'passed' &&
        PRIVATE_CHECKSUM_PHASES.has(record.phase) &&
        !Object.hasOwn(record, 'checksum'))
    ) {
      throw new SummaryValidationError(rejectionCategory, rejectedPhase);
    }

    if (
      record.phase === 'restore-quiesced' &&
      record.status === 'passed' &&
      record.count !== 4
    ) {
      throw new SummaryValidationError(rejectionCategory, rejectedPhase);
    }

    if (
      record.phase === 'restore-targets-prepared' &&
      record.status === 'passed' &&
      (record.freshVolume !== true || record.freshDatabase !== true)
    ) {
      throw new SummaryValidationError(rejectionCategory, rejectedPhase);
    }

    const hasRestoreTargetDiagnostics = RESTORE_TARGET_DIAGNOSTIC_FIELDS.some(
      (key) => Object.hasOwn(record, key),
    );
    if (
      (hasRestoreTargetDiagnostics &&
        (record.phase !== 'restore-targets-prepared' ||
          !['passed', 'failed'].includes(record.status) ||
          !RESTORE_TARGET_STEPS.has(record.restoreStep))) ||
      (record.phase === 'restore-targets-prepared' &&
        ['passed', 'failed'].includes(record.status) &&
        !hasRestoreTargetDiagnostics) ||
      RESTORE_TARGET_DIAGNOSTIC_FIELDS.slice(1, 8).some(
        (key) => Object.hasOwn(record, key) && typeof record[key] !== 'boolean',
      ) ||
      (Object.hasOwn(record, 'restoreArchiveEntryCount') &&
        (!Number.isInteger(record.restoreArchiveEntryCount) ||
          record.restoreArchiveEntryCount < 0 ||
          record.restoreArchiveEntryCount > 2)) ||
      (Object.hasOwn(record, 'restorePostgresRestored') &&
        typeof record.restorePostgresRestored !== 'boolean') ||
      (Object.hasOwn(record, 'restoreArchiveCountProbeValid') &&
        typeof record.restoreArchiveCountProbeValid !== 'boolean') ||
      (record.restoreDatabaseCreated === true &&
        record.restoreDatabaseExists !== false) ||
      (record.restoreVolumeCreated === true &&
        record.restoreVolumeExists !== false) ||
      (record.restoreVolumeEmpty === true &&
        record.restoreVolumeCreated !== true) ||
      (record.restoreArchiveExtracted === true &&
        (record.restoreVolumeCreated !== true ||
          record.restoreVolumeEmpty !== true)) ||
      (record.restoreArchiveEntryCount > 0 &&
        record.restoreArchiveExtracted !== true) ||
      (record.restoreArchiveCountProbeValid === true &&
        (record.restoreArchiveExtracted !== true ||
          !Object.hasOwn(record, 'restoreArchiveEntryCount'))) ||
      (Object.hasOwn(record, 'restoreArchiveCountProbeValid') &&
        (record.phase !== 'restore-targets-prepared' ||
          (record.restoreArchiveCountProbeValid === false &&
            record.restoreStep !== 'restored-volume-count') ||
          (record.restoreArchiveCountProbeValid === true &&
            !['restored-volume-count', 'postgres-restore', 'complete'].includes(
              record.restoreStep,
            )))) ||
      (record.restorePostgresRestored === true &&
        record.restoreDatabaseCreated !== true) ||
      (record.phase === 'restore-targets-prepared' &&
        record.status === 'passed' &&
        (record.restoreStep !== 'complete' ||
          record.restoreVolumeExists !== false ||
          record.restoreDatabaseExists !== false ||
          record.restoreTargetPlanSafe !== true ||
          record.restoreVolumeCreated !== true ||
          record.restoreVolumeEmpty !== true ||
          record.restoreDatabaseCreated !== true ||
          record.restoreArchiveExtracted !== true ||
          record.restoreArchiveCountProbeValid !== true ||
          record.restoreArchiveEntryCount < 1 ||
          record.restorePostgresRestored !== true))
    ) {
      throw new SummaryValidationError(rejectionCategory, rejectedPhase);
    }

    if (
      (record.phase === 'reminder-postgres-ready' &&
        record.status === 'passed' &&
        record.count !== 1) ||
      (record.phase === 'restore-element-ready' &&
        record.status === 'passed' &&
        record.count !== 2) ||
      (record.phase === 'reminder-configuration-stored' &&
        record.status === 'passed' &&
        (!Number.isInteger(record.count) ||
          record.count < 1 ||
          record.count > 3)) ||
      (record.phase === 'reminder-delivery-snapshot' &&
        record.status === 'passed' &&
        (!Number.isInteger(record.count) ||
          record.count < 1 ||
          record.count > 3)) ||
      (REMINDER_TIMELINE_COUNTS.has(record.phase) &&
        record.status === 'passed' &&
        (record.httpStatus !== 200 ||
          record.count !== REMINDER_TIMELINE_COUNTS.get(record.phase))) ||
      (record.phase === 'reminder-browser-egress' &&
        record.status === 'passed' &&
        record.count !== 0) ||
      (record.phase === 'reminder-alarm-ui-readback' &&
        record.status === 'passed' &&
        record.count !== 1) ||
      (record.phase === 'reminder-room-configuration-enabled' &&
        record.status === 'passed' &&
        record.count !== 1) ||
      (record.phase === 'reminder-ui-readback' &&
        record.status === 'passed' &&
        (!Number.isInteger(record.count) ||
          record.count < 1 ||
          record.count > 3)) ||
      (record.phase === 'reminder-widget-context' &&
        record.status === 'passed' &&
        record.httpStatus !== 200) ||
      (record.phase === 'reminder-room-configuration-enabled' &&
        record.status === 'passed' &&
        (!Number.isInteger(record.httpStatus) ||
          record.httpStatus < 200 ||
          record.httpStatus >= 300)) ||
      (record.phase === 'reminder-event-created' &&
        record.status === 'passed' &&
        (!Number.isInteger(record.httpStatus) ||
          record.httpStatus < 200 ||
          record.httpStatus >= 300)) ||
      (record.phase === 'reminder-event-visible' &&
        record.status === 'passed' &&
        (!Number.isInteger(record.httpStatus) ||
          record.httpStatus < 200 ||
          record.httpStatus >= 300 ||
          record.count !== 1))
    ) {
      throw new SummaryValidationError(rejectionCategory, rejectedPhase);
    }

    const reminderGatewayReadinessPhases = new Set([
      'reminder-gateway-migrated',
      'reminder-gateway-restarted',
      'restore-gateway-ready',
      'restore-radicale-ready',
    ]);
    if (
      Object.hasOwn(record, 'httpStatus') &&
      reminderGatewayReadinessPhases.has(record.phase) &&
      ((record.status === 'passed' &&
        !(
          record.phase === 'restore-radicale-ready' && record.httpStatus === 302
        ) &&
        (record.httpStatus < 400 || record.httpStatus > 499)) ||
        (record.status === 'failed' &&
          (record.httpStatus < 100 || record.httpStatus > 599)))
    ) {
      throw new SummaryValidationError(rejectionCategory, rejectedPhase);
    }

    const hasBlockedRequestDiagnostics =
      Object.hasOwn(record, 'blockedRequestDiagnostics') ||
      Object.hasOwn(record, 'blockedRequestDiagnosticOverflow');
    if (
      hasBlockedRequestDiagnostics &&
      (record.phase !== 'browser-egress' ||
        record.status !== 'failed' ||
        !Number.isInteger(record.count) ||
        record.count < 1 ||
        !Array.isArray(record.blockedRequestDiagnostics) ||
        record.blockedRequestDiagnostics.length < 1 ||
        record.blockedRequestDiagnostics.length > 32 ||
        typeof record.blockedRequestDiagnosticOverflow !== 'boolean' ||
        (record.blockedRequestDiagnosticOverflow &&
          record.blockedRequestDiagnostics.length !== 32))
    ) {
      throw new SummaryValidationError(rejectionCategory, rejectedPhase);
    }

    if (hasBlockedRequestDiagnostics) {
      const diagnosticKeys = new Set();
      let diagnosticCount = 0;
      for (const diagnostic of record.blockedRequestDiagnostics) {
        if (
          diagnostic === null ||
          typeof diagnostic !== 'object' ||
          Array.isArray(diagnostic) ||
          Object.keys(diagnostic).length !== 5 ||
          !Object.hasOwn(diagnostic, 'actor') ||
          !Object.hasOwn(diagnostic, 'harnessPhase') ||
          !Object.hasOwn(diagnostic, 'requestClass') ||
          !Object.hasOwn(diagnostic, 'resourceType') ||
          !Object.hasOwn(diagnostic, 'count') ||
          !BLOCKED_REQUEST_ACTORS.has(diagnostic.actor) ||
          !PHASES.has(diagnostic.harnessPhase) ||
          !BLOCKED_REQUEST_CLASSES.has(diagnostic.requestClass) ||
          !BLOCKED_REQUEST_RESOURCE_TYPES.has(diagnostic.resourceType) ||
          !Number.isInteger(diagnostic.count) ||
          diagnostic.count < 1 ||
          diagnostic.count > 2
        ) {
          throw new SummaryValidationError(rejectionCategory, rejectedPhase);
        }

        const key = JSON.stringify([
          diagnostic.actor,
          diagnostic.harnessPhase,
          diagnostic.requestClass,
          diagnostic.resourceType,
        ]);
        if (diagnosticKeys.has(key)) {
          throw new SummaryValidationError(rejectionCategory, rejectedPhase);
        }
        diagnosticKeys.add(key);
        diagnosticCount += diagnostic.count;
      }
      if (record.count < diagnosticCount) {
        throw new SummaryValidationError(rejectionCategory, rejectedPhase);
      }
    }

    if (
      record.phase === 'browser-egress' &&
      record.status === 'passed' &&
      record.count !== 0
    ) {
      throw new SummaryValidationError(rejectionCategory, rejectedPhase);
    }
    if (
      record.phase === 'browser-egress' &&
      record.count > 0 &&
      !hasBlockedRequestDiagnostics
    ) {
      throw new SummaryValidationError(rejectionCategory, rejectedPhase);
    }

    const hasPinnedControlObservation =
      Object.hasOwn(record, 'controlVisible') ||
      Object.hasOwn(record, 'panelPresent');
    const pinnedControlPhase = PINNED_WIDGET_CONTROL_PHASES.has(record.phase);
    const requiresPanelPresence = PINNED_WIDGET_PANEL_PHASES.has(record.phase);
    if (
      (hasPinnedControlObservation && !pinnedControlPhase) ||
      (pinnedControlPhase &&
        record.status !== 'passed' &&
        record.status !== 'failed') ||
      (pinnedControlPhase &&
        (!Object.hasOwn(record, 'count') || record.count > 2)) ||
      (pinnedControlPhase &&
        (!Object.hasOwn(record, 'controlVisible') ||
          typeof record.controlVisible !== 'boolean')) ||
      (pinnedControlPhase &&
        requiresPanelPresence !== Object.hasOwn(record, 'panelPresent')) ||
      (Object.hasOwn(record, 'panelPresent') &&
        typeof record.panelPresent !== 'boolean')
    ) {
      throw new SummaryValidationError(rejectionCategory, rejectedPhase);
    }

    for (const countKey of [
      'blockedExternalRequestCount',
      'homeserverHttpErrorCount',
    ]) {
      if (
        Object.hasOwn(record, countKey) &&
        (!Number.isInteger(record[countKey]) ||
          record[countKey] < 0 ||
          record[countKey] > 100000)
      ) {
        throw new SummaryValidationError(rejectionCategory, rejectedPhase);
      }
    }
    if (
      Object.hasOwn(record, 'homeserverLastHttpErrorStatus') &&
      (!Number.isInteger(record.homeserverLastHttpErrorStatus) ||
        record.homeserverLastHttpErrorStatus < 400 ||
        record.homeserverLastHttpErrorStatus > 599)
    ) {
      throw new SummaryValidationError(rejectionCategory, rejectedPhase);
    }

    if (
      Object.hasOwn(record, 'failureCode') &&
      !FAILURE_CODES.has(record.failureCode)
    ) {
      throw new SummaryValidationError(rejectionCategory, rejectedPhase);
    }

    const hasMissingModuleDiagnostic =
      Object.hasOwn(record, 'missingModuleKind') ||
      Object.hasOwn(record, 'missingDependency');
    if (
      (hasMissingModuleDiagnostic &&
        (record.phase !== 'gateway-ready' ||
          record.status !== 'failed' ||
          record.failureCode !== 'gateway-module-load-failed' ||
          !Object.hasOwn(record, 'missingModuleKind') ||
          !isMissingModuleKind(record.missingModuleKind))) ||
      (record.missingModuleKind === 'declared-package'
        ? !isRuntimeDependencyName(
            record.missingDependency,
            RUNTIME_DEPENDENCIES,
          )
        : Object.hasOwn(record, 'missingDependency'))
    ) {
      throw new SummaryValidationError(rejectionCategory, rejectedPhase);
    }

    if (
      Object.hasOwn(record, 'processExitCode') &&
      (!Number.isInteger(record.processExitCode) ||
        record.processExitCode < 1 ||
        record.processExitCode > 255)
    ) {
      throw new SummaryValidationError(rejectionCategory, rejectedPhase);
    }

    const hasContainerDiagnostic = [
      'containerState',
      'containerHealth',
      'containerExitCode',
      'containerOomKilled',
      'containerRuntimeErrorPresent',
    ].some((key) => Object.hasOwn(record, key));
    const hasRestoreRadicaleProbeDiagnostic = Object.hasOwn(
      record,
      'restoreRadicaleProbeOutcome',
    );
    const restoreRadicaleListenerFields = [
      'restoreRadicaleContainerHttpOutcome',
      'restoreRadicaleContainerHttpStatus',
      'restoreRadicalePublishedPortBinding',
    ];
    const hasRestoreRadicaleListenerDiagnostic =
      restoreRadicaleListenerFields.some((key) => Object.hasOwn(record, key));
    const restoreRadicaleListenerFieldsComplete = [
      'restoreRadicaleContainerHttpOutcome',
      'restoreRadicalePublishedPortBinding',
    ].every((key) => Object.hasOwn(record, key));
    const restoreRadicaleStartupFields = [
      'restoreRadicaleStartupSignature',
      'restoreRadicaleLogsAvailable',
      'restoreRadicaleStartupExceptionPresent',
      'restoreRadicaleReadyMarkerPresent',
      'restoreRadicaleStartupExceptionClass',
      'restoreRadicaleStartupErrno',
      'restoreRadicaleStartupPathBucket',
    ];
    const hasRestoreRadicaleStartupDiagnostic =
      restoreRadicaleStartupFields.some((key) => Object.hasOwn(record, key));
    const restoreRadicaleStartupFieldsComplete =
      restoreRadicaleStartupFields.every((key) => Object.hasOwn(record, key));
    if (
      (hasRestoreRadicaleProbeDiagnostic &&
        (record.phase !== 'restore-radicale-ready' ||
          record.status !== 'failed' ||
          !RESTORE_RADICALE_PROBE_OUTCOMES.has(
            record.restoreRadicaleProbeOutcome,
          ) ||
          (record.restoreRadicaleProbeOutcome === 'no-response' &&
            Object.hasOwn(record, 'httpStatus')) ||
          (record.restoreRadicaleProbeOutcome === 'http-status' &&
            !Object.hasOwn(record, 'httpStatus')) ||
          Object.hasOwn(record, 'processExitCode'))) ||
      (hasContainerDiagnostic &&
        (!(
          record.phase === 'gateway-ready' ||
          (record.phase === 'restore-radicale-ready' &&
            hasRestoreRadicaleProbeDiagnostic)
        ) ||
          record.status !== 'failed' ||
          !Object.hasOwn(record, 'containerState') ||
          !CONTAINER_STATES.has(record.containerState) ||
          !Object.hasOwn(record, 'containerHealth') ||
          !CONTAINER_HEALTH_STATES.has(record.containerHealth))) ||
      (hasRestoreRadicaleProbeDiagnostic && !hasContainerDiagnostic) ||
      (hasRestoreRadicaleListenerDiagnostic &&
        (record.phase !== 'restore-radicale-ready' ||
          record.status !== 'failed' ||
          !hasRestoreRadicaleProbeDiagnostic ||
          !restoreRadicaleListenerFieldsComplete ||
          !RESTORE_RADICALE_CONTAINER_HTTP_OUTCOMES.has(
            record.restoreRadicaleContainerHttpOutcome,
          ) ||
          !RESTORE_RADICALE_PUBLISHED_PORT_BINDINGS.has(
            record.restoreRadicalePublishedPortBinding,
          ) ||
          (record.restoreRadicaleContainerHttpOutcome === 'http-status' &&
            (!Number.isInteger(record.restoreRadicaleContainerHttpStatus) ||
              record.restoreRadicaleContainerHttpStatus < 100 ||
              record.restoreRadicaleContainerHttpStatus > 599)) ||
          (record.restoreRadicaleContainerHttpOutcome !== 'http-status' &&
            Object.hasOwn(record, 'restoreRadicaleContainerHttpStatus')))) ||
      (hasRestoreRadicaleStartupDiagnostic &&
        (record.phase !== 'restore-radicale-ready' ||
          record.status !== 'failed' ||
          !hasRestoreRadicaleProbeDiagnostic ||
          !restoreRadicaleStartupFieldsComplete ||
          !RESTORE_RADICALE_STARTUP_SIGNATURES.has(
            record.restoreRadicaleStartupSignature,
          ) ||
          typeof record.restoreRadicaleLogsAvailable !== 'boolean' ||
          typeof record.restoreRadicaleStartupExceptionPresent !== 'boolean' ||
          typeof record.restoreRadicaleReadyMarkerPresent !== 'boolean' ||
          !RESTORE_RADICALE_STARTUP_EXCEPTION_CLASSES.has(
            record.restoreRadicaleStartupExceptionClass,
          ) ||
          !RESTORE_RADICALE_STARTUP_ERRNOS.has(
            record.restoreRadicaleStartupErrno,
          ) ||
          !RESTORE_RADICALE_STARTUP_PATH_BUCKETS.has(
            record.restoreRadicaleStartupPathBucket,
          ) ||
          (record.restoreRadicaleLogsAvailable === false &&
            (record.restoreRadicaleStartupSignature !== 'unavailable' ||
              record.restoreRadicaleStartupExceptionPresent ||
              record.restoreRadicaleReadyMarkerPresent ||
              record.restoreRadicaleStartupExceptionClass !== 'unavailable' ||
              record.restoreRadicaleStartupErrno !== 'unavailable' ||
              record.restoreRadicaleStartupPathBucket !== 'unavailable')) ||
          (record.restoreRadicaleLogsAvailable === true &&
            (record.restoreRadicaleStartupSignature === 'unavailable' ||
              record.restoreRadicaleStartupExceptionClass === 'unavailable' ||
              record.restoreRadicaleStartupErrno === 'unavailable' ||
              record.restoreRadicaleStartupPathBucket === 'unavailable')))) ||
      !validRestoreRadicaleFilesystemEvidence(record) ||
      (Object.hasOwn(record, 'containerExitCode') &&
        (!Number.isInteger(record.containerExitCode) ||
          record.containerExitCode < 0 ||
          record.containerExitCode > 255)) ||
      (Object.hasOwn(record, 'containerOomKilled') &&
        typeof record.containerOomKilled !== 'boolean') ||
      (Object.hasOwn(record, 'containerRuntimeErrorPresent') &&
        typeof record.containerRuntimeErrorPresent !== 'boolean')
    ) {
      throw new SummaryValidationError(rejectionCategory, rejectedPhase);
    }

    if (
      (record.phase === 'runtime-versions' && !validRuntimeVersions(record)) ||
      (record.phase !== 'runtime-versions' &&
        [...VERSION_FIELDS].some((key) => Object.hasOwn(record, key)))
    ) {
      throw new SummaryValidationError(rejectionCategory, rejectedPhase);
    }

    if (
      (record.failureCode === 'docker-command-failed' &&
        !Object.hasOwn(record, 'processExitCode')) ||
      (record.failureCode === 'matrix-http-failed' &&
        !Object.hasOwn(record, 'httpStatus')) ||
      (record.failureCode === 'matrix-invalid-json' &&
        !Object.hasOwn(record, 'httpStatus'))
    ) {
      throw new SummaryValidationError(rejectionCategory, rejectedPhase);
    }

    const sessionObservationKeys = [
      'matrixClientHookPresent',
      'matrixClientPresent',
    ];
    const hasSessionObservation = sessionObservationKeys.some((key) =>
      Object.hasOwn(record, key),
    );
    const hasMatrixUserObservation = Object.hasOwn(record, 'matrixUserMatches');
    const hasSyncObservation = Object.hasOwn(record, 'matrixSyncState');
    const validSessionObservation =
      record.phase !== 'member-a-session-observed' ||
      (record.status === 'passed' &&
        hasSessionObservation &&
        hasSyncObservation) ||
      (record.status === 'unavailable' &&
        !hasSessionObservation &&
        !hasMatrixUserObservation &&
        !hasSyncObservation);
    if (
      (hasSessionObservation &&
        (record.phase !== 'member-a-session-observed' ||
          record.status !== 'passed' ||
          typeof record.matrixClientHookPresent !== 'boolean' ||
          typeof record.matrixClientPresent !== 'boolean')) ||
      (hasMatrixUserObservation &&
        record.phase !== 'member-a-session-observed' &&
        !ROOM_CONTEXT_PHASES.has(record.phase)) ||
      (hasSyncObservation &&
        ((record.phase !== 'member-a-session-observed' &&
          !ROOM_CONTEXT_PHASES.has(record.phase)) ||
          !MATRIX_SYNC_STATES.has(record.matrixSyncState))) ||
      (record.phase === 'member-a-session-observed' &&
        hasMatrixUserObservation !== hasSyncObservation) ||
      (hasMatrixUserObservation &&
        typeof record.matrixUserMatches !== 'boolean') ||
      !validSessionObservation
    ) {
      throw new SummaryValidationError(rejectionCategory, rejectedPhase);
    }

    const roomObservationKeys = [
      'matrixRoomKnown',
      'matrixRoomJoined',
      'roomNavigationCompleted',
      'roomHeadingReady',
      'roomHeadingPresent',
      'roomNameMatches',
      'roomIdMatches',
      ...REMINDER_ROOM_LAYOUT_FIELDS,
      'blockedExternalRequestCount',
      'homeserverHttpErrorCount',
      'homeserverLastHttpErrorStatus',
    ];
    const hasRoomObservation = roomObservationKeys.some((key) =>
      Object.hasOwn(record, key),
    );
    const hasReminderRoomLayoutObservation = REMINDER_ROOM_LAYOUT_FIELDS.some(
      (key) => Object.hasOwn(record, key),
    );
    const hasReminderWidgetContextObservation =
      REMINDER_ROOM_CONTEXT_RESPONSE_FIELDS.some((key) =>
        Object.hasOwn(record, key),
      );
    const roomFailureCodes = new Set([
      'element-room-navigation-failed',
      'element-room-observation-unavailable',
      'element-room-session-mismatch',
      'element-room-not-known',
      'element-room-not-joined',
      'element-room-route-mismatch',
      'element-room-heading-not-present',
      'element-room-name-mismatch',
      'element-room-heading-wait-timeout',
    ]);
    const requiredRoomBooleans = [
      'matrixUserMatches',
      'matrixRoomKnown',
      'matrixRoomJoined',
      'roomNavigationCompleted',
      'roomHeadingReady',
      'roomHeadingPresent',
      'roomNameMatches',
      'roomIdMatches',
    ];
    if (
      ((hasRoomObservation || ROOM_CONTEXT_PHASES.has(record.phase)) &&
        (!ROOM_CONTEXT_PHASES.has(record.phase) ||
          !['passed', 'failed'].includes(record.status))) ||
      (hasRoomObservation &&
        (requiredRoomBooleans.some((key) => typeof record[key] !== 'boolean') ||
          !hasSyncObservation ||
          !Object.hasOwn(record, 'blockedExternalRequestCount') ||
          !Object.hasOwn(record, 'homeserverHttpErrorCount') ||
          (Object.hasOwn(record, 'homeserverLastHttpErrorStatus') &&
            record.homeserverHttpErrorCount === 0) ||
          (record.status === 'passed' &&
            (record.failureCode !== undefined ||
              requiredRoomBooleans.some((key) => record[key] !== true))) ||
          (record.status === 'failed' &&
            !roomFailureCodes.has(record.failureCode)))) ||
      (hasReminderRoomLayoutObservation &&
        (record.phase !== 'reminder-room-context' ||
          REMINDER_ROOM_LAYOUT_FIELDS.some(
            (key) =>
              !Object.hasOwn(record, key) || typeof record[key] !== 'boolean',
          ))) ||
      (hasReminderWidgetContextObservation &&
        (record.phase !== 'reminder-room-context' ||
          !Number.isInteger(record.reminderWidgetContextResponseCount) ||
          record.reminderWidgetContextResponseCount < 0 ||
          record.reminderWidgetContextResponseCount > 1 ||
          (record.reminderWidgetContextResponseCount === 0 &&
            Object.hasOwn(record, 'reminderWidgetContextResponseStatus')) ||
          (record.reminderWidgetContextResponseCount === 1 &&
            (!Number.isInteger(record.reminderWidgetContextResponseStatus) ||
              record.reminderWidgetContextResponseStatus < 100 ||
              record.reminderWidgetContextResponseStatus > 599)))) ||
      (ROOM_CONTEXT_PHASES.has(record.phase) &&
        !hasRoomObservation &&
        (record.status !== 'failed' ||
          !roomFailureCodes.has(record.failureCode))) ||
      (hasRoomObservation &&
        (Object.hasOwn(record, 'matrixClientHookPresent') ||
          Object.hasOwn(record, 'matrixClientPresent'))) ||
      (Object.hasOwn(record, 'failureCode') &&
        roomFailureCodes.has(record.failureCode) &&
        !ROOM_CONTEXT_PHASES.has(record.phase))
    ) {
      throw new SummaryValidationError(rejectionCategory, rejectedPhase);
    }

    if (
      (Object.hasOwn(record, 'originMatchesElement') &&
        (record.phase !== 'member-a-origin-navigation' ||
          record.status !== 'passed' ||
          typeof record.originMatchesElement !== 'boolean')) ||
      (record.phase === 'member-a-origin-navigation' &&
        record.status === 'passed' &&
        !Object.hasOwn(record, 'originMatchesElement'))
    ) {
      throw new SummaryValidationError(rejectionCategory, rejectedPhase);
    }

    phases.set(record.phase, record);
  }

  const lines = [`element-acceptance source_sha=${sourceSha.toLowerCase()}`];
  for (const [phase, record] of phases) {
    if (phase === 'widget-a-runtime-observed') {
      const fields = [
        `phase=${phase}`,
        `status=${record.status}`,
        `gateway_context_requests=${record.gatewayContextRequestCount}`,
        `gateway_calendars_requests=${record.gatewayCalendarsRequestCount}`,
        `gateway_events_requests=${record.gatewayEventsRequestCount}`,
        `gateway_other_calendar_requests=${record.gatewayOtherCalendarRequestCount}`,
        `gateway_other_api_requests=${record.gatewayOtherApiRequestCount}`,
        `gateway_options_requests=${record.gatewayOptionsRequestCount}`,
        `gateway_failed_requests=${record.gatewayFailedRequestCount}`,
        `gateway_last_request_endpoint=${record.gatewayLastRequestEndpoint}`,
        `gateway_last_request_method=${record.gatewayLastRequestMethod}`,
        `gateway_last_response_endpoint=${record.gatewayLastResponseEndpoint}`,
        `gateway_last_response_method=${record.gatewayLastResponseMethod}`,
        ...OPTIONAL_RUNTIME_STATUS_FIELDS.filter((key) =>
          Object.hasOwn(record, key),
        ).map((key) => {
          const outputNames = {
            gatewayLastResponseStatus: 'gateway_last_response_status',
            widgetDocumentLastStatus: 'widget_document_last_status',
            widgetScriptLastStatus: 'widget_script_last_status',
            widgetStylesheetLastStatus: 'widget_stylesheet_last_status',
            openIdLastResponseStatus: 'openid_last_response_status',
          };
          return `${outputNames[key]}=${record[key]}`;
        }),
        `widget_document_requests=${record.widgetDocumentRequestCount}`,
        `widget_script_requests=${record.widgetScriptRequestCount}`,
        `widget_stylesheet_requests=${record.widgetStylesheetRequestCount}`,
        `widget_document_failures=${record.widgetDocumentFailureCount}`,
        `widget_script_failures=${record.widgetScriptFailureCount}`,
        `widget_stylesheet_failures=${record.widgetStylesheetFailureCount}`,
        `openid_requests=${record.openIdRequestCount}`,
        `openid_options_requests=${record.openIdOptionsRequestCount}`,
        `openid_failed_requests=${record.openIdFailedRequestCount}`,
        `openid_last_request_method=${record.openIdLastRequestMethod}`,
        `widget_api_parent_observer_available=${record.widgetApiParentObserverAvailable}`,
        `widget_api_get_openid_requests=${record.widgetApiGetOpenIdRequestCount}`,
        `widget_api_request_source_matches=${record.widgetApiRequestSourceMatches}`,
        `widget_api_request_origin_matches=${record.widgetApiRequestOriginMatches}`,
        `widget_api_request_widget_id_matches=${record.widgetApiRequestWidgetIdMatches}`,
        `widget_api_initial_response_count=${record.widgetApiInitialResponseCount}`,
        `widget_api_initial_response_state=${record.widgetApiInitialResponseState}`,
        `widget_api_initial_response_source_matches=${record.widgetApiInitialResponseSourceMatches}`,
        `widget_api_initial_response_origin_matches=${record.widgetApiInitialResponseOriginMatches}`,
        `widget_api_initial_response_widget_id_matches=${record.widgetApiInitialResponseWidgetIdMatches}`,
        `widget_api_followup_count=${record.widgetApiFollowupCount}`,
        `widget_api_followup_state=${record.widgetApiFollowupState}`,
        `widget_api_followup_request_id_matches=${record.widgetApiFollowupRequestIdMatches}`,
        `widget_api_followup_source_matches=${record.widgetApiFollowupSourceMatches}`,
        `widget_api_followup_origin_matches=${record.widgetApiFollowupOriginMatches}`,
        `widget_api_followup_widget_id_matches=${record.widgetApiFollowupWidgetIdMatches}`,
        `widget_parameters_observed=${record.widgetParametersObserved}`,
        `widget_gateway_base_origin_matches=${record.widgetGatewayBaseOriginMatches}`,
        `widget_room_id_matches=${record.widgetRoomIdMatches}`,
        `widget_id_parameter_present=${record.widgetIdParameterPresent}`,
        `widget_frame_available=${record.widgetFrameAvailable}`,
        `widget_document_ready_state=${record.widgetDocumentReadyState}`,
        `widget_root_has_children=${record.widgetRootHasChildren}`,
        `widget_loading_visible=${record.widgetLoadingVisible}`,
        `widget_missing_capabilities_visible=${record.widgetMissingCapabilitiesVisible}`,
        `widget_registration_error_visible=${record.widgetRegistrationErrorVisible}`,
        `widget_outside_client_visible=${record.widgetOutsideClientVisible}`,
        `widget_child_error_visible=${record.widgetChildErrorVisible}`,
        `calendar_events_loading_visible=${record.calendarEventsLoadingVisible}`,
        `calendar_events_load_error_visible=${record.calendarEventsLoadErrorVisible}`,
        `widget_page_errors=${record.widgetPageErrorCount}`,
        `widget_last_page_error_class=${record.widgetLastPageErrorClass}`,
        `iframe_observation_available=${record.iframeObservationAvailable}`,
        `iframe_gateway_base_origin_matches=${record.iframeGatewayBaseOriginMatches}`,
        `iframe_room_id_matches=${record.iframeRoomIdMatches}`,
        `create_event_visible=${record.createEventVisible}`,
        `create_event_enabled=${record.createEventEnabled}`,
        `identity_continue_visible=${record.identityContinueVisible}`,
      ];
      lines.push(fields.join(' '));
      continue;
    }

    if (phase === 'runtime-versions') {
      lines.push(
        [
          'phase=runtime-versions',
          'status=passed',
          `element_web_configured_tag=${record.elementWebConfiguredTag}`,
          `synapse_configured_tag=${record.synapseConfiguredTag}`,
          `radicale_configured_tag=${record.radicaleConfiguredTag}`,
          `chromium_observed=${record.chromiumVersion}`,
          `runner_os=${record.runnerOS}`,
          `kernel_release=${record.runnerOSVersion}`,
          `runner_arch=${record.runnerArchitecture}`,
          `node_observed=${record.nodeVersion}`,
        ].join(' '),
      );
      continue;
    }

    if (phase === 'reminder-room-configuration-enabled') {
      lines.push(
        [
          `phase=${phase}`,
          `status=${record.status}`,
          `reminder_step=${record.reminderStep}`,
          `notify_button_count=${record.notifyButtonCount}`,
          `notify_button_visible=${record.notifyButtonVisible}`,
          `options_get_count=${record.reminderOptionsGetCount}`,
          `options_http_status=${record.reminderOptionsGetStatus}`,
          `configuration_get_count=${record.reminderConfigGetCount}`,
          `configuration_http_status=${record.reminderConfigGetStatus}`,
          `eligible_option_count=${record.reminderEligibleOptionCount}`,
          `option_checked_before=${record.reminderOptionCheckedBefore}`,
          `option_check_attempted=${record.reminderOptionCheckAttempted}`,
          `put_count=${record.reminderPutCount}`,
          `put_http_status=${record.reminderPutStatus}`,
          `option_checked_after=${record.reminderOptionCheckedAfter}`,
        ].join(' '),
      );
      continue;
    }

    if (phase === 'event-create-post-refresh-observed') {
      lines.push(
        [
          `phase=${phase}`,
          `status=${record.status}`,
          `post_create_event_get_requests=${record.postCreateEventGetRequestCount}`,
          `room_target_range_requests=${record.roomTargetRangeRequestCount}`,
          `expected_room_range_request_seen=${record.expectedRoomRangeRequestSeen}`,
          `room_target_range_responses=${record.roomTargetRangeResponseCount}`,
          `room_target_range_last_status=${record.roomTargetRangeLastStatus ?? 'none'}`,
          `create_response_has_event=${record.createResponseHasEvent}`,
          `create_response_title_matches=${record.createResponseTitleMatches}`,
          `create_response_calendar_matches=${record.createResponseCalendarMatches}`,
          `create_response_timing_comparable=${record.createResponseTimingComparable}`,
          `create_response_event_intersects_room_range=${record.createResponseEventIntersectsRoomRange}`,
          `caldav_report_probe_completed=${record.caldavReportProbeCompleted}`,
          `caldav_openid_http_status=${record.caldavOpenIdHttpStatus ?? 'none'}`,
          `caldav_report_http_status=${record.caldavReportHttpStatus ?? 'none'}`,
          `caldav_report_contains_created_event=${record.caldavReportContainsCreatedEvent ?? 'inconclusive'}`,
          `caldav_projection_completed=${record.caldavProjection.completed}`,
          `caldav_projection_includes_created_event=${record.caldavProjection.includesCreatedEvent ?? 'inconclusive'}`,
          `caldav_projection_diagnostic=${record.caldavProjection.diagnosticCode}`,
          ...PROJECTION_DIAGNOSTIC_REASONS.map(
            (reason) =>
              `caldav_projection_${reason}=${record.caldavProjection.diagnosticCounts[reason]}`,
          ),
          `timezone_audit_completed=${record.caldavProjection.timezoneAudit.completed}`,
          `timezone_event_unsupported=${record.caldavProjection.timezoneAudit.parsedEventUnsupportedTimezone ?? 'inconclusive'}`,
          `timezone_source_id_bundled=${record.caldavProjection.timezoneAudit.bundledZoneId ?? 'inconclusive'}`,
          `timezone_embedded_definitions=${record.caldavProjection.timezoneAudit.embeddedDefinitionCount}`,
          `timezone_embedded_definition_matches=${record.caldavProjection.timezoneAudit.canonicalEmbeddedDefinitionMatches ?? 'inconclusive'}`,
          `timezone_audit_classification=${record.caldavProjection.timezoneAudit.classification}`,
          `room_list_response_has_events=${record.roomListResponseHasEventsArray}`,
          `room_list_response_event_count=${record.roomListResponseEventCount}`,
          `room_list_diagnostics_complete=${record.roomListDiagnostics.complete}`,
          ...PROJECTION_DIAGNOSTIC_REASONS.map(
            (reason) =>
              `room_list_diagnostic_${reason}=${record.roomListDiagnostics.counts[reason]}`,
          ),
          `room_list_response_title_matches=${record.roomListResponseTitleMatches}`,
          `room_list_response_id_matches=${record.roomListResponseIdMatches}`,
          `room_list_response_calendar_matches=${record.roomListResponseCalendarMatches}`,
          `list_view_heading_present=${record.listViewHeadingPresent}`,
          `matching_list_item_count=${record.matchingListItemCount}`,
        ].join(' '),
      );
      continue;
    }

    if (phase === 'browser-egress' && record.blockedRequestDiagnostics) {
      const diagnostics = record.blockedRequestDiagnostics
        .map(
          ({ actor, harnessPhase, requestClass, resourceType, count }) =>
            `${actor}/harness_phase=${harnessPhase}/${requestClass}/${resourceType}/${count}`,
        )
        .join(',');
      lines.push(
        `phase=browser-egress status=failed count=${record.count} blocked_request_diagnostic_overflow=${record.blockedRequestDiagnosticOverflow} blocked_requests=${diagnostics}`,
      );
      continue;
    }

    const fields = [`phase=${phase}`, `status=${record.status}`];
    if (Object.hasOwn(record, 'httpStatus')) {
      fields.push(`http_status=${record.httpStatus}`);
    }
    if (Object.hasOwn(record, 'teamRoomMatches')) {
      fields.push(`team_room_matches=${record.teamRoomMatches}`);
    }
    if (Object.hasOwn(record, 'count')) {
      fields.push(`count=${record.count}`);
    }
    if (Object.hasOwn(record, 'restoreStep')) {
      fields.push(`restore_step=${record.restoreStep}`);
      for (const [key, outputKey] of [
        ['restoreVolumeExists', 'restore_volume_exists'],
        ['restoreDatabaseExists', 'restore_database_exists'],
        ['restoreTargetPlanSafe', 'restore_target_plan_safe'],
        ['restoreVolumeCreated', 'restore_volume_created'],
        ['restoreVolumeEmpty', 'restore_volume_empty'],
        ['restoreDatabaseCreated', 'restore_database_created'],
        ['restoreArchiveExtracted', 'restore_archive_extracted'],
        ['restoreArchiveEntryCount', 'restore_archive_entry_count'],
        ['restoreArchiveCountProbeValid', 'restore_archive_count_probe_valid'],
        ['restorePostgresRestored', 'restore_postgres_restored'],
      ]) {
        if (Object.hasOwn(record, key)) {
          fields.push(`${outputKey}=${record[key]}`);
        }
      }
    }
    for (const [key, name] of [
      ['relativeAlarmReadback', 'relative_alarm_readback'],
      ['reminderEnabled', 'reminder_enabled'],
      ['canaryDelivered', 'canary_delivered'],
      ['roomMentioned', 'room_mentioned'],
      ['deliveredAfterDue', 'delivered_after_due'],
      ['allMarkersOnce', 'all_markers_once'],
    ]) {
      if (Object.hasOwn(record, key)) fields.push(`${name}=${record[key]}`);
    }
    if (Object.hasOwn(record, 'controlVisible')) {
      fields.push(`control_visible=${record.controlVisible}`);
    }
    if (Object.hasOwn(record, 'panelPresent')) {
      fields.push(`panel_present=${record.panelPresent}`);
    }
    if (Object.hasOwn(record, 'originMatchesElement')) {
      fields.push(`origin_matches_element=${record.originMatchesElement}`);
    }
    if (Object.hasOwn(record, 'matrixClientHookPresent')) {
      fields.push(
        `matrix_client_hook_present=${record.matrixClientHookPresent}`,
      );
      fields.push(`matrix_client_present=${record.matrixClientPresent}`);
      fields.push(`matrix_user_matches=${record.matrixUserMatches}`);
      fields.push(`matrix_sync_state=${record.matrixSyncState}`);
    }
    if (
      ROOM_CONTEXT_PHASES.has(phase) &&
      record.matrixUserMatches !== undefined
    ) {
      fields.push(`matrix_user_matches=${record.matrixUserMatches}`);
      fields.push(`matrix_room_known=${record.matrixRoomKnown}`);
      fields.push(`matrix_room_joined=${record.matrixRoomJoined}`);
      fields.push(`matrix_sync_state=${record.matrixSyncState}`);
      fields.push(
        `room_navigation_completed=${record.roomNavigationCompleted}`,
      );
      fields.push(`room_heading_ready=${record.roomHeadingReady}`);
      fields.push(`room_heading_present=${record.roomHeadingPresent}`);
      fields.push(`room_name_matches=${record.roomNameMatches}`);
      fields.push(`room_id_matches=${record.roomIdMatches}`);
      for (const [key, label] of [
        ['roomViewPresent', 'room_view_present'],
        ['roomHeaderPresent', 'room_header_present'],
        ['roomHeadingDomPresent', 'room_heading_dom_present'],
        ['roomInfoControlPresent', 'room_info_control_present'],
        ['fixtureCalendarIframePresent', 'fixture_calendar_iframe_present'],
      ]) {
        if (Object.hasOwn(record, key)) {
          fields.push(`${label}=${record[key]}`);
        }
      }
      if (
        phase === 'reminder-room-context' &&
        Object.hasOwn(record, 'reminderWidgetContextResponseCount')
      ) {
        fields.push(
          `reminder_widget_context_response_count=${record.reminderWidgetContextResponseCount}`,
        );
        if (Object.hasOwn(record, 'reminderWidgetContextResponseStatus')) {
          fields.push(
            `reminder_widget_context_response_status=${record.reminderWidgetContextResponseStatus}`,
          );
        }
      }
      fields.push(
        `blocked_external_request_count=${record.blockedExternalRequestCount}`,
      );
      fields.push(
        `homeserver_http_error_count=${record.homeserverHttpErrorCount}`,
      );
      if (record.homeserverLastHttpErrorStatus !== undefined) {
        fields.push(
          `homeserver_last_http_error_status=${record.homeserverLastHttpErrorStatus}`,
        );
      }
    }
    if (
      phase === 'reminder-room-context' &&
      record.matrixUserMatches === undefined
    ) {
      if (Object.hasOwn(record, 'reminderWidgetContextResponseCount')) {
        fields.push(
          `reminder_widget_context_response_count=${record.reminderWidgetContextResponseCount}`,
        );
        if (Object.hasOwn(record, 'reminderWidgetContextResponseStatus')) {
          fields.push(
            `reminder_widget_context_response_status=${record.reminderWidgetContextResponseStatus}`,
          );
        }
      }
    }
    if (Object.hasOwn(record, 'failureCode')) {
      fields.push(`failure_code=${record.failureCode}`);
    }
    if (Object.hasOwn(record, 'seedCreateObservations')) {
      record.seedCreateObservations.forEach((observation, index) => {
        fields.push(
          `seed_create_${index + 1}=${observation.outcome}:${observation.status ?? 'none'}:${observation.etagPresent ?? 'unknown'}:${observation.etagStrong ?? 'unknown'}`,
        );
      });
    }
    if (Object.hasOwn(record, 'missingModuleKind')) {
      fields.push(`missing_module_kind=${record.missingModuleKind}`);
    }
    if (Object.hasOwn(record, 'missingDependency')) {
      fields.push(`missing_dependency=${record.missingDependency}`);
    }
    if (Object.hasOwn(record, 'processExitCode')) {
      fields.push(`process_exit_code=${record.processExitCode}`);
    }
    if (Object.hasOwn(record, 'containerState')) {
      fields.push(`container_state=${record.containerState}`);
      fields.push(`container_health=${record.containerHealth}`);
    }
    if (Object.hasOwn(record, 'containerExitCode')) {
      fields.push(`container_exit_code=${record.containerExitCode}`);
    }
    if (Object.hasOwn(record, 'containerOomKilled')) {
      fields.push(`container_oom_killed=${record.containerOomKilled}`);
    }
    if (Object.hasOwn(record, 'containerRuntimeErrorPresent')) {
      fields.push(
        `container_runtime_error_present=${record.containerRuntimeErrorPresent}`,
      );
    }
    if (Object.hasOwn(record, 'restoreRadicaleProbeOutcome')) {
      fields.push(
        `restore_radicale_probe_outcome=${record.restoreRadicaleProbeOutcome}`,
      );
    }
    if (Object.hasOwn(record, 'restoreRadicaleContainerHttpOutcome')) {
      fields.push(
        `radicale_container_http_outcome=${record.restoreRadicaleContainerHttpOutcome}`,
        `radicale_published_port_binding=${record.restoreRadicalePublishedPortBinding}`,
      );
      if (Object.hasOwn(record, 'restoreRadicaleContainerHttpStatus')) {
        fields.push(
          `radicale_container_http_status=${record.restoreRadicaleContainerHttpStatus}`,
        );
      }
    }
    if (Object.hasOwn(record, 'restoreRadicaleStartupSignature')) {
      fields.push(
        `radicale_startup_signature=${record.restoreRadicaleStartupSignature}`,
        `radicale_logs_available=${record.restoreRadicaleLogsAvailable}`,
        `radicale_startup_exception_present=${record.restoreRadicaleStartupExceptionPresent}`,
        `radicale_ready_marker_present=${record.restoreRadicaleReadyMarkerPresent}`,
        `radicale_startup_exception_class=${record.restoreRadicaleStartupExceptionClass}`,
        `radicale_startup_errno=${record.restoreRadicaleStartupErrno}`,
        `radicale_startup_path_bucket=${record.restoreRadicaleStartupPathBucket}`,
      );
    }
    if (
      RESTORE_RADICALE_FILESYSTEM_FIELDS.every((key) =>
        Object.hasOwn(record, key),
      )
    ) {
      fields.push('radicale_probe_mount=readonly');
      for (const key of RESTORE_RADICALE_FILESYSTEM_FIELDS) {
        const label = key
          .replace(/^restoreRadicale/u, '')
          .replace(/[A-Z]/gu, (letter) => `_${letter.toLowerCase()}`)
          .replace(/^_/u, '')
          .toLowerCase();
        fields.push(`radicale_${label}=${record[key]}`);
      }
    }
    const phaseBooleans = PHASE_BOOLEAN_FIELDS.get(phase) ?? [];
    for (const key of phaseBooleans) {
      if (Object.hasOwn(record, key)) {
        const outputKey = key.replace(
          /[A-Z]/gu,
          (letter) => `_${letter.toLowerCase()}`,
        );
        fields.push(`${outputKey}=${record[key]}`);
      }
    }
    for (const key of G6_NUMERIC_FIELDS_BY_PHASE.get(phase) ?? []) {
      if (
        key === 'httpStatus' ||
        key === 'count' ||
        !Object.hasOwn(record, key)
      ) {
        continue;
      }
      const outputKey = key.replace(
        /[A-Z]/gu,
        (letter) => `_${letter.toLowerCase()}`,
      );
      fields.push(`${outputKey}=${record[key]}`);
    }
    for (const key of G6_ENUM_FIELDS_BY_PHASE.get(phase) ?? []) {
      if (!Object.hasOwn(record, key)) continue;
      const outputKey = key.replace(
        /[A-Z]/gu,
        (letter) => `_${letter.toLowerCase()}`,
      );
      fields.push(`${outputKey}=${record[key]}`);
    }
    for (const key of G6_POSTSAVE_ENUM_FIELDS) {
      if (!Object.hasOwn(record, key)) continue;
      const outputKey = key.replace(
        /[A-Z]/gu,
        (letter) => `_${letter.toLowerCase()}`,
      );
      fields.push(`${outputKey}=${record[key]}`);
    }
    for (const key of G6_POSTSAVE_BOOLEAN_FIELDS) {
      if (!Object.hasOwn(record, key)) continue;
      const outputKey = key.replace(
        /[A-Z]/gu,
        (letter) => `_${letter.toLowerCase()}`,
      );
      fields.push(`${outputKey}=${record[key]}`);
    }
    lines.push(fields.join(' '));
  }
  return `${lines.join('\n')}\n`;
}

function main() {
  const stageFile =
    process.argv[2] ?? process.env.ELEMENT_ACCEPTANCE_STAGE_FILE;
  const sourceSha =
    process.argv[3] ?? process.env.ELEMENT_ACCEPTANCE_SOURCE_SHA;
  const input = stageFile ? readFileSync(stageFile, 'utf8') : '';
  const summary = sanitizeElementAcceptance(input, sourceSha);

  process.stdout.write(summary);

  const summaryFile = process.env.ELEMENT_ACCEPTANCE_SUMMARY_FILE;
  if (summaryFile) writeFileSync(summaryFile, summary, { mode: 0o600 });

  const stepSummary = process.env.GITHUB_STEP_SUMMARY;
  if (stepSummary) {
    writeFileSync(stepSummary, `\n\`\`\`text\n${summary}\`\`\`\n`, {
      flag: 'a',
    });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    process.stdout.write(
      formatSanitizerFailureSummary(
        error,
        process.argv[3] ?? process.env.ELEMENT_ACCEPTANCE_SOURCE_SHA,
      ),
    );
    process.stderr.write('Element acceptance summary unavailable.\n');
    process.exitCode = 1;
  }
}
