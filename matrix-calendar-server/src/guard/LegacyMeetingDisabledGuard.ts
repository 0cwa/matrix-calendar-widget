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
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

/**
 * The calendar pilot has no legacy meeting API over HTTP or Matrix RPC. Keep
 * the old controller implementation for later retirement, but stop every
 * transport before its handler can call the meeting service.
 */
@Injectable()
export class LegacyMeetingDisabledGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (context.getType() === 'http') {
      throw new NotFoundException();
    }

    return false;
  }
}
