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

import { readBoundedDavResponse } from './BoundedDavResponse';

describe('bounded DAV XML response', () => {
  it('counts multibyte streamed bytes despite a misleading length', async () => {
    const cancel = jest.fn(async () => undefined);
    const releaseLock = jest.fn();
    const read = jest
      .fn()
      .mockResolvedValueOnce({
        done: false,
        value: new TextEncoder().encode('éé'),
      })
      .mockResolvedValueOnce({
        done: false,
        value: new TextEncoder().encode('éé'),
      })
      .mockResolvedValueOnce({
        done: false,
        value: new TextEncoder().encode('é'),
      });
    const response = {
      headers: new Headers({ 'Content-Length': '1' }),
      body: { getReader: () => ({ read, cancel, releaseLock }) },
    } as unknown as Response;
    await expect(readBoundedDavResponse(response, 8)).rejects.toMatchObject({
      code: 'response-too-large',
    });
    expect(read).toHaveBeenCalledTimes(3);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(releaseLock).toHaveBeenCalledTimes(1);
  });

  it('rejects an excessive length without acquiring or reading the body', async () => {
    const getReader = jest.fn();
    const cancel = jest.fn(async () => undefined);
    const response = {
      headers: new Headers({ 'Content-Length': '9' }),
      body: { getReader, cancel },
    } as unknown as Response;
    await expect(readBoundedDavResponse(response, 8)).rejects.toMatchObject({
      code: 'response-too-large',
    });
    expect(getReader).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('accepts split UTF-8 bytes at the exact boundary', async () => {
    const read = jest
      .fn()
      .mockResolvedValueOnce({ done: false, value: new Uint8Array([0xc3]) })
      .mockResolvedValueOnce({ done: false, value: new Uint8Array([0xa9]) })
      .mockResolvedValueOnce({ done: true });
    const response = {
      headers: new Headers(),
      body: { getReader: () => ({ read, releaseLock: jest.fn() }) },
    } as unknown as Response;
    await expect(readBoundedDavResponse(response, 2)).resolves.toBe('é');
  });

  it('sanitizes acquisition errors even when cleanup also throws', async () => {
    const response = {
      headers: new Headers(),
      body: {
        getReader: () => {
          throw new Error('private peer data');
        },
        cancel: async () => {
          throw new Error('private cleanup data');
        },
      },
    } as unknown as Response;
    await expect(readBoundedDavResponse(response)).rejects.toMatchObject({
      code: 'response-read-failed',
      message: 'CalDAV XML response could not be read',
    });
  });

  it('bounds async Node-style streams with absent Content-Length', async () => {
    const destroy = jest.fn();
    const response = {
      headers: new Headers(),
      body: {
        destroy,
        async *[Symbol.asyncIterator]() {
          yield '1234';
          yield '56789';
        },
      },
    } as unknown as Response;
    await expect(readBoundedDavResponse(response, 8)).rejects.toMatchObject({
      code: 'response-too-large',
    });
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
