import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyRadicaleStartupLogs,
  createRadicaleFilesystemEvidence,
} from './element-acceptance-reminder-restore.mjs';
import {
  formatSanitizerFailureSummary,
  sanitizeElementAcceptance,
} from './sanitize-element-acceptance.mjs';

const sourceSha = 'a'.repeat(40);

function projectionDiagnosticCounts(overrides = {}) {
  return {
    'invalid-recurrence': 0,
    'invalid-timing': 0,
    'occurrence-limit': 0,
    'recurrence-input-limit': 0,
    'unsupported-recurrence': 0,
    'unsupported-timezone': 0,
    'range-this-and-future': 0,
    ...overrides,
  };
}

function reminderConfigurationObservation(overrides = {}) {
  return {
    phase: 'reminder-room-configuration-enabled',
    status: 'passed',
    httpStatus: 200,
    count: 1,
    reminderEnabled: true,
    reminderStep: 'complete',
    notifyButtonCount: 1,
    notifyButtonVisible: true,
    reminderOptionsGetCount: 1,
    reminderOptionsGetStatus: 200,
    reminderConfigGetCount: 1,
    reminderConfigGetStatus: 200,
    reminderEligibleOptionCount: 1,
    reminderOptionCheckedBefore: false,
    reminderOptionCheckAttempted: true,
    reminderPutCount: 1,
    reminderPutStatus: 200,
    reminderOptionCheckedAfter: true,
    ...overrides,
  };
}

function missingReminderOptionObservation() {
  return {
    phase: 'reminder-room-configuration-enabled',
    status: 'failed',
    httpStatus: 200,
    reminderEnabled: false,
    reminderStep: 'eligible-option',
    notifyButtonCount: 1,
    notifyButtonVisible: true,
    reminderOptionsGetCount: 1,
    reminderOptionsGetStatus: 200,
    reminderConfigGetCount: 1,
    reminderConfigGetStatus: 200,
    reminderEligibleOptionCount: 0,
    reminderOptionCheckedBefore: false,
    reminderOptionCheckAttempted: false,
    reminderPutCount: 0,
    reminderPutStatus: 0,
    reminderOptionCheckedAfter: false,
  };
}

function radicaleFilesystemEvidence(overrides = {}) {
  return {
    restoreRadicaleSourceProbeAvailable: true,
    restoreRadicaleFilesystemProbeAvailable: true,
    restoreRadicalePythonVersion: '3.13.13',
    restoreRadicalePythonVersionMatchesSource: true,
    restoreRadicaleRuntimeMatchesAccount: true,
    restoreRadicaleDataUidMatchesSource: true,
    restoreRadicaleDataGidMatchesSource: true,
    restoreRadicaleDataModeMatchesSource: true,
    restoreRadicaleCollectionsUidMatchesSource: true,
    restoreRadicaleCollectionsGidMatchesSource: true,
    restoreRadicaleCollectionsModeMatchesSource: true,
    restoreRadicaleDataRootReadable: true,
    restoreRadicaleDataRootSearchable: true,
    restoreRadicaleCollectionsRootReadable: true,
    restoreRadicaleCollectionsRootSearchable: true,
    restoreRadicaleCollectionTreeComplete: true,
    restoreRadicaleCollectionEntryCount: 4,
    restoreRadicaleCollectionReadSearchFailureCount: 0,
    ...overrides,
  };
}

function radicaleFilesystemProbe(overrides = {}) {
  return {
    pythonVersion: '3.13.13',
    runtimeOwner: true,
    data: {
      exists: true,
      uid: 1000,
      gid: 1000,
      mode: 0o755,
      readable: true,
      searchable: true,
    },
    collections: {
      exists: true,
      uid: 1000,
      gid: 1000,
      mode: 0o700,
      readable: true,
      searchable: true,
    },
    tree: { complete: true, entries: 4, accessFailures: 0 },
    ...overrides,
  };
}

function postCreateVisibilityObservation(overrides = {}) {
  return {
    phase: 'event-create-post-refresh-observed',
    status: 'passed',
    postCreateEventGetRequestCount: 2,
    roomTargetRangeRequestCount: 1,
    expectedRoomRangeRequestSeen: true,
    roomTargetRangeResponseCount: 1,
    roomTargetRangeLastStatus: 200,
    createResponseHasEvent: true,
    createResponseTitleMatches: true,
    createResponseCalendarMatches: true,
    createResponseTimingComparable: true,
    createResponseEventIntersectsRoomRange: true,
    caldavReportProbeCompleted: true,
    caldavOpenIdHttpStatus: 200,
    caldavReportHttpStatus: 207,
    caldavReportContainsCreatedEvent: true,
    caldavProjection: {
      completed: true,
      includesCreatedEvent: true,
      diagnosticCode: 'none',
      diagnosticCounts: projectionDiagnosticCounts(),
      timezoneAudit: {
        completed: true,
        parsedEventUnsupportedTimezone: false,
        bundledZoneId: true,
        embeddedDefinitionCount: 0,
        canonicalEmbeddedDefinitionMatches: null,
        classification: 'no-embedded-definition',
      },
    },
    roomListResponseHasEventsArray: true,
    roomListResponseEventCount: 1,
    roomListDiagnostics: {
      complete: true,
      counts: projectionDiagnosticCounts(),
    },
    roomListResponseTitleMatches: true,
    roomListResponseIdMatches: true,
    roomListResponseCalendarMatches: true,
    listViewHeadingPresent: true,
    matchingListItemCount: 1,
    ...overrides,
  };
}

function validRuntimeObservation(overrides = {}) {
  return {
    phase: 'widget-a-runtime-observed',
    status: 'passed',
    gatewayContextRequestCount: 0,
    gatewayCalendarsRequestCount: 0,
    gatewayEventsRequestCount: 0,
    gatewayOtherCalendarRequestCount: 0,
    gatewayOtherApiRequestCount: 0,
    gatewayOptionsRequestCount: 0,
    gatewayFailedRequestCount: 0,
    gatewayLastRequestEndpoint: 'none',
    gatewayLastRequestMethod: 'NONE',
    gatewayLastResponseEndpoint: 'none',
    gatewayLastResponseMethod: 'NONE',
    widgetDocumentRequestCount: 0,
    widgetScriptRequestCount: 0,
    widgetStylesheetRequestCount: 0,
    widgetDocumentFailureCount: 0,
    widgetScriptFailureCount: 0,
    widgetStylesheetFailureCount: 0,
    openIdRequestCount: 0,
    openIdOptionsRequestCount: 0,
    openIdFailedRequestCount: 0,
    openIdLastRequestMethod: 'NONE',
    widgetFrameAvailable: true,
    widgetDocumentReadyState: 'complete',
    widgetRootHasChildren: false,
    widgetLoadingVisible: false,
    widgetMissingCapabilitiesVisible: false,
    widgetRegistrationErrorVisible: false,
    widgetOutsideClientVisible: false,
    widgetChildErrorVisible: false,
    widgetPageErrorCount: 0,
    widgetLastPageErrorClass: 'NONE',
    widgetApiParentObserverAvailable: false,
    widgetApiGetOpenIdRequestCount: 0,
    widgetApiRequestSourceMatches: false,
    widgetApiRequestOriginMatches: false,
    widgetApiRequestWidgetIdMatches: false,
    widgetApiInitialResponseCount: 0,
    widgetApiInitialResponseState: 'none',
    widgetApiInitialResponseSourceMatches: false,
    widgetApiInitialResponseOriginMatches: false,
    widgetApiInitialResponseWidgetIdMatches: false,
    widgetApiFollowupCount: 0,
    widgetApiFollowupState: 'none',
    widgetApiFollowupRequestIdMatches: false,
    widgetApiFollowupSourceMatches: false,
    widgetApiFollowupOriginMatches: false,
    widgetApiFollowupWidgetIdMatches: false,
    widgetParametersObserved: false,
    widgetGatewayBaseOriginMatches: false,
    widgetRoomIdMatches: false,
    widgetIdParameterPresent: false,
    calendarEventsLoadingVisible: false,
    calendarEventsLoadErrorVisible: false,
    createEventEnabled: false,
    iframeObservationAvailable: true,
    iframeGatewayBaseOriginMatches: true,
    iframeRoomIdMatches: true,
    createEventVisible: false,
    identityContinueVisible: false,
    ...overrides,
  };
}

test('emits only fixed phase names, outcomes, and source SHA', () => {
  const summary = sanitizeElementAcceptance(
    [
      JSON.stringify({ phase: 'accounts-ready', status: 'passed', count: 3 }),
      JSON.stringify({
        phase: 'outsider-room-widget-team-target',
        status: 'passed',
        httpStatus: 403,
        teamRoomMatches: true,
      }),
      JSON.stringify({
        phase: 'outsider-room-events-api-team-target',
        status: 'passed',
        httpStatus: 403,
      }),
      JSON.stringify({
        phase: 'outsider-own-unbound-room',
        status: 'passed',
        httpStatus: 404,
      }),
      JSON.stringify({
        phase: 'stale-etag-conflict',
        status: 'passed',
        httpStatus: 409,
      }),
    ].join('\n'),
    sourceSha,
  );

  assert.equal(
    summary,
    [
      `element-acceptance source_sha=${sourceSha}`,
      'phase=accounts-ready status=passed count=3',
      'phase=outsider-room-widget-team-target status=passed http_status=403 team_room_matches=true',
      'phase=outsider-room-events-api-team-target status=passed http_status=403',
      'phase=outsider-own-unbound-room status=passed http_status=404',
      'phase=stale-etag-conflict status=passed http_status=409',
      '',
    ].join('\n'),
  );
});

test('summarizes reminder restore gates without exposing backup fingerprints or row counters', () => {
  const privateChecksum = 'b'.repeat(64);
  const summary = sanitizeElementAcceptance(
    [
      JSON.stringify({
        phase: 'service-room-ready',
        status: 'passed',
        serviceUserJoined: true,
        powerPolicyVerified: true,
      }),
      JSON.stringify({
        phase: 'reminder-delivery-snapshot',
        status: 'passed',
        count: 1,
        attemptCount: 2,
        deliveryStateSent: true,
        deliveryClaimClear: true,
      }),
      JSON.stringify({
        phase: 'restore-quiesced',
        status: 'passed',
        count: 4,
        gatewayStoppedGracefully: true,
        radicaleStoppedGracefully: true,
        oomFree: true,
      }),
      JSON.stringify({
        phase: 'restore-radicale-backup',
        status: 'passed',
        checksum: privateChecksum,
      }),
      JSON.stringify({
        phase: 'restore-targets-prepared',
        status: 'passed',
        freshVolume: true,
        freshDatabase: true,
        restoreStep: 'complete',
        restoreVolumeExists: false,
        restoreDatabaseExists: false,
        restoreTargetPlanSafe: true,
        restoreVolumeCreated: true,
        restoreVolumeEmpty: true,
        restoreDatabaseCreated: true,
        restoreArchiveExtracted: true,
        restoreArchiveEntryCount: 2,
        restoreArchiveCountProbeValid: true,
        restorePostgresRestored: true,
      }),
      JSON.stringify({
        phase: 'restore-delivery-row',
        status: 'passed',
        count: 1,
        attemptCount: 2,
        deliveryStateSent: true,
        deliveryClaimClear: true,
        deliveryKeyUnchanged: true,
        attemptCountUnchanged: true,
      }),
    ].join('\n'),
    sourceSha,
  );

  assert.match(summary, /service_user_joined=true power_policy_verified=true/u);
  assert.match(summary, /gateway_stopped_gracefully=true/u);
  assert.match(
    summary,
    /phase=restore-targets-prepared status=passed restore_step=complete restore_volume_exists=false restore_database_exists=false restore_target_plan_safe=true restore_volume_created=true restore_volume_empty=true restore_database_created=true restore_archive_extracted=true restore_archive_entry_count=2 restore_archive_count_probe_valid=true restore_postgres_restored=true fresh_volume=true fresh_database=true/u,
  );
  assert.match(
    summary,
    /delivery_key_unchanged=true attempt_count_unchanged=true/u,
  );
  assert.doesNotMatch(summary, /b{64}|attempt_count=2/u);
});

