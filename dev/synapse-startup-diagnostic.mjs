import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

const CATEGORY_PATTERNS = [
  [
    'registration-config',
    [
      /(?:application.?service|appservice|app_service).{0,120}(?:registration|config).{0,80}(?:invalid|malformed|failed|error|unable|not found)/i,
      /(?:invalid|malformed|failed|error|unable|not found).{0,80}(?:application.?service|appservice|app_service).{0,120}(?:registration|config)/i,
    ],
  ],
  [
    'homeserver-config',
    [
      /\bConfigError\b/,
      /(?:parse|load).{0,100}(?:homeserver|synapse).{0,100}config/i,
      /(?:homeserver|synapse).{0,100}(?:config|configuration).{0,100}(?:invalid|failed|parse)/i,
    ],
  ],
  [
    'database',
    [
      /\b(?:sqlite3|psycopg2)\.(?:OperationalError|DatabaseError|InterfaceError)\b/i,
      /\b(?:database is locked|unable to open database file)\b/i,
      /(?:database|postgres(?:ql)?).{0,100}(?:connect|connection).{0,40}(?:refused|failed|timeout)/i,
    ],
  ],
  [
    'permission',
    [/\bPermissionError\b/i, /\bPermission denied\b/i, /\bEACCES\b/i],
  ],
  [
    'bind',
    [
      /\bAddress already in use\b/i,
      /\bEADDRINUSE\b/i,
      /\b(?:failed|unable) to bind\b/i,
    ],
  ],
  [
    'application',
    [
      /\bFailed to start (?:Synapse|the homeserver)\b/i,
      /\bHomeserver startup failed\b/i,
      /\bFatal error during server startup\b/i,
    ],
  ],
];

const CATEGORIES = CATEGORY_PATTERNS.map(([category]) => category);
const INSPECT_RESULTS = [
  'compose-list-failed',
  'container-id-missing',
  'container-id-malformed',
  'inspect-failed',
  'inspect-data-invalid',
  'ok',
  'not-attempted',
  'unavailable',
];
const CONTAINER_STATES = [
  'created',
  'running',
  'paused',
  'restarting',
  'removing',
  'exited',
  'dead',
  'unavailable',
];
const HEALTH_STATES = [
  'starting',
  'healthy',
  'unhealthy',
  'not-reported',
  'unavailable',
];
const STARTUP_FAILURE_STAGES = [
  'docker-preflight',
  'curl-preflight',
  'homeserver-probe',
  'homeserver-generate',
  'fixture-permission',
  'registration-update',
  'uid991-access-assertion',
  'synapse-compose-start',
];

export function formatStartupStageFailure(stage, exitCode) {
  if (!STARTUP_FAILURE_STAGES.includes(stage)) {
    return undefined;
  }
  const parsedExitCode =
    typeof exitCode === 'number'
      ? exitCode
      : typeof exitCode === 'string' && /^(0|[1-9]\d{0,2})$/.test(exitCode)
        ? Number(exitCode)
        : NaN;
  if (
    !Number.isInteger(parsedExitCode) ||
    parsedExitCode < 0 ||
    parsedExitCode > 255
  ) {
    return undefined;
  }
  return `stage=${stage} exit_code=${parsedExitCode}`;
}

export function classifySynapseStartupLines(lines) {
  const observed = new Set();
  for (const line of lines) {
    for (const [category, patterns] of CATEGORY_PATTERNS) {
      if (patterns.some((pattern) => pattern.test(line))) {
        observed.add(category);
      }
    }
  }
  return (
    CATEGORIES.find((category) => observed.has(category)) ?? 'unclassified'
  );
}

export function parseContainerState(output) {
  if (typeof output !== 'string') {
    return unavailableContainerState('inspect-data-invalid');
  }
  const fields = output.trim().split(/\s+/);
  if (fields.length !== 4) {
    return unavailableContainerState('inspect-data-invalid');
  }
  const [state, rawExitCode, rawOom, rawHealth] = fields;
  const exitCode = /^(0|[1-9]\d{0,2})$/.test(rawExitCode)
    ? Number(rawExitCode)
    : NaN;
  const health = rawHealth === 'none' ? 'not-reported' : rawHealth;
  if (
    !CONTAINER_STATES.includes(state) ||
    state === 'unavailable' ||
    !Number.isInteger(exitCode) ||
    exitCode > 255 ||
    !['true', 'false'].includes(rawOom) ||
    !HEALTH_STATES.includes(health) ||
    health === 'unavailable'
  ) {
    return unavailableContainerState('inspect-data-invalid');
  }
  return {
    inspectResult: 'ok',
    state,
    health,
    exitCode,
    oom: rawOom,
  };
}

