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

function emitContractPhase(stagePath) {
  if (!stagePath) {
    return;
  }

  try {
    const stageContent = readFileSync(stagePath, 'utf8');
    process.stdout.write(formatContractPhase(stageContent));
    process.stdout.write(formatRoomAppServiceSetupStatus(stageContent));
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
