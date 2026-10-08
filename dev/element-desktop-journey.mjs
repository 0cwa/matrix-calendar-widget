import {
  appendFileSync,
  existsSync,
  lstatSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DESKTOP_JOURNEY_PHASES = Object.freeze([
  'desktop-login',
  'desktop-member-identity',
  'desktop-room-widget-read',
  'desktop-widget-origin-isolation',
  'desktop-event-create',
  'web-member-b-read',
  'web-member-b-keyboard-open',
  'web-member-b-details-escape-focus',
  'web-member-b-edit-save',
  'desktop-a-refresh',
  'canonical-edit-read',
  'web-http-route-enforcement',
]);
export const DESKTOP_JOURNEY_FAILURE_POINTS = Object.freeze([
  'room-navigation',
  'room-heading',
  'room-id',
  'gateway-read-await',
  'widget-open',
  'gateway-read-status',
  'create-control',
  'origin-isolation',
  'web-b-authentication',
  'web-b-room-navigation',
  'web-b-widget-open',
  'web-b-gateway-read-await',
  'web-b-gateway-read-status',
  'web-b-event-row',
  'web-b-edit-details-open',
  'web-b-edit-open',
  'web-b-edit-title-fill',
  'web-b-edit-save-click',
  'web-b-edit-patch-await',
  'web-b-edit-patch-status',
  'web-b-edit-details-returned',
  'web-b-edit-details-close-click',
  'web-b-edit-details-close-hidden',
  'web-b-edit-event-row',
]);
export const DESKTOP_LOGIN_STEPS = Object.freeze([
  'not_observed',
  'cdp_connect',
  'page_select',
  'credentials_read',
  'login_form_select',
  'welcome_sign_in',
  'username_fill',
  'password_fill',
  'sign_in_submit',
  'rooms_ready',
  'complete',
]);
export const DESKTOP_LOGIN_FAILURE_REASONS = Object.freeze([
  'timeout',
  'strict-mode',
  'not-visible',
  'not-enabled',
  'detached',
  'other',
  'unavailable',
]);
export const DESKTOP_LOGIN_ENTRIES = Object.freeze([
  'not_observed',
  'password_form_present',
  'welcome_sign_in_attempted',
  'welcome_sign_in_clicked',
]);

const PHASE_SET = new Set(DESKTOP_JOURNEY_PHASES);
const JOURNEY_FAILURE_POINT_SET = new Set(DESKTOP_JOURNEY_FAILURE_POINTS);
const ROOM_WIDGET_FAILURE_POINT_SET = new Set([
  'room-navigation',
  'room-heading',
  'room-id',
  'gateway-read-await',
  'widget-open',
  'gateway-read-status',
  'create-control',
]);
const WEB_B_READ_FAILURE_POINT_SET = new Set([
  'web-b-authentication',
  'web-b-room-navigation',
  'web-b-widget-open',
  'web-b-gateway-read-await',
  'web-b-gateway-read-status',
  'web-b-event-row',
]);
const WEB_B_EDIT_SAVE_FAILURE_POINT_SET = new Set([
  'web-b-edit-details-open',
  'web-b-edit-open',
  'web-b-edit-title-fill',
  'web-b-edit-save-click',
  'web-b-edit-patch-await',
  'web-b-edit-patch-status',
  'web-b-edit-details-returned',
  'web-b-edit-details-close-click',
  'web-b-edit-details-close-hidden',
  'web-b-edit-event-row',
]);
const WEB_B_EDIT_POST_PATCH_FAILURE_POINT_SET = new Set([
  'web-b-edit-details-returned',
  'web-b-edit-details-close-click',
  'web-b-edit-details-close-hidden',
]);
const WEB_B_EVENT_LIST_OBSERVATION_STATES = new Set([
  'awaiting-events-get',
  'request-pending',
  'request-failed',
  'decode-pending',
  'decoded',
  'status-not-200',
  'unavailable',
]);
const WEB_B_EVENT_IDENTITY_STATES = new Set([
  'pending',
  'available',
  'unavailable',
]);
const MAX_WEB_B_EVENT_LIST_ITEMS = 512;
const MAX_WEB_B_EVENT_LIST_BYTES = 65_536;
const WEB_B_EDIT_ROW_RENDER_OBSERVATION_TIMEOUT_MS = 500;
const LOGIN_STEP_SET = new Set(DESKTOP_LOGIN_STEPS);
const LOGIN_FAILURE_REASON_SET = new Set(DESKTOP_LOGIN_FAILURE_REASONS);
const LOGIN_ENTRY_SET = new Set(DESKTOP_LOGIN_ENTRIES);
const ROOMS_READY_ELEMENT_VISIBILITY = new Set([
  'absent',
  'visible',
  'hidden',
  'ambiguous',
  'unavailable',
]);
const ROOMS_READY_MATRIX_CHAT_VIEWS = new Set([
  'welcome',
  'login',
  'logged-in',
  'other-view',
  'missing',
  'unavailable',
]);
const ROOMS_READY_PAGE_TYPES = new Set([
  'home-page',
  'room-view',
  'user-view',
  'other-page',
  'missing',
  'unavailable',
]);
const ROOMS_READY_DIAGNOSTIC_KEYS = Object.freeze(
  [
    'roomList',
    'matrixChatShell',
    'matrixChatStateAvailable',
    'matrixChatView',
    'matrixChatReady',
    'matrixChatPageType',
    'matrixChatCurrentRoomKnown',
    'matrixChatCurrentRoomMatchesExpected',
    'matrixChatSecurityFlowView',
    'matrixClientMatchesMemberA',
  ].sort(),
);
const GATEWAY_READ_FAILURE_POINTS = new Set([
  'widget-open',
  'gateway-read-await',
  'gateway-read-status',
  'create-control',
]);
const GATEWAY_READ_DIAGNOSTIC_KEYS = Object.freeze(
  [
    'eventsGetCandidateCountCapped',
    'expectedRoomCalendarGetObserved',
    'widgetWarningObserved',
    'widgetWarningContinued',
    'capabilityPromptObserved',
    'capabilityApproved',
    'identityApprovalAttempted',
    'identityApprovalCompleted',
    'iframeAttached',
    'createControlVisible',
  ].sort(),
);
const LOGIN_FORM_FIELD_NAMES = Object.freeze(['username', 'password']);
const JOURNEY_CREDENTIALS_NAME = 'element-acceptance-desktop-credentials.json';
const JOURNEY_EVIDENCE_NAME = 'element-desktop-journey-stage.jsonl';
const MAX_CREDENTIAL_BYTES = 2_048;
const MAX_EVIDENCE_BYTES = 16_384;

function invalidInput() {
  throw new Error('Invalid Desktop journey input');
}

function validJourneyFailurePoint(phase, status, failurePoint) {
  if (status !== 'failed' || !JOURNEY_FAILURE_POINT_SET.has(failurePoint)) {
    return false;
  }
  if (phase === 'desktop-room-widget-read') {
    return ROOM_WIDGET_FAILURE_POINT_SET.has(failurePoint);
  }
  if (phase === 'web-member-b-read') {
    return WEB_B_READ_FAILURE_POINT_SET.has(failurePoint);
  }
  if (phase === 'web-member-b-edit-save') {
    return WEB_B_EDIT_SAVE_FAILURE_POINT_SET.has(failurePoint);
  }
  return (
    phase === 'desktop-widget-origin-isolation' &&
    failurePoint === 'origin-isolation'
  );
}

function validWebBEditSaveDiagnostic(value, failurePoint) {
  const isEventRowFailure = failurePoint === 'web-b-edit-event-row';
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !==
      (isEventRowFailure
        ? 'calendarSurfaceState,eventListRead,eventRowRender,matchedPatchStatus'
        : 'matchedPatchStatus')
  ) {
    return false;
  }
  const status = value.matchedPatchStatus;
  if (
    status !== null &&
    (!Number.isInteger(status) || status < 100 || status > 599)
  ) {
    return false;
  }
  if (
    failurePoint === 'web-b-edit-patch-status' &&
    status !== null &&
    (status < 200 || status >= 300)
  ) {
    return true;
  }
  if (
    failurePoint === 'web-b-edit-event-row' &&
    status !== null &&
    status >= 200 &&
    status < 300
  ) {
    return (
      validWebBEventListReadDiagnostic(value.eventListRead) &&
      validWebBEditRowRenderDiagnostic(value.eventRowRender) &&
      validWebBCalendarSurfaceStateDiagnostic(value.calendarSurfaceState)
    );
  }
  if (
    WEB_B_EDIT_POST_PATCH_FAILURE_POINT_SET.has(failurePoint) &&
    status !== null &&
    status >= 200 &&
    status < 300
  ) {
    return true;
  }
  return (
    status === null &&
    failurePoint !== 'web-b-edit-patch-status' &&
    failurePoint !== 'web-b-edit-event-row' &&
    !WEB_B_EDIT_POST_PATCH_FAILURE_POINT_SET.has(failurePoint)
  );
}

