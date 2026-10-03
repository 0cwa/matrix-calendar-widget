import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const allowedPhases = new Set([
  'period-resource-created',
  'period-resource-read',
  'period-resource-parsed',
  'period-target-validated',
  'period-patch-applied',
  'period-update-started',
  'period-update-accepted',
  'period-resource-reread',
  'period-removal-verified',
]);
const ROOM_APPSERVICE_SETUP_COMPLETE = 'room-appservice-setup-complete';
const PERSONAL_OPENID_SETUP_START = 'personal-openid-setup-start';
const PERSONAL_OPENID_SUITE_LOADED = 'personal-openid-suite-loaded';
const PERSONAL_OPENID_SUITE_REGISTERED = 'personal-openid-suite-registered';
const PERSONAL_OPENID_JEST_SETUP_LOADED = 'personal-openid-jest-setup-loaded';
const PERSONAL_OPENID_PROBE_LAUNCHED = 'personal-openid-probe-launched';
const PERSONAL_OPENID_RUNNER_READY = 'personal-openid-runner-ready';
const PERSONAL_OPENID_SETUP_COMPLETE = 'personal-openid-setup-complete';
const PERSONAL_OPENID_SETUP_STAGES = new Set([
  'fixture-input-check',
  'actor-login',
  'actor-proof-validation',
  'create-personal-room',
  'create-nonmember',
  'nonmember-login',
  'nonmember-openid-proof',
  'gateway-init',
  'gateway-listen',
]);
const PERSONAL_OPENID_SETUP_FAILURE_CATEGORIES = new Set([
  'transport',
  'http-status',
  'json-or-token-parse',
  'other',
]);
const ROOM_APPSERVICE_LISTING_CHECKPOINTS = new Set([
  'room-one-response-status',
  'room-one-response-json-parsed',
  'room-one-event-summary',
  'room-one-caldav-requests',
  'room-one-target-path',
  'room-one-no-root-discovery',
  'room-one-no-response-secret',
  'room-two-response-status',
  'room-two-response-json-parsed',
  'room-two-event-summary',
  'room-two-caldav-requests',
  'room-two-target-path',
  'room-two-no-root-discovery',
  'room-two-no-response-secret',
  'logs-secret-free',
]);

export function formatContractPhase(stageContent) {
  let latestAllowedPhase;

  for (const line of stageContent.split(/\r?\n/)) {
    const candidate = line.trim();
    if (allowedPhases.has(candidate)) {
      latestAllowedPhase = candidate;
    }
  }

  return latestAllowedPhase ? `contract-phase ${latestAllowedPhase}\n` : '';
}

export function formatRoomAppServiceSetupStatus(stageContent) {
  const completed =
    typeof stageContent === 'string' &&
    stageContent
      .split(/\r?\n/)
      .some((line) => line.trim() === ROOM_APPSERVICE_SETUP_COMPLETE);
  return `room-appservice-setup ${completed ? 'complete' : 'not-reached'}\n`;
}

export function formatPersonalOpenIdSetupStatus(stageContent) {
  const completed =
    typeof stageContent === 'string' &&
    stageContent
      .split(/\r?\n/)
      .some((line) => line.trim() === PERSONAL_OPENID_SETUP_COMPLETE);
  return `personal-openid-setup ${completed ? 'complete' : 'not-reached'}\n`;
}

export function formatPersonalOpenIdSetupStart(stageContent) {
  const started =
    typeof stageContent === 'string' &&
    stageContent
      .split(/\r?\n/)
      .some((line) => line.trim() === PERSONAL_OPENID_SETUP_START);
  return `personal-openid-setup-start ${started ? 'reached' : 'not-reached'}\n`;
}

export function formatPersonalOpenIdSuiteLoaded(stageContent) {
  const loaded =
    typeof stageContent === 'string' &&
    stageContent
      .split(/\r?\n/)
      .some((line) => line.trim() === PERSONAL_OPENID_SUITE_LOADED);
  return `personal-openid-suite ${loaded ? 'loaded' : 'not-reached'}\n`;
}

