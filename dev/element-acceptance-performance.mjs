import {
  appendFileSync,
  chmodSync,
  existsSync,
  lstatSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVICE_USER_ID = '@_matrix_calendar_service:localhost';
const SERVICE_LOCALPART = '_matrix_calendar_service';
const CALENDAR_ID = 'element-acceptance';
const TIMEZONE = 'Europe/Stockholm';
const HOMESERVER_URL = 'http://127.0.0.1:8008';
const CALDAV_URL = 'http://127.0.0.1:5232/';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const MAX_EVENTS = 250;
const PERFORMANCE_MANIFEST_STATES = new Set([
  'planned',
  'creating',
  'created',
  'conflict',
  'deleted',
  'absent',
]);

export function next31DayMonth(now = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(now)
      .filter(({ type }) => type !== 'literal')
      .map(({ type, value }) => [type, Number(value)]),
  );
  let year = parts.year;
  let month = parts.month;
  for (let attempt = 0; attempt < 24; attempt += 1) {
    if (daysInMonth(year, month) === 31) {
      const todayIsThisMonth = year === parts.year && month === parts.month;
      if (!todayIsThisMonth || parts.day === 1) return { year, month };
    }
    month += 1;
    if (month === 13) {
      month = 1;
      year += 1;
    }
  }
  throw new Error('No 31-day month found in bounded search');
}

export function buildPerformanceEvents(year, month, runId, attempt) {
  if (
    !Number.isInteger(year) ||
    year < 2020 ||
    year > 2200 ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12 ||
    daysInMonth(year, month) !== 31 ||
    !/^\d{1,20}$/u.test(runId) ||
    !/^\d{1,6}$/u.test(attempt)
  ) {
    throw new Error('Invalid fixed performance event plan');
  }

  return Array.from({ length: MAX_EVENTS }, (_, index) => {
    const day = (index % 31) + 1;
    const slot = Math.floor(index / 31);
    const startMinute = 8 * 60 + slot * 45;
    const endMinute = startMinute + 30;
    const uid = `element-performance-${runId}-${attempt}-${String(index + 1).padStart(3, '0')}@matrix-calendar-widget`;
    const title = `Performance ${runId}-${attempt}-${String(index + 1).padStart(3, '0')}`;
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return {
      uid,
      title,
      day,
      start: `${date}T${formatTime(startMinute)}:00`,
      end: `${date}T${formatTime(endMinute)}:00`,
    };
  });
}

export function isSafePerformanceManifest(value, runId, attempt) {
  if (Array.isArray(value) && value.length === 0) return true;
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 6 ||
    value.version !== 2 ||
    value.runId !== runId ||
    value.attempt !== attempt ||
    !Number.isInteger(value.year) ||
    value.year < 2020 ||
    value.year > 2200 ||
    !Number.isInteger(value.month) ||
    value.month < 1 ||
    value.month > 12 ||
    daysInMonth(value.year, value.month) !== 31 ||
    !Array.isArray(value.events) ||
    value.events.length > MAX_EVENTS
  ) {
    return false;
  }
  const seen = new Set();
  return value.events.every((entry) => {
    const hasEtag = Object.hasOwn(entry ?? {}, 'etag');
    const needsEtag = entry?.state === 'deleted' || entry?.state === 'absent';
    if (
      !isRecord(entry) ||
      (Object.keys(entry).length !== 2 && Object.keys(entry).length !== 3) ||
      !PERFORMANCE_MANIFEST_STATES.has(entry.state) ||
      (needsEtag && !hasEtag) ||
      (hasEtag && entry.state !== 'created' && !needsEtag) ||
      typeof entry.resourceName !== 'string' ||
      !new RegExp(
        `^element-performance-${escapeRegExp(runId)}-${escapeRegExp(attempt)}-[0-9]{3}\\.ics$`,
        'u',
      ).test(entry.resourceName) ||
      seen.has(entry.resourceName) ||
      (hasEtag &&
        (typeof entry.etag !== 'string' ||
          !/^"[\x21\x23-\x7e]*"$/u.test(entry.etag)))
    ) {
      return false;
    }
    seen.add(entry.resourceName);
    return true;
  });
}

