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

import type { CalendarEventPatch } from '@matrix-calendar-widget/calendar';
import type { CalDavEventClient, CalDavEventResource } from '../caldav';
import {
  DEFAULT_CALDAV_EVENT_RESPONSE_MAX_BYTES,
  ICalendarEventCodec,
  ICalendarEventCodecError,
  MAX_FOLLOWING_RESOURCE_BYTES,
} from '../caldav';

export interface CalendarEventUpdateOperationInput {
  /** Client constructed for a caller that has already passed authorization. */
  readonly client: Pick<CalDavEventClient, 'getEvent' | 'updateEvent'>;
  /** Canonical calendar identity used by the iCalendar codec. */
  readonly calendarId: string;
  /** Canonical resource URL, already normalized and scoped by the caller. */
  readonly resourceUrl: string;
  /** One concrete strong ETag, validated by the caller before CalDAV I/O. */
  readonly expectedEtag: string;
  readonly patch: CalendarEventPatch;
  readonly maxResponseBytes?: number;
}

export interface CalendarEventUpdateOperationResult {
  readonly resource: CalDavEventResource;
  /** True only when a supported advanced-field patch is an exact current no-op. */
  readonly noOp: boolean;
}

/**
 * Apply an event patch using the caller's already-authorized CalDAV client.
 * Authorization, target normalization, strong-ETag validation, error mapping,
 * DTO conversion, and auditing remain owned by the calling facade.
 */
export async function updateCalendarEventConditionally({
  client,
  calendarId,
  resourceUrl,
  expectedEtag,
  patch,
  maxResponseBytes,
}: CalendarEventUpdateOperationInput): Promise<CalendarEventUpdateOperationResult> {
  const codec = new ICalendarEventCodec();
  const current = await client.getEvent(resourceUrl);
  const encoded = codec
    .parse(calendarId, resourceUrl, current.icalendar)
    .applyPatch(patch);

  if (
    patch.recurrence &&
    'following' in patch.recurrence &&
    Buffer.byteLength(encoded.icalendar, 'utf8') >
      Math.min(
        MAX_FOLLOWING_RESOURCE_BYTES,
        maxResponseBytes ?? DEFAULT_CALDAV_EVENT_RESPONSE_MAX_BYTES,
      )
  ) {
    throw new ICalendarEventCodecError(
      'event-too-large',
      'This and following edit would exceed the supported calendar resource size.',
    );
  }

  if (
    encoded.icalendar === current.icalendar &&
    expectedEtag === current.etag &&
    (Object.prototype.hasOwnProperty.call(patch, 'conference') ||
      Object.prototype.hasOwnProperty.call(patch, 'alarm') ||
      Object.prototype.hasOwnProperty.call(patch, 'attachment') ||
      (patch.recurrence &&
        ('occurrence' in patch.recurrence || 'following' in patch.recurrence)))
  ) {
    return { resource: current, noOp: true };
  }

  // Preserve the caller's validator so stale edits fail with 412 instead of
  // silently applying the patch to the newer resource read above.
  await client.updateEvent(resourceUrl, expectedEtag, encoded.icalendar);
  return {
    resource: await client.getEvent(resourceUrl),
    noOp: false,
  };
}
