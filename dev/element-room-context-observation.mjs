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

import { performance } from 'node:perf_hooks';

const ROOM_CONTEXT_PHASES = new Set([
  'member-a-room-context',
  'reminder-room-context',
  'g6-member-a-room-context',
  'g6-member-b-room-context',
]);
const ROOM_RENDER_DIAGNOSTIC_PHASES = new Set([
  'member-a-room-context',
  'reminder-room-context',
  'g6-member-b-room-context',
]);
const ROOM_READINESS_TIMELINE_PHASES = new Set(['g6-member-b-room-context']);
export const ROOM_RENDER_DIAGNOSTIC_FIELDS = Object.freeze([
  'outerRenderBucket',
  'matrixChatShellPresent',
  'roomViewWrapperPresent',
  'roomViewRendererPresent',
  'matrixChatStateAvailable',
  'matrixChatViewBucket',
  'matrixChatReady',
  'matrixChatPageTypeBucket',
  'matrixChatCurrentRoomMatches',
  'roomRenderStateAvailable',
  'roomViewShellVisible',
  'roomViewBodyVisible',
  'roomPreviewVisible',
  'roomPreviewLoadingVisible',
  'roomHeaderVisible',
  'roomHeaderHeadingVisible',
  'roomErrorBoundaryVisible',
]);
export const PRIVATE_UI_ROOM_READINESS_FIELDS = Object.freeze([
  'matrixUserMatches',
  'matrixRoomKnown',
  'matrixRoomJoined',
  'matrixSyncState',
  'roomNavigationCompleted',
  'roomHeadingReady',
  'roomHeadingPresent',
  'roomNameMatches',
  'roomIdMatches',
  'outerRenderBucket',
  'matrixChatShellPresent',
  'roomViewWrapperPresent',
  'roomViewRendererPresent',
  'matrixChatStateAvailable',
  'matrixChatViewBucket',
  'matrixChatReady',
  'matrixChatPageTypeBucket',
  'matrixChatCurrentRoomMatches',
  'roomRenderStateAvailable',
  'roomViewShellVisible',
  'roomViewBodyVisible',
  'roomPreviewVisible',
  'roomPreviewLoadingVisible',
  'roomHeaderVisible',
  'roomHeaderHeadingVisible',
  'roomErrorBoundaryVisible',
  'blockedRequestSeen',
]);
const PRIVATE_UI_ROOM_RENDER_FIELDS = Object.freeze([
  'roomViewShellVisible',
  'roomViewBodyVisible',
  'roomPreviewVisible',
  'roomPreviewLoadingVisible',
  'roomHeaderVisible',
  'roomHeaderHeadingVisible',
  'roomErrorBoundaryVisible',
]);
const PRIVATE_UI_ROOM_SYNC_STATES = new Set([
  'ERROR',
  'PREPARED',
  'RECONNECTING',
  'STOPPED',
  'SYNCING',
  'CATCHUP',
  'UNKNOWN',
]);
const PRIVATE_UI_ROOM_OUTER_RENDER_BUCKETS = new Set([
  'room-page',
  'other-page',
  'no-shell',
  'inconsistent',
  'unavailable',
]);
const PRIVATE_UI_ROOM_CHAT_VIEW_BUCKETS = new Set([
  'logged-in',
  'other-view',
  'unavailable',
]);
const PRIVATE_UI_ROOM_CHAT_PAGE_TYPE_BUCKETS = new Set([
  'room-view',
  'other-page',
  'missing',
  'unavailable',
]);
const ROOM_READINESS_SYNC_STATES = new Set([
  'ERROR',
  'PREPARED',
  'RECONNECTING',
  'STOPPED',
  'SYNCING',
  'CATCHUP',
  'UNKNOWN',
]);
const ROOM_READINESS_SAMPLE_OFFSETS_MS = Object.freeze(
  Array.from({ length: 15 }, (_, index) => index * 1_000),
);
export const ROOM_READINESS_SAMPLE_MAX_COUNT =
  ROOM_READINESS_SAMPLE_OFFSETS_MS.length;
export const ROOM_READINESS_SAMPLE_MAX_DURATION_MS = 15_000;
export const ROOM_READINESS_SAMPLE_TIMEOUT_MS = 350;

function isBooleanOrNull(value) {
  return typeof value === 'boolean' || value === null;
}

