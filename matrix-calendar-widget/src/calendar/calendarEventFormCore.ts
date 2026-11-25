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
  Calendar,
  CalendarEvent,
  CalendarEventDateTime,
  CalendarEventOccurrenceTextField,
  CalendarEventOccurrenceTextOperation,
  CalendarEventRecurrenceDate,
  CalendarEventTiming,
  CalendarEventWeekday,
  CalendarId,
  SupportedCalendarEventRecurrenceFrequency,
  calendarEventRecurrenceIdentity,
  isAllDayCalendarEvent,
  isTimedCalendarEvent,
} from '@matrix-calendar-widget/calendar';
import { DateTime } from 'luxon';
import { calendarEventEditableFieldsFromForm } from './calendarEventFormPatch';
import {
  recurrenceExdateFormValues,
  recurrenceFormValues,
  recurrenceRdateFormValues,
  startWeekdayForTiming,
} from './calendarEventFormRecurrence';
import {
  defaultEventTimedRange,
  timedKindForTiming,
} from './calendarEventFormTiming';
export {
  calendarEventInputFromForm,
  calendarEventPatchFromForm,
} from './calendarEventFormPatch';
export {
  calendarEventRdatePeriodDurationFromForm,
  calendarEventRdatePeriodIsEditable,
  calendarEventRdatePeriodValueFromForm,
  calendarEventRdateValueFromForm,
} from './calendarEventFormRecurrence';
export { validateCalendarEventForm } from './calendarEventFormValidation';

import {
  alarmFormValues,
  emptyAlarmFormValues,
} from './calendarEventFormAlarms';

export type CalendarEventFormValues = {
  calendarId: CalendarId;
  title: string;
  description: string;
  location: string;
  conferenceUrl?: string;
  conferenceLabel?: string;
  conferenceEditable?: boolean;
  conferenceChanged?: boolean;
  attachmentUrls?: readonly string[];
  attachmentEditable?: boolean;
  attachmentOperation?: 'none' | 'add' | 'set' | 'remove';
  attachmentSourceUrl?: string;
  attachmentUrl?: string;
  attachmentChanged?: boolean;
  timingType: 'timed' | 'all-day';
  timedKind?: 'floating' | 'zoned' | 'mixed';
  start: string;
  end: string;
  timezone: string;
  timingChanged?: boolean;
  timezoneChanged?: boolean;
  originalTiming?: CalendarEventTiming;
  repeats?: boolean;
  recurrenceFrequency?: SupportedCalendarEventRecurrenceFrequency;
  recurrenceInterval?: string;
  recurrenceEnd?: 'never' | 'count' | 'until';
  recurrenceCount?: string;
  recurrenceUntil?: string;
  recurrenceWeekdays?: CalendarEventWeekday[];
  recurrenceMonthlyByDay?: boolean;
  recurrenceMonthlyOrdinal?: string;
  recurrenceMonthlyWeekday?: string;
  recurrenceEditable?: boolean;
  recurrenceDisabledReason?: 'complex' | 'unsupported';
  recurrenceChanged?: boolean;
  rdateEditable?: boolean;
  rdateDraft?: string;
  rdatePeriodWeeks?: string;
  rdatePeriodDays?: string;
  rdatePeriodHours?: string;
  rdatePeriodMinutes?: string;
  rdatePeriodSeconds?: string;
  rdateEndDraft?: string;
  rdateEditSource?: Extract<CalendarEventRecurrenceDate, { type: 'period' }>;
  rdateValues?: CalendarEventRecurrenceDate[];
  rdateChanged?: boolean;
  rdateOperation?:
    | { action: 'add' | 'remove'; value: CalendarEventDateTime }
    | {
        action: 'remove-period';
        value: Extract<CalendarEventRecurrenceDate, { type: 'period' }>;
      }
    | {
        action: 'add-period';
        value: Extract<CalendarEventRecurrenceDate, { type: 'period' }>;
      }
    | {
        action: 'replace-period';
        value: Extract<CalendarEventRecurrenceDate, { type: 'period' }>;
        replacement: Extract<CalendarEventRecurrenceDate, { type: 'period' }>;
      };
  exdateEditable?: boolean;
  exdateValues?: CalendarEventDateTime[];
  exdateChanged?: boolean;
  exdateOperation?: { action: 'remove'; recurrenceId: CalendarEventDateTime };
  alarmEnabled?: boolean;
  alarmMode?: 'relative' | 'absolute';
  alarmUtcDateTime?: string;
  alarmWeeks?: string;
  alarmDays?: string;
  alarmHours?: string;
  alarmMinutes?: string;
  alarmSeconds?: string;
  alarmEditable?: boolean;
  alarmDisabledReason?: 'unsupported';
  alarmChanged?: boolean;
  occurrenceTextModes?: Record<
    CalendarEventOccurrenceTextField,
    'series' | 'custom'
  >;
  occurrenceTextOriginalModes?: Record<
    CalendarEventOccurrenceTextField,
    'series' | 'custom'
  >;
  occurrenceTextOriginalValues?: Record<
    CalendarEventOccurrenceTextField,
    string
  >;
  occurrenceTextSeriesValues?: Record<CalendarEventOccurrenceTextField, string>;
  occurrenceTextUnsupported?: Partial<
    Record<CalendarEventOccurrenceTextField, true>
  >;
};

