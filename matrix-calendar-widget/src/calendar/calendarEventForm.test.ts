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

import { Calendar, CalendarEvent } from '@matrix-calendar-widget/calendar';
import { DateTime } from 'luxon';
import {
  calendarEventInputFromForm,
  calendarEventPatchFromForm,
  calendarEventToFormValues,
  createCalendarEventFormValues,
  validateCalendarEventForm,
} from './calendarEventForm';

const calendar: Calendar = {
  id: 'team',
  name: 'Team calendar',
  timezone: 'Europe/Stockholm',
};

describe('calendar event form adapter', () => {
  it('creates default timed values in the calendar timezone', () => {
    const values = createCalendarEventFormValues(
      calendar,
      DateTime.fromISO('2026-09-23T09:37:00', {
        zone: 'Europe/Stockholm',
      }),
    );

    expect(values).toEqual({
      calendarId: 'team',
      title: '',
      description: '',
      location: '',
      timingType: 'timed',
      start: '2026-09-23T09:00',
      end: '2026-09-23T10:00',
      timezone: 'Europe/Stockholm',
      timedKind: 'zoned',
      timingChanged: false,
      timezoneChanged: false,
      repeats: false,
      recurrenceFrequency: 'DAILY',
      recurrenceInterval: '1',
      recurrenceEnd: 'never',
      recurrenceCount: '2',
      recurrenceUntil: '2026-09-23',
      recurrenceEditable: true,
      recurrenceChanged: false,
    });
  });

  it('converts timed form values into domain input', () => {
    expect(
      calendarEventInputFromForm(
        {
          calendarId: 'team',
          title: '  Planning  ',
          description: '  Discuss the quarter.  ',
          location: '  Room 3  ',
          timingType: 'timed',
          start: '2026-09-23T09:00',
          end: '2026-09-23T10:00',
          timezone: 'Europe/Stockholm',
        },
        'uid@example.test',
      ),
    ).toEqual({
      uid: 'uid@example.test',
      title: 'Planning',
      description: 'Discuss the quarter.',
      location: 'Room 3',
      timing: {
        type: 'timed',
        start: {
          type: 'zoned',
          local: '2026-09-23T09:00',
          timezone: 'Europe/Stockholm',
        },
        end: {
          type: 'zoned',
          local: '2026-09-23T10:00',
          timezone: 'Europe/Stockholm',
        },
      },
    });
  });

  it('maps inclusive all-day form end dates to exclusive domain end dates', () => {
    expect(
      calendarEventInputFromForm(
        {
          calendarId: 'team',
          title: 'Conference',
          description: '',
          location: '',
          timingType: 'all-day',
          start: '2026-10-05',
          end: '2026-10-07',
          timezone: 'Europe/Stockholm',
        },
        'all-day@example.test',
      ).timing,
    ).toEqual({
      type: 'all-day',
      startDate: '2026-10-05',
      endDate: '2026-10-08',
    });
  });

  it('maps exclusive all-day domain end dates back to inclusive form values', () => {
    const event: CalendarEvent = {
      id: 'conference',
      calendarId: 'team',
      uid: 'conference@example.test',
      title: 'Conference',
      timing: {
        type: 'all-day',
        startDate: '2026-10-05',
        endDate: '2026-10-08',
      },
    };

    expect(calendarEventToFormValues(event, calendar)).toMatchObject({
      timingType: 'all-day',
      start: '2026-10-05',
      end: '2026-10-07',
    });
  });

  it('keeps floating event times local through form validation and timing updates', () => {
    const event: CalendarEvent = {
      id: 'floating',
      calendarId: 'team',
      uid: 'floating@example.test',
      title: 'Floating event',
      timing: {
        type: 'timed',
        start: { type: 'floating', local: '2026-09-23T09:00:00' },
        end: { type: 'floating', local: '2026-09-23T10:00:00' },
      },
    };
    const values = calendarEventToFormValues(event, calendar);

    expect(values).toMatchObject({
      timingType: 'timed',
      timedKind: 'floating',
      start: '2026-09-23T09:00',
      end: '2026-09-23T10:00',
      timingChanged: false,
    });
    expect(
      validateCalendarEventForm({ ...values, timezone: 'not-an-iana-zone' }),
    ).toBeUndefined();
    expect(
      calendarEventPatchFromForm({ ...values, title: 'Renamed' }),
    ).not.toHaveProperty('timing');

    const timingPatch = calendarEventPatchFromForm({
      ...values,
      start: '2026-09-23T11:30',
      end: '2026-09-23T12:15',
      timingChanged: true,
    });

    expect(timingPatch.timing).toEqual({
      type: 'timed',
      start: { type: 'floating', local: '2026-09-23T11:30' },
      end: { type: 'floating', local: '2026-09-23T12:15' },
    });
  });

  it('keeps each endpoint kind when editing a mixed floating and zoned event', () => {
    const event: CalendarEvent = {
      id: 'mixed',
      calendarId: 'team',
      uid: 'mixed@example.test',
      title: 'Mixed event',
      timing: {
        type: 'timed',
        start: { type: 'floating', local: '2026-09-23T09:00:00' },
        end: {
          type: 'zoned',
          local: '2026-09-23T10:00:00',
          timezone: 'Europe/Stockholm',
        },
      },
    };
    const values = calendarEventToFormValues(event, calendar);

    expect(values.timedKind).toBe('mixed');
    expect(
      calendarEventPatchFromForm({
        ...values,
        start: '2026-09-23T09:30',
        end: '2026-09-23T10:30',
        timingChanged: true,
      }).timing,
    ).toEqual({
      type: 'timed',
      start: { type: 'floating', local: '2026-09-23T09:30' },
      end: {
        type: 'zoned',
        local: '2026-09-23T10:30',
        timezone: 'Europe/Stockholm',
      },
    });
  });

  it('validates and preserves distinct endpoint time zones', () => {
    const event: CalendarEvent = {
      id: 'two-zones',
      calendarId: 'team',
      uid: 'two-zones@example.test',
      title: 'Two zones',
      timing: {
        type: 'timed',
        start: {
          type: 'zoned',
          local: '2026-09-23T10:00:00',
          timezone: 'Europe/Stockholm',
        },
        end: {
          type: 'zoned',
          local: '2026-09-23T05:30:00',
          timezone: 'America/New_York',
        },
      },
    };
    const values = calendarEventToFormValues(event, calendar);

    expect(values.timedKind).toBe('mixed');
    expect(validateCalendarEventForm(values)).toBeUndefined();
    expect(
      calendarEventPatchFromForm({
        ...values,
        title: 'Renamed two-zone event',
      }),
    ).not.toHaveProperty('timing');
    expect(
      calendarEventPatchFromForm({
        ...values,
        start: '2026-09-23T10:15',
        end: '2026-09-23T05:45',
        timingChanged: true,
      }).timing,
    ).toEqual({
      type: 'timed',
      start: {
        type: 'zoned',
        local: '2026-09-23T10:15',
        timezone: 'Europe/Stockholm',
      },
      end: {
        type: 'zoned',
        local: '2026-09-23T05:45',
        timezone: 'America/New_York',
      },
    });
  });

  it('creates an edit patch without resource identity or UID', () => {
    expect(
      calendarEventPatchFromForm({
        calendarId: 'team',
        title: 'Updated',
        description: ' ',
        location: '',
        timingType: 'timed',
        start: '2026-09-23T11:00',
        end: '2026-09-23T12:00',
        timezone: 'Europe/Stockholm',
      }),
    ).toEqual({
      title: 'Updated',
      description: undefined,
      location: undefined,
      timing: {
        type: 'timed',
        start: {
          type: 'zoned',
          local: '2026-09-23T11:00',
          timezone: 'Europe/Stockholm',
        },
        end: {
          type: 'zoned',
          local: '2026-09-23T12:00',
          timezone: 'Europe/Stockholm',
        },
      },
    });
  });

  it('loads and edits only the simple master RRULE', () => {
    const recurringEvent: CalendarEvent = {
      id: 'series',
      calendarId: 'team',
      uid: 'series@example.test',
      title: 'Weekly planning',
      timing: {
        type: 'timed',
        start: {
          type: 'zoned',
          local: '2026-09-23T09:00:00',
          timezone: 'Europe/Stockholm',
        },
        end: {
          type: 'zoned',
          local: '2026-09-23T10:00:00',
          timezone: 'Europe/Stockholm',
        },
      },
      recurrence: { rrule: 'FREQ=WEEKLY;INTERVAL=2;COUNT=8' },
    };
    const values = calendarEventToFormValues(recurringEvent, calendar);

    expect(values).toMatchObject({
      repeats: true,
      recurrenceFrequency: 'WEEKLY',
      recurrenceInterval: '2',
      recurrenceEnd: 'count',
      recurrenceCount: '8',
      recurrenceEditable: true,
    });
    expect(
      calendarEventPatchFromForm({ ...values, title: 'Renamed series' }),
    ).not.toHaveProperty('recurrence');
    expect(
      calendarEventPatchFromForm({
        ...values,
        recurrenceFrequency: 'MONTHLY',
        recurrenceChanged: true,
      }).recurrence,
    ).toEqual({ rrule: 'FREQ=MONTHLY;INTERVAL=2;COUNT=8' });
    expect(
      calendarEventPatchFromForm({
        ...values,
        repeats: false,
        recurrenceChanged: true,
      }).recurrence,
    ).toEqual({});
  });

  it('keeps complex recurrence controls disabled and preserves the source data', () => {
    const complexEvent: CalendarEvent = {
      id: 'complex',
      calendarId: 'team',
      uid: 'complex@example.test',
      title: 'Complex series',
      timing: {
        type: 'all-day',
        startDate: '2026-10-05',
        endDate: '2026-10-06',
      },
      recurrence: {
        rrule: 'FREQ=DAILY;COUNT=3',
        rdates: [{ type: 'date', value: '2026-10-09' }],
      },
    };
    const values = calendarEventToFormValues(complexEvent, calendar);

    expect(values.recurrenceEditable).toBe(false);
    expect(values.recurrenceDisabledReason).toBe('complex');
    expect(
      calendarEventPatchFromForm({
        ...values,
        title: 'Renamed complex series',
      }),
    ).not.toHaveProperty('recurrence');
  });

  it('writes the UNTIL value in the event start value kind', () => {
    const base = createCalendarEventFormValues(
      calendar,
      DateTime.fromISO('2026-10-25T09:00:00', { zone: 'Europe/Stockholm' }),
    );
    const untilValues = {
      ...base,
      repeats: true,
      recurrenceEnd: 'until' as const,
      recurrenceUntil: '2026-10-25',
    };

    expect(
      calendarEventInputFromForm(untilValues, 'zoned@example.test').recurrence,
    ).toEqual({ rrule: 'FREQ=DAILY;UNTIL=20261025T225959Z' });
    expect(
      calendarEventInputFromForm(
        {
          ...untilValues,
          timedKind: 'floating',
        },
        'floating@example.test',
      ).recurrence,
    ).toEqual({ rrule: 'FREQ=DAILY;UNTIL=20261025T235959' });
    expect(
      calendarEventInputFromForm(
        {
          ...untilValues,
          timingType: 'all-day',
          start: '2026-10-25',
          end: '2026-10-25',
        },
        'date@example.test',
      ).recurrence,
    ).toEqual({ rrule: 'FREQ=DAILY;UNTIL=20261025' });
  });

  it('displays a zoned UTC UNTIL date in the DTSTART timezone without patching it', () => {
    const event: CalendarEvent = {
      id: 'negative-offset-series',
      calendarId: 'team',
      uid: 'negative-offset@example.test',
      title: 'Los Angeles series',
      timing: {
        type: 'timed',
        start: {
          type: 'zoned',
          local: '2026-10-25T09:00:00',
          timezone: 'America/Los_Angeles',
        },
        end: {
          type: 'zoned',
          local: '2026-10-25T10:00:00',
          timezone: 'America/Los_Angeles',
        },
      },
      recurrence: { rrule: 'FREQ=DAILY;UNTIL=20261026T065959Z' },
    };
    const values = calendarEventToFormValues(event, calendar);

    expect(values.recurrenceUntil).toBe('2026-10-25');
    expect(values.recurrenceChanged).toBe(false);
    expect(
      calendarEventPatchFromForm({ ...values, title: 'Renamed' }),
    ).not.toHaveProperty('recurrence');
  });
});
