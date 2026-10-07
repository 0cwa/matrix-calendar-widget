import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPerformanceEvents,
  isSafePerformanceManifest,
  next31DayMonth,
} from './element-acceptance-performance.mjs';

test('chooses a future 31-day local calendar month', () => {
  assert.deepEqual(next31DayMonth(new Date('2026-10-07T12:00:00.000Z')), {
    year: 2026,
    month: 12,
  });
  assert.deepEqual(next31DayMonth(new Date('2026-12-01T00:00:00.000Z')), {
    year: 2026,
    month: 12,
  });
});

test('builds exactly 250 unique timed events within all 31 dates', () => {
  const events = buildPerformanceEvents(2026, 12, '12345', '2');
  assert.equal(events.length, 250);
  assert.equal(new Set(events.map(({ uid }) => uid)).size, 250);
  assert.equal(new Set(events.map(({ title }) => title)).size, 250);
  assert.deepEqual(
    Array.from(
      { length: 31 },
      (_, dayIndex) => events.filter(({ day }) => day === dayIndex + 1).length,
    ),
    [9, 9, ...Array(29).fill(8)],
  );
  for (const event of events) {
    assert.match(event.start, /^2026-12-\d{2}T\d{2}:\d{2}:00$/u);
    assert.match(event.end, /^2026-12-\d{2}T\d{2}:\d{2}:00$/u);
    assert.equal(
      Date.parse(`${event.end}Z`) - Date.parse(`${event.start}Z`),
      30 * 60_000,
    );
  }
});

test('accepts only the fixed run-scoped manifest shape', () => {
  const events = Array.from({ length: 250 }, (_, index) => ({
    resourceName: `element-performance-12345-2-${String(index + 1).padStart(3, '0')}.ics`,
    etag: '"etag"',
  }));
  const valid = {
    version: 1,
    runId: '12345',
    attempt: '2',
    year: 2026,
    month: 12,
    events,
  };
  assert.equal(isSafePerformanceManifest(valid, '12345', '2'), true);
  assert.equal(isSafePerformanceManifest([], '12345', '2'), true);
  assert.equal(
    isSafePerformanceManifest({ ...valid, token: 'private' }, '12345', '2'),
    false,
  );
  assert.equal(
    isSafePerformanceManifest(
      { ...valid, events: [{ resourceName: 'https://example.invalid/a.ics' }] },
      '12345',
      '2',
    ),
    false,
  );
  assert.equal(
    isSafePerformanceManifest(
      { ...valid, events: [events[0], events[0]] },
      '12345',
      '2',
    ),
    false,
  );
  assert.equal(
    isSafePerformanceManifest({ ...valid, attempt: '3' }, '12345', '2'),
    false,
  );
  assert.equal(
    isSafePerformanceManifest(
      { ...valid, events: [{ ...events[0], etag: 'W/"weak"' }] },
      '12345',
      '2',
    ),
    false,
  );
});
