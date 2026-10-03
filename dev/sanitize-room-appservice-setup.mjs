#!/usr/bin/env node

// Copyright 2026 Matrix Calendar Widget contributors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  formatPersonalOpenIdSetupFailure,
  formatPersonalOpenIdSetupHttpStatus,
  formatPersonalOpenIdSetupMatrixErrorCode,
  formatPersonalOpenIdSetupStage,
  formatRoomAppServiceSetupHttpStatus,
  formatRoomAppServiceSetupMatrixErrorCode,
  formatRoomReminderSetupFailure,
  formatRoomReminderSetupHttpStatus,
  formatRoomReminderSetupMatrixErrorCode,
  formatRoomReminderSetupStage,
  getRoomAppServiceSetupStage,
} from './sanitize-caldav-contract-stage.mjs';

const ROOM_SUITE_PATH = fileURLToPath(
  new URL(
    '../matrix-calendar-server/test/integration/RoomAppServiceRadicaleContract.test.ts',
    import.meta.url,
  ),
);
const PERSONAL_OPENID_SUITE_PATH = fileURLToPath(
  new URL(
    '../matrix-calendar-server/test/integration/PersonalOpenIdRadicaleContract.test.ts',
    import.meta.url,
  ),
);
const ROOM_SUITE_REPO_PATH =
  'matrix-calendar-server/test/integration/RoomAppServiceRadicaleContract.test.ts';
const PERSONAL_OPENID_SUITE_REPO_PATH =
  'matrix-calendar-server/test/integration/PersonalOpenIdRadicaleContract.test.ts';
const ROOM_REMINDER_SUITE_PATH = fileURLToPath(
  new URL(
    '../matrix-calendar-server/test/integration/RoomReminderDeliveryContract.test.ts',
    import.meta.url,
  ),
);
const ROOM_REMINDER_SUITE_REPO_PATH =
  'matrix-calendar-server/test/integration/RoomReminderDeliveryContract.test.ts';
const ROOM_CASES = new Set([
  'exact-binding',
  'subject-binding',
  'cross-room-denial',
  'event-write',
  'unauthorized-write',
  'bot-command-write',
  'bot-command-denial',
]);
const ALLOWED_ERROR_NAMES = new Set([
  'AbortError',
  'AggregateError',
  'AssertionError',
  'AxiosError',
  'ConnectTimeoutError',
  'DOMException',
  'Error',
  'FetchError',
  'HttpError',
  'MatrixError',
  'RangeError',
  'ReferenceError',
  'ResponseError',
  'SyntaxError',
  'TypeError',
]);

function readStartedCases(stageContent) {
  const started = new Set();
  if (typeof stageContent !== 'string') return started;

  for (const line of stageContent.split(/\r?\n/)) {
    const candidate = line.trim().replace(/^room-appservice-case-start-/, '');
    if (ROOM_CASES.has(candidate)) started.add(candidate);
  }
  return started;
}

function reportText(suite) {
  const values = [
    suite?.message,
    suite?.failureMessage,
    suite?.testExecError?.message,
    suite?.testExecError?.stack,
  ];
  if (Array.isArray(suite?.assertionResults)) {
    for (const assertion of suite.assertionResults) {
      if (Array.isArray(assertion?.failureMessages)) {
        values.push(...assertion.failureMessages);
      }
    }
  }
  return values.filter((value) => typeof value === 'string').join('\n');
}

