import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildOrdinaryPerformanceEvents,
  buildPerformanceEvents,
  calendarCollectionUrl,
  cleanupPerformanceManifestEvents,
  createPerformanceManifestEvent,
  isSafePerformanceManifest,
  next31DayMonth,
  next31DayMonthAfter,
  raceCalendarReadyOrIdentityPrompt,
  requestPerformanceOpenIdCredential,
  resolvePerformancePrincipal,
} from './element-acceptance-performance.mjs';

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

test('performance OpenID keeps the legacy appservice principal and body', () => {
  const principal = resolvePerformancePrincipal(
    {
      principalMode: 'appservice',
      serviceSender: {
        userId: '@_matrix_calendar_service:localhost',
        accessToken: 'synthetic-service-user-token',
      },
    },
    'appservice',
    'synthetic-as-token',
  );

  assert.deepEqual(principal, {
    mode: 'appservice',
    userId: '@_matrix_calendar_service:localhost',
    localpart: '_matrix_calendar_service',
    accessToken: 'synthetic-service-user-token',
    openIdBody: { user_id: '@_matrix_calendar_service:localhost' },
  });
});

test('performance OpenID uses the selected bot token, identity, and empty body', () => {
  const bot = {
    userId: '@element-acceptance-bot:localhost',
    accessToken: 'synthetic-bot-access-token',
  };
  const principal = resolvePerformancePrincipal(
    {
      principalMode: 'bot-account',
      users: { bot },
      serviceSender: { ...bot },
    },
    'bot-account',
    undefined,
  );

  assert.deepEqual(principal, {
    mode: 'bot-account',
    userId: bot.userId,
    localpart: 'element-acceptance-bot',
    accessToken: bot.accessToken,
    openIdBody: {},
  });
  assert.equal(Object.hasOwn(principal.openIdBody, 'user_id'), false);
});

