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
import { release as osRelease } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  API_PROBE_FAILURE_CODES,
  API_PROBE_STAGES,
} from '../dev/element-acceptance-api-probe.mjs';

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
// Config.Volumes on the pinned widget-server and Radicale base images. Keep
// their unused scratch paths temporary so Compose does not create anonymous
// volumes that appear as foreign resources in the shared Docker inventory.
// Mode 1777 allows the images' non-root users to write without UID guesses;
// size caps bound memory use. Startup and write access remain runtime gates.
export const HOSTED_INHERITED_IMAGE_TMPFS = Object.freeze({
  widget: Object.freeze([
    '/tmp:mode=1777,size=64m',
    '/var/cache/nginx:mode=1777,size=64m',
  ]),
  radicale: Object.freeze(['/var/lib/radicale:mode=1777,size=16m']),
  'restore-radicale': Object.freeze(['/var/lib/radicale:mode=1777,size=16m']),
});
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
const API_STAGES = API_PROBE_STAGES;
const API_FAILURE_CODES = new Set(API_PROBE_FAILURE_CODES);
export const HOSTED_REMINDER_FIXTURE_FAILURE_PHASES = Object.freeze([
  'fixture',
  'openid',
  'room-permissions',
  'gateway-authorization',
  'prior-deliveries',
  'event-create',
  'event-readback',
  'alarm-options',
  'reminder-config-write',
  'reminder-config-readback',
  'reminder-delivery',
  'marker-write',
]);
const REMINDER_FIXTURE_FAILURE_PHASES = new Set(
  HOSTED_REMINDER_FIXTURE_FAILURE_PHASES,
);
const REMINDER_FIXTURE_FLOWS = new Set(['initial', 'restart', 'restore']);
const REMINDER_FIXTURE_CLEANUP_OUTCOMES = new Set([
  'not-attempted',
  'confirmed-absent',
  'unresolved',
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
  ['api-stage-failed', 'api-contract'],
  ['api-probe-process-failed', 'api-contract'],
  ['helper-summary-invalid', 'api-contract'],
  ['service-set-mismatch', 'service-set'],
  ['service-image-mismatch', 'image'],
  ['container-id-invalid', 'container-identity'],
  ['service-state-mismatch', 'state'],
  ['element-container-present', 'element'],
  ['volume-set-mismatch', 'volume'],
  ['network-set-mismatch', 'network'],
  ['foreign-listener-changed', 'listener'],
  ['foreign-state-changed', 'foreign-inventory'],
  ['inherited-image-volume-mismatch', 'volume'],
  ['reminder-fixture-failed', 'reminder-fixture'],
  ['reminder-fixture-summary-invalid', 'reminder-fixture'],
  ['reminder-marker-count-mismatch', 'reminder-fixture'],
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
const FOREIGN_INVENTORY_CATEGORIES = Object.freeze([
  'containers',
  'networks',
  'volumes',
  'images',
  'listeners',
]);
const FOREIGN_INVENTORY_CHECKPOINTS = new Set([
  'owned-cleanup-preflight',
  'success-after-containers',
  'success-after-volumes',
  'success-final-inventory',
  'failure-cleanup-preflight',
  'failure-after-containers',
  'failure-after-volumes',
  'failure-final-inventory',
  'unknown',
]);
const CLEANUP_FOREIGN_CHECKPOINTS = Object.freeze({
  success: Object.freeze({
    afterContainers: 'success-after-containers',
    afterVolumes: 'success-after-volumes',
    finalInventory: 'success-final-inventory',
  }),
  failure: Object.freeze({
    afterContainers: 'failure-after-containers',
    afterVolumes: 'failure-after-volumes',
    finalInventory: 'failure-final-inventory',
  }),
});
const FAILURE_CLEANUP_FOREIGN_CHECKPOINTS = new Set([
  'failure-cleanup-preflight',
  'failure-after-containers',
  'failure-after-volumes',
  'failure-final-inventory',
]);
const FOREIGN_INVENTORY_CHANGE_KINDS = new Set([
  'unchanged',
  'identity-set-cardinality',
  'ordering-only',
  'descriptor-metadata',
  'unknown',
]);
const MAX_FOREIGN_VOLUME_CHANGE_COUNT = 32;
const FOREIGN_VOLUME_ASSOCIATIONS = new Set([
  'synapse-data',
  'synapse-other-mount',
  'radicale-data',
  'radicale-other-mount',
  'postgres-data',
  'postgres-other-mount',
  'restore-radicale-data',
  'restore-radicale-other-mount',
  'gateway-other-mount',
  'widget-other-mount',
  'restore-gateway-other-mount',
  'multiple',
  'unattached',
  'unknown',
  'not-applicable',
]);
const FOREIGN_VOLUME_MOUNT_CLASSES = new Map([
  ['synapse|/data', 'synapse-data'],
  ['radicale|/data', 'radicale-data'],
  ['restore-radicale|/data', 'restore-radicale-data'],
  ['postgres|/var/lib/postgresql/data', 'postgres-data'],
]);
const FOREIGN_VOLUME_OTHER_MOUNT_CLASSES = new Map(
  SERVICES.map((service) => [service, `${service}-other-mount`]),
);

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

function unavailableApiCrudProbe(markerStatus = 'not-applicable', exitCode) {
  return {
    marker_status: markerStatus,
    process_exit_code: networkSmokeProcessExitCode(exitCode),
    status: 'unavailable',
    first_failed_stage: 'unavailable',
    failure_code: 'unavailable',
    first_failure_http_status: null,
    owned_cleanup_status: 'unavailable',
  };
}

export function parseApiCrudProbeFailure(stdout, processExitCode) {
  const diagnostic = unavailableApiCrudProbe('absent', processExitCode);
  if (typeof stdout !== 'string' || stdout.trim() === '') return diagnostic;

  let summary;
  try {
    summary = JSON.parse(stdout.trim());
  } catch {
    return { ...diagnostic, marker_status: 'invalid' };
  }
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) {
    return { ...diagnostic, marker_status: 'invalid' };
  }
  const hasFailureCode = Object.hasOwn(summary, 'failureCode');
  const hasFailureHttpStatus = Object.hasOwn(summary, 'failureHttpStatus');
  const keys = Object.keys(summary).sort();
  const expectedKeys =
    summary.status === 'failed'
      ? ['failureCode', 'failureHttpStatus', 'stages', 'status']
      : ['stages', 'status'];
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index]) ||
    !['passed', 'failed'].includes(summary.status) ||
    !summary.stages ||
    typeof summary.stages !== 'object' ||
    Array.isArray(summary.stages)
  ) {
    return { ...diagnostic, marker_status: 'invalid' };
  }

  const stageNames = Object.keys(summary.stages).sort();
  const expectedStageNames = [...API_STAGES].sort();
  if (
    stageNames.length !== API_STAGES.length ||
    stageNames.some((stage, index) => stage !== expectedStageNames[index]) ||
    API_STAGES.some(
      (stage) =>
        !['passed', 'failed', 'skipped'].includes(summary.stages[stage]),
    )
  ) {
    return { ...diagnostic, marker_status: 'invalid' };
  }

  const firstFailedStage =
    API_STAGES.find((stage) => summary.stages[stage] === 'failed') ??
    'unavailable';
  const failureCode = hasFailureCode ? summary.failureCode : 'unavailable';
  if (
    (summary.status === 'failed' && firstFailedStage === 'unavailable') ||
    (summary.status === 'passed' &&
      (firstFailedStage !== 'unavailable' ||
        API_STAGES.some((stage) => summary.stages[stage] !== 'passed') ||
        hasFailureCode ||
        hasFailureHttpStatus)) ||
    (summary.status === 'failed' &&
      (!hasFailureCode || !hasFailureHttpStatus)) ||
    (hasFailureCode && typeof failureCode !== 'string') ||
    (failureCode !== 'unavailable' && !API_FAILURE_CODES.has(failureCode)) ||
    (hasFailureHttpStatus &&
      summary.failureHttpStatus !== null &&
      (!Number.isInteger(summary.failureHttpStatus) ||
        summary.failureHttpStatus < 100 ||
        summary.failureHttpStatus > 599))
  ) {
    return { ...diagnostic, marker_status: 'invalid' };
  }

  return {
    ...diagnostic,
    marker_status: 'captured',
    status: summary.status,
    first_failed_stage: firstFailedStage,
    failure_code: failureCode,
    first_failure_http_status: hasFailureHttpStatus
      ? summary.failureHttpStatus
      : null,
    owned_cleanup_status: summary.stages['owned-cleanup'],
  };
}

export function assertApiCrudProbePassed(stdout) {
  const apiCrudProbe = parseApiCrudProbeFailure(stdout, 0);
  if (apiCrudProbe.marker_status !== 'captured') {
    fail('api-crud-probe', 'helper-summary-invalid', { apiCrudProbe });
  }
  if (apiCrudProbe.status !== 'passed') {
    fail('api-crud-probe', 'api-stage-failed', { apiCrudProbe });
  }
  return apiCrudProbe;
}

function projectApiCrudProbe(diagnostic) {
  const markerStatus = [
    'not-applicable',
    'absent',
    'invalid',
    'captured',
  ].includes(diagnostic?.marker_status)
    ? diagnostic.marker_status
    : 'not-applicable';
  const projected = unavailableApiCrudProbe(
    markerStatus,
    markerStatus === 'not-applicable'
      ? undefined
      : diagnostic?.process_exit_code,
  );
  if (markerStatus !== 'captured') return projected;

  const status = ['passed', 'failed'].includes(diagnostic?.status)
    ? diagnostic.status
    : undefined;
  const firstFailedStage = API_STAGES.includes(diagnostic?.first_failed_stage)
    ? diagnostic.first_failed_stage
    : diagnostic?.first_failed_stage === 'unavailable'
      ? 'unavailable'
      : undefined;
  const failureCode = API_FAILURE_CODES.has(diagnostic?.failure_code)
    ? diagnostic.failure_code
    : diagnostic?.failure_code === 'unavailable'
      ? 'unavailable'
      : undefined;
  const failureHttpStatus =
    diagnostic?.first_failure_http_status === null ||
    (Number.isInteger(diagnostic?.first_failure_http_status) &&
      diagnostic.first_failure_http_status >= 100 &&
      diagnostic.first_failure_http_status <= 599)
      ? diagnostic.first_failure_http_status
      : undefined;
  const ownedCleanupStatus = ['passed', 'failed', 'skipped'].includes(
    diagnostic?.owned_cleanup_status,
  )
    ? diagnostic.owned_cleanup_status
    : undefined;
  if (
    !status ||
    !firstFailedStage ||
    !failureCode ||
    failureHttpStatus === undefined ||
    !ownedCleanupStatus ||
    (status === 'failed' && firstFailedStage === 'unavailable') ||
    (status === 'passed' &&
      (firstFailedStage !== 'unavailable' || failureCode !== 'unavailable'))
  ) {
    return { ...projected, marker_status: 'invalid' };
  }
  return {
    ...projected,
    status,
    first_failed_stage: firstFailedStage,
    failure_code: failureCode,
    first_failure_http_status: failureHttpStatus,
    owned_cleanup_status: ownedCleanupStatus,
  };
}

