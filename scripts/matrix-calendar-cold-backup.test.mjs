import assert from 'node:assert/strict';
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  ColdBackupFailure,
  defaultCommand,
  runColdBackup,
} from './matrix-calendar-cold-backup.mjs';

const containerIds = {
  widget: 'widget1234567890abcdef',
  server: 'server1234567890abcdef',
  radicale: 'radicale1234567890abcdef',
};

const captureMarkerContent = 'Cold capture verified and services resumed.\n';
const fakeSnapshotId = 'b'.repeat(64);
const realResticBinary = process.env.COLD_BACKUP_TEST_RESTIC_BINARY;
const realResticTestRoot = process.env.COLD_BACKUP_TEST_RESTIC_ROOT;

async function makeFixture({
  databaseEnabled = true,
  initialRunning,
  rootDirectory,
} = {}) {
  const root =
    rootDirectory ??
    (await mkdtemp(join(tmpdir(), 'matrix-calendar-cold-backup-')));
  const projectDirectory = join(root, 'project');
  const deployDirectory = join(projectDirectory, 'deploy');
  const captureRoot = join(root, 'captures');
  const resticCacheDirectory = join(root, 'restic-cache');
  const credentialDirectory = join(root, 'credentials');
  await mkdir(deployDirectory, { recursive: true, mode: 0o700 });
  await mkdir(captureRoot, { mode: 0o700 });
  await mkdir(resticCacheDirectory, { mode: 0o700 });
  await mkdir(credentialDirectory, { mode: 0o700 });

  const composeFile = join(deployDirectory, 'etke-sidecar.compose.yaml');
  const composeEnvFile = join(root, 'sidecar.env');
  const passwordFile = join(credentialDirectory, 'restic-password');
  const s3CredentialsFile = join(credentialDirectory, 's3-credentials');
  const pgServiceFile = join(credentialDirectory, 'pg_service.conf');
  const pgPassFile = join(credentialDirectory, 'pgpass');
  await writeFile(composeFile, 'services: {}\n', { mode: 0o600 });
  await writeFile(composeEnvFile, 'SYNTHETIC_VALUE=private\n', { mode: 0o600 });
  await writeFile(passwordFile, 'synthetic-restic-password\n', { mode: 0o600 });
  await writeFile(
    s3CredentialsFile,
    '[default]\naws_access_key_id=synthetic\n',
    {
      mode: 0o600,
    },
  );

  const env = {
    RESTIC_PASSWORD_FILE: passwordFile,
    AWS_SHARED_CREDENTIALS_FILE: s3CredentialsFile,
    RESTIC_CACHE_DIR: resticCacheDirectory,
  };
  if (databaseEnabled) {
    await writeFile(
      pgServiceFile,
      '[matrix-calendar-reminder]\nhost=db.example.invalid\ndbname=calendar\nuser=calendar\n',
      { mode: 0o600 },
    );
    await writeFile(
      pgPassFile,
      'db.example.invalid:5432:calendar:calendar:synthetic\n',
      {
        mode: 0o600,
      },
    );
    env.PGSERVICEFILE = pgServiceFile;
    env.PGPASSFILE = pgPassFile;
  }

  const config = {
    projectName: 'matrix-calendar-sidecar',
    projectDirectory,
    composeEnvFile,
    captureRoot,
    dockerSocket: '/var/run/docker.sock',
    helperImage: `busybox:1.37.0@sha256:${'a'.repeat(64)}`,
    reminderDatabaseEnabled: databaseEnabled,
    pgService: databaseEnabled ? 'matrix-calendar-reminder' : null,
    repository: 's3:https://objects.example.invalid/calendar/beta',
    awsRegion: 'region-1',
    awsProfile: 'default',
    resticHost: 'matrix-calendar-sidecar',
    resticTags: ['matrix-calendar-sidecar', 'cold-paired-store'],
  };

  return {
    root,
    captureRoot,
    composeEnvFile,
    env,
    config,
    pgServiceFile,
    async cleanup() {
      await rm(root, { recursive: true, force: true });
    },
    initialRunning,
  };
}

