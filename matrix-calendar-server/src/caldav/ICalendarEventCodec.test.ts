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

import type {
  CalendarEvent,
  CalendarEventDateTime,
  CalendarEventInput,
  CalendarEventPatch,
} from '@matrix-calendar-widget/calendar';
import { projectCalendarEventOccurrenceByRecurrenceId } from '@matrix-calendar-widget/calendar';
import { getVTimezoneBlock } from '@matrix-calendar-widget/ical-timezones';
import fs from 'fs';
import ICAL from 'ical.js';
import path from 'path';
import {
  applyOccurrenceTimingOverride,
  ICalendarEventCodec,
  ICalendarEventCodecError,
} from './ICalendarEventCodec';

const codec = new ICalendarEventCodec();

describe('applyOccurrenceTimingOverride', () => {
  const now = new Date('2026-10-03T15:16:17.987Z');

  it('creates one detached override from an actual recurrence candidate', () => {
    const source = simpleRecurringSource(
      'DTSTART;TZID=Europe/Stockholm:20261001T090000',
      'DTEND;TZID=Europe/Stockholm:20261001T100000',
      ['CREATED:20260921T100000Z'],
      ['Europe/Stockholm'],
    );
    const parsed = codec.parse('team', 'instance.ics', source);
    const calendar = ICAL.Component.fromString(source);
    const calendarBefore = calendar.toString();
    const result = applyOccurrenceTimingOverride(
      calendar,
      parsed.event,
      {
        recurrenceId: {
          type: 'date-time',
          value: {
            local: '2026-10-02T09:00:00',
            timezone: 'Europe/Stockholm',
          },
        },
        timing: {
          type: 'end',
          start: {
            type: 'date-time',
            value: {
              local: '2026-10-02T11:00:00',
              timezone: 'Europe/Stockholm',
            },
          },
          end: {
            type: 'date-time',
            value: {
              local: '2026-10-02T12:00:00',
              timezone: 'Europe/Stockholm',
            },
          },
        },
      },
      {
        source,
        now,
        viewerTimezone: 'America/Los_Angeles',
      },
    );

    expect(result.action).toBe('created');
    expect(result.revisionUpdated).toBe(true);
    expect(result.component.getFirstPropertyValue('uid')).toBe(
      'simple-recurring@example.test',
    );
    expect(result.component.getAllProperties('rrule')).toHaveLength(0);
    expect(result.component.getAllProperties('rdate')).toHaveLength(0);
    expect(result.component.getAllProperties('exdate')).toHaveLength(0);
    expect(
      result.component.getFirstProperty('recurrence-id')?.toICALString(),
    ).toBe('RECURRENCE-ID;TZID=Europe/Stockholm:20261002T090000');
    expect(
      result.component
        .getFirstProperty('x-custom-event-property')
        ?.getFirstValue(),
    ).toBe('preserve-event-value');
    expect(result.component.getFirstProperty('x-instance-marker')).toBeNull();
    expect(revisionPropertyLines(result.component)).toEqual([
      'DTSTAMP:20261003T151617Z',
      'CREATED:20260921T100000Z',
      'LAST-MODIFIED:20261003T151617Z',
      'SEQUENCE:1',
    ]);
    expect(calendar.toString()).toBe(calendarBefore);
  });

  it('updates a moved override by original identity and keeps its parameters', () => {
    const source = withDetachedEvents(
      simpleRecurringSource(
        'DTSTART;TZID=Europe/Stockholm:20261001T090000',
        'DTEND;TZID=Europe/Stockholm:20261001T100000',
        [],
        ['Europe/Stockholm'],
      ),
      [
        [
          'BEGIN:VEVENT',
          'UID:simple-recurring@example.test',
          'DTSTAMP:20260922T120000Z',
          'RECURRENCE-ID;TZID=Europe/Stockholm;X-CLIENT=keep:20261002T090000',
          'DTSTART;TZID=Europe/Stockholm:20261002T150000',
          'DTEND;TZID=Europe/Stockholm:20261002T160000',
          'X-OVERRIDE-MARKER;X-PARAM=keep:moved',
          'END:VEVENT',
        ].join('\r\n'),
        [
          'BEGIN:VEVENT',
          'UID:simple-recurring@example.test',
          'DTSTAMP:20260922T120000Z',
          'RECURRENCE-ID;TZID=Europe/Stockholm:20261003T090000',
          'DTSTART;TZID=Europe/Stockholm:20261003T090000',
          'DTEND;TZID=Europe/Stockholm:20261003T100000',
          'X-OVERRIDE-MARKER;X-PARAM=keep:sibling',
          'END:VEVENT',
        ].join('\r\n'),
      ],
    );
    const parsed = codec.parse('team', 'moved-instance.ics', source);
    const sourceCalendar = ICAL.Component.fromString(source);
    const sourceEvents = sourceCalendar.getAllSubcomponents('vevent');
    const originalRecurrenceId = sourceEvents[1]
      .getFirstProperty('recurrence-id')
      ?.toICALString();
    const sourceBefore = sourceCalendar.toString();
    const result = applyOccurrenceTimingOverride(
      sourceCalendar,
      parsed.event,
      {
        recurrenceId: parsed.event.recurrence!.overrides![0].recurrenceId,
        timing: {
          type: 'end',
          start: {
            type: 'date-time',
            value: {
              local: '2026-10-02T16:00:00',
              timezone: 'Europe/Stockholm',
            },
          },
          end: {
            type: 'date-time',
            value: {
              local: '2026-10-02T17:00:00',
              timezone: 'Europe/Stockholm',
            },
          },
        },
      },
      {
        source,
        now,
        viewerTimezone: 'Europe/Stockholm',
      },
    );

    expect(result.action).toBe('updated');
    expect(result.revisionUpdated).toBe(true);
    expect(
      result.component.getFirstProperty('recurrence-id')?.toICALString(),
    ).toBe(originalRecurrenceId);
    expect(result.component.getFirstPropertyValue('dtstart')?.toString()).toBe(
      '2026-10-02T16:00:00',
    );
    expect(
      result.component.getFirstProperty('x-override-marker')?.toICALString(),
    ).toBe('X-OVERRIDE-MARKER;X-PARAM=keep:moved');
    expect(revisionPropertyLines(result.component)).toEqual([
      'DTSTAMP:20261003T151617Z',
      'LAST-MODIFIED:20261003T151617Z',
      'SEQUENCE:1',
    ]);
    expect(sourceCalendar.toString()).toBe(sourceBefore);
    expect(
      sourceEvents[2].getFirstProperty('x-override-marker')?.toICALString(),
    ).toBe('X-OVERRIDE-MARKER;X-PARAM=keep:sibling');
  });

  it('preserves DATE and floating values while validating the viewer-local interval', () => {
    const dateSource = simpleRecurringSource(
      'DTSTART;VALUE=DATE:20261001',
      'DTEND;VALUE=DATE:20261002',
    );
    const dateEvent = codec.parse(
      'team',
      'date-instance.ics',
      dateSource,
    ).event;
    const dateResult = applyOccurrenceTimingOverride(
      ICAL.Component.fromString(dateSource),
      dateEvent,
      {
        recurrenceId: { type: 'date', value: '2026-10-02' },
        timing: {
          type: 'end',
          start: { type: 'date', value: '2026-10-02' },
          end: { type: 'date', value: '2026-10-04' },
        },
      },
      {
        source: dateSource,
        now,
        viewerTimezone: 'Europe/Stockholm',
      },
    );
    expect(dateResult.component.getFirstPropertyValue('dtstart')).toMatchObject(
      {
        isDate: true,
        day: 2,
      },
    );

    const floatingSource = simpleRecurringSource(
      'DTSTART:20261001T090000',
      'DTEND:20261001T100000',
    );
    const floatingEvent = codec.parse(
      'team',
      'floating-instance.ics',
      floatingSource,
    ).event;
    const floatingResult = applyOccurrenceTimingOverride(
      ICAL.Component.fromString(floatingSource),
      floatingEvent,
      {
        recurrenceId: {
          type: 'floating-date-time',
          value: '2026-10-02T09:00:00',
        },
        timing: {
          type: 'end',
          start: {
            type: 'floating-date-time',
            value: '2026-10-02T10:00:00',
          },
          end: {
            type: 'floating-date-time',
            value: '2026-10-02T11:00:00',
          },
        },
      },
      {
        source: floatingSource,
        now,
        viewerTimezone: 'America/Los_Angeles',
      },
    );
    expect(
      floatingResult.component.getFirstProperty('dtstart')?.toICALString(),
    ).toBe('DTSTART:20261002T100000');
    expect(
      floatingResult.component.getFirstProperty('dtend')?.toICALString(),
    ).toBe('DTEND:20261002T110000');
  });

  it('uses bundled timezone rules across a DST boundary and rejects a gap', () => {
    const source = simpleRecurringSource(
      'DTSTART;TZID=Europe/Stockholm:20260328T013000',
      'DTEND;TZID=Europe/Stockholm:20260328T023000',
      [],
      ['Europe/Stockholm'],
    );
    const event = codec.parse('team', 'dst-instance.ics', source).event;
    const accepted = applyOccurrenceTimingOverride(
      ICAL.Component.fromString(source),
      event,
      {
        recurrenceId: {
          type: 'date-time',
          value: {
            local: '2026-03-29T01:30:00',
            timezone: 'Europe/Stockholm',
          },
        },
        timing: {
          type: 'end',
          start: {
            type: 'date-time',
            value: {
              local: '2026-03-29T01:30:00',
              timezone: 'Europe/Stockholm',
            },
          },
          end: {
            type: 'date-time',
            value: {
              local: '2026-03-29T03:30:00',
              timezone: 'Europe/Stockholm',
            },
          },
        },
      },
      {
        source,
        now,
        viewerTimezone: 'America/Los_Angeles',
      },
    );
    expect(accepted.action).toBe('created');

    expect(() =>
      applyOccurrenceTimingOverride(
        ICAL.Component.fromString(source),
        event,
        {
          recurrenceId: {
            type: 'date-time',
            value: {
              local: '2026-03-29T01:30:00',
              timezone: 'Europe/Stockholm',
            },
          },
          timing: {
            type: 'end',
            start: {
              type: 'date-time',
              value: {
                local: '2026-03-29T02:30:00',
                timezone: 'Europe/Stockholm',
              },
            },
            end: {
              type: 'date-time',
              value: {
                local: '2026-03-29T03:30:00',
                timezone: 'Europe/Stockholm',
              },
            },
          },
        },
        {
          source,
          now,
          viewerTimezone: 'Europe/Stockholm',
        },
      ),
    ).toThrow(
      new ICalendarEventCodecError(
        'unsupported-patch',
        'This occurrence cannot be timed safely because its recurrence identity or source data is unsupported or ambiguous.',
      ),
    );
  });

  it.each([
    ['not an actual recurrence candidate', [], '20261009T090000'],
    [
      'excluded by EXDATE',
      ['EXDATE;TZID=Europe/Stockholm:20261002T090000'],
      '20261002T090000',
    ],
  ])('rejects %s', (_label, extraLines, targetCompact) => {
    const source = simpleRecurringSource(
      'DTSTART;TZID=Europe/Stockholm:20261001T090000',
      'DTEND;TZID=Europe/Stockholm:20261001T100000',
      extraLines,
      ['Europe/Stockholm'],
    );
    const event = codec.parse('team', 'not-an-instance.ics', source).event;
    expect(() =>
      applyOccurrenceTimingOverride(
        ICAL.Component.fromString(source),
        event,
        {
          recurrenceId: {
            type: 'date-time',
            value: {
              local: `2026-10-${targetCompact.slice(6, 8)}T09:00:00`,
              timezone: 'Europe/Stockholm',
            },
          },
          timing: {
            type: 'end',
            start: {
              type: 'date-time',
              value: {
                local: '2026-10-02T11:00:00',
                timezone: 'Europe/Stockholm',
              },
            },
            end: {
              type: 'date-time',
              value: {
                local: '2026-10-02T12:00:00',
                timezone: 'Europe/Stockholm',
              },
            },
          },
        },
        {
          source,
          now,
          viewerTimezone: 'Europe/Stockholm',
        },
      ),
    ).toThrow(ICalendarEventCodecError);
  });

  it('rejects same-resource alarms, ambiguous target IDs, and unsafe intervals', () => {
    const base = simpleRecurringSource(
      'DTSTART;TZID=Europe/Stockholm:20261001T090000',
      'DTEND;TZID=Europe/Stockholm:20261001T100000',
      [],
      ['Europe/Stockholm'],
    );
    const withAlarm = simpleRecurringSource(
      'DTSTART;TZID=Europe/Stockholm:20261001T090000',
      'DTEND;TZID=Europe/Stockholm:20261001T100000',
      [
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        'DESCRIPTION:keep alarm',
        'TRIGGER:-PT5M',
        'END:VALARM',
      ],
      ['Europe/Stockholm'],
    );
    const operation = {
      recurrenceId: {
        type: 'date-time' as const,
        value: {
          local: '2026-10-02T09:00:00',
          timezone: 'Europe/Stockholm',
        },
      },
      timing: {
        type: 'end' as const,
        start: {
          type: 'date-time' as const,
          value: {
            local: '2026-10-02T11:00:00',
            timezone: 'Europe/Stockholm',
          },
        },
        end: {
          type: 'date-time' as const,
          value: {
            local: '2026-10-02T12:00:00',
            timezone: 'Europe/Stockholm',
          },
        },
      },
    };

    const alarmEvent = codec.parse('team', 'alarm-series.ics', withAlarm).event;
    expect(() =>
      applyOccurrenceTimingOverride(
        ICAL.Component.fromString(withAlarm),
        alarmEvent,
        operation,
        { source: withAlarm, now, viewerTimezone: 'Europe/Stockholm' },
      ),
    ).toThrow(
      new ICalendarEventCodecError(
        'unsupported-patch',
        'Occurrence timing edits are unavailable for recurrence resources with VALARM data; alarms are preserved unchanged.',
      ),
    );

    const duplicateTarget = withDetachedEvents(base, [
      ...[1, 2].map((index) =>
        [
          'BEGIN:VEVENT',
          'UID:simple-recurring@example.test',
          'RECURRENCE-ID;TZID=Europe/Stockholm:20261002T090000',
          `DTSTART;TZID=Europe/Stockholm:20261002T1${index}0000`,
          `DTEND;TZID=Europe/Stockholm:20261002T1${index}3000`,
          'END:VEVENT',
        ].join('\r\n'),
      ),
    ]);
    const duplicateEvent = codec.parse(
      'team',
      'duplicate-instance.ics',
      duplicateTarget,
    ).event;
    expect(() =>
      applyOccurrenceTimingOverride(
        ICAL.Component.fromString(duplicateTarget),
        duplicateEvent,
        operation,
        {
          source: duplicateTarget,
          now,
          viewerTimezone: 'Europe/Stockholm',
        },
      ),
    ).toThrow(ICalendarEventCodecError);

    const event = codec.parse('team', 'unsafe-end.ics', base).event;
    expect(() =>
      applyOccurrenceTimingOverride(
        ICAL.Component.fromString(base),
        event,
        {
          ...operation,
          timing: {
            ...operation.timing,
            end: {
              type: 'date-time',
              value: {
                local: '2026-10-02T10:00:00',
                timezone: 'Europe/Stockholm',
              },
            },
          },
        },
        { source: base, now, viewerTimezone: 'Europe/Stockholm' },
      ),
    ).toThrow(ICalendarEventCodecError);
  });

  it('keeps malformed target revision properties available for exact restoration', () => {
    const source = withDetachedEvents(
      simpleRecurringSource(
        'DTSTART;TZID=Europe/Stockholm:20261001T090000',
        'DTEND;TZID=Europe/Stockholm:20261001T100000',
        [],
        ['Europe/Stockholm'],
      ),
      [
        [
          'BEGIN:VEVENT',
          'UID:simple-recurring@example.test',
          'DTSTAMP:20260922T120000Z',
          'LAST-MODIFIED :20260922T120000Z',
          'RECURRENCE-ID;TZID=Europe/Stockholm:20261002T090000',
          'DTSTART;TZID=Europe/Stockholm:20261002T110000',
          'DTEND;TZID=Europe/Stockholm:20261002T120000',
          'END:VEVENT',
        ].join('\r\n'),
      ],
    );
    const parsed = codec.parse('team', 'opaque-override-revision.ics', source);
    const result = applyOccurrenceTimingOverride(
      ICAL.Component.fromString(source),
      parsed.event,
      {
        recurrenceId: parsed.event.recurrence!.overrides![0].recurrenceId,
        timing: {
          type: 'end',
          start: {
            type: 'date-time',
            value: {
              local: '2026-10-02T13:00:00',
              timezone: 'Europe/Stockholm',
            },
          },
          end: {
            type: 'date-time',
            value: {
              local: '2026-10-02T14:00:00',
              timezone: 'Europe/Stockholm',
            },
          },
        },
      },
      {
        source,
        now,
        viewerTimezone: 'Europe/Stockholm',
      },
    );

    expect(result.revisionUpdated).toBe(false);
    expect(
      result.sourceRevisionProperties.map((property) => property.physicalLines),
    ).toEqual([
      ['DTSTAMP:20260922T120000Z'],
      ['LAST-MODIFIED :20260922T120000Z'],
    ]);
  });
});

