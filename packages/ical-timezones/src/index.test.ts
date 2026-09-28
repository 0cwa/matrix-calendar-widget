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

import { describe, expect, it } from '@jest/globals';
import ICAL from 'ical.js';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import provenance from './data/provenance.json';
import timezoneBlocks from './data/vtimezones.json';
import { getVTimezoneBlock } from './index';

function timezoneOffset(timezoneId: string, localTime: string): number {
  const component = getVTimezoneBlock(timezoneId);
  if (!component) {
    throw new Error(`No bundled VTIMEZONE for ${timezoneId}`);
  }

  const timezone = new ICAL.Timezone({ component, tzid: timezoneId });
  return timezone.utcOffset(ICAL.Time.fromString(localTime));
}

describe('getVTimezoneBlock', () => {
  it('returns components for known IANA zones', () => {
    for (const timezoneId of [
      'America/Edmonton',
      'America/Inuvik',
      'Etc/UTC',
      'Europe/Stockholm',
    ]) {
      expect(getVTimezoneBlock(timezoneId)).toContain(
        `BEGIN:VTIMEZONE\r\nTZID:${timezoneId}\r\n`,
      );
      expect(getVTimezoneBlock(timezoneId)).toContain('END:VTIMEZONE');
    }

    expect(timezoneOffset('Etc/UTC', '2026-01-15T12:00:00')).toBe(0);
    expect(timezoneOffset('Europe/Stockholm', '2026-01-15T12:00:00')).toBe(
      60 * 60,
    );
  });

  it('returns undefined for invalid, unsafe, unknown, or inherited keys', () => {
    for (const timezoneId of [
      '',
      '../America/Inuvik',
      'America/../Inuvik',
      'Not/A-Timezone',
      '__proto__',
      'constructor',
      null,
      undefined,
      12,
    ]) {
      expect(getVTimezoneBlock(timezoneId)).toBeUndefined();
    }
  });

  it('retains Inuvik historical and 2026 transitions in the serialized component', () => {
    const block = getVTimezoneBlock('America/Inuvik');
    expect(block).toBeDefined();
    expect(block).toContain('BEGIN:DAYLIGHT\r\n');
    expect(block).toContain('BEGIN:STANDARD\r\n');
    expect(block).toContain('DTSTART:19720430T020000\r\n');
    expect(block).toContain(
      'TZOFFSETFROM:-0600\r\nTZOFFSETTO:-0600\r\nDTSTART:20261101T020000\r\n',
    );

    expect(timezoneOffset('America/Inuvik', '1970-01-15T12:00:00')).toBe(
      -8 * 60 * 60,
    );
    expect(timezoneOffset('America/Inuvik', '1970-07-15T12:00:00')).toBe(
      -8 * 60 * 60,
    );
    expect(timezoneOffset('America/Inuvik', '1972-01-15T12:00:00')).toBe(
      -8 * 60 * 60,
    );
    expect(timezoneOffset('America/Inuvik', '1972-07-15T12:00:00')).toBe(
      -7 * 60 * 60,
    );
    expect(timezoneOffset('America/Inuvik', '2026-01-15T12:00:00')).toBe(
      -7 * 60 * 60,
    );
    expect(timezoneOffset('America/Inuvik', '2026-11-01T01:59:00')).toBe(
      -6 * 60 * 60,
    );
    expect(timezoneOffset('America/Inuvik', '2026-11-01T02:01:00')).toBe(
      -6 * 60 * 60,
    );
    expect(timezoneOffset('America/Inuvik', '2026-12-15T12:00:00')).toBe(
      -6 * 60 * 60,
    );
  });

  it('expands the IANA CET link to its own tagged VTIMEZONE component', () => {
    expect(getVTimezoneBlock('CET')).toContain(
      'BEGIN:VTIMEZONE\r\nTZID:CET\r\n',
    );
    expect(timezoneOffset('CET', '2026-01-15T12:00:00')).toBe(60 * 60);
    expect(timezoneOffset('CET', '2026-07-15T12:00:00')).toBe(2 * 60 * 60);
  });

  it('keeps the bundled data hash tied to its provenance manifest', () => {
    const dataPath = join(__dirname, 'data', 'vtimezones.json');
    const dataHash = createHash('sha256')
      .update(readFileSync(dataPath))
      .digest('hex');

    expect(dataHash).toBe(provenance.outputs['vtimezones.json']);
    expect(provenance.iana.version).toBe('2026d');
    expect(provenance).not.toHaveProperty('generatedAt');
    expect(
      Object.values(timezoneBlocks).some((block) =>
        block.includes('LAST-MODIFIED:'),
      ),
    ).toBe(false);
  });
});
