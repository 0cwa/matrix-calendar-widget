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

import { Module, VersioningType } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';
import fetch from 'jest-fetch-mock';
import { MatrixClient, MemoryStorageProvider } from 'matrix-bot-sdk';
import { request as httpRequest } from 'node:http';
import { AddressInfo } from 'node:net';
import { IAppConfiguration } from '../IAppConfiguration';
import { ModuleProviderToken } from '../ModuleProviderToken';
import { MatrixCheckpointController } from '../controller/MatrixCheckpointController';
import { createCalendarGatewayHttpApplication } from '../http/CalendarGatewayHttpApplication';
import { CheckpointMatrixClient } from '../matrix/CheckpointMatrixClient';
import { MatrixAuthMiddleware } from '../middleware/MatrixAuthMiddleware';
import { PrivateCalendarClientCallbackGateway } from '../service/private-client/PrivateCalendarClientCallbackGateway';
import { PrivateCalendarClientDavGateway } from '../service/private-client/PrivateCalendarClientDavGateway';

const checkpointToken = 'synthetic-control-token-with-at-least-32-characters';
const appConfig = {
  homeserver_url: 'https://matrix.example.test',
  checkpoint_control_token: checkpointToken,
  enable_crypto: false,
  calendar_gateway_rate_limit_requests: 10,
  calendar_gateway_rate_limit_window_ms: 60_000,
  calendar_gateway_rate_limit_max_keys: 10,
} as IAppConfiguration;

const gatewayPassThrough = {
  use: (_request: Request, _response: Response, next: NextFunction) => next(),
};
const storage = new MemoryStorageProvider();
storage.storeValue('matrix_calendar_checkpoint_state', 'safe');
const matrixClient = new CheckpointMatrixClient(
  'https://matrix.example.test',
  'synthetic-bot-token',
  storage,
);
const lease = { assertActive: jest.fn(), release: jest.fn() };
jest.spyOn(matrixClient, 'pauseAtSyncBoundary').mockResolvedValue(lease);

@Module({
  imports: [
    ConfigModule.forRoot({
      ignoreEnvFile: true,
      load: [() => ({ config: appConfig })],
    }),
  ],
  controllers: [MatrixCheckpointController],
  providers: [
    { provide: ModuleProviderToken.APP_CONFIGURATION, useValue: appConfig },
    { provide: MatrixClient, useValue: matrixClient },
    {
      provide: PrivateCalendarClientCallbackGateway,
      useValue: gatewayPassThrough,
    },
    { provide: PrivateCalendarClientDavGateway, useValue: gatewayPassThrough },
    MatrixAuthMiddleware,
  ],
})
class MatrixCheckpointHttpContractModule {}

type HttpResult = {
  statusCode: number | undefined;
  body: string;
};

describe('Matrix checkpoint HTTP contract', () => {
  let app: Awaited<
    ReturnType<typeof createCalendarGatewayHttpApplication>
  >['app'];
  let baseUrl: string;

  beforeEach(async () => {
    fetch.resetMocks();
    fetch.enableMocks();
    lease.assertActive.mockClear();
    lease.release.mockClear();
    jest.spyOn(matrixClient, 'pauseAtSyncBoundary').mockResolvedValue(lease);
    const application = await createCalendarGatewayHttpApplication(
      MatrixCheckpointHttpContractModule,
      MatrixAuthMiddleware,
    );
    app = application.app;
    app.useLogger(false);
    app.enableVersioning({ type: VersioningType.URI });
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it('authenticates the custom control header without forwarding Authorization to Matrix', async () => {
    const headers = {
      'X-Matrix-Checkpoint-Token': checkpointToken,
      Authorization: 'Bearer must-not-be-forwarded',
    };
    const acquired = await send(
      'POST',
      '/v1/internal/backup-checkpoint/acquire',
      headers,
    );

    expect(acquired.statusCode).toBe(201);
    const { leaseId } = JSON.parse(acquired.body) as { leaseId: string };
    expect(leaseId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(fetch).not.toHaveBeenCalled();

    const verified = await send(
      'POST',
      `/v1/internal/backup-checkpoint/${leaseId}/verify`,
      headers,
    );
    expect(verified.statusCode).toBe(201);
    expect(JSON.parse(verified.body)).toEqual({ active: true });
    expect(fetch).not.toHaveBeenCalled();

    const released = await send(
      'POST',
      `/v1/internal/backup-checkpoint/${leaseId}/release`,
      headers,
    );
    expect(released.statusCode).toBe(201);
    expect(JSON.parse(released.body)).toEqual({ released: true });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects the wrong control token without Matrix authentication I/O', async () => {
    const rejected = await send(
      'POST',
      '/v1/internal/backup-checkpoint/acquire',
      { 'X-Matrix-Checkpoint-Token': 'wrong-token' },
    );

    expect(rejected.statusCode).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
    expect(matrixClient.pauseAtSyncBoundary).not.toHaveBeenCalled();
  });

  it('does not bypass Matrix authentication for paths outside the registered control routes', async () => {
    const rejected = await send(
      'POST',
      '/v1/internal/backup-checkpoint/acquire/extra',
      { Authorization: 'Bearer must-be-checked' },
    );

    expect(rejected.statusCode).toBe(404);
    expect(fetch).toHaveBeenCalled();
    expect(matrixClient.pauseAtSyncBoundary).not.toHaveBeenCalled();
  });

  function send(
    method: string,
    path: string,
    headers: Record<string, string>,
  ): Promise<HttpResult> {
    return new Promise((resolve, reject) => {
      const outgoing = httpRequest(
        `${baseUrl}${path}`,
        { method, headers },
        (incoming) => {
          let body = '';
          incoming.setEncoding('utf8');
          incoming.on('data', (chunk: string) => (body += chunk));
          incoming.on('end', () =>
            resolve({ statusCode: incoming.statusCode, body }),
          );
        },
      );
      outgoing.on('error', reject);
      outgoing.end();
    });
  }
});
