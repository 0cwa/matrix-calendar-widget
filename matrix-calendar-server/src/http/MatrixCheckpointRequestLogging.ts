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

import { isPrivateCalendarClientDavPath } from '../service/private-client/PrivateCalendarClientPath';

export const REQUEST_LOG_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers["x-matrix-checkpoint-token"]',
  'matrix_event.content',
];

export function shouldIgnoreRequestLog(request: { url?: string }): boolean {
  const path = (request.url ?? '').toLowerCase();
  return (
    path.startsWith('/v1/calendar-feeds/') ||
    path.startsWith('/v1/public-calendar-feeds/') ||
    path.startsWith('/v1/calendar/private-clients') ||
    path.startsWith('/v1/private-calendar-client-callback/') ||
    path.startsWith('/v1/internal/backup-checkpoint') ||
    isPrivateCalendarClientDavPath(path)
  );
}
