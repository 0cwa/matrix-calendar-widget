#!/usr/bin/env node

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

import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const LOCAL_LABEL = 'io.matrix-calendar-widget.local-rehearsal';
const PROJECT_LABEL = 'com.docker.compose.project';
const SERVICE_LABEL = 'com.docker.compose.service';
const VOLUME_LABEL = 'com.docker.compose.volume';
const SERVICES = Object.freeze([
  'synapse',
  'radicale',
  'gateway',
  'widget',
  'postgres',
  'restore-radicale',
  'restore-gateway',
]);
const VOLUMES = Object.freeze([
  'synapse-data',
  'radicale-data',
  'postgres-data',
  'reminder-restore-radicale-data',
]);
const PORTS = Object.freeze([8008, 5232, 3000, 8080, 5233, 8090]);
const FAILURE_DIAGNOSTIC_FILE =
  'matrix-calendar-widget-operator-rehearsal-failure.json';
const GATEWAY_NETWORK_SMOKE_MARKER = 'gateway_network_smoke';
const NETWORK_SMOKE_ERROR_CLASSES = new Set([
  'none',
  'dns',
  'connection-refused',
  'connection-reset',
  'timeout',
  'other',
]);
const DISABLED_ELEMENT_PROFILE = 'operator-rehearsal-disabled';
const HOSTED_SHARED_DOCKER_SELECTION =
  'MATRIX_CALENDAR_HOSTED_SHARED_DOCKER_REHEARSAL';
const COMPOSE_VALUE_OPTIONS = new Set([
  '-f',
  '--file',
  '-p',
  '--project-name',
  '--env-file',
  '--project-directory',
  '--profile',
  '--ansi',
  '--progress',
  '--parallel',
]);
const API_STAGES = Object.freeze([
  'fixture',
  'member-openid',
  'outsider-openid',
  'outsider-denied',
  'event-create',
  'canonical-readback',
  'stale-etag-conflict',
  'event-update',
  'updated-readback',
  'event-delete',
  'delete-readback',
  'owned-cleanup',
]);
const SAFE_PHASES = new Set([
  'preflight',
  'source-binding',
  'inventory',
  'image-lock',
  'fixture-image-lock',
  'compose-validation',
  'inventory',
  'service-inventory',
  'volume-inventory',
  'network-inventory',
  'private-files',
  'docker-api-preflight',
  'baseline',
  'foreign-inventory',
  'listener-inventory',
  'fixture-setup',
  'api-route-smoke',
  'compose-run-gateway-smoke',
  'api-crud-probe',
  'reminder-initial',
  'reminder-restart',
  'paired-store-restore',
  'owned-cleanup',
  'owned-cleanup-preflight',
  'task-files-cleanup',
  'receipt-publish',
  'source-image-inspect',
  'fixture-image-pull',
  'compose-inputs',
  'inventory-baseline',
  'start-calendaring-services',
  'start-primary-services',
  'failure-cleanup',
  'runner',
]);
const INVENTORY_STAGE_BASES = [
  'baseline',
  'primary',
  'paired-restore',
  'pre-cleanup',
  'failure-cleanup',
  'success-after-containers',
  'success-after-volumes',
  'success-final-inventory',
  'failure-after-containers',
  'failure-after-volumes',
  'failure-final-inventory',
];
const INVENTORY_OPERATION_SUFFIXES = [
  ['containers', 'inventory-list-containers'],
  ['image-ids', 'inventory-list-images'],
  ['network-ids', 'inventory-list-networks'],
  ['volume-names', 'inventory-list-volumes'],
  ['container-inspect', 'inventory-inspect-containers'],
  ['image-inspect', 'inventory-inspect-images'],
  ['network-inspect', 'inventory-inspect-networks'],
  ['volume-inspect', 'inventory-inspect-volumes'],
  ['listeners', 'inventory-list-listeners'],
];
const failureOperationEntries = [
  ['docker-api-version', 'docker-api-version'],
  ['docker-cli-version', 'docker-client-version'],
  ['docker-compose-version', 'docker-compose-version'],
  ['compose-config', 'compose-config'],
  ['start-synapse-radicale', 'calendar-services-start'],
  ['setup-fixture', 'fixture-setup'],
  ['start-gateway-widget-postgres', 'primary-services-start'],
  ['wait-element-free', 'primary-services-readiness'],
  ['compose-ps-gateway', 'gateway-service-query'],
  ['exec-synapse-smoke', 'synapse-http-smoke'],
  ['compose-run-gateway-smoke', 'gateway-network-smoke'],
  ['widget-http-smoke', 'widget-http-smoke'],
  ['api-crud-probe', 'api-crud-probe'],
  ['prepare-reminder-room', 'reminder-room-prepare'],
  ['enable-reminder-runtime', 'reminder-runtime-enable'],
  ['reminder-initial-fixture', 'reminder-initial-fixture'],
  ['verify-initial-reminder-config', 'reminder-initial-config-verify'],
  ['snapshot-initial-reminder-state', 'reminder-initial-state-snapshot'],
  ['restart-reminder-gateway', 'reminder-gateway-restart'],
  ['reminder-restart-fixture', 'reminder-restart-fixture'],
  ['verify-restart-reminder-config', 'reminder-restart-config-verify'],
  ['verify-restart-delivery', 'reminder-restart-delivery-verify'],
  ['snapshot-restart-reminder-state', 'reminder-restart-state-snapshot'],
  ['restore-paired-stores', 'paired-store-restore'],
  ['reminder-restore-fixture', 'reminder-restore-fixture'],
  ['verify-paired-restore-delivery', 'paired-restore-delivery-verify'],
  ['success-cleanup', 'cleanup-assertion'],
  ['failure-cleanup', 'cleanup-assertion'],
];
for (const role of ['gateway', 'widget', 'radicale']) {
  failureOperationEntries.push([`inspect-${role}`, 'source-image-inspect']);
  failureOperationEntries.push([
    `pre-start-image-lock-${role}`,
    'source-image-lock-recheck',
  ]);
  failureOperationEntries.push([
    `pre-restore-image-lock-${role}`,
    'source-image-lock-recheck',
  ]);
}
for (const role of ['synapse', 'postgres']) {
  failureOperationEntries.push([`pull-${role}`, 'fixture-image-pull']);
  failureOperationEntries.push([`inspect-${role}`, 'fixture-image-inspect']);
  failureOperationEntries.push([
    `inspect-pinned-${role}`,
    'fixture-image-lock-recheck',
  ]);
}
for (const base of INVENTORY_STAGE_BASES) {
  for (const [suffix, operation] of INVENTORY_OPERATION_SUFFIXES) {
    failureOperationEntries.push([`${base}-${suffix}`, operation]);
  }
}
for (const prefix of ['success', 'failure']) {
  for (const [suffix, operation] of [
    ['inspect-container', 'cleanup-container-inspect'],
    ['stop-container', 'cleanup-container-stop'],
    ['remove-container', 'cleanup-container-remove'],
    ['inspect-volume', 'cleanup-volume-inspect'],
    ['remove-volume', 'cleanup-volume-remove'],
    ['inspect-network', 'cleanup-network-inspect'],
    ['remove-network', 'cleanup-network-remove'],
  ]) {
    failureOperationEntries.push([`${prefix}-${suffix}`, operation]);
  }
}
const FAILURE_OPERATION_BY_STAGE = new Map(failureOperationEntries);
const SAFE_FAILURE_OPERATIONS = new Set([
  ...FAILURE_OPERATION_BY_STAGE.values(),
  'gate',
  'runner-error',
  'unknown',
]);
const SAFE_STARTUP_STAGES = new Set([
  'configuration-preflight',
  'docker-preflight',
  'curl-preflight',
  'homeserver-probe',
  'homeserver-generate',
  'fixture-permission',
  'registration-update',
  'uid991-access-assertion',
  'synapse-compose-start',
  'unknown',
]);
const FAILURE_CHECK_BY_CODE = new Map([
  ['gateway-network-smoke-failed', 'network-smoke'],
  ['service-set-mismatch', 'service-set'],
  ['service-image-mismatch', 'image'],
  ['container-id-invalid', 'container-identity'],
  ['service-state-mismatch', 'state'],
  ['element-container-present', 'element'],
  ['volume-set-mismatch', 'volume'],
  ['network-set-mismatch', 'network'],
  ['foreign-listener-changed', 'listener'],
]);
const PRIMARY_SERVICE_ROLES = Object.freeze([
  'synapse',
  'radicale',
  'gateway',
  'widget',
  'postgres',
]);
const SAFE_CONTAINER_STATES = new Set([
  'created',
  'running',
  'restarting',
  'paused',
  'exited',
  'dead',
]);
const SAFE_HEALTH_STATES = new Set(['healthy', 'unhealthy', 'starting']);

export function failureOperationForStage(stage) {
  return (
    FAILURE_OPERATION_BY_STAGE.get(stage) ??
    (SAFE_PHASES.has(stage) ? 'gate' : 'unknown')
  );
}

export const GATEWAY_NETWORK_SMOKE_SCRIPT = `(async () => {
  const networkErrorClass = (error) => {
    const code = error?.cause?.code;
    if (
      error?.name === 'TimeoutError' ||
      ['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT'].includes(code)
    ) {
      return 'timeout';
    }
    if (['ENOTFOUND', 'EAI_AGAIN', 'EAI_FAIL'].includes(code)) return 'dns';
    if (code === 'ECONNREFUSED') return 'connection-refused';
    if (code === 'ECONNRESET') return 'connection-reset';
    return 'other';
  };
  const probe = async (url) => {
    try {
      const response = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(5000),
      });
      const status =
        Number.isInteger(response.status) &&
        response.status >= 100 &&
        response.status <= 599
          ? response.status
          : 'unavailable';
      return {
        status,
        errorClass: status === 'unavailable' ? 'other' : 'none',
      };
    } catch (error) {
      return { status: 'unavailable', errorClass: networkErrorClass(error) };
    }
  };
  const [synapse, radicale] = await Promise.all([
    probe('http://synapse:8008/_matrix/client/versions'),
    probe('http://radicale:5232/'),
  ]);
  if (synapse.status !== 200 || ![302, 401, 403].includes(radicale.status)) {
    const marker =
      '${GATEWAY_NETWORK_SMOKE_MARKER} synapse=' +
      synapse.status +
      ':' +
      synapse.errorClass +
      ' radicale=' +
      radicale.status +
      ':' +
      radicale.errorClass +
      '\\n';
    process.stdout.write(marker);
    process.exitCode = 1;
  }
})().catch(() => {
  process.exitCode = 1;
});`;

export function gatewayNetworkSmokeArgs(compose, runId, project) {
  return [
    ...compose,
    'run',
    '--pull',
    'never',
    '--no-deps',
    '--rm',
    '--label',
    `${LOCAL_LABEL}=${runId}`,
    '--name',
    `${project}-local-${runId}-900`,
    '--entrypoint',
    'node',
    'gateway',
    '-e',
    GATEWAY_NETWORK_SMOKE_SCRIPT,
  ];
}

function unavailableNetworkSmokeRole() {
  return { http_status: 'unavailable', error_class: 'unavailable' };
}

function networkSmokeProcessExitCode(value) {
  return Number.isInteger(value) && value >= 0 && value <= 255
    ? value
    : 'unavailable';
}

function parseNetworkSmokeRole(status, errorClass) {
  if (!NETWORK_SMOKE_ERROR_CLASSES.has(errorClass)) return undefined;
  if (status === 'unavailable') {
    return errorClass !== 'none'
      ? { http_status: 'unavailable', error_class: errorClass }
      : undefined;
  }
  if (
    !Number.isInteger(status) ||
    status < 100 ||
    status > 599 ||
    errorClass !== 'none'
  ) {
    return undefined;
  }
  return { http_status: status, error_class: 'none' };
}

