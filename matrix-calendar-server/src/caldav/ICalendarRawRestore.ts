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
  CalendarEventOccurrenceTextField,
  CalendarEventOccurrenceTextOperation,
  CalendarEventOccurrenceWrite,
} from '@matrix-calendar-widget/calendar';
import {
  contentLinePropertyName,
  readContentLines,
  type ICalendarContentLine,
} from './ICalendarContentLine';
import {
  findVeventRanges,
  rawVeventAlarmComponents,
  type RawVeventProperty,
} from './ICalendarRawRead';

export type OccurrenceTextOperationMap = Partial<
  Record<CalendarEventOccurrenceTextField, CalendarEventOccurrenceTextOperation>
>;

export function occurrenceTextOperationMap(
  operation: CalendarEventOccurrenceWrite,
): OccurrenceTextOperationMap {
  if (operation.action !== 'set-fields') {
    return {};
  }
  return {
    ...(operation.title ? { title: operation.title } : {}),
    ...(operation.description ? { description: operation.description } : {}),
    ...(operation.location ? { location: operation.location } : {}),
  };
}

export function restoreVeventAttachmentProperties(
  serialized: string,
  sourcePropertiesByEvent: ICalendarContentLine[][],
  forceReplacementForEvent = new Set<number>(),
): string {
  const lines = readContentLines(serialized);
  const ranges = findVeventRanges(lines);
  if (!ranges) {
    return serialized;
  }
  for (let eventIndex = ranges.length - 1; eventIndex >= 0; eventIndex -= 1) {
    const range = ranges[eventIndex];
    const sourceProperties = sourcePropertiesByEvent[eventIndex] ?? [];
    if (
      sourceProperties.length === 0 &&
      !forceReplacementForEvent.has(eventIndex)
    ) {
      continue;
    }

    const body: ICalendarContentLine[] = [];
    let nestedComponents = 0;
    let inserted = false;
    for (let index = range.start + 1; index < range.end; index += 1) {
      const line = lines[index];
      const marker = line.value.toUpperCase();
      if (marker.startsWith('BEGIN:')) {
        nestedComponents += 1;
        body.push(line);
        continue;
      }
      if (marker.startsWith('END:')) {
        nestedComponents = Math.max(0, nestedComponents - 1);
        body.push(line);
        continue;
      }
      if (
        nestedComponents === 0 &&
        contentLinePropertyName(line.value) === 'attach'
      ) {
        if (!inserted) {
          body.push(...sourceProperties);
          inserted = true;
        }
        continue;
      }
      body.push(line);
    }
    if (!inserted && sourceProperties.length > 0) {
      const uidIndex = body.findIndex(
        (line) => contentLinePropertyName(line.value) === 'uid',
      );
      body.splice(uidIndex < 0 ? 0 : uidIndex + 1, 0, ...sourceProperties);
    }
    lines.splice(range.start + 1, range.end - range.start - 1, ...body);
  }
  const physicalLines = lines.flatMap((line) => line.physicalLines);
  const hasFinalLineEnding = /(?:\r\n|\n|\r)$/.test(serialized);
  return `${physicalLines.join('\r\n')}${hasFinalLineEnding ? '\r\n' : ''}`;
}

export function restoreVeventConferenceProperties(
  serialized: string,
  sourcePropertiesByEvent: ICalendarContentLine[][],
  forceReplacementForEvent = new Set<number>(),
): string {
  const lines = readContentLines(serialized);
  const ranges = findVeventRanges(lines);
  if (!ranges) {
    return serialized;
  }
  for (let eventIndex = ranges.length - 1; eventIndex >= 0; eventIndex -= 1) {
    const range = ranges[eventIndex];
    const sourceProperties = sourcePropertiesByEvent[eventIndex] ?? [];
    if (
      sourceProperties.length === 0 &&
      !forceReplacementForEvent.has(eventIndex)
    ) {
      continue;
    }

    const body: ICalendarContentLine[] = [];
    let nestedComponents = 0;
    let inserted = false;
    for (let index = range.start + 1; index < range.end; index += 1) {
      const line = lines[index];
      const marker = line.value.toUpperCase();
      if (marker.startsWith('BEGIN:')) {
        nestedComponents += 1;
        body.push(line);
        continue;
      }
      if (marker.startsWith('END:')) {
        nestedComponents = Math.max(0, nestedComponents - 1);
        body.push(line);
        continue;
      }
      if (
        nestedComponents === 0 &&
        contentLinePropertyName(line.value) === 'conference'
      ) {
        if (!inserted) {
          body.push(...sourceProperties);
          inserted = true;
        }
        continue;
      }
      body.push(line);
    }
    if (!inserted && sourceProperties.length > 0) {
      const uidIndex = body.findIndex(
        (line) => contentLinePropertyName(line.value) === 'uid',
      );
      body.splice(uidIndex < 0 ? 0 : uidIndex + 1, 0, ...sourceProperties);
    }
    lines.splice(range.start + 1, range.end - range.start - 1, ...body);
  }
  const physicalLines = lines.flatMap((line) => line.physicalLines);
  const hasFinalLineEnding = /(?:\r\n|\n|\r)$/.test(serialized);
  return `${physicalLines.join('\r\n')}${hasFinalLineEnding ? '\r\n' : ''}`;
}

