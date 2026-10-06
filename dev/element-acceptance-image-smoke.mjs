import { createRequire } from 'node:module';

const entrypoint = '/app/lib/src/index.js';
const requireFromEntrypoint = createRequire(entrypoint);

// With no service environment, this expected validation rejection shows the
// compiled entrypoint reached configuration validation before service startup.
process.on('unhandledRejection', (reason) => {
  if (
    reason instanceof Error &&
    reason.message.startsWith('Config validation error:')
  ) {
    process.stdout.write('server-entrypoint-reached-config-validation\n');
    process.exit(0);
  }

  process.stderr.write('server entrypoint module load failed\n');
  process.exit(1);
});

try {
  requireFromEntrypoint(entrypoint);
} catch {
  process.stderr.write('server entrypoint module load failed\n');
  process.exit(1);
}

setTimeout(() => {
  process.stderr.write(
    'server entrypoint smoke did not reach isolated config validation\n',
  );
  process.exit(1);
}, 5000).unref();
