import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertAcceptancePrincipalBootstrap,
  createPrincipalOpenIdRequest,
  resolveAcceptancePrincipalMode,
} from './element-acceptance-setup.mjs';

test('acceptance principal mode defaults to the legacy appservice path', () => {
  assert.equal(resolveAcceptancePrincipalMode(undefined), 'appservice');
  assert.equal(resolveAcceptancePrincipalMode('appservice'), 'appservice');
});

test('acceptance principal mode accepts the normal bot account path', () => {
  assert.equal(resolveAcceptancePrincipalMode('bot-account'), 'bot-account');
});

test('acceptance principal mode rejects unknown values', () => {
  assert.throws(() => resolveAcceptancePrincipalMode('unexpected'));
});

test('appservice bootstrap still requires the enabled registration and token', () => {
  assert.doesNotThrow(() =>
    assertAcceptancePrincipalBootstrap({
      mode: 'appservice',
      appserviceRegistration: undefined,
      applicationServiceToken: 'synthetic-as-token',
    }),
  );
  assert.doesNotThrow(() =>
    assertAcceptancePrincipalBootstrap({
      mode: 'appservice',
      appserviceRegistration: 'enabled',
      applicationServiceToken: 'synthetic-as-token',
    }),
  );
  assert.throws(() =>
    assertAcceptancePrincipalBootstrap({
      mode: 'appservice',
      appserviceRegistration: 'disabled',
      applicationServiceToken: 'synthetic-as-token',
    }),
  );
  assert.throws(() =>
    assertAcceptancePrincipalBootstrap({
      mode: 'appservice',
      appserviceRegistration: 'enabled',
      applicationServiceToken: undefined,
    }),
  );
});

test('bot bootstrap requires disabled AS registration and no AS token', () => {
  assert.doesNotThrow(() =>
    assertAcceptancePrincipalBootstrap({
      mode: 'bot-account',
      appserviceRegistration: 'disabled',
      applicationServiceToken: undefined,
    }),
  );
  assert.throws(() =>
    assertAcceptancePrincipalBootstrap({
      mode: 'bot-account',
      appserviceRegistration: 'disabled',
      applicationServiceToken: 'unexpected-as-token',
    }),
  );
  assert.throws(() =>
    assertAcceptancePrincipalBootstrap({
      mode: 'bot-account',
      appserviceRegistration: undefined,
      applicationServiceToken: undefined,
    }),
  );
});

test('appservice OpenID setup preserves delegated sender and request body', () => {
  const request = createPrincipalOpenIdRequest({
    mode: 'appservice',
    userId: '@_matrix_calendar_service:localhost',
    applicationServiceToken: 'synthetic-as-token',
    accountAccessToken: 'unused-account-token',
  });

  assert.equal(
    request.path,
    '/_matrix/client/v3/user/%40_matrix_calendar_service%3Alocalhost/openid/request_token',
  );
  assert.equal(request.token, 'synthetic-as-token');
  assert.deepEqual(request.body, {
    user_id: '@_matrix_calendar_service:localhost',
  });
});

test('bot OpenID setup sends an empty JSON body with the bot access token', () => {
  const request = createPrincipalOpenIdRequest({
    mode: 'bot-account',
    userId: '@element-acceptance-bot:localhost',
    applicationServiceToken: undefined,
    accountAccessToken: 'synthetic-bot-token',
  });

  assert.equal(
    request.path,
    '/_matrix/client/v3/user/%40element-acceptance-bot%3Alocalhost/openid/request_token',
  );
  assert.equal(request.token, 'synthetic-bot-token');
  assert.deepEqual(request.body, {});
  assert.equal(Object.hasOwn(request.body, 'user_id'), false);
  assert.equal(new URL(request.path, 'http://localhost').search, '');
  assert.equal(Object.hasOwn(request, 'user_id'), false);
});

test('OpenID setup rejects a principal mode that was not validated', () => {
  assert.throws(() =>
    createPrincipalOpenIdRequest({
      mode: 'other',
      userId: '@some-user:localhost',
      applicationServiceToken: 'synthetic-as-token',
      accountAccessToken: 'synthetic-bot-token',
    }),
  );
  assert.throws(() =>
    createPrincipalOpenIdRequest({
      mode: 'bot-account',
      userId: '@element-acceptance-bot:localhost',
      applicationServiceToken: 'unexpected-as-token',
      accountAccessToken: 'synthetic-bot-token',
    }),
  );
});
