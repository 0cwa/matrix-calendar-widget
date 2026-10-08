/* Modified for Matrix Calendar Widget fork, 2026. */
/*
 * Copyright 2026 Matrix Calendar Widget contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  expect,
  test,
  type BrowserContext,
  type FrameLocator,
  type Locator,
  type Page,
  type Request,
  type Response,
} from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { arch, platform, release } from 'node:os';
import { isAbsolute, resolve, sep } from 'node:path';
import {
  beginG6ResourceCreate,
  createG6ResourceOwnership,
  g6EventSummaryMatches,
  g6GatewayResourceIdentityMatches,
  g6ResourceCleanupRequest,
  isStrongG6ResourceEtag,
  recordG6ResourceCleanup,
  recordG6ResourceCreate,
  recordG6ResourceUpdate,
  summarizeG6ResourceOwnership,
  type G6ResourceOwnership,
} from '../../dev/element-g6-resource-ownership.mjs';
import { ElementWebPage } from './pages/elementWebPage';

type User = {
  userId: string;
  accessToken: string;
  deviceId: string;
};

type Fixture = {
  homeserverUrl: string;
  elementUrl: string;
  gatewayUrl: string;
  widgetUrl: string;
  roomName: string;
  outsiderRoomName: string;
  calendarId: string;
  outsiderRoomId: string;
  teamRoomId: string;
  users: {
    memberA: User;
    memberB: User;
    outsider: User;
  };
  serviceSender: {
    userId: string;
    accessToken: string;
  };
};

type ReminderFlow = 'initial' | 'restart' | 'restore';

type ReminderTimelineSnapshot = {
  httpStatus: number | null;
  complete: boolean;
  markerCounts: number[];
  markerMentions: boolean[];
  markerTimestamps: Array<number | null>;
};

type ReminderConfigurationStep =
  | 'event-details'
  | 'notify-control'
  | 'options-load'
  | 'eligible-option'
  | 'put-response'
  | 'complete';

type ReminderConfigurationObservation = {
  reminderStep: ReminderConfigurationStep;
  notifyButtonCount: number;
  notifyButtonVisible: boolean;
  reminderOptionsGetCount: number;
  reminderOptionsGetStatus: number;
  reminderConfigGetCount: number;
  reminderConfigGetStatus: number;
  reminderEligibleOptionCount: number;
  reminderOptionCheckedBefore: boolean;
  reminderOptionCheckAttempted: boolean;
  reminderPutCount: number;
  reminderPutStatus: number;
  reminderOptionCheckedAfter: boolean;
};

type G6Phase =
  | 'g6-fixture-ready'
  | 'g6-unsupported-preservation'
  | 'g6-delete-and-refresh'
  | 'g6-keyboard-focus'
  | 'g6-side-panel-layout'
  | 'g6-browser-egress'
  | 'g6-resource-cleanup';

type G6NeighborTitleOutcome = 'matched' | 'mismatched' | 'unavailable';
type G6CanonicalTitleReadbackOutcome =
  | 'not-needed'
  | 'not-owned'
  | 'matched'
  | 'mismatched'
  | 'unavailable';
type G6PostSaveListResponseOutcome =
  | 'not-observed'
  | 'decoding'
  | 'unexpected-status'
  | 'decode-error'
  | 'invalid-response'
  | 'decoded'
  | 'decoded-overflow';

type G6PostSaveListResponseObservation = {
  outcome: G6PostSaveListResponseOutcome;
  httpStatus: number | null;
  eventCountCapped?: number;
  eventCountOverflow?: boolean;
  editedTitleMatches?: boolean;
};

type G6PostSaveListObserver = {
  snapshot: () => G6PostSaveListResponseObservation;
  dispose: () => void;
};

type G6PostSaveListUiObservation =
  | {
      state: 'observed';
      loadingVisible: boolean;
      errorVisible: boolean;
      editedRowCountCapped: number;
      editedRowCountOverflow: boolean;
      editedRowVisible: boolean;
    }
  | { state: 'unavailable' };

type G6SidePanelControlVisibility =
  | 'absent'
  | 'visible'
  | 'hidden'
  | 'ambiguous'
  | 'unavailable';
type G6SidePanelControlEnabled =
  | 'absent'
  | 'enabled'
  | 'disabled'
  | 'ambiguous'
  | 'unavailable';
type G6SidePanelToolbarObservation = {
  managementToolbarNavCountCapped: number | null;
  managementToolbarNavVisibility: G6SidePanelControlVisibility;
  createEventButtonCountCapped: number | null;
  createEventButtonVisibility: G6SidePanelControlVisibility;
  createEventButtonEnabled: G6SidePanelControlEnabled;
};

type G6StageRecord = {
  phase: G6Phase;
  status: 'passed' | 'failed';
  httpStatus?: number;
  count?: number;
  openIdProofValid?: boolean;
  allResourcesSeeded?: boolean;
  seedCreateObservations?: G6SeedCreateObservation[];
  projectionHttpStatus?: number;
  canonicalBeforeHttpStatus?: number;
  neighborPatchHttpStatus?: number;
  canonicalAfterHttpStatus?: number;
  memberBEventsHttpStatus?: number;
  deleteHttpStatus?: number;
  canonicalDeleteHttpStatus?: number;
  memberBReloadHttpStatus?: number;
  unsupportedWarningVisible?: boolean;
  unsupportedRowOmitted?: boolean;
  supportedNeighborVisible?: boolean;
  canonicalSnapshotAvailable?: boolean;
  neighborEditedRowVisible?: boolean;
  supportedNeighborEdited?: boolean;
  canonicalUnsupportedObjectUnchanged?: boolean;
  neighborOwnershipUpdated?: boolean;
  neighborUpdateIdentityMatches?: boolean;
  neighborPatchTitleOutcome?: G6NeighborTitleOutcome;
  neighborCanonicalTitleReadbackOutcome?: G6CanonicalTitleReadbackOutcome;
  neighborCanonicalTitleReadbackHttpStatus?: number;
  neighborListRefreshOutcome?: G6PostSaveListResponseOutcome;
  neighborListRefreshHttpStatus?: number | null;
  neighborListRefreshEventCountCapped?: number;
  neighborListRefreshEventCountOverflow?: boolean;
  neighborListRefreshEditedTitleMatches?: boolean;
  neighborListUiObservation?: 'observed' | 'unavailable';
  neighborListLoadingVisible?: boolean;
  neighborListErrorVisible?: boolean;
  neighborEditedRowCountCapped?: number;
  neighborEditedRowCountOverflow?: boolean;
  deleteButtonVisible?: boolean;
  deleteConfirmationVisible?: boolean;
  deletedRowAbsent?: boolean;
  canonicalObjectAbsent?: boolean;
  memberBDeleteRowVisible?: boolean;
  memberBDeleteRowAbsent?: boolean;
  keyboardEventFocused?: boolean;
  detailsOpened?: boolean;
  editActionFocused?: boolean;
  deleteActionFocused?: boolean;
  closeActionFocused?: boolean;
  escapeClosedDialog?: boolean;
  focusReturnedToEvent?: boolean;
  widgetCardVisible?: boolean;
  createControlReachable?: boolean;
  eventDetailsReachable?: boolean;
  hostNoHorizontalOverflow?: boolean;
  widgetNoHorizontalOverflow?: boolean;
  persistedHostFramePresent?: boolean;
  browserEgressClear?: boolean;
  allOwnedResourcesRemoved?: boolean;
  plannedCount?: number;
  confirmedCreatedCount?: number;
  conflictCount?: number;
  notCreatedCount?: number;
  createUnresolvedCount?: number;
  deletedCount?: number;
  alreadyAbsentCount?: number;
  cleanupUnresolvedCount?: number;
  viewportWidth?: number;
  viewportHeight?: number;
  iframeWidth?: number;
  iframeHeight?: number;
  widgetCardCount?: number;
  appDrawerCount?: number;
  managementToolbarNavCountCapped?: number | null;
  managementToolbarNavVisibility?: G6SidePanelControlVisibility;
  createEventButtonCountCapped?: number | null;
  createEventButtonVisibility?: G6SidePanelControlVisibility;
  createEventButtonEnabled?: G6SidePanelControlEnabled;
  eventActionTabCount?: number;
  detailsActionTabCount?: number;
};

type G6SeedCreateObservation = {
  outcome:
    | 'response'
    | 'timeout'
    | 'aborted'
    | 'network-error'
    | 'other-error'
    | 'not-sent';
  status: number | null;
  etagPresent: boolean | null;
  etagStrong: boolean | null;
};

type G6CalDavClient = {
  authorization: string;
  collectionUrl: URL;
};

type G6CalDavResult = {
  outcome:
    | 'response'
    | 'timeout'
    | 'aborted'
    | 'network-error'
    | 'other-error'
    | 'not-sent';
  status?: number;
  bytes?: Buffer;
  etag?: string;
};

const ELEMENT_WEB_CONFIGURED_TAG = 'v1.12.30';
const G6_POSTSAVE_EVENT_COUNT_CAP = 100;

const REMINDER_START_LEAD_MS = 150_000;
const REMINDER_ALARM_OFFSET_MS = 60_000;
// Allow one default 60-second scheduler interval plus its 30-second scan deadline.
const REMINDER_SCAN_INTERVAL_MS = 60_000;
const REMINDER_SCAN_DEADLINE_MS = 30_000;
const REMINDER_POST_DUE_SCAN_ALLOWANCE_MS =
  REMINDER_SCAN_INTERVAL_MS + REMINDER_SCAN_DEADLINE_MS;
const REMINDER_TIMELINE_POLL_MS = 5_000;

type Phase =
  | 'member-a-authenticated'
  | 'member-a-origin-navigation'
  | 'member-a-credentials-seeded'
  | 'member-a-root-navigation'
  | 'member-a-session-observed'
  | 'member-b-authenticated'
  | 'outsider-authenticated'
  | 'member-a-room-navigation'
  | 'member-a-room-context'
  | 'member-b-room-context'
  | 'outsider-room-context'
  | 'widget-a-room-info-button'
  | 'widget-a-extensions-menuitem'
  | 'widget-a-extension-row'
  | 'widget-a-warning-not-required'
  | 'widget-a-capabilities-approval'
  | 'widget-a-identity-dialog-observed'
  | 'widget-a-identity-dialog-not-required'
  | 'widget-a-identity-approval'
  | 'widget-a-iframe-attached'
  | 'widget-a-runtime-observed'
  | 'widget-a-iframe-ready'
  | 'widget-a-approved'
  | 'widget-b-approved'
  | 'outsider-widget-approved'
  | 'gateway-backed-read'
  | 'event-create-dialog'
  | 'event-create-calendar-selected'
  | 'event-create-title-entered'
  | 'event-create-submit'
  | 'event-create-response'
  | 'event-create-post-refresh-observed'
  | 'event-create-visible'
  | 'event-created'
  | 'shared-visibility'
  | 'member-a-edited'
  | 'outsider-room-widget-team-target'
  | 'outsider-room-events-api-team-target'
  | 'outsider-own-unbound-room'
  | 'stale-etag-conflict'
  | 'canonical-read-after-denial'
  | 'browser-egress'
  | 'reminder-browser-egress'
  | 'reminder-room-context'
  | 'reminder-widget-context'
  | 'reminder-event-create-dialog'
  | 'reminder-event-created'
  | 'reminder-event-visible'
  | 'reminder-alarm-ui-readback'
  | 'reminder-room-configuration-enabled'
  | 'reminder-ui-readback'
  | 'reminder-initial-delivery'
  | 'reminder-restart-prior-state'
  | 'reminder-restart-scheduler-scan'
  | 'reminder-restart-no-duplicate'
  | 'reminder-restore-prior-state'
  | 'reminder-restore-scheduler-scan'
  | 'reminder-restore-no-duplicate'
  | 'g6-member-a-room-context'
  | 'g6-member-b-room-context'
  | G6Phase;
type MemberRoomContextPhase =
  | 'member-a-room-context'
  | 'reminder-room-context'
  | 'g6-member-a-room-context'
  | 'g6-member-b-room-context';

type BrowserActor = 'member-a' | 'member-b' | 'outsider';
type BlockedRequestClass =
  | 'fixture-host-origin-mismatch'
  | 'matrix-client-well-known-discovery'
  | 'matrix-server-well-known-discovery'
  | 'non-http-scheme'
  | 'invalid-url'
  | 'unapproved-loopback-origin'
  | 'external-http-origin';
type BlockedRequestResourceType =
  | 'document'
  | 'stylesheet'
  | 'image'
  | 'media'
  | 'font'
  | 'script'
  | 'texttrack'
  | 'xhr'
  | 'fetch'
  | 'eventsource'
  | 'websocket'
  | 'manifest'
  | 'other';
type BlockedRequestDiagnostic = {
  actor: BrowserActor;
  // Sampled shared harness phase; asynchronous requests can outlive an action.
  harnessPhase: Phase;
  requestClass: BlockedRequestClass;
  resourceType: BlockedRequestResourceType;
  count: number;
};
type BlockedRequestEvidence = {
  diagnostics: Map<string, BlockedRequestDiagnostic>;
  overflow: boolean;
};

type MatrixSyncState =
  | 'ERROR'
  | 'PREPARED'
  | 'RECONNECTING'
  | 'STOPPED'
  | 'SYNCING'
  | 'CATCHUP'
  | 'UNKNOWN';

type MemberARoomObservation = {
  matrixUserMatches: boolean;
  matrixRoomKnown: boolean;
  matrixRoomJoined: boolean;
  matrixSyncState: MatrixSyncState;
  roomNavigationCompleted: boolean;
  roomHeadingReady: boolean;
  roomHeadingPresent: boolean;
  roomNameMatches: boolean;
  roomIdMatches: boolean;
  roomViewPresent?: boolean;
  roomHeaderPresent?: boolean;
  roomHeadingDomPresent?: boolean;
  roomInfoControlPresent?: boolean;
  fixtureCalendarIframePresent?: boolean;
  blockedExternalRequestCount: number;
  homeserverHttpErrorCount: number;
  homeserverLastHttpErrorStatus?: number;
};
type ReminderWidgetContextResponseSnapshot = {
  reminderWidgetContextResponseCount: number;
  reminderWidgetContextResponseStatus?: number;
};
type ReminderWidgetContextResponseObserver = {
  response: Promise<Response>;
  snapshot: () => ReminderWidgetContextResponseSnapshot;
};

type MemberARoomFailureCode =
  | 'element-room-navigation-failed'
  | 'element-room-observation-unavailable'
  | 'element-room-session-mismatch'
  | 'element-room-not-known'
  | 'element-room-not-joined'
  | 'element-room-route-mismatch'
  | 'element-room-heading-not-present'
  | 'element-room-name-mismatch'
  | 'element-room-heading-wait-timeout';

type MemberARoomResult = {
  element: ElementWebPage;
  navigationCompleted: boolean;
  observation?: MemberARoomObservation;
  failureCode?: MemberARoomFailureCode;
};

type OpenCalendarWidgetOptions = {
  expectWidgetWarning: boolean;
  waitForCalendar?: boolean;
  captureMemberADiagnostics?: boolean;
};

type HomeserverHttpFailures = {
  count: number;
  lastStatus?: number;
};

type PinnedControlObservation = {
  phase: Phase;
  count: number;
  controlVisible: boolean;
  panelPresent?: boolean;
};

type GatewayEndpointKind =
  | 'context'
  | 'calendars'
  | 'events'
  | 'other-calendar'
  | 'other-api';

type GatewayRequestMethod =
  | 'GET'
  | 'POST'
  | 'PATCH'
  | 'PUT'
  | 'DELETE'
  | 'OPTIONS'
  | 'HEAD'
  | 'OTHER';

type WidgetResourceKind = 'document' | 'script' | 'stylesheet';

type WidgetDocumentReadyState =
  | 'loading'
  | 'interactive'
  | 'complete'
  | 'unavailable';

type WidgetPageErrorClass =
  | 'Error'
  | 'TypeError'
  | 'ReferenceError'
  | 'SyntaxError'
  | 'RangeError'
  | 'URIError'
  | 'EvalError'
  | 'AggregateError'
  | 'OTHER'
  | 'NONE';

type OpenIdProtocolState = 'none' | 'allowed' | 'request' | 'blocked' | 'other';

type AcceptanceRuntimeObservation = {
  requestCounts: Record<GatewayEndpointKind, number>;
  optionsRequestCount: number;
  failedRequestCount: number;
  lastRequestEndpoint: GatewayEndpointKind | 'none';
  lastRequestMethod: GatewayRequestMethod | 'NONE';
  lastResponseEndpoint: GatewayEndpointKind | 'none';
  lastResponseMethod: GatewayRequestMethod | 'NONE';
  lastResponseStatus?: number;
  iframeObservationAvailable: boolean;
  iframeGatewayBaseOriginMatches: boolean;
  iframeRoomIdMatches: boolean;
  createEventVisible: boolean;
  identityContinueVisible: boolean;
  widgetResourceRequestCounts: Record<WidgetResourceKind, number>;
  widgetResourceFailureCounts: Record<WidgetResourceKind, number>;
  widgetResourceLastStatuses: Partial<Record<WidgetResourceKind, number>>;
  openIdRequestCount: number;
  openIdOptionsRequestCount: number;
  openIdFailedRequestCount: number;
  openIdLastRequestMethod: GatewayRequestMethod | 'NONE';
  openIdLastResponseStatus?: number;
  widgetFrameAvailable: boolean;
  widgetDocumentReadyState: WidgetDocumentReadyState;
  widgetRootHasChildren: boolean;
  widgetLoadingVisible: boolean;
  widgetMissingCapabilitiesVisible: boolean;
  widgetRegistrationErrorVisible: boolean;
  widgetOutsideClientVisible: boolean;
  widgetChildErrorVisible: boolean;
  widgetPageErrorCount: number;
  widgetLastPageErrorClass: WidgetPageErrorClass;
  widgetApiParentObserverAvailable: boolean;
  widgetApiGetOpenIdRequestCount: number;
  widgetApiRequestSourceMatches: boolean;
  widgetApiRequestOriginMatches: boolean;
  widgetApiRequestWidgetIdMatches: boolean;
  widgetApiInitialResponseCount: number;
  widgetApiInitialResponseState: OpenIdProtocolState;
  widgetApiInitialResponseSourceMatches: boolean;
  widgetApiInitialResponseOriginMatches: boolean;
  widgetApiInitialResponseWidgetIdMatches: boolean;
  widgetApiFollowupCount: number;
  widgetApiFollowupState: OpenIdProtocolState;
  widgetApiFollowupRequestIdMatches: boolean;
  widgetApiFollowupSourceMatches: boolean;
  widgetApiFollowupOriginMatches: boolean;
  widgetApiFollowupWidgetIdMatches: boolean;
  widgetParametersObserved: boolean;
  widgetGatewayBaseOriginMatches: boolean;
  widgetRoomIdMatches: boolean;
  widgetIdParameterPresent: boolean;
  calendarEventsLoadingVisible: boolean;
  calendarEventsLoadErrorVisible: boolean;
  createEventEnabled: boolean;
};

type PostCreateVisibilityObservation = {
  postCreateEventGetRequestCount: number;
  roomTargetRangeRequestCount: number;
  expectedRoomRangeRequestSeen: boolean;
  roomTargetRangeResponseCount: number;
  roomTargetRangeLastStatus: number | null;
  createResponseHasEvent: boolean;
  createResponseTitleMatches: boolean;
  createResponseCalendarMatches: boolean;
  createResponseTimingComparable: boolean;
  createResponseEventIntersectsRoomRange: boolean;
  caldavReportProbeCompleted: boolean;
  caldavOpenIdHttpStatus: number | null;
  caldavReportHttpStatus: number | null;
  caldavReportContainsCreatedEvent: boolean | null;
  caldavProjection: CalDavProjectionObservation;
  roomListResponseHasEventsArray: boolean;
  roomListResponseEventCount: number;
  roomListDiagnostics: ProjectionDiagnosticSummary;
  roomListResponseTitleMatches: boolean;
  roomListResponseIdMatches: boolean;
  roomListResponseCalendarMatches: boolean;
  listViewHeadingPresent: boolean;
  matchingListItemCount: number;
};

const PROJECTION_DIAGNOSTIC_REASONS = [
  'invalid-recurrence',
  'invalid-timing',
  'occurrence-limit',
  'recurrence-input-limit',
  'unsupported-recurrence',
  'unsupported-timezone',
  'range-this-and-future',
] as const;

type ProjectionDiagnosticReason =
  (typeof PROJECTION_DIAGNOSTIC_REASONS)[number];

type ProjectionDiagnosticCounts = Record<ProjectionDiagnosticReason, number>;

type ProjectionDiagnosticSummary = {
  complete: boolean;
  counts: ProjectionDiagnosticCounts;
};

type CalDavProjectionDiagnosticCode =
  | ProjectionDiagnosticReason
  | 'none'
  | 'inconclusive';

type TimezoneAuditClassification =
  | 'unsupported-zone-id'
  | 'no-embedded-definition'
  | 'duplicate-definitions'
  | 'embedded-definition-mismatch'
  | 'embedded-definition-matches'
  | 'other-unsupported-timezone'
  | 'no-zoned-start'
  | 'inconclusive';

type TimezoneSafetyObservation = {
  completed: boolean;
  parsedEventUnsupportedTimezone: boolean | null;
  bundledZoneId: boolean | null;
  embeddedDefinitionCount: number;
  canonicalEmbeddedDefinitionMatches: boolean | null;
  classification: TimezoneAuditClassification;
};

type CalDavProjectionObservation = {
  completed: boolean;
  includesCreatedEvent: boolean | null;
  diagnosticCode: CalDavProjectionDiagnosticCode;
  diagnosticCounts: ProjectionDiagnosticCounts;
  timezoneAudit: TimezoneSafetyObservation;
};

function unavailableTimezoneAudit(): TimezoneSafetyObservation {
  return {
    completed: false,
    parsedEventUnsupportedTimezone: null,
    bundledZoneId: null,
    embeddedDefinitionCount: 0,
    canonicalEmbeddedDefinitionMatches: null,
    classification: 'inconclusive',
  };
}

function emptyProjectionDiagnosticCounts(): ProjectionDiagnosticCounts {
  return Object.fromEntries(
    PROJECTION_DIAGNOSTIC_REASONS.map((reason) => [reason, 0]),
  ) as ProjectionDiagnosticCounts;
}

function summarizeProjectionDiagnostics(
  value: unknown,
): ProjectionDiagnosticSummary {
  const counts = emptyProjectionDiagnosticCounts();
  if (!Array.isArray(value)) return { complete: false, counts };

  for (const diagnostic of value) {
    if (
      !isRecord(diagnostic) ||
      typeof diagnostic.reason !== 'string' ||
      !PROJECTION_DIAGNOSTIC_REASONS.includes(
        diagnostic.reason as ProjectionDiagnosticReason,
      ) ||
      !Number.isInteger(diagnostic.count) ||
      Number(diagnostic.count) < 0
    ) {
      return { complete: false, counts: emptyProjectionDiagnosticCounts() };
    }
    const reason = diagnostic.reason as ProjectionDiagnosticReason;
    counts[reason] = Math.min(counts[reason] + Number(diagnostic.count), 2);
  }

  return { complete: true, counts };
}

let fixture: Fixture;

let activePhase: Phase = 'member-a-authenticated';
let activeReminderFailureRecorded = false;
let pendingPinnedControlObservation: PinnedControlObservation | undefined;
const memberAHomeserverHttpFailures = new WeakMap<
  Page,
  HomeserverHttpFailures
>();
const blockedExternalRequestsByContext = new WeakMap<
  BrowserContext,
  { count: number }
>();
const memberABlockedExternalRequests = new WeakMap<Page, { count: number }>();
const BLOCKED_REQUEST_RESOURCE_TYPES = new Set<BlockedRequestResourceType>([
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
const MAX_BLOCKED_REQUEST_DIAGNOSTIC_BUCKETS = 32;

test('Element Web members share events and enforce room authorization', async ({
  browser,
}) => {
  fixture = readFixture();
  const contexts: BrowserContext[] = [];
  let blockedExternalRequests = 0;
  const blockedRequestEvidence: BlockedRequestEvidence = {
    diagnostics: new Map(),
    overflow: false,
  };
  const allowedOrigins = new Set([
    new URL(fixture.elementUrl).origin,
    new URL(fixture.homeserverUrl).origin,
    'http://localhost:8008',
    new URL(fixture.gatewayUrl).origin,
    'http://127.0.0.1:8080',
  ]);
  const fixtureHosts = new Set([
    ...Array.from(allowedOrigins, (origin) => new URL(origin).hostname),
    'synapse',
    'radicale',
    'gateway',
    'widget',
    'element',
  ]);

  const makeContext = async (actor: BrowserActor) => {
    const context = await browser.newContext({
      locale: 'en-US',
      timezoneId: 'Europe/Stockholm',
      viewport: { width: 1440, height: 900 },
    });
    const contextBlockedRequests = { count: 0 };
    blockedExternalRequestsByContext.set(context, contextBlockedRequests);
    contexts.push(context);
    await context.route('**/*', async (route) => {
      let requestUrl: URL;
      try {
        requestUrl = new URL(route.request().url());
      } catch {
        blockedExternalRequests += 1;
        contextBlockedRequests.count = Math.min(
          contextBlockedRequests.count + 1,
          100_000,
        );
        const request = route.request();
        recordBlockedRequest(
          blockedRequestEvidence,
          actor,
          activePhase,
          'invalid-url',
          safeBlockedRequestResourceType(request.resourceType()),
        );
        await route.abort('blockedbyclient');
        return;
      }

      if (!allowedOrigins.has(requestUrl.origin)) {
        blockedExternalRequests += 1;
        contextBlockedRequests.count = Math.min(
          contextBlockedRequests.count + 1,
          100_000,
        );
        const request = route.request();
        recordBlockedRequest(
          blockedRequestEvidence,
          actor,
          activePhase,
          classifyBlockedRequest(requestUrl, fixtureHosts),
          safeBlockedRequestResourceType(request.resourceType()),
        );
        await route.abort('blockedbyclient');
        return;
      }
      await route.continue();
    });
    return context;
  };

  let contextA: BrowserContext | undefined;
  let contextB: BrowserContext | undefined;
  let contextC: BrowserContext | undefined;
  let pageA: Page | undefined;
  let pageB: Page | undefined;
  let pageC: Page | undefined;
  let memberARuntimeObservation: AcceptanceRuntimeObservation | undefined;
  let failureHttpStatus: number | undefined;
  let failureTeamRoomMatches: boolean | undefined;
  let failureAlreadyReported = false;

  try {
    recordRuntimeVersions(browser.version());

    activePhase = 'member-a-authenticated';
    contextA = await makeContext('member-a');
    pageA = await authenticateInElement(contextA, fixture.users.memberA, true);
    memberARuntimeObservation = await observeAcceptanceRuntime(pageA, {
      gatewayUrl: fixture.gatewayUrl,
      homeserverUrl: fixture.homeserverUrl,
      widgetUrl: fixture.widgetUrl,
    });
    record(activePhase, 'passed');

    activePhase = 'member-b-authenticated';
    contextB = await makeContext('member-b');
    pageB = await authenticateInElement(contextB, fixture.users.memberB);
    record(activePhase, 'passed');

    activePhase = 'outsider-authenticated';
    contextC = await makeContext('outsider');
    pageC = await authenticateInElement(contextC, fixture.users.outsider);
    record(activePhase, 'passed');

    activePhase = 'member-a-room-navigation';
    const memberARoom = await openMemberARoomWithDiagnostics(
      pageA,
      fixture.roomName,
      fixture.teamRoomId,
      fixture.users.memberA.userId,
    );
    record(activePhase, memberARoom.navigationCompleted ? 'passed' : 'failed');
    activePhase = 'member-a-room-context';
    recordMemberARoomObservation(memberARoom);
    failureAlreadyReported = Boolean(memberARoom.failureCode);
    const elementA = requireMemberARoom(memberARoom);
    activePhase = 'widget-a-approved';
    const firstRead = waitForGatewayResponse(
      pageA,
      'GET',
      '/v1/calendar/events',
    );
    void firstRead.catch(() => undefined);
    const frameA = await openCalendarWidget(elementA, pageA, {
      expectWidgetWarning: false,
      waitForCalendar: false,
      captureMemberADiagnostics: true,
    });
    activePhase = 'gateway-backed-read';
    let firstReadResponse: Response;
    try {
      firstReadResponse = await firstRead;
    } catch {
      await recordWidgetRuntimeObservation(
        pageA,
        frameA,
        memberARuntimeObservation,
      );
      throw new Error('Initial calendar event request was not observed');
    }
    await recordWidgetRuntimeObservation(
      pageA,
      frameA,
      memberARuntimeObservation,
    );
    failureHttpStatus = firstReadResponse.status();
    expect(failureHttpStatus).toBe(200);
    record(activePhase, 'passed', failureHttpStatus);
    failureHttpStatus = undefined;
    activePhase = 'widget-a-iframe-ready';
    await frameA
      .getByRole('button', { name: 'Create event', exact: true })
      .waitFor({ timeout: 30_000 });
    record(activePhase, 'passed');
    activePhase = 'widget-a-approved';
    record('widget-a-approved', 'passed');

    const eventTitle = `Acceptance ${randomUUID()}`;
    activePhase = 'event-create-dialog';
    await frameA
      .getByRole('button', { name: 'Create event', exact: true })
      .click();
    const createDialog = frameA.getByRole('dialog').last();
    await expect(createDialog).toBeVisible({ timeout: 15_000 });
    record(activePhase, 'passed');

    activePhase = 'event-create-calendar-selected';
    await createDialog
      .getByRole('combobox', { name: 'Calendar' })
      .selectOption({
        value: `matrix-calendar-target://room/${encodeURIComponent(fixture.calendarId)}`,
      });
    record(activePhase, 'passed');

    activePhase = 'event-create-title-entered';
    await createDialog.getByRole('textbox', { name: 'Title' }).fill(eventTitle);
    record(activePhase, 'passed');

    activePhase = 'event-create-submit';
    const createResponse = waitForGatewayResponse(
      pageA,
      'POST',
      '/v1/calendar/events',
    );
    const postCreateVisibility = observePostCreateVisibility(pageA, {
      expectedCalendarId: fixture.calendarId,
      expectedRoomId: fixture.teamRoomId,
      expectedTitle: eventTitle,
    });
    await createDialog
      .getByRole('button', { name: 'Create event', exact: true })
      .click();
    record(activePhase, 'passed');

    activePhase = 'event-create-response';
    const createResponseResult = await createResponse;
    failureHttpStatus = createResponseResult.status();
    expect(createResponseResult.status()).toBeGreaterThanOrEqual(200);
    expect(createResponseResult.status()).toBeLessThan(300);
    record(activePhase, 'passed', failureHttpStatus);
    failureHttpStatus = undefined;
    await postCreateVisibility.observeCreatedEvent(createResponseResult);

    activePhase = 'event-create-visible';
    record(activePhase, 'started');
    const eventRow = frameA.getByRole('listitem', { name: eventTitle });
    let eventVisible = false;
    try {
      await expect(eventRow).toBeVisible({ timeout: 15_000 });
      eventVisible = true;
    } catch {
      // The bounded observation below distinguishes the gateway refresh from
      // the widget's rendered list without retaining the failed assertion.
    }
    const postCreateObservation = await postCreateVisibility.collect(
      frameA,
      eventRow,
    );
    appendPostCreateVisibilityObservation(postCreateObservation);
    expect(eventVisible).toBe(true);
    record(activePhase, 'passed');

    activePhase = 'event-created';
    record(activePhase, 'passed', createResponseResult.status());

    activePhase = 'member-b-room-context';
    const elementB = await openFixtureRoom(
      pageB,
      fixture.roomName,
      fixture.teamRoomId,
    );
    record(activePhase, 'passed');
    activePhase = 'widget-b-approved';
    const memberBRead = waitForGatewayResponse(
      pageB,
      'GET',
      '/v1/calendar/events',
    );
    const frameB = await openCalendarWidget(elementB, pageB, {
      expectWidgetWarning: true,
    });
    const memberBReadResult = await memberBRead;
    expect(memberBReadResult.status()).toBe(200);
    record(activePhase, 'passed');

    activePhase = 'shared-visibility';
    await expect(
      frameB.getByRole('listitem', { name: eventTitle }),
    ).toBeVisible();
    await openEventEditor(frameB, eventTitle);
    await frameB
      .getByRole('dialog')
      .last()
      .getByRole('textbox', { name: 'Title' })
      .fill('Member B stale draft');
    record(activePhase, 'passed');

    activePhase = 'member-a-edited';
    await openEventEditor(frameA, eventTitle);
    const updateResponse = waitForGatewayResponse(
      pageA,
      'PATCH',
      '/v1/calendar/events',
    );
    await frameA
      .getByRole('dialog')
      .last()
      .getByRole('textbox', { name: 'Title' })
      .fill('Member A canonical edit');
    await frameA
      .getByRole('dialog')
      .last()
      .getByRole('button', { name: 'Save', exact: true })
      .click();
    const updateResponseResult = await updateResponse;
    expect(updateResponseResult.status()).toBeGreaterThanOrEqual(200);
    expect(updateResponseResult.status()).toBeLessThan(300);
    record(activePhase, 'passed', updateResponseResult.status());

    activePhase = 'outsider-room-context';
    const elementC = await openFixtureRoom(
      pageC,
      fixture.outsiderRoomName,
      fixture.outsiderRoomId,
    );
    record(activePhase, 'passed');
    expect(fixture.outsiderRoomId).not.toBe(fixture.teamRoomId);
    activePhase = 'outsider-widget-approved';
    const outsiderContextRead = waitForGatewayResponse(
      pageC,
      'GET',
      '/v1/calendar/context',
    );
    await openCalendarWidget(elementC, pageC, {
      expectWidgetWarning: false,
      waitForCalendar: false,
    });
    record(activePhase, 'passed');

    activePhase = 'outsider-room-widget-team-target';
    const outsiderContextResponse = await outsiderContextRead;
    failureHttpStatus = outsiderContextResponse.status();
    failureTeamRoomMatches =
      new URL(outsiderContextResponse.url()).searchParams.get('roomId') ===
      fixture.teamRoomId;
    expect(failureTeamRoomMatches).toBe(true);
    expect(failureHttpStatus).toBe(403);
    record(activePhase, 'passed', failureHttpStatus, undefined, {
      teamRoomMatches: failureTeamRoomMatches,
    });
    failureHttpStatus = undefined;
    failureTeamRoomMatches = undefined;

    activePhase = 'outsider-room-events-api-team-target';
    failureHttpStatus = await requestRoomEventsStatus(pageC, {
      gatewayUrl: fixture.gatewayUrl,
      roomId: fixture.teamRoomId,
      calendarId: fixture.calendarId,
    });
    expect(failureHttpStatus).toBe(403);
    record(activePhase, 'passed', failureHttpStatus);
    failureHttpStatus = undefined;

    activePhase = 'outsider-own-unbound-room';
    failureHttpStatus = await requestRoomEventsStatus(pageC, {
      gatewayUrl: fixture.gatewayUrl,
      roomId: fixture.outsiderRoomId,
      calendarId: fixture.calendarId,
    });
    expect(failureHttpStatus).toBe(404);
    record(activePhase, 'passed', failureHttpStatus);
    failureHttpStatus = undefined;

    activePhase = 'stale-etag-conflict';
    const staleUpdate = waitForGatewayResponse(
      pageB,
      'PATCH',
      '/v1/calendar/events',
    );
    await frameB
      .getByRole('dialog')
      .last()
      .getByRole('button', { name: 'Save', exact: true })
      .click();
    const staleUpdateResult = await staleUpdate;
    expect(staleUpdateResult.status()).toBe(409);
    await expect(
      frameB.getByText(
        'This event changed elsewhere. Reload the latest version before retrying.',
      ),
    ).toBeVisible();
    record(activePhase, 'passed', staleUpdateResult.status());

    activePhase = 'canonical-read-after-denial';
    const reloadResponse = waitForGatewayResponse(
      pageB,
      'GET',
      '/v1/calendar/event',
    );
    await frameB
      .getByRole('dialog')
      .last()
      .getByRole('button', { name: 'Reload latest', exact: true })
      .click();
    const reloadResponseResult = await reloadResponse;
    expect(reloadResponseResult.status()).toBe(200);
    await expect(frameB.getByRole('textbox', { name: 'Title' })).toHaveValue(
      'Member A canonical edit',
    );
    record(activePhase, 'passed', reloadResponseResult.status());

    activePhase = 'browser-egress';
    failureAlreadyReported = recordBlockedRequestFailure(
      blockedExternalRequests,
      blockedRequestEvidence,
    );
    expect(blockedExternalRequests).toBe(0);
    record(activePhase, 'passed', undefined, blockedExternalRequests);
  } catch {
    recordJourneyFailure(
      activePhase,
      failureHttpStatus,
      failureAlreadyReported,
      failureTeamRoomMatches,
    );
    throw new Error('Element acceptance journey failed');
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test('Element Web delivers a relative room reminder across restart and restore', async ({
  browser,
}) => {
  test.setTimeout(360_000);
  fixture = readFixture();
  activeReminderFailureRecorded = false;
  let flow: ReminderFlow;
  let eventTitles: string[];
  try {
    flow = readReminderFlow();
    eventTitles = readReminderEventTitles();
  } catch {
    record('reminder-ui-readback', 'failed', undefined, 0);
    throw new Error('Reminder acceptance fixture state is unavailable');
  }
  const expectedPriorCount =
    flow === 'initial' ? 0 : flow === 'restart' ? 1 : 2;
  if (eventTitles.length !== expectedPriorCount) {
    record('reminder-ui-readback', 'failed', undefined, eventTitles.length);
    throw new Error('Reminder acceptance fixture state is inconsistent');
  }

  const allowedOrigins = new Set([
    new URL(fixture.elementUrl).origin,
    new URL(fixture.homeserverUrl).origin,
    'http://localhost:8008',
    new URL(fixture.gatewayUrl).origin,
    new URL(fixture.widgetUrl).origin,
  ]);
  let blockedRequests = 0;
  let failureHttpStatus: number | undefined;
  let failureAlreadyRecorded = false;
  const context = await browser.newContext({
    locale: 'en-US',
    timezoneId: 'Europe/Stockholm',
    viewport: { width: 1440, height: 900 },
  });

  try {
    await context.route('**/*', async (route) => {
      let requestOrigin: string;
      try {
        requestOrigin = new URL(route.request().url()).origin;
      } catch {
        blockedRequests = Math.min(blockedRequests + 1, 100_000);
        await route.abort('blockedbyclient');
        return;
      }
      if (!allowedOrigins.has(requestOrigin)) {
        blockedRequests = Math.min(blockedRequests + 1, 100_000);
        await route.abort('blockedbyclient');
        return;
      }
      await route.continue();
    });

    activePhase = 'member-a-authenticated';
    const page = await authenticateInElement(context, fixture.users.memberA);
    record(activePhase, 'passed');
    activePhase = 'reminder-room-context';
    const reminderContextResponseObserver =
      observeReminderWidgetContextResponse(page, fixture.teamRoomId);
    void reminderContextResponseObserver.response.catch(() => undefined);
    const reminderRoom = await openMemberARoomWithDiagnostics(
      page,
      fixture.roomName,
      fixture.teamRoomId,
      fixture.users.memberA.userId,
      true,
    );
    recordMemberARoomObservation(
      reminderRoom,
      'reminder-room-context',
      reminderContextResponseObserver.snapshot(),
    );
    failureAlreadyRecorded = Boolean(reminderRoom.failureCode);
    const element = requireMemberARoom(reminderRoom);

    activePhase = 'reminder-widget-context';
    const frame = await openCalendarWidget(element, page, {
      expectWidgetWarning: false,
    });
    const contextResult = await reminderContextResponseObserver.response;
    failureHttpStatus = contextResult.status();
    const contextPayload: unknown = await contextResult
      .json()
      .catch(() => null);
    const canManageReminders =
      contextPayload !== null &&
      typeof contextPayload === 'object' &&
      'roomCalendar' in contextPayload &&
      contextPayload.roomCalendar !== null &&
      typeof contextPayload.roomCalendar === 'object' &&
      'canManageReminders' in contextPayload.roomCalendar &&
      contextPayload.roomCalendar.canManageReminders === true;
    if (failureHttpStatus !== 200 || !canManageReminders) {
      record(activePhase, 'failed', failureHttpStatus, undefined, {
        canManageReminders,
      });
      failureAlreadyRecorded = true;
      throw new Error('Reminder room context was not authorized');
    }
    record(activePhase, 'passed', failureHttpStatus, undefined, {
      canManageReminders,
    });
    failureHttpStatus = undefined;

    if (eventTitles.length > 0) {
      activePhase = 'reminder-ui-readback';
      const existingReadback = await readBackReminderMarkers(
        frame,
        page,
        eventTitles,
      );
      if (
        !existingReadback.relativeAlarmReadback ||
        !existingReadback.reminderEnabled
      ) {
        record(activePhase, 'failed', undefined, existingReadback.count, {
          relativeAlarmReadback: existingReadback.relativeAlarmReadback,
          reminderEnabled: existingReadback.reminderEnabled,
        });
        failureAlreadyRecorded = true;
        throw new Error('Persisted reminder settings did not reload');
      }
      record(activePhase, 'passed', undefined, existingReadback.count, {
        relativeAlarmReadback: existingReadback.relativeAlarmReadback,
        reminderEnabled: existingReadback.reminderEnabled,
      });

      activePhase =
        flow === 'restart'
          ? 'reminder-restart-prior-state'
          : 'reminder-restore-prior-state';
      if (flow === 'restart') {
        const timeline = await inspectReminderTimeline(eventTitles);
        const markersOnce =
          timeline.complete &&
          timeline.markerCounts.every((count) => count === 1) &&
          timeline.markerMentions.every(Boolean);
        if (timeline.httpStatus !== 200 || !markersOnce) {
          record(
            activePhase,
            'failed',
            timeline.httpStatus ?? undefined,
            eventTitles.length,
            {
              allMarkersOnce: markersOnce,
            },
          );
          failureAlreadyRecorded = true;
          throw new Error('Restarted reminder markers were not preserved');
        }
        record(activePhase, 'passed', timeline.httpStatus, eventTitles.length, {
          allMarkersOnce: true,
        });
      }

      if (flow === 'restore') {
        activePhase = 'reminder-restore-prior-state';
        const timeline = await inspectReminderTimeline(eventTitles);
        const markersOnce =
          timeline.complete &&
          timeline.markerCounts.every((count) => count === 1) &&
          timeline.markerMentions.every(Boolean);
        if (timeline.httpStatus !== 200 || !markersOnce) {
          record(
            activePhase,
            'failed',
            timeline.httpStatus ?? undefined,
            eventTitles.length,
            {
              allMarkersOnce: markersOnce,
            },
          );
          failureAlreadyRecorded = true;
          throw new Error('Restored reminder markers were not preserved');
        }
        record(activePhase, 'passed', timeline.httpStatus, eventTitles.length, {
          allMarkersOnce: true,
        });
      }
    }

    const markerTitle = `Reminder acceptance ${randomUUID()}`;
    const dueAt = await createAndConfigureReminder(frame, page, markerTitle);
    eventTitles.push(markerTitle);

    activePhase = 'reminder-ui-readback';
    const allReadback = await readBackReminderMarkers(frame, page, eventTitles);
    if (!allReadback.relativeAlarmReadback || !allReadback.reminderEnabled) {
      record(activePhase, 'failed', undefined, allReadback.count, {
        relativeAlarmReadback: allReadback.relativeAlarmReadback,
        reminderEnabled: allReadback.reminderEnabled,
      });
      failureAlreadyRecorded = true;
      throw new Error('Reminder settings did not reload after configuration');
    }
    record(activePhase, 'passed', undefined, allReadback.count, {
      relativeAlarmReadback: allReadback.relativeAlarmReadback,
      reminderEnabled: allReadback.reminderEnabled,
    });

    const deliveryPhase =
      flow === 'initial'
        ? 'reminder-initial-delivery'
        : flow === 'restart'
          ? 'reminder-restart-scheduler-scan'
          : 'reminder-restore-scheduler-scan';
    activePhase = deliveryPhase;
    record(activePhase, 'started');
    const delivery = await waitForReminderDelivery(
      markerTitle,
      eventTitles,
      dueAt,
    );
    const allMarkersOnce =
      delivery.complete && delivery.markerCounts.every((count) => count === 1);
    const deliveryPassed =
      delivery.httpStatus === 200 &&
      delivery.markerCounts.at(-1) === 1 &&
      delivery.markerMentions.at(-1) === true &&
      delivery.deliveredAfterDue &&
      allMarkersOnce;
    if (!deliveryPassed) {
      record(
        activePhase,
        'failed',
        delivery.httpStatus ?? undefined,
        eventTitles.length,
        {
          canaryDelivered: delivery.markerCounts.at(-1) === 1,
          roomMentioned: delivery.markerMentions.at(-1) === true,
          deliveredAfterDue: delivery.deliveredAfterDue,
          allMarkersOnce,
        },
      );
      failureAlreadyRecorded = true;
      throw new Error('Reminder scheduler delivery was not observed');
    }
    record(
      activePhase,
      'passed',
      delivery.httpStatus ?? undefined,
      eventTitles.length,
      {
        canaryDelivered: true,
        roomMentioned: true,
        deliveredAfterDue: true,
        allMarkersOnce: true,
      },
    );

    if (flow !== 'initial') {
      activePhase =
        flow === 'restart'
          ? 'reminder-restart-no-duplicate'
          : 'reminder-restore-no-duplicate';
      const afterScan = await inspectReminderTimeline(eventTitles);
      const markersOnce =
        afterScan.complete &&
        afterScan.markerCounts.every((count) => count === 1) &&
        afterScan.markerMentions.every(Boolean);
      if (afterScan.httpStatus !== 200 || !markersOnce) {
        record(
          activePhase,
          'failed',
          afterScan.httpStatus ?? undefined,
          eventTitles.length,
          {
            allMarkersOnce: markersOnce,
          },
        );
        failureAlreadyRecorded = true;
        throw new Error('A previously sent reminder was repeated');
      }
      record(activePhase, 'passed', afterScan.httpStatus, eventTitles.length, {
        allMarkersOnce: true,
      });
    }

    activePhase = 'reminder-browser-egress';
    if (blockedRequests !== 0) {
      record(activePhase, 'failed', undefined, blockedRequests);
      failureAlreadyRecorded = true;
      throw new Error('Reminder browser attempted an unapproved request');
    }
    record(activePhase, 'passed', undefined, blockedRequests);
  } catch {
    if (!failureAlreadyRecorded && !activeReminderFailureRecorded) {
      record(activePhase, 'failed', failureHttpStatus);
    }
    throw new Error('Element reminder acceptance journey failed');
  } finally {
    await context.close();
  }
});

test('Element Web preserves unsupported events and supports client interactions', async ({
  browser,
}) => {
  test.setTimeout(360_000);
  fixture = readFixture();
  recordRuntimeVersions(browser.version());

  const contexts: BrowserContext[] = [];
  const resourcesToTrack: G6ResourceOwnership[] = [];
  const resourceOwnershipByName = new Map<string, G6ResourceOwnership>();
  const stageRecords = new Map<G6Phase, G6StageRecord>();
  const allowedOrigins = new Set([
    new URL(fixture.elementUrl).origin,
    new URL(fixture.homeserverUrl).origin,
    'http://localhost:8008',
    new URL(fixture.gatewayUrl).origin,
    new URL(fixture.widgetUrl).origin,
  ]);
  let blockedRequests = 0;
  let activeG6Phase: G6Phase = 'g6-fixture-ready';
  let activeRoomPhase:
    | 'g6-member-a-room-context'
    | 'g6-member-b-room-context'
    | undefined;
  let calDavClient: G6CalDavClient | undefined;
  let journeyFailed = false;
  let neighborPostSaveListObserver: G6PostSaveListObserver | undefined;

  const saveG6Stage = (observation: G6StageRecord) => {
    stageRecords.set(observation.phase, observation);
    const { phase, status, httpStatus, count, ...extra } = observation;
    record(phase, status, httpStatus, count, extra);
  };
  const assertG6Stage = (
    phase: G6Phase,
    passed: boolean,
    evidence: Omit<Partial<G6StageRecord>, 'phase' | 'status'> = {},
  ) => {
    saveG6Stage({ phase, status: passed ? 'passed' : 'failed', ...evidence });
    expect(passed).toBe(true);
  };

  const newRoutedContext = async (): Promise<BrowserContext> => {
    const context = await browser.newContext({
      locale: 'en-US',
      timezoneId: 'Europe/Stockholm',
      viewport: { width: 1440, height: 900 },
    });
    contexts.push(context);
    await context.route('**/*', async (route) => {
      let origin: string;
      try {
        origin = new URL(route.request().url()).origin;
      } catch {
        blockedRequests = Math.min(blockedRequests + 1, 100_000);
        await route.abort('blockedbyclient');
        return;
      }
      if (!allowedOrigins.has(origin)) {
        blockedRequests = Math.min(blockedRequests + 1, 100_000);
        await route.abort('blockedbyclient');
        return;
      }
      await route.continue();
    });
    return context;
  };

  let pageA: Page | undefined;
  let pageB: Page | undefined;
  let frameA: FrameLocator | undefined;
  let frameB: FrameLocator | undefined;
  const names = {
    unsupported: `G6 unsupported ${randomUUID()}`,
    neighbor: `G6 neighbor ${randomUUID()}`,
    neighborEdited: `G6 neighbor edited ${randomUUID()}`,
    deletable: `G6 delete ${randomUUID()}`,
    keyboard: `G6 keyboard ${randomUUID()}`,
  };
  const resources = {
    unsupported: `g6-${randomUUID()}.ics`,
    neighbor: `g6-${randomUUID()}.ics`,
    deletable: `g6-${randomUUID()}.ics`,
    keyboard: `g6-${randomUUID()}.ics`,
  };

  try {
    const contextA = await newRoutedContext();
    pageA = await authenticateInElement(contextA, fixture.users.memberA, true);
    record('member-a-authenticated', 'passed');
    activeRoomPhase = 'g6-member-a-room-context';
    const memberARoom = await openMemberARoomWithDiagnostics(
      pageA,
      fixture.roomName,
      fixture.teamRoomId,
      fixture.users.memberA.userId,
    );
    recordMemberARoomObservation(memberARoom, activeRoomPhase);
    if (memberARoom.failureCode) {
      throw new Error('Member A room context was not ready');
    }
    activeRoomPhase = undefined;

    const contextB = await newRoutedContext();
    pageB = await authenticateInElement(contextB, fixture.users.memberB);
    record('member-b-authenticated', 'passed');
    activeRoomPhase = 'g6-member-b-room-context';
    const memberBRoom = await openMemberARoomWithDiagnostics(
      pageB,
      fixture.roomName,
      fixture.teamRoomId,
      fixture.users.memberB.userId,
    );
    recordMemberARoomObservation(memberBRoom, activeRoomPhase);
    if (memberBRoom.failureCode) {
      throw new Error('Member B room context was not ready');
    }
    activeRoomPhase = undefined;

    activeG6Phase = 'g6-fixture-ready';
    const calDavResult = await createG6CalDavClient(fixture);
    if (calDavResult.client) calDavClient = calDavResult.client;
    if (calDavClient === undefined) {
      assertG6Stage(activeG6Phase, false, {
        ...(calDavResult.status === undefined
          ? {}
          : { httpStatus: calDavResult.status }),
        openIdProofValid: calDavResult.proofValid,
        allResourcesSeeded: false,
        count: 0,
      });
      throw new Error('Fixture CalDAV access was not available');
    }

    const startAt = Date.now() + 10 * 60_000;
    const eventEndAt = startAt + 60 * 60_000;
    const resourcesToSeed = [
      {
        name: resources.unsupported,
        icalendar: g6UnsupportedSeriesIcal(
          randomUUID(),
          names.unsupported,
          startAt,
        ),
      },
      {
        name: resources.neighbor,
        icalendar: g6SimpleEventIcal(
          randomUUID(),
          names.neighbor,
          startAt,
          eventEndAt,
        ),
      },
      {
        name: resources.deletable,
        icalendar: g6SimpleEventIcal(
          randomUUID(),
          names.deletable,
          startAt + 5 * 60_000,
          eventEndAt + 5 * 60_000,
        ),
      },
      {
        name: resources.keyboard,
        icalendar: g6SimpleEventIcal(
          randomUUID(),
          names.keyboard,
          startAt + 10 * 60_000,
          eventEndAt + 10 * 60_000,
        ),
      },
    ];

    let createdResourceCount = 0;
    const seedCreateObservations: G6SeedCreateObservation[] = [];
    for (const resource of resourcesToSeed) {
      const ownership = createG6ResourceOwnership(resource.name);
      resourcesToTrack.push(ownership);
      resourceOwnershipByName.set(resource.name, ownership);
      beginG6ResourceCreate(ownership);
      const result = await g6CalDavRequest(
        calDavClient!,
        resource.name,
        'PUT',
        resource.icalendar,
      );
      seedCreateObservations.push({
        outcome: result.outcome,
        status: result.status ?? null,
        etagPresent:
          result.outcome === 'response'
            ? typeof result.etag === 'string'
            : null,
        etagStrong:
          result.outcome === 'response'
            ? isStrongG6ResourceEtag(result.etag)
            : null,
      });
      if (recordG6ResourceCreate(ownership, result.status, result.etag)) {
        createdResourceCount += 1;
      }
    }
    const allResourcesSeeded = createdResourceCount === resourcesToSeed.length;
    assertG6Stage(activeG6Phase, allResourcesSeeded, {
      ...(calDavResult.status === undefined
        ? {}
        : { httpStatus: calDavResult.status }),
      openIdProofValid: calDavResult.proofValid,
      allResourcesSeeded,
      count: createdResourceCount,
      seedCreateObservations,
    });

    activeG6Phase = 'g6-unsupported-preservation';
    const memberAEventsResponse = waitForG6EventsResponse(
      pageA,
      fixture.teamRoomId,
    );
    void memberAEventsResponse.catch(() => undefined);
    const elementA = memberARoom.element;
    frameA = await openCalendarWidget(elementA, pageA, {
      expectWidgetWarning: false,
      waitForCalendar: false,
    });
    const memberAEvents = await memberAEventsResponse.catch(() => undefined);
    const memberAEventsStatus = memberAEvents?.status();
    const warning = frameA
      .getByRole('alert')
      .filter({ hasText: 'THISANDFUTURE' });
    const unsupportedRow = frameA.getByRole('listitem', {
      name: names.unsupported,
    });
    const neighborRow = frameA.getByRole('listitem', { name: names.neighbor });
    await Promise.all([
      warning.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {}),
      neighborRow
        .waitFor({ state: 'visible', timeout: 30_000 })
        .catch(() => {}),
    ]);
    const unsupportedWarningVisible = await warning
      .isVisible()
      .catch(() => false);
    const unsupportedRowOmitted =
      (await unsupportedRow.count().catch(() => 0)) === 0;
    const supportedNeighborVisible = await neighborRow
      .isVisible()
      .catch(() => false);

    const unsupportedBefore = await g6CalDavRequest(
      calDavClient!,
      resources.unsupported,
      'GET',
    );
    const canonicalSnapshotAvailable =
      unsupportedBefore.status === 200 && unsupportedBefore.bytes !== undefined;
    await openEventEditor(frameA, names.neighbor);
    const neighborEditor = frameA.getByRole('dialog').last();
    const neighborPatchResponse = waitForGatewayResponse(
      pageA,
      'PATCH',
      '/v1/calendar/events',
    );
    void neighborPatchResponse.catch(() => undefined);
    await neighborEditor
      .getByRole('textbox', { name: 'Title' })
      .fill(names.neighborEdited);
    neighborPostSaveListObserver = observeNextG6PostSaveListResponse(
      pageA,
      fixture.teamRoomId,
      names.neighborEdited,
    );
    await neighborEditor
      .getByRole('button', { name: 'Save', exact: true })
      .click();
    const neighborPatch = await neighborPatchResponse.catch(() => undefined);
    const neighborPatchStatus = neighborPatch?.status();
    const neighborResourceHref = new URL(
      encodeURIComponent(resources.neighbor),
      calDavClient!.collectionUrl,
    ).href;
    const neighborUpdate = await readGatewayEventUpdate(
      neighborPatch,
      neighborResourceHref,
      names.neighborEdited,
    );
    const neighborOwnership = resourceOwnershipByName.get(resources.neighbor);
    const neighborOwnershipUpdated =
      neighborOwnership !== undefined &&
      recordG6ResourceUpdate(
        neighborOwnership,
        neighborPatchStatus,
        neighborUpdate.etag,
        neighborUpdate.identityMatches,
      );
    // Saving returns to the event details dialog; close it through the normal
    // UI before asserting that the updated row is visible in the list.
    const savedNeighborDetails = frameA.getByRole('dialog').last();
    await expect(savedNeighborDetails).toBeVisible();
    await savedNeighborDetails
      .getByRole('button', { name: 'Close', exact: true })
      .click();
    await expect(savedNeighborDetails).toBeHidden();
    const editedNeighborRow = frameA.getByRole('listitem', {
      name: names.neighborEdited,
    });
    await editedNeighborRow
      .waitFor({ state: 'visible', timeout: 20_000 })
      .catch(() => {});
    const neighborEditedRowVisible = await editedNeighborRow
      .isVisible()
      .catch(() => false);
    const neighborListUiObservation = await observeG6PostSaveListUi(
      frameA,
      editedNeighborRow,
    );
    const neighborListRefreshObservation =
      neighborPostSaveListObserver.snapshot();
    neighborPostSaveListObserver.dispose();
    neighborPostSaveListObserver = undefined;
    const supportedNeighborEdited =
      neighborPatchStatus !== undefined &&
      neighborPatchStatus >= 200 &&
      neighborPatchStatus < 300 &&
      neighborOwnershipUpdated &&
      neighborEditedRowVisible;
    const neighborPatchTitleOutcome: G6NeighborTitleOutcome =
      neighborUpdate.titleMatches === true
        ? 'matched'
        : neighborUpdate.titleMatches === false
          ? 'mismatched'
          : 'unavailable';
    let neighborCanonicalTitleReadbackOutcome: G6CanonicalTitleReadbackOutcome;
    let neighborCanonicalTitleReadbackHttpStatus: number | undefined;
    if (neighborEditedRowVisible) {
      neighborCanonicalTitleReadbackOutcome = 'not-needed';
    } else if (neighborOwnership?.confirmedCreated !== true) {
      neighborCanonicalTitleReadbackOutcome = 'not-owned';
    } else {
      const canonicalNeighbor = await g6CalDavRequest(
        calDavClient!,
        resources.neighbor,
        'GET',
      );
      neighborCanonicalTitleReadbackHttpStatus = canonicalNeighbor.status;
      const canonicalTitleMatches =
        canonicalNeighbor.outcome === 'response' &&
        canonicalNeighbor.status === 200 &&
        canonicalNeighbor.bytes !== undefined
          ? g6EventSummaryMatches(canonicalNeighbor.bytes, names.neighborEdited)
          : undefined;
      neighborCanonicalTitleReadbackOutcome =
        canonicalTitleMatches === true
          ? 'matched'
          : canonicalTitleMatches === false
            ? 'mismatched'
            : 'unavailable';
    }

    const unsupportedAfter = await g6CalDavRequest(
      calDavClient!,
      resources.unsupported,
      'GET',
    );
    const canonicalUnsupportedObjectUnchanged =
      unsupportedAfter.status === 200 &&
      unsupportedAfter.bytes !== undefined &&
      unsupportedBefore.bytes !== undefined &&
      unsupportedBefore.bytes.equals(unsupportedAfter.bytes);
    const unsupportedPreservationPassed =
      memberAEventsStatus === 200 &&
      unsupportedWarningVisible &&
      unsupportedRowOmitted &&
      supportedNeighborVisible &&
      canonicalSnapshotAvailable &&
      supportedNeighborEdited &&
      canonicalUnsupportedObjectUnchanged;
    assertG6Stage(activeG6Phase, unsupportedPreservationPassed, {
      ...(memberAEventsStatus === undefined
        ? {}
        : { projectionHttpStatus: memberAEventsStatus }),
      ...(unsupportedBefore.status === undefined
        ? {}
        : { canonicalBeforeHttpStatus: unsupportedBefore.status }),
      ...(neighborPatchStatus === undefined
        ? {}
        : { neighborPatchHttpStatus: neighborPatchStatus }),
      ...(unsupportedAfter.status === undefined
        ? {}
        : { canonicalAfterHttpStatus: unsupportedAfter.status }),
      count: unsupportedWarningVisible ? 1 : 0,
      unsupportedWarningVisible,
      unsupportedRowOmitted,
      supportedNeighborVisible,
      canonicalSnapshotAvailable,
      neighborEditedRowVisible,
      supportedNeighborEdited,
      canonicalUnsupportedObjectUnchanged,
      neighborOwnershipUpdated,
      neighborUpdateIdentityMatches: neighborUpdate.identityMatches,
      neighborPatchTitleOutcome,
      neighborCanonicalTitleReadbackOutcome,
      neighborListRefreshOutcome: neighborListRefreshObservation.outcome,
      neighborListRefreshHttpStatus: neighborListRefreshObservation.httpStatus,
      ...(neighborListRefreshObservation.eventCountCapped === undefined
        ? {}
        : {
            neighborListRefreshEventCountCapped:
              neighborListRefreshObservation.eventCountCapped,
            neighborListRefreshEventCountOverflow:
              neighborListRefreshObservation.eventCountOverflow,
          }),
      ...(neighborListRefreshObservation.editedTitleMatches === undefined
        ? {}
        : {
            neighborListRefreshEditedTitleMatches:
              neighborListRefreshObservation.editedTitleMatches,
          }),
      neighborListUiObservation: neighborListUiObservation.state,
      ...(neighborListUiObservation.state === 'observed'
        ? {
            neighborListLoadingVisible:
              neighborListUiObservation.loadingVisible,
            neighborListErrorVisible: neighborListUiObservation.errorVisible,
            neighborEditedRowCountCapped:
              neighborListUiObservation.editedRowCountCapped,
            neighborEditedRowCountOverflow:
              neighborListUiObservation.editedRowCountOverflow,
            neighborListEditedRowVisible:
              neighborListUiObservation.editedRowVisible,
          }
        : {}),
      ...(neighborCanonicalTitleReadbackHttpStatus === undefined
        ? {}
        : { neighborCanonicalTitleReadbackHttpStatus }),
    });

    activeG6Phase = 'g6-side-panel-layout';
    const neighborDetails = frameA.getByRole('dialog').last();
    if (await neighborDetails.isVisible().catch(() => false)) {
      await neighborDetails
        .getByRole('button', { name: 'Close', exact: true })
        .click();
    }
    await editedNeighborRow.click();
    const narrowDetails = frameA.getByRole('dialog').last();
    const eventDetailsReachable = await narrowDetails
      .isVisible()
      .catch(() => false);
    if (eventDetailsReachable) {
      await narrowDetails
        .getByRole('button', { name: 'Close', exact: true })
        .click();
    }
    const createControlReachable = await frameA
      .getByRole('button', { name: 'Create event', exact: true })
      .isVisible()
      .catch(() => false);
    const sidePanelToolbarObservation = await observeG6SidePanelToolbar(frameA);
    const viewport = pageA.viewportSize();
    const widgetCard = pageA.locator('.mx_WidgetCard');
    const widgetCardCount = Math.min(
      await widgetCard.count().catch(() => 0),
      2,
    );
    const widgetCardVisible = await widgetCard
      .first()
      .isVisible()
      .catch(() => false);
    const appDrawerCount = Math.min(
      await pageA
        .locator('.mx_AppsDrawer')
        .count()
        .catch(() => 0),
      2,
    );
    const persistedHostFrame = pageA.locator(
      '#mx_PersistedElement_container iframe[title="Matrix Calendar"]',
    );
    const persistedHostFramePresent =
      (await persistedHostFrame.count().catch(() => 0)) === 1 &&
      (await persistedHostFrame.isVisible().catch(() => false));
    const sidePanelBox = await persistedHostFrame
      .boundingBox()
      .catch(() => null);
    const hostNoHorizontalOverflow = await pageA
      .evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      )
      .catch(() => false);
    const widgetNoHorizontalOverflow = await frameA
      .locator('html')
      .evaluate((element) => element.scrollWidth <= element.clientWidth)
      .catch(() => false);
    const iframeWidth = sidePanelBox
      ? Math.round(sidePanelBox.width)
      : undefined;
    const iframeHeight = sidePanelBox
      ? Math.round(sidePanelBox.height)
      : undefined;
    const sidePanelLayoutPassed =
      viewport?.width === 1440 &&
      viewport.height === 900 &&
      widgetCardCount === 1 &&
      widgetCardVisible &&
      persistedHostFramePresent &&
      iframeWidth !== undefined &&
      iframeWidth > 0 &&
      iframeHeight !== undefined &&
      iframeHeight > 0 &&
      createControlReachable &&
      eventDetailsReachable &&
      hostNoHorizontalOverflow &&
      widgetNoHorizontalOverflow;
    assertG6Stage(activeG6Phase, sidePanelLayoutPassed, {
      widgetCardCount,
      appDrawerCount,
      widgetCardVisible,
      createControlReachable,
      eventDetailsReachable,
      hostNoHorizontalOverflow,
      widgetNoHorizontalOverflow,
      persistedHostFramePresent,
      ...sidePanelToolbarObservation,
      ...(viewport
        ? { viewportWidth: viewport.width, viewportHeight: viewport.height }
        : {}),
      ...(iframeWidth === undefined ? {} : { iframeWidth }),
      ...(iframeHeight === undefined ? {} : { iframeHeight }),
    });

    activeG6Phase = 'g6-keyboard-focus';
    const memberBEventsResponse = waitForG6EventsResponse(
      pageB,
      fixture.teamRoomId,
    );
    void memberBEventsResponse.catch(() => undefined);
    frameB = await openCalendarWidget(memberBRoom.element, pageB, {
      expectWidgetWarning: false,
      waitForCalendar: false,
    });
    const memberBEvents = await memberBEventsResponse.catch(() => undefined);
    const memberBEventsStatus = memberBEvents?.status();
    const keyboardEventButton = frameB.getByRole('button', {
      name: names.keyboard,
    });
    await keyboardEventButton
      .waitFor({ state: 'visible', timeout: 20_000 })
      .catch(() => {});
    let eventActionTabCount = 0;
    let keyboardEventFocused = await keyboardEventButton
      .evaluate((element) => element === document.activeElement)
      .catch(() => false);
    while (!keyboardEventFocused && eventActionTabCount < 80) {
      await pageB.keyboard.press('Tab');
      eventActionTabCount += 1;
      keyboardEventFocused = await keyboardEventButton
        .evaluate((element) => element === document.activeElement)
        .catch(() => false);
    }
    if (keyboardEventFocused) await pageB.keyboard.press('Enter');
    const keyboardDetails = frameB.getByRole('dialog').last();
    const detailsOpened = await keyboardDetails
      .waitFor({ state: 'visible', timeout: 8_000 })
      .then(() => true)
      .catch(() => false);
    const editButton = keyboardDetails.getByRole('button', {
      name: 'Edit',
      exact: true,
    });
    let detailsActionTabCount = 0;
    let editActionFocused = await editButton
      .evaluate((element) => element === document.activeElement)
      .catch(() => false);
    while (!editActionFocused && detailsOpened && detailsActionTabCount < 12) {
      await pageB.keyboard.press('Tab');
      detailsActionTabCount += 1;
      editActionFocused = await editButton
        .evaluate((element) => element === document.activeElement)
        .catch(() => false);
    }
    const deleteAction = keyboardDetails.getByRole('button', {
      name: 'Delete',
      exact: true,
    });
    let deleteActionFocused = false;
    let closeActionFocused = false;
    if (editActionFocused) {
      await pageB.keyboard.press('Tab');
      detailsActionTabCount += 1;
      deleteActionFocused = await deleteAction
        .evaluate((element) => element === document.activeElement)
        .catch(() => false);
      await pageB.keyboard.press('Tab');
      detailsActionTabCount += 1;
      closeActionFocused = await keyboardDetails
        .getByRole('button', { name: 'Close', exact: true })
        .evaluate((element) => element === document.activeElement)
        .catch(() => false);
      await pageB.keyboard.press('Escape');
    }
    const escapeClosedDialog = await keyboardDetails
      .waitFor({ state: 'hidden', timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    const focusReturnedToEvent = await expect(keyboardEventButton)
      .toBeFocused({ timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    const keyboardPassed =
      keyboardEventFocused &&
      detailsOpened &&
      editActionFocused &&
      deleteActionFocused &&
      closeActionFocused &&
      escapeClosedDialog &&
      focusReturnedToEvent;
    assertG6Stage(activeG6Phase, keyboardPassed, {
      count: eventActionTabCount,
      eventActionTabCount,
      detailsActionTabCount,
      keyboardEventFocused,
      detailsOpened,
      editActionFocused,
      deleteActionFocused,
      closeActionFocused,
      escapeClosedDialog,
      focusReturnedToEvent,
    });

    activeG6Phase = 'g6-delete-and-refresh';
    const memberBDeleteRow = frameB.getByRole('listitem', {
      name: names.deletable,
    });
    await memberBDeleteRow
      .waitFor({ state: 'visible', timeout: 30_000 })
      .catch(() => {});
    const memberBDeleteRowVisible = await memberBDeleteRow
      .isVisible()
      .catch(() => false);
    const deletableRow = frameA.getByRole('listitem', {
      name: names.deletable,
    });
    await deletableRow.click();
    const deleteDetails = frameA.getByRole('dialog').last();
    const deleteButton = deleteDetails.getByRole('button', {
      name: 'Delete',
      exact: true,
    });
    const deleteButtonVisible = await deleteButton
      .isVisible()
      .catch(() => false);
    await deleteButton.click();
    const confirmation = frameA.getByRole('dialog', { name: 'Delete event' });
    const deleteConfirmationVisible = await confirmation
      .isVisible()
      .catch(() => false);
    const deleteResponse = waitForGatewayResponse(
      pageA,
      'DELETE',
      '/v1/calendar/events',
    );
    void deleteResponse.catch(() => undefined);
    await confirmation
      .getByRole('button', { name: 'Delete', exact: true })
      .click();
    const deleteResult = await deleteResponse.catch(() => undefined);
    const deleteHttpStatus = deleteResult?.status();
    await deletableRow
      .waitFor({ state: 'detached', timeout: 20_000 })
      .catch(() => {});
    const deletedRowAbsent = (await deletableRow.count().catch(() => 1)) === 0;
    const deletePassed =
      deleteButtonVisible &&
      deleteConfirmationVisible &&
      deleteHttpStatus !== undefined &&
      deleteHttpStatus >= 200 &&
      deleteHttpStatus < 300 &&
      deletedRowAbsent;
    const canonicalDelete = await g6CalDavRequest(
      calDavClient!,
      resources.deletable,
      'GET',
    );
    const canonicalObjectAbsent = canonicalDelete.status === 404;

    await pageB.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
    const memberBReloadedRoom = await openFixtureRoom(
      pageB,
      fixture.roomName,
      fixture.teamRoomId,
    );
    const memberBReloadEventsResponse = waitForG6EventsResponse(
      pageB,
      fixture.teamRoomId,
    );
    void memberBReloadEventsResponse.catch(() => undefined);
    frameB = await openCalendarWidget(memberBReloadedRoom, pageB, {
      expectWidgetWarning: false,
      waitForCalendar: false,
    });
    const memberBReloadEvents = await memberBReloadEventsResponse.catch(
      () => undefined,
    );
    const memberBReloadStatus = memberBReloadEvents?.status();
    const memberBDeleteRowAfterReload = frameB.getByRole('listitem', {
      name: names.deletable,
    });
    const memberBDeleteRowAbsent =
      (await memberBDeleteRowAfterReload.count().catch(() => 1)) === 0;
    const memberBNeighborVisible = await frameB
      .getByRole('listitem', { name: names.neighborEdited })
      .isVisible()
      .catch(() => false);
    const memberBRefreshPassed =
      memberBReloadStatus === 200 &&
      memberBDeleteRowAbsent &&
      memberBNeighborVisible;

    const deleteAndRefreshPassed =
      memberBEventsStatus === 200 &&
      memberBDeleteRowVisible &&
      deletePassed &&
      canonicalObjectAbsent &&
      memberBRefreshPassed;
    assertG6Stage(activeG6Phase, deleteAndRefreshPassed, {
      ...(memberBEventsStatus === undefined
        ? {}
        : { memberBEventsHttpStatus: memberBEventsStatus }),
      ...(deleteHttpStatus === undefined ? {} : { deleteHttpStatus }),
      ...(canonicalDelete.status === undefined
        ? {}
        : { canonicalDeleteHttpStatus: canonicalDelete.status }),
      ...(memberBReloadStatus === undefined
        ? {}
        : { memberBReloadHttpStatus: memberBReloadStatus }),
      count: 1,
      memberBDeleteRowVisible,
      deleteButtonVisible,
      deleteConfirmationVisible,
      deletedRowAbsent,
      canonicalObjectAbsent,
      memberBDeleteRowAbsent,
      supportedNeighborVisible: memberBNeighborVisible,
    });

    activeG6Phase = 'g6-browser-egress';
    const browserEgressClear = blockedRequests === 0;
    assertG6Stage(activeG6Phase, browserEgressClear, {
      count: blockedRequests,
      browserEgressClear,
    });
  } catch {
    journeyFailed = true;
    if (!activeRoomPhase && !stageRecords.has(activeG6Phase)) {
      saveG6Stage({ phase: activeG6Phase, status: 'failed' });
    }
  } finally {
    neighborPostSaveListObserver?.dispose();
    await Promise.all(
      contexts.map((context) => context.close().catch(() => {})),
    );
    activeG6Phase = 'g6-resource-cleanup';
    for (const resource of resourcesToTrack) {
      const cleanup = g6ResourceCleanupRequest(resource);
      if (cleanup.method !== 'DELETE') continue;
      const result = calDavClient
        ? await g6CalDavRequest(
            calDavClient,
            resource.name,
            'DELETE',
            undefined,
            cleanup.ifMatch,
          )
        : { outcome: 'not-sent' as const };
      recordG6ResourceCleanup(resource, result.status);
    }
    const cleanupSummary = summarizeG6ResourceOwnership(resourcesToTrack);
    const cleanupPassed = cleanupSummary.allOwnedResourcesRemoved;
    saveG6Stage({
      phase: activeG6Phase,
      status: cleanupPassed ? 'passed' : 'failed',
      ...cleanupSummary,
    });
    if (!cleanupPassed) journeyFailed = true;

    activeG6Phase = 'g6-browser-egress';
    if (!stageRecords.has(activeG6Phase)) {
      const browserEgressClear = blockedRequests === 0;
      saveG6Stage({
        phase: activeG6Phase,
        status: browserEgressClear ? 'passed' : 'failed',
        count: blockedRequests,
        browserEgressClear,
      });
      if (!browserEgressClear) journeyFailed = true;
    }
  }

  if (journeyFailed) {
    throw new Error('Element Web client acceptance cases failed');
  }
});

const G6_SERVICE_USER_ID = '@_matrix_calendar_service:localhost';
const G6_SERVICE_LOCALPART = '_matrix_calendar_service';
// The paired-restore flow stops the original listener on 5232 and publishes
// the restored Radicale collection on the isolated host port 5233.
const G6_RADICALE_ORIGIN = 'http://127.0.0.1:5233';
const G6_RADICALE_COLLECTION = 'element-acceptance';
const G6_MAX_RESOURCE_BYTES = 16_384;

async function createG6CalDavClient(fixtureValue: Fixture): Promise<{
  status?: number;
  proofValid: boolean;
  client?: G6CalDavClient;
}> {
  const applicationServiceToken = process.env.MATRIX_APPLICATION_SERVICE_TOKEN;
  if (
    fixtureValue.serviceSender.userId !== G6_SERVICE_USER_ID ||
    fixtureValue.calendarId !== G6_RADICALE_COLLECTION ||
    new URL(fixtureValue.homeserverUrl).origin !== 'http://127.0.0.1:8008' ||
    typeof applicationServiceToken !== 'string' ||
    applicationServiceToken.length === 0 ||
    applicationServiceToken.length > 4096
  ) {
    return { proofValid: false };
  }

  let openIdResponse: globalThis.Response;
  try {
    const openIdUrl = new URL(
      `/_matrix/client/v3/user/${encodeURIComponent(G6_SERVICE_USER_ID)}/openid/request_token`,
      fixtureValue.homeserverUrl,
    );
    openIdResponse = await fetch(openIdUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${applicationServiceToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ user_id: G6_SERVICE_USER_ID }),
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return { proofValid: false };
  }

  const status = openIdResponse.status;
  if (status !== 200) {
    await openIdResponse.body?.cancel().catch(() => undefined);
    return { status, proofValid: false };
  }

  let proof: unknown;
  try {
    proof = await openIdResponse.json();
  } catch {
    return { status, proofValid: false };
  }
  if (
    proof === null ||
    typeof proof !== 'object' ||
    Array.isArray(proof) ||
    !('access_token' in proof) ||
    typeof proof.access_token !== 'string' ||
    proof.access_token.length === 0 ||
    proof.access_token.length > 4096 ||
    !('matrix_server_name' in proof) ||
    proof.matrix_server_name !== 'localhost'
  ) {
    return { status, proofValid: false };
  }

  const delegatedCredential = Buffer.from(
    JSON.stringify({
      access_token: proof.access_token,
      matrix_server_name: proof.matrix_server_name,
    }),
  ).toString('base64url');
  const authorization = Buffer.from(
    `${G6_SERVICE_LOCALPART}:matrix-openid:${delegatedCredential}`,
    'utf8',
  ).toString('base64');
  const collectionUrl = new URL(
    `${encodeURIComponent(G6_SERVICE_LOCALPART)}/${encodeURIComponent(G6_RADICALE_COLLECTION)}/`,
    `${G6_RADICALE_ORIGIN}/`,
  );
  if (collectionUrl.origin !== G6_RADICALE_ORIGIN) {
    return { status, proofValid: false };
  }

  return {
    status,
    proofValid: true,
    client: { authorization, collectionUrl },
  };
}

async function g6CalDavRequest(
  client: G6CalDavClient,
  resourceName: string,
  method: 'GET' | 'PUT' | 'DELETE',
  icalendar?: string,
  ifMatch?: string,
): Promise<G6CalDavResult> {
  if (
    !/^g6-[0-9a-f-]{36}\.ics$/u.test(resourceName) ||
    client.collectionUrl.origin !== G6_RADICALE_ORIGIN
  ) {
    return { outcome: 'not-sent' };
  }

  const resourceUrl = new URL(
    encodeURIComponent(resourceName),
    client.collectionUrl,
  );
  const collectionPrefix = `/${encodeURIComponent(G6_SERVICE_LOCALPART)}/${encodeURIComponent(G6_RADICALE_COLLECTION)}/`;
  if (
    resourceUrl.origin !== G6_RADICALE_ORIGIN ||
    !resourceUrl.pathname.startsWith(collectionPrefix) ||
    resourceUrl.pathname.slice(collectionPrefix.length).includes('/')
  ) {
    return { outcome: 'not-sent' };
  }

  const headers: Record<string, string> = {
    Authorization: `Basic ${client.authorization}`,
  };
  if (method === 'PUT') {
    if (
      typeof icalendar !== 'string' ||
      icalendar.length > G6_MAX_RESOURCE_BYTES
    ) {
      return { outcome: 'not-sent' };
    }
    headers['Content-Type'] = 'text/calendar; charset=utf-8';
    headers['If-None-Match'] = '*';
  } else if (method === 'DELETE' && ifMatch !== undefined) {
    if (!/^"[\x21\x23-\x7e]{1,200}"$/u.test(ifMatch)) {
      return { outcome: 'not-sent' };
    }
    headers['If-Match'] = ifMatch;
  }

  let response: globalThis.Response;
  try {
    response = await fetch(resourceUrl, {
      method,
      headers,
      ...(method === 'PUT' ? { body: icalendar } : {}),
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    const errorName = error instanceof Error ? error.name : '';
    return {
      outcome:
        errorName === 'TimeoutError'
          ? 'timeout'
          : errorName === 'AbortError'
            ? 'aborted'
            : errorName === 'TypeError'
              ? 'network-error'
              : 'other-error',
    };
  }

  if (method === 'GET' && response.status === 200) {
    const contentLength = Number(response.headers.get('content-length'));
    if (
      Number.isFinite(contentLength) &&
      contentLength > G6_MAX_RESOURCE_BYTES
    ) {
      await response.body?.cancel().catch(() => undefined);
      return { outcome: 'response', status: response.status };
    }
    try {
      const bytes = Buffer.from(await response.arrayBuffer());
      return bytes.length <= G6_MAX_RESOURCE_BYTES
        ? { outcome: 'response', status: response.status, bytes }
        : { outcome: 'response', status: response.status };
    } catch {
      return { outcome: 'response', status: response.status };
    }
  }

  await response.body?.cancel().catch(() => undefined);
  const etag = method === 'PUT' ? response.headers.get('etag') : null;
  return {
    outcome: 'response',
    status: response.status,
    ...(etag ? { etag } : {}),
  };
}

function g6SimpleEventIcal(
  uid: string,
  title: string,
  startAt: number,
  endAt: number,
): string {
  const summary = title
    .replace(/\\/gu, '\\\\')
    .replace(/;/gu, '\\;')
    .replace(/,/gu, '\\,')
    .replace(/\r?\n/gu, '\\n');
  return (
    [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Matrix Calendar Widget//G6 Acceptance//EN',
      'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${g6IcsTimestamp(Date.now())}`,
      `DTSTART:${g6IcsTimestamp(startAt)}`,
      `DTEND:${g6IcsTimestamp(endAt)}`,
      `SUMMARY:${summary}`,
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n') + '\r\n'
  );
}

function g6UnsupportedSeriesIcal(
  uid: string,
  title: string,
  startAt: number,
): string {
  const nextOccurrence = startAt + 24 * 60 * 60_000;
  const duration = 60 * 60_000;
  const summary = title.replace(/\\/gu, '\\\\').replace(/;/gu, '\\;');
  return (
    [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Matrix Calendar Widget//G6 Acceptance//EN',
      'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${g6IcsTimestamp(Date.now())}`,
      `DTSTART:${g6IcsTimestamp(startAt)}`,
      `DTEND:${g6IcsTimestamp(startAt + duration)}`,
      'RRULE:FREQ=DAILY;COUNT=5',
      `SUMMARY:${summary}`,
      'END:VEVENT',
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${g6IcsTimestamp(Date.now())}`,
      `RECURRENCE-ID;RANGE=THISANDFUTURE:${g6IcsTimestamp(nextOccurrence)}`,
      `DTSTART:${g6IcsTimestamp(nextOccurrence + 60 * 60_000)}`,
      `DTEND:${g6IcsTimestamp(nextOccurrence + 2 * 60 * 60_000)}`,
      `SUMMARY:${summary}`,
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n') + '\r\n'
  );
}

function g6IcsTimestamp(timestamp: number): string {
  return new Date(timestamp)
    .toISOString()
    .replace(/[-:]/gu, '')
    .replace(/\.\d{3}/u, '');
}

function waitForG6EventsResponse(
  page: Page,
  roomId: string,
): Promise<Response> {
  return page.waitForResponse(
    (response) => matchesG6EventsRequest(response.request(), roomId),
    { timeout: 30_000 },
  );
}

function matchesG6EventsRequest(request: Request, roomId: string): boolean {
  try {
    const url = new URL(request.url());
    return (
      url.origin === new URL(fixture.gatewayUrl).origin &&
      url.pathname === '/v1/calendar/events' &&
      url.searchParams.get('roomId') === roomId &&
      url.searchParams.get('target') === 'room' &&
      request.method() === 'GET' &&
      new URL(request.frame().url()).origin ===
        new URL(fixture.widgetUrl).origin
    );
  } catch {
    return false;
  }
}

function observeNextG6PostSaveListResponse(
  page: Page,
  roomId: string,
  expectedTitle: string,
): G6PostSaveListObserver {
  const observedRequests = new WeakSet<Request>();
  let observation: G6PostSaveListResponseObservation = {
    outcome: 'not-observed',
    httpStatus: null,
  };
  let responseObserved = false;

  const onRequest = (request: Request) => {
    if (matchesG6EventsRequest(request, roomId)) observedRequests.add(request);
  };
  const onResponse = (response: Response) => {
    const request = response.request();
    if (responseObserved || !observedRequests.has(request)) return;
    responseObserved = true;
    const httpStatus = response.status();
    observation = {
      outcome: httpStatus === 200 ? 'decoding' : 'unexpected-status',
      httpStatus,
    };
    if (httpStatus !== 200) return;

    void response
      .json()
      .then((body: unknown) => {
        if (!isRecord(body) || !Array.isArray(body.events)) {
          observation = { outcome: 'invalid-response', httpStatus };
          return;
        }
        const eventCount = body.events.length;
        const eventCountCapped = Math.min(
          eventCount,
          G6_POSTSAVE_EVENT_COUNT_CAP,
        );
        const eventCountOverflow = eventCount > G6_POSTSAVE_EVENT_COUNT_CAP;
        if (eventCountOverflow) {
          observation = {
            outcome: 'decoded-overflow',
            httpStatus,
            eventCountCapped,
            eventCountOverflow: true,
          };
          return;
        }
        if (
          body.events.some(
            (resource: unknown) =>
              !isRecord(resource) ||
              !isRecord(resource.event) ||
              typeof resource.event.title !== 'string',
          )
        ) {
          observation = { outcome: 'invalid-response', httpStatus };
          return;
        }
        observation = {
          outcome: 'decoded',
          httpStatus,
          eventCountCapped,
          eventCountOverflow: false,
          editedTitleMatches: body.events.some(
            (resource: { event: { title: string } }) =>
              resource.event.title === expectedTitle,
          ),
        };
      })
      .catch(() => {
        observation = { outcome: 'decode-error', httpStatus };
      });
  };

  page.on('request', onRequest);
  page.on('response', onResponse);
  return {
    snapshot: () => ({ ...observation }),
    dispose: () => {
      page.off('request', onRequest);
      page.off('response', onResponse);
    },
  };
}

async function observeG6PostSaveListUi(
  frame: FrameLocator,
  editedRow: Locator,
): Promise<G6PostSaveListUiObservation> {
  try {
    const [loadingVisible, errorVisible, rowCount, editedRowVisible] =
      await Promise.all([
        frame.getByRole('progressbar').isVisible(),
        frame.locator('.MuiAlert-standardError').isVisible(),
        editedRow.count(),
        editedRow.isVisible(),
      ]);
    return {
      state: 'observed',
      loadingVisible,
      errorVisible,
      editedRowCountCapped: Math.min(rowCount, 2),
      editedRowCountOverflow: rowCount > 2,
      editedRowVisible,
    };
  } catch {
    return { state: 'unavailable' };
  }
}

async function observeG6SidePanelToolbar(
  frame: FrameLocator,
): Promise<G6SidePanelToolbarObservation> {
  try {
    const deleteCalendarButton = frame.getByRole('button', {
      name: 'Delete calendar',
      exact: true,
      includeHidden: true,
    });
    const managementToolbarNav = frame
      .locator('nav')
      .filter({ has: deleteCalendarButton });
    const createEventButton = frame.getByRole('button', {
      name: 'Create event',
      exact: true,
      includeHidden: true,
    });
    const [managementToolbarNavCount, createEventButtonCount] =
      await Promise.all([
        managementToolbarNav.count(),
        createEventButton.count(),
      ]);
    const [
      managementToolbarNavVisible,
      createEventButtonVisible,
      createEventButtonEnabled,
    ] = await Promise.all([
      managementToolbarNavCount === 1
        ? managementToolbarNav.isVisible()
        : Promise.resolve(undefined),
      createEventButtonCount === 1
        ? createEventButton.isVisible()
        : Promise.resolve(undefined),
      createEventButtonCount === 1
        ? createEventButton.isEnabled()
        : Promise.resolve(undefined),
    ]);
    const visibility = (
      count: number,
      visible: boolean | undefined,
    ): G6SidePanelControlVisibility =>
      count === 0
        ? 'absent'
        : count > 1
          ? 'ambiguous'
          : visible === undefined
            ? 'unavailable'
            : visible
              ? 'visible'
              : 'hidden';

    return {
      managementToolbarNavCountCapped: Math.min(managementToolbarNavCount, 2),
      managementToolbarNavVisibility: visibility(
        managementToolbarNavCount,
        managementToolbarNavVisible,
      ),
      createEventButtonCountCapped: Math.min(createEventButtonCount, 2),
      createEventButtonVisibility: visibility(
        createEventButtonCount,
        createEventButtonVisible,
      ),
      createEventButtonEnabled:
        createEventButtonCount === 0
          ? 'absent'
          : createEventButtonCount > 1
            ? 'ambiguous'
            : createEventButtonEnabled === undefined
              ? 'unavailable'
              : createEventButtonEnabled
                ? 'enabled'
                : 'disabled',
    };
  } catch {
    return {
      managementToolbarNavCountCapped: null,
      managementToolbarNavVisibility: 'unavailable',
      createEventButtonCountCapped: null,
      createEventButtonVisibility: 'unavailable',
      createEventButtonEnabled: 'unavailable',
    };
  }
}

function readReminderFlow(): ReminderFlow {
  const value = process.env.ELEMENT_ACCEPTANCE_REMINDER_FLOW;
  if (value === 'initial' || value === 'restart' || value === 'restore') {
    return value;
  }
  throw new Error('Reminder acceptance flow is unavailable');
}

function reminderEventFilePath(): string {
  const runnerTemp = process.env.RUNNER_TEMP;
  const eventFile = process.env.ELEMENT_ACCEPTANCE_REMINDER_EVENT_FILE;
  if (!runnerTemp || !eventFile || !isAbsolute(eventFile)) {
    throw new Error('Reminder acceptance fixture is unavailable');
  }
  const privateRoot = resolve(runnerTemp) + sep;
  const resolvedPath = resolve(eventFile);
  if (!resolvedPath.startsWith(privateRoot)) {
    throw new Error('Reminder acceptance fixture is unavailable');
  }
  return resolvedPath;
}

function readReminderEventTitles(): string[] {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(reminderEventFilePath(), 'utf8'));
  } catch {
    throw new Error('Reminder acceptance markers are unavailable');
  }
  if (
    !Array.isArray(value) ||
    value.length > 3 ||
    value.some(
      (title) =>
        typeof title !== 'string' ||
        !/^Reminder acceptance [0-9a-f-]{36}$/u.test(title),
    ) ||
    new Set(value).size !== value.length
  ) {
    throw new Error('Reminder acceptance markers are invalid');
  }
  return value;
}

function writeReminderEventTitles(titles: readonly string[]): void {
  if (
    titles.length < 1 ||
    titles.length > 3 ||
    titles.some(
      (title) => !/^Reminder acceptance [0-9a-f-]{36}$/u.test(title),
    ) ||
    new Set(titles).size !== titles.length
  ) {
    throw new Error('Reminder acceptance markers are invalid');
  }
  writeFileSync(reminderEventFilePath(), `${JSON.stringify(titles)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
}

async function createAndConfigureReminder(
  frame: FrameLocator,
  page: Page,
  title: string,
): Promise<number> {
  activePhase = 'reminder-event-create-dialog';
  record(activePhase, 'started');
  await frame
    .getByRole('button', { name: 'Create event', exact: true })
    .click();
  const editor = frame.getByRole('dialog').last();
  await expect(editor).toBeVisible({ timeout: 15_000 });

  const startAt =
    Math.ceil((Date.now() + REMINDER_START_LEAD_MS) / 60_000) * 60_000;
  const dueAt = startAt - REMINDER_ALARM_OFFSET_MS;
  const startValue = localDateTimeInput(startAt, 'Europe/Stockholm');
  const endValue = localDateTimeInput(
    startAt + 60 * 60_000,
    'Europe/Stockholm',
  );
  await editor.getByRole('combobox', { name: 'Calendar' }).selectOption({
    value: `matrix-calendar-target://room/${encodeURIComponent(fixture.calendarId)}`,
  });
  await editor.getByRole('textbox', { name: 'Title' }).fill(title);
  await editor.getByRole('textbox', { name: 'Start' }).fill(startValue);
  await editor.getByRole('textbox', { name: 'End' }).fill(endValue);
  await editor
    .getByRole('textbox', { name: 'Time zone' })
    .fill('Europe/Stockholm');
  const alarmToggle = editor.getByLabel('CalDAV reminder');
  if (!(await alarmToggle.isChecked())) await alarmToggle.check();
  await editor.getByRole('radio', { name: 'Before the event' }).check();
  await editor.getByRole('spinbutton', { name: 'Minutes before' }).fill('1');
  record(activePhase, 'passed');

  activePhase = 'reminder-event-created';
  record(activePhase, 'started');
  const createResponse = waitForGatewayResponse(
    page,
    'POST',
    '/v1/calendar/events',
  );
  await editor
    .getByRole('button', { name: 'Create event', exact: true })
    .click();
  const response = await createResponse;
  const status = response.status();
  if (status < 200 || status >= 300) {
    record(activePhase, 'failed', status);
    activeReminderFailureRecorded = true;
    throw new Error('The reminder event was not created');
  }
  record(activePhase, 'passed', status);

  activePhase = 'reminder-event-visible';
  try {
    await expect(frame.getByRole('listitem', { name: title })).toBeVisible({
      timeout: 20_000,
    });
  } catch {
    record(activePhase, 'failed', status, 0);
    activeReminderFailureRecorded = true;
    throw new Error('The created reminder event was not visible in the widget');
  }
  record(activePhase, 'passed', status, 1);

  activePhase = 'reminder-alarm-ui-readback';
  const alarmReadback = await readBackRelativeAlarm(frame, title);
  if (!alarmReadback) {
    record(activePhase, 'failed', undefined, 1, {
      relativeAlarmReadback: false,
    });
    activeReminderFailureRecorded = true;
    throw new Error('The relative alarm did not reload from the event');
  }
  record(activePhase, 'passed', undefined, 1, { relativeAlarmReadback: true });

  activePhase = 'reminder-room-configuration-enabled';
  await setRoomReminder(frame, page, title, true);

  const titles = readReminderEventTitles();
  titles.push(title);
  writeReminderEventTitles(titles);
  return dueAt;
}

function localDateTimeInput(
  epochMilliseconds: number,
  timeZone: string,
): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(epochMilliseconds));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}

async function readBackRelativeAlarm(
  frame: FrameLocator,
  title: string,
): Promise<boolean> {
  await openEventEditor(frame, title);
  const editor = frame.getByRole('dialog').last();
  const alarmEnabled = await editor
    .getByLabel('CalDAV reminder')
    .isChecked()
    .catch(() => false);
  const relativeSelected = await editor
    .getByRole('radio', { name: 'Before the event' })
    .isChecked()
    .catch(() => false);
  const minutesBefore = await editor
    .getByRole('spinbutton', { name: 'Minutes before' })
    .inputValue()
    .catch(() => '');
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
  const details = frame.getByRole('dialog').last();
  await details.getByRole('button', { name: 'Close', exact: true }).click();
  return alarmEnabled && relativeSelected && minutesBefore === '1';
}

async function setRoomReminder(
  frame: FrameLocator,
  page: Page,
  title: string,
  enable: boolean,
): Promise<{ enabled: boolean; httpStatus: number | null }> {
  const row = frame.getByRole('listitem', { name: title });
  const details = frame.getByRole('dialog').last();
  const option = details.getByRole('checkbox', {
    name: /relative to event start$/u,
  });

  if (!enable) {
    await expect(row).toBeVisible();
    await row.click();
    await expect(details).toBeVisible();
    await details
      .getByRole('button', { name: 'Notify room', exact: true })
      .click();
    await expect(option).toBeVisible({ timeout: 20_000 });
    const enabled = await option.isChecked();
    await details.getByRole('button', { name: 'Close', exact: true }).click();
    return { enabled, httpStatus: null };
  }

  const observation: ReminderConfigurationObservation = {
    reminderStep: 'event-details',
    notifyButtonCount: 0,
    notifyButtonVisible: false,
    reminderOptionsGetCount: 0,
    reminderOptionsGetStatus: 0,
    reminderConfigGetCount: 0,
    reminderConfigGetStatus: 0,
    reminderEligibleOptionCount: 0,
    reminderOptionCheckedBefore: false,
    reminderOptionCheckAttempted: false,
    reminderPutCount: 0,
    reminderPutStatus: 0,
    reminderOptionCheckedAfter: false,
  };
  const roomPath = `/v1/calendar/rooms/${fixture.teamRoomId}/reminders`;
  const gatewayOrigin = new URL(fixture.gatewayUrl).origin;
  const classifyRequest = (urlValue: string, method: string) => {
    try {
      const url = new URL(urlValue);
      if (url.origin !== gatewayOrigin) return undefined;
      const pathname = decodeURIComponent(url.pathname);
      if (method === 'GET' && pathname === `${roomPath}/options`) {
        return 'options' as const;
      }
      if (method === 'GET' && pathname === roomPath) {
        return 'config' as const;
      }
      if (method === 'PUT' && pathname === roomPath) {
        return 'put' as const;
      }
    } catch {
      return undefined;
    }
    return undefined;
  };
  const onRequest = (request: Request) => {
    const kind = classifyRequest(request.url(), request.method());
    if (kind === 'options') {
      observation.reminderOptionsGetCount = Math.min(
        observation.reminderOptionsGetCount + 1,
        2,
      );
    } else if (kind === 'config') {
      observation.reminderConfigGetCount = Math.min(
        observation.reminderConfigGetCount + 1,
        2,
      );
    } else if (kind === 'put') {
      observation.reminderPutCount = Math.min(
        observation.reminderPutCount + 1,
        2,
      );
    }
  };
  const onResponse = (response: Response) => {
    const kind = classifyRequest(response.url(), response.request().method());
    if (kind === 'options') {
      observation.reminderOptionsGetStatus = response.status();
    } else if (kind === 'config') {
      observation.reminderConfigGetStatus = response.status();
    } else if (kind === 'put') {
      observation.reminderPutStatus = response.status();
    }
  };
  const writeFailure = async () => {
    observation.reminderOptionCheckedAfter = await option
      .isChecked()
      .catch(() => false);
    const httpStatus =
      observation.reminderPutStatus ||
      observation.reminderOptionsGetStatus ||
      observation.reminderConfigGetStatus ||
      undefined;
    record(activePhase, 'failed', httpStatus, undefined, {
      ...observation,
      reminderEnabled: observation.reminderOptionCheckedAfter,
    });
    activeReminderFailureRecorded = true;
  };

  page.on('request', onRequest);
  page.on('response', onResponse);
  try {
    await expect(row).toBeVisible();
    await row.click();
    await expect(details).toBeVisible();
    observation.reminderStep = 'notify-control';
    const notifyButton = details.getByRole('button', {
      name: 'Notify room',
      exact: true,
    });
    observation.notifyButtonCount = Math.min(await notifyButton.count(), 2);
    observation.notifyButtonVisible =
      observation.notifyButtonCount === 1 &&
      (await notifyButton.isVisible().catch(() => false));
    if (!observation.notifyButtonVisible) {
      throw new Error('Room reminder control is unavailable');
    }

    observation.reminderStep = 'options-load';
    await notifyButton.click();
    await option.waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {});
    observation.reminderEligibleOptionCount = Math.min(await option.count(), 2);
    observation.reminderOptionCheckedBefore =
      observation.reminderEligibleOptionCount === 1 &&
      (await option.isChecked().catch(() => false));
    if (
      observation.reminderEligibleOptionCount !== 1 ||
      observation.reminderOptionsGetCount === 0 ||
      observation.reminderConfigGetCount === 0 ||
      observation.reminderOptionsGetStatus < 200 ||
      observation.reminderOptionsGetStatus >= 300 ||
      observation.reminderConfigGetStatus < 200 ||
      observation.reminderConfigGetStatus >= 300 ||
      observation.reminderOptionCheckedBefore
    ) {
      observation.reminderStep = 'eligible-option';
      throw new Error('Expected reminder alarm option is unavailable');
    }

    observation.reminderStep = 'put-response';
    const putResponse = page
      .waitForResponse(
        (response) =>
          classifyRequest(response.url(), response.request().method()) ===
          'put',
        { timeout: 15_000 },
      )
      .catch(() => undefined);
    observation.reminderOptionCheckAttempted = true;
    await option.click();
    const response = await putResponse;
    if (response) observation.reminderPutStatus = response.status();
    observation.reminderOptionCheckedAfter = await option
      .isChecked()
      .catch(() => false);
    if (
      observation.reminderPutCount !== 1 ||
      observation.reminderPutStatus < 200 ||
      observation.reminderPutStatus >= 300 ||
      !observation.reminderOptionCheckedAfter
    ) {
      throw new Error('Room reminder configuration was not saved');
    }

    await details.getByRole('button', { name: 'Close', exact: true }).click();
    observation.reminderStep = 'complete';
    record(activePhase, 'passed', observation.reminderPutStatus, 1, {
      ...observation,
      reminderEnabled: true,
    });
    return { enabled: true, httpStatus: observation.reminderPutStatus };
  } catch {
    if (!activeReminderFailureRecorded) await writeFailure();
    throw new Error('Room reminder configuration could not be confirmed');
  } finally {
    page.off('request', onRequest);
    page.off('response', onResponse);
  }
}

async function readBackReminderMarkers(
  frame: FrameLocator,
  page: Page,
  titles: readonly string[],
): Promise<{
  count: number;
  relativeAlarmReadback: boolean;
  reminderEnabled: boolean;
}> {
  let relativeAlarmReadback = true;
  let reminderEnabled = true;
  for (const title of titles) {
    relativeAlarmReadback =
      (await readBackRelativeAlarm(frame, title)) && relativeAlarmReadback;
    const current = await setRoomReminder(frame, page, title, false);
    reminderEnabled = current.enabled && reminderEnabled;
  }
  return {
    count: titles.length,
    relativeAlarmReadback,
    reminderEnabled,
  };
}

async function inspectReminderTimeline(
  titles: readonly string[],
): Promise<ReminderTimelineSnapshot> {
  const empty: ReminderTimelineSnapshot = {
    httpStatus: null,
    complete: false,
    markerCounts: titles.map(() => 0),
    markerMentions: titles.map(() => false),
    markerTimestamps: titles.map(() => null),
  };
  let response: Awaited<ReturnType<typeof fetch>>;
  try {
    const endpoint = new URL(
      `/_matrix/client/v3/rooms/${encodeURIComponent(fixture.teamRoomId)}/messages`,
      fixture.homeserverUrl,
    );
    endpoint.searchParams.set('dir', 'b');
    endpoint.searchParams.set('limit', '100');
    response = await fetch(endpoint, {
      headers: {
        Authorization: `Bearer ${fixture.serviceSender.accessToken}`,
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return empty;
  }
  if (response.status !== 200) {
    await response.body?.cancel().catch(() => undefined);
    return { ...empty, httpStatus: response.status };
  }

  let chunk: unknown;
  try {
    const payload: unknown = await response.json();
    if (
      typeof payload !== 'object' ||
      payload === null ||
      !Array.isArray((payload as { chunk?: unknown }).chunk)
    ) {
      return { ...empty, httpStatus: response.status };
    }
    chunk = (payload as { chunk: unknown[] }).chunk;
  } catch {
    return { ...empty, httpStatus: response.status };
  }
  if (!Array.isArray(chunk) || chunk.length >= 100) {
    return { ...empty, httpStatus: response.status };
  }

  const events = chunk.filter(isRecord);
  const markerCounts: number[] = [];
  const markerMentions: boolean[] = [];
  const markerTimestamps: Array<number | null> = [];
  for (const title of titles) {
    const matching = events.filter((event) => {
      const content = isRecord(event.content) ? event.content : undefined;
      return (
        event.sender === fixture.serviceSender.userId &&
        event.type === 'm.room.message' &&
        content?.msgtype === 'm.text' &&
        content.body === `Reminder: ${title}`
      );
    });
    markerCounts.push(Math.min(matching.length, 2));
    const content =
      matching.length === 1 && isRecord(matching[0].content)
        ? matching[0].content
        : undefined;
    const mentions =
      content && isRecord(content['m.mentions'])
        ? content['m.mentions']
        : undefined;
    markerMentions.push(matching.length === 1 && mentions?.room === true);
    const timestamp =
      matching.length === 1 ? matching[0].origin_server_ts : undefined;
    markerTimestamps.push(
      typeof timestamp === 'number' && Number.isSafeInteger(timestamp)
        ? timestamp
        : null,
    );
  }
  return {
    httpStatus: response.status,
    complete: true,
    markerCounts,
    markerMentions,
    markerTimestamps,
  };
}

async function waitForReminderDelivery(
  title: string,
  titles: readonly string[],
  dueAt: number,
): Promise<ReminderTimelineSnapshot & { deliveredAfterDue: boolean }> {
  const deadline = dueAt + REMINDER_POST_DUE_SCAN_ALLOWANCE_MS;
  let latest = await inspectReminderTimeline(titles);
  while (Date.now() <= deadline) {
    const markerIndex = titles.indexOf(title);
    if (latest.httpStatus !== 200 || !latest.complete) {
      return { ...latest, deliveredAfterDue: false };
    }
    if ((latest.markerCounts[markerIndex] ?? 0) > 0) {
      const deliveredAt = latest.markerTimestamps[markerIndex];
      return {
        ...latest,
        deliveredAfterDue: deliveredAt !== null && deliveredAt >= dueAt,
      };
    }
    await new Promise((resolvePromise) =>
      setTimeout(resolvePromise, REMINDER_TIMELINE_POLL_MS),
    );
    latest = await inspectReminderTimeline(titles);
  }
  return { ...latest, deliveredAfterDue: false };
}

function readFixture(): Fixture {
  const path = process.env.ELEMENT_ACCEPTANCE_USERS_FILE;
  if (!path) throw new Error('Element acceptance fixture unavailable');
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Fixture;
  } catch {
    throw new Error('Element acceptance fixture unavailable');
  }
}

function recordBlockedRequestFailure(
  blockedRequestCount: number,
  evidence: BlockedRequestEvidence,
): boolean {
  if (blockedRequestCount === 0) return false;
  record('browser-egress', 'failed', undefined, blockedRequestCount, {
    blockedRequestDiagnostics: Array.from(evidence.diagnostics.values()),
    blockedRequestDiagnosticOverflow: evidence.overflow,
  });
  return true;
}

function safeBlockedRequestResourceType(
  resourceType: string,
): BlockedRequestResourceType {
  return BLOCKED_REQUEST_RESOURCE_TYPES.has(
    resourceType as BlockedRequestResourceType,
  )
    ? (resourceType as BlockedRequestResourceType)
    : 'other';
}

function classifyBlockedRequest(
  url: URL,
  fixtureHosts: ReadonlySet<string>,
): BlockedRequestClass {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return 'non-http-scheme';
  }

  const hostname = url.hostname.toLowerCase();
  if (fixtureHosts.has(hostname)) {
    if (url.pathname === '/.well-known/matrix/client') {
      return 'matrix-client-well-known-discovery';
    }
    if (url.pathname === '/.well-known/matrix/server') {
      return 'matrix-server-well-known-discovery';
    }
    return 'fixture-host-origin-mismatch';
  }

  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '::1' ||
    hostname === '[::1]' ||
    /^127(?:\.\d{1,3}){3}$/u.test(hostname)
  ) {
    return 'unapproved-loopback-origin';
  }

  return 'external-http-origin';
}

function recordBlockedRequest(
  evidence: BlockedRequestEvidence,
  actor: BrowserActor,
  harnessPhase: Phase,
  requestClass: BlockedRequestClass,
  resourceType: BlockedRequestResourceType,
) {
  const key = JSON.stringify([actor, harnessPhase, requestClass, resourceType]);
  const existing = evidence.diagnostics.get(key);
  if (existing) {
    existing.count = Math.min(existing.count + 1, 2);
    return;
  }
  if (evidence.diagnostics.size >= MAX_BLOCKED_REQUEST_DIAGNOSTIC_BUCKETS) {
    evidence.overflow = true;
    return;
  }

  evidence.diagnostics.set(key, {
    actor,
    harnessPhase,
    requestClass,
    resourceType,
    count: 1,
  });
}

async function authenticateInElement(
  context: BrowserContext,
  user: User,
  captureMemberADiagnostics = false,
): Promise<Page> {
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  page.setDefaultNavigationTimeout(30_000);
  if (captureMemberADiagnostics) {
    const homeserverOrigin = new URL(fixture.homeserverUrl).origin;
    const homeserverHttpFailures: HomeserverHttpFailures = { count: 0 };
    memberAHomeserverHttpFailures.set(page, homeserverHttpFailures);
    const contextBlockedRequests =
      blockedExternalRequestsByContext.get(context);
    if (contextBlockedRequests) {
      memberABlockedExternalRequests.set(page, contextBlockedRequests);
    }
    page.on('response', (response) => {
      try {
        if (
          new URL(response.url()).origin === homeserverOrigin &&
          response.status() >= 400
        ) {
          homeserverHttpFailures.count = Math.min(
            homeserverHttpFailures.count + 1,
            100_000,
          );
          homeserverHttpFailures.lastStatus = response.status();
        }
      } catch {
        // Keep only the bounded count/status below; never retain request data.
      }
    });
    activePhase = 'member-a-origin-navigation';
  }
  const originResponse = await page.goto(
    new URL('/welcome/images/logo.svg', fixture.elementUrl).href,
  );
  if (captureMemberADiagnostics) {
    const originMatchesElement =
      new URL(page.url()).origin === new URL(fixture.elementUrl).origin;
    record(activePhase, 'passed', originResponse?.status(), undefined, {
      originMatchesElement,
    });
    activePhase = 'member-a-credentials-seeded';
  }

  await page.evaluate(
    ({ homeserverUrl, credentials }) => {
      window.localStorage.setItem('mx_hs_url', homeserverUrl);
      window.localStorage.setItem('mx_user_id', credentials.userId);
      window.localStorage.setItem('mx_access_token', credentials.accessToken);
      window.localStorage.setItem('mx_device_id', credentials.deviceId);
      window.localStorage.setItem('mx_is_guest', 'false');
      window.localStorage.setItem('mx_has_pickle_key', 'false');
      window.localStorage.setItem('mx_has_access_token', 'true');
      window.localStorage.setItem(
        'mx_local_settings',
        JSON.stringify({
          analyticsOptIn: false,
          showCookieBar: false,
          language: 'en',
          theme: 'light',
        }),
      );
      window.localStorage.setItem('notifications_hidden', 'true');
      window.localStorage.setItem('audio_notifications_enabled', 'false');
    },
    { homeserverUrl: fixture.homeserverUrl, credentials: user },
  );
  if (captureMemberADiagnostics) {
    record(activePhase, 'passed');
    activePhase = 'member-a-root-navigation';
  }

  const rootResponse = await page.goto(fixture.elementUrl);
  if (captureMemberADiagnostics) {
    record(activePhase, 'passed', rootResponse?.status());
    activePhase = 'member-a-session-observed';
  }

  const sessionReady = await page
    .waitForFunction(
      (expectedUserId) => {
        type MatrixClient = { getUserId?: () => string | null };
        type MatrixClientPeg = { get?: () => MatrixClient | undefined };
        try {
          const matrixClientPeg = (
            window as unknown as {
              mxMatrixClientPeg?: MatrixClientPeg;
            }
          ).mxMatrixClientPeg;
          const matrixClient = matrixClientPeg?.get?.();
          return matrixClient?.getUserId?.() === expectedUserId;
        } catch {
          return false;
        }
      },
      user.userId,
      { timeout: 30_000 },
    )
    .then(() => true)
    .catch(() => false);

  if (captureMemberADiagnostics) {
    const sessionObservation = await page
      .evaluate((expectedUserId) => {
        type MatrixClient = {
          getUserId?: () => string | null;
          getSyncState?: () => string | null;
        };
        type MatrixClientPeg = { get?: () => MatrixClient | undefined };
        let matrixClientPeg: MatrixClientPeg | undefined;
        let matrixClient: MatrixClient | undefined;
        try {
          matrixClientPeg = (
            window as unknown as {
              mxMatrixClientPeg?: MatrixClientPeg;
            }
          ).mxMatrixClientPeg;
          matrixClient = matrixClientPeg?.get?.();
        } catch {
          // Report only the bounded state below; never return exception text.
        }
        const knownSyncStates = new Set([
          'ERROR',
          'PREPARED',
          'RECONNECTING',
          'STOPPED',
          'SYNCING',
          'CATCHUP',
        ]);
        let matrixUserMatches = false;
        let matrixSyncState: MatrixSyncState = 'UNKNOWN';
        try {
          matrixUserMatches = matrixClient?.getUserId?.() === expectedUserId;
        } catch {
          // Report only bounded booleans and known sync states.
        }
        try {
          const rawSyncState = matrixClient?.getSyncState?.();
          if (
            typeof rawSyncState === 'string' &&
            knownSyncStates.has(rawSyncState)
          ) {
            matrixSyncState = rawSyncState as MatrixSyncState;
          }
        } catch {
          // Report only bounded booleans and known sync states.
        }
        return {
          matrixClientHookPresent: Boolean(matrixClientPeg),
          matrixClientPresent: Boolean(matrixClient),
          matrixUserMatches,
          matrixSyncState,
        };
      }, user.userId)
      .catch(() => undefined);
    recordMemberASessionObservation(sessionObservation);
    activePhase = 'member-a-authenticated';
  }

  if (!sessionReady) {
    throw new Error('Element session did not restore the expected user');
  }
  return page;
}

async function openFixtureRoom(
  page: Page,
  roomName: string,
  roomId: string,
): Promise<ElementWebPage> {
  const roomUrl = new URL(fixture.elementUrl);
  roomUrl.hash = `/room/${roomId}`;
  await page.goto(roomUrl.href);

  const element = new ElementWebPage(page);
  await expect(getPinnedElementRoomNameHeading(page)).toHaveText(roomName);
  expect(element.getCurrentRoomId()).toBe(roomId);
  return element;
}

function getPinnedElementRoomNameHeading(page: Page): Locator {
  return page.locator('header.mx_RoomHeader').getByRole('heading');
}

async function openMemberARoomWithDiagnostics(
  page: Page,
  roomName: string,
  roomId: string,
  expectedUserId: string,
  captureReminderRoomLayout = false,
): Promise<MemberARoomResult> {
  const roomUrl = new URL(fixture.elementUrl);
  roomUrl.hash = `/room/${roomId}`;
  let navigationCompleted = false;
  try {
    await page.goto(roomUrl.href, { timeout: 20_000 });
    navigationCompleted = true;
  } catch {
    // The failure summary records only whether this bounded navigation ended.
  }

  const element = new ElementWebPage(page);
  const roomNameHeading = getPinnedElementRoomNameHeading(page);
  let roomHeadingReady = false;
  if (navigationCompleted) {
    try {
      await roomNameHeading.waitFor({
        state: 'visible',
        timeout: 15_000,
      });
      const headingText = await roomNameHeading.textContent({
        timeout: 1_000,
      });
      roomHeadingReady = headingText?.trim() === roomName;
    } catch {
      // The post-wait observation records only fixed booleans.
    }
  }

  const observation = await observeMemberARoom(
    page,
    element,
    roomName,
    roomId,
    expectedUserId,
    navigationCompleted,
    roomHeadingReady,
    captureReminderRoomLayout,
  ).catch(() => undefined);
  return {
    element,
    navigationCompleted,
    observation,
    failureCode: getMemberARoomFailureCode(navigationCompleted, observation),
  };
}

async function observeMemberARoom(
  page: Page,
  element: ElementWebPage,
  roomName: string,
  roomId: string,
  expectedUserId: string,
  roomNavigationCompleted: boolean,
  roomHeadingReady: boolean,
  captureReminderRoomLayout: boolean,
): Promise<MemberARoomObservation> {
  const matrixState = await page.evaluate(
    ({ expectedRoomId, expectedMatrixUserId }) => {
      type MatrixRoom = { getMyMembership?: () => string | null };
      type MatrixClient = {
        getUserId?: () => string | null;
        getRoom?: (id: string) => MatrixRoom | undefined;
        getSyncState?: () => string | null;
      };
      type MatrixClientPeg = { get?: () => MatrixClient | undefined };
      const knownSyncStates = new Set([
        'ERROR',
        'PREPARED',
        'RECONNECTING',
        'STOPPED',
        'SYNCING',
        'CATCHUP',
      ]);
      let matrixClient: MatrixClient | undefined;
      try {
        const matrixClientPeg = (
          window as unknown as {
            mxMatrixClientPeg?: MatrixClientPeg;
          }
        ).mxMatrixClientPeg;
        matrixClient = matrixClientPeg?.get?.();
      } catch {
        // Report fixed booleans and known sync states only.
      }

      let matrixUserMatches = false;
      let matrixRoomKnown = false;
      let matrixRoomJoined = false;
      let matrixSyncState: MatrixSyncState = 'UNKNOWN';
      try {
        matrixUserMatches =
          matrixClient?.getUserId?.() === expectedMatrixUserId;
      } catch {
        // Keep the identity observation boolean-only.
      }
      try {
        const matrixRoom = matrixClient?.getRoom?.(expectedRoomId);
        matrixRoomKnown = Boolean(matrixRoom);
        matrixRoomJoined = matrixRoom?.getMyMembership?.() === 'join';
      } catch {
        // Keep room state observations boolean-only.
      }
      try {
        const rawSyncState = matrixClient?.getSyncState?.();
        if (
          typeof rawSyncState === 'string' &&
          knownSyncStates.has(rawSyncState)
        ) {
          matrixSyncState = rawSyncState as MatrixSyncState;
        }
      } catch {
        // Keep only fixed sync state values.
      }
      return {
        matrixUserMatches,
        matrixRoomKnown,
        matrixRoomJoined,
        matrixSyncState,
      };
    },
    { expectedRoomId: roomId, expectedMatrixUserId: expectedUserId },
  );
  const roomNameHeading = getPinnedElementRoomNameHeading(page);
  const roomHeadingCount = await roomNameHeading.count().catch(() => 0);
  const roomHeadingPresent =
    roomHeadingCount > 0 &&
    (await roomNameHeading.isVisible().catch(() => false));
  const roomNameMatches =
    roomHeadingCount > 0 &&
    (await roomNameHeading
      .first()
      .evaluate(
        (heading, expectedName) =>
          (heading.textContent ?? '').trim() === expectedName,
        roomName,
        { timeout: 1_000 },
      )
      .catch(() => false));
  let roomLayoutObservation:
    | Pick<
        MemberARoomObservation,
        | 'roomViewPresent'
        | 'roomHeaderPresent'
        | 'roomHeadingDomPresent'
        | 'roomInfoControlPresent'
        | 'fixtureCalendarIframePresent'
      >
    | undefined;
  if (captureReminderRoomLayout) {
    const [roomViewCount, roomHeaderCount, roomInfoControlCount, iframeCount] =
      await Promise.all([
        page
          .locator('.mx_RoomView')
          .count()
          .catch(() => 0),
        page
          .locator('header.mx_RoomHeader')
          .count()
          .catch(() => 0),
        page
          .locator('header.mx_RoomHeader button.mx_RoomHeader_infoWrapper')
          .count()
          .catch(() => 0),
        page
          .locator('iframe[title="Matrix Calendar"]')
          .count()
          .catch(() => 0),
      ]);
    roomLayoutObservation = {
      roomViewPresent: roomViewCount > 0,
      roomHeaderPresent: roomHeaderCount > 0,
      roomHeadingDomPresent: roomHeadingCount > 0,
      roomInfoControlPresent: roomInfoControlCount > 0,
      fixtureCalendarIframePresent: iframeCount > 0,
    };
  }
  let roomIdMatches = false;
  try {
    roomIdMatches = element.getCurrentRoomId() === roomId;
  } catch {
    // The URL is represented only as an equality result.
  }
  const homeserverHttpFailures = memberAHomeserverHttpFailures.get(page) ?? {
    count: 0,
  };
  const blockedExternalRequests =
    memberABlockedExternalRequests.get(page)?.count ?? 0;
  return {
    ...matrixState,
    roomNavigationCompleted,
    roomHeadingReady,
    roomHeadingPresent,
    roomNameMatches,
    roomIdMatches,
    ...(roomLayoutObservation ?? {}),
    blockedExternalRequestCount: blockedExternalRequests,
    homeserverHttpErrorCount: homeserverHttpFailures.count,
    ...(homeserverHttpFailures.lastStatus === undefined
      ? {}
      : { homeserverLastHttpErrorStatus: homeserverHttpFailures.lastStatus }),
  };
}

function getMemberARoomFailureCode(
  navigationCompleted: boolean,
  observation: MemberARoomObservation | undefined,
): MemberARoomFailureCode | undefined {
  if (!navigationCompleted) return 'element-room-navigation-failed';
  if (!observation) return 'element-room-observation-unavailable';
  if (!observation.matrixUserMatches) return 'element-room-session-mismatch';
  if (!observation.roomIdMatches) return 'element-room-route-mismatch';
  if (!observation.matrixRoomKnown) return 'element-room-not-known';
  if (!observation.matrixRoomJoined) return 'element-room-not-joined';
  if (!observation.roomHeadingPresent) {
    return 'element-room-heading-not-present';
  }
  if (!observation.roomNameMatches) return 'element-room-name-mismatch';
  if (!observation.roomHeadingReady) {
    return 'element-room-heading-wait-timeout';
  }
  return undefined;
}

function requireMemberARoom(result: MemberARoomResult): ElementWebPage {
  if (result.failureCode) {
    throw new Error('Element room context did not become ready');
  }
  return result.element;
}

function recordJourneyFailure(
  phase: Phase,
  httpStatus: number | undefined,
  alreadyRecorded: boolean,
  teamRoomMatches?: boolean,
) {
  if (!alreadyRecorded) {
    const observation =
      pendingPinnedControlObservation?.phase === phase
        ? pendingPinnedControlObservation
        : undefined;
    record(phase, 'failed', httpStatus, observation?.count, {
      ...(observation
        ? {
            controlVisible: observation.controlVisible,
            ...(observation.panelPresent === undefined
              ? {}
              : { panelPresent: observation.panelPresent }),
          }
        : {}),
      ...(teamRoomMatches === undefined ? {} : { teamRoomMatches }),
    });
  }
  pendingPinnedControlObservation = undefined;
}

async function openCalendarWidget(
  element: ElementWebPage,
  page: Page,
  {
    expectWidgetWarning,
    waitForCalendar = true,
    captureMemberADiagnostics = false,
  }: OpenCalendarWidgetOptions,
) {
  await openPinnedElementWidget(
    page,
    'Matrix Calendar',
    captureMemberADiagnostics,
  );
  if (captureMemberADiagnostics) {
    if (!expectWidgetWarning) activePhase = 'widget-a-warning-not-required';
  }
  if (expectWidgetWarning) {
    await element.approveWidgetWarning();
    if (captureMemberADiagnostics) record(activePhase, 'passed');
  } else if (captureMemberADiagnostics) {
    record(activePhase, 'passed');
  }
  if (captureMemberADiagnostics) {
    activePhase = 'widget-a-capabilities-approval';
  }
  await element.approveWidgetCapabilities();
  if (captureMemberADiagnostics) record(activePhase, 'passed');
  if (captureMemberADiagnostics) {
    activePhase = 'widget-a-identity-approval';
  }
  const identityContinue = page
    .getByRole('dialog')
    .getByRole('button', { name: 'Continue', exact: true })
    .first();
  await identityContinue
    .waitFor({ state: 'visible', timeout: 8_000 })
    .catch(() => undefined);
  const identityDialogShown = await identityContinue
    .isVisible()
    .catch(() => false);
  if (captureMemberADiagnostics) {
    record(
      identityDialogShown
        ? 'widget-a-identity-dialog-observed'
        : 'widget-a-identity-dialog-not-required',
      'passed',
    );
  }
  if (identityDialogShown) {
    if (captureMemberADiagnostics) {
      activePhase = 'widget-a-identity-approval';
    }
    await element.approveWidgetIdentity();
    if (captureMemberADiagnostics) {
      record(activePhase, 'passed');
      activePhase = 'widget-a-iframe-ready';
    }
  } else if (captureMemberADiagnostics) {
    activePhase = 'widget-a-iframe-ready';
  }
  const frame = element.widgetByTitle('Matrix Calendar');
  if (captureMemberADiagnostics) {
    activePhase = 'widget-a-iframe-attached';
    await page
      .locator('iframe[title="Matrix Calendar"]')
      .waitFor({ state: 'attached', timeout: 30_000 });
    record(activePhase, 'passed');
    activePhase = 'widget-a-iframe-ready';
  }
  if (waitForCalendar) {
    await frame
      .getByRole('button', { name: 'Create event', exact: true })
      .waitFor();
  }
  return frame;
}

async function openPinnedElementWidget(
  page: Page,
  widgetName: string,
  captureMemberADiagnostics = false,
): Promise<void> {
  const roomHeader = page.locator('header.mx_RoomHeader');
  const rightPanel = page.getByRole('complementary');
  await clickPinnedWidgetControl(
    roomHeader.locator('button.mx_RoomHeader_infoWrapper'),
    captureMemberADiagnostics ? 'widget-a-room-info-button' : undefined,
  );
  await clickPinnedWidgetControl(
    rightPanel.getByRole('menuitem', { name: 'Extensions' }),
    captureMemberADiagnostics ? 'widget-a-extensions-menuitem' : undefined,
    rightPanel,
  );
  await clickPinnedWidgetControl(
    rightPanel.getByRole('button', { name: widgetName }),
    captureMemberADiagnostics ? 'widget-a-extension-row' : undefined,
    rightPanel,
  );
}

async function clickPinnedWidgetControl(
  control: Locator,
  diagnosticPhase?:
    | 'widget-a-room-info-button'
    | 'widget-a-extensions-menuitem'
    | 'widget-a-extension-row',
  panel?: Locator,
): Promise<void> {
  if (!diagnosticPhase) {
    await control.click();
    return;
  }

  activePhase = diagnosticPhase;
  await control.waitFor({ state: 'visible', timeout: 8_000 }).catch(() => {});
  const count = Math.min(await control.count(), 2);
  const visibleControl = control.filter({ visible: true });
  const visibleCount = Math.min(await visibleControl.count(), 2);
  const controlVisible = visibleCount > 0;
  const panelPresent = panel
    ? (await panel.filter({ visible: true }).count()) > 0
    : undefined;
  pendingPinnedControlObservation = {
    phase: diagnosticPhase,
    count,
    controlVisible,
    ...(panelPresent === undefined ? {} : { panelPresent }),
  };

  if (
    count !== 1 ||
    visibleCount !== 1 ||
    !controlVisible ||
    panelPresent === false
  ) {
    throw new Error('Pinned Element widget control unavailable');
  }

  await visibleControl.click({ timeout: 8_000 });
  record(diagnosticPhase, 'passed', undefined, count, {
    controlVisible,
    ...(panelPresent === undefined ? {} : { panelPresent }),
  });
  pendingPinnedControlObservation = undefined;
}

async function openEventEditor(
  frame: ReturnType<ElementWebPage['widgetByTitle']>,
  title: string,
) {
  const row = frame.getByRole('listitem', { name: title });
  await expect(row).toBeVisible();
  await row.click();
  const details = frame.getByRole('dialog').last();
  await details.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(
    frame.getByRole('dialog').last().getByRole('textbox', { name: 'Title' }),
  ).toBeVisible();
}

async function readGatewayEventUpdate(
  response: Response | undefined,
  expectedEventHref: string,
  expectedTitle: string,
): Promise<{
  etag?: string;
  identityMatches: boolean;
  titleMatches?: boolean;
}> {
  if (!response) return { identityMatches: false };
  try {
    const body: unknown = await response.json();
    if (typeof body !== 'object' || body === null || !('event' in body)) {
      return { identityMatches: false };
    }
    const event = body.event;
    const etag =
      'etag' in body && typeof body.etag === 'string' ? body.etag : undefined;
    const identityMatches =
      typeof event === 'object' &&
      event !== null &&
      'id' in event &&
      typeof event.id === 'string' &&
      g6GatewayResourceIdentityMatches(event.id, expectedEventHref);
    const titleMatches =
      typeof event === 'object' &&
      event !== null &&
      'title' in event &&
      typeof event.title === 'string'
        ? event.title === expectedTitle
        : undefined;
    return {
      ...(etag ? { etag } : {}),
      identityMatches,
      ...(titleMatches === undefined ? {} : { titleMatches }),
    };
  } catch {
    return { identityMatches: false };
  }
}

function waitForGatewayResponse(
  page: Page,
  method: string,
  pathname: string,
): Promise<Response> {
  return page.waitForResponse(
    (response) => {
      const url = new URL(response.url());
      return (
        url.origin === new URL(fixture.gatewayUrl).origin &&
        url.pathname === pathname &&
        response.request().method() === method
      );
    },
    { timeout: 30_000 },
  );
}

function observeReminderWidgetContextResponse(
  page: Page,
  roomId: string,
): ReminderWidgetContextResponseObserver {
  let responseStatus: number | undefined;
  const gatewayOrigin = new URL(fixture.gatewayUrl).origin;
  const widgetOrigin = new URL(fixture.widgetUrl).origin;
  const response = page.waitForResponse(
    (candidate) => {
      try {
        const url = new URL(candidate.url());
        const request = candidate.request();
        const requestFrameOrigin = new URL(request.frame().url()).origin;
        if (
          url.origin !== gatewayOrigin ||
          url.pathname !== '/v1/calendar/context' ||
          url.searchParams.get('roomId') !== roomId ||
          request.method() !== 'GET' ||
          requestFrameOrigin !== widgetOrigin
        ) {
          return false;
        }
        responseStatus = candidate.status();
        return true;
      } catch {
        return false;
      }
    },
    { timeout: 60_000 },
  );
  return {
    response,
    snapshot: () => ({
      reminderWidgetContextResponseCount: responseStatus === undefined ? 0 : 1,
      ...(responseStatus === undefined
        ? {}
        : { reminderWidgetContextResponseStatus: responseStatus }),
    }),
  };
}

async function requestRoomEventsStatus(
  page: Page,
  {
    gatewayUrl,
    roomId,
    calendarId,
  }: { gatewayUrl: string; roomId: string; calendarId: string },
): Promise<number> {
  return page.evaluate(
    async ({ gatewayUrl, roomId, calendarId }) => {
      // Only the numeric HTTP status crosses back into the test process.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const matrixClient = (window as any).mxMatrixClientPeg.get();
      const credentials = await matrixClient.getOpenIdToken();
      const identity = {
        matrix_server_name: credentials.matrix_server_name,
        access_token: credentials.access_token,
      };
      const query = new URLSearchParams({
        roomId,
        target: 'room',
        calendarId,
        start: new Date().toISOString(),
        end: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        timezone: 'Europe/Stockholm',
      });
      const response = await fetch(
        `${gatewayUrl}/v1/calendar/events?${query.toString()}`,
        {
          headers: {
            Authorization: `MX-Identity ${btoa(JSON.stringify(identity))}`,
          },
        },
      );
      await response.body?.cancel();
      return response.status;
    },
    { gatewayUrl, roomId, calendarId },
  );
}

function observePostCreateVisibility(
  page: Page,
  {
    expectedCalendarId,
    expectedRoomId,
    expectedTitle,
  }: {
    expectedCalendarId: string;
    expectedRoomId: string;
    expectedTitle: string;
  },
) {
  const expectedGatewayOrigin = new URL(fixture.gatewayUrl).origin;
  const observation: PostCreateVisibilityObservation = {
    postCreateEventGetRequestCount: 0,
    roomTargetRangeRequestCount: 0,
    expectedRoomRangeRequestSeen: false,
    roomTargetRangeResponseCount: 0,
    roomTargetRangeLastStatus: null,
    createResponseHasEvent: false,
    createResponseTitleMatches: false,
    createResponseCalendarMatches: false,
    createResponseTimingComparable: false,
    createResponseEventIntersectsRoomRange: false,
    caldavReportProbeCompleted: false,
    caldavOpenIdHttpStatus: null,
    caldavReportHttpStatus: null,
    caldavReportContainsCreatedEvent: null,
    caldavProjection: {
      completed: false,
      includesCreatedEvent: null,
      diagnosticCode: 'inconclusive',
      diagnosticCounts: emptyProjectionDiagnosticCounts(),
      timezoneAudit: unavailableTimezoneAudit(),
    },
    roomListResponseHasEventsArray: false,
    roomListResponseEventCount: 0,
    roomListDiagnostics: {
      complete: false,
      counts: emptyProjectionDiagnosticCounts(),
    },
    roomListResponseTitleMatches: false,
    roomListResponseIdMatches: false,
    roomListResponseCalendarMatches: false,
    listViewHeadingPresent: false,
    matchingListItemCount: 0,
  };
  const pendingResponseReads: Promise<void>[] = [];
  const postCreateRangeRequests = new WeakSet<Request>();
  let successfulCreateResponseObserved = false;
  let createdEventId: string | undefined;
  let createdEventUid: string | undefined;
  let createdEventTiming: CreatedEventTiming | undefined;
  let expectedRoomRange: ExpectedRoomRange | undefined;
  let matchingEventListRow: { id?: string; calendarId?: string } | undefined;

  const roomRangeMatches = (rawUrl: string) => {
    try {
      const url = new URL(rawUrl);
      if (
        url.origin !== expectedGatewayOrigin ||
        url.pathname !== '/v1/calendar/events' ||
        url.searchParams.get('target') !== 'room' ||
        url.searchParams.get('roomId') !== expectedRoomId
      ) {
        return { roomTarget: false, expectedRange: false };
      }

      const roomTarget = true;
      const start = url.searchParams.get('start') ?? '';
      const end = url.searchParams.get('end') ?? '';
      const startMillis = Date.parse(start);
      const endMillis = Date.parse(end);
      const expectedRange =
        url.searchParams.get('calendarId') === expectedCalendarId &&
        Number.isFinite(startMillis) &&
        Number.isFinite(endMillis) &&
        endMillis > startMillis;
      return {
        roomTarget,
        expectedRange,
        ...(expectedRange
          ? {
              range: {
                start,
                end,
                timezone: url.searchParams.get('timezone') ?? '',
              },
            }
          : {}),
      };
    } catch {
      return { roomTarget: false, expectedRange: false };
    }
  };

  const onRequest = (request: Request) => {
    if (
      request.method() === 'POST' &&
      isCalendarEventsEndpoint(request.url())
    ) {
      return;
    }
    if (
      request.method() !== 'GET' ||
      !isCalendarEventsEndpoint(request.url()) ||
      !successfulCreateResponseObserved
    ) {
      return;
    }

    postCreateRangeRequests.add(request);
    observation.postCreateEventGetRequestCount = Math.min(
      observation.postCreateEventGetRequestCount + 1,
      2,
    );
    const roomRange = roomRangeMatches(request.url());
    if (roomRange.roomTarget) {
      observation.roomTargetRangeRequestCount = Math.min(
        observation.roomTargetRangeRequestCount + 1,
        2,
      );
    }
    if (roomRange.expectedRange) {
      observation.expectedRoomRangeRequestSeen = true;
      expectedRoomRange ??= roomRange.range;
    }
  };

  const onResponse = (response: Response) => {
    const request = response.request();
    if (
      request.method() === 'POST' &&
      isCalendarEventsEndpoint(response.url())
    ) {
      successfulCreateResponseObserved =
        response.status() >= 200 && response.status() < 300;
      return;
    }
    if (
      request.method() !== 'GET' ||
      !isCalendarEventsEndpoint(response.url()) ||
      !postCreateRangeRequests.has(request)
    ) {
      return;
    }
    const roomRange = roomRangeMatches(response.url());
    if (!roomRange.expectedRange) return;

    observation.roomTargetRangeResponseCount = Math.min(
      observation.roomTargetRangeResponseCount + 1,
      2,
    );
    observation.roomTargetRangeLastStatus = response.status();
    expectedRoomRange ??= roomRange.range;

    pendingResponseReads.push(
      (async () => {
        let body: unknown;
        try {
          body = await response.json();
        } catch {
          return;
        }
        if (!isRecord(body) || !Array.isArray(body.events)) return;
        observation.roomListResponseHasEventsArray = true;
        observation.roomListResponseEventCount = Math.min(
          body.events.length,
          2,
        );
        observation.roomListDiagnostics = summarizeProjectionDiagnostics(
          body.diagnostics,
        );

        for (const resource of body.events) {
          if (!isRecord(resource) || !isRecord(resource.event)) continue;
          const event = resource.event;
          if (event.title !== expectedTitle) continue;

          observation.roomListResponseTitleMatches = true;
          const candidate = {
            ...(typeof event.id === 'string' ? { id: event.id } : {}),
            ...(typeof event.calendarId === 'string'
              ? { calendarId: event.calendarId }
              : {}),
          };
          matchingEventListRow ??= candidate;
          observation.roomListResponseCalendarMatches =
            event.calendarId === expectedCalendarId;
          observation.roomListResponseIdMatches = Boolean(
            createdEventId && event.id === createdEventId,
          );
          break;
        }
      })(),
    );
  };

  page.on('request', onRequest);
  page.on('response', onResponse);

  return {
    async observeCreatedEvent(response: Response) {
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        return;
      }
      if (!isRecord(body) || !isRecord(body.event)) return;

      const event = body.event;
      if (
        typeof event.id !== 'string' ||
        typeof event.title !== 'string' ||
        typeof event.calendarId !== 'string'
      ) {
        return;
      }

      createdEventId = event.id;
      createdEventUid =
        typeof event.uid === 'string' && event.uid.length > 0
          ? event.uid
          : undefined;
      createdEventTiming = readCreatedEventTiming(event.timing);
      observation.createResponseHasEvent = true;
      observation.createResponseTitleMatches = event.title === expectedTitle;
      observation.createResponseCalendarMatches =
        event.calendarId === expectedCalendarId;
      if (matchingEventListRow) {
        observation.roomListResponseIdMatches =
          matchingEventListRow.id === createdEventId;
        observation.roomListResponseCalendarMatches =
          matchingEventListRow.calendarId === expectedCalendarId;
      }
    },
    async collect(frame: FrameLocator, eventRow: Locator) {
      await Promise.allSettled(pendingResponseReads);
      if (createdEventTiming && expectedRoomRange) {
        const timingMatch = await compareEventTimingWithRoomRange(
          page,
          createdEventTiming,
          expectedRoomRange,
        );
        observation.createResponseTimingComparable = timingMatch.comparable;
        observation.createResponseEventIntersectsRoomRange =
          timingMatch.intersects;
      }
      if (createdEventUid && expectedRoomRange) {
        const caldavProbe = runCalDavReportProbe({
          calendarId: expectedCalendarId,
          eventUid: createdEventUid,
          range: expectedRoomRange,
        });
        if (caldavProbe) {
          observation.caldavReportProbeCompleted = caldavProbe.completed;
          observation.caldavOpenIdHttpStatus = caldavProbe.openIdStatus;
          observation.caldavReportHttpStatus = caldavProbe.reportStatus;
          observation.caldavReportContainsCreatedEvent =
            caldavProbe.containsCreatedEvent;
          observation.caldavProjection = caldavProbe.projection;
        }
      }
      const [headingCount, itemCount] = await Promise.all([
        frame
          .getByRole('heading', { name: 'Calendar events', exact: true })
          .count()
          .catch(() => 0),
        eventRow.count().catch(() => 0),
      ]);
      observation.listViewHeadingPresent = headingCount > 0;
      observation.matchingListItemCount = Math.min(itemCount, 2);
      page.off('request', onRequest);
      page.off('response', onResponse);
      return observation;
    },
  };
}

type ExpectedRoomRange = {
  start: string;
  end: string;
  timezone: string;
};

type ZonedEventTiming = {
  type: 'timed';
  start: { type: 'zoned'; local: string; timezone: string };
  end: { type: 'zoned'; local: string; timezone: string };
};

type CreatedEventTiming = ZonedEventTiming;

type CalDavReportProbeResult = {
  completed: boolean;
  openIdStatus: number | null;
  reportStatus: number | null;
  containsCreatedEvent: boolean | null;
  projection: CalDavProjectionObservation;
};

function runCalDavReportProbe({
  calendarId,
  eventUid,
  range,
}: {
  calendarId: string;
  eventUid: string;
  range: ExpectedRoomRange;
}): CalDavReportProbeResult | undefined {
  const result = spawnSync(
    process.execPath,
    [
      resolve(
        process.cwd(),
        '../dev/element-acceptance-caldav-report-probe.mjs',
      ),
    ],
    {
      input: JSON.stringify({ calendarId, eventUid, range }),
      encoding: 'utf8',
      env: {
        MATRIX_APPLICATION_SERVICE_TOKEN:
          process.env.MATRIX_APPLICATION_SERVICE_TOKEN ?? '',
      },
      stdio: ['pipe', 'pipe', 'ignore'],
      timeout: 20_000,
      maxBuffer: 4096,
    },
  );
  if (result.error || result.status !== 0 || !result.stdout) return undefined;

  let value: unknown;
  try {
    value = JSON.parse(result.stdout);
  } catch {
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  const expectedKeys = [
    'completed',
    'openIdStatus',
    'reportStatus',
    'containsCreatedEvent',
    'projection',
  ];
  if (
    Object.keys(value).length !== expectedKeys.length ||
    expectedKeys.some((key) => !Object.hasOwn(value, key)) ||
    typeof value.completed !== 'boolean' ||
    (value.containsCreatedEvent !== null &&
      typeof value.containsCreatedEvent !== 'boolean') ||
    value.completed !== (value.containsCreatedEvent !== null) ||
    !isOptionalHttpStatus(value.openIdStatus) ||
    !isOptionalHttpStatus(value.reportStatus) ||
    !isCalDavProjectionObservation(value.projection) ||
    value.completed !== value.projection.completed ||
    (value.containsCreatedEvent && !value.completed)
  ) {
    return undefined;
  }
  return {
    completed: value.completed,
    openIdStatus: value.openIdStatus,
    reportStatus: value.reportStatus,
    containsCreatedEvent: value.containsCreatedEvent,
    projection: value.projection,
  };
}

function isProjectionDiagnosticCounts(
  value: unknown,
): value is ProjectionDiagnosticCounts {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return (
    keys.length === PROJECTION_DIAGNOSTIC_REASONS.length &&
    PROJECTION_DIAGNOSTIC_REASONS.every(
      (reason) =>
        Object.hasOwn(value, reason) &&
        Number.isInteger(value[reason]) &&
        Number(value[reason]) >= 0 &&
        Number(value[reason]) <= 2,
    )
  );
}

function isCalDavProjectionObservation(
  value: unknown,
): value is CalDavProjectionObservation {
  if (!isRecord(value)) return false;
  const expectedKeys = [
    'completed',
    'includesCreatedEvent',
    'diagnosticCode',
    'diagnosticCounts',
    'timezoneAudit',
  ];
  return (
    Object.keys(value).length === expectedKeys.length &&
    expectedKeys.every((key) => Object.hasOwn(value, key)) &&
    typeof value.completed === 'boolean' &&
    (value.includesCreatedEvent === null ||
      typeof value.includesCreatedEvent === 'boolean') &&
    (value.diagnosticCode === 'none' ||
      value.diagnosticCode === 'inconclusive' ||
      PROJECTION_DIAGNOSTIC_REASONS.includes(
        value.diagnosticCode as ProjectionDiagnosticReason,
      )) &&
    isProjectionDiagnosticCounts(value.diagnosticCounts) &&
    isTimezoneSafetyObservation(value.timezoneAudit) &&
    value.completed === (value.includesCreatedEvent !== null) &&
    (value.completed || value.diagnosticCode === 'inconclusive')
  );
}

function isTimezoneSafetyObservation(
  value: unknown,
): value is TimezoneSafetyObservation {
  if (!isRecord(value)) return false;
  const expectedKeys = [
    'completed',
    'parsedEventUnsupportedTimezone',
    'bundledZoneId',
    'embeddedDefinitionCount',
    'canonicalEmbeddedDefinitionMatches',
    'classification',
  ];
  return (
    Object.keys(value).length === expectedKeys.length &&
    expectedKeys.every((key) => Object.hasOwn(value, key)) &&
    typeof value.completed === 'boolean' &&
    (value.parsedEventUnsupportedTimezone === null ||
      typeof value.parsedEventUnsupportedTimezone === 'boolean') &&
    (value.bundledZoneId === null ||
      typeof value.bundledZoneId === 'boolean') &&
    typeof value.embeddedDefinitionCount === 'number' &&
    Number.isInteger(value.embeddedDefinitionCount) &&
    value.embeddedDefinitionCount >= 0 &&
    value.embeddedDefinitionCount <= 2 &&
    (value.canonicalEmbeddedDefinitionMatches === null ||
      typeof value.canonicalEmbeddedDefinitionMatches === 'boolean') &&
    (value.classification === 'unsupported-zone-id' ||
      value.classification === 'no-embedded-definition' ||
      value.classification === 'duplicate-definitions' ||
      value.classification === 'embedded-definition-mismatch' ||
      value.classification === 'embedded-definition-matches' ||
      value.classification === 'other-unsupported-timezone' ||
      value.classification === 'no-zoned-start' ||
      value.classification === 'inconclusive') &&
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

function isOptionalHttpStatus(value: unknown): value is number | null {
  return (
    value === null ||
    (Number.isInteger(value) && Number(value) >= 100 && Number(value) <= 599)
  );
}

function readCreatedEventTiming(
  value: unknown,
): CreatedEventTiming | undefined {
  if (!isRecord(value) || value.type !== 'timed') return undefined;
  const readEndpoint = (endpoint: unknown) => {
    if (
      !isRecord(endpoint) ||
      endpoint.type !== 'zoned' ||
      typeof endpoint.local !== 'string' ||
      typeof endpoint.timezone !== 'string' ||
      endpoint.timezone.length === 0
    ) {
      return undefined;
    }
    return {
      type: 'zoned' as const,
      local: endpoint.local,
      timezone: endpoint.timezone,
    };
  };
  const start = readEndpoint(value.start);
  const end = readEndpoint(value.end);
  return start && end ? { type: 'timed', start, end } : undefined;
}

async function compareEventTimingWithRoomRange(
  page: Page,
  timing: CreatedEventTiming,
  range: ExpectedRoomRange,
): Promise<{ comparable: boolean; intersects: boolean }> {
  return page.evaluate(
    ({ timing, range }) => {
      const rangeStart = Date.parse(range.start);
      const rangeEnd = Date.parse(range.end);
      const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (
        !Number.isFinite(rangeStart) ||
        !Number.isFinite(rangeEnd) ||
        rangeEnd <= rangeStart ||
        timing.start.timezone !== browserTimezone ||
        timing.end.timezone !== browserTimezone
      ) {
        return { comparable: false, intersects: false };
      }

      const toInstant = (local: string, timezone: string) => {
        const match =
          /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/u.exec(
            local,
          );
        if (!match || timezone !== browserTimezone) return undefined;
        const [, year, month, day, hour, minute, second, fraction] = match;
        const instant = Date.parse(local);
        if (!Number.isFinite(instant)) return undefined;
        const parts = Object.fromEntries(
          new Intl.DateTimeFormat('en-CA-u-ca-iso8601', {
            timeZone: timezone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hourCycle: 'h23',
          })
            .formatToParts(new Date(instant))
            .filter((part) => part.type !== 'literal')
            .map((part) => [part.type, Number(part.value)]),
        );
        const milliseconds = Number((fraction ?? '').padEnd(3, '0') || '0');
        if (
          parts.year !== Number(year) ||
          parts.month !== Number(month) ||
          parts.day !== Number(day) ||
          parts.hour !== Number(hour) ||
          parts.minute !== Number(minute) ||
          parts.second !== Number(second ?? '0') ||
          new Date(instant).getUTCMilliseconds() !== milliseconds
        ) {
          return undefined;
        }
        return instant;
      };

      const start = toInstant(timing.start.local, timing.start.timezone);
      const end = toInstant(timing.end.local, timing.end.timezone);
      if (start === undefined || end === undefined || end <= start) {
        return { comparable: false, intersects: false };
      }
      return {
        comparable: true,
        intersects: start < rangeEnd && end > rangeStart,
      };
    },
    { timing, range },
  );
}

function isCalendarEventsEndpoint(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return (
      url.origin === new URL(fixture.gatewayUrl).origin &&
      url.pathname === '/v1/calendar/events'
    );
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function appendPostCreateVisibilityObservation(
  observation: PostCreateVisibilityObservation,
) {
  const stageFile = process.env.ELEMENT_ACCEPTANCE_STAGE_FILE;
  if (!stageFile) throw new Error('Element acceptance fixture unavailable');
  appendFileSync(
    stageFile,
    `${JSON.stringify({
      phase: 'event-create-post-refresh-observed',
      status: 'passed',
      ...observation,
    })}\n`,
    { encoding: 'utf8', mode: 0o600 },
  );
}

async function observeAcceptanceRuntime(
  page: Page,
  {
    gatewayUrl,
    homeserverUrl,
    widgetUrl,
  }: {
    gatewayUrl: string;
    homeserverUrl: string;
    widgetUrl: string;
  },
): Promise<AcceptanceRuntimeObservation> {
  const gatewayOrigin = new URL(gatewayUrl).origin;
  const homeserverOrigin = new URL(homeserverUrl).origin;
  const widgetOrigin = new URL(widgetUrl).origin;
  const observerArgs = {
    expectedElementOrigin: new URL(fixture.elementUrl).origin,
    expectedWidgetOrigin: widgetOrigin,
    expectedGatewayOrigin: gatewayOrigin,
    expectedRoomId: fixture.teamRoomId,
  };
  const installAcceptanceObserver = ({
    expectedElementOrigin,
    expectedWidgetOrigin,
    expectedGatewayOrigin,
    expectedRoomId,
  }: typeof observerArgs) => {
    type WidgetApiState = 'none' | 'allowed' | 'request' | 'blocked' | 'other';
    type WidgetParameters = Record<string, string | undefined>;
    type WidgetApiMessage = {
      api?: unknown;
      action?: unknown;
      widgetId?: unknown;
      requestId?: unknown;
      response?: unknown;
      data?: unknown;
    };
    type RequestObservation = {
      count: number;
      sourceMatches: boolean;
      originMatches: boolean;
      widgetIdMatches: boolean;
    };
    type ChildObservation = {
      parametersObserved: boolean;
      gatewayBaseOriginMatches: boolean;
      roomIdMatches: boolean;
      widgetIdParameterPresent: boolean;
      initialResponseCount: number;
      initialResponseState: WidgetApiState;
      initialResponseSourceMatches: boolean;
      initialResponseOriginMatches: boolean;
      initialResponseWidgetIdMatches: boolean;
      followupCount: number;
      followupState: WidgetApiState;
      followupRequestIdMatches: boolean;
      followupSourceMatches: boolean;
      followupOriginMatches: boolean;
      followupWidgetIdMatches: boolean;
    };
    const readParameters = (search: string, hash: string): WidgetParameters => {
      const parse = (query: string): WidgetParameters => {
        const params = new URLSearchParams(query);
        const keys = new Set<string>();
        params.forEach((_value, key) => keys.add(key));
        const parsed: WidgetParameters = Object.create(
          null,
        ) as WidgetParameters;
        for (const key of keys) {
          const values = params.getAll(key);
          parsed[key] = values.length === 1 ? values[0] : undefined;
        }
        return parsed;
      };
      const hashQuery = hash.substring(hash.indexOf('?') + 1);
      return { ...parse(search), ...parse(hashQuery) };
    };
    const stateOf = (value: unknown): WidgetApiState =>
      value === 'allowed' || value === 'request' || value === 'blocked'
        ? value
        : 'other';
    const messageOf = (event: MessageEvent): WidgetApiMessage | undefined => {
      if (
        event.data === null ||
        typeof event.data !== 'object' ||
        Array.isArray(event.data)
      ) {
        return undefined;
      }
      return event.data as WidgetApiMessage;
    };
    const updateMatches = (
      observation: RequestObservation,
      matches: {
        source: boolean;
        origin: boolean;
        widgetId: boolean;
      },
    ) => {
      const first = observation.count === 0;
      observation.count = Math.min(observation.count + 1, 2);
      observation.sourceMatches = first
        ? matches.source
        : observation.sourceMatches && matches.source;
      observation.originMatches = first
        ? matches.origin
        : observation.originMatches && matches.origin;
      observation.widgetIdMatches = first
        ? matches.widgetId
        : observation.widgetIdMatches && matches.widgetId;
    };
    const runtimeWindow = window as Window & {
      __matrixCalendarAcceptanceErrors?: {
        count: number;
        lastClass: WidgetPageErrorClass;
      };
      __matrixCalendarAcceptanceWidgetApiParent?: RequestObservation;
      __matrixCalendarAcceptanceWidgetApiChild?: ChildObservation;
    };

    if (window.location.origin === expectedElementOrigin) {
      const requestObservation: RequestObservation = {
        count: 0,
        sourceMatches: false,
        originMatches: false,
        widgetIdMatches: false,
      };
      runtimeWindow.__matrixCalendarAcceptanceWidgetApiParent =
        requestObservation;
      window.addEventListener('message', (event) => {
        const message = messageOf(event);
        if (
          message?.api !== 'fromWidget' ||
          message.action !== 'get_openid' ||
          Object.hasOwn(message, 'response')
        ) {
          return;
        }

        let sourceMatches = false;
        let expectedWidgetId: string | undefined;
        for (const iframe of Array.from(document.querySelectorAll('iframe'))) {
          if (iframe.contentWindow !== event.source) continue;
          try {
            const frameUrl = new URL(
              iframe.getAttribute('src') ?? '',
              document.baseURI,
            );
            const parameters = readParameters(frameUrl.search, frameUrl.hash);
            sourceMatches = frameUrl.origin === expectedWidgetOrigin;
            expectedWidgetId = parameters.widgetId;
          } catch {
            sourceMatches = false;
          }
          break;
        }
        updateMatches(requestObservation, {
          source: sourceMatches,
          origin: event.origin === expectedWidgetOrigin,
          widgetId:
            typeof expectedWidgetId === 'string' &&
            message.widgetId === expectedWidgetId,
        });
      });
    }

    if (window.location.origin === expectedWidgetOrigin) {
      const { expectedWidgetId, childObservation } = (() => {
        const parsedParameters = readParameters(
          window.location.search,
          window.location.hash,
        );
        let gatewayBaseOriginMatches = false;
        if (typeof parsedParameters.meetings_bot_base_url === 'string') {
          try {
            gatewayBaseOriginMatches =
              new URL(parsedParameters.meetings_bot_base_url).origin ===
              expectedGatewayOrigin;
          } catch {
            gatewayBaseOriginMatches = false;
          }
        }
        const expectedWidgetId =
          typeof parsedParameters.widgetId === 'string'
            ? parsedParameters.widgetId
            : undefined;
        const childObservation: ChildObservation = {
          parametersObserved: true,
          gatewayBaseOriginMatches,
          roomIdMatches: parsedParameters.matrix_room_id === expectedRoomId,
          widgetIdParameterPresent:
            typeof expectedWidgetId === 'string' && expectedWidgetId.length > 0,
          initialResponseCount: 0,
          initialResponseState: 'none',
          initialResponseSourceMatches: false,
          initialResponseOriginMatches: false,
          initialResponseWidgetIdMatches: false,
          followupCount: 0,
          followupState: 'none',
          followupRequestIdMatches: false,
          followupSourceMatches: false,
          followupOriginMatches: false,
          followupWidgetIdMatches: false,
        };
        return { expectedWidgetId, childObservation };
      })();
      let initialRequestId: string | undefined;
      runtimeWindow.__matrixCalendarAcceptanceWidgetApiChild = childObservation;
      window.addEventListener('message', (event) => {
        const message = messageOf(event);
        if (!message) return;
        const commonMatches = {
          source: event.source === window.parent,
          origin: event.origin === expectedElementOrigin,
          widgetId:
            typeof expectedWidgetId === 'string' &&
            message.widgetId === expectedWidgetId,
        };

        if (
          message.api === 'fromWidget' &&
          message.action === 'get_openid' &&
          Object.hasOwn(message, 'response') &&
          message.response !== null &&
          typeof message.response === 'object' &&
          !Array.isArray(message.response)
        ) {
          const first = childObservation.initialResponseCount === 0;
          childObservation.initialResponseCount = Math.min(
            childObservation.initialResponseCount + 1,
            2,
          );
          const response = message.response as { state?: unknown };
          childObservation.initialResponseState = stateOf(response.state);
          childObservation.initialResponseSourceMatches = first
            ? commonMatches.source
            : childObservation.initialResponseSourceMatches &&
              commonMatches.source;
          childObservation.initialResponseOriginMatches = first
            ? commonMatches.origin
            : childObservation.initialResponseOriginMatches &&
              commonMatches.origin;
          childObservation.initialResponseWidgetIdMatches = first
            ? commonMatches.widgetId
            : childObservation.initialResponseWidgetIdMatches &&
              commonMatches.widgetId;
          initialRequestId =
            commonMatches.source &&
            commonMatches.origin &&
            commonMatches.widgetId &&
            typeof message.requestId === 'string'
              ? message.requestId
              : undefined;
          return;
        }

        if (
          message.api !== 'toWidget' ||
          message.action !== 'openid_credentials' ||
          Object.hasOwn(message, 'response') ||
          message.data === null ||
          typeof message.data !== 'object' ||
          Array.isArray(message.data)
        ) {
          return;
        }
        const first = childObservation.followupCount === 0;
        childObservation.followupCount = Math.min(
          childObservation.followupCount + 1,
          2,
        );
        const data = message.data as {
          state?: unknown;
          original_request_id?: unknown;
        };
        childObservation.followupState = stateOf(data.state);
        const requestIdMatches =
          typeof initialRequestId === 'string' &&
          typeof data.original_request_id === 'string' &&
          data.original_request_id === initialRequestId;
        childObservation.followupRequestIdMatches = first
          ? requestIdMatches
          : childObservation.followupRequestIdMatches && requestIdMatches;
        childObservation.followupSourceMatches = first
          ? commonMatches.source
          : childObservation.followupSourceMatches && commonMatches.source;
        childObservation.followupOriginMatches = first
          ? commonMatches.origin
          : childObservation.followupOriginMatches && commonMatches.origin;
        childObservation.followupWidgetIdMatches = first
          ? commonMatches.widgetId
          : childObservation.followupWidgetIdMatches && commonMatches.widgetId;
      });

      const knownErrorClasses = [
        'Error',
        'TypeError',
        'ReferenceError',
        'SyntaxError',
        'RangeError',
        'URIError',
        'EvalError',
        'AggregateError',
      ];
      const errorState = {
        count: 0,
        lastClass: 'NONE' as WidgetPageErrorClass,
      };
      runtimeWindow.__matrixCalendarAcceptanceErrors = errorState;
      const recordPageError = (reason: unknown) => {
        errorState.count = Math.min(errorState.count + 1, 2);
        const name = reason instanceof Error ? reason.name : 'OTHER';
        errorState.lastClass = knownErrorClasses.includes(name)
          ? (name as WidgetPageErrorClass)
          : 'OTHER';
      };
      window.addEventListener('error', (event) => {
        if (event instanceof ErrorEvent) recordPageError(event.error);
      });
      window.addEventListener('unhandledrejection', (event) => {
        recordPageError(event.reason);
      });
    }
  };
  await page.context().addInitScript(installAcceptanceObserver, observerArgs);
  await page.evaluate(installAcceptanceObserver, observerArgs);

  const observation: AcceptanceRuntimeObservation = {
    requestCounts: {
      context: 0,
      calendars: 0,
      events: 0,
      'other-calendar': 0,
      'other-api': 0,
    },
    optionsRequestCount: 0,
    failedRequestCount: 0,
    lastRequestEndpoint: 'none',
    lastRequestMethod: 'NONE',
    lastResponseEndpoint: 'none',
    lastResponseMethod: 'NONE',
    iframeObservationAvailable: false,
    iframeGatewayBaseOriginMatches: false,
    iframeRoomIdMatches: false,
    createEventVisible: false,
    identityContinueVisible: false,
    widgetResourceRequestCounts: {
      document: 0,
      script: 0,
      stylesheet: 0,
    },
    widgetResourceFailureCounts: {
      document: 0,
      script: 0,
      stylesheet: 0,
    },
    widgetResourceLastStatuses: {},
    openIdRequestCount: 0,
    openIdOptionsRequestCount: 0,
    openIdFailedRequestCount: 0,
    openIdLastRequestMethod: 'NONE',
    widgetFrameAvailable: false,
    widgetDocumentReadyState: 'unavailable',
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
  };

  page.on('request', (request) => {
    const requestDetails = classifyGatewayRequest(
      request.url(),
      request.method(),
      gatewayOrigin,
    );
    if (requestDetails) {
      observation.requestCounts[requestDetails.endpoint] = Math.min(
        observation.requestCounts[requestDetails.endpoint] + 1,
        2,
      );
      observation.lastRequestEndpoint = requestDetails.endpoint;
      observation.lastRequestMethod = requestDetails.method;
      if (requestDetails.method === 'OPTIONS') {
        observation.optionsRequestCount = Math.min(
          observation.optionsRequestCount + 1,
          2,
        );
      }
    }

    const widgetResource = classifyWidgetResource(
      request.url(),
      request.resourceType(),
      widgetOrigin,
    );
    if (widgetResource) {
      observation.widgetResourceRequestCounts[widgetResource] = Math.min(
        observation.widgetResourceRequestCounts[widgetResource] + 1,
        2,
      );
    }

    if (isOpenIdRequest(request.url(), homeserverOrigin)) {
      observation.openIdRequestCount = Math.min(
        observation.openIdRequestCount + 1,
        2,
      );
      observation.openIdLastRequestMethod = classifyGatewayMethod(
        request.method(),
      );
      if (observation.openIdLastRequestMethod === 'OPTIONS') {
        observation.openIdOptionsRequestCount = Math.min(
          observation.openIdOptionsRequestCount + 1,
          2,
        );
      }
    }
  });

  page.on('requestfailed', (request) => {
    const requestDetails = classifyGatewayRequest(
      request.url(),
      request.method(),
      gatewayOrigin,
    );
    if (requestDetails) {
      observation.failedRequestCount = Math.min(
        observation.failedRequestCount + 1,
        2,
      );
    }

    const widgetResource = classifyWidgetResource(
      request.url(),
      request.resourceType(),
      widgetOrigin,
    );
    if (widgetResource) {
      observation.widgetResourceFailureCounts[widgetResource] = Math.min(
        observation.widgetResourceFailureCounts[widgetResource] + 1,
        2,
      );
    }

    if (isOpenIdRequest(request.url(), homeserverOrigin)) {
      observation.openIdFailedRequestCount = Math.min(
        observation.openIdFailedRequestCount + 1,
        2,
      );
    }
  });

  page.on('response', (response) => {
    const responseDetails = classifyGatewayRequest(
      response.url(),
      response.request().method(),
      gatewayOrigin,
    );
    if (responseDetails) {
      observation.lastResponseEndpoint = responseDetails.endpoint;
      observation.lastResponseMethod = responseDetails.method;
      observation.lastResponseStatus = response.status();
    }

    const widgetResource = classifyWidgetResource(
      response.url(),
      response.request().resourceType(),
      widgetOrigin,
    );
    if (widgetResource) {
      observation.widgetResourceLastStatuses[widgetResource] =
        response.status();
      if (response.status() >= 400) {
        observation.widgetResourceFailureCounts[widgetResource] = Math.min(
          observation.widgetResourceFailureCounts[widgetResource] + 1,
          2,
        );
      }
    }

    if (isOpenIdRequest(response.url(), homeserverOrigin)) {
      observation.openIdLastResponseStatus = response.status();
    }
  });

  return observation;
}

function classifyGatewayRequest(
  rawUrl: string,
  rawMethod: string,
  gatewayOrigin: string,
):
  | {
      endpoint: GatewayEndpointKind;
      method: GatewayRequestMethod;
    }
  | undefined {
  try {
    const url = new URL(rawUrl);
    if (url.origin !== gatewayOrigin) return undefined;

    let endpoint: GatewayEndpointKind;
    if (url.pathname === '/v1/calendar/context') {
      endpoint = 'context';
    } else if (url.pathname === '/v1/calendar/calendars') {
      endpoint = 'calendars';
    } else if (url.pathname === '/v1/calendar/events') {
      endpoint = 'events';
    } else if (url.pathname.startsWith('/v1/calendar/')) {
      endpoint = 'other-calendar';
    } else {
      endpoint = 'other-api';
    }

    const method = classifyGatewayMethod(rawMethod);
    return { endpoint, method };
  } catch {
    return undefined;
  }
}

function classifyGatewayMethod(rawMethod: string): GatewayRequestMethod {
  const methods: GatewayRequestMethod[] = [
    'GET',
    'POST',
    'PATCH',
    'PUT',
    'DELETE',
    'OPTIONS',
    'HEAD',
  ];
  return methods.includes(rawMethod as GatewayRequestMethod)
    ? (rawMethod as GatewayRequestMethod)
    : 'OTHER';
}

function classifyWidgetResource(
  rawUrl: string,
  resourceType: string,
  widgetOrigin: string,
): WidgetResourceKind | undefined {
  try {
    if (new URL(rawUrl).origin !== widgetOrigin) return undefined;
    return resourceType === 'document' ||
      resourceType === 'script' ||
      resourceType === 'stylesheet'
      ? resourceType
      : undefined;
  } catch {
    return undefined;
  }
}

function isOpenIdRequest(rawUrl: string, homeserverOrigin: string): boolean {
  try {
    const url = new URL(rawUrl);
    return (
      url.origin === homeserverOrigin &&
      url.pathname.endsWith('/openid/request_token')
    );
  } catch {
    return false;
  }
}

async function recordWidgetRuntimeObservation(
  page: Page,
  frame: ReturnType<ElementWebPage['widgetByTitle']>,
  observation: AcceptanceRuntimeObservation | undefined,
) {
  if (!observation) return;

  try {
    const iframeParameters = await page
      .locator('iframe[title="Matrix Calendar"]')
      .evaluate(
        (iframe, { expectedGatewayOrigin, expectedRoomId }) => {
          const source = iframe.getAttribute('src') ?? '';
          const widgetUrl = new URL(source, window.location.href);
          const parse = (query: string) => {
            const params = new URLSearchParams(query);
            const keys = new Set<string>();
            params.forEach((_value, key) => keys.add(key));
            const parsed: Record<string, string | undefined> = Object.create(
              null,
            ) as Record<string, string | undefined>;
            for (const key of keys) {
              const values = params.getAll(key);
              parsed[key] = values.length === 1 ? values[0] : undefined;
            }
            return parsed;
          };
          const hashQuery = widgetUrl.hash.substring(
            widgetUrl.hash.indexOf('?') + 1,
          );
          const parameters = {
            ...parse(widgetUrl.search),
            ...parse(hashQuery),
          };
          let gatewayOriginMatches = false;
          if (typeof parameters.meetings_bot_base_url === 'string') {
            try {
              gatewayOriginMatches =
                new URL(parameters.meetings_bot_base_url).origin ===
                expectedGatewayOrigin;
            } catch {
              gatewayOriginMatches = false;
            }
          }
          return {
            gatewayOriginMatches,
            roomIdMatches: parameters.matrix_room_id === expectedRoomId,
          };
        },
        {
          expectedGatewayOrigin: new URL(fixture.gatewayUrl).origin,
          expectedRoomId: fixture.teamRoomId,
        },
      );
    observation.iframeObservationAvailable = true;
    observation.iframeGatewayBaseOriginMatches =
      iframeParameters.gatewayOriginMatches;
    observation.iframeRoomIdMatches = iframeParameters.roomIdMatches;
  } catch {
    // The raw iframe URL and any navigation error stay out of the evidence.
  }

  const widgetOrigin = new URL(fixture.widgetUrl).origin;
  const widgetFrame = page.frames().find((candidate) => {
    if (candidate === page.mainFrame()) return false;
    try {
      return new URL(candidate.url()).origin === widgetOrigin;
    } catch {
      return false;
    }
  });
  if (widgetFrame) {
    try {
      const documentObservation = await widgetFrame.evaluate(() => {
        const runtimeWindow = window as Window & {
          __matrixCalendarAcceptanceErrors?: {
            count: number;
            lastClass: WidgetPageErrorClass;
          };
          __matrixCalendarAcceptanceWidgetApiChild?: {
            parametersObserved: boolean;
            gatewayBaseOriginMatches: boolean;
            roomIdMatches: boolean;
            widgetIdParameterPresent: boolean;
            initialResponseCount: number;
            initialResponseState: OpenIdProtocolState;
            initialResponseSourceMatches: boolean;
            initialResponseOriginMatches: boolean;
            initialResponseWidgetIdMatches: boolean;
            followupCount: number;
            followupState: OpenIdProtocolState;
            followupRequestIdMatches: boolean;
            followupSourceMatches: boolean;
            followupOriginMatches: boolean;
            followupWidgetIdMatches: boolean;
          };
        };
        const errors = runtimeWindow.__matrixCalendarAcceptanceErrors;
        const widgetApi =
          runtimeWindow.__matrixCalendarAcceptanceWidgetApiChild;
        const readyState = document.readyState;
        const visible = (element: Element | null) => {
          if (!element) return false;
          const style = window.getComputedStyle(element);
          return (
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            element.getClientRects().length > 0
          );
        };
        const alertMarkerVisible = (marker: string) =>
          Array.from(document.querySelectorAll('[role="alert"]')).some(
            (alert) => alert.textContent?.includes(marker) && visible(alert),
          );
        const createEventButton = Array.from(
          document.querySelectorAll('button'),
        ).find((button) => button.textContent?.trim() === 'Create event');
        const calendarToolbarPresent = Boolean(createEventButton);
        const calendarEventsLoadingVisible =
          calendarToolbarPresent &&
          Array.from(document.querySelectorAll('[role="progressbar"]')).some(
            (progress) => visible(progress),
          );
        const widgetDocumentReadyState: WidgetDocumentReadyState =
          readyState === 'loading' ||
          readyState === 'interactive' ||
          readyState === 'complete'
            ? readyState
            : 'unavailable';
        return {
          documentReadyState: widgetDocumentReadyState,
          rootHasChildren:
            (document.getElementById('root')?.childElementCount ?? 0) > 0,
          loadingVisible: visible(
            document.querySelector('[role="progressbar"]'),
          ),
          missingCapabilitiesVisible: alertMarkerVisible(
            'Missing capabilities',
          ),
          registrationErrorVisible: alertMarkerVisible(
            'Wrong widget registration',
          ),
          outsideClientVisible: alertMarkerVisible('Only runs as a widget'),
          childErrorVisible: alertMarkerVisible(
            'An error occured inside the widget.',
          ),
          calendarEventsLoadingVisible,
          calendarEventsLoadErrorVisible: alertMarkerVisible(
            'Calendar events could not be loaded.',
          ),
          createEventEnabled: Boolean(
            createEventButton &&
            !createEventButton.hasAttribute('disabled') &&
            createEventButton.getAttribute('aria-disabled') !== 'true',
          ),
          pageErrorCount: Math.min(errors?.count ?? 0, 2),
          lastPageErrorClass: errors?.lastClass ?? 'NONE',
          widgetApi: widgetApi
            ? {
                parametersObserved: widgetApi.parametersObserved,
                gatewayBaseOriginMatches: widgetApi.gatewayBaseOriginMatches,
                roomIdMatches: widgetApi.roomIdMatches,
                widgetIdParameterPresent: widgetApi.widgetIdParameterPresent,
                initialResponseCount: widgetApi.initialResponseCount,
                initialResponseState: widgetApi.initialResponseState,
                initialResponseSourceMatches:
                  widgetApi.initialResponseSourceMatches,
                initialResponseOriginMatches:
                  widgetApi.initialResponseOriginMatches,
                initialResponseWidgetIdMatches:
                  widgetApi.initialResponseWidgetIdMatches,
                followupCount: widgetApi.followupCount,
                followupState: widgetApi.followupState,
                followupRequestIdMatches: widgetApi.followupRequestIdMatches,
                followupSourceMatches: widgetApi.followupSourceMatches,
                followupOriginMatches: widgetApi.followupOriginMatches,
                followupWidgetIdMatches: widgetApi.followupWidgetIdMatches,
              }
            : undefined,
        };
      });
      observation.widgetFrameAvailable = true;
      observation.widgetDocumentReadyState =
        documentObservation.documentReadyState;
      observation.widgetRootHasChildren = documentObservation.rootHasChildren;
      observation.widgetLoadingVisible = documentObservation.loadingVisible;
      observation.widgetMissingCapabilitiesVisible =
        documentObservation.missingCapabilitiesVisible;
      observation.widgetRegistrationErrorVisible =
        documentObservation.registrationErrorVisible;
      observation.widgetOutsideClientVisible =
        documentObservation.outsideClientVisible;
      observation.widgetChildErrorVisible =
        documentObservation.childErrorVisible;
      observation.widgetPageErrorCount = documentObservation.pageErrorCount;
      observation.widgetLastPageErrorClass =
        documentObservation.lastPageErrorClass;
      observation.calendarEventsLoadingVisible =
        documentObservation.calendarEventsLoadingVisible;
      observation.calendarEventsLoadErrorVisible =
        documentObservation.calendarEventsLoadErrorVisible;
      observation.createEventEnabled = documentObservation.createEventEnabled;
      if (documentObservation.widgetApi) {
        observation.widgetParametersObserved =
          documentObservation.widgetApi.parametersObserved;
        observation.widgetGatewayBaseOriginMatches =
          documentObservation.widgetApi.gatewayBaseOriginMatches;
        observation.widgetRoomIdMatches =
          documentObservation.widgetApi.roomIdMatches;
        observation.widgetIdParameterPresent =
          documentObservation.widgetApi.widgetIdParameterPresent;
        observation.widgetApiInitialResponseCount =
          documentObservation.widgetApi.initialResponseCount;
        observation.widgetApiInitialResponseState =
          documentObservation.widgetApi.initialResponseState;
        observation.widgetApiInitialResponseSourceMatches =
          documentObservation.widgetApi.initialResponseSourceMatches;
        observation.widgetApiInitialResponseOriginMatches =
          documentObservation.widgetApi.initialResponseOriginMatches;
        observation.widgetApiInitialResponseWidgetIdMatches =
          documentObservation.widgetApi.initialResponseWidgetIdMatches;
        observation.widgetApiFollowupCount =
          documentObservation.widgetApi.followupCount;
        observation.widgetApiFollowupState =
          documentObservation.widgetApi.followupState;
        observation.widgetApiFollowupRequestIdMatches =
          documentObservation.widgetApi.followupRequestIdMatches;
        observation.widgetApiFollowupSourceMatches =
          documentObservation.widgetApi.followupSourceMatches;
        observation.widgetApiFollowupOriginMatches =
          documentObservation.widgetApi.followupOriginMatches;
        observation.widgetApiFollowupWidgetIdMatches =
          documentObservation.widgetApi.followupWidgetIdMatches;
      }
    } catch {
      // Keep a failed frame read as unavailable without retaining its error.
    }
  }

  try {
    const parentObservation = await page.evaluate(() => {
      const runtimeWindow = window as Window & {
        __matrixCalendarAcceptanceWidgetApiParent?: {
          count: number;
          sourceMatches: boolean;
          originMatches: boolean;
          widgetIdMatches: boolean;
        };
      };
      const request = runtimeWindow.__matrixCalendarAcceptanceWidgetApiParent;
      return request
        ? {
            available: true,
            count: request.count,
            sourceMatches: request.sourceMatches,
            originMatches: request.originMatches,
            widgetIdMatches: request.widgetIdMatches,
          }
        : undefined;
    });
    if (parentObservation) {
      observation.widgetApiParentObserverAvailable =
        parentObservation.available;
      observation.widgetApiGetOpenIdRequestCount = parentObservation.count;
      observation.widgetApiRequestSourceMatches =
        parentObservation.sourceMatches;
      observation.widgetApiRequestOriginMatches =
        parentObservation.originMatches;
      observation.widgetApiRequestWidgetIdMatches =
        parentObservation.widgetIdMatches;
    }
  } catch {
    // Keep a failed parent-window read as unavailable without retaining its error.
  }

  const [createEventVisible, createEventEnabled, identityContinueVisible] =
    await Promise.all([
      frame
        .getByRole('button', { name: 'Create event', exact: true })
        .isVisible()
        .catch(() => false),
      frame
        .getByRole('button', { name: 'Create event', exact: true })
        .isEnabled()
        .catch(() => false),
      page
        .getByRole('dialog')
        .getByRole('button', { name: 'Continue', exact: true })
        .first()
        .isVisible()
        .catch(() => false),
    ]);
  observation.createEventVisible = createEventVisible;
  observation.createEventEnabled = createEventEnabled;
  observation.identityContinueVisible = identityContinueVisible;

  appendRuntimeObservation(observation);
}

function appendRuntimeObservation(observation: AcceptanceRuntimeObservation) {
  const stageFile = process.env.ELEMENT_ACCEPTANCE_STAGE_FILE;
  if (!stageFile) throw new Error('Element acceptance fixture unavailable');
  appendFileSync(
    stageFile,
    `${JSON.stringify({
      phase: 'widget-a-runtime-observed',
      status: observation.iframeObservationAvailable ? 'passed' : 'unavailable',
      gatewayContextRequestCount: observation.requestCounts.context,
      gatewayCalendarsRequestCount: observation.requestCounts.calendars,
      gatewayEventsRequestCount: observation.requestCounts.events,
      gatewayOtherCalendarRequestCount:
        observation.requestCounts['other-calendar'],
      gatewayOtherApiRequestCount: observation.requestCounts['other-api'],
      gatewayOptionsRequestCount: observation.optionsRequestCount,
      gatewayFailedRequestCount: observation.failedRequestCount,
      gatewayLastRequestEndpoint: observation.lastRequestEndpoint,
      gatewayLastRequestMethod: observation.lastRequestMethod,
      gatewayLastResponseEndpoint: observation.lastResponseEndpoint,
      gatewayLastResponseMethod: observation.lastResponseMethod,
      widgetDocumentRequestCount:
        observation.widgetResourceRequestCounts.document,
      widgetScriptRequestCount: observation.widgetResourceRequestCounts.script,
      widgetStylesheetRequestCount:
        observation.widgetResourceRequestCounts.stylesheet,
      widgetDocumentFailureCount:
        observation.widgetResourceFailureCounts.document,
      widgetScriptFailureCount: observation.widgetResourceFailureCounts.script,
      widgetStylesheetFailureCount:
        observation.widgetResourceFailureCounts.stylesheet,
      openIdRequestCount: observation.openIdRequestCount,
      openIdOptionsRequestCount: observation.openIdOptionsRequestCount,
      openIdFailedRequestCount: observation.openIdFailedRequestCount,
      openIdLastRequestMethod: observation.openIdLastRequestMethod,
      widgetApiGetOpenIdRequestCount:
        observation.widgetApiGetOpenIdRequestCount,
      widgetApiParentObserverAvailable:
        observation.widgetApiParentObserverAvailable,
      widgetApiRequestSourceMatches: observation.widgetApiRequestSourceMatches,
      widgetApiRequestOriginMatches: observation.widgetApiRequestOriginMatches,
      widgetApiRequestWidgetIdMatches:
        observation.widgetApiRequestWidgetIdMatches,
      widgetApiInitialResponseCount: observation.widgetApiInitialResponseCount,
      widgetApiInitialResponseState: observation.widgetApiInitialResponseState,
      widgetApiInitialResponseSourceMatches:
        observation.widgetApiInitialResponseSourceMatches,
      widgetApiInitialResponseOriginMatches:
        observation.widgetApiInitialResponseOriginMatches,
      widgetApiInitialResponseWidgetIdMatches:
        observation.widgetApiInitialResponseWidgetIdMatches,
      widgetApiFollowupCount: observation.widgetApiFollowupCount,
      widgetApiFollowupState: observation.widgetApiFollowupState,
      widgetApiFollowupRequestIdMatches:
        observation.widgetApiFollowupRequestIdMatches,
      widgetApiFollowupSourceMatches:
        observation.widgetApiFollowupSourceMatches,
      widgetApiFollowupOriginMatches:
        observation.widgetApiFollowupOriginMatches,
      widgetApiFollowupWidgetIdMatches:
        observation.widgetApiFollowupWidgetIdMatches,
      widgetParametersObserved: observation.widgetParametersObserved,
      widgetGatewayBaseOriginMatches:
        observation.widgetGatewayBaseOriginMatches,
      widgetRoomIdMatches: observation.widgetRoomIdMatches,
      widgetIdParameterPresent: observation.widgetIdParameterPresent,
      ...(observation.lastResponseStatus === undefined
        ? {}
        : { gatewayLastResponseStatus: observation.lastResponseStatus }),
      ...(observation.widgetResourceLastStatuses.document === undefined
        ? {}
        : {
            widgetDocumentLastStatus:
              observation.widgetResourceLastStatuses.document,
          }),
      ...(observation.widgetResourceLastStatuses.script === undefined
        ? {}
        : {
            widgetScriptLastStatus:
              observation.widgetResourceLastStatuses.script,
          }),
      ...(observation.widgetResourceLastStatuses.stylesheet === undefined
        ? {}
        : {
            widgetStylesheetLastStatus:
              observation.widgetResourceLastStatuses.stylesheet,
          }),
      ...(observation.openIdLastResponseStatus === undefined
        ? {}
        : { openIdLastResponseStatus: observation.openIdLastResponseStatus }),
      iframeObservationAvailable: observation.iframeObservationAvailable,
      iframeGatewayBaseOriginMatches:
        observation.iframeGatewayBaseOriginMatches,
      iframeRoomIdMatches: observation.iframeRoomIdMatches,
      widgetFrameAvailable: observation.widgetFrameAvailable,
      widgetDocumentReadyState: observation.widgetDocumentReadyState,
      widgetRootHasChildren: observation.widgetRootHasChildren,
      widgetLoadingVisible: observation.widgetLoadingVisible,
      widgetMissingCapabilitiesVisible:
        observation.widgetMissingCapabilitiesVisible,
      widgetRegistrationErrorVisible:
        observation.widgetRegistrationErrorVisible,
      widgetOutsideClientVisible: observation.widgetOutsideClientVisible,
      widgetChildErrorVisible: observation.widgetChildErrorVisible,
      calendarEventsLoadingVisible: observation.calendarEventsLoadingVisible,
      calendarEventsLoadErrorVisible:
        observation.calendarEventsLoadErrorVisible,
      widgetPageErrorCount: observation.widgetPageErrorCount,
      widgetLastPageErrorClass: observation.widgetLastPageErrorClass,
      createEventVisible: observation.createEventVisible,
      createEventEnabled: observation.createEventEnabled,
      identityContinueVisible: observation.identityContinueVisible,
    })}\n`,
    { encoding: 'utf8', mode: 0o600 },
  );
}

function record(
  phase: Phase,
  status: 'started' | 'passed' | 'failed',
  httpStatus?: number,
  count?: number,
  extra?: {
    originMatchesElement?: boolean;
    controlVisible?: boolean;
    panelPresent?: boolean;
    teamRoomMatches?: boolean;
    blockedRequestDiagnostics?: BlockedRequestDiagnostic[];
    blockedRequestDiagnosticOverflow?: boolean;
    relativeAlarmReadback?: boolean;
    reminderEnabled?: boolean;
    canaryDelivered?: boolean;
    roomMentioned?: boolean;
    deliveredAfterDue?: boolean;
    allMarkersOnce?: boolean;
    canManageReminders?: boolean;
  } & Partial<ReminderConfigurationObservation> &
    Partial<Omit<G6StageRecord, 'phase' | 'status' | 'httpStatus' | 'count'>>,
) {
  const stageFile = process.env.ELEMENT_ACCEPTANCE_STAGE_FILE;
  if (!stageFile) throw new Error('Element acceptance fixture unavailable');
  appendFileSync(
    stageFile,
    `${JSON.stringify({
      phase,
      status,
      ...(httpStatus === undefined ? {} : { httpStatus }),
      ...(count === undefined ? {} : { count }),
      ...extra,
    })}\n`,
    { encoding: 'utf8', mode: 0o600 },
  );
}

function recordMemberASessionObservation(
  observation:
    | {
        matrixClientHookPresent: boolean;
        matrixClientPresent: boolean;
        matrixUserMatches: boolean;
        matrixSyncState: MatrixSyncState;
      }
    | undefined,
) {
  const stageFile = process.env.ELEMENT_ACCEPTANCE_STAGE_FILE;
  if (!stageFile) throw new Error('Element acceptance fixture unavailable');
  appendFileSync(
    stageFile,
    `${JSON.stringify({
      phase: 'member-a-session-observed',
      status: observation ? 'passed' : 'unavailable',
      ...(observation ?? {}),
    })}\n`,
    { encoding: 'utf8', mode: 0o600 },
  );
}

function recordMemberARoomObservation(
  result: MemberARoomResult,
  phase: MemberRoomContextPhase = 'member-a-room-context',
  reminderWidgetContext?: ReminderWidgetContextResponseSnapshot,
) {
  const stageFile = process.env.ELEMENT_ACCEPTANCE_STAGE_FILE;
  if (!stageFile) throw new Error('Element acceptance fixture unavailable');
  appendFileSync(
    stageFile,
    `${JSON.stringify({
      phase,
      status: result.failureCode ? 'failed' : 'passed',
      ...(result.failureCode ? { failureCode: result.failureCode } : {}),
      ...(result.observation ?? {}),
      ...(reminderWidgetContext ?? {}),
    })}\n`,
    { encoding: 'utf8', mode: 0o600 },
  );
}

function recordRuntimeVersions(chromiumVersion: string) {
  const stageFile = process.env.ELEMENT_ACCEPTANCE_STAGE_FILE;
  if (!stageFile) throw new Error('Element acceptance fixture unavailable');
  appendFileSync(
    stageFile,
    `${JSON.stringify({
      phase: 'runtime-versions',
      status: 'passed',
      elementWebConfiguredTag: ELEMENT_WEB_CONFIGURED_TAG,
      synapseConfiguredTag: 'v1.161.0',
      radicaleConfiguredTag: '3.8.0.0',
      chromiumVersion,
      runnerOS: platform(),
      runnerOSVersion: release(),
      runnerArchitecture: arch(),
      nodeVersion: process.version,
    })}\n`,
    { encoding: 'utf8', mode: 0o600 },
  );
}