export function parseGatewayNetworkSmokeFailure(stdout, processExitCode) {
  const diagnostic = {
    marker_status: 'absent',
    process_exit_code: networkSmokeProcessExitCode(processExitCode),
    synapse: unavailableNetworkSmokeRole(),
    radicale: unavailableNetworkSmokeRole(),
  };
  const lines =
    typeof stdout === 'string'
      ? stdout
          .split(/\r?\n/u)
          .filter((line) => line.startsWith(GATEWAY_NETWORK_SMOKE_MARKER))
      : [];
  if (lines.length === 0) return diagnostic;
  if (lines.length !== 1) return { ...diagnostic, marker_status: 'invalid' };

  const match =
    /^gateway_network_smoke synapse=(unavailable|[0-9]{3}):([a-z-]+) radicale=(unavailable|[0-9]{3}):([a-z-]+)$/u.exec(
      lines[0],
    );
  if (!match) return { ...diagnostic, marker_status: 'invalid' };
  const synapse = parseNetworkSmokeRole(
    match[1] === 'unavailable' ? match[1] : Number(match[1]),
    match[2],
  );
  const radicale = parseNetworkSmokeRole(
    match[3] === 'unavailable' ? match[3] : Number(match[3]),
    match[4],
  );
  if (!synapse || !radicale) {
    return { ...diagnostic, marker_status: 'invalid' };
  }
  return {
    ...diagnostic,
    marker_status: 'captured',
    synapse,
    radicale,
  };
}

function projectGatewayNetworkSmoke(diagnostic) {
  const markerStatus = [
    'not-applicable',
    'absent',
    'invalid',
    'captured',
  ].includes(diagnostic?.marker_status)
    ? diagnostic.marker_status
    : 'not-applicable';
  const projected = {
    marker_status: markerStatus,
    process_exit_code:
      markerStatus === 'not-applicable'
        ? 'unavailable'
        : networkSmokeProcessExitCode(diagnostic?.process_exit_code),
    synapse: unavailableNetworkSmokeRole(),
    radicale: unavailableNetworkSmokeRole(),
  };
  if (markerStatus !== 'captured') return projected;

  const role = (value) =>
    parseNetworkSmokeRole(value?.http_status, value?.error_class);
  const synapse = role(diagnostic?.synapse);
  const radicale = role(diagnostic?.radicale);
  if (!synapse || !radicale) {
    return { ...projected, marker_status: 'invalid' };
  }
  return { ...projected, synapse, radicale };
}

const FIXTURES = Object.freeze([
  {
    role: 'synapse',
    tag: 'ghcr.io/element-hq/synapse:v1.161.0',
  },
  { role: 'postgres', tag: 'postgres:16.15-alpine3.23' },
]);

class RehearsalFailure extends Error {
  constructor(stage, code = 'gate-failed', diagnostic = {}) {
    super('Hosted operator rehearsal failed');
    this.stage = stage;
    this.code = code;
    this.startupStage = SAFE_STARTUP_STAGES.has(diagnostic.startupStage)
      ? diagnostic.startupStage
      : 'unknown';
    this.childExitCode =
      Number.isInteger(diagnostic.childExitCode) &&
      diagnostic.childExitCode >= 0 &&
      diagnostic.childExitCode <= 255
        ? diagnostic.childExitCode
        : 'unavailable';
    this.gatewayNetworkSmoke = diagnostic.gatewayNetworkSmoke;
  }
}

function fail(stage, code, diagnostic) {
  throw new RehearsalFailure(stage, code, diagnostic);
}

function requireSha(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/u.test(value)) {
    fail('source-binding', 'source-sha-invalid');
  }
  return value;
}

function requireDigest(value) {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    fail('image-lock', 'image-digest-invalid');
  }
  return value;
}

function readJson(file, stage) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    fail(stage, 'json-invalid');
  }
}

function required(env, key) {
  const value = env[key];
  if (typeof value !== 'string' || value.length === 0) {
    fail('preflight', 'required-input-missing');
  }
  return value;
}

function isSupportedGitHubHostedRunner(environment) {
  return (
    environment.GITHUB_ACTIONS === 'true' &&
    environment.RUNNER_ENVIRONMENT === 'github-hosted' &&
    environment.RUNNER_OS === 'Linux' &&
    environment.GITHUB_REPOSITORY === '0cwa/matrix-calendar-widget' &&
    environment.GITHUB_REF === 'refs/heads/main'
  );
}

function privatePath(file, root, directory = false) {
  let info;
  try {
    info = lstatSync(file);
  } catch {
    fail('private-files', 'private-path-missing');
  }
  if (
    info.isSymbolicLink() ||
    (directory ? !info.isDirectory() : !info.isFile()) ||
    info.uid !== process.getuid?.() ||
    (info.mode & 0o777) !== (directory ? 0o700 : 0o600) ||
    !path.resolve(file).startsWith(`${path.resolve(root)}${path.sep}`)
  ) {
    fail('private-files', 'private-path-invalid');
  }
}

function writePrivate(file, value) {
  writeFileSync(file, value, { mode: 0o600, flag: 'wx' });
  chmodSync(file, 0o600);
}

function exactSourceImages(manifest, sourceSha, sourceTree, runId, attempt) {
  if (
    manifest?.schema_version !== 2 ||
    manifest.source?.sha !== sourceSha ||
    manifest.source?.tree !== sourceTree ||
    manifest.source?.dispatch_sha !==
      required(process.env, 'RELEASE_DISPATCH_SHA') ||
    manifest.workflow?.sha !== required(process.env, 'RELEASE_WORKFLOW_SHA') ||
    manifest.workflow?.repository !== '0cwa/matrix-calendar-widget' ||
    manifest.workflow?.ref !==
      '0cwa/matrix-calendar-widget/.github/workflows/release-image-archive.yml@refs/heads/main' ||
    manifest.workflow?.run_id !==
      Number(required(process.env, 'RELEASE_RUN_ID')) ||
    manifest.workflow?.run_attempt !== Number(attempt) ||
    manifest.platform !== 'linux/amd64' ||
    !Array.isArray(manifest.images) ||
    manifest.images.length !== 3
  ) {
    fail('image-lock', 'manifest-binding-mismatch');
  }

  const expected = new Map([
    ['server', 'matrix-calendar-widget/server'],
    ['widget', 'matrix-calendar-widget/widget'],
    ['radicale', 'matrix-calendar-widget/radicale-openid'],
  ]);
  const images = [];
  for (const [name, prefix] of expected) {
    const image = manifest.images.find((record) => record?.name === name);
    if (
      !image ||
      image.tag !== `${prefix}:archive-${runId}-${attempt}` ||
      (image.platform !== undefined && image.platform !== 'linux/amd64')
    ) {
      fail('image-lock', 'manifest-image-mismatch');
    }
    const id = requireDigest(image.image_id);
    requireDigest(image.buildx_manifest_digest);
    images.push({
      role: name === 'server' ? 'gateway' : name,
      ref: image.tag,
      id,
      buildxManifestDigest: image.buildx_manifest_digest,
      os: 'linux',
      architecture: 'amd64',
    });
  }
  return images;
}

export function validateImageInspect(actual, expected) {
  if (
    !Array.isArray(actual) ||
    actual.length !== 1 ||
    actual[0]?.Id !== expected.id ||
    actual[0]?.Os !== 'linux' ||
    actual[0]?.Architecture !== 'amd64' ||
    !Array.isArray(actual[0]?.RepoTags) ||
    !actual[0].RepoTags.includes(expected.ref)
  ) {
    throw new RehearsalFailure('image-lock', 'image-id-drift');
  }
  return actual[0];
}

export function validateLockedImageInspect(actual, expected) {
  if (
    !Array.isArray(actual) ||
    actual.length !== 1 ||
    actual[0]?.Id !== expected.id ||
    actual[0]?.Os !== 'linux' ||
    actual[0]?.Architecture !== 'amd64' ||
    (expected.buildxManifestDigest
      ? !actual[0]?.RepoTags?.includes(expected.ref)
      : !actual[0]?.RepoDigests?.includes(expected.ref))
  ) {
    throw new RehearsalFailure('image-lock', 'image-id-drift');
  }
  return actual[0];
}

export function fixtureIdentity(actual, expectedTag) {
  if (
    !Array.isArray(actual) ||
    actual.length !== 1 ||
    !/^sha256:[0-9a-f]{64}$/u.test(actual[0]?.Id ?? '') ||
    actual[0]?.Os !== 'linux' ||
    actual[0]?.Architecture !== 'amd64' ||
    !actual[0]?.RepoTags?.includes(expectedTag) ||
    !Array.isArray(actual[0]?.RepoDigests) ||
    actual[0].RepoDigests.length === 0
  ) {
    fail('fixture-image-lock', 'fixture-image-invalid');
  }
  const digests = [...new Set(actual[0].RepoDigests)].sort();
  if (digests.some((value) => !/@sha256:[0-9a-f]{64}$/u.test(value))) {
    fail('fixture-image-lock', 'fixture-digest-invalid');
  }
  const repository = expectedTag.slice(0, expectedTag.lastIndexOf(':'));
  const repositoryName = repository.split(':')[0];
  const repoDigest = digests.find(
    (value) =>
      value.startsWith(`${repositoryName}@`) ||
      (repositoryName === 'postgres' &&
        value.startsWith('docker.io/library/postgres@')),
  );
  if (!repoDigest) fail('fixture-image-lock', 'fixture-repository-mismatch');
  return {
    ref: repoDigest,
    id: actual[0].Id,
    repoDigests: digests,
    os: actual[0].Os,
    architecture: actual[0].Architecture,
  };
}

function makeComposeOverride(lock, runId, project) {
  const byRole = new Map(lock.images.map((image) => [image.role, image.ref]));
  const serviceImage = (service) => {
    if (service === 'restore-radicale') return byRole.get('radicale');
    if (service === 'restore-gateway') return byRole.get('gateway');
    return byRole.get(service);
  };
  if (SERVICES.some((service) => !serviceImage(service))) {
    fail('compose-validation', 'image-role-missing');
  }
  const lines = ['services:'];
  for (const service of SERVICES) {
    lines.push(
      `  ${service}:`,
      `    image: ${serviceImage(service)}`,
      '    labels:',
      `      ${LOCAL_LABEL}: "${runId}"`,
    );
  }
  lines.push(
    '  element:',
    `    profiles: ["${DISABLED_ELEMENT_PROFILE}"]`,
    'networks:',
    '  default:',
    '    labels:',
    `      ${LOCAL_LABEL}: "${runId}"`,
    'volumes:',
  );
  for (const volume of VOLUMES) {
    lines.push(
      `  ${volume}:`,
      '    labels:',
      `      ${LOCAL_LABEL}: "${runId}"`,
    );
  }
  return `${lines.join('\n')}\n`;
}

function labelsOf(resource, kind) {
  return kind === 'container'
    ? (resource?.Config?.Labels ?? {})
    : (resource?.Labels ?? {});
}

