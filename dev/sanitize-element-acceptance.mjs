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
  'event-created',
  'shared-visibility',
  'member-a-edited',
  'outsider-room-widget-team-target',
  'outsider-own-unbound-room',
  'stale-etag-conflict',
  'canonical-read-after-denial',
  'browser-egress',
  'runtime-versions',
]);
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
  'blockedExternalRequestCount',
  'homeserverHttpErrorCount',
  'homeserverLastHttpErrorStatus',
  'failureCode',
  'missingModuleKind',
  'missingDependency',
  'processExitCode',
  'containerState',
  'containerHealth',
  'containerExitCode',
  'containerOomKilled',
  'containerRuntimeErrorPresent',
  ...RUNTIME_OBSERVATION_FIELDS,
  ...OPTIONAL_RUNTIME_STATUS_FIELDS,
  ...VERSION_FIELDS,
]);

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

export function sanitizeElementAcceptance(input, sourceSha) {
  if (typeof sourceSha !== 'string' || !/^[a-f0-9]{40}$/i.test(sourceSha)) {
    throw new Error('invalid element acceptance summary');
  }

  const phases = new Map();
  for (const line of input.split(/\r?\n/u)) {
    if (!line) continue;

    let record;
    try {
      record = JSON.parse(line);
    } catch {
      throw new Error('invalid element acceptance summary');
    }

    if (
      record === null ||
      typeof record !== 'object' ||
      Array.isArray(record) ||
      Object.keys(record).some((key) => !ALLOWED_KEYS.has(key)) ||
      !PHASES.has(record.phase) ||
      !STATUSES.has(record.status)
    ) {
      throw new Error('invalid element acceptance summary');
    }

    const hasRuntimeObservation = RUNTIME_OBSERVATION_FIELDS.some((key) =>
      Object.hasOwn(record, key),
    );
    if (
      (record.phase === 'widget-a-runtime-observed' &&
        !validRuntimeObservation(record)) ||
      (record.phase !== 'widget-a-runtime-observed' &&
        (hasRuntimeObservation ||
          OPTIONAL_RUNTIME_STATUS_FIELDS.some((key) =>
            Object.hasOwn(record, key),
          )))
    ) {
      throw new Error('invalid element acceptance summary');
    }

    if (
      Object.hasOwn(record, 'httpStatus') &&
      (!Number.isInteger(record.httpStatus) ||
        record.httpStatus < 100 ||
        record.httpStatus > 599)
    ) {
      throw new Error('invalid element acceptance summary');
    }

    if (
      Object.hasOwn(record, 'count') &&
      (!Number.isInteger(record.count) ||
        record.count < 0 ||
        record.count > 100000)
    ) {
      throw new Error('invalid element acceptance summary');
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
      throw new Error('invalid element acceptance summary');
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
        throw new Error('invalid element acceptance summary');
      }
    }
    if (
      Object.hasOwn(record, 'homeserverLastHttpErrorStatus') &&
      (!Number.isInteger(record.homeserverLastHttpErrorStatus) ||
        record.homeserverLastHttpErrorStatus < 400 ||
        record.homeserverLastHttpErrorStatus > 599)
    ) {
      throw new Error('invalid element acceptance summary');
    }

    if (
      Object.hasOwn(record, 'failureCode') &&
      !FAILURE_CODES.has(record.failureCode)
    ) {
      throw new Error('invalid element acceptance summary');
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
      throw new Error('invalid element acceptance summary');
    }

    if (
      Object.hasOwn(record, 'processExitCode') &&
      (!Number.isInteger(record.processExitCode) ||
        record.processExitCode < 1 ||
        record.processExitCode > 255)
    ) {
      throw new Error('invalid element acceptance summary');
    }

    const hasContainerDiagnostic = [
      'containerState',
      'containerHealth',
      'containerExitCode',
      'containerOomKilled',
      'containerRuntimeErrorPresent',
    ].some((key) => Object.hasOwn(record, key));
    if (
      (hasContainerDiagnostic &&
        (record.phase !== 'gateway-ready' ||
          record.status !== 'failed' ||
          !Object.hasOwn(record, 'containerState') ||
          !CONTAINER_STATES.has(record.containerState) ||
          !Object.hasOwn(record, 'containerHealth') ||
          !CONTAINER_HEALTH_STATES.has(record.containerHealth))) ||
      (Object.hasOwn(record, 'containerExitCode') &&
        (!Number.isInteger(record.containerExitCode) ||
          record.containerExitCode < 0 ||
          record.containerExitCode > 255)) ||
      (Object.hasOwn(record, 'containerOomKilled') &&
        typeof record.containerOomKilled !== 'boolean') ||
      (Object.hasOwn(record, 'containerRuntimeErrorPresent') &&
        typeof record.containerRuntimeErrorPresent !== 'boolean')
    ) {
      throw new Error('invalid element acceptance summary');
    }

    if (
      (record.phase === 'runtime-versions' && !validRuntimeVersions(record)) ||
      (record.phase !== 'runtime-versions' &&
        [...VERSION_FIELDS].some((key) => Object.hasOwn(record, key)))
    ) {
      throw new Error('invalid element acceptance summary');
    }

    if (
      (record.failureCode === 'docker-command-failed' &&
        !Object.hasOwn(record, 'processExitCode')) ||
      (record.failureCode === 'matrix-http-failed' &&
        !Object.hasOwn(record, 'httpStatus')) ||
      (record.failureCode === 'matrix-invalid-json' &&
        !Object.hasOwn(record, 'httpStatus'))
    ) {
      throw new Error('invalid element acceptance summary');
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
        record.phase !== 'member-a-room-context') ||
      (hasSyncObservation &&
        ((record.phase !== 'member-a-session-observed' &&
          record.phase !== 'member-a-room-context') ||
          !MATRIX_SYNC_STATES.has(record.matrixSyncState))) ||
      (record.phase === 'member-a-session-observed' &&
        hasMatrixUserObservation !== hasSyncObservation) ||
      (hasMatrixUserObservation &&
        typeof record.matrixUserMatches !== 'boolean') ||
      !validSessionObservation
    ) {
      throw new Error('invalid element acceptance summary');
    }

    const roomObservationKeys = [
      'matrixRoomKnown',
      'matrixRoomJoined',
      'roomNavigationCompleted',
      'roomHeadingReady',
      'roomHeadingPresent',
      'roomNameMatches',
      'roomIdMatches',
      'blockedExternalRequestCount',
      'homeserverHttpErrorCount',
      'homeserverLastHttpErrorStatus',
    ];
    const hasRoomObservation = roomObservationKeys.some((key) =>
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
      ((hasRoomObservation || record.phase === 'member-a-room-context') &&
        (record.phase !== 'member-a-room-context' ||
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
      (record.phase === 'member-a-room-context' &&
        !hasRoomObservation &&
        (record.status !== 'failed' ||
          !roomFailureCodes.has(record.failureCode))) ||
      (hasRoomObservation &&
        (Object.hasOwn(record, 'matrixClientHookPresent') ||
          Object.hasOwn(record, 'matrixClientPresent'))) ||
      (Object.hasOwn(record, 'failureCode') &&
        roomFailureCodes.has(record.failureCode) &&
        record.phase !== 'member-a-room-context')
    ) {
      throw new Error('invalid element acceptance summary');
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
      throw new Error('invalid element acceptance summary');
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

    const fields = [`phase=${phase}`, `status=${record.status}`];
    if (Object.hasOwn(record, 'httpStatus')) {
      fields.push(`http_status=${record.httpStatus}`);
    }
    if (Object.hasOwn(record, 'count')) {
      fields.push(`count=${record.count}`);
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
      phase === 'member-a-room-context' &&
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
    if (Object.hasOwn(record, 'failureCode')) {
      fields.push(`failure_code=${record.failureCode}`);
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
  } catch {
    process.stderr.write('Element acceptance summary unavailable.\n');
    process.exitCode = 1;
  }
}