function summarizeSafeMessage(message) {
  const matrixFixtureStatus = message.match(
    /\bMatrix contract fixture request failed \(([1-5]\d\d)\)/i,
  );
  if (matrixFixtureStatus) {
    return `Matrix fixture HTTP status ${matrixFixtureStatus[1]}`;
  }

  const httpStatus = message.match(
    /\bRequest failed with status code\s+([1-5]\d\d)\b/i,
  );
  if (httpStatus) return `HTTP request failed with status ${httpStatus[1]}`;

  const matrixCode = message.match(
    /\b(M_(?:FORBIDDEN|NOT_FOUND|UNKNOWN|UNAUTHORIZED|UNKNOWN_TOKEN|INVALID_PARAM|BAD_JSON|LIMIT_EXCEEDED|MISSING_PARAM))\b/,
  );
  if (matrixCode) return `Matrix response ${matrixCode[1]}`;

  if (/\bECONNREFUSED\b/i.test(message)) return 'connection refused';
  if (/\bECONNRESET\b|\bsocket hang up\b/i.test(message)) {
    return 'connection reset';
  }
  if (/\bECONNABORTED\b/i.test(message)) return 'connection aborted';
  if (/\bENOTFOUND\b/i.test(message)) return 'host lookup failed';
  if (/\bEAI_AGAIN\b/i.test(message)) return 'temporary host lookup failure';
  if (/\bETIMEDOUT\b|\btimeout\b/i.test(message)) return 'request timed out';
  if (/\bfetch failed\b/i.test(message)) return 'fetch failed';
  if (/\bUnexpected end of JSON input\b/i.test(message)) {
    return 'invalid JSON response';
  }
  if (/\bUnexpected token\b/i.test(message)) return 'invalid JSON response';
  if (/\bCannot find module\b/i.test(message)) return 'module not found';
  if (/Synthetic Matrix contract credentials are missing/i.test(message)) {
    return 'synthetic contract credentials missing';
  }
  if (/\b(?:membership|power-level) lookup failed\b/i.test(message)) {
    return 'Matrix authorization lookup failed';
  }
  if (/\bfailed to reach\b|\brequest failed\b/i.test(message)) {
    return 'service request failed';
  }

  return 'unclassified';
}

function summarizeException(text, knownSourcePath) {
  const lines = text.split(/\r?\n/);
  let name = 'unavailable';
  let message = 'unavailable';
  let source = 'unavailable';

  for (const line of lines) {
    const match = line.match(
      /(?:^|\s)([A-Za-z_$][\w.$]*(?:Error|Exception)|Error|AssertionError):\s*(.*)$/,
    );
    if (match) {
      name = ALLOWED_ERROR_NAMES.has(match[1]) ? match[1] : 'Error';
      message = summarizeSafeMessage(match[2]);
      break;
    }
  }

  const framePattern = new RegExp(
    `(?:^|[(/])${knownSourcePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:(\\d+):(\\d+)\\)?`,
  );
  for (const line of lines) {
    const match = line.match(framePattern);
    if (match) {
      source = `${knownSourcePath}:${match[1]}:${match[2]}`;
      break;
    }
  }

  return { name, message, source };
}

function caseResultCounts(suite) {
  const counts = { total: 0, passed: 0, failed: 0, pending: 0 };
  const results = Array.isArray(suite?.assertionResults)
    ? suite.assertionResults
    : [];
  counts.total = results.length;
  for (const result of results) {
    if (result?.status === 'passed') counts.passed += 1;
    else if (result?.status === 'failed') counts.failed += 1;
    else counts.pending += 1;
  }
  return counts;
}