test('reports only an allowlisted rejection category and phase when a summary is invalid', () => {
  let failure;
  try {
    sanitizeElementAcceptance(
      JSON.stringify({
        phase: 'restore-targets-prepared',
        status: 'failed',
        restoreStep: 'private-value',
        credential: 'never-emit-this',
      }),
      sourceSha,
    );
  } catch (error) {
    failure = error;
  }

  assert.equal(failure.category, 'invalid-stage-record');
  assert.equal(failure.phase, 'restore-targets-prepared');
  assert.equal(
    formatSanitizerFailureSummary(failure, sourceSha),
    `element-acceptance source_sha=${sourceSha}\nphase=summary status=unavailable category=invalid-stage-record rejected_phase=restore-targets-prepared\n`,
  );
  assert.doesNotMatch(
    formatSanitizerFailureSummary(failure, sourceSha),
    /private-value|never-emit-this|credential/u,
  );
  const unexpectedFailure = Object.assign(
    new Error('secret-bearing exception detail'),
    { category: 'private-label', phase: 'private-phase' },
  );
  assert.equal(
    formatSanitizerFailureSummary(unexpectedFailure, sourceSha),
    `element-acceptance source_sha=${sourceSha}\nphase=summary status=unavailable category=summary-unavailable rejected_phase=unknown\n`,
  );
  let malformedRecord;
  try {
    sanitizeElementAcceptance('{not-json', sourceSha);
  } catch (error) {
    malformedRecord = error;
  }
  assert.equal(malformedRecord.category, 'invalid-stage-json');
  assert.equal(malformedRecord.phase, 'unknown');
});

test('emits bounded restore target failure details without raw command output', () => {
  const summary = sanitizeElementAcceptance(
    JSON.stringify({
      phase: 'restore-targets-prepared',
      status: 'failed',
      restoreStep: 'volume-create',
      restoreVolumeExists: false,
      restoreDatabaseExists: false,
      restoreTargetPlanSafe: true,
      restoreVolumeCreated: false,
      processExitCode: 1,
    }),
    sourceSha,
  );

  assert.match(
    summary,
    /phase=restore-targets-prepared status=failed restore_step=volume-create restore_volume_exists=false restore_database_exists=false restore_target_plan_safe=true restore_volume_created=false process_exit_code=1/u,
  );
  assert.doesNotMatch(summary, /volume name|database name|stderr|password/u);
});

test('distinguishes an empty restored volume from an invalid entry-count probe', () => {
  const invalidProbe = sanitizeElementAcceptance(
    JSON.stringify({
      phase: 'restore-targets-prepared',
      status: 'failed',
      restoreStep: 'restored-volume-count',
      restoreVolumeExists: false,
      restoreDatabaseExists: false,
      restoreTargetPlanSafe: true,
      restoreVolumeCreated: true,
      restoreVolumeEmpty: true,
      restoreDatabaseCreated: true,
      restoreArchiveExtracted: true,
      restoreArchiveCountProbeValid: false,
    }),
    sourceSha,
  );
  const emptyVolume = sanitizeElementAcceptance(
    JSON.stringify({
      phase: 'restore-targets-prepared',
      status: 'failed',
      restoreStep: 'restored-volume-count',
      restoreVolumeExists: false,
      restoreDatabaseExists: false,
      restoreTargetPlanSafe: true,
      restoreVolumeCreated: true,
      restoreVolumeEmpty: true,
      restoreDatabaseCreated: true,
      restoreArchiveExtracted: true,
      restoreArchiveEntryCount: 0,
      restoreArchiveCountProbeValid: true,
    }),
    sourceSha,
  );

  assert.match(invalidProbe, /restore_archive_count_probe_valid=false/u);
  assert.doesNotMatch(invalidProbe, /restore_archive_entry_count=/u);
  assert.match(
    emptyVolume,
    /restore_archive_entry_count=0 restore_archive_count_probe_valid=true/u,
  );
});

test('requires UI, Matrix delivery, and timeline evidence for reminder recovery', () => {
  const summary = sanitizeElementAcceptance(
    [
      JSON.stringify({
        phase: 'reminder-widget-context',
        status: 'passed',
        httpStatus: 200,
        canManageReminders: true,
      }),
      JSON.stringify(reminderConfigurationObservation()),
      JSON.stringify({
        phase: 'reminder-configuration-stored',
        status: 'passed',
        count: 1,
      }),
      JSON.stringify({
        phase: 'reminder-event-created',
        status: 'passed',
        httpStatus: 201,
      }),
      JSON.stringify({
        phase: 'reminder-event-visible',
        status: 'passed',
        httpStatus: 201,
        count: 1,
      }),
      JSON.stringify({
        phase: 'reminder-alarm-ui-readback',
        status: 'passed',
        count: 1,
        relativeAlarmReadback: true,
      }),
      JSON.stringify({
        phase: 'reminder-ui-readback',
        status: 'passed',
        count: 1,
        relativeAlarmReadback: true,
        reminderEnabled: true,
      }),
      JSON.stringify({
        phase: 'reminder-initial-delivery',
        status: 'passed',
        httpStatus: 200,
        count: 1,
        canaryDelivered: true,
        roomMentioned: true,
        deliveredAfterDue: true,
        allMarkersOnce: true,
      }),
      JSON.stringify({
        phase: 'reminder-restart-prior-state',
        status: 'passed',
        httpStatus: 200,
        count: 1,
        allMarkersOnce: true,
      }),
      JSON.stringify({
        phase: 'reminder-restart-scheduler-scan',
        status: 'passed',
        httpStatus: 200,
        count: 2,
        canaryDelivered: true,
        roomMentioned: true,
        deliveredAfterDue: true,
        allMarkersOnce: true,
      }),
      JSON.stringify({
        phase: 'reminder-restart-no-duplicate',
        status: 'passed',
        httpStatus: 200,
        count: 2,
        allMarkersOnce: true,
      }),
      JSON.stringify({
        phase: 'reminder-restore-prior-state',
        status: 'passed',
        httpStatus: 200,
        count: 2,
        allMarkersOnce: true,
      }),
      JSON.stringify({
        phase: 'reminder-restore-scheduler-scan',
        status: 'passed',
        httpStatus: 200,
        count: 3,
        canaryDelivered: true,
        roomMentioned: true,
        deliveredAfterDue: true,
        allMarkersOnce: true,
      }),
      JSON.stringify({
        phase: 'reminder-restore-no-duplicate',
        status: 'passed',
        httpStatus: 200,
        count: 3,
        allMarkersOnce: true,
      }),
      JSON.stringify({
        phase: 'reminder-browser-egress',
        status: 'passed',
        count: 0,
      }),
    ].join('\n'),
    sourceSha,
  );

  assert.match(
    summary,
    /phase=reminder-event-visible status=passed http_status=201 count=1/u,
  );
  assert.match(
    summary,
    /phase=reminder-widget-context status=passed http_status=200 can_manage_reminders=true/u,
  );
  assert.match(
    summary,
    /phase=reminder-room-configuration-enabled status=passed reminder_step=complete notify_button_count=1 notify_button_visible=true options_get_count=1 options_http_status=200 configuration_get_count=1 configuration_http_status=200 eligible_option_count=1 option_checked_before=false option_check_attempted=true put_count=1 put_http_status=200 option_checked_after=true/u,
  );
  assert.match(
    summary,
    /phase=reminder-initial-delivery status=passed http_status=200 count=1 canary_delivered=true room_mentioned=true delivered_after_due=true all_markers_once=true/u,
  );
  assert.match(
    summary,
    /phase=reminder-restart-scheduler-scan status=passed http_status=200 count=2/u,
  );
  assert.match(
    summary,
    /phase=reminder-restore-scheduler-scan status=passed http_status=200 count=3/u,
  );
  assert.match(summary, /phase=reminder-browser-egress status=passed count=0/u);

  for (const record of [
    {
      phase: 'reminder-event-visible',
      status: 'passed',
      count: 1,
    },
    {
      phase: 'reminder-room-configuration-enabled',
      status: 'passed',
      httpStatus: 200,
      count: 1,
      reminderEnabled: true,
    },
    {
      phase: 'reminder-event-visible',
      status: 'passed',
      httpStatus: 201,
      count: 0,
    },
    {
      phase: 'reminder-restart-scheduler-scan',
      status: 'passed',
      count: 2,
      canaryDelivered: true,
      roomMentioned: true,
      deliveredAfterDue: true,
      allMarkersOnce: true,
    },
    {
      phase: 'reminder-restore-no-duplicate',
      status: 'passed',
      httpStatus: 200,
      count: 2,
      allMarkersOnce: true,
    },
    {
      phase: 'reminder-ui-readback',
      status: 'passed',
      count: 1,
      relativeAlarmReadback: true,
      reminderEnabled: false,
    },
    {
      phase: 'reminder-initial-delivery',
      status: 'passed',
      httpStatus: 200,
      count: 1,
      canaryDelivered: true,
      roomMentioned: true,
      deliveredAfterDue: false,
      allMarkersOnce: true,
    },
    {
      phase: 'reminder-initial-delivery',
      status: 'failed',
      httpStatus: 403,
      count: 1,
      eventTitle: 'Reminder acceptance private marker',
    },
    reminderConfigurationObservation({ reminderOptionsGetStatus: 999 }),
    reminderConfigurationObservation({ reminderPutCount: 3 }),
    reminderConfigurationObservation({ accessToken: 'private-test-token' }),
  ]) {
    assert.throws(
      () => sanitizeElementAcceptance(JSON.stringify(record), sourceSha),
      /invalid element acceptance summary/u,
    );
  }
});

test('sanitizes the fixed reminder option failure boundary', () => {
  const summary = sanitizeElementAcceptance(
    JSON.stringify(missingReminderOptionObservation()),
    sourceSha,
  );
  assert.match(
    summary,
    /phase=reminder-room-configuration-enabled status=failed reminder_step=eligible-option notify_button_count=1 notify_button_visible=true options_get_count=1 options_http_status=200 configuration_get_count=1 configuration_http_status=200 eligible_option_count=0 option_checked_before=false option_check_attempted=false put_count=0 put_http_status=0 option_checked_after=false/u,
  );
  assert.doesNotMatch(summary, /https?:|access_token|event_id|error_text/iu);
});

test('keeps a successful context status distinct from reminder capability', () => {
  const summary = sanitizeElementAcceptance(
    JSON.stringify({
      phase: 'reminder-widget-context',
      status: 'failed',
      httpStatus: 200,
      canManageReminders: false,
    }),
    sourceSha,
  );
  assert.match(
    summary,
    /phase=reminder-widget-context status=failed http_status=200 can_manage_reminders=false/u,
  );
  assert.throws(
    () =>
      sanitizeElementAcceptance(
        JSON.stringify({
          phase: 'reminder-widget-context',
          status: 'passed',
          httpStatus: 200,
          canManageReminders: false,
        }),
        sourceSha,
      ),
    /invalid element acceptance summary/u,
  );
});

test('rejects incomplete or inconsistent restore evidence', () => {
  for (const record of [
    {
      phase: 'restore-quiesced',
      status: 'passed',
      count: 3,
      gatewayStoppedGracefully: true,
      radicaleStoppedGracefully: true,
      oomFree: true,
    },
    {
      phase: 'restore-targets-prepared',
      status: 'passed',
      freshVolume: true,
      freshDatabase: false,
    },
    {
      phase: 'restore-delivery-row',
      status: 'passed',
      count: 1,
      attemptCount: 1,
      deliveryStateSent: true,
      deliveryClaimClear: true,
      deliveryKeyUnchanged: false,
      attemptCountUnchanged: true,
    },
    {
      phase: 'restore-radicale-backup',
      status: 'passed',
      checksum: 'not-a-fingerprint',
    },
    {
      phase: 'restore-delivery-row',
      status: 'failed',
      password: 'private-value',
    },
  ]) {
    assert.throws(
      () => sanitizeElementAcceptance(JSON.stringify(record), sourceSha),
      /invalid element acceptance summary/u,
    );
  }
});

