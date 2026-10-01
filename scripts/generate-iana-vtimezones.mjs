import ICAL from 'ical.js';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const env = process.env;
const requiredEnvironment = [
  'TZDB_VERSION',
  'TZDB_SHA512',
  'TIMEZONE_LIBRARY_COMMIT',
  'TIMEZONE_LIBRARY_ROOT',
  'TIMEZONE_RAW_DATA_ROOT',
  'IANA_ARCHIVE',
  'IANA_SOURCE_ROOT',
  'TIMEZONE_ARTIFACT_DIR',
];

for (const name of requiredEnvironment) {
  if (!env[name])
    throw new Error(`Missing required environment variable: ${name}`);
}

const readHash = async (file, algorithm) =>
  createHash(algorithm)
    .update(await readFile(file))
    .digest('hex');
const run = (command, args) =>
  execFileSync(command, args, { encoding: 'utf8' }).trim();

const archiveSha512 = await readHash(env.IANA_ARCHIVE, 'sha512');
if (archiveSha512 !== env.TZDB_SHA512) {
  throw new Error(`IANA archive SHA-512 mismatch: got ${archiveSha512}`);
}

const upstreamRoot = path.resolve(env.TIMEZONE_LIBRARY_ROOT);
const rawDataRoot = path.resolve(env.TIMEZONE_RAW_DATA_ROOT);
const upstreamCommit = run('git', ['-C', upstreamRoot, 'rev-parse', 'HEAD']);
if (upstreamCommit !== env.TIMEZONE_LIBRARY_COMMIT) {
  throw new Error(`Unexpected timezone generator commit: ${upstreamCommit}`);
}

const upstreamPackage = JSON.parse(
  await readFile(path.join(upstreamRoot, 'package.json'), 'utf8'),
);
const upstreamModule = await import(
  pathToFileURL(path.join(upstreamRoot, 'dist/mjs/index.js')).href
);
const rawTimezones = upstreamModule.tzlib_get_timezones();
if (!Array.isArray(rawTimezones)) {
  throw new Error('Pinned timezone library did not return a timezone list');
}

// The pinned upstream updater adds these convenience abbreviations after VZIC
// has generated the IANA database. They are not IANA time zone identifiers.
const upstreamOnlyAliases = new Set(['CT', 'ET', 'MT', 'PT']);
const timezoneIds = [...new Set(rawTimezones)]
  .filter((id) => !upstreamOnlyAliases.has(id))
  .sort();
const validTimezoneId = /^[A-Za-z0-9._+-]+(?:\/[A-Za-z0-9._+-]+)*$/;
for (const id of timezoneIds) {
  if (
    !validTimezoneId.test(id) ||
    id.split('/').some((segment) => segment === '.' || segment === '..')
  ) {
    throw new Error(`Generator returned an unsafe timezone identifier: ${id}`);
  }
}

for (const knownZone of [
  'America/Inuvik',
  'America/Edmonton',
  'Etc/UTC',
  'Europe/Stockholm',
]) {
  if (!timezoneIds.includes(knownZone)) {
    throw new Error(`Generated timezone database is missing ${knownZone}`);
  }
}

