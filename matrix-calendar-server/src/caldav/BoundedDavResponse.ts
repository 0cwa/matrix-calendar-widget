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

export const MAX_DAV_XML_RESPONSE_BYTES = 16 * 1024 * 1024;

type DavResponseBody = {
  getReader?: () => ReadableStreamDefaultReader<Uint8Array>;
  cancel?: () => Promise<void>;
  destroy?: () => void;
  [Symbol.asyncIterator]?: () => AsyncIterator<Uint8Array | string>;
};

export class BoundedDavResponseError extends Error {
  constructor(readonly code: 'response-too-large' | 'response-read-failed') {
    super(
      code === 'response-too-large'
        ? 'CalDAV XML response exceeds the size limit'
        : 'CalDAV XML response could not be read',
    );
    this.name = 'BoundedDavResponseError';
  }
}

export async function cancelDavResponse(response: Response): Promise<void> {
  try {
    const body = response.body as unknown as DavResponseBody | null;
    if (body?.cancel) await body.cancel();
    else body?.destroy?.();
  } catch {
    // Cleanup must not replace the fixed transport failure.
  }
}

/** Count actual streamed UTF-8 bytes before allowing XML parsing. */
export async function readBoundedDavResponse(
  response: Response,
  maxBytes: number = MAX_DAV_XML_RESPONSE_BYTES,
): Promise<string> {
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > MAX_DAV_XML_RESPONSE_BYTES
  ) {
    throw new BoundedDavResponseError('response-read-failed');
  }
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const contentLength = response.headers.get('Content-Length');
    if (
      contentLength !== null &&
      /^\d+$/.test(contentLength) &&
      BigInt(contentLength) > BigInt(maxBytes)
    ) {
      throw new BoundedDavResponseError('response-too-large');
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    const append = (value: Uint8Array | string): void => {
      const chunk =
        typeof value === 'string' ? new TextEncoder().encode(value) : value;
      if (!(chunk instanceof Uint8Array))
        throw new BoundedDavResponseError('response-read-failed');
      size += chunk.byteLength;
      if (size > maxBytes)
        throw new BoundedDavResponseError('response-too-large');
      chunks.push(chunk);
    };
    const rawBody = response.body as unknown;
    if (typeof rawBody === 'string' || rawBody instanceof Uint8Array) {
      append(rawBody);
    } else if (rawBody) {
      const body = rawBody as DavResponseBody;
      reader = body.getReader?.();
      if (reader) {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          append(chunk.value);
        }
      } else if (body[Symbol.asyncIterator]) {
        for await (const chunk of body as AsyncIterable<Uint8Array | string>)
          append(chunk);
      } else {
        throw new BoundedDavResponseError('response-read-failed');
      }
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(bytes);
  } catch (error) {
    if (reader) {
      try {
        await reader.cancel();
      } catch {
        /* Best-effort stream cleanup. */
      }
    } else {
      await cancelDavResponse(response);
    }
    throw error instanceof BoundedDavResponseError
      ? error
      : new BoundedDavResponseError('response-read-failed');
  } finally {
    try {
      reader?.releaseLock();
    } catch {
      /* A broken stream may be locked. */
    }
  }
}