function namedForTask(resource, kind, project) {
  const name =
    kind === 'container' ? resource?.Name?.replace(/^\//u, '') : resource?.Name;
  return (
    typeof name === 'string' &&
    (name.startsWith(`${project}-`) || name.startsWith(`${project}_`))
  );
}

function ownership(resource, kind, runId, project) {
  const labels = labelsOf(resource, kind);
  const hasRun = Object.hasOwn(labels, LOCAL_LABEL);
  const hasProject = Object.hasOwn(labels, PROJECT_LABEL);
  const taskName = namedForTask(resource, kind, project);
  if (!hasRun && !hasProject && !taskName) return 'foreign';
  if (labels[LOCAL_LABEL] !== runId || labels[PROJECT_LABEL] !== project) {
    fail('inventory', 'owner-label-mismatch');
  }
  return 'owned';
}

function isRehearsalListener(line) {
  return PORTS.some((port) => new RegExp(`:${port}(?:\\s|$)`, 'u').test(line));
}

function stableListenerIdentities(lines) {
  if (!Array.isArray(lines))
    fail('listener-inventory', 'listener-output-invalid');
  return lines.map((line) => {
    if (typeof line !== 'string') {
      fail('listener-inventory', 'listener-output-invalid');
    }
    const fields = line.trim().split(/\s+/u);
    if (
      fields.length !== 5 ||
      !/^[A-Z]+$/u.test(fields[0]) ||
      !/^\d+$/u.test(fields[1]) ||
      !/^\d+$/u.test(fields[2]) ||
      fields[3].length === 0 ||
      fields[4].length === 0
    ) {
      fail('listener-inventory', 'listener-output-invalid');
    }
    return `${fields[0]} ${fields[3]} ${fields[4]}`;
  });
}

function foreignListenerIdentities(lines) {
  return stableListenerIdentities(lines)
    .filter((identity) => !isRehearsalListener(identity))
    .sort();
}

function stableContainer(value) {
  const state = value.State ?? {};
  const health = state.Health;
  return {
    Id: value.Id,
    Name: value.Name,
    Image: value.Image,
    Config: {
      Image: value.Config?.Image,
      Labels: value.Config?.Labels,
      Env: value.Config?.Env,
      Cmd: value.Config?.Cmd,
      Entrypoint: value.Config?.Entrypoint,
      WorkingDir: value.Config?.WorkingDir,
      User: value.Config?.User,
    },
    State: {
      Status: state.Status,
      Running: state.Running,
      Paused: state.Paused,
      Restarting: state.Restarting,
      OOMKilled: state.OOMKilled,
      Dead: state.Dead,
      ExitCode: state.ExitCode,
      Health: health ? { Status: health.Status } : null,
    },
    Mounts: value.Mounts,
    HostConfig: {
      NetworkMode: value.HostConfig?.NetworkMode,
      PortBindings: value.HostConfig?.PortBindings,
      RestartPolicy: value.HostConfig?.RestartPolicy,
    },
    NetworkSettings: {
      Ports: value.NetworkSettings?.Ports,
      Networks: value.NetworkSettings?.Networks,
    },
  };
}

function stableNetwork(value) {
  return {
    Id: value.Id,
    Name: value.Name,
    Driver: value.Driver,
    Scope: value.Scope,
    Internal: value.Internal,
    Attachable: value.Attachable,
    Ingress: value.Ingress,
    Labels: value.Labels,
    IPAM: value.IPAM,
    Options: value.Options,
    Containers: value.Containers,
  };
}

function stableVolume(value) {
  return {
    Name: value.Name,
    Driver: value.Driver,
    Mountpoint: value.Mountpoint,
    Labels: value.Labels,
    Options: value.Options,
    Scope: value.Scope,
  };
}

export function foreignInventory(inventory, runId, project) {
  const result = {
    containers: [],
    networks: [],
    volumes: [],
    images: inventory.images,
    listeners: foreignListenerIdentities(inventory.listeners),
  };
  for (const [kind, property] of [
    ['container', 'containers'],
    ['network', 'networks'],
    ['volume', 'volumes'],
  ]) {
    for (const resource of inventory[property]) {
      if (ownership(resource, kind, runId, project) === 'foreign') {
        result[property].push(resource);
      }
    }
  }
  return result;
}

export function assertTaskServiceSet(
  inventory,
  { runId, project, images, services, runningServices, stoppedServices },
) {
  const owners = [];
  for (const container of inventory.containers) {
    if (ownership(container, 'container', runId, project) === 'owned') {
      owners.push(container);
    }
  }
  const expected = [...services].sort();
  const observed = owners
    .map((container) => labelsOf(container, 'container')[SERVICE_LABEL])
    .sort();
  if (
    JSON.stringify(observed) !== JSON.stringify(expected) ||
    owners.length !== expected.length
  ) {
    fail('service-inventory', 'service-set-mismatch');
  }
  const imageByRole = new Map(images.map((image) => [image.role, image.id]));
  for (const container of owners) {
    const labels = labelsOf(container, 'container');
    const service = labels[SERVICE_LABEL];
    const role =
      service === 'restore-radicale'
        ? 'radicale'
        : service === 'restore-gateway'
          ? 'gateway'
          : service;
    if (
      !SERVICES.includes(service) ||
      container.Image !== imageByRole.get(role)
    ) {
      fail('service-inventory', 'service-image-mismatch');
    }
    if (!/^[0-9a-f]{64}$/u.test(container.Id ?? '')) {
      fail('service-inventory', 'container-id-invalid');
    }
  }
  for (const [service, status] of [
    ...(runningServices ?? []).map((service) => [service, 'running']),
    ...(stoppedServices ?? []).map((service) => [service, 'exited']),
  ]) {
    const container = owners.find(
      (resource) => labelsOf(resource, 'container')[SERVICE_LABEL] === service,
    );
    if (container?.State?.Status !== status) {
      fail('service-inventory', 'service-state-mismatch');
    }
  }
  return owners;
}

function sortByKey(items, key) {
  return [...items].sort((a, b) =>
    String(a?.[key]).localeCompare(String(b?.[key])),
  );
}

function parseLines(value) {
  return value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

function spawn(command, args, { cwd, env, input, timeout = 15 * 60_000 } = {}) {
  return spawnSync(command, args, {
    cwd,
    env,
    input,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    timeout,
    windowsHide: true,
  });
}

function gitValue(root, args, stage) {
  const result = spawn('git', ['-C', root, ...args]);
  if (result.error || result.status !== 0) fail(stage, 'git-check-failed');
  return (result.stdout ?? '').trim();
}

export function taskEnvironment(taskDir, dockerConfig, runId, project, paths) {
  const env = {
    PATH: `${paths.dockerBinDir}${path.delimiter}${required(process.env, 'PATH')}`,
    HOME: paths.homeDir,
    TMPDIR: paths.tmpDir,
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    DOCKER_CONFIG: dockerConfig,
    RUNNER_TEMP: taskDir,
    ELEMENT_ACCEPTANCE_LOCAL_RUN_ID: runId,
    COMPOSE_PROJECT_NAME: project,
    ELEMENT_ACCEPTANCE_SKIP_ELEMENT: 'true',
    MATRIX_CALENDAR_LOCAL_PREBUILT_REHEARSAL: 'true',
    MATRIX_CALENDAR_LOCAL_COMPOSE_OVERRIDE_FILE: paths.overrideFile,
    MATRIX_CALENDAR_LOCAL_COMPOSE_ENV_FILE: paths.bootstrapEnvFile,
    ELEMENT_ACCEPTANCE_COMPOSE_OVERRIDE_FILES: JSON.stringify([
      paths.overrideFile,
    ]),
    ELEMENT_ACCEPTANCE_RADICALE_IMAGE: paths.radicaleImage,
    MATRIX_CALENDAR_DEV_APPSERVICE_REGISTRATION: 'disabled',
    MATRIX_CALENDAR_DEV_SYNAPSE_PORT_MAPPING: '127.0.0.1:8008:8008',
    MATRIX_CALENDAR_DEV_RADICALE_PORT_MAPPING: '127.0.0.1:5232:5232',
    ROOM_CALENDAR_PRINCIPAL_MODE: 'bot-account',
    MATRIX_APPLICATION_SERVICE_USER_ID: '',
    MATRIX_CALENDAR_DEV_PASSWORD: randomBytes(24).toString('base64url'),
    ELEMENT_ACCEPTANCE_STAGE_FILE: paths.stageFile,
    ELEMENT_ACCEPTANCE_USERS_FILE: paths.usersFile,
    ELEMENT_ACCEPTANCE_SERVER_ENV_FILE: paths.envFile,
    ELEMENT_ACCEPTANCE_REMINDER_EVENT_FILE: paths.eventFile,
    ELEMENT_ACCEPTANCE_REMINDER_DELIVERY_FILE: paths.deliveryFile,
    ELEMENT_ACCEPTANCE_RESTORE_VOLUME_NAME: `${project}_radicale-restore`,
    OPERATOR_REHEARSAL_TASK_DIR: taskDir,
  };
  return env;
}

export function enableHostedSharedDockerRehearsal(
  taskEnvironment,
  workflowEnvironment,
  { taskDir, dockerBinDir, dockerAdapterPath, dockerExecutable },
) {
  if (
    workflowEnvironment[HOSTED_SHARED_DOCKER_SELECTION] !== 'true' ||
    !isSupportedGitHubHostedRunner(workflowEnvironment)
  ) {
    fail('preflight', 'hosted-runner-context-invalid');
  }

  const forbiddenEnvironmentKeys = [
    'DOCKER_HOST',
    'DOCKER_CONTEXT',
    'DOCKER_API_VERSION',
    'DOCKER_TLS_VERIFY',
    'DOCKER_CERT_PATH',
    'COMPOSE_FILE',
    'COMPOSE_PROFILES',
    'COMPOSE_ENV_FILES',
    'COMPOSE_PATH_SEPARATOR',
    HOSTED_SHARED_DOCKER_SELECTION,
  ];
  if (
    forbiddenEnvironmentKeys.some(
      (key) => taskEnvironment[key] !== undefined,
    ) ||
    typeof taskEnvironment.DOCKER_CONFIG !== 'string' ||
    !path
      .resolve(taskEnvironment.DOCKER_CONFIG)
      .startsWith(`${path.resolve(taskDir)}${path.sep}`) ||
    typeof taskEnvironment.PATH !== 'string' ||
    taskEnvironment.PATH.split(path.delimiter)[0] !== dockerBinDir ||
    !path.isAbsolute(dockerExecutable) ||
    path.resolve(dockerAdapterPath) !==
      path.join(path.resolve(dockerBinDir), 'docker')
  ) {
    fail('docker-api-preflight', 'hosted-docker-context-invalid');
  }

  try {
    const dockerConfigInfo = lstatSync(taskEnvironment.DOCKER_CONFIG);
    const adapterInfo = lstatSync(dockerAdapterPath);
    const dockerInfo = statSync(dockerExecutable);
    const adapterSource = readFileSync(dockerAdapterPath, 'utf8');
    if (
      dockerConfigInfo.isSymbolicLink() ||
      !dockerConfigInfo.isDirectory() ||
      dockerConfigInfo.uid !== process.getuid?.() ||
      (dockerConfigInfo.mode & 0o777) !== 0o700 ||
      adapterInfo.isSymbolicLink() ||
      !adapterInfo.isFile() ||
      adapterInfo.uid !== process.getuid?.() ||
      (adapterInfo.mode & 0o777) !== 0o700 ||
      !dockerInfo.isFile() ||
      (dockerInfo.mode & 0o111) === 0 ||
      !adapterSource.includes(
        `spawn(${JSON.stringify(dockerExecutable)}, args, {`,
      )
    ) {
      fail('docker-api-preflight', 'hosted-docker-context-invalid');
    }
  } catch {
    fail('docker-api-preflight', 'hosted-docker-context-invalid');
  }

  Object.assign(taskEnvironment, {
    [HOSTED_SHARED_DOCKER_SELECTION]: 'true',
    GITHUB_ACTIONS: 'true',
    RUNNER_ENVIRONMENT: 'github-hosted',
    RUNNER_OS: 'Linux',
    GITHUB_REPOSITORY: '0cwa/matrix-calendar-widget',
    GITHUB_REF: 'refs/heads/main',
  });
}

function writeInitialComposeEnv(file, project, restoreVolume, radicaleImage) {
  const values = {
    ELEMENT_ACCEPTANCE_BOT_ACCESS_TOKEN: 'local-preflight-token',
    ELEMENT_ACCEPTANCE_REMINDER_BOOTSTRAP_PASSWORD: 'local-preflight-secret',
    ELEMENT_ACCEPTANCE_REMINDER_APP_PASSWORD: 'local-preflight-secret',
    ELEMENT_ACCEPTANCE_REMINDER_DATABASE_URL:
      'postgresql://local:local@postgres:5432/matrix_calendar_test',
    ELEMENT_ACCEPTANCE_REMINDER_RESTORE_DATABASE_URL:
      'postgresql://local:local@postgres:5432/matrix_calendar_restored',
    ELEMENT_ACCEPTANCE_ROOM_BINDING: '[]',
    ELEMENT_ACCEPTANCE_RESTORE_VOLUME_NAME: restoreVolume,
    ELEMENT_ACCEPTANCE_RADICALE_IMAGE: radicaleImage,
    MATRIX_CALENDAR_DEV_APPSERVICE_REGISTRATION: 'disabled',
    MATRIX_CALENDAR_DEV_SYNAPSE_PORT_MAPPING: '127.0.0.1:8008:8008',
    MATRIX_CALENDAR_DEV_RADICALE_PORT_MAPPING: '127.0.0.1:5232:5232',
    MATRIX_APPLICATION_SERVICE_TOKEN: '',
    MATRIX_APPLICATION_SERVICE_USER_ID: '',
    ROOM_CALENDAR_PRINCIPAL_MODE: 'bot-account',
    COMPOSE_PROJECT_NAME: project,
  };
  writePrivate(
    file,
    `${Object.entries(values)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n')}\n`,
  );
}

export function parseStartupFailureMarker(stdout, childExitCode, formatter) {
  const safeExitCode =
    Number.isInteger(childExitCode) &&
    childExitCode >= 0 &&
    childExitCode <= 255
      ? childExitCode
      : 'unavailable';
  const unknown = { startupStage: 'unknown', childExitCode: safeExitCode };
  if (typeof stdout !== 'string' || typeof formatter !== 'function') {
    return unknown;
  }
  const markerLikeLines = stdout
    .split(/\r?\n/u)
    .filter((line) => /\b(?:stage|exit_code)=/u.test(line));
  if (markerLikeLines.length !== 1) return unknown;
  const match = /^stage=([a-z0-9-]+) exit_code=(0|[1-9]\d{0,2})$/u.exec(
    markerLikeLines[0],
  );
  if (!match || safeExitCode === 'unavailable' || safeExitCode === 0) {
    return unknown;
  }
  const exitCode = Number(match[2]);
  if (
    exitCode !== safeExitCode ||
    !SAFE_STARTUP_STAGES.has(match[1]) ||
    match[1] === 'unknown' ||
    exitCode > 255 ||
    formatter(match[1], exitCode) !== markerLikeLines[0]
  ) {
    return unknown;
  }
  return { startupStage: match[1], childExitCode: safeExitCode };
}

function runTask(
  stage,
  command,
  args,
  {
    cwd,
    env,
    taskDir,
    input,
    timeout,
    startupFailureFormatter,
    failureDiagnosticParser,
  } = {},
) {
  const result = spawn(command, args, { cwd, env, input, timeout });
  const logFile = path.join(
    taskDir,
    `${stage.replace(/[^a-z0-9-]/giu, '-')}.log`,
  );
  const output = `${result.stdout ?? ''}\n--- stderr ---\n${result.stderr ?? ''}`;
  writeFileSync(logFile, output, { mode: 0o600 });
  chmodSync(logFile, 0o600);
  if (result.error || result.status !== 0) {
    const diagnostic = startupFailureFormatter
      ? parseStartupFailureMarker(
          result.stdout ?? '',
          result.status,
          startupFailureFormatter,
        )
      : {};
    if (failureDiagnosticParser) {
      diagnostic.gatewayNetworkSmoke = failureDiagnosticParser(
        result.stdout ?? '',
        result.status,
      );
    }
    fail(
      stage,
      failureDiagnosticParser
        ? 'gateway-network-smoke-failed'
        : result.error
          ? 'command-unavailable'
          : `exit-${result.status ?? 'unknown'}`,
      diagnostic,
    );
  }
  return result.stdout ?? '';
}

function dockerJson(stage, args, context) {
  const raw = runTask(stage, 'docker', args, context);
  try {
    return JSON.parse(raw);
  } catch {
    fail(stage, 'docker-json-invalid');
  }
}

function verifyLockedImages(images, context, stage) {
  for (const image of images) {
    const actual = dockerJson(
      `${stage}-${image.role}`,
      ['image', 'inspect', image.ref],
      context,
    );
    validateLockedImageInspect(actual, image);
  }
}

function inspectMany(stage, ids, context) {
  if (ids.length === 0) return [];
  return dockerJson(stage, ['inspect', ...ids], context);
}

function captureInventory(stage, context) {
  const ids = {
    containers: parseLines(
      runTask(
        `${stage}-containers`,
        'docker',
        ['ps', '-aq', '--no-trunc'],
        context,
      ),
    ).sort(),
    images: [
      ...new Set(
        parseLines(
          runTask(
            `${stage}-image-ids`,
            'docker',
            ['image', 'ls', '--all', '--no-trunc', '-q'],
            context,
          ),
        ),
      ),
    ].sort(),
    networks: parseLines(
      runTask(
        `${stage}-network-ids`,
        'docker',
        ['network', 'ls', '-q'],
        context,
      ),
    ).sort(),
    volumes: parseLines(
      runTask(
        `${stage}-volume-names`,
        'docker',
        ['volume', 'ls', '-q'],
        context,
      ),
    ).sort(),
  };
  const inventory = {
    containers: sortByKey(
      inspectMany(`${stage}-container-inspect`, ids.containers, context),
      'Id',
    ).map(stableContainer),
    images: sortByKey(
      inspectMany(`${stage}-image-inspect`, ids.images, context),
      'Id',
    ),
    networks: sortByKey(
      inspectMany(`${stage}-network-inspect`, ids.networks, context),
      'Id',
    ).map(stableNetwork),
    volumes: sortByKey(
      inspectMany(`${stage}-volume-inspect`, ids.volumes, context),
      'Name',
    ).map(stableVolume),
    listeners: parseLines(
      runTask(`${stage}-listeners`, 'ss', ['-H', '-ltn'], context),
    ).sort(),
  };
  writeFileSync(
    path.join(context.taskDir, `${stage}-inventory.json`),
    `${JSON.stringify(inventory)}\n`,
    { mode: 0o600 },
  );
  return inventory;
}

export function assertNoCollision(inventory, runId, project) {
  for (const kind of ['container', 'network', 'volume']) {
    const records = inventory[`${kind}s`];
    for (const resource of records) {
      if (ownership(resource, kind, runId, project) === 'owned') {
        fail('baseline', 'project-collision');
      }
    }
  }
  if (inventory.listeners.some(isRehearsalListener)) {
    fail('baseline', 'required-port-in-use');
  }
}

export function compareForeign(before, after, runId, project) {
  const left = foreignInventory(before, runId, project);
  const right = foreignInventory(after, runId, project);
  if (JSON.stringify(left) !== JSON.stringify(right)) {
    fail('foreign-inventory', 'foreign-state-changed');
  }
}

function assertVolumes(
  inventory,
  runId,
  project,
  { pairedRestore = true } = {},
) {
  const owned = inventory.volumes.filter(
    (volume) => ownership(volume, 'volume', runId, project) === 'owned',
  );
  const byName = new Map(owned.map((volume) => [volume.Name, volume]));
  const expectedNames = [
    `${project}_synapse-data`,
    `${project}_radicale-data`,
    `${project}_postgres-data`,
    ...(pairedRestore ? [`${project}_radicale-restore`] : []),
  ].sort();
  if (
    JSON.stringify([...byName.keys()].sort()) !==
      JSON.stringify(expectedNames) ||
    owned.some((volume) => !VOLUMES.includes(volume.Labels?.[VOLUME_LABEL]))
  ) {
    fail('volume-inventory', 'volume-set-mismatch');
  }
  return owned;
}

function assertNetwork(inventory, runId, project) {
  const owned = inventory.networks.filter(
    (network) => ownership(network, 'network', runId, project) === 'owned',
  );
  if (
    owned.length !== 1 ||
    owned[0].Name !== `${project}_default` ||
    !/^[a-f0-9]{64}$/u.test(owned[0].Id ?? '')
  ) {
    fail('network-inventory', 'network-set-mismatch');
  }
  return owned[0];
}

function assertNoElement(inventory, runId, project) {
  const task = inventory.containers.filter(
    (container) =>
      ownership(container, 'container', runId, project) === 'owned',
  );
  if (
    task.some(
      (container) =>
        labelsOf(container, 'container')[SERVICE_LABEL] === 'element',
    )
  ) {
    fail('service-inventory', 'element-container-present');
  }
}

function assertNoOwnedResources(inventory, runId, project, kind, stage) {
  if (
    inventory[`${kind}s`].some(
      (resource) => ownership(resource, kind, runId, project) === 'owned',
    )
  ) {
    fail(stage, `owned-${kind}-remains`);
  }
}

export function listenerScopeDelta(current, baseline) {
  const currentCounts = new Map();
  const baselineCounts = new Map();
  for (const identity of foreignListenerIdentities(current)) {
    currentCounts.set(identity, (currentCounts.get(identity) ?? 0) + 1);
  }
  for (const identity of foreignListenerIdentities(baseline)) {
    baselineCounts.set(identity, (baselineCounts.get(identity) ?? 0) + 1);
  }
  const identities = new Set([
    ...currentCounts.keys(),
    ...baselineCounts.keys(),
  ]);
  let added = 0;
  let removed = 0;
  for (const identity of identities) {
    const difference =
      (currentCounts.get(identity) ?? 0) - (baselineCounts.get(identity) ?? 0);
    if (difference > 0) added += difference;
    if (difference < 0) removed -= difference;
  }
  return { added, removed };
}

function assertListenerScope(inventory, baseline, site, onDiagnostic) {
  onDiagnostic({ site, added: 'unavailable', removed: 'unavailable' });
  const delta = listenerScopeDelta(inventory.listeners, baseline.listeners);
  onDiagnostic({ site, ...delta });
  if (delta.added > 0 || delta.removed > 0) {
    fail('listener-inventory', 'foreign-listener-changed');
  }
}

export function addOperatorRehearsalProfileToComposeArgs(args) {
  if (!Array.isArray(args) || args[0] !== 'compose') return args;
  let index = 1;
  while (index < args.length) {
    const argument = args[index];
    if (argument === '--') return args;
    if (COMPOSE_VALUE_OPTIONS.has(argument)) {
      if (index + 1 >= args.length) return args;
      index += 2;
      continue;
    }
    if (
      [...COMPOSE_VALUE_OPTIONS].some(
        (option) =>
          option.startsWith('--') && argument.startsWith(`${option}=`),
      )
    ) {
      index += 1;
      continue;
    }
    if (argument.startsWith('-')) return args;
    if (argument !== 'config') return args;
    return [
      ...args.slice(0, index),
      '--profile',
      DISABLED_ELEMENT_PROFILE,
      ...args.slice(index),
    ];
  }
  return args;
}

function findNativeDockerExecutable(searchPath, stage = 'preflight') {
  for (const directory of searchPath.split(path.delimiter)) {
    if (!directory) continue;
    try {
      const candidate = realpathSync(path.join(directory, 'docker'));
      const info = statSync(candidate);
      if (!info.isFile() || (info.mode & 0o111) === 0) continue;
      const version = spawnSync(candidate, ['--version'], {
        encoding: 'utf8',
        maxBuffer: 1024,
        timeout: 5000,
        windowsHide: true,
      });
      if (
        !version.error &&
        version.status === 0 &&
        /^Docker version \d+\.\d+/u.test(version.stdout ?? '')
      ) {
        return candidate;
      }
    } catch {
      // Continue searching without exposing host paths.
    }
  }
  fail(stage, 'docker-cli-unavailable');
}

export function writeDockerAdapter(taskDir, dockerExecutable) {
  const dockerBinDir = path.join(taskDir, 'docker-bin');
  mkdirSync(dockerBinDir, { mode: 0o700 });
  chmodSync(dockerBinDir, 0o700);
  const dockerAdapterPath = path.join(dockerBinDir, 'docker');
  const helperPath = fileURLToPath(import.meta.url);
  const helperUrl = pathToFileURL(helperPath).href;
  const source = `#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { addOperatorRehearsalProfileToComposeArgs } from ${JSON.stringify(helperUrl)};
const args = addOperatorRehearsalProfileToComposeArgs(process.argv.slice(2));
const child = spawn(${JSON.stringify(dockerExecutable)}, args, {
  stdio: 'inherit',
  windowsHide: true,
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
child.on('error', () => {
  process.stderr.write('Docker command failed to start.\\n');
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = Number.isInteger(code) ? code : 1;
});
`;
  writePrivate(dockerAdapterPath, source);
  chmodSync(dockerAdapterPath, 0o700);
  return { dockerBinDir, dockerAdapterPath };
}

function composeArgs(sourceRoot, project, envFile, overrideFile) {
  return [
    'compose',
    '-p',
    project,
    '--env-file',
    envFile,
    '-f',
    path.join(sourceRoot, 'dev/compose.yaml'),
    '-f',
    path.join(sourceRoot, 'dev/element-acceptance.compose.yaml'),
    '-f',
    path.join(sourceRoot, 'dev/element-acceptance-reminder.compose.yaml'),
    '-f',
    path.join(sourceRoot, 'dev/element-acceptance-local-prebuilt.compose.yaml'),
    '-f',
    overrideFile,
  ];
}

export function handoffGeneratedComposeEnvironment(
  context,
  dockerEnv,
  { taskDir, bootstrapEnvFile, envFile, sourceRoot, project, overrideFile },
  validateGeneratedCompose,
) {
  if (
    context.env !== dockerEnv ||
    dockerEnv.MATRIX_CALENDAR_LOCAL_COMPOSE_ENV_FILE !== bootstrapEnvFile ||
    dockerEnv.ELEMENT_ACCEPTANCE_SERVER_ENV_FILE !== envFile
  ) {
    fail('private-files', 'compose-env-handoff-invalid');
  }

  privatePath(bootstrapEnvFile, taskDir);
  privatePath(envFile, taskDir);
  const generatedCompose = composeArgs(
    sourceRoot,
    project,
    envFile,
    overrideFile,
  );
  const generatedEnvironment = {
    ...dockerEnv,
    MATRIX_CALENDAR_LOCAL_COMPOSE_ENV_FILE: envFile,
  };
  validateGeneratedCompose(generatedCompose, generatedEnvironment);

  context.compose = generatedCompose;
  dockerEnv.MATRIX_CALENDAR_LOCAL_COMPOSE_ENV_FILE = envFile;
  rmSync(bootstrapEnvFile, { force: false });
  return generatedCompose;
}

function validateComposeModel(model, lock, runId, project) {
  const serviceNames = Object.keys(model?.services ?? {}).sort();
  const expected = [...SERVICES, 'element'].sort();
  if (JSON.stringify(serviceNames) !== JSON.stringify(expected)) {
    fail('compose-validation', 'service-model-mismatch');
  }
  const images = new Map(lock.images.map((image) => [image.role, image.ref]));
  for (const service of SERVICES) {
    const expectedRef =
      service === 'restore-radicale'
        ? images.get('radicale')
        : service === 'restore-gateway'
          ? images.get('gateway')
          : images.get(service);
    if (
      model.services[service]?.image !== expectedRef ||
      model.services[service]?.labels?.[LOCAL_LABEL] !== runId
    ) {
      fail('compose-validation', 'image-or-label-mismatch');
    }
  }
  if (
    !model.services.element?.profiles?.includes(DISABLED_ELEMENT_PROFILE) ||
    model.networks?.default?.labels?.[LOCAL_LABEL] !== runId ||
    model.volumes?.['synapse-data']?.labels?.[LOCAL_LABEL] !== runId ||
    model.volumes?.['radicale-data']?.labels?.[LOCAL_LABEL] !== runId ||
    model.volumes?.['postgres-data']?.labels?.[LOCAL_LABEL] !== runId ||
    model.volumes?.['reminder-restore-radicale-data']?.labels?.[LOCAL_LABEL] !==
      runId ||
    project !== `mcw-p0-${runId}`
  ) {
    fail('compose-validation', 'ownership-or-element-policy-mismatch');
  }
}

function validateComposeConfiguration({
  context,
  dockerEnv,
  sourceRoot,
  taskDir,
  compose,
  lock,
  runId,
  project,
}) {
  const modelText = runTask(
    'compose-config',
    'docker',
    [...compose, 'config', '--format', 'json'],
    context,
  );
  const validator = spawn(
    process.execPath,
    [path.join(sourceRoot, 'dev/validate-element-acceptance-compose.mjs')],
    {
      cwd: sourceRoot,
      env: dockerEnv,
      input: modelText,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    },
  );
  writeFileSync(
    path.join(taskDir, 'compose-validator.log'),
    `${validator.stdout ?? ''}\n${validator.stderr ?? ''}`,
    { mode: 0o600 },
  );
  if (validator.status !== 0 || validator.error) {
    fail('compose-validation', 'source-validator-failed');
  }
  validateComposeModel(JSON.parse(modelText), lock, runId, project);
}

function checkSummary(command, stage) {
  let result;
  try {
    result = JSON.parse(command);
  } catch {
    fail(stage, 'helper-summary-invalid');
  }
  return result;
}

function assertReminderResult(stdout, markerPath, expectedCount, stage) {
  const summary = checkSummary(stdout.trim(), stage);
  if (summary.status !== 'passed' || summary.markerCount !== expectedCount) {
    fail(stage, 'reminder-fixture-failed');
  }
  const markers = readJson(markerPath, stage);
  if (!Array.isArray(markers) || markers.length !== expectedCount) {
    fail(stage, 'reminder-marker-count-mismatch');
  }
  return expectedCount;
}

function assertInitialReminderState(markerPath) {
  const markers = readJson(markerPath, 'reminder-initial');
  if (!Array.isArray(markers) || markers.length !== 0) {
    fail('reminder-initial', 'initial-marker-count-invalid');
  }
  return 0;
}

function serviceContainer(context, service) {
  const args = [...context.compose, 'ps', '--all', '--format', 'json', service];
  const stdout = runTask(`compose-ps-${service}`, 'docker', args, context);
  return stdout;
}

function assertPrivateTaskTree(root, current) {
  privatePath(root, current.runnerTemp, true);
  for (const name of readdirSync(root)) {
    const child = path.join(root, name);
    const info = lstatSync(child);
    const mode = info.mode & 0o777;
    const adapterExecutable =
      info.isFile() && child === current.dockerAdapterPath && mode === 0o700;
    if (
      info.isSymbolicLink() ||
      info.uid !== process.getuid?.() ||
      (mode !== (info.isDirectory() ? 0o700 : 0o600) && !adapterExecutable)
    ) {
      fail('private-files', 'task-entry-permissions-invalid');
    }
    if (info.isDirectory()) {
      assertPrivateTaskTree(child, current);
    } else if (!info.isFile()) {
      fail('private-files', 'task-file-permissions-invalid');
    }
  }
}

function imageEvidence(lock) {
  return lock.images.map((image) => ({
    role: image.role,
    ref: image.ref,
    id: image.id,
    digests: image.repoDigests ?? [image.buildxManifestDigest],
    platform: `${image.os}/${image.architecture}`,
  }));
}

function validateOwnedResourceForCleanup(resource, kind, runId, project) {
  if (ownership(resource, kind, runId, project) !== 'owned') {
    fail('owned-cleanup', 'resource-owner-changed');
  }
  if (kind === 'container') {
    const service = labelsOf(resource, kind)[SERVICE_LABEL];
    if (!SERVICES.includes(service)) fail('owned-cleanup', 'unknown-service');
  }
}

export function planOwnedCleanup(
  inventory,
  runId,
  project,
  images,
  { allowPartial = false } = {},
) {
  const containers = inventory.containers.filter(
    (resource) => ownership(resource, 'container', runId, project) === 'owned',
  );
  const services = containers.map(
    (resource) => labelsOf(resource, 'container')[SERVICE_LABEL],
  );
  if (
    allowPartial
      ? services.length > 8
      : services.length < 5 ||
        services.length > 7 ||
        new Set(services).size !== services.length ||
        !['synapse', 'radicale', 'gateway', 'widget', 'postgres'].every(
          (service) => services.includes(service),
        ) ||
        services.includes('restore-radicale') !==
          services.includes('restore-gateway')
  ) {
    throw new RehearsalFailure('owned-cleanup', 'cleanup-service-set-invalid');
  }
  const owners = assertTaskServiceSet(inventory, {
    runId,
    project,
    images,
    services,
  });
  let volumes;
  let network;
  if (allowPartial) {
    const expectedVolumes = new Map([
      [`${project}_synapse-data`, 'synapse-data'],
      [`${project}_radicale-data`, 'radicale-data'],
      [`${project}_postgres-data`, 'postgres-data'],
      [`${project}_radicale-restore`, 'reminder-restore-radicale-data'],
    ]);
    volumes = inventory.volumes.filter(
      (volume) => ownership(volume, 'volume', runId, project) === 'owned',
    );
    if (
      volumes.some(
        (volume) =>
          expectedVolumes.get(volume.Name) !== volume.Labels?.[VOLUME_LABEL],
      )
    ) {
      fail('owned-cleanup', 'cleanup-volume-set-invalid');
    }
    const ownedNetworks = inventory.networks.filter(
      (resource) => ownership(resource, 'network', runId, project) === 'owned',
    );
    if (
      ownedNetworks.length > 1 ||
      ownedNetworks.some(
        (resource) =>
          resource.Name !== `${project}_default` ||
          !/^[a-f0-9]{64}$/u.test(resource.Id ?? ''),
      )
    ) {
      fail('owned-cleanup', 'cleanup-network-set-invalid');
    }
    network = ownedNetworks[0];
  } else {
    volumes = assertVolumes(inventory, runId, project);
    network = assertNetwork(inventory, runId, project);
  }
  assertNoElement(inventory, runId, project);
  return { containers: owners, volumes, network, partial: allowPartial };
}

function currentIdentity(resource, kind, runId, project) {
  validateOwnedResourceForCleanup(resource, kind, runId, project);
  if (
    kind === 'container' &&
    !/^sha256:[0-9a-f]{64}$/u.test(resource.Image ?? '')
  ) {
    fail('owned-cleanup', 'container-image-invalid');
  }
}

function assertInventoryEqual(actual, expected, stage) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(stage, 'inventory-postcondition-failed');
  }
}

