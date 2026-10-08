import {
  appendFileSync,
  existsSync,
  lstatSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DESKTOP_JOURNEY_PHASES = Object.freeze([
  'desktop-login',
  'desktop-member-identity',
  'desktop-room-widget-read',
  'desktop-widget-origin-isolation',
  'desktop-event-create',
  'web-member-b-read',
  'web-member-b-keyboard-open',
  'web-member-b-details-escape-focus',
  'web-member-b-edit-save',
  'desktop-a-refresh',
  'canonical-edit-read',
  'web-http-route-enforcement',
]);
export const DESKTOP_LOGIN_STEPS = Object.freeze([
  'not_observed',
  'cdp_connect',
  'page_select',
  'credentials_read',
  'login_form_select',
  'username_fill',
  'password_fill',
  'sign_in_submit',
  'rooms_ready',
  'complete',
]);
export const DESKTOP_LOGIN_FAILURE_REASONS = Object.freeze([
  'timeout',
  'strict-mode',
  'not-visible',
  'not-enabled',
  'detached',
  'other',
  'unavailable',
]);

const PHASE_SET = new Set(DESKTOP_JOURNEY_PHASES);
const LOGIN_STEP_SET = new Set(DESKTOP_LOGIN_STEPS);
const LOGIN_FAILURE_REASON_SET = new Set(DESKTOP_LOGIN_FAILURE_REASONS);
const LOGIN_FORM_FIELD_NAMES = Object.freeze(['username', 'password']);
const JOURNEY_CREDENTIALS_NAME = 'element-acceptance-desktop-credentials.json';
const JOURNEY_EVIDENCE_NAME = 'element-desktop-journey-stage.jsonl';
const MAX_CREDENTIAL_BYTES = 2_048;
const MAX_EVIDENCE_BYTES = 16_384;

function invalidInput() {
  throw new Error('Invalid Desktop journey input');
}

function validLoginFieldObservation(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !==
      'countCapped,editable,enabled,visible' ||
    ![null, 0, 1, 2].includes(value.countCapped) ||
    ![null, true, false].includes(value.visible) ||
    ![null, true, false].includes(value.enabled) ||
    ![null, true, false].includes(value.editable)
  ) {
    return false;
  }
  return (
    value.countCapped === 1 ||
    (value.visible === null &&
      value.enabled === null &&
      value.editable === null)
  );
}

function validLoginFormObservation(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === 'password,username' &&
    LOGIN_FORM_FIELD_NAMES.every((name) =>
      validLoginFieldObservation(value[name]),
    )
  );
}

function validDesktopLoginDiagnostic(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(',') ===
      'atFailure,beforeFill,failureReason' &&
    LOGIN_FAILURE_REASON_SET.has(value.failureReason) &&
    validLoginFormObservation(value.beforeFill) &&
    validLoginFormObservation(value.atFailure)
  );
}

function safeErrorField(error, key) {
  if (error === null || typeof error !== 'object') return null;
  try {
    const value = error[key];
    if (typeof value !== 'string' || value.length > 512) return null;
    return value.toLowerCase();
  } catch {
    return null;
  }
}

function loginFieldObservation(form, field) {
  if (
    !validLoginFormObservation(form) ||
    !LOGIN_FORM_FIELD_NAMES.includes(field)
  ) {
    return null;
  }
  return form[field];
}

export function classifyDesktopLoginFailure(
  error,
  step,
  beforeFill,
  atFailure,
) {
  if (
    error === null ||
    (typeof error !== 'object' && typeof error !== 'function')
  ) {
    return 'unavailable';
  }

  const name = safeErrorField(error, 'name');
  const message = safeErrorField(error, 'message');
  const field =
    step === 'username_fill'
      ? 'username'
      : step === 'password_fill'
        ? 'password'
        : null;
  const previous = field ? loginFieldObservation(beforeFill, field) : null;
  const current = field ? loginFieldObservation(atFailure, field) : null;

  if (message?.includes('strict mode violation')) return 'strict-mode';
  if (
    (previous?.countCapped === 1 && current?.countCapped === 0) ||
    message?.includes('not attached to the dom') ||
    message?.includes('detached from the dom')
  ) {
    return 'detached';
  }
  if (
    (current?.countCapped === 1 && current.visible === false) ||
    message?.includes('element is not visible')
  ) {
    return 'not-visible';
  }
  if (
    (current?.countCapped === 1 &&
      (current.enabled === false || current.editable === false)) ||
    message?.includes('element is not enabled') ||
    message?.includes('element is not editable')
  ) {
    return 'not-enabled';
  }
  if (name === 'timeouterror' || message?.includes('timeout')) {
    return 'timeout';
  }
  return name !== null || message !== null ? 'other' : 'unavailable';
}

