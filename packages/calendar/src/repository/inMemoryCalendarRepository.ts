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

import { DateTime } from 'luxon';
import {
  AllDayCalendarEventTiming,
  Calendar,
  CalendarEvent,
  CalendarEventAttachmentInput,
  CalendarEventAttachmentPatch,
  CalendarEventConferenceInput,
  CalendarEventConferencePatch,
  CalendarEventDateTime,
  CalendarEventDuration,
  CalendarEventId,
  CalendarEventInput,
  CalendarEventPatch,
  CalendarEventRecurrenceDate,
  CalendarEventRecurrenceOverride,
  CalendarEventRecurrenceTiming,
  CalendarId,
  CalendarTimeRange,
  TimedCalendarEventTiming,
  isCalendarEventAlarmRemoval,
} from '../model';
import {
  CalendarEventAttachmentValidationError,
  MAX_CALENDAR_EVENT_AUTHORABLE_ATTACHMENTS,
  normalizeCalendarEventAttachmentInput,
  normalizeCalendarEventAttachmentPatch,
  validateCalendarEventInputAttachment,
  validateCalendarEventPatchAttachment,
} from '../utils/calendarEventAttachment';
import {
  CalendarEventConferenceValidationError,
  normalizeCalendarEventConferenceInput,
  normalizeCalendarEventConferencePatch,
  validateCalendarEventInputConference,
  validateCalendarEventPatchConference,
} from '../utils/calendarEventConference';
import {
  calendarEventFollowingTimingOverrides,
  calendarEventRecurrenceIdentity,
  isSupportedCalendarEventOccurrenceExclusion,
} from '../utils/calendarEventOccurrenceProjection';
import { calendarEventTimedDateTimeToDateTime } from '../utils/calendarEventTimedDateTime';
import { canonicalizeCalendarExternalUrl } from '../utils/calendarEventExternalLinks';
import {
  calendarLocalDateTimeToUnixMillis,
  isCalendarTimezoneSupported,
} from '../utils/calendarEventTimezone';
import {
  CalendarRepository,
  CalendarRepositoryError,
} from './calendarRepository';

export type InMemoryCalendarRepositoryOptions = {
  calendars?: Calendar[];
  events?: CalendarEvent[];
  calendarIdFactory?: (sequence: number) => CalendarId;
  idFactory?: (sequence: number) => CalendarEventId;
};

export class InMemoryCalendarRepository implements CalendarRepository {
  private readonly calendars = new Map<CalendarId, Calendar>();
  private readonly events = new Map<
    CalendarId,
    Map<CalendarEventId, CalendarEvent>
  >();
  private readonly calendarIdFactory: (sequence: number) => CalendarId;
  private readonly idFactory: (sequence: number) => CalendarEventId;
  private calendarSequence = 1;
  private sequence = 1;

  constructor(options: InMemoryCalendarRepositoryOptions = {}) {
    this.calendarIdFactory =
      options.calendarIdFactory ??
      ((sequence) => `memory-calendar-${sequence}`);
    this.idFactory =
      options.idFactory ?? ((sequence) => `memory-event-${sequence}`);

    for (const calendar of options.calendars ?? []) {
      this.calendars.set(calendar.id, cloneCalendar(calendar));
      this.events.set(calendar.id, new Map());
    }

    for (const event of options.events ?? []) {
      if (!this.calendars.has(event.calendarId)) {
        throw new CalendarRepositoryError(
          'calendar-not-found',
          `Calendar ${event.calendarId} does not exist`,
        );
      }

      this.events
        .get(event.calendarId)!
        .set(event.id, cloneCalendarEvent(event));
    }
  }

  async listCalendars(): Promise<Calendar[]> {
    return [...this.calendars.values()].map(cloneCalendar);
  }

  async createCalendar(name: string): Promise<Calendar> {
    const trimmedName = name.trim();
    if (!trimmedName) {
      throw new CalendarRepositoryError(
        'invalid-calendar-name',
        'Calendar name must not be empty',
      );
    }

    let id: CalendarId;
    do {
      id = this.calendarIdFactory(this.calendarSequence++);
    } while (this.calendars.has(id));

    const calendar: Calendar = {
      id,
      name: trimmedName,
    };
    this.calendars.set(id, calendar);
    this.events.set(id, new Map());
    return cloneCalendar(calendar);
  }

  async renameCalendar(calendarId: CalendarId, name: string): Promise<void> {
    const calendar = this.getWritableCalendar(calendarId);
    const trimmedName = name.trim();
    if (!trimmedName) {
      throw new CalendarRepositoryError(
        'invalid-calendar-name',
        'Calendar name must not be empty',
      );
    }

    this.calendars.set(calendarId, {
      ...calendar,
      name: trimmedName,
    });
  }

  async updateCalendarDescription(
    calendarId: CalendarId,
    description: string,
  ): Promise<void> {
    const calendar = this.getWritableCalendar(calendarId);
    const updated = { ...calendar };

    if (description.length === 0) {
      delete updated.description;
    } else {
      updated.description = description;
    }

    this.calendars.set(calendarId, updated);
  }

  async updateCalendarColor(
    calendarId: CalendarId,
    color: string,
  ): Promise<void> {
    const calendar = this.getCalendar(calendarId);
    if (calendar.readOnly !== false) {
      throw new CalendarRepositoryError(
        'calendar-read-only',
        `Calendar ${calendarId} is not explicitly writable`,
      );
    }
    if (color !== '' && !/^#[\da-fA-F]{6}$/.test(color)) {
      throw new CalendarRepositoryError(
        'invalid-calendar-color',
        'Calendar color must be a six-digit hex color',
      );
    }

    const updated = { ...calendar };
    if (color === '') {
      delete updated.color;
    } else {
      updated.color = color;
    }
    this.calendars.set(calendarId, updated);
  }

  async deleteCalendar(calendarId: CalendarId): Promise<void> {
    this.getWritableCalendar(calendarId);
    this.calendars.delete(calendarId);
    this.events.delete(calendarId);
  }