function validPrivateUiRoomReadinessObservation(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== PRIVATE_UI_ROOM_READINESS_FIELDS.length ||
    PRIVATE_UI_ROOM_READINESS_FIELDS.some(
      (field) => !Object.hasOwn(value, field),
    )
  ) {
    return false;
  }

  const outerPresence = [
    value.matrixChatShellPresent,
    value.roomViewWrapperPresent,
    value.roomViewRendererPresent,
  ];
  const roomRenderState = PRIVATE_UI_ROOM_RENDER_FIELDS.map(
    (field) => value[field],
  );
  const outerPresenceValid =
    value.outerRenderBucket === 'unavailable'
      ? outerPresence.every((field) => field === null)
      : outerPresence.every((field) => typeof field === 'boolean') &&
        ((value.outerRenderBucket === 'room-page' &&
          outerPresence.every(Boolean)) ||
          (value.outerRenderBucket === 'other-page' &&
            outerPresence[0] &&
            outerPresence[1] &&
            !outerPresence[2]) ||
          (value.outerRenderBucket === 'no-shell' &&
            outerPresence.every((field) => !field)) ||
          (value.outerRenderBucket === 'inconsistent' &&
            !(
              outerPresence.every(Boolean) ||
              (outerPresence[0] && outerPresence[1] && !outerPresence[2]) ||
              outerPresence.every((field) => !field)
            )));
  const chatStateValid =
    typeof value.matrixChatStateAvailable === 'boolean' &&
    PRIVATE_UI_ROOM_CHAT_VIEW_BUCKETS.has(value.matrixChatViewBucket) &&
    isBooleanOrNull(value.matrixChatReady) &&
    PRIVATE_UI_ROOM_CHAT_PAGE_TYPE_BUCKETS.has(
      value.matrixChatPageTypeBucket,
    ) &&
    isBooleanOrNull(value.matrixChatCurrentRoomMatches) &&
    (value.matrixChatStateAvailable ||
      (value.matrixChatViewBucket === 'unavailable' &&
        value.matrixChatReady === null &&
        value.matrixChatPageTypeBucket === 'unavailable' &&
        value.matrixChatCurrentRoomMatches === null));
  const roomRenderValid =
    typeof value.roomRenderStateAvailable === 'boolean' &&
    (value.roomRenderStateAvailable
      ? roomRenderState.every((field) => typeof field === 'boolean') &&
        (!value.roomViewBodyVisible || value.roomViewShellVisible) &&
        (!value.roomPreviewVisible || value.roomViewShellVisible) &&
        (!value.roomPreviewLoadingVisible || value.roomPreviewVisible) &&
        (!value.roomHeaderVisible || value.roomViewShellVisible) &&
        (!value.roomHeaderHeadingVisible || value.roomHeaderVisible) &&
        (!value.roomErrorBoundaryVisible || value.roomViewShellVisible)
      : roomRenderState.every((field) => field === null));

  return (
    [
      'matrixUserMatches',
      'matrixRoomKnown',
      'matrixRoomJoined',
      'roomNavigationCompleted',
      'roomHeadingReady',
      'roomHeadingPresent',
      'roomNameMatches',
      'roomIdMatches',
      'blockedRequestSeen',
    ].every((field) => typeof value[field] === 'boolean') &&
    PRIVATE_UI_ROOM_SYNC_STATES.has(value.matrixSyncState) &&
    PRIVATE_UI_ROOM_OUTER_RENDER_BUCKETS.has(value.outerRenderBucket) &&
    outerPresenceValid &&
    chatStateValid &&
    roomRenderValid
  );
}

export function normalizePrivateUiRoomReadinessObservation(value) {
  if (!validPrivateUiRoomReadinessObservation(value)) return undefined;
  return Object.fromEntries(
    PRIVATE_UI_ROOM_READINESS_FIELDS.map((field) => [field, value[field]]),
  );
}

/**
 * Project the existing member-A room observer into its closed private receipt.
 * The observer's numeric counters and all other fields are deliberately omitted.
 *
 * @param {unknown} observation
 * @param {unknown} blockedRequestSeen
 */
export function projectPrivateUiRoomReadinessObservation(
  observation,
  blockedRequestSeen,
) {
  if (
    observation === null ||
    typeof observation !== 'object' ||
    Array.isArray(observation) ||
    typeof blockedRequestSeen !== 'boolean'
  ) {
    return undefined;
  }
  const projected = Object.fromEntries(
    PRIVATE_UI_ROOM_READINESS_FIELDS.filter(
      (field) => field !== 'blockedRequestSeen',
    ).map((field) => [field, observation[field]]),
  );
  projected.blockedRequestSeen = blockedRequestSeen;
  return normalizePrivateUiRoomReadinessObservation(projected);
}

function unavailableRoomReadinessSample(elapsedMs) {
  return {
    elapsedMs,
    available: false,
    roomViewPresent: null,
    roomHeaderPresent: null,
    roomHeadingPresent: null,
    currentRoomMatches: null,
    matrixSyncState: 'UNKNOWN',
  };
}

function validRoomReadinessSnapshot(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(',') ===
      'currentRoomMatches,matrixSyncState,roomHeaderPresent,roomHeadingPresent,roomViewPresent' &&
    typeof value.roomViewPresent === 'boolean' &&
    typeof value.roomHeaderPresent === 'boolean' &&
    typeof value.roomHeadingPresent === 'boolean' &&
    (value.currentRoomMatches === null ||
      typeof value.currentRoomMatches === 'boolean') &&
    ROOM_READINESS_SYNC_STATES.has(value.matrixSyncState)
  );
}

