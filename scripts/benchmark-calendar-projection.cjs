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

const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const {
  projectCalendarEventOccurrences,
} = require('../packages/calendar/lib/utils/calendarEventOccurrenceProjection');

const range = { start: '2026-10-01T00:00:00Z', end: '2026-11-01T00:00:00Z' };
const viewerTimezone = 'Europe/Stockholm';
const samples = 3;

function event(id, start = '2026-10-15T09:00:00', recurrence) {
  return {
    id: String(id),
    calendarId: 'synthetic',
    uid: `${id}@benchmark.invalid`,
    title: 'Synthetic event',
    timing: {
      type: 'timed',
      start: { type: 'zoned', local: start, timezone: viewerTimezone },
      end: {
        type: 'zoned',
        local: start.replace('T09:00:00', 'T10:00:00'),
        timezone: viewerTimezone,
      },
    },
    ...(recurrence ? { recurrence } : {}),
  };
}

const cases = [
  {
    name: '10000 single events',
    events: Array.from({ length: 10000 }, (_, i) => event(i)),
    occurrences: 10000,
    diagnostics: 0,
  },
  {
    name: '500 daily series across fall DST',
    events: Array.from({ length: 500 }, (_, i) =>
      event(i, '2026-10-01T09:00:00', { rrule: 'FREQ=DAILY' }),
    ),
    occurrences: 15500,
    diagnostics: 0,
  },
  {
    name: '1000 weekly series',
    events: Array.from({ length: 1000 }, (_, i) =>
      event(i, '2026-10-01T09:00:00', { rrule: 'FREQ=WEEKLY' }),
    ),
    occurrences: 5000,
    diagnostics: 0,
  },
  {
    name: 'historical high frequency bounded scan',
    events: [event(0, '2010-01-01T09:00:00', { rrule: 'FREQ=SECONDLY' })],
    occurrences: 0,
    diagnostics: 1,
    expectedDiagnosticReason: 'occurrence-limit',
  },
];

const results = cases.map((scenario) => {
  const run = () => {
    const start = performance.now();
    const result = projectCalendarEventOccurrences(
      scenario.events,
      range,
      viewerTimezone,
    );
    const elapsed = performance.now() - start;
    assert.equal(
      result.occurrences.length,
      scenario.occurrences,
      scenario.name,
    );
    assert.equal(
      result.diagnostics.length,
      scenario.diagnostics,
      scenario.name,
    );
    if (scenario.expectedDiagnosticReason) {
      assert.equal(
        result.diagnostics[0].reason,
        scenario.expectedDiagnosticReason,
        scenario.name,
      );
    }
    return { elapsed, result };
  };
  run(); // Warm dependency/JIT caches; exclude this sample from measurements.
  const durations = [];
  let diagnosticReasons = [];
  for (let i = 0; i < samples; i++) {
    const { elapsed, result } = run();
    durations.push(elapsed);
    diagnosticReasons = [...new Set(result.diagnostics.map((d) => d.reason))];
  }
  durations.sort((a, b) => a - b);
  return {
    scenario: scenario.name,
    resources: scenario.events.length,
    occurrences: scenario.occurrences,
    diagnostics: scenario.diagnostics,
    diagnosticReasons,
    samples,
    medianMs: Number(durations[1].toFixed(2)),
    maxMs: Number(durations[2].toFixed(2)),
  };
});

console.log(
  JSON.stringify(
    {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      range,
      viewerTimezone,
      scope: 'Synchronous domain projection only; synthetic data; no I/O or UI',
      results,
    },
    null,
    2,
  ),
);
