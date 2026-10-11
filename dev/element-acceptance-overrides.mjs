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

import { statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

export const DEFAULT_RADICALE_IMAGE =
  'matrix-calendar-widget/radicale-openid:3.8.0.0';

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

export function loadElementAcceptanceOverrides(environment, rootDirectory) {
  const composeFiles = parseComposeOverrideFiles(
    environment.ELEMENT_ACCEPTANCE_COMPOSE_OVERRIDE_FILES,
    rootDirectory,
  );

  return {
    composeFiles,
    skipElement: parseSkipElement(environment.ELEMENT_ACCEPTANCE_SKIP_ELEMENT),
    radicaleImage: parseRadicaleImage(
      environment.ELEMENT_ACCEPTANCE_RADICALE_IMAGE,
    ),
  };
}

export function appendComposeOverrideFiles(baseArguments, composeFiles) {
  return [...baseArguments, ...composeFiles.flatMap((file) => ['-f', file])];
}
