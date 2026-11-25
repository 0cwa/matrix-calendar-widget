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

import { type Response } from '@playwright/test';
import { type ElementErrorSourcePointer } from '../../dev/element-acceptance-error-source-map.mjs';
import {
  type PerformanceDefaultWaitFailureSnapshot,
  type PerformanceDefaultWaitObservation,
  type PerformancePageErrorClass,
  type PerformancePageErrorClassification,
} from '../../dev/element-acceptance-performance-evidence.mjs';
import { type PrivateUiCalendarListTransportObservation } from '../../dev/element-acceptance-private-ui-checkpoints.mjs';
import type { G6Phase, MemberARoomObservation } from './elementAcceptanceTypes';
export const PUBLIC_FEED_MANAGEMENT_ERROR_CODES = [
  'public-calendar-feed-upstream-unavailable',
  'public-calendar-feeds-disabled',
  'room-calendar-authorization-unavailable',
  'room-calendar-caldav-disabled',
] as const;
export const PROJECTION_DIAGNOSTIC_REASONS = [
  'invalid-recurrence',
  'invalid-timing',
  'occurrence-limit',
  'recurrence-input-limit',
  'unsupported-recurrence',
  'unsupported-timezone',
  'range-this-and-future',
] as const;
export type ReminderFlow = 'initial' | 'restart' | 'restore';
export type ReminderRecipient = 'room' | 'selected';
export type ReminderPlan = Readonly<{
  recipient: ReminderRecipient;
  allDay: boolean;
  allDayTimezone?: string;
  caldavAlarmLeadMinutes?: number;
  allDayEventDate?: string;
  allDaySchedule?: Readonly<{
    daysBefore: number;
    localTime: string;
    timezone: string;
  }>;
}>;
export type ReminderReadbackReference = Readonly<{
  expectedDueAt?: number;
  expectedAlarmLeadMinutes?: number;
  expectedAllDayEventDate?: string;
  deliveredAt?: number;
}>;
export type ReminderCreationResult = Readonly<{
  dueAt: number;
  alarmLeadMinutes: number;
  allDayEventDate?: string;
}>;
export type ReminderTimelineSnapshot = {
  httpStatus: number | null;
  complete: boolean;
  markerCounts: number[];
  markerTargetsMatch: boolean[];
  markerRoomMentions: boolean[];
  markerSelectedMemberMentions: boolean[];
  markerTimestamps: Array<number | null>;
};
export type ReminderConfigurationStep =
  | 'event-details'
  | 'settings-control'
  | 'options-load'
  | 'destination-control'
  | 'recipient-selection'
  | 'put-response'
  | 'post-put-layout'
  | 'complete';
export type ReminderLayoutPredicate = boolean | 'not-observed';
export type ReminderLayoutDimension = number | 'not-observed';
export type MemberInputExpandedState =
  | 'true'
  | 'false'
  | 'absent'
  | 'other'
  | 'not-observed';
export type MemberAriaHiddenState =
  | 'true'
  | 'false'
  | 'absent'
  | 'other'
  | 'not-observed';
export type MemberInertState = 'true' | 'false' | 'not-observed';
export type MemberCssVisibility =
  | 'visible'
  | 'hidden'
  | 'unknown'
  | 'not-observed';
export type MemberPickerObservationError =
  | 'none'
  | 'input-missing'
  | 'input-not-unique'
  | 'input-probe-install'
  | 'input-probe-read'
  | 'input-association'
  | 'listbox-association'
  | 'dom-sample'
  | 'listbox-count'
  | 'listbox-final-count'
  | 'multiple';
