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
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test';
import {
  ROOM_READINESS_SAMPLE_TIMEOUT_MS,
  collectRoomReadinessTimeline,
  createRoomNavigationReadinessObservation,
  unavailableRoomReadinessTimeline,
  type RoomReadinessSnapshot,
  type RoomReadinessTimeline,
} from '../../dev/element-room-context-observation.mjs';
import type {
  HomeserverHttpFailures,
  Phase,
  RoomRenderStateObservation,
} from './elementAcceptanceSupportTypes';
import type {
  Fixture,
  MatrixChatPageTypeBucket,
  MatrixChatViewBucket,
  MatrixSyncState,
  MemberARoomFailureCode,
  MemberARoomObservation,
  MemberARoomResult,
  OuterRenderBucket,
  User,
} from './elementAcceptanceTypes';
import { ElementWebPage } from './pages/elementWebPage';

export function createElementNavigationHelpers(
  supportContext: {
    fixture: Fixture;
    activePhase: Phase;
    memberRoomHomeserverHttpFailures: WeakMap<Page, HomeserverHttpFailures>;
    blockedExternalRequestsByContext: WeakMap<
      BrowserContext,
      { count: number }
    >;
    memberABlockedExternalRequests: WeakMap<Page, { count: number }>;
  },
  record: (
    phase: Phase,
    status: 'started' | 'passed' | 'failed',
    httpStatus?: number,
    count?: number,
    extra?: { originMatchesElement?: boolean },
  ) => void,
  recordMemberASessionObservation: (
    observation:
      | {
          matrixClientHookPresent: boolean;
          matrixClientPresent: boolean;
          matrixUserMatches: boolean;
          matrixSyncState: MatrixSyncState;
        }
      | undefined,
  ) => void,
) {
  async function authenticateInElement(
    context: BrowserContext,
    user: User,
    captureMemberADiagnostics = false,
    captureHomeserverHttpErrors = captureMemberADiagnostics,
  ): Promise<Page> {
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    page.setDefaultNavigationTimeout(30_000);
    if (captureHomeserverHttpErrors) {
      const homeserverOrigin = new URL(supportContext.fixture.homeserverUrl)
        .origin;
      const homeserverHttpFailures: HomeserverHttpFailures = { count: 0 };
      supportContext.memberRoomHomeserverHttpFailures.set(
        page,
        homeserverHttpFailures,
      );
      page.on('response', (response) => {
        try {
          if (
            new URL(response.url()).origin === homeserverOrigin &&
            response.status() >= 400
          ) {
            homeserverHttpFailures.count = Math.min(
              homeserverHttpFailures.count + 1,
              100_000,
            );
            homeserverHttpFailures.lastStatus = response.status();
          }
        } catch {
          // Keep only the bounded count/status below; never retain request data.
        }
      });
    }
    if (captureMemberADiagnostics) {
      const contextBlockedRequests =
        supportContext.blockedExternalRequestsByContext.get(context);
      if (contextBlockedRequests) {
        supportContext.memberABlockedExternalRequests.set(
          page,
          contextBlockedRequests,
        );
      }
      supportContext.activePhase = 'member-a-origin-navigation';
    }
    const originResponse = await page.goto(
      new URL('/welcome/images/logo.svg', supportContext.fixture.elementUrl)
        .href,
    );
    if (captureMemberADiagnostics) {
      const originMatchesElement =
        new URL(page.url()).origin ===
        new URL(supportContext.fixture.elementUrl).origin;
      record(
        supportContext.activePhase,
        'passed',
        originResponse?.status(),
        undefined,
        {
          originMatchesElement,
        },
      );
      supportContext.activePhase = 'member-a-credentials-seeded';
    }

    await page.evaluate(
      ({ homeserverUrl, credentials }) => {
        window.localStorage.setItem('mx_hs_url', homeserverUrl);
        window.localStorage.setItem('mx_user_id', credentials.userId);
        window.localStorage.setItem('mx_access_token', credentials.accessToken);
        window.localStorage.setItem('mx_device_id', credentials.deviceId);
        window.localStorage.setItem('mx_is_guest', 'false');
        window.localStorage.setItem('mx_has_pickle_key', 'false');
        window.localStorage.setItem('mx_has_access_token', 'true');
        window.localStorage.setItem(
          'mx_local_settings',
          JSON.stringify({
            analyticsOptIn: false,
            showCookieBar: false,
            language: 'en',
            theme: 'light',
          }),
        );
        window.localStorage.setItem('notifications_hidden', 'true');
        window.localStorage.setItem('audio_notifications_enabled', 'false');
      },
      {
        homeserverUrl: supportContext.fixture.homeserverUrl,
        credentials: user,
      },
    );
    if (captureMemberADiagnostics) {
      record(supportContext.activePhase, 'passed');
      supportContext.activePhase = 'member-a-root-navigation';
    }

    const rootResponse = await page.goto(supportContext.fixture.elementUrl);
    if (captureMemberADiagnostics) {
      record(supportContext.activePhase, 'passed', rootResponse?.status());
      supportContext.activePhase = 'member-a-session-observed';
    }

    const sessionReady = await page
      .waitForFunction(
        (expectedUserId) => {
          type MatrixClient = { getUserId?: () => string | null };
          type MatrixClientPeg = { get?: () => MatrixClient | undefined };
          try {
            const matrixClientPeg = (
              window as unknown as {
                mxMatrixClientPeg?: MatrixClientPeg;
              }
            ).mxMatrixClientPeg;
            const matrixClient = matrixClientPeg?.get?.();
            return matrixClient?.getUserId?.() === expectedUserId;
          } catch {
            return false;
          }
        },
        user.userId,
        { timeout: 30_000 },
      )
      .then(() => true)
      .catch(() => false);

    if (captureMemberADiagnostics) {
      const sessionObservation = await page
        .evaluate((expectedUserId) => {
          type MatrixClient = {
            getUserId?: () => string | null;
            getSyncState?: () => string | null;
          };
          type MatrixClientPeg = { get?: () => MatrixClient | undefined };
          let matrixClientPeg: MatrixClientPeg | undefined;
          let matrixClient: MatrixClient | undefined;
          try {
            matrixClientPeg = (
              window as unknown as {
                mxMatrixClientPeg?: MatrixClientPeg;
              }
            ).mxMatrixClientPeg;
            matrixClient = matrixClientPeg?.get?.();
          } catch {
            // Report only the bounded state below; never return exception text.
          }
          const knownSyncStates = new Set([
            'ERROR',
            'PREPARED',
            'RECONNECTING',
            'STOPPED',
            'SYNCING',
            'CATCHUP',
          ]);
          let matrixUserMatches = false;
          let matrixSyncState: MatrixSyncState = 'UNKNOWN';
          try {
            matrixUserMatches = matrixClient?.getUserId?.() === expectedUserId;
          } catch {
            // Report only bounded booleans and known sync states.
          }
          try {
            const rawSyncState = matrixClient?.getSyncState?.();
            if (
              typeof rawSyncState === 'string' &&
              knownSyncStates.has(rawSyncState)
            ) {
              matrixSyncState = rawSyncState as MatrixSyncState;
            }
          } catch {
            // Report only bounded booleans and known sync states.
          }
          return {
            matrixClientHookPresent: Boolean(matrixClientPeg),
            matrixClientPresent: Boolean(matrixClient),
            matrixUserMatches,
            matrixSyncState,
          };
        }, user.userId)
        .catch(() => undefined);
      recordMemberASessionObservation(sessionObservation);
      supportContext.activePhase = 'member-a-authenticated';
    }

    if (!sessionReady) {
      throw new Error('Element session did not restore the expected user');
    }
    return page;
  }

  async function openFixtureRoom(
    page: Page,
    roomName: string,
    roomId: string,
  ): Promise<ElementWebPage> {
    const roomUrl = new URL(supportContext.fixture.elementUrl);
    roomUrl.hash = `/room/${roomId}`;
    await page.goto(roomUrl.href);

    const element = new ElementWebPage(page);
    await expect(getPinnedElementRoomNameHeading(page)).toHaveText(roomName);
    expect(element.getCurrentRoomId()).toBe(roomId);
    return element;
  }

  function getPinnedElementRoomNameHeading(page: Page): Locator {
    return page.locator('header.mx_RoomHeader').getByRole('heading');
  }

  async function openMemberARoomWithDiagnostics(
    page: Page,
    roomName: string,
    roomId: string,
    expectedUserId: string,
    options: {
      captureReminderRoomLayout?: boolean;
      captureRoomReadinessTimeline?: boolean;
      useNormalRoomSelection?: boolean;
      blockedExternalRequests?: { count: number };
    } = {},
  ): Promise<MemberARoomResult> {
    const element = new ElementWebPage(page);
    const beforeNavigation = options.captureRoomReadinessTimeline
      ? await observeMemberARoomReadinessSnapshot(page, roomId).catch(
          () => undefined,
        )
      : undefined;
    let navigationCompleted = false;
    let afterRoute: RoomReadinessSnapshot | undefined;
    try {
      if (options.useNormalRoomSelection) {
        await element.navigateToRoomOrInvitation(roomName);
      } else {
        const roomUrl = new URL(supportContext.fixture.elementUrl);
        roomUrl.hash = `/room/${roomId}`;
        await page.goto(roomUrl.href, { timeout: 20_000 });
      }
      navigationCompleted = true;
      if (options.captureRoomReadinessTimeline) {
        afterRoute = await observeMemberARoomReadinessSnapshot(
          page,
          roomId,
        ).catch(() => undefined);
      }
    } catch {
      // The failure summary records only whether this bounded navigation ended.
    }

    const roomNameHeading = getPinnedElementRoomNameHeading(page);
    let roomHeadingReady = false;
    const timelineController = options.captureRoomReadinessTimeline
      ? new AbortController()
      : undefined;
    let timelinePromise: Promise<RoomReadinessTimeline> | undefined;
    if (navigationCompleted) {
      if (timelineController) {
        timelinePromise = collectRoomReadinessTimeline({
          signal: timelineController.signal,
          observe: () => observeMemberARoomReadinessSnapshot(page, roomId),
        }).catch(() => unavailableRoomReadinessTimeline('unavailable'));
      }
      try {
        await roomNameHeading.waitFor({
          state: 'visible',
          timeout: 15_000,
        });
        const headingText = await roomNameHeading.textContent({
          timeout: 1_000,
        });
        roomHeadingReady = headingText?.trim() === roomName;
      } catch {
        // The post-wait observation records only fixed booleans.
      } finally {
        timelineController?.abort();
      }
    }

    const roomReadinessTimeline = options.captureRoomReadinessTimeline
      ? ((await timelinePromise) ??
        unavailableRoomReadinessTimeline('not-started'))
      : undefined;

    const observation = await observeMemberARoom(
      page,
      element,
      roomName,
      roomId,
      expectedUserId,
      navigationCompleted,
      roomHeadingReady,
      options.captureReminderRoomLayout ?? false,
      options.blockedExternalRequests,
    ).catch(() => undefined);
    return {
      element,
      navigationCompleted,
      observation,
      roomReadinessTimeline,
      ...(options.captureRoomReadinessTimeline
        ? {
            roomNavigationReadiness: createRoomNavigationReadinessObservation(
              beforeNavigation,
              afterRoute,
            ),
          }
        : {}),
      failureCode: getMemberARoomFailureCode(navigationCompleted, observation),
    };
  }

  async function observeMemberARoomReadinessSnapshot(
    page: Page,
    expectedRoomId: string,
  ): Promise<RoomReadinessSnapshot> {
    return page.locator('body').evaluate(
      (body, expectedRoomId): RoomReadinessSnapshot => {
        const knownSyncStates = new Set([
          'ERROR',
          'PREPARED',
          'RECONNECTING',
          'STOPPED',
          'SYNCING',
          'CATCHUP',
        ]);
        let currentRoomMatches: boolean | null = null;
        let matrixSyncState: RoomReadinessSnapshot['matrixSyncState'] =
          'UNKNOWN';
        let matrixChatFirstSyncComplete: boolean | null = null;
        let matrixChatReady: boolean | null = null;
        let matrixChatPageTypeBucket: MatrixChatPageTypeBucket = 'unavailable';
        try {
          const matrixChat = (
            window as Window & {
              matrixChat?: { firstSyncComplete?: unknown; state?: unknown };
            }
          ).matrixChat;
          matrixChatFirstSyncComplete =
            typeof matrixChat?.firstSyncComplete === 'boolean'
              ? matrixChat.firstSyncComplete
              : null;
          const state = matrixChat?.state;
          if (state !== null && typeof state === 'object') {
            const matrixChatState = state as {
              ready?: unknown;
              page_type?: unknown;
              currentRoomId?: unknown;
            };
            matrixChatReady =
              typeof matrixChatState.ready === 'boolean'
                ? matrixChatState.ready
                : null;
            matrixChatPageTypeBucket =
              matrixChatState.page_type === undefined ||
              matrixChatState.page_type === null
                ? 'missing'
                : typeof matrixChatState.page_type === 'string'
                  ? matrixChatState.page_type === 'room_view'
                    ? 'room-view'
                    : 'other-page'
                  : 'unavailable';
            const currentRoomId = matrixChatState.currentRoomId;
            if (typeof currentRoomId === 'string' || currentRoomId === null) {
              currentRoomMatches = currentRoomId === expectedRoomId;
            }
          }
        } catch {
          // Preserve only the room equality result.
        }
        try {
          const matrixClient = (
            window as Window & {
              mxMatrixClientPeg?: {
                get?: () => { getSyncState?: () => unknown };
              };
            }
          ).mxMatrixClientPeg?.get?.();
          const syncState = matrixClient?.getSyncState?.();
          if (typeof syncState === 'string' && knownSyncStates.has(syncState)) {
            matrixSyncState =
              syncState as RoomReadinessSnapshot['matrixSyncState'];
          }
        } catch {
          // Keep unknown sync state when Element exposes no safe enum.
        }
        const document = body.ownerDocument;
        const roomHeader = document.querySelector('header.mx_RoomHeader');
        return {
          roomViewPresent: document.querySelector('.mx_RoomView') !== null,
          roomHeaderPresent: roomHeader !== null,
          roomHeadingPresent:
            roomHeader !== null &&
            roomHeader.querySelector('[role="heading"]') !== null,
          currentRoomMatches,
          matrixSyncState,
          matrixChatFirstSyncComplete,
          matrixChatReady,
          matrixChatPageTypeBucket,
        };
      },
      expectedRoomId,
      { timeout: ROOM_READINESS_SAMPLE_TIMEOUT_MS },
    );
  }

  function unavailableRoomRenderState(): RoomRenderStateObservation {
    return {
      outerRenderBucket: 'unavailable',
      matrixChatShellPresent: null,
      roomViewWrapperPresent: null,
      roomViewRendererPresent: null,
      matrixChatStateAvailable: false,
      matrixChatViewBucket: 'unavailable',
      matrixChatFirstSyncComplete: null,
      matrixChatReady: null,
      matrixChatPageTypeBucket: 'unavailable',
      matrixChatCurrentRoomMatches: null,
      roomRenderStateAvailable: false,
      roomViewShellVisible: null,
      roomViewBodyVisible: null,
      roomPreviewVisible: null,
      roomPreviewLoadingVisible: null,
      roomHeaderVisible: null,
      roomHeaderHeadingVisible: null,
      roomErrorBoundaryVisible: null,
    };
  }

  async function observeRoomRenderState(
    page: Page,
    expectedRoomId: string,
  ): Promise<RoomRenderStateObservation> {
    return page.evaluate((expectedRoomId) => {
      type MatrixChatState = {
        view?: unknown;
        ready?: unknown;
        page_type?: unknown;
        currentRoomId?: unknown;
      };
      let matrixChatState: MatrixChatState | undefined;
      let matrixChatFirstSyncComplete: boolean | null = null;
      try {
        const matrixChat = (
          window as Window & {
            matrixChat?: { firstSyncComplete?: unknown; state?: unknown };
          }
        ).matrixChat;
        matrixChatFirstSyncComplete =
          typeof matrixChat?.firstSyncComplete === 'boolean'
            ? matrixChat.firstSyncComplete
            : null;
        if (
          matrixChat?.state !== null &&
          typeof matrixChat?.state === 'object' &&
          !Array.isArray(matrixChat.state)
        ) {
          matrixChatState = matrixChat.state as MatrixChatState;
        }
      } catch {
        // Keep Element's internal state in fixed buckets only.
      }
      const matrixChatStateAvailable = matrixChatState !== undefined;
      const matrixChatViewBucket: MatrixChatViewBucket =
        typeof matrixChatState?.view === 'number' &&
        Number.isInteger(matrixChatState.view) &&
        matrixChatState.view >= 0 &&
        matrixChatState.view <= 11
          ? matrixChatState.view === 9
            ? 'logged-in'
            : 'other-view'
          : 'unavailable';
      const matrixChatReady =
        typeof matrixChatState?.ready === 'boolean'
          ? matrixChatState.ready
          : null;
      const matrixChatPageTypeBucket: MatrixChatPageTypeBucket =
        matrixChatState?.page_type === undefined ||
        matrixChatState?.page_type === null
          ? matrixChatStateAvailable
            ? 'missing'
            : 'unavailable'
          : typeof matrixChatState.page_type === 'string'
            ? matrixChatState.page_type === 'room_view'
              ? 'room-view'
              : 'other-page'
            : 'unavailable';
      const matrixChatCurrentRoomMatches =
        typeof matrixChatState?.currentRoomId === 'string' ||
        matrixChatState?.currentRoomId === null
          ? matrixChatState.currentRoomId === expectedRoomId
          : null;
      const matrixChatShellPresent =
        document.querySelector('.mx_MatrixChat') !== null;
      const roomViewWrapperPresent =
        document.querySelector('.mx_RoomView_wrapper') !== null;
      const roomViewRendererPresent =
        document.querySelector('.mx_RoomView') !== null;
      const outerRenderBucket: OuterRenderBucket =
        matrixChatShellPresent &&
        roomViewWrapperPresent &&
        roomViewRendererPresent
          ? 'room-page'
          : matrixChatShellPresent &&
              roomViewWrapperPresent &&
              !roomViewRendererPresent
            ? 'other-page'
            : !matrixChatShellPresent &&
                !roomViewWrapperPresent &&
                !roomViewRendererPresent
              ? 'no-shell'
              : 'inconsistent';
      const isVisible = (element: Element): boolean => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return (
          element.getClientRects().length > 0 &&
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          style.visibility !== 'collapse'
        );
      };
      const unavailable = {
        outerRenderBucket,
        matrixChatShellPresent,
        roomViewWrapperPresent,
        roomViewRendererPresent,
        matrixChatStateAvailable,
        matrixChatViewBucket,
        matrixChatFirstSyncComplete,
        matrixChatReady,
        matrixChatPageTypeBucket,
        matrixChatCurrentRoomMatches,
        roomRenderStateAvailable: false,
        roomViewShellVisible: null,
        roomViewBodyVisible: null,
        roomPreviewVisible: null,
        roomPreviewLoadingVisible: null,
        roomHeaderVisible: null,
        roomHeaderHeadingVisible: null,
        roomErrorBoundaryVisible: null,
      } as const;
      const visibleRoomViews = Array.from(
        document.querySelectorAll('.mx_RoomView'),
      ).filter(isVisible);
      if (visibleRoomViews.length > 1) return unavailable;
      const roomView = visibleRoomViews[0];
      if (!roomView) {
        return {
          ...unavailable,
          outerRenderBucket,
          roomRenderStateAvailable: true,
          roomViewShellVisible: false,
          roomViewBodyVisible: false,
          roomPreviewVisible: false,
          roomPreviewLoadingVisible: false,
          roomHeaderVisible: false,
          roomHeaderHeadingVisible: false,
          roomErrorBoundaryVisible: false,
        };
      }
      const firstVisible = (root: ParentNode, selector: string): boolean =>
        Array.from(root.querySelectorAll(selector)).some(isVisible);
      const header = roomView.querySelector('header.mx_RoomHeader');
      return {
        ...unavailable,
        roomRenderStateAvailable: true,
        roomViewShellVisible: true,
        roomViewBodyVisible: firstVisible(roomView, '.mx_RoomView_body'),
        roomPreviewVisible: firstVisible(roomView, '.mx_RoomPreviewBar'),
        roomPreviewLoadingVisible: firstVisible(
          roomView,
          '.mx_RoomPreviewBar_Loading',
        ),
        roomHeaderVisible: header !== null && isVisible(header),
        roomHeaderHeadingVisible:
          header !== null &&
          firstVisible(header, '.mx_RoomHeader_heading[role="heading"]'),
        roomErrorBoundaryVisible: firstVisible(roomView, '.mx_ErrorBoundary'),
      };
    }, expectedRoomId);
  }

  async function observeMemberARoom(
    page: Page,
    element: ElementWebPage,
    roomName: string,
    roomId: string,
    expectedUserId: string,
    roomNavigationCompleted: boolean,
    roomHeadingReady: boolean,
    captureReminderRoomLayout: boolean,
    blockedExternalRequestsOverride?: { count: number },
  ): Promise<MemberARoomObservation> {
    const matrixState = await page.evaluate(
      ({ expectedRoomId, expectedMatrixUserId }) => {
        type MatrixRoom = { getMyMembership?: () => string | null };
        type MatrixClient = {
          getUserId?: () => string | null;
          getRoom?: (id: string) => MatrixRoom | undefined;
          getSyncState?: () => string | null;
        };
        type MatrixClientPeg = { get?: () => MatrixClient | undefined };
        const knownSyncStates = new Set([
          'ERROR',
          'PREPARED',
          'RECONNECTING',
          'STOPPED',
          'SYNCING',
          'CATCHUP',
        ]);
        let matrixClient: MatrixClient | undefined;
        try {
          const matrixClientPeg = (
            window as unknown as {
              mxMatrixClientPeg?: MatrixClientPeg;
            }
          ).mxMatrixClientPeg;
          matrixClient = matrixClientPeg?.get?.();
        } catch {
          // Report fixed booleans and known sync states only.
        }

        let matrixUserMatches = false;
        let matrixRoomKnown = false;
        let matrixRoomJoined = false;
        let matrixSyncState: MatrixSyncState = 'UNKNOWN';
        try {
          matrixUserMatches =
            matrixClient?.getUserId?.() === expectedMatrixUserId;
        } catch {
          // Keep the identity observation boolean-only.
        }
        try {
          const matrixRoom = matrixClient?.getRoom?.(expectedRoomId);
          matrixRoomKnown = Boolean(matrixRoom);
          matrixRoomJoined = matrixRoom?.getMyMembership?.() === 'join';
        } catch {
          // Keep room state observations boolean-only.
        }
        try {
          const rawSyncState = matrixClient?.getSyncState?.();
          if (
            typeof rawSyncState === 'string' &&
            knownSyncStates.has(rawSyncState)
          ) {
            matrixSyncState = rawSyncState as MatrixSyncState;
          }
        } catch {
          // Keep only fixed sync state values.
        }
        return {
          matrixUserMatches,
          matrixRoomKnown,
          matrixRoomJoined,
          matrixSyncState,
        };
      },
      { expectedRoomId: roomId, expectedMatrixUserId: expectedUserId },
    );
    const roomRenderState = await observeRoomRenderState(page, roomId).catch(
      () => unavailableRoomRenderState(),
    );
    const roomNameHeading = getPinnedElementRoomNameHeading(page);
    const roomHeadingCount = await roomNameHeading.count().catch(() => 0);
    const roomHeadingPresent =
      roomHeadingCount > 0 &&
      (await roomNameHeading.isVisible().catch(() => false));
    const roomNameMatches =
      roomHeadingCount > 0 &&
      (await roomNameHeading
        .first()
        .evaluate(
          (heading, expectedName) =>
            (heading.textContent ?? '').trim() === expectedName,
          roomName,
          { timeout: 1_000 },
        )
        .catch(() => false));
    let roomLayoutObservation:
      | Pick<
          MemberARoomObservation,
          | 'roomViewPresent'
          | 'roomHeaderPresent'
          | 'roomHeadingDomPresent'
          | 'roomInfoControlPresent'
          | 'fixtureCalendarIframePresent'
        >
      | undefined;
    if (captureReminderRoomLayout) {
      const [
        roomViewCount,
        roomHeaderCount,
        roomInfoControlCount,
        iframeCount,
      ] = await Promise.all([
        page
          .locator('.mx_RoomView')
          .count()
          .catch(() => 0),
        page
          .locator('header.mx_RoomHeader')
          .count()
          .catch(() => 0),
        page
          .locator('header.mx_RoomHeader button.mx_RoomHeader_infoWrapper')
          .count()
          .catch(() => 0),
        page
          .locator('iframe[title="Matrix Calendar"]')
          .count()
          .catch(() => 0),
      ]);
      roomLayoutObservation = {
        roomViewPresent: roomViewCount > 0,
        roomHeaderPresent: roomHeaderCount > 0,
        roomHeadingDomPresent: roomHeadingCount > 0,
        roomInfoControlPresent: roomInfoControlCount > 0,
        fixtureCalendarIframePresent: iframeCount > 0,
      };
    }
    let roomIdMatches = false;
    try {
      roomIdMatches = element.getCurrentRoomId() === roomId;
    } catch {
      // The URL is represented only as an equality result.
    }
    const homeserverHttpFailures =
      supportContext.memberRoomHomeserverHttpFailures.get(page) ?? {
        count: 0,
      };
    const blockedExternalRequests =
      blockedExternalRequestsOverride?.count ??
      supportContext.memberABlockedExternalRequests.get(page)?.count ??
      0;
    return {
      ...matrixState,
      roomNavigationCompleted,
      roomHeadingReady,
      roomHeadingPresent,
      roomNameMatches,
      roomIdMatches,
      ...roomRenderState,
      ...(roomLayoutObservation ?? {}),
      blockedExternalRequestCount: blockedExternalRequests,
      homeserverHttpErrorCount: homeserverHttpFailures.count,
      ...(homeserverHttpFailures.lastStatus === undefined
        ? {}
        : { homeserverLastHttpErrorStatus: homeserverHttpFailures.lastStatus }),
    };
  }

  function getMemberARoomFailureCode(
    navigationCompleted: boolean,
    observation: MemberARoomObservation | undefined,
  ): MemberARoomFailureCode | undefined {
    if (!navigationCompleted) return 'element-room-navigation-failed';
    if (!observation) return 'element-room-observation-unavailable';
    if (!observation.matrixUserMatches) return 'element-room-session-mismatch';
    if (!observation.roomIdMatches) return 'element-room-route-mismatch';
    if (!observation.matrixRoomKnown) return 'element-room-not-known';
    if (!observation.matrixRoomJoined) return 'element-room-not-joined';
    if (!observation.roomHeadingPresent) {
      return 'element-room-heading-not-present';
    }
    if (!observation.roomNameMatches) return 'element-room-name-mismatch';
    if (!observation.roomHeadingReady) {
      return 'element-room-heading-wait-timeout';
    }
    return undefined;
  }

  function requireMemberARoom(result: MemberARoomResult): ElementWebPage {
    if (result.failureCode) {
      throw new Error('Element room context did not become ready');
    }
    return result.element;
  }

  return {
    authenticateInElement,
    openFixtureRoom,
    getPinnedElementRoomNameHeading,
    openMemberARoomWithDiagnostics,
    observeMemberARoomReadinessSnapshot,
    unavailableRoomRenderState,
    observeRoomRenderState,
    observeMemberARoom,
    getMemberARoomFailureCode,
    requireMemberARoom,
  };
}