function validWebBCalendarSurfaceStateDiagnostic(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !==
      'calendarCountCapped,calendarPartialAvailability,calendarQueryError,calendarQueryLoading,eventPartialAvailability,eventQueryError,eventQueryLoading,eventQuerySourceCountCapped,projectedOccurrenceCountCapped,roomCalendarReadable,roomCapabilitiesState,state,visibleEventCountCapped'
  ) {
    return false;
  }
  const observations = [
    value.calendarCountCapped,
    value.calendarQueryLoading,
    value.calendarQueryError,
    value.calendarPartialAvailability,
    value.roomCapabilitiesState,
    value.roomCalendarReadable,
    value.eventQuerySourceCountCapped,
    value.eventQueryLoading,
    value.eventQueryError,
    value.eventPartialAvailability,
    value.projectedOccurrenceCountCapped,
    value.visibleEventCountCapped,
  ];
  if (value.state === 'unavailable') {
    return observations.every((observation) => observation === null);
  }
  if (
    value.state !== 'observed' ||
    ![0, 1, 2].includes(value.calendarCountCapped) ||
    typeof value.calendarQueryLoading !== 'boolean' ||
    typeof value.calendarQueryError !== 'boolean' ||
    typeof value.calendarPartialAvailability !== 'boolean' ||
    !['present', 'absent'].includes(value.roomCapabilitiesState) ||
    (value.roomCapabilitiesState === 'present'
      ? typeof value.roomCalendarReadable !== 'boolean'
      : value.roomCalendarReadable !== null) ||
    ![0, 1, 2].includes(value.eventQuerySourceCountCapped) ||
    typeof value.eventQueryLoading !== 'boolean' ||
    typeof value.eventQueryError !== 'boolean' ||
    typeof value.eventPartialAvailability !== 'boolean' ||
    ![0, 1, 2].includes(value.projectedOccurrenceCountCapped) ||
    ![0, 1, 2].includes(value.visibleEventCountCapped) ||
    value.visibleEventCountCapped > value.projectedOccurrenceCountCapped ||
    (value.calendarQueryLoading && value.calendarQueryError) ||
    (value.eventQueryLoading && value.eventQueryError)
  ) {
    return false;
  }
  return true;
}

function validWebBEditRowRenderDiagnostic(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !==
      'calendarEventsListVisibleRowCountCapped,editedRowCountCapped,editedRowVisible,errorAlertVisible,progressbarVisible,selectedRowCountCapped,selectedRowVisible,state'
  ) {
    return false;
  }
  const observationValues = [
    value.editedRowCountCapped,
    value.editedRowVisible,
    value.selectedRowCountCapped,
    value.selectedRowVisible,
    value.calendarEventsListVisibleRowCountCapped,
    value.progressbarVisible,
    value.errorAlertVisible,
  ];
  if (value.state === 'unavailable') {
    return observationValues.every((observation) => observation === null);
  }
  if (
    value.state !== 'observed' ||
    ![0, 1, 2].includes(value.editedRowCountCapped) ||
    typeof value.editedRowVisible !== 'boolean' ||
    ![0, 1, 2].includes(value.selectedRowCountCapped) ||
    typeof value.selectedRowVisible !== 'boolean' ||
    (value.calendarEventsListVisibleRowCountCapped !== null &&
      ![0, 1, 2].includes(value.calendarEventsListVisibleRowCountCapped)) ||
    typeof value.progressbarVisible !== 'boolean' ||
    typeof value.errorAlertVisible !== 'boolean' ||
    (value.editedRowCountCapped === 0 && value.editedRowVisible) ||
    (value.selectedRowCountCapped === 0 && value.selectedRowVisible) ||
    (value.calendarEventsListVisibleRowCountCapped === 0 &&
      (value.editedRowVisible || value.selectedRowVisible))
  ) {
    return false;
  }
  return true;
}

export function unavailableWebBEditRowRenderDiagnostic() {
  return {
    state: 'unavailable',
    editedRowCountCapped: null,
    editedRowVisible: null,
    selectedRowCountCapped: null,
    selectedRowVisible: null,
    calendarEventsListVisibleRowCountCapped: null,
    progressbarVisible: null,
    errorAlertVisible: null,
  };
}