test('requires exact outsider denial status and expected widget room context', () => {
  for (const record of [
    {
      phase: 'outsider-room-widget-team-target',
      status: 'passed',
      httpStatus: 403,
      teamRoomMatches: false,
    },
    {
      phase: 'outsider-room-widget-team-target',
      status: 'passed',
      httpStatus: 200,
      teamRoomMatches: true,
    },
    {
      phase: 'outsider-room-events-api-team-target',
      status: 'passed',
      httpStatus: 200,
    },
    {
      phase: 'outsider-own-unbound-room',
      status: 'passed',
      httpStatus: 403,
    },
  ]) {
    assert.throws(
      () => sanitizeElementAcceptance(JSON.stringify(record), sourceSha),
      /invalid element acceptance summary/u,
    );
  }
});

test('emits bounded event creation steps and keeps response status numeric', () => {
  const summary = sanitizeElementAcceptance(
    [
      JSON.stringify({ phase: 'event-create-dialog', status: 'passed' }),
      JSON.stringify({
        phase: 'event-create-calendar-selected',
        status: 'passed',
      }),
      JSON.stringify({
        phase: 'event-create-title-entered',
        status: 'passed',
      }),
      JSON.stringify({ phase: 'event-create-submit', status: 'passed' }),
      JSON.stringify({
        phase: 'event-create-response',
        status: 'failed',
        httpStatus: 403,
      }),
    ].join('\n'),
    sourceSha,
  );

  assert.equal(
    summary,
    [
      `element-acceptance source_sha=${sourceSha}`,
      'phase=event-create-dialog status=passed',
      'phase=event-create-calendar-selected status=passed',
      'phase=event-create-title-entered status=passed',
      'phase=event-create-submit status=passed',
      'phase=event-create-response status=failed http_status=403',
      '',
    ].join('\n'),
  );

  assert.throws(
    () =>
      sanitizeElementAcceptance(
        JSON.stringify({
          phase: 'event-create-title-entered',
          status: 'passed',
          eventTitle: 'not retained',
        }),
        sourceSha,
      ),
    /invalid element acceptance summary/u,
  );
});

test('emits only bounded post-create refresh and event-match evidence', () => {
  const summary = sanitizeElementAcceptance(
    JSON.stringify(postCreateVisibilityObservation()),
    sourceSha,
  );

  assert.equal(
    summary,
    [
      `element-acceptance source_sha=${sourceSha}`,
      'phase=event-create-post-refresh-observed status=passed post_create_event_get_requests=2 room_target_range_requests=1 expected_room_range_request_seen=true room_target_range_responses=1 room_target_range_last_status=200 create_response_has_event=true create_response_title_matches=true create_response_calendar_matches=true create_response_timing_comparable=true create_response_event_intersects_room_range=true caldav_report_probe_completed=true caldav_openid_http_status=200 caldav_report_http_status=207 caldav_report_contains_created_event=true caldav_projection_completed=true caldav_projection_includes_created_event=true caldav_projection_diagnostic=none caldav_projection_invalid-recurrence=0 caldav_projection_invalid-timing=0 caldav_projection_occurrence-limit=0 caldav_projection_recurrence-input-limit=0 caldav_projection_unsupported-recurrence=0 caldav_projection_unsupported-timezone=0 caldav_projection_range-this-and-future=0 timezone_audit_completed=true timezone_event_unsupported=false timezone_source_id_bundled=true timezone_embedded_definitions=0 timezone_embedded_definition_matches=inconclusive timezone_audit_classification=no-embedded-definition room_list_response_has_events=true room_list_response_event_count=1 room_list_diagnostics_complete=true room_list_diagnostic_invalid-recurrence=0 room_list_diagnostic_invalid-timing=0 room_list_diagnostic_occurrence-limit=0 room_list_diagnostic_recurrence-input-limit=0 room_list_diagnostic_unsupported-recurrence=0 room_list_diagnostic_unsupported-timezone=0 room_list_diagnostic_range-this-and-future=0 room_list_response_title_matches=true room_list_response_id_matches=true room_list_response_calendar_matches=true list_view_heading_present=true matching_list_item_count=1',
      '',
    ].join('\n'),
  );

  for (const invalid of [
    postCreateVisibilityObservation({ eventId: 'private-id' }),
    postCreateVisibilityObservation({ matchingListItemCount: 3 }),
    postCreateVisibilityObservation({
      expectedRoomRangeRequestSeen: false,
      roomTargetRangeRequestCount: 0,
    }),
    postCreateVisibilityObservation({
      roomTargetRangeResponseCount: 0,
      roomTargetRangeLastStatus: 200,
    }),
    postCreateVisibilityObservation({
      createResponseHasEvent: false,
      createResponseTimingComparable: true,
    }),
    postCreateVisibilityObservation({
      createResponseTimingComparable: false,
      createResponseEventIntersectsRoomRange: true,
    }),
    postCreateVisibilityObservation({
      caldavReportProbeCompleted: false,
      caldavReportContainsCreatedEvent: true,
    }),
    postCreateVisibilityObservation({
      caldavReportProbeCompleted: false,
      caldavReportContainsCreatedEvent: false,
    }),
    postCreateVisibilityObservation({
      caldavOpenIdHttpStatus: 403,
      caldavReportHttpStatus: 207,
    }),
    postCreateVisibilityObservation({
      caldavReportProbeCompleted: true,
      caldavOpenIdHttpStatus: 200,
      caldavReportHttpStatus: null,
    }),
    postCreateVisibilityObservation({
      caldavProjection: {
        completed: true,
        includesCreatedEvent: true,
        diagnosticCode: 'invalid-calendar',
        diagnosticCounts: projectionDiagnosticCounts(),
        timezoneAudit: {
          completed: true,
          parsedEventUnsupportedTimezone: false,
          bundledZoneId: true,
          embeddedDefinitionCount: 0,
          canonicalEmbeddedDefinitionMatches: null,
          classification: 'no-embedded-definition',
        },
      },
    }),
    postCreateVisibilityObservation({
      caldavProjection: {
        completed: true,
        includesCreatedEvent: false,
        diagnosticCode: 'unsupported-timezone',
        diagnosticCounts: projectionDiagnosticCounts({
          'unsupported-timezone': 1,
        }),
        timezoneAudit: {
          completed: true,
          parsedEventUnsupportedTimezone: false,
          bundledZoneId: true,
          embeddedDefinitionCount: 1,
          canonicalEmbeddedDefinitionMatches: false,
          classification: 'embedded-definition-mismatch',
        },
      },
    }),
    postCreateVisibilityObservation({
      caldavProjection: {
        completed: true,
        includesCreatedEvent: false,
        diagnosticCode: 'none',
        diagnosticCounts: projectionDiagnosticCounts({ 'invalid-timing': 3 }),
        timezoneAudit: {
          completed: true,
          parsedEventUnsupportedTimezone: false,
          bundledZoneId: true,
          embeddedDefinitionCount: 0,
          canonicalEmbeddedDefinitionMatches: null,
          classification: 'no-embedded-definition',
        },
      },
    }),
    postCreateVisibilityObservation({
      roomListDiagnostics: {
        complete: false,
        counts: projectionDiagnosticCounts({ 'invalid-timing': 1 }),
      },
    }),
    postCreateVisibilityObservation({
      caldavProjection: {
        completed: true,
        includesCreatedEvent: true,
        diagnosticCode: 'none',
        diagnosticCounts: projectionDiagnosticCounts(),
        timezoneAudit: {
          completed: true,
          parsedEventUnsupportedTimezone: false,
          bundledZoneId: true,
          embeddedDefinitionCount: 1,
          canonicalEmbeddedDefinitionMatches: false,
          classification: 'embedded-definition-mismatch',
        },
      },
    }),
    postCreateVisibilityObservation({
      roomListDiagnostics: {
        complete: true,
        counts: {
          ...projectionDiagnosticCounts(),
          private: 1,
        },
      },
    }),
  ]) {
    assert.throws(
      () => sanitizeElementAcceptance(JSON.stringify(invalid), sourceSha),
      /invalid element acceptance summary/u,
    );
  }
});

test('labels an incomplete REPORT comparison as inconclusive', () => {
  const summary = sanitizeElementAcceptance(
    JSON.stringify(
      postCreateVisibilityObservation({
        caldavReportProbeCompleted: false,
        caldavOpenIdHttpStatus: 200,
        caldavReportHttpStatus: 207,
        caldavReportContainsCreatedEvent: null,
      }),
    ),
    sourceSha,
  );

  assert.match(
    summary,
    /caldav_report_probe_completed=false caldav_openid_http_status=200 caldav_report_http_status=207 caldav_report_contains_created_event=inconclusive/u,
  );
});

test('emits only the fixed timezone projection diagnosis', () => {
  const summary = sanitizeElementAcceptance(
    JSON.stringify(
      postCreateVisibilityObservation({
        caldavProjection: {
          completed: true,
          includesCreatedEvent: false,
          diagnosticCode: 'unsupported-timezone',
          diagnosticCounts: projectionDiagnosticCounts({
            'unsupported-timezone': 1,
          }),
          timezoneAudit: {
            completed: true,
            parsedEventUnsupportedTimezone: true,
            bundledZoneId: true,
            embeddedDefinitionCount: 1,
            canonicalEmbeddedDefinitionMatches: false,
            classification: 'embedded-definition-mismatch',
          },
        },
      }),
    ),
    sourceSha,
  );

  assert.match(
    summary,
    /caldav_projection_diagnostic=unsupported-timezone[\s\S]*timezone_event_unsupported=true timezone_source_id_bundled=true timezone_embedded_definitions=1 timezone_embedded_definition_matches=false timezone_audit_classification=embedded-definition-mismatch/u,
  );
});

test('accepts a canonical embedded timezone audit', () => {
  const summary = sanitizeElementAcceptance(
    JSON.stringify(
      postCreateVisibilityObservation({
        caldavProjection: {
          completed: true,
          includesCreatedEvent: true,
          diagnosticCode: 'none',
          diagnosticCounts: projectionDiagnosticCounts(),
          timezoneAudit: {
            completed: true,
            parsedEventUnsupportedTimezone: false,
            bundledZoneId: true,
            embeddedDefinitionCount: 1,
            canonicalEmbeddedDefinitionMatches: true,
            classification: 'embedded-definition-matches',
          },
        },
      }),
    ),
    sourceSha,
  );

  assert.match(
    summary,
    /timezone_embedded_definition_matches=true timezone_audit_classification=embedded-definition-matches/u,
  );
});

test('emits bounded setup substeps and numeric failure details', () => {
  const summary = sanitizeElementAcceptance(
    [
      JSON.stringify({
        phase: 'member-a-registration',
        status: 'failed',
        failureCode: 'docker-command-failed',
        processExitCode: 1,
      }),
      JSON.stringify({
        phase: 'member-a-login',
        status: 'failed',
        failureCode: 'matrix-http-failed',
        httpStatus: 401,
      }),
    ].join('\n'),
    sourceSha,
  );

  assert.equal(
    summary,
    [
      `element-acceptance source_sha=${sourceSha}`,
      'phase=member-a-registration status=failed failure_code=docker-command-failed process_exit_code=1',
      'phase=member-a-login status=failed http_status=401 failure_code=matrix-http-failed',
      '',
    ].join('\n'),
  );
});

