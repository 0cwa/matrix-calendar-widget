/*
 * Copyright 2022 Nordeck IT + Consulting GmbH
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

import { Module, RequestMethod, VersioningType } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { NestFactory } from '@nestjs/core';
import { request } from 'http';
import { AddressInfo } from 'net';
import { IAppConfiguration } from '../IAppConfiguration';
import { ModuleProviderToken } from '../ModuleProviderToken';
import { HealthCheckController } from './HealthCheckController';

@Module({
  controllers: [HealthCheckController],
  providers: [
    {
      provide: ModuleProviderToken.APP_CONFIGURATION,
      useValue: { homeserver_url: 'https://matrix.example' },
    },
  ],
})
class HealthCheckHttpContractModule {}

describe('HealthCheckController', () => {
  const controller = new HealthCheckController({
    homeserver_url: 'https://matrix.example',
  } as IAppConfiguration);
  let app: Awaited<ReturnType<typeof NestFactory.create>>;
  let port: number;

  beforeAll(async () => {
    app = await NestFactory.create(HealthCheckHttpContractModule, {
      logger: false,
    });
    app.enableVersioning({ type: VersioningType.URI });
    await app.listen(0, '127.0.0.1');
    port = (app.getHttpServer().address() as AddressInfo).port;
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('maps liveness and readiness to their health subroutes', () => {
    const liveRoute = HealthCheckController.prototype.liveness;
    const readyRoute = HealthCheckController.prototype.readiness;

    expect(Reflect.getMetadata(PATH_METADATA, liveRoute)).toBe('live');
    expect(Reflect.getMetadata(METHOD_METADATA, liveRoute)).toBe(
      RequestMethod.GET,
    );
    expect(Reflect.getMetadata(PATH_METADATA, readyRoute)).toBe('ready');
    expect(Reflect.getMetadata(METHOD_METADATA, readyRoute)).toBe(
      RequestMethod.GET,
    );
  });

  it('serves local health and liveness over HTTP without contacting the homeserver', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');

    await expect(get('/v1/health')).resolves.toEqual({
      statusCode: 200,
      body: 'Healthy',
    });
    await expect(get('/v1/health/live')).resolves.toEqual({
      statusCode: 200,
      body: 'Healthy',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('checks Matrix Client-Server availability on readiness', async () => {
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(
          JSON.stringify({ versions: ['v1.1'], unstable_features: {} }),
        ),
      );

    await expect(get('/v1/health/ready')).resolves.toEqual({
      statusCode: 200,
      body: 'Healthy',
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://matrix.example/_matrix/client/versions',
      { signal: expect.any(AbortSignal) },
    );
  });

  it('fails readiness generically when the Matrix endpoint is unavailable', async () => {
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response('upstream-secret-sentinel', { status: 404 }),
      );

    const result = await get('/v1/health/ready');
    expect(result.statusCode).toBe(503);
    expect(result.body).toContain('Homeserver is unavailable');
    expect(result.body).not.toContain('upstream-secret-sentinel');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('cancels an unread error body without waiting past the readiness deadline', async () => {
    const timeout = new AbortController();
    const timeoutSpy = jest
      .spyOn(AbortSignal, 'timeout')
      .mockReturnValue(timeout.signal);
    const body = {
      cancel: jest.fn(() => {
        queueMicrotask(() => timeout.abort());
        return new Promise<void>(() => undefined);
      }),
    };
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue({ ok: false, body } as unknown as Response);

    const result = await get('/v1/health/ready');
    expect(result.statusCode).toBe(503);
    expect(result.body).toContain('Homeserver is unavailable');
    expect(body.cancel).toHaveBeenCalledTimes(1);
    expect(timeoutSpy).toHaveBeenCalledWith(3_000);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['invalid JSON', new Response('not-json')],
    [
      'missing versions',
      new Response(JSON.stringify({ unstable_features: {} })),
    ],
    ['empty versions', new Response(JSON.stringify({ versions: [] }))],
    ['non-string versions', new Response(JSON.stringify({ versions: [1] }))],
    ['blank versions', new Response(JSON.stringify({ versions: ['  '] }))],
  ])(
    'fails readiness on a successful but malformed response (%s)',
    async (_case, response) => {
      jest.spyOn(globalThis, 'fetch').mockResolvedValue(response);

      const result = await get('/v1/health/ready');
      expect(result.statusCode).toBe(503);
      expect(result.body).toContain('Homeserver is unavailable');
    },
  );

  it('fails readiness generically on network errors while keeping local health live', async () => {
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('upstream-secret-sentinel'));

    const result = await get('/v1/health/ready');
    expect(result.statusCode).toBe(503);
    expect(result.body).toContain('Homeserver is unavailable');
    expect(result.body).not.toContain('upstream-secret-sentinel');
    expect(controller.health()).toBe('Healthy');
    expect(controller.liveness()).toBe('Healthy');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('aborts a stalled Matrix response body at the readiness deadline', async () => {
    const timeout = new AbortController();
    const timeoutSpy = jest
      .spyOn(AbortSignal, 'timeout')
      .mockReturnValue(timeout.signal);
    let jsonStarted: () => void = () => undefined;
    const bodyReadStarted = new Promise<void>((resolve) => {
      jsonStarted = resolve;
    });
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (_url, init) => {
        expect(init?.signal).toBe(timeout.signal);
        return {
          ok: true,
          json: () => {
            jsonStarted();
            return new Promise((_resolve, reject) => {
              timeout.signal.addEventListener('abort', () =>
                reject(new Error('upstream-secret-sentinel')),
              );
            });
          },
        } as Response;
      });

    const resultPromise = get('/v1/health/ready');
    await bodyReadStarted;
    timeout.abort();

    const result = await resultPromise;
    expect(result.statusCode).toBe(503);
    expect(result.body).toContain('Homeserver is unavailable');
    expect(result.body).not.toContain('upstream-secret-sentinel');
    expect(timeoutSpy).toHaveBeenCalledWith(3_000);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  function get(path: string): Promise<{ statusCode: number; body: string }> {
    return new Promise((resolve, reject) => {
      const outgoing = request(
        { host: '127.0.0.1', port, path, method: 'GET' },
        (incoming) => {
          let body = '';
          incoming.setEncoding('utf8');
          incoming.on('data', (chunk: string) => (body += chunk));
          incoming.on('end', () =>
            resolve({ statusCode: incoming.statusCode ?? 0, body }),
          );
        },
      );
      outgoing.on('error', reject);
      outgoing.end();
    });
  }
});