export type CalendarEventValidationError =
  | 'title-required'
  | 'invalid-range'
  | 'invalid-timezone'
  | 'invalid-recurrence'
  | 'invalid-rdate'
  | 'invalid-alarm'
  | 'invalid-alarm-utc'
  | 'invalid-conference'
  | 'invalid-attachment';

export function createCalendarEventFormValues(
  calendar: Calendar,
  now: DateTime = DateTime.local(),
): CalendarEventFormValues {
  const timezone = calendar.timezone ?? now.zoneName;
  const { start, end } = defaultEventTimedRange(now, timezone);

  return {
    calendarId: calendar.id,
    title: '',
    description: '',
    location: '',
    conferenceUrl: '',
    conferenceLabel: '',
    conferenceEditable: true,
    conferenceChanged: false,
    attachmentUrls: [],
    attachmentEditable: true,
    attachmentOperation: 'none',
    attachmentSourceUrl: '',
    attachmentUrl: '',
    attachmentChanged: false,
    timingType: 'timed',
    timedKind: 'zoned',
    start,
    end,
    timezone,
    timingChanged: false,
    timezoneChanged: false,
    repeats: false,
    recurrenceFrequency: 'DAILY',
    recurrenceInterval: '1',
    recurrenceEnd: 'never',
    recurrenceCount: '2',
    recurrenceUntil: start === 'Invalid DateTime' ? '' : start.slice(0, 10),
    recurrenceEditable: true,
    recurrenceChanged: false,
    ...emptyAlarmFormValues(),
  };
}

export function calendarEventToFormValues(
  event: CalendarEvent,
  calendar: Calendar,
): CalendarEventFormValues {
  if (isAllDayCalendarEvent(event)) {
    return {
      calendarId: event.calendarId,
      title: event.title,
      description: event.description ?? '',
      location: event.location ?? '',
      ...conferenceFormValues(event),
      ...attachmentFormValues(event),
      timingType: 'all-day',
      timedKind: 'zoned',
      start: event.timing.startDate,
      end:
        DateTime.fromISO(event.timing.endDate).minus({ days: 1 }).toISODate() ??
        event.timing.startDate,
      timezone: calendar.timezone ?? DateTime.local().zoneName ?? 'UTC',
      timingChanged: false,
      timezoneChanged: false,
      originalTiming: event.timing,
      ...recurrenceFormValues(event),
      ...recurrenceRdateFormValues(event),
      ...recurrenceExdateFormValues(event),
      ...alarmFormValues(event),
    };
  }

  if (!isTimedCalendarEvent(event)) {
    throw new Error('Unsupported calendar event timing');
  }

  return {
    calendarId: event.calendarId,
    title: event.title,
    description: event.description ?? '',
    location: event.location ?? '',
    ...conferenceFormValues(event),
    ...attachmentFormValues(event),
    timingType: 'timed',
    timedKind: timedKindForTiming(event.timing),
    start: event.timing.start.local.slice(0, 16),
    end: event.timing.end.local.slice(0, 16),
    timezone:
      event.timing.start.type === 'zoned'
        ? event.timing.start.timezone
        : (calendar.timezone ?? DateTime.local().zoneName ?? 'UTC'),
    timingChanged: false,
    timezoneChanged: false,
    originalTiming: event.timing,
    ...recurrenceFormValues(event),
    ...recurrenceRdateFormValues(event),
    ...recurrenceExdateFormValues(event),
    ...alarmFormValues(event),
  };
}

