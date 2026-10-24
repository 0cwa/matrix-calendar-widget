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

import { isCalendarGatewayPath } from './CalendarGatewayRateLimitMiddleware';

describe('calendar gateway path selection', () => {
  it('rate-limits encoded and unencoded private-client DAV paths', () => {
    expect(
      isCalendarGatewayPath(
        '/mcwpc~0123456789abcdef0123456789abcdef0123456789abcdef/calendar/',
      ),
    ).toBe(true);
    expect(
      isCalendarGatewayPath(
        '/%6Dcwpc~0123456789abcdef0123456789abcdef0123456789abcdef/calendar/',
      ),
    ).toBe(true);
    expect(isCalendarGatewayPath('/calendar/mcwpc~ordinary/')).toBe(false);
  });
});
