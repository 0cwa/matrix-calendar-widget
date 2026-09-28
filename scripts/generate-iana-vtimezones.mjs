import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const env = process.env;
const requiredEnvironment = [
  'TZDB_VERSION',
  'TZDB_SHA512',
  'TIMEZONE_LIBRARY_COMMIT',
  'TIMEZONE_LIBRARY_ROOT',
  'IANA_ARCHIVE',
  'IANA_SOURCE_ROOT',
  'TIMEZONE_ARTIFACT_DIR',
];

for (const name of requiredEnvironment) {
  if (!env[name]) throw new Error(`Missing required environment variable: ${name}`);
}

const readHash = async (file, algorithm) =>
  createHash(algorithm).update(await readFile(file)).digest('hex');
const run = (command, args) =>
  execFileSync(command, args, { encoding: 'utf8' }).trim();

const archiveSha512 = await readHash(env.IANA_ARCHIVE, 'sha512');
if (archiveSha512 !== env.TZDB_SHA512) {
  throw new Error(`IANA archive SHA-512 mismatch: got ${archiveSha512}`);
}

const upstreamRoot = path.resolve(env.TIMEZONE_LIBRARY_ROOT);
const upstreamCommit = run('git', ['-C', upstreamRoot, 'rev-parse', 'HEAD']);
if (upstreamCommit !== env.TIMEZONE_LIBRARY_COMMIT) {
  throw new Error(`Unexpected timezone generator commit: ${upstreamCommit}`);
}

const upstreamPackage = JSON.parse(
  await readFile(path.join(upstreamRoot, 'package.json'), 'utf8'),
);
const upstreamModule = await import(
  pathToFileURL(path.join(upstreamRoot, 'dist/mjs/index.js')).href,
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
  if (!validTimezoneId.test(id)) {
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

const inuvikOffset = upstreamModule.tzlib_get_offset(
  'America/Inuvik',
  '2026-12-01',
  '12:00',
);
if (inuvikOffset !== '-0600') {
  throw new Error(`America/Inuvik must be -0600 after the 2026d change; got ${inuvikOffset}`);
}

const blocks = {};
for (const id of timezoneIds) {
  const result = upstreamModule.tzlib_get_ical_block(id);
  if (!Array.isArray(result) || typeof result[0] !== 'string') {
    throw new Error(`Generator returned no VTIMEZONE block for ${id}`);
  }

  // IANA Link identifiers share the target zone's rules. Give each returned
  // block the requested identifier so consumers can match TZID exactly.
  const block = result[0]
    .replace(/^TZID:[^\r\n]*/m, `TZID:${id}`)
    .replace(/^X-LIC-LOCATION:[^\r\n]*/m, `X-LIC-LOCATION:${id}`);
  if (
    !block.startsWith(`BEGIN:VTIMEZONE\r\nTZID:${id}\r\n`) ||
    !block.endsWith('END:VTIMEZONE')
  ) {
    throw new Error(`Malformed VTIMEZONE block for ${id}`);
  }
  blocks[id] = block;
}

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
  generatedAt: new Date().toISOString(),
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
    upstreamConvenienceAliasesExcluded: [...upstreamOnlyAliases].sort(),
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
    inuvikOffsetOn2026_12_01: inuvikOffset,
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
    `America/Inuvik offset is ${inuvikOffset}.`,
);
