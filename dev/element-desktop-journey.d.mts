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
  roomsTree: DesktopRoomsReadyElementObservation;
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

export type DesktopJourneySummary = {
  status: 'passed' | 'failed' | 'incomplete';
  loginStep: DesktopLoginStep;
  loginEntry: DesktopLoginEntry;
  loginDiagnostic: DesktopLoginDiagnostic | null;
  roomsReadyDiagnostic: DesktopRoomsReadyDiagnostic | null;
  cases: Record<DesktopJourneyPhase, DesktopJourneyOutcome | 'not_run'>;
};

export declare const DESKTOP_JOURNEY_PHASES: readonly DesktopJourneyPhase[];
export declare const DESKTOP_LOGIN_STEPS: readonly DesktopLoginStep[];
export declare const DESKTOP_LOGIN_FAILURE_REASONS: readonly DesktopLoginFailureReason[];
export declare const DESKTOP_LOGIN_ENTRIES: readonly DesktopLoginEntry[];

export declare function classifyDesktopLoginFailure(
  error: unknown,
  step: DesktopLoginStep,
  beforeFill: DesktopLoginFormObservation,
  atFailure: DesktopLoginFormObservation,
): DesktopLoginFailureReason;

export declare function enterDesktopPasswordLogin(input: {
  initialForm: DesktopLoginFormObservation;
  clickWelcomeSignIn: () => Promise<void>;
  observeForm: () => Promise<DesktopLoginFormObservation>;
  onBeforeFill: (form: DesktopLoginFormObservation) => void;
  fillCredentials: () => Promise<void>;
  setLoginEntry: (entry: DesktopLoginEntry) => void;
  setLoginStep: (step: DesktopLoginStep) => void;
}): Promise<DesktopLoginFormObservation>;

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
