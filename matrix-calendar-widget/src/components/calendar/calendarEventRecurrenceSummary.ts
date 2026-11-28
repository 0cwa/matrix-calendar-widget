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
  CalendarEventDateTime,
  CalendarEventWeekday,
  CalendarEventWeekdayOrdinal,
  SupportedCalendarEventRecurrenceRule,
  calendarUnixMillisToLocalDateTime,
  isAllDayCalendarEvent,
  isCalendarTimezoneSupported,
  isTimedCalendarEvent,
  parseSupportedCalendarEventRecurrenceRule,
} from '@matrix-calendar-widget/calendar';
import type { TFunction } from 'i18next';
import { DateTime } from 'luxon';

const WEEKDAYS: CalendarEventWeekday[] = [
  'MO',
  'TU',
  'WE',
  'TH',
  'FR',
  'SA',
  'SU',
];

/**
 * Plain-language sentences about how a series repeats. Only the rules the
 * editor itself understands are spelled out; anything else is named as a
 * custom schedule so the summary never guesses.
 */
export function calendarEventRecurrenceSummary(
  event: CalendarEvent,
  locale: string,
  viewerTimezone: string,
  t: TFunction,
): string[] {
  const custom = t(
    'calendarEvents.recurrence.custom',
    'Repeats on a custom schedule.',
  );
  if (event.unsupportedRecurrence || event.unsupportedTimezone) {
    return [custom];
  }

  const recurrence = event.recurrence;
  const sentences: string[] = [];
  if (recurrence?.rrule) {
    const anchor = recurrenceAnchor(event);
    let rule: SupportedCalendarEventRecurrenceRule | undefined;
    try {
      rule =
        anchor &&
        parseSupportedCalendarEventRecurrenceRule(recurrence.rrule, anchor);
    } catch {
      rule = undefined;
    }
    const startDate =
      anchor &&
      DateTime.fromISO(anchorLocal(anchor), { zone: 'UTC' }).setLocale(locale);
    if (!rule || !startDate?.isValid) {
      return [custom];
    }

    sentences.push(frequencySentence(rule, startDate, locale, t));

    if (rule.end.type === 'count') {
      sentences.push(
        t(
          'calendarEvents.recurrence.count',
          'Number of occurrences: {{total}}.',
          { total: rule.end.count },
        ),
      );
    } else if (rule.end.type === 'until') {
      const lastDate = lastPossibleDate(rule.end.value, anchor);
      if (!lastDate) {
        return [custom];
      }
      sentences.push(
        t('calendarEvents.recurrence.until', 'Ends by {{date}}.', {
          date: lastDate.setLocale(locale).toLocaleString(DateTime.DATE_FULL),
        }),
      );
    }

    if (
      anchor?.type === 'date-time' &&
      anchor.value.timezone !== viewerTimezone &&
      (rule.frequency !== 'DAILY' || rule.end.type === 'until')
    ) {
      sentences.push(
        t(
          'calendarEvents.recurrence.sourceZone',
          'Repeat dates follow {{timezone}}.',
          { timezone: anchor.value.timezone },
        ),
      );
    }
  } else if (recurrence?.rdates?.length) {
    sentences.push(
      t(
        'calendarEvents.recurrence.selectedDates',
        'Repeats on selected dates.',
      ),
    );
  } else {
    return [
      t(
        'calendarEvents.recurrence.partOfSeries',
        'Part of a recurring series.',
      ),
    ];
  }

  if (recurrence.rrule && recurrence.rdates?.length) {
    sentences.push(
      t('calendarEvents.recurrence.addedDates', 'Includes additional dates.'),
    );
  }
  if (recurrence.exdates?.length) {
    sentences.push(
      t('calendarEvents.recurrence.skippedDates', 'Some dates are skipped.'),
    );
  }
  if (recurrence.overrides?.length) {
    sentences.push(
      t(
        'calendarEvents.recurrence.changedOccurrences',
        'Some occurrences have their own changes.',
      ),
    );
  }
  return sentences;
}