export function restoreUntouchedVeventBlocks(
  serialized: string,
  sourceBlocksByEvent: ICalendarContentLine[][],
  targetEventIndex: number | undefined,
): string {
  const lines = readContentLines(serialized);
  const ranges = findVeventRanges(lines);
  if (!ranges) {
    return serialized;
  }
  for (let eventIndex = ranges.length - 1; eventIndex >= 0; eventIndex -= 1) {
    if (eventIndex === targetEventIndex) {
      continue;
    }
    const sourceBlock = sourceBlocksByEvent[eventIndex];
    const range = ranges[eventIndex];
    if (!sourceBlock || !range) {
      continue;
    }
    lines.splice(
      range.start,
      range.end - range.start + 1,
      ...sourceBlock.map((line) => ({
        value: line.value,
        physicalLines: [...line.physicalLines],
      })),
    );
  }
  const physicalLines = lines.flatMap((line) => line.physicalLines);
  const hasFinalLineEnding = /(?:\r\n|\n|\r)$/.test(serialized);
  return `${physicalLines.join('\r\n')}${hasFinalLineEnding ? '\r\n' : ''}`;
}

export function restoreOccurrenceUntouchedProperties(
  serialized: string,
  sourcePropertiesByEvent: RawVeventProperty[][],
  targetEventIndex: number | undefined,
  operation: CalendarEventOccurrenceWrite,
  created: boolean,
): string {
  const lines = readContentLines(serialized);
  const ranges = findVeventRanges(lines);
  if (!ranges) {
    return serialized;
  }
  const revisionNames = new Set([
    'dtstamp',
    'created',
    'last-modified',
    'sequence',
  ]);
  const separatelyRestoredNames = new Set([
    ...revisionNames,
    'conference',
    'summary',
    'description',
    'location',
  ]);
  for (let eventIndex = ranges.length - 1; eventIndex >= 0; eventIndex -= 1) {
    const range = ranges[eventIndex];
    const sourceProperties = sourcePropertiesByEvent[eventIndex] ?? [];
    const skipNames = new Set(separatelyRestoredNames);
    if (eventIndex === targetEventIndex) {
      if (created) {
        for (const name of [
          'rrule',
          'rdate',
          'exdate',
          'exrule',
          'recurrence-id',
          'dtstart',
          'dtend',
          'duration',
        ]) {
          skipNames.add(name);
        }
      } else {
        if (operation.timing) {
          for (const name of ['dtstart', 'dtend', 'duration']) {
            skipNames.add(name);
          }
        }
      }
    }
    const sourceByName = new Map<string, RawVeventProperty[]>();
    for (const property of sourceProperties) {
      if (skipNames.has(property.name)) {
        continue;
      }
      const matching = sourceByName.get(property.name) ?? [];
      matching.push(property);
      sourceByName.set(property.name, matching);
    }
    const outputCounts = new Map<string, number>();
    const matchedSource = new Set<RawVeventProperty>();
    const body: ICalendarContentLine[] = [];
    let nestedComponents = 0;
    for (
      let lineIndex = range.start + 1;
      lineIndex < range.end;
      lineIndex += 1
    ) {
      const line = lines[lineIndex];
      const marker = line.value.toUpperCase();
      if (marker.startsWith('BEGIN:')) {
        nestedComponents += 1;
        body.push(line);
        continue;
      }
      if (marker.startsWith('END:')) {
        nestedComponents = Math.max(0, nestedComponents - 1);
        body.push(line);
        continue;
      }
      const propertyName =
        nestedComponents === 0
          ? contentLinePropertyName(line.value)
          : undefined;
      if (!propertyName || skipNames.has(propertyName)) {
        body.push(line);
        continue;
      }
      const occurrence = outputCounts.get(propertyName) ?? 0;
      outputCounts.set(propertyName, occurrence + 1);
      const replacement = sourceByName.get(propertyName)?.[occurrence];
      if (replacement) {
        body.push({
          value: `${replacement.header}:${replacement.value}`,
          physicalLines: [...replacement.physicalLines],
        });
        matchedSource.add(replacement);
      }
    }
    const unmatchedSource = sourceProperties.filter(
      (property) =>
        !skipNames.has(property.name) && !matchedSource.has(property),
    );
    if (unmatchedSource.length > 0) {
      const uidIndex = body.findIndex(
        (line) => contentLinePropertyName(line.value) === 'uid',
      );
      body.splice(
        uidIndex < 0 ? 0 : uidIndex + 1,
        0,
        ...unmatchedSource.map((property) => ({
          value: `${property.header}:${property.value}`,
          physicalLines: [...property.physicalLines],
        })),
      );
    }
    lines.splice(range.start + 1, range.end - range.start - 1, ...body);
  }
  const physicalLines = lines.flatMap((line) => line.physicalLines);
  const hasFinalLineEnding = /(?:\r\n|\n|\r)$/.test(serialized);
  return `${physicalLines.join('\r\n')}${hasFinalLineEnding ? '\r\n' : ''}`;
}

