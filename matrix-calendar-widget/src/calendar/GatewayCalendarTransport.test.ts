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
import { GatewayCalendarTransport } from './GatewayCalendarTransport';

describe('GatewayCalendarTransport', () => {
  it('builds encoded URLs and applies delegated auth without dropping conditional headers', async () => {
    const calls: Array<{ init?: RequestInit }> = [];
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ init });
        return new Response('{}');
      },
    );
    const transport = new GatewayCalendarTransport({
      baseUrl: 'https://widget-api.example.test/',
      getAuthorizationHeader: async () => 'MX-Identity delegated',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const url = transport.url('/v1/calendar/events', {
      roomId: '!team:example.test',
      target: 'room',
    });

    await transport.requestJson(url, {
      method: 'PATCH',
      headers: { 'If-Match': '"event-etag"' },
      body: JSON.stringify({ title: 'Updated' }),
    });

    expect(new URL(url).pathname).toBe('/v1/calendar/events');
    expect(new URL(url).searchParams.get('roomId')).toBe('!team:example.test');
    const { init } = calls[0];
    expect(new Headers(init?.headers).get('Authorization')).toBe(
      'MX-Identity delegated',
    );
    expect(new Headers(init?.headers).get('If-Match')).toBe('"event-etag"');
    expect(new Headers(init?.headers).get('Content-Type')).toBe(
      'application/json',
    );
  });

  it.each([
    [401, 'authentication-required'],
    [409, 'event-conflict'],
  ] as const)(
    'maps gateway status %s into the repository contract',
    async (status, code) => {
      const transport = new GatewayCalendarTransport({
        baseUrl: 'https://widget-api.example.test',
        getAuthorizationHeader: async () => undefined,
        fetchImpl: vi.fn(
          async () => new Response('', { status }),
        ) as typeof fetch,
      });

      await expect(
        transport.requestVoid('https://widget-api.example.test/resource'),
      ).rejects.toMatchObject({ code });
    },
  );

  it('maps public-feed component rejection separately from event conflicts', async () => {
    const transport = new GatewayCalendarTransport({
      baseUrl: 'https://widget-api.example.test',
      getAuthorizationHeader: async () => undefined,
      fetchImpl: vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              code: 'public-calendar-feed-components-unsupported',
            }),
            { status: 409 },
          ),
      ) as typeof fetch,
    });

    await expect(
      transport.requestVoid('https://widget-api.example.test/resource'),
    ).rejects.toMatchObject({ code: 'unsupported-calendar-components' });
  });

  it('retains bounded unsupported-patch details and rejects invalid JSON safely', async () => {
    const unsupportedPatchTransport = new GatewayCalendarTransport({
      baseUrl: 'https://widget-api.example.test',
      getAuthorizationHeader: async () => undefined,
      fetchImpl: vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              code: 'unsupported-patch',
              message: 'x'.repeat(600),
            }),
            {
              status: 400,
            },
          ),
      ) as typeof fetch,
    });
    await expect(
      unsupportedPatchTransport.requestVoid(
        'https://widget-api.example.test/resource',
      ),
    ).rejects.toMatchObject({
      code: 'unsupported-patch',
      message: 'x'.repeat(500),
    });

    const invalidJsonTransport = new GatewayCalendarTransport({
      baseUrl: 'https://widget-api.example.test',
      getAuthorizationHeader: async () => undefined,
      fetchImpl: vi.fn(async () => new Response('not json')) as typeof fetch,
    });
    await expect(
      invalidJsonTransport.requestJson(
        'https://widget-api.example.test/resource',
      ),
    ).rejects.toEqual(
      new CalendarRepositoryError(
        'request-failed',
        'Calendar gateway returned invalid JSON',
      ),
    );
  });
});
