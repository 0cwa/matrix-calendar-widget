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

export function classifySynapseStartupLines(lines) {
  const observed = new Set();
  for (const line of lines) {
    for (const [category, patterns] of CATEGORY_PATTERNS) {
      if (patterns.some((pattern) => pattern.test(line))) {
        observed.add(category);
      }
    }
  }
  return CATEGORIES.find((category) => observed.has(category)) ?? 'unclassified';
}

export function parseContainerState(output) {
  if (typeof output !== 'string') {
    return { exitCode: 'unavailable', oom: 'unavailable' };
  }
  const match = output.trim().match(/^(\d{1,3})\s+(true|false)$/);
  if (!match || Number(match[1]) > 255) {
    return { exitCode: 'unavailable', oom: 'unavailable' };
  }
  return { exitCode: Number(match[1]), oom: match[2] };
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
  return `category=${safeCategory} exit_code=${exitCode} oom=${oom}`;
}

function readContainerState(composeFile) {
  try {
    const listed = spawnSync(
      'docker',
      ['compose', '-f', composeFile, 'ps', '--all', '-q', 'synapse'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    if (listed.error || listed.status !== 0) {
      return { exitCode: 'unavailable', oom: 'unavailable' };
    }
    const containerId = listed.stdout.trim().split(/\s+/)[0];
    if (!/^[a-f\d]{12,64}$/i.test(containerId ?? '')) {
      return { exitCode: 'unavailable', oom: 'unavailable' };
    }
    const inspected = spawnSync(
      'docker',
      ['inspect', '--format', '{{.State.ExitCode}} {{.State.OOMKilled}}', containerId],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    if (inspected.error || inspected.status !== 0) {
      return { exitCode: 'unavailable', oom: 'unavailable' };
    }
    return parseContainerState(inspected.stdout);
  } catch {
    return { exitCode: 'unavailable', oom: 'unavailable' };
  }
}

async function run() {
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
    : { exitCode: 'unavailable', oom: 'unavailable' };
  process.stdout.write(`${formatStartupDiagnostic(category, state)}\n`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  run().catch(() => {
    process.stdout.write('category=unclassified exit_code=unavailable oom=unavailable\n');
  });
}