export function restoreOccurrenceTextProperties(
  serialized: string,
  sourcePropertiesByEvent: RawVeventProperty[][],
  targetEventIndex: number | undefined,
  operation: CalendarEventOccurrenceWrite,
  created: boolean,
): string {
  const lines = readContentLines(serialized);
  const ranges = findVeventRanges(lines);
  if (!ranges) {
    return serialized;
  }
  const nameByField: Record<CalendarEventOccurrenceTextField, string> = {
    title: 'summary',
    description: 'description',
    location: 'location',
  };
  for (let eventIndex = ranges.length - 1; eventIndex >= 0; eventIndex -= 1) {
    const range = ranges[eventIndex];
    const sourceProperties = sourcePropertiesByEvent[eventIndex] ?? [];
    const operations = occurrenceTextOperationMap(operation);
    const fieldForName = new Map(
      Object.entries(nameByField).map(
        ([field, name]) =>
          [name, field as CalendarEventOccurrenceTextField] as const,
      ),
    );
    const controlledNames = new Set(Object.values(nameByField));
    const touchedNames = new Set<string>();
    if (eventIndex === targetEventIndex) {
      if (created && operation.action === 'set-fields') {
        // Metadata writes start from the series but omitted fields must inherit
        // it. Legacy timing-only writes keep the original clone behavior.
        for (const name of controlledNames) touchedNames.add(name);
      } else {
        for (const field of Object.keys(
          operations,
        ) as CalendarEventOccurrenceTextField[]) {
          touchedNames.add(nameByField[field]);
        }
      }
    }
    const sourceByName = new Map<string, RawVeventProperty[]>();
    for (const property of sourceProperties) {
      const values = sourceByName.get(property.name) ?? [];
      values.push(property);
      sourceByName.set(property.name, values);
    }
    const outputCounts = new Map<string, number>();
    const matchedSource = new Set<RawVeventProperty>();
    const body: ICalendarContentLine[] = [];
    let nestedComponents = 0;
    for (
      let lineIndex = range.start + 1;
      lineIndex < range.end;
      lineIndex += 1
    ) {
      const line = lines[lineIndex];
      const marker = line.value.toUpperCase();
      if (marker.startsWith('BEGIN:')) {
        nestedComponents += 1;
        body.push(line);
        continue;
      }
      if (marker.startsWith('END:')) {
        nestedComponents = Math.max(0, nestedComponents - 1);
        body.push(line);
        continue;
      }
      const propertyName =
        nestedComponents === 0
          ? contentLinePropertyName(line.value)
          : undefined;
      if (!propertyName || !controlledNames.has(propertyName)) {
        body.push(line);
        continue;
      }
      if (touchedNames.has(propertyName)) {
        const field = fieldForName.get(propertyName)!;
        const textOperation = operations[field];
        const shouldKeep = textOperation?.action === 'set';
        if (shouldKeep) {
          body.push(line);
        }
        continue;
      }
      const occurrence = outputCounts.get(propertyName) ?? 0;
      outputCounts.set(propertyName, occurrence + 1);
      const replacement = sourceByName.get(propertyName)?.[occurrence];
      if (replacement) {
        body.push({
          value: `${replacement.header}:${replacement.value}`,
          physicalLines: [...replacement.physicalLines],
        });
        matchedSource.add(replacement);
      }
    }
    const unmatchedSource = sourceProperties.filter(
      (property) =>
        controlledNames.has(property.name) &&
        !touchedNames.has(property.name) &&
        !matchedSource.has(property),
    );
    if (unmatchedSource.length > 0) {
      const uidIndex = body.findIndex(
        (line) => contentLinePropertyName(line.value) === 'uid',
      );
      body.splice(
        uidIndex < 0 ? 0 : uidIndex + 1,
        0,
        ...unmatchedSource.map((property) => ({
          value: `${property.header}:${property.value}`,
          physicalLines: [...property.physicalLines],
        })),
      );
    }
    lines.splice(range.start + 1, range.end - range.start - 1, ...body);
  }
  const physicalLines = lines.flatMap((line) => line.physicalLines);
  const hasFinalLineEnding = /(?:\r\n|\n|\r)$/.test(serialized);
  return `${physicalLines.join('\r\n')}${hasFinalLineEnding ? '\r\n' : ''}`;
}

