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
const PERSONAL_OPENID_SETUP_COMPLETE = 'personal-openid-setup-complete';
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
    process.stdout.write(formatPersonalOpenIdSetupStatus(stageContent));
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
