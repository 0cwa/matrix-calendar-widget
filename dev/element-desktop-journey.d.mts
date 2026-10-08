export type DesktopJourneyPhase =
  | 'desktop-login'
  | 'desktop-member-identity'
  | 'desktop-room-widget-read'
  | 'desktop-widget-origin-isolation'
  | 'desktop-event-create'
  | 'web-member-b-read'
  | 'web-member-b-keyboard-open'
  | 'web-member-b-details-escape-focus'
  | 'web-member-b-edit-save'
  | 'desktop-a-refresh'
  | 'canonical-edit-read'
  | 'web-http-route-enforcement';

export type DesktopJourneyOutcome = 'passed' | 'failed';

export type DesktopRoomWidgetFailurePoint =
  | 'room-navigation'
  | 'room-heading'
  | 'room-id'
  | 'gateway-read-await'
  | 'widget-open'
  | 'gateway-read-status'
  | 'create-control';

export type WebMemberBReadFailurePoint =
  | 'web-b-authentication'
  | 'web-b-room-navigation'
  | 'web-b-widget-open'
  | 'web-b-gateway-read-await'
  | 'web-b-gateway-read-status'
  | 'web-b-event-row';

export type WebMemberBEditSaveFailurePoint =
  | 'web-b-edit-details-open'
  | 'web-b-edit-open'
  | 'web-b-edit-title-fill'
  | 'web-b-edit-save-click'
  | 'web-b-edit-patch-await'
  | 'web-b-edit-patch-status'
  | 'web-b-edit-details-returned'
  | 'web-b-edit-details-close-click'
  | 'web-b-edit-details-close-hidden'
  | 'web-b-edit-event-row';

export type DesktopJourneyFailurePoint =
  | DesktopRoomWidgetFailurePoint
  | 'origin-isolation'
  | WebMemberBReadFailurePoint
  | WebMemberBEditSaveFailurePoint;

export type DesktopJourneyFailurePointObservation =
  | {
      phase: 'desktop-room-widget-read';
      point: DesktopRoomWidgetFailurePoint;
    }
  | {
      phase: 'desktop-widget-origin-isolation';
      point: 'origin-isolation';
    }
  | {
      phase: 'web-member-b-read';
      point: WebMemberBReadFailurePoint;
    }
  | {
      phase: 'web-member-b-edit-save';
      point: WebMemberBEditSaveFailurePoint;
    };

export type WebBEditSaveFailureDiagnostic = {
  matchedPatchStatus: number | null;
  eventListRead?: WebBEventListReadDiagnostic;
  eventRowRender?: WebBEditRowRenderDiagnostic;
};

export type WebBEditRowRenderDiagnostic =
  | {
      state: 'observed';
      // 2 represents two or more exact rows.
      editedRowCountCapped: 0 | 1 | 2;
      editedRowVisible: boolean;
      selectedRowCountCapped: 0 | 1 | 2;
      selectedRowVisible: boolean;
      // Null means the uniquely named CalendarEventsList region was unavailable.
      calendarEventsListVisibleRowCountCapped: 0 | 1 | 2 | null;
      progressbarVisible: boolean;
      errorAlertVisible: boolean;
    }
  | {
      state: 'unavailable';
      editedRowCountCapped: null;
      editedRowVisible: null;
      selectedRowCountCapped: null;
      selectedRowVisible: null;
      calendarEventsListVisibleRowCountCapped: null;
      progressbarVisible: null;
      errorAlertVisible: null;
    };

export type WebBEventListReadDiagnostic = {
  state:
    | 'awaiting-events-get'
    | 'request-pending'
    | 'request-failed'
    | 'decode-pending'
    | 'decoded'
    | 'status-not-200'
    | 'unavailable';
  // 2 represents two or more exact same-range requests/responses.
  matchingGetRequestCountCapped: 0 | 1 | 2;
  matchingGetResponseCountCapped: 0 | 1 | 2;
  // Status belongs to the first matching GET request; it can remain null if
  // a later matching request responds before the first request does.
  firstMatchedGetStatus: number | null;
  selectedEventIdentity: 'pending' | 'available' | 'unavailable';
  sameEventObserved: boolean | null;
  sameEventEditedTitleMatch: boolean | null;
};

