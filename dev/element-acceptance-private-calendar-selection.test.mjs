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

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { selectPrivateAcceptanceCalendar } from './element-acceptance-private-calendar-selection.mjs';
import { createPrivateUiCheckpointJournal } from './element-acceptance-private-ui-checkpoints.mjs';

const expected = {
  gatewayUrl: 'https://127.0.0.1:3001',
  calendarId: 'element-acceptance',
  roomId: '!fixture:localhost',
};
const sourceSha = 'c'.repeat(40);

function response(url, status = 200, method = 'GET') {
  return {
    url: () => url,
    status: () => status,
    request: () => ({ method: () => method }),
  };
}

function responseHarness(nextResponse) {
  let predicate;
  let waitOptions;
  let resolveResponse;
  let rejectResponse;
  const pendingResponse = new Promise((resolve, reject) => {
    resolveResponse = resolve;
    rejectResponse = reject;
  });
  return {
    page: {
      waitForResponse: (nextPredicate, options) => {
        predicate = nextPredicate;
        waitOptions = options;
        return pendingResponse;
      },
    },
    deliver: () => {
      if (predicate(nextResponse)) resolveResponse(nextResponse);
      else rejectResponse(new Error('No matching synthetic response'));
    },
    predicate: () => predicate,
    waitOptions: () => waitOptions,
  };
}

function matchingRoomListResponse(status = 200, overrides = {}) {
  const url = new URL('/v1/calendar/private-clients', expected.gatewayUrl);
  url.searchParams.set('target', 'room');
  url.searchParams.set('calendarId', expected.calendarId);
  url.searchParams.set('roomId', expected.roomId);
  return response(overrides.url ?? url.toString(), status, overrides.method);
}

test('already-selected branch closes without waiting for a list request', async () => {
  const calls = [];
  let observation;
  const result = await selectPrivateAcceptanceCalendar({
    ...expected,
    page: {
      waitForResponse: () => {
        calls.push('wait');
        throw new Error('No request should be awaited');
      },
    },
    calendarListbox: {
      waitFor: async ({ state }) => calls.push(`listbox:${state}`),
    },
    targetCalendarOption: {
      getAttribute: async () => 'true',
      press: async (key) => calls.push(`option-press:${key}`),
      click: async () => calls.push('click'),
    },
    recordObservation: (value) => {
      observation = value;
    },
  });

  assert.equal(result, true);
  assert.deepEqual(calls, ['option-press:Escape', 'listbox:hidden']);
  assert.deepEqual(observation, {
    branch: 'already-selected',
    clickCompleted: false,
    httpStatus: null,
  });
});

test('already-selected branch fails when the picker does not close', async () => {
  const closeFailure = new Error('synthetic picker close failure');
  let observation;

  await assert.rejects(
    selectPrivateAcceptanceCalendar({
      ...expected,
      page: {
        waitForResponse: () => {
          throw new Error('No request should be awaited');
        },
      },
      calendarListbox: {
        waitFor: async ({ state }) => {
          assert.equal(state, 'hidden');
          throw closeFailure;
        },
      },
      targetCalendarOption: {
        getAttribute: async () => 'true',
        press: async (key) => assert.equal(key, 'Escape'),
      },
      recordObservation: (value) => {
        observation = value;
      },
    }),
    (error) => error === closeFailure,
  );

  assert.deepEqual(observation, {
    branch: 'already-selected',
    clickCompleted: false,
    httpStatus: null,
  });
});

test('changed selection waits for the exact room-target list request', async () => {
  const responseValue = matchingRoomListResponse(200);
  const harness = responseHarness(responseValue);
  const calls = [];
  let observation;

  const resultPromise = selectPrivateAcceptanceCalendar({
    ...expected,
    page: harness.page,
    calendarListbox: {
      waitFor: async ({ state }) => calls.push(`listbox:${state}`),
    },
    targetCalendarOption: {
      getAttribute: async () => 'false',
      click: async () => {
        calls.push('click');
        harness.deliver();
      },
    },
    recordObservation: (value) => {
      observation = value;
    },
  });
  const result = await resultPromise;

  assert.equal(result, true);
  assert.deepEqual(calls, ['click']);
  assert.equal(harness.waitOptions()?.timeout, 30_000);
  assert.equal(harness.predicate()(responseValue), true);
  assert.deepEqual(observation, {
    branch: 'changed',
    clickCompleted: true,
    httpStatus: 200,
  });
});

