import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const repository = '0cwa/matrix-calendar-widget';
const candidates = new Map([
  [
    'ff948882ca82377f35aea6d580820685fa50b035',
    {
      base: 'e772d7de6644332be4daeb97ee529f6d15e68800',
      paths: [
        'README.md',
        'docs/STATUS.md',
        'docs/beta-scope.md',
        'docs/handoff/2026-10-06/README.md',
        'docs/handoff/2026-10-06/ledger.json',
        'docs/repository-readiness.md',
      ],
    },
  ],
]);

const maxFileBytes = 250_000;
const maxReceiptBytes = 700_000;
const maxOperations = 70_000;

function git(args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function quietRun(command, args, cwd, logPath) {
  const fd = openSync(logPath, 'w');
  try {
    const result = spawnSync(command, args, { cwd, stdio: ['ignore', fd, fd], windowsHide: true });
    return result.status === 0 && result.error === undefined;
  } finally {
    closeSync(fd);
  }
}

function safeLiteral(character) {
  return /^[\p{P}\p{Z}\s]$/u.test(character);
}

function addCopy(ops, start, length) {
  const prior = ops.at(-1);
  if (prior?.copy && prior.copy[0] + prior.copy[1] === start) prior.copy[1] += length;
  else ops.push({ copy: [start, length] });
}

function addLiteral(ops, value) {
  const prior = ops.at(-1);
  if (prior?.literal !== undefined) prior.literal += value;
  else ops.push({ literal: value });
}

function encode(original, finalText) {
  const gramSize = 12;
  const positions = new Map();
  for (let i = 0; i + gramSize <= original.length; i += 1) {
    const gram = original.slice(i, i + gramSize);
    const occurrences = positions.get(gram);
    if (occurrences) {
      if (occurrences.length < 128) occurrences.push(i);
    } else {
      positions.set(gram, [i]);
    }
  }

  const ops = [];
  let cursor = 0;
  while (cursor < finalText.length) {
    let bestStart = -1;
    let bestLength = 0;
    if (cursor + gramSize <= finalText.length) {
      for (const start of positions.get(finalText.slice(cursor, cursor + gramSize)) ?? []) {
        let length = gramSize;
        while (
          start + length < original.length &&
          cursor + length < finalText.length &&
          original[start + length] === finalText[cursor + length]
        ) length += 1;
        if (length > bestLength) {
          bestStart = start;
          bestLength = length;
        }
      }
    }

    if (bestLength >= gramSize) {
      addCopy(ops, bestStart, bestLength);
      cursor += bestLength;
    } else {
      const character = String.fromCodePoint(finalText.codePointAt(cursor));
      const start = original.indexOf(character);
      if (start >= 0) addCopy(ops, start, character.length);
      else if (safeLiteral(character)) addLiteral(ops, character);
      else throw new Error('UNENCODABLE_CHARACTER');
      cursor += character.length;
    }
    if (ops.length > maxOperations) throw new Error('OPERATION_LIMIT');
  }

  const reconstructed = ops.map((op) => op.copy
    ? original.slice(op.copy[0], op.copy[0] + op.copy[1])
    : op.literal).join('');
  if (reconstructed !== finalText) throw new Error('RECONSTRUCTION_MISMATCH');
  return ops;
}

function blocked(code) {
  process.stdout.write(JSON.stringify({ status: 'blocked', code }) + '\n');
  process.exitCode = 1;
}

function main() {
  const cwd = process.cwd();
  const head = git(['rev-parse', 'HEAD']).trim();
  const candidate = candidates.get(head);
  if (!candidate) return blocked('UNPINNED_TARGET');
  const { base, paths: allowlist } = candidate;
  if (git(['rev-parse', base]).trim() !== base || git(['merge-base', base, head]).trim() !== base) {
    return blocked('BASE_MISMATCH');
  }
  if (git(['status', '--porcelain', '--untracked-files=all']).trim() !== '') return blocked('TARGET_NOT_CLEAN');

  const paths = git(['diff', '--name-only', '--no-renames', base, head]).trim().split('\n').filter(Boolean).sort();
  const approved = [...allowlist].sort();
  if (paths.length !== approved.length || paths.some((path, index) => path !== approved[index])) {
    return blocked('CHANGED_PATH_ALLOWLIST_MISMATCH');
  }
  const protectedPath = (path) =>
    path === 'yarn.lock' || path === 'package.json' || path.endsWith('/package.json') ||
    /^\.yarn(?:rc|\.yml|\/)/u.test(path) || /^\.npm(?:rc|\/)/u.test(path) ||
    /(?:^|\/)(?:\.prettierrc[^/]*|prettier\.config\.[^/]+)$/u.test(path);
  if (paths.some(protectedPath)) return blocked('DEPENDENCY_OR_FORMAT_CONFIG_CHANGED');

  const originals = new Map();
  for (const path of approved) {
    git(['ls-files', '--error-unmatch', '--', path]);
    const bytes = execFileSync('git', ['show', head + ':' + path], {
      maxBuffer: maxFileBytes + 1,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (bytes.length > maxFileBytes) return blocked('FILE_SIZE_LIMIT');
    const source = bytes.toString('utf8');
    if (!Buffer.from(source, 'utf8').equals(bytes)) return blocked('NON_UTF8_SOURCE');
    originals.set(path, {
      source,
      blob: git(['rev-parse', head + ':' + path]).trim(),
      sha256: hash(bytes),
    });
  }

  const privateDir = mkdtempSync(join(process.env.RUNNER_TEMP || tmpdir(), 'locked-format-'));
  try {
    const installLog = join(privateDir, 'install.log');
    const prettierLog = join(privateDir, 'prettier.log');
    const translationLog = join(privateDir, 'translation.log');
    if (!quietRun('yarn', ['install', '--frozen-lockfile', '--ignore-scripts'], cwd, installLog)) {
      return blocked('LOCKED_INSTALL_FAILED');
    }
    if (git(['status', '--porcelain', '--untracked-files=all']).trim() !== '') {
      return blocked('INSTALL_CHANGED_TRACKED_SOURCE');
    }
    if (!quietRun('yarn', ['prettier', '--write', ...approved.filter((path) => !path.endsWith('.ics'))], cwd, prettierLog)) {
      return blocked('PRETTIER_FAILED');
    }
    if (!quietRun('yarn', ['workspace', '@matrix-calendar-widget/widget', 'translate'], cwd, translationLog)) {
      return blocked('WIDGET_TRANSLATION_FAILED');
    }

    const dirty = git(['status', '--porcelain', '--untracked-files=all'])
      .split('\n').filter(Boolean).map((line) => line.slice(3).trim()).sort();
    if (dirty.some((path) => !originals.has(path))) return blocked('MUTATION_OUTSIDE_ALLOWLIST');

    const receipts = [];
    for (const path of approved) {
      const bytes = readFileSync(join(cwd, path));
      if (bytes.length > maxFileBytes) return blocked('FILE_SIZE_LIMIT');
      const finalText = bytes.toString('utf8');
      if (!Buffer.from(finalText, 'utf8').equals(bytes)) return blocked('NON_UTF8_OUTPUT');
      const original = originals.get(path);
      receipts.push({
        repository,
        head,
        path,
        stage: 'formatter-and-translation-final',
        originalBlob: original.blob,
        originalSha256: original.sha256,
        originalUtf16Length: original.source.length,
        finalSha256: hash(bytes),
        finalUtf16Length: finalText.length,
        operations: encode(original.source, finalText),
      });
    }

    const output = receipts.map((receipt) => JSON.stringify(receipt)).join('\n');
    if (Buffer.byteLength(output, 'utf8') > maxReceiptBytes) return blocked('RECEIPT_SIZE_LIMIT');
    if (!quietRun('git', ['diff', '--check', 'HEAD'], cwd, join(privateDir, 'diff-check.log'))) {
      return blocked('WHITESPACE_CHECK_FAILED');
    }
    process.stdout.write(output + '\n');
  } finally {
    rmSync(privateDir, { recursive: true, force: true });
  }
}

try {
  main();
} catch {
  blocked('INTERNAL_VALIDATION_FAILED');
}
