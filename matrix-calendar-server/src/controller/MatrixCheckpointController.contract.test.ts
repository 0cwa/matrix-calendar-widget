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

import { Controller, Module, Post, Res, VersioningType } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';
import fetch from 'jest-fetch-mock';
import { MatrixClient, MemoryStorageProvider } from 'matrix-bot-sdk';
import { LoggerModule } from 'nestjs-pino';
import { request as httpRequest } from 'node:http';
import { AddressInfo } from 'node:net';
import { IAppConfiguration } from '../IAppConfiguration';
import { ModuleProviderToken } from '../ModuleProviderToken';
import { MatrixCheckpointController } from '../controller/MatrixCheckpointController';
import { createCalendarGatewayHttpApplication } from '../http/CalendarGatewayHttpApplication';
import {
  REQUEST_LOG_REDACT_PATHS,
  shouldIgnoreRequestLog,
} from '../http/MatrixCheckpointRequestLogging';
import { CheckpointMatrixClient } from '../matrix/CheckpointMatrixClient';
import { MatrixAuthMiddleware } from '../middleware/MatrixAuthMiddleware';
import { AppWriteFenceService } from '../service/AppWriteFenceService';
import { PrivateCalendarClientCallbackGateway } from '../service/private-client/PrivateCalendarClientCallbackGateway';
import { PrivateCalendarClientDavGateway } from '../service/private-client/PrivateCalendarClientDavGateway';

const checkpointToken = 'synthetic-control-token-with-at-least-32-characters';
const capturedRequestLogs: string[] = [];
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
let notifyWriteProbeStarted: (() => void) | undefined;
let notifyWriteProbeClosed: (() => void) | undefined;
let releaseWriteProbe: (() => void) | undefined;

@Controller({ path: 'write-probe', version: ['1'] })
class MatrixCheckpointWriteProbeController {
  @Post()
  async write(@Res() response: Response): Promise<void> {
    notifyWriteProbeStarted?.();
    response.once('close', () => notifyWriteProbeClosed?.());
    await new Promise<void>((resolve) => {
      releaseWriteProbe = resolve;
    });
    response.status(201).json({ written: true });
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({
      ignoreEnvFile: true,
      load: [() => ({ config: appConfig })],
    }),
    LoggerModule.forRoot({
      pinoHttp: [
        {
          level: 'info',
          redact: REQUEST_LOG_REDACT_PATHS,
          autoLogging: { ignore: shouldIgnoreRequestLog },
        },
        { write: (line) => capturedRequestLogs.push(line) },
      ],
    }),
  ],
  controllers: [
    MatrixCheckpointController,
    MatrixCheckpointWriteProbeController,
  ],
  providers: [
    { provide: ModuleProviderToken.APP_CONFIGURATION, useValue: appConfig },
    { provide: MatrixClient, useValue: matrixClient },
    AppWriteFenceService,
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
    capturedRequestLogs.length = 0;
    lease.assertActive.mockClear();
    lease.release.mockClear();
    notifyWriteProbeStarted = undefined;
    notifyWriteProbeClosed = undefined;
    releaseWriteProbe = undefined;
    jest
      .spyOn(matrixClient, 'pauseAtSyncBoundary')
      .mockClear()
      .mockResolvedValue(lease);
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
      '/V1/INTERNAL/BACKUP-CHECKPOINT/ACQUIRE',
      headers,
    );

