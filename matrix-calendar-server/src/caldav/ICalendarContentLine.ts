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

/** A logical content line together with its original physical lines. */
export type ICalendarContentLine = {
  value: string;
  physicalLines: string[];
};

export function splitContentLineHeader(header: string): string[] {
  const segments: string[] = [];
  let start = 0;
  let quoted = false;
  for (let index = 0; index < header.length; index += 1) {
    if (header[index] === '"' && header[index - 1] !== '^') {
      quoted = !quoted;
    } else if (header[index] === ';' && !quoted) {
      segments.push(header.slice(start, index));
      start = index + 1;
    }
  }
  segments.push(header.slice(start));
  return segments;
}

export function foldContentLine(value: string): ICalendarContentLine {
  const physicalLines: string[] = [];
  let current = '';
  let currentBytes = 0;
  for (const character of Array.from(value)) {
    const bytes = Buffer.byteLength(character, 'utf8');
    if (currentBytes + bytes > 75) {
      physicalLines.push(current);
      current = ` ${character}`;
      currentBytes = 1 + bytes;
    } else {
      current += character;
      currentBytes += bytes;
    }
  }
  physicalLines.push(current);
  return { value, physicalLines };
}

export function contentLineParameters(
  header: string,
): Array<{ name: string; value?: string }> {
  const segments: string[] = [];
  let segment = '';
  let quoted = false;
  for (let index = 0; index < header.length; index += 1) {
    const character = header[index];
    if (character === '"' && header[index - 1] !== '^') {
      quoted = !quoted;
    }
    if (character === ';' && !quoted) {
      segments.push(segment);
      segment = '';
    } else {
      segment += character;
    }
  }
  segments.push(segment);

  return segments.slice(1).map((segment) => {
    const separator = segment.indexOf('=');
    const name = (separator < 0 ? segment : segment.slice(0, separator))
      .trim()
      .toLowerCase();
    const rawValue =
      separator < 0 ? undefined : segment.slice(separator + 1).trim();
    return {
      name,
      ...(rawValue === undefined
        ? {}
        : {
            value:
              rawValue.length >= 2 &&
              rawValue.startsWith('"') &&
              rawValue.endsWith('"')
                ? rawValue.slice(1, -1)
                : rawValue,
          }),
    };
  });
}

export function readContentLines(source: string): ICalendarContentLine[] {
  const physicalLines = source.split(/\r\n|\n|\r/);
  if (physicalLines.at(-1) === '') {
    physicalLines.pop();
  }

  const lines: ICalendarContentLine[] = [];
  for (const physicalLine of physicalLines) {
    if (/^[ \t]/.test(physicalLine) && lines.length > 0) {
      const previous = lines[lines.length - 1];
      previous.value += physicalLine.slice(1);
      previous.physicalLines.push(physicalLine);
    } else {
      lines.push({ value: physicalLine, physicalLines: [physicalLine] });
    }
  }
  return lines;
}

export function parseContentLine(
  line: string,
): { name: string; header: string; value: string } | undefined {
  const colonIndex = contentLineColonIndex(line);
  if (colonIndex < 0) {
    return undefined;
  }

  const header = line.slice(0, colonIndex);
  const separator = header.indexOf(';');
  const name = (separator < 0 ? header : header.slice(0, separator))
    .trim()
    .toLowerCase();
  return name ? { name, header, value: line.slice(colonIndex + 1) } : undefined;
}

export function contentLinePropertyName(line: string): string | undefined {
  return parseContentLine(line)?.name;
}

export function calendarParameterValue(
  header: string,
  parameterName: string,
): string | undefined {
  const parameters = header.split(';').slice(1);
  const parameter = parameters.find(
    (item) => item.split('=', 1)[0].trim().toLowerCase() === parameterName,
  );
  return parameter?.includes('=')
    ? parameter.slice(parameter.indexOf('=') + 1).replace(/^"|"$/g, '')
    : undefined;
}

export function hasCalendarParameter(
  header: string,
  parameterName: string,
): boolean {
  return header
    .split(';')
    .slice(1)
    .some(
      (item) => item.split('=', 1)[0].trim().toLowerCase() === parameterName,
    );
}

function contentLineColonIndex(line: string): number {
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === '"' && line[index - 1] !== '^') {
      quoted = !quoted;
    } else if (line[index] === ':' && !quoted) {
      return index;
    }
  }
  return -1;
}
