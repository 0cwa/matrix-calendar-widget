import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  checkNestMajorAlignment,
  NEST_RUNTIME_PACKAGES,
} from './check-nest-major.mjs';

const serverPackage = JSON.parse(
  readFileSync(
    new URL('../matrix-calendar-server/package.json', import.meta.url),
    'utf8',
  ),
);

function nestDependencies(version = '11.1.28') {
  return Object.fromEntries(NEST_RUNTIME_PACKAGES.map((name) => [name, version]));
}

test('current server production Nest runtime packages are aligned', () => {
  assert.equal(
    checkNestMajorAlignment(serverPackage.dependencies),
    Number.parseInt(serverPackage.dependencies['@nestjs/common'], 10),
  );
});

test('rejects a microservices-only Nest 12 bump', () => {
  assert.throws(
    () =>
      checkNestMajorAlignment({
        ...nestDependencies(),
        '@nestjs/microservices': '12.2.0',
      }),
    /Incompatible NestJS majors/,
  );
});

test('rejects a swagger-only Nest 12 bump', () => {
  assert.throws(
    () =>
      checkNestMajorAlignment({
        ...nestDependencies(),
        '@nestjs/swagger': '12.0.3',
      }),
    /Incompatible NestJS majors/,
  );
});

test('accepts a coordinated runtime major upgrade', () => {
  assert.equal(checkNestMajorAlignment(nestDependencies('12.2.0')), 12);
});

test('does not equate the config package major with the framework major', () => {
  assert.equal(
    checkNestMajorAlignment({
      ...nestDependencies(),
      '@nestjs/config': '12.0.1',
    }),
    11,
  );
});

test('rejects missing or ambiguous runtime versions', () => {
  const missing = nestDependencies();
  delete missing['@nestjs/core'];
  assert.throws(() => checkNestMajorAlignment(missing), /@nestjs\/core/);
  assert.throws(
    () =>
      checkNestMajorAlignment({
        ...nestDependencies(),
        '@nestjs/common': '>=11 <13',
      }),
    /@nestjs\/common/,
  );
});
