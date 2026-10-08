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

export type DesktopJourneySummary = {
  status: 'passed' | 'failed' | 'incomplete';
  loginStep: DesktopLoginStep;
  loginDiagnostic: DesktopLoginDiagnostic | null;
  cases: Record<DesktopJourneyPhase, DesktopJourneyOutcome | 'not_run'>;
};

export declare const DESKTOP_JOURNEY_PHASES: readonly DesktopJourneyPhase[];
export declare const DESKTOP_LOGIN_STEPS: readonly DesktopLoginStep[];
export declare const DESKTOP_LOGIN_FAILURE_REASONS: readonly DesktopLoginFailureReason[];

export declare function classifyDesktopLoginFailure(
  error: unknown,
  step: DesktopLoginStep,
  beforeFill: DesktopLoginFormObservation,
  atFailure: DesktopLoginFormObservation,
): DesktopLoginFailureReason;

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
  diagnostic?: DesktopLoginDiagnostic;
}): void;

export declare function summarizeDesktopJourneyEvidence(
  input: string,
): DesktopJourneySummary;

export declare function readDesktopJourneyEvidence(input: {
  filePath: string;
  runnerTemp: string;
}): DesktopJourneySummary;
