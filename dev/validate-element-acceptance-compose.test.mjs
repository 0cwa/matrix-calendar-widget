import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  LOCAL_REHEARSAL_LABEL,
  LOCAL_REHEARSAL_SERVICES,
  LOCAL_REHEARSAL_VOLUMES,
} from './element-acceptance-overrides.mjs';
import {
  ACCEPTANCE_GATEWAY_RATE_LIMIT_REQUESTS,
  ACCEPTANCE_GATEWAY_RATE_LIMIT_WINDOW_MS,
  hasAcceptanceGatewayRateLimitBudget,
  hasAcceptanceLoopbackBindings,
  hasLocalPrebuiltOwnershipLabels,
  hasPrivateClientCallbackNetwork,
} from './validate-element-acceptance-compose.mjs';

function port(target, published, hostIp = '127.0.0.1') {
  return {
    target,
    published: String(published),
    protocol: 'tcp',
    host_ip: hostIp,
  };
}

function baseModel(synapseHostIp, radicaleHostIp) {
  return {
    services: {
      synapse: { ports: [port(8008, 8008, synapseHostIp)] },
      radicale: { ports: [port(5232, 5232, radicaleHostIp)] },
    },
  };
}

function webAcceptanceModel() {
  return {
    services: {
      synapse: { ports: [port(8008, 8008)] },
      radicale: { ports: [port(5232, 5232)] },
      gateway: { ports: [port(3000, 3000)] },
      widget: { ports: [port(8080, 8080)] },
      element: { ports: [port(80, 8090)] },
    },
  };
}

function localPrebuiltModel(runId) {
  const ownerLabel = LOCAL_REHEARSAL_LABEL;
  const projectName = `mcw-p0-${runId}`;
  const model = {
    services: {
      synapse: { ports: [port(8008, 8008)] },
      radicale: { ports: [port(5232, 5232)] },
      gateway: { ports: [port(3000, 3000)] },
      widget: { ports: [port(8080, 8080)] },
      postgres: {
        ports: [],
        volumes: [
          {
            type: 'volume',
            source: 'postgres-data',
            target: '/var/lib/postgresql/data',
          },
        ],
      },
      'restore-radicale': { ports: [port(5232, 5233)] },
      'restore-gateway': { ports: [port(3000, 3000)] },
      element: { ports: [port(80, 8090)] },
    },
    volumes: Object.fromEntries(
      LOCAL_REHEARSAL_VOLUMES.map((name) => [
        name,
        {
          labels: { [ownerLabel]: runId },
          ...(name === 'reminder-restore-radicale-data'
            ? { name: `${projectName}_radicale-restore`, external: false }
            : {}),
        },
      ]),
    ),
    networks: { default: { labels: { [ownerLabel]: runId } } },
  };
  for (const name of LOCAL_REHEARSAL_SERVICES) {
    model.services[name].labels = { [ownerLabel]: runId };
  }
  return model;
}

test('accepts base synthetic services bound only to IPv4 loopback', () => {
  assert.equal(
    hasAcceptanceLoopbackBindings(baseModel('127.0.0.1', '127.0.0.1')),
    true,
  );
});

test('rejects an unbound or wildcard Synapse or Radicale port', () => {
  const missingHostIp = baseModel('127.0.0.1', '127.0.0.1');
  delete missingHostIp.services.synapse.ports[0].host_ip;
  assert.equal(hasAcceptanceLoopbackBindings(missingHostIp), false);
  assert.equal(
    hasAcceptanceLoopbackBindings(baseModel('0.0.0.0', '127.0.0.1')),
    false,
  );
  assert.equal(
    hasAcceptanceLoopbackBindings(baseModel('127.0.0.1', '0.0.0.0')),
    false,
  );
});

test('rejects extra published ports even when a loopback mapping is present', () => {
  const model = baseModel('127.0.0.1', '127.0.0.1');
  model.services.synapse.ports.push(port(8008, 8008, '0.0.0.0'));

  assert.equal(hasAcceptanceLoopbackBindings(model), false);
});

