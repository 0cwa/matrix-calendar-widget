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

import { PowerLevelsEventContent } from 'matrix-bot-sdk';
import { canSendRoomNotification } from './MatrixRoomMentionAuthorization';

describe('canSendRoomNotification', () => {
  const userId = '@alice:example.test';

  it('uses Matrix defaults when room notification settings are omitted', () => {
    expect(
      canSendRoomNotification(userId, {
        users: { [userId]: 50 },
      }),
    ).toBe(true);
    expect(
      canSendRoomNotification(userId, {
        users: { [userId]: 49 },
      }),
    ).toBe(false);
  });

  it('uses the configured room notification threshold', () => {
    const powerLevels: PowerLevelsEventContent = {
      users: { [userId]: 40 },
      notifications: { room: 40 },
    };

    expect(canSendRoomNotification(userId, powerLevels)).toBe(true);
    expect(canSendRoomNotification('@bob:example.test', powerLevels)).toBe(
      false,
    );
  });

  it('uses users_default for actors without an explicit power level', () => {
    expect(
      canSendRoomNotification('@bob:example.test', {
        users_default: 50,
      }),
    ).toBe(true);
  });

  it('fails closed when the actor or power-level state is missing', () => {
    expect(canSendRoomNotification(undefined, {})).toBe(false);
    expect(canSendRoomNotification('', {})).toBe(false);
    expect(canSendRoomNotification(userId, undefined)).toBe(false);
  });
});
