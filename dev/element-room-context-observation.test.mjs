import assert from 'node:assert/strict';
import test from 'node:test';
import {
  collectRoomReadinessTimeline,
  roomContextObservationForPhase,
} from './element-room-context-observation.mjs';

test('cancels a hanging room snapshot without waiting for its result', async () => {
  const controller = new AbortController();
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
  const controller = new AbortController();
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
