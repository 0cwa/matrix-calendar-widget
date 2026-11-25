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
  contentLinePropertyName,
  parseContentLine,
  readContentLines,
  type ICalendarContentLine,
} from './ICalendarContentLine';
import { type RawRevisionProperty } from './ICalendarRevision';

export type RawVeventProperty = {
  name: string;
  header: string;
  value: string;
  physicalLines: string[];
};

export function readMasterRevisionProperties(
  source: string,
): RawRevisionProperty[] | undefined {
  const lines = readContentLines(source);
  const range = findMasterVeventRange(lines);
  if (!range) {
    return undefined;
  }

  const properties: RawRevisionProperty[] = [];
  let nestedComponents = 0;
  for (let index = range.start + 1; index < range.end; index += 1) {
    const line = lines[index];
    const marker = line.value.toUpperCase();
    if (marker.startsWith('BEGIN:')) {
      nestedComponents += 1;
      continue;
    }
    if (marker.startsWith('END:')) {
      nestedComponents = Math.max(0, nestedComponents - 1);
      continue;
    }
    if (nestedComponents > 0) {
      continue;
    }

    const parsed = parseContentLine(line.value);
    if (parsed && isRevisionPropertyName(parsed.name)) {
      properties.push({
        ...line,
        name: parsed.name,
      });
    }
  }

  return properties;
}

export function readVeventRevisionProperties(
  source: string,
): RawRevisionProperty[][] | undefined {
  const lines = readContentLines(source);
  const ranges = findVeventRanges(lines);
  if (!ranges) {
    return undefined;
  }

  return ranges.map((range) => {
    const properties: RawRevisionProperty[] = [];
    let nestedComponents = 0;
    for (let index = range.start + 1; index < range.end; index += 1) {
      const line = lines[index];
      const marker = line.value.toUpperCase();
      if (marker.startsWith('BEGIN:')) {
        nestedComponents += 1;
        continue;
      }
      if (marker.startsWith('END:')) {
        nestedComponents = Math.max(0, nestedComponents - 1);
        continue;
      }
      if (nestedComponents > 0) {
        continue;
      }

      const parsed = parseContentLine(line.value);
      if (parsed && isRevisionPropertyName(parsed.name)) {
        properties.push({
          ...line,
          name: parsed.name,
        });
      }
    }
    return properties;
  });
}

export function readRawVeventProperties(
  source: string,
): RawVeventProperty[][] | undefined {
  const lines = readContentLines(source);
  const ranges = findVeventRanges(lines);
  if (!ranges) {
    return undefined;
  }

  return ranges.map((range) => {
    const properties: RawVeventProperty[] = [];
    let nestedComponents = 0;
    for (let index = range.start + 1; index < range.end; index += 1) {
      const line = lines[index];
      const marker = line.value.toUpperCase();
      if (marker.startsWith('BEGIN:')) {
        nestedComponents += 1;
        continue;
      }
      if (marker.startsWith('END:')) {
        nestedComponents = Math.max(0, nestedComponents - 1);
        continue;
      }
      if (nestedComponents !== 0) {
        continue;
      }
      const parsed = parseContentLine(line.value);
      if (parsed) {
        properties.push({ ...parsed, physicalLines: [...line.physicalLines] });
      }
    }
    return properties;
  });
}

export function rawVeventBlocks(source: string): ICalendarContentLine[][] {
  const lines = readContentLines(source);
  const ranges = findVeventRanges(lines);
  return (
    ranges?.map((range) =>
      lines.slice(range.start, range.end + 1).map((line) => ({
        value: line.value,
        physicalLines: [...line.physicalLines],
      })),
    ) ?? []
  );
}

export function rawVeventTextProperties(source: string): RawVeventProperty[][] {
  return (
    readRawVeventProperties(source)?.map((properties) =>
      properties.filter((property) =>
        ['summary', 'description', 'location'].includes(property.name),
      ),
    ) ?? []
  );
}

export function rawVeventAttachmentProperties(
  source: string,
): ICalendarContentLine[][] {
  const rawProperties = readRawVeventProperties(source);
  return (
    rawProperties?.map((properties) =>
      properties
        .filter((property) => property.name === 'attach')
        .map((property) => ({
          value: `${property.header}:${property.value}`,
          physicalLines: [...property.physicalLines],
        })),
    ) ?? []
  );
}

export function rawVeventConferenceProperties(
  source: string,
): ICalendarContentLine[][] {
  const rawProperties = readRawVeventProperties(source);
  return (
    rawProperties?.map((properties) =>
      properties
        .filter((property) => property.name === 'conference')
        .map((property) => ({
          value: `${property.header}:${property.value}`,
          physicalLines: [...property.physicalLines],
        })),
    ) ?? []
  );
}

