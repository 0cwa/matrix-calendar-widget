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

import { GUARDS_METADATA } from '@nestjs/common/constants';
import { MatrixAuthGuard } from '../guard/MatrixAuthGuard';
import { MatrixRoomMembershipGuard } from '../guard/MatrixRoomMembershipGuard';
import { IUserContext } from '../model/IUserContext';
import { CalendarGatewayController } from './CalendarGatewayController';

describe('CalendarGatewayController', () => {
  const userContext: IUserContext = {
    userId: '@alice:example.test',
    locale: 'en',
    timezone: 'Europe/Stockholm',
  };

  it('returns the server-validated Matrix user identity', () => {
    const controller = new CalendarGatewayController();

    expect(controller.getContext(userContext)).toEqual({
      userId: '@alice:example.test',
      roomId: undefined,
    });
  });

  it('echoes a room id only after guard processing', () => {
    const controller = new CalendarGatewayController();

    expect(controller.getContext(userContext, '!team:example.test')).toEqual({
      userId: '@alice:example.test',
      roomId: '!team:example.test',
    });
  });

  it('requires Matrix authentication and optional room membership', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, CalendarGatewayController),
    ).toEqual([MatrixAuthGuard, MatrixRoomMembershipGuard]);
  });
});
