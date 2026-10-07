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