test('emits bounded member A navigation and session observations', () => {
  const summary = sanitizeElementAcceptance(
    [
      JSON.stringify({
        phase: 'member-a-origin-navigation',
        status: 'passed',
        httpStatus: 404,
        originMatchesElement: true,
      }),
      JSON.stringify({
        phase: 'member-a-credentials-seeded',
        status: 'passed',
      }),
      JSON.stringify({
        phase: 'member-a-root-navigation',
        status: 'passed',
        httpStatus: 200,
      }),
      JSON.stringify({
        phase: 'member-a-session-observed',
        status: 'passed',
        matrixClientHookPresent: true,
        matrixClientPresent: true,
        matrixUserMatches: false,
        matrixSyncState: 'SYNCING',
      }),
      JSON.stringify({
        phase: 'member-a-authenticated',
        status: 'failed',
      }),
    ].join('\n'),
    sourceSha,
  );

  assert.equal(
    summary,
    [
      `element-acceptance source_sha=${sourceSha}`,
      'phase=member-a-origin-navigation status=passed http_status=404 origin_matches_element=true',
      'phase=member-a-credentials-seeded status=passed',
      'phase=member-a-root-navigation status=passed http_status=200',
      'phase=member-a-session-observed status=passed matrix_client_hook_present=true matrix_client_present=true matrix_user_matches=false matrix_sync_state=SYNCING',
      'phase=member-a-authenticated status=failed',
      '',
    ].join('\n'),
  );
});

test('emits bounded room, widget, identity, and gateway readiness steps', () => {
  const summary = sanitizeElementAcceptance(
    [
      JSON.stringify({ phase: 'member-a-room-navigation', status: 'passed' }),
      JSON.stringify({
        phase: 'member-a-room-context',
        status: 'passed',
        matrixUserMatches: true,
        matrixRoomKnown: true,
        matrixRoomJoined: true,
        matrixSyncState: 'SYNCING',
        roomNavigationCompleted: true,
        roomHeadingReady: true,
        roomHeadingPresent: true,
        roomNameMatches: true,
        roomIdMatches: true,
        blockedExternalRequestCount: 0,
        homeserverHttpErrorCount: 0,
      }),
      JSON.stringify({
        phase: 'widget-a-room-info-button',
        status: 'passed',
        count: 1,
        controlVisible: true,
      }),
      JSON.stringify({
        phase: 'widget-a-extensions-menuitem',
        status: 'passed',
        count: 1,
        controlVisible: true,
        panelPresent: true,
      }),
      JSON.stringify({
        phase: 'widget-a-extension-row',
        status: 'passed',
        count: 1,
        controlVisible: true,
        panelPresent: true,
      }),
      JSON.stringify({
        phase: 'widget-a-warning-not-required',
        status: 'passed',
      }),
      JSON.stringify({
        phase: 'widget-a-capabilities-approval',
        status: 'passed',
      }),
      JSON.stringify({
        phase: 'widget-a-identity-dialog-observed',
        status: 'passed',
      }),
      JSON.stringify({
        phase: 'widget-a-identity-approval',
        status: 'passed',
      }),
      JSON.stringify({
        phase: 'widget-a-iframe-attached',
        status: 'passed',
      }),
      JSON.stringify({
        phase: 'gateway-backed-read',
        status: 'failed',
        httpStatus: 403,
      }),
      JSON.stringify({
        phase: 'widget-a-iframe-ready',
        status: 'failed',
      }),
      JSON.stringify({
        phase: 'member-b-room-context',
        status: 'passed',
      }),
      JSON.stringify({
        phase: 'widget-a-identity-dialog-not-required',
        status: 'passed',
      }),
    ].join('\n'),
    sourceSha,
  );

  assert.equal(
    summary,
    [
      `element-acceptance source_sha=${sourceSha}`,
      'phase=member-a-room-navigation status=passed',
      'phase=member-a-room-context status=passed matrix_user_matches=true matrix_room_known=true matrix_room_joined=true matrix_sync_state=SYNCING room_navigation_completed=true room_heading_ready=true room_heading_present=true room_name_matches=true room_id_matches=true blocked_external_request_count=0 homeserver_http_error_count=0',
      'phase=widget-a-room-info-button status=passed count=1 control_visible=true',
      'phase=widget-a-extensions-menuitem status=passed count=1 control_visible=true panel_present=true',
      'phase=widget-a-extension-row status=passed count=1 control_visible=true panel_present=true',
      'phase=widget-a-warning-not-required status=passed',
      'phase=widget-a-capabilities-approval status=passed',
      'phase=widget-a-identity-dialog-observed status=passed',
      'phase=widget-a-identity-approval status=passed',
      'phase=widget-a-iframe-attached status=passed',
      'phase=gateway-backed-read status=failed http_status=403',
      'phase=widget-a-iframe-ready status=failed',
      'phase=member-b-room-context status=passed',
      'phase=widget-a-identity-dialog-not-required status=passed',
      '',
    ].join('\n'),
  );
});

test('emits bounded widget, gateway, and OpenID observations only', () => {
  const summary = sanitizeElementAcceptance(
    JSON.stringify(
      validRuntimeObservation({
        gatewayContextRequestCount: 1,
        gatewayCalendarsRequestCount: 2,
        gatewayOptionsRequestCount: 1,
        gatewayLastRequestEndpoint: 'calendars',
        gatewayLastRequestMethod: 'GET',
        gatewayLastResponseEndpoint: 'calendars',
        gatewayLastResponseMethod: 'GET',
        gatewayLastResponseStatus: 200,
        widgetDocumentRequestCount: 1,
        widgetScriptRequestCount: 2,
        widgetStylesheetRequestCount: 1,
        widgetScriptFailureCount: 1,
        widgetDocumentLastStatus: 200,
        widgetScriptLastStatus: 404,
        widgetStylesheetLastStatus: 200,
        openIdRequestCount: 1,
        openIdLastRequestMethod: 'GET',
        openIdLastResponseStatus: 200,
        widgetRootHasChildren: true,
        widgetPageErrorCount: 1,
        widgetLastPageErrorClass: 'TypeError',
      }),
    ),
    sourceSha,
  );

  assert.equal(
    summary,
    [
      `element-acceptance source_sha=${sourceSha}`,
      'phase=widget-a-runtime-observed status=passed gateway_context_requests=1 gateway_calendars_requests=2 gateway_events_requests=0 gateway_other_calendar_requests=0 gateway_other_api_requests=0 gateway_options_requests=1 gateway_failed_requests=0 gateway_last_request_endpoint=calendars gateway_last_request_method=GET gateway_last_response_endpoint=calendars gateway_last_response_method=GET gateway_last_response_status=200 widget_document_last_status=200 widget_script_last_status=404 widget_stylesheet_last_status=200 openid_last_response_status=200 widget_document_requests=1 widget_script_requests=2 widget_stylesheet_requests=1 widget_document_failures=0 widget_script_failures=1 widget_stylesheet_failures=0 openid_requests=1 openid_options_requests=0 openid_failed_requests=0 openid_last_request_method=GET widget_api_parent_observer_available=false widget_api_get_openid_requests=0 widget_api_request_source_matches=false widget_api_request_origin_matches=false widget_api_request_widget_id_matches=false widget_api_initial_response_count=0 widget_api_initial_response_state=none widget_api_initial_response_source_matches=false widget_api_initial_response_origin_matches=false widget_api_initial_response_widget_id_matches=false widget_api_followup_count=0 widget_api_followup_state=none widget_api_followup_request_id_matches=false widget_api_followup_source_matches=false widget_api_followup_origin_matches=false widget_api_followup_widget_id_matches=false widget_parameters_observed=false widget_gateway_base_origin_matches=false widget_room_id_matches=false widget_id_parameter_present=false widget_frame_available=true widget_document_ready_state=complete widget_root_has_children=true widget_loading_visible=false widget_missing_capabilities_visible=false widget_registration_error_visible=false widget_outside_client_visible=false widget_child_error_visible=false calendar_events_loading_visible=false calendar_events_load_error_visible=false widget_page_errors=1 widget_last_page_error_class=TypeError iframe_observation_available=true iframe_gateway_base_origin_matches=true iframe_room_id_matches=true create_event_visible=false create_event_enabled=false identity_continue_visible=false',
      '',
    ].join('\n'),
  );
});

test('emits only allowlisted Widget API OpenID states and match booleans', () => {
  const summary = sanitizeElementAcceptance(
    JSON.stringify(
      validRuntimeObservation({
        widgetApiGetOpenIdRequestCount: 1,
        widgetApiParentObserverAvailable: true,
        widgetApiRequestSourceMatches: true,
        widgetApiRequestOriginMatches: true,
        widgetApiRequestWidgetIdMatches: true,
        widgetApiInitialResponseCount: 1,
        widgetApiInitialResponseState: 'request',
        widgetApiInitialResponseSourceMatches: true,
        widgetApiInitialResponseOriginMatches: true,
        widgetApiInitialResponseWidgetIdMatches: true,
        widgetApiFollowupCount: 1,
        widgetApiFollowupState: 'allowed',
        widgetApiFollowupRequestIdMatches: true,
        widgetApiFollowupSourceMatches: true,
        widgetApiFollowupOriginMatches: true,
        widgetApiFollowupWidgetIdMatches: true,
        widgetParametersObserved: true,
        widgetGatewayBaseOriginMatches: true,
        widgetRoomIdMatches: true,
        widgetIdParameterPresent: true,
        calendarEventsLoadingVisible: false,
        calendarEventsLoadErrorVisible: false,
        createEventVisible: true,
        createEventEnabled: true,
      }),
    ),
    sourceSha,
  );

  assert.match(
    summary,
    /widget_api_initial_response_state=request widget_api_initial_response_source_matches=true/u,
  );
  assert.match(
    summary,
    /widget_api_followup_state=allowed widget_api_followup_request_id_matches=true/u,
  );
  assert.match(
    summary,
    /widget_parameters_observed=true widget_gateway_base_origin_matches=true widget_room_id_matches=true widget_id_parameter_present=true/u,
  );
  assert.match(summary, /create_event_visible=true create_event_enabled=true/u);
  assert.doesNotMatch(summary, /access_token|request-id-value|room-id-value/iu);
});

test('constrains runtime observations to bounded enums, counts, and booleans', () => {
  const validObservation = validRuntimeObservation({
    gatewayContextRequestCount: 1,
    gatewayCalendarsRequestCount: 1,
    gatewayLastRequestEndpoint: 'calendars',
    gatewayLastRequestMethod: 'GET',
    gatewayLastResponseEndpoint: 'calendars',
    gatewayLastResponseMethod: 'GET',
    gatewayLastResponseStatus: 200,
  });
  const rejectedRecords = [
    { ...validObservation, gatewayEventsRequestCount: 3 },
    {
      ...validObservation,
      gatewayLastRequestEndpoint: 'https://private.example/path?token=x',
    },
    {
      ...validObservation,
      gatewayLastResponseStatus: '200 private response',
    },
    {
      ...validObservation,
      iframeRoomIdMatches: '!private-room:server',
    },
    { ...validObservation, requestUrl: 'http://private.example' },
    { ...validObservation, openIdLastRequestMethod: '/openid?token=x' },
    { ...validObservation, widgetDocumentReadyState: '/private/path' },
    { ...validObservation, widgetLastPageErrorClass: 'TypeError: secret' },
    { ...validObservation, widgetPageErrorCount: 1 },
    { ...validObservation, widgetApiInitialResponseState: 'allowed token=x' },
    {
      ...validObservation,
      widgetApiInitialResponseCount: 1,
      widgetApiInitialResponseState: 'request',
      requestId: 'sensitive-request-id',
    },
    { ...validObservation, accessToken: 'sensitive-token' },
    { ...validObservation, widgetApiFollowupCount: 3 },
    { ...validObservation, widgetScriptFailureCount: 2 },
    { ...validObservation, widgetDocumentLastStatus: 404 },
    { ...validObservation, openIdLastResponseStatus: 401 },
    {
      ...validObservation,
      phase: 'gateway-backed-read',
    },
    {
      ...validObservation,
      status: 'unavailable',
    },
  ];

  for (const record of rejectedRecords) {
    assert.throws(
      () => sanitizeElementAcceptance(JSON.stringify(record), sourceSha),
      { message: 'invalid element acceptance summary' },
    );
  }

  assert.doesNotThrow(() =>
    sanitizeElementAcceptance(
      JSON.stringify({
        ...validObservation,
        status: 'unavailable',
        gatewayLastRequestEndpoint: 'none',
        gatewayLastRequestMethod: 'NONE',
        gatewayLastResponseEndpoint: 'none',
        gatewayLastResponseMethod: 'NONE',
        gatewayLastResponseStatus: undefined,
        iframeObservationAvailable: false,
        iframeGatewayBaseOriginMatches: false,
        iframeRoomIdMatches: false,
      }),
      sourceSha,
    ),
  );

  assert.doesNotThrow(() =>
    sanitizeElementAcceptance(
      JSON.stringify({
        ...validObservation,
        openIdRequestCount: 1,
        openIdLastRequestMethod: 'POST',
      }),
      sourceSha,
    ),
  );
});

