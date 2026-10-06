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
        const pageErrors: string[] = [];
        page.on('pageerror', (error) =>
          pageErrors.push(error.message.slice(0, 2000)),
        );
        await page.setViewportSize(viewport);
        await page.goto('/browser-tests/index.html');
        await expect
          .poll(async () => ({
            pageErrors,
            rendered: await page
              .getByRole('heading', { name: 'Calendar component validation' })
              .isVisible(),
          }))
          .toEqual({ pageErrors: [], rendered: true });
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
        const detailContent = dialog.locator('.MuiDialogContent-root');
        await detailContent.focus();
        await expect(detailContent).toBeFocused();
        const scrollDistance = await detailContent.evaluate((element) =>
          Math.max(0, element.scrollHeight - element.clientHeight),
        );
        await page.keyboard.press('PageDown');
        await expect
          .poll(() => detailContent.evaluate((element) => element.scrollTop))
          .toBeGreaterThanOrEqual(Math.min(scrollDistance, 1));
        const accessibility = await new AxeBuilder({ page }).analyze();
        expect(accessibility.violations).toEqual([]);
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
        await expect(event).toBeFocused();
      },
    );
  }
}

test('room visitor sees read-only event controls at a narrow width', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) =>
    pageErrors.push(error.message.slice(0, 2000)),
  );
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/browser-tests/index.html?mode=room-read-only');
  await expect(
    page.getByRole('heading', { name: 'Calendar component validation' }),
  ).toBeVisible();

  const createEvent = page.getByRole('button', { name: 'Create event' });
  await expect(createEvent).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Create calendar' }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Delete calendar' }),
  ).toBeDisabled();

  const event = page.getByRole('button', { name: /Synthetic room planning/ });
  await expect(event).toBeVisible();
  await page.getByRole('button', { name: 'List', exact: true }).focus();
  await tabToEvent(page, event);
  await page.keyboard.press('Enter');

  const dialog = page.getByRole('dialog', {
    name: 'Synthetic room planning',
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('alert')).toHaveText(
    'This calendar is read-only.',
  );
  await expect(
    dialog.getByRole('link', { name: 'Open Matrix room' }),
  ).toHaveAttribute(
    'href',
    'https://matrix.to/#/%21synthetic-room%3Aexample.test',
  );
  await expect(dialog.getByRole('button', { name: 'Edit' })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Delete' })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Notify room' })).toHaveCount(
    0,
  );

  await waitForDialogTransitions(dialog);
  const dimensions = await readDialogMeasurements(dialog);
  await test.info().attach('room-visitor-layout.json', {
    body: JSON.stringify(dimensions),
    contentType: 'application/json',
  });
  expect(dimensions.documentWidth).toBeLessThanOrEqual(
    dimensions.viewportWidth + 1,
  );
  expect(dimensions.dialogWidth).toBeLessThanOrEqual(dimensions.viewportWidth);
  expect(dimensions.dialogScrollWidth).toBeLessThanOrEqual(
    dimensions.dialogClientWidth + 1,
  );
  expect(dimensions.roomLinkPaintOpacity).toBe(1);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(event).toBeFocused();
  expect(pageErrors).toEqual([]);
});