export function unavailableWebBCalendarSurfaceStateDiagnostic() {
  return {
    state: 'unavailable',
    calendarCountCapped: null,
    calendarQueryLoading: null,
    calendarQueryError: null,
    calendarPartialAvailability: null,
    roomCapabilitiesState: null,
    roomCalendarReadable: null,
    eventQuerySourceCountCapped: null,
    eventQueryLoading: null,
    eventQueryError: null,
    eventPartialAvailability: null,
    projectedOccurrenceCountCapped: null,
    visibleEventCountCapped: null,
  };
}

export function unavailableWebBEditSurfaceDiagnostic() {
  return {
    eventRowRender: unavailableWebBEditRowRenderDiagnostic(),
    calendarSurfaceState: unavailableWebBCalendarSurfaceStateDiagnostic(),
  };
}

export function parseWebBCalendarSurfaceStateAttributes(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !==
      'calendarCountCapped,calendarPartialAvailability,calendarQueryError,calendarQueryLoading,eventPartialAvailability,eventQueryError,eventQueryLoading,eventQuerySourceCountCapped,projectedOccurrenceCountCapped,roomCalendarReadable,roomCapabilitiesState,visibleEventCountCapped'
  ) {
    return unavailableWebBCalendarSurfaceStateDiagnostic();
  }

  const count = (raw) =>
    ['0', '1', '2'].includes(raw) ? Number(raw) : undefined;
  const boolean = (raw) =>
    raw === 'true' ? true : raw === 'false' ? false : undefined;
  const calendarCountCapped = count(value.calendarCountCapped);
  const calendarQueryLoading = boolean(value.calendarQueryLoading);
  const calendarQueryError = boolean(value.calendarQueryError);
  const calendarPartialAvailability = boolean(
    value.calendarPartialAvailability,
  );
  const roomCapabilitiesState = ['present', 'absent'].includes(
    value.roomCapabilitiesState,
  )
    ? value.roomCapabilitiesState
    : undefined;
  const roomCalendarReadable =
    value.roomCalendarReadable === 'true'
      ? true
      : value.roomCalendarReadable === 'false'
        ? false
        : value.roomCalendarReadable === 'unknown'
          ? null
          : undefined;
  const eventQuerySourceCountCapped = count(value.eventQuerySourceCountCapped);
  const eventQueryLoading = boolean(value.eventQueryLoading);
  const eventQueryError = boolean(value.eventQueryError);
  const eventPartialAvailability = boolean(value.eventPartialAvailability);
  const projectedOccurrenceCountCapped = count(
    value.projectedOccurrenceCountCapped,
  );
  const visibleEventCountCapped = count(value.visibleEventCountCapped);
  if (
    calendarCountCapped === undefined ||
    calendarQueryLoading === undefined ||
    calendarQueryError === undefined ||
    calendarPartialAvailability === undefined ||
    roomCapabilitiesState === undefined ||
    roomCalendarReadable === undefined ||
    (roomCapabilitiesState === 'present' && roomCalendarReadable === null) ||
    (roomCapabilitiesState === 'absent' && roomCalendarReadable !== null) ||
    eventQuerySourceCountCapped === undefined ||
    eventQueryLoading === undefined ||
    eventQueryError === undefined ||
    eventPartialAvailability === undefined ||
    projectedOccurrenceCountCapped === undefined ||
    visibleEventCountCapped === undefined
  ) {
    return unavailableWebBCalendarSurfaceStateDiagnostic();
  }

  const parsed = {
    state: 'observed',
    calendarCountCapped,
    calendarQueryLoading,
    calendarQueryError,
    calendarPartialAvailability,
    roomCapabilitiesState,
    roomCalendarReadable:
      roomCapabilitiesState === 'present' ? roomCalendarReadable : null,
    eventQuerySourceCountCapped,
    eventQueryLoading,
    eventQueryError,
    eventPartialAvailability,
    projectedOccurrenceCountCapped,
    visibleEventCountCapped,
  };
  return validWebBCalendarSurfaceStateDiagnostic(parsed)
    ? parsed
    : unavailableWebBCalendarSurfaceStateDiagnostic();
}

