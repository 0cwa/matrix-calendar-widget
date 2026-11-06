import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const root = resolve('.');
const sha = (s) => createHash('sha256').update(s).digest('hex');
const notices = [
  ['LICENSE', 'project-LICENSE'],
  ['NOTICE', 'project-NOTICE'],
  ['matrix-calendar-server/NOTICE', 'server-NOTICE'],
  ['matrix-calendar-widget/NOTICE', 'widget-NOTICE'],
  ['packages/ical-timezones/NOTICE.md', 'ical-timezones-NOTICE.md'],
  [
    'packages/ical-timezones/src/data/licenses/IANA-theory.html',
    'IANA-theory.html',
  ],
  [
    'packages/ical-timezones/src/data/licenses/timezones-ical-library-LICENSE',
    'timezones-ical-library-LICENSE',
  ],
];

test('release command deploys and recovers an unhealthy candidate', () => {
  const parent = join(
    homedir(),
    'agent-scratch',
    'matrix-calendar-widget',
    'release-tests',
  );
  mkdirSync(parent, { recursive: true });
  const dir = mkdtempSync(join(parent, 'case-'));
  try {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim();
    const tree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], {
      encoding: 'utf8',
    }).trim();
    const archive = join(dir, 'archive');
    mkdirSync(join(archive, 'images'), { recursive: true });
    mkdirSync(join(archive, 'notices'));
    const imageSource = join(dir, 'image-source');
    mkdirSync(imageSource);
    writeFileSync(
      join(imageSource, 'manifest.json'),
      JSON.stringify([
        { RepoTags: ['matrix-calendar-widget/server:archive-123-1'] },
      ]),
    );
    const imageArchive = join(archive, 'images/server-linux-amd64.tar');
    execFileSync('tar', [
      '-cf',
      imageArchive,
      '-C',
      imageSource,
      'manifest.json',
    ]);
    const bytes = readFileSync(imageArchive);
    const noticeEntries = notices.map(([source, name]) => {
      const data = Buffer.from(`synthetic ${name}`);
      writeFileSync(join(archive, 'notices', name), data);
      return {
        source_path: source,
        path: `notices/${name}`,
        sha256: sha(data),
        bytes: data.length,
      };
    });
    const pinned = `node:22-bookworm-slim@sha256:${'a'.repeat(64)}`;
    const m = {
      schema_version: 2,
      source: { sha: head, tree, dispatch_sha: head },
      workflow: {
        repository: '0cwa/matrix-calendar-widget',
        ref: '0cwa/matrix-calendar-widget/.github/workflows/release-image-archive.yml@refs/heads/main',
        sha: head,
        run_id: 123,
        run_attempt: 1,
        run_url:
          'https://github.com/0cwa/matrix-calendar-widget/actions/runs/123',
      },
      builder: {
        helper_sha256: sha(
          readFileSync(join(root, 'scripts/release-image-archive.mjs')),
        ),
        workflow_sha256: sha(
          readFileSync(
            join(root, '.github/workflows/release-image-archive.yml'),
          ),
        ),
      },
      platform: 'linux/amd64',
      image_set: 'server-only',
      images: [
        {
          name: 'server',
          tag: 'matrix-calendar-widget/server:archive-123-1',
          image_id: `sha256:${'b'.repeat(64)}`,
          buildx_manifest_digest: `sha256:${'c'.repeat(64)}`,
          dockerfile: {
            source_path: 'matrix-calendar-server/Dockerfile',
            source_sha256: 'd'.repeat(64),
            build_path: 'workflow-derived/server.Dockerfile',
            build_sha256: 'e'.repeat(64),
            transformation: {
              from: 'node:22-bookworm-slim',
              to: pinned,
              replacements: 2,
            },
          },
          base_images: [pinned],
          archive: {
            path: 'images/server-linux-amd64.tar',
            sha256: sha(bytes),
            bytes: bytes.length,
          },
        },
      ],
      notices: noticeEntries,
    };
    const manifest = Buffer.from(JSON.stringify(m));
    writeFileSync(join(archive, 'manifest.json'), manifest);
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    const state = join(dir, 'state');
    const old = 'example.invalid/server:old',
      oldId = `sha256:${'a'.repeat(64)}`,
      newId = m.images[0].image_id;
    writeFileSync(
      join(bin, 'docker'),
      `#!/usr/bin/env node\nconst fs=require('fs');const a=process.argv.slice(2),p=process.env.TEST_STATE;let s=JSON.parse(fs.readFileSync(p));function tag(){let files=[];for(let i=0;i<a.length;i++)if(a[i]=='-f')files.push(a[++i]);let t='';for(const f of files){const z=fs.readFileSync(f,'utf8').match(/image: ([^\\s]+)/);if(z)t=z[1]}return t}if(a[0]=='image'&&a[1]=='ls'){if(s.loaded)console.log(s.newId)}else if(a[0]=='image'&&a[1]=='inspect'){if(a.at(-1)!=s.old&&a.at(-1)!=s.oldId&&!s.loaded)process.exit(1);console.log(a.includes('{{.Os}}/{{.Architecture}}')?'linux/amd64':a.at(-1)==s.old?(s.retagged?'sha256:'+ 'e'.repeat(64):s.oldId):a.at(-1)==s.oldId?s.oldId:s.newId)}else if(a[0]=='image'&&a[1]=='load'){s.loaded=true;fs.writeFileSync(p,JSON.stringify(s))}else if(a[0]=='inspect')console.log(a.some(x=>x.includes('config-hash'))?(process.env.TEST_DRIFT==='yes'?'e':'d').repeat(64):s.current);else if(a.includes('config')&&a.includes('--hash'))console.log('server '+ 'd'.repeat(64));else if(a.includes('config'))console.log(JSON.stringify({services:{server:{image:tag()},widget:{image:'widget:fixed'}}}));else if(a.includes('ps')){if(process.env.TEST_NO_SERVER!=='yes')console.log('server-1')}else if(a.includes('up')){s.current=(tag()==s.old||tag()==s.oldId)?s.oldId:s.newId;fs.writeFileSync(p,JSON.stringify(s))}else process.exit(3);\n`,
      { mode: 0o755 },
    );
    writeFileSync(
      join(bin, 'check'),
      `#!/usr/bin/env node\nconst fs=require('fs');const x=JSON.parse(fs.readFileSync(process.env.TEST_STATE));if(process.env.FAIL_HEALTH==='retag'&&x.current===x.newId){x.retagged=true;fs.writeFileSync(process.env.TEST_STATE,JSON.stringify(x));process.exit(1)}if(process.env.FAIL_HEALTH==='edit'&&x.current===x.newId){fs.appendFileSync(process.env.TEST_CANONICAL,'# concurrent edit\\n');process.exit(1)}if(process.env.FAIL_HEALTH==='yes'&&x.current===x.newId)process.exit(1);\n`,
      { mode: 0o755 },
    );
    writeFileSync(
      join(bin, 'ssh'),
      '#!/bin/sh\nif [ "$TEST_SSH_FAILURE" = yes ]; then exit 255; fi\nfor last do :; done\nexec sh -c "$last"\n',
      { mode: 0o755 },
    );
    for (const scenario of [
      'success',
      'unhealthy',
      'concurrent-edit',
      'drift',
      'retag',
    ]) {
      const target = join(dir, `${scenario} space;literal`);
      mkdirSync(target);
      const canonical = join(target, 'compose.yaml');
      writeFileSync(canonical, `services:\n  server:\n    image: ${old}\n`);
      writeFileSync(
        state,
        JSON.stringify({ old, oldId, newId, current: oldId }),
      );
      const config = {
        host: 'synthetic',
        stageDirectory: join(target, 'stage'),
        archiveRoot: archive,
        manifestSha256: sha(manifest),
        sourceSha: head,
        canonical,
        project: 'synthetic',
        projectDirectory: target,
        backupCheck: join(bin, 'check'),
        healthCheck: join(bin, 'check'),
        dependenciesCheck: join(bin, 'check'),
        operationDirectory: join(target, 'operation'),
        rollbackCompatible: true,
      };
      const configFile = join(target, 'config.json');
      writeFileSync(configFile, JSON.stringify(config), { mode: 0o600 });
      const env = {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        TEST_STATE: state,
        FAIL_HEALTH:
          scenario === 'unhealthy'
            ? 'yes'
            : scenario === 'concurrent-edit'
              ? 'edit'
              : scenario === 'retag'
                ? 'retag'
                : 'no',
        TEST_CANONICAL: canonical,
        TEST_DRIFT: scenario === 'drift' ? 'yes' : 'no',
      };
      const result = spawnSync(
        process.execPath,
        [join(root, 'scripts/server-release.mjs'), 'deploy', configFile],
        { encoding: 'utf8', env },
      );
      const running = JSON.parse(readFileSync(state)).current;
      const contents = readFileSync(canonical, 'utf8');
      if (scenario === 'success') {
        assert.equal(result.status, 0, result.stderr);
        assert.equal(running, newId);
        assert.ok(contents.includes(m.images[0].tag));
      } else if (scenario === 'unhealthy') {
        assert.notEqual(result.status, 0);
        assert.match(result.stdout, /rolled-back/);
        assert.equal(running, oldId);
        assert.ok(contents.includes(old));
      } else if (scenario === 'retag') {
        assert.notEqual(result.status, 0);
        assert.match(result.stdout, /recovery-incomplete/);
        assert.equal(running, oldId);
        assert.ok(contents.includes(old));
      } else if (scenario === 'drift') {
        assert.notEqual(result.status, 0);
        assert.match(result.stdout, /failed/);
        assert.equal(running, oldId);
        assert.ok(contents.includes(old));
      } else {
        assert.notEqual(result.status, 0);
        assert.match(result.stdout, /recovery-incomplete/);
        assert.equal(running, oldId);
        assert.match(contents, /concurrent edit/);
      }
      const status = spawnSync(
        process.execPath,
        [join(root, 'scripts/server-release.mjs'), 'status', configFile],
        { encoding: 'utf8', env },
      );
      const expected = scenario === 'success' ? 'candidate' : 'previous';
      const saved = expected;
      assert.equal(status.status, 0, status.stderr);
      assert.match(
        status.stdout,
        new RegExp(`running: ${expected}; saved: ${saved}`),
      );
      if (scenario === 'retag')
        assert.match(status.stdout, /saved image resolves to: other/);
      if (scenario === 'success') {
        const missing = spawnSync(
          process.execPath,
          [join(root, 'scripts/server-release.mjs'), 'status', configFile],
          { encoding: 'utf8', env: { ...env, TEST_NO_SERVER: 'yes' } },
        );
        assert.equal(missing.status, 0, missing.stderr);
        assert.match(
          missing.stdout,
          /Recorded phase: complete; running: unknown/,
        );
        assert.match(missing.stdout, /health: unknown/);
      }
      const disconnected = spawnSync(
        process.execPath,
        [join(root, 'scripts/server-release.mjs'), 'status', configFile],
        { encoding: 'utf8', env: { ...env, TEST_SSH_FAILURE: 'yes' } },
      );
      assert.notEqual(disconnected.status, 0);
      assert.match(disconnected.stdout, /unknown/);
      if (scenario === 'success') {
        const failedDeploy = spawnSync(
          process.execPath,
          [join(root, 'scripts/server-release.mjs'), 'deploy', configFile],
          { encoding: 'utf8', env: { ...env, TEST_SSH_FAILURE: 'yes' } },
        );
        assert.notEqual(failedDeploy.status, 0);
        assert.match(failedDeploy.stdout, /unknown/);
        assert.doesNotMatch(failedDeploy.stdout, /complete/);
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an interrupted image transfer leaves no staged archive', () => {
  const parent = join(
    homedir(),
    'agent-scratch',
    'matrix-calendar-widget',
    'release-tests',
  );
  mkdirSync(parent, { recursive: true });
  const dir = mkdtempSync(join(parent, 'interrupt-'));
  try {
    const stage = join(dir, 'stage');
    const request = Buffer.from(
      JSON.stringify({
        action: 'deploy',
        stageDirectory: stage,
        operationDirectory: join(dir, 'operation'),
      }),
    );
    const header = Buffer.alloc(8);
    header.writeBigUInt64BE(BigInt(request.length));
    const imageLength = Buffer.alloc(8);
    imageLength.writeBigUInt64BE(10n);
    const result = spawnSync(
      'python3',
      [join(root, 'scripts/release/remote_server_release.py')],
      {
        input: Buffer.concat([
          header,
          request,
          imageLength,
          Buffer.from('short'),
        ]),
        encoding: 'utf8',
      },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /"status": "unknown"/);
    assert.equal(existsSync(stage), false);
    const overlapping = Buffer.from(
      JSON.stringify({
        action: 'deploy',
        stageDirectory: stage,
        operationDirectory: join(stage, 'operation'),
      }),
    );
    const overlapHeader = Buffer.alloc(8);
    overlapHeader.writeBigUInt64BE(BigInt(overlapping.length));
    const rejected = spawnSync(
      'python3',
      [join(root, 'scripts/release/remote_server_release.py')],
      {
        input: Buffer.concat([
          overlapHeader,
          overlapping,
          imageLength,
          Buffer.alloc(10),
        ]),
        encoding: 'utf8',
      },
    );
    assert.notEqual(rejected.status, 0);
    assert.equal(existsSync(stage), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('failed lock acquisition removes only the new lock', () => {
  const parent = join(
    homedir(),
    'agent-scratch',
    'matrix-calendar-widget',
    'release-tests',
  );
  mkdirSync(parent, { recursive: true });
  const dir = mkdtempSync(join(parent, 'lock-'));
  try {
    const program = `import importlib.util,os,sys
from unittest.mock import patch
s=importlib.util.spec_from_file_location('r',sys.argv[1]); m=importlib.util.module_from_spec(s); s.loader.exec_module(m)
p=sys.argv[2]; cfg={'canonical':p,'projectDirectory':'/p','operationDirectory':'/o','archive':'/a','backupCheck':'/b','healthCheck':'/h','dependenciesCheck':'/d','project':'test','archiveSha256':'a'*64,'candidateId':'sha256:'+'b'*64,'candidateTag':'matrix-calendar-widget/server:archive-123-1','rollbackCompatible':True}
for target in ('open','flock'):
    obj=m.os if target=='open' else m.fcntl
    with patch.object(obj,target,side_effect=PermissionError('injected')):
        try: m.transaction(cfg)
        except PermissionError: pass
        else: raise SystemExit(1)
    if os.path.exists(p+'.release.lock'): raise SystemExit(2)
`;
    const result = spawnSync('python3', [
      '-c',
      program,
      join(root, 'scripts/release/remote_server_release.py'),
      join(dir, 'compose'),
    ]);
    assert.equal(result.status, 0, result.stderr.toString());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('termination during transfer removes the partial stage', async () => {
  const parent = join(
    homedir(),
    'agent-scratch',
    'matrix-calendar-widget',
    'release-tests',
  );
  mkdirSync(parent, { recursive: true });
  const dir = mkdtempSync(join(parent, 'signal-'));
  const stage = join(dir, 'stage');
  const request = Buffer.from(
    JSON.stringify({
      action: 'deploy',
      stageDirectory: stage,
      operationDirectory: join(dir, 'operation'),
    }),
  );
  const header = Buffer.alloc(8);
  header.writeBigUInt64BE(BigInt(request.length));
  const imageLength = Buffer.alloc(8);
  imageLength.writeBigUInt64BE(2n * 1024n * 1024n);
  const child = spawn(
    'python3',
    [join(root, 'scripts/release/remote_server_release.py')],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  );
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  const exited = once(child, 'exit');
  try {
    child.stdin.write(
      Buffer.concat([header, request, imageLength, Buffer.alloc(1024 * 1024)]),
    );
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      try {
        if (statSync(join(stage, 'server.tar')).size > 0) break;
      } catch {
        /* waiting for transfer */
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 20));
    }
    assert.ok(
      existsSync(join(stage, 'server.tar')) &&
        statSync(join(stage, 'server.tar')).size > 0,
      'transfer did not start',
    );
    child.kill('SIGTERM');
    await exited;
    assert.match(output, /"status": "unknown"/);
    assert.equal(existsSync(stage), false);
  } finally {
    if (child.exitCode === null && child.signalCode === null)
      child.kill('SIGKILL');
    rmSync(dir, { recursive: true, force: true });
  }
});

test('saved images cannot carry rollback or duplicate manifest tags', () => {
  const parent = join(
    homedir(),
    'agent-scratch',
    'matrix-calendar-widget',
    'release-tests',
  );
  mkdirSync(parent, { recursive: true });
  const dir = mkdtempSync(join(parent, 'image-tags-'));
  try {
    const tag = 'matrix-calendar-widget/server:archive-123-1';
    const manifest = join(dir, 'manifest.json');
    const archive = join(dir, 'image.tar');
    const check = () =>
      spawnSync('python3', [
        '-c',
        "import importlib.util,sys; s=importlib.util.spec_from_file_location('r',sys.argv[1]); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); m.check_saved_image_tags(sys.argv[2],sys.argv[3])",
        join(root, 'scripts/release/remote_server_release.py'),
        archive,
        tag,
      ]);
    writeFileSync(manifest, JSON.stringify([{ RepoTags: [tag] }]));
    execFileSync('tar', ['-cf', archive, '-C', dir, 'manifest.json']);
    assert.equal(check().status, 0);
    execFileSync('tar', ['-rf', archive, '-C', dir, 'manifest.json']);
    assert.notEqual(check().status, 0);
    writeFileSync(
      manifest,
      JSON.stringify([{ RepoTags: [tag, 'example.invalid/server:old'] }]),
    );
    execFileSync('tar', ['-cf', archive, '-C', dir, 'manifest.json']);
    assert.notEqual(check().status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('timed-out checks do not leave descendant processes running', () => {
  const parent = join(
    homedir(),
    'agent-scratch',
    'matrix-calendar-widget',
    'release-tests',
  );
  mkdirSync(parent, { recursive: true });
  const dir = mkdtempSync(join(parent, 'timeout-'));
  try {
    const marker = join(dir, 'should-not-exist');
    const program = `import importlib.util,subprocess,sys,time
s=importlib.util.spec_from_file_location('r',sys.argv[1]); m=importlib.util.module_from_spec(s); s.loader.exec_module(m)
child='import pathlib,sys,time; time.sleep(0.5); pathlib.Path(sys.argv[1]).write_text("late")'
parent='import subprocess,sys,time; subprocess.Popen([sys.executable,"-c",sys.argv[1],sys.argv[2]]); time.sleep(10)'
try: m.run([sys.executable,'-c',parent,child,sys.argv[2]],timeout=0.1)
except RuntimeError: pass
else: raise SystemExit(1)
time.sleep(0.7)
`;
    const result = spawnSync('python3', [
      '-c',
      program,
      join(root, 'scripts/release/remote_server_release.py'),
      marker,
    ]);
    assert.equal(result.status, 0, result.stderr.toString());
    assert.equal(existsSync(marker), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
