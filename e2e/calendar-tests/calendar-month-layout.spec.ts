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
import { expect, test, type Locator } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

for (const language of ['en', 'de'] as const) {
  for (const theme of ['light', 'dark']) {
    test(`Month event times and columns fit in ${language} and ${theme}`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(
        `/browser-tests/index.html?mode=month-layout&view=month&lng=${language}&theme=${theme}`,
      );
      const grid = page.locator('.fc-dayGridMonth-view');
      const timed = grid.locator('[role="button"].mcw-month-timed');
      const startTime = grid.getByTestId('month-event-start-time');
      const overnight = grid.getByRole('button', {
        name: /^Overnight maintenance with a long event title:/,
      });
      const allDay = grid.getByRole('button', { name: /^All-day planning:/ });
      await expect(timed).toHaveCount(10);
      await expect(startTime).toHaveCount(11);
      await expect(timed.first()).toHaveCSS(
        'background-color',
        'rgba(0, 0, 0, 0)',
      );
      await expect(allDay).not.toHaveCSS(
        'background-color',
        'rgba(0, 0, 0, 0)',
      );
      await expect(overnight.first()).not.toHaveCSS(
        'background-color',
        'rgba(0, 0, 0, 0)',
      );
      await expect(overnight.getByTestId('month-event-start-time')).toHaveText(
        language === 'de' ? '21:30' : /9:30\sPM/,
      );
      await expect(
        timed.first().getByTestId('month-event-start-time'),
      ).toHaveText(language === 'de' ? '09:00' : /9:00\sAM/);
      await expect(allDay.getByTestId('month-event-start-time')).toHaveCount(0);

      const measurements = [];
      for (const [width, height] of [
        [1280, 800],
        [850, 640],
        [1280, 800],
      ]) {
        await page.setViewportSize({ width, height });
        await expect
          .poll(async () => {
            const geometry = await readMonthGeometry(grid);
            return (
              geometry.headers.length === 7 &&
              geometry.cells.length === 7 &&
              geometry.headers.every(
                ({ left, right }, index) =>
                  Math.abs(left - geometry.cells[index].left) <= 2 &&
                  Math.abs(right - geometry.cells[index].right) <= 2,
              ) &&
              Math.abs(geometry.right - geometry.cells[6].right) <= 18 &&
              geometry.cells[6].right <= geometry.right + 1 &&
              geometry.right <= width
            );
          })
          .toBe(true);
        const geometry = await readMonthGeometry(grid);
        const timeBounds = await startTime.evaluateAll((elements) =>
          elements.map((element) => {
            const time = element.getBoundingClientRect();
            const event = element.closest('.fc-event')!.getBoundingClientRect();
            return {
              width: time.width,
              clipped:
                time.left < event.left ||
                time.right > event.right ||
                time.top < event.top ||
                time.bottom > event.bottom,
            };
          }),
        );
        expect(timeBounds).toHaveLength(11);
        expect(
          timeBounds.every(({ width, clipped }) => width > 0 && !clipped),
        ).toBe(true);
        measurements.push({ width, height, geometry, timeBounds });
      }
      const accessibility = await new AxeBuilder({ page })
        .include('.fc-dayGridMonth-view')
        .analyze();
      expect(accessibility.violations).toEqual([]);
      await writeFile(
        testInfo.outputPath('month-layout.json'),
        JSON.stringify(measurements, null, 2),
      );
    });
  }
}

test('a five-week empty Month fits at 850 by 640', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-12T10:00:00.000Z'));
  await page.setViewportSize({ width: 850, height: 640 });
  await page.goto('/browser-tests/index.html?mode=home');
  await page.getByRole('combobox', { name: 'View' }).click();
  await page.getByRole('option', { name: 'Month' }).click();
  const grid = page.locator('.fc-dayGridMonth-view');
  const days = grid.locator('td.fc-day');
  await expect(days).toHaveCount(35);
  const scroller = days
    .first()
    .locator('xpath=ancestor::div[contains(@class,"fc-scroller")][1]');
  const content = await scroller.evaluate((element) => ({
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
    bottom: element.getBoundingClientRect().bottom,
  }));
  expect(content.scrollHeight).toBeLessThanOrEqual(content.clientHeight + 1);
  expect(content.bottom).toBeLessThanOrEqual(640);
});

test('a short six-week Month scrolls all the way to the final dates', async ({
  page,
}) => {
  await page.setViewportSize({ width: 850, height: 470 });
  await page.goto(
    '/browser-tests/index.html?mode=month-layout&view=month&lng=de',
  );
  await page.getByRole('button', { name: 'Nächster Monat' }).click();
  const days = page.locator('.fc-dayGridMonth-view td.fc-day');
  await expect(days).toHaveCount(42);
  const dimensions = await days.last().evaluate((day) => {
    const scroller = day.closest('.fc-scroller')!;
    scroller.scrollTop = scroller.scrollHeight;
    return {
      rowHeight: day.getBoundingClientRect().height,
      clientHeight: scroller.clientHeight,
      scrollHeight: scroller.scrollHeight,
      scrollTop: scroller.scrollTop,
      lastDateBottom: day.getBoundingClientRect().bottom,
      scrollerBottom: scroller.getBoundingClientRect().bottom,
    };
  });
  expect(dimensions.rowHeight).toBeGreaterThanOrEqual(83);
  expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight);
  expect(dimensions.scrollTop).toBeGreaterThan(0);
  expect(dimensions.lastDateBottom).toBeLessThanOrEqual(
    dimensions.scrollerBottom + 2,
  );
});

function readMonthGeometry(grid: Locator) {
  return grid.evaluate((element) => {
    const columns = (selector: string) =>
      Array.from(element.querySelectorAll(selector))
        .slice(0, 7)
        .map((cell) => {
          const { left, right } = cell.getBoundingClientRect();
          return { left, right };
        });
    return {
      headers: columns('th.fc-col-header-cell'),
      cells: columns('td.fc-day'),
      right: element.getBoundingClientRect().right,
    };
  });
}