describe('selected-occurrence text codec writes', () => {
  it('creates a sparse text override with projected named-zone DST timing and preserves source siblings', () => {
    const sourceMaster = simpleRecurringSource(
      'DTSTART;TZID=Europe/Stockholm:20261024T090000',
      'DTEND;TZID=Europe/Stockholm:20261024T100000',
      [
        'CREATED:20260921T100000Z',
        'SEQUENCE:7',
        'DESCRIPTION:Master description',
        'LOCATION:Master room',
        'X-MASTER;X-OPAQUE="Keep exactly":master value',
      ],
      ['Europe/Stockholm'],
    );
    const source = withDetachedEvents(sourceMaster, [
      [
        'BEGIN:VEVENT',
        'UID:simple-recurring@example.test',
        'DTSTAMP:20260922T120000Z',
        'SEQUENCE:2',
        'RECURRENCE-ID;TZID=Europe/Stockholm:20261026T090000',
        'DTSTART;TZID=Europe/Stockholm:20261026T110000',
        'DTEND;TZID=Europe/Stockholm:20261026T120000',
        'SUMMARY;LANGUAGE=de:Geschwister',
        'X-SIBLING;X-OPAQUE="Keep exactly":sibling value',
        'END:VEVENT',
      ].join('\r\n'),
    ]);
    const parsed = codec.parse('team', 'text-instance.ics', source);
    const recurrenceId = {
      type: 'date-time' as const,
      value: {
        local: '2026-10-25T09:00:00',
        timezone: 'Europe/Stockholm',
      },
    };
    const encoded = parsed.applyPatch({
      recurrence: {
        occurrence: {
          action: 'set-fields',
          recurrenceId,
          viewerTimezone: 'Europe/Stockholm',
          title: { action: 'set', value: 'Changed instance' },
          description: { action: 'set', value: '' },
        },
      },
    });
    const blocks = rawVeventBlocks(encoded.icalendar);
    const sourceBlocks = rawVeventBlocks(source);

    expect(blocks[0]).toEqual(sourceBlocks[0]);
    expect(blocks[1]).toEqual(sourceBlocks[1]);
    expect(blocks[2]).toContain(
      'DTSTART;TZID=Europe/Stockholm:20261025T090000',
    );
    expect(blocks[2]).toContain('DTEND;TZID=Europe/Stockholm:20261025T100000');
    expect(blocks[2]).toContain('SUMMARY:Changed instance');
    expect(blocks[2]).toContain('DESCRIPTION:');
    expect(blocks[2]).not.toContain('LOCATION:Master room');
    expect(blocks[2]).toContain(
      'X-MASTER;X-OPAQUE="Keep exactly":master value',
    );
    expect(encoded.event.recurrence?.overrides).toContainEqual(
      expect.objectContaining({
        recurrenceId,
        title: 'Changed instance',
        description: '',
      }),
    );
    expect(
      projectCalendarEventOccurrenceByRecurrenceId(
        encoded.event,
        recurrenceId,
        'Europe/Stockholm',
      )?.event,
    ).toMatchObject({
      title: 'Changed instance',
      description: '',
      location: 'Master room',
      timing: {
        type: 'timed',
        start: {
          type: 'zoned',
          local: '2026-10-25T09:00:00',
          timezone: 'Europe/Stockholm',
        },
      },
    });
  });

  it('returns original bytes for inherited text operations without creating an override', () => {
    const source = simpleRecurringSource(
      'DTSTART:20261001T090000',
      'DTEND:20261001T100000',
    );
    const parsed = codec.parse('team', 'text-noop.ics', source);
    const encoded = parsed.applyPatch({
      recurrence: {
        occurrence: {
          action: 'set-fields',
          recurrenceId: {
            type: 'floating-date-time',
            value: '2026-10-02T09:00:00',
          },
          viewerTimezone: 'Europe/Stockholm',
          title: { action: 'inherit' },
          description: { action: 'inherit' },
        },
      },
    });
    expect(encoded.icalendar).toBe(source);
    expect(encoded.event.recurrence?.overrides).toBeUndefined();
  });

  it('keeps inherited text on a new legacy timing-only override', () => {
    const source = simpleRecurringSource(
      'DTSTART:20261001T090000',
      'DTEND:20261001T100000',
      ['DESCRIPTION:Series description', 'LOCATION:Series room'],
    );
    const result = codec.parse('team', 'legacy-timing.ics', source).applyPatch({
      recurrence: {
        occurrence: {
          action: 'set-timing',
          recurrenceId: {
            type: 'floating-date-time',
            value: '2026-10-02T09:00:00',
          },
          timing: {
            type: 'end',
            start: {
              type: 'floating-date-time',
              value: '2026-10-02T11:00:00',
            },
            end: {
              type: 'floating-date-time',
              value: '2026-10-02T12:00:00',
            },
          },
          viewerTimezone: 'Europe/Stockholm',
        },
      },
    });
    const target = rawVeventBlocks(result.icalendar)[1];

    expect(target).toContain('SUMMARY:Simple recurring event');
    expect(target).toContain('DESCRIPTION:Series description');
    expect(target).toContain('LOCATION:Series room');
    expect(result.event.recurrence?.overrides).toContainEqual(
      expect.objectContaining({
        title: 'Simple recurring event',
        description: 'Series description',
        location: 'Series room',
      }),
    );
  });

  it('keeps read-only text values visible and preserves them when another field changes', () => {
    const source = withDetachedEvents(
      simpleRecurringSource('DTSTART:20261001T090000', 'DTEND:20261001T100000'),
      [
        [
          'BEGIN:VEVENT',
          'UID:simple-recurring@example.test',
          'RECURRENCE-ID:20261002T090000',
          'DTSTART:20261002T110000',
          'DTEND:20261002T120000',
          'SUMMARY;X-OPAQUE=value:Besprechung',
          'DESCRIPTION:Old description',
          'END:VEVENT',
        ].join('\r\n'),
      ],
    );
    const recurrenceId = {
      type: 'floating-date-time' as const,
      value: '2026-10-02T09:00:00',
    };
    const parsed = codec.parse('team', 'readonly-text.ics', source);
    const override = parsed.event.recurrence?.overrides?.[0];
    expect(override).toMatchObject({
      title: 'Besprechung',
      description: 'Old description',
      unsupportedText: { title: true },
    });
    expect(
      projectCalendarEventOccurrenceByRecurrenceId(
        parsed.event,
        recurrenceId,
        'Europe/Stockholm',
      )?.event.title,
    ).toBe('Besprechung');

    expect(() =>
      parsed.applyPatch({
        recurrence: {
          occurrence: {
            action: 'set-fields',
            recurrenceId,
            viewerTimezone: 'Europe/Stockholm',
            title: { action: 'set', value: 'Changed title' },
          },
        },
      }),
    ).toThrow(ICalendarEventCodecError);

    const result = parsed.applyPatch({
      recurrence: {
        occurrence: {
          action: 'set-fields',
          recurrenceId,
          viewerTimezone: 'Europe/Stockholm',
          description: { action: 'set', value: 'Updated description' },
        },
      },
    });

    expect(rawVeventBlocks(result.icalendar)[1]).toContain(
      'SUMMARY;X-OPAQUE=value:Besprechung',
    );
    expect(result.event.recurrence?.overrides).toContainEqual(
      expect.objectContaining({
        title: 'Besprechung',
        description: 'Updated description',
        unsupportedText: { title: true },
      }),
    );
  });

  it('removes explicit text fields to restore inheritance without changing moved timing', () => {
    const source = withDetachedEvents(
      simpleRecurringSource(
        'DTSTART:20261001T090000',
        'DTEND:20261001T100000',
        ['DESCRIPTION:Series description', 'LOCATION:Series room'],
      ),
      [
        [
          'BEGIN:VEVENT',
          'UID:simple-recurring@example.test',
          'RECURRENCE-ID:20261002T090000',
          'DTSTART:20261002T110000',
          'DTEND:20261002T120000',
          'SUMMARY:One day only',
          'DESCRIPTION:Instance description',
          'END:VEVENT',
        ].join('\r\n'),
      ],
    );
    const recurrenceId = {
      type: 'floating-date-time' as const,
      value: '2026-10-02T09:00:00',
    };
    const parsed = codec.parse('team', 'text-inherit.ics', source);
    const result = parsed.applyPatch({
      recurrence: {
        occurrence: {
          action: 'set-fields',
          recurrenceId,
          viewerTimezone: 'Europe/Stockholm',
          title: { action: 'inherit' },
          description: { action: 'inherit' },
        },
      },
    });
    const target = rawVeventBlocks(result.icalendar)[1];

    expect(target).toContain('DTSTART:20261002T110000');
    expect(target).toContain('DTEND:20261002T120000');
    expect(target).not.toContain('SUMMARY:One day only');
    expect(target).not.toContain('DESCRIPTION:Instance description');
    expect(result.event.recurrence?.overrides).toContainEqual(
      expect.objectContaining({ recurrenceId }),
    );
    expect(
      projectCalendarEventOccurrenceByRecurrenceId(
        result.event,
        recurrenceId,
        'Europe/Stockholm',
      )?.event,
    ).toMatchObject({
      title: 'Simple recurring event',
      description: 'Series description',
      location: 'Series room',
    });
  });

  it('materializes an explicit value equal to the master when the override is absent', () => {
    const source = simpleRecurringSource(
      'DTSTART:20261001T090000',
      'DTEND:20261001T100000',
    );
    const recurrenceId = {
      type: 'floating-date-time' as const,
      value: '2026-10-02T09:00:00',
    };
    const result = codec
      .parse('team', 'explicit-equal.ics', source)
      .applyPatch({
        recurrence: {
          occurrence: {
            action: 'set-fields',
            recurrenceId,
            viewerTimezone: 'Europe/Stockholm',
            title: { action: 'set', value: 'Simple recurring event' },
          },
        },
      });

    expect(result.icalendar).not.toBe(source);
    expect(rawVeventBlocks(result.icalendar)[1]).toContain(
      'SUMMARY:Simple recurring event',
    );
    expect(result.event.recurrence?.overrides).toContainEqual(
      expect.objectContaining({
        recurrenceId,
        title: 'Simple recurring event',
      }),
    );
  });

  it('returns source bytes when an existing explicit value is set to itself', () => {
    const source = withDetachedEvents(
      simpleRecurringSource('DTSTART:20261001T090000', 'DTEND:20261001T100000'),
      [
        [
          'BEGIN:VEVENT',
          'UID:simple-recurring@example.test',
          'RECURRENCE-ID:20261002T090000',
          'DTSTART:20261002T090000',
          'DTEND:20261002T100000',
          'SUMMARY:One day only',
          'END:VEVENT',
        ].join('\r\n'),
      ],
    );
    const parsed = codec.parse('team', 'text-idempotent.ics', source);
    const result = parsed.applyPatch({
      recurrence: {
        occurrence: {
          action: 'set-fields',
          recurrenceId: {
            type: 'floating-date-time',
            value: '2026-10-02T09:00:00',
          },
          viewerTimezone: 'Europe/Stockholm',
          title: { action: 'set', value: 'One day only' },
        },
      },
    });

    expect(result.icalendar).toBe(source);
  });

  it('changes only the target text field and preserves raw sibling/master revisions', () => {
    const sourceMaster = simpleRecurringSource(
      'DTSTART:20261001T090000',
      'DTEND:20261001T100000',
      ['SEQUENCE:4', 'DESCRIPTION:Series description'],
    );
    const source = withDetachedEvents(sourceMaster, [
      [
        'BEGIN:VEVENT',
        'UID:simple-recurring@example.test',
        'DTSTAMP:20260922T120000Z',
        'CREATED:20260921T100000Z',
        'LAST-MODIFIED:20260922T120000Z',
        'SEQUENCE:2',
        'RECURRENCE-ID:20261002T090000',
        'DTSTART:20261002T110000',
        'DTEND:20261002T120000',
        'SUMMARY:Old instance',
        'X-OPAQUE;X-PARAM="Preserve":target sibling value',
        'END:VEVENT',
      ].join('\r\n'),
    ]);
    const parsed = codec.parse('team', 'text-edit.ics', source);
    const recurrenceId = {
      type: 'floating-date-time' as const,
      value: '2026-10-02T09:00:00',
    };
    const result = parsed.applyPatch({
      recurrence: {
        occurrence: {
          action: 'set-fields',
          recurrenceId,
          viewerTimezone: 'Europe/Stockholm',
          title: { action: 'set', value: 'New instance' },
        },
      },
    });
    const sourceBlocks = rawVeventBlocks(source);
    const outputBlocks = rawVeventBlocks(result.icalendar);
    expect(outputBlocks[0]).toEqual(sourceBlocks[0]);
    expect(outputBlocks[1]).toContain(
      'X-OPAQUE;X-PARAM="Preserve":target sibling value',
    );
    expect(outputBlocks[1]).toContain('SUMMARY:New instance');
    expect(outputBlocks[1]).toContain('DTSTART:20261002T110000');
    expect(outputBlocks[1]).toContain('DTEND:20261002T120000');
    expect(rawRevisionLines(outputBlocks[0])).toEqual(
      rawRevisionLines(sourceBlocks[0]),
    );
    expect(outputBlocks[1]).toContain('SEQUENCE:3');
  });
});

describe('bounded following timing codec writes', () => {
  const now = new Date('2026-10-03T15:16:17.987Z');
  const operation = {
    action: 'set-timing' as const,
    recurrenceId: {
      type: 'date-time' as const,
      value: {
        local: '2026-10-02T09:00:00',
        timezone: 'Europe/Stockholm',
      },
    },
    timing: {
      type: 'end' as const,
      start: {
        type: 'date-time' as const,
        value: {
          local: '2026-10-02T11:00:00',
          timezone: 'Europe/Stockholm',
        },
      },
      end: {
        type: 'date-time' as const,
        value: {
          local: '2026-10-02T12:00:00',
          timezone: 'Europe/Stockholm',
        },
      },
    },
    viewerTimezone: 'Europe/Stockholm',
  };

  it('appends complete same-resource overrides and retains the raw master', () => {
    const source = simpleRecurringSource(
      'DTSTART;TZID=Europe/Stockholm:20261001T090000',
      'DTEND;TZID=Europe/Stockholm:20261001T100000',
      [
        'CREATED:20260921T100000Z',
        'SEQUENCE:4',
        'X-OPAQUE-MASTER-PROPERTY:keep-exactly',
      ],
      ['Europe/Stockholm'],
    );
    const deterministicCodec = new ICalendarEventCodec(() => now);
    const parsed = deterministicCodec.parse('team', 'following.ics', source);
    const result = parsed.applyPatch({
      recurrence: { following: operation },
    });
    const sourceBlocks = rawVeventBlocks(source);
    const resultBlocks = rawVeventBlocks(result.icalendar);

    expect(resultBlocks).toHaveLength(3);
    expect(resultBlocks[0]).toEqual(sourceBlocks[0]);
    expect(result.icalendar).toContain(
      'X-CUSTOM-CALENDAR-PROPERTY:preserve-resource-value',
    );
    expect(result.event.recurrence?.overrides).toHaveLength(2);
    expect(
      result.event.recurrence?.overrides?.map(
        ({ recurrenceId }) => recurrenceId,
      ),
    ).toEqual([
      operation.recurrenceId,
      {
        type: 'date-time',
        value: {
          local: '2026-10-03T09:00:00',
          timezone: 'Europe/Stockholm',
        },
      },
    ]);
    for (const block of resultBlocks.slice(1)) {
      expect(block).toContain('X-OPAQUE-MASTER-PROPERTY:keep-exactly');
      expect(block).not.toContain('RRULE:FREQ=DAILY;COUNT=3');
      expect(block).toContain('DTSTAMP:20261003T151617Z');
      expect(block).toContain('LAST-MODIFIED:20261003T151617Z');
      expect(block).toContain('SEQUENCE:5');
      expect(block).toContain('CREATED:20260921T100000Z');
    }
    expect(resultBlocks[1]).toContain(
      'DTSTART;TZID=Europe/Stockholm:20261002T110000',
    );
    expect(resultBlocks[1]).toContain(
      'DTEND;TZID=Europe/Stockholm:20261002T120000',
    );
    expect(resultBlocks[2]).toContain(
      'DTSTART;TZID=Europe/Stockholm:20261003T110000',
    );
    expect(resultBlocks[2]).toContain(
      'DTEND;TZID=Europe/Stockholm:20261003T120000',
    );
    expect(resultBlocks[1]).toContain(
      'RECURRENCE-ID;TZID=Europe/Stockholm:20261002T090000',
    );
    expect(resultBlocks[2]).toContain(
      'RECURRENCE-ID;TZID=Europe/Stockholm:20261003T090000',
    );
  });

  it('returns the exact original resource for an identical repeated operation', () => {
    const source = simpleRecurringSource(
      'DTSTART;TZID=Europe/Stockholm:20261001T090000',
      'DTEND;TZID=Europe/Stockholm:20261001T100000',
      ['STATUS:CONFIRMED'],
      ['Europe/Stockholm'],
    );
    const deterministicCodec = new ICalendarEventCodec(() => now);
    const first = deterministicCodec
      .parse('team', 'following.ics', source)
      .applyPatch({ recurrence: { following: operation } });
    const second = deterministicCodec
      .parse('team', 'following.ics', first.icalendar)
      .applyPatch({ recurrence: { following: operation } });

    expect(second.icalendar).toBe(first.icalendar);
    expect(rawVeventBlocks(second.icalendar)).toHaveLength(3);
  });

  it('fails closed for a noncanonical TZID=UTC recurring master', () => {
    const source = simpleRecurringSource(
      'DTSTART;TZID=UTC:20261001T090000',
      'DTEND;TZID=UTC:20261001T100000',
    );
    const utcOperation = {
      ...operation,
      recurrenceId: {
        type: 'date-time' as const,
        value: { local: '2026-10-02T09:00:00', timezone: 'UTC' },
      },
      timing: {
        type: 'end' as const,
        start: {
          type: 'date-time' as const,
          value: { local: '2026-10-02T11:00:00', timezone: 'UTC' },
        },
        end: {
          type: 'date-time' as const,
          value: { local: '2026-10-02T12:00:00', timezone: 'UTC' },
        },
      },
    };
    const deterministicCodec = new ICalendarEventCodec(() => now);
    const parsed = deterministicCodec.parse(
      'team',
      'utc-following.ics',
      source,
    );

    expect(parsed.event.timing.type).toBe('timed');
    if (parsed.event.timing.type !== 'timed') {
      throw new Error('Expected a timed source event');
    }
    expect(parsed.event.timing.start).toMatchObject({ timezone: 'UTC' });
    expect(parsed.event.timing.end).toMatchObject({ timezone: 'UTC' });
    expect(() =>
      parsed.applyPatch({ recurrence: { following: utcOperation } }),
    ).toThrow(ICalendarEventCodecError);
  });

  it('rejects a following timing write on a cancelled master series', () => {
    const source = simpleRecurringSource(
      'DTSTART;TZID=Europe/Stockholm:20261001T090000',
      'DTEND;TZID=Europe/Stockholm:20261001T100000',
      ['STATUS:CANCELLED'],
      ['Europe/Stockholm'],
    );
    const parsed = new ICalendarEventCodec(() => now).parse(
      'team',
      'cancelled-following.ics',
      source,
    );

    expect(parsed.event.status).toBe('cancelled');
    expect(() =>
      parsed.applyPatch({ recurrence: { following: operation } }),
    ).toThrow(ICalendarEventCodecError);
  });

  it.each([
    [
      'duplicate mixed master statuses',
      ['STATUS:CONFIRMED', 'STATUS:CANCELLED'],
    ],
    ['an unknown master status', ['STATUS:BUSY']],
  ])('rejects %s before following planning', (_label, statusLines) => {
    const source = simpleRecurringSource(
      'DTSTART;TZID=Europe/Stockholm:20261001T090000',
      'DTEND;TZID=Europe/Stockholm:20261001T100000',
      statusLines,
      ['Europe/Stockholm'],
    );
    const parsed = new ICalendarEventCodec(() => now).parse(
      'team',
      'invalid-status-following.ics',
      source,
    );

    expect(() =>
      parsed.applyPatch({ recurrence: { following: operation } }),
    ).toThrow(ICalendarEventCodecError);
  });

  it('rejects alarms, arbitrary overrides, and extra event patches', () => {
    const simple = simpleRecurringSource(
      'DTSTART;TZID=Europe/Stockholm:20261001T090000',
      'DTEND;TZID=Europe/Stockholm:20261001T100000',
      [],
      ['Europe/Stockholm'],
    );
    const deterministicCodec = new ICalendarEventCodec(() => now);
    // Put the VALARM inside the master rather than a detached component.
    const alarmSource = simple.replace(
      'END:VEVENT',
      [
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        'DESCRIPTION:Reminder',
        'TRIGGER:-PT5M',
        'END:VALARM',
        'END:VEVENT',
      ].join('\r\n'),
    );
    expect(() =>
      deterministicCodec
        .parse('team', 'alarm.ics', alarmSource)
        .applyPatch({ recurrence: { following: operation } }),
    ).toThrow(ICalendarEventCodecError);

    const arbitraryOverride = withDetachedEvents(simple, [
      [
        'BEGIN:VEVENT',
        'UID:simple-recurring@example.test',
        'RECURRENCE-ID;TZID=Europe/Stockholm:20261002T090000',
        'DTSTART;TZID=Europe/Stockholm:20261002T110000',
        'DTEND;TZID=Europe/Stockholm:20261002T120000',
        'SUMMARY:Different title',
        'END:VEVENT',
      ].join('\r\n'),
    ]);
    expect(() =>
      deterministicCodec
        .parse('team', 'arbitrary.ics', arbitraryOverride)
        .applyPatch({ recurrence: { following: operation } }),
    ).toThrow(ICalendarEventCodecError);

    expect(() =>
      deterministicCodec
        .parse('team', 'extra-patch.ics', simple)
        .applyPatch({ title: 'Changed', recurrence: { following: operation } }),
    ).toThrow(ICalendarEventCodecError);
  });
});

