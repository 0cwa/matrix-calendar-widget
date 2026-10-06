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

import type {
  CalendarEventConferenceInput,
  CalendarEventConferencePatch,
} from '../model/calendar';
import {
  boundCalendarEventExternalLinkLabel,
  canonicalizeCalendarExternalUrl,
  MAX_CALENDAR_EVENT_EXTERNAL_LINK_LABEL_LENGTH,
} from './calendarEventExternalLinks';

/** Runtime payload validation shared by the widget repositories and gateway. */
export class CalendarEventConferenceValidationError extends Error {
  constructor() {
    super('Invalid conference link operation');
    this.name = 'CalendarEventConferenceValidationError';
  }
}

const READ_ONLY_EVENT_FIELDS = [
  'externalLinks',
  'unsupportedConference',
  'unsupportedAlarm',
  'unsupportedRecurrence',
  'unsupportedTimezone',
  'revision',
] as const;

export function validateCalendarEventInputConference(value: unknown): void {
  const object = requireRecord(value);
  rejectReadOnlyFields(object);
  if (hasOwn(object, 'conference')) {
    normalizeCalendarEventConferenceInput(object.conference);
  }
}

export function validateCalendarEventPatchConference(value: unknown): void {
  const object = requireRecord(value);
  rejectReadOnlyFields(object);
  if (hasOwn(object, 'conference')) {
    normalizeCalendarEventConferencePatch(object.conference);
  }
}

export function normalizeCalendarEventConferenceInput(
  value: unknown,
): CalendarEventConferenceInput {
  const object = requireRecord(value);
  if (
    Object.keys(object).some((key) => !['url', 'label'].includes(key)) ||
    !hasOwn(object, 'url')
  ) {
    throw new CalendarEventConferenceValidationError();
  }

  return normalizeSetOperation(object);
}

export function normalizeCalendarEventConferencePatch(
  value: unknown,
): CalendarEventConferencePatch {
  const object = requireRecord(value);
  if (object.action === 'remove') {
    if (Object.keys(object).length !== 1) {
      throw new CalendarEventConferenceValidationError();
    }
    return { action: 'remove' };
  }
  if (object.action !== 'set') {
    throw new CalendarEventConferenceValidationError();
  }

  if (
    Object.keys(object).some(
      (key) => !['action', 'url', 'label'].includes(key),
    ) ||
    !hasOwn(object, 'url')
  ) {
    throw new CalendarEventConferenceValidationError();
  }

  return { action: 'set', ...normalizeSetOperation(object) };
}

function normalizeSetOperation(
  object: Record<string, unknown>,
): CalendarEventConferenceInput {
  const url = canonicalizeCalendarExternalUrl(object.url);
  if (!url) {
    throw new CalendarEventConferenceValidationError();
  }

  if (!hasOwn(object, 'label')) {
    return { url };
  }
  const rawLabel = object.label;
  if (typeof rawLabel !== 'string') {
    throw new CalendarEventConferenceValidationError();
  }
  const normalizedLabel = boundCalendarEventExternalLinkLabel(rawLabel);
  if (
    rawLabel.trim().length > 0 &&
    (!normalizedLabel ||
      Array.from(normalizedLabel).length >
        MAX_CALENDAR_EVENT_EXTERNAL_LINK_LABEL_LENGTH ||
      normalizedLabel !== rawLabel.trim())
  ) {
    throw new CalendarEventConferenceValidationError();
  }

  return normalizedLabel ? { url, label: normalizedLabel } : { url };
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new CalendarEventConferenceValidationError();
  }
  return value as Record<string, unknown>;
}

function rejectReadOnlyFields(value: Record<string, unknown>): void {
  if (READ_ONLY_EVENT_FIELDS.some((key) => hasOwn(value, key))) {
    throw new CalendarEventConferenceValidationError();
  }
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}
