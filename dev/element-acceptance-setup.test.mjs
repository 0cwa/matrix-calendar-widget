import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertAcceptancePrincipalBootstrap,
  createPrincipalOpenIdRequest,
  getAcceptanceReadinessEndpoints,
  readPrivateHttpsServiceDiagnostic,
  resolveAcceptancePrincipalMode,
} from './element-acceptance-setup.mjs';

test('default readiness still waits for Element after gateway and widget', () => {
  assert.deepEqual(
    getAcceptanceReadinessEndpoints().map(({ phase }) => phase),
    ['gateway-ready', 'widget-ready', 'element-ready'],
  );
});

test('local readiness omits Element and keeps gateway and widget checks', () => {
  const endpoints = getAcceptanceReadinessEndpoints(true);
  assert.deepEqual(
    endpoints.map(({ phase }) => phase),
    ['gateway-ready', 'widget-ready'],
  );
  assert.equal(
    endpoints.some(({ url }) => url.includes(':8090/')),
    false,
  );
});

test('private readiness checks the HTTPS bridge before widget and Element', () => {
  const endpoints = getAcceptanceReadinessEndpoints(false, true);
  assert.deepEqual(
    endpoints.map(({ phase }) => phase),
    [
      'gateway-ready',
      'private-gateway-https-ready',
      'widget-ready',
      'element-ready',
    ],
  );
  const privateEndpoint = endpoints[1];
  assert.equal(
    privateEndpoint.url,
    'https://127.0.0.1:3001/v1/calendar/context',
  );
  assert.equal(privateEndpoint.expectedStatus(403), true);
  assert.equal(privateEndpoint.expectedStatus(200), false);
});

test('private HTTPS startup diagnostics retain only bounded container state', () => {
  const calls = [];
  const diagnostic = readPrivateHttpsServiceDiagnostic({
    projectName: 'matrix-acceptance-test',
    serverEnvFile: '/tmp/runner/server.env',
    privateUiEnvFile: '/tmp/runner/private-ui.env',
    runnerTemp: '/tmp/runner',
    composeFiles: [],
    execute(command, args) {
      calls.push({ command, args });
      return args[0] === 'compose'
        ? '0123456789ab\n'
        : JSON.stringify({
            Status: 'exited',
            Health: null,
            ExitCode: 1,
            OOMKilled: false,
            Error: 'synthetic-private-runtime-detail',
          });
    },
  });

  assert.deepEqual(diagnostic, {
    containerState: 'exited',
    containerHealth: 'none',
    containerExitCode: 1,
    containerOomKilled: false,
    containerRuntimeErrorPresent: true,
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].command, 'docker');
  assert.equal(calls[0].args.includes('private-gateway-https'), true);
  assert.equal(calls[0].args.includes('logs'), false);
  assert.equal(calls[1].args[0], 'inspect');
  assert.equal(
    JSON.stringify(diagnostic).includes('synthetic-private-runtime-detail'),
    false,
  );
});

test('private HTTPS diagnostics fail closed for unsafe compose inputs and IDs', () => {
  let calls = 0;
  const execute = () => {
    calls += 1;
    return 'unsafe-container-id';
  };
  assert.deepEqual(
    readPrivateHttpsServiceDiagnostic({
      projectName: 'matrix-acceptance-test',
      serverEnvFile: '/tmp/outside/server.env',
      privateUiEnvFile: '/tmp/runner/private-ui.env',
      runnerTemp: '/tmp/runner',
      execute,
    }),
    { containerState: 'unavailable', containerHealth: 'unavailable' },
  );
  assert.equal(calls, 0);
  assert.deepEqual(
    readPrivateHttpsServiceDiagnostic({
      projectName: 'matrix-acceptance-test',
      serverEnvFile: '/tmp/runner/server.env',
      privateUiEnvFile: '/tmp/runner/private-ui.env',
      runnerTemp: '/tmp/runner',
      composeFiles: [],
      execute,
    }),
    { containerState: 'unavailable', containerHealth: 'unavailable' },
  );
  assert.equal(calls, 1);
});

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
