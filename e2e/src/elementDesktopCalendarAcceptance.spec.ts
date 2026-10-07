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
  chromium,
  test,
  type Browser,
  type BrowserContext,
  type FrameLocator,
  type Locator,
  type Page,
  type Request,
} from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import {
  appendDesktopJourneyOutcome,
  initializeDesktopJourneyEvidence,
  readSyntheticDesktopCredentials,
  type DesktopJourneyPhase,
} from '../../dev/element-desktop-journey.mjs';
import { ElementWebPage } from './pages/elementWebPage';

type FixtureUser = {
  userId: string;
  accessToken: string;
  deviceId: string;
};

type Fixture = {
  homeserverUrl: string;
  elementUrl: string;
  gatewayUrl: string;
  widgetUrl: string;
  roomName: string;
  teamRoomId: string;
  calendarId: string;
  users: {
    memberA: { userId: string };
    memberB: FixtureUser;
  };
};

// Counts only HTTP(S) requests observed by this Playwright context route.
// WebSockets and traffic outside this route are outside this phase.
type WebHttpRouteObservation = {
  observedHttpRequests: number;
  blockedHttpRequests: number;
};

const FIXTURE_VALUES = Object.freeze({
  homeserverUrl: 'http://127.0.0.1:8008',
  elementUrl: 'http://127.0.0.1:8090',
  gatewayUrl: 'http://127.0.0.1:3000',
  widgetUrl: 'http://127.0.0.1:8080',
});

const DESKTOP_CREDENTIALS_NAME = 'element-acceptance-desktop-credentials.json';
const DESKTOP_EVIDENCE_NAME = 'element-desktop-journey-stage.jsonl';

