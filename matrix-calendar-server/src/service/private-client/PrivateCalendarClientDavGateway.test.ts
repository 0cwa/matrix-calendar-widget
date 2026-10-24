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

import express from 'express';
import { request as httpRequest, IncomingHttpHeaders } from 'http';
import { AddressInfo } from 'net';
import { ReadableStream } from 'node:stream/web';
import { IAppConfiguration } from '../../IAppConfiguration';
import { assertVeventOnlyCalendar } from '../public-feed/PublicCalendarFeedIcs';
import { PrivateCalendarClientDavGateway } from './PrivateCalendarClientDavGateway';
import { PrivateCalendarClientPolicy } from './PrivateCalendarClientPolicy';

const APP_ID = 'mcwpc~0123456789abcdef0123456789abcdef0123456789abcdef';
const SECRET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq';
const BASIC = `Basic ${Buffer.from(`${APP_ID}:${SECRET}`).toString('base64')}`;
const VEVENT = Buffer.from(
  [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Matrix Calendar Widget//Private test//EN',
    'BEGIN:VEVENT',
    'UID:private-event',
    'DTSTAMP:20261021T100000Z',
    'DTSTART:20261022T100000Z',
    'X-OPAQUE;X-KEEP=attribute:preserve-me',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n'),
);
const MIXED_RESOURCE = Buffer.from(
  VEVENT.toString('utf8').replace(
    'END:VCALENDAR',
    [
      'BEGIN:VTODO',
      'UID:unsupported-task',
      'DTSTAMP:20261021T100000Z',
      'END:VTODO',
      'END:VCALENDAR',
    ].join('\r\n'),
  ),
);

type HttpResult = {
  statusCode: number | undefined;
  headers: IncomingHttpHeaders;
  body: Buffer;
};

describe('private CalDAV DAV gateway', () => {
  let app: express.Express;
  let server: ReturnType<express.Express['listen']>;
  let baseUrl: string;
  let fetchImpl: jest.MockedFunction<typeof fetch>;
  let policy: {
    authenticate: jest.Mock;
    authorizeDavRequest: jest.Mock;
  };

  beforeAll(async () => {
    fetchImpl = jest.fn() as jest.MockedFunction<typeof fetch>;
    policy = {
      authenticate: jest.fn().mockResolvedValue(true),
      authorizeDavRequest: jest.fn().mockResolvedValue(true),
    };
    const gateway = new PrivateCalendarClientDavGateway(
      {
        private_calendar_clients_enabled: true,
        private_calendar_client_origin: 'https://calendar.example.test',
        radicale_url: 'http://radicale.internal/',
      } as IAppConfiguration,
      policy as unknown as PrivateCalendarClientPolicy,
      fetchImpl,
    );
    app = express();
    app.use(gateway.use.bind(gateway));
    app.use((_request, response) => response.status(404).end());
    await new Promise<void>((resolve, reject) => {
      server = app.listen(0, '127.0.0.1', (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    if (server)
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
  });

  beforeEach(() => {
    fetchImpl.mockReset();
    policy.authenticate.mockReset().mockResolvedValue(true);
    policy.authorizeDavRequest.mockReset().mockResolvedValue(true);
  });

  it('accepts a VEVENT resource with unknown properties and recognizes mixed components', () => {
    expect(() => assertVeventOnlyCalendar(VEVENT)).not.toThrow();
    expect(() => assertVeventOnlyCalendar(MIXED_RESOURCE)).toThrow();
  });

  it('adds a create precondition and forwards a new VEVENT byte-for-byte', async () => {
    fetchImpl
      .mockResolvedValueOnce(upstreamResponse(undefined, 404))
      .mockResolvedValueOnce(
        upstreamResponse(undefined, 201, { ETag: '"new-event"' }),
      );

    const response = await send('PUT', eventUrl('new.ics'), VEVENT, {
      'Content-Type': 'text/calendar; charset=utf-8',
    });
    const [, init] = fetchImpl.mock.calls[1];
    const headers = new Headers(init?.headers);

    expect(response.statusCode).toBe(201);
    expect(headers.get('If-None-Match')).toBe('*');
    expect(Buffer.from(init?.body as Uint8Array)).toEqual(VEVENT);
    expect(response.headers.etag).toBe('"new-event"');
  });

  it('adds the current strong ETag when updating without a client condition', async () => {
    fetchImpl
      .mockResolvedValueOnce(
        upstreamResponse(VEVENT, 200, { ETag: '"version-1"' }),
      )
      .mockResolvedValueOnce(
        upstreamResponse(undefined, 204, { ETag: '"version-2"' }),
      );

    const response = await send('PUT', eventUrl('event.ics'), VEVENT, {
      'Content-Type': 'text/calendar',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [, init] = fetchImpl.mock.calls[1];

    expect(response.statusCode).toBe(204);
    expect(new Headers(init?.headers).get('If-Match')).toBe('"version-1"');
    expect(Buffer.from(init?.body as Uint8Array)).toEqual(VEVENT);
  });

  it('evaluates a client-supplied stale precondition before native mutation', async () => {
    fetchImpl.mockResolvedValueOnce(
      upstreamResponse(VEVENT, 200, { ETag: '"version-2"' }),
    );

    const response = await send('PUT', eventUrl('event.ics'), VEVENT, {
      'Content-Type': 'text/calendar',
      'If-Match': '"stale"',
    });

    expect(response.statusCode).toBe(412);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('uses weak comparison for If-None-Match and blocks an existing resource', async () => {
    fetchImpl.mockResolvedValueOnce(
      upstreamResponse(VEVENT, 200, { ETag: '"version-2"' }),
    );

    const response = await send('DELETE', eventUrl('event.ics'), undefined, {
      'If-None-Match': 'W/"version-2"',
    });

    expect(response.statusCode).toBe(412);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('evaluates a valid If-Match list and forwards the exact preflight ETag', async () => {
    fetchImpl
      .mockResolvedValueOnce(
        upstreamResponse(VEVENT, 200, { ETag: '"version-2"' }),
      )
      .mockResolvedValueOnce(upstreamResponse(undefined, 204));

    const response = await send('PUT', eventUrl('event.ics'), VEVENT, {
      'Content-Type': 'text/calendar',
      'If-Match': '"stale", "version-2"',
    });

    expect(response.statusCode).toBe(204);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const mutationHeaders = new Headers(fetchImpl.mock.calls[1][1]?.headers);
    expect(mutationHeaders.get('If-Match')).toBe('"version-2"');
    expect(mutationHeaders.has('If-None-Match')).toBe(false);
  });

  it('rejects date-based conditions on mutations before native DAV', async () => {
    const response = await send('PUT', eventUrl('event.ics'), VEVENT, {
      'Content-Type': 'text/calendar',
      'If-Unmodified-Since': 'Wed, 21 Oct 2026 10:00:00 GMT',
    });

    expect(response.statusCode).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ['PUT', 'If-Match', '*'],
    ['PUT', 'If-None-Match', '"unrelated"'],
    ['DELETE', 'If-Match', '*'],
  ] as const)(
    'pins a preflight VEVENT ETag when %s carries %s: %s during a mixed-resource race',
    async (method, conditionName, conditionValue) => {
      let resource: { body: Buffer; etag: string } = {
        body: VEVENT,
        etag: '"version-1"',
      };
      let raced = false;
      fetchImpl.mockImplementation(async (_input, init) => {
        if (init?.method === 'GET') {
          const observed = resource;
          if (!raced) {
            raced = true;
            resource = { body: MIXED_RESOURCE, etag: '"version-2"' };
          }
          return upstreamResponse(observed.body, 200, { ETag: observed.etag });
        }
        const headers = new Headers(init?.headers);
        if (headers.get('If-Match') !== resource.etag) {
          return upstreamResponse(undefined, 412);
        }
        if (init?.method === 'PUT') resource = { body: VEVENT, etag: '"new"' };
        else resource = { body: Buffer.alloc(0), etag: '' };
        return upstreamResponse(undefined, 204);
      });

      const response = await send(
        method,
        eventUrl('event.ics'),
        method === 'PUT' ? VEVENT : undefined,
        {
          ...(method === 'PUT' ? { 'Content-Type': 'text/calendar' } : {}),
          [conditionName]: conditionValue,
        },
      );

      expect(response.statusCode).toBe(412);
      expect(resource.body).toEqual(MIXED_RESOURCE);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      const mutationHeaders = new Headers(fetchImpl.mock.calls[1][1]?.headers);
      expect(mutationHeaders.get('If-Match')).toBe('"version-1"');
      expect(mutationHeaders.has('If-None-Match')).toBe(false);
    },
  );

  it('guards a missing-resource create when a concurrent writer inserts a mixed object', async () => {
    let resource: { body: Buffer; etag: string } | undefined;
    fetchImpl.mockImplementation(async (_input, init) => {
      if (init?.method === 'GET') {
        resource = { body: MIXED_RESOURCE, etag: '"concurrent"' };
        return upstreamResponse(undefined, 404);
      }
      const headers = new Headers(init?.headers);
      if (resource && headers.get('If-None-Match') === '*') {
        return upstreamResponse(undefined, 412);
      }
      resource = { body: Buffer.from(init?.body as Uint8Array), etag: '"new"' };
      return upstreamResponse(undefined, 201);
    });

    const response = await send('PUT', eventUrl('event.ics'), VEVENT, {
      'Content-Type': 'text/calendar',
      'If-None-Match': '"old-version"',
    });

    expect(response.statusCode).toBe(412);
    expect(resource?.body).toEqual(MIXED_RESOURCE);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const mutationHeaders = new Headers(fetchImpl.mock.calls[1][1]?.headers);
    expect(mutationHeaders.get('If-None-Match')).toBe('*');
    expect(mutationHeaders.has('If-Match')).toBe(false);
  });

  it.each(['PUT', 'DELETE'] as const)(
    'refuses to modify an existing VEVENT+VTODO resource with %s',
    async (method) => {
      fetchImpl.mockResolvedValueOnce(
        upstreamResponse(MIXED_RESOURCE, 200, { ETag: '"mixed"' }),
      );

      const response = await send(
        method,
        eventUrl('mixed.ics'),
        method === 'PUT' ? VEVENT : undefined,
        method === 'PUT' ? { 'Content-Type': 'text/calendar' } : {},
      );

      expect(response.statusCode).toBe(409);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    },
  );

  it('rejects unsupported methods and unsafe paths before native DAV', async () => {
    const method = await send('MKCOL', eventUrl(''));
    const traversal = await send('GET', `/${APP_ID}/calendar/%2e%2e/other.ics`);
    const query = await send('GET', `${eventUrl('event.ics')}?raw=1`);

    expect(method.statusCode).toBe(405);
    expect(traversal.statusCode).toBe(404);
    expect(query.statusCode).toBe(404);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  function eventUrl(name: string): string {
    return `/${APP_ID}/calendar/${name}`;
  }

  function upstreamResponse(
    bytes: Uint8Array | undefined,
    status: number,
    headers: Record<string, string> = {},
  ): globalThis.Response {
    const body = bytes
      ? new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(bytes));
            controller.close();
          },
        })
      : null;
    return {
      status,
      headers: new Headers(headers),
      body,
    } as globalThis.Response;
  }

  function send(
    method: string,
    path: string,
    body?: Buffer,
    headers: Record<string, string> = {},
  ): Promise<HttpResult> {
    return new Promise((resolve, reject) => {
      const outgoing = httpRequest(
        `${baseUrl}${path}`,
        {
          method,
          headers: {
            Authorization: BASIC,
            ...headers,
            ...(body ? { 'Content-Length': String(body.byteLength) } : {}),
          },
        },
        (incoming) => {
          const chunks: Buffer[] = [];
          incoming.on('data', (chunk: Buffer | string) =>
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
          );
          incoming.on('end', () =>
            resolve({
              statusCode: incoming.statusCode,
              headers: incoming.headers,
              body: Buffer.concat(chunks),
            }),
          );
        },
      );
      outgoing.on('error', reject);
      outgoing.end(body);
    });
  }
});
