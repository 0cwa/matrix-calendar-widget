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
const ROOM_APPSERVICE_SETUP_START = 'room-appservice-setup-start';
const ROOM_APPSERVICE_SETUP_STAGES = new Set([
  'fixture-input-check',
  'decode-actor-proof',
  'actor-login',
  'register-service-user',
  'create-room-one',
  'create-room-two',
  'configure-room-bindings',
  'room-one-proof-and-calendar',
  'room-two-proof-and-calendar',
  'gateway-create',
  'gateway-configure',
  'gateway-listen',
]);
const ROOM_APPSERVICE_CASES = new Set([
  'exact-binding',
  'subject-binding',
  'cross-room-denial',
]);
const ROOM_APPSERVICE_MATRIX_ERROR_CODES = new Set([
  'M_BAD_JSON',
  'M_FORBIDDEN',
  'M_INVALID_PARAM',
  'M_INVALID_PASSWORD',
  'M_INVALID_USERNAME',
  'M_LIMIT_EXCEEDED',
  'M_MISSING_PARAM',
  'M_NOT_FOUND',
  'M_THREEPID_AUTH_FAILED',
  'M_UNAUTHORIZED',
  'M_UNKNOWN',
  'M_UNKNOWN_TOKEN',
  'M_USER_DEACTIVATED',
  'M_USER_IN_USE',
]);
const PERSONAL_OPENID_SETUP_START = 'personal-openid-setup-start';
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
const PERSONAL_OPENID_MATRIX_ERROR_CODES = new Set([
  'M_BAD_JSON',
  'M_FORBIDDEN',
  'M_INVALID_PARAM',
  'M_INVALID_PASSWORD',
  'M_INVALID_USERNAME',
  'M_LIMIT_EXCEEDED',
  'M_MISSING_PARAM',
  'M_NOT_FOUND',
  'M_THREEPID_AUTH_FAILED',
  'M_UNAUTHORIZED',
  'M_UNKNOWN',
  'M_UNKNOWN_TOKEN',
  'M_USER_DEACTIVATED',
  'M_USER_IN_USE',
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

export function formatRoomAppServiceSetupStart(stageContent) {
  const started =
    typeof stageContent === 'string' &&
    stageContent
      .split(/\r?\n/)
      .some((line) => line.trim() === ROOM_APPSERVICE_SETUP_START);
  return `room-appservice-setup-start ${started ? 'reached' : 'not-reached'}\n`;
}

export function getRoomAppServiceSetupStage(stageContent) {
  let latestStage;
  if (typeof stageContent === 'string') {
    for (const line of stageContent.split(/\r?\n/)) {
      const candidate = line
        .trim()
        .replace(/^room-appservice-setup-stage-/, '');
      if (ROOM_APPSERVICE_SETUP_STAGES.has(candidate)) {
        latestStage = candidate;
      }
    }
  }
  return latestStage;
}

export function formatRoomAppServiceSetupStage(stageContent) {
  const latestStage = getRoomAppServiceSetupStage(stageContent);
  return latestStage ? `room-appservice-setup-stage ${latestStage}\n` : '';
}

export function formatRoomAppServiceCaseBodyCount(stageContent) {
  const started = new Set();
  if (typeof stageContent === 'string') {
    for (const line of stageContent.split(/\r?\n/)) {
      const candidate = line.trim().replace(/^room-appservice-case-start-/, '');
      if (ROOM_APPSERVICE_CASES.has(candidate)) {
        started.add(candidate);
      }
    }
  }
  return `room-appservice-test-bodies started=${started.size}/${ROOM_APPSERVICE_CASES.size}\n`;
}

export function formatRoomAppServiceSetupHttpStatus(stageContent) {
  let latestStatus;
  if (typeof stageContent === 'string') {
    for (const line of stageContent.split(/\r?\n/)) {
      const match = line.trim().match(/^room-appservice-http-status-(\d{3})$/);
      if (match && Number(match[1]) >= 400 && Number(match[1]) <= 599) {
        latestStatus = match[1];
      }
    }
  }
  return latestStatus ? `room-appservice-http-status ${latestStatus}\n` : '';
}

export function formatRoomAppServiceSetupMatrixErrorCode(stageContent) {
  let latestCode;
  if (typeof stageContent === 'string') {
    for (const line of stageContent.split(/\r?\n/)) {
      const candidate = line
        .trim()
        .replace(/^room-appservice-matrix-error-/, '');
      if (ROOM_APPSERVICE_MATRIX_ERROR_CODES.has(candidate)) {
        latestCode = candidate;
      }
    }
  }
  return latestCode ? `room-appservice-matrix-error ${latestCode}\n` : '';
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

export function formatPersonalOpenIdSetupHttpStatus(stageContent) {
  let latestStatus;
  if (typeof stageContent === 'string') {
    for (const line of stageContent.split(/\r?\n/)) {
      const match = line.trim().match(/^personal-openid-http-status-(\d{3})$/);
      if (match && Number(match[1]) >= 400 && Number(match[1]) <= 599) {
        latestStatus = match[1];
      }
    }
  }
  return latestStatus ? `personal-openid-http-status ${latestStatus}\n` : '';
}

export function formatPersonalOpenIdSetupMatrixErrorCode(stageContent) {
  let latestCode;
  if (typeof stageContent === 'string') {
    for (const line of stageContent.split(/\r?\n/)) {
      const candidate = line
        .trim()
        .replace(/^personal-openid-matrix-error-/, '');
      if (PERSONAL_OPENID_MATRIX_ERROR_CODES.has(candidate)) {
        latestCode = candidate;
      }
    }
  }
  return latestCode ? `personal-openid-matrix-error ${latestCode}\n` : '';
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
    process.stdout.write(formatPersonalOpenIdSetupStart(stageContent));
    process.stdout.write(formatPersonalOpenIdSetupStatus(stageContent));
    process.stdout.write(formatPersonalOpenIdSetupStage(stageContent));
    process.stdout.write(formatPersonalOpenIdSetupFailure(stageContent));
    process.stdout.write(formatPersonalOpenIdSetupHttpStatus(stageContent));
    process.stdout.write(
      formatPersonalOpenIdSetupMatrixErrorCode(stageContent),
    );
    process.stdout.write(formatRoomAppServiceSetupStart(stageContent));
    process.stdout.write(formatRoomAppServiceSetupStatus(stageContent));
    process.stdout.write(formatRoomAppServiceSetupStage(stageContent));
    process.stdout.write(formatRoomAppServiceCaseBodyCount(stageContent));
    process.stdout.write(formatRoomAppServiceSetupHttpStatus(stageContent));
    process.stdout.write(
      formatRoomAppServiceSetupMatrixErrorCode(stageContent),
    );
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
