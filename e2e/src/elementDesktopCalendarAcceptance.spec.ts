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
  type Response,
} from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { hasUniqueWidgetFrameOwnedByElement } from '../../dev/element-desktop-frame-origin.mjs';
import {
  appendDesktopJourneyOutcome,
  appendDesktopLoginStep,
  classifyDesktopLoginFailure,
  collectWebBEventTitleMatches,
  desktopWidgetIsReady,
  enterDesktopPasswordLogin,
  findUniqueWebBEventId,
  initializeDesktopJourneyEvidence,
  isBoundedWebBEventListBodyLength,
  isBoundedWebBEventListResponse,
  prepareDesktopWidget,
  readOnlyWidgetIsReady,
  readSyntheticDesktopCredentials,
  type DesktopGatewayReadFailureDiagnostic,
  type DesktopJourneyFailurePoint,
  type DesktopJourneyPhase,
  type DesktopLoginDiagnostic,
  type DesktopLoginEntry,
  type DesktopLoginFieldObservation,
  type DesktopLoginFormObservation,
  type DesktopLoginStep,
  type DesktopRoomsReadyDiagnostic,
  type DesktopRoomsReadyElementObservation,
  type WebBEditSaveFailureDiagnostic,
  type WebBEventListReadDiagnostic,
} from '../../dev/element-desktop-journey.mjs';
import { ElementWebPage, getMainRoomListLocator } from './pages/elementWebPage';

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

type DesktopWidgetPromptObservation = Pick<
  DesktopGatewayReadFailureDiagnostic,
  | 'widgetWarningObserved'
  | 'widgetWarningContinued'
  | 'capabilityPromptObserved'
  | 'capabilityApproved'
  | 'identityApprovalAttempted'
  | 'identityApprovalCompleted'
>;

type DesktopGatewayReadRequestObserver = {
  snapshot: () => Pick<
    DesktopGatewayReadFailureDiagnostic,
    'eventsGetCandidateCountCapped' | 'expectedRoomCalendarGetObserved'
  >;
  stop: () => void;
};

type WebBEventListReadObserver = {
  snapshot: () => WebBEventListReadDiagnostic;
  markPatchResponseObserved: () => void;
  stop: () => void;
};

const WEB_B_EVENT_LIST_DIAGNOSTIC_DEADLINE_MS = 500;

const FIXTURE_VALUES = Object.freeze({
  homeserverUrl: 'http://127.0.0.1:8008',
  elementUrl: 'http://127.0.0.1:8090',
  gatewayUrl: 'http://127.0.0.1:3000',
  widgetUrl: 'http://127.0.0.1:8080',
});

const DESKTOP_CREDENTIALS_NAME = 'element-acceptance-desktop-credentials.json';
const DESKTOP_EVIDENCE_NAME = 'element-desktop-journey-stage.jsonl';
const DESKTOP_GATEWAY_READ_FAILURE_POINTS = new Set<DesktopJourneyFailurePoint>(
  [
    'widget-open',
    'gateway-read-await',
    'gateway-read-status',
    'create-control',
  ],
);

function unavailableDesktopWidgetPromptObservation(): DesktopWidgetPromptObservation {
  return {
    widgetWarningObserved: null,
    widgetWarningContinued: null,
    capabilityPromptObserved: null,
    capabilityApproved: null,
    identityApprovalAttempted: null,
    identityApprovalCompleted: null,
  };
}

function unavailableDesktopGatewayReadFailureDiagnostic(): DesktopGatewayReadFailureDiagnostic {
  return {
    eventsGetCandidateCountCapped: null,
    expectedRoomCalendarGetObserved: null,
    ...unavailableDesktopWidgetPromptObservation(),
    iframeAttached: null,
    createControlVisible: null,
  };
}

function observeDesktopGatewayReadRequests(
  page: Page,
  fixture: Fixture,
): DesktopGatewayReadRequestObserver | undefined {
  let eventsGetCandidateCountCapped: 0 | 1 | 2 = 0;
  let expectedRoomCalendarGetObserved = false;
  let stopped = false;
  let gatewayOrigin: string;
  try {
    gatewayOrigin = new URL(fixture.gatewayUrl).origin;
  } catch {
    return undefined;
  }

  const observeRequest = (request: Request) => {
    try {
      const requestUrl = new URL(request.url());
      if (
        requestUrl.origin !== gatewayOrigin ||
        requestUrl.pathname !== '/v1/calendar/events' ||
        request.method() !== 'GET'
      ) {
        return;
      }
      eventsGetCandidateCountCapped = Math.min(
        eventsGetCandidateCountCapped + 1,
        2,
      ) as 0 | 1 | 2;
      const query = requestUrl.searchParams;
      if (
        query.get('roomId') === fixture.teamRoomId &&
        query.get('calendarId') === fixture.calendarId &&
        query.get('target') === 'room'
      ) {
        expectedRoomCalendarGetObserved = true;
      }
    } catch {
      // Request details stay in memory; malformed observations are omitted.
    }
  };

  try {
    page.on('request', observeRequest);
  } catch {
    return undefined;
  }
  return {
    snapshot: () => ({
      eventsGetCandidateCountCapped,
      expectedRoomCalendarGetObserved,
    }),
    stop: () => {
      if (stopped) return;
      stopped = true;
      try {
        page.off('request', observeRequest);
      } catch {
        // Cleanup is best effort after the read boundary.
      }
    },
  };
}