function unavailableContainerState(inspectResult) {
  return {
    inspectResult,
    state: 'unavailable',
    health: 'unavailable',
    exitCode: 'unavailable',
    oom: 'unavailable',
  };
}

export function parseContainerListResult(result) {
  if (result?.error || result?.status !== 0) {
    return unavailableContainerState('compose-list-failed');
  }
  if (typeof result.stdout !== 'string') {
    return unavailableContainerState('container-id-malformed');
  }
  const output = result.stdout.trim();
  if (!output) {
    return unavailableContainerState('container-id-missing');
  }
  if (!/^[a-f\d]{12,64}$/i.test(output)) {
    return unavailableContainerState('container-id-malformed');
  }
  return { inspectResult: 'ok', containerId: output };
}

export function parseContainerInspectResult(result) {
  if (result?.error || result?.status !== 0) {
    return unavailableContainerState('inspect-failed');
  }
  return parseContainerState(result.stdout);
}

export function formatStartupDiagnostic(category, state) {
  const safeCategory =
    CATEGORIES.includes(category) || category === 'unclassified'
      ? category
      : 'unclassified';
  const exitCode =
    Number.isInteger(state?.exitCode) &&
    state.exitCode >= 0 &&
    state.exitCode <= 255
      ? state.exitCode
      : 'unavailable';
  const oom =
    state?.oom === 'true' || state?.oom === true
      ? 'true'
      : state?.oom === 'false' || state?.oom === false
        ? 'false'
        : 'unavailable';
  const inspectResult = INSPECT_RESULTS.includes(state?.inspectResult)
    ? state.inspectResult
    : 'unavailable';
  const containerState = CONTAINER_STATES.includes(state?.state)
    ? state.state
    : 'unavailable';
  const health = HEALTH_STATES.includes(state?.health)
    ? state.health
    : 'unavailable';
  return `category=${safeCategory} inspect_result=${inspectResult} state=${containerState} health=${health} exit_code=${exitCode} oom=${oom}`;
}

function readContainerState(composeFile) {
  let listed;
  try {
    listed = spawnSync(
      'docker',
      ['compose', '-f', composeFile, 'ps', '--all', '-q', 'synapse'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
  } catch {
    return unavailableContainerState('compose-list-failed');
  }
  const container = parseContainerListResult(listed);
  if (container.inspectResult !== 'ok') {
    return container;
  }

  let inspected;
  try {
    inspected = spawnSync(
      'docker',
      [
        'inspect',
        '--format',
        '{{.State.Status}} {{.State.ExitCode}} {{.State.OOMKilled}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}',
        container.containerId,
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
  } catch {
    return unavailableContainerState('inspect-failed');
  }
  return parseContainerInspectResult(inspected);
}

async function run() {
  if (process.argv[2] === '--stage-failure') {
    const marker = formatStartupStageFailure(process.argv[3], process.argv[4]);
    if (marker) {
      process.stdout.write(`${marker}\n`);
    }
    return;
  }

  const composeFile = process.argv[2];
  const observed = new Set();
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of input) {
    const category = classifySynapseStartupLines([line]);
    if (category !== 'unclassified') {
      observed.add(category);
    }
  }
  const category =
    CATEGORIES.find((candidate) => observed.has(candidate)) ?? 'unclassified';
  const state = composeFile
    ? readContainerState(composeFile)
    : unavailableContainerState('not-attempted');
  process.stdout.write(`${formatStartupDiagnostic(category, state)}\n`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  run().catch(() => {
    process.stdout.write(
      'category=unclassified inspect_result=unavailable state=unavailable health=unavailable exit_code=unavailable oom=unavailable\n',
    );
  });
}
