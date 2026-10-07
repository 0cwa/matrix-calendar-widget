import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  diagnoseMissingModule,
  loadRuntimeDependencyAllowlist,
} from './element-acceptance-diagnostics.mjs';

const SERVICE_USER_ID = '@_matrix_calendar_service:localhost';
const SERVICE_LOCALPART = '_matrix_calendar_service';
const CALENDAR_ID = 'element-acceptance';
const ROOM_NAME = 'Synthetic calendar acceptance';
const OUTSIDER_ROOM_NAME = 'Synthetic outsider room';
const HOMESERVER_URL = 'http://127.0.0.1:8008';
const RADICALE_URL = 'http://127.0.0.1:5232/';
const ELEMENT_URL = 'http://127.0.0.1:8090';
const GATEWAY_URL = 'http://127.0.0.1:3000';
const WIDGET_URL = 'http://127.0.0.1:8080';
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
]);

class FixtureSetupError extends Error {
  constructor(
    phase,
    httpStatus,
    failureCode,
    processExitCode,
    serviceDiagnostic,
  ) {
    super('Element acceptance fixture setup failed');
    this.phase = phase;
    this.httpStatus = httpStatus;
    this.failureCode = failureCode;
    this.processExitCode = processExitCode;
    this.serviceDiagnostic = serviceDiagnostic;
  }
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw new FixtureSetupError('accounts-ready');
  }
  return value;
}

function stagePath() {
  const runnerTemp = process.env.RUNNER_TEMP;
  const path = process.env.ELEMENT_ACCEPTANCE_STAGE_FILE;
  if (!runnerTemp || !path || !isAbsolute(path)) {
    throw new FixtureSetupError('accounts-ready');
  }
  const root = resolve(runnerTemp) + sep;
  if (!resolve(path).startsWith(root)) {
    throw new FixtureSetupError('accounts-ready');
  }
  return path;
}