export async function observeWebBEditSurfaceWithinDeadline(observe) {
  if (typeof observe !== 'function') {
    return unavailableWebBEditSurfaceDiagnostic();
  }

  let timer;
  try {
    const deadline = new Promise((resolve) => {
      timer = setTimeout(
        () => resolve(unavailableWebBEditSurfaceDiagnostic()),
        WEB_B_EDIT_ROW_RENDER_OBSERVATION_TIMEOUT_MS,
      );
    });
    const observation = Promise.resolve()
      .then(observe)
      .catch(() => unavailableWebBEditSurfaceDiagnostic());
    const result = await Promise.race([observation, deadline]);
    if (
      result === null ||
      typeof result !== 'object' ||
      Array.isArray(result) ||
      Object.keys(result).sort().join(',') !==
        'calendarSurfaceState,eventRowRender'
    ) {
      return unavailableWebBEditSurfaceDiagnostic();
    }
    return {
      eventRowRender: validWebBEditRowRenderDiagnostic(result.eventRowRender)
        ? result.eventRowRender
        : unavailableWebBEditRowRenderDiagnostic(),
      calendarSurfaceState: validWebBCalendarSurfaceStateDiagnostic(
        result.calendarSurfaceState,
      )
        ? result.calendarSurfaceState
        : unavailableWebBCalendarSurfaceStateDiagnostic(),
    };
  } catch {
    return unavailableWebBEditSurfaceDiagnostic();
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function validWebBEventListReadDiagnostic(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !==
      'firstMatchedGetStatus,matchingGetRequestCountCapped,matchingGetResponseCountCapped,sameEventEditedTitleMatch,sameEventObserved,selectedEventIdentity,state' ||
    !WEB_B_EVENT_LIST_OBSERVATION_STATES.has(value.state) ||
    !WEB_B_EVENT_IDENTITY_STATES.has(value.selectedEventIdentity) ||
    ![0, 1, 2].includes(value.matchingGetRequestCountCapped) ||
    ![0, 1, 2].includes(value.matchingGetResponseCountCapped) ||
    value.matchingGetResponseCountCapped >
      value.matchingGetRequestCountCapped ||
    (value.firstMatchedGetStatus !== null &&
      (!Number.isInteger(value.firstMatchedGetStatus) ||
        value.firstMatchedGetStatus < 100 ||
        value.firstMatchedGetStatus > 599)) ||
    ![null, true, false].includes(value.sameEventObserved) ||
    ![null, true, false].includes(value.sameEventEditedTitleMatch)
  ) {
    return false;
  }

  if (
    value.firstMatchedGetStatus !== null &&
    value.matchingGetResponseCountCapped === 0
  ) {
    return false;
  }
  const canReportEventMatch =
    value.state === 'decoded' && value.selectedEventIdentity === 'available';
  if (canReportEventMatch) {
    if (
      typeof value.sameEventObserved !== 'boolean' ||
      typeof value.sameEventEditedTitleMatch !== 'boolean' ||
      (!value.sameEventObserved && value.sameEventEditedTitleMatch) ||
      (value.sameEventEditedTitleMatch && !value.sameEventObserved)
    ) {
      return false;
    }
  } else if (
    value.sameEventObserved !== null ||
    value.sameEventEditedTitleMatch !== null
  ) {
    return false;
  }

  switch (value.state) {
    case 'awaiting-events-get':
      return (
        value.matchingGetRequestCountCapped === 0 &&
        value.matchingGetResponseCountCapped === 0 &&
        value.firstMatchedGetStatus === null
      );
    case 'request-pending':
    case 'request-failed':
      return (
        value.matchingGetRequestCountCapped > 0 &&
        value.firstMatchedGetStatus === null
      );
    case 'decode-pending':
      return (
        value.matchingGetRequestCountCapped > 0 &&
        value.matchingGetResponseCountCapped > 0 &&
        value.firstMatchedGetStatus === 200
      );
    case 'decoded':
      return (
        value.matchingGetRequestCountCapped > 0 &&
        value.matchingGetResponseCountCapped > 0 &&
        value.firstMatchedGetStatus === 200
      );
    case 'status-not-200':
      return (
        value.matchingGetRequestCountCapped > 0 &&
        value.matchingGetResponseCountCapped > 0 &&
        value.firstMatchedGetStatus !== null &&
        value.firstMatchedGetStatus !== 200
      );
    case 'unavailable':
      return true;
  }
  return false;
}

function validGatewayEventListBody(body) {
  if (
    body === null ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    !('events' in body) ||
    !Array.isArray(body.events) ||
    body.events.length > MAX_WEB_B_EVENT_LIST_ITEMS
  ) {
    return false;
  }
  return body.events.every((resource) => {
    if (
      resource === null ||
      typeof resource !== 'object' ||
      Array.isArray(resource) ||
      !('event' in resource)
    ) {
      return false;
    }
    const event = resource.event;
    return (
      event !== null &&
      typeof event === 'object' &&
      !Array.isArray(event) &&
      typeof event.id === 'string' &&
      event.id.length > 0 &&
      event.id.length <= 256 &&
      typeof event.calendarId === 'string' &&
      event.calendarId.length > 0 &&
      event.calendarId.length <= 256 &&
      typeof event.title === 'string' &&
      event.title.length <= 512
    );
  });
}

export function findUniqueWebBEventId(body, calendarId, title) {
  if (
    typeof calendarId !== 'string' ||
    calendarId.length === 0 ||
    typeof title !== 'string' ||
    !validGatewayEventListBody(body)
  ) {
    return null;
  }
  const matchingIds = body.events
    .filter(
      ({ event }) => event.calendarId === calendarId && event.title === title,
    )
    .map(({ event }) => event.id);
  return matchingIds.length === 1 ? matchingIds[0] : null;
}

export function isBoundedWebBEventListResponse(headers) {
  if (
    headers === null ||
    typeof headers !== 'object' ||
    Array.isArray(headers)
  ) {
    return false;
  }
  const contentLength = headers['content-length'];
  const contentType = headers['content-type'];
  const contentEncoding = headers['content-encoding']?.trim().toLowerCase();
  return (
    typeof contentLength === 'string' &&
    /^(?:0|[1-9]\d*)$/u.test(contentLength) &&
    Number.isSafeInteger(Number(contentLength)) &&
    Number(contentLength) <= MAX_WEB_B_EVENT_LIST_BYTES &&
    typeof contentType === 'string' &&
    /^application\/json(?:\s*;|$)/iu.test(contentType) &&
    (contentEncoding === undefined || contentEncoding === 'identity')
  );
}

export function isBoundedWebBEventListBodyLength(byteLength) {
  return (
    Number.isSafeInteger(byteLength) &&
    byteLength >= 0 &&
    byteLength <= MAX_WEB_B_EVENT_LIST_BYTES
  );
}

export function collectWebBEventTitleMatches(body, calendarId, editedTitle) {
  if (
    typeof calendarId !== 'string' ||
    calendarId.length === 0 ||
    typeof editedTitle !== 'string' ||
    !validGatewayEventListBody(body)
  ) {
    return null;
  }
  const titleMatches = new Map();
  for (const { event } of body.events) {
    if (event.calendarId !== calendarId) continue;
    titleMatches.set(
      event.id,
      event.title === editedTitle || titleMatches.get(event.id) === true,
    );
  }
  return titleMatches;
}

export function inspectWebBEventList(body, calendarId, eventId, editedTitle) {
  if (
    typeof calendarId !== 'string' ||
    calendarId.length === 0 ||
    typeof eventId !== 'string' ||
    eventId.length === 0 ||
    typeof editedTitle !== 'string' ||
    !validGatewayEventListBody(body)
  ) {
    return {
      state: 'unavailable',
      sameEventObserved: null,
      sameEventEditedTitleMatch: null,
    };
  }
  const titleMatches = collectWebBEventTitleMatches(
    body,
    calendarId,
    editedTitle,
  );
  if (titleMatches === null) {
    return {
      state: 'unavailable',
      sameEventObserved: null,
      sameEventEditedTitleMatch: null,
    };
  }
  return {
    state: 'decoded',
    sameEventObserved: titleMatches.has(eventId),
    sameEventEditedTitleMatch: titleMatches.get(eventId) ?? false,
  };
}

function validLoginFieldObservation(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !==
      'countCapped,editable,enabled,visible' ||
    ![null, 0, 1, 2].includes(value.countCapped) ||
    ![null, true, false].includes(value.visible) ||
    ![null, true, false].includes(value.enabled) ||
    ![null, true, false].includes(value.editable)
  ) {
    return false;
  }
  return (
    value.countCapped === 1 ||
    (value.visible === null &&
      value.enabled === null &&
      value.editable === null)
  );
}

function validLoginFormObservation(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === 'password,username' &&
    LOGIN_FORM_FIELD_NAMES.every((name) =>
      validLoginFieldObservation(value[name]),
    )
  );
}

