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
  CalendarEventAttachmentInput,
  CalendarEventAttachmentValidationError,
  CalendarEventConferenceInput,
  CalendarEventConferenceValidationError,
  CalendarEventId,
  CalendarEventInput,
  CalendarId,
  normalizeCalendarEventAttachmentInput,
  normalizeCalendarEventConferenceInput,
  validateCalendarEventInputAttachment,
  validateCalendarEventInputConference,
} from '@matrix-calendar-widget/calendar';
import ICAL from 'ical.js';
import { setDisplayAlarm, validateDisplayAlarm } from './ICalendarAlarm';
import { setAttachmentProperty } from './ICalendarAttachments';
import {
  unsupportedAttachmentPatch,
  unsupportedConferencePatch,
  unsupportedRecurrencePatch,
} from './ICalendarCodecError';
import { setConferenceProperty } from './ICalendarConference';
import type { EncodedICalendarEvent } from './ICalendarEventCodecImplementation';
import {
  canonicalizeRecurrenceRule,
  recurrenceWriteFromUnknown,
  setRecurrenceRule,
  timingStartAsDateTime,
  validateRecurrenceRule,
} from './ICalendarRecurrenceWrite';
import {
  readCalendarEventRevision,
  setInitialRevisionMetadata,
} from './ICalendarRevision';
import {
  addNewEventTimezoneDefinitions,
  setCategories,
  setOptionalProperty,
  setTextProperty,
  setTiming,
} from './ICalendarTimingWrite';
import { readCalendarLinks } from './readCalendarLinks';

export function createICalendarEvent(
  calendarId: CalendarId,
  eventId: CalendarEventId,
  input: CalendarEventInput,
  clock: () => Date,
): EncodedICalendarEvent {
  let conferenceInput: CalendarEventConferenceInput | undefined;
  let attachmentInput: CalendarEventAttachmentInput | undefined;
  try {
    validateCalendarEventInputConference(input);
    validateCalendarEventInputAttachment(input);
    conferenceInput = input.conference
      ? normalizeCalendarEventConferenceInput(input.conference)
      : undefined;
    attachmentInput = input.attachment
      ? normalizeCalendarEventAttachmentInput(input.attachment)
      : undefined;
  } catch (error) {
    if (error instanceof CalendarEventConferenceValidationError) {
      throw unsupportedConferencePatch();
    }
    if (error instanceof CalendarEventAttachmentValidationError) {
      throw unsupportedAttachmentPatch();
    }
    throw error;
  }
  if (input.alarm !== undefined) {
    validateDisplayAlarm(input.alarm);
  }
  const recurrenceWrite = recurrenceWriteFromUnknown(input.recurrence);
  if (input.recurrence) {
    if (
      !recurrenceWrite ||
      !('rrule' in recurrenceWrite) ||
      !recurrenceWrite.rrule
    ) {
      throw unsupportedRecurrencePatch();
    }
    validateRecurrenceRule(
      recurrenceWrite.rrule,
      timingStartAsDateTime(input.timing),
    );
  }

  const calendar = new ICAL.Component('vcalendar');
  calendar.addPropertyWithValue('version', '2.0');
  calendar.addPropertyWithValue('prodid', '-//Matrix Calendar Widget//EN');
  addNewEventTimezoneDefinitions(calendar, input.timing);

  const vevent = new ICAL.Component('vevent');
  calendar.addSubcomponent(vevent);

  setTextProperty(vevent, 'uid', input.uid);
  setInitialRevisionMetadata(vevent, clock());
  setTextProperty(vevent, 'summary', input.title);
  setTiming(vevent, input.timing);
  setOptionalProperty(vevent, 'description', input.description);
  setOptionalProperty(vevent, 'status', input.status?.toUpperCase());
  setOptionalProperty(
    vevent,
    'transp',
    input.transparency === undefined
      ? undefined
      : input.transparency === 'transparent'
        ? 'TRANSPARENT'
        : 'OPAQUE',
  );
  setOptionalProperty(vevent, 'location', input.location);
  setOptionalProperty(vevent, 'url', input.url);
  setCategories(vevent, input.categories);
  setOptionalProperty(vevent, 'priority', input.priority);
  if (conferenceInput) {
    setConferenceProperty(vevent, { action: 'set', ...conferenceInput });
  }
  if (attachmentInput) {
    setAttachmentProperty(vevent, {
      action: 'add',
      url: attachmentInput.url,
    });
  }
  const recurrenceRule =
    recurrenceWrite && 'rrule' in recurrenceWrite
      ? recurrenceWrite.rrule
      : undefined;
  setRecurrenceRule(vevent, recurrenceRule);
  const alarmUid = input.alarm
    ? setDisplayAlarm(calendar, vevent, input.alarm, input.title)
    : undefined;

  const {
    conference: _conferenceInput,
    attachment: _attachmentInput,
    ...eventInput
  } = input;
  return {
    event: {
      ...eventInput,
      ...(attachmentInput
        ? { attachments: [{ url: attachmentInput.url }] }
        : {}),
      id: eventId,
      calendarId,
      revision: readCalendarEventRevision(vevent),
      externalLinks: readCalendarLinks(vevent),
      ...(input.alarm ? { alarm: { ...input.alarm, uid: alarmUid } } : {}),
      recurrence: recurrenceRule
        ? { rrule: canonicalizeRecurrenceRule(recurrenceRule) }
        : undefined,
    },
    icalendar: calendar.toString(),
  };
}