function recordStage(phase, status, extra = {}) {
  if (!PHASES.has(phase)) throw new FixtureSetupError('accounts-ready');
  const record = { phase, status, ...extra };
  appendFileSync(stagePath(), `${JSON.stringify(record)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
}

async function runPhase(phase, operation) {
  recordStage(phase, 'started');
  try {
    const result = await operation();
    recordStage(phase, 'passed');
    return result;
  } catch (error) {
    const details =
      error instanceof FixtureSetupError
        ? {
            ...(Number.isInteger(error.httpStatus)
              ? { httpStatus: error.httpStatus }
              : {}),
            ...(Number.isInteger(error.processExitCode)
              ? { processExitCode: error.processExitCode }
              : {}),
            ...(typeof error.failureCode === 'string'
              ? { failureCode: error.failureCode }
              : {}),
          }
        : {};
    recordStage(phase, 'failed', details);
    throw new FixtureSetupError(
      phase,
      details.httpStatus,
      details.failureCode,
      details.processExitCode,
    );
  }
}

function addMask(value) {
  if (process.env.GITHUB_ACTIONS === 'true') {
    process.stdout.write(`::add-mask::${value}\n`);
  }
}

function safeCredential(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    !/[\r\n\u0000-\u001f]/u.test(value)
  );
}

function matrixUserId(localpart) {
  return `@${localpart}:localhost`;
}

function createUser(localpart, password, phase) {
  const projectName = requiredEnvironment('COMPOSE_PROJECT_NAME');
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/u.test(projectName)) {
    throw new FixtureSetupError(phase, undefined, 'invalid-project-name');
  }

  try {
    execFileSync(
      'docker',
      [
        'compose',
        '-p',
        projectName,
        '-f',
        'dev/compose.yaml',
        'exec',
        '-T',
        'synapse',
        'register_new_matrix_user',
        '-c',
        '/data/homeserver.yaml',
        '-u',
        localpart,
        '--password-file',
        '/dev/stdin',
        '--no-admin',
        'http://localhost:8008',
      ],
      {
        cwd: resolve(dirname(fileURLToPath(import.meta.url)), '..'),
        encoding: 'utf8',
        input: `${password}\n`,
        maxBuffer: 1024 * 1024,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
  } catch (error) {
    const processExitCode =
      Number.isInteger(error?.status) &&
      error.status >= 0 &&
      error.status <= 255
        ? error.status
        : undefined;
    throw new FixtureSetupError(
      phase,
      undefined,
      processExitCode === undefined
        ? 'docker-process-spawn-failed'
        : 'docker-command-failed',
      processExitCode,
    );
  }
}

async function matrixJson(path, { token, method = 'GET', body } = {}, phase) {
  let response;
  try {
    response = await fetch(new URL(path, HOMESERVER_URL), {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new FixtureSetupError(phase, undefined, 'matrix-transport-failed');
  }

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new FixtureSetupError(phase, response.status, 'matrix-http-failed');
  }

  try {
    return await response.json();
  } catch {
    throw new FixtureSetupError(phase, response.status, 'matrix-invalid-json');
  }
}

async function registerAndLogin(localpart, password, actor) {
  const registrationPhase = `${actor}-registration`;
  const loginPhase = `${actor}-login`;
  await runPhase(registrationPhase, async () =>
    createUser(localpart, password, registrationPhase),
  );
  return runPhase(loginPhase, async () => {
    const response = await matrixJson(
      '/_matrix/client/v3/login',
      {
        method: 'POST',
        body: {
          type: 'm.login.password',
          identifier: { type: 'm.id.user', user: localpart },
          password,
        },
      },
      loginPhase,
    );

    if (
      response.user_id !== matrixUserId(localpart) ||
      !safeCredential(response.access_token) ||
      !safeCredential(response.device_id)
    ) {
      throw new FixtureSetupError(
        loginPhase,
        undefined,
        'invalid-login-response',
      );
    }

    addMask(response.access_token);
    return {
      userId: response.user_id,
      accessToken: response.access_token,
      deviceId: response.device_id,
    };
  });
}

async function createRoom(token, name, invite = []) {
  const response = await matrixJson(
    '/_matrix/client/v3/createRoom',
    {
      method: 'POST',
      token,
      body: {
        name,
        preset: 'private_chat',
        invite,
        creation_content: { 'm.federate': false },
      },
    },
    'room-ready',
  );

  if (!safeCredential(response.room_id)) {
    throw new FixtureSetupError('room-ready');
  }
  return response.room_id;
}

async function joinRoom(token, roomId) {
  await matrixJson(
    `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/join`,
    { method: 'POST', token },
    'room-ready',
  );
}

async function createServiceCalendar(applicationServiceToken) {
  const serviceUser = await matrixJson(
    '/_matrix/client/v3/register',
    {
      method: 'POST',
      token: applicationServiceToken,
      body: {
        type: 'm.login.application_service',
        username: SERVICE_LOCALPART,
      },
    },
    'service-calendar-ready',
  );

  if (
    serviceUser.user_id !== SERVICE_USER_ID ||
    !safeCredential(serviceUser.access_token)
  ) {
    throw new FixtureSetupError('service-calendar-ready');
  }
  addMask(serviceUser.access_token);

  const proof = await matrixJson(
    `/_matrix/client/v3/user/${encodeURIComponent(SERVICE_USER_ID)}/openid/request_token`,
    {
      method: 'POST',
      token: applicationServiceToken,
      body: { user_id: SERVICE_USER_ID },
    },
    'service-calendar-ready',
  );

  if (
    !safeCredential(proof.access_token) ||
    proof.matrix_server_name !== 'localhost'
  ) {
    throw new FixtureSetupError('service-calendar-ready');
  }

  addMask(proof.access_token);
  const delegatedCredential = `matrix-openid:${Buffer.from(
    JSON.stringify({
      access_token: proof.access_token,
      matrix_server_name: proof.matrix_server_name,
    }),
  ).toString('base64url')}`;
  const authorization = `Basic ${Buffer.from(
    `${SERVICE_LOCALPART}:${delegatedCredential}`,
  ).toString('base64')}`;
  const collectionUrl = new URL(
    `${encodeURIComponent(SERVICE_LOCALPART)}/${encodeURIComponent(CALENDAR_ID)}/`,
    RADICALE_URL,
  );

  let response;
  try {
    response = await fetch(collectionUrl, {
      method: 'MKCALENDAR',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/xml; charset=utf-8',
      },
      body: [
        '<?xml version="1.0" encoding="utf-8" ?>',
        '<C:mkcalendar xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:D="DAV:">',
        '<D:set><D:prop><D:displayname>Synthetic team calendar</D:displayname>',
        '<C:supported-calendar-component-set><C:comp name="VEVENT"/></C:supported-calendar-component-set>',
        '</D:prop></D:set></C:mkcalendar>',
      ].join(''),
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new FixtureSetupError('service-calendar-ready');
  }

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new FixtureSetupError('service-calendar-ready', response.status);
  }
}

async function registerWidget(stateRoomId, targetRoomId, actor, widgetId) {
  const url = new URL('/', WIDGET_URL);
  url.searchParams.set('meetings_bot_base_url', GATEWAY_URL);
  // Keep the target room literal for the outsider cross-room probe.
  url.searchParams.set('matrix_room_id', targetRoomId);
  // Element fills these standard widget-context placeholders at launch.
  url.hash =
    '/?theme=$org.matrix.msc2873.client_theme' +
    '&matrix_user_id=$matrix_user_id' +
    '&matrix_display_name=$matrix_display_name' +
    '&matrix_avatar_url=$matrix_avatar_url' +
    '&matrix_client_id=$org.matrix.msc2873.client_id' +
    '&matrix_client_language=$org.matrix.msc2873.client_language' +
    '&matrix_device_id=$org.matrix.msc3819.matrix_device_id' +
    '&matrix_base_url=$org.matrix.msc4039.matrix_base_url';
  await matrixJson(
    `/_matrix/client/v3/rooms/${encodeURIComponent(stateRoomId)}/state/im.vector.modular.widgets/${encodeURIComponent(widgetId)}`,
    {
      method: 'PUT',
      token: actor.accessToken,
      body: {
        creator: actor.userId,
        type: 'custom',
        url: url.toString(),
        name: 'Matrix Calendar',
      },
    },
    'widget-registered',
  );
}

function writeComposeEnvironment(path, values) {
  const lines = [];
  for (const [key, value] of Object.entries(values)) {
    if (!safeCredential(value) || value.includes("'")) {
      throw new FixtureSetupError('runtime-ready');
    }
    lines.push(`${key}='${value}'`);
  }
  writeFileSync(path, `${lines.join('\n')}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
}

function writePrivateJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
}

