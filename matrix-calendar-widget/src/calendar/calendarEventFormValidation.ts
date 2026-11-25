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

import { CalendarEventConferenceValidationError } from '@matrix-calendar-widget/calendar';
import { DateTime } from 'luxon';
import { validateAlarm } from './calendarEventFormAlarms';
import { validateAttachment } from './calendarEventFormAttachments';
import {
  calendarEventOccurrenceTextOperationsFromForm,
  type CalendarEventFormValues,
  type CalendarEventValidationError,
} from './calendarEventFormCore';
import {
  calendarEventEditableFieldsFromForm,
  conferenceFromForm,
} from './calendarEventFormPatch';
import {
  validateExdateOperation,
  validateRdateOperation,
  validateRecurrence,
} from './calendarEventFormRecurrence';
import { formEndpointTimezone } from './calendarEventFormTiming';

function validateConference(
  values: CalendarEventFormValues,
): CalendarEventValidationError | undefined {
  if (values.conferenceEditable === false) {
    return undefined;
  }
  if (!(values.conferenceUrl ?? '').trim()) {
    return (values.conferenceLabel ?? '').trim()
      ? 'invalid-conference'
      : undefined;
  }
  try {
    conferenceFromForm(values);
    return undefined;
  } catch (error) {
    if (error instanceof CalendarEventConferenceValidationError) {
      return 'invalid-conference';
    }
    throw error;
  }
}

export function validateCalendarEventForm(
  values: CalendarEventFormValues,
): CalendarEventValidationError | undefined {
  if (!values.title.trim()) {
    const titleOperation =
      calendarEventOccurrenceTextOperationsFromForm(values).title;
    if (!values.occurrenceTextModes || titleOperation?.action === 'set') {
      return 'title-required';
    }
  }

  const conferenceError = validateConference(values);
  if (conferenceError) {
    return conferenceError;
  }

  const attachmentError = validateAttachment(values);
  if (attachmentError) {
    return attachmentError;
  }

  const alarmError = validateAlarm(values);
  if (alarmError) {
    return alarmError;
  }

  if (values.timingType === 'all-day') {
    const start = DateTime.fromISO(values.start);
    const end = DateTime.fromISO(values.end);

    if (!start.isValid || !end.isValid || end < start) {
      return 'invalid-range';
    }

    return (
      validateRecurrence(
        values,
        calendarEventEditableFieldsFromForm(values).timing,
      ) ??
      validateRdateOperation(values) ??
      validateExdateOperation(values)
    );
  }

  const timedKind = values.timedKind ?? 'zoned';
  if (
    timedKind === 'zoned' &&
    (!values.timezone.trim() ||
      !DateTime.local().setZone(values.timezone).isValid)
  ) {
    return 'invalid-timezone';
  }

  const viewerTimezone = DateTime.local().zoneName ?? 'UTC';
  const start = DateTime.fromISO(values.start, {
    zone: formEndpointTimezone(values, 'start', viewerTimezone),
  });
  const end = DateTime.fromISO(values.end, {
    zone: formEndpointTimezone(values, 'end', viewerTimezone),
  });

  if (!start.isValid || !end.isValid || end <= start) {
    return 'invalid-range';
  }

  return (
    validateRecurrence(
      values,
      calendarEventEditableFieldsFromForm(values).timing,
    ) ??
    validateRdateOperation(values) ??
    validateExdateOperation(values)
  );
}