function validDesktopLoginDiagnostic(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(',') ===
      'atFailure,beforeFill,failureReason' &&
    LOGIN_FAILURE_REASON_SET.has(value.failureReason) &&
    validLoginFormObservation(value.beforeFill) &&
    validLoginFormObservation(value.atFailure)
  );
}

function validRoomsReadyElementObservation(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== 'countCapped,visibility' ||
    ![null, 0, 1, 2].includes(value.countCapped) ||
    !ROOMS_READY_ELEMENT_VISIBILITY.has(value.visibility)
  ) {
    return false;
  }
  if (value.countCapped === null) return value.visibility === 'unavailable';
  if (value.countCapped === 0) return value.visibility === 'absent';
  if (value.countCapped === 2) return value.visibility === 'ambiguous';
  return ['visible', 'hidden', 'unavailable'].includes(value.visibility);
}

function validRoomsReadyDiagnostic(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !==
      ROOMS_READY_DIAGNOSTIC_KEYS.join(',') ||
    !validRoomsReadyElementObservation(value.roomList) ||
    !validRoomsReadyElementObservation(value.matrixChatShell) ||
    ![null, true, false].includes(value.matrixChatStateAvailable) ||
    !ROOMS_READY_MATRIX_CHAT_VIEWS.has(value.matrixChatView) ||
    ![null, true, false].includes(value.matrixChatReady) ||
    !ROOMS_READY_PAGE_TYPES.has(value.matrixChatPageType) ||
    ![null, true, false].includes(value.matrixChatCurrentRoomKnown) ||
    ![null, true, false].includes(value.matrixChatCurrentRoomMatchesExpected) ||
    ![null, true, false].includes(value.matrixChatSecurityFlowView) ||
    ![null, true, false].includes(value.matrixClientMatchesMemberA)
  ) {
    return false;
  }

  if (value.matrixChatStateAvailable === null) {
    return (
      value.matrixChatView === 'unavailable' &&
      value.matrixChatReady === null &&
      value.matrixChatPageType === 'unavailable' &&
      value.matrixChatCurrentRoomKnown === null &&
      value.matrixChatCurrentRoomMatchesExpected === null &&
      value.matrixChatSecurityFlowView === null
    );
  }
  if (value.matrixChatStateAvailable === false) {
    return (
      value.matrixChatView === 'missing' &&
      value.matrixChatReady === null &&
      value.matrixChatPageType === 'missing' &&
      value.matrixChatCurrentRoomKnown === null &&
      value.matrixChatCurrentRoomMatchesExpected === null &&
      value.matrixChatSecurityFlowView === null
    );
  }
  if (
    value.matrixChatView === 'unavailable' ||
    value.matrixChatPageType === 'unavailable' ||
    (value.matrixChatCurrentRoomKnown === false &&
      value.matrixChatCurrentRoomMatchesExpected === true) ||
    (value.matrixChatCurrentRoomKnown === true &&
      value.matrixChatCurrentRoomMatchesExpected === null) ||
    (value.matrixChatCurrentRoomKnown === false &&
      value.matrixChatCurrentRoomMatchesExpected === null)
  ) {
    return false;
  }
  return true;
}

function validPromptObservation(observed, actionTaken) {
  return (
    [null, true, false].includes(observed) &&
    [null, true, false].includes(actionTaken) &&
    (observed === null
      ? actionTaken === null
      : observed === false
        ? actionTaken === false
        : typeof actionTaken === 'boolean')
  );
}

function validDesktopGatewayReadFailureDiagnostic(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !==
      GATEWAY_READ_DIAGNOSTIC_KEYS.join(',') ||
    ![null, 0, 1, 2].includes(value.eventsGetCandidateCountCapped) ||
    ![null, true, false].includes(value.expectedRoomCalendarGetObserved) ||
    !validPromptObservation(
      value.widgetWarningObserved,
      value.widgetWarningContinued,
    ) ||
    !validPromptObservation(
      value.capabilityPromptObserved,
      value.capabilityApproved,
    ) ||
    !validPromptObservation(
      value.identityApprovalAttempted,
      value.identityApprovalCompleted,
    ) ||
    (value.identityApprovalAttempted === true &&
      value.capabilityApproved === false) ||
    ![null, true, false].includes(value.iframeAttached) ||
    ![null, true, false].includes(value.createControlVisible) ||
    (value.iframeAttached === false && value.createControlVisible === true)
  ) {
    return false;
  }

  if (value.eventsGetCandidateCountCapped === null) {
    return value.expectedRoomCalendarGetObserved === null;
  }
  return (
    value.expectedRoomCalendarGetObserved !== null &&
    (value.eventsGetCandidateCountCapped !== 0 ||
      value.expectedRoomCalendarGetObserved === false)
  );
}

function safeErrorField(error, key) {
  if (error === null || typeof error !== 'object') return null;
  try {
    const value = error[key];
    if (typeof value !== 'string' || value.length > 512) return null;
    return value.toLowerCase();
  } catch {
    return null;
  }
}

function loginFieldObservation(form, field) {
  if (
    !validLoginFormObservation(form) ||
    !LOGIN_FORM_FIELD_NAMES.includes(field)
  ) {
    return null;
  }
  return form[field];
}

export function classifyDesktopLoginFailure(
  error,
  step,
  beforeFill,
  atFailure,
) {
  if (
    error === null ||
    (typeof error !== 'object' && typeof error !== 'function')
  ) {
    return 'unavailable';
  }

  const name = safeErrorField(error, 'name');
  const message = safeErrorField(error, 'message');
  const field =
    step === 'username_fill'
      ? 'username'
      : step === 'password_fill'
        ? 'password'
        : null;
  const previous = field ? loginFieldObservation(beforeFill, field) : null;
  const current = field ? loginFieldObservation(atFailure, field) : null;

  if (message?.includes('strict mode violation')) return 'strict-mode';
  if (
    (previous?.countCapped === 1 && current?.countCapped === 0) ||
    message?.includes('not attached to the dom') ||
    message?.includes('detached from the dom')
  ) {
    return 'detached';
  }
  if (
    (current?.countCapped === 1 && current.visible === false) ||
    message?.includes('element is not visible')
  ) {
    return 'not-visible';
  }
  if (
    (current?.countCapped === 1 &&
      (current.enabled === false || current.editable === false)) ||
    message?.includes('element is not enabled') ||
    message?.includes('element is not editable')
  ) {
    return 'not-enabled';
  }
  if (name === 'timeouterror' || message?.includes('timeout')) {
    return 'timeout';
  }
  return name !== null || message !== null ? 'other' : 'unavailable';
}

