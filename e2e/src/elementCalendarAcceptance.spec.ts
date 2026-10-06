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
  test,
  type BrowserContext,
  type Locator,
  type Page,
  type Response,
} from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';
import { arch, platform, release } from 'node:os';
import { ElementWebPage } from './pages/elementWebPage';

type User = {
  userId: string;
  accessToken: string;
  deviceId: string;
};

type Fixture = {
  homeserverUrl: string;
  elementUrl: string;
  gatewayUrl: string;
  roomName: string;
  outsiderRoomName: string;
  calendarId: string;
  outsiderRoomId: string;
  teamRoomId: string;
  users: {
    memberA: User;
    memberB: User;
    outsider: User;
  };
};

type Phase =
  | 'member-a-authenticated'
  | 'member-a-origin-navigation'
  | 'member-a-credentials-seeded'
  | 'member-a-root-navigation'
  | 'member-a-session-observed'
  | 'member-b-authenticated'
  | 'outsider-authenticated'
  | 'member-a-room-navigation'
  | 'member-a-room-context'
  | 'member-b-room-context'
  | 'outsider-room-context'
  | 'widget-a-room-info-button'
  | 'widget-a-extensions-menuitem'
  | 'widget-a-extension-row'
  | 'widget-a-warning-not-required'
  | 'widget-a-capabilities-approval'
  | 'widget-a-identity-dialog-observed'
  | 'widget-a-identity-dialog-not-required'
  | 'widget-a-identity-approval'
  | 'widget-a-iframe-attached'
  | 'widget-a-iframe-ready'
  | 'widget-a-approved'
  | 'widget-b-approved'
  | 'outsider-widget-approved'
  | 'gateway-backed-read'
  | 'event-created'
  | 'shared-visibility'
  | 'member-a-edited'
  | 'outsider-room-widget-team-target'
  | 'outsider-own-unbound-room'
  | 'stale-etag-conflict'
  | 'canonical-read-after-denial'
  | 'browser-egress';

type MatrixSyncState =
  | 'ERROR'
  | 'PREPARED'
  | 'RECONNECTING'
  | 'STOPPED'
  | 'SYNCING'
  | 'CATCHUP'
  | 'UNKNOWN';

type MemberARoomObservation = {
  matrixUserMatches: boolean;
  matrixRoomKnown: boolean;
  matrixRoomJoined: boolean;
  matrixSyncState: MatrixSyncState;
  roomNavigationCompleted: boolean;
  roomHeadingReady: boolean;
  roomHeadingPresent: boolean;
  roomNameMatches: boolean;
  roomIdMatches: boolean;
  blockedExternalRequestCount: number;
  homeserverHttpErrorCount: number;
  homeserverLastHttpErrorStatus?: number;
};

type MemberARoomFailureCode =
  | 'element-room-navigation-failed'
  | 'element-room-observation-unavailable'
  | 'element-room-session-mismatch'
  | 'element-room-not-known'
  | 'element-room-not-joined'
  | 'element-room-route-mismatch'
  | 'element-room-heading-not-present'
  | 'element-room-name-mismatch'
  | 'element-room-heading-wait-timeout';

type MemberARoomResult = {
  element: ElementWebPage;
  navigationCompleted: boolean;
  observation?: MemberARoomObservation;
  failureCode?: MemberARoomFailureCode;
};

type OpenCalendarWidgetOptions = {
  expectWidgetWarning: boolean;
  waitForCalendar?: boolean;
  captureMemberADiagnostics?: boolean;
};

type HomeserverHttpFailures = {
  count: number;
  lastStatus?: number;
};

type PinnedControlObservation = {
  phase: Phase;
  count: number;
  controlVisible: boolean;
  panelPresent?: boolean;
};

let fixture: Fixture;

let activePhase: Phase = 'member-a-authenticated';
let pendingPinnedControlObservation: PinnedControlObservation | undefined;
const memberAHomeserverHttpFailures = new WeakMap<
  Page,
  HomeserverHttpFailures