test('emits and constrains pinned widget-control failure observations', () => {
  const summary = sanitizeElementAcceptance(
    JSON.stringify({
      phase: 'widget-a-extension-row',
      status: 'failed',
      count: 0,
      controlVisible: false,
      panelPresent: true,
    }),
    sourceSha,
  );

  assert.equal(
    summary,
    [
      `element-acceptance source_sha=${sourceSha}`,
      'phase=widget-a-extension-row status=failed count=0 control_visible=false panel_present=true',
      '',
    ].join('\n'),
  );
  const duplicateControlSummary = sanitizeElementAcceptance(
    JSON.stringify({
      phase: 'widget-a-room-info-button',
      status: 'failed',
      count: 2,
      controlVisible: true,
    }),
    sourceSha,
  );
  assert.equal(
    duplicateControlSummary,
    [
      `element-acceptance source_sha=${sourceSha}`,
      'phase=widget-a-room-info-button status=failed count=2 control_visible=true',
      '',
    ].join('\n'),
  );
  assert.throws(
    () =>
      sanitizeElementAcceptance(
        JSON.stringify({
          phase: 'widget-a-extension-row',
          status: 'failed',
          count: 0,
          controlVisible: false,
          panelPresent: true,
          widgetName: 'private label',
        }),
        sourceSha,
      ),
    /invalid element acceptance summary/u,
  );
  assert.throws(
    () =>
      sanitizeElementAcceptance(
        JSON.stringify({
          phase: 'widget-a-extensions-menuitem',
          status: 'failed',
          count: 0,
          controlVisible: false,
        }),
        sourceSha,
      ),
    /invalid element acceptance summary/u,
  );
  assert.throws(
    () =>
      sanitizeElementAcceptance(
        JSON.stringify({
          phase: 'widget-a-room-info-button',
          status: 'failed',
          count: 3,
          controlVisible: true,
        }),
        sourceSha,
      ),
    /invalid element acceptance summary/u,
  );
});

test('emits bounded Element room state and rejects private-shaped values', () => {
  const roomObservation = {
    phase: 'member-a-room-context',
    status: 'failed',
    failureCode: 'element-room-not-known',
    matrixUserMatches: true,
    matrixRoomKnown: false,
    matrixRoomJoined: false,
    matrixSyncState: 'UNKNOWN',
    roomNavigationCompleted: true,
    roomHeadingReady: false,
    roomHeadingPresent: false,
    roomNameMatches: false,
    roomIdMatches: true,
    blockedExternalRequestCount: 0,
    homeserverHttpErrorCount: 1,
    homeserverLastHttpErrorStatus: 500,
  };
  assert.equal(
    sanitizeElementAcceptance(JSON.stringify(roomObservation), sourceSha),
    [
      `element-acceptance source_sha=${sourceSha}`,
      'phase=member-a-room-context status=failed matrix_user_matches=true matrix_room_known=false matrix_room_joined=false matrix_sync_state=UNKNOWN room_navigation_completed=true room_heading_ready=false room_heading_present=false room_name_matches=false room_id_matches=true blocked_external_request_count=0 homeserver_http_error_count=1 homeserver_last_http_error_status=500 failure_code=element-room-not-known',
      '',
    ].join('\n'),
  );

  const reminderRoomObservation = {
    ...roomObservation,
    phase: 'reminder-room-context',
    failureCode: 'element-room-heading-wait-timeout',
    roomViewPresent: true,
    roomHeaderPresent: false,
    roomHeadingDomPresent: false,
    roomInfoControlPresent: false,
    fixtureCalendarIframePresent: false,
    reminderWidgetContextResponseCount: 0,
  };
  const incompleteRoomLayoutObservation = { ...reminderRoomObservation };
  delete incompleteRoomLayoutObservation.fixtureCalendarIframePresent;
  assert.equal(
    sanitizeElementAcceptance(
      JSON.stringify(reminderRoomObservation),
      sourceSha,
    ),
    [
      `element-acceptance source_sha=${sourceSha}`,
      'phase=reminder-room-context status=failed matrix_user_matches=true matrix_room_known=false matrix_room_joined=false matrix_sync_state=UNKNOWN room_navigation_completed=true room_heading_ready=false room_heading_present=false room_name_matches=false room_id_matches=true room_view_present=true room_header_present=false room_heading_dom_present=false room_info_control_present=false fixture_calendar_iframe_present=false reminder_widget_context_response_count=0 blocked_external_request_count=0 homeserver_http_error_count=1 homeserver_last_http_error_status=500 failure_code=element-room-heading-wait-timeout',
      '',
    ].join('\n'),
  );
  const deniedWidgetContext = sanitizeElementAcceptance(
    JSON.stringify({
      ...reminderRoomObservation,
      reminderWidgetContextResponseCount: 1,
      reminderWidgetContextResponseStatus: 403,
    }),
    sourceSha,
  );
  assert.match(
    deniedWidgetContext,
    /reminder_widget_context_response_count=1 reminder_widget_context_response_status=403/u,
  );
  const missingWidgetContextStatus = { ...reminderRoomObservation };
  missingWidgetContextStatus.reminderWidgetContextResponseCount = 1;

  const invalidRecords = [
    { ...roomObservation, matrixUserMatches: '@member:private-server' },
    { ...roomObservation, matrixSyncState: 'token=secret' },
    { ...roomObservation, roomIdMatches: '!private-room:server' },
    { ...roomObservation, homeserverLastHttpErrorStatus: '500 /sync?token=x' },
    { ...roomObservation, failureCode: 'room name: private meeting' },
    { ...roomObservation, roomName: 'private meeting' },
    { ...roomObservation, roomViewPresent: true },
    incompleteRoomLayoutObservation,
    { ...reminderRoomObservation, roomInfoControlPresent: 'present' },
    { ...reminderRoomObservation, reminderWidgetContextResponseCount: 2 },
    missingWidgetContextStatus,
    {
      ...reminderRoomObservation,
      reminderWidgetContextResponseStatus: 403,
    },
    { ...roomObservation, reminderWidgetContextResponseCount: 0 },
  ];
  for (const record of invalidRecords) {
    assert.throws(() =>
      sanitizeElementAcceptance(JSON.stringify(record), sourceSha),
    );
  }
});

test('preserves reminder context response evidence when room observation is unavailable', () => {
  const summary = sanitizeElementAcceptance(
    JSON.stringify({
      phase: 'reminder-room-context',
      status: 'failed',
      failureCode: 'element-room-observation-unavailable',
      reminderWidgetContextResponseCount: 0,
    }),
    sourceSha,
  );

  assert.equal(
    summary,
    [
      `element-acceptance source_sha=${sourceSha}`,
      'phase=reminder-room-context status=failed reminder_widget_context_response_count=0 failure_code=element-room-observation-unavailable',
      '',
    ].join('\n'),
  );
});

test('keeps an unavailable Matrix session sample non-gating and empty', () => {
  const summary = sanitizeElementAcceptance(
    JSON.stringify({
      phase: 'member-a-session-observed',
      status: 'unavailable',
    }),
    sourceSha,
  );

  assert.equal(
    summary,
    `element-acceptance source_sha=${sourceSha}\nphase=member-a-session-observed status=unavailable\n`,
  );
});

test('rejects session details outside the fixed observation schema', () => {
  const rejectedRecords = [
    {
      phase: 'member-a-session-observed',
      status: 'passed',
      matrixClientHookPresent: true,
      matrixClientPresent: true,
      matrixUserMatches: true,
      matrixSyncState: '@member:private-server',
    },
    {
      phase: 'member-a-authenticated',
      status: 'passed',
      matrixClientHookPresent: true,
      matrixClientPresent: true,
      matrixUserMatches: true,
      matrixSyncState: 'SYNCING',
    },
    {
      phase: 'member-a-origin-navigation',
      status: 'passed',
      httpStatus: 200,
      originMatchesElement: 'https://private.example',
    },
    {
      phase: 'member-a-session-observed',
      status: 'passed',
      matrixClientHookPresent: true,
      matrixClientPresent: true,
      matrixUserMatches: true,
    },
    {
      phase: 'member-a-session-observed',
      status: 'unavailable',
      matrixClientHookPresent: false,
    },
  ];

  for (const record of rejectedRecords) {
    assert.throws(
      () => sanitizeElementAcceptance(JSON.stringify(record), sourceSha),
      { message: 'invalid element acceptance summary' },
    );
  }
});

test('emits allowlisted gateway container state without exposing its error text', () => {
  const summary = sanitizeElementAcceptance(
    JSON.stringify({
      phase: 'gateway-ready',
      status: 'failed',
      failureCode: 'gateway-matrix-connect-failed',
      containerState: 'exited',
      containerHealth: 'none',
      containerExitCode: 1,
      containerOomKilled: false,
      containerRuntimeErrorPresent: true,
    }),
    sourceSha,
  );

  assert.equal(
    summary,
    [
      `element-acceptance source_sha=${sourceSha}`,
      'phase=gateway-ready status=failed failure_code=gateway-matrix-connect-failed container_state=exited container_health=none container_exit_code=1 container_oom_killed=false container_runtime_error_present=true',
      '',
    ].join('\n'),
  );
});