function unknownReminderFixture(markerStatus = 'not-applicable') {
  return {
    marker_status: ['not-applicable', 'absent', 'invalid'].includes(
      markerStatus,
    )
      ? markerStatus
      : 'invalid',
    status: 'unknown',
    failure_phase: 'unknown',
  };
}

function isReminderFixtureRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactReminderFixtureKeys(value, expectedKeys) {
  if (!isReminderFixtureRecord(value)) return false;
  const actualKeys = Object.keys(value).sort();
  const sortedExpected = [...expectedKeys].sort();
  return (
    actualKeys.length === sortedExpected.length &&
    actualKeys.every((key, index) => key === sortedExpected[index])
  );
}

function validReminderFixtureCleanup(cleanup, status) {
  if (
    !hasExactReminderFixtureKeys(cleanup, ['reminderConfiguration', 'event']) ||
    !REMINDER_FIXTURE_CLEANUP_OUTCOMES.has(cleanup.reminderConfiguration) ||
    !REMINDER_FIXTURE_CLEANUP_OUTCOMES.has(cleanup.event)
  ) {
    return false;
  }
  return (
    status !== 'passed' ||
    (cleanup.reminderConfiguration === 'not-attempted' &&
      cleanup.event === 'not-attempted')
  );
}

export function parseReminderFixtureOutcome(stdout) {
  if (typeof stdout !== 'string' || stdout.trim() === '') {
    return unknownReminderFixture('absent');
  }

  const lines = stdout.split(/\r?\n/u);
  if (lines.at(-1) === '') lines.pop();
  if (lines.length !== 1 || lines[0] === '') {
    return unknownReminderFixture('invalid');
  }

  let summary;
  try {
    summary = JSON.parse(lines[0]);
  } catch {
    return unknownReminderFixture('invalid');
  }
  if (
    !isReminderFixtureRecord(summary) ||
    summary.phase !== 'local-reminder-fixture' ||
    !REMINDER_FIXTURE_FLOWS.has(summary.flow)
  ) {
    return unknownReminderFixture('invalid');
  }

  if (summary.status === 'passed') {
    if (
      !hasExactReminderFixtureKeys(summary, [
        'phase',
        'flow',
        'status',
        'markerWritten',
        'cleanup',
        'markerCount',
      ]) ||
      summary.markerWritten !== true ||
      !Number.isInteger(summary.markerCount) ||
      summary.markerCount < 1 ||
      summary.markerCount > 3 ||
      !validReminderFixtureCleanup(summary.cleanup, summary.status)
    ) {
      return unknownReminderFixture('invalid');
    }
    return {
      marker_status: 'captured',
      status: 'passed',
      failure_phase: 'none',
    };
  }

  if (
    summary.status === 'failed' &&
    hasExactReminderFixtureKeys(summary, [
      'phase',
      'flow',
      'status',
      'failurePhase',
      'markerWritten',
      'cleanup',
    ]) &&
    REMINDER_FIXTURE_FAILURE_PHASES.has(summary.failurePhase) &&
    summary.markerWritten === false &&
    validReminderFixtureCleanup(summary.cleanup, summary.status)
  ) {
    return {
      marker_status: 'captured',
      status: 'failed',
      failure_phase: summary.failurePhase,
    };
  }

  return unknownReminderFixture('invalid');
}

function projectReminderFixtureOutcome(diagnostic) {
  const markerStatus = [
    'not-applicable',
    'absent',
    'invalid',
    'captured',
  ].includes(diagnostic?.marker_status)
    ? diagnostic.marker_status
    : 'invalid';
  if (markerStatus !== 'captured') {
    return unknownReminderFixture(markerStatus);
  }
  if (diagnostic?.status === 'passed' && diagnostic.failure_phase === 'none') {
    return {
      marker_status: 'captured',
      status: 'passed',
      failure_phase: 'none',
    };
  }
  if (
    diagnostic?.status === 'failed' &&
    REMINDER_FIXTURE_FAILURE_PHASES.has(diagnostic.failure_phase)
  ) {
    return {
      marker_status: 'captured',
      status: 'failed',
      failure_phase: diagnostic.failure_phase,
    };
  }
  return unknownReminderFixture('invalid');
}

const FIXTURES = Object.freeze([
  {
    role: 'synapse',
    tag: 'ghcr.io/element-hq/synapse:v1.161.0',
  },
  { role: 'postgres', tag: 'postgres:16.15-alpine3.23' },
]);

const LOCAL_PROFILE = 'local-microsandbox';
const LOCAL_BASE_COMMIT = '80c6baaa7401abff65e2c033a762c5328ddb7284';
const LOCAL_ACCEPTED_HOSTED_LINEAGE =
  '289358712e4e58c452b65d18a03c0a442721245c';
const LOCAL_SOURCE_COMMIT = '99d4c9f9f36aa0b0861a13499a7f7cd512c56920';
const LOCAL_SOURCE_TREE = '97022a9d2351655d2aae0a50a44a14bd81daacc9';
const LOCAL_RELEASE_MANIFEST_SHA256 =
  'd0315e465e33e38f093fe4de2faf0e5eb0f57afc6fec7e0c2aa325a727d9ae49';
const LOCAL_RELEASE_RUN_ID = '38913010664';
const LOCAL_RELEASE_ATTEMPT = '1';
const LOCAL_PROBE_CHECKS = Object.freeze([
  'cgroup_v2',
  'namespaces',
  'overlay_mount_write_unmount',
  'writable_docker_data',
]);
const LOCAL_PROFILE_PATH_KEYS = Object.freeze([
  'runner_temp',
  'source_root',
  'tooling_root',
  'source_archive',
  'tooling_archive',
  'vm_probe_receipt',
  'docker_socket',
  'docker_config_root',
]);

export const LOCAL_MICROSANDBOX_MANIFEST_SCHEMA = Object.freeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Matrix Calendar Widget local microsandbox rehearsal manifest v1',
  type: 'object',
  additionalProperties: false,
  required: [
    'schema_version',
    'profile',
    'vm_proof',
    'paths',
    'source',
    'tooling',
    'release_archive',
    'fixture_lock',
    'synthetic_identity',
  ],
  properties: {
    schema_version: { const: 1 },
    profile: { const: LOCAL_PROFILE },
    vm_proof: {
      type: 'object',
      additionalProperties: false,
      required: [
        'provider',
        'instance_id',
        'guest_kernel',
        'probe_receipt_sha256',
        'network_enabled',
        'host_mounts',
        'host_docker_socket_forwarded',
        'host_credentials_mounted',
        'docker_endpoint',
      ],
      properties: {
        provider: { const: 'microsandbox' },
        instance_id: { type: 'string', minLength: 1, maxLength: 128 },
        guest_kernel: { type: 'string', minLength: 1, maxLength: 128 },
        probe_receipt_sha256: {
          type: 'string',
          pattern: '^[0-9a-f]{64}$',
        },
        network_enabled: { const: true },
        host_mounts: { type: 'array', maxItems: 0 },
        host_docker_socket_forwarded: { const: false },
        host_credentials_mounted: { const: false },
        docker_endpoint: { type: 'string', minLength: 1, maxLength: 4096 },
      },
    },
    paths: {
      type: 'object',
      additionalProperties: false,
      required: LOCAL_PROFILE_PATH_KEYS,
      properties: Object.fromEntries(
        LOCAL_PROFILE_PATH_KEYS.map((key) => [key, { type: 'string' }]),
      ),
    },
    source: {
      type: 'object',
      additionalProperties: false,
      required: ['commit', 'tree', 'git_archive_sha256'],
      properties: {
        commit: { const: LOCAL_SOURCE_COMMIT },
        tree: { const: LOCAL_SOURCE_TREE },
        git_archive_sha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
      },
    },
    tooling: {
      type: 'object',
      additionalProperties: false,
      required: [
        'commit',
        'tree',
        'git_archive_sha256',
        'helper_sha256',
        'base_commit',
        'accepted_hosted_lineage',
      ],
      properties: {
        commit: { type: 'string', pattern: '^[0-9a-f]{40}$' },
        tree: { type: 'string', pattern: '^[0-9a-f]{40}$' },
        git_archive_sha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
        helper_sha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
        base_commit: { const: LOCAL_BASE_COMMIT },
        accepted_hosted_lineage: {
          const: LOCAL_ACCEPTED_HOSTED_LINEAGE,
        },
      },
    },
    release_archive: {
      type: 'object',
      additionalProperties: false,
      required: ['root', 'manifest_sha256', 'release_run_id', 'attempt'],
      properties: {
        root: { type: 'string' },
        manifest_sha256: { const: LOCAL_RELEASE_MANIFEST_SHA256 },
        release_run_id: { const: LOCAL_RELEASE_RUN_ID },
        attempt: { const: 1 },
      },
    },
    fixture_lock: {
      type: 'object',
      additionalProperties: false,
      required: ['schema_version', 'platform', 'images'],
      properties: {
        schema_version: { const: 1 },
        platform: { const: 'linux/amd64' },
        images: {
          type: 'array',
          minItems: 2,
          maxItems: 2,
          items: {
            type: 'object',
            additionalProperties: false,
            required: [
              'role',
              'tag',
              'repo_digest',
              'image_id',
              'platform',
              'metadata_proof_sha256',
            ],
            properties: {
              role: { enum: ['synapse', 'postgres'] },
              tag: { type: 'string' },
              repo_digest: { type: 'string' },
              image_id: { type: 'string', pattern: '^sha256:[0-9a-f]{64}$' },
              platform: { const: 'linux/amd64' },
              metadata_proof_sha256: {
                type: 'string',
                pattern: '^[0-9a-f]{64}$',
              },
            },
          },
        },
      },
    },
    synthetic_identity: {
      type: 'object',
      additionalProperties: false,
      required: ['mode', 'credential_root', 'host_credentials_mounted'],
      properties: {
        mode: { const: 'synthetic' },
        credential_root: { type: 'string' },
        host_credentials_mounted: { const: false },
      },
    },
  },
});