function isStrongEtag(value) {
  return typeof value === 'string' && /^"[\x21\x23-\x7e]*"$/u.test(value);
}

export async function createPerformanceManifestEvent(
  entry,
  createResource,
  persistManifest,
) {
  entry.state = 'creating';
  delete entry.etag;
  persistManifest();
  try {
    const result = await createResource();
    entry.state = 'created';
    if (isStrongEtag(result?.etag)) entry.etag = result.etag;
    persistManifest();
    return { ownershipTokenAvailable: isStrongEtag(entry.etag) };
  } catch (error) {
    if (error?.status === 409 || error?.status === 412) {
      entry.state = 'conflict';
      delete entry.etag;
      persistManifest();
    }
    throw error;
  }
}

export function summarizePerformanceManifest(events) {
  const summary = {
    manifestEventCount: events.length,
    plannedCount: 0,
    confirmedCreatedCount: 0,
    deletedCount: 0,
    alreadyAbsentCount: 0,
    conflictCount: 0,
    unresolvedCount: 0,
  };
  for (const entry of events) {
    switch (entry.state) {
      case 'planned':
        summary.plannedCount += 1;
        break;
      case 'creating':
        summary.unresolvedCount += 1;
        break;
      case 'created':
        summary.confirmedCreatedCount += 1;
        summary.unresolvedCount += 1;
        break;
      case 'conflict':
        summary.conflictCount += 1;
        break;
      case 'deleted':
        summary.confirmedCreatedCount += 1;
        summary.deletedCount += 1;
        break;
      case 'absent':
        summary.confirmedCreatedCount += 1;
        summary.alreadyAbsentCount += 1;
        break;
      default:
        throw new PerformanceFixtureError('manifest-invalid');
    }
  }
  return summary;
}

export async function cleanupPerformanceManifestEvents(
  events,
  deleteResource,
  persistManifest,
) {
  let httpStatus;
  for (const entry of events) {
    if (entry.state !== 'created' || !isStrongEtag(entry.etag)) continue;
    try {
      await deleteResource(entry.resourceName, entry.etag);
    } catch (error) {
      if (error?.status === 404) {
        entry.state = 'absent';
        await persistManifest();
        continue;
      }
      httpStatus = Number.isInteger(error?.status) ? error.status : httpStatus;
      continue;
    }
    entry.state = 'deleted';
    await persistManifest();
  }
  return { ...summarizePerformanceManifest(events), httpStatus };
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function formatTime(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw new PerformanceFixtureError('environment-invalid');
  }
  return value;
}

function privatePath(name) {
  const runnerTemp = process.env.RUNNER_TEMP;
  const value = requiredEnvironment(name);
  if (!runnerTemp || !isAbsolute(value)) {
    throw new PerformanceFixtureError('environment-invalid');
  }
  const root = resolve(runnerTemp) + sep;
  if (!resolve(value).startsWith(root)) {
    throw new PerformanceFixtureError('environment-invalid');
  }
  return resolve(value);
}

function ensureRegularOrAbsent(path) {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new PerformanceFixtureError('manifest-invalid');
    }
  } catch (error) {
    if (error instanceof PerformanceFixtureError) throw error;
    if (error?.code !== 'ENOENT')
      throw new PerformanceFixtureError('manifest-invalid');
  }
}

