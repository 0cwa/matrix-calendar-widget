import assert from 'node:assert/strict';
import test from 'node:test';
import {
  captureRateLimitDiagnosticLogLines,
  classifyRoomRangeResponse,
  parseRateLimitDiagnosticLogLine,
} from './element-acceptance-rate-limit-diagnostics.mjs';

test('capture accepts serialized logger events and rejects command echoes', async () => {
  const enabled = {
    event: 'calendar_gateway_rate_limit_diagnostics_enabled',
    enabled: true,
  };
  const denied = {
    event: 'calendar_gateway_rate_limit_denied',
    reason: 'source-window',
    count: 121,
    activeKeyCount: 1,
    limit: 120,
    windowMs: 60_000,
    retryAfterSeconds: 4,
    method: 'GET',
    routeClass: 'calendar-api',
  };
  const commandEcho =
    "Run: docker compose logs gateway | rg 'calendar_gateway_rate_limit_denied'";
  const unsafe = {
    ...denied,
    sourceIp: 'private-source',
  };
  const captured = [];
  await captureRateLimitDiagnosticLogLines(
    [
      commandEcho,
      JSON.stringify(enabled),
      JSON.stringify(unsafe),
      JSON.stringify(denied),
    ],
    (line) => captured.push(line),
  );
  const stdout = captured.join('');
  assert.deepEqual(
    stdout
      .trimEnd()
      .split('\n')
      .map((line) => JSON.parse(line)),
    [enabled, denied],
  );
  assert.doesNotMatch(stdout, /private-source|Run:|sourceIp/u);
});

test('capture keeps the startup boolean and a bounded tail of denial events', async () => {
  const enabled = JSON.stringify({
    event: 'calendar_gateway_rate_limit_diagnostics_enabled',
    enabled: true,
  });
  const denials = Array.from({ length: 40 }, (_, index) =>
    JSON.stringify({
      event: 'calendar_gateway_rate_limit_denied',
      reason: 'source-window',
      count: index + 1,
      activeKeyCount: 1,
      limit: 120,
      windowMs: 60_000,
      retryAfterSeconds: 4,
      method: 'GET',
      routeClass: 'calendar-api',
    }),
  );
  const captured = [];
  await captureRateLimitDiagnosticLogLines([enabled, ...denials], (line) =>
    captured.push(JSON.parse(line)),
  );

  assert.equal(captured.length, 32);
  assert.deepEqual(captured[0], JSON.parse(enabled));
  assert.equal(captured[1].count, 10);
  assert.equal(captured.at(-1).count, 40);
});

test('rate-limit response classification retains only fixed categories', () => {
  assert.equal(
    classifyRoomRangeResponse(429, {
      statusCode: 429,
      message: 'Too many requests',
    }),
    'gateway-too-many-requests',
  );
  assert.equal(
    classifyRoomRangeResponse(429, { errcode: 'M_LIMIT_EXCEEDED' }),
    'matrix-m-limit-exceeded',
  );
  assert.equal(
    classifyRoomRangeResponse(429, { errcode: 'M_FORBIDDEN' }),
    'other',
  );
  assert.equal(classifyRoomRangeResponse(429, null), 'unknown');
  assert.equal(classifyRoomRangeResponse(200, { events: [] }), 'other');
  assert.equal(classifyRoomRangeResponse(null, null), 'unknown');
});

test('the parsed logger-line helper rejects marker substrings and extra fields', () => {
  assert.equal(
    parseRateLimitDiagnosticLogLine(
      'shell command mentions calendar_gateway_rate_limit_denied',
    ),
    null,
  );
  assert.equal(
    parseRateLimitDiagnosticLogLine(
      JSON.stringify({
        event: 'calendar_gateway_rate_limit_diagnostics_enabled',
        enabled: true,
        environment: 'private',
      }),
    ),
    null,
  );
});