test('Element Desktop room event journey', async ({ browser }) => {
  const runnerTemp = requireAbsoluteEnvironment('RUNNER_TEMP');
  const usersFile = requirePrivateRunnerFile(
    'ELEMENT_ACCEPTANCE_USERS_FILE',
    runnerTemp,
    'element-acceptance-users.json',
  );
  const credentialsFile = requirePrivateRunnerFile(
    'ELEMENT_ACCEPTANCE_DESKTOP_CREDENTIALS_FILE',
    runnerTemp,
    DESKTOP_CREDENTIALS_NAME,
  );
  const evidenceFile = requirePrivateRunnerPath(
    'ELEMENT_DESKTOP_JOURNEY_STAGE_FILE',
    runnerTemp,
    DESKTOP_EVIDENCE_NAME,
  );
  const evidence = { filePath: evidenceFile, runnerTemp };
  let fixture: Fixture;
  const recorded = new Set<DesktopJourneyPhase>();
  const contexts: BrowserContext[] = [];
  let desktopBrowser: Browser | undefined;
  let desktopPage: Page | undefined;
  let webHttpRoute: WebHttpRouteObservation | undefined;
  let currentPhase: DesktopJourneyPhase | undefined;
  let failed = false;
  let evidenceInitialized = false;

  try {
    initializeDesktopJourneyEvidence(evidence);
    evidenceInitialized = true;
    fixture = readFixture(usersFile);

    currentPhase = 'desktop-login';
    desktopBrowser = await connectToDesktop();
    desktopPage = await getDesktopPage(desktopBrowser);
    desktopPage.setDefaultTimeout(30_000);
    const credentials = readSyntheticDesktopCredentials({
      filePath: credentialsFile,
      runnerTemp,
    });
    const username = desktopPage.getByRole('textbox', {
      name: 'Username',
      exact: true,
    });
    const password = desktopPage.getByRole('textbox', {
      name: 'Password',
      exact: true,
    });
    try {
      await username.fill(credentials.username);
      await password.fill(credentials.password);
    } finally {
      credentials.password = '';
    }
    await desktopPage
      .getByRole('button', { name: 'Sign in', exact: true })
      .click();
    const desktopElement = new ElementWebPage(desktopPage);
    await desktopPage
      .getByRole('tree', { name: 'Rooms', exact: true })
      .waitFor({ state: 'visible', timeout: 60_000 });
    recordPhase(evidence, recorded, 'desktop-login');

    currentPhase = 'desktop-member-identity';
    const expectedMemberAUserId = `@${credentials.username}:localhost`;
    const membersAreDistinct =
      fixture.users.memberA.userId !== fixture.users.memberB.userId;
    const handoffMatchesMemberA =
      fixture.users.memberA.userId === expectedMemberAUserId;
    const desktopUserMatchesMemberA = await waitForDesktopMatrixUser(
      desktopPage,
      fixture.users.memberA.userId,
    );
    if (
      !membersAreDistinct ||
      !handoffMatchesMemberA ||
      !desktopUserMatchesMemberA
    ) {
      throw new Error('Desktop did not authenticate as synthetic member A');
    }
    recordPhase(evidence, recorded, 'desktop-member-identity');

    currentPhase = 'desktop-room-widget-read';
    await desktopElement.navigateToRoomOrInvitation(fixture.roomName);
    await desktopElement.roomNameText
      .getByText(fixture.roomName, { exact: true })
      .waitFor({ state: 'visible' });
    if (desktopElement.getCurrentRoomId() !== fixture.teamRoomId) {
      throw new Error('Desktop opened an unexpected room');
    }
    const desktopReadPromise = waitForGatewayResponse(
      desktopPage,
      fixture,
      'GET',
    );
    const desktopFrame = await openCalendarWidget(desktopPage, desktopElement);
    const desktopRead = await desktopReadPromise;
    if (desktopRead.status() !== 200) {
      throw new Error('Desktop calendar read failed');
    }
    await desktopFrame
      .getByRole('button', { name: 'Create event', exact: true })
      .waitFor({ state: 'visible' });
    currentPhase = 'desktop-widget-origin-isolation';
    await assertDesktopWidgetAttachment(desktopPage, fixture.widgetUrl);
    recordPhase(evidence, recorded, 'desktop-widget-origin-isolation');
    currentPhase = 'desktop-room-widget-read';
    recordPhase(evidence, recorded, 'desktop-room-widget-read');

    currentPhase = 'desktop-event-create';
    const initialTitle = `Desktop acceptance ${randomUUID()}`;
    const editedTitle = `${initialTitle} edited`;
    const createResponse = waitForGatewayResponse(desktopPage, fixture, 'POST');
    await createEvent(desktopFrame, initialTitle, fixture.calendarId);
    const created = await createResponse;
    if (created.status() < 200 || created.status() >= 300) {
      throw new Error('Desktop event creation failed');
    }
    await desktopFrame
      .getByRole('listitem', { name: initialTitle, exact: true })
      .waitFor({ state: 'visible' });
    recordPhase(evidence, recorded, 'desktop-event-create');

    currentPhase = 'web-member-b-read';
    webHttpRoute = { observedHttpRequests: 0, blockedHttpRequests: 0 };
    const webContext = await makeMemberBContext(browser, fixture, webHttpRoute);
    contexts.push(webContext);
    const webPage = await authenticateMemberB(webContext, fixture);
    const webElement = await openFixtureRoom(webPage, fixture);
    const webRead = waitForGatewayResponse(webPage, fixture, 'GET');
    const webFrame = await openCalendarWidget(webPage, webElement);
    const webReadResponse = await webRead;
    if (webReadResponse.status() !== 200) {
      throw new Error('Second member calendar read failed');
    }
    const eventRow = webFrame.getByRole('listitem', {
      name: initialTitle,
      exact: true,
    });
    await eventRow.waitFor({ state: 'visible' });
    const eventButton = eventRow.getByRole('button');
    recordPhase(evidence, recorded, 'web-member-b-read');

    currentPhase = 'web-member-b-keyboard-open';
    await tabToEventButton(webPage, eventButton);
    await webPage.keyboard.press('Enter');
    const detailsDialog = webFrame.getByRole('dialog').last();
    await detailsDialog.waitFor({ state: 'visible' });
    await detailsDialog
      .getByText(initialTitle, { exact: true })
      .waitFor({ state: 'visible' });
    recordPhase(evidence, recorded, 'web-member-b-keyboard-open');

    currentPhase = 'web-member-b-details-escape-focus';
    await webPage.keyboard.press('Tab');
    const focusStayedInDetails = await detailsDialog.evaluate((dialog) =>
      dialog.contains(dialog.ownerDocument.activeElement),
    );
    if (!focusStayedInDetails) {
      throw new Error('Details dialog did not retain keyboard focus');
    }
    await webPage.keyboard.press('Escape');
    await detailsDialog.waitFor({ state: 'hidden' });
    const focusReturnedToOpener = await eventButton.evaluate(
      (button) => button === button.ownerDocument.activeElement,
    );
    if (!focusReturnedToOpener) {
      throw new Error('Details dialog did not restore opener focus');
    }
    recordPhase(evidence, recorded, 'web-member-b-details-escape-focus');

    currentPhase = 'web-member-b-edit-save';
    await webPage.keyboard.press('Enter');
    await detailsDialog.waitFor({ state: 'visible' });
    await detailsDialog
      .getByRole('button', { name: 'Edit', exact: true })
      .click();
    const editor = webFrame.getByRole('dialog').last();
    const updateResponse = waitForGatewayResponse(webPage, fixture, 'PATCH');
    await editor
      .getByRole('textbox', { name: 'Title', exact: true })
      .fill(editedTitle);
    await editor.getByRole('button', { name: 'Save', exact: true }).click();
    const updated = await updateResponse;
    if (updated.status() < 200 || updated.status() >= 300) {
      throw new Error('Second member event edit failed');
    }
    await webFrame
      .getByRole('listitem', { name: editedTitle, exact: true })
      .waitFor({ state: 'visible' });
    recordPhase(evidence, recorded, 'web-member-b-edit-save');

    currentPhase = 'desktop-a-refresh';
    const roomFrame = desktopElement.widgetByTitle('Matrix Calendar');
    const refreshedRoomRead = waitForGatewayResponse(
      desktopPage,
      fixture,
      'GET',
    );
    await desktopPage.reload({ waitUntil: 'domcontentloaded' });
    await desktopPage
      .getByRole('tree', { name: 'Rooms', exact: true })
      .waitFor({ state: 'visible', timeout: 60_000 });
    await desktopElement.navigateToRoomOrInvitation(fixture.roomName);
    if (desktopElement.getCurrentRoomId() !== fixture.teamRoomId) {
      throw new Error('Desktop refreshed into an unexpected room');
    }
    await openCalendarWidget(desktopPage, desktopElement);
    const refreshed = await refreshedRoomRead;
    if (refreshed.status() !== 200) {
      throw new Error('Desktop refreshed calendar read failed');
    }
    await desktopPage
      .locator('iframe[title="Matrix Calendar"]')
      .waitFor({ state: 'attached', timeout: 30_000 });
    const refreshedRow = roomFrame.getByRole('listitem', {
      name: editedTitle,
      exact: true,
    });
    await refreshedRow.waitFor({ state: 'visible' });
    recordPhase(evidence, recorded, 'desktop-a-refresh');

    currentPhase = 'canonical-edit-read';
    const query = new URL(refreshed.url()).searchParams;
    if (
      query.get('roomId') !== fixture.teamRoomId ||
      query.get('calendarId') !== fixture.calendarId ||
      query.get('target') !== 'room' ||
      !(await responseContainsEventTitle(
        refreshed,
        fixture.calendarId,
        editedTitle,
      ))
    ) {
      throw new Error(
        'Canonical calendar read did not contain the second member edit',
      );
    }
    recordPhase(evidence, recorded, 'canonical-edit-read');
  } catch {
    failed = true;
    if (currentPhase && evidenceInitialized && !recorded.has(currentPhase)) {
      safeRecordPhase(evidence, recorded, currentPhase, 'failed');
    }
  } finally {
    await Promise.all(
      contexts.map(async (context) => {
        await context.close().catch(() => undefined);
      }),
    );
    if (desktopBrowser) {
      await desktopBrowser.close().catch(() => undefined);
    }
    if (
      evidenceInitialized &&
      webHttpRoute &&
      !recorded.has('web-http-route-enforcement')
    ) {
      const routePolicyEnforced =
        webHttpRoute.observedHttpRequests > 0 &&
        webHttpRoute.blockedHttpRequests === 0;
      if (!routePolicyEnforced) failed = true;
      if (
        !safeRecordPhase(
          evidence,
          recorded,
          'web-http-route-enforcement',
          routePolicyEnforced ? 'passed' : 'failed',
        )
      ) {
        failed = true;
      }
    }
  }

  if (failed) {
    throw new Error('Element Desktop calendar acceptance journey failed');
  }
});