export function restoreVeventAlarmComponents(
  serialized: string,
  source: string,
): string {
  const sourceComponentsByEvent = rawVeventAlarmComponents(source);
  const lines = readContentLines(serialized);
  const ranges = findVeventRanges(lines);
  if (!ranges) {
    return serialized;
  }

  for (let eventIndex = ranges.length - 1; eventIndex >= 0; eventIndex -= 1) {
    const range = ranges[eventIndex];
    const sourceComponents = sourceComponentsByEvent[eventIndex] ?? [];
    if (sourceComponents.length === 0) {
      continue;
    }

    const body: ICalendarContentLine[] = [];
    let nestedComponents = 0;
    let skippedAlarmDepth = 0;
    for (let index = range.start + 1; index < range.end; index += 1) {
      const line = lines[index];
      const marker = line.value.toUpperCase();
      if (skippedAlarmDepth > 0) {
        if (marker.startsWith('BEGIN:')) {
          skippedAlarmDepth += 1;
        } else if (marker.startsWith('END:')) {
          skippedAlarmDepth -= 1;
        }
        continue;
      }
      if (nestedComponents === 0 && marker === 'BEGIN:VALARM') {
        skippedAlarmDepth = 1;
        continue;
      }
      if (marker.startsWith('BEGIN:')) {
        nestedComponents += 1;
      } else if (marker.startsWith('END:')) {
        nestedComponents = Math.max(0, nestedComponents - 1);
      }
      body.push(line);
    }

    let uidIndex = -1;
    nestedComponents = 0;
    for (let index = 0; index < body.length; index += 1) {
      const marker = body[index].value.toUpperCase();
      if (nestedComponents === 0 && contentLinePropertyName(marker) === 'uid') {
        uidIndex = index;
        break;
      }
      if (marker.startsWith('BEGIN:')) {
        nestedComponents += 1;
      } else if (marker.startsWith('END:')) {
        nestedComponents = Math.max(0, nestedComponents - 1);
      }
    }
    body.splice(uidIndex < 0 ? 0 : uidIndex + 1, 0, ...sourceComponents.flat());
    lines.splice(range.start + 1, range.end - range.start - 1, ...body);
  }

  const physicalLines = lines.flatMap((line) => line.physicalLines);
  const hasFinalLineEnding = /(?:\r\n|\n|\r)$/.test(serialized);
  return `${physicalLines.join('\r\n')}${hasFinalLineEnding ? '\r\n' : ''}`;
}