    expect(acquired.statusCode).toBe(201);
    const { leaseId } = JSON.parse(acquired.body) as { leaseId: string };
    expect(leaseId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(fetch).not.toHaveBeenCalled();

    const verified = await send(
      'POST',
      `/V1/INTERNAL/BACKUP-CHECKPOINT/${leaseId}/VERIFY`,
      headers,
    );
    expect(verified.statusCode).toBe(201);
    expect(JSON.parse(verified.body)).toEqual({ active: true });
    expect(fetch).not.toHaveBeenCalled();

    const released = await send(
      'POST',
      `/V1/INTERNAL/BACKUP-CHECKPOINT/${leaseId}/RELEASE`,
      headers,
    );
    expect(released.statusCode).toBe(201);
    expect(JSON.parse(released.body)).toEqual({ released: true });
    expect(fetch).not.toHaveBeenCalled();
    expect(capturedRequestLogs).toHaveLength(0);
  });

  it('pauses Matrix and drains an admitted HTTP mutation before returning a checkpoint lease', async () => {
    const writeFence = app.get(AppWriteFenceService);
    let notifyStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    notifyWriteProbeStarted = notifyStarted;
    const finishHeldWrite = () => releaseWriteProbe?.();

    let leaseId: string | undefined;
    try {
      const inFlight = send('POST', '/v1/write-probe', {});
      await started;
      const acquire = send('POST', '/V1/INTERNAL/BACKUP-CHECKPOINT/ACQUIRE', {
        'X-Matrix-Checkpoint-Token': checkpointToken,
      });

      let fenceClosed = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const probe = writeFence.admitWrite();
        if (!probe) {
          fenceClosed = true;
          break;
        }
        probe.release();
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
      expect(fenceClosed).toBe(true);
      expect(matrixClient.pauseAtSyncBoundary).toHaveBeenCalledTimes(1);

      const newWrite = await send('POST', '/v1/write-probe', {});
      expect(newWrite.statusCode).toBe(503);

      finishHeldWrite();
      const completedWrite = await inFlight;
      expect(completedWrite.statusCode).toBe(201);
      const acquired = await acquire;
      expect(acquired.statusCode).toBe(201);
      leaseId = (JSON.parse(acquired.body) as { leaseId: string }).leaseId;
      expect(writeFence.admitWrite()).toBeUndefined();
    } finally {
      finishHeldWrite();
      if (leaseId) {
        await send(
          'POST',
          `/v1/internal/backup-checkpoint/${leaseId}/release`,
          { 'X-Matrix-Checkpoint-Token': checkpointToken },
        );
      }
    }
  });

  it('keeps a disconnected async mutation admitted until its handler ends', async () => {
    const writeFence = app.get(AppWriteFenceService);
    let notifyStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    let notifyClosed!: () => void;
    const closed = new Promise<void>((resolve) => {
      notifyClosed = resolve;
    });
    notifyWriteProbeStarted = notifyStarted;
    notifyWriteProbeClosed = notifyClosed;

    const request = httpRequest(`${baseUrl}/v1/write-probe`, {
      method: 'POST',
    });
    request.on('error', () => undefined);
    request.end();

    let acquire: Promise<HttpResult> | undefined;
    let leaseId: string | undefined;
    const finishHeldWrite = () => releaseWriteProbe?.();
    try {
      await started;
      request.destroy();
      await closed;

      acquire = send('POST', '/v1/internal/backup-checkpoint/acquire', {
        'X-Matrix-Checkpoint-Token': checkpointToken,
      });
      let fenceClosed = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const probe = writeFence.admitWrite();
        if (!probe) {
          fenceClosed = true;
          break;
        }
        probe.release();
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
      expect(fenceClosed).toBe(true);
      // Matrix sync pauses before the controller waits for admitted writes to
      // drain. The disconnected handler must still keep the app fence closed.
      expect(matrixClient.pauseAtSyncBoundary).toHaveBeenCalledTimes(1);

      finishHeldWrite();
      const acquired = await acquire;
      expect(acquired.statusCode).toBe(201);
      leaseId = (JSON.parse(acquired.body) as { leaseId: string }).leaseId;
      expect(matrixClient.pauseAtSyncBoundary).toHaveBeenCalledTimes(1);
    } finally {
      finishHeldWrite();
      if (acquire) {
        const acquired = await acquire.catch(() => undefined);
        if (!leaseId && acquired?.statusCode === 201) {
          leaseId = (JSON.parse(acquired.body) as { leaseId: string }).leaseId;
        }
      }
      if (leaseId) {
        await send(
          'POST',
          `/v1/internal/backup-checkpoint/${leaseId}/release`,
          { 'X-Matrix-Checkpoint-Token': checkpointToken },
        );
      }
    }
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

  it('redacts the checkpoint control header from ordinary HTTP request logs', async () => {
    const rejected = await send('GET', '/v1/not-a-route', {
      'X-Matrix-Checkpoint-Token': checkpointToken,
    });

    expect(rejected.statusCode).toBe(404);
    const logOutput = capturedRequestLogs.join('');
    expect(logOutput).toContain('[Redacted]');
    expect(logOutput).not.toContain(checkpointToken);
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
