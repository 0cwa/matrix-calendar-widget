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
  RadicalePublicFeedClient,
  RadicalePublicFeedError,
  readBoundedResponseBytes,
} from './RadicalePublicFeedClient';

describe('RadicalePublicFeedClient.listTokenShares', () => {
  const credentials = {
    getRequestHeaders: jest
      .fn()
      .mockResolvedValue({ Authorization: 'Basic synthetic' }),
  };

  it('returns a frozen empty list for Radicale’s exact empty not-found response', async () => {
    const client = createClient({
      ApiVersion: 1,
      Lines: 0,
      Status: 'not-found',
      Content: [],
    });

    const shares = await client.listTokenShares('/alice/team/', credentials);

    expect(shares).toEqual([]);
    expect(Object.isFrozen(shares)).toBe(true);
  });

  it.each([
    { Status: 'not-found' },
    { Status: 'not-found', Content: [{}] },
    { Status: 'not-found', Content: null },
    { Status: 'success', Content: [{}] },
  ])('rejects other list response shapes: %j', async (payload) => {
    const client = createClient(payload);

    await expect(
      client.listTokenShares('/alice/team/', credentials),
    ).rejects.toMatchObject({ code: 'invalid-response' });
  });
});

describe('readBoundedResponseBytes', () => {
  it('preserves buffered bodies and accepts a body exactly at its limit', async () => {
    const bytes = Buffer.from([1, 2, 3]);

    await expect(
      readBoundedResponseBytes(responseWithBody(bytes), bytes.byteLength),
    ).resolves.toEqual(bytes);
  });

  it('rejects buffered bodies over the limit without returning a prefix', async () => {
    const bytes = Buffer.from([1, 2, 3]);

    await expect(
      readBoundedResponseBytes(responseWithBody(bytes), bytes.byteLength - 1),
    ).rejects.toMatchObject({ code: 'response-too-large' });
  });

  it('streams chunks up to the limit and cancels when the next chunk exceeds it', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Buffer.from([1, 2]));
        controller.enqueue(Buffer.from([3, 4]));
        controller.close();
      },
    });

    await expect(
      readBoundedResponseBytes(responseWithBody(stream), 3),
    ).rejects.toBeInstanceOf(RadicalePublicFeedError);
  });

  it('rejects an oversized declared length before consuming the body', async () => {
    await expect(
      readBoundedResponseBytes(
        responseWithBody(Buffer.from([1]), { 'Content-Length': '9' }),
        8,
      ),
    ).rejects.toMatchObject({ code: 'response-too-large' });
  });
});

function responseWithBody(
  body: Uint8Array | ReadableStream<Uint8Array>,
  headers: Record<string, string> = {},
): Response {
  return {
    body,
    headers: new Headers(headers),
  } as unknown as Response;
}

function createClient(payload: unknown): RadicalePublicFeedClient {
  return new RadicalePublicFeedClient(
    'https://radicale.example.test',
    async () =>
      new Response(JSON.stringify(payload), {
        headers: { 'Content-Type': 'application/json' },
      }),
  );
}
