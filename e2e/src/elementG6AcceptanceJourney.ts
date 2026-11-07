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
import { randomUUID } from 'node:crypto';
import { classifyG6KeyboardFocusTarget } from '../../dev/element-g6-keyboard-focus.mjs';
import {
  beginG6ResourceCreate,
  createG6ResourceOwnership,
  g6EventSummaryMatches,
  g6ResourceCleanupRequest,
  isStrongG6ResourceEtag,
  recordG6ResourceCleanup,
  recordG6ResourceCreate,
  recordG6ResourceUpdate,
  summarizeG6ResourceOwnership,
  type G6ResourceOwnership,
} from '../../dev/element-g6-resource-ownership.mjs';
import type {
  Fixture,
  G6CanonicalTitleReadbackOutcome,
  G6KeyboardFocusTarget,
  G6KeyboardTabFocusObservation,
  G6NeighborTitleOutcome,
  G6Phase,
  G6PostSaveListObserver,
  G6PostSaveListResponseObservation,
  G6PostSaveListUiObservation,
  G6SeedCreateObservation,
  G6SidePanelControlEnabled,
  G6SidePanelControlVisibility,
  G6SidePanelToolbarObservation,
  G6StageRecord,
  MemberARoomResult,
  MemberRoomContextPhase,
  OpenCalendarWidgetOptions,
  PrincipalMode,
  User,
} from './elementAcceptanceTypes';
import { ElementWebPage } from './pages/elementWebPage';
import { readBoundedResponseBody } from './readBoundedResponseBody.mjs';

type G6CalDavClient = {
  authorization: string;
  collectionUrl: URL;
  localpart: string;
};

type G6CalDavResult = {
  outcome:
    | 'response'
    | 'timeout'
    | 'aborted'
    | 'network-error'
    | 'other-error'
    | 'not-sent';
  status?: number;
  bytes?: Buffer;
  etag?: string;
};

type G6Record = (
  phase: G6Phase | 'member-a-authenticated' | 'member-b-authenticated',
  status: 'started' | 'passed' | 'failed',
  httpStatus?: number,
  count?: number,
  extra?: Omit<
    Partial<G6StageRecord>,
    'phase' | 'status' | 'httpStatus' | 'count'
  >,
) => void;

type G6AcceptanceDependencies = {
  browser: Browser;
  fixture: Fixture;
  record: G6Record;
  isRecord: (value: unknown) => value is Record<string, unknown>;
  authenticateInElement: (
    context: BrowserContext,
    user: User,
    captureMemberADiagnostics?: boolean,
    captureHomeserverHttpErrors?: boolean,
  ) => Promise<Page>;
  openMemberARoomWithDiagnostics: (
    page: Page,
    roomName: string,
    roomId: string,
    expectedUserId: string,
    options?: {
      captureReminderRoomLayout?: boolean;
      captureRoomReadinessTimeline?: boolean;
      useNormalRoomSelection?: boolean;
      blockedExternalRequests?: { count: number };
    },
  ) => Promise<MemberARoomResult>;
  recordMemberARoomObservation: (
    result: MemberARoomResult,
    phase?: MemberRoomContextPhase,
  ) => void;
  openCalendarWidget: (
    element: ElementWebPage,
    page: Page,
    options: OpenCalendarWidgetOptions,
  ) => Promise<FrameLocator>;
  openEventEditor: (frame: FrameLocator, title: string) => Promise<void>;
  waitForGatewayResponse: (
    page: Page,
    method: string,
    pathname: string,
  ) => Promise<Response>;
  readGatewayEventUpdate: (
    response: Response | undefined,
    expectedEventHref: string,
    expectedTitle: string,
    expectedPrincipalLocalpart: string,
  ) => Promise<{
    etag?: string;
    identityMatches: boolean;
    titleMatches?: boolean;
  }>;
  openFixtureRoom: (
    page: Page,
    roomName: string,
    roomId: string,
  ) => Promise<ElementWebPage>;
};

const G6_SERVICE_USER_ID = '@_matrix_calendar_service:localhost';
const G6_SERVICE_LOCALPART = '_matrix_calendar_service';
// The paired-restore flow stops the original listener on 5232 and publishes
// the restored Radicale collection on the isolated host port 5233.
const G6_RADICALE_ORIGIN = 'http://127.0.0.1:5233';
const G6_RADICALE_COLLECTION = 'element-acceptance';
const G6_MAX_RESOURCE_BYTES = 16_384;
const G6_POSTSAVE_EVENT_COUNT_CAP = 100;

/**
 * Resolve the authenticated principal used by the current acceptance fixture.
 *
 * Returns no principal when the fixture identity or its test-only credential is
 * missing or malformed.
 */
export function acceptancePrincipal(fixtureValue: Fixture):
  | {
      mode: PrincipalMode;
      userId: string;
      localpart: string;
      accessToken: string;
      openIdBody?: string;
    }
  | undefined {
  const sender = fixtureValue?.serviceSender;
  let userId: string;
  let accessToken: string;
  let openIdBody: string | undefined;
  if (fixtureValue?.principalMode === 'appservice') {
    const applicationServiceToken =
      process.env.MATRIX_APPLICATION_SERVICE_TOKEN;
    if (
      sender?.userId !== G6_SERVICE_USER_ID ||
      typeof applicationServiceToken !== 'string' ||
      applicationServiceToken.length === 0 ||
      applicationServiceToken.length > 4096
    ) {
      return undefined;
    }
    userId = G6_SERVICE_USER_ID;
    accessToken = applicationServiceToken;
    openIdBody = JSON.stringify({ user_id: userId });
  } else if (fixtureValue?.principalMode === 'bot-account') {
    const bot = fixtureValue.users?.bot;
    if (
      !bot ||
      !sender ||
      process.env.MATRIX_APPLICATION_SERVICE_TOKEN !== undefined ||
      typeof bot.userId !== 'string' ||
      !/^@([a-z0-9][a-z0-9-]{0,254}):localhost$/u.test(bot.userId) ||
      typeof bot.accessToken !== 'string' ||
      bot.accessToken.length === 0 ||
      bot.accessToken.length > 4096 ||
      sender.userId !== bot.userId ||
      sender.accessToken !== bot.accessToken
    ) {
      return undefined;
    }
    userId = bot.userId;
    accessToken = bot.accessToken;
    openIdBody = JSON.stringify({});
  } else {
    return undefined;
  }

  const match =
    fixtureValue.principalMode === 'bot-account'
      ? /^@([a-z0-9][a-z0-9-]{0,254}):localhost$/u.exec(userId)
      : undefined;
  if (fixtureValue.principalMode === 'bot-account' && !match) {
    return undefined;
  }
  return {
    mode: fixtureValue.principalMode,
    userId,
    localpart:
      fixtureValue.principalMode === 'appservice'
        ? G6_SERVICE_LOCALPART
        : (match?.[1] ?? ''),
    accessToken,
    ...(openIdBody === undefined ? {} : { openIdBody }),
  };
}

