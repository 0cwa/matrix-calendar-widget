import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeElementAcceptance } from './sanitize-element-acceptance.mjs';

const sourceSha = 'a'.repeat(40);

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
      'phase=outsider-room-widget-team-target status=passed http_status=403',
      'phase=outsider-own-unbound-room status=passed http_status=404',
      'phase=stale-etag-conflict status=passed http_status=409',
      '',
    ].join('\n'),
  );
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

  const invalidRecords = [
    { ...roomObservation, matrixUserMatches: '@member:private-server' },
    { ...roomObservation, matrixSyncState: 'token=secret' },
    { ...roomObservation, roomIdMatches: '!private-room:server' },
    { ...roomObservation, homeserverLastHttpErrorStatus: '500 /sync?token=x' },
    { ...roomObservation, failureCode: 'room name: private meeting' },
    { ...roomObservation, roomName: 'private meeting' },
  ];
  for (const record of invalidRecords) {
    assert.throws(() =>
      sanitizeElementAcceptance(JSON.stringify(record), sourceSha),
    );
  }
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
  ];

  for (const record of rejectedRecords) {
    assert.throws(
      () => sanitizeElementAcceptance(JSON.stringify(record), sourceSha),
      { message: 'invalid element acceptance summary' },
    );
  }
});
