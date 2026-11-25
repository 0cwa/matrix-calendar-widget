/* Modified for Matrix Calendar Widget fork, 2026. */
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

import { isRecord } from './elementAcceptanceShared';
import {
  PROJECTION_DIAGNOSTIC_REASONS,
  type CalDavProjectionObservation,
  type ProjectionDiagnosticCounts,
  type ProjectionDiagnosticReason,
  type ProjectionDiagnosticSummary,
  type TimezoneSafetyObservation,
} from './elementAcceptanceSupportTypes';

export function unavailableTimezoneAudit(): TimezoneSafetyObservation {
  return {
    completed: false,
    parsedEventUnsupportedTimezone: null,
    bundledZoneId: null,
    embeddedDefinitionCount: 0,
    canonicalEmbeddedDefinitionMatches: null,
    classification: 'inconclusive',
  };
}

export function emptyProjectionDiagnosticCounts(): ProjectionDiagnosticCounts {
  return Object.fromEntries(
    PROJECTION_DIAGNOSTIC_REASONS.map((reason) => [reason, 0]),
  ) as ProjectionDiagnosticCounts;
}

export function summarizeProjectionDiagnostics(
  value: unknown,
): ProjectionDiagnosticSummary {
  const counts = emptyProjectionDiagnosticCounts();
  if (!Array.isArray(value)) return { complete: false, counts };

  for (const diagnostic of value) {
    if (
      !isRecord(diagnostic) ||
      typeof diagnostic.reason !== 'string' ||
      !PROJECTION_DIAGNOSTIC_REASONS.includes(
        diagnostic.reason as ProjectionDiagnosticReason,
      ) ||
      !Number.isInteger(diagnostic.count) ||
      Number(diagnostic.count) < 0
    ) {
      return { complete: false, counts: emptyProjectionDiagnosticCounts() };
    }
    const reason = diagnostic.reason as ProjectionDiagnosticReason;
    counts[reason] = Math.min(counts[reason] + Number(diagnostic.count), 2);
  }

  return { complete: true, counts };
}

function isProjectionDiagnosticCounts(
  value: unknown,
): value is ProjectionDiagnosticCounts {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return (
    keys.length === PROJECTION_DIAGNOSTIC_REASONS.length &&
    PROJECTION_DIAGNOSTIC_REASONS.every(
      (reason) =>
        Object.hasOwn(value, reason) &&
        Number.isInteger(value[reason]) &&
        Number(value[reason]) >= 0 &&
        Number(value[reason]) <= 2,
    )
  );
}

export function isCalDavProjectionObservation(
  value: unknown,
): value is CalDavProjectionObservation {
  if (!isRecord(value)) return false;
  const expectedKeys = [
    'completed',
    'includesCreatedEvent',
    'diagnosticCode',
    'diagnosticCounts',
    'timezoneAudit',
  ];
  return (
    Object.keys(value).length === expectedKeys.length &&
    expectedKeys.every((key) => Object.hasOwn(value, key)) &&
    typeof value.completed === 'boolean' &&
    (value.includesCreatedEvent === null ||
      typeof value.includesCreatedEvent === 'boolean') &&
    (value.diagnosticCode === 'none' ||
      value.diagnosticCode === 'inconclusive' ||
      PROJECTION_DIAGNOSTIC_REASONS.includes(
        value.diagnosticCode as ProjectionDiagnosticReason,
      )) &&
    isProjectionDiagnosticCounts(value.diagnosticCounts) &&
    isTimezoneSafetyObservation(value.timezoneAudit) &&
    value.completed === (value.includesCreatedEvent !== null) &&
    (value.completed || value.diagnosticCode === 'inconclusive')
  );
}

function isTimezoneSafetyObservation(
  value: unknown,
): value is TimezoneSafetyObservation {
  if (!isRecord(value)) return false;
  const expectedKeys = [
    'completed',
    'parsedEventUnsupportedTimezone',
    'bundledZoneId',
    'embeddedDefinitionCount',
    'canonicalEmbeddedDefinitionMatches',
    'classification',
  ];
  return (
    Object.keys(value).length === expectedKeys.length &&
    expectedKeys.every((key) => Object.hasOwn(value, key)) &&
    typeof value.completed === 'boolean' &&
    (value.parsedEventUnsupportedTimezone === null ||
      typeof value.parsedEventUnsupportedTimezone === 'boolean') &&
    (value.bundledZoneId === null ||
      typeof value.bundledZoneId === 'boolean') &&
    typeof value.embeddedDefinitionCount === 'number' &&
    Number.isInteger(value.embeddedDefinitionCount) &&
    value.embeddedDefinitionCount >= 0 &&
    value.embeddedDefinitionCount <= 2 &&
    (value.canonicalEmbeddedDefinitionMatches === null ||
      typeof value.canonicalEmbeddedDefinitionMatches === 'boolean') &&
    (value.classification === 'unsupported-zone-id' ||
      value.classification === 'no-embedded-definition' ||
      value.classification === 'duplicate-definitions' ||
      value.classification === 'embedded-definition-mismatch' ||
      value.classification === 'embedded-definition-matches' ||
      value.classification === 'other-unsupported-timezone' ||
      value.classification === 'no-zoned-start' ||
      value.classification === 'inconclusive') &&
    (value.completed ||
      (value.parsedEventUnsupportedTimezone === null &&
        value.bundledZoneId === null &&
        value.embeddedDefinitionCount === 0 &&
        value.canonicalEmbeddedDefinitionMatches === null &&
        value.classification === 'inconclusive')) &&
    (value.canonicalEmbeddedDefinitionMatches === null ||
      (value.embeddedDefinitionCount === 1 && value.bundledZoneId === true)) &&
    (value.classification === 'inconclusive'
      ? !value.completed
      : value.completed) &&
    (value.classification !== 'unsupported-zone-id' ||
      (value.bundledZoneId === false &&
        value.parsedEventUnsupportedTimezone === true)) &&
    (value.classification !== 'no-embedded-definition' ||
      (value.bundledZoneId === true &&
        value.embeddedDefinitionCount === 0 &&
        value.parsedEventUnsupportedTimezone === false)) &&
    (value.classification !== 'duplicate-definitions' ||
      (value.bundledZoneId === true &&
        value.embeddedDefinitionCount === 2 &&
        value.parsedEventUnsupportedTimezone === true)) &&
    (value.classification !== 'embedded-definition-mismatch' ||
      (value.bundledZoneId === true &&
        value.embeddedDefinitionCount === 1 &&
        value.parsedEventUnsupportedTimezone === true &&
        value.canonicalEmbeddedDefinitionMatches === false)) &&
    (value.classification !== 'embedded-definition-matches' ||
      (value.bundledZoneId === true &&
        value.embeddedDefinitionCount === 1 &&
        value.parsedEventUnsupportedTimezone === false &&
        value.canonicalEmbeddedDefinitionMatches === true)) &&
    (value.classification !== 'other-unsupported-timezone' ||
      value.parsedEventUnsupportedTimezone === true) &&
    (value.classification !== 'no-zoned-start' ||
      (value.parsedEventUnsupportedTimezone === false &&
        value.bundledZoneId === null &&
        value.embeddedDefinitionCount === 0 &&
        value.canonicalEmbeddedDefinitionMatches === null))
  );
}

export function isOptionalHttpStatus(value: unknown): value is number | null {
  return (
    value === null ||
    (Number.isInteger(value) && Number(value) >= 100 && Number(value) <= 599)
  );
}