function roomReadinessTimeline(outcome, samples, overflow = false) {
  return {
    outcome,
    sampleCountCapped: Math.min(
      samples.length,
      ROOM_READINESS_SAMPLE_MAX_COUNT,
    ),
    overflow,
    samples: samples.slice(0, ROOM_READINESS_SAMPLE_MAX_COUNT),
  };
}

function waitUntil(timestamp, signal) {
  if (signal.aborted) return Promise.resolve(false);
  const delayMs = Math.max(0, timestamp - performance.now());
  if (delayMs === 0) return Promise.resolve(true);
  return new Promise((resolve) => {
    const finish = (result) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      resolve(result);
    };
    const onAbort = () => finish(false);
    const timer = setTimeout(() => finish(true), delayMs);
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

function observeReadinessWithDeadline(observe, signal, timeoutMs) {
  if (signal.aborted) return Promise.resolve({ outcome: 'cancelled' });
  if (timeoutMs <= 0) return Promise.resolve({ outcome: 'unavailable' });
  return new Promise((resolve) => {
    const finish = (result) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      resolve(result);
    };
    const onAbort = () => finish({ outcome: 'cancelled' });
    const timer = setTimeout(
      () => finish({ outcome: 'unavailable' }),
      timeoutMs,
    );
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }
    Promise.resolve()
      .then(observe)
      .then(
        (value) => finish({ outcome: 'observed', value }),
        () => finish({ outcome: 'unavailable' }),
      );
  });
}

export function unavailableRoomReadinessTimeline(outcome = 'not-started') {
  return ['unavailable', 'not-started'].includes(outcome)
    ? roomReadinessTimeline(outcome, [])
    : roomReadinessTimeline('unavailable', []);
}

export async function collectRoomReadinessTimeline({ observe, signal }) {
  if (
    typeof observe !== 'function' ||
    signal === null ||
    typeof signal !== 'object' ||
    typeof signal.aborted !== 'boolean' ||
    typeof signal.addEventListener !== 'function' ||
    typeof signal.removeEventListener !== 'function'
  ) {
    return unavailableRoomReadinessTimeline('unavailable');
  }

  const startedAt = performance.now();
  const deadlineAt = startedAt + ROOM_READINESS_SAMPLE_MAX_DURATION_MS;
  const samples = [];
  for (const offsetMs of ROOM_READINESS_SAMPLE_OFFSETS_MS) {
    if (!(await waitUntil(startedAt + offsetMs, signal))) {
      return roomReadinessTimeline('cancelled', samples);
    }
    const remainingMs = deadlineAt - performance.now();
    if (remainingMs <= 0) {
      return roomReadinessTimeline('budget-exhausted', samples, true);
    }
    const elapsedMs = Math.min(
      ROOM_READINESS_SAMPLE_MAX_DURATION_MS,
      Math.max(0, Math.floor(performance.now() - startedAt)),
    );
    const observation = await observeReadinessWithDeadline(
      observe,
      signal,
      Math.min(ROOM_READINESS_SAMPLE_TIMEOUT_MS, remainingMs),
    );
    if (observation.outcome === 'cancelled') {
      return roomReadinessTimeline('cancelled', samples);
    }
    if (performance.now() > deadlineAt) {
      return roomReadinessTimeline('budget-exhausted', samples, true);
    }
    if (
      observation.outcome !== 'observed' ||
      !validRoomReadinessSnapshot(observation.value)
    ) {
      samples.push(unavailableRoomReadinessSample(elapsedMs));
      continue;
    }
    samples.push({ elapsedMs, available: true, ...observation.value });
  }

  if (!(await waitUntil(deadlineAt, signal))) {
    return roomReadinessTimeline('cancelled', samples);
  }
  return roomReadinessTimeline('budget-exhausted', samples, true);
}

export function roomContextObservationForPhase(observation, phase) {
  if (!ROOM_CONTEXT_PHASES.has(phase)) {
    throw new TypeError('invalid room context phase');
  }
  if (
    observation === null ||
    typeof observation !== 'object' ||
    Array.isArray(observation)
  ) {
    throw new TypeError('invalid room context observation');
  }

  const phaseObservation = { ...observation };
  if (!ROOM_READINESS_TIMELINE_PHASES.has(phase)) {
    delete phaseObservation.roomReadinessTimeline;
  }
  if (!ROOM_RENDER_DIAGNOSTIC_PHASES.has(phase)) {
    for (const field of ROOM_RENDER_DIAGNOSTIC_FIELDS) {
      delete phaseObservation[field];
    }
  }
  return phaseObservation;
}
