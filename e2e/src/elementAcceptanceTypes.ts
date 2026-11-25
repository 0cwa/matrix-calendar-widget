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

import type { RoomReadinessTimeline } from '../../dev/element-room-context-observation.mjs';
import type { ElementWebPage } from './pages/elementWebPage';

export type User = {
  userId: string;
  accessToken: string;
  deviceId: string;
};

export type PrincipalMode = 'appservice' | 'bot-account';

export type Fixture = {
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

export type G6Phase =
  | 'g6-fixture-ready'
  | 'g6-unsupported-preservation'
  | 'g6-delete-and-refresh'
  | 'g6-keyboard-focus'
  | 'g6-side-panel-layout'
  | 'g6-browser-egress'
  | 'g6-resource-cleanup';

export type G6NeighborTitleOutcome = 'matched' | 'mismatched' | 'unavailable';
export type G6CanonicalTitleReadbackOutcome =
  | 'not-needed'
  | 'not-owned'
  | 'matched'
  | 'mismatched'
  | 'unavailable';
export type G6PostSaveListResponseOutcome =
  | 'not-observed'
  | 'decoding'
  | 'unexpected-status'
  | 'decode-error'
  | 'invalid-response'
  | 'decoded'
  | 'decoded-overflow';

export type G6PostSaveListResponseObservation = {
  outcome: G6PostSaveListResponseOutcome;
  httpStatus: number | null;
  eventCountCapped?: number;
  eventCountOverflow?: boolean;
  editedTitleMatches?: boolean;
};

export type G6PostSaveListObserver = {
  snapshot: () => G6PostSaveListResponseObservation;
  dispose: () => void;
};

export type G6PostSaveListUiObservation =
  | {
      state: 'observed';
      loadingVisible: boolean;
      errorVisible: boolean;
      editedRowCountCapped: number;
      editedRowCountOverflow: boolean;
      editedRowVisible: boolean;
    }
  | { state: 'unavailable' };

export type G6SidePanelControlVisibility =
  | 'absent'
  | 'visible'
  | 'hidden'
  | 'ambiguous'
  | 'unavailable';
export type G6SidePanelControlEnabled =
  | 'absent'
  | 'enabled'
  | 'disabled'
  | 'ambiguous'
  | 'unavailable';
export type G6SidePanelToolbarObservation = {
  managementToolbarNavCountCapped: number | null;
  managementToolbarNavVisibility: G6SidePanelControlVisibility;
  createEventButtonCountCapped: number | null;
  createEventButtonVisibility: G6SidePanelControlVisibility;
  createEventButtonEnabled: G6SidePanelControlEnabled;
};
export type G6KeyboardFocusTarget =
  | 'edit'
  | 'delete'
  | 'close'
  | 'dialog-content'
  | 'other'
  | 'outside'
  | 'unavailable';
export type G6KeyboardTabFocusObservation = {
  activeTarget: G6KeyboardFocusTarget;
  frameHasFocus: boolean;
};

export type G6StageRecord = {
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

export type G6SeedCreateObservation = {
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

export type MemberRoomContextPhase =
  | 'member-a-room-context'
  | 'reminder-room-context'
  | 'g6-member-a-room-context'
  | 'g6-member-b-room-context';

export type MatrixSyncState =
  | 'ERROR'
  | 'PREPARED'
  | 'RECONNECTING'
  | 'STOPPED'
  | 'SYNCING'
  | 'CATCHUP'
  | 'UNKNOWN';

export type OuterRenderBucket =
  | 'room-page'
  | 'other-page'
  | 'no-shell'
  | 'inconsistent'
  | 'unavailable';
export type MatrixChatViewBucket = 'logged-in' | 'other-view' | 'unavailable';
export type MatrixChatPageTypeBucket =
  | 'room-view'
  | 'other-page'
  | 'missing'
  | 'unavailable';
export type RoomNavigationReadinessSnapshot = {
  firstSyncComplete: boolean | null;
  ready: boolean | null;
  pageType: MatrixChatPageTypeBucket;
  currentRoomMatches: boolean | null;
  matrixSyncState: MatrixSyncState;
};
export type RoomNavigationReadinessObservation = {
  beforeNavigation: RoomNavigationReadinessSnapshot;
  afterRoute: RoomNavigationReadinessSnapshot;
};

export type MemberARoomObservation = {
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
  matrixChatFirstSyncComplete: boolean | null;
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
export type MemberARoomFailureCode =
  | 'element-room-navigation-failed'
  | 'element-room-observation-unavailable'
  | 'element-room-session-mismatch'
  | 'element-room-not-known'
  | 'element-room-not-joined'
  | 'element-room-route-mismatch'
  | 'element-room-heading-not-present'
  | 'element-room-name-mismatch'
  | 'element-room-heading-wait-timeout';

export type MemberARoomResult = {
  element: ElementWebPage;
  navigationCompleted: boolean;
  observation?: MemberARoomObservation;
  roomReadinessTimeline?: RoomReadinessTimeline;
  roomNavigationReadiness?: RoomNavigationReadinessObservation;
  failureCode?: MemberARoomFailureCode;
};

export type OpenCalendarWidgetOptions = {
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