function writePrivateJson(path, value) {
  ensureRegularOrAbsent(path);
  writeFileSync(path, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

function readPrivateJson(path, maxBytes) {
  ensureRegularOrAbsent(path);
  let text;
  try {
    const bytes = readFileSync(path);
    if (bytes.byteLength > maxBytes) {
      throw new PerformanceFixtureError('manifest-invalid');
    }
    text = bytes.toString('utf8');
  } catch (error) {
    if (error instanceof PerformanceFixtureError) throw error;
    throw new PerformanceFixtureError('manifest-invalid');
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new PerformanceFixtureError('manifest-invalid');
  }
}

class PerformanceFixtureError extends Error {
  constructor(code, httpStatus) {
    super('Element performance fixture failed');
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function record(
  phase,
  status,
  {
    count,
    httpStatus,
    failureCode,
    manifestEventCount,
    plannedCount,
    confirmedCreatedCount,
    deletedCount,
    alreadyAbsentCount,
    conflictCount,
    unresolvedCount,
    inventoryAvailable,
  } = {},
) {
  const stageFile = privatePath('ELEMENT_ACCEPTANCE_STAGE_FILE');
  const recordValue = {
    phase,
    status,
    ...(Number.isInteger(count) ? { count } : {}),
    ...(manifestEventCount === null || Number.isInteger(manifestEventCount)
      ? { manifestEventCount }
      : {}),
    ...(plannedCount === null || Number.isInteger(plannedCount)
      ? { plannedCount }
      : {}),
    ...(confirmedCreatedCount === null ||
    Number.isInteger(confirmedCreatedCount)
      ? { confirmedCreatedCount }
      : {}),
    ...(deletedCount === null || Number.isInteger(deletedCount)
      ? { deletedCount }
      : {}),
    ...(alreadyAbsentCount === null || Number.isInteger(alreadyAbsentCount)
      ? { alreadyAbsentCount }
      : {}),
    ...(conflictCount === null || Number.isInteger(conflictCount)
      ? { conflictCount }
      : {}),
    ...(unresolvedCount === null || Number.isInteger(unresolvedCount)
      ? { unresolvedCount }
      : {}),
    ...(typeof inventoryAvailable === 'boolean' ? { inventoryAvailable } : {}),
    ...(Number.isInteger(httpStatus) ? { httpStatus } : {}),
    ...(failureCode ? { failureCode } : {}),
  };
  appendFileSync(stageFile, `${JSON.stringify(recordValue)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
}

function privateFixture() {
  const fixture = readPrivateJson(
    privatePath('ELEMENT_ACCEPTANCE_USERS_FILE'),
    64 * 1024,
  );
  if (
    !isRecord(fixture) ||
    fixture.serviceSender?.userId !== SERVICE_USER_ID ||
    typeof fixture.serviceSender?.accessToken !== 'string' ||
    fixture.serviceSender.accessToken.length < 16
  ) {
    throw new PerformanceFixtureError('environment-invalid');
  }
  return fixture;
}

async function obtainOpenIdCredential(fixture) {
  let response;
  try {
    response = await fetch(
      `${HOMESERVER_URL}/_matrix/client/v3/user/${encodeURIComponent(SERVICE_USER_ID)}/openid/request_token`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${fixture.serviceSender.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ user_id: SERVICE_USER_ID }),
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
      },
    );
  } catch {
    throw new PerformanceFixtureError('openid-failed');
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new PerformanceFixtureError('openid-failed', response.status);
  }
  let proof;
  try {
    proof = await response.json();
  } catch {
    throw new PerformanceFixtureError('openid-failed', response.status);
  }
  if (
    !isRecord(proof) ||
    typeof proof.access_token !== 'string' ||
    proof.access_token.length < 16 ||
    proof.matrix_server_name !== 'localhost'
  ) {
    throw new PerformanceFixtureError('openid-failed', response.status);
  }
  return { accessToken: proof.access_token, matrixServerName: 'localhost' };
}

function loadServerClasses() {
  try {
    return {
      CalDavEventClient: require(
        resolve(
          ROOT,
          'matrix-calendar-server/lib/src/caldav/CalDavEventClient.js',
        ),
      ).CalDavEventClient,
      ICalendarEventCodec: require(
        resolve(
          ROOT,
          'matrix-calendar-server/lib/src/caldav/ICalendarEventCodec.js',
        ),
      ).ICalendarEventCodec,
      MatrixOpenIdCalDavCredentialProvider: require(
        resolve(
          ROOT,
          'matrix-calendar-server/lib/src/caldav/MatrixOpenIdCalDavCredentialProvider.js',
        ),
      ).MatrixOpenIdCalDavCredentialProvider,
    };
  } catch {
    throw new PerformanceFixtureError('runtime-dependency-unavailable');
  }
}

function makeClient(fixture, openIdCredential) {
  const { CalDavEventClient, MatrixOpenIdCalDavCredentialProvider } =
    loadServerClasses();
  const credentials = new MatrixOpenIdCalDavCredentialProvider(
    fixture.serviceSender.userId,
    {
      accessToken: openIdCredential.accessToken,
      matrixServerName: openIdCredential.matrixServerName,
    },
  );
  return new CalDavEventClient(credentials);
}

function calendarCollectionUrl() {
  return new URL(
    `${encodeURIComponent(SERVICE_LOCALPART)}/${encodeURIComponent(CALENDAR_ID)}/`,
    CALDAV_URL,
  ).toString();
}

function expectedManifest(runId, attempt) {
  return { version: 2, runId, attempt, events: [] };
}

function manifestIdentity() {
  const runId = requiredEnvironment('GITHUB_RUN_ID');
  const attempt = requiredEnvironment('GITHUB_RUN_ATTEMPT');
  if (!/^\d{1,20}$/u.test(runId) || !/^\d{1,6}$/u.test(attempt)) {
    throw new PerformanceFixtureError('environment-invalid');
  }
  return { runId, attempt };
}

function readManifest(path, runId, attempt) {
  const value = readPrivateJson(path, 256 * 1024);
  if (Array.isArray(value) && value.length === 0)
    return expectedManifest(runId, attempt);
  if (!isSafePerformanceManifest(value, runId, attempt)) {
    throw new PerformanceFixtureError('manifest-invalid');
  }
  return value;
}

async function seed() {
  const manifestPath = privatePath(
    'ELEMENT_ACCEPTANCE_PERFORMANCE_MANIFEST_FILE',
  );
  const { runId, attempt } = manifestIdentity();
  const { year, month } = next31DayMonth();
  let createdCount = 0;
  let httpStatus;
  record('performance-seed', 'started');
  try {
    const fixture = privateFixture();
    const manifest = readManifest(manifestPath, runId, attempt);
    if (manifest.events.length !== 0) {
      throw new PerformanceFixtureError('manifest-invalid');
    }
    const monthManifest = {
      version: 2,
      runId,
      attempt,
      year,
      month,
      events: [],
    };
    writePrivateJson(manifestPath, monthManifest);
    const proof = await obtainOpenIdCredential(fixture);
    const client = makeClient(fixture, proof);
    const { ICalendarEventCodec } = loadServerClasses();
    const codec = new ICalendarEventCodec();
    const collectionUrl = calendarCollectionUrl();
    const events = buildPerformanceEvents(year, month, runId, attempt);
    monthManifest.events = events.map((_, index) => ({
      resourceName: `element-performance-${runId}-${attempt}-${String(index + 1).padStart(3, '0')}.ics`,
      state: 'planned',
    }));
    writePrivateJson(manifestPath, monthManifest);

    for (let index = 0; index < events.length; index += 1) {
      const event = events[index];
      const resourceName = `element-performance-${runId}-${attempt}-${String(index + 1).padStart(3, '0')}.ics`;
      const manifestEntry = monthManifest.events[index];
      if (!manifestEntry || manifestEntry.resourceName !== resourceName) {
        throw new PerformanceFixtureError('manifest-invalid');
      }
      const resourceUrl = new URL(resourceName, collectionUrl).toString();
      const encoded = codec.create(collectionUrl, resourceUrl, {
        uid: event.uid,
        title: event.title,
        timing: {
          type: 'timed',
          start: { type: 'zoned', local: event.start, timezone: TIMEZONE },
          end: { type: 'zoned', local: event.end, timezone: TIMEZONE },
        },
      });
      try {
        const creation = await createPerformanceManifestEvent(
          manifestEntry,
          () => client.createEvent(resourceUrl, encoded.icalendar),
          () => writePrivateJson(manifestPath, monthManifest),
        );
        createdCount += 1;
        httpStatus = undefined;
        if (!creation.ownershipTokenAvailable) {
          throw new PerformanceFixtureError('caldav-operation-failed');
        }
      } catch (error) {
        httpStatus = Number.isInteger(error?.status) ? error.status : undefined;
        if (
          error instanceof PerformanceFixtureError &&
          error.code === 'caldav-operation-failed'
        ) {
          throw error;
        }
        throw new PerformanceFixtureError(
          'caldav-operation-failed',
          httpStatus,
        );
      }
    }

    const githubEnv = requiredEnvironment('GITHUB_ENV');
    const envRoot = resolve(process.env.RUNNER_TEMP ?? '') + sep;
    if (!isAbsolute(githubEnv) || !resolve(githubEnv).startsWith(envRoot)) {
      throw new PerformanceFixtureError('environment-invalid');
    }
    appendFileSync(
      githubEnv,
      `ELEMENT_ACCEPTANCE_PERFORMANCE_MONTH=${year}-${String(month).padStart(2, '0')}\n`,
      {
        encoding: 'utf8',
        mode: 0o600,
      },
    );
    record('performance-seed', 'passed', { count: createdCount });
  } catch (error) {
    record('performance-seed', 'failed', {
      count: createdCount,
      httpStatus: error?.httpStatus ?? httpStatus,
      failureCode:
        error instanceof PerformanceFixtureError
          ? error.code
          : 'caldav-operation-failed',
    });
    throw new Error('Element performance seed failed');
  }
}

async function cleanup() {
  const manifestPath = privatePath(
    'ELEMENT_ACCEPTANCE_PERFORMANCE_MANIFEST_FILE',
  );
  const { runId, attempt } = manifestIdentity();
  let inventoryAvailable = false;
  let cleanupSummary = null;
  let httpStatus;
  record('performance-cleanup', 'started');
  try {
    ensureRegularOrAbsent(manifestPath);
    if (!existsSync(manifestPath)) {
      inventoryAvailable = true;
      cleanupSummary = summarizePerformanceManifest([]);
      record('performance-cleanup', 'passed', {
        ...cleanupSummary,
        inventoryAvailable,
      });
      return;
    }
    const manifest = readManifest(manifestPath, runId, attempt);
    inventoryAvailable = true;
    const needsDelete = manifest.events.some(
      (entry) => entry.state === 'created' && isStrongEtag(entry.etag),
    );
    let client;
    let collectionUrl;
    if (needsDelete) {
      const fixture = privateFixture();
      const proof = await obtainOpenIdCredential(fixture);
      client = makeClient(fixture, proof);
      collectionUrl = calendarCollectionUrl();
    }
    cleanupSummary = await cleanupPerformanceManifestEvents(
      manifest.events,
      (resourceName, etag) =>
        client.deleteEvent(
          new URL(resourceName, collectionUrl).toString(),
          etag,
        ),
      () => writePrivateJson(manifestPath, manifest),
    );
    httpStatus = cleanupSummary.httpStatus;
    if (cleanupSummary.unresolvedCount !== 0) {
      throw new PerformanceFixtureError('cleanup-incomplete', httpStatus);
    }
    rmSync(manifestPath, { force: true });
    record('performance-cleanup', 'passed', {
      ...cleanupSummary,
      inventoryAvailable,
    });
  } catch (error) {
    if (cleanupSummary === null && inventoryAvailable) {
      try {
        const manifest = readManifest(manifestPath, runId, attempt);
        cleanupSummary = summarizePerformanceManifest(manifest.events);
      } catch {
        inventoryAvailable = false;
      }
    }
    record('performance-cleanup', 'failed', {
      manifestEventCount: cleanupSummary?.manifestEventCount ?? null,
      plannedCount: cleanupSummary?.plannedCount ?? null,
      confirmedCreatedCount: cleanupSummary?.confirmedCreatedCount ?? null,
      deletedCount: cleanupSummary?.deletedCount ?? null,
      alreadyAbsentCount: cleanupSummary?.alreadyAbsentCount ?? null,
      conflictCount: cleanupSummary?.conflictCount ?? null,
      unresolvedCount: cleanupSummary?.unresolvedCount ?? null,
      inventoryAvailable,
      httpStatus: error?.httpStatus ?? httpStatus,
      failureCode:
        error instanceof PerformanceFixtureError
          ? error.code
          : 'cleanup-incomplete',
    });
    throw new Error('Element performance cleanup failed');
  }
}

async function main() {
  const mode = process.argv[2];
  if (mode === 'seed') return seed();
  if (mode === 'cleanup') return cleanup();
  throw new Error('Unsupported Element performance fixture mode');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(() => {
    process.stderr.write('Element performance fixture operation failed.\n');
    process.exitCode = 1;
  });
}
