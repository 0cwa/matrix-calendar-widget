import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const allowedIds = new Set(
  Array.from({ length: 16 }, (_, index) => String(index + 1).padStart(2, '0')),
);

export function formatPersonalOpenIdImportProbe(stageContent) {
  if (typeof stageContent !== 'string' || stageContent.length === 0) {
    return {
      output: 'personal-openid-import-probe not-reached\n',
      exitCode: 1,
    };
  }

  const lines = stageContent.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) {
    return {
      output: 'personal-openid-import-probe not-reached\n',
      exitCode: 1,
    };
  }
  const output = [];
  let expectedIndex = 0;
  let exitCode = 0;

  for (const line of lines) {
    const match = /^personal-openid-import-(\d{2}) (passed|failed)$/.exec(line);
    if (!match || !allowedIds.has(match[1])) {
      return {
        output: 'personal-openid-import-probe unclassified\n',
        exitCode: 1,
      };
    }

    const expectedId = String(expectedIndex + 1).padStart(2, '0');
    if (match[1] !== expectedId) {
      return {
        output: 'personal-openid-import-probe unclassified\n',
        exitCode: 1,
      };
    }

    output.push(`personal-openid-import-${match[1]} ${match[2]}\n`);
    expectedIndex += 1;
    if (match[2] === 'failed') {
      exitCode = 1;
      break;
    }
  }

  if (exitCode === 0 && expectedIndex !== allowedIds.size) {
    return {
      output: 'personal-openid-import-probe incomplete\n',
      exitCode: 1,
    };
  }

  return {
    output: output.join(''),
    exitCode,
  };
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  let stageContent = '';
  try {
    stageContent = readFileSync(process.argv[2], 'utf8');
  } catch {
    // A missing or unreadable stage file is summarized without its path/error.
  }
  const result = formatPersonalOpenIdImportProbe(stageContent);
  process.stdout.write(result.output);
  process.exitCode = result.exitCode;
}