  async listEvents(
    calendarIds: CalendarId[],
    range: CalendarTimeRange,
  ): Promise<CalendarEvent[]> {
    const parsedRange = parseRange(range);
    const result: CalendarEvent[] = [];

    for (const calendarId of calendarIds) {
      const calendar = this.getCalendar(calendarId);
      const calendarEvents = this.events.get(calendarId)!;

      for (const event of calendarEvents.values()) {
        if (eventIntersectsRange(event, calendar, parsedRange)) {
          result.push(cloneCalendarEvent(event));
        }
      }
    }

    return result;
  }

  async getEvent(
    calendarId: CalendarId,
    eventId: CalendarEventId,
  ): Promise<CalendarEvent> {
    this.getCalendar(calendarId);
    return cloneCalendarEvent(this.getStoredEvent(calendarId, eventId));
  }

  async createEvent(
    calendarId: CalendarId,
    input: CalendarEventInput,
  ): Promise<CalendarEvent> {
    const calendar = this.getWritableCalendar(calendarId);
    let conference: CalendarEventConferenceInput | undefined;
    let attachment: CalendarEventAttachmentInput | undefined;
    try {
      validateCalendarEventInputConference(input);
      validateCalendarEventInputAttachment(input);
      conference = input.conference
        ? normalizeCalendarEventConferenceInput(input.conference)
        : undefined;
      attachment = input.attachment
        ? normalizeCalendarEventAttachmentInput(input.attachment)
        : undefined;
    } catch (error) {
      if (
        error instanceof CalendarEventConferenceValidationError ||
        error instanceof CalendarEventAttachmentValidationError
      ) {
        throw new CalendarRepositoryError(
          'unsupported-patch',
          'Invalid event link operation',
        );
      }
      throw error;
    }
    const calendarEvents = this.events.get(calendar.id)!;
    const id = this.nextEventId(calendarEvents);

    const {
      conference: _conference,
      attachment: _attachment,
      ...eventInput
    } = input;

    const initialLinks = conference
      ? applyConferenceToLinks(undefined, { action: 'set', ...conference })
      : undefined;
    const externalLinks = attachment
      ? applyAttachmentToLinks(initialLinks, {
          action: 'add',
          url: attachment.url,
        })
      : initialLinks;
    const event: CalendarEvent = {
      ...cloneCalendarEventInput(eventInput),
      id,
      calendarId,
      ...(attachment ? { attachments: [{ url: attachment.url }] } : {}),
      ...(externalLinks ? { externalLinks } : {}),
    };

    calendarEvents.set(id, event);
    return cloneCalendarEvent(event);
  }

  async updateEvent(
    calendarId: CalendarId,
    eventId: CalendarEventId,
    patch: CalendarEventPatch,
  ): Promise<CalendarEvent> {
    this.getWritableCalendar(calendarId);
    const current = this.getStoredEvent(calendarId, eventId);
    let conference: CalendarEventConferencePatch | undefined;
    let attachment: CalendarEventAttachmentPatch | undefined;
    try {
      validateCalendarEventPatchConference(patch);
      validateCalendarEventPatchAttachment(patch);
      conference = Object.prototype.hasOwnProperty.call(patch, 'conference')
        ? normalizeCalendarEventConferencePatch(patch.conference)
        : undefined;
      attachment = Object.prototype.hasOwnProperty.call(patch, 'attachment')
        ? normalizeCalendarEventAttachmentPatch(patch.attachment)
        : undefined;
    } catch (error) {
      if (
        error instanceof CalendarEventConferenceValidationError ||
        error instanceof CalendarEventAttachmentValidationError
      ) {
        throw new CalendarRepositoryError(
          'unsupported-patch',
          'Invalid event link operation',
        );
      }
      throw error;
    }
    if (conference && current.unsupportedConference) {
      throw new CalendarRepositoryError(
        'unsupported-patch',
        'Conference edits are not supported for this event',
      );
    }
    if (attachment && current.unsupportedAttachment) {
      throw new CalendarRepositoryError(
        'unsupported-patch',
        'Attachment edits are not supported for this event',
      );
    }
    validateOccurrenceTimingPatchShape(patch);
    validateFollowingTimingPatchShape(patch);
    if (
      current.unsupportedAlarm &&
      Object.prototype.hasOwnProperty.call(patch, 'alarm')
    ) {
      throw new CalendarRepositoryError(
        'unsupported-patch',
        'Alarm edits are not supported for this event',
      );
    }
    const clonedPatch = cloneCalendarEventPatch(patch);
    const {
      alarm: alarmPatch,
      conference: _conference,
      attachment: _attachment,
      ...mutablePatch
    } = clonedPatch;
    const recurrence = Object.prototype.hasOwnProperty.call(patch, 'recurrence')
      ? applyRecurrenceWrite(current, clonedPatch.recurrence)
      : current.recurrence;

    const conferenceLinks = conference
      ? applyConferenceToLinks(current.externalLinks, conference)
      : current.externalLinks;
    const updated: CalendarEvent = {
      ...current,
      ...mutablePatch,
      id: current.id,
      calendarId: current.calendarId,
      uid: current.uid,
      recurrence,
      ...(attachment
        ? { attachments: applyAttachmentToProjection(current, attachment) }
        : {}),
      ...(conference || attachment
        ? {
            externalLinks: attachment
              ? applyAttachmentToLinks(conferenceLinks, attachment)
              : conferenceLinks,
          }
        : {}),
    };
    if (isCalendarEventAlarmRemoval(alarmPatch)) {
      delete updated.alarm;
    } else if (alarmPatch) {
      updated.alarm = alarmPatch;
    }
    if (attachment) {
      delete updated.unsupportedAttachment;
    }

    this.events.get(calendarId)!.set(eventId, updated);
    return cloneCalendarEvent(updated);
  }