function fakeCommands({
  databaseEnabled = true,
  initialRunning = ['widget', 'server', 'radicale'],
  failStop,
  failInspect = false,
  wrongMount = false,
  failDump = false,
  warningDump = false,
  emptyDump = false,
  failDumpList = false,
  failArchive = false,
  emptyArchive = false,
  failArchiveList = false,
  failStart = [],
  resticStatus = 0,
  resticBackupOutput,
  resticListingStatus = 0,
  resticSnapshotOverride = {},
  resticNodeTransform,
  resticMarkerStatus = 0,
  resticMarkerOutput = captureMarkerContent,
  resticRetentionStatus = 0,
  onFirstStop,
  onResticBackup,
  onResticListing,
} = {}) {
  const running = new Set(initialRunning);
  const calls = [];
  let firstStop = true;

  const command = async (name, args, options = {}) => {
    const call = { name, args: [...args], options };
    calls.push(call);

    if (name === 'docker' && args[0] === 'compose' && args.includes('ps')) {
      const records = ['widget', 'server', 'radicale'].map((service) => ({
        ID: containerIds[service],
        Service: service,
        State: running.has(service) ? 'running' : 'exited',
      }));
      return { status: 0, stdout: JSON.stringify(records) };
    }

    if (name === 'docker' && args[0] === 'ps') {
      const volume = args[args.indexOf('--filter') + 1].slice('volume='.length);
      const service = volume.endsWith('_radicale-data') ? 'radicale' : 'server';
      const records = running.has(service)
        ? [{ ID: containerIds[service], State: 'running' }]
        : [];
      return { status: 0, stdout: records.map(JSON.stringify).join('\n') };
    }

    if (name === 'docker' && args[0] === 'compose' && args.includes('stop')) {
      const service = args.at(-1);
      if (firstStop && onFirstStop) {
        firstStop = false;
        await onFirstStop();
      }
      running.delete(service);
      if (service === failStop) {
        return {
          status: 1,
          stdout:
            'synthetic-access-token synthetic-db-password synthetic-s3-key',
          stderr: 'private child failure detail',
        };
      }
      return { status: 0, stdout: '' };
    }

    if (name === 'docker' && args[0] === 'compose' && args.includes('start')) {
      const service = args.at(-1);
      if (!failStart.includes(service)) running.add(service);
      return { status: failStart.includes(service) ? 1 : 0, stdout: '' };
    }

    if (name === 'docker' && args[0] === 'inspect') {
      if (failInspect) {
        return { status: 1, stdout: 'synthetic-private-inspect-output' };
      }
      const id = args.at(-1);
      const service = Object.keys(containerIds).find(
        (name) => containerIds[name] === id,
      );
      const format = args[2];
      if (format.includes('.Config.Labels')) {
        return {
          status: 0,
          stdout: JSON.stringify({
            'com.docker.compose.project': 'matrix-calendar-sidecar',
            'com.docker.compose.service': service,
          }),
        };
      }
      if (format.includes('.Mounts')) {
        const volume =
          service === 'radicale'
            ? 'matrix-calendar-sidecar_radicale-data'
            : service === 'server'
              ? wrongMount
                ? 'other-project_server-data'
                : 'matrix-calendar-sidecar_server-data'
              : undefined;
        const destination = service === 'radicale' ? '/data' : '/app/storage';
        return {
          status: 0,
          stdout: JSON.stringify(
            volume
              ? [
                  {
                    Type: 'volume',
                    Name: volume,
                    Destination: destination,
                    RW: true,
                  },
                ]
              : [],
          ),
        };
      }
      return {
        status: 0,
        stdout: JSON.stringify({
          Running: false,
          OOMKilled: false,
          Status: 'exited',
          ExitCode: 0,
        }),
      };
    }

    if (name === 'docker' && args[0] === 'run') {
      if (args.includes('-tf')) {
        return {
          status: failArchiveList ? 1 : 0,
          stdout: 'private archive listing',
        };
      }
      if (options.stdoutPath) {
        await writeFile(
          options.stdoutPath,
          emptyArchive ? '' : 'synthetic-tar-content',
          {
            flag: 'wx',
            mode: 0o600,
          },
        );
      }
      return {
        status: failArchive ? 1 : 0,
        stdout: 'synthetic-private-archive-output',
      };
    }

    if (name === 'docker' && args[0] === 'volume') {
      return { status: 0, stdout: 'synthetic-volume-inspect' };
    }
    if (name === 'docker' && args[0] === 'image') {
      return { status: 0, stdout: 'sha256:synthetic-helper-id' };
    }
    if (name === 'docker') return { status: 0, stdout: 'ok' };

    if (name === 'pg_dump' && args[0] === '--version') {
      return { status: 0, stdout: 'pg_dump synthetic version' };
    }
    if (name === 'pg_dump') {
      if (options.stdoutPath) {
        await writeFile(
          options.stdoutPath,
          emptyDump ? '' : 'synthetic-pg-dump',
          {
            flag: 'wx',
            mode: 0o600,
          },
        );
      }
      return {
        status: failDump ? 1 : 0,
        stdout: 'synthetic-db-password synthetic-s3-key',
        stderr:
          failDump || warningDump ? 'synthetic-private-dump-diagnostic' : '',
      };
    }
    if (name === 'pg_restore') {
      return {
        status: args[0] === '--version' || !failDumpList ? 0 : 1,
        stdout: 'synthetic-database-object-list',
        stderr: failDumpList ? 'synthetic-private-restore-diagnostic' : '',
      };
    }
    if (name === 'restic' && args[0] === 'backup') {
      if (onResticBackup) await onResticBackup(args.at(-1));
      return {
        status: resticStatus,
        stdout: args.includes('--json')
          ? (resticBackupOutput ??
            `${JSON.stringify({
              message_type: 'summary',
              dry_run: false,
              snapshot_id: fakeSnapshotId,
            })}\n`)
          : 'synthetic-restic-output',
        stderr: 'synthetic-private-restic-diagnostic',
      };
    }
    if (name === 'restic' && args[0] === 'ls') {
      const snapshotId = args.at(-2);
      const captureDirectory = args.at(-1);
      const entries = await readdir(captureDirectory);
      const nodes = [
        {
          message_type: 'node',
          path: captureDirectory,
          type: 'dir',
        },
      ];
      for (const entry of entries) {
        const info = await lstat(join(captureDirectory, entry));
        nodes.push({
          message_type: 'node',
          path: join(captureDirectory, entry),
          type: info.isFile() ? 'file' : info.isDirectory() ? 'dir' : 'symlink',
          ...(info.isFile() ? { size: info.size } : {}),
        });
      }
      const records = [
        {
          message_type: 'snapshot',
          id: snapshotId,
          hostname: 'matrix-calendar-sidecar',
          paths: [captureDirectory],
          tags: ['matrix-calendar-sidecar', 'cold-paired-store'],
          ...resticSnapshotOverride,
        },
        ...(resticNodeTransform ? resticNodeTransform(nodes) : nodes),
      ];
      const output = `${records
        .map((record) => JSON.stringify(record))
        .join('\n')}\n`;
      if (onResticListing) await onResticListing(captureDirectory);
      return { status: resticListingStatus, stdout: output };
    }
    if (name === 'restic' && args[0] === 'dump') {
      return { status: resticMarkerStatus, stdout: resticMarkerOutput };
    }
    if (name === 'restic' && args[0] === 'forget') {
      return {
        status: resticRetentionStatus,
        stdout: 'synthetic-restic-retention-output',
        stderr: 'synthetic-private-retention-diagnostic',
      };
    }
    if (name === 'restic')
      return { status: 0, stdout: 'restic synthetic version' };

    throw new Error('Unexpected fake command.');
  };

  return { command, calls, running };
}

function commandIndex(calls, predicate) {
  return calls.findIndex((call) => predicate(call));
}

function composeServiceCommand(call, operation, service) {
  return (
    call.name === 'docker' &&
    call.args[0] === 'compose' &&
    call.args.includes(operation) &&
    call.args.at(-1) === service
  );
}

async function waitForFile(path, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await access(path);
      return;
    } catch {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
    }
  }
  throw new Error('Temporary child did not report readiness.');
}

