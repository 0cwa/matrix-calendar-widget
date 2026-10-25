import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import https from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createPrivateAcceptanceHttpsProxy } from './element-acceptance-private-https-proxy.mjs';
import { createPrivateAcceptanceTlsFixture } from './element-acceptance-private-tls.mjs';
import {
  assertAcceptancePrincipalBootstrap,
  createPrincipalOpenIdRequest,
  getAcceptanceReadinessEndpoints,
  readPrivateHttpsServiceDiagnostic,
  requestPrivateHttpsReadiness,
  resolveAcceptancePrincipalMode,
} from './element-acceptance-setup.mjs';

function listenLocal(server, port = 0) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server.address().port);
    });
  });
}

function closeLocal(server) {
  return new Promise((resolve, reject) => {
    if (!server?.listening) return resolve();
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

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

test('private HTTPS probe separates TCP, TLS trust, and HTTP response stages', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'mcw-private-ready-stage-'));
  chmodSync(directory, 0o700);
  const certificateFixture = createPrivateAcceptanceTlsFixture({
    directory: join(directory, 'trusted'),
  });
  const otherCaFixture = createPrivateAcceptanceTlsFixture({
    directory: join(directory, 'untrusted'),
  });
  let responseCount = 0;
  let backend;
  let proxy;
  let closedListener;
  let stalledServer;
  try {
    const proxyPort = 3001;
    backend = createHttpServer((_request, response) => {
      responseCount += 1;
      response.writeHead(403);
      response.end();
    });
    const backendPort = await listenLocal(backend);
    proxy = createPrivateAcceptanceHttpsProxy({
      key: readFileSync(certificateFixture.serverKeyPath),
      cert: readFileSync(certificateFixture.serverCertPath),
      upstreamHost: '127.0.0.1',
      upstreamPort: backendPort,
      listenHost: '127.0.0.1',
      listenPort: proxyPort,
    });
    await listenLocal(proxy, proxyPort);
    const origin = `https://127.0.0.1:${proxyPort}`;

    const untrusted = await requestPrivateHttpsReadiness(origin, {
      ca: readFileSync(otherCaFixture.caCertPath),
      timeoutMs: 2_000,
    });
    assert.deepEqual(untrusted, {
      privateHttpsTcpOutcome: 'connected',
      privateHttpsTlsOutcome: 'trust-rejected',
      privateHttpsRequestOutcome: 'not-attempted',
    });

    const trusted = await requestPrivateHttpsReadiness(origin, {
      ca: readFileSync(certificateFixture.caCertPath),
      timeoutMs: 2_000,
    });
    assert.deepEqual(trusted, {
      privateHttpsTcpOutcome: 'connected',
      privateHttpsTlsOutcome: 'validated',
      privateHttpsRequestOutcome: 'response',
      httpStatus: 403,
    });
    assert.equal(responseCount, 1);

    stalledServer = https.createServer(
      {
        key: readFileSync(certificateFixture.serverKeyPath),
        cert: readFileSync(certificateFixture.serverCertPath),
      },
      () => undefined,
    );
    const stalledPort = await listenLocal(stalledServer);
    const stalled = await requestPrivateHttpsReadiness(
      `https://127.0.0.1:${stalledPort}`,
      {
        ca: readFileSync(certificateFixture.caCertPath),
        timeoutMs: 200,
      },
    );
    assert.deepEqual(stalled, {
      privateHttpsTcpOutcome: 'connected',
      privateHttpsTlsOutcome: 'validated',
      privateHttpsRequestOutcome: 'timed-out',
    });

    closedListener = https.createServer();
    const closedPort = await listenLocal(closedListener);
    await closeLocal(closedListener);
    const refused = await requestPrivateHttpsReadiness(
      `https://127.0.0.1:${closedPort}`,
      { timeoutMs: 2_000 },
    );
    assert.deepEqual(refused, {
      privateHttpsTcpOutcome: 'refused',
      privateHttpsTlsOutcome: 'not-attempted',
      privateHttpsRequestOutcome: 'not-attempted',
    });
  } finally {
    await closeLocal(closedListener);
    await closeLocal(stalledServer);
    await closeLocal(proxy);
    await closeLocal(backend);
    rmSync(directory, { recursive: true, force: true });
  }
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
