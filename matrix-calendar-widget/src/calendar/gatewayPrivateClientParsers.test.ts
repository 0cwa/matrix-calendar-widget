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

import { vi } from 'vitest';
import { GatewayCalendarRepository } from './GatewayCalendarRepository';

const calendarId = 'https://radicale.example.test/alice/team/';

describe('gateway response parsing', () => {
  it('rejects private client URLs outside the HTTPS gateway alias', async () => {
    const appId = `mcwpc~${'a'.repeat(48)}`;
    const fetchMock = mockFetch(
      jsonResponse([{ id: calendarId, name: 'Personal', readOnly: false }]),
      jsonResponse({
        client: {
          appId,
          target: { target: 'personal', calendarId },
          state: 'active',
          mapState: 'present',
          createdAt: '2026-10-21T10:00:00.000Z',
          expiresAt: '2027-01-19T10:00:00.000Z',
        },
        secret: 'A'.repeat(43),
        calendarUrl: `http://private-service.invalid/${appId}/calendar/`,
      }),
    );
    const repository = createRepository(fetchMock);
    const [calendar] = await repository.listCalendars();

    await expect(
      repository.createPrivateCalendarClient(calendar.id),
    ).rejects.toMatchObject({ code: 'request-failed' });
  });
});

function createRepository(fetchImpl: typeof fetch) {
  return new GatewayCalendarRepository({
    baseUrl: 'https://widget-api.example.test',
    roomId: '!team:example.test',
    getAuthorizationHeader: async () => 'MX-Identity delegated',
    getRoomCalendarCapabilities: async () => undefined,
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