function classifyGatewayStartupFailure(text) {
  const categories = [
    [
      'gateway-listener-port-conflict',
      /\bEADDRINUSE\b|port is already allocated/iu,
    ],
    ['gateway-matrix-unauthorized', /\bM_UNKNOWN_TOKEN\b|\bM_FORBIDDEN\b/iu],
    ['gateway-matrix-connect-failed', /\bECONNREFUSED\b/iu],
    [
      'gateway-module-load-failed',
      /\bERR_MODULE_NOT_FOUND\b|Cannot find (?:package|module)\b/iu,
    ],
    [
      'gateway-config-validation-failed',
      /\bJoi validation failed\b|\bValidationError\b/iu,
    ],
    [
      'gateway-out-of-memory',
      /JavaScript heap out of memory|OOMKilled\s*[:=]\s*true/iu,
    ],
  ];
  return (
    categories.find(([, pattern]) => pattern.test(text))?.[0] ??
    'gateway-startup-unknown'
  );
}

function missingModuleDetails(text, rootDirectory) {
  return diagnoseMissingModule(
    text,
    loadRuntimeDependencyAllowlist(rootDirectory),
  );
}

function readComposeServiceDiagnostic(service) {
  const unavailable = {
    containerState: 'unavailable',
    containerHealth: 'unavailable',
    failureCode: 'gateway-startup-unknown',
  };
  const projectName = process.env.COMPOSE_PROJECT_NAME;
  const envFile = process.env.ELEMENT_ACCEPTANCE_SERVER_ENV_FILE;
  const runnerTemp = process.env.RUNNER_TEMP;
  if (
    !projectName ||
    !/^[a-z0-9][a-z0-9_-]{0,62}$/u.test(projectName) ||
    !envFile ||
    !isAbsolute(envFile) ||
    !runnerTemp ||
    !resolve(envFile).startsWith(resolve(runnerTemp) + sep)
  ) {
    return unavailable;
  }

  const cwd = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const composeArgs = [
    'compose',
    '-p',
    projectName,
    '--env-file',
    envFile,
    '-f',
    'dev/compose.yaml',
    '-f',
    'dev/element-acceptance.compose.yaml',
  ];
  try {
    const ids = execFileSync(
      'docker',
      [...composeArgs, 'ps', '--all', '-q', service],
      {
        cwd,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 10_000,
      },
    )
      .trim()
      .split(/\s+/u)
      .filter(Boolean);
    if (ids.length !== 1 || !/^[a-f0-9]{12,64}$/iu.test(ids[0])) {
      return unavailable;
    }

    const stateJson = execFileSync(
      'docker',
      ['inspect', '--format', '{{json .State}}', ids[0]],
      {
        cwd,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 10_000,
      },
    );
    const state = JSON.parse(stateJson);
    const states = new Set([
      'created',
      'restarting',
      'running',
      'removing',
      'paused',
      'exited',
      'dead',
    ]);
    const healthStates = new Set(['starting', 'healthy', 'unhealthy']);
    let logText = '';
    try {
      logText = execFileSync(
        'docker',
        [...composeArgs, 'logs', '--no-color', '--tail', '200', service],
        {
          cwd,
          encoding: 'utf8',
          maxBuffer: 4 * 1024 * 1024,
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 10_000,
        },
      );
    } catch {
      // Keep only fixed classifications; raw service output stays in memory.
    }
    const startupText = `${typeof state.Error === 'string' ? state.Error : ''}\n${logText}`;
    const failureCode =
      state.OOMKilled === true
        ? 'gateway-out-of-memory'
        : classifyGatewayStartupFailure(startupText);
    const diagnostic = {
      containerState: states.has(state.Status) ? state.Status : 'unavailable',
      containerHealth:
        state.Health === null || state.Health === undefined
          ? 'none'
          : healthStates.has(state.Health.Status)
            ? state.Health.Status
            : 'unavailable',
      failureCode,
    };
    if (failureCode === 'gateway-module-load-failed') {
      Object.assign(diagnostic, missingModuleDetails(startupText, cwd));
    }
    if (
      Number.isInteger(state.ExitCode) &&
      state.ExitCode >= 0 &&
      state.ExitCode <= 255
    ) {
      diagnostic.containerExitCode = state.ExitCode;
    }
    if (typeof state.OOMKilled === 'boolean') {
      diagnostic.containerOomKilled = state.OOMKilled;
    }
    if (typeof state.Error === 'string') {
      diagnostic.containerRuntimeErrorPresent = state.Error.length > 0;
    }
    return diagnostic;
  } catch {
    return unavailable;
  }
}

