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
  isCalendarEventRecurrenceRuleSupported,
} from '@matrix-calendar-widget/calendar';
import { DateTime } from 'luxon';
import {
  calendarEventInputFromForm,
  calendarEventOccurrencePatchFromForm,
  calendarEventPatchFromForm,
  calendarEventToFormValues,
  createCalendarEventFormValues,
  hasInvalidCalendarEventRecurrenceFormValues,
} from './calendarEventForm';

const calendar: Calendar = {
  id: 'team',
  name: 'Team calendar',
  timezone: 'Europe/Stockholm',
};

const emptyRecurrence = {
  ruleEditable: true,
  ruleEdited: false,
  ruleValid: true,
  rdates: [],
  rdatesEdited: false,
  exdates: [],
  exdatesEdited: false,
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
      recurrence: {
        ruleEditable: true,
        ruleEdited: false,
        ruleValid: true,
        rdates: [],
        rdatesEdited: false,
        exdates: [],
        exdatesEdited: false,
      },
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
          recurrence: emptyRecurrence,
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
          local: '2026-09-23T09:00',
          timezone: 'Europe/Stockholm',
        },
        end: {
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
          recurrence: emptyRecurrence,
        },
        'all-day@example.test',
      ).timing,
    ).toEqual({
      type: 'all-day',
      startDate: '2026-10-05',
      endDate: '2026-10-08',
    });
  });

  it('converts the occurrence editor fields without series recurrence data', () => {
    expect(
      calendarEventOccurrencePatchFromForm({
        calendarId: 'team',
        title: '  Moved occurrence  ',
        description: '',
        location: ' Room 2 ',
        timingType: 'timed',
        start: '2026-09-24T11:00',
        end: '2026-09-24T12:00',
        timezone: 'Europe/Stockholm',
        recurrence: {
          ...emptyRecurrence,
          original: { rrule: 'FREQ=DAILY;COUNT=3' },
        },
      }),
    ).toEqual({
      title: 'Moved occurrence',
      description: null,
      location: 'Room 2',
      timing: {
        type: 'timed',
        start: {
          local: '2026-09-24T11:00:00',
          timezone: 'Europe/Stockholm',
          mode: 'tzid',
        },
        end: {
          local: '2026-09-24T12:00:00',
          timezone: 'Europe/Stockholm',
          mode: 'tzid',
        },
      },
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
        recurrence: emptyRecurrence,
      }),
    ).toEqual({
      title: 'Updated',
      description: undefined,
      location: undefined,
      timing: {
        type: 'timed',
        start: {
          local: '2026-09-23T11:00',
          timezone: 'Europe/Stockholm',
        },
        end: {
          local: '2026-09-23T12:00',
          timezone: 'Europe/Stockholm',
        },
      },
    });
  });

  it('creates timed recurring input with explicit floating, UTC, and TZID values', () => {
    const values = createCalendarEventFormValues(
      calendar,
      DateTime.fromISO('2026-09-23T09:37:00', { zone: 'Europe/Stockholm' }),
    );
    values.recurrence = {
      ...values.recurrence,
      rule: 'FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4',
      ruleEdited: true,
      rdates: [
        {
          mode: 'floating',
          value: '2026-10-02T09:30',
          timezone: '',
        },
        { mode: 'utc', value: '2026-10-03T10:00:00', timezone: '' },
        {
          mode: 'tzid',
          value: '2026-10-04T11:00:00',
          timezone: 'Europe/Stockholm',
        },
      ],
      rdatesEdited: true,
      exdates: [
        {
          mode: 'utc',
          value: '2026-10-05T09:00:00',
          timezone: '',
        },
      ],
      exdatesEdited: true,
    };

    expect(
      calendarEventInputFromForm(values, 'series@example.test'),
    ).toMatchObject({
      recurrence: {
        rrule: 'FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4',
        rdates: [
          {
            type: 'date-time',
            value: {
              local: '2026-10-02T09:30:00',
              timezone: 'floating',
              mode: 'floating',
            },
          },
          {
            type: 'date-time',
            value: {
              local: '2026-10-03T10:00:00',
              timezone: 'UTC',
              mode: 'utc',
            },
          },
          {
            type: 'date-time',
            value: {
              local: '2026-10-04T11:00:00',
              timezone: 'Europe/Stockholm',
              mode: 'tzid',
            },
          },
        ],
        exdates: [
          {
            type: 'date-time',
            value: {
              local: '2026-10-05T09:00:00',
              timezone: 'UTC',
              mode: 'utc',
            },
          },
        ],
      },
    });
  });

  it('keeps all-day recurrence values as DATE', () => {
    const event: CalendarEvent = {
      id: 'all-day-series',
      calendarId: 'team',
      uid: 'all-day-series@example.test',
      title: 'All-day series',
      timing: {
        type: 'all-day',
        startDate: '2026-09-23',
        endDate: '2026-09-24',
      },
    };
    const values = calendarEventToFormValues(event, calendar);
    values.recurrence = {
      ...values.recurrence,
      rule: 'FREQ=DAILY;COUNT=2',
      ruleEdited: true,
      rdates: [{ mode: 'date', value: '2026-09-25', timezone: '' }],
      rdatesEdited: true,
      exdates: [{ mode: 'date', value: '2026-09-24', timezone: '' }],
      exdatesEdited: true,
    };

    expect(
      calendarEventInputFromForm(values, 'all-day-series@example.test'),
    ).toMatchObject({
      timing: {
        type: 'all-day',
      },
      recurrence: {
        rdates: [{ type: 'date', value: '2026-09-25' }],
        exdates: [{ type: 'date', value: '2026-09-24' }],
      },
    });
  });

  it('preserves incompatible loaded values until recurrence is edited, then rejects them', () => {
    const event: CalendarEvent = {
      id: 'mixed-series',
      calendarId: 'team',
      uid: 'mixed-series@example.test',
      title: 'Mixed series',
      timing: {
        type: 'timed',
        start: {
          local: '2026-09-23T09:00:00',
          timezone: 'Europe/Stockholm',
        },
        end: {
          local: '2026-09-23T10:00:00',
          timezone: 'Europe/Stockholm',
        },
      },
      recurrence: {
        rrule: 'FREQ=DAILY',
        rdates: [{ type: 'date', value: '2026-09-24' }],
      },
    };
    const values = calendarEventToFormValues(event, calendar);

    expect(calendarEventPatchFromForm(values)).not.toHaveProperty('recurrence');
    values.recurrence.ruleEdited = true;

    expect(
      hasInvalidCalendarEventRecurrenceFormValues(
        values.recurrence,
        values.timingType,
        values.timezone,
      ),
    ).toBe(true);
    expect(() => calendarEventPatchFromForm(values)).toThrow(
      'Invalid recurrence values',
    );
  });

  it('omits recurrence from a no-op patch so the raw rule stays untouched', () => {
    const eventWithUnsupportedRule: CalendarEvent = {
      id: 'event',
      calendarId: 'team',
      uid: 'event@example.test',
      title: 'Event',
      timing: {
        type: 'timed',
        start: {
          local: '2026-09-23T09:00:00',
          timezone: 'Europe/Stockholm',
          mode: 'tzid',
        },
        end: {
          local: '2026-09-23T10:00:00',
          timezone: 'Europe/Stockholm',
          mode: 'tzid',
        },
      },
      recurrence: {
        rrule: 'FREQ=DAILY;BYHOUR=9,17',
        exdates: [
          {
            type: 'date-time',
            value: {
              local: '2026-09-24T09:00:00',
              timezone: 'Europe/Stockholm',
              mode: 'tzid',
            },
          },
        ],
      },
    };
    const values = calendarEventToFormValues(
      eventWithUnsupportedRule,
      calendar,
    );

    expect(values.recurrence.ruleEditable).toBe(false);
    expect(values.recurrence.original).toEqual(
      eventWithUnsupportedRule.recurrence,
    );
    expect(calendarEventPatchFromForm(values)).not.toHaveProperty('recurrence');
  });

  it('recognizes only recurrence rules the editor can represent safely', () => {
    expect(
      isCalendarEventRecurrenceRuleSupported(
        'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=8',
        'timed',
        'Europe/Stockholm',
      ),
    ).toBe(true);
    expect(
      isCalendarEventRecurrenceRuleSupported(
        'FREQ=DAILY;BYHOUR=9,17',
        'timed',
        'Europe/Stockholm',
      ),
    ).toBe(false);
    expect(
      isCalendarEventRecurrenceRuleSupported(
        'FREQ=DAILY;UNTIL=20261231T235959Z',
        'timed',
        'floating',
      ),
    ).toBe(false);
  });
});
