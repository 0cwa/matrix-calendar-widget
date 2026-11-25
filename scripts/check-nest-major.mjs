/*
 * Prevent mixing incompatible NestJS runtime package majors.
 * @nestjs/config is intentionally excluded: its version follows a separate
 * release scheme and its peer range must be evaluated independently.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const NEST_RUNTIME_PACKAGES = [
  '@nestjs/common',
  '@nestjs/core',
  '@nestjs/microservices',
  '@nestjs/platform-express',
  '@nestjs/swagger',
];

function majorFor(packageName, version) {
  const match =
    typeof version === 'string' &&
    /^(?:\^|~)?(\d+)\.\d+\.\d+(?:-[\w.-]+)?$/.exec(version);

  if (!match) {
    throw new Error(
      'Missing or unsupported ' +
        packageName +
        ' version: ' +
        JSON.stringify(version) +
        '. ' +
        'Use a single semver version (optionally ^ or ~).',
    );
  }

  return Number(match[1]);
}

export function checkNestMajorAlignment(dependencies) {
  const packages = NEST_RUNTIME_PACKAGES.map((name) => ({
    name,
    version: dependencies?.[name],
    major: majorFor(name, dependencies?.[name]),
  }));
  const expected = packages[0].major;
  const mismatches = packages.filter(({ major }) => major !== expected);

  if (mismatches.length > 0) {
    throw new Error(
      'Incompatible NestJS majors in matrix-calendar-server/package.json: ' +
        packages.map(({ name, version }) => name + '=' + version).join(', ') +
        '. Align Nest runtime dependencies with @nestjs/common major ' +
        expected +
        '.',
    );
  }

  return expected;
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  try {
    const serverPackage = JSON.parse(
      readFileSync(
        new URL('../matrix-calendar-server/package.json', import.meta.url),
        'utf8',
      ),
    );
    checkNestMajorAlignment(serverPackage.dependencies);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