function removeOwnedResources({
  plan,
  context,
  baseline,
  runId,
  project,
  prefix,
}) {
  const stage = `${prefix}-cleanup`;
  const plannedContainers = new Map(
    plan.containers.map((value) => [value.Id, value]),
  );
  for (const containerId of [...plannedContainers.keys()].sort()) {
    const fresh = dockerJson(
      `${prefix}-inspect-container`,
      ['inspect', containerId],
      context,
    );
    if (fresh.length !== 1) fail(stage, 'container-changed-before-cleanup');
    const stable = stableContainer(fresh[0]);
    currentIdentity(stable, 'container', runId, project);
    assertInventoryEqual(stable, plannedContainers.get(containerId), stage);
    if (fresh[0].State?.Running === true) {
      runTask(
        `${prefix}-stop-container`,
        'docker',
        ['container', 'stop', '--time', '30', containerId],
        context,
      );
    }
    runTask(
      `${prefix}-remove-container`,
      'docker',
      ['container', 'rm', containerId],
      context,
    );
  }

  const afterContainers = captureInventory(
    `${prefix}-after-containers`,
    context,
  );
  compareForeign(baseline, afterContainers, runId, project);
  assertNoOwnedResources(afterContainers, runId, project, 'container', stage);
  const observedVolumes = afterContainers.volumes.filter(
    (volume) => ownership(volume, 'volume', runId, project) === 'owned',
  );
  assertInventoryEqual(observedVolumes, plan.volumes, stage);
  const mountedVolumeNames = new Set(
    afterContainers.containers.flatMap((container) =>
      (container.Mounts ?? []).map((mount) => mount.Name).filter(Boolean),
    ),
  );
  for (const volume of plan.volumes) {
    const fresh = dockerJson(
      `${prefix}-inspect-volume`,
      ['volume', 'inspect', volume.Name],
      context,
    );
    if (fresh.length !== 1) fail(stage, 'volume-changed-before-cleanup');
    assertInventoryEqual(stableVolume(fresh[0]), volume, stage);
    currentIdentity(volume, 'volume', runId, project);
    if (mountedVolumeNames.has(volume.Name))
      fail(stage, 'owned-volume-still-mounted');
    runTask(
      `${prefix}-remove-volume`,
      'docker',
      ['volume', 'rm', volume.Name],
      context,
    );
  }

  const afterVolumes = captureInventory(`${prefix}-after-volumes`, context);
  compareForeign(baseline, afterVolumes, runId, project);
  assertNoOwnedResources(afterVolumes, runId, project, 'volume', stage);
  const observedNetworks = afterVolumes.networks.filter(
    (network) => ownership(network, 'network', runId, project) === 'owned',
  );
  assertInventoryEqual(
    observedNetworks,
    plan.network ? [plan.network] : [],
    stage,
  );
  if (plan.network) {
    const fresh = dockerJson(
      `${prefix}-inspect-network`,
      ['network', 'inspect', plan.network.Id],
      context,
    );
    if (fresh.length !== 1) fail(stage, 'network-changed-before-cleanup');
    assertInventoryEqual(stableNetwork(fresh[0]), plan.network, stage);
    currentIdentity(plan.network, 'network', runId, project);
    if (Object.keys(plan.network.Containers ?? {}).length !== 0) {
      fail(stage, 'owned-network-still-attached');
    }
    runTask(
      `${prefix}-remove-network`,
      'docker',
      ['network', 'rm', plan.network.Id],
      context,
    );
  }

  const finalInventory = captureInventory(`${prefix}-final-inventory`, context);
  compareForeign(baseline, finalInventory, runId, project);
  assertInventoryEqual(finalInventory, baseline, `${prefix}-final-inventory`);
  for (const kind of ['container', 'network', 'volume']) {
    assertNoOwnedResources(finalInventory, runId, project, kind, stage);
  }
  return finalInventory;
}