test('changed selection ignores another target or request route', async () => {
  const wrongTarget = new URL(
    '/v1/calendar/private-clients',
    expected.gatewayUrl,
  );
  wrongTarget.searchParams.set('target', 'personal');
  wrongTarget.searchParams.set('calendarId', expected.calendarId);
  wrongTarget.searchParams.set('roomId', expected.roomId);
  const harness = responseHarness(response(wrongTarget.toString()));
  let observation;

  await assert.rejects(
    selectPrivateAcceptanceCalendar({
      ...expected,
      page: harness.page,
      calendarListbox: { waitFor: async () => undefined },
      targetCalendarOption: {
        getAttribute: async () => 'false',
        click: async () => harness.deliver(),
      },
      recordObservation: (value) => {
        observation = value;
      },
    }),
    /No matching synthetic response/u,
  );
  assert.deepEqual(observation, {
    branch: 'changed',
    clickCompleted: true,
    httpStatus: null,
  });

  const wrongMethod = response(
    matchingRoomListResponse().url(),
    200,
    'OPTIONS',
  );
  assert.equal(harness.predicate()(wrongMethod), false);
  const wrongRoute = new URL(matchingRoomListResponse().url());
  wrongRoute.pathname = '/v1/calendar/calendars';
  assert.equal(harness.predicate()(response(wrongRoute.toString())), false);
  assert.equal(
    harness.predicate()(
      response(
        'https://127.0.0.1:3002/v1/calendar/private-clients?target=room&calendarId=element-acceptance&roomId=%21fixture%3Alocalhost',
      ),
    ),
    false,
  );

  for (const mutateQuery of [
    (url) => url.searchParams.set('calendarId', 'another-calendar'),
    (url) => url.searchParams.set('roomId', '!another:localhost'),
    (url) => url.searchParams.set('extra', 'unexpected'),
    (url) => url.searchParams.append('target', 'room'),
  ]) {
    const wrongQuery = new URL(matchingRoomListResponse().url());
    mutateQuery(wrongQuery);
    assert.equal(harness.predicate()(response(wrongQuery.toString())), false);
  }
});

test('changed selection preserves a non-200 response status and fails closed', async () => {
  const harness = responseHarness(matchingRoomListResponse(403));
  let observation;
  const result = await selectPrivateAcceptanceCalendar({
    ...expected,
    page: harness.page,
    calendarListbox: { waitFor: async () => undefined },
    targetCalendarOption: {
      getAttribute: async () => 'false',
      click: async () => harness.deliver(),
    },
    recordObservation: (value) => {
      observation = value;
    },
  });

  assert.equal(result, false);
  assert.deepEqual(observation, {
    branch: 'changed',
    clickCompleted: true,
    httpStatus: 403,
  });
});

test('an unknown response status cannot pass or replace the selection failure', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'private-calendar-selection-'));
  try {
    const stageFile = join(directory, 'stage.jsonl');
    const journal = createPrivateUiCheckpointJournal({
      stageFile,
      sourceSha,
      profile: 'normal-bot',
    });
    const harness = responseHarness(matchingRoomListResponse('200'));

    await assert.rejects(
      journal.run('private-ui-calendar-selection', () =>
        selectPrivateAcceptanceCalendar({
          ...expected,
          page: harness.page,
          calendarListbox: { waitFor: async () => undefined },
          targetCalendarOption: {
            getAttribute: async () => 'false',
            click: async () => harness.deliver(),
          },
          recordObservation: (observation) =>
            journal.recordCalendarSelectionObservation(observation),
        }),
      ),
      /Private calendar selection diagnostics unavailable/u,
    );
    journal.finish('failed');

    const records = readFileSync(stageFile, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.equal(
      records
        .filter((record) => record.phase === 'private-ui-calendar-selection')
        .at(-1)?.status,
      'failed',
    );
    assert.equal(
      records.find(
        (record) => record.phase === 'private-ui-calendar-selection-diagnostic',
      ),
      undefined,
    );
    assert.equal(records.at(-1).failurePhase, 'private-ui-calendar-selection');
    assert.doesNotMatch(readFileSync(stageFile, 'utf8'), /https?:\/\/|'200'/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('waiter rejection after click failure preserves the first failure', async () => {
  const primaryFailure = new Error('synthetic click failure');
  const waiterFailure = new Error('synthetic response waiter failure');
  const unhandledRejections = [];
  let rejectWaiter;
  const pendingResponse = new Promise((resolve, reject) => {
    rejectWaiter = reject;
  });
  const onUnhandledRejection = (error) => unhandledRejections.push(error);
  let observation;
  process.on('unhandledRejection', onUnhandledRejection);
  try {
    await assert.rejects(
      selectPrivateAcceptanceCalendar({
        ...expected,
        page: { waitForResponse: () => pendingResponse },
        calendarListbox: { waitFor: async () => undefined },
        targetCalendarOption: {
          getAttribute: async () => 'false',
          click: async () => {
            throw primaryFailure;
          },
        },
        recordObservation: (value) => {
          observation = value;
          throw new Error('synthetic diagnostic failure');
        },
      }),
      (error) => error === primaryFailure,
    );
    rejectWaiter(waiterFailure);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(unhandledRejections, []);
    assert.deepEqual(observation, {
      branch: 'changed',
      clickCompleted: false,
      httpStatus: null,
    });
  } finally {
    process.off('unhandledRejection', onUnhandledRejection);
  }
});
