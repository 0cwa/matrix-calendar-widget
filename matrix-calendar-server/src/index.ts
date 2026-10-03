/* Modified for Matrix Calendar Widget fork, 2026. */
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

import { VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions } from '@nestjs/microservices';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { useContainer } from 'class-validator';
import { LogService } from 'matrix-bot-sdk';
import { Logger } from 'nestjs-pino';
import { IAppConfiguration } from './IAppConfiguration';
import { StubMatrixBotLogger } from './StubMatrixBotLogger';
import { AppModule } from './app.module';
import { configureRequestBodyLimits } from './http/RequestBodyLimits';
import {
  BoundedFixedWindowSourceRateLimiter,
  CalendarGatewayRateLimitMiddleware,
} from './middleware/CalendarGatewayRateLimitMiddleware';
import { MatrixAuthMiddleware } from './middleware/MatrixAuthMiddleware';
import { MatrixServer } from './rpc/MatrixServer';

// disables any logging in matrix bot sdk
LogService.setLogger(new StubMatrixBotLogger());

(async function () {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    bodyParser: false,
    cors: true,
  });
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
  const matrixAuthMiddleware = app.get(MatrixAuthMiddleware);
  app.use(matrixAuthMiddleware.use.bind(matrixAuthMiddleware));

  app.enableShutdownHooks();
  useContainer(app.select(AppModule), { fallbackOnErrors: true }); // enables injection in validators

  const logger = app.get(Logger);
  app.useLogger(logger);

  logger.log(
    `Bot starting...with level ${
      process.env.LOG_LEVEL ? process.env.LOG_LEVEL : 'error'
    }`,
  );

  const matrixServer: MatrixServer = app.get(MatrixServer);
  const microApp = await app.connectMicroservice<MicroserviceOptions>({
    strategy: matrixServer,
  });
  await microApp.listen();

  app.enableVersioning({
    type: VersioningType.URI,
  });

  const config = new DocumentBuilder()
    .setTitle('@matrix-calendar-widget/server')
    .setDescription('Rest endpoints of matrix-calendar-server')
    .setVersion('0.0.1')
    .setLicense('MIT', 'https://opensource.org/licenses/MIT')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  const port = appConfig.port ?? 3000;

  logger.log(`Bot starting on port ${port}`);

  await app.listen(port);
})();