test('captures the configured paired stores, resumes services, then uploads one complete directory', async (t) => {
  const fixture = await makeFixture();
  t.after(fixture.cleanup);
  const fake = fakeCommands();

  const result = await runColdBackup(fixture.config, {
    command: fake.command,
    env: fixture.env,
    now: () => new Date('2026-10-12T02:03:04.000Z'),
    id: () => 'synthetic-run-id',
  });

  const files = (await readdir(result.captureDirectory)).sort();
  assert.deepEqual(files, [
    '.capture-complete',
    'SHA256SUMS',
    'radicale-data.tar',
    'reminder-postgresql.dump',
    'server-data.tar',
  ]);
  const checksums = await readFile(
    join(result.captureDirectory, 'SHA256SUMS'),
    'utf8',
  );
  assert.equal(
    await readFile(join(result.captureDirectory, '.capture-complete'), 'utf8'),
    captureMarkerContent,
  );
  assert.deepEqual(Object.keys(result), ['captureDirectory']);
  assert.match(checksums, /radicale-data\.tar/u);
  assert.match(checksums, /server-data\.tar/u);
  assert.match(checksums, /reminder-postgresql\.dump/u);
  assert.doesNotMatch(checksums, /\.partial/u);

  const resticIndex = commandIndex(
    fake.calls,
    (call) => call.name === 'restic' && call.args[0] === 'backup',
  );
  const startIndices = ['radicale', 'server', 'widget'].map((service) =>
    commandIndex(fake.calls, (call) =>
      composeServiceCommand(call, 'start', service),
    ),
  );
  assert.ok(startIndices.every((index) => index >= 0 && index < resticIndex));
  assert.ok(
    startIndices[0] < startIndices[1] && startIndices[1] < startIndices[2],
  );
  assert.ok(
    commandIndex(
      fake.calls,
      (call) =>
        call.name === 'pg_dump' && call.args.includes('--format=custom'),
    ) < resticIndex,
  );

  const archiveCommands = fake.calls.filter(
    (call) =>
      call.name === 'docker' &&
      call.args[0] === 'run' &&
      !call.args.includes('-tf'),
  );
  assert.equal(archiveCommands.length, 2);
  assert.match(
    archiveCommands[0].args.join(' '),
    /src=matrix-calendar-sidecar_radicale-data,dst=\/source,readonly/u,
  );
  assert.match(
    archiveCommands[1].args.join(' '),
    /src=matrix-calendar-sidecar_server-data,dst=\/source,readonly/u,
  );
  assert.ok(
    archiveCommands.every(
      (call) => call.args.includes('--network') && call.args.includes('none'),
    ),
  );

  const resticCall = fake.calls[resticIndex];
  assert.deepEqual(resticCall.args, [
    'backup',
    '--host',
    fixture.config.resticHost,
    '--tag',
    fixture.config.resticTags[0],
    '--tag',
    fixture.config.resticTags[1],
    '--group-by',
    'host,tags',
    result.captureDirectory,
  ]);
  assert.equal(resticCall.args.at(-1), result.captureDirectory);
  assert.equal(
    resticCall.options.env.RESTIC_REPOSITORY,
    fixture.config.repository,
  );
  assert.equal(
    resticCall.options.env.RESTIC_PASSWORD_FILE,
    fixture.env.RESTIC_PASSWORD_FILE,
  );
  assert.equal(
    resticCall.options.env.AWS_SHARED_CREDENTIALS_FILE,
    fixture.env.AWS_SHARED_CREDENTIALS_FILE,
  );
  assert.equal(
    resticCall.options.env.RESTIC_CACHE_DIR,
    fixture.env.RESTIC_CACHE_DIR,
  );
  assert.equal(resticCall.options.env.PGPASSFILE, undefined);
  assert.equal(resticCall.args.includes(fixture.config.repository), false);
  assert.equal(
    fake.calls.some((call) => call.args.includes('--prune')),
    false,
  );
  assert.equal(
    fake.calls.some(
      (call) => call.name === 'restic' && call.args[0] === 'forget',
    ),
    false,
  );
  assert.equal(
    fake.calls.some(
      (call) => call.name === 'restic' && ['ls', 'dump'].includes(call.args[0]),
    ),
    false,
  );
});

test('opt-in cleanup removes only the current capture after Restic reads it back', async (t) => {
  const fixture = await makeFixture({ databaseEnabled: false });
  t.after(fixture.cleanup);
  fixture.config.cleanupSuccessfulCapture = true;

  const markedCapture = join(fixture.captureRoot, 'older-marked-capture');
  const unmarkedCapture = join(fixture.captureRoot, 'unmarked-capture');
  await mkdir(markedCapture, { mode: 0o700 });
  await mkdir(unmarkedCapture, { mode: 0o700 });
  await writeFile(
    join(markedCapture, '.capture-complete'),
    captureMarkerContent,
    { mode: 0o600 },
  );
  await writeFile(join(markedCapture, 'foreign-sentinel'), 'keep marked', {
    mode: 0o600,
  });
  await writeFile(join(unmarkedCapture, 'foreign-sentinel'), 'keep unmarked', {
    mode: 0o600,
  });
  const controlPath = join(fixture.root, 'primary-control');
  await writeFile(controlPath, 'preserve primary control', { mode: 0o600 });

  const fake = fakeCommands({ databaseEnabled: false });
  const result = await runColdBackup(fixture.config, {
    command: fake.command,
    env: fixture.env,
    now: () => new Date('2026-10-12T02:03:04.000Z'),
    id: () => 'cleanup-run',
  });

  assert.equal(result.captureDirectoryRemoved, true);
  await assert.rejects(access(result.captureDirectory));
  assert.deepEqual((await readdir(fixture.captureRoot)).sort(), [
    'older-marked-capture',
    'unmarked-capture',
  ]);
  assert.equal(
    await readFile(join(markedCapture, '.capture-complete'), 'utf8'),
    captureMarkerContent,
  );
  assert.equal(
    await readFile(join(markedCapture, 'foreign-sentinel'), 'utf8'),
    'keep marked',
  );
  assert.equal(
    await readFile(join(unmarkedCapture, 'foreign-sentinel'), 'utf8'),
    'keep unmarked',
  );
  assert.equal(await readFile(controlPath, 'utf8'), 'preserve primary control');
  await access(fixture.composeEnvFile);
  await access(fixture.env.RESTIC_PASSWORD_FILE);

  const backupCall = fake.calls.find(
    (call) => call.name === 'restic' && call.args[0] === 'backup',
  );
  assert.ok(backupCall.args.includes('--json'));
  assert.ok(backupCall.args.includes('--quiet'));
  const readbackCalls = fake.calls.filter(
    (call) => call.name === 'restic' && ['ls', 'dump'].includes(call.args[0]),
  );
  assert.deepEqual(
    readbackCalls.map((call) => call.args[0]),
    ['ls', 'dump'],
  );
  assert.deepEqual(readbackCalls[0].args, [
    'ls',
    '--json',
    '--recursive',
    fakeSnapshotId,
    result.captureDirectory,
  ]);
  assert.deepEqual(readbackCalls[1].args, [
    'dump',
    fakeSnapshotId,
    join(result.captureDirectory, '.capture-complete'),
  ]);
});

