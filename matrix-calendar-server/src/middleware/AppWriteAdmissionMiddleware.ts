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

import type { NextFunction, Request, Response } from 'express';
import { AppWriteFenceService } from '../service/AppWriteFenceService';

const READ_ONLY_METHODS = new Set([
  'GET',
  'HEAD',
  'OPTIONS',
  'PROPFIND',
  'REPORT',
]);
const CHECKPOINT_CONTROL_ROUTE =
  /^\/v1\/internal\/backup-checkpoint\/(?:acquire|[^/]+\/(?:verify|release))\/?$/iu;

/** Admission gate installed before controller and direct-DAV middleware. */
export class AppWriteAdmissionMiddleware {
  constructor(private readonly writeFence: AppWriteFenceService) {}

  use(request: Request, response: Response, next: NextFunction): void {
    if (
      READ_ONLY_METHODS.has(request.method.toUpperCase()) ||
      CHECKPOINT_CONTROL_ROUTE.test(request.path)
    ) {
      next();
      return;
    }

    const admission = this.writeFence.admitWrite();
    if (!admission) {
      response.setHeader('Retry-After', '1');
      response.status(503).end();
      return;
    }

    let released = false;
    let closedBeforeEnd = false;
    const release = () => {
      if (released) return;
      released = true;
      response.off('finish', release);
      response.off('close', release);
      admission.release();
    };
    const originalEnd = response.end;
    response.end = function (
      this: Response,
      ...args: Parameters<Response['end']>
    ) {
      const result = originalEnd.apply(this, args);
      if (closedBeforeEnd) release();
      return result;
    } as Response['end'];
    const onClose = () => {
      response.off('close', onClose);
      if (response.writableEnded) {
        release();
      } else {
        // A disconnected client does not cancel an async controller or DAV
        // mutation. Keep the admission until downstream code ends its reply.
        closedBeforeEnd = true;
      }
    };
    response.once('finish', release);
    response.once('close', onClose);

    try {
      next();
    } catch (error) {
      release();
      throw error;
    }
  }
}
