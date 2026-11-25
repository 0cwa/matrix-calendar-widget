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
  expect,
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

import { ElementWebPage } from './pages/elementWebPage';

import {
  PUBLIC_FEED_MANAGEMENT_ERROR_CODES,
  type AcceptanceRuntimeObservation,
  type AnonymousPublicFeedResponse,
  type BlockedRequestDiagnostic,
  type CalDavReportProbeResult,
  type ExpectedRoomRange,
  type HomeserverHttpFailures,
  type OpenIdProtocolState,
  type OrdinaryPerformanceProfile,
  type PerformancePageErrorStage,
  type PerformanceReportData,
  type Phase,
  type PinnedControlObservation,
  type PostCreateVisibilityObservation,
  type PublicFeedBrowserObservation,
  type PublicFeedManagementErrorCode,
  type ReminderAlarmUiObservation,
  type ReminderConfigurationObservation,
  type ReminderWidgetContextResponseObserver,
  type ReminderWidgetContextResponseSnapshot,
  type WidgetDocumentReadyState,
  type WidgetPageErrorClass,
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

import {
  classifyGatewayMethod,
  classifyGatewayRequest,
  classifyWidgetResource,
  isOpenIdRequest,
} from './elementAcceptanceRequestHelpers';

import { createPerformanceObservationHelpers } from './elementAcceptancePerformanceObserver';

import { createReminderAcceptanceHelpers } from './elementAcceptanceReminderFlowHelpers';

import { createElementWidgetHelpers } from './elementAcceptanceWidgetHelpers';

import { createElementNavigationHelpers } from './elementAcceptanceNavigationHelpers';

import { createFixtureAcceptanceHelpers } from './elementAcceptanceFixtureHelpers';

import { createPrivateAcceptanceHelpers } from './elementAcceptancePrivateHelpers';

export function createElementAcceptanceSupport() {
  const PUBLIC_FEED_MANAGEMENT_ERROR_CODE_SET = new Set<string>(
    PUBLIC_FEED_MANAGEMENT_ERROR_CODES,
  );

  function classifyPublicFeedManagementErrorCode(
    state: unknown,
  ): PublicFeedManagementErrorCode {
    if (!isRecord(state) || typeof state.code !== 'string') {
      return 'unclassified';
    }
    return PUBLIC_FEED_MANAGEMENT_ERROR_CODE_SET.has(state.code)
      ? (state.code as PublicFeedManagementErrorCode)
      : 'unclassified';
  }

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

  async function waitForPublicFeedPublicationResponse(
    page: Page,
    method: 'GET' | 'PUT' | 'DELETE',
    targetScope: 'any' | 'fixture-room' = 'any',
  ): Promise<Response> {
    const gatewayOrigin = new URL(supportContext.fixture.gatewayUrl).origin;
    return page.waitForResponse(
      (response) => {
        const url = new URL(response.url());
        return (
          url.origin === gatewayOrigin &&
          url.pathname === '/v1/calendar-feeds/publication' &&
          response.request().method() === method &&
          (targetScope === 'any' || publicFeedManagementTargetMatches(response))
        );
      },
      { timeout: 20_000 },
    );
  }

  function publicFeedManagementTargetMatches(response: Response): boolean {
    try {
      const url = new URL(response.url());
      return (
        url.origin === new URL(supportContext.fixture.gatewayUrl).origin &&
        url.pathname === '/v1/calendar-feeds/publication' &&
        url.searchParams.get('target') === 'room' &&
        url.searchParams.get('calendarId') ===
          supportContext.fixture.calendarId &&
        url.searchParams.get('roomId') === supportContext.fixture.teamRoomId
      );
    } catch {
      return false;
    }
  }

  async function fetchAnonymousPublicFeed(
    url: string,
    method: 'GET' | 'HEAD',
  ): Promise<AnonymousPublicFeedResponse> {
    const headers = new Headers({ Accept: 'text/calendar' });
    try {
      const response = await fetch(url, {
        method,
        headers,
        redirect: 'manual',
        signal: AbortSignal.timeout(10_000),
      });
      let body = new Uint8Array();
      try {
        body = new Uint8Array(await response.arrayBuffer());
      } catch {
        // Retain the observed status and closed headers if the body read fails.
      }
      return {
        status: response.status,
        contentType: response.headers.get('Content-Type') ?? undefined,
        contentLength: response.headers.get('Content-Length') ?? undefined,
        cacheControl: response.headers.get('Cache-Control') ?? undefined,
        pragma: response.headers.get('Pragma') ?? undefined,
        nosniff: response.headers.get('X-Content-Type-Options') ?? undefined,
        body,
      };
    } catch {
      return { body: new Uint8Array() };
    }
  }

  async function verifyPublicFeedBrowserLifecycle(
    frame: FrameLocator,
    page: Page,
    eventTitle: string,
  ): Promise<void> {
    supportContext.activePhase = 'public-feed-browser-lifecycle';
    record(supportContext.activePhase, 'started');
    const observation: PublicFeedBrowserObservation = {
      publicFeedLifecycleStep: 'opening-dialog',
      publicConsentGateObserved: false,
      publicManagerPublishSucceeded: false,
      publicUrlOriginAndRouteMatch: false,
      anonymousGetContainsCanonicalEvent: false,
      anonymousHeadMatchesGet: false,
      unpublishSucceeded: false,
      anonymousGetDeniedAfterUnpublish: false,
      anonymousHeadDeniedAfterUnpublish: false,
    };
    let publicUrl: string | undefined;
    let dialog: Locator | undefined;
    let publicationCreated = false;
    try {
      const publicFeedButton = frame.getByRole('button', {
        name: 'Public feed',
        exact: true,
      });
      await expect(publicFeedButton).toBeVisible();
      observation.publicFeedLifecycleStep = 'loading-settings';
      const initialSettingsResponse = waitForPublicFeedPublicationResponse(
        page,
        'GET',
      );
      await publicFeedButton.click();
      dialog = frame.getByRole('dialog', {
        name: 'Public calendar feed',
      });
      await expect(dialog).toBeVisible();
      const settingsResponse = await initialSettingsResponse;
      let managementResponse = settingsResponse;
      observation.publicFeedManagementGetStatus = settingsResponse.status();
      let managementState: unknown = await settingsResponse
        .json()
        .catch(() => null);
      if (settingsResponse.status() === 503) {
        observation.publicFeedManagementErrorCode =
          classifyPublicFeedManagementErrorCode(managementState);
      }

      observation.publicFeedLifecycleStep = 'selecting-target-calendar';
      const calendarSelect = dialog.getByRole('combobox', {
        name: 'Calendar',
      });
      let selectedCalendarName = (await calendarSelect.innerText()).trim();
      if (selectedCalendarName !== 'Room calendar') {
        const targetSettingsResponse = waitForPublicFeedPublicationResponse(
          page,
          'GET',
          'fixture-room',
        );
        await calendarSelect.click();
        // MUI renders Select options in a frame-level portal. Scope the choice
        // to the one visible listbox instead of querying the frame for options.
        const calendarListbox = frame
          .getByRole('listbox')
          .filter({ visible: true });
        await expect(calendarListbox).toHaveCount(1);
        await calendarListbox
          .getByRole('option', {
            name: 'Room calendar',
            exact: true,
          })
          .click();
        await expect(calendarSelect).toHaveText('Room calendar');
        const response = await targetSettingsResponse;
        managementResponse = response;
        observation.publicFeedManagementGetStatus = response.status();
        managementState = await response.json().catch(() => null);
        if (response.status() === 503) {
          observation.publicFeedManagementErrorCode =
            classifyPublicFeedManagementErrorCode(managementState);
        }
        selectedCalendarName = (await calendarSelect.innerText()).trim();
      }
      observation.publicFeedTargetCalendarMatches =
        selectedCalendarName === 'Room calendar';
      observation.publicFeedManagementTargetMatches =
        publicFeedManagementTargetMatches(managementResponse);
      observation.publicFeedSettingsEnabled =
        isRecord(managementState) && managementState.enabled === true;
      observation.publicFeedSettingsUnpublished =
        isRecord(managementState) && managementState.published === false;
      if (!observation.publicFeedManagementTargetMatches) {
        throw new Error(
          'Public feed management target did not match the fixture',
        );
      }

      const managerCanPublish =
        isRecord(managementState) &&
        managementState.enabled === true &&
        managementState.published === false;
      const consent = dialog.getByRole('checkbox', {
        name: 'I understand that anyone with the link can read this calendar.',
        exact: true,
      });
      const publishButton = dialog.getByRole('button', {
        name: 'Publish feed',
        exact: true,
      });
      observation.publicFeedLifecycleStep = 'awaiting-consent-control';
      observation.publicFeedConsentCheckboxCount = Math.min(
        await consent.count(),
        10,
      );
      observation.publicFeedConsentCheckboxVisible =
        observation.publicFeedConsentCheckboxCount > 0 &&
        (await consent.isVisible());
      observation.publicFeedConsentCheckboxChecked =
        observation.publicFeedConsentCheckboxCount > 0 &&
        (await consent.isChecked());
      observation.publicFeedPublishButtonCount = Math.min(
        await publishButton.count(),
        10,
      );
      await expect(consent).toBeVisible();
      observation.publicFeedConsentCheckboxCount = Math.min(
        await consent.count(),
        10,
      );
      observation.publicFeedConsentCheckboxVisible = await consent.isVisible();
      observation.publicFeedConsentCheckboxChecked = await consent.isChecked();
      const publishDisabledBeforeConsent = await publishButton.isDisabled();
      observation.publicFeedPublishDisabledBeforeConsent =
        publishDisabledBeforeConsent;
      observation.publicFeedLifecycleStep = 'toggling-consent';
      await consent.check();
      observation.publicFeedLifecycleStep = 'verifying-consent';
      observation.publicFeedConsentCheckboxChecked = await consent.isChecked();
      const publishEnabledAfterConsent = !(await publishButton.isDisabled());
      observation.publicFeedPublishDisabledAfterConsent =
        !publishEnabledAfterConsent;
      observation.publicConsentGateObserved =
        managerCanPublish &&
        publishDisabledBeforeConsent &&
        publishEnabledAfterConsent;
      if (!observation.publicConsentGateObserved) {
        throw new Error('Manager publication consent gate was not observed');
      }

      observation.publicFeedLifecycleStep = 'publishing';
      const publishResponsePromise = waitForPublicFeedPublicationResponse(
        page,
        'PUT',
      );
      await publishButton.click();
      const publishResponse = await publishResponsePromise;
      observation.publicFeedPublishStatus = publishResponse.status();
      const publishedState: unknown = await publishResponse
        .json()
        .catch(() => null);
      publicationCreated =
        publishResponse.status() >= 200 &&
        publishResponse.status() < 300 &&
        isRecord(publishedState) &&
        publishedState.published === true;
      observation.publicManagerPublishSucceeded = publicationCreated;
      if (!publicationCreated) {
        throw new Error('Manager publication did not succeed');
      }

      observation.publicFeedLifecycleStep = 'checking-public-feed';
      const publicUrlInput = dialog.getByRole('textbox', {
        name: 'Public feed URL',
        exact: true,
      });
      await expect(publicUrlInput).toBeVisible();
      publicUrl = await publicUrlInput.inputValue();
      let parsedPublicUrl: URL | undefined;
      try {
        parsedPublicUrl = new URL(publicUrl);
      } catch {
        parsedPublicUrl = undefined;
      }
      observation.publicUrlOriginAndRouteMatch =
        parsedPublicUrl !== undefined &&
        parsedPublicUrl.origin ===
          new URL(supportContext.fixture.gatewayUrl).origin &&
        /^\/v1\/public-calendar-feeds\/[A-Za-z0-9_.-]+$/u.test(
          parsedPublicUrl.pathname,
        ) &&
        parsedPublicUrl.username === '' &&
        parsedPublicUrl.password === '' &&
        parsedPublicUrl.search === '' &&
        parsedPublicUrl.hash === '';
      if (!observation.publicUrlOriginAndRouteMatch) {
        throw new Error('Public feed URL did not match the synthetic gateway');
      }

      const [publicGet, publicHead] = await Promise.all([
        fetchAnonymousPublicFeed(publicUrl, 'GET'),
        fetchAnonymousPublicFeed(publicUrl, 'HEAD'),
      ]);
      observation.publicFeedGetStatus = publicGet.status;
      observation.publicFeedHeadStatus = publicHead.status;
      let feedText = '';
      try {
        feedText = new TextDecoder('utf-8', { fatal: true }).decode(
          publicGet.body,
        );
      } catch {
        feedText = '';
      }
      const getHeadersAreSafe =
        publicGet.cacheControl?.toLowerCase().includes('no-store') === true &&
        publicGet.pragma?.toLowerCase() === 'no-cache' &&
        publicGet.nosniff?.toLowerCase() === 'nosniff';
      observation.anonymousGetContainsCanonicalEvent =
        publicGet.status === 200 &&
        publicGet.contentType?.toLowerCase().startsWith('text/calendar') ===
          true &&
        getHeadersAreSafe &&
        feedText.startsWith('BEGIN:VCALENDAR') &&
        feedText.includes('BEGIN:VEVENT') &&
        feedText.includes(eventTitle) &&
        feedText.trimEnd().endsWith('END:VCALENDAR');
      const headHeadersAreSafe =
        publicHead.cacheControl?.toLowerCase().includes('no-store') === true &&
        publicHead.pragma?.toLowerCase() === 'no-cache' &&
        publicHead.nosniff?.toLowerCase() === 'nosniff';
      observation.anonymousHeadMatchesGet =
        publicHead.status === 200 &&
        publicHead.contentType?.toLowerCase().startsWith('text/calendar') ===
          true &&
        headHeadersAreSafe &&
        publicHead.body.byteLength === 0 &&
        publicHead.contentLength === String(publicGet.body.byteLength);
      if (
        !observation.anonymousGetContainsCanonicalEvent ||
        !observation.anonymousHeadMatchesGet
      ) {
        throw new Error('Anonymous public feed GET/HEAD did not match');
      }

      observation.publicFeedLifecycleStep = 'unpublishing';
      const unpublishResponsePromise = waitForPublicFeedPublicationResponse(
        page,
        'DELETE',
      );
      await dialog
        .getByRole('button', { name: 'Unpublish', exact: true })
        .click();
      const unpublishResponse = await unpublishResponsePromise;
      observation.publicFeedUnpublishStatus = unpublishResponse.status();
      observation.unpublishSucceeded =
        unpublishResponse.status() >= 200 && unpublishResponse.status() < 300;
      if (!observation.unpublishSucceeded) {
        throw new Error('Public feed could not be unpublished');
      }
      publicationCreated = false;

      observation.publicFeedLifecycleStep = 'checking-revocation';
      const [revokedGet, revokedHead] = await Promise.all([
        fetchAnonymousPublicFeed(publicUrl, 'GET'),
        fetchAnonymousPublicFeed(publicUrl, 'HEAD'),
      ]);
      observation.publicFeedRevokedGetStatus = revokedGet.status;
      observation.publicFeedRevokedHeadStatus = revokedHead.status;
      observation.anonymousGetDeniedAfterUnpublish =
        revokedGet.status === 404 && revokedGet.body.byteLength === 0;
      observation.anonymousHeadDeniedAfterUnpublish =
        revokedHead.status === 404 && revokedHead.body.byteLength === 0;
      if (
        !observation.anonymousGetDeniedAfterUnpublish ||
        !observation.anonymousHeadDeniedAfterUnpublish
      ) {
        throw new Error('Public feed remained available after unpublishing');
      }

      observation.publicFeedLifecycleStep = 'complete';
      record(
        supportContext.activePhase,
        'passed',
        observation.publicFeedRevokedGetStatus,
        undefined,
        observation,
      );
    } catch {
      supportContext.activeReminderFailureRecorded = true;
      record(
        supportContext.activePhase,
        'failed',
        undefined,
        undefined,
        observation,
      );
      throw new Error('Public calendar feed lifecycle could not be confirmed');
    } finally {
      if (publicationCreated && dialog) {
        try {
          const unpublishButton = dialog.getByRole('button', {
            name: 'Unpublish',
            exact: true,
          });
          if (await unpublishButton.isVisible()) {
            const cleanupResponse = waitForPublicFeedPublicationResponse(
              page,
              'DELETE',
            );
            await unpublishButton.click();
            await cleanupResponse;
          }
        } catch {
          // The isolated Element stack is removed by the acceptance job.
        }
      }
    }
  }

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

  async function observeAcceptanceRuntime(
    page: Page,
    {
      gatewayUrl,
      homeserverUrl,
      widgetUrl,
    }: {
      gatewayUrl: string;
      homeserverUrl: string;
      widgetUrl: string;
    },
  ): Promise<AcceptanceRuntimeObservation> {
    const gatewayOrigin = new URL(gatewayUrl).origin;
    const homeserverOrigin = new URL(homeserverUrl).origin;
    const widgetOrigin = new URL(widgetUrl).origin;
    const observerArgs = {
      expectedElementOrigin: new URL(supportContext.fixture.elementUrl).origin,
      expectedWidgetOrigin: widgetOrigin,
      expectedGatewayOrigin: gatewayOrigin,
      expectedRoomId: supportContext.fixture.teamRoomId,
    };
    const installAcceptanceObserver = ({
      expectedElementOrigin,
      expectedWidgetOrigin,
      expectedGatewayOrigin,
      expectedRoomId,
    }: typeof observerArgs) => {
      type WidgetApiState =
        | 'none'
        | 'allowed'
        | 'request'
        | 'blocked'
        | 'other';
      type WidgetParameters = Record<string, string | undefined>;
      type WidgetApiMessage = {
        api?: unknown;
        action?: unknown;
        widgetId?: unknown;
        requestId?: unknown;
        response?: unknown;
        data?: unknown;
      };
      type RequestObservation = {
        count: number;
        sourceMatches: boolean;
        originMatches: boolean;
        widgetIdMatches: boolean;
      };
      type ChildObservation = {
        parametersObserved: boolean;
        gatewayBaseOriginMatches: boolean;
        roomIdMatches: boolean;
        widgetIdParameterPresent: boolean;
        initialResponseCount: number;
        initialResponseState: WidgetApiState;
        initialResponseSourceMatches: boolean;
        initialResponseOriginMatches: boolean;
        initialResponseWidgetIdMatches: boolean;
        followupCount: number;
        followupState: WidgetApiState;
        followupRequestIdMatches: boolean;
        followupSourceMatches: boolean;
        followupOriginMatches: boolean;
        followupWidgetIdMatches: boolean;
      };
      const readParameters = (
        search: string,
        hash: string,
      ): WidgetParameters => {
        const parse = (query: string): WidgetParameters => {
          const params = new URLSearchParams(query);
          const keys = new Set<string>();
          params.forEach((_value, key) => keys.add(key));
          const parsed: WidgetParameters = Object.create(
            null,
          ) as WidgetParameters;
          for (const key of keys) {
            const values = params.getAll(key);
            parsed[key] = values.length === 1 ? values[0] : undefined;
          }
          return parsed;
        };
        const hashQuery = hash.substring(hash.indexOf('?') + 1);
        return { ...parse(search), ...parse(hashQuery) };
      };
      const stateOf = (value: unknown): WidgetApiState =>
        value === 'allowed' || value === 'request' || value === 'blocked'
          ? value
          : 'other';
      const messageOf = (event: MessageEvent): WidgetApiMessage | undefined => {
        if (
          event.data === null ||
          typeof event.data !== 'object' ||
          Array.isArray(event.data)
        ) {
          return undefined;
        }
        return event.data as WidgetApiMessage;
      };
      const updateMatches = (
        observation: RequestObservation,
        matches: {
          source: boolean;
          origin: boolean;
          widgetId: boolean;
        },
      ) => {
        const first = observation.count === 0;
        observation.count = Math.min(observation.count + 1, 2);
        observation.sourceMatches = first
          ? matches.source
          : observation.sourceMatches && matches.source;
        observation.originMatches = first
          ? matches.origin
          : observation.originMatches && matches.origin;
        observation.widgetIdMatches = first
          ? matches.widgetId
          : observation.widgetIdMatches && matches.widgetId;
      };
      const runtimeWindow = window as Window & {
        __matrixCalendarAcceptanceErrors?: {
          count: number;
          lastClass: WidgetPageErrorClass;
        };
        __matrixCalendarAcceptanceWidgetApiParent?: RequestObservation;
        __matrixCalendarAcceptanceWidgetApiChild?: ChildObservation;
      };

      if (window.location.origin === expectedElementOrigin) {
        const requestObservation: RequestObservation = {
          count: 0,
          sourceMatches: false,
          originMatches: false,
          widgetIdMatches: false,
        };
        runtimeWindow.__matrixCalendarAcceptanceWidgetApiParent =
          requestObservation;
        window.addEventListener('message', (event) => {
          const message = messageOf(event);
          if (
            message?.api !== 'fromWidget' ||
            message.action !== 'get_openid' ||
            Object.hasOwn(message, 'response')
          ) {
            return;
          }

          let sourceMatches = false;
          let expectedWidgetId: string | undefined;
          for (const iframe of Array.from(
            document.querySelectorAll('iframe'),
          )) {
            if (iframe.contentWindow !== event.source) continue;
            try {
              const frameUrl = new URL(
                iframe.getAttribute('src') ?? '',
                document.baseURI,
              );
              const parameters = readParameters(frameUrl.search, frameUrl.hash);
              sourceMatches = frameUrl.origin === expectedWidgetOrigin;
              expectedWidgetId = parameters.widgetId;
            } catch {
              sourceMatches = false;
            }
            break;
          }
          updateMatches(requestObservation, {
            source: sourceMatches,
            origin: event.origin === expectedWidgetOrigin,
            widgetId:
              typeof expectedWidgetId === 'string' &&
              message.widgetId === expectedWidgetId,
          });
        });
      }

      if (window.location.origin === expectedWidgetOrigin) {
        const { expectedWidgetId, childObservation } = (() => {
          const parsedParameters = readParameters(
            window.location.search,
            window.location.hash,
          );
          let gatewayBaseOriginMatches = false;
          if (typeof parsedParameters.meetings_bot_base_url === 'string') {
            try {
              gatewayBaseOriginMatches =
                new URL(parsedParameters.meetings_bot_base_url).origin ===
                expectedGatewayOrigin;
            } catch {
              gatewayBaseOriginMatches = false;
            }
          }
          const expectedWidgetId =
            typeof parsedParameters.widgetId === 'string'
              ? parsedParameters.widgetId
              : undefined;
          const childObservation: ChildObservation = {
            parametersObserved: true,
            gatewayBaseOriginMatches,
            roomIdMatches: parsedParameters.matrix_room_id === expectedRoomId,
            widgetIdParameterPresent:
              typeof expectedWidgetId === 'string' &&
              expectedWidgetId.length > 0,
            initialResponseCount: 0,
            initialResponseState: 'none',
            initialResponseSourceMatches: false,
            initialResponseOriginMatches: false,
            initialResponseWidgetIdMatches: false,
            followupCount: 0,
            followupState: 'none',
            followupRequestIdMatches: false,
            followupSourceMatches: false,
            followupOriginMatches: false,
            followupWidgetIdMatches: false,
          };
          return { expectedWidgetId, childObservation };
        })();
        let initialRequestId: string | undefined;
        runtimeWindow.__matrixCalendarAcceptanceWidgetApiChild =
          childObservation;
        window.addEventListener('message', (event) => {
          const message = messageOf(event);
          if (!message) return;
          const commonMatches = {
            source: event.source === window.parent,
            origin: event.origin === expectedElementOrigin,
            widgetId:
              typeof expectedWidgetId === 'string' &&
              message.widgetId === expectedWidgetId,
          };

          if (
            message.api === 'fromWidget' &&
            message.action === 'get_openid' &&
            Object.hasOwn(message, 'response') &&
            message.response !== null &&
            typeof message.response === 'object' &&
            !Array.isArray(message.response)
          ) {
            const first = childObservation.initialResponseCount === 0;
            childObservation.initialResponseCount = Math.min(
              childObservation.initialResponseCount + 1,
              2,
            );
            const response = message.response as { state?: unknown };
            childObservation.initialResponseState = stateOf(response.state);
            childObservation.initialResponseSourceMatches = first
              ? commonMatches.source
              : childObservation.initialResponseSourceMatches &&
                commonMatches.source;
            childObservation.initialResponseOriginMatches = first
              ? commonMatches.origin
              : childObservation.initialResponseOriginMatches &&
                commonMatches.origin;
            childObservation.initialResponseWidgetIdMatches = first
              ? commonMatches.widgetId
              : childObservation.initialResponseWidgetIdMatches &&
                commonMatches.widgetId;
            initialRequestId =
              commonMatches.source &&
              commonMatches.origin &&
              commonMatches.widgetId &&
              typeof message.requestId === 'string'
                ? message.requestId
                : undefined;
            return;
          }

          if (
            message.api !== 'toWidget' ||
            message.action !== 'openid_credentials' ||
            Object.hasOwn(message, 'response') ||
            message.data === null ||
            typeof message.data !== 'object' ||
            Array.isArray(message.data)
          ) {
            return;
          }
          const first = childObservation.followupCount === 0;
          childObservation.followupCount = Math.min(
            childObservation.followupCount + 1,
            2,
          );
          const data = message.data as {
            state?: unknown;
            original_request_id?: unknown;
          };
          childObservation.followupState = stateOf(data.state);
          const requestIdMatches =
            typeof initialRequestId === 'string' &&
            typeof data.original_request_id === 'string' &&
            data.original_request_id === initialRequestId;
          childObservation.followupRequestIdMatches = first
            ? requestIdMatches
            : childObservation.followupRequestIdMatches && requestIdMatches;
          childObservation.followupSourceMatches = first
            ? commonMatches.source
            : childObservation.followupSourceMatches && commonMatches.source;
          childObservation.followupOriginMatches = first
            ? commonMatches.origin
            : childObservation.followupOriginMatches && commonMatches.origin;
          childObservation.followupWidgetIdMatches = first
            ? commonMatches.widgetId
            : childObservation.followupWidgetIdMatches &&
              commonMatches.widgetId;
        });

        const knownErrorClasses = [
          'Error',
          'TypeError',
          'ReferenceError',
          'SyntaxError',
          'RangeError',
          'URIError',
          'EvalError',
          'AggregateError',
        ];
        const errorState = {
          count: 0,
          lastClass: 'NONE' as WidgetPageErrorClass,
        };
        runtimeWindow.__matrixCalendarAcceptanceErrors = errorState;
        const recordPageError = (reason: unknown) => {
          errorState.count = Math.min(errorState.count + 1, 2);
          const name = reason instanceof Error ? reason.name : 'OTHER';
          errorState.lastClass = knownErrorClasses.includes(name)
            ? (name as WidgetPageErrorClass)
            : 'OTHER';
        };
        window.addEventListener('error', (event) => {
          if (event instanceof ErrorEvent) recordPageError(event.error);
        });
        window.addEventListener('unhandledrejection', (event) => {
          recordPageError(event.reason);
        });
      }
    };
    await page.context().addInitScript(installAcceptanceObserver, observerArgs);
    await page.evaluate(installAcceptanceObserver, observerArgs);

    const observation: AcceptanceRuntimeObservation = {
      requestCounts: {
        context: 0,
        calendars: 0,
        events: 0,
        'other-calendar': 0,
        'other-api': 0,
      },
      optionsRequestCount: 0,
      failedRequestCount: 0,
      lastRequestEndpoint: 'none',
      lastRequestMethod: 'NONE',
      lastResponseEndpoint: 'none',
      lastResponseMethod: 'NONE',
      iframeObservationAvailable: false,
      iframeGatewayBaseOriginMatches: false,
      iframeRoomIdMatches: false,
      createEventVisible: false,
      identityContinueVisible: false,
      widgetResourceRequestCounts: {
        document: 0,
        script: 0,
        stylesheet: 0,
      },
      widgetResourceFailureCounts: {
        document: 0,
        script: 0,
        stylesheet: 0,
      },
      widgetResourceLastStatuses: {},
      openIdRequestCount: 0,
      openIdOptionsRequestCount: 0,
      openIdFailedRequestCount: 0,
      openIdLastRequestMethod: 'NONE',
      widgetFrameAvailable: false,
      widgetDocumentReadyState: 'unavailable',
      widgetRootHasChildren: false,
      widgetLoadingVisible: false,
      widgetMissingCapabilitiesVisible: false,
      widgetRegistrationErrorVisible: false,
      widgetOutsideClientVisible: false,
      widgetChildErrorVisible: false,
      widgetPageErrorCount: 0,
      widgetLastPageErrorClass: 'NONE',
      widgetApiParentObserverAvailable: false,
      widgetApiGetOpenIdRequestCount: 0,
      widgetApiRequestSourceMatches: false,
      widgetApiRequestOriginMatches: false,
      widgetApiRequestWidgetIdMatches: false,
      widgetApiInitialResponseCount: 0,
      widgetApiInitialResponseState: 'none',
      widgetApiInitialResponseSourceMatches: false,
      widgetApiInitialResponseOriginMatches: false,
      widgetApiInitialResponseWidgetIdMatches: false,
      widgetApiFollowupCount: 0,
      widgetApiFollowupState: 'none',
      widgetApiFollowupRequestIdMatches: false,
      widgetApiFollowupSourceMatches: false,
      widgetApiFollowupOriginMatches: false,
      widgetApiFollowupWidgetIdMatches: false,
      widgetParametersObserved: false,
      widgetGatewayBaseOriginMatches: false,
      widgetRoomIdMatches: false,
      widgetIdParameterPresent: false,
      calendarEventsLoadingVisible: false,
      calendarEventsLoadErrorVisible: false,
      createEventEnabled: false,
    };

    page.on('request', (request) => {
      const requestDetails = classifyGatewayRequest(
        request.url(),
        request.method(),
        gatewayOrigin,
      );
      if (requestDetails) {
        observation.requestCounts[requestDetails.endpoint] = Math.min(
          observation.requestCounts[requestDetails.endpoint] + 1,
          2,
        );
        observation.lastRequestEndpoint = requestDetails.endpoint;
        observation.lastRequestMethod = requestDetails.method;
        if (requestDetails.method === 'OPTIONS') {
          observation.optionsRequestCount = Math.min(
            observation.optionsRequestCount + 1,
            2,
          );
        }
      }

      const widgetResource = classifyWidgetResource(
        request.url(),
        request.resourceType(),
        widgetOrigin,
      );
      if (widgetResource) {
        observation.widgetResourceRequestCounts[widgetResource] = Math.min(
          observation.widgetResourceRequestCounts[widgetResource] + 1,
          2,
        );
      }

      if (isOpenIdRequest(request.url(), homeserverOrigin)) {
        observation.openIdRequestCount = Math.min(
          observation.openIdRequestCount + 1,
          2,
        );
        observation.openIdLastRequestMethod = classifyGatewayMethod(
          request.method(),
        );
        if (observation.openIdLastRequestMethod === 'OPTIONS') {
          observation.openIdOptionsRequestCount = Math.min(
            observation.openIdOptionsRequestCount + 1,
            2,
          );
        }
      }
    });

    page.on('requestfailed', (request) => {
      const requestDetails = classifyGatewayRequest(
        request.url(),
        request.method(),
        gatewayOrigin,
      );
      if (requestDetails) {
        observation.failedRequestCount = Math.min(
          observation.failedRequestCount + 1,
          2,
        );
      }

      const widgetResource = classifyWidgetResource(
        request.url(),
        request.resourceType(),
        widgetOrigin,
      );
      if (widgetResource) {
        observation.widgetResourceFailureCounts[widgetResource] = Math.min(
          observation.widgetResourceFailureCounts[widgetResource] + 1,
          2,
        );
      }

      if (isOpenIdRequest(request.url(), homeserverOrigin)) {
        observation.openIdFailedRequestCount = Math.min(
          observation.openIdFailedRequestCount + 1,
          2,
        );
      }
    });

    page.on('response', (response) => {
      const responseDetails = classifyGatewayRequest(
        response.url(),
        response.request().method(),
        gatewayOrigin,
      );
      if (responseDetails) {
        observation.lastResponseEndpoint = responseDetails.endpoint;
        observation.lastResponseMethod = responseDetails.method;
        observation.lastResponseStatus = response.status();
      }

      const widgetResource = classifyWidgetResource(
        response.url(),
        response.request().resourceType(),
        widgetOrigin,
      );
      if (widgetResource) {
        observation.widgetResourceLastStatuses[widgetResource] =
          response.status();
        if (response.status() >= 400) {
          observation.widgetResourceFailureCounts[widgetResource] = Math.min(
            observation.widgetResourceFailureCounts[widgetResource] + 1,
            2,
          );
        }
      }

      if (isOpenIdRequest(response.url(), homeserverOrigin)) {
        observation.openIdLastResponseStatus = response.status();
      }
    });

    return observation;
  }

  async function recordWidgetRuntimeObservation(
    page: Page,
    frame: ReturnType<ElementWebPage['widgetByTitle']>,
    observation: AcceptanceRuntimeObservation | undefined,
  ) {
    if (!observation) return;

    try {
      const iframeParameters = await page
        .locator('iframe[title="Matrix Calendar"]')
        .evaluate(
          (iframe, { expectedGatewayOrigin, expectedRoomId }) => {
            const source = iframe.getAttribute('src') ?? '';
            const widgetUrl = new URL(source, window.location.href);
            const parse = (query: string) => {
              const params = new URLSearchParams(query);
              const keys = new Set<string>();
              params.forEach((_value, key) => keys.add(key));
              const parsed: Record<string, string | undefined> = Object.create(
                null,
              ) as Record<string, string | undefined>;
              for (const key of keys) {
                const values = params.getAll(key);
                parsed[key] = values.length === 1 ? values[0] : undefined;
              }
              return parsed;
            };
            const hashQuery = widgetUrl.hash.substring(
              widgetUrl.hash.indexOf('?') + 1,
            );
            const parameters = {
              ...parse(widgetUrl.search),
              ...parse(hashQuery),
            };
            let gatewayOriginMatches = false;
            if (typeof parameters.meetings_bot_base_url === 'string') {
              try {
                gatewayOriginMatches =
                  new URL(parameters.meetings_bot_base_url).origin ===
                  expectedGatewayOrigin;
              } catch {
                gatewayOriginMatches = false;
              }
            }
            return {
              gatewayOriginMatches,
              roomIdMatches: parameters.matrix_room_id === expectedRoomId,
            };
          },
          {
            expectedGatewayOrigin: new URL(supportContext.fixture.gatewayUrl)
              .origin,
            expectedRoomId: supportContext.fixture.teamRoomId,
          },
        );
      observation.iframeObservationAvailable = true;
      observation.iframeGatewayBaseOriginMatches =
        iframeParameters.gatewayOriginMatches;
      observation.iframeRoomIdMatches = iframeParameters.roomIdMatches;
    } catch {
      // The raw iframe URL and any navigation error stay out of the evidence.
    }

    const widgetOrigin = new URL(supportContext.fixture.widgetUrl).origin;
    const widgetFrame = page.frames().find((candidate) => {
      if (candidate === page.mainFrame()) return false;
      try {
        return new URL(candidate.url()).origin === widgetOrigin;
      } catch {
        return false;
      }
    });
    if (widgetFrame) {
      try {
        const documentObservation = await widgetFrame.evaluate(() => {
          const runtimeWindow = window as Window & {
            __matrixCalendarAcceptanceErrors?: {
              count: number;
              lastClass: WidgetPageErrorClass;
            };
            __matrixCalendarAcceptanceWidgetApiChild?: {
              parametersObserved: boolean;
              gatewayBaseOriginMatches: boolean;
              roomIdMatches: boolean;
              widgetIdParameterPresent: boolean;
              initialResponseCount: number;
              initialResponseState: OpenIdProtocolState;
              initialResponseSourceMatches: boolean;
              initialResponseOriginMatches: boolean;
              initialResponseWidgetIdMatches: boolean;
              followupCount: number;
              followupState: OpenIdProtocolState;
              followupRequestIdMatches: boolean;
              followupSourceMatches: boolean;
              followupOriginMatches: boolean;
              followupWidgetIdMatches: boolean;
            };
          };
          const errors = runtimeWindow.__matrixCalendarAcceptanceErrors;
          const widgetApi =
            runtimeWindow.__matrixCalendarAcceptanceWidgetApiChild;
          const readyState = document.readyState;
          const visible = (element: Element | null) => {
            if (!element) return false;
            const style = window.getComputedStyle(element);
            return (
              style.display !== 'none' &&
              style.visibility !== 'hidden' &&
              element.getClientRects().length > 0
            );
          };
          const alertMarkerVisible = (marker: string) =>
            Array.from(document.querySelectorAll('[role="alert"]')).some(
              (alert) => alert.textContent?.includes(marker) && visible(alert),
            );
          const createEventButton = Array.from(
            document.querySelectorAll('button'),
          ).find((button) => button.textContent?.trim() === 'Create event');
          const calendarToolbarPresent = Boolean(createEventButton);
          const calendarEventsLoadingVisible =
            calendarToolbarPresent &&
            Array.from(document.querySelectorAll('[role="progressbar"]')).some(
              (progress) => visible(progress),
            );
          const widgetDocumentReadyState: WidgetDocumentReadyState =
            readyState === 'loading' ||
            readyState === 'interactive' ||
            readyState === 'complete'
              ? readyState
              : 'unavailable';
          return {
            documentReadyState: widgetDocumentReadyState,
            rootHasChildren:
              (document.getElementById('root')?.childElementCount ?? 0) > 0,
            loadingVisible: visible(
              document.querySelector('[role="progressbar"]'),
            ),
            missingCapabilitiesVisible: alertMarkerVisible(
              'Missing capabilities',
            ),
            registrationErrorVisible: alertMarkerVisible(
              'Wrong widget registration',
            ),
            outsideClientVisible: alertMarkerVisible('Only runs as a widget'),
            childErrorVisible: alertMarkerVisible(
              'An error occured inside the widget.',
            ),
            calendarEventsLoadingVisible,
            calendarEventsLoadErrorVisible: alertMarkerVisible(
              'Calendar events could not be loaded.',
            ),
            createEventEnabled: Boolean(
              createEventButton &&
              !createEventButton.hasAttribute('disabled') &&
              createEventButton.getAttribute('aria-disabled') !== 'true',
            ),
            pageErrorCount: Math.min(errors?.count ?? 0, 2),
            lastPageErrorClass: errors?.lastClass ?? 'NONE',
            widgetApi: widgetApi
              ? {
                  parametersObserved: widgetApi.parametersObserved,
                  gatewayBaseOriginMatches: widgetApi.gatewayBaseOriginMatches,
                  roomIdMatches: widgetApi.roomIdMatches,
                  widgetIdParameterPresent: widgetApi.widgetIdParameterPresent,
                  initialResponseCount: widgetApi.initialResponseCount,
                  initialResponseState: widgetApi.initialResponseState,
                  initialResponseSourceMatches:
                    widgetApi.initialResponseSourceMatches,
                  initialResponseOriginMatches:
                    widgetApi.initialResponseOriginMatches,
                  initialResponseWidgetIdMatches:
                    widgetApi.initialResponseWidgetIdMatches,
                  followupCount: widgetApi.followupCount,
                  followupState: widgetApi.followupState,
                  followupRequestIdMatches: widgetApi.followupRequestIdMatches,
                  followupSourceMatches: widgetApi.followupSourceMatches,
                  followupOriginMatches: widgetApi.followupOriginMatches,
                  followupWidgetIdMatches: widgetApi.followupWidgetIdMatches,
                }
              : undefined,
          };
        });
        observation.widgetFrameAvailable = true;
        observation.widgetDocumentReadyState =
          documentObservation.documentReadyState;
        observation.widgetRootHasChildren = documentObservation.rootHasChildren;
        observation.widgetLoadingVisible = documentObservation.loadingVisible;
        observation.widgetMissingCapabilitiesVisible =
          documentObservation.missingCapabilitiesVisible;
        observation.widgetRegistrationErrorVisible =
          documentObservation.registrationErrorVisible;
        observation.widgetOutsideClientVisible =
          documentObservation.outsideClientVisible;
        observation.widgetChildErrorVisible =
          documentObservation.childErrorVisible;
        observation.widgetPageErrorCount = documentObservation.pageErrorCount;
        observation.widgetLastPageErrorClass =
          documentObservation.lastPageErrorClass;
        observation.calendarEventsLoadingVisible =
          documentObservation.calendarEventsLoadingVisible;
        observation.calendarEventsLoadErrorVisible =
          documentObservation.calendarEventsLoadErrorVisible;
        observation.createEventEnabled = documentObservation.createEventEnabled;
        if (documentObservation.widgetApi) {
          observation.widgetParametersObserved =
            documentObservation.widgetApi.parametersObserved;
          observation.widgetGatewayBaseOriginMatches =
            documentObservation.widgetApi.gatewayBaseOriginMatches;
          observation.widgetRoomIdMatches =
            documentObservation.widgetApi.roomIdMatches;
          observation.widgetIdParameterPresent =
            documentObservation.widgetApi.widgetIdParameterPresent;
          observation.widgetApiInitialResponseCount =
            documentObservation.widgetApi.initialResponseCount;
          observation.widgetApiInitialResponseState =
            documentObservation.widgetApi.initialResponseState;
          observation.widgetApiInitialResponseSourceMatches =
            documentObservation.widgetApi.initialResponseSourceMatches;
          observation.widgetApiInitialResponseOriginMatches =
            documentObservation.widgetApi.initialResponseOriginMatches;
          observation.widgetApiInitialResponseWidgetIdMatches =
            documentObservation.widgetApi.initialResponseWidgetIdMatches;
          observation.widgetApiFollowupCount =
            documentObservation.widgetApi.followupCount;
          observation.widgetApiFollowupState =
            documentObservation.widgetApi.followupState;
          observation.widgetApiFollowupRequestIdMatches =
            documentObservation.widgetApi.followupRequestIdMatches;
          observation.widgetApiFollowupSourceMatches =
            documentObservation.widgetApi.followupSourceMatches;
          observation.widgetApiFollowupOriginMatches =
            documentObservation.widgetApi.followupOriginMatches;
          observation.widgetApiFollowupWidgetIdMatches =
            documentObservation.widgetApi.followupWidgetIdMatches;
        }
      } catch {
        // Keep a failed frame read as unavailable without retaining its error.
      }
    }

    try {
      const parentObservation = await page.evaluate(() => {
        const runtimeWindow = window as Window & {
          __matrixCalendarAcceptanceWidgetApiParent?: {
            count: number;
            sourceMatches: boolean;
            originMatches: boolean;
            widgetIdMatches: boolean;
          };
        };
        const request = runtimeWindow.__matrixCalendarAcceptanceWidgetApiParent;
        return request
          ? {
              available: true,
              count: request.count,
              sourceMatches: request.sourceMatches,
              originMatches: request.originMatches,
              widgetIdMatches: request.widgetIdMatches,
            }
          : undefined;
      });
      if (parentObservation) {
        observation.widgetApiParentObserverAvailable =
          parentObservation.available;
        observation.widgetApiGetOpenIdRequestCount = parentObservation.count;
        observation.widgetApiRequestSourceMatches =
          parentObservation.sourceMatches;
        observation.widgetApiRequestOriginMatches =
          parentObservation.originMatches;
        observation.widgetApiRequestWidgetIdMatches =
          parentObservation.widgetIdMatches;
      }
    } catch {
      // Keep a failed parent-window read as unavailable without retaining its error.
    }

    const [createEventVisible, createEventEnabled, identityContinueVisible] =
      await Promise.all([
        frame
          .getByRole('button', { name: 'Create event', exact: true })
          .isVisible()
          .catch(() => false),
        frame
          .getByRole('button', { name: 'Create event', exact: true })
          .isEnabled()
          .catch(() => false),
        page
          .getByRole('dialog')
          .getByRole('button', { name: 'Continue', exact: true })
          .first()
          .isVisible()
          .catch(() => false),
      ]);
    observation.createEventVisible = createEventVisible;
    observation.createEventEnabled = createEventEnabled;
    observation.identityContinueVisible = identityContinueVisible;

    appendRuntimeObservation(observation);
  }

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