export function formatRoomAppServiceSetupDiagnostic(testReport, stageContent) {
  const setupStarted =
    typeof stageContent === 'string' &&
    stageContent
      .split(/\r?\n/)
      .some((line) => line.trim() === 'room-appservice-setup-start');
  const setupCompleted =
    typeof stageContent === 'string' &&
    stageContent
      .split(/\r?\n/)
      .some((line) => line.trim() === 'room-appservice-setup-complete');
  if (setupCompleted) return 'room-appservice-setup-diagnostic setup-completed';

  const startedCases = readStartedCases(stageContent);
  const suite = Array.isArray(testReport?.testResults)
    ? testReport.testResults.find((result) => result?.name === ROOM_SUITE_PATH)
    : undefined;
  if (!suite) {
    return `room-appservice-setup-diagnostic suite-not-found setup-start=${setupStarted} test-bodies=${startedCases.size}/${ROOM_CASES.size}`;
  }
  if (startedCases.size > 0) {
    return `room-appservice-setup-diagnostic not-a-setup-failure test-bodies=${startedCases.size}/${ROOM_CASES.size}`;
  }
  const suiteStatus = ['pending', 'passed', 'failed'].includes(suite.status)
    ? suite.status
    : 'unknown';
  if (suiteStatus !== 'failed') {
    return `room-appservice-setup-diagnostic suite-status-${suiteStatus} setup-start=${setupStarted}`;
  }

  const counts = caseResultCounts(suite);
  const error = summarizeException(reportText(suite), ROOM_SUITE_REPO_PATH);
  const failurePhase = setupStarted ? 'setup' : 'suite-load';
  const setupStage = getRoomAppServiceSetupStage(stageContent) ?? 'unavailable';
  const httpStatus =
    formatRoomAppServiceSetupHttpStatus(stageContent).match(
      /^room-appservice-http-status (\d{3})\n$/,
    )?.[1] ?? 'unavailable';
  const matrixErrorCode =
    formatRoomAppServiceSetupMatrixErrorCode(stageContent).match(
      /^room-appservice-matrix-error (M_[A-Z0-9_]+)\n$/,
    )?.[1] ?? 'unavailable';
  return [
    `room-appservice-${failurePhase}-test-results stage=${setupStage} http-status=${httpStatus} matrix-errcode=${matrixErrorCode} total=${counts.total} passed=${counts.passed} failed=${counts.failed} pending=${counts.pending} test-bodies-started=0/${ROOM_CASES.size}`,
    `room-appservice-${failurePhase}-exception class=${error.name} message=${JSON.stringify(error.message)} source=${error.source}`,
  ].join('\n');
}

export function formatPersonalOpenIdSetupDiagnostic(testReport, stageContent) {
  const setupStarted =
    typeof stageContent === 'string' &&
    stageContent
      .split(/\r?\n/)
      .some((line) => line.trim() === 'personal-openid-setup-start');
  const setupCompleted =
    typeof stageContent === 'string' &&
    stageContent
      .split(/\r?\n/)
      .some((line) => line.trim() === 'personal-openid-setup-complete');
  if (setupCompleted) {
    return 'personal-openid-setup-diagnostic setup-completed';
  }

  const suite = Array.isArray(testReport?.testResults)
    ? testReport.testResults.find(
        (result) => result?.name === PERSONAL_OPENID_SUITE_PATH,
      )
    : undefined;
  if (!suite) {
    return `personal-openid-setup-diagnostic suite-not-found setup-start=${setupStarted}`;
  }

  const suiteStatus = ['pending', 'passed', 'failed'].includes(suite.status)
    ? suite.status
    : 'unknown';
  if (suiteStatus !== 'failed') {
    return `personal-openid-setup-diagnostic suite-status-${suiteStatus} setup-start=${setupStarted}`;
  }

  const stage =
    formatPersonalOpenIdSetupStage(stageContent).match(
      /^personal-openid-setup-stage ([a-z-]+)\n$/,
    )?.[1] ?? 'unavailable';
  const failure =
    formatPersonalOpenIdSetupFailure(stageContent).match(
      /^personal-openid-setup-failure ([a-z-]+)\n$/,
    )?.[1] ?? 'unavailable';
  const httpStatus =
    formatPersonalOpenIdSetupHttpStatus(stageContent).match(
      /^personal-openid-http-status (\d{3})\n$/,
    )?.[1] ?? 'unavailable';
  const matrixErrorCode =
    formatPersonalOpenIdSetupMatrixErrorCode(stageContent).match(
      /^personal-openid-matrix-error (M_[A-Z0-9_]+)\n$/,
    )?.[1] ?? 'unavailable';
  const counts = caseResultCounts(suite);
  const error = summarizeException(
    reportText(suite),
    PERSONAL_OPENID_SUITE_REPO_PATH,
  );
  return [
    `personal-openid-setup-failure stage=${stage} category=${failure} http-status=${httpStatus} matrix-errcode=${matrixErrorCode} failed-case-results=${counts.failed}/${counts.total}`,
    `personal-openid-setup-exception class=${error.name} message=${JSON.stringify(error.message)} source=${error.source}`,
  ].join('\n');
}

