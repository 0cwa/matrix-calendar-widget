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

import { RRule } from 'rrule';

/**
 * Whether the current calendar form can represent a rule without losing
 * meaning when it is loaded and edited again.
 */
export function isCalendarEventRecurrenceRuleSupported(
  rule: string | undefined,
  timingType: 'timed' | 'all-day',
  timezone: string,
): boolean {
  if (!rule) {
    return true;
  }

  const normalizedRule = rule.replace(/^RRULE:/i, '');
  const parameters = new Map<string, string>();
  for (const part of normalizedRule.split(';')) {
    const separator = part.indexOf('=');
    if (separator <= 0 || separator === part.length - 1) {
      return false;
    }
    const name = part.slice(0, separator).toUpperCase();
    if (
      parameters.has(name) ||
      ![
        'FREQ',
        'INTERVAL',
        'COUNT',
        'UNTIL',
        'BYDAY',
        'BYMONTHDAY',
        'BYMONTH',
        'BYSETPOS',
      ].includes(name)
    ) {
      return false;
    }
    parameters.set(name, part.slice(separator + 1).toUpperCase());
  }

  const frequency = parameters.get('FREQ');
  if (!frequency || (parameters.has('COUNT') && parameters.has('UNTIL'))) {
    return false;
  }

  const interval = parameters.get('INTERVAL');
  const count = parameters.get('COUNT');
  const monthday = parameters.get('BYMONTHDAY');
  const month = parameters.get('BYMONTH');
  const weekday = parameters.get('BYDAY');
  const setPosition = parameters.get('BYSETPOS');

  if (
    (interval !== undefined && !isPositiveInteger(interval)) ||
    (count !== undefined && !isPositiveInteger(count)) ||
    (monthday !== undefined && !/^([1-9]|[12]\d|3[01])$/.test(monthday)) ||
    (month !== undefined && !/^([1-9]|1[0-2])$/.test(month)) ||
    (setPosition !== undefined && !/^(1|2|3|4|-1)$/.test(setPosition))
  ) {
    return false;
  }

  const weekdays = weekday?.split(',');
  if (
    weekdays?.some((day) => !/^(MO|TU|WE|TH|FR|SA|SU)$/.test(day)) ||
    (frequency === 'WEEKLY' && (monthday || month || setPosition)) ||
    (frequency === 'DAILY' && (weekday || monthday || month || setPosition)) ||
    (frequency === 'MONTHLY' && month) ||
    (frequency === 'YEARLY' && monthday && weekday) ||
    (frequency !== 'DAILY' &&
      frequency !== 'WEEKLY' &&
      frequency !== 'MONTHLY' &&
      frequency !== 'YEARLY')
  ) {
    return false;
  }

  if (
    (setPosition !== undefined && (!weekday || weekdays?.length !== 1)) ||
    ((frequency === 'MONTHLY' || frequency === 'YEARLY') &&
      weekday &&
      setPosition === undefined)
  ) {
    return false;
  }

  if (frequency === 'YEARLY' && month && !weekday && !monthday) {
    return false;
  }

  const until = parameters.get('UNTIL');
  if (
    until &&
    (!/^\d{8}T\d{6}Z$/.test(until) ||
      timingType !== 'timed' ||
      timezone === 'floating')
  ) {
    return false;
  }

  try {
    const parsed = RRule.parseString(normalizedRule);
    return parsed.freq !== undefined && parsed.freq !== null;
  } catch {
    return false;
  }
}

function isPositiveInteger(value: string): boolean {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0;
}
