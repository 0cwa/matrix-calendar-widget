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

import type { NestMiddleware, Type } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { IAppConfiguration } from '../IAppConfiguration';
import {
  BoundedFixedWindowSourceRateLimiter,
  CalendarGatewayRateLimitMiddleware,
} from '../middleware/CalendarGatewayRateLimitMiddleware';
import { configureRequestBodyLimits } from './RequestBodyLimits';

export interface CalendarGatewayHttpApplication {
  app: NestExpressApplication;
  appConfig: IAppConfiguration;
}

/**
 * Create the HTTP app and install the production request middleware. Kept as a
 * shared setup seam so its ordering can be exercised by a loopback HTTP test.
 */
export async function createCalendarGatewayHttpApplication(
  rootModule: Type<unknown>,
  matrixAuthMiddlewareToken: Type<unknown>,
): Promise<CalendarGatewayHttpApplication> {
  const app = await NestFactory.create<NestExpressApplication>(rootModule, {
    bufferLogs: true,
    bodyParser: false,
    cors: false,
  });
  // Install default CORS policy now, before explicit early-response middleware.
  // Nest applies its cors option during app.init(), after app.use registrations.
  app.enableCors();
  configureRequestBodyLimits(app);
  const appConfig = app
    .get(ConfigService)
    .getOrThrow<IAppConfiguration>('config');
  const calendarGatewayRateLimiter = new BoundedFixedWindowSourceRateLimiter(
    appConfig.calendar_gateway_rate_limit_requests,
    appConfig.calendar_gateway_rate_limit_window_ms,
    appConfig.calendar_gateway_rate_limit_max_keys,
  );
  const calendarGatewayRateLimitMiddleware =
    new CalendarGatewayRateLimitMiddleware(calendarGatewayRateLimiter);
  // Keep this before MatrixAuthMiddleware: OpenID verification is an external
  // homeserver request and must only run for requests admitted by the limiter.
  app.use(
    calendarGatewayRateLimitMiddleware.use.bind(
      calendarGatewayRateLimitMiddleware,
    ),
  );
  const matrixAuthMiddleware = app.get<NestMiddleware>(
    matrixAuthMiddlewareToken,
  );
  app.use(matrixAuthMiddleware.use.bind(matrixAuthMiddleware));

  return { app, appConfig };
}