  async deleteEvent(
    calendarId: CalendarId,
    eventId: CalendarEventId,
  ): Promise<void> {
    this.getWritableCalendar(calendarId);
    this.getStoredEvent(calendarId, eventId);
    this.events.get(calendarId)!.delete(eventId);
  }

  private getCalendar(calendarId: CalendarId): Calendar {
    const calendar = this.calendars.get(calendarId);

    if (!calendar) {
      throw new CalendarRepositoryError(
        'calendar-not-found',
        `Calendar ${calendarId} does not exist`,
      );
    }

    return calendar;
  }

  private getWritableCalendar(calendarId: CalendarId): Calendar {
    const calendar = this.getCalendar(calendarId);

    if (calendar.readOnly) {
      throw new CalendarRepositoryError(
        'calendar-read-only',
        `Calendar ${calendarId} is read-only`,
      );
    }

    return calendar;
  }

  private getStoredEvent(
    calendarId: CalendarId,
    eventId: CalendarEventId,
  ): CalendarEvent {
    const event = this.events.get(calendarId)?.get(eventId);

    if (!event) {
      throw new CalendarRepositoryError(
        'event-not-found',
        `Event ${eventId} does not exist in calendar ${calendarId}`,
      );
    }

    return event;
  }

  private nextEventId(
    calendarEvents: Map<CalendarEventId, CalendarEvent>,
  ): CalendarEventId {
    let id: CalendarEventId;

    do {
      id = this.idFactory(this.sequence++);
    } while (calendarEvents.has(id));

    return id;
  }
}

type ParsedRange = {
  start: number;
  end: number;
};

function parseRange(range: CalendarTimeRange): ParsedRange {
  const start = DateTime.fromISO(range.start, { setZone: true });
  const end = DateTime.fromISO(range.end, { setZone: true });

  if (!start.isValid || !end.isValid || end.toMillis() <= start.toMillis()) {
    throw new CalendarRepositoryError(
      'invalid-range',
      'Calendar time range must contain valid ISO instants with end after start',
    );
  }

  return {
    start: start.toMillis(),
    end: end.toMillis(),
  };
}

function eventIntersectsRange(
  event: CalendarEvent,
  calendar: Calendar,
  range: ParsedRange,
): boolean {
  const interval = eventInterval(event, calendar);

  // Recurrence expansion belongs to the calendar-domain recurrence layer. Keep
  // a recurring source available whenever its master starts before the query
  // end so the caller can expand it into the visible range.
  if (event.recurrence?.rrule || event.recurrence?.rdates?.length) {
    return interval.start < range.end;
  }

  return interval.start < range.end && interval.end > range.start;
}

function eventInterval(event: CalendarEvent, calendar: Calendar): ParsedRange {
  if (event.timing.type === 'timed') {
    return timedInterval(event.timing);
  }

  const zone = calendar.timezone ?? 'UTC';
  const start = DateTime.fromISO(event.timing.startDate, { zone }).startOf(
    'day',
  );
  const end = DateTime.fromISO(event.timing.endDate, { zone }).startOf('day');

  return {
    start: start.toMillis(),
    end: end.toMillis(),
  };
}

function timedInterval(timing: TimedCalendarEventTiming): ParsedRange {
  return {
    start: calendarEventTimedDateTimeToDateTime(timing.start).toMillis(),
    end: calendarEventTimedDateTimeToDateTime(timing.end).toMillis(),
  };
}

function cloneCalendar(calendar: Calendar): Calendar {
  return {
    ...calendar,
    supportedComponents: calendar.supportedComponents
      ? [...calendar.supportedComponents]
      : undefined,
  };
}

function cloneCalendarEventDateTime(
  value: CalendarEventDateTime,
): CalendarEventDateTime {
  switch (value.type) {
    case 'date':
    case 'floating-date-time':
      return { ...value };
    case 'date-time':
      return { type: 'date-time', value: { ...value.value } };
  }
}

function cloneRecurrenceDate(
  value: CalendarEventRecurrenceDate,
): CalendarEventRecurrenceDate {
  if (value.type !== 'period') {
    return cloneCalendarEventDateTime(value);
  }

  return {
    type: 'period',
    timing: cloneRecurrenceTiming(value.timing),
  };
}

function cloneRecurrenceTiming(
  timing: CalendarEventRecurrenceTiming,
): CalendarEventRecurrenceTiming {
  if (timing.type === 'end') {
    return {
      type: 'end',
      start: cloneCalendarEventDateTime(timing.start),
      end: cloneCalendarEventDateTime(timing.end),
    };
  }

  return {
    type: 'duration',
    start: cloneCalendarEventDateTime(timing.start),
    duration: { ...timing.duration },
  };
}

function cloneTimedTiming(
  timing: TimedCalendarEventTiming,
): TimedCalendarEventTiming {
  return {
    type: 'timed',
    start: { ...timing.start },
    end: { ...timing.end },
  };
}

function cloneAllDayTiming(
  timing: AllDayCalendarEventTiming,
): AllDayCalendarEventTiming {
  return { ...timing };
}

function cloneCalendarEvent(event: CalendarEvent): CalendarEvent {
  return {
    ...event,
    revision: event.revision ? { ...event.revision } : undefined,
    externalLinks: event.externalLinks?.map((link) => ({ ...link })),
    attachments: event.attachments?.map((attachment) => ({ ...attachment })),
    timing:
      event.timing.type === 'timed'
        ? cloneTimedTiming(event.timing)
        : cloneAllDayTiming(event.timing),
    categories: event.categories ? [...event.categories] : undefined,
    alarm: event.alarm
      ? { ...event.alarm, trigger: { ...event.alarm.trigger } }
      : undefined,
    recurrence: cloneRecurrence(event.recurrence),
  };
}

function cloneCalendarEventInput(
  input: CalendarEventInput,
): CalendarEventInput {
  return {
    ...input,
    timing:
      input.timing.type === 'timed'
        ? cloneTimedTiming(input.timing)
        : cloneAllDayTiming(input.timing),
    categories: input.categories ? [...input.categories] : undefined,
    alarm: input.alarm
      ? { ...input.alarm, trigger: { ...input.alarm.trigger } }
      : undefined,
    recurrence: input.recurrence ? { ...input.recurrence } : undefined,
  };
}

