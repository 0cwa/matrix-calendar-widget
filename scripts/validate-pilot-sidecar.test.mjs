import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parseSidecarCliArgs } from './validate-sidecar-compose.mjs';
import {
  loadTrustedPilotManifest,
  parsePilotImageInspection,
  PILOT_IMAGES,
  readPrivatePilotBinding,
  validatePilotSidecarModel,
} from './validate-pilot-sidecar.mjs';

const expectedBinding = {
  roomId: '!pilot-room:example.org',
  calendarId: 'team-calendar',
};

const expectedIds = Object.fromEntries(
  PILOT_IMAGES.map((image, index) => [
    image.service,
    'sha256:' + String(index + 1).repeat(64),
  ]),
);

function fixture() {
  const services = Object.fromEntries(
    PILOT_IMAGES.map((image) => [
      image.service,
      { image: image.tag },
    ]),
  );
  services.server.environment = {
    ROOM_CALENDAR_PRINCIPAL_MODE: 'bot-account',
    ROOM_CALENDAR_ACCESS_ENABLED: 'true',
    ROOM_CALENDAR_BINDINGS: JSON.stringify([expectedBinding]),
  };

  return {
    model: { services },
    expected: { ...expectedBinding },
    manifestImages: PILOT_IMAGES.map((image) => ({
      name: image.name,
      tag: image.tag,
      image_id: expectedIds[image.service],
    })),
    inspectedImages: Object.fromEntries(
      PILOT_IMAGES.map((image) => [
        image.service,
        { id: expectedIds[image.service], platform: 'linux/amd64' },
      ]),
    ),
  };
}

function check({ model, expected, manifestImages, inspectedImages }) {
  validatePilotSidecarModel(model, expected, manifestImages, inspectedImages);
}

function mustReject(f) {
  assert.throws(() => check(f), {
    message: 'Pilot sidecar verification failed.',
  });
}

test('explicit pilot accepts one exact private binding and all three verified images', () => {
  assert.doesNotThrow(() => check(fixture()));
});

test('rejects default, missing and incorrect principal mode even with a valid room', () => {
  for (const mode of ['appservice', undefined, '', 'claimed-user']) {
    const f = fixture();
    if (mode === undefined) {
      delete f.model.services.server.environment.ROOM_CALENDAR_PRINCIPAL_MODE;
    } else {
      f.model.services.server.environment.ROOM_CALENDAR_PRINCIPAL_MODE =
        mode;
    }
    mustReject(f);
  }
});

test('rejects disabled room access, missing/malformed/extra or wrong binding', () => {
  for (const access of [undefined, 'false', false]) {
    const f = fixture();
    f.model.services.server.environment.ROOM_CALENDAR_ACCESS_ENABLED =
      access;
    mustReject(f);
  }

  for (const binding of [
    undefined,
    '',
    'invalid-json',
    '[]',
    JSON.stringify([expectedBinding, expectedBinding]),
    JSON.stringify([{ roomId: '!other:example.org', calendarId: 'team-calendar' }]),
    JSON.stringify([{ roomId: expectedBinding.roomId, calendarId: 'other' }]),
    JSON.stringify([{ ...expectedBinding, unexpected: true }]),
  ]) {
    const f = fixture();
    f.model.services.server.environment.ROOM_CALENDAR_BINDINGS = binding;
    mustReject(f);
  }

  const f = fixture();
  f.expected.calendarId = 'another-approved-calendar';
  mustReject(f);
});

test('rejects local, floating, switched or wrong-run rendered image references', () => {
  for (const image of PILOT_IMAGES) {
    for (const badImage of [
      'matrix-calendar-widget/' + image.name + ':local',
      image.tag.replace('archive-38913010664-1', 'archive-38892200863-1'),
      image.tag.replace('archive-38913010664-1', 'latest'),
      undefined,
    ]) {
      const f = fixture();
      f.model.services[image.service].image = badImage;
      mustReject(f);
    }
  }

  const f = fixture();
  f.model.services.server.image = f.model.services.widget.image;
  mustReject(f);
});

