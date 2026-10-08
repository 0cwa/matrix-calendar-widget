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

const ROOM_CONTEXT_PHASES = new Set([
  'member-a-room-context',
  'reminder-room-context',
  'g6-member-a-room-context',
  'g6-member-b-room-context',
]);
const ROOM_RENDER_DIAGNOSTIC_PHASES = new Set([
  'member-a-room-context',
  'reminder-room-context',
]);
const ROOM_RENDER_DIAGNOSTIC_FIELDS = [
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
];

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
  if (!ROOM_RENDER_DIAGNOSTIC_PHASES.has(phase)) {
    for (const field of ROOM_RENDER_DIAGNOSTIC_FIELDS) {
      delete phaseObservation[field];
    }
  }
  return phaseObservation;
}