async function provision() {
  const stageFile = stagePath();
  const userFile = requiredEnvironment('ELEMENT_ACCEPTANCE_USERS_FILE');
  const serverEnvFile = requiredEnvironment(
    'ELEMENT_ACCEPTANCE_SERVER_ENV_FILE',
  );
  const applicationServiceToken = requiredEnvironment(
    'MATRIX_APPLICATION_SERVICE_TOKEN',
  );
  if (!safeCredential(applicationServiceToken)) {
    throw new FixtureSetupError('accounts-ready');
  }
  addMask(applicationServiceToken);

  for (const path of [userFile, serverEnvFile]) {
    if (
      !isAbsolute(path) ||
      !resolve(path).startsWith(resolve(process.env.RUNNER_TEMP ?? '') + sep)
    ) {
      throw new FixtureSetupError('accounts-ready');
    }
  }

  const suffix = randomBytes(5).toString('hex');
  const actorPasswords = {
    memberA: randomBytes(24).toString('base64url'),
    memberB: randomBytes(24).toString('base64url'),
    outsider: randomBytes(24).toString('base64url'),
    bot: randomBytes(24).toString('base64url'),
  };
  const actorLocalparts = {
    memberA: `element-${suffix}-a`,
    memberB: `element-${suffix}-b`,
    outsider: `element-${suffix}-c`,
    bot: `element-${suffix}-bot`,
  };

  const actors = await runPhase('accounts-ready', async () => {
    const memberA = await registerAndLogin(
      actorLocalparts.memberA,
      actorPasswords.memberA,
      'member-a',
    );
    const memberB = await registerAndLogin(
      actorLocalparts.memberB,
      actorPasswords.memberB,
      'member-b',
    );
    const outsider = await registerAndLogin(
      actorLocalparts.outsider,
      actorPasswords.outsider,
      'outsider',
    );
    const bot = await registerAndLogin(
      actorLocalparts.bot,
      actorPasswords.bot,
      'bot',
    );
    return { memberA, memberB, outsider, bot };
  });

  const rooms = await runPhase('room-ready', async () => {
    const teamRoomId = await createRoom(actors.memberA.accessToken, ROOM_NAME, [
      actors.memberB.userId,
      actors.bot.userId,
    ]);
    await Promise.all([
      joinRoom(actors.memberB.accessToken, teamRoomId),
      joinRoom(actors.bot.accessToken, teamRoomId),
    ]);
    const outsiderRoomId = await createRoom(
      actors.outsider.accessToken,
      OUTSIDER_ROOM_NAME,
      [actors.bot.userId],
    );
    await joinRoom(actors.bot.accessToken, outsiderRoomId);
    return { teamRoomId, outsiderRoomId };
  });

  await runPhase('widget-registered', async () => {
    await registerWidget(
      rooms.teamRoomId,
      rooms.teamRoomId,
      actors.memberA,
      'matrix-calendar-team-calendar',
    );
    // The outsider opens a widget in their own room whose room parameter
    // targets the team room. The gateway must still authorize the Matrix user.
    await registerWidget(
      rooms.outsiderRoomId,
      rooms.teamRoomId,
      actors.outsider,
      'matrix-calendar-outsider-probe',
    );
  });

  await runPhase('service-calendar-ready', () =>
    createServiceCalendar(applicationServiceToken),
  );

  const bot = actors.bot;
  addMask(bot.accessToken);
  writeComposeEnvironment(serverEnvFile, {
    ELEMENT_ACCEPTANCE_BOT_ACCESS_TOKEN: bot.accessToken,
    ELEMENT_ACCEPTANCE_ROOM_BINDING: JSON.stringify([
      { roomId: rooms.teamRoomId, calendarId: CALENDAR_ID },
    ]),
    MATRIX_APPLICATION_SERVICE_TOKEN: applicationServiceToken,
  });

  const publicActors = {
    memberA: actors.memberA,
    memberB: actors.memberB,
    outsider: actors.outsider,
  };
  writePrivateJson(userFile, {
    homeserverUrl: HOMESERVER_URL,
    elementUrl: ELEMENT_URL,
    gatewayUrl: GATEWAY_URL,
    widgetUrl: WIDGET_URL,
    roomName: ROOM_NAME,
    outsiderRoomName: OUTSIDER_ROOM_NAME,
    teamRoomId: rooms.teamRoomId,
    outsiderRoomId: rooms.outsiderRoomId,
    calendarId: CALENDAR_ID,
    users: publicActors,
  });

  recordStage('runtime-ready', 'passed');
  process.stdout.write('Element acceptance fixture setup complete.\n');
}