export type ReminderConfigurationObservation = {
  reminderStep: ReminderConfigurationStep;
  reminderSettingsButtonCount: number;
  reminderSettingsButtonVisible: boolean;
  reminderOptionsGetCount: number;
  reminderOptionsGetStatus: number;
  reminderConfigGetCount: number;
  reminderConfigGetStatus: number;
  recipientRosterGetCount: number;
  recipientRosterHttpStatus: number;
  recipientRosterCount: number;
  recipientRosterShapeValid: boolean;
  recipientRosterTargetPresent: boolean;
  recipientRosterOutcome:
    | 'unobserved'
    | 'http_error'
    | 'empty'
    | 'invalid_shape'
    | 'nonempty';
  reminderDestinationControlCount: number;
  recipientKind: 'room' | 'selected' | 'unknown';
  recipientSelectionAttempted: boolean;
  recipientSelectionStep: ReminderRecipientSelectionStep;
  recipientOptionCount: number;
  memberInputProbeInstalled: boolean;
  memberInputDomCount: number;
  memberInputAriaExpanded: MemberInputExpandedState;
  memberInputControlsTokenCount: number;
  memberInputControlsNodePresent: boolean;
  memberInputControlsListbox: boolean;
  memberListboxDomCount: number;
  memberOptionDomCount: number;
  memberListboxOwnAriaHidden: MemberAriaHiddenState;
  memberListboxAncestorAriaHidden: MemberAriaHiddenState;
  memberListboxOwnInert: MemberInertState;
  memberListboxAncestorInert: MemberInertState;
  memberListboxCssVisibility: MemberCssVisibility;
  memberNoOptionsTextPresent: boolean;
  memberLoadErrorVisible: boolean;
  memberPickerObservationError: MemberPickerObservationError;
  memberQueryMatchesTargetAfterFill: boolean;
  memberQueryMatchesTargetAtOptionCount: boolean;
  memberInputFocusedBeforeFill: boolean;
  memberDocumentFocusedBeforeFill: boolean;
  memberInputFocusedAfterFill: boolean;
  memberDocumentFocusedAfterFill: boolean;
  memberInputEventMatchedTarget: boolean;
  memberInputBlurEventCount: number;
  memberInputSameNodeAfterFill: boolean;
  memberListboxCount: number;
  memberInputControlsUniqueListbox: boolean;
  memberOptionCount: number;
  memberOptionsContainingTargetIdCount: number;
  selectedMemberTagCount: number;
  selectedMemberKeyboardFlow: boolean;
  reminderTargetMatches: boolean;
  allDayScheduleMatches: boolean;
  narrowSidePanelSafe: boolean;
  narrowViewportWithinRange: ReminderLayoutPredicate;
  narrowDialogWithinViewport: ReminderLayoutPredicate;
  narrowDialogContentsFit: ReminderLayoutPredicate;
  narrowDocumentContentsFit: ReminderLayoutPredicate;
  narrowViewportWidth: ReminderLayoutDimension;
  narrowDialogWidth: ReminderLayoutDimension;
  narrowDialogClientWidth: ReminderLayoutDimension;
  narrowDialogScrollWidth: ReminderLayoutDimension;
  narrowDocumentClientWidth: ReminderLayoutDimension;
  narrowDocumentScrollWidth: ReminderLayoutDimension;
  reminderPutCount: number;
  reminderPutStatus: number;
};
export type ReminderAlarmUiObservation = {
  alarmUiStep: ReminderAlarmUiStep;
  alarmUiPatchStatus: number;
  alarmUiRelativeAlarmReadback: boolean;
  alarmUiAlarmToggleReadback: boolean;
  alarmUiRelativeTriggerReadback: boolean;
  alarmUiOffsetReadback: boolean;
  alarmUiEditorClosed: boolean;
  alarmUiDetailsClosed: boolean;
};
export type ReminderAlarmUiStep =
  | 'event-row-visible'
  | 'event-open'
  | 'details-ready'
  | 'settings-open'
  | 'edit-button-ready'
  | 'editor-ready'
  | 'alarm-toggle-read'
  | 'alarm-toggle-enabled'
  | 'relative-option-selected'
  | 'offset-entered'
  | 'save-response-armed'
  | 'save-clicked'
  | 'patch-response-received'
  | 'editor-hidden'
  | 'details-ready-after-save'
  | 'details-hidden'
  | 'readback-editor-open'
  | 'readback-editor-ready'
  | 'readback-alarm-toggle'
  | 'readback-relative-option'
  | 'readback-offset'
  | 'readback-editor-cancelled'
  | 'readback-editor-hidden'
  | 'readback-details-hidden'
  | 'complete';
