import {
  appendFileSync,
  lstatSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

export const DESKTOP_JOURNEY_PHASES = Object.freeze([
  'desktop-login',
  'desktop-room-widget-read',
  'desktop-widget-origin-isolation',
  'desktop-event-create',
  'web-member-b-read',
  'web-member-b-keyboard-open',
  'web-member-b-details-escape-focus',
  'web-member-b-edit-save',
  'desktop-a-refresh',
  'canonical-edit-read',
  'web-browser-egress',
]);

const PHASE_SET = new Set(DESKTOP_JOURNEY_PHASES);
const JOURNEY_CREDENTIALS_NAME = 'element-acceptance-desktop-credentials.json';
const JOURNEY_EVIDENCE_NAME = 'element-desktop-journey-stage.jsonl';
const MAX_CREDENTIAL_BYTES = 2_048;
const MAX_EVIDENCE_BYTES = 16_384;

function invalidInput() {
  throw new Error('Invalid Desktop journey input');
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

function privateFileStat(filePath, maximumBytes) {
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
    stat.size > maximumBytes ||
    (typeof process.getuid === 'function' && stat.uid !== process.getuid())
  ) {
    invalidInput();
  }
  return stat;
}

function parseEvidence(input) {
  if (
    typeof input !== 'string' ||
    Buffer.byteLength(input) > MAX_EVIDENCE_BYTES
  ) {
    invalidInput();
  }

  const outcomes = new Map();
  const rows = input.split(/\r?\n/u).filter(Boolean);
  if (rows.length > DESKTOP_JOURNEY_PHASES.length) invalidInput();

  for (const row of rows) {
    let value;
    try {
      value = JSON.parse(row);
    } catch {
      invalidInput();
    }
    if (
      value === null ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== 'phase,status' ||
      !PHASE_SET.has(value.phase) ||
      !['passed', 'failed'].includes(value.status) ||
      outcomes.has(value.phase)
    ) {
      invalidInput();
    }
    outcomes.set(value.phase, value.status);
  }
  return outcomes;
}

export function readSyntheticDesktopCredentials({ filePath, runnerTemp }) {
  const path = privateRunnerPath(
    filePath,
    runnerTemp,
    JOURNEY_CREDENTIALS_NAME,
  );
  privateFileStat(path, MAX_CREDENTIAL_BYTES);

  let value;
  try {
    value = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
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
    invalidInput();
  }

  try {
    unlinkSync(path);
  } catch {
    invalidInput();
  }
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
  const outcomes = parseEvidence(readFileSync(path, 'utf8'));
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

export function summarizeDesktopJourneyEvidence(input) {
  const outcomes = parseEvidence(input);
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
    cases,
  };
}

export function readDesktopJourneyEvidence({ filePath, runnerTemp }) {
  const path = privateRunnerPath(filePath, runnerTemp, JOURNEY_EVIDENCE_NAME);
  privateFileStat(path, MAX_EVIDENCE_BYTES);
  return summarizeDesktopJourneyEvidence(readFileSync(path, 'utf8'));
}
