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

import { CanActivate, Module, Type, VersioningType } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { NestFactory } from '@nestjs/core';
import { GuardsConsumer } from '@nestjs/core/guards/guards-consumer';
import { MatrixClient } from 'matrix-bot-sdk';
import { request as httpRequest } from 'node:http';
import { AddressInfo } from 'node:net';
import { ModuleProviderToken } from '../ModuleProviderToken';
import { ReactionClient } from '../client/ReactionClient';
import { LegacyMeetingDisabledGuard } from '../guard/LegacyMeetingDisabledGuard';
import { MatrixAuthGuard } from '../guard/MatrixAuthGuard';
import { MatrixRoomMembershipGuard } from '../guard/MatrixRoomMembershipGuard';
import { MeetingService } from '../service/MeetingService';
import { RoomMessageService } from '../service/RoomMessageService';
import { MeetingController } from './MeetingController';

const meetingService = {
  createMeeting: jest.fn(),
  createBreakOutSessions: jest.fn(),
  updateMeetingDetails: jest.fn(),
  changeMessagingPermissions: jest.fn(),
  closeMeeting: jest.fn(),
  subMeetingsSendMessage: jest.fn(),
  handleParticipants: jest.fn(),
  handleWidgets: jest.fn(),
  getSharingInformationAsync: jest.fn(),
};

const matrixClient = {
  getJoinedRoomMembers: jest.fn(async () => ['@alice:example.test']),
};

@Module({
  controllers: [MeetingController],
  providers: [
    { provide: MeetingService, useValue: meetingService },
    { provide: MatrixClient, useValue: matrixClient },
    {
      provide: ModuleProviderToken.APP_CONFIGURATION,
      useValue: { enable_private_room_error_sending: false },
    },
    { provide: RoomMessageService, useValue: {} },
    { provide: ReactionClient, useValue: {} },
    LegacyMeetingDisabledGuard,
    MatrixAuthGuard,
    MatrixRoomMembershipGuard,
  ],
})
class MeetingControllerHttpContractModule {}

type HttpResult = {
  statusCode: number | undefined;
  body: string;
};

describe('MeetingController disabled transport boundary', () => {
  let app: Awaited<ReturnType<typeof NestFactory.create>>;
  let port: number;

  beforeAll(async () => {
    app = await NestFactory.create(MeetingControllerHttpContractModule, {
      logger: false,
    });
    app.enableVersioning({ type: VersioningType.URI });
    await app.listen(0, '127.0.0.1');
    port = (app.getHttpServer().address() as AddressInfo).port;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each([
    ['POST', '/v1/meeting/create', { parent_room_id: '!parent:example.test' }],
    ['PUT', '/v1/meeting/update', { room_id: '!meeting:example.test' }],
    ['POST', '/v1/meeting/close', { room_id: '!meeting:example.test' }],
    [
      'GET',
      '/v1/meeting/%21meeting%3Aexample.test/sharingInformation',
      undefined,
    ],
  ])(
    'returns 404 for %s %s before Matrix or meeting service calls',
    async (method, path, body) => {
      const response = await send(method, path, body);

      expect(response.statusCode).toBe(404);
      expect(matrixClient.getJoinedRoomMembers).not.toHaveBeenCalled();
      expect(
        Object.values(meetingService).every(
          (call) => call.mock.calls.length === 0,
        ),
      ).toBe(true);
    },
  );

  it('puts the HTTP deny guard ahead of the legacy auth and membership guards', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, MeetingController)).toEqual([
      LegacyMeetingDisabledGuard,
      MatrixAuthGuard,
      MatrixRoomMembershipGuard,
    ]);
  });

  it.each([
    'create',
    'createBreakoutSessions',
    'update',
    'changeMessagingPermissions',
    'close',
    'subMeetingsSendMessage',
    'participantsHandle',
    'widgetsHandle',
  ] as const)(
    'blocks the legacy Matrix RPC handler %s before service calls',
    async (methodName) => {
      const controller = new MeetingController(
        meetingService as unknown as MeetingService,
      );
      const handler = Reflect.get(controller, methodName) as (
        ...args: unknown[]
      ) => unknown;
      const guardTypes = Reflect.getMetadata(
        GUARDS_METADATA,
        MeetingController,
      ) as Type<CanActivate>[];
      const guards = guardTypes.map((guardType) => instantiateGuard(guardType));
      const allowed = await new GuardsConsumer().tryActivate(
        guards,
        [{}, {}],
        controller,
        handler,
        'rpc',
      );

      if (allowed) await handler.call(controller, {}, {});

      expect(allowed).toBe(false);
      expect(matrixClient.getJoinedRoomMembers).not.toHaveBeenCalled();
      expect(
        Object.values(meetingService).every(
          (call) => call.mock.calls.length === 0,
        ),
      ).toBe(true);
    },
  );

  function instantiateGuard(guardType: Type<CanActivate>): CanActivate {
    if (guardType === LegacyMeetingDisabledGuard) {
      return new LegacyMeetingDisabledGuard();
    }
    if (guardType === MatrixAuthGuard) return new MatrixAuthGuard();
    if (guardType === MatrixRoomMembershipGuard) {
      return new MatrixRoomMembershipGuard(
        matrixClient as unknown as MatrixClient,
      );
    }
    throw new Error(`Unexpected guard: ${guardType.name}`);
  }

  function send(
    method: string,
    path: string,
    body: unknown,
  ): Promise<HttpResult> {
    return new Promise((resolve, reject) => {
      const request = httpRequest(
        {
          host: '127.0.0.1',
          port,
          method,
          path,
          headers: body ? { 'content-type': 'application/json' } : undefined,
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () => {
            resolve({
              statusCode: response.statusCode,
              body: Buffer.concat(chunks).toString('utf8'),
            });
          });
        },
      );

      request.on('error', reject);
      if (body) request.write(JSON.stringify(body));
      request.end();
    });
  }
});
