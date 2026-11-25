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

import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  CalDavEventTransportError,
  ICalendarEventCodecError,
  MatrixOpenIdCalDavCredentialError,
} from '../caldav';
import { RoomCalendarEventOperationError } from '../service/RoomCalendarEventOperations';

export async function runCalDav<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof MatrixOpenIdCalDavCredentialError) {
      throw new UnauthorizedException({
        code: error.code,
        message: error.message,
      });
    }

    if (
      error instanceof CalDavEventTransportError &&
      error.code === 'request-failed' &&
      error.method === 'GET' &&
      error.status === 404
    ) {
      throw new NotFoundException({
        code: 'event-not-found',
        message: 'Calendar event not found',
      });
    }

    if (
      error instanceof CalDavEventTransportError &&
      error.code === 'etag-conflict'
    ) {
      throw new ConflictException({
        code: 'etag-conflict',
        message: error.message,
      });
    }

    if (
      error instanceof CalDavEventTransportError &&
      error.code === 'invalid-range'
    ) {
      throw new BadRequestException({
        code: 'invalid-range',
        message: error.message,
      });
    }

    if (
      error instanceof CalDavEventTransportError &&
      ['redirected', 'response-read-failed', 'response-too-large'].includes(
        error.code,
      )
    ) {
      throw new BadGatewayException({
        code: 'caldav-upstream-error',
        message: 'CalDAV event request failed',
      });
    }

    if (error instanceof ICalendarEventCodecError) {
      if (error.code === 'event-too-large') {
        throw new PayloadTooLargeException({
          code: error.code,
          message: error.message,
        });
      }
      throw new BadRequestException({
        code: error.code,
        message: error.message,
      });
    }

    if (error instanceof RoomCalendarEventOperationError) {
      switch (error.code) {
        case 'invalid-event-url':
        case 'invalid-event-etag':
        case 'invalid-event-input':
          throw new BadRequestException({
            code: error.code,
            message: 'Room calendar event request is invalid',
          });
        case 'etag-conflict':
          throw new ConflictException({
            code: error.code,
            message: 'Room calendar event changed; reload before retrying',
          });
        case 'unsafe-event-resource':
          throw new ConflictException({
            code: error.code,
            message:
              'Room calendar event contains data that cannot be safely deleted',
          });
        case 'event-too-large':
          throw new PayloadTooLargeException({
            code: error.code,
            message:
              'This and following edit would exceed the supported calendar resource size.',
          });
        case 'event-write-disabled':
        case 'invalid-room-access':
          throw new ServiceUnavailableException({
            code: 'room-calendar-caldav-disabled',
            message: 'Room calendar CalDAV access is not enabled',
          });
      }
    }

    throw error;
  }
}