export async function enterDesktopPasswordLogin({
  initialForm,
  clickWelcomeSignIn,
  observeForm,
  onBeforeFill,
  fillCredentials,
  setLoginEntry,
  setLoginStep,
}) {
  if (
    !validLoginFormObservation(initialForm) ||
    typeof clickWelcomeSignIn !== 'function' ||
    typeof observeForm !== 'function' ||
    typeof onBeforeFill !== 'function' ||
    typeof fillCredentials !== 'function' ||
    typeof setLoginEntry !== 'function' ||
    typeof setLoginStep !== 'function'
  ) {
    invalidInput();
  }

  const passwordFormVisible = ['username', 'password'].every(
    (name) =>
      initialForm[name].countCapped === 1 && initialForm[name].visible === true,
  );
  let formBeforeFill = initialForm;
  if (passwordFormVisible) {
    setLoginEntry('password_form_present');
  } else {
    setLoginEntry('welcome_sign_in_attempted');
    setLoginStep('welcome_sign_in');
    await clickWelcomeSignIn();
    setLoginEntry('welcome_sign_in_clicked');
    setLoginStep('login_form_select');
    formBeforeFill = await observeForm();
    if (!validLoginFormObservation(formBeforeFill)) invalidInput();
  }

  onBeforeFill(formBeforeFill);
  await fillCredentials();
  return formBeforeFill;
}

export function desktopWidgetIsReady(observation) {
  if (
    observation === null ||
    typeof observation !== 'object' ||
    Array.isArray(observation) ||
    Object.keys(observation).sort().join(',') !==
      'capabilityPromptVisible,createControlCountCapped,createControlEnabled,createControlVisible' ||
    ![null, 0, 1, 2].includes(observation.createControlCountCapped) ||
    ![null, true, false].includes(observation.createControlVisible) ||
    ![null, true, false].includes(observation.createControlEnabled) ||
    ![null, true, false].includes(observation.capabilityPromptVisible)
  ) {
    invalidInput();
  }

  return (
    observation.createControlCountCapped === 1 &&
    observation.createControlVisible === true &&
    observation.createControlEnabled === true &&
    observation.capabilityPromptVisible === false
  );
}

export function readOnlyWidgetIsReady(observation) {
  if (
    observation === null ||
    typeof observation !== 'object' ||
    Array.isArray(observation) ||
    Object.keys(observation).sort().join(',') !==
      'capabilityPromptVisible,expectedEventRowCountCapped,expectedEventRowVisible' ||
    ![null, 0, 1, 2].includes(observation.expectedEventRowCountCapped) ||
    ![null, true, false].includes(observation.expectedEventRowVisible) ||
    ![null, true, false].includes(observation.capabilityPromptVisible) ||
    (observation.expectedEventRowCountCapped !== 1 &&
      observation.expectedEventRowVisible !== null)
  ) {
    invalidInput();
  }

  return (
    observation.expectedEventRowCountCapped === 1 &&
    observation.expectedEventRowVisible === true &&
    observation.capabilityPromptVisible === false
  );
}

export async function prepareDesktopWidget({
  isReady,
  isIframeVisible,
  activateWidget,
  approveWarning,
  approveCapabilities,
  waitForIdentityContinue,
  approveIdentity,
  waitForIframe,
}) {
  if (
    typeof isReady !== 'function' ||
    typeof isIframeVisible !== 'function' ||
    typeof activateWidget !== 'function' ||
    typeof approveWarning !== 'function' ||
    typeof approveCapabilities !== 'function' ||
    typeof waitForIdentityContinue !== 'function' ||
    typeof approveIdentity !== 'function' ||
    typeof waitForIframe !== 'function'
  ) {
    invalidInput();
  }

  const alreadyReady = await isReady();
  if (alreadyReady !== true) {
    if (!(await isIframeVisible())) await activateWidget();
  }
  await approveWarning();
  if (alreadyReady !== true) await approveCapabilities();
  if ((await waitForIdentityContinue()) === true) await approveIdentity();
  if (alreadyReady !== true) await waitForIframe();
}

function privateRunnerPath(filePath, runnerTemp, expectedName) {
  if (
    typeof filePath !== 'string' ||
    typeof runnerTemp !== 'string' ||
    !isAbsolute(filePath) ||
    !isAbsolute(runnerTemp) ||
    resolve(filePath) !== resolve(runnerTemp, expectedName)
  ) {
    invalidInput();
  }
  return resolve(filePath);
}

function ownedPrivateFileStat(filePath) {
  let stat;
  try {
    stat = lstatSync(filePath);
  } catch {
    invalidInput();
  }
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    (stat.mode & 0o777) !== 0o600 ||
    (typeof process.getuid === 'function' && stat.uid !== process.getuid())
  ) {
    invalidInput();
  }
  return stat;
}

function privateFileStat(filePath, maximumBytes) {
  const stat = ownedPrivateFileStat(filePath);
  if (stat.size > maximumBytes) invalidInput();
  return stat;
}

