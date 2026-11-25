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

/* eslint-disable playwright/expect-expect */

import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import test from 'node:test';

import { readBoundedResponseBody } from './readBoundedResponseBody.mjs';

test('reads a response body when its total size fits the limit', async () => {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(Uint8Array.of(1, 2));
      controller.enqueue(Uint8Array.of(3, 4));
      controller.close();
    },
  });

  assert.deepEqual(
    await readBoundedResponseBody(body, 4),
    Buffer.from([1, 2, 3, 4]),
  );
});

test('cancels a response body as soon as it exceeds the limit', async () => {
  let cancelled = false;
  const body = new ReadableStream({
    pull(controller) {
      controller.enqueue(Uint8Array.of(1, 2, 3, 4));
    },
    cancel() {
      cancelled = true;
    },
  });

  assert.equal(await readBoundedResponseBody(body, 3), undefined);
  assert.equal(cancelled, true);
});

test('rejects a missing body or invalid byte limit', async () => {
  assert.equal(await readBoundedResponseBody(null, 4), undefined);
  assert.equal(
    await readBoundedResponseBody(
      new ReadableStream(),
      Number.POSITIVE_INFINITY,
    ),
    undefined,
  );
});
