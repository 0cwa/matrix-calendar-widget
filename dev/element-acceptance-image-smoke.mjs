import { createRequire } from 'node:module';

const entrypoint = '/app/lib/src/index.js';
const requireFromEntrypoint = createRequire(entrypoint);
const FAILURE_EXIT_CODES = new Map([
  ['missing-module', 20],
  ['module-format', 21],
  ['permission', 22],
  ['bootstrap-rejection', 23],
  ['bootstrap-timeout', 24],
  ['entrypoint-load', 25],
]);
let finished = false;

function finish(category, exitCode, stream) {
  if (finished) return;
  finished = true;
  stream.write(`server-entrypoint-smoke:${category}\n`, () =>
    process.exit(exitCode),
  );
}

function fail(category) {
  finish(category, FAILURE_EXIT_CODES.get(category) ?? 23, process.stderr);
}

function reportFailure(error) {
  if (
    error instanceof Error &&
    ['MODULE_NOT_FOUND', 'ERR_MODULE_NOT_FOUND'].includes(error.code)
  ) {
    fail('missing-module');
    return;
  }

  if (error instanceof Error && error.code === 'ERR_REQUIRE_ESM') {
    fail('module-format');
    return;
  }

  if (error instanceof Error && error.code === 'EACCES') {
    fail('permission');
    return;
  }

  if (error instanceof Error && error.code === 'ERR_SMOKE_BOOTSTRAP_OPTIONS') {
    fail('entrypoint-load');
    return;
  }

  fail('bootstrap-rejection');
}

// With no service environment, this expected validation rejection shows the
// compiled entrypoint reached configuration validation before service startup.
process.on('unhandledRejection', (reason) => {
  if (
    reason instanceof Error &&
    reason.message.startsWith('Config validation error:')
  ) {
    finish('config-validation-reached', 0, process.stdout);
    return;
  }

  reportFailure(reason);
});

function startSmoke() {
  try {
    const nestFactory = requireFromEntrypoint('@nestjs/core').NestFactory;
    if (!nestFactory || typeof nestFactory.create !== 'function') {
      fail('entrypoint-load');
      return;
    }

    const originalCreate = nestFactory.create.bind(nestFactory);
    nestFactory.create = (...args) => {
      if (
        args.length !== 2 ||
        !args[1] ||
        typeof args[1] !== 'object' ||
        Array.isArray(args[1])
      ) {
        const error = new Error('Unsupported bootstrap options');
        error.code = 'ERR_SMOKE_BOOTSTRAP_OPTIONS';
        throw error;
      }

      return originalCreate(args[0], { ...args[1], abortOnError: false });
    };

    requireFromEntrypoint(entrypoint);
  } catch (error) {
    reportFailure(error);
    return;
  }

  setTimeout(() => fail('bootstrap-timeout'), 5000).unref();
}

startSmoke();