test('opt-in cleanup preserves the marked capture when backup or snapshot proof fails', async (t) => {
  const failures = [
    {
      name: 'backup command fails',
      fakeOptions: { resticStatus: 1 },
      stage: 'upload',
    },
    {
      name: 'backup has no snapshot ID',
      fakeOptions: {
        resticBackupOutput: `${JSON.stringify({ message_type: 'summary' })}\n`,
      },
      stage: 'verification',
    },
    {
      name: 'snapshot metadata does not match',
      fakeOptions: { resticSnapshotOverride: { hostname: 'foreign-host' } },
      stage: 'verification',
    },
    {
      name: 'snapshot ID does not match backup result',
      fakeOptions: {
        resticSnapshotOverride: { id: 'c'.repeat(64) },
      },
      stage: 'verification',
    },
    {
      name: 'snapshot tags do not match',
      fakeOptions: {
        resticSnapshotOverride: { tags: ['foreign-tag'] },
      },
      stage: 'verification',
    },
    {
      name: 'snapshot listing command fails',
      fakeOptions: { resticListingStatus: 1 },
      stage: 'verification',
    },
    {
      name: 'snapshot file list is incomplete',
      fakeOptions: { resticNodeTransform: (nodes) => nodes.slice(0, -1) },
      stage: 'verification',
    },
    {
      name: 'snapshot marker content does not match',
      fakeOptions: { resticMarkerOutput: 'foreign capture marker\n' },
      stage: 'verification',
    },
  ];

  for (const failure of failures) {
    const fixture = await makeFixture({ databaseEnabled: false });
    t.after(fixture.cleanup);
    fixture.config.cleanupSuccessfulCapture = true;
    const fake = fakeCommands({
      databaseEnabled: false,
      ...failure.fakeOptions,
    });

    await assert.rejects(
      runColdBackup(fixture.config, {
        command: fake.command,
        env: fixture.env,
        id: () => 'preserve-capture',
      }),
      (error) =>
        error instanceof ColdBackupFailure && error.stage === failure.stage,
      failure.name,
    );

    const captureNames = (await readdir(fixture.captureRoot)).filter(
      (name) => name !== '.matrix-calendar-cold-backup.lock',
    );
    assert.equal(captureNames.length, 1, failure.name);
    const captureDirectory = join(fixture.captureRoot, captureNames[0]);
    assert.equal(
      await readFile(join(captureDirectory, '.capture-complete'), 'utf8'),
      captureMarkerContent,
      failure.name,
    );
    assert.deepEqual((await readdir(captureDirectory)).sort(), [
      '.capture-complete',
      'SHA256SUMS',
      'radicale-data.tar',
      'server-data.tar',
    ]);
    assert.ok(
      fake.calls.some(
        (call) => call.name === 'restic' && call.args[0] === 'backup',
      ),
      failure.name,
    );
  }
});

test('opt-in cleanup leaves a modified or symlinked current capture untouched', async (t) => {
  const tamperedFixture = await makeFixture({ databaseEnabled: false });
  t.after(tamperedFixture.cleanup);
  tamperedFixture.config.cleanupSuccessfulCapture = true;
  const tamperedFake = fakeCommands({
    databaseEnabled: false,
    onResticListing: async (captureDirectory) => {
      await writeFile(
        join(captureDirectory, 'SHA256SUMS'),
        'changed checksum\n',
      );
    },
  });
  await assert.rejects(
    runColdBackup(tamperedFixture.config, {
      command: tamperedFake.command,
      env: tamperedFixture.env,
      id: () => 'tampered-capture',
    }),
    (error) =>
      error instanceof ColdBackupFailure && error.stage === 'verification',
  );
  const tamperedCapture = join(
    tamperedFixture.captureRoot,
    (await readdir(tamperedFixture.captureRoot)).find(
      (name) => name !== '.matrix-calendar-cold-backup.lock',
    ),
  );
  assert.equal(
    await readFile(join(tamperedCapture, 'SHA256SUMS'), 'utf8'),
    'changed checksum\n',
  );
  assert.equal(
    await readFile(join(tamperedCapture, '.capture-complete'), 'utf8'),
    captureMarkerContent,
  );

  const symlinkFixture = await makeFixture({ databaseEnabled: false });
  t.after(symlinkFixture.cleanup);
  symlinkFixture.config.cleanupSuccessfulCapture = true;
  const outsideDirectory = join(symlinkFixture.root, 'foreign-target');
  await mkdir(outsideDirectory, { mode: 0o700 });
  const outsideMarker = join(outsideDirectory, '.capture-complete');
  const outsideSentinel = join(outsideDirectory, 'foreign-sentinel');
  await writeFile(outsideMarker, captureMarkerContent, { mode: 0o600 });
  await writeFile(outsideSentinel, 'preserve symlink target', { mode: 0o600 });
  let displacedCapture;
  const symlinkFake = fakeCommands({
    databaseEnabled: false,
    onResticListing: async (captureDirectory) => {
      displacedCapture = `${captureDirectory}-preserved`;
      await rename(captureDirectory, displacedCapture);
      await symlink(outsideDirectory, captureDirectory);
    },
  });
  await assert.rejects(
    runColdBackup(symlinkFixture.config, {
      command: symlinkFake.command,
      env: symlinkFixture.env,
      id: () => 'symlinked-capture',
    }),
    (error) =>
      error instanceof ColdBackupFailure && error.stage === 'verification',
  );
  const symlinkCapture = join(
    symlinkFixture.captureRoot,
    (await readdir(symlinkFixture.captureRoot)).find(
      (name) => name !== '.matrix-calendar-cold-backup.lock',
    ),
  );
  assert.equal((await lstat(symlinkCapture)).isSymbolicLink(), true);
  assert.equal(await readFile(outsideMarker, 'utf8'), captureMarkerContent);
  assert.equal(
    await readFile(outsideSentinel, 'utf8'),
    'preserve symlink target',
  );
  assert.equal(
    await readFile(join(displacedCapture, '.capture-complete'), 'utf8'),
    captureMarkerContent,
  );
});

test('opt-in cleanup rejects a symlinked capture-root ancestor before commands', async (t) => {
  const fixture = await makeFixture({ databaseEnabled: false });
  t.after(fixture.cleanup);
  fixture.config.cleanupSuccessfulCapture = true;
  const captureRootAlias = join(fixture.root, 'capture-root-alias');
  await symlink(fixture.root, captureRootAlias);
  fixture.config.captureRoot = join(captureRootAlias, 'captures');
  const fake = fakeCommands({ databaseEnabled: false });

  await assert.rejects(
    runColdBackup(fixture.config, {
      command: fake.command,
      env: fixture.env,
    }),
    (error) =>
      error instanceof ColdBackupFailure && error.stage === 'preflight',
  );
  assert.equal(fake.calls.length, 0);
  assert.deepEqual(await readdir(fixture.captureRoot), []);
});

