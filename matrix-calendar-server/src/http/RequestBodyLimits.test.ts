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

import { Body, Controller, Module, Post } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import type {
  Request as ExpressRequest,
  Response as ExpressResponse,
  NextFunction,
} from 'express';
import { request } from 'http';
import { AddressInfo } from 'net';
import { configureRequestBodyLimits } from './RequestBodyLimits';

@Controller()
class RequestBodyLimitController {
  @Post('echo')
  echo(@Body() body: { payload: string }): { length: number } {
    return { length: body.payload.length };
  }
}

@Module({ controllers: [RequestBodyLimitController] })
class RequestBodyLimitTestModule {}

describe('HTTP request body limits', () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  let authenticationMiddlewareCalled: boolean;

  beforeAll(async () => {
    app = await NestFactory.create<NestExpressApplication>(
      RequestBodyLimitTestModule,
      { bodyParser: false, logger: false },
    );
    configureRequestBodyLimits(app);
    app.use(
      (
        _request: ExpressRequest,
        _response: ExpressResponse,
        next: NextFunction,
      ) => {
        authenticationMiddlewareCalled = true;
        next();
      },
    );
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  it('accepts ordinary JSON while rejecting bodies above the existing 100kb limit', async () => {
    const accepted = await postJson(baseUrl, '/echo', {
      payload: 'a'.repeat(16 * 1024),
    });
    expect(accepted.statusCode).toBe(201);
    expect(JSON.parse(accepted.body)).toEqual({ length: 16 * 1024 });
    expect(authenticationMiddlewareCalled).toBe(true);

    authenticationMiddlewareCalled = false;
    const rejected = await postJson(baseUrl, '/echo', {
      payload: 'a'.repeat(110 * 1024),
    });
    expect(rejected.statusCode).toBe(413);
    expect(authenticationMiddlewareCalled).toBe(false);
  });
});

function postJson(
  baseUrl: string,
  path: string,
  body: unknown,
): Promise<{ statusCode: number | undefined; body: string }> {
  const requestBody = JSON.stringify(body);

  return new Promise((resolve, reject) => {
    const outgoing = request(
      `${baseUrl}${path}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(requestBody),
        },
      },
      (incoming) => {
        let responseBody = '';
        incoming.setEncoding('utf8');
        incoming.on('data', (chunk: string) => (responseBody += chunk));
        incoming.on('end', () =>
          resolve({ statusCode: incoming.statusCode, body: responseBody }),
        );
      },
    );
    outgoing.on('error', reject);
    outgoing.end(requestBody);
  });
}