function attachmentFormValues(
  event: CalendarEvent,
): Pick<
  CalendarEventFormValues,
  | 'attachmentUrls'
  | 'attachmentEditable'
  | 'attachmentOperation'
  | 'attachmentSourceUrl'
  | 'attachmentUrl'
  | 'attachmentChanged'
> {
  return {
    attachmentUrls: (event.attachments ?? []).map(({ url }) => url),
    attachmentEditable: !event.unsupportedAttachment,
    attachmentOperation: 'none',
    attachmentSourceUrl: '',
    attachmentUrl: '',
    attachmentChanged: false,
  };
}

export function calendarEventOccurrenceToFormValues(
  sourceEvent: CalendarEvent,
  occurrenceEvent: CalendarEvent,
  recurrenceId: CalendarEventDateTime,
  calendar: Calendar,
): CalendarEventFormValues {
  const values = calendarEventToFormValues(occurrenceEvent, calendar);
  const identity = calendarEventRecurrenceIdentity(recurrenceId);
  const override = sourceEvent.recurrence?.overrides?.find(
    (candidate) =>
      calendarEventRecurrenceIdentity(candidate.recurrenceId) === identity,
  );
  const fields: CalendarEventOccurrenceTextField[] = [
    'title',
    'description',
    'location',
  ];
  const modes = Object.fromEntries(
    fields.map((field) => [
      field,
      override &&
      (Object.prototype.hasOwnProperty.call(override, field) ||
        override.unsupportedText?.[field])
        ? 'custom'
        : 'series',
    ]),
  ) as Record<CalendarEventOccurrenceTextField, 'series' | 'custom'>;
  const currentValues = {
    title: values.title,
    description: values.description,
    location: values.location,
  };
  return {
    ...values,
    occurrenceTextModes: modes,
    occurrenceTextOriginalModes: { ...modes },
    occurrenceTextOriginalValues: { ...currentValues },
    occurrenceTextSeriesValues: {
      title: sourceEvent.title,
      description: sourceEvent.description ?? '',
      location: sourceEvent.location ?? '',
    },
    ...(override?.unsupportedText
      ? { occurrenceTextUnsupported: { ...override.unsupportedText } }
      : {}),
  };
}

export function calendarEventOccurrenceTextOperationsFromForm(
  values: CalendarEventFormValues,
): Partial<
  Record<CalendarEventOccurrenceTextField, CalendarEventOccurrenceTextOperation>
> {
  const modes = values.occurrenceTextModes;
  const originalModes = values.occurrenceTextOriginalModes;
  const originalValues = values.occurrenceTextOriginalValues;
  if (!modes || !originalModes || !originalValues) {
    return {};
  }

  const operations: Partial<
    Record<
      CalendarEventOccurrenceTextField,
      CalendarEventOccurrenceTextOperation
    >
  > = {};
  const fields: CalendarEventOccurrenceTextField[] = [
    'title',
    'description',
    'location',
  ];
  for (const field of fields) {
    if (values.occurrenceTextUnsupported?.[field]) {
      continue;
    }
    if (modes[field] === 'series') {
      if (originalModes[field] !== 'series') {
        operations[field] = { action: 'inherit' };
      }
      continue;
    }
    if (
      originalModes[field] !== 'custom' ||
      values[field] !== originalValues[field]
    ) {
      operations[field] = { action: 'set', value: values[field].trim() };
    }
  }
  return operations;
}

function conferenceFormValues(
  event: CalendarEvent,
): Pick<
  CalendarEventFormValues,
  | 'conferenceUrl'
  | 'conferenceLabel'
  | 'conferenceEditable'
  | 'conferenceChanged'
> {
  const links =
    event.externalLinks?.filter((link) => link.kind === 'conference') ?? [];
  const link = links.length === 1 ? links[0] : undefined;
  return {
    conferenceUrl: link?.href ?? '',
    conferenceLabel: link?.label ?? '',
    conferenceEditable: !event.unsupportedConference && links.length <= 1,
    conferenceChanged: false,
  };
}

export function calendarEventFormStartWeekday(
  values: CalendarEventFormValues,
): CalendarEventWeekday {
  return startWeekdayForTiming(
    calendarEventEditableFieldsFromForm(values).timing,
  );
}