function applyAttachmentToProjection(
  event: CalendarEvent,
  operation: CalendarEventAttachmentPatch,
): CalendarEvent['attachments'] {
  const current =
    event.attachments?.map((attachment) => ({ ...attachment })) ??
    event.externalLinks
      ?.filter((link) => link.kind === 'attachment')
      .map((link) => ({ url: link.href })) ??
    [];
  const matches = current.flatMap((attachment, index) =>
    canonicalizeCalendarExternalUrl(attachment.url) ===
    ('sourceUrl' in operation ? operation.sourceUrl : operation.url)
      ? [index]
      : [],
  );

  if (operation.action === 'add') {
    if (matches.length > 1) {
      throw unsupportedRepositoryAttachment();
    }
    if (matches.length === 1) {
      return current.length > 0 ? current : undefined;
    }
    if (current.length >= MAX_CALENDAR_EVENT_AUTHORABLE_ATTACHMENTS) {
      throw unsupportedRepositoryAttachment();
    }
    current.push({ url: operation.url });
    return current;
  }

  if (matches.length !== 1) {
    throw unsupportedRepositoryAttachment();
  }
  if (operation.action === 'remove') {
    current.splice(matches[0], 1);
    return current.length > 0 ? current : undefined;
  }
  if (
    current.some(
      (attachment, index) =>
        index !== matches[0] &&
        canonicalizeCalendarExternalUrl(attachment.url) === operation.url,
    )
  ) {
    throw unsupportedRepositoryAttachment();
  }
  if (operation.sourceUrl === operation.url) {
    return current;
  }
  current[matches[0]] = { url: operation.url };
  return current;
}

function applyAttachmentToLinks(
  links: CalendarEvent['externalLinks'],
  operation: CalendarEventAttachmentPatch,
): CalendarEvent['externalLinks'] {
  const currentLinks = links?.map((link) => ({ ...link })) ?? [];
  const targetUrl = 'sourceUrl' in operation
    ? operation.sourceUrl
    : operation.url;
  const matches = currentLinks.flatMap((link, index) =>
    link.kind === 'attachment' &&
    canonicalizeCalendarExternalUrl(link.href) === targetUrl
      ? [index]
      : [],
  );
  if (operation.action === 'add') {
    if (
      matches.length === 0 &&
      currentLinks.length < 20 &&
      !currentLinks.some(
        (link) =>
          link.kind === 'attachment' &&
          canonicalizeCalendarExternalUrl(link.href) === operation.url,
      )
    ) {
      currentLinks.push({ kind: 'attachment', href: operation.url });
    }
    return currentLinks.length > 0 ? currentLinks : undefined;
  }
  if (matches.length !== 1) {
    return currentLinks.length > 0 ? currentLinks : undefined;
  }
  if (operation.action === 'remove') {
    currentLinks.splice(matches[0], 1);
  } else if (operation.sourceUrl !== operation.url) {
    currentLinks[matches[0]] = { kind: 'attachment', href: operation.url };
  }
  return currentLinks.length > 0 ? currentLinks : undefined;
}

function unsupportedRepositoryAttachment(): CalendarRepositoryError {
  return new CalendarRepositoryError(
    'unsupported-patch',
    'Attachment edits require one unambiguous safe URI link',
  );
}

function applyConferenceToLinks(
  links: CalendarEvent['externalLinks'],
  operation: CalendarEventConferencePatch,
): CalendarEvent['externalLinks'] {
  const currentLinks = links?.map((link) => ({ ...link })) ?? [];
  const conferenceIndices = currentLinks.flatMap((link, index) =>
    link.kind === 'conference' ? [index] : [],
  );
  if (conferenceIndices.length > 1) {
    throw new CalendarRepositoryError(
      'unsupported-patch',
      'Conference edits are not supported for ambiguous event data',
    );
  }
  if (operation.action === 'remove') {
    if (conferenceIndices.length === 1) {
      currentLinks.splice(conferenceIndices[0], 1);
    }
    return currentLinks.length > 0 ? currentLinks : undefined;
  }
  const link = {
    kind: 'conference' as const,
    href: operation.url,
    ...(operation.label ? { label: operation.label } : {}),
  };
  if (conferenceIndices.length === 1) {
    currentLinks[conferenceIndices[0]] = link;
  } else {
    currentLinks.push(link);
  }
  return currentLinks;
}

function cloneRecurrence(
  recurrence: CalendarEvent['recurrence'],
): CalendarEvent['recurrence'] {
  return recurrence
    ? {
        ...recurrence,
        rdates: recurrence.rdates?.map(cloneRecurrenceDate),
        exdates: recurrence.exdates?.map(cloneCalendarEventDateTime),
        recurrenceId: recurrence.recurrenceId
          ? cloneCalendarEventDateTime(recurrence.recurrenceId)
          : undefined,
        overrides: recurrence.overrides?.map(cloneRecurrenceOverride),
      }
    : undefined;
}

function cloneRecurrenceOverride(
  override: CalendarEventRecurrenceOverride,
): CalendarEventRecurrenceOverride {
  return {
    ...override,
    recurrenceId: cloneCalendarEventDateTime(override.recurrenceId),
    timing: override.timing
      ? cloneRecurrenceTiming(override.timing)
      : undefined,
  };
}

