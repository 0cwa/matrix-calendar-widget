import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test, { after, before } from 'node:test';
import { runElementAcceptanceApiProbe } from './element-acceptance-api-probe.mjs';

const fixture = {
  homeserverUrl: 'http://127.0.0.1:8008',
  gatewayUrl: 'http://127.0.0.1:3000',
  widgetUrl: 'http://127.0.0.1:8080',
  calendarId: 'element-acceptance',
  principalMode: 'bot-account',
  teamRoomId: '!synthetic-team:localhost',
  outsiderRoomId: '!synthetic-outsider:localhost',
  users: {
    memberA: { userId: '@member-a:localhost', accessToken: 'member-secret' },
    outsider: { userId: '@outsider:localhost', accessToken: 'outsider-secret' },
    bot: {
      userId: '@element-acceptance-bot:localhost',
      accessToken: 'bot-secret',
    },
  },
  serviceSender: {
    userId: '@element-acceptance-bot:localhost',
    accessToken: 'bot-secret',
  },
};

let server;
let state;
let fakeOrigin;

function json(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
}

function readRequest(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function eventDto(record) {
  return {
    event: { id: record.id, uid: record.uid, title: record.title },
    etag: record.etag,
  };
}

async function handler(request, response) {
  const url = new URL(request.url, 'http://127.0.0.1');
  if (url.pathname.includes('/openid/request_token')) {
    const who = Object.entries(fixture.users).find(
      ([, actor]) =>
        request.headers.authorization === `Bearer ${actor.accessToken}`,
    )?.[0];
    if (!who) return json(response, 401, { detail: 'hidden-token-value' });
    return json(response, 200, {
      access_token: `openid-${who}-secret`,
      matrix_server_name: 'localhost',
    });
  }
  if (url.pathname.startsWith('/v1/calendar/')) {
    const authorization = request.headers.authorization ?? '';
    let identity;
    try {
      const encoded = authorization.slice('MX-Identity '.length);
      identity = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    } catch {
      return json(response, 401, { detail: 'sensitive response body' });
    }
    const user = Object.entries(fixture.users).find(
      ([name]) => identity.access_token === `openid-${name}-secret`,
    )?.[0];
    if (!user)
      return json(response, 401, { detail: 'sensitive response body' });
    if (url.searchParams.get('roomId') !== fixture.teamRoomId) {
      return json(response, 404, {});
    }
    if (user === 'outsider') {
      return json(response, state.outsiderStatus, {
        detail: 'secret denial body',
      });
    }
    if (user !== 'memberA') return json(response, 403, {});

    const method = request.method;
    if (method === 'POST') {
      const body = JSON.parse(await readRequest(request));
      state.createCount += 1;
      const record = {
        uid: body.uid,
        title: body.title,
        id: `http://radicale:5232/element-acceptance-bot/element-acceptance/${encodeURIComponent(body.uid)}.ics`,
        etag: '"probe-1"',
      };
      state.events.set(record.uid, record);
      return json(response, 201, eventDto(record));
    }

    const eventId = url.searchParams.get('eventId');
    const uid = eventId
      ?.split('/')
      .at(-1)
      ?.replace(/\.ics$/u, '');
    const record = state.events.get(decodeURIComponent(uid ?? ''));
    if (method === 'GET') {
      if (!record) return json(response, 404, {});
      return json(response, 200, eventDto(record));
    }
    if (method === 'PATCH') {
      const body = JSON.parse(await readRequest(request));
      if (
        state.disableConflict &&
        request.headers['if-match'] !== record?.etag
      ) {
        record.title = body.title;
        record.etag = '"probe-bad-update"';
        return json(response, 200, eventDto(record));
      }
      if (!record || request.headers['if-match'] !== record.etag) {
        return json(response, 409, { detail: 'secret conflict body' });
      }
      if (state.updateCount > 0) return json(response, 409, {});
      state.updateCount += 1;
      record.title = body.title;
      record.etag = '"probe-2"';
      return json(response, 200, eventDto(record));
    }
    if (method === 'DELETE') {
      state.deletes.push(eventId);
      if (!record) return json(response, 404, {});
      if (request.headers['if-match'] !== record.etag)
        return json(response, 409, {});
      state.events.delete(record.uid);
      response.writeHead(204);
      return response.end();
    }
  }
  if (url.pathname.endsWith('.ics')) {
    if (state.failCanonicalRead) {
      state.failCanonicalRead = false;
      return json(response, 503, { detail: 'sensitive canonical body' });
    }
    const uid = decodeURIComponent(
      url.pathname
        .split('/')
        .at(-1)
        .replace(/\.ics$/u, ''),
    );
    const record = state.events.get(uid);
    if (!record) {
      response.writeHead(404);
      return response.end('not found');
    }
    response.writeHead(200, { 'content-type': 'text/calendar' });
    return response.end(
      `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:${record.uid}\r\nSUMMARY:${record.title}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`,
    );
  }
  json(response, 404, { detail: 'unmatched-secret' });
}

before(async () => {
  state = {
    events: new Map(),
    deletes: [],
    createCount: 0,
    updateCount: 0,
    outsiderStatus: 403,
    disableConflict: false,
    failCanonicalRead: false,
  };
  server = createServer((request, response) => {
    void handler(request, response).catch(() =>
      json(response, 500, { detail: 'unmatched-secret' }),
    );
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  fakeOrigin = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

function resetState() {
  state.events.clear();
  state.deletes.length = 0;
  state.createCount = 0;
  state.updateCount = 0;
  state.outsiderStatus = 403;
  state.disableConflict = false;
  state.failCanonicalRead = false;
}

function fakeFetch(input, init) {
  const target = new URL(String(input));
  return fetch(new URL(`${target.pathname}${target.search}`, fakeOrigin), init);
}

test('probes authorized gateway CRUD, ETag conflict, and canonical CalDAV readback', async () => {
  resetState();
  const summary = await runElementAcceptanceApiProbe({
    fixture,
    fetchImpl: fakeFetch,
  });
  assert.equal(summary.status, 'passed');
  assert.ok(Object.values(summary.stages).every((stage) => stage === 'passed'));
  assert.equal(state.createCount, 1);
  assert.equal(state.events.size, 0);
  assert.equal(state.deletes.length, 1);
});

test('fails closed when outsider access is not denied, without exposing response data', async () => {
  resetState();
  state.outsiderStatus = 200;
  const summary = await runElementAcceptanceApiProbe({
    fixture,
    fetchImpl: fakeFetch,
  });
  assert.equal(summary.status, 'failed');
  assert.equal(summary.failureCode, 'not-denied');
  assert.equal(summary.stages['outsider-denied'], 'failed');
  assert.equal(state.createCount, 0);
  assert.doesNotMatch(JSON.stringify(summary), /secret|sensitive/u);
});

test('detects missing stale-ETag protection and cleans only its created event', async () => {
  resetState();
  state.disableConflict = true;
  const summary = await runElementAcceptanceApiProbe({
    fixture,
    fetchImpl: fakeFetch,
  });
  assert.equal(summary.status, 'failed');
  assert.equal(summary.failureCode, 'conflict-not-enforced');
  assert.equal(summary.stages['owned-cleanup'], 'passed');
  assert.equal(state.events.size, 0);
  assert.equal(state.deletes.length, 1);
  assert.match(state.deletes[0], /local-api-probe-[0-9a-f-]+\.ics$/u);
  assert.doesNotMatch(JSON.stringify(summary), /secret|sensitive|probe-/u);
});

test('keeps canonical-service failure bounded and removes the captured event', async () => {
  resetState();
  state.failCanonicalRead = true;
  const summary = await runElementAcceptanceApiProbe({
    fixture,
    fetchImpl: fakeFetch,
  });
  assert.equal(summary.status, 'failed');
  assert.equal(summary.stages['canonical-readback'], 'failed');
  assert.equal(summary.stages['owned-cleanup'], 'passed');
  assert.equal(state.events.size, 0);
  assert.equal(state.deletes.length, 1);
  assert.doesNotMatch(
    JSON.stringify(summary),
    /secret|sensitive|Synthetic API/u,
  );
});
