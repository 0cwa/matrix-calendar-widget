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

import timezoneBlocksJson from './data/vtimezones.json';

const timezoneBlocks = timezoneBlocksJson as Record<string, string>;
const timezoneIdPattern = /^[A-Za-z0-9._+-]+(?:\/[A-Za-z0-9._+-]+)*$/;

/**
 * Return the bundled VTIMEZONE component for a supported IANA identifier.
 * Invalid identifiers and identifiers missing from this data release return
 * `undefined`. The lookup is exact and never interprets the identifier as a
 * filesystem path.
 */
export function getVTimezoneBlock(timezoneId: unknown): string | undefined {
  if (typeof timezoneId !== 'string' || !timezoneIdPattern.test(timezoneId)) {
    return undefined;
  }

  if (timezoneId.split('/').some((part) => part === '.' || part === '..')) {
    return undefined;
  }

  if (!Object.hasOwn(timezoneBlocks, timezoneId)) {
    return undefined;
  }

  return timezoneBlocks[timezoneId];
}