>();
const blockedExternalRequestsByContext = new WeakMap<
  BrowserContext,
  { count: number }
>();
const memberABlockedExternalRequests = new WeakMap<Page, { count: number }>();

test('Element Web members share events and enforce room authorization', async ({
  browser,
}) => {
  fixture = readFixture();
  const contexts: BrowserContext[] = [];
  let blockedExternalRequests = 0;
  const allowedOrigins = new Set([
    new URL(fixture.elementUrl).origin,
    new URL(fixture.homeserverUrl).origin,
    'http://localhost:8008',
    new URL(fixture.gatewayUrl).origin,
    'http://127.0.0.1:8080',
  ]);

  const makeContext = async () => {
    const context = await browser.newContext({
      locale: 'en-US',
      timezoneId: 'Europe/Stockholm',
      viewport: { width: 1440, height: 900 },
    });
    const contextBlockedRequests = { count: 0 };
    blockedExternalRequestsByContext.set(context, contextBlockedRequests);
    contexts.push(context);
    await context.route('**/*', async (route) => {
      let origin: string | undefined;
      try {
        origin = new URL(route.request().url()).origin;
      } catch {
        blockedExternalRequests += 1;
        contextBlockedRequests.count = Math.min(
          contextBlockedRequests.count + 1,
          100_000,
        );
        await route.abort('blockedbyclient');
        return;
      }

      if (!allowedOrigins.has(origin)) {
        blockedExternalRequests += 1;
        contextBlockedRequests.count = Math.min(
          contextBlockedRequests.count + 1,
          100_000,
        );
        await route.abort('blockedbyclient');
        return;
      }
      await route.continue();
    });
    return context;
  };

  let contextA: BrowserContext | undefined;
  let contextB: BrowserContext | undefined;
  let contextC: BrowserContext | undefined;
  let pageA: Page | undefined;
  let pageB: Page | undefined;
  let pageC: Page | undefined;
  let failureHttpStatus: number | undefined;
  let failureAlreadyReported = false;

  try {
    recordRuntimeVersions(browser.version());

    activePhase = 'member-a-authenticated';
    contextA = await makeContext();
    pageA = await authenticateInElement(contextA, fixture.users.memberA, true);
    record(activePhase, 'passed');

    activePhase = 'member-b-authenticated';
    contextB = await makeContext();
    pageB = await authenticateInElement(contextB, fixture.users.memberB);
    record(activePhase, 'passed');

    activePhase = 'outsider-authenticated';
    contextC = await makeContext();
    pageC = await authenticateInElement(contextC, fixture.users.outsider);
    record(activePhase, 'passed');

    activePhase = 'member-a-room-navigation';
    const memberARoom = await openMemberARoomWithDiagnostics(
      pageA,
      fixture.roomName,
      fixture.teamRoomId,
      fixture.users.memberA.userId,
    );
    record(activePhase, memberARoom.navigationCompleted ? 'passed' : 'failed');
    activePhase = 'member-a-room-context';
    recordMemberARoomObservation(memberARoom);
    failureAlreadyReported = Boolean(memberARoom.failureCode);
    const elementA = requireMemberARoom(memberARoom);
    activePhase = 'widget-a-approved';
    const firstRead = waitForGatewayResponse(
      pageA,
      'GET',
      '/v1/calendar/events',
    );
    void firstRead.catch(() => undefined);
    const frameA = await openCalendarWidget(elementA, pageA, {
      expectWidgetWarning: false,
      waitForCalendar: false,
      captureMemberADiagnostics: true,
    });
    activePhase = 'gateway-backed-read';
    const firstReadResponse = await firstRead;
    failureHttpStatus = firstReadResponse.status();
    expect(failureHttpStatus).toBe(200);
    record(activePhase, 'passed', failureHttpStatus);
    failureHttpStatus = undefined;
    activePhase = 'widget-a-iframe-ready';
    await frameA
      .getByRole('button', { name: 'Create event', exact: true })
      .waitFor({ timeout: 30_000 });
    record(activePhase, 'passed');
    activePhase = 'widget-a-approved';
    record('widget-a-approved', 'passed');

    const eventTitle = `Acceptance ${randomUUID()}`;
    activePhase = 'event-created';
    const createResponse = waitForGatewayResponse(
      pageA,
      'POST',
      '/v1/calendar/events',
    );
    await frameA
      .getByRole('button', { name: 'Create event', exact: true })
      .click();
    const createDialog = frameA.getByRole('dialog').last();
    await createDialog.getByRole('textbox', { name: 'Title' }).fill(eventTitle);
    await createDialog
      .getByRole('button', { name: 'Create event', exact: true })
      .click();
    const createResponseResult = await createResponse;
    expect(createResponseResult.status()).toBeGreaterThanOrEqual(200);
    expect(createResponseResult.status()).toBeLessThan(300);
    await expect(
      frameA.getByRole('listitem', { name: eventTitle }),
    ).toBeVisible();
    record(activePhase, 'passed', createResponseResult.status());

    activePhase = 'member-b-room-context';
    const elementB = await openFixtureRoom(
      pageB,
      fixture.roomName,
      fixture.teamRoomId,
    );
    record(activePhase, 'passed');
    activePhase = 'widget-b-approved';
    const memberBRead = waitForGatewayResponse(
      pageB,
      'GET',
      '/v1/calendar/events',
    );
    const frameB = await openCalendarWidget(elementB, pageB, {
      expectWidgetWarning: true,
    });
    const memberBReadResult = await memberBRead;
    expect(memberBReadResult.status()).toBe(200);
    record(activePhase, 'passed');

    activePhase = 'shared-visibility';
    await expect(
      frameB.getByRole('listitem', { name: eventTitle }),
    ).toBeVisible();
    await openEventEditor(frameB, eventTitle);
    await frameB
      .getByRole('dialog')
      .last()
      .getByRole('textbox', { name: 'Title' })
      .fill('Member B stale draft');
    record(activePhase, 'passed');

    activePhase = 'member-a-edited';
    await openEventEditor(frameA, eventTitle);
    const updateResponse = waitForGatewayResponse(
      pageA,
      'PATCH',
      '/v1/calendar/events',
    );
    await frameA
      .getByRole('dialog')
      .last()
      .getByRole('textbox', { name: 'Title' })
      .fill('Member A canonical edit');
    await frameA
      .getByRole('dialog')
      .last()
      .getByRole('button', { name: 'Save', exact: true })
      .click();
    const updateResponseResult = await updateResponse;
    expect(updateResponseResult.status()).toBeGreaterThanOrEqual(200);
    expect(updateResponseResult.status()).toBeLessThan(300);
    record(activePhase, 'passed', updateResponseResult.status());

    activePhase = 'outsider-room-context';
    const elementC = await openFixtureRoom(
      pageC,
      fixture.outsiderRoomName,
      fixture.outsiderRoomId,
    );
    record(activePhase, 'passed');
    expect(fixture.outsiderRoomId).not.toBe(fixture.teamRoomId);
    activePhase = 'outsider-widget-approved';
    const outsiderRead = waitForGatewayResponse(
      pageC,
      'GET',
      '/v1/calendar/events',
    );
    await openCalendarWidget(elementC, pageC, {
      expectWidgetWarning: false,
      waitForCalendar: false,
    });
    record(activePhase, 'passed');

    activePhase = 'outsider-room-widget-team-target';
    const outsiderResponse = await outsiderRead;
    expect(new URL(outsiderResponse.url()).searchParams.get('roomId')).toBe(
      fixture.teamRoomId,
    );
    expect(outsiderResponse.status()).toBe(403);
    record(activePhase, 'passed', outsiderResponse.status());

    activePhase = 'outsider-own-unbound-room';
    const ownRoomStatus = await pageC.evaluate(
      async ({ gatewayUrl, roomId, calendarId }) => {
        // The current Element session requests a fresh Matrix OpenID assertion;
        // only the status crosses back into the test process.
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
      {
        gatewayUrl: fixture.gatewayUrl,
        roomId: fixture.outsiderRoomId,
        calendarId: fixture.calendarId,
      },
    );
    expect(ownRoomStatus).toBe(404);
    record(activePhase, 'passed', ownRoomStatus);

    activePhase = 'stale-etag-conflict';
    const staleUpdate = waitForGatewayResponse(
      pageB,
      'PATCH',
      '/v1/calendar/events',
    );
    await frameB
      .getByRole('dialog')
      .last()
      .getByRole('button', { name: 'Save', exact: true })
      .click();
    const staleUpdateResult = await staleUpdate;
    expect(staleUpdateResult.status()).toBe(409);
    await expect(
      frameB.getByText(
        'This event changed elsewhere. Reload the latest version before retrying.',
      ),
    ).toBeVisible();
    record(activePhase, 'passed', staleUpdateResult.status());

    activePhase = 'canonical-read-after-denial';
    const reloadResponse = waitForGatewayResponse(
      pageB,
      'GET',
      '/v1/calendar/event',
    );
    await frameB
      .getByRole('dialog')
      .last()
      .getByRole('button', { name: 'Reload latest', exact: true })
      .click();
    const reloadResponseResult = await reloadResponse;
    expect(reloadResponseResult.status()).toBe(200);
    await expect(frameB.getByRole('textbox', { name: 'Title' })).toHaveValue(
      'Member A canonical edit',
    );
    record(activePhase, 'passed', reloadResponseResult.status());

    activePhase = 'browser-egress';
    expect(blockedExternalRequests).toBe(0);
    record(activePhase, 'passed', undefined, blockedExternalRequests);
  } catch {
    recordJourneyFailure(
      activePhase,
      failureHttpStatus,
      failureAlreadyReported,
    );
    throw new Error('Element acceptance journey failed');
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

function readFixture(): Fixture {
  const path = process.env.ELEMENT_ACCEPTANCE_USERS_FILE;
  if (!path) throw new Error('Element acceptance fixture unavailable');
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Fixture;
  } catch {
    throw new Error('Element acceptance fixture unavailable');
  }
}

async function authenticateInElement(
  context: BrowserContext,
  user: User,
  captureMemberADiagnostics = false,
): Promise<Page> {
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  page.setDefaultNavigationTimeout(30_000);
  if (captureMemberADiagnostics) {
    const homeserverOrigin = new URL(fixture.homeserverUrl).origin;
    const homeserverHttpFailures: HomeserverHttpFailures = { count: 0 };
    memberAHomeserverHttpFailures.set(page, homeserverHttpFailures);
    const contextBlockedRequests =
      blockedExternalRequestsByContext.get(context);
    if (contextBlockedRequests) {
      memberABlockedExternalRequests.set(page, contextBlockedRequests);
    }
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
    activePhase = 'member-a-origin-navigation';
  }
  const originResponse = await page.goto(
    new URL('/welcome/images/logo.svg', fixture.elementUrl).href,
  );
  if (captureMemberADiagnostics) {
    const originMatchesElement =
      new URL(page.url()).origin === new URL(fixture.elementUrl).origin;
    record(activePhase, 'passed', originResponse?.status(), undefined, {
      originMatchesElement,
    });
    activePhase = 'member-a-credentials-seeded';
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
    { homeserverUrl: fixture.homeserverUrl, credentials: user },
  );
  if (captureMemberADiagnostics) {
    record(activePhase, 'passed');
    activePhase = 'member-a-root-navigation';
  }

  const rootResponse = await page.goto(fixture.elementUrl);
  if (captureMemberADiagnostics) {
    record(activePhase, 'passed', rootResponse?.status());
    activePhase = 'member-a-session-observed';
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
    activePhase = 'member-a-authenticated';
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
  const roomUrl = new URL(fixture.elementUrl);
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
): Promise<MemberARoomResult> {
  const roomUrl = new URL(fixture.elementUrl);
  roomUrl.hash = `/room/${roomId}`;
  let navigationCompleted = false;
  try {
    await page.goto(roomUrl.href, { timeout: 20_000 });
    navigationCompleted = true;
  } catch {
    // The failure summary records only whether this bounded navigation ended.
  }

  const element = new ElementWebPage(page);
  const roomNameHeading = getPinnedElementRoomNameHeading(page);
  let roomHeadingReady = false;
  if (navigationCompleted) {
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
    }
  }

  const observation = await observeMemberARoom(
    page,
    element,
    roomName,
    roomId,
    expectedUserId,
    navigationCompleted,
    roomHeadingReady,
  ).catch(() => undefined);
  return {
    element,
    navigationCompleted,
    observation,
    failureCode: getMemberARoomFailureCode(navigationCompleted, observation),
  };
}

async function observeMemberARoom(
  page: Page,
  element: ElementWebPage,
  roomName: string,
  roomId: string,
  expectedUserId: string,
  roomNavigationCompleted: boolean,
  roomHeadingReady: boolean,
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
  let roomIdMatches = false;
  try {
    roomIdMatches = element.getCurrentRoomId() === roomId;
  } catch {
    // The URL is represented only as an equality result.
  }
  const homeserverHttpFailures = memberAHomeserverHttpFailures.get(page) ?? {
    count: 0,
  };
  const blockedExternalRequests =
    memberABlockedExternalRequests.get(page)?.count ?? 0;
  return {
    ...matrixState,
    roomNavigationCompleted,
    roomHeadingReady,
    roomHeadingPresent,
    roomNameMatches,
    roomIdMatches,
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

function recordJourneyFailure(
  phase: Phase,
  httpStatus: number | undefined,
  alreadyRecorded: boolean,
) {
  if (!alreadyRecorded) {
    const observation =
      pendingPinnedControlObservation?.phase === phase
        ? pendingPinnedControlObservation
        : undefined;
    record(
      phase,
      'failed',
      httpStatus,
      observation?.count,
      observation
        ? {
            controlVisible: observation.controlVisible,
            ...(observation.panelPresent === undefined
              ? {}
              : { panelPresent: observation.panelPresent }),
          }
        : undefined,
    );
  }
  pendingPinnedControlObservation = undefined;
}

async function openCalendarWidget(
  element: ElementWebPage,
  page: Page,
  {
    expectWidgetWarning,
    waitForCalendar = true,
    captureMemberADiagnostics = false,
  }: OpenCalendarWidgetOptions,
) {
  await openPinnedElementWidget(
    page,
    'Matrix Calendar',
    captureMemberADiagnostics,
  );
  if (captureMemberADiagnostics) {
    if (!expectWidgetWarning) activePhase = 'widget-a-warning-not-required';
  }
  if (expectWidgetWarning) {
    await element.approveWidgetWarning();
    if (captureMemberADiagnostics) record(activePhase, 'passed');
  } else if (captureMemberADiagnostics) {
    record(activePhase, 'passed');
  }
  if (captureMemberADiagnostics) {
    activePhase = 'widget-a-capabilities-approval';
  }
  await element.approveWidgetCapabilities();
  if (captureMemberADiagnostics) record(activePhase, 'passed');
  if (captureMemberADiagnostics) {
    activePhase = 'widget-a-identity-approval';
  }
  const identityContinue = page
    .getByRole('dialog')
    .getByRole('button', { name: 'Continue', exact: true })
    .first();
  await identityContinue
    .waitFor({ state: 'visible', timeout: 8_000 })
    .catch(() => undefined);
  const identityDialogShown = await identityContinue
    .isVisible()
    .catch(() => false);
  if (captureMemberADiagnostics) {
    record(
      identityDialogShown
        ? 'widget-a-identity-dialog-observed'
        : 'widget-a-identity-dialog-not-required',
      'passed',
    );
  }
  if (identityDialogShown) {
    if (captureMemberADiagnostics) {
      activePhase = 'widget-a-identity-approval';
    }
    await element.approveWidgetIdentity();
    if (captureMemberADiagnostics) {
      record(activePhase, 'passed');
      activePhase = 'widget-a-iframe-ready';
    }
  } else if (captureMemberADiagnostics) {
    activePhase = 'widget-a-iframe-ready';
  }
  const frame = element.widgetByTitle('Matrix Calendar');
  if (captureMemberADiagnostics) {
    activePhase = 'widget-a-iframe-attached';
    await page
      .locator('iframe[title="Matrix Calendar"]')
      .waitFor({ state: 'attached', timeout: 30_000 });
    record(activePhase, 'passed');
    activePhase = 'widget-a-iframe-ready';
  }
  if (waitForCalendar) {
    await frame
      .getByRole('button', { name: 'Create event', exact: true })
      .waitFor();
  }
  return frame;
}

async function openPinnedElementWidget(
  page: Page,
  widgetName: string,
  captureMemberADiagnostics = false,
): Promise<void> {
  const roomHeader = page.locator('header.mx_RoomHeader');
  const rightPanel = page.getByRole('complementary');
  await clickPinnedWidgetControl(
    roomHeader.getByRole('button', { name: 'Room info' }),
    captureMemberADiagnostics ? 'widget-a-room-info-button' : undefined,
  );
  await clickPinnedWidgetControl(
    rightPanel.getByRole('menuitem', { name: 'Extensions' }),
    captureMemberADiagnostics ? 'widget-a-extensions-menuitem' : undefined,
    rightPanel,
  );
  await clickPinnedWidgetControl(
    rightPanel.getByRole('button', { name: widgetName }),
    captureMemberADiagnostics ? 'widget-a-extension-row' : undefined,
    rightPanel,
  );
}

async function clickPinnedWidgetControl(
  control: Locator,
  diagnosticPhase?:
    | 'widget-a-room-info-button'
    | 'widget-a-extensions-menuitem'
    | 'widget-a-extension-row',
  panel?: Locator,
): Promise<void> {
  if (!diagnosticPhase) {
    await control.click();
    return;
  }

  activePhase = diagnosticPhase;
  await control.waitFor({ state: 'visible', timeout: 8_000 }).catch(() => {});
  const count = Math.min(await control.count(), 2);
  const controlVisible =
    count === 1 && (await control.isVisible().catch(() => false));
  const panelPresent = panel
    ? (await panel.count()) === 1 &&
      (await panel.isVisible().catch(() => false))
    : undefined;
  pendingPinnedControlObservation = {
    phase: diagnosticPhase,
    count,
    controlVisible,
    ...(panelPresent === undefined ? {} : { panelPresent }),
  };

  if (count !== 1 || !controlVisible || panelPresent === false) {
    throw new Error('Pinned Element widget control unavailable');
  }

  await control.click({ timeout: 8_000 });
  record(diagnosticPhase, 'passed', undefined, count, {
    controlVisible,
    ...(panelPresent === undefined ? {} : { panelPresent }),
  });
  pendingPinnedControlObservation = undefined;
}

async function openEventEditor(
  frame: ReturnType<ElementWebPage['widgetByTitle']>,
  title: string,
) {
  const row = frame.getByRole('listitem', { name: title });
  await expect(row).toBeVisible();
  await row.click();
  const details = frame.getByRole('dialog').last();
  await details.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(
    frame.getByRole('dialog').last().getByRole('textbox', { name: 'Title' }),
  ).toBeVisible();
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
        url.origin === new URL(fixture.gatewayUrl).origin &&
        url.pathname === pathname &&
        response.request().method() === method
      );
    },
    { timeout: 30_000 },
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
  },
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

function recordMemberARoomObservation(result: MemberARoomResult) {
  const stageFile = process.env.ELEMENT_ACCEPTANCE_STAGE_FILE;
  if (!stageFile) throw new Error('Element acceptance fixture unavailable');
  appendFileSync(
    stageFile,
    `${JSON.stringify({
      phase: 'member-a-room-context',
      status: result.failureCode ? 'failed' : 'passed',
      ...(result.failureCode ? { failureCode: result.failureCode } : {}),
      ...(result.observation ?? {}),
    })}\n`,
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
      elementWebConfiguredTag: 'v1.12.30',
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
