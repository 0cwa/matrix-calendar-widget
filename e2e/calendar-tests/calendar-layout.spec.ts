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
import { writeFile } from 'node:fs/promises';

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

for (const width of [320, 360, 420, 850, 1280]) {
  for (const language of ['en', 'de'] as const) {
    test(
      'toolbar fits at ' + width + ' CSS pixels in ' + language,
      async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height: 740 });
        for (const theme of ['light', 'dark']) {
          await page.goto(
            '/browser-tests/index.html?mode=gallery&lng=' +
              language +
              '&theme=' +
              theme,
          );
          const navigation = page.getByRole('group', {
            name: language === 'de' ? 'Datumsnavigation' : 'Date navigation',
          });
          const controls = navigation.getByRole('button');
          await expect(controls).toHaveCount(4);
          const dateButtons = await controls.evaluateAll((elements) =>
            elements.map((element) => {
              const box = element.getBoundingClientRect();
              return { middle: box.y + box.height / 2, right: box.right };
            }),
          );
          for (const button of dateButtons) {
            expect(
              Math.abs(button.middle - dateButtons[0].middle),
            ).toBeLessThan(2);
            expect(button.right).toBeLessThanOrEqual(width);
          }
          const create = page.getByRole('button', {
            name: language === 'de' ? 'Termin erstellen' : 'Create event',
            exact: true,
          });
          const options = page.getByRole('button', {
            name: language === 'de' ? 'Kalenderoptionen' : 'Calendar options',
            exact: true,
          });
          await expect(create).toBeEnabled();
          await expect(options).toBeVisible();
          const actionCenters = await Promise.all(
            [create, options].map((action) =>
              action.evaluate((element) => {
                const { top, height } = element.getBoundingClientRect();
                return top + height / 2;
              }),
            ),
          );
          const documentWidth = await page.evaluate(
            () => document.documentElement.scrollWidth,
          );
          await testInfo.attach('toolbar-' + theme + '.json', {
            body: JSON.stringify({
              width,
              language,
              dateButtons,
              actionCenters,
              documentWidth,
            }),
            contentType: 'application/json',
          });
          expect(documentWidth).toBeLessThanOrEqual(width);
          expect(Math.abs(actionCenters[0] - actionCenters[1])).toBeLessThan(2);
          if (width >= 850) {
            expect(
              Math.abs(actionCenters[0] - dateButtons[0].middle),
            ).toBeLessThan(2);
          }
        }
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

  await expect(page.getByText('Read-only', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create event' })).toHaveCount(
    0,
  );
  await expectRoomCalendarOptions(
    page,
    /You can’t create events or change the room calendar here/,
  );

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

test('empty dates keep the toolbar and the create shortcut distinct', async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date('2026-11-28T12:00:00.000Z'));
  await page.goto('/browser-tests/index.html?mode=home');

  const create = page.getByRole('button', {
    name: 'Create event',
    exact: true,
  });
  const add = page.getByRole('button', { name: 'Add an event', exact: true });
  await expect(create).toBeVisible();
  await expect(create).toBeEnabled();
  await add.click();

  const editor = page.getByRole('dialog', { name: 'Create event' });
  await expect(editor).toBeVisible();
  await editor.getByRole('button', { name: 'Cancel' }).click();
  await expect(editor).toBeHidden();
  await expect(create).toBeFocused();
});

test('empty Month dates keep guidance and the grid in view', async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date('2026-11-28T12:00:00.000Z'));
  await page.setViewportSize({ width: 850, height: 640 });
  await page.goto('/browser-tests/index.html?mode=home');
  await page.getByRole('combobox', { name: 'View' }).click();
  await page.getByRole('option', { name: 'Month' }).click();

  await expect(
    page.getByRole('status').filter({ hasText: 'No events in these dates' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Add an event', exact: true }),
  ).toHaveCount(0);
  const grid = page.locator('.fc-dayGridMonth-view');
  await expect(grid).toBeVisible();
  const bounds = await grid.evaluate((element) => ({
    bottom: element.getBoundingClientRect().bottom,
    height: window.innerHeight,
  }));
  expect(bounds.bottom).toBeLessThanOrEqual(bounds.height);
});

