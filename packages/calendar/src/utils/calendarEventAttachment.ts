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
  CalendarEventAttachmentInput,
  CalendarEventAttachmentPatch,
} from '../model/calendar';
import { canonicalizeCalendarExternalUrl } from './calendarEventExternalLinks';

/** Maximum supported URI attachments projected for master-event authoring. */
export const MAX_CALENDAR_EVENT_AUTHORABLE_ATTACHMENTS = 16;

/** Runtime payload validation shared by repositories, widgets, and gateway. */
export class CalendarEventAttachmentValidationError extends Error {
  constructor() {
    super('Invalid attachment link operation');
    this.name = 'CalendarEventAttachmentValidationError';
  }
}

const READ_ONLY_EVENT_FIELDS = [
  'externalLinks',
  'attachments',
  'unsupportedAttachment',
  'unsupportedConference',
  'unsupportedAlarm',
  'unsupportedRecurrence',
  'unsupportedTimezone',
  'revision',
] as const;

export function validateCalendarEventInputAttachment(value: unknown): void {
  const object = requireRecord(value);
  rejectReadOnlyFields(object);
  if (hasOwn(object, 'attachment')) {
    normalizeCalendarEventAttachmentInput(object.attachment);
  }
}

export function validateCalendarEventPatchAttachment(value: unknown): void {
  const object = requireRecord(value);
  rejectReadOnlyFields(object);
  if (hasOwn(object, 'attachment')) {
    normalizeCalendarEventAttachmentPatch(object.attachment);
  }
}

export function normalizeCalendarEventAttachmentInput(
  value: unknown,
): CalendarEventAttachmentInput {
  const object = requireRecord(value);
  if (Object.keys(object).length !== 1 || !hasOwn(object, 'url')) {
    throw new CalendarEventAttachmentValidationError();
  }
  return { url: requireSafeUrl(object.url) };
}

export function normalizeCalendarEventAttachmentPatch(
  value: unknown,
): CalendarEventAttachmentPatch {
  const object = requireRecord(value);
  if (object.action === 'add') {
    if (Object.keys(object).length !== 2 || !hasOwn(object, 'url')) {
      throw new CalendarEventAttachmentValidationError();
    }
    return { action: 'add', url: requireSafeUrl(object.url) };
  }
  if (object.action === 'set') {
    if (
      Object.keys(object).length !== 3 ||
      !hasOwn(object, 'sourceUrl') ||
      !hasOwn(object, 'url')
    ) {
      throw new CalendarEventAttachmentValidationError();
    }
    return {
      action: 'set',
      sourceUrl: requireSafeUrl(object.sourceUrl),
      url: requireSafeUrl(object.url),
    };
  }
  if (object.action === 'remove') {
    if (Object.keys(object).length !== 2 || !hasOwn(object, 'sourceUrl')) {
      throw new CalendarEventAttachmentValidationError();
    }
    return {
      action: 'remove',
      sourceUrl: requireSafeUrl(object.sourceUrl),
    };
  }
  throw new CalendarEventAttachmentValidationError();
}

function requireSafeUrl(value: unknown): string {
  const url = canonicalizeCalendarExternalUrl(value);
  if (!url) {
    throw new CalendarEventAttachmentValidationError();
  }
  return url;
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new CalendarEventAttachmentValidationError();
  }
  return value as Record<string, unknown>;
}

function rejectReadOnlyFields(value: Record<string, unknown>): void {
  if (READ_ONLY_EVENT_FIELDS.some((key) => hasOwn(value, key))) {
    throw new CalendarEventAttachmentValidationError();
  }
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}