export const LOCAL_MICROSANDBOX_MANIFEST_EXAMPLE_WITH_PLACEHOLDERS =
  Object.freeze({
    schema_version: 1,
    profile: LOCAL_PROFILE,
    vm_proof: {
      provider: 'microsandbox',
      instance_id: 'replace-with-current-microsandbox-instance-id',
      guest_kernel: 'replace-with-guest-kernel-release',
      probe_receipt_sha256: '0'.repeat(64),
      network_enabled: true,
      host_mounts: [],
      host_docker_socket_forwarded: false,
      host_credentials_mounted: false,
      docker_endpoint: 'unix:///job/private/docker/docker.sock',
    },
    paths: {
      runner_temp: '/job/private/runner-temp',
      source_root: '/job/private/source',
      tooling_root: '/job/private/tooling',
      source_archive: '/job/private/source.tar',
      tooling_archive: '/job/private/tooling.tar',
      vm_probe_receipt: '/job/private/vm-probe-receipt.json',
      docker_socket: '/job/private/docker/docker.sock',
      docker_config_root: '/job/private/docker-config',
    },
    source: {
      commit: LOCAL_SOURCE_COMMIT,
      tree: LOCAL_SOURCE_TREE,
      git_archive_sha256: '0'.repeat(64),
    },
    tooling: {
      commit: '0'.repeat(40),
      tree: '0'.repeat(40),
      git_archive_sha256: '0'.repeat(64),
      helper_sha256: '0'.repeat(64),
      base_commit: LOCAL_BASE_COMMIT,
      accepted_hosted_lineage: LOCAL_ACCEPTED_HOSTED_LINEAGE,
    },
    release_archive: {
      root: '/job/private/release-archive',
      manifest_sha256: LOCAL_RELEASE_MANIFEST_SHA256,
      release_run_id: LOCAL_RELEASE_RUN_ID,
      attempt: 1,
    },
    fixture_lock: {
      schema_version: 1,
      platform: 'linux/amd64',
      images: [
        {
          role: 'synapse',
          tag: FIXTURES[0].tag,
          repo_digest: 'ghcr.io/element-hq/synapse@sha256:' + '0'.repeat(64),
          image_id: `sha256:${'0'.repeat(64)}`,
          platform: 'linux/amd64',
          metadata_proof_sha256: '0'.repeat(64),
        },
        {
          role: 'postgres',
          tag: FIXTURES[1].tag,
          repo_digest: 'docker.io/library/postgres@sha256:' + '0'.repeat(64),
          image_id: `sha256:${'0'.repeat(64)}`,
          platform: 'linux/amd64',
          metadata_proof_sha256: '0'.repeat(64),
        },
      ],
    },
    synthetic_identity: {
      mode: 'synthetic',
      credential_root: '/job/private/synthetic-credentials',
      host_credentials_mounted: false,
    },
  });

export const LOCAL_MICROSANDBOX_PROBE_RECEIPT_SCHEMA = Object.freeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Matrix Calendar Widget microsandbox probe receipt v1',
  type: 'object',
  additionalProperties: false,
  required: [
    'schema_version',
    'result',
    'provider',
    'instance_id',
    'guest_kernel',
    'guest_boot_id',
    'observed_at',
    'network_enabled',
    'host_mounts',
    'host_docker_socket_forwarded',
    'host_credentials_mounted',
    'docker_endpoint',
    'provenance',
    'checks',
  ],
  properties: {
    schema_version: { const: 1 },
    result: { const: 'passed' },
    provider: { const: 'microsandbox' },
    instance_id: { type: 'string', minLength: 1, maxLength: 128 },
    guest_kernel: { type: 'string', minLength: 1, maxLength: 128 },
    guest_boot_id: {
      type: 'string',
      pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
    },
    observed_at: { type: 'string', format: 'date-time' },
    network_enabled: { const: true },
    host_mounts: { type: 'array', maxItems: 0 },
    host_docker_socket_forwarded: { const: false },
    host_credentials_mounted: { const: false },
    docker_endpoint: { type: 'string', minLength: 1, maxLength: 4096 },
    provenance: {
      type: 'object',
      additionalProperties: false,
      required: [
        'source_commit',
        'source_tree',
        'source_archive_sha256',
        'tooling_commit',
        'tooling_tree',
        'tooling_archive_sha256',
        'helper_sha256',
        'release_manifest_sha256',
        'release_run_id',
        'attempt',
        'fixture_lock_sha256',
      ],
      properties: {
        source_commit: { const: LOCAL_SOURCE_COMMIT },
        source_tree: { const: LOCAL_SOURCE_TREE },
        source_archive_sha256: {
          type: 'string',
          pattern: '^[0-9a-f]{64}$',
        },
        tooling_commit: { type: 'string', pattern: '^[0-9a-f]{40}$' },
        tooling_tree: { type: 'string', pattern: '^[0-9a-f]{40}$' },
        tooling_archive_sha256: {
          type: 'string',
          pattern: '^[0-9a-f]{64}$',
        },
        helper_sha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
        release_manifest_sha256: { const: LOCAL_RELEASE_MANIFEST_SHA256 },
        release_run_id: { const: LOCAL_RELEASE_RUN_ID },
        attempt: { const: 1 },
        fixture_lock_sha256: {
          type: 'string',
          pattern: '^[0-9a-f]{64}$',
        },
      },
    },
    checks: {
      type: 'object',
      additionalProperties: false,
      required: LOCAL_PROBE_CHECKS,
      properties: Object.fromEntries(
        LOCAL_PROBE_CHECKS.map((name) => [name, { const: 'passed' }]),
      ),
    },
  },
});

export const LOCAL_MICROSANDBOX_PROBE_RECEIPT_EXAMPLE_WITH_PLACEHOLDERS =
  Object.freeze({
    schema_version: 1,
    result: 'passed',
    provider: 'microsandbox',
    instance_id: 'replace-with-current-microsandbox-instance-id',
    guest_kernel: 'replace-with-guest-kernel-release',
    guest_boot_id: '00000000-0000-0000-0000-000000000000',
    observed_at: '2026-01-01T00:00:00.000Z',
    network_enabled: true,
    host_mounts: [],
    host_docker_socket_forwarded: false,
    host_credentials_mounted: false,
    docker_endpoint: 'unix:///job/private/docker/docker.sock',
    provenance: {
      source_commit: LOCAL_SOURCE_COMMIT,
      source_tree: LOCAL_SOURCE_TREE,
      source_archive_sha256: '0'.repeat(64),
      tooling_commit: '0'.repeat(40),
      tooling_tree: '0'.repeat(40),
      tooling_archive_sha256: '0'.repeat(64),
      helper_sha256: '0'.repeat(64),
      release_manifest_sha256: LOCAL_RELEASE_MANIFEST_SHA256,
      release_run_id: LOCAL_RELEASE_RUN_ID,
      attempt: 1,
      fixture_lock_sha256: '0'.repeat(64),
    },
    checks: Object.fromEntries(
      LOCAL_PROBE_CHECKS.map((name) => [name, 'passed']),
    ),
  });

export function canonicalLocalJson(value) {
  const canonical = (current) => {
    if (Array.isArray(current)) {
      return `[${current.map((entry) => canonical(entry)).join(',')}]`;
    }
    if (current && typeof current === 'object') {
      return `{${Object.keys(current)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${canonical(current[key])}`)
        .join(',')}}`;
    }
    return JSON.stringify(current);
  };
  return `${canonical(value)}\n`;
}

export function parseOperatorRehearsalProfileArgs(args) {
  if (args.length === 0) return { profile: 'hosted' };
  if (
    args.length === 4 &&
    args[0] === '--profile' &&
    args[1] === LOCAL_PROFILE &&
    args[2] === '--manifest' &&
    path.isAbsolute(args[3])
  ) {
    return { profile: LOCAL_PROFILE, manifestPath: path.resolve(args[3]) };
  }
  throw new RehearsalFailure('preflight', 'profile-arguments-invalid');
}

function assertExactKeys(value, expected, stage, code) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join('\0') !== [...expected].sort().join('\0')
  ) {
    fail(stage, code);
  }
}

function validSha(value, bytes = 40) {
  return (
    typeof value === 'string' &&
    new RegExp(`^[0-9a-f]{${bytes}}$`, 'u').test(value)
  );
}

function isAbsoluteNormalizedPath(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    path.isAbsolute(value) &&
    path.resolve(value) === value &&
    !value.includes('\0')
  );
}

function localContract(condition, code) {
  if (!condition) fail('local-profile-manifest', code);
}

function validateJsonSchemaValue(
  value,
  schema,
  stage = 'local-profile-manifest',
  code = 'manifest-schema-invalid',
) {
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  const matches = (type) =>
    type === 'object'
      ? value !== null && typeof value === 'object' && !Array.isArray(value)
      : type === 'array'
        ? Array.isArray(value)
        : type === 'integer'
          ? Number.isInteger(value)
          : typeof value === type;
  if (
    (types[0] !== undefined && !types.some(matches)) ||
    (Object.hasOwn(schema, 'const') && value !== schema.const) ||
    (schema.enum && !schema.enum.includes(value))
  ) {
    fail(stage, code);
  }
  if (typeof value === 'string') {
    if (
      (schema.minLength !== undefined && value.length < schema.minLength) ||
      (schema.maxLength !== undefined && value.length > schema.maxLength) ||
      (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) ||
      (schema.format === 'date-time' && !Number.isFinite(Date.parse(value)))
    ) {
      fail(stage, code);
    }
  } else if (Array.isArray(value)) {
    if (
      (schema.minItems !== undefined && value.length < schema.minItems) ||
      (schema.maxItems !== undefined && value.length > schema.maxItems)
    ) {
      fail(stage, code);
    }
    if (schema.items) {
      for (const item of value)
        validateJsonSchemaValue(item, schema.items, stage, code);
    }
  } else if (value !== null && typeof value === 'object') {
    if (schema.additionalProperties === false) {
      assertExactKeys(value, schema.required ?? [], stage, code);
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(schema.properties ?? {}, key)) {
          fail(stage, code);
        }
      }
    } else if (schema.required) {
      for (const key of schema.required) {
        if (!Object.hasOwn(value, key)) {
          fail(stage, code);
        }
      }
    }
    for (const [key, propertySchema] of Object.entries(
      schema.properties ?? {},
    )) {
      if (Object.hasOwn(value, key)) {
        validateJsonSchemaValue(value[key], propertySchema, stage, code);
      }
    }
  }
}

export function validateLocalManifestContract(manifest) {
  validateJsonSchemaValue(manifest, LOCAL_MICROSANDBOX_MANIFEST_SCHEMA);
  for (const value of Object.values(manifest.paths)) {
    localContract(isAbsoluteNormalizedPath(value), 'path-invalid');
  }
  localContract(
    isAbsoluteNormalizedPath(manifest.release_archive.root) &&
      isAbsoluteNormalizedPath(manifest.synthetic_identity.credential_root),
    'path-invalid',
  );
  const fixtureRoles = new Set();
  for (const fixture of manifest.fixture_lock.images) {
    const expected = FIXTURES.find((entry) => entry.role === fixture.role);
    const expectedRepos =
      fixture.role === 'postgres'
        ? ['docker.io/library/postgres', 'postgres']
        : ['ghcr.io/element-hq/synapse'];
    localContract(
      expected !== undefined &&
        !fixtureRoles.has(fixture.role) &&
        fixture.tag === expected.tag &&
        expectedRepos.some((repo) =>
          fixture.repo_digest.startsWith(`${repo}@sha256:`),
        ) &&
        /^.+@sha256:[0-9a-f]{64}$/u.test(fixture.repo_digest),
      'fixture-image-invalid',
    );
    fixtureRoles.add(fixture.role);
  }
  localContract(fixtureRoles.size === FIXTURES.length, 'fixture-lock-invalid');
  localContract(
    manifest.vm_proof.docker_endpoint ===
      `unix://${manifest.paths.docker_socket}`,
    'docker-endpoint-mismatch',
  );
  return manifest;
}