function cloneCalendarEventPatch(
  patch: CalendarEventPatch,
): CalendarEventPatch {
  const cloned: CalendarEventPatch = { ...patch };

  if (patch.timing) {
    cloned.timing =
      patch.timing.type === 'timed'
        ? cloneTimedTiming(patch.timing)
        : cloneAllDayTiming(patch.timing);
  }

  if (patch.categories) {
    cloned.categories = [...patch.categories];
  }

  if (patch.alarm) {
    cloned.alarm = isCalendarEventAlarmRemoval(patch.alarm)
      ? { ...patch.alarm }
      : {
          ...patch.alarm,
          trigger: { ...patch.alarm.trigger },
        };
  }

  if (patch.recurrence) {
    if ('occurrence' in patch.recurrence) {
      const operation = patch.recurrence.occurrence;
      cloned.recurrence = {
        occurrence: {
          ...operation,
          recurrenceId: cloneCalendarEventDateTime(operation.recurrenceId),
          timing: cloneRecurrenceTiming(operation.timing),
        },
      };
    } else if ('following' in patch.recurrence) {
      const operation = patch.recurrence.following;
      cloned.recurrence = {
        following: {
          ...operation,
          recurrenceId: cloneCalendarEventDateTime(operation.recurrenceId),
          timing: cloneRecurrenceTiming(operation.timing),
        },
      };
    } else if ('exdate' in patch.recurrence) {
      cloned.recurrence = {
        exdate: {
          ...patch.recurrence.exdate,
          recurrenceId: cloneCalendarEventDateTime(
            patch.recurrence.exdate.recurrenceId,
          ),
        },
      };
    } else if ('rdate' in patch.recurrence) {
      const rdate = patch.recurrence.rdate;
      if (rdate.action === 'remove-period') {
        cloned.recurrence = {
          rdate: {
            action: 'remove-period',
            value: {
              type: 'period',
              timing: cloneRecurrenceTiming(rdate.value.timing),
            },
          },
        };
      } else if (rdate.action === 'replace-period') {
        cloned.recurrence = {
          rdate: {
            action: 'replace-period',
            value: {
              type: 'period',
              timing: cloneRecurrenceTiming(rdate.value.timing),
            },
            replacement: {
              type: 'period',
              timing: cloneRecurrenceTiming(rdate.replacement.timing),
            },
          },
        };
      } else if (rdate.action === 'add-period') {
        cloned.recurrence = {
          rdate: {
            action: 'add-period',
            value: {
              type: 'period',
              timing: cloneRecurrenceTiming(rdate.value.timing),
            },
          },
        };
      } else {
        cloned.recurrence = {
          rdate: {
            action: rdate.action,
            value: cloneCalendarEventDateTime(rdate.value),
          },
        };
      }
    } else {
      cloned.recurrence = { ...patch.recurrence };
    }
  }

  return cloned;
}

function applyRecurrenceWrite(
  currentEvent: CalendarEvent,
  write: CalendarEventPatch['recurrence'],
): CalendarEvent['recurrence'] {
  const current = currentEvent.recurrence;
  if (!write) {
    return undefined;
  }
  if ('occurrence' in write) {
    return applyOccurrenceTimingWrite(currentEvent, write.occurrence);
  }
  if ('following' in write) {
    try {
      const plan = calendarEventFollowingTimingOverrides(
        currentEvent,
        write.following,
      );
      if (plan.noOp) {
        return current;
      }
      return {
        ...current,
        overrides: plan.overrides.map((override) => ({
          recurrenceId: cloneCalendarEventDateTime(override.recurrenceId),
          timing: override.timing
            ? cloneRecurrenceTiming(override.timing)
            : undefined,
          ...(override.status ? { status: override.status } : {}),
        })),
      };
    } catch {
      throw invalidFollowingTiming();
    }
  }
  if (!('exdate' in write) && !('rdate' in write)) {
    return write?.rrule ? { rrule: write.rrule } : undefined;
  }

  if ('rdate' in write) {
    const rdates = current?.rdates ?? [];
    if (write.rdate.action === 'replace-period') {
      const sourceIdentity = recurrencePeriodIdentity(write.rdate.value);
      const sourceIndexes = rdates.flatMap((value, index) =>
        value.type === 'period' &&
        recurrencePeriodIdentity(value) === sourceIdentity
          ? [index]
          : [],
      );
      if (sourceIndexes.length !== 1) {
        throw new CalendarRepositoryError(
          'unsupported-patch',
          'PERIOD recurrence date changed while editing',
        );
      }

      const sourceIndex = sourceIndexes[0];
      const replacementIdentity = recurrencePeriodIdentity(
        write.rdate.replacement,
      );
      if (
        currentEvent.timing.type !== 'timed' ||
        currentEvent.unsupportedRecurrence ||
        currentEvent.unsupportedTimezone ||
        !isSupportedPeriodForReplacement(write.rdate.value) ||
        !isSupportedPeriodForReplacement(write.rdate.replacement) ||
        !hasCompatiblePeriodReplacementIdentity(
          write.rdate.value,
          write.rdate.replacement,
        ) ||
        !rdates.every(isSupportedRdateForReplacement)
      ) {
        throw new CalendarRepositoryError(
          'unsupported-patch',
          'Unsupported recurrence data prevents PERIOD editing',
        );
      }

      if (replacementIdentity === sourceIdentity) {
        return current;
      }

      const replacementStartIdentity = calendarEventRecurrenceIdentity(
        write.rdate.replacement.timing.start,
      );
      const replacementCollides = rdates.some((value, index) => {
        if (index === sourceIndex) {
          return false;
        }
        const siblingStart =
          value.type === 'period' ? value.timing.start : value;
        return (
          calendarEventRecurrenceIdentity(siblingStart) ===
          replacementStartIdentity
        );
      });
      if (replacementCollides) {
        throw new CalendarRepositoryError(
          'unsupported-patch',
          'PERIOD recurrence date conflicts with a sibling RDATE',
        );
      }

      const nextRdates = [...rdates];
      nextRdates[sourceIndex] = write.rdate.replacement;
      return { ...current, rdates: nextRdates };
    }

    if (write.rdate.action === 'remove-period') {
      const identity = recurrencePeriodIdentity(write.rdate.value);
      let removed = false;
      const nextRdates = rdates.filter((value) => {
        if (removed || value.type !== 'period') {
          return true;
        }
        if (recurrencePeriodIdentity(value) !== identity) {
          return true;
        }
        removed = true;
        return false;
      });
      const next: NonNullable<CalendarEvent['recurrence']> = {
        ...current,
        rdates: nextRdates,
      };
      if (nextRdates.length === 0) {
        delete next.rdates;
      }
      return Object.keys(next).length > 0 ? next : undefined;
    }

    if (write.rdate.action === 'add-period') {
      const identity = recurrencePeriodIdentity(write.rdate.value);
      if (
        rdates.some(
          (value) =>
            value.type === 'period' &&
            recurrencePeriodIdentity(value) === identity,
        )
      ) {
        return current;
      }
      return { ...current, rdates: [...rdates, write.rdate.value] };
    }

    const identity = calendarEventRecurrenceIdentity(write.rdate.value);
    if (write.rdate.action === 'add') {
      const recurrenceWithoutExdates = current
        ? { ...currentEvent, recurrence: { ...current, exdates: [] } }
        : currentEvent;
      if (
        isSupportedCalendarEventOccurrenceExclusion(
          recurrenceWithoutExdates,
          write.rdate.value,
        )
      ) {
        return current;
      }

      const next: NonNullable<CalendarEvent['recurrence']> = {
        ...current,
        rdates: [...rdates, write.rdate.value],
      };
      return next;
    }

    const nextRdates = rdates.filter(
      (value) =>
        value.type === 'period' ||
        calendarEventRecurrenceIdentity(value) !== identity,
    );
    const next: NonNullable<CalendarEvent['recurrence']> = {
      ...current,
      rdates: nextRdates,
    };
    if (nextRdates.length === 0) {
      delete next.rdates;
    }
    return Object.keys(next).length > 0 ? next : undefined;
  }

  const identity = calendarEventRecurrenceIdentity(write.exdate.recurrenceId);
  const exdates = current?.exdates ?? [];
  const nextExdates =
    write.exdate.action === 'add'
      ? exdates.some(
          (value) => calendarEventRecurrenceIdentity(value) === identity,
        )
        ? exdates
        : [...exdates, write.exdate.recurrenceId]
      : exdates.filter(
          (value) => calendarEventRecurrenceIdentity(value) !== identity,
        );
  const next: NonNullable<CalendarEvent['recurrence']> = {
    ...current,
    exdates: nextExdates,
  };

  if (next.exdates?.length === 0) {
    delete next.exdates;
  }

  return Object.keys(next).length > 0 ? next : undefined;
}

