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

export const REMINDER_FLOW_DIAGNOSTIC_PHASE = 'reminder-flow-diagnostic';

const FLOWS = new Set(['initial', 'restart', 'restore']);
const STAGES = new Set([
  'fixture',
  'room-context',
  'prior-state',
  'prior-state-ui-readback',
  'marker-creation',
  'marker-ui-readback',
  'delivery',
  'complete',
]);
const TEST_STATUSES = new Set([
  'passed',
  'failed',
  'timedOut',
  'skipped',
  'interrupted',
  'unknown',
]);
const EXCEPTION_CLASSES = new Set([
  'Error',
  'TypeError',
  'ReferenceError',
  'RangeError',
  'SyntaxError',
  'URIError',
  'EvalError',
  'AggregateError',
  'TimeoutError',
  'unavailable',
]);
const RECORD_KEYS = [
  'phase',
  'flow',
  'testStatus',
  'lastEnteredStage',
  'lastCompletedStage',
  'failureStage',
  'exceptionClass',
];

export function createReminderFlowDiagnosticState(flow) {
  if (!FLOWS.has(flow)) throw new TypeError('Invalid reminder flow');
  return {
    flow,
    lastEnteredStage: null,
    lastCompletedStage: null,
    failureStage: null,
    exceptionClass: null,
  };
}

export function enterReminderFlowDiagnosticStage(state, stage) {
  requireState(state);
  if (!STAGES.has(stage) || state.failureStage !== null) {
    throw new TypeError('Invalid reminder diagnostic stage');
  }
  state.lastEnteredStage = stage;
}

export function completeReminderFlowDiagnosticStage(state, stage) {
  requireState(state);
  if (
    !STAGES.has(stage) ||
    state.lastEnteredStage !== stage ||
    state.failureStage !== null
  ) {
    throw new TypeError('Invalid reminder diagnostic completion');
  }
  state.lastCompletedStage = stage;
}

export function failReminderFlowDiagnostic(state, error) {
  requireState(state);
  if (state.failureStage !== null || state.lastEnteredStage === null) return;
  state.failureStage = state.lastEnteredStage;
  state.exceptionClass = safeExceptionClass(error);
}

export function buildReminderFlowDiagnosticRecord(state, testStatus) {
  requireState(state);
  if (!TEST_STATUSES.has(testStatus)) {
    throw new TypeError('Invalid reminder test status');
  }
  return {
    phase: REMINDER_FLOW_DIAGNOSTIC_PHASE,
    flow: state.flow,
    testStatus,
    lastEnteredStage: state.lastEnteredStage,
    lastCompletedStage: state.lastCompletedStage,
    failureStage: state.failureStage,
    exceptionClass: state.exceptionClass,
  };
}

export function isReminderFlowDiagnosticRecord(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== RECORD_KEYS.length ||
    RECORD_KEYS.some((key) => !Object.hasOwn(value, key))
  ) {
    return false;
  }
  if (
    value.phase !== REMINDER_FLOW_DIAGNOSTIC_PHASE ||
    !FLOWS.has(value.flow) ||
    !TEST_STATUSES.has(value.testStatus) ||
    !nullableEnum(value.lastEnteredStage, STAGES) ||
    !nullableEnum(value.lastCompletedStage, STAGES) ||
    !nullableEnum(value.failureStage, STAGES) ||
    !(
      value.exceptionClass === null ||
      EXCEPTION_CLASSES.has(value.exceptionClass)
    )
  ) {
    return false;
  }
  if (
    (value.failureStage === null) !== (value.exceptionClass === null) ||
    (value.failureStage !== null &&
      value.failureStage !== value.lastEnteredStage) ||
    (value.testStatus === 'passed' &&
      (value.failureStage !== null ||
        value.lastEnteredStage !== 'complete' ||
        value.lastCompletedStage !== 'complete'))
  ) {
    return false;
  }
  return true;
}

export function formatReminderFlowDiagnosticRecord(record) {
  if (!isReminderFlowDiagnosticRecord(record)) {
    throw new TypeError('Invalid reminder flow diagnostic record');
  }
  return [
    `phase=${record.phase}`,
    `flow=${record.flow}`,
    `test_status=${record.testStatus}`,
    `last_entered=${record.lastEnteredStage ?? 'none'}`,
    `last_completed=${record.lastCompletedStage ?? 'none'}`,
    `failure_phase=${record.failureStage ?? 'none'}`,
    `exception_class=${record.exceptionClass ?? 'none'}`,
  ].join(' ');
}

function requireState(state) {
  if (
    state === null ||
    typeof state !== 'object' ||
    !FLOWS.has(state.flow) ||
    !nullableEnum(state.lastEnteredStage, STAGES) ||
    !nullableEnum(state.lastCompletedStage, STAGES) ||
    !nullableEnum(state.failureStage, STAGES) ||
    !(
      state.exceptionClass === null ||
      EXCEPTION_CLASSES.has(state.exceptionClass)
    )
  ) {
    throw new TypeError('Invalid reminder diagnostic state');
  }
}

function nullableEnum(value, values) {
  return value === null || values.has(value);
}

function safeExceptionClass(error) {
  if (!(error instanceof Error)) return 'unavailable';
  return EXCEPTION_CLASSES.has(error.name) && error.name !== 'unavailable'
    ? error.name
    : 'Error';
}
