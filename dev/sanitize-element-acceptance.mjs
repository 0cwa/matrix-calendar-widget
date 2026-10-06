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
  'member-a-registration',
  'member-a-login',
  'member-b-registration',
  'member-b-login',
  'outsider-registration',
  'outsider-login',
  'bot-registration',
  'bot-login',
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
  'runtime-versions',
]);
const STATUSES = new Set(['started', 'passed', 'failed', 'unavailable']);
const FAILURE_CODES = new Set([
  'docker-command-failed',
  'docker-process-spawn-failed',
  'invalid-login-response',
  'invalid-project-name',
  'matrix-http-failed',
  'matrix-invalid-json',
  'matrix-transport-failed',
]);
const VERSION_FIELDS = new Set([
  'elementWebConfiguredTag',
  'synapseConfiguredTag',
  'radicaleConfiguredTag',
  'chromiumVersion',
  'runnerOS',
  'runnerOSVersion',
  'runnerArchitecture',
  'nodeVersion',
]);
const ALLOWED_KEYS = new Set([
  'phase',
  'status',
  'httpStatus',
  'count',
  'failureCode',
  'processExitCode',
  ...VERSION_FIELDS,
]);

function validRuntimeVersions(record) {
  const expectedKeys = new Set(['phase', 'status', ...VERSION_FIELDS]);
  if (
    Object.keys(record).length !== expectedKeys.size ||
    Object.keys(record).some((key) => !expectedKeys.has(key)) ||
    record.status !== 'passed' ||
    record.elementWebConfiguredTag !== 'v1.12.30' ||
    record.synapseConfiguredTag !== 'v1.161.0' ||
    record.radicaleConfiguredTag !== '3.8.0.0' ||
    typeof record.chromiumVersion !== 'string' ||
    !/^\d{1,3}(?:\.\d{1,5}){2,3}$/u.test(record.chromiumVersion) ||
    record.runnerOS !== 'linux' ||
    typeof record.runnerOSVersion !== 'string' ||
    !/^\d+(?:\.\d+){1,4}(?:-\d+(?:-(?:azure|aws|gcp|generic))?)?$/u.test(
      record.runnerOSVersion,
    ) ||
    !['x64', 'arm64'].includes(record.runnerArchitecture) ||
    typeof record.nodeVersion !== 'string' ||
    !/^v\d{1,3}\.\d{1,3}\.\d{1,3}$/u.test(record.nodeVersion)
  ) {
    return false;
  }

  return true;
}

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

    if (
      Object.hasOwn(record, 'failureCode') &&
      !FAILURE_CODES.has(record.failureCode)
    ) {
      throw new Error('invalid element acceptance summary');
    }

    if (
      Object.hasOwn(record, 'processExitCode') &&
      (!Number.isInteger(record.processExitCode) ||
        record.processExitCode < 1 ||
        record.processExitCode > 255)
    ) {
      throw new Error('invalid element acceptance summary');
    }

    if (
      (record.phase === 'runtime-versions' && !validRuntimeVersions(record)) ||
      (record.phase !== 'runtime-versions' &&
        [...VERSION_FIELDS].some((key) => Object.hasOwn(record, key)))
    ) {
      throw new Error('invalid element acceptance summary');
    }

    if (
      (record.failureCode === 'docker-command-failed' &&
        !Object.hasOwn(record, 'processExitCode')) ||
      (record.failureCode === 'matrix-http-failed' &&
        !Object.hasOwn(record, 'httpStatus')) ||
      (record.failureCode === 'matrix-invalid-json' &&
        !Object.hasOwn(record, 'httpStatus'))
    ) {
      throw new Error('invalid element acceptance summary');
    }

    phases.set(record.phase, record);
  }

  const lines = [`element-acceptance source_sha=${sourceSha.toLowerCase()}`];
  for (const [phase, record] of phases) {
    if (phase === 'runtime-versions') {
      lines.push(
        [
          'phase=runtime-versions',
          'status=passed',
          `element_web_configured_tag=${record.elementWebConfiguredTag}`,
          `synapse_configured_tag=${record.synapseConfiguredTag}`,
          `radicale_configured_tag=${record.radicaleConfiguredTag}`,
          `chromium_observed=${record.chromiumVersion}`,
          `runner_os=${record.runnerOS}`,
          `kernel_release=${record.runnerOSVersion}`,
          `runner_arch=${record.runnerArchitecture}`,
          `node_observed=${record.nodeVersion}`,
        ].join(' '),
      );
      continue;
    }

    const fields = [`phase=${phase}`, `status=${record.status}`];
    if (Object.hasOwn(record, 'httpStatus')) {
      fields.push(`http_status=${record.httpStatus}`);
    }
    if (Object.hasOwn(record, 'count')) {
      fields.push(`count=${record.count}`);
    }
    if (Object.hasOwn(record, 'failureCode')) {
      fields.push(`failure_code=${record.failureCode}`);
    }
    if (Object.hasOwn(record, 'processExitCode')) {
      fields.push(`process_exit_code=${record.processExitCode}`);
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