test('emits only fixed Radicale readiness state after an unanswered probe', () => {
  const summary = sanitizeElementAcceptance(
    JSON.stringify({
      phase: 'restore-radicale-ready',
      status: 'failed',
      restoreRadicaleProbeOutcome: 'no-response',
      restoreRadicaleContainerHttpOutcome: 'http-status',
      restoreRadicaleContainerHttpStatus: 401,
      restoreRadicalePublishedPortBinding: 'loopback-5233',
      containerState: 'running',
      containerHealth: 'none',
      containerOomKilled: false,
      containerRuntimeErrorPresent: false,
    }),
    sourceSha,
  );

  assert.equal(
    summary,
    [
      `element-acceptance source_sha=${sourceSha}`,
      'phase=restore-radicale-ready status=failed container_state=running container_health=none container_oom_killed=false container_runtime_error_present=false restore_radicale_probe_outcome=no-response radicale_container_http_outcome=http-status radicale_published_port_binding=loopback-5233 radicale_container_http_status=401',
      '',
    ].join('\n'),
  );

  const unavailableListenerSummary = sanitizeElementAcceptance(
    JSON.stringify({
      phase: 'restore-radicale-ready',
      status: 'failed',
      restoreRadicaleProbeOutcome: 'no-response',
      restoreRadicaleContainerHttpOutcome: 'unavailable',
      restoreRadicalePublishedPortBinding: 'other',
      containerState: 'running',
      containerHealth: 'none',
      containerOomKilled: false,
      containerRuntimeErrorPresent: false,
    }),
    sourceSha,
  );
  assert.match(
    unavailableListenerSummary,
    /radicale_container_http_outcome=unavailable radicale_published_port_binding=other/u,
  );

  assert.throws(() =>
    sanitizeElementAcceptance(
      JSON.stringify({
        phase: 'restore-radicale-ready',
        status: 'failed',
        restoreRadicaleProbeOutcome: 'no-response',
        restoreRadicaleContainerHttpOutcome: 'no-response',
        restoreRadicaleContainerHttpStatus: 401,
        restoreRadicalePublishedPortBinding: 'loopback-5233',
        containerState: 'running',
        containerHealth: 'none',
        containerOomKilled: false,
        containerRuntimeErrorPresent: false,
      }),
      sourceSha,
    ),
  );

  const httpStatusSummary = sanitizeElementAcceptance(
    JSON.stringify({
      phase: 'restore-radicale-ready',
      status: 'failed',
      httpStatus: 503,
      restoreRadicaleProbeOutcome: 'http-status',
      containerState: 'exited',
      containerHealth: 'none',
      containerExitCode: 1,
      containerOomKilled: false,
      containerRuntimeErrorPresent: true,
    }),
    sourceSha,
  );
  assert.match(
    httpStatusSummary,
    /phase=restore-radicale-ready status=failed http_status=503 container_state=exited container_health=none container_exit_code=1 container_oom_killed=false container_runtime_error_present=true restore_radicale_probe_outcome=http-status/u,
  );

  const redirectReadinessSummary = sanitizeElementAcceptance(
    JSON.stringify({
      phase: 'restore-radicale-ready',
      status: 'passed',
      httpStatus: 302,
    }),
    sourceSha,
  );
  assert.equal(
    redirectReadinessSummary,
    `element-acceptance source_sha=${sourceSha}\nphase=restore-radicale-ready status=passed http_status=302\n`,
  );
  assert.throws(() =>
    sanitizeElementAcceptance(
      JSON.stringify({
        phase: 'restore-radicale-ready',
        status: 'passed',
        httpStatus: 301,
      }),
      sourceSha,
    ),
  );
});

test('classifies only fixed Radicale startup signatures and sanitizes the evidence', () => {
  const rawLog =
    'An exception occurred during server startup: Radicale OpenID homeserver URL is invalid; token=private-value';
  const evidence = classifyRadicaleStartupLogs(rawLog);
  assert.deepEqual(evidence, {
    restoreRadicaleStartupSignature: 'plugin-config-invalid',
    restoreRadicaleLogsAvailable: true,
    restoreRadicaleStartupExceptionPresent: true,
    restoreRadicaleReadyMarkerPresent: false,
    restoreRadicaleStartupExceptionClass: 'other',
    restoreRadicaleStartupErrno: 'none',
    restoreRadicaleStartupPathBucket: 'none',
  });
  assert.equal(JSON.stringify(evidence).includes('private-value'), false);

  const sourceProbe = radicaleFilesystemProbe();
  const restoredProbe = radicaleFilesystemProbe();
  const filesystemEvidence = createRadicaleFilesystemEvidence(
    sourceProbe,
    restoredProbe,
  );
  assert.deepEqual(filesystemEvidence, radicaleFilesystemEvidence());

  const summary = sanitizeElementAcceptance(
    JSON.stringify({
      phase: 'restore-radicale-ready',
      status: 'failed',
      restoreRadicaleProbeOutcome: 'no-response',
      containerState: 'exited',
      containerHealth: 'none',
      containerExitCode: 1,
      containerOomKilled: false,
      containerRuntimeErrorPresent: false,
      ...evidence,
      ...filesystemEvidence,
    }),
    sourceSha,
  );
  assert.match(summary, /radicale_startup_signature=plugin-config-invalid/u);
  assert.match(summary, /radicale_logs_available=true/u);
  assert.match(summary, /radicale_startup_exception_present=true/u);
  assert.match(summary, /radicale_ready_marker_present=false/u);
  assert.match(summary, /radicale_startup_exception_class=other/u);
  assert.match(summary, /radicale_startup_errno=none/u);
  assert.match(summary, /radicale_startup_path_bucket=none/u);
  assert.match(summary, /radicale_python_version=3\.13\.13/u);
  assert.match(summary, /radicale_runtime_matches_account=true/u);
  assert.match(summary, /radicale_probe_mount=readonly/u);
  assert.match(summary, /radicale_collections_root_readable=true/u);
  assert.match(summary, /radicale_collections_root_searchable=true/u);
  assert.equal(summary.includes('writable'), false);
  assert.equal(summary.includes('private-value'), false);

  const metadataMismatch = createRadicaleFilesystemEvidence(
    sourceProbe,
    radicaleFilesystemProbe({
      pythonVersion: '3.14.0',
      collections: {
        ...restoredProbe.collections,
        uid: 1001,
        readable: false,
      },
      tree: { complete: false, entries: 4, accessFailures: 1 },
    }),
  );
  assert.equal(
    metadataMismatch.restoreRadicalePythonVersionMatchesSource,
    false,
  );
  assert.equal(
    metadataMismatch.restoreRadicaleCollectionsUidMatchesSource,
    false,
  );
  assert.equal(metadataMismatch.restoreRadicaleCollectionsRootReadable, false);
  assert.equal(metadataMismatch.restoreRadicaleCollectionTreeComplete, false);
  assert.equal(
    metadataMismatch.restoreRadicaleCollectionReadSearchFailureCount,
    1,
  );

  const unavailableTargetEvidence = createRadicaleFilesystemEvidence(
    sourceProbe,
    undefined,
  );
  assert.equal(
    unavailableTargetEvidence.restoreRadicaleFilesystemProbeAvailable,
    false,
  );
  assert.equal(
    unavailableTargetEvidence.restoreRadicaleCollectionEntryCount,
    0,
  );
  assert.throws(
    () =>
      sanitizeElementAcceptance(
        JSON.stringify({
          phase: 'restore-radicale-ready',
          status: 'failed',
          restoreRadicaleProbeOutcome: 'no-response',
          containerState: 'exited',
          containerHealth: 'none',
          ...evidence,
          ...unavailableTargetEvidence,
          restoreRadicaleCollectionEntryCount: 1,
        }),
        sourceSha,
      ),
    { message: 'invalid element acceptance summary' },
  );

  const filesystemHint = classifyRadicaleStartupLogs(
    "An exception occurred during server startup: PermissionError: [Errno 13] Permission denied: '/data/collections/private-name'",
  );
  assert.equal(
    filesystemHint.restoreRadicaleStartupExceptionClass,
    'permission-error',
  );
  assert.equal(filesystemHint.restoreRadicaleStartupErrno, 'eacces');
  assert.equal(filesystemHint.restoreRadicaleStartupPathBucket, 'collections');
  assert.equal(JSON.stringify(filesystemHint).includes('private-name'), false);
  const filesystemHintSummary = sanitizeElementAcceptance(
    JSON.stringify({
      phase: 'restore-radicale-ready',
      status: 'failed',
      restoreRadicaleProbeOutcome: 'no-response',
      containerState: 'exited',
      containerHealth: 'none',
      ...filesystemHint,
    }),
    sourceSha,
  );
  assert.match(filesystemHintSummary, /radicale_startup_errno=eacces/u);
  assert.match(
    filesystemHintSummary,
    /radicale_startup_path_bucket=collections/u,
  );
  assert.equal(filesystemHintSummary.includes('private-name'), false);

  assert.deepEqual(classifyRadicaleStartupLogs('unrecognized startup output'), {
    restoreRadicaleStartupSignature: 'unclassified',
    restoreRadicaleLogsAvailable: true,
    restoreRadicaleStartupExceptionPresent: false,
    restoreRadicaleReadyMarkerPresent: false,
    restoreRadicaleStartupExceptionClass: 'none',
    restoreRadicaleStartupErrno: 'none',
    restoreRadicaleStartupPathBucket: 'none',
  });
  assert.deepEqual(classifyRadicaleStartupLogs(undefined), {
    restoreRadicaleStartupSignature: 'unavailable',
    restoreRadicaleLogsAvailable: false,
    restoreRadicaleStartupExceptionPresent: false,
    restoreRadicaleReadyMarkerPresent: false,
    restoreRadicaleStartupExceptionClass: 'unavailable',
    restoreRadicaleStartupErrno: 'unavailable',
    restoreRadicaleStartupPathBucket: 'unavailable',
  });

  const signatures = [
    ['Invalid configuration: secret=/private/path', 'invalid-configuration'],
    ['No servers started', 'no-listener'],
    [
      "cannot create server socket on '/private/address': address in use",
      'bind-failed',
    ],
    [
      "cannot retrieve IPv4 or IPv6 address of '/private/address': failed",
      'address-resolution-failed',
    ],
    [
      "An exception occurred during server startup: PermissionError: [Errno 13] Permission denied: '/private/path'; token=private-value",
      'filesystem-permission',
    ],
    [
      "An exception occurred during server startup: OSError: [Errno 30] Read-only file system: '/private/path'",
      'filesystem-readonly',
    ],
    [
      "An exception occurred during server startup: FileNotFoundError: [Errno 2] No such file or directory: '/private/path'",
      'filesystem-missing-path',
    ],
    [
      "An exception occurred during server startup: ModuleNotFoundError: No module named 'private-module'",
      'module-import-failed',
    ],
    [
      'An exception occurred during server startup: private exception text',
      'startup-exception',
    ],
  ];
  for (const [logText, expectedSignature] of signatures) {
    const classified = classifyRadicaleStartupLogs(logText);
    assert.equal(classified.restoreRadicaleStartupSignature, expectedSignature);
    assert.equal(JSON.stringify(classified).includes('/private'), false);
    assert.equal(JSON.stringify(classified).includes('private-value'), false);
    assert.equal(JSON.stringify(classified).includes('private-module'), false);
  }
  assert.equal(
    classifyRadicaleStartupLogs('Radicale server ready')
      .restoreRadicaleReadyMarkerPresent,
    true,
  );
});

test('emits a missing dependency only when the runtime manifest allowlists it', () => {
  const summary = sanitizeElementAcceptance(
    JSON.stringify({
      phase: 'gateway-ready',
      status: 'failed',
      failureCode: 'gateway-module-load-failed',
      missingModuleKind: 'declared-package',
      missingDependency: '@nestjs/common',
    }),
    sourceSha,
  );

  assert.equal(
    summary,
    [
      `element-acceptance source_sha=${sourceSha}`,
      'phase=gateway-ready status=failed failure_code=gateway-module-load-failed missing_module_kind=declared-package missing_dependency=@nestjs/common',
      '',
    ].join('\n'),
  );
});

test('rejects unlisted module names and missing-module details on other outcomes', () => {
  const rejectedRecords = [
    {
      phase: 'gateway-ready',
      status: 'failed',
      failureCode: 'gateway-module-load-failed',
      missingModuleKind: 'declared-package',
      missingDependency: 'private-token-value',
    },
    {
      phase: 'gateway-ready',
      status: 'failed',
      failureCode: 'gateway-module-load-failed',
      missingModuleKind: 'relative-or-file',
      missingDependency: '/app/private/path',
    },
    {
      phase: 'widget-ready',
      status: 'failed',
      failureCode: 'gateway-module-load-failed',
      missingModuleKind: 'unknown',
    },
  ];

  for (const record of rejectedRecords) {
    assert.throws(
      () => sanitizeElementAcceptance(JSON.stringify(record), sourceSha),
      { message: 'invalid element acceptance summary' },
    );
  }
});

