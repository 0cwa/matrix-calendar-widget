import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveProbePrincipal } from './element-acceptance-caldav-report-probe.mjs';

test('report probe keeps the legacy appservice OpenID request shape', () => {
  const principal = resolveProbePrincipal(
    {
      principalMode: 'appservice',
      serviceSender: {
        userId: '@_matrix_calendar_service:localhost',
        accessToken: 'synthetic-service-user-token',
      },
    },
    'synthetic-as-token',
  );

  assert.deepEqual(principal, {
    mode: 'appservice',
    userId: '@_matrix_calendar_service:localhost',
    localpart: '_matrix_calendar_service',
    accessToken: 'synthetic-as-token',
    openIdBody: { user_id: '@_matrix_calendar_service:localhost' },
  });
});

test('report probe uses the selected bot token with no AS credential or body', () => {
  const bot = {
    userId: '@element-acceptance-bot:localhost',
    accessToken: 'synthetic-bot-token',
  };
  const principal = resolveProbePrincipal(
    {
      principalMode: 'bot-account',
      bot,
      serviceSender: { ...bot },
    },
    undefined,
  );

  assert.deepEqual(principal, {
    mode: 'bot-account',
    userId: bot.userId,
    localpart: 'element-acceptance-bot',
    accessToken: bot.accessToken,
  });
  assert.equal(Object.hasOwn(principal, 'openIdBody'), false);
});

test('report probe rejects bot identity/token mismatches and AS credentials', () => {
  const bot = {
    userId: '@element-acceptance-bot:localhost',
    accessToken: 'synthetic-bot-token',
  };

  assert.equal(
    resolveProbePrincipal(
      {
        principalMode: 'bot-account',
        bot,
        serviceSender: {
          userId: '@different-bot:localhost',
          accessToken: bot.accessToken,
        },
      },
      undefined,
    ),
    undefined,
  );
  assert.equal(
    resolveProbePrincipal(
      {
        principalMode: 'bot-account',
        bot,
        serviceSender: { ...bot },
      },
      'unexpected-as-token',
    ),
    undefined,
  );
});
