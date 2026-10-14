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

import { randomUUID } from 'node:crypto';
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOMESERVER_URL = 'http://127.0.0.1:8008';
const GATEWAY_URL = 'http://127.0.0.1:3000';
const CALENDAR_ID = 'element-acceptance';
const SERVICE_USER_ID = '@_matrix_calendar_service:localhost';
const MANAGE_POLICY = 'io.github.0cwa.matrix-calendar.manage';
const MARKER_PATTERN =
  /^Reminder acceptance [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const MAX_TIMELINE_EVENTS = 100;
const START_LEAD_MS = 150_000;
const ALARM_OFFSET_MS = 60_000;
const POST_DUE_SCAN_ALLOWANCE_MS = 90_000;
const TIMELINE_POLL_MS = 5_000;
const MARKER_COUNT_BY_FLOW = Object.freeze({
  initial: 0,
  restart: 1,
  restore: 2,
});
const FAILURE_PHASES = new Set([
  'fixture',
  'openid',
  'room-permissions',
  'gateway-authorization',
  'prior-deliveries',
  'event-create',
  'event-readback',
  'alarm-options',
  'reminder-config-write',
  'reminder-config-readback',
  'reminder-delivery',
  'marker-write',
]);

class FixtureFailure extends Error {
  constructor(phase) {
    super('Local reminder fixture failed');
    this.phase = FAILURE_PHASES.has(phase) ? phase : 'fixture';
  }
}

function fail(phase) {
  throw new FixtureFailure(phase);
}

function isRecord(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

function hasExactKeys(value, keys) {
  return (
    isRecord(value) &&
    Reflect.ownKeys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function safeCredential(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 4096 &&
    !/[\r\n\u0000-\u001f]/u.test(value)
  );
}

function privateFilePath(environment, name) {
  const runnerTemp = environment.RUNNER_TEMP;
  const filePath = environment[name];
  if (
    typeof runnerTemp !== 'string' ||
    !isAbsolute(runnerTemp) ||
    typeof filePath !== 'string' ||
    !isAbsolute(filePath) ||
    !resolve(filePath).startsWith(`${resolve(runnerTemp)}${sep}`)
  ) {
    fail('fixture');
  }
  try {
    const info = lstatSync(filePath);
    if (!info.isFile() || (info.mode & 0o077) !== 0) fail('fixture');
  } catch {
    fail('fixture');
  }
  return filePath;
}

function readPrivateJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    fail('fixture');
  }
}

function validateFixture(fixture) {
  const member = fixture?.users?.memberA;
  const bot = fixture?.users?.bot;
  const serviceSender = fixture?.serviceSender;
  const expectedServiceUserId =
    fixture?.principalMode === 'appservice' ? SERVICE_USER_ID : bot?.userId;
  if (
    fixture?.homeserverUrl !== HOMESERVER_URL ||
    fixture?.gatewayUrl !== GATEWAY_URL ||
    fixture?.calendarId !== CALENDAR_ID ||
    !['appservice', 'bot-account'].includes(fixture?.principalMode) ||
    typeof fixture?.teamRoomId !== 'string' ||
    !/^![A-Za-z0-9._=-]{1,255}:localhost$/u.test(fixture.teamRoomId) ||
    !member ||
    typeof member.userId !== 'string' ||
    !/^@[a-z0-9][a-z0-9-]{0,254}:localhost$/u.test(member.userId) ||
    !safeCredential(member.accessToken) ||
    !bot ||
    typeof bot.userId !== 'string' ||
    !/^@[a-z0-9][a-z0-9-]{0,254}:localhost$/u.test(bot.userId) ||
    !safeCredential(bot.accessToken) ||
    serviceSender?.userId !== expectedServiceUserId ||
    !safeCredential(serviceSender?.accessToken)
  ) {
    fail('fixture');
  }
  return { member, serviceSender };
}

function readMarkerTitles(filePath, flow) {
  const titles = readPrivateJson(filePath);
  if (
    !Array.isArray(titles) ||
    titles.length !== MARKER_COUNT_BY_FLOW[flow] ||
    titles.some(
      (title) => typeof title !== 'string' || !MARKER_PATTERN.test(title),
    ) ||
    new Set(titles).size !== titles.length
  ) {
    fail('fixture');
  }
  return titles;
}

function matrixIdentityHeader(openIdToken) {
  return `MX-Identity ${Buffer.from(
    JSON.stringify({
      access_token: openIdToken,
      matrix_server_name: 'localhost',
    }),
  ).toString('base64url')}`;
}

async function request(fetchImpl, url, options, phase, parseJson = true) {
  let response;
  try {
    response = await fetchImpl(url, {
      ...options,
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    fail(phase);
  }
  if (!parseJson) return response;
  let body;
  try {
    body = await response.json();
  } catch {
    fail(phase);
  }
  return { response, body };
}

function assertJoinedPowerPolicy(
  joined,
  powerLevels,
  memberUserId,
  serviceUserId,
) {
  if (
    !isRecord(joined?.joined) ||
    !Object.hasOwn(joined.joined, memberUserId) ||
    !Object.hasOwn(joined.joined, serviceUserId) ||
    !isRecord(powerLevels) ||
    !isRecord(powerLevels.users) ||
    !isRecord(powerLevels.events) ||
    powerLevels.users[memberUserId] !== 100 ||
    powerLevels.users[serviceUserId] !== 50 ||
    powerLevels.events['m.room.message'] !== 0 ||
    powerLevels.events_default !== 100 ||
    powerLevels.state_default !== 100 ||
    powerLevels.notifications?.room !== 50 ||
    (powerLevels.events[MANAGE_POLICY] ?? powerLevels.state_default) !== 100
  ) {
    fail('room-permissions');
  }
}

async function requestOpenId(fetchImpl, fixture, member) {
  const url = new URL(
    `/_matrix/client/v3/user/${encodeURIComponent(member.userId)}/openid/request_token`,
    fixture.homeserverUrl,
  );
  const { response, body } = await request(
    fetchImpl,
    url,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${member.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    },
    'openid',
  );
  if (
    response.status !== 200 ||
    !safeCredential(body?.access_token) ||
    body?.matrix_server_name !== 'localhost'
  ) {
    fail('openid');
  }
  return body.access_token;
}

function gatewayUrl(fixture, route, query) {
  return new URL(`/v1/calendar/${route}?${query}`, fixture.gatewayUrl);
}

async function gatewayJson(
  fetchImpl,
  fixture,
  token,
  method,
  route,
  query,
  phase,
  body,
  etag,
  parseJson = true,
) {
  const headers = { Authorization: matrixIdentityHeader(token) };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (etag !== undefined) headers['If-Match'] = etag;
  return request(
    fetchImpl,
    gatewayUrl(fixture, route, query),
    {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    phase,
    parseJson,
  );
}

function strongEtag(value) {
  return typeof value === 'string' && /^"[\x21\x23-\x7e]{1,200}"$/u.test(value);
}

function eventResourceId(value, fixture, uid) {
  const event = value?.event;
  if (
    !isRecord(event) ||
    event.uid !== uid ||
    typeof event.id !== 'string' ||
    !strongEtag(value.etag)
  ) {
    return undefined;
  }
  let resource;
  try {
    resource = new URL(event.id);
  } catch {
    return undefined;
  }
  const serviceLocalpart = fixture.serviceSender.userId.slice(1).split(':')[0];
  const expectedPath = `/${encodeURIComponent(serviceLocalpart)}/${CALENDAR_ID}/${encodeURIComponent(uid)}.ics`;
  if (
    resource.protocol !== 'http:' ||
    !['radicale:5232', '127.0.0.1:5232'].includes(resource.host) ||
    resource.username ||
    resource.password ||
    resource.search ||
    resource.hash ||
    resource.pathname !== expectedPath
  ) {
    return undefined;
  }
  return { id: resource.toString(), etag: value.etag };
}

function expectedEventResourceIds(fixture, uid) {
  const serviceLocalpart = fixture.serviceSender.userId.slice(1).split(':')[0];
  const path = `/${encodeURIComponent(serviceLocalpart)}/${CALENDAR_ID}/${encodeURIComponent(uid)}.ics`;
  return [`http://radicale:5232${path}`, `http://127.0.0.1:5232${path}`];
}

function isRelativeMinuteAlarm(alarm, uid) {
  return (
    isRecord(alarm) &&
    alarm.action === 'display' &&
    alarm.uid === uid &&
    hasExactKeys(alarm, ['action', 'uid', 'trigger']) &&
    hasExactKeys(alarm.trigger, [
      'weeks',
      'days',
      'hours',
      'minutes',
      'seconds',
    ]) &&
    alarm.trigger.weeks === 0 &&
    alarm.trigger.days === 0 &&
    alarm.trigger.hours === 0 &&
    alarm.trigger.minutes === 1 &&
    alarm.trigger.seconds === 0
  );
}

function readEventQuery(fixture, resourceId) {
  return new URLSearchParams({
    target: 'room',
    roomId: fixture.teamRoomId,
    calendarId: CALENDAR_ID,
    eventId: resourceId,
  });
}

function roomQuery(fixture) {
  return new URLSearchParams({
    target: 'room',
    roomId: fixture.teamRoomId,
    calendarId: CALENDAR_ID,
  });
}

function validConfigIdentity(value, eventUid, alarmUid) {
  return (
    hasExactKeys(value, ['eventUid', 'recurrenceId', 'alarmUid']) &&
    value.eventUid === eventUid &&
    value.recurrenceId === null &&
    value.alarmUid === alarmUid
  );
}

async function readConfigPage(fetchImpl, fixture, token, phase) {
  const query = new URLSearchParams({ limit: '100' });
  const { response, body } = await gatewayJson(
    fetchImpl,
    fixture,
    token,
    'GET',
    `rooms/${encodeURIComponent(fixture.teamRoomId)}/reminders`,
    query,
    phase,
  );
  if (
    response.status !== 200 ||
    !isRecord(body) ||
    !Array.isArray(body.items) ||
    body.items.length > 100 ||
    Object.keys(body).some((key) => !['items', 'nextCursor'].includes(key)) ||
    body.nextCursor !== undefined
  ) {
    fail(phase);
  }
  for (const item of body.items) {
    if (
      !hasExactKeys(item, ['eventUid', 'recurrenceId', 'alarmUid']) ||
      typeof item.eventUid !== 'string' ||
      (item.recurrenceId !== null && typeof item.recurrenceId !== 'string') ||
      typeof item.alarmUid !== 'string'
    ) {
      fail(phase);
    }
  }
  return body.items;
}

async function inspectTimeline(fetchImpl, fixture, titles) {
  const endpoint = new URL(
    `/_matrix/client/v3/rooms/${encodeURIComponent(fixture.teamRoomId)}/messages`,
    fixture.homeserverUrl,
  );
  endpoint.searchParams.set('dir', 'b');
  endpoint.searchParams.set('limit', String(MAX_TIMELINE_EVENTS));
  const response = await request(
    fetchImpl,
    endpoint,
    {
      headers: {
        Authorization: `Bearer ${fixture.serviceSender.accessToken}`,
      },
    },
    'reminder-delivery',
    false,
  );
  if (response.status !== 200) fail('reminder-delivery');
  let payload;
  try {
    payload = await response.json();
  } catch {
    fail('reminder-delivery');
  }
  if (
    !isRecord(payload) ||
    !Array.isArray(payload.chunk) ||
    payload.chunk.length >= MAX_TIMELINE_EVENTS
  ) {
    fail('reminder-delivery');
  }
  return titles.map((title) => {
    const matches = payload.chunk.filter((event) => {
      const content = isRecord(event?.content) ? event.content : undefined;
      return (
        isRecord(event) &&
        event.sender === fixture.serviceSender.userId &&
        event.type === 'm.room.message' &&
        content?.msgtype === 'm.text' &&
        content.body === `Reminder: ${title}`
      );
    });
    const content = matches.length === 1 ? matches[0].content : undefined;
    const timestamp = matches.length === 1 ? matches[0].origin_server_ts : null;
    return {
      count: Math.min(matches.length, 2),
      roomMention:
        isRecord(content?.['m.mentions']) &&
        content['m.mentions'].room === true,
      timestamp: Number.isSafeInteger(timestamp) ? timestamp : null,
    };
  });
}

function assertPriorDeliveries(snapshot, titles, phase = 'prior-deliveries') {
  if (
    snapshot.length !== titles.length ||
    snapshot.some(
      (event) =>
        event.count !== 1 || !event.roomMention || event.timestamp === null,
    )
  ) {
    fail(phase);
  }
}

async function waitForNewDelivery(
  fetchImpl,
  fixture,
  titles,
  dueAt,
  now,
  sleep,
) {
  const deadline = dueAt + POST_DUE_SCAN_ALLOWANCE_MS;
  while (now() <= deadline) {
    const snapshot = await inspectTimeline(fetchImpl, fixture, titles);
    const current = snapshot.at(-1);
    if (current?.count === 1) {
      return { snapshot, deliveredAfterDue: current.timestamp >= dueAt };
    }
    if (current?.count > 1) return { snapshot, deliveredAfterDue: false };
    await sleep(TIMELINE_POLL_MS);
  }
  return {
    snapshot: await inspectTimeline(fetchImpl, fixture, titles),
    deliveredAfterDue: false,
  };
}

export function writeMarkerTitles(
  filePath,
  titles,
  { writeFile = writeFileSync, rename = renameSync, remove = unlinkSync } = {},
) {
  let fd;
  let temporaryPath;
  let ownsTemporaryFile = false;
  try {
    const current = lstatSync(filePath);
    if (!current.isFile() || (current.mode & 0o077) !== 0) fail('marker-write');
    temporaryPath = `${filePath}.${randomUUID()}.tmp`;
    fd = openSync(
      temporaryPath,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    ownsTemporaryFile = true;
    const info = fstatSync(fd);
    if (!info.isFile()) fail('marker-write');
    fchmodSync(fd, 0o600);
    writeFile(fd, JSON.stringify(titles));
    closeSync(fd);
    fd = undefined;
    rename(temporaryPath, filePath);
    ownsTemporaryFile = false;
  } catch {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // Preserve the original marker and still remove only our temp file.
      }
    }
    if (ownsTemporaryFile && temporaryPath) {
      try {
        remove(temporaryPath);
      } catch {
        // The fixed failure result reports no successful marker write.
      }
    }
    fail('marker-write');
  }
}

async function cleanupOwnedResources(
  fetchImpl,
  fixture,
  openIdToken,
  event,
  configWriteAttempted,
  configIdentity,
) {
  if (configWriteAttempted && configIdentity) {
    try {
      const items = await readConfigPage(
        fetchImpl,
        fixture,
        openIdToken,
        'reminder-config-readback',
      );
      const matchingItems = items.filter((item) =>
        validConfigIdentity(
          item,
          configIdentity.eventUid,
          configIdentity.alarmUid,
        ),
      );
      if (matchingItems.length === 1) {
        await gatewayJson(
          fetchImpl,
          fixture,
          openIdToken,
          'DELETE',
          `rooms/${encodeURIComponent(fixture.teamRoomId)}/reminders`,
          new URLSearchParams(),
          'reminder-config-readback',
          configIdentity,
        );
        const remainingItems = await readConfigPage(
          fetchImpl,
          fixture,
          openIdToken,
          'reminder-config-readback',
        );
        if (
          remainingItems.some((item) =>
            validConfigIdentity(
              item,
              configIdentity.eventUid,
              configIdentity.alarmUid,
            ),
          )
        ) {
          return;
        }
      }
    } catch {
      // Cleanup is best-effort and never changes the fixed failure report.
    }
  }
  if (event) {
    const resourceIds = [
      ...(event.resourceIds ?? []),
      ...expectedEventResourceIds(fixture, event.uid),
    ];
    for (const resourceId of new Set(resourceIds)) {
      try {
        const { response, body } = await gatewayJson(
          fetchImpl,
          fixture,
          openIdToken,
          'GET',
          'event',
          readEventQuery(fixture, resourceId),
          'event-readback',
        );
        const currentResource = eventResourceId(body, fixture, event.uid);
        if (
          response.status !== 200 ||
          !currentResource ||
          currentResource.id !== resourceId ||
          body.event.title !== event.title
        ) {
          continue;
        }
        await gatewayJson(
          fetchImpl,
          fixture,
          openIdToken,
          'DELETE',
          'events',
          readEventQuery(fixture, currentResource.id),
          'event-readback',
          undefined,
          currentResource.etag,
          false,
        );
        break;
      } catch {
        // Unavailable or mismatched readback never authorizes event deletion.
      }
    }
  }
}

export async function runLocalReminderFixture({
  environment = process.env,
  fetchImpl = fetch,
  now = Date.now,
  sleep = (milliseconds) =>
    new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds)),
  uuid = randomUUID,
  writeMarker = writeMarkerTitles,
} = {}) {
  const flow = environment.ELEMENT_ACCEPTANCE_REMINDER_FLOW;
  const summary = {
    phase: 'local-reminder-fixture',
    flow: ['initial', 'restart', 'restore'].includes(flow) ? flow : 'unknown',
    status: 'failed',
    failurePhase: 'fixture',
    markerWritten: false,
  };
  let fixture;
  let openIdToken;
  let ownedEvent;
  let configWriteAttempted = false;
  let configIdentity;
  try {
    if (environment.ELEMENT_ACCEPTANCE_REMINDER_FIXTURE !== '1')
      fail('fixture');
    if (!['initial', 'restart', 'restore'].includes(flow)) fail('fixture');
    const fixturePath = privateFilePath(
      environment,
      'ELEMENT_ACCEPTANCE_USERS_FILE',
    );
    const markerPath = privateFilePath(
      environment,
      'ELEMENT_ACCEPTANCE_REMINDER_EVENT_FILE',
    );
    if (resolve(fixturePath) === resolve(markerPath)) fail('fixture');
    fixture = readPrivateJson(fixturePath);
    const { member, serviceSender } = validateFixture(fixture);
    const priorTitles = readMarkerTitles(markerPath, flow);

    summary.failurePhase = 'openid';
    openIdToken = await requestOpenId(fetchImpl, fixture, member);

    summary.failurePhase = 'room-permissions';
    const roomPath = `/_matrix/client/v3/rooms/${encodeURIComponent(fixture.teamRoomId)}`;
    const [joinedResult, powerResult] = await Promise.all([
      request(
        fetchImpl,
        new URL(`${roomPath}/joined_members`, fixture.homeserverUrl),
        { headers: { Authorization: `Bearer ${member.accessToken}` } },
        'room-permissions',
      ),
      request(
        fetchImpl,
        new URL(
          `${roomPath}/state/m.room.power_levels/`,
          fixture.homeserverUrl,
        ),
        { headers: { Authorization: `Bearer ${member.accessToken}` } },
        'room-permissions',
      ),
    ]);
    if (
      joinedResult.response.status !== 200 ||
      powerResult.response.status !== 200
    ) {
      fail('room-permissions');
    }
    assertJoinedPowerPolicy(
      joinedResult.body,
      powerResult.body,
      member.userId,
      serviceSender.userId,
    );

    summary.failurePhase = 'gateway-authorization';
    const contextQuery = new URLSearchParams({ roomId: fixture.teamRoomId });
    const { response: contextResponse, body: context } = await gatewayJson(
      fetchImpl,
      fixture,
      openIdToken,
      'GET',
      'context',
      contextQuery,
      'gateway-authorization',
    );
    if (
      contextResponse.status !== 200 ||
      context?.userId !== member.userId ||
      context?.roomId !== fixture.teamRoomId ||
      context?.roomCalendar?.calendarId !== CALENDAR_ID ||
      context?.roomCalendar?.canReadEvents !== true ||
      context?.roomCalendar?.canWriteEvents !== true ||
      context?.roomCalendar?.canManageReminders !== true
    ) {
      fail('gateway-authorization');
    }

    summary.failurePhase = 'prior-deliveries';
    const priorSnapshot = await inspectTimeline(
      fetchImpl,
      fixture,
      priorTitles,
    );
    assertPriorDeliveries(priorSnapshot, priorTitles);

    const eventUuid = uuid();
    if (!MARKER_PATTERN.test(`Reminder acceptance ${eventUuid}`))
      fail('event-create');
    const title = `Reminder acceptance ${eventUuid}`;
    const uid = `local-reminder-${eventUuid}`;
    const startedAt = Math.ceil((now() + START_LEAD_MS) / 60_000) * 60_000;
    const dueAt = startedAt - ALARM_OFFSET_MS;
    const startLocal = new Date(startedAt).toISOString().slice(0, 19);
    const endLocal = new Date(startedAt + 60 * 60_000)
      .toISOString()
      .slice(0, 19);
    const createInput = {
      uid,
      title,
      timing: {
        type: 'timed',
        start: { type: 'zoned', local: startLocal, timezone: 'UTC' },
        end: { type: 'zoned', local: endLocal, timezone: 'UTC' },
      },
      alarm: {
        action: 'display',
        trigger: { weeks: 0, days: 0, hours: 0, minutes: 1, seconds: 0 },
      },
    };

    summary.failurePhase = 'event-create';
    const createQuery = roomQuery(fixture);
    ownedEvent = {
      uid,
      title,
      resourceIds: expectedEventResourceIds(fixture, uid),
    };
    const { response: createResponse, body: created } = await gatewayJson(
      fetchImpl,
      fixture,
      openIdToken,
      'POST',
      'events',
      createQuery,
      'event-create',
      createInput,
    );
    const createdResource = eventResourceId(created, fixture, uid);
    if (createdResource) {
      ownedEvent.resourceIds = [...ownedEvent.resourceIds, createdResource.id];
    }
    if (
      (createResponse.status !== 200 && createResponse.status !== 201) ||
      !createdResource ||
      created?.event?.title !== title ||
      typeof created?.event?.alarm?.uid !== 'string' ||
      created.event.alarm.uid.length === 0 ||
      !isRelativeMinuteAlarm(created?.event?.alarm, created?.event?.alarm?.uid)
    ) {
      fail('event-create');
    }
    const alarmUid = created.event.alarm.uid;
    configIdentity = { eventUid: uid, recurrenceId: null, alarmUid };

    summary.failurePhase = 'event-readback';
    const readQuery = readEventQuery(fixture, createdResource.id);
    const { response: eventResponse, body: eventReadback } = await gatewayJson(
      fetchImpl,
      fixture,
      openIdToken,
      'GET',
      'event',
      readQuery,
      'event-readback',
    );
    const readbackResource = eventResourceId(eventReadback, fixture, uid);
    if (
      eventResponse.status !== 200 ||
      !readbackResource ||
      readbackResource.id !== createdResource.id ||
      readbackResource.etag !== createdResource.etag ||
      eventReadback.event.title !== title ||
      !isRelativeMinuteAlarm(eventReadback.event.alarm, alarmUid)
    ) {
      fail('event-readback');
    }
    ownedEvent.resourceIds = [...ownedEvent.resourceIds, readbackResource.id];

    summary.failurePhase = 'alarm-options';
    const optionsQuery = new URLSearchParams({ eventId: createdResource.id });
    const { response: optionsResponse, body: optionPage } = await gatewayJson(
      fetchImpl,
      fixture,
      openIdToken,
      'GET',
      `rooms/${encodeURIComponent(fixture.teamRoomId)}/reminders/options`,
      optionsQuery,
      'alarm-options',
    );
    if (
      optionsResponse.status !== 200 ||
      !hasExactKeys(optionPage, ['options']) ||
      !Array.isArray(optionPage.options) ||
      optionPage.options.length !== 1
    ) {
      fail('alarm-options');
    }
    const option = optionPage.options[0];
    if (
      !isRecord(option) ||
      option.eventUid !== uid ||
      option.recurrenceId !== null ||
      option.alarmUid !== alarmUid ||
      option.relatedTo !== 'start' ||
      !hasExactKeys(option.trigger, [
        'weeks',
        'days',
        'hours',
        'minutes',
        'seconds',
        'isNegative',
      ]) ||
      option.trigger.weeks !== 0 ||
      option.trigger.days !== 0 ||
      option.trigger.hours !== 0 ||
      option.trigger.minutes !== 1 ||
      option.trigger.seconds !== 0 ||
      option.trigger.isNegative !== true
    ) {
      fail('alarm-options');
    }

    summary.failurePhase = 'reminder-config-write';
    const reminderRoute = `rooms/${encodeURIComponent(fixture.teamRoomId)}/reminders`;
    configIdentity = { eventUid: uid, recurrenceId: null, alarmUid };
    configWriteAttempted = true;
    const { response: configResponse, body: configResult } = await gatewayJson(
      fetchImpl,
      fixture,
      openIdToken,
      'PUT',
      reminderRoute,
      new URLSearchParams(),
      'reminder-config-write',
      {
        eventId: createdResource.id,
        recurrenceId: null,
        alarmUid,
      },
    );
    if (
      configResponse.status < 200 ||
      configResponse.status >= 300 ||
      !validConfigIdentity(configResult, uid, alarmUid)
    ) {
      fail('reminder-config-write');
    }

    summary.failurePhase = 'reminder-config-readback';
    const configItems = await readConfigPage(
      fetchImpl,
      fixture,
      openIdToken,
      'reminder-config-readback',
    );
    const configMatches = configItems.filter((item) =>
      validConfigIdentity(item, uid, alarmUid),
    );
    if (configMatches.length !== 1) fail('reminder-config-readback');

    summary.failurePhase = 'reminder-delivery';
    const allTitles = [...priorTitles, title];
    const delivery = await waitForNewDelivery(
      fetchImpl,
      fixture,
      allTitles,
      dueAt,
      now,
      sleep,
    );
    assertPriorDeliveries(delivery.snapshot, allTitles, 'reminder-delivery');
    if (!delivery.deliveredAfterDue) fail('reminder-delivery');

    summary.failurePhase = 'marker-write';
    writeMarker(markerPath, allTitles);
    summary.status = 'passed';
    summary.failurePhase = undefined;
    summary.markerWritten = true;
    summary.markerCount = allTitles.length;
  } catch (error) {
    summary.failurePhase =
      error instanceof FixtureFailure ? error.phase : 'fixture';
    if (fixture && openIdToken) {
      await cleanupOwnedResources(
        fetchImpl,
        fixture,
        openIdToken,
        ownedEvent,
        configWriteAttempted,
        configIdentity,
      );
    }
  }
  if (summary.status === 'passed') delete summary.failurePhase;
  return summary;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const result = await runLocalReminderFixture();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.status !== 'passed') process.exitCode = 1;
}
