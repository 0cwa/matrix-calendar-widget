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
  | 'member-b-authenticated'
  | 'outsider-authenticated'
  | 'outsider-room-context'
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

let fixture: Fixture;

let activePhase: Phase = 'member-a-authenticated';

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
    contexts.push(context);
    await context.route('**/*', async (route) => {
      let origin: string | undefined;
      try {
        origin = new URL(route.request().url()).origin;
      } catch {
        blockedExternalRequests += 1;
        await route.abort('blockedbyclient');
        return;
      }

      if (!allowedOrigins.has(origin)) {
        blockedExternalRequests += 1;
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

  try {
    recordRuntimeVersions(browser.version());

    activePhase = 'member-a-authenticated';
    contextA = await makeContext();
    pageA = await authenticateInElement(contextA, fixture.users.memberA);
    record(activePhase, 'passed');

    activePhase = 'member-b-authenticated';
    contextB = await makeContext();
    pageB = await authenticateInElement(contextB, fixture.users.memberB);
    record(activePhase, 'passed');

    activePhase = 'outsider-authenticated';
    contextC = await makeContext();
    pageC = await authenticateInElement(contextC, fixture.users.outsider);
    record(activePhase, 'passed');

    activePhase = 'widget-a-approved';
    const elementA = new ElementWebPage(pageA);
    await elementA.switchToRoom(fixture.roomName);
    expect(elementA.getCurrentRoomId()).toBe(fixture.teamRoomId);
    const firstRead = waitForGatewayResponse(
      pageA,
      'GET',
      '/v1/calendar/events',
    );
    const frameA = await openCalendarWidget(elementA, pageA);
    const firstReadResponse = await firstRead;
    expect(firstReadResponse.status()).toBe(200);
    record('widget-a-approved', 'passed');
    record('gateway-backed-read', 'passed', firstReadResponse.status());

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

    activePhase = 'widget-b-approved';
    const elementB = new ElementWebPage(pageB);
    await elementB.switchToRoom(fixture.roomName);
    expect(elementB.getCurrentRoomId()).toBe(fixture.teamRoomId);
    const memberBRead = waitForGatewayResponse(
      pageB,
      'GET',
      '/v1/calendar/events',
    );
    const frameB = await openCalendarWidget(elementB, pageB);
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
    const elementC = new ElementWebPage(pageC);
    await elementC.switchToRoom(fixture.outsiderRoomName);
    expect(elementC.getCurrentRoomId()).toBe(fixture.outsiderRoomId);
    expect(fixture.outsiderRoomId).not.toBe(fixture.teamRoomId);
    activePhase = 'outsider-widget-approved';
    const outsiderRead = waitForGatewayResponse(
      pageC,
      'GET',
      '/v1/calendar/events',
    );
    await openCalendarWidget(elementC, pageC, false);
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
    record(activePhase, 'failed');
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
): Promise<Page> {
  const page = await context.newPage();
  await page.goto(new URL('/welcome/images/logo.svg', fixture.elementUrl).href);
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
  await page.goto(fixture.elementUrl);
  await page
    .getByRole('navigation')
    .getByRole('button', { name: 'Add', exact: true })
    .waitFor();
  return page;
}

async function openCalendarWidget(
  element: ElementWebPage,
  page: Page,
  waitForCalendar = true,
) {
  await element.showWidgetInSidebar('Matrix Calendar');
  const identityContinue = page
    .getByRole('dialog')
    .getByRole('button', { name: 'Continue', exact: true })
    .first();
  await identityContinue
    .waitFor({ state: 'visible', timeout: 8_000 })
    .catch(() => undefined);
  if (await identityContinue.isVisible().catch(() => false)) {
    await element.approveWidgetIdentity();
  }
  const frame = element.widgetByTitle('Matrix Calendar');
  if (waitForCalendar) {
    await frame
      .getByRole('button', { name: 'Create event', exact: true })
      .waitFor();
  }
  return frame;
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
  return page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.origin === new URL(fixture.gatewayUrl).origin &&
      url.pathname === pathname &&
      response.request().method() === method
    );
  });
}

function record(
  phase: Phase,
  status: 'started' | 'passed' | 'failed',
  httpStatus?: number,
  count?: number,
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
