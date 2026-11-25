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

import { expect, test, type Browser, type Page } from '@playwright/test';
import { performance } from 'node:perf_hooks';
import {
  extractElementBundleFrames,
  resolveElementErrorSourcePointer,
  type ElementBundleFrame,
} from '../../dev/element-acceptance-error-source-map.mjs';
import {
  advanceOrdinaryPageErrorStage,
  capturePerformancePageError,
  isVerifiedOpeningHostDiagnostic,
  safePerformancePageErrorDetails,
} from '../../dev/element-acceptance-performance-evidence.mjs';
import {
  measureStableDom,
  readHorizontalOverflow,
  readStableList,
  readStableRowCount,
} from './elementAcceptanceMeasurements';
import type {
  OrdinaryPerformanceCase,
  OrdinaryPerformanceProfile,
  PerformanceActionSample,
  PerformanceApiObserver,
  PerformanceDetailsSample,
  PerformanceJourneyContext,
  PerformancePageErrorObservation,
  PerformancePageErrorStage,
  PerformanceSampleKey,
} from './elementAcceptanceSupport';
import { fillDatePicker } from './pages/helper';

export async function runElementPerformanceAcceptanceJourney(
  browser: Browser,
  journey: PerformanceJourneyContext,
): Promise<void> {
  const {
    readFixture,
    localCalendarDate,
    makeEmptyOrdinaryPerformanceReport,
    recordPerformancePilot,
    makePerformanceTitles,
    capturePrivatePerformancePageError,
    MAX_ELEMENT_ERROR_SOURCE_MAP_OBSERVATIONS,
    authenticateInElement,
    elapsedMilliseconds,
    openMemberARoomWithDiagnostics,
    record,
    recordMemberARoomObservation,
    requireMemberARoom,
    createPerformanceApiObserver,
    openCalendarWidget,
    observeDefaultWaitFailureSnapshot,
    shiftCalendarDate,
    ELEMENT_ERROR_SOURCE_MAP_MAX_BYTES,
    MAX_ELEMENT_ERROR_SOURCE_MAP_LOOKUPS,
    readCappedElementErrorSourceMap,
    recordRuntimeVersions,
    runOrdinaryPerformanceSeed,
  } = journey;
  test.setTimeout(360_000);
  journey.fixture = readFixture();
  const runId = process.env.GITHUB_RUN_ID ?? '';
  const attempt = process.env.GITHUB_RUN_ATTEMPT ?? '';
  const initialDate = localCalendarDate(new Date());
  const report = makeEmptyOrdinaryPerformanceReport(initialDate);
  recordPerformancePilot('started', report);
  const allowedOrigins = new Set([
    new URL(journey.fixture.elementUrl).origin,
    new URL(journey.fixture.homeserverUrl).origin,
    'http://localhost:8008',
    new URL(journey.fixture.gatewayUrl).origin,
    new URL(journey.fixture.widgetUrl).origin,
  ]);
  let roomContextRecorded = false;
  let failureCode:
    | 'performance-setup-failed'
    | 'performance-widget-open-failed'
    | 'performance-host-layout-failed'
    | 'performance-default-view-failed'
    | 'performance-view-sample-failed'
    | 'performance-details-failed'
    | 'performance-egress-blocked'
    | 'performance-page-error'
    | 'performance-threshold-exceeded' = 'performance-setup-failed';

  const runCase = async (caseReport: OrdinaryPerformanceCase) => {
    const expectedTitles = makePerformanceTitles(
      runId,
      attempt,
      caseReport.eventCount,
    );
    const expectedTitleSet = new Set(expectedTitles);
    const context = await browser.newContext({
      locale: 'en-US',
      timezoneId: 'Europe/Stockholm',
      viewport: { width: 1280, height: 800 },
    });
    let page: Page | undefined;
    let observer: PerformanceApiObserver | undefined;
    let pageErrorStage: PerformancePageErrorStage = 'case-setup';
    let privatePageErrorCaptureCount = 0;
    const pageErrorSourceProfiles = new Set<OrdinaryPerformanceProfile>();
    const pageErrorSourceLookups: Array<{
      page: Page;
      frames: ElementBundleFrame[];
      observation: PerformancePageErrorObservation;
    }> = [];
    context.on('page', (openedPage) => {
      openedPage.on('pageerror', (error) => {
        if (privatePageErrorCaptureCount < 8) {
          capturePrivatePerformancePageError(
            error,
            caseReport.profile,
            pageErrorStage,
          );
          privatePageErrorCaptureCount += 1;
        }
        const capturedObservation = capturePerformancePageError(
          report,
          error,
          caseReport.profile,
          () => pageErrorStage,
          {
            elementUrl: journey.fixture.elementUrl,
            widgetUrl: journey.fixture.widgetUrl,
          },
        );
        if (!capturedObservation) {
          return;
        }
        const observation = Object.assign(
          capturedObservation,
          safePerformancePageErrorDetails(error),
        );
        const frames =
          observation.errorSource === 'element' &&
          pageErrorStage === 'widget-open'
            ? extractElementBundleFrames(error, journey.fixture.elementUrl)
            : [];
        const shouldResolveSource =
          frames.length > 0 &&
          pageErrorSourceLookups.length <
            MAX_ELEMENT_ERROR_SOURCE_MAP_OBSERVATIONS &&
          !pageErrorSourceProfiles.has(caseReport.profile);
        observation.sourceMapStatus =
          frames.length === 0
            ? 'not-eligible'
            : shouldResolveSource
              ? 'unavailable'
              : 'not-attempted';
        if (frames.length > 0 && shouldResolveSource) {
          pageErrorSourceProfiles.add(caseReport.profile);
          pageErrorSourceLookups.push({
            page: openedPage,
            frames,
            observation,
          });
        }
      });
    });

    try {
      await context.route('**/*', async (route) => {
        let requestOrigin: string;
        try {
          requestOrigin = new URL(route.request().url()).origin;
        } catch {
          report.blockedRequestCount = Math.min(
            (report.blockedRequestCount ?? 0) + 1,
            100_000,
          );
          await route.abort('blockedbyclient');
          return;
        }
        if (!allowedOrigins.has(requestOrigin)) {
          report.blockedRequestCount = Math.min(
            (report.blockedRequestCount ?? 0) + 1,
            100_000,
          );
          await route.abort('blockedbyclient');
          return;
        }
        await route.continue();
      });

      const loginStartedAt = performance.now();
      pageErrorStage = 'element-login';
      page = await authenticateInElement(
        context,
        journey.fixture.users.memberA,
      );
      caseReport.preparation.elementLoginMs =
        elapsedMilliseconds(loginStartedAt);

      pageErrorStage = 'room-navigation';
      journey.activePhase = 'member-a-room-navigation';
      const roomStartedAt = performance.now();
      const roomResult = await openMemberARoomWithDiagnostics(
        page,
        journey.fixture.roomName,
        journey.fixture.teamRoomId,
        journey.fixture.users.memberA.userId,
        { useNormalRoomSelection: true },
      );
      caseReport.preparation.roomNavigationMs =
        elapsedMilliseconds(roomStartedAt);
      if (!roomContextRecorded) {
        record(
          journey.activePhase,
          roomResult.navigationCompleted ? 'passed' : 'failed',
        );
        recordMemberARoomObservation(roomResult);
        roomContextRecorded = true;
      }
      const element = requireMemberARoom(roomResult);

      const apiObserver = createPerformanceApiObserver(
        page,
        caseReport.year,
        caseReport.month,
        expectedTitleSet,
        new Set(),
        initialDate,
      );
      observer = apiObserver;
      const defaultSample = `${caseReport.profile}-default` as const;
      observer.setSample(defaultSample);
      const coldStartedAt = performance.now();
      pageErrorStage = 'widget-open';
      failureCode = 'performance-widget-open-failed';
      const frame = await openCalendarWidget(element, page, {
        expectWidgetWarning: false,
        onTiming: (phase, durationMs) => {
          switch (phase) {
            case 'activation':
              caseReport.coldList.activationMs = durationMs;
              break;
            case 'capability-approval':
              caseReport.coldList.capabilityApprovalMs = durationMs;
              break;
            case 'identity-approval':
              caseReport.coldList.identityApprovalMs = durationMs;
              break;
            case 'iframe-ready':
              caseReport.coldList.iframeReadyMs = durationMs;
              break;
            case 'widget-startup':
              caseReport.coldList.widgetStartupMs = durationMs;
              break;
          }
        },
      });

      failureCode = 'performance-default-view-failed';
      try {
        await observer.waitForRoomEvents(defaultSample, 'preselection');
      } catch {
        const failureSnapshot = await observeDefaultWaitFailureSnapshot(
          page,
          frame,
          journey.fixture.gatewayUrl,
          journey.fixture.teamRoomId,
          observer,
          defaultSample,
        ).catch(() => undefined);
        caseReport.defaultWaitObservation = observer.defaultWaitObservation(
          defaultSample,
          failureSnapshot,
        );
        throw new Error('Default calendar response was not observed');
      }
      failureCode = 'performance-view-sample-failed';
      const defaultMeasurement = await readStableRowCount(
        frame,
        expectedTitles,
      );
      const readinessEventRows = observer
        .rowsFor(defaultSample)
        .filter((row) => row.endpoint === 'events');
      const readinessRoomRows = readinessEventRows.filter(
        (row) =>
          row.target === 'room' &&
          row.calendarMatches === true &&
          row.rangeClass === 'preselection' &&
          row.rangeMatches === true,
      );
      const readinessRoomRow = readinessRoomRows[0];
      const createEventControl = frame.getByRole('button', {
        name: 'Create event',
        exact: true,
      });
      const [defaultUsableControl, defaultUsableControlEnabled] =
        await Promise.all([
          createEventControl.isVisible().catch(() => false),
          createEventControl.isEnabled().catch(() => false),
        ]);
      pageErrorStage = advanceOrdinaryPageErrorStage(pageErrorStage, {
        responseDecoded:
          readinessRoomRow?.status === 200 && readinessRoomRow.decoded,
        responseMatches: readinessRoomRows.length === 1,
        returnedRowsExact:
          readinessRoomRow?.eventCount === caseReport.eventCount &&
          readinessRoomRow.expectedTitlesMatch === true,
        renderedRowsExact:
          defaultMeasurement.second.renderedCount === caseReport.eventCount &&
          defaultMeasurement.second.identitiesMatch,
        controlsUsable: defaultUsableControl && defaultUsableControlEnabled,
        stable: defaultMeasurement.stable,
      });
      await observer.waitForSettled(defaultSample);
      const defaultEventRows = observer
        .rowsFor(defaultSample)
        .filter((row) => row.endpoint === 'events');
      const defaultRoomRows = defaultEventRows.filter(
        (row) =>
          row.target === 'room' &&
          row.calendarMatches === true &&
          row.rangeClass === 'preselection' &&
          row.rangeMatches === true,
      );
      const defaultReturnedCount =
        defaultRoomRows.length === 1 ? defaultRoomRows[0].eventCount : null;
      caseReport.defaultView = {
        durationMs: elapsedMilliseconds(coldStartedAt),
        apiResponseCount: defaultEventRows.length,
        apiRangeMaxMs: defaultEventRows.length
          ? Math.max(...defaultEventRows.map((row) => row.durationMs))
          : null,
        returnedCount: defaultReturnedCount,
        renderedCount: defaultMeasurement.second.renderedCount,
        rangeMatches: defaultRoomRows.length === 1,
        countMatches:
          defaultReturnedCount !== null &&
          defaultReturnedCount === defaultMeasurement.second.renderedCount,
        usableControlVisible: defaultUsableControl,
        stable: defaultMeasurement.stable,
      };
      const openIdRows = observer
        .rowsFor(defaultSample)
        .filter((row) => row.endpoint === 'openid');
      caseReport.coldList.durationMs = caseReport.defaultView.durationMs;
      caseReport.coldList.openIdResponseCount = openIdRows.length;
      caseReport.coldList.openIdMaxMs = openIdRows.length
        ? Math.max(...openIdRows.map((row) => row.durationMs))
        : null;
      caseReport.coldList.apiRangeMaxMs = caseReport.defaultView.apiRangeMaxMs;
      caseReport.coldList.selectedRoomResponseCount = defaultRoomRows.length;
      caseReport.coldList.returnedCount = defaultReturnedCount;
      caseReport.coldList.renderedCount =
        defaultMeasurement.second.renderedCount;
      caseReport.coldList.expectedRangeMatches = defaultRoomRows.length === 1;
      caseReport.coldList.identitiesMatch =
        defaultRoomRows.length === 1 &&
        defaultRoomRows[0].expectedTitlesMatch === true &&
        defaultMeasurement.second.identitiesMatch;
      caseReport.coldList.diagnosticsZero =
        defaultEventRows.length > 0 &&
        defaultEventRows.every((row) => row.diagnosticCount === 0);
      caseReport.coldList.stable = defaultMeasurement.stable;
      caseReport.coldList.horizontalOverflow =
        defaultMeasurement.second.horizontalOverflow;
      expect(caseReport.defaultView.durationMs).not.toBeNull();
      expect(caseReport.defaultView.durationMs).toBeLessThanOrEqual(2000);
      expect(caseReport.defaultView.apiResponseCount).toBeGreaterThan(0);
      expect(caseReport.defaultView.apiRangeMaxMs).not.toBeNull();
      expect(caseReport.defaultView.apiRangeMaxMs).toBeLessThanOrEqual(1000);
      expect(caseReport.defaultView.returnedCount).toBe(caseReport.eventCount);
      expect(caseReport.defaultView.renderedCount).toBe(caseReport.eventCount);
      expect(caseReport.defaultView.rangeMatches).toBe(true);
      expect(caseReport.defaultView.countMatches).toBe(true);
      expect(caseReport.defaultView.usableControlVisible).toBe(true);
      expect(defaultUsableControlEnabled).toBe(true);
      expect(caseReport.defaultView.stable).toBe(true);
      expect(caseReport.coldList.identitiesMatch).toBe(true);
      expect(caseReport.coldList.diagnosticsZero).toBe(true);
      expect(caseReport.coldList.horizontalOverflow).toBe(false);

      failureCode = 'performance-host-layout-failed';
      const widgetCard = page.locator('.mx_WidgetCard');
      caseReport.coldList.widgetCardCount = Math.min(
        await widgetCard.count(),
        2,
      );
      caseReport.coldList.widgetCardVisible =
        caseReport.coldList.widgetCardCount === 1 &&
        (await widgetCard.isVisible().catch(() => false));
      const appDrawer = page.locator('.mx_AppsDrawer');
      caseReport.coldList.appDrawerCount = Math.min(await appDrawer.count(), 2);
      caseReport.coldList.placement = caseReport.coldList.widgetCardVisible
        ? 'widget-card'
        : caseReport.coldList.appDrawerCount > 0
          ? 'apps-drawer'
          : 'unknown';
      const hostIframe = page.locator(
        '#mx_PersistedElement_container iframe[title="Matrix Calendar"]',
      );
      await hostIframe
        .first()
        .waitFor({ state: 'attached', timeout: 30_000 })
        .catch(() => {});
      caseReport.coldList.persistedHostFrameCount = Math.min(
        await hostIframe.count(),
        2,
      );
      caseReport.coldList.persistedHostFrameVisible =
        caseReport.coldList.persistedHostFrameCount === 1 &&
        (await hostIframe
          .first()
          .isVisible()
          .catch(() => false));
      expect(caseReport.coldList.widgetCardCount).toBe(1);
      expect(caseReport.coldList.widgetCardVisible).toBe(true);
      expect(caseReport.coldList.placement).toBe('widget-card');
      expect(caseReport.coldList.persistedHostFrameCount).toBe(1);
      expect(caseReport.coldList.persistedHostFrameVisible).toBe(true);

      failureCode = 'performance-threshold-exceeded';
      expect(caseReport.coldList.durationMs).toBeLessThanOrEqual(2000);
      expect(caseReport.coldList.apiRangeMaxMs).toBeLessThanOrEqual(1000);
      expect(caseReport.coldList.openIdResponseCount).toBeGreaterThan(0);
      expect(caseReport.coldList.selectedRoomResponseCount).toBe(1);
      expect(caseReport.coldList.returnedCount).toBe(caseReport.eventCount);
      expect(caseReport.coldList.renderedCount).toBe(caseReport.eventCount);
      expect(caseReport.coldList.expectedRangeMatches).toBe(true);
      expect(caseReport.coldList.identitiesMatch).toBe(true);
      expect(caseReport.coldList.diagnosticsZero).toBe(true);
      expect(caseReport.coldList.stable).toBe(true);
      expect(caseReport.coldList.horizontalOverflow).toBe(false);
      const body = frame.locator('body');

      pageErrorStage = 'cold-layout';
      failureCode = 'performance-host-layout-failed';
      const frameDimensions = await hostIframe.evaluate((iframe) => {
        const rect = iframe.getBoundingClientRect();
        return {
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      });
      caseReport.coldList.iframeWidth = frameDimensions.width;
      caseReport.coldList.iframeHeight = frameDimensions.height;
      caseReport.coldList.hostHorizontalOverflow = await page.evaluate(() => {
        const root = document.documentElement;
        const hostBody = document.body;
        return (
          Math.max(root.scrollWidth, hostBody.scrollWidth) > root.clientWidth
        );
      });
      expect(caseReport.coldList.iframeWidth).toBeGreaterThan(0);
      expect(caseReport.coldList.iframeHeight).toBeGreaterThan(0);
      expect(caseReport.coldList.hostHorizontalOverflow).toBe(false);

      failureCode = 'performance-threshold-exceeded';
      expect(caseReport.coldList.durationMs).toBeLessThanOrEqual(2000);
      expect(caseReport.coldList.apiRangeMaxMs).toBeLessThanOrEqual(1000);
      expect(caseReport.coldList.openIdResponseCount).toBeGreaterThan(0);
      expect(caseReport.coldList.selectedRoomResponseCount).toBe(1);
      expect(caseReport.coldList.returnedCount).toBe(caseReport.eventCount);
      expect(caseReport.coldList.renderedCount).toBe(caseReport.eventCount);
      expect(caseReport.coldList.expectedRangeMatches).toBe(true);
      expect(caseReport.coldList.identitiesMatch).toBe(true);
      expect(caseReport.coldList.diagnosticsZero).toBe(true);
      expect(caseReport.coldList.stable).toBe(true);
      expect(caseReport.coldList.horizontalOverflow).toBe(false);

      const summarizeAction = (
        sample: PerformanceSampleKey,
        rangeClass: 'preselection' | 'preselection-next',
        measurement: {
          second: {
            renderedCount: number | null;
            identitiesMatch: boolean;
            horizontalOverflow: boolean;
          };
          stable: boolean;
        },
        durationMs: number,
      ): PerformanceActionSample => {
        const eventRows = apiObserver
          .rowsFor(sample)
          .filter((row) => row.endpoint === 'events');
        const matchingRoomRows = eventRows.filter(
          (row) =>
            row.target === 'room' &&
            row.calendarMatches === true &&
            row.rangeClass === rangeClass &&
            row.rangeMatches === true,
        );
        return {
          durationMs,
          apiResponseCount: eventRows.length,
          apiRangeMaxMs: eventRows.length
            ? Math.max(...eventRows.map((row) => row.durationMs))
            : null,
          roomResponseCount: matchingRoomRows.length,
          returnedCount:
            matchingRoomRows.length === 1
              ? matchingRoomRows[0].eventCount
              : null,
          renderedCount: measurement.second.renderedCount,
          rangeMatches: matchingRoomRows.length === 1,
          identitiesMatch:
            matchingRoomRows.length === 1 &&
            matchingRoomRows[0].expectedTitlesMatch === true &&
            measurement.second.identitiesMatch,
          diagnosticsZero:
            eventRows.length > 0 &&
            eventRows.every((row) => row.diagnosticCount === 0),
          stable: measurement.stable,
          horizontalOverflow: measurement.second.horizontalOverflow,
        };
      };

      pageErrorStage = 'refresh-setup';
      failureCode = 'performance-view-sample-failed';
      const setupSample = `${caseReport.profile}-refresh-setup` as const;
      observer.setSample(setupSample, new Set());
      const setupStartedAt = performance.now();
      const setupStartDate = shiftCalendarDate(
        initialDate.year,
        initialDate.month,
        initialDate.day,
        7,
      );
      const setupEndDate = shiftCalendarDate(
        setupStartDate.year,
        setupStartDate.month,
        setupStartDate.day,
        6,
      );
      await fillDatePicker(
        frame,
        frame.getByRole('button', {
          name: /Choose date range, selected/u,
        }),
        [setupStartDate.year, setupStartDate.month, setupStartDate.day],
        [setupEndDate.year, setupEndDate.month, setupEndDate.day],
      );
      await observer.waitForRoomEvents(setupSample, 'preselection-next');
      const setupMeasurement = await readStableList(frame, []);
      await observer.waitForSettled(setupSample);
      caseReport.refreshSetup = summarizeAction(
        setupSample,
        'preselection-next',
        setupMeasurement,
        elapsedMilliseconds(setupStartedAt),
      );
      expect(caseReport.refreshSetup.apiResponseCount).toBeGreaterThan(0);
      expect(caseReport.refreshSetup.apiRangeMaxMs).toBeLessThanOrEqual(1000);
      expect(caseReport.refreshSetup.roomResponseCount).toBe(1);
      expect(caseReport.refreshSetup.returnedCount).toBe(0);
      expect(caseReport.refreshSetup.renderedCount).toBe(0);
      expect(caseReport.refreshSetup.rangeMatches).toBe(true);
      expect(caseReport.refreshSetup.identitiesMatch).toBe(true);
      expect(caseReport.refreshSetup.diagnosticsZero).toBe(true);
      expect(caseReport.refreshSetup.stable).toBe(true);

      const refreshSample = `${caseReport.profile}-refresh` as const;
      pageErrorStage = 'refresh';
      observer.setSample(refreshSample);
      const refreshStartedAt = performance.now();
      const originalEndDate = shiftCalendarDate(
        initialDate.year,
        initialDate.month,
        initialDate.day,
        6,
      );
      await fillDatePicker(
        frame,
        frame.getByRole('button', {
          name: /Choose date range, selected/u,
        }),
        [initialDate.year, initialDate.month, initialDate.day],
        [originalEndDate.year, originalEndDate.month, originalEndDate.day],
      );
      await observer.waitForRoomEvents(refreshSample, 'preselection');
      const refreshMeasurement = await readStableList(frame, expectedTitles);
      await observer.waitForSettled(refreshSample);
      caseReport.refresh = summarizeAction(
        refreshSample,
        'preselection',
        refreshMeasurement,
        elapsedMilliseconds(refreshStartedAt),
      );
      failureCode = 'performance-threshold-exceeded';
      expect(caseReport.refresh.durationMs).toBeLessThanOrEqual(2000);
      expect(caseReport.refresh.apiRangeMaxMs).toBeLessThanOrEqual(1000);
      expect(caseReport.refresh.roomResponseCount).toBe(1);
      expect(caseReport.refresh.returnedCount).toBe(caseReport.eventCount);
      expect(caseReport.refresh.renderedCount).toBe(caseReport.eventCount);
      expect(caseReport.refresh.rangeMatches).toBe(true);
      expect(caseReport.refresh.identitiesMatch).toBe(true);
      expect(caseReport.refresh.diagnosticsZero).toBe(true);
      expect(caseReport.refresh.stable).toBe(true);
      expect(caseReport.refresh.horizontalOverflow).toBe(false);

      if (caseReport.profile === 'events-25') {
        pageErrorStage = 'details';
        for (const index of [1, 2, 3, 4, 5] as const) {
          failureCode = 'performance-details-failed';
          const sample = `events-25-details-${index}` as const;
          observer.setSample(sample);
          const details: PerformanceDetailsSample = {
            index,
            durationMs: null,
            visible: false,
            titleMatches: false,
            stable: false,
            horizontalOverflow: null,
          };
          caseReport.detailSamples.push(details);
          const detailStartedAt = performance.now();
          const selectedTitle = expectedTitles[index - 1];
          const row = frame.getByRole('listitem', { name: selectedTitle });
          await row.click();
          const dialog = frame.getByRole('dialog').last();
          await expect(dialog).toBeVisible();
          const title = dialog.getByText(selectedTitle, { exact: true });
          await expect(title).toBeVisible();
          await observer.waitForSettled(sample);
          const detailsMeasurement = await measureStableDom(body, async () => ({
            visible: await dialog.isVisible().catch(() => false),
            titleMatches: await title.isVisible().catch(() => false),
            horizontalOverflow: await readHorizontalOverflow(body),
          }));
          details.durationMs = elapsedMilliseconds(detailStartedAt);
          details.visible = detailsMeasurement.second.visible;
          details.titleMatches = detailsMeasurement.second.titleMatches;
          details.stable = detailsMeasurement.stable;
          details.horizontalOverflow =
            detailsMeasurement.second.horizontalOverflow;
          failureCode = 'performance-threshold-exceeded';
          expect(details.durationMs).toBeLessThanOrEqual(500);
          expect(details.visible).toBe(true);
          expect(details.titleMatches).toBe(true);
          expect(details.stable).toBe(true);
          expect(details.horizontalOverflow).toBe(false);
          await dialog
            .getByRole('button', { name: 'Close', exact: true })
            .click();
          await expect(dialog).toBeHidden();
        }
      }

      for (const response of observer.rows()) {
        expect(response.status).toBe(200);
        expect(response.decoded).toBe(true);
        expect(response.method).toBe(
          response.endpoint === 'openid' ? 'POST' : 'GET',
        );
        if (response.endpoint !== 'openid') {
          expect(response.durationMs).toBeLessThanOrEqual(1000);
        }
        if (response.endpoint === 'events') {
          expect(response.diagnosticCount).toBe(0);
        }
      }
    } finally {
      pageErrorStage = 'case-cleanup';
      if (observer) report.apiResponses.push(...observer.rows());
      for (const lookup of pageErrorSourceLookups) {
        let remainingBytes = ELEMENT_ERROR_SOURCE_MAP_MAX_BYTES;
        const sourceMaps: Array<{
          bundleUrl: string;
          sourceMapText: string | null;
        }> = [];
        const seenBundles = new Set<string>();
        for (const frame of lookup.frames) {
          if (
            seenBundles.has(frame.bundleUrl) ||
            sourceMaps.length >= MAX_ELEMENT_ERROR_SOURCE_MAP_LOOKUPS ||
            remainingBytes <= 0
          ) {
            continue;
          }
          seenBundles.add(frame.bundleUrl);
          try {
            const result = await readCappedElementErrorSourceMap(
              lookup.page,
              frame,
              new URL(journey.fixture.elementUrl).origin,
              remainingBytes,
            );
            sourceMaps.push({
              bundleUrl: frame.bundleUrl,
              sourceMapText: result.text,
            });
            remainingBytes = Math.max(0, remainingBytes - result.bytesRead);
            if (result.limitReached) remainingBytes = 0;
          } catch {
            sourceMaps.push({
              bundleUrl: frame.bundleUrl,
              sourceMapText: null,
            });
          }
        }
        Object.assign(
          lookup.observation,
          resolveElementErrorSourcePointer(lookup.frames, sourceMaps),
        );
      }
      await context.close();
    }
  };

  try {
    recordRuntimeVersions(browser.version());
    await runCase(report.cases[0]);
    failureCode = 'performance-setup-failed';
    runOrdinaryPerformanceSeed(initialDate);
    failureCode = 'performance-setup-failed';
    await runCase(report.cases[1]);
    failureCode = 'performance-egress-blocked';
    expect(report.blockedRequestCount).toBe(0);
    failureCode = 'performance-page-error';
    expect(report.pageErrorObservationOverflow).toBe(false);
    expect(report.pageErrorObservations.length).toBe(report.pageErrorCount);
    expect(
      report.pageErrorObservations.every(isVerifiedOpeningHostDiagnostic),
    ).toBe(true);
    expect(report.pageErrorClass).toBe(
      report.pageErrorCount === 0
        ? 'none'
        : report.pageErrorObservations[0]?.errorClass,
    );
    recordPerformancePilot('passed', report);
  } catch {
    recordPerformancePilot('failed', report, failureCode);
    throw new Error('Element ordinary performance profile failed');
  }
}
