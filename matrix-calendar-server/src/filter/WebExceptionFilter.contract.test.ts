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

import {
  ArgumentsHost,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { MatrixClient } from 'matrix-bot-sdk';
import { IAppConfiguration } from '../IAppConfiguration';
import { ReactionClient } from '../client/ReactionClient';
import { LegacyMeetingDisabledGuard } from '../guard/LegacyMeetingDisabledGuard';
import { IRoomEvent } from '../matrix/event/IRoomEvent';
import { RoomMessageService } from '../service/RoomMessageService';
import { WebExceptionFilter } from './WebExceptionFilter';

describe('WebExceptionFilter legacy RPC error-room boundary', () => {
  it('does not create a private error room for a denied RPC when legacy error sending is off', async () => {
    const allowed = new LegacyMeetingDisabledGuard().canActivate({
      getType: () => 'rpc',
    } as ExecutionContext);
    const sendHtmlMessageToErrorPrivateRoom = jest.fn();
    const sendFailure = jest.fn().mockResolvedValue(undefined);
    const matrixClient = {
      getRoomStateEvent: jest.fn().mockResolvedValue({ name: 'Calendar room' }),
    } as unknown as MatrixClient;
    const adapterHost = {
      httpAdapter: { getHttpServer: () => ({}) },
    } as unknown as HttpAdapterHost;
    const filter = new WebExceptionFilter(
      { enable_private_room_error_sending: false } as IAppConfiguration,
      adapterHost,
      matrixClient,
      { sendHtmlMessageToErrorPrivateRoom } as unknown as RoomMessageService,
      { sendFailure } as unknown as ReactionClient,
    );
    const event = { event_id: '$event' } as IRoomEvent<unknown>;
    const context = {
      roomId: '!calendar:example.test',
      event,
      userContext: {
        userId: '@alice:example.test',
        requestId: 'request-1',
      },
    };
    const host = {
      getType: () => 'rpc',
      getArgByIndex: (index: number) => (index === 0 ? {} : context),
    } as unknown as ArgumentsHost;

    expect(allowed).toBe(false);
    // eslint-disable-next-line promise/valid-params -- invokes Nest's exception-filter method.
    await filter.catch(new ForbiddenException(), host);

    expect(sendHtmlMessageToErrorPrivateRoom).not.toHaveBeenCalled();
    expect(sendFailure).toHaveBeenCalledWith(
      '!calendar:example.test',
      undefined,
      '$event',
    );
  });
});
