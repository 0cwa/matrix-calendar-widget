import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
} from 'node:fs';

// This contract applies only to the source/image archive accepted for #251.
// It does not replace the generic sidecar defaults or approve a deployment.
const PILOT_SOURCE = '99d4c9f9f36aa0b0861a13499a7f7cd512c56920';
const PILOT_WORKFLOW = '289358712e4e58c452b65d18a03c0a442721245c';
const PILOT_MANIFEST_SHA256 =
  'd0315e465e33e38f093fe4de2faf0e5eb0f57afc6fec7e0c2aa325a727d9ae49';
const PILOT_RUN_ID = 38913010664;
const PILOT_RUN_ATTEMPT = 1;
const PILOT_PLATFORM = 'linux/amd64';
const IMAGE_ID_PATTERN = /^sha256:[0-9a-f]{64}$/;

export const PILOT_IMAGES = Object.freeze([
  Object.freeze({
    service: 'server',
    name: 'server',
    tag: 'matrix-calendar-widget/server:archive-38913010664-1',
  }),
  Object.freeze({
    service: 'widget',
    name: 'widget',
    tag: 'matrix-calendar-widget/widget:archive-38913010664-1',
  }),
  Object.freeze({
    service: 'radicale',
    name: 'radicale',
    tag: 'matrix-calendar-widget/radicale-openid:archive-38913010664-1',
  }),
]);

function fail() {
  // Never include private paths, room IDs, credentials, image metadata, or
  // raw Compose/manifest output in operator-visible errors.
  throw new Error('Pilot sidecar verification failed.');
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  return (
    isRecord(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function readBoundedPrivateFile(
  filename,
  maxBytes,
  requirePrivateOwner = false,
) {
  let fd;
  try {
    // Reject symlinks and non-regular files; private inputs are never logged.
    fd = openSync(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = fstatSync(fd);
    if (
      !stat.isFile() ||
      stat.size < 1 ||
      stat.size > maxBytes ||
      (requirePrivateOwner &&
        ((stat.mode & 0o077) !== 0 ||
          (typeof process.geteuid === 'function' &&
            stat.uid !== process.geteuid())))
    ) {
      fail();
    }
    const bytes = readFileSync(fd);
    if (bytes.length < 1 || bytes.length > maxBytes) fail();
    return bytes;
  } catch {
    fail();
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export function readPrivatePilotBinding(filename) {
  try {
    const value = JSON.parse(
      readBoundedPrivateFile(filename, 4096, true).toString('utf8'),
    );
    if (
      !hasExactKeys(value, ['roomId', 'calendarId']) ||
      typeof value.roomId !== 'string' ||
      value.roomId.length === 0 ||
      typeof value.calendarId !== 'string' ||
      value.calendarId.length === 0
    ) {
      fail();
    }
    return value;
  } catch {
    fail();
  }
}

export function loadTrustedPilotManifest(filename) {
  try {
    const bytes = readBoundedPrivateFile(filename, 65536);
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (digest !== PILOT_MANIFEST_SHA256) fail();
    const manifest = JSON.parse(bytes.toString('utf8'));
    if (
      !isRecord(manifest) ||
      manifest.schema_version !== 2 ||
      manifest.source?.sha !== PILOT_SOURCE ||
      manifest.workflow?.sha !== PILOT_WORKFLOW ||
      manifest.workflow?.run_id !== PILOT_RUN_ID ||
      manifest.workflow?.run_attempt !== PILOT_RUN_ATTEMPT ||
      manifest.platform !== PILOT_PLATFORM ||
      !Array.isArray(manifest.images) ||
      manifest.images.length !== PILOT_IMAGES.length
    ) {
      fail();
    }

    for (const image of PILOT_IMAGES) {
      const entries = manifest.images.filter(
        (entry) => entry?.name === image.name,
      );
      if (
        entries.length !== 1 ||
        entries[0].tag !== image.tag ||
        !IMAGE_ID_PATTERN.test(entries[0].image_id)
      ) {
        fail();
      }
    }
    return manifest.images;
  } catch {
    fail();
  }
}

export function parsePilotImageInspection(output) {
  try {
    const values = JSON.parse(output);
    if (
      !Array.isArray(values) ||
      values.length !== 3 ||
      !values.every((value) => typeof value === 'string')
    ) {
      fail();
    }
    return { id: values[0], platform: values[1] + '/' + values[2] };
  } catch {
    fail();
  }
}

/**
 * Additional contract for exactly one selected, owner-approved pilot.
 * The generic validator still runs first and validates the full server schema.
 * Expected binding and manifest are private/authenticated inputs, never output.
 */
export function validatePilotSidecarModel(
  model,
  expectedBinding,
  manifestImages,
  inspectedImages,
) {
  const environment = model?.services?.server?.environment;
  if (
    !isRecord(environment) ||
    environment.ROOM_CALENDAR_PRINCIPAL_MODE !== 'bot-account' ||
    (environment.ROOM_CALENDAR_ACCESS_ENABLED !== true &&
      environment.ROOM_CALENDAR_ACCESS_ENABLED !== 'true') ||
    !hasExactKeys(expectedBinding, ['roomId', 'calendarId']) ||
    !Array.isArray(manifestImages) ||
    manifestImages.length !== PILOT_IMAGES.length ||
    !isRecord(inspectedImages)
  ) {
    fail();
  }

  let bindings;
  try {
    bindings = JSON.parse(environment.ROOM_CALENDAR_BINDINGS);
  } catch {
    fail();
  }

  if (
    !Array.isArray(bindings) ||
    bindings.length !== 1 ||
    !hasExactKeys(bindings[0], ['roomId', 'calendarId']) ||
    bindings[0].roomId !== expectedBinding.roomId ||
    bindings[0].calendarId !== expectedBinding.calendarId
  ) {
    fail();
  }

  for (const expected of PILOT_IMAGES) {
    const matching = manifestImages.filter(
      (image) => image?.name === expected.name,
    );
    const inspected = inspectedImages[expected.service];
    if (
      model.services[expected.service]?.image !== expected.tag ||
      matching.length !== 1 ||
      matching[0].tag !== expected.tag ||
      !IMAGE_ID_PATTERN.test(matching[0].image_id) ||
      !isRecord(inspected) ||
      inspected.id !== matching[0].image_id ||
      inspected.platform !== PILOT_PLATFORM
    ) {
      fail();
    }
  }
}
