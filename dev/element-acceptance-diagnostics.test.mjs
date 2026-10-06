import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  diagnoseMissingModule,
  isRuntimeDependencyName,
  loadRuntimeDependencyAllowlist,
} from './element-acceptance-diagnostics.mjs';

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runtimeDependencies = loadRuntimeDependencyAllowlist(rootDirectory);

test('reveals only a missing package name present in runtime manifests', () => {
  assert.deepEqual(
    diagnoseMissingModule(
      "Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@nestjs/common' imported from /app/lib/index.js",
      runtimeDependencies,
    ),
    {
      missingModuleKind: 'declared-package',
      missingDependency: '@nestjs/common',
    },
  );
});

test('maps node_modules paths to an allowlisted package without retaining the path', () => {
  assert.deepEqual(
    diagnoseMissingModule(
      "Error: Cannot find module '/app/node_modules/postgres/index.js'",
      runtimeDependencies,
    ),
    {
      missingModuleKind: 'declared-package',
      missingDependency: 'postgres',
    },
  );
  assert.deepEqual(
    diagnoseMissingModule(
      "Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@nestjs/common' imported from file:///app/node_modules/%40nestjs/core/index.js",
      runtimeDependencies,
    ),
    {
      missingModuleKind: 'declared-package',
      missingDependency: '@nestjs/common',
    },
  );
});

test('keeps relative and unlisted module failures in fixed buckets', () => {
  assert.deepEqual(
    diagnoseMissingModule(
      "Error: Cannot find module '../private/token.json'",
      runtimeDependencies,
    ),
    { missingModuleKind: 'relative-or-file' },
  );
  assert.deepEqual(
    diagnoseMissingModule(
      "Error: Cannot find package 'unlisted-private-package' imported from /app/lib/index.js",
      runtimeDependencies,
    ),
    { missingModuleKind: 'unlisted-package' },
  );
  assert.equal(
    isRuntimeDependencyName('unlisted-private-package', runtimeDependencies),
    false,
  );
});

test('marks absent or conflicting module details without copying log text', () => {
  assert.deepEqual(
    diagnoseMissingModule('startup failed', runtimeDependencies),
    {
      missingModuleKind: 'unknown',
    },
  );
  assert.deepEqual(
    diagnoseMissingModule(
      "Cannot find package 'postgres'\nCannot find package 'joi'",
      runtimeDependencies,
    ),
    { missingModuleKind: 'ambiguous' },
  );
});