export type ReminderRecipientSelectionStep =
  | 'destination-clicked'
  | 'destination-listbox-ready'
  | 'destination-option-selected'
  | 'destination-menu-close-wait'
  | 'destination-menu-closed'
  | 'member-input-probe-install'
  | 'member-input-clicked'
  | 'member-prefill-roster-ready'
  | 'member-query-entered'
  | 'member-query-settled'
  | 'member-listbox-ready'
  | 'member-option-ready'
  | 'member-option-count-checked'
  | 'member-arrow-down'
  | 'member-enter'
  | 'member-keyboard-closed'
  | 'complete';
export type PublicFeedBrowserObservation = {
  publicFeedLifecycleStep: PublicFeedLifecycleStep;
  publicFeedSettingsEnabled?: boolean;
  publicFeedSettingsUnpublished?: boolean;
  publicFeedTargetCalendarMatches?: boolean;
  publicFeedManagementTargetMatches?: boolean;
  publicFeedConsentCheckboxCount?: number;
  publicFeedConsentCheckboxVisible?: boolean;
  publicFeedConsentCheckboxChecked?: boolean;
  publicFeedPublishButtonCount?: number;
  publicFeedPublishDisabledBeforeConsent?: boolean;
  publicFeedPublishDisabledAfterConsent?: boolean;
  publicFeedManagementGetStatus?: number;
  publicFeedManagementErrorCode?: PublicFeedManagementErrorCode;
  publicFeedPublishStatus?: number;
  publicFeedGetStatus?: number;
  publicFeedHeadStatus?: number;
  publicFeedUnpublishStatus?: number;
  publicFeedRevokedGetStatus?: number;
  publicFeedRevokedHeadStatus?: number;
  publicConsentGateObserved: boolean;
  publicManagerPublishSucceeded: boolean;
  publicUrlOriginAndRouteMatch: boolean;
  anonymousGetContainsCanonicalEvent: boolean;
  anonymousHeadMatchesGet: boolean;
  unpublishSucceeded: boolean;
  anonymousGetDeniedAfterUnpublish: boolean;
  anonymousHeadDeniedAfterUnpublish: boolean;
};
export type PublicFeedManagementErrorCode =
  | (typeof PUBLIC_FEED_MANAGEMENT_ERROR_CODES)[number]
  | 'unclassified';
export type PublicFeedLifecycleStep =
  | 'opening-dialog'
  | 'loading-settings'
  | 'selecting-target-calendar'
  | 'awaiting-consent-control'
  | 'toggling-consent'
  | 'verifying-consent'
  | 'publishing'
  | 'checking-public-feed'
  | 'unpublishing'
  | 'checking-revocation'
  | 'complete';
export type AnonymousPublicFeedResponse = {
  status?: number;
  contentType?: string;
  contentLength?: string;
  cacheControl?: string;
  pragma?: string;
  nosniff?: string;
  body: Uint8Array;
};
export type Phase =
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
  | 'public-feed-browser-lifecycle'
  | 'reminder-initial-delivery'
  | 'reminder-restart-prior-state'
  | 'reminder-restart-scheduler-scan'
  | 'reminder-restart-no-duplicate'
  | 'reminder-restore-prior-state'
  | 'reminder-restore-scheduler-scan'
  | 'reminder-restore-no-duplicate'
  | 'performance-pilot'
  | 'g6-member-a-room-context'
  | 'g6-member-b-room-context'
  | G6Phase;
export type BrowserActor = 'member-a' | 'member-b' | 'outsider';
export type BlockedRequestClass =
  | 'fixture-host-origin-mismatch'
  | 'matrix-client-well-known-discovery'
  | 'matrix-server-well-known-discovery'
  | 'non-http-scheme'
  | 'invalid-url'
  | 'unapproved-loopback-origin'
  | 'external-http-origin';
export type BlockedRequestResourceType =
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
export type BlockedRequestDiagnostic = {
  actor: BrowserActor;
  // Sampled shared harness phase; asynchronous requests can outlive an action.
  harnessPhase: Phase;
  requestClass: BlockedRequestClass;
  resourceType: BlockedRequestResourceType;
  count: number;
};
export type BlockedRequestEvidence = {
  diagnostics: Map<string, BlockedRequestDiagnostic>;
  overflow: boolean;
};
export type ReminderWidgetContextResponseSnapshot = {
  reminderWidgetContextResponseCount: number;
  reminderWidgetContextResponseStatus?: number;
};
export type ReminderWidgetContextResponseObserver = {
  response: Promise<Response>;
  snapshot: () => ReminderWidgetContextResponseSnapshot;
};
export type PerformancePageErrorStage =
  | 'case-setup'
  | 'element-login'
  | 'room-navigation'
  | 'widget-open'
  | 'default-view'
  | 'cold-layout'
  | 'refresh-setup'
  | 'refresh'
  | 'details'
  | 'case-cleanup';