test('room manager sees writable event controls at a narrow width', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) =>
    pageErrors.push(error.message.slice(0, 2000)),
  );
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/browser-tests/index.html?mode=room-manager');
  await expect(
    page.getByRole('heading', { name: 'Calendar component validation' }),
  ).toBeVisible();

  const createEvent = page.getByRole('button', { name: 'Create event' });
  await expect(createEvent).toBeEnabled();
  await expect(
    page.getByRole('button', { name: 'Create calendar' }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Delete calendar' }),
  ).toBeDisabled();

  await createEvent.click();
  const editor = page.getByRole('dialog', { name: 'Create event' });
  await expect(editor).toBeVisible();
  await expect(editor.getByRole('combobox', { name: 'Calendar' })).toHaveValue(
    'synthetic-room-calendar',
  );
  await expect(
    editor.getByRole('option', { name: 'Room calendar' }),
  ).toBeAttached();
  await editor.getByRole('button', { name: 'Cancel' }).click();
  await expect(editor).toBeHidden();

  const event = page.getByRole('button', { name: /Synthetic room planning/ });
  await expect(event).toBeVisible();
  await page.getByRole('button', { name: 'List', exact: true }).focus();
  await tabToEvent(page, event);
  await page.keyboard.press('Enter');

  const dialog = page.getByRole('dialog', {
    name: 'Synthetic room planning',
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole('link', { name: 'Open Matrix room' }),
  ).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Edit' })).toBeEnabled();
  await expect(dialog.getByRole('button', { name: 'Delete' })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Notify room' }).click();
  const reminder = dialog.getByRole('checkbox', {
    name: 'Alarm 1: −15m relative to event start',
  });
  await expect(reminder).toBeVisible();
  await reminder.check();
  await expect(reminder).toBeChecked();
  await dialog.getByRole('button', { name: 'Close room reminder' }).click();
  await dialog.getByRole('button', { name: 'Notify room' }).click();
  await expect(reminder).toBeChecked();
  await reminder.uncheck();
  await expect(reminder).not.toBeChecked();
  await dialog.getByRole('button', { name: 'Close room reminder' }).click();
  await dialog.getByRole('button', { name: 'Notify room' }).click();
  await expect(reminder).not.toBeChecked();

  await waitForDialogTransitions(dialog);
  const dimensions = await readDialogMeasurements(dialog);
  await test.info().attach('room-manager-layout.json', {
    body: JSON.stringify(dimensions),
    contentType: 'application/json',
  });
  expect(dimensions.documentWidth).toBeLessThanOrEqual(
    dimensions.viewportWidth + 1,
  );
  expect(dimensions.dialogWidth).toBeLessThanOrEqual(dimensions.viewportWidth);
  expect(dimensions.dialogScrollWidth).toBeLessThanOrEqual(
    dimensions.dialogClientWidth + 1,
  );
  expect(dimensions.roomLinkPaintOpacity).toBe(1);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(event).toBeFocused();
  expect(pageErrors).toEqual([]);
});

async function tabToEvent(page: Page, event: Locator): Promise<void> {
  for (let tab = 0; tab < 64; tab += 1) {
    await page.keyboard.press('Tab');
    if (await event.evaluate((element) => element === document.activeElement)) {
      return;
    }
  }
}

async function waitForDialogTransitions(dialog: Locator): Promise<void> {
  await dialog.evaluate(async (element) => {
    const dialogRoot = element.closest('.MuiDialog-root');
    if (!dialogRoot) return;

    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });
    const dialogElements = [
      dialogRoot,
      ...Array.from(dialogRoot.querySelectorAll('*')),
    ];
    const transitions = dialogElements
      .flatMap((dialogElement) => dialogElement.getAnimations())
      .filter((animation) => animation.constructor.name === 'CSSTransition');
    await Promise.all(
      transitions.map((transition) =>
        transition.finished.catch(() => undefined),
      ),
    );
  });
}

async function readDialogMeasurements(dialogLocator: Locator) {
  return dialogLocator.evaluate((dialogElement) => {
    const dialog = dialogElement as HTMLElement;
    const document = dialog.ownerDocument;
    const dialogRoot = dialog.closest<HTMLElement>('.MuiDialog-root');
    if (!dialogRoot) {
      throw new Error('Expected active dialog inside .MuiDialog-root');
    }
    const roomLink = dialog.querySelector<HTMLElement>(
      'a[href^="https://matrix.to/"]',
    );
    let roomLinkPaintOpacity = 1;
    if (roomLink) {
      let currentElement: HTMLElement | null = roomLink;
      while (currentElement) {
        roomLinkPaintOpacity *= Number.parseFloat(
          window.getComputedStyle(currentElement).opacity,
        );
        if (currentElement === dialogRoot) break;
        currentElement = currentElement.parentElement;
      }
    }
    return {
      viewportWidth: document.documentElement.clientWidth,
      documentWidth: document.documentElement.scrollWidth,
      dialogWidth: dialog.getBoundingClientRect().width,
      dialogClientWidth: dialog.clientWidth,
      dialogScrollWidth: dialog.scrollWidth,
      dialogRootOpacity: window.getComputedStyle(dialogRoot).opacity,
      roomLinkColor: roomLink
        ? window.getComputedStyle(roomLink).color
        : undefined,
      roomLinkPaintOpacity,
    };
  });
}
