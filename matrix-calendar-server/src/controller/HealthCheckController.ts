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

import { Controller, Get, HttpException, Inject } from '@nestjs/common';
import { IAppConfiguration } from '../IAppConfiguration';
import { ModuleProviderToken } from '../ModuleProviderToken';

const HOMESERVER_READINESS_TIMEOUT_MS = 3_000;

const cancelResponseBodyBeforeDeadline = async (
  body: ReadableStream<Uint8Array> | null,
  signal: AbortSignal,
): Promise<void> => {
  if (!body) {
    return;
  }

  const cancellation = body.cancel();
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
    } else {
      onAbort = () => resolve();
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });

  try {
    await Promise.race([cancellation, aborted]);
  } finally {
    if (onAbort) {
      signal.removeEventListener('abort', onAbort);
    }
  }
};

@Controller({
  path: 'health',
  version: ['1'],
})
export class HealthCheckController {
  constructor(
    @Inject(ModuleProviderToken.APP_CONFIGURATION)
    private appConfig: IAppConfiguration,
  ) {}

  @Get()
  health() {
    return 'Healthy';
  }

  /**
   * Reports that the server process can receive HTTP requests.
   * Dependency availability is checked separately by `readiness()`.
   */
  @Get('live')
  liveness() {
    return this.health();
  }

  /**
   * Checks whether the configured homeserver serves the Matrix Client-Server API.
   */
  @Get('ready')
  async readiness() {
    const url = `${this.appConfig.homeserver_url.replace(/\/+$/u, '')}/_matrix/client/versions`;

    try {
      const signal = AbortSignal.timeout(HOMESERVER_READINESS_TIMEOUT_MS);
      const response = await fetch(url, {
        signal,
      });
      if (!response.ok) {
        await cancelResponseBodyBeforeDeadline(response.body, signal);
        throw new Error('Matrix endpoint unavailable');
      }

      const body: unknown = await response.json();
      if (
        typeof body !== 'object' ||
        body === null ||
        !('versions' in body) ||
        !Array.isArray(body.versions) ||
        body.versions.length === 0 ||
        !body.versions.every(
          (version) => typeof version === 'string' && version.trim().length > 0,
        )
      ) {
        throw new Error('Invalid Matrix versions response');
      }

      return 'Healthy';
    } catch {
      throw new HttpException('Homeserver is unavailable', 503);
    }
  }
}
