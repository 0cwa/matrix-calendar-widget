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
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import type { ClientRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { arch, platform, release, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  extractElementBundleFrames,
  readElementErrorSourceMapInPage,
  resolveElementErrorSourcePointer,
  type ElementBundleFrame,
  type ElementErrorSourcePointer,
} from '../../dev/element-acceptance-error-source-map.mjs';
import {
  compareEventTimingWithRoomRange,
  readCreatedEventTiming,
  type CreatedEventTiming,
} from '../../dev/element-acceptance-event-observation.mjs';
import {
  MAX_DEFAULT_WAIT_DIAGNOSTIC_COUNT,
  advanceOrdinaryPageErrorStage,
  capturePerformancePageError,
  isVerifiedOpeningHostDiagnostic,
  safePerformancePageErrorDetails,
  summarizeDefaultWaitObservation,
  type PerformanceDefaultWaitFailureSnapshot,
  type PerformanceDefaultWaitObservation,
  type PerformancePageErrorClass,
  type PerformancePageErrorClassification,
} from '../../dev/element-acceptance-performance-evidence.mjs';
import {
  buildOrdinaryPerformanceSeedEnvironment,
  raceCalendarReadyOrIdentityPrompt,
} from '../../dev/element-acceptance-performance.mjs';
import { classifyG6KeyboardFocusTarget } from '../../dev/element-g6-keyboard-focus.mjs';
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
import {
  ROOM_READINESS_SAMPLE_TIMEOUT_MS,
  collectRoomReadinessTimeline,
  roomContextObservationForPhase,
  unavailableRoomReadinessTimeline,
  type RoomReadinessSnapshot,
  type RoomReadinessTimeline,
} from '../../dev/element-room-context-observation.mjs';
import { ElementWebPage } from './pages/elementWebPage';
import { fillDatePicker } from './pages/helper';

type User = {
  userId: string;
  accessToken: string;
  deviceId: string;
};

type PrincipalMode = 'appservice' | 'bot-account';

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
  principalMode: PrincipalMode;
  users: {
    memberA: User;
    memberB: User;
    outsider: User;
    bot: User;
  };
  serviceSender: {
    userId: string;
    accessToken: string;
  };
};

type ReminderFlow = 'initial' | 'restart' | 'restore';
type ReminderRecipient = 'room' | 'selected';
type ReminderPlan = Readonly<{
  recipient: ReminderRecipient;
  allDay: boolean;
  allDayEventDate?: string;
  allDaySchedule?: Readonly<{
    daysBefore: number;
    localTime: string;
    timezone: string;
  }>;
}>;

type ReminderTimelineSnapshot = {
  httpStatus: number | null;
  complete: boolean;
  markerCounts: number[];
  markerTargetsMatch: boolean[];
  markerRoomMentions: boolean[];
  markerSelectedMemberMentions: boolean[];
  markerTimestamps: Array<number | null>;
};

type ReminderConfigurationStep =
  | 'event-details'
  | 'settings-control'
  | 'options-load'
  | 'destination-control'
  | 'recipient-selection'
  | 'put-response'
  | 'post-put-layout'
  | 'complete';

type ReminderLayoutPredicate = boolean | 'not-observed';
type ReminderLayoutDimension = number | 'not-observed';

type MemberInputExpandedState =
  | 'true'
  | 'false'
  | 'absent'
  | 'other'
  | 'not-observed';
type MemberAriaHiddenState =
  | 'true'
  | 'false'
  | 'absent'
  | 'other'
  | 'not-observed';
type MemberInertState = 'true' | 'false' | 'not-observed';
type MemberCssVisibility = 'visible' | 'hidden' | 'unknown' | 'not-observed';
type MemberPickerObservationError =
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

type ReminderConfigurationObservation = {
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

// The standard Element side panel measured a 319 CSS-pixel content viewport.
const MIN_REMINDER_LAYOUT_VIEWPORT_WIDTH = 319;
const MAX_REMINDER_LAYOUT_VIEWPORT_WIDTH = 420;
const MAX_REMINDER_RECIPIENT_ROSTER_SIZE = 20_000;

function summarizeReminderRecipientRoster(
  value: unknown,
  expectedUserId: string,
): {
  recipientRosterCount: number;
  recipientRosterShapeValid: boolean;
  recipientRosterTargetPresent: boolean;
  recipientRosterOutcome: 'empty' | 'invalid_shape' | 'nonempty';
} {
  const invalid = (recipientRosterCount = 0) => ({
    recipientRosterCount,
    recipientRosterShapeValid: false,
    recipientRosterTargetPresent: false,
    recipientRosterOutcome: 'invalid_shape' as const,
  });
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 1 ||
    !('recipients' in value) ||
    !Array.isArray(value.recipients)
  ) {
    return invalid();
  }

  const recipients = value.recipients;
  const recipientRosterCount = Math.min(
    recipients.length,
    MAX_REMINDER_RECIPIENT_ROSTER_SIZE,
  );
  if (recipients.length > MAX_REMINDER_RECIPIENT_ROSTER_SIZE) {
    return invalid(recipientRosterCount);
  }

  const seen = new Set<string>();
  for (const recipient of recipients) {
    if (
      !isRecord(recipient) ||
      Object.keys(recipient).length !== 2 ||
      !('userId' in recipient) ||
      typeof recipient.userId !== 'string' ||
      !/^@[^\s:#?]+:[^\s?#]+$/u.test(recipient.userId) ||
      seen.has(recipient.userId) ||
      !('displayName' in recipient)
    ) {
      return invalid(recipientRosterCount);
    }
    const displayName = recipient.displayName;
    const displayNameValid =
      displayName === null ||
      (typeof displayName === 'string' &&
        Array.from(displayName).length <= 256 &&
        displayName.length > 0 &&
        !Array.from(displayName).some((character) => {
          const codePoint = character.codePointAt(0);
          return (
            codePoint !== undefined &&
            (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f))
          );
        }) &&
        displayName ===
          displayName.normalize('NFC').replace(/\s+/gu, ' ').trim());
    if (!displayNameValid) return invalid(recipientRosterCount);
    seen.add(recipient.userId);
  }

  return {
    recipientRosterCount,
    recipientRosterShapeValid: true,
    recipientRosterTargetPresent: seen.has(expectedUserId),
    recipientRosterOutcome: recipientRosterCount === 0 ? 'empty' : 'nonempty',
  };
}

type ReminderAlarmUiObservation = {
  alarmUiStep: ReminderAlarmUiStep;
  alarmUiPatchStatus: number;
  alarmUiRelativeAlarmReadback: boolean;
  alarmUiAlarmToggleReadback: boolean;
  alarmUiRelativeTriggerReadback: boolean;
  alarmUiOffsetReadback: boolean;
  alarmUiEditorClosed: boolean;
  alarmUiDetailsClosed: boolean;
};

type ReminderAlarmUiStep =
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

type ReminderRecipientSelectionStep =
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