async function connectToDesktop(): Promise<Browser> {
  const rawPort = process.env.ELEMENT_DESKTOP_CDP_PORT;
  if (!rawPort || !/^\d{1,5}$/u.test(rawPort)) {
    throw new Error('Desktop connection is unavailable');
  }
  const port = Number(rawPort);
  if (port < 1 || port > 65_535) {
    throw new Error('Desktop connection is unavailable');
  }
  return chromium.connectOverCDP(`http://127.0.0.1:${port}`, {
    timeout: 20_000,
  });
}

async function getDesktopPage(browser: Browser): Promise<Page> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const page = browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((candidate) =>
        candidate.url().startsWith('vector://vector/webapp/'),
      );
    if (page) return page;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error('Desktop application page is unavailable');
}

async function waitForDesktopMatrixUser(
  page: Page,
  expectedUserId: string,
): Promise<boolean> {
  return page
    .waitForFunction(
      (userId) => {
        type MatrixClient = { getUserId?: () => string | null };
        type MatrixClientPeg = { get?: () => MatrixClient | undefined };
        try {
          const peg = (
            window as unknown as { mxMatrixClientPeg?: MatrixClientPeg }
          ).mxMatrixClientPeg;
          return peg?.get?.()?.getUserId?.() === userId;
        } catch {
          return false;
        }
      },
      expectedUserId,
      { timeout: 30_000 },
    )
    .then(() => true)
    .catch(() => false);
}