test(
  'verified Restic reads back and cleans only the current local capture',
  { skip: !realResticBinary || !realResticTestRoot },
  async () => {
    await assert.rejects(access(realResticTestRoot));
    await mkdir(realResticTestRoot, { mode: 0o700 });
    const taskRootInfo = await lstat(realResticTestRoot);
    assert.equal(taskRootInfo.isDirectory(), true);
    assert.equal(taskRootInfo.mode & 0o777, 0o700);
    if (typeof process.getuid === 'function') {
      assert.equal(taskRootInfo.uid, process.getuid());
    }

    const fixtureRoot = join(realResticTestRoot, 'fixture');
    const fixture = await makeFixture({
      databaseEnabled: false,
      rootDirectory: fixtureRoot,
    });
    const passwordInfo = await lstat(fixture.env.RESTIC_PASSWORD_FILE);
    assert.equal(passwordInfo.isFile(), true);
    assert.equal(passwordInfo.mode & 0o777, 0o600);
    const repository = join(realResticTestRoot, 'repository');
    await assert.rejects(access(repository));

    const realCommands = [];
    let reportedResticVersion;
    let cleanupSnapshotId;
    let cleanupListing;
    let cleanupListingBytes;
    let markerReadbackMatches = false;
    const resticEnvironment = {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      HOME: process.env.HOME ?? '/',
      RESTIC_PASSWORD_FILE: fixture.env.RESTIC_PASSWORD_FILE,
      RESTIC_CACHE_DIR: fixture.env.RESTIC_CACHE_DIR,
    };
    const runNativeRestic = async (args, options = {}) => {
      const env = {
        ...options.env,
        ...resticEnvironment,
        RESTIC_REPOSITORY: `file:${repository}`,
      };
      const result = await defaultCommand(realResticBinary, args, {
        ...options,
        env,
      });
      realCommands.push([...args]);
      if (args[0] === 'version' && result.status === 0) {
        reportedResticVersion = /^restic ([^ ]+)/u.exec(result.stdout)?.[1];
      }
      if (
        args[0] === 'backup' &&
        args.includes('--json') &&
        result.status === 0
      ) {
        const records = result.stdout
          .trim()
          .split(/\r?\n/u)
          .filter(Boolean)
          .map((line) => JSON.parse(line));
        cleanupSnapshotId = records.find(
          (item) => item.message_type === 'summary',
        )?.snapshot_id;
      }
      if (args[0] === 'ls' && result.status === 0) {
        cleanupListingBytes = Buffer.byteLength(result.stdout);
        cleanupListing = result.stdout
          .trim()
          .split(/\r?\n/u)
          .filter(Boolean)
          .map((line) => JSON.parse(line));
      }
      if (args[0] === 'dump' && result.status === 0) {
        markerReadbackMatches = result.stdout === captureMarkerContent;
      }
      return result;
    };

    const init = await runNativeRestic(['init'], { timeoutMs: 30_000 });
    assert.equal(init.status, 0);

    const olderMarkedCapture = join(fixture.captureRoot, 'older-marked');
    const unmarkedCapture = join(fixture.captureRoot, 'unmarked');
    await mkdir(olderMarkedCapture, { mode: 0o700 });
    await mkdir(unmarkedCapture, { mode: 0o700 });
    await writeFile(
      join(olderMarkedCapture, '.capture-complete'),
      captureMarkerContent,
      { mode: 0o600 },
    );
    await writeFile(join(olderMarkedCapture, 'keep'), 'older control', {
      mode: 0o600,
    });
    await writeFile(join(unmarkedCapture, 'keep'), 'unmarked control', {
      mode: 0o600,
    });
    const primaryControl = join(fixtureRoot, 'primary-control');
    await writeFile(primaryControl, 'preserve synthetic primary data', {
      mode: 0o600,
    });

    const fake = fakeCommands({ databaseEnabled: false });
    const command = (name, args, options) =>
      name === 'restic'
        ? runNativeRestic(args, options)
        : fake.command(name, args, options);
    const defaultResult = await runColdBackup(fixture.config, {
      command,
      env: fixture.env,
      now: () => new Date('2026-10-13T02:03:04.000Z'),
      id: () => 'real-default',
    });
    await access(defaultResult.captureDirectory);
    assert.deepEqual(Object.keys(defaultResult), ['captureDirectory']);

    const cleanupResult = await runColdBackup(
      { ...fixture.config, cleanupSuccessfulCapture: true },
      {
        command,
        env: fixture.env,
        now: () => new Date('2026-10-14T02:03:04.000Z'),
        id: () => 'real-cleanup',
      },
    );
    assert.equal(cleanupResult.captureDirectoryRemoved, true);
    await assert.rejects(access(cleanupResult.captureDirectory));
    assert.equal(
      await readFile(
        join(defaultResult.captureDirectory, '.capture-complete'),
        'utf8',
      ),
      captureMarkerContent,
    );
    assert.equal(
      await readFile(primaryControl, 'utf8'),
      'preserve synthetic primary data',
    );
    assert.equal(
      await readFile(join(olderMarkedCapture, 'keep'), 'utf8'),
      'older control',
    );
    assert.equal(
      await readFile(join(unmarkedCapture, 'keep'), 'utf8'),
      'unmarked control',
    );
    assert.deepEqual((await readdir(fixture.captureRoot)).sort(), [
      '20261013T020304Z-real-default',
      'older-marked',
      'unmarked',
    ]);

    const snapshotsResult = await runNativeRestic(['snapshots', '--json']);
    assert.equal(snapshotsResult.status, 0);
    const snapshots = JSON.parse(snapshotsResult.stdout);
    assert.equal(snapshots.length, 2);
    const baselineSnapshot = snapshots.find((snapshot) =>
      snapshot.paths.includes(defaultResult.captureDirectory),
    );
    const cleanupSnapshot = snapshots.find((snapshot) =>
      snapshot.paths.includes(cleanupResult.captureDirectory),
    );
    assert.ok(baselineSnapshot);
    assert.ok(cleanupSnapshot);
    assert.equal(cleanupSnapshot.hostname, 'matrix-calendar-sidecar');
    assert.deepEqual(cleanupSnapshot.tags.sort(), [
      'cold-paired-store',
      'matrix-calendar-sidecar',
    ]);
    assert.equal(cleanupSnapshotId, cleanupSnapshot.id);
    assert.ok(cleanupListingBytes < 1024 * 1024);
    assert.equal(cleanupListing[0].id, cleanupSnapshot.id);
    assert.equal(cleanupListing[0].hostname, 'matrix-calendar-sidecar');
    assert.deepEqual(cleanupListing[0].tags.sort(), [
      'cold-paired-store',
      'matrix-calendar-sidecar',
    ]);
    assert.deepEqual(cleanupListing[0].paths, [cleanupResult.captureDirectory]);
    assert.equal(
      cleanupListing.length,
      6,
      'snapshot, capture directory, and four expected flat files',
    );
    assert.equal(markerReadbackMatches, true);
    assert.equal(reportedResticVersion, '0.19.1');
    assert.equal(
      realCommands.some(
        (args) => args[0] === 'forget' || args.includes('--prune'),
      ),
      false,
    );

    const receipt = {
      result: 'passed',
      transport: 'local file repository override; this is not S3 evidence',
      cleanup_option_default: false,
      cleanup_snapshot_id: cleanupSnapshot.id,
      cleanup_snapshot_host: cleanupSnapshot.hostname,
      cleanup_snapshot_tags: cleanupSnapshot.tags,
      cleanup_snapshot_paths: cleanupSnapshot.paths,
      readback_listing_bytes: cleanupListingBytes,
      readback_listing: cleanupListing.map((item) => ({
        message_type: item.message_type,
        ...(item.id ? { id: item.id } : {}),
        ...(item.hostname ? { hostname: item.hostname } : {}),
        ...(item.tags ? { tags: item.tags } : {}),
        ...(item.paths ? { paths: item.paths } : {}),
        ...(item.path ? { path: item.path } : {}),
        ...(item.type ? { type: item.type } : {}),
        ...(item.size !== undefined ? { size: item.size } : {}),
      })),
      marker_readback_matches: markerReadbackMatches,
      restic_command_args: realCommands,
      local_postconditions: {
        current_cleanup_capture_removed: true,
        default_off_capture_preserved: true,
        older_marked_capture_preserved: true,
        unmarked_capture_preserved: true,
        primary_control_preserved: true,
        remote_forget_or_prune_called: false,
      },
    };
    await writeFile(
      join(realResticTestRoot, 'receipt.json'),
      `${JSON.stringify(receipt, null, 2)}\n`,
      { mode: 0o600 },
    );
  },
);

