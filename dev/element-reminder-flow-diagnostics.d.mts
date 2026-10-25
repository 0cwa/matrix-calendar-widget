export type ReminderFlow = 'initial' | 'restart' | 'restore';
export type ReminderFlowDiagnosticStage =
  | 'fixture'
  | 'room-context'
  | 'prior-state'
  | 'prior-state-ui-readback'
  | 'marker-creation'
  | 'marker-ui-readback'
  | 'delivery'
  | 'complete';
export type ReminderFlowTestStatus =
  | 'passed'
  | 'failed'
  | 'timedOut'
  | 'skipped'
  | 'interrupted'
  | 'unknown';
export type ReminderFlowExceptionClass =
  | 'Error'
  | 'TypeError'
  | 'ReferenceError'
  | 'RangeError'
  | 'SyntaxError'
  | 'URIError'
  | 'EvalError'
  | 'AggregateError'
  | 'TimeoutError'
  | 'unavailable';

export type ReminderFlowDiagnosticState = {
  flow: ReminderFlow;
  lastEnteredStage: ReminderFlowDiagnosticStage | null;
  lastCompletedStage: ReminderFlowDiagnosticStage | null;
  failureStage: ReminderFlowDiagnosticStage | null;
  exceptionClass: ReminderFlowExceptionClass | null;
};

export type ReminderFlowDiagnosticRecord = {
  phase: 'reminder-flow-diagnostic';
  flow: ReminderFlow;
  testStatus: ReminderFlowTestStatus;
  lastEnteredStage: ReminderFlowDiagnosticStage | null;
  lastCompletedStage: ReminderFlowDiagnosticStage | null;
  failureStage: ReminderFlowDiagnosticStage | null;
  exceptionClass: ReminderFlowExceptionClass | null;
};

export declare const REMINDER_FLOW_DIAGNOSTIC_PHASE: 'reminder-flow-diagnostic';
export declare function createReminderFlowDiagnosticState(
  flow: ReminderFlow,
): ReminderFlowDiagnosticState;
export declare function enterReminderFlowDiagnosticStage(
  state: ReminderFlowDiagnosticState,
  stage: ReminderFlowDiagnosticStage,
): void;
export declare function completeReminderFlowDiagnosticStage(
  state: ReminderFlowDiagnosticState,
  stage: ReminderFlowDiagnosticStage,
): void;
export declare function failReminderFlowDiagnostic(
  state: ReminderFlowDiagnosticState,
  error: unknown,
): void;
export declare function buildReminderFlowDiagnosticRecord(
  state: ReminderFlowDiagnosticState,
  testStatus: ReminderFlowTestStatus,
): ReminderFlowDiagnosticRecord;
export declare function isReminderFlowDiagnosticRecord(
  value: unknown,
): value is ReminderFlowDiagnosticRecord;
export declare function formatReminderFlowDiagnosticRecord(
  record: ReminderFlowDiagnosticRecord,
): string;
