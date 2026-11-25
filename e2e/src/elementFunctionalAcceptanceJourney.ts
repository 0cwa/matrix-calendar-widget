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
  type Page,
  type Response,
} from '@playwright/test';
import { randomUUID } from 'node:crypto';
import type {
  AcceptanceRuntimeObservation,
  BlockedRequestEvidence,
  BrowserActor,
  FunctionalJourneyContext,
} from './elementAcceptanceSupport';

export async function runElementFunctionalAcceptanceJourney(
  browser: Browser,
  journey: FunctionalJourneyContext,
): Promise<void> {
  const {
    readFixture,
    blockedExternalRequestsByContext,
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
  } = journey;
  journey.fixture = readFixture();
  const contexts: BrowserContext[] = [];
  let blockedExternalRequests = 0;
  const blockedRequestEvidence: BlockedRequestEvidence = {
    diagnostics: new Map(),
    overflow: false,
  };
  const allowedOrigins = new Set([
    new URL(journey.fixture.elementUrl).origin,
    new URL(journey.fixture.homeserverUrl).origin,
    'http://localhost:8008',
    new URL(journey.fixture.gatewayUrl).origin,
    'http://127.0.0.1:8080',
  ]);
  const fixtureHosts = new Set([
    ...Array.from(allowedOrigins, (origin) => new URL(origin).hostname),
    'synapse',
    'radicale',
    'gateway',
    'widget',
    'element',
  ]);

  const makeContext = async (actor: BrowserActor) => {
    const context = await browser.newContext({
      locale: 'en-US',
      timezoneId: 'Europe/Stockholm',
      viewport: { width: 1440, height: 900 },
    });
    const contextBlockedRequests = { count: 0 };
    blockedExternalRequestsByContext.set(context, contextBlockedRequests);
    contexts.push(context);
    await context.route('**/*', async (route) => {
      let requestUrl: URL;
      try {
        requestUrl = new URL(route.request().url());
      } catch {
        blockedExternalRequests += 1;
        contextBlockedRequests.count = Math.min(
          contextBlockedRequests.count + 1,
          100_000,
        );
        const request = route.request();
        recordBlockedRequest(
          blockedRequestEvidence,
          actor,
          journey.activePhase,
          'invalid-url',
          safeBlockedRequestResourceType(request.resourceType()),
        );
        await route.abort('blockedbyclient');
        return;
      }

      if (!allowedOrigins.has(requestUrl.origin)) {
        blockedExternalRequests += 1;
        contextBlockedRequests.count = Math.min(
          contextBlockedRequests.count + 1,
          100_000,
        );
        const request = route.request();
        recordBlockedRequest(
          blockedRequestEvidence,
          actor,
          journey.activePhase,
          classifyBlockedRequest(requestUrl, fixtureHosts),
          safeBlockedRequestResourceType(request.resourceType()),
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
  let memberARuntimeObservation: AcceptanceRuntimeObservation | undefined;
  let failureHttpStatus: number | undefined;
  let failureTeamRoomMatches: boolean | undefined;
  let failureAlreadyReported = false;

  try {
    recordRuntimeVersions(browser.version());

    journey.activePhase = 'member-a-authenticated';
    contextA = await makeContext('member-a');
    pageA = await authenticateInElement(
      contextA,
      journey.fixture.users.memberA,
      true,
    );
    memberARuntimeObservation = await observeAcceptanceRuntime(pageA, {
      gatewayUrl: journey.fixture.gatewayUrl,
      homeserverUrl: journey.fixture.homeserverUrl,
      widgetUrl: journey.fixture.widgetUrl,
    });
    record(journey.activePhase, 'passed');

    journey.activePhase = 'member-b-authenticated';
    contextB = await makeContext('member-b');
    pageB = await authenticateInElement(
      contextB,
      journey.fixture.users.memberB,
    );
    record(journey.activePhase, 'passed');

    journey.activePhase = 'outsider-authenticated';
    contextC = await makeContext('outsider');
    pageC = await authenticateInElement(
      contextC,
      journey.fixture.users.outsider,
    );
    record(journey.activePhase, 'passed');

    journey.activePhase = 'member-a-room-navigation';
    const memberARoom = await openMemberARoomWithDiagnostics(
      pageA,
      journey.fixture.roomName,
      journey.fixture.teamRoomId,
      journey.fixture.users.memberA.userId,
    );
    record(
      journey.activePhase,
      memberARoom.navigationCompleted ? 'passed' : 'failed',
    );
    journey.activePhase = 'member-a-room-context';
    recordMemberARoomObservation(memberARoom);
    failureAlreadyReported = Boolean(memberARoom.failureCode);
    const elementA = requireMemberARoom(memberARoom);
    journey.activePhase = 'widget-a-approved';
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
    journey.activePhase = 'gateway-backed-read';
    let firstReadResponse: Response;
    try {
      firstReadResponse = await firstRead;
    } catch {
      await recordWidgetRuntimeObservation(
        pageA,
        frameA,
        memberARuntimeObservation,
      );
      throw new Error('Initial calendar event request was not observed');
    }
    await recordWidgetRuntimeObservation(
      pageA,
      frameA,
      memberARuntimeObservation,
    );
    failureHttpStatus = firstReadResponse.status();
    expect(failureHttpStatus).toBe(200);
    record(journey.activePhase, 'passed', failureHttpStatus);
    failureHttpStatus = undefined;
    journey.activePhase = 'widget-a-iframe-ready';
    await frameA
      .getByRole('button', { name: 'Create event', exact: true })
      .waitFor({ timeout: 30_000 });
    record(journey.activePhase, 'passed');
    journey.activePhase = 'widget-a-approved';
    record('widget-a-approved', 'passed');

    const eventTitle = `Acceptance ${randomUUID()}`;
    journey.activePhase = 'event-create-dialog';
    await frameA
      .getByRole('button', { name: 'Create event', exact: true })
      .click();
    const createDialog = frameA.getByRole('dialog').last();
    await expect(createDialog).toBeVisible({ timeout: 15_000 });
    record(journey.activePhase, 'passed');

    journey.activePhase = 'event-create-calendar-selected';
    await createDialog
      .getByRole('combobox', { name: 'Calendar' })
      .selectOption({
        value: `matrix-calendar-target://room/${encodeURIComponent(journey.fixture.calendarId)}`,
      });
    record(journey.activePhase, 'passed');

    journey.activePhase = 'event-create-title-entered';
    await createDialog.getByRole('textbox', { name: 'Title' }).fill(eventTitle);
    record(journey.activePhase, 'passed');

    journey.activePhase = 'event-create-submit';
    const createResponse = waitForGatewayResponse(
      pageA,
      'POST',
      '/v1/calendar/events',
    );
    const postCreateVisibility = observePostCreateVisibility(pageA, {
      expectedCalendarId: journey.fixture.calendarId,
      expectedRoomId: journey.fixture.teamRoomId,
      expectedTitle: eventTitle,
    });
    await createDialog
      .getByRole('button', { name: 'Create event', exact: true })
      .click();
    record(journey.activePhase, 'passed');

    journey.activePhase = 'event-create-response';
    const createResponseResult = await createResponse;
    failureHttpStatus = createResponseResult.status();
    expect(createResponseResult.status()).toBeGreaterThanOrEqual(200);
    expect(createResponseResult.status()).toBeLessThan(300);
    record(journey.activePhase, 'passed', failureHttpStatus);
    failureHttpStatus = undefined;
    await postCreateVisibility.observeCreatedEvent(createResponseResult);

    journey.activePhase = 'event-create-visible';
    record(journey.activePhase, 'started');
    const eventRow = frameA.getByRole('listitem', { name: eventTitle });
    let eventVisible = false;
    try {
      await expect(eventRow).toBeVisible({ timeout: 15_000 });
      eventVisible = true;
    } catch {
      // The bounded observation below distinguishes the gateway refresh from
      // the widget's rendered list without retaining the failed assertion.
    }
    const postCreateObservation = await postCreateVisibility.collect(
      frameA,
      eventRow,
    );
    appendPostCreateVisibilityObservation(postCreateObservation);
    expect(eventVisible).toBe(true);
    record(journey.activePhase, 'passed');

    journey.activePhase = 'event-created';
    record(journey.activePhase, 'passed', createResponseResult.status());

    journey.activePhase = 'member-b-room-context';
    const elementB = await openFixtureRoom(
      pageB,
      journey.fixture.roomName,
      journey.fixture.teamRoomId,
    );
    record(journey.activePhase, 'passed');
    journey.activePhase = 'widget-b-approved';
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
    record(journey.activePhase, 'passed');

    journey.activePhase = 'shared-visibility';
    await expect(
      frameB.getByRole('listitem', { name: eventTitle }),
    ).toBeVisible();
    await openEventEditor(frameB, eventTitle);
    await frameB
      .getByRole('dialog')
      .last()
      .getByRole('textbox', { name: 'Title' })
      .fill('Member B stale draft');
    record(journey.activePhase, 'passed');

    journey.activePhase = 'member-a-edited';
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
    record(journey.activePhase, 'passed', updateResponseResult.status());

    journey.activePhase = 'outsider-room-context';
    const elementC = await openFixtureRoom(
      pageC,
      journey.fixture.outsiderRoomName,
      journey.fixture.outsiderRoomId,
    );
    record(journey.activePhase, 'passed');
    expect(journey.fixture.outsiderRoomId).not.toBe(journey.fixture.teamRoomId);
    journey.activePhase = 'outsider-widget-approved';
    const outsiderContextRead = waitForGatewayResponse(
      pageC,
      'GET',
      '/v1/calendar/context',
    );
    await openCalendarWidget(elementC, pageC, {
      expectWidgetWarning: false,
      waitForCalendar: false,
    });
    record(journey.activePhase, 'passed');

    journey.activePhase = 'outsider-room-widget-team-target';
    const outsiderContextResponse = await outsiderContextRead;
    failureHttpStatus = outsiderContextResponse.status();
    failureTeamRoomMatches =
      new URL(outsiderContextResponse.url()).searchParams.get('roomId') ===
      journey.fixture.teamRoomId;
    expect(failureTeamRoomMatches).toBe(true);
    expect(failureHttpStatus).toBe(403);
    record(journey.activePhase, 'passed', failureHttpStatus, undefined, {
      teamRoomMatches: failureTeamRoomMatches,
    });
    failureHttpStatus = undefined;
    failureTeamRoomMatches = undefined;

    journey.activePhase = 'outsider-room-events-api-team-target';
    failureHttpStatus = await requestRoomEventsStatus(pageC, {
      gatewayUrl: journey.fixture.gatewayUrl,
      roomId: journey.fixture.teamRoomId,
      calendarId: journey.fixture.calendarId,
    });
    expect(failureHttpStatus).toBe(403);
    record(journey.activePhase, 'passed', failureHttpStatus);
    failureHttpStatus = undefined;

    journey.activePhase = 'outsider-own-unbound-room';
    failureHttpStatus = await requestRoomEventsStatus(pageC, {
      gatewayUrl: journey.fixture.gatewayUrl,
      roomId: journey.fixture.outsiderRoomId,
      calendarId: journey.fixture.calendarId,
    });
    expect(failureHttpStatus).toBe(404);
    record(journey.activePhase, 'passed', failureHttpStatus);
    failureHttpStatus = undefined;

    journey.activePhase = 'stale-etag-conflict';
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
    record(journey.activePhase, 'passed', staleUpdateResult.status());

    journey.activePhase = 'canonical-read-after-denial';
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
    record(journey.activePhase, 'passed', reloadResponseResult.status());

    journey.activePhase = 'browser-egress';
    failureAlreadyReported = recordBlockedRequestFailure(
      blockedExternalRequests,
      blockedRequestEvidence,
    );
    expect(blockedExternalRequests).toBe(0);
    record(journey.activePhase, 'passed', undefined, blockedExternalRequests);
  } catch {
    recordJourneyFailure(
      journey.activePhase,
      failureHttpStatus,
      failureAlreadyReported,
      failureTeamRoomMatches,
    );
    throw new Error('Element acceptance journey failed');
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
}
