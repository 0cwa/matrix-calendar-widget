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
  CalendarEventDateTime,
  CalendarEventDisplayAlarmEdit,
  CalendarEventId,
  CalendarEventInput,
  CalendarEventOccurrencePatch,
  CalendarEventPatch,
  CalendarEventRecurrenceOverride,
  CalendarEventTiming,
  CalendarId,
  CalendarMetadataPatch,
  CalendarTimeRange,
  TimedCalendarEventTiming,
} from '../model';
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

  async updateCalendarMetadata(
    calendarId: CalendarId,
    patch: CalendarMetadataPatch,
  ): Promise<void> {
    const calendar = this.getWritableCalendar(calendarId);
    const updated = { ...calendar };

    if (patch.description !== undefined) {
      if (patch.description === null) {
        delete updated.description;
      } else {
        updated.description = patch.description;
      }
    }

    if (patch.color !== undefined) {
      if (patch.color === null) {
        delete updated.color;
      } else {
        updated.color = patch.color;
      }
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
    const calendarEvents = this.events.get(calendar.id)!;
    const id = this.nextEventId(calendarEvents);

    const event: CalendarEvent = {
      ...cloneCalendarEventInput(input),
      id,
      calendarId,
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
    const clonedPatch = cloneCalendarEventPatch(patch);
    const displayAlarmEdits = clonedPatch.displayAlarmEdits;
    delete clonedPatch.displayAlarmEdits;

    const updated: CalendarEvent = {
      ...current,
      ...clonedPatch,
      ...(displayAlarmEdits
        ? {
            displayAlarms: applyDisplayAlarmEdits(
              current.displayAlarms ?? [],
              displayAlarmEdits,
            ),
          }
        : {}),
      id: current.id,
      calendarId: current.calendarId,
      uid: current.uid,
    };

    this.events.get(calendarId)!.set(eventId, updated);
    return cloneCalendarEvent(updated);
  }

  async updateOccurrence(
    calendarId: CalendarId,
    resourceEventId: CalendarEventId,
    recurrenceId: CalendarEventDateTime,
    patch: CalendarEventOccurrencePatch,
  ): Promise<CalendarEvent> {
    this.getWritableCalendar(calendarId);
    const current = this.getStoredEvent(calendarId, resourceEventId);
    const recurrence = cloneRecurrence(current.recurrence) ?? {};
    const overrides = recurrence.overrides ?? [];
    const matching = overrides
      .map((override, index) => ({ override, index }))
      .filter(({ override }) =>
        sameRecurrenceId(override.recurrenceId, recurrenceId),
      );

    if (matching.length > 1) {
      throw new CalendarRepositoryError(
        'request-failed',
        'Calendar resource contains duplicate recurrence overrides',
      );
    }

    const clonedPatch = cloneCalendarEventOccurrencePatch(patch);
    const { description, location, url, priority, ...directFields } =
      clonedPatch;
    const normalizedPatch: Partial<CalendarEventRecurrenceOverride> = {
      ...directFields,
      ...(description === undefined || description === null
        ? {}
        : { description }),
      ...(location === undefined || location === null ? {} : { location }),
      ...(url === undefined || url === null ? {} : { url }),
      ...(priority === undefined || priority === null ? {} : { priority }),
    };
    if (matching.length === 1) {
      const { index, override } = matching[0];
      const updatedOverride = { ...override, ...normalizedPatch };
      if (description === null) delete updatedOverride.description;
      if (location === null) delete updatedOverride.location;
      if (url === null) delete updatedOverride.url;
      if (priority === null) delete updatedOverride.priority;
      overrides[index] = updatedOverride;
    } else {
      overrides.push({
        recurrenceId: cloneCalendarEventDateTime(recurrenceId),
        ...normalizedPatch,
      });
    }

    const updated: CalendarEvent = {
      ...current,
      recurrence: { ...recurrence, overrides },
    };
    this.events.get(calendarId)!.set(resourceEventId, updated);
    return cloneCalendarEvent(updated);
  }

  async cancelOccurrence(
    calendarId: CalendarId,
    resourceEventId: CalendarEventId,
    recurrenceId: CalendarEventDateTime,
  ): Promise<CalendarEvent> {
    this.getWritableCalendar(calendarId);
    const current = this.getStoredEvent(calendarId, resourceEventId);
    const recurrence = cloneRecurrence(current.recurrence) ?? {};
    const overrides = recurrence.overrides ?? [];
    const matching = overrides
      .map((override, index) => ({ override, index }))
      .filter(({ override }) =>
        sameRecurrenceId(override.recurrenceId, recurrenceId),
      );

    if (matching.length > 1) {
      throw new CalendarRepositoryError(
        'request-failed',
        'Calendar resource contains duplicate recurrence overrides',
      );
    }

    if (matching.length === 1) {
      const { index, override } = matching[0];
      overrides[index] = { ...override, status: 'cancelled' };
    } else {
      overrides.push({
        recurrenceId: cloneCalendarEventDateTime(recurrenceId),
        status: 'cancelled',
      });
    }

    const updated: CalendarEvent = {
      ...current,
      recurrence: { ...recurrence, overrides },
    };
    this.events.get(calendarId)!.set(resourceEventId, updated);
    return cloneCalendarEvent(updated);
  }

  async updateFollowingOccurrence(
    calendarId: CalendarId,
    resourceEventId: CalendarEventId,
    recurrenceId: CalendarEventDateTime,
    timing: CalendarEventTiming,
  ): Promise<CalendarEvent> {
    this.getWritableCalendar(calendarId);
    const current = this.getStoredEvent(calendarId, resourceEventId);
    const recurrence = cloneRecurrence(current.recurrence) ?? {};
    const overrides = recurrence.overrides ?? [];
    const matching = overrides
      .map((override, index) => ({ override, index }))
      .filter(({ override }) =>
        sameRecurrenceId(override.recurrenceId, recurrenceId),
      );

    if (matching.length > 1) {
      throw new CalendarRepositoryError(
        'unsupported-recurrence-range',
        'Calendar resource contains duplicate overrides at this recurrence identity',
      );
    }

    if (matching[0]) {
      const { override, index } = matching[0];
      if (
        override.status ||
        override.title !== undefined ||
        override.description !== undefined ||
        override.transparency !== undefined ||
        override.location !== undefined ||
        override.url !== undefined ||
        override.categories !== undefined ||
        override.priority !== undefined
      ) {
        throw new CalendarRepositoryError(
          'unsupported-recurrence-range',
          'The existing exception has non-timing changes that cannot be applied to following instances',
        );
      }
      overrides[index] = {
        ...override,
        range: 'this-and-following',
        timing: cloneTiming(timing),
      };
    } else {
      overrides.push({
        recurrenceId: cloneCalendarEventDateTime(recurrenceId),
        range: 'this-and-following',
        timing: cloneTiming(timing),
      });
    }

    const updated: CalendarEvent = {
      ...current,
      recurrence: { ...recurrence, overrides },
    };
    this.events.get(calendarId)!.set(resourceEventId, updated);
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
  const recurrence = event.recurrence;
  if (
    recurrence?.rrule ||
    recurrence?.rdates?.length ||
    recurrence?.rdatePeriods?.length ||
    recurrence?.overrides?.length
  ) {
    return (
      interval.start < range.end ||
      Boolean(recurrence.rdates?.length) ||
      Boolean(recurrence.rdatePeriods?.length) ||
      recurrence.overrides?.some((override) =>
        override.timing
          ? timingIntersectsRange(override.timing, calendar, range)
          : false,
      ) === true
    );
  }

  return timingIntersectsRange(event.timing, calendar, range);
}

function eventInterval(event: CalendarEvent, calendar: Calendar): ParsedRange {
  return timingInterval(event.timing, calendar);
}

function timingIntersectsRange(
  timing: CalendarEvent['timing'],
  calendar: Calendar,
  range: ParsedRange,
): boolean {
  const interval = timingInterval(timing, calendar);
  return interval.start < range.end && interval.end > range.start;
}

function timingInterval(
  timing: CalendarEvent['timing'],
  calendar: Calendar,
): ParsedRange {
  if (timing.type === 'timed') {
    return timedInterval(timing, calendar);
  }

  const zone = calendar.timezone ?? 'UTC';
  const start = DateTime.fromISO(timing.startDate, { zone }).startOf('day');
  const end = DateTime.fromISO(timing.endDate, { zone }).startOf('day');

  return {
    start: start.toMillis(),
    end: end.toMillis(),
  };
}

function timedInterval(
  timing: TimedCalendarEventTiming,
  calendar: Calendar,
): ParsedRange {
  const startZone = dateTimeZone(timing.start, calendar);
  const endZone = dateTimeZone(timing.end, calendar);
  return {
    start: DateTime.fromISO(timing.start.local, { zone: startZone }).toMillis(),
    end: DateTime.fromISO(timing.end.local, { zone: endZone }).toMillis(),
  };
}

function dateTimeZone(
  value: TimedCalendarEventTiming['start'],
  calendar: Calendar,
): string {
  if (value.mode === 'utc' || (!value.mode && value.timezone === 'UTC')) {
    return 'UTC';
  }
  if (
    value.mode === 'floating' ||
    (!value.mode && value.timezone === 'floating')
  ) {
    return calendar.timezone ?? 'UTC';
  }
  return value.timezone;
}

function cloneCalendar(calendar: Calendar): Calendar {
  return { ...calendar };
}

function cloneCalendarEventDateTime(
  value: CalendarEventDateTime,
): CalendarEventDateTime {
  return value.type === 'date'
    ? { ...value }
    : { type: 'date-time', value: { ...value.value } };
}

function sameRecurrenceId(
  left: CalendarEventDateTime,
  right: CalendarEventDateTime,
): boolean {
  if (left.type !== right.type) {
    return false;
  }
  if (left.type === 'date' && right.type === 'date') {
    return left.value === right.value;
  }
  if (left.type !== 'date-time' || right.type !== 'date-time') {
    return false;
  }
  const mode = (value: CalendarEventDateTime & { type: 'date-time' }) =>
    value.value.mode ??
    (value.value.timezone === 'UTC'
      ? 'utc'
      : value.value.timezone === 'floating'
        ? 'floating'
        : 'tzid');
  return (
    left.value.local === right.value.local &&
    left.value.timezone === right.value.timezone &&
    mode(left) === mode(right)
  );
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

function cloneTiming(timing: CalendarEventTiming): CalendarEventTiming {
  return timing.type === 'timed'
    ? cloneTimedTiming(timing)
    : cloneAllDayTiming(timing);
}

function cloneCalendarEvent(event: CalendarEvent): CalendarEvent {
  return {
    ...event,
    timing:
      event.timing.type === 'timed'
        ? cloneTimedTiming(event.timing)
        : cloneAllDayTiming(event.timing),
    categories: event.categories ? [...event.categories] : undefined,
    displayAlarms: event.displayAlarms?.map((alarm) => ({ ...alarm })),
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
    recurrence: cloneRecurrence(input.recurrence),
  };
}

function cloneRecurrence(
  recurrence: CalendarEvent['recurrence'],
): CalendarEvent['recurrence'] {
  return recurrence
    ? {
        ...recurrence,
        rdates: recurrence.rdates?.map(cloneCalendarEventDateTime),
        rdatePeriods: recurrence.rdatePeriods?.map((period) => ({
          ...period,
          start: {
            type: 'date-time',
            value: { ...period.start.value },
          },
          end: period.end
            ? { type: 'date-time', value: { ...period.end.value } }
            : undefined,
        })),
        exdates: recurrence.exdates?.map(cloneCalendarEventDateTime),
        recurrenceId: recurrence.recurrenceId
          ? cloneCalendarEventDateTime(recurrence.recurrenceId)
          : undefined,
        overrides: recurrence.overrides?.map((override) => ({
          ...override,
          recurrenceId: cloneCalendarEventDateTime(override.recurrenceId),
          timing: override.timing
            ? override.timing.type === 'timed'
              ? cloneTimedTiming(override.timing)
              : cloneAllDayTiming(override.timing)
            : undefined,
          categories: override.categories
            ? [...override.categories]
            : undefined,
        })),
      }
    : undefined;
}

function cloneCalendarEventPatch(
  patch: CalendarEventPatch,
): CalendarEventPatch {
  const cloned: CalendarEventPatch = { ...patch };

  if (patch.displayAlarmEdits) {
    cloned.displayAlarmEdits = patch.displayAlarmEdits.map((edit) => ({
      ...edit,
    }));
  }

  if (patch.timing) {
    cloned.timing =
      patch.timing.type === 'timed'
        ? cloneTimedTiming(patch.timing)
        : cloneAllDayTiming(patch.timing);
  }

  if (patch.categories) {
    cloned.categories = [...patch.categories];
  }

  if (patch.recurrence) {
    cloned.recurrence = cloneRecurrence(patch.recurrence);
  }

  return cloned;
}

function applyDisplayAlarmEdits(
  alarms: NonNullable<CalendarEvent['displayAlarms']>,
  edits: CalendarEventDisplayAlarmEdit[],
): NonNullable<CalendarEvent['displayAlarms']> {
  const byIndex = new Map(edits.map((edit) => [edit.index, edit]));
  if (byIndex.size !== edits.length) {
    throw new CalendarRepositoryError(
      'request-failed',
      'A DISPLAY alarm can only be edited once per patch',
    );
  }

  for (const [index, edit] of byIndex) {
    const alarm = alarms.find((candidate) => candidate.index === index);
    if (!alarm) {
      throw new CalendarRepositoryError(
        'request-failed',
        'Only an existing DISPLAY alarm can be edited',
      );
    }
    if (
      (edit.triggerMinutes !== undefined && !alarm.triggerEditable) ||
      (edit.triggerMinutes !== undefined &&
        (!Number.isSafeInteger(edit.triggerMinutes) ||
          !Number.isSafeInteger(edit.triggerMinutes * 60))) ||
      (edit.description !== undefined &&
        typeof edit.description !== 'string') ||
      (edit.triggerMinutes === undefined && edit.description === undefined)
    ) {
      throw new CalendarRepositoryError(
        'request-failed',
        'The DISPLAY alarm edit is not supported',
      );
    }
  }

  return alarms.map((alarm) => {
    const edit = byIndex.get(alarm.index);
    return edit
      ? {
          ...alarm,
          ...(edit.triggerMinutes !== undefined
            ? { triggerMinutes: edit.triggerMinutes }
            : {}),
          ...(edit.description !== undefined
            ? { description: edit.description }
            : {}),
        }
      : { ...alarm };
  });
}

function cloneCalendarEventOccurrencePatch(
  patch: CalendarEventOccurrencePatch,
): CalendarEventOccurrencePatch {
  const cloned = { ...patch };
  if (patch.timing) {
    cloned.timing =
      patch.timing.type === 'timed'
        ? cloneTimedTiming(patch.timing)
        : cloneAllDayTiming(patch.timing);
  }
  if (patch.categories) {
    cloned.categories = [...patch.categories];
  }
  return cloned;
}
