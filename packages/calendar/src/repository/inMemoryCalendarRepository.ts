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
  CalendarEventId,
  CalendarEventInput,
  CalendarEventPatch,
  CalendarId,
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

    const updated: CalendarEvent = {
      ...current,
      ...cloneCalendarEventPatch(patch),
      id: current.id,
      calendarId: current.calendarId,
      uid: current.uid,
    };

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
    start: DateTime.fromISO(timing.start.local, {
      zone: timing.start.timezone,
    }).toMillis(),
    end: DateTime.fromISO(timing.end.local, {
      zone: timing.end.timezone,
    }).toMillis(),
  };
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
    timing:
      event.timing.type === 'timed'
        ? cloneTimedTiming(event.timing)
        : cloneAllDayTiming(event.timing),
    categories: event.categories ? [...event.categories] : undefined,
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
        exdates: recurrence.exdates?.map(cloneCalendarEventDateTime),
        recurrenceId: recurrence.recurrenceId
          ? cloneCalendarEventDateTime(recurrence.recurrenceId)
          : undefined,
      }
    : undefined;
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

  if (patch.recurrence) {
    cloned.recurrence = cloneRecurrence(patch.recurrence);
  }

  return cloned;
}