async function assertDesktopWidgetAttachment(page: Page, widgetUrl: string) {
  const iframe = page.locator('iframe[title="Matrix Calendar"]');
  await iframe.waitFor({ state: 'attached', timeout: 30_000 });
  const desktopUrl = new URL(page.mainFrame().url());
  const widgetOrigin = new URL(widgetUrl).origin;
  const widgetFrame = page.frames().find((frame) => {
    if (frame.parentFrame() !== page.mainFrame()) return false;
    try {
      return new URL(frame.url()).origin === widgetOrigin;
    } catch {
      return false;
    }
  });
  const widgetFrameOrigin = widgetFrame
    ? new URL(widgetFrame.url()).origin
    : undefined;
  if (
    desktopUrl.protocol !== 'vector:' ||
    desktopUrl.hostname !== 'vector' ||
    desktopUrl.origin === widgetOrigin ||
    widgetFrameOrigin !== widgetOrigin ||
    widgetFrameOrigin === desktopUrl.origin
  ) {
    throw new Error(
      'Desktop widget origin isolation did not match the packaged client',
    );
  }
}

async function makeMemberBContext(
  browser: Browser,
  fixture: Fixture,
  routeObservation: WebHttpRouteObservation,
): Promise<BrowserContext> {
  const context = await browser.newContext({
    locale: 'en-US',
    timezoneId: 'Europe/Stockholm',
    viewport: { width: 1440, height: 900 },
  });
  const allowedOrigins = new Set([
    new URL(fixture.elementUrl).origin,
    new URL(fixture.homeserverUrl).origin,
    'http://localhost:8008',
    new URL(fixture.gatewayUrl).origin,
    new URL(fixture.widgetUrl).origin,
  ]);
  await context.route('**/*', async (route) => {
    const requestUrl = parseHttpRequestUrl(route.request());
    if (!requestUrl) {
      await route.abort('blockedbyclient');
      return;
    }
    routeObservation.observedHttpRequests = Math.min(
      routeObservation.observedHttpRequests + 1,
      100_000,
    );
    if (!allowedOrigins.has(requestUrl.origin)) {
      routeObservation.blockedHttpRequests = Math.min(
        routeObservation.blockedHttpRequests + 1,
        100_000,
      );
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });
  return context;
}

function parseHttpRequestUrl(request: Request) {
  let requestUrl: URL;
  try {
    requestUrl = new URL(request.url());
  } catch {
    return undefined;
  }
  if (requestUrl.protocol !== 'http:' && requestUrl.protocol !== 'https:') {
    return undefined;
  }
  return requestUrl;
}

async function authenticateMemberB(
  context: BrowserContext,
  fixture: Fixture,
): Promise<Page> {
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  await page.goto(new URL('/welcome/images/logo.svg', fixture.elementUrl).href);
  await page.evaluate(
    ({ homeserverUrl, user }) => {
      window.localStorage.setItem('mx_hs_url', homeserverUrl);
      window.localStorage.setItem('mx_user_id', user.userId);
      window.localStorage.setItem('mx_access_token', user.accessToken);
      window.localStorage.setItem('mx_device_id', user.deviceId);
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
    { homeserverUrl: fixture.homeserverUrl, user: fixture.users.memberB },
  );
  await page.goto(fixture.elementUrl);
  const sessionReady = await page
    .waitForFunction(
      (expectedUserId) => {
        type MatrixClient = { getUserId?: () => string | null };
        type MatrixClientPeg = { get?: () => MatrixClient | undefined };
        try {
          const peg = (
            window as unknown as { mxMatrixClientPeg?: MatrixClientPeg }
          ).mxMatrixClientPeg;
          return peg?.get?.()?.getUserId?.() === expectedUserId;
        } catch {
          return false;
        }
      },
      fixture.users.memberB.userId,
      { timeout: 30_000 },
    )
    .then(() => true)
    .catch(() => false);
  if (!sessionReady) {
    throw new Error('Second member session did not become ready');
  }
  return page;
}

async function openFixtureRoom(
  page: Page,
  fixture: Fixture,
): Promise<ElementWebPage> {
  const element = new ElementWebPage(page);
  await element.navigateToRoomOrInvitation(fixture.roomName);
  await element.roomNameText
    .getByText(fixture.roomName, { exact: true })
    .waitFor({ state: 'visible' });
  if (element.getCurrentRoomId() !== fixture.teamRoomId) {
    throw new Error('Second member opened an unexpected room');
  }
  return element;
}

async function openCalendarWidget(
  page: Page,
  element: ElementWebPage,
): Promise<FrameLocator> {
  const iframe = page.locator('iframe[title="Matrix Calendar"]');
  if (!(await iframe.isVisible().catch(() => false))) {
    await page
      .locator('header.mx_RoomHeader button.mx_RoomHeader_infoWrapper')
      .click();
    const rightPanel = page.getByRole('complementary');
    await rightPanel.getByRole('menuitem', { name: 'Extensions' }).click();
    await rightPanel.getByRole('button', { name: 'Matrix Calendar' }).click();

    const warningContinue = page
      .getByText('Widget added by')
      .locator('..')
      .getByRole('button', { name: 'Continue', exact: true });
    if (await warningContinue.isVisible().catch(() => false)) {
      await warningContinue.click();
    }

    const permissions = page.getByRole('dialog').last();
    if (await permissions.isVisible().catch(() => false)) {
      const rememberSwitch = permissions.getByRole('switch', {
        name: 'Remember my selection for this widget',
      });
      if (await rememberSwitch.isVisible().catch(() => false)) {
        await rememberSwitch.click();
      }
      const approve = permissions.getByRole('button', {
        name: 'Approve',
        exact: true,
      });
      if (await approve.isVisible().catch(() => false)) await approve.click();
    }

    const identityContinue = page
      .getByRole('dialog')
      .getByRole('button', { name: 'Continue', exact: true })
      .first();
    if (await identityContinue.isVisible().catch(() => false)) {
      await identityContinue.click();
    }
    await iframe.waitFor({ state: 'attached', timeout: 30_000 });
  }
  void element;
  return element.widgetByTitle('Matrix Calendar');
}

async function createEvent(
  frame: FrameLocator,
  title: string,
  calendarId: string,
) {
  await frame
    .getByRole('button', { name: 'Create event', exact: true })
    .click();
  const dialog = frame.getByRole('dialog').last();
  await dialog.waitFor({ state: 'visible' });
  await dialog.getByRole('combobox', { name: 'Calendar' }).selectOption({
    value: `matrix-calendar-target://room/${encodeURIComponent(calendarId)}`,
  });
  await dialog.getByRole('textbox', { name: 'Title', exact: true }).fill(title);
  await dialog
    .getByRole('button', { name: 'Create event', exact: true })
    .click();
}

async function tabToEventButton(page: Page, eventButton: Locator) {
  for (let index = 0; index < 120; index += 1) {
    await page.keyboard.press('Tab');
    if (
      await eventButton
        .evaluate((button) => button === button.ownerDocument.activeElement)
        .catch(() => false)
    ) {
      return;
    }
  }
  throw new Error('Keyboard navigation did not reach the event');
}

function waitForGatewayResponse(
  page: Page,
  fixture: Fixture,
  method: 'GET' | 'POST' | 'PATCH',
) {
  return page.waitForResponse(
    (response) => {
      try {
        const url = new URL(response.url());
        const query = url.searchParams;
        return (
          url.origin === new URL(fixture.gatewayUrl).origin &&
          url.pathname === '/v1/calendar/events' &&
          response.request().method() === method &&
          query.get('roomId') === fixture.teamRoomId &&
          query.get('calendarId') === fixture.calendarId &&
          query.get('target') === 'room'
        );
      } catch {
        return false;
      }
    },
    { timeout: 30_000 },
  );
}

async function responseContainsEventTitle(
  response: Awaited<ReturnType<typeof waitForGatewayResponse>>,
  calendarId: string,
  title: string,
) {
  try {
    const body: unknown = await response.json();
    if (!body || typeof body !== 'object' || !('events' in body)) return false;
    const events = (body as { events?: unknown }).events;
    if (!Array.isArray(events)) return false;
    return events.some((resource) => {
      if (!resource || typeof resource !== 'object' || !('event' in resource)) {
        return false;
      }
      const event = (resource as { event?: unknown }).event;
      return (
        Boolean(event) &&
        typeof event === 'object' &&
        'title' in event &&
        'calendarId' in event &&
        event.title === title &&
        event.calendarId === calendarId
      );
    });
  } catch {
    return false;
  }
}

function requireAbsoluteEnvironment(name: string) {
  const value = process.env[name];
  if (!value || !isAbsolute(value)) {
    throw new Error('Desktop journey runner input is unavailable');
  }
  return resolve(value);
}

function requirePrivateRunnerPath(
  environmentName: string,
  runnerTemp: string,
  fileName: string,
) {
  const value = process.env[environmentName];
  if (
    !value ||
    !isAbsolute(value) ||
    resolve(value) !== resolve(runnerTemp, fileName)
  ) {
    throw new Error('Desktop journey runner input is unavailable');
  }
  return resolve(value);
}

function requirePrivateRunnerFile(
  environmentName: string,
  runnerTemp: string,
  fileName: string,
) {
  const filePath = requirePrivateRunnerPath(
    environmentName,
    runnerTemp,
    fileName,
  );
  let stat;
  try {
    stat = lstatSync(filePath);
  } catch {
    throw new Error('Desktop journey runner input is unavailable');
  }
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    (stat.mode & 0o777) !== 0o600 ||
    stat.size > 65_536 ||
    (typeof process.getuid === 'function' && stat.uid !== process.getuid())
  ) {
    throw new Error('Desktop journey runner input is unavailable');
  }
  return filePath;
}

function readFixture(filePath: string): Fixture {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    throw new Error('Element acceptance fixture is unavailable');
  }
  if (!value || typeof value !== 'object') {
    throw new Error('Element acceptance fixture is unavailable');
  }
  const fixture = value as Partial<Fixture>;
  if (
    fixture.homeserverUrl !== FIXTURE_VALUES.homeserverUrl ||
    fixture.elementUrl !== FIXTURE_VALUES.elementUrl ||
    fixture.gatewayUrl !== FIXTURE_VALUES.gatewayUrl ||
    fixture.widgetUrl !== FIXTURE_VALUES.widgetUrl ||
    typeof fixture.roomName !== 'string' ||
    typeof fixture.teamRoomId !== 'string' ||
    typeof fixture.calendarId !== 'string' ||
    typeof fixture.users?.memberA?.userId !== 'string' ||
    typeof fixture.users?.memberB?.userId !== 'string' ||
    typeof fixture.users.memberB.accessToken !== 'string' ||
    typeof fixture.users.memberB.deviceId !== 'string'
  ) {
    throw new Error('Element acceptance fixture is unavailable');
  }
  return fixture as Fixture;
}

function safeRecordPhase(
  evidence: { filePath: string; runnerTemp: string },
  recorded: Set<DesktopJourneyPhase>,
  phase: DesktopJourneyPhase,
  status: 'passed' | 'failed',
) {
  try {
    appendDesktopJourneyOutcome({ ...evidence, phase, status });
    recorded.add(phase);
    return true;
  } catch {
    return false;
  }
}

function recordPhase(
  evidence: { filePath: string; runnerTemp: string },
  recorded: Set<DesktopJourneyPhase>,
  phase: DesktopJourneyPhase,
) {
  appendDesktopJourneyOutcome({ ...evidence, phase, status: 'passed' });
  recorded.add(phase);
}
