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
  CalendarEvent,
  CalendarEventId,
  CalendarEventInput,
  CalendarId,
} from '@matrix-calendar-widget/calendar';
import ICAL from 'ical.js';
import { readResourceAlarm } from './ICalendarAlarm';
import {
  hasAmbiguousAttachmentSource,
  readAttachmentSourceState,
} from './ICalendarAttachments';
import { ICalendarEventCodecError } from './ICalendarCodecError';
import {
  hasAmbiguousConferenceSource,
  readConferenceSourceState,
} from './ICalendarConference';
import { createICalendarEvent } from './ICalendarEventCreate';
import {
  numberValue,
  readCategories,
  readStatus,
  readTransparency,
  textValue,
} from './ICalendarEventFields';
import { ParsedICalendarEvent, systemClock } from './ICalendarEventPatch';
import {
  rawVeventAlarmProperties,
  rawVeventAttachmentProperties,
  rawVeventConferenceProperties,
  readMasterRevisionProperties,
} from './ICalendarRawRead';
import {
  findMasterEvent,
  readRecurrence,
  readUnsupportedRecurrence,
} from './ICalendarRecurrenceRead';
import { readCalendarEventRevision } from './ICalendarRevision';
import { hasUnsupportedTimezoneRules } from './ICalendarTimezoneProjectionSafety';
import { readTiming } from './ICalendarTiming';
import { readCalendarLinks } from './readCalendarLinks';
export {
  ICalendarEventCodecError,
  type ICalendarEventCodecErrorCode,
} from './ICalendarCodecError';
export {
  applyOccurrenceTimingOverride,
  MAX_FOLLOWING_RESOURCE_BYTES,
  ParsedICalendarEvent,
  type OccurrenceTimingOverrideResult,
  type OccurrenceTimingOverrideWrite,
} from './ICalendarEventPatch';

export type EncodedICalendarEvent = {
  event: CalendarEvent;
  icalendar: string;
};

export class ICalendarEventCodec {
  constructor(private readonly clock: () => Date = systemClock) {}

  create(
    calendarId: CalendarId,
    eventId: CalendarEventId,
    input: CalendarEventInput,
  ): EncodedICalendarEvent {
    return createICalendarEvent(calendarId, eventId, input, this.clock);
  }

  parse(
    calendarId: CalendarId,
    eventId: CalendarEventId,
    source: string,
  ): ParsedICalendarEvent {
    let calendar: ICAL.Component;

    try {
      calendar = ICAL.Component.fromString(source);
    } catch (error) {
      throw new ICalendarEventCodecError(
        'invalid-calendar',
        error instanceof Error
          ? `Invalid iCalendar document: ${error.message}`
          : 'Invalid iCalendar document',
      );
    }

    if (calendar.name !== 'vcalendar') {
      throw new ICalendarEventCodecError(
        'invalid-calendar',
        'iCalendar resource must contain a VCALENDAR root',
      );
    }

    const vevent = findMasterEvent(calendar);
    if (!vevent) {
      throw new ICalendarEventCodecError(
        'missing-event',
        'iCalendar resource does not contain a VEVENT',
      );
    }

    const uid = textValue(vevent.getFirstPropertyValue('uid'));
    if (!uid) {
      throw new ICalendarEventCodecError(
        'missing-uid',
        'VEVENT does not contain a UID',
      );
    }

    const sourceRevisionProperties = readMasterRevisionProperties(source);
    const timing = readTiming(vevent);
    const recurrence = readRecurrence(calendar, vevent, uid);
    const unsupportedRecurrence = readUnsupportedRecurrence(calendar, uid);
    const hasMultipleMasterRules = vevent.getAllProperties('rrule').length > 1;
    const unsupportedTimezone = hasUnsupportedTimezoneRules(calendar, uid);
    const alarmState = readResourceAlarm(calendar, vevent, () =>
      rawVeventAlarmProperties(source),
    );
    const conferencePropertiesByEvent = rawVeventConferenceProperties(source);
    const eventIndex = calendar.getAllSubcomponents('vevent').indexOf(vevent);
    const conferenceState = readConferenceSourceState(
      vevent,
      conferencePropertiesByEvent[eventIndex] ?? [],
    );
    const ambiguousConferenceSource = hasAmbiguousConferenceSource(
      calendar,
      uid,
      vevent,
      conferencePropertiesByEvent,
    );
    const attachmentPropertiesByEvent = rawVeventAttachmentProperties(source);
    const attachmentState = readAttachmentSourceState(
      vevent,
      attachmentPropertiesByEvent[eventIndex] ?? [],
    );
    const authorableAttachments = attachmentState.projectable
      ? attachmentState.editable.filter(
          ({ url }) => !attachmentState.opaqueUriUrls.includes(url),
        )
      : [];
    const ambiguousAttachmentSource =
      attachmentState.unsupported ||
      hasAmbiguousAttachmentSource(
        calendar,
        uid,
        vevent,
        attachmentPropertiesByEvent,
      );

    const event: CalendarEvent = {
      id: eventId,
      calendarId,
      uid,
      title: textValue(vevent.getFirstPropertyValue('summary')) ?? '',
      description: textValue(vevent.getFirstPropertyValue('description')),
      timing,
      status: readStatus(vevent.getFirstPropertyValue('status')),
      transparency: readTransparency(vevent.getFirstPropertyValue('transp')),
      location: textValue(vevent.getFirstPropertyValue('location')),
      url: textValue(vevent.getFirstPropertyValue('url')),
      externalLinks: readCalendarLinks(vevent),
      ...(authorableAttachments.length > 0
        ? {
            attachments: authorableAttachments.map(({ url }) => ({ url })),
          }
        : {}),
      categories: readCategories(vevent),
      priority: numberValue(vevent.getFirstPropertyValue('priority')),
      recurrence,
      revision: readCalendarEventRevision(vevent, sourceRevisionProperties),
      ...(alarmState.alarm ? { alarm: alarmState.alarm } : {}),
      ...(alarmState.unsupported ? { unsupportedAlarm: true } : {}),
      ...(ambiguousConferenceSource ||
      (conferenceState.present && !conferenceState.editable)
        ? { unsupportedConference: true }
        : {}),
      ...(ambiguousAttachmentSource ? { unsupportedAttachment: true } : {}),
      ...(unsupportedRecurrence ? { unsupportedRecurrence } : {}),
      ...(unsupportedTimezone ? { unsupportedTimezone: true } : {}),
    };

    return new ParsedICalendarEvent(
      calendar,
      event,
      hasMultipleMasterRules ? 'unsupported-recurrence' : undefined,
      this.clock,
      sourceRevisionProperties,
      source,
    );
  }
}
