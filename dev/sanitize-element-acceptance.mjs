import { readFileSync, writeFileSync } from 'node:fs';

const PHASES = new Set([
  'accounts-ready',
  'service-calendar-ready',
  'room-ready',
  'widget-registered',
  'runtime-ready',
  'gateway-ready',
  'widget-ready',
  'element-ready',
  'member-a-authenticated',
  'member-b-authenticated',
  'outsider-authenticated',
  'outsider-room-context',
  'widget-a-approved',
  'widget-b-approved',
  'outsider-widget-approved',
  'browser-test-suite',
  'gateway-backed-read',
  'event-created',
  'shared-visibility',
  'member-a-edited',
  'outsider-room-widget-team-target',
  'outsider-own-unbound-room',
  'stale-etag-conflict',
  'canonical-read-after-denial',
  'browser-egress',
]);
const STATUSES = new Set(['started', 'passed', 'failed', 'unavailable']);
const ALLOWED_KEYS = new Set(['phase', 'status', 'httpStatus', 'count']);

export function sanitizeElementAcceptance(input, sourceSha) {
  if (typeof sourceSha !== 'string' || !/^[a-f0-9]{40}$/i.test(sourceSha)) {
    throw new Error('invalid element acceptance summary');
  }

  const phases = new Map();
  for (const line of input.split(/\r?\n/u)) {
    if (!line) continue;

    let record;
    try {
      record = JSON.parse(line);
    } catch {
      throw new Error('invalid element acceptance summary');
    }

    if (
      record === null ||
      typeof record !== 'object' ||
      Array.isArray(record) ||
      Object.keys(record).some((key) => !ALLOWED_KEYS.has(key)) ||
      !PHASES.has(record.phase) ||
      !STATUSES.has(record.status)
    ) {
      throw new Error('invalid element acceptance summary');
    }

    if (
      Object.hasOwn(record, 'httpStatus') &&
      (!Number.isInteger(record.httpStatus) ||
        record.httpStatus < 100 ||
        record.httpStatus > 599)
    ) {
      throw new Error('invalid element acceptance summary');
    }

    if (
      Object.hasOwn(record, 'count') &&
      (!Number.isInteger(record.count) ||
        record.count < 0 ||
        record.count > 100000)
    ) {
      throw new Error('invalid element acceptance summary');
    }

    phases.set(record.phase, record);
  }

  const lines = [`element-acceptance source_sha=${sourceSha.toLowerCase()}`];
  for (const [phase, record] of phases) {
    const fields = [`phase=${phase}`, `status=${record.status}`];
    if (Object.hasOwn(record, 'httpStatus')) {
      fields.push(`http_status=${record.httpStatus}`);
    }
    if (Object.hasOwn(record, 'count')) {
      fields.push(`count=${record.count}`);
    }
    lines.push(fields.join(' '));
  }
  return `${lines.join('\n')}\n`;
}

function main() {
  const stageFile =
    process.argv[2] ?? process.env.ELEMENT_ACCEPTANCE_STAGE_FILE;
  const sourceSha =
    process.argv[3] ?? process.env.ELEMENT_ACCEPTANCE_SOURCE_SHA;
  const input = stageFile ? readFileSync(stageFile, 'utf8') : '';
  const summary = sanitizeElementAcceptance(input, sourceSha);

  process.stdout.write(summary);

  const summaryFile = process.env.ELEMENT_ACCEPTANCE_SUMMARY_FILE;
  if (summaryFile) writeFileSync(summaryFile, summary, { mode: 0o600 });

  const stepSummary = process.env.GITHUB_STEP_SUMMARY;
  if (stepSummary) {
    writeFileSync(stepSummary, `\n\`\`\`text\n${summary}\`\`\`\n`, {
      flag: 'a',
    });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch {
    process.stderr.write('Element acceptance summary unavailable.\n');
    process.exitCode = 1;
  }
}
