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

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { buildOrdinaryPerformanceSeedEnvironment } from '../../dev/element-acceptance-performance.mjs';
import {
  type OrdinaryPerformanceCase,
  type OrdinaryPerformanceProfile,
  type OrdinaryPerformanceReport,
  type PerformanceActionSample,
  type PerformanceRangeClass,
  type PerformanceReport,
  type PerformanceSampleKey,
} from './elementAcceptanceSupportTypes';
export function elapsedMilliseconds(startedAt: number): number {
  return roundPerformanceMilliseconds(performance.now() - startedAt);
}

export function roundPerformanceMilliseconds(value: number): number {
  return Math.max(0, Number(value.toFixed(3)));
}

export function localCalendarDate(date: Date): {
  year: number;
  month: number;
  day: number;
} {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Stockholm',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(date)
      .filter(({ type }) => type !== 'literal')
      .map(({ type, value }) => [type, Number(value)]),
  );
  return {
    year: values.year as number,
    month: values.month as number,
    day: values.day as number,
  };
}

export function shiftCalendarDate(
  year: number,
  month: number,
  day: number,
  amount: number,
): { year: number; month: number; day: number } {
  const date = new Date(Date.UTC(year, month - 1, day + amount));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

export function localMidnightEpoch(
  year: number,
  month: number,
  day: number,
): number {
  const target = Date.UTC(year, month - 1, day);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Stockholm',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  let guess = target;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const values = Object.fromEntries(
      formatter
        .formatToParts(new Date(guess))
        .filter(({ type }) => type !== 'literal')
        .map(({ type, value }) => [type, Number(value)]),
    );
    const represented = Date.UTC(
      values.year as number,
      (values.month as number) - 1,
      values.day as number,
      values.hour as number,
      values.minute as number,
      values.second as number,
    );
    const adjustment = target - represented;
    guess += adjustment;
    if (adjustment === 0) return guess;
  }
  return guess;
}

export function performanceMonthRange(
  year: number,
  month: number,
  view: 'list' | 'month',
): { start: number; end: number } {
  const firstDay = localMidnightEpoch(year, month, 1);
  const nextMonth = localMidnightEpoch(year, month + 1, 1);
  return view === 'month'
    ? {
        start: localMidnightEpoch(year, month, -6),
        end: localMidnightEpoch(year, month + 1, 8),
      }
    : { start: firstDay, end: nextMonth };
}

export function performanceDayRange(
  year: number,
  month: number,
  day: number,
): { start: number; end: number } {
  return {
    start: localMidnightEpoch(year, month, day),
    end: localMidnightEpoch(year, month, day + 1),
  };
}

export function performancePreselectionRange(
  initialDate: {
    year: number;
    month: number;
    day: number;
  },
  offsetDays = 0,
): { start: number; end: number } {
  const startDate = shiftCalendarDate(
    initialDate.year,
    initialDate.month,
    initialDate.day,
    offsetDays,
  );
  const endDate = shiftCalendarDate(
    startDate.year,
    startDate.month,
    startDate.day,
    7,
  );
  return {
    start: localMidnightEpoch(startDate.year, startDate.month, startDate.day),
    end: localMidnightEpoch(endDate.year, endDate.month, endDate.day),
  };
}

export function makeEmptyPerformanceReport(
  year: number,
  month: number,
): PerformanceReport {
  return {
    version: 2,
    year,
    month,
    viewportWidth: 1280,
    viewportHeight: 800,
    workloadEvents: 250,
    calendarDays: 31,
    timezone: 'Europe/Stockholm',
    preparation: { elementLoginMs: null, roomNavigationMs: null },
    coldList: {
      durationMs: null,
      widgetStartupMs: null,
      activationMs: null,
      capabilityApprovalMs: null,
      identityApprovalMs: null,
      iframeReadyMs: null,
      placement: 'unknown',
      widgetCardCount: 0,
      widgetCardVisible: false,
      appDrawerCount: 0,
      persistedHostFrameCount: 0,
      persistedHostFrameVisible: false,
      iframeWidth: null,
      iframeHeight: null,
      hostHorizontalOverflow: null,
      rangeSelectionMs: null,
      openIdResponseCount: 0,
      openIdMaxMs: null,
      apiRangeMaxMs: null,
      selectedRoomResponseCount: 0,
      returnedCount: null,
      renderedCount: null,
      expectedRangeMatches: false,
      identitiesMatch: false,
      diagnosticsZero: false,
      stable: false,
      horizontalOverflow: null,
    },
    viewWarmups: [],
    viewSamples: [],
    detailWarmups: [],
    detailSamples: [],
    overflow: {
      visibleEventCount: null,
      collapsedEventCount: null,
      renderedEventCount: null,
      opened: false,
      expectedDayEventCount: null,
      dayEventCount: null,
      dayIdentityMatches: false,
      stable: false,
    },
    apiResponses: [],
    blockedRequestCount: null,
    pageErrorCount: null,
    pageErrorClass: 'none',
  };
}

