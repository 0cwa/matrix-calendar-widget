/* Modified for Matrix Calendar Widget fork, 2026. */
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

import { expect, type FrameLocator, type Locator } from '@playwright/test';

export function measureStableDom<T>(
  locator: Locator,
  read: () => Promise<T>,
): Promise<{
  first: T;
  second: T;
  stable: boolean;
}> {
  return (async () => {
    const first = await read();
    await locator.evaluate(
      async () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    const second = await read();
    return {
      first,
      second,
      stable: JSON.stringify(first) === JSON.stringify(second),
    };
  })();
}

export async function readHorizontalOverflow(body: Locator): Promise<boolean> {
  return body.evaluate((bodyElement) => {
    const root = bodyElement.ownerDocument.documentElement;
    return (
      Math.max(root.scrollWidth, bodyElement.scrollWidth) > root.clientWidth
    );
  });
}

export async function readStableList(
  frame: FrameLocator,
  expectedTitles: readonly string[],
) {
  const rows = frame.locator('li[aria-label]');
  await expect(rows).toHaveCount(expectedTitles.length);
  return readStableRowCount(frame, expectedTitles);
}

export async function readStableRowCount(
  frame: FrameLocator,
  expectedTitles: readonly string[],
) {
  const body = frame.locator('body');
  return measureStableDom(body, () =>
    body.evaluate((bodyElement, expected) => {
      const root = bodyElement.ownerDocument.documentElement;
      const titles = Array.from(
        bodyElement.querySelectorAll('li[aria-label]'),
        (element) => element.getAttribute('aria-label') ?? '',
      );
      const actual = new Set(titles);
      const expectedSet = new Set(expected);
      return {
        renderedCount: titles.length,
        identitiesMatch:
          actual.size === expectedSet.size &&
          titles.length === expected.length &&
          expected.every((title) => actual.has(title)),
        horizontalOverflow:
          Math.max(root.scrollWidth, bodyElement.scrollWidth) >
          root.clientWidth,
      };
    }, expectedTitles),
  );
}