async function waitForEndpoint(phase, url, expectedStatus) {
  recordStage(phase, 'started');
  const deadline = Date.now() + 120_000;
  let lastStatus;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        redirect: 'error',
        signal: AbortSignal.timeout(5_000),
      });
      lastStatus = response.status;
      await response.body?.cancel().catch(() => undefined);
      if (expectedStatus(response.status)) {
        recordStage(phase, 'passed', { httpStatus: response.status });
        return;
      }
    } catch {
      // The listener may still be starting. No raw error text is retained.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000));
  }
  const serviceDiagnostic =
    phase === 'gateway-ready' ? readComposeServiceDiagnostic('gateway') : {};
  recordStage(phase, 'failed', {
    ...(Number.isInteger(lastStatus) ? { httpStatus: lastStatus } : {}),
    ...serviceDiagnostic,
  });
  throw new FixtureSetupError(
    phase,
    lastStatus,
    undefined,
    undefined,
    serviceDiagnostic,
  );
}

async function waitForServices() {
  await waitForEndpoint(
    'gateway-ready',
    `${GATEWAY_URL}/v1/calendar/context`,
    (status) => status >= 400 && status < 500,
  );
  await waitForEndpoint(
    'widget-ready',
    `${WIDGET_URL}/`,
    (status) => status === 200,
  );
  await waitForEndpoint(
    'element-ready',
    `${ELEMENT_URL}/`,
    (status) => status === 200,
  );
  process.stdout.write('Element acceptance services are ready.\n');
}

async function main() {
  const mode = process.argv[2] ?? 'setup';
  try {
    if (mode === 'setup') {
      await provision();
    } else if (mode === 'wait') {
      await waitForServices();
    } else {
      throw new FixtureSetupError('accounts-ready');
    }
  } catch (error) {
    const phase =
      error instanceof FixtureSetupError && PHASES.has(error.phase)
        ? error.phase
        : 'accounts-ready';
    const details =
      error instanceof FixtureSetupError
        ? {
            ...(Number.isInteger(error.httpStatus)
              ? { httpStatus: error.httpStatus }
              : {}),
            ...(Number.isInteger(error.processExitCode)
              ? { processExitCode: error.processExitCode }
              : {}),
            ...(typeof error.failureCode === 'string'
              ? { failureCode: error.failureCode }
              : {}),
            ...(error.serviceDiagnostic ?? {}),
          }
        : {};
    try {
      recordStage(phase, 'failed', details);
    } catch {
      // Keep failure output fixed even if the private stage file is unavailable.
    }
    const failureDetails = [
      ...(Number.isInteger(details.httpStatus)
        ? [`http_status=${details.httpStatus}`]
        : []),
      ...(typeof details.failureCode === 'string'
        ? [`failure_code=${details.failureCode}`]
        : []),
      ...(Number.isInteger(details.processExitCode)
        ? [`process_exit_code=${details.processExitCode}`]
        : []),
    ];
    process.stderr.write(
      `Element acceptance fixture failed phase=${phase}${failureDetails.length > 0 ? ` ${failureDetails.join(' ')}` : ''}\n`,
    );
    process.exitCode = 1;
  }
}

main();