export type DesktopLoginStep =
  | 'not_observed'
  | 'cdp_connect'
  | 'page_select'
  | 'credentials_read'
  | 'login_form_select'
  | 'welcome_sign_in'
  | 'username_fill'
  | 'password_fill'
  | 'sign_in_submit'
  | 'rooms_ready'
  | 'complete';

export type DesktopLoginFailureReason =
  | 'timeout'
  | 'strict-mode'
  | 'not-visible'
  | 'not-enabled'
  | 'detached'
  | 'other'
  | 'unavailable';

export type DesktopLoginEntry =
  | 'not_observed'
  | 'password_form_present'
  | 'welcome_sign_in_attempted'
  | 'welcome_sign_in_clicked';

export type DesktopLoginFieldObservation = {
  countCapped: 0 | 1 | 2 | null;
  visible: boolean | null;
  enabled: boolean | null;
  editable: boolean | null;
};

export type DesktopLoginFormObservation = {
  username: DesktopLoginFieldObservation;
  password: DesktopLoginFieldObservation;
};

export type DesktopLoginDiagnostic = {
  failureReason: DesktopLoginFailureReason;
  beforeFill: DesktopLoginFormObservation;
  atFailure: DesktopLoginFormObservation;
};

export type DesktopRoomsReadyElementObservation = {
  countCapped: 0 | 1 | 2 | null;
  visibility: 'absent' | 'visible' | 'hidden' | 'ambiguous' | 'unavailable';
};

export type DesktopRoomsReadyDiagnostic = {
  roomList: DesktopRoomsReadyElementObservation;
  matrixChatShell: DesktopRoomsReadyElementObservation;
  matrixChatStateAvailable: boolean | null;
  matrixChatView:
    | 'welcome'
    | 'login'
    | 'logged-in'
    | 'other-view'
    | 'missing'
    | 'unavailable';
  matrixChatReady: boolean | null;
  matrixChatPageType:
    | 'home-page'
    | 'room-view'
    | 'user-view'
    | 'other-page'
    | 'missing'
    | 'unavailable';
  matrixChatCurrentRoomKnown: boolean | null;
  matrixChatCurrentRoomMatchesExpected: boolean | null;
  matrixChatSecurityFlowView: boolean | null;
  matrixClientMatchesMemberA: boolean | null;
};

export type DesktopGatewayReadFailureDiagnostic = {
  // 2 means two or more matching-origin/path/method events GET requests.
  eventsGetCandidateCountCapped: 0 | 1 | 2 | null;
  expectedRoomCalendarGetObserved: boolean | null;
  widgetWarningObserved: boolean | null;
  widgetWarningContinued: boolean | null;
  // The capability signature is the Remember-selection switch plus Approve.
  capabilityPromptObserved: boolean | null;
  capabilityApproved: boolean | null;
  // These record the UI helper action only, not server-side OpenID success.
  identityApprovalAttempted: boolean | null;
  identityApprovalCompleted: boolean | null;
  iframeAttached: boolean | null;
  createControlVisible: boolean | null;
};

export type ReadOnlyWidgetReadinessObservation = {
  expectedEventRowCountCapped: 0 | 1 | 2 | null;
  expectedEventRowVisible: boolean | null;
  capabilityPromptVisible: boolean | null;
};

export type DesktopJourneySummary = {
  schemaVersion: 7;
  status: 'passed' | 'failed' | 'incomplete';
  loginStep: DesktopLoginStep;
  loginEntry: DesktopLoginEntry;
  loginDiagnostic: DesktopLoginDiagnostic | null;
  roomsReadyDiagnostic: DesktopRoomsReadyDiagnostic | null;
  failurePoint: DesktopJourneyFailurePointObservation | null;
  gatewayReadDiagnostic: DesktopGatewayReadFailureDiagnostic | null;
  webBEditSaveDiagnostic: WebBEditSaveFailureDiagnostic | null;
  cases: Record<DesktopJourneyPhase, DesktopJourneyOutcome | 'not_run'>;
};