function assertStageSummary(pathName, expected) {
  const records = readFileSync(pathName, 'utf8')
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const record = records.find((entry) => entry?.phase === expected);
  if (!record || record.status !== 'passed') {
    fail('fixture-setup', 'fixture-stage-not-passed');
  }
}

function safeReceipt({
  sourceSha,
  sourceTree,
  workflowSha,
  lock,
  apiCount,
  markerCounts,
  inventoryCounts,
}) {
  return {
    schema_version: 1,
    result: 'pending-cleanup',
    phase: 'hosted-docker-operator-v5',
    failed_phase: null,
    failure_code: null,
    source_sha: sourceSha,
    source_tree: sourceTree,
    workflow_sha: workflowSha,
    platform: 'linux/amd64',
    image_lock: imageEvidence(lock),
    api_cases: apiCount,
    reminder_marker_counts: markerCounts,
    primary_services: 5,
    paired_restore_services: 2,
    checks: {
      source_binding: true,
      image_identity: true,
      api_authorization_and_crud: true,
      reminder_restart: true,
      paired_restore: true,
      owned_cleanup: false,
    },
    foreign_inventory: 'unchanged',
    inventory_counts: inventoryCounts,
  };
}

export function formatSuccessSummary(receipt) {
  if (
    receipt?.result !== 'passed' ||
    receipt.cleanup_verified !== true ||
    !/^[0-9a-f]{40}$/u.test(receipt.source_sha ?? '')
  ) {
    throw new RehearsalFailure('receipt-publish', 'cleanup-not-verified');
  }
  return [
    '## Hosted Docker operator rehearsal',
    '',
    `- Result: passed for source ${receipt.source_sha} on linux/amd64.`,
    '- Phase: complete; failure phase: none.',
    '- Source-built images: 3 verified IDs; fixture images: 2 immutable digests locked.',
    '- API authorization and CRUD cases: 12/12 passed.',
    '- Reminder delivery marker counts: 0 → 1 → 2 → 3.',
    '- Paired Radicale/PostgreSQL restore: passed.',
    '- Exact owned-resource cleanup: passed; foreign inventory unchanged.',
    '- Element browser service: disabled for this hosted Docker rehearsal.',
    '',
  ].join('\n');
}