function applyOccurrenceTimingWrite(
  event: CalendarEvent,
  operation: Extract<
    NonNullable<CalendarEventPatch['recurrence']>,
    { occurrence: unknown }
  >['occurrence'],
): CalendarEvent['recurrence'] {
  const recurrence = event.recurrence;
  const identity = calendarEventRecurrenceIdentity(operation.recurrenceId);
  if (
    !isCalendarTimezoneSupported(operation.viewerTimezone) ||
    event.unsupportedTimezone ||
    event.unsupportedRecurrence ||
    event.unsupportedAlarm ||
    event.alarm ||
    !recurrence ||
    (!recurrence.rrule && !recurrence.rdates?.length) ||
    !isSupportedCalendarEventOccurrenceExclusion(
      { ...event, recurrence: { ...recurrence, exdates: [], overrides: [] } },
      operation.recurrenceId,
    ) ||
    recurrence.exdates?.some(
      (value) => calendarEventRecurrenceIdentity(value) === identity,
    )
  ) {
    throw new CalendarRepositoryError(
      'unsupported-patch',
      'This occurrence cannot be timed safely because its recurrence, alarms, or identity are unsupported or ambiguous.',
    );
  }

  const matchingOverrides = (recurrence.overrides ?? []).filter(
    (override) =>
      calendarEventRecurrenceIdentity(override.recurrenceId) === identity,
  );
  if (
    matchingOverrides.length > 1 ||
    matchingOverrides[0]?.status === 'cancelled'
  ) {
    throw new CalendarRepositoryError(
      'unsupported-patch',
      'This occurrence has an ambiguous or cancelled override.',
    );
  }

  validateRecurrenceTiming(operation.timing, event, operation.viewerTimezone);
  const nextOverride: CalendarEventRecurrenceOverride = {
    recurrenceId: cloneCalendarEventDateTime(operation.recurrenceId),
    timing: cloneRecurrenceTiming(operation.timing),
    ...(matchingOverrides[0]?.status
      ? { status: matchingOverrides[0].status }
      : {}),
  };
  const overrides = [...(recurrence.overrides ?? [])];
  if (matchingOverrides.length === 1) {
    const index = overrides.indexOf(matchingOverrides[0]);
    overrides[index] = nextOverride;
  } else {
    overrides.push(nextOverride);
  }
  return { ...recurrence, overrides };
}

function validateRecurrenceTiming(
  timing: CalendarEventRecurrenceTiming,
  event: CalendarEvent,
  viewerTimezone: string,
): void {
  const anchor =
    event.timing.type === 'all-day'
      ? { type: 'date' as const, value: event.timing.startDate }
      : event.timing.start.type === 'floating'
        ? {
            type: 'floating-date-time' as const,
            value: event.timing.start.local,
          }
        : {
            type: 'date-time' as const,
            value: {
              local: event.timing.start.local,
              timezone: event.timing.start.timezone,
            },
          };
  const timingStart = timing.start;
  if (
    (anchor.type === 'date') !== (timingStart.type === 'date') ||
    (timing.type === 'duration' && timingStart.type === 'date') ||
    (timing.type === 'end' &&
      (anchor.type === 'date') !== (timing.end.type === 'date'))
  ) {
    throw invalidOccurrenceTiming();
  }

  const start = recurrenceDateTimeMillis(timingStart, viewerTimezone);
  const end =
    timing.type === 'end'
      ? recurrenceDateTimeMillis(timing.end, viewerTimezone)
      : recurrenceDurationEndMillis(
          timingStart,
          timing.duration,
          viewerTimezone,
        );
  if (end <= start) {
    throw invalidOccurrenceTiming();
  }
}

