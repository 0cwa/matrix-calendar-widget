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

import {
  type Browser,
  type BrowserContext,
  type FrameLocator,
  type Locator,
  type Page,
  type Request,
  type Response,
} from '@playwright/test';
import { isRecord } from './elementAcceptanceShared';

import { spawnSync } from 'node:child_process';

import {
  appendFileSync,
  mkdirSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';

import { arch, platform, release, tmpdir } from 'node:os';

import { dirname, isAbsolute, resolve, sep } from 'node:path';

import {
  readElementErrorSourceMapInPage,
  type ElementBundleFrame,
} from '../../dev/element-acceptance-error-source-map.mjs';

import {
  compareEventTimingWithRoomRange,
  readCreatedEventTiming,
  type CreatedEventTiming,
} from '../../dev/element-acceptance-event-observation.mjs';

import { g6GatewayResourceIdentityMatches } from '../../dev/element-g6-resource-ownership.mjs';

import {
  buildReminderFlowDiagnosticRecord,
  completeReminderFlowDiagnosticStage,
  enterReminderFlowDiagnosticStage,
  failReminderFlowDiagnostic,
  type ReminderFlowDiagnosticRecord,
  type ReminderFlowDiagnosticStage,
  type ReminderFlowDiagnosticState,
  type ReminderFlowTestStatus,
} from '../../dev/element-reminder-flow-diagnostics.mjs';

import { createMemberRoomContextRecord } from '../../dev/element-room-context-observation.mjs';

import type {
  Fixture,
  G6StageRecord,
  MatrixSyncState,
  MemberARoomResult,
  MemberRoomContextPhase,
} from './elementAcceptanceTypes';

import {
  acceptancePrincipal,
  runElementG6AcceptanceJourney,
} from './elementG6AcceptanceJourney';

import {
  type AcceptanceRuntimeObservation,
  type BlockedRequestDiagnostic,
  type CalDavReportProbeResult,
  type ExpectedRoomRange,
  type HomeserverHttpFailures,
  type OrdinaryPerformanceProfile,
  type PerformancePageErrorStage,
  type PerformanceReportData,
  type Phase,
  type PinnedControlObservation,
  type PostCreateVisibilityObservation,
  type PublicFeedBrowserObservation,
  type ReminderAlarmUiObservation,
  type ReminderConfigurationObservation,
  type ReminderWidgetContextResponseObserver,
  type ReminderWidgetContextResponseSnapshot,
} from './elementAcceptanceSupportTypes';

import {
  elapsedMilliseconds,
  localCalendarDate,
  makeEmptyOrdinaryPerformanceReport,
  makePerformanceTitles,
  runOrdinaryPerformanceSeed,
  shiftCalendarDate,
} from './elementAcceptancePerformanceHelpers';

import {
  emptyProjectionDiagnosticCounts,
  isCalDavProjectionObservation,
  isOptionalHttpStatus,
  summarizeProjectionDiagnostics,
  unavailableTimezoneAudit,
} from './elementAcceptanceProjectionHelpers';

import { reminderPlanForMarkerIndex } from './elementAcceptanceReminderHelpers';

import { createAcceptanceRuntimeHelpers } from './elementAcceptanceRuntimeObserver';

import { createPublicFeedAcceptanceHelpers } from './elementAcceptancePublicFeedHelpers';

import { createPerformanceObservationHelpers } from './elementAcceptancePerformanceObserver';

import { createReminderAcceptanceHelpers } from './elementAcceptanceReminderFlowHelpers';

import { createElementWidgetHelpers } from './elementAcceptanceWidgetHelpers';

import { createElementNavigationHelpers } from './elementAcceptanceNavigationHelpers';

import { createFixtureAcceptanceHelpers } from './elementAcceptanceFixtureHelpers';

import { createPrivateAcceptanceHelpers } from './elementAcceptancePrivateHelpers';

export function createElementAcceptanceSupport() {
  const ELEMENT_WEB_CONFIGURED_TAG = 'v1.12.30';

  const PRIVATE_ACCEPTANCE_GATEWAY_ORIGIN = 'https://127.0.0.1:3001';

  const supportContext = {
    fixture: undefined as unknown as Fixture,
    activePhase: 'member-a-authenticated' as Phase,
    activeReminderFailureRecorded: false,
    activeReminderFlowDiagnostic: undefined as
      | ReminderFlowDiagnosticState
      | undefined,
    pendingPinnedControlObservation: undefined as
      | PinnedControlObservation
      | undefined,
    memberRoomHomeserverHttpFailures: new WeakMap<
      Page,
      HomeserverHttpFailures
    >(),
    blockedExternalRequestsByContext: new WeakMap<
      BrowserContext,
      { count: number }
    >(),
    memberABlockedExternalRequests: new WeakMap<Page, { count: number }>(),
  };

  const { observeDefaultWaitFailureSnapshot, createPerformanceApiObserver } =
    createPerformanceObservationHelpers(supportContext);

  function createFunctionalJourneyContext() {
    return {
      get fixture() {
        return supportContext.fixture;
      },
      set fixture(value: Fixture) {
        supportContext.fixture = value;
      },
      get activePhase() {
        return supportContext.activePhase;
      },
      set activePhase(value: Phase) {
        supportContext.activePhase = value;
      },
      readFixture,
      blockedExternalRequestsByContext:
        supportContext.blockedExternalRequestsByContext,
      recordBlockedRequest,
      safeBlockedRequestResourceType,
      classifyBlockedRequest,
      recordRuntimeVersions,
      authenticateInElement,
      observeAcceptanceRuntime,
      record,
      openMemberARoomWithDiagnostics,
      recordMemberARoomObservation,
      requireMemberARoom,
      waitForGatewayResponse,
      openCalendarWidget,
      recordWidgetRuntimeObservation,
      observePostCreateVisibility,
      appendPostCreateVisibilityObservation,
      openFixtureRoom,
      openEventEditor,
      requestRoomEventsStatus,
      recordBlockedRequestFailure,
      recordJourneyFailure,
    };
  }

  const ELEMENT_ERROR_SOURCE_MAP_MAX_BYTES = 64 * 1024 * 1024;

  const ELEMENT_ERROR_SOURCE_MAP_TIMEOUT_MS = 2500;

  const MAX_ELEMENT_ERROR_SOURCE_MAP_OBSERVATIONS = 2;

  const MAX_ELEMENT_ERROR_SOURCE_MAP_LOOKUPS = 4;

  async function readCappedElementErrorSourceMap(
    page: Page,
    frame: ElementBundleFrame,
    expectedElementOrigin: string,
    maxBytes: number,
  ): Promise<{
    text: string | null;
    bytesRead: number;
    limitReached: boolean;
  }> {
    if (
      page.isClosed() ||
      !Number.isSafeInteger(maxBytes) ||
      maxBytes < 1 ||
      maxBytes > ELEMENT_ERROR_SOURCE_MAP_MAX_BYTES
    ) {
      return { text: null, bytesRead: 0, limitReached: false };
    }
    try {
      const result = await page.evaluate(readElementErrorSourceMapInPage, {
        bundleUrl: frame.bundleUrl,
        expectedOrigin: expectedElementOrigin,
        maxBytes,
        timeoutMs: ELEMENT_ERROR_SOURCE_MAP_TIMEOUT_MS,
      });
      return result !== null &&
        typeof result === 'object' &&
        typeof result.bytesRead === 'number' &&
        Number.isSafeInteger(result.bytesRead) &&
        result.bytesRead >= 0 &&
        result.bytesRead <= maxBytes &&
        typeof result.limitReached === 'boolean' &&
        (result.text === null ||
          (typeof result.text === 'string' &&
            Buffer.byteLength(result.text, 'utf8') === result.bytesRead))
        ? result
        : { text: null, bytesRead: maxBytes, limitReached: true };
    } catch {
      return { text: null, bytesRead: 0, limitReached: false };
    }
  }

  function createPerformanceJourneyContext() {
    return {
      get fixture() {
        return supportContext.fixture;
      },
      set fixture(value: Fixture) {
        supportContext.fixture = value;
      },
      get activePhase() {
        return supportContext.activePhase;
      },
      set activePhase(value: Phase) {
        supportContext.activePhase = value;
      },
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
    };
  }

  function createReminderJourneyContext() {
    return {
      get fixture() {
        return supportContext.fixture;
      },
      set fixture(value: Fixture) {
        supportContext.fixture = value;
      },
      get activePhase() {
        return supportContext.activePhase;
      },
      set activePhase(value: Phase) {
        supportContext.activePhase = value;
      },
      get activeReminderFlowDiagnostic() {
        return supportContext.activeReminderFlowDiagnostic;
      },
      set activeReminderFlowDiagnostic(
        value: ReminderFlowDiagnosticState | undefined,
      ) {
        supportContext.activeReminderFlowDiagnostic = value;
      },
      get activeReminderFailureRecorded() {
        return supportContext.activeReminderFailureRecorded;
      },
      set activeReminderFailureRecorded(value: boolean) {
        supportContext.activeReminderFailureRecorded = value;
      },
      readReminderFlow,
      enterActiveReminderFlowStage,
      readFixture,
      readReminderEventTitles,
      completeActiveReminderFlowStage,
      failActiveReminderFlow,
      record,
      authenticateInElement,
      observeReminderWidgetContextResponse,
      openMemberARoomWithDiagnostics,
      recordMemberARoomObservation,
      requireMemberARoom,
      openCalendarWidget,
      inspectReminderTimeline,
      readBackReminderMarkers,
      captureReminderFlowReadbackError,
      reminderPlanForMarkerIndex,
      createAndConfigureReminder,
      verifyPublicFeedBrowserLifecycle,
      waitForReminderDelivery,
    };
  }

  const {
    readReminderFlow,
    readReminderEventTitles,
    createAndConfigureReminder,
    readBackReminderMarkers,
    inspectReminderTimeline,
    waitForReminderDelivery,
  } = createReminderAcceptanceHelpers(
    supportContext,
    record,
    waitForGatewayResponse,
  );

  const { verifyPublicFeedBrowserLifecycle } =
    createPublicFeedAcceptanceHelpers(supportContext, record);

  const {
    readFixture,
    recordBlockedRequestFailure,
    safeBlockedRequestResourceType,
    classifyBlockedRequest,
    recordBlockedRequest,
  } = createFixtureAcceptanceHelpers(record);

  const {
    authenticateInElement,
    openFixtureRoom,
    openMemberARoomWithDiagnostics,
    requireMemberARoom,
  } = createElementNavigationHelpers(
    supportContext,
    record,
    recordMemberASessionObservation,
  );

  const { recordJourneyFailure, openCalendarWidget, openEventEditor } =
    createElementWidgetHelpers(supportContext, record);

  async function readGatewayEventUpdate(
    response: Response | undefined,
    expectedEventHref: string,
    expectedTitle: string,
    expectedPrincipalLocalpart: string,
  ): Promise<{
    etag?: string;
    identityMatches: boolean;
    titleMatches?: boolean;
  }> {
    if (!response) return { identityMatches: false };
    try {
      const body: unknown = await response.json();
      if (typeof body !== 'object' || body === null || !('event' in body)) {
        return { identityMatches: false };
      }
      const event = body.event;
      const etag =
        'etag' in body && typeof body.etag === 'string' ? body.etag : undefined;
      const identityMatches =
        typeof event === 'object' &&
        event !== null &&
        'id' in event &&
        typeof event.id === 'string' &&
        g6GatewayResourceIdentityMatches(
          event.id,
          expectedEventHref,
          expectedPrincipalLocalpart,
        );
      const titleMatches =
        typeof event === 'object' &&
        event !== null &&
        'title' in event &&
        typeof event.title === 'string'
          ? event.title === expectedTitle
          : undefined;
      return {
        ...(etag ? { etag } : {}),
        identityMatches,
        ...(titleMatches === undefined ? {} : { titleMatches }),
      };
    } catch {
      return { identityMatches: false };
    }
  }

  function waitForGatewayResponse(
    page: Page,
    method: string,
    pathname: string,
  ): Promise<Response> {
    return page.waitForResponse(
      (response) => {
        const url = new URL(response.url());
        return (
          url.origin === new URL(supportContext.fixture.gatewayUrl).origin &&
          url.pathname === pathname &&
          response.request().method() === method
        );
      },
      { timeout: 30_000 },
    );
  }

  const {
    createPrivateCalendarListRequestObserver,
    waitForPrivateClientResponse,
    requestPrivateClientListStatus,
    requestPrivateDav,
    privateSetupDetailsAbsent,
    privateTlsDirectoryMatchesRunnerTemp,
    readPrivateAcceptanceCaCertificate,
    selectPrivateAcceptanceCalendar,
    privateCredentialsMatchGateway,
    parsePrivateCredentialUrl,
    privateDavLifecycleSucceeded,
    privateDavWriteSucceeded,
    isStrongPrivateDavEtag,
    privateDavReadSucceeded,
    privateDavReadEtagOrEmpty,
    bestEffortDeleteOwnedPrivateDavResource,
    revokedPrivateDavCredentialDenied,
  } = createPrivateAcceptanceHelpers(
    () => supportContext.fixture,
    PRIVATE_ACCEPTANCE_GATEWAY_ORIGIN,
  );

  function observeReminderWidgetContextResponse(
    page: Page,
    roomId: string,
  ): ReminderWidgetContextResponseObserver {
    let responseStatus: number | undefined;
    const gatewayOrigin = new URL(supportContext.fixture.gatewayUrl).origin;
    const widgetOrigin = new URL(supportContext.fixture.widgetUrl).origin;
    // eslint-disable-next-line playwright/missing-playwright-await -- Register before room/widget actions to avoid a response race; the caller awaits reminderContextResponseObserver.response after openCalendarWidget.
    const response = page.waitForResponse(
      (candidate) => {
        try {
          const url = new URL(candidate.url());
          const request = candidate.request();
          const requestFrameOrigin = new URL(request.frame().url()).origin;
          if (
            url.origin !== gatewayOrigin ||
            url.pathname !== '/v1/calendar/context' ||
            url.searchParams.get('roomId') !== roomId ||
            request.method() !== 'GET' ||
            requestFrameOrigin !== widgetOrigin
          ) {
            return false;
          }
          responseStatus = candidate.status();
          return true;
        } catch {
          return false;
        }
      },
      { timeout: 60_000 },
    );
    return {
      response,
      snapshot: () => ({
        reminderWidgetContextResponseCount:
          responseStatus === undefined ? 0 : 1,
        ...(responseStatus === undefined
          ? {}
          : { reminderWidgetContextResponseStatus: responseStatus }),
      }),
    };
  }

  async function requestRoomEventsStatus(
    page: Page,
    {
      gatewayUrl,
      roomId,
      calendarId,
    }: { gatewayUrl: string; roomId: string; calendarId: string },
  ): Promise<number> {
    return page.evaluate(
      async ({ gatewayUrl, roomId, calendarId }) => {
        // Only the numeric HTTP status crosses back into the test process.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const matrixClient = (window as any).mxMatrixClientPeg.get();
        const credentials = await matrixClient.getOpenIdToken();
        const identity = {
          matrix_server_name: credentials.matrix_server_name,
          access_token: credentials.access_token,
        };
        const query = new URLSearchParams({
          roomId,
          target: 'room',
          calendarId,
          start: new Date().toISOString(),
          end: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          timezone: 'Europe/Stockholm',
        });
        const response = await fetch(
          `${gatewayUrl}/v1/calendar/events?${query.toString()}`,
          {
            headers: {
              Authorization: `MX-Identity ${btoa(JSON.stringify(identity))}`,
            },
          },
        );
        await response.body?.cancel();
        return response.status;
      },
      { gatewayUrl, roomId, calendarId },
    );
  }

  function observePostCreateVisibility(
    page: Page,
    {
      expectedCalendarId,
      expectedRoomId,
      expectedTitle,
    }: {
      expectedCalendarId: string;
      expectedRoomId: string;
      expectedTitle: string;
    },
  ) {
    const expectedGatewayOrigin = new URL(supportContext.fixture.gatewayUrl)
      .origin;
    const observation: PostCreateVisibilityObservation = {
      postCreateEventGetRequestCount: 0,
      roomTargetRangeRequestCount: 0,
      expectedRoomRangeRequestSeen: false,
      roomTargetRangeResponseCount: 0,
      roomTargetRangeLastStatus: null,
      createResponseHasEvent: false,
      createResponseTitleMatches: false,
      createResponseCalendarMatches: false,
      createResponseTimingComparable: false,
      createResponseEventIntersectsRoomRange: false,
      caldavReportProbeCompleted: false,
      caldavOpenIdHttpStatus: null,
      caldavReportHttpStatus: null,
      caldavReportContainsCreatedEvent: null,
      caldavProjection: {
        completed: false,
        includesCreatedEvent: null,
        diagnosticCode: 'inconclusive',
        diagnosticCounts: emptyProjectionDiagnosticCounts(),
        timezoneAudit: unavailableTimezoneAudit(),
      },
      roomListResponseHasEventsArray: false,
      roomListResponseEventCount: 0,
      roomListDiagnostics: {
        complete: false,
        counts: emptyProjectionDiagnosticCounts(),
      },
      roomListResponseTitleMatches: false,
      roomListResponseIdMatches: false,
      roomListResponseCalendarMatches: false,
      listViewHeadingPresent: false,
      matchingListItemCount: 0,
    };
    const pendingResponseReads: Promise<void>[] = [];
    const postCreateRangeRequests = new WeakSet<Request>();
    let successfulCreateResponseObserved = false;
    let createdEventId: string | undefined;
    let createdEventUid: string | undefined;
    let createdEventTiming: CreatedEventTiming | undefined;
    let expectedRoomRange: ExpectedRoomRange | undefined;
    let matchingEventListRow: { id?: string; calendarId?: string } | undefined;

    const roomRangeMatches = (rawUrl: string) => {
      try {
        const url = new URL(rawUrl);
        if (
          url.origin !== expectedGatewayOrigin ||
          url.pathname !== '/v1/calendar/events' ||
          url.searchParams.get('target') !== 'room' ||
          url.searchParams.get('roomId') !== expectedRoomId
        ) {
          return { roomTarget: false, expectedRange: false };
        }

        const roomTarget = true;
        const start = url.searchParams.get('start') ?? '';
        const end = url.searchParams.get('end') ?? '';
        const startMillis = Date.parse(start);
        const endMillis = Date.parse(end);
        const expectedRange =
          url.searchParams.get('calendarId') === expectedCalendarId &&
          Number.isFinite(startMillis) &&
          Number.isFinite(endMillis) &&
          endMillis > startMillis;
        return {
          roomTarget,
          expectedRange,
          ...(expectedRange
            ? {
                range: {
                  start,
                  end,
                  timezone: url.searchParams.get('timezone') ?? '',
                },
              }
            : {}),
        };
      } catch {
        return { roomTarget: false, expectedRange: false };
      }
    };

    const onRequest = (request: Request) => {
      if (
        request.method() === 'POST' &&
        isCalendarEventsEndpoint(request.url())
      ) {
        return;
      }
      if (
        request.method() !== 'GET' ||
        !isCalendarEventsEndpoint(request.url()) ||
        !successfulCreateResponseObserved
      ) {
        return;
      }

      postCreateRangeRequests.add(request);
      observation.postCreateEventGetRequestCount = Math.min(
        observation.postCreateEventGetRequestCount + 1,
        2,
      );
      const roomRange = roomRangeMatches(request.url());
      if (roomRange.roomTarget) {
        observation.roomTargetRangeRequestCount = Math.min(
          observation.roomTargetRangeRequestCount + 1,
          2,
        );
      }
      if (roomRange.expectedRange) {
        observation.expectedRoomRangeRequestSeen = true;
        expectedRoomRange ??= roomRange.range;
      }
    };

    const onResponse = (response: Response) => {
      const request = response.request();
      if (
        request.method() === 'POST' &&
        isCalendarEventsEndpoint(response.url())
      ) {
        successfulCreateResponseObserved =
          response.status() >= 200 && response.status() < 300;
        return;
      }
      if (
        request.method() !== 'GET' ||
        !isCalendarEventsEndpoint(response.url()) ||
        !postCreateRangeRequests.has(request)
      ) {
        return;
      }
      const roomRange = roomRangeMatches(response.url());
      if (!roomRange.expectedRange) return;

      observation.roomTargetRangeResponseCount = Math.min(
        observation.roomTargetRangeResponseCount + 1,
        2,
      );
      observation.roomTargetRangeLastStatus = response.status();
      expectedRoomRange ??= roomRange.range;

      pendingResponseReads.push(
        (async () => {
          let body: unknown;
          try {
            body = await response.json();
          } catch {
            return;
          }
          if (!isRecord(body) || !Array.isArray(body.events)) return;
          observation.roomListResponseHasEventsArray = true;
          observation.roomListResponseEventCount = Math.min(
            body.events.length,
            2,
          );
          observation.roomListDiagnostics = summarizeProjectionDiagnostics(
            body.diagnostics,
          );

          for (const resource of body.events) {
            if (!isRecord(resource) || !isRecord(resource.event)) continue;
            const event = resource.event;
            if (event.title !== expectedTitle) continue;

            observation.roomListResponseTitleMatches = true;
            const candidate = {
              ...(typeof event.id === 'string' ? { id: event.id } : {}),
              ...(typeof event.calendarId === 'string'
                ? { calendarId: event.calendarId }
                : {}),
            };
            matchingEventListRow ??= candidate;
            observation.roomListResponseCalendarMatches =
              event.calendarId === expectedCalendarId;
            observation.roomListResponseIdMatches = Boolean(
              createdEventId && event.id === createdEventId,
            );
            break;
          }
        })(),
      );
    };

    page.on('request', onRequest);
    page.on('response', onResponse);

    return {
      async observeCreatedEvent(response: Response) {
        let body: unknown;
        try {
          body = await response.json();
        } catch {
          return;
        }
        if (!isRecord(body) || !isRecord(body.event)) return;

        const event = body.event;
        if (
          typeof event.id !== 'string' ||
          typeof event.title !== 'string' ||
          typeof event.calendarId !== 'string'
        ) {
          return;
        }

        createdEventId = event.id;
        createdEventUid =
          typeof event.uid === 'string' && event.uid.length > 0
            ? event.uid
            : undefined;
        createdEventTiming = readCreatedEventTiming(event.timing);
        observation.createResponseHasEvent = true;
        observation.createResponseTitleMatches = event.title === expectedTitle;
        observation.createResponseCalendarMatches =
          event.calendarId === expectedCalendarId;
        if (matchingEventListRow) {
          observation.roomListResponseIdMatches =
            matchingEventListRow.id === createdEventId;
          observation.roomListResponseCalendarMatches =
            matchingEventListRow.calendarId === expectedCalendarId;
        }
      },
      async collect(frame: FrameLocator, eventRow: Locator) {
        await Promise.allSettled(pendingResponseReads);
        if (createdEventTiming && expectedRoomRange) {
          const timingMatch = await page.evaluate(
            compareEventTimingWithRoomRange,
            { timing: createdEventTiming, range: expectedRoomRange },
          );
          observation.createResponseTimingComparable = timingMatch.comparable;
          observation.createResponseEventIntersectsRoomRange =
            timingMatch.intersects;
        }
        if (createdEventUid && expectedRoomRange) {
          const caldavProbe = runCalDavReportProbe({
            calendarId: expectedCalendarId,
            eventUid: createdEventUid,
            range: expectedRoomRange,
            fixture: supportContext.fixture,
          });
          if (caldavProbe) {
            observation.caldavReportProbeCompleted = caldavProbe.completed;
            observation.caldavOpenIdHttpStatus = caldavProbe.openIdStatus;
            observation.caldavReportHttpStatus = caldavProbe.reportStatus;
            observation.caldavReportContainsCreatedEvent =
              caldavProbe.containsCreatedEvent;
            observation.caldavProjection = caldavProbe.projection;
          }
        }
        const [headingCount, itemCount] = await Promise.all([
          frame
            .getByRole('heading', { name: 'Calendar events', exact: true })
            .count()
            .catch(() => 0),
          eventRow.count().catch(() => 0),
        ]);
        observation.listViewHeadingPresent = headingCount > 0;
        observation.matchingListItemCount = Math.min(itemCount, 2);
        page.off('request', onRequest);
        page.off('response', onResponse);
        return observation;
      },
    };
  }

  function runCalDavReportProbe({
    calendarId,
    eventUid,
    range,
    fixture: fixtureValue,
  }: {
    calendarId: string;
    eventUid: string;
    range: ExpectedRoomRange;
    fixture: Fixture;
  }): CalDavReportProbeResult | undefined {
    const principal = acceptancePrincipal(fixtureValue);
    if (!principal) return undefined;
    const result = spawnSync(
      process.execPath,
      [
        resolve(
          process.cwd(),
          '../dev/element-acceptance-caldav-report-probe.mjs',
        ),
      ],
      {
        input: JSON.stringify({
          calendarId,
          eventUid,
          range,
          principalMode: fixtureValue.principalMode,
          serviceSender: fixtureValue.serviceSender,
          bot: fixtureValue.users.bot,
        }),
        encoding: 'utf8',
        env:
          principal.mode === 'appservice'
            ? { MATRIX_APPLICATION_SERVICE_TOKEN: principal.accessToken }
            : {},
        stdio: ['pipe', 'pipe', 'ignore'],
        timeout: 20_000,
        maxBuffer: 4096,
      },
    );
    if (result.error || result.status !== 0 || !result.stdout) return undefined;

    let value: unknown;
    try {
      value = JSON.parse(result.stdout);
    } catch {
      return undefined;
    }
    if (!isRecord(value)) return undefined;
    const expectedKeys = [
      'completed',
      'openIdStatus',
      'reportStatus',
      'containsCreatedEvent',
      'projection',
    ];
    if (
      Object.keys(value).length !== expectedKeys.length ||
      expectedKeys.some((key) => !Object.hasOwn(value, key)) ||
      typeof value.completed !== 'boolean' ||
      (value.containsCreatedEvent !== null &&
        typeof value.containsCreatedEvent !== 'boolean') ||
      value.completed !== (value.containsCreatedEvent !== null) ||
      !isOptionalHttpStatus(value.openIdStatus) ||
      !isOptionalHttpStatus(value.reportStatus) ||
      !isCalDavProjectionObservation(value.projection) ||
      value.completed !== value.projection.completed ||
      (value.containsCreatedEvent && !value.completed)
    ) {
      return undefined;
    }
    return {
      completed: value.completed,
      openIdStatus: value.openIdStatus,
      reportStatus: value.reportStatus,
      containsCreatedEvent: value.containsCreatedEvent,
      projection: value.projection,
    };
  }

  function isCalendarEventsEndpoint(rawUrl: string): boolean {
    try {
      const url = new URL(rawUrl);
      return (
        url.origin === new URL(supportContext.fixture.gatewayUrl).origin &&
        url.pathname === '/v1/calendar/events'
      );
    } catch {
      return false;
    }
  }

  function appendPostCreateVisibilityObservation(
    observation: PostCreateVisibilityObservation,
  ) {
    const stageFile = process.env.ELEMENT_ACCEPTANCE_STAGE_FILE;
    if (!stageFile) throw new Error('Element acceptance fixture unavailable');
    appendFileSync(
      stageFile,
      `${JSON.stringify({
        phase: 'event-create-post-refresh-observed',
        status: 'passed',
        ...observation,
      })}\n`,
      { encoding: 'utf8', mode: 0o600 },
    );
  }

  const { observeAcceptanceRuntime, recordWidgetRuntimeObservation } =
    createAcceptanceRuntimeHelpers(supportContext, appendRuntimeObservation);

  function appendRuntimeObservation(observation: AcceptanceRuntimeObservation) {
    const stageFile = process.env.ELEMENT_ACCEPTANCE_STAGE_FILE;
    if (!stageFile) throw new Error('Element acceptance fixture unavailable');
    appendFileSync(
      stageFile,
      `${JSON.stringify({
        phase: 'widget-a-runtime-observed',
        status: observation.iframeObservationAvailable
          ? 'passed'
          : 'unavailable',
        gatewayContextRequestCount: observation.requestCounts.context,
        gatewayCalendarsRequestCount: observation.requestCounts.calendars,
        gatewayEventsRequestCount: observation.requestCounts.events,
        gatewayOtherCalendarRequestCount:
          observation.requestCounts['other-calendar'],
        gatewayOtherApiRequestCount: observation.requestCounts['other-api'],
        gatewayOptionsRequestCount: observation.optionsRequestCount,
        gatewayFailedRequestCount: observation.failedRequestCount,
        gatewayLastRequestEndpoint: observation.lastRequestEndpoint,
        gatewayLastRequestMethod: observation.lastRequestMethod,
        gatewayLastResponseEndpoint: observation.lastResponseEndpoint,
        gatewayLastResponseMethod: observation.lastResponseMethod,
        widgetDocumentRequestCount:
          observation.widgetResourceRequestCounts.document,
        widgetScriptRequestCount:
          observation.widgetResourceRequestCounts.script,
        widgetStylesheetRequestCount:
          observation.widgetResourceRequestCounts.stylesheet,
        widgetDocumentFailureCount:
          observation.widgetResourceFailureCounts.document,
        widgetScriptFailureCount:
          observation.widgetResourceFailureCounts.script,
        widgetStylesheetFailureCount:
          observation.widgetResourceFailureCounts.stylesheet,
        openIdRequestCount: observation.openIdRequestCount,
        openIdOptionsRequestCount: observation.openIdOptionsRequestCount,
        openIdFailedRequestCount: observation.openIdFailedRequestCount,
        openIdLastRequestMethod: observation.openIdLastRequestMethod,
        widgetApiGetOpenIdRequestCount:
          observation.widgetApiGetOpenIdRequestCount,
        widgetApiParentObserverAvailable:
          observation.widgetApiParentObserverAvailable,
        widgetApiRequestSourceMatches:
          observation.widgetApiRequestSourceMatches,
        widgetApiRequestOriginMatches:
          observation.widgetApiRequestOriginMatches,
        widgetApiRequestWidgetIdMatches:
          observation.widgetApiRequestWidgetIdMatches,
        widgetApiInitialResponseCount:
          observation.widgetApiInitialResponseCount,
        widgetApiInitialResponseState:
          observation.widgetApiInitialResponseState,
        widgetApiInitialResponseSourceMatches:
          observation.widgetApiInitialResponseSourceMatches,
        widgetApiInitialResponseOriginMatches:
          observation.widgetApiInitialResponseOriginMatches,
        widgetApiInitialResponseWidgetIdMatches:
          observation.widgetApiInitialResponseWidgetIdMatches,
        widgetApiFollowupCount: observation.widgetApiFollowupCount,
        widgetApiFollowupState: observation.widgetApiFollowupState,
        widgetApiFollowupRequestIdMatches:
          observation.widgetApiFollowupRequestIdMatches,
        widgetApiFollowupSourceMatches:
          observation.widgetApiFollowupSourceMatches,
        widgetApiFollowupOriginMatches:
          observation.widgetApiFollowupOriginMatches,
        widgetApiFollowupWidgetIdMatches:
          observation.widgetApiFollowupWidgetIdMatches,
        widgetParametersObserved: observation.widgetParametersObserved,
        widgetGatewayBaseOriginMatches:
          observation.widgetGatewayBaseOriginMatches,
        widgetRoomIdMatches: observation.widgetRoomIdMatches,
        widgetIdParameterPresent: observation.widgetIdParameterPresent,
        ...(observation.lastResponseStatus === undefined
          ? {}
          : { gatewayLastResponseStatus: observation.lastResponseStatus }),
        ...(observation.widgetResourceLastStatuses.document === undefined
          ? {}
          : {
              widgetDocumentLastStatus:
                observation.widgetResourceLastStatuses.document,
            }),
        ...(observation.widgetResourceLastStatuses.script === undefined
          ? {}
          : {
              widgetScriptLastStatus:
                observation.widgetResourceLastStatuses.script,
            }),
        ...(observation.widgetResourceLastStatuses.stylesheet === undefined
          ? {}
          : {
              widgetStylesheetLastStatus:
                observation.widgetResourceLastStatuses.stylesheet,
            }),
        ...(observation.openIdLastResponseStatus === undefined
          ? {}
          : { openIdLastResponseStatus: observation.openIdLastResponseStatus }),
        iframeObservationAvailable: observation.iframeObservationAvailable,
        iframeGatewayBaseOriginMatches:
          observation.iframeGatewayBaseOriginMatches,
        iframeRoomIdMatches: observation.iframeRoomIdMatches,
        widgetFrameAvailable: observation.widgetFrameAvailable,
        widgetDocumentReadyState: observation.widgetDocumentReadyState,
        widgetRootHasChildren: observation.widgetRootHasChildren,
        widgetLoadingVisible: observation.widgetLoadingVisible,
        widgetMissingCapabilitiesVisible:
          observation.widgetMissingCapabilitiesVisible,
        widgetRegistrationErrorVisible:
          observation.widgetRegistrationErrorVisible,
        widgetOutsideClientVisible: observation.widgetOutsideClientVisible,
        widgetChildErrorVisible: observation.widgetChildErrorVisible,
        calendarEventsLoadingVisible: observation.calendarEventsLoadingVisible,
        calendarEventsLoadErrorVisible:
          observation.calendarEventsLoadErrorVisible,
        widgetPageErrorCount: observation.widgetPageErrorCount,
        widgetLastPageErrorClass: observation.widgetLastPageErrorClass,
        createEventVisible: observation.createEventVisible,
        createEventEnabled: observation.createEventEnabled,
        identityContinueVisible: observation.identityContinueVisible,
      })}\n`,
      { encoding: 'utf8', mode: 0o600 },
    );
  }

  function record(
    phase: Phase,
    status: 'started' | 'passed' | 'failed',
    httpStatus?: number,
    count?: number,
    extra?: {
      originMatchesElement?: boolean;
      controlVisible?: boolean;
      panelPresent?: boolean;
      teamRoomMatches?: boolean;
      blockedRequestDiagnostics?: BlockedRequestDiagnostic[];
      blockedRequestDiagnosticOverflow?: boolean;
      relativeAlarmReadback?: boolean;
      reminderEnabled?: boolean;
      canaryDelivered?: boolean;
      roomMentioned?: boolean;
      selectedMemberMentioned?: boolean;
      targetMentioned?: boolean;
      expectedRoomRecipient?: boolean;
      expectedSelectedRecipient?: boolean;
      deliveredAfterDue?: boolean;
      allMarkersOnce?: boolean;
      targetSettingsReadback?: boolean;
      allDayScheduleReadback?: boolean;
      canManageReminders?: boolean;
    } & Partial<ReminderConfigurationObservation> &
      Partial<ReminderAlarmUiObservation> &
      Partial<PublicFeedBrowserObservation> &
      Partial<Omit<G6StageRecord, 'phase' | 'status' | 'httpStatus' | 'count'>>,
  ) {
    const stageFile = process.env.ELEMENT_ACCEPTANCE_STAGE_FILE;
    if (!stageFile) throw new Error('Element acceptance fixture unavailable');
    appendFileSync(
      stageFile,
      `${JSON.stringify({
        phase,
        status,
        ...(httpStatus === undefined ? {} : { httpStatus }),
        ...(count === undefined ? {} : { count }),
        ...extra,
      })}\n`,
      { encoding: 'utf8', mode: 0o600 },
    );
  }

  function enterActiveReminderFlowStage(
    stage: ReminderFlowDiagnosticStage,
  ): void {
    const state = supportContext.activeReminderFlowDiagnostic;
    if (state) enterReminderFlowDiagnosticStage(state, stage);
  }

  function completeActiveReminderFlowStage(
    stage: ReminderFlowDiagnosticStage,
  ): void {
    const state = supportContext.activeReminderFlowDiagnostic;
    if (state) completeReminderFlowDiagnosticStage(state, stage);
  }

  function failActiveReminderFlow(error: unknown): void {
    const state = supportContext.activeReminderFlowDiagnostic;
    if (state) failReminderFlowDiagnostic(state, error);
  }

  function finishActiveReminderFlowDiagnostic(
    status: string | undefined,
  ): void {
    const state = supportContext.activeReminderFlowDiagnostic;
    supportContext.activeReminderFlowDiagnostic = undefined;
    if (!state) return;

    const knownStatuses = new Set<ReminderFlowTestStatus>([
      'passed',
      'failed',
      'timedOut',
      'skipped',
      'interrupted',
      'unknown',
    ]);
    const testStatus = knownStatuses.has(status as ReminderFlowTestStatus)
      ? (status as ReminderFlowTestStatus)
      : 'unknown';
    if (testStatus !== 'passed' && testStatus !== 'skipped') {
      failReminderFlowDiagnostic(state, undefined);
    }
    recordReminderFlowDiagnostic(
      buildReminderFlowDiagnosticRecord(state, testStatus),
    );
  }

  function captureReminderFlowReadbackError(error: unknown): void {
    failActiveReminderFlow(error);
  }

  function recordReminderFlowDiagnostic(
    diagnostic: ReminderFlowDiagnosticRecord,
  ): void {
    const stageFile = process.env.ELEMENT_ACCEPTANCE_STAGE_FILE;
    if (!stageFile) throw new Error('Element acceptance fixture unavailable');
    appendFileSync(stageFile, `${JSON.stringify(diagnostic)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
  }

  function recordPerformancePilot(
    status: 'started' | 'passed' | 'failed',
    performanceReport: PerformanceReportData,
    failureCode?: string,
  ) {
    const stageFile = process.env.ELEMENT_ACCEPTANCE_STAGE_FILE;
    if (!stageFile) throw new Error('Element acceptance fixture unavailable');
    appendFileSync(
      stageFile,
      `${JSON.stringify({
        phase: 'performance-pilot',
        status,
        ...(failureCode === undefined ? {} : { failureCode }),
        performanceReport,
      })}\n`,
      { encoding: 'utf8', mode: 0o600 },
    );
  }

  function capturePrivatePerformancePageError(
    error: Error,
    profile: OrdinaryPerformanceProfile,
    stage: PerformancePageErrorStage,
  ): void {
    // This is an opt-in local synthetic-run aid. CI never writes raw exception
    // text, and the file is never attached to acceptance artifacts.
    if (process.env.CI || process.env.GITHUB_ACTIONS) return;
    const configuredPath =
      process.env.ELEMENT_ACCEPTANCE_PRIVATE_ERROR_CAPTURE_PATH;
    if (!configuredPath || !isAbsolute(configuredPath)) return;
    const capturePath = resolve(configuredPath);
    const privateRoot = realpathSync(tmpdir()) + sep;
    if (!capturePath.startsWith(privateRoot)) return;

    try {
      mkdirSync(dirname(capturePath), { recursive: true, mode: 0o700 });
      const captureParent = realpathSync(dirname(capturePath));
      if (
        captureParent !== realpathSync(tmpdir()) &&
        !captureParent.startsWith(privateRoot)
      ) {
        return;
      }
      const bounded = (value: unknown, maxLength: number): string | null =>
        typeof value === 'string' ? value.slice(0, maxLength) : null;
      const payload = `${JSON.stringify({
        profile,
        stage,
        name: bounded(error.name, 128),
        message: bounded(error.message, 4_096),
        stack: bounded(error.stack, 32_768),
      })}\n`;
      if (Buffer.byteLength(payload, 'utf8') > 40_000) return;
      // Exclusive create refuses existing files and symlinks; first error wins.
      writeFileSync(capturePath, payload, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      });
    } catch {
      // Diagnostics must never replace the original acceptance failure.
    }
  }

  function recordMemberASessionObservation(
    observation:
      | {
          matrixClientHookPresent: boolean;
          matrixClientPresent: boolean;
          matrixUserMatches: boolean;
          matrixSyncState: MatrixSyncState;
        }
      | undefined,
  ) {
    const stageFile = process.env.ELEMENT_ACCEPTANCE_STAGE_FILE;
    if (!stageFile) throw new Error('Element acceptance fixture unavailable');
    appendFileSync(
      stageFile,
      `${JSON.stringify({
        phase: 'member-a-session-observed',
        status: observation ? 'passed' : 'unavailable',
        ...(observation ?? {}),
      })}\n`,
      { encoding: 'utf8', mode: 0o600 },
    );
  }

  function recordMemberARoomObservation(
    result: MemberARoomResult,
    phase: MemberRoomContextPhase = 'member-a-room-context',
    reminderWidgetContext?: ReminderWidgetContextResponseSnapshot,
  ) {
    const stageFile = process.env.ELEMENT_ACCEPTANCE_STAGE_FILE;
    if (!stageFile) throw new Error('Element acceptance fixture unavailable');
    appendFileSync(
      stageFile,
      `${JSON.stringify(
        createMemberRoomContextRecord(result, phase, reminderWidgetContext),
      )}\n`,
      { encoding: 'utf8', mode: 0o600 },
    );
  }

  function recordRuntimeVersions(chromiumVersion: string) {
    const stageFile = process.env.ELEMENT_ACCEPTANCE_STAGE_FILE;
    if (!stageFile) throw new Error('Element acceptance fixture unavailable');
    appendFileSync(
      stageFile,
      `${JSON.stringify({
        phase: 'runtime-versions',
        status: 'passed',
        elementWebConfiguredTag: ELEMENT_WEB_CONFIGURED_TAG,
        synapseConfiguredTag: 'v1.161.0',
        radicaleConfiguredTag: '3.8.0.0',
        chromiumVersion,
        runnerOS: platform(),
        runnerOSVersion: release(),
        runnerArchitecture: arch(),
        nodeVersion: process.version,
      })}\n`,
      { encoding: 'utf8', mode: 0o600 },
    );
  }

  function requirePrivateUiCheckpointJournal<T>(journal: T | undefined): T {
    if (journal === undefined) {
      throw new Error('Private acceptance checkpoints are unavailable');
    }
    return journal;
  }

  function createPrivateJourneyContext() {
    return {
      get fixture() {
        return supportContext.fixture;
      },
      set fixture(value: Fixture) {
        supportContext.fixture = value;
      },
      requirePrivateUiCheckpointJournal,
      readFixture,
      PRIVATE_ACCEPTANCE_GATEWAY_ORIGIN,
      privateTlsDirectoryMatchesRunnerTemp,
      readPrivateAcceptanceCaCertificate,
      authenticateInElement,
      openFixtureRoom,
      createPrivateCalendarListRequestObserver,
      openCalendarWidget,
      waitForPrivateClientResponse,
      selectPrivateAcceptanceCalendar,
      parsePrivateCredentialUrl,
      privateCredentialsMatchGateway,
      privateSetupDetailsAbsent,
      requestPrivateDav,
      privateDavWriteSucceeded,
      privateDavReadSucceeded,
      isStrongPrivateDavEtag,
      privateDavReadEtagOrEmpty,
      privateDavLifecycleSucceeded,
      bestEffortDeleteOwnedPrivateDavResource,
      requestPrivateClientListStatus,
      revokedPrivateDavCredentialDenied,
    };
  }
  return {
    createPrivateJourneyContext,
    createFunctionalJourneyContext,
    createPerformanceJourneyContext,
    createReminderJourneyContext,
    finishActiveReminderFlowDiagnostic,
    async runG6(browser: Browser) {
      supportContext.fixture = readFixture();
      recordRuntimeVersions(browser.version());
      await runElementG6AcceptanceJourney({
        browser,
        fixture: supportContext.fixture,
        record,
        isRecord,
        authenticateInElement,
        openMemberARoomWithDiagnostics,
        recordMemberARoomObservation,
        openCalendarWidget,
        openEventEditor,
        waitForGatewayResponse,
        readGatewayEventUpdate,
        openFixtureRoom,
      });
    },
  };
}

export type FunctionalJourneyContext = ReturnType<
  ReturnType<
    typeof createElementAcceptanceSupport
  >['createFunctionalJourneyContext']
>;

export type PerformanceJourneyContext = ReturnType<
  ReturnType<
    typeof createElementAcceptanceSupport
  >['createPerformanceJourneyContext']
>;

export type ReminderJourneyContext = ReturnType<
  ReturnType<
    typeof createElementAcceptanceSupport
  >['createReminderJourneyContext']
>;

export type PrivateJourneyContext = ReturnType<
  ReturnType<
    typeof createElementAcceptanceSupport
  >['createPrivateJourneyContext']
>;

export type {
  AcceptanceRuntimeObservation,
  BlockedRequestEvidence,
  BrowserActor,
  OrdinaryPerformanceCase,
  OrdinaryPerformanceProfile,
  PerformanceActionSample,
  PerformanceApiObserver,
  PerformanceDetailsSample,
  PerformancePageErrorObservation,
  PerformancePageErrorStage,
  PerformanceSampleKey,
  PrivateCalendarListRequestObserver,
  ReminderFlow,
  ReminderReadbackReference,
} from './elementAcceptanceSupportTypes';