function validatePrivateDirectory(file, root, code, { empty = false } = {}) {
  try {
    const info = lstatSync(file);
    if (
      info.isSymbolicLink() ||
      !info.isDirectory() ||
      info.uid !== process.getuid?.() ||
      (info.mode & 0o777) !== 0o700 ||
      (root &&
        !path.resolve(file).startsWith(`${path.resolve(root)}${path.sep}`)) ||
      realpathSync(file) !== path.resolve(file) ||
      (empty && readdirSync(file).length !== 0)
    ) {
      fail('local-profile-paths', code);
    }
  } catch (error) {
    if (error instanceof RehearsalFailure) throw error;
    fail('local-profile-paths', code);
  }
}

function validatePrivateRegularFile(file, root, code) {
  try {
    const info = lstatSync(file);
    if (
      info.isSymbolicLink() ||
      !info.isFile() ||
      info.uid !== process.getuid?.() ||
      (info.mode & 0o777) !== 0o600 ||
      !path.resolve(file).startsWith(`${path.resolve(root)}${path.sep}`) ||
      realpathSync(file) !== path.resolve(file)
    ) {
      fail('local-profile-paths', code);
    }
  } catch (error) {
    if (error instanceof RehearsalFailure) throw error;
    fail('local-profile-paths', code);
  }
}

function validatePrivateDockerSocket(file, root) {
  try {
    const info = lstatSync(file);
    if (
      info.isSymbolicLink() ||
      !info.isSocket() ||
      info.uid !== process.getuid?.() ||
      (info.mode & 0o777) !== 0o600 ||
      !path.resolve(file).startsWith(`${path.resolve(root)}${path.sep}`) ||
      realpathSync(file) !== path.resolve(file)
    ) {
      fail('local-profile-paths', 'docker-socket-invalid');
    }
  } catch (error) {
    if (error instanceof RehearsalFailure) throw error;
    fail('local-profile-paths', 'docker-socket-invalid');
  }
}

