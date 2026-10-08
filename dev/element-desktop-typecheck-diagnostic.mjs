import { spawn as nodeSpawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, '..');
const ARTIFACT_FILENAME = 'element-desktop-typecheck-safe-diagnostics.json';
const MAX_CAPTURED_BYTES = 1024 * 1024;
const MAX_REPORTED_DIAGNOSTICS = 25;
const MAX_DIAGNOSTIC_COUNT = 255;
const MAX_COORDINATE = 10_000_000;
const MAX_DIAGNOSTIC_CODE = 999_999_999;

const SOURCE_CATEGORIES = Object.freeze({
  'dev/element-acceptance-setup.mjs': 'desktop-setup',
  'dev/element-desktop-egress-policy.mjs': 'desktop-policy',
  'dev/element-desktop-egress-policy.test.mjs': 'desktop-policy-tests',
  'dev/element-desktop-evidence.mjs': 'desktop-evidence',
  'dev/element-desktop-evidence.test.mjs': 'desktop-evidence-tests',
  'dev/element-desktop-frame-origin.d.mts': 'desktop-declarations',
  'dev/element-desktop-frame-origin.mjs': 'desktop-helper',
  'dev/element-desktop-frame-origin.test.mjs': 'desktop-helper-tests',
  'dev/element-desktop-journey.d.mts': 'desktop-declarations',
  'dev/element-desktop-journey.mjs': 'desktop-helper',
  'dev/element-desktop-journey.test.mjs': 'desktop-helper-tests',
  'dev/element-desktop-journey-runner.mjs': 'desktop-runner',
  'dev/element-desktop-journey-runner.test.mjs': 'desktop-runner-tests',
  'dev/element-desktop-startup.mjs': 'desktop-startup',
  'dev/element-desktop-startup.test.mjs': 'desktop-startup-tests',
  'e2e/playwright.element-desktop-acceptance.config.ts': 'desktop-e2e-config',
  'e2e/src/elementDesktopCalendarAcceptance.spec.ts': 'desktop-e2e',
});

const PROCESS_STATES = new Set([
  'completed-success',
  'completed-nonzero',
  'spawn-error',
  'signal-terminated',
  'capture-error',
  'unknown-termination',
]);

const ANSI_ESCAPE = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const TYPESCRIPT_ERROR_CODE = /\berror TS(\d+):/;

function boundedInteger(value, max) {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= max
    ? parsed
    : null;
}