test('labels configured service tags and observed browser and runner versions', () => {
  const summary = sanitizeElementAcceptance(
    JSON.stringify({
      phase: 'runtime-versions',
      status: 'passed',
      elementWebConfiguredTag: 'v1.12.30',
      synapseConfiguredTag: 'v1.161.0',
      radicaleConfiguredTag: '3.8.0.0',
      chromiumVersion: '140.0.7339.80',
      runnerOS: 'linux',
      runnerOSVersion: '6.8.0-1027-azure',
      runnerArchitecture: 'x64',
      nodeVersion: 'v22.23.3',
    }),
    sourceSha,
  );

  assert.equal(
    summary,
    [
      `element-acceptance source_sha=${sourceSha}`,
      'phase=runtime-versions status=passed element_web_configured_tag=v1.12.30 synapse_configured_tag=v1.161.0 radicale_configured_tag=3.8.0.0 chromium_observed=140.0.7339.80 runner_os=linux kernel_release=6.8.0-1027-azure runner_arch=x64 node_observed=v22.23.3',
      '',
    ].join('\n'),
  );
});

test('rejects unexpected fields without reflecting their values', () => {
  const secret = 'synthetic-secret-that-must-not-be-reported';
  assert.throws(
    () =>
      sanitizeElementAcceptance(
        JSON.stringify({
          phase: 'accounts-ready',
          status: 'failed',
          secret,
        }),
        sourceSha,
      ),
    { message: 'invalid element acceptance summary' },
  );
});

test('rejects invalid phases, HTTP statuses, and source revisions', () => {
  assert.throws(
    () =>
      sanitizeElementAcceptance(
        JSON.stringify({ phase: 'unknown', status: 'passed' }),
        sourceSha,
      ),
    { message: 'invalid element acceptance summary' },
  );
  assert.throws(
    () =>
      sanitizeElementAcceptance(
        JSON.stringify({
          phase: 'stale-etag-conflict',
          status: 'passed',
          httpStatus: 0,
        }),
        sourceSha,
      ),
    { message: 'invalid element acceptance summary' },
  );
  assert.throws(() => sanitizeElementAcceptance('', 'not-a-commit'), {
    message: 'invalid element acceptance summary',
  });
});

test('rejects arbitrary failure labels, invalid exit codes, and untrusted versions', () => {
  const rejectedRecords = [
    {
      phase: 'member-a-registration',
      status: 'failed',
      failureCode: 'password=synthetic-secret',
      processExitCode: 1,
    },
    {
      phase: 'member-a-registration',
      status: 'failed',
      failureCode: 'docker-command-failed',
      processExitCode: 256,
    },
    {
      phase: 'runtime-versions',
      status: 'passed',
      elementWebConfiguredTag: 'v1.12.30',
      synapseConfiguredTag: 'v1.161.0',
      radicaleConfiguredTag: '3.8.0.0',
      chromiumVersion: '140.0.7339.80 token=secret',
      runnerOS: 'linux',
      runnerOSVersion: '6.8.0-1027-azure',
      runnerArchitecture: 'x64',
      nodeVersion: 'v22.23.3',
    },
  ];

  for (const record of rejectedRecords) {
    assert.throws(
      () => sanitizeElementAcceptance(JSON.stringify(record), sourceSha),
      { message: 'invalid element acceptance summary' },
    );
  }
});

test('emits only fixed blocked-request classifications on egress failure', () => {
  const summary = sanitizeElementAcceptance(
    JSON.stringify({
      phase: 'browser-egress',
      status: 'failed',
      count: 3,
      blockedRequestDiagnosticOverflow: false,
      blockedRequestDiagnostics: [
        {
          actor: 'member-a',
          harnessPhase: 'member-a-authenticated',
          requestClass: 'external-http-origin',
          resourceType: 'script',
          count: 1,
        },
        {
          actor: 'outsider',
          harnessPhase: 'outsider-room-context',
          requestClass: 'matrix-server-well-known-discovery',
          resourceType: 'fetch',
          count: 2,
        },
      ],
    }),
    sourceSha,
  );

  assert.equal(
    summary,
    [
      `element-acceptance source_sha=${sourceSha}`,
      'phase=browser-egress status=failed count=3 blocked_request_diagnostic_overflow=false blocked_requests=member-a/harness_phase=member-a-authenticated/external-http-origin/script/1,outsider/harness_phase=outsider-room-context/matrix-server-well-known-discovery/fetch/2',
      '',
    ].join('\n'),
  );
  assert.equal(summary.includes('https://'), false);
});

test('rejects malformed or unbounded blocked-request evidence', () => {
  const diagnostic = {
    actor: 'member-a',
    harnessPhase: 'member-a-authenticated',
    requestClass: 'external-http-origin',
    resourceType: 'script',
    count: 1,
  };
  const base = {
    phase: 'browser-egress',
    status: 'failed',
    count: 1,
    blockedRequestDiagnosticOverflow: false,
    blockedRequestDiagnostics: [diagnostic],
  };
  const invalidRecords = [
    {
      ...base,
      blockedRequestDiagnostics: [{ ...diagnostic, target: 'private' }],
    },
    {
      ...base,
      blockedRequestDiagnostics: [{ ...diagnostic, actor: 'private-host' }],
    },
    {
      ...base,
      blockedRequestDiagnostics: [
        { ...diagnostic, harnessPhase: 'private-phase' },
      ],
    },
    {
      ...base,
      blockedRequestDiagnostics: [
        { ...diagnostic, requestClass: 'https://private.example' },
      ],
    },
    {
      ...base,
      blockedRequestDiagnostics: [
        { ...diagnostic, resourceType: 'private-resource' },
      ],
    },
    { ...base, blockedRequestDiagnostics: [{ ...diagnostic, count: 3 }] },
    {
      ...base,
      blockedRequestDiagnostics: [diagnostic, { ...diagnostic }],
      count: 2,
    },
    { ...base, blockedRequestDiagnosticOverflow: true },
    { ...base, count: 0 },
    { ...base, phase: 'member-a-authenticated' },
    { phase: 'browser-egress', status: 'failed', count: 1 },
    { phase: 'browser-egress', status: 'passed', count: 1 },
  ];

  for (const record of invalidRecords) {
    assert.throws(
      () => sanitizeElementAcceptance(JSON.stringify(record), sourceSha),
      { message: 'invalid element acceptance summary' },
    );
  }
});

test('rejects unsafe container diagnostics and diagnostics on other phases', () => {
  const rejectedRecords = [
    {
      phase: 'gateway-ready',
      status: 'failed',
      containerState: 'password=secret',
      containerHealth: 'none',
    },
    {
      phase: 'gateway-ready',
      status: 'failed',
      containerState: 'exited',
      containerHealth: 'none',
      containerExitCode: 256,
    },
    {
      phase: 'gateway-ready',
      status: 'failed',
      containerState: 'exited',
      containerHealth: 'none',
      containerOomKilled: 'no',
    },
    {
      phase: 'gateway-ready',
      status: 'failed',
      containerState: 'exited',
      containerHealth: 'none',
      containerRuntimeErrorPresent: 'no',
    },
    {
      phase: 'widget-ready',
      status: 'failed',
      containerState: 'running',
      containerHealth: 'none',
    },
    {
      phase: 'gateway-ready',
      status: 'failed',
      failureCode: 'startup-output=secret',
      containerState: 'running',
      containerHealth: 'none',
    },
    {
      phase: 'restore-radicale-ready',
      status: 'failed',
      restoreRadicaleProbeOutcome: 'no-response',
      httpStatus: 503,
      containerState: 'running',
      containerHealth: 'none',
    },
    {
      phase: 'restore-radicale-ready',
      status: 'failed',
      restoreRadicaleProbeOutcome: 'http-status',
      containerState: 'running',
      containerHealth: 'none',
    },
    {
      phase: 'restore-radicale-ready',
      status: 'failed',
      restoreRadicaleProbeOutcome: 'no-response',
      containerState: 'exited',
      containerHealth: 'none',
      restoreRadicaleStartupSignature: 'password=secret',
      restoreRadicaleLogsAvailable: true,
      restoreRadicaleStartupExceptionPresent: false,
      restoreRadicaleReadyMarkerPresent: false,
    },
    {
      phase: 'restore-radicale-ready',
      status: 'failed',
      restoreRadicaleProbeOutcome: 'no-response',
      containerState: 'exited',
      containerHealth: 'none',
      ...classifyRadicaleStartupLogs('unrecognized output'),
      ...radicaleFilesystemEvidence({
        restoreRadicalePythonVersion: '3.13.13;token=private',
      }),
    },
    {
      phase: 'restore-radicale-ready',
      status: 'failed',
      restoreRadicaleProbeOutcome: 'no-response',
      containerState: 'exited',
      containerHealth: 'none',
      ...classifyRadicaleStartupLogs('unrecognized output'),
      ...radicaleFilesystemEvidence({ privatePath: '/private/collection' }),
    },
    {
      phase: 'restore-radicale-ready',
      status: 'failed',
      restoreRadicaleProbeOutcome: 'no-response',
      containerState: 'exited',
      containerHealth: 'none',
      ...classifyRadicaleStartupLogs('unrecognized output'),
      restoreRadicaleStartupErrno: '/private/path',
    },
    {
      phase: 'restore-radicale-ready',
      status: 'failed',
      restoreRadicaleProbeOutcome: 'no-response',
      containerState: 'exited',
      containerHealth: 'none',
      ...classifyRadicaleStartupLogs('unrecognized output'),
      ...radicaleFilesystemEvidence({
        restoreRadicaleSourceProbeAvailable: false,
      }),
    },
    {
      phase: 'restore-radicale-ready',
      status: 'failed',
      restoreRadicaleProbeOutcome: 'no-response',
      containerState: 'exited',
      containerHealth: 'none',
      restoreRadicaleStartupSignature: 'unavailable',
      restoreRadicaleLogsAvailable: false,
      restoreRadicaleStartupExceptionPresent: true,
      restoreRadicaleReadyMarkerPresent: false,
    },
    {
      phase: 'restore-radicale-ready',
      status: 'failed',
      restoreRadicaleProbeOutcome: 'no-response',
      containerState: 'exited',
      containerHealth: 'none',
      restoreRadicaleStartupSignature: 'unclassified',
      restoreRadicaleLogsAvailable: true,
      restoreRadicaleStartupExceptionPresent: false,
    },
    {
      phase: 'restore-targets-prepared',
      status: 'failed',
      restoreRadicaleStartupSignature: 'unclassified',
      restoreRadicaleLogsAvailable: true,
      restoreRadicaleStartupExceptionPresent: false,
      restoreRadicaleReadyMarkerPresent: false,
    },
    {
      phase: 'restore-radicale-ready',
      status: 'failed',
      restoreRadicaleProbeOutcome: 'no-response',
    },
    {
      phase: 'gateway-ready',
      status: 'failed',
      restoreRadicaleProbeOutcome: 'no-response',
      containerState: 'running',
      containerHealth: 'none',
    },
  ];

  for (const record of rejectedRecords) {
    assert.throws(
      () => sanitizeElementAcceptance(JSON.stringify(record), sourceSha),
      { message: 'invalid element acceptance summary' },
    );
  }
});

test('formats bounded Element client acceptance evidence', () => {
  const summary = sanitizeElementAcceptance(
    JSON.stringify({
      phase: 'g6-unsupported-preservation',
      status: 'passed',
      projectionHttpStatus: 200,
      canonicalBeforeHttpStatus: 200,
      neighborPatchHttpStatus: 204,
      canonicalAfterHttpStatus: 200,
      count: 1,
      unsupportedWarningVisible: true,
      unsupportedRowOmitted: true,
      supportedNeighborVisible: true,
      canonicalSnapshotAvailable: true,
      supportedNeighborEdited: true,
      canonicalUnsupportedObjectUnchanged: true,
      neighborOwnershipUpdated: true,
      neighborUpdateIdentityMatches: true,
    }),
    sourceSha,
  );

  assert.match(summary, /phase=g6-unsupported-preservation status=passed/u);
  assert.match(summary, /projection_http_status=200/u);
  assert.match(summary, /count=1/u);
  assert.match(summary, /unsupported_warning_visible=true/u);
  assert.doesNotMatch(summary, /title|uid|calendarId|private/u);
});

