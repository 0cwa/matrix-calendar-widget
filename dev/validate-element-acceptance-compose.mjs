import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const requiredBindings = new Map([
  ['synapse', { target: 8008, published: '8008' }],
  ['radicale', { target: 5232, published: '5232' }],
  ['gateway', { target: 3000, published: '3000' }],
  ['widget', { target: 8080, published: '8080' }],
  ['element', { target: 80, published: '8090' }],
  ['restore-gateway', { target: 3000, published: '3000' }],
  ['restore-radicale', { target: 5232, published: '5233' }],
]);

export function hasAcceptanceLoopbackBindings(model) {
  const services = model?.services;
  if (!services || typeof services !== 'object') return false;

  const hasRestoreGateway = services['restore-gateway'] !== undefined;
  const hasRestoreRadicale = services['restore-radicale'] !== undefined;
  if (hasRestoreGateway !== hasRestoreRadicale) return false;

  for (const [name, expected] of requiredBindings) {
    const service = services[name];
    if (service === undefined && name !== 'synapse' && name !== 'radicale') {
      continue;
    }

    const ports = service?.ports;
    if (!Array.isArray(ports) || ports.length !== 1) return false;

    const [port] = ports;
    if (
      !port ||
      typeof port !== 'object' ||
      port.host_ip !== '127.0.0.1' ||
      Number(port.target) !== expected.target ||
      String(port.published) !== expected.published ||
      port.protocol !== 'tcp'
    ) {
      return false;
    }
  }

  const postgres = services.postgres;
  if (
    postgres !== undefined &&
    (!postgres ||
      typeof postgres !== 'object' ||
      (postgres.ports !== undefined &&
        (!Array.isArray(postgres.ports) || postgres.ports.length !== 0)))
  ) {
    return false;
  }

  return true;
}

async function readStandardInput() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  return input;
}

async function main() {
  try {
    const model = JSON.parse(await readStandardInput());
    if (!hasAcceptanceLoopbackBindings(model)) {
      throw new Error('invalid-loopback-bindings');
    }
    process.stdout.write('Acceptance service ports are loopback-only.\n');
  } catch {
    process.stderr.write(
      'Acceptance Compose must publish expected services on loopback only.\n',
    );
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  void main();
}