test('opt-in retention forgets only the configured host and tag group after upload', async (t) => {
  const fixture = await makeFixture({ databaseEnabled: false });
  t.after(fixture.cleanup);
  fixture.config.resticRetentionEnabled = true;
  const fake = fakeCommands({ databaseEnabled: false });

  const result = await runColdBackup(fixture.config, {
    command: fake.command,
    env: fixture.env,
    id: () => 'retention-enabled',
  });

  const uploadIndex = commandIndex(
    fake.calls,
    (call) => call.name === 'restic' && call.args[0] === 'backup',
  );
  const retentionIndex = commandIndex(
    fake.calls,
    (call) => call.name === 'restic' && call.args[0] === 'forget',
  );
  assert.ok(uploadIndex >= 0 && retentionIndex > uploadIndex);

  const retentionCall = fake.calls[retentionIndex];
  assert.deepEqual(retentionCall.args, [
    'forget',
    '--host',
    fixture.config.resticHost,
    '--tag',
    fixture.config.resticTags.join(','),
    '--group-by',
    'host,tags',
    '--keep-daily',
    '30',
    '--prune',
  ]);
  assert.equal(
    retentionCall.options.env.RESTIC_REPOSITORY,
    fixture.config.repository,
  );
  assert.ok(
    fake.calls.findIndex((call) =>
      composeServiceCommand(call, 'start', 'widget'),
    ) < uploadIndex,
  );
  assert.equal(
    (await readdir(result.captureDirectory)).includes('.capture-complete'),
    true,
  );
});

test('retention failure is reported after preserving the successful upload', async (t) => {
  const fixture = await makeFixture({ databaseEnabled: false });
  t.after(fixture.cleanup);
  fixture.config.resticRetentionEnabled = true;
  const fake = fakeCommands({
    databaseEnabled: false,
    resticRetentionStatus: 1,
  });

  await assert.rejects(
    runColdBackup(fixture.config, {
      command: fake.command,
      env: fixture.env,
      id: () => 'retention-failure',
    }),
    (error) =>
      error instanceof ColdBackupFailure && error.stage === 'retention',
  );

  const uploadIndex = commandIndex(
    fake.calls,
    (call) => call.name === 'restic' && call.args[0] === 'backup',
  );
  const retentionIndex = commandIndex(
    fake.calls,
    (call) => call.name === 'restic' && call.args[0] === 'forget',
  );
  assert.ok(uploadIndex >= 0 && retentionIndex > uploadIndex);
  const captureDirectory = (await readdir(fixture.captureRoot)).find(
    (name) => name !== '.matrix-calendar-cold-backup.lock',
  );
  assert.ok(
    (await readdir(join(fixture.captureRoot, captureDirectory))).includes(
      '.capture-complete',
    ),
  );
});

test('invalid or missing project retention scope fails before commands', async (t) => {
  const fixture = await makeFixture({ databaseEnabled: false });
  t.after(fixture.cleanup);
  const invalidConfigs = [
    {
      ...fixture.config,
      resticRetentionEnabled: true,
      resticHost: 'another-project',
    },
    {
      ...fixture.config,
      resticRetentionEnabled: true,
      resticTags: ['another-project', 'cold-paired-store'],
    },
    {
      ...fixture.config,
      projectName: undefined,
      resticRetentionEnabled: true,
    },
    {
      ...fixture.config,
      cleanupSuccessfulCapture: 'true',
    },
  ];

  for (const config of invalidConfigs) {
    const fake = fakeCommands({ databaseEnabled: false });
    await assert.rejects(
      runColdBackup(config, { command: fake.command, env: fixture.env }),
      (error) =>
        error instanceof ColdBackupFailure && error.stage === 'configuration',
    );
    assert.equal(fake.calls.length, 0);
  }
});