export type PerformancePageErrorObservation =
  PerformancePageErrorClassification &
    ElementErrorSourcePointer & {
      profile: OrdinaryPerformanceProfile;
      stage: PerformancePageErrorStage;
      safeErrorName: string;
      safeErrorMessageClass: string;
    };
export type OrdinaryPerformanceProfile = 'empty' | 'events-25';
export type OrdinaryPerformanceSampleKey =
  | `${OrdinaryPerformanceProfile}-default`
  | `${OrdinaryPerformanceProfile}-refresh-setup`
  | `${OrdinaryPerformanceProfile}-refresh`
  | `events-25-details-${1 | 2 | 3 | 4 | 5}`;
export type PerformanceSampleKey =
  | 'cold-list'
  | `warmup-${'list' | 'month'}-${1 | 2}`
  | `measured-${'list' | 'month'}-${1 | 2 | 3 | 4 | 5}`
  | 'overflow-month'
  | 'overflow-day'
  | 'overflow-reset-month'
  | 'overflow-reset-list'
  | `details-warmup-${1 | 2}`
  | `details-${1 | 2 | 3 | 4 | 5}`
  | OrdinaryPerformanceSampleKey;
export type PerformanceEndpoint =
  | 'context'
  | 'calendars'
  | 'events'
  | 'openid'
  | 'other-calendar'
  | 'other-api';
export type PerformanceRangeClass =
  | 'not-applicable'
  | 'preselection'
  | 'preselection-next'
  | 'list31'
  | 'month-padded'
  | 'overflow-day'
  | 'mismatch';
