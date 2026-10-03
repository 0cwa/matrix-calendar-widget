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
  calendarEventRdateValueFromForm,
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
      alarmEnabled: false,
      alarmWeeks: '0',
      alarmDays: '0',
      alarmHours: '0',
      alarmMinutes: '15',
      alarmSeconds: '0',
      alarmEditable: true,
      alarmChanged: false,
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

  it('keeps alarm data unchanged on ordinary edits and emits explicit alarm writes', () => {
    const event: CalendarEvent = {
      id: 'alarm',
      calendarId: 'team',
      uid: 'alarm@example.test',
      title: 'Alarm event',
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
      alarm: {
        action: 'display',
        trigger: { weeks: 0, days: 1, hours: 2, minutes: 30, seconds: 0 },
      },
    };
    const values = calendarEventToFormValues(event, calendar);

    expect(values).toMatchObject({
      alarmEnabled: true,
      alarmWeeks: '0',
      alarmDays: '1',
      alarmHours: '2',
      alarmMinutes: '30',
      alarmSeconds: '0',
      alarmEditable: true,
      alarmChanged: false,
    });
    expect(
      calendarEventPatchFromForm({ ...values, title: 'Renamed' }),
    ).not.toHaveProperty('alarm');

    expect(
      calendarEventPatchFromForm({
        ...values,
        alarmMinutes: '45',
        alarmChanged: true,
      }).alarm,
    ).toEqual({
      action: 'display',
      trigger: { weeks: 0, days: 1, hours: 2, minutes: 45, seconds: 0 },
    });
    expect(
      calendarEventPatchFromForm({
        ...values,
        alarmEnabled: false,
        alarmChanged: true,
      }),
    ).toHaveProperty('alarm', { operation: 'remove' });
  });

  it('keeps unsupported alarms opaque and validates positive lead times', () => {
    const event: CalendarEvent = {
      id: 'opaque-alarm',
      calendarId: 'team',
      uid: 'opaque-alarm@example.test',
      title: 'Opaque alarm event',
      timing: {
        type: 'timed',
        start: { type: 'floating', local: '2026-09-23T09:00:00' },
        end: { type: 'floating', local: '2026-09-23T10:00:00' },
      },
      unsupportedAlarm: true,
    };
    const values = calendarEventToFormValues(event, calendar);
    expect(values).toMatchObject({
      alarmEnabled: false,
      alarmEditable: false,
      alarmDisabledReason: 'unsupported',
      alarmChanged: false,
    });
    expect(
      calendarEventPatchFromForm({ ...values, title: 'Renamed' }),
    ).not.toHaveProperty('alarm');

    const valid = createCalendarEventFormValues(
      calendar,
      DateTime.fromISO('2026-09-23T09:00:00', {
        zone: 'Europe/Stockholm',
      }),
    );
    expect(
      validateCalendarEventForm({
        ...valid,
        title: 'Alarm',
        alarmEnabled: true,
      }),
    ).toBeUndefined();
    expect(
      validateCalendarEventForm({
        ...valid,
        title: 'Alarm',
        alarmEnabled: true,
        alarmMinutes: '0',
      }),
    ).toBe('invalid-alarm');
    expect(
      validateCalendarEventForm({
        ...valid,
        title: 'Alarm',
        alarmEnabled: true,
        alarmWeeks: '1',
        alarmDays: '1',
      }),
    ).toBe('invalid-alarm');
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

  it('loads, edits, and preserves the constrained weekly BYDAY rule', () => {
    const weeklyEvent: CalendarEvent = {
      id: 'weekly-days',
      calendarId: 'team',
      uid: 'weekly-days@example.test',
      title: 'Planning',
      timing: {
        type: 'timed',
        start: {
          type: 'zoned',
          local: '2026-10-26T09:00:00',
          timezone: 'Europe/Stockholm',
        },
        end: {
          type: 'zoned',
          local: '2026-10-26T10:00:00',
          timezone: 'Europe/Stockholm',
        },
      },
      recurrence: { rrule: 'FREQ=WEEKLY;BYDAY=MO,WE' },
    };
    const values = calendarEventToFormValues(weeklyEvent, calendar);

    expect(values).toMatchObject({
      recurrenceFrequency: 'WEEKLY',
      recurrenceInterval: '1',
      recurrenceEnd: 'never',
      recurrenceWeekdays: ['MO', 'WE'],
      recurrenceEditable: true,
    });
    expect(
      calendarEventPatchFromForm({ ...values, title: 'Renamed' }),
    ).not.toHaveProperty('recurrence');
    expect(
      calendarEventPatchFromForm({
        ...values,
        recurrenceWeekdays: ['MO', 'WE', 'FR'],
        recurrenceChanged: true,
      }).recurrence,
    ).toEqual({ rrule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR' });
  });

  it('loads and edits the open-ended every-other-week BYDAY subset', () => {
    const biweeklyEvent: CalendarEvent = {
      id: 'biweekly-days',
      calendarId: 'team',
      uid: 'biweekly-days@example.test',
      title: 'Planning',
      timing: {
        type: 'timed',
        start: {
          type: 'zoned',
          local: '2026-10-26T09:00:00',
          timezone: 'Europe/Stockholm',
        },
        end: {
          type: 'zoned',
          local: '2026-10-26T10:00:00',
          timezone: 'Europe/Stockholm',
        },
      },
      recurrence: { rrule: 'FREQ=WEEKLY;BYDAY=WE,MO;INTERVAL=2' },
    };
    const values = calendarEventToFormValues(biweeklyEvent, calendar);

    expect(values).toMatchObject({
      recurrenceFrequency: 'WEEKLY',
      recurrenceInterval: '2',
      recurrenceEnd: 'never',
      recurrenceWeekdays: ['MO', 'WE'],
      recurrenceEditable: true,
    });
    expect(
      calendarEventPatchFromForm({
        ...values,
        recurrenceWeekdays: ['MO', 'WE', 'FR'],
        recurrenceChanged: true,
      }).recurrence,
    ).toEqual({ rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR' });
  });

  it('adds a new DTSTART weekday when editing a weekly BYDAY series start', () => {
    const weeklyEvent: CalendarEvent = {
      id: 'weekly-days',
      calendarId: 'team',
      uid: 'weekly-days@example.test',
      title: 'Planning',
      timing: {
        type: 'timed',
        start: {
          type: 'zoned',
          local: '2026-10-26T09:00:00',
          timezone: 'Europe/Stockholm',
        },
        end: {
          type: 'zoned',
          local: '2026-10-26T10:00:00',
          timezone: 'Europe/Stockholm',
        },
      },
      recurrence: { rrule: 'FREQ=WEEKLY;BYDAY=MO,WE' },
    };
    const values = calendarEventToFormValues(weeklyEvent, calendar);

    expect(
      calendarEventPatchFromForm({
        ...values,
        start: '2026-10-30T09:00',
        end: '2026-10-30T10:00',
        timingChanged: true,
      }).recurrence,
    ).toEqual({ rrule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR' });
  });

  it('keeps unsupported weekly BYDAY rules read-only and out of unrelated patches', () => {
    const unsupportedEvent: CalendarEvent = {
      id: 'unsupported-weekly',
      calendarId: 'team',
      uid: 'unsupported-weekly@example.test',
      title: 'Planning',
      timing: {
        type: 'all-day',
        startDate: '2026-10-26',
        endDate: '2026-10-27',
      },
      recurrence: { rrule: 'FREQ=WEEKLY;BYDAY=MO,WE;INTERVAL=3' },
    };
    const values = calendarEventToFormValues(unsupportedEvent, calendar);

    expect(values.recurrenceEditable).toBe(false);
    expect(values.recurrenceDisabledReason).toBe('unsupported');
    expect(
      calendarEventPatchFromForm({ ...values, title: 'Renamed' }),
    ).not.toHaveProperty('recurrence');
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

  it('serializes one typed point RDATE operation for the widget patch', () => {
    const rdateEvent: CalendarEvent = {
      id: 'rdate-series',
      calendarId: 'team',
      uid: 'rdate-series@example.test',
      title: 'RDATE series',
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
      recurrence: {
        rrule: 'FREQ=WEEKLY;COUNT=4',
        rdates: [
          {
            type: 'date-time',
            value: {
              local: '2026-10-30T09:00:00',
              timezone: 'America/New_York',
            },
          },
          {
            type: 'period',
            timing: {
              type: 'duration',
              start: {
                type: 'date-time',
                value: {
                  local: '2026-11-01T09:00:00',
                  timezone: 'Europe/Stockholm',
                },
              },
              duration: {
                weeks: 0,
                days: 0,
                hours: 1,
                minutes: 0,
                seconds: 0,
                isNegative: false,
              },
            },
          },
        ],
      },
    };
    const values = calendarEventToFormValues(rdateEvent, calendar);
    const addValue = calendarEventRdateValueFromForm(values);

    expect(values.rdateValues).toEqual([
      {
        type: 'date-time',
        value: {
          local: '2026-10-30T09:00:00',
          timezone: 'America/New_York',
        },
      },
      {
        type: 'period',
        timing: {
          type: 'duration',
          start: {
            type: 'date-time',
            value: {
              local: '2026-11-01T09:00:00',
              timezone: 'Europe/Stockholm',
            },
          },
          duration: {
            weeks: 0,
            days: 0,
            hours: 1,
            minutes: 0,
            seconds: 0,
            isNegative: false,
          },
        },
      },
    ]);
    expect(addValue).toEqual({
      type: 'date-time',
      value: {
        local: '2026-09-23T09:00:00',
        timezone: 'Europe/Stockholm',
      },
    });
    expect(
      calendarEventPatchFromForm({
        ...values,
        rdateChanged: true,
        rdateOperation: { action: 'add', value: addValue! },
      }).recurrence,
    ).toEqual({
      rdate: {
        action: 'add',
        value: {
          type: 'date-time',
          value: {
            local: '2026-09-23T09:00:00',
            timezone: 'Europe/Stockholm',
          },
        },
      },
    });
    expect(
      validateCalendarEventForm({
        ...values,
        title: 'RDATE',
        rdateChanged: true,
        rdateOperation: { action: 'add', value: addValue! },
      }),
    ).toBeUndefined();
    expect(
      validateCalendarEventForm({
        ...values,
        title: 'RDATE',
        rdateChanged: true,
        rdateOperation: { action: 'add', value: addValue! },
        recurrenceChanged: true,
      }),
    ).toBe('invalid-recurrence');
  });

  it('serializes removal of one existing EXDATE with its exact value form', () => {
    const exdates = [
      { type: 'date' as const, value: '2026-10-01' },
      { type: 'floating-date-time' as const, value: '2026-10-02T09:00:00' },
      {
        type: 'date-time' as const,
        value: { local: '2026-10-03T09:00:00', timezone: 'Europe/Stockholm' },
      },
    ];
    const exdateEvent: CalendarEvent = {
      id: 'exdate-series',
      calendarId: 'team',
      uid: 'exdate-series@example.test',
      title: 'EXDATE series',
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
      recurrence: { rrule: 'FREQ=WEEKLY;COUNT=4', exdates },
    };
    const values = calendarEventToFormValues(exdateEvent, calendar);

    expect(values.exdateEditable).toBe(true);
    expect(values.exdateValues).toEqual(exdates);
    expect(
      calendarEventPatchFromForm({
        ...values,
        exdateChanged: true,
        exdateOperation: { action: 'remove', recurrenceId: exdates[2]! },
      }).recurrence,
    ).toEqual({
      exdate: { action: 'remove', recurrenceId: exdates[2] },
    });
    expect(
      validateCalendarEventForm({
        ...values,
        title: 'EXDATE series',
        exdateChanged: true,
        exdateOperation: { action: 'remove', recurrenceId: exdates[2]! },
      }),
    ).toBeUndefined();
  });

  it('rejects conflicting all-day EXDATE removal changes', () => {
    const exdate = { type: 'date' as const, value: '2026-10-01' };
    const event: CalendarEvent = {
      id: 'all-day-exdate-series',
      calendarId: 'team',
      uid: 'all-day-exdate-series@example.test',
      title: 'All-day EXDATE series',
      timing: {
        type: 'all-day',
        startDate: '2026-09-23',
        endDate: '2026-09-24',
      },
      recurrence: { rrule: 'FREQ=DAILY;COUNT=4', exdates: [exdate] },
    };
    const values = calendarEventToFormValues(event, calendar);
    const removal = {
      ...values,
      exdateChanged: true,
      exdateOperation: { action: 'remove' as const, recurrenceId: exdate },
    };

    expect(
      validateCalendarEventForm({ ...removal, title: 'All-day EXDATE series' }),
    ).toBeUndefined();
    expect(
      calendarEventPatchFromForm({ ...removal, title: 'All-day EXDATE series' })
        .recurrence,
    ).toEqual({ exdate: { action: 'remove', recurrenceId: exdate } });
    expect(
      validateCalendarEventForm({
        ...removal,
        title: 'All-day EXDATE series',
        recurrenceChanged: true,
      }),
    ).toBe('invalid-recurrence');
    expect(
      validateCalendarEventForm({
        ...removal,
        title: 'All-day EXDATE series',
        timingChanged: true,
      }),
    ).toBe('invalid-recurrence');
    expect(
      validateCalendarEventForm({
        ...removal,
        title: 'All-day EXDATE series',
        rdateChanged: true,
        rdateOperation: {
          action: 'remove',
          value: { type: 'date', value: '2026-10-02' },
        },
      }),
    ).toBe('invalid-recurrence');
  });

  it('serializes removal of an exact PERIOD RDATE', () => {
    const period = {
      type: 'period' as const,
      timing: {
        type: 'end' as const,
        start: {
          type: 'date-time' as const,
          value: { local: '2026-11-01T09:00:00', timezone: 'Europe/Stockholm' },
        },
        end: {
          type: 'date-time' as const,
          value: { local: '2026-11-01T10:00:00', timezone: 'Europe/Stockholm' },
        },
      },
    };
    const periodEvent: CalendarEvent = {
      id: 'period-rdate-series',
      calendarId: 'team',
      uid: 'period-rdate-series@example.test',
      title: 'Period RDATE series',
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
      recurrence: { rrule: 'FREQ=WEEKLY;COUNT=4', rdates: [period] },
    };
    const values = calendarEventToFormValues(periodEvent, calendar);
    expect(values.rdateValues).toEqual([period]);
    expect(
      calendarEventPatchFromForm({
        ...values,
        rdateChanged: true,
        rdateOperation: { action: 'remove-period', value: period },
      }).recurrence,
    ).toEqual({ rdate: { action: 'remove-period', value: period } });
  });

  it('builds DATE and floating RDATE values in DTSTART form', () => {
    const allDayEvent: CalendarEvent = {
      id: 'all-day-rdate',
      calendarId: 'team',
      uid: 'all-day-rdate@example.test',
      title: 'All-day series',
      timing: {
        type: 'all-day',
        startDate: '2026-10-05',
        endDate: '2026-10-06',
      },
      recurrence: { rrule: 'FREQ=WEEKLY;COUNT=3' },
    };
    const floatingEvent: CalendarEvent = {
      id: 'floating-rdate',
      calendarId: 'team',
      uid: 'floating-rdate@example.test',
      title: 'Floating series',
      timing: {
        type: 'timed',
        start: { type: 'floating', local: '2026-10-05T09:00:00' },
        end: { type: 'floating', local: '2026-10-05T10:00:00' },
      },
      recurrence: { rrule: 'FREQ=WEEKLY;COUNT=3' },
    };

    expect(
      calendarEventRdateValueFromForm(
        calendarEventToFormValues(allDayEvent, calendar),
      ),
    ).toEqual({ type: 'date', value: '2026-10-05' });
    expect(
      calendarEventRdateValueFromForm(
        calendarEventToFormValues(floatingEvent, calendar),
      ),
    ).toEqual({
      type: 'floating-date-time',
      value: '2026-10-05T09:00:00',
    });
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

  it('reconciles an inclusive DATE UNTIL when DTSTART becomes timed', () => {
    const event: CalendarEvent = {
      id: 'all-day-series',
      calendarId: 'team',
      uid: 'all-day@example.test',
      title: 'All-day series',
      timing: {
        type: 'all-day',
        startDate: '2026-10-25',
        endDate: '2026-10-26',
      },
      recurrence: { rrule: 'FREQ=DAILY;UNTIL=20261025' },
    };
    const values = calendarEventToFormValues(event, calendar);
    const patch = calendarEventPatchFromForm({
      ...values,
      timingType: 'timed',
      start: '2026-10-25T09:00',
      end: '2026-10-25T10:00',
      timingChanged: true,
    });

    expect(patch.timing?.type).toBe('timed');
    expect(patch.recurrence).toEqual({
      rrule: 'FREQ=DAILY;UNTIL=20261025T225959Z',
    });
  });

  it('reconciles negative-offset zoned UNTIL to DATE and a new zone', () => {
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

    const datePatch = calendarEventPatchFromForm({
      ...values,
      timingType: 'all-day',
      start: '2026-10-25',
      end: '2026-10-25',
      timingChanged: true,
    });
    expect(datePatch.timing?.type).toBe('all-day');
    expect(datePatch.recurrence).toEqual({
      rrule: 'FREQ=DAILY;UNTIL=20261025',
    });

    const timezonePatch = calendarEventPatchFromForm({
      ...values,
      timezone: 'Europe/Stockholm',
      timingChanged: true,
      timezoneChanged: true,
    });
    expect(timezonePatch.recurrence).toEqual({
      rrule: 'FREQ=DAILY;UNTIL=20261025T225959Z',
    });
  });

  it.each(['FREQ=DAILY;COUNT=4', 'FREQ=DAILY'])(
    'keeps count/never rule stable on DTSTART kind changes: %s',
    (rrule) => {
      const event: CalendarEvent = {
        id: 'bounded-series',
        calendarId: 'team',
        uid: 'bounded@example.test',
        title: 'Bounded series',
        timing: {
          type: 'all-day',
          startDate: '2026-10-25',
          endDate: '2026-10-26',
        },
        recurrence: { rrule },
      };
      const values = calendarEventToFormValues(event, calendar);

      expect(
        calendarEventPatchFromForm({
          ...values,
          timingType: 'timed',
          start: '2026-10-25T09:00',
          end: '2026-10-25T10:00',
          timingChanged: true,
        }),
      ).not.toHaveProperty('recurrence');
    },
  );
});