export function writeSyntheticDesktopCredentials({
  filePath,
  runnerTemp,
  username,
  password,
}) {
  const path = privateRunnerPath(
    filePath,
    runnerTemp,
    JOURNEY_CREDENTIALS_NAME,
  );
  if (
    typeof username !== 'string' ||
    !/^element-[0-9a-f]{10}-a$/u.test(username) ||
    typeof password !== 'string' ||
    !/^[A-Za-z0-9_-]{32}$/u.test(password)
  ) {
    invalidInput();
  }

  try {
    writeFileSync(path, `${JSON.stringify({ username, password })}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
  } catch {
    invalidInput();
  }
  privateFileStat(path, MAX_CREDENTIAL_BYTES);
}

function unlinkOwnedPrivateFile(filePath, expectedStat) {
  const currentStat = ownedPrivateFileStat(filePath);
  if (
    currentStat.dev !== expectedStat.dev ||
    currentStat.ino !== expectedStat.ino
  ) {
    invalidInput();
  }
  try {
    unlinkSync(filePath);
  } catch {
    invalidInput();
  }
}

function parseEvidence(input) {
  if (
    typeof input !== 'string' ||
    Buffer.byteLength(input) > MAX_EVIDENCE_BYTES
  ) {
    invalidInput();
  }

  const outcomes = new Map();
  let failurePoint = null;
  let gatewayReadDiagnostic = null;
  let webBEditSaveDiagnostic = null;
  let loginStep = 'not_observed';
  let loginStepRecorded = false;
  let loginEntry = 'not_observed';
  let loginDiagnostic = null;
  let roomsReadyDiagnostic = null;
  const rows = input.split(/\r?\n/u).filter(Boolean);
  if (rows.length > DESKTOP_JOURNEY_PHASES.length + 1) invalidInput();

  for (const row of rows) {
    let value;
    try {
      value = JSON.parse(row);
    } catch {
      invalidInput();
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      invalidInput();
    }
    const keys = Object.keys(value).sort().join(',');
    if (
      keys === 'loginStep' ||
      keys === 'loginDiagnostic,loginStep' ||
      keys === 'loginEntry,loginStep' ||
      keys === 'loginDiagnostic,loginEntry,loginStep' ||
      keys === 'loginStep,roomsReadyDiagnostic' ||
      keys === 'loginEntry,loginStep,roomsReadyDiagnostic' ||
      keys === 'loginDiagnostic,loginStep,roomsReadyDiagnostic' ||
      keys === 'loginDiagnostic,loginEntry,loginStep,roomsReadyDiagnostic'
    ) {
      if (loginStepRecorded || !LOGIN_STEP_SET.has(value.loginStep)) {
        invalidInput();
      }
      if (
        Object.hasOwn(value, 'loginEntry') &&
        (!LOGIN_ENTRY_SET.has(value.loginEntry) ||
          (value.loginEntry === 'welcome_sign_in_attempted' &&
            value.loginStep !== 'welcome_sign_in') ||
          (value.loginEntry === 'welcome_sign_in_clicked' &&
            value.loginStep === 'welcome_sign_in'))
      ) {
        invalidInput();
      }
      if (
        Object.hasOwn(value, 'loginDiagnostic') &&
        !validDesktopLoginDiagnostic(value.loginDiagnostic)
      ) {
        invalidInput();
      }
      if (
        Object.hasOwn(value, 'roomsReadyDiagnostic') &&
        (!validRoomsReadyDiagnostic(value.roomsReadyDiagnostic) ||
          value.loginStep !== 'rooms_ready' ||
          Object.hasOwn(value, 'loginDiagnostic'))
      ) {
        invalidInput();
      }
      loginStep = value.loginStep;
      loginEntry = value.loginEntry ?? 'not_observed';
      loginDiagnostic = value.loginDiagnostic ?? null;
      roomsReadyDiagnostic = value.roomsReadyDiagnostic ?? null;
      loginStepRecorded = true;
      continue;
    }
    const phaseKeys = Object.keys(value).sort().join(',');
    const hasFailurePoint = Object.hasOwn(value, 'failurePoint');
    const hasGatewayReadDiagnostic = Object.hasOwn(
      value,
      'gatewayReadDiagnostic',
    );
    const hasWebBEditSaveDiagnostic = Object.hasOwn(
      value,
      'webBEditSaveDiagnostic',
    );
    if (
      (phaseKeys !== 'phase,status' &&
        phaseKeys !== 'failurePoint,phase,status' &&
        phaseKeys !== 'failurePoint,gatewayReadDiagnostic,phase,status' &&
        phaseKeys !== 'failurePoint,phase,status,webBEditSaveDiagnostic') ||
      !PHASE_SET.has(value.phase) ||
      !['passed', 'failed'].includes(value.status) ||
      (hasFailurePoint &&
        (failurePoint !== null ||
          !validJourneyFailurePoint(
            value.phase,
            value.status,
            value.failurePoint,
          ))) ||
      (hasGatewayReadDiagnostic &&
        (gatewayReadDiagnostic !== null ||
          !hasFailurePoint ||
          value.phase !== 'desktop-room-widget-read' ||
          !GATEWAY_READ_FAILURE_POINTS.has(value.failurePoint) ||
          !validDesktopGatewayReadFailureDiagnostic(
            value.gatewayReadDiagnostic,
          ))) ||
      (value.phase === 'web-member-b-edit-save' &&
        value.status === 'failed' &&
        (!hasFailurePoint ||
          !hasWebBEditSaveDiagnostic ||
          !WEB_B_EDIT_SAVE_FAILURE_POINT_SET.has(value.failurePoint) ||
          !validWebBEditSaveDiagnostic(
            value.webBEditSaveDiagnostic,
            value.failurePoint,
          ))) ||
      (hasWebBEditSaveDiagnostic &&
        (value.phase !== 'web-member-b-edit-save' ||
          value.status !== 'failed' ||
          !hasFailurePoint ||
          !WEB_B_EDIT_SAVE_FAILURE_POINT_SET.has(value.failurePoint) ||
          !validWebBEditSaveDiagnostic(
            value.webBEditSaveDiagnostic,
            value.failurePoint,
          ))) ||
      outcomes.has(value.phase)
    ) {
      invalidInput();
    }
    if (hasFailurePoint) {
      failurePoint = { phase: value.phase, point: value.failurePoint };
    }
    if (hasGatewayReadDiagnostic) {
      gatewayReadDiagnostic = value.gatewayReadDiagnostic;
    }
    if (hasWebBEditSaveDiagnostic) {
      webBEditSaveDiagnostic = value.webBEditSaveDiagnostic;
    }
    outcomes.set(value.phase, value.status);
  }
  return {
    outcomes,
    failurePoint,
    gatewayReadDiagnostic,
    webBEditSaveDiagnostic,
    loginStep,
    loginStepRecorded,
    loginEntry,
    loginDiagnostic,
    roomsReadyDiagnostic,
  };
}

export function readSyntheticDesktopCredentials({ filePath, runnerTemp }) {
  const path = privateRunnerPath(
    filePath,
    runnerTemp,
    JOURNEY_CREDENTIALS_NAME,
  );
  const stat = ownedPrivateFileStat(path);
  if (stat.size > MAX_CREDENTIAL_BYTES) {
    unlinkOwnedPrivateFile(path, stat);
    invalidInput();
  }

  let value;
  try {
    value = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    unlinkOwnedPrivateFile(path, stat);
    invalidInput();
  }
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== 'password,username' ||
    typeof value.username !== 'string' ||
    !/^element-[0-9a-f]{10}-a$/u.test(value.username) ||
    typeof value.password !== 'string' ||
    !/^[A-Za-z0-9_-]{32}$/u.test(value.password)
  ) {
    unlinkOwnedPrivateFile(path, stat);
    invalidInput();
  }

  unlinkOwnedPrivateFile(path, stat);
  return { username: value.username, password: value.password };
}

export function initializeDesktopJourneyEvidence({ filePath, runnerTemp }) {
  const path = privateRunnerPath(filePath, runnerTemp, JOURNEY_EVIDENCE_NAME);
  try {
    writeFileSync(path, '', { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  } catch {
    invalidInput();
  }
  privateFileStat(path, MAX_EVIDENCE_BYTES);
}

export function appendDesktopJourneyOutcome({
  filePath,
  runnerTemp,
  phase,
  status,
  failurePoint,
  gatewayReadDiagnostic,
  webBEditSaveDiagnostic,
}) {
  const path = privateRunnerPath(filePath, runnerTemp, JOURNEY_EVIDENCE_NAME);
  privateFileStat(path, MAX_EVIDENCE_BYTES);
  const parsed = parseEvidence(readFileSync(path, 'utf8'));
  if (
    !PHASE_SET.has(phase) ||
    !['passed', 'failed'].includes(status) ||
    (failurePoint !== undefined &&
      (!validJourneyFailurePoint(phase, status, failurePoint) ||
        parsed.failurePoint !== null)) ||
    (gatewayReadDiagnostic !== undefined &&
      (parsed.gatewayReadDiagnostic !== null ||
        phase !== 'desktop-room-widget-read' ||
        status !== 'failed' ||
        !GATEWAY_READ_FAILURE_POINTS.has(failurePoint) ||
        !validDesktopGatewayReadFailureDiagnostic(gatewayReadDiagnostic))) ||
    (phase === 'web-member-b-edit-save' &&
      status === 'failed' &&
      (failurePoint === undefined ||
        webBEditSaveDiagnostic === undefined ||
        !WEB_B_EDIT_SAVE_FAILURE_POINT_SET.has(failurePoint) ||
        !validWebBEditSaveDiagnostic(webBEditSaveDiagnostic, failurePoint))) ||
    (webBEditSaveDiagnostic !== undefined &&
      (phase !== 'web-member-b-edit-save' ||
        status !== 'failed' ||
        failurePoint === undefined ||
        !WEB_B_EDIT_SAVE_FAILURE_POINT_SET.has(failurePoint) ||
        !validWebBEditSaveDiagnostic(webBEditSaveDiagnostic, failurePoint)))
  ) {
    invalidInput();
  }
  if (parsed.outcomes.has(phase)) invalidInput();

  try {
    appendFileSync(
      path,
      `${JSON.stringify({
        phase,
        status,
        ...(failurePoint === undefined ? {} : { failurePoint }),
        ...(gatewayReadDiagnostic === undefined
          ? {}
          : { gatewayReadDiagnostic }),
        ...(webBEditSaveDiagnostic === undefined
          ? {}
          : { webBEditSaveDiagnostic }),
      })}\n`,
      {
        encoding: 'utf8',
        mode: 0o600,
      },
    );
  } catch {
    invalidInput();
  }
  privateFileStat(path, MAX_EVIDENCE_BYTES);
}

export function appendDesktopLoginStep({
  filePath,
  runnerTemp,
  step,
  entry,
  diagnostic,
  roomsReadyDiagnostic,
}) {
  const path = privateRunnerPath(filePath, runnerTemp, JOURNEY_EVIDENCE_NAME);
  privateFileStat(path, MAX_EVIDENCE_BYTES);
  const parsed = parseEvidence(readFileSync(path, 'utf8'));
  if (
    !LOGIN_STEP_SET.has(step) ||
    (entry !== undefined && !LOGIN_ENTRY_SET.has(entry)) ||
    parsed.loginStepRecorded ||
    (diagnostic !== undefined && !validDesktopLoginDiagnostic(diagnostic)) ||
    (diagnostic !== undefined && step === 'complete') ||
    (roomsReadyDiagnostic !== undefined &&
      (step !== 'rooms_ready' ||
        diagnostic !== undefined ||
        !validRoomsReadyDiagnostic(roomsReadyDiagnostic)))
  ) {
    invalidInput();
  }

  try {
    appendFileSync(
      path,
      `${JSON.stringify({
        loginStep: step,
        ...(entry === undefined ? {} : { loginEntry: entry }),
        ...(diagnostic === undefined ? {} : { loginDiagnostic: diagnostic }),
        ...(roomsReadyDiagnostic === undefined ? {} : { roomsReadyDiagnostic }),
      })}\n`,
      {
        encoding: 'utf8',
        mode: 0o600,
      },
    );
  } catch {
    invalidInput();
  }
  privateFileStat(path, MAX_EVIDENCE_BYTES);
}

export function summarizeDesktopJourneyEvidence(input) {
  const {
    outcomes,
    failurePoint,
    loginStep,
    loginEntry,
    loginDiagnostic,
    roomsReadyDiagnostic,
    gatewayReadDiagnostic,
    webBEditSaveDiagnostic,
  } = parseEvidence(input);
  if (outcomes.get('desktop-login') === 'passed') {
    if (
      loginStep !== 'complete' ||
      !['password_form_present', 'welcome_sign_in_clicked'].includes(loginEntry)
    ) {
      invalidInput();
    }
  }
  const cases = Object.fromEntries(
    DESKTOP_JOURNEY_PHASES.map((phase) => [
      phase,
      outcomes.get(phase) ?? 'not_run',
    ]),
  );
  const failed = Object.values(cases).includes('failed');
  const complete = Object.values(cases).every((value) => value === 'passed');
  return {
    schemaVersion: 8,
    status: failed ? 'failed' : complete ? 'passed' : 'incomplete',
    loginStep,
    loginEntry,
    loginDiagnostic,
    roomsReadyDiagnostic,
    failurePoint,
    gatewayReadDiagnostic,
    webBEditSaveDiagnostic,
    cases,
  };
}

export function readDesktopJourneyEvidence({ filePath, runnerTemp }) {
  const path = privateRunnerPath(filePath, runnerTemp, JOURNEY_EVIDENCE_NAME);
  if (!existsSync(path)) return summarizeDesktopJourneyEvidence('');
  privateFileStat(path, MAX_EVIDENCE_BYTES);
  return summarizeDesktopJourneyEvidence(readFileSync(path, 'utf8'));
}

if (
  process.argv[1] === fileURLToPath(import.meta.url) &&
  process.argv[2] === 'summary'
) {
  try {
    const runnerTemp = process.env.RUNNER_TEMP;
    const filePath = process.env.ELEMENT_DESKTOP_JOURNEY_STAGE_FILE;
    const summary = readDesktopJourneyEvidence({ filePath, runnerTemp });
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  } catch {
    process.stderr.write('Desktop journey evidence is unavailable.\n');
    process.exitCode = 1;
  }
}