test('dump, archive, and archive-read failures stop before upload and always resume', async (t) => {
  const failures = [
    {
      name: 'dump command',
      options: { failDump: true },
      expectedStage: 'database',
    },
    {
      name: 'empty dump',
      options: { emptyDump: true },
      expectedStage: 'database',
    },
    {
      name: 'dump warning',
      options: { warningDump: true },
      expectedStage: 'database',
    },
    {
      name: 'dump listing',
      options: { failDumpList: true },
      expectedStage: 'database',
    },
    {
      name: 'archive command',
      options: { failArchive: true },
      expectedStage: 'archive',
    },
    {
      name: 'empty archive',
      options: { emptyArchive: true },
      expectedStage: 'archive',
    },
    {
      name: 'archive readability',
      options: { failArchiveList: true },
      expectedStage: 'verification',
    },
  ];

  for (const failure of failures) {
    await t.test(failure.name, async (subtest) => {
      const fixture = await makeFixture();
      subtest.after(fixture.cleanup);
      const fake = fakeCommands(failure.options);
      await assert.rejects(
        runColdBackup(fixture.config, {
          command: fake.command,
          env: fixture.env,
          id: () => `failure-${failure.name.replaceAll(' ', '-')}`,
        }),
        (error) =>
          error instanceof ColdBackupFailure &&
          error.stage === failure.expectedStage,
      );
      assert.equal(
        fake.calls.some(
          (call) => call.name === 'restic' && call.args[0] === 'backup',
        ),
        false,
      );
      assert.deepEqual(
        ['radicale', 'server', 'widget'].map((service) =>
          fake.calls.some((call) =>
            composeServiceCommand(call, 'start', service),
          ),
        ),
        [true, true, true],
      );
      const captureDirectories = (await readdir(fixture.captureRoot)).filter(
        (name) => name !== '.matrix-calendar-cold-backup.lock',
      );
      assert.equal(captureDirectories.length, 1);
      assert.equal(
        (
          await readdir(join(fixture.captureRoot, captureDirectories[0]))
        ).includes('.capture-complete'),
        false,
      );
    });
  }
});

test('a failed resume attempts every dependency in order and prevents upload', async (t) => {
  const fixture = await makeFixture({ databaseEnabled: false });
  t.after(fixture.cleanup);
  const fake = fakeCommands({
    databaseEnabled: false,
    failStart: ['radicale'],
  });

  await assert.rejects(
    runColdBackup(fixture.config, {
      command: fake.command,
      env: fixture.env,
      id: () => 'resume-failure',
    }),
    (error) => error instanceof ColdBackupFailure && error.stage === 'resume',
  );
  const startCalls = fake.calls.filter((call) =>
    ['radicale', 'server', 'widget'].some((service) =>
      composeServiceCommand(call, 'start', service),
    ),
  );
  assert.deepEqual(
    startCalls.map((call) => call.args.at(-1)),
    ['radicale', 'server', 'widget'],
  );
  assert.equal(
    fake.calls.some(
      (call) => call.name === 'restic' && call.args[0] === 'backup',
    ),
    false,
  );
  const captureDirectory = (await readdir(fixture.captureRoot)).find(
    (name) => name !== '.matrix-calendar-cold-backup.lock',
  );
  assert.equal(
    (await readdir(join(fixture.captureRoot, captureDirectory))).includes(
      '.capture-complete',
    ),
    false,
  );
});

test('abort kills an unresponsive capture child and resumes every service before failing', async (t) => {
  const fixture = await makeFixture({ databaseEnabled: false });
  t.after(fixture.cleanup);
  const readyPath = join(fixture.root, 'child-ready');
  const childPath = join(fixture.root, 'ignore-sigterm.mjs');
  await writeFile(
    childPath,
    `import { writeFileSync } from 'node:fs';\nwriteFileSync(process.env.COLD_BACKUP_READY_FILE, 'ready', { flag: 'wx' });\nprocess.on('SIGTERM', () => {});\nsetInterval(() => {}, 1000);\n`,
    { mode: 0o600 },
  );

  const controller = new AbortController();
  const fake = fakeCommands({ databaseEnabled: false });
  let childResult;
  const command = async (name, args, options = {}) => {
    if (name === 'docker' && args[0] === 'run' && args.includes('-cpf')) {
      const child = defaultCommand(process.execPath, [childPath], {
        cwd: options.cwd,
        env: {
          ...options.env,
          COLD_BACKUP_READY_FILE: readyPath,
        },
        signal: options.signal,
        timeoutMs: 10_000,
        stdoutPath: options.stdoutPath,
      });
      try {
        await waitForFile(readyPath, 2_000);
      } catch (error) {
        controller.abort();
        await child;
        throw error;
      }
      controller.abort();
      childResult = await child;
      return childResult;
    }
    return fake.command(name, args, options);
  };

  const startTime = Date.now();
  await assert.rejects(
    runColdBackup(fixture.config, {
      command,
      env: fixture.env,
      signal: controller.signal,
      id: () => 'abort-unresponsive-child',
    }),
    (error) => error instanceof ColdBackupFailure && error.stage === 'archive',
  );
  assert.ok(Date.now() - startTime < 8_000);
  assert.notEqual(childResult?.status, 0);

  const stopCalls = fake.calls.filter((call) =>
    ['widget', 'server', 'radicale'].some((service) =>
      composeServiceCommand(call, 'stop', service),
    ),
  );
  assert.deepEqual(
    stopCalls.map((call) => call.args.at(-1)),
    ['widget', 'server', 'radicale'],
  );
  const startCalls = fake.calls.filter((call) =>
    ['radicale', 'server', 'widget'].some((service) =>
      composeServiceCommand(call, 'start', service),
    ),
  );
  assert.deepEqual(
    startCalls.map((call) => call.args.at(-1)),
    ['radicale', 'server', 'widget'],
  );
  assert.equal(
    fake.calls.some(
      (call) => call.name === 'restic' && call.args[0] === 'backup',
    ),
    false,
  );
});

test('a second process loses the exclusive lock without starting a second capture', async (t) => {
  const fixture = await makeFixture({ databaseEnabled: false });
  t.after(fixture.cleanup);
  let enteredFirstStop;
  let releaseFirstStop;
  const entered = new Promise((resolveEntered) => {
    enteredFirstStop = resolveEntered;
  });
  const paused = new Promise((resolvePaused) => {
    releaseFirstStop = resolvePaused;
  });
  let pause = true;
  const fake = fakeCommands({
    databaseEnabled: false,
    onFirstStop: async () => {
      if (pause) {
        pause = false;
        enteredFirstStop();
        await paused;
      }
    },
  });
  let sequence = 0;
  const deps = {
    command: fake.command,
    env: fixture.env,
    id: () => `overlap-${++sequence}`,
  };

  const first = runColdBackup(fixture.config, deps);
  await entered;
  await assert.rejects(
    runColdBackup(fixture.config, deps),
    (error) => error instanceof ColdBackupFailure && error.stage === 'lock',
  );
  assert.equal(
    fake.calls.filter((call) => composeServiceCommand(call, 'stop', 'widget'))
      .length,
    1,
  );
  releaseFirstStop();
  await first;
});

