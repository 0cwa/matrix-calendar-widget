/*
 * Copyright 2026 Matrix Calendar Widget contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { lstatSync, statSync } from 'node:fs';
import { isAbsolute, resolve, sep } from 'node:path';

export const DEFAULT_RADICALE_IMAGE =
  'matrix-calendar-widget/radicale-openid:3.8.0.0';

export const LOCAL_REHEARSAL_LABEL =
  'io.matrix-calendar-widget.local-rehearsal';

export const LOCAL_REHEARSAL_SERVICES = Object.freeze([
  'synapse',
  'radicale',
  'gateway',
  'widget',
  'postgres',
  'restore-radicale',
  'restore-gateway',
]);

export const LOCAL_REHEARSAL_VOLUMES = Object.freeze([
  'synapse-data',
  'radicale-data',
  'postgres-data',
  'reminder-restore-radicale-data',
]);

export function hasLocalRehearsalRunLabel(labels, runId) {
  return (
    labels !== null &&
    typeof labels === 'object' &&
    !Array.isArray(labels) &&
    typeof runId === 'string' &&
    /^[a-f0-9]{16}$/u.test(runId) &&
    labels[LOCAL_REHEARSAL_LABEL] === runId
  );
}

export function hasLocalComposeResourceOwnership(
  labels,
  { runId, projectName, service, volume },
) {
  const hasService = typeof service === 'string' && service.length > 0;
  const hasVolume = typeof volume === 'string' && volume.length > 0;
  if (
    !hasLocalRehearsalRunLabel(labels, runId) ||
    projectName !== `mcw-p0-${runId}` ||
    hasService === hasVolume ||
    (service !== undefined && !hasService) ||
    (volume !== undefined && !hasVolume)
  ) {
    return false;
  }
  if (service !== undefined) {
    return (
      labels['com.docker.compose.project'] === projectName &&
      labels['com.docker.compose.service'] === service
    );
  }
  return (
    labels['com.docker.compose.project'] === projectName &&
    labels['com.docker.compose.volume'] === volume
  );
}

const MAX_COMPOSE_OVERRIDE_FILES = 8;
const MAX_COMPOSE_OVERRIDE_JSON_LENGTH = 32 * 1024;
const MAX_COMPOSE_OVERRIDE_PATH_LENGTH = 4096;
const MAX_RADICALE_IMAGE_LENGTH = 255;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u;
const IMAGE_NAME_COMPONENT = '[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*';
const IMAGE_REFERENCE = new RegExp(
  `^(?:(?:[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*)(?::[0-9]{1,5})?\\/)?${IMAGE_NAME_COMPONENT}(?:\\/${IMAGE_NAME_COMPONENT})*(?::[A-Za-z0-9_][A-Za-z0-9_.-]{0,127})?(?:@sha256:[a-f0-9]{64})?$`,
  'u',
);

function invalidComposeOverride() {
  return new TypeError(
    'ELEMENT_ACCEPTANCE_COMPOSE_OVERRIDE_FILES must be a JSON array of at most eight existing files',
  );
}

function parseComposeOverrideFiles(rawValue, rootDirectory) {
  if (rawValue === undefined) return [];
  if (
    typeof rawValue !== 'string' ||
    rawValue.length > MAX_COMPOSE_OVERRIDE_JSON_LENGTH ||
    CONTROL_CHARACTERS.test(rawValue)
  ) {
    throw invalidComposeOverride();
  }

  let files;
  try {
    files = JSON.parse(rawValue);
  } catch {
    throw invalidComposeOverride();
  }

  if (
    !Array.isArray(files) ||
    files.length > MAX_COMPOSE_OVERRIDE_FILES ||
    files.some(
      (file) =>
        typeof file !== 'string' ||
        file.length === 0 ||
        file.length > MAX_COMPOSE_OVERRIDE_PATH_LENGTH ||
        CONTROL_CHARACTERS.test(file),
    )
  ) {
    throw invalidComposeOverride();
  }

  for (const file of files) {
    const path = isAbsolute(file) ? file : resolve(rootDirectory, file);
    let isFile = false;
    try {
      isFile = statSync(path).isFile();
    } catch {
      // Report one generic configuration error without echoing a supplied path.
    }
    if (!isFile) throw invalidComposeOverride();
  }

  return files;
}

function parseRadicaleImage(rawValue) {
  if (rawValue === undefined) return DEFAULT_RADICALE_IMAGE;
  if (
    typeof rawValue !== 'string' ||
    rawValue.length === 0 ||
    rawValue.length > MAX_RADICALE_IMAGE_LENGTH ||
    CONTROL_CHARACTERS.test(rawValue) ||
    !IMAGE_REFERENCE.test(rawValue)
  ) {
    throw new TypeError(
      'ELEMENT_ACCEPTANCE_RADICALE_IMAGE must be a valid container image reference',
    );
  }
  return rawValue;
}

function parseSkipElement(rawValue) {
  if (rawValue === undefined || rawValue === 'false') return false;
  if (rawValue === 'true') return true;
  throw new TypeError(
    'ELEMENT_ACCEPTANCE_SKIP_ELEMENT must be exactly "true" or "false"',
  );
}

function parseLocalPrebuiltControls(environment, composeFiles, skipElement) {
  const enabled = environment.MATRIX_CALENDAR_LOCAL_PREBUILT_REHEARSAL;
  if (enabled === undefined || enabled === 'false') {
    return { localPrebuilt: false };
  }
  if (enabled !== 'true') {
    throw new TypeError(
      'MATRIX_CALENDAR_LOCAL_PREBUILT_REHEARSAL must be exactly "true" or "false"',
    );
  }

  const runId = environment.ELEMENT_ACCEPTANCE_LOCAL_RUN_ID;
  const projectName = environment.COMPOSE_PROJECT_NAME;
  const composeOverrideFile =
    environment.MATRIX_CALENDAR_LOCAL_COMPOSE_OVERRIDE_FILE;
  const composeEnvFile = environment.MATRIX_CALENDAR_LOCAL_COMPOSE_ENV_FILE;
  const runnerTemp = environment.RUNNER_TEMP;
  const dockerHostPath =
    typeof environment.DOCKER_HOST === 'string' &&
    environment.DOCKER_HOST.startsWith('unix:///')
      ? environment.DOCKER_HOST.slice('unix://'.length)
      : '';
  const dockerConfig = environment.DOCKER_CONFIG;
  const radicaleImage = environment.ELEMENT_ACCEPTANCE_RADICALE_IMAGE;
  const privateFile = (file) => {
    if (
      typeof file !== 'string' ||
      !isAbsolute(file) ||
      typeof runnerTemp !== 'string' ||
      !isAbsolute(runnerTemp) ||
      !resolve(file).startsWith(`${resolve(runnerTemp)}${sep}`)
    ) {
      return false;
    }
    try {
      const info = lstatSync(file);
      return (
        info.isFile() &&
        !info.isSymbolicLink() &&
        info.uid === process.getuid?.() &&
        (info.mode & 0o077) === 0
      );
    } catch {
      return false;
    }
  };
  const privateConfigDirectory = () => {
    if (typeof dockerConfig !== 'string' || !isAbsolute(dockerConfig)) {
      return false;
    }
    try {
      const info = lstatSync(dockerConfig);
      return (
        info.isDirectory() &&
        !info.isSymbolicLink() &&
        info.uid === process.getuid?.() &&
        (info.mode & 0o077) === 0
      );
    } catch {
      return false;
    }
  };
  if (
    typeof runId !== 'string' ||
    !/^[a-f0-9]{16}$/u.test(runId) ||
    projectName !== `mcw-p0-${runId}` ||
    !skipElement ||
    composeFiles.length !== 1 ||
    !isAbsolute(composeOverrideFile ?? '') ||
    composeFiles[0] !== composeOverrideFile ||
    !privateFile(composeOverrideFile) ||
    !privateFile(composeEnvFile) ||
    !privateConfigDirectory() ||
    dockerHostPath.length === 0 ||
    !isAbsolute(dockerHostPath) ||
    dockerHostPath === '/var/run/docker.sock' ||
    dockerHostPath === '/run/docker.sock' ||
    /^\/run\/user\/[0-9]+\/(?:docker|podman)\/podman\.sock$/u.test(
      dockerHostPath,
    ) ||
    environment.DOCKER_CONTEXT !== undefined ||
    environment.COMPOSE_FILE !== undefined ||
    environment.COMPOSE_PROFILES !== undefined ||
    environment.COMPOSE_ENV_FILES !== undefined ||
    environment.COMPOSE_PATH_SEPARATOR !== undefined ||
    typeof radicaleImage !== 'string' ||
    !/^matrix-calendar-widget\/radicale-openid:archive-\d{1,20}-\d{1,4}$/u.test(
      radicaleImage,
    ) ||
    environment.MATRIX_CALENDAR_DEV_SYNAPSE_PORT_MAPPING !==
      '127.0.0.1:8008:8008' ||
    environment.MATRIX_CALENDAR_DEV_RADICALE_PORT_MAPPING !==
      '127.0.0.1:5232:5232'
  ) {
    throw new TypeError('Local prebuilt rehearsal controls are invalid');
  }

  return {
    localPrebuilt: true,
    runId,
    projectName,
    composeOverrideFile,
    composeEnvFile,
  };
}

export function loadElementAcceptanceOverrides(environment, rootDirectory) {
  const composeFiles = parseComposeOverrideFiles(
    environment.ELEMENT_ACCEPTANCE_COMPOSE_OVERRIDE_FILES,
    rootDirectory,
  );

  const skipElement = parseSkipElement(
    environment.ELEMENT_ACCEPTANCE_SKIP_ELEMENT,
  );

  return {
    composeFiles,
    skipElement,
    ...parseLocalPrebuiltControls(environment, composeFiles, skipElement),
    radicaleImage: parseRadicaleImage(
      environment.ELEMENT_ACCEPTANCE_RADICALE_IMAGE,
    ),
  };
}

export function withLocalNoPullComposeArgs(args, localPrebuilt) {
  if (!localPrebuilt) return args;
  if (args[0] === 'build' || args[0] === 'pull') {
    throw new TypeError(
      'Local prebuilt rehearsal refuses image builds and pulls',
    );
  }
  if (args[0] !== 'up' && args[0] !== 'run') return args;

  const operation = args[0];
  const pullOptions = args.filter(
    (argument) => argument === '--pull' || argument.startsWith('--pull='),
  );
  if (
    pullOptions.length > 1 ||
    (pullOptions.length === 1 &&
      (pullOptions[0] === '--pull'
        ? args[args.indexOf('--pull') + 1] !== 'never'
        : pullOptions[0] !== '--pull=never'))
  ) {
    throw new TypeError('Local prebuilt rehearsal refuses Compose pulls');
  }
  if (args.includes('--build')) {
    throw new TypeError('Local prebuilt rehearsal refuses Compose builds');
  }

  const result = [operation];
  if (pullOptions.length === 0) result.push('--pull', 'never');
  if (operation === 'up' && !args.includes('--no-build')) {
    result.push('--no-build');
  }
  result.push(...args.slice(1));
  return result;
}

export function withLocalOwnedDockerRunArgs(args, controls, runCounter) {
  if (!controls.localPrebuilt || args[0] !== 'run') return args;
  if (
    !Number.isSafeInteger(runCounter) ||
    runCounter < 1 ||
    args.some(
      (argument) =>
        argument === '--context' ||
        argument.startsWith('--context=') ||
        argument === '--pull' ||
        argument.startsWith('--pull=') ||
        argument === '--name' ||
        argument.startsWith('--name=') ||
        argument === '--label' ||
        argument.startsWith('--label='),
    )
  ) {
    throw new TypeError(
      'Local Docker run options are controlled by the runner',
    );
  }
  const name = `${controls.projectName}-local-${controls.runId}-${runCounter}`;
  return [
    'run',
    '--pull=never',
    '--label',
    `${LOCAL_REHEARSAL_LABEL}=${controls.runId}`,
    '--name',
    name,
    ...args.slice(1),
  ];
}

export function appendComposeOverrideFiles(baseArguments, composeFiles) {
  return [...baseArguments, ...composeFiles.flatMap((file) => ['-f', file])];
}

export function appendLocalComposeEnvFile(baseArguments, controls) {
  if (!controls.localPrebuilt) return baseArguments;
  if (baseArguments[0] !== 'compose') {
    throw new TypeError('Local Compose env-file requires the Compose command');
  }
  return [
    baseArguments[0],
    '--env-file',
    controls.composeEnvFile,
    ...baseArguments.slice(1),
  ];
}
