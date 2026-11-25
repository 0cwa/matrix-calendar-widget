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

import { Buffer } from 'node:buffer';

/**
 * Read a response stream only while its cumulative size stays within a limit.
 *
 * Cancels and returns undefined for a missing body, invalid limit, overflow, or
 * stream error so an oversized response is never fully buffered.
 *
 * @param {ReadableStream<Uint8Array> | null} body Response body stream.
 * @param {number} maxBytes Maximum number of bytes to buffer.
 * @returns {Promise<Buffer | undefined>} Complete body, or undefined on rejection.
 */
export async function readBoundedResponseBody(body, maxBytes) {
  if (body === null || !Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    return undefined;
  }

  const reader = body.getReader();
  const chunks = [];
  let byteLength = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return Buffer.concat(chunks, byteLength);

      if (value.byteLength > maxBytes - byteLength) {
        await reader.cancel().catch(() => undefined);
        return undefined;
      }

      chunks.push(Buffer.from(value));
      byteLength += value.byteLength;
    }
  } catch {
    await reader.cancel().catch(() => undefined);
    return undefined;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // The stream may already have released its lock after cancellation.
    }
  }
}
