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
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

type GalleryTheme = 'light' | 'dark';
type GalleryViewport = { width: number; height: number };

const outputDir = path.resolve(
  process.env.GITHUB_WORKSPACE ?? path.resolve(process.cwd(), '..'),
  'gallery-output',
);

test('desktop month view', async ({ page }) => {
  await captureThemes(
    page,
    'month-desktop.png',
    { width: 1280, height: 800 },
    'month',
  );
});

test('desktop event details', async ({ page }) => {
  await captureThemes(
    page,
    'event-details.png',
    { width: 1024, height: 760 },
    'month',
    async (page) => {
      await page
        .getByRole('button', { name: /Sprint planning/ })
        .first()
        .click();
      await expect(
        page.getByRole('dialog', { name: 'Sprint planning' }),
      ).toBeVisible();
    },
  );
});

test('narrow list view', async ({ page }) => {
  await captureThemes(
    page,
    'mobile-list.png',
    { width: 420, height: 930 },
    'list',
  );
});

test('narrow create event dialog', async ({ page }) => {
  await captureThemes(
    page,
    'mobile-create.png',
    { width: 420, height: 930 },
    'list',
    async (page) => {
      await page.getByRole('button', { name: 'Create event' }).click();
      await expect(
        page.getByRole('dialog', { name: 'Create event' }),
      ).toBeVisible();
    },
  );
});

/**
 * Render each view and its optional dialog twice, with identical viewport,
 * frozen time, fictional events and locale. Only the color scheme changes.
 * The output keeps the existing README filenames and publication contract.
 */
async function captureThemes(
  page: Page,
  name: string,
  viewport: GalleryViewport,
  view: 'month' | 'list',
  prepare?: (page: Page) => Promise<void>,
): Promise<void> {
  const screenshots: Buffer[] = [];
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await openGallery(page, viewport, view, theme);
    if (prepare) {
      await prepare(page);
    }
    // Give the calendar and dialogs the same two-frame opportunity to settle.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );
    screenshots.push(
      await page.screenshot({ animations: 'disabled', caret: 'hide' }),
    );
  }

  const [light, dark] = screenshots;
  expect(light.equals(dark)).toBe(false);
  const composite = await composeDiagonal(page, light, dark);
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, name), composite);
}

/** Light above/left of a bottom-left to top-right diagonal; dark below/right. */
async function composeDiagonal(
  page: Page,
  light: Buffer,
  dark: Buffer,
): Promise<Buffer> {
  const encoded = await page.evaluate(
    async (sources: string[]) => {
      const load = (base64: string) =>
        new Promise<HTMLImageElement>((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.onerror = () => reject(new Error('Cannot decode gallery PNG'));
          image.src = 'data:image/png;base64,' + base64;
        });
      const [lightImage, darkImage] = await Promise.all(
        sources.map((source) => load(source)),
      );
      if (
        lightImage.naturalWidth !== darkImage.naturalWidth ||
        lightImage.naturalHeight !== darkImage.naturalHeight
      ) {
        throw new Error(
          'Light/dark gallery screenshots have different dimensions',
        );
      }

      const canvas = document.createElement('canvas');
      canvas.width = lightImage.naturalWidth;
      canvas.height = lightImage.naturalHeight;
      const context = canvas.getContext('2d');
      if (!context) {
        throw new Error('Cannot create gallery compositing canvas');
      }

      context.drawImage(darkImage, 0, 0);
      context.beginPath();
      context.moveTo(0, 0);
      context.lineTo(canvas.width, 0);
      context.lineTo(0, canvas.height);
      context.closePath();
      context.clip();
      context.drawImage(lightImage, 0, 0);
      return canvas.toDataURL('image/png').split(',')[1];
    },
    [light.toString('base64'), dark.toString('base64')],
  );
  return Buffer.from(encoded, 'base64');
}

async function openGallery(
  page: Page,
  viewport: GalleryViewport,
  view: 'month' | 'list',
  theme: GalleryTheme,
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

  // Make the calendar's "today" marker and new-event defaults reproducible
  // even when this workflow is run years after the fictional event dates.
  await page.clock.setFixedTime(new Date('2026-10-21T10:00:00.000Z'));
  await page.setViewportSize(viewport);
  const search = new URLSearchParams({ mode: 'gallery', view, theme });
  await page.goto('/browser-tests/index.html?' + search.toString());
  await expect(page.getByTestId('gallery-root')).toBeVisible();
  await expect(
    page.getByRole('button', { name: /Sprint planning/ }).first(),
  ).toBeVisible();
  // The theme must actually change MUI rendering, not just the browser preference.
  await expect(page.locator('body')).toHaveCSS(
    'background-color',
    theme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(18, 18, 18)',
  );
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  expect(pageErrors).toEqual([]);
}
