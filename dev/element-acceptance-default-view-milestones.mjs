/* Modified for Matrix Calendar Widget fork, 2026. */
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

const MAX_MILESTONE_MS = 600_000;

/** @typedef {'widgetOpenElapsedMs'|'roomRangeObservedElapsedMs'|'rowsStableElapsedMs'|'createControlUsableElapsedMs'|'observerSettledElapsedMs'} DefaultViewMilestoneName */

/**
 * @typedef {Object} DefaultViewMilestones
 * @property {number|null} widgetOpenElapsedMs
 * @property {number|null} roomRangeObservedElapsedMs
 * @property {number|null} rowsStableElapsedMs
 * @property {number|null} createControlUsableElapsedMs
 * @property {number|null} observerSettledElapsedMs
 */

const DEFAULT_VIEW_MILESTONE_NAMES = Object.freeze([
  'widgetOpenElapsedMs',
  'roomRangeObservedElapsedMs',
  'rowsStableElapsedMs',
  'createControlUsableElapsedMs',
  'observerSettledElapsedMs',
]);

/**
 * Create an opt-in recorder for cumulative elapsed times on the ordinary
 * default-view path. Disabled recorders do not read the clock or publish data.
 *
 * @param {boolean} enabled
 * @param {() => number} readElapsed
 * @param {(value: DefaultViewMilestones) => void} publish
 * @returns {{mark: (name: DefaultViewMilestoneName) => void}|undefined}
 */
export function createDefaultViewMilestoneRecorder(
  enabled,
  readElapsed,
  publish,
) {
  if (!enabled) return undefined;
  if (typeof readElapsed !== 'function' || typeof publish !== 'function') {
    throw new TypeError('Default-view milestone callbacks are required');
  }

  /** @type {DefaultViewMilestones} */
  const values = Object.fromEntries(
    DEFAULT_VIEW_MILESTONE_NAMES.map((name) => [name, null]),
  );
  let nextMilestoneIndex = 0;
  let previousElapsed = 0;
  publish({ ...values });

  return Object.freeze({
    mark(name) {
      if (name !== DEFAULT_VIEW_MILESTONE_NAMES[nextMilestoneIndex]) {
        throw new RangeError('Default-view milestone order is invalid');
      }
      const elapsed = readElapsed();
      if (
        !Number.isFinite(elapsed) ||
        elapsed < previousElapsed ||
        elapsed < 0 ||
        elapsed > MAX_MILESTONE_MS
      ) {
        throw new RangeError('Default-view milestone value is invalid');
      }
      values[name] = elapsed;
      previousElapsed = elapsed;
      nextMilestoneIndex += 1;
      publish({ ...values });
    },
  });
}
