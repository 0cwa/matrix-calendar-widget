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

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';

const viewports = [
  { width: 320, height: 640 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1280, height: 800 },
];

for (const viewport of viewports) {
  for (const view of ['List', 'Month'] as const) {
    test(
      view + ' at ' + viewport.width + ' CSS pixels',
      async ({ page }, testInfo) => {
        await page.setViewportSize(viewport);
        await page.goto('/browser-tests/index.html');
        await page.getByRole('button', { name: view, exact: true }).click();
        const event = page.getByRole('button', { name: /^Synthetic planning/ });
        await expect(event).toBeVisible();
        const surface = page.getByTestId('calendar-surface');
        const dimensions = await surface.evaluate((element) => ({
          documentWidth: document.documentElement.clientWidth,
          documentScrollWidth: document.documentElement.scrollWidth,
          surfaceWidth: element.getBoundingClientRect().width,
          surfaceScrollWidth: element.scrollWidth,
        }));
        await testInfo.attach('layout-dimensions.json', {
          body: JSON.stringify({ viewport, view, dimensions }),
          contentType: 'application/json',
        });
        expect(dimensions.documentScrollWidth).toBeLessThanOrEqual(
          dimensions.documentWidth + 1,
        );
        expect(dimensions.surfaceScrollWidth).toBeLessThanOrEqual(
          dimensions.surfaceWidth + 1,
        );
        const textWidths = await surface.locator('p').evaluateAll((elements) =>
          elements.map((element) => ({
            width: element.clientWidth,
            scrollWidth: element.scrollWidth,
          })),
        );
        await testInfo.attach('surface-text-dimensions.json', {
          body: JSON.stringify({ viewport, view, textWidths }),
          contentType: 'application/json',
        });
        expect(
          textWidths.every(
            ({ width, scrollWidth }) => scrollWidth <= width + 1,
          ),
        ).toBe(true);
        await page.getByRole('button', { name: view, exact: true }).focus();
        await tabToEvent(page, event);
        await expect(event).toBeFocused();
        await page.keyboard.press('Enter');
        const dialog = page.getByRole('dialog', {
          name: 'Synthetic planning',
          exact: true,
        });
        await expect(dialog).toBeVisible();
        const dialogDimensions = await dialog.evaluate((element) => ({
          width: element.getBoundingClientRect().width,
          scrollWidth: element.scrollWidth,
          viewportWidth: document.documentElement.clientWidth,
        }));
        await testInfo.attach('dialog-dimensions.json', {
          body: JSON.stringify({ viewport, view, dialogDimensions }),
          contentType: 'application/json',
        });
        expect(dialogDimensions.width).toBeLessThanOrEqual(
          dialogDimensions.viewportWidth,
        );
        expect(dialogDimensions.scrollWidth).toBeLessThanOrEqual(
          dialogDimensions.width + 1,
        );
        const detailTextWidths = await dialog
          .locator('p')
          .evaluateAll((elements) =>
            elements.map((element) => ({
              width: element.clientWidth,
              scrollWidth: element.scrollWidth,
            })),
          );
        await testInfo.attach('dialog-text-dimensions.json', {
          body: JSON.stringify({ viewport, view, detailTextWidths }),
          contentType: 'application/json',
        });
        expect(
          detailTextWidths.every(
            ({ width, scrollWidth }) => scrollWidth <= width + 1,
          ),
        ).toBe(true);
        await expect(
          page.getByRole('button', { name: 'Close', exact: true }),
        ).toBeVisible();
        const accessibility = await new AxeBuilder({ page }).analyze();
        expect(accessibility.violations).toEqual([]);
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
        await expect(event).toBeFocused();
      },
    );
  }
}

async function tabToEvent(page: Page, event: Locator): Promise<void> {
  for (let tab = 0; tab < 32; tab += 1) {
    await page.keyboard.press('Tab');
    if (await event.evaluate((element) => element === document.activeElement)) {
      return;
    }
  }
}
