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

import { HttpException, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { IAppConfiguration } from '../IAppConfiguration';
import { HealthCheckController } from './HealthCheckController';

describe('HealthCheckController', () => {
  const controller = new HealthCheckController({
    homeserver_url: 'https://matrix.example',
  } as IAppConfiguration);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('maps liveness to the health live route', () => {
    const route = HealthCheckController.prototype.liveness;

    expect(Reflect.getMetadata(PATH_METADATA, route)).toBe('live');
    expect(Reflect.getMetadata(METHOD_METADATA, route)).toBe(RequestMethod.GET);
  });

  it('reports process liveness without contacting the homeserver', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');

    await expect(controller.liveness()).resolves.toBe('Healthy');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('preserves the dependency-aware homeserver health response', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Healthy', { status: 200 }),
    );

    await expect(controller.health()).resolves.toBe('Healthy');
    expect(fetchSpy).toHaveBeenCalledWith('https://matrix.example/health');
  });

  it('keeps liveness available when the homeserver is down', async () => {
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('homeserver unavailable'));

    await expect(controller.health()).rejects.toThrow();
    await expect(controller.liveness()).resolves.toBe('Healthy');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('preserves status and response body when health fails', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('homeserver unavailable', { status: 503 }),
    );

    try {
      await controller.health();
      fail('expected health check to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(503);
      expect((error as HttpException).getResponse()).toBe(
        'homeserver unavailable',
      );
    }
  });
});
