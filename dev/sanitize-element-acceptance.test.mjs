import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeElementAcceptance } from './sanitize-element-acceptance.mjs';

const sourceSha = 'a'.repeat(40);

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
      JSON.stringify({ phase: 'widget-a-sidebar-ready', status: 'passed' }),
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
      'phase=widget-a-sidebar-ready status=passed',
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