async function observeDesktopGatewayReadFailureDiagnostic(
  page: Page,
  requestObserver: DesktopGatewayReadRequestObserver | undefined,
  promptObservation: DesktopWidgetPromptObservation,
  widgetFrame: FrameLocator | undefined,
): Promise<DesktopGatewayReadFailureDiagnostic> {
  const requestObservation = requestObserver?.snapshot() ?? {
    eventsGetCandidateCountCapped: null,
    expectedRoomCalendarGetObserved: null,
  };
  requestObserver?.stop();

  let iframeAttached: boolean | null = null;
  try {
    iframeAttached =
      (await page.locator('iframe[title="Matrix Calendar"]').count()) > 0;
  } catch {
    // Preserve unavailable separately from an observed missing iframe.
  }

  let createControlVisible: boolean | null = null;
  try {
    const frame =
      widgetFrame ?? page.frameLocator('iframe[title="Matrix Calendar"]');
    const createControl = frame.getByRole('button', {
      name: 'Create event',
      exact: true,
    });
    const count = await createControl.count();
    if (count === 0) {
      createControlVisible = false;
    } else if (count === 1) {
      createControlVisible = await createControl.isVisible();
    }
  } catch {
    // No wait or retry is added at this failure boundary.
  }

  return {
    ...requestObservation,
    ...promptObservation,
    iframeAttached,
    createControlVisible,
  };
}

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
  let roomsReadyIdentity: { memberAId: string; roomId: string } | undefined;
  const recorded = new Set<DesktopJourneyPhase>();
  const contexts: BrowserContext[] = [];
  let desktopBrowser: Browser | undefined;
  let desktopPage: Page | undefined;
  let desktopWidgetFrame: FrameLocator | undefined;
  let desktopGatewayReadObserver: DesktopGatewayReadRequestObserver | undefined;
  let webBEventListReadObserver: WebBEventListReadObserver | undefined;
  const desktopWidgetPromptObservation =
    unavailableDesktopWidgetPromptObservation();
  let webHttpRoute: WebHttpRouteObservation | undefined;
  let currentPhase: DesktopJourneyPhase | undefined;
  let currentFailurePoint: DesktopJourneyFailurePoint | undefined;
  let webBEditPatchStatus: number | null = null;
  const enterPhase = (phase: DesktopJourneyPhase) => {
    currentPhase = phase;
    currentFailurePoint = undefined;
  };
  let currentLoginStep: DesktopLoginStep = 'not_observed';
  let loginEntry: DesktopLoginEntry = 'not_observed';
  let loginFieldsBeforeFill = unavailableDesktopLoginFormObservation();
  let failed = false;
  let evidenceInitialized = false;

  try {
    initializeDesktopJourneyEvidence(evidence);
    evidenceInitialized = true;
    fixture = readFixture(usersFile);
    roomsReadyIdentity = {
      memberAId: fixture.users.memberA.userId,
      roomId: fixture.teamRoomId,
    };

    enterPhase('desktop-login');
    currentLoginStep = 'cdp_connect';
    desktopBrowser = await connectToDesktop();
    currentLoginStep = 'page_select';
    const loginPage = await getDesktopPage(desktopBrowser);
    desktopPage = loginPage;
    loginPage.setDefaultTimeout(30_000);
    currentLoginStep = 'credentials_read';
    const credentials = readSyntheticDesktopCredentials({
      filePath: credentialsFile,
      runnerTemp,
    });
    currentLoginStep = 'login_form_select';
    const username = desktopPage.getByRole('textbox', {
      name: 'Username',
      exact: true,
    });
    const password = desktopPage.getByRole('textbox', {
      name: 'Password',
      exact: true,
    });
    const initialLoginForm = await observeDesktopLoginForm(username, password);
    loginFieldsBeforeFill = initialLoginForm;
    try {
      await enterDesktopPasswordLogin({
        initialForm: initialLoginForm,
        clickWelcomeSignIn: () =>
          loginPage.locator('a[href="#/login"]').click(),
        observeForm: () => observeDesktopLoginForm(username, password),
        onBeforeFill: (form) => {
          loginFieldsBeforeFill = form;
        },
        fillCredentials: async () => {
          currentLoginStep = 'username_fill';
          await username.fill(credentials.username);
          currentLoginStep = 'password_fill';
          await password.fill(credentials.password);
        },
        setLoginEntry: (entry) => {
          loginEntry = entry;
        },
        setLoginStep: (step) => {
          currentLoginStep = step;
        },
      });
    } finally {
      credentials.password = '';
    }
    currentLoginStep = 'sign_in_submit';
    await desktopPage
      .getByRole('button', { name: 'Sign in', exact: true })
      .click();
    const desktopElement = new ElementWebPage(desktopPage);
    currentLoginStep = 'rooms_ready';
    await desktopElement.waitForRoomsList(60_000);
    currentLoginStep = 'complete';
    appendDesktopLoginStep({
      ...evidence,
      step: currentLoginStep,
      entry: loginEntry,
    });
    recordPhase(evidence, recorded, 'desktop-login');

    enterPhase('desktop-member-identity');
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

    enterPhase('desktop-room-widget-read');
    currentFailurePoint = 'room-navigation';
    await desktopElement.navigateToRoomOrInvitation(fixture.roomName);
    currentFailurePoint = 'room-heading';
    await desktopElement.roomNameText
      .getByText(fixture.roomName, { exact: true })
      .waitFor({ state: 'visible' });
    currentFailurePoint = 'room-id';
    if (desktopElement.getCurrentRoomId() !== fixture.teamRoomId) {
      throw new Error('Desktop opened an unexpected room');
    }
    currentFailurePoint = 'gateway-read-await';
    const desktopReadPromise = waitForGatewayResponse(
      desktopPage,
      fixture,
      'GET',
    );
    desktopGatewayReadObserver = observeDesktopGatewayReadRequests(
      desktopPage,
      fixture,
    );
    currentFailurePoint = 'widget-open';
    const desktopFrame = await openElementCalendarWidget(
      desktopPage,
      desktopElement,
      desktopWidgetPromptObservation,
    );
    desktopWidgetFrame = desktopFrame;
    currentFailurePoint = 'gateway-read-await';
    const desktopRead = await desktopReadPromise;
    currentFailurePoint = 'gateway-read-status';
    if (desktopRead.status() !== 200) {
      throw new Error('Desktop calendar read failed');
    }
    currentFailurePoint = 'create-control';
    await desktopFrame
      .getByRole('button', { name: 'Create event', exact: true })
      .waitFor({ state: 'visible' });
    desktopGatewayReadObserver?.stop();
    desktopGatewayReadObserver = undefined;
    currentFailurePoint = undefined;
    enterPhase('desktop-widget-origin-isolation');
    currentFailurePoint = 'origin-isolation';
    await assertDesktopWidgetAttachment(desktopPage, fixture.widgetUrl);
    currentFailurePoint = undefined;
    recordPhase(evidence, recorded, 'desktop-widget-origin-isolation');
    enterPhase('desktop-room-widget-read');
    recordPhase(evidence, recorded, 'desktop-room-widget-read');

    currentFailurePoint = undefined;
    enterPhase('desktop-event-create');
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

    enterPhase('web-member-b-read');
    currentFailurePoint = 'web-b-authentication';
    webHttpRoute = { observedHttpRequests: 0, blockedHttpRequests: 0 };
    const webContext = await makeMemberBContext(browser, fixture, webHttpRoute);
    contexts.push(webContext);
    const webPage = await authenticateMemberB(webContext, fixture);
    currentFailurePoint = undefined;
    currentFailurePoint = 'web-b-room-navigation';
    const webElement = await openFixtureRoom(webPage, fixture);
    currentFailurePoint = undefined;
    const webRead = waitForGatewayResponse(webPage, fixture, 'GET');
    currentFailurePoint = 'web-b-widget-open';
    const webFrame = await openElementCalendarWidget(
      webPage,
      webElement,
      undefined,
      async (readinessPage, readinessFrame) =>
        readOnlyWidgetIsReady(
          await observeReadOnlyWidgetReadiness(
            readinessPage,
            readinessFrame,
            initialTitle,
          ),
        ),
    );
    currentFailurePoint = 'web-b-gateway-read-await';
    const webReadResponse = await webRead;
    currentFailurePoint = 'web-b-gateway-read-status';
    if (webReadResponse.status() !== 200) {
      throw new Error('Second member calendar read failed');
    }
    webBEventListReadObserver = observeWebBEventListRefetch(
      webPage,
      fixture,
      webReadResponse,
      initialTitle,
      editedTitle,
    );
    currentFailurePoint = 'web-b-event-row';
    const eventRow = webFrame.getByRole('listitem', {
      name: initialTitle,
      exact: true,
    });
    await eventRow.waitFor({ state: 'visible' });
    const eventButton = eventRow.getByRole('button');
    currentFailurePoint = undefined;
    recordPhase(evidence, recorded, 'web-member-b-read');

    enterPhase('web-member-b-keyboard-open');
    await tabToEventButton(webPage, eventButton);
    await webPage.keyboard.press('Enter');
    const detailsDialog = webFrame.getByRole('dialog').last();
    await detailsDialog.waitFor({ state: 'visible' });
    await detailsDialog
      .getByText(initialTitle, { exact: true })
      .waitFor({ state: 'visible' });
    recordPhase(evidence, recorded, 'web-member-b-keyboard-open');

    enterPhase('web-member-b-details-escape-focus');
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

    enterPhase('web-member-b-edit-save');
    currentFailurePoint = 'web-b-edit-details-open';
    await webPage.keyboard.press('Enter');
    await detailsDialog.waitFor({ state: 'visible' });
    currentFailurePoint = 'web-b-edit-open';
    await detailsDialog
      .getByRole('button', { name: 'Edit', exact: true })
      .click();
    const editor = webFrame.getByRole('dialog').last();
    const updateResponse = waitForGatewayResponse(webPage, fixture, 'PATCH');
    currentFailurePoint = 'web-b-edit-title-fill';
    await editor
      .getByRole('textbox', { name: 'Title', exact: true })
      .fill(editedTitle);
    currentFailurePoint = 'web-b-edit-save-click';
    await editor.getByRole('button', { name: 'Save', exact: true }).click();
    currentFailurePoint = 'web-b-edit-patch-await';
    const updated = await updateResponse;
    webBEventListReadObserver?.markPatchResponseObserved();
    webBEditPatchStatus = updated.status();
    currentFailurePoint = 'web-b-edit-patch-status';
    if (webBEditPatchStatus < 200 || webBEditPatchStatus >= 300) {
      throw new Error('Second member event edit failed');
    }
    currentFailurePoint = 'web-b-edit-details-returned';
    const savedDetailsDialog = webFrame.getByRole('dialog').last();
    await savedDetailsDialog.waitFor({ state: 'visible' });
    currentFailurePoint = 'web-b-edit-details-close-click';
    await savedDetailsDialog
      .getByRole('button', { name: 'Close', exact: true })
      .click();
    currentFailurePoint = 'web-b-edit-details-close-hidden';
    await savedDetailsDialog.waitFor({ state: 'hidden' });
    currentFailurePoint = 'web-b-edit-event-row';
    await webFrame
      .getByRole('listitem', { name: editedTitle, exact: true })
      .waitFor({ state: 'visible' });
    webBEventListReadObserver.stop();
    webBEventListReadObserver = undefined;
    recordPhase(evidence, recorded, 'web-member-b-edit-save');

    enterPhase('desktop-a-refresh');
    const roomFrame = desktopElement.widgetByTitle('Matrix Calendar');
    const refreshedRoomRead = waitForGatewayResponse(
      desktopPage,
      fixture,
      'GET',
    );
    await desktopPage.reload({ waitUntil: 'domcontentloaded' });
    await desktopElement.waitForRoomsList(60_000);
    await desktopElement.navigateToRoomOrInvitation(fixture.roomName);
    if (desktopElement.getCurrentRoomId() !== fixture.teamRoomId) {
      throw new Error('Desktop refreshed into an unexpected room');
    }
    await openElementCalendarWidget(desktopPage, desktopElement);
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

    enterPhase('canonical-edit-read');
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
  } catch (error: unknown) {
    failed = true;
    if (currentPhase === 'desktop-login' && evidenceInitialized) {
      if (currentLoginStep === 'rooms_ready') {
        const roomsReadyDiagnostic = desktopPage
          ? await observeDesktopRoomsReady(
              desktopPage,
              roomsReadyIdentity?.roomId ?? null,
              roomsReadyIdentity?.memberAId ?? null,
            )
          : unavailableDesktopRoomsReadyDiagnostic();
        safeRecordDesktopLoginStep(
          evidence,
          currentLoginStep,
          undefined,
          loginEntry,
          roomsReadyDiagnostic,
        );
      } else if (currentLoginStep !== 'complete') {
        const loginFieldsAtFailure = desktopPage
          ? await observeDesktopLoginForm(
              desktopPage.getByRole('textbox', {
                name: 'Username',
                exact: true,
              }),
              desktopPage.getByRole('textbox', {
                name: 'Password',
                exact: true,
              }),
            )
          : unavailableDesktopLoginFormObservation();
        const loginDiagnostic: DesktopLoginDiagnostic = {
          failureReason: classifyDesktopLoginFailure(
            error,
            currentLoginStep,
            loginFieldsBeforeFill,
            loginFieldsAtFailure,
          ),
          beforeFill: loginFieldsBeforeFill,
          atFailure: loginFieldsAtFailure,
        };
        safeRecordDesktopLoginStep(
          evidence,
          currentLoginStep,
          loginDiagnostic,
          loginEntry,
        );
      }
    }
    if (currentPhase && evidenceInitialized && !recorded.has(currentPhase)) {
      let gatewayReadDiagnostic:
        | DesktopGatewayReadFailureDiagnostic
        | undefined;
      if (
        currentPhase === 'desktop-room-widget-read' &&
        currentFailurePoint !== undefined &&
        DESKTOP_GATEWAY_READ_FAILURE_POINTS.has(currentFailurePoint)
      ) {
        try {
          gatewayReadDiagnostic = desktopPage
            ? await observeDesktopGatewayReadFailureDiagnostic(
                desktopPage,
                desktopGatewayReadObserver,
                desktopWidgetPromptObservation,
                desktopWidgetFrame,
              )
            : unavailableDesktopGatewayReadFailureDiagnostic();
        } catch {
          gatewayReadDiagnostic =
            unavailableDesktopGatewayReadFailureDiagnostic();
        }
      }
      desktopGatewayReadObserver?.stop();
      desktopGatewayReadObserver = undefined;
      let webBEditSaveDiagnostic: WebBEditSaveFailureDiagnostic | undefined;
      if (currentPhase === 'web-member-b-edit-save') {
        webBEditSaveDiagnostic = {
          matchedPatchStatus: webBEditPatchStatus,
          ...(currentFailurePoint === 'web-b-edit-event-row'
            ? {
                eventListRead:
                  webBEventListReadObserver?.snapshot() ??
                  unavailableWebBEventListReadDiagnostic(),
              }
            : {}),
        };
      }
      webBEventListReadObserver?.stop();
      webBEventListReadObserver = undefined;
      safeRecordPhase(
        evidence,
        recorded,
        currentPhase,
        'failed',
        currentFailurePoint,
        gatewayReadDiagnostic,
        webBEditSaveDiagnostic,
      );
    }
  } finally {
    webBEventListReadObserver?.stop();
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
  const iframeCount = await iframe.count();
  const iframeElement =
    iframeCount === 1 ? await iframe.elementHandle() : undefined;
  const desktopUrl = new URL(page.mainFrame().url());
  const widgetOrigin = new URL(widgetUrl).origin;
  const widgetFrameIsAttached =
    iframeElement !== undefined &&
    (await hasUniqueWidgetFrameOwnedByElement({
      getFrames: () => page.frames(),
      parentFrame: page.mainFrame(),
      ownerElement: iframeElement,
      expectedOrigin: widgetOrigin,
      timeoutMs: 30_000,
    }));
  if (
    desktopUrl.protocol !== 'vector:' ||
    desktopUrl.hostname !== 'vector' ||
    desktopUrl.origin === widgetOrigin ||
    iframeCount !== 1 ||
    !widgetFrameIsAttached
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

async function openElementCalendarWidget(
  page: Page,
  element: ElementWebPage,
  promptObservation?: DesktopWidgetPromptObservation,
  readinessCheck?: (page: Page, frame: FrameLocator) => Promise<boolean>,
): Promise<FrameLocator> {
  const iframe = page.locator('iframe[title="Matrix Calendar"]');
  const frame = element.widgetByTitle('Matrix Calendar');

  await prepareDesktopWidget({
    isReady: readinessCheck
      ? () => readinessCheck(page, frame)
      : async () =>
          desktopWidgetIsReady(
            await observeDesktopWidgetReadiness(page, frame),
          ),
    isIframeVisible: () => iframe.isVisible().catch(() => false),
    activateWidget: async () => {
      await page
        .locator('header.mx_RoomHeader button.mx_RoomHeader_infoWrapper')
        .click();
      const rightPanel = page.getByRole('complementary');
      await rightPanel.getByRole('menuitem', { name: 'Extensions' }).click();
      await rightPanel.getByRole('button', { name: 'Matrix Calendar' }).click();
    },
    approveWarning: async () => {
      const warningContinue = getDesktopWidgetWarningContinue(page);
      const warningVisible = await warningContinue
        .isVisible()
        .catch(() => null);
      if (promptObservation) {
        promptObservation.widgetWarningObserved = warningVisible;
        promptObservation.widgetWarningContinued =
          warningVisible === null ? null : false;
      }
      if (warningVisible === true) {
        await warningContinue.click();
        if (promptObservation) {
          promptObservation.widgetWarningContinued = true;
        }
      }
    },
    approveCapabilities: async () => {
      if (promptObservation) {
        const capabilityPromptVisible =
          await observeDesktopCapabilityPrompt(page);
        promptObservation.capabilityPromptObserved = capabilityPromptVisible;
        promptObservation.capabilityApproved =
          capabilityPromptVisible === null ? null : false;
      }
      await element.approveWidgetCapabilities();
      if (promptObservation) {
        // Completion of the source-backed approval action proves the specific
        // switch and Approve controls were present, even if the earlier
        // non-waiting snapshot preceded their render.
        promptObservation.capabilityPromptObserved = true;
        promptObservation.capabilityApproved = true;
      }
    },
    waitForIdentityContinue: async () => {
      const identityContinue = page
        .getByRole('dialog')
        .getByRole('button', { name: 'Continue', exact: true })
        .first();
      let identityContinueVisible: boolean | null = null;
      try {
        await identityContinue.waitFor({ state: 'visible', timeout: 8_000 });
        identityContinueVisible = await identityContinue
          .isVisible()
          .catch(() => null);
      } catch {
        // The existing Web flow treats this identity step as optional. An
        // unavailable generic Continue control is not evidence of absence.
        identityContinueVisible = await identityContinue
          .isVisible()
          .catch(() => null);
      }
      if (promptObservation) {
        promptObservation.identityApprovalAttempted = false;
        promptObservation.identityApprovalCompleted = false;
      }
      return identityContinueVisible === true;
    },
    approveIdentity: async () => {
      if (promptObservation) {
        promptObservation.identityApprovalAttempted = true;
        promptObservation.identityApprovalCompleted = false;
      }
      await element.approveWidgetIdentity();
      if (promptObservation) {
        promptObservation.identityApprovalCompleted = true;
      }
    },
    waitForIframe: () => iframe.waitFor({ state: 'attached', timeout: 30_000 }),
  });

  return frame;
}

async function observeDesktopWidgetReadiness(
  page: Page,
  frame: FrameLocator,
): Promise<{
  createControlCountCapped: 0 | 1 | 2 | null;
  createControlVisible: boolean | null;
  createControlEnabled: boolean | null;
  capabilityPromptVisible: boolean | null;
}> {
  const createControl = frame.getByRole('button', {
    name: 'Create event',
    exact: true,
  });
  let createControlCountCapped: 0 | 1 | 2 | null = null;
  let createControlVisible: boolean | null = null;
  let createControlEnabled: boolean | null = null;
  try {
    const count = await createControl.count();
    createControlCountCapped = Math.min(count, 2) as 0 | 1 | 2;
    if (count === 1) {
      createControlVisible = await createControl.isVisible();
      createControlEnabled = await createControl.isEnabled();
    }
  } catch {
    // A failed passive probe leaves readiness unknown and takes the consent
    // path; the later existing response and Create assertions remain required.
  }

  const capabilityPromptVisible = await observeDesktopCapabilityPrompt(page);
  return {
    createControlCountCapped,
    createControlVisible,
    createControlEnabled,
    capabilityPromptVisible,
  };
}

async function observeReadOnlyWidgetReadiness(
  page: Page,
  frame: FrameLocator,
  expectedTitle: string,
): Promise<{
  expectedEventRowCountCapped: 0 | 1 | 2 | null;
  expectedEventRowVisible: boolean | null;
  capabilityPromptVisible: boolean | null;
}> {
  const expectedEventRow = frame.getByRole('listitem', {
    name: expectedTitle,
    exact: true,
  });
  let expectedEventRowCountCapped: 0 | 1 | 2 | null = null;
  let expectedEventRowVisible: boolean | null = null;
  try {
    const count = await expectedEventRow.count();
    expectedEventRowCountCapped = Math.min(count, 2) as 0 | 1 | 2;
    if (count === 1) {
      expectedEventRowVisible = await expectedEventRow.isVisible();
    }
  } catch {
    // Unknown readiness stays on the ordinary consent path.
  }

  return {
    expectedEventRowCountCapped,
    expectedEventRowVisible,
    capabilityPromptVisible: await observeDesktopCapabilityPrompt(page),
  };
}

async function observeDesktopCapabilityPrompt(
  page: Page,
): Promise<boolean | null> {
  const dialogs = page.getByRole('dialog');
  let dialogCount: number;
  try {
    dialogCount = await dialogs.count();
  } catch {
    return null;
  }
  if (dialogCount === 0) return false;
  if (dialogCount !== 1) return null;

  const rememberSwitch = dialogs.getByRole('switch', {
    name: 'Remember my selection for this widget',
    exact: true,
  });
  const approveButton = dialogs.getByRole('button', {
    name: 'Approve',
    exact: true,
  });
  let switchCount: number;
  let approveCount: number;
  try {
    [switchCount, approveCount] = await Promise.all([
      rememberSwitch.count(),
      approveButton.count(),
    ]);
  } catch {
    return null;
  }
  if (switchCount > 1 || approveCount > 1) return null;
  if (switchCount === 0 || approveCount === 0) return false;

  try {
    const [switchVisible, approveVisible] = await Promise.all([
      rememberSwitch.isVisible(),
      approveButton.isVisible(),
    ]);
    return switchVisible && approveVisible;
  } catch {
    return null;
  }
}

function getDesktopWidgetWarningContinue(page: Page): Locator {
  return page
    .getByText('Widget added by')
    .locator('..')
    .getByRole('button', { name: 'Continue', exact: true });
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

function matchesGatewayUrl(rawUrl: string, fixture: Fixture) {
  try {
    const url = new URL(rawUrl);
    const query = url.searchParams;
    return (
      url.origin === new URL(fixture.gatewayUrl).origin &&
      url.pathname === '/v1/calendar/events' &&
      query.get('roomId') === fixture.teamRoomId &&
      query.get('calendarId') === fixture.calendarId &&
      query.get('target') === 'room'
    );
  } catch {
    return false;
  }
}

function matchesGatewayRequest(
  request: Request,
  fixture: Fixture,
  method: 'GET' | 'POST' | 'PATCH',
) {
  try {
    return (
      request.method() === method && matchesGatewayUrl(request.url(), fixture)
    );
  } catch {
    return false;
  }
}

function matchesGatewayResponse(
  response: Response,
  fixture: Fixture,
  method: 'GET' | 'POST' | 'PATCH',
) {
  try {
    return (
      response.request().method() === method &&
      matchesGatewayUrl(response.url(), fixture)
    );
  } catch {
    return false;
  }
}

function unavailableWebBEventListReadDiagnostic(): WebBEventListReadDiagnostic {
  return {
    state: 'unavailable',
    matchingGetRequestCountCapped: 0,
    matchingGetResponseCountCapped: 0,
    firstMatchedGetStatus: null,
    selectedEventIdentity: 'unavailable',
    sameEventObserved: null,
    sameEventEditedTitleMatch: null,
  };
}

function startBoundedResponseJsonRead(
  response: Response,
  onComplete: (body: unknown | null) => void,
) {
  let finished = false;
  let stopped = false;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const complete = (body: unknown | null) => {
    if (finished || stopped) return;
    finished = true;
    if (deadline !== undefined) clearTimeout(deadline);
    onComplete(body);
  };

  try {
    const headers = response.headers();
    if (!isBoundedWebBEventListResponse(headers)) {
      complete(null);
      return () => {
        stopped = true;
      };
    }
  } catch {
    complete(null);
    return () => {
      stopped = true;
    };
  }

  deadline = setTimeout(
    () => complete(null),
    WEB_B_EVENT_LIST_DIAGNOSTIC_DEADLINE_MS,
  );
  try {
    // Playwright buffers Response.body(); only read small identity-encoded JSON
    // responses and still verify the decoded buffer length before parsing.
    void response
      .body()
      .then((bytes) => {
        if (!isBoundedWebBEventListBodyLength(bytes.byteLength)) {
          complete(null);
          return;
        }
        try {
          complete(JSON.parse(bytes.toString('utf8')) as unknown);
        } catch {
          complete(null);
        }
      })
      .catch(() => complete(null));
  } catch {
    complete(null);
  }

  return () => {
    stopped = true;
    if (deadline !== undefined) clearTimeout(deadline);
  };
}

function observeWebBEventListRefetch(
  page: Page,
  fixture: Fixture,
  initialRead: Response,
  initialTitle: string,
  editedTitle: string,
): WebBEventListReadObserver {
  let selectedEventId: string | null = null;
  let selectedEventIdentity: WebBEventListReadDiagnostic['selectedEventIdentity'] =
    'pending';
  let eventTitleMatches: Map<string, boolean> | null = null;
  let state: WebBEventListReadDiagnostic['state'] = 'awaiting-events-get';
  let matchingGetRequestCountCapped: 0 | 1 | 2 = 0;
  let matchingGetResponseCountCapped: 0 | 1 | 2 = 0;
  let firstMatchedGetStatus: number | null = null;
  let patchResponseObserved = false;
  let stopped = false;
  let firstMatchingRequest: Request | undefined;
  const observedMatchingRequests = new WeakSet<Request>();
  const cancelBodyReads: Array<() => void> = [];

  let rangeQuery: { start: string; end: string; timezone: string } | undefined;
  try {
    if (!matchesGatewayResponse(initialRead, fixture, 'GET')) {
      throw new Error('unmatched initial response');
    }
    const query = new URL(initialRead.url()).searchParams;
    const start = query.get('start');
    const end = query.get('end');
    const timezone = query.get('timezone');
    if (
      !start ||
      !end ||
      !timezone ||
      start.length > 128 ||
      end.length > 128 ||
      timezone.length > 128
    ) {
      throw new Error('initial range unavailable');
    }
    rangeQuery = { start, end, timezone };
  } catch {
    state = 'unavailable';
  }

  const matchesOriginalRange = (rawUrl: string) => {
    if (!rangeQuery || !matchesGatewayUrl(rawUrl, fixture)) {
      return false;
    }
    try {
      const query = new URL(rawUrl).searchParams;
      return (
        query.get('start') === rangeQuery.start &&
        query.get('end') === rangeQuery.end &&
        query.get('timezone') === rangeQuery.timezone
      );
    } catch {
      return false;
    }
  };

  const identityCancel = startBoundedResponseJsonRead(initialRead, (body) => {
    if (stopped) return;
    selectedEventId =
      body === null
        ? null
        : findUniqueWebBEventId(body, fixture.calendarId, initialTitle);
    selectedEventIdentity = selectedEventId ? 'available' : 'unavailable';
  });
  cancelBodyReads.push(identityCancel);

  const observeRequest = (request: Request) => {
    if (
      stopped ||
      !patchResponseObserved ||
      !rangeQuery ||
      !matchesGatewayRequest(request, fixture, 'GET') ||
      !matchesOriginalRange(request.url())
    ) {
      return;
    }
    observedMatchingRequests.add(request);
    matchingGetRequestCountCapped = Math.min(
      matchingGetRequestCountCapped + 1,
      2,
    ) as 0 | 1 | 2;
    if (!firstMatchingRequest) {
      firstMatchingRequest = request;
      if (state !== 'unavailable') state = 'request-pending';
    }
  };

  const observeRequestFailed = (request: Request) => {
    if (
      stopped ||
      request !== firstMatchingRequest ||
      firstMatchedGetStatus !== null
    ) {
      return;
    }
    if (state !== 'unavailable') state = 'request-failed';
  };

  const observeResponse = (response: Response) => {
    if (stopped) return;
    if (matchesGatewayResponse(response, fixture, 'PATCH')) {
      patchResponseObserved = true;
      if (state !== 'unavailable' && !firstMatchingRequest) {
        state = 'awaiting-events-get';
      }
      return;
    }
    let request: Request;
    try {
      request = response.request();
    } catch {
      return;
    }
    if (!observedMatchingRequests.has(request)) return;
    matchingGetResponseCountCapped = Math.min(
      matchingGetResponseCountCapped + 1,
      2,
    ) as 0 | 1 | 2;
    if (request !== firstMatchingRequest || firstMatchedGetStatus !== null) {
      return;
    }
    firstMatchedGetStatus = response.status();
    if (firstMatchedGetStatus !== 200) {
      if (state !== 'unavailable') state = 'status-not-200';
      return;
    }
    if (state !== 'unavailable') state = 'decode-pending';
    const cancel = startBoundedResponseJsonRead(response, (body) => {
      if (stopped) return;
      eventTitleMatches =
        body === null
          ? null
          : collectWebBEventTitleMatches(body, fixture.calendarId, editedTitle);
      if (state !== 'unavailable') {
        state = eventTitleMatches === null ? 'unavailable' : 'decoded';
      }
    });
    cancelBodyReads.push(cancel);
  };

  try {
    page.on('request', observeRequest);
    page.on('requestfailed', observeRequestFailed);
    page.on('response', observeResponse);
  } catch {
    state = 'unavailable';
    try {
      page.off('request', observeRequest);
      page.off('requestfailed', observeRequestFailed);
      page.off('response', observeResponse);
    } catch {
      // Setup failure leaves the fixed unavailable snapshot.
    }
  }

  return {
    markPatchResponseObserved: () => {
      if (!patchResponseObserved) {
        patchResponseObserved = true;
        if (state !== 'unavailable') state = 'unavailable';
      }
    },
    snapshot: () => {
      let sameEventObserved: boolean | null = null;
      let sameEventEditedTitleMatch: boolean | null = null;
      if (
        state === 'decoded' &&
        selectedEventIdentity === 'available' &&
        selectedEventId !== null &&
        eventTitleMatches !== null
      ) {
        sameEventObserved = eventTitleMatches.has(selectedEventId);
        sameEventEditedTitleMatch =
          eventTitleMatches.get(selectedEventId) ?? false;
      }
      return {
        state,
        matchingGetRequestCountCapped,
        matchingGetResponseCountCapped,
        firstMatchedGetStatus,
        selectedEventIdentity,
        sameEventObserved,
        sameEventEditedTitleMatch,
      };
    },
    stop: () => {
      if (stopped) return;
      stopped = true;
      try {
        page.off('request', observeRequest);
        page.off('requestfailed', observeRequestFailed);
        page.off('response', observeResponse);
      } catch {
        // Cleanup is best effort after the acceptance boundary.
      }
      for (const cancel of cancelBodyReads) cancel();
      selectedEventId = null;
      eventTitleMatches?.clear();
      eventTitleMatches = null;
    },
  };
}

function waitForGatewayResponse(
  page: Page,
  fixture: Fixture,
  method: 'GET' | 'POST' | 'PATCH',
) {
  return page.waitForResponse(
    (response) => matchesGatewayResponse(response, fixture, method),
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
        event !== null &&
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
  failurePoint?: DesktopJourneyFailurePoint,
  gatewayReadDiagnostic?: DesktopGatewayReadFailureDiagnostic,
  webBEditSaveDiagnostic?: WebBEditSaveFailureDiagnostic,
) {
  try {
    appendDesktopJourneyOutcome({
      ...evidence,
      phase,
      status,
      ...(failurePoint === undefined ? {} : { failurePoint }),
      ...(gatewayReadDiagnostic === undefined ? {} : { gatewayReadDiagnostic }),
      ...(webBEditSaveDiagnostic === undefined
        ? {}
        : { webBEditSaveDiagnostic }),
    });
    recorded.add(phase);
    return true;
  } catch {
    return false;
  }
}

function safeRecordDesktopLoginStep(
  evidence: { filePath: string; runnerTemp: string },
  step: DesktopLoginStep,
  diagnostic?: DesktopLoginDiagnostic,
  entry?: DesktopLoginEntry,
  roomsReadyDiagnostic?: DesktopRoomsReadyDiagnostic,
) {
  try {
    appendDesktopLoginStep({
      ...evidence,
      step,
      ...(entry === undefined ? {} : { entry }),
      ...(diagnostic === undefined ? {} : { diagnostic }),
      ...(roomsReadyDiagnostic === undefined ? {} : { roomsReadyDiagnostic }),
    });
    return true;
  } catch {
    return false;
  }
}

function unavailableDesktopLoginFieldObservation(): DesktopLoginFieldObservation {
  return {
    countCapped: null,
    visible: null,
    enabled: null,
    editable: null,
  };
}

function unavailableDesktopLoginFormObservation(): DesktopLoginFormObservation {
  return {
    username: unavailableDesktopLoginFieldObservation(),
    password: unavailableDesktopLoginFieldObservation(),
  };
}

async function observeDesktopLoginField(
  locator: Locator,
): Promise<DesktopLoginFieldObservation> {
  let countCapped: 0 | 1 | 2;
  try {
    const count = await locator.count();
    countCapped = Math.min(count, 2) as 0 | 1 | 2;
  } catch {
    return unavailableDesktopLoginFieldObservation();
  }
  if (countCapped !== 1) {
    return {
      countCapped,
      visible: null,
      enabled: null,
      editable: null,
    };
  }

  const readBoolean = async (
    read: () => Promise<boolean>,
  ): Promise<boolean | null> => {
    try {
      return await read();
    } catch {
      return null;
    }
  };
  const [visible, enabled, editable] = await Promise.all([
    readBoolean(() => locator.isVisible()),
    readBoolean(() => locator.isEnabled()),
    readBoolean(() => locator.isEditable()),
  ]);
  return { countCapped, visible, enabled, editable };
}

async function observeDesktopLoginForm(
  username: Locator,
  password: Locator,
): Promise<DesktopLoginFormObservation> {
  const [usernameObservation, passwordObservation] = await Promise.all([
    observeDesktopLoginField(username),
    observeDesktopLoginField(password),
  ]);
  return {
    username: usernameObservation,
    password: passwordObservation,
  };
}

function unavailableDesktopRoomsReadyElementObservation(): DesktopRoomsReadyElementObservation {
  return { countCapped: null, visibility: 'unavailable' };
}

function unavailableDesktopRoomsReadyDiagnostic(): DesktopRoomsReadyDiagnostic {
  return {
    roomList: unavailableDesktopRoomsReadyElementObservation(),
    matrixChatShell: unavailableDesktopRoomsReadyElementObservation(),
    matrixChatStateAvailable: null,
    matrixChatView: 'unavailable',
    matrixChatReady: null,
    matrixChatPageType: 'unavailable',
    matrixChatCurrentRoomKnown: null,
    matrixChatCurrentRoomMatchesExpected: null,
    matrixChatSecurityFlowView: null,
    matrixClientMatchesMemberA: null,
  };
}

async function observeDesktopRoomsReadyElement(
  locator: Locator,
): Promise<DesktopRoomsReadyElementObservation> {
  let countCapped: 0 | 1 | 2;
  try {
    countCapped = Math.min(await locator.count(), 2) as 0 | 1 | 2;
  } catch {
    return unavailableDesktopRoomsReadyElementObservation();
  }
  if (countCapped === 0) return { countCapped, visibility: 'absent' };
  if (countCapped === 2) return { countCapped, visibility: 'ambiguous' };
  try {
    return {
      countCapped,
      visibility: (await locator.isVisible()) ? 'visible' : 'hidden',
    };
  } catch {
    return { countCapped, visibility: 'unavailable' };
  }
}

async function observeDesktopRoomsReady(
  page: Page,
  expectedRoomId: string | null,
  expectedMemberAId: string | null,
): Promise<DesktopRoomsReadyDiagnostic> {
  const currentRoomList = getMainRoomListLocator(page);
  const [roomList, matrixChatShell, matrixChatState] = await Promise.all([
    observeDesktopRoomsReadyElement(currentRoomList),
    observeDesktopRoomsReadyElement(page.locator('.mx_MatrixChat')),
    page
      .evaluate(
        ({ expectedRoomId, expectedMemberAId }) => {
          type MatrixChatState = {
            view?: unknown;
            ready?: unknown;
            page_type?: unknown;
            currentRoomId?: unknown;
          };
          type MatrixChatInstance = { state?: unknown };
          type MatrixClient = { getUserId?: () => string | null };
          type MatrixClientPeg = { get?: () => MatrixClient | undefined };
          type Result = Omit<
            DesktopRoomsReadyDiagnostic,
            'roomList' | 'matrixChatShell'
          >;
          const unavailableState = (
            available: false | null,
            matrixClientMatchesMemberA: boolean | null,
          ): Result => ({
            matrixChatStateAvailable: available,
            matrixChatView: available === false ? 'missing' : 'unavailable',
            matrixChatReady: null,
            matrixChatPageType: available === false ? 'missing' : 'unavailable',
            matrixChatCurrentRoomKnown: null,
            matrixChatCurrentRoomMatchesExpected: null,
            matrixChatSecurityFlowView: null,
            matrixClientMatchesMemberA,
          });

          let matrixClientMatchesMemberA: boolean | null = null;
          try {
            const peg = (
              window as unknown as {
                mxMatrixClientPeg?: MatrixClientPeg;
              }
            ).mxMatrixClientPeg;
            const client = peg?.get?.();
            const userId = client?.getUserId?.();
            if (typeof userId === 'string' && expectedMemberAId !== null) {
              matrixClientMatchesMemberA = userId === expectedMemberAId;
            }
          } catch {
            // Keep client identity unavailable without exposing runtime details.
          }

          let matrixChat: MatrixChatInstance | undefined;
          try {
            matrixChat = (
              window as unknown as { matrixChat?: MatrixChatInstance }
            ).matrixChat;
          } catch {
            return unavailableState(null, matrixClientMatchesMemberA);
          }
          if (!matrixChat) {
            return unavailableState(false, matrixClientMatchesMemberA);
          }

          try {
            const stateValue = matrixChat.state;
            if (
              stateValue === null ||
              typeof stateValue !== 'object' ||
              Array.isArray(stateValue)
            ) {
              return unavailableState(null, matrixClientMatchesMemberA);
            }
            const state = stateValue as MatrixChatState;

            const rawView = state.view;
            const matrixChatView =
              rawView === 2
                ? 'welcome'
                : rawView === 3
                  ? 'login'
                  : rawView === 9
                    ? 'logged-in'
                    : rawView === undefined || rawView === null
                      ? 'missing'
                      : 'other-view';
            const rawPageType = state.page_type;
            const matrixChatPageType =
              rawPageType === 'home_page'
                ? 'home-page'
                : rawPageType === 'room_view'
                  ? 'room-view'
                  : rawPageType === 'user_view'
                    ? 'user-view'
                    : rawPageType === undefined || rawPageType === null
                      ? 'missing'
                      : 'other-page';
            const rawRoomId = state.currentRoomId;
            const matrixChatCurrentRoomKnown =
              rawRoomId === null
                ? false
                : typeof rawRoomId === 'string'
                  ? rawRoomId.length > 0
                  : null;
            const matrixChatCurrentRoomMatchesExpected =
              typeof rawRoomId === 'string' && expectedRoomId !== null
                ? rawRoomId === expectedRoomId
                : rawRoomId === null && expectedRoomId !== null
                  ? false
                  : null;
            const matrixChatSecurityFlowView =
              typeof rawView === 'number' &&
              Number.isInteger(rawView) &&
              rawView >= 0 &&
              rawView <= 11
                ? rawView === 6 || rawView === 7
                : null;

            return {
              matrixChatStateAvailable: true,
              matrixChatView,
              matrixChatReady:
                typeof state.ready === 'boolean' ? state.ready : null,
              matrixChatPageType,
              matrixChatCurrentRoomKnown,
              matrixChatCurrentRoomMatchesExpected,
              matrixChatSecurityFlowView,
              matrixClientMatchesMemberA,
            } satisfies Result;
          } catch {
            return unavailableState(null, matrixClientMatchesMemberA);
          }
        },
        { expectedRoomId, expectedMemberAId },
      )
      .catch(() => null),
  ]);

  if (matrixChatState === null) {
    return {
      ...unavailableDesktopRoomsReadyDiagnostic(),
      roomList,
      matrixChatShell,
    };
  }
  return { roomList, matrixChatShell, ...matrixChatState };
}

function recordPhase(
  evidence: { filePath: string; runnerTemp: string },
  recorded: Set<DesktopJourneyPhase>,
  phase: DesktopJourneyPhase,
) {
  appendDesktopJourneyOutcome({ ...evidence, phase, status: 'passed' });
  recorded.add(phase);
}