function frequencySentence(
  rule: SupportedCalendarEventRecurrenceRule,
  startDate: DateTime,
  locale: string,
  t: TFunction,
): string {
  const { interval } = rule;
  const weekdayName = (weekday: CalendarEventWeekday) =>
    // 2024-01-01 was a Monday.
    DateTime.utc(2024, 1, 1 + WEEKDAYS.indexOf(weekday))
      .setLocale(locale)
      .toFormat('cccc');

  switch (rule.frequency) {
    case 'DAILY':
      return interval === 1
        ? t('calendarEvents.recurrence.daily', 'Repeats daily.')
        : t(
            'calendarEvents.recurrence.everyDays',
            'Repeats every {{interval}} days.',
            { interval },
          );
    case 'WEEKLY': {
      const days = new Intl.ListFormat(locale, { type: 'conjunction' }).format(
        (rule.weekdays ?? [WEEKDAYS[startDate.weekday - 1]]).map(weekdayName),
      );
      return interval === 1
        ? t('calendarEvents.recurrence.weekly', 'Repeats weekly on {{days}}.', {
            days,
          })
        : t(
            'calendarEvents.recurrence.everyWeeks',
            'Repeats every {{interval}} weeks on {{days}}.',
            { interval, days },
          );
    }
    case 'MONTHLY': {
      if (rule.weekdayOrdinal) {
        const values = {
          interval,
          position: ordinalName(rule.weekdayOrdinal.ordinal, t),
          weekday: weekdayName(rule.weekdayOrdinal.weekday),
        };
        return interval === 1
          ? t(
              'calendarEvents.recurrence.monthlyWeekday',
              'Repeats monthly on the {{position}} {{weekday}}.',
              values,
            )
          : t(
              'calendarEvents.recurrence.everyMonthsWeekday',
              'Repeats every {{interval}} months on the {{position}} {{weekday}}.',
              values,
            );
      }
      return interval === 1
        ? t(
            'calendarEvents.recurrence.monthly',
            'Repeats monthly on day {{day}}.',
            { day: startDate.day },
          )
        : t(
            'calendarEvents.recurrence.everyMonths',
            'Repeats every {{interval}} months on day {{day}}.',
            { interval, day: startDate.day },
          );
    }
    case 'YEARLY': {
      const date = startDate.toLocaleString({ month: 'long', day: 'numeric' });
      return interval === 1
        ? t('calendarEvents.recurrence.yearly', 'Repeats yearly on {{date}}.', {
            date,
          })
        : t(
            'calendarEvents.recurrence.everyYears',
            'Repeats every {{interval}} years on {{date}}.',
            { interval, date },
          );
    }
  }
}

function ordinalName(
  ordinal: CalendarEventWeekdayOrdinal['ordinal'],
  t: TFunction,
): string {
  switch (ordinal) {
    case 1:
      return t('calendarEvents.recurrence.ordinalFirst', 'first');
    case 2:
      return t('calendarEvents.recurrence.ordinalSecond', 'second');
    case 3:
      return t('calendarEvents.recurrence.ordinalThird', 'third');
    case 4:
      return t('calendarEvents.recurrence.ordinalFourth', 'fourth');
    case 5:
      return t('calendarEvents.recurrence.ordinalFifth', 'fifth');
    case -1:
      return t('calendarEvents.recurrence.ordinalLast', 'last');
  }
}

/**
 * The latest date an UNTIL bound can still admit, in the series' own clock. An
 * UNTIL earlier than the start time excludes its own date.
 */
function lastPossibleDate(
  until: string,
  anchor: CalendarEventDateTime | undefined,
): DateTime | undefined {
  const match = until.match(
    /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z?))?$/,
  );
  if (!match || !anchor) {
    return undefined;
  }

  const date = `${match[1]}-${match[2]}-${match[3]}`;
  if (anchor.type === 'date') {
    return parseWallTime(date);
  }

  let local = `${date}T${match[4]}:${match[5]}:${match[6]}`;
  if (anchor.type === 'date-time') {
    const { timezone } = anchor.value;
    if (!match[7] || !isCalendarTimezoneSupported(timezone)) {
      return undefined;
    }
    local = calendarUnixMillisToLocalDateTime(
      parseWallTime(local).toMillis(),
      timezone,
    );
  }

  const bound = parseWallTime(local);
  if (!bound.isValid) {
    return undefined;
  }
  const startTime = parseWallTime(anchorLocal(anchor)).toFormat('HH:mm:ss');
  return bound.toFormat('HH:mm:ss') < startTime
    ? bound.minus({ days: 1 })
    : bound;
}

function parseWallTime(local: string): DateTime {
  return DateTime.fromISO(local, { zone: 'UTC' });
}

function recurrenceAnchor(
  event: CalendarEvent,
): CalendarEventDateTime | undefined {
  if (isAllDayCalendarEvent(event)) {
    return { type: 'date', value: event.timing.startDate };
  }
  if (!isTimedCalendarEvent(event)) {
    return undefined;
  }
  const { start } = event.timing;
  return start.type === 'floating'
    ? { type: 'floating-date-time', value: start.local }
    : {
        type: 'date-time',
        value: { local: start.local, timezone: start.timezone },
      };
}

function anchorLocal(anchor: CalendarEventDateTime): string {
  return anchor.type === 'date-time' ? anchor.value.local : anchor.value;
}