export function formatFailureSummary(sourceSha, phase, cleanup) {
  const safeSource = /^[0-9a-f]{40}$/u.test(sourceSha ?? '')
    ? sourceSha
    : 'unavailable';
  const safePhase = SAFE_PHASES.has(phase) ? phase : 'runner';
  const safeCleanup = ['verified', 'unverified', 'not-run'].includes(cleanup)
    ? cleanup
    : 'unverified';
  return [
    '## Hosted Docker operator rehearsal',
    '',
    '- Result: failed.',
    `- Source SHA: ${safeSource}.`,
    `- Failed phase: ${safePhase}.`,
    '- Failure code: gate-failed.',
    `- Owned cleanup: ${safeCleanup}.`,
    '- Success receipt: not published.',
    '',
  ].join('\n');
}

export function formatFailureDiagnostic({
  sourceSha,
  workflowSha,
  runId,
  attempt,
  phase,
  failureClass,
  operation,
  startupStage,
  childExitCode,
  sourceImageIds,
  cleanupStatus,
  cleanupAttempted,
  failureCode,
  serviceInventory,
  serviceRunId,
  serviceProject,
  serviceImages,
  listenerScope,
  gatewayNetworkSmoke,
}) {
  const safe = (value, pattern) =>
    typeof value === 'string' && pattern.test(value) ? value : 'unavailable';
  const attempted = cleanupAttempted === true;
  let safeCleanup = ['pending', 'verified', 'unverified', 'not-run'].includes(
    cleanupStatus,
  )
    ? cleanupStatus
    : 'unverified';
  if (
    (safeCleanup === 'verified' && !attempted) ||
    (['not-run', 'pending'].includes(safeCleanup) && attempted)
  )
    safeCleanup = 'unverified';
  const safeImageIds =
    Array.isArray(sourceImageIds) &&
    sourceImageIds.length === 3 &&
    sourceImageIds.every(
      (id) => typeof id === 'string' && /^sha256:[0-9a-f]{64}$/u.test(id),
    ) &&
    new Set(sourceImageIds).size === 3
      ? [...sourceImageIds]
      : [];
  const cleanupVerified = safeCleanup === 'verified' && attempted;
  const safeOperation = SAFE_FAILURE_OPERATIONS.has(operation)
    ? operation
    : 'unknown';
  const safeStartupStage = SAFE_STARTUP_STAGES.has(startupStage)
    ? startupStage
    : 'unknown';
  const safeChildExitCode =
    Number.isInteger(childExitCode) &&
    childExitCode >= 0 &&
    childExitCode <= 255
      ? childExitCode
      : 'unavailable';
  const safeFailureCheck = FAILURE_CHECK_BY_CODE.get(failureCode) ?? 'unknown';
  const safeListenerScope = {
    callsite: ['primary', 'paired-restore'].includes(listenerScope?.site)
      ? listenerScope.site
      : 'not-applicable',
    added_count:
      Number.isSafeInteger(listenerScope?.added) && listenerScope.added >= 0
        ? listenerScope.added
        : 'unavailable',
    removed_count:
      Number.isSafeInteger(listenerScope?.removed) && listenerScope.removed >= 0
        ? listenerScope.removed
        : 'unavailable',
  };
  const safeGatewayNetworkSmoke =
    projectGatewayNetworkSmoke(gatewayNetworkSmoke);

  return {
    schema_version: 6,
    result: 'failed',
    phase: 'hosted-docker-operator-v5',
    failed_phase: SAFE_PHASES.has(phase) ? phase : 'runner',
    failure_class: ['gate-failed', 'runner-error'].includes(failureClass)
      ? failureClass
      : 'unknown',
    failure_operation: safeOperation,
    failure_check: safeFailureCheck,
    service_roles: projectPrimaryServiceInventory(serviceInventory, {
      runId: serviceRunId,
      project: serviceProject,
      images: serviceImages,
    }),
    startup_stage: safeStartupStage,
    child_exit_code: safeChildExitCode,
    source_sha: safe(sourceSha, /^[0-9a-f]{40}$/u),
    workflow_sha: safe(workflowSha, /^[0-9a-f]{40}$/u),
    run_id: safe(runId, /^\d{1,20}$/u),
    attempt: safe(attempt, /^\d{1,4}$/u),
    source_image_ids: safeImageIds,
    listener_scope: safeListenerScope,
    gateway_network_smoke: safeGatewayNetworkSmoke,
    cleanup_status: safeCleanup,
    cleanup_attempted: attempted,
    owned_cleanup_verified: cleanupVerified,
    foreign_inventory_unchanged: cleanupVerified,
  };
}

function unavailableServiceRole() {
  return {
    present: 'unavailable',
    state: 'unavailable',
    exit_code: 'unavailable',
    image_matches: 'unavailable',
    health: 'unavailable',
  };
}

function unavailablePrimaryServiceInventory() {
  return Object.fromEntries(
    PRIMARY_SERVICE_ROLES.map((role) => [role, unavailableServiceRole()]),
  );
}

function projectPrimaryServiceInventory(inventory, { runId, project, images }) {
  if (
    !inventory ||
    !Array.isArray(inventory.containers) ||
    typeof runId !== 'string' ||
    typeof project !== 'string' ||
    !Array.isArray(images)
  ) {
    return unavailablePrimaryServiceInventory();
  }

  const imageByRole = new Map(
    images
      .filter(
        (image) =>
          PRIMARY_SERVICE_ROLES.includes(image?.role) &&
          typeof image?.id === 'string' &&
          /^sha256:[0-9a-f]{64}$/u.test(image.id),
      )
      .map((image) => [image.role, image.id]),
  );
  const projected = {};
  for (const role of PRIMARY_SERVICE_ROLES) {
    const owned = inventory.containers.filter((container) => {
      const labels = labelsOf(container, 'container');
      return (
        labels[LOCAL_LABEL] === runId &&
        labels[PROJECT_LABEL] === project &&
        labels[SERVICE_LABEL] === role
      );
    });
    if (owned.length === 0) {
      projected[role] = {
        present: false,
        state: 'unavailable',
        exit_code: 'unavailable',
        image_matches: 'unavailable',
        health: 'unavailable',
      };
      continue;
    }
    if (owned.length !== 1) {
      projected[role] = {
        present: true,
        state: 'unknown',
        exit_code: 'unavailable',
        image_matches: 'unavailable',
        health: 'unknown',
      };
      continue;
    }

    const [container] = owned;
    const status = container?.State?.Status;
    const exitCode = container?.State?.ExitCode;
    const health = container?.State?.Health;
    const expectedImage = imageByRole.get(role);
    const actualImage = container?.Image;
    projected[role] = {
      present: true,
      state: SAFE_CONTAINER_STATES.has(status) ? status : 'unknown',
      exit_code:
        Number.isInteger(exitCode) && exitCode >= 0 && exitCode <= 255
          ? exitCode
          : 'unavailable',
      image_matches:
        expectedImage &&
        typeof actualImage === 'string' &&
        /^sha256:[0-9a-f]{64}$/u.test(actualImage)
          ? actualImage === expectedImage
          : 'unavailable',
      health:
        health === null
          ? 'none'
          : SAFE_HEALTH_STATES.has(health?.Status)
            ? health.Status
            : 'unknown',
    };
  }
  return projected;
}