export function rawVeventAlarmProperties(
  source: string,
): ICalendarContentLine[][][] {
  const lines = readContentLines(source);
  const ranges = findVeventRanges(lines);
  if (!ranges) {
    return [];
  }

  return ranges.map((range) => {
    const alarms: ICalendarContentLine[][] = [];
    const componentStack: string[] = [];
    let currentAlarm: ICalendarContentLine[] | undefined;
    for (let index = range.start + 1; index < range.end; index += 1) {
      const line = lines[index];
      const marker = line.value.toUpperCase();
      if (marker.startsWith('BEGIN:')) {
        const componentName = marker.slice('BEGIN:'.length);
        if (componentName === 'VALARM' && componentStack.length === 0) {
          currentAlarm = [];
        }
        componentStack.push(componentName);
        continue;
      }
      if (marker.startsWith('END:')) {
        const componentName = marker.slice('END:'.length);
        const popped = componentStack.pop();
        if (componentName === 'VALARM' && popped === 'VALARM' && currentAlarm) {
          alarms.push(currentAlarm);
          currentAlarm = undefined;
        }
        continue;
      }
      if (currentAlarm && componentStack.length === 1) {
        currentAlarm.push(line);
      }
    }
    return alarms;
  });
}

export function rawVeventAlarmComponents(
  source: string,
): ICalendarContentLine[][][] {
  const lines = readContentLines(source);
  const ranges = findVeventRanges(lines);
  if (!ranges) {
    return [];
  }

  return ranges.map((range) => {
    const alarms: ICalendarContentLine[][] = [];
    const componentStack: string[] = [];
    let alarmStart: number | undefined;
    for (let index = range.start + 1; index < range.end; index += 1) {
      const marker = lines[index].value.toUpperCase();
      if (marker.startsWith('BEGIN:')) {
        const componentName = marker.slice('BEGIN:'.length);
        if (componentName === 'VALARM' && componentStack.length === 0) {
          alarmStart = index;
        }
        componentStack.push(componentName);
        continue;
      }
      if (marker.startsWith('END:')) {
        const componentName = marker.slice('END:'.length);
        const popped = componentStack.pop();
        if (
          componentName === 'VALARM' &&
          popped === 'VALARM' &&
          alarmStart !== undefined
        ) {
          alarms.push(lines.slice(alarmStart, index + 1));
          alarmStart = undefined;
        }
      }
    }
    return alarms;
  });
}

export function findVeventRanges(
  lines: ICalendarContentLine[],
): Array<{ start: number; end: number }> | undefined {
  const ranges: Array<{ start: number; end: number }> = [];
  let start: number | undefined;
  let nestedComponents = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const marker = lines[index].value.toUpperCase();
    if (start === undefined) {
      if (marker === 'BEGIN:VEVENT') {
        start = index;
        nestedComponents = 0;
      }
      continue;
    }

    if (marker === 'END:VEVENT' && nestedComponents === 0) {
      ranges.push({ start, end: index });
      start = undefined;
      continue;
    }
    if (marker.startsWith('BEGIN:')) {
      nestedComponents += 1;
    } else if (marker.startsWith('END:')) {
      nestedComponents = Math.max(0, nestedComponents - 1);
    }
  }

  return start === undefined ? ranges : undefined;
}

export function findMasterVeventRange(
  lines: ICalendarContentLine[],
): { start: number; end: number } | undefined {
  let start: number | undefined;
  let hasRecurrenceId = false;
  let nestedComponents = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const marker = lines[index].value.toUpperCase();
    if (start === undefined) {
      if (marker === 'BEGIN:VEVENT') {
        start = index;
        hasRecurrenceId = false;
        nestedComponents = 0;
      }
      continue;
    }

    if (marker === 'END:VEVENT' && nestedComponents === 0) {
      if (!hasRecurrenceId) {
        return { start, end: index };
      }
      start = undefined;
      continue;
    }
    if (marker.startsWith('BEGIN:')) {
      nestedComponents += 1;
      continue;
    }
    if (marker.startsWith('END:')) {
      nestedComponents = Math.max(0, nestedComponents - 1);
      continue;
    }
    if (nestedComponents === 0) {
      hasRecurrenceId ||=
        contentLinePropertyName(lines[index].value) === 'recurrence-id';
    }
  }

  return undefined;
}

export function isRevisionPropertyName(
  name: string,
): name is RawRevisionProperty['name'] {
  return (
    name === 'dtstamp' ||
    name === 'created' ||
    name === 'last-modified' ||
    name === 'sequence'
  );
}
