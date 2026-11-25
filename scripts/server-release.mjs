#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, lstatSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runner = readFileSync(
  join(root, 'scripts/release/remote_server_release.py'),
);
const digest = (value) => createHash('sha256').update(value).digest('hex');
function regular(path) {
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('invalid file');
  return info;
}
function frame(size) {
  const output = Buffer.alloc(8);
  output.writeBigUInt64BE(BigInt(size));
  return output;
}
async function remote(host, request, imagePath, imageSize) {
  const payload = Buffer.from(JSON.stringify(request));
  if (payload.length > 65536) throw new Error('request too large');
  const bootstrap = `exec(__import__("base64").b64decode("${runner.toString('base64')}").decode())`;
  // Only fixed code and base64 appear in the remote shell command. All
  // operator-controlled values are length-prefixed data on stdin.
  const child = spawn(
    'ssh',
    [
      '-T',
      '-o',
      'BatchMode=yes',
      '-o',
      'StrictHostKeyChecking=yes',
      '-o',
      'ConnectTimeout=10',
      host,
      `python3 -c '${bootstrap}'`,
    ],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  );
  const chunks = [];
  let length = 0;
  let tooMuch = false;
  child.stdout.on('data', (chunk) => {
    length += chunk.length;
    if (length <= 65536) chunks.push(chunk);
    else tooMuch = true;
  });
  // Remote subprocess stderr can contain secrets; do not forward it.
  child.stderr.resume();
  const finished = new Promise((resolveResult) => {
    child.on('error', () => resolveResult({ code: null }));
    child.on('close', (code) => resolveResult({ code }));
  });
  child.stdin.on('error', () => {});
  child.stdin.write(frame(payload.length));
  child.stdin.write(payload);
  if (imagePath) {
    child.stdin.write(frame(imageSize));
    const stream = createReadStream(imagePath);
    stream.on('error', () => child.stdin.destroy());
    stream.pipe(child.stdin);
  } else child.stdin.end();
  const { code } = await finished;
  if (tooMuch || code === 255 || code === null) return { status: 'unknown' };
  let result;
  try {
    result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return { status: 'unknown' };
  }
  if (
    !result ||
    ![
      'complete',
      'rolled-back',
      'recovery-incomplete',
      'failed',
      'unknown',
      'observed',
    ].includes(result.status)
  )
    return { status: 'unknown' };
  if (
    (result.status === 'complete' || result.status === 'observed') &&
    code !== 0
  )
    return { status: 'unknown' };
  return result;
}
async function main() {
  const [action, filename, ...extra] = process.argv.slice(2);
  if (!['deploy', 'status'].includes(action) || !filename || extra.length)
    throw new Error('usage');
  const info = regular(filename);
  if ((info.mode & 0o077) !== 0)
    throw new Error('configuration must be private');
  const config = JSON.parse(readFileSync(filename, 'utf8'));
  if (
    typeof config.host !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(config.host)
  )
    throw new Error('invalid SSH host');
  const { host, archiveRoot, manifestSha256, sourceSha, ...hostConfig } =
    config;
  let imagePath, imageSize;
  if (action === 'deploy') {
    if (
      typeof archiveRoot !== 'string' ||
      !archiveRoot.startsWith('/') ||
      !/^[0-9a-f]{64}$/.test(manifestSha256 ?? '') ||
      !/^[0-9a-f]{40}$/.test(sourceSha ?? '')
    )
      throw new Error('invalid release input');
    const manifestPath = join(archiveRoot, 'manifest.json');
    regular(manifestPath);
    const bytes = readFileSync(manifestPath);
    if (digest(bytes) !== manifestSha256)
      throw new Error('manifest digest mismatch');
    const verified = spawnSync(
      process.execPath,
      [
        join(root, 'scripts/release-image-archive.mjs'),
        'verify',
        '--archive-root',
        archiveRoot,
        '--expected-source-sha',
        sourceSha,
        '--platform',
        'linux/amd64',
      ],
      {
        encoding: 'utf8',
        env: { ...process.env, RELEASE_IMAGE_SET: 'server-only' },
        timeout: 300000,
      },
    );
    if (verified.error || verified.status !== 0)
      throw new Error('archive verification failed');
    const manifest = JSON.parse(bytes);
    if (
      manifest.image_set !== 'server-only' ||
      manifest.images.length !== 1 ||
      manifest.images[0].name !== 'server'
    )
      throw new Error('invalid image set');
    const image = manifest.images[0];
    imagePath = join(archiveRoot, image.archive.path);
    imageSize = regular(imagePath).size;
    if (imageSize !== image.archive.bytes) throw new Error('archive changed');
    Object.assign(hostConfig, {
      candidateTag: image.tag,
      candidateId: image.image_id,
      archiveSha256: image.archive.sha256,
    });
  }
  const result = await remote(
    host,
    { ...hostConfig, action },
    imagePath,
    imageSize,
  );
  if (result.status === 'observed') {
    const allowed = [
      'prepared',
      'preflight-failed',
      'recovering',
      'complete',
      'rolled-back',
      'recovery-incomplete',
    ];
    if (
      !allowed.includes(result.phase) ||
      !['candidate', 'previous', 'other', 'unknown'].includes(result.running) ||
      !['candidate', 'previous', 'other', 'unknown'].includes(result.saved) ||
      !['candidate', 'previous', 'other', 'unknown'].includes(
        result.savedResolved,
      ) ||
      !['active', 'stale', 'absent'].includes(result.lock) ||
      !['healthy', 'unhealthy', 'unknown'].includes(result.health)
    )
      throw new Error('invalid status');
    console.log(
      `Recorded phase: ${result.phase}; running: ${result.running}; saved: ${result.saved}; saved image resolves to: ${result.savedResolved}; lock: ${result.lock}; health: ${result.health}.`,
    );
  } else {
    const phase = [
      'preflight',
      'backup-check',
      'dependency-check',
      'image-check',
      'activation',
      'health',
      'canonical',
      'verification',
    ].includes(result.phase)
      ? ` (${result.phase})`
      : '';
    console.log(`${result.status}${phase}`);
  }
  if (!['complete', 'observed'].includes(result.status)) {
    if (result.status === 'unknown')
      console.error(
        'The remote outcome is unknown. Use the status action before taking further action.',
      );
    process.exitCode = 1;
  }
}
main().catch(() => {
  console.error(
    'Release input or archive verification failed; no deployment was started.',
  );
  process.exitCode = 1;
});