test('checks loopback bindings for project services when the overlay is present', () => {
  const model = webAcceptanceModel();

  assert.equal(hasAcceptanceLoopbackBindings(model), true);
  model.services.widget.ports[0].host_ip = '0.0.0.0';
  assert.equal(hasAcceptanceLoopbackBindings(model), false);
});

test('private HTTPS gateway is optional and must publish only on loopback', () => {
  const model = webAcceptanceModel();
  model.services['private-gateway-https'] = {
    ports: [port(3443, 3001)],
  };
  assert.equal(hasAcceptanceLoopbackBindings(model), true);

  model.services['private-gateway-https'].ports[0].host_ip = '0.0.0.0';
  assert.equal(hasAcceptanceLoopbackBindings(model), false);
});

test('private callback bridge uses a dedicated internal network', () => {
  const model = webAcceptanceModel();
  model.networks = {
    default: {},
    'private-client-callback': { internal: true },
  };
  for (const name of ['gateway', 'radicale']) {
    model.services[name].networks = {
      default: {},
      'private-client-callback': {},
    };
  }
  for (const name of ['synapse', 'widget', 'element']) {
    model.services[name].networks = { default: {} };
  }
  model.services['private-gateway-https'] = {
    ports: [port(3443, 3001)],
    networks: { 'private-client-callback': {} },
  };
  assert.equal(hasPrivateClientCallbackNetwork(model), true);

  const nonInternal = structuredClone(model);
  nonInternal.networks['private-client-callback'].internal = false;
  assert.equal(hasPrivateClientCallbackNetwork(nonInternal), false);

  const publicServiceAttached = structuredClone(model);
  publicServiceAttached.services.widget.networks = {
    'private-client-callback': {},
  };
  assert.equal(hasPrivateClientCallbackNetwork(publicServiceAttached), false);

  const bridgeOnDefault = structuredClone(model);
  bridgeOnDefault.services['private-gateway-https'].networks.default = {};
  assert.equal(hasPrivateClientCallbackNetwork(bridgeOnDefault), false);
});

test('acceptance gateways use the same finite rate budget across restart and restore', () => {
  const model = webAcceptanceModel();
  model.services.gateway.environment = {
    MATRIX_CALENDAR_GATEWAY_RATE_LIMIT_REQUESTS: String(
      ACCEPTANCE_GATEWAY_RATE_LIMIT_REQUESTS,
    ),
    MATRIX_CALENDAR_GATEWAY_RATE_LIMIT_WINDOW_MS: String(
      ACCEPTANCE_GATEWAY_RATE_LIMIT_WINDOW_MS,
    ),
  };

  assert.equal(ACCEPTANCE_GATEWAY_RATE_LIMIT_REQUESTS, 1000);
  assert.equal(ACCEPTANCE_GATEWAY_RATE_LIMIT_WINDOW_MS, 60_000);
  assert.equal(hasAcceptanceGatewayRateLimitBudget(model), true);

  const missingBudget = structuredClone(model);
  delete missingBudget.services.gateway.environment
    .MATRIX_CALENDAR_GATEWAY_RATE_LIMIT_REQUESTS;
  assert.equal(hasAcceptanceGatewayRateLimitBudget(missingBudget), false);

  const normalBudget = structuredClone(model);
  normalBudget.services.gateway.environment.MATRIX_CALENDAR_GATEWAY_RATE_LIMIT_REQUESTS =
    '120';
  assert.equal(hasAcceptanceGatewayRateLimitBudget(normalBudget), false);

  const unboundedWindow = structuredClone(model);
  unboundedWindow.services.gateway.environment.MATRIX_CALENDAR_GATEWAY_RATE_LIMIT_WINDOW_MS =
    '30000';
  assert.equal(hasAcceptanceGatewayRateLimitBudget(unboundedWindow), false);

  const reminderModel = structuredClone(model);
  reminderModel.services['restore-gateway'] = {
    environment: {
      MATRIX_CALENDAR_GATEWAY_RATE_LIMIT_REQUESTS: String(
        ACCEPTANCE_GATEWAY_RATE_LIMIT_REQUESTS,
      ),
      MATRIX_CALENDAR_GATEWAY_RATE_LIMIT_WINDOW_MS: String(
        ACCEPTANCE_GATEWAY_RATE_LIMIT_WINDOW_MS,
      ),
    },
  };
  assert.equal(hasAcceptanceGatewayRateLimitBudget(reminderModel), true);

  reminderModel.services[
    'restore-gateway'
  ].environment.MATRIX_CALENDAR_GATEWAY_RATE_LIMIT_REQUESTS = '120';
  assert.equal(hasAcceptanceGatewayRateLimitBudget(reminderModel), false);
});

