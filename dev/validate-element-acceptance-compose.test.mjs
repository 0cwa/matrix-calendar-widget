import assert from 'node:assert/strict';
import test from 'node:test';
import { hasAcceptanceLoopbackBindings } from './validate-element-acceptance-compose.mjs';

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
