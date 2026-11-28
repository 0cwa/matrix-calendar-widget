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

for (const width of [360, 420, 850]) {
  for (const language of ['en', 'de'] as const) {
    test(
      'date controls share a row at ' + width + ' CSS pixels in ' + language,
      async ({ page }) => {
        await page.setViewportSize({ width, height: 740 });
        await page.goto(
          '/browser-tests/index.html?mode=gallery&lng=' + language,
        );
        const navigation = page.getByRole('group', {
          name: language === 'de' ? 'Datumsnavigation' : 'Date navigation',
        });
        const controls = navigation.getByRole('button');
        await expect(controls).toHaveCount(4);
        const boxes = await controls.evaluateAll((elements) =>
          elements.map((element) => {
            const box = element.getBoundingClientRect();
            return { middle: box.y + box.height / 2, right: box.right };
          }),
        );
        for (const box of boxes) {
          expect(Math.abs(box.middle - boxes[0].middle)).toBeLessThan(2);
          expect(box.right).toBeLessThanOrEqual(width);
        }
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
        ).toBeLessThanOrEqual(width);
      },
    );
  }
}

test('a narrow day view gives way to the chosen month again', async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date('2026-10-21T10:00:00.000Z'));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/browser-tests/index.html?mode=home');
  const view = page.getByRole('combobox', { name: 'View' });
  await view.click();
  await page.getByRole('option', { name: 'Month' }).click();
  await page.getByRole('button', { name: 'Previous month' }).click();
  const month = page.getByRole('button', {
    name: 'Choose month, selected month is September 2026',
  });
  await expect(month).toBeVisible();

  await page.setViewportSize({ width: 420, height: 740 });
  await expect(view).toContainText('Day');
  await expect(
    page.getByRole('button', { name: 'Previous day' }),
  ).toBeVisible();

  await page.setViewportSize({ width: 850, height: 740 });
  await expect(view).toContainText('Month');
  await expect(month).toBeVisible();
});

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
  await expectRoomCalendarOptions(page, [
    /You can’t create events here/,
    /The room calendar can’t be renamed/,
  ]);

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
  await expect(
    dialog.getByRole('button', {
      name: 'Matrix room notifications',
      exact: true,
    }),
  ).toHaveCount(0);

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

test('German date range picker fits a 320 px Element dark viewport', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(
    '/browser-tests/index.html?mode=room-manager&theme=dark&lng=de',
  );

  const range = page.getByRole('button', { name: /^Datumsbereich auswählen/ });
  await range.click();
  const picker = page.getByRole('dialog');
  const prompt = picker.getByRole('status');
  await expect(prompt).toHaveText('Wähle ein Startdatum.');

  const bounds = await picker.evaluate((element) => {
    const { left, right } = element.getBoundingClientRect();
    return { left, right, viewport: document.documentElement.clientWidth };
  });
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(bounds.viewport);

  const currentMonthDays = picker.locator(
    'button:not(.MuiPickersDay-dayOutsideMonth)',
  );
  await picker
    .getByRole('gridcell', { name: '1', exact: true })
    .and(currentMonthDays)
    .click();
  await expect(prompt).toHaveText(/Wähle jetzt ein Enddatum\./);
  await picker
    .getByRole('gridcell', { name: '2', exact: true })
    .and(currentMonthDays)
    .click();
  await expect(picker).toBeHidden();
  await expect(range).toBeFocused();
});

test('room manager sees writable event controls at a narrow width', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) =>
    pageErrors.push(error.message.slice(0, 2000)),
  );
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(
    '/browser-tests/index.html?mode=room-manager&meetings_bot_user_id=%40calendar-bot%3Aexample.test',
  );
  await expect(
    page.getByRole('heading', { name: 'Calendar component validation' }),
  ).toBeVisible();

  const createEvent = page.getByRole('button', { name: 'Create event' });
  await expect(createEvent).toBeEnabled();
  await expectRoomCalendarOptions(page, [/The room calendar can’t be renamed/]);

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
  await expect(page.locator('body')).not.toHaveAttribute('aria-hidden', 'true');
  await dialog
    .getByRole('button', { name: 'Matrix room notifications', exact: true })
    .click();
  await expect(
    dialog.getByText(
      'Calendar app alert 1: 15 minutes before the event starts',
    ),
  ).toBeVisible();
  const destination = dialog.getByRole('combobox', {
    name: 'Who to notify in this room',
  });
  await destination.click();
  await expect(page.getByRole('option', { name: 'Whole room' })).toBeVisible();
  await page.getByRole('option', { name: 'Selected people' }).click();
  const people = dialog.getByRole('combobox', { name: 'Selected people' });
  await dialog.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page.getByRole('option', { name: 'Alice' })).toBeVisible();
  await expect(page.getByRole('option', { name: 'Bob' })).toBeVisible();
  await expect(page.getByRole('option', { name: 'Calendar bot' })).toHaveCount(
    0,
  );
  await people.fill('Bob');
  await expect(page.getByRole('option', { name: 'Bob' })).toBeVisible();
  await expect(page.getByRole('option')).toHaveCount(1);
  await people.press('ArrowDown');
  await people.press('Enter');
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('listbox')).toBeHidden();
  await expect(dialog.locator('.MuiAutocomplete-tag')).toHaveText(['Bob']);
  await dialog
    .getByRole('button', { name: 'Save room notification', exact: true })
    .click();
  await expect(
    dialog.getByText('Matrix pings the selected people.', { exact: true }),
  ).toBeVisible();
  await dialog
    .getByRole('button', {
      name: 'Close Matrix room notifications',
      exact: true,
    })
    .click();
  await dialog
    .getByRole('button', { name: 'Matrix room notifications', exact: true })
    .click();
  await expect(
    dialog.getByText(
      'Calendar app alert 1: 15 minutes before the event starts',
    ),
  ).toBeVisible();
  await expect(
    dialog.getByText('Matrix pings the selected people.', { exact: true }),
  ).toBeVisible();
  await expect(dialog.locator('.MuiAutocomplete-tag')).toHaveText(['Bob']);
  await dialog
    .getByRole('button', {
      name: 'Close Matrix room notifications',
      exact: true,
    })
    .click();

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

/** A room calendar offers no management actions, only the reasons why. */
async function expectRoomCalendarOptions(
  page: Page,
  notes: RegExp[],
): Promise<void> {
  const options = page.getByRole('button', { name: 'Calendar options' });
  await options.click();
  const items = page
    .getByRole('menu', { name: 'Calendar options' })
    .getByRole('menuitem');
  await expect(items).toHaveText(notes);
  // Scan the menu itself: MUI renders it outside the page landmarks.
  const accessibility = await new AxeBuilder({ page })
    .include('[role="menu"]')
    .analyze();
  expect(accessibility.violations).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(items).toHaveCount(0);
  await expect(options).toBeFocused();
}

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
