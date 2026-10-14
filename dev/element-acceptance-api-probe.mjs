import { randomUUID } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';

const EXPECTED = {
  homeserverUrl: 'http://127.0.0.1:8008',
  gatewayUrl: 'http://127.0.0.1:3000',
  radicaleUrl: 'http://127.0.0.1:5232/',
  calendarId: 'element-acceptance',
};
const STAGE_NAMES = [
  'fixture',
  'member-openid',
  'outsider-openid',
  'outsider-denied',
  'event-create',
  'canonical-readback',
  'stale-etag-conflict',
  'event-update',
  'updated-readback',
  'event-delete',
  'delete-readback',
  'owned-cleanup',
];

class ProbeFailure extends Error {
  constructor(stage, code) {
    super('Synthetic API probe failed');
    this.stage = stage;
    this.code = code;
  }
}

function fail(stage, code) {
  throw new ProbeFailure(stage, code);
}

function safeCredential(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 4096;
}

function validateFixture(fixture) {
  if (
    fixture?.homeserverUrl !== EXPECTED.homeserverUrl ||
    fixture?.gatewayUrl !== EXPECTED.gatewayUrl ||
    fixture?.calendarId !== EXPECTED.calendarId ||
    fixture?.principalMode !== 'bot-account' ||
    typeof fixture?.teamRoomId !== 'string' ||
    !/^![A-Za-z0-9._=-]{1,255}:localhost$/u.test(fixture.teamRoomId) ||
    typeof fixture?.outsiderRoomId !== 'string' ||
    !/^![A-Za-z0-9._=-]{1,255}:localhost$/u.test(fixture.outsiderRoomId) ||
    fixture.outsiderRoomId === fixture.teamRoomId
  ) {
    fail('fixture', 'fixture-out-of-scope');
  }
  for (const actorName of ['memberA', 'outsider', 'bot']) {
    const actor = fixture.users?.[actorName];
    if (
      !actor ||
      typeof actor.userId !== 'string' ||
      !/^@[a-z0-9][a-z0-9-]{0,254}:localhost$/u.test(actor.userId) ||
      !safeCredential(actor.accessToken)
    ) {
      fail('fixture', 'fixture-invalid');
    }
  }
  if (
    fixture.serviceSender?.userId !== fixture.users.bot.userId ||
    fixture.serviceSender?.accessToken !== fixture.users.bot.accessToken
  ) {
    fail('fixture', 'fixture-invalid');
  }
}

function readFixturePath(environment) {
  const runnerTemp = environment.RUNNER_TEMP;
  const fixturePath = environment.ELEMENT_ACCEPTANCE_USERS_FILE;
  if (typeof runnerTemp !== 'string' || typeof fixturePath !== 'string') {
    fail('fixture', 'fixture-unavailable');
  }
  const root = `${resolve(runnerTemp)}${sep}`;
  if (!resolve(fixturePath).startsWith(root)) {
    fail('fixture', 'fixture-out-of-scope');
  }
  try {
    const fixtureStat = lstatSync(fixturePath);
    if (!fixtureStat.isFile() || (fixtureStat.mode & 0o077) !== 0) {
      fail('fixture', 'fixture-not-private');
    }
    return JSON.parse(readFileSync(fixturePath, 'utf8'));
  } catch (error) {
    if (error instanceof ProbeFailure) throw error;
    fail('fixture', 'fixture-unavailable');
  }
}

function matrixIdentityHeader(openIdToken) {
  return `MX-Identity ${Buffer.from(
    JSON.stringify({
      access_token: openIdToken,
      matrix_server_name: 'localhost',
    }),
  ).toString('base64url')}`;
}