for (const height of [640, 520]) {
  test(`German date range recovery fits a 320 by ${height} Element dark viewport`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 320, height });
    await page.goto(
      '/browser-tests/index.html?mode=room-manager&theme=dark&lng=de',
    );
    if (height === 520) {
      await page.addStyleTag({
        content: 'html { overflow-y: scroll; scrollbar-gutter: stable; }',
      });
    }

    const range = page.getByRole('button', {
      name: /^Datumsbereich auswählen/,
    });
    const picker = page.getByRole('dialog');
    const prompt = picker.getByRole('status');
    const chooseStart = 'Wähle ein Startdatum.';
    const day = (number: string) =>
      picker
        .getByRole('gridcell', { name: number, exact: true })
        .and(picker.locator('button:not(.MuiPickersDay-dayOutsideMonth)'));
    const readBounds = async (step: string) => {
      const bounds = await picker.evaluate((element) => {
        const { left, right } = element.getBoundingClientRect();
        return {
          left,
          right,
          viewport: document.documentElement.clientWidth,
          contentWidth: document.body.clientWidth,
          client: element.clientWidth,
          scroll: element.scrollWidth,
          documentScroll: document.documentElement.scrollWidth,
        };
      });
      await writeFile(
        testInfo.outputPath(step + '-picker-bounds.json'),
        JSON.stringify(bounds, null, 2),
      );
      expect(bounds.left).toBeGreaterThanOrEqual(0);
      expect(bounds.right).toBeLessThanOrEqual(bounds.contentWidth + 1);
      expect(bounds.scroll).toBeLessThanOrEqual(bounds.client + 1);
      expect(bounds.documentScroll).toBeLessThanOrEqual(bounds.viewport + 1);
    };

    await range.click();
    await expect(prompt).toHaveText(chooseStart);
    await expect(
      picker.getByRole('button', { name: 'Abbrechen' }),
    ).toBeVisible();
    const recover = picker.getByRole('button', { name: 'Start ändern' });
    await expect(recover).toHaveCount(0);
    await readBounds('start');

    await day('15').click();
    await expect(prompt).toHaveText(/Wähle jetzt ein Enddatum\./);
    await expect(day('14')).toBeDisabled();
    await expect(recover).toBeVisible();
    await readBounds('end');
    const accessibility = await new AxeBuilder({ page })
      .include('[role="dialog"]')
      .analyze();
    expect(accessibility.violations).toEqual([]);

    await recover.press('Enter');
    await expect(prompt).toHaveText(chooseStart);
    await expect(day('14')).toBeEnabled();
    await expect(
      picker.locator('[role="grid"] [role="gridcell"]:focus'),
    ).toHaveCount(1);
    await day('14').click();
    await day('16').click();
    await expect(picker).toBeHidden();
    await expect(range).toBeFocused();
    const committedRange = await range.getAttribute('aria-label');

    await range.click();
    await day('15').click();
    await picker.getByRole('button', { name: 'Abbrechen' }).click();
    await expect(picker).toBeHidden();
    await expect(range).toBeFocused();
    await expect(range).toHaveAttribute('aria-label', committedRange!);

    await range.click();
    await expect(prompt).toHaveText(chooseStart);
    await day('15').press('Enter');
    await expect(recover).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(picker).toBeHidden();
    await expect(range).toBeFocused();
    await expect(range).toHaveAttribute('aria-label', committedRange!);
  });
}

test.describe('mobile date range picker', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 740 } });

  test('keeps mobile actions and only offers Today for a valid boundary', async ({
    page,
  }) => {
    await page.clock.setFixedTime(new Date('2026-10-10T10:00:00.000Z'));
    await page.goto('/browser-tests/index.html?mode=room-manager');
    const range = page
      .getByRole('group', { name: 'Date navigation' })
      .getByRole('button', { name: /^Choose date(?: range)?, selected/ });
    const committed = await range.textContent();
    await range.click();
    const picker = page.getByRole('dialog');
    await expect(
      picker.getByRole('button', { name: 'OK', exact: true }),
    ).toBeVisible();
    const today = picker.getByRole('button', { name: 'Today', exact: true });
    await expect(today).toBeVisible();
    await picker.getByRole('gridcell', { name: '15', exact: true }).click();
    await expect(
      picker.getByRole('button', { name: 'Change start' }),
    ).toBeVisible();
    await expect(today).toHaveCount(0);
    await picker.getByRole('button', { name: 'Cancel' }).click();
    await expect(picker).toBeHidden();
    await expect(range).toHaveText(committed!);
  });
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
  await expectRoomCalendarOptions(page, /The room calendar can’t be renamed/);

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
  note: RegExp,
): Promise<void> {
  const options = page.getByRole('button', { name: 'Calendar options' });
  await options.click();
  const guidance = page.getByRole('dialog', { name: 'Calendar options' });
  await expect(guidance.getByText(note)).toBeVisible();
  await expect(guidance.getByRole('menuitem')).toHaveCount(0);
  await expect(guidance).toBeFocused();
  const accessibility = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .analyze();
  expect(accessibility.violations).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(guidance).toBeHidden();
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
