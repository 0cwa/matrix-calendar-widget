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

import { buildRoomMentionMessage } from './RoomMentionMessage';

describe('buildRoomMentionMessage', () => {
  it('builds a standard room mention without individual targets', () => {
    expect(buildRoomMentionMessage('Team reminder')).toEqual({
      type: 'm.room.message',
      content: {
        msgtype: 'm.text',
        body: 'Team reminder',
        'm.mentions': { room: true },
      },
    });
  });

  it('rejects an empty message body', () => {
    expect(() => buildRoomMentionMessage('  ')).toThrow(
      'Room mention message body must not be empty',
    );
  });
});