async function requestJson(fetchImpl, url, options, stage) {
  let response;
  try {
    response = await fetchImpl(url, {
      ...options,
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    fail(stage, 'network-failed');
  }
  let body;
  try {
    body = await response.json();
  } catch {
    fail(stage, 'response-invalid');
  }
  return { response, body };
}

async function openId(fetchImpl, fixture, actor, stage) {
  const url = new URL(
    `/_matrix/client/v3/user/${encodeURIComponent(actor.userId)}/openid/request_token`,
    fixture.homeserverUrl,
  );
  const { response, body } = await requestJson(
    fetchImpl,
    url,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${actor.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    },
    stage,
  );
  if (
    response.status !== 200 ||
    !safeCredential(body?.access_token) ||
    body?.matrix_server_name !== 'localhost'
  ) {
    fail(stage, 'openid-rejected');
  }
  return body.access_token;
}

function roomQuery(fixture, extra = {}) {
  const query = new URLSearchParams({
    target: 'room',
    roomId: fixture.teamRoomId,
    calendarId: fixture.calendarId,
    ...extra,
  });
  return query;
}

function eventUrlFromDto(value, expectedUid) {
  const event = value?.event;
  if (
    !event ||
    event.uid !== expectedUid ||
    typeof event.id !== 'string' ||
    typeof value.etag !== 'string' ||
    !/^"[\x21\x23-\x7e]{1,200}"$/u.test(value.etag)
  ) {
    return undefined;
  }
  let eventUrl;
  try {
    eventUrl = new URL(event.id);
  } catch {
    return undefined;
  }
  if (
    eventUrl.protocol !== 'http:' ||
    !['radicale:5232', '127.0.0.1:5232'].includes(eventUrl.host) ||
    eventUrl.username ||
    eventUrl.password ||
    eventUrl.search ||
    eventUrl.hash ||
    !eventUrl.pathname.endsWith(`/${encodeURIComponent(expectedUid)}.ics`)
  ) {
    return undefined;
  }
  return { id: eventUrl.toString(), etag: value.etag, event };
}

async function gatewayRequest(
  fetchImpl,
  fixture,
  token,
  method,
  query,
  stage,
  body,
  etag,
  route = 'events',
) {
  const url = new URL(`/v1/calendar/${route}?${query}`, fixture.gatewayUrl);
  let response;
  try {
    response = await fetchImpl(url, {
      method,
      headers: {
        Authorization: matrixIdentityHeader(token),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(etag === undefined ? {} : { 'If-Match': etag }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    fail(stage, 'network-failed');
  }
  return response;
}

function directCalDavAuthorization(fixture, token) {
  const localpart = fixture.users.bot.userId.slice(1).split(':')[0];
  const delegated = `matrix-openid:${Buffer.from(
    JSON.stringify({ access_token: token, matrix_server_name: 'localhost' }),
  ).toString('base64url')}`;
  return `Basic ${Buffer.from(`${localpart}:${delegated}`).toString('base64')}`;
}

function assertCalDavUrlFromGateway(fixture, resourceId, uid) {
  const value = new URL(resourceId);
  const localpart = fixture.users.bot.userId.slice(1).split(':')[0];
  const expectedPath = `/${encodeURIComponent(localpart)}/${EXPECTED.calendarId}/${encodeURIComponent(uid)}.ics`;
  if (
    value.protocol !== 'http:' ||
    !['radicale:5232', '127.0.0.1:5232'].includes(value.host) ||
    value.pathname !== expectedPath
  ) {
    fail('canonical-readback', 'resource-out-of-scope');
  }
  return new URL(value.pathname, EXPECTED.radicaleUrl);
}

async function directRead(
  fetchImpl,
  url,
  authorization,
  stage,
  expectedUid,
  expectedTitle,
) {
  let response;
  try {
    response = await fetchImpl(url, {
      headers: { Authorization: authorization },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    fail(stage, 'network-failed');
  }
  if (response.status !== 200) fail(stage, 'canonical-read-failed');
  let icalendar;
  try {
    icalendar = await response.text();
  } catch {
    fail(stage, 'response-invalid');
  }
  if (
    !icalendar.includes(`UID:${expectedUid}`) ||
    !icalendar.includes(`SUMMARY:${expectedTitle}`)
  ) {
    fail(stage, 'canonical-content-mismatch');
  }
}

async function directStatus(fetchImpl, url, authorization, stage) {
  let response;
  try {
    response = await fetchImpl(url, {
      headers: { Authorization: authorization },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    fail(stage, 'network-failed');
  }
  const status = response.status;
  await response.body?.cancel().catch(() => undefined);
  return status;
}

export async function runElementAcceptanceApiProbe({
  fixture,
  fetchImpl = fetch,
  uuid = randomUUID,
}) {
  const stages = Object.fromEntries(
    STAGE_NAMES.map((name) => [name, 'skipped']),
  );
  let ownedEvent;
  let currentEtag;
  let memberToken;
  let serviceToken;
  let failed;
  const mark = (stage) => {
    stages[stage] = 'passed';
  };
  try {
    validateFixture(fixture);
    mark('fixture');
    memberToken = await openId(
      fetchImpl,
      fixture,
      fixture.users.memberA,
      'member-openid',
    );
    mark('member-openid');
    const outsiderToken = await openId(
      fetchImpl,
      fixture,
      fixture.users.outsider,
      'outsider-openid',
    );
    mark('outsider-openid');
    serviceToken = await openId(
      fetchImpl,
      fixture,
      fixture.users.bot,
      'canonical-readback',
    );

    const outsiderQuery = roomQuery(fixture, {
      start: new Date(Date.now()).toISOString(),
      end: new Date(Date.now() + 86_400_000).toISOString(),
      timezone: 'UTC',
    });
    const outsiderResponse = await gatewayRequest(
      fetchImpl,
      fixture,
      outsiderToken,
      'GET',
      outsiderQuery,
      'outsider-denied',
    );
    if (outsiderResponse.status !== 403)
      fail(
        'outsider-denied',
        outsiderResponse.status === 404 ? 'wrong-denial' : 'not-denied',
      );
    await outsiderResponse.body?.cancel().catch(() => undefined);
    mark('outsider-denied');

    const uid = `local-api-probe-${uuid()}`;
    const start = new Date(Date.now() + 5 * 60_000);
    const end = new Date(start.getTime() + 30 * 60_000);
    const title = `Synthetic API probe ${uuid()}`;
    const input = {
      uid,
      title,
      timing: {
        type: 'timed',
        start: {
          type: 'zoned',
          local: start.toISOString().slice(0, 19),
          timezone: 'UTC',
        },
        end: {
          type: 'zoned',
          local: end.toISOString().slice(0, 19),
          timezone: 'UTC',
        },
      },
    };
    const botLocalpart = fixture.users.bot.userId.slice(1).split(':')[0];
    ownedEvent = {
      id: `http://radicale:5232/${encodeURIComponent(botLocalpart)}/${EXPECTED.calendarId}/${encodeURIComponent(uid)}.ics`,
      uid,
      title,
    };
    const createResponse = await gatewayRequest(
      fetchImpl,
      fixture,
      memberToken,
      'POST',
      roomQuery(fixture),
      'event-create',
      input,
    );
    if (createResponse.status !== 201 && createResponse.status !== 200)
      fail('event-create', 'gateway-rejected');
    let created;
    try {
      created = eventUrlFromDto(await createResponse.json(), uid);
    } catch {
      fail('event-create', 'response-invalid');
    }
    if (!created || created.id !== ownedEvent.id)
      fail('event-create', 'created-resource-unverified');
    currentEtag = created.etag;
    mark('event-create');

    const canonicalUrl = assertCalDavUrlFromGateway(
      fixture,
      ownedEvent.id,
      uid,
    );
    const serviceAuthorization = directCalDavAuthorization(
      fixture,
      serviceToken,
    );
    await directRead(
      fetchImpl,
      canonicalUrl,
      serviceAuthorization,
      'canonical-readback',
      uid,
      title,
    );
    mark('canonical-readback');

    const queryWithId = roomQuery(fixture, { eventId: ownedEvent.id });
    const stale = await gatewayRequest(
      fetchImpl,
      fixture,
      memberToken,
      'PATCH',
      queryWithId,
      'stale-etag-conflict',
      { title: `${title} stale` },
      '"stale-probe-etag"',
    );
    if (stale.status !== 409)
      fail('stale-etag-conflict', 'conflict-not-enforced');
    await stale.body?.cancel().catch(() => undefined);
    mark('stale-etag-conflict');

    const update = await gatewayRequest(
      fetchImpl,
      fixture,
      memberToken,
      'PATCH',
      queryWithId,
      'event-update',
      { title: `${title} updated` },
      currentEtag,
    );
    if (update.status !== 200) fail('event-update', 'gateway-rejected');
    let updated;
    try {
      updated = eventUrlFromDto(await update.json(), uid);
    } catch {
      fail('event-update', 'response-invalid');
    }
    if (!updated || updated.event.title !== `${title} updated`)
      fail('event-update', 'updated-resource-unverified');
    ownedEvent = { ...ownedEvent, ...updated, title: `${title} updated` };
    currentEtag = updated.etag;
    mark('event-update');

    const latestResponse = await gatewayRequest(
      fetchImpl,
      fixture,
      memberToken,
      'GET',
      queryWithId,
      'updated-readback',
      undefined,
      undefined,
      'event',
    );
    if (latestResponse.status !== 200)
      fail('updated-readback', 'gateway-rejected');
    let latest;
    try {
      latest = eventUrlFromDto(await latestResponse.json(), uid);
    } catch {
      fail('updated-readback', 'response-invalid');
    }
    if (!latest || latest.event.title !== `${title} updated`)
      fail('updated-readback', 'updated-resource-unverified');
    await directRead(
      fetchImpl,
      canonicalUrl,
      serviceAuthorization,
      'updated-readback',
      uid,
      `${title} updated`,
    );
    mark('updated-readback');

    const remove = await gatewayRequest(
      fetchImpl,
      fixture,
      memberToken,
      'DELETE',
      queryWithId,
      'event-delete',
      undefined,
      currentEtag,
    );
    if (remove.status !== 200 && remove.status !== 204)
      fail('event-delete', 'gateway-rejected');
    ownedEvent = undefined;
    currentEtag = undefined;
    mark('event-delete');

    const gatewayDeleteReadback = await gatewayRequest(
      fetchImpl,
      fixture,
      memberToken,
      'GET',
      queryWithId,
      'delete-readback',
      undefined,
      undefined,
      'event',
    );
    if (gatewayDeleteReadback.status !== 404)
      fail('delete-readback', 'gateway-delete-unverified');
    await gatewayDeleteReadback.body?.cancel().catch(() => undefined);
    if (
      (await directStatus(
        fetchImpl,
        canonicalUrl,
        serviceAuthorization,
        'delete-readback',
      )) !== 404
    ) {
      fail('delete-readback', 'canonical-delete-unverified');
    }
    mark('delete-readback');
  } catch (error) {
    failed =
      error instanceof ProbeFailure
        ? error
        : new ProbeFailure('fixture', 'probe-failed');
    stages[failed.stage] = 'failed';
  } finally {
    if (ownedEvent && memberToken) {
      try {
        const query = roomQuery(fixture, { eventId: ownedEvent.id });
        const latest = await gatewayRequest(
          fetchImpl,
          fixture,
          memberToken,
          'GET',
          query,
          'owned-cleanup',
          undefined,
          undefined,
          'event',
        );
        if (latest.status === 404) {
          ownedEvent = undefined;
          mark('owned-cleanup');
        } else {
          if (latest.status !== 200)
            fail('owned-cleanup', 'cleanup-read-failed');
          let current;
          try {
            current = eventUrlFromDto(await latest.json(), ownedEvent.uid);
          } catch {
            fail('owned-cleanup', 'cleanup-read-failed');
          }
          if (!current || current.id !== ownedEvent.id)
            fail('owned-cleanup', 'cleanup-resource-unverified');
          const cleanup = await gatewayRequest(
            fetchImpl,
            fixture,
            memberToken,
            'DELETE',
            query,
            'owned-cleanup',
            undefined,
            current.etag,
          );
          if (
            cleanup.status === 200 ||
            cleanup.status === 204 ||
            cleanup.status === 404
          ) {
            ownedEvent = undefined;
            mark('owned-cleanup');
          } else {
            await cleanup.body?.cancel().catch(() => undefined);
            stages['owned-cleanup'] = 'failed';
          }
        }
      } catch {
        stages['owned-cleanup'] = 'failed';
      }
    } else if (!ownedEvent) {
      mark('owned-cleanup');
    }
  }
  return {
    status:
      failed || Object.values(stages).includes('failed') ? 'failed' : 'passed',
    stages,
    ...(failed ? { failureCode: failed.code } : {}),
  };
}

async function main() {
  let summary;
  try {
    const fixture = readFixturePath(process.env);
    summary = await runElementAcceptanceApiProbe({ fixture });
  } catch (error) {
    const failure =
      error instanceof ProbeFailure
        ? error
        : new ProbeFailure('fixture', 'probe-failed');
    summary = {
      status: 'failed',
      stages: Object.fromEntries(
        STAGE_NAMES.map((name) => [
          name,
          name === failure.stage ? 'failed' : 'skipped',
        ]),
      ),
      failureCode: failure.code,
    };
  }
  process.stdout.write(`${JSON.stringify(summary)}\n`);
  if (summary.status !== 'passed') process.exitCode = 1;
}

if (import.meta.url === `file://${resolve(process.argv[1] ?? '')}`) {
  await main();
}