const blocks = Object.create(null);
const libraryExpandedAliases = [];
for (const id of timezoneIds) {
  let rawBlock;
  try {
    rawBlock = await readFile(path.join(rawDataRoot, `${id}.ics`), 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;

    // VZIC's raw directory omits some IANA Link aliases. The pinned library's
    // database was generated from the same --pure VZIC output, so expand its
    // canonical block for those IDs and retain the requested identifier.
    const expanded = upstreamModule.tzlib_get_ical_block(id);
    if (!Array.isArray(expanded) || typeof expanded[0] !== 'string') {
      throw new Error(`No raw or expanded VTIMEZONE is available for ${id}`);
    }
    rawBlock = expanded[0];
    libraryExpandedAliases.push(id);
  }

  // VZIC stamps the current build time into an optional property. Drop it so
  // identical pinned inputs produce byte-stable runtime data.
  const block = rawBlock
    .trimEnd()
    .replace(/^LAST-MODIFIED:[^\r\n]*\r\n/m, '')
    // IANA Link identifiers share the target zone's rules. Give each copied
    // VTIMEZONE the requested identifier so consumers can match TZID exactly.
    .replace(/^TZID:[^\r\n]*/m, `TZID:${id}`)
    .replace(/^X-LIC-LOCATION:[^\r\n]*/m, `X-LIC-LOCATION:${id}`);

  if (block.includes('LAST-MODIFIED:')) {
    throw new Error(`Volatile LAST-MODIFIED property remains in ${id}`);
  }

  if (
    !block.startsWith(`BEGIN:VTIMEZONE\r\nTZID:${id}\r\n`) ||
    !block.endsWith('END:VTIMEZONE')
  ) {
    throw new Error(`Malformed raw VTIMEZONE block for ${id}`);
  }
  blocks[id] = block;
}

function assertSerializedInuvikOffsets(block) {
  for (const observance of ['DAYLIGHT', 'STANDARD']) {
    if (!block.includes(`BEGIN:${observance}\r\n`)) {
      throw new Error(
        `Serialized America/Inuvik VTIMEZONE is missing its ${observance} component`,
      );
    }
  }

  return assertSerializedTimezoneOffsets(block, 'America/Inuvik', [
    { localTime: '1970-01-15T12:00:00', expected: -8 * 60 * 60 },
    { localTime: '1970-07-15T12:00:00', expected: -8 * 60 * 60 },
    { localTime: '1972-01-15T12:00:00', expected: -8 * 60 * 60 },
    { localTime: '1972-07-15T12:00:00', expected: -7 * 60 * 60 },
    { localTime: '2026-01-15T12:00:00', expected: -7 * 60 * 60 },
    { localTime: '2026-11-01T01:59:00', expected: -6 * 60 * 60 },
    { localTime: '2026-11-01T02:01:00', expected: -6 * 60 * 60 },
    { localTime: '2026-12-15T12:00:00', expected: -6 * 60 * 60 },
  ]);
}

function assertSerializedTimezoneOffsets(block, tzid, offsetChecks) {
  const timezone = new ICAL.Timezone({ component: block, tzid });
  const actualOffsets = {};
  for (const { localTime, expected } of offsetChecks) {
    const actual = timezone.utcOffset(ICAL.Time.fromString(localTime));
    if (actual !== expected) {
      throw new Error(
        `Serialized ${tzid} VTIMEZONE gives ${actual} seconds at ${localTime}; expected ${expected}`,
      );
    }
    actualOffsets[localTime] = actual;
  }
  return actualOffsets;
}

// Evaluate the emitted RFC 5545 component itself, rather than relying on the
// generator's offset helper or the host's potentially stale time zone data.
const serializedInuvikOffsets = assertSerializedInuvikOffsets(
  blocks['America/Inuvik'],
);
const serializedCETOffsets = assertSerializedTimezoneOffsets(
  blocks.CET,
  'CET',
  [
    { localTime: '2026-01-15T12:00:00', expected: 60 * 60 },
    { localTime: '2026-07-15T12:00:00', expected: 2 * 60 * 60 },
  ],
);

const artifactDirectory = path.resolve(env.TIMEZONE_ARTIFACT_DIR);
const licensesDirectory = path.join(artifactDirectory, 'licenses');
await mkdir(licensesDirectory, { recursive: true });
await writeFile(
  path.join(artifactDirectory, 'vtimezones.json'),
  `${JSON.stringify(blocks, null, 2)}\n`,
);
await copyFile(
  path.join(upstreamRoot, 'LICENSE'),
  path.join(licensesDirectory, 'timezones-ical-library-LICENSE'),
);
await copyFile(
  path.join(env.IANA_SOURCE_ROOT, 'theory.html'),
  path.join(licensesDirectory, 'IANA-theory.html'),
);

const outputHashes = {};
for (const relativePath of [
  'vtimezones.json',
  'licenses/timezones-ical-library-LICENSE',
  'licenses/IANA-theory.html',
]) {
  outputHashes[relativePath] = await readHash(
    path.join(artifactDirectory, relativePath),
    'sha256',
  );
}

const upstreamVersion = run('node', [
  '-p',
  `require(${JSON.stringify(path.join(upstreamRoot, 'package.json'))}).version`,
]);
const aptPackages = run('dpkg-query', [
  '-W',
  '-f=${Package}=${Version}\n',
  'make',
  'gcc',
  'pkg-config',
  'libical-dev',
  'libglib2.0-dev',
]);
const manifest = {
  schemaVersion: 1,
  iana: {
    version: env.TZDB_VERSION,
    releaseUrl: `https://data.iana.org/time-zones/releases/tzdata${env.TZDB_VERSION}.tar.gz`,
    sha512: archiveSha512,
    sourceLicenseNotice: 'licenses/IANA-theory.html',
  },
  generator: {
    repository: 'https://github.com/add2cal/timezones-ical-library',
    commit: upstreamCommit,
    packageVersion: upstreamVersion,
    license: upstreamPackage.license,
    licenseNotice: 'licenses/timezones-ical-library-LICENSE',
    vtimezoneMode: 'VZIC --pure',
    upstreamConvenienceAliasesExcluded: [...upstreamOnlyAliases].sort(),
    libraryExpandedAliases,
  },
  tools: {
    runner: 'ubuntu-24.04',
    node: process.version,
    npm: run('npm', ['--version']),
    gcc: run('gcc', ['--version']).split('\n')[0],
    libical: run('pkg-config', ['--modversion', 'libical']),
    aptPackages,
  },
  validation: {
    ianaTimezoneCount: timezoneIds.length,
    serializedInuvikOffsets,
    serializedCETOffsets,
    knownZones: [
      'America/Inuvik',
      'America/Edmonton',
      'Etc/UTC',
      'Europe/Stockholm',
    ],
  },
  outputs: outputHashes,
};

await writeFile(
  path.join(artifactDirectory, 'provenance.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
);

console.log(
  `Generated ${timezoneIds.length} IANA VTIMEZONE blocks from ${env.TZDB_VERSION}; ` +
    `serialized America/Inuvik offsets pass historical and 2026d checks.`,
);