test('preflight refuses missing configuration, a stopped service, and child failures without leaking diagnostics', async (t) => {
  const fixture = await makeFixture({ databaseEnabled: false });
  t.after(fixture.cleanup);

  const missingCredentials = fakeCommands({ databaseEnabled: false });
  await assert.rejects(
    runColdBackup(undefined, {
      command: missingCredentials.command,
      env: fixture.env,
    }),
    (error) =>
      error instanceof ColdBackupFailure && error.stage === 'configuration',
  );
  assert.equal(missingCredentials.calls.length, 0);

  await assert.rejects(
    runColdBackup(fixture.config, {
      command: missingCredentials.command,
      env: {
        AWS_SHARED_CREDENTIALS_FILE: fixture.env.AWS_SHARED_CREDENTIALS_FILE,
      },
    }),
    (error) =>
      error instanceof ColdBackupFailure && error.stage === 'preflight',
  );
  assert.equal(missingCredentials.calls.length, 0);
  assert.deepEqual(await readdir(fixture.captureRoot), []);

  const invalidRepository = fakeCommands({ databaseEnabled: false });
  await assert.rejects(
    runColdBackup(
      {
        ...fixture.config,
        repository:
          's3:https://user:synthetic-secret@objects.example.invalid/bucket/prefix',
      },
      { command: invalidRepository.command, env: fixture.env },
    ),
    (error) =>
      error instanceof ColdBackupFailure &&
      error.stage === 'configuration' &&
      !error.message.includes('synthetic-secret'),
  );
  assert.equal(invalidRepository.calls.length, 0);

  const stopped = fakeCommands({
    databaseEnabled: false,
    initialRunning: ['server', 'radicale'],
  });
  await assert.rejects(
    runColdBackup(fixture.config, {
      command: stopped.command,
      env: fixture.env,
      id: () => 'preexisting-stopped',
    }),
    (error) =>
      error instanceof ColdBackupFailure && error.stage === 'preflight',
  );
  assert.equal(
    stopped.calls.some((call) => call.args.includes('stop')),
    false,
  );
  assert.equal(
    stopped.calls.some((call) => call.args.includes('start')),
    false,
  );
  assert.deepEqual(await readdir(fixture.captureRoot), []);

  const wrongVolume = fakeCommands({
    databaseEnabled: false,
    wrongMount: true,
  });
  await assert.rejects(
    runColdBackup(fixture.config, {
      command: wrongVolume.command,
      env: fixture.env,
    }),
    (error) =>
      error instanceof ColdBackupFailure && error.stage === 'preflight',
  );
  assert.equal(
    wrongVolume.calls.some((call) => call.args.includes('stop')),
    false,
  );
  assert.deepEqual(await readdir(fixture.captureRoot), []);

  const childFailure = fakeCommands({ failStop: 'widget' });
  await assert.rejects(
    runColdBackup(fixture.config, {
      command: childFailure.command,
      env: fixture.env,
      id: () => 'redacted-failure',
    }),
    (error) => {
      const text = `${error.name} ${error.message} ${error.stage}`;
      assert.doesNotMatch(
        text,
        /synthetic-access-token|synthetic-db-password|synthetic-s3-key|private child failure detail/u,
      );
      return error instanceof ColdBackupFailure && error.stage === 'quiesce';
    },
  );
  assert.equal(
    childFailure.calls.some(
      (call) => call.name === 'docker' && call.args[0] === 'run',
    ),
    false,
  );
  assert.equal(
    childFailure.calls.some(
      (call) => call.name === 'restic' && call.args[0] === 'backup',
    ),
    false,
  );
  assert.deepEqual(
    ['radicale', 'server', 'widget'].map((service) =>
      childFailure.calls.some((call) =>
        composeServiceCommand(call, 'start', service),
      ),
    ),
    [true, true, true],
  );
});

test('Restic incomplete status fails after retaining a complete local capture', async (t) => {
  const fixture = await makeFixture({ databaseEnabled: false });
  t.after(fixture.cleanup);
  fixture.config.resticRetentionEnabled = true;
  const fake = fakeCommands({ databaseEnabled: false, resticStatus: 3 });

  await assert.rejects(
    runColdBackup(fixture.config, {
      command: fake.command,
      env: fixture.env,
      id: () => 'incomplete-restic',
    }),
    (error) => error instanceof ColdBackupFailure && error.stage === 'upload',
  );
  const captureDirectory = (await readdir(fixture.captureRoot)).find(
    (name) => name !== '.matrix-calendar-cold-backup.lock',
  );
  assert.ok(
    (await readdir(join(fixture.captureRoot, captureDirectory))).includes(
      '.capture-complete',
    ),
  );
  assert.equal(
    fake.calls.some(
      (call) => call.name === 'restic' && call.args[0] === 'forget',
    ),
    false,
  );
});

test('rejects a database service entry that stores its password inline', async (t) => {
  const fixture = await makeFixture();
  t.after(fixture.cleanup);
  await writeFile(
    fixture.pgServiceFile,
    '[matrix-calendar-reminder]\nhost=db.example.invalid\npassword=synthetic-secret\n',
    { mode: 0o600 },
  );
  const fake = fakeCommands();

  await assert.rejects(
    runColdBackup(fixture.config, { command: fake.command, env: fixture.env }),
    (error) =>
      error instanceof ColdBackupFailure && error.stage === 'preflight',
  );
  assert.equal(fake.calls.length, 0);
  assert.deepEqual(await readdir(fixture.captureRoot), []);
});

test('systemd examples use runtime credentials and a daily timer without enabling retention', async () => {
  const service = await readFile(
    new URL(
      '../deploy/systemd/matrix-calendar-backup.service.example',
      import.meta.url,
    ),
    'utf8',
  );
  const timer = await readFile(
    new URL(
      '../deploy/systemd/matrix-calendar-backup.timer.example',
      import.meta.url,
    ),
    'utf8',
  );

  assert.match(service, /LoadCredential=restic-password:/u);
  assert.match(service, /LoadCredential=s3-credentials:/u);
  assert.match(service, /RESTIC_PASSWORD_FILE=%d\/restic-password/u);
  assert.match(service, /AWS_SHARED_CREDENTIALS_FILE=%d\/s3-credentials/u);
  assert.match(
    service,
    /RESTIC_CACHE_DIR=\/var\/cache\/matrix-calendar-backup/u,
  );
  assert.match(service, /--config \/etc\/matrix-calendar\/backup\.json/u);
  assert.doesNotMatch(service, /^EnvironmentFile=/mu);
  assert.doesNotMatch(service, /^Environment=RESTIC_REPOSITORY=/mu);
  assert.match(timer, /OnCalendar=\*-\*-\* 03:00:00/u);
  assert.match(timer, /Persistent=true/u);
  assert.match(timer, /RandomizedDelaySec=15m/u);
  assert.doesNotMatch(timer, /forget|prune/u);
});