function recurrenceDateTimeMillis(
  value: CalendarEventDateTime,
  viewerTimezone: string,
): number {
  if (value.type === 'date') {
    const instant = calendarLocalDateTimeToUnixMillis(
      `${value.value}T00:00:00`,
      viewerTimezone,
    );
    if (
      DateTime.fromMillis(instant, { zone: viewerTimezone }).toFormat(
        'yyyy-MM-dd',
      ) !== value.value
    ) {
      throw invalidOccurrenceTiming();
    }
    return instant;
  }

  const zone =
    value.type === 'date-time' ? value.value.timezone : viewerTimezone;
  const local = value.type === 'date-time' ? value.value.local : value.value;
  if (zone !== 'UTC' && !isCalendarTimezoneSupported(zone)) {
    throw invalidOccurrenceTiming();
  }
  const instant = calendarLocalDateTimeToUnixMillis(local, zone);
  if (
    DateTime.fromMillis(instant, { zone }).toFormat("yyyy-MM-dd'T'HH:mm:ss") !==
    local
  ) {
    throw invalidOccurrenceTiming();
  }
  return instant;
}

function recurrenceDurationEndMillis(
  start: CalendarEventDateTime,
  duration: CalendarEventDuration,
  viewerTimezone: string,
): number {
  if (start.type === 'date' || !isPositiveRfcDuration(duration)) {
    throw invalidOccurrenceTiming();
  }

  const zone =
    start.type === 'date-time' ? start.value.timezone : viewerTimezone;
  const local = start.type === 'date-time' ? start.value.local : start.value;
  const calendarDays = duration.weeks > 0 ? duration.weeks * 7 : duration.days;
  const calendarEnd = DateTime.fromISO(local, { zone: 'UTC' }).plus({
    days: calendarDays,
  });
  if (!calendarEnd.isValid) {
    throw invalidOccurrenceTiming();
  }
  const afterCalendar = calendarLocalDateTimeToUnixMillis(
    calendarEnd.toFormat("yyyy-MM-dd'T'HH:mm:ss"),
    zone,
  );
  return (
    afterCalendar +
    ((duration.hours * 60 + duration.minutes) * 60 + duration.seconds) * 1000
  );
}

function validateOccurrenceTimingPatchShape(patch: unknown): void {
  if (!isRecord(patch) || !isRecord(patch.recurrence)) {
    return;
  }
  const recurrence = patch.recurrence;
  if (!Object.prototype.hasOwnProperty.call(recurrence, 'occurrence')) {
    return;
  }

  const operation = recurrence.occurrence;
  if (
    Object.keys(patch).length !== 1 ||
    Object.keys(recurrence).length !== 1 ||
    !isRecord(operation) ||
    Object.keys(operation).length !== 4 ||
    !['action', 'recurrenceId', 'timing', 'viewerTimezone'].every((key) =>
      Object.prototype.hasOwnProperty.call(operation, key),
    ) ||
    operation.action !== 'set-timing' ||
    typeof operation.viewerTimezone !== 'string' ||
    !isCalendarTimezoneSupported(operation.viewerTimezone) ||
    !isOccurrenceDateTime(operation.recurrenceId) ||
    !isOccurrenceTiming(operation.timing)
  ) {
    throw invalidOccurrenceTiming();
  }
}

function validateFollowingTimingPatchShape(patch: unknown): void {
  if (!isRecord(patch) || !isRecord(patch.recurrence)) {
    return;
  }
  const recurrence = patch.recurrence;
  if (!Object.prototype.hasOwnProperty.call(recurrence, 'following')) {
    return;
  }
  const operation = recurrence.following;
  if (
    Object.keys(patch).length !== 1 ||
    Object.keys(recurrence).length !== 1 ||
    !isRecord(operation) ||
    Object.keys(operation).length !== 4 ||
    !['action', 'recurrenceId', 'timing', 'viewerTimezone'].every((key) =>
      Object.prototype.hasOwnProperty.call(operation, key),
    ) ||
    operation.action !== 'set-timing' ||
    typeof operation.viewerTimezone !== 'string' ||
    !isCalendarTimezoneSupported(operation.viewerTimezone) ||
    !isOccurrenceDateTime(operation.recurrenceId) ||
    !isOccurrenceTiming(operation.timing) ||
    operation.timing.type !== 'end'
  ) {
    throw invalidFollowingTiming();
  }
}

function isOccurrenceDateTime(value: unknown): value is CalendarEventDateTime {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 2 ||
    !Object.prototype.hasOwnProperty.call(value, 'type')
  ) {
    return false;
  }
  if (value.type === 'date') {
    return (
      Object.prototype.hasOwnProperty.call(value, 'value') &&
      typeof value.value === 'string' &&
      isValidCalendarDate(value.value)
    );
  }
  if (value.type === 'floating-date-time') {
    return (
      Object.prototype.hasOwnProperty.call(value, 'value') &&
      typeof value.value === 'string' &&
      isValidLocalCalendarDateTime(value.value)
    );
  }
  if (value.type === 'date-time' && isRecord(value.value)) {
    return (
      Object.keys(value.value).length === 2 &&
      typeof value.value.local === 'string' &&
      isValidLocalCalendarDateTime(value.value.local) &&
      typeof value.value.timezone === 'string' &&
      value.value.timezone.trim().length > 0 &&
      (value.value.timezone === 'UTC' ||
        isCalendarTimezoneSupported(value.value.timezone))
    );
  }
  return false;
}

