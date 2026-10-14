import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const DENIAL_EVENT = 'calendar_gateway_rate_limit_denied';
const ENABLED_EVENT = 'calendar_gateway_rate_limit_diagnostics_enabled';
const METHODS = new Set([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
  'HEAD',
  'OTHER',
]);
const MAX_LOG_LINE_LENGTH = 4_096;
const MAX_EMITTED_RECORDS = 32;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, expectedKeys) {
  return (
    Object.keys(value).sort().join(',') === [...expectedKeys].sort().join(',')
  );
}

export function parseRateLimitDiagnosticLogLine(line) {
  if (typeof line !== 'string' || line.length > MAX_LOG_LINE_LENGTH)
    return null;
  let value;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;

  if (value.event === ENABLED_EVENT) {
    return hasExactKeys(value, ['event', 'enabled']) &&
      typeof value.enabled === 'boolean'
      ? { event: ENABLED_EVENT, enabled: value.enabled }
      : null;
  }

  if (value.event !== DENIAL_EVENT) return null;
  const commonKeys = [
    'activeKeyCount',
    'event',
    'limit',
    'method',
    'reason',
    'retryAfterSeconds',
    'routeClass',
    'windowMs',
  ];
  const expectedKeys =
    value.reason === 'source-window' ? [...commonKeys, 'count'] : commonKeys;
  if (
    !hasExactKeys(value, expectedKeys) ||
    !['source-window', 'source-key-cap'].includes(value.reason) ||
    !Number.isSafeInteger(value.activeKeyCount) ||
    value.activeKeyCount < 1 ||
    !Number.isSafeInteger(value.limit) ||
    value.limit < 1 ||
    !Number.isSafeInteger(value.windowMs) ||
    value.windowMs < 1 ||
    !Number.isSafeInteger(value.retryAfterSeconds) ||
    value.retryAfterSeconds < 1 ||
    !METHODS.has(value.method) ||
    value.routeClass !== 'calendar-api' ||
    (value.reason === 'source-window' &&
      (!Number.isSafeInteger(value.count) || value.count < 1))
  ) {
    return null;
  }

  return value.reason === 'source-window'
    ? {
        event: DENIAL_EVENT,
        reason: value.reason,
        count: value.count,
        activeKeyCount: value.activeKeyCount,
        limit: value.limit,
        windowMs: value.windowMs,
        retryAfterSeconds: value.retryAfterSeconds,
        method: value.method,
        routeClass: 'calendar-api',
      }
    : {
        event: DENIAL_EVENT,
        reason: value.reason,
        activeKeyCount: value.activeKeyCount,
        limit: value.limit,
        windowMs: value.windowMs,
        retryAfterSeconds: value.retryAfterSeconds,
        method: value.method,
        routeClass: 'calendar-api',
      };
}

export function classifyRoomRangeResponse(status, body) {
  if (!Number.isInteger(status) || status < 100 || status > 599) {
    return 'unknown';
  }
  if (status !== 429) return 'other';
  if (!isRecord(body)) return 'unknown';
  if (
    hasExactKeys(body, ['statusCode', 'message']) &&
    body.statusCode === 429 &&
    body.message === 'Too many requests'
  ) {
    return 'gateway-too-many-requests';
  }
  if (body.errcode === 'M_LIMIT_EXCEEDED') return 'matrix-m-limit-exceeded';
  return 'other';
}

export async function captureRateLimitDiagnosticLogLines(lines, write) {
  let enabledRecord;
  const denialRecords = [];
  for await (const line of lines) {
    const safeRecord = parseRateLimitDiagnosticLogLine(line);
    if (!safeRecord) continue;
    if (safeRecord.event === ENABLED_EVENT) {
      enabledRecord = safeRecord;
      continue;
    }
    denialRecords.push(safeRecord);
    if (denialRecords.length > MAX_EMITTED_RECORDS - 1) {
      denialRecords.shift();
    }
  }
  if (enabledRecord) write(`${JSON.stringify(enabledRecord)}\n`);
  for (const record of denialRecords) write(`${JSON.stringify(record)}\n`);
}

async function captureStdin() {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  await captureRateLimitDiagnosticLogLines(lines, (line) =>
    process.stdout.write(line),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] !== 'capture') {
    process.stderr.write('Rate-limit diagnostic capture mode is required.\n');
    process.exitCode = 2;
  } else {
    await captureStdin();
  }
}