test('acceptance budget leaves the production example at 120 requests per minute', () => {
  const serverEnvironmentExample = readFileSync(
    new URL('../matrix-calendar-server/.env.local.default', import.meta.url),
    'utf8',
  );

  assert.match(
    serverEnvironmentExample,
    /^MATRIX_CALENDAR_GATEWAY_RATE_LIMIT_REQUESTS=120$/mu,
  );
  assert.match(
    serverEnvironmentExample,
    /^MATRIX_CALENDAR_GATEWAY_RATE_LIMIT_WINDOW_MS=60000$/mu,
  );
});

test('preserves the full Web-only overlay without reminder restore services', () => {
  const model = webAcceptanceModel();

  assert.equal(hasAcceptanceLoopbackBindings(model), true);
  assert.equal('postgres' in model.services, false);
  assert.equal('restore-gateway' in model.services, false);
  assert.equal('restore-radicale' in model.services, false);
});

test('accepts paired loopback-only restore services without publishing PostgreSQL', () => {
  const model = baseModel('127.0.0.1', '127.0.0.1');
  model.services.gateway = { ports: [port(3000, 3000)] };
  model.services.widget = { ports: [port(8080, 8080)] };
  model.services.element = { ports: [port(80, 8090)] };
  model.services.postgres = { ports: [] };
  model.services['restore-radicale'] = { ports: [port(5232, 5233)] };
  model.services['restore-gateway'] = { ports: [port(3000, 3000)] };

  assert.equal(hasAcceptanceLoopbackBindings(model), true);
});

test('local prebuilt overlay requires matching ownership labels on controlled resources', () => {
  const runId = '0123456789abcdef';
  const projectName = `mcw-p0-${runId}`;
  const model = localPrebuiltModel(runId);

  assert.equal(
    hasLocalPrebuiltOwnershipLabels(model, runId, projectName),
    true,
  );
  assert.equal(
    hasAcceptanceLoopbackBindings(model) &&
      hasLocalPrebuiltOwnershipLabels(model, runId, projectName),
    true,
  );

  const missingServiceLabel = structuredClone(model);
  delete missingServiceLabel.services.gateway.labels[LOCAL_REHEARSAL_LABEL];
  assert.equal(
    hasLocalPrebuiltOwnershipLabels(missingServiceLabel, runId, projectName),
    false,
  );

  const mismatchedVolumeLabel = structuredClone(model);
  mismatchedVolumeLabel.volumes['radicale-data'].labels[LOCAL_REHEARSAL_LABEL] =
    'fedcba9876543210';
  assert.equal(
    hasLocalPrebuiltOwnershipLabels(mismatchedVolumeLabel, runId, projectName),
    false,
  );

  const unexpectedNetwork = structuredClone(model);
  unexpectedNetwork.networks.foreign = {};
  assert.equal(
    hasLocalPrebuiltOwnershipLabels(unexpectedNetwork, runId, projectName),
    false,
  );
});

test('rejects incomplete restore services, wildcard restore ports, or published PostgreSQL', () => {
  const model = baseModel('127.0.0.1', '127.0.0.1');
  model.services['restore-radicale'] = { ports: [port(5232, 5233)] };
  assert.equal(hasAcceptanceLoopbackBindings(model), false);

  model.services['restore-gateway'] = { ports: [port(3000, 3000)] };
  assert.equal(hasAcceptanceLoopbackBindings(model), true);

  model.services['restore-gateway'].ports[0].host_ip = '0.0.0.0';
  assert.equal(hasAcceptanceLoopbackBindings(model), false);

  model.services['restore-gateway'].ports[0].host_ip = '127.0.0.1';
  model.services.postgres = { ports: [port(5432, 5432)] };
  assert.equal(hasAcceptanceLoopbackBindings(model), false);
});
