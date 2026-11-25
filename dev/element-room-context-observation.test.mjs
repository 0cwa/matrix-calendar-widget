import assert from 'node:assert/strict';
import test from 'node:test';
import {
  collectRoomReadinessTimeline,
  createRoomNavigationReadinessObservation,
  isRoomNavigationReadinessObservation,
  roomContextObservationForPhase,
} from './element-room-context-observation.mjs';

test('cancels a hanging room snapshot without waiting for its result', async () => {
  const controller = new globalThis.AbortController();
  let observationStarted = false;
  const abortTimer = setTimeout(() => controller.abort(), 15);
  try {
    const timeline = await collectRoomReadinessTimeline({
      signal: controller.signal,
      observe: () => {
        observationStarted = true;
        return new Promise(() => {});
      },
    });
    assert.equal(observationStarted, true);
    assert.deepEqual(timeline, {
      outcome: 'cancelled',
      sampleCountCapped: 0,
      overflow: false,
      samples: [],
    });
  } finally {
    clearTimeout(abortTimer);
  }
});

test('keeps only bounded readiness values and turns malformed samples unknown', async () => {
  const controller = new globalThis.AbortController();
  const abortTimer = setTimeout(() => controller.abort(), 15);
  let timeline;
  try {
    timeline = await collectRoomReadinessTimeline({
      signal: controller.signal,
      observe: () => ({
        roomViewPresent: true,
        roomHeaderPresent: true,
        roomHeadingPresent: false,
        currentRoomMatches: false,
        matrixSyncState: 'SYNCING',
        privateRoomId: '!private:example.org',
        error: 'private Element error text',
      }),
    });
  } finally {
    clearTimeout(abortTimer);
  }

  assert.deepEqual(timeline, {
    outcome: 'cancelled',
    sampleCountCapped: 1,
    overflow: false,
    samples: [
      {
        elapsedMs: 0,
        available: false,
        roomViewPresent: null,
        roomHeaderPresent: null,
        roomHeadingPresent: null,
        currentRoomMatches: null,
        matrixSyncState: 'UNKNOWN',
      },
    ],
  });
  assert.doesNotMatch(
    JSON.stringify(timeline),
    /privateRoomId|private:example|private Element error/u,
  );

  const memberB = roomContextObservationForPhase(
    { roomReadinessTimeline: timeline },
    'g6-member-b-room-context',
  );
  assert.deepEqual(memberB, { roomReadinessTimeline: timeline });
  assert.deepEqual(
    roomContextObservationForPhase(
      { roomReadinessTimeline: timeline },
      'g6-member-a-room-context',
    ),
    {},
  );
});

test('projects finite pre-navigation and post-route MatrixChat state', () => {
  const observation = createRoomNavigationReadinessObservation(
    {
      firstSyncComplete: true,
      ready: false,
      pageType: 'other-page',
      currentRoomMatches: false,
      matrixSyncState: 'SYNCING',
      roomId: '!private:example.org',
      error: 'private Element error text',
    },
    {
      firstSyncComplete: false,
      ready: true,
      pageType: 'room-view',
      currentRoomMatches: true,
      matrixSyncState: 'PREPARED',
      rawPageType: 'private-value',
    },
  );
  assert.deepEqual(observation, {
    beforeNavigation: {
      firstSyncComplete: true,
      ready: false,
      pageType: 'other-page',
      currentRoomMatches: false,
      matrixSyncState: 'SYNCING',
    },
    afterRoute: {
      firstSyncComplete: false,
      ready: true,
      pageType: 'room-view',
      currentRoomMatches: true,
      matrixSyncState: 'PREPARED',
    },
  });
  assert.equal(isRoomNavigationReadinessObservation(observation), true);
  assert.doesNotMatch(
    JSON.stringify(observation),
    /private:example|private Element|rawPageType/u,
  );

  const unavailable = createRoomNavigationReadinessObservation(
    {
      firstSyncComplete: 'false',
      ready: 'true',
      pageType: 'private-value',
      currentRoomMatches: 'yes',
      matrixSyncState: 'private-value',
    },
    undefined,
  );
  assert.deepEqual(unavailable, {
    beforeNavigation: {
      firstSyncComplete: null,
      ready: null,
      pageType: 'unavailable',
      currentRoomMatches: null,
      matrixSyncState: 'UNKNOWN',
    },
    afterRoute: {
      firstSyncComplete: null,
      ready: null,
      pageType: 'unavailable',
      currentRoomMatches: null,
      matrixSyncState: 'UNKNOWN',
    },
  });
  assert.equal(isRoomNavigationReadinessObservation(unavailable), true);

  assert.deepEqual(
    roomContextObservationForPhase(
      { roomNavigationReadiness: observation },
      'g6-member-b-room-context',
    ),
    { roomNavigationReadiness: observation },
  );
  assert.deepEqual(
    roomContextObservationForPhase(
      { roomNavigationReadiness: observation },
      'g6-member-a-room-context',
    ),
    {},
  );
});

test('keeps MatrixChat gate fields out of the existing timeline samples', async () => {
  const controller = new globalThis.AbortController();
  const abortTimer = setTimeout(() => controller.abort(), 15);
  let timeline;
  try {
    timeline = await collectRoomReadinessTimeline({
      signal: controller.signal,
      observe: () => ({
        roomViewPresent: true,
        roomHeaderPresent: true,
        roomHeadingPresent: false,
        currentRoomMatches: true,
        matrixSyncState: 'SYNCING',
        matrixChatFirstSyncComplete: false,
        matrixChatReady: true,
        matrixChatPageTypeBucket: 'other-page',
      }),
    });
  } finally {
    clearTimeout(abortTimer);
  }
  assert.deepEqual(timeline, {
    outcome: 'cancelled',
    sampleCountCapped: 1,
    overflow: false,
    samples: [
      {
        elapsedMs: 0,
        available: true,
        roomViewPresent: true,
        roomHeaderPresent: true,
        roomHeadingPresent: false,
        currentRoomMatches: true,
        matrixSyncState: 'SYNCING',
      },
    ],
  });
});