export function formatRoomReminderSetupDiagnostic(testReport, stageContent) {
  const setupStarted =
    typeof stageContent === 'string' &&
    stageContent
      .split(/\r?\n/)
      .some((line) => line.trim() === 'room-reminder-setup-start');
  const setupCompleted =
    typeof stageContent === 'string' &&
    stageContent
      .split(/\r?\n/)
      .some((line) => line.trim() === 'room-reminder-setup-complete');
  if (setupCompleted) {
    return 'room-reminder-setup-diagnostic setup-completed';
  }

  const suite = Array.isArray(testReport?.testResults)
    ? testReport.testResults.find(
        (result) => result?.name === ROOM_REMINDER_SUITE_PATH,
      )
    : undefined;
  if (!suite) {
    return `room-reminder-setup-diagnostic suite-not-found setup-start=${setupStarted}`;
  }

  const suiteStatus = ['pending', 'passed', 'failed'].includes(suite.status)
    ? suite.status
    : 'unknown';
  if (suiteStatus !== 'failed') {
    return `room-reminder-setup-diagnostic suite-status-${suiteStatus} setup-start=${setupStarted}`;
  }

  const stage =
    formatRoomReminderSetupStage(stageContent).match(
      /^room-reminder-setup-stage ([a-z-]+)\n$/,
    )?.[1] ?? 'unavailable';
  const failure =
    formatRoomReminderSetupFailure(stageContent).match(
      /^room-reminder-setup-failure ([a-z-]+)\n$/,
    )?.[1] ?? 'unavailable';
  const httpStatus =
    formatRoomReminderSetupHttpStatus(stageContent).match(
      /^room-reminder-http-status (\d{3})\n$/,
    )?.[1] ?? 'unavailable';
  const matrixErrorCode =
    formatRoomReminderSetupMatrixErrorCode(stageContent).match(
      /^room-reminder-matrix-error (M_[A-Z0-9_]+)\n$/,
    )?.[1] ?? 'unavailable';
  const counts = caseResultCounts(suite);
  const error = summarizeException(
    reportText(suite),
    ROOM_REMINDER_SUITE_REPO_PATH,
  );
  const failurePhase = setupStarted ? 'setup' : 'suite-load';
  return [
    `room-reminder-${failurePhase}-diagnostic stage=${stage} category=${failure} http-status=${httpStatus} matrix-errcode=${matrixErrorCode} failed-case-results=${counts.failed}/${counts.total}`,
    `room-reminder-${failurePhase}-exception class=${error.name} message=${JSON.stringify(error.message)} source=${error.source}`,
  ].join('\n');
}

function emitDiagnostic(reportPath, stagePath) {
  try {
    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    const stageContent = readFileSync(stagePath, 'utf8');
    process.stdout.write(
      `${formatPersonalOpenIdSetupDiagnostic(report, stageContent)}\n`,
    );
    process.stdout.write(
      `${formatRoomAppServiceSetupDiagnostic(report, stageContent)}\n`,
    );
    process.stdout.write(
      `${formatRoomReminderSetupDiagnostic(report, stageContent)}\n`,
    );
  } catch {
    process.stdout.write('room-appservice-setup-diagnostic unavailable\n');
  }
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  const reportPath = process.argv[2];
  const stagePath = process.argv[3];
  if (!reportPath || !stagePath) {
    process.stdout.write('room-appservice-setup-diagnostic unavailable\n');
  } else {
    emitDiagnostic(reportPath, stagePath);
  }
}