function privateRunnerPath(filePath, runnerTemp, expectedName) {
  if (
    typeof filePath !== 'string' ||
    typeof runnerTemp !== 'string' ||
    !isAbsolute(filePath) ||
    !isAbsolute(runnerTemp) ||
    resolve(filePath) !== resolve(runnerTemp, expectedName)
  ) {
    invalidInput();
  }
  return resolve(filePath);
}

function ownedPrivateFileStat(filePath) {
  let stat;
  try {
    stat = lstatSync(filePath);
  } catch {
    invalidInput();
  }
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    (stat.mode & 0o777) !== 0o600 ||
    (typeof process.getuid === 'function' && stat.uid !== process.getuid())
  ) {
    invalidInput();
  }
  return stat;
}

function privateFileStat(filePath, maximumBytes) {
  const stat = ownedPrivateFileStat(filePath);
  if (stat.size > maximumBytes) invalidInput();
  return stat;
}

export function writeSyntheticDesktopCredentials({
  filePath,
  runnerTemp,
  username,
  password,
}) {
  const path = privateRunnerPath(
    filePath,
    runnerTemp,
    JOURNEY_CREDENTIALS_NAME,
  );
  if (
    typeof username !== 'string' ||
    !/^element-[0-9a-f]{10}-a$/u.test(username) ||
    typeof password !== 'string' ||
    !/^[A-Za-z0-9_-]{32}$/u.test(password)
  ) {
    invalidInput();
  }

  try {
    writeFileSync(path, `${JSON.stringify({ username, password })}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
  } catch {
    invalidInput();
  }
  privateFileStat(path, MAX_CREDENTIAL_BYTES);
}

function unlinkOwnedPrivateFile(filePath, expectedStat) {
  const currentStat = ownedPrivateFileStat(filePath);
  if (
    currentStat.dev !== expectedStat.dev ||
    currentStat.ino !== expectedStat.ino
  ) {
    invalidInput();
  }
  try {
    unlinkSync(filePath);
  } catch {
    invalidInput();
  }
}

function parseEvidence(input) {
  if (
    typeof input !== 'string' ||
    Buffer.byteLength(input) > MAX_EVIDENCE_BYTES
  ) {
    invalidInput();
  }

  const outcomes = new Map();
  let loginStep = 'not_observed';
  let loginStepRecorded = false;
  let loginDiagnostic = null;
  const rows = input.split(/\r?\n/u).filter(Boolean);
  if (rows.length > DESKTOP_JOURNEY_PHASES.length + 1) invalidInput();

  for (const row of rows) {
    let value;
    try {
      value = JSON.parse(row);
    } catch {
      invalidInput();
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      invalidInput();
    }
    const keys = Object.keys(value).sort().join(',');
    if (keys === 'loginStep' || keys === 'loginDiagnostic,loginStep') {
      if (loginStepRecorded || !LOGIN_STEP_SET.has(value.loginStep)) {
        invalidInput();
      }
      if (
        Object.hasOwn(value, 'loginDiagnostic') &&
        !validDesktopLoginDiagnostic(value.loginDiagnostic)
      ) {
        invalidInput();
      }
      loginStep = value.loginStep;
      loginDiagnostic = value.loginDiagnostic ?? null;
      loginStepRecorded = true;
      continue;
    }
    if (
      Object.keys(value).sort().join(',') !== 'phase,status' ||
      !PHASE_SET.has(value.phase) ||
      !['passed', 'failed'].includes(value.status) ||
      outcomes.has(value.phase)
    ) {
      invalidInput();
    }
    outcomes.set(value.phase, value.status);
  }
  return { outcomes, loginStep, loginStepRecorded, loginDiagnostic };
}

export function readSyntheticDesktopCredentials({ filePath, runnerTemp }) {
  const path = privateRunnerPath(
    filePath,
    runnerTemp,
    JOURNEY_CREDENTIALS_NAME,
  );
  const stat = ownedPrivateFileStat(path);
  if (stat.size > MAX_CREDENTIAL_BYTES) {
    unlinkOwnedPrivateFile(path, stat);
    invalidInput();
  }

  let value;
  try {
    value = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    unlinkOwnedPrivateFile(path, stat);
    invalidInput();
  }
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== 'password,username' ||
    typeof value.username !== 'string' ||
    !/^element-[0-9a-f]{10}-a$/u.test(value.username) ||
    typeof value.password !== 'string' ||
    !/^[A-Za-z0-9_-]{32}$/u.test(value.password)
  ) {
    unlinkOwnedPrivateFile(path, stat);
    invalidInput();
  }

  unlinkOwnedPrivateFile(path, stat);
  return { username: value.username, password: value.password };
}

export function initializeDesktopJourneyEvidence({ filePath, runnerTemp }) {
  const path = privateRunnerPath(filePath, runnerTemp, JOURNEY_EVIDENCE_NAME);
  try {
    writeFileSync(path, '', { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  } catch {
    invalidInput();
  }
  privateFileStat(path, MAX_EVIDENCE_BYTES);
}

export function appendDesktopJourneyOutcome({
  filePath,
  runnerTemp,
  phase,
  status,
}) {
  const path = privateRunnerPath(filePath, runnerTemp, JOURNEY_EVIDENCE_NAME);
  privateFileStat(path, MAX_EVIDENCE_BYTES);
  const { outcomes } = parseEvidence(readFileSync(path, 'utf8'));
  if (!PHASE_SET.has(phase) || !['passed', 'failed'].includes(status)) {
    invalidInput();
  }
  if (outcomes.has(phase)) invalidInput();

  try {
    appendFileSync(path, `${JSON.stringify({ phase, status })}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
  } catch {
    invalidInput();
  }
  privateFileStat(path, MAX_EVIDENCE_BYTES);
}

export function appendDesktopLoginStep({
  filePath,
  runnerTemp,
  step,
  diagnostic,
}) {
  const path = privateRunnerPath(filePath, runnerTemp, JOURNEY_EVIDENCE_NAME);
  privateFileStat(path, MAX_EVIDENCE_BYTES);
  const parsed = parseEvidence(readFileSync(path, 'utf8'));
  if (
    !LOGIN_STEP_SET.has(step) ||
    parsed.loginStepRecorded ||
    (diagnostic !== undefined && !validDesktopLoginDiagnostic(diagnostic)) ||
    (diagnostic !== undefined && step === 'complete')
  ) {
    invalidInput();
  }

  try {
    appendFileSync(
      path,
      `${JSON.stringify({
        loginStep: step,
        ...(diagnostic === undefined ? {} : { loginDiagnostic: diagnostic }),
      })}\n`,
      {
        encoding: 'utf8',
        mode: 0o600,
      },
    );
  } catch {
    invalidInput();
  }
  privateFileStat(path, MAX_EVIDENCE_BYTES);
}

export function summarizeDesktopJourneyEvidence(input) {
  const { outcomes, loginStep, loginDiagnostic } = parseEvidence(input);
  if (outcomes.get('desktop-login') === 'passed' && loginStep !== 'complete') {
    invalidInput();
  }
  const cases = Object.fromEntries(
    DESKTOP_JOURNEY_PHASES.map((phase) => [
      phase,
      outcomes.get(phase) ?? 'not_run',
    ]),
  );
  const failed = Object.values(cases).includes('failed');
  const complete = Object.values(cases).every((value) => value === 'passed');
  return {
    status: failed ? 'failed' : complete ? 'passed' : 'incomplete',
    loginStep,
    loginDiagnostic,
    cases,
  };
}

export function readDesktopJourneyEvidence({ filePath, runnerTemp }) {
  const path = privateRunnerPath(filePath, runnerTemp, JOURNEY_EVIDENCE_NAME);
  if (!existsSync(path)) return summarizeDesktopJourneyEvidence('');
  privateFileStat(path, MAX_EVIDENCE_BYTES);
  return summarizeDesktopJourneyEvidence(readFileSync(path, 'utf8'));
}

if (
  process.argv[1] === fileURLToPath(import.meta.url) &&
  process.argv[2] === 'summary'
) {
  try {
    const runnerTemp = process.env.RUNNER_TEMP;
    const filePath = process.env.ELEMENT_DESKTOP_JOURNEY_STAGE_FILE;
    const summary = readDesktopJourneyEvidence({ filePath, runnerTemp });
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  } catch {
    process.stderr.write('Desktop journey evidence is unavailable.\n');
    process.exitCode = 1;
  }
}
