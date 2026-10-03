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

import {
  DEFAULT_COMMAND_TIME_ZONE,
  InvalidCommandContextError,
  parseCommandContext,
} from './CommandContext';

describe('parseCommandContext', () => {
  test('defaults to UTC and preserves command arguments', () => {
    expect(parseCommandContext(['upcoming', '3'])).toEqual({
      args: ['upcoming', '3'],
      timeZone: 'UTC',
    });
    expect(DEFAULT_COMMAND_TIME_ZONE).toBe('UTC');
  });

  test('removes one explicit timezone flag without changing other arguments', () => {
    expect(
      parseCommandContext(['upcoming', '--tz', 'Europe/Stockholm', '3']),
    ).toEqual({
      args: ['upcoming', '3'],
      timeZone: 'Europe/Stockholm',
    });
  });

  test('rejects an invalid timezone', () => {
    expect(() =>
      parseCommandContext(['upcoming', '--tz', 'Not/AZone']),
    ).toThrow(InvalidCommandContextError);
  });

  test('rejects a numeric UTC offset because the flag requires an IANA zone', () => {
    expect(() => parseCommandContext(['upcoming', '--tz', '+02:00'])).toThrow(
      InvalidCommandContextError,
    );
  });

  test.each([
    ['missing timezone', ['upcoming', '--tz']],
    [
      'a following option instead of a timezone',
      ['upcoming', '--tz', '--limit'],
    ],
    [
      'duplicate timezone flags',
      ['upcoming', '--tz', 'UTC', '--tz', 'Europe/Stockholm'],
    ],
    ['equals syntax', ['upcoming', '--tz=Europe/Stockholm']],
  ])('rejects %s', (_name, args) => {
    expect(() => parseCommandContext(args)).toThrow(InvalidCommandContextError);
  });
});
