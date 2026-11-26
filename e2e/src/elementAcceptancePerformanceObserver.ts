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

import { type Page, type Request } from '@playwright/test';
import { performance } from 'node:perf_hooks';
import {
  MAX_DEFAULT_WAIT_DIAGNOSTIC_COUNT,
  summarizeDefaultWaitObservation,
  type PerformanceDefaultWaitFailureSnapshot,
} from '../../dev/element-acceptance-performance-evidence.mjs';
import {
  performancePreselectionRange,
  performanceRangeExpectation,
  roundPerformanceMilliseconds,
} from './elementAcceptancePerformanceHelpers';
import { isRecord } from './elementAcceptanceShared';
import type {
  PerformanceApiObserver,
  PerformanceApiResponse,
  PerformanceEndpoint,
  PerformancePendingRequest,
  PerformanceRangeClass,
  PerformanceSampleKey,
} from './elementAcceptanceSupportTypes';
import type { Fixture } from './elementAcceptanceTypes';
import { ElementWebPage } from './pages/elementWebPage';

export function createPerformanceObservationHelpers(supportContext: {
  fixture: Fixture;
}) {
  async function observeDefaultWaitFailureSnapshot(
    page: Page,
    frame: ReturnType<ElementWebPage['widgetByTitle']>,
    gatewayUrl: string,
    expectedRoomId: string,
    observer: PerformanceApiObserver,
    sample: PerformanceSampleKey,
  ): Promise<PerformanceDefaultWaitFailureSnapshot> {
    const unavailableConfiguration: PerformanceDefaultWaitFailureSnapshot['widgetConfiguration'] =
      {
        available: false,
        gatewayBaseParameterPresent: null,
        gatewayBaseValuePresent: null,
        gatewayBaseOriginMatches: null,
        roomIdParameterPresent: null,
        roomIdValuePresent: null,
        roomIdMatches: null,
        repositoryConfig: 'unavailable',
      };
    const widgetConfiguration = await page
      .locator('iframe[title="Matrix Calendar"]')
      .evaluateAll(
        (
          iframes,
          expected,
        ): PerformanceDefaultWaitFailureSnapshot['widgetConfiguration'] => {
          const unavailable =
            (): PerformanceDefaultWaitFailureSnapshot['widgetConfiguration'] => ({
              available: false,
              gatewayBaseParameterPresent: null,
              gatewayBaseValuePresent: null,
              gatewayBaseOriginMatches: null,
              roomIdParameterPresent: null,
              roomIdValuePresent: null,
              roomIdMatches: null,
              repositoryConfig: 'unavailable',
            });
          if (iframes.length !== 1) return unavailable();

          try {
            const source = iframes[0].getAttribute('src');
            if (!source) return unavailable();
            const widgetUrl = new URL(source, window.location.href);
            const hashQueryStart = widgetUrl.hash.indexOf('?');
            const hashQuery =
              hashQueryStart >= 0
                ? widgetUrl.hash.slice(hashQueryStart + 1)
                : '';
            const searchParameters = new URLSearchParams(widgetUrl.search);
            const hashParameters = new URLSearchParams(hashQuery);
            const readParameter = (key: string) => {
              const searchValues = searchParameters.getAll(key);
              const hashValues = hashParameters.getAll(key);
              if (
                searchValues.length > 1 ||
                hashValues.length > 1 ||
                (searchValues.length > 0 && hashValues.length > 0)
              ) {
                return { unambiguous: false, present: false, value: undefined };
              }
              const values =
                searchValues.length > 0 ? searchValues : hashValues;
              return {
                unambiguous: true,
                present: values.length === 1,
                value: values[0],
              };
            };
            const gatewayBase = readParameter('meetings_bot_base_url');
            const roomId = readParameter('matrix_room_id');
            if (!gatewayBase.unambiguous || !roomId.unambiguous) {
              return unavailable();
            }

            const gatewayBaseValuePresent =
              gatewayBase.present &&
              typeof gatewayBase.value === 'string' &&
              gatewayBase.value.length > 0;
            const roomIdValuePresent =
              roomId.present &&
              typeof roomId.value === 'string' &&
              roomId.value.length > 0;
            let gatewayBaseOriginMatches: boolean | null = null;
            if (
              typeof gatewayBase.value === 'string' &&
              gatewayBase.value.length > 0
            ) {
              try {
                gatewayBaseOriginMatches =
                  new URL(gatewayBase.value).origin === expected.gatewayOrigin;
              } catch {
                gatewayBaseOriginMatches = false;
              }
            }
            const roomIdMatches = roomIdValuePresent
              ? roomId.value === expected.roomId
              : null;
            const repositoryConfig: PerformanceDefaultWaitFailureSnapshot['widgetConfiguration']['repositoryConfig'] =
              !roomIdValuePresent ||
              (gatewayBase.present && !gatewayBaseValuePresent)
                ? 'in-memory-forced'
                : gatewayBaseValuePresent
                  ? 'explicit-gateway-parameters'
                  : 'build-config-fallback-possible';

            return {
              available: true,
              gatewayBaseParameterPresent: gatewayBase.present,
              gatewayBaseValuePresent,
              gatewayBaseOriginMatches,
              roomIdParameterPresent: roomId.present,
              roomIdValuePresent,
              roomIdMatches,
              repositoryConfig,
            };
          } catch {
            return unavailable();
          }
        },
        {
          gatewayOrigin: new URL(gatewayUrl).origin,
          roomId: expectedRoomId,
        },
      )
      .catch(() => unavailableConfiguration);

    let createControl: PerformanceDefaultWaitFailureSnapshot['createControl'] =
      {
        available: false,
        count: null,
        visible: null,
        enabled: null,
      };
    try {
      const createLocator = frame.getByRole('button', {
        name: 'Create event',
        exact: true,
      });
      const count = Math.min(await createLocator.count(), 2) as 0 | 1 | 2;
      if (count === 0) {
        createControl = {
          available: true,
          count,
          visible: false,
          enabled: false,
        };
      } else if (count === 2) {
        createControl = {
          available: true,
          count,
          visible: null,
          enabled: null,
        };
      } else {
        const [visible, enabled] = await Promise.all([
          createLocator.isVisible().catch(() => null),
          createLocator.isEnabled().catch(() => null),
        ]);
        createControl = { available: true, count, visible, enabled };
      }
    } catch {
      // A failed immediate locator read is reported as unavailable.
    }

    const completedApiRows: PerformanceDefaultWaitFailureSnapshot['completedApiRows'] =
      [];
    let completedApiRowsOverflow = false;
    for (const row of observer.rowsFor(sample)) {
      if (
        row.endpoint !== 'context' &&
        row.endpoint !== 'calendars' &&
        row.endpoint !== 'events' &&
        row.endpoint !== 'openid'
      ) {
        continue;
      }
      if (completedApiRows.length === MAX_DEFAULT_WAIT_DIAGNOSTIC_COUNT) {
        completedApiRowsOverflow = true;
        continue;
      }
      completedApiRows.push({
        endpoint: row.endpoint,
        status: row.status,
        decoded: row.decoded,
      });
    }

    return {
      widgetConfiguration,
      createControl,
      completedApiRows,
      completedApiRowsOverflow,
    };
  }

  function createPerformanceApiObserver(
    page: Page,
    year: number,
    month: number,
    expectedTitles: ReadonlySet<string>,
    expectedDayTitles: ReadonlySet<string>,
    initialDate: { year: number; month: number; day: number },
  ): PerformanceApiObserver {
    const gatewayOrigin = new URL(supportContext.fixture.gatewayUrl).origin;
    const homeserverOrigin = new URL(supportContext.fixture.homeserverUrl)
      .origin;
    const pending = new Map<Request, PerformancePendingRequest>();
    const pendingBySample = new Map<PerformanceSampleKey, number>();
    const otherOriginCalendarPathCountBySample = new Map<
      PerformanceSampleKey,
      number
    >();
    const apiResponses: PerformanceApiResponse[] = [];
    let activeSample: PerformanceSampleKey = 'cold-list';
    let activeExpectedTitles = expectedTitles;

    const startRequest = (request: Request) => {
      const startedAt = performance.now();
      let requestUrl: URL;
      try {
        requestUrl = new URL(request.url());
      } catch {
        return;
      }
      const rawMethod = request.method();
      if (
        requestUrl.origin !== gatewayOrigin &&
        requestUrl.pathname.startsWith('/v1/calendar/')
      ) {
        const previousCount =
          otherOriginCalendarPathCountBySample.get(activeSample) ?? 0;
        otherOriginCalendarPathCountBySample.set(
          activeSample,
          Math.min(previousCount + 1, MAX_DEFAULT_WAIT_DIAGNOSTIC_COUNT + 1),
        );
      }
      if (rawMethod === 'OPTIONS' || rawMethod === 'HEAD') return;
      let endpoint: PerformanceEndpoint | undefined;
      if (
        requestUrl.origin === homeserverOrigin &&
        requestUrl.pathname.endsWith('/openid/request_token')
      ) {
        if (rawMethod !== 'POST') return;
        endpoint = 'openid';
      } else if (
        requestUrl.origin === gatewayOrigin &&
        requestUrl.pathname.startsWith('/v1/calendar/')
      ) {
        endpoint =
          requestUrl.pathname === '/v1/calendar/context'
            ? 'context'
            : requestUrl.pathname === '/v1/calendar/calendars'
              ? 'calendars'
              : requestUrl.pathname === '/v1/calendar/events'
                ? 'events'
                : 'other-calendar';
      }
      if (!endpoint) return;
      const method: PerformanceApiResponse['method'] =
        rawMethod === 'GET' ||
        rawMethod === 'POST' ||
        rawMethod === 'PUT' ||
        rawMethod === 'DELETE'
          ? rawMethod
          : 'OTHER';

      let target: PerformancePendingRequest['target'] = 'none';
      let calendarMatches: boolean | null = null;
      let rangeClass: PerformanceRangeClass = 'not-applicable';
      let rangeDays: number | null = null;
      let rangeMatches: boolean | null = null;
      if (endpoint === 'events') {
        const targetValue = requestUrl.searchParams.get('target');
        target =
          targetValue === 'personal' || targetValue === 'room'
            ? targetValue
            : targetValue
              ? 'other'
              : 'none';
        calendarMatches =
          target === 'room' &&
          requestUrl.searchParams.get('calendarId') ===
            supportContext.fixture.calendarId &&
          requestUrl.searchParams.get('roomId') ===
            supportContext.fixture.teamRoomId;
        const expected = performanceRangeExpectation(
          activeSample,
          year,
          month,
          initialDate,
        );
        const start = Date.parse(requestUrl.searchParams.get('start') ?? '');
        const end = Date.parse(requestUrl.searchParams.get('end') ?? '');
        if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
          rangeDays = roundPerformanceMilliseconds((end - start) / 86_400_000);
          rangeMatches = start === expected.start && end === expected.end;
        }
        rangeClass = rangeMatches ? expected.rangeClass : 'mismatch';
        if (
          activeSample === 'cold-list' &&
          !rangeMatches &&
          Number.isFinite(start) &&
          Number.isFinite(end)
        ) {
          const preselection = performancePreselectionRange(initialDate);
          if (start === preselection.start && end === preselection.end) {
            rangeClass = 'preselection';
            rangeMatches = true;
          }
        }
      }
      const metadata: PerformancePendingRequest = {
        sample: activeSample,
        endpoint,
        method,
        startedAt,
        target,
        calendarMatches,
        rangeClass,
        rangeDays,
        rangeMatches,
        expectedTitles: activeExpectedTitles,
      };
      pending.set(request, metadata);
      pendingBySample.set(
        activeSample,
        (pendingBySample.get(activeSample) ?? 0) + 1,
      );
    };

    const finishRequest = (
      request: Request,
      metadata: PerformancePendingRequest,
      status: number,
      decoded: boolean,
      body?: unknown,
    ) => {
      if (!pending.delete(request)) return;
      pendingBySample.set(
        metadata.sample,
        Math.max(0, (pendingBySample.get(metadata.sample) ?? 1) - 1),
      );
      let eventCount: number | null = null;
      let diagnosticCount: number | null = null;
      let expectedTitlesMatch: boolean | null = null;
      let calendarMatches = metadata.calendarMatches;
      if (metadata.endpoint === 'events' && decoded && isRecord(body)) {
        const resources = Array.isArray(body.events) ? body.events : undefined;
        const eventObjects = resources?.map((resource) =>
          isRecord(resource) && isRecord(resource.event)
            ? resource.event
            : undefined,
        );
        if (resources && eventObjects?.every((event) => event !== undefined)) {
          eventCount = resources.length;
          const titles = eventObjects.map((event) => event?.title);
          const expectedTitleSet =
            metadata.sample === 'overflow-day'
              ? expectedDayTitles
              : metadata.expectedTitles;
          expectedTitlesMatch =
            titles.length === expectedTitleSet.size &&
            titles.every(
              (title): title is string =>
                typeof title === 'string' && expectedTitleSet.has(title),
            ) &&
            new Set(titles).size === expectedTitleSet.size;
          calendarMatches =
            metadata.calendarMatches === true &&
            eventObjects.every(
              (event) =>
                event?.calendarId === supportContext.fixture.calendarId,
            );
        } else {
          eventCount = resources?.length ?? null;
          expectedTitlesMatch = false;
        }
        const diagnostics = Array.isArray(body.diagnostics)
          ? body.diagnostics
          : undefined;
        if (
          diagnostics?.every(
            (diagnostic) =>
              isRecord(diagnostic) &&
              Number.isInteger(diagnostic.count) &&
              (diagnostic.count as number) >= 0 &&
              (diagnostic.count as number) <= 1000,
          )
        ) {
          diagnosticCount = diagnostics.reduce(
            (total, diagnostic) =>
              total + (isRecord(diagnostic) ? (diagnostic.count as number) : 0),
            0,
          );
        }
      } else if (metadata.endpoint === 'events') {
        expectedTitlesMatch = false;
      }
      apiResponses.push({
        sample: metadata.sample,
        endpoint: metadata.endpoint,
        method: metadata.method,
        status,
        durationMs: roundPerformanceMilliseconds(
          performance.now() - metadata.startedAt,
        ),
        decoded,
        eventCount,
        diagnosticCount,
        target: metadata.target,
        calendarMatches,
        rangeClass: metadata.rangeClass,
        rangeDays: metadata.rangeDays,
        rangeMatches: metadata.rangeMatches,
        expectedTitlesMatch,
      });
    };

    page.on('request', startRequest);
    page.on('response', (response) => {
      const request = response.request();
      const metadata = pending.get(request);
      if (!metadata) return;
      void (async () => {
        let body: unknown;
        let decoded = false;
        try {
          body = await response.json();
          decoded = true;
        } catch {
          // The fixed report records only decode success and numeric status.
        }
        finishRequest(request, metadata, response.status(), decoded, body);
      })();
    });
    page.on('requestfailed', (request) => {
      const metadata = pending.get(request);
      if (metadata) finishRequest(request, metadata, 0, false);
    });

    const waitUntil = async (predicate: () => boolean) => {
      const deadline = performance.now() + 30_000;
      while (performance.now() < deadline) {
        if (predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error('Calendar API observation did not settle');
    };

    return {
      setSample: (sample, sampleExpectedTitles = expectedTitles) => {
        activeSample = sample;
        activeExpectedTitles = sampleExpectedTitles;
      },
      rows: () => [...apiResponses],
      rowsFor: (sample) => apiResponses.filter((row) => row.sample === sample),
      defaultWaitObservation: (sample, failureSnapshot) => {
        const pendingCounts: Record<PerformanceEndpoint, number> = {
          context: 0,
          calendars: 0,
          events: 0,
          openid: 0,
          'other-calendar': 0,
          'other-api': 0,
        };
        for (const metadata of pending.values()) {
          if (metadata.sample !== sample) continue;
          pendingCounts[metadata.endpoint] = Math.min(
            pendingCounts[metadata.endpoint] + 1,
            MAX_DEFAULT_WAIT_DIAGNOSTIC_COUNT + 1,
          );
        }
        return summarizeDefaultWaitObservation(
          pendingCounts,
          otherOriginCalendarPathCountBySample.get(sample) ?? 0,
          failureSnapshot,
        );
      },
      waitForRoomEvents: async (sample, expectedRangeClass) => {
        await waitUntil(() =>
          apiResponses.some(
            (row) =>
              row.sample === sample &&
              row.endpoint === 'events' &&
              row.target === 'room' &&
              row.calendarMatches === true &&
              row.rangeClass === expectedRangeClass &&
              row.rangeMatches === true,
          ),
        );
      },
      waitForSettled: async (sample) => {
        await waitUntil(() => (pendingBySample.get(sample) ?? 0) === 0);
      },
    };
  }

  return { observeDefaultWaitFailureSnapshot, createPerformanceApiObserver };
}
