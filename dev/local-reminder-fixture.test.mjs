import assert from 'node:assert/strict';
import {
  chmodSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  runLocalReminderFixture,
  writeMarkerTitles,
} from './local-reminder-fixture.mjs';

const MEMBER_ID = '@element-acceptance-a:localhost';
const SERVICE_ID = '@element-acceptance-bot:localhost';
const ROOM_ID = '!synthetic-team:localhost';
const MEMBER_TOKEN = 'private-member-access-token';
const SERVICE_TOKEN = 'private-service-access-token';
const OPENID_TOKEN = 'private-openid-assertion';
const ETAG = '"strong-current-etag"';
const TITLE = 'Reminder acceptance 12345678-1234-1234-1234-123456789abc';
const FOREIGN_CONFIG = {
  eventUid: 'foreign-event-uid',
  recurrenceId: null,
  alarmUid: 'foreign-alarm-uid',
};

function fixtureFiles(flow = 'initial', initialMarkers = []) {
  const runnerTemp = mkdtempSync(join(tmpdir(), 'local-reminder-fixture-'));
  const fixturePath = join(runnerTemp, 'users.json');
  const markerPath = join(runnerTemp, 'reminder-events.json');
  const fixture = {
    homeserverUrl: 'http://127.0.0.1:8008',
    gatewayUrl: 'http://127.0.0.1:3000',
    calendarId: 'element-acceptance',
    teamRoomId: ROOM_ID,
    principalMode: 'bot-account',
    users: {
      memberA: { userId: MEMBER_ID, accessToken: MEMBER_TOKEN },
      bot: { userId: SERVICE_ID, accessToken: SERVICE_TOKEN },
    },
    serviceSender: { userId: SERVICE_ID, accessToken: SERVICE_TOKEN },
  };
  writeFileSync(fixturePath, JSON.stringify(fixture), { mode: 0o600 });
  writeFileSync(markerPath, JSON.stringify(initialMarkers), { mode: 0o600 });
  chmodSync(runnerTemp, 0o700);
  return {
    environment: {
      RUNNER_TEMP: runnerTemp,
      ELEMENT_ACCEPTANCE_USERS_FILE: fixturePath,
      ELEMENT_ACCEPTANCE_REMINDER_EVENT_FILE: markerPath,
      ELEMENT_ACCEPTANCE_REMINDER_FIXTURE: '1',
      ELEMENT_ACCEPTANCE_REMINDER_FLOW: flow,
    },
    markerPath,
    runnerTemp,
    cleanup: () => rmSync(runnerTemp, { recursive: true, force: true }),
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function createClient({
  authorizationAllowed = true,
  configReadbackValid = true,
  delivered = true,
  duplicateDelivery = false,
  mentions = true,
  managerPower = 100,
  alarmMinutes = 1,
  configWriteStatus = 200,
  configDeleteStatus = 200,
  eventDeleteStatus = 200,
  eventCreateResponseLost = false,
  configWriteResponseLost = false,
  foreignEventOnReadback = false,
  contextUserId = MEMBER_ID,
  contextRoomId = ROOM_ID,
  priorTitles = [],
} = {}) {
  const calls = [];
  const configRows = [{ ...FOREIGN_CONFIG }];
  let currentTime = 1_800_000_000_000;
  let newDeliveryAdded = false;
  const timeline = priorTitles.map((title) => ({
    sender: SERVICE_ID,
    type: 'm.room.message',
    origin_server_ts: currentTime - 60_000,
    content: {
      msgtype: 'm.text',
      body: `Reminder: ${title}`,
      'm.mentions': { room: true },
    },
  }));
  let dueAt;
  let createdEvent;
  let eventPersisted = false;
  const responseEvent = () => ({
    id: `http://radicale:5232/element-acceptance-bot/element-acceptance/${createdEvent.uid}.ics`,
    uid: createdEvent.uid,
    title: createdEvent.title,
    alarm: {
      action: 'display',
      uid: 'synthetic-alarm-uid',
      trigger: {
        weeks: 0,
        days: 0,
        hours: 0,
        minutes: alarmMinutes,
        seconds: 0,
      },
    },
  });
  const fetchImpl = async (input, options = {}) => {
    const url = new URL(input);
    const method = options.method ?? 'GET';
    const headers = new Headers(options.headers);
    calls.push({ url, method, headers, body: options.body });

    if (url.pathname.endsWith('/openid/request_token')) {
      assert.equal(headers.get('authorization'), `Bearer ${MEMBER_TOKEN}`);
      assert.equal(options.body, '{}');
      return jsonResponse({
        access_token: OPENID_TOKEN,
        matrix_server_name: 'localhost',
      });
    }
    if (url.pathname.endsWith('/joined_members')) {
      assert.equal(headers.get('authorization'), `Bearer ${MEMBER_TOKEN}`);
      return jsonResponse({
        joined: { [MEMBER_ID]: {}, [SERVICE_ID]: {} },
      });
    }
    if (url.pathname.endsWith('/state/m.room.power_levels/')) {
      return jsonResponse({
        users: { [MEMBER_ID]: managerPower, [SERVICE_ID]: 50 },
        users_default: 0,
        events: { 'm.room.message': 0 },
        events_default: 100,
        state_default: 100,
        notifications: { room: 50 },
      });
    }
    if (url.pathname === '/v1/calendar/context') {
      assert.equal(headers.get('authorization')?.split(' ')[0], 'MX-Identity');
      const encoded = headers.get('authorization').slice('MX-Identity '.length);
      const identity = JSON.parse(Buffer.from(encoded, 'base64url').toString());
      assert.equal(identity.access_token, OPENID_TOKEN);
      assert.equal(identity.matrix_server_name, 'localhost');
      return jsonResponse({
        userId: contextUserId,
        roomId: contextRoomId,
        roomCalendar: {
          calendarId: 'element-acceptance',
          canReadEvents: true,
          canWriteEvents: true,
          canManageReminders: authorizationAllowed,
        },
      });
    }
    if (url.pathname === '/v1/calendar/events' && method === 'POST') {
      assert.equal(headers.get('authorization')?.split(' ')[0], 'MX-Identity');
      const query = url.searchParams;
      assert.equal(query.get('target'), 'room');
      assert.equal(query.get('roomId'), ROOM_ID);
      assert.equal(query.get('calendarId'), 'element-acceptance');
      createdEvent = JSON.parse(options.body);
      eventPersisted = true;
      dueAt = Date.parse(`${createdEvent.timing.start.local}Z`) - 60_000;
      if (eventCreateResponseLost) throw new Error('synthetic lost response');
      return jsonResponse({ event: responseEvent(), etag: ETAG }, 201);
    }
    if (url.pathname === '/v1/calendar/event') {
      const eventId = url.searchParams.get('eventId');
      if (foreignEventOnReadback) {
        return jsonResponse({
          event: {
            id: eventId,
            uid: 'foreign-event-uid',
            title: 'Foreign reminder event',
          },
          etag: '"foreign-etag"',
        });
      }
      if (!eventPersisted || eventId !== responseEvent().id) {
        return jsonResponse({ code: 'not-found' }, 404);
      }
      return jsonResponse({ event: responseEvent(), etag: ETAG });
    }
    if (url.pathname.endsWith('/reminders/options')) {
      assert.equal(url.searchParams.get('eventId'), responseEvent().id);
      return jsonResponse({
        options: [
          {
            eventUid: createdEvent.uid,
            recurrenceId: null,
            alarmUid: 'synthetic-alarm-uid',
            relatedTo: 'start',
            trigger: {
              weeks: 0,
              days: 0,
              hours: 0,
              minutes: 1,
              seconds: 0,
              isNegative: true,
            },
          },
        ],
      });
    }
    if (url.pathname.endsWith('/reminders') && method === 'PUT') {
      const config = JSON.parse(options.body);
      assert.equal(config.eventId, responseEvent().id);
      if (configWriteStatus !== 200) {
        return jsonResponse({ code: 'not-permitted' }, configWriteStatus);
      }
      configRows.push({
        eventUid: createdEvent.uid,
        recurrenceId: null,
        alarmUid: 'synthetic-alarm-uid',
      });
      if (configWriteResponseLost) throw new Error('synthetic lost response');
      return jsonResponse(configRows.at(-1));
    }
    if (url.pathname.endsWith('/reminders') && method === 'GET') {
      return jsonResponse({
        items: configReadbackValid ? configRows : [],
      });
    }
    if (url.pathname.endsWith('/reminders') && method === 'DELETE') {
      const identity = JSON.parse(options.body);
      if (configDeleteStatus !== 200) {
        return jsonResponse(
          { code: 'synthetic-delete-failure' },
          configDeleteStatus,
        );
      }
      const index = configRows.findIndex(
        (item) =>
          item.eventUid === identity.eventUid &&
          item.recurrenceId === identity.recurrenceId &&
          item.alarmUid === identity.alarmUid,
      );
      if (index !== -1) configRows.splice(index, 1);
      return jsonResponse({ deleted: true });
    }
    if (url.pathname.endsWith('/messages')) {
      if (
        delivered &&
        dueAt !== undefined &&
        currentTime >= dueAt &&
        !newDeliveryAdded
      ) {
        newDeliveryAdded = true;
        const delivery = {
          sender: SERVICE_ID,
          type: 'm.room.message',
          origin_server_ts: currentTime,
          content: {
            msgtype: 'm.text',
            body: `Reminder: ${TITLE}`,
            'm.mentions': mentions ? { room: true } : {},
          },
        };
        timeline.push(delivery);
        if (duplicateDelivery) timeline.push({ ...delivery });
      }
      return jsonResponse({ chunk: [...timeline] });
    }
    if (url.pathname === '/v1/calendar/events' && method === 'DELETE') {
      assert.equal(headers.get('if-match'), ETAG);
      assert.equal(url.searchParams.get('eventId'), responseEvent().id);
      if (eventDeleteStatus !== 200) {
        return jsonResponse(
          { code: 'synthetic-delete-failure' },
          eventDeleteStatus,
        );
      }
      eventPersisted = false;
      return jsonResponse({});
    }
    throw new Error(`Unexpected fake route ${method} ${url.pathname}`);
  };
  return {
    calls,
    fetchImpl,
    get currentTime() {
      return currentTime;
    },
    get configRows() {
      return configRows;
    },
    get eventPersisted() {
      return eventPersisted;
    },
    advance(milliseconds) {
      currentTime += milliseconds;
    },
  };
}

function execute(files, client, uuid = '12345678-1234-1234-1234-123456789abc') {
  return runLocalReminderFixture({
    environment: files.environment,
    fetchImpl: client.fetchImpl,
    now: () => client.currentTime,
    sleep: async (milliseconds) => client.advance(milliseconds),
    uuid: () => uuid,
  });
}

function executeWithMarkerWriteFailure(files, client) {
  return runLocalReminderFixture({
    environment: files.environment,
    fetchImpl: client.fetchImpl,
    now: () => client.currentTime,
    sleep: async (milliseconds) => client.advance(milliseconds),
    uuid: () => '12345678-1234-1234-1234-123456789abc',
    writeMarker: (filePath, titles) =>
      writeMarkerTitles(filePath, titles, {
        writeFile(fd, content) {
          writeFileSync(fd, content.slice(0, 5));
          throw new Error('synthetic partial marker write');
        },
      }),
  });
}

test('records a real-contract reminder only after authorization, readback, config, and due mention evidence', async () => {
  const files = fixtureFiles();
  const client = createClient();
  try {
    const result = await execute(files, client);
    assert.deepEqual(result, {
      phase: 'local-reminder-fixture',
      flow: 'initial',
      status: 'passed',
      markerWritten: true,
      markerCount: 1,
      cleanup: {
        reminderConfiguration: 'not-attempted',
        event: 'not-attempted',
      },
    });
    assert.deepEqual(JSON.parse(readFileSync(files.markerPath, 'utf8')), [
      TITLE,
    ]);
    assert.ok(
      client.calls.some(
        ({ url, method }) =>
          url.pathname.endsWith('/openid/request_token') && method === 'POST',
      ),
    );
    assert.ok(
      client.calls.some(
        ({ url, method }) =>
          url.pathname.endsWith('/reminders/options') && method === 'GET',
      ),
    );
    assert.ok(
      client.calls.some(
        ({ url, method }) =>
          url.pathname.endsWith('/reminders') && method === 'PUT',
      ),
    );
    assert.ok(
      client.calls.some(
        ({ url, method }) =>
          url.pathname.endsWith('/messages') && method === 'GET',
      ),
    );
    assert.ok(
      client.calls
        .filter(
          ({ url }) => url.hostname === '127.0.0.1' && url.port === '3000',
        )
        .every(
          ({ headers }) =>
            !headers.get('authorization')?.includes(MEMBER_TOKEN),
        ),
    );
  } finally {
    files.cleanup();
  }
});

test('refuses a non-manager before event creation and preserves the marker file', async () => {
  const files = fixtureFiles();
  const client = createClient({ managerPower: 99 });
  try {
    const result = await execute(files, client);
    assert.equal(result.status, 'failed');
    assert.equal(result.failurePhase, 'room-permissions');
    assert.equal(result.markerWritten, false);
    assert.deepEqual(JSON.parse(readFileSync(files.markerPath, 'utf8')), []);
    assert.ok(
      !client.calls.some(
        ({ url, method }) =>
          url.pathname === '/v1/calendar/events' && method === 'POST',
      ),
    );
  } finally {
    files.cleanup();
  }
});

test('rejects a different authenticated actor or room before creating an event', async (t) => {
  for (const [name, options] of [
    ['wrong actor', { contextUserId: '@different:localhost' }],
    ['wrong room', { contextRoomId: '!different:localhost' }],
    ['reminder capability denied', { authorizationAllowed: false }],
  ]) {
    await t.test(name, async () => {
      const files = fixtureFiles();
      const client = createClient(options);
      try {
        const result = await execute(files, client);
        assert.equal(result.status, 'failed');
        assert.equal(result.failurePhase, 'gateway-authorization');
        assert.equal(result.markerWritten, false);
        assert.deepEqual(result.cleanup, {
          reminderConfiguration: 'not-attempted',
          event: 'not-attempted',
        });
        assert.deepEqual(
          JSON.parse(readFileSync(files.markerPath, 'utf8')),
          [],
        );
        assert.ok(
          !client.calls.some(
            ({ url, method }) =>
              url.pathname === '/v1/calendar/events' && method === 'POST',
          ),
        );
      } finally {
        files.cleanup();
      }
    });
  }
});

test('reports config cleanup failure while independently confirming event cleanup', async () => {
  const files = fixtureFiles();
  const client = createClient({
    configWriteResponseLost: true,
    configDeleteStatus: 503,
  });
  try {
    const result = await execute(files, client);
    assert.equal(result.failurePhase, 'reminder-config-write');
    assert.deepEqual(result.cleanup, {
      reminderConfiguration: 'unresolved',
      event: 'confirmed-absent',
    });
    assert.equal(client.eventPersisted, false);
    assert.equal(client.configRows.length, 2);
    assert.ok(
      client.calls.some(
        ({ url, method }) =>
          url.pathname === '/v1/calendar/events' && method === 'DELETE',
      ),
    );
  } finally {
    files.cleanup();
  }
});

test('reports independent event and config cleanup failures without losing the original phase', async () => {
  const files = fixtureFiles();
  const client = createClient({
    configWriteResponseLost: true,
    configDeleteStatus: 503,
    eventDeleteStatus: 412,
  });
  try {
    const result = await execute(files, client);
    assert.equal(result.failurePhase, 'reminder-config-write');
    assert.deepEqual(result.cleanup, {
      reminderConfiguration: 'unresolved',
      event: 'unresolved',
    });
    assert.equal(client.eventPersisted, true);
    assert.equal(client.configRows.length, 2);
  } finally {
    files.cleanup();
  }
});

test('requires the exact room configuration to read back before writing a marker', async () => {
  const files = fixtureFiles();
  const client = createClient({ configReadbackValid: false });
  try {
    const result = await execute(files, client);
    assert.equal(result.status, 'failed');
    assert.equal(result.failurePhase, 'reminder-config-readback');
    assert.equal(result.markerWritten, false);
    assert.deepEqual(JSON.parse(readFileSync(files.markerPath, 'utf8')), []);
    assert.ok(
      client.calls.some(
        ({ url, method }) =>
          url.pathname === '/v1/calendar/events' && method === 'DELETE',
      ),
    );
  } finally {
    files.cleanup();
  }
});

test('cleans committed event and reminder writes after their responses are lost without touching foreign state', async (t) => {
  for (const [name, options, expectedPhase, expectedCleanup] of [
    [
      'event create response lost',
      { eventCreateResponseLost: true },
      'event-create',
      { reminderConfiguration: 'not-attempted', event: 'confirmed-absent' },
    ],
    [
      'configuration response lost',
      { configWriteResponseLost: true },
      'reminder-config-write',
      {
        reminderConfiguration: 'confirmed-absent',
        event: 'confirmed-absent',
      },
    ],
  ]) {
    await t.test(name, async () => {
      const files = fixtureFiles();
      const client = createClient(options);
      try {
        const result = await execute(files, client);
        assert.equal(result.status, 'failed');
        assert.equal(result.failurePhase, expectedPhase);
        assert.equal(result.markerWritten, false);
        assert.deepEqual(result.cleanup, expectedCleanup);
        assert.deepEqual(
          JSON.parse(readFileSync(files.markerPath, 'utf8')),
          [],
        );
        assert.equal(client.eventPersisted, false);
        assert.deepEqual(client.configRows, [FOREIGN_CONFIG]);
        const deletes = client.calls.filter(
          ({ method }) => method === 'DELETE',
        );
        assert.ok(
          deletes.some(
            ({ url, headers }) =>
              url.pathname === '/v1/calendar/events' &&
              headers.get('if-match') === ETAG,
          ),
        );
        assert.ok(
          deletes.every(
            ({ url, body }) =>
              url.pathname === '/v1/calendar/events' ||
              (url.pathname.endsWith('/reminders') &&
                JSON.parse(body).eventUid !== FOREIGN_CONFIG.eventUid),
          ),
        );
      } finally {
        files.cleanup();
      }
    });
  }
});

test('does not delete an event when ambiguous create cleanup readback identifies a foreign object', async () => {
  const files = fixtureFiles();
  const client = createClient({
    eventCreateResponseLost: true,
    foreignEventOnReadback: true,
  });
  try {
    const result = await execute(files, client);
    assert.equal(result.status, 'failed');
    assert.equal(result.failurePhase, 'event-create');
    assert.equal(result.markerWritten, false);
    assert.deepEqual(result.cleanup, {
      reminderConfiguration: 'not-attempted',
      event: 'unresolved',
    });
    assert.equal(client.eventPersisted, true);
    assert.ok(
      !client.calls.some(
        ({ url, method }) =>
          url.pathname === '/v1/calendar/events' && method === 'DELETE',
      ),
    );
    assert.deepEqual(JSON.parse(readFileSync(files.markerPath, 'utf8')), []);
  } finally {
    files.cleanup();
  }
});

test('rejects events without the supported relative alarm or reminder writes denied by the gateway', async (t) => {
  for (const [name, options, expectedPhase] of [
    ['missing relative alarm', { alarmMinutes: 0 }, 'event-create'],
    [
      'unauthorized reminder write',
      { configWriteStatus: 403 },
      'reminder-config-write',
    ],
  ]) {
    await t.test(name, async () => {
      const files = fixtureFiles();
      const client = createClient(options);
      try {
        const result = await execute(files, client);
        assert.equal(result.status, 'failed');
        assert.equal(result.failurePhase, expectedPhase);
        assert.equal(result.markerWritten, false);
        assert.deepEqual(
          JSON.parse(readFileSync(files.markerPath, 'utf8')),
          [],
        );
      } finally {
        files.cleanup();
      }
    });
  }
});

test('keeps prior exact-once room markers while appending the restart canary', async () => {
  const priorTitle = 'Reminder acceptance aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const files = fixtureFiles('restart', [priorTitle]);
  const client = createClient({ priorTitles: [priorTitle] });
  try {
    const result = await execute(files, client);
    assert.equal(result.status, 'passed');
    assert.equal(result.markerCount, 2);
    assert.deepEqual(JSON.parse(readFileSync(files.markerPath, 'utf8')), [
      priorTitle,
      TITLE,
    ]);
  } finally {
    files.cleanup();
  }
});

test('preserves old markers and removes only its partial sibling when marker writing fails', async () => {
  const priorTitle = 'Reminder acceptance aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const files = fixtureFiles('restart', [priorTitle]);
  const client = createClient({ priorTitles: [priorTitle] });
  try {
    const result = await executeWithMarkerWriteFailure(files, client);
    assert.equal(result.status, 'failed');
    assert.equal(result.failurePhase, 'marker-write');
    assert.equal(result.markerWritten, false);
    assert.deepEqual(JSON.parse(readFileSync(files.markerPath, 'utf8')), [
      priorTitle,
    ]);
    assert.ok(
      !readdirSync(files.runnerTemp).some((name) => name.endsWith('.tmp')),
    );
  } finally {
    files.cleanup();
  }
});

test('does not write the success marker for missing mentions or duplicate deliveries and cleans only its ETag-owned event', async (t) => {
  for (const [name, options] of [
    ['no due timeline delivery', { delivered: false }],
    ['missing standard room mention', { mentions: false }],
    ['duplicate timeline delivery', { duplicateDelivery: true }],
  ]) {
    await t.test(name, async () => {
      const files = fixtureFiles();
      const client = createClient(options);
      try {
        const result = await execute(files, client);
        assert.equal(result.status, 'failed');
        assert.equal(result.failurePhase, 'reminder-delivery');
        assert.equal(result.markerWritten, false);
        assert.deepEqual(
          JSON.parse(readFileSync(files.markerPath, 'utf8')),
          [],
        );
        assert.ok(
          client.calls.some(
            ({ url, method, headers }) =>
              url.pathname === '/v1/calendar/events' &&
              method === 'DELETE' &&
              headers.get('if-match') === ETAG,
          ),
        );
      } finally {
        files.cleanup();
      }
    });
  }
});

test('rejects malformed marker state and remains default-off without contacting services', async () => {
  const malformed = fixtureFiles('restart', ['not-a-reminder-marker']);
  const malformedClient = createClient();
  try {
    const result = await execute(malformed, malformedClient);
    assert.equal(result.status, 'failed');
    assert.equal(result.failurePhase, 'fixture');
    assert.equal(malformedClient.calls.length, 0);
  } finally {
    malformed.cleanup();
  }

  const disabled = fixtureFiles();
  disabled.environment.ELEMENT_ACCEPTANCE_REMINDER_FIXTURE = '0';
  const disabledClient = createClient();
  try {
    const result = await execute(disabled, disabledClient);
    assert.equal(result.status, 'failed');
    assert.equal(result.failurePhase, 'fixture');
    assert.equal(disabledClient.calls.length, 0);
    assert.deepEqual(JSON.parse(readFileSync(disabled.markerPath, 'utf8')), []);
  } finally {
    disabled.cleanup();
  }
});