function sha256File(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function gitObjectHash(type, body) {
  return createHash('sha1')
    .update(`${type} ${body.length}\0`)
    .update(body)
    .digest();
}

export function hashExtractedGitTree(root) {
  const visit = (directory) => {
    const entries = [];
    for (const name of readdirSync(directory)) {
      if (name === '.git' || name.includes('/')) {
        fail('local-profile-provenance', 'archive-tree-entry-invalid');
      }
      const file = path.join(directory, name);
      const info = lstatSync(file);
      if (info.uid !== process.getuid?.() || info.isSymbolicLink()) {
        fail('local-profile-provenance', 'archive-tree-entry-invalid');
      }
      if (info.isDirectory()) {
        entries.push({
          name,
          mode: '40000',
          digest: visit(file),
          directory: true,
        });
      } else if (info.isFile()) {
        const executable = (info.mode & 0o111) !== 0;
        const body = readFileSync(file);
        entries.push({
          name,
          mode: executable ? '100755' : '100644',
          digest: gitObjectHash('blob', body),
          directory: false,
        });
      } else {
        fail('local-profile-provenance', 'archive-tree-entry-invalid');
      }
    }
    entries.sort((left, right) =>
      Buffer.compare(
        Buffer.from(left.name + (left.directory ? '/' : '')),
        Buffer.from(right.name + (right.directory ? '/' : '')),
      ),
    );
    const body = Buffer.concat(
      entries.flatMap((entry) => [
        Buffer.from(`${entry.mode} ${entry.name}\0`),
        entry.digest,
      ]),
    );
    return gitObjectHash('tree', body);
  };
  try {
    const rootInfo = lstatSync(root);
    if (
      rootInfo.isSymbolicLink() ||
      !rootInfo.isDirectory() ||
      realpathSync(root) !== path.resolve(root)
    ) {
      fail('local-profile-provenance', 'archive-root-invalid');
    }
    return visit(root).toString('hex');
  } catch (error) {
    if (error instanceof RehearsalFailure) throw error;
    fail('local-profile-provenance', 'archive-tree-invalid');
  }
}

export function validateLocalProbeReceipt(manifest, receiptPath) {
  validatePrivateRegularFile(
    receiptPath,
    manifest.paths.runner_temp,
    'vm-probe-receipt-invalid',
  );
  const bytes = readFileSync(receiptPath);
  localContract(
    createHash('sha256').update(bytes).digest('hex') ===
      manifest.vm_proof.probe_receipt_sha256,
    'vm-probe-receipt-digest-mismatch',
  );
  let receipt;
  try {
    receipt = JSON.parse(bytes.toString('utf8'));
  } catch {
    fail('local-profile-probe', 'vm-probe-receipt-invalid');
  }
  localContract(
    canonicalLocalJson(receipt) === bytes.toString('utf8'),
    'vm-probe-receipt-not-canonical',
  );
  validateJsonSchemaValue(
    receipt,
    LOCAL_MICROSANDBOX_PROBE_RECEIPT_SCHEMA,
    'local-profile-probe',
    'vm-probe-receipt-invalid',
  );
  const expectedProvenance = {
    source_commit: manifest.source.commit,
    source_tree: manifest.source.tree,
    source_archive_sha256: manifest.source.git_archive_sha256,
    tooling_commit: manifest.tooling.commit,
    tooling_tree: manifest.tooling.tree,
    tooling_archive_sha256: manifest.tooling.git_archive_sha256,
    helper_sha256: manifest.tooling.helper_sha256,
    release_manifest_sha256: manifest.release_archive.manifest_sha256,
    release_run_id: manifest.release_archive.release_run_id,
    attempt: manifest.release_archive.attempt,
    fixture_lock_sha256: createHash('sha256')
      .update(canonicalLocalJson(manifest.fixture_lock))
      .digest('hex'),
  };
  const observed = Date.parse(receipt.observed_at);
  let currentBootId;
  try {
    currentBootId = readFileSync(
      '/proc/sys/kernel/random/boot_id',
      'utf8',
    ).trim();
  } catch {
    fail('local-profile-probe', 'guest-identity-unavailable');
  }
  localContract(
    receipt.schema_version === 1 &&
      receipt.result === 'passed' &&
      receipt.provider === manifest.vm_proof.provider &&
      receipt.instance_id === manifest.vm_proof.instance_id &&
      receipt.guest_kernel === manifest.vm_proof.guest_kernel &&
      receipt.guest_kernel === osRelease() &&
      receipt.guest_boot_id === currentBootId &&
      typeof receipt.observed_at === 'string' &&
      Number.isFinite(observed) &&
      new Date(observed).toISOString() === receipt.observed_at &&
      receipt.network_enabled === manifest.vm_proof.network_enabled &&
      Array.isArray(receipt.host_mounts) &&
      receipt.host_mounts.length === 0 &&
      receipt.host_docker_socket_forwarded === false &&
      receipt.host_credentials_mounted === false &&
      receipt.docker_endpoint === manifest.vm_proof.docker_endpoint &&
      canonicalLocalJson(receipt.provenance) ===
        canonicalLocalJson(expectedProvenance) &&
      LOCAL_PROBE_CHECKS.every((name) => receipt.checks[name] === 'passed'),
    'vm-probe-receipt-facts-invalid',
  );
  return receipt;
}

export function validateLocalProfilePaths(manifest, manifestPath) {
  validateLocalManifestContract(manifest);
  const { paths } = manifest;
  validatePrivateDirectory(paths.runner_temp, null, 'runner-temp-invalid');
  validatePrivateRegularFile(
    manifestPath,
    paths.runner_temp,
    'manifest-file-invalid',
  );
  for (const directory of [
    paths.source_root,
    paths.tooling_root,
    paths.docker_config_root,
    manifest.release_archive.root,
    manifest.synthetic_identity.credential_root,
  ]) {
    validatePrivateDirectory(
      directory,
      paths.runner_temp,
      'private-directory-invalid',
      {
        empty:
          directory === paths.docker_config_root ||
          directory === manifest.synthetic_identity.credential_root,
      },
    );
  }
  for (const file of [
    paths.source_archive,
    paths.tooling_archive,
    paths.vm_probe_receipt,
    path.join(manifest.release_archive.root, 'manifest.json'),
  ]) {
    validatePrivateRegularFile(file, paths.runner_temp, 'private-file-invalid');
  }
  validatePrivateDockerSocket(paths.docker_socket, paths.runner_temp);
  validatePrivateDirectory(
    path.dirname(paths.docker_socket),
    paths.runner_temp,
    'docker-socket-parent-invalid',
  );
  const releaseManifestPath = path.join(
    manifest.release_archive.root,
    'manifest.json',
  );
  localContract(
    sha256File(releaseManifestPath) ===
      manifest.release_archive.manifest_sha256,
    'release-manifest-digest-mismatch',
  );
  localContract(
    sha256File(paths.source_archive) === manifest.source.git_archive_sha256 &&
      hashExtractedGitTree(paths.source_root) === manifest.source.tree,
    'source-archive-provenance-mismatch',
  );
  localContract(
    sha256File(paths.tooling_archive) === manifest.tooling.git_archive_sha256 &&
      hashExtractedGitTree(paths.tooling_root) === manifest.tooling.tree,
    'tooling-archive-provenance-mismatch',
  );
  const helperPath = path.join(
    paths.tooling_root,
    'scripts/hosted-operator-rehearsal.mjs',
  );
  localContract(
    realpathSync(fileURLToPath(import.meta.url)) === realpathSync(helperPath) &&
      sha256File(helperPath) === manifest.tooling.helper_sha256,
    'helper-provenance-mismatch',
  );
  const releaseManifest = readJson(releaseManifestPath, 'image-lock');
  const sourceImages = exactSourceImages(
    releaseManifest,
    manifest.source.commit,
    manifest.source.tree,
    manifest.release_archive.release_run_id,
    String(manifest.release_archive.attempt),
    {
      dispatchSha: LOCAL_ACCEPTED_HOSTED_LINEAGE,
      workflowSha: LOCAL_ACCEPTED_HOSTED_LINEAGE,
    },
  );
  const probeReceipt = validateLocalProbeReceipt(
    manifest,
    paths.vm_probe_receipt,
  );
  validatePrivateDirectory(
    path.dirname(manifestPath),
    paths.runner_temp,
    'manifest-parent-invalid',
  );
  return { releaseManifest, sourceImages, probeReceipt };
}

export function readLocalProfileManifest(manifestPath) {
  try {
    const info = lstatSync(manifestPath);
    if (
      !path.isAbsolute(manifestPath) ||
      path.resolve(manifestPath) !== manifestPath ||
      info.isSymbolicLink() ||
      !info.isFile() ||
      info.uid !== process.getuid?.() ||
      (info.mode & 0o777) !== 0o600 ||
      realpathSync(manifestPath) !== path.resolve(manifestPath)
    ) {
      fail('local-profile-manifest', 'manifest-file-invalid');
    }
    const text = readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(text);
    localContract(
      canonicalLocalJson(manifest) === text,
      'manifest-not-canonical',
    );
    return validateLocalManifestContract(manifest);
  } catch (error) {
    if (error instanceof RehearsalFailure) throw error;
    fail('local-profile-manifest', 'manifest-invalid');
  }
}

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
    this.apiCrudProbe = diagnostic.apiCrudProbe;
    this.reminderFixture = projectReminderFixtureOutcome(
      diagnostic.reminderFixture,
    );
    this.foreignInventoryChange =
      diagnostic.foreignInventoryChange === undefined
        ? undefined
        : projectForeignInventoryChange(diagnostic.foreignInventoryChange);
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

export function isLocalProfileHostedContext(environment) {
  return (
    environment?.GITHUB_ACTIONS === 'true' ||
    environment?.RUNNER_ENVIRONMENT === 'github-hosted' ||
    environment?.[HOSTED_SHARED_DOCKER_SELECTION] === 'true'
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

export function exactSourceImages(
  manifest,
  sourceSha,
  sourceTree,
  runId,
  attempt,
  hostedBinding,
) {
  const dispatchSha = hostedBinding
    ? hostedBinding.dispatchSha
    : required(process.env, 'RELEASE_DISPATCH_SHA');
  const workflowSha = hostedBinding
    ? hostedBinding.workflowSha
    : required(process.env, 'RELEASE_WORKFLOW_SHA');
  const expectedRepository =
    hostedBinding?.repository ?? '0cwa/matrix-calendar-widget';
  const expectedWorkflowRef =
    hostedBinding?.workflowRef ??
    '0cwa/matrix-calendar-widget/.github/workflows/release-image-archive.yml@refs/heads/main';
  if (
    manifest?.schema_version !== 2 ||
    manifest.source?.sha !== sourceSha ||
    manifest.source?.tree !== sourceTree ||
    manifest.source?.dispatch_sha !== dispatchSha ||
    manifest.workflow?.sha !== workflowSha ||
    manifest.workflow?.repository !== expectedRepository ||
    manifest.workflow?.ref !== expectedWorkflowRef ||
    manifest.workflow?.run_id !== Number(runId) ||
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

export function lockedLocalFixtureIdentity(actual, expected) {
  const fixture = FIXTURES.find(
    (candidate) =>
      candidate.role === expected?.role && candidate.tag === expected?.tag,
  );
  const inspected =
    Array.isArray(actual) && actual.length === 1 ? actual[0] : null;
  if (
    !fixture ||
    !inspected ||
    inspected.Id !== expected.image_id ||
    inspected.Os !== 'linux' ||
    inspected.Architecture !== 'amd64' ||
    !inspected.RepoTags?.includes(expected.tag) ||
    !inspected.RepoDigests?.includes(expected.repo_digest) ||
    !validSha(expected.metadata_proof_sha256, 64)
  ) {
    fail('fixture-image-lock', 'fixture-lock-mismatch');
  }
  return {
    ref: expected.repo_digest,
    id: expected.image_id,
    repoDigests: [...new Set(inspected.RepoDigests)].sort(),
    os: inspected.Os,
    architecture: inspected.Architecture,
    tag: expected.tag,
    metadataProofSha256: expected.metadata_proof_sha256,
  };
}

export function makeComposeOverride(lock, runId, project) {
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
    const tmpfs = HOSTED_INHERITED_IMAGE_TMPFS[service] ?? [];
    if (tmpfs.length > 0) {
      lines.push('    tmpfs:', ...tmpfs.map((mount) => `      - "${mount}"`));
    }
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

function projectForeignInventoryChange(value) {
  if (value === undefined) {
    return {
      checkpoint: 'not-applicable',
      containers: 'not-applicable',
      networks: 'not-applicable',
      volumes: 'not-applicable',
      images: 'not-applicable',
      listeners: 'not-applicable',
      volume_identity_change: notApplicableForeignVolumeIdentityChange(),
    };
  }
  const record =
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? value
      : {};
  const result = {
    checkpoint: FOREIGN_INVENTORY_CHECKPOINTS.has(record.checkpoint)
      ? record.checkpoint
      : 'unknown',
  };
  for (const category of FOREIGN_INVENTORY_CATEGORIES) {
    result[category] = FOREIGN_INVENTORY_CHANGE_KINDS.has(record[category])
      ? record[category]
      : 'unknown';
  }
  if (
    ['unchanged', 'ordering-only', 'descriptor-metadata'].includes(
      result.volumes,
    )
  ) {
    result.volume_identity_change = notApplicableForeignVolumeIdentityChange();
  } else if (result.volumes === 'unknown') {
    result.volume_identity_change = projectForeignVolumeIdentityChange(null);
  } else {
    result.volume_identity_change = projectForeignVolumeIdentityChange(
      record.volume_identity_change,
    );
    const { added_count: added, removed_count: removed } =
      result.volume_identity_change;
    if (
      (typeof added === 'number' && added === 0 && removed === 0) ||
      added === 'not-applicable' ||
      removed === 'not-applicable'
    ) {
      result.volume_identity_change = projectForeignVolumeIdentityChange(null);
    }
  }
  return result;
}

function notApplicableForeignVolumeIdentityChange() {
  return {
    added_count: 'not-applicable',
    removed_count: 'not-applicable',
    added_association: 'not-applicable',
    removed_association: 'not-applicable',
  };
}

function projectForeignVolumeIdentityChange(value) {
  const unknown = {
    added_count: 'unknown',
    removed_count: 'unknown',
    added_association: 'unknown',
    removed_association: 'unknown',
  };
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return unknown;
  }
  const keys = Object.keys(value).sort();
  if (
    keys.join(',') !==
    'added_association,added_count,removed_association,removed_count'
  ) {
    return unknown;
  }

  const projectCount = (count) =>
    (Number.isSafeInteger(count) &&
      count >= 0 &&
      count <= MAX_FOREIGN_VOLUME_CHANGE_COUNT) ||
    count === `${MAX_FOREIGN_VOLUME_CHANGE_COUNT}+` ||
    count === 'unknown'
      ? count
      : undefined;
  const validPair = (count, association) => {
    if (count === 'unknown') return association === 'unknown';
    if (count === 'not-applicable') return false;
    if (count === 0) return association === 'not-applicable';
    return (
      association !== 'not-applicable' &&
      !(count === 1 && association === 'multiple')
    );
  };
  const addedCount = projectCount(value.added_count);
  const removedCount = projectCount(value.removed_count);
  const addedAssociation = value.added_association;
  const removedAssociation = value.removed_association;
  if (
    addedCount === undefined ||
    removedCount === undefined ||
    !FOREIGN_VOLUME_ASSOCIATIONS.has(addedAssociation) ||
    !FOREIGN_VOLUME_ASSOCIATIONS.has(removedAssociation) ||
    !validPair(addedCount, addedAssociation) ||
    !validPair(removedCount, removedAssociation)
  ) {
    return unknown;
  }
  return {
    added_count: addedCount,
    removed_count: removedCount,
    added_association: addedAssociation,
    removed_association: removedAssociation,
  };
}

function canonicalDiagnosticValue(value, imageField = false) {
  if (Array.isArray(value)) {
    const items = value.map((item) => canonicalDiagnosticValue(item));
    return imageField
      ? items.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
      : items;
  }
  if (value !== null && typeof value === 'object') {
    const result = {};
    for (const key of Object.keys(value).sort()) {
      const unorderedImageField =
        imageField && (key === 'RepoTags' || key === 'RepoDigests');
      result[key] = canonicalDiagnosticValue(value[key], unorderedImageField);
    }
    return result;
  }
  return value;
}

function categoryIdentity(category, item) {
  if (category === 'listeners') {
    return typeof item === 'string' && item.length > 0 ? item : undefined;
  }
  const key = category === 'volumes' ? 'Name' : 'Id';
  return item !== null &&
    typeof item === 'object' &&
    typeof item[key] === 'string' &&
    item[key].length > 0
    ? item[key]
    : undefined;
}

function canonicalInventoryCategory(category, items) {
  if (category === 'listeners') return [...items].sort();
  const key = category === 'volumes' ? 'Name' : 'Id';
  return [...items]
    .sort((left, right) => left[key].localeCompare(right[key]))
    .map((item) => canonicalDiagnosticValue(item, category === 'images'));
}

function inventoryCategoryChangeKind(category, before, after) {
  if (JSON.stringify(before) === JSON.stringify(after)) return 'unchanged';
  if (!Array.isArray(before) || !Array.isArray(after)) return 'unknown';
  const beforeIds = before.map((item) => categoryIdentity(category, item));
  const afterIds = after.map((item) => categoryIdentity(category, item));
  if (
    beforeIds.some((id) => id === undefined) ||
    afterIds.some((id) => id === undefined)
  ) {
    return 'unknown';
  }
  const sortIds = (ids) => [...ids].sort();
  if (
    beforeIds.length !== afterIds.length ||
    JSON.stringify(sortIds(beforeIds)) !== JSON.stringify(sortIds(afterIds))
  ) {
    return 'identity-set-cardinality';
  }
  try {
    return JSON.stringify(canonicalInventoryCategory(category, before)) ===
      JSON.stringify(canonicalInventoryCategory(category, after))
      ? 'ordering-only'
      : 'descriptor-metadata';
  } catch {
    return 'unknown';
  }
}

function boundedForeignVolumeCount(count) {
  return count > MAX_FOREIGN_VOLUME_CHANGE_COUNT
    ? `${MAX_FOREIGN_VOLUME_CHANGE_COUNT}+`
    : count;
}

function associationForForeignVolume(volumeName, inventory, runId, project) {
  if (!Array.isArray(inventory?.containers)) return 'unknown';
  const associations = new Set();
  try {
    for (const container of inventory.containers) {
      if (container === null || typeof container !== 'object') {
        return 'unknown';
      }
      const owner = ownership(container, 'container', runId, project);
      if (!Array.isArray(container.Mounts)) return 'unknown';
      for (const mount of container.Mounts) {
        if (
          mount === null ||
          typeof mount !== 'object' ||
          Array.isArray(mount) ||
          !['volume', 'bind', 'tmpfs'].includes(mount.Type) ||
          typeof mount.Destination !== 'string' ||
          mount.Destination.length === 0
        ) {
          return 'unknown';
        }
        if (mount.Type !== 'volume') continue;
        if (typeof mount.Name !== 'string' || mount.Name.length === 0) {
          return 'unknown';
        }
        if (mount.Name !== volumeName) continue;
        if (owner !== 'owned') return 'unknown';
        const service = labelsOf(container, 'container')[SERVICE_LABEL];
        if (!SERVICES.includes(service)) return 'unknown';
        const association =
          FOREIGN_VOLUME_MOUNT_CLASSES.get(`${service}|${mount.Destination}`) ??
          FOREIGN_VOLUME_OTHER_MOUNT_CLASSES.get(service);
        if (!FOREIGN_VOLUME_ASSOCIATIONS.has(association)) return 'unknown';
        associations.add(association);
      }
    }
  } catch {
    return 'unknown';
  }
  if (associations.size === 0) return 'unattached';
  return associations.size === 1 ? [...associations][0] : 'multiple';
}

function foreignVolumeIdentityChange(
  beforeInventory,
  afterInventory,
  beforeVolumes,
  afterVolumes,
  runId,
  project,
) {
  const unknown = {
    added_count: 'unknown',
    removed_count: 'unknown',
    added_association: 'unknown',
    removed_association: 'unknown',
  };
  if (!Array.isArray(beforeVolumes) || !Array.isArray(afterVolumes)) {
    return unknown;
  }
  const names = (volumes) => {
    const values = volumes.map((volume) => categoryIdentity('volumes', volume));
    return values.some((name) => name === undefined) ||
      new Set(values).size !== values.length
      ? undefined
      : values;
  };
  const beforeNames = names(beforeVolumes);
  const afterNames = names(afterVolumes);
  if (beforeNames === undefined || afterNames === undefined) return unknown;
  const beforeSet = new Set(beforeNames);
  const afterSet = new Set(afterNames);
  const added = afterNames.filter((name) => !beforeSet.has(name));
  const removed = beforeNames.filter((name) => !afterSet.has(name));
  const summarize = (changed, inventory) => {
    if (changed.length === 0) return 'not-applicable';
    const associations = new Set();
    for (const name of changed) {
      const association = associationForForeignVolume(
        name,
        inventory,
        runId,
        project,
      );
      if (association === 'unknown') return 'unknown';
      associations.add(association);
    }
    return associations.size === 1 ? [...associations][0] : 'multiple';
  };
  return {
    added_count: boundedForeignVolumeCount(added.length),
    removed_count: boundedForeignVolumeCount(removed.length),
    added_association: summarize(added, afterInventory),
    removed_association: summarize(removed, beforeInventory),
  };
}

function classifyForeignInventoryChange(
  before,
  after,
  checkpoint,
  beforeInventory,
  afterInventory,
  runId,
  project,
) {
  const result = { checkpoint };
  for (const category of FOREIGN_INVENTORY_CATEGORIES) {
    result[category] = inventoryCategoryChangeKind(
      category,
      before?.[category],
      after?.[category],
    );
  }
  result.volume_identity_change = foreignVolumeIdentityChange(
    beforeInventory,
    afterInventory,
    before?.volumes,
    after?.volumes,
    runId,
    project,
  );
  return projectForeignInventoryChange(result);
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

export function runTask(
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
    apiCrudProbeParser,
    reminderFixtureOutcomeParser,
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
    if (apiCrudProbeParser) {
      diagnostic.apiCrudProbe = apiCrudProbeParser(
        result.stdout ?? '',
        result.status,
      );
    }
    if (reminderFixtureOutcomeParser) {
      try {
        diagnostic.reminderFixture = projectReminderFixtureOutcome(
          reminderFixtureOutcomeParser(result.stdout ?? ''),
        );
      } catch {
        diagnostic.reminderFixture = unknownReminderFixture('invalid');
      }
    }
    diagnostic.childExitCode = result.status;
    fail(
      stage,
      failureDiagnosticParser
        ? 'gateway-network-smoke-failed'
        : apiCrudProbeParser
          ? 'api-probe-process-failed'
          : reminderFixtureOutcomeParser &&
              diagnostic.reminderFixture.marker_status === 'captured' &&
              diagnostic.reminderFixture.status === 'failed'
            ? 'reminder-fixture-failed'
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

export function compareForeign(
  before,
  after,
  runId,
  project,
  checkpoint = 'unknown',
) {
  const left = foreignInventory(before, runId, project);
  const right = foreignInventory(after, runId, project);
  if (JSON.stringify(left) !== JSON.stringify(right)) {
    let foreignInventoryChange;
    try {
      foreignInventoryChange = classifyForeignInventoryChange(
        left,
        right,
        checkpoint,
        before,
        after,
        runId,
        project,
      );
    } catch {
      foreignInventoryChange = projectForeignInventoryChange({ checkpoint });
    }
    if (
      FOREIGN_INVENTORY_CATEGORIES.every(
        (category) => foreignInventoryChange[category] === 'unchanged',
      )
    ) {
      for (const category of FOREIGN_INVENTORY_CATEGORIES) {
        foreignInventoryChange[category] = 'unknown';
      }
    }
    fail('foreign-inventory', 'foreign-state-changed', {
      foreignInventoryChange,
    });
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

function writeDockerShim(taskDir, dockerExecutable, nodeExecutable) {
  const dockerBinDir = path.join(taskDir, 'docker-bin');
  mkdirSync(dockerBinDir, { mode: 0o700 });
  chmodSync(dockerBinDir, 0o700);
  const dockerAdapterPath = path.join(dockerBinDir, 'docker');
  const helperPath = fileURLToPath(import.meta.url);
  const helperUrl = pathToFileURL(helperPath).href;
  if (
    nodeExecutable !== undefined &&
    (!path.isAbsolute(nodeExecutable) || /[\s\r\n]/u.test(nodeExecutable))
  ) {
    fail('docker-api-preflight', 'local-node-runtime-invalid');
  }
  const shebang = nodeExecutable
    ? `#!${nodeExecutable}`
    : '#!/usr/bin/env node';
  const source = `${shebang}
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

export function writeDockerAdapter(taskDir, dockerExecutable) {
  return writeDockerShim(taskDir, dockerExecutable);
}

export function writeLocalDockerShim(taskDir, dockerExecutable) {
  return writeDockerShim(taskDir, dockerExecutable, process.execPath);
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

export function validateComposeModel(model, lock, runId, project) {
  const serviceNames = Object.keys(model?.services ?? {}).sort();
  const expected = [...SERVICES, 'element'].sort();
  if (JSON.stringify(serviceNames) !== JSON.stringify(expected)) {
    fail('compose-validation', 'service-model-mismatch');
  }
  const images = new Map(lock.images.map((image) => [image.role, image.ref]));
  for (const service of SERVICES) {
    const actualTmpfs = model.services[service]?.tmpfs;
    const expectedTmpfs = HOSTED_INHERITED_IMAGE_TMPFS[service] ?? [];
    if (
      (actualTmpfs !== undefined && !Array.isArray(actualTmpfs)) ||
      JSON.stringify([...(actualTmpfs ?? [])].sort()) !==
        JSON.stringify([...expectedTmpfs].sort())
    ) {
      fail('compose-validation', 'inherited-image-volume-mismatch');
    }
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

function checkSummary(command, stage, diagnostic) {
  let result;
  try {
    result = JSON.parse(command);
  } catch {
    fail(stage, 'helper-summary-invalid', diagnostic);
  }
  return result;
}

export function assertReminderResult(stdout, markerPath, expectedCount, stage) {
  const reminderFixture = parseReminderFixtureOutcome(stdout);
  if (reminderFixture.marker_status !== 'captured') {
    fail(stage, 'reminder-fixture-summary-invalid', {
      reminderFixture,
      childExitCode: 0,
    });
  }
  if (reminderFixture.status !== 'passed') {
    fail(stage, 'reminder-fixture-failed', {
      reminderFixture,
      childExitCode: 0,
    });
  }
  const summary = checkSummary(stdout.trim(), stage);
  if (summary.markerCount !== expectedCount) {
    fail(stage, 'reminder-marker-count-mismatch', {
      reminderFixture,
      childExitCode: 0,
    });
  }
  const markers = readJson(markerPath, stage);
  if (!Array.isArray(markers) || markers.length !== expectedCount) {
    fail(stage, 'reminder-marker-count-mismatch', {
      reminderFixture,
      childExitCode: 0,
    });
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

export function removeOwnedResources({
  plan,
  context,
  baseline,
  runId,
  project,
  prefix,
}) {
  const stage = `${prefix}-cleanup`;
  const foreignCheckpoints = CLEANUP_FOREIGN_CHECKPOINTS[prefix] ?? {};
  const networkAfterContainerRemoval = plan.network
    ? { ...plan.network, Containers: {} }
    : undefined;
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
  compareForeign(
    baseline,
    afterContainers,
    runId,
    project,
    foreignCheckpoints.afterContainers ?? 'unknown',
  );
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
  compareForeign(
    baseline,
    afterVolumes,
    runId,
    project,
    foreignCheckpoints.afterVolumes ?? 'unknown',
  );
  assertNoOwnedResources(afterVolumes, runId, project, 'volume', stage);
  const observedNetworks = afterVolumes.networks.filter(
    (network) => ownership(network, 'network', runId, project) === 'owned',
  );
  if (
    observedNetworks.some(
      (network) => Object.keys(network.Containers ?? {}).length !== 0,
    )
  ) {
    fail(stage, 'owned-network-still-attached');
  }
  assertInventoryEqual(
    observedNetworks,
    networkAfterContainerRemoval ? [networkAfterContainerRemoval] : [],
    stage,
  );
  if (plan.network) {
    const fresh = dockerJson(
      `${prefix}-inspect-network`,
      ['network', 'inspect', plan.network.Id],
      context,
    );
    if (fresh.length !== 1) fail(stage, 'network-changed-before-cleanup');
    const currentNetwork = stableNetwork(fresh[0]);
    if (Object.keys(currentNetwork.Containers ?? {}).length !== 0) {
      fail(stage, 'owned-network-still-attached');
    }
    assertInventoryEqual(currentNetwork, networkAfterContainerRemoval, stage);
    currentIdentity(plan.network, 'network', runId, project);
    runTask(
      `${prefix}-remove-network`,
      'docker',
      ['network', 'rm', plan.network.Id],
      context,
    );
  }

  const finalInventory = captureInventory(`${prefix}-final-inventory`, context);
  compareForeign(
    baseline,
    finalInventory,
    runId,
    project,
    foreignCheckpoints.finalInventory ?? 'unknown',
  );
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

export function localProfileReceipt(
  manifest,
  checks,
  result,
  failedPhase,
  cleanupStatus,
) {
  const safeFailedPhase = SAFE_PHASES.has(failedPhase) ? failedPhase : 'runner';
  return {
    schema_version: 1,
    profile: LOCAL_PROFILE,
    result,
    phase: 'local-microsandbox-operator-v1',
    failed_phase: result === 'passed' ? null : safeFailedPhase,
    cleanup_status: cleanupStatus,
    source: {
      commit: manifest.source.commit,
      tree: manifest.source.tree,
      git_archive_sha256: manifest.source.git_archive_sha256,
    },
    tooling: {
      commit: manifest.tooling.commit,
      tree: manifest.tooling.tree,
      git_archive_sha256: manifest.tooling.git_archive_sha256,
      helper_sha256: manifest.tooling.helper_sha256,
    },
    release_archive: {
      manifest_sha256: manifest.release_archive.manifest_sha256,
      release_run_id: manifest.release_archive.release_run_id,
      attempt: manifest.release_archive.attempt,
    },
    fixture_lock: {
      schema_version: manifest.fixture_lock.schema_version,
      platform: manifest.fixture_lock.platform,
      images: manifest.fixture_lock.images.map((image) => ({ ...image })),
    },
    vm_proof: {
      provider: manifest.vm_proof.provider,
      instance_id: manifest.vm_proof.instance_id,
      guest_kernel: manifest.vm_proof.guest_kernel,
      probe_receipt_sha256: manifest.vm_proof.probe_receipt_sha256,
      network_enabled: manifest.vm_proof.network_enabled,
      host_mounts: [],
      host_docker_socket_forwarded: false,
      host_credentials_mounted: false,
    },
    synthetic_identity: {
      mode: 'synthetic',
      host_credentials_mounted: false,
    },
    checks: { ...checks },
  };
}

export function validateLocalProfileReceipt(receipt, manifest) {
  assertExactKeys(
    receipt,
    [
      'schema_version',
      'profile',
      'result',
      'phase',
      'failed_phase',
      'cleanup_status',
      'source',
      'tooling',
      'release_archive',
      'fixture_lock',
      'vm_proof',
      'synthetic_identity',
      'checks',
    ],
    'receipt-publish',
    'local-receipt-shape-invalid',
  );
  localContract(
    receipt.schema_version === 1 &&
      receipt.profile === LOCAL_PROFILE &&
      receipt.phase === 'local-microsandbox-operator-v1' &&
      ['passed', 'failed'].includes(receipt.result) &&
      ['verified', 'unverified', 'not-run'].includes(receipt.cleanup_status),
    'local-receipt-identity-invalid',
  );
  const checkNames = [
    'source_binding',
    'fixture_identity',
    'api_authorization_and_crud',
    'reminder_initial_and_restart',
    'paired_store_restore',
    'owned_cleanup',
    'foreign_inventory_preservation',
  ];
  assertExactKeys(
    receipt.checks,
    checkNames,
    'receipt-publish',
    'local-receipt-checks-invalid',
  );
  localContract(
    checkNames.every((name) =>
      ['passed', 'failed', 'not-run', 'unverified'].includes(
        receipt.checks[name],
      ),
    ),
    'local-receipt-checks-invalid',
  );
  const successIsComplete =
    receipt.result !== 'passed' ||
    (receipt.failed_phase === null &&
      receipt.cleanup_status === 'verified' &&
      checkNames.every((name) => receipt.checks[name] === 'passed'));
  localContract(successIsComplete, 'local-receipt-false-success');
  localContract(
    receipt.result !== 'failed' ||
      (typeof receipt.failed_phase === 'string' &&
        SAFE_PHASES.has(receipt.failed_phase)),
    'local-receipt-failure-phase-invalid',
  );
  localContract(
    JSON.stringify(receipt.source) ===
      JSON.stringify({
        commit: manifest.source.commit,
        tree: manifest.source.tree,
        git_archive_sha256: manifest.source.git_archive_sha256,
      }) &&
      JSON.stringify(receipt.tooling) ===
        JSON.stringify({
          commit: manifest.tooling.commit,
          tree: manifest.tooling.tree,
          git_archive_sha256: manifest.tooling.git_archive_sha256,
          helper_sha256: manifest.tooling.helper_sha256,
        }) &&
      JSON.stringify(receipt.release_archive) ===
        JSON.stringify({
          manifest_sha256: manifest.release_archive.manifest_sha256,
          release_run_id: manifest.release_archive.release_run_id,
          attempt: manifest.release_archive.attempt,
        }) &&
      canonicalLocalJson(receipt.fixture_lock) ===
        canonicalLocalJson(manifest.fixture_lock) &&
      receipt.vm_proof.provider === manifest.vm_proof.provider &&
      receipt.vm_proof.instance_id === manifest.vm_proof.instance_id &&
      receipt.vm_proof.guest_kernel === manifest.vm_proof.guest_kernel &&
      receipt.vm_proof.probe_receipt_sha256 ===
        manifest.vm_proof.probe_receipt_sha256 &&
      receipt.vm_proof.network_enabled === true &&
      receipt.vm_proof.network_enabled === manifest.vm_proof.network_enabled,
    'local-receipt-provenance-mismatch',
  );
  return receipt;
}

function writeLocalProfileReceipt(
  runnerTemp,
  id,
  manifest,
  checks,
  result,
  failedPhase,
  cleanupStatus,
) {
  const file = path.join(
    runnerTemp,
    `.mcw-local-microsandbox-${id}.receipt.json`,
  );
  const receipt = validateLocalProfileReceipt(
    localProfileReceipt(manifest, checks, result, failedPhase, cleanupStatus),
    manifest,
  );
  writePrivate(file, canonicalLocalJson(receipt));
  privatePath(file, runnerTemp);
  return file;
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
  apiCrudProbe,
  reminderFixture,
  foreignInventoryChange,
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
  const safeApiCrudProbe = projectApiCrudProbe(apiCrudProbe);
  const safeReminderFixture = projectReminderFixtureOutcome(reminderFixture);
  const safeForeignInventoryChange = projectForeignInventoryChange(
    foreignInventoryChange,
  );

  return {
    schema_version: 10,
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
    api_crud_probe: safeApiCrudProbe,
    reminder_fixture: safeReminderFixture,
    foreign_inventory_change: safeForeignInventoryChange,
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
      const foreignInventoryChangeUnchanged =
        JSON.stringify(previous?.foreign_inventory_change) ===
        JSON.stringify(diagnostic.foreign_inventory_change);
      const foreignInventoryChangeAddedDuringFailureCleanup =
        JSON.stringify(previous?.foreign_inventory_change) ===
          JSON.stringify(projectForeignInventoryChange(undefined)) &&
        FAILURE_CLEANUP_FOREIGN_CHECKPOINTS.has(
          diagnostic.foreign_inventory_change?.checkpoint,
        );
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
          JSON.stringify(diagnostic.gateway_network_smoke) ||
        JSON.stringify(previous?.api_crud_probe) !==
          JSON.stringify(diagnostic.api_crud_probe) ||
        JSON.stringify(previous?.reminder_fixture) !==
          JSON.stringify(diagnostic.reminder_fixture) ||
        (!foreignInventoryChangeUnchanged &&
          !foreignInventoryChangeAddedDuringFailureCleanup)
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
  let localMode = false;
  let localInputsValidated = false;
  let localManifest;
  let localProbeReceipt;
  let localChecks;
  const failureIdentity = {};
  let diagnosticRoot;
  let diagnosticInventory;
  let diagnosticRunId;
  let diagnosticProject;
  let diagnosticImages;
  let listenerScopeDiagnostic;
  let cleanupState;
  let cleanupVerified = false;
  let id;
  const env = process.env;
  try {
    const invocation = parseOperatorRehearsalProfileArgs(process.argv.slice(2));
    localMode = invocation.profile === LOCAL_PROFILE;
    if (env.OPERATOR_REHEARSAL_ENABLED !== 'true') {
      fail('preflight', 'operator-rehearsal-not-enabled');
    }
    let sourceRoot;
    let toolingRoot;
    let archiveRoot;
    let sourceSha;
    let workflowSha;
    let runId;
    let attempt;
    let runnerTemp;
    let sourceImagesFromProfile;
    if (localMode) {
      if (isLocalProfileHostedContext(env)) {
        fail('preflight', 'local-profile-hosted-context-rejected');
      }
      localManifest = readLocalProfileManifest(invocation.manifestPath);
      const validated = validateLocalProfilePaths(
        localManifest,
        invocation.manifestPath,
      );
      localInputsValidated = true;
      localProbeReceipt = validated.probeReceipt;
      sourceImagesFromProfile = validated.sourceImages;
      sourceRoot = localManifest.paths.source_root;
      toolingRoot = localManifest.paths.tooling_root;
      archiveRoot = localManifest.release_archive.root;
      sourceSha = localManifest.source.commit;
      workflowSha = localManifest.tooling.commit;
      runId = localManifest.release_archive.release_run_id;
      attempt = String(localManifest.release_archive.attempt);
      runnerTemp = localManifest.paths.runner_temp;
      id = createHash('sha256')
        .update(
          `${runId}:${attempt}:${localManifest.vm_proof.instance_id}:${randomBytes(16).toString('hex')}`,
        )
        .digest('hex')
        .slice(0, 16);
      localChecks = {
        source_binding: 'passed',
        fixture_identity: 'not-run',
        api_authorization_and_crud: 'not-run',
        reminder_initial_and_restart: 'not-run',
        paired_store_restore: 'not-run',
        owned_cleanup: 'not-run',
        foreign_inventory_preservation: 'not-run',
      };
    } else {
      if (
        env[HOSTED_SHARED_DOCKER_SELECTION] !== 'true' ||
        !isSupportedGitHubHostedRunner(env)
      ) {
        fail('preflight', 'hosted-runner-context-invalid');
      }
      sourceRoot = path.resolve(required(env, 'GITHUB_WORKSPACE'), 'source');
      toolingRoot = path.resolve(required(env, 'GITHUB_WORKSPACE'), 'tooling');
      archiveRoot = path.resolve(required(env, 'ARCHIVE_ROOT'));
      sourceSha = requireSha(required(env, 'RELEASE_SOURCE_SHA'));
      workflowSha = requireSha(required(env, 'RELEASE_WORKFLOW_SHA'));
      runId = required(env, 'RELEASE_RUN_ID');
      attempt = required(env, 'RELEASE_RUN_ATTEMPT');
      if (!/^\d{1,20}$/u.test(runId) || !/^\d{1,4}$/u.test(attempt)) {
        fail('preflight', 'run-identity-invalid');
      }
      runnerTemp = path.resolve(required(env, 'RUNNER_TEMP'));
      id = createHash('sha256')
        .update(`${runId}:${attempt}`)
        .digest('hex')
        .slice(0, 16);
    }
    Object.assign(failureIdentity, { sourceSha, workflowSha, runId, attempt });
    const project = `mcw-p0-${id}`;
    diagnosticRunId = id;
    diagnosticProject = project;
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
    const checkoutSha = localMode
      ? localManifest.source.commit
      : gitValue(sourceRoot, ['rev-parse', 'HEAD'], 'source-binding');
    const checkoutTree = localMode
      ? localManifest.source.tree
      : gitValue(sourceRoot, ['rev-parse', 'HEAD^{tree}'], 'source-binding');
    const trustedSha = localMode
      ? localManifest.tooling.commit
      : gitValue(toolingRoot, ['rev-parse', 'HEAD'], 'source-binding');
    if (
      checkoutSha !== sourceSha ||
      trustedSha !== workflowSha ||
      !/^[0-9a-f]{40}$/u.test(checkoutTree ?? '')
    ) {
      fail('source-binding', 'checkout-sha-mismatch');
    }
    if (!localMode) {
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
    const sourceImages = localMode
      ? sourceImagesFromProfile
      : exactSourceImages(
          readJson(path.join(archiveRoot, 'manifest.json'), stage),
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
    const dockerConfig = localMode
      ? localManifest.paths.docker_config_root
      : path.join(taskDir, 'docker-config');
    if (!localMode) {
      mkdirSync(dockerConfig, { mode: 0o700 });
      chmodSync(dockerConfig, 0o700);
    }
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
    const dockerAdapter = localMode
      ? writeLocalDockerShim(taskDir, dockerExecutable)
      : writeDockerAdapter(taskDir, dockerExecutable);
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
    if (localMode) {
      dockerEnv.DOCKER_HOST = localManifest.vm_proof.docker_endpoint;
    }
    const context = { cwd: sourceRoot, env: dockerEnv, taskDir };
    stage = 'docker-api-preflight';
    if (
      (localMode
        ? dockerEnv.DOCKER_HOST !== localManifest.vm_proof.docker_endpoint
        : dockerEnv.DOCKER_HOST !== undefined) ||
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

    stage = localMode ? 'fixture-image-lock' : 'fixture-image-pull';
    const fixtureImages = [];
    for (const fixture of FIXTURES) {
      if (!localMode) {
        runTask(
          `pull-${fixture.role}`,
          'docker',
          ['pull', '--platform', 'linux/amd64', fixture.tag],
          context,
        );
      }
      const actual = dockerJson(
        `inspect-${fixture.role}`,
        ['image', 'inspect', fixture.tag],
        context,
      );
      let locked;
      if (localMode) {
        const externalLock = localManifest.fixture_lock.images.find(
          (image) => image.role === fixture.role,
        );
        locked = lockedLocalFixtureIdentity(actual, externalLock);
      } else {
        locked = fixtureIdentity(actual, fixture.tag);
      }
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
    if (localMode) localChecks.fixture_identity = 'passed';
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

    if (!localMode) {
      enableHostedSharedDockerRehearsal(dockerEnv, env, {
        taskDir,
        dockerBinDir: dockerAdapter.dockerBinDir,
        dockerAdapterPath: dockerAdapter.dockerAdapterPath,
        dockerExecutable,
      });
    }

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
    const apiOutput = runFixtureTask(
      'api-crud-probe',
      process.execPath,
      [path.join(sourceRoot, 'dev/element-acceptance-api-probe.mjs')],
      {},
      { apiCrudProbeParser: parseApiCrudProbeFailure },
    );
    assertApiCrudProbePassed(apiOutput);
    if (localMode) localChecks.api_authorization_and_crud = 'passed';

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
        { reminderFixtureOutcomeParser: parseReminderFixtureOutcome },
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
        { reminderFixtureOutcomeParser: parseReminderFixtureOutcome },
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
    if (localMode) localChecks.reminder_initial_and_restart = 'passed';

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
        { reminderFixtureOutcomeParser: parseReminderFixtureOutcome },
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
    if (localMode) localChecks.paired_store_restore = 'passed';

    stage = 'owned-cleanup-preflight';
    const current = captureInventory('pre-cleanup', context);
    diagnosticInventory = current;
    compareForeign(baseline, current, id, project, 'owned-cleanup-preflight');
    if (localMode) localChecks.foreign_inventory_preservation = 'passed';
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
    if (!localMode) {
      receiptPath = path.join(runnerTemp, `.mcw-p0-${id}.receipt.json`);
      writePrivate(
        receiptPath,
        `${JSON.stringify({ ...receipt, cleanup_verified: false })}\n`,
      );
      privatePath(receiptPath, runnerTemp);
    }

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
    if (localMode) localChecks.owned_cleanup = 'passed';

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
    if (localMode) {
      receiptPath = writeLocalProfileReceipt(
        runnerTemp,
        id,
        localManifest,
        localChecks,
        'passed',
        null,
        'verified',
      );
      process.stdout.write(
        'Local microsandbox operator rehearsal passed; owned cleanup was verified.\n',
      );
    } else {
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
    }
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
      foreignInventoryChange:
        error instanceof RehearsalFailure
          ? error.foreignInventoryChange
          : undefined,
      startupStage:
        error instanceof RehearsalFailure ? error.startupStage : 'unknown',
      childExitCode:
        error instanceof RehearsalFailure ? error.childExitCode : 'unavailable',
      gatewayNetworkSmoke:
        error instanceof RehearsalFailure
          ? error.gatewayNetworkSmoke
          : undefined,
      apiCrudProbe:
        error instanceof RehearsalFailure ? error.apiCrudProbe : undefined,
      reminderFixture:
        error instanceof RehearsalFailure ? error.reminderFixture : undefined,
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
    const diagnosticWritten = localMode
      ? false
      : writeFailureDiagnostic(diagnosticRoot, {
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
        compareForeign(
          baseline,
          current,
          runId,
          project,
          'failure-cleanup-preflight',
        );
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
        if (localMode) localChecks.owned_cleanup = 'passed';
      } catch (cleanupError) {
        if (
          !failure.foreignInventoryChange &&
          cleanupError instanceof RehearsalFailure
        ) {
          failure.foreignInventoryChange = cleanupError.foreignInventoryChange;
        }
        cleanupStatus = 'unverified';
      }
    }
    if (localMode && taskDir && lstatSync(taskDir, { throwIfNoEntry: false })) {
      try {
        assertPrivateTaskTree(taskDir, {
          runnerTemp: localManifest.paths.runner_temp,
          dockerAdapterPath: path.join(taskDir, 'docker-bin', 'docker'),
        });
        if (
          realpathSync(taskDir) !== taskDir ||
          !taskDir.startsWith(`${localManifest.paths.runner_temp}${path.sep}`)
        ) {
          fail('task-files-cleanup', 'task-directory-path-invalid');
        }
        rmSync(taskDir, { recursive: true, force: false });
        if (lstatSync(taskDir, { throwIfNoEntry: false }))
          fail('task-files-cleanup', 'task-directory-remains');
      } catch {
        cleanupStatus = 'unverified';
        cleanupAttempted = true;
      }
    }
    if (localMode && localChecks) {
      if (
        ['source-binding', 'image-lock', 'source-image-inspect'].includes(
          failedPhase,
        )
      ) {
        localChecks.source_binding = 'failed';
      } else if (failedPhase === 'fixture-image-lock') {
        localChecks.fixture_identity = 'failed';
      } else if (['api-route-smoke', 'api-crud-probe'].includes(failedPhase)) {
        localChecks.api_authorization_and_crud = 'failed';
      } else if (
        ['reminder-initial', 'reminder-restart'].includes(failedPhase)
      ) {
        localChecks.reminder_initial_and_restart = 'failed';
      } else if (failedPhase === 'paired-store-restore') {
        localChecks.paired_store_restore = 'failed';
      } else if (
        ['owned-cleanup', 'owned-cleanup-preflight'].includes(failedPhase)
      ) {
        localChecks.owned_cleanup = 'failed';
      }
      if (failure.foreignInventoryChange) {
        localChecks.foreign_inventory_preservation = 'failed';
      }
      if (cleanupStatus === 'verified') localChecks.owned_cleanup = 'passed';
      else if (localChecks.owned_cleanup !== 'failed')
        localChecks.owned_cleanup = cleanupStatus;
    }
    if (diagnosticWritten) {
      writeFailureDiagnostic(
        diagnosticRoot,
        { ...failure, cleanupStatus, cleanupAttempted },
        true,
      );
    }
    if (!localMode && env.GITHUB_STEP_SUMMARY) {
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
    if (localMode) {
      if (localInputsValidated && localManifest && id && localChecks) {
        try {
          receiptPath = writeLocalProfileReceipt(
            localManifest.paths.runner_temp,
            id,
            localManifest,
            localChecks,
            'failed',
            failedPhase,
            cleanupStatus,
          );
        } catch {
          // Do not reveal a private path or replace the fixed failure line.
        }
      }
      process.stderr.write(
        `Local microsandbox operator rehearsal failed; owned cleanup ${cleanupStatus}.\n`,
      );
    } else {
      process.stderr.write(
        `Hosted Docker operator rehearsal failed at phase ${SAFE_PHASES.has(failedPhase) ? failedPhase : 'runner'}; owned cleanup ${cleanupStatus}.\n`,
      );
    }
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
