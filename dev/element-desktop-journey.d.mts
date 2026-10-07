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

export type DesktopJourneySummary = {
  status: 'passed' | 'failed' | 'incomplete';
  cases: Record<DesktopJourneyPhase, DesktopJourneyOutcome | 'not_run'>;
};

export declare const DESKTOP_JOURNEY_PHASES: readonly DesktopJourneyPhase[];

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

export declare function summarizeDesktopJourneyEvidence(
  input: string,
): DesktopJourneySummary;

export declare function readDesktopJourneyEvidence(input: {
  filePath: string;
  runnerTemp: string;
}): DesktopJourneySummary;