export declare const DESKTOP_JOURNEY_PHASES: readonly DesktopJourneyPhase[];
export declare const DESKTOP_JOURNEY_FAILURE_POINTS: readonly DesktopJourneyFailurePoint[];
export declare const DESKTOP_LOGIN_STEPS: readonly DesktopLoginStep[];
export declare const DESKTOP_LOGIN_FAILURE_REASONS: readonly DesktopLoginFailureReason[];
export declare const DESKTOP_LOGIN_ENTRIES: readonly DesktopLoginEntry[];

export declare function classifyDesktopLoginFailure(
  error: unknown,
  step: DesktopLoginStep,
  beforeFill: DesktopLoginFormObservation,
  atFailure: DesktopLoginFormObservation,
): DesktopLoginFailureReason;

export declare function findUniqueWebBEventId(
  body: unknown,
  calendarId: string,
  title: string,
): string | null;

export declare function isBoundedWebBEventListResponse(
  headers: unknown,
): boolean;

export declare function isBoundedWebBEventListBodyLength(
  byteLength: number,
): boolean;

export declare function collectWebBEventTitleMatches(
  body: unknown,
  calendarId: string,
  editedTitle: string,
): Map<string, boolean> | null;

export declare function inspectWebBEventList(
  body: unknown,
  calendarId: string,
  eventId: string,
  editedTitle: string,
): {
  state: 'decoded' | 'unavailable';
  sameEventObserved: boolean | null;
  sameEventEditedTitleMatch: boolean | null;
};

export declare function enterDesktopPasswordLogin(input: {
  initialForm: DesktopLoginFormObservation;
  clickWelcomeSignIn: () => Promise<void>;
  observeForm: () => Promise<DesktopLoginFormObservation>;
  onBeforeFill: (form: DesktopLoginFormObservation) => void;
  fillCredentials: () => Promise<void>;
  setLoginEntry: (entry: DesktopLoginEntry) => void;
  setLoginStep: (step: DesktopLoginStep) => void;
}): Promise<DesktopLoginFormObservation>;

export declare function desktopWidgetIsReady(observation: {
  createControlCountCapped: 0 | 1 | 2 | null;
  createControlVisible: boolean | null;
  createControlEnabled: boolean | null;
  capabilityPromptVisible: boolean | null;
}): boolean;

export declare function readOnlyWidgetIsReady(
  observation: ReadOnlyWidgetReadinessObservation,
): boolean;

export declare function prepareDesktopWidget(input: {
  isReady: () => Promise<boolean>;
  isIframeVisible: () => Promise<boolean>;
  activateWidget: () => Promise<void>;
  approveWarning: () => Promise<void>;
  approveCapabilities: () => Promise<void>;
  waitForIdentityContinue: () => Promise<boolean>;
  approveIdentity: () => Promise<void>;
  waitForIframe: () => Promise<void>;
}): Promise<void>;

export declare function writeSyntheticDesktopCredentials(input: {
  filePath: string;
  runnerTemp: string;
  username: string;
  password: string;
}): void;

export declare function readSyntheticDesktopCredentials(input: {
  filePath: string;
  runnerTemp: string;
}): { username: string; password: string };

export declare function initializeDesktopJourneyEvidence(input: {
  filePath: string;
  runnerTemp: string;
}): void;

export declare function appendDesktopJourneyOutcome(input: {
  filePath: string;
  runnerTemp: string;
  phase: DesktopJourneyPhase;
  status: DesktopJourneyOutcome;
  failurePoint?: DesktopJourneyFailurePoint;
  gatewayReadDiagnostic?: DesktopGatewayReadFailureDiagnostic;
  webBEditSaveDiagnostic?: WebBEditSaveFailureDiagnostic;
}): void;

export declare function appendDesktopLoginStep(input: {
  filePath: string;
  runnerTemp: string;
  step: DesktopLoginStep;
  entry?: DesktopLoginEntry;
  diagnostic?: DesktopLoginDiagnostic;
  roomsReadyDiagnostic?: DesktopRoomsReadyDiagnostic;
}): void;

export declare function summarizeDesktopJourneyEvidence(
  input: string,
): DesktopJourneySummary;

export declare function readDesktopJourneyEvidence(input: {
  filePath: string;
  runnerTemp: string;
}): DesktopJourneySummary;
