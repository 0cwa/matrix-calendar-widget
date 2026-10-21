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

import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const outputDir = path.resolve(
  process.env.GITHUB_WORKSPACE ?? path.resolve(process.cwd(), '..'),
  '.gallery-output',
);

test('desktop month view', async ({ page }) => {
  await openGallery(page, { width: 1280, height: 800 }, 'month');
  await expect(page.locator('.fc-daygrid-event').first()).toBeVisible();
  await capture(page, 'month-desktop.png');
});

test('desktop event details', async ({ page }) => {
  await openGallery(page, { width: 1024, height: 760 }, 'month');
  await page.getByRole('button', { name: /Sprint planning/ }).first().click();
  await expect(
    page.getByRole('dialog', { name: 'Sprint planning' }),
  ).toBeVisible();
  await capture(page, 'event-details.png');
});

test('narrow list view', async ({ page }) => {
  await openGallery(page, { width: 420, height: 930 }, 'list');
  await capture(page, 'mobile-list.png');
});

test('narrow create event dialog', async ({ page }) => {
  await openGallery(page, { width: 420, height: 930 }, 'list');
  await page.getByRole('button', { name: 'Create event' }).click();
  await expect(
    page.getByRole('dialog', { name: 'Create event' }),
  ).toBeVisible();
  await capture(page, 'mobile-create.png');
});

async function openGallery(
  page: Page,
  viewport: { width: number; height: number },
  view: 'month' | 'list',
): Promise<void> {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  // No external services, credentials or arbitrary HTTP requests are needed.
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1') {
      return route.continue();
    }
    return route.abort();
  });

  await page.setViewportSize(viewport);
  await page.goto('/browser-tests/index.html?mode=gallery&view=' + view);
  await expect(page.getByTestId('gallery-root')).toBeVisible();
  await expect(
    page.getByRole('button', { name: /Sprint planning/ }).first(),
  ).toBeVisible();
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  expect(pageErrors).toEqual([]);
}

async function capture(page: Page, name: string): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  await page.screenshot({
    path: path.join(outputDir, name),
    animations: 'disabled',
    caret: 'hide',
  });
}