test('rejects inconsistent Element client acceptance evidence', () => {
  const invalidRecords = [
    {
      phase: 'g6-unsupported-preservation',
      status: 'passed',
      projectionHttpStatus: 200,
      canonicalBeforeHttpStatus: 200,
      neighborPatchHttpStatus: 204,
      canonicalAfterHttpStatus: 200,
      count: 1,
      unsupportedWarningVisible: true,
      unsupportedRowOmitted: true,
      supportedNeighborVisible: true,
      canonicalSnapshotAvailable: true,
      supportedNeighborEdited: true,
      canonicalUnsupportedObjectUnchanged: true,
      neighborOwnershipUpdated: true,
      neighborUpdateIdentityMatches: true,
      eventTitle: 'private event title',
    },
    {
      phase: 'g6-unsupported-preservation',
      status: 'passed',
      projectionHttpStatus: 200,
      canonicalBeforeHttpStatus: 200,
      neighborPatchHttpStatus: 204,
      canonicalAfterHttpStatus: 200,
      count: 1,
      unsupportedWarningVisible: true,
      unsupportedRowOmitted: true,
      supportedNeighborVisible: true,
      canonicalSnapshotAvailable: true,
      supportedNeighborEdited: true,
      canonicalUnsupportedObjectUnchanged: false,
      neighborOwnershipUpdated: true,
      neighborUpdateIdentityMatches: true,
    },
    {
      phase: 'g6-unsupported-preservation',
      status: 'passed',
      projectionHttpStatus: 99,
      canonicalBeforeHttpStatus: 200,
      neighborPatchHttpStatus: 204,
      canonicalAfterHttpStatus: 200,
      count: 1,
      unsupportedWarningVisible: true,
      unsupportedRowOmitted: true,
      supportedNeighborVisible: true,
      canonicalSnapshotAvailable: true,
      supportedNeighborEdited: true,
      canonicalUnsupportedObjectUnchanged: true,
      neighborOwnershipUpdated: true,
      neighborUpdateIdentityMatches: true,
    },
    {
      phase: 'g6-keyboard-focus',
      status: 'passed',
      count: 7,
      eventActionTabCount: 7,
      detailsActionTabCount: 15,
      keyboardEventFocused: true,
      detailsOpened: true,
      editActionFocused: true,
      deleteActionFocused: true,
      closeActionFocused: true,
      escapeClosedDialog: true,
      focusReturnedToEvent: true,
    },
    {
      phase: 'g6-resource-cleanup',
      status: 'passed',
      count: 0,
      plannedCount: 4,
      confirmedCreatedCount: 4,
      conflictCount: 0,
      notCreatedCount: 0,
      createUnresolvedCount: 0,
      deletedCount: 0,
      alreadyAbsentCount: 0,
      cleanupUnresolvedCount: 0,
      allOwnedResourcesRemoved: true,
    },
    {
      phase: 'g6-resource-cleanup',
      status: 'failed',
      count: 0,
      plannedCount: 4,
      confirmedCreatedCount: 0,
      conflictCount: 0,
      notCreatedCount: 0,
      createUnresolvedCount: 0,
      deletedCount: 0,
      alreadyAbsentCount: 0,
      cleanupUnresolvedCount: 0,
      allOwnedResourcesRemoved: true,
    },
    {
      phase: 'g6-widget-layout',
      status: 'passed',
      narrowPanel: true,
      createControlReachable: true,
      eventDetailsReachable: true,
      hostNoHorizontalOverflow: true,
      widgetNoHorizontalOverflow: true,
      pinVisible: true,
      pinEnabled: true,
      pinnedToDrawer: true,
      drawerIframePresent: true,
      maximiseControlVisible: true,
      drawerMaximised: true,
      frameExpanded: true,
      unmaximiseControlVisible: true,
      drawerRestored: true,
      frameReturned: true,
      viewportWidth: 1440,
      viewportHeight: 900,
      iframeWidth: 319,
      iframeHeight: 640,
      pinControlCount: 1,
      drawerIframeWidth: 500,
      drawerIframeHeight: 500,
      maximisedIframeWidth: 1200,
      maximisedIframeHeight: 700,
      restoredIframeWidth: 500,
      restoredIframeHeight: 400,
    },
    {
      phase: 'g6-browser-egress',
      status: 'passed',
      count: 1,
      browserEgressClear: true,
    },
    {
      phase: 'g6-widget-layout',
      status: 'passed',
      narrowPanel: true,
      createControlReachable: true,
      eventDetailsReachable: true,
      hostNoHorizontalOverflow: true,
      widgetNoHorizontalOverflow: true,
      pinVisible: true,
      pinEnabled: true,
      pinnedToDrawer: true,
      drawerIframePresent: true,
      maximiseControlVisible: true,
      drawerMaximised: true,
      frameExpanded: true,
      unmaximiseControlVisible: true,
      drawerRestored: true,
      frameReturned: true,
      viewportWidth: 1440,
      viewportHeight: 900,
      iframeWidth: 319,
      iframeHeight: 640,
      pinControlCount: 2,
      drawerIframeWidth: 500,
      drawerIframeHeight: 500,
      maximisedIframeWidth: 1200,
      maximisedIframeHeight: 700,
      restoredIframeWidth: 500,
      restoredIframeHeight: 500,
    },
  ];

  for (const record of invalidRecords) {
    assert.throws(
      () => sanitizeElementAcceptance(JSON.stringify(record), sourceSha),
      { message: 'invalid element acceptance summary' },
    );
  }
});

test('accepts the compact four-case Element client evidence contract', () => {
  const records = [
    {
      phase: 'g6-fixture-ready',
      status: 'passed',
      httpStatus: 200,
      count: 4,
      openIdProofValid: true,
      allResourcesSeeded: true,
    },
    {
      phase: 'g6-unsupported-preservation',
      status: 'passed',
      projectionHttpStatus: 200,
      canonicalBeforeHttpStatus: 200,
      neighborPatchHttpStatus: 204,
      canonicalAfterHttpStatus: 200,
      count: 1,
      unsupportedWarningVisible: true,
      unsupportedRowOmitted: true,
      supportedNeighborVisible: true,
      canonicalSnapshotAvailable: true,
      supportedNeighborEdited: true,
      canonicalUnsupportedObjectUnchanged: true,
      neighborOwnershipUpdated: true,
      neighborUpdateIdentityMatches: true,
    },
    {
      phase: 'g6-delete-and-refresh',
      status: 'passed',
      memberBEventsHttpStatus: 200,
      deleteHttpStatus: 204,
      canonicalDeleteHttpStatus: 404,
      memberBReloadHttpStatus: 200,
      count: 1,
      memberBDeleteRowVisible: true,
      deleteButtonVisible: true,
      deleteConfirmationVisible: true,
      deletedRowAbsent: true,
      canonicalObjectAbsent: true,
      memberBDeleteRowAbsent: true,
      supportedNeighborVisible: true,
    },
    {
      phase: 'g6-keyboard-focus',
      status: 'passed',
      count: 7,
      eventActionTabCount: 7,
      detailsActionTabCount: 14,
      keyboardEventFocused: true,
      detailsOpened: true,
      editActionFocused: true,
      deleteActionFocused: true,
      closeActionFocused: true,
      escapeClosedDialog: true,
      focusReturnedToEvent: true,
    },
    {
      phase: 'g6-widget-layout',
      status: 'passed',
      narrowPanel: true,
      createControlReachable: true,
      eventDetailsReachable: true,
      hostNoHorizontalOverflow: true,
      widgetNoHorizontalOverflow: true,
      pinVisible: true,
      pinEnabled: true,
      pinnedToDrawer: true,
      drawerIframePresent: true,
      maximiseControlVisible: true,
      drawerMaximised: true,
      frameExpanded: true,
      unmaximiseControlVisible: true,
      drawerRestored: true,
      frameReturned: true,
      viewportWidth: 1440,
      viewportHeight: 900,
      iframeWidth: 319,
      iframeHeight: 640,
      pinControlCount: 1,
      drawerIframeWidth: 500,
      drawerIframeHeight: 400,
      maximisedIframeWidth: 1200,
      maximisedIframeHeight: 700,
      restoredIframeWidth: 500,
      restoredIframeHeight: 400,
    },
    {
      phase: 'g6-browser-egress',
      status: 'passed',
      count: 0,
      browserEgressClear: true,
    },
    {
      phase: 'g6-resource-cleanup',
      status: 'passed',
      count: 4,
      plannedCount: 4,
      confirmedCreatedCount: 4,
      conflictCount: 0,
      notCreatedCount: 0,
      createUnresolvedCount: 0,
      deletedCount: 4,
      alreadyAbsentCount: 0,
      cleanupUnresolvedCount: 0,
      allOwnedResourcesRemoved: true,
    },
  ];
  const summary = sanitizeElementAcceptance(
    records.map((record) => JSON.stringify(record)).join('\n'),
    sourceSha,
  );

  for (const record of records) {
    assert.ok(summary.includes(`phase=${record.phase} status=passed`));
  }
  assert.doesNotMatch(summary, /Matrix Calendar|G6 unsupported|\.ics|UID:/u);
});

test('accepts the real Element room observations under the g6 phase labels', () => {
  const roomRecord = {
    phase: 'g6-member-a-room-context',
    status: 'passed',
    matrixUserMatches: true,
    matrixRoomKnown: true,
    matrixRoomJoined: true,
    roomNavigationCompleted: true,
    roomHeadingReady: true,
    roomHeadingPresent: true,
    roomNameMatches: true,
    roomIdMatches: true,
    matrixSyncState: 'SYNCING',
    blockedExternalRequestCount: 0,
    homeserverHttpErrorCount: 0,
  };
  const summary = sanitizeElementAcceptance(
    JSON.stringify(roomRecord),
    sourceSha,
  );
  assert.match(summary, /phase=g6-member-a-room-context status=passed/u);
  assert.match(summary, /matrix_room_joined=true/u);
});

test('rejects a passed Element edit whose updated ETag belongs to another event', () => {
  assert.throws(
    () =>
      sanitizeElementAcceptance(
        JSON.stringify({
          phase: 'g6-unsupported-preservation',
          status: 'passed',
          projectionHttpStatus: 200,
          canonicalBeforeHttpStatus: 200,
          neighborPatchHttpStatus: 204,
          canonicalAfterHttpStatus: 200,
          count: 1,
          unsupportedWarningVisible: true,
          unsupportedRowOmitted: true,
          supportedNeighborVisible: true,
          canonicalSnapshotAvailable: true,
          supportedNeighborEdited: true,
          canonicalUnsupportedObjectUnchanged: true,
          neighborOwnershipUpdated: false,
          neighborUpdateIdentityMatches: false,
        }),
        sourceSha,
      ),
    { message: 'invalid element acceptance summary' },
  );
});

test('retains a consistent failed G6 ownership cleanup count ledger', () => {
  const summary = sanitizeElementAcceptance(
    JSON.stringify({
      phase: 'g6-resource-cleanup',
      status: 'failed',
      count: 1,
      plannedCount: 4,
      confirmedCreatedCount: 1,
      conflictCount: 0,
      notCreatedCount: 0,
      createUnresolvedCount: 3,
      deletedCount: 1,
      alreadyAbsentCount: 0,
      cleanupUnresolvedCount: 0,
      allOwnedResourcesRemoved: false,
    }),
    sourceSha,
  );

  assert.match(summary, /phase=g6-resource-cleanup status=failed/u);
  assert.match(summary, /create_unresolved_count=3/u);
  assert.doesNotMatch(summary, /private|\.ics|ETag/u);
});
