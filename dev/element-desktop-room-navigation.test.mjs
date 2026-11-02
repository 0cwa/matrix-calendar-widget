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

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  appendDesktopJourneyOutcome,
  classifyDesktopRoomNavigationClickFailure,
  initializeDesktopJourneyEvidence,
} from './element-desktop-journey.mjs';

function appendRoomNavigationOutcome(roomNavigationDiagnostic) {
  const runnerTemp = mkdtempSync(join(tmpdir(), 'desktop-room-navigation-'));
  const filePath = join(runnerTemp, 'element-desktop-journey-stage.jsonl');
  try {
    initializeDesktopJourneyEvidence({ filePath, runnerTemp });
    appendDesktopJourneyOutcome({
      filePath,
      runnerTemp,
      phase: 'desktop-room-widget-read',
      status: 'failed',
      failurePoint: 'room-navigation',
      roomNavigationDiagnostic,
    });
  } finally {
    rmSync(runnerTemp, { recursive: true, force: true });
  }
}

function initialRoomNavigationDiagnostic(clickFailureClass) {
  const unavailableTarget = {
    countCapped: null,
    visible: null,
    enabled: null,
  };
  const unavailableRoomsReady = {
    roomList: { countCapped: null, visibility: 'unavailable' },
    matrixChatShell: { countCapped: null, visibility: 'unavailable' },
    matrixChatStateAvailable: null,
    matrixChatView: 'unavailable',
    matrixChatReady: null,
    matrixChatPageType: 'unavailable',
    matrixChatCurrentRoomKnown: null,
    matrixChatCurrentRoomMatchesExpected: null,
    matrixChatSecurityFlowView: null,
    matrixClientMatchesMemberA: null,
  };
  return {
    currentOption: unavailableTarget,
    currentRow: unavailableTarget,
    legacyTreeItem: unavailableTarget,
    roomsReady: unavailableRoomsReady,
    clickProgress: {
      targetMatched: null,
      targetVisible: null,
      targetEnabled: null,
      clickStarted: false,
      clickResolved: false,
      elapsedBucket: 'not_started',
    },
    clickFailureClass,
    clickTargetCountCapped: null,
    centerHitWithinTarget: null,
    centerHitRole: 'unavailable',
  };
}

test('classifies initial room navigation click failures without retaining error text', () => {
  const timeout = new Error('Timeout 30000ms while clicking private room');
  timeout.name = 'TimeoutError';
  const cases = [
    [
      new Error('private row intercepts pointer events'),
      'pointer_interception',
    ],
    [
      new Error('waiting for scheduled navigations to finish'),
      'navigation_wait',
    ],
    [new Error('frame was detached from private room'), 'frame_gone'],
    [timeout, 'playwright_timeout'],
    [new Error('private exception details'), 'other'],
    [{}, 'other'],
  ];

  for (const [error, expected] of cases) {
    const classification = classifyDesktopRoomNavigationClickFailure(error);
    assert.equal(classification, expected);
    assert.doesNotMatch(classification, /private|30000/u);
  }
});

test('rejects a click failure class when initial room navigation never started', () => {
  assert.doesNotThrow(() =>
    appendRoomNavigationOutcome(initialRoomNavigationDiagnostic('not_observed')),
  );
  assert.throws(
    () =>
      appendRoomNavigationOutcome(
        initialRoomNavigationDiagnostic('playwright_timeout'),
      ),
    /Invalid Desktop journey input/u,
  );
});