async function createG6CalDavClient(fixtureValue: Fixture): Promise<{
  status?: number;
  proofValid: boolean;
  client?: G6CalDavClient;
}> {
  const principal = acceptancePrincipal(fixtureValue);
  if (
    !principal ||
    fixtureValue.calendarId !== G6_RADICALE_COLLECTION ||
    new URL(fixtureValue.homeserverUrl).origin !== 'http://127.0.0.1:8008'
  ) {
    return { proofValid: false };
  }

  let openIdResponse: globalThis.Response;
  try {
    const openIdUrl = new URL(
      `/_matrix/client/v3/user/${encodeURIComponent(principal.userId)}/openid/request_token`,
      fixtureValue.homeserverUrl,
    );
    openIdResponse = await fetch(openIdUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${principal.accessToken}`,
        ...(principal.openIdBody === undefined
          ? {}
          : { 'Content-Type': 'application/json' }),
      },
      ...(principal.openIdBody === undefined
        ? {}
        : { body: principal.openIdBody }),
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return { proofValid: false };
  }

  const status = openIdResponse.status;
  if (status !== 200) {
    await openIdResponse.body?.cancel().catch(() => undefined);
    return { status, proofValid: false };
  }

  let proof: unknown;
  try {
    proof = await openIdResponse.json();
  } catch {
    return { status, proofValid: false };
  }
  if (
    proof === null ||
    typeof proof !== 'object' ||
    Array.isArray(proof) ||
    !('access_token' in proof) ||
    typeof proof.access_token !== 'string' ||
    proof.access_token.length === 0 ||
    proof.access_token.length > 4096 ||
    !('matrix_server_name' in proof) ||
    proof.matrix_server_name !== 'localhost'
  ) {
    return { status, proofValid: false };
  }

  const delegatedCredential = Buffer.from(
    JSON.stringify({
      access_token: proof.access_token,
      matrix_server_name: proof.matrix_server_name,
    }),
  ).toString('base64url');
  const authorization = Buffer.from(
    `${principal.localpart}:matrix-openid:${delegatedCredential}`,
    'utf8',
  ).toString('base64');
  const collectionUrl = new URL(
    `${encodeURIComponent(principal.localpart)}/${encodeURIComponent(G6_RADICALE_COLLECTION)}/`,
    `${G6_RADICALE_ORIGIN}/`,
  );
  if (collectionUrl.origin !== G6_RADICALE_ORIGIN) {
    return { status, proofValid: false };
  }

  return {
    status,
    proofValid: true,
    client: { authorization, collectionUrl, localpart: principal.localpart },
  };
}

async function g6CalDavRequest(
  client: G6CalDavClient,
  resourceName: string,
  method: 'GET' | 'PUT' | 'DELETE',
  icalendar?: string,
  ifMatch?: string,
): Promise<G6CalDavResult> {
  if (
    !/^g6-[0-9a-f-]{36}\.ics$/u.test(resourceName) ||
    client.collectionUrl.origin !== G6_RADICALE_ORIGIN
  ) {
    return { outcome: 'not-sent' };
  }

  const resourceUrl = new URL(
    encodeURIComponent(resourceName),
    client.collectionUrl,
  );
  const collectionPrefix = `/${encodeURIComponent(client.localpart)}/${encodeURIComponent(G6_RADICALE_COLLECTION)}/`;
  if (
    resourceUrl.origin !== G6_RADICALE_ORIGIN ||
    !resourceUrl.pathname.startsWith(collectionPrefix) ||
    resourceUrl.pathname.slice(collectionPrefix.length).includes('/')
  ) {
    return { outcome: 'not-sent' };
  }

  const headers: Record<string, string> = {
    Authorization: `Basic ${client.authorization}`,
  };
  if (method === 'PUT') {
    if (
      typeof icalendar !== 'string' ||
      icalendar.length > G6_MAX_RESOURCE_BYTES
    ) {
      return { outcome: 'not-sent' };
    }
    headers['Content-Type'] = 'text/calendar; charset=utf-8';
    headers['If-None-Match'] = '*';
  } else if (method === 'DELETE' && ifMatch !== undefined) {
    if (!/^"[\x21\x23-\x7e]{1,200}"$/u.test(ifMatch)) {
      return { outcome: 'not-sent' };
    }
    headers['If-Match'] = ifMatch;
  }

  let response: globalThis.Response;
  try {
    response = await fetch(resourceUrl, {
      method,
      headers,
      ...(method === 'PUT' ? { body: icalendar } : {}),
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    const errorName = error instanceof Error ? error.name : '';
    return {
      outcome:
        errorName === 'TimeoutError'
          ? 'timeout'
          : errorName === 'AbortError'
            ? 'aborted'
            : errorName === 'TypeError'
              ? 'network-error'
              : 'other-error',
    };
  }

  if (method === 'GET' && response.status === 200) {
    const contentLength = Number(response.headers.get('content-length'));
    if (
      Number.isFinite(contentLength) &&
      contentLength > G6_MAX_RESOURCE_BYTES
    ) {
      await response.body?.cancel().catch(() => undefined);
      return { outcome: 'response', status: response.status };
    }
    const bytes = await readBoundedResponseBody(
      response.body,
      G6_MAX_RESOURCE_BYTES,
    );
    return bytes === undefined
      ? { outcome: 'response', status: response.status }
      : { outcome: 'response', status: response.status, bytes };
  }

  await response.body?.cancel().catch(() => undefined);
  const etag = method === 'PUT' ? response.headers.get('etag') : null;
  return {
    outcome: 'response',
    status: response.status,
    ...(etag ? { etag } : {}),
  };
}

function g6SimpleEventIcal(
  uid: string,
  title: string,
  startAt: number,
  endAt: number,
): string {
  const summary = title
    .replace(/\\/gu, '\\\\')
    .replace(/;/gu, '\\;')
    .replace(/,/gu, '\\,')
    .replace(/\r?\n/gu, '\\n');
  return (
    [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Matrix Calendar Widget//G6 Acceptance//EN',
      'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${g6IcsTimestamp(Date.now())}`,
      `DTSTART:${g6IcsTimestamp(startAt)}`,
      `DTEND:${g6IcsTimestamp(endAt)}`,
      `SUMMARY:${summary}`,
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n') + '\r\n'
  );
}

function g6UnsupportedSeriesIcal(
  uid: string,
  title: string,
  startAt: number,
): string {
  const nextOccurrence = startAt + 24 * 60 * 60_000;
  const duration = 60 * 60_000;
  const summary = title.replace(/\\/gu, '\\\\').replace(/;/gu, '\\;');
  return (
    [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Matrix Calendar Widget//G6 Acceptance//EN',
      'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${g6IcsTimestamp(Date.now())}`,
      `DTSTART:${g6IcsTimestamp(startAt)}`,
      `DTEND:${g6IcsTimestamp(startAt + duration)}`,
      'RRULE:FREQ=DAILY;COUNT=5',
      `SUMMARY:${summary}`,
      'END:VEVENT',
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${g6IcsTimestamp(Date.now())}`,
      `RECURRENCE-ID;RANGE=THISANDFUTURE:${g6IcsTimestamp(nextOccurrence)}`,
      `DTSTART:${g6IcsTimestamp(nextOccurrence + 60 * 60_000)}`,
      `DTEND:${g6IcsTimestamp(nextOccurrence + 2 * 60 * 60_000)}`,
      `SUMMARY:${summary}`,
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n') + '\r\n'
  );
}

function g6IcsTimestamp(timestamp: number): string {
  return new Date(timestamp)
    .toISOString()
    .replace(/[-:]/gu, '')
    .replace(/\.\d{3}/u, '');
}

function waitForG6EventsResponse(
  page: Page,
  roomId: string,
  fixtureValue: Fixture,
): Promise<Response> {
  return page.waitForResponse(
    (response) =>
      matchesG6EventsRequest(response.request(), roomId, fixtureValue),
    { timeout: 30_000 },
  );
}

function matchesG6EventsRequest(
  request: Request,
  roomId: string,
  fixtureValue: Fixture,
): boolean {
  try {
    const url = new URL(request.url());
    return (
      url.origin === new URL(fixtureValue.gatewayUrl).origin &&
      url.pathname === '/v1/calendar/events' &&
      url.searchParams.get('roomId') === roomId &&
      url.searchParams.get('target') === 'room' &&
      request.method() === 'GET' &&
      new URL(request.frame().url()).origin ===
        new URL(fixtureValue.widgetUrl).origin
    );
  } catch {
    return false;
  }
}

function observeNextG6PostSaveListResponse(
  page: Page,
  roomId: string,
  expectedTitle: string,
  fixtureValue: Fixture,
  isRecord: (value: unknown) => value is Record<string, unknown>,
): G6PostSaveListObserver {
  const observedRequests = new WeakSet<Request>();
  let observation: G6PostSaveListResponseObservation = {
    outcome: 'not-observed',
    httpStatus: null,
  };
  let responseObserved = false;

  const onRequest = (request: Request) => {
    if (matchesG6EventsRequest(request, roomId, fixtureValue))
      observedRequests.add(request);
  };
  const onResponse = (response: Response) => {
    const request = response.request();
    if (responseObserved || !observedRequests.has(request)) return;
    responseObserved = true;
    const httpStatus = response.status();
    observation = {
      outcome: httpStatus === 200 ? 'decoding' : 'unexpected-status',
      httpStatus,
    };
    if (httpStatus !== 200) return;

    void response
      .json()
      .then((body: unknown) => {
        if (!isRecord(body) || !Array.isArray(body.events)) {
          observation = { outcome: 'invalid-response', httpStatus };
          return null;
        }
        const eventCount = body.events.length;
        const eventCountCapped = Math.min(
          eventCount,
          G6_POSTSAVE_EVENT_COUNT_CAP,
        );
        const eventCountOverflow = eventCount > G6_POSTSAVE_EVENT_COUNT_CAP;
        if (eventCountOverflow) {
          observation = {
            outcome: 'decoded-overflow',
            httpStatus,
            eventCountCapped,
            eventCountOverflow: true,
          };
          return null;
        }
        if (
          body.events.some(
            (resource: unknown) =>
              !isRecord(resource) ||
              !isRecord(resource.event) ||
              typeof resource.event.title !== 'string',
          )
        ) {
          observation = { outcome: 'invalid-response', httpStatus };
          return null;
        }
        observation = {
          outcome: 'decoded',
          httpStatus,
          eventCountCapped,
          eventCountOverflow: false,
          editedTitleMatches: body.events.some(
            (resource: { event: { title: string } }) =>
              resource.event.title === expectedTitle,
          ),
        };
        return null;
      })
      .catch(() => {
        observation = { outcome: 'decode-error', httpStatus };
      });
  };

  page.on('request', onRequest);
  page.on('response', onResponse);
  return {
    snapshot: () => ({ ...observation }),
    dispose: () => {
      page.off('request', onRequest);
      page.off('response', onResponse);
    },
  };
}

async function observeG6PostSaveListUi(
  frame: FrameLocator,
  editedRow: Locator,
): Promise<G6PostSaveListUiObservation> {
  try {
    const [loadingVisible, errorVisible, rowCount, editedRowVisible] =
      await Promise.all([
        frame.getByRole('progressbar').isVisible(),
        frame.locator('.MuiAlert-standardError').isVisible(),
        editedRow.count(),
        editedRow.isVisible(),
      ]);
    return {
      state: 'observed',
      loadingVisible,
      errorVisible,
      editedRowCountCapped: Math.min(rowCount, 2),
      editedRowCountOverflow: rowCount > 2,
      editedRowVisible,
    };
  } catch {
    return { state: 'unavailable' };
  }
}

async function observeG6SidePanelToolbar(
  frame: FrameLocator,
): Promise<G6SidePanelToolbarObservation> {
  try {
    const deleteCalendarButton = frame.getByRole('button', {
      name: 'Delete calendar',
      exact: true,
      includeHidden: true,
    });
    const managementToolbarNav = frame
      .locator('nav')
      .filter({ has: deleteCalendarButton });
    const createEventButton = frame.getByRole('button', {
      name: 'Create event',
      exact: true,
      includeHidden: true,
    });
    const [managementToolbarNavCount, createEventButtonCount] =
      await Promise.all([
        managementToolbarNav.count(),
        createEventButton.count(),
      ]);
    const [
      managementToolbarNavVisible,
      createEventButtonVisible,
      createEventButtonEnabled,
    ] = await Promise.all([
      managementToolbarNavCount === 1
        ? managementToolbarNav.isVisible()
        : Promise.resolve(undefined),
      createEventButtonCount === 1
        ? createEventButton.isVisible()
        : Promise.resolve(undefined),
      createEventButtonCount === 1
        ? createEventButton.isEnabled()
        : Promise.resolve(undefined),
    ]);
    const visibility = (
      count: number,
      visible: boolean | undefined,
    ): G6SidePanelControlVisibility =>
      count === 0
        ? 'absent'
        : count > 1
          ? 'ambiguous'
          : visible === undefined
            ? 'unavailable'
            : visible
              ? 'visible'
              : 'hidden';

    return {
      managementToolbarNavCountCapped: Math.min(managementToolbarNavCount, 2),
      managementToolbarNavVisibility: visibility(
        managementToolbarNavCount,
        managementToolbarNavVisible,
      ),
      createEventButtonCountCapped: Math.min(createEventButtonCount, 2),
      createEventButtonVisibility: visibility(
        createEventButtonCount,
        createEventButtonVisible,
      ),
      createEventButtonEnabled:
        createEventButtonCount === 0
          ? 'absent'
          : createEventButtonCount > 1
            ? 'ambiguous'
            : createEventButtonEnabled === undefined
              ? 'unavailable'
              : createEventButtonEnabled
                ? 'enabled'
                : 'disabled',
    };
  } catch {
    return {
      managementToolbarNavCountCapped: null,
      managementToolbarNavVisibility: 'unavailable',
      createEventButtonCountCapped: null,
      createEventButtonVisibility: 'unavailable',
      createEventButtonEnabled: 'unavailable',
    };
  }
}

async function observeG6KeyboardControl(button: Locator): Promise<{
  countCapped: number;
  visibility: G6SidePanelControlVisibility;
  enabled: G6SidePanelControlEnabled;
}> {
  const count = await button.count().catch(() => 0);
  const [visible, enabled] = await Promise.all([
    count === 1 ? button.isVisible().catch(() => undefined) : undefined,
    count === 1 ? button.isEnabled().catch(() => undefined) : undefined,
  ]);
  return {
    countCapped: Math.min(count, 2),
    visibility:
      count === 0
        ? 'absent'
        : count > 1
          ? 'ambiguous'
          : visible === undefined
            ? 'unavailable'
            : visible
              ? 'visible'
              : 'hidden',
    enabled:
      count === 0
        ? 'absent'
        : count > 1
          ? 'ambiguous'
          : enabled === undefined
            ? 'unavailable'
            : enabled
              ? 'enabled'
              : 'disabled',
  };
}

async function observeG6KeyboardFocusTarget(
  frame: FrameLocator,
  controls: {
    edit: Locator;
    editCountCapped: number;
    delete: Locator;
    deleteCountCapped: number;
    close: Locator;
    closeCountCapped: number;
    dialogContent: Locator;
  },
): Promise<G6KeyboardTabFocusObservation> {
  let frameHasFocus: boolean;
  let activeElementAvailable: boolean;
  try {
    ({ frameHasFocus, activeElementAvailable } = await frame
      .locator('body')
      .evaluate((body) => {
        const document = body.ownerDocument;
        return {
          frameHasFocus: document.hasFocus(),
          activeElementAvailable: document.activeElement !== null,
        };
      }));
  } catch {
    return { activeTarget: 'unavailable', frameHasFocus: false };
  }
  if (!frameHasFocus) return { activeTarget: 'outside', frameHasFocus };

  const targets: Array<{
    name: G6KeyboardFocusTarget;
    locator: Locator;
    countCapped: number;
  }> = [
    {
      name: 'edit',
      locator: controls.edit,
      countCapped: controls.editCountCapped,
    },
    {
      name: 'delete',
      locator: controls.delete,
      countCapped: controls.deleteCountCapped,
    },
    {
      name: 'close',
      locator: controls.close,
      countCapped: controls.closeCountCapped,
    },
  ];
  let ambiguousTarget = false;
  const focusState = async (locator: Locator, countCapped: number) => {
    if (countCapped > 1) {
      ambiguousTarget = true;
      return undefined;
    }
    if (countCapped === 0) return false;
    return locator
      .evaluate((element) => element.ownerDocument.activeElement === element)
      .catch(() => undefined);
  };
  const focused: Record<string, boolean | undefined> = {};
  for (const target of targets) {
    focused[target.name] = await focusState(target.locator, target.countCapped);
  }

  const dialogContentCount = await controls.dialogContent
    .count()
    .catch(() => 0);
  focused['dialog-content'] = await focusState(
    controls.dialogContent,
    Math.min(dialogContentCount, 2),
  );
  return {
    activeTarget: classifyG6KeyboardFocusTarget({
      frameHasFocus,
      activeElementAvailable,
      editFocused: focused.edit,
      deleteFocused: focused.delete,
      closeFocused: focused.close,
      dialogContentFocused: focused['dialog-content'],
      ambiguousTarget,
    }),
    frameHasFocus,
  };
}

/**
 * Run the G6 unsupported-iCalendar and client-interaction acceptance journey.
 *
 * The supplied dependencies keep Element, gateway, and fixture setup owned by
 * the registering acceptance suite while this module owns the journey steps.
 */
export async function runElementG6AcceptanceJourney(
  dependencies: G6AcceptanceDependencies,
): Promise<void> {
  const {
    browser,
    fixture,
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
  } = dependencies;

  const contexts: BrowserContext[] = [];
  const resourcesToTrack: G6ResourceOwnership[] = [];
  const blockedRequestsByContext = new WeakMap<
    BrowserContext,
    { count: number }
  >();
  const resourceOwnershipByName = new Map<string, G6ResourceOwnership>();
  const stageRecords = new Map<G6Phase, G6StageRecord>();
  const allowedOrigins = new Set([
    new URL(fixture.elementUrl).origin,
    new URL(fixture.homeserverUrl).origin,
    'http://localhost:8008',
    new URL(fixture.gatewayUrl).origin,
    new URL(fixture.widgetUrl).origin,
  ]);
  let blockedRequests = 0;
  let activeG6Phase: G6Phase = 'g6-fixture-ready';
  let activeRoomPhase:
    | 'g6-member-a-room-context'
    | 'g6-member-b-room-context'
    | undefined;
  let calDavClient: G6CalDavClient | undefined;
  let journeyFailed = false;
  let neighborPostSaveListObserver: G6PostSaveListObserver | undefined;

  const saveG6Stage = (observation: G6StageRecord) => {
    stageRecords.set(observation.phase, observation);
    const { phase, status, httpStatus, count, ...extra } = observation;
    record(phase, status, httpStatus, count, extra);
  };
  const assertG6Stage = (
    phase: G6Phase,
    passed: boolean,
    evidence: Omit<Partial<G6StageRecord>, 'phase' | 'status'> = {},
  ) => {
    saveG6Stage({ phase, status: passed ? 'passed' : 'failed', ...evidence });
    expect(passed).toBe(true);
  };

  const newRoutedContext = async (): Promise<BrowserContext> => {
    const context = await browser.newContext({
      locale: 'en-US',
      timezoneId: 'Europe/Stockholm',
      viewport: { width: 1440, height: 900 },
    });
    const contextBlockedRequests = { count: 0 };
    blockedRequestsByContext.set(context, contextBlockedRequests);
    contexts.push(context);
    await context.route('**/*', async (route) => {
      let origin: string;
      try {
        origin = new URL(route.request().url()).origin;
      } catch {
        blockedRequests = Math.min(blockedRequests + 1, 100_000);
        contextBlockedRequests.count = Math.min(
          contextBlockedRequests.count + 1,
          100_000,
        );
        await route.abort('blockedbyclient');
        return;
      }
      if (!allowedOrigins.has(origin)) {
        blockedRequests = Math.min(blockedRequests + 1, 100_000);
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

  let pageA: Page | undefined;
  let pageB: Page | undefined;
  let frameA: FrameLocator | undefined;
  let frameB: FrameLocator | undefined;
  const names = {
    unsupported: `G6 unsupported ${randomUUID()}`,
    neighbor: `G6 neighbor ${randomUUID()}`,
    neighborEdited: `G6 neighbor edited ${randomUUID()}`,
    deletable: `G6 delete ${randomUUID()}`,
    keyboard: `G6 keyboard ${randomUUID()}`,
  };
  const resources = {
    unsupported: `g6-${randomUUID()}.ics`,
    neighbor: `g6-${randomUUID()}.ics`,
    deletable: `g6-${randomUUID()}.ics`,
    keyboard: `g6-${randomUUID()}.ics`,
  };

  try {
    const contextA = await newRoutedContext();
    pageA = await authenticateInElement(contextA, fixture.users.memberA, true);
    record('member-a-authenticated', 'passed');
    activeRoomPhase = 'g6-member-a-room-context';
    const memberARoom = await openMemberARoomWithDiagnostics(
      pageA,
      fixture.roomName,
      fixture.teamRoomId,
      fixture.users.memberA.userId,
      {
        blockedExternalRequests: blockedRequestsByContext.get(contextA),
      },
    );
    recordMemberARoomObservation(memberARoom, activeRoomPhase);
    if (memberARoom.failureCode) {
      throw new Error('Member A room context was not ready');
    }
    activeRoomPhase = undefined;

    const contextB = await newRoutedContext();
    pageB = await authenticateInElement(
      contextB,
      fixture.users.memberB,
      false,
      true,
    );
    record('member-b-authenticated', 'passed');
    activeRoomPhase = 'g6-member-b-room-context';
    const memberBRoom = await openMemberARoomWithDiagnostics(
      pageB,
      fixture.roomName,
      fixture.teamRoomId,
      fixture.users.memberB.userId,
      {
        captureReminderRoomLayout: true,
        captureRoomReadinessTimeline: true,
        blockedExternalRequests: blockedRequestsByContext.get(contextB),
      },
    );
    recordMemberARoomObservation(memberBRoom, activeRoomPhase);
    if (memberBRoom.failureCode) {
      throw new Error('Member B room context was not ready');
    }
    activeRoomPhase = undefined;

    activeG6Phase = 'g6-fixture-ready';
    const calDavResult = await createG6CalDavClient(fixture);
    if (calDavResult.client) calDavClient = calDavResult.client;
    if (calDavClient === undefined) {
      assertG6Stage(activeG6Phase, false, {
        ...(calDavResult.status === undefined
          ? {}
          : { httpStatus: calDavResult.status }),
        openIdProofValid: calDavResult.proofValid,
        allResourcesSeeded: false,
        count: 0,
      });
      throw new Error('Fixture CalDAV access was not available');
    }

    const startAt = Date.now() + 10 * 60_000;
    const eventEndAt = startAt + 60 * 60_000;
    const resourcesToSeed = [
      {
        name: resources.unsupported,
        icalendar: g6UnsupportedSeriesIcal(
          randomUUID(),
          names.unsupported,
          startAt,
        ),
      },
      {
        name: resources.neighbor,
        icalendar: g6SimpleEventIcal(
          randomUUID(),
          names.neighbor,
          startAt,
          eventEndAt,
        ),
      },
      {
        name: resources.deletable,
        icalendar: g6SimpleEventIcal(
          randomUUID(),
          names.deletable,
          startAt + 5 * 60_000,
          eventEndAt + 5 * 60_000,
        ),
      },
      {
        name: resources.keyboard,
        icalendar: g6SimpleEventIcal(
          randomUUID(),
          names.keyboard,
          startAt + 10 * 60_000,
          eventEndAt + 10 * 60_000,
        ),
      },
    ];

    let createdResourceCount = 0;
    const seedCreateObservations: G6SeedCreateObservation[] = [];
    for (const resource of resourcesToSeed) {
      const ownership = createG6ResourceOwnership(resource.name);
      resourcesToTrack.push(ownership);
      resourceOwnershipByName.set(resource.name, ownership);
      beginG6ResourceCreate(ownership);
      const result = await g6CalDavRequest(
        calDavClient!,
        resource.name,
        'PUT',
        resource.icalendar,
      );
      seedCreateObservations.push({
        outcome: result.outcome,
        status: result.status ?? null,
        etagPresent:
          result.outcome === 'response'
            ? typeof result.etag === 'string'
            : null,
        etagStrong:
          result.outcome === 'response'
            ? isStrongG6ResourceEtag(result.etag)
            : null,
      });
      if (recordG6ResourceCreate(ownership, result.status, result.etag)) {
        createdResourceCount += 1;
      }
    }
    const allResourcesSeeded = createdResourceCount === resourcesToSeed.length;
    assertG6Stage(activeG6Phase, allResourcesSeeded, {
      ...(calDavResult.status === undefined
        ? {}
        : { httpStatus: calDavResult.status }),
      openIdProofValid: calDavResult.proofValid,
      allResourcesSeeded,
      count: createdResourceCount,
      seedCreateObservations,
    });

    const unsupportedBefore = await g6CalDavRequest(
      calDavClient!,
      resources.unsupported,
      'GET',
    );
    const canonicalSnapshotAvailable =
      unsupportedBefore.status === 200 && unsupportedBefore.bytes !== undefined;

    activeG6Phase = 'g6-unsupported-preservation';
    const memberAEventsResponse = waitForG6EventsResponse(
      pageA,
      fixture.teamRoomId,
      fixture,
    );
    void memberAEventsResponse.catch(() => undefined);
    const elementA = memberARoom.element;
    frameA = await openCalendarWidget(elementA, pageA, {
      expectWidgetWarning: false,
      waitForCalendar: false,
    });
    const memberAEvents = await memberAEventsResponse.catch(() => undefined);
    const memberAEventsStatus = memberAEvents?.status();
    const warning = frameA
      .getByRole('alert')
      .filter({ hasText: 'THISANDFUTURE' });
    const unsupportedRow = frameA.getByRole('listitem', {
      name: names.unsupported,
    });
    const neighborRow = frameA.getByRole('listitem', { name: names.neighbor });
    await Promise.all([
      warning.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {}),
      neighborRow
        .waitFor({ state: 'visible', timeout: 30_000 })
        .catch(() => {}),
    ]);
    const unsupportedWarningVisible = await warning
      .isVisible()
      .catch(() => false);
    const unsupportedRowOmitted =
      (await unsupportedRow.count().catch(() => 0)) === 0;
    const supportedNeighborVisible = await neighborRow
      .isVisible()
      .catch(() => false);

    await openEventEditor(frameA, names.neighbor);
    const neighborEditor = frameA.getByRole('dialog').last();
    const neighborPatchResponse = waitForGatewayResponse(
      pageA,
      'PATCH',
      '/v1/calendar/events',
    );
    void neighborPatchResponse.catch(() => undefined);
    await neighborEditor
      .getByRole('textbox', { name: 'Title' })
      .fill(names.neighborEdited);
    neighborPostSaveListObserver = observeNextG6PostSaveListResponse(
      pageA,
      fixture.teamRoomId,
      names.neighborEdited,
      fixture,
      isRecord,
    );
    await neighborEditor
      .getByRole('button', { name: 'Save', exact: true })
      .click();
    const neighborPatch = await neighborPatchResponse.catch(() => undefined);
    const neighborPatchStatus = neighborPatch?.status();
    const neighborResourceHref = new URL(
      encodeURIComponent(resources.neighbor),
      calDavClient!.collectionUrl,
    ).href;
    const neighborUpdate = await readGatewayEventUpdate(
      neighborPatch,
      neighborResourceHref,
      names.neighborEdited,
      calDavClient!.localpart,
    );
    const neighborOwnership = resourceOwnershipByName.get(resources.neighbor);
    const neighborOwnershipUpdated =
      neighborOwnership !== undefined &&
      recordG6ResourceUpdate(
        neighborOwnership,
        neighborPatchStatus,
        neighborUpdate.etag,
        neighborUpdate.identityMatches,
      );
    // Saving returns to the event details dialog; close it through the normal
    // UI before asserting that the updated row is visible in the list.
    const savedNeighborDetails = frameA.getByRole('dialog').last();
    await expect(savedNeighborDetails).toBeVisible();
    await savedNeighborDetails
      .getByRole('button', { name: 'Close', exact: true })
      .click();
    await expect(savedNeighborDetails).toBeHidden();
    const editedNeighborRow = frameA.getByRole('listitem', {
      name: names.neighborEdited,
    });
    await editedNeighborRow
      .waitFor({ state: 'visible', timeout: 20_000 })
      .catch(() => {});
    const neighborEditedRowVisible = await editedNeighborRow
      .isVisible()
      .catch(() => false);
    const neighborListUiObservation = await observeG6PostSaveListUi(
      frameA,
      editedNeighborRow,
    );
    const neighborListRefreshObservation =
      neighborPostSaveListObserver.snapshot();
    neighborPostSaveListObserver.dispose();
    neighborPostSaveListObserver = undefined;
    const supportedNeighborEdited =
      neighborPatchStatus !== undefined &&
      neighborPatchStatus >= 200 &&
      neighborPatchStatus < 300 &&
      neighborOwnershipUpdated &&
      neighborEditedRowVisible;
    const neighborPatchTitleOutcome: G6NeighborTitleOutcome =
      neighborUpdate.titleMatches === true
        ? 'matched'
        : neighborUpdate.titleMatches === false
          ? 'mismatched'
          : 'unavailable';
    let neighborCanonicalTitleReadbackOutcome: G6CanonicalTitleReadbackOutcome;
    let neighborCanonicalTitleReadbackHttpStatus: number | undefined;
    if (neighborEditedRowVisible) {
      neighborCanonicalTitleReadbackOutcome = 'not-needed';
    } else if (neighborOwnership?.confirmedCreated !== true) {
      neighborCanonicalTitleReadbackOutcome = 'not-owned';
    } else {
      const canonicalNeighbor = await g6CalDavRequest(
        calDavClient!,
        resources.neighbor,
        'GET',
      );
      neighborCanonicalTitleReadbackHttpStatus = canonicalNeighbor.status;
      const canonicalTitleMatches =
        canonicalNeighbor.outcome === 'response' &&
        canonicalNeighbor.status === 200 &&
        canonicalNeighbor.bytes !== undefined
          ? g6EventSummaryMatches(canonicalNeighbor.bytes, names.neighborEdited)
          : undefined;
      neighborCanonicalTitleReadbackOutcome =
        canonicalTitleMatches === true
          ? 'matched'
          : canonicalTitleMatches === false
            ? 'mismatched'
            : 'unavailable';
    }

    const unsupportedAfter = await g6CalDavRequest(
      calDavClient!,
      resources.unsupported,
      'GET',
    );
    const canonicalUnsupportedObjectUnchanged =
      unsupportedAfter.status === 200 &&
      unsupportedAfter.bytes !== undefined &&
      unsupportedBefore.bytes !== undefined &&
      unsupportedBefore.bytes.equals(unsupportedAfter.bytes);
    const unsupportedPreservationPassed =
      memberAEventsStatus === 200 &&
      unsupportedWarningVisible &&
      unsupportedRowOmitted &&
      supportedNeighborVisible &&
      canonicalSnapshotAvailable &&
      supportedNeighborEdited &&
      canonicalUnsupportedObjectUnchanged;
    assertG6Stage(activeG6Phase, unsupportedPreservationPassed, {
      ...(memberAEventsStatus === undefined
        ? {}
        : { projectionHttpStatus: memberAEventsStatus }),
      ...(unsupportedBefore.status === undefined
        ? {}
        : { canonicalBeforeHttpStatus: unsupportedBefore.status }),
      ...(neighborPatchStatus === undefined
        ? {}
        : { neighborPatchHttpStatus: neighborPatchStatus }),
      ...(unsupportedAfter.status === undefined
        ? {}
        : { canonicalAfterHttpStatus: unsupportedAfter.status }),
      count: unsupportedWarningVisible ? 1 : 0,
      unsupportedWarningVisible,
      unsupportedRowOmitted,
      supportedNeighborVisible,
      canonicalSnapshotAvailable,
      neighborEditedRowVisible,
      supportedNeighborEdited,
      canonicalUnsupportedObjectUnchanged,
      neighborOwnershipUpdated,
      neighborUpdateIdentityMatches: neighborUpdate.identityMatches,
      neighborPatchTitleOutcome,
      neighborCanonicalTitleReadbackOutcome,
      neighborListRefreshOutcome: neighborListRefreshObservation.outcome,
      neighborListRefreshHttpStatus: neighborListRefreshObservation.httpStatus,
      ...(neighborListRefreshObservation.eventCountCapped === undefined
        ? {}
        : {
            neighborListRefreshEventCountCapped:
              neighborListRefreshObservation.eventCountCapped,
            neighborListRefreshEventCountOverflow:
              neighborListRefreshObservation.eventCountOverflow,
          }),
      ...(neighborListRefreshObservation.editedTitleMatches === undefined
        ? {}
        : {
            neighborListRefreshEditedTitleMatches:
              neighborListRefreshObservation.editedTitleMatches,
          }),
      neighborListUiObservation: neighborListUiObservation.state,
      ...(neighborListUiObservation.state === 'observed'
        ? {
            neighborListLoadingVisible:
              neighborListUiObservation.loadingVisible,
            neighborListErrorVisible: neighborListUiObservation.errorVisible,
            neighborEditedRowCountCapped:
              neighborListUiObservation.editedRowCountCapped,
            neighborEditedRowCountOverflow:
              neighborListUiObservation.editedRowCountOverflow,
            neighborListEditedRowVisible:
              neighborListUiObservation.editedRowVisible,
          }
        : {}),
      ...(neighborCanonicalTitleReadbackHttpStatus === undefined
        ? {}
        : { neighborCanonicalTitleReadbackHttpStatus }),
    });

    activeG6Phase = 'g6-side-panel-layout';
    const neighborDetails = frameA.getByRole('dialog').last();
    if (await neighborDetails.isVisible().catch(() => false)) {
      await neighborDetails
        .getByRole('button', { name: 'Close', exact: true })
        .click();
    }
    await editedNeighborRow.click();
    const narrowDetails = frameA.getByRole('dialog').last();
    try {
      await expect(narrowDetails).toBeVisible();
    } catch {
      // Record the observed visibility below without failing this probe.
    }
    const eventDetailsReachable = await narrowDetails
      .isVisible()
      .catch(() => false);
    if (eventDetailsReachable) {
      await narrowDetails
        .getByRole('button', { name: 'Close', exact: true })
        .click();
      await expect(narrowDetails).toBeHidden();
      await frameA
        .getByRole('button', { name: 'Create event', exact: true })
        .waitFor({ state: 'visible' })
        .catch(() => {});
    }
    const createEventButton = frameA.getByRole('button', {
      name: 'Create event',
      exact: true,
    });
    let createEventButtonEnabled = true;
    try {
      await expect(createEventButton).toBeEnabled({ timeout: 10_000 });
    } catch {
      createEventButtonEnabled = false;
    }
    const sidePanelToolbarObservation = await observeG6SidePanelToolbar(frameA);
    const createControlReachable =
      createEventButtonEnabled &&
      (await createEventButton.isVisible().catch(() => false)) &&
      sidePanelToolbarObservation.createEventButtonEnabled === 'enabled';
    const viewport = pageA.viewportSize();
    const widgetCard = pageA.locator('.mx_WidgetCard');
    const widgetCardCount = Math.min(
      await widgetCard.count().catch(() => 0),
      2,
    );
    const widgetCardVisible = await widgetCard
      .first()
      .isVisible()
      .catch(() => false);
    const appDrawerCount = Math.min(
      await pageA
        .locator('.mx_AppsDrawer')
        .count()
        .catch(() => 0),
      2,
    );
    const persistedHostFrame = pageA.locator(
      '#mx_PersistedElement_container iframe[title="Matrix Calendar"]',
    );
    const persistedHostFramePresent =
      (await persistedHostFrame.count().catch(() => 0)) === 1 &&
      (await persistedHostFrame.isVisible().catch(() => false));
    const sidePanelBox = await persistedHostFrame
      .boundingBox()
      .catch(() => null);
    const hostNoHorizontalOverflow = await pageA
      .evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      )
      .catch(() => false);
    const widgetNoHorizontalOverflow = await frameA
      .locator('html')
      .evaluate((element) => element.scrollWidth <= element.clientWidth)
      .catch(() => false);
    const iframeWidth = sidePanelBox
      ? Math.round(sidePanelBox.width)
      : undefined;
    const iframeHeight = sidePanelBox
      ? Math.round(sidePanelBox.height)
      : undefined;
    const sidePanelLayoutPassed =
      viewport?.width === 1440 &&
      viewport.height === 900 &&
      widgetCardCount === 1 &&
      widgetCardVisible &&
      persistedHostFramePresent &&
      iframeWidth !== undefined &&
      iframeWidth > 0 &&
      iframeHeight !== undefined &&
      iframeHeight > 0 &&
      createControlReachable &&
      eventDetailsReachable &&
      hostNoHorizontalOverflow &&
      widgetNoHorizontalOverflow;
    assertG6Stage(activeG6Phase, sidePanelLayoutPassed, {
      widgetCardCount,
      appDrawerCount,
      widgetCardVisible,
      createControlReachable,
      eventDetailsReachable,
      hostNoHorizontalOverflow,
      widgetNoHorizontalOverflow,
      persistedHostFramePresent,
      ...sidePanelToolbarObservation,
      ...(viewport
        ? { viewportWidth: viewport.width, viewportHeight: viewport.height }
        : {}),
      ...(iframeWidth === undefined ? {} : { iframeWidth }),
      ...(iframeHeight === undefined ? {} : { iframeHeight }),
    });

    activeG6Phase = 'g6-keyboard-focus';
    const keyboardEventButton = frameA.getByRole('button', {
      name: names.keyboard,
    });
    await keyboardEventButton
      .waitFor({ state: 'visible', timeout: 20_000 })
      .catch(() => {});
    let eventActionTabCount = 0;
    let keyboardEventFocused = await keyboardEventButton
      .evaluate((element) => element === document.activeElement)
      .catch(() => false);
    while (!keyboardEventFocused && eventActionTabCount < 80) {
      await pageA.keyboard.press('Tab');
      eventActionTabCount += 1;
      keyboardEventFocused = await keyboardEventButton
        .evaluate((element) => element === document.activeElement)
        .catch(() => false);
    }
    if (keyboardEventFocused) await pageA.keyboard.press('Enter');
    const keyboardDetails = frameA.getByRole('dialog').last();
    const detailsOpened = await keyboardDetails
      .waitFor({ state: 'visible', timeout: 8_000 })
      .then(() => true)
      .catch(() => false);
    const editButton = keyboardDetails.getByRole('button', {
      name: 'Edit',
      exact: true,
    });
    const deleteAction = keyboardDetails.getByRole('button', {
      name: 'Delete',
      exact: true,
    });
    const closeAction = keyboardDetails.getByRole('button', {
      name: 'Close',
      exact: true,
    });
    const [
      editControlObservation,
      deleteControlObservation,
      closeControlObservation,
    ] = await Promise.all([
      observeG6KeyboardControl(editButton),
      observeG6KeyboardControl(deleteAction),
      observeG6KeyboardControl(closeAction),
    ]);
    const keyboardFocusControls = {
      edit: editButton,
      editCountCapped: editControlObservation.countCapped,
      delete: deleteAction,
      deleteCountCapped: deleteControlObservation.countCapped,
      close: closeAction,
      closeCountCapped: closeControlObservation.countCapped,
      dialogContent: keyboardDetails.locator('.MuiDialogContent-root'),
    };
    const initialDetailsFocus = await observeG6KeyboardFocusTarget(
      frameA,
      keyboardFocusControls,
    );
    const detailsTabFocusObservations: G6KeyboardTabFocusObservation[] = [];
    let detailsActionTabCount = 0;
    let editActionFocused = await editButton
      .evaluate((element) => element === document.activeElement)
      .catch(() => false);
    while (!editActionFocused && detailsOpened && detailsActionTabCount < 12) {
      await pageA.keyboard.press('Tab');
      detailsActionTabCount += 1;
      detailsTabFocusObservations.push(
        await observeG6KeyboardFocusTarget(frameA, keyboardFocusControls),
      );
      editActionFocused = await editButton
        .evaluate((element) => element === document.activeElement)
        .catch(() => false);
    }
    let deleteActionFocused = false;
    let closeActionFocused = false;
    let escapeAttempted = false;
    if (editActionFocused) {
      await pageA.keyboard.press('Tab');
      detailsActionTabCount += 1;
      deleteActionFocused = await deleteAction
        .evaluate((element) => element === document.activeElement)
        .catch(() => false);
      await pageA.keyboard.press('Tab');
      detailsActionTabCount += 1;
      closeActionFocused = await closeAction
        .evaluate((element) => element === document.activeElement)
        .catch(() => false);
      escapeAttempted = true;
      await pageA.keyboard.press('Escape');
    }
    const escapeClosedDialog = await keyboardDetails
      .waitFor({ state: 'hidden', timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    let focusReturnedToEvent = false;
    try {
      await expect(keyboardEventButton).toBeFocused({ timeout: 5_000 });
      focusReturnedToEvent = true;
    } catch {
      focusReturnedToEvent = false;
    }
    const keyboardPassed =
      keyboardEventFocused &&
      detailsOpened &&
      editActionFocused &&
      deleteActionFocused &&
      closeActionFocused &&
      escapeClosedDialog &&
      focusReturnedToEvent;
    assertG6Stage(activeG6Phase, keyboardPassed, {
      count: eventActionTabCount,
      eventActionTabCount,
      detailsActionTabCount,
      keyboardEventFocused,
      detailsOpened,
      editActionFocused,
      deleteActionFocused,
      closeActionFocused,
      escapeClosedDialog,
      focusReturnedToEvent,
      editActionCountCapped: editControlObservation.countCapped,
      editActionVisibility: editControlObservation.visibility,
      editActionEnabled: editControlObservation.enabled,
      deleteActionCountCapped: deleteControlObservation.countCapped,
      deleteActionVisibility: deleteControlObservation.visibility,
      deleteActionEnabled: deleteControlObservation.enabled,
      closeActionCountCapped: closeControlObservation.countCapped,
      closeActionVisibility: closeControlObservation.visibility,
      closeActionEnabled: closeControlObservation.enabled,
      initialDetailsFocusTarget: initialDetailsFocus.activeTarget,
      keyboardFrameHasFocus: initialDetailsFocus.frameHasFocus,
      detailsTabFocusObservations,
      escapeAttempted,
    });

    activeG6Phase = 'g6-delete-and-refresh';
    const memberBEventsResponse = waitForG6EventsResponse(
      pageB,
      fixture.teamRoomId,
      fixture,
    );
    void memberBEventsResponse.catch(() => undefined);
    frameB = await openCalendarWidget(memberBRoom.element, pageB, {
      expectWidgetWarning: false,
      waitForCalendar: false,
    });
    const memberBEvents = await memberBEventsResponse.catch(() => undefined);
    const memberBEventsStatus = memberBEvents?.status();

    const memberBDeleteRow = frameB.getByRole('listitem', {
      name: names.deletable,
    });
    await memberBDeleteRow
      .waitFor({ state: 'visible', timeout: 30_000 })
      .catch(() => {});
    const memberBDeleteRowVisible = await memberBDeleteRow
      .isVisible()
      .catch(() => false);
    const deletableRow = frameA.getByRole('listitem', {
      name: names.deletable,
    });
    await deletableRow.click();
    const deleteDetails = frameA.getByRole('dialog').last();
    const deleteButton = deleteDetails.getByRole('button', {
      name: 'Delete',
      exact: true,
    });
    const deleteButtonVisible = await deleteButton
      .waitFor({ state: 'visible', timeout: 8_000 })
      .then(() => true)
      .catch(() => false);
    await deleteButton.click();
    const confirmation = frameA.getByRole('dialog', { name: 'Delete event' });
    const deleteConfirmationVisible = await confirmation
      .isVisible()
      .catch(() => false);
    const deleteResponse = waitForGatewayResponse(
      pageA,
      'DELETE',
      '/v1/calendar/events',
    );
    void deleteResponse.catch(() => undefined);
    await confirmation
      .getByRole('button', { name: 'Delete', exact: true })
      .click();
    const deleteResult = await deleteResponse.catch(() => undefined);
    const deleteHttpStatus = deleteResult?.status();
    await deletableRow
      .waitFor({ state: 'detached', timeout: 20_000 })
      .catch(() => {});
    const deletedRowAbsent = (await deletableRow.count().catch(() => 1)) === 0;
    const deletePassed =
      deleteButtonVisible &&
      deleteConfirmationVisible &&
      deleteHttpStatus !== undefined &&
      deleteHttpStatus >= 200 &&
      deleteHttpStatus < 300 &&
      deletedRowAbsent;
    const canonicalDelete = await g6CalDavRequest(
      calDavClient!,
      resources.deletable,
      'GET',
    );
    const canonicalObjectAbsent = canonicalDelete.status === 404;

    await pageB.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
    const memberBReloadedRoom = await openFixtureRoom(
      pageB,
      fixture.roomName,
      fixture.teamRoomId,
    );
    const memberBReloadEventsResponse = waitForG6EventsResponse(
      pageB,
      fixture.teamRoomId,
      fixture,
    );
    void memberBReloadEventsResponse.catch(() => undefined);
    frameB = await openCalendarWidget(memberBReloadedRoom, pageB, {
      expectWidgetWarning: false,
      waitForCalendar: false,
    });
    const memberBReloadEvents = await memberBReloadEventsResponse.catch(
      () => undefined,
    );
    const memberBReloadStatus = memberBReloadEvents?.status();
    const memberBNeighbor = frameB.getByRole('listitem', {
      name: names.neighborEdited,
    });
    await memberBNeighbor
      .waitFor({ state: 'visible', timeout: 30_000 })
      .catch(() => {});
    const memberBDeleteRowAfterReload = frameB.getByRole('listitem', {
      name: names.deletable,
    });
    const memberBDeleteRowAbsent =
      (await memberBDeleteRowAfterReload.count().catch(() => 1)) === 0;
    const memberBNeighborVisible = await memberBNeighbor
      .isVisible()
      .catch(() => false);
    const memberBRefreshPassed =
      memberBReloadStatus === 200 &&
      memberBDeleteRowAbsent &&
      memberBNeighborVisible;

    const deleteAndRefreshPassed =
      memberBEventsStatus === 200 &&
      memberBDeleteRowVisible &&
      deletePassed &&
      canonicalObjectAbsent &&
      memberBRefreshPassed;
    assertG6Stage(activeG6Phase, deleteAndRefreshPassed, {
      ...(memberBEventsStatus === undefined
        ? {}
        : { memberBEventsHttpStatus: memberBEventsStatus }),
      ...(deleteHttpStatus === undefined ? {} : { deleteHttpStatus }),
      ...(canonicalDelete.status === undefined
        ? {}
        : { canonicalDeleteHttpStatus: canonicalDelete.status }),
      ...(memberBReloadStatus === undefined
        ? {}
        : { memberBReloadHttpStatus: memberBReloadStatus }),
      count: 1,
      memberBDeleteRowVisible,
      deleteButtonVisible,
      deleteConfirmationVisible,
      deletedRowAbsent,
      canonicalObjectAbsent,
      memberBDeleteRowAbsent,
      supportedNeighborVisible: memberBNeighborVisible,
    });

    activeG6Phase = 'g6-browser-egress';
    const browserEgressClear = blockedRequests === 0;
    assertG6Stage(activeG6Phase, browserEgressClear, {
      count: blockedRequests,
      browserEgressClear,
    });
  } catch {
    journeyFailed = true;
    if (!activeRoomPhase && !stageRecords.has(activeG6Phase)) {
      saveG6Stage({ phase: activeG6Phase, status: 'failed' });
    }
  } finally {
    neighborPostSaveListObserver?.dispose();
    await Promise.all(
      contexts.map((context) => context.close().catch(() => {})),
    );
    activeG6Phase = 'g6-resource-cleanup';
    for (const resource of resourcesToTrack) {
      const cleanup = g6ResourceCleanupRequest(resource);
      if (cleanup.method !== 'DELETE') continue;
      const result = calDavClient
        ? await g6CalDavRequest(
            calDavClient,
            resource.name,
            'DELETE',
            undefined,
            cleanup.ifMatch,
          )
        : { outcome: 'not-sent' as const };
      recordG6ResourceCleanup(resource, result.status);
    }
    const cleanupSummary = summarizeG6ResourceOwnership(resourcesToTrack);
    const cleanupPassed = cleanupSummary.allOwnedResourcesRemoved;
    saveG6Stage({
      phase: activeG6Phase,
      status: cleanupPassed ? 'passed' : 'failed',
      ...cleanupSummary,
    });
    if (!cleanupPassed) journeyFailed = true;

    activeG6Phase = 'g6-browser-egress';
    if (!stageRecords.has(activeG6Phase)) {
      const browserEgressClear = blockedRequests === 0;
      saveG6Stage({
        phase: activeG6Phase,
        status: browserEgressClear ? 'passed' : 'failed',
        count: blockedRequests,
        browserEgressClear,
      });
      if (!browserEgressClear) journeyFailed = true;
    }
  }

  if (journeyFailed) {
    throw new Error('Element Web client acceptance cases failed');
  }
}
