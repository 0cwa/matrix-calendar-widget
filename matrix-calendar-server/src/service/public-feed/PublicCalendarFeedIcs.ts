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

export class PublicCalendarFeedComponentError extends Error {
  constructor() {
    super('Calendar contains components that public feeds do not support');
    this.name = 'PublicCalendarFeedComponentError';
  }
}

const ALLOWED_CHILDREN: Readonly<Record<string, ReadonlySet<string>>> = {
  VCALENDAR: new Set(['VEVENT', 'VTIMEZONE']),
  VEVENT: new Set(['VALARM']),
  VTIMEZONE: new Set(['STANDARD', 'DAYLIGHT']),
};

/**
 * Validate only the component tree; return and serve the canonical bytes
 * unchanged. Radicale 3.8 accepts unsupported component writes even when a
 * collection advertises VEVENT-only, so this check runs for every public read.
 */
export function assertVeventOnlyCalendar(bytes: Uint8Array): void {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new PublicCalendarFeedComponentError();
  }

  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const physicalLines = text.split(/\r\n|\n|\r/u);
  const lines: string[] = [];
  for (const line of physicalLines) {
    if (/^[ \t]/u.test(line)) {
      if (lines.length === 0) throw new PublicCalendarFeedComponentError();
      lines[lines.length - 1] += line.slice(1);
    } else if (line.length > 0) {
      lines.push(line);
    }
  }

  const stack: string[] = [];
  let calendarCount = 0;
  let calendarClosed = false;
  for (const line of lines) {
    const separator = line.indexOf(':');
    if (separator < 1) throw new PublicCalendarFeedComponentError();
    const propertyName = line
      .slice(0, separator)
      .split(';', 1)[0]
      .toUpperCase();
    if (!/^(?:[A-Z0-9-]+\.)?[A-Z0-9-]+$/u.test(propertyName)) {
      throw new PublicCalendarFeedComponentError();
    }
    if (stack.length === 0 && calendarClosed) {
      throw new PublicCalendarFeedComponentError();
    }
    if (stack.length === 0 && propertyName !== 'BEGIN') {
      throw new PublicCalendarFeedComponentError();
    }
    if (propertyName !== 'BEGIN' && propertyName !== 'END') continue;

    const component = line.slice(separator + 1).toUpperCase();
    if (!/^[A-Z0-9-]+$/u.test(component)) {
      throw new PublicCalendarFeedComponentError();
    }

    if (propertyName === 'BEGIN') {
      const parent = stack.at(-1);
      if (component === 'VCALENDAR') {
        if (parent || calendarCount !== 0) {
          throw new PublicCalendarFeedComponentError();
        }
        calendarCount += 1;
      } else if (!parent || !ALLOWED_CHILDREN[parent]?.has(component)) {
        throw new PublicCalendarFeedComponentError();
      }
      stack.push(component);
      continue;
    }

    if (stack.pop() !== component) {
      throw new PublicCalendarFeedComponentError();
    }
    if (component === 'VCALENDAR') calendarClosed = true;
  }

  if (calendarCount !== 1 || stack.length !== 0 || !calendarClosed) {
    throw new PublicCalendarFeedComponentError();
  }
}
