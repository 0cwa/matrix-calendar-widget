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
  RadicalePublicFeedError,
  readBoundedResponseBytes,
} from './RadicalePublicFeedClient';

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