function sourceCategoryFor(filePath) {
  if (!filePath) return 'unclassified';

  const normalized = filePath
    .replaceAll('\\', '/')
    .replace(/^\.\//, '')
    .replace(/^'+|'+$/g, '')
    .replace(/^"+|"+$/g, '');

  for (const [trackedPath, category] of Object.entries(SOURCE_CATEGORIES)) {
    if (normalized === trackedPath || normalized.endsWith(`/${trackedPath}`)) {
      return category;
    }
  }

  return 'other';
}

function parseDiagnosticLocation(prefix) {
  const location = prefix.trim().replace(/\s+-$/, '').replace(/:$/, '');
  const parenthesized = /^(.*)\((\d+),(\d+)\)$/.exec(location);
  const colonSeparated = /^(.*):(\d+):(\d+)$/.exec(location);
  const match = parenthesized ?? colonSeparated;

  if (!match) {
    return { filePath: location || null, line: null, column: null };
  }

  return {
    filePath: match[1] || null,
    line: boundedInteger(match[2], MAX_COORDINATE),
    column: boundedInteger(match[3], MAX_COORDINATE),
  };
}

function parseDiagnosticLine(rawLine) {
  const line = rawLine.replace(ANSI_ESCAPE, '');
  const codeMatch = TYPESCRIPT_ERROR_CODE.exec(line);
  if (!codeMatch) return null;

  const code = boundedInteger(codeMatch[1], MAX_DIAGNOSTIC_CODE);
  if (code === null) return null;

  const location = parseDiagnosticLocation(line.slice(0, codeMatch.index));
  return {
    sourceCategory: sourceCategoryFor(location.filePath),
    code,
    line: location.line,
    column: location.column,
  };
}

export function summarizeTypecheckOutput({
  stdout = '',
  stderr = '',
  processState = 'completed-nonzero',
  captureOverflow = false,
} = {}) {
  const safeProcessState = PROCESS_STATES.has(processState)
    ? processState
    : 'capture-error';
  const diagnostics = [];
  let diagnosticCount = 0;
  let overflow = Boolean(captureOverflow);

  for (const line of `${stdout}\n${stderr}`.split(/\r?\n/)) {
    const diagnostic = parseDiagnosticLine(line);
    if (!diagnostic) continue;

    if (diagnosticCount < MAX_DIAGNOSTIC_COUNT) {
      diagnosticCount += 1;
    } else {
      overflow = true;
    }

    if (diagnostics.length < MAX_REPORTED_DIAGNOSTICS) {
      diagnostics.push(diagnostic);
    } else {
      overflow = true;
    }
  }

  return {
    processState: safeProcessState,
    diagnosticCount,
    overflow,
    diagnostics,
  };
}

function exitCodeForSignal(signal) {
  if (!signal) return 1;
  const signalNumber = os.constants.signals[signal];
  return Number.isInteger(signalNumber) ? Math.min(255, 128 + signalNumber) : 1;
}

export function runTypecheck({
  spawnImpl = nodeSpawn,
  repositoryRoot = REPOSITORY_ROOT,
} = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnImpl('yarn', ['tsc'], {
        cwd: repositoryRoot,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch {
      resolve({
        summary: summarizeTypecheckOutput({ processState: 'spawn-error' }),
        exitCode: 127,
      });
      return;
    }

    const captured = { stdout: [], stderr: [] };
    let capturedBytes = 0;
    let captureOverflow = false;
    let captureFailed = false;
    let spawnFailed = false;

    const capture = (stream, destination) => {
      if (!stream) {
        captureFailed = true;
        return;
      }

      stream.on('data', (chunk) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        const available = Math.max(0, MAX_CAPTURED_BYTES - capturedBytes);
        if (available > 0) {
          const retained = buffer.subarray(0, available);
          destination.push(retained);
          capturedBytes += retained.length;
        }
        if (buffer.length > available) captureOverflow = true;
      });
      stream.on('error', () => {
        captureFailed = true;
      });
    };

    capture(child.stdout, captured.stdout);
    capture(child.stderr, captured.stderr);
    child.on('error', () => {
      spawnFailed = true;
    });
    child.on('close', (code, signal) => {
      let processState;
      if (spawnFailed) {
        processState = 'spawn-error';
      } else if (captureFailed) {
        processState = 'capture-error';
      } else if (signal) {
        processState = 'signal-terminated';
      } else if (code === 0) {
        processState = 'completed-success';
      } else if (typeof code === 'number') {
        processState = 'completed-nonzero';
      } else {
        processState = 'unknown-termination';
      }

      const summary = summarizeTypecheckOutput({
        stdout: Buffer.concat(captured.stdout).toString('utf8'),
        stderr: Buffer.concat(captured.stderr).toString('utf8'),
        processState,
        captureOverflow,
      });
      const exitCode =
        typeof code === 'number'
          ? code
          : signal
            ? exitCodeForSignal(signal)
            : 127;
      resolve({ summary, exitCode });
    });
  });
}

async function main() {
  const result = await runTypecheck();
  const serialized = `${JSON.stringify(result.summary)}\n`;
  const artifactDirectory = process.env.RUNNER_TEMP || os.tmpdir();
  const artifactPath = path.join(artifactDirectory, ARTIFACT_FILENAME);

  try {
    await writeFile(artifactPath, serialized, {
      encoding: 'utf8',
      mode: 0o600,
    });
  } catch {
    // Keep the original typecheck status; stdout remains a sanitized fallback.
  }

  process.stdout.write(serialized);
  process.exitCode = result.exitCode;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