function isOccurrenceTiming(
  value: unknown,
): value is CalendarEventRecurrenceTiming {
  if (
    !isRecord(value) ||
    !Object.prototype.hasOwnProperty.call(value, 'type') ||
    typeof value.type !== 'string'
  ) {
    return false;
  }
  if (value.type === 'end') {
    return (
      Object.keys(value).length === 3 &&
      Object.prototype.hasOwnProperty.call(value, 'start') &&
      Object.prototype.hasOwnProperty.call(value, 'end') &&
      isOccurrenceDateTime(value.start) &&
      isOccurrenceDateTime(value.end) &&
      (value.start.type === 'date') === (value.end.type === 'date')
    );
  }
  if (value.type === 'duration') {
    return (
      Object.keys(value).length === 3 &&
      Object.prototype.hasOwnProperty.call(value, 'start') &&
      Object.prototype.hasOwnProperty.call(value, 'duration') &&
      isOccurrenceDateTime(value.start) &&
      value.start.type !== 'date' &&
      isPositiveRfcDuration(value.duration)
    );
  }
  return false;
}

function isPositiveRfcDuration(value: unknown): value is CalendarEventDuration {
  if (!isRecord(value)) {
    return false;
  }
  const units = ['weeks', 'days', 'hours', 'minutes', 'seconds'] as const;
  if (
    Object.keys(value).length !== units.length + 1 ||
    units.some(
      (unit) =>
        !Number.isSafeInteger(value[unit]) || (value[unit] as number) < 0,
    ) ||
    typeof value.isNegative !== 'boolean' ||
    value.isNegative ||
    !units.some((unit) => (value[unit] as number) > 0)
  ) {
    return false;
  }
  const hasWeeks = (value.weeks as number) > 0;
  const hasOtherUnits = units
    .slice(1)
    .some((unit) => (value[unit] as number) > 0);
  return !(hasWeeks && hasOtherUnits);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isValidCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = DateTime.fromISO(value, { zone: 'UTC' });
  return date.isValid && date.toISODate() === value;
}

function isValidLocalCalendarDateTime(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value)) {
    return false;
  }
  const dateTime = DateTime.fromISO(value, { zone: 'UTC' });
  return (
    dateTime.isValid && dateTime.toFormat("yyyy-MM-dd'T'HH:mm:ss") === value
  );
}

function invalidOccurrenceTiming(): CalendarRepositoryError {
  return new CalendarRepositoryError(
    'unsupported-patch',
    'The occurrence timing has an invalid type, time zone, or end before its start.',
  );
}

function invalidFollowingTiming(): CalendarRepositoryError {
  return new CalendarRepositoryError(
    'unsupported-patch',
    'This following timing edit cannot be applied safely to the current recurrence.',
  );
}

function recurrencePeriodIdentity(
  value: Extract<CalendarEventRecurrenceDate, { type: 'period' }>,
): string {
  return value.timing.type === 'end'
    ? `period:end:${calendarEventRecurrenceIdentity(value.timing.start)}:${calendarEventRecurrenceIdentity(value.timing.end)}`
    : `period:duration:${calendarEventRecurrenceIdentity(value.timing.start)}:${value.timing.duration.weeks}:${value.timing.duration.days}:${value.timing.duration.hours}:${value.timing.duration.minutes}:${value.timing.duration.seconds}:${value.timing.duration.isNegative}`;
}

function isSupportedRdateForReplacement(
  value: CalendarEventRecurrenceDate,
): boolean {
  if (value.type === 'period') {
    return isSupportedPeriodForReplacement(value);
  }
  return value.type !== 'date' && isSupportedPeriodDateTime(value);
}

function isSupportedPeriodForReplacement(
  value: Extract<CalendarEventRecurrenceDate, { type: 'period' }>,
): boolean {
  if (!isSupportedPeriodDateTime(value.timing.start)) {
    return false;
  }
  if (value.timing.type === 'duration') {
    return isPositiveRfcDuration(value.timing.duration);
  }
  return (
    samePeriodDateTimeIdentity(value.timing.start, value.timing.end) &&
    isSupportedPeriodDateTime(value.timing.end) &&
    periodEndIsAfterStart(value.timing.start, value.timing.end)
  );
}

function isSupportedPeriodDateTime(value: CalendarEventDateTime): boolean {
  if (value.type === 'date') {
    return false;
  }
  if (
    value.type === 'date-time' &&
    value.value.timezone !== 'UTC' &&
    !isCalendarTimezoneSupported(value.value.timezone)
  ) {
    return false;
  }
  const local = value.type === 'date-time' ? value.value.local : value.value;
  const zone = value.type === 'date-time' ? value.value.timezone : 'UTC';
  const dateTime = DateTime.fromISO(local, { zone });
  return (
    dateTime.isValid && dateTime.toFormat("yyyy-MM-dd'T'HH:mm:ss") === local
  );
}

function hasCompatiblePeriodReplacementIdentity(
  source: Extract<CalendarEventRecurrenceDate, { type: 'period' }>,
  replacement: Extract<CalendarEventRecurrenceDate, { type: 'period' }>,
): boolean {
  if (
    source.timing.type !== replacement.timing.type ||
    !samePeriodDateTimeIdentity(source.timing.start, replacement.timing.start)
  ) {
    return false;
  }
  return (
    source.timing.type !== 'end' ||
    (replacement.timing.type === 'end' &&
      samePeriodDateTimeIdentity(source.timing.end, replacement.timing.end))
  );
}

function samePeriodDateTimeIdentity(
  left: CalendarEventDateTime,
  right: CalendarEventDateTime,
): boolean {
  return (
    left.type === right.type &&
    (left.type !== 'date-time' ||
      (right.type === 'date-time' &&
        left.value.timezone === right.value.timezone))
  );
}

function periodEndIsAfterStart(
  start: CalendarEventDateTime,
  end: CalendarEventDateTime,
): boolean {
  if (start.type === 'date' || end.type === 'date') {
    return false;
  }
  const zone = start.type === 'date-time' ? start.value.timezone : 'UTC';
  const startLocal =
    start.type === 'date-time' ? start.value.local : start.value;
  const endLocal = end.type === 'date-time' ? end.value.local : end.value;
  const startDateTime = DateTime.fromISO(startLocal, { zone });
  const endDateTime = DateTime.fromISO(endLocal, { zone });
  return (
    startDateTime.isValid &&
    endDateTime.isValid &&
    endDateTime.toMillis() > startDateTime.toMillis()
  );
}
