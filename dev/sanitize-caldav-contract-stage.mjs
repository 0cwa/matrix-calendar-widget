import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const allowedPhases = new Set([
  'period-resource-created',
  'period-resource-read',
  'period-resource-parsed',
  'period-update-accepted',
  'period-resource-reread',
  'period-removal-verified',
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

function emitContractPhase(stagePath) {
  if (!stagePath) {
    return;
  }

  try {
    process.stdout.write(formatContractPhase(readFileSync(stagePath, 'utf8')));
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