export function formatPersonalOpenIdJestSetup(stageContent) {
  const loaded =
    typeof stageContent === 'string' &&
    stageContent
      .split(/\r?\n/)
      .some((line) => line.trim() === PERSONAL_OPENID_JEST_SETUP_LOADED);
  return `personal-openid-jest-setup ${loaded ? 'loaded' : 'not-reached'}\n`;
}

export function formatPersonalOpenIdProbeLaunch(stageContent) {
  const launched =
    typeof stageContent === 'string' &&
    stageContent
      .split(/\r?\n/)
      .some((line) => line.trim() === PERSONAL_OPENID_PROBE_LAUNCHED);
  return `personal-openid-probe ${launched ? 'launched' : 'not-launched'}\n`;
}

export function formatPersonalOpenIdSuiteRegistration(stageContent) {
  const registered =
    typeof stageContent === 'string' &&
    stageContent
      .split(/\r?\n/)
      .some((line) => line.trim() === PERSONAL_OPENID_SUITE_REGISTERED);
  return `personal-openid-suite-registration ${registered ? 'registered' : 'not-reached'}\n`;
}

export function formatPersonalOpenIdRunnerReady(stageContent) {
  const ready =
    typeof stageContent === 'string' &&
    stageContent
      .split(/\r?\n/)
      .some((line) => line.trim() === PERSONAL_OPENID_RUNNER_READY);
  return `personal-openid-runner ${ready ? 'ready' : 'not-reached'}\n`;
}

export function formatPersonalOpenIdSetupStage(stageContent) {
  let latestStage;
  if (typeof stageContent === 'string') {
    for (const line of stageContent.split(/\r?\n/)) {
      const candidate = line
        .trim()
        .replace(/^personal-openid-setup-stage-/, '');
      if (PERSONAL_OPENID_SETUP_STAGES.has(candidate)) {
        latestStage = candidate;
      }
    }
  }
  return latestStage ? `personal-openid-setup-stage ${latestStage}\n` : '';
}

export function formatPersonalOpenIdSetupFailure(stageContent) {
  let latestCategory;
  if (typeof stageContent === 'string') {
    for (const line of stageContent.split(/\r?\n/)) {
      const candidate = line
        .trim()
        .replace(/^personal-openid-setup-failure-/, '');
      if (PERSONAL_OPENID_SETUP_FAILURE_CATEGORIES.has(candidate)) {
        latestCategory = candidate;
      }
    }
  }
  return latestCategory
    ? `personal-openid-setup-failure ${latestCategory}\n`
    : '';
}

export function formatRoomAppServiceListingCheckpoint(stageContent) {
  let latestCheckpoint;
  if (typeof stageContent === 'string') {
    for (const line of stageContent.split(/\r?\n/)) {
      const candidate = line.trim().replace(/^room-appservice-listing-/, '');
      if (ROOM_APPSERVICE_LISTING_CHECKPOINTS.has(candidate)) {
        latestCheckpoint = candidate;
      }
    }
  }
  return latestCheckpoint
    ? `room-appservice-listing ${latestCheckpoint}\n`
    : '';
}

function emitContractPhase(stagePath) {
  if (!stagePath) {
    return;
  }

  try {
    const stageContent = readFileSync(stagePath, 'utf8');
    process.stdout.write(formatContractPhase(stageContent));
    process.stdout.write(formatPersonalOpenIdProbeLaunch(stageContent));
    process.stdout.write(formatPersonalOpenIdJestSetup(stageContent));
    process.stdout.write(formatPersonalOpenIdSuiteLoaded(stageContent));
    process.stdout.write(formatPersonalOpenIdSuiteRegistration(stageContent));
    process.stdout.write(formatPersonalOpenIdRunnerReady(stageContent));
    process.stdout.write(formatPersonalOpenIdSetupStart(stageContent));
    process.stdout.write(formatPersonalOpenIdSetupStatus(stageContent));
    process.stdout.write(formatPersonalOpenIdSetupStage(stageContent));
    process.stdout.write(formatPersonalOpenIdSetupFailure(stageContent));
    process.stdout.write(formatRoomAppServiceSetupStatus(stageContent));
    process.stdout.write(formatRoomAppServiceListingCheckpoint(stageContent));
  } catch {
    // Missing or unreadable diagnostics must not print untrusted file content.
  }
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  emitContractPhase(process.argv[2]);
}