test('rejects mismatched, missing and platform-incompatible loaded IDs', () => {
  for (const image of PILOT_IMAGES) {
    const wrongId = fixture();
    wrongId.inspectedImages[image.service].id = 'sha256:' + 'f'.repeat(64);
    mustReject(wrongId);

    const missing = fixture();
    delete missing.inspectedImages[image.service];
    mustReject(missing);

    const wrongPlatform = fixture();
    wrongPlatform.inspectedImages[image.service].platform = 'linux/arm64';
    mustReject(wrongPlatform);

    const wrongManifest = fixture();
    wrongManifest.manifestImages.find(
      (entry) => entry.name === image.name,
    ).image_id = 'sha256:' + 'a'.repeat(64);
    mustReject(wrongManifest);
  }
});

test('rejects incomplete, duplicate or incorrectly tagged manifest image entries', () => {
  const f = fixture();
  f.manifestImages.pop();
  mustReject(f);

  const duplicate = fixture();
  duplicate.manifestImages[1] = { ...duplicate.manifestImages[0] };
  mustReject(duplicate);

  const badTag = fixture();
  badTag.manifestImages[0].tag += '-different';
  mustReject(badTag);
});

test('image inspection reads only the ID and OS/architecture tuple', () => {
  assert.deepEqual(
    parsePilotImageInspection(
      JSON.stringify(['sha256:' + '1'.repeat(64), 'linux', 'amd64']),
    ),
    { id: 'sha256:' + '1'.repeat(64), platform: 'linux/amd64' },
  );
  for (const invalid of ['', '{}', '["id", "linux"]', '["id", null, "amd64"]']) {
    assert.throws(() => parsePilotImageInspection(invalid), {
      message: 'Pilot sidecar verification failed.',
    });
  }
});

test('opt-in CLI requires both private inputs; generic defaults stay optional', () => {
  assert.deepEqual(parseSidecarCliArgs([]), {});
  assert.deepEqual(
    parseSidecarCliArgs(['--project-name', 'sidecar-test']),
    { 'project-name': 'sidecar-test' },
  );
  assert.equal(
    parseSidecarCliArgs([
      '--pilot',
      '--pilot-binding-file',
      '/private/binding.json',
      '--pilot-manifest',
      '/private/manifest.json',
    ]).pilot,
    true,
  );

  for (const args of [
    ['--pilot'],
    ['--pilot', '--pilot-binding-file', '/private/binding.json'],
    ['--pilot', '--pilot-manifest', '/private/manifest.json'],
    ['--pilot-manifest', '/private/manifest.json'],
    ['--pilot-binding-file', '/private/binding.json'],
  ]) {
    assert.throws(() => parseSidecarCliArgs(args), {
      message: /resolved values are never displayed/,
    });
  }
});

test('private file inputs fail closed on absent or unauthenticated content', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pilot-sidecar-test-'));
  try {
    const bindingFile = join(directory, 'binding.json');
    const manifestFile = join(directory, 'manifest.json');
    writeFileSync(bindingFile, JSON.stringify(expectedBinding), { mode: 0o600 });
    assert.deepEqual(readPrivatePilotBinding(bindingFile), expectedBinding);

    writeFileSync(
      manifestFile,
      JSON.stringify({
        source: {
          sha: '99d4c9f9f36aa0b0861a13499a7f7cd512c56920',
        },
        workflow: { run_id: 38913010664, run_attempt: 1 },
        images: fixture().manifestImages,
      }),
      { mode: 0o600 },
    );
    assert.throws(() => loadTrustedPilotManifest(manifestFile), {
      message: 'Pilot sidecar verification failed.',
    });

    for (const invalid of ['{}', '{"roomId":"!pilot:example.org"}', '[]']) {
      writeFileSync(bindingFile, invalid, { mode: 0o600 });
      assert.throws(() => readPrivatePilotBinding(bindingFile), {
        message: 'Pilot sidecar verification failed.',
      });
    }
    assert.throws(() => readPrivatePilotBinding(join(directory, 'absent')), {
      message: 'Pilot sidecar verification failed.',
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
