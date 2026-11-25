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

import { CalendarRepositoryError } from '@matrix-calendar-widget/calendar';
import { vi } from 'vitest';
import { GatewayCalendarRepository } from './GatewayCalendarRepository';

describe('gateway response parsing', () => {
  it('rejects recipient responses containing extra or malformed profile data', async () => {
    const fetchMock = mockFetch(
      jsonResponse({
        recipients: [
          {
            userId: '@alice:example.test',
            displayName: 'Alice',
            avatarUrl: 'mxc://private-avatar',
          },
        ],
      }),
    );
    const repository = createRepository(fetchMock);

    await expect(
      repository.listRoomReminderRecipients(),
    ).rejects.toBeInstanceOf(CalendarRepositoryError);
  });
});

function createRepository(fetchImpl: typeof fetch) {
  return new GatewayCalendarRepository({
    baseUrl: 'https://widget-api.example.test',
    roomId: '!team:example.test',
    getAuthorizationHeader: async () => 'MX-Identity delegated',
    fetchImpl,
  });
}
function mockFetch(...responses: Response[]) {
  const mock = vi.fn<typeof fetch>();
  for (const response of responses) mock.mockResolvedValueOnce(response);
  return mock;
}
function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
