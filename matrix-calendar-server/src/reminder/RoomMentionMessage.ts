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

export interface RoomMentionMessage {
  readonly type: 'm.room.message';
  readonly content: {
    readonly msgtype: 'm.text';
    readonly body: string;
    readonly 'm.mentions': {
      readonly room: true;
    };
  };
}

/** Build the standard Matrix room-wide mention shape without user targets. */
export function buildRoomMentionMessage(body: string): RoomMentionMessage {
  if (body.trim().length === 0) {
    throw new TypeError('Room mention message body must not be empty');
  }

  return {
    type: 'm.room.message',
    content: {
      msgtype: 'm.text',
      body,
      'm.mentions': { room: true },
    },
  };
}
