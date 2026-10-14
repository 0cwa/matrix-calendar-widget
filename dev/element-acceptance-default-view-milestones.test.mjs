import assert from 'node:assert/strict';
import test from 'node:test';
import { createDefaultViewMilestoneRecorder } from './element-acceptance-default-view-milestones.mjs';

test('disabled milestone recording does not read the clock or publish values', () => {
  let clockReads = 0;
  let publications = 0;
  const recorder = createDefaultViewMilestoneRecorder(
    false,
    () => {
      clockReads += 1;
      return 100;
    },
    () => {
      publications += 1;
    },
  );

  assert.equal(recorder, undefined);
  assert.equal(clockReads, 0);
  assert.equal(publications, 0);
});

test('enabled recorder publishes fixed cumulative fields after each reached milestone', () => {
  const readings = [1200.508, 1400.5, 1650.125, 1700, 1800];
  const published = [];
  const recorder = createDefaultViewMilestoneRecorder(
    true,
    () => readings.shift(),
    (value) => published.push(value),
  );

  recorder.mark('widgetOpenElapsedMs');
  recorder.mark('roomRangeObservedElapsedMs');
  recorder.mark('rowsStableElapsedMs');
  recorder.mark('createControlUsableElapsedMs');
  recorder.mark('observerSettledElapsedMs');

  assert.deepEqual(Object.keys(published[0]), [
    'widgetOpenElapsedMs',
    'roomRangeObservedElapsedMs',
    'rowsStableElapsedMs',
    'createControlUsableElapsedMs',
    'observerSettledElapsedMs',
  ]);
  assert.deepEqual(published.at(-1), {
    widgetOpenElapsedMs: 1200.508,
    roomRangeObservedElapsedMs: 1400.5,
    rowsStableElapsedMs: 1650.125,
    createControlUsableElapsedMs: 1700,
    observerSettledElapsedMs: 1800,
  });
  assert.equal(published[2].observerSettledElapsedMs, null);
});

test('recorder rejects missing, out-of-order, and corrupt cumulative readings', () => {
  let clockReads = 0;
  const outOfOrder = createDefaultViewMilestoneRecorder(
    true,
    () => {
      clockReads += 1;
      return 100;
    },
    () => {},
  );
  assert.throws(
    () => outOfOrder.mark('rowsStableElapsedMs'),
    /order is invalid/u,
  );
  assert.equal(clockReads, 0);

  for (const invalidReading of [
    Number.NaN,
    Number.POSITIVE_INFINITY,
    -1,
    600_001,
  ]) {
    const recorder = createDefaultViewMilestoneRecorder(
      true,
      () => invalidReading,
      () => {},
    );
    assert.throws(
      () => recorder.mark('widgetOpenElapsedMs'),
      /value is invalid/u,
    );
  }

  let reading = 100;
  const decreasing = createDefaultViewMilestoneRecorder(
    true,
    () => reading,
    () => {},
  );
  decreasing.mark('widgetOpenElapsedMs');
  reading = 99;
  assert.throws(
    () => decreasing.mark('roomRangeObservedElapsedMs'),
    /value is invalid/u,
  );
});
