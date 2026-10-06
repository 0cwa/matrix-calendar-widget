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
import { writeFile } from 'node:fs/promises';

const eventCount = 1000;
const monthOverflowLinkCount = 31;
const viewport = { width: 1280, height: 800 };
const eventSelector = 'li[aria-label^="Synthetic capacity event "]';
const expectedEventTitles = Array.from(
  { length: eventCount },
  (_, index) =>
    `Synthetic capacity event ${String(index + 1).padStart(4, '0')}`,
).sort();

type LongTaskSummary = {
  supported: boolean;
  count: number;
  maximumDurationMs: number;
};
type RenderMeasurement = {
  status: 'ready' | 'timeout';
  elapsedMs?: number;
  populatedElementCount: number;
};
type PageErrorCapture = {
  count: number;
  messages: string[];
};

declare global {
  interface Window {
    __largeCalendarLongTaskSummary?: LongTaskSummary;
    __largeCalendarRenderMeasurement?: RenderMeasurement;
  }
}

for (const view of ['list', 'month'] as const) {
  test(`1,000 event ${view} render measurements`, async ({
    page,
    browser,
  }, testInfo) => {
    test.setTimeout(120_000);
    const pageErrors: PageErrorCapture = { count: 0, messages: [] };
    page.on('pageerror', (error) => {
      pageErrors.count += 1;
      if (pageErrors.messages.length < 5) {
        pageErrors.messages.push(sanitizePageErrorMessage(error.message));
      }
    });
    await installLongTaskObserver(page);
    await page.setViewportSize(viewport);

    const warmup = await runSample(page, view, pageErrors);
    const samples = [];
    for (let sample = 0; sample < 5; sample += 1) {
      samples.push(await runSample(page, view, pageErrors));
    }

    const elapsedTimes = samples
      .map(({ elapsedMs }) => elapsedMs)
      .sort((left, right) => left - right);
    const environment = await page.evaluate(() => ({
      userAgent: navigator.userAgent,
      viewportWidth: document.documentElement.clientWidth,
      viewportHeight: document.documentElement.clientHeight,
    }));
    const measurementJson = JSON.stringify(
      {
        mode: view,
        dateRange: '2026-10-01 through 2026-11-01',
        generatedEventCount: eventCount,
        viewport,
        browserName: browser.browserType().name(),
        environment,
        warmup,
        sampleCount: samples.length,
        samples,
        medianElapsedMs: elapsedTimes[2],
        maximumElapsedMs: elapsedTimes[elapsedTimes.length - 1],
        elapsedMeasurement:
          'fixture root render start to populated DOM and two animation frames; observational only',
      },
      null,
      2,
    );
    const measurementPath = testInfo.outputPath(
      `large-calendar-${view}-measurements.json`,
    );
    await writeFile(measurementPath, measurementJson, 'utf8');
    await testInfo.attach(`large-calendar-${view}-measurements.json`, {
      path: measurementPath,
      contentType: 'application/json',
    });
    expect(
      pageErrors.count,
      `Sanitized browser page errors: ${JSON.stringify(pageErrors.messages)}`,
    ).toBe(0);
  });
}

async function runSample(
  page: Page,
  view: 'list' | 'month',
  pageErrors: PageErrorCapture,
) {
  const priorPageErrorCount = pageErrors.count;
  const priorMessageCount = pageErrors.messages.length;
  await page.goto(`/browser-tests/index.html?mode=large-calendar&view=${view}`);
  try {
    await expect(
      page.getByRole('heading', { name: 'Calendar component validation' }),
    ).toBeVisible();
  } catch {
    const messages = pageErrors.messages.slice(priorMessageCount);
    const newErrorCount = pageErrors.count - priorPageErrorCount;
    throw new Error(
      `Calendar fixture heading did not appear for ${view}; ` +
        `${newErrorCount} page errors; sanitized messages: ${JSON.stringify(messages)}`,
    );
  }

  const readiness = await readCapturedRenderMeasurement(page, view);
  const overflow = await readAndCheckOverflow(page);
  let titles: string[];
  let monthEventCounts:
    | {
        visibleEventCount: number;
        overflowEventCount: number;
        parseableOverflowLinkCount: number;
      }
    | undefined;
  let returnedListOverflow:
    | Awaited<ReturnType<typeof readAndCheckOverflow>>
    | undefined;

  if (view === 'list') {
    titles = await readAndCheckExactEventTitles(page);
  } else {
    const moreLinks = page.locator('.fc-daygrid-more-link');
    await expect(moreLinks).toHaveCount(monthOverflowLinkCount);
    const overflowEventCounts = await page.evaluate(() => {
      const overflowCounts = Array.from(
        document.querySelectorAll('.fc-daygrid-more-link'),
        (element) => element.textContent?.match(/\d+/)?.[0],
      );
      return {
        overflowEventCount: overflowCounts.reduce(
          (total, count) => total + (count ? Number(count) : 0),
          0,
        ),
        parseableOverflowLinkCount: overflowCounts.filter(
          (count) => count !== undefined,
        ).length,
      };
    });
    monthEventCounts = {
      ...overflowEventCounts,
      visibleEventCount: await page
        .locator('.fc-daygrid-event:visible')
        .count(),
    };
    expect(monthEventCounts.parseableOverflowLinkCount).toBe(
      monthOverflowLinkCount,
    );
    expect(
      monthEventCounts.visibleEventCount + monthEventCounts.overflowEventCount,
    ).toBe(eventCount);

    await expect(moreLinks.first()).toBeVisible();
    await moreLinks.first().click();
    titles = await readAndCheckExactEventTitles(page);
    returnedListOverflow = await readAndCheckOverflow(page);
  }

  expect(
    pageErrors.count,
    `Sanitized browser page errors: ${JSON.stringify(pageErrors.messages)}`,
  ).toBe(0);
  return {
    ...readiness,
    overflow,
    longTasks: await readLongTaskSummary(page),
    ...(monthEventCounts === undefined ? {} : monthEventCounts),
    ...(returnedListOverflow === undefined ? {} : { returnedListOverflow }),
    monthOverflowLinkCount:
      view === 'month' ? readiness.populatedElementCount : undefined,
    returnedListCount: titles.length,
    uniqueReturnedTitleCount: new Set(titles).size,
  };
}

