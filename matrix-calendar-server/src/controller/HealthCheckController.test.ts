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

import {
  HttpException,
  Module,
  RequestMethod,
  VersioningType,
} from '@nestjs/common';
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

  it('checks the homeserver on readiness and preserves its failure status', async () => {
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response('homeserver unavailable', { status: 503 }),
      );

    await expect(get('/v1/health/ready')).resolves.toEqual({
      statusCode: 503,
      body: JSON.stringify({
        statusCode: 503,
        message: 'homeserver unavailable',
      }),
    });
    expect(fetchSpy).toHaveBeenCalledWith('https://matrix.example/health');
  });

  it('keeps local health available when the homeserver is down', async () => {
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('homeserver unavailable'));

    await expect(controller.readiness()).rejects.toThrow();
    expect(controller.health()).toBe('Healthy');
    expect(controller.liveness()).toBe('Healthy');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('preserves status and response body when readiness fails', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response('homeserver unavailable', { status: 503 }),
      );

    try {
      await controller.readiness();
      fail('expected readiness check to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(503);
      expect((error as HttpException).getResponse()).toBe(
        'homeserver unavailable',
      );
    }
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
