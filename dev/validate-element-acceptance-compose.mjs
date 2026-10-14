import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  hasLocalRehearsalRunLabel,
  LOCAL_REHEARSAL_SERVICES,
  LOCAL_REHEARSAL_VOLUMES,
} from './element-acceptance-overrides.mjs';

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

export function hasLocalPrebuiltOwnershipLabels(model, runId, projectName) {
  const services = model?.services;
  const volumes = model?.volumes;
  const networks = model?.networks;
  if (
    !services ||
    typeof services !== 'object' ||
    Array.isArray(services) ||
    !volumes ||
    typeof volumes !== 'object' ||
    Array.isArray(volumes) ||
    !networks ||
    typeof networks !== 'object' ||
    Array.isArray(networks) ||
    projectName !== `mcw-p0-${runId}` ||
    Object.keys(services).sort().join(',') !==
      [...LOCAL_REHEARSAL_SERVICES, 'element'].sort().join(',') ||
    Object.keys(volumes).sort().join(',') !==
      [...LOCAL_REHEARSAL_VOLUMES].sort().join(',') ||
    Object.keys(networks).sort().join(',') !== 'default'
  ) {
    return false;
  }

  if (
    LOCAL_REHEARSAL_SERVICES.some(
      (name) => !hasLocalRehearsalRunLabel(services[name]?.labels, runId),
    ) ||
    LOCAL_REHEARSAL_VOLUMES.some(
      (name) => !hasLocalRehearsalRunLabel(volumes[name]?.labels, runId),
    )
  ) {
    return false;
  }

  const restoreVolume = volumes['reminder-restore-radicale-data'];
  const postgresVolumes = services.postgres?.volumes;
  return (
    restoreVolume?.name === `${projectName}_radicale-restore` &&
    restoreVolume.external !== true &&
    Array.isArray(postgresVolumes) &&
    postgresVolumes.some(
      (volume) =>
        volume?.source === 'postgres-data' &&
        volume.target === '/var/lib/postgresql/data',
    )
  );
}

async function readStandardInput() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  return input;
}

async function main() {
  try {
    const model = JSON.parse(await readStandardInput());
    const localMode =
      process.env.MATRIX_CALENDAR_LOCAL_PREBUILT_REHEARSAL === 'true';
    const runId = process.env.ELEMENT_ACCEPTANCE_LOCAL_RUN_ID;
    const projectName = process.env.COMPOSE_PROJECT_NAME;
    if (
      !hasAcceptanceLoopbackBindings(model) ||
      (localMode && !hasLocalPrebuiltOwnershipLabels(model, runId, projectName))
    ) {
      throw new Error('invalid-loopback-bindings');
    }
    process.stdout.write(
      localMode
        ? 'Local acceptance ports and ownership labels are valid.\n'
        : 'Acceptance service ports are loopback-only.\n',
    );
  } catch {
    process.stderr.write(
      'Acceptance Compose must use loopback ports and required local ownership labels.\n',
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