function sanitizePageErrorMessage(message: string): string {
  return message
    .replace(/https?:\/\/\S+/gi, '<url>')
    .replace(/\bBearer\s+\S+/gi, 'Bearer <redacted>')
    .replace(
      /\b(password|token|authorization)\b\s*[:=]\s*\S+/gi,
      '$1=<redacted>',
    )
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

async function installLongTaskObserver(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const supported =
      typeof PerformanceObserver !== 'undefined' &&
      PerformanceObserver.supportedEntryTypes?.includes('longtask') === true;
    const summary: LongTaskSummary = {
      supported,
      count: 0,
      maximumDurationMs: 0,
    };
    window.__largeCalendarLongTaskSummary = summary;

    if (!supported) return;
    const observer = new PerformanceObserver((list) => {
      const mountStart = performance
        .getEntriesByName('synthetic-large-calendar-mount-start', 'mark')
        .at(0);
      if (!mountStart) return;
      const measurementEnd = performance
        .getEntriesByName('synthetic-large-calendar-render-ready', 'mark')
        .at(0)?.startTime;
      for (const entry of list.getEntries()) {
        if (
          entry.startTime >= mountStart.startTime &&
          (measurementEnd === undefined || entry.startTime <= measurementEnd)
        ) {
          summary.count += 1;
          summary.maximumDurationMs = Math.max(
            summary.maximumDurationMs,
            entry.duration,
          );
        }
      }
    });
    observer.observe({ type: 'longtask', buffered: true });
  });
}

async function readLongTaskSummary(page: Page): Promise<LongTaskSummary> {
  await page.evaluate(
    () => new Promise<void>((resolve) => window.setTimeout(resolve, 0)),
  );
  return page.evaluate(
    () =>
      window.__largeCalendarLongTaskSummary ?? {
        supported: false,
        count: 0,
        maximumDurationMs: 0,
      },
  );
}

async function readCapturedRenderMeasurement(
  page: Page,
  view: 'list' | 'month',
): Promise<{
  elapsedMs: number;
  populatedElementCount: number;
}> {
  await page.waitForFunction(
    () => window.__largeCalendarRenderMeasurement !== undefined,
    null,
    { timeout: 60_000 },
  );
  const result = await page.evaluate(
    () => window.__largeCalendarRenderMeasurement,
  );
  if (result?.status !== 'ready' || result.elapsedMs === undefined) {
    throw new Error('Synthetic calendar did not reach its populated DOM');
  }
  expect(result.populatedElementCount).toBe(
    view === 'list' ? eventCount : monthOverflowLinkCount,
  );
  return {
    elapsedMs: result.elapsedMs,
    populatedElementCount: result.populatedElementCount,
  };
}

async function readAndCheckOverflow(page: Page) {
  const dimensions = await page
    .getByTestId('calendar-surface')
    .evaluate((surface) => ({
      viewportWidth: document.documentElement.clientWidth,
      documentWidth: document.documentElement.scrollWidth,
      surfaceWidth: surface.getBoundingClientRect().width,
      surfaceScrollWidth: surface.scrollWidth,
    }));
  expect(dimensions.documentWidth).toBeLessThanOrEqual(
    dimensions.viewportWidth + 1,
  );
  expect(dimensions.surfaceScrollWidth).toBeLessThanOrEqual(
    dimensions.surfaceWidth + 1,
  );
  return dimensions;
}

async function readAndCheckExactEventTitles(page: Page): Promise<string[]> {
  const eventItems = page.locator(eventSelector);
  await expect(eventItems).toHaveCount(eventCount, { timeout: 30_000 });
  const titles = await eventItems.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('aria-label') ?? ''),
  );
  expect([...titles].sort()).toEqual(expectedEventTitles);
  return titles;
}