describe('ICalendarEventCodec', () => {
  it('decodes supported VEVENT fields into the calendar domain', () => {
    const parsed = codec.parse(
      'team',
      'simple-timed.ics',
      fixture('simple-timed.ics'),
    );

    expect(parsed.event).toMatchObject({
      id: 'simple-timed.ics',
      calendarId: 'team',
      uid: 'simple-timed@example.test',
      title: 'Team planning',
      description: 'Planning session for the team.',
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
      status: 'confirmed',
      transparency: 'opaque',
      location: 'Room 3',
      url: 'https://example.test/events/simple-timed',
      categories: ['TEAM', 'PLANNING'],
      priority: 5,
    });
    expect(parsed.event.unsupportedTimezone).toBeUndefined();
  });

  it('serializes a one-occurrence timing write without changing the master', () => {
    const source = simpleRecurringSource(
      'DTSTART;TZID=Europe/Stockholm:20261001T090000',
      'DTEND;TZID=Europe/Stockholm:20261001T100000',
      ['CREATED:20260921T100000Z', 'SEQUENCE:4'],
      ['Europe/Stockholm'],
    );
    const fixedCodec = new ICalendarEventCodec(
      () => new Date('2026-10-03T15:16:17.987Z'),
    );
    const parsed = fixedCodec.parse('team', 'instance-write.ics', source);
    const patch = {
      recurrence: {
        occurrence: {
          action: 'set-timing',
          recurrenceId: {
            type: 'date-time',
            value: {
              local: '2026-10-02T09:00:00',
              timezone: 'Europe/Stockholm',
            },
          },
          timing: {
            type: 'end',
            start: {
              type: 'date-time',
              value: {
                local: '2026-10-02T11:00:00',
                timezone: 'Europe/Stockholm',
              },
            },
            end: {
              type: 'date-time',
              value: {
                local: '2026-10-02T12:00:00',
                timezone: 'Europe/Stockholm',
              },
            },
          },
          viewerTimezone: 'America/Los_Angeles',
        },
      },
    } as unknown as CalendarEventPatch;
    const updated = parsed.applyPatch(patch);
    const output = ICAL.Component.fromString(updated.icalendar);
    const events = output.getAllSubcomponents('vevent');

    expect(events).toHaveLength(2);
    expect(events[0].getFirstPropertyValue('rrule')?.toString()).toBe(
      'FREQ=DAILY;COUNT=3',
    );
    expect(events[0].getFirstPropertyValue('dtstart')?.toString()).toBe(
      '2026-10-01T09:00:00',
    );
    expect(revisionPropertyLines(events[0])).toEqual([
      'DTSTAMP:20260922T120000Z',
      'CREATED:20260921T100000Z',
      'SEQUENCE:4',
    ]);
    expect(events[1].getFirstProperty('recurrence-id')?.toICALString()).toBe(
      'RECURRENCE-ID;TZID=Europe/Stockholm:20261002T090000',
    );
    expect(events[1].getFirstPropertyValue('dtstart')?.toString()).toBe(
      '2026-10-02T11:00:00',
    );
    expect(events[1].getFirstPropertyValue('dtend')?.toString()).toBe(
      '2026-10-02T12:00:00',
    );
    expect(revisionPropertyLines(events[1])).toEqual([
      'DTSTAMP:20261003T151617Z',
      'CREATED:20260921T100000Z',
      'LAST-MODIFIED:20261003T151617Z',
      'SEQUENCE:5',
    ]);
    expect(updated.event.revision).toEqual(parsed.event.revision);
    expect(updated.event.recurrence?.overrides).toContainEqual({
      recurrenceId: {
        type: 'date-time',
        value: {
          local: '2026-10-02T09:00:00',
          timezone: 'Europe/Stockholm',
        },
      },
      title: 'Simple recurring event',
      timing: {
        type: 'end',
        start: {
          type: 'date-time',
          value: {
            local: '2026-10-02T11:00:00',
            timezone: 'Europe/Stockholm',
          },
        },
        end: {
          type: 'date-time',
          value: {
            local: '2026-10-02T12:00:00',
            timezone: 'Europe/Stockholm',
          },
        },
      },
    });
  });

  it('preserves raw revision lines for the untouched master and sibling overrides', () => {
    const master = simpleRecurringSource(
      'DTSTART:20261001T090000',
      'DTEND:20261001T100000',
      [
        'SEQUENCE:4junk',
        'LAST-MODIFIED:20260920T101112Z',
        'LAST-MODIFIED:duplicate-master-value',
      ],
    );
    const sibling = [
      'BEGIN:VEVENT',
      'UID:simple-recurring@example.test',
      'DTSTAMP:20260922T120000Z',
      'SEQUENCE:0004',
      'SEQUENCE:4junk',
      'RECURRENCE-ID:20261003T090000',
      'DTSTART:20261003T090000',
      'DTEND:20261003T100000',
      'X-OVERRIDE-MARKER:untouched',
      'END:VEVENT',
    ].join('\r\n');
    const source = withDetachedEvents(master, [sibling]);
    const parsed = codec.parse('team', 'raw-revisions.ics', source);
    const result = parsed.applyPatch({
      recurrence: {
        occurrence: {
          action: 'set-timing',
          recurrenceId: {
            type: 'floating-date-time',
            value: '2026-10-02T09:00:00',
          },
          timing: {
            type: 'end',
            start: {
              type: 'floating-date-time',
              value: '2026-10-02T11:00:00',
            },
            end: {
              type: 'floating-date-time',
              value: '2026-10-02T12:00:00',
            },
          },
          viewerTimezone: 'UTC',
        },
      },
    });

    const sourceBlocks = rawVeventBlocks(source);
    const outputBlocks = rawVeventBlocks(result.icalendar);
    expect(outputBlocks).toHaveLength(3);
    expect(rawRevisionLines(outputBlocks[0])).toEqual(
      rawRevisionLines(sourceBlocks[0]),
    );
    expect(rawRevisionLines(outputBlocks[1])).toEqual(
      rawRevisionLines(sourceBlocks[1]),
    );
  });

  it('returns the original bytes for an exact existing override timing', () => {
    const source = withDetachedEvents(
      simpleRecurringSource(
        'DTSTART:20261001T090000',
        'DTEND:20261001T100000',
        ['SEQUENCE:4'],
      ),
      [
        [
          'BEGIN:VEVENT',
          'UID:simple-recurring@example.test',
          'DTSTAMP:20260922T120000Z',
          'CREATED:20260921T100000Z',
          'LAST-MODIFIED:20260922T120000Z',
          'SEQUENCE:2',
          'RECURRENCE-ID:20261002T090000',
          'DTSTART:20261002T110000',
          'DTEND:20261002T120000',
          'END:VEVENT',
        ].join('\r\n'),
      ],
    );
    const patch: CalendarEventPatch = {
      recurrence: {
        occurrence: {
          action: 'set-timing',
          recurrenceId: {
            type: 'floating-date-time',
            value: '2026-10-02T09:00:00',
          },
          timing: {
            type: 'end',
            start: {
              type: 'floating-date-time',
              value: '2026-10-02T11:00:00',
            },
            end: {
              type: 'floating-date-time',
              value: '2026-10-02T12:00:00',
            },
          },
          viewerTimezone: 'UTC',
        },
      },
    };

    const parsed = codec.parse('team', 'exact-override.ics', source);
    const result = parsed.applyPatch(patch);

    expect(result.icalendar).toBe(source);
    expect(result.event.revision).toEqual(parsed.event.revision);
  });

  it('rejects a raw RECURRENCE-ID that duplicates TZID parameters', () => {
    const source = withDetachedEvents(
      simpleRecurringSource(
        'DTSTART;TZID=Europe/Stockholm:20261001T090000',
        'DTEND;TZID=Europe/Stockholm:20261001T100000',
        [],
        ['Europe/Stockholm', 'America/Los_Angeles'],
      ),
      [
        [
          'BEGIN:VEVENT',
          'UID:simple-recurring@example.test',
          'DTSTAMP:20260922T120000Z',
          'RECURRENCE-ID;TZID=Europe/Stockholm;TZID=America/Los_Angeles:20261002T090000',
          'DTSTART;TZID=Europe/Stockholm:20261002T110000',
          'DTEND;TZID=Europe/Stockholm:20261002T120000',
          'END:VEVENT',
        ].join('\r\n'),
      ],
    );

    expect(() => {
      codec.parse('team', 'ambiguous-identity.ics', source).applyPatch({
        recurrence: {
          occurrence: {
            action: 'set-timing',
            recurrenceId: {
              type: 'date-time',
              value: {
                local: '2026-10-02T09:00:00',
                timezone: 'Europe/Stockholm',
              },
            },
            timing: {
              type: 'end',
              start: {
                type: 'date-time',
                value: {
                  local: '2026-10-02T11:00:00',
                  timezone: 'Europe/Stockholm',
                },
              },
              end: {
                type: 'date-time',
                value: {
                  local: '2026-10-02T12:00:00',
                  timezone: 'Europe/Stockholm',
                },
              },
            },
            viewerTimezone: 'Europe/Stockholm',
          },
        },
      });
    }).toThrow(ICalendarEventCodecError);
  });

  it.each([
    {
      recurrenceId: 'RECURRENCE-ID:20261032T090000',
      start: 'DTSTART:20261101T110000',
      end: 'DTEND:20261101T120000',
    },
    {
      recurrenceId: 'RECURRENCE-ID:20261101T090000',
      start: 'DTSTART:20261032T110000',
      end: 'DTEND:20261101T120000',
    },
  ])(
    'rejects a non-canonical raw occurrence identity or DTSTART ($recurrenceId)',
    ({ recurrenceId, start, end }) => {
      const master = simpleRecurringSource(
        'DTSTART:20261001T090000',
        'DTEND:20261001T100000',
      ).replace('RRULE:FREQ=DAILY;COUNT=3', 'RRULE:FREQ=DAILY;COUNT=40');
      const source = withDetachedEvents(master, [
        [
          'BEGIN:VEVENT',
          'UID:simple-recurring@example.test',
          'DTSTAMP:20260922T120000Z',
          recurrenceId,
          start,
          end,
          'END:VEVENT',
        ].join('\r\n'),
      ]);

      expect(() =>
        codec.parse('team', 'normalized-date.ics', source).applyPatch({
          recurrence: {
            occurrence: {
              action: 'set-timing',
              recurrenceId: {
                type: 'floating-date-time',
                value: '2026-11-01T09:00:00',
              },
              timing: {
                type: 'end',
                start: {
                  type: 'floating-date-time',
                  value: '2026-11-01T13:00:00',
                },
                end: {
                  type: 'floating-date-time',
                  value: '2026-11-01T14:00:00',
                },
              },
              viewerTimezone: 'UTC',
            },
          },
        }),
      ).toThrow(ICalendarEventCodecError);
    },
  );

  it('rejects unrelated fields in an occurrence timing write', () => {
    const parsed = codec.parse(
      'team',
      'instance-write-extra.ics',
      simpleRecurringSource('DTSTART:20261001T090000', 'DTEND:20261001T100000'),
    );

    const patch = {
      title: 'Must stay a series edit',
      recurrence: {
        occurrence: {
          action: 'set-timing',
          recurrenceId: {
            type: 'floating-date-time',
            value: '2026-10-02T09:00:00',
          },
          timing: {
            type: 'end',
            start: {
              type: 'floating-date-time',
              value: '2026-10-02T11:00:00',
            },
            end: {
              type: 'floating-date-time',
              value: '2026-10-02T12:00:00',
            },
          },
          viewerTimezone: 'UTC',
        },
      },
    } as unknown as CalendarEventPatch;
    expect(() => parsed.applyPatch(patch)).toThrow(ICalendarEventCodecError);
  });

  it('creates UTC whole-second revision metadata from one clock instant', () => {
    let clockCalls = 0;
    const fixedClock = () => {
      clockCalls += 1;
      return new Date(
        `2026-10-03T15:16:${String(16 + clockCalls).padStart(2, '0')}.987Z`,
      );
    };
    const fixedCodec = new ICalendarEventCodec(fixedClock);
    const created = fixedCodec.create('team', 'created.ics', {
      uid: 'created@example.test',
      title: 'New event',
      timing: {
        type: 'timed',
        start: { type: 'floating', local: '2026-10-04T09:00:00' },
        end: { type: 'floating', local: '2026-10-04T10:00:00' },
      },
    });
    const vevent = ICAL.Component.fromString(
      created.icalendar,
    ).getFirstSubcomponent('vevent')!;

    expect(revisionPropertyLines(vevent)).toEqual([
      'DTSTAMP:20261003T151617Z',
      'CREATED:20261003T151617Z',
      'LAST-MODIFIED:20261003T151617Z',
      'SEQUENCE:0',
    ]);
    expect(created.event.revision).toEqual({
      dtstamp: '2026-10-03T15:16:17Z',
      created: '2026-10-03T15:16:17Z',
      lastModified: '2026-10-03T15:16:17Z',
      sequence: 0,
    });
    expect(clockCalls).toBe(1);
    expect(
      fixedCodec.parse('team', 'created.ics', created.icalendar).event.revision,
    ).toEqual(created.event.revision);
  });

  it('revises an edited event once while preserving CREATED and scheduling data', () => {
    let clockCalls = 0;
    const fixedCodec = new ICalendarEventCodec(() => {
      clockCalls += 1;
      return new Date(
        `2026-10-03T15:16:${String(16 + clockCalls).padStart(2, '0')}.987Z`,
      );
    });
    const source = fixture('interoperable-properties.ics');
    const sourceVevent =
      ICAL.Component.fromString(source).getFirstSubcomponent('vevent')!;
    const parsed = fixedCodec.parse('team', 'interoperable.ics', source);
    expect(parsed.event.revision).toEqual({
      dtstamp: '2026-09-20T12:00:00Z',
      created: '2026-09-19T08:00:00Z',
      lastModified: '2026-09-21T10:15:00Z',
      sequence: 7,
    });

    const edited = parsed.applyPatch({ title: 'Renamed property fixture' });
    const editedVevent = ICAL.Component.fromString(
      edited.icalendar,
    ).getFirstSubcomponent('vevent')!;

    expect(revisionPropertyLines(editedVevent)).toEqual([
      'DTSTAMP:20261003T151617Z',
      'CREATED:20260919T080000Z',
      'LAST-MODIFIED:20261003T151617Z',
      'SEQUENCE:8',
    ]);
    expect(clockCalls).toBe(1);
    for (const propertyName of [
      'organizer',
      'attendee',
      'attach',
      'conference',
    ]) {
      expect(propertyLines(editedVevent, propertyName)).toEqual(
        propertyLines(sourceVevent, propertyName),
      );
    }
    expect(
      editedVevent
        .getAllSubcomponents('valarm')
        .map((alarm) => alarm.toString()),
    ).toEqual(
      sourceVevent
        .getAllSubcomponents('valarm')
        .map((alarm) => alarm.toString()),
    );
    expect(
      fixedCodec.parse('team', 'interoperable.ics', edited.icalendar).event
        .revision,
    ).toEqual({
      dtstamp: '2026-10-03T15:16:17Z',
      created: '2026-09-19T08:00:00Z',
      lastModified: '2026-10-03T15:16:17Z',
      sequence: 8,
    });
  });

  it.each([
    ['negative sequence', 'SEQUENCE:-1', undefined],
    ['malformed sequence', 'SEQUENCE:not-a-number', undefined],
    ['malformed sequence property name', 'SEQUENCE :7', undefined],
    ['sequence above RFC INTEGER range', 'SEQUENCE:2147483648', undefined],
    ['duplicate sequence', 'SEQUENCE:7\r\nSEQUENCE:8', undefined],
    ['sequence at RFC INTEGER maximum', 'SEQUENCE:2147483647', 2147483647],
  ])(
    'preserves revision metadata on an edit with %s',
    (_label, sequence, projectedSequence) => {
      const source = fixture('interoperable-properties.ics').replace(
        'SEQUENCE:7',
        sequence,
      );
      const fixedCodec = new ICalendarEventCodec(
        () => new Date('2026-10-03T15:16:17Z'),
      );
      const sourceVevent =
        ICAL.Component.fromString(source).getFirstSubcomponent('vevent')!;
      const edited = fixedCodec
        .parse('team', 'opaque-sequence.ics', source)
        .applyPatch({ title: 'Updated despite opaque sequence' });
      const editedVevent = ICAL.Component.fromString(
        edited.icalendar,
      ).getFirstSubcomponent('vevent')!;

      expect(edited.icalendar).toContain(sequence);
      expect(edited.event.revision?.sequence).toBe(projectedSequence);
      expect(revisionPropertyLines(editedVevent)).toEqual(
        revisionPropertyLines(sourceVevent),
      );
      expect(editedVevent.getFirstPropertyValue('summary')).toBe(
        'Updated despite opaque sequence',
      );
    },
  );

  it.each([
    ['TZID on UTC', 'DTSTAMP;TZID=UTC:20260920T120000Z'],
    ['impossible date', 'DTSTAMP:20260230T120000Z'],
    ['out-of-range time', 'DTSTAMP:20260920T236000Z'],
    ['malformed property name', 'DTSTAMP :20260920T120000Z'],
  ])(
    'preserves an invalid timestamp block with %s on edit',
    (_label, dtstamp) => {
      const source = fixture('interoperable-properties.ics').replace(
        'DTSTAMP:20260920T120000Z',
        dtstamp,
      );
      const fixedCodec = new ICalendarEventCodec(
        () => new Date('2026-10-03T15:16:17Z'),
      );
      const parsed = fixedCodec.parse('team', 'invalid-stamp.ics', source);

      expect(parsed.event.revision?.dtstamp).toBeUndefined();
      const edited = parsed.applyPatch({ title: 'Keep the timestamp opaque' });

      expect(edited.icalendar).toContain(dtstamp);
      expect(edited.icalendar).toContain('CREATED:20260919T080000Z');
      expect(edited.icalendar).toContain('LAST-MODIFIED:20260921T101500Z');
      expect(edited.icalendar).toContain('SEQUENCE:7');
    },
  );

  it('preserves the full revision block when LAST-MODIFIED has a malformed name', () => {
    const source = fixture('interoperable-properties.ics').replace(
      'LAST-MODIFIED:20260921T101500Z',
      'LAST-MODIFIED :20260921T101500Z',
    );
    const fixedCodec = new ICalendarEventCodec(
      () => new Date('2026-10-03T15:16:17Z'),
    );
    const parsed = fixedCodec.parse('team', 'opaque-modified.ics', source);
    expect(parsed.event.revision?.lastModified).toBeUndefined();
    const edited = parsed.applyPatch({
      title: 'Keep revision metadata opaque',
    });
    expect(edited.icalendar).toContain('LAST-MODIFIED :20260921T101500Z');
    expect(edited.icalendar).toContain('DTSTAMP:20260920T120000Z');
    expect(edited.icalendar).toContain('SEQUENCE:7');
    expect(edited.icalendar).not.toContain('20261003T151617Z');
  });

  it('keeps a malformed CREATED name opaque when other metadata advances', () => {
    const source = fixture('interoperable-properties.ics').replace(
      'CREATED:20260919T080000Z',
      'CREATED :20260919T080000Z',
    );
    const fixedCodec = new ICalendarEventCodec(
      () => new Date('2026-10-03T15:16:17Z'),
    );
    const parsed = fixedCodec.parse('team', 'opaque-created.ics', source);
    expect(parsed.event.revision?.created).toBeUndefined();
    const edited = parsed.applyPatch({ title: 'Advance valid metadata' });
    expect(edited.event.revision?.created).toBeUndefined();
    expect(edited.event.revision?.sequence).toBe(8);
    expect(edited.icalendar).toContain('CREATED :20260919T080000Z');
    expect(edited.icalendar).toContain('DTSTAMP:20261003T151617Z');
    expect(
      fixedCodec.parse('team', 'opaque-created.ics', edited.icalendar).event
        .revision?.created,
    ).toBeUndefined();
  });

  it('keeps an invalid CREATED opaque in the projection when other metadata advances', () => {
    const source = fixture('interoperable-properties.ics').replace(
      'CREATED:20260919T080000Z',
      'CREATED:20260230T080000Z',
    );
    const fixedCodec = new ICalendarEventCodec(
      () => new Date('2026-10-03T15:16:17Z'),
    );

    const edited = fixedCodec
      .parse('team', 'invalid-created.ics', source)
      .applyPatch({ title: 'Advance a valid event revision' });

    expect(edited.icalendar).toContain('CREATED:20260230T080000Z');
    expect(edited.event.revision).toEqual({
      dtstamp: '2026-10-03T15:16:17Z',
      lastModified: '2026-10-03T15:16:17Z',
      sequence: 8,
    });
  });

  it('round-trips all-day DATE timing while patching supported fields', () => {
    const parsed = codec.parse('team', 'all-day.ics', fixture('all-day.ics'));

    const encoded = parsed.applyPatch({
      title: 'Updated company holiday',
      description: 'Office closed',
    });

    expect(encoded.event.timing).toEqual({
      type: 'all-day',
      startDate: '2026-10-05',
      endDate: '2026-10-06',
    });

    const reparsed = codec.parse('team', 'all-day.ics', encoded.icalendar);
    expect(reparsed.event.title).toBe('Updated company holiday');
    expect(reparsed.event.description).toBe('Office closed');
    expect(reparsed.event.timing).toEqual(parsed.event.timing);
  });

  it('round-trips named TZID values and preserves VTIMEZONE', () => {
    const parsed = codec.parse(
      'team',
      'vtimezone.ics',
      fixture('vtimezone.ics'),
    );

    expect(parsed.event.timing).toEqual({
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
    });

    const encoded = parsed.applyPatch({ title: 'Updated timezone event' });
    const calendar = ICAL.Component.fromString(encoded.icalendar);

    expect(calendar.getFirstSubcomponent('vtimezone')).not.toBeNull();
    expect(
      calendar.getFirstSubcomponent('vtimezone')?.getFirstPropertyValue('tzid'),
    ).toBe('Europe/Stockholm');

    const reparsed = codec.parse('team', 'vtimezone.ics', encoded.icalendar);
    expect(reparsed.event.timing).toEqual(parsed.event.timing);
  });

  it('accepts an embedded VTIMEZONE that matches bundled IANA transition rules', () => {
    const parsed = codec.parse(
      'team',
      'vtimezone-stockholm-bundled-transition.ics',
      fixture('vtimezone-stockholm-bundled-transition.ics'),
    );

    expect(parsed.event.unsupportedTimezone).toBeUndefined();
  });

  it('keeps a divergent recognized VTIMEZONE opaque and preserves its source rules', () => {
    const source = fixture('vtimezone-stockholm-divergent-transition.ics');
    const parsed = codec.parse(
      'team',
      'vtimezone-stockholm-divergent-transition.ics',
      source,
    );

    expect(parsed.event.unsupportedTimezone).toBe(true);
    expect(() =>
      parsed.applyPatch({
        timing: parsed.event.timing,
      }),
    ).toThrow(
      new ICalendarEventCodecError(
        'unsupported-patch',
        'Timing edits are not supported for events with unsupported timezone rules',
      ),
    );

    const patched = parsed.applyPatch({ title: 'Renamed opaque event' });
    expect(patched.icalendar).toContain('DTSTART:19701025T040000');
    expect(patched.icalendar).toContain('SUMMARY:Renamed opaque event');
    expect(
      codec.parse(
        'team',
        'vtimezone-stockholm-divergent-transition.ics',
        patched.icalendar,
      ).event.unsupportedTimezone,
    ).toBe(true);
  });

  it('checks timezone IDs referenced only by RDATE values and detached overrides', () => {
    const base = fixture(
      'vtimezone-stockholm-divergent-transition.ics',
    ).replace(/\r\n/g, '\n');
    const utcMaster = base
      .replace(
        'DTSTART;TZID=Europe/Stockholm:20261025T031500',
        'DTSTART:20261025T011500Z',
      )
      .replace(
        'DTEND;TZID=Europe/Stockholm:20261025T034500',
        'DTEND:20261025T014500Z',
      );
    const rdateSource = utcMaster.replace(
      'RRULE:FREQ=YEARLY;COUNT=2',
      'RRULE:FREQ=YEARLY;COUNT=2\nRDATE;TZID=Europe/Stockholm:20261025T031500',
    );
    const overrideSource = utcMaster.replace(
      'END:VEVENT\nEND:VCALENDAR',
      [
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:stockholm-transition@example.test',
        'DTSTAMP:20260922T120000Z',
        'RECURRENCE-ID;TZID=Europe/Stockholm:20271031T031500',
        'DTSTART;TZID=Europe/Stockholm:20271031T041500',
        'DTEND;TZID=Europe/Stockholm:20271031T044500',
        'SUMMARY:Detached transition occurrence',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\n'),
    );

    expect(
      codec.parse('team', 'rdate-zone.ics', rdateSource).event
        .unsupportedTimezone,
    ).toBe(true);
    expect(
      codec.parse('team', 'override-zone.ics', overrideSource).event
        .unsupportedTimezone,
    ).toBe(true);
  });

  it('reads and preserves master floating DATE-TIME values on a non-timing patch', () => {
    const parsed = codec.parse(
      'team',
      'floating-timed.ics',
      fixture('floating-timed.ics'),
    );

    expect(parsed.event.timing).toEqual({
      type: 'timed',
      start: { type: 'floating', local: '2026-09-23T09:00:00' },
      end: { type: 'floating', local: '2026-09-23T10:00:00' },
    });

    const encoded = parsed.applyPatch({ title: 'Updated floating planning' });
    const calendar = ICAL.Component.fromString(encoded.icalendar);
    const vevent = calendar.getFirstSubcomponent('vevent')!;
    const start = vevent.getFirstProperty('dtstart')!;
    const end = vevent.getFirstProperty('dtend')!;

    expect(start.getFirstParameter('tzid')).toBeUndefined();
    expect(end.getFirstParameter('tzid')).toBeUndefined();
    expect(start.getFirstValue()?.toString()).toBe('2026-09-23T09:00:00');
    expect(end.getFirstValue()?.toString()).toBe('2026-09-23T10:00:00');
    expect(vevent.getFirstPropertyValue('x-client-marker')).toBe(
      'preserve-floating',
    );
    expect(
      codec.parse('team', 'floating-timed.ics', encoded.icalendar).event.timing,
    ).toEqual(parsed.event.timing);
  });

  it('writes and reparses floating timing patches without TZID or UTC markers', () => {
    const parsed = codec.parse(
      'team',
      'simple-timed.ics',
      fixture('simple-timed.ics'),
    );

    const encoded = parsed.applyPatch({
      timing: {
        type: 'timed',
        start: { type: 'floating', local: '2026-09-24T11:30:00' },
        end: { type: 'floating', local: '2026-09-24T12:15:00' },
      },
    });
    const vevent = ICAL.Component.fromString(
      encoded.icalendar,
    ).getFirstSubcomponent('vevent')!;
    const start = vevent.getFirstProperty('dtstart')!;
    const end = vevent.getFirstProperty('dtend')!;

    expect(start.getFirstParameter('tzid')).toBeUndefined();
    expect(end.getFirstParameter('tzid')).toBeUndefined();
    expect(start.getFirstValue()?.toString()).toBe('2026-09-24T11:30:00');
    expect(end.getFirstValue()?.toString()).toBe('2026-09-24T12:15:00');
    expect(encoded.icalendar).not.toContain('TZID=');
    expect(encoded.icalendar).not.toMatch(/DTSTART[^\r\n]*Z/);
    expect(encoded.icalendar).not.toMatch(/DTEND[^\r\n]*Z/);
    expect(
      codec.parse('team', 'simple-timed.ics', encoded.icalendar).event.timing,
    ).toEqual(encoded.event.timing);
  });

  it('keeps UTC master DATE-TIME endpoints tagged as zoned UTC', () => {
    const icalendar = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Matrix Calendar Widget//Tests//EN',
      'BEGIN:VEVENT',
      'UID:utc-master@example.test',
      'DTSTAMP:20260922T120000Z',
      'DTSTART:20260923T090000Z',
      'DTEND:20260923T100000Z',
      'SUMMARY:UTC event',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const parsed = codec.parse('team', 'utc-master.ics', icalendar);

    expect(parsed.event.timing).toEqual({
      type: 'timed',
      start: {
        type: 'zoned',
        local: '2026-09-23T09:00:00',
        timezone: 'UTC',
      },
      end: {
        type: 'zoned',
        local: '2026-09-23T10:00:00',
        timezone: 'UTC',
      },
    });
  });

  it('preserves floating and zoned master endpoints independently', () => {
    const icalendar = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Matrix Calendar Widget//Tests//EN',
      'BEGIN:VEVENT',
      'UID:mixed-master@example.test',
      'DTSTAMP:20260922T120000Z',
      'DTSTART:20260923T090000',
      'DTEND;TZID=Europe/Stockholm:20260923T100000',
      'SUMMARY:Mixed endpoint event',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const parsed = codec.parse('team', 'mixed-master.ics', icalendar);

    expect(parsed.event.timing).toEqual({
      type: 'timed',
      start: { type: 'floating', local: '2026-09-23T09:00:00' },
      end: {
        type: 'zoned',
        local: '2026-09-23T10:00:00',
        timezone: 'Europe/Stockholm',
      },
    });

    const patched = codec.parse(
      'team',
      'mixed-master.ics',
      parsed.applyPatch({ title: 'Renamed mixed endpoint event' }).icalendar,
    );
    expect(patched.event.timing).toEqual(parsed.event.timing);

    const timingPatch = parsed.applyPatch({
      timing: {
        type: 'timed',
        start: { type: 'floating', local: '2026-09-23T11:00:00' },
        end: {
          type: 'zoned',
          local: '2026-09-23T12:00:00',
          timezone: 'Europe/Stockholm',
        },
      },
    });
    const vevent = ICAL.Component.fromString(
      timingPatch.icalendar,
    ).getFirstSubcomponent('vevent')!;
    expect(
      vevent.getFirstProperty('dtstart')?.getFirstParameter('tzid'),
    ).toBeUndefined();
    expect(vevent.getFirstProperty('dtend')?.getFirstParameter('tzid')).toBe(
      'Europe/Stockholm',
    );
    expect(
      codec.parse('team', 'mixed-master.ics', timingPatch.icalendar).event
        .timing,
    ).toEqual(timingPatch.event.timing);
  });

  it('preserves different endpoint TZIDs through title and timing patches', () => {
    const icalendar = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Matrix Calendar Widget//Tests//EN',
      'BEGIN:VEVENT',
      'UID:two-zones@example.test',
      'DTSTAMP:20260922T120000Z',
      'DTSTART;TZID=Europe/Stockholm:20260923T100000',
      'DTEND;TZID=America/New_York:20260923T053000',
      'SUMMARY:Two-zone event',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const parsed = codec.parse('team', 'two-zones.ics', icalendar);

    expect(parsed.event.timing).toEqual({
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
    });

    const titlePatch = parsed.applyPatch({ title: 'Renamed two-zone event' });
    expect(titlePatch.icalendar).toContain(
      'DTSTART;TZID=Europe/Stockholm:20260923T100000',
    );
    expect(titlePatch.icalendar).toContain(
      'DTEND;TZID=America/New_York:20260923T053000',
    );

    const timingPatch = parsed.applyPatch({
      timing: {
        type: 'timed',
        start: {
          type: 'zoned',
          local: '2026-09-23T10:15:00',
          timezone: 'Europe/Stockholm',
        },
        end: {
          type: 'zoned',
          local: '2026-09-23T05:45:00',
          timezone: 'America/New_York',
        },
      },
    });
    expect(
      codec.parse('team', 'two-zones.ics', timingPatch.icalendar).event.timing,
    ).toEqual(timingPatch.event.timing);
  });

  it('rejects a master VEVENT with missing DTEND rather than inferring timing', () => {
    const withoutEnd = fixture('simple-timed.ics').replace(
      /DTEND;TZID=Europe\/Stockholm:20260923T100000\r?\n/,
      '',
    );

    let thrown: unknown;
    try {
      codec.parse('team', 'missing-end.ics', withoutEnd);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      code: 'missing-timing',
      message: 'VEVENT must contain DTSTART and DTEND',
    });
  });

  it('reads recurrence data and preserves a complete recurring resource on master patch', () => {
    const parsed = codec.parse(
      'team',
      'recurrence-override.ics',
      fixture('recurrence-override.ics'),
    );

    expect(parsed.event.recurrence).toEqual({
      rrule: 'FREQ=WEEKLY;COUNT=4',
      rdates: [
        {
          type: 'date-time',
          value: {
            local: '2026-10-26T14:00:00',
            timezone: 'Europe/Stockholm',
          },
        },
        {
          type: 'period',
          timing: {
            type: 'end',
            start: {
              type: 'date-time',
              value: {
                local: '2026-10-28T14:00:00',
                timezone: 'Europe/Stockholm',
              },
            },
            end: {
              type: 'date-time',
              value: {
                local: '2026-10-28T15:30:00',
                timezone: 'Europe/Stockholm',
              },
            },
          },
        },
        {
          type: 'period',
          timing: {
            type: 'duration',
            start: {
              type: 'date-time',
              value: {
                local: '2026-10-29T14:00:00',
                timezone: 'Europe/Stockholm',
              },
            },
            duration: {
              weeks: 0,
              days: 0,
              hours: 1,
              minutes: 30,
              seconds: 0,
              isNegative: false,
            },
          },
        },
      ],
      exdates: [
        {
          type: 'date-time',
          value: {
            local: '2026-11-02T14:00:00',
            timezone: 'Europe/Stockholm',
          },
        },
        {
          type: 'date-time',
          value: {
            local: '2026-11-09T14:00:00',
            timezone: 'Europe/Stockholm',
          },
        },
      ],
      overrides: [
        {
          recurrenceId: {
            type: 'date-time',
            value: {
              local: '2026-10-12T14:00:00',
              timezone: 'Europe/Stockholm',
            },
          },
          title: 'Weekly review - moved',
          timing: {
            type: 'duration',
            start: {
              type: 'date-time',
              value: {
                local: '2026-10-12T16:00:00',
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
        {
          recurrenceId: {
            type: 'date-time',
            value: {
              local: '2026-10-19T14:00:00',
              timezone: 'Europe/Stockholm',
            },
          },
          timing: {
            type: 'end',
            start: {
              type: 'date-time',
              value: {
                local: '2026-10-19T14:00:00',
                timezone: 'Europe/Stockholm',
              },
            },
            end: {
              type: 'date-time',
              value: {
                local: '2026-10-19T15:00:00',
                timezone: 'Europe/Stockholm',
              },
            },
          },
          status: 'cancelled',
        },
      ],
    });

    const encoded = parsed.applyPatch({ title: 'Updated weekly review' });
    const calendar = ICAL.Component.fromString(encoded.icalendar);
    const events = calendar.getAllSubcomponents('vevent');
    const timezone = calendar.getFirstSubcomponent('vtimezone');

    expect(events).toHaveLength(3);
    expect(timezone).not.toBeNull();
    expect(timezone?.getFirstPropertyValue('tzid')).toBe('Europe/Stockholm');
    expect(calendar.getFirstPropertyValue('x-custom-calendar-property')).toBe(
      'preserve-resource-value',
    );
    expect(events[0].getFirstPropertyValue('summary')).toBe(
      'Updated weekly review',
    );
    expect(
      events[0].getFirstSubcomponent('valarm')?.getFirstPropertyValue('action'),
    ).toBe('DISPLAY');
    expect(
      events[0].getFirstProperty('x-client-metadata')?.getFirstValue(),
    ).toBe('preserve-value');
    expect(events[1].getFirstPropertyValue('recurrence-id')?.toString()).toBe(
      '2026-10-12T14:00:00',
    );
    expect(events[1].getFirstPropertyValue('dtstart')?.toString()).toBe(
      '2026-10-12T16:00:00',
    );
    expect(events[1].getFirstPropertyValue('duration')?.toString()).toBe(
      'PT1H',
    );
    expect(events[1].getFirstProperty('dtend')).toBeNull();
    expect(events[1].getFirstPropertyValue('summary')).toBe(
      'Weekly review - moved',
    );
    expect(
      events[1].getFirstProperty('x-override-marker')?.getFirstValue(),
    ).toBe('preserve-exception');
    expect(events[2].getFirstPropertyValue('recurrence-id')?.toString()).toBe(
      '2026-10-19T14:00:00',
    );
    expect(events[2].getFirstPropertyValue('status')).toBe('CANCELLED');
    expect(
      events[2].getFirstProperty('x-override-marker')?.getFirstValue(),
    ).toBe('preserve-cancellation');

    const reparsed = codec.parse(
      'team',
      'recurrence-override.ics',
      encoded.icalendar,
    );
    expect(reparsed.event.recurrence).toEqual(parsed.event.recurrence);
  });

  it('adds and removes only one EXDATE while preserving the complete resource', () => {
    let revisionClockCalls = 0;
    const revisionCodec = new ICalendarEventCodec(() => {
      revisionClockCalls += 1;
      return new Date('2026-10-03T15:16:17Z');
    });
    const parsed = revisionCodec.parse(
      'team',
      'recurrence-override.ics',
      fixture('recurrence-override.ics'),
    );
    const movedOccurrenceId: CalendarEventDateTime = {
      type: 'date-time',
      value: {
        local: '2026-10-12T14:00:00',
        timezone: 'Europe/Stockholm',
      },
    };
    const added = parsed.applyPatch({
      recurrence: {
        exdate: { action: 'add', recurrenceId: movedOccurrenceId },
      },
    });
    expect(added.event.recurrence?.exdates).toEqual([
      {
        type: 'date-time',
        value: {
          local: '2026-11-02T14:00:00',
          timezone: 'Europe/Stockholm',
        },
      },
      {
        type: 'date-time',
        value: {
          local: '2026-11-09T14:00:00',
          timezone: 'Europe/Stockholm',
        },
      },
      movedOccurrenceId,
    ]);
    expect(added.icalendar).toContain(
      'EXDATE;TZID=Europe/Stockholm:20261012T140000',
    );

    const calendar = ICAL.Component.fromString(added.icalendar);
    const events = calendar.getAllSubcomponents('vevent');
    const master = events[0];
    expect(events).toHaveLength(3);
    expect(calendar.getFirstSubcomponent('vtimezone')).not.toBeNull();
    expect(calendar.getFirstPropertyValue('x-custom-calendar-property')).toBe(
      'preserve-resource-value',
    );
    expect(master.getAllProperties('rdate')).toHaveLength(2);
    expect(
      master
        .getFirstProperty('x-client-metadata')
        ?.getFirstParameter('x-param'),
    ).toBe('preserve-param');
    expect(
      master.getFirstSubcomponent('valarm')?.getFirstPropertyValue('action'),
    ).toBe('DISPLAY');
    expect(events[1].getFirstPropertyValue('recurrence-id')?.toString()).toBe(
      '2026-10-12T14:00:00',
    );
    expect(events[1].getFirstPropertyValue('dtstart')?.toString()).toBe(
      '2026-10-12T16:00:00',
    );
    expect(
      events[1].getFirstProperty('x-override-marker')?.getFirstValue(),
    ).toBe('preserve-exception');
    expect(events[2].getFirstPropertyValue('status')).toBe('CANCELLED');

    const idempotentAdd = revisionCodec
      .parse('team', 'recurrence-override.ics', added.icalendar)
      .applyPatch({
        recurrence: {
          exdate: { action: 'add', recurrenceId: movedOccurrenceId },
        },
      });
    expect(revisionClockCalls).toBe(1);
    const addedMaster = ICAL.Component.fromString(
      added.icalendar,
    ).getFirstSubcomponent('vevent')!;
    const idempotentMaster = ICAL.Component.fromString(
      idempotentAdd.icalendar,
    ).getFirstSubcomponent('vevent')!;
    expect(revisionPropertyLines(addedMaster)).toEqual([
      expect.stringMatching(/^DTSTAMP:/),
      expect.stringMatching(/^LAST-MODIFIED:/),
      'SEQUENCE:1',
    ]);
    expect(revisionPropertyLines(idempotentMaster)).toEqual(
      revisionPropertyLines(addedMaster),
    );
    expect(
      codec.parse('team', 'recurrence-override.ics', idempotentAdd.icalendar)
        .event.recurrence?.exdates,
    ).toHaveLength(3);

    const removed = codec
      .parse('team', 'recurrence-override.ics', added.icalendar)
      .applyPatch({
        recurrence: {
          exdate: {
            action: 'remove',
            recurrenceId: {
              type: 'date-time',
              value: {
                local: '2026-11-02T14:00:00',
                timezone: 'Europe/Stockholm',
              },
            },
          },
        },
      });
    expect(removed.event.recurrence?.exdates).toEqual([
      {
        type: 'date-time',
        value: {
          local: '2026-11-09T14:00:00',
          timezone: 'Europe/Stockholm',
        },
      },
      movedOccurrenceId,
    ]);
    const removedCalendar = ICAL.Component.fromString(removed.icalendar);
    expect(removedCalendar.getFirstSubcomponent('vtimezone')).not.toBeNull();
    expect(removedCalendar.getAllSubcomponents('vevent')).toHaveLength(3);
    expect(
      removedCalendar
        .getAllSubcomponents('vevent')[0]
        .getFirstSubcomponent('valarm'),
    ).not.toBeNull();
  });

  it('adds and removes one point RDATE while preserving recurrence siblings', () => {
    const source = fixture('recurrence-override.ics');
    const parsed = codec.parse('team', 'rdate-preservation.ics', source);
    const value: CalendarEventDateTime = {
      type: 'date-time',
      value: {
        local: '2026-10-27T09:30:00',
        timezone: 'Europe/Stockholm',
      },
    };

    const added = parsed.applyPatch({
      recurrence: { rdate: { action: 'add', value } },
    });
    expect(added.event.recurrence?.rdates).toEqual([
      ...(parsed.event.recurrence?.rdates ?? []),
      value,
    ]);
    expect(added.event.recurrence?.exdates).toEqual(
      parsed.event.recurrence?.exdates,
    );

    const calendar = ICAL.Component.fromString(added.icalendar);
    const events = calendar.getAllSubcomponents('vevent');
    const master = events[0];
    expect(events).toHaveLength(3);
    expect(calendar.getFirstSubcomponent('vtimezone')).not.toBeNull();
    expect(calendar.getFirstPropertyValue('x-custom-calendar-property')).toBe(
      'preserve-resource-value',
    );
    expect(master.getFirstProperty('rrule')?.getFirstValue()?.toString()).toBe(
      'FREQ=WEEKLY;COUNT=4',
    );
    expect(added.icalendar).toContain(
      'RDATE;TZID=Europe/Stockholm:20261027T093000',
    );
    expect(master.getAllProperties('exdate')).toHaveLength(2);
    expect(master.getAllProperties('rdate')).toHaveLength(3);
    expect(
      master
        .getFirstProperty('x-client-metadata')
        ?.getFirstParameter('x-param'),
    ).toBe('preserve-param');
    expect(master.getFirstSubcomponent('valarm')).not.toBeNull();
    expect(events[1].getFirstProperty('recurrence-id')).not.toBeNull();
    expect(events[2].getFirstProperty('recurrence-id')).not.toBeNull();
    expect(added.icalendar).toContain('X-OVERRIDE-MARKER;X-ORIGIN=external');

    const removed = codec
      .parse('team', 'rdate-preservation.ics', added.icalendar)
      .applyPatch({
        recurrence: { rdate: { action: 'remove', value } },
      });
    expect(removed.event.recurrence?.rdates).toEqual(
      parsed.event.recurrence?.rdates,
    );
    expect(removed.event.recurrence?.exdates).toEqual(
      parsed.event.recurrence?.exdates,
    );
    expect(removed.icalendar).not.toContain(
      'RDATE;TZID=Europe/Stockholm:20261027T093000',
    );
    expect(
      ICAL.Component.fromString(removed.icalendar).getAllSubcomponents(
        'vevent',
      ),
    ).toHaveLength(3);
  });

  it.each([
    {
      label: 'DATE',
      dtstart: 'DTSTART;VALUE=DATE:20261005',
      dtend: 'DTEND;VALUE=DATE:20261006',
      value: { type: 'date' as const, value: '2026-10-09' },
      expected: 'RDATE;VALUE=DATE:20261009',
    },
    {
      label: 'floating DATE-TIME',
      dtstart: 'DTSTART:20261005T090000',
      dtend: 'DTEND:20261005T100000',
      value: {
        type: 'floating-date-time' as const,
        value: '2026-10-09T09:00:00',
      },
      expected: 'RDATE:20261009T090000',
    },
    {
      label: 'UTC DATE-TIME',
      dtstart: 'DTSTART:20261005T090000Z',
      dtend: 'DTEND:20261005T100000Z',
      value: {
        type: 'date-time' as const,
        value: { local: '2026-10-09T09:00:00', timezone: 'UTC' },
      },
      expected: 'RDATE:20261009T090000Z',
    },
    {
      label: 'TZID DATE-TIME with a different TZID than DTSTART',
      dtstart: 'DTSTART;TZID=Europe/Stockholm:20261005T090000',
      dtend: 'DTEND;TZID=Europe/Stockholm:20261005T100000',
      value: {
        type: 'date-time' as const,
        value: { local: '2026-10-09T11:30:00', timezone: 'America/New_York' },
      },
      timezoneDefinitions: ['Europe/Stockholm', 'America/New_York'],
      expected: 'RDATE;TZID=America/New_York:20261009T113000',
    },
  ])(
    'round-trips a point RDATE as $label',
    ({ dtstart, dtend, value, expected, timezoneDefinitions = [] }) => {
      const parsed = codec.parse(
        'team',
        'typed-rdate.ics',
        simpleRecurringSource(dtstart, dtend, [], timezoneDefinitions),
      );
      const added = parsed.applyPatch({
        recurrence: { rdate: { action: 'add', value } },
      });
      expect(added.icalendar).toContain(expected);
      expect(
        codec.parse('team', 'typed-rdate.ics', added.icalendar).event.recurrence
          ?.rdates,
      ).toContainEqual(value);
    },
  );

  it('preserves a shared PERIOD property and its parameters when removing one list member', () => {
    const source = fixture('recurrence-override.ics').replace(
      'RDATE;TZID=Europe/Stockholm:20261026T140000',
      [
        'RDATE;TZID=Europe/Stockholm:20261026T140000',
        'RDATE;VALUE=PERIOD;TZID=Europe/Stockholm;X-KEEP=shared:20261027T093000/PT1H,20261028T093000/PT2H',
      ].join('\r\n'),
    );
    const parsed = codec.parse('team', 'period-shared-property.ics', source);
    expect(parsed.event.unsupportedTimezone).toBeUndefined();
    const target = parsed.event.recurrence?.rdates?.find(
      (value) =>
        value.type === 'period' &&
        value.timing.type === 'duration' &&
        value.timing.start.type === 'date-time' &&
        value.timing.start.value.local === '2026-10-27T09:30:00',
    );
    expect(target?.type).toBe('period');
    if (!target || target.type !== 'period') {
      throw new Error('Expected selected PERIOD RDATE');
    }

    const removed = parsed.applyPatch({
      recurrence: { rdate: { action: 'remove-period', value: target } },
    });
    const master = ICAL.Component.fromString(
      removed.icalendar,
    ).getAllSubcomponents('vevent')[0];
    const remainingProperty = master
      .getAllProperties('rdate')
      .find((property) => property.getFirstParameter('x-keep') === 'shared');

    expect(remainingProperty).toBeDefined();
    expect(remainingProperty?.getFirstParameter('tzid')).toBe(
      'Europe/Stockholm',
    );
    expect(remainingProperty?.getValues()).toHaveLength(1);
    expect(removed.icalendar).toContain('X-KEEP=shared');
    expect(removed.icalendar).toContain('20261028T093000/PT2H');
    expect(removed.icalendar).not.toContain('20261027T093000/PT1H');
  });

  it.each([
    {
      label: 'equal explicit end',
      value: '20261027T093000/20261027T093000',
    },
    {
      label: 'reversed explicit end',
      value: '20261027T103000/20261027T093000',
    },
    { label: 'zero duration', value: '20261027T093000/PT0S' },
    { label: 'negative duration', value: '20261027T093000/-PT1H' },
    {
      label: 'weeks combined with time units',
      value: '20261027T093000/P1WT1H',
    },
  ])('keeps PERIOD RDATE with $label opaque', ({ value }) => {
    const source = simpleRecurringSource(
      'DTSTART:20261026T093000Z',
      'DTEND:20261026T103000Z',
      ['RDATE;VALUE=PERIOD:' + value],
    );
    const parsed = codec.parse('team', 'invalid-period-rdate.ics', source);

    expect(
      parsed.event.recurrence?.rdates?.some(
        (rdate) => rdate.type === 'period',
      ) ?? false,
    ).toBe(false);
  });

  it('fails closed for stale PERIOD removal, point-only PERIOD writes, and malformed siblings', () => {
    const source = fixture('recurrence-override.ics').replace(
      'RDATE;TZID=Europe/Stockholm:20261026T140000',
      [
        'RDATE;TZID=Europe/Stockholm:20261026T140000',
        'RDATE;VALUE=PERIOD;TZID=Europe/Stockholm:20261027T093000/PT1H',
      ].join('\r\n'),
    );
    const parsed = codec.parse('team', 'period-rdate-fail-closed.ics', source);
    const period = parsed.event.recurrence?.rdates?.find(
      (value) => value.type === 'period',
    );
    expect(period?.type).toBe('period');
    if (!period || period.type !== 'period') {
      throw new Error('Expected PERIOD-valued RDATE');
    }
    const changedStart = {
      type: 'date-time' as const,
      value: {
        local: '2026-10-27T09:31:00',
        timezone: 'Europe/Stockholm',
      },
    };
    const stalePeriod =
      period.timing.type === 'end'
        ? {
            type: 'period' as const,
            timing: { ...period.timing, start: changedStart },
          }
        : {
            type: 'period' as const,
            timing: { ...period.timing, start: changedStart },
          };
    expect(() =>
      parsed.applyPatch({
        recurrence: {
          rdate: {
            action: 'remove-period',
            value: stalePeriod,
          },
        },
      }),
    ).toThrow(ICalendarEventCodecError);
    expect(() =>
      parsed.applyPatch({
        recurrence: {
          rdate: { action: 'add', value: period },
        },
      } as unknown as CalendarEventPatch),
    ).toThrow(ICalendarEventCodecError);
    const duplicatePeriod = parsed.applyPatch({
      recurrence: {
        rdate: { action: 'add-period', value: period },
      },
    });
    expect(
      codec.parse(
        'team',
        'period-rdate-fail-closed.ics',
        duplicatePeriod.icalendar,
      ).event.recurrence?.rdates,
    ).toEqual(parsed.event.recurrence?.rdates);

    const malformed = codec.parse(
      'team',
      'period-rdate-malformed.ics',
      source.replace(
        'RDATE;VALUE=PERIOD;TZID=Europe/Stockholm:20261027T093000/PT1H',
        'RDATE;VALUE=TEXT:unsupported',
      ),
    );
    expect(() =>
      malformed.applyPatch({
        recurrence: { rdate: { action: 'remove-period', value: period } },
      }),
    ).toThrow(ICalendarEventCodecError);
  });

  it('rejects adding a TZID RDATE without a matching source VTIMEZONE', () => {
    const parsed = codec.parse(
      'team',
      'rdate-missing-timezone-definition.ics',
      simpleRecurringSource(
        'DTSTART;TZID=Europe/Stockholm:20261005T090000',
        'DTEND;TZID=Europe/Stockholm:20261005T100000',
        [],
        ['Europe/Stockholm'],
      ),
    );

    expect(() =>
      parsed.applyPatch({
        recurrence: {
          rdate: {
            action: 'add',
            value: {
              type: 'date-time',
              value: {
                local: '2026-10-09T11:30:00',
                timezone: 'America/New_York',
              },
            },
          },
        },
      }),
    ).toThrow(ICalendarEventCodecError);
  });

  it('treats exact DTSTART, RRULE, and existing RDATE additions as no-ops', () => {
    const parsed = codec.parse(
      'team',
      'rdate-noop.ics',
      simpleRecurringSource(
        'DTSTART;TZID=Europe/Stockholm:20261005T090000',
        'DTEND;TZID=Europe/Stockholm:20261005T100000',
        ['RDATE;TZID=Europe/Stockholm:20261007T090000'],
      ),
    );
    const dates: CalendarEventDateTime[] = [
      {
        type: 'date-time',
        value: { local: '2026-10-05T09:00:00', timezone: 'Europe/Stockholm' },
      },
      {
        type: 'date-time',
        value: { local: '2026-10-06T09:00:00', timezone: 'Europe/Stockholm' },
      },
      {
        type: 'date-time',
        value: { local: '2026-10-07T09:00:00', timezone: 'Europe/Stockholm' },
      },
    ];

    for (const value of dates) {
      const added = parsed.applyPatch({
        recurrence: { rdate: { action: 'add', value } },
      });
      expect(added.event.recurrence?.rdates).toEqual(
        parsed.event.recurrence?.rdates,
      );
      expect(
        ICAL.Component.fromString(added.icalendar)
          .getAllSubcomponents('vevent')[0]
          .getAllProperties('rdate'),
      ).toHaveLength(1);
    }
  });

  it('removes only an exact typed RDATE and leaves same-instant sibling forms and EXDATE intact', () => {
    const source = simpleRecurringSource(
      'DTSTART;TZID=Europe/Stockholm:20261005T090000',
      'DTEND;TZID=Europe/Stockholm:20261005T100000',
      [
        'RDATE:20261007T070000Z',
        'RDATE;TZID=America/New_York:20261007T030000',
        'EXDATE;TZID=Europe/Stockholm:20261008T090000',
      ],
    );
    const parsed = codec.parse('team', 'rdate-exact-remove.ics', source);
    const removed = parsed.applyPatch({
      recurrence: {
        rdate: {
          action: 'remove',
          value: {
            type: 'date-time',
            value: { local: '2026-10-07T07:00:00', timezone: 'UTC' },
          },
        },
      },
    });

    expect(removed.event.recurrence?.rdates).toEqual([
      {
        type: 'date-time',
        value: {
          local: '2026-10-07T03:00:00',
          timezone: 'America/New_York',
        },
      },
    ]);
    expect(removed.event.recurrence?.exdates).toEqual(
      parsed.event.recurrence?.exdates,
    );
    expect(removed.icalendar).toContain(
      'RDATE;TZID=America/New_York:20261007T030000',
    );
    expect(removed.icalendar).not.toContain('RDATE:20261007T070000Z');
    expect(removed.icalendar).toContain(
      'EXDATE;TZID=Europe/Stockholm:20261008T090000',
    );
  });

  it.each([
    {
      label: 'explicit end',
      value: {
        type: 'period' as const,
        timing: {
          type: 'end' as const,
          start: {
            type: 'date-time' as const,
            value: {
              local: '2026-10-27T09:30:00',
              timezone: 'Europe/Stockholm',
            },
          },
          end: {
            type: 'date-time' as const,
            value: {
              local: '2026-10-27T10:30:00',
              timezone: 'Europe/Stockholm',
            },
          },
        },
      },
      removedParameter: 'X-KEEP=end',
      removedValue: '20261027T093000/20261027T103000',
      siblingParameter: 'X-KEEP=duration',
      siblingValue: '20261028T093000/PT1H',
    },
    {
      label: 'RFC duration',
      value: {
        type: 'period' as const,
        timing: {
          type: 'duration' as const,
          start: {
            type: 'date-time' as const,
            value: {
              local: '2026-10-28T09:30:00',
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
      removedParameter: 'X-KEEP=duration',
      removedValue: '20261028T093000/PT1H',
      siblingParameter: 'X-KEEP=end',
      siblingValue: '20261027T093000/20261027T103000',
    },
  ])(
    'removes one PERIOD RDATE with $label and preserves resource data',
    ({
      value,
      removedParameter,
      removedValue,
      siblingParameter,
      siblingValue,
    }) => {
      const source = fixture('recurrence-override.ics').replace(
        'RDATE;TZID=Europe/Stockholm:20261026T140000',
        [
          'RDATE;TZID=Europe/Stockholm:20261026T140000',
          'RDATE;VALUE=PERIOD;TZID=Europe/Stockholm;X-KEEP=end:20261027T093000/20261027T103000',
          'RDATE;VALUE=PERIOD;TZID=Europe/Stockholm;X-KEEP=duration:20261028T093000/PT1H',
        ].join('\r\n'),
      );
      const parsed = codec.parse('team', 'period-rdate.ics', source);
      const removed = parsed.applyPatch({
        recurrence: { rdate: { action: 'remove-period', value } },
      });
      const siblingPeriod = parsed.event.recurrence?.rdates?.find(
        (candidate) =>
          candidate.type === 'period' &&
          candidate.timing.type !== value.timing.type,
      );
      const reparsed = codec.parse(
        'team',
        'period-rdate.ics',
        removed.icalendar,
      );
      const unfoldedIcs = removed.icalendar.replace(/\r\n[ \t]/g, '');

      expect(siblingPeriod).toBeDefined();
      expect(reparsed.event.recurrence?.rdates).toContainEqual(siblingPeriod);
      expect(reparsed.event.recurrence?.rdates).not.toContainEqual(value);
      expect(unfoldedIcs).not.toContain(removedParameter);
      expect(unfoldedIcs).not.toContain(removedValue);
      expect(unfoldedIcs).toContain(siblingParameter);
      expect(unfoldedIcs).toContain(siblingValue);
      expect(removed.icalendar).toContain(
        'RDATE;TZID=Europe/Stockholm:20261026T140000',
      );
      expect(removed.icalendar).toContain('BEGIN:VTIMEZONE');
      expect(removed.icalendar).toContain(
        'EXDATE;TZID=Europe/Stockholm:20261102T140000',
      );
      expect(removed.icalendar).toContain(
        'X-CLIENT-METADATA;X-PARAM=preserve-param',
      );
      expect(removed.icalendar).toContain(
        'X-OVERRIDE-MARKER;X-ORIGIN=external',
      );
    },
  );

  it('adds an explicit-end PERIOD RDATE without changing point or PERIOD siblings', () => {
    const source = fixture('recurrence-override.ics').replace(
      'RDATE;TZID=Europe/Stockholm:20261026T140000',
      [
        'RDATE;TZID=Europe/Stockholm:20261026T140000',
        'RDATE;VALUE=PERIOD;TZID=Europe/Stockholm;X-KEEP=sibling:20261027T093000/PT1H',
      ].join('\r\n'),
    );
    const parsed = codec.parse('team', 'period-rdate-add.ics', source);
    const value = {
      type: 'period' as const,
      timing: {
        type: 'end' as const,
        start: {
          type: 'date-time' as const,
          value: { local: '2026-10-29T09:30:00', timezone: 'Europe/Stockholm' },
        },
        end: {
          type: 'date-time' as const,
          value: { local: '2026-10-29T10:30:00', timezone: 'Europe/Stockholm' },
        },
      },
    };
    const added = parsed.applyPatch({
      recurrence: { rdate: { action: 'add-period', value } },
    });
    const replayed = codec
      .parse('team', 'period-rdate-add.ics', added.icalendar)
      .applyPatch({
        recurrence: { rdate: { action: 'add-period', value } },
      });
    const reparsed = codec.parse(
      'team',
      'period-rdate-add.ics',
      replayed.icalendar,
    );
    const unfolded = replayed.icalendar.replace(/\r\n[ \t]/g, '');

    expect(
      reparsed.event.recurrence?.rdates?.filter(
        (candidate) => JSON.stringify(candidate) === JSON.stringify(value),
      ),
    ).toEqual([value]);
    expect(unfolded).toContain(
      'RDATE;TZID=Europe/Stockholm;VALUE=PERIOD:20261029T093000/20261029T103000',
    );
    expect(
      unfolded.match(
        /RDATE;TZID=Europe\/Stockholm;VALUE=PERIOD:20261029T093000\/20261029T103000/g,
      ),
    ).toHaveLength(1);
    expect(unfolded).toContain('20261026T140000');
    expect(unfolded).toContain(
      'X-KEEP=sibling;VALUE=PERIOD:20261027T093000/PT1H',
    );
  });

  it('adds a duration-form PERIOD RDATE and preserves DTSTART, siblings, and resource data', () => {
    const parsed = codec.parse(
      'team',
      'period-rdate-duration-add.ics',
      fixture('recurrence-override.ics'),
    );
    const value = {
      type: 'period' as const,
      timing: {
        type: 'duration' as const,
        start: {
          type: 'date-time' as const,
          value: { local: '2026-10-30T09:30:00', timezone: 'Europe/Stockholm' },
        },
        duration: {
          weeks: 0,
          days: 1,
          hours: 2,
          minutes: 0,
          seconds: 0,
          isNegative: false,
        },
      },
    };
    const added = parsed.applyPatch({
      recurrence: { rdate: { action: 'add-period', value } },
    });
    const replayed = codec
      .parse('team', 'period-rdate-duration-add.ics', added.icalendar)
      .applyPatch({
        recurrence: { rdate: { action: 'add-period', value } },
      });
    const unfolded = replayed.icalendar.replace(/\r\n[ \t]/g, '');
    const reparsed = codec.parse(
      'team',
      'period-rdate-duration-add.ics',
      replayed.icalendar,
    );

    expect(replayed.icalendar).toBe(added.icalendar);
    expect(reparsed.event.recurrence?.rdates).toContainEqual(value);
    expect(
      unfolded.match(
        /RDATE;TZID=Europe\/Stockholm;VALUE=PERIOD:20261030T093000\/P1DT2H/g,
      ),
    ).toHaveLength(1);
    expect(unfolded).toContain('DTSTART;TZID=Europe/Stockholm:20261005T140000');
    expect(unfolded).toContain(
      'RDATE;TZID=Europe/Stockholm;VALUE=PERIOD:20261028T140000/20261028T153000',
    );
    expect(unfolded).toContain('20261029T140000/PT1H30M');
    expect(unfolded).toContain(
      'X-CLIENT-METADATA;X-PARAM=preserve-param:preserve-value',
    );
    expect(unfolded).toContain('X-OVERRIDE-MARKER;X-ORIGIN=external');
    expect(unfolded).toContain('BEGIN:VTIMEZONE');
  });

  it('adds a floating duration-form PERIOD without binding it to a timezone', () => {
    const parsed = codec.parse(
      'team',
      'floating-period-rdate-add.ics',
      fixture('recurrence-floating-override.ics'),
    );
    const value = {
      type: 'period' as const,
      timing: {
        type: 'duration' as const,
        start: {
          type: 'floating-date-time' as const,
          value: '2026-10-19T14:00:00',
        },
        duration: {
          weeks: 1,
          days: 0,
          hours: 0,
          minutes: 0,
          seconds: 0,
          isNegative: false,
        },
      },
    };
    const added = parsed.applyPatch({
      recurrence: { rdate: { action: 'add-period', value } },
    });
    const reparsed = codec.parse(
      'team',
      'floating-period-rdate-add.ics',
      added.icalendar,
    );
    const unfolded = added.icalendar.replace(/\r\n[ \t]/g, '');

    expect(reparsed.event.recurrence?.rdates).toContainEqual(value);
    expect(unfolded).toContain('RDATE;VALUE=PERIOD:20261019T140000/P1W');
    expect(unfolded).not.toContain('RDATE;TZID=');
    expect(unfolded).not.toMatch(/RDATE[^\r\n]*Z/);
  });

  it('adds a UTC duration-form PERIOD while retaining the UTC marker', () => {
    const parsed = codec.parse(
      'team',
      'utc-period-rdate-add.ics',
      fixture('recurrence-utc.ics'),
    );
    const value = {
      type: 'period' as const,
      timing: {
        type: 'duration' as const,
        start: {
          type: 'date-time' as const,
          value: { local: '2026-10-08T09:00:00', timezone: 'UTC' },
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
    };
    const added = parsed.applyPatch({
      recurrence: { rdate: { action: 'add-period', value } },
    });
    const reparsed = codec.parse(
      'team',
      'utc-period-rdate-add.ics',
      added.icalendar,
    );
    const unfolded = added.icalendar.replace(/\r\n[ \t]/g, '');

    expect(reparsed.event.recurrence?.rdates).toContainEqual(value);
    expect(unfolded).toContain('RDATE;VALUE=PERIOD:20261008T090000Z/PT1H');
    expect(unfolded).not.toContain('TZID=');
  });

  it.each([
    {
      label: 'zero duration',
      duration: {
        weeks: 0,
        days: 0,
        hours: 0,
        minutes: 0,
        seconds: 0,
        isNegative: false,
      },
    },
    {
      label: 'negative duration',
      duration: {
        weeks: 0,
        days: 0,
        hours: 1,
        minutes: 0,
        seconds: 0,
        isNegative: true,
      },
    },
    {
      label: 'fractional duration unit',
      duration: {
        weeks: 0,
        days: 0,
        hours: 0.5,
        minutes: 0,
        seconds: 0,
        isNegative: false,
      },
    },
    {
      label: 'weeks combined with time units',
      duration: {
        weeks: 1,
        days: 0,
        hours: 1,
        minutes: 0,
        seconds: 0,
        isNegative: false,
      },
    },
    {
      label: 'unknown duration unit',
      duration: {
        weeks: 0,
        days: 0,
        hours: 1,
        minutes: 0,
        seconds: 0,
        isNegative: false,
        milliseconds: 1,
      },
    },
  ])('rejects a duration-form PERIOD RDATE with $label', ({ duration }) => {
    const parsed = codec.parse(
      'team',
      'period-rdate-invalid-duration.ics',
      fixture('recurrence-override.ics'),
    );
    expect(() =>
      parsed.applyPatch({
        recurrence: {
          rdate: {
            action: 'add-period',
            value: {
              type: 'period',
              timing: {
                type: 'duration',
                start: {
                  type: 'date-time',
                  value: {
                    local: '2026-10-30T09:30:00',
                    timezone: 'Europe/Stockholm',
                  },
                },
                duration,
              },
            },
          },
        },
      } as unknown as CalendarEventPatch),
    ).toThrow(ICalendarEventCodecError);
  });

  it('requires a source VTIMEZONE for a new PERIOD start TZID', () => {
    const parsed = codec.parse(
      'team',
      'period-rdate-new-timezone.ics',
      fixture('recurrence-override.ics'),
    );

    expect(() =>
      parsed.applyPatch({
        recurrence: {
          rdate: {
            action: 'add-period',
            value: {
              type: 'period',
              timing: {
                type: 'duration',
                start: {
                  type: 'date-time',
                  value: {
                    local: '2026-10-30T09:30:00',
                    timezone: 'America/New_York',
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
          },
        },
      }),
    ).toThrow(ICalendarEventCodecError);
  });

  it.each([
    {
      label: 'equal end',
      start: '2026-10-29T09:30:00',
      end: '2026-10-29T09:30:00',
    },
    {
      label: 'earlier end',
      start: '2026-10-29T10:30:00',
      end: '2026-10-29T09:30:00',
    },
  ])('rejects an explicit-end PERIOD RDATE with $label', ({ start, end }) => {
    const parsed = codec.parse(
      'team',
      'period-rdate-invalid-add.ics',
      fixture('recurrence-override.ics'),
    );
    expect(() =>
      parsed.applyPatch({
        recurrence: {
          rdate: {
            action: 'add-period',
            value: {
              type: 'period',
              timing: {
                type: 'end',
                start: {
                  type: 'date-time',
                  value: { local: start, timezone: 'Europe/Stockholm' },
                },
                end: {
                  type: 'date-time',
                  value: { local: end, timezone: 'Europe/Stockholm' },
                },
              },
            },
          },
        },
      }),
    ).toThrow(ICalendarEventCodecError);
  });

  it('rejects incompatible, PERIOD, malformed, and unsupported RDATE writes', () => {
    const dateTimeEvent = codec.parse(
      'team',
      'date-time-rdate.ics',
      simpleRecurringSource('DTSTART:20261005T090000', 'DTEND:20261005T100000'),
    );
    const dateEvent = codec.parse(
      'team',
      'date-rdate.ics',
      simpleRecurringSource(
        'DTSTART;VALUE=DATE:20261005',
        'DTEND;VALUE=DATE:20261006',
      ),
    );
    expect(() =>
      dateTimeEvent.applyPatch({
        recurrence: {
          rdate: {
            action: 'add',
            value: { type: 'date', value: '2026-10-07' },
          },
        },
      }),
    ).toThrow(ICalendarEventCodecError);
    expect(() =>
      dateEvent.applyPatch({
        recurrence: {
          rdate: {
            action: 'add',
            value: {
              type: 'floating-date-time',
              value: '2026-10-07T09:00:00',
            },
          },
        },
      }),
    ).toThrow(ICalendarEventCodecError);
    expect(() =>
      dateTimeEvent.applyPatch({
        recurrence: {
          rdate: {
            action: 'add',
            value: {
              type: 'date-time',
              value: {
                local: '2026-10-07T09:00:00',
                timezone: 'Custom/Not-Bundled',
              },
            },
          },
        },
      }),
    ).toThrow(ICalendarEventCodecError);

    const malformed = codec.parse(
      'team',
      'malformed-rdate.ics',
      simpleRecurringSource(
        'DTSTART:20261005T090000',
        'DTEND:20261005T100000',
        ['RDATE;VALUE=TEXT:unsupported'],
      ),
    );
    expect(() =>
      malformed.applyPatch({
        recurrence: {
          rdate: {
            action: 'add',
            value: {
              type: 'floating-date-time',
              value: '2026-10-07T09:00:00',
            },
          },
        },
      }),
    ).toThrow(ICalendarEventCodecError);
  });

  it('removes every duplicate of one EXDATE while preserving sibling values and parameters', () => {
    const source = fixture('recurrence-override.ics')
      .replace(
        'EXDATE;TZID=Europe/Stockholm:20261102T140000',
        'EXDATE;X-KEEP=property-parameter;TZID=Europe/Stockholm:20261102T140000,20261109T140000',
      )
      .replace(
        'EXDATE;TZID=Europe/Stockholm:20261109T140000',
        'EXDATE;TZID=Europe/Stockholm:20261102T140000,20261102T140000',
      );
    const parsed = codec.parse('team', 'duplicate-exdates.ics', source);
    const removed = parsed.applyPatch({
      recurrence: {
        exdate: {
          action: 'remove',
          recurrenceId: {
            type: 'date-time',
            value: {
              local: '2026-11-02T14:00:00',
              timezone: 'Europe/Stockholm',
            },
          },
        },
      },
    });

    expect(removed.event.recurrence?.exdates).toEqual([
      {
        type: 'date-time',
        value: {
          local: '2026-11-09T14:00:00',
          timezone: 'Europe/Stockholm',
        },
      },
    ]);
    const master = ICAL.Component.fromString(
      removed.icalendar,
    ).getAllSubcomponents('vevent')[0];
    expect(master.getAllProperties('exdate')).toHaveLength(1);
    expect(master.getFirstProperty('exdate')?.getFirstParameter('tzid')).toBe(
      'Europe/Stockholm',
    );
    expect(master.getFirstProperty('exdate')?.getFirstParameter('x-keep')).toBe(
      'property-parameter',
    );
    expect(master.getFirstProperty('exdate')?.getValues()).toHaveLength(1);
    expect(master.getFirstPropertyValue('exdate')?.toString()).toBe(
      '2026-11-09T14:00:00',
    );
  });

  it.each([
    {
      label: 'DATE',
      dtstart: 'DTSTART;VALUE=DATE:20261001',
      dtend: 'DTEND;VALUE=DATE:20261002',
      recurrenceId: { type: 'date', value: '2026-10-02' },
      expected: 'EXDATE;VALUE=DATE:20261002',
    },
    {
      label: 'floating DATE-TIME',
      dtstart: 'DTSTART:20261001T090000',
      dtend: 'DTEND:20261001T100000',
      recurrenceId: {
        type: 'floating-date-time',
        value: '2026-10-02T09:00:00',
      },
      expected: 'EXDATE:20261002T090000',
    },
    {
      label: 'UTC DATE-TIME',
      dtstart: 'DTSTART:20261001T090000Z',
      dtend: 'DTEND:20261001T100000Z',
      recurrenceId: {
        type: 'date-time',
        value: { local: '2026-10-02T09:00:00', timezone: 'UTC' },
      },
      expected: 'EXDATE:20261002T090000Z',
    },
  ] satisfies Array<{
    label: string;
    dtstart: string;
    dtend: string;
    recurrenceId: CalendarEventDateTime;
    expected: string;
  }>)(
    'writes an EXDATE with the original $label value kind',
    ({ dtstart, dtend, recurrenceId, expected }) => {
      const source = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Matrix Calendar Widget//Tests//EN',
        'BEGIN:VEVENT',
        'UID:recurrence-kind@example.test',
        'DTSTAMP:20260922T120000Z',
        dtstart,
        dtend,
        'RRULE:FREQ=DAILY;COUNT=2',
        'SUMMARY:Recurrence kind',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');
      const encoded = codec
        .parse('team', 'recurrence-kind.ics', source)
        .applyPatch({
          recurrence: {
            exdate: { action: 'add', recurrenceId },
          },
        });

      expect(encoded.icalendar).toContain(expected);
      expect(
        codec.parse('team', 'recurrence-kind.ics', encoded.icalendar).event
          .recurrence?.exdates,
      ).toEqual([recurrenceId]);
    },
  );

  it('marks THISANDFUTURE ranges and preserves them on a title-only round-trip', () => {
    const source = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Matrix Calendar Widget//Tests//EN',
      'BEGIN:VEVENT',
      'UID:series@example.test',
      'DTSTAMP:20260922T120000Z',
      'DTSTART:20261001T090000Z',
      'DTEND:20261001T100000Z',
      'RRULE:FREQ=WEEKLY;COUNT=4',
      'SUMMARY:Planning',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:series@example.test',
      'DTSTAMP:20260922T120000Z',
      'RECURRENCE-ID;RANGE=THISANDFUTURE:20261008T090000Z',
      'DTSTART:20261008T110000Z',
      'DTEND:20261008T120000Z',
      'SUMMARY:Planning shifted',
      'X-OVERRIDE-MARKER:preserve-range-semantics',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const parsed = codec.parse('team', 'series.ics', source);

    expect(parsed.event.unsupportedRecurrence).toBe('range-this-and-future');
    expect(parsed.event.recurrence?.overrides).toHaveLength(1);
    expect(() =>
      parsed.applyPatch({
        recurrence: {
          exdate: {
            action: 'add',
            recurrenceId: {
              type: 'date-time',
              value: { local: '2026-10-08T09:00:00', timezone: 'UTC' },
            },
          },
        },
      }),
    ).toThrow(
      new ICalendarEventCodecError(
        'unsupported-patch',
        'Occurrence exceptions are not supported for this recurrence',
      ),
    );

    const patched = parsed.applyPatch({ title: 'Renamed planning' });
    const calendar = ICAL.Component.fromString(patched.icalendar);
    const override = calendar.getAllSubcomponents('vevent')[1];
    const recurrenceId = override.getFirstProperty('recurrence-id');

    expect(recurrenceId?.getFirstParameter('range')).toBe('THISANDFUTURE');
    expect(override.getFirstPropertyValue('dtstart')?.toString()).toBe(
      '2026-10-08T11:00:00Z',
    );
    expect(override.getFirstPropertyValue('summary')).toBe('Planning shifted');
    expect(override.getFirstPropertyValue('x-override-marker')).toBe(
      'preserve-range-semantics',
    );
    expect(
      codec.parse('team', 'series.ics', patched.icalendar).event
        .unsupportedRecurrence,
    ).toBe('range-this-and-future');
  });

  it('preserves floating recurrence wall time and RFC duration units', () => {
    const parsed = codec.parse(
      'team',
      'recurrence-floating-duration.ics',
      fixture('recurrence-floating-duration.ics'),
    );

    expect(parsed.event.recurrence).toMatchObject({
      rdates: [
        {
          type: 'period',
          timing: {
            type: 'duration',
            start: {
              type: 'date-time',
              value: {
                local: '2026-03-29T01:30:00',
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
        {
          type: 'period',
          timing: {
            type: 'duration',
            start: {
              type: 'date-time',
              value: {
                local: '2026-03-28T01:30:00',
                timezone: 'Europe/Stockholm',
              },
            },
            duration: {
              weeks: 0,
              days: 1,
              hours: 0,
              minutes: 0,
              seconds: 0,
              isNegative: false,
            },
          },
        },
        {
          type: 'period',
          timing: {
            type: 'duration',
            start: {
              type: 'date-time',
              value: {
                local: '2026-03-22T01:30:00',
                timezone: 'Europe/Stockholm',
              },
            },
            duration: {
              weeks: 1,
              days: 0,
              hours: 0,
              minutes: 0,
              seconds: 0,
              isNegative: false,
            },
          },
        },
        {
          type: 'period',
          timing: {
            type: 'duration',
            start: {
              type: 'floating-date-time',
              value: '2026-03-29T01:30:00',
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
      exdates: [
        {
          type: 'floating-date-time',
          value: '2026-03-29T01:30:00',
        },
      ],
      overrides: [
        {
          recurrenceId: {
            type: 'date-time',
            value: {
              local: '2026-03-29T01:30:00',
              timezone: 'Europe/Stockholm',
            },
          },
          title: 'Spring-forward override',
          timing: {
            type: 'duration',
            start: {
              type: 'date-time',
              value: {
                local: '2026-03-29T01:30:00',
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
    });

    const periodTimings = parsed.event.recurrence?.rdates?.flatMap((date) =>
      date.type === 'period' ? [date.timing] : [],
    );
    expect(periodTimings).toEqual([
      {
        type: 'duration',
        start: {
          type: 'date-time',
          value: {
            local: '2026-03-29T01:30:00',
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
      {
        type: 'duration',
        start: {
          type: 'date-time',
          value: {
            local: '2026-03-28T01:30:00',
            timezone: 'Europe/Stockholm',
          },
        },
        duration: {
          weeks: 0,
          days: 1,
          hours: 0,
          minutes: 0,
          seconds: 0,
          isNegative: false,
        },
      },
      {
        type: 'duration',
        start: {
          type: 'date-time',
          value: {
            local: '2026-03-22T01:30:00',
            timezone: 'Europe/Stockholm',
          },
        },
        duration: {
          weeks: 1,
          days: 0,
          hours: 0,
          minutes: 0,
          seconds: 0,
          isNegative: false,
        },
      },
      {
        type: 'duration',
        start: {
          type: 'floating-date-time',
          value: '2026-03-29T01:30:00',
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
    ]);
  });

  it('preserves floating RECURRENCE-ID and detached duration wall time', () => {
    const parsed = codec.parse(
      'team',
      'recurrence-floating-override.ics',
      fixture('recurrence-floating-override.ics'),
    );

    expect(parsed.event.recurrence?.overrides).toEqual([
      {
        recurrenceId: {
          type: 'floating-date-time',
          value: '2026-10-12T14:00:00',
        },
        title: 'Floating moved instance',
        timing: {
          type: 'duration',
          start: {
            type: 'floating-date-time',
            value: '2026-10-12T16:00:00',
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
  });

  it('preserves UTC recurrence dates and detached identities', () => {
    const parsed = codec.parse(
      'team',
      'recurrence-utc.ics',
      fixture('recurrence-utc.ics'),
    );

    expect(parsed.event.recurrence).toEqual({
      rrule: 'FREQ=WEEKLY;COUNT=2',
      rdates: [
        {
          type: 'date-time',
          value: {
            local: '2026-11-01T14:00:00',
            timezone: 'UTC',
          },
        },
      ],
      overrides: [
        {
          recurrenceId: {
            type: 'date-time',
            value: {
              local: '2026-11-01T14:00:00',
              timezone: 'UTC',
            },
          },
          title: 'UTC moved instance',
          timing: {
            type: 'end',
            start: {
              type: 'date-time',
              value: {
                local: '2026-11-01T16:00:00',
                timezone: 'UTC',
              },
            },
            end: {
              type: 'date-time',
              value: {
                local: '2026-11-01T17:00:00',
                timezone: 'UTC',
              },
            },
          },
        },
      ],
    });
  });

  it('preserves unknown calendar and VEVENT properties on patch', () => {
    const parsed = codec.parse(
      'team',
      'unknown-properties.ics',
      fixture('unknown-properties.ics'),
    );

    const encoded = parsed.applyPatch({ title: 'Updated summary' });
    const calendar = ICAL.Component.fromString(encoded.icalendar);
    const event = calendar.getFirstSubcomponent('vevent');

    expect(calendar.getFirstPropertyValue('x-custom-calendar-property')).toBe(
      'preserve-calendar-value',
    );
    expect(event?.getFirstPropertyValue('x-custom-flag')).toBe('preserve-me');

    const metadata = event?.getFirstProperty('x-client-metadata');
    expect(metadata?.getFirstParameter('x-param')).toBe('preserve-param');
    expect(metadata?.getFirstValue()).toBe('preserve-value');

    const attachment = event?.getFirstProperty('attach');
    expect(attachment?.getFirstParameter('fmttype')).toBe('application/pdf');
    expect(attachment?.getFirstValue()).toBe(
      'https://example.test/files/agenda.pdf',
    );
  });

  it('preserves VALARM subcomponents on patch', () => {
    const parsed = codec.parse('team', 'alarm.ics', fixture('alarm.ics'));

    const encoded = parsed.applyPatch({ location: 'Release room' });
    const event = ICAL.Component.fromString(
      encoded.icalendar,
    ).getFirstSubcomponent('vevent');
    const alarm = event?.getFirstSubcomponent('valarm');

    expect(alarm?.getFirstPropertyValue('action')).toBe('DISPLAY');
    expect(alarm?.getFirstPropertyValue('trigger')?.toString()).toBe('-PT15M');
    expect(alarm?.getFirstPropertyValue('description')).toBe(
      'Release checkpoint starts in 15 minutes',
    );
  });

  it('preserves a sibling VTODO component when patching a VEVENT', () => {
    const parsed = codec.parse(
      'team',
      'mixed-components.ics',
      `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Matrix Calendar Widget//EN
BEGIN:VEVENT
UID:event@example.test
DTSTART:20260923T090000Z
DTEND:20260923T100000Z
SUMMARY:Team planning
END:VEVENT
BEGIN:VTODO
UID:task@example.test
DTSTAMP:20260920T120000Z
DUE:20260924T120000Z
SUMMARY:Prepare agenda
END:VTODO
END:VCALENDAR`,
    );

    const encoded = parsed.applyPatch({ title: 'Updated team planning' });
    const calendar = ICAL.Component.fromString(encoded.icalendar);
    const todo = calendar.getFirstSubcomponent('vtodo');

    expect(calendar.getAllSubcomponents('vevent')).toHaveLength(1);
    expect(todo?.getFirstPropertyValue('uid')).toBe('task@example.test');
    expect(todo?.getFirstPropertyValue('summary')).toBe('Prepare agenda');
  });

  it('preserves organizer and attendee data on patch', () => {
    const parsed = codec.parse(
      'team',
      'attendees.ics',
      fixture('attendees.ics'),
    );

    const encoded = parsed.applyPatch({ status: 'tentative' });
    const event = ICAL.Component.fromString(
      encoded.icalendar,
    ).getFirstSubcomponent('vevent');

    expect(event?.getFirstProperty('organizer')?.getFirstParameter('cn')).toBe(
      'Alice Example',
    );
    expect(event?.getAllProperties('attendee')).toHaveLength(2);
    expect(event?.getFirstPropertyValue('sequence')).toBe(3);
    expect(event?.getFirstPropertyValue('status')).toBe('TENTATIVE');
  });

  it('preserves repeated interoperable properties and alarms without fetching stored URIs', () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('Unexpected fetch while handling stored iCalendar URIs');
    });

    try {
      const source = fixture('interoperable-properties.ics');
      const fixedCodec = new ICalendarEventCodec(
        () => new Date('2026-10-03T15:16:17Z'),
      );
      const parsed = fixedCodec.parse(
        'team',
        'interoperable-properties.ics',
        source,
      );
      const sourceEvent =
        ICAL.Component.fromString(source).getFirstSubcomponent('vevent');
      const sourceAlarms = sourceEvent?.getAllSubcomponents('valarm') ?? [];
      const ordinary = parsed.applyPatch({ location: 'Updated room' });
      const recurrence = parsed.applyPatch({
        recurrence: {
          ...parsed.event.recurrence,
          rrule: 'FREQ=DAILY;COUNT=5',
        },
      });

      for (const encoded of [ordinary, recurrence]) {
        const calendar = ICAL.Component.fromString(encoded.icalendar);
        const event = calendar.getFirstSubcomponent('vevent');
        const alarms = event?.getAllSubcomponents('valarm') ?? [];

        expect(alarms.map((alarm) => alarm.toString())).toEqual(
          sourceAlarms.map((alarm) => alarm.toString()),
        );
        expect(
          alarms.map((alarm) => alarm.getFirstPropertyValue('action')),
        ).toEqual(['DISPLAY', 'DISPLAY', 'EMAIL', 'AUDIO']);

        expect(revisionPropertyLines(event!)).toEqual([
          'DTSTAMP:20261003T151617Z',
          'CREATED:20260919T080000Z',
          'LAST-MODIFIED:20261003T151617Z',
          'SEQUENCE:8',
        ]);

        for (const propertyName of [
          'organizer',
          'attendee',
          'attach',
          'conference',
        ]) {
          expect(
            event
              ?.getAllProperties(propertyName)
              .map((property) => property.toICALString()),
          ).toEqual(
            sourceEvent
              ?.getAllProperties(propertyName)
              .map((property) => property.toICALString()),
          );
        }

        expect(event?.getAllProperties('attendee')).toHaveLength(2);
        expect(event?.getAllProperties('attach')).toHaveLength(2);
        expect(
          event?.getAllProperties('attach').map((property) => property.type),
        ).toEqual(['uri', 'binary']);
        expect(event?.getAllProperties('conference')).toHaveLength(2);
      }

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(parsed.event.attachments).toEqual([
        { url: 'https://files.example.test/agenda.pdf' },
      ]);
      expect(parsed.event.unsupportedAttachment).toBeUndefined();
      expect(parsed.event).not.toHaveProperty('conference');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('decodes folded and escaped text without destructive re-encoding', () => {
    const parsed = codec.parse(
      'team',
      'folded-escaped.ics',
      fixture('folded-escaped.ics'),
    );

    expect(parsed.event.title).toBe('Escaped, semicolon; and backslash\\ text');
    expect(parsed.event.description).toContain(
      'Second line with a comma, a semicolon;',
    );
    expect(parsed.event.location).toBe('Building A, Floor 2');

    const encoded = parsed.applyPatch({ title: 'Short title' });
    const reparsed = codec.parse(
      'team',
      'folded-escaped.ics',
      encoded.icalendar,
    );

    expect(reparsed.event.description).toBe(parsed.event.description);
    expect(reparsed.event.location).toBe(parsed.event.location);
  });

  it('serializes a new basic VEVENT from the calendar domain input', () => {
    const encoded = codec.create('team', 'new.ics', {
      uid: 'new@example.test',
      title: 'Planning',
      description: 'Quarterly planning',
      timing: {
        type: 'timed',
        start: {
          type: 'zoned',
          local: '2026-09-28T09:00:00',
          timezone: 'Europe/Stockholm',
        },
        end: {
          type: 'zoned',
          local: '2026-09-28T10:30:00',
          timezone: 'Europe/Stockholm',
        },
      },
      status: 'confirmed',
      transparency: 'opaque',
      location: 'Room 5',
      url: 'https://example.test/events/new',
      categories: ['TEAM', 'PLANNING'],
      priority: 4,
    });
    const serializedCalendar = ICAL.Component.fromString(encoded.icalendar);
    const timezoneDefinitions =
      serializedCalendar.getAllSubcomponents('vtimezone');

    expect(encoded.event).toMatchObject({
      id: 'new.ics',
      calendarId: 'team',
      uid: 'new@example.test',
      title: 'Planning',
    });
    expect(timezoneDefinitions).toHaveLength(1);
    expect(timezoneDefinitions[0].getFirstPropertyValue('tzid')).toBe(
      'Europe/Stockholm',
    );

    const reparsed = codec.parse('team', 'new.ics', encoded.icalendar);
    expect(reparsed.event.unsupportedTimezone).toBeUndefined();
    expect(reparsed.event).toEqual(encoded.event);
  });

  it('creates and round-trips a supported all-day RRULE', () => {
    const encoded = codec.create('team', 'new.ics', {
      uid: 'new@example.test',
      title: 'Recurring',
      timing: {
        type: 'all-day',
        startDate: '2026-09-28',
        endDate: '2026-09-29',
      },
      recurrence: { rrule: 'FREQ=DAILY;INTERVAL=2;COUNT=5' },
    });

    expect(encoded.event.recurrence).toEqual({
      rrule: 'FREQ=DAILY;COUNT=5;INTERVAL=2',
    });
    expect(codec.parse('team', 'new.ics', encoded.icalendar).event).toEqual(
      encoded.event,
    );
  });

  it('includes one canonical definition for each distinct zoned endpoint', () => {
    const encoded = codec.create('team', 'different-zones.ics', {
      uid: 'different-zones@example.test',
      title: 'Different endpoint zones',
      timing: {
        type: 'timed',
        start: {
          type: 'zoned',
          local: '2026-11-02T09:00:00',
          timezone: 'Europe/Stockholm',
        },
        end: {
          type: 'zoned',
          local: '2026-11-02T04:00:00',
          timezone: 'America/New_York',
        },
      },
    });
    const calendar = ICAL.Component.fromString(encoded.icalendar);
    const timezoneIds = calendar
      .getAllSubcomponents('vtimezone')
      .map((definition) => definition.getFirstPropertyValue('tzid'))
      .sort();

    expect(timezoneIds).toEqual(['America/New_York', 'Europe/Stockholm']);

    const reparsed = codec.parse(
      'team',
      'different-zones.ics',
      encoded.icalendar,
    );
    expect(reparsed.event.timing).toEqual(encoded.event.timing);
    expect(reparsed.event.unsupportedTimezone).toBeUndefined();
  });

  it('creates, updates, and reloads a supported every-other-week BYDAY rule', () => {
    const created = codec.create('team', 'weekly.ics', {
      uid: 'weekly@example.test',
      title: 'Weekly planning',
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
      recurrence: { rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE' },
    });

    expect(created.event.recurrence).toEqual({
      rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE',
    });
    const reparsed = codec.parse('team', 'weekly.ics', created.icalendar);
    expect(reparsed.event.recurrence).toEqual(created.event.recurrence);

    const updated = reparsed.applyPatch({
      recurrence: { rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR' },
    });
    expect(
      codec.parse('team', 'weekly.ics', updated.icalendar).event.recurrence,
    ).toEqual({ rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR' });
  });

  it.each([
    'FREQ=WEEKLY;BYDAY=MO,WE;INTERVAL=0',
    'FREQ=WEEKLY;BYDAY=MO,WE;COUNT=0',
    'FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261102T080000Z',
    'FREQ=WEEKLY;BYDAY=MO,WE;WKST=SU',
    'FREQ=WEEKLY;BYDAY=1MO,WE',
    'FREQ=WEEKLY;BYDAY=MO,WE;BYHOUR=9',
    'FREQ=WEEKLY;BYDAY=TU,WE',
  ])('rejects writes outside the weekly BYDAY subset: %s', (rrule) => {
    expect(() =>
      codec.create('team', 'invalid-weekly.ics', {
        uid: 'invalid-weekly@example.test',
        title: 'Invalid weekly rule',
        timing: {
          type: 'all-day',
          startDate: '2026-10-26',
          endDate: '2026-10-27',
        },
        recurrence: { rrule },
      }),
    ).toThrow(
      new ICalendarEventCodecError(
        'unsupported-patch',
        'Only simple whole-series RRULE changes are supported',
      ),
    );
  });

  it('preserves unsupported weekly RRULEs and unrelated resource data on other edits', () => {
    const rrule = 'FREQ=WEEKLY;BYDAY=MO,FR;INTERVAL=2;WKST=SU';
    const source = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Test//Calendar//EN',
      'BEGIN:VEVENT',
      'UID:unsupported-weekly@example.test',
      'DTSTAMP:20260901T000000Z',
      'DTSTART:20261023T090000',
      'DTEND:20261023T100000',
      'SUMMARY:Unsupported weekly rule',
      `RRULE:${rrule}`,
      'X-KEEP-ME:resource-data',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const parsed = codec.parse('team', 'unsupported-weekly.ics', source);
    const canonicalRrule = ICAL.Recur.fromString(rrule).toString();

    expect(parsed.event.recurrence?.rrule).toBe(canonicalRrule);
    expect(() =>
      parsed.applyPatch({ recurrence: { rrule: 'FREQ=WEEKLY;BYDAY=MO,FR' } }),
    ).toThrow(
      new ICalendarEventCodecError(
        'unsupported-patch',
        'Only simple whole-series RRULE changes are supported',
      ),
    );

    const edited = parsed.applyPatch({ title: 'Updated title' });
    const vevent = ICAL.Component.fromString(
      edited.icalendar,
    ).getFirstSubcomponent('vevent');
    expect(vevent?.getFirstPropertyValue('rrule')?.toString()).toBe(
      canonicalRrule,
    );
    expect(vevent?.getFirstPropertyValue('x-keep-me')).toBe('resource-data');
  });

  it('updates and clears only the master RRULE in a complete resource', () => {
    const parsed = codec.parse(
      'team',
      'series.ics',
      fixture('recurrence-simple-series.ics'),
    );

    const encoded = parsed.applyPatch({
      recurrence: { rrule: 'FREQ=MONTHLY;COUNT=6;INTERVAL=2' },
    });
    const calendar = ICAL.Component.fromString(encoded.icalendar);
    const vevent = calendar.getFirstSubcomponent('vevent');
    const reparsed = codec.parse('team', 'series.ics', encoded.icalendar);

    expect(encoded.event).toMatchObject({
      id: 'series.ics',
      uid: 'series@example.test',
      recurrence: { rrule: 'FREQ=MONTHLY;COUNT=6;INTERVAL=2' },
    });
    expect(reparsed.event.recurrence).toEqual(encoded.event.recurrence);
    expect(calendar.getFirstPropertyValue('x-custom-calendar-property')).toBe(
      'keep-this',
    );
    expect(vevent?.getFirstPropertyValue('x-custom-event-property')).toBe(
      'keep-event',
    );
    expect(vevent?.getFirstSubcomponent('valarm')).not.toBeNull();
    expect(calendar.getFirstSubcomponent('vtimezone')).not.toBeNull();

    const cleared = parsed.applyPatch({ recurrence: {} });
    const clearedCalendar = ICAL.Component.fromString(cleared.icalendar);
    const clearedEvent = clearedCalendar.getFirstSubcomponent('vevent');
    expect(cleared.event.recurrence).toBeUndefined();
    expect(clearedEvent?.getFirstProperty('rrule')).toBeNull();
    expect(
      clearedEvent?.getFirstProperty('x-custom-event-property'),
    ).not.toBeNull();
    expect(clearedEvent?.getFirstSubcomponent('valarm')).not.toBeNull();
    expect(clearedCalendar.getFirstSubcomponent('vtimezone')).not.toBeNull();
  });

  it('keeps complex recurrence readable and rejects recurrence changes', () => {
    const parsed = codec.parse(
      'team',
      'recurrence-override.ics',
      fixture('recurrence-override.ics'),
    );

    expect(() =>
      parsed.applyPatch({ recurrence: { rrule: 'FREQ=WEEKLY;COUNT=8' } }),
    ).toThrow(
      new ICalendarEventCodecError(
        'unsupported-patch',
        'Only simple whole-series RRULE changes are supported',
      ),
    );
  });

  it('keeps multiple master RRULEs readable and untouched', () => {
    const parsed = codec.parse(
      'team',
      'multi-rule.ics',
      fixture('recurrence-multiple-master-rules.ics'),
    );

    expect(parsed.listProjectionDiagnostic).toBe('unsupported-recurrence');
    expect(parsed.event.unsupportedRecurrence).toBeUndefined();
    expect(() =>
      parsed.applyPatch({ recurrence: { rrule: 'FREQ=DAILY;COUNT=5' } }),
    ).toThrow(
      new ICalendarEventCodecError(
        'unsupported-patch',
        'Only simple whole-series RRULE changes are supported',
      ),
    );
    expect(() =>
      parsed.applyPatch({
        recurrence: {
          exdate: {
            action: 'add',
            recurrenceId: {
              type: 'date-time',
              value: {
                local: '2026-10-08T09:00:00',
                timezone: 'Europe/Stockholm',
              },
            },
          },
        },
      }),
    ).toThrow(
      new ICalendarEventCodecError(
        'unsupported-patch',
        'Occurrence exceptions are not supported for this recurrence',
      ),
    );

    const titlePatch = parsed.applyPatch({ title: 'Renamed multi-rule event' });
    const calendar = ICAL.Component.fromString(titlePatch.icalendar);
    const event = calendar.getFirstSubcomponent('vevent');
    expect(event?.getAllProperties('rrule')).toHaveLength(2);
    expect(titlePatch.icalendar).toContain('RRULE:FREQ=WEEKLY;COUNT=4');
    expect(titlePatch.icalendar).toContain('RRULE:FREQ=MONTHLY;COUNT=2');
    expect(calendar.getFirstPropertyValue('x-custom-calendar-property')).toBe(
      'keep-calendar',
    );
    expect(event?.getFirstPropertyValue('x-custom-event-property')).toBe(
      'keep-event',
    );
    expect(event?.getFirstSubcomponent('valarm')).not.toBeNull();
    expect(calendar.getAllSubcomponents('vtodo')).toHaveLength(1);
  });

  it('reads, creates, edits, and removes one negative relative DISPLAY alarm', () => {
    const parsed = codec.parse('team', 'alarm.ics', fixture('alarm.ics'));
    expect(parsed.event.alarm).toEqual({
      action: 'display',
      trigger: { weeks: 0, days: 0, hours: 0, minutes: 15, seconds: 0 },
    });
    expect(parsed.event.unsupportedAlarm).toBeUndefined();

    const alarm: NonNullable<CalendarEvent['alarm']> = {
      action: 'display',
      trigger: { weeks: 0, days: 1, hours: 2, minutes: 30, seconds: 0 },
    };
    const plain = codec.parse('team', 'plain.ics', fixture('simple-timed.ics'));
    const added = plain.applyPatch({ alarm });
    const addedAlarmUid = added.event.alarm?.uid;
    expect(addedAlarmUid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(
      codec.parse('team', 'plain.ics', added.icalendar).event.alarm,
    ).toMatchObject(alarm);
    expect(
      codec.parse('team', 'plain.ics', added.icalendar).event.alarm?.uid,
    ).toBe(addedAlarmUid);

    const explicitStart = codec.parse(
      'team',
      'start-related.ics',
      alarmEventSource().replace(
        'TRIGGER:-PT15M',
        'TRIGGER;RELATED=START:-PT15M',
      ),
    );
    expect(explicitStart.event.unsupportedAlarm).toBeUndefined();
    expect(explicitStart.applyPatch({ alarm }).icalendar).toContain(
      'TRIGGER;RELATED=START:-P1DT2H30M',
    );

    const created = codec.create('team', 'created.ics', {
      uid: 'created-alarm@example.test',
      title: 'Created with a CalDAV reminder',
      timing: {
        type: 'timed',
        start: { type: 'floating', local: '2026-09-23T09:00:00' },
        end: { type: 'floating', local: '2026-09-23T10:00:00' },
      },
      alarm,
    });
    const createdCalendar = ICAL.Component.fromString(created.icalendar);
    const createdAlarm = createdCalendar
      .getFirstSubcomponent('vevent')
      ?.getFirstSubcomponent('valarm');
    const createdAlarmUid = createdAlarm?.getFirstPropertyValue('uid');
    expect(createdAlarmUid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(created.event.alarm?.uid).toBe(createdAlarmUid);
    expect(createdAlarm?.getFirstPropertyValue('action')).toBe('DISPLAY');
    expect(createdAlarm?.getFirstPropertyValue('description')).toBe(
      'Created with a CalDAV reminder',
    );
    expect(createdAlarm?.getFirstPropertyValue('trigger')?.toString()).toBe(
      '-P1DT2H30M',
    );
    expect(
      codec.parse('team', 'created.ics', created.icalendar).event.alarm,
    ).toMatchObject(alarm);
    expect(
      codec.parse('team', 'created.ics', created.icalendar).event.alarm?.uid,
    ).toBe(createdAlarmUid);

    const changed = parsed.applyPatch({
      alarm: {
        action: 'display',
        trigger: { weeks: 0, days: 0, hours: 0, minutes: 30, seconds: 0 },
      },
    });
    expect(relativeAlarmMinutes(changed.event.alarm)).toBe(30);
    const reparsed = codec.parse('team', 'alarm.ics', changed.icalendar);
    expect(relativeAlarmMinutes(reparsed.event.alarm)).toBe(30);
    expect(reparsed.event.alarm?.uid).toBe(changed.event.alarm?.uid);

    const removePatch = JSON.parse(
      JSON.stringify({ alarm: { operation: 'remove' } }),
    ) as CalendarEventPatch;
    expect(removePatch).toEqual({ alarm: { operation: 'remove' } });
    const removed = reparsed.applyPatch(removePatch);
    expect(removed.event.alarm).toBeUndefined();
    expect(
      ICAL.Component.fromString(removed.icalendar)
        .getFirstSubcomponent('vevent')
        ?.getAllSubcomponents('valarm'),
    ).toHaveLength(0);
  });

  it('reads, creates, updates, preserves, and removes one absolute UTC DISPLAY alarm', () => {
    const source = fixture('alarm-absolute.ics');
    const parsed = codec.parse('team', 'absolute-alarm.ics', source);
    const originalAlarm = {
      action: 'display' as const,
      uid: 'absolute-alarm@example.test',
      trigger: { type: 'absolute' as const, value: '2026-09-23T08:45:00Z' },
    };
    expect(parsed.event.alarm).toEqual(originalAlarm);
    expect(parsed.event.unsupportedAlarm).toBeUndefined();

    const identical = parsed.applyPatch({
      alarm: {
        action: 'display',
        trigger: { type: 'absolute', value: '2026-09-23T08:45:00Z' },
      },
    });
    expect(identical.icalendar).toBe(source);
    expect(identical.event.revision).toEqual(parsed.event.revision);

    const identicalWithUnchangedEventFields = parsed.applyPatch({
      title: parsed.event.title,
      alarm: {
        action: 'display',
        trigger: { type: 'absolute', value: '2026-09-23T08:45:00Z' },
      },
    });
    expect(identicalWithUnchangedEventFields.icalendar).toBe(source);
    expect(identicalWithUnchangedEventFields.event.revision).toEqual(
      parsed.event.revision,
    );

    const changed = parsed.applyPatch({
      alarm: {
        action: 'display',
        trigger: { type: 'absolute', value: '2026-09-23T08:30:00Z' },
      },
    });
    expect(changed.event.alarm).toEqual({
      ...originalAlarm,
      trigger: { type: 'absolute', value: '2026-09-23T08:30:00Z' },
    });
    expect(changed.event.revision).not.toEqual(parsed.event.revision);
    expect(changed.icalendar).toContain(
      'TRIGGER;VALUE=DATE-TIME:20260923T083000Z',
    );
    const changedAlarm = ICAL.Component.fromString(changed.icalendar)
      .getFirstSubcomponent('vevent')
      ?.getFirstSubcomponent('valarm');
    expect(changedAlarm?.getFirstPropertyValue('uid')).toBe(
      'absolute-alarm@example.test',
    );
    expect(changedAlarm?.getFirstPropertyValue('description')).toBe(
      'Alarm description',
    );
    expect(changedAlarm?.getFirstPropertyValue('x-alarm-metadata')).toBe(
      'preserve-alarm-property',
    );
    expect(
      codec.parse('team', 'absolute-alarm.ics', changed.icalendar).event.alarm,
    ).toEqual(changed.event.alarm);

    const created = codec.create('team', 'new-absolute.ics', {
      uid: 'new-absolute@example.test',
      title: 'Absolute calendar alarm',
      timing: {
        type: 'timed',
        start: { type: 'floating', local: '2026-09-23T09:00:00' },
        end: { type: 'floating', local: '2026-09-23T10:00:00' },
      },
      alarm: {
        action: 'display',
        trigger: { type: 'absolute', value: '2026-09-23T08:45:00Z' },
      },
    });
    expect(created.event.alarm?.uid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(created.icalendar).toContain(
      'TRIGGER;VALUE=DATE-TIME:20260923T084500Z',
    );

    const removed = codec
      .parse('team', 'absolute-alarm.ics', changed.icalendar)
      .applyPatch({ alarm: { operation: 'remove' } });
    expect(removed.event.alarm).toBeUndefined();
    expect(removed.icalendar).not.toContain('BEGIN:VALARM');
  });

  it.each([
    ['malformed sequence', 'SEQUENCE:not-a-number'],
    ['exhausted sequence', 'SEQUENCE:2147483647'],
  ])(
    'applies other edits with an unchanged alarm when revision is %s',
    (_label, sequence) => {
      const absoluteTrigger = {
        type: 'absolute' as const,
        value: '2026-09-23T08:45:00Z',
      };
      const source = fixture('alarm-absolute.ics').replace(
        'UID:absolute-event@example.test',
        `UID:absolute-event@example.test\r\n${sequence}`,
      );
      const parsed = codec.parse('team', 'absolute-alarm.ics', source);
      const edited = parsed.applyPatch({
        title: 'Retitled while retaining alarm',
        alarm: { action: 'display', trigger: absoluteTrigger },
      });

      expect(edited.event.title).toBe('Retitled while retaining alarm');
      expect(edited.event.alarm?.trigger).toEqual(absoluteTrigger);
      expect(edited.event.revision).toEqual(parsed.event.revision);
      expect(edited.icalendar).toContain(sequence);
    },
  );

  it.each(['-P0DT15M', '-PT015M'])(
    'retains compatible RFC duration spelling %s',
    (trigger) => {
      const source = alarmEventSource().replace(
        'TRIGGER:-PT15M',
        `TRIGGER:${trigger}`,
      );
      const parsed = codec.parse('team', 'equivalent-duration.ics', source);

      const alarm = {
        action: 'display' as const,
        trigger: { weeks: 0, days: 0, hours: 0, minutes: 15, seconds: 0 },
      };
      expect(parsed.event.alarm?.trigger).toEqual(alarm.trigger);

      const unchanged = parsed.applyPatch({ alarm });
      expect(unchanged.icalendar).toBe(source);
      expect(unchanged.event.revision).toEqual(parsed.event.revision);
      expect(unchanged.event.alarm?.uid).toBeUndefined();

      const unrelatedEdit = parsed.applyPatch({
        title: 'Retitled while preserving alarm',
        alarm,
      });
      expect(unrelatedEdit.icalendar).toContain(`TRIGGER:${trigger}`);
      expect(unrelatedEdit.event.alarm?.uid).toBeUndefined();
      expect(
        codec.parse('team', 'equivalent-duration.ics', unrelatedEdit.icalendar)
          .event.alarm?.trigger,
      ).toEqual(alarm.trigger);
    },
  );

  it('preserves an existing VALARM UID across supported and ordinary edits', () => {
    const parsed = codec.parse(
      'team',
      'alarm-uid.ics',
      fixture('alarm-uid.ics'),
    );
    const uid = 'alarm-one@example.test';
    expect(parsed.event.alarm?.uid).toBe(uid);

    const ordinaryEdit = parsed.applyPatch({ title: 'Retitled event' });
    expect(
      codec.parse('team', 'alarm-uid.ics', ordinaryEdit.icalendar).event.alarm
        ?.uid,
    ).toBe(uid);

    const alarmEdit = parsed.applyPatch({
      alarm: {
        action: 'display',
        trigger: { weeks: 0, days: 0, hours: 0, minutes: 30, seconds: 0 },
      },
    });
    expect(alarmEdit.event.alarm?.uid).toBe(uid);
    expect(
      codec.parse('team', 'alarm-uid.ics', alarmEdit.icalendar).event.alarm
        ?.uid,
    ).toBe(uid);
    const alarm = ICAL.Component.fromString(alarmEdit.icalendar)
      .getFirstSubcomponent('vevent')
      ?.getFirstSubcomponent('valarm');
    expect(alarm?.getFirstPropertyValue('uid')).toBe(uid);
    expect(alarm?.getFirstPropertyValue('x-alarm-metadata')).toBe(
      'preserve-value',
    );
  });

  it('keeps legacy UID-less alarms unchanged until an explicit alarm write', () => {
    const legacy = codec.parse('team', 'alarm.ics', fixture('alarm.ics'));
    expect(legacy.event.alarm?.uid).toBeUndefined();

    const ordinaryEdit = legacy.applyPatch({ title: 'Legacy event retitled' });
    const untouchedAlarm = ICAL.Component.fromString(ordinaryEdit.icalendar)
      .getFirstSubcomponent('vevent')
      ?.getFirstSubcomponent('valarm');
    expect(untouchedAlarm?.getAllProperties('uid')).toHaveLength(0);

    const explicitWrite = legacy.applyPatch({
      alarm: {
        action: 'display',
        trigger: { weeks: 0, days: 0, hours: 0, minutes: 20, seconds: 0 },
      },
    });
    const uid = explicitWrite.event.alarm?.uid;
    expect(uid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    const reparsed = codec.parse('team', 'alarm.ics', explicitWrite.icalendar);
    expect(reparsed.event.alarm?.uid).toBe(uid);

    const laterEdit = reparsed.applyPatch({
      alarm: {
        action: 'display',
        trigger: { weeks: 0, days: 0, hours: 0, minutes: 25, seconds: 0 },
      },
    });
    expect(laterEdit.event.alarm?.uid).toBe(uid);
  });

  it('changes a supported alarm without rewriting unrelated resource data', () => {
    const source = fixture('recurrence-override.ics');
    const parsed = codec.parse('team', 'recurring-alarm.ics', source);
    expect(relativeAlarmMinutes(parsed.event.alarm)).toBe(10);

    const changed = parsed.applyPatch({
      alarm: {
        action: 'display',
        trigger: { weeks: 0, days: 0, hours: 0, minutes: 20, seconds: 0 },
      },
    });
    const calendar = ICAL.Component.fromString(changed.icalendar);
    const events = calendar.getAllSubcomponents('vevent');
    const master = events[0];
    const valarm = master.getFirstSubcomponent('valarm');

    expect(events).toHaveLength(3);
    expect(calendar.getFirstSubcomponent('vtimezone')).not.toBeNull();
    expect(calendar.getFirstPropertyValue('x-custom-calendar-property')).toBe(
      'preserve-resource-value',
    );
    expect(master.getFirstPropertyValue('rrule')?.toString()).toBe(
      'FREQ=WEEKLY;COUNT=4',
    );
    expect(master.getFirstPropertyValue('x-client-metadata')).toBe(
      'preserve-value',
    );
    expect(valarm?.getFirstPropertyValue('description')).toBe(
      'Preserve the series reminder',
    );
    expect(valarm?.getFirstPropertyValue('trigger')?.toString()).toBe('-PT20M');
    expect(valarm?.getFirstPropertyValue('x-alarm-metadata')).toBe(
      'preserve-alarm-property',
    );
    expect(events[1].getFirstPropertyValue('x-override-marker')).toBe(
      'preserve-exception',
    );
    expect(events[2].getFirstPropertyValue('x-override-marker')).toBe(
      'preserve-cancellation',
    );
    expect(
      codec.parse('team', 'recurring-alarm.ics', changed.icalendar).event.alarm
        ?.trigger,
    ).toEqual({
      weeks: 0,
      days: 0,
      hours: 0,
      minutes: 20,
      seconds: 0,
    });

    const removePatch = JSON.parse(
      JSON.stringify({ alarm: { operation: 'remove' } }),
    ) as CalendarEventPatch;
    const removed = parsed.applyPatch(removePatch);
    const removedCalendar = ICAL.Component.fromString(removed.icalendar);
    expect(removedCalendar.getAllSubcomponents('vevent')).toHaveLength(3);
    expect(
      removedCalendar
        .getFirstSubcomponent('vevent')
        ?.getFirstSubcomponent('valarm'),
    ).toBeNull();
    expect(removedCalendar.getFirstSubcomponent('vtimezone')).not.toBeNull();
    expect(
      removedCalendar.getFirstPropertyValue('x-custom-calendar-property'),
    ).toBe('preserve-resource-value');
  });

  it('rejects malformed JSON alarm removal operations for supported alarms', () => {
    const parsed = codec.parse('team', 'alarm.ics', fixture('alarm.ics'));

    for (const alarm of [
      { operation: 'clear' },
      { operation: 'remove', unexpected: true },
      null,
    ]) {
      const malformedPatch = JSON.parse(
        JSON.stringify({ alarm }),
      ) as CalendarEventPatch;
      expect(() => parsed.applyPatch(malformedPatch)).toThrow(
        new ICalendarEventCodecError(
          'unsupported-patch',
          'Only one non-repeating DISPLAY alarm with a supported trigger is supported',
        ),
      );
    }
  });

  it.each<readonly [string, (source: string) => string]>([
    [
      'a non-DISPLAY action',
      (source) => source.replace('ACTION:DISPLAY', 'ACTION:EMAIL'),
    ],
    [
      'a VALARM with duplicate UID properties',
      (source) =>
        source.replace(
          'BEGIN:VALARM',
          'BEGIN:VALARM\r\nUID:first-alarm@example.test\r\nUID:second-alarm@example.test',
        ),
    ],
    [
      'a VALARM UID that collides with the VEVENT UID',
      (source) =>
        source.replace(
          'BEGIN:VALARM',
          'BEGIN:VALARM\r\nUID:alarm-test@example.test',
        ),
    ],
    [
      'a VALARM UID that collides with a VFREEBUSY UID',
      (source) =>
        source
          .replace('BEGIN:VALARM', 'BEGIN:VALARM\r\nUID:busy@example.test')
          .replace(
            'END:VCALENDAR',
            'BEGIN:VFREEBUSY\r\nUID:busy@example.test\r\nDTSTAMP:20260922T120000Z\r\nDTSTART:20260923T090000Z\r\nDTEND:20260923T100000Z\r\nEND:VFREEBUSY\r\nEND:VCALENDAR',
          ),
    ],
    [
      'a blank VALARM UID',
      (source) => source.replace('BEGIN:VALARM', 'BEGIN:VALARM\r\nUID:'),
    ],
    [
      'an absolute trigger without a UTC Z suffix',
      (source) =>
        source.replace(
          'TRIGGER:-PT15M',
          'TRIGGER;VALUE=DATE-TIME:20260923T084500',
        ),
    ],
    [
      'an absolute trigger with a TZID',
      (source) =>
        source.replace(
          'TRIGGER:-PT15M',
          'TRIGGER;VALUE=DATE-TIME;TZID=Europe/Stockholm:20260923T104500',
        ),
    ],
    [
      'an absolute DATE trigger',
      (source) =>
        source.replace('TRIGGER:-PT15M', 'TRIGGER;VALUE=DATE:20260923'),
    ],
    [
      'an absolute trigger with duplicate VALUE parameters',
      (source) =>
        source.replace(
          'TRIGGER:-PT15M',
          'TRIGGER;VALUE=DATE-TIME;VALUE=DATE-TIME:20260923T084500Z',
        ),
    ],
    [
      'an invalid absolute calendar date',
      (source) =>
        source.replace(
          'TRIGGER:-PT15M',
          'TRIGGER;VALUE=DATE-TIME:20260230T084500Z',
        ),
    ],
    [
      'duplicate absolute TRIGGER properties',
      (source) =>
        source.replace(
          'TRIGGER:-PT15M',
          'TRIGGER;VALUE=DATE-TIME:20260923T084500Z\r\nTRIGGER;VALUE=DATE-TIME:20260923T084500Z',
        ),
    ],
    [
      'a positive duration trigger',
      (source) => source.replace('-PT15M', 'PT15M'),
    ],
    [
      'a trigger related to the event end',
      (source) =>
        source.replace('TRIGGER:-PT15M', 'TRIGGER;RELATED=END:-PT15M'),
    ],
    [
      'an unknown trigger parameter',
      (source) =>
        source.replace('TRIGGER:-PT15M', 'TRIGGER;X-MODE=custom:-PT15M'),
    ],
    [
      'a repeating alarm',
      (source) =>
        source.replace('END:VALARM', 'REPEAT:2\r\nDURATION:PT5M\r\nEND:VALARM'),
    ],
    [
      'multiple alarms in one event',
      (source) =>
        source.replace(
          'END:VEVENT',
          'BEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:Second\r\nTRIGGER:-PT5M\r\nEND:VALARM\r\nEND:VEVENT',
        ),
    ],
    [
      'an alarm on a detached event',
      (source) =>
        source.replace(
          'END:VCALENDAR',
          'BEGIN:VEVENT\r\nUID:other@example.test\r\nDTSTAMP:20260922T120000Z\r\nDTSTART:20260923T090000Z\r\nDTEND:20260923T100000Z\r\nSUMMARY:Other event\r\nBEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:Other\r\nTRIGGER:-PT5M\r\nEND:VALARM\r\nEND:VEVENT\r\nEND:VCALENDAR',
        ),
    ],
  ])('keeps %s opaque and permits unrelated edits', (_shape, mutate) => {
    const source = mutate(alarmEventSource());
    const parsed = codec.parse('team', 'opaque-alarm.ics', source);
    expect(parsed.event.alarm).toBeUndefined();
    expect(parsed.event.unsupportedAlarm).toBe(true);

    const alarm = {
      action: 'display' as const,
      trigger: { weeks: 0, days: 0, hours: 0, minutes: 10, seconds: 0 },
    };
    expect(() => parsed.applyPatch({ alarm })).toThrow(
      new ICalendarEventCodecError(
        'unsupported-patch',
        'Only one non-repeating DISPLAY alarm with a supported trigger is supported',
      ),
    );
    expect(() => parsed.applyPatch({ alarm: { operation: 'remove' } })).toThrow(
      new ICalendarEventCodecError(
        'unsupported-patch',
        'Only one non-repeating DISPLAY alarm with a supported trigger is supported',
      ),
    );

    const rawAlarm = source.match(/BEGIN:VALARM[\s\S]*?END:VALARM/)?.[0];
    const renamed = parsed.applyPatch({
      title: 'Renamed while keeping opaque alarm',
    });
    const calendar = ICAL.Component.fromString(renamed.icalendar);
    expect(rawAlarm).toBeTruthy();
    expect(renamed.icalendar).toContain(rawAlarm!);
    expect(calendar.toString()).toContain(
      'X-ALARM-METADATA:preserve-alarm-property',
    );
    expect(calendar.getAllSubcomponents('vevent')).toHaveLength(
      ICAL.Component.fromString(source).getAllSubcomponents('vevent').length,
    );
    expect(renamed.event.unsupportedAlarm).toBe(true);
  });

  it('keeps VALARM child components opaque during unrelated edits', () => {
    const nestedAlarm = alarmEventSource().replace(
      'END:VALARM',
      [
        'BEGIN:X-ALARM-CHILD',
        'X-CHILD-METADATA:preserve-child',
        'END:X-ALARM-CHILD',
        'END:VALARM',
      ].join('\r\n'),
    );
    const parsed = codec.parse('team', 'nested-alarm.ics', nestedAlarm);
    expect(parsed.event.alarm).toBeUndefined();
    expect(parsed.event.unsupportedAlarm).toBe(true);

    const edited = parsed.applyPatch({ title: 'Retitled with opaque alarm' });
    expect(edited.icalendar).toContain('BEGIN:X-ALARM-CHILD');
    expect(edited.icalendar).toContain('X-CHILD-METADATA:preserve-child');
    expect(edited.icalendar).toContain('END:X-ALARM-CHILD');
  });

  it('rejects malformed alarm writes without partially changing an event', () => {
    const parsed = codec.parse(
      'team',
      'no-alarm.ics',
      fixture('simple-timed.ics'),
    );
    expect(parsed.event.alarm).toBeUndefined();
    expect(parsed.event.unsupportedAlarm).toBeUndefined();

    expect(() =>
      parsed.applyPatch({
        alarm: {
          action: 'display',
          trigger: { weeks: 0, days: 0, hours: 0, minutes: 0, seconds: 0 },
        },
      }),
    ).toThrow(
      new ICalendarEventCodecError(
        'unsupported-patch',
        'Only one non-repeating DISPLAY alarm with a supported trigger is supported',
      ),
    );
    expect(() =>
      parsed.applyPatch({
        alarm: {
          action: 'display',
          trigger: { weeks: 1, days: 1, hours: 0, minutes: 0, seconds: 0 },
        },
      }),
    ).toThrow(
      new ICalendarEventCodecError(
        'unsupported-patch',
        'Only one non-repeating DISPLAY alarm with a supported trigger is supported',
      ),
    );

    const spoofedAlarm = {
      action: 'display',
      uid: 'operator-chosen@example.test',
      trigger: { weeks: 0, days: 0, hours: 0, minutes: 15, seconds: 0 },
    };
    const spoofedPatch = JSON.parse(
      JSON.stringify({ alarm: spoofedAlarm }),
    ) as CalendarEventPatch;
    expect(() => parsed.applyPatch(spoofedPatch)).toThrow(
      new ICalendarEventCodecError(
        'unsupported-patch',
        'Only one non-repeating DISPLAY alarm with a supported trigger is supported',
      ),
    );

    const spoofedInput = JSON.parse(
      JSON.stringify({
        uid: 'spoofed-input@example.test',
        title: 'Spoofed alarm UID',
        timing: {
          type: 'timed',
          start: { type: 'floating', local: '2026-09-23T09:00:00' },
          end: { type: 'floating', local: '2026-09-23T10:00:00' },
        },
        alarm: spoofedAlarm,
      }),
    ) as CalendarEventInput;
    expect(() => codec.create('team', 'spoofed.ics', spoofedInput)).toThrow(
      new ICalendarEventCodecError(
        'unsupported-patch',
        'Only one non-repeating DISPLAY alarm with a supported trigger is supported',
      ),
    );
  });
});

function relativeAlarmMinutes(
  alarm: CalendarEvent['alarm'],
): number | undefined {
  const trigger = alarm?.trigger;
  return trigger && !('type' in trigger) ? trigger.minutes : undefined;
}

function alarmEventSource(): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Matrix Calendar Widget//Tests//EN',
    'X-CUSTOM-CALENDAR-PROPERTY:preserve-resource-value',
    'BEGIN:VEVENT',
    'UID:alarm-test@example.test',
    'DTSTAMP:20260922T120000Z',
    'DTSTART:20260923T090000Z',
    'DTEND:20260923T100000Z',
    'SUMMARY:Alarm test',
    'X-CUSTOM-EVENT-PROPERTY:preserve-event-value',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'DESCRIPTION:Alarm description',
    'TRIGGER:-PT15M',
    'X-ALARM-METADATA:preserve-alarm-property',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

function fixture(name: string): string {
  return fs.readFileSync(
    path.resolve(__dirname, '../../../fixtures/ical', name),
    'utf8',
  );
}

function propertyLines(component: ICAL.Component, name: string): string[] {
  return component
    .getAllProperties(name)
    .map((property) => property.toICALString());
}

function revisionPropertyLines(vevent: ICAL.Component): string[] {
  return ['dtstamp', 'created', 'last-modified', 'sequence'].flatMap((name) =>
    propertyLines(vevent, name),
  );
}

function rawVeventBlocks(source: string): string[][] {
  const blocks: string[][] = [];
  let current: string[] | undefined;
  for (const line of source.split(/\r\n|\n|\r/)) {
    if (/^BEGIN:VEVENT$/i.test(line)) {
      current = [line];
    } else if (current) {
      current.push(line);
      if (/^END:VEVENT$/i.test(line)) {
        blocks.push(current);
        current = undefined;
      }
    }
  }
  return blocks;
}

function rawRevisionLines(block: string[]): string[] {
  return block.filter((line) =>
    /^(DTSTAMP|CREATED|LAST-MODIFIED|SEQUENCE)(?:;|:)/i.test(line),
  );
}

function simpleRecurringSource(
  dtstart: string,
  dtend: string,
  additionalLines: string[] = [],
  timezoneDefinitions: string[] = [],
): string {
  const timezoneComponents = timezoneDefinitions.map((timezoneId) => {
    const definition = getVTimezoneBlock(timezoneId);
    if (!definition) {
      throw new Error(`Missing bundled VTIMEZONE definition: ${timezoneId}`);
    }
    return definition;
  });

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Matrix Calendar Widget//Tests//EN',
    'X-CUSTOM-CALENDAR-PROPERTY:preserve-resource-value',
    ...timezoneComponents,
    'BEGIN:VEVENT',
    'UID:simple-recurring@example.test',
    'DTSTAMP:20260922T120000Z',
    dtstart,
    dtend,
    'SUMMARY:Simple recurring event',
    'RRULE:FREQ=DAILY;COUNT=3',
    ...additionalLines,
    'X-CUSTOM-EVENT-PROPERTY:preserve-event-value',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

function withDetachedEvents(source: string, events: string[]): string {
  const endIndex = source.lastIndexOf('END:VCALENDAR');
  if (endIndex < 0) {
    throw new Error('Source calendar is missing END:VCALENDAR');
  }
  const prefix = source.slice(0, endIndex).replace(/(?:\r\n|\n|\r)$/, '');
  return `${prefix}\r\n${events.join('\r\n')}\r\nEND:VCALENDAR`;
}