export type PerformanceApiResponse = {
  sample: PerformanceSampleKey;
  endpoint: PerformanceEndpoint;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'OTHER';
  status: number;
  durationMs: number;
  decoded: boolean;
  eventCount: number | null;
  diagnosticCount: number | null;
  target: 'none' | 'personal' | 'room' | 'other';
  calendarMatches: boolean | null;
  rangeClass: PerformanceRangeClass;
  rangeDays: number | null;
  rangeMatches: boolean | null;
  expectedTitlesMatch: boolean | null;
};
export type PerformanceViewSample = {
  index: number;
  view: 'list' | 'month';
  durationMs: number | null;
  apiResponseCount: number;
  apiRangeMaxMs: number | null;
  roomResponseCount: number;
  returnedCount: number | null;
  renderedCount: number | null;
  rangeMatches: boolean;
  identitiesMatch: boolean;
  diagnosticsZero: boolean;
  stable: boolean;
  horizontalOverflow: boolean | null;
};
export type PerformanceDetailsSample = {
  index: number;
  durationMs: number | null;
  visible: boolean;
  titleMatches: boolean;
  stable: boolean;
  horizontalOverflow: boolean | null;
};
export type PerformanceDefaultViewSample = {
  durationMs: number | null;
  apiResponseCount: number;
  apiRangeMaxMs: number | null;
  returnedCount: number | null;
  renderedCount: number | null;
  rangeMatches: boolean;
  countMatches: boolean;
  usableControlVisible: boolean;
  stable: boolean;
};
export type PerformanceReport = {
  version: 2;
  year: number;
  month: number;
  viewportWidth: 1280;
  viewportHeight: 800;
  workloadEvents: 250;
  calendarDays: 31;
  timezone: 'Europe/Stockholm';
  preparation: {
    elementLoginMs: number | null;
    roomNavigationMs: number | null;
  };
  coldList: {
    durationMs: number | null;
    widgetStartupMs: number | null;
    activationMs: number | null;
    capabilityApprovalMs: number | null;
    identityApprovalMs: number | null;
    iframeReadyMs: number | null;
    placement: 'widget-card' | 'apps-drawer' | 'unknown';
    widgetCardCount: number;
    widgetCardVisible: boolean;
    appDrawerCount: number;
    persistedHostFrameCount: number;
    persistedHostFrameVisible: boolean;
    iframeWidth: number | null;
    iframeHeight: number | null;
    hostHorizontalOverflow: boolean | null;
    rangeSelectionMs: number | null;
    openIdResponseCount: number;
    openIdMaxMs: number | null;
    apiRangeMaxMs: number | null;
    selectedRoomResponseCount: number;
    returnedCount: number | null;
    renderedCount: number | null;
    expectedRangeMatches: boolean;
    identitiesMatch: boolean;
    diagnosticsZero: boolean;
    stable: boolean;
    horizontalOverflow: boolean | null;
  };
  viewWarmups: PerformanceViewSample[];
  viewSamples: PerformanceViewSample[];
  detailWarmups: PerformanceDetailsSample[];
  detailSamples: PerformanceDetailsSample[];
  overflow: {
    visibleEventCount: number | null;
    collapsedEventCount: number | null;
    renderedEventCount: number | null;
    opened: boolean;
    expectedDayEventCount: number | null;
    dayEventCount: number | null;
    dayIdentityMatches: boolean;
    stable: boolean;
  };
  apiResponses: PerformanceApiResponse[];
  blockedRequestCount: number | null;
  pageErrorCount: number | null;
  pageErrorClass: PerformancePageErrorClass;
};
export type PerformanceActionSample = {
  durationMs: number | null;
  apiResponseCount: number;
  apiRangeMaxMs: number | null;
  roomResponseCount: number;
  returnedCount: number | null;
  renderedCount: number | null;
  rangeMatches: boolean;
  identitiesMatch: boolean;
  diagnosticsZero: boolean;
  stable: boolean;
  horizontalOverflow: boolean | null;
};
export type OrdinaryPerformanceCase = {
  profile: OrdinaryPerformanceProfile;
  year: number;
  month: number;
  eventCount: 0 | 25;
  preparation: PerformanceReport['preparation'];
  defaultView: PerformanceDefaultViewSample;
  defaultWaitObservation: PerformanceDefaultWaitObservation | null;
  coldList: PerformanceReport['coldList'];
  refreshSetup: PerformanceActionSample;
  refresh: PerformanceActionSample;
  detailSamples: PerformanceDetailsSample[];
};
export type OrdinaryPerformanceReport = {
  version: 14;
  viewportWidth: 1280;
  viewportHeight: 800;
  calendarDays: 7;
  timezone: 'Europe/Stockholm';
  cases: OrdinaryPerformanceCase[];
  apiResponses: PerformanceApiResponse[];
  blockedRequestCount: number | null;
  pageErrorCount: number | null;
  pageErrorClass: PerformancePageErrorClass;
  pageErrorObservations: PerformancePageErrorObservation[];
  pageErrorObservationOverflow: boolean;
};
export type PerformanceReportData =
  | PerformanceReport
  | OrdinaryPerformanceReport;
export type PerformancePendingRequest = {
  sample: PerformanceSampleKey;
  endpoint: PerformanceEndpoint;
  method: PerformanceApiResponse['method'];
  startedAt: number;
  target: 'none' | 'personal' | 'room' | 'other';
  calendarMatches: boolean | null;
  rangeClass: PerformanceRangeClass;
  rangeDays: number | null;
  rangeMatches: boolean | null;
  expectedTitles: ReadonlySet<string>;
};
export type PerformanceApiObserver = {
  setSample: (
    sample: PerformanceSampleKey,
    expectedTitles?: ReadonlySet<string>,
  ) => void;
  rows: () => PerformanceApiResponse[];
  rowsFor: (sample: PerformanceSampleKey) => PerformanceApiResponse[];
  defaultWaitObservation: (
    sample: PerformanceSampleKey,
    failureSnapshot?: PerformanceDefaultWaitFailureSnapshot,
  ) => PerformanceDefaultWaitObservation;
  waitForRoomEvents: (
    sample: PerformanceSampleKey,
    rangeClass:
      | 'preselection'
      | 'preselection-next'
      | 'list31'
      | 'month-padded'
      | 'overflow-day',
  ) => Promise<void>;
  waitForSettled: (sample: PerformanceSampleKey) => Promise<void>;
};
export type HomeserverHttpFailures = {
  count: number;
  lastStatus?: number;
};
export type PinnedControlObservation = {
  phase: Phase;
  count: number;
  controlVisible: boolean;
  panelPresent?: boolean;
};
export type GatewayEndpointKind =
  | 'context'
  | 'calendars'
  | 'events'
  | 'other-calendar'
  | 'other-api';
