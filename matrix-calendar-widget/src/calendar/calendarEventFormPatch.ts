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
  normalizeCalendarEventConferenceInput,
  type CalendarEventConferenceInput,
  type CalendarEventInput,
  type CalendarEventPatch,
} from '@matrix-calendar-widget/calendar';
import { DateTime } from 'luxon';
import type { CalendarEventFormValues } from './calendarEventForm';
import { alarmFromForm } from './calendarEventFormAlarms';
import {
  attachmentInputFromForm,
  attachmentPatchFromForm,
} from './calendarEventFormAttachments';
import {
  recurrenceRuleFromForm,
  recurrenceUntilNeedsAnchorUpdate,
  recurrenceWeekdayNeedsAnchorUpdate,
} from './calendarEventFormRecurrence';
import { editableTimedEndpoint } from './calendarEventFormTiming';

export function conferenceFromForm(
  values: CalendarEventFormValues,
): CalendarEventConferenceInput {
  return normalizeCalendarEventConferenceInput({
    url: (values.conferenceUrl ?? '').trim(),
    label: values.conferenceLabel ?? '',
  });
}

export function calendarEventInputFromForm(
  values: CalendarEventFormValues,
  uid: string,
): CalendarEventInput {
  const editableFields = calendarEventEditableFieldsFromForm(values);
  return {
    uid,
    ...editableFields,
    ...(values.alarmEnabled ? { alarm: alarmFromForm(values) } : {}),
    ...((values.conferenceUrl ?? '').trim()
      ? { conference: conferenceFromForm(values) }
      : {}),
    ...(values.attachmentChanged && values.attachmentOperation === 'add'
      ? { attachment: attachmentInputFromForm(values) }
      : {}),
    ...(values.repeats
      ? {
          recurrence: {
            rrule: recurrenceRuleFromForm(values, editableFields.timing),
          },
        }
      : {}),
  };
}

export function calendarEventPatchFromForm(
  values: CalendarEventFormValues,
): CalendarEventPatch {
  const editableFields = calendarEventEditableFieldsFromForm(values);
  const { timing, ...fields } = editableFields;
  const recurrenceNeedsAnchorUpdate =
    recurrenceUntilNeedsAnchorUpdate(values, timing) ||
    recurrenceWeekdayNeedsAnchorUpdate(values, timing);

  return {
    ...fields,
    ...(values.timingChanged === false ? {} : { timing }),
    ...(values.alarmChanged
      ? {
          alarm: values.alarmEnabled
            ? alarmFromForm(values)
            : { operation: 'remove' },
        }
      : {}),
    ...(values.conferenceChanged && values.conferenceEditable !== false
      ? {
          conference: (values.conferenceUrl ?? '').trim()
            ? { action: 'set' as const, ...conferenceFromForm(values) }
            : { action: 'remove' as const },
        }
      : {}),
    ...(values.attachmentChanged && values.attachmentEditable !== false
      ? { attachment: attachmentPatchFromForm(values) }
      : {}),
    description: normalizeOptional(values.description),
    location: normalizeOptional(values.location),
    ...(values.exdateChanged && values.exdateOperation
      ? { recurrence: { exdate: values.exdateOperation } }
      : values.rdateChanged && values.rdateOperation
        ? { recurrence: { rdate: values.rdateOperation } }
        : values.recurrenceChanged || recurrenceNeedsAnchorUpdate
          ? {
              recurrence: values.repeats
                ? { rrule: recurrenceRuleFromForm(values, timing) }
                : {},
            }
          : {}),
  };
}

export function calendarEventEditableFieldsFromForm(
  values: CalendarEventFormValues,
): Omit<CalendarEventInput, 'uid' | 'conference' | 'attachment'> {
  const description = normalizeOptional(values.description);
  const location = normalizeOptional(values.location);

  return {
    title: values.title.trim(),
    ...(description ? { description } : {}),
    ...(location ? { location } : {}),
    timing:
      values.timingType === 'all-day'
        ? {
            type: 'all-day',
            startDate: values.start,
            endDate:
              DateTime.fromISO(values.end).plus({ days: 1 }).toISODate() ??
              values.end,
          }
        : {
            type: 'timed',
            start: editableTimedEndpoint(values, 'start'),
            end: editableTimedEndpoint(values, 'end'),
          },
  };
}

function normalizeOptional(value: string): string | undefined {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}
