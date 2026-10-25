import assert from 'node:assert/strict';
import test from 'node:test';
import {
  collectRoomReadinessTimeline,
  normalizePrivateUiRoomReadinessObservation,
  PRIVATE_UI_ROOM_READINESS_FIELDS,
  projectPrivateUiRoomReadinessObservation,
  roomContextObservationForPhase,
} from './element-room-context-observation.mjs';

const AbortController = globalThis.AbortController;

test('projects the existing room observer into a closed private readiness receipt', () => {
  const observation = {
    matrixUserMatches: true,
    matrixRoomKnown: true,
    matrixRoomJoined: true,
    matrixSyncState: 'SYNCING',
    roomNavigationCompleted: true,
    roomHeadingReady: false,
    roomHeadingPresent: false,
    roomNameMatches: false,
    roomIdMatches: true,
    outerRenderBucket: 'room-page',
    matrixChatShellPresent: true,
    roomViewWrapperPresent: true,
    roomViewRendererPresent: true,
    matrixChatStateAvailable: true,
    matrixChatViewBucket: 'logged-in',
    matrixChatReady: true,
    matrixChatPageTypeBucket: 'other-page',
    matrixChatCurrentRoomMatches: false,
    roomRenderStateAvailable: true,
    roomViewShellVisible: true,
    roomViewBodyVisible: true,
    roomPreviewVisible: false,
    roomPreviewLoadingVisible: false,
    roomHeaderVisible: false,
    roomHeaderHeadingVisible: false,
    roomErrorBoundaryVisible: false,
    blockedExternalRequestCount: 3,
    homeserverHttpErrorCount: 2,
    roomName: 'synthetic private room name',
    roomId: '!synthetic:example.invalid',
    error: 'synthetic private error text',
  };
  const projected = projectPrivateUiRoomReadinessObservation(observation, true);

  assert.deepEqual(Object.keys(projected), [
    ...PRIVATE_UI_ROOM_READINESS_FIELDS,
  ]);
  assert.equal(projected.matrixSyncState, 'SYNCING');
  assert.equal(projected.matrixChatCurrentRoomMatches, false);
  assert.equal(projected.blockedRequestSeen, true);
  assert.doesNotMatch(
    JSON.stringify(projected),
    /synthetic private|example\.invalid|error text|RequestCount/u,
  );
  assert.equal(
    normalizePrivateUiRoomReadinessObservation({
      ...projected,
      roomId: '!raw:example.invalid',
    }),
    undefined,
  );
  assert.equal(
    projectPrivateUiRoomReadinessObservation(
      { ...observation, matrixSyncState: 'PRIVATE_STATE' },
      false,
    ),
    undefined,
  );
  assert.equal(
    projectPrivateUiRoomReadinessObservation(observation, 'yes'),
    undefined,
  );
});

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