export type GatewayRequestMethod =
  | 'GET'
  | 'POST'
  | 'PATCH'
  | 'PUT'
  | 'DELETE'
  | 'OPTIONS'
  | 'HEAD'
  | 'OTHER';
export type WidgetResourceKind = 'document' | 'script' | 'stylesheet';
export type WidgetDocumentReadyState =
  | 'loading'
  | 'interactive'
  | 'complete'
  | 'unavailable';
export type WidgetPageErrorClass =
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
export type OpenIdProtocolState =
  | 'none'
  | 'allowed'
  | 'request'
  | 'blocked'
  | 'other';
export type AcceptanceRuntimeObservation = {
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
export type PostCreateVisibilityObservation = {
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
export type ProjectionDiagnosticReason =
  (typeof PROJECTION_DIAGNOSTIC_REASONS)[number];
export type ProjectionDiagnosticCounts = Record<
  ProjectionDiagnosticReason,
  number
>;
export type ProjectionDiagnosticSummary = {
  complete: boolean;
  counts: ProjectionDiagnosticCounts;
};
export type CalDavProjectionDiagnosticCode =
  | ProjectionDiagnosticReason
  | 'none'
  | 'inconclusive';
export type TimezoneAuditClassification =
  | 'unsupported-zone-id'
  | 'no-embedded-definition'
  | 'duplicate-definitions'
  | 'embedded-definition-mismatch'
  | 'embedded-definition-matches'
  | 'other-unsupported-timezone'
  | 'no-zoned-start'
  | 'inconclusive';
export type TimezoneSafetyObservation = {
  completed: boolean;
  parsedEventUnsupportedTimezone: boolean | null;
  bundledZoneId: boolean | null;
  embeddedDefinitionCount: number;
  canonicalEmbeddedDefinitionMatches: boolean | null;
  classification: TimezoneAuditClassification;
};
export type CalDavProjectionObservation = {
  completed: boolean;
  includesCreatedEvent: boolean | null;
  diagnosticCode: CalDavProjectionDiagnosticCode;
  diagnosticCounts: ProjectionDiagnosticCounts;
  timezoneAudit: TimezoneSafetyObservation;
};
export type RoomRenderStateObservation = Pick<
  MemberARoomObservation,
  | 'outerRenderBucket'
  | 'matrixChatShellPresent'
  | 'roomViewWrapperPresent'
  | 'roomViewRendererPresent'
  | 'matrixChatStateAvailable'
  | 'matrixChatViewBucket'
  | 'matrixChatFirstSyncComplete'
  | 'matrixChatReady'
  | 'matrixChatPageTypeBucket'
  | 'matrixChatCurrentRoomMatches'
  | 'roomRenderStateAvailable'
  | 'roomViewShellVisible'
  | 'roomViewBodyVisible'
  | 'roomPreviewVisible'
  | 'roomPreviewLoadingVisible'
  | 'roomHeaderVisible'
  | 'roomHeaderHeadingVisible'
  | 'roomErrorBoundaryVisible'
>;
export type PrivateCalendarListRequestObserver = {
  dispose: () => void;
  recordSnapshot: (
    record: (observations: PrivateUiCalendarListTransportObservation[]) => void,
  ) => void;
};
export type PrivateDavRequestResult = Readonly<{
  status: number;
  bodyBytes: number;
  etag?: string;
  expectedTextPresent?: boolean;
}>;
export type ExpectedRoomRange = {
  start: string;
  end: string;
  timezone: string;
};
export type CalDavReportProbeResult = {
  completed: boolean;
  openIdStatus: number | null;
  reportStatus: number | null;
  containsCreatedEvent: boolean | null;
  projection: CalDavProjectionObservation;
};