type PublicFeedBrowserObservation = {
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

const PUBLIC_FEED_MANAGEMENT_ERROR_CODES = [
  'public-calendar-feed-upstream-unavailable',
  'public-calendar-feeds-disabled',
  'room-calendar-authorization-unavailable',
  'room-calendar-caldav-disabled',
] as const;

type PublicFeedManagementErrorCode =
  | (typeof PUBLIC_FEED_MANAGEMENT_ERROR_CODES)[number]
  | 'unclassified';

type PublicFeedLifecycleStep =
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

const PUBLIC_FEED_MANAGEMENT_ERROR_CODE_SET = new Set<string>(
  PUBLIC_FEED_MANAGEMENT_ERROR_CODES,
);

function classifyPublicFeedManagementErrorCode(
  state: unknown,
): PublicFeedManagementErrorCode {
  if (!isRecord(state) || typeof state.code !== 'string') {
    return 'unclassified';
  }
  return PUBLIC_FEED_MANAGEMENT_ERROR_CODE_SET.has(state.code)
    ? (state.code as PublicFeedManagementErrorCode)
    : 'unclassified';
}

type AnonymousPublicFeedResponse = {
  status?: number;
  contentType?: string;
  contentLength?: string;
  cacheControl?: string;
  pragma?: string;
  nosniff?: string;
  body: Uint8Array;
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
type G6KeyboardFocusTarget =
  | 'edit'
  | 'delete'
  | 'close'
  | 'dialog-content'
  | 'other'
  | 'outside'
  | 'unavailable';
type G6KeyboardTabFocusObservation = {
  activeTarget: G6KeyboardFocusTarget;
  frameHasFocus: boolean;
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
  editActionCountCapped?: number;
  editActionVisibility?: G6SidePanelControlVisibility;
  editActionEnabled?: G6SidePanelControlEnabled;
  deleteActionCountCapped?: number;
  deleteActionVisibility?: G6SidePanelControlVisibility;
  deleteActionEnabled?: G6SidePanelControlEnabled;
  closeActionCountCapped?: number;
  closeActionVisibility?: G6SidePanelControlVisibility;
  closeActionEnabled?: G6SidePanelControlEnabled;
  initialDetailsFocusTarget?: G6KeyboardFocusTarget;
  keyboardFrameHasFocus?: boolean;
  detailsTabFocusObservations?: G6KeyboardTabFocusObservation[];
  escapeAttempted?: boolean;
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
  localpart: string;
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
const PRIVATE_ACCEPTANCE_GATEWAY_ORIGIN = 'https://127.0.0.1:3001';
const G6_POSTSAVE_EVENT_COUNT_CAP = 100;

const REMINDER_START_LEAD_MS = 150_000;
const REMINDER_ALARM_OFFSET_MS = 60_000;
// Allow one default 60-second scheduler interval plus its 30-second scan deadline.
const REMINDER_SCAN_INTERVAL_MS = 60_000;
const REMINDER_SCAN_DEADLINE_MS = 30_000;
const REMINDER_POST_DUE_SCAN_ALLOWANCE_MS =
  REMINDER_SCAN_INTERVAL_MS + REMINDER_SCAN_DEADLINE_MS;
const REMINDER_TIMELINE_POLL_MS = 5_000;
const REMINDER_ALL_DAY_TIMEZONE = 'Europe/Stockholm';

function reminderPlanForMarkerIndex(index: number): ReminderPlan {
  if (index === 1) return { recipient: 'selected', allDay: true };
  if (index === 0 || index === 2) {
    return { recipient: 'room', allDay: false };
  }
  throw new Error('Reminder acceptance marker plan is unavailable');
}

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

type OuterRenderBucket =
  | 'room-page'
  | 'other-page'
  | 'no-shell'
  | 'inconsistent'
  | 'unavailable';
type MatrixChatViewBucket = 'logged-in' | 'other-view' | 'unavailable';
type MatrixChatPageTypeBucket =
  | 'room-view'
  | 'other-page'
  | 'missing'
  | 'unavailable';

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
  outerRenderBucket: OuterRenderBucket;
  matrixChatShellPresent: boolean | null;
  roomViewWrapperPresent: boolean | null;
  roomViewRendererPresent: boolean | null;
  matrixChatStateAvailable: boolean;
  matrixChatViewBucket: MatrixChatViewBucket;
  matrixChatReady: boolean | null;
  matrixChatPageTypeBucket: MatrixChatPageTypeBucket;
  matrixChatCurrentRoomMatches: boolean | null;
  roomRenderStateAvailable: boolean;
  roomViewShellVisible: boolean | null;
  roomViewBodyVisible: boolean | null;
  roomPreviewVisible: boolean | null;
  roomPreviewLoadingVisible: boolean | null;
  roomHeaderVisible: boolean | null;
  roomHeaderHeadingVisible: boolean | null;
  roomErrorBoundaryVisible: boolean | null;
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
  roomReadinessTimeline?: RoomReadinessTimeline;
  failureCode?: MemberARoomFailureCode;
};

type OpenCalendarWidgetOptions = {
  expectWidgetWarning: boolean;
  waitForCalendar?: boolean;
  captureMemberADiagnostics?: boolean;
  onTiming?: (
    phase:
      | 'activation'
      | 'capability-approval'
      | 'identity-approval'
      | 'iframe-ready'
      | 'widget-startup',
    durationMs: number,
  ) => void;
};

type PerformancePageErrorStage =
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

type PerformancePageErrorObservation = PerformancePageErrorClassification &
  ElementErrorSourcePointer & {
    profile: OrdinaryPerformanceProfile;
    stage: PerformancePageErrorStage;
    safeErrorName: string;
    safeErrorMessageClass: string;
  };

type OrdinaryPerformanceProfile = 'empty' | 'events-25';
type OrdinaryPerformanceSampleKey =
  | `${OrdinaryPerformanceProfile}-default`
  | `${OrdinaryPerformanceProfile}-refresh-setup`
  | `${OrdinaryPerformanceProfile}-refresh`
  | `events-25-details-${1 | 2 | 3 | 4 | 5}`;
type PerformanceSampleKey =
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
type PerformanceEndpoint =
  | 'context'
  | 'calendars'
  | 'events'
  | 'openid'
  | 'other-calendar'
  | 'other-api';
type PerformanceRangeClass =
  | 'not-applicable'
  | 'preselection'
  | 'preselection-next'
  | 'list31'
  | 'month-padded'
  | 'overflow-day'
  | 'mismatch';
type PerformanceApiResponse = {
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
type PerformanceViewSample = {
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
type PerformanceDetailsSample = {
  index: number;
  durationMs: number | null;
  visible: boolean;
  titleMatches: boolean;
  stable: boolean;
  horizontalOverflow: boolean | null;
};
type PerformanceDefaultViewSample = {
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
type PerformanceReport = {
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
type PerformanceActionSample = {
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
type OrdinaryPerformanceCase = {
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
type OrdinaryPerformanceReport = {
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
type PerformanceReportData = PerformanceReport | OrdinaryPerformanceReport;

type PerformancePendingRequest = {
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

type PerformanceApiObserver = {
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

function elapsedMilliseconds(startedAt: number): number {
  return roundPerformanceMilliseconds(performance.now() - startedAt);
}

function roundPerformanceMilliseconds(value: number): number {
  return Math.max(0, Number(value.toFixed(3)));
}

function localCalendarDate(date: Date): {
  year: number;
  month: number;
  day: number;
} {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Stockholm',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(date)
      .filter(({ type }) => type !== 'literal')
      .map(({ type, value }) => [type, Number(value)]),
  );
  return {
    year: values.year as number,
    month: values.month as number,
    day: values.day as number,
  };
}

function shiftCalendarDate(
  year: number,
  month: number,
  day: number,
  amount: number,
): { year: number; month: number; day: number } {
  const date = new Date(Date.UTC(year, month - 1, day + amount));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function localMidnightEpoch(year: number, month: number, day: number): number {
  const target = Date.UTC(year, month - 1, day);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Stockholm',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  let guess = target;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const values = Object.fromEntries(
      formatter
        .formatToParts(new Date(guess))
        .filter(({ type }) => type !== 'literal')
        .map(({ type, value }) => [type, Number(value)]),
    );
    const represented = Date.UTC(
      values.year as number,
      (values.month as number) - 1,
      values.day as number,
      values.hour as number,
      values.minute as number,
      values.second as number,
    );
    const adjustment = target - represented;
    guess += adjustment;
    if (adjustment === 0) return guess;
  }
  return guess;
}

function performanceMonthRange(
  year: number,
  month: number,
  view: 'list' | 'month',
): { start: number; end: number } {
  const firstDay = localMidnightEpoch(year, month, 1);
  const nextMonth = localMidnightEpoch(year, month + 1, 1);
  return view === 'month'
    ? {
        start: localMidnightEpoch(year, month, -6),
        end: localMidnightEpoch(year, month + 1, 8),
      }
    : { start: firstDay, end: nextMonth };
}

function performanceDayRange(
  year: number,
  month: number,
  day: number,
): { start: number; end: number } {
  return {
    start: localMidnightEpoch(year, month, day),
    end: localMidnightEpoch(year, month, day + 1),
  };
}

function performancePreselectionRange(
  initialDate: {
    year: number;
    month: number;
    day: number;
  },
  offsetDays = 0,
): { start: number; end: number } {
  const startDate = shiftCalendarDate(
    initialDate.year,
    initialDate.month,
    initialDate.day,
    offsetDays,
  );
  const endDate = shiftCalendarDate(
    startDate.year,
    startDate.month,
    startDate.day,
    7,
  );
  return {
    start: localMidnightEpoch(startDate.year, startDate.month, startDate.day),
    end: localMidnightEpoch(endDate.year, endDate.month, endDate.day),
  };
}

function makeEmptyPerformanceReport(
  year: number,
  month: number,
): PerformanceReport {
  return {
    version: 2,
    year,
    month,
    viewportWidth: 1280,
    viewportHeight: 800,
    workloadEvents: 250,
    calendarDays: 31,
    timezone: 'Europe/Stockholm',
    preparation: { elementLoginMs: null, roomNavigationMs: null },
    coldList: {
      durationMs: null,
      widgetStartupMs: null,
      activationMs: null,
      capabilityApprovalMs: null,
      identityApprovalMs: null,
      iframeReadyMs: null,
      placement: 'unknown',
      widgetCardCount: 0,
      widgetCardVisible: false,
      appDrawerCount: 0,
      persistedHostFrameCount: 0,
      persistedHostFrameVisible: false,
      iframeWidth: null,
      iframeHeight: null,
      hostHorizontalOverflow: null,
      rangeSelectionMs: null,
      openIdResponseCount: 0,
      openIdMaxMs: null,
      apiRangeMaxMs: null,
      selectedRoomResponseCount: 0,
      returnedCount: null,
      renderedCount: null,
      expectedRangeMatches: false,
      identitiesMatch: false,
      diagnosticsZero: false,
      stable: false,
      horizontalOverflow: null,
    },
    viewWarmups: [],
    viewSamples: [],
    detailWarmups: [],
    detailSamples: [],
    overflow: {
      visibleEventCount: null,
      collapsedEventCount: null,
      renderedEventCount: null,
      opened: false,
      expectedDayEventCount: null,
      dayEventCount: null,
      dayIdentityMatches: false,
      stable: false,
    },
    apiResponses: [],
    blockedRequestCount: null,
    pageErrorCount: null,
    pageErrorClass: 'none',
  };
}

function makeEmptyActionSample(): PerformanceActionSample {
  return {
    durationMs: null,
    apiResponseCount: 0,
    apiRangeMaxMs: null,
    roomResponseCount: 0,
    returnedCount: null,
    renderedCount: null,
    rangeMatches: false,
    identitiesMatch: false,
    diagnosticsZero: false,
    stable: false,
    horizontalOverflow: null,
  };
}

function makeEmptyOrdinaryPerformanceCase(
  profile: OrdinaryPerformanceProfile,
  year: number,
  month: number,
): OrdinaryPerformanceCase {
  return {
    profile,
    year,
    month,
    eventCount: profile === 'empty' ? 0 : 25,
    preparation: { elementLoginMs: null, roomNavigationMs: null },
    defaultView: {
      durationMs: null,
      apiResponseCount: 0,
      apiRangeMaxMs: null,
      returnedCount: null,
      renderedCount: null,
      rangeMatches: false,
      countMatches: false,
      usableControlVisible: false,
      stable: false,
    },
    defaultWaitObservation: null,
    coldList: makeEmptyPerformanceReport(year, month).coldList,
    refreshSetup: makeEmptyActionSample(),
    refresh: makeEmptyActionSample(),
    detailSamples: [],
  };
}

function makeEmptyOrdinaryPerformanceReport(initialDate: {
  year: number;
  month: number;
}): OrdinaryPerformanceReport {
  return {
    version: 14,
    viewportWidth: 1280,
    viewportHeight: 800,
    calendarDays: 7,
    timezone: 'Europe/Stockholm',
    cases: [
      makeEmptyOrdinaryPerformanceCase(
        'empty',
        initialDate.year,
        initialDate.month,
      ),
      makeEmptyOrdinaryPerformanceCase(
        'events-25',
        initialDate.year,
        initialDate.month,
      ),
    ],
    apiResponses: [],
    blockedRequestCount: 0,
    pageErrorCount: 0,
    pageErrorClass: 'none',
    pageErrorObservations: [],
    pageErrorObservationOverflow: false,
  };
}

function runOrdinaryPerformanceSeed(initialDate: {
  year: number;
  month: number;
  day: number;
}): void {
  const seedEnvironment = buildOrdinaryPerformanceSeedEnvironment(
    process.env,
    `${initialDate.year}-${String(initialDate.month).padStart(2, '0')}-${String(initialDate.day).padStart(2, '0')}`,
  );

  const result = spawnSync(
    process.execPath,
    [
      resolve(process.cwd(), '../dev/element-acceptance-performance.mjs'),
      'seed-ordinary',
    ],
    { env: seedEnvironment, stdio: 'ignore' },
  );
  if (result.error || result.status !== 0) {
    throw new Error('Ordinary performance fixture seeding failed');
  }
}

function makePerformanceTitles(
  runId: string,
  attempt: string,
  count = 250,
): string[] {
  if (!/^\d{1,20}$/u.test(runId) || !/^\d{1,6}$/u.test(attempt)) {
    throw new Error('Element performance run identity is unavailable');
  }
  return Array.from(
    { length: count },
    (_, index) =>
      `Performance ${runId}-${attempt}-${String(index + 1).padStart(3, '0')}`,
  );
}

function performanceRangeExpectation(
  sample: PerformanceSampleKey,
  year: number,
  month: number,
  initialDate: { year: number; month: number; day: number },
): {
  rangeClass: PerformanceRangeClass;
  start: number;
  end: number;
} {
  if (sample === 'cold-list') {
    return {
      rangeClass: 'list31',
      ...performanceMonthRange(year, month, 'list'),
    };
  }
  if (sample.endsWith('-refresh-setup')) {
    return {
      rangeClass: 'preselection-next',
      ...performancePreselectionRange(initialDate, 7),
    };
  }
  if (sample.endsWith('-refresh') || sample.startsWith('events-25-details-')) {
    return {
      rangeClass: 'preselection',
      ...performancePreselectionRange(initialDate),
    };
  }
  if (sample === 'overflow-day') {
    return {
      rangeClass: 'overflow-day',
      ...performanceDayRange(year, month, 1),
    };
  }
  if (
    sample === 'overflow-month' ||
    sample === 'overflow-reset-month' ||
    sample.startsWith('warmup-month-') ||
    sample.startsWith('measured-month-')
  ) {
    return {
      rangeClass: 'month-padded',
      ...performanceMonthRange(year, month, 'month'),
    };
  }
  if (
    sample === 'overflow-reset-list' ||
    sample.startsWith('warmup-list-') ||
    sample.startsWith('measured-list-') ||
    sample.startsWith('details-')
  ) {
    return {
      rangeClass: 'list31',
      ...performanceMonthRange(year, month, 'list'),
    };
  }
  return {
    rangeClass: 'preselection',
    ...performancePreselectionRange(initialDate),
  };
}

async function observeDefaultWaitFailureSnapshot(
  page: Page,
  frame: ReturnType<ElementWebPage['widgetByTitle']>,
  gatewayUrl: string,
  expectedRoomId: string,
  observer: PerformanceApiObserver,
  sample: PerformanceSampleKey,
): Promise<PerformanceDefaultWaitFailureSnapshot> {
  const unavailableConfiguration: PerformanceDefaultWaitFailureSnapshot['widgetConfiguration'] =
    {
      available: false,
      gatewayBaseParameterPresent: null,
      gatewayBaseValuePresent: null,
      gatewayBaseOriginMatches: null,
      roomIdParameterPresent: null,
      roomIdValuePresent: null,
      roomIdMatches: null,
      repositoryConfig: 'unavailable',
    };
  const widgetConfiguration = await page
    .locator('iframe[title="Matrix Calendar"]')
    .evaluateAll(
      (
        iframes,
        expected,
      ): PerformanceDefaultWaitFailureSnapshot['widgetConfiguration'] => {
        const unavailable =
          (): PerformanceDefaultWaitFailureSnapshot['widgetConfiguration'] => ({
            available: false,
            gatewayBaseParameterPresent: null,
            gatewayBaseValuePresent: null,
            gatewayBaseOriginMatches: null,
            roomIdParameterPresent: null,
            roomIdValuePresent: null,
            roomIdMatches: null,
            repositoryConfig: 'unavailable',
          });
        if (iframes.length !== 1) return unavailable();

        try {
          const source = iframes[0].getAttribute('src');
          if (!source) return unavailable();
          const widgetUrl = new URL(source, window.location.href);
          const hashQueryStart = widgetUrl.hash.indexOf('?');
          const hashQuery =
            hashQueryStart >= 0 ? widgetUrl.hash.slice(hashQueryStart + 1) : '';
          const searchParameters = new URLSearchParams(widgetUrl.search);
          const hashParameters = new URLSearchParams(hashQuery);
          const readParameter = (key: string) => {
            const searchValues = searchParameters.getAll(key);
            const hashValues = hashParameters.getAll(key);
            if (
              searchValues.length > 1 ||
              hashValues.length > 1 ||
              (searchValues.length > 0 && hashValues.length > 0)
            ) {
              return { unambiguous: false, present: false, value: undefined };
            }
            const values = searchValues.length > 0 ? searchValues : hashValues;
            return {
              unambiguous: true,
              present: values.length === 1,
              value: values[0],
            };
          };
          const gatewayBase = readParameter('meetings_bot_base_url');
          const roomId = readParameter('matrix_room_id');
          if (!gatewayBase.unambiguous || !roomId.unambiguous) {
            return unavailable();
          }

          const gatewayBaseValuePresent =
            gatewayBase.present &&
            typeof gatewayBase.value === 'string' &&
            gatewayBase.value.length > 0;
          const roomIdValuePresent =
            roomId.present &&
            typeof roomId.value === 'string' &&
            roomId.value.length > 0;
          let gatewayBaseOriginMatches: boolean | null = null;
          if (
            typeof gatewayBase.value === 'string' &&
            gatewayBase.value.length > 0
          ) {
            try {
              gatewayBaseOriginMatches =
                new URL(gatewayBase.value).origin === expected.gatewayOrigin;
            } catch {
              gatewayBaseOriginMatches = false;
            }
          }
          const roomIdMatches = roomIdValuePresent
            ? roomId.value === expected.roomId
            : null;
          const repositoryConfig: PerformanceDefaultWaitFailureSnapshot['widgetConfiguration']['repositoryConfig'] =
            !roomIdValuePresent ||
            (gatewayBase.present && !gatewayBaseValuePresent)
              ? 'in-memory-forced'
              : gatewayBaseValuePresent
                ? 'explicit-gateway-parameters'
                : 'build-config-fallback-possible';

          return {
            available: true,
            gatewayBaseParameterPresent: gatewayBase.present,
            gatewayBaseValuePresent,
            gatewayBaseOriginMatches,
            roomIdParameterPresent: roomId.present,
            roomIdValuePresent,
            roomIdMatches,
            repositoryConfig,
          };
        } catch {
          return unavailable();
        }
      },
      {
        gatewayOrigin: new URL(gatewayUrl).origin,
        roomId: expectedRoomId,
      },
    )
    .catch(() => unavailableConfiguration);

  let createControl: PerformanceDefaultWaitFailureSnapshot['createControl'] = {
    available: false,
    count: null,
    visible: null,
    enabled: null,
  };
  try {
    const createLocator = frame.getByRole('button', {
      name: 'Create event',
      exact: true,
    });
    const count = Math.min(await createLocator.count(), 2) as 0 | 1 | 2;
    if (count === 0) {
      createControl = {
        available: true,
        count,
        visible: false,
        enabled: false,
      };
    } else if (count === 2) {
      createControl = {
        available: true,
        count,
        visible: null,
        enabled: null,
      };
    } else {
      const [visible, enabled] = await Promise.all([
        createLocator.isVisible().catch(() => null),
        createLocator.isEnabled().catch(() => null),
      ]);
      createControl = { available: true, count, visible, enabled };
    }
  } catch {
    // A failed immediate locator read is reported as unavailable.
  }

  const completedApiRows: PerformanceDefaultWaitFailureSnapshot['completedApiRows'] =
    [];
  let completedApiRowsOverflow = false;
  for (const row of observer.rowsFor(sample)) {
    if (
      row.endpoint !== 'context' &&
      row.endpoint !== 'calendars' &&
      row.endpoint !== 'events' &&
      row.endpoint !== 'openid'
    ) {
      continue;
    }
    if (completedApiRows.length === MAX_DEFAULT_WAIT_DIAGNOSTIC_COUNT) {
      completedApiRowsOverflow = true;
      continue;
    }
    completedApiRows.push({
      endpoint: row.endpoint,
      status: row.status,
      decoded: row.decoded,
    });
  }

  return {
    widgetConfiguration,
    createControl,
    completedApiRows,
    completedApiRowsOverflow,
  };
}

function createPerformanceApiObserver(
  page: Page,
  year: number,
  month: number,
  expectedTitles: ReadonlySet<string>,
  expectedDayTitles: ReadonlySet<string>,
  initialDate: { year: number; month: number; day: number },
): PerformanceApiObserver {
  const gatewayOrigin = new URL(fixture.gatewayUrl).origin;
  const homeserverOrigin = new URL(fixture.homeserverUrl).origin;
  const pending = new Map<Request, PerformancePendingRequest>();
  const pendingBySample = new Map<PerformanceSampleKey, number>();
  const otherOriginCalendarPathCountBySample = new Map<
    PerformanceSampleKey,
    number
  >();
  const apiResponses: PerformanceApiResponse[] = [];
  let activeSample: PerformanceSampleKey = 'cold-list';
  let activeExpectedTitles = expectedTitles;

  const startRequest = (request: Request) => {
    const startedAt = performance.now();
    let requestUrl: URL;
    try {
      requestUrl = new URL(request.url());
    } catch {
      return;
    }
    const rawMethod = request.method();
    if (
      requestUrl.origin !== gatewayOrigin &&
      requestUrl.pathname.startsWith('/v1/calendar/')
    ) {
      const previousCount =
        otherOriginCalendarPathCountBySample.get(activeSample) ?? 0;
      otherOriginCalendarPathCountBySample.set(
        activeSample,
        Math.min(previousCount + 1, MAX_DEFAULT_WAIT_DIAGNOSTIC_COUNT + 1),
      );
    }
    if (rawMethod === 'OPTIONS' || rawMethod === 'HEAD') return;
    let endpoint: PerformanceEndpoint | undefined;
    if (
      requestUrl.origin === homeserverOrigin &&
      requestUrl.pathname.endsWith('/openid/request_token')
    ) {
      if (rawMethod !== 'POST') return;
      endpoint = 'openid';
    } else if (
      requestUrl.origin === gatewayOrigin &&
      requestUrl.pathname.startsWith('/v1/calendar/')
    ) {
      endpoint =
        requestUrl.pathname === '/v1/calendar/context'
          ? 'context'
          : requestUrl.pathname === '/v1/calendar/calendars'
            ? 'calendars'
            : requestUrl.pathname === '/v1/calendar/events'
              ? 'events'
              : 'other-calendar';
    }
    if (!endpoint) return;
    const method: PerformanceApiResponse['method'] =
      rawMethod === 'GET' ||
      rawMethod === 'POST' ||
      rawMethod === 'PUT' ||
      rawMethod === 'DELETE'
        ? rawMethod
        : 'OTHER';

    let target: PerformancePendingRequest['target'] = 'none';
    let calendarMatches: boolean | null = null;
    let rangeClass: PerformanceRangeClass = 'not-applicable';
    let rangeDays: number | null = null;
    let rangeMatches: boolean | null = null;
    if (endpoint === 'events') {
      const targetValue = requestUrl.searchParams.get('target');
      target =
        targetValue === 'personal' || targetValue === 'room'
          ? targetValue
          : targetValue
            ? 'other'
            : 'none';
      calendarMatches =
        target === 'room' &&
        requestUrl.searchParams.get('calendarId') === fixture.calendarId &&
        requestUrl.searchParams.get('roomId') === fixture.teamRoomId;
      const expected = performanceRangeExpectation(
        activeSample,
        year,
        month,
        initialDate,
      );
      const start = Date.parse(requestUrl.searchParams.get('start') ?? '');
      const end = Date.parse(requestUrl.searchParams.get('end') ?? '');
      if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
        rangeDays = roundPerformanceMilliseconds((end - start) / 86_400_000);
        rangeMatches = start === expected.start && end === expected.end;
      }
      rangeClass = rangeMatches ? expected.rangeClass : 'mismatch';
      if (
        activeSample === 'cold-list' &&
        !rangeMatches &&
        Number.isFinite(start) &&
        Number.isFinite(end)
      ) {
        const preselection = performancePreselectionRange(initialDate);
        if (start === preselection.start && end === preselection.end) {
          rangeClass = 'preselection';
          rangeMatches = true;
        }
      }
    }
    const metadata: PerformancePendingRequest = {
      sample: activeSample,
      endpoint,
      method,
      startedAt,
      target,
      calendarMatches,
      rangeClass,
      rangeDays,
      rangeMatches,
      expectedTitles: activeExpectedTitles,
    };
    pending.set(request, metadata);
    pendingBySample.set(
      activeSample,
      (pendingBySample.get(activeSample) ?? 0) + 1,
    );
  };

  const finishRequest = (
    request: Request,
    metadata: PerformancePendingRequest,
    status: number,
    decoded: boolean,
    body?: unknown,
  ) => {
    if (!pending.delete(request)) return;
    pendingBySample.set(
      metadata.sample,
      Math.max(0, (pendingBySample.get(metadata.sample) ?? 1) - 1),
    );
    let eventCount: number | null = null;
    let diagnosticCount: number | null = null;
    let expectedTitlesMatch: boolean | null = null;
    let calendarMatches = metadata.calendarMatches;
    if (metadata.endpoint === 'events' && decoded && isRecord(body)) {
      const resources = Array.isArray(body.events) ? body.events : undefined;
      const eventObjects = resources?.map((resource) =>
        isRecord(resource) && isRecord(resource.event)
          ? resource.event
          : undefined,
      );
      if (resources && eventObjects?.every((event) => event !== undefined)) {
        eventCount = resources.length;
        const titles = eventObjects.map((event) => event?.title);
        const expectedTitleSet =
          metadata.sample === 'overflow-day'
            ? expectedDayTitles
            : metadata.expectedTitles;
        expectedTitlesMatch =
          titles.length === expectedTitleSet.size &&
          titles.every(
            (title): title is string =>
              typeof title === 'string' && expectedTitleSet.has(title),
          ) &&
          new Set(titles).size === expectedTitleSet.size;
        calendarMatches =
          metadata.calendarMatches === true &&
          eventObjects.every(
            (event) => event?.calendarId === fixture.calendarId,
          );
      } else {
        eventCount = resources?.length ?? null;
        expectedTitlesMatch = false;
      }
      const diagnostics = Array.isArray(body.diagnostics)
        ? body.diagnostics
        : undefined;
      if (
        diagnostics?.every(
          (diagnostic) =>
            isRecord(diagnostic) &&
            Number.isInteger(diagnostic.count) &&
            (diagnostic.count as number) >= 0 &&
            (diagnostic.count as number) <= 1000,
        )
      ) {
        diagnosticCount = diagnostics.reduce(
          (total, diagnostic) =>
            total + (isRecord(diagnostic) ? (diagnostic.count as number) : 0),
          0,
        );
      }
    } else if (metadata.endpoint === 'events') {
      expectedTitlesMatch = false;
    }
    apiResponses.push({
      sample: metadata.sample,
      endpoint: metadata.endpoint,
      method: metadata.method,
      status,
      durationMs: roundPerformanceMilliseconds(
        performance.now() - metadata.startedAt,
      ),
      decoded,
      eventCount,
      diagnosticCount,
      target: metadata.target,
      calendarMatches,
      rangeClass: metadata.rangeClass,
      rangeDays: metadata.rangeDays,
      rangeMatches: metadata.rangeMatches,
      expectedTitlesMatch,
    });
  };

  page.on('request', startRequest);
  page.on('response', (response) => {
    const request = response.request();
    const metadata = pending.get(request);
    if (!metadata) return;
    void (async () => {
      let body: unknown;
      let decoded = false;
      try {
        body = await response.json();
        decoded = true;
      } catch {
        // The fixed report records only decode success and numeric status.
      }
      finishRequest(request, metadata, response.status(), decoded, body);
    })();
  });
  page.on('requestfailed', (request) => {
    const metadata = pending.get(request);
    if (metadata) finishRequest(request, metadata, 0, false);
  });

  const waitUntil = async (predicate: () => boolean) => {
    const deadline = performance.now() + 30_000;
    while (performance.now() < deadline) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('Calendar API observation did not settle');
  };

  return {
    setSample: (sample, sampleExpectedTitles = expectedTitles) => {
      activeSample = sample;
      activeExpectedTitles = sampleExpectedTitles;
    },
    rows: () => [...apiResponses],
    rowsFor: (sample) => apiResponses.filter((row) => row.sample === sample),
    defaultWaitObservation: (sample, failureSnapshot) => {
      const pendingCounts: Record<PerformanceEndpoint, number> = {
        context: 0,
        calendars: 0,
        events: 0,
        openid: 0,
        'other-calendar': 0,
        'other-api': 0,
      };
      for (const metadata of pending.values()) {
        if (metadata.sample !== sample) continue;
        pendingCounts[metadata.endpoint] = Math.min(
          pendingCounts[metadata.endpoint] + 1,
          MAX_DEFAULT_WAIT_DIAGNOSTIC_COUNT + 1,
        );
      }
      return summarizeDefaultWaitObservation(
        pendingCounts,
        otherOriginCalendarPathCountBySample.get(sample) ?? 0,
        failureSnapshot,
      );
    },
    waitForRoomEvents: async (sample, expectedRangeClass) => {
      await waitUntil(() =>
        apiResponses.some(
          (row) =>
            row.sample === sample &&
            row.endpoint === 'events' &&
            row.target === 'room' &&
            row.calendarMatches === true &&
            row.rangeClass === expectedRangeClass &&
            row.rangeMatches === true,
        ),
      );
    },
    waitForSettled: async (sample) => {
      await waitUntil(() => (pendingBySample.get(sample) ?? 0) === 0);
    },
  };
}

function measureStableDom<T>(
  locator: Locator,
  read: () => Promise<T>,
): Promise<{
  first: T;
  second: T;
  stable: boolean;
}> {
  return (async () => {
    const first = await read();
    await locator.evaluate(
      async () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    const second = await read();
    return {
      first,
      second,
      stable: JSON.stringify(first) === JSON.stringify(second),
    };
  })();
}

async function readHorizontalOverflow(body: Locator): Promise<boolean> {
  return body.evaluate((bodyElement) => {
    const root = bodyElement.ownerDocument.documentElement;
    return (
      Math.max(root.scrollWidth, bodyElement.scrollWidth) > root.clientWidth
    );
  });
}

async function readStableList(
  frame: FrameLocator,
  expectedTitles: readonly string[],
) {
  const rows = frame.locator('li[aria-label]');
  await expect(rows).toHaveCount(expectedTitles.length);
  const body = frame.locator('body');
  return measureStableDom(body, () =>
    body.evaluate((bodyElement, expected) => {
      const root = bodyElement.ownerDocument.documentElement;
      const titles = Array.from(
        bodyElement.querySelectorAll('li[aria-label]'),
        (element) => element.getAttribute('aria-label') ?? '',
      );
      const actual = new Set(titles);
      const expectedSet = new Set(expected);
      return {
        renderedCount: titles.length,
        identitiesMatch:
          actual.size === expectedSet.size &&
          titles.length === expected.length &&
          expected.every((title) => actual.has(title)),
        horizontalOverflow:
          Math.max(root.scrollWidth, bodyElement.scrollWidth) >
          root.clientWidth,
      };
    }, expectedTitles),
  );
}

async function readStableRowCount(
  frame: FrameLocator,
  expectedTitles: readonly string[],
) {
  const body = frame.locator('body');
  return measureStableDom(body, () =>
    body.evaluate((bodyElement, expected) => {
      const root = bodyElement.ownerDocument.documentElement;
      const titles = Array.from(
        bodyElement.querySelectorAll('li[aria-label]'),
        (element) => element.getAttribute('aria-label') ?? '',
      );
      const actual = new Set(titles);
      const expectedSet = new Set(expected);
      return {
        renderedCount: titles.length,
        identitiesMatch:
          actual.size === expectedSet.size &&
          titles.length === expected.length &&
          expected.every((title) => actual.has(title)),
        horizontalOverflow:
          Math.max(root.scrollWidth, bodyElement.scrollWidth) >
          root.clientWidth,
      };
    }, expectedTitles),
  );
}

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

const ELEMENT_ERROR_SOURCE_MAP_MAX_BYTES = 64 * 1024 * 1024;
const ELEMENT_ERROR_SOURCE_MAP_TIMEOUT_MS = 2500;
const MAX_ELEMENT_ERROR_SOURCE_MAP_OBSERVATIONS = 2;
const MAX_ELEMENT_ERROR_SOURCE_MAP_LOOKUPS = 4;

async function readCappedElementErrorSourceMap(
  page: Page,
  frame: ElementBundleFrame,
  expectedElementOrigin: string,
  maxBytes: number,
): Promise<{ text: string | null; bytesRead: number; limitReached: boolean }> {
  if (
    page.isClosed() ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > ELEMENT_ERROR_SOURCE_MAP_MAX_BYTES
  ) {
    return { text: null, bytesRead: 0, limitReached: false };
  }
  try {
    const result = await page.evaluate(readElementErrorSourceMapInPage, {
      bundleUrl: frame.bundleUrl,
      expectedOrigin: expectedElementOrigin,
      maxBytes,
      timeoutMs: ELEMENT_ERROR_SOURCE_MAP_TIMEOUT_MS,
    });
    return result !== null &&
      typeof result === 'object' &&
      typeof result.bytesRead === 'number' &&
      Number.isSafeInteger(result.bytesRead) &&
      result.bytesRead >= 0 &&
      result.bytesRead <= maxBytes &&
      typeof result.limitReached === 'boolean' &&
      (result.text === null ||
        (typeof result.text === 'string' &&
          Buffer.byteLength(result.text, 'utf8') === result.bytesRead))
      ? result
      : { text: null, bytesRead: maxBytes, limitReached: true };
  } catch {
    return { text: null, bytesRead: 0, limitReached: false };
  }
}

test('Element Web measures the ordinary 0-and-25-event calendar profile', async ({
  browser,
}) => {
  test.setTimeout(360_000);
  fixture = readFixture();
  const runId = process.env.GITHUB_RUN_ID ?? '';
  const attempt = process.env.GITHUB_RUN_ATTEMPT ?? '';
  const initialDate = localCalendarDate(new Date());
  const report = makeEmptyOrdinaryPerformanceReport(initialDate);
  recordPerformancePilot('started', report);
  const allowedOrigins = new Set([
    new URL(fixture.elementUrl).origin,
    new URL(fixture.homeserverUrl).origin,
    'http://localhost:8008',
    new URL(fixture.gatewayUrl).origin,
    new URL(fixture.widgetUrl).origin,
  ]);
  let roomContextRecorded = false;
  let failureCode:
    | 'performance-setup-failed'
    | 'performance-widget-open-failed'
    | 'performance-host-layout-failed'
    | 'performance-default-view-failed'
    | 'performance-view-sample-failed'
    | 'performance-details-failed'
    | 'performance-egress-blocked'
    | 'performance-page-error'
    | 'performance-threshold-exceeded' = 'performance-setup-failed';

  const runCase = async (caseReport: OrdinaryPerformanceCase) => {
    const expectedTitles = makePerformanceTitles(
      runId,
      attempt,
      caseReport.eventCount,
    );
    const expectedTitleSet = new Set(expectedTitles);
    const context = await browser.newContext({
      locale: 'en-US',
      timezoneId: 'Europe/Stockholm',
      viewport: { width: 1280, height: 800 },
    });
    let page: Page | undefined;
    let observer: PerformanceApiObserver | undefined;
    let pageErrorStage: PerformancePageErrorStage = 'case-setup';
    let privatePageErrorCaptureCount = 0;
    const pageErrorSourceProfiles = new Set<OrdinaryPerformanceProfile>();
    const pageErrorSourceLookups: Array<{
      page: Page;
      frames: ElementBundleFrame[];
      observation: PerformancePageErrorObservation;
    }> = [];
    context.on('page', (openedPage) => {
      openedPage.on('pageerror', (error) => {
        if (privatePageErrorCaptureCount < 8) {
          capturePrivatePerformancePageError(
            error,
            caseReport.profile,
            pageErrorStage,
          );
          privatePageErrorCaptureCount += 1;
        }
        const capturedObservation = capturePerformancePageError(
          report,
          error,
          caseReport.profile,
          () => pageErrorStage,
          {
            elementUrl: fixture.elementUrl,
            widgetUrl: fixture.widgetUrl,
          },
        );
        if (!capturedObservation) {
          return;
        }
        const observation = Object.assign(
          capturedObservation,
          safePerformancePageErrorDetails(error),
        );
        const frames =
          observation.errorSource === 'element' &&
          pageErrorStage === 'widget-open'
            ? extractElementBundleFrames(error, fixture.elementUrl)
            : [];
        const shouldResolveSource =
          frames.length > 0 &&
          pageErrorSourceLookups.length <
            MAX_ELEMENT_ERROR_SOURCE_MAP_OBSERVATIONS &&
          !pageErrorSourceProfiles.has(caseReport.profile);
        observation.sourceMapStatus =
          frames.length === 0
            ? 'not-eligible'
            : shouldResolveSource
              ? 'unavailable'
              : 'not-attempted';
        if (frames.length > 0 && shouldResolveSource) {
          pageErrorSourceProfiles.add(caseReport.profile);
          pageErrorSourceLookups.push({
            page: openedPage,
            frames,
            observation,
          });
        }
      });
    });

    try {
      await context.route('**/*', async (route) => {
        let requestOrigin: string;
        try {
          requestOrigin = new URL(route.request().url()).origin;
        } catch {
          report.blockedRequestCount = Math.min(
            (report.blockedRequestCount ?? 0) + 1,
            100_000,
          );
          await route.abort('blockedbyclient');
          return;
        }
        if (!allowedOrigins.has(requestOrigin)) {
          report.blockedRequestCount = Math.min(
            (report.blockedRequestCount ?? 0) + 1,
            100_000,
          );
          await route.abort('blockedbyclient');
          return;
        }
        await route.continue();
      });

      const loginStartedAt = performance.now();
      pageErrorStage = 'element-login';
      page = await authenticateInElement(context, fixture.users.memberA);
      caseReport.preparation.elementLoginMs =
        elapsedMilliseconds(loginStartedAt);

      pageErrorStage = 'room-navigation';
      activePhase = 'member-a-room-navigation';
      const roomStartedAt = performance.now();
      const roomResult = await openMemberARoomWithDiagnostics(
        page,
        fixture.roomName,
        fixture.teamRoomId,
        fixture.users.memberA.userId,
        { useNormalRoomSelection: true },
      );
      caseReport.preparation.roomNavigationMs =
        elapsedMilliseconds(roomStartedAt);
      if (!roomContextRecorded) {
        record(
          activePhase,
          roomResult.navigationCompleted ? 'passed' : 'failed',
        );
        recordMemberARoomObservation(roomResult);
        roomContextRecorded = true;
      }
      const element = requireMemberARoom(roomResult);

      const apiObserver = createPerformanceApiObserver(
        page,
        caseReport.year,
        caseReport.month,
        expectedTitleSet,
        new Set(),
        initialDate,
      );
      observer = apiObserver;
      const defaultSample = `${caseReport.profile}-default` as const;
      observer.setSample(defaultSample);
      const coldStartedAt = performance.now();
      pageErrorStage = 'widget-open';
      failureCode = 'performance-widget-open-failed';
      const frame = await openCalendarWidget(element, page, {
        expectWidgetWarning: false,
        onTiming: (phase, durationMs) => {
          switch (phase) {
            case 'activation':
              caseReport.coldList.activationMs = durationMs;
              break;
            case 'capability-approval':
              caseReport.coldList.capabilityApprovalMs = durationMs;
              break;
            case 'identity-approval':
              caseReport.coldList.identityApprovalMs = durationMs;
              break;
            case 'iframe-ready':
              caseReport.coldList.iframeReadyMs = durationMs;
              break;
            case 'widget-startup':
              caseReport.coldList.widgetStartupMs = durationMs;
              break;
          }
        },
      });

      failureCode = 'performance-default-view-failed';
      try {
        await observer.waitForRoomEvents(defaultSample, 'preselection');
      } catch {
        const failureSnapshot = await observeDefaultWaitFailureSnapshot(
          page,
          frame,
          fixture.gatewayUrl,
          fixture.teamRoomId,
          observer,
          defaultSample,
        ).catch(() => undefined);
        caseReport.defaultWaitObservation = observer.defaultWaitObservation(
          defaultSample,
          failureSnapshot,
        );
        throw new Error('Default calendar response was not observed');
      }
      failureCode = 'performance-view-sample-failed';
      const defaultMeasurement = await readStableRowCount(
        frame,
        expectedTitles,
      );
      const readinessEventRows = observer
        .rowsFor(defaultSample)
        .filter((row) => row.endpoint === 'events');
      const readinessRoomRows = readinessEventRows.filter(
        (row) =>
          row.target === 'room' &&
          row.calendarMatches === true &&
          row.rangeClass === 'preselection' &&
          row.rangeMatches === true,
      );
      const readinessRoomRow = readinessRoomRows[0];
      const createEventControl = frame.getByRole('button', {
        name: 'Create event',
        exact: true,
      });
      const [defaultUsableControl, defaultUsableControlEnabled] =
        await Promise.all([
          createEventControl.isVisible().catch(() => false),
          createEventControl.isEnabled().catch(() => false),
        ]);
      pageErrorStage = advanceOrdinaryPageErrorStage(pageErrorStage, {
        responseDecoded:
          readinessRoomRow?.status === 200 && readinessRoomRow.decoded,
        responseMatches: readinessRoomRows.length === 1,
        returnedRowsExact:
          readinessRoomRow?.eventCount === caseReport.eventCount &&
          readinessRoomRow.expectedTitlesMatch === true,
        renderedRowsExact:
          defaultMeasurement.second.renderedCount === caseReport.eventCount &&
          defaultMeasurement.second.identitiesMatch,
        controlsUsable: defaultUsableControl && defaultUsableControlEnabled,
        stable: defaultMeasurement.stable,
      });
      await observer.waitForSettled(defaultSample);
      const defaultEventRows = observer
        .rowsFor(defaultSample)
        .filter((row) => row.endpoint === 'events');
      const defaultRoomRows = defaultEventRows.filter(
        (row) =>
          row.target === 'room' &&
          row.calendarMatches === true &&
          row.rangeClass === 'preselection' &&
          row.rangeMatches === true,
      );
      const defaultReturnedCount =
        defaultRoomRows.length === 1 ? defaultRoomRows[0].eventCount : null;
      caseReport.defaultView = {
        durationMs: elapsedMilliseconds(coldStartedAt),
        apiResponseCount: defaultEventRows.length,
        apiRangeMaxMs: defaultEventRows.length
          ? Math.max(...defaultEventRows.map((row) => row.durationMs))
          : null,
        returnedCount: defaultReturnedCount,
        renderedCount: defaultMeasurement.second.renderedCount,
        rangeMatches: defaultRoomRows.length === 1,
        countMatches:
          defaultReturnedCount !== null &&
          defaultReturnedCount === defaultMeasurement.second.renderedCount,
        usableControlVisible: defaultUsableControl,
        stable: defaultMeasurement.stable,
      };
      const openIdRows = observer
        .rowsFor(defaultSample)
        .filter((row) => row.endpoint === 'openid');
      caseReport.coldList.durationMs = caseReport.defaultView.durationMs;
      caseReport.coldList.openIdResponseCount = openIdRows.length;
      caseReport.coldList.openIdMaxMs = openIdRows.length
        ? Math.max(...openIdRows.map((row) => row.durationMs))
        : null;
      caseReport.coldList.apiRangeMaxMs = caseReport.defaultView.apiRangeMaxMs;
      caseReport.coldList.selectedRoomResponseCount = defaultRoomRows.length;
      caseReport.coldList.returnedCount = defaultReturnedCount;
      caseReport.coldList.renderedCount =
        defaultMeasurement.second.renderedCount;
      caseReport.coldList.expectedRangeMatches = defaultRoomRows.length === 1;
      caseReport.coldList.identitiesMatch =
        defaultRoomRows.length === 1 &&
        defaultRoomRows[0].expectedTitlesMatch === true &&
        defaultMeasurement.second.identitiesMatch;
      caseReport.coldList.diagnosticsZero =
        defaultEventRows.length > 0 &&
        defaultEventRows.every((row) => row.diagnosticCount === 0);
      caseReport.coldList.stable = defaultMeasurement.stable;
      caseReport.coldList.horizontalOverflow =
        defaultMeasurement.second.horizontalOverflow;
      expect(caseReport.defaultView.durationMs).not.toBeNull();
      expect(caseReport.defaultView.durationMs).toBeLessThanOrEqual(2000);
      expect(caseReport.defaultView.apiResponseCount).toBeGreaterThan(0);
      expect(caseReport.defaultView.apiRangeMaxMs).not.toBeNull();
      expect(caseReport.defaultView.apiRangeMaxMs).toBeLessThanOrEqual(1000);
      expect(caseReport.defaultView.returnedCount).toBe(caseReport.eventCount);
      expect(caseReport.defaultView.renderedCount).toBe(caseReport.eventCount);
      expect(caseReport.defaultView.rangeMatches).toBe(true);
      expect(caseReport.defaultView.countMatches).toBe(true);
      expect(caseReport.defaultView.usableControlVisible).toBe(true);
      expect(defaultUsableControlEnabled).toBe(true);
      expect(caseReport.defaultView.stable).toBe(true);
      expect(caseReport.coldList.identitiesMatch).toBe(true);
      expect(caseReport.coldList.diagnosticsZero).toBe(true);
      expect(caseReport.coldList.horizontalOverflow).toBe(false);

      failureCode = 'performance-host-layout-failed';
      const widgetCard = page.locator('.mx_WidgetCard');
      caseReport.coldList.widgetCardCount = Math.min(
        await widgetCard.count(),
        2,
      );
      caseReport.coldList.widgetCardVisible =
        caseReport.coldList.widgetCardCount === 1 &&
        (await widgetCard.isVisible().catch(() => false));
      const appDrawer = page.locator('.mx_AppsDrawer');
      caseReport.coldList.appDrawerCount = Math.min(await appDrawer.count(), 2);
      caseReport.coldList.placement = caseReport.coldList.widgetCardVisible
        ? 'widget-card'
        : caseReport.coldList.appDrawerCount > 0
          ? 'apps-drawer'
          : 'unknown';
      const hostIframe = page.locator(
        '#mx_PersistedElement_container iframe[title="Matrix Calendar"]',
      );
      await hostIframe
        .first()
        .waitFor({ state: 'attached', timeout: 30_000 })
        .catch(() => {});
      caseReport.coldList.persistedHostFrameCount = Math.min(
        await hostIframe.count(),
        2,
      );
      caseReport.coldList.persistedHostFrameVisible =
        caseReport.coldList.persistedHostFrameCount === 1 &&
        (await hostIframe
          .first()
          .isVisible()
          .catch(() => false));
      expect(caseReport.coldList.widgetCardCount).toBe(1);
      expect(caseReport.coldList.widgetCardVisible).toBe(true);
      expect(caseReport.coldList.placement).toBe('widget-card');
      expect(caseReport.coldList.persistedHostFrameCount).toBe(1);
      expect(caseReport.coldList.persistedHostFrameVisible).toBe(true);

      failureCode = 'performance-threshold-exceeded';
      expect(caseReport.coldList.durationMs).toBeLessThanOrEqual(2000);
      expect(caseReport.coldList.apiRangeMaxMs).toBeLessThanOrEqual(1000);
      expect(caseReport.coldList.openIdResponseCount).toBeGreaterThan(0);
      expect(caseReport.coldList.selectedRoomResponseCount).toBe(1);
      expect(caseReport.coldList.returnedCount).toBe(caseReport.eventCount);
      expect(caseReport.coldList.renderedCount).toBe(caseReport.eventCount);
      expect(caseReport.coldList.expectedRangeMatches).toBe(true);
      expect(caseReport.coldList.identitiesMatch).toBe(true);
      expect(caseReport.coldList.diagnosticsZero).toBe(true);
      expect(caseReport.coldList.stable).toBe(true);
      expect(caseReport.coldList.horizontalOverflow).toBe(false);
      const body = frame.locator('body');

      pageErrorStage = 'cold-layout';
      failureCode = 'performance-host-layout-failed';
      const frameDimensions = await hostIframe.evaluate((iframe) => {
        const rect = iframe.getBoundingClientRect();
        return {
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      });
      caseReport.coldList.iframeWidth = frameDimensions.width;
      caseReport.coldList.iframeHeight = frameDimensions.height;
      caseReport.coldList.hostHorizontalOverflow = await page.evaluate(() => {
        const root = document.documentElement;
        const hostBody = document.body;
        return (
          Math.max(root.scrollWidth, hostBody.scrollWidth) > root.clientWidth
        );
      });
      expect(caseReport.coldList.iframeWidth).toBeGreaterThan(0);
      expect(caseReport.coldList.iframeHeight).toBeGreaterThan(0);
      expect(caseReport.coldList.hostHorizontalOverflow).toBe(false);

      failureCode = 'performance-threshold-exceeded';
      expect(caseReport.coldList.durationMs).toBeLessThanOrEqual(2000);
      expect(caseReport.coldList.apiRangeMaxMs).toBeLessThanOrEqual(1000);
      expect(caseReport.coldList.openIdResponseCount).toBeGreaterThan(0);
      expect(caseReport.coldList.selectedRoomResponseCount).toBe(1);
      expect(caseReport.coldList.returnedCount).toBe(caseReport.eventCount);
      expect(caseReport.coldList.renderedCount).toBe(caseReport.eventCount);
      expect(caseReport.coldList.expectedRangeMatches).toBe(true);
      expect(caseReport.coldList.identitiesMatch).toBe(true);
      expect(caseReport.coldList.diagnosticsZero).toBe(true);
      expect(caseReport.coldList.stable).toBe(true);
      expect(caseReport.coldList.horizontalOverflow).toBe(false);

      const summarizeAction = (
        sample: PerformanceSampleKey,
        rangeClass: 'preselection' | 'preselection-next',
        measurement: {
          second: {
            renderedCount: number | null;
            identitiesMatch: boolean;
            horizontalOverflow: boolean;
          };
          stable: boolean;
        },
        durationMs: number,
      ): PerformanceActionSample => {
        const eventRows = apiObserver
          .rowsFor(sample)
          .filter((row) => row.endpoint === 'events');
        const matchingRoomRows = eventRows.filter(
          (row) =>
            row.target === 'room' &&
            row.calendarMatches === true &&
            row.rangeClass === rangeClass &&
            row.rangeMatches === true,
        );
        return {
          durationMs,
          apiResponseCount: eventRows.length,
          apiRangeMaxMs: eventRows.length
            ? Math.max(...eventRows.map((row) => row.durationMs))
            : null,
          roomResponseCount: matchingRoomRows.length,
          returnedCount:
            matchingRoomRows.length === 1
              ? matchingRoomRows[0].eventCount
              : null,
          renderedCount: measurement.second.renderedCount,
          rangeMatches: matchingRoomRows.length === 1,
          identitiesMatch:
            matchingRoomRows.length === 1 &&
            matchingRoomRows[0].expectedTitlesMatch === true &&
            measurement.second.identitiesMatch,
          diagnosticsZero:
            eventRows.length > 0 &&
            eventRows.every((row) => row.diagnosticCount === 0),
          stable: measurement.stable,
          horizontalOverflow: measurement.second.horizontalOverflow,
        };
      };

      pageErrorStage = 'refresh-setup';
      failureCode = 'performance-view-sample-failed';
      const setupSample = `${caseReport.profile}-refresh-setup` as const;
      observer.setSample(setupSample, new Set());
      const setupStartedAt = performance.now();
      const setupStartDate = shiftCalendarDate(
        initialDate.year,
        initialDate.month,
        initialDate.day,
        7,
      );
      const setupEndDate = shiftCalendarDate(
        setupStartDate.year,
        setupStartDate.month,
        setupStartDate.day,
        6,
      );
      await fillDatePicker(
        frame,
        frame.getByRole('button', {
          name: /Choose date range, selected/u,
        }),
        [setupStartDate.year, setupStartDate.month, setupStartDate.day],
        [setupEndDate.year, setupEndDate.month, setupEndDate.day],
      );
      await observer.waitForRoomEvents(setupSample, 'preselection-next');
      const setupMeasurement = await readStableList(frame, []);
      await observer.waitForSettled(setupSample);
      caseReport.refreshSetup = summarizeAction(
        setupSample,
        'preselection-next',
        setupMeasurement,
        elapsedMilliseconds(setupStartedAt),
      );
      expect(caseReport.refreshSetup.apiResponseCount).toBeGreaterThan(0);
      expect(caseReport.refreshSetup.apiRangeMaxMs).toBeLessThanOrEqual(1000);
      expect(caseReport.refreshSetup.roomResponseCount).toBe(1);
      expect(caseReport.refreshSetup.returnedCount).toBe(0);
      expect(caseReport.refreshSetup.renderedCount).toBe(0);
      expect(caseReport.refreshSetup.rangeMatches).toBe(true);
      expect(caseReport.refreshSetup.identitiesMatch).toBe(true);
      expect(caseReport.refreshSetup.diagnosticsZero).toBe(true);
      expect(caseReport.refreshSetup.stable).toBe(true);

      const refreshSample = `${caseReport.profile}-refresh` as const;
      pageErrorStage = 'refresh';
      observer.setSample(refreshSample);
      const refreshStartedAt = performance.now();
      const originalEndDate = shiftCalendarDate(
        initialDate.year,
        initialDate.month,
        initialDate.day,
        6,
      );
      await fillDatePicker(
        frame,
        frame.getByRole('button', {
          name: /Choose date range, selected/u,
        }),
        [initialDate.year, initialDate.month, initialDate.day],
        [originalEndDate.year, originalEndDate.month, originalEndDate.day],
      );
      await observer.waitForRoomEvents(refreshSample, 'preselection');
      const refreshMeasurement = await readStableList(frame, expectedTitles);
      await observer.waitForSettled(refreshSample);
      caseReport.refresh = summarizeAction(
        refreshSample,
        'preselection',
        refreshMeasurement,
        elapsedMilliseconds(refreshStartedAt),
      );
      failureCode = 'performance-threshold-exceeded';
      expect(caseReport.refresh.durationMs).toBeLessThanOrEqual(2000);
      expect(caseReport.refresh.apiRangeMaxMs).toBeLessThanOrEqual(1000);
      expect(caseReport.refresh.roomResponseCount).toBe(1);
      expect(caseReport.refresh.returnedCount).toBe(caseReport.eventCount);
      expect(caseReport.refresh.renderedCount).toBe(caseReport.eventCount);
      expect(caseReport.refresh.rangeMatches).toBe(true);
      expect(caseReport.refresh.identitiesMatch).toBe(true);
      expect(caseReport.refresh.diagnosticsZero).toBe(true);
      expect(caseReport.refresh.stable).toBe(true);
      expect(caseReport.refresh.horizontalOverflow).toBe(false);

      if (caseReport.profile === 'events-25') {
        pageErrorStage = 'details';
        for (const index of [1, 2, 3, 4, 5] as const) {
          failureCode = 'performance-details-failed';
          const sample = `events-25-details-${index}` as const;
          observer.setSample(sample);
          const details: PerformanceDetailsSample = {
            index,
            durationMs: null,
            visible: false,
            titleMatches: false,
            stable: false,
            horizontalOverflow: null,
          };
          caseReport.detailSamples.push(details);
          const detailStartedAt = performance.now();
          const selectedTitle = expectedTitles[index - 1];
          const row = frame.getByRole('listitem', { name: selectedTitle });
          await row.click();
          const dialog = frame.getByRole('dialog').last();
          await expect(dialog).toBeVisible();
          const title = dialog.getByText(selectedTitle, { exact: true });
          await expect(title).toBeVisible();
          await observer.waitForSettled(sample);
          const detailsMeasurement = await measureStableDom(body, async () => ({
            visible: await dialog.isVisible().catch(() => false),
            titleMatches: await title.isVisible().catch(() => false),
            horizontalOverflow: await readHorizontalOverflow(body),
          }));
          details.durationMs = elapsedMilliseconds(detailStartedAt);
          details.visible = detailsMeasurement.second.visible;
          details.titleMatches = detailsMeasurement.second.titleMatches;
          details.stable = detailsMeasurement.stable;
          details.horizontalOverflow =
            detailsMeasurement.second.horizontalOverflow;
          failureCode = 'performance-threshold-exceeded';
          expect(details.durationMs).toBeLessThanOrEqual(500);
          expect(details.visible).toBe(true);
          expect(details.titleMatches).toBe(true);
          expect(details.stable).toBe(true);
          expect(details.horizontalOverflow).toBe(false);
          await dialog
            .getByRole('button', { name: 'Close', exact: true })
            .click();
          await expect(dialog).toBeHidden();
        }
      }

      for (const response of observer.rows()) {
        expect(response.status).toBe(200);
        expect(response.decoded).toBe(true);
        expect(response.method).toBe(
          response.endpoint === 'openid' ? 'POST' : 'GET',
        );
        if (response.endpoint !== 'openid') {
          expect(response.durationMs).toBeLessThanOrEqual(1000);
        }
        if (response.endpoint === 'events') {
          expect(response.diagnosticCount).toBe(0);
        }
      }
    } finally {
      pageErrorStage = 'case-cleanup';
      if (observer) report.apiResponses.push(...observer.rows());
      for (const lookup of pageErrorSourceLookups) {
        let remainingBytes = ELEMENT_ERROR_SOURCE_MAP_MAX_BYTES;
        const sourceMaps: Array<{
          bundleUrl: string;
          sourceMapText: string | null;
        }> = [];
        const seenBundles = new Set<string>();
        for (const frame of lookup.frames) {
          if (
            seenBundles.has(frame.bundleUrl) ||
            sourceMaps.length >= MAX_ELEMENT_ERROR_SOURCE_MAP_LOOKUPS ||
            remainingBytes <= 0
          ) {
            continue;
          }
          seenBundles.add(frame.bundleUrl);
          try {
            const result = await readCappedElementErrorSourceMap(
              lookup.page,
              frame,
              new URL(fixture.elementUrl).origin,
              remainingBytes,
            );
            sourceMaps.push({
              bundleUrl: frame.bundleUrl,
              sourceMapText: result.text,
            });
            remainingBytes = Math.max(0, remainingBytes - result.bytesRead);
            if (result.limitReached) remainingBytes = 0;
          } catch {
            sourceMaps.push({
              bundleUrl: frame.bundleUrl,
              sourceMapText: null,
            });
          }
        }
        Object.assign(
          lookup.observation,
          resolveElementErrorSourcePointer(lookup.frames, sourceMaps),
        );
      }
      await context.close();
    }
  };

  try {
    recordRuntimeVersions(browser.version());
    await runCase(report.cases[0]);
    failureCode = 'performance-setup-failed';
    runOrdinaryPerformanceSeed(initialDate);
    failureCode = 'performance-setup-failed';
    await runCase(report.cases[1]);
    failureCode = 'performance-egress-blocked';
    expect(report.blockedRequestCount).toBe(0);
    failureCode = 'performance-page-error';
    expect(report.pageErrorObservationOverflow).toBe(false);
    expect(report.pageErrorObservations.length).toBe(report.pageErrorCount);
    expect(
      report.pageErrorObservations.every(isVerifiedOpeningHostDiagnostic),
    ).toBe(true);
    expect(report.pageErrorClass).toBe(
      report.pageErrorCount === 0
        ? 'none'
        : report.pageErrorObservations[0]?.errorClass,
    );
    recordPerformancePilot('passed', report);
  } catch {
    recordPerformancePilot('failed', report, failureCode);
    throw new Error('Element ordinary performance profile failed');
  }
});

test('Element Web delivers room-timed and selected-member all-day reminders across restart and restore', async ({
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
      { captureReminderRoomLayout: true },
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
    if (flow === 'restart') {
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(
        frame.getByRole('button', { name: 'Create event', exact: true }),
      ).toBeVisible();
    }
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
        eventTitles,
      );
      if (
        !existingReadback.relativeAlarmReadback ||
        !existingReadback.reminderEnabled ||
        !existingReadback.targetSettingsReadback ||
        !existingReadback.allDayScheduleReadback
      ) {
        record(activePhase, 'failed', undefined, existingReadback.count, {
          relativeAlarmReadback: existingReadback.relativeAlarmReadback,
          reminderEnabled: existingReadback.reminderEnabled,
          targetSettingsReadback: existingReadback.targetSettingsReadback,
          allDayScheduleReadback: existingReadback.allDayScheduleReadback,
        });
        failureAlreadyRecorded = true;
        throw new Error('Persisted reminder settings did not reload');
      }
      record(activePhase, 'passed', undefined, existingReadback.count, {
        relativeAlarmReadback: existingReadback.relativeAlarmReadback,
        reminderEnabled: existingReadback.reminderEnabled,
        targetSettingsReadback: existingReadback.targetSettingsReadback,
        allDayScheduleReadback: existingReadback.allDayScheduleReadback,
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
          timeline.markerTargetsMatch.every(Boolean);
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
          timeline.markerTargetsMatch.every(Boolean);
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
    const markerPlan = reminderPlanForMarkerIndex(eventTitles.length);
    const dueAt = await createAndConfigureReminder(
      frame,
      page,
      markerTitle,
      markerPlan,
    );
    eventTitles.push(markerTitle);

    activePhase = 'reminder-ui-readback';
    const allReadback = await readBackReminderMarkers(frame, eventTitles);
    if (
      !allReadback.relativeAlarmReadback ||
      !allReadback.reminderEnabled ||
      !allReadback.targetSettingsReadback ||
      !allReadback.allDayScheduleReadback
    ) {
      record(activePhase, 'failed', undefined, allReadback.count, {
        relativeAlarmReadback: allReadback.relativeAlarmReadback,
        reminderEnabled: allReadback.reminderEnabled,
        targetSettingsReadback: allReadback.targetSettingsReadback,
        allDayScheduleReadback: allReadback.allDayScheduleReadback,
      });
      failureAlreadyRecorded = true;
      throw new Error('Reminder settings did not reload after configuration');
    }
    record(activePhase, 'passed', undefined, allReadback.count, {
      relativeAlarmReadback: allReadback.relativeAlarmReadback,
      reminderEnabled: allReadback.reminderEnabled,
      targetSettingsReadback: allReadback.targetSettingsReadback,
      allDayScheduleReadback: allReadback.allDayScheduleReadback,
    });

    if (flow === 'initial') {
      await verifyPublicFeedBrowserLifecycle(frame, page, markerTitle);
    }

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
      delivery.complete &&
      delivery.markerCounts.every((count) => count === 1) &&
      delivery.markerTargetsMatch.every(Boolean);
    const targetMentioned = delivery.markerTargetsMatch.at(-1) === true;
    const roomMentioned = delivery.markerRoomMentions.at(-1) === true;
    const selectedMemberMentioned =
      delivery.markerSelectedMemberMentions.at(-1) === true;
    const deliveryPassed =
      delivery.httpStatus === 200 &&
      delivery.markerCounts.at(-1) === 1 &&
      targetMentioned &&
      (markerPlan.recipient === 'room'
        ? roomMentioned && !selectedMemberMentioned
        : selectedMemberMentioned && !roomMentioned) &&
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
          roomMentioned,
          selectedMemberMentioned,
          targetMentioned,
          expectedRoomRecipient: markerPlan.recipient === 'room',
          expectedSelectedRecipient: markerPlan.recipient === 'selected',
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
        roomMentioned,
        selectedMemberMentioned,
        targetMentioned: true,
        expectedRoomRecipient: markerPlan.recipient === 'room',
        expectedSelectedRecipient: markerPlan.recipient === 'selected',
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
        afterScan.markerTargetsMatch.every(Boolean);
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
      {
        captureReminderRoomLayout: true,
        captureRoomReadinessTimeline: true,
      },
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
      calDavClient!.localpart,
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
    try {
      await expect(narrowDetails).toBeVisible();
    } catch {
      // Record the observed visibility below without failing this probe.
    }
    const eventDetailsReachable = await narrowDetails
      .isVisible()
      .catch(() => false);
    if (eventDetailsReachable) {
      await narrowDetails
        .getByRole('button', { name: 'Close', exact: true })
        .click();
      await expect(narrowDetails).toBeHidden();
      await frameA
        .getByRole('button', { name: 'Create event', exact: true })
        .waitFor({ state: 'visible' })
        .catch(() => {});
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
    const keyboardEventButton = frameA.getByRole('button', {
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
      await pageA.keyboard.press('Tab');
      eventActionTabCount += 1;
      keyboardEventFocused = await keyboardEventButton
        .evaluate((element) => element === document.activeElement)
        .catch(() => false);
    }
    if (keyboardEventFocused) await pageA.keyboard.press('Enter');
    const keyboardDetails = frameA.getByRole('dialog').last();
    const detailsOpened = await keyboardDetails
      .waitFor({ state: 'visible', timeout: 8_000 })
      .then(() => true)
      .catch(() => false);
    const editButton = keyboardDetails.getByRole('button', {
      name: 'Edit',
      exact: true,
    });
    const deleteAction = keyboardDetails.getByRole('button', {
      name: 'Delete',
      exact: true,
    });
    const closeAction = keyboardDetails.getByRole('button', {
      name: 'Close',
      exact: true,
    });
    const [
      editControlObservation,
      deleteControlObservation,
      closeControlObservation,
    ] = await Promise.all([
      observeG6KeyboardControl(editButton),
      observeG6KeyboardControl(deleteAction),
      observeG6KeyboardControl(closeAction),
    ]);
    const keyboardFocusControls = {
      edit: editButton,
      editCountCapped: editControlObservation.countCapped,
      delete: deleteAction,
      deleteCountCapped: deleteControlObservation.countCapped,
      close: closeAction,
      closeCountCapped: closeControlObservation.countCapped,
      dialogContent: keyboardDetails.locator('.MuiDialogContent-root'),
    };
    const initialDetailsFocus = await observeG6KeyboardFocusTarget(
      frameA,
      keyboardFocusControls,
    );
    const detailsTabFocusObservations: G6KeyboardTabFocusObservation[] = [];
    let detailsActionTabCount = 0;
    let editActionFocused = await editButton
      .evaluate((element) => element === document.activeElement)
      .catch(() => false);
    while (!editActionFocused && detailsOpened && detailsActionTabCount < 12) {
      await pageA.keyboard.press('Tab');
      detailsActionTabCount += 1;
      detailsTabFocusObservations.push(
        await observeG6KeyboardFocusTarget(frameA, keyboardFocusControls),
      );
      editActionFocused = await editButton
        .evaluate((element) => element === document.activeElement)
        .catch(() => false);
    }
    let deleteActionFocused = false;
    let closeActionFocused = false;
    let escapeAttempted = false;
    if (editActionFocused) {
      await pageA.keyboard.press('Tab');
      detailsActionTabCount += 1;
      deleteActionFocused = await deleteAction
        .evaluate((element) => element === document.activeElement)
        .catch(() => false);
      await pageA.keyboard.press('Tab');
      detailsActionTabCount += 1;
      closeActionFocused = await closeAction
        .evaluate((element) => element === document.activeElement)
        .catch(() => false);
      escapeAttempted = true;
      await pageA.keyboard.press('Escape');
    }
    const escapeClosedDialog = await keyboardDetails
      .waitFor({ state: 'hidden', timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    let focusReturnedToEvent = false;
    try {
      await expect(keyboardEventButton).toBeFocused({ timeout: 5_000 });
      focusReturnedToEvent = true;
    } catch {
      focusReturnedToEvent = false;
    }
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
      editActionCountCapped: editControlObservation.countCapped,
      editActionVisibility: editControlObservation.visibility,
      editActionEnabled: editControlObservation.enabled,
      deleteActionCountCapped: deleteControlObservation.countCapped,
      deleteActionVisibility: deleteControlObservation.visibility,
      deleteActionEnabled: deleteControlObservation.enabled,
      closeActionCountCapped: closeControlObservation.countCapped,
      closeActionVisibility: closeControlObservation.visibility,
      closeActionEnabled: closeControlObservation.enabled,
      initialDetailsFocusTarget: initialDetailsFocus.activeTarget,
      keyboardFrameHasFocus: initialDetailsFocus.frameHasFocus,
      detailsTabFocusObservations,
      escapeAttempted,
    });

    activeG6Phase = 'g6-delete-and-refresh';
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
      .waitFor({ state: 'visible', timeout: 8_000 })
      .then(() => true)
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

function acceptancePrincipal(fixtureValue: Fixture):
  | {
      mode: PrincipalMode;
      userId: string;
      localpart: string;
      accessToken: string;
      openIdBody?: string;
    }
  | undefined {
  const sender = fixtureValue?.serviceSender;
  let userId: string;
  let accessToken: string;
  let openIdBody: string | undefined;
  if (fixtureValue?.principalMode === 'appservice') {
    const applicationServiceToken =
      process.env.MATRIX_APPLICATION_SERVICE_TOKEN;
    if (
      sender?.userId !== G6_SERVICE_USER_ID ||
      typeof applicationServiceToken !== 'string' ||
      applicationServiceToken.length === 0 ||
      applicationServiceToken.length > 4096
    ) {
      return undefined;
    }
    userId = G6_SERVICE_USER_ID;
    accessToken = applicationServiceToken;
    openIdBody = JSON.stringify({ user_id: userId });
  } else if (fixtureValue?.principalMode === 'bot-account') {
    const bot = fixtureValue.users?.bot;
    if (
      !bot ||
      !sender ||
      process.env.MATRIX_APPLICATION_SERVICE_TOKEN !== undefined ||
      typeof bot.userId !== 'string' ||
      !/^@([a-z0-9][a-z0-9-]{0,254}):localhost$/u.test(bot.userId) ||
      typeof bot.accessToken !== 'string' ||
      bot.accessToken.length === 0 ||
      bot.accessToken.length > 4096 ||
      sender.userId !== bot.userId ||
      sender.accessToken !== bot.accessToken
    ) {
      return undefined;
    }
    userId = bot.userId;
    accessToken = bot.accessToken;
    openIdBody = JSON.stringify({});
  } else {
    return undefined;
  }

  const match =
    fixtureValue.principalMode === 'bot-account'
      ? /^@([a-z0-9][a-z0-9-]{0,254}):localhost$/u.exec(userId)
      : undefined;
  if (fixtureValue.principalMode === 'bot-account' && !match) {
    return undefined;
  }
  return {
    mode: fixtureValue.principalMode,
    userId,
    localpart:
      fixtureValue.principalMode === 'appservice'
        ? G6_SERVICE_LOCALPART
        : (match?.[1] ?? ''),
    accessToken,
    ...(openIdBody === undefined ? {} : { openIdBody }),
  };
}

async function createG6CalDavClient(fixtureValue: Fixture): Promise<{
  status?: number;
  proofValid: boolean;
  client?: G6CalDavClient;
}> {
  const principal = acceptancePrincipal(fixtureValue);
  if (
    !principal ||
    fixtureValue.calendarId !== G6_RADICALE_COLLECTION ||
    new URL(fixtureValue.homeserverUrl).origin !== 'http://127.0.0.1:8008'
  ) {
    return { proofValid: false };
  }

  let openIdResponse: globalThis.Response;
  try {
    const openIdUrl = new URL(
      `/_matrix/client/v3/user/${encodeURIComponent(principal.userId)}/openid/request_token`,
      fixtureValue.homeserverUrl,
    );
    openIdResponse = await fetch(openIdUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${principal.accessToken}`,
        ...(principal.openIdBody === undefined
          ? {}
          : { 'Content-Type': 'application/json' }),
      },
      ...(principal.openIdBody === undefined
        ? {}
        : { body: principal.openIdBody }),
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
    `${principal.localpart}:matrix-openid:${delegatedCredential}`,
    'utf8',
  ).toString('base64');
  const collectionUrl = new URL(
    `${encodeURIComponent(principal.localpart)}/${encodeURIComponent(G6_RADICALE_COLLECTION)}/`,
    `${G6_RADICALE_ORIGIN}/`,
  );
  if (collectionUrl.origin !== G6_RADICALE_ORIGIN) {
    return { status, proofValid: false };
  }

  return {
    status,
    proofValid: true,
    client: { authorization, collectionUrl, localpart: principal.localpart },
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
  const collectionPrefix = `/${encodeURIComponent(client.localpart)}/${encodeURIComponent(G6_RADICALE_COLLECTION)}/`;
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
          return null;
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
          return null;
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
          return null;
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
        return null;
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

async function observeG6KeyboardControl(button: Locator): Promise<{
  countCapped: number;
  visibility: G6SidePanelControlVisibility;
  enabled: G6SidePanelControlEnabled;
}> {
  const count = await button.count().catch(() => 0);
  const [visible, enabled] = await Promise.all([
    count === 1 ? button.isVisible().catch(() => undefined) : undefined,
    count === 1 ? button.isEnabled().catch(() => undefined) : undefined,
  ]);
  return {
    countCapped: Math.min(count, 2),
    visibility:
      count === 0
        ? 'absent'
        : count > 1
          ? 'ambiguous'
          : visible === undefined
            ? 'unavailable'
            : visible
              ? 'visible'
              : 'hidden',
    enabled:
      count === 0
        ? 'absent'
        : count > 1
          ? 'ambiguous'
          : enabled === undefined
            ? 'unavailable'
            : enabled
              ? 'enabled'
              : 'disabled',
  };
}

async function observeG6KeyboardFocusTarget(
  frame: FrameLocator,
  controls: {
    edit: Locator;
    editCountCapped: number;
    delete: Locator;
    deleteCountCapped: number;
    close: Locator;
    closeCountCapped: number;
    dialogContent: Locator;
  },
): Promise<G6KeyboardTabFocusObservation> {
  let frameHasFocus: boolean;
  let activeElementAvailable: boolean;
  try {
    ({ frameHasFocus, activeElementAvailable } = await frame
      .locator('body')
      .evaluate((body) => {
        const document = body.ownerDocument;
        return {
          frameHasFocus: document.hasFocus(),
          activeElementAvailable: document.activeElement !== null,
        };
      }));
  } catch {
    return { activeTarget: 'unavailable', frameHasFocus: false };
  }
  if (!frameHasFocus) return { activeTarget: 'outside', frameHasFocus };

  const targets: Array<{
    name: G6KeyboardFocusTarget;
    locator: Locator;
    countCapped: number;
  }> = [
    {
      name: 'edit',
      locator: controls.edit,
      countCapped: controls.editCountCapped,
    },
    {
      name: 'delete',
      locator: controls.delete,
      countCapped: controls.deleteCountCapped,
    },
    {
      name: 'close',
      locator: controls.close,
      countCapped: controls.closeCountCapped,
    },
  ];
  let ambiguousTarget = false;
  const focusState = async (locator: Locator, countCapped: number) => {
    if (countCapped > 1) {
      ambiguousTarget = true;
      return undefined;
    }
    if (countCapped === 0) return false;
    return locator
      .evaluate((element) => element.ownerDocument.activeElement === element)
      .catch(() => undefined);
  };
  const focused: Record<string, boolean | undefined> = {};
  for (const target of targets) {
    focused[target.name] = await focusState(target.locator, target.countCapped);
  }

  const dialogContentCount = await controls.dialogContent
    .count()
    .catch(() => 0);
  focused['dialog-content'] = await focusState(
    controls.dialogContent,
    Math.min(dialogContentCount, 2),
  );
  return {
    activeTarget: classifyG6KeyboardFocusTarget({
      frameHasFocus,
      activeElementAvailable,
      editFocused: focused.edit,
      deleteFocused: focused.delete,
      closeFocused: focused.close,
      dialogContentFocused: focused['dialog-content'],
      ambiguousTarget,
    }),
    frameHasFocus,
  };
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
  markerPlan: ReminderPlan,
): Promise<number> {
  activePhase = 'reminder-event-create-dialog';
  record(activePhase, 'started');
  await frame
    .getByRole('button', { name: 'Create event', exact: true })
    .click();
  const editor = frame.getByRole('dialog').last();
  await expect(editor).toBeVisible({ timeout: 15_000 });

  const dueAt =
    Math.ceil((Date.now() + REMINDER_START_LEAD_MS) / 60_000) * 60_000;
  const startAt = markerPlan.allDay ? dueAt : dueAt + REMINDER_ALARM_OFFSET_MS;
  const startValue = localDateTimeInput(startAt, REMINDER_ALL_DAY_TIMEZONE);
  const endValue = localDateTimeInput(
    startAt + 60 * 60_000,
    REMINDER_ALL_DAY_TIMEZONE,
  );
  const eventStartDate = markerPlan.allDay
    ? addCalendarDays(startValue.slice(0, 10), 1)
    : undefined;
  const eventEndDate = eventStartDate
    ? addCalendarDays(eventStartDate, 1)
    : undefined;
  const completePlan: ReminderPlan = {
    ...markerPlan,
    ...(eventStartDate ? { allDayEventDate: eventStartDate } : {}),
  };
  await editor.getByRole('combobox', { name: 'Calendar' }).selectOption({
    value: `matrix-calendar-target://room/${encodeURIComponent(fixture.calendarId)}`,
  });
  await editor.getByRole('textbox', { name: 'Title' }).fill(title);
  const alarmToggle = editor.getByLabel('CalDAV reminder');
  if (await alarmToggle.isChecked()) await alarmToggle.uncheck();
  if (markerPlan.allDay) {
    await editor.getByLabel('All day').check();
    await editor.getByRole('textbox', { name: 'Start' }).fill(eventStartDate!);
    await editor.getByRole('textbox', { name: 'End' }).fill(eventEndDate!);
  } else {
    await editor.getByRole('textbox', { name: 'Start' }).fill(startValue);
    await editor.getByRole('textbox', { name: 'End' }).fill(endValue);
    await editor
      .getByRole('textbox', { name: 'Time zone' })
      .fill(REMINDER_ALL_DAY_TIMEZONE);
  }
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
  const alarmObservation: ReminderAlarmUiObservation = {
    alarmUiStep: 'event-row-visible',
    alarmUiPatchStatus: 0,
    alarmUiRelativeAlarmReadback: false,
    alarmUiAlarmToggleReadback: false,
    alarmUiRelativeTriggerReadback: false,
    alarmUiOffsetReadback: false,
    alarmUiEditorClosed: false,
    alarmUiDetailsClosed: false,
  };
  const alarmSaved = await addCalDavAlarmFromReminderSettings(
    frame,
    page,
    title,
    alarmObservation,
  );
  const alarmReadback =
    alarmSaved && (await readBackRelativeAlarm(frame, title, alarmObservation));
  if (!alarmReadback) {
    record(
      activePhase,
      'failed',
      alarmObservation.alarmUiPatchStatus || undefined,
      1,
      {
        ...alarmObservation,
        relativeAlarmReadback: false,
      },
    );
    activeReminderFailureRecorded = true;
    throw new Error('The relative alarm did not reload from the event');
  }
  alarmObservation.alarmUiStep = 'complete';
  alarmObservation.alarmUiRelativeAlarmReadback = true;
  record(activePhase, 'passed', alarmObservation.alarmUiPatchStatus, 1, {
    ...alarmObservation,
    relativeAlarmReadback: true,
  });

  activePhase = 'reminder-room-configuration-enabled';
  const reminderConfiguration = await setRoomReminder(
    frame,
    page,
    title,
    completePlan,
  );

  const titles = readReminderEventTitles();
  titles.push(title);
  writeReminderEventTitles(titles);
  return markerPlan.allDay ? reminderConfiguration.dueAt! : dueAt;
}

function addCalendarDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return [
    String(next.getUTCFullYear()).padStart(4, '0'),
    String(next.getUTCMonth() + 1).padStart(2, '0'),
    String(next.getUTCDate()).padStart(2, '0'),
  ].join('-');
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
  observation: Pick<
    ReminderAlarmUiObservation,
    | 'alarmUiStep'
    | 'alarmUiRelativeAlarmReadback'
    | 'alarmUiAlarmToggleReadback'
    | 'alarmUiRelativeTriggerReadback'
    | 'alarmUiOffsetReadback'
    | 'alarmUiEditorClosed'
    | 'alarmUiDetailsClosed'
  > = {
    alarmUiStep: 'event-row-visible',
    alarmUiRelativeAlarmReadback: false,
    alarmUiAlarmToggleReadback: false,
    alarmUiRelativeTriggerReadback: false,
    alarmUiOffsetReadback: false,
    alarmUiEditorClosed: false,
    alarmUiDetailsClosed: false,
  },
): Promise<boolean> {
  try {
    observation.alarmUiRelativeAlarmReadback = false;
    observation.alarmUiAlarmToggleReadback = false;
    observation.alarmUiRelativeTriggerReadback = false;
    observation.alarmUiOffsetReadback = false;
    observation.alarmUiEditorClosed = false;
    observation.alarmUiDetailsClosed = false;
    const row = frame.getByRole('listitem', { name: title });
    observation.alarmUiStep = 'event-row-visible';
    await expect(row).toBeVisible();
    observation.alarmUiStep = 'event-open';
    await row.click();
    const details = frame.getByRole('dialog').last();
    observation.alarmUiStep = 'details-ready';
    await expect(
      details.getByRole('button', { name: 'Edit', exact: true }),
    ).toBeVisible();
    observation.alarmUiStep = 'readback-editor-open';
    await details.getByRole('button', { name: 'Edit', exact: true }).click();
    const editor = frame.getByRole('dialog', {
      name: 'Edit event',
      exact: true,
    });
    observation.alarmUiStep = 'readback-editor-ready';
    await expect(editor.getByRole('textbox', { name: 'Title' })).toBeVisible();
    observation.alarmUiStep = 'readback-alarm-toggle';
    observation.alarmUiAlarmToggleReadback = await editor
      .getByLabel('CalDAV reminder')
      .isChecked();
    observation.alarmUiStep = 'readback-relative-option';
    observation.alarmUiRelativeTriggerReadback = await editor
      .getByRole('radio', { name: 'Before the event' })
      .isChecked();
    observation.alarmUiStep = 'readback-offset';
    observation.alarmUiOffsetReadback =
      (await editor
        .getByRole('spinbutton', { name: 'Minutes before' })
        .inputValue()) === '1';
    observation.alarmUiStep = 'readback-editor-cancelled';
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
    observation.alarmUiStep = 'readback-editor-hidden';
    await expect(editor).toBeHidden({ timeout: 20_000 });
    observation.alarmUiEditorClosed = true;
    const parentDetails = frame.getByRole('dialog').last();
    observation.alarmUiStep = 'details-ready-after-save';
    await expect(parentDetails).toBeVisible();
    observation.alarmUiStep = 'readback-details-hidden';
    await parentDetails
      .getByRole('button', { name: 'Close', exact: true })
      .click();
    await expect(parentDetails).toBeHidden({ timeout: 20_000 });
    observation.alarmUiDetailsClosed = true;
    observation.alarmUiRelativeAlarmReadback =
      observation.alarmUiAlarmToggleReadback &&
      observation.alarmUiRelativeTriggerReadback &&
      observation.alarmUiOffsetReadback;
    return observation.alarmUiRelativeAlarmReadback;
  } catch {
    return false;
  }
}

async function addCalDavAlarmFromReminderSettings(
  frame: FrameLocator,
  page: Page,
  title: string,
  observation: Pick<
    ReminderAlarmUiObservation,
    | 'alarmUiStep'
    | 'alarmUiPatchStatus'
    | 'alarmUiEditorClosed'
    | 'alarmUiDetailsClosed'
  >,
): Promise<boolean> {
  try {
    const row = frame.getByRole('listitem', { name: title });
    observation.alarmUiStep = 'event-row-visible';
    await expect(row).toBeVisible();
    observation.alarmUiStep = 'event-open';
    await row.click();
    const details = frame.getByRole('dialog').last();
    observation.alarmUiStep = 'details-ready';
    await expect(details).toBeVisible();
    observation.alarmUiStep = 'settings-open';
    await details
      .getByRole('button', { name: 'Reminder settings', exact: true })
      .click();
    const editCalDavButton = details.getByRole('button', {
      name: 'Edit CalDAV reminder',
      exact: true,
    });
    observation.alarmUiStep = 'edit-button-ready';
    await expect(editCalDavButton).toBeVisible({ timeout: 20_000 });
    await editCalDavButton.click();

    const editor = frame.getByRole('dialog', {
      name: 'Edit event',
      exact: true,
    });
    observation.alarmUiStep = 'editor-ready';
    await expect(editor).toBeVisible();
    const alarmToggle = editor.getByLabel('CalDAV reminder');
    observation.alarmUiStep = 'alarm-toggle-read';
    if (!(await alarmToggle.isChecked())) {
      observation.alarmUiStep = 'alarm-toggle-enabled';
      await alarmToggle.check();
    }
    observation.alarmUiStep = 'relative-option-selected';
    await editor.getByRole('radio', { name: 'Before the event' }).check();
    observation.alarmUiStep = 'offset-entered';
    await editor.getByRole('spinbutton', { name: 'Minutes before' }).fill('1');
    const saveResponse = page.waitForResponse(
      (response) => {
        const url = new URL(response.url());
        return (
          url.origin === new URL(fixture.gatewayUrl).origin &&
          url.pathname === '/v1/calendar/events' &&
          response.request().method() === 'PATCH'
        );
      },
      { timeout: 30_000 },
    );
    observation.alarmUiStep = 'save-response-armed';
    await editor.getByRole('button', { name: 'Save', exact: true }).click();
    observation.alarmUiStep = 'save-clicked';
    const response = await saveResponse;
    observation.alarmUiPatchStatus = response.status();
    observation.alarmUiStep = 'patch-response-received';
    observation.alarmUiStep = 'editor-hidden';
    await expect(editor).toBeHidden({ timeout: 20_000 });
    observation.alarmUiEditorClosed = true;
    const parentDetails = frame.getByRole('dialog').last();
    observation.alarmUiStep = 'details-ready-after-save';
    await expect(parentDetails).toBeVisible();
    await parentDetails
      .getByRole('button', { name: 'Close', exact: true })
      .click();
    observation.alarmUiStep = 'details-hidden';
    await expect(parentDetails).toBeHidden({ timeout: 20_000 });
    observation.alarmUiDetailsClosed = true;
    return response.status() >= 200 && response.status() < 300;
  } catch {
    return false;
  }
}

async function setRoomReminder(
  frame: FrameLocator,
  page: Page,
  title: string,
  plan: ReminderPlan,
): Promise<{
  enabled: boolean;
  httpStatus: number | null;
  dueAt?: number;
}> {
  const row = frame.getByRole('listitem', { name: title });
  const details = frame.getByRole('dialog').last();
  const observation: ReminderConfigurationObservation = {
    reminderStep: 'event-details',
    reminderSettingsButtonCount: 0,
    reminderSettingsButtonVisible: false,
    reminderOptionsGetCount: 0,
    reminderOptionsGetStatus: 0,
    reminderConfigGetCount: 0,
    reminderConfigGetStatus: 0,
    recipientRosterGetCount: 0,
    recipientRosterHttpStatus: 0,
    recipientRosterCount: 0,
    recipientRosterShapeValid: false,
    recipientRosterTargetPresent: false,
    recipientRosterOutcome: 'unobserved',
    reminderDestinationControlCount: 0,
    recipientKind: 'unknown',
    recipientSelectionAttempted: false,
    recipientSelectionStep: 'destination-clicked',
    recipientOptionCount: 0,
    memberInputProbeInstalled: false,
    memberInputDomCount: 0,
    memberInputAriaExpanded: 'not-observed',
    memberInputControlsTokenCount: 0,
    memberInputControlsNodePresent: false,
    memberInputControlsListbox: false,
    memberListboxDomCount: 0,
    memberOptionDomCount: 0,
    memberListboxOwnAriaHidden: 'not-observed',
    memberListboxAncestorAriaHidden: 'not-observed',
    memberListboxOwnInert: 'not-observed',
    memberListboxAncestorInert: 'not-observed',
    memberListboxCssVisibility: 'not-observed',
    memberNoOptionsTextPresent: false,
    memberLoadErrorVisible: false,
    memberPickerObservationError: 'none',
    memberQueryMatchesTargetAfterFill: false,
    memberQueryMatchesTargetAtOptionCount: false,
    memberInputFocusedBeforeFill: false,
    memberDocumentFocusedBeforeFill: false,
    memberInputFocusedAfterFill: false,
    memberDocumentFocusedAfterFill: false,
    memberInputEventMatchedTarget: false,
    memberInputBlurEventCount: 0,
    memberInputSameNodeAfterFill: false,
    memberListboxCount: 0,
    memberInputControlsUniqueListbox: false,
    memberOptionCount: 0,
    memberOptionsContainingTargetIdCount: 0,
    selectedMemberTagCount: 0,
    selectedMemberKeyboardFlow: false,
    reminderTargetMatches: false,
    allDayScheduleMatches: false,
    narrowSidePanelSafe: false,
    narrowViewportWithinRange: 'not-observed',
    narrowDialogWithinViewport: 'not-observed',
    narrowDialogContentsFit: 'not-observed',
    narrowDocumentContentsFit: 'not-observed',
    narrowViewportWidth: 'not-observed',
    narrowDialogWidth: 'not-observed',
    narrowDialogClientWidth: 'not-observed',
    narrowDialogScrollWidth: 'not-observed',
    narrowDocumentClientWidth: 'not-observed',
    narrowDocumentScrollWidth: 'not-observed',
    reminderPutCount: 0,
    reminderPutStatus: 0,
  };
  let effectivePlan = plan;
  let dueAt: number | undefined;
  let latestRecipientRosterRequest: Request | undefined;
  let latestRecipientRosterResponse: Response | undefined;
  let sampleMemberPickerDomState: (() => Promise<void>) | undefined;
  const noteMemberPickerObservationError = (
    error: Exclude<MemberPickerObservationError, 'none' | 'multiple'>,
  ) => {
    if (
      observation.memberPickerObservationError === 'none' ||
      observation.memberPickerObservationError === error
    ) {
      observation.memberPickerObservationError = error;
    } else {
      observation.memberPickerObservationError = 'multiple';
    }
  };
  const roomPath = `/v1/calendar/rooms/${fixture.teamRoomId}/reminders`;
  const gatewayOrigin = new URL(fixture.gatewayUrl).origin;
  const classifyRequest = (urlValue: string, method: string) => {
    try {
      const url = new URL(urlValue);
      if (url.origin !== gatewayOrigin) return undefined;
      const pathname = decodeURIComponent(url.pathname);
      if (method === 'GET' && pathname === `${roomPath}/recipients`) {
        return 'recipients' as const;
      }
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
    if (kind === 'recipients') {
      observation.recipientRosterGetCount = Math.min(
        observation.recipientRosterGetCount + 1,
        2,
      );
      latestRecipientRosterRequest = request;
      latestRecipientRosterResponse = undefined;
      observation.recipientRosterHttpStatus = 0;
      observation.recipientRosterCount = 0;
      observation.recipientRosterShapeValid = false;
      observation.recipientRosterTargetPresent = false;
      observation.recipientRosterOutcome = 'unobserved';
    } else if (kind === 'options') {
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
      try {
        const body: unknown = request.postDataJSON();
        const target =
          isRecord(body) && isRecord(body.target) ? body.target : undefined;
        if (target?.kind === 'room') {
          observation.reminderTargetMatches = plan.recipient === 'room';
        } else if (target?.kind === 'users' && Array.isArray(target.userIds)) {
          observation.reminderTargetMatches =
            plan.recipient === 'selected' &&
            target.userIds.length === 1 &&
            target.userIds[0] === fixture.users.memberB.userId;
        }
        const allDaySchedule = isRecord(body) ? body.allDaySchedule : undefined;
        if (effectivePlan.allDay) {
          observation.allDayScheduleMatches =
            Boolean(effectivePlan.allDaySchedule) &&
            isRecord(allDaySchedule) &&
            allDaySchedule.daysBefore ===
              effectivePlan.allDaySchedule?.daysBefore &&
            allDaySchedule.localTime ===
              effectivePlan.allDaySchedule?.localTime &&
            allDaySchedule.timezone === effectivePlan.allDaySchedule?.timezone;
        } else {
          observation.allDayScheduleMatches = allDaySchedule === null;
        }
      } catch {
        observation.reminderTargetMatches = false;
        observation.allDayScheduleMatches = false;
      }
    }
  };
  const onResponse = (response: Response) => {
    const kind = classifyRequest(response.url(), response.request().method());
    if (
      kind === 'recipients' &&
      response.request() === latestRecipientRosterRequest
    ) {
      observation.recipientRosterHttpStatus = response.status();
      latestRecipientRosterResponse = response;
    } else if (kind === 'options') {
      observation.reminderOptionsGetStatus = response.status();
    } else if (kind === 'config') {
      observation.reminderConfigGetStatus = response.status();
    } else if (kind === 'put') {
      observation.reminderPutStatus = response.status();
    }
  };
  const onRequestFailed = (request: Request) => {
    if (
      classifyRequest(request.url(), request.method()) === 'recipients' &&
      request === latestRecipientRosterRequest
    ) {
      observation.recipientRosterHttpStatus = 0;
      observation.recipientRosterCount = 0;
      observation.recipientRosterShapeValid = false;
      observation.recipientRosterTargetPresent = false;
      observation.recipientRosterOutcome = 'http_error';
    }
  };
  const sampleRecipientRosterResponse = async () => {
    const response = latestRecipientRosterResponse;
    if (!response) return;

    const status = response.status();
    observation.recipientRosterHttpStatus = status;
    if (status < 200 || status >= 300) {
      observation.recipientRosterCount = 0;
      observation.recipientRosterShapeValid = false;
      observation.recipientRosterTargetPresent = false;
      observation.recipientRosterOutcome = 'http_error';
      return;
    }

    try {
      const roster = summarizeReminderRecipientRoster(
        await response.json(),
        fixture.users.memberB.userId,
      );
      observation.recipientRosterCount = roster.recipientRosterCount;
      observation.recipientRosterShapeValid = roster.recipientRosterShapeValid;
      observation.recipientRosterTargetPresent =
        roster.recipientRosterTargetPresent;
      observation.recipientRosterOutcome = roster.recipientRosterOutcome;
    } catch {
      observation.recipientRosterCount = 0;
      observation.recipientRosterShapeValid = false;
      observation.recipientRosterTargetPresent = false;
      observation.recipientRosterOutcome = 'invalid_shape';
    }
  };
  const writeFailure = async () => {
    await sampleRecipientRosterResponse();
    await sampleMemberPickerDomState?.();
    const httpStatus =
      observation.reminderPutStatus ||
      observation.reminderOptionsGetStatus ||
      observation.reminderConfigGetStatus ||
      undefined;
    record(activePhase, 'failed', httpStatus, undefined, {
      ...observation,
      reminderEnabled: false,
    });
    activeReminderFailureRecorded = true;
  };

  page.on('request', onRequest);
  page.on('response', onResponse);
  page.on('requestfailed', onRequestFailed);
  try {
    await expect(row).toBeVisible();
    await row.click();
    await expect(details).toBeVisible();
    observation.reminderStep = 'settings-control';
    const settingsButton = details.getByRole('button', {
      name: 'Reminder settings',
      exact: true,
    });
    observation.reminderSettingsButtonCount = Math.min(
      await settingsButton.count(),
      2,
    );
    observation.reminderSettingsButtonVisible =
      observation.reminderSettingsButtonCount === 1 &&
      (await settingsButton.isVisible().catch(() => false));
    if (!observation.reminderSettingsButtonVisible) {
      throw new Error('Reminder settings control is unavailable');
    }

    observation.reminderStep = 'options-load';
    await settingsButton.click();
    const destination = details.getByRole('combobox', {
      name: 'Matrix destination',
    });
    await destination
      .waitFor({ state: 'visible', timeout: 20_000 })
      .catch(() => {});
    observation.reminderDestinationControlCount = Math.min(
      await destination.count(),
      2,
    );
    if (
      observation.reminderDestinationControlCount !== 1 ||
      observation.reminderOptionsGetCount === 0 ||
      observation.reminderConfigGetCount === 0 ||
      observation.reminderOptionsGetStatus < 200 ||
      observation.reminderOptionsGetStatus >= 300 ||
      observation.reminderConfigGetStatus < 200 ||
      observation.reminderConfigGetStatus >= 300
    ) {
      observation.reminderStep = 'destination-control';
      throw new Error('Matrix reminder destination control is unavailable');
    }

    const layout = await details.evaluate(
      (element, viewportBounds) => {
        const viewportWidth = document.documentElement.clientWidth;
        const dialogWidth = element.getBoundingClientRect().width;
        const dialogClientWidth = element.clientWidth;
        const dialogScrollWidth = element.scrollWidth;
        const documentClientWidth = document.documentElement.clientWidth;
        const documentScrollWidth = document.documentElement.scrollWidth;
        const viewportWithinRange =
          viewportWidth >= viewportBounds.minimum &&
          viewportWidth <= viewportBounds.maximum;
        const dialogWithinViewport = dialogWidth <= viewportWidth + 1;
        const dialogContentsFit = dialogScrollWidth <= dialogClientWidth + 1;
        const documentContentsFit = documentScrollWidth <= viewportWidth + 1;
        const safe =
          viewportWidth >= viewportBounds.minimum &&
          viewportWidth <= viewportBounds.maximum &&
          dialogWidth <= viewportWidth + 1 &&
          dialogScrollWidth <= dialogClientWidth + 1 &&
          documentScrollWidth <= viewportWidth + 1;
        // Keep raw dimensions for validation; only sanitizer output is rounded.
        const boundedDimension = (value: number): number | 'not-observed' =>
          Number.isFinite(value) && value >= 0 && value <= 100_000
            ? value
            : 'not-observed';

        return {
          safe,
          viewportWithinRange,
          dialogWithinViewport,
          dialogContentsFit,
          documentContentsFit,
          viewportWidth: boundedDimension(viewportWidth),
          dialogWidth: boundedDimension(dialogWidth),
          dialogClientWidth: boundedDimension(dialogClientWidth),
          dialogScrollWidth: boundedDimension(dialogScrollWidth),
          documentClientWidth: boundedDimension(documentClientWidth),
          documentScrollWidth: boundedDimension(documentScrollWidth),
        };
      },
      {
        minimum: MIN_REMINDER_LAYOUT_VIEWPORT_WIDTH,
        maximum: MAX_REMINDER_LAYOUT_VIEWPORT_WIDTH,
      },
    );
    observation.narrowSidePanelSafe = layout.safe;
    observation.narrowViewportWithinRange = layout.viewportWithinRange;
    observation.narrowDialogWithinViewport = layout.dialogWithinViewport;
    observation.narrowDialogContentsFit = layout.dialogContentsFit;
    observation.narrowDocumentContentsFit = layout.documentContentsFit;
    observation.narrowViewportWidth = layout.viewportWidth;
    observation.narrowDialogWidth = layout.dialogWidth;
    observation.narrowDialogClientWidth = layout.dialogClientWidth;
    observation.narrowDialogScrollWidth = layout.dialogScrollWidth;
    observation.narrowDocumentClientWidth = layout.documentClientWidth;
    observation.narrowDocumentScrollWidth = layout.documentScrollWidth;

    observation.reminderStep = 'recipient-selection';
    observation.recipientSelectionAttempted = true;
    observation.recipientKind = plan.recipient;
    observation.recipientSelectionStep = 'destination-clicked';
    await destination.click();
    // MUI renders Select and Autocomplete listboxes in a frame-level portal,
    // outside the event details dialog subtree.
    const destinationListbox = frame
      .getByRole('listbox')
      .filter({ visible: true });
    observation.recipientSelectionStep = 'destination-listbox-ready';
    await expect(destinationListbox).toHaveCount(1, { timeout: 15_000 });
    const destinationListboxId = await destinationListbox.evaluateAll(
      (listboxes) =>
        listboxes.length === 1 && listboxes[0].id.length > 0
          ? listboxes[0].id
          : undefined,
    );
    expect(destinationListboxId).toBeTruthy();
    const selectedDestinationListbox = frame.locator(
      `[id=${JSON.stringify(destinationListboxId)}]`,
    );
    const destinationOption = destinationListbox.getByRole('option', {
      name: plan.recipient === 'room' ? 'Whole room' : 'Selected people',
      exact: true,
    });
    observation.recipientOptionCount = Math.min(
      await destinationOption.count(),
      2,
    );
    observation.recipientSelectionStep = 'destination-option-selected';
    await destinationOption.click();
    observation.recipientSelectionStep = 'destination-menu-close-wait';
    await selectedDestinationListbox.waitFor({
      state: 'hidden',
      timeout: 15_000,
    });
    observation.recipientSelectionStep = 'destination-menu-closed';
    let selectedMemberKeyboardFlow = false;
    if (plan.recipient === 'selected') {
      const memberInput = details.getByRole('combobox', {
        name: 'Selected people',
      });
      const memberListbox = frame
        .getByRole('listbox')
        .filter({ visible: true });
      sampleMemberPickerDomState = async () => {
        try {
          const sample = await memberInput.evaluateAll((inputs) => {
            const capCount = (count: number) => Math.min(count, 2);
            if (inputs.length !== 1) {
              return {
                observationError:
                  inputs.length === 0
                    ? ('input-missing' as const)
                    : ('input-not-unique' as const),
                inputDomCount: capCount(inputs.length),
                inputAriaExpanded: 'not-observed' as const,
                controlsTokenCount: 0,
                controlsNodePresent: false,
                controlsListbox: false,
                listboxDomCount: 0,
                optionDomCount: 0,
                listboxOwnAriaHidden: 'not-observed' as const,
                listboxAncestorAriaHidden: 'not-observed' as const,
                listboxOwnInert: 'not-observed' as const,
                listboxAncestorInert: 'not-observed' as const,
                listboxCssVisibility: 'not-observed' as const,
                noOptionsTextPresent: false,
                loadErrorVisible: false,
              };
            }

            const input = inputs[0];
            const doc = input.ownerDocument;
            const mapAriaHidden = (
              element: Element | null,
            ): MemberAriaHiddenState => {
              if (!element) return 'not-observed';
              const value = element.getAttribute('aria-hidden');
              if (value === null) return 'absent';
              if (value === 'true' || value === 'false') return value;
              return 'other';
            };
            const ancestorAriaHidden = (
              element: Element | null,
            ): MemberAriaHiddenState => {
              if (!element) return 'not-observed';
              let ancestor = element.parentElement;
              let depth = 0;
              let foundOther = false;
              for (; ancestor && depth < 32; depth += 1) {
                const value = ancestor.getAttribute('aria-hidden');
                if (value === 'true') return 'true';
                if (value !== null && value !== 'false') foundOther = true;
                ancestor = ancestor.parentElement;
              }
              if (ancestor) return 'other';
              return foundOther ? 'other' : 'false';
            };
            const inertState = (element: Element | null): MemberInertState => {
              if (!element) return 'not-observed';
              const isInert =
                element.hasAttribute('inert') ||
                ('inert' in element &&
                  Boolean(
                    (element as HTMLElement & { inert?: boolean }).inert,
                  ));
              return isInert ? 'true' : 'false';
            };
            const ancestorInert = (
              element: Element | null,
            ): MemberInertState => {
              if (!element) return 'not-observed';
              let ancestor = element.parentElement;
              let depth = 0;
              for (; ancestor && depth < 32; depth += 1) {
                if (
                  ancestor.hasAttribute('inert') ||
                  ('inert' in ancestor &&
                    Boolean(
                      (ancestor as HTMLElement & { inert?: boolean }).inert,
                    ))
                ) {
                  return 'true';
                }
                ancestor = ancestor.parentElement;
              }
              return ancestor ? 'not-observed' : 'false';
            };
            const cssVisibility = (
              element: Element | null,
            ): MemberCssVisibility => {
              if (!element) return 'not-observed';
              if (!doc.defaultView) return 'unknown';
              let current: Element | null = element;
              let depth = 0;
              for (; current && depth < 32; depth += 1) {
                const style = doc.defaultView.getComputedStyle(current);
                if (
                  current.hasAttribute('hidden') ||
                  style.display === 'none' ||
                  style.visibility === 'hidden' ||
                  style.visibility === 'collapse' ||
                  style.opacity === '0'
                ) {
                  return 'hidden';
                }
                current = current.parentElement;
              }
              return current ? 'unknown' : 'visible';
            };
            const controls =
              input
                .getAttribute('aria-controls')
                ?.trim()
                .split(/\s+/u)
                .filter(Boolean) ?? [];
            const controlledNode =
              controls.length === 1 ? doc.getElementById(controls[0]) : null;
            const listboxes = Array.from(
              doc.querySelectorAll('[role="listbox"]'),
            );
            const alertNodes = Array.from(
              doc.querySelectorAll('[role="alert"]'),
            );
            const loadErrorVisible = alertNodes.some(
              (alert) =>
                /could not load joined room members/iu.test(
                  alert.textContent ?? '',
                ) && cssVisibility(alert) === 'visible',
            );
            const controlledText = controlledNode?.textContent
              ?.replace(/\s+/gu, ' ')
              .trim();
            const expanded = input.getAttribute('aria-expanded');

            return {
              observationError: 'none' as const,
              inputDomCount: 1,
              inputAriaExpanded: (expanded === null
                ? 'absent'
                : expanded === 'true' || expanded === 'false'
                  ? expanded
                  : 'other') as MemberInputExpandedState,
              controlsTokenCount: capCount(controls.length),
              controlsNodePresent: controlledNode !== null,
              controlsListbox:
                controlledNode?.getAttribute('role') === 'listbox',
              listboxDomCount: capCount(listboxes.length),
              optionDomCount: capCount(
                controlledNode?.querySelectorAll('[role="option"]').length ?? 0,
              ),
              listboxOwnAriaHidden: mapAriaHidden(controlledNode),
              listboxAncestorAriaHidden: ancestorAriaHidden(controlledNode),
              listboxOwnInert: inertState(controlledNode),
              listboxAncestorInert: ancestorInert(controlledNode),
              listboxCssVisibility: cssVisibility(controlledNode),
              noOptionsTextPresent: Boolean(
                controlledText &&
                /^(?:no options(?: available)?|no matching members)$/iu.test(
                  controlledText,
                ),
              ),
              loadErrorVisible,
            };
          });

          observation.memberInputDomCount = sample.inputDomCount;
          observation.memberInputAriaExpanded = sample.inputAriaExpanded;
          observation.memberInputControlsTokenCount = sample.controlsTokenCount;
          observation.memberInputControlsNodePresent =
            sample.controlsNodePresent;
          observation.memberInputControlsListbox = sample.controlsListbox;
          observation.memberListboxDomCount = sample.listboxDomCount;
          observation.memberOptionDomCount = sample.optionDomCount;
          observation.memberListboxOwnAriaHidden = sample.listboxOwnAriaHidden;
          observation.memberListboxAncestorAriaHidden =
            sample.listboxAncestorAriaHidden;
          observation.memberListboxOwnInert = sample.listboxOwnInert;
          observation.memberListboxAncestorInert = sample.listboxAncestorInert;
          observation.memberListboxCssVisibility = sample.listboxCssVisibility;
          observation.memberNoOptionsTextPresent = sample.noOptionsTextPresent;
          observation.memberLoadErrorVisible = sample.loadErrorVisible;
          if (sample.observationError !== 'none') {
            noteMemberPickerObservationError(sample.observationError);
          }
        } catch {
          noteMemberPickerObservationError('dom-sample');
        }
      };
      const measureMemberInputListboxAssociation = async () => {
        let controls: string | null;
        try {
          controls = await memberInput.evaluateAll((inputs) =>
            inputs.length === 1
              ? inputs[0].getAttribute('aria-controls')
              : null,
          );
        } catch {
          noteMemberPickerObservationError('input-association');
          return false;
        }
        let controlledIds: string[];
        try {
          controlledIds = await memberListbox.evaluateAll((listboxes) =>
            listboxes.map((listbox) => listbox.id),
          );
        } catch {
          noteMemberPickerObservationError('listbox-association');
          return false;
        }
        const tokens = controls?.trim().split(/\s+/u) ?? [];
        return (
          tokens.length === 1 &&
          tokens[0].length > 0 &&
          controlledIds.length === 1 &&
          controlledIds[0] === tokens[0]
        );
      };
      const expectedMemberUserId = fixture.users.memberB.userId;
      const memberInputProbeKey = '__calendarRoomReminderInputProbe';
      observation.recipientSelectionStep = 'member-input-probe-install';
      const beforeFill = await memberInput
        .evaluateAll(
          (inputs, { expectedUserId, probeKey }) => {
            if (inputs.length !== 1) return undefined;
            const input = inputs[0] as HTMLInputElement;
            type InputProbe = {
              input: HTMLInputElement;
              matchedTargetValue: boolean;
              blurEventCount: number;
              onInput: () => void;
              onBlur: () => void;
            };
            const probe: InputProbe = {
              input,
              matchedTargetValue: false,
              blurEventCount: 0,
              onInput: () => undefined,
              onBlur: () => undefined,
            };
            probe.onInput = () => {
              if (input.value === expectedUserId) {
                probe.matchedTargetValue = true;
              }
            };
            probe.onBlur = () => {
              probe.blurEventCount = Math.min(probe.blurEventCount + 1, 2);
            };
            input.addEventListener('input', probe.onInput, true);
            input.addEventListener('blur', probe.onBlur, true);
            (window as unknown as Record<string, unknown>)[probeKey] = probe;
            return {
              inputFocused: document.activeElement === input,
              documentFocused: document.hasFocus(),
            };
          },
          {
            expectedUserId: expectedMemberUserId,
            probeKey: memberInputProbeKey,
          },
        )
        .catch(() => undefined);
      observation.memberInputProbeInstalled = beforeFill !== undefined;
      if (!beforeFill) {
        noteMemberPickerObservationError('input-probe-install');
      }
      if (beforeFill) {
        observation.memberInputFocusedBeforeFill = beforeFill.inputFocused;
        observation.memberDocumentFocusedBeforeFill =
          beforeFill.documentFocused;
      }

      try {
        observation.recipientSelectionStep = 'member-input-clicked';
        await memberInput.click({ timeout: 15_000 });
        observation.recipientSelectionStep = 'member-query-entered';
        await memberInput.fill(expectedMemberUserId);
        await expect(memberInput).toHaveValue(expectedMemberUserId, {
          timeout: 15_000,
        });
        observation.recipientSelectionStep = 'member-query-settled';
      } finally {
        const afterFill = await memberInput
          .evaluateAll(
            (inputs, { expectedUserId, probeKey }) => {
              type InputProbe = {
                input: HTMLInputElement;
                matchedTargetValue: boolean;
                blurEventCount: number;
                onInput: () => void;
                onBlur: () => void;
              };
              const probe = (window as unknown as Record<string, unknown>)[
                probeKey
              ] as InputProbe | undefined;
              const input = inputs.length === 1 ? inputs[0] : undefined;
              const result = {
                queryMatchesTarget:
                  input instanceof HTMLInputElement &&
                  input.value === expectedUserId,
                inputFocused:
                  input instanceof HTMLInputElement &&
                  document.activeElement === input,
                documentFocused: document.hasFocus(),
                inputEventMatchedTarget: probe?.matchedTargetValue ?? false,
                blurEventCount: Math.min(probe?.blurEventCount ?? 0, 2),
                sameInputNode: Boolean(
                  input instanceof HTMLInputElement &&
                  probe &&
                  input === probe.input,
                ),
              };
              if (probe) {
                probe.input.removeEventListener('input', probe.onInput, true);
                probe.input.removeEventListener('blur', probe.onBlur, true);
                delete (window as unknown as Record<string, unknown>)[probeKey];
              }
              return result;
            },
            {
              expectedUserId: expectedMemberUserId,
              probeKey: memberInputProbeKey,
            },
          )
          .catch(() => undefined);
        if (!afterFill) {
          noteMemberPickerObservationError('input-probe-read');
        }
        if (afterFill) {
          observation.memberQueryMatchesTargetAfterFill =
            afterFill.queryMatchesTarget;
          observation.memberInputFocusedAfterFill = afterFill.inputFocused;
          observation.memberDocumentFocusedAfterFill =
            afterFill.documentFocused;
          observation.memberInputEventMatchedTarget =
            afterFill.inputEventMatchedTarget;
          observation.memberInputBlurEventCount = afterFill.blurEventCount;
          observation.memberInputSameNodeAfterFill = afterFill.sameInputNode;
        }
      }
      await sampleMemberPickerDomState?.();
      observation.recipientSelectionStep = 'member-listbox-ready';
      try {
        observation.memberListboxCount = Math.min(
          await memberListbox.count(),
          2,
        );
      } catch {
        noteMemberPickerObservationError('listbox-count');
        throw new Error('Member listbox observation failed');
      }
      try {
        await expect
          .poll(
            async () => {
              const associated = await measureMemberInputListboxAssociation();
              observation.memberInputControlsUniqueListbox = associated;
              return associated;
            },
            { timeout: 15_000 },
          )
          .toBe(true);
        await expect(memberListbox).toHaveCount(1, { timeout: 15_000 });
      } finally {
        observation.memberListboxCount = await memberListbox
          .count()
          .then((count) => Math.min(count, 2))
          .catch(() => {
            noteMemberPickerObservationError('listbox-final-count');
            return observation.memberListboxCount;
          });
        observation.memberInputControlsUniqueListbox =
          await measureMemberInputListboxAssociation().catch(() => {
            noteMemberPickerObservationError('listbox-association');
            return false;
          });
      }
      expect(observation.memberInputControlsUniqueListbox).toBe(true);
      const memberOptions = memberListbox.getByRole('option');
      const memberOption = memberOptions.first();
      observation.recipientSelectionStep = 'member-option-ready';
      await memberOption.waitFor({ state: 'visible', timeout: 15_000 });
      observation.memberQueryMatchesTargetAtOptionCount =
        (await memberInput.inputValue()) === fixture.users.memberB.userId;
      observation.memberOptionCount = Math.min(await memberOptions.count(), 2);
      observation.memberOptionsContainingTargetIdCount = Math.min(
        await memberOptions.evaluateAll(
          (options, expectedId) =>
            options.filter((option) => option.textContent?.includes(expectedId))
              .length,
          fixture.users.memberB.userId,
        ),
        2,
      );
      observation.recipientSelectionStep = 'member-option-count-checked';
      await expect(memberOptions).toHaveCount(1);
      observation.recipientSelectionStep = 'member-arrow-down';
      await memberInput.press('ArrowDown');
      observation.recipientSelectionStep = 'member-enter';
      await memberInput.press('Enter');
      // Enter closes the selected option popup. A second Escape bubbles to the
      // owning Dialog and closes the whole reminder form.
      await expect(memberListbox).toHaveCount(0, { timeout: 15_000 });
      observation.recipientSelectionStep = 'member-keyboard-closed';
      observation.selectedMemberTagCount = Math.min(
        await details.locator('.MuiAutocomplete-tag').count(),
        2,
      );
      selectedMemberKeyboardFlow = observation.selectedMemberTagCount === 1;
      observation.selectedMemberKeyboardFlow = selectedMemberKeyboardFlow;
      expect(selectedMemberKeyboardFlow).toBe(true);
    }
    observation.recipientSelectionStep = 'complete';

    if (plan.allDay && plan.allDayEventDate) {
      dueAt =
        Math.ceil((Date.now() + REMINDER_START_LEAD_MS) / 60_000) * 60_000;
      const scheduleValue = localDateTimeInput(
        dueAt,
        REMINDER_ALL_DAY_TIMEZONE,
      );
      const schedule = {
        daysBefore: 1,
        localTime: scheduleValue.slice(11, 16),
        timezone: REMINDER_ALL_DAY_TIMEZONE,
      };
      if (
        addCalendarDays(plan.allDayEventDate, -schedule.daysBefore) !==
        scheduleValue.slice(0, 10)
      ) {
        throw new Error('All-day reminder schedule date is no longer future');
      }
      effectivePlan = { ...plan, allDaySchedule: schedule };
      await details
        .getByRole('spinbutton', { name: 'Days before event' })
        .fill(String(schedule.daysBefore));
      await details.getByLabel('Local time').fill(schedule.localTime);
      await details
        .getByRole('textbox', { name: 'Time zone (IANA)' })
        .fill(schedule.timezone);
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
    await details
      .getByRole('button', { name: 'Save Matrix destination', exact: true })
      .click();
    const response = await putResponse;
    if (response) observation.reminderPutStatus = response.status();
    if (
      observation.reminderPutCount !== 1 ||
      observation.reminderPutStatus < 200 ||
      observation.reminderPutStatus >= 300 ||
      !observation.reminderTargetMatches ||
      !observation.allDayScheduleMatches ||
      (plan.recipient === 'selected' && !selectedMemberKeyboardFlow)
    ) {
      throw new Error('Matrix reminder configuration did not match its target');
    }
    if (plan.recipient === 'selected') {
      observation.reminderStep = 'post-put-layout';
      if (!observation.narrowSidePanelSafe) {
        throw new Error('Selected-recipient layout safety check failed');
      }
      observation.reminderStep = 'put-response';
    }

    await details
      .getByRole('button', { name: 'Close reminder settings', exact: true })
      .click();
    await settingsButton.click();
    await destination.waitFor({ state: 'visible', timeout: 20_000 });
    const savedDestination = (await destination.innerText()).trim();
    const expectedDestination =
      plan.recipient === 'room' ? 'Whole room' : 'Selected people';
    const savedTargetMatches =
      savedDestination === expectedDestination &&
      (await details
        .getByText(
          plan.recipient === 'room'
            ? 'Matrix pings the whole room.'
            : 'Matrix pings the selected people.',
          { exact: true },
        )
        .isVisible()
        .catch(() => false));
    const savedScheduleMatches = effectivePlan.allDay
      ? (await details
          .getByRole('spinbutton', { name: 'Days before event' })
          .inputValue()) === String(effectivePlan.allDaySchedule?.daysBefore) &&
        (await details.getByLabel('Local time').inputValue()) ===
          effectivePlan.allDaySchedule?.localTime &&
        (await details
          .getByRole('textbox', { name: 'Time zone (IANA)' })
          .inputValue()) === effectivePlan.allDaySchedule?.timezone
      : true;
    observation.reminderTargetMatches &&= savedTargetMatches;
    observation.allDayScheduleMatches &&= savedScheduleMatches;
    if (!savedTargetMatches || !savedScheduleMatches) {
      throw new Error('Saved Matrix reminder settings did not reload');
    }

    await details
      .getByRole('button', { name: 'Close reminder settings', exact: true })
      .click();
    await details.getByRole('button', { name: 'Close', exact: true }).click();
    observation.reminderStep = 'complete';
    await sampleRecipientRosterResponse();
    record(activePhase, 'passed', observation.reminderPutStatus, 1, {
      ...observation,
      reminderEnabled: true,
    });
    return {
      enabled: true,
      httpStatus: observation.reminderPutStatus,
      ...(dueAt === undefined ? {} : { dueAt }),
    };
  } catch {
    if (!activeReminderFailureRecorded) await writeFailure();
    throw new Error('Room reminder configuration could not be confirmed');
  } finally {
    page.off('request', onRequest);
    page.off('response', onResponse);
    page.off('requestfailed', onRequestFailed);
  }
}

async function readBackReminderMarkers(
  frame: FrameLocator,
  titles: readonly string[],
): Promise<{
  count: number;
  relativeAlarmReadback: boolean;
  reminderEnabled: boolean;
  targetSettingsReadback: boolean;
  allDayScheduleReadback: boolean;
}> {
  let relativeAlarmReadback = true;
  let reminderEnabled = true;
  let targetSettingsReadback = true;
  let allDayScheduleReadback = true;
  for (const [index, title] of titles.entries()) {
    const plan = reminderPlanForMarkerIndex(index);
    relativeAlarmReadback =
      (await readBackRelativeAlarm(frame, title)) && relativeAlarmReadback;
    const settings = await readBackMatrixReminder(frame, title, plan);
    reminderEnabled = settings.enabled && reminderEnabled;
    targetSettingsReadback = settings.targetMatches && targetSettingsReadback;
    allDayScheduleReadback =
      settings.allDayScheduleMatches && allDayScheduleReadback;
  }
  return {
    count: titles.length,
    relativeAlarmReadback,
    reminderEnabled,
    targetSettingsReadback,
    allDayScheduleReadback,
  };
}

async function readBackMatrixReminder(
  frame: FrameLocator,
  title: string,
  plan: ReminderPlan,
): Promise<{
  enabled: boolean;
  targetMatches: boolean;
  allDayScheduleMatches: boolean;
}> {
  const row = frame.getByRole('listitem', { name: title });
  await expect(row).toBeVisible();
  await row.click();
  const details = frame.getByRole('dialog').last();
  await expect(details).toBeVisible();
  await details
    .getByRole('button', { name: 'Reminder settings', exact: true })
    .click();
  const destination = details.getByRole('combobox', {
    name: 'Matrix destination',
  });
  const available = await destination
    .waitFor({ state: 'visible', timeout: 20_000 })
    .then(() => true)
    .catch(() => false);
  if (!available) {
    await details.getByRole('button', { name: 'Close', exact: true }).click();
    return {
      enabled: false,
      targetMatches: false,
      allDayScheduleMatches: !plan.allDay,
    };
  }
  const destinationLabel = (await destination.innerText()).trim();
  const expectedDestination =
    plan.recipient === 'room' ? 'Whole room' : 'Selected people';
  const targetMatches = destinationLabel === expectedDestination;
  const savedState = await details
    .getByText(
      plan.recipient === 'room'
        ? 'Matrix pings the whole room.'
        : 'Matrix pings the selected people.',
      { exact: true },
    )
    .isVisible()
    .catch(() => false);
  const allDayScheduleMatches = plan.allDay
    ? (await details
        .getByRole('spinbutton', { name: 'Days before event' })
        .inputValue()) === '1' &&
      /^\d{2}:\d{2}$/u.test(
        await details.getByLabel('Local time').inputValue(),
      ) &&
      (await details
        .getByRole('textbox', { name: 'Time zone (IANA)' })
        .inputValue()) === REMINDER_ALL_DAY_TIMEZONE
    : true;
  await details
    .getByRole('button', { name: 'Close reminder settings', exact: true })
    .click();
  await details.getByRole('button', { name: 'Close', exact: true }).click();
  return {
    enabled: targetMatches && savedState,
    targetMatches: targetMatches && savedState,
    allDayScheduleMatches,
  };
}

async function inspectReminderTimeline(
  titles: readonly string[],
): Promise<ReminderTimelineSnapshot> {
  const empty: ReminderTimelineSnapshot = {
    httpStatus: null,
    complete: false,
    markerCounts: titles.map(() => 0),
    markerTargetsMatch: titles.map(() => false),
    markerRoomMentions: titles.map(() => false),
    markerSelectedMemberMentions: titles.map(() => false),
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
  const markerTargetsMatch: boolean[] = [];
  const markerRoomMentions: boolean[] = [];
  const markerSelectedMemberMentions: boolean[] = [];
  const markerTimestamps: Array<number | null> = [];
  for (const [index, title] of titles.entries()) {
    const matching = events.filter((event) => {
      const content = isRecord(event.content) ? event.content : undefined;
      return (
        event.type === 'm.room.message' &&
        content?.msgtype === 'm.text' &&
        content.body === `Reminder: ${title}`
      );
    });
    markerCounts.push(Math.min(matching.length, 2));
    const serviceEvent =
      matching.length === 1 &&
      matching[0].sender === fixture.serviceSender.userId;
    const content =
      serviceEvent && isRecord(matching[0].content)
        ? matching[0].content
        : undefined;
    const mentions =
      content && isRecord(content['m.mentions'])
        ? content['m.mentions']
        : undefined;
    const userIds = mentions?.user_ids;
    const plan = reminderPlanForMarkerIndex(index);
    const roomMention =
      serviceEvent &&
      mentions?.room === true &&
      (!Object.hasOwn(mentions, 'user_ids') ||
        (Array.isArray(userIds) && userIds.length === 0));
    const selectedMemberMention =
      serviceEvent &&
      mentions !== undefined &&
      (!Object.hasOwn(mentions, 'room') || mentions.room === false) &&
      Array.isArray(userIds) &&
      userIds.length === 1 &&
      userIds[0] === fixture.users.memberB.userId;
    markerRoomMentions.push(roomMention);
    markerSelectedMemberMentions.push(selectedMemberMention);
    markerTargetsMatch.push(
      plan.recipient === 'room' ? roomMention : selectedMemberMention,
    );
    const timestamp = serviceEvent ? matching[0].origin_server_ts : undefined;
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
    markerTargetsMatch,
    markerRoomMentions,
    markerSelectedMemberMentions,
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
    await new Promise((resolve) =>
      setTimeout(resolve, REMINDER_TIMELINE_POLL_MS),
    );
    latest = await inspectReminderTimeline(titles);
  }
  return { ...latest, deliveredAfterDue: false };
}

async function waitForPublicFeedPublicationResponse(
  page: Page,
  method: 'GET' | 'PUT' | 'DELETE',
  targetScope: 'any' | 'fixture-room' = 'any',
): Promise<Response> {
  const gatewayOrigin = new URL(fixture.gatewayUrl).origin;
  return page.waitForResponse(
    (response) => {
      const url = new URL(response.url());
      return (
        url.origin === gatewayOrigin &&
        url.pathname === '/v1/calendar-feeds/publication' &&
        response.request().method() === method &&
        (targetScope === 'any' || publicFeedManagementTargetMatches(response))
      );
    },
    { timeout: 20_000 },
  );
}

function publicFeedManagementTargetMatches(response: Response): boolean {
  try {
    const url = new URL(response.url());
    return (
      url.origin === new URL(fixture.gatewayUrl).origin &&
      url.pathname === '/v1/calendar-feeds/publication' &&
      url.searchParams.get('target') === 'room' &&
      url.searchParams.get('calendarId') === fixture.calendarId &&
      url.searchParams.get('roomId') === fixture.teamRoomId
    );
  } catch {
    return false;
  }
}

async function fetchAnonymousPublicFeed(
  url: string,
  method: 'GET' | 'HEAD',
): Promise<AnonymousPublicFeedResponse> {
  const headers = new Headers({ Accept: 'text/calendar' });
  try {
    const response = await fetch(url, {
      method,
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    });
    let body = new Uint8Array();
    try {
      body = new Uint8Array(await response.arrayBuffer());
    } catch {
      // Retain the observed status and closed headers if the body read fails.
    }
    return {
      status: response.status,
      contentType: response.headers.get('Content-Type') ?? undefined,
      contentLength: response.headers.get('Content-Length') ?? undefined,
      cacheControl: response.headers.get('Cache-Control') ?? undefined,
      pragma: response.headers.get('Pragma') ?? undefined,
      nosniff: response.headers.get('X-Content-Type-Options') ?? undefined,
      body,
    };
  } catch {
    return { body: new Uint8Array() };
  }
}

async function verifyPublicFeedBrowserLifecycle(
  frame: FrameLocator,
  page: Page,
  eventTitle: string,
): Promise<void> {
  activePhase = 'public-feed-browser-lifecycle';
  record(activePhase, 'started');
  const observation: PublicFeedBrowserObservation = {
    publicFeedLifecycleStep: 'opening-dialog',
    publicConsentGateObserved: false,
    publicManagerPublishSucceeded: false,
    publicUrlOriginAndRouteMatch: false,
    anonymousGetContainsCanonicalEvent: false,
    anonymousHeadMatchesGet: false,
    unpublishSucceeded: false,
    anonymousGetDeniedAfterUnpublish: false,
    anonymousHeadDeniedAfterUnpublish: false,
  };
  let publicUrl: string | undefined;
  let dialog: Locator | undefined;
  let publicationCreated = false;
  try {
    const publicFeedButton = frame.getByRole('button', {
      name: 'Public feed',
      exact: true,
    });
    await expect(publicFeedButton).toBeVisible();
    observation.publicFeedLifecycleStep = 'loading-settings';
    const initialSettingsResponse = waitForPublicFeedPublicationResponse(
      page,
      'GET',
    );
    await publicFeedButton.click();
    dialog = frame.getByRole('dialog', {
      name: 'Public calendar feed',
    });
    await expect(dialog).toBeVisible();
    const settingsResponse = await initialSettingsResponse;
    let managementResponse = settingsResponse;
    observation.publicFeedManagementGetStatus = settingsResponse.status();
    let managementState: unknown = await settingsResponse
      .json()
      .catch(() => null);
    if (settingsResponse.status() === 503) {
      observation.publicFeedManagementErrorCode =
        classifyPublicFeedManagementErrorCode(managementState);
    }

    observation.publicFeedLifecycleStep = 'selecting-target-calendar';
    const calendarSelect = dialog.getByRole('combobox', {
      name: 'Calendar',
    });
    let selectedCalendarName = (await calendarSelect.innerText()).trim();
    if (selectedCalendarName !== 'Room calendar') {
      const targetSettingsResponse = waitForPublicFeedPublicationResponse(
        page,
        'GET',
        'fixture-room',
      );
      await calendarSelect.click();
      // MUI renders Select options in a frame-level portal. Scope the choice
      // to the one visible listbox instead of querying the frame for options.
      const calendarListbox = frame
        .getByRole('listbox')
        .filter({ visible: true });
      await expect(calendarListbox).toHaveCount(1);
      await calendarListbox
        .getByRole('option', {
          name: 'Room calendar',
          exact: true,
        })
        .click();
      await expect(calendarSelect).toHaveText('Room calendar');
      const response = await targetSettingsResponse;
      managementResponse = response;
      observation.publicFeedManagementGetStatus = response.status();
      managementState = await response.json().catch(() => null);
      if (response.status() === 503) {
        observation.publicFeedManagementErrorCode =
          classifyPublicFeedManagementErrorCode(managementState);
      }
      selectedCalendarName = (await calendarSelect.innerText()).trim();
    }
    observation.publicFeedTargetCalendarMatches =
      selectedCalendarName === 'Room calendar';
    observation.publicFeedManagementTargetMatches =
      publicFeedManagementTargetMatches(managementResponse);
    observation.publicFeedSettingsEnabled =
      isRecord(managementState) && managementState.enabled === true;
    observation.publicFeedSettingsUnpublished =
      isRecord(managementState) && managementState.published === false;
    if (!observation.publicFeedManagementTargetMatches) {
      throw new Error(
        'Public feed management target did not match the fixture',
      );
    }

    const managerCanPublish =
      isRecord(managementState) &&
      managementState.enabled === true &&
      managementState.published === false;
    const consent = dialog.getByRole('checkbox', {
      name: 'I understand that anyone with the link can read this calendar.',
      exact: true,
    });
    const publishButton = dialog.getByRole('button', {
      name: 'Publish feed',
      exact: true,
    });
    observation.publicFeedLifecycleStep = 'awaiting-consent-control';
    observation.publicFeedConsentCheckboxCount = Math.min(
      await consent.count(),
      10,
    );
    observation.publicFeedConsentCheckboxVisible =
      observation.publicFeedConsentCheckboxCount > 0 &&
      (await consent.isVisible());
    observation.publicFeedConsentCheckboxChecked =
      observation.publicFeedConsentCheckboxCount > 0 &&
      (await consent.isChecked());
    observation.publicFeedPublishButtonCount = Math.min(
      await publishButton.count(),
      10,
    );
    await expect(consent).toBeVisible();
    observation.publicFeedConsentCheckboxCount = Math.min(
      await consent.count(),
      10,
    );
    observation.publicFeedConsentCheckboxVisible = await consent.isVisible();
    observation.publicFeedConsentCheckboxChecked = await consent.isChecked();
    const publishDisabledBeforeConsent = await publishButton.isDisabled();
    observation.publicFeedPublishDisabledBeforeConsent =
      publishDisabledBeforeConsent;
    observation.publicFeedLifecycleStep = 'toggling-consent';
    await consent.check();
    observation.publicFeedLifecycleStep = 'verifying-consent';
    observation.publicFeedConsentCheckboxChecked = await consent.isChecked();
    const publishEnabledAfterConsent = !(await publishButton.isDisabled());
    observation.publicFeedPublishDisabledAfterConsent =
      !publishEnabledAfterConsent;
    observation.publicConsentGateObserved =
      managerCanPublish &&
      publishDisabledBeforeConsent &&
      publishEnabledAfterConsent;
    if (!observation.publicConsentGateObserved) {
      throw new Error('Manager publication consent gate was not observed');
    }

    observation.publicFeedLifecycleStep = 'publishing';
    const publishResponsePromise = waitForPublicFeedPublicationResponse(
      page,
      'PUT',
    );
    await publishButton.click();
    const publishResponse = await publishResponsePromise;
    observation.publicFeedPublishStatus = publishResponse.status();
    const publishedState: unknown = await publishResponse
      .json()
      .catch(() => null);
    publicationCreated =
      publishResponse.status() >= 200 &&
      publishResponse.status() < 300 &&
      isRecord(publishedState) &&
      publishedState.published === true;
    observation.publicManagerPublishSucceeded = publicationCreated;
    if (!publicationCreated) {
      throw new Error('Manager publication did not succeed');
    }

    observation.publicFeedLifecycleStep = 'checking-public-feed';
    const publicUrlInput = dialog.getByRole('textbox', {
      name: 'Public feed URL',
      exact: true,
    });
    await expect(publicUrlInput).toBeVisible();
    publicUrl = await publicUrlInput.inputValue();
    let parsedPublicUrl: URL | undefined;
    try {
      parsedPublicUrl = new URL(publicUrl);
    } catch {
      parsedPublicUrl = undefined;
    }
    observation.publicUrlOriginAndRouteMatch =
      parsedPublicUrl !== undefined &&
      parsedPublicUrl.origin === new URL(fixture.gatewayUrl).origin &&
      /^\/v1\/public-calendar-feeds\/[A-Za-z0-9_.-]+$/u.test(
        parsedPublicUrl.pathname,
      ) &&
      parsedPublicUrl.username === '' &&
      parsedPublicUrl.password === '' &&
      parsedPublicUrl.search === '' &&
      parsedPublicUrl.hash === '';
    if (!observation.publicUrlOriginAndRouteMatch) {
      throw new Error('Public feed URL did not match the synthetic gateway');
    }

    const [publicGet, publicHead] = await Promise.all([
      fetchAnonymousPublicFeed(publicUrl, 'GET'),
      fetchAnonymousPublicFeed(publicUrl, 'HEAD'),
    ]);
    observation.publicFeedGetStatus = publicGet.status;
    observation.publicFeedHeadStatus = publicHead.status;
    let feedText = '';
    try {
      feedText = new TextDecoder('utf-8', { fatal: true }).decode(
        publicGet.body,
      );
    } catch {
      feedText = '';
    }
    const getHeadersAreSafe =
      publicGet.cacheControl?.toLowerCase().includes('no-store') === true &&
      publicGet.pragma?.toLowerCase() === 'no-cache' &&
      publicGet.nosniff?.toLowerCase() === 'nosniff';
    observation.anonymousGetContainsCanonicalEvent =
      publicGet.status === 200 &&
      publicGet.contentType?.toLowerCase().startsWith('text/calendar') ===
        true &&
      getHeadersAreSafe &&
      feedText.startsWith('BEGIN:VCALENDAR') &&
      feedText.includes('BEGIN:VEVENT') &&
      feedText.includes(eventTitle) &&
      feedText.trimEnd().endsWith('END:VCALENDAR');
    const headHeadersAreSafe =
      publicHead.cacheControl?.toLowerCase().includes('no-store') === true &&
      publicHead.pragma?.toLowerCase() === 'no-cache' &&
      publicHead.nosniff?.toLowerCase() === 'nosniff';
    observation.anonymousHeadMatchesGet =
      publicHead.status === 200 &&
      publicHead.contentType?.toLowerCase().startsWith('text/calendar') ===
        true &&
      headHeadersAreSafe &&
      publicHead.body.byteLength === 0 &&
      publicHead.contentLength === String(publicGet.body.byteLength);
    if (
      !observation.anonymousGetContainsCanonicalEvent ||
      !observation.anonymousHeadMatchesGet
    ) {
      throw new Error('Anonymous public feed GET/HEAD did not match');
    }

    observation.publicFeedLifecycleStep = 'unpublishing';
    const unpublishResponsePromise = waitForPublicFeedPublicationResponse(
      page,
      'DELETE',
    );
    await dialog
      .getByRole('button', { name: 'Unpublish', exact: true })
      .click();
    const unpublishResponse = await unpublishResponsePromise;
    observation.publicFeedUnpublishStatus = unpublishResponse.status();
    observation.unpublishSucceeded =
      unpublishResponse.status() >= 200 && unpublishResponse.status() < 300;
    if (!observation.unpublishSucceeded) {
      throw new Error('Public feed could not be unpublished');
    }
    publicationCreated = false;

    observation.publicFeedLifecycleStep = 'checking-revocation';
    const [revokedGet, revokedHead] = await Promise.all([
      fetchAnonymousPublicFeed(publicUrl, 'GET'),
      fetchAnonymousPublicFeed(publicUrl, 'HEAD'),
    ]);
    observation.publicFeedRevokedGetStatus = revokedGet.status;
    observation.publicFeedRevokedHeadStatus = revokedHead.status;
    observation.anonymousGetDeniedAfterUnpublish =
      revokedGet.status === 404 && revokedGet.body.byteLength === 0;
    observation.anonymousHeadDeniedAfterUnpublish =
      revokedHead.status === 404 && revokedHead.body.byteLength === 0;
    if (
      !observation.anonymousGetDeniedAfterUnpublish ||
      !observation.anonymousHeadDeniedAfterUnpublish
    ) {
      throw new Error('Public feed remained available after unpublishing');
    }

    observation.publicFeedLifecycleStep = 'complete';
    record(
      activePhase,
      'passed',
      observation.publicFeedRevokedGetStatus,
      undefined,
      observation,
    );
  } catch {
    activeReminderFailureRecorded = true;
    record(activePhase, 'failed', undefined, undefined, observation);
    throw new Error('Public calendar feed lifecycle could not be confirmed');
  } finally {
    if (publicationCreated && dialog) {
      try {
        const unpublishButton = dialog.getByRole('button', {
          name: 'Unpublish',
          exact: true,
        });
        if (await unpublishButton.isVisible()) {
          const cleanupResponse = waitForPublicFeedPublicationResponse(
            page,
            'DELETE',
          );
          await unpublishButton.click();
          await cleanupResponse;
        }
      } catch {
        // The isolated Element stack is removed by the acceptance job.
      }
    }
  }
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
  options: {
    captureReminderRoomLayout?: boolean;
    captureRoomReadinessTimeline?: boolean;
    useNormalRoomSelection?: boolean;
  } = {},
): Promise<MemberARoomResult> {
  const element = new ElementWebPage(page);
  let navigationCompleted = false;
  try {
    if (options.useNormalRoomSelection) {
      await element.navigateToRoomOrInvitation(roomName);
    } else {
      const roomUrl = new URL(fixture.elementUrl);
      roomUrl.hash = `/room/${roomId}`;
      await page.goto(roomUrl.href, { timeout: 20_000 });
    }
    navigationCompleted = true;
  } catch {
    // The failure summary records only whether this bounded navigation ended.
  }

  const roomNameHeading = getPinnedElementRoomNameHeading(page);
  let roomHeadingReady = false;
  const timelineController = options.captureRoomReadinessTimeline
    ? new AbortController()
    : undefined;
  let timelinePromise: Promise<RoomReadinessTimeline> | undefined;
  if (navigationCompleted) {
    if (timelineController) {
      timelinePromise = collectRoomReadinessTimeline({
        signal: timelineController.signal,
        observe: () => observeMemberARoomReadinessSnapshot(page, roomId),
      }).catch(() => unavailableRoomReadinessTimeline('unavailable'));
    }
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
    } finally {
      timelineController?.abort();
    }
  }

  const roomReadinessTimeline = options.captureRoomReadinessTimeline
    ? ((await timelinePromise) ??
      unavailableRoomReadinessTimeline('not-started'))
    : undefined;

  const observation = await observeMemberARoom(
    page,
    element,
    roomName,
    roomId,
    expectedUserId,
    navigationCompleted,
    roomHeadingReady,
    options.captureReminderRoomLayout ?? false,
  ).catch(() => undefined);
  return {
    element,
    navigationCompleted,
    observation,
    roomReadinessTimeline,
    failureCode: getMemberARoomFailureCode(navigationCompleted, observation),
  };
}

async function observeMemberARoomReadinessSnapshot(
  page: Page,
  expectedRoomId: string,
): Promise<RoomReadinessSnapshot> {
  return page.locator('body').evaluate(
    (body, expectedRoomId): RoomReadinessSnapshot => {
      const knownSyncStates = new Set([
        'ERROR',
        'PREPARED',
        'RECONNECTING',
        'STOPPED',
        'SYNCING',
        'CATCHUP',
      ]);
      let currentRoomMatches: boolean | null = null;
      let matrixSyncState: RoomReadinessSnapshot['matrixSyncState'] = 'UNKNOWN';
      try {
        const matrixChat = (
          window as Window & { matrixChat?: { state?: unknown } }
        ).matrixChat;
        const state = matrixChat?.state;
        if (state !== null && typeof state === 'object') {
          const currentRoomId = (state as { currentRoomId?: unknown })
            .currentRoomId;
          if (typeof currentRoomId === 'string' || currentRoomId === null) {
            currentRoomMatches = currentRoomId === expectedRoomId;
          }
        }
      } catch {
        // Preserve only the room equality result.
      }
      try {
        const matrixClient = (
          window as Window & {
            mxMatrixClientPeg?: {
              get?: () => { getSyncState?: () => unknown };
            };
          }
        ).mxMatrixClientPeg?.get?.();
        const syncState = matrixClient?.getSyncState?.();
        if (typeof syncState === 'string' && knownSyncStates.has(syncState)) {
          matrixSyncState =
            syncState as RoomReadinessSnapshot['matrixSyncState'];
        }
      } catch {
        // Keep unknown sync state when Element exposes no safe enum.
      }
      const document = body.ownerDocument;
      const roomHeader = document.querySelector('header.mx_RoomHeader');
      return {
        roomViewPresent: document.querySelector('.mx_RoomView') !== null,
        roomHeaderPresent: roomHeader !== null,
        roomHeadingPresent:
          roomHeader !== null &&
          roomHeader.querySelector('[role="heading"]') !== null,
        currentRoomMatches,
        matrixSyncState,
      };
    },
    expectedRoomId,
    { timeout: ROOM_READINESS_SAMPLE_TIMEOUT_MS },
  );
}

type RoomRenderStateObservation = Pick<
  MemberARoomObservation,
  | 'outerRenderBucket'
  | 'matrixChatShellPresent'
  | 'roomViewWrapperPresent'
  | 'roomViewRendererPresent'
  | 'matrixChatStateAvailable'
  | 'matrixChatViewBucket'
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

function unavailableRoomRenderState(): RoomRenderStateObservation {
  return {
    outerRenderBucket: 'unavailable',
    matrixChatShellPresent: null,
    roomViewWrapperPresent: null,
    roomViewRendererPresent: null,
    matrixChatStateAvailable: false,
    matrixChatViewBucket: 'unavailable',
    matrixChatReady: null,
    matrixChatPageTypeBucket: 'unavailable',
    matrixChatCurrentRoomMatches: null,
    roomRenderStateAvailable: false,
    roomViewShellVisible: null,
    roomViewBodyVisible: null,
    roomPreviewVisible: null,
    roomPreviewLoadingVisible: null,
    roomHeaderVisible: null,
    roomHeaderHeadingVisible: null,
    roomErrorBoundaryVisible: null,
  };
}

async function observeRoomRenderState(
  page: Page,
  expectedRoomId: string,
): Promise<RoomRenderStateObservation> {
  return page.evaluate((expectedRoomId) => {
    type MatrixChatState = {
      view?: unknown;
      ready?: unknown;
      page_type?: unknown;
      currentRoomId?: unknown;
    };
    let matrixChatState: MatrixChatState | undefined;
    try {
      const matrixChat = (
        window as Window & {
          matrixChat?: { state?: unknown };
        }
      ).matrixChat;
      if (
        matrixChat?.state !== null &&
        typeof matrixChat?.state === 'object' &&
        !Array.isArray(matrixChat.state)
      ) {
        matrixChatState = matrixChat.state as MatrixChatState;
      }
    } catch {
      // Keep Element's internal state in fixed buckets only.
    }
    const matrixChatStateAvailable = matrixChatState !== undefined;
    const matrixChatViewBucket: MatrixChatViewBucket =
      typeof matrixChatState?.view === 'number' &&
      Number.isInteger(matrixChatState.view) &&
      matrixChatState.view >= 0 &&
      matrixChatState.view <= 11
        ? matrixChatState.view === 9
          ? 'logged-in'
          : 'other-view'
        : 'unavailable';
    const matrixChatReady =
      typeof matrixChatState?.ready === 'boolean'
        ? matrixChatState.ready
        : null;
    const matrixChatPageTypeBucket: MatrixChatPageTypeBucket =
      matrixChatState?.page_type === undefined ||
      matrixChatState?.page_type === null
        ? matrixChatStateAvailable
          ? 'missing'
          : 'unavailable'
        : typeof matrixChatState.page_type === 'string'
          ? matrixChatState.page_type === 'room_view'
            ? 'room-view'
            : 'other-page'
          : 'unavailable';
    const matrixChatCurrentRoomMatches =
      typeof matrixChatState?.currentRoomId === 'string' ||
      matrixChatState?.currentRoomId === null
        ? matrixChatState.currentRoomId === expectedRoomId
        : null;
    const matrixChatShellPresent =
      document.querySelector('.mx_MatrixChat') !== null;
    const roomViewWrapperPresent =
      document.querySelector('.mx_RoomView_wrapper') !== null;
    const roomViewRendererPresent =
      document.querySelector('.mx_RoomView') !== null;
    const outerRenderBucket: OuterRenderBucket =
      matrixChatShellPresent &&
      roomViewWrapperPresent &&
      roomViewRendererPresent
        ? 'room-page'
        : matrixChatShellPresent &&
            roomViewWrapperPresent &&
            !roomViewRendererPresent
          ? 'other-page'
          : !matrixChatShellPresent &&
              !roomViewWrapperPresent &&
              !roomViewRendererPresent
            ? 'no-shell'
            : 'inconsistent';
    const isVisible = (element: Element): boolean => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return (
        element.getClientRects().length > 0 &&
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        style.visibility !== 'collapse'
      );
    };
    const unavailable = {
      outerRenderBucket,
      matrixChatShellPresent,
      roomViewWrapperPresent,
      roomViewRendererPresent,
      matrixChatStateAvailable,
      matrixChatViewBucket,
      matrixChatReady,
      matrixChatPageTypeBucket,
      matrixChatCurrentRoomMatches,
      roomRenderStateAvailable: false,
      roomViewShellVisible: null,
      roomViewBodyVisible: null,
      roomPreviewVisible: null,
      roomPreviewLoadingVisible: null,
      roomHeaderVisible: null,
      roomHeaderHeadingVisible: null,
      roomErrorBoundaryVisible: null,
    } as const;
    const visibleRoomViews = Array.from(
      document.querySelectorAll('.mx_RoomView'),
    ).filter(isVisible);
    if (visibleRoomViews.length > 1) return unavailable;
    const roomView = visibleRoomViews[0];
    if (!roomView) {
      return {
        ...unavailable,
        outerRenderBucket,
        roomRenderStateAvailable: true,
        roomViewShellVisible: false,
        roomViewBodyVisible: false,
        roomPreviewVisible: false,
        roomPreviewLoadingVisible: false,
        roomHeaderVisible: false,
        roomHeaderHeadingVisible: false,
        roomErrorBoundaryVisible: false,
      };
    }
    const firstVisible = (root: ParentNode, selector: string): boolean =>
      Array.from(root.querySelectorAll(selector)).some(isVisible);
    const header = roomView.querySelector('header.mx_RoomHeader');
    return {
      ...unavailable,
      roomRenderStateAvailable: true,
      roomViewShellVisible: true,
      roomViewBodyVisible: firstVisible(roomView, '.mx_RoomView_body'),
      roomPreviewVisible: firstVisible(roomView, '.mx_RoomPreviewBar'),
      roomPreviewLoadingVisible: firstVisible(
        roomView,
        '.mx_RoomPreviewBar_Loading',
      ),
      roomHeaderVisible: header !== null && isVisible(header),
      roomHeaderHeadingVisible:
        header !== null &&
        firstVisible(header, '.mx_RoomHeader_heading[role="heading"]'),
      roomErrorBoundaryVisible: firstVisible(roomView, '.mx_ErrorBoundary'),
    };
  }, expectedRoomId);
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
  const roomRenderState = await observeRoomRenderState(page, roomId).catch(() =>
    unavailableRoomRenderState(),
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
    ...roomRenderState,
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
    onTiming,
  }: OpenCalendarWidgetOptions,
) {
  const startupStartedAt = performance.now();
  const activationStartedAt = startupStartedAt;
  await openPinnedElementWidget(
    page,
    'Matrix Calendar',
    captureMemberADiagnostics,
  );
  onTiming?.('activation', elapsedMilliseconds(activationStartedAt));
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
  const capabilityApprovalStartedAt = performance.now();
  await element.approveWidgetCapabilities();
  onTiming?.(
    'capability-approval',
    elapsedMilliseconds(capabilityApprovalStartedAt),
  );
  if (captureMemberADiagnostics) record(activePhase, 'passed');
  if (captureMemberADiagnostics) {
    activePhase = 'widget-a-identity-approval';
  }
  const identityContinue = page
    .getByRole('dialog')
    .getByRole('button', { name: 'Continue', exact: true })
    .first();
  const frame = element.widgetByTitle('Matrix Calendar');
  const identityApprovalStartedAt = performance.now();
  let identityApprovalDurationMs = 0;
  let identityDialogShown: boolean;
  if (onTiming && waitForCalendar) {
    const createEventButton = frame.getByRole('button', {
      name: 'Create event',
      exact: true,
    });
    identityDialogShown = await raceCalendarReadyOrIdentityPrompt(
      () => expect(createEventButton).toBeEnabled({ timeout: 30_000 }),
      () => identityContinue.waitFor({ state: 'visible', timeout: 30_000 }),
    );
  } else {
    await identityContinue
      .waitFor({ state: 'visible', timeout: 8_000 })
      .catch(() => undefined);
    identityDialogShown = await identityContinue.isVisible().catch(() => false);
  }
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
    identityApprovalDurationMs = elapsedMilliseconds(identityApprovalStartedAt);
    if (captureMemberADiagnostics) {
      record(activePhase, 'passed');
      activePhase = 'widget-a-iframe-ready';
    }
  } else if (captureMemberADiagnostics) {
    activePhase = 'widget-a-iframe-ready';
  }
  onTiming?.('identity-approval', identityApprovalDurationMs);
  const iframeReadyStartedAt = performance.now();
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
  onTiming?.('iframe-ready', elapsedMilliseconds(iframeReadyStartedAt));
  onTiming?.('widget-startup', elapsedMilliseconds(startupStartedAt));
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
  expectedPrincipalLocalpart: string,
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
      g6GatewayResourceIdentityMatches(
        event.id,
        expectedEventHref,
        expectedPrincipalLocalpart,
      );
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

function waitForPrivateClientResponse(
  page: Page,
  method: 'GET' | 'POST' | 'DELETE',
): Promise<Response> {
  return page.waitForResponse(
    (response) => {
      try {
        const url = new URL(response.url());
        return (
          url.origin === new URL(fixture.gatewayUrl).origin &&
          (method === 'DELETE'
            ? /^\/v1\/calendar\/private-clients\/mcwpc~[a-f0-9]{48}$/u.test(
                url.pathname,
              )
            : url.pathname === '/v1/calendar/private-clients') &&
          response.request().method() === method
        );
      } catch {
        return false;
      }
    },
    { timeout: 30_000 },
  );
}

async function requestPrivateClientListStatus(
  page: Page,
  gatewayUrl: string,
  roomId: string,
  calendarId: string,
): Promise<number> {
  return page.evaluate(
    async ({ gatewayUrl, roomId, calendarId }) => {
      type OpenIdCredentials = {
        access_token?: unknown;
        matrix_server_name?: unknown;
      };
      type MatrixClient = {
        getOpenIdToken?: () => Promise<OpenIdCredentials>;
      };
      type MatrixClientWindow = Window & {
        mxMatrixClientPeg?: { get?: () => MatrixClient };
      };

      try {
        const matrixClient = (
          window as MatrixClientWindow
        ).mxMatrixClientPeg?.get?.();
        if (!matrixClient?.getOpenIdToken) return 0;
        const credentials = await matrixClient.getOpenIdToken();
        if (
          typeof credentials.access_token !== 'string' ||
          typeof credentials.matrix_server_name !== 'string'
        ) {
          return 0;
        }
        const query = new URLSearchParams({
          target: 'room',
          roomId,
          calendarId,
        });
        const response = await fetch(
          `${gatewayUrl}/v1/calendar/private-clients?${query.toString()}`,
          {
            headers: {
              Authorization: `MX-Identity ${btoa(
                JSON.stringify({
                  matrix_server_name: credentials.matrix_server_name,
                  access_token: credentials.access_token,
                }),
              )}`,
            },
          },
        );
        await response.body?.cancel();
        return response.status;
      } catch {
        return 0;
      }
    },
    { gatewayUrl, roomId, calendarId },
  );
}

type PrivateDavRequestResult = Readonly<{
  status: number;
  bodyBytes: number;
  etag?: string;
  expectedTextPresent?: boolean;
}>;

function requestPrivateDav({
  url,
  username,
  password,
  caCertificate,
  method,
  headers = {},
  body = '',
  expectedText,
}: {
  url: URL;
  username: string;
  password: string;
  caCertificate: Buffer;
  method: string;
  headers?: Record<string, string>;
  body?: string;
  expectedText?: string;
}): Promise<PrivateDavRequestResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = () => {
      if (settled) return;
      settled = true;
      reject(new Error('Private CalDAV acceptance request failed'));
    };
    const authorization = `Basic ${Buffer.from(
      `${username}:${password}`,
      'utf8',
    ).toString('base64')}`;
    let request: ClientRequest;
    try {
      request = httpsRequest(
        url,
        {
          method,
          headers: {
            accept: '*/*',
            authorization,
            connection: 'close',
            ...headers,
          },
          ca: caCertificate,
          agent: false,
          timeout: 15_000,
        },
        (response) => {
          const chunks: Buffer[] = [];
          let bodyBytes = 0;
          response.on('data', (chunk: Buffer) => {
            bodyBytes += chunk.byteLength;
            if (bodyBytes > 1_000_000) {
              request.destroy();
              fail();
              return;
            }
            chunks.push(Buffer.from(chunk));
          });
          response.once('error', fail);
          response.once('end', () => {
            if (settled) return;
            const responseBody = Buffer.concat(chunks);
            const etag = response.headers.etag;
            settled = true;
            resolve({
              status: response.statusCode ?? 0,
              bodyBytes,
              ...(typeof etag === 'string' ? { etag } : {}),
              ...(expectedText === undefined
                ? {}
                : {
                    expectedTextPresent: responseBody.includes(
                      Buffer.from(expectedText, 'utf8'),
                    ),
                  }),
            });
          });
        },
      );
    } catch {
      fail();
      return;
    }
    request.once('error', fail);
    request.once('timeout', () => request.destroy());
    request.end(body);
  });
}

async function privateSetupDetailsAbsent(dialog: Locator): Promise<boolean> {
  const counts = await Promise.all(
    ['CalDAV URL', 'Username', 'App password'].map((name) =>
      dialog.getByRole('textbox', { name, exact: true }).count(),
    ),
  );
  return counts.every((count) => count === 0);
}

function privateTlsDirectoryMatchesRunnerTemp(): boolean {
  const runnerTemp = process.env.RUNNER_TEMP;
  const tlsDirectory = process.env.ELEMENT_ACCEPTANCE_PRIVATE_TLS_DIR;
  return (
    typeof runnerTemp === 'string' &&
    typeof tlsDirectory === 'string' &&
    isAbsolute(runnerTemp) &&
    isAbsolute(tlsDirectory) &&
    resolve(tlsDirectory).startsWith(`${resolve(runnerTemp)}${sep}`)
  );
}

function readPrivateAcceptanceCaCertificate(): Buffer {
  const tlsDirectory = process.env.ELEMENT_ACCEPTANCE_PRIVATE_TLS_DIR;
  if (typeof tlsDirectory !== 'string' || !isAbsolute(tlsDirectory)) {
    throw new Error('Private acceptance CA certificate is unavailable');
  }
  try {
    return readFileSync(join(tlsDirectory, 'ca.pem'));
  } catch {
    throw new Error('Private acceptance CA certificate is unavailable');
  }
}

async function selectPrivateAcceptanceCalendar(
  page: Page,
  calendarPicker: Locator,
  targetCalendarOption: Locator,
): Promise<boolean> {
  const alreadySelected =
    (await targetCalendarOption.getAttribute('aria-selected')) === 'true';
  if (alreadySelected) {
    await calendarPicker.press('Escape');
    return true;
  }

  const selectedListResponse = waitForPrivateClientResponse(page, 'GET');
  await targetCalendarOption.click();
  return (await selectedListResponse).status() === 200;
}

function privateCredentialsMatchGateway(
  username: string,
  password: string,
  credentialUrl: URL,
): boolean {
  return [
    /^mcwpc~[a-f0-9]{48}$/u.test(username),
    /^[A-Za-z0-9_-]{43}$/u.test(password),
    credentialUrl.origin === PRIVATE_ACCEPTANCE_GATEWAY_ORIGIN,
    credentialUrl.pathname === `/${username}/calendar/`,
    credentialUrl.username === '',
    credentialUrl.password === '',
    credentialUrl.search === '',
    credentialUrl.hash === '',
  ].every(Boolean);
}

function parsePrivateCredentialUrl(credentialUrlText: string): URL {
  try {
    return new URL(credentialUrlText);
  } catch {
    throw new Error('Private app credentials were not rendered');
  }
}

function privateDavLifecycleSucceeded(
  principalDiscovery: PrivateDavRequestResult,
  collectionDiscovery: PrivateDavRequestResult,
  createdResource: PrivateDavRequestResult,
  readCreatedResource: PrivateDavRequestResult,
  updatedResource: PrivateDavRequestResult,
  readUpdatedResource: PrivateDavRequestResult,
  deletedResource: PrivateDavRequestResult,
): boolean {
  return (
    principalDiscovery.status === 207 &&
    collectionDiscovery.status === 207 &&
    privateDavWriteSucceeded(createdResource) &&
    readCreatedResource.status === 200 &&
    readCreatedResource.expectedTextPresent === true &&
    isStrongPrivateDavEtag(readCreatedResource.etag) &&
    privateDavWriteSucceeded(updatedResource) &&
    readUpdatedResource.status === 200 &&
    readUpdatedResource.expectedTextPresent === true &&
    isStrongPrivateDavEtag(readUpdatedResource.etag) &&
    privateDavWriteSucceeded(deletedResource)
  );
}

function privateDavWriteSucceeded(result: PrivateDavRequestResult): boolean {
  return result.status >= 200 && result.status < 300;
}

function isStrongPrivateDavEtag(etag: string | undefined): etag is string {
  return typeof etag === 'string' && /^"[\x21\x23-\x7e]{1,200}"$/u.test(etag);
}

function privateDavEtagOrEmpty(etag: string | undefined): string {
  return isStrongPrivateDavEtag(etag) ? etag : '';
}

function privateDavReadSucceeded(result: PrivateDavRequestResult): boolean {
  return result.status === 200 && result.expectedTextPresent === true;
}

function privateDavReadEtagOrEmpty(result: PrivateDavRequestResult): string {
  return privateDavReadSucceeded(result)
    ? privateDavEtagOrEmpty(result.etag)
    : '';
}

async function bestEffortDeleteOwnedPrivateDavResource(
  requestBase: {
    username: string;
    password: string;
    caCertificate: Buffer;
  },
  url: URL,
  expectedUid: string,
): Promise<void> {
  try {
    const existingResource = await requestPrivateDav({
      ...requestBase,
      url,
      method: 'GET',
      expectedText: `UID:${expectedUid}`,
    });
    if (existingResource.status === 404) return;
    if (
      existingResource.status !== 200 ||
      existingResource.expectedTextPresent !== true ||
      !isStrongPrivateDavEtag(existingResource.etag)
    ) {
      return;
    }

    await requestPrivateDav({
      ...requestBase,
      url,
      method: 'DELETE',
      headers: { 'if-match': existingResource.etag },
    });
  } catch {
    // Best-effort cleanup must not replace the primary acceptance result.
  }
}

function revokedPrivateDavCredentialDenied(
  result: PrivateDavRequestResult,
): boolean {
  return result.status === 401 && result.bodyBytes === 0;
}

function observeReminderWidgetContextResponse(
  page: Page,
  roomId: string,
): ReminderWidgetContextResponseObserver {
  let responseStatus: number | undefined;
  const gatewayOrigin = new URL(fixture.gatewayUrl).origin;
  const widgetOrigin = new URL(fixture.widgetUrl).origin;
  // eslint-disable-next-line playwright/missing-playwright-await -- Register before room/widget actions to avoid a response race; the caller awaits reminderContextResponseObserver.response after openCalendarWidget.
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
        const timingMatch = await page.evaluate(
          compareEventTimingWithRoomRange,
          { timing: createdEventTiming, range: expectedRoomRange },
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
          fixture,
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
  fixture: fixtureValue,
}: {
  calendarId: string;
  eventUid: string;
  range: ExpectedRoomRange;
  fixture: Fixture;
}): CalDavReportProbeResult | undefined {
  const principal = acceptancePrincipal(fixtureValue);
  if (!principal) return undefined;
  const result = spawnSync(
    process.execPath,
    [
      resolve(
        process.cwd(),
        '../dev/element-acceptance-caldav-report-probe.mjs',
      ),
    ],
    {
      input: JSON.stringify({
        calendarId,
        eventUid,
        range,
        principalMode: fixtureValue.principalMode,
        serviceSender: fixtureValue.serviceSender,
        bot: fixtureValue.users.bot,
      }),
      encoding: 'utf8',
      env:
        principal.mode === 'appservice'
          ? { MATRIX_APPLICATION_SERVICE_TOKEN: principal.accessToken }
          : {},
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
    selectedMemberMentioned?: boolean;
    targetMentioned?: boolean;
    expectedRoomRecipient?: boolean;
    expectedSelectedRecipient?: boolean;
    deliveredAfterDue?: boolean;
    allMarkersOnce?: boolean;
    targetSettingsReadback?: boolean;
    allDayScheduleReadback?: boolean;
    canManageReminders?: boolean;
  } & Partial<ReminderConfigurationObservation> &
    Partial<ReminderAlarmUiObservation> &
    Partial<PublicFeedBrowserObservation> &
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

function recordPerformancePilot(
  status: 'started' | 'passed' | 'failed',
  performanceReport: PerformanceReportData,
  failureCode?: string,
) {
  const stageFile = process.env.ELEMENT_ACCEPTANCE_STAGE_FILE;
  if (!stageFile) throw new Error('Element acceptance fixture unavailable');
  appendFileSync(
    stageFile,
    `${JSON.stringify({
      phase: 'performance-pilot',
      status,
      ...(failureCode === undefined ? {} : { failureCode }),
      performanceReport,
    })}\n`,
    { encoding: 'utf8', mode: 0o600 },
  );
}

function capturePrivatePerformancePageError(
  error: Error,
  profile: OrdinaryPerformanceProfile,
  stage: PerformancePageErrorStage,
): void {
  // This is an opt-in local synthetic-run aid. CI never writes raw exception
  // text, and the file is never attached to acceptance artifacts.
  if (process.env.CI || process.env.GITHUB_ACTIONS) return;
  const configuredPath =
    process.env.ELEMENT_ACCEPTANCE_PRIVATE_ERROR_CAPTURE_PATH;
  if (!configuredPath || !isAbsolute(configuredPath)) return;
  const capturePath = resolve(configuredPath);
  const privateRoot = realpathSync(tmpdir()) + sep;
  if (!capturePath.startsWith(privateRoot)) return;

  try {
    mkdirSync(dirname(capturePath), { recursive: true, mode: 0o700 });
    const captureParent = realpathSync(dirname(capturePath));
    if (
      captureParent !== realpathSync(tmpdir()) &&
      !captureParent.startsWith(privateRoot)
    ) {
      return;
    }
    const bounded = (value: unknown, maxLength: number): string | null =>
      typeof value === 'string' ? value.slice(0, maxLength) : null;
    const payload = `${JSON.stringify({
      profile,
      stage,
      name: bounded(error.name, 128),
      message: bounded(error.message, 4_096),
      stack: bounded(error.stack, 32_768),
    })}\n`;
    if (Buffer.byteLength(payload, 'utf8') > 40_000) return;
    // Exclusive create refuses existing files and symlinks; first error wins.
    writeFileSync(capturePath, payload, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
  } catch {
    // Diagnostics must never replace the original acceptance failure.
  }
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
  const observation = result.observation
    ? roomContextObservationForPhase(
        {
          ...result.observation,
          ...(result.roomReadinessTimeline
            ? { roomReadinessTimeline: result.roomReadinessTimeline }
            : {}),
        },
        phase,
      )
    : result.roomReadinessTimeline
      ? roomContextObservationForPhase(
          { roomReadinessTimeline: result.roomReadinessTimeline },
          phase,
        )
      : undefined;
  appendFileSync(
    stageFile,
    `${JSON.stringify({
      phase,
      status: result.failureCode ? 'failed' : 'passed',
      ...(result.failureCode ? { failureCode: result.failureCode } : {}),
      ...(observation ?? {}),
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

if (process.env.ELEMENT_ACCEPTANCE_PRIVATE_UI === 'true') {
  test.describe('private calendar app acceptance', () => {
    test.use({ trace: 'off', video: 'off', screenshot: 'off' });

    test('Element Web manages private app access and revokes CalDAV authorization', async ({
      browser,
    }) => {
      test.setTimeout(360_000);
      fixture = readFixture();

      const privateGatewayOriginMatches =
        new URL(fixture.gatewayUrl).origin ===
        PRIVATE_ACCEPTANCE_GATEWAY_ORIGIN;
      expect(privateGatewayOriginMatches).toBe(true);

      expect(privateTlsDirectoryMatchesRunnerTemp()).toBe(true);
      const caCertificate = readPrivateAcceptanceCaCertificate();

      const allowedOrigins = new Set([
        new URL(fixture.elementUrl).origin,
        new URL(fixture.homeserverUrl).origin,
        new URL(fixture.gatewayUrl).origin,
        new URL(fixture.widgetUrl).origin,
        'http://localhost:8008',
      ]);
      const contexts: BrowserContext[] = [];
      let blockedExternalRequests = 0;
      const makeContext = async () => {
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
            blockedExternalRequests += 1;
            await route.abort('blockedbyclient');
            return;
          }
          if (!allowedOrigins.has(origin)) {
            blockedExternalRequests += 1;
            await route.abort('blockedbyclient');
            return;
          }
          await route.continue();
        });
        return context;
      };

      try {
        const contextA = await makeContext();
        const pageA = await authenticateInElement(
          contextA,
          fixture.users.memberA,
        );
        const teamRoomA = await openFixtureRoom(
          pageA,
          fixture.roomName,
          fixture.teamRoomId,
        );
        const frameA = await openCalendarWidget(teamRoomA, pageA, {
          expectWidgetWarning: false,
        });
        const privateClientButtonA = frameA.getByRole('button', {
          name: 'Calendar app access',
          exact: true,
        });
        await expect(privateClientButtonA).toBeVisible();
        const initialListResponse = waitForPrivateClientResponse(pageA, 'GET');
        await privateClientButtonA.click();
        const dialogA = frameA.getByRole('dialog').last();
        await expect(dialogA).toBeVisible();
        expect((await initialListResponse).status()).toBe(200);

        const calendarPicker = dialogA.getByRole('combobox', {
          name: 'Calendar',
        });
        await calendarPicker.click();
        const targetCalendarOption = frameA.getByRole('option', {
          name: 'Synthetic team calendar',
          exact: true,
        });
        await expect(targetCalendarOption).toHaveCount(1);
        expect(
          await selectPrivateAcceptanceCalendar(
            pageA,
            calendarPicker,
            targetCalendarOption,
          ),
        ).toBe(true);

        let publicFeedMutationCount = 0;
        pageA.on('request', (request) => {
          try {
            const url = new URL(request.url());
            if (
              url.origin === PRIVATE_ACCEPTANCE_GATEWAY_ORIGIN &&
              url.pathname === '/v1/calendar-feeds/publication' &&
              ['PUT', 'DELETE'].includes(request.method())
            ) {
              publicFeedMutationCount += 1;
            }
          } catch {
            // Keep only the mutation count; never retain the request URL.
          }
        });

        const createResponse = waitForPrivateClientResponse(pageA, 'POST');
        await dialogA
          .getByRole('button', { name: 'Create app access', exact: true })
          .click();
        const createdStatus = (await createResponse).status();
        expect(createdStatus === 201).toBe(true);

        const credentialUrlText = await dialogA
          .getByRole('textbox', { name: 'CalDAV URL', exact: true })
          .inputValue();
        const credentialUrl = parsePrivateCredentialUrl(credentialUrlText);
        const username = await dialogA
          .getByRole('textbox', { name: 'Username', exact: true })
          .inputValue();
        const password = await dialogA
          .getByRole('textbox', { name: 'App password', exact: true })
          .inputValue();
        expect(
          privateCredentialsMatchGateway(username, password, credentialUrl),
        ).toBe(true);
        expect(publicFeedMutationCount).toBe(0);

        await expect(
          dialogA.getByText('Status: Active', { exact: true }),
        ).toBeVisible();
        await dialogA
          .getByRole('button', { name: 'Hide setup details', exact: true })
          .click();
        expect(await privateSetupDetailsAbsent(dialogA)).toBe(true);

        const browserStorage = JSON.stringify(await contextA.storageState());
        const appCredentialWasPersisted =
          browserStorage.includes(username) ||
          browserStorage.includes(password) ||
          browserStorage.includes(credentialUrlText);
        expect(appCredentialWasPersisted).toBe(false);

        await dialogA
          .getByRole('button', { name: 'Close', exact: true })
          .click();
        const listedAfterReopen = waitForPrivateClientResponse(pageA, 'GET');
        await privateClientButtonA.click();
        const reopenedDialogA = frameA.getByRole('dialog').last();
        expect((await listedAfterReopen).status()).toBe(200);
        expect(await privateSetupDetailsAbsent(reopenedDialogA)).toBe(true);
        await expect(
          reopenedDialogA.getByText('Status: Active', { exact: true }),
        ).toBeVisible();

        const principalUrl = new URL('../', credentialUrl);
        const collectionUrl = new URL(credentialUrl.href);
        const eventResourceId = randomUUID();
        const resourceUrl = new URL(
          `private-ui-${eventResourceId}.ics`,
          collectionUrl,
        );
        const eventUid = `private-ui-${eventResourceId}@acceptance.invalid`;
        const timeValue = (value: Date) =>
          value
            .toISOString()
            .replace(/[-:]/gu, '')
            .replace(/\.\d{3}Z$/u, 'Z');
        const eventStart = new Date(Date.now() + 5 * 60_000);
        const eventEnd = new Date(eventStart.getTime() + 30 * 60_000);
        const originalSummary = 'Private UI acceptance original';
        const updatedSummary = 'Private UI acceptance updated';
        const makeIcs = (summary: string) =>
          [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//Matrix Calendar Widget//Private Acceptance//EN',
            'BEGIN:VEVENT',
            `UID:${eventUid}`,
            `DTSTAMP:${timeValue(new Date())}`,
            `DTSTART:${timeValue(eventStart)}`,
            `DTEND:${timeValue(eventEnd)}`,
            `SUMMARY:${summary}`,
            'END:VEVENT',
            'END:VCALENDAR',
            '',
          ].join('\r\n');
        const discoveryBody = [
          '<?xml version="1.0" encoding="utf-8"?>',
          '<d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>',
        ].join('');
        const requestBase = {
          username,
          password,
          caCertificate,
        };
        try {
          const principalDiscovery = await requestPrivateDav({
            ...requestBase,
            url: principalUrl,
            method: 'PROPFIND',
            headers: { depth: '0', 'content-type': 'application/xml' },
            body: discoveryBody,
          });
          const collectionDiscovery = await requestPrivateDav({
            ...requestBase,
            url: collectionUrl,
            method: 'PROPFIND',
            headers: { depth: '1', 'content-type': 'application/xml' },
            body: discoveryBody,
          });
          const createdResource = await requestPrivateDav({
            ...requestBase,
            url: resourceUrl,
            method: 'PUT',
            headers: {
              'content-type': 'text/calendar; charset=utf-8',
              'if-none-match': '*',
            },
            body: makeIcs(originalSummary),
          });
          expect(privateDavWriteSucceeded(createdResource)).toBe(true);
          const readCreatedResource = await requestPrivateDav({
            ...requestBase,
            url: resourceUrl,
            method: 'GET',
            expectedText: `SUMMARY:${originalSummary}`,
          });
          expect(privateDavReadSucceeded(readCreatedResource)).toBe(true);
          expect(isStrongPrivateDavEtag(readCreatedResource.etag)).toBe(true);
          const updatedResource = await requestPrivateDav({
            ...requestBase,
            url: resourceUrl,
            method: 'PUT',
            headers: {
              'content-type': 'text/calendar; charset=utf-8',
              'if-match': privateDavReadEtagOrEmpty(readCreatedResource),
            },
            body: makeIcs(updatedSummary),
          });
          const readUpdatedResource = await requestPrivateDav({
            ...requestBase,
            url: resourceUrl,
            method: 'GET',
            expectedText: `SUMMARY:${updatedSummary}`,
          });
          const deletedResource = await requestPrivateDav({
            ...requestBase,
            url: resourceUrl,
            method: 'DELETE',
            headers: {
              'if-match': privateDavReadEtagOrEmpty(readUpdatedResource),
            },
          });
          expect(privateDavWriteSucceeded(deletedResource)).toBe(true);
          expect(
            privateDavLifecycleSucceeded(
              principalDiscovery,
              collectionDiscovery,
              createdResource,
              readCreatedResource,
              updatedResource,
              readUpdatedResource,
              deletedResource,
            ),
          ).toBe(true);
        } finally {
          // This only deletes this random resource after verifying its UID and
          // current strong ETag. Cleanup failure never masks the test failure.
          await bestEffortDeleteOwnedPrivateDavResource(
            requestBase,
            resourceUrl,
            eventUid,
          );
        }

        const memberBContext = await makeContext();
        const memberBPage = await authenticateInElement(
          memberBContext,
          fixture.users.memberB,
        );
        const memberBRoom = await openFixtureRoom(
          memberBPage,
          fixture.roomName,
          fixture.teamRoomId,
        );
        const memberBFrame = await openCalendarWidget(
          memberBRoom,
          memberBPage,
          { expectWidgetWarning: true },
        );
        const memberBDialogList = waitForPrivateClientResponse(
          memberBPage,
          'GET',
        );
        await memberBFrame
          .getByRole('button', {
            name: 'Calendar app access',
            exact: true,
          })
          .click();
        const memberBDialog = memberBFrame.getByRole('dialog').last();
        expect((await memberBDialogList).status()).toBe(403);
        await expect(
          memberBDialog.getByRole('button', {
            name: 'Create app access',
            exact: true,
          }),
        ).toHaveCount(0);

        const outsiderContext = await makeContext();
        const outsiderPage = await authenticateInElement(
          outsiderContext,
          fixture.users.outsider,
        );
        const outsiderRoom = await openFixtureRoom(
          outsiderPage,
          fixture.outsiderRoomName,
          fixture.outsiderRoomId,
        );
        await openCalendarWidget(outsiderRoom, outsiderPage, {
          expectWidgetWarning: false,
          waitForCalendar: false,
        });
        const outsiderPrivateClientStatus =
          await requestPrivateClientListStatus(
            outsiderPage,
            fixture.gatewayUrl,
            fixture.teamRoomId,
            fixture.calendarId,
          );
        expect(outsiderPrivateClientStatus).toBe(403);

        const revokeResponse = waitForPrivateClientResponse(pageA, 'DELETE');
        await reopenedDialogA
          .getByRole('button', { name: 'Revoke', exact: true })
          .click();
        await reopenedDialogA
          .getByRole('button', { name: 'Revoke access', exact: true })
          .click();
        expect((await revokeResponse).status()).toBe(200);
        await expect(
          reopenedDialogA.getByText('Status: Revoked', { exact: true }),
        ).toBeVisible();

        const davAfterRevoke = await requestPrivateDav({
          ...requestBase,
          url: resourceUrl,
          method: 'GET',
        });
        expect(revokedPrivateDavCredentialDenied(davAfterRevoke)).toBe(true);
        expect(blockedExternalRequests).toBe(0);
      } finally {
        await Promise.all(
          contexts.map((context) => context.close().catch(() => undefined)),
        );
      }
    });
  });
}
