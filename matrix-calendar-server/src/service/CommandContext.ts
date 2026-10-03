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

export const DEFAULT_COMMAND_TIME_ZONE = 'UTC';

export interface CommandContext {
  args: string[];
  timeZone: string;
}

export class InvalidCommandContextError extends Error {
  constructor() {
    super('Use --tz followed by a valid IANA time zone.');
    this.name = 'InvalidCommandContextError';
  }
}

/**
 * Removes the optional per-message timezone flag from command arguments.
 * Commands without a flag always use UTC, independent of the host timezone.
 */
export function parseCommandContext(args: readonly string[]): CommandContext {
  const commandArgs: string[] = [];
  let timeZone = DEFAULT_COMMAND_TIME_ZONE;
  let hasTimeZone = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--tz' || argument.startsWith('--tz=')) {
      if (hasTimeZone || argument !== '--tz') {
        throw new InvalidCommandContextError();
      }

      const value = args[index + 1];
      if (!value || value.startsWith('--') || !isValidTimeZone(value)) {
        throw new InvalidCommandContextError();
      }

      timeZone = value;
      hasTimeZone = true;
      index += 1;
      continue;
    }

    commandArgs.push(argument);
  }

  return { args: commandArgs, timeZone };
}

function isValidTimeZone(value: string): boolean {
  if (value.startsWith('+') || value.startsWith('-')) {
    return false;
  }

  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