test('performance OpenID requests post the selected identity without query parameters', async () => {
  const appservicePrincipal = resolvePerformancePrincipal(
    {
      principalMode: 'appservice',
      serviceSender: {
        userId: '@_matrix_calendar_service:localhost',
        accessToken: 'synthetic-service-user-token',
      },
    },
    'appservice',
    'synthetic-as-token',
  );
  const bot = {
    userId: '@element-acceptance-bot:localhost',
    accessToken: 'synthetic-bot-access-token',
  };
  const botPrincipal = resolvePerformancePrincipal(
    {
      principalMode: 'bot-account',
      users: { bot },
      serviceSender: { ...bot },
    },
    'bot-account',
    undefined,
  );
  const originalFetch = globalThis.fetch;

  try {
    for (const [principal, expectedBody] of [
      [appservicePrincipal, { user_id: '@_matrix_calendar_service:localhost' }],
      [botPrincipal, {}],
    ]) {
      let request;
      globalThis.fetch = async (url, init) => {
        request = { url: new URL(url), init };
        return Response.json({
          access_token: 'synthetic-openid-proof-token',
          matrix_server_name: 'localhost',
        });
      };

      const proof = await requestPerformanceOpenIdCredential(principal);
      assert.equal(proof.matrixServerName, 'localhost');
      assert.equal(
        request.url.pathname,
        `/_matrix/client/v3/user/${encodeURIComponent(principal.userId)}/openid/request_token`,
      );
      assert.equal(request.url.search, '');
      assert.equal(request.init.method, 'POST');
      assert.equal(
        request.init.headers.Authorization,
        `Bearer ${principal.accessToken}`,
      );
      assert.equal(request.init.headers['Content-Type'], 'application/json');
      assert.equal(request.init.body, JSON.stringify(expectedBody));
      if (principal.mode === 'bot-account') {
        assert.equal(
          Object.hasOwn(JSON.parse(request.init.body), 'user_id'),
          false,
        );
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('performance CalDAV uses the selected sender localpart', () => {
  assert.equal(
    calendarCollectionUrl('element-acceptance-bot'),
    'http://127.0.0.1:5232/element-acceptance-bot/element-acceptance/',
  );
  assert.equal(
    calendarCollectionUrl('_matrix_calendar_service'),
    'http://127.0.0.1:5232/_matrix_calendar_service/element-acceptance/',
  );
});

test('performance OpenID rejects mode, identity, token, and AS credential mismatches', () => {
  const bot = {
    userId: '@element-acceptance-bot:localhost',
    accessToken: 'synthetic-bot-access-token',
  };
  const fixture = {
    principalMode: 'bot-account',
    users: { bot },
    serviceSender: { ...bot },
  };

  assert.equal(resolvePerformancePrincipal(fixture, 'appservice'), undefined);
  assert.equal(
    resolvePerformancePrincipal(fixture, 'bot-account', 'unexpected-as-token'),
    undefined,
  );
  assert.equal(
    resolvePerformancePrincipal(
      { ...fixture, serviceSender: { ...bot, userId: '@other:localhost' } },
      'bot-account',
      undefined,
    ),
    undefined,
  );
  assert.equal(
    resolvePerformancePrincipal(
      {
        ...fixture,
        serviceSender: { ...bot, accessToken: 'different-bot-access-token' },
      },
      'bot-account',
      undefined,
    ),
    undefined,
  );
});

test('chooses a future 31-day local calendar month', () => {
  assert.deepEqual(next31DayMonth(new Date('2026-10-07T12:00:00.000Z')), {
    year: 2026,
    month: 12,
  });
  assert.deepEqual(next31DayMonth(new Date('2026-12-01T00:00:00.000Z')), {
    year: 2026,
    month: 12,
  });
});

test('a disabled visible Create placeholder does not suppress identity approval', async () => {
  const createControl = { visible: true, enabled: false };
  const calendarEnabled = deferred();
  const identityVisible = deferred();
  const readiness = raceCalendarReadyOrIdentityPrompt(
    () => {
      assert.equal(createControl.visible, true);
      return createControl.enabled
        ? Promise.resolve()
        : calendarEnabled.promise;
    },
    () => identityVisible.promise,
  );

  assert.deepEqual(createControl, { visible: true, enabled: false });
  identityVisible.resolve();
  assert.equal(await readiness, true);
});

test('calendar readiness wins only after the enabled-control wait resolves', async () => {
  const createControl = { enabled: false };
  const calendarEnabled = deferred();
  const readiness = raceCalendarReadyOrIdentityPrompt(
    () => (createControl.enabled ? Promise.resolve() : calendarEnabled.promise),
    () => new Promise(() => {}),
  );

  createControl.enabled = true;
  calendarEnabled.resolve();
  assert.equal(await readiness, false);
});

test('chooses a distinct following 31-day month for the empty visible range', () => {
  assert.deepEqual(next31DayMonthAfter(2026, 12), { year: 2027, month: 1 });
  assert.deepEqual(next31DayMonthAfter(2027, 1), { year: 2027, month: 3 });
  assert.throws(() => next31DayMonthAfter(2026, 11));
});

test('builds exactly 250 unique timed events within all 31 dates', () => {
  const events = buildPerformanceEvents(2026, 12, '12345', '2');
  assert.equal(events.length, 250);
  assert.equal(new Set(events.map(({ uid }) => uid)).size, 250);
  assert.equal(new Set(events.map(({ title }) => title)).size, 250);
  assert.deepEqual(
    Array.from(
      { length: 31 },
      (_, dayIndex) => events.filter(({ day }) => day === dayIndex + 1).length,
    ),
    [9, 9, ...Array(29).fill(8)],
  );
  for (const event of events) {
    assert.match(event.start, /^2026-12-\d{2}T\d{2}:\d{2}:00$/u);
    assert.match(event.end, /^2026-12-\d{2}T\d{2}:\d{2}:00$/u);
    assert.equal(
      Date.parse(`${event.end}Z`) - Date.parse(`${event.start}Z`),
      30 * 60_000,
    );
  }
});

test('builds exactly 25 ordinary events and permits an empty visible-range set', () => {
  const events = buildPerformanceEvents(2026, 12, '12345', '2', 25);
  assert.equal(events.length, 25);
  assert.deepEqual(
    events.map(({ day }) => day),
    Array.from({ length: 25 }, (_, index) => index + 1),
  );
  assert.equal(new Set(events.map(({ uid }) => uid)).size, 25);
  assert.equal(buildPerformanceEvents(2026, 12, '12345', '2', 0).length, 0);
  assert.throws(() => buildPerformanceEvents(2026, 12, '12345', '2', 251));
});

test('builds 25 ordinary events entirely inside the seven-day default range', () => {
  const events = buildOrdinaryPerformanceEvents('2026-11-28', '12345', '2');
  assert.equal(events.length, 25);
  assert.equal(new Set(events.map(({ uid }) => uid)).size, 25);
  assert.equal(new Set(events.map(({ title }) => title)).size, 25);
  assert.deepEqual(
    [...new Set(events.map(({ start }) => start.slice(0, 10)))],
    [
      '2026-11-28',
      '2026-11-29',
      '2026-11-30',
      '2026-12-01',
      '2026-12-02',
      '2026-12-03',
      '2026-12-04',
    ],
  );
  for (const event of events) {
    assert.equal(
      Date.parse(`${event.end}Z`) - Date.parse(`${event.start}Z`),
      30 * 60_000,
    );
  }
  assert.throws(() =>
    buildOrdinaryPerformanceEvents('2026-11-31', '12345', '2'),
  );
});

test('accepts only the fixed run-scoped manifest shape', () => {
  const events = Array.from({ length: 250 }, (_, index) => ({
    resourceName: `element-performance-12345-2-${String(index + 1).padStart(3, '0')}.ics`,
    state: 'created',
    etag: '"etag"',
  }));
  const valid = {
    version: 2,
    runId: '12345',
    attempt: '2',
    year: 2026,
    month: 12,
    events,
  };
  assert.equal(isSafePerformanceManifest(valid, '12345', '2'), true);
  assert.equal(isSafePerformanceManifest([], '12345', '2'), true);
  assert.equal(
    isSafePerformanceManifest({ ...valid, token: 'private' }, '12345', '2'),
    false,
  );
  assert.equal(
    isSafePerformanceManifest(
      { ...valid, events: [{ resourceName: 'https://example.invalid/a.ics' }] },
      '12345',
      '2',
    ),
    false,
  );
  assert.equal(
    isSafePerformanceManifest(
      { ...valid, events: [events[0], events[0]] },
      '12345',
      '2',
    ),
    false,
  );
  assert.equal(
    isSafePerformanceManifest({ ...valid, attempt: '3' }, '12345', '2'),
    false,
  );
  assert.equal(
    isSafePerformanceManifest(
      { ...valid, events: [{ ...events[0], etag: 'W/"weak"' }] },
      '12345',
      '2',
    ),
    false,
  );
  assert.equal(
    isSafePerformanceManifest(
      {
        ...valid,
        events: [{ ...events[0], state: 'planned' }],
      },
      '12345',
      '2',
    ),
    false,
  );
  assert.equal(
    isSafePerformanceManifest(
      {
        ...valid,
        events: [{ resourceName: events[0].resourceName, state: 'planned' }],
      },
      '12345',
      '2',
    ),
    true,
  );
});

test('cleanup deletes only resources confirmed by this run and its recorded ETag', async () => {
  const persistSnapshots = [];
  const persist = (events) =>
    persistSnapshots.push(events.map((entry) => ({ ...entry })));
  const collision = {
    resourceName: 'element-performance-12345-2-001.ics',
    state: 'planned',
  };
  let collidedResourceExists = true;
  let collisionDeleteCalls = 0;
  await assert.rejects(
    createPerformanceManifestEvent(
      collision,
      async () => {
        assert.equal(collision.state, 'creating');
        const error = new Error('pre-existing resource');
        error.status = 412;
        throw error;
      },
      () => persist([collision]),
    ),
  );
  assert.equal(collision.state, 'conflict');
  const collisionCleanup = await cleanupPerformanceManifestEvents(
    [collision],
    async () => {
      collisionDeleteCalls += 1;
      collidedResourceExists = false;
    },
    () => persist([collision]),
  );
  assert.equal(collidedResourceExists, true);
  assert.equal(collisionDeleteCalls, 0);
  assert.equal(collisionCleanup.conflictCount, 1);
  assert.equal(collisionCleanup.unresolvedCount, 0);

  const ambiguous = {
    resourceName: 'element-performance-12345-2-002.ics',
    state: 'planned',
  };
  let ambiguousRemoteObjectExists = false;
  let ambiguousDeleteCalls = 0;
  await assert.rejects(
    createPerformanceManifestEvent(
      ambiguous,
      async () => {
        assert.equal(ambiguous.state, 'creating');
        ambiguousRemoteObjectExists = true;
        throw new Error('response lost after server write');
      },
      () => persist([ambiguous]),
    ),
  );
  const ambiguousCleanup = await cleanupPerformanceManifestEvents(
    [ambiguous],
    async () => {
      ambiguousDeleteCalls += 1;
      ambiguousRemoteObjectExists = false;
    },
    () => persist([ambiguous]),
  );
  assert.equal(ambiguousRemoteObjectExists, true);
  assert.equal(ambiguousDeleteCalls, 0);
  assert.equal(ambiguousCleanup.unresolvedCount, 1);

  const unavailableVersion = {
    resourceName: 'element-performance-12345-2-003.ics',
    state: 'planned',
  };
  const unavailableVersionCreation = await createPerformanceManifestEvent(
    unavailableVersion,
    async () => ({ etag: undefined }),
    () => persist([unavailableVersion]),
  );
  assert.equal(unavailableVersionCreation.ownershipTokenAvailable, false);
  assert.equal(unavailableVersion.state, 'created');
  let missingVersionDeleteCalled = false;
  const unavailableVersionCleanup = await cleanupPerformanceManifestEvents(
    [unavailableVersion],
    async () => {
      missingVersionDeleteCalled = true;
    },
    () => {},
  );
  assert.equal(missingVersionDeleteCalled, false);
  assert.equal(unavailableVersionCleanup.unresolvedCount, 1);

  const owned = {
    resourceName: 'element-performance-12345-2-004.ics',
    state: 'planned',
  };
  let ownedRemoteObjectExists = false;
  const creation = await createPerformanceManifestEvent(
    owned,
    async () => {
      assert.equal(owned.state, 'creating');
      ownedRemoteObjectExists = true;
      return { etag: '"owned-version"' };
    },
    () => persist([owned]),
  );
  assert.equal(creation.ownershipTokenAvailable, true);
  const deletedEtags = [];
  const ownedCleanup = await cleanupPerformanceManifestEvents(
    [owned],
    async (resourceName, etag) => {
      assert.equal(resourceName, owned.resourceName);
      deletedEtags.push(etag);
      ownedRemoteObjectExists = false;
    },
    () => persist([owned]),
  );
  assert.deepEqual(deletedEtags, ['"owned-version"']);
  assert.equal(ownedRemoteObjectExists, false);
  assert.equal(ownedCleanup.confirmedCreatedCount, 1);
  assert.equal(ownedCleanup.deletedCount, 1);
  assert.equal(ownedCleanup.unresolvedCount, 0);
  assert.equal(persistSnapshots.at(-1)[0].state, 'deleted');

  const replaced = {
    resourceName: 'element-performance-12345-2-005.ics',
    state: 'created',
    etag: '"owned-version"',
  };
  const rejectedDeleteEtags = [];
  const replacedCleanup = await cleanupPerformanceManifestEvents(
    [replaced],
    async (_resourceName, etag) => {
      rejectedDeleteEtags.push(etag);
      const error = new Error('resource version changed');
      error.status = 412;
      throw error;
    },
    () => {},
  );
  assert.deepEqual(rejectedDeleteEtags, ['"owned-version"']);
  assert.equal(replaced.state, 'created');
  assert.equal(replacedCleanup.unresolvedCount, 1);

  const alreadyAbsent = {
    resourceName: 'element-performance-12345-2-006.ics',
    state: 'created',
    etag: '"owned-version"',
  };
  const absentCleanup = await cleanupPerformanceManifestEvents(
    [alreadyAbsent],
    async () => {
      const error = new Error('not found');
      error.status = 404;
      throw error;
    },
    () => {},
  );
  assert.equal(alreadyAbsent.state, 'absent');
  assert.equal(absentCleanup.alreadyAbsentCount, 1);
  assert.equal(absentCleanup.unresolvedCount, 0);
});