export function makeEmptyActionSample(): PerformanceActionSample {
  return {
    durationMs: null,
    apiResponseCount: 0,
    apiRangeMaxMs: null,
    roomResponseCount: 0,
    returnedCount: null,
    renderedCount: null,
    rangeMatches: false,
    identitiesMatch: false,
    diagnosticsZero: false,
    stable: false,
    horizontalOverflow: null,
  };
}

export function makeEmptyOrdinaryPerformanceCase(
  profile: OrdinaryPerformanceProfile,
  year: number,
  month: number,
): OrdinaryPerformanceCase {
  return {
    profile,
    year,
    month,
    eventCount: profile === 'empty' ? 0 : 25,
    preparation: { elementLoginMs: null, roomNavigationMs: null },
    defaultView: {
      durationMs: null,
      apiResponseCount: 0,
      apiRangeMaxMs: null,
      returnedCount: null,
      renderedCount: null,
      rangeMatches: false,
      countMatches: false,
      usableControlVisible: false,
      stable: false,
    },
    defaultWaitObservation: null,
    coldList: makeEmptyPerformanceReport(year, month).coldList,
    refreshSetup: makeEmptyActionSample(),
    refresh: makeEmptyActionSample(),
    detailSamples: [],
  };
}

export function makeEmptyOrdinaryPerformanceReport(initialDate: {
  year: number;
  month: number;
}): OrdinaryPerformanceReport {
  return {
    version: 14,
    viewportWidth: 1280,
    viewportHeight: 800,
    calendarDays: 7,
    timezone: 'Europe/Stockholm',
    cases: [
      makeEmptyOrdinaryPerformanceCase(
        'empty',
        initialDate.year,
        initialDate.month,
      ),
      makeEmptyOrdinaryPerformanceCase(
        'events-25',
        initialDate.year,
        initialDate.month,
      ),
    ],
    apiResponses: [],
    blockedRequestCount: 0,
    pageErrorCount: 0,
    pageErrorClass: 'none',
    pageErrorObservations: [],
    pageErrorObservationOverflow: false,
  };
}

export function runOrdinaryPerformanceSeed(initialDate: {
  year: number;
  month: number;
  day: number;
}): void {
  const seedEnvironment = buildOrdinaryPerformanceSeedEnvironment(
    process.env,
    `${initialDate.year}-${String(initialDate.month).padStart(2, '0')}-${String(initialDate.day).padStart(2, '0')}`,
  );

  const result = spawnSync(
    process.execPath,
    [
      resolve(process.cwd(), '../dev/element-acceptance-performance.mjs'),
      'seed-ordinary',
    ],
    { env: seedEnvironment, stdio: 'ignore' },
  );
  if (result.error || result.status !== 0) {
    throw new Error('Ordinary performance fixture seeding failed');
  }
}

export function makePerformanceTitles(
  runId: string,
  attempt: string,
  count = 250,
): string[] {
  if (!/^\d{1,20}$/u.test(runId) || !/^\d{1,6}$/u.test(attempt)) {
    throw new Error('Element performance run identity is unavailable');
  }
  return Array.from(
    { length: count },
    (_, index) =>
      `Performance ${runId}-${attempt}-${String(index + 1).padStart(3, '0')}`,
  );
}

export function performanceRangeExpectation(
  sample: PerformanceSampleKey,
  year: number,
  month: number,
  initialDate: { year: number; month: number; day: number },
): {
  rangeClass: PerformanceRangeClass;
  start: number;
  end: number;
} {
  if (sample === 'cold-list') {
    return {
      rangeClass: 'list31',
      ...performanceMonthRange(year, month, 'list'),
    };
  }
  if (sample.endsWith('-refresh-setup')) {
    return {
      rangeClass: 'preselection-next',
      ...performancePreselectionRange(initialDate, 7),
    };
  }
  if (sample.endsWith('-refresh') || sample.startsWith('events-25-details-')) {
    return {
      rangeClass: 'preselection',
      ...performancePreselectionRange(initialDate),
    };
  }
  if (sample === 'overflow-day') {
    return {
      rangeClass: 'overflow-day',
      ...performanceDayRange(year, month, 1),
    };
  }
  if (
    sample === 'overflow-month' ||
    sample === 'overflow-reset-month' ||
    sample.startsWith('warmup-month-') ||
    sample.startsWith('measured-month-')
  ) {
    return {
      rangeClass: 'month-padded',
      ...performanceMonthRange(year, month, 'month'),
    };
  }
  if (
    sample === 'overflow-reset-list' ||
    sample.startsWith('warmup-list-') ||
    sample.startsWith('measured-list-') ||
    sample.startsWith('details-')
  ) {
    return {
      rangeClass: 'list31',
      ...performanceMonthRange(year, month, 'list'),
    };
  }
  return {
    rangeClass: 'preselection',
    ...performancePreselectionRange(initialDate),
  };
}