export function writeFailureDiagnostic(runnerTemp, fields, update = false) {
  try {
    const root = path.resolve(runnerTemp);
    const file = path.join(root, FAILURE_DIAGNOSTIC_FILE);
    const diagnostic = formatFailureDiagnostic(fields);
    if (update) {
      privatePath(file, root);
      const previous = readJson(file, 'receipt-publish');
      if (
        ![
          'run_id',
          'attempt',
          'source_sha',
          'workflow_sha',
          'failed_phase',
          'failure_class',
          'failure_operation',
          'failure_check',
          'startup_stage',
          'child_exit_code',
        ].every((key) => previous?.[key] === diagnostic[key]) ||
        JSON.stringify(previous?.service_roles) !==
          JSON.stringify(diagnostic.service_roles) ||
        JSON.stringify(previous?.listener_scope) !==
          JSON.stringify(diagnostic.listener_scope) ||
        JSON.stringify(previous?.gateway_network_smoke) !==
          JSON.stringify(diagnostic.gateway_network_smoke)
      ) {
        fail('receipt-publish', 'failure-diagnostic-identity-mismatch');
      }
    }
    writeFileSync(file, `${JSON.stringify(diagnostic)}\n`, {
      mode: 0o600,
      flag: update ? 'w' : 'wx',
    });
    chmodSync(file, 0o600);
    privatePath(file, root);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  let stage = 'preflight';
  let taskDir;
  let receiptPath;
  const failureIdentity = {};
  let diagnosticRoot;
  let diagnosticInventory;
  let diagnosticRunId;
  let diagnosticProject;
  let diagnosticImages;
  let listenerScopeDiagnostic;
  let cleanupState;
  let cleanupVerified = false;
  const env = process.env;
  try {
    if (env.OPERATOR_REHEARSAL_ENABLED !== 'true') {
      fail('preflight', 'operator-rehearsal-not-enabled');
    }
    if (
      env[HOSTED_SHARED_DOCKER_SELECTION] !== 'true' ||
      !isSupportedGitHubHostedRunner(env)
    ) {
      fail('preflight', 'hosted-runner-context-invalid');
    }
    const sourceRoot = path.resolve(
      required(env, 'GITHUB_WORKSPACE'),
      'source',
    );
    const toolingRoot = path.resolve(
      required(env, 'GITHUB_WORKSPACE'),
      'tooling',
    );
    const archiveRoot = path.resolve(required(env, 'ARCHIVE_ROOT'));
    const sourceSha = requireSha(required(env, 'RELEASE_SOURCE_SHA'));
    const workflowSha = requireSha(required(env, 'RELEASE_WORKFLOW_SHA'));
    const runId = required(env, 'RELEASE_RUN_ID');
    const attempt = required(env, 'RELEASE_RUN_ATTEMPT');
    if (!/^\d{1,20}$/u.test(runId) || !/^\d{1,4}$/u.test(attempt)) {
      fail('preflight', 'run-identity-invalid');
    }
    Object.assign(failureIdentity, { sourceSha, workflowSha, runId, attempt });
    const id = createHash('sha256')
      .update(`${runId}:${attempt}`)
      .digest('hex')
      .slice(0, 16);
    const project = `mcw-p0-${id}`;
    diagnosticRunId = id;
    diagnosticProject = project;
    const runnerTemp = path.resolve(required(env, 'RUNNER_TEMP'));
    const runnerInfo = lstatSync(runnerTemp);
    if (
      runnerInfo.isSymbolicLink() ||
      !runnerInfo.isDirectory() ||
      runnerInfo.uid !== process.getuid?.() ||
      realpathSync(runnerTemp) !== runnerTemp
    ) {
      fail('preflight', 'runner-temp-invalid');
    }
    diagnosticRoot = runnerTemp;
    const checkoutSha = gitValue(
      sourceRoot,
      ['rev-parse', 'HEAD'],
      'source-binding',
    );
    const checkoutTree = gitValue(
      sourceRoot,
      ['rev-parse', 'HEAD^{tree}'],
      'source-binding',
    );
    const trustedSha = gitValue(
      toolingRoot,
      ['rev-parse', 'HEAD'],
      'source-binding',
    );
    if (
      checkoutSha !== sourceSha ||
      trustedSha !== workflowSha ||
      !/^[0-9a-f]{40}$/u.test(checkoutTree ?? '')
    ) {
      fail('source-binding', 'checkout-sha-mismatch');
    }
    const dispatchSha = required(env, 'RELEASE_DISPATCH_SHA');
    requireSha(dispatchSha);
    const sourceIsDispatchAncestor = spawn('git', [
      '-C',
      sourceRoot,
      'merge-base',
      '--is-ancestor',
      sourceSha,
      dispatchSha,
    ]);
    if (
      sourceIsDispatchAncestor.error ||
      sourceIsDispatchAncestor.status !== 0
    ) {
      fail('source-binding', 'source-not-dispatch-ancestor');
    }
    for (const helper of [
      'dev/up.sh',
      'dev/element-acceptance-setup.mjs',
      'dev/element-acceptance-overrides.mjs',
      'dev/element-acceptance-api-probe.mjs',
      'dev/local-reminder-fixture.mjs',
      'dev/element-acceptance-reminder-restore.mjs',
      'dev/element-acceptance-local-prebuilt.compose.yaml',
      'dev/validate-element-acceptance-compose.mjs',
      'dev/synapse-startup-diagnostic.mjs',
    ]) {
      const helperPath = path.join(sourceRoot, helper);
      if (
        lstatSync(helperPath).isSymbolicLink() ||
        !lstatSync(helperPath).isFile()
      ) {
        fail('source-binding', 'source-helper-invalid');
      }
    }

    const startupDiagnosticModule = await import(
      pathToFileURL(path.join(sourceRoot, 'dev/synapse-startup-diagnostic.mjs'))
        .href
    );
    if (
      typeof startupDiagnosticModule.formatStartupStageFailure !== 'function'
    ) {
      fail('source-binding', 'source-helper-invalid');
    }
    const startupFailureFormatter =
      startupDiagnosticModule.formatStartupStageFailure;

    stage = 'image-lock';
    const manifest = readJson(path.join(archiveRoot, 'manifest.json'), stage);
    const sourceImages = exactSourceImages(
      manifest,
      sourceSha,
      checkoutTree,
      runId,
      attempt,
    );
    failureIdentity.sourceImageIds = sourceImages.map((image) => image.id);
    const toolContext = { cwd: sourceRoot };
    taskDir = path.join(runnerTemp, `mcw-p0-${id}`);
    mkdirSync(taskDir, { mode: 0o700 });
    chmodSync(taskDir, 0o700);
    privatePath(taskDir, runnerTemp, true);
    const dockerConfig = path.join(taskDir, 'docker-config');
    mkdirSync(dockerConfig, { mode: 0o700 });
    chmodSync(dockerConfig, 0o700);
    const homeDir = path.join(taskDir, 'home');
    const tmpDir = path.join(taskDir, 'tmp');
    for (const directory of [homeDir, tmpDir]) {
      mkdirSync(directory, { mode: 0o700 });
      chmodSync(directory, 0o700);
    }
    const dockerExecutable = findNativeDockerExecutable(
      required(process.env, 'PATH'),
      'docker-api-preflight',
    );
    const dockerAdapter = writeDockerAdapter(taskDir, dockerExecutable);
    const paths = {
      runnerTemp,
      taskDir,
      dockerConfig,
      homeDir,
      tmpDir,
      ...dockerAdapter,
      dockerExecutable,
      overrideFile: path.join(taskDir, 'compose.override.yaml'),
      bootstrapEnvFile: path.join(taskDir, 'compose.bootstrap.env'),
      envFile: path.join(taskDir, 'compose.env'),
      stageFile: path.join(taskDir, 'phases.jsonl'),
      usersFile: path.join(taskDir, 'users.json'),
      eventFile: path.join(taskDir, 'reminder-events.json'),
      deliveryFile: path.join(taskDir, 'reminder-deliveries.json'),
      radicaleImage: sourceImages.find((image) => image.role === 'radicale')
        .ref,
    };
    writePrivate(paths.stageFile, '');
    writePrivate(paths.eventFile, '[]\n');
    writePrivate(paths.deliveryFile, '[]\n');

    const dockerEnv = taskEnvironment(
      taskDir,
      dockerConfig,
      id,
      project,
      paths,
    );
    const context = { cwd: sourceRoot, env: dockerEnv, taskDir };
    stage = 'docker-api-preflight';
    if (
      dockerEnv.DOCKER_HOST !== undefined ||
      dockerEnv.DOCKER_CONTEXT !== undefined ||
      dockerEnv.DOCKER_API_VERSION !== undefined
    ) {
      fail(stage, 'docker-endpoint-override-present');
    }
    const apiVersion = runTask(
      'docker-api-version',
      'docker',
      ['version', '--format', '{{.Server.APIVersion}}'],
      context,
    ).trim();
    if (!/^\d+\.\d+$/u.test(apiVersion))
      fail(stage, 'docker-api-version-invalid');
    const dockerVersion = runTask(
      'docker-cli-version',
      'docker',
      ['version', '--format', '{{.Client.Version}}'],
      context,
    ).trim();
    if (!dockerVersion) fail(stage, 'docker-cli-unavailable');
    runTask(
      'docker-compose-version',
      'docker',
      ['compose', 'version', '--short'],
      context,
    );

    stage = 'source-image-inspect';
    for (const image of sourceImages) {
      const actual = dockerJson(
        `inspect-${image.role}`,
        ['image', 'inspect', image.ref],
        context,
      );
      validateImageInspect(actual, image);
    }

    stage = 'fixture-image-pull';
    const fixtureImages = [];
    for (const fixture of FIXTURES) {
      runTask(
        `pull-${fixture.role}`,
        'docker',
        ['pull', '--platform', 'linux/amd64', fixture.tag],
        context,
      );
      const actual = dockerJson(
        `inspect-${fixture.role}`,
        ['image', 'inspect', fixture.tag],
        context,
      );
      const locked = fixtureIdentity(actual, fixture.tag);
      const repeated = dockerJson(
        `inspect-pinned-${fixture.role}`,
        ['image', 'inspect', locked.ref],
        context,
      );
      validateLockedImageInspect(repeated, locked);
      fixtureImages.push({ role: fixture.role, ...locked });
    }
    const images = [...sourceImages, ...fixtureImages];
    diagnosticImages = images;
    if (
      images.length !== 5 ||
      new Set(images.map((image) => image.id)).size !== 5
    ) {
      fail('image-lock', 'five-image-lock-invalid');
    }
    const lock = { schema_version: 1, platform: 'linux/amd64', images };
    const lockPath = path.join(taskDir, 'image-lock.json');
    writePrivate(lockPath, `${JSON.stringify(lock)}\n`);

    stage = 'compose-inputs';
    const override = makeComposeOverride(lock, id, project);
    writePrivate(paths.overrideFile, override);
    writeInitialComposeEnv(
      paths.bootstrapEnvFile,
      project,
      `${project}_radicale-restore`,
      paths.radicaleImage,
    );
    const privateFiles = [
      paths.stageFile,
      paths.eventFile,
      paths.deliveryFile,
      paths.overrideFile,
      paths.bootstrapEnvFile,
      lockPath,
    ];
    for (const file of privateFiles) privatePath(file, taskDir);
    let compose = composeArgs(
      sourceRoot,
      project,
      paths.bootstrapEnvFile,
      paths.overrideFile,
    );
    context.compose = compose;
    validateComposeConfiguration({
      context,
      dockerEnv,
      sourceRoot,
      taskDir,
      compose,
      lock,
      runId: id,
      project,
    });

    stage = 'inventory-baseline';
    const baseline = captureInventory('baseline', context);
    assertNoCollision(baseline, id, project);
    cleanupState = { context, baseline, runId: id, project, images };
    writeFileSync(
      path.join(taskDir, 'baseline-foreign.json'),
      `${JSON.stringify(foreignInventory(baseline, id, project))}\n`,
      { mode: 0o600 },
    );

    enableHostedSharedDockerRehearsal(dockerEnv, env, {
      taskDir,
      dockerBinDir: dockerAdapter.dockerBinDir,
      dockerAdapterPath: dockerAdapter.dockerAdapterPath,
      dockerExecutable,
    });

    stage = 'start-calendaring-services';
    verifyLockedImages(images, context, 'pre-start-image-lock');
    runTask(
      'start-synapse-radicale',
      'bash',
      [path.join(sourceRoot, 'dev/up.sh')],
      {
        ...context,
        timeout: 20 * 60_000,
        startupFailureFormatter,
      },
    );
    stage = 'fixture-setup';
    runTask(
      'setup-fixture',
      process.execPath,
      [path.join(sourceRoot, 'dev/element-acceptance-setup.mjs'), 'setup'],
      context,
    );
    assertStageSummary(paths.stageFile, 'runtime-ready');
    privatePath(paths.usersFile, taskDir);
    privatePath(paths.envFile, taskDir);

    stage = 'compose-validation';
    compose = handoffGeneratedComposeEnvironment(
      context,
      dockerEnv,
      {
        taskDir,
        bootstrapEnvFile: paths.bootstrapEnvFile,
        envFile: paths.envFile,
        sourceRoot,
        project,
        overrideFile: paths.overrideFile,
      },
      (generatedCompose, generatedEnvironment) => {
        validateComposeConfiguration({
          context,
          dockerEnv: generatedEnvironment,
          sourceRoot,
          taskDir,
          compose: generatedCompose,
          lock,
          runId: id,
          project,
        });
      },
    );

    stage = 'start-primary-services';
    const up = [
      ...compose,
      'up',
      '--pull',
      'never',
      '--no-build',
      '-d',
      'gateway',
      'widget',
      'postgres',
    ];
    runTask('start-gateway-widget-postgres', 'docker', up, {
      ...context,
      timeout: 15 * 60_000,
    });
    const readiness = runTask(
      'wait-element-free',
      process.execPath,
      [path.join(sourceRoot, 'dev/element-acceptance-setup.mjs'), 'wait-local'],
      context,
    );
    if (!readiness.includes('Element-free acceptance services are ready.'))
      fail(stage, 'element-free-readiness-missing');
    let active = captureInventory('primary', context);
    diagnosticInventory = active;
    assertTaskServiceSet(active, {
      runId: id,
      project,
      images,
      services: ['synapse', 'radicale', 'gateway', 'widget', 'postgres'],
      runningServices: ['synapse', 'radicale', 'gateway', 'widget', 'postgres'],
    });
    assertVolumes(active, id, project, { pairedRestore: false });
    assertNetwork(active, id, project);
    assertNoElement(active, id, project);
    assertListenerScope(active, baseline, 'primary', (value) => {
      listenerScopeDiagnostic = value;
    });

    stage = 'api-route-smoke';
    const fixtureEnv = {
      ...dockerEnv,
      ELEMENT_ACCEPTANCE_SOURCE_SHA: sourceSha,
    };
    const runFixtureTask = (
      taskStage,
      command,
      args,
      extraEnv = {},
      options = {},
    ) =>
      runTask(taskStage, command, args, {
        ...context,
        ...options,
        env: { ...fixtureEnv, ...extraEnv },
      });
    const composePs = serviceContainer(
      { ...context, env: fixtureEnv, compose },
      'gateway',
    );
    if (!composePs.trim()) fail(stage, 'compose-ps-empty');
    runTask(
      'exec-synapse-smoke',
      'docker',
      [
        ...compose,
        'exec',
        '-T',
        'synapse',
        'python',
        '-c',
        'import urllib.request; urllib.request.urlopen("http://127.0.0.1:8008/_matrix/client/versions", timeout=5).read()',
      ],
      context,
    );
    runTask(
      'compose-run-gateway-smoke',
      'docker',
      gatewayNetworkSmokeArgs(compose, id, project),
      {
        ...context,
        failureDiagnosticParser: parseGatewayNetworkSmokeFailure,
      },
    );
    const widgetStatus = runTask(
      'widget-http-smoke',
      'curl',
      [
        '--silent',
        '--show-error',
        '--fail',
        '--output',
        '/dev/null',
        '--write-out',
        '%{http_code}',
        '--max-time',
        '10',
        'http://127.0.0.1:8080/',
      ],
      context,
    ).trim();
    if (widgetStatus !== '200') fail(stage, 'widget-http-status-invalid');
    const apiSummary = checkSummary(
      runFixtureTask('api-crud-probe', process.execPath, [
        path.join(sourceRoot, 'dev/element-acceptance-api-probe.mjs'),
      ]).trim(),
      'api-crud-probe',
    );
    if (
      apiSummary.status !== 'passed' ||
      API_STAGES.some((name) => apiSummary.stages?.[name] !== 'passed')
    )
      fail('api-crud-probe', 'api-stage-failed');

    stage = 'reminder-initial';
    let markers = assertInitialReminderState(paths.eventFile);
    runFixtureTask('prepare-reminder-room', process.execPath, [
      path.join(sourceRoot, 'dev/element-acceptance-setup.mjs'),
      'reminder-room',
    ]);
    runFixtureTask('enable-reminder-runtime', process.execPath, [
      path.join(sourceRoot, 'dev/element-acceptance-reminder-restore.mjs'),
      'enable',
    ]);
    markers = assertReminderResult(
      runFixtureTask(
        'reminder-initial-fixture',
        process.execPath,
        [path.join(sourceRoot, 'dev/local-reminder-fixture.mjs')],
        {
          ELEMENT_ACCEPTANCE_REMINDER_FIXTURE: '1',
          ELEMENT_ACCEPTANCE_REMINDER_FLOW: 'initial',
        },
      ),
      paths.eventFile,
      1,
      'reminder-initial-fixture',
    );
    runFixtureTask('verify-initial-reminder-config', process.execPath, [
      path.join(sourceRoot, 'dev/element-acceptance-reminder-restore.mjs'),
      'verify-configuration',
    ]);
    runFixtureTask('snapshot-initial-reminder-state', process.execPath, [
      path.join(sourceRoot, 'dev/element-acceptance-reminder-restore.mjs'),
      'snapshot',
    ]);

    stage = 'reminder-restart';
    runFixtureTask('restart-reminder-gateway', process.execPath, [
      path.join(sourceRoot, 'dev/element-acceptance-reminder-restore.mjs'),
      'restart',
    ]);
    markers = assertReminderResult(
      runFixtureTask(
        'reminder-restart-fixture',
        process.execPath,
        [path.join(sourceRoot, 'dev/local-reminder-fixture.mjs')],
        {
          ELEMENT_ACCEPTANCE_REMINDER_FIXTURE: '1',
          ELEMENT_ACCEPTANCE_REMINDER_FLOW: 'restart',
        },
      ),
      paths.eventFile,
      2,
      'reminder-restart-fixture',
    );
    runFixtureTask('verify-restart-reminder-config', process.execPath, [
      path.join(sourceRoot, 'dev/element-acceptance-reminder-restore.mjs'),
      'verify-configuration',
    ]);
    runFixtureTask('verify-restart-delivery', process.execPath, [
      path.join(sourceRoot, 'dev/element-acceptance-reminder-restore.mjs'),
      'verify-restart',
    ]);
    runFixtureTask('snapshot-restart-reminder-state', process.execPath, [
      path.join(sourceRoot, 'dev/element-acceptance-reminder-restore.mjs'),
      'snapshot',
    ]);

    stage = 'paired-store-restore';
    verifyLockedImages(images, context, 'pre-restore-image-lock');
    runFixtureTask(
      'restore-paired-stores',
      process.execPath,
      [
        path.join(sourceRoot, 'dev/element-acceptance-reminder-restore.mjs'),
        'restore',
      ],
      {},
      { timeout: 20 * 60_000 },
    );
    active = captureInventory('paired-restore', context);
    diagnosticInventory = active;
    assertTaskServiceSet(active, {
      runId: id,
      project,
      images,
      services: [...SERVICES],
      runningServices: [
        'synapse',
        'widget',
        'postgres',
        'restore-radicale',
        'restore-gateway',
      ],
      stoppedServices: ['radicale', 'gateway'],
    });
    assertVolumes(active, id, project);
    assertNetwork(active, id, project);
    assertNoElement(active, id, project);
    assertListenerScope(active, baseline, 'paired-restore', (value) => {
      listenerScopeDiagnostic = value;
    });
    markers = assertReminderResult(
      runFixtureTask(
        'reminder-restore-fixture',
        process.execPath,
        [path.join(sourceRoot, 'dev/local-reminder-fixture.mjs')],
        {
          ELEMENT_ACCEPTANCE_REMINDER_FIXTURE: '1',
          ELEMENT_ACCEPTANCE_REMINDER_FLOW: 'restore',
        },
      ),
      paths.eventFile,
      3,
      'reminder-restore-fixture',
    );
    runFixtureTask('verify-paired-restore-delivery', process.execPath, [
      path.join(sourceRoot, 'dev/element-acceptance-reminder-restore.mjs'),
      'verify-restore',
    ]);
    if (markers !== 3) fail(stage, 'restored-delivery-count-invalid');

    stage = 'owned-cleanup-preflight';
    const current = captureInventory('pre-cleanup', context);
    diagnosticInventory = current;
    compareForeign(baseline, current, id, project);
    assertNoElement(current, id, project);
    assertPrivateTaskTree(taskDir, {
      runnerTemp,
      dockerAdapterPath: paths.dockerAdapterPath,
    });
    const cleanupPlan = planOwnedCleanup(current, id, project, images);
    const receipt = safeReceipt({
      sourceSha,
      sourceTree: checkoutTree,
      workflowSha,
      lock,
      apiCount: API_STAGES.length,
      markerCounts: [0, 1, 2, 3],
      inventoryCounts: {
        containers_before: baseline.containers.length,
        images_before: baseline.images.length,
        networks_before: baseline.networks.length,
        volumes_before: baseline.volumes.length,
      },
    });
    receiptPath = path.join(runnerTemp, `.mcw-p0-${id}.receipt.json`);
    writePrivate(
      receiptPath,
      `${JSON.stringify({ ...receipt, cleanup_verified: false })}\n`,
    );
    privatePath(receiptPath, runnerTemp);

    stage = 'owned-cleanup';
    removeOwnedResources({
      plan: cleanupPlan,
      context,
      baseline,
      runId: id,
      project,
      prefix: 'success',
    });
    cleanupVerified = true;

    stage = 'task-files-cleanup';
    assertPrivateTaskTree(taskDir, {
      runnerTemp,
      dockerAdapterPath: paths.dockerAdapterPath,
    });
    if (
      realpathSync(taskDir) !== taskDir ||
      !taskDir.startsWith(`${runnerTemp}${path.sep}`)
    ) {
      fail(stage, 'task-directory-path-invalid');
    }
    rmSync(taskDir, { recursive: true, force: false });
    if (lstatSync(taskDir, { throwIfNoEntry: false }))
      fail(stage, 'task-directory-remains');
    const successReceipt = {
      ...receipt,
      result: 'passed',
      cleanup_verified: true,
      checks: { ...receipt.checks, owned_cleanup: true },
    };
    writeFileSync(receiptPath, `${JSON.stringify(successReceipt)}\n`, {
      mode: 0o600,
      flag: 'w',
    });
    chmodSync(receiptPath, 0o600);
    privatePath(receiptPath, runnerTemp);
    if (!env.GITHUB_STEP_SUMMARY)
      fail('receipt-publish', 'summary-path-missing');
    writeFileSync(
      env.GITHUB_STEP_SUMMARY,
      formatSuccessSummary(successReceipt),
      {
        flag: 'a',
        mode: 0o600,
      },
    );
    process.stdout.write(
      'Hosted Docker operator rehearsal passed; owned cleanup was verified.\n',
    );
  } catch (error) {
    const failedPhase = error instanceof RehearsalFailure ? error.stage : stage;
    let cleanupStatus = cleanupVerified ? 'verified' : 'not-run';
    let cleanupAttempted = cleanupVerified;
    const failure = {
      ...failureIdentity,
      phase: failedPhase,
      failureClass:
        error instanceof RehearsalFailure ? 'gate-failed' : 'runner-error',
      operation:
        error instanceof RehearsalFailure
          ? failureOperationForStage(error.stage)
          : 'runner-error',
      failureCode: error instanceof RehearsalFailure ? error.code : 'unknown',
      startupStage:
        error instanceof RehearsalFailure ? error.startupStage : 'unknown',
      childExitCode:
        error instanceof RehearsalFailure ? error.childExitCode : 'unavailable',
      gatewayNetworkSmoke:
        error instanceof RehearsalFailure
          ? error.gatewayNetworkSmoke
          : undefined,
      serviceInventory: diagnosticInventory,
      serviceRunId: diagnosticRunId,
      serviceProject: diagnosticProject,
      serviceImages: diagnosticImages,
      listenerScope:
        failedPhase === 'listener-inventory'
          ? listenerScopeDiagnostic
          : undefined,
    };
    if (cleanupState && !cleanupVerified) cleanupStatus = 'pending';
    const diagnosticWritten = writeFailureDiagnostic(diagnosticRoot, {
      ...failure,
      cleanupStatus,
      cleanupAttempted,
    });
    if (cleanupState && !cleanupVerified) {
      cleanupStatus = 'unverified';
      cleanupAttempted = true;
      try {
        const { context, baseline, runId, project, images } = cleanupState;
        stage = 'failure-cleanup';
        const current = captureInventory('failure-cleanup', context);
        compareForeign(baseline, current, runId, project);
        const plan = planOwnedCleanup(current, runId, project, images, {
          allowPartial: true,
        });
        removeOwnedResources({
          plan,
          context,
          baseline,
          runId,
          project,
          prefix: 'failure',
        });
        cleanupStatus = 'verified';
      } catch {
        cleanupStatus = 'unverified';
      }
    }
    if (diagnosticWritten) {
      writeFailureDiagnostic(
        diagnosticRoot,
        { ...failure, cleanupStatus, cleanupAttempted },
        true,
      );
    }
    if (env.GITHUB_STEP_SUMMARY) {
      try {
        writeFileSync(
          env.GITHUB_STEP_SUMMARY,
          formatFailureSummary(
            failureIdentity.sourceSha,
            failedPhase,
            cleanupStatus,
          ),
          { flag: 'a', mode: 0o600 },
        );
      } catch {
        // The fixed stderr line below remains safe if the runner summary is unavailable.
      }
    }
    process.stderr.write(
      `Hosted Docker operator rehearsal failed at phase ${SAFE_PHASES.has(failedPhase) ? failedPhase : 'runner'}; owned cleanup ${cleanupStatus}.\n`,
    );
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
